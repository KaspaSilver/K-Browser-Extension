// .kachat - the marketplace for KaChat's own names, a 1:1 port of iOS KachatMarketView,
// KachatListingDetailView, KachatBuySheet and KachatOfferSheet (Kaspa Hub > .kachat on iOS; here
// the .kachat row under Your Domains).
//
// The tab leads with the name search (KaPay iOS 5848fb0, 7daf3f1): the logo and "Claim your name on
// Kaspa", "Type the name you want" with Claim on a free name, then any claims in progress, your
// names, and a short row of Available, For sale, Expired and the latest activity, each with See All
// for its page (Marketplace, Available, Expired, Activity; KaPay 99ab88a).
//
// On mainnet it is UI only, as on iOS: search answers "Registration isn't open yet", listings,
// offers and activity are placeholder skeletons, and every final action is disabled. No invented
// names or prices anywhere - the skeletons are redacted shapes (iOS .redacted(reason:
// .placeholder)), so nothing here can be mistaken for a real listing.
//
// On TESTNET (testnet-10, with the bundled registry manifest verified) it is live
// (kachat-live.js, iOS KachatNamesLiveViews.swift): search shows real availability (Available or
// Taken; no price per year, KaPay 05db583), Claim registers in steps - how long, then the costs and
// swipe up, which follows the claim (KaPay 5bab351) - and the pages -
// Marketplace, Available, Expired, Activity (iOS 0765ce0, eea52b2, cb3c27d) - read the registry. Your
// own names and the offers you made live in Your Domains.

import { app, esc, render, $, ICONS, navHeader } from "./ui.js";
import { SYMBOLS, kachatWordmark, openPanel } from "./kachat-ui.js";
import { kachatLive, kachatLaunched, kachatNames } from "./kachat-names.js";

// Names are always bought on the chatting address (iOS 6e938ff, the owner's call): there is no
// Buy From any more - claims, purchases, offers, extend and renew pay from the chatting address.

import { IS_TESTNET } from "./net.js";
import * as dock from "./dock.js";
import * as live from "./kachat-live.js";
import { backupBannerHtml, bindBackupBanner } from "./account-backup.js";

export { kachatWordmark };

const redact = (text) => `<span class="redacted">${esc(text)}</span>`;
const pill = () => '<span class="coming-pill">Coming soon</span>';
const header = (title, detail) => `
  <div class="km-header"><div class="km-title">${esc(title)}</div>${detail ? `<div class="muted tiny">${esc(detail)}</div>` : ""}</div>`;

// The pages behind See All (KaPay 99ab88a KachatMarketView.Page): names for sale, names back on
// the market (Available), names in their grace period (Expired), and everything that happens in
// the registry.
const PAGES = [
  { id: "market", title: "Marketplace" },
  { id: "available", title: "Available" },
  { id: "expired", title: "Expired" },
  { id: "activity", title: "Activity" },
];
// xmark.circle.fill: clears the search (KaPay iOS 5848fb0)
const CLEAR_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M9 9l6 6M15 9l-6 6" stroke="var(--bg)" stroke-width="2.2" stroke-linecap="round"/></svg>';

const isLive = () => kachatLive && live.hub.isLive;
// Live, or not launched here (mainnet): the same pages - empty on mainnet (iOS 7227d69). The
// placeholder pages remain only for a testnet registry that is setting up.
const livePages = () => isLive() || !kachatLaunched;

// The names being claimed, with a count (iOS b219bb0 KachatClaimsButton), on a page; the .kachat
// screen shows the claims themselves (KaPay iOS 5848fb0).
const claimsButton = () => (isLive() ? live.claimsButtonHtml() : "");
const bindClaims = () => { const b = $("#claims"); if (b) b.onclick = () => live.openClaimsList(); };

/** Starts the hub (or, where the registry isn't launched, shows its pages empty) and repaints with
 *  `paintParts` on every change. */
function follow(paintParts, { start = true } = {}) {
  if (kachatLive) {
    live.hub.onChange = paintParts;
    if (start || !live.hub.isLive) live.hub.start();
    else paintParts();
  } else {
    // Not launched here: the live pages show empty, under "Coming soon".
    live.hub.loaded = true;
    paintParts();
  }
}

/** The .kachat tab's first screen (its own place in the dock), KaPay iOS 5848fb0: the logo and
 *  "Claim your name on Kaspa", then the name search with Claim on a free name, then - live - any
 *  claims in progress, your names, and a short row of Available, For sale, Expired and the latest
 *  activity, each with See All for its page. No Back, unless it was opened from somewhere else
 *  (`onBack`). `search` and `scroll` are where it was, coming back from a name or a page. */
export function showKachatMarket({ onBack = null, search = "", scroll = 0 } = {}) {
  const state = { search };
  const at = () => app.querySelector(".km")?.scrollTop || 0;
  const again = (top = 0) => showKachatMarket({ onBack, search: state.search, scroll: top });
  // a name opened here stays in the .kachat tab, and Back comes back to this screen as it was
  const nav = {
    openName: (info) => {
      const top = at();
      live.hub.onChange = null;
      live.showLiveNameDetail({ info, onBack: () => again(top), screen: "kachat:name" });
    },
  };

  const heroStatus = () => {
    // the Testnet badge on testnet only; mainnet is live as it is (iOS ef6b21e)
    if (isLive()) return IS_TESTNET ? live.testnetBadge() : "";
    // The bundled manifest is for the previous registry: a calm "Setting up", no error (iOS d2e0673).
    if (kachatLive && live.hub.upgrading) {
      // the Testnet badge on testnet only, and no network named in the text (EXT-021)
      return `<div class="kl-badges">${IS_TESTNET ? live.testnetBadge() : ""}<span class="coming-pill kl-setting-up">${SYMBOLS.hammer}<span>Setting up</span></span></div>
        <p class="muted tiny center-text">The .kachat registry is being upgraded. Names open here again once the new registry is live.</p>`;
    }
    const error = kachatLive && live.hub.ready === false && live.hub.setupError
      ? `<p class="muted tiny center-text">${esc(live.hub.setupError)}</p>` : "";
    return pill() + error;
  };

  // The search (KaPay iOS 5848fb0 KachatNameSearchCard, 7daf3f1): "Type the name you want" in the
  // field, nothing under it until something is typed; then Available (Claim) or Taken (it opens).
  const searchResult = () => {
    const typed = state.search.trim().toLowerCase();
    if (!typed) return "";
    if (isLive()) return live.searchResultHtml(typed);
    return `
      <div class="km-card km-search-result">
        <div class="tx-meta"><span class="strong ellipsis">${esc(typed)}.kachat</span><span class="muted tiny">Registration isn't open yet.</span></div>
        <button class="km-prominent small-button" disabled>Claim</button>
      </div>`;
  };

  render(`
    <header class="navbar">
      ${onBack ? `<button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button>` : "<span></span>"}
      <div class="nav-title">.kachat</div>
      <div class="nav-right km-nav-actions">
        <button class="icon plain accent" id="how" aria-label="How it works">${SYMBOLS.question}</button>
      </div>
    </header>
    ${backupBannerHtml()}
    <section class="km km-hub">
      <div class="km-hero compact">
        ${kachatWordmark(64)}
        <p class="muted small km-tagline">Claim your name on Kaspa</p>
        <div id="km-status">${heroStatus()}</div>
      </div>
      <div class="km-search km-search-lead">
        <label class="km-card km-search-field">
          <span class="accent km-search-icon">${ICONS.search}</span>
          <input id="search" type="text" value="${esc(state.search)}" placeholder="Type the name you want" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" />
          <button type="button" class="km-search-clear" id="search-clear" aria-label="Clear" ${state.search ? "" : "hidden"}>${CLEAR_ICON}</button>
          <span class="accent strong km-search-suffix">.kachat</span>
        </label>
        <div id="search-result">${searchResult()}</div>
      </div>
      <div class="km-hub-sections" id="km-sections">${live.hubSectionsHtml()}</div>
    </section>`, "kachat:market");
  dock.remember(() => again());
  if (onBack) $("#back").onclick = onBack;
  // .kachat has no title: the backup banner sits under the bar (KaPay iOS 953b255)
  bindBackupBanner(() => again());
  // About .kachat, full screen (KaPay iOS e188209: it was a half sheet)
  $("#how").onclick = () => { const top = at(); live.hub.onChange = null; showAboutKachat({ onBack: () => again(top) }); };
  const scroller = app.querySelector(".km");
  if (scroller) scroller.scrollTop = scroll;

  const field = $("#search");
  const clear = $("#search-clear");
  const paintSearch = () => {
    const result = $("#search-result");
    if (!result) return;
    result.innerHTML = searchResult();
    if (isLive()) live.bindSearchResult(result, nav);
  };
  const typed = () => {
    clear.hidden = !state.search;
    if (isLive()) live.hub.lookup(state.search.trim().toLowerCase());
    paintSearch();
  };
  field.oninput = () => { state.search = field.value; typed(); };
  clear.onclick = () => { state.search = ""; field.value = ""; typed(); field.focus(); };
  // coming back from a name: the result for what is still typed
  if (state.search.trim() && isLive()) live.hub.lookup(state.search.trim().toLowerCase());

  const bindSections = () => {
    const sections = $("#km-sections");
    if (!sections) return;
    live.bindHubSections(sections, nav);
    for (const b of sections.querySelectorAll("[data-see-all]")) {
      b.onclick = () => {
        const top = at();
        live.hub.onChange = null;
        showKachatPage(b.dataset.seeAll, { onBack: () => again(top) });
      };
    }
  };
  // Live updates redraw the parts in place: typing keeps its focus, a row keeps where it was scrolled.
  const paintParts = () => {
    if (app.dataset.screen !== "kachat:market") return;
    const top = at();
    $("#km-status").innerHTML = heroStatus();
    const sections = $("#km-sections");
    const rows = [...sections.querySelectorAll(".kl-carousel")].map((row) => row.scrollLeft);
    sections.innerHTML = live.hubSectionsHtml();
    sections.querySelectorAll(".kl-carousel").forEach((row, i) => { if (rows[i]) row.scrollLeft = rows[i]; });
    bindSections();
    paintSearch();
    const el = app.querySelector(".km");
    if (el) el.scrollTop = top;
  };
  bindSections();
  paintSearch();
  follow(paintParts);
}

/** A section's full page (KaPay 99ab88a pageScreen, See All on the .kachat screen since KaPay iOS
 *  5848fb0): its title, and the claims button while names are being claimed. Back goes to the
 *  screen. `scroll` is where it was, coming back from a name opened on it. */
function showKachatPage(id, { onBack, scroll = 0 }) {
  const page = PAGES.find((p) => p.id === id) || PAGES[0];
  const again = (at = 0) => showKachatPage(page.id, { onBack, scroll: at });
  const nav = {
    openName: (info) => {
      const at = app.querySelector(".km")?.scrollTop || 0;
      live.hub.onChange = null;
      live.showLiveNameDetail({ info, onBack: () => again(at), screen: "kachat:name" });
    },
  };

  // A name tile's shape, redacted: no invented name or price (iOS tilePlaceholder, 27a4f39 / c488d1d).
  const tile = (attr = "") => `<button class="km-card kl-tile" ${attr}>${live.nameTileHtml(redact("somename"), redact("000 KAS"))}</button>`;

  const marketPage = () => `
    ${header("For sale")}
    ${live.nameGridHtml(Array.from({ length: 4 }, () => tile("data-listing")).join(""))}
    <button class="km-bordered with-icon" disabled>${SYMBOLS.tag}<span>List a Name for Sale</span></button>
    <p class="muted small center-text">Listings appear here once .kachat names launch.</p>`;

  const availablePage = () => `
    ${header("Available")}
    ${live.nameGridHtml(Array.from({ length: 2 }, () => tile('disabled aria-hidden="true"')).join(""))}
    <p class="muted small center-text">Expired names appear here once .kachat names launch.</p>`;

  // Names in their grace period, redacted (iOS expiredPage, cb3c27d).
  const expiredPage = () => `
    ${header("Expired")}
    ${live.nameGridHtml(Array.from({ length: 2 }, () => `<button class="km-card kl-tile" disabled aria-hidden="true">${live.nameTileHtml(redact("somename"), '<span class="muted tiny">00:00</span>')}</button>`).join(""))}
    <p class="muted small center-text">Names in their grace period appear here once .kachat names launch.</p>`;

  const activityPage = () => `
    ${header("Recent activity", "Every claim, renewal, listing, sale, offer, transfer and reclaim across the registry.")}
    <div class="km-card km-list">
      ${["tag", "cart", "at", "arrows"].map((icon) => `
        <div class="km-row">
          <span class="accent km-icon">${SYMBOLS[icon]}</span>
          <span class="tx-meta"><span class="strong small">${redact("somename.kachat sold")}</span><span class="tiny">${redact("2h ago")}</span></span>
          <span class="small">${redact("000 KAS")}</span>
        </div>`).join("")}
    </div>
    <p class="muted small center-text">Activity appears here once .kachat names launch.</p>`;

  // Mainnet (or before the testnet registry is ready): the mockups.
  const mockPage = () => (page.id === "available" ? availablePage() : page.id === "expired" ? expiredPage() : page.id === "activity" ? activityPage() : marketPage());
  const pageHtml = () => (livePages() ? live.livePageHtml(page.id) : mockPage());

  render(`
    <header class="navbar">
      <button class="nav-back" id="back" aria-label="Back">${ICONS.back}<span>Back</span></button>
      <div class="nav-title">${esc(page.title)}</div>
      <div class="nav-right km-nav-actions"><span id="km-claims">${claimsButton()}</span></div>
    </header>
    <section class="km km-page-screen">
      <div class="km-page" id="km-page">${pageHtml()}</div>
    </section>`, "kachat:page");
  dock.remember(() => again());
  const scroller = app.querySelector(".km");
  if (scroller) scroller.scrollTop = scroll;
  $("#back").onclick = onBack;
  bindClaims();

  const bindParts = () => {
    for (const listing of app.querySelectorAll("[data-listing]")) listing.onclick = () => showListing({ onBack: () => again() });
    if (livePages()) live.bindLivePage($("#km-page"), nav);
  };
  // Live updates redraw the page in place.
  const paintParts = () => {
    if (app.dataset.screen !== "kachat:page") return;
    const el = app.querySelector(".km");
    const top = el?.scrollTop || 0;
    $("#km-claims").innerHTML = claimsButton();
    bindClaims();
    $("#km-page").innerHTML = pageHtml();
    bindParts();
    if (el) el.scrollTop = top;
  };
  bindParts();
  // the screen already started the hub: a page only follows it (and starts it if it never got going)
  follow(paintParts, { start: false });
}

// --- How it works (sheet) ------------------------------------------------------------------

// --- About .kachat (KaPay iOS e188209 KachatHelpView) -------------------------------------------
// The .kachat tab's "?" and Settings > Help > .kachat Names Guide: two cards, How It Works and
// Pricing, each its own page.

// leaf / network (SF Symbols)
const ABOUT_ICONS = {
  leaf: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15"/><path d="M5 19 13 11"/></svg>',
  network: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="19" r="2.2"/><circle cx="19" cy="19" r="2.2"/><path d="M12 7.2v4.3M12 11.5l-5.6 5.8M12 11.5l5.6 5.8"/></svg>',
};

/** About .kachat: How It Works and Pricing as cards. `onBack`: where Back goes; `screen`: the
 *  screen name, so the dock keeps the tab it was opened from ("settings" from Settings > Help). */
export function showAboutKachat({ onBack, screen = "kachat:about" }) {
  const again = () => showAboutKachat({ onBack, screen });
  const card = (id, icon, title, detail) => `
    <button class="conn-card about-card" data-about="${id}">
      <span class="conn-card-icon">${icon}</span>
      <span class="conn-card-text"><span class="conn-card-title">${esc(title)}</span><span class="muted small">${esc(detail)}</span></span>
      ${ICONS.chevron}
    </button>`;
  render(`
    ${navHeader({ title: "About .kachat" })}
    <section class="screen settings">
      <div class="conn-cards">
        ${card("how", SYMBOLS.question, "How It Works", "Claim, list, buy and make offers: what each one does.")}
        ${card("pricing", SYMBOLS.tag, "Pricing", "What a name costs, and where the KAS goes.")}
      </div>
    </section>`, screen);
  dock.remember(again);
  $("#back").onclick = onBack;
  app.querySelector('[data-about="how"]').onclick = () => showHowItWorks({ onBack: again, screen });
  app.querySelector('[data-about="pricing"]').onclick = () => showPricing({ onBack: again, screen });
}

function showHowItWorks({ onBack, screen }) {
  const rows = [
    ["atPlus", "Claim", "Pick a free name and register it on Kaspa. It's yours: your name, your profile, your link."],
    ["renew", "Renew", "Renew before it expires to keep it. An expired name waits for its owner to renew it for a while before anyone else can claim it."],
    ["tag", "List", "Set a price. The name waits in an on-chain covenant, not with KaChat or anyone else, until someone buys it or you take it back."],
    ["cart", "Buy", "Pay the listed price. The payment reaches the seller and the name reaches you in the same transaction - both happen, or neither does."],
    ["hand", "Offer", "Name your own price. Your KAS waits on chain until the seller accepts, you withdraw the offer, or it expires."],
    ["shield", "Trustless", "No middleman and no escrow account: Kaspa's own rules enforce every sale."],
  ];
  render(`
    ${navHeader({ title: "How It Works" })}
    <section class="screen settings">
      ${rows.map(([icon, title, detail]) => `
        <div class="km-card about-step">
          <span class="accent km-how-icon">${SYMBOLS[icon]}</span>
          <span class="tx-meta"><span class="strong">${esc(title)}</span><span class="muted small">${esc(detail)}</span></span>
        </div>`).join("")}
      <p class="form-footer">${!isLive() ? "Nothing here is live yet." : IS_TESTNET ? "Live on Testnet: names, prices and payments here use TKAS on testnet-10. Mainnet names are live on Mainnet." : "Live on Mainnet: names, prices and payments here are real KAS."}</p>
    </section>`, screen);
  dock.remember(() => showHowItWorks({ onBack, screen }));
  $("#back").onclick = onBack;
}

function showPricing({ onBack, screen }) {
  const p = live.pricingInfo();
  const info = (icon, title, text) => `
    <div class="km-card about-step">
      <span class="accent km-how-icon">${icon}</span>
      <span class="tx-meta"><span class="strong">${esc(title)}</span><span class="muted small">${esc(text)}</span></span>
    </div>`;
  render(`
    ${navHeader({ title: "Pricing" })}
    <section class="screen settings">
      <div class="km-card about-prices">
        <div class="about-price-row about-price-head"><span>Name length</span><span>Claim</span><span>Renew</span></div>
        ${p.rows.map((r) => `<div class="about-price-row"><span>${esc(r.length)}</span><span class="mono-digits">${esc(r.claim)}</span><span class="mono-digits">${esc(r.renew)}</span></div>`).join("")}
        <p class="muted small about-price-note">${esc(`Claim pays for the first ${p.onePeriod}. Renew pays for each one after that.`)}</p>
      </div>
      ${info(ABOUT_ICONS.leaf, "Where the price goes", "The price goes to the miners - KaChat takes nothing.")}
      ${info(SYMBOLS.lock, "Locked, not spent", `${p.locked} stays locked with your name while you hold it (bond + registry deposit). You get it back when you release the name.`)}
      ${info(SYMBOLS.calendar, "Paying ahead", `You can pay for up to ${p.maxPeriods} at a time.`)}
      ${info(SYMBOLS.cart, "Buying and selling", "The seller gets the full listed price: there's no marketplace fee.")}
      ${info(ABOUT_ICONS.network, "Network fee", "Every claim, renewal, sale and offer also pays a small Kaspa network fee, shown before you confirm.")}
    </section>`, screen);
  dock.remember(() => showPricing({ onBack, screen }));
  $("#back").onclick = onBack;
}

// --- Listing (iOS KachatListingDetailView) --------------------------------------------------

function showListing({ onBack }) {
  const rows = (icon, line, trailing) => `
    <div class="km-row">
      <span class="accent km-icon">${SYMBOLS[icon]}</span>
      ${line}
      ${trailing}
    </div>`;
  render(`
    ${navHeader({ title: "Listing" })}
    <section class="km">
      <div class="km-card km-name-card">
        <div class="km-name-banner">${redact("name.kachat")}</div>
        <div class="km-price-row">
          <div class="tx-meta"><span class="muted tiny">Price</span><span class="km-price">${redact("000 KAS")}</span></div>
          <span class="tiny">${redact("listed 1h ago")}</span>
        </div>
        ${pill()}
      </div>
      <div class="km-actions">
        <button class="km-prominent with-icon" id="buy">${SYMBOLS.cart}<span>Buy Now</span></button>
        <button class="km-bordered with-icon" id="offer">${SYMBOLS.hand}<span>Make an Offer</span></button>
      </div>
      ${header("Seller")}
      <div class="km-card km-seller">
        <span class="km-dot big"></span>
        <span class="tx-meta"><span class="strong small">${redact("kaspa:xxxx....xxxx")}</span><span class="muted tiny">Ask about the name, or agree on a price before you offer.</span></span>
        <button class="km-bordered small-button with-icon" disabled>${SYMBOLS.bubbles}<span>Message</span></button>
      </div>
      ${header("Offers", "Open offers on this name, highest first. The seller can accept any of them.")}
      <div class="km-card km-list">
        ${Array.from({ length: 3 }, () => rows("hand",
          `<span class="tx-meta"><span class="strong small">${redact("kaspa:xxxx....xxxx")}</span><span class="tiny">${redact("expires in 2d")}</span></span>`,
          `<span class="strong small">${redact("000 KAS")}</span>`)).join("")}
      </div>
      ${header("History")}
      <div class="km-card km-list">
        ${["tag", "arrows", "atPlus"].map((icon) => rows(icon,
          `<span class="tx-meta"><span class="small">${redact("listed by kaspa:xxxx")}</span></span>`,
          `<span class="tiny">${redact("3d ago")}</span>`)).join("")}
      </div>
      <div class="km-notes muted small">
        <div>${SYMBOLS.cart}<span>Buying pays the seller and moves the name to you in one transaction.</span></div>
        <div>${SYMBOLS.lock}<span>An offer locks your KAS on chain until the seller accepts it, you withdraw it, or it expires.</span></div>
        <div>${SYMBOLS.bubbles}<span>Messages go to the seller like any KaChat chat.</span></div>
      </div>
    </section>`, "kachat:listing");
  $("#back").onclick = onBack;
  // Buy Now and Make an Offer open their sheets so the flow can be looked at; their final
  // buttons are disabled until names launch.
  $("#buy").onclick = showBuy;
  $("#offer").onclick = showOffer;
}

function summaryRow(title, value, bold = false) {
  return `<div class="form-row between"><span class="${bold ? "strong" : ""}">${esc(title)}</span><span class="${bold ? "strong" : ""}">${redact(value)}</span></div>`;
}

function showBuy() {
  openPanel({
    title: "Buy Name",
    leading: "Cancel",
    full: true, // full height with Cancel top left, like Make an Offer (iOS 6dd5578)
    body: `
      <div class="form-section">
        <div class="form-card">
          ${summaryRow("Name", "name.kachat")}
          ${summaryRow("Price", "000 KAS")}
          ${summaryRow("Network fee", "0.0000 KAS")}
          ${summaryRow("Total", "000 KAS", true)}
        </div>
        <div class="form-footer">The payment reaches the seller and the name reaches you in the same transaction - both happen, or neither does.</div>
      </div>
      <div class="form-section">
        <div class="form-card"><button class="form-row km-form-button" disabled>Confirm Purchase</button></div>
        <div class="form-footer">Buying opens when .kachat names launch.</div>
      </div>`,
  });
}

function showOffer() {
  const expiries = [["1d", "1 Day"], ["3d", "3 Days"], ["7d", "7 Days"], ["30d", "30 Days"]];
  openPanel({
    title: "Make an Offer",
    leading: "Cancel",
    full: true,
    body: `
      <div class="form-section">
        <div class="form-card">
          ${summaryRow("Name", "name.kachat")}
          ${summaryRow("Listed at", "000 KAS")}
        </div>
      </div>
      <div class="form-section">
        <div class="form-header">Your offer</div>
        <div class="form-card"><div class="form-row"><input class="plain-input km-offer-amount" inputmode="decimal" placeholder="0" /><span class="muted">KAS</span></div></div>
        <div class="form-footer">Your KAS stays locked on chain until the seller accepts, you withdraw the offer, or it expires. Nobody else can touch it.</div>
      </div>
      <div class="form-section">
        <div class="form-header">Expires after</div>
        <div class="form-card"><div class="form-row">
          <div class="segmented wide km-expiry" role="radiogroup" aria-label="Expires after">
            ${expiries.map(([id, label]) => `<button type="button" role="radio" data-expiry="${id}" aria-checked="${id === "3d"}">${label}</button>`).join("")}
          </div>
        </div></div>
      </div>
      <div class="form-section">
        <div class="form-card"><button class="form-row km-form-button" disabled>Send Offer</button></div>
        <div class="form-footer">Offers open when .kachat names launch.</div>
      </div>`,
    onMount(panel) {
      // The amount and expiry can be set so the form can be tried, as on iOS.
      for (const option of panel.querySelectorAll("[data-expiry]")) {
        option.onclick = () => {
          for (const other of panel.querySelectorAll("[data-expiry]")) other.setAttribute("aria-checked", String(other === option));
        };
      }
      const amount = panel.querySelector(".km-offer-amount");
      amount.oninput = () => { amount.value = amount.value.replace(/[^\d.]/g, ""); };
    },
  });
}

