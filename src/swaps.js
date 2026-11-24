// Swap - K iOS 518fdc8c SwapView / SwapService (K 5.4), after K-Desktop d570abd ui/swaps.js, in the
// extension's panels: ChangeNOW for coins on other networks, and kUSDT natively through Trestly's
// pool on Kaspa (src/swap-kusdt.js, shared/engine/kusdt-trade.js).
//
// KAS is always one side of the pair; the other coin comes from the picker: kUSDT first, then the
// curated ChangeNOW list (shared/ui/swap-quote.js).
// - ChangeNOW: nothing is sent automatically. Whichever coin is given up, the person pays it into
//   the ChangeNOW deposit address themselves (a QR). Swapping INTO KAS pays out to the next
//   never-used LEGACY spending address by default, so exchange-received coins can't be
//   chain-linked to everyday spending.
// - kUSDT: Trestly's pinned code quotes (`prepare`, no key), the approval sheet shows the trade, and
//   only on Approve is the address's key handed to their `execute`. The approval is the
//   confirmation, as a kUSDT send's is: no password.
// Before Swap opens, both third parties' agreements (iOS SwapAgreementsView: ChangeNOW's and
// Trestly's, one box each, Continue once both are checked), per chatting address.
//
// The ChangeNOW API key never ships in the extension: every call goes to KaChat-Desktop's hosted
// relay (desktop.kachat.app/nc-proxy/), which adds the server's key to the four swap calls only
// (owner, 2026-10-23). Each call names this extension's ID (x-kachat-extension); the relay takes it
// only from an ID on its KAPAY_EXTENSION_IDS list (KaChat-Desktop Build 261). Until this ID is
// listed, or when the server has no key, Swap says "Swap is not available right now".

import { esc, toast, showSheet, showAlert, ICONS, pageCycleHtml } from "./ui.js";
import { kusdtCoinIconHtml } from "./kusdt-icons.js";
import { openPanel } from "./kachat-ui.js";
import { ext } from "./browser.js";
import * as wallet from "./wallet.js";
import * as vault from "./vault.js";
import { drawKaspaQr } from "../shared/engine/qr.js";
import {
  KAS, KUSDT_COIN, CURATED_COINS, USDC_POLYGON, GROUPED_TICKERS, PINNED_GROUP_TICKERS, SWAP_UNAVAILABLE_TITLE,
  sameCoin, isTrestlyCoin, coinByKey, cleanSwapAmount, createChangeNowClient, createSwapQuoter, rateLine, portfolioPrefill,
  swapSourceTxId,
} from "../shared/ui/swap-quote.js";
import {
  quoteKusdtSwap, kusdtSwapAmountIn, kusdtQuoteText, kusdtRateText, minimumOut, swapRecord as kusdtSwapRecord, TRADE_CODE,
  tradeUnits, kasAmountLabel,
} from "../shared/engine/kusdt-trade.js";
import { formatKusdt, typedKusdt, KUSDT_TOKEN } from "../shared/engine/kusdt.js";
import { approvalRows, approvalWarnings, approvalBlocked, APPROVE_ARM_MS, APPROVAL_TEXT } from "../shared/ui/swap-approval.js";
import { swapTrade, runKusdtSwap, kusdtFromChoices, noteKusdtSwap, trestlyTermsUrl, kusdtUnitsAt, kusdtHoldingsFresh } from "./swap-kusdt.js";
import { extraIdName, checkPayoutExtraId, withPayoutExtraId, payoutExtraIdKept, swapAnswerMatches } from "./swap-extra-id.js";

const RELAY_ORIGIN = "https://desktop.kachat.app";
const RELAY_ROOT = `${RELAY_ORIGIN}/nc-proxy/`;
const RELAY_PERMISSION = { origins: [`${RELAY_ORIGIN}/*`] };
// Both agreements at once (K iOS 518fdc8c SwapAgreementsView), per chatting address. The one before
// K 5.4 (ChangeNOW's alone, "kachat-swap-disclaimer-agreed-v1") isn't read: the text changed.
const AGREEMENTS_KEY = "kachat-swap-agreements-v2";
const HISTORY_KEY = "kachat-swap-history-v1";          // per chatting address

/** The two agreements (iOS SwapAgreementsView), each its own third party K doesn't run. */
const AGREEMENTS = Object.freeze({
  changenow: {
    title: "ChangeNOW",
    subtitle: "Coins on other networks",
    text: "Swaps between Kaspa and coins on other networks (Bitcoin, Ethereum, USDC, USDT and others) are made by ChangeNOW, a third-party exchange. K only asks ChangeNOW for a quote and a deposit address and shows the swap's status; ChangeNOW does the exchange and sends the coins. K isn't responsible for failed, delayed or lost swaps. If one doesn't go through, contact ChangeNOW's support.",
    termsTitle: "Read ChangeNOW's Terms of Use",
    checkbox: "I understand ChangeNOW is a third party, not K, and I agree to ChangeNOW's Terms of Use.",
  },
  trestly: {
    title: "Trestly",
    subtitle: "kUSDT on Kaspa",
    text: "Swaps between KAS and kUSDT go through Trestly's pool on Kaspa. Trestly is a third party: it issues kUSDT and runs the pool, not K. Trestly's own code prices each swap and builds its transaction; K shows it to you, signs it with your address's key only after you approve, and sends it. Prices move, and the pool can be paused or limit sells. K isn't responsible for the pool, the token or a swap's outcome.",
    termsTitle: "Read Trestly's Terms of Service",
    checkbox: "I understand Trestly is a third party, not K, and I agree to Trestly's Terms of Service.",
  },
});
/** What a KAS-for-kUSDT buy keeps back (K iOS 6b99c6dd SwapService.kasKeptForBuy), exactly as
 *  Trestly's pool works out its own max (`maxKasIn` in kusdt-wallet.js): the KAS locked in the new
 *  kUSDT coin (1.5 KAS) and FEE_KEEP (0.3 KAS) for the network fee. Less, and the pool refuses a
 *  Max buy. */
const FEE_KEPT_FOR_BUY = 30_000_000n;
const KAS_KEPT_FOR_BUY = KUSDT_TOKEN.kasPerCoinSompi + FEE_KEPT_FOR_BUY;
const MAX_KEEPS_NOTE = `Max keeps ${kasAmountLabel(KAS_KEPT_FOR_BUY)} back: ${kasAmountLabel(KUSDT_TOKEN.kasPerCoinSompi)} goes inside your new kUSDT coin, and up to ${kasAmountLabel(FEE_KEPT_FOR_BUY)} pays the network fee.`;
/** "12.5" for an exact sompi amount, as typed. */
const typedKas = (sompi) => {
  const whole = sompi / 100_000_000n;
  const frac = String(sompi % 100_000_000n).padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
};
const COIN_LOGOS = new Set(["btc", "eth", "sol", "xrp", "bnb", "trx", "hype", "doge", "ltc", "ada", "bch", "etc", "usdc", "usdt", "zec", "xmr"]);

const FLIP = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 20V4M4 8l4-4 4 4"/><path d="M16 4v16M12 16l4 4 4-4"/></svg>';
const SWAP = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h15M15 4l4 4-4 4"/><path d="M20 16H5M9 12l-4 4 4 4"/></svg>';
const CHEVRON_DOWN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const TRASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6.5h17M18.5 6.5V19a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6.5M8.5 6.5V4.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2"/></svg>';

/** A relay refusal that means "not for this caller / no key", not a ChangeNOW answer. */
const isRelayRefusal = (error) => error?.unavailable || (error?.status === 403 && /only relayed/i.test(String(error?.message || error?.body || "")));

// The relay's tools/relay-rules.mjs EXTENSION_ID_HEADER.
const relayFetch = (url, init) => fetch(url, { ...init, headers: { ...init?.headers, "x-kachat-extension": ext.runtime.id } });
const relayUrl = (url) => {
  const parsed = new URL(url);
  return `${RELAY_ROOT}${encodeURIComponent(parsed.origin)}${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}`;
};
const client = createChangeNowClient({ fetchImpl: relayFetch, urlFor: relayUrl });
const quoter = createSwapQuoter(client);
/** The client for one create whose payout carries an extra ID (swap-extra-id.js). */
const clientWithPayoutExtraId = (extraId) => createChangeNowClient({ fetchImpl: (url, init) => relayFetch(url, withPayoutExtraId(init, extraId)), urlFor: relayUrl });

function coinIcon(coin) {
  if (isTrestlyCoin(coin)) return `<span class="swap-coin-icon swap-coin-kusdt">${kusdtCoinIconHtml(20)}</span>`;
  if (coin.ticker === "kas") return '<img class="swap-coin-icon" src="icons/kaspa-logo.png" alt="" />';
  if (COIN_LOGOS.has(coin.ticker)) return `<img class="swap-coin-icon" src="coins/coin_${esc(coin.ticker)}.png" alt="" />`;
  return `<span class="swap-coin-icon swap-coin-text">${esc(coin.ticker.toUpperCase())}</span>`;
}
const capitalize = (t) => String(t || "").toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
const statusClass = (s) => (s === "finished" ? "accent" : s === "failed" || s === "refunded" ? "error-text" : "kl-orange");
const dateText = (ms) => new Date(Number(ms) || Date.now()).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
const shortMiddle = (v) => (String(v || "").length > 20 ? `${String(v).slice(0, 12)}...${String(v).slice(-6)}` : String(v || ""));
const fmt8 = (t) => (t === "" || t == null ? String(t ?? "") : Number.isFinite(Number(t)) ? Number(t).toFixed(8) : String(t));

/** Opens Swap; `coin` ("kusdt", or "ticker:network") picks the other coin, and `buying` starts with
 *  KAS under You Send (Send kUSDT's "Swap for kUSDT", after K-Desktop d570abd openKusdtSwap: with
 *  no kUSDT held, buying is the side that can go ahead). */
export async function showSwap({ coin = null, buying = false } = {}) {
  const main = (await wallet.cachedAddresses((await vault.readAccounts()).activeAccountId))?.main || "";
  const scoped = (key) => `${key}:${String(main).toLowerCase()}`;
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(scoped(key)) ?? "null") ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(scoped(key), JSON.stringify(value)); } catch { /* storage blocked */ } };

  const state = {
    availability: "checking", // checking | on | off | permission
    agreed: read(AGREEMENTS_KEY, false) === true,
    checks: { changenow: false, trestly: false },
    tab: "swap",
    kasIsSendSide: buying === true, // iOS default: most people open Swap to get KAS
    otherCoin: (coin === "kusdt" ? KUSDT_COIN : coinByKey(coin)) || USDC_POLYGON,
    amountText: "", receiveAmountText: "", editedSide: "send",
    payoutText: "",
    payoutExtraText: "",      // the payout's destination tag / memo, for a coin that has one
    payoutOverride: null,     // { index, address } picked instead of the next legacy slot
    nextPayout: null,         // { index, address }
    estimate: { status: "idle" },
    create: { status: "idle", result: null },
    kusdtFrom: null,          // { label, address, spendingIndex }: the Chatting Address unless picked
    kusdtQuote: null,         // { quote, amountIn, buying, address }: what Swap's Swap approves
    kusdtFromKas: null,       // { address, sompi }: the Swap From address's KAS (K iOS 6b99c6dd)
    history: (() => { const h = read(HISTORY_KEY, []); return Array.isArray(h) ? h : []; })(),
  };
  state.history.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const saveHistory = () => { state.history.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)); write(HISTORY_KEY, state.history); };
  const fromCoin = () => (state.kasIsSendSide ? KAS : state.otherCoin);
  const toCoin = () => (state.kasIsSendSide ? state.otherCoin : KAS);
  const payoutAddress = () => state.payoutOverride?.address || state.nextPayout?.address || "";
  const isKusdt = () => isTrestlyCoin(state.otherCoin);
  /** The kUSDT swap's address (iOS TrestlyTarget): the Chatting Address unless another was picked. */
  const kusdtTarget = () => state.kusdtFrom || (main ? { label: "Chatting Address", address: main, spendingIndex: null } : null);
  let handle = null;
  let estimateTimer = null;
  let estimateToken = 0;

  // --- availability: the relay's /__swap probe, and this extension's access to the relay ---
  const probe = async () => {
    let allowed = false;
    try { allowed = await ext.permissions.contains(RELAY_PERMISSION); } catch { allowed = false; }
    if (!allowed) { state.availability = "permission"; paint(); return; }
    try {
      const response = await fetch(`${RELAY_ROOT}__swap`, { cache: "no-store" });
      state.availability = response.ok && (await response.text()).trim() === "on" ? "on" : "off";
    } catch {
      state.availability = "off";
    }
    paint();
  };
  const unavailable = (error) => {
    if (!isRelayRefusal(error)) return false;
    state.availability = "off";
    paint();
    return true;
  };

  // --- live quote (iOS rescheduleEstimate) ---
  const reschedule = () => {
    clearTimeout(estimateTimer);
    const token = ++estimateToken;
    state.kusdtQuote = null;
    if (isKusdt()) { rescheduleKusdt(token); return; }
    // cleaned as every amount field is: "1,5" is 1.5, never 15 (K audit 2026-11-24 #3)
    const typed = cleanSwapAmount(state.editedSide === "send" ? state.amountText : state.receiveAmountText);
    if (!(Number(typed) > 0)) { state.estimate = { status: "idle" }; paintForm(); return; }
    const from = fromCoin();
    const to = toCoin();
    const side = state.editedSide;
    paintForm();
    estimateTimer = setTimeout(async () => {
      if (token !== estimateToken) return;
      state.estimate = { status: "loading" };
      paintForm();
      try {
        const quote = await quoter.quote({ side, from, to, amountText: typed });
        if (token !== estimateToken) return;
        if (side === "send") state.receiveAmountText = quote.getText; else state.amountText = quote.sendText;
        state.estimate = { status: "success", fromAmount: quote.fromAmount, toAmount: quote.toAmount };
      } catch (error) {
        if (token !== estimateToken) return;
        if (unavailable(error)) return;
        state.estimate = { status: "failed", message: error?.message || "Unavailable" };
      }
      paintForm();
    }, 500);
  };
  // --- Available and Max on a kUSDT swap (K iOS 6b99c6dd): a kUSDT swap spends what K holds ---
  /** The Swap From address's kUSDT, in units. */
  const kusdtFromUnits = () => kusdtUnitsAt(kusdtTarget()?.address);
  /** The Swap From address's KAS, or null until read. */
  const kusdtFromKasSompi = () => (state.kusdtFromKas && state.kusdtFromKas.address === kusdtTarget()?.address ? state.kusdtFromKas.sompi : null);
  /** The most "You Send" can be: the address's kUSDT on a sell, its KAS less what a buy keeps back.
   *  null when it isn't known (or this isn't a kUSDT swap). */
  const kusdtMaxSend = () => {
    if (!isKusdt()) return null;
    if (!state.kasIsSendSide) return kusdtFromUnits();
    const kas = kusdtFromKasSompi();
    if (kas == null) return null;
    return kas > KAS_KEPT_FOR_BUY ? kas - KAS_KEPT_FOR_BUY : 0n;
  };
  /** "Available" beside You Send: KAS on a buy, kUSDT on a sell. */
  const kusdtAvailableText = () => {
    if (!isKusdt()) return null;
    if (state.kasIsSendSide) { const kas = kusdtFromKasSompi(); return kas == null ? null : kasAmountLabel(kas); }
    return formatKusdt(kusdtFromUnits());
  };
  /** Reads the Swap From address's KAS (its plain coins: kUSDT coins live at the token's own script
   *  address, so they aren't counted). */
  const refreshKusdtBalances = async () => {
    const address = isKusdt() ? kusdtTarget()?.address : null;
    if (!address) return;
    // the kUSDT side: what Manage kUSDT knows, looked up again when it's old
    kusdtHoldingsFresh().then(() => paintForm()).catch(() => {});
    let sompi = null;
    try { sompi = (await wallet.balancesFor([address]))[address] ?? null; } catch { sompi = null; }
    if (sompi == null || kusdtTarget()?.address !== address) return;
    state.kusdtFromKas = { address, sompi };
    paintForm();
  };
  /** Max: "You Send" becomes all that can go. */
  const setMaxAmount = () => {
    const max = kusdtMaxSend();
    if (max == null || max <= 0n) return;
    state.amountText = state.kasIsSendSide ? typedKas(max) : typedKusdt(max);
    state.editedSide = "send";
    reschedule();
  };

  /** kUSDT (iOS rescheduleKusdtEstimate): Trestly's `prepare` for what was typed (nothing signed, no
   *  key), with no minimum, so the pool's own quote lands in "You Get". A paused pool or its circuit
   *  breaker says so instead. */
  const rescheduleKusdt = (token) => {
    const buying = state.kasIsSendSide;
    const amountIn = kusdtSwapAmountIn(state.amountText, { buying });
    const target = kusdtTarget();
    state.receiveAmountText = "";
    if (amountIn == null || !target) { state.estimate = { status: "idle" }; paintForm(); return; }
    paintForm();
    estimateTimer = setTimeout(async () => {
      if (token !== estimateToken) return;
      state.estimate = { status: "loading" };
      paintForm();
      try {
        const quote = await quoteKusdtSwap(swapTrade(), { buying, amountIn, target });
        if (token !== estimateToken) return;
        state.kusdtQuote = { quote, amountIn, buying, address: target.address };
        state.receiveAmountText = kusdtQuoteText(quote, { buying });
        state.estimate = { status: "success", rateText: kusdtRateText({ buying, amountIn, quote, kusdtLabel: KUSDT_COIN.displayName }) };
      } catch (error) {
        if (token !== estimateToken) return;
        state.estimate = { status: "failed", message: String(error?.message || "Unavailable") };
      }
      paintForm();
    }, 500);
  };
  /** The other coin (iOS SwapService.otherCoin's didSet): a created exchange and a typed tag go, and
   *  Trestly's pool quotes from what you send, so a typed "You Get" moves to "You Send"; a figure
   *  typed in one coin's units isn't the other's. */
  const setOtherCoin = (picked) => {
    if (!picked) return;
    const was = isKusdt();
    if (!sameCoin(picked, state.otherCoin)) { clearCreated(); state.payoutExtraText = ""; }
    state.otherCoin = picked;
    if (isKusdt() !== was) { state.amountText = ""; state.receiveAmountText = ""; state.editedSide = "send"; }
    else if (isKusdt() && state.editedSide === "get") { state.amountText = ""; state.editedSide = "send"; }
    clearQuoted();
    reschedule();
    refreshKusdtBalances();
  };
  /** The created exchange's deposit card goes once the coin or direction changes: it belongs to
   *  the exchange made (K iOS clearCreatedSwap, audit 2026-11-24 #2). */
  const clearCreated = () => { if (state.create.status !== "creating") state.create = { status: "idle", result: null }; };
  const clearQuoted = () => { if (state.editedSide === "send") state.receiveAmountText = ""; else state.amountText = ""; };

  // --- create / status (iOS executeSwap, refreshSwapStatusAsync) ---
  const execute = async () => {
    if (state.create.status === "creating") return;
    if (isKusdt()) { executeKusdt(); return; }
    const amountStr = cleanSwapAmount(state.amountText);
    if (!(Number(amountStr) > 0)) return;
    const from = fromCoin();
    const to = toCoin();
    state.create = { status: "creating", result: null };
    paintForm();
    try {
      let address = "";
      if (to.ticker === "kas") {
        // the next never-used legacy slot, reserved now that the swap is real - unless one was
        // picked. It must be the one shown: another one is shown instead, and nothing is created.
        try {
          address = state.payoutOverride?.address || (await wallet.reserveSwapPayoutAddress(state.nextPayout?.address || null)).address;
        } catch (error) {
          if (error?.code !== wallet.PAYOUT_CHANGED) throw error;
          state.nextPayout = error.next;
          state.create = { status: "failed", result: null };
          toast(error.message);
          paintForm();
          return;
        }
      } else {
        address = state.payoutText.trim();
      }
      if (!address) {
        state.create = { status: "failed", result: null };
        toast(`Enter an address to receive the ${to.displayName}`);
        paintForm();
        return;
      }
      const payoutExtra = checkPayoutExtraId(to, state.payoutExtraText);
      if (payoutExtra.error) {
        state.create = { status: "failed", result: null };
        toast(payoutExtra.error);
        paintForm();
        return;
      }
      const response = await (payoutExtra.value ? clientWithPayoutExtraId(payoutExtra.value) : client).create(from, to, amountStr, address);
      if (!response?.payinAddress) {
        state.create = { status: "failed", result: null };
        toast("ChangeNOW didn't return a deposit address");
        paintForm();
        return;
      }
      // ChangeNOW's answer must be the exchange asked for: its payout address, both coins and the
      // amount; otherwise its deposit address isn't shown (K iOS 518fdc8c, audit 2026-11-24 #6)
      if (!swapAnswerMatches(response, { from, to, amount: amountStr, payoutAddress: address })) {
        state.create = { status: "failed", result: null };
        toast("ChangeNOW's answer doesn't match this swap, so K didn't show its deposit address. Nothing was sent.");
        paintForm();
        return;
      }
      // a payout to an exchange account without its tag can't be credited: no deposit address unless
      // ChangeNOW kept it
      if (!payoutExtraIdKept(payoutExtra.value, response)) {
        state.create = { status: "failed", result: null };
        toast(`ChangeNOW didn't take the ${extraIdName(to)}. Don't pay into this swap; try again.`);
        paintForm();
        return;
      }
      // the deposit's own tag / memo: without it ChangeNOW can't credit the deposit
      const payinExtraId = response.payinExtraId != null ? String(response.payinExtraId).trim() : "";
      const payinExtraIdName = extraIdName(from) || "Extra ID";
      state.history.unshift({
        id: String(response.id), fromTicker: from.ticker, fromNetwork: from.network, toTicker: to.ticker, toNetwork: to.network,
        fromAmount: amountStr, toAmount: response.toAmount != null ? String(response.toAmount) : "",
        payinAddress: String(response.payinAddress), payoutAddress: address,
        payinExtraId, payinExtraIdName, payoutExtraId: payoutExtra.value, payoutExtraIdName: extraIdName(to) || "",
        status: response.status || "new", createdAt: Date.now(), addedToPortfolio: false,
      });
      saveHistory();
      // the deposit card is the exchange made - its coins, amount and payout - not the coins picked
      // later (K iOS 518fdc8c, audit 2026-11-24 #2)
      state.create = {
        status: "success",
        result: { ...response, payinExtraId, payinExtraIdName, fromCoin: from, toCoin: to, fromAmount: amountStr, payoutAddress: address },
      };
      state.payoutExtraText = "";
      state.amountText = ""; state.receiveAmountText = ""; state.editedSide = "send";
      state.estimate = { status: "idle" };
      state.payoutOverride = null;
      state.nextPayout = await wallet.nextSwapPayoutAddress().catch(() => null);
      toast("Swap started");
    } catch (error) {
      if (unavailable(error)) { state.create = { status: "idle", result: null }; return; }
      state.create = { status: "failed", result: null };
      toast(error?.message || "Swap failed");
    }
    paintForm();
  };
  /** kUSDT (iOS SwapService.executeKusdtSwap): Trestly's code prepares the swap with a minimum 1%
   *  under the quote, the approval sheet shows it, and only on Approve is it signed with the
   *  address's key and sent. */
  const executeKusdt = async () => {
    const buying = state.kasIsSendSide;
    const amountIn = kusdtSwapAmountIn(state.amountText, { buying });
    const target = kusdtTarget();
    const q = state.kusdtQuote;
    if (amountIn == null || !target || !q || q.amountIn !== amountIn || q.buying !== buying || q.address !== target.address) return;
    const owner = main;
    state.create = { status: "creating", result: null };
    paintForm();
    try {
      const done = await runKusdtSwap({
        params: { side: buying ? "buy" : "sell", amountIn: String(amountIn), minOut: String(minimumOut(q.quote)) },
        target,
        askApproval: (request) => askApproval(request),
        isClosed: () => !handle?.isOpen(),
      });
      const record = kusdtSwapRecord(done);
      noteKusdtSwap({ record, target, owner });
      toast(record?.text || "Swap sent");
      state.amountText = ""; state.receiveAmountText = ""; state.kusdtQuote = null;
      state.estimate = { status: "idle" };
      state.create = { status: "idle", result: null };
    } catch (error) {
      if (error?.code === TRADE_CODE.rejected) state.create = { status: "idle", result: null };
      else {
        state.create = { status: "failed", result: null };
        toast(String(error?.message || "Swap failed"));
      }
    }
    paintForm();
  };

  // --- The approval (K iOS TrestlyApprovalSheet, `native`) ---
  let approval = null; // { resolve, timer, sheet }
  /** Answers the open approval once; later calls do nothing. */
  const answerApproval = (approved) => {
    const open = approval;
    if (!open) return;
    approval = null;
    clearTimeout(open.timer);
    if (open.sheet.isOpen()) open.sheet.close();
    open.resolve(approved === true);
  };
  /** Shows the approval and waits for Approve (true) or Decline; closing the sheet declines. Approve
   *  wakes a moment after the sheet appears, so a click meant for the screen behind can't land on
   *  it, and never for a trade the pool would refuse (`blocked`). */
  const askApproval = (request) => {
    answerApproval(false);
    return new Promise((resolve) => {
      const p = request?.prepared || {};
      const line = ({ label, value, bold }) => `<div class="sk-from-row"><span class="muted small">${esc(label)}</span><span class="small ${bold ? "strong" : ""}">${esc(value)}</span></div>`;
      const feeUnits = tradeUnits(p.feeAbout);
      const fee = feeUnits == null ? "--" : kasAmountLabel(feeUnits);
      const sheet = openPanel({
        title: "Approve", leading: "Decline", full: true, stack: true,
        onClose: () => answerApproval(false),
        body: `<div class="swap-approval">
          <div class="swap-approval-head">${kusdtCoinIconHtml(36)}<span class="tx-meta"><span class="muted tiny">Through Trestly's pool</span><span class="strong">${p.side === "buy" ? "Buy kUSDT" : "Sell kUSDT"}</span></span></div>
          ${request?.seen ? `<p class="small kl-orange">${esc(APPROVAL_TEXT.requote)}</p>` : ""}
          <div class="sk-card swap-approval-card">
            ${approvalRows(request).map(line).join("")}
            <hr />
            ${line({ label: "From", value: request?.from || "" })}
            ${line({ label: "Network Fee", value: `about ${fee}` })}
          </div>
          ${approvalWarnings(p).map((w) => `<p class="small kl-orange">${esc(w)}</p>`).join("")}
          <p class="muted tiny">${esc(APPROVAL_TEXT.note)}</p>
          <p class="muted tiny">${esc(APPROVAL_TEXT.nodes)}</p>
          <button class="big" data-swap-approve disabled>Approve</button>
        </div>`,
      });
      const open = { resolve, timer: null, sheet };
      approval = open;
      const button = sheet.panel.querySelector("[data-swap-approve]");
      button.onclick = () => { if (!button.disabled && approval === open && !approvalBlocked(p)) answerApproval(true); };
      open.timer = setTimeout(() => { if (approval === open && !approvalBlocked(p)) button.disabled = false; }, APPROVE_ARM_MS);
    });
  };

  const refreshStatus = async (id) => {
    try {
      const status = (await client.status(id))?.status || null;
      if (!status) return null;
      const swap = state.history.find((s) => s.id === id);
      if (swap) { swap.status = status; saveHistory(); }
      if (state.create.result?.id === id) state.create.result = { ...state.create.result, status };
      return status;
    } catch (error) {
      unavailable(error);
      return null;
    }
  };

  // --- rendering ---
  /** A card that isn't `editable` shows the quote (kUSDT's You Get: the pool quotes from what you
   *  send). */
  const amountCard = ({ label, coin, value, field, quoting, editable = true, available = null, max = false }) => `
    <div class="sk-card swap-card">
      <div class="swap-card-head"><span class="sk-label">${esc(label)}</span>${available ? `<span class="muted tiny swap-available">Available: ${esc(available)}</span>` : ""}</div>
      <div class="swap-card-row">
        ${quoting ? '<span class="swap-quoting"><span class="spinner small-spin"></span></span>'
          : `<input class="swap-amount" type="text" inputmode="decimal" placeholder="0.00" aria-label="${esc(label)}" data-swap-field="${field}" value="${esc(value)}" autocomplete="off"${editable ? "" : ' readonly tabindex="-1"'} />`}
        ${max ? '<button type="button" class="bar-text accent strong swap-max" data-swap-max>Max</button>' : ""}
        ${coin.ticker === "kas"
          ? `<span class="swap-badge">${coinIcon(coin)}<span>${esc(coin.displayName)}</span></span>`
          : `<button type="button" class="swap-badge pickable" data-swap-pick>${coinIcon(coin)}<span>${esc(coin.displayName)}</span>${CHEVRON_DOWN}</button>`}
      </div>
    </div>`;
  const rateText = () => (state.estimate.status === "success"
    ? state.estimate.rateText || rateLine({ fromAmount: state.estimate.fromAmount, toAmount: state.estimate.toAmount, fromLabel: state.kasIsSendSide ? "KAS" : state.otherCoin.displayName, toLabel: state.kasIsSendSide ? state.otherCoin.displayName : "KAS" })
    : state.estimate.status === "failed" ? (state.estimate.message || "Unavailable") : "N/A");
  /** A deposit's tag / memo, where it can't be missed: without it the deposit can't be credited. */
  const payinExtraHtml = (name, value) => (value ? `
      <span class="strong small kl-orange">${ICONS.warning} Include this ${esc(name)}</span>
      <button class="mono small strong swap-mono" data-swap-copy-extra="${esc(value)}" data-swap-extra-name="${esc(name)}">${esc(value)}</button>
      <span class="muted tiny">ChangeNOW's deposit address is shared. Send without this ${esc(name)} and the deposit can't be credited to your swap.</span>` : "");
  const resultCard = (r) => `
    <div class="sk-card swap-result">
      <div class="strong">Send ${esc(r.fromAmount)} ${esc(r.fromCoin.displayName)} to this address</div>
      <button class="swap-qr-button" data-swap-copy="${esc(r.payinAddress)}" aria-label="Copy deposit address"><canvas class="swap-qr" data-swap-qr="${esc(r.payinAddress)}" width="180" height="180"></canvas></button>
      <button class="mono tiny swap-mono" data-swap-copy="${esc(r.payinAddress)}">${esc(r.payinAddress)}</button>
      ${payinExtraHtml(r.payinExtraIdName || "Extra ID", r.payinExtraId)}
      <span class="muted tiny">Receiving ${esc(r.toCoin.displayName)} at</span>
      <span class="mono tiny swap-mono">${esc(r.payoutAddress)}</span>
      <span class="muted tiny">Status: ${esc(r.status || "new")}</span>
      <span class="muted tiny">ChangeNOW Exchange ID</span>
      <button class="mono tiny swap-mono" data-swap-copy-id="${esc(r.id)}">${esc(r.id)}</button>
      <div class="swap-links">
        <button class="bar-text accent strong" data-swap-refresh="${esc(r.id)}">Refresh Status</button>
        <a class="bar-text accent strong" href="https://changenow.io/exchange/txs/${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">View on ChangeNOW</a>
      </div>
    </div>`;
  const formHtml = () => {
    const busy = state.create.status === "creating";
    const loading = state.estimate.status === "loading";
    const kusdt = isKusdt();
    const canSwap = state.estimate.status === "success" && !busy && (!kusdt || state.kusdtQuote != null);
    const target = kusdt ? kusdtTarget() : null;
    return `
      ${amountCard({ label: "You Send", coin: fromCoin(), value: state.amountText, field: "send", quoting: state.editedSide === "get" && loading, available: kusdtAvailableText(), max: (kusdtMaxSend() ?? 0n) > 0n })}
      ${kusdt && state.kasIsSendSide ? `<p class="muted tiny swap-max-note">${esc(MAX_KEEPS_NOTE)}</p>` : ""}
      <div class="swap-actions-row">
        <button class="icon plain accent swap-flip" data-swap-flip aria-label="Switch direction" title="Switch direction">${FLIP}</button>
        <button class="swap-go" data-swap-create ${canSwap ? "" : "disabled"}>${busy ? '<span class="spinner small-spin"></span>' : kusdt ? "Swap" : "Get Deposit Address"}</button>
      </div>
      ${amountCard({ label: "You Get", coin: toCoin(), value: state.receiveAmountText, field: "get", quoting: state.editedSide === "send" && loading, editable: !kusdt })}
      ${kusdt ? `
        <div class="sk-card"><div class="sk-from-row">
          <span class="tx-meta"><span class="muted tiny">${state.kasIsSendSide ? "Swap From (kUSDT Lands Here)" : "Swap From (KAS Lands Here)"}</span><span class="small">${esc(target ? `${target.label} · ${shortMiddle(target.address)}` : "")}</span></span>
          <button class="bar-text accent strong" data-swap-kusdt-from>Change</button>
        </div></div>
        <div class="sk-card"><div class="sk-from-row"><span class="muted tiny">Rate</span><span class="small ${state.estimate.status === "failed" ? "error-text" : ""}">${esc(rateText())}</span></div></div>
        <a class="muted tiny center-text swap-powered" href="${esc(trestlyTermsUrl())}" target="_blank" rel="noopener noreferrer">Powered by Trestly</a>` : changeNowFormHtml()}`;
  };
  const changeNowFormHtml = () => `
      ${toCoin().ticker !== "kas" ? `<div class="sk-card"><input class="swap-payout" data-swap-payout placeholder="Receive ${esc(toCoin().displayName)} at" value="${esc(state.payoutText)}" autocomplete="off" autocapitalize="off" spellcheck="false" /></div>` : ""}
      ${extraIdName(toCoin()) ? `<div class="sk-card">
        <input class="swap-payout" data-swap-payout-extra placeholder="${esc(extraIdName(toCoin()))} (if the address needs one)" value="${esc(state.payoutExtraText)}" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <span class="muted tiny">An exchange account needs its ${esc(extraIdName(toCoin()))}, or the payout can't reach it.</span>
      </div>` : ""}
      ${!state.kasIsSendSide ? `
        <div class="sk-card"><div class="sk-from-row">
          <span class="tx-meta"><span class="muted tiny">Receiving KAS At</span><span class="mono small">${esc(shortMiddle(payoutAddress()))}</span></span>
          <button class="bar-text accent strong" data-swap-change-address>Change</button>
        </div></div>` : ""}
      <div class="sk-card"><div class="sk-from-row"><span class="muted tiny">Rate</span><span class="small ${state.estimate.status === "failed" ? "error-text" : ""}">${esc(rateText())}</span></div></div>
      ${state.create.result ? resultCard(state.create.result) : ""}
      <a class="muted tiny center-text swap-powered" href="https://changenow.io/terms-of-use/changenow-terms" target="_blank" rel="noopener noreferrer">Powered by ChangeNOW</a>`;
  const historyHtml = () => (state.history.length
    ? `<div class="swap-history">${state.history.map((swap) => `
        <div class="swap-history-item">
          <button class="glass swap-history-row" data-swap-open="${esc(swap.id)}">
            <span class="tx-meta"><span class="strong small">${esc(swap.fromAmount)} ${esc(String(swap.fromTicker).toUpperCase())} → ${esc(fmt8(swap.toAmount))} ${esc(String(swap.toTicker).toUpperCase())}</span><span class="muted tiny">${esc(dateText(swap.createdAt))}</span></span>
            <span class="small strong ${statusClass(swap.status)}">${esc(capitalize(swap.status))}</span>
          </button>
          <button class="icon plain muted" data-swap-delete="${esc(swap.id)}" aria-label="Delete swap">${TRASH}</button>
        </div>`).join("")}</div>`
    : '<p class="muted center-text pad">No swaps yet.</p>');
  // Before You Swap (iOS SwapAgreementsView): both third parties, each with its terms and its own
  // checkbox; Continue once both are checked, Cancel leaves Swap.
  const agreementCardHtml = (kind) => {
    const a = AGREEMENTS[kind];
    const icon = kind === "trestly" ? kusdtCoinIconHtml(30) : `<span class="accent swap-agreement-icon">${SWAP}</span>`;
    const terms = kind === "trestly" ? trestlyTermsUrl() : "https://changenow.io/terms-of-use";
    return `
      <div class="sk-card swap-disclaimer">
        <div class="swap-agreement-head">${icon}<span class="tx-meta"><span class="strong">${esc(a.title)}</span><span class="muted tiny">${esc(a.subtitle)}</span></span></div>
        <p class="small muted">${esc(a.text)}</p>
        <a class="accent strong small" href="${esc(terms)}" target="_blank" rel="noopener noreferrer">${esc(a.termsTitle)}</a>
        <label class="swap-terms"><input type="checkbox" data-swap-terms="${kind}" ${state.checks[kind] ? "checked" : ""} /><span class="small">${esc(a.checkbox)}</span></label>
      </div>`;
  };
  const disclaimerHtml = () => {
    const ready = state.checks.changenow && state.checks.trestly;
    return `
      <div class="swap-agreements">
        <div class="strong center-text">Before You Swap</div>
        <p class="small muted">Swap uses two services K doesn't run. Read and agree to both before you continue.</p>
        ${agreementCardHtml("changenow")}
        ${agreementCardHtml("trestly")}
        <button class="big" data-swap-agree ${ready ? "" : "disabled"}>Continue</button>
        <button class="bar-text muted" data-swap-not-now>Cancel</button>
      </div>`;
  };

  /** The swap page: the form, unless ChangeNOW can't be reached for a ChangeNOW coin - kUSDT still
   *  can be (K-Desktop d570abd renderSwapPage). */
  function swapPageHtml() {
    if (isKusdt() || state.availability === "on") return formHtml();
    const other = `<button class="ghost" data-swap-pick-kusdt>Swap kUSDT Instead</button>
        <button class="bar-text accent strong" data-swap-pick>Choose Another Coin</button>`;
    if (state.availability === "checking") return '<div class="center-text pad"><span class="spinner"></span></div>';
    if (state.availability === "permission") {
      return `<div class="swap-empty"><span class="accent">${SWAP}</span><div class="strong">ChangeNOW Swap</div>
        <p class="muted small">ChangeNOW swaps go through KaChat's server (desktop.kachat.app), which talks to ChangeNOW for you. Allow K to reach it to swap ${esc(state.otherCoin.displayName)}.</p>
        <button class="big" data-swap-allow>Allow</button>${other}</div>`;
    }
    return `<div class="swap-empty"><span class="accent">${SWAP}</span><div class="strong">${esc(SWAP_UNAVAILABLE_TITLE)}</div>
        <p class="muted small">K is not connected to ChangeNOW at the moment, so ${esc(state.otherCoin.displayName)} can't be swapped. Please try again later.</p>
        <button class="ghost" data-swap-retry>Try Again</button>${other}</div>`;
  }
  function bodyHtml() {
    if (!state.agreed) return disclaimerHtml();
    return `
      ${pageCycleHtml([["swap", "Swap"], ["history", "Swap History"]], state.tab, { attr: "data-swap-tab" })}
      <div data-swap-page class="swap-page">${state.tab === "swap" ? swapPageHtml() : historyHtml()}</div>`;
  }

  function drawQrs(root) {
    for (const canvas of root.querySelectorAll("[data-swap-qr]")) drawKaspaQr(canvas, canvas.dataset.swapQr, { dark: "#06110f", light: "#ffffff" }).catch(() => {});
  }
  function paint() {
    if (!handle?.isOpen()) return;
    const host = handle.panel.querySelector("[data-swap]");
    host.innerHTML = bodyHtml();
    drawQrs(host);
  }
  /** Redraws the form around the field being typed in, so it keeps its caret. */
  function paintForm() {
    if (!handle?.isOpen()) return;
    const page = handle.panel.querySelector("[data-swap-page]");
    if (!page || state.tab !== "swap" || (!isKusdt() && state.availability !== "on")) { paint(); return; }
    const active = document.activeElement;
    const field = page.contains(active)
      ? active.dataset?.swapField || (active.matches?.("[data-swap-payout]") ? "payout" : active.matches?.("[data-swap-payout-extra]") ? "payout-extra" : null)
      : null;
    const caret = field ? active.selectionStart : null;
    page.innerHTML = formHtml();
    drawQrs(page);
    if (field) {
      const again = field === "payout" ? page.querySelector("[data-swap-payout]")
        : field === "payout-extra" ? page.querySelector("[data-swap-payout-extra]")
          : page.querySelector(`[data-swap-field="${field}"]`);
      if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch { /* not a text field */ } }
    }
  }

  // --- sheets ---
  const openCoinPicker = () => {
    const expanded = new Set();
    let query = "";
    const sheet = openPanel({ title: "Choose Coin", leading: "Cancel", full: true, stack: true, body: '<div data-coins></div>' });
    const rows = () => {
      // kUSDT first (K iOS 518fdc8c: swapped natively through Trestly's pool)
      const out = [{ kind: "coin", coin: KUSDT_COIN }];
      for (const ticker of PINNED_GROUP_TICKERS) {
        if (!GROUPED_TICKERS[ticker]) continue;
        out.push({ kind: "group", ticker, displayName: GROUPED_TICKERS[ticker] });
        if (expanded.has(ticker)) for (const coin of CURATED_COINS) if (coin.ticker === ticker) out.push({ kind: "network", coin });
      }
      for (const coin of CURATED_COINS) if (!GROUPED_TICKERS[coin.ticker]) out.push({ kind: "coin", coin });
      const q = query.trim().toLowerCase();
      return q ? out.filter((r) => (r.kind === "group" ? `${r.displayName} ${r.ticker}` : `${r.coin.displayName} ${r.coin.ticker}`).toLowerCase().includes(q)) : out;
    };
    const draw = () => {
      const host = sheet.panel.querySelector("[data-coins]");
      const focused = document.activeElement?.matches?.("[data-coin-search]");
      host.innerHTML = `
        <label class="ab-search"><span class="muted">${ICONS.search}</span><input data-coin-search placeholder="Search coins" value="${esc(query)}" autocomplete="off" /></label>
        <div class="swap-coins">${rows().map((r) => r.kind === "group"
          ? `<button class="swap-coin-row" data-coin-group="${esc(r.ticker)}">${coinIcon(CURATED_COINS.find((c) => c.ticker === r.ticker))}<span class="swap-coin-name">${esc(r.displayName)}</span>${state.otherCoin.ticker === r.ticker ? '<span class="accent">✓</span>' : ""}<span class="muted">${CHEVRON_DOWN}</span></button>`
          : `<button class="swap-coin-row ${r.kind === "network" ? "indented" : ""}" data-coin="${esc(`${r.coin.ticker}:${r.coin.network}`)}">${coinIcon(r.coin)}<span class="swap-coin-name">${esc(r.coin.displayName)}</span>${sameCoin(r.coin, state.otherCoin) ? '<span class="accent">✓</span>' : ""}</button>`).join("")}</div>`;
      const input = host.querySelector("[data-coin-search]");
      input.oninput = () => { query = input.value; draw(); };
      if (focused) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      for (const b of host.querySelectorAll("[data-coin-group]")) b.onclick = () => { const t = b.dataset.coinGroup; if (expanded.has(t)) expanded.delete(t); else expanded.add(t); draw(); };
      for (const b of host.querySelectorAll("[data-coin]")) {
        b.onclick = () => {
          const picked = coinByKey(b.dataset.coin);
          sheet.close();
          // a tag typed for one coin is never sent with another (setOtherCoin)
          if (picked) { setOtherCoin(picked); paint(); }
        };
      }
    };
    draw();
    sheet.panel.querySelector("[data-coin-search]")?.focus();
  };

  // Choose Address (iOS SwapAddressPickerView): unused legacy addresses only - a payout to a used
  // one ties this swap to everything that address did - or a new one.
  const openAddressPicker = async () => {
    const sheet = showSheet({ title: "Choose Address", headerHtml: '<div class="center-text"><span class="spinner small-spin"></span></div>', rows: [] });
    let list;
    try { list = await wallet.spendingList(); } catch { sheet.close(); return; }
    const candidates = list.rows.filter((r) => !r.quantum && !r.hidden);
    const used = await Promise.all(candidates.map((r) => (r.balanceSompi > 0n ? true : wallet.knownUsedState(r.address).catch(() => null))));
    const rows = [{
      label: "Generate New Address", subtitle: "The next address you have never used.",
      onClick: async () => { state.payoutOverride = null; state.nextPayout = await wallet.nextSwapPayoutAddress().catch(() => state.nextPayout); paintForm(); },
    }];
    candidates.forEach((r, i) => {
      if (used[i] === true) return;
      rows.push({ label: r.label, subtitle: `${shortMiddle(r.address)}${used[i] === false ? " · Unused" : ""}`, onClick: () => { state.payoutOverride = { index: r.index, address: r.address }; paintForm(); } });
    });
    sheet.update({
      headerHtml: '<p class="muted tiny pad-x">A swap pays out to an address you have not used before, so the payout cannot be tied to your earlier activity.</p>',
      rows,
    });
  };

  // Swap From (K iOS KusdtSwapFromPicker): where a kUSDT swap trades from, and lands.
  const openKusdtFromPicker = async () => {
    const sheet = showSheet({ title: "Swap From", headerHtml: '<div class="center-text"><span class="spinner small-spin"></span></div>', rows: [] });
    let choices = [];
    try { choices = await kusdtFromChoices(); } catch { choices = []; }
    const current = kusdtTarget()?.address;
    sheet.update({
      headerHtml: '<p class="muted tiny pad-x">The swap\'s KAS and kUSDT both stay on this address.</p>',
      rows: choices.map((c) => ({
        label: `${c.address === current ? "✓ " : ""}${c.label}`,
        subtitle: `${shortMiddle(c.address)} · ${c.kasSompi == null ? "--" : kasAmountLabel(c.kasSompi)} · ${formatKusdt(c.units ?? 0n)}`,
        onClick: () => {
          state.kusdtFrom = c.spendingIndex == null ? null : { label: c.label, address: c.address, spendingIndex: c.spendingIndex };
          reschedule();
          refreshKusdtBalances();
        },
      })),
    });
  };

  const openDetails = (id) => {
    const swap = state.history.find((s) => s.id === id);
    if (!swap) return;
    const sheet = openPanel({ title: "Swap Details", leading: "Done", full: true, stack: true, body: '<div data-details class="swap-details"></div>' });
    const draw = (refreshing = false) => {
      const host = sheet.panel.querySelector("[data-details]");
      host.innerHTML = `
        <div class="sk-card swap-result">
          <span class="strong small">${esc(swap.fromAmount)} ${esc(String(swap.fromTicker).toUpperCase())} → ${esc(fmt8(swap.toAmount))} ${esc(String(swap.toTicker).toUpperCase())}</span>
          <span class="muted tiny">${esc(dateText(swap.createdAt))}</span>
          <canvas class="swap-qr" data-swap-qr="${esc(swap.payinAddress)}" width="180" height="180"></canvas>
        </div>
        <div class="sk-label">Deposit Address</div>
        <div class="sk-card"><button class="mono tiny swap-mono" data-swap-copy="${esc(swap.payinAddress)}">${esc(swap.payinAddress)}</button></div>
        ${swap.payinExtraId ? `<div class="sk-label">Deposit ${esc(swap.payinExtraIdName || "Extra ID")}</div>
        <div class="sk-card swap-result">${payinExtraHtml(swap.payinExtraIdName || "Extra ID", swap.payinExtraId)}</div>` : ""}
        ${swap.payoutExtraId ? `<div class="sk-label">Payout ${esc(swap.payoutExtraIdName || "Extra ID")}</div>
        <div class="sk-card"><button class="mono tiny swap-mono" data-swap-copy-extra="${esc(swap.payoutExtraId)}" data-swap-extra-name="${esc(swap.payoutExtraIdName || "Extra ID")}">${esc(swap.payoutExtraId)}</button></div>` : ""}
        <div class="sk-label">Status</div>
        <div class="sk-card"><div class="sk-from-row"><span class="strong ${statusClass(swap.status)}">${esc(capitalize(swap.status))}</span>${swap.status === "finished" ? '<button class="bar-text accent strong" data-swap-portfolio>Add to Portfolio</button>' : ""}</div></div>
        <div class="sk-label">ChangeNOW Exchange ID</div>
        <div class="sk-card"><button class="mono tiny swap-mono" data-swap-copy-id="${esc(swap.id)}">${esc(swap.id)}</button></div>
        <div class="swap-links">
          <button class="bar-text accent strong" data-swap-refresh-detail ${refreshing ? "disabled" : ""}>${refreshing ? '<span class="spinner small-spin"></span>' : "Refresh Status"}</button>
          <a class="bar-text accent strong" href="https://changenow.io/exchange/txs/${encodeURIComponent(swap.id)}" target="_blank" rel="noopener noreferrer">View on ChangeNOW</a>
        </div>`;
      drawQrs(host);
      bindCopies(host);
      host.querySelector("[data-swap-refresh-detail]").onclick = async () => {
        draw(true);
        const status = await refreshStatus(swap.id);
        toast(status ? `Status: ${capitalize(status)}` : "Couldn't reach ChangeNOW - try again");
        if (sheet.isOpen()) draw(false);
        paint();
      };
      const add = host.querySelector("[data-swap-portfolio]");
      if (add) add.onclick = () => addToPortfolio(swap);
    };
    draw();
  };

  // Add to Portfolio (iOS 9df2847): pick the portfolio; one that already holds this swap says so.
  const addToPortfolio = async (swap) => {
    const prefill = portfolioPrefill(swap);
    if (!prefill) { toast("Couldn't read this swap's amounts"); return; }
    const core = await import("./portfolio-core.js");
    await core.loadStore();
    const sourceTxId = swapSourceTxId(swap.id);
    const holding = new Set(core.portfolioIdsContaining(sourceTxId));
    showSheet({
      title: "Add to Portfolio",
      headerHtml: `<p class="muted tiny pad-x">${esc(`${prefill.type === "buy" ? "Buy" : "Sell"} ${prefill.amountKas.toFixed(8)} KAS at ${core.currencySymbol()}${prefill.fiatValue.toFixed(2)} - choose which portfolio to add it to.`)}</p>`,
      rows: core.portfolios().map((p) => ({
        label: p.name,
        subtitle: holding.has(p.id) ? "Already holds this swap - adding it again double-counts it." : "The swap lands in this portfolio.",
        onClick: async () => {
          await core.addTransaction({ ...prefill, portfolioId: p.id, sourceTxId });
          swap.addedToPortfolio = true;
          saveHistory();
          toast(`Added to ${p.name}`);
        },
      })),
    });
  };

  function bindCopies(root) {
    for (const b of root.querySelectorAll("[data-swap-copy]")) b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.swapCopy); toast("Address copied to clipboard."); } catch { /* refused */ } };
    for (const b of root.querySelectorAll("[data-swap-copy-id]")) b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.swapCopyId); toast("Exchange ID copied"); } catch { /* refused */ } };
    for (const b of root.querySelectorAll("[data-swap-copy-extra]")) b.onclick = () => copyExtra(b);
  }
  async function copyExtra(button) {
    try { await navigator.clipboard.writeText(button.dataset.swapCopyExtra); toast(`${button.dataset.swapExtraName || "Extra ID"} copied`); } catch { /* refused */ }
  }

  handle = openPanel({ title: "Swap", leading: "Done", full: true, body: '<div data-swap class="swap-root"></div>', onClose: () => { clearTimeout(estimateTimer); answerApproval(false); } });
  const root = handle.panel.querySelector("[data-swap]");
  root.addEventListener("input", (event) => {
    const field = event.target.closest("[data-swap-field]");
    if (field) {
      if (field.readOnly) return;
      const value = field.value.trim();
      if (field.dataset.swapField === "send") { state.amountText = value; state.editedSide = "send"; state.receiveAmountText = ""; }
      else { state.receiveAmountText = value; state.editedSide = "get"; state.amountText = ""; }
      reschedule();
      return;
    }
    if (event.target.closest("[data-swap-payout]")) state.payoutText = event.target.value;
    if (event.target.closest("[data-swap-payout-extra]")) state.payoutExtraText = event.target.value;
  });
  root.addEventListener("change", (event) => {
    const terms = event.target.closest("[data-swap-terms]");
    if (terms) { state.checks[terms.dataset.swapTerms] = terms.checked; paint(); }
  });
  root.addEventListener("click", async (event) => {
    const t = event.target;
    if (t.closest("[data-swap-allow]")) {
      let granted = false;
      try { granted = await ext.permissions.request(RELAY_PERMISSION); } catch { granted = false; }
      if (granted) { state.availability = "checking"; paint(); probe(); }
      return;
    }
    if (t.closest("[data-swap-retry]")) { state.availability = "checking"; paint(); probe(); return; }
    if (t.closest("[data-swap-agree]")) {
      if (!state.checks.changenow || !state.checks.trestly) return;
      state.agreed = true;
      write(AGREEMENTS_KEY, true);
      paint();
      reschedule();
      return;
    }
    if (t.closest("[data-swap-not-now]")) { handle.close(); return; }
    const tabButton = t.closest("[data-swap-tab]");
    if (tabButton) { state.tab = tabButton.dataset.swapTab; paint(); return; }
    if (t.closest("[data-swap-flip]")) {
      state.kasIsSendSide = !state.kasIsSendSide;
      state.payoutExtraText = "";
      clearCreated();
      clearQuoted();
      // kUSDT quotes from what is sent, in that coin's units: the figure typed for the other coin goes
      if (isKusdt()) { state.amountText = ""; state.receiveAmountText = ""; state.editedSide = "send"; }
      reschedule();
      refreshKusdtBalances();
      return;
    }
    if (t.closest("[data-swap-max]")) { setMaxAmount(); return; }
    if (t.closest("[data-swap-pick-kusdt]")) { setOtherCoin(KUSDT_COIN); paint(); return; }
    if (t.closest("[data-swap-kusdt-from]")) { openKusdtFromPicker(); return; }
    if (t.closest("[data-swap-create]")) { execute(); return; }
    if (t.closest("[data-swap-pick]")) { openCoinPicker(); return; }
    if (t.closest("[data-swap-change-address]")) { openAddressPicker(); return; }
    const refresh = t.closest("[data-swap-refresh]");
    if (refresh) {
      const status = await refreshStatus(refresh.dataset.swapRefresh);
      toast(status ? `Status: ${capitalize(status)}` : "Couldn't reach ChangeNOW - try again");
      paintForm();
      return;
    }
    const open = t.closest("[data-swap-open]");
    if (open) { openDetails(open.dataset.swapOpen); return; }
    const del = t.closest("[data-swap-delete]");
    if (del) {
      showAlert({
        title: "Delete this swap?",
        message: "This only removes it from your local history - it doesn't affect the actual exchange.",
        confirmLabel: "Delete", cancelLabel: "Cancel",
        onConfirm: () => { state.history = state.history.filter((s) => s.id !== del.dataset.swapDelete); saveHistory(); paint(); },
      });
      return;
    }
    const copy = t.closest("[data-swap-copy]");
    if (copy) { try { await navigator.clipboard.writeText(copy.dataset.swapCopy); toast("Address copied to clipboard."); } catch { /* refused */ } return; }
    const copyId = t.closest("[data-swap-copy-id]");
    if (copyId) { try { await navigator.clipboard.writeText(copyId.dataset.swapCopyId); toast("Exchange ID copied"); } catch { /* refused */ } return; }
    const copyExtraId = t.closest("[data-swap-copy-extra]");
    if (copyExtraId) copyExtra(copyExtraId);
  });
  paint();
  refreshKusdtBalances();
  wallet.nextSwapPayoutAddress().then((next) => { state.nextPayout = next; paintForm(); }).catch(() => {});
  probe();
}
