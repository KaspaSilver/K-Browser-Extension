// Cold Storage - a 1:1 port of the iOS tab (Views/ColdStorage/ColdStorageView.swift and
// Services/ColdStorageManager.swift):
//
//   ColdStorageListView          the tab root: watch-only KasSigner accounts, Paste kpub / Scan,
//                                Enter kpub, Name This Account, the account actions sheet
//                                (Copy kpub, Show kpub QR, Rename) and the kpub QR page
//   ColdStorageDetailView        one account: Name, Total Balance, the addresses, and the floating
//                                Address Actions button (Copy kpub lives there: no kpub on screen)
//                                (Generate More, Discover, Address Visibility), its addresses
//   ColdStorageAddressVisibilityView   the checklist, 50 a page, endless
//   ColdStorageAddressTransactionHistoryView   one address: History | UTXOs | .kachat,
//                                Receive / Send, the Transaction sheet (Add to Portfolio),
//                                Compound UTXOs, Rename UTXO
// The KasSigner send flow is in cold-send.js.
//
// A cold account is a kpub (account m/44'/111111'/0'): the receive chain (kpub -> 0 -> i) is
// derived here, change goes back to the sending address, and signing happens on the device over a
// QR exchange. Since K iOS 961fc05a (K-Desktop 9c30208) an account also watches KasSigner v1.1's
// quantum-resistant (KCC-3) addresses, each scanned or pasted from the unit (it never exports their
// 22' kpub): they list after the derived ones, a send from one spends every coin and puts its change
// on another unused quantum address of the account, and the request is KSPT 0x06. Accounts are kept per wallet account, like iOS keeps them
// per wallet. Left out: the per-account receive notifications toggle (the extension has none).

import { netKey } from "./net.js";
import { ownsAnyName } from "./names.js";
import "./cold.css";
import QRCode from "qrcode";
import * as wallet from "./wallet.js";
import * as vault from "./vault.js";
import * as dock from "./dock.js";
import { getLocal, setLocal, removeLocal } from "./browser.js";
import {
  app, esc, render, $, toast, copyText, copySecret, ICONS, navHeader, showQr, showSheet, showAlert, groupedKas8, RECEIVE_NOTES, balanceCardHtml, pageCycleHtml,
} from "./ui.js";
import { scanQr } from "./camera.js";
import { kachatWordmark } from "./market.js";
import { addressNamesTab, showLiveNameDetail } from "./kachat-live.js";
import { addressDomainsTab } from "./address-domains.js";
import { kachatRegistry } from "./kachat-names.js";
import { showAddToPortfolio } from "./portfolio.js";
import { showColdSend } from "./cold-send.js";
import { unreadableBalanceHtml, addressOptionsButtonHtml, showAddressActions, showPublicKey, fiatTextFor, addressActionsFabHtml } from "./manage.js";
import { SF, txDate, feeText, portfolioKas, middle, shortAddress, fieldSheet, xOnlyKeyFromAddress } from "./cold-common.js";
import { quantumShieldHtml } from "./manage.js";
import { knownSpentQuantum, coldQuantumSpentState } from "./cold-quantum-state.js";
import { isScriptHashAddress, isValidKaspaAddress } from "../shared/ui/kspt.js";
import {
  COLD_QUANTUM_INDEX_BASE, isColdQuantumIndex, normalizeQuantumRecords, quantumDefaultLabel, quantumAddressInput,
  parseUnitNumber, quantumIndexOf, afterQuantumRemoval, ownChangeHistoryAmount, QUANTUM_CHAIN_RECEIVE, QUANTUM_CHAIN_CHANGE,
} from "../shared/ui/cold-quantum.js";

const INVALID_KPUB = "That doesn't look like a valid Kaspa extended public key (kpub).";

// --- storage: kachat.cold.<wallet account id> -> [{ id, label, kpub, maxAddressIndex,
//     importedAt, labels: { index: label }, hidden: [index], quantumAddresses }] ---------------

let store = { key: null, accounts: [] };

async function storageKey() {
  const view = await vault.readAccounts();
  return netKey(`kachat.cold.${view.activeAccountId || view.accounts?.[0]?.id || "default"}`);
}

function normalize(raw) {
  if (!raw || typeof raw.kpub !== "string" || !raw.kpub) return null;
  return {
    id: String(raw.id || crypto.randomUUID()),
    label: String(raw.label || "Cold Storage"),
    kpub: raw.kpub.trim(),
    maxAddressIndex: Math.max(0, Number.parseInt(raw.maxAddressIndex, 10) || 0),
    importedAt: Number(raw.importedAt) || Date.now(),
    labels: raw.labels && typeof raw.labels === "object" ? { ...raw.labels } : {},
    hidden: Array.isArray(raw.hidden) ? [...new Set(raw.hidden.map(Number).filter(Number.isInteger))] : [],
    // the bell notes Kaspa this account receives (K iOS ColdStorageAccount.notifyOnReceive): on
    // unless turned off
    notifyOnReceive: raw.notifyOnReceive !== false,
    // KasSigner's quantum-resistant (KCC-3, m/22') addresses watched here, in the order added, each
    // { address, unitIndex, chain, addedAt } (K iOS 961fc05a ColdStorageAccount.quantumAddresses).
    // They sit at COLD_QUANTUM_INDEX_BASE + position in the account's labels and hidden.
    quantumAddresses: normalizeQuantumRecords(raw.quantumAddresses),
  };
}

// bell / bell.slash: Receive Notifications on an account's actions
const BELL = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';
const BELL_SLASH = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 5.6A6 6 0 0 1 18 11v4M6 11v5l-1.5 2H17"/><path d="M10 20.5a2 2 0 0 0 4 0M3 3l18 18"/></svg>';

async function loadAccounts() {
  const key = await storageKey();
  const raw = await getLocal(key);
  const accounts = Array.isArray(raw) ? raw.map(normalize).filter(Boolean) : [];
  store = { key, accounts };
  return accounts;
}

/** Every watched KasSigner address (0...maxAddressIndex of each account), for the .kachat names
 *  that may sit on them: `[{ account: label, index, address }]` (iOS kasSignerAddresses). */
export async function coldWatchAddresses() {
  const out = [];
  for (const account of await loadAccounts()) {
    // an account with Receive Notifications off isn't watched, and only the addresses an account
    // shows are (K iOS: hidden ones aren't)
    if (account.notifyOnReceive === false) continue;
    const hidden = new Set(account.hidden);
    try {
      const addresses = await wallet.kpubAddresses(account.kpub, 0, account.maxAddressIndex + 1);
      addresses.forEach((address, index) => { if (!hidden.has(index)) out.push({ account: account.label, index, address }); });
    } catch { /* an unreadable kpub holds nothing we can show */ }
    // the quantum addresses added by scan, after the derived ones (K iOS 961fc05a)
    account.quantumAddresses.forEach((q, position) => {
      const index = COLD_QUANTUM_INDEX_BASE + position;
      if (!hidden.has(index)) out.push({ account: account.label, index, address: q.address });
    });
  }
  return out;
}

/** Writes the list back under the key it was read from (`key`, from loadAccounts' store), never one
 *  worked out again: an account switched in another window meanwhile would otherwise get this
 *  account's watch list (audit 2026-11-13). */
async function saveAccounts(accounts, key) {
  if (!key) throw new Error("Cold Storage list written without the account it was read for.");
  store = { key, accounts };
  await setLocal(key, accounts);
}

async function getAccount(id) {
  return (await loadAccounts()).find((a) => a.id === id) || null;
}

/** Reads fresh, changes one account, writes back. Returns the changed account (or null). */
async function updateAccount(id, change) {
  const accounts = await loadAccounts();
  const { key } = store;
  const account = accounts.find((a) => a.id === id);
  if (!account) return null;
  change(account);
  await saveAccounts(accounts, key);
  return account;
}

/** iOS importAccount: a kpub already watched only takes the new name. */
async function importAccount(kpub, label) {
  const accounts = await loadAccounts();
  const { key } = store;
  const name = label.trim() || `Cold Storage ${accounts.length + 1}`;
  const existing = accounts.find((a) => a.kpub === kpub);
  if (existing) existing.label = name;
  else accounts.push(normalize({ id: crypto.randomUUID(), label: name, kpub, maxAddressIndex: 0, importedAt: Date.now() }));
  await saveAccounts(accounts, key);
}

function labelOf(account, index) {
  const label = String(account.labels?.[index] ?? "").trim();
  return label || null;
}

/** iOS displayLabel: your label, else "Address #<index>" (a quantum address: its chain and number
 *  on the unit, "Quantum Address #3" or "Quantum Change Address #0"). */
function displayLabel(entry) {
  return entry.label || entry.defaultLabel || `Address #${entry.index}`;
}

/** The name a quantum address of `account` shows. */
function quantumLabelIn(account, address) {
  const position = (account?.quantumAddresses || []).findIndex((q) => q.address === String(address || "").toLowerCase());
  if (position < 0) return "Quantum Address";
  const record = account.quantumAddresses[position];
  return labelOf(account, COLD_QUANTUM_INDEX_BASE + position) || quantumDefaultLabel(record.chain, record.unitIndex);
}

/** The index a quantum row files its label and hidden flag under now: an earlier quantum address may
 *  have stopped being watched since the row was drawn (K-Desktop currentIndexOf). */
function currentIndexOf(account, entry) {
  return isColdQuantumIndex(entry.index) ? quantumIndexOf(account.quantumAddresses, entry.address) : entry.index;
}

// --- per-address knowledge shared by the account screen and the checklist -------------------

const balanceCache = new Map(); // address -> sompi, last known
const domainOwners = new Map(); // address -> holds a .kachat name
const usedState = new Map();    // address -> true | false | "unknown" (probe failed)

/** iOS getAddressList: 0...maxAddressIndex with live balances (batched), labels and hidden. A
 *  balance that can't be read and was never read is null - unknown, never 0 (KaPay iOS 0799cec). */
async function addressList(account) {
  const derived = await wallet.kpubAddresses(account.kpub, 0, account.maxAddressIndex + 1);
  // the quantum addresses added by scan, after the derived ones, at base + their place (K iOS
  // 961fc05a getAddressList)
  const quantum = account.quantumAddresses.map((q) => q.address);
  const addresses = [...derived, ...quantum];
  let balances = null;
  try { balances = await wallet.balancesFor(addresses); } catch { balances = null; }
  // a failed read isn't an empty address: the last figures known, kept across windows (KaPay iOS 2da5f4b)
  if (!balances) await restoreKnownBalances();
  const hidden = new Set(account.hidden);
  const list = addresses.map((address, at) => {
    const quantumAt = at - derived.length;
    const index = quantumAt >= 0 ? COLD_QUANTUM_INDEX_BASE + quantumAt : at;
    const balanceSompi = balances ? (balances[address] ?? 0n) : (balanceCache.get(address) ?? null);
    if (balances) balanceCache.set(address, balanceSompi);
    const entry = { index, address, balanceSompi, label: labelOf(account, index), hidden: hidden.has(index) };
    if (quantumAt >= 0) {
      const record = account.quantumAddresses[quantumAt];
      entry.quantum = true;
      entry.defaultLabel = quantumDefaultLabel(record.chain, record.unitIndex);
    }
    return entry;
  });
  if (balances) keepKnownBalances(addresses);
  return list;
}

async function knownBalancesKey() {
  const view = await vault.readAccounts();
  return netKey(`kachat.coldBalances.${view.activeAccountId || view.accounts?.[0]?.id || "default"}`);
}
async function restoreKnownBalances() {
  try {
    for (const [address, sompi] of Object.entries((await getLocal(await knownBalancesKey())) || {})) {
      if (!balanceCache.has(address)) balanceCache.set(address, BigInt(sompi));
    }
  } catch { /* nothing saved: unknown stays unknown */ }
}
async function keepKnownBalances(addresses) {
  try {
    const key = await knownBalancesKey();
    const known = (await getLocal(key)) || {};
    for (const address of addresses) known[address] = String(balanceCache.get(address) ?? 0n);
    await setLocal(key, known);
  } catch { /* the next read saves it */ }
}

// Discovery asks for a .kachat name (K iOS 518fdc8c: .kachat is the only name service).
async function ownsAnyNameAt(address) {
  if (domainOwners.get(address)) return true;
  const owns = await ownsAnyName(address).catch(() => false);
  if (owns) domainOwners.set(address, true);
  return owns;
}

/** Has it ever been used? true / false, or null when the probe failed (iOS spendingAddressUsedState). */
async function probeUsed(address) {
  const known = await wallet.knownUsedState(address);
  if (known != null) return known;
  return wallet.addressUsed(address);
}

/** Hiding re-checks the live balance and fails closed (iOS setAddressHidden). */
async function setHidden(account, index, hidden) {
  if (hidden) {
    try {
      const [address] = isColdQuantumIndex(index)
        ? [account.quantumAddresses[index - COLD_QUANTUM_INDEX_BASE]?.address]
        : await wallet.kpubAddresses(account.kpub, index, index + 1);
      if (!address) return false;
      const live = (await wallet.balancesFor([address]))[address] ?? 0n;
      if (live > 0n) return false;
    } catch {
      return false;
    }
  }
  await updateAccount(account.id, (a) => {
    const set = new Set(a.hidden);
    if (hidden) set.add(index); else set.delete(index);
    a.hidden = [...set];
  });
  return true;
}

/** iOS revealAddress: extends the chain to `index`, keeping the indexes in between hidden. */
async function revealAddress(account, index) {
  await updateAccount(account.id, (a) => {
    const set = new Set(a.hidden);
    if (index > a.maxAddressIndex) {
      for (let i = a.maxAddressIndex + 1; i < index; i += 1) set.add(i);
      a.maxAddressIndex = index;
    }
    set.delete(index);
    a.hidden = [...set];
  });
}

/**
 * iOS lowestUnusedAddress ("Generate More Addresses"): the lowest HIDDEN index with no balance
 * that a probe confirms was never used is shown again; otherwise the chain grows by one.
 */
async function generateAddress(accountId) {
  const account = await getAccount(accountId);
  if (!account) throw new Error("This account is no longer in Cold Storage.");
  const entries = await addressList(account);
  let pick = null;
  for (const entry of entries) {
    // funded, or unread (it may be): not a fresh one; a quantum address isn't the kpub's to hand out
    if (entry.quantum || !entry.hidden || entry.balanceSompi !== 0n) continue;
    if ((await probeUsed(entry.address)) === false) { pick = entry.index; break; }
  }
  await updateAccount(accountId, (a) => {
    if (pick == null) { a.maxAddressIndex += 1; pick = a.maxAddressIndex; }
    a.hidden = a.hidden.filter((i) => i !== pick);
  });
  return pick;
}

/**
 * iOS discoverAddresses: the first thousand addresses whatever the gaps. POST /addresses/active
 * says which were ever touched; only those are asked for balances, and the unfunded ones under
 * #200 for a .kachat name. A match holds a balance or a username. Without /addresses/active it falls
 * back to the batched sweep (100 a batch, names under #200, past #1000 it stops after 60 misses).
 * Returns how many matched.
 */
async function discoverAddresses(accountId, onProgress) {
  const DEPTH = 1000;
  const MAX_INDEX = 5000;
  const BATCH = 100;
  const NAME_DEPTH = 200;
  const GAP = 60;
  const account = await getAccount(accountId);
  if (!account) return 0;
  let lastMatch = -1;
  let matchCount = 0;
  const matched = new Set();
  const window = await wallet.kpubAddresses(account.kpub, 0, DEPTH);
  onProgress({ checkingIndex: 0, foundCount: 0 });

  let activity = null;
  try { activity = await wallet.addressesActive(window); } catch { activity = null; }
  if (activity) {
    const touched = window.map((address, index) => ({ address, index })).filter((t) => activity[t.address]);
    const funded = new Set();
    if (touched.length) {
      try {
        const balances = await wallet.balancesFor(touched.map((t) => t.address));
        for (const [address, sompi] of Object.entries(balances)) {
          balanceCache.set(address, sompi);
          if (sompi > 0n) funded.add(address);
        }
      } catch { /* a balance we cannot read is not an empty one; the name check still decides below */ }
    }
    onProgress({ checkingIndex: touched.length ? touched[touched.length - 1].index : 0, foundCount: funded.size });
    const owners = new Set();
    await Promise.all(touched
      .filter((t) => t.index < NAME_DEPTH && !funded.has(t.address))
      .map(async (t) => { if (await ownsAnyNameAt(t.address)) owners.add(t.address); }));
    for (const t of touched) {
      if (funded.has(t.address) || owners.has(t.address)) {
        lastMatch = Math.max(lastMatch, t.index);
        matchCount += 1;
        matched.add(t.index);
      }
    }
  } else {
    let misses = 0;
    let index = 0;
    while (index < MAX_INDEX) {
      if (index >= DEPTH && misses >= GAP) break;
      onProgress({ checkingIndex: index, foundCount: matchCount });
      const upper = Math.min(index + BATCH, MAX_INDEX);
      const derived = upper <= DEPTH ? window.slice(index, upper) : await wallet.kpubAddresses(account.kpub, index, upper);
      if (!derived.length) break;
      let balances;
      try { balances = await wallet.balancesFor(derived); } catch { break; }
      for (let i = 0; i < derived.length; i += 1) {
        const address = derived[i];
        const at = index + i;
        balanceCache.set(address, balances[address] ?? 0n);
        const matches = (balances[address] ?? 0n) > 0n || (at < NAME_DEPTH && await ownsAnyNameAt(address));
        if (matches) {
          lastMatch = at;
          matchCount += 1;
          matched.add(at);
          misses = 0;
        } else {
          misses += 1;
        }
      }
      index += derived.length;
    }
  }

  // The bound covers the highest match (it only grows); the empty indexes it sweeps in are
  // hidden, and every match is shown again.
  await updateAccount(accountId, (a) => {
    const hidden = new Set(a.hidden);
    if (lastMatch > a.maxAddressIndex) {
      const previous = a.maxAddressIndex;
      a.maxAddressIndex = lastMatch + 1;
      for (let i = previous + 1; i < lastMatch; i += 1) if (!matched.has(i)) hidden.add(i);
    }
    for (const i of matched) hidden.delete(i);
    a.hidden = [...hidden];
  });
  return matchCount;
}

// --- quantum-resistant (KCC-3) addresses (K iOS 961fc05a ColdStorageManager) ------------------

const NOT_QUANTUM = "That isn't a quantum-resistant address. Scan the KCC-3 address KasSigner shows.";

/** A KasSigner KCC-3 address (pay-to-script-hash) of this network, as typed, scanned or pasted. */
async function isQuantumAddressText(address) {
  const engine = await wallet.ksptEngine();
  return isValidKaspaAddress(engine, address) && isScriptHashAddress(engine, address);
}

/** Adds a KCC-3 address to the account (K addQuantumAddress). The text can't say what is behind the
 *  hash, so the unit checks it holds the key when it signs. Returns an error message, or null. */
async function addQuantumAddress(accountId, text, unitIndex, chain) {
  const address = quantumAddressInput(text);
  if (!(await isQuantumAddressText(address))) return NOT_QUANTUM;
  const accounts = await loadAccounts();
  const { key } = store;
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return "This account is no longer in Cold Storage.";
  if (account.quantumAddresses.some((q) => q.address === address)) return "That address is already in this account.";
  // one address, one account: watched twice its coins would count in both totals, and a send from
  // one could pick it as the other's change
  const other = accounts.find((a) => a.id !== accountId && a.quantumAddresses.some((q) => q.address === address));
  if (other) return `That address is already in your Cold Storage account “${other.label}”.`;
  account.quantumAddresses.push({ address, unitIndex, chain: chain === QUANTUM_CHAIN_CHANGE ? QUANTUM_CHAIN_CHANGE : QUANTUM_CHAIN_RECEIVE, addedAt: Date.now() });
  await saveAccounts(accounts, key);
  return null;
}

/** Stops watching a quantum address (its coins stay on chain). Labels and hidden flags after it
 *  move up a place with their addresses. */
async function removeQuantumAddress(accountId, address) {
  const lowered = String(address || "").toLowerCase();
  let removed = false;
  await updateAccount(accountId, (a) => {
    const position = a.quantumAddresses.findIndex((q) => q.address === lowered);
    if (position < 0) return;
    a.quantumAddresses.splice(position, 1);
    const moved = afterQuantumRemoval({ labels: a.labels, hidden: a.hidden }, position);
    a.labels = moved.labels;
    a.hidden = moved.hidden;
    removed = true;
  });
  // its coin labels go, unless another account still watches it
  if (removed && !(await loadAccounts()).some((a) => a.quantumAddresses.some((q) => q.address === lowered))) {
    await removeLocal(wallet.utxoLabelKeysFor([lowered])).catch(() => {});
  }
}

/**
 * Add Quantum-Resistant Address (K ColdQuantumAddressAddSheet) and Edit Address Number (K
 * ColdQuantumAddressNumberSheet): the address (scan or paste; adding only), which of the unit's
 * KCC-3 chains it is on, and its number there, optional. `onSave({ address, unitIndex, chain })`
 * answers an error message, or null to close.
 */
function quantumSheet({ adding, address = "", unitIndex = null, chain = QUANTUM_CHAIN_RECEIVE, onSave }) {
  document.querySelector(".sheet-backdrop")?.remove();
  const form = { address, number: Number.isInteger(unitIndex) ? String(unitIndex) : "", chain, error: "", saving: false };
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") close(); };
  const draw = () => {
    const option = (value, label) => `<button type="button" role="radio" data-q-chain="${value}" aria-checked="${form.chain === value}">${label}</button>`;
    backdrop.innerHTML = `
      <form class="sheet cold-field-sheet cold-quantum-sheet" role="dialog" aria-modal="true" aria-label="${adding ? "Add Quantum Address" : "Edit Address Number"}" novalidate>
        <div class="sheet-grabber"></div>
        <div class="sheet-head"><div class="sheet-title">${adding ? "Add Quantum Address" : "Edit Address Number"}</div></div>
        ${adding ? `
          <div class="cold-quantum-label">Quantum-Resistant Address</div>
          <textarea class="cold-field mono" data-q-address rows="3" placeholder="kaspa:p..." spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Quantum-resistant address">${esc(form.address)}</textarea>
          <div class="cold-quantum-input-actions">
            <button type="button" class="ios-capsule with-icon" data-q-paste>${SF.doc}<span>Paste</span></button>
            <button type="button" class="ios-capsule with-icon" data-q-scan>${SF.qrcodeSmall}<span>Scan QR</span></button>
          </div>
          <p class="muted tiny cold-quantum-hint">On KasSigner, open the KCC-3 address you want and scan its QR code. Its key stays on the unit until the address spends.</p>`
        : `<p class="mono tiny muted cold-quantum-address">${esc(form.address)}</p>`}
        <div class="cold-quantum-label">Address Number on KasSigner</div>
        <div class="segmented wide" role="radiogroup" aria-label="Chain">${option(QUANTUM_CHAIN_RECEIVE, "Receive Address")}${option(QUANTUM_CHAIN_CHANGE, "Change Address")}</div>
        <input class="cold-field" data-q-number type="text" inputmode="numeric" placeholder="Number (optional)" autocomplete="off" aria-label="Number" value="${esc(form.number)}" />
        <p class="muted tiny cold-quantum-hint">The number KasSigner shows for this address, and whether it is a receive or a change address. With it the unit finds the key at once when signing; without it the unit searches for it. KasSigner marks change sent to its change addresses #0 to #4 as change; any other address it shows as a payment.</p>
        ${form.error ? `<p class="danger-text small cold-quantum-error">${esc(form.error)}</p>` : ""}
        <div class="cold-sheet-buttons">
          <button type="button" class="cold-sheet-cancel" data-cancel>Cancel</button>
          <button type="submit" class="cold-sheet-confirm" data-q-save ${(adding && !form.address.trim()) || form.saving ? "disabled" : ""}>${adding ? "Add" : "Save"}</button>
        </div>
      </form>`;
    const addressField = backdrop.querySelector("[data-q-address]");
    const save = backdrop.querySelector("[data-q-save]");
    if (addressField) addressField.oninput = () => { form.address = addressField.value; save.disabled = !form.address.trim(); };
    backdrop.querySelector("[data-q-number]").oninput = (event) => { form.number = event.target.value; };
    for (const button of backdrop.querySelectorAll("[data-q-chain]")) {
      button.onclick = () => { form.chain = Number(button.dataset.qChain) === QUANTUM_CHAIN_CHANGE ? QUANTUM_CHAIN_CHANGE : QUANTUM_CHAIN_RECEIVE; draw(); };
    }
    const paste = backdrop.querySelector("[data-q-paste]");
    if (paste) {
      paste.onclick = async () => {
        try {
          const text = (await navigator.clipboard.readText())?.trim();
          if (!text || !backdrop.isConnected) return;
          form.address = text;
          form.error = "";
          draw();
        } catch { toast("Clipboard unavailable. Paste into the field directly."); }
      };
    }
    const scan = backdrop.querySelector("[data-q-scan]");
    if (scan) {
      scan.onclick = async () => {
        const scanned = await scanQr({ title: "Scan a Quantum-Resistant Address", hint: "Line up the KCC-3 address QR code KasSigner shows" });
        if (!scanned || !backdrop.isConnected) return;
        form.address = quantumAddressInput(scanned);
        form.error = (await isQuantumAddressText(form.address)) ? "" : NOT_QUANTUM;
        draw();
      };
    }
    backdrop.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      if (form.saving) return;
      const number = parseUnitNumber(form.number);
      if (!number.ok) { form.error = number.message; draw(); return; }
      form.saving = true;
      draw();
      let error = null;
      try { error = await onSave({ address: form.address, unitIndex: number.value, chain: form.chain }); } catch (e) { error = String(e?.message || e); }
      form.saving = false;
      if (error) { form.error = error; draw(); return; }
      close();
    };
  };
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
    else if (event.target.closest("[data-cancel]")) close();
  });
  document.addEventListener("keydown", onKey);
  draw();
  document.body.appendChild(backdrop);
  backdrop.querySelector("[data-q-address]")?.focus();
}

// =============================================================================================
// SCREEN 1 - the list (tab root)
// =============================================================================================

export function showColdStorage() {
  const paint = (accounts) => {
    const scroll = app.querySelector(".cold-scroll")?.scrollTop || 0;
    render(`
      ${dock.tabTopHtml("Cold Storage")}
      <div class="cold-scroll">
        ${accounts && !accounts.length ? `
          <div class="cold-empty">
            <span class="muted">${SF.lockShield}</span>
            <div class="cold-empty-title">No Cold Storage Accounts</div>
            <p class="muted">Scan or paste a kpub exported from your KasSigner device to watch its balance.</p>
          </div>` : ""}
        ${(accounts || []).map((account) => `
          <div class="glass cold-account" data-open="${esc(account.id)}" role="button" tabindex="0">
            <span class="accent cold-account-lock">${SF.lockFill}</span>
            <span class="tx-meta">
              <span class="cold-account-label">${esc(account.label)}</span>
            </span>
            <button class="icon plain cold-more" data-more="${esc(account.id)}" aria-label="Account actions">${SF.ellipsis}</button>
          </div>`).join("")}
      </div>
      <div class="ios-bottom-bar cold-list-bar">
        <button class="ios-capsule with-icon" id="paste-kpub">${SF.docOnClipboard}<span>Paste kpub</span></button>
        <button class="ios-capsule with-icon cold-bold" id="scan-kpub">${SF.viewfinder}<span>Scan</span></button>
      </div>`, "cold:list");
    dock.bindTabTop();
    dock.remember(() => showColdStorage());
    const scroller = app.querySelector(".cold-scroll");
    if (scroller) scroller.scrollTop = scroll;
    const byId = (id) => (accounts || []).find((a) => a.id === id);
    for (const row of app.querySelectorAll("[data-open]")) {
      row.onclick = (event) => {
        if (event.target.closest("[data-more]")) return;
        showAccount({ accountId: row.dataset.open, onBack: () => showColdStorage() });
      };
      row.onkeydown = (event) => { if (event.key === "Enter") row.click(); };
    }
    for (const button of app.querySelectorAll("[data-more]")) button.onclick = () => accountActions(byId(button.dataset.more));
    $("#paste-kpub").onclick = () => pasteKpub();
    $("#scan-kpub").onclick = async () => {
      const code = await scanQr({ title: "Scan QR Code", hint: "Point camera at a QR code" });
      if (code) beginImport(code);
    };
  };

  const refresh = async () => {
    try {
      const accounts = await loadAccounts();
      if (app.dataset.screen === "cold:list") paint(accounts);
    } catch (error) {
      toast(error.message);
    }
  };

  // Paints at once from what is known, then from storage.
  paint(store.accounts.length ? store.accounts : null);
  refresh();

  // Paste kpub takes what's on the clipboard at once (K iOS b0f0a4e6): a valid kpub goes straight
  // to Name This Account, anything else is a toast. A clipboard the browser won't read opens the
  // Enter kpub sheet to paste into instead.
  async function pasteKpub() {
    let text;
    try { text = (await navigator.clipboard.readText()).trim(); } catch { manualEntry(); return; }
    const kpub = text ? await wallet.validateKpub(text) : null;
    if (!kpub) { toast("Not a valid kpub"); return; }
    beginImport(kpub);
  }

  // Enter kpub: a half sheet with one field.
  function manualEntry() {
    fieldSheet({
      title: "Enter kpub",
      subtitle: "Paste the kpub exported from your KasSigner device. It contains no private key material.",
      placeholder: "kpub...",
      multiline: true,
      mono: true,
      confirmLabel: "Next",
      onConfirm: (text) => beginImport(text),
    });
  }

  async function beginImport(raw) {
    const kpub = await wallet.validateKpub(String(raw || "").trim());
    if (!kpub) {
      showAlert({ title: "Import Failed", message: INVALID_KPUB, confirmLabel: "OK" });
      return;
    }
    const count = (await loadAccounts()).length;
    fieldSheet({
      title: "Name This Account",
      subtitle: "Give this account a name so you can recognize it.",
      placeholder: "Name",
      value: `Cold Storage ${count + 1}`,
      confirmLabel: "Import",
      onConfirm: async (name) => {
        try {
          await importAccount(kpub, name);
        } catch (error) {
          showAlert({ title: "Import Failed", message: error.message, confirmLabel: "OK" });
        }
        refresh();
      },
    });
  }

  function accountActions(account) {
    if (!account) return;
    showSheet({
      title: account.label,
      cancel: false,
      rows: [
        {
          label: "Copy kpub", subtitle: "Puts the extended public key on the clipboard.", icon: SF.doc,
          onClick: () => copyKpub(account.kpub),
        },
        {
          label: "Show kpub QR", subtitle: "Scan it into another device to watch this account there.", icon: SF.qrcode,
          onClick: () => showKpubQr({ account, onBack: () => showColdStorage() }),
        },
        {
          label: "Rename", subtitle: "Changes the name shown for this account.", icon: SF.pencil,
          onClick: () => fieldSheet({
            title: "Rename Account",
            placeholder: "Name",
            value: account.label,
            confirmLabel: "Save",
            onCancel: () => accountActions(account),
            onConfirm: async (name) => { await updateAccount(account.id, (a) => { a.label = name; }); refresh(); },
          }),
        },
        // K iOS ColdStorageView: the bell's receipts, per account
        account.notifyOnReceive === false
          ? {
            label: "Turn On Receive Notifications", subtitle: "Notifies you when this account receives Kaspa.", icon: BELL,
            onClick: async () => { await updateAccount(account.id, (a) => { a.notifyOnReceive = true; }); refresh(); },
          }
          : {
            label: "Turn Off Receive Notifications", subtitle: "Stops notifying when this account receives Kaspa. Other accounts keep theirs.", icon: BELL_SLASH,
            onClick: async () => { await updateAccount(account.id, (a) => { a.notifyOnReceive = false; }); refresh(); },
          },
      ],
    });
  }
}

/** A kpub reveals every address of the account: copied like a secret, cleared 30 s later (K iOS
 *  ColdStorageClipboard.copyKpub). */
function copyKpub(kpub) {
  // nothing on screen to select instead (K iOS b0f0a4e6 took the kpub text away)
  return copySecret(kpub, "kpub copied to clipboard. Clipboard will clear in 30s.", "Couldn't copy the kpub. Try again, or scan it from Show kpub QR.");
}

// iOS ColdStorageKpubQRView: a white page, the kpub's QR (error correction L) in the accent
// frame, what showing it means, "Tap anywhere to copy". No kpub text (K iOS b0f0a4e6): only the
// QR, for scanning.
/** A Cold Storage address's receive screen (KaPay iOS e188209): Kaspa only - Cold Storage can't
 *  move kUSDT - and its key is on the KasSigner. */
function coldReceive({ label, address, onBack }) {
  showQr({
    heading: "Receive Kaspa", label, address, backLabel: "Close", onBack,
    privacy: RECEIVE_NOTES.coldStorage,
    notes: [RECEIVE_NOTES.kaspaOnly, RECEIVE_NOTES.noKusdtCold],
  });
}

async function showKpubQr({ account, onBack }) {
  render(`
    <header class="navbar qr-bar">
      <button class="nav-back" id="back" aria-label="Close">${ICONS.back}<span>Close</span></button>
      <div class="nav-title cold-nav-title">${esc(account.label)}</div>
    </header>
    <section class="qr-page cold-kpub-page" id="qr-page" title="Tap anywhere to copy">
      <div class="qr-frame cold-kpub-frame"><canvas id="qr" width="520" height="520" aria-label="QR code for the kpub"></canvas></div>
      <p class="cold-kpub-note">Watch-only. This cannot spend, but it reveals every address in this account.</p>
      <p class="qr-hint">Tap anywhere to copy</p>
    </section>`, "qr");
  $("#back").onclick = onBack;
  $("#qr-page").onclick = () => copyKpub(account.kpub);
  try {
    await QRCode.toCanvas($("#qr"), account.kpub, { errorCorrectionLevel: "L", margin: 1, width: 520, color: { dark: "#000000", light: "#ffffff" } });
  } catch { /* a tap still copies it */ }
}

// =============================================================================================
// SCREEN 2 - one account
// =============================================================================================

function showAccount({ accountId, onBack }) {
  const state = {
    account: store.accounts.find((a) => a.id === accountId) || null,
    entries: null,
    loading: true,
    busy: null,         // "generate"
    discovery: null,    // { checkingIndex, foundCount }
    summary: "",
    loadToken: 0,
    spent: new Set(),   // quantum addresses whose key a spend has put on chain (the slashed shield)
  };
  let actionsSheet = null;
  const here = () => app.dataset.screen === "cold:account" && app.dataset.coldAccount === accountId;
  const repaintIfHere = () => { if (here()) paint(); };
  const back = () => { paint(); load(); };

  // Funded first, newest first; the quantum addresses added by scan after the derived ones in each
  // group, in the order added (K iOS 961fc05a).
  const visibleEntries = () => {
    const rows = (state.entries || []).filter((e) => !e.hidden)
      .sort((a, b) => (Number(b.balanceSompi > 0n) - Number(a.balanceSompi > 0n))
        || (Number(Boolean(a.quantum)) - Number(Boolean(b.quantum)))
        || (a.quantum ? a.index - b.index : b.index - a.index));
    const active = rows.filter((e) => e.balanceSompi > 0n || domainOwners.get(e.address));
    const fresh = rows.filter((e) => !(e.balanceSompi > 0n || domainOwners.get(e.address)));
    return [...active, ...fresh];
  };

  async function load() {
    const token = ++state.loadToken;
    const account = await getAccount(accountId);
    if (token !== state.loadToken) return;
    if (!account) { if (here()) onBack(); return; }
    state.account = account;
    if (!state.entries) state.loading = true;
    repaintIfHere();
    let entries;
    try {
      entries = await addressList(account);
    } catch (error) {
      if (token !== state.loadToken) return;
      state.loading = false;
      toast(error.message);
      repaintIfHere();
      return;
    }
    if (token !== state.loadToken) return;
    state.entries = entries;
    state.loading = false;
    repaintIfHere();
    fillSpent(token);
    await fillUsed(token);
    await fillDomains(token);
  }

  // Which quantum addresses have spent, putting their key on chain: what is marked, then asked one
  // at a time behind the list (K-Desktop 9c30208).
  async function fillSpent(token) {
    const quantum = state.entries.filter((e) => e.quantum).map((e) => e.address);
    if (!quantum.length) { state.spent = new Set(); return; }
    state.spent = await knownSpentQuantum(quantum);
    if (token !== state.loadToken) return;
    repaintIfHere();
    for (const address of quantum) {
      if (state.spent.has(address)) continue;
      const spent = await coldQuantumSpentState(address);
      if (token !== state.loadToken) return;
      if (spent === true) { state.spent.add(address); repaintIfHere(); }
    }
  }

  // Used / Unused for the zero-balance rows on the list: what is known, then one bulk
  // /addresses/active for a long list, else the transactions-count probe four at a time.
  async function fillUsed(token) {
    const pending = [];
    for (const entry of state.entries.filter((e) => !e.hidden && e.balanceSompi === 0n)) {
      const known = usedState.get(entry.address);
      if (known === true || known === false) continue;
      const remembered = await wallet.knownUsedState(entry.address);
      if (remembered != null) usedState.set(entry.address, remembered); else pending.push(entry);
    }
    if (token !== state.loadToken) return;
    repaintIfHere();
    if (pending.length > 8) {
      const active = await wallet.addressesActive(pending.map((e) => e.address)).catch(() => null);
      if (token !== state.loadToken) return;
      if (active) {
        for (const entry of pending) usedState.set(entry.address, Boolean(active[entry.address]));
        repaintIfHere();
        return;
      }
    }
    const queue = [...pending];
    const worker = async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const used = await wallet.addressUsed(entry.address);
        if (token !== state.loadToken) return;
        usedState.set(entry.address, used == null ? "unknown" : used);
        repaintIfHere();
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  }

  // "Contains username" tags (.kachat names), after the rows are up (K iOS 518fdc8c).
  async function fillDomains(token) {
    let changed = false;
    try {
      const owners = await kachatRegistry()?.ownersOfNames(state.entries.filter((e) => !e.hidden).map((e) => e.address));
      for (const address of owners || []) {
        if (!domainOwners.get(address)) { domainOwners.set(address, true); changed = true; }
      }
    } catch { /* not tagged */ }
    if (changed && token === state.loadToken) repaintIfHere();
  }

  const usedBadge = (entry) => {
    if (entry.balanceSompi > 0n || usedState.get(entry.address) === true) return '<span class="used-badge used">Used</span>';
    if (usedState.get(entry.address) === false) return '<span class="used-badge unused">Unused</span>';
    return '<span class="used-badge">Checking</span>';
  };

  // --- sheets ---------------------------------------------------------------------------------

  const rowActions = (entry) => showSheet({
    title: displayLabel(entry),
    headerHtml: `<div class="mono tiny muted">${esc(shortAddress(entry.address))}</div>`,
    cancel: false,
    rows: [
      { label: "Rename Address", subtitle: "Gives this address a label of your own.", icon: SF.pencil, onClick: () => renameAddress(entry) },
      { label: "Copy Address", subtitle: "Puts the full address on the clipboard.", icon: SF.doc, onClick: () => copyText(entry.address) },
      { label: "Show QR Code", subtitle: "Full screen, for scanning with another device.", icon: SF.qrcode, onClick: () => coldReceive({ label: displayLabel(entry), address: entry.address, onBack: back }) },
      ...(entry.balanceSompi === 0n ? [{
        label: "Hide Address", subtitle: "Removes it from this list. Re-enable it in Address Visibility.", icon: SF.eyeSlash, tint: "orange",
        onClick: () => hideAddress(entry),
      }] : []),
      // A wrong number (or a change address given as a receive one) makes the unit refuse the
      // request: it can be put right, or cleared to let the unit search. A quantum address added by
      // mistake goes from the account; its coins stay on chain (K iOS 961fc05a).
      ...(entry.quantum ? [
        { label: "Edit Address Number", subtitle: "The number and chain KasSigner shows for this address.", icon: SF.number, onClick: () => editNumber(entry) },
        { label: "Stop Watching", subtitle: "Removes this quantum address from the account. Scan it again to add it back.", icon: SF.minusCircle, danger: true, onClick: () => stopWatching(entry) },
      ] : []),
    ],
  });

  const addQuantum = () => quantumSheet({
    adding: true,
    onSave: async ({ address, unitIndex, chain }) => {
      const error = await addQuantumAddress(accountId, address, unitIndex, chain);
      if (error) return error;
      toast("Quantum-resistant address added.");
      load();
      return null;
    },
  });

  // Edit Address Number: the stored record, by address (the row may be from before an earlier edit)
  const editNumber = (entry) => {
    const record = state.account.quantumAddresses.find((q) => q.address === String(entry.address).toLowerCase());
    if (!record) return;
    quantumSheet({
      adding: false,
      address: record.address,
      unitIndex: record.unitIndex,
      chain: record.chain,
      onSave: async ({ unitIndex, chain }) => {
        await updateAccount(accountId, (a) => {
          const stored = a.quantumAddresses.find((q) => q.address === record.address);
          if (!stored) return;
          stored.unitIndex = unitIndex;
          stored.chain = chain === QUANTUM_CHAIN_CHANGE ? QUANTUM_CHAIN_CHANGE : QUANTUM_CHAIN_RECEIVE;
        });
        load();
        return null;
      },
    });
  };

  // With coins on it, only after saying so: they stay on chain, on the unit.
  const stopWatching = (entry) => {
    const go = async () => {
      await removeQuantumAddress(accountId, entry.address);
      state.entries = (state.entries || []).filter((e) => e.address !== entry.address);
      paint();
      load();
    };
    if (!(entry.balanceSompi > 0n)) { go(); return; }
    showAlert({
      title: "Stop Watching This Address?",
      message: `Its ${groupedKas8(entry.balanceSompi)} KAS stay on chain at this address, on your KasSigner; K only stops showing them. Scan the address again from KasSigner to watch it again.`,
      confirmLabel: "Stop Watching",
      cancelLabel: "Cancel",
      onConfirm: go,
    });
    document.querySelector(".alert-button.strong")?.classList.add("cold-destructive");
  };

  const renameAddress = (entry) => showAlert({
    title: "Rename Address",
    field: { placeholder: "Label", value: entry.label || "" },
    confirmLabel: "Save",
    cancelLabel: "Cancel",
    onConfirm: async (value) => {
      const clean = String(value || "").trim();
      await updateAccount(accountId, (a) => {
        // a quantum row files under its index now (K-Desktop currentIndexOf)
        const at = currentIndexOf(a, entry);
        if (at == null) return;
        if (clean) a.labels[at] = clean; else delete a.labels[at];
      });
      load();
    },
  });

  const hideAddress = async (entry) => {
    const at = currentIndexOf(state.account, entry);
    const ok = at != null && await setHidden(state.account, at, true);
    if (!ok) { toast("This address can't be hidden."); return; }
    entry.hidden = true;
    paint();
    toast("Address hidden. Re-enable it in Address Visibility.");
    load();
  };

  const actionRows = () => {
    const discovering = Boolean(state.discovery);
    return [
      { label: "Generate More Addresses", subtitle: "Reveals the next unused address in this account.", icon: SF.plusCircle, busy: state.busy === "generate", disabled: discovering, onClick: generate },
      // KasSigner never exports its quantum (22') kpub - it would show every key those addresses
      // hide - so each is scanned from the unit, one at a time (K iOS 961fc05a)
      { label: "Add Quantum-Resistant Address", subtitle: "Scan a KCC-3 address from KasSigner's address screen.", icon: SF.shield, disabled: discovering, onClick: addQuantum },
      { label: "Discover Addresses", subtitle: "Finds addresses holding a balance or a username.", icon: SF.magnifier, disabled: discovering, keepOpen: true, onClick: discover },
      { label: "Address Visibility", subtitle: "Check off every address you want on the list, in one sitting.", icon: SF.checklist, disabled: discovering, onClick: () => showVisibility({ accountId, onDone: back }) },
      // the kpub is never on screen (K iOS b0f0a4e6): it reveals every address, so it is only copied
      { label: "Copy kpub", subtitle: "Puts this account's kpub on the clipboard. It reveals all its addresses.", icon: SF.doc, disabled: discovering, onClick: () => copyKpub(state.account.kpub) },
    ];
  };

  const discoveryHtml = () => {
    const d = state.discovery;
    if (!d) return state.summary ? `<p class="muted small strong sheet-summary center-text">${esc(state.summary)}</p>` : "";
    return `
      <div class="discovery">
        <span class="spinner"></span>
        <div class="strong">Checking address #${d.checkingIndex}</div>
        <div class="muted small">${d.foundCount ? `${d.foundCount} found so far` : "No used addresses yet"}</div>
        <div class="muted tiny">Checks the first thousand addresses whatever the gaps, then keeps going while it keeps finding.</div>
        <button class="sheet-row center-text cold-keep-scanning" id="keep-scanning"><span class="sheet-label accent">Close and Keep Scanning</span></button>
      </div>`;
  };

  const openActions = () => {
    state.summary = "";
    actionsSheet = showSheet({ title: "Address Actions", cancel: false, rows: state.discovery ? [] : actionRows(), footerHtml: discoveryHtml() });
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

  async function generate() {
    if (state.busy) return;
    state.busy = "generate";
    repaintIfHere();
    try {
      const index = await generateAddress(accountId);
      await load();
      toast(`Address #${index} is ready.`);
    } catch (error) {
      toast(error.message);
    }
    state.busy = null;
    repaintIfHere();
  }

  async function discover() {
    if (state.discovery) return;
    state.discovery = { checkingIndex: 0, foundCount: 0 };
    state.summary = "";
    refreshActions();
    repaintIfHere();
    let message;
    try {
      const found = await discoverAddresses(accountId, (progress) => { state.discovery = progress; refreshActions(); });
      message = !found ? "No addresses with a balance or username found." : found === 1 ? "Found 1 address with a balance or username." : `Found ${found} addresses with a balance or username.`;
    } catch (error) {
      message = error.message;
    }
    await load();
    state.discovery = null;
    // Sheet still open: the result shows in it. Closed: it arrives as a toast.
    if (actionsSheet?.isOpen()) { state.summary = message; refreshActions(); } else toast(message);
    repaintIfHere();
  }

  const renameAccount = () => fieldSheet({
    title: "Rename Account",
    subtitle: state.account.label,
    placeholder: "Name",
    value: state.account.label,
    confirmLabel: "Save",
    onConfirm: async (name) => {
      const account = await updateAccount(accountId, (a) => { a.label = name; });
      if (account) state.account = account;
      repaintIfHere();
    },
  });

  const removeAccount = () => {
    showAlert({
      title: "Remove Cold Storage Account",
      message: "This only removes it from K's watch list. It has no effect on the KasSigner device or any funds it holds.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      onConfirm: async () => {
        const accounts = await loadAccounts();
        await saveAccounts(accounts.filter((a) => a.id !== accountId), store.key);
        // its coin labels go with it, unless another list still watches that KasSigner key (KaPay
        // iOS 5848fb0)
        const removed = accounts.filter((a) => a.id === accountId);
        await wallet.coldUtxoLabelKeys(removed).then((keys) => keys.length && removeLocal(keys)).catch(() => {});
        // a quantum address's coin labels go with the last account watching it (K iOS 961fc05a)
        const kept = new Set(accounts.filter((a) => a.id !== accountId).flatMap((a) => a.quantumAddresses.map((q) => q.address)));
        const orphaned = removed.flatMap((a) => a.quantumAddresses.map((q) => q.address)).filter((q) => !kept.has(q));
        if (orphaned.length) await removeLocal(wallet.utxoLabelKeysFor(orphaned)).catch(() => {});
        onBack();
      },
    });
    document.querySelector(".alert-button.strong")?.classList.add("cold-destructive");
  };

  // --- paint ------------------------------------------------------------------------------------

  function paint() {
    const account = state.account;
    if (!account) {
      render(`${navHeader({})}<div class="manage-scroll"><div class="center-text pad"><span class="spinner"></span></div></div>`, "cold:account");
      app.dataset.coldAccount = accountId;
      $("#back").onclick = onBack;
      return;
    }
    const rows = visibleEntries();
    const shown = (state.entries || []).filter((e) => !e.hidden);
    // a balance that couldn't be read leaves no total to show (a dash, never a short one)
    const unread = shown.some((e) => e.balanceSompi == null);
    const total = unread ? null : shown.reduce((sum, e) => sum + e.balanceSompi, 0n);
    const busy = Boolean(state.discovery) || state.busy === "generate";
    const scroll = app.querySelector(".manage-scroll")?.scrollTop || 0;
    render(`
      <header class="navbar">
        <button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button>
        <div class="nav-title cold-nav-title">${esc(account.label)}</div>
        <div class="nav-right"><button class="icon plain cold-trash" id="remove" aria-label="Remove Cold Storage Account">${SF.trash}</button></div>
      </header>
      <div class="manage-scroll cold-detail">
        <div class="cold-summary">
          <div class="cold-summary-name">
            <div class="tx-meta"><span class="muted cold-caption">Name</span><span class="strong cold-name">${esc(account.label)}</span></div>
            <button class="icon plain accent cold-pencil" id="rename-account" aria-label="Rename Account">${SF.pencilSmall}</button>
          </div>
        </div>
        ${balanceCardHtml({ label: "Total Balance", sompi: state.entries ? total : null, unknown: Boolean(state.entries) && Boolean(unread), fiatText: state.entries && !unread ? fiatTextFor(total, repaintIfHere) : "" })}
        ${state.loading && !state.entries ? '<div class="center-text cold-loading"><span class="spinner"></span></div>'
          : !rows.length ? '<p class="muted cold-none">No addresses discovered yet.</p>'
          : rows.map((entry) => `
            <div class="glass address-card cold-address" data-open="${entry.index}" role="button" tabindex="0">
              <div class="address-card-main">
                <span class="accent cold-row-label">${esc(displayLabel(entry))}${quantumShieldHtml({ quantum: entry.quantum, spent: state.spent.has(entry.address), balanceSompi: entry.balanceSompi ?? 0n })}</span>
                <span class="mono cold-row-address">${esc(shortAddress(entry.address))}</span>
                ${entry.balanceSompi == null
                  ? '<span class="muted small cold-row-amount">Couldn\'t load the coins at this address</span>'
                  : `<span class="strong cold-row-amount">${esc(groupedKas8(entry.balanceSompi))} KAS</span>`}
                <span class="address-status">${usedBadge(entry)}${domainOwners.get(entry.address) ? '<span class="domain-tag">Contains username</span>' : ""}</span>
              </div>
              <button class="icon plain card-menu" data-menu="${entry.index}" aria-label="Address actions">${SF.ellipsisV}</button>
            </div>`).join("")}
        <div class="fab-room"></div>
      </div>
      ${addressActionsFabHtml(busy)}`, "cold:account");
    app.dataset.coldAccount = accountId;
    dock.remember(() => paint());
    const scroller = app.querySelector(".manage-scroll");
    if (scroller) scroller.scrollTop = scroll;
    $("#back").onclick = onBack;
    $("#remove").onclick = removeAccount;
    $("#rename-account").onclick = renameAccount;
    $("#address-actions").onclick = openActions;
    const byIndex = (index) => state.entries.find((e) => e.index === Number(index));
    for (const card of app.querySelectorAll("[data-open]")) {
      card.onclick = (event) => {
        if (event.target.closest("[data-menu]")) return;
        showAddress({ accountId, entry: byIndex(card.dataset.open), account: state.account, entries: state.entries, onBack: back });
      };
      card.onkeydown = (event) => { if (event.key === "Enter") card.click(); };
    }
    for (const button of app.querySelectorAll("[data-menu]")) button.onclick = () => rowActions(byIndex(button.dataset.menu));
  }

  paint();
  load();
}

// =============================================================================================
// SCREEN 3 - Address Visibility (an iOS sheet: no dock)
// =============================================================================================

function showVisibility({ accountId, onDone }) {
  const PAGE = 50;
  const state = { page: 0, account: null, entries: null, pageRows: null, used: new Map(), token: 0 };
  const here = () => app.dataset.screen === "cold-visibility";

  const loadEntries = async () => {
    state.account = await getAccount(accountId);
    if (!state.account) return onDone();
    state.entries = await addressList(state.account);
  };

  // The rows of this page: the loaded ones, and past the end freshly derived (hidden, no balance).
  const loadPage = async () => {
    const token = ++state.token;
    state.pageRows = null;
    paint();
    try {
      if (!state.entries) await loadEntries();
      const start = state.page * PAGE;
      const byIndex = new Map(state.entries.map((e) => [e.index, e]));
      const missing = byIndex.has(start + PAGE - 1) ? [] : await wallet.kpubAddresses(state.account.kpub, start, start + PAGE);
      if (token !== state.token) return;
      state.pageRows = Array.from({ length: PAGE }, (_, i) => byIndex.get(start + i)
        || { index: start + i, address: missing[i], balanceSompi: 0n, label: labelOf(state.account, start + i), hidden: true, derivedOnly: true })
        .filter((row) => row.address);
    } catch {
      if (token === state.token) state.pageRows = [];
    }
    if (token !== state.token) return;
    paint();
    // Used / Unused for this page's zero-balance rows, lazily; a failed probe keeps "…".
    const queue = [...quantumRows(), ...state.pageRows].filter((r) => r.balanceSompi === 0n && !state.used.has(r.address));
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const used = await probeUsed(row.address);
        if (used != null) state.used.set(row.address, used);
        if (token === state.token && here()) paint();
      }
    };
    Promise.all(Array.from({ length: 6 }, worker));
  };

  const toggle = async (row) => {
    if (row.balanceSompi > 0n) return; // funded rows don't toggle
    // the kpub's chain only: the quantum entries sit far above it
    const derivedMax = state.entries.filter((e) => !e.quantum).reduce((max, e) => Math.max(max, e.index), -1);
    if (row.index > derivedMax) {
      await revealAddress(state.account, row.index);
      await loadEntries();
    } else {
      const ok = await setHidden(state.account, row.index, !row.hidden);
      if (!ok) return;
      row.hidden = !row.hidden;
      state.account = await getAccount(accountId);
    }
    const byIndex = new Map(state.entries.map((e) => [e.index, e]));
    state.pageRows = state.pageRows.map((r) => byIndex.get(r.index) || r);
    if (here()) paint();
  };

  const trailing = (row) => {
    if (row.balanceSompi > 0n) return `<span class="accent tiny strong">${esc((Number(row.balanceSompi) / 1e8).toFixed(4))} KAS</span>`;
    const used = state.used.get(row.address);
    if (used === true) return '<span class="used-badge used tiny">Used</span>';
    if (used === false) return '<span class="muted tiny strong">Unused</span>';
    return '<span class="muted tiny">…</span>';
  };

  // The account's quantum addresses, their own section on the first page, apart from the kpub's
  // pager (K iOS 961fc05a ColdStorageAddressVisibilityView). A hide files under the row's index now.
  const toggleQuantum = async (row) => {
    if (row.balanceSompi > 0n) return;
    const at = currentIndexOf(state.account, row);
    if (at == null) return;
    const ok = await setHidden(state.account, at, !row.hidden);
    if (!ok) return;
    state.account = await getAccount(accountId);
    state.entries = await addressList(state.account);
    if (here()) paint();
  };
  const quantumRows = () => (state.page === 0 ? (state.entries || []).filter((e) => e.quantum) : []);
  const visRowHtml = (row, attr, headHtml) => {
    const visible = !row.hidden;
    const funded = row.balanceSompi > 0n;
    return `
      <button class="vis-row ${funded ? "locked" : ""}" ${attr} ${funded ? 'aria-disabled="true"' : ""}>
        <span class="${visible ? "accent" : "muted"}">${visible ? ICONS.circleCheck : ICONS.circle}</span>
        <span class="tx-meta">
          <span class="cold-vis-head">${headHtml}${row.label ? `<span class="muted tiny ellipsis">${esc(row.label)}</span>` : ""}</span>
          <span class="mono tiny muted">${esc(`${row.address.slice(0, 16)}…${row.address.slice(-6)}`)}</span>
        </span>
        ${trailing(row)}
      </button>`;
  };

  function paint() {
    const start = state.page * PAGE;
    const quantum = quantumRows();
    render(`
      <header class="navbar form-bar">
        <span></span>
        <div class="nav-title">Address Visibility</div>
        <button class="bar-text strong" id="done">Done</button>
      </header>
      <div class="manage-scroll flush" id="vis-scroll">
        ${!state.pageRows ? '<div class="center-text pad"><span class="spinner"></span></div>'
          : !state.pageRows.length ? '<p class="muted center-text pad">These addresses couldn\'t be derived right now. Go back a page or reopen this screen to retry.</p>'
          : `${quantum.length ? `<p class="cold-vis-section">Quantum-Resistant Addresses</p>
              <div class="plain-list">${quantum.map((row) => visRowHtml(row, `data-vis-q="${esc(row.address)}"`,
                `${quantumShieldHtml({ quantum: true, spent: false, balanceSompi: 0n })}<span class="strong small">${esc(row.defaultLabel)}</span>`)).join("")}</div>
              <p class="cold-vis-section">Addresses</p>` : ""}
            <div class="plain-list">${state.pageRows.map((row) => visRowHtml(row, `data-vis="${row.index}"`,
              `<span class="strong small mono-digits">#${row.index}</span>`)).join("")}</div>`}
      </div>
      <div class="pager">
        <button class="icon plain accent" id="prev" ${state.page === 0 ? "disabled" : ""} aria-label="Previous page">${SF.chevronLeft}</button>
        <span class="strong small mono-digits">#${start} - #${start + PAGE - 1}</span>
        <button class="icon plain accent" id="next" aria-label="Next page">${SF.chevronRight}</button>
      </div>`, "cold-visibility");
    $("#done").onclick = onDone;
    $("#prev").onclick = () => { if (state.page > 0) { state.page -= 1; loadPage(); } };
    $("#next").onclick = () => { state.page += 1; loadPage(); };
    for (const button of app.querySelectorAll("[data-vis]")) {
      button.onclick = () => toggle(state.pageRows.find((r) => r.index === Number(button.dataset.vis)));
    }
    for (const button of app.querySelectorAll("[data-vis-q]")) {
      button.onclick = () => toggleQuantum(quantumRows().find((r) => r.address === button.dataset.visQ));
    }
  }

  loadPage();
}

// =============================================================================================
// SCREEN 4 - one address: History | UTXOs | .kachat
// =============================================================================================

function showAddress({ accountId, entry, account = null, entries = null, onBack }) {
  const address = entry.address;
  const title = displayLabel(entry);
  const quantum = Boolean(entry.quantum);
  // this account's addresses: change to another of them (a quantum send's goes to a fresh quantum
  // address) is its own, not Sent (K iOS 961fc05a)
  const ownAddresses = new Set((entries || [entry]).map((e) => String(e.address || "").toLowerCase()));
  // Compound on a quantum address moves its coins to another quantum address of the account (the
  // merge puts its key on chain), so it's offered only when the account has another.
  const canCompound = !quantum || (account?.quantumAddresses?.length || 0) > 1;
  const state = {
    tab: "history",
    history: null, historyLoading: false,
    coins: null, coinsLoading: false, coinsError: "",
    labels: {},
  };
  const here = () => app.dataset.screen === "cold:address" && app.dataset.coldAddress === address;
  const repaintIfHere = () => { if (here()) paint(); };
  const back = () => paint();
  const balance = () => (state.coins ? state.coins.reduce((sum, c) => sum + c.amount, 0n) : entry.balanceSompi);

  const loadHistory = () => {
    state.historyLoading = true;
    repaintIfHere();
    wallet.history(address)
      .then((result) => { state.history = result; })
      .catch(() => { state.history = { txs: [], complete: false }; })
      .finally(() => { state.historyLoading = false; repaintIfHere(); });
  };
  const loadCoins = () => {
    state.coinsLoading = true;
    state.coinsError = "";
    repaintIfHere();
    wallet.utxos(address)
      .then((coins) => { state.coins = coins; balanceCache.set(address, coins.reduce((sum, c) => sum + c.amount, 0n)); })
      .catch((error) => { state.coinsError = String(error?.message || error); })
      .finally(() => { state.coinsLoading = false; repaintIfHere(); });
  };
  const reload = () => { loadHistory(); loadCoins(); };

  // A quantum address's send: its record (its number and chain on the unit) and the account's other
  // quantum addresses, read fresh, for the change (K iOS 961fc05a).
  const openSend = async (compound) => {
    let quantumInfo = null;
    if (quantum) {
      const latest = await getAccount(accountId);
      const record = latest?.quantumAddresses.find((q) => q.address === address.toLowerCase());
      if (!record) { toast("This address is no longer in this account."); return; }
      quantumInfo = { record, records: latest.quantumAddresses, labelOf: (other) => quantumLabelIn(latest, other) };
    }
    showColdSendFor(compound, quantumInfo);
  };
  const showColdSendFor = (compound, quantumInfo) => showColdSend({
    fromAddress: address,
    availableSompi: balance(),
    compound,
    quantum: quantumInfo,
    onClose: () => { paint(); },
    onDone: () => { paint(); reload(); },
  });

  // iOS TransactionActionsSheet.
  const transactionSheet = (tx) => {
    const summary = tx.direction ? `${tx.direction === "out" ? "Sent" : "Received"} ${portfolioKas(tx.amountSompi)}${tx.time ? ` on ${txDate(tx.time)}` : ""}` : "";
    showSheet({
      title: "Transaction",
      headerHtml: `${summary ? `<div class="muted small">${esc(summary)}</div>` : ""}<div class="mono tiny muted">${esc(middle(tx.txid, 16))}</div>`,
      cancel: false,
      rows: [
        {
          label: "Open in Explorer", subtitle: "Opens this transaction on the block explorer.", icon: SF.safari,
          onClick: () => window.open(wallet.explorerTxUrl(tx.txid), "_blank", "noopener"),
        },
        ...(tx.direction ? [{
          label: "Add to Portfolio", subtitle: "Records it as a buy or a sell in a portfolio of your choosing.", icon: SF.pieFill,
          onClick: () => showAddToPortfolio({
            txid: tx.txid, direction: tx.direction, amountSompi: tx.amountSompi, time: tx.time, sourceAddress: address,
            onDone: () => { if (!here()) paint(); },
          }),
        }] : []),
      ],
    });
  };

  // An outgoing row counts change to the account's other addresses as its own: Moved when nothing
  // left the account, else Sent with what went to others (K iOS 961fc05a).
  const rowFigures = (tx) => {
    if (tx.direction !== "out") return { moved: false, amountSompi: tx.amountSompi };
    const own = ownChangeHistoryAmount(tx.flows, address, ownAddresses);
    return own ? { moved: own.moved, amountSompi: own.amountSompi } : { moved: false, amountSompi: tx.amountSompi };
  };

  const historyHtml = () => {
    if (!state.history && state.historyLoading) return '<div class="glass list"><div class="list-row center-row"><span class="spinner small-spin"></span></div></div>';
    const txs = state.history?.txs || [];
    if (!txs.length && state.history && !state.history.complete) {
      return '<div class="glass list"><div class="list-row stack-row cold-left-stack"><span class="muted">Could not load transactions.</span><button class="link-button strong" id="history-retry">Try Again</button></div></div>';
    }
    if (!txs.length) return '<div class="glass list"><div class="list-row muted">No transactions yet.</div></div>';
    return `
      ${state.history && !state.history.complete ? '<p class="cold-partial">Some transactions could not be loaded. Pull to refresh to try again.</p>' : ""}
      <div class="glass list">${txs.map((tx, i) => {
        const { moved, amountSompi } = rowFigures(tx);
        const cls = tx.direction === "out" ? "out" : tx.direction === "in" ? "in" : "none";
        return `
          <button class="list-row ios-tx" data-tx="${i}">
            <span class="ios-tx-icon ${cls}">${tx.direction === "out" ? SF.arrowUpFill : SF.arrowDownFill}</span>
            <span class="tx-meta">
              <span class="ios-tx-title ${cls}">${tx.direction === "out" ? (moved ? "Moved" : "Sent") : tx.direction === "in" ? "Received" : "Transaction"}</span>
              <span class="mono tiny muted">${esc(middle(tx.txid, 6))}</span>
              ${tx.time ? `<span class="tiny muted">${esc(txDate(tx.time))}</span>` : ""}
            </span>
            <span class="ios-tx-right">
              ${tx.direction ? `<span class="ios-tx-amount ${cls}">${moved ? "" : tx.direction === "out" ? "-" : "+"}${esc(groupedKas8(amountSompi))} KAS</span>` : ""}
              ${tx.feeSompi != null ? `<span class="tiny muted">${esc(feeText(tx.feeSompi))}</span>` : ""}
            </span>
            <span class="accent">${SF.upRightSquare}</span>
          </button>`;
      }).join("")}</div>`;
  };

  const utxosHtml = () => {
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
            <button class="icon plain accent" data-rename-utxo="${i}" aria-label="Rename UTXO">${SF.pencilSmall}</button>
          </div>`;
      }).join("");
    }
    const compound = coins && coins.length > 1 && canCompound ? `
      <div class="glass list"><button class="list-row strong accent-row" id="compound">${SF.merge}<span>Compound UTXOs</span></button></div>
      <p class="form-footer cold-compound-footer">${quantum
        ? "Combines all UTXOs at this address into one at an unused quantum-resistant address of this account, since this puts this address's key on chain."
        : "Combines all UTXOs at this address into a single one, to reduce the number of inputs a future send needs."}</p>` : "";
    return `${compound}<div class="glass list">${body}</div>`;
  };

  // This KasSigner address's own .kachat names (iOS 881ada6) - read-only on the detail screen.
  let kachatTab = null;
  // the Usernames page: the .kachat names this address holds (K iOS 518fdc8c)
  const kachatHtml = () => {
    kachatTab = addressDomainsTab({ address, repaint: repaintIfHere });
    return kachatTab.html;
  };

  function paint() {
    const total = balance();
    // its coins couldn't be read: no balance and no Send (KaPay iOS 0799cec)
    const unreadable = total == null && Boolean(state.coinsError) && !state.coinsLoading;
    const scroll = app.querySelector(".manage-scroll")?.scrollTop || 0;
    render(`
      <header class="navbar">
        <button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button>
        <div class="nav-title cold-nav-title">${esc(title)}</div>
        ${addressOptionsButtonHtml()}
      </header>
      ${unreadable ? unreadableBalanceHtml("cold-address-balance") : balanceCardHtml({ label: title, sompi: total, fiatText: fiatTextFor(total, repaintIfHere) })}
      ${pageCycleHtml([["history", "History"], ["utxos", "UTXOs"], ["domains", "Usernames"]], state.tab, { className: "cold-tabs" })}
      <div class="manage-scroll cold-address-scroll">
        ${state.tab === "history" ? historyHtml() : state.tab === "utxos" ? utxosHtml() : kachatHtml()}
      </div>
      <div class="ios-bottom-bar">
        <button class="ios-capsule with-icon" id="receive">${SF.qrcodeSmall}<span>Receive</span></button>
        <button class="ios-capsule with-icon cold-bold" id="send" ${total == null || total === 0n ? "disabled" : ""}>${SF.sendFill}<span>Send</span></button>
      </div>`, "cold:address");
    if (state.tab === "domains") kachatTab?.bind(app, back);
    app.dataset.coldAddress = address;
    dock.remember(() => paint());
    const scroller = app.querySelector(".manage-scroll");
    if (scroller) scroller.scrollTop = scroll;
    $("#back").onclick = onBack;
    for (const tab of app.querySelectorAll("[data-tab]")) tab.onclick = () => { if (state.tab !== tab.dataset.tab) { state.tab = tab.dataset.tab; app.querySelector(".manage-scroll").scrollTop = 0; paint(); } };
    // no View Private Key: a cold address's key stays on the signer (KaPay iOS 2da5f4b); and none
    // for a quantum address either: it's a script hash, its key is on the unit until it spends
    $("#address-options").onclick = () => showAddressActions({
      address,
      onViewPublicKey: quantum ? null : () => showPublicKey({ address, value: xOnlyKeyFromAddress(address), onBack: back }),
    });
    $("#receive").onclick = () => coldReceive({ label: title, address, onBack: back });
    $("#send").onclick = () => openSend(false);
    for (const row of app.querySelectorAll("[data-tx]")) {
      // the sheet's summary and Add to Portfolio use the row's own figure
      row.onclick = () => {
        const tx = state.history.txs[Number(row.dataset.tx)];
        transactionSheet({ ...tx, amountSompi: rowFigures(tx).amountSompi });
      };
    }
    const historyRetry = $("#history-retry");
    if (historyRetry) historyRetry.onclick = loadHistory;
    const coinsRetry = $("#coins-retry");
    if (coinsRetry) coinsRetry.onclick = loadCoins;
    const balanceRetry = $("#balance-retry");
    if (balanceRetry) balanceRetry.onclick = loadCoins;
    const compound = $("#compound");
    if (compound) compound.onclick = () => openSend(true);
    for (const button of app.querySelectorAll("[data-rename-utxo]")) {
      const coin = state.coins[Number(button.dataset.renameUtxo)];
      button.onclick = () => fieldSheet({
        title: "Rename UTXO",
        subtitle: coin.key,
        placeholder: "Name",
        value: state.labels?.[coin.key] || "",
        confirmLabel: "Save",
        allowEmpty: true,
        onConfirm: async (value) => { state.labels = await wallet.setUtxoLabel(address, coin.key, value); repaintIfHere(); },
      });
    }
  }

  paint();
  wallet.utxoLabels(address).then((labels) => { state.labels = labels; repaintIfHere(); });
  reload();
}
