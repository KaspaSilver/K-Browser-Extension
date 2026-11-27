// .kachat names are never shown with their ending (K iOS 522fd9f4, owner 2026-11-26): the Show
// .kachat Endings switch is gone, every screen and alert shows "alice", and the Usernames screen's
// header and title read Usernames (the ".kachat" wordmark is gone). Typing and the Address Book's
// "Use Their Username" keep working with either form.
// Run: node tools/test-bare-names.mjs
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); passed += 1; console.log(`ok - ${name}`); } catch (error) { failures.push(`${name}: ${error?.stack || error}`); }
}

const sources = readdirSync(new URL("src/", root)).filter((f) => f.endsWith(".js")).map((f) => [f, read(`src/${f}`)]);
// code lines only: comments may still talk about the ending
const codeOf = (text) => text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join("\n");

check("kachatLabel shows the bare name, and the old switch's key is cleared", () => {
  const src = read("src/kachat-label.js");
  assert.match(src, /export function kachatLabel\(name\) \{\n\s+return String\(name \?\? ""\);\n\}/);
  assert.match(src, /localStorage\.removeItem\("kachat_show_name_endings"\)/);
  assert.doesNotMatch(src, /showsKachatEndings|setShowsKachatEndings/);
});

check("Settings > Customization has no Show .kachat Endings switch", () => {
  const src = read("src/settings.js");
  assert.doesNotMatch(src, /Show \.kachat Endings|kachat-endings|showsKachatEndings/);
});

check("no screen or alert writes a name with \".kachat\" after it", () => {
  for (const [file, text] of sources) {
    assert.doesNotMatch(codeOf(text), /\$\{[^}]+\}\.kachat|`\$\{[\w.]+\}\.kachat`/, file);
  }
});

check("the tiles and the search field have no ending, and the wordmark is gone", () => {
  const live = read("src/kachat-live.js");
  assert.doesNotMatch(live, /kl-tile-suffix/);
  const market = read("src/market.js");
  assert.doesNotMatch(market, /km-search-suffix/);
  for (const [file, text] of sources) assert.doesNotMatch(text, /kachatWordmark/, file);
});

check("Usernames: the marketplace's title and header, and the dock label", () => {
  const market = read("src/market.js");
  assert.match(market, /<div class="nav-title">Usernames<\/div>/);
  assert.match(market, /<div class="km-usernames-title">Usernames<\/div>/);
  assert.match(read("src/dock.js"), /\["kachat", "Usernames"\]/);
  // an address with no names shows the @ symbol
  assert.match(read("src/kachat-live.js"), /<span class="accent kachat-address-at">\$\{SYMBOLS\.at\}<\/span>\n\s+<div class="strong">No usernames on this address<\/div>/);
});

check("a typed name with or without the ending still resolves; Use Their Username fills it in bare (K iOS 824a30bb)", () => {
  assert.match(read("src/names.js"), /endsWith\("\.kachat"\)\) return \{ label: trimmed\.slice\(0, -"\.kachat"\.length\), tld: "kachat" \}/);
  assert.match(read("src/address-book.js"), /return String\(r\.domain \|\| ""\)\.trim\(\)\.replace\(\/\\\.kachat\$\/i, ""\) \|\| null;/);
});

if (failures.length) {
  console.error(`\n${failures.length} failed:\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
