// The kUSDT screens, ported from K-Desktop ui/kusdt-screens.js (9787553; KaPay iOS 3d126db
// Views/Tokens/*.swift, K iOS b0f0a4e6) onto the extension's own pieces: the step flow and the
// tap-to-send review of Send Kaspa (send-steps.js), Manage Addresses' rows and floating button,
// the receive screens' white QR card, the half sheets and alerts (ui.js).
//
//   the Wallet tab's kUSDT card (on the card pager beside Kaspa's), Send's
//   "What are you sending?", Send kUSDT (To / From / How much / Review) with Fund This Address,
//   Combine Coins, Manage kUSDT (its row menu, kUSDT Actions, kUSDT Address Visibility), an
//   address's page and history, About kUSDT, Receive kUSDT and the kUSDT Guide.
//
// As on Desktop (owner, 2026-11-20): Trestly's site isn't shown inside K (a browser page can't
// hand a wallet to it), so there's no connect sheet and no Bridged rows; Manage kUSDT's Open
// Trestly opens it in a new tab. Swapping KAS and kUSDT is the Wallet's Swap (K iOS 518fdc8c,
// K-Desktop d570abd: swaps.js with Trestly's pool code run by K), and Send kUSDT's "None held"
// opens it with kUSDT picked. Chat-only parts (Send Dollars, tips, payment notices) aren't here.
//
// Nothing here asks for the password: plain sends need none (KaPay iOS 5848fb0). Every build, read
// and send is tied to the account it started on; an answer after a switch is dropped.

import { app, esc, render, $, toast, copyText, showSheet, showAlert, ICONS, unitText } from "./ui.js";
import { remember } from "./dock.js";
import * as wallet from "./wallet.js";
import { NETWORK, KAS_UNIT } from "./net.js";
import { drawKaspaQr } from "../shared/engine/qr.js";
import {
  KUSDT_TOKEN, kusdtDeployment, formatKusdt, typedKusdt, kusdtDollars, kusdtUnitsFromText, canHoldKusdt, KUSDT_DECIMALS,
} from "../shared/engine/kusdt.js";
import {
  prepareTransfer, prepareCombine, isReviewStale, staleReviewOutcome, createPrepareGate, KusdtTransferError,
  TRANSFER_MESSAGES, MAX_TOKEN_INPUTS,
} from "../shared/engine/kusdt-transfer.js";
import { KusdtCoreError } from "../shared/engine/kusdt-core.js";
import { KusdtBalanceError } from "../shared/engine/kusdt-balances.js";
import { sendFeeChangedError, SEND_OUTCOME_UNKNOWN } from "../shared/engine/transactions.js";
import { addressNumber } from "../shared/engine/quantum.js";
import {
  receiveNotesFor, kasAmountText, kusdtFeeText, isHoldingUsed, shortKusdtAddress, visibilityShortAddress,
  KUSDT_VISIBILITY_PAGE, makeHolding,
} from "../shared/ui/kusdt-wallet.js";
import {
  kusdt, kusdtAccount, secretKeyFor, ensureEngine, setSubmitAddress, syncKusdtAccount, kusdtAddressesInRange, revealKusdtSlot,
  kusdtCustomLabel,
} from "./kusdt.js";
import { kusdtCoinIconHtml, kaspaCoinIconHtml, KUSDT_ICONS, receiveNoteIcon } from "./kusdt-icons.js";
import {
  createStepFlow, showStep, stepChipHtml, keypadHtml, bindKeypad, keypadAmountHtml, paintKeypadAmount,
  applyKeypadKey, reviewRowHtml, showSwipeUp, SWIPE_UP_LABELS,
} from "./send-steps.js";
import { recipientCardHtml, recipientStatusHtml, recipientLookup, bindAddressBookButton } from "./send-pieces.js";
import { scanQr } from "./camera.js";
import { entryFor, entryName } from "./address-book.js";
import "./kusdt.css";

const SYMBOL = KUSDT_TOKEN.symbol;
const KAS_PER_COIN = KUSDT_TOKEN.kasPerCoinSompi;
const kas = (sompi) => kasAmountText(sompi, KAS_UNIT);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const W = () => kusdt();

/** Exact strings (K-Desktop KUSDT_TEXT, iOS 3d126db), with "this browser" where Desktop says
 *  "this computer". */
export const KUSDT_TEXT = Object.freeze({
  scriptRecipient: "kUSDT can only go to a regular Kaspa address, not a quantum-safe or other script address.",
  fromFootnote: "The KAS for the fee comes from the same address, so the send doesn't link it to your other addresses.",
  fromNone: "None of your addresses holds kUSDT yet.",
  fromChecking: "Checking your addresses for kUSDT…",
  overBalance: "More than your kUSDT.",
  feeFromTokenKas: "This address had no KAS, so the network fee came out of the KAS that goes with the kUSDT.",
  waitingForKas: "Waiting for your KAS to arrive…",
  building: "Building the transaction…",
  notLanded: "The KAS you sent hasn't shown up on this address yet. It usually takes a few seconds.",
  coinHoldsKas: "Every kUSDT coin holds 1.5 KAS. It goes to the recipient with the kUSDT, so the KAS isn't lost.",
  fundCaption: "Pick which of your addresses the KAS comes from, send it, and you're back here.",
  fundMemo: "KAS for a kUSDT send",
  noKeyHere: "This address's key isn't available in this browser.",
  combineNote: "Every kUSDT coin holds 1.5 KAS. Combining them into one coin gives the extra KAS back to this address as regular KAS, less the network fee. Your kUSDT stays the same.",
  combineMore: `Up to ${MAX_TOKEN_INPUTS} coins combine at a time. Combine again for the rest.`,
  aboutText: "kUSDT is USDT from Ethereum and BNB Chain, held 1:1 in Trestly's vault and issued as a token on Kaspa. It isn't issued by Tether, and only Trestly can turn it back into USDT.",
  risk: "Not independently audited yet. Hold only what you can afford to lose.",
  aboutCoin: "Every kUSDT coin holds 1.5 KAS. It goes along with the kUSDT when you send it.",
  emptyTitle: "No kUSDT Yet",
  emptyText: "Receive it on a fresh address, or swap KAS for it with Swap on the Wallet tab.",
  historyEmpty: "No kUSDT activity yet.",
  historyEmptyNote: "Sends, receives and combines in this browser show here from now on.",
  visibilityEmptyPage: "These addresses couldn't be derived right now. Go back a page or reopen this screen to retry.",
});

// --- Small pieces ------------------------------------------------------------------------------

function messageFor(error) {
  if (error instanceof KusdtTransferError) return error.code === "noKey" ? KUSDT_TEXT.noKeyHere : error.message;
  if (error instanceof KusdtCoreError || error instanceof KusdtBalanceError) return error.message;
  return String(error?.message || error || "Something went wrong.");
}
const spinnerLine = (text) => `<p class="kusdt-status muted"><span class="spinner small-spin"></span><span>${esc(text)}</span></p>`;
const statusLine = (icon, text, tone = "muted") => `<p class="kusdt-status ${tone}">${icon}<span>${esc(text)}</span></p>`;
const labelOf = (h) => W().labelOf(h);
function dateText(ms) {
  try { return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; }
}
function middle(text, keep = 10) {
  const t = String(text || "");
  return t.length > keep * 2 + 1 ? `${t.slice(0, keep)}…${t.slice(-keep)}` : t;
}
function openExternal(url) {
  try { window.open(url, "_blank", "noopener,noreferrer"); } catch { /* blocked: nothing to do */ }
}
const NOTE_CLASS = { privateAddress: "private", publicAddress: "public", quantum: "quantum", allowed: "allowed", warning: "warning", info: "info" };
function noteHtml(note, cls) {
  return `<div class="${cls} rcv-note-${NOTE_CLASS[note.kind] || "info"}"><span class="rcv-note-icon kusdt-note-icon">${receiveNoteIcon(note.kind)}</span><span>${esc(note.text)}</span></div>`;
}

// The screen on show and how to draw it again when kUSDT's figures change.
let active = null; // { screen, paint }
function show(screen, paint) {
  active = { screen, paint };
  paint();
  remember(() => { active = { screen, paint }; paint(); });
}
let subscribed = false;
function subscribeOnce() {
  if (subscribed) return;
  subscribed = true;
  W().subscribe(() => {
    if (active && app.dataset.screen === active.screen) {
      try { active.paint(); } catch { /* a screen's own paint */ }
    }
    for (const fn of cardListeners) { try { fn(); } catch { /* the home card */ } }
  });
}
const cardListeners = new Set();

/** kUSDT starts for the account on screen: the engine's SDK, the addresses, the 30 s poll. */
export async function startKusdt() {
  subscribeOnce();
  try { await syncKusdtAccount(); } catch { /* the next paint retries */ }
  ensureEngine().catch(() => {});
  W().startPolling();
}

// --- §1 The Wallet card ------------------------------------------------------------------------

/** The kUSDT page of the Wallet's card pager (iOS TokenBalanceCard): USDT green, where it's held
 *  and the KAS held with it; opens Manage kUSDT (#kusdt-card). */
export function kusdtCardHtml() {
  const w = W();
  const units = w.balance();
  return `
    <button class="wallet-balance-card kusdt-balance-card" id="kusdt-card" aria-label="kUSDT balance, open Manage kUSDT">
      <div class="wallet-balance-head">
        <span class="wallet-balance-top"><span class="kusdt-card-title">${kusdtCoinIconHtml(22)}<span class="muted">${esc(SYMBOL)} Balance</span></span><span class="wallet-manage-hint">Tap to Manage ›</span></span>
        <span class="wallet-balance-total">${esc(units == null ? "--" : formatKusdt(units))}</span>
        ${units != null ? `<span class="muted">${esc(kusdtDollars(units))}</span>` : ""}
      </div>
      <div class="wallet-balance-parts">
        <div><span class="muted tiny">Held On</span><span class="strong small">${esc(w.heldOnText())}</span></div>
        <div><span class="muted tiny">KAS Held With It</span><span class="strong small mono-digits">${esc(units == null ? "--" : kas(w.kasHeld()))}</span></div>
      </div>
    </button>`;
}

/** Repaints the card in place while the Wallet tab shows; returns a function that stops. */
export function watchKusdtCard(onChange) {
  cardListeners.add(onChange);
  return () => cardListeners.delete(onChange);
}

// --- §2 Swap (K 5.4: the Wallet's Swap button, swaps.js; Swap Stablecoins went) ----------------

/** Swap with kUSDT picked, buying it with KAS (K-Desktop d570abd openKusdtSwap): Send kUSDT's way
 *  to get some when none of your addresses holds any. */
export function openKusdtSwap() {
  import("./swaps.js").then((m) => m.showSwap({ coin: "kusdt", buying: true }));
}

// --- §3 Send's asset chooser -------------------------------------------------------------------

/** "What are you sending?": Kaspa (the total) or kUSDT (its total). */
export function openWalletSend({ kaspaTotalSompi = null, onKaspa, onBack }) {
  const units = W().balance();
  showSheet({
    title: "Send",
    headerHtml: '<div class="kusdt-sheet-question">What are you sending?</div>',
    cancel: false,
    rows: [
      { label: "Kaspa", subtitle: kaspaTotalSompi == null ? KAS_UNIT : kas(kaspaTotalSompi), icon: kaspaCoinIconHtml(36), onClick: onKaspa },
      { label: SYMBOL, subtitle: units == null ? KUSDT_TOKEN.name : formatKusdt(units), icon: kusdtCoinIconHtml(36), onClick: () => openKusdtSend({ onBack }) },
    ],
  });
  W().refreshIfStale().catch(() => {});
}

// --- §4 Send kUSDT ------------------------------------------------------------------------------

/**
 * Send kUSDT (iOS TokenSendView, K-Desktop openKusdtSend). `startFrom`: a holding the send leaves
 * from (its page's Send; no From step). `recipient` / `recipientName`: the To filled in (Send to
 * Chatting Address). `onBack`: where Cancel and Done go.
 */
export function openKusdtSend({ startFrom = null, recipient = null, recipientName = null, onBack }) {
  const owner = kusdtAccount();
  if (!owner) return;
  const w = W();
  const S = {
    owner, recipientInput: recipient || "", recipient: null, recipientName: recipientName || null, resolving: false,
    recipientError: "", 
    fromId: null, startFrom, amountText: "",
    prepared: null, preparing: false, prepareError: null, rebuildWhenDone: false,
    fundShort: null, fundForChange: false, fundingSent: false, awaitingFunds: false, fundingRun: 0,
    outcomeUnknown: false, sending: false, failure: null, gate: createPrepareGate(), open: true,
  };
  let handle = null; // the step on screen
  let swipe = null;  // the review's tap-to-send screen
  const here = () => S.open && app.dataset.screen?.startsWith("kusdt-send");

  const holdings = () => w.heldHoldings() || [];
  const from = () => {
    const list = holdings();
    if (S.fromId) { const picked = list.find((h) => h.id === S.fromId); if (picked) return picked; }
    if (S.startFrom) return list.find((h) => h.id === S.startFrom.id) || S.startFrom;
    return list.length === 1 ? list[0] : null;
  };
  const skipsFrom = () => S.startFrom != null || holdings().length === 1;
  const balance = () => from()?.units ?? 0n;
  const units = () => kusdtUnitsFromText(S.amountText);
  const tooHigh = () => (units() ?? 0n) > balance();
  const recipientAddress = () => S.recipient?.address || null;
  const isScript = () => Boolean(recipientAddress()) && !canHoldKusdt(recipientAddress(), NETWORK);
  const shownRecipient = () => S.recipientName || recipientAddress() || "";
  const buildKey = () => {
    const f = from();
    const u = units();
    if (!f || !recipientAddress() || u == null) return null;
    return { from: f.id, recipient: recipientAddress().toLowerCase(), amount: String(u) };
  };
  const preparedIsCurrent = () => {
    const key = buildKey();
    const p = S.prepared;
    return Boolean(p && key && p.from.holdingId === key.from && p.recipient === key.recipient && String(p.amount) === key.amount);
  };
  const close = () => {
    if (swipe?.sending) return;
    S.open = false;
    S.gate.invalidate();
    S.fundingRun += 1;
    lookup.cancel?.();
    onBack?.();
  };

  // the recipient: an address or a name on any service, as Send Kaspa takes it
  const lookup = recipientLookup({
    read: () => S.recipientInput,
    resolve: (text) => wallet.resolveRecipient(text),
    onChange: (found) => {
      S.recipient = found.recipient;
      S.recipientError = found.error;
      S.resolving = found.resolving;
      if (S.recipient && !S.recipient.domain) {
        const saved = entryFor(S.recipient.address);
        S.recipientName = recipientName && S.recipient.address.toLowerCase() === String(recipient).toLowerCase()
          ? recipientName
          : (saved && String(saved.name || "").trim() ? entryName(saved) : null);
      } else {
        S.recipientName = S.recipient?.domain || null;
      }
      if (flow.current === "to") paintRecipient();
    },
  });
  const recipientStatus = () => ({
    resolving: S.resolving,
    error: S.recipientError,
    resolvedAddress: S.recipient?.domain ? S.recipient.address : null,
    resolvedName: S.recipient?.domain || null,
    valid: Boolean(S.recipient && !S.recipient.domain),
  });
  const scriptNote = () => (isScript() ? statusLine(KUSDT_ICONS.octagonX, KUSDT_TEXT.scriptRecipient, "bad") : "");
  const paintRecipient = () => {
    const status = handle?.el?.querySelector("#recipient-status");
    if (!status) return;
    status.innerHTML = unitText(recipientStatusHtml({ input: S.recipientInput, status: recipientStatus() }) + scriptNote());
    handle.refresh();
  };
  const setRecipientText = (text) => {
    S.recipientInput = text;
    const input = handle?.el?.querySelector("#recipient");
    if (input) input.value = text;
    lookup.now();
  };

  const flow = createStepFlow(["to", "from", "amount", "review"], (id, direction) => {
    handle = null;
    swipe = null;
    if (id === "to") drawTo(direction);
    else if (id === "from") drawFrom(direction);
    else if (id === "amount") drawAmount(direction);
    else drawReview(direction);
  });
  const go = (step) => {
    if (flow.current === "review" || step === "review") {
      S.gate.invalidate();
      S.prepared = null;
      S.prepareError = null;
      S.failure = null;
      S.outcomeUnknown = false;
    }
    flow.go(step);
  };
  const title = `Send ${SYMBOL}`;

  // To
  function drawTo(direction) {
    const step = showStep({
      screen: "kusdt-send-to", title, question: "Who are you sending to?",
      bodyHtml: recipientCardHtml({ input: S.recipientInput, status: recipientStatus(), extraHtml: scriptNote() }),
      onCancel: close,
      canContinue: () => Boolean(S.recipient) && !S.resolving && !isScript(),
      onContinue: () => go(skipsFrom() ? "amount" : "from"),
      direction,
    });
    handle = step;
    const input = step.body.querySelector("#recipient");
    input.oninput = () => { S.recipientInput = input.value; lookup.schedule(); };
    input.onkeydown = (event) => {
      if (event.key !== "Enter" || event.isComposing || !S.recipient || S.resolving || isScript()) return;
      event.preventDefault();
      go(skipsFrom() ? "amount" : "from");
    };
    step.body.querySelector("#paste").onclick = async () => {
      try { setRecipientText((await navigator.clipboard.readText()).trim()); } catch { toast("Clipboard unavailable - paste with ⌘V instead."); }
    };
    step.body.querySelector("#scan").onclick = async () => {
      const code = await scanQr({ title: "Scan QR Code", hint: "Point camera at a Kaspa address QR code" });
      if (code && here()) setRecipientText(String(code).trim().split("?")[0]);
    };
    bindAddressBookButton(step.body, (address) => setRecipientText(address));
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch { /* fine */ }
  }

  // From
  function fromListHtml() {
    const list = holdings();
    const selected = from();
    if (!list.length) {
      return w.discovering || w.refreshing || !w.known
        ? `<div class="kusdt-from-empty">${spinnerLine(KUSDT_TEXT.fromChecking)}</div>`
        : `<div class="kusdt-from-empty"><p class="muted">${esc(KUSDT_TEXT.fromNone)}</p>
            <button type="button" class="ios-capsule with-icon" id="kusdt-from-swap">${KUSDT_ICONS.dollarCircle}<span>Swap for kUSDT</span></button></div>`;
    }
    return `<div class="glass list">${list.map((h) => {
      const on = selected?.id === h.id;
      return `<button type="button" class="list-row kusdt-from-row${on ? " on" : ""}" data-from="${esc(h.id)}" aria-pressed="${on}">
        <span class="tx-meta"><span class="strong small">${esc(labelOf(h))}</span><span class="mono tiny muted">${esc(shortKusdtAddress(h.address))}</span></span>
        <span class="strong small">${esc(formatKusdt(h.units))}</span>
        <span class="accent kusdt-check">${on ? ICONS.circleCheck : ICONS.circle}</span>
      </button>`;
    }).join("")}</div>`;
  }
  function drawFrom(direction) {
    const step = showStep({
      screen: "kusdt-send-from", title, question: "Where are you sending from?",
      bodyHtml: `<div id="kusdt-from-list">${fromListHtml()}</div><p class="ss-note">${esc(KUSDT_TEXT.fromFootnote)}</p>`,
      onBack: () => go("to"), onCancel: close,
      canContinue: () => from() != null,
      onContinue: () => go("amount"),
      direction,
    });
    handle = step;
    bindFrom();
    w.refreshIfStale().catch(() => {});
  }
  function bindFrom() {
    const box = handle?.el?.querySelector("#kusdt-from-list");
    if (!box) return;
    box.querySelector("#kusdt-from-swap")?.addEventListener("click", () => openKusdtSwap());
    for (const row of box.querySelectorAll("[data-from]")) {
      row.onclick = () => {
        if (S.sending) return;
        S.fromId = row.dataset.from;
        S.amountText = "";
        box.innerHTML = unitText(fromListHtml());
        bindFrom();
        handle.refresh();
      };
    }
  }

  // How much
  const amountNote = () => (tooHigh() ? KUSDT_TEXT.overBalance : `Available: ${formatKusdt(balance())}`);
  function drawAmount(direction) {
    const f = from();
    const chips = `${recipientAddress() ? stepChipHtml({ label: "To", value: shownRecipient(), isAddress: !S.recipientName }) : ""}${f ? stepChipHtml({ label: "From", value: labelOf(f) }) : ""}`;
    const step = showStep({
      screen: "kusdt-send-amount", title, question: "How much?", className: "ss-amount-step",
      bodyHtml: `<div class="ss-chips">${chips}</div>
        <div class="ss-keypad-stage">
          ${keypadAmountHtml({ typed: S.amountText, unit: SYMBOL })}
          <div class="sk-amount-actions ss-amount-actions"><button type="button" class="sk-chip accent strong" id="max">Max</button></div>
          <p class="ss-footnote" id="ss-footnote"></p>
        </div>
        ${keypadHtml()}`,
      onBack: () => go(skipsFrom() ? "to" : "from"), onCancel: close,
      continueTitle: "Review",
      canContinue: () => units() != null && !tooHigh(),
      onContinue: () => go("review"),
      direction,
    });
    handle = step;
    const paint = () => {
      paintKeypadAmount(step.el, S.amountText, SYMBOL);
      const note = step.el.querySelector("#ss-footnote");
      note.textContent = amountNote();
      note.classList.toggle("error", tooHigh());
      step.refresh();
    };
    bindKeypad(step.el, (key) => {
      if (S.sending) return false;
      const next = applyKeypadKey(key, S.amountText, KUSDT_DECIMALS);
      if (next === S.amountText) return false;
      S.amountText = next;
      paint();
      return true;
    });
    step.el.querySelector("#max").onclick = () => {
      S.amountText = typedKusdt(balance());
      if (S.amountText === "0") S.amountText = "";
      paint();
    };
    paint();
  }

  // Review
  function reviewStatusHtml() {
    const short = S.fundShort;
    if (S.awaitingFunds) return spinnerLine(KUSDT_TEXT.waitingForKas);
    if (S.preparing) return spinnerLine(KUSDT_TEXT.building);
    if (S.fundingSent && short != null) {
      return `<div class="kusdt-fund">
        ${statusLine(KUSDT_ICONS.clock, KUSDT_TEXT.notLanded)}
        <button type="button" class="ios-capsule" id="kusdt-check-again">Check Again</button>
        <button type="button" class="link-button strong" id="kusdt-fund">${esc(`Add ${kas(short)} More`)}</button>
      </div>`;
    }
    if (S.prepareError) {
      return `<div class="kusdt-fund">
        ${statusLine(KUSDT_ICONS.warning, S.prepareError, "bad")}
        ${short != null
    ? `<button type="button" class="ios-capsule with-icon" id="kusdt-fund">${KUSDT_ICONS.arrowToLine}<span>${esc(S.fundForChange ? `Add ${kas(short)} for Fee and Change Coin` : `Add ${kas(short)} for the Network Fee`)}</span></button>
           <p class="muted tiny center-text">${esc(KUSDT_TEXT.fundCaption)}</p>`
    : '<button type="button" class="link-button strong" id="kusdt-rebuild">Try Again</button>'}
      </div>`;
    }
    return "";
  }
  function reviewHtml() {
    const u = units();
    const f = from();
    const p = preparedIsCurrent() ? S.prepared : null;
    const fee = p ? kas(p.fee) : (S.preparing ? "…" : "--");
    const address = recipientAddress();
    return `
      <div class="ss-review-amount kusdt-review-amount">
        <span class="ss-review-eyebrow">You're sending</span>
        ${u != null ? `<span class="kusdt-review-big">${kusdtCoinIconHtml(30)}<strong class="ss-review-big">${esc(formatKusdt(u))}</strong></span>
        <span class="ss-review-fiat">${esc(kusdtDollars(u))}</span>` : ""}
      </div>
      <div class="kusdt-section-label">To</div>
      ${address ? `<div class="sk-card">${recipientStatusHtml({ input: address, status: { valid: !S.recipientName, resolvedAddress: S.recipientName ? address : null, resolvedName: S.recipientName } })}</div>` : ""}
      <div class="sk-card ss-review-card">
        ${reviewRowHtml("From", `<strong>${esc(f ? labelOf(f) : "--")}</strong>`)}
        ${reviewRowHtml("Goes With It", `<strong>${esc(kas(p ? p.kasToRecipient : KAS_PER_COIN))}</strong>`)}
        ${reviewRowHtml("Network Fee", `<strong>${esc(fee)}</strong>`)}
        ${reviewRowHtml("Total KAS", `<strong>${esc(p ? kas(p.kasToRecipient + p.fee) : "--")}</strong>`)}
        ${reviewRowHtml("KAS Paid From", `<strong>${esc(f ? labelOf(f) : "--")}</strong>`)}
      </div>
      ${p?.feeFromTokenKas ? statusLine(KUSDT_ICONS.info, KUSDT_TEXT.feeFromTokenKas) : ""}
      ${reviewStatusHtml()}
      <p class="ss-note">${esc(KUSDT_TEXT.coinHoldsKas)}</p>`;
  }
  function paintReview() {
    if (!swipe || flow.current !== "review" || !here()) return;
    swipe.setBody(reviewHtml());
    const body = swipe.body;
    body.querySelector("#kusdt-fund")?.addEventListener("click", openFunding);
    body.querySelector("#kusdt-check-again")?.addEventListener("click", () => prepareAfterFunding(true));
    body.querySelector("#kusdt-rebuild")?.addEventListener("click", () => prepareSend());
    swipe.setEnabled(preparedIsCurrent() && !S.preparing && !tooHigh());
  }
  function drawReview(direction) {
    swipe = showSwipeUp({
      screen: "kusdt-send-review", title: "Review", barTitle: "Swipe up to Send", labels: SWIPE_UP_LABELS.send,
      onBack: () => go("amount"), onCancel: close, direction,
      getPreview: () => ({ amountText: units() != null ? formatKusdt(units()) : null, recipient: shownRecipient() }),
      getFailureMessage: () => S.failure,
      onAction: () => { sendNow(); },
      onDone: close,
    });
    handle = { el: app.querySelector(".ss-screen"), refresh() {} };
    paintReview();
    prepareSend();
  }

  /** Builds and signs the transfer for what the review shows (iOS prepare). Kept only if nothing
   *  changed meanwhile (the gate, the account); a build asked for meanwhile runs after this one. */
  async function prepareSend() {
    const f = from();
    const key = buildKey();
    if (!f || !key) return;
    if (S.preparing) { S.rebuildWhenDone = true; return; }
    if (kusdtAccount() !== owner) return;
    const ticket = S.gate.begin(key);
    const isCurrent = () => S.open && ticket.isCurrent(buildKey()) && kusdtAccount() === owner;
    S.preparing = true;
    S.prepareError = null;
    paintReview();
    try {
      const engine = await ensureEngine();
      let secretKey = await secretKeyFor(f);
      const built = await prepareTransfer({
        from: { address: f.address, holdingId: f.id, label: labelOf(f) },
        coins: w.coinsOf(f), recipient: key.recipient, amount: BigInt(key.amount), secretKey,
        engine, store: w.storeFor(owner), network: NETWORK,
      });
      secretKey = null;
      if (isCurrent()) {
        built.owner = owner;
        S.prepared = built;
        S.fundShort = null;
        S.fundingSent = false;
      }
    } catch (error) {
      if (isCurrent()) {
        S.prepared = null;
        if (error instanceof KusdtTransferError && error.code === "notEnoughKas") {
          S.fundShort = error.short;
          S.fundForChange = Boolean(error.forChangeCoin);
        } else {
          S.fundShort = null;
        }
        S.prepareError = messageFor(error);
      }
    } finally {
      S.preparing = false;
    }
    paintReview();
    if (S.rebuildWhenDone) {
      S.rebuildWhenDone = false;
      if (flow.current === "review" && !preparedIsCurrent()) await prepareSend();
    }
  }

  /** Fund This Address (iOS openFunding): Send Kaspa with this address as the recipient and the
   *  shortfall as the amount; when it closes, the review comes back and builds again. */
  async function openFunding() {
    const f = from();
    if (!f || S.fundShort == null) return;
    const { showSend } = await import("./send.js");
    const main = kusdtAccount();
    let sent = false;
    showSend({
      source: { kind: "main" }, fromAddress: main, navTitle: "Send Kaspa", title: KUSDT_TEXT.fundMemo,
      recipient: f.address, amountSompi: S.fundShort,
      onSent: () => { sent = true; },
      onClose: () => {
        if (!S.open) return;
        if (sent) S.fundingSent = true;
        flow.go("review");
        prepareAfterFunding(sent);
      },
    });
  }

  /** Built again until the KAS has landed (iOS prepareAfterFunding): every 3 s, 20 times after a
   *  send, 3 after a close without one. */
  async function prepareAfterFunding(sent) {
    const run = ++S.fundingRun;
    S.awaitingFunds = sent;
    paintReview();
    try {
      for (let attempt = 0; attempt < (sent ? 20 : 3); attempt += 1) {
        if (attempt > 0) await sleep(3000);
        if (run !== S.fundingRun || !S.open || flow.current !== "review") return;
        while (S.preparing) await sleep(200);
        if (attempt > 0 || sent) await w.refresh().catch(() => {});
        await prepareSend();
        if (S.prepared || S.fundShort == null) return;
      }
    } finally {
      if (run === S.fundingRun) { S.awaitingFunds = false; paintReview(); }
    }
  }

  /** The tap (iOS TokenSendView.send). A review older than 2 minutes is built again and shown, not
   *  sent; "Not confirmed" keeps the signed transaction, and Try Again resends that same one. */
  async function sendNow() {
    if (S.sending || !swipe) return;
    const screen = swipe;
    S.failure = null;
    S.sending = true;
    screen.setBusy(true);
    try {
      while (S.preparing) await sleep(200);
      const built = S.prepared;
      if (!built || !preparedIsCurrent()) {
        S.failure = S.prepareError || TRANSFER_MESSAGES.cantBuild;
        return;
      }
      if (!S.outcomeUnknown && isReviewStale(built)) {
        S.prepared = null;
        await prepareSend();
        while (S.preparing) await sleep(200);
        const outcome = staleReviewOutcome(built, preparedIsCurrent() ? S.prepared : null);
        S.failure = outcome.code === "cantBuild" ? (S.prepareError || outcome.message)
          : outcome.code === "feeChanged" ? sendFeeChangedError(outcome.feeSompi).message : outcome.message;
        return;
      }
      try {
        setSubmitAddress(built.from.address);
        const result = await w.submit(built, { retryingUnknown: S.outcomeUnknown });
        S.outcomeUnknown = false;
        screen.setSent({ txid: result.txid, amountText: formatKusdt(built.amount), recipient: shownRecipient(), explorerUrl: wallet.explorerTxUrl(result.txid) });
      } catch (error) {
        if (error?.code === SEND_OUTCOME_UNKNOWN) {
          S.outcomeUnknown = true;
          S.failure = error.notConfirmedMessage || TRANSFER_MESSAGES.notConfirmed;
        } else {
          S.failure = messageFor(error);
        }
      }
    } finally {
      S.sending = false;
      screen.setBusy(false);
      paintReview();
    }
  }

  // follow the balances while a step that shows them is up
  const off = W().subscribe(() => {
    if (!S.open) { off(); return; }
    if (flow.current === "from" && handle) {
      const box = handle.el?.querySelector("#kusdt-from-list");
      if (box) { box.innerHTML = unitText(fromListHtml()); bindFrom(); handle.refresh(); }
    }
  });

  w.refreshIfStale().catch(() => {});
  ensureEngine().catch(() => {});
  if (recipient) lookup.now();
  go(recipient ? (startFrom ? "amount" : "from") : "to");
}

// --- §6 Combine Coins ---------------------------------------------------------------------------

const COMBINE_LABELS = {
  release: "Release to Confirm", working: "Sending", workingDetail: "Broadcasting to the Kaspa BlockDAG...",
  done: "Coins Combined", recipientWord: "", failedFallback: "The transaction didn't go out.",
};

/** Combine Coins (iOS TokenCombineView): up to three of an address's coins into one, the extra
 *  KAS back to the address. */
export function openCombineCoins(holding, { onBack }) {
  const owner = kusdtAccount();
  if (!owner || !holding) return;
  const w = W();
  const C = { open: true, prepared: null, preparing: false, prepareError: null, sending: false, failure: null, outcomeUnknown: false };
  const here = () => C.open && app.dataset.screen === "kusdt-combine";
  const close = () => { if (screen.sending) return; C.open = false; onBack?.(); };
  const bodyHtml = () => {
    const coinCount = w.coinsOf(holding).length;
    const merging = C.prepared?.spentCoins.length ?? Math.min(coinCount, MAX_TOKEN_INPUTS);
    const p = C.prepared;
    const pending = C.preparing ? "…" : "--";
    return `
      <div class="ss-review-amount kusdt-review-amount">
        ${kusdtCoinIconHtml(44)}
        <span class="ss-review-eyebrow">${esc(labelOf(holding))}</span>
        <strong class="ss-review-big">${esc(`${merging} coins into 1`)}</strong>
      </div>
      <p class="ss-note">${esc(KUSDT_TEXT.combineNote)}</p>
      <div class="sk-card ss-review-card">
        ${reviewRowHtml("Combined", `<strong>${esc(p ? formatKusdt(p.amount) : "--")}</strong>`)}
        ${reviewRowHtml("KAS Held With It", `<strong>${esc(`${kas(BigInt(merging) * KAS_PER_COIN)} → ${kas(KAS_PER_COIN)}`)}</strong>`)}
        ${reviewRowHtml("Network Fee", `<strong>${esc(p ? kas(p.fee) : pending)}</strong>`)}
        ${reviewRowHtml("Back to This Address", `<strong>${esc(p ? kas(p.kasBack) : pending)}</strong>`)}
      </div>
      ${coinCount > MAX_TOKEN_INPUTS ? statusLine(KUSDT_ICONS.info, KUSDT_TEXT.combineMore) : ""}
      ${C.preparing ? spinnerLine(KUSDT_TEXT.building) : ""}
      ${!C.preparing && C.prepareError ? `<div class="kusdt-fund">${statusLine(KUSDT_ICONS.warning, C.prepareError, "bad")}
        <button type="button" class="link-button strong" id="kusdt-rebuild">Try Again</button></div>` : ""}`;
  };
  const paint = () => {
    if (!here()) return;
    screen.setBody(bodyHtml());
    screen.body.querySelector("#kusdt-rebuild")?.addEventListener("click", () => prepare());
    screen.setEnabled(Boolean(C.prepared) && !C.preparing);
  };
  const prepare = async () => {
    if (C.preparing) return;
    const isCurrent = () => C.open && kusdtAccount() === owner;
    C.preparing = true;
    C.prepareError = null;
    paint();
    try {
      const engine = await ensureEngine();
      let secretKey = await secretKeyFor(holding);
      const built = await prepareCombine({
        from: { address: holding.address, holdingId: holding.id, label: labelOf(holding) }, coins: w.coinsOf(holding), secretKey,
        engine, store: w.storeFor(owner), network: NETWORK,
      });
      secretKey = null;
      if (isCurrent()) { built.owner = owner; C.prepared = built; }
    } catch (error) {
      if (isCurrent()) { C.prepared = null; C.prepareError = messageFor(error); }
    } finally {
      C.preparing = false;
    }
    paint();
  };
  const combineNow = async () => {
    if (C.sending) return;
    C.failure = null;
    C.sending = true;
    screen.setBusy(true);
    try {
      while (C.preparing) await sleep(200);
      const built = C.prepared;
      if (!built) { C.failure = C.prepareError || TRANSFER_MESSAGES.cantBuild; return; }
      if (!C.outcomeUnknown && isReviewStale(built)) {
        C.prepared = null;
        await prepare();
        const outcome = staleReviewOutcome(built, C.prepared);
        C.failure = outcome.code === "feeChanged" ? sendFeeChangedError(outcome.feeSompi).message
          : outcome.code === "cantBuild" ? (C.prepareError || outcome.message) : outcome.message;
        return;
      }
      try {
        setSubmitAddress(built.from.address);
        const result = await w.submit(built, { retryingUnknown: C.outcomeUnknown });
        C.outcomeUnknown = false;
        screen.setSent({ txid: result.txid, explorerUrl: wallet.explorerTxUrl(result.txid) });
      } catch (error) {
        if (error?.code === SEND_OUTCOME_UNKNOWN) { C.outcomeUnknown = true; C.failure = error.notConfirmedMessage || TRANSFER_MESSAGES.notConfirmed; }
        else C.failure = messageFor(error);
      }
    } finally {
      C.sending = false;
      screen.setBusy(false);
      paint();
    }
  };
  const screen = showSwipeUp({
    screen: "kusdt-combine", title: "Combine Coins", barTitle: "Swipe up to Combine", labels: COMBINE_LABELS,
    onCancel: close, getPreview: () => ({}), getFailureMessage: () => C.failure,
    onAction: () => { combineNow(); }, onDone: close,
  });
  paint();
  prepare();
}

// --- §7 Manage kUSDT ----------------------------------------------------------------------------

/** Manage kUSDT (iOS TokenManageView). Also where a "Received X kUSDT" notification goes. */
export function openManageKusdt({ onBack }) {
  if (!kusdtAccount()) return;
  const w = W();
  const back = () => openManageKusdt({ onBack });
  let used = new Set();
  let discovering = null; // { checking, found }
  let actions = null;
  let summary = "";

  // Manage Addresses' Used: ever used or holding KAS, as last known
  wallet.knownUsedAddresses?.().then((list) => {
    const known = new Set((list || []).map((a) => String(a).toLowerCase()));
    used = new Set((w.heldHoldings() || []).filter((h) => h.spendingIndex != null && known.has(h.address.toLowerCase())).map((h) => h.spendingIndex));
  }).catch(() => {});

  const rowHtml = (h) => {
    const chatting = h.spendingIndex == null;
    const isUsed = isHoldingUsed(h, { usedIndices: used, activity: w.activity() });
    return `
      <div class="glass address-card kusdt-row" data-open="${esc(h.id)}" role="button" tabindex="0">
        <div class="address-card-main">
          <span class="muted small medium kusdt-row-label">${esc(labelOf(h))}<span class="kusdt-row-icon${chatting ? " accent" : ""}">${chatting ? KUSDT_ICONS.chat : ""}</span></span>
          <span class="mono small">${esc(shortKusdtAddress(h.address))}</span>
          <span class="strong small">${esc(formatKusdt(h.units))}</span>
          <span class="muted tiny">${esc(`${kas(BigInt(h.coinCount) * KAS_PER_COIN)} held with it`)}</span>
          <span class="address-status"><span class="used-badge ${isUsed ? "used" : "unused"}">${isUsed ? "Used" : "Unused"}</span></span>
        </div>
        <button class="icon plain card-menu" data-menu="${esc(h.id)}" aria-label="Address Actions">${KUSDT_ICONS.ellipsisVertical}</button>
      </div>`;
  };

  const paint = () => {
    const units = w.balance();
    const rows = w.listed();
    const hidden = w.hiddenCount();
    const held = w.heldHoldings();
    const busy = Boolean(discovering);
    render(`
      <header class="navbar">
        <button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button>
        <div class="nav-title">Manage ${esc(SYMBOL)}</div>
        <div class="nav-right"><button class="icon plain accent" id="kusdt-refresh" aria-label="Refresh" title="Refresh" ${w.refreshing ? "disabled" : ""}>${KUSDT_ICONS.refresh}</button></div>
      </header>
      <div class="manage-scroll">
        <div class="bal-card kusdt-total">
          <div class="bal-card-label">Total Balance</div>
          <div class="bal-card-amount">${units == null ? '<span class="spinner small-spin"></span>' : esc(formatKusdt(units))}</div>
          ${units != null ? `<div class="bal-card-detail">${esc(kusdtDollars(units))}</div>` : ""}
          <button type="button" class="sk-chip kusdt-bridged" id="kusdt-about">Bridged by ${esc(KUSDT_TOKEN.issuer)}${KUSDT_ICONS.info}</button>
        </div>
        <button type="button" class="glass nav-row kusdt-open-trestly" id="kusdt-open-trestly">
          <span class="nav-row-label"><span class="accent">${KUSDT_ICONS.safari}</span><span>Open Trestly</span></span>${ICONS.chevron}
        </button>
        ${w.error ? statusLine(KUSDT_ICONS.warning, `Couldn't check ${SYMBOL} just now: ${w.error} Refresh to try again.`, "warn") : ""}
        ${w.refreshing ? spinnerLine(`Checking your ${SYMBOL}...`) : ""}
        ${rows.map(rowHtml).join("")}
        ${held != null && held.length === 0 && rows.length <= 1 ? `
          <div class="km-empty kusdt-empty">${kusdtCoinIconHtml(44)}<div class="km-title">${esc(KUSDT_TEXT.emptyTitle)}</div>
          <p class="muted small">${esc(KUSDT_TEXT.emptyText)}</p></div>` : ""}
        ${hidden > 0 ? `<button type="button" class="link-button kusdt-hidden-note" id="kusdt-hidden">${esc(`${hidden} hidden: they still count in the total.`)}</button>` : ""}
        <div class="fab-room"></div>
      </div>
      <button class="fab" id="kusdt-actions" aria-label="${esc(SYMBOL)} Actions" title="${esc(SYMBOL)} Actions" ${busy ? "disabled" : ""}>${busy ? '<span class="spinner small-spin"></span>' : KUSDT_ICONS.sliders}</button>`, "kusdt-manage");
    $("#back").onclick = onBack;
    $("#kusdt-refresh").onclick = async () => { await w.discover().catch(() => null); };
    $("#kusdt-about").onclick = () => openAboutKusdt({ onBack: back });
    // Open Trestly (K iOS 518fdc8c, owner 2026-11-23): Trestly's site, for its pool and everything
    // else there. K iOS shows it inside the app connected to one address; here it is a new tab.
    $("#kusdt-open-trestly").onclick = () => openExternal(kusdtDeployment(NETWORK).siteUrl);
    $("#kusdt-actions").onclick = openActions;
    const hiddenNote = $("#kusdt-hidden");
    if (hiddenNote) hiddenNote.onclick = () => openVisibility({ onBack: back });
    for (const card of app.querySelectorAll("[data-open]")) {
      card.onclick = (event) => {
        if (event.target.closest("[data-menu]")) return;
        openAddressPage(card.dataset.open, { onBack: back });
      };
      card.onkeydown = (event) => { if (event.key === "Enter") card.click(); };
    }
    for (const button of app.querySelectorAll("[data-menu]")) button.onclick = () => rowMenu(button.dataset.menu);
  };

  const rowMenu = (id) => {
    const h = w.holdingById(id);
    if (!h) return;
    // The Chatting Address's menu has only Copy, Show QR Code and Combine Coins (KaChat iOS
    // 148a5331): it can't be renamed, hidden or sent to itself.
    const chatting = h.spendingIndex == null;
    showSheet({
      title: labelOf(h),
      subtitle: shortKusdtAddress(h.address),
      cancel: false,
      rows: [
        ...(chatting ? [] : [{ label: "Rename Address", subtitle: "Gives this address a label of your own.", icon: ICONS.pencil, onClick: () => rename(h) }]),
        { label: "Copy Address", subtitle: "Puts the full address on the clipboard.", icon: ICONS.doc, onClick: () => copyText(h.address) },
        { label: "Show QR Code", subtitle: "Full screen, for scanning with another device.", icon: ICONS.qr, onClick: () => openKusdtReceive({ fixedHolding: h, onBack: back }) },
        ...(chatting ? [] : [{
          label: "Send to Chatting Address", subtitle: "Moves kUSDT from this address to your Chatting Address.", icon: KUSDT_ICONS.send,
          disabled: !(h.units > 0n),
          onClick: () => openKusdtSend({ startFrom: h, recipient: kusdtAccount(), recipientName: "Chatting Address", onBack: back }),
        }]),
        ...(h.coinCount > 1 ? [{ label: "Combine Coins", subtitle: "Merges its coins into one and gives the extra KAS back.", icon: KUSDT_ICONS.merge, onClick: () => openCombineCoins(h, { onBack: back }) }] : []),
        ...(chatting ? [] : [{
          label: "Hide Address", subtitle: `Removes it from this list. Re-enable it in ${SYMBOL} Address Visibility.`, icon: KUSDT_ICONS.eyeSlash, tint: "orange",
          onClick: () => { if (w.isListed(h)) w.toggleListed(h); paint(); toast(`Address hidden. Re-enable it in ${SYMBOL} Address Visibility.`); },
        }]),
      ],
    });
  };

  const rename = (h) => showAlert({
    title: "Rename Address",
    message: "Give this address a label to help you recognize it.",
    field: { placeholder: "Label", value: kusdtCustomLabel(h.spendingIndex) },
    confirmLabel: "Save",
    cancelLabel: "Cancel",
    onConfirm: async (value) => {
      try { await wallet.setSpendingLabel(h.spendingIndex, String(value || "").trim()); } catch (error) { toast(error.message); }
      try { await syncKusdtAccount(); } catch { /* the label shows on the next sync */ }
      if (app.dataset.screen === "kusdt-manage") paint();
    },
  });

  // kUSDT Actions (iOS actionsSheet): Generate, Discover, Visibility. Discover belongs to the
  // screen: closing the sheet doesn't stop it.
  const actionRows = () => [
    { label: "Generate New Address", subtitle: "Adds a brand-new regular address of yours to this list.", icon: KUSDT_ICONS.plusSquares, disabled: Boolean(discovering), onClick: generate },
    { label: "Discover kUSDT Addresses", subtitle: "Finds your addresses holding kUSDT.", icon: KUSDT_ICONS.magnifier, disabled: Boolean(discovering), keepOpen: true, onClick: runDiscover },
    { label: "kUSDT Address Visibility", subtitle: "Check off which addresses holding kUSDT are on the list.", icon: KUSDT_ICONS.checklist, disabled: Boolean(discovering), onClick: () => openVisibility({ onBack: back }) },
  ];
  const footerHtml = () => {
    if (discovering) {
      return `<div class="discovery">
        <span class="spinner"></span>
        <div class="strong">Checking address #${discovering.checking}</div>
        <div class="muted small">${esc(discovering.found ? `${discovering.found} found so far` : `No addresses with ${SYMBOL} yet`)}</div>
        <button class="sheet-row center-text" id="kusdt-keep-scanning"><span class="sheet-label accent">Close and Keep Scanning</span></button>
      </div>`;
    }
    return summary ? `<p class="muted small strong sheet-summary center-text">${esc(summary)}</p>` : "";
  };
  const bindKeep = () => {
    const keep = document.querySelector("#kusdt-keep-scanning");
    if (keep) keep.onclick = () => actions?.close();
  };
  const refreshActions = () => {
    if (!actions?.isOpen()) return;
    actions.update({ rows: discovering ? [] : actionRows(), footerHtml: footerHtml() });
    bindKeep();
  };
  function openActions() {
    summary = "";
    actions = showSheet({ title: `${SYMBOL} Actions`, cancel: false, rows: discovering ? [] : actionRows(), footerHtml: footerHtml() });
    bindKeep();
  }
  async function generate() {
    const number = await w.generateFresh().catch(() => null);
    try { await syncKusdtAccount(); } catch { /* shown on the next sync */ }
    if (number != null) toast(`Address #${number} is ready.`);
    if (app.dataset.screen === "kusdt-manage") paint();
  }
  async function runDiscover() {
    if (discovering) return;
    const owner = kusdtAccount();
    discovering = { checking: 0, found: 0 };
    refreshActions();
    if (app.dataset.screen === "kusdt-manage") paint();
    let found = null;
    try {
      found = await w.discover((checking, soFar) => {
        if (!discovering) return;
        discovering.checking = checking;
        discovering.found = soFar;
        refreshActions();
      });
    } finally {
      discovering = null;
    }
    try { await syncKusdtAccount(); } catch { /* shown on the next sync */ }
    if (kusdtAccount() !== owner) return;
    if (found != null) {
      summary = found === 0 ? `No addresses with ${SYMBOL} found.` : `Found ${found} addresses with ${SYMBOL}.`;
      toast(summary);
    }
    refreshActions();
    if (app.dataset.screen === "kusdt-manage") paint();
  }

  show("kusdt-manage", paint);
  w.refreshIfStale().catch(() => {});
}

// --- §7 kUSDT Address Visibility -------------------------------------------------------------

function openVisibility({ onBack }) {
  const w = W();
  let page = 0;
  let token = 0;
  let rows = null;
  const load = async () => {
    const mine = ++token;
    const owner = kusdtAccount();
    rows = null;
    paint();
    const start = page * KUSDT_VISIBILITY_PAGE;
    const end = start + KUSDT_VISIBILITY_PAGE;
    const held = new Map((w.heldHoldings() || []).filter((h) => h.spendingIndex != null).map((h) => [h.spendingIndex, h]));
    let derived = new Map();
    try { derived = await kusdtAddressesInRange(start, end); } catch { derived = new Map(); }
    if (mine !== token || kusdtAccount() !== owner) return;
    rows = [];
    for (let i = start; i < end; i += 1) {
      const h = held.get(i) || (derived.get(i) ? makeHolding(i, derived.get(i), 0n, 0) : null);
      if (h) rows.push(h);
    }
    if (app.dataset.screen === "kusdt-visibility") paint();
  };
  const amountTag = (u) => (u > 0n ? `<span class="accent tiny">${esc(formatKusdt(u))}</span>` : '<span class="muted tiny">Unused</span>');
  const paint = () => {
    const owner = kusdtAccount();
    const start = page * KUSDT_VISIBILITY_PAGE;
    const end = start + KUSDT_VISIBILITY_PAGE;
    const chatting = (w.heldHoldings() || []).find((h) => h.spendingIndex == null);
    render(`
      <header class="navbar form-bar">
        <button class="bar-text" id="kusdt-hide-all">Hide All</button>
        <div class="nav-title">${esc(SYMBOL)} Address Visibility</div>
        <button class="bar-text strong" id="done">Done</button>
      </header>
      <div class="manage-scroll flush">
        <div class="plain-list">
          ${page === 0 && owner ? `<div class="vis-row kusdt-vis-fixed">
            <span class="accent">${ICONS.circleCheck}</span>
            <span class="tx-meta"><span><span class="strong small mono-digits">#0</span> <span class="muted tiny">Chatting Address</span></span>
              <span class="mono tiny muted">${esc(visibilityShortAddress(owner))}</span></span>
            ${amountTag(chatting?.units ?? 0n)}
          </div>` : ""}
          ${rows == null ? '<div class="center-text pad"><span class="spinner"></span></div>'
            : !rows.length ? `<p class="muted center-text pad">${esc(KUSDT_TEXT.visibilityEmptyPage)}</p>`
            : rows.map((h) => {
              const on = w.isListed(h);
              return `<button class="vis-row" data-vis="${h.spendingIndex}" data-address="${esc(h.address)}" aria-pressed="${on}">
                <span class="${on ? "accent" : "muted"}">${on ? ICONS.circleCheck : ICONS.circle}</span>
                <span class="tx-meta"><span class="strong small mono-digits">#${addressNumber(h.spendingIndex)}</span>
                  <span class="mono tiny muted">${esc(visibilityShortAddress(h.address))}</span></span>
                ${amountTag(h.units)}
              </button>`;
            }).join("")}
        </div>
      </div>
      <div class="pager">
        <button class="icon plain accent" id="prev" ${page === 0 ? "disabled" : ""} aria-label="Previous page">${KUSDT_ICONS.chevronLeft}</button>
        <span class="strong small mono-digits">#${page === 0 ? 0 : addressNumber(start)} - #${addressNumber(end - 1)}</span>
        <button class="icon plain accent" id="next" aria-label="Next page">${KUSDT_ICONS.chevronRight}</button>
      </div>`, "kusdt-visibility");
    $("#done").onclick = onBack;
    $("#prev").onclick = () => { if (page > 0) { page -= 1; load(); } };
    $("#next").onclick = () => { page += 1; load(); };
    $("#kusdt-hide-all").onclick = () => showAlert({
      title: "Hide All Addresses?",
      message: `Manage ${SYMBOL} starts over with only your Chatting Address. Nothing is lost: bring any address back here, and its ${SYMBOL} still counts in your total.`,
      confirmLabel: "Hide All",
      cancelLabel: "Cancel",
      onConfirm: () => { w.hideAll(); paint(); },
    });
    for (const button of app.querySelectorAll("[data-vis]")) {
      button.onclick = () => {
        const index = Number(button.dataset.vis);
        const held = (w.heldHoldings() || []).find((h) => h.spendingIndex === index);
        w.toggleListed(held || makeHolding(index, button.dataset.address || "", 0n, 0));
        paint();
      };
    }
  };
  show("kusdt-visibility", paint);
  load();
}

// --- §8 An address's page ------------------------------------------------------------------------

function activityRowHtml(row) {
  const txid = /^[0-9a-f]{64}$/i.test(String(row.id).split(":")[0]) ? String(row.id).split(":")[0].toLowerCase() : null;
  const isIn = row.kind === "received" || row.kind === "bridged" || (row.kind === "swapped" && row.outgoing !== true);
  const sign = row.kind === "combined" ? "" : (isIn ? "+" : "-");
  const cls = row.kind === "combined" ? "accent" : (isIn ? "in" : "out");
  const title = { received: "Received", sent: "Sent", swapped: "Swapped", bridged: "Bridged In", combined: "Combined Coins" }[row.kind] || row.kind;
  const icon = row.kind === "combined" ? KUSDT_ICONS.merge : (isIn ? KUSDT_ICONS.arrowDown : KUSDT_ICONS.arrowUp);
  const tag = txid ? "button" : "div";
  return `<${tag} class="list-row ios-tx kusdt-activity"${txid ? ` data-tx="${txid}"` : ""}>
    <span class="ios-tx-icon kusdt-activity-icon ${cls}">${icon}</span>
    <span class="tx-meta">
      <span class="ios-tx-title ${cls}">${esc(title)}${row.pending ? ' <span class="kusdt-pending">Pending</span>' : ""}</span>
      <span class="mono tiny muted">${esc(middle(txid || row.counterparty, 6))}</span>
      <span class="tiny muted">${esc(dateText(row.date))}</span>
    </span>
    <span class="ios-tx-right">
      <span class="ios-tx-amount ${cls}">${esc(`${sign}${formatKusdt(row.units)}`)}</span>
      ${row.fee != null ? `<span class="tiny muted">${esc(`Fee ${kusdtFeeText(row.fee, KAS_UNIT)}`)}</span>` : ""}
    </span>
    ${txid ? `<span class="accent">${KUSDT_ICONS.openExternal}</span>` : ""}
  </${tag}>`;
}

function openAddressPage(id, { onBack }) {
  const w = W();
  const back = () => openAddressPage(id, { onBack });
  const paint = () => {
    const h = w.holdingById(id);
    if (!h) { onBack(); return; }
    const rows = w.activity(h);
    render(`
      <header class="navbar">
        <button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button>
        <div class="nav-title">${esc(labelOf(h))}</div>
        <div class="nav-right bar-circles"><button class="bar-circle" id="kusdt-page-options" aria-label="Address Actions" title="Address Actions">${KUSDT_ICONS.ellipsis}</button></div>
      </header>
      <div class="manage-scroll">
        <div class="bal-card">
          <div class="bal-card-label">${esc(labelOf(h))}</div>
          <div class="bal-card-amount">${esc(formatKusdt(h.units))}</div>
          <div class="bal-card-detail">${esc(`${kas(BigInt(h.coinCount) * KAS_PER_COIN)} held with it`)}</div>
        </div>
        <div class="kusdt-section-label">${esc(SYMBOL)} History</div>
        ${rows.length
    ? `<div class="glass list">${rows.map(activityRowHtml).join("")}</div>`
    : `<div class="km-empty"><div class="km-title">${esc(KUSDT_TEXT.historyEmpty)}</div><p class="muted small">${esc(KUSDT_TEXT.historyEmptyNote)}</p></div>`}
      </div>
      <div class="ios-bottom-bar">
        <button class="ios-capsule with-icon" id="kusdt-receive">${ICONS.qr}<span>Receive</span></button>
        <button class="ios-capsule with-icon" id="kusdt-send" ${h.units > 0n ? "" : "disabled"}>${KUSDT_ICONS.send}<span>Send</span></button>
      </div>`, "kusdt-address");
    $("#back").onclick = onBack;
    $("#kusdt-receive").onclick = () => openKusdtReceive({ fixedHolding: h, onBack: back });
    $("#kusdt-send").onclick = () => { if (h.units > 0n) openKusdtSend({ startFrom: h, onBack: back }); };
    $("#kusdt-page-options").onclick = () => showSheet({
      title: "Address Actions",
      cancel: false,
      rows: [
        ...(h.coinCount > 1 ? [{ label: "Combine Coins", subtitle: "Merges its coins into one and gives the extra KAS back.", icon: KUSDT_ICONS.merge, onClick: () => openCombineCoins(h, { onBack: back }) }] : []),
        { label: "View in Explorer", subtitle: "This address on the Kaspa explorer.", icon: ICONS.safari, onClick: () => openExternal(wallet.explorerAddressUrl(h.address)) },
      ],
    });
    for (const row of app.querySelectorAll("[data-tx]")) row.onclick = () => openExternal(wallet.explorerTxUrl(row.dataset.tx));
  };
  show("kusdt-address", paint);
}

// --- §9 About kUSDT --------------------------------------------------------------------------------

export function openAboutKusdt({ onBack }) {
  render(`
    ${`<header class="navbar"><button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button><div class="nav-title">About ${esc(SYMBOL)}</div></header>`}
    <div class="manage-scroll kusdt-about">
      <div class="kusdt-about-head">${kusdtCoinIconHtml(40)}<strong>Bridged by ${esc(KUSDT_TOKEN.issuer)}</strong></div>
      <p>${esc(KUSDT_TEXT.aboutText)}</p>
      ${statusLine(KUSDT_ICONS.warning, KUSDT_TEXT.risk, "warn")}
      <p>${esc(KUSDT_TEXT.aboutCoin)}</p>
      <div class="kusdt-about-links">
        <a class="sk-chip" href="${esc(KUSDT_TOKEN.backingURL)}" target="_blank" rel="noopener noreferrer">${KUSDT_ICONS.sealCheck}<span>View the Vault</span></a>
        <a class="sk-chip" href="${esc(KUSDT_TOKEN.issuerSite)}" target="_blank" rel="noopener noreferrer">${KUSDT_ICONS.safari}<span>${esc(KUSDT_TOKEN.issuer)}</span></a>
      </div>
    </div>`, "kusdt-about");
  $("#back").onclick = onBack;
}

// --- §10 Receive kUSDT ----------------------------------------------------------------------------

/** Receive kUSDT (iOS TokenReceiveSheet): Fresh Address first, or the Chatting Address; from an
 *  address's page or row (`fixedHolding`) that address only. */
export function openKusdtReceive({ fixedHolding = null, onBack }) {
  const owner = kusdtAccount();
  if (!owner) return;
  const w = W();
  const R = { useFresh: true, fresh: fixedHolding ? null : w.freshReceive() };
  const paint = async () => {
    const address = fixedHolding ? fixedHolding.address : (R.useFresh ? (R.fresh?.address || "") : owner);
    const screen = fixedHolding ? (fixedHolding.spendingIndex == null ? "kusdt-chatting" : "kusdt-spending") : (R.useFresh ? "kusdt-fresh" : "kusdt-chatting");
    const { privacy, notes } = receiveNotesFor(screen);
    render(`
      <header class="navbar">
        <button class="nav-back" id="back" aria-label="Done">${ICONS.back}<span>Done</span></button>
        <div class="nav-title"></div>
      </header>
      <section class="rcv" id="qr-page" title="Click anywhere to copy">
        <div class="rcv-head">${kusdtCoinIconHtml(30)}<h2>Receive ${esc(SYMBOL)}</h2></div>
        ${fixedHolding ? `<div class="rcv-name"><div class="rcv-label">${esc(labelOf(fixedHolding))}</div></div>` : `
          <div class="sel-pills kusdt-receive-pills">
            <button type="button" class="sel-pill ${R.useFresh ? "on" : ""}" id="kusdt-fresh" aria-pressed="${R.useFresh}">Fresh Address</button>
            <button type="button" class="sel-pill ${R.useFresh ? "" : "on"}" id="kusdt-chatting" aria-pressed="${!R.useFresh}">Chatting Address</button>
          </div>`}
        <div class="rcv-qr"><canvas id="qr" width="512" height="512" aria-label="QR code"></canvas></div>
        <div class="rcv-address-block">
          <div class="rcv-address">${esc(address || "…")}</div>
          ${privacy ? noteHtml(privacy, "rcv-privacy") : ""}
        </div>
        <p class="rcv-hint">Tap anywhere to copy</p>
        ${notes.length ? `<div class="rcv-notes">${notes.map((n) => noteHtml(n, "rcv-note")).join("")}</div>` : ""}
      </section>`, "kusdt-receive");
    $("#back").onclick = onBack;
    const fresh = $("#kusdt-fresh");
    if (fresh) fresh.onclick = (event) => { event.stopPropagation(); R.useFresh = true; paint(); };
    const chatting = $("#kusdt-chatting");
    if (chatting) chatting.onclick = (event) => { event.stopPropagation(); R.useFresh = false; paint(); };
    $("#qr-page").onclick = async (event) => {
      if (String(window.getSelection?.() || "").trim() || event.target.closest("button, a") || !address) return;
      await copyText(address);
      // a fresh address handed out goes on the list from now on (iOS revealIfFresh)
      if (!fixedHolding && R.useFresh && R.fresh && kusdtAccount() === owner) {
        try { await revealKusdtSlot(R.fresh.index, owner); } catch { /* shown on the next Discover */ }
      }
    };
    if (address) { try { await drawKaspaQr($("#qr"), address, { dark: "#000000", light: "#ffffff" }); } catch { /* the address is still there to copy */ } }
  };
  show("kusdt-receive", paint);
}

// --- §12 The kUSDT Guide --------------------------------------------------------------------------

const GUIDE_CARDS = [
  { icon: "dollarCircle", title: "What It Is", detail: KUSDT_TEXT.aboutText },
  { icon: "wallet", title: "Where It Lives", detail: "Your Chatting Address and your regular addresses can hold kUSDT. Quantum-resistant addresses can't. Receive gives you a fresh regular address, so a payment isn't tied to your .kachat name." },
  { icon: "hexagons", title: "1.5 KAS in Every Coin", detail: KUSDT_TEXT.aboutCoin },
  { icon: "arrowUp", title: "Sending kUSDT", detail: "A send takes a little KAS from the same address for the network fee, plus 1.5 KAS for your change coin when you keep some kUSDT. If the address is short, Fund This Address tops it up from another of your addresses." },
  { icon: "merge", title: "Combine Coins", detail: "Each payment you receive is its own coin with its own 1.5 KAS. Combine Coins, in an address's menu, merges them into one and gives the extra KAS back." },
  // the K-Desktop wording (owner, 2026-11-20): Trestly's own site, in a new tab
  { icon: "swap", title: "Swapping", detail: "To swap KAS and kUSDT, click Swap on the Wallet tab and choose kUSDT (Kaspa). K trades it through Trestly's pool with Trestly's own code, and asks you to approve each swap before anything is signed. To add to the pool, click Open Trestly in Manage kUSDT." },
  { icon: "clock", title: "History", detail: "kUSDT history is kept in this browser: sends, combines and payments received from now on. What happened before, or in another app, isn't shown." },
  { icon: "warning", title: "The Risks", detail: KUSDT_TEXT.risk, tone: "warn" },
];

export function openKusdtGuide({ onBack }) {
  render(`
    <header class="navbar"><button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button><div class="nav-title">kUSDT Guide</div></header>
    <div class="manage-scroll kusdt-guide">
      <div class="kusdt-guide-head">${kusdtCoinIconHtml(48)}<span class="tx-meta"><strong>kUSDT</strong><span class="muted small">A dollar stablecoin on Kaspa</span></span></div>
      ${GUIDE_CARDS.map((c) => `<div class="glass kusdt-guide-card"${c.tone ? ` data-tone="${c.tone}"` : ""}>
        <span class="kusdt-guide-icon">${KUSDT_ICONS[c.icon] || ""}</span>
        <span class="tx-meta"><strong class="small">${esc(c.title)}</strong><span class="muted small">${esc(c.detail)}</span></span>
      </div>`).join("")}
    </div>`, "kusdt-guide");
  $("#back").onclick = onBack;
}
