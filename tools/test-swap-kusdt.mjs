// Swap's kUSDT side (K iOS 518fdc8c, K-Desktop d570abd engine/kusdt-trade.js, src/swap-kusdt.js),
// with Trestly's pool code mocked: nothing here reaches api.trestly.io or a Kaspa node, and no key
// is real. Covers the approval gate (nothing signed before Approve, a Decline sends nothing, the key
// must be the address's own and leaves the request afterwards, a requote is asked again, one trade
// per address, the 10-minute hold after an unknown outcome), the approval's numbers and warnings,
// the worker's allow-lists, the pinned pool code, comma decimals, and kUSDT first in the picker.
// Run: node tools/test-swap-kusdt.mjs
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { schnorr } from "@noble/curves/secp256k1.js";
import * as TR from "../shared/engine/kusdt-trade.js";
import * as AP from "../shared/ui/swap-approval.js";
import * as BR from "../shared/engine/kusdt-wallet-bridge.js";
import { KusdtCoreError } from "../shared/engine/kusdt-core.js";
import { addressOfOwner } from "../shared/engine/kusdt.js";
import { KUSDT_COIN, coinByKey, isTrestlyCoin, cleanSwapAmount } from "../shared/ui/swap-quote.js";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (error) { failures.push(`${name}: ${error?.stack || error}`); }
}

const skA = "01".repeat(32);
const skB = "02".repeat(32);
const addrA = addressOfOwner(schnorr.getPublicKey(Buffer.from(skA, "hex")), "mainnet");
const targetA = { label: "Chatting Address", address: addrA, spendingIndex: null };

function harness({ execute = () => ({ result: { txid: "a".repeat(64), amountOut: "260000", confirmed: true }, fee: "2000", steps: [], inputs: [`${"c".repeat(64)}:0`] }), key = skA } = {}) {
  const log = [];
  let clock = 1_000_000;
  const holds = new Map();
  let present = [`${"b".repeat(64)}:1`, `${"b".repeat(64)}:2`];
  const executeRequests = [];
  const h = {
    log, executeRequests, spent: [],
    advance(ms) { clock += ms; },
    setPresent(list) { present = list; },
    trade: TR.createTrestlyTrade({
      walletCall: async (fn, request) => {
        log.push(`${fn}${request.wallet?.secret ? "+key" : ""}`);
        if (fn === "prepare") {
          assert.ok(!request.wallet.secret, "prepare never carries a key");
          return { kind: "swap", side: request.params.side, amountIn: request.params.amountIn, minOut: request.params.minOut, quote: "260000", feeAbout: "3000", feerate: 1, tokenValue: "150000000", paused: false, breaker: null, belowMinimum: false, feeShare: false, blocked: false };
        }
        executeRequests.push({ object: request, text: JSON.stringify(request) });
        return execute(request, executeRequests.length);
      },
      network: () => "mainnet",
      apiUrl: () => "https://api.trestly.io/api/v1",
      storage: { getItem: (k) => holds.get(k) ?? null, setItem: (k, v) => holds.set(k, v), removeItem: (k) => holds.delete(k) },
      now: () => clock,
      outpointsOf: async () => [...present],
      secretFor: () => { log.push("key"); return key; },
      noteSpentOutpoints: (keys) => h.spent.push(...keys),
      markOwnTransaction: () => {},
      afterTrade: () => log.push("after"),
    }),
  };
  return h;
}
const params = { side: "buy", amountIn: "1000000000", minOut: String(TR.minimumOut(260000n)) };

await check("minimumOut is 1% under the quote and can't underflow", () => {
  assert.equal(TR.minimumOut(260000n), 257400n);
  assert.equal(TR.minimumOut(1n), 1n);
  assert.equal(TR.minimumOut(0n), 0n);
});

await check("Decline: nothing is signed or sent, and no key is ever taken", async () => {
  const h = harness();
  await assert.rejects(h.trade.run({ method: "kusdt_swap", params, target: targetA, native: true, ask: async () => false }),
    (e) => e.code === TR.TRADE_CODE.rejected && /Nothing was sent/.test(e.message));
  assert.deepEqual(h.log, ["prepare"]);
});

await check("Swap closed while the sheet was up counts as a Decline", async () => {
  const h = harness();
  await assert.rejects(h.trade.run({ method: "kusdt_swap", params, target: targetA, ask: async () => true, isClosed: () => true }), (e) => e.code === TR.TRADE_CODE.rejected);
  assert.ok(!h.log.includes("key"));
});

await check("Approve: the key is taken only after it, goes to execute once, and leaves the request after", async () => {
  const h = harness();
  const done = await h.trade.run({ method: "kusdt_swap", params, target: targetA, native: true, ask: async () => true });
  assert.deepEqual(h.log.slice(0, 3), ["prepare", "key", "execute+key"]);
  assert.ok(h.executeRequests[0].text.includes(skA));
  assert.equal(h.executeRequests[0].object.wallet, undefined, "the request's copy is gone afterwards");
  assert.equal(JSON.parse(h.executeRequests[0].text).quoted, "260000", "held to the quote approved");
  assert.deepEqual(h.spent, [`${"c".repeat(64)}:0`], "the coins it spent are held like a send's");
  const rec = TR.swapRecord(done);
  assert.equal(rec.text, "Swapped 10 KAS for 0.26 kUSDT");
  assert.equal(rec.kusdtUnits, 260000n);
});

await check("a key that isn't the address's own (another account) is refused, nothing sent", async () => {
  const h = harness({ key: skB });
  await assert.rejects(h.trade.run({ method: "kusdt_swap", params, target: targetA, ask: async () => true }), (e) => /doesn't belong to the account that's open now/.test(e.message));
  assert.ok(!h.log.includes("execute+key"));
});

await check("no key from the vault: refused, nothing sent", async () => {
  const h = harness({ key: null });
  await assert.rejects(h.trade.run({ method: "kusdt_swap", params, target: targetA, ask: async () => true }), (e) => e.message === TR.TRADE_MESSAGES.noKey);
  assert.ok(!h.log.includes("execute+key"));
});

await check("a requote is asked again, showing what was seen", async () => {
  const h = harness({ execute: (req, n) => (n === 1 ? { requote: "250000", steps: [] } : { result: { txid: "d".repeat(64), amountOut: "250000" } }) });
  const asks = [];
  await assert.rejects(h.trade.run({ method: "kusdt_swap", params, target: targetA, ask: async (req) => { asks.push(req); return asks.length === 1; } }), (e) => e.code === TR.TRADE_CODE.rejected);
  assert.equal(asks.length, 2);
  assert.equal(asks[1].seen.quote, "260000");
  assert.deepEqual(h.log, ["prepare", "key", "execute+key", "prepare"]);
});

await check("one trade per address at a time", async () => {
  const h = harness();
  let release;
  const first = h.trade.run({ method: "kusdt_swap", params, target: targetA, ask: () => new Promise((r) => { release = r; }) });
  await new Promise((r) => setTimeout(r, 5));
  await assert.rejects(h.trade.run({ method: "kusdt_swap", params, target: targetA, ask: async () => true }), (e) => e.code === TR.TRADE_CODE.busy);
  release(false);
  await assert.rejects(first);
});

await check("an unknown outcome holds the address for 10 minutes; it ends early once a held coin is spent", async () => {
  const h = harness({ execute: () => { throw new KusdtCoreError("maybeSent", "Trestly's pool code gave no answer."); } });
  await assert.rejects(h.trade.run({ method: "kusdt_swap", params, target: targetA, ask: async () => true }), (e) => e.maybeSent === true && /may have gone through/.test(e.message));
  assert.equal(await h.trade.heldMinutes(addrA), 10);
  h.advance(4 * 60_000);
  assert.equal(await h.trade.heldMinutes(addrA), 6);
  h.setPresent([`${"b".repeat(64)}:2`]);
  assert.equal(await h.trade.heldMinutes(addrA), null);
});

await check("the kUSDT quote, rate and approval numbers are exact", () => {
  assert.equal(TR.kusdtQuoteText(260000n, { buying: true }), "0.26");
  assert.equal(TR.kusdtRateText({ buying: true, amountIn: 1_000_000_000n, quote: 260000n }), "1 KAS ≈ 0.02600000 kUSDT (Kaspa)");
  const prepared = { side: "buy", amountIn: "1000000000", quote: "260000", minOut: "257400", tokenValue: "150000000", feeAbout: "3000", paused: true, blocked: true };
  const rows = AP.approvalRows({ prepared, seen: { quote: "270000" } }).map((r) => `${r.label}: ${r.value}`);
  assert.deepEqual(rows, ["You Pay: 10 KAS", "You Receive: 0.26 kUSDT", "You Saw: 0.27 kUSDT", "Minimum You Get: 0.2574 kUSDT", "Kept in Your Token: 1.5 KAS"]);
  assert.equal(TR.kasAmountLabel(TR.tradeUnits(prepared.feeAbout)), "0.00003 KAS");
  assert.deepEqual(AP.approvalWarnings(prepared), [AP.APPROVAL_TEXT.paused]);
  assert.equal(AP.approvalBlocked(prepared), true);
  assert.equal(AP.APPROVE_ARM_MS, 800);
});

await check("the extension's Swap: Approve armed late and never while blocked, closing declines, the key handed over once", () => {
  const swaps = read("src/swaps.js");
  assert.match(swaps, /open\.timer = setTimeout\(\(\) => \{ if \(approval === open && !approvalBlocked\(p\)\) button\.disabled = false; \}, APPROVE_ARM_MS\);/);
  assert.match(swaps, /<button class="big" data-swap-approve disabled>Approve<\/button>/);
  assert.match(swaps, /onClose: \(\) => answerApproval\(false\)/);
  assert.match(swaps, /onClose: \(\) => \{ clearTimeout\(estimateTimer\); clearTimeout\(depositTimer\); depositTimer = null; document\.removeEventListener\("visibilitychange", onVisibility\); answerApproval\(false\); \}/, "closing Buy/Sell declines");
  const glue = read("src/swap-kusdt.js");
  assert.match(glue, /const key = unlocked;\n\s+unlocked = null;\n\s+return key && key\.address === target\?\.address \? key\.hex : null;/, "once, for that address only");
  assert.match(glue, /\} finally \{\n\s+unlocked = null;/, "dropped whatever happens");
  assert.match(glue, /if \(\(await askApproval\(request\)\) !== true \|\| isClosed\(\)\) return false;\n\s+const hex = await secretKeyFor/, "fetched only after Approve");
});

await check("Trestly's worker reaches only its API host and the public Kaspa nodes", async () => {
  const api = ["api.trestly.io"];
  assert.equal(BR.allowedFetchUrl("https://api.trestly.io/api/v1/pool", api), true);
  assert.equal(BR.allowedFetchUrl("https://eric.kaspa.stream/x", api), true);
  assert.equal(BR.allowedFetchUrl("https://evil.example/x", api), false);
  assert.equal(BR.allowedFetchUrl("http://api.trestly.io/x", api), false);
  assert.equal(BR.allowedSocketUrl("wss://maxim.kaspa.red/kaspa/mainnet/wrpc/json"), true);
  assert.equal(BR.allowedSocketUrl("wss://evil.example/"), false);
  let fetched = 0;
  const refused = await BR.relayFetch({ url: "https://evil.example/", method: "GET" }, { fetchImpl: async () => { fetched += 1; }, apiHosts: api });
  assert.ok(refused.error);
  assert.equal(fetched, 0);
  const worker = read("shared/engine/kusdt-wallet-worker.js");
  assert.ok(worker.indexOf('import { bridge } from "./kusdt-wallet-install.js";') < worker.indexOf('import "../kusdt/kusdt-wallet.js";'), "the bridge is installed before their code runs");
  // the manifest lets the worker reach them (host permissions), and nothing more is added
  const manifest = JSON.parse(read("public/manifest.json"));
  for (const host of ["https://api.trestly.io/*", "https://*.kaspa.stream/*", "https://*.kaspa.red/*", "https://*.kaspa.green/*", "https://*.kaspa.blue/*"]) assert.ok(manifest.host_permissions.includes(host), host);
  assert.ok(!manifest.host_permissions.some((h) => h.includes("knsdomains")), "KNS's API is no longer reached");
});

await check("Trestly's pool code is the pinned copy", () => {
  const sums = read("shared/kusdt/SHA256SUMS");
  const pinned = /^([0-9a-f]{64}) {2}kusdt-wallet\.js$/m.exec(sums)?.[1];
  assert.ok(pinned);
  assert.ok(existsSync(new URL("shared/kusdt/kusdt-wallet.js", root)));
  assert.equal(createHash("sha256").update(readFileSync(new URL("shared/kusdt/kusdt-wallet.js", root))).digest("hex"), pinned);
});

await check("comma decimals: \"1,5\" is 1.5, never 15, for ChangeNOW and both kUSDT sides", () => {
  assert.equal(cleanSwapAmount("1,5"), "1.5");
  assert.equal(TR.kusdtSwapAmountIn("1,5", { buying: true }), 150_000_000n);
  assert.equal(TR.kusdtSwapAmountIn("1,5", { buying: false }), 1_500_000n);
  assert.equal(TR.kusdtSwapAmountIn("0", { buying: true }), null);
});

await check("kUSDT is a Buy/Sell coin, first on the coin step", () => {
  assert.equal(coinByKey("kusdt:kaspa-trestly"), KUSDT_COIN);
  assert.equal(isTrestlyCoin(KUSDT_COIN), true);
  assert.match(read("src/swaps.js"), /const every = \[KUSDT_COIN, \.\.\.PINNED_GROUP_TICKERS/);
});

await check("Max on a kUSDT swap (K iOS 6b99c6dd): a buy keeps back 1.8 KAS, a sell spends all the kUSDT", () => {
  const swaps = read("src/swaps.js");
  assert.match(swaps, /const FEE_KEPT_FOR_BUY = 30_000_000n;/);
  assert.match(swaps, /const KAS_KEPT_FOR_BUY = KUSDT_TOKEN\.kasPerCoinSompi \+ FEE_KEPT_FOR_BUY;/);
  assert.equal(TR.kasAmountLabel(150_000_000n + 30_000_000n), "1.8 KAS");
  assert.match(swaps, /return kas > KAS_KEPT_FOR_BUY \? kas - KAS_KEPT_FOR_BUY : 0n;/, "never below zero");
  assert.match(swaps, /if \(!state\.kasIsSendSide\) return kusdtFromUnits\(\);/, "a sell: all the kUSDT");
  assert.match(swaps, /Max keeps \$\{kasAmountLabel\(KAS_KEPT_FOR_BUY\)\} back: \$\{kasAmountLabel\(KUSDT_TOKEN\.kasPerCoinSompi\)\} goes inside your new kUSDT coin, and up to \$\{kasAmountLabel\(FEE_KEPT_FOR_BUY\)\} pays the network fee\./);
  // Available counts only what can go (K-Desktop d115548): no covenant-bound, held or just-spent coins
  assert.match(swaps, /sompi = await wallet\.spendableSompiAt\(address\);/);
  assert.match(read("src/wallet.js"), /return totalUtxoSompi\(excludeCovenantUtxos\(await spendableEntries\(address\)\)\);/);
  // only kUSDT swaps show Available and Max: a ChangeNOW coin is paid from elsewhere
  assert.match(swaps, /if \(!isKusdt\(\)\) return null;\n\s+if \(state\.kasIsSendSide\)/);
});

if (failures.length) {
  console.error(failures.join("\n\n"));
  console.error(`swap kusdt: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`swap kusdt: ${passed} passed`);
