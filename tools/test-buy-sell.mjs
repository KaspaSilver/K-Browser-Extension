// Buy and Sell, step by step (K iOS 824a30bb, bc0e6ba9, 6d1971c8; K-Desktop 32c457c, 31f8c41): the
// Wallet's buttons are Send, Receive, Buy and Sell, with Request Payment and Buy/Sell History as
// rows; Buy asks Crypto or Debit Card on mainnet; the steps go coin, where the Kaspa lands, the
// order, then the deposit and Purchase / Sale Complete (Order Sent for kUSDT). Source checks only;
// nothing here reaches a network.
// Run: node tools/test-buy-sell.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); } catch (error) { failures.push(`${name}: ${error?.stack || error}`); }
}

const popup = read("src/popup.js");
const swaps = read("src/swaps.js");
const buy = read("src/buy-kaspa.js");

check("the Wallet: Send, Receive, Buy, Sell; Request Payment and Buy/Sell History are rows", () => {
  assert.match(popup, /actionButton\("send", "Send", ACTION\.send\)\}\n\s+\$\{actionButton\("receive", "Receive", ACTION\.receive\)\}\n\s+\$\{actionButton\("buy", "Buy", ACTION\.buy\)\}\n\s+\$\{actionButton\("sell", "Sell", ACTION\.sell\)\}/);
  assert.doesNotMatch(popup, /actionButton\("swap"|actionButton\("request"/);
  const rows = ["chatting-qr", "request", "domains", "swap-history", "address-book"].map((id) => popup.indexOf(`class="glass nav-row" id="${id}"`));
  assert.ok(rows.every((at, i) => at > 0 && (i === 0 || at > rows[i - 1])), "Chatting Address, Request Payment, Your Usernames, Buy/Sell History, Contacts");
  assert.match(popup, /\$\("#buy"\)\.onclick = \(\) => import\("\.\/buy-kaspa\.js"\)\.then\(\(m\) => m\.openBuyKaspa\(\)\);/);
  assert.match(popup, /\$\("#sell"\)\.onclick = \(\) => import\("\.\/swaps\.js"\)\.then\(\(m\) => m\.showSwap\(\{ start: "sell" \}\)\);/);
  assert.match(popup, /\$\("#swap-history"\)\.onclick = \(\) => import\("\.\/swaps\.js"\)\.then\(\(m\) => m\.showSwap\(\{ start: "history" \}\)\);/);
});

check("Buy: Crypto or Debit Card on mainnet, straight to crypto on testnet", () => {
  assert.match(buy, /if \(IS_TESTNET\) \{ openBuySell\("buy"\); return; \}/);
  assert.match(buy, /label: "Buy Kaspa with Crypto"/);
  assert.match(buy, /label: "Buy Kaspa with Debit Card"/);
});

check("Debit Card: where the kUSDT lands, a regular slot reserved, copied, then Trestly's /buy in a new tab", () => {
  assert.match(buy, /title: "Where should your kUSDT land\?"/);
  assert.match(buy, /label: "Fresh Address"/);
  assert.match(buy, /label: "Chatting Address"/);
  // the fresh one is a swap payout's slot: the next LEGACY address, never a quantum one
  assert.match(buy, /const fresh = await wallet\.nextSwapPayoutAddress\(\)/);
  assert.match(buy, /address = \(await wallet\.reserveSwapPayoutAddress\(fresh\.address\)\)\.address;/);
  assert.match(buy, /if \(\(await vault\.readAccounts\(\)\)\.activeAccountId !== accountId\) return;/, "an account switch meanwhile does nothing");
  const copy = buy.indexOf("navigator.clipboard.writeText(address)");
  const open = buy.indexOf("ext.tabs.create({ url: trestlyBuyUrl() })");
  assert.ok(copy > 0 && open > copy, "copied before the tab opens");
  assert.match(buy, /return u\.protocol === "https:" \? `\$\{u\.origin\}\/buy` : "https:\/\/trestly\.io\/buy";/, "only an https site");
});

check("the steps: the coin, where (buying), the order; Back one step, Cancel on the first", () => {
  assert.match(swaps, /case "buy": return coinChoiceHtml\("What do you want to pay with\?"\);/);
  assert.match(swaps, /case "sell": return coinChoiceHtml\("What do you want for your Kaspa\?"\);/);
  assert.match(swaps, /state\.flowPath\.push\(\{ kind: kasSends \? "form" : "destination" \}\);/, "buying asks where; selling goes to the order");
  assert.match(swaps, /stepQuestionHtml\("Where should your Kaspa land\?"\)/);
  assert.match(swaps, /\{ id: "swap-dest-fresh", title: "Fresh Address", on: !choosing \}/);
  assert.match(swaps, /\{ id: "swap-dest-choose", title: "Choose an Address", on: choosing \}/);
  // Choose an Address: your addresses, the Chatting Address too; that pick is the payout
  assert.match(swaps, /state\.payoutOverride = source\.kind === "chatting" \? \{ index: null, address: source\.address \}/);
  assert.match(swaps, /address = state\.payoutOverride\?\.address \|\| \(await wallet\.reserveSwapPayoutAddress/);
  assert.match(swaps, /stepNoteHtml\("kUSDT is paid from one address, and your Kaspa lands on that same address\."\)/);
  assert.match(swaps, /const canBack = state\.agreed && !finishedStep\(step\) && state\.flowPath\.length > 0;/);
});

check("the order: You Pay / You Get, no flip and no coin picker, Buy Kaspa / Sell Kaspa", () => {
  assert.match(swaps, /label: "You Pay"/);
  assert.match(swaps, /label: "You Get"/);
  assert.doesNotMatch(swaps, /data-swap-flip|data-swap-pick[^-]|openCoinPicker|openAddressPicker/);
  assert.match(swaps, /state\.kasIsSendSide \? "Sell Kaspa" : "Buy Kaspa"/);
  // the Swap From row only on a kUSDT sell: a buy's address was picked on "where"
  assert.match(swaps, /\$\{state\.kasIsSendSide \? `<div class="sk-card"><div class="sk-from-row">\n\s+<span class="tx-meta"><span class="muted tiny">Swap From \(kUSDT Lands Here\)/);
  // both amounts group thousands as you type
  assert.match(read("src/grouped-amount.js"), /#pf-atp-amount, \.swap-amount";/);
});

check("a ChangeNOW order goes on to its deposit screen, checked every 10 s, then Complete; kUSDT ends on Order Sent", () => {
  assert.match(swaps, /state\.flowPath\.push\(\{ kind: "deposit", id: String\(response\.id\) \}\);/);
  assert.match(swaps, /state\.flowPath\.push\(\{ kind: "kusdtDone", message: record\?\.text \|\| "Swap sent" \}\);/);
  assert.match(swaps, /\}, 10_000\);/);
  assert.match(swaps, /if \(String\(status \|\| ""\)\.toLowerCase\(\) === "finished"\) state\.flowPath\[state\.flowPath\.length - 1\] = \{ kind: "complete", id \};/);
  assert.match(swaps, /const wanted = step\.kind === "deposit" && state\.agreed && handle\?\.isOpen\(\) && !document\.hidden;/, "only while it shows");
  assert.match(swaps, /swap\?\.toTicker === "kas" \? "Purchase Complete" : "Sale Complete"/);
  assert.match(swaps, /swap\.addedToPortfolio \? "Added to Portfolio" : "Add to Portfolio"/);
  // Send KAS from K: Send Kaspa filled in, then back on this order's deposit screen
  assert.match(swaps, /recipient: swap\.payinAddress, amountSompi,\n\s+onClose: \(\) => \{ dock\.returnToTab\(\); showSwap\(\{ deposit: id \}\); \},/);
});

check("Send kUSDT's Swap for kUSDT goes straight to Sell Kaspa for kUSDT", () => {
  assert.match(read("src/kusdt-screens.js"), /m\.showSwap\(\{ coin: "kusdt", buying: true \}\)/);
  assert.match(swaps, /state\.flowStart = buying \? "sell" : "buy";\n\s+state\.flowPath = \[\{ kind: buying \? "form" : "destination" \}\];/);
});

if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
