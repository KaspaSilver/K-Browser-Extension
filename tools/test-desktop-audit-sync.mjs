// K-Desktop 522623c (Build 340's audit of 2026-11-25) in the shared engine, and the extension's side
// of it: a kUSDT trade refused while one of K's sends still needs a listed coin, and run in the
// address's send queue (#31); a .kas transfer's record kept after its reveal is sent (#18), shown as
// finishing; the node registry capped at 30 records; one .kachat claim per name (#17); a typed
// name resolved from one indexer record (#3); a chained send to another change address refused
// before signing (#1). Made-up coins; nothing here reaches a network.
// Run: node tools/test-desktop-audit-sync.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coinsInUseReason, setReservedOutpoints, SEND_NEEDS_COMPOUND } from "../shared/engine/transactions.js";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); } catch (error) { failures.push(`${name}: ${error?.stack || error}`); }
}

const coin = (n) => `${String(n).repeat(64).slice(0, 64)}:0`;

check("the engine names a listed coin a send holds; free coins pass", () => {
  setReservedOutpoints([coin("a")]);
  assert.equal(coinsInUseReason([coin("b"), coin("a").toUpperCase()]), "reserved");
  assert.equal(coinsInUseReason([coin("b")]), null);
  setReservedOutpoints([]);
  assert.equal(coinsInUseReason([coin("a")]), null);
});

check("Swap's trade reads every window's holds, says \"held\" (no KaPost words) and runs in the send queue", () => {
  const src = read("src/swap-kusdt.js");
  assert.match(src, /import \{ coinsInUseReason, enqueueSend \} from "\.\.\/shared\/engine\/transactions\.js";/);
  assert.match(src, /outpointsOf: async \(address\) => \{\n\s+await wallet\.refreshCoinHolds\(\);\n\s+return wallet\.outpointsAt\(address\);/);
  assert.match(src, /coinsInUse: \(keys\) => \(coinsInUseReason\(keys\) \? "held" : null\)/);
  assert.match(src, /queue: enqueueSend,/);
  assert.match(read("src/wallet.js"), /export async function refreshCoinHolds\(\) \{\n\s+try \{ await currentHolds\(\); \}/);
  const trade = read("shared/engine/kusdt-trade.js");
  assert.match(trade, /coinsHeld: "A send from this address hasn't reached a block yet/);
  assert.match(trade, /const done = queue \? await queue\(address, executeOnce\) : await executeOnce\(\);/);
});

check("a .kas transfer's reveal keeps its record, and Your Usernames shows it as finishing", () => {
  const engine = read("shared/engine/kns-reveal-recovery.js");
  assert.match(engine, /status: "reveal-sent", commitSeen: true, emptyChecks: 0/);
  assert.doesNotMatch(engine, /return outcome;\n\s*\}\n[\s\S]{0,40}\n\s*await clearPendingKnsTransfer\(record\.assetId\)\.catch\(\(\) => \{\}\);\n\s*return outcome;/);
  const domains = read("src/domains.js");
  assert.match(domains, /if \(record\.status === "reveal-sent"\) \{/);
  assert.match(domains, /Transfer finishing: /);
  // the waiting card has no Finish Transfer button
  const waiting = domains.slice(domains.indexOf('record.status === "reveal-sent"'), domains.indexOf("</div>`;\n  }"));
  assert.doesNotMatch(waiting, /data-finish/);
});

check("the node registry keeps 30 records", () => {
  assert.match(read("shared/engine/rpc.js"), /export const MAX_ENDPOINT_RECORDS = 30;/);
});

check("one .kachat claim per name; a typed name resolves from the record the chain checks", () => {
  assert.match(read("shared/engine/kachat-names/actions.js"), /You're already claiming \$\{name\}\.kachat\./);
  assert.match(read("shared/engine/kachat-names/registry.js"), /return addressOf\(n\.owner\);/);
});

check("a chained send to another change address is refused before signing; the extension's own check comes first", () => {
  assert.equal(SEND_NEEDS_COMPOUND, "SEND_NEEDS_COMPOUND");
  assert.match(read("shared/engine/transactions.js"), /if \(result\.transactions\.length > 1 && changeTo !== sourceAddress\) throw chainNeedsCompoundError\(\);/);
  // send-coins.js refuses a chain with a fresh change address first (CHAINED_CHANGE), so a legacy
  // source still gets rebuilt keeping its change
  assert.match(read("src/send-coins.js"), /if \(singleTransaction && pendings\.length > 1\) throw chainedChangeError\(\);/);
  assert.match(read("src/wallet.js"), /singleTransaction: Boolean\(changeAddress\)/);
});

check("shared/README names the K-Desktop commit", () => {
  assert.match(read("shared/README.md"), /Copied from K-Desktop \(KaChat-Desktop\) 522623c\./);
});

if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
