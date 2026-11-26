// How a .kachat name is shown (K iOS KachatNameLabel, 522fd9f4): always bare, "alice", never
// "alice.kachat" (owner, 2026-11-26: the Show .kachat Endings switch is gone). Display only: typing,
// copying and anything sent keep working with either form (the codec strips the ending). The
// engine's NameInfo.display is pointed here once, as K's NameInfo.display goes through
// KachatNameLabel.display, so every screen that shows a held name (the marketplace, Your Usernames,
// a name's page, the claims) shows it bare.

import { NameInfo } from "../shared/engine/kachat-names/registry-state.js";

// the switch's old key, removed once: nothing reads it any more
try { localStorage.removeItem("kachat_show_name_endings"); } catch { /* nothing kept */ }

/** `name` as it's shown: bare. */
export function kachatLabel(name) {
  return String(name ?? "");
}

try {
  Object.defineProperty(NameInfo.prototype, "display", { configurable: true, get() { return kachatLabel(this.name); } });
} catch { /* the engine's own form stays */ }
