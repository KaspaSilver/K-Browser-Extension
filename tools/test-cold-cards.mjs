// Cold Storage on address cards (K iOS b49a021d ColdStorageView, d88891ea; K-Desktop 9024bfe, its
// audit fixes 0222137 and the Cold Storage part of c8e775a): each account on Manage Addresses' card
// (lock and name, the red trash, its balance and worth, Copy kpub, kpub QR, Rename in place, Alerts
// On / Off, Tap to View Addresses); inside an account the Total Balance card and an address card
// each, Discover Addresses and Address Visibility at the top right, the floating + for Regular or
// Quantum-Protected; an address's page with the full address and no Send / Receive bar; the kpub QR
// in the receive screens' look. Source checks, and the card helper evaluated.
// Run: node tools/test-cold-cards.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); } catch (error) { failures.push(`${name}: ${error?.stack || error}`); }
}

const cold = read("src/cold.js");
const css = read("src/cold.css");
const manage = read("src/manage.js");
const between = (from, to) => {
  const start = cold.indexOf(from);
  assert.ok(start >= 0, `missing ${from}`);
  const end = cold.indexOf(to, start);
  assert.ok(end > start, `missing ${to} after ${from}`);
  return cold.slice(start, end);
};
const list = between("export function showColdStorage()", "\nfunction copyKpub(");
const account = between("function showAccount({ accountId, onBack })", "// SCREEN 3 - Address Visibility");
const address = between("function showAddress({ accountId, entry,", "\n  paint();\n  wallet.utxoLabels(address)");
const kpubQr = between("async function showKpubQr({ account, onBack })", "// SCREEN 2 -");

// the card helper, evaluated as manage.js has it
const cardSource = manage.slice(manage.indexOf("export function quantumTagHtml"), manage.indexOf("// SF Symbols these screens use"));
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// eslint-disable-next-line no-new-func
const { managedAddressCardHtml } = new Function("esc", "SF", `${cardSource.replace(/export /g, "")}; return { managedAddressCardHtml };`)(esc, { ellipsisV: "<svg/>" });

check("the card helper: a lock before the name, a corner button, no Used / Unused and its own footer, for an account's card", () => {
  const html = managedAddressCardHtml({
    attrs: 'data-open="a1"', leadHtml: '<span class="cold-card-lock">L</span>', name: "Vault", cornerHtml: '<button data-remove>T</button>',
    amountHtml: "2.00000000 KAS", showsUsage: false, footer: "Tap to View Addresses",
    buttons: [{ action: "copy", icon: "copy", title: "Copy kpub" }, { action: "qr", icon: "qr", title: "kpub QR" }, { action: "alerts", icon: "bell", title: "Alerts On" }, { action: "alerts", icon: "bellSlash", title: "Alerts Off" }],
  });
  assert.match(html, /<div class="ac-head"><span class="cold-card-lock">L<\/span><span class="ac-name">Vault<\/span><button data-remove>T<\/button><\/div>/);
  assert.doesNotMatch(html, /ac-usage/, "no Used / Unused on an account");
  assert.match(html, /Tap to View Addresses/);
  assert.doesNotMatch(html, /Tap to View History|undefined/, "every icon drawn");
});

check("the card helper: unchanged for Manage Addresses and Manage kUSDT (no new option given)", () => {
  const html = managedAddressCardHtml({ attrs: 'data-open="3"', name: "Savings", menuAttr: 'data-menu="3"', amountHtml: "1 KAS", used: false, buttons: [] });
  assert.match(html, /<div class="ac-head"><span class="ac-name">Savings<\/span><button type="button" class="icon plain ac-menu" data-menu="3" aria-label="More for Savings"><svg\/><\/button><\/div>/);
  assert.match(html, /<span class="ac-usage unused">Unused<\/span>/);
  assert.match(html, /<div class="ac-history">Tap to View History</);
});

check("the list: each account on the card - lock, name, red trash, balance, worth, Copy kpub, kpub QR, Rename, Alerts On / Off, Tap to View Addresses; no ⋮", () => {
  assert.match(list, /leadHtml: `<span class="accent cold-card-lock" aria-hidden="true">\$\{SF\.lockFill\}<\/span>`/);
  assert.match(list, /class="icon plain cold-card-corner cold-card-trash" data-remove aria-label="Remove Cold Storage Account"/);
  assert.match(list, /\{ action: "copy", icon: "copy", title: "Copy kpub" \},\n\s+\{ action: "qr", icon: "qr", title: "kpub QR" \},\n\s+\{ action: "rename", icon: "rename", title: "Rename" \},\n\s+\{ action: "alerts", icon: alertsOn \? "bell" : "bellSlash", title: alertsOn \? "Alerts On" : "Alerts Off" \},/);
  assert.match(list, /showsUsage: false,/);
  assert.match(list, /footer: "Tap to View Addresses",/);
  assert.match(list, /worth: total == null \? "" : fiatTextFor\(total, repaint\)/);
  assert.doesNotMatch(cold, /data-more|aria-label="Account actions"|label: "Turn (On|Off) Receive Notifications"/, "the actions sheet is gone");
  for (const icon of ["qr", "bell", "bellSlash"]) assert.match(manage, new RegExp(`\\n  ${icon}: '<svg`), `CARD_ICONS.${icon}`);
});

check("the list: the trash asks first; Alerts toggles the bell's receipts with K's toasts", () => {
  assert.match(list, /title: "Remove Cold Storage Account\?",\n\s+message: "This only removes it from K's watch list\. It has no effect on the KasSigner device or any funds it holds\.",/);
  assert.match(list, /onConfirm: async \(\) => \{\n\s+try \{ await removeColdAccount\(account\.id\); \}/);
  assert.match(list, /const on = account\.notifyOnReceive === false;\n\s+const changed = await updateAccount\(account\.id, \(a\) => \{ a\.notifyOnReceive = on; \}\);/);
  assert.match(list, /"You'll be notified when this account receives Kaspa\." : "No more notifications when this account receives Kaspa\."/);
  assert.match(cold, /if \(account\.notifyOnReceive === false\) continue;/, "coldWatchAddresses honours it");
});

check("the list: the balance - the last known at once, then live, kept as the last known; a failed read keeps what's shown", () => {
  const totals = between("async function loadAccountTotals(accounts, repaint)", "export function showColdStorage()");
  assert.match(totals, /known\[e\.address\] != null \? BigInt\(known\[e\.address\]\)/);
  assert.match(totals, /balances = await wallet\.balancesFor\(entries\.map\(\(e\) => e\.address\)\)/);
  assert.match(totals, /if \(!accountTotals\.has\(account\.id\)\) accountTotals\.set\(account\.id, null\);/);
  assert.match(totals, /keepKnownBalances\(entries\.map\(\(e\) => e\.address\)\);/);
  assert.match(list, /total === undefined \? '<span class="spinner small-spin"><\/span>' : total === null \? '<span class="muted">—<\/span>'/);
});

check("renames in place save once, when they end; an emptied account name keeps the old one; screens wait while one is typed", () => {
  assert.match(cold, /import \{ startInlineRename, inlineRenameActive \} from "\.\/inline-rename\.js";/);
  const renameAccount = between("function renameAccount(account, card)", "// The card's trash, after asking");
  assert.match(renameAccount, /key: `cold-account:\$\{account\.id\}`/);
  assert.match(renameAccount, /if \(!name \|\| name === account\.label\) return;/);
  assert.doesNotMatch(cold, /title: "Rename (Account|Address)"/, "no pop-up");
  assert.match(account, /startInlineRename\(app\.querySelector\(`\.managed-card\[data-open="\$\{entry\.index\}"\]`\), \{\n\s+key: `cold:\$\{accountId\}:\$\{entry\.address\}`/);
  assert.match(account, /if \(clean\) a\.labels\[at\] = clean; else delete a\.labels\[at\];/, "empty goes back to the default");
  assert.equal((cold.match(/if \(inlineRenameActive\(\)\) return;/g) || []).length, 2, "the list and the account screen");
  assert.match(read("src/inline-rename.js"), /if \(!cancelled && input\.value !== current\)/, "Escape keeps the old name");
});

check("an account: the Total Balance card, Discover Addresses and Address Visibility at the top right, the floating + asks Regular or Quantum-Protected", () => {
  assert.match(account, /<button class="bar-circle" id="discover" aria-label="Discover Addresses"/);
  assert.match(account, /<button class="bar-circle" id="visibility" aria-label="Address Visibility"/);
  assert.match(account, /<button class="fab" id="new-address" aria-label="New Address"/);
  assert.match(account, /label: "Regular Address", subtitle: "Reveals the next unused address in this account\.", icon: SF\.plusCircle, onClick: generate/);
  assert.match(account, /label: "Quantum-Protected Address", subtitle: "Scan a KCC-3 address from KasSigner's address screen\.", icon: SF\.shield, onClick: addQuantum/);
  assert.match(account, /\$\{state\.discovery \? `<div class="cold-discovery" id="cold-discovery" role="status">/, "Discover's progress line under the Total");
  assert.doesNotMatch(account, /addressActionsFabHtml|id="remove"|id="rename-account"|Copy kpub|Address Actions/, "the account's own actions live on its list card");
});

check("an account: address cards - quantum tag, Used / Unused, Copy, Send, Receive, Rename; a regular one's top right hides it, a quantum one keeps the ⋮", () => {
  assert.match(account, /\{ action: "copy", icon: "copy", title: "Copy" \},\n\s+\{ action: "send", icon: "send", title: "Send", disabled: !\(entry\.balanceSompi > 0n\) \},\n\s+\{ action: "receive", icon: "receive", title: "Receive" \},\n\s+\{ action: "rename", icon: "rename", title: "Rename" \},/);
  assert.match(account, /menuAttr: entry\.quantum \? `data-menu="\$\{entry\.index\}"` : null,/);
  assert.match(account, /cornerHtml: entry\.quantum \? "" : `<button type="button" class="icon plain cold-card-corner" data-hide="\$\{entry\.index\}" aria-label="Hide Address"/);
  const menu = between("const quantumActions = (entry) => showSheet({", "const addQuantum = ");
  assert.match(menu, /label: "Hide Address"[\s\S]*label: "Edit Address Number"[\s\S]*label: "Stop Watching"/);
  assert.doesNotMatch(menu, /Rename Address|Copy Address|Show QR Code|Send to Chatting Address/);
  assert.match(account, /if \(entry\.balanceSompi > 0n\) \{ toast\("An address holding Kaspa stays on the list\."\);/);
  assert.match(account, /bindSwipeToHide\(wrap, \{ onHide: \(\) => hideAddress\(byIndex\(wrap\.dataset\.swipe\)\) \}\)/);
});

check("an account: unused first, newest first, then used in number order; regular before quantum in each", () => {
  const sort = between("const shownEntries = () =>", "async function load()");
  const body = sort.slice(sort.indexOf(".sort("));
  // eslint-disable-next-line no-new-func
  const comparator = new Function("isUsed", `return ${body.slice(".sort(".length, body.lastIndexOf(");"))};`);
  const used = new Set([1, 3]);
  const cmp = comparator((e) => used.has(e.index));
  const rows = [0, 1, 2, 3, 4, 1_000_000, 1_000_001].map((index) => ({ index, quantum: index >= 1_000_000 }));
  assert.deepEqual([...rows].sort(cmp).map((r) => r.index), [4, 2, 0, 1_000_001, 1_000_000, 1, 3]);
});

check("an address's page: the full address on its card, no Send / Receive bar", () => {
  assert.match(address, /balanceCardHtml\(\{ label: title, sompi: total, fiatText: fiatTextFor\(total, repaintIfHere\), address \}\)/);
  assert.doesNotMatch(address, /id="send"|id="receive"|ios-bottom-bar/);
  assert.match(address, /const openSend = \(compound\) => openColdSendFrom\(\{/, "Compound still sends from it");
});

check("the kpub QR: the receive screens' look, \"Watch This Account\", never the kpub as text", () => {
  assert.match(kpubQr, /<section class="rcv cold-kpub-page" id="qr-page"/);
  assert.match(kpubQr, /<h2>Watch This Account<\/h2>/);
  assert.match(kpubQr, /Watch-only\. This cannot spend, but it reveals every address in this account\./);
  assert.match(kpubQr, /Scan it into another device to watch this account there\./);
  assert.match(kpubQr, /Whoever scans it sees every address, balance and payment of this account\. Show it only to devices you trust\./);
  assert.match(kpubQr, /QRCode\.toCanvas\(\$\("#qr"\), account\.kpub, \{ errorCorrectionLevel: "L"/);
  assert.doesNotMatch(kpubQr, /esc\(account\.kpub\)|\$\{account\.kpub\}/);
  assert.match(css, /\.cold-kpub-icon \{/);
});

check("a background read never replaces what an action writes with: the key comes with the list, one write at a time, each read fresh", () => {
  assert.match(cold, /async function readStore\(\) \{\n\s+const key = await storageKey\(\);[\s\S]*return \{ key, accounts \};/);
  assert.doesNotMatch(cold, /store\.key|const \{ key \} = store/);
  const change = between("function changeAccounts(change)", "async function getAccount(id)");
  assert.match(change, /const run = writing\.then\(async \(\) => \{\n\s+const \{ key, accounts \} = await readStore\(\);/);
  assert.match(change, /writing = run\.catch\(\(\) => \{\}\);/);
  for (const fn of ["async function updateAccount(", "function importAccount(", "async function removeColdAccount(", "async function addQuantumAddress(", "async function unhideFundedAddresses("]) {
    const at = cold.indexOf(fn);
    assert.ok(at >= 0, fn);
    assert.match(cold.slice(at, cold.indexOf("\n}\n", at)), /changeAccounts\(/, `${fn} writes through changeAccounts`);
  }
  assert.match(account, /const hideAddress = async \(entry\) => \{[\s\S]*?const account = await getAccount\(accountId\);/, "Hide looks the account up again");
  assert.match(cold, /const quantumAddress = isColdQuantumIndex\(index\) \?[\s\S]*?const at = quantumAddress \? quantumIndexOf\(a\.quantumAddresses, quantumAddress\) : index;/, "a quantum hide files under its index as the write lands");
  assert.equal((cold.match(/state\.account = await getAccount\(accountId\);\n\s+if \(!state\.account\) \{ onDone\(\); return; \}/g) || []).length, 2, "Address Visibility's two toggles");
});

check("an address holding Kaspa is never out of sight: shown, un-hidden for good, and counted in the Total", () => {
  assert.match(account, /\.filter\(\(e\) => !e\.hidden \|\| e\.balanceSompi > 0n\)/);
  assert.match(account, /await unhideFundedAddresses\(accountId, entries\)/);
  assert.match(cold, /await unhideFundedAddresses\(account\.id, entries\);/, "the list's read too");
  assert.match(account, /const unread = all\.some\(\(e\) => e\.balanceSompi == null\);\n\s+const total = unread \? null : all\.reduce\(\(sum, e\) => sum \+ e\.balanceSompi, 0n\);/);
  const unhide = between("async function unhideFundedAddresses(", "/** iOS revealAddress");
  assert.match(unhide, /e\.balanceSompi != null && e\.balanceSompi > 0n/, "an unread balance never counts");
  assert.match(unhide, /currentIndexOf\(a, e\)/);
});

check("a price that lands late repaints only the screen it was for", () => {
  assert.match(list, /const here = \(\) => app\.dataset\.screen === "cold:list";\n\s+const repaint = \(\) => \{ if \(here\(\)\) paint\(\); \};/);
  assert.doesNotMatch(cold, /fiatTextFor\([^)]*, paint\)/);
});

if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
