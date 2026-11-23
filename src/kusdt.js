// kUSDT's state for the extension (K-Desktop ui/kusdt-wallet.js, synced into shared/ui): this file
// hands it what only the extension knows - the active account, its regular spending addresses and
// their keys, the node, Trestly's API URL and the bell - as K-Desktop's app.js initKusdt does.
//
// Where kUSDT lives (owner's call, 2026-11-19): the Chatting Address and the regular spending
// addresses. Never a quantum-resistant one.
//
// The wallet state reads addresses synchronously (spendingAddressAt), so they are derived ahead
// into `ctx.addresses`: every regular slot up to the last revealed one plus Discover's 20 past it,
// filled again whenever the account or its list changes (syncKusdtAccount). Storage is the popup's
// localStorage: kUSDT runs in the popup (or the wallet's own tab) only, never in the background,
// which has no localStorage and no Worker for the WASM builder.
//
// Keys: the Chatting Address's or a regular spending address's, derived for one build and dropped
// (secretKeyFor). Kaspa sends no longer ask for the password (KaPay iOS 5848fb0), and neither do
// kUSDT sends (K-Desktop and K iOS: plain sends need none).

import * as wallet from "./wallet.js";
import * as vault from "./vault.js";
import * as bell from "./bell.js";
import { NETWORK } from "./net.js";
import { getEndpoint } from "../shared/engine/endpoints.js";
import { isQuantumIndex, QUANTUM_INDEX_BASE } from "../shared/engine/quantum.js";
import { createKusdtWallet, KUSDT_DISCOVER_PAST, isRegularIndex } from "../shared/ui/kusdt-wallet.js";
import { formatKusdt } from "../shared/engine/kusdt.js";
import { logInfo } from "./log.js";

/** The account kUSDT is shown for, as last synced. */
const ctx = {
  accountId: null,
  main: "",
  state: null,
  addresses: new Map(), // regular index -> address
  imported: false,
};

let instance = null;
let engineObject = null;
let syncing = null;

function engine() {
  if (!engineObject) {
    // the node side the .kachat names already use (getUtxosWithCovenants, submitRpcTransaction);
    // `kaspa` is set before anything is built (ensureEngine), `address` before a submit (the coins
    // it spends are held at that address, as a send's are)
    engineObject = { ...wallet.namesNodeMethods(), kaspa: null, address: "" };
  }
  return engineObject;
}

/** The SDK on the engine object: submitPrepared reads `engine.kaspa` synchronously. */
export async function ensureEngine() {
  const e = engine();
  if (!e.kaspa) e.kaspa = await wallet.kaspa();
  return e;
}

/** The address the next submit spends from (its coins are held there afterwards). */
export function setSubmitAddress(address) {
  engine().address = String(address || "");
}

/** A transaction's inputs, resolved by the REST API (findReceived's own-transfer check). */
async function transactionInputs(txid) {
  const base = wallet.restApiUrl().replace(/\/+$/, "");
  const response = await fetch(`${base}/transactions/${encodeURIComponent(txid)}?resolve_previous_outpoints=light`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const tx = await response.json();
  if (!Array.isArray(tx?.inputs)) return null;
  return tx.inputs.map((input) => ({
    hash: input?.previous_outpoint_hash ?? input?.previousOutpoint?.transactionId ?? null,
    index: input?.previous_outpoint_index ?? input?.previousOutpoint?.index ?? null,
    address: input?.previous_outpoint_address || input?.previous_outpoint_resolved?.script_public_key_address || null,
  }));
}

/** Regular addresses `start`..`end - 1` of the synced account, from the cache or derived. */
async function regularAddressesInRange(start, end) {
  const accountId = ctx.accountId;
  const from = Math.max(0, start);
  const to = Math.min(end, QUANTUM_INDEX_BASE);
  const out = new Map();
  if (!accountId || to <= from) return out;
  const missing = [];
  for (let i = from; i < to; i += 1) {
    if (ctx.addresses.has(i)) out.set(i, ctx.addresses.get(i));
    else missing.push(i);
  }
  if (missing.length) {
    const lo = Math.min(...missing);
    const hi = Math.max(...missing);
    const derived = await wallet.spendingAddressRange(lo, hi - lo + 1);
    // the account derived for must still be the one shown
    if (ctx.accountId !== accountId) return new Map();
    for (const [key, address] of Object.entries(derived)) {
      const i = Number(key);
      if (!address || !isRegularIndex(i)) continue;
      ctx.addresses.set(i, address);
      if (i >= from && i < to) out.set(i, address);
    }
  }
  return out;
}

/** The kUSDT state (one per popup). */
export function kusdt() {
  if (instance) return instance;
  instance = createKusdtWallet({
    account: () => ctx.main,
    network: NETWORK,
    storage: globalThis.localStorage,
    engine: engine(),
    apiBase: () => getEndpoint("trestlyApi"),
    fetchImpl: (url, init) => fetch(url, init),
    maxSpendingIndex: () => (ctx.state ? ctx.state.maxIndex : -1),
    spendingAddressAt: (index) => (isRegularIndex(index) ? ctx.addresses.get(index) || null : null),
    spendingAddressesInRange: regularAddressesInRange,
    revealSpendingSlot: (index, owner) => revealSlot(index, owner),
    spendingLabel: (index) => (ctx.state ? wallet.labelFor(ctx.state, index) : null),
    ownAddresses: () => [ctx.main, ...revealedRegular().map((i) => ctx.addresses.get(i))].filter(Boolean),
    fetchTransactionInputs: transactionInputs,
    // the bell holds Kaspa arriving and .kachat news; "Received X kUSDT" goes there too
    notificationsEnabled: () => true,
    notify: ({ title, body }) => {
      const stamp = Date.now();
      bell.record({ id: `kusdt-${stamp}`, source: "wallet", title, body, timestamp: stamp, targetId: "kusdt", account: ctx.main });
    },
    // a kUSDT send's KAS change goes back to an address that paid into it: the bell's own-input
    // check already leaves it out
    markOwnTransaction: () => {},
    // no chats here: no Send Dollars notice to wait for
    isNoticeFiled: () => false,
    isVisible: () => document.visibilityState === "visible",
    log: (line) => logInfo(line),
  });
  return instance;
}

function revealedRegular() {
  const state = ctx.state;
  if (!state) return [];
  const out = [];
  for (let i = 0; i <= state.maxIndex; i += 1) out.push(i);
  return out;
}

/** Puts a regular slot on Manage Addresses' list (Discover's furthest find, Generate New Address,
 *  a fresh receive address once handed out): the chain's end raised to it with the slots between
 *  hidden, the slot itself shown. Nothing is written once another account is active. */
async function revealSlot(index, owner = ctx.main) {
  if (!isRegularIndex(index) || !owner || owner !== ctx.main) return;
  const accountId = ctx.accountId;
  await wallet.revealSpendingAddress(index);
  if (ctx.accountId !== accountId) return;
  ctx.state = await wallet.spendingState(accountId);
}

/**
 * Brings kUSDT to the active account: its chatting address, Manage Addresses' bookkeeping and the
 * regular addresses the wallet state reads. Called as the Wallet tab paints and after anything
 * that changes the address list. Resolves true when the account changed.
 */
export async function syncKusdtAccount() {
  if (syncing) return syncing;
  syncing = (async () => {
    const view = await vault.readAccounts();
    const accountId = view.activeAccountId;
    const account = view.accounts?.find?.((a) => a.id === accountId) || null;
    const main = (await wallet.cachedAddresses(accountId))?.main || "";
    const switched = accountId !== ctx.accountId || main !== ctx.main;
    if (switched) {
      ctx.accountId = accountId;
      ctx.main = main;
      ctx.addresses = new Map();
      ctx.state = null;
    }
    ctx.imported = Boolean(account?.imported);
    ctx.state = await wallet.spendingState(accountId);
    // what's cached already (no derivation), then the rest up to Discover's reach
    const cached = (await wallet.cachedAddresses(accountId))?.spending || {};
    for (const [key, address] of Object.entries(cached)) {
      const i = Number(key);
      if (address && isRegularIndex(i)) ctx.addresses.set(i, address);
    }
    if (main) await regularAddressesInRange(0, ctx.state.maxIndex + KUSDT_DISCOVER_PAST + 2);
    return switched;
  })().finally(() => { syncing = null; });
  return syncing;
}

/** Regular addresses `start`..`end - 1` of the shown account (kUSDT Address Visibility). */
export function kusdtAddressesInRange(start, end) {
  return regularAddressesInRange(start, end);
}

/** A fresh receive address handed out goes on Manage Addresses' list (iOS revealIfFresh). */
export function revealKusdtSlot(index, owner) {
  return revealSlot(index, owner);
}

/** The label given to a regular spending address, or "" (Rename Address's field). */
export function kusdtCustomLabel(index) {
  return ctx.state ? wallet.customLabel(ctx.state, index) || "" : "";
}

/** The synced account's chatting address ("" before the first sync). */
export function kusdtAccount() { return ctx.main; }

/**
 * A holding's key for one build (K-Desktop secretKeyFor): the Chatting Address's, or a regular
 * spending address's - checked against the holding's address. Null for a quantum-resistant one
 * (they don't hold kUSDT) or when the account changed.
 */
export async function secretKeyFor(holding) {
  if (!holding) return null;
  const accountId = ctx.accountId;
  try {
    if (holding.spendingIndex == null) {
      const key = await wallet.privateKeyHex({ kind: "main" });
      return ctx.accountId === accountId ? String(key || "").trim() || null : null;
    }
    if (isQuantumIndex(holding.spendingIndex)) return null;
    const key = await wallet.privateKeyHex({ kind: "spending", index: holding.spendingIndex }, { fromAddress: holding.address });
    return ctx.accountId === accountId ? String(key || "").trim() || null : null;
  } catch {
    return null;
  }
}

/** Regular indices Manage kUSDT lists (Manage Addresses keeps them: §11). */
export function kusdtListedIndices() {
  if (!instance || !ctx.main) return new Set();
  try { return new Set(instance.listedSpendingIndices()); } catch { return new Set(); }
}

/** "125.50 kUSDT" or "--" before it is known. */
export function kusdtTotalText() {
  const units = instance?.balance?.();
  return units == null ? "--" : formatKusdt(units);
}

/** The account is being removed from this device: its kUSDT records go too. */
export function forgetKusdtAccount(main) {
  try { kusdt().forgetAccount(main); } catch { /* nothing kept */ }
}
