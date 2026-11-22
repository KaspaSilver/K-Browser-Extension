// How a .kachat name is written (K iOS KachatNameLabel): "alice.kachat", or "alice" with Settings >
// Customization > Show .kachat Endings off. On by default. The engine's NameInfo.display is pointed
// here once, as K's NameInfo.display goes through KachatNameLabel.display, so every screen that
// shows a held name (the marketplace, Your Domains, a name's page, the claims) follows the switch.

import { NameInfo } from "../shared/engine/kachat-names/registry-state.js";

const KEY = "kachat_show_name_endings";

export function showsKachatEndings() {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

export function setShowsKachatEndings(on) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* the default stays */ }
}

/** `name` as it's shown: with ".kachat" unless the switch is off. */
export function kachatLabel(name) {
  const bare = String(name ?? "");
  return showsKachatEndings() ? `${bare}.kachat` : bare;
}

try {
  Object.defineProperty(NameInfo.prototype, "display", { configurable: true, get() { return kachatLabel(this.name); } });
} catch { /* the engine's own form stays */ }
