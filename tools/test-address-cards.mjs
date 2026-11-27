// Address cards in Manage Addresses and Manage kUSDT (K iOS 824a30bb ManagedAddressCard, K-Desktop
// d1d0d07 / 0dc7311): each address on a card like the Total Balance card, with Copy, Send, Receive
// and Rename (not the Chatting Address) and Tap to View History; the ⋮ keeps Send to Chatting
// Address and Hide (and Combine Coins for kUSDT); Address Visibility and Discover at the top right;
// the floating + asks Regular or Quantum-Protected (Manage kUSDT's adds a fresh regular address);
// history pages show the full address and have no Send / Receive unless a notification opened
// them. Use Their Username fills in the bare name. Source checks only.
// Run: node tools/test-address-cards.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); } catch (error) { failures.push(`${name}: ${error?.stack || error}`); }
}

const manage = read("src/manage.js");
const kusdt = read("src/kusdt-screens.js");

// the card itself, evaluated
const cardSource = manage.slice(manage.indexOf("export function quantumTagHtml"), manage.indexOf("// SF Symbols these screens use"));
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SF = { ellipsisV: "<svg/>" };
// eslint-disable-next-line no-new-func
const { quantumTagHtml, managedAddressCardHtml } = new Function("esc", "SF", `${cardSource.replace(/export /g, "")}; return { quantumTagHtml, managedAddressCardHtml };`)(esc, SF);

check("the quantum tag: green until a quantum address spends, orange when it spent with funds on it, gray otherwise", () => {
  assert.match(quantumTagHtml({ quantum: true }), /class="quantum-tag safe">Quantum Protected</);
  assert.match(quantumTagHtml({ quantum: true, spent: true, funded: true }), /class="quantum-tag warn">Not Quantum Protected</);
  assert.match(quantumTagHtml({ quantum: true, spent: true }), /class="quantum-tag plain">Not Quantum Protected</);
  assert.match(quantumTagHtml(), /class="quantum-tag plain">Not Quantum Protected</, "a regular address, the Chatting Address too");
});

check("the card: name, tag, ⋮, the balance, its worth, Used / Unused / Checking, the buttons, Tap to View History", () => {
  const html = managedAddressCardHtml({
    attrs: 'data-open="3"', name: "Savings", tagHtml: quantumTagHtml(), menuAttr: 'data-menu="3"',
    amountHtml: "1.00000000 KAS", worth: "$0.05", used: false,
    buttons: [{ action: "copy", icon: "copy", title: "Copy" }, { action: "send", icon: "send", title: "Send", disabled: true }],
  });
  assert.match(html, /<div class="managed-card" data-open="3" role="button" tabindex="0">/);
  assert.match(html, /<span class="ac-name">Savings<\/span><span class="quantum-tag plain">/);
  assert.match(html, /data-menu="3" aria-label="More for Savings"/);
  assert.match(html, /<div class="ac-amount">1\.00000000 KAS<\/div>/);
  assert.match(html, /<div class="ac-worth">\$0\.05<\/div>/);
  assert.match(html, /<span class="ac-usage unused">Unused<\/span>/);
  assert.match(html, /data-card-action="send" disabled>/);
  assert.match(html, /Tap to View History/);
  assert.doesNotMatch(html, /kaspa:/, "the address itself isn't on the card");
  assert.match(managedAddressCardHtml({ attrs: "", name: "x", amountHtml: "", used: null, buttons: [] }), /ac-usage checking">Checking/);
  assert.doesNotMatch(managedAddressCardHtml({ attrs: "", name: "x", amountHtml: "", buttons: [] }), /data-menu/, "no ⋮ without a menu");
});

check("Manage Addresses: Copy / Send / Receive / Rename on a spending card, no Rename on the Chatting Address; the ⋮ keeps Send to Chatting Address and Hide", () => {
  assert.match(manage, /\{ action: "copy", icon: "copy", title: "Copy" \},\n\s+\{ action: "send", icon: "send", title: "Send", disabled: !\(row\.balanceSompi > 0n\) \},\n\s+\{ action: "receive", icon: "receive", title: "Receive" \},\n\s+\{ action: "rename", icon: "rename", title: "Rename" \},/);
  const chatting = manage.slice(manage.indexOf("const chattingCard = state.chatting ? managedAddressCardHtml({"), manage.indexOf('}) : "";', manage.indexOf("const chattingCard")));
  assert.doesNotMatch(chatting, /rename|menuAttr/);
  const menu = manage.slice(manage.indexOf("const rowActions = (row) => {"), manage.indexOf("/** A card's own buttons"));
  assert.match(menu, /label: "Send to Chatting Address"/);
  assert.match(menu, /label: "Hide Address"/);
  assert.doesNotMatch(menu, /Rename Address|Copy Address|Show QR Code/);
});

check("Manage Addresses: Discover and Address Visibility at the top right; the + asks Regular or Quantum-Protected", () => {
  assert.match(manage, /id="discover" aria-label="Discover Addresses"/);
  assert.match(manage, /id="visibility" aria-label="Address Visibility"/);
  assert.match(manage, /id="new-address" aria-label="New Address"/);
  assert.match(manage, /label: "Regular Address", subtitle: "Like Receive gives you\. Works with everything, kUSDT included\."/);
  assert.match(manage, /label: "Quantum-Protected Address", subtitle: "Keeps its key hidden until it spends\. kUSDT can't be sent to or received on it\."/);
  assert.doesNotMatch(manage, /title: "Address Actions",\n\s+cancel: false,\n\s+rows: state\.discovery/);
});

check("an address's page: the full address on its card; Send / Receive only when a notification opened it", () => {
  assert.match(read("src/ui.js"), /\$\{address \? `<div class="bal-card-address mono selectable">\$\{esc\(address\)\}<\/div>` : ""\}/);
  assert.match(manage, /function showSpendingAddress\(\{ row, onBack, showsSendReceive = false \}\)/);
  assert.match(manage, /if \(row\) showSpendingAddress\(\{ row, onBack, showsSendReceive: true \}\);/, "a notification's page keeps them");
  assert.match(manage, /showManageAddress\(\{ address: state\.chatting\.address, onBack: back, onChangeIdentity, showsSendReceive: false \}\);/);
  assert.match(manage, /const showsSendReceive = opts\.showsSendReceive !== false;/);
  assert.match(kusdt, /function openAddressPage\(id, \{ onBack, showsSendReceive = false \}\)/);
  assert.match(kusdt, /<div class="bal-card-address mono selectable">\$\{esc\(h\.address\)\}<\/div>/);
});

check("Manage kUSDT: the same card, no quantum tag, no Rename on the Chatting Address; the ⋮ holds Send to Chatting Address, Combine Coins and Hide", () => {
  assert.match(kusdt, /import \{ managedAddressCardHtml \} from "\.\/manage\.js";/);
  const row = kusdt.slice(kusdt.indexOf("const rowHtml = (h) => {"), kusdt.indexOf("const paint = () => {", kusdt.indexOf("const rowHtml = (h) => {")));
  assert.doesNotMatch(row, /tagHtml/);
  assert.match(row, /\.\.\.\(chatting \? \[\] : \[\{ action: "rename", icon: "rename", title: "Rename" \}\]\),/);
  assert.match(kusdt, /const hasMenu = \(h\) => h\.spendingIndex != null \|\| h\.coinCount > 1;/, "the Chatting Address's ⋮ only for Combine Coins");
  const menu = kusdt.slice(kusdt.indexOf("const rowMenu = (id) => {"), kusdt.indexOf("const rename = (h) =>"));
  assert.match(menu, /label: "Send to Chatting Address"/);
  assert.match(menu, /label: "Combine Coins"/);
  assert.match(menu, /label: "Hide Address"/);
  assert.doesNotMatch(menu, /Rename Address|Copy Address|Show QR Code/);
  assert.match(kusdt, /id="kusdt-visibility"/);
  assert.match(kusdt, /\$\("#kusdt-new"\)\.onclick = generate;/, "the + adds a fresh regular address");
});

check("Use Their Username fills in the bare name", () => {
  const book = read("src/address-book.js");
  assert.match(book, /return String\(r\.domain \|\| ""\)\.trim\(\)\.replace\(\/\\\.kachat\$\/i, ""\) \|\| null;/);
});

if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
