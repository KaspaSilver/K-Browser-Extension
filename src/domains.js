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
import { app, render, $, esc, toast, showAlert, ICONS, navHeader } from "./ui.js";
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

// Finish Transfer's progress, by the engine's stage names.
const STAGES = {
  "resolving-recipient": ["Preparing transfer", 0.1],
  "verifying-ownership": ["Preparing transfer", 0.1],
  committing: ["Submitting commit transaction", 0.3],
  committed: ["Waiting for the commit to settle", 0.55],
  revealing: ["Submitting reveal transaction", 0.8],
  revealed: ["Confirming the new owner", 0.95],
  verifying: ["Confirming the new owner", 0.95],
};

// --- Unfinished transfers (audit EXT-005) ----------------------------------------------------
// A transfer whose commit went out but whose reveal didn't (a closed popup, a refused reveal) is
// kept in storage; Finish Transfer reveals it with the key that sent it. Its 2 KAS are safe.

function pendingCardHtml(record) {
  return `
    <div class="glass pending-transfer">
      <div class="strong small">Unfinished transfer: ${esc(record.domain || "domain")}</div>
      <div class="muted tiny">To ${esc(wallet.shortAddress(record.recipient || ""))}. The commit was sent but the reveal didn't go through; your 2 KAS are safe.</div>
      <div class="pending-buttons"><button class="small-button" data-finish="${esc(record.assetId)}">Finish Transfer</button></div>
    </div>`;
}

/** Runs Finish Transfer for `record` on a progress screen, then calls `after`. */
async function finishTransfer(record, after) {
  const progress = (status) => {
    const [title, fraction] = STAGES[status] || ["Finishing transfer", 0.5];
    render(`
      <section class="screen progress-sheet">
        <h2 class="center-text">Finishing ${esc(record.domain || "transfer")}</h2>
        <div class="progress"><div class="progress-bar" style="width:${Math.round(fraction * 100)}%"></div></div>
        <p class="center-text">${esc(title)}</p>
        <p class="muted small center-text">Revealing the commit that was already sent. Keep this window open until it finishes.</p>
      </section>`, "send-domain-progress");
  };
  progress("revealing");
  try {
    const result = await wallet.finishDomainTransfer(record, ({ status }) => progress(status));
    if (result.status === "no-commit") {
      // only offered once the commit can't still be on its way, and its address read as empty
      if (!(await wallet.domainTransferForgettable(record))) {
        showAlert({
          title: "Commit Not Found Yet",
          message: "The commit for this transfer isn't showing on chain yet. It may still be on its way, so this transfer is kept. Try Finish Transfer again in a few minutes.",
        });
        after();
        return;
      }
      showAlert({
        title: "No Commit Found",
        message: "The commit for this transfer isn't on chain, so nothing was spent. If you just sent it, wait a minute and try again; otherwise you can forget this transfer.",
        confirmLabel: "Forget It", cancelLabel: "Keep",
        onConfirm: async () => { await wallet.discardDomainTransfer(record.assetId); after(); },
      });
      after();
      return;
    }
    toast(result.status === "already-transferred" ? `${record.domain} already belongs to the recipient.` : `${record.domain} transferred.`);
    if (result.revealTxid) showDomainSent({ txid: result.revealTxid, onDone: after });
    else after();
  } catch (error) {
    if (error?.code !== wallet.SEND_CANCELLED) toast(String(error?.message || error));
    after();
  }
}

// iOS SentConfirmationSheet for a domain transfer: the reveal transaction.
function showDomainSent({ txid, onDone }) {
  render(`
    <section class="screen sent">
      <div class="sent-check accent">${ICONS.checkBig}</div>
      <h2>Sent</h2>
      <a class="mono small break link-button" href="${esc(wallet.explorerTxUrl(txid))}" target="_blank" rel="noopener noreferrer">${esc(txid)}</a>
      <p class="muted small center-text">Tap the transaction to open it in the explorer.</p>
      <div class="spacer"></div>
      <button id="done" class="big">Done</button>
    </section>`, "sent");
  $("#done").onclick = onDone;
}
