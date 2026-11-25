// Swap's kUSDT side (K iOS 518fdc8c TrestlyTrade / KusdtSwapFromPicker / TrestlyApprovalSheet, as
// K-Desktop d570abd wires them in ui/app.js swapKusdtDeps): Trestly's pinned pool code in its own
// worker (shared/engine/kusdt-wallet-core.js; its fetches go only to the Trestly API and the public
// Kaspa resolvers, straight from the worker), the trade itself (shared/engine/kusdt-trade.js), and
// what only the extension knows - the account's addresses, their keys, the coin holds and the bell.
//
// The key: the trade asks for it synchronously right after Approve, and the vault answers
// asynchronously, so it is fetched on Approve (askAndUnlock), handed over once, for that address
// only, and dropped whatever happens. The approval is the confirmation, as a kUSDT send's is: no
// password (KaPay iOS 5848fb0).

import * as wallet from "./wallet.js";
import * as bell from "./bell.js";
import { kusdt, secretKeyFor, syncKusdtAccount, kusdtAccount } from "./kusdt.js";
import { NETWORK_ID } from "../shared/engine/network.js";
import { getEndpoint } from "../shared/engine/endpoints.js";
import { isQuantumIndex } from "../shared/engine/quantum.js";
import { kusdtDeployment } from "../shared/engine/kusdt.js";
import { kusdtWalletCore } from "../shared/engine/kusdt-wallet-core.js";
import { createTrestlyTrade } from "../shared/engine/kusdt-trade.js";
import { activityId } from "../shared/engine/kusdt-store.js";
import { holdingIdFor } from "../shared/ui/kusdt-wallet.js";

let trade = null;
let unlocked = null;  // { address, hex }: the key for the trade that was just approved
let trading = "";     // the address whose trade is running (the coins it spends are held there)

function tradeDeps() {
  return {
    walletCall: (fn, request) => kusdtWalletCore().walletCall(fn, request),
    network: () => NETWORK_ID,
    apiUrl: () => getEndpoint("trestlyApi") || kusdtDeployment(NETWORK_ID).apiBase,
    storage: globalThis.localStorage,
    // every coin the node lists there, held ones included (a hold ends once one is really gone)
    outpointsOf: (address) => wallet.outpointsAt(address),
    secretFor: (target) => {
      const key = unlocked;
      unlocked = null;
      return key && key.address === target?.address ? key.hex : null;
    },
    noteSpentOutpoints: (keys) => { wallet.holdSubmittedCoins(keys, trading); },
    // a swap's KAS side isn't "Received KAS": the bell's own-input check already leaves it out;
    // the last one named is the trade's own, which afterTrade follows
    markOwnTransaction: (txid) => { tradeTxid = String(txid || ""); },
    afterTrade: () => {
      const txid = tradeTxid;
      tradeTxid = "";
      if (txid) followTrade(txid);
      else setTimeout(() => { kusdt().refresh().catch(() => {}); }, 4000);
    },
  };
}

let tradeTxid = "";   // the trade's txid, from markOwnTransaction until afterTrade takes it
let followRun = 0;    // the newest followTrade; an older one stops

/** Widening waits, in seconds, between looks after a swap (K iOS 961fc05a followTrade). */
export const FOLLOW_TRADE_WAITS = [3, 4, 6, 8, 10, 15, 20, 30];

/**
 * A swap went out (K iOS 961fc05a TokenWallet.followTrade): the coins it made for you (the kUSDT
 * bought, or a sell's kUSDT change) show only once Trestly lists them, which takes longer than the
 * one look 4 s later that used to be all a swap got. Looks again on a widening schedule (3 s to
 * about 1.5 minutes) until a coin from the swap shows.
 */
function followTrade(txid) {
  const run = ++followRun;
  const id = txid.toLowerCase();
  (async () => {
    for (const wait of FOLLOW_TRADE_WAITS) {
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      if (run !== followRun) return;
      const store = kusdt();
      try { await store.refresh(); } catch { /* the next look tries again */ }
      if (run !== followRun) return;
      const shows = (store.heldHoldings() || []).some((holding) =>
        store.coinsOf(holding).some((coin) => String(coin.transactionId || "").toLowerCase() === id));
      if (shows) return;
    }
  })();
}

/** The popup's trade (one per popup, so one trade per address at a time). */
export function swapTrade() {
  if (!trade) trade = createTrestlyTrade(tradeDeps());
  return trade;
}

/**
 * The whole trade for `target` ({ label, address, spendingIndex }): `askApproval(request)` shows the
 * approval and answers true (Approve) or false. On Approve the address's key is fetched from the
 * vault for this one execute. Resolves as createTrestlyTrade's run; throws its TradeError.
 */
export async function runKusdtSwap({ params, target, askApproval, isClosed }) {
  const t = swapTrade();
  trading = target.address;
  tradeTxid = "";
  try {
    return await t.run({
      method: "kusdt_swap",
      params,
      target,
      native: true,
      isClosed,
      ask: async (request) => {
        unlocked = null;
        if ((await askApproval(request)) !== true || isClosed()) return false;
        const hex = await secretKeyFor({ spendingIndex: target.spendingIndex ?? null, address: target.address });
        // no key: the trade refuses it itself ("K couldn't unlock this address's key")
        if (hex) unlocked = { address: target.address, hex };
        return true;
      },
    });
  } finally {
    unlocked = null;
    trading = "";
  }
}

/**
 * Swap From (K iOS KusdtSwapFromPicker): the Chatting Address, every address holding kUSDT, and the
 * regular spending addresses holding KAS - never a quantum-resistant one (Trestly's code trades
 * only from plain Schnorr addresses). -> [{ label, address, spendingIndex, units, kasSompi }]
 */
export async function kusdtFromChoices() {
  await syncKusdtAccount();
  const owner = kusdtAccount();
  if (!owner) return [];
  const w = kusdt();
  const held = w.heldHoldings?.() || [];
  const unitsOf = (address) => held.find((h) => h.address === address)?.units ?? 0n;
  const list = [{ label: "Chatting Address", address: owner, spendingIndex: null, units: unitsOf(owner) }];
  for (const h of held) {
    if (h.spendingIndex == null || isQuantumIndex(h.spendingIndex) || list.some((c) => c.address === h.address)) continue;
    list.push({ label: w.labelOf(h), address: h.address, spendingIndex: h.spendingIndex, units: h.units ?? 0n });
  }
  let rows = [];
  try { rows = (await wallet.spendingList()).rows || []; } catch { rows = []; }
  for (const r of rows) {
    if (r.quantum || isQuantumIndex(r.index) || !(r.balanceSompi > 0n) || list.some((c) => c.address === r.address)) continue;
    list.push({ label: r.label, address: r.address, spendingIndex: r.index, units: 0n });
  }
  let balances = {};
  try { balances = await wallet.balancesFor(list.map((c) => c.address)); } catch { balances = {}; }
  if (kusdtAccount() !== owner) return [];
  return list.map((c) => ({ ...c, kasSompi: balances[c.address] ?? null }));
}

/** The kUSDT `address` holds, in units, as the kUSDT state knows it (K iOS 6b99c6dd kusdtFromUnits). */
export function kusdtUnitsAt(address) {
  const target = String(address || "").toLowerCase();
  if (!target) return 0n;
  return (kusdt().heldHoldings?.() || []).filter((h) => String(h.address).toLowerCase() === target).reduce((sum, h) => sum + BigInt(h.units ?? 0n), 0n);
}

/** The kUSDT state for the active account, looked up again when it's old (Swap's Available). */
export async function kusdtHoldingsFresh() {
  await syncKusdtAccount();
  await kusdt().refreshIfStale?.();
}

/** The swap in that address's kUSDT history and a line in the bell (K iOS TrestlyTrade.recordSwap). */
export function noteKusdtSwap({ record, target, owner }) {
  if (!record || !owner) return;
  try {
    const holdingId = holdingIdFor(target?.spendingIndex ?? null);
    kusdt().storeFor(owner)?.record({
      id: activityId(record.txid, holdingId, "swapped"), kind: "swapped", units: record.kusdtUnits,
      counterparty: "Trestly", holdingId, fee: record.fee, outgoing: record.sold,
    });
  } catch { /* the history's own problem */ }
  bell.record({ id: `trestly-swap-${record.txid}`, source: "wallet", title: record.title, body: record.text, timestamp: Date.now(), targetId: "kusdt", account: owner });
}

/** `/terms` on Trestly's site for this network (trestly.io on mainnet). */
export function trestlyTermsUrl() {
  try {
    const u = new URL(kusdtDeployment(NETWORK_ID).siteUrl);
    return u.protocol === "https:" ? `${u.origin}/terms` : "https://trestly.io/terms";
  } catch { return "https://trestly.io/terms"; }
}
