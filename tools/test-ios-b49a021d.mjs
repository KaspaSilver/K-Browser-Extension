// K iOS b49a021d / d88891ea, as K-Desktop 1cbe77e, 6b42f14, ecb4257, 76d4a7f and c8e775a have them:
// kUSDT swaps in Buy/Sell History; a deposit's Send KAS from K only once; its checks stop at an end
// state; Rename in place on address cards, saved once as it ends; expired usernames on Wallet's dot,
// Your Usernames' "1 Expired" and a red pill; reminders for every name, a week before grace ends
// too; a fresh payout skips kUSDT and used slots; Send refuses From = To.
// Source checks, plus the pieces that run on their own (the history entry, the rename).
// Run: node tools/test-ios-b49a021d.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { kusdtSwapHistoryEntry, displayTicker, portfolioPrefill } from "../shared/ui/swap-quote.js";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); } catch (error) { failures.push(`${name}: ${error?.stack || error}`); }
}

const swaps = read("src/swaps.js");
const popup = read("src/popup.js");
const live = read("src/kachat-live.js");
const notifier = read("src/kachat-notifier.js");
const wallet = read("src/wallet.js");
const send = read("src/send.js");
const TXID = "ab".repeat(32);

await check("a kUSDT swap's history entry: its txid, the address, Finished or Sending, marked Trestly", () => {
  const e = kusdtSwapHistoryEntry({ txid: TXID, bought: true, confirmed: false, kasText: "10", kusdtText: "1.25", address: "kaspa:q1" });
  assert.equal(e.id, TXID);
  assert.equal(e.fromTicker, "kas");
  assert.equal(e.toTicker, "kusdt");
  assert.equal(e.toAmount, "1.25");
  assert.equal(e.status, "sending");
  assert.equal(e.provider, "trestly");
  assert.equal(e.payoutAddress, "kaspa:q1");
  assert.equal(kusdtSwapHistoryEntry({ txid: "", bought: true }), null);
  assert.equal(displayTicker("kusdt"), "kUSDT");
  assert.equal(displayTicker("btc"), "BTC");
  assert.match(portfolioPrefill({ ...e, status: "finished", fromAmount: "10", toAmount: "1.25", createdAt: 1 })?.notes || "kUSDT swap (Trestly)", /kUSDT swap \(Trestly\)|ChangeNOW/);
});

await check("Buy/Sell History: the kUSDT swap recorded after the trade, its row says Trestly, its details ask the network", () => {
  assert.match(swaps, /noteKusdtSwap\(\{ record, target, owner \}\);\n\s+\/\/ and in Buy\/Sell History[^\n]*\n\s+try \{ recordKusdtSwap\(record, target\.address\); \}/);
  assert.match(swaps, /\$\{esc\(dateText\(swap\.createdAt\)\)\} · \$\{esc\(providerName\(swap\)\)\}/);
  assert.match(swaps, /const providerName = \(swap\) => \(swap\.provider === "trestly" \? "Trestly" : "ChangeNOW"\);/);
  assert.match(swaps, /Trestly's kUSDT pool on Kaspa/);
  assert.match(swaps, /View in Explorer/);
  assert.match(swaps, /const accepted = await transactionAccepted\(id\);/);
  assert.match(swaps, /is_accepted === true/);
  assert.match(swaps, /Couldn't reach the network - try again/);
});

await check("the deposit: Send KAS from K only while waiting and not sent; the send's txid shown instead", () => {
  assert.match(swaps, /if \(swap\.kasSendTxId\) \{/);
  assert.match(swaps, /if \(status !== "new" && status !== "waiting"\) return "";/);
  assert.match(swaps, /order\.kasSendTxId = txid \|\| "sent";\n\s+write\(HISTORY_KEY, saved\);/);
  assert.match(swaps, /if \(!swap\?\.payinAddress \|\| swap\.kasSendTxId \|\| amountSompi == null \|\| !main\) return;/);
  assert.match(send, /try \{ opts\.onSent\?\.\(\{ txid \}\); \}/, "Send Kaspa hands its txid on");
  // a send whose outcome is unknown may land: the order is marked sent too (K iOS d88891ea)
  assert.match(send, /if \(error\?\.code === SEND_OUTCOME_UNKNOWN\) \{ try \{ opts\.onOutcomeUnknown\?\.\(\{ txid: error\.txid/);
  assert.match(swaps, /onOutcomeUnknown: \(\{ txid \} = \{\}\) => markSent\(txid\),/);
});

await check("the deposit's checks stop at any end state, and a status is saved only when it moved", () => {
  assert.match(swaps, /const SWAP_END_STATES = new Set\(\["finished", "failed", "refunded", "expired"\]\);/);
  assert.match(swaps, /if \(SWAP_END_STATES\.has\(String\(state\.history\.find\(\(x\) => x\.id === id\)\?\.status \|\| ""\)\.toLowerCase\(\)\)\) return;/);
  assert.match(swaps, /if \(swap && swap\.status !== status\) \{ swap\.status = status; saveHistory\(\); \}/);
});

await check("Rename in place: saved once as it ends, Escape keeps the old name, empty goes back to Address #n", async () => {
  // a tiny DOM, enough for the rename
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attrs = {}; this.classList = new Set(); this.hidden = false; this.value = ""; this.innerHTML = ""; this.isConnected = true; }
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
    removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
    fire(t, e = {}) { for (const f of [...(this.listeners[t] || [])]) f({ stopPropagation() {}, preventDefault() {}, ...e }); }
    setAttribute(k, v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    after(el) { this.next = el; }
    remove() { this.removed = true; }
    focus() {}
    select() {}
    blur() { this.fire("blur"); }
  }
  const make = () => {
    const name = new El("span");
    const button = new El("button");
    button.innerHTML = "Rename";
    const card = new El("div");
    card.classList.add = card.classList.add.bind(card.classList);
    card.classList.remove = card.classList.delete.bind(card.classList);
    card.querySelector = (sel) => (sel === ".ac-name" ? name : sel === '[data-card-action="rename"]' ? button : null);
    return { card, name, button, input: () => name.next };
  };
  globalThis.document = { createElement: (tag) => new El(tag) };
  const { startInlineRename, inlineRenameActive } = await import("../src/inline-rename.js");
  const saved = [];
  const a = make();
  startInlineRename(a.card, { key: "spending:1", current: "Old", onChange: (t) => saved.push(t), onDone: () => saved.push("done") });
  assert.equal(inlineRenameActive(), true);
  assert.match(a.button.innerHTML, /Done/);
  a.input().value = "N"; a.input().value = "New";
  assert.deepEqual(saved, [], "nothing saved while typing");
  a.input().fire("blur");
  assert.deepEqual(saved, ["New", "done"], "saved once, as it ends");
  assert.equal(a.button.innerHTML, "Rename");
  assert.equal(inlineRenameActive(), false);
  const b = make();
  saved.length = 0;
  startInlineRename(b.card, { key: "spending:2", current: "Keep", onChange: (t) => saved.push(t) });
  b.input().value = "Changed";
  b.input().fire("keydown", { key: "Escape" });
  assert.deepEqual(saved, [], "Escape keeps the old name");
  for (const file of ["src/manage.js", "src/kusdt-screens.js"]) {
    const src = read(file);
    assert.match(src, /import \{ startInlineRename, inlineRenameActive \} from "\.\/inline-rename\.js";/, file);
    assert.match(src, /\/\/ a card's name is being typed: the rename's end repaints \(inline-rename\.js\)\n\s+if \(inlineRenameActive\(\)\) return;/, file);
    assert.match(src, /placeholder: spendingIndexTitle\(/, `${file}: empty goes back to Address #n`);
    assert.doesNotMatch(src, /title: "Rename Address"/, `${file}: no pop-up`);
  }
});

await check("expired usernames: Wallet's red dot, Your Usernames' \"1 Expired\", on every address of the wallet", () => {
  assert.match(popup, /dock\.setBadge\("profile", bell\.unreadCount\(\) > 0 \|\| expiredNames\.count > 0\);/);
  assert.match(popup, /every = \(await rt\.actions\.ownNamesAndOffers\(\{ heldOnly: true \}\)\.catch\(\(\) => null\)\)\?\.names \|\| held;/);
  assert.match(popup, /noteExpiredNames\(main, grace\.length\);/);
  assert.match(popup, /<span class="nav-row-expired">\$\{ICONS\.warning\}\$\{esc\(`\$\{expiredCount\} Expired`\)\}<\/span>/);
  assert.match(popup, /const domainCount = Math\.max\(s\.kachatCount \|\| 0, expiredCount\);/);
  assert.match(popup, /noteExpiredNames\(null, 0\);\n\s+bell\.useAccount\(null\);/, "locking clears it");
});

await check("a name in grace: \"Expired: Renew Before Grace Ends\" in a red pill, and a red status pill", () => {
  assert.match(live, /const EXPIRED_BADGE = "Expired: Renew Before Grace Ends";/);
  assert.match(live, /return status === Status\.grace \? EXPIRED_BADGE : "Available";/);
  assert.match(live, /\$\{ownBadgeHtml\(badge\(n\), "domain-badge"\)\}/);
  assert.match(live, /\$\{status === Status\.grace \? " kl-pill-expired" : ""\}/);
  assert.match(read("src/styles.css"), /\.kl-badge-warning \{[^}]*background: #ff3b30 !important;/);
});

await check("reminders for every name: the last call on the chatting address's too, and a week before grace ends", () => {
  assert.doesNotMatch(notifier, /bytesEqual/, "no longer only for a spending address's names");
  assert.match(notifier, /if \(!s\.lastCallNoted && now >= graceEndsAt - lastCallBefore\)/);
  assert.match(notifier, /\} else if \(!s\.weekNoted && grace > 2n \* WEEK_MS && now >= graceEndsAt - WEEK_MS\) \{\n\s+post\(`graceweek-/);
});

await check("a fresh payout: past every revealed slot, skipping kUSDT ones, checked on chain; the slot shown is the one reserved", () => {
  assert.match(wallet, /export async function nextSwapPayoutAddress\(\{ skip = \[\] \} = \{\}\)/);
  assert.match(wallet, /if \(\(await addressUsed\(address\)\) !== true\) return \{ index, address \};/);
  assert.match(wallet, /export async function reserveSwapPayoutAddress\(shown = null, \{ skip = \[\] \} = \{\}\)/);
  assert.match(wallet, /picked\.index > state\.maxIndex/, "a slot another window took isn't reserved twice");
  assert.match(swaps, /wallet\.reserveSwapPayoutAddress\(state\.nextPayout \|\| null, \{ skip: kusdtListedIndices\(\) \}\)/);
});

await check("Send refuses From = To (Compound UTXOs aside)", () => {
  assert.match(send, /const sendsToItself = \(\) => !opts\.compound && Boolean\(state\.recipient\?\.address\)/);
  assert.match(send, /!state\.fillingMax && !sendsToItself\(\);/);
  assert.match(send, /canContinue: \(\) => !\(state\.choosingFrom && isChattingSource\(\)\) && !sendsToItself\(\),/);
  assert.match(send, /const SENDS_TO_ITSELF = "This is the address the Kaspa is going to\. Choose another address to send from\.";/);
});

await check("full screen: sheets and panels in the centered column, not across the window", () => {
  const css = read("src/styles.css");
  assert.match(css, /body\.tab \.sheet-backdrop, body\.tab \.panel-backdrop, body\.tab \.kl-progress-backdrop \{ justify-content: center; \}/);
  assert.match(css, /body\.tab \.sheet, body\.tab \.panel, body\.tab \.kl-progress-backdrop > \* \{ width: 100%; max-width: 420px; \}/);
});

if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
