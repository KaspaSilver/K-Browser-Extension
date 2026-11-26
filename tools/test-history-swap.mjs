// History rows for a kUSDT swap (K iOS 961fc05a ownHistoryAmount, K-Desktop 9c30208
// engine/history-amounts.js): a swap spends Trestly's pool, which pays its whole balance back to
// itself, and that output must not count as "Sent". Also the wiring in wallet.js / manage.js, and
// the kUSDT store following a swap until its coins show (TokenWallet.followTrade).
// Made-up addresses and amounts; nothing here reaches a network.
// Run: node tools/test-history-swap.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ownHistoryAmount } from "../shared/engine/history-amounts.js";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); } catch (error) { failures.push(`${name}: ${error?.stack || error}`); }
}

const KAS = 100_000_000n;
const me = "kaspa:qme";
const other = "kaspa:qmine2";
const pool = "kaspa:qpool";
const friend = "kaspa:qfriend";

// a row's `flows` as src/wallet.js describeTransaction keeps them
function tx(inputs, outputs) {
  return {
    inputs: inputs.map(([address, sompi]) => ({ previous_outpoint_address: address, previous_outpoint_amount: sompi == null ? null : String(sompi) })),
    outputs: outputs.map(([address, sompi]) => ({ script_public_key_address: address, amount: String(sompi) })),
  };
}
const toOthersOf = (t, own = [me]) => t.outputs.filter((o) => !own.includes(o.script_public_key_address)).reduce((s, o) => s + BigInt(o.amount), 0n);

check("a buy through the pool counts what left the wallet, not the pool's balance", () => {
  // 10 KAS of ours + the pool's 367,800 KAS in; the pool gets 367,808 back, we get the 1.5 KAS
  // kUSDT carrier and 0.49 KAS change; fee 0.01
  const t = tx([[me, 10n * KAS], [pool, 367_800n * KAS]],
    [[pool, 367_808n * KAS], [me, 150_000_000n], [me, 49_000_000n]]);
  const own = ownHistoryAmount(t, me, { toOthers: toOthersOf(t), ownChange: 0n });
  assert.equal(own.isOutgoing, true);
  // 10 - 1.99 back = 8.01, less a near-zero share of the fee
  assert.ok(own.amountSompi <= 801_000_000n && own.amountSompi > 800_990_000n, String(own.amountSompi));
});

check("a sell that paid the wallet Kaspa reads Received, by what it gained", () => {
  // the kUSDT coin's 1.5 KAS carrier in; 40 KAS back to us
  const t = tx([[me, 150_000_000n], [pool, 367_808n * KAS]],
    [[pool, 367_769n * KAS - 1_000_000n], [me, 40n * KAS]]);
  const own = ownHistoryAmount(t, me, { toOthers: toOthersOf(t), ownChange: 0n });
  assert.deepEqual(own, { isOutgoing: false, amountSompi: 40n * KAS - 150_000_000n });
});

check("a plain send keeps its own figure", () => {
  const t = tx([[me, 10n * KAS]], [[friend, 3n * KAS], [me, 7n * KAS - 2_000n]]);
  const own = ownHistoryAmount(t, me, { toOthers: 3n * KAS, ownChange: 0n });
  assert.deepEqual(own, { isOutgoing: true, amountSompi: 3n * KAS });
});

check("change to another of the wallet's addresses is its own", () => {
  const t = tx([[me, 10n * KAS]], [[friend, 3n * KAS], [other, 7n * KAS - 2_000n]]);
  const own = ownHistoryAmount(t, me, { toOthers: 3n * KAS, ownChange: 7n * KAS - 2_000n, isOwnAddress: (a) => a === other });
  assert.deepEqual(own, { isOutgoing: true, amountSompi: 3n * KAS });
});

check("two of the wallet's addresses funding one send each show the whole send", () => {
  const t = tx([[me, 2n * KAS], [other, 5n * KAS]], [[friend, 6n * KAS], [me, 1n * KAS - 3_000n]]);
  const opts = { toOthers: 6n * KAS, ownChange: 0n, isOwnAddress: (a) => a === other || a === me };
  assert.deepEqual(ownHistoryAmount(t, me, opts), { isOutgoing: true, amountSompi: 6n * KAS });
  const fromOther = ownHistoryAmount(t, other, { ...opts, ownChange: 1n * KAS - 3_000n });
  assert.deepEqual(fromOther, { isOutgoing: true, amountSompi: 6n * KAS });
});

check("an input of ours with no known amount keeps the caller's figure", () => {
  const t = tx([[me, null], [pool, 5n * KAS]], [[pool, 5n * KAS], [me, 1n * KAS]]);
  assert.equal(ownHistoryAmount(t, me, { toOthers: 5n * KAS }), null);
});

check("an outside input of unknown amount takes no fee off", () => {
  const t = tx([[me, 10n * KAS], [pool, null]], [[pool, 100n * KAS], [me, 2n * KAS]]);
  assert.deepEqual(ownHistoryAmount(t, me, { toOthers: 100n * KAS }), { isOutgoing: true, amountSompi: 8n * KAS });
});

check("an address that paid nothing in has no figure here", () => {
  const t = tx([[friend, 10n * KAS]], [[me, 3n * KAS], [friend, 7n * KAS]]);
  assert.equal(ownHistoryAmount(t, me, { toOthers: 7n * KAS }), null);
});

check("history rows carry who paid in, and Manage's rows use the wallet's figure", () => {
  const wallet = read("src/wallet.js");
  assert.match(wallet, /const flows = \{/);
  assert.match(wallet, /paidTo, flows \}/);
  const manage = read("src/manage.js");
  assert.match(manage, /import \{ ownHistoryAmount \} from "\.\.\/shared\/engine\/history-amounts\.js";/);
  assert.match(manage, /function historyRow\(tx, address\)/);
  assert.match(manage, /ownHistoryAmount\(tx\.flows, address/);
  assert.match(manage, /historyRow\(tx, state\.address\)/);
  // the sheet's summary and Add to Portfolio use the row's figure too
  assert.match(manage, /showTransactionSheet\(\{ \.\.\.tx, direction, amountSompi \}/);
});

check("after a swap the kUSDT store follows the trade until its coin shows", () => {
  const src = read("src/swap-kusdt.js");
  assert.match(src, /afterTrade: \(\{ txid = null \} = \{\}\) => \{\n\s+if \(txid\) kusdt\(\)\.followTrade\(txid\);/);
  // an unknown outcome names no txid: one look 4 s later, as before
  assert.match(src, /else setTimeout\(\(\) => \{ kusdt\(\)\.refresh\(\)/);
  const swaps = read("src/swaps.js");
  assert.match(swaps, /kusdt\(\)\.followTrade\(txid, \{ onLook: /);
  const store = read("shared/ui/kusdt-wallet.js");
  assert.match(store, /KUSDT_TRADE_FOLLOW_DELAYS_MS = \[3, 4, 6, 8, 10, 15, 20, 30\]/);
});

check("a received kUSDT's bell entry is dated when the coin came", () => {
  const src = read("src/kusdt.js");
  assert.match(src, /blockTimeMs = Number\(tx\?\.block_time\) > 0/);
  assert.match(src, /timestamp: bellTimestamp\(happenedAtMs, stamp\)/);
});

check("Portfolio no longer has the Network Hashrate card (moved to K's Explorer)", () => {
  for (const file of ["src/portfolio.js", "src/portfolio-screens.js", "src/portfolio-core.js"]) {
    assert.doesNotMatch(read(file), /network-stats|showHashrateScreen|refreshHashrateIfNeeded/, file);
  }
});

if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
