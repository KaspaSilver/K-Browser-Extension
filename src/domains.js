// Your Usernames - K iOS 518fdc8c (YourDomainsCard, "Your Usernames" since 2026-11-23): the
// account's .kachat names (KachatLiveDomainsTab), empty as "No usernames yet", with Claim a
// Username pinned under the list (the .kachat tab's marketplace).
//
// .kachat is the only name service K reads since 5.4 (owner, 2026-11-23): the .kas, .k and .kaspa
// cards, the .kas detail (Set as Primary) and Send Domain are gone. A .kas transfer started before
// then whose reveal never went out still shows here as "Unfinished transfer" with Finish Transfer
// (iOS KNSRevealRecovery), until no such record is left.

import { remember, selectTab } from "./dock.js";
import * as wallet from "./wallet.js";
import { app, render, $, esc, toast, showAlert, navHeader } from "./ui.js";
import { showLiveNameDetail } from "./kachat-live.js";
// the .kachat list, started from the names saved last time (iOS f4f5c0f)
import { ownedDomainsTab } from "./kachat-owned-cache.js";

export function showDomains({ address, onBack }) {
  const state = { pending: [] };
  const here = () => app.dataset.screen === "domains";
  const back = () => showDomains({ address, onBack });
  const loadPending = () => wallet.pendingDomainTransfers()
    .then((pending) => { state.pending = pending; if (here()) paint(); })
    .catch(() => {});

  const paint = () => {
    const liveTab = ownedDomainsTab(address, () => { if (here()) paint(); });
    render(`
      ${navHeader({ title: "Your Usernames" })}
      <section class="screen domains" id="domains-body">${state.pending.map(pendingCardHtml).join("")}${liveTab.html}</section>
      ${liveTab.showsInscribe ? '<div class="get-domain-bar"><button class="get-domain" id="inscribe">Claim a Username</button></div>' : ""}`, "domains");
    remember(() => paint());
    $("#back").onclick = onBack;
    for (const b of app.querySelectorAll("[data-finish]")) {
      b.onclick = () => {
        const record = state.pending.find((r) => r.assetId === b.dataset.finish);
        if (record) finishTransfer(record, () => { loadPending(); back(); });
      };
    }
    liveTab.bind(app, { openName: (info) => showLiveNameDetail({ info, onBack: back }) });
    // Claim a Username (K iOS 518fdc8c): the .kachat tab's marketplace; a new name shows here on the
    // way back (the registry refreshes)
    const inscribe = $("#inscribe");
    if (inscribe) inscribe.onclick = () => selectTab("kachat");
  };

  paint();
  loadPending();
}

// --- Unfinished transfers (audit EXT-005) ----------------------------------------------------
// A transfer whose commit went out but whose reveal didn't (a closed popup, a refused reveal) is
// kept in storage; Finish Transfer reveals it with the key that sent it. Its 2 KAS are safe.
// A reveal that went out keeps its record until later looks find the commit spent, since the
// mempool can still drop it (K-Desktop 522623c, audit 2026-11-25 #18): that card only waits, and
// the Wallet tab's recovery clears it (or sends the reveal again).

function pendingCardHtml(record) {
  if (record.status === "reveal-sent") {
    return `
    <div class="glass pending-transfer">
      <div class="strong small">Transfer finishing: ${esc(record.domain || "domain")}</div>
      <div class="muted tiny">To ${esc(wallet.shortAddress(record.recipient || ""))}. The reveal was sent and is waiting for a block; your 2 KAS come back with it. This clears on its own.</div>
    </div>`;
  }
  return `
    <div class="glass pending-transfer">
      <div class="strong small">Unfinished transfer: ${esc(record.domain || "domain")}</div>
      <div class="muted tiny">To ${esc(wallet.shortAddress(record.recipient || ""))}. The commit was sent but the reveal didn't go through; your 2 KAS are safe.</div>
      <div class="pending-buttons"><button class="small-button" data-finish="${esc(record.assetId)}">Finish Transfer</button></div>
    </div>`;
}

/** Runs Finish Transfer for `record` on a progress screen, then calls `after`. */
async function finishTransfer(record, after) {
  render(`
    <section class="screen progress-sheet">
      <h2 class="center-text">Finishing ${esc(record.domain || "transfer")}</h2>
      <div class="progress"><div class="progress-bar" style="width:80%"></div></div>
      <p class="center-text">Submitting reveal transaction</p>
      <p class="muted small center-text">Revealing the commit that was already sent. Keep this window open until it finishes.</p>
    </section>`, "send-domain-progress");
  try {
    // K-Desktop d570abd kns-reveal-recovery.js: "revealed" | "settled" | "waiting"
    const outcome = await wallet.finishDomainTransfer(record);
    if (outcome === "waiting") {
      showAlert({
        title: "Not Finished Yet",
        message: "The commit for this transfer couldn't be revealed right now. It's kept, and K tries again on its own while the wallet is open. You can also try Finish Transfer again in a few minutes.",
      });
    } else {
      toast(outcome === "revealed" ? `${record.domain || "The transfer"} finished.` : `${record.domain || "The transfer"} was already finished.`);
    }
  } catch (error) {
    if (error?.code !== wallet.SEND_CANCELLED) toast(String(error?.message || error));
  }
  after();
}
