// An address's Usernames page (K iOS 518fdc8c, "Usernames" since 2026-11-24): on the chatting
// address, a spending address and a KasSigner address, the .kachat names this address holds, as
// cards opening their detail screens. .kachat is the only name service K reads (owner, 2026-11-23),
// so there are no per-service cards any more.

import { addressNamesTab, showLiveNameDetail } from "./kachat-live.js";

/** The page's body for `address`: `{ html, bind(container, back) }`, loading on its own. */
export function addressDomainsTab({ address, repaint }) {
  const tab = addressNamesTab({ address, repaint });
  return {
    html: tab.html,
    bind(container, back) {
      tab.bind(container, { openName: (info) => showLiveNameDetail({ info, onBack: back }) });
    },
  };
}
