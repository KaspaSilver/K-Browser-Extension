// Managing your addresses - a 1:1 port of the iOS screens:
//
//   ChattingAddressManageView   Balance, History | UTXOs | .kachat on the underline tab bar,
//                               Receive / Send; the options button opens Address Actions
//   ManageAddressesView         Total Balance, Address Actions (Generate, Discover, Address
//                               Visibility), one card per spending address with its own actions
//                               sheet (Rename, Copy, Show QR Code, Set as Primary, Hide)
//   SpendingAddressTransactionHistoryView   one spending address: History | UTXOs | .kachat (iOS
//                               5.2 dropped its KNS Domains tab: .kas names live in Your Domains),
//                               Receive / Send; the options button opens Address Actions
//   SpendingAddressVisibilityView, the private / public key sheets, Rename UTXO, the Transaction
//   sheet.
//
// Left out because the extension has no counterpart: "Notify on receive" (no notifications) and
// the Chat Privacy tab (chats only).

import { remember } from "./dock.js";
import * as wallet from "./wallet.js";
import * as vault from "./vault.js";
import {
  app, esc, render, $, toast, copyText, copySecret, ICONS, navHeader, showQr, showSheet, showAlert,
  passwordGate, groupedKas8, RECEIVE_NOTES, balanceCardHtml, settings,
} from "./ui.js";
import { IS_TESTNET } from "./net.js";

// What a balance card's amount is worth (mainnet only): the price is read once per page, then the
// screen that asked repaints with it.
let fiatEntry = null;
let fiatLoading = false;
/** The worth of `sompi` in your currency for a balance card, or "" (testnet, no price yet). */
export function fiatTextFor(sompi, repaint) {
  if (IS_TESTNET || sompi == null) return "";
  if (!fiatEntry && !fiatLoading) {
    fiatLoading = true;
    (async () => {
      try { fiatEntry = await wallet.price((await settings()).currency || "usd"); } catch { fiatEntry = null; }
      fiatLoading = false;
      if (fiatEntry?.price) repaint?.();
    })();
  }
  return fiatEntry?.price ? wallet.formatFiat(sompi, fiatEntry) : "";
}

/** A spending address's receive screen (KaPay iOS e188209): a regular one takes Kaspa and kUSDT; a
 *  quantum-resistant one takes Kaspa only, and says not to send kUSDT there. */
function spendingReceive({ label, address, index, onBack }) {
  const quantum = wallet.isQuantumIndex(index);
  showQr({
    heading: "Receive Kaspa", label, address, backLabel: "Close", onBack,
    privacy: quantum ? RECEIVE_NOTES.quantum : RECEIVE_NOTES.spending,
    notes: quantum ? [RECEIVE_NOTES.kaspaOnly, RECEIVE_NOTES.noKusdtQuantum] : [RECEIVE_NOTES.kaspaAndKusdt],
  });
}
import { showSend } from "./send.js";
import { kachatWordmark } from "./market.js";
import { addressNamesTab, showLiveNameDetail } from "./kachat-live.js";
import { addressDomainsTab } from "./address-domains.js";
import { kachatRegistry } from "./kachat-names.js";
import { kachatLabel } from "./kachat-label.js";
import { followAccount } from "./approve.js";
import { carryAccountData } from "./account-data.js";
import { shownActiveAccount, SWITCHED_ELSEWHERE } from "./account-scope.js";
import { sompiFromUserText } from "./amounts.js";
import { showAddToPortfolio } from "./portfolio.js";
import { loadOwnAddresses, ownAddressLabel } from "./own-addresses.js";
import { bindSwipeToHide } from "./swipe-hide.js";
import { kusdtListedIndices } from "./kusdt.js";
import { KUSDT_LISTED_HIDE_MESSAGE, KUSDT_LISTED_ALERT_TITLE } from "../shared/ui/kusdt-wallet.js";

/** §11 (K-Desktop, KaPay iOS 3d126db): an address Manage kUSDT lists stays on Manage Addresses.
 *  True (and the alert shown) when hiding `index` is refused. */
function refuseHidingKusdtListed(index) {
  if (!kusdtListedIndices().has(Number(index))) return false;
  showAlert({ title: KUSDT_LISTED_ALERT_TITLE, message: KUSDT_LISTED_HIDE_MESSAGE, confirmLabel: "OK" });
  return true;
}

// The quantum-safe shield (iOS bba1b1e): green while the address's key has never been on chain
// (receiving any number of times is fine); slashed once it has spent - orange when funds sit on it
// again, gray when empty.
const SHIELD = '<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2 4 5.3v6.2c0 5 3.4 9.3 8 10.5 4.6-1.2 8-5.5 8-10.5V5.3Z" fill="currentColor"/></svg>';
const SHIELD_SLASH = '<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><defs><mask id="q-shield-cut"><rect width="24" height="24" fill="#fff"/><path d="M3.5 3.5 20.5 20.5" stroke="#000" stroke-width="5.4" stroke-linecap="round"/></mask></defs><path mask="url(#q-shield-cut)" d="M12 2.2 4 5.3v6.2c0 5 3.4 9.3 8 10.5 4.6-1.2 8-5.5 8-10.5V5.3Z" fill="currentColor"/><path d="M3.5 3.5 20.5 20.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
export function quantumShieldHtml(row) {
  if (!row?.quantum) return "";
  return row.spent
    ? `<span class="q-shield ${row.balanceSompi > 0n ? "q-funded" : "q-empty"}" role="img" aria-label="Key revealed by a spend" title="Key revealed by a spend">${SHIELD_SLASH}</span>`
    : '<span class="q-shield q-safe" role="img" aria-label="Quantum-safe" title="Quantum-safe">' + SHIELD + "</span>";
}

// SF Symbols these screens use, drawn to match.
// shield.fill / circle.grid.2x2.fill: Address Visibility's two chains
const SHIELD_FILL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 4.5 5.5v6c0 4.8 3.2 8.9 7.5 10 4.3-1.1 7.5-5.2 7.5-10v-6Z" fill="currentColor"/></svg>';
const GRID_FILL = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7.5" cy="7.5" r="3.6" fill="currentColor"/><circle cx="16.5" cy="7.5" r="3.6" fill="currentColor"/><circle cx="7.5" cy="16.5" r="3.6" fill="currentColor"/><circle cx="16.5" cy="16.5" r="3.6" fill="currentColor"/></svg>';

const SF = {
  // shield: Generate Quantum-Resistant Address
  shield: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2 5 6v5.4c0 4.4 3 8.2 7 9.4 4-1.2 7-5 7-9.4V6Z"/></svg>',
  // arrow.up.circle: Send to Chatting Address
  arrowUpCircle: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M12 16.5v-9M8 11l4-4 4 4"/></svg>',
  arrowUpFill: '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 17V7.5M7.8 11.5L12 7.3l4.2 4.2" fill="none" stroke="var(--bg)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // arrow.up.circle.fill on an accent capsule: a black disc with the arrow cut out in the accent.
  sendFill: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 17V7.5M7.8 11.5L12 7.3l4.2 4.2" fill="none" stroke="var(--kaspa)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chartPieFill: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3.1A9 9 0 1 0 20.9 13H11z" fill="currentColor"/><path d="M13 2.6V11h8.4A8.6 8.6 0 0 0 13 2.6z" fill="currentColor"/></svg>',
  arrowDownFill: '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7v9.5M7.8 12.5l4.2 4.2 4.2-4.2" fill="none" stroke="var(--bg)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  upRightSquare: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9.5 14.5l6-6M10 8.5h5.5V14"/></svg>',
  cube: '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l9 5v10l-9 5-9-5V7z" fill="currentColor"/><path d="M3 7l9 5 9-5M12 12v10" fill="none" stroke="var(--bg)" stroke-width="1.4"/></svg>',
  grid: '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.5" fill="currentColor"/><circle cx="9" cy="9" r="2" fill="var(--bg)"/><circle cx="15" cy="9" r="2" fill="var(--bg)"/><circle cx="9" cy="15" r="2" fill="var(--bg)"/><circle cx="15" cy="15" r="2" fill="var(--bg)"/></svg>',
  pencil: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg>',
  merge: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3v4a6 6 0 0 0 6 6 6 6 0 0 1 6 6v2M18 3v4a6 6 0 0 1-3 5.2"/><path d="M3 6l3-3 3 3M15 6l3-3 3 3"/></svg>',
  keyFill: '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="7.5" cy="15.5" r="5" fill="currentColor"/><circle cx="7.5" cy="15.5" r="1.8" fill="var(--panel)"/><path d="M11 12L20.5 2.5M16 7l3 3M18.3 4.7l2.2 2.2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  number: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 3L8 21M16 3l-2 18M4 8.5h17M3 15.5h17"/></svg>',
  globe: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>',
  safari: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M16 8l-2.5 5.5L8 16l2.5-5.5z"/></svg>',
  person: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="19" height="16" rx="3"/><circle cx="8.5" cy="11" r="2.5"/><path d="M4.8 17c.7-1.8 2-2.7 3.7-2.7s3 .9 3.7 2.7M14.5 10h4.5M14.5 14h3"/></svg>',
  qrcode: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM17 17h4v4M21 14v1"/></svg>',
  plusCircle: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7.5v9M7.5 12h9"/></svg>',
  magnifier: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>',
  checklist: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6.5l1.8 1.8L8.5 5M3.5 13.5l1.8 1.8 3.2-3.3M11.5 7h9M11.5 14h9M11.5 20h9"/></svg>',
  doc: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/></svg>',
  star: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3z"/></svg>',
  starFill: '<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9L12 3z" fill="currentColor"/></svg>',
  eyeSlash: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  ellipsis: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.1" fill="currentColor"/><circle cx="12" cy="12" r="2.1" fill="currentColor"/><circle cx="19" cy="12" r="2.1" fill="currentColor"/></svg>',
  ellipsisV: '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>',
  creditcard: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 15h4"/></svg>',
  warning: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z" fill="currentColor"/><path d="M12 10v5" stroke="#000" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="18" r="1.1" fill="#000"/></svg>',
  seal: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-.9 2.8.9 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9-2.5-1.7.9-2.8-.9-2.8 2.5-1.7.9-2.9 3 .2z" fill="currentColor"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8" fill="none" stroke="var(--bg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eyeSlashFill: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.6 4.9-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  chevronLeft: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  chevronRight: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};

// --- shared formatting ------------------------------------------------------------------------

/** "Oct 1, 2026 at 3:04 PM" - iOS Date.FormatStyle(date: .abbreviated, time: .shortened). */
function txDate(ms) {
  const date = new Date(ms);
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

/** iOS feeText: four decimals from 0.001 KAS up, eight below. */
function feeText(sompi) {
  if (sompi == null) return "";
  const kas = Number(sompi) / 1e8;
  return `Fee ${kas >= 0.001 ? kas.toFixed(4) : kas.toFixed(8)} KAS`;
}

/** iOS PortfolioFormat.kas: grouped, 0-4 decimals. */
function portfolioKas(sompi) {
  return `${(Number(sompi) / 1e8).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })} KAS`;
}

/** Middle truncation for a one-line monospaced id. */
function middle(text, keep = 12) {
  const value = String(text || "");
  return value.length > keep * 2 + 1 ? `${value.slice(0, keep)}…${value.slice(-keep)}` : value;
}

/** iOS SpendingAddressEntry.shortAddress: first 14 + "..." + last 6. */
function shortAddress(address) {
  const value = String(address || "");
  return value.length > 20 ? `${value.slice(0, 14)}...${value.slice(-6)}` : value;
}

// --- Transaction History, UTXOs, KNS Domains (shared by both detail screens) -----------------

function historyHtml(state) {
  if (!state.history && state.historyLoading) return '<div class="list-row center-row"><span class="spinner small-spin"></span></div>';
  const txs = state.history?.txs || [];
  if (!txs.length && state.history && !state.history.complete) {
    return '<div class="list-row stack-row"><span class="muted">Could not load transactions.</span><button class="link-button strong" id="history-retry">Try Again</button></div>';
  }
  if (!txs.length) return '<div class="list-row muted">No transactions yet.</div>';
  return txs.map((tx, i) => {
    const cls = tx.direction === "out" ? "out" : tx.direction === "in" ? "in" : "none";
    const breakdown = tx.direction === "out" ? outgoingBreakdown(tx, state.address) : null;
    const moved = Boolean(breakdown) && breakdown.toOthers === 0n && breakdown.changeTotal > 0n;
    const amountSompi = breakdown ? (moved ? breakdown.changeTotal : breakdown.toOthers) : tx.amountSompi;
    const changeLines = (breakdown?.change || []).map((line) => `<span class="ios-tx-change">${esc(moved
      ? `To ${line.label}`
      : `Change ${groupedKas8(line.sompi)} KAS to ${line.label}`)}</span>`).join("");
    return `
      <button class="list-row ios-tx" data-tx="${i}">
        <span class="ios-tx-icon ${cls}">${tx.direction === "out" ? SF.arrowUpFill : SF.arrowDownFill}</span>
        <span class="tx-meta">
          <span class="ios-tx-title ${cls}">${tx.direction === "out" ? (moved ? "Moved" : "Sent") : tx.direction === "in" ? "Received" : "Transaction"}</span>
          ${changeLines}
          <span class="mono tiny muted">${esc(middle(tx.txid, 6))}</span>
          ${tx.time ? `<span class="tiny muted">${esc(txDate(tx.time))}</span>` : ""}
        </span>
        <span class="ios-tx-right">
          ${tx.direction ? `<span class="ios-tx-amount ${cls}">${tx.direction === "out" ? "-" : "+"}${esc(groupedKas8(amountSompi))} KAS</span>` : ""}
          ${tx.feeSompi != null ? `<span class="tiny muted">${esc(feeText(tx.feeSompi))}</span>` : ""}
        </span>
        <span class="accent">${SF.upRightSquare}</span>
      </button>`;
  }).join("");
}

/**
 * Where an outgoing transaction's Kaspa went, by owner (K iOS b0f0a4e6 / 800dcb75): to other
 * people, and to this wallet's other addresses (the change, by label, in output order), so a Sent
 * row adds up - an address that got 10 and sent 1 shows where the 8.99 of change went.
 */
function outgoingBreakdown(tx, address) {
  const self = String(address || "").toLowerCase();
  let toOthers = 0n;
  const change = [];
  for (const output of tx.paidTo || []) {
    const to = String(output.address || "").toLowerCase();
    if (!to || to === self) continue;
    const label = ownAddressLabel(to);
    if (!label) { toOthers += output.sompi; continue; }
    const line = change.find((c) => c.label === label);
    if (line) line.sompi += output.sompi; else change.push({ label, sompi: output.sompi });
  }
  return { toOthers, change, changeTotal: change.reduce((sum, c) => sum + c.sompi, 0n) };
}

// iOS TransactionActionsSheet: Open in Explorer, and Add to Portfolio when the transaction has
// a direction (a buy or a sell of KAS for this address).
function showTransactionSheet(tx, sourceAddress, onDone) {
  const summary = tx.direction ? `${tx.direction === "out" ? "Sent" : "Received"} ${portfolioKas(tx.amountSompi)}${tx.time ? ` on ${txDate(tx.time)}` : ""}` : "";
  showSheet({
    title: "Transaction",
    headerHtml: `${summary ? `<div class="muted small">${esc(summary)}</div>` : ""}<div class="mono tiny muted">${esc(middle(tx.txid, 16))}</div>`,
    cancel: false,
    rows: [{
      label: "Open in Explorer",
      subtitle: "Opens this transaction on the block explorer.",
      icon: SF.safari,
      onClick: () => window.open(wallet.explorerTxUrl(tx.txid), "_blank", "noopener"),
    }, ...(tx.direction ? [{
      label: "Add to Portfolio",
      subtitle: "Records it as a buy or a sell in a portfolio of your choosing.",
      icon: SF.chartPieFill,
      onClick: () => showAddToPortfolio({ txid: tx.txid, direction: tx.direction, amountSompi: tx.amountSompi, time: tx.time, sourceAddress, onDone }),
    }] : [])],
  });
}

function utxosHtml(state, compoundFooter) {
  const coins = state.coins;
  let body;
  if (!coins && state.coinsLoading) body = '<div class="list-row center-row"><span class="spinner small-spin"></span></div>';
  else if (!coins?.length && state.coinsError) {
    body = `<div class="list-row stack-row">
      <span class="danger-text strong small">${SF.warning} Couldn't load the coins at this address</span>
      <span class="muted tiny">${esc(state.coinsError)}</span>
      <button class="link-button strong" id="coins-retry">Try Again</button></div>`;
  } else if (!coins?.length) body = '<div class="list-row muted">No UTXOs.</div>';
  else {
    body = coins.map((coin, i) => {
      const label = state.labels?.[coin.key];
      return `
        <div class="list-row ios-utxo">
          <span class="accent">${coin.isCoinbase ? SF.cube : SF.grid}</span>
          <span class="tx-meta">
            ${label ? `<span class="accent tiny strong">${esc(label)}</span>` : ""}
            <span class="strong small">${esc(groupedKas8(coin.amount))} KAS</span>
            <span class="mono tiny muted">${esc(middle(`${coin.transactionId}:${coin.index}`, 10))}</span>
          </span>
          ${coin.isCoinbase ? '<span class="tiny muted strong">Coinbase</span>' : ""}
          <button class="icon plain accent" data-rename-utxo="${i}" aria-label="Rename UTXO">${SF.pencil}</button>
        </div>`;
    }).join("");
  }
  const compound = coins && coins.length > 1 ? `
    <div class="glass list"><button class="list-row strong accent-row" id="compound">${SF.merge}<span>Compound UTXOs</span></button></div>
    <p class="form-footer">${esc(compoundFooter)}</p>` : "";
  return `${compound}<div class="glass list">${body}</div>`;
}

function bindTabsContent(state, { address, repaint, reloadHistory, reloadCoins, onCompound }) {
  for (const row of app.querySelectorAll("[data-tx]")) row.onclick = () => showTransactionSheet(state.history.txs[Number(row.dataset.tx)], address, repaint);
  const historyRetry = $("#history-retry");
  if (historyRetry) historyRetry.onclick = reloadHistory;
  const coinsRetry = $("#coins-retry");
  if (coinsRetry) coinsRetry.onclick = reloadCoins;
  const compound = $("#compound");
  if (compound) compound.onclick = onCompound;
  for (const button of app.querySelectorAll("[data-rename-utxo]")) {
    const coin = state.coins[Number(button.dataset.renameUtxo)];
    button.onclick = () => showAlert({
      title: "Rename UTXO",
      field: { placeholder: "Name", value: state.labels?.[coin.key] || "" },
      confirmLabel: "Save",
      cancelLabel: "Cancel",
      onConfirm: async (value) => { state.labels = await wallet.setUtxoLabel(address, coin.key, value); repaint(); },
    });
  }
}

/** A balance that couldn't be read (KaPay iOS 0799cec `.unreadable`): said so, with Try Again
 *  (#balance-retry) - never 0 KAS, which would say the address is empty. */
export function unreadableBalanceHtml(className = "") {
  return `<div class="ios-balance unreadable-balance ${className}">
    <span class="muted small center-text">Couldn't load the coins at this address</span>
    <button class="link-button strong" id="balance-retry">Try Again</button>
  </div>`;
}

// slider.horizontal.3: the floating Address Actions button (K iOS ManageAddressesView)
const SLIDERS = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h9M16 6h5M3 12h3M10 12h11M3 18h11M18 18h3"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></svg>';

/** The floating glass button behind "Address Actions" (K iOS addressActionsButton), bottom right:
 *  Manage Addresses and a Cold Storage account. A spinner while it generates or discovers. */
export function addressActionsFabHtml(busy) {
  return `<button class="fab" id="address-actions" aria-label="Address Actions" title="Address Actions" ${busy ? "disabled" : ""}>${busy ? '<span class="spinner small-spin"></span>' : SLIDERS}</button>`;
}

function loaders(state, address, repaintIfHere) {
  const loadHistory = () => {
    state.historyLoading = true;
    repaintIfHere();
    Promise.all([wallet.history(address), loadOwnAddresses().catch(() => false)])
      .then(([result]) => { state.history = result; })
      .catch(() => { state.history = { txs: [], complete: false }; })
      .finally(() => { state.historyLoading = false; repaintIfHere(); });
  };
  const loadCoins = () => {
    state.coinsLoading = true;
    state.coinsError = "";
    repaintIfHere();
    wallet.utxos(address)
      .then((coins) => { state.coins = coins; })
      .catch((error) => { state.coinsError = String(error?.message || error); })
      .finally(() => { state.coinsLoading = false; repaintIfHere(); });
  };
  return { loadHistory, loadCoins };
}

// The Domains tab of every address screen (iOS fe52376): a card per name service with this
// address's count; .kachat opens its cards and detail screens as before.
function kachatTabHtml(state) {
  state.kachatTab = addressDomainsTab({ address: state.address, repaint: state.repaint });
  return state.kachatTab.html;
}

/** After a render: the Domains tab's cards, and a name's detail coming back to this screen. */
function bindKachatTab(state, back) {
  if (state.tab === "domains") state.kachatTab?.bind(app, back);
}

// iOS UnderlineTabBar with the plain titles History / UTXOs / Domains.
function addressTabsHtml(current) {
  return `
    <div class="underline-tabs address-tabs" role="tablist">
      ${[["history", "History"], ["utxos", "UTXOs"], ["domains", "Domains"]].map(([id, title]) =>
        `<button role="tab" data-tab="${id}" aria-selected="${current === id}">${title}</button>`).join("")}
    </div>`;
}

function addressTabContent(state, compoundFooter) {
  if (state.tab === "history") return `<div class="glass list">${historyHtml(state)}</div>`;
  if (state.tab === "utxos") return utxosHtml(state, compoundFooter);
  return kachatTabHtml(state);
}

// --- keys -------------------------------------------------------------------------------------

// iOS ChattingAddressPrivateKeyView / SpendingAddressPrivateKeyView: the warning, tap to reveal
// for seven seconds, Copy Private Key Hex (clipboard cleared after 30 s).
async function showPrivateKey({ title, source, address, onBack }) {
  let value = "Unavailable";
  // this page's address: another account's key (switched in another window) is never shown here
  try { value = await wallet.privateKeyHex(source, { fromAddress: address }); } catch { /* shown as Unavailable */ }
  let revealed = false;
  let timer = null;
  const paint = () => {
    render(`
      ${navHeader({ title, backLabel: "Close" })}
      <section class="screen key-screen">
        <div class="callout warn">
          <div class="callout-title">${SF.warning}<span>Security Warning</span></div>
          <p>Anyone with this address's private key can spend its funds. Never share it with anyone.</p>
        </div>
        ${revealed ? `
          <div class="glass key-box mono">${esc(value)}</div>
          <button class="with-icon soft" id="copy-key">${SF.doc}<span>Copy Private Key Hex</span></button>`
          : `<button class="reveal-box" id="reveal">${SF.eyeSlashFill}<span>Tap to reveal private key</span></button>`}
      </section>`, "key");
    $("#back").onclick = () => { clearTimeout(timer); onBack(); };
    const reveal = $("#reveal");
    if (reveal) reveal.onclick = () => {
      revealed = true;
      paint();
      // only this screen is hidden again: another address's key screen opened since then is left alone
      const shown = $(".key-box");
      clearTimeout(timer);
      timer = setTimeout(() => { revealed = false; if (shown?.isConnected) paint(); }, 7000);
    };
    const copy = $("#copy-key");
    if (copy) copy.onclick = () => copySecret(value, "Private key copied. Clipboard will clear in 30s.");
  };
  paint();
}

function gatePrivateKey({ title, source, address, onBack }) {
  passwordGate({
    title,
    message: "Enter your wallet password to view this address's private key.",
    verify: (password) => vault.verifyPassword(password),
    onBack,
    onUnlocked: () => showPrivateKey({ title, source, address, onBack }),
  });
}

// iOS AddressPublicKeyView. `value`: the key when it's known already (a Cold Storage address's,
// read from the address); else derived for this source.
export async function showPublicKey({ source = null, address, value = null, note = "This is the public half of this address. It cannot spend anything.", onBack }) {
  if (value == null && source) {
    try { value = await wallet.publicKeyHex(source, { fromAddress: address }); } catch { /* fallback text */ }
  }
  render(`
    ${navHeader({ title: "Public Key", backLabel: "Close" })}
    <section class="screen key-screen">
      <div class="callout safe">
        <div class="callout-title">${SF.seal}<span>Safe to share</span></div>
        <p>${esc(note)}</p>
      </div>
      ${value ? `<div class="glass key-box mono selectable">${esc(value)}</div>
        <button class="with-icon soft" id="copy-key">${SF.doc}<span>Copy Public Key</span></button>`
        : '<p class="muted">This address does not carry a public key.</p>'}
    </section>`, "key");
  $("#back").onclick = onBack;
  const copy = $("#copy-key");
  if (copy) copy.onclick = () => copyText(value, "Public key");
}

// The options button at the top right of every address page, and the one sheet it opens (iOS
// AddressOptionsButton, AddressActionsSheet, KaPay iOS 2da5f4b): the chatting address, each spending
// address, each Cold Storage address.
export function addressOptionsButtonHtml() {
  return `<div class="nav-right bar-circles"><button class="bar-circle" id="address-options" aria-label="Address Actions" title="Address Actions">${SF.ellipsis}</button></div>`;
}

/**
 * @param {object} opts
 * @param {string} opts.address
 * @param {Function} [opts.onViewPrivateKey] left out where the app doesn't hold the key (Cold Storage)
 * @param {Function} [opts.onViewPublicKey]  left out on a quantum-safe address: its key stays hidden until it spends
 * @param {object[]} [opts.extraRows]
 */
export function showAddressActions({ address, onViewPrivateKey = null, onViewPublicKey = null, extraRows = [] }) {
  showSheet({
    title: "Address Actions",
    cancel: false,
    rows: [
      ...(onViewPrivateKey ? [{ label: "View Private Key", subtitle: "The key that spends this address. Never share it.", icon: SF.keyFill, onClick: onViewPrivateKey }] : []),
      ...(onViewPublicKey ? [{ label: "View Public Key", subtitle: "The public half of this address, for anyone who asks for it.", icon: SF.number, onClick: onViewPublicKey }] : []),
      { label: "View in Explorer", subtitle: "Opens this address on your chosen block explorer.", icon: SF.globe, onClick: () => window.open(wallet.explorerAddressUrl(address), "_blank", "noopener") },
      ...extraRows,
    ],
  });
}

// --- Chatting address: iOS ChattingAddressManageView ----------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.address        the chatting address
 * @param {Function} opts.onBack
 * @param {Function} [opts.onChangeIdentity] imported accounts: Change Chatting Address
 */
export function showManageAddress(opts) {
  const source = { kind: "main" };
  const state = { tab: "history", history: null, historyLoading: false, coins: null, coinsLoading: false, coinsError: "", labels: {}, address: opts.address };
  const back = () => paint();
  const here = () => app.dataset.screen === "manage-chat";
  const repaintIfHere = () => { if (here()) paint(); };
  state.repaint = repaintIfHere;
  const { loadHistory, loadCoins } = loaders(state, opts.address, repaintIfHere);
  // the wallet's known balance; the sum of the coins only while that's unknown, so it never sits at
  // 0 while they load (KaPay iOS 3d126db)
  const balance = () => state.known ?? (state.coins ? state.coins.reduce((sum, c) => sum + c.amount, 0n) : null);
  vault.readAccounts().then((view) => wallet.cachedBalances(view.activeAccountId)).then((known) => {
    if (known?.main != null && state.known == null) { state.known = BigInt(known.main); repaintIfHere(); }
  }).catch(() => {});

  const openSend = (compound = false) => showSend({
    // an address's own page sends from that address, no From choice (iOS 7a8102b)
    source, fromAddress: opts.address, compound, lockedSource: true, navTitle: compound ? "Compound UTXOs" : "Send Kaspa",
    feeFooter: "If the network is busy, Fast or Priority pays a higher fee to help your withdrawal confirm sooner. Tap the fee amount to set a custom fee.",
    onClose: () => { paint(); loadHistory(); loadCoins(); },
  });

  const addressActions = () => showAddressActions({
    address: opts.address,
    onViewPrivateKey: () => gatePrivateKey({ title: "Chatting Address", source, address: opts.address, onBack: back }),
    onViewPublicKey: () => showPublicKey({ source, address: opts.address, note: "This is the public half of your chatting address. It identifies you and cannot spend anything.", onBack: back }),
    // The extension's home for the picker iOS shows in its Welcome Guide after an import.
    extraRows: opts.onChangeIdentity ? [{ label: "Change Chatting Address", subtitle: "Pick another address of this seed that already holds your identity.", icon: SF.person, onClick: () => showChattingAddressPicker({ onBack: back, onChanged: opts.onChangeIdentity }) }] : [],
  });

  function paint() {
    const total = balance();
    // its coins couldn't be read: no balance and no Send (KaPay iOS 0799cec)
    const unreadable = total == null && Boolean(state.coinsError) && !state.coinsLoading;
    const scroll = app.querySelector(".manage-scroll")?.scrollTop || 0;
    render(`
      <header class="navbar">
        <button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button>
        <div class="nav-title">Chatting Address</div>
        ${addressOptionsButtonHtml()}
      </header>
      <div class="manage-scroll">
        ${unreadable ? unreadableBalanceHtml() : balanceCardHtml({ label: "Chatting Address", sompi: total, fiatText: fiatTextFor(total, repaintIfHere) })}
        ${addressTabsHtml(state.tab)}
        ${addressTabContent(state, "Combines all UTXOs at this address into a single one, to reduce the number of inputs a future send needs.")}
      </div>
      <div class="ios-bottom-bar">
        <button class="ios-capsule with-icon" id="receive">${SF.qrcode}<span>Receive</span></button>
        <button class="ios-capsule with-icon" id="send" ${total === 0n || unreadable ? "disabled" : ""}>${SF.sendFill}<span>Send</span></button>
      </div>`, "manage-chat");
    bindKachatTab(state, back);
    remember(() => paint());
    const scroller = app.querySelector(".manage-scroll");
    if (scroller) scroller.scrollTop = scroll;
    $("#back").onclick = opts.onBack;
    for (const tab of app.querySelectorAll("[data-tab]")) tab.onclick = () => { state.tab = tab.dataset.tab; paint(); };
    $("#address-options").onclick = addressActions;
    $("#receive").onclick = () => showQr({
      heading: "Chatting Address", address: opts.address, balanceSompi: total, backLabel: "Close", onBack: back,
      privacy: RECEIVE_NOTES.chatting, notes: [RECEIVE_NOTES.kaspaAndKusdt, RECEIVE_NOTES.chattingUse],
    });
    $("#send").onclick = () => openSend(false);
    const balanceRetry = $("#balance-retry");
    if (balanceRetry) balanceRetry.onclick = loadCoins;
    bindTabsContent(state, { address: opts.address, repaint: paint, reloadHistory: loadHistory, reloadCoins: loadCoins, onCompound: () => openSend(true) });
  }

  paint();
  wallet.utxoLabels(opts.address).then((labels) => { state.labels = labels; repaintIfHere(); });
  loadHistory();
  loadCoins();
}

// --- Spending addresses: iOS ManageAddressesView -----------------------------------------------

let listSnapshot = null; // paints instantly next time (iOS kachat_spending_entries_cache)
const domainOwners = new Map(); // address -> owns a KNS domain

function displayLabel(row) { return row.label; }

// Under the chatting address (iOS 245a5d2; no "primary" - the send screen's From picks the
// address): unused ones first, newest first, so a freshly generated address lands right under the
// Chatting Address, then the used ones in number order (KaPay iOS 59593af). One still being checked
// counts as unused until its check says otherwise.
function sortRows(rows, usedMap) {
  const isUsed = (row) => row.balanceSompi > 0n || usedMap.get(row.address) === true;
  return [...rows].sort((a, b) => {
    const aUsed = isUsed(a);
    const bUsed = isUsed(b);
    if (aUsed !== bUsed) return aUsed ? 1 : -1;
    return aUsed ? a.index - b.index : b.index - a.index;
  });
}

export function showManageAddresses({ onBack, onChangeIdentity = null }) {
  // the chatting address leads the list (iOS 6333dd3): { address, balance }
  const state = { list: listSnapshot, loading: !listSnapshot, used: new Map(), busy: null, discovery: null, summary: "", error: "", chatting: null, allTotal: null };
  const back = () => { paint(); load(); };
  const here = () => app.dataset.screen === "manage-list";
  let actionsSheet = null;

  const visibleRows = () => (state.list?.rows || []).filter((r) => !r.hidden);

  const load = async () => {
    try {
      state.list = await wallet.spendingList();
      // §11: an address Manage kUSDT lists that was hidden comes back (K-Desktop reshowListedHidden)
      const listed = kusdtListedIndices();
      const comeBack = state.list.rows.filter((r) => r.hidden && listed.has(r.index));
      if (comeBack.length) {
        for (const r of comeBack) { try { await wallet.setSpendingHidden(r.index, false); } catch { /* stays hidden */ } }
        state.list = await wallet.spendingList();
      }
      listSnapshot = state.list;
      state.error = "";
      try {
        const main = (await wallet.cachedAddresses((await vault.readAccounts()).activeAccountId))?.main || null;
        if (main) {
          try {
            const balances = await wallet.balancesFor([main]);
            state.chatting = { address: main, balance: balances[main] ?? 0n };
          } catch {
            // unread, not 0 (KaPay iOS 0799cec): the last figure known (KaPay iOS 2da5f4b), else
            // the card says so; a balance read before stays
            const known = (await wallet.cachedBalances(state.list.accountId))?.main ?? null;
            if (state.chatting?.address !== main || state.chatting.balance == null) state.chatting = { address: main, balance: known };
          }
        }
      } catch { /* no chatting card */ }
    } catch (error) {
      state.error = error.message;
    }
    state.loading = false;
    if (here()) paint();
    probeUsed();
    probeDomains();
    probeChatting();
    probeQuantumSpent();
  };

  // The chain's word on each quantum-safe row, for spends made on another device or before a
  // restore (a spent mark is permanent), one row at a time as iOS does.
  const probeQuantumSpent = async () => {
    for (const row of state.list?.rows || []) {
      if (!row.quantum || row.spent) continue;
      if ((await wallet.quantumSpentState(row.address, state.list?.accountId)) !== true) continue;
      row.spent = true;
      if (here()) paint();
    }
  };

  // iOS: funded rows are used; the rest use what is known, then transactions-count 8 at a time,
  // lowest index first.
  const probeUsed = async () => {
    const rows = [...(state.list?.rows || [])].sort((a, b) => a.index - b.index);
    const queue = [];
    for (const row of rows) {
      if (row.balanceSompi > 0n) { state.used.set(row.address, true); continue; }
      const known = await wallet.knownUsedState(row.address);
      if (known != null) state.used.set(row.address, known); else if (!row.hidden) queue.push(row);
    }
    if (here()) paint();
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const used = await wallet.addressUsed(row.address);
        state.used.set(row.address, used == null ? "checking" : used);
        if (here()) paint();
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  };

  // the chatting address's Used and Contains domain tags (K iOS ManageAddressesView)
  const probeChatting = async () => {
    const address = state.chatting?.address;
    if (!address) return;
    if (!domainOwners.has(address)) {
      try { domainOwners.set(address, (await wallet.domains(address)).domains.length > 0); } catch { /* leave unknown */ }
    }
    if (state.chatting?.balance > 0n) state.used.set(address, true);
    else if (!state.used.has(address)) {
      const used = (await wallet.knownUsedState(address)) ?? (await wallet.addressUsed(address).catch(() => null));
      if (used != null) state.used.set(address, used);
    }
    if (here()) paint();
  };

  const probeDomains = async () => {
    const queue = visibleRows().filter((r) => !domainOwners.has(r.address));
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        try {
          const data = await wallet.domains(row.address);
          domainOwners.set(row.address, data.domains.length > 0);
        } catch { /* leave unknown */ }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    // .kachat names count too, where the registry is live (iOS 881ada6 ownersOfNames).
    try {
      const owners = await kachatRegistry()?.ownersOfNames([...visibleRows().map((r) => r.address), ...(state.chatting?.address ? [state.chatting.address] : [])]);
      for (const address of owners || []) domainOwners.set(address, true);
    } catch { /* not tagged */ }
    if (here()) paint();
  };

  const usedBadge = (row) => {
    const used = row.balanceSompi > 0n ? true : state.used.get(row.address);
    if (used === true) return '<span class="used-badge used">Used</span>';
    if (used === false) return '<span class="used-badge unused">Unused</span>';
    return '<span class="used-badge">Checking</span>';
  };

  const rowActions = (row) => {
    const hideable = true;
    showSheet({
      title: row.customLabel || `Address ${row.index}`,
      subtitle: shortAddress(row.address),
      cancel: false,
      rows: [
        { label: "Rename Address", subtitle: "Gives this address a label of your own.", icon: SF.pencil, onClick: () => renameAddress(row) },
        { label: "Copy Address", subtitle: "Puts the full address on the clipboard.", icon: SF.doc, onClick: () => copyText(row.address) },
        { label: "Show QR Code", subtitle: "Full screen, for scanning with another device.", icon: SF.qrcode, onClick: () => spendingReceive({ label: row.customLabel || `Address #${row.index}`, address: row.address, index: row.index, onBack: back }) },
        // Send Kaspa from this address with the Chatting Address already the recipient (KaPay iOS
        // 17bda71); nothing to send from an empty one
        ...(state.chatting?.address ? [{
          label: "Send to Chatting Address", subtitle: "Moves Kaspa from this address to your Chatting Address.", icon: SF.arrowUpCircle,
          disabled: !(row.balanceSompi > 0n),
          onClick: () => showSend({
            source: { kind: "spending", index: row.index }, fromAddress: row.address, lockedSource: true, navTitle: "Send Kaspa",
            recipient: state.chatting.address,
            onClose: () => back(),
          }),
        }] : []),
        ...(hideable ? [{ label: "Hide Address", subtitle: "Removes it from this list. Re-enable it in Address Visibility.", icon: SF.eyeSlash, tint: "orange", onClick: () => hideAddress(row) }] : []),
      ],
    });
  };

  const renameAddress = (row) => showAlert({
    title: "Rename Address",
    message: "Give this address a label to help you recognize it.",
    field: { placeholder: "Label", value: row.customLabel || "" },
    confirmLabel: "Save",
    cancelLabel: "Cancel",
    onConfirm: async (value) => {
      try { await wallet.setSpendingLabel(row.index, value); } catch (error) { toast(error.message); }
      load();
    },
  });

  const setPrimary = async (row) => {
    state.busy = { primary: row.index };
    paint();
    try { await wallet.setPrimarySpending(row.index); } catch (error) { toast(error.message); }
    state.busy = null;
    load();
  };

  const hideAddress = async (row) => {
    if (refuseHidingKusdtListed(row.index)) { paint(); return; }
    try {
      // The balance is checked again on chain before hiding (iOS setSpendingAddressHidden).
      await wallet.setSpendingHidden(row.index, true);
      toast("Address hidden. Re-enable it in Address Visibility.");
      load();
    } catch (error) {
      toast(error?.message === SWITCHED_ELSEWHERE ? SWITCHED_ELSEWHERE : "This address can't be hidden.");
    }
  };

  const actionRows = () => {
    const discovering = Boolean(state.discovery);
    const busy = Boolean(state.busy?.startsWith?.("generate"));
    return [
      // a regular address is what Receive gives; a quantum-resistant one is made only on purpose
      // (KaPay iOS e188209)
      { label: "Generate Non-Quantum Address", subtitle: "A regular address, like Receive gives you. Works with everything, kUSDT included.", icon: SF.plusCircle, busy: state.busy === "generate-regular", disabled: discovering || busy, onClick: () => generate({ quantum: false }) },
      { label: "Generate Quantum-Resistant Address", subtitle: "Keeps its key hidden until it spends. For Kaspa only: kUSDT can't be traded from it.", icon: SF.shield, busy: state.busy === "generate-quantum", disabled: discovering || busy, onClick: () => generate({ quantum: true }) },
      { label: "Discover Addresses", subtitle: "Finds addresses holding a balance or a domain.", icon: SF.magnifier, disabled: discovering, keepOpen: true, onClick: discover },
      { label: "Address Visibility", subtitle: "Check off every address you want on the list, in one sitting.", icon: SF.checklist, disabled: discovering, onClick: () => showVisibility({ onBack: back }) },
    ];
  };

  const discoveryHtml = () => {
    const d = state.discovery;
    if (!d) return state.summary ? `<p class="muted small strong sheet-summary">${esc(state.summary)}</p>` : "";
    return `
      <div class="discovery">
        <span class="spinner"></span>
        <div class="strong">${wallet.isQuantumIndex(d.checkingIndex) ? "Checking quantum-safe addresses" : `Checking address #${d.checkingIndex}`}</div>
        <div class="muted small">${d.foundCount ? `${d.foundCount} found so far` : "No addresses with a balance or domain yet"}</div>
        <div class="muted tiny">Checks the first thousand addresses whatever the gaps, then keeps going while it keeps finding.</div>
        <button class="sheet-row center-text" id="keep-scanning"><span class="sheet-label">Close and Keep Scanning</span></button>
      </div>`;
  };

  const openActions = () => {
    actionsSheet = showSheet({
      title: "Address Actions",
      cancel: false,
      rows: state.discovery ? [] : actionRows(),
      footerHtml: discoveryHtml(),
    });
    bindKeepScanning();
  };
  const refreshActions = () => {
    if (!actionsSheet?.isOpen()) return;
    actionsSheet.update({ rows: state.discovery ? [] : actionRows(), footerHtml: discoveryHtml() });
    bindKeepScanning();
  };
  const bindKeepScanning = () => {
    const keep = document.querySelector("#keep-scanning");
    if (keep) keep.onclick = () => actionsSheet.close();
  };

  async function generate({ quantum }) {
    if (state.busy) return;
    state.busy = quantum ? "generate-quantum" : "generate-regular";
    paint();
    try {
      const index = quantum ? await wallet.generateSpendingAddress() : await wallet.generateRegularSpendingAddress();
      // numbered on its own chain (iOS e001786): a quantum-safe slot is #0, #1, ...
      toast(`Address #${wallet.isQuantumIndex(index) ? index - wallet.QUANTUM_INDEX_BASE : index} is ready.`);
    } catch (error) {
      toast(error.message);
    }
    state.busy = null;
    load();
  }

  async function discover() {
    state.discovery = { checkingIndex: 0, foundCount: 0 };
    state.summary = "";
    refreshActions();
    paint();
    let message;
    try {
      const found = await wallet.discoverSpendingAddresses((progress) => { state.discovery = progress; refreshActions(); });
      message = found ? `Found ${found} address${found === 1 ? "" : "es"} with a balance or domain.` : "No addresses with a balance or domain found.";
    } catch (error) {
      message = error.message;
    }
    state.discovery = null;
    // Sheet still open: the result shows under the rows. Closed: it arrives as a toast.
    if (actionsSheet?.isOpen()) { state.summary = message; refreshActions(); } else toast(message);
    load();
  }

  function paint() {
    const rows = sortRows(visibleRows(), state.used);
    // every address of the account, hidden ones and the chatting address too (iOS 245a5d2)
    const total = (state.list?.rows || []).reduce((sum, r) => sum + r.balanceSompi, 0n) + BigInt(state.chatting?.balance ?? 0n);
    // the chatting address's balance couldn't be read: no total to show (a dash, never a short one)
    const chattingUnread = Boolean(state.chatting) && state.chatting.balance == null;
    const chattingCard = state.chatting ? `
          <div class="glass address-card" id="open-chatting" role="button" tabindex="0">
            <div class="address-card-main">
              <span class="muted small medium">Chatting Address</span>
              <span class="mono small">${esc(shortAddress(state.chatting.address))}</span>
              ${chattingUnread
                ? '<span class="muted small">Couldn\'t load the coins at this address</span>'
                : `<span class="strong small">${esc(groupedKas8(state.chatting.balance))} KAS</span>`}
              ${state.used.get(state.chatting.address) === true || domainOwners.get(state.chatting.address) ? `<span class="address-status">${state.used.get(state.chatting.address) === true ? '<span class="used-badge used">Used</span>' : ""}${domainOwners.get(state.chatting.address) ? '<span class="domain-tag">Contains domain</span>' : ""}</span>` : ""}
            </div>
          </div>` : "";
    const busy = Boolean(state.discovery) || Boolean(state.busy?.startsWith?.("generate"));
    const scroll = app.querySelector(".manage-scroll")?.scrollTop || 0;
    render(`
      ${navHeader({ title: "Manage Addresses" })}
      <div class="manage-scroll">
        ${balanceCardHtml({
          label: "Total Balance",
          sompi: state.list ? total : null,
          unknown: (!state.list && Boolean(state.error)) || (Boolean(state.list) && chattingUnread),
          fiatText: state.list && !chattingUnread ? fiatTextFor(total, () => { if (here()) paint(); }) : "",
        })}
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}
        ${state.loading && !state.list ? '<div class="center-text"><span class="spinner"></span></div>' : ""}
        ${chattingCard}
        ${state.list && !rows.length ? `
          <div class="km-empty"><span class="muted">${SF.creditcard}</span><div class="km-title">No Spending Addresses</div>
          <p class="muted small">Generate one below to start sending payments from a separate address than the one you chat from.</p></div>` : ""}
        ${rows.map((row) => `
          <div class="swipe-wrap" data-swipe="${row.index}">
            <button class="swipe-hide" tabindex="-1" aria-label="Hide Address">${SF.eyeSlashFill}<span>Hide</span></button>
            <div class="glass address-card swipe-card" data-open="${row.index}" role="button" tabindex="0">
              <div class="address-card-main">
                <span class="muted small medium">${esc(displayLabel(row))}${quantumShieldHtml(row)}</span>
                <span class="mono small">${esc(shortAddress(row.address))}</span>
                <span class="strong small">${esc(groupedKas8(row.balanceSompi))} KAS</span>
                <span class="address-status">${usedBadge(row)}${domainOwners.get(row.address) ? '<span class="domain-tag">Contains domain</span>' : ""}</span>
              </div>
              ${state.busy?.primary === row.index
                ? '<span class="spinner small-spin"></span>'
                : `<button class="icon plain card-menu" data-menu="${row.index}" aria-label="More" ${state.busy?.primary != null ? "disabled" : ""}>${SF.ellipsisV}</button>`}
            </div>
          </div>`).join("")}
        <div class="fab-room"></div>
      </div>
      ${addressActionsFabHtml(busy)}`, "manage-list");
    remember(() => paint());
    const scroller = app.querySelector(".manage-scroll");
    if (scroller) scroller.scrollTop = scroll;
    $("#back").onclick = onBack;
    $("#address-actions").onclick = openActions;
    const chattingEl = $("#open-chatting");
    if (chattingEl) chattingEl.onclick = () => showManageAddress({ address: state.chatting.address, onBack: back, onChangeIdentity });
    const byIndex = (index) => state.list.rows.find((r) => r.index === Number(index));
    const swipes = new Map();
    for (const wrap of app.querySelectorAll("[data-swipe]")) {
      swipes.set(wrap.dataset.swipe, bindSwipeToHide(wrap, { onHide: () => hideAddress(byIndex(wrap.dataset.swipe)) }));
    }
    for (const card of app.querySelectorAll("[data-open]")) {
      card.onclick = (event) => {
        if (event.target.closest("[data-menu]")) return;
        if (swipes.get(card.dataset.open)?.wasSwiped()) return;
        showSpendingAddress({ row: byIndex(card.dataset.open), onBack: back });
      };
      card.onkeydown = (event) => { if (event.key === "Enter") card.click(); };
    }
    for (const button of app.querySelectorAll("[data-menu]")) button.onclick = () => rowActions(byIndex(button.dataset.menu));
  }

  paint();
  load();
}

// --- one spending address: iOS SpendingAddressTransactionHistoryView ---------------------------

/** A spending address's own screen (its history first), by address - what a bell receipt opens
 *  (iOS 95e2cba); the list when it isn't one of this account's. */
export async function openSpendingAddress(address, onBack) {
  let row = null;
  try {
    row = (await wallet.spendingList()).rows.find((r) => r.address === String(address).toLowerCase()) || null;
  } catch {
    // its balance couldn't be read: said so with Try Again, not a screen showing 0 with Send off
    // (iOS OwnAddressHistorySheet .unreadable, KaPay iOS 0799cec)
    render(`${navHeader({})}<div class="manage-scroll pad">${unreadableBalanceHtml()}</div>`, "manage-spending");
    $("#back").onclick = onBack;
    $("#balance-retry").onclick = () => openSpendingAddress(address, onBack);
    return;
  }
  if (row) showSpendingAddress({ row, onBack });
  else showManageAddresses({ onBack });
}

function showSpendingAddress({ row, onBack }) {
  const source = { kind: "spending", index: row.index };
  const title = row.label;
  const state = {
    tab: "history", history: null, historyLoading: false, coins: null, coinsLoading: false, coinsError: "", labels: {},
    address: row.address,
  };
  const back = () => paint();
  const here = () => app.dataset.screen === "manage-spending";
  const repaintIfHere = () => { if (here()) paint(); };
  state.address = row.address;
  state.repaint = repaintIfHere;
  const { loadHistory, loadCoins } = loaders(state, row.address, repaintIfHere);
  const openSend = (compound = false) => showSend({
    // an address's own page sends from that address, no From choice (iOS 7a8102b)
    source, fromAddress: row.address, compound, lockedSource: true, navTitle: compound ? "Compound UTXOs" : "Send Kaspa",
    feeFooter: "If the network is busy, Fast or Priority pays a higher fee to help this confirm sooner. Tap the fee amount to set a custom fee.",
    onClose: () => { paint(); loadHistory(); loadCoins(); },
  });

  function paint() {
    const scroll = app.querySelector(".manage-scroll")?.scrollTop || 0;
    render(`
      <header class="navbar">
        <button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button>
        <div class="nav-title ellipsis">${esc(title)}</div>
        ${addressOptionsButtonHtml()}
      </header>
      <div class="manage-scroll">
        ${balanceCardHtml({ label: title, sompi: row.balanceSompi, fiatText: fiatTextFor(row.balanceSompi, repaintIfHere) })}
        ${addressTabsHtml(state.tab)}
        ${addressTabContent(state, "Combines this address's UTXOs to reduce the inputs a future send needs. A single transaction can only merge so many at once, so if this address has a very large number, tap Compound again after it confirms to keep reducing.")}
      </div>
      <div class="ios-bottom-bar">
        <button class="ios-capsule with-icon" id="receive">${SF.qrcode}<span>Receive</span></button>
        <button class="ios-capsule with-icon" id="send" ${row.balanceSompi === 0n ? "disabled" : ""}>${SF.sendFill}<span>Send</span></button>
      </div>`, "manage-spending");
    bindKachatTab(state, back);
    remember(() => paint());
    const scroller = app.querySelector(".manage-scroll");
    if (scroller) scroller.scrollTop = scroll;
    $("#back").onclick = onBack;
    $("#address-options").onclick = () => showAddressActions({
      address: row.address,
      onViewPrivateKey: () => gatePrivateKey({ title, source, address: row.address, onBack: back }),
      // a quantum-safe address keeps its key hidden until it spends: that's the point of it
      onViewPublicKey: wallet.isQuantumIndex(row.index) ? null : () => showPublicKey({ source, address: row.address, onBack: back }),
    });
    for (const tab of app.querySelectorAll("[data-tab]")) tab.onclick = () => { state.tab = tab.dataset.tab; paint(); };
    $("#receive").onclick = () => spendingReceive({ label: title, address: row.address, index: row.index, onBack: back });
    $("#send").onclick = () => openSend(false);
    bindTabsContent(state, { address: row.address, repaint: paint, reloadHistory: loadHistory, reloadCoins: loadCoins, onCompound: () => openSend(true) });
  }

  paint();
  wallet.utxoLabels(row.address).then((labels) => { state.labels = labels; repaintIfHere(); });
  loadHistory();
  loadCoins();
}

// --- Address Visibility: iOS SpendingAddressVisibilityView -----------------------------------
//
// Pages of 50 with a #start - #end pager that never runs out: pages past the revealed range
// derive the next indexes, and checking one of those reveals it (the ones in between are hidden).
// The primary never toggles; an address holding Kaspa can be shown but not hidden.

function showVisibility({ onBack }) {
  // Two Kaspa Hub style cards first (iOS d7e6dd1): Quantum Addresses and Non-Quantum Addresses,
  // each with how many of its addresses Manage Addresses shows; a card opens that chain's
  // checklist, paging from the chain's own start and numbered from #0. Hide All and Done stay on
  // the cards and cover both chains.
  const PAGE = 50;
  const state = { chain: null, page: 0, rows: null, loading: true, list: null, used: new Map() };
  const here = () => app.dataset.screen === "visibility";
  const base = () => (state.chain === "quantum" ? wallet.QUANTUM_INDEX_BASE : 0);
  const local = (index) => (wallet.isQuantumIndex(index) ? index - wallet.QUANTUM_INDEX_BASE : index);

  const loadList = async () => {
    try { state.list = await wallet.spendingList(); } catch { state.list = null; }
  };

  const loadPage = async () => {
    state.loading = true;
    state.rows = null;
    paint();
    try {
      await loadList();
      const start = base() + state.page * PAGE;
      const addresses = await wallet.spendingAddressRange(start, PAGE);
      const balances = await wallet.balancesFor(Object.values(addresses));
      const st = state.list.state;
      state.rows = Object.entries(addresses).map(([index, address]) => {
        const i = Number(index);
        const quantum = wallet.isQuantumIndex(i);
        const revealed = quantum ? local(i) <= st.qMaxIndex : i <= st.maxIndex;
        return {
          index: i, address, revealed, quantum,
          spent: quantum && st.qSpent.includes(String(address).toLowerCase()),
          visible: revealed && !st.hidden.includes(i),
          primary: i === st.activeIndex,
          customLabel: wallet.customLabel(st, i),
          balanceSompi: balances[address] ?? 0n,
        };
      });
    } catch {
      state.rows = [];
    }
    state.loading = false;
    if (here()) paint();
    // Used / Unused, lazily, 8 at a time.
    const queue = (state.rows || []).filter((r) => r.balanceSompi === 0n);
    const page = state.page;
    const chain = state.chain;
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const known = await wallet.knownUsedState(row.address);
        const used = known ?? (await wallet.addressUsed(row.address));
        state.used.set(row.address, used);
        if (here() && state.page === page && state.chain === chain) paint();
      }
    };
    Promise.all(Array.from({ length: 8 }, worker));
  };

  const trailing = (row) => {
    if (row.balanceSompi > 0n) return `<span class="accent tiny">${esc((Number(row.balanceSompi) / 1e8).toFixed(4))} KAS</span>`;
    const used = state.used.get(row.address);
    if (used === true) return '<span class="used-badge used">Used</span>';
    if (used === false) return '<span class="muted tiny">Unused</span>';
    return '<span class="muted tiny">…</span>';
  };

  const toggle = async (row) => {
    if (row.revealed && row.visible && refuseHidingKusdtListed(row.index)) return;
    try {
      if (!row.revealed) await wallet.revealSpendingAddress(row.index);
      else await wallet.setSpendingHidden(row.index, row.visible);
    } catch (error) {
      toast(error.message);
      return;
    }
    await loadPage();
  };

  /** "n of m shown" for one chain's revealed addresses. */
  const shownText = (quantum) => {
    const rows = (state.list?.rows || []).filter((r) => Boolean(r.quantum) === quantum);
    if (!state.list) return "-";
    return `${rows.filter((r) => !r.hidden).length} of ${rows.length} shown`;
  };

  /** A chain's KAS, every address of it counted (KaPay iOS 3d126db): null until the list is in. */
  const chainSompi = (quantum) => (state.list ? (state.list.rows || []).filter((r) => Boolean(r.quantum) === quantum).reduce((sum, r) => sum + BigInt(r.balanceSompi || 0n), 0n) : null);
  // a chain's card (KaPay iOS 3d126db, connection-style): its icon, "n of m shown", its KAS
  const chainCard = (chain, icon, title, quantum) => {
    const sompi = chainSompi(quantum);
    return `
      <button class="conn-card" data-chain="${chain}">
        <span class="conn-card-icon">${icon}</span>
        <span class="conn-card-text"><span class="conn-card-title">${esc(title)}</span><span class="conn-card-summary">${esc(shownText(quantum))}</span></span>
        <span class="conn-card-trailing ${sompi != null && sompi > 0n ? "accent" : "muted"}">${sompi == null ? "" : `${esc(groupedKas8(sompi))} KAS`}</span>
        ${ICONS.chevron}
      </button>`;
  };

  function paintCards() {
    render(`
      <header class="navbar form-bar">
        <span></span>
        <div class="nav-title">Address Visibility</div>
        <button class="bar-text strong" id="done">Done</button>
      </header>
      <div class="manage-scroll">
        <div class="conn-cards vis-cards">
          ${chainCard("quantum", SHIELD_FILL, "Quantum Addresses", true)}
          ${chainCard("legacy", GRID_FILL, "Non-Quantum Addresses", false)}
        </div>
        <button class="ghost vis-hide-all" id="hide-all">Hide All</button>
      </div>`, "visibility");
    $("#done").onclick = onBack;
    for (const card of app.querySelectorAll("[data-chain]")) {
      card.onclick = () => { state.chain = card.dataset.chain; state.page = 0; loadPage(); };
    }
    // Hide All (confirmed): the list starts over with only the chatting address (iOS 245a5d2)
    $("#hide-all").onclick = () => showAlert({
      title: "Hide All Addresses?",
      message: "Every spending address leaves the list; only the chatting address stays. Their Kaspa still counts in your totals, and you can show any of them again here.",
      confirmLabel: "Hide All",
      cancelLabel: "Cancel",
      onConfirm: async () => { try { await wallet.hideAllSpending(kusdtListedIndices()); } catch (error) { toast(error.message); } await loadList(); if (here()) paint(); },
    });
  }

  function paint() {
    if (state.chain == null) { paintCards(); return; }
    const start = state.page * PAGE;
    render(`
      ${navHeader({ title: state.chain === "quantum" ? "Quantum Addresses" : "Non-Quantum Addresses" })}
      <div class="manage-scroll flush">
        ${state.loading ? '<div class="center-text pad"><span class="spinner"></span></div>'
          : !state.rows?.length ? '<p class="muted center-text pad">These addresses couldn\'t be derived right now. Go back a page or reopen this screen to retry.</p>'
          : `<div class="plain-list">${state.rows.map((row) => `
                <button class="vis-row" data-vis="${row.index}">
                  <span class="${row.visible ? "accent" : "muted"}">${row.visible ? ICONS.circleCheck : ICONS.circle}</span>
                  <span class="tx-meta">
                    <span><span class="strong small mono-digits">#${local(row.index)}</span>${quantumShieldHtml(row)}${row.customLabel ? ` <span class="muted tiny">${esc(row.customLabel)}</span>` : ""}</span>
                    <span class="mono tiny muted">${esc(`${row.address.slice(0, 16)}…${row.address.slice(-6)}`)}</span>
                  </span>
                  ${trailing(row)}
                </button>`).join("")}</div>`}
      </div>
      <div class="pager">
        <button class="icon plain accent" id="prev" ${state.page === 0 ? "disabled" : ""} aria-label="Previous page">${SF.chevronLeft}</button>
        <span class="strong small mono-digits">#${start} - #${start + PAGE - 1}</span>
        <button class="icon plain accent" id="next" aria-label="Next page">${SF.chevronRight}</button>
      </div>`, "visibility");
    $("#back").onclick = () => { state.chain = null; paint(); };
    $("#prev").onclick = () => { if (state.page > 0) { state.page -= 1; loadPage(); } };
    $("#next").onclick = () => { state.page += 1; loadPage(); };
    for (const button of app.querySelectorAll("[data-vis]")) {
      button.onclick = () => toggle(state.rows.find((r) => r.index === Number(button.dataset.vis)));
    }
  }

  paint();
  loadList().then(() => { state.loading = false; if (here()) paint(); });
}

// --- Change Chatting Address: iOS ChattingAddressPickerView ------------------------------------
//
// For imported accounts: the phrase may already hold your identity at another index of its
// family - a KNS domain or a funded balance. Scans 50 at a time; lists an index when it holds
// Kaspa or domains, or is #0, or is the current one.

/** Each candidate's .kachat names (K iOS NameServicesClient.kachatNames(of:)): the registry's batch
 *  identity read, else one read per address; none where the registry isn't live. */
async function addKachatNames(rows) {
  const registry = kachatRegistry();
  if (!registry || !rows.length) return;
  let found = null;
  try { found = await registry.identities(rows.map((r) => r.address)); } catch { found = null; }
  for (const row of rows) {
    let identity = found?.get(String(row.address).toLowerCase()) ?? null;
    if (!found) { try { identity = await registry.identity(row.address); } catch { identity = null; } }
    row.kachatNames = Array.isArray(identity?.names) ? identity.names : [];
  }
}

function showChattingAddressPicker({ onBack, onChanged }) {
  const state = { rows: [], scanned: 0, scanning: false, current: 0, error: "", scansFurther: true };
  const pickerBack = () => { state.scanning = false; paint(); };

  const scan = async () => {
    state.scanning = true;
    state.error = "";
    paint();
    try {
      const { rows, currentIndex, scansFurther } = await wallet.scanIdentityAddresses(state.scanned, 50);
      state.current = currentIndex;
      state.scansFurther = scansFurther !== false;
      await addKachatNames(rows);
      state.rows.push(...rows);
      state.scanned += 50;
    } catch {
      state.error = "Could not derive addresses from these words. Please try again.";
    }
    state.scanning = false;
    if (app.dataset.screen === "identity-picker") paint();
  };

  const paint = () => {
    // .kachat names count too, and name the row first (K iOS ChattingAddressCandidate)
    const nameCount = (r) => (r.kachatNames?.length || 0) + (r.domains?.length || 0) + (r.otherNames?.length || 0);
    const onlyName = (r) => (nameCount(r) === 1 ? (r.kachatNames?.[0] ? kachatLabel(r.kachatNames[0]) : r.domains?.[0]?.fullName || r.otherNames?.[0]?.display) : null);
    const shown = state.rows.filter((r) => r.balanceSompi > 0n || nameCount(r) > 0 || r.index === 0 || r.index === state.current);
    render(`
      ${navHeader({ title: "Chatting Address" })}
      <section class="screen manage">
        <div class="source-head">
          <h2>Choose Your Chatting Address</h2>
          <p class="muted">If these words already hold your identity at a different address - a domain (.kachat, .kas, .k or .kaspa) or a funded chatting balance - pick it here. Only addresses with a balance or domains are shown.</p>
        </div>
        <div class="glass list">
          ${shown.map((row) => `
            <button class="list-row identity-row" data-index="${row.index}">
              <span class="identity-index">#${row.index}</span>
              <span class="tx-meta"><span class="mono small">${esc(row.address.slice(0, 10))}...${esc(row.address.slice(-6))}</span><span class="muted tiny">${esc(wallet.formatKas(row.balanceSompi, 8))} KAS</span></span>
              ${nameCount(row) ? `<span class="chip accent">${esc(onlyName(row) || `${nameCount(row)} domains`)}</span>` : ""}
              <span class="${row.index === state.current ? "accent strong" : "muted strong"} tiny">${row.index === state.current ? "Current" : row.index === 0 ? "Default" : ""}</span>
              ${ICONS.chevron}
            </button>`).join("") || (state.scanning ? "" : '<div class="list-row muted">Nothing found yet.</div>')}
        </div>
        ${state.error ? `<p class="error">${esc(state.error)}</p>` : ""}
        ${state.scanning
          ? `<p class="muted small center-text"><span class="spinner small-spin"></span> ${state.scansFurther ? `Scanning addresses ${state.scanned + 1} to ${state.scanned + 50}...` : "Checking this wallet's address..."}</p>`
          // a single-address wallet type (Chainge) has nothing further to scan (KaChat-Desktop Build 277)
          : !state.scanned ? ""
          : !state.scansFurther ? '<p class="muted small center-text">This wallet type has a single address, so there is nothing further to scan.</p>'
          : `<p class="muted small center-text">Scanned the first ${state.scanned} addresses.</p><button class="soft with-icon" id="further">${ICONS.search}<span>Scan Further</span></button>`}
      </section>`, "identity-picker");
    $("#back").onclick = onBack;
    const further = $("#further");
    if (further) further.onclick = scan;
    for (const button of app.querySelectorAll("[data-index]")) {
      const row = state.rows.find((r) => r.index === Number(button.dataset.index));
      button.onclick = () => showIdentityDetail({ row, current: state.current, onBack: pickerBack, onChanged });
    }
  };
  paint();
  scan();
}

function showIdentityDetail({ row, current, onBack, onChanged }) {
  const isCurrent = row.index === current;
  render(`
    ${navHeader({ title: "Chatting Address" })}
    <section class="screen manage">
      <h2>Address #${row.index}</h2>
      <button class="manage-address mono" id="copy">${esc(row.address)}</button>
      <p class="muted tiny center-text">Tap the address to copy it</p>
      <div class="glass list"><div class="list-row"><span>Balance</span><span>${esc(wallet.formatKas(row.balanceSompi, 8))} KAS</span></div></div>
      ${row.kachatNames?.length ? `
        <div class="section-header">.kachat Names (${row.kachatNames.length})</div>
        ${row.kachatNames.map((n) => `<div class="domain-card small-card"><span class="domain-name">${esc(kachatLabel(n))}</span></div>`).join("")}` : ""}
      ${row.otherNames?.length ? `
        <div class="section-header">.k and .kaspa Names (${row.otherNames.length})</div>
        ${row.otherNames.map((n) => `<div class="domain-card small-card"><span class="domain-name">${esc(n.display)}</span>${n.provisional ? '<span class="domain-badge">Settling</span>' : ""}</div>`).join("")}` : ""}
      ${row.domains?.length ? `
        <div class="section-header">.kas Names (${row.domains.length})</div>
        ${row.domains.map((d) => `<div class="domain-card small-card"><span class="domain-name">${esc(d.fullName)}</span>${String(d.fullName).toLowerCase() === String(row.primaryDomain || "").toLowerCase() ? '<span class="domain-badge">Primary</span>' : ""}</div>`).join("")}` : ""}
      <p class="error" id="error"></p>
      <div class="spacer"></div>
      <button id="set" ${isCurrent ? "disabled" : ""}>${isCurrent ? "Current Chatting Address" : "Set as Chatting Address"}</button>
    </section>`, "identity-detail");
  $("#back").onclick = onBack;
  $("#copy").onclick = () => copyText(row.address);
  $("#set").onclick = async () => {
    const button = $("#set");
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span>';
    try {
      // the account this window shows, refused if another window switched since (audit 2026-11-07)
      const accountId = shownActiveAccount(await vault.readAccounts()).id;
      const before = (await wallet.cachedAddresses(accountId))?.main
        || (await wallet.identityFor(accountId).catch(() => null))?.address || null;
      await vault.setIdentityIndex(accountId, row.index);
      const derived = await wallet.deriveAddresses();
      // what it owes a backup, its contacts and its bell feed move with it (audit 2026-11-07)
      await carryAccountData(before, derived.main);
      // Connected websites follow the account to its new chatting address (audit EXT-001).
      await followAccount(accountId);
      toast(`Chatting address set to #${row.index}.`);
      onChanged();
    } catch (error) {
      $("#error").textContent = error.message;
      button.disabled = false;
      button.textContent = "Set as Chatting Address";
    }
  };
}
