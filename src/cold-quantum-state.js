// Cold Storage's KasSigner quantum-resistant (KCC-3) addresses: what is known for good about each
// one, and which takes a quantum send's change (K iOS 961fc05a ColdStorageManager /
// ColdStorageSendEngine, as K-Desktop 9c30208 wires them in ui/coldstorage.js). The pure rules
// (records, names, the ranking of change candidates) are K-Desktop's shared/ui/cold-quantum.js;
// this is the extension's side: storage, the network probes, the session's reservations.

import { netKey } from "./net.js";
import * as wallet from "./wallet.js";
import * as vault from "./vault.js";
import { getLocal, setLocal } from "./browser.js";
import { quantumSpentFromHistory } from "../shared/engine/quantum.js";
import { pickFreshQuantumChange } from "../shared/ui/cold-quantum.js";

// Per wallet account: `spent` - a spend put the address's key on chain (the slashed shield; never
// change again); `used` - it took a send's change or a compound, which the history API may not
// show yet. Both only grow.
async function marksKey() {
  const view = await vault.readAccounts();
  return netKey(`kachat.coldQuantumMarks.${view.activeAccountId || view.accounts?.[0]?.id || "default"}`);
}

async function loadMarks() {
  try {
    const raw = (await getLocal(await marksKey())) || {};
    return { used: new Set(raw.used || []), spent: new Set(raw.spent || []) };
  } catch {
    return { used: new Set(), spent: new Set() };
  }
}

/** Marks `address` "used" or "spent" for good. */
export async function markQuantumAddress(kind, address) {
  const lowered = String(address || "").toLowerCase();
  if (!lowered || (kind !== "used" && kind !== "spent")) return;
  try {
    const key = await marksKey();
    const raw = (await getLocal(key)) || {};
    const list = new Set(raw[kind] || []);
    if (list.has(lowered)) return;
    list.add(lowered);
    await setLocal(key, { used: [...new Set(raw.used || [])], spent: [...new Set(raw.spent || [])], [kind]: [...list] });
  } catch { /* the history says the same, later */ }
}

/** The addresses among `addresses` already known to have spent. */
export async function knownSpentQuantum(addresses) {
  const { spent } = await loadMarks();
  return new Set((addresses || []).map((a) => String(a).toLowerCase()).filter((a) => spent.has(a)));
}

const unspentSeenAt = new Map();

/**
 * Whether a quantum address has ever SPENT, the one event that puts its key on chain (K
 * quantumAddressSpentState): true is marked for good; false means no spend in its whole history
 * (reused for a minute); null when the history can't be read now - never "not spent" then.
 */
export async function coldQuantumSpentState(address) {
  const lowered = String(address || "").toLowerCase();
  if (!lowered) return null;
  if ((await loadMarks()).spent.has(lowered)) return true;
  if (Date.now() - (unspentSeenAt.get(lowered) || 0) < 60_000) return false;
  const base = wallet.restApiUrl().replace(/\/+$/, "");
  const spent = await quantumSpentFromHistory(lowered, async (offset, limit) => {
    const url = `${base}/addresses/${encodeURIComponent(lowered)}/full-transactions?limit=${limit}&offset=${offset}&resolve_previous_outpoints=light`;
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    return response.json();
  });
  if (spent === true) await markQuantumAddress("spent", lowered);
  else if (spent === false) unspentSeenAt.set(lowered, Date.now());
  return spent;
}

/** Whether a quantum address has been used, read fresh: a mark answers at once, else its history
 *  count. null when it can't be read (counted as used by the pick). */
async function coldQuantumUsedState(address) {
  const lowered = String(address || "").toLowerCase();
  const marks = await loadMarks();
  if (marks.used.has(lowered) || marks.spent.has(lowered)) return true;
  return wallet.addressUsed(lowered);
}

// Change addresses handed to a request built this popup and not released: a second send built
// before the first one's change shows on chain must not pick the same one (K reservedQuantumChange).
const reserved = new Set();

/**
 * Where a send from quantum address `source` puts its change, and where Compound moves its coins (K
 * freshQuantumChangeAddress): another quantum address of the same account (`records`) that holds
 * nothing, was never used and never spent, change-chain #0-4 first. Reserved until released (or for
 * good once sent). Null when there is none.
 */
export function freshQuantumChange(records, source) {
  return pickFreshQuantumChange({
    records,
    source,
    reserved,
    fundedAddresses: async (candidates) => {
      const balances = await wallet.balancesFor(candidates);
      return new Set(candidates.filter((a) => (balances[a] ?? 0n) > 0n));
    },
    usedState: coldQuantumUsedState,
    spentState: coldQuantumSpentState,
  });
}

/** Hands back a change address freshQuantumChange reserved, for a request rebuilt, failed or
 *  abandoned before it went out. */
export function releaseQuantumChange(address) {
  if (address) reserved.delete(String(address).toLowerCase());
}
