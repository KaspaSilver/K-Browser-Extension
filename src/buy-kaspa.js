// The Wallet's Buy (K iOS 824a30bb BuyKaspaSheet, as K-Desktop 31f8c41 openBuyKaspa has it): Buy
// Kaspa with Crypto or with Debit Card on mainnet; elsewhere Buy goes straight to crypto (Trestly
// sells by card on mainnet only).
//
// Buy Kaspa with Debit Card (K bc0e6ba9 / 6d1971c8, K-Desktop 31f8c41): K runs Trestly's buy page
// inside the app and signs its one USDC permit as the buyer's Ethereum wallet. The extension, like
// Desktop, embeds no sites, so the page opens in a new tab and the buyer's own Ethereum wallet signs
// there. What K's first step asks stays: "Where should your kUSDT land?", Fresh Address (the
// default: the next regular address, kept apart from your username and chats) or the Chatting
// Address. That address is copied before the tab opens, to paste into Trestly's Kaspa address field.
// Once the kUSDT is in, Buy Kaspa with kUSDT trades it for KAS.

import { showSheet, toast } from "./ui.js";
import { ext } from "./browser.js";
import * as wallet from "./wallet.js";
import * as vault from "./vault.js";
import { kusdtListedIndices } from "./kusdt.js";
import { IS_TESTNET } from "./net.js";
import { NETWORK_ID } from "../shared/engine/network.js";
import { kusdtDeployment } from "../shared/engine/kusdt.js";

const line = (body) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  // bitcoinsign.circle / creditcard / sparkles / bubble.left.and.bubble.right
  crypto: line('<circle cx="12" cy="12" r="9"/><path d="M9.5 7.5v9M9.5 8h3.8a2 2 0 0 1 0 4H9.5h4.3a2 2 0 0 1 0 4H9.5M11 6v2M11 16v2"/>'),
  card: line('<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6 14.5h4"/>'),
  fresh: line('<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),
  chatting: line('<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4 4v-4h0A2 2 0 0 1 4 14Z"/>'),
};

const openBuySell = (start) => import("./swaps.js").then((m) => m.showSwap({ start }));

/** Buy: with Crypto (Buy/Sell's steps) or with Debit Card (Trestly's page), on mainnet. */
export function openBuyKaspa() {
  if (IS_TESTNET) { openBuySell("buy"); return; }
  showSheet({
    title: "Buy Kaspa",
    rows: [
      { label: "Buy Kaspa with Crypto", subtitle: "Pay with another coin, like kUSDT or Bitcoin.", icon: ICON.crypto, onClick: () => openBuySell("buy") },
      { label: "Buy Kaspa with Debit Card", subtitle: "Pay by card on Trestly's site. It lands as kUSDT, then you buy Kaspa with it.", icon: ICON.card, onClick: () => { openDebitCardBuy(); } },
    ],
  });
}

/** Trestly's buy page for this network (trestly.io on mainnet); only an https site is opened. */
export function trestlyBuyUrl() {
  try {
    const u = new URL(kusdtDeployment(NETWORK_ID).siteUrl);
    return u.protocol === "https:" ? `${u.origin}/buy` : "https://trestly.io/buy";
  } catch { return "https://trestly.io/buy"; }
}

/** "Where should your kUSDT land?", then the address copied and Trestly's /buy in a new tab. */
export async function openDebitCardBuy() {
  const accountId = (await vault.readAccounts()).activeAccountId;
  const owner = (await wallet.cachedAddresses(accountId))?.main || "";
  if (!owner) return;
  // the next regular address that has never been used (a swap payout's slot: never a quantum one,
  // nor one holding kUSDT, and checked on chain - K-Desktop 76d4a7f), shown before it's handed out
  const fresh = await wallet.nextSwapPayoutAddress({ skip: kusdtListedIndices() }).catch(() => null);
  const rows = [
    fresh?.address ? { label: "Fresh Address", subtitle: "A new address that has never been used, so this purchase stays apart from your username and chats.", icon: ICON.fresh, onClick: () => { handOut("fresh"); } } : null,
    { label: "Chatting Address", subtitle: "The address you chat from.", icon: ICON.chatting, onClick: () => { handOut("chatting"); } },
  ].filter(Boolean);
  showSheet({
    title: "Where should your kUSDT land?",
    headerHtml: '<p class="muted tiny pad-x">Trestly\'s buy page opens in a new tab. Its card payment buys USDC into your own Ethereum wallet, which signs once, and Trestly\'s bridge sends it to this address as kUSDT. The address is copied for you to paste there.</p>',
    rows,
  });

  async function handOut(choice) {
    // an account switched meanwhile does nothing
    if ((await vault.readAccounts()).activeAccountId !== accountId) return;
    let address = owner;
    if (choice === "fresh") {
      // the fresh address joins Manage Addresses (and kUSDT's lookups) now that it's handed out;
      // another window took that slot meanwhile: the new one is shown, nothing copied
      try {
        address = (await wallet.reserveSwapPayoutAddress(fresh, { skip: kusdtListedIndices() })).address;
      } catch (error) {
        toast(error?.code === wallet.PAYOUT_CHANGED ? error.message : String(error?.message || error));
        return;
      }
    }
    let copied = false;
    try { await navigator.clipboard.writeText(address); copied = true; } catch { copied = false; }
    await ext.tabs.create({ url: trestlyBuyUrl() });
    toast(copied ? "Address copied. Paste it into Trestly's Kaspa address field." : `Paste ${wallet.shortAddress(address)} into Trestly's Kaspa address field.`);
  }
}
