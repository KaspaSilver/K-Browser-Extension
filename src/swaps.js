// Buy and Sell - K iOS 824a30bb SwapView / SwapService (K 5.4), after K-Desktop 32c457c ui/swaps.js,
// in the extension's panels: ChangeNOW for coins on other networks, and kUSDT natively through
// Trestly's pool on Kaspa (src/swap-kusdt.js, shared/engine/kusdt-trade.js). Code names stay Swap.
//
// Step by step, as K's SwapView goes since 2026-11-26 (owner): the Wallet's Buy and Sell buttons and
// its Buy/Sell History card each open their own start.
// - Buy: "What do you want to pay with?" (kUSDT, then USD Coin and Tether folded by network, then
//   the rest), "Where should your Kaspa land?" (a fresh address, the default, or one of yours, the
//   Chatting Address too; with kUSDT, the address that pays, since Trestly's trade lands its Kaspa
//   on the same one), then the order.
// - Sell: "What do you want for your Kaspa?", then the order.
// - The order: You Pay / You Get, either typed (kUSDT: You Pay only), no flip, no coin picker, and
//   its Buy Kaspa / Sell Kaspa button. A ChangeNOW order goes on to its deposit screen (the QR, the
//   address, the amount, the tag if needed, Send KAS from K when Kaspa goes in, the transaction ID),
//   checked every 10 s while it shows, then Purchase / Sale Complete with Add to Portfolio. A kUSDT
//   order ends on Order Sent.
// - ChangeNOW: nothing is sent automatically. Whichever coin is given up, the person pays it into
//   the ChangeNOW deposit address themselves (a QR). Buying KAS pays out to the next never-used
//   LEGACY spending address by default, so exchange-received coins can't be chain-linked to
//   everyday spending.
// - kUSDT: Trestly's pinned code quotes (`prepare`, no key), the approval sheet shows the trade, and
//   only on Approve is the address's key handed to their `execute`. The approval is the
//   confirmation, as a kUSDT send's is: no password.
// Before the first step, both third parties' agreements (iOS SwapAgreementsView: ChangeNOW's and
// Trestly's, one box each, Continue once both are checked), per chatting address.
//
// The ChangeNOW API key never ships in the extension: every call goes to KaChat-Desktop's hosted
// relay (desktop.kachat.app/nc-proxy/), which adds the server's key to the four swap calls only
// (owner, 2026-10-23). Each call names this extension's ID (x-kachat-extension); the relay takes it
// only from an ID on its KAPAY_EXTENSION_IDS list (KaChat-Desktop Build 261). Until this ID is
// listed, or when the server has no key, Swap says "Swap is not available right now".

import { esc, toast, showSheet, showAlert, ICONS } from "./ui.js";
import { stepQuestionHtml, stepNoteHtml, choicePillsHtml, mountOwnAddressList } from "./send-steps.js";
import { sompiFromUserText } from "./amounts.js";
import { groupAmountInputsIn } from "./grouped-amount.js";
import { kusdtCoinIconHtml } from "./kusdt-icons.js";
import { openPanel } from "./kachat-ui.js";
import { ext } from "./browser.js";
import * as wallet from "./wallet.js";
import * as vault from "./vault.js";
import { drawKaspaQr } from "../shared/engine/qr.js";
import {
  KAS, KUSDT_COIN, CURATED_COINS, USDC_POLYGON, GROUPED_TICKERS, PINNED_GROUP_TICKERS, SWAP_UNAVAILABLE_TITLE,
  sameCoin, isTrestlyCoin, coinByKey, cleanSwapAmount, createChangeNowClient, createSwapQuoter, rateLine, portfolioPrefill,
  swapSourceTxId, displayTicker, kusdtSwapHistoryEntry,
} from "../shared/ui/swap-quote.js";
import { getEndpoint } from "../shared/engine/endpoints.js";
import {
  quoteKusdtSwap, kusdtSwapAmountIn, kusdtQuoteText, kusdtRateText, minimumOut, swapRecord as kusdtSwapRecord, TRADE_CODE,
  tradeUnits, kasAmountLabel,
} from "../shared/engine/kusdt-trade.js";
import { formatKusdt, typedKusdt, KUSDT_TOKEN } from "../shared/engine/kusdt.js";
import { approvalRows, approvalWarnings, approvalBlocked, APPROVE_ARM_MS, APPROVAL_TEXT } from "../shared/ui/swap-approval.js";
import { kusdt, kusdtListedIndices } from "./kusdt.js";
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
/** "10 KAS → 1.25 kUSDT": a kUSDT swap's amounts are as typed, a ChangeNOW quote to 8 places. */
const historyLine = (swap) => `${esc(swap.fromAmount)} ${esc(displayTicker(swap.fromTicker))} → ${esc(swap.provider === "trestly" ? swap.toAmount : fmt8(swap.toAmount))} ${esc(displayTicker(swap.toTicker))}`;
/** Which service ran it (K b49a021d): kUSDT swaps go through Trestly's pool on Kaspa. */
const providerName = (swap) => (swap.provider === "trestly" ? "Trestly" : "ChangeNOW");
/** A swap that has ended one way or another: nothing more to ask ChangeNOW (K d88891ea). */
const SWAP_END_STATES = new Set(["finished", "failed", "refunded", "expired"]);
/** Whether the network accepted a transaction: true, false (the REST API doesn't know it) or null
 *  (no answer). A kUSDT swap's Refresh Status asks this, never ChangeNOW (K b49a021d, K-Desktop 1cbe77e). */
async function transactionAccepted(txId) {
  const base = String(getEndpoint("kaspaApi") || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base) || !/^[0-9a-fA-F]{64}$/.test(String(txId || ""))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${base}/transactions/${encodeURIComponent(txId)}?inputs=false&outputs=false&resolve_previous_outpoints=no`, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (response.status === 404) return false;
    if (response.status !== 200) return null;
    return (await response.json())?.is_accepted === true;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Opens Buy/Sell at `start` ("buy", "sell" or "history"; K SwapView Start). `coin` ("kusdt", or
 *  "ticker:network") goes straight to the order for that coin, and `buying` (KAS under You Pay)
 *  makes it a sell of Kaspa (Send kUSDT's "Swap for kUSDT", after K-Desktop selectSwapCoin: with no
 *  kUSDT held, selling Kaspa for it is the side that can go ahead). `deposit`: a ChangeNOW order's id,
 *  opened on its deposit screen (back from Send KAS from K). */
export async function showSwap({ start = "buy", coin = null, buying = false, deposit = null } = {}) {
  const main = (await wallet.cachedAddresses((await vault.readAccounts()).activeAccountId))?.main || "";
  const scoped = (key) => `${key}:${String(main).toLowerCase()}`;
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(scoped(key)) ?? "null") ?? fallback; } catch { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(scoped(key), JSON.stringify(value)); } catch { /* storage blocked */ } };

  const picked = coin === "kusdt" ? KUSDT_COIN : coinByKey(coin);
  const state = {
    availability: "checking", // checking | on | off | permission
    agreed: read(AGREEMENTS_KEY, false) === true,
    checks: { changenow: false, trestly: false },
    // Where the screen is (K SwapView Start + its path): the start, then the steps after it,
    // { kind: "destination" | "form" | "deposit" | "complete" | "kusdtDone", id?, message? }.
    flowStart: ["buy", "sell", "history"].includes(start) ? start : "buy",
    flowPath: [],
    coinQuery: "",            // the coin step's search
    coinExpanded: new Set(),  // the folded tickers opened there
    destination: "fresh",     // the "where" step: "fresh" | "chosen"
    kusdtDestinations: null,  // that step's kUSDT addresses, once read
    kasIsSendSide: buying === true,
    otherCoin: picked || USDC_POLYGON,
    amountText: "", receiveAmountText: "", editedSide: "send",
    payoutText: "",
    payoutExtraText: "",      // the payout's destination tag / memo, for a coin that has one
    payoutOverride: null,     // { index, address } picked instead of the next legacy slot (index null: the Chatting Address)
    nextPayout: null,         // { index, address }
    estimate: { status: "idle" },
    create: { status: "idle", result: null },
    kusdtFrom: null,          // { label, address, spendingIndex }: the Chatting Address unless picked
    kusdtQuote: null,         // { quote, amountIn, buying, address }: what the order approves
    kusdtFromKas: null,       // { address, sompi }: the Swap From address's KAS (K iOS 6b99c6dd)
    history: (() => { const h = read(HISTORY_KEY, []); return Array.isArray(h) ? h : []; })(),
  };
  state.history.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  if (picked) {
    state.flowStart = buying ? "sell" : "buy";
    state.flowPath = [{ kind: buying ? "form" : "destination" }];
  }
  if (deposit && state.history.some((x) => x.id === deposit)) {
    state.flowStart = "history";
    const finished = String(state.history.find((x) => x.id === deposit).status || "").toLowerCase() === "finished";
    state.flowPath = [{ kind: finished ? "complete" : "deposit", id: deposit }];
  }
  const saveHistory = () => { state.history.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)); write(HISTORY_KEY, state.history); };
  /** A kUSDT swap goes into Buy/Sell History with the ChangeNOW ones (K b49a021d recordKusdtSwap):
   *  its Kaspa txid is its id, the address it traded from, Finished or Sending. */
  const recordKusdtSwap = (record, address) => {
    if (!record?.txid || record.amountIn == null || record.amountOut == null) return;
    if (state.history.some((s) => s.id === record.txid)) return;
    const entry = kusdtSwapHistoryEntry({
      txid: record.txid, bought: record.bought, confirmed: record.confirmed,
      kasText: typedKas(BigInt(record.bought ? record.amountIn : record.amountOut)),
      kusdtText: typedKusdt(BigInt(record.bought ? record.amountOut : record.amountIn)),
      address,
    });
    if (!entry) return;
    state.history.unshift(entry);
    saveHistory();
  };
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
  /** Reads the Swap From address's KAS: what it can spend now (K-Desktop d115548: covenant-bound,
   *  held and just-spent coins can't go; kUSDT coins live at the token's own script address). */
  const refreshKusdtBalances = async () => {
    const address = isKusdt() ? kusdtTarget()?.address : null;
    if (!address) return;
    // the kUSDT side: what Manage kUSDT knows, looked up again when it's old
    kusdtHoldingsFresh().then(() => paintForm()).catch(() => {});
    let sompi = null;
    try { sompi = await wallet.spendableSompiAt(address); } catch { sompi = null; }
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
          address = state.payoutOverride?.address || (await wallet.reserveSwapPayoutAddress(state.nextPayout || null, { skip: kusdtListedIndices() })).address;
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
      state.destination = "fresh";
      state.nextPayout = await wallet.nextSwapPayoutAddress({ skip: kusdtListedIndices() }).catch(() => null);
      // its deposit screen (K: a ChangeNOW exchange made goes on to SwapDepositScreen)
      if (currentStep().kind === "form") { state.flowPath.push({ kind: "deposit", id: String(response.id) }); paint(); return; }
      toast("Order made. It's in Buy/Sell History.");
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
      // and in Buy/Sell History, with the ChangeNOW orders (K b49a021d)
      try { recordKusdtSwap(record, target.address); } catch { /* the history's own problem */ }
      // The address's KAS and kUSDT moved: read again after each of the wallet's lookups, which
      // follow the trade until its coins show (K 961fc05a TokenWallet.followTrade, K-Desktop
      // 9c30208); a trade with no txid gets one look.
      const txid = typeof done?.result?.txid === "string" ? done.result.txid : null;
      if (txid) kusdt().followTrade(txid, { onLook: () => { if (handle?.isOpen()) refreshKusdtBalances(); } });
      else setTimeout(() => { if (handle?.isOpen()) refreshKusdtBalances(); }, 4500);
      state.amountText = ""; state.receiveAmountText = ""; state.kusdtQuote = null;
      state.estimate = { status: "idle" };
      state.create = { status: "idle", result: null };
      // its own screen (K SwapSentScreen), from the order page
      if (currentStep().kind === "form") { state.flowPath.push({ kind: "kusdtDone", message: record?.text || "Swap sent" }); paint(); return; }
      toast(record?.text || "Swap sent");
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
    // a kUSDT swap asks the network whether its transaction was accepted (K b49a021d)
    const trestly = state.history.find((s) => s.id === id && s.provider === "trestly");
    if (trestly) {
      const accepted = await transactionAccepted(id);
      if (accepted == null) return null;
      if (accepted && trestly.status !== "finished") { trestly.status = "finished"; saveHistory(); }
      return trestly.status;
    }
    try {
      const status = (await client.status(id))?.status || null;
      if (!status) return null;
      const swap = state.history.find((s) => s.id === id);
      // saved only when it moved (K d88891ea)
      if (swap && swap.status !== status) { swap.status = status; saveHistory(); }
      if (state.create.result?.id === id) state.create.result = { ...state.create.result, status };
      return status;
    } catch (error) {
      unavailable(error);
      return null;
    }
  };

  // --- rendering ---
  /** A card that isn't `editable` shows the quote (kUSDT's You Get: the pool quotes from what you
   *  send). The coin was picked on its own step (K 824a30bb): no picker here. */
  const amountCard = ({ label, coin, value, field, quoting, editable = true, available = null, max = false }) => `
    <div class="sk-card swap-card">
      <div class="swap-card-head"><span class="sk-label">${esc(label)}</span>${available ? `<span class="muted tiny swap-available">Available: ${esc(available)}</span>` : ""}</div>
      <div class="swap-card-row">
        ${quoting ? '<span class="swap-quoting"><span class="spinner small-spin"></span></span>'
          : `<input class="swap-amount" type="text" inputmode="decimal" placeholder="0.00" aria-label="${esc(label)}" data-swap-field="${field}" value="${esc(value)}" autocomplete="off"${editable ? "" : ' readonly tabindex="-1"'} />`}
        ${max ? '<button type="button" class="bar-text accent strong swap-max" data-swap-max>Max</button>' : ""}
        <span class="swap-badge">${coinIcon(coin)}<span>${esc(coin.displayName)}</span></span>
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
  /** The order (K 824a30bb): You Pay / You Get, the payout when selling, the Swap From address on a
   *  kUSDT sell, the rate, then Buy Kaspa / Sell Kaspa. */
  const formHtml = () => {
    const busy = state.create.status === "creating";
    const loading = state.estimate.status === "loading";
    const kusdt = isKusdt();
    const canSwap = state.estimate.status === "success" && !busy && (!kusdt || state.kusdtQuote != null);
    const target = kusdt ? kusdtTarget() : null;
    return `
      ${amountCard({ label: "You Pay", coin: fromCoin(), value: state.amountText, field: "send", quoting: state.editedSide === "get" && loading, available: kusdtAvailableText(), max: (kusdtMaxSend() ?? 0n) > 0n })}
      ${kusdt && state.kasIsSendSide ? `<p class="muted tiny swap-max-note">${esc(MAX_KEEPS_NOTE)}</p>` : ""}
      ${amountCard({ label: "You Get", coin: toCoin(), value: state.receiveAmountText, field: "get", quoting: state.editedSide === "send" && loading, editable: !kusdt })}
      ${kusdt ? `
        ${state.kasIsSendSide ? `<div class="sk-card"><div class="sk-from-row">
          <span class="tx-meta"><span class="muted tiny">Swap From (kUSDT Lands Here)</span><span class="small">${esc(target ? `${target.label} · ${shortMiddle(target.address)}` : "")}</span></span>
          <button class="bar-text accent strong" data-swap-kusdt-from>Change</button>
        </div></div>` : ""}
        <div class="sk-card"><div class="sk-from-row"><span class="muted tiny">Rate</span><span class="small ${state.estimate.status === "failed" ? "error-text" : ""}">${esc(rateText())}</span></div></div>` : changeNowFormHtml()}
      <button class="big swap-go" data-swap-create ${canSwap ? "" : "disabled"}>${busy ? '<span class="spinner small-spin"></span>' : state.kasIsSendSide ? "Sell Kaspa" : "Buy Kaspa"}</button>
      ${kusdt
        ? `<a class="muted tiny center-text swap-powered" href="${esc(trestlyTermsUrl())}" target="_blank" rel="noopener noreferrer">Powered by Trestly</a>`
        : '<a class="muted tiny center-text swap-powered" href="https://changenow.io/terms-of-use/changenow-terms" target="_blank" rel="noopener noreferrer">Powered by ChangeNOW</a>'}`;
  };
  const changeNowFormHtml = () => `
      ${toCoin().ticker !== "kas" ? `<div class="sk-card"><input class="swap-payout" data-swap-payout placeholder="Receive ${esc(toCoin().displayName)} at" value="${esc(state.payoutText)}" autocomplete="off" autocapitalize="off" spellcheck="false" /></div>` : ""}
      ${extraIdName(toCoin()) ? `<div class="sk-card">
        <input class="swap-payout" data-swap-payout-extra placeholder="${esc(extraIdName(toCoin()))} (if the address needs one)" value="${esc(state.payoutExtraText)}" autocomplete="off" autocapitalize="off" spellcheck="false" />
        <span class="muted tiny">An exchange account needs its ${esc(extraIdName(toCoin()))}, or the payout can't reach it.</span>
      </div>` : ""}
      <div class="sk-card"><div class="sk-from-row"><span class="muted tiny">Rate</span><span class="small ${state.estimate.status === "failed" ? "error-text" : ""}">${esc(rateText())}</span></div></div>`;
  const historyHtml = () => (state.history.length
    ? `<div class="swap-history">${state.history.map((swap) => `
        <div class="swap-history-item">
          <button class="glass swap-history-row" data-swap-open="${esc(swap.id)}">
            <span class="tx-meta"><span class="strong small">${historyLine(swap)}</span><span class="muted tiny">${esc(dateText(swap.createdAt))} · ${esc(providerName(swap))}</span></span>
            <span class="small strong ${statusClass(swap.status)}">${esc(capitalize(swap.status))}</span>
          </button>
          <button class="icon plain muted" data-swap-delete="${esc(swap.id)}" aria-label="Delete order">${TRASH}</button>
        </div>`).join("")}</div>`
    : '<p class="muted center-text pad">No orders yet.</p>');

  // --- the steps (K SwapView Start + path) ---
  const currentStep = () => (state.flowPath.length ? state.flowPath[state.flowPath.length - 1] : { kind: state.flowStart });
  const stepTitle = (step) => {
    switch (step.kind) {
      case "buy": case "destination": return "Buy Kaspa";
      case "sell": return "Sell Kaspa";
      case "history": return "Buy/Sell History";
      case "form": return state.kasIsSendSide ? `Sell Kaspa for ${state.otherCoin.displayName}` : `Buy Kaspa with ${state.otherCoin.displayName}`;
      case "deposit": return "Send Payment";
      case "complete": return state.history.find((x) => x.id === step.id)?.toTicker === "kas" ? "Purchase Complete" : "Sale Complete";
      case "kusdtDone": return "Order Sent";
      default: return "Buy/Sell";
    }
  };
  /** A deposit, a completion and Order Sent are finished: no Back, only Done. */
  const finishedStep = (step) => step.kind === "deposit" || step.kind === "complete" || step.kind === "kusdtDone";

  /** What to pay with (Buy) or what to get (Sell), K SwapCoinChoiceList: kUSDT, then USD Coin and
   *  Tether folded by network, then the rest; search, since the list is long. */
  const coinChoiceRows = () => {
    const every = [KUSDT_COIN, ...PINNED_GROUP_TICKERS.flatMap((t) => CURATED_COINS.filter((c) => c.ticker === t)),
      ...CURATED_COINS.filter((c) => !GROUPED_TICKERS[c.ticker])];
    const query = state.coinQuery.trim().toLowerCase();
    if (query) {
      return every.filter((c) => c.displayName.toLowerCase().includes(query) || c.ticker.toLowerCase().includes(query)).map((coin) => ({ kind: "coin", coin }));
    }
    const rows = [];
    const seen = new Set();
    for (const c of every) {
      const siblings = every.filter((x) => x.ticker === c.ticker);
      if (GROUPED_TICKERS[c.ticker] && siblings.length > 1 && !isTrestlyCoin(c)) {
        if (seen.has(c.ticker)) continue;
        seen.add(c.ticker);
        rows.push({ kind: "group", ticker: c.ticker, count: siblings.length, coin: c });
        if (state.coinExpanded.has(c.ticker)) for (const x of siblings) rows.push({ kind: "network", coin: x });
      } else rows.push({ kind: "coin", coin: c });
    }
    return rows;
  };
  const coinSymbol = (c) => (isTrestlyCoin(c) ? "kUSDT" : c.ticker.toUpperCase());
  const coinChoiceListHtml = () => coinChoiceRows().map((row) => {
    if (row.kind === "group") {
      const open = state.coinExpanded.has(row.ticker);
      return `<button type="button" class="glass swap-choice-row" data-swap-choice-group="${esc(row.ticker)}" aria-expanded="${open}">
          ${coinIcon(row.coin)}<span class="tx-meta swap-choice-copy"><span class="strong small">${esc(GROUPED_TICKERS[row.ticker])}</span><span class="muted tiny">${esc(`${row.ticker.toUpperCase()} on ${row.count} networks`)}</span></span>
          <span class="muted swap-choice-chevron${open ? " open" : ""}">${CHEVRON_DOWN}</span>
        </button>`;
    }
    const c = row.coin;
    return `<button type="button" class="glass swap-choice-row${row.kind === "network" ? " indented" : ""}" data-swap-choice="${esc(isTrestlyCoin(c) ? "kusdt" : `${c.ticker}:${c.network}`)}">
        ${coinIcon(c)}<span class="tx-meta swap-choice-copy"><span class="strong small">${esc(c.displayName)}</span><span class="muted tiny">${esc(coinSymbol(c))}</span></span>
        <span class="muted">${ICONS.chevron}</span>
      </button>`;
  }).join("");
  const coinChoiceHtml = (question) => `
    <div class="swap-step">
      ${stepQuestionHtml(question)}
      <label class="ab-search"><span class="muted">${ICONS.search}</span><input data-swap-choice-search placeholder="Search coins" value="${esc(state.coinQuery)}" autocomplete="off" /></label>
      <div class="swap-choice-list" data-swap-choice-list>${coinChoiceListHtml()}</div>
    </div>`;

  /** Buying: "Where should your Kaspa land?" (K SwapDestinationStep). Through ChangeNOW: a fresh
   *  address (the default: the purchase stays apart from your username and chats) or one of yours,
   *  the Chatting Address too. With kUSDT: the Chatting Address or an address holding kUSDT, which
   *  pays and receives the Kaspa. */
  const destinationHtml = () => {
    if (isKusdt()) {
      const choices = state.kusdtDestinations;
      const current = kusdtTarget()?.address;
      const rows = (choices || []).map((c, i) => {
        const on = c.address === current;
        return `<button type="button" class="ss-source-row${on ? " current" : ""}" data-swap-dest-kusdt="${i}" aria-pressed="${on}">
            <span class="ss-source-copy"><span class="ss-source-name"><span class="ellipsis">${esc(c.label)}</span></span><span class="mono tiny muted">${esc(shortMiddle(c.address))}</span></span>
            <span class="ss-source-balance">${esc(formatKusdt(c.units ?? 0n))}</span>
            <span class="ss-source-check" aria-hidden="true">${on ? ICONS.checkmark : ""}</span>
          </button>`;
      }).join("");
      return `
        <div class="swap-step">
          ${stepQuestionHtml("Where should your Kaspa land?")}
          ${stepNoteHtml("kUSDT is paid from one address, and your Kaspa lands on that same address.")}
          <div class="ss-address-list">${choices ? rows : '<div class="ss-list-loading"><span class="spinner"></span></div>'}</div>
          <button class="big" data-swap-continue>Continue</button>
        </div>`;
    }
    const choosing = state.destination === "chosen";
    const fresh = state.nextPayout?.address || "";
    return `
      <div class="swap-step">
        ${stepQuestionHtml("Where should your Kaspa land?")}
        ${choicePillsHtml([
          { id: "swap-dest-fresh", title: "Fresh Address", on: !choosing },
          { id: "swap-dest-choose", title: "Choose an Address", on: choosing },
        ])}
        ${choosing ? '<div data-swap-dest-list></div>' : `<div class="sk-card swap-dest-fresh">
          <p class="small muted">A new address that has never been used, so this purchase stays apart from your username and chats.</p>
          ${fresh ? `<span class="mono tiny swap-mono">${esc(fresh)}</span>` : '<div class="center-text"><span class="spinner small-spin"></span></div>'}
        </div>`}
        <button class="big" data-swap-continue ${choosing && !state.payoutOverride ? "disabled" : ""}>Continue</button>
      </div>`;
  };
  const loadKusdtDestinations = async () => {
    if (state.kusdtDestinations) return;
    let choices = [];
    try { choices = await kusdtFromChoices(); } catch { choices = []; }
    // the Chatting Address first, then every address holding kUSDT, most first (K kusdtChoices)
    const chatting = choices.filter((c) => c.spendingIndex == null);
    const holding = choices.filter((c) => c.spendingIndex != null && BigInt(c.units ?? 0n) > 0n)
      .sort((a, b) => (BigInt(b.units) > BigInt(a.units) ? 1 : BigInt(b.units) < BigInt(a.units) ? -1 : 0));
    state.kusdtDestinations = [...chatting, ...holding];
    if (currentStep().kind === "destination") paint();
  };

  const coinOf = (ticker, network) => {
    if (ticker === "kas") return KAS;
    if (isTrestlyCoin({ ticker, network })) return KUSDT_COIN;
    return coinByKey(`${ticker}:${network}`) || { ticker, network, displayName: String(ticker || "").toUpperCase() };
  };
  const groupedFigure = (text) => {
    const raw = String(text ?? "");
    const [whole, frac] = raw.split(".");
    if (!/^\d+$/.test(whole || "")) return raw;
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac != null ? `.${frac}` : ""}`;
  };
  /** Where an order stands, in the deposit screen's words, from Waiting for payment on. */
  const depositStatusHtml = (swap, to) => {
    const status = String(swap.status || "").toLowerCase();
    const problem = ["failed", "refunded", "expired", "verifying"].includes(status);
    const lines = {
      confirming: ["Payment received", "Waiting for it to confirm."],
      exchanging: ["Exchanging", "ChangeNOW is converting your coins."],
      sending: [`Sending your ${to.displayName}`, "Almost done."],
      failed: ["Failed", "ChangeNOW couldn't finish this order. Check it on ChangeNOW."],
      refunded: ["Refunded", "ChangeNOW sent the coins back."],
      expired: ["Expired", "Nothing arrived in time. Start a new order."],
      verifying: ["Verifying", "ChangeNOW is checking this order."],
    };
    const [title, detail] = lines[status] || ["Waiting for payment", "Send the amount above. This screen updates by itself."];
    return `<div class="sk-card swap-deposit-status${problem ? " problem" : ""}">
        ${problem ? `<span class="kl-orange">${ICONS.warning}</span>` : '<span class="spinner small-spin"></span>'}
        <span class="tx-meta"><span class="strong small">${esc(title)}</span><span class="muted tiny">${esc(detail)}</span></span>
      </div>`;
  };
  /** A ChangeNOW order's deposit (K SwapDepositScreen): what to send and where, the status, the
   *  transaction ID. Drawn from the exchange made, never the coins picked now (K audit 2026-11-24 #2). */
  const depositHtml = (id) => {
    const swap = state.history.find((x) => x.id === id);
    if (!swap) return '<div class="center-text pad"><span class="spinner"></span></div>';
    const from = coinOf(swap.fromTicker, swap.fromNetwork);
    const to = coinOf(swap.toTicker, swap.toNetwork);
    const payin = String(swap.payinAddress || "");
    return `
      <div class="swap-deposit">
        <div class="center-text swap-deposit-head">
          <div class="strong">${esc(`Send ${groupedFigure(swap.fromAmount)} ${from.displayName}`)}</div>
          <div class="muted small">${esc(to.ticker === "kas" ? "to buy Kaspa" : `to sell it for ${to.displayName}`)}</div>
        </div>
        ${depositStatusHtml(swap, to)}
        ${payin ? `<button class="swap-qr-button" data-swap-copy="${esc(payin)}" aria-label="Copy deposit address"><canvas class="swap-qr" data-swap-qr="${esc(payin)}" width="180" height="180"></canvas></button>` : ""}
        <div class="sk-card swap-deposit-card"><span class="muted tiny">Deposit Address</span><span class="mono tiny swap-mono">${esc(payin)}</span>
          <button class="bar-text accent strong" data-swap-copy="${esc(payin)}">Copy Address</button></div>
        <div class="sk-card swap-deposit-card"><span class="muted tiny">Amount to Send</span><span class="strong">${esc(`${groupedFigure(swap.fromAmount)} ${from.displayName}`)}</span>
          <button class="bar-text accent strong" data-swap-copy-amount="${esc(swap.fromAmount)}">Copy Amount</button></div>
        ${swap.payinExtraId ? `<div class="sk-card swap-result">${payinExtraHtml(swap.payinExtraIdName || "Extra ID", swap.payinExtraId)}</div>` : ""}
        ${from.ticker === "kas" ? depositSendKasHtml(swap) : ""}
        <div class="sk-card swap-deposit-card"><span class="muted tiny">Transaction ID</span><span class="mono tiny swap-mono">${esc(swap.id)}</span>
          <div class="swap-links">
            <button class="bar-text accent strong" data-swap-copy-id="${esc(swap.id)}">Copy ID</button>
            <a class="bar-text accent strong" href="https://changenow.io/exchange/txs/${encodeURIComponent(swap.id)}" target="_blank" rel="noopener noreferrer">View on ChangeNOW</a>
          </div></div>
        ${swap.toAmount ? `<p class="muted tiny center-text">${esc(`You get about ${groupedFigure(swap.toAmount)} ${to.displayName}, sent to ${shortMiddle(swap.payoutAddress)}.`)}</p>` : ""}
      </div>`;
  };
  /** "Send KAS from K", only while the order waits for its deposit and K hasn't sent it; once sent,
   *  that transaction instead (K d88891ea: the deposit could be paid twice before ChangeNOW saw it). */
  const depositSendKasHtml = (swap) => {
    if (swap.kasSendTxId) {
      const txid = swap.kasSendTxId === "sent" ? "" : swap.kasSendTxId;
      return `<div class="sk-card swap-deposit-card"><span class="muted tiny">Sent from K</span>${txid ? `<span class="mono tiny swap-mono">${esc(txid)}</span>
          <button class="bar-text accent strong" data-swap-copy-txid="${esc(txid)}">Copy</button>` : '<span class="small">Sent</span>'}</div>`;
    }
    const status = String(swap.status || "new").toLowerCase();
    if (status !== "new" && status !== "waiting") return "";
    return `<button class="big" data-swap-send-kas="${esc(swap.id)}">Send KAS from K</button>`;
  };
  const completeHtml = (id) => {
    const swap = state.history.find((x) => x.id === id);
    const from = swap ? coinOf(swap.fromTicker, swap.fromNetwork) : null;
    const to = swap ? coinOf(swap.toTicker, swap.toNetwork) : null;
    return `
      <div class="swap-finish">
        <span class="swap-finish-mark">${ICONS.checkBig}</span>
        <div class="strong">${esc(swap?.toTicker === "kas" ? "Purchase Complete" : "Sale Complete")}</div>
        ${swap ? `<p class="muted small center-text">${esc(`You paid ${groupedFigure(swap.fromAmount)} ${from.displayName}`)}${swap.toAmount ? `<br>${esc(`You got about ${groupedFigure(swap.toAmount)} ${to.displayName}`)}` : ""}</p>` : ""}
        ${swap ? `<button class="big" data-swap-add-portfolio="${esc(swap.id)}" ${swap.addedToPortfolio ? "disabled" : ""}>${swap.addedToPortfolio ? "Added to Portfolio" : "Add to Portfolio"}</button>` : ""}
        <button class="ghost" data-swap-done>Done</button>
      </div>`;
  };
  /** A kUSDT order Trestly's pool took (K SwapSentScreen). */
  const sentHtml = (message) => `
    <div class="swap-finish">
      <span class="swap-finish-mark">${ICONS.checkBig}</span>
      <div class="strong">Order Sent</div>
      <p class="muted small center-text">${esc(message || "")}</p>
      <button class="big" data-swap-done>Done</button>
    </div>`;

  /** The pair picked on the coin step (K choosePair): Kaspa is always one side, so which side it's
   *  on sets the direction. Buying goes on to "where", selling straight to the order. */
  const choosePair = (coinPicked, kasSends) => {
    state.kasIsSendSide = kasSends;
    state.amountText = ""; state.receiveAmountText = ""; state.editedSide = "send";
    state.payoutOverride = null;
    state.destination = "fresh";
    state.kusdtDestinations = null;
    setOtherCoin(coinPicked);
    state.flowPath.push({ kind: kasSends ? "form" : "destination" });
    paint();
    if (!kasSends && isKusdt()) loadKusdtDestinations();
  };
  // Before You Swap (iOS SwapAgreementsView): both third parties, each with its terms and its own
  // checkbox; Continue once both are checked, Cancel leaves.
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
        <div class="strong center-text">Before You Buy or Sell</div>
        <p class="small muted">Buying and selling use two services K doesn't run. Read and agree to both before you continue.</p>
        ${agreementCardHtml("changenow")}
        ${agreementCardHtml("trestly")}
        <button class="big" data-swap-agree ${ready ? "" : "disabled"}>Continue</button>
        <button class="bar-text muted" data-swap-not-now>Cancel</button>
      </div>`;
  };

  /** The order page: the form, unless ChangeNOW can't be reached for a ChangeNOW coin - kUSDT still
   *  can be (K-Desktop d570abd renderSwapPage). */
  function swapPageHtml() {
    if (isKusdt() || state.availability === "on") return formHtml();
    const other = `<button class="ghost" data-swap-pick-kusdt>Use kUSDT Instead</button>
        <button class="bar-text accent strong" data-swap-choose-coin>Choose Another Coin</button>`;
    if (state.availability === "checking") return '<div class="center-text pad"><span class="spinner"></span></div>';
    if (state.availability === "permission") {
      return `<div class="swap-empty"><span class="accent">${SWAP}</span><div class="strong">ChangeNOW</div>
        <p class="muted small">ChangeNOW orders go through KaChat's server (desktop.kachat.app), which talks to ChangeNOW for you. Allow K to reach it to use ${esc(state.otherCoin.displayName)}.</p>
        <button class="big" data-swap-allow>Allow</button>${other}</div>`;
    }
    return `<div class="swap-empty"><span class="accent">${SWAP}</span><div class="strong">${esc(SWAP_UNAVAILABLE_TITLE)}</div>
        <p class="muted small">K is not connected to ChangeNOW at the moment, so ${esc(state.otherCoin.displayName)} can't be used. Please try again later.</p>
        <button class="ghost" data-swap-retry>Try Again</button>${other}</div>`;
  }
  function stepHtml(step) {
    switch (step.kind) {
      case "buy": return coinChoiceHtml("What do you want to pay with?");
      case "sell": return coinChoiceHtml("What do you want for your Kaspa?");
      case "history": return historyHtml();
      case "destination": return destinationHtml();
      case "form": return swapPageHtml();
      case "deposit": return depositHtml(step.id);
      case "complete": return completeHtml(step.id);
      case "kusdtDone": return sentHtml(step.message);
      default: return "";
    }
  }
  function bodyHtml() {
    if (!state.agreed) return disclaimerHtml();
    return `<div data-swap-page class="swap-page">${stepHtml(currentStep())}</div>`;
  }

  /** The panel's bar for the step: its title, Back one step up (Cancel on the first), and Done on a
   *  finished one. */
  function paintBar(step) {
    const bar = handle.panel.querySelector(".panel-bar");
    if (!bar) return;
    const title = state.agreed ? stepTitle(step) : "Buy/Sell";
    bar.querySelector(".nav-title").textContent = title;
    handle.panel.setAttribute("aria-label", title);
    const canBack = state.agreed && !finishedStep(step) && state.flowPath.length > 0;
    bar.firstElementChild.outerHTML = canBack
      ? `<button class="bar-text" data-swap-back>${ICONS.back}<span>Back</span></button>`
      : finishedStep(step) ? "<span></span>" : '<button class="bar-text" data-close>Cancel</button>';
    bar.lastElementChild.outerHTML = step.kind === "deposit" ? '<button class="bar-text strong" data-close>Done</button>' : "<span></span>";
  }
  function drawQrs(root) {
    for (const canvas of root.querySelectorAll("[data-swap-qr]")) drawKaspaQr(canvas, canvas.dataset.swapQr, { dark: "#06110f", light: "#ffffff" }).catch(() => {});
  }
  function paint() {
    if (!handle?.isOpen()) return;
    const step = currentStep();
    paintBar(step);
    const host = handle.panel.querySelector("[data-swap]");
    host.innerHTML = bodyHtml();
    groupAmountInputsIn(host);
    drawQrs(host);
    if (state.agreed && step.kind === "destination" && !isKusdt() && state.destination === "chosen") mountDestinationList(host);
    syncDepositPolling(step);
  }
  /** Choose an Address: your addresses right on the step (OwnAddressList), the Chatting Address too. */
  function mountDestinationList(host) {
    const el = host.querySelector("[data-swap-dest-list]");
    if (!el) return;
    const list = mountOwnAddressList(el, {
      selectedAddress: state.payoutOverride?.address || null,
      onPick: (source) => {
        state.payoutOverride = source.kind === "chatting" ? { index: null, address: source.address } : { index: source.index, address: source.address };
        list.setSelected(source.address);
        const button = host.querySelector("[data-swap-continue]");
        if (button) button.disabled = false;
      },
    });
  }
  /** Checks ChangeNOW every 10 s while the deposit screen shows; a finished order becomes Complete,
   *  and any other end stops the checks (K d88891ea). */
  let depositTimer = null;
  function syncDepositPolling(step) {
    const wanted = step.kind === "deposit" && state.agreed && handle?.isOpen() && !document.hidden;
    if (!wanted) { clearTimeout(depositTimer); depositTimer = null; return; }
    if (depositTimer) return;
    const id = step.id;
    if (SWAP_END_STATES.has(String(state.history.find((x) => x.id === id)?.status || "").toLowerCase())) return;
    depositTimer = setTimeout(async () => {
      depositTimer = null;
      const status = await refreshStatus(id);
      const now = currentStep();
      if (!handle?.isOpen() || now.kind !== "deposit" || now.id !== id) return;
      if (String(status || "").toLowerCase() === "finished") state.flowPath[state.flowPath.length - 1] = { kind: "complete", id };
      paint();
    }, 10_000);
  }
  const onVisibility = () => { if (handle?.isOpen()) syncDepositPolling(currentStep()); };
  document.addEventListener("visibilitychange", onVisibility);
  /** Redraws the form around the field being typed in, so it keeps its caret. */
  function paintForm() {
    if (!handle?.isOpen()) return;
    const page = handle.panel.querySelector("[data-swap-page]");
    if (!page || currentStep().kind !== "form" || (!isKusdt() && state.availability !== "on")) { if (currentStep().kind === "form") paint(); return; }
    const active = document.activeElement;
    const field = page.contains(active)
      ? active.dataset?.swapField || (active.matches?.("[data-swap-payout]") ? "payout" : active.matches?.("[data-swap-payout-extra]") ? "payout-extra" : null)
      : null;
    const caret = field ? active.selectionStart : null;
    page.innerHTML = formHtml();
    groupAmountInputsIn(page);
    drawQrs(page);
    if (field) {
      const again = field === "payout" ? page.querySelector("[data-swap-payout]")
        : field === "payout-extra" ? page.querySelector("[data-swap-payout-extra]")
          : page.querySelector(`[data-swap-field="${field}"]`);
      if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch { /* not a text field */ } }
    }
  }

  // --- sheets ---

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
    const trestly = swap.provider === "trestly";
    const statusHtml = () => `<div class="sk-label">Status</div>
        <div class="sk-card"><div class="sk-from-row"><span class="strong ${statusClass(swap.status)}">${esc(capitalize(swap.status))}</span>${swap.status === "finished" ? '<button class="bar-text accent strong" data-swap-portfolio>Add to Portfolio</button>' : ""}</div></div>`;
    const refreshHtml = (refreshing) => `<button class="bar-text accent strong" data-swap-refresh-detail ${refreshing ? "disabled" : ""}>${refreshing ? '<span class="spinner small-spin"></span>' : "Refresh Status"}</button>`;
    // A kUSDT swap through Trestly's pool on Kaspa (K b49a021d): the address it traded from, its
    // status and its Kaspa transaction. No deposit address or exchange ID: nothing went to a third party.
    const trestlyHtml = (refreshing) => `
        <div class="sk-card swap-result">
          <span class="strong small">${historyLine(swap)}</span>
          <span class="muted tiny">${esc(dateText(swap.createdAt))}</span>
        </div>
        <div class="sk-label">Swapped Through</div>
        <div class="sk-card"><span class="small">Trestly's kUSDT pool on Kaspa</span></div>
        <div class="sk-label">Address</div>
        <div class="sk-card"><button class="mono tiny swap-mono" data-swap-copy="${esc(swap.payoutAddress)}">${esc(swap.payoutAddress)}</button></div>
        ${statusHtml()}
        <div class="sk-label">Transaction ID</div>
        <div class="sk-card"><button class="mono tiny swap-mono" data-swap-copy-txid="${esc(swap.id)}">${esc(swap.id)}</button></div>
        <div class="swap-links">
          ${refreshHtml(refreshing)}
          <a class="bar-text accent strong" href="${esc(wallet.explorerTxUrl(swap.id))}" target="_blank" rel="noopener noreferrer">View in Explorer</a>
        </div>`;
    const draw = (refreshing = false) => {
      const host = sheet.panel.querySelector("[data-details]");
      host.innerHTML = trestly ? trestlyHtml(refreshing) : `
        <div class="sk-card swap-result">
          <span class="strong small">${historyLine(swap)}</span>
          <span class="muted tiny">${esc(dateText(swap.createdAt))}</span>
          <canvas class="swap-qr" data-swap-qr="${esc(swap.payinAddress)}" width="180" height="180"></canvas>
        </div>
        <div class="sk-label">Deposit Address</div>
        <div class="sk-card"><button class="mono tiny swap-mono" data-swap-copy="${esc(swap.payinAddress)}">${esc(swap.payinAddress)}</button></div>
        ${swap.payinExtraId ? `<div class="sk-label">Deposit ${esc(swap.payinExtraIdName || "Extra ID")}</div>
        <div class="sk-card swap-result">${payinExtraHtml(swap.payinExtraIdName || "Extra ID", swap.payinExtraId)}</div>` : ""}
        ${swap.payoutExtraId ? `<div class="sk-label">Payout ${esc(swap.payoutExtraIdName || "Extra ID")}</div>
        <div class="sk-card"><button class="mono tiny swap-mono" data-swap-copy-extra="${esc(swap.payoutExtraId)}" data-swap-extra-name="${esc(swap.payoutExtraIdName || "Extra ID")}">${esc(swap.payoutExtraId)}</button></div>` : ""}
        ${statusHtml()}
        <div class="sk-label">ChangeNOW Exchange ID</div>
        <div class="sk-card"><button class="mono tiny swap-mono" data-swap-copy-id="${esc(swap.id)}">${esc(swap.id)}</button></div>
        <div class="swap-links">
          ${refreshHtml(refreshing)}
          <a class="bar-text accent strong" href="https://changenow.io/exchange/txs/${encodeURIComponent(swap.id)}" target="_blank" rel="noopener noreferrer">View on ChangeNOW</a>
        </div>`;
      drawQrs(host);
      bindCopies(host);
      host.querySelector("[data-swap-refresh-detail]").onclick = async () => {
        draw(true);
        const status = await refreshStatus(swap.id);
        toast(status ? `Status: ${capitalize(status)}` : trestly ? "Couldn't reach the network - try again" : "Couldn't reach ChangeNOW - try again");
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
          if (currentStep().kind === "complete") paint(); // Purchase / Sale Complete reads Added to Portfolio
        },
      })),
    });
  };

  function bindCopies(root) {
    for (const b of root.querySelectorAll("[data-swap-copy]")) b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.swapCopy); toast("Address copied to clipboard."); } catch { /* refused */ } };
    for (const b of root.querySelectorAll("[data-swap-copy-id]")) b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.swapCopyId); toast("Exchange ID copied"); } catch { /* refused */ } };
    for (const b of root.querySelectorAll("[data-swap-copy-extra]")) b.onclick = () => copyExtra(b);
    for (const b of root.querySelectorAll("[data-swap-copy-txid]")) b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.swapCopyTxid); toast("Transaction ID copied"); } catch { /* refused */ } };
  }
  async function copyExtra(button) {
    try { await navigator.clipboard.writeText(button.dataset.swapCopyExtra); toast(`${button.dataset.swapExtraName || "Extra ID"} copied`); } catch { /* refused */ }
  }

  handle = openPanel({
    title: "Buy/Sell", leading: "Cancel", full: true, body: '<div data-swap class="swap-root"></div>',
    onClose: () => { clearTimeout(estimateTimer); clearTimeout(depositTimer); depositTimer = null; document.removeEventListener("visibilitychange", onVisibility); answerApproval(false); },
  });
  const root = handle.panel.querySelector("[data-swap]");
  /** One step up (the bar's Back, and Choose Another Coin). */
  const goBack = () => {
    if (!state.flowPath.length) { handle.close(); return; }
    state.flowPath.pop();
    if (!state.flowPath.length) { state.payoutOverride = null; state.destination = "fresh"; }
    paint();
  };
  handle.panel.querySelector(".panel-bar").addEventListener("click", (event) => {
    if (event.target.closest("[data-swap-back]")) goBack();
  });
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
    const search = event.target.closest("[data-swap-choice-search]");
    if (search) {
      state.coinQuery = search.value;
      const list = root.querySelector("[data-swap-choice-list]");
      if (list) list.innerHTML = coinChoiceListHtml();
    }
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
    if (t.closest("[data-swap-not-now]") || t.closest("[data-swap-done]")) { handle.close(); return; }
    if (t.closest("[data-swap-back]")) { goBack(); return; }
    // back on the coin step (the start), whatever came after it
    if (t.closest("[data-swap-choose-coin]")) { state.flowPath = []; state.payoutOverride = null; state.destination = "fresh"; paint(); return; }
    // the coin step
    const group = t.closest("[data-swap-choice-group]");
    if (group) {
      const ticker = group.dataset.swapChoiceGroup;
      if (state.coinExpanded.has(ticker)) state.coinExpanded.delete(ticker); else state.coinExpanded.add(ticker);
      const list = root.querySelector("[data-swap-choice-list]");
      if (list) list.innerHTML = coinChoiceListHtml();
      return;
    }
    const choice = t.closest("[data-swap-choice]");
    if (choice) {
      const c = choice.dataset.swapChoice === "kusdt" ? KUSDT_COIN : coinByKey(choice.dataset.swapChoice);
      if (c) choosePair(c, currentStep().kind === "sell");
      return;
    }
    // the "where" step
    if (t.closest("#swap-dest-fresh")) {
      if (state.destination === "fresh") return;
      state.destination = "fresh";
      state.payoutOverride = null;
      paint();
      return;
    }
    if (t.closest("#swap-dest-choose")) {
      if (state.destination === "chosen") return;
      state.destination = "chosen";
      state.payoutOverride = null;
      paint();
      return;
    }
    const destKusdt = t.closest("[data-swap-dest-kusdt]");
    if (destKusdt) {
      const c = state.kusdtDestinations?.[Number(destKusdt.dataset.swapDestKusdt)];
      if (!c) return;
      state.kusdtFrom = c.spendingIndex == null ? null : { label: c.label, address: c.address, spendingIndex: c.spendingIndex };
      state.kusdtQuote = null;
      paint();
      return;
    }
    const proceed = t.closest("[data-swap-continue]");
    if (proceed) {
      if (proceed.disabled) return;
      if (!isKusdt() && state.destination === "chosen" && !state.payoutOverride) return;
      state.flowPath.push({ kind: "form" });
      paint();
      reschedule();
      refreshKusdtBalances();
      return;
    }
    // the order
    if (t.closest("[data-swap-max]")) { setMaxAmount(); return; }
    if (t.closest("[data-swap-pick-kusdt]")) {
      setOtherCoin(KUSDT_COIN);
      // buying with kUSDT lands the Kaspa on the address that pays: its own "where" step
      if (!state.kasIsSendSide) {
        state.kusdtDestinations = null;
        state.flowPath[state.flowPath.length - 1] = { kind: "destination" };
        loadKusdtDestinations();
      }
      paint();
      return;
    }
    if (t.closest("[data-swap-kusdt-from]")) { openKusdtFromPicker(); return; }
    if (t.closest("[data-swap-create]")) { execute(); return; }
    // the deposit screen
    const copyAmount = t.closest("[data-swap-copy-amount]");
    if (copyAmount) { try { await navigator.clipboard.writeText(copyAmount.dataset.swapCopyAmount); toast("Amount copied"); } catch { /* refused */ } return; }
    const copyTxid = t.closest("[data-swap-copy-txid]");
    if (copyTxid) { try { await navigator.clipboard.writeText(copyTxid.dataset.swapCopyTxid); toast("Transaction ID copied"); } catch { /* refused */ } return; }
    const sendKas = t.closest("[data-swap-send-kas]");
    if (sendKas) { sendKasFromK(sendKas.dataset.swapSendKas); return; }
    const addPortfolio = t.closest("[data-swap-add-portfolio]");
    if (addPortfolio) {
      const swap = state.history.find((x) => x.id === addPortfolio.dataset.swapAddPortfolio);
      if (swap) addToPortfolio(swap);
      return;
    }
    // history
    const open = t.closest("[data-swap-open]");
    if (open) { openDetails(open.dataset.swapOpen); return; }
    const del = t.closest("[data-swap-delete]");
    if (del) {
      showAlert({
        title: "Delete this order?",
        message: "This only removes it from your local history - it doesn't affect the actual exchange.",
        confirmLabel: "Delete", cancelLabel: "Cancel",
        onConfirm: () => { state.history = state.history.filter((s) => s.id !== del.dataset.swapDelete); saveHistory(); paint(); },
      });
      return;
    }
    const copy = t.closest("[data-swap-copy]");
    if (copy) { try { await navigator.clipboard.writeText(copy.dataset.swapCopy); toast("Address copied to clipboard."); } catch { /* refused */ } return; }
    const copyId = t.closest("[data-swap-copy-id]");
    if (copyId) { try { await navigator.clipboard.writeText(copyId.dataset.swapCopyId); toast("Transaction ID copied"); } catch { /* refused */ } return; }
    const copyExtraId = t.closest("[data-swap-copy-extra]");
    if (copyExtraId) copyExtra(copyExtraId);
  });
  /** The deposit screen's Send KAS from K (K SwapDepositScreen): Send Kaspa filled in with the
   *  deposit's address and amount; back on this order's deposit screen afterwards. */
  async function sendKasFromK(id) {
    const markSent = (txid) => {
      const saved = read(HISTORY_KEY, []);
      const order = Array.isArray(saved) ? saved.find((x) => x.id === id) : null;
      if (!order) return;
      order.kasSendTxId = txid || "sent";
      write(HISTORY_KEY, saved);
    };
    const swap = state.history.find((x) => x.id === id);
    const amountSompi = swap ? sompiFromUserText(String(swap.fromAmount || "")) : null;
    if (!swap?.payinAddress || swap.kasSendTxId || amountSompi == null || !main) return;
    const [{ showSend }, dock] = await Promise.all([import("./send.js"), import("./dock.js")]);
    handle.close();
    showSend({
      source: { kind: "main" }, fromAddress: main, navTitle: "Send Kaspa",
      recipient: swap.payinAddress, amountSompi,
      // the send is recorded on the order, so its button gives way to it (K d88891ea): the
      // deposit can't be paid twice before ChangeNOW sees it
      onSent: ({ txid } = {}) => markSent(txid),
      // it may land: marked sent too, so it isn't paid again (K iOS d88891ea)
      onOutcomeUnknown: ({ txid } = {}) => markSent(txid),
      onClose: () => { dock.returnToTab(); showSwap({ deposit: id }); },
    });
  }
  paint();
  refreshKusdtBalances();
  if (currentStep().kind === "destination" && isKusdt()) loadKusdtDestinations();
  wallet.nextSwapPayoutAddress({ skip: kusdtListedIndices() }).then((next) => {
    state.nextPayout = next;
    if (currentStep().kind === "destination") paint(); else paintForm();
  }).catch(() => {});
  probe();
}
