// The two push screens off the Portfolio page - iOS KasPriceChartScreen and
// PortfolioValueChartScreen - and the Compare Against sheet their gear opens. Each screen is drawn
// once and then updated region by region (header, chart, range buttons, cards), so a price landing
// never steals focus from the converter. Network Hashrate and its Mining Estimate left Portfolio
// for K's Explorer (K iOS 961fc05a), which the extension doesn't have.

import { app, esc, render, $ } from "./ui.js";
import * as dock from "./dock.js";
import * as core from "./portfolio-core.js";
import { mountAreaChart } from "./portfolio-charts.js";
import { SF, openPanel, bindPullToRefresh, fitText } from "./portfolio-ui.js";

const { market, store } = core;

function navBar(title, { gear = false } = {}) {
  return `
    <header class="navbar pf-navbar">
      <button class="nav-back" id="back" aria-label="Portfolio">${SF.back()}<span>Portfolio</span></button>
      <div class="nav-title">${esc(title)}</div>
      ${gear ? `<button class="icon plain nav-right pf-gear" id="pf-gear" aria-label="Chart settings">${SF.gear(21)}</button>` : ""}
    </header>`;
}

const RANGES = () => [["1D", 1], ["1W", 7], ["1M", 30], ["3M", 90], ["YTD", core.yearToDateDays()], ["1Y", 365], ["All", 0]];

function rangePickerHtml() {
  return `<div class="pf-ranges" role="radiogroup" aria-label="Range">${RANGES().map(([label, days]) =>
    `<button role="radio" data-days="${days}" aria-checked="${market.rangeDays === days}">${label}</button>`).join("")}</div>`;
}

function bindRangePicker(onChange) {
  for (const button of app.querySelectorAll("[data-days]")) {
    button.onclick = () => {
      const days = Number(button.dataset.days);
      onChange();
      core.setRangeDays(days);
    };
  }
}

/** The unit chip beside the big number: the code and the flip arrows; orange while flipped. */
function chipHtml() {
  if (!core.canFlip()) return "";
  return `<span class="pf-chip ${market.flipped ? "flipped" : ""}">${esc(core.unitCode(core.chartUnit()))}${SF.arrowLeftRight(10)}</span>`;
}

/** ChartRangeSummary: "start → end" over the return across the two points. */
function rangeSummaryHtml(range, valueText, sameDayFormat) {
  const start = range.start; const end = range.end;
  const amount = end[1] - start[1];
  const up = amount >= 0;
  const sameDay = new Date(start[0]).toDateString() === new Date(end[0]).toDateString();
  const fmt = (ms) => new Date(ms).toLocaleString(undefined, sameDay ? sameDayFormat : { month: "short", day: "numeric", year: "numeric" });
  const percent = start[1] !== 0 ? `<span class="strong">${Math.abs((amount / Math.abs(start[1])) * 100).toFixed(2)}%</span>` : "";
  return `
    <div class="pf-range-sum">
      <div class="muted pf-sub">${esc(fmt(start[0]))} ${SF.arrowRight()} ${esc(fmt(end[0]))}</div>
      <div class="pf-range-change ${up ? "up" : "down"}">${up ? SF.arrowUpRight() : SF.arrowDownRight()}${percent}<span>(${up ? "+" : "-"}${esc(valueText(Math.abs(amount)))})</span></div>
    </div>`;
}

let chartHandle = null;
function mountChart(points, opts) {
  chartHandle?.destroy();
  chartHandle = mountAreaChart($("#pf-chart"), points, opts);
}

/** Preserves the scroller's position across a region update. */
function keepScroll(fn) {
  const scroller = $("#pf-scroll");
  const top = scroller?.scrollTop || 0;
  fn();
  if (scroller) scroller.scrollTop = top;
}

function spinnerBox(height) {
  return `<div class="pf-chart-empty" style="height:${height}px"><span class="spinner"></span></div>`;
}

// =================================================================================================
// KAS Price
// =================================================================================================

const converter = { kasText: "1", fiatText: "", editing: "kas" };

export function showPriceScreen({ onBack }) {
  const state = { scrubbed: null, range: null };
  render(`
    ${navBar("KAS Price", { gear: true })}
    <div class="pf-scroll pf-pad" id="pf-scroll">
      <div class="pf-ptr" id="pf-ptr"><span class="spinner small-spin"></span></div>
      <div class="pf-chart-head" id="pf-head"></div>
      <div class="pf-chart" id="pf-chart-box"></div>
      <div id="pf-ranges"></div>
      <div class="pf-glass pf-card pf-converter">
        <div class="pf-card-title">Converter</div>
        <label class="pf-conv-row"><span class="pf-conv-label">KAS</span><input id="pf-conv-kas" inputmode="decimal" placeholder="0" autocomplete="off" /><span class="pf-conv-trail">KAS</span></label>
        <label class="pf-conv-row"><span class="pf-conv-label" id="pf-conv-code"></span><input id="pf-conv-fiat" inputmode="decimal" placeholder="0" autocomplete="off" /><span class="pf-conv-trail" id="pf-conv-symbol"></span></label>
        <div class="muted pf-caption" id="pf-conv-rate"></div>
      </div>
      <div id="pf-stats"></div>
    </div>`, "portfolio:price");
  // Coming back to this tab re-reads the account and currency first (either may have changed).
  dock.remember(async () => { await core.loadStore(); showPriceScreen({ onBack }); });
  const root = $("#pf-scroll");
  $("#back").onclick = () => { unsubscribe(); onBack(); };
  $("#pf-gear").onclick = showCompareSheet;
  bindPullToRefresh($("#pf-scroll"), $("#pf-ptr"), () => core.pullRefresh());

  const flip = () => {
    if (!core.canFlip()) return;
    state.scrubbed = null; state.range = null;
    core.flipChart();
  };

  const paintHead = () => {
    const unit = core.chartUnit();
    const current = state.scrubbed ? state.scrubbed[1] : core.chartCurrentPrice();
    const change = core.rangeChange(core.chartPriceHistory());
    $("#pf-head").innerHTML = `
      <div class="pf-ch-title"><img src="icons/kaspa-logo.png" alt="" class="pf-logo30" /><span>Kaspa</span></div>
      ${state.scrubbed ? `<div class="muted pf-sub">${esc(new Date(state.scrubbed[0]).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }))}</div>` : ""}
      ${state.range ? rangeSummaryHtml(state.range, (v) => core.priceIn(v, unit), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
      <button class="pf-big-row" id="pf-flip" ${core.canFlip() ? "" : "tabindex=\"-1\""}><span class="pf-big" data-fit="0.6">${current != null ? esc(core.priceIn(current, unit)) : "—"}</span>${chipHtml()}</button>
      ${!state.scrubbed && !state.range && change ? `
        <div class="pf-change-line ${change.amount >= 0 ? "up" : "down"}">${change.amount >= 0 ? SF.arrowUp(12) : SF.arrowDown(12)}<span class="strong">${Math.abs(change.percent).toFixed(2)}%</span><span class="pf-range-label">${esc(core.rangeLabel(market.rangeDays))}</span></div>` : ""}`;
    $("#pf-flip").onclick = flip;
    fitText($("#pf-head"));
  };

  const paintChart = () => {
    const points = core.chartPriceHistory();
    const box = $("#pf-chart-box");
    if (points.length >= 2) {
      box.innerHTML = '<div class="pf-chart-host" id="pf-chart" style="height:260px"></div>';
      mountChart(points, {
        preciseAxis: market.flipped,
        onScrub: (p) => { state.scrubbed = p; paintHead(); },
        onRange: (r) => { state.range = r; paintHead(); },
      });
    } else {
      chartHandle?.destroy();
      box.innerHTML = spinnerBox(260);
    }
  };

  const paintRanges = () => {
    $("#pf-ranges").innerHTML = rangePickerHtml();
    bindRangePicker(() => { state.scrubbed = null; state.range = null; });
  };

  const paintStats = () => {
    const rank = market.rank; const cap = market.marketCap;
    $("#pf-stats").innerHTML = rank != null || cap != null ? `
      <div class="pf-glass pf-card pf-stats-card">
        ${rank != null ? `<div class="pf-kv"><span class="muted">Rank</span><span class="strong">#${rank}</span></div>` : ""}
        ${rank != null && cap != null ? '<div class="pf-divider"></div>' : ""}
        ${cap != null ? `<div class="pf-kv"><span class="muted">Market Cap</span><span class="strong">${esc(core.compactCurrency(cap))}</span></div>` : ""}
      </div>` : "";
  };

  // --- converter (KasConverterCard): only the field being typed in drives ---------------------
  const kasInput = $("#pf-conv-kas");
  const fiatInput = $("#pf-conv-fiat");
  const convFormat = (value) => core.groupedFromCanonical(core.trimmedTwo(value));
  const rate = () => (market.price?.price > 0 ? market.price.price : null);
  const recompute = (from) => {
    const r = rate();
    if (!r) return;
    if (from === "kas") {
      const value = core.inputValue(converter.kasText);
      converter.fiatText = value != null ? convFormat(value * r) : "";
      fiatInput.value = converter.fiatText;
    } else {
      const value = core.inputValue(converter.fiatText);
      converter.kasText = value != null ? convFormat(value / r) : "";
      kasInput.value = converter.kasText;
    }
  };
  const paintConverter = () => {
    $("#pf-conv-code").textContent = store.currency.toUpperCase();
    $("#pf-conv-symbol").textContent = core.currencySymbol();
    const r = rate();
    $("#pf-conv-rate").textContent = r ? `1 KAS = ${core.currencySymbol()}${convFormat(r)}` : "Waiting for a price...";
    if (document.activeElement !== kasInput) kasInput.value = converter.kasText;
    if (document.activeElement !== fiatInput) fiatInput.value = converter.fiatText;
    recompute(converter.editing);
  };
  for (const [input, field] of [[kasInput, "kas"], [fiatInput, "fiat"]]) {
    input.oninput = () => {
      core.regroupField(input);
      converter[field === "kas" ? "kasText" : "fiatText"] = input.value;
      converter.editing = field;
      recompute(field);
    };
  }

  const paintAll = () => keepScroll(() => { paintHead(); paintChart(); paintRanges(); paintStats(); paintConverter(); });
  const unsubscribe = core.subscribe((kind) => {
    if (!root.isConnected) { unsubscribe(); return; }
    if (kind === "price") keepScroll(() => { paintHead(); paintStats(); paintConverter(); });
    else if (kind === "history" || kind === "pair") {
      if (kind === "pair") { state.scrubbed = null; state.range = null; }
      keepScroll(() => { paintHead(); paintChart(); paintRanges(); });
    }
  });
  paintAll();
  core.refreshSpotPriceIfStale();
  core.ensureHistory(market.rangeDays);
  if (market.flipped) core.ensureAltSeries();
}

// =================================================================================================
// Value Over Time
// =================================================================================================

export function showValueScreen({ onBack }) {
  const state = { scrubbed: null, range: null };
  render(`
    ${navBar("Value Over Time", { gear: true })}
    <div class="pf-scroll pf-pad" id="pf-scroll">
      <div class="pf-ptr" id="pf-ptr"><span class="spinner small-spin"></span></div>
      <div class="pf-chart-head" id="pf-head"></div>
      <div class="pf-chart" id="pf-chart-box"></div>
      <div id="pf-ranges"></div>
      <div id="pf-stats"></div>
    </div>`, "portfolio:value");
  // Coming back to this tab re-reads the account and currency first (either may have changed).
  dock.remember(async () => { await core.loadStore(); showValueScreen({ onBack }); });
  const root = $("#pf-scroll");
  $("#back").onclick = () => { unsubscribe(); onBack(); };
  $("#pf-gear").onclick = showCompareSheet;
  bindPullToRefresh($("#pf-scroll"), $("#pf-ptr"), () => core.pullRefresh());

  const hidden = () => store.valuesHidden;
  const money = (v) => (hidden() ? core.MASKED : core.currency(v));
  const chartMoney = (v) => (hidden() ? core.MASKED : core.amountIn(v, core.chartUnit()));
  const flip = () => {
    if (!core.canFlip()) return;
    state.scrubbed = null; state.range = null;
    core.flipChart();
  };

  const paintHead = () => {
    const history = core.chartValueHistory();
    const change = core.rangeChange(history);
    const current = state.scrubbed ? state.scrubbed[1] : core.chartCurrentValue();
    const unit = core.chartUnit();
    $("#pf-head").innerHTML = `
      <div class="pf-ch-title"><span>Portfolio Value</span></div>
      ${state.scrubbed ? `<div class="muted pf-sub">${esc(new Date(state.scrubbed[0]).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}</div>` : ""}
      ${state.range ? rangeSummaryHtml(state.range, chartMoney, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""}
      <button class="pf-big-row" id="pf-flip"><span class="pf-big" data-fit="0.6">${current != null ? esc(chartMoney(current)) : "—"}</span>${chipHtml()}</button>
      ${!state.scrubbed && !state.range && change ? `
        <div class="pf-change-line ${change.amount >= 0 ? "up" : "down"}">${change.amount >= 0 ? SF.arrowUpRight() : SF.arrowDownRight()}<span class="strong">${hidden()
          ? `${Math.abs(change.percent).toFixed(2)}%`
          : `${esc(core.amountIn(Math.abs(change.amount), unit))} (${Math.abs(change.percent).toFixed(2)}%)`}</span><span class="pf-range-label">${esc(core.rangeLabel(market.rangeDays))}</span></div>` : ""}`;
    $("#pf-flip").onclick = flip;
    fitText($("#pf-head"));
  };

  const paintChart = () => {
    const points = core.chartValueHistory();
    const box = $("#pf-chart-box");
    if (points.length >= 2) {
      box.innerHTML = '<div class="pf-chart-host" id="pf-chart" style="height:240px"></div>';
      mountChart(points, {
        hideValues: hidden(),
        preciseAxis: market.flipped,
        onScrub: (p) => { state.scrubbed = p; paintHead(); },
        onRange: (r) => { state.range = r; paintHead(); },
      });
    } else {
      chartHandle?.destroy();
      box.innerHTML = market.flipped && core.baseValueHistory().length >= 2
        ? spinnerBox(240)
        : '<div class="pf-chart-empty muted" style="height:240px">Not enough history yet - check back after a few days of activity.</div>';
    }
  };

  const paintRanges = () => {
    $("#pf-ranges").innerHTML = rangePickerHtml();
    bindRangePicker(() => { state.scrubbed = null; state.range = null; });
  };

  const paintStats = () => {
    const s = core.summaryFor();
    const row = (label, value, cls = "") => `<div class="pf-stat-row"><span class="muted">${esc(label)}</span><span class="pf-stat-value ${cls}">${esc(value)}</span></div>`;
    $("#pf-stats").innerHTML = `
      <div class="pf-glass pf-stats">
        ${row("Holdings", hidden() ? `${core.MASKED} KAS` : core.kas(s.holdingsKas))}
        ${row("Current Value", money(s.currentValue))}
        ${row("Total Invested", money(s.totalInvested))}
        ${s.totalPL == null
          ? row("Total P&L", "—")
          : row("Total P&L", hidden() ? `${s.totalPLPercent.toFixed(1)}%` : `${core.currency(s.totalPL)} (${s.totalPLPercent.toFixed(1)}%)`, s.totalPL >= 0 ? "up" : "down")}
        ${s.averageBuyPrice != null ? row("Avg. Buy Price", core.price(s.averageBuyPrice)) : ""}
      </div>`;
  };

  const paintAll = () => keepScroll(() => { paintHead(); paintChart(); paintRanges(); paintStats(); });
  const unsubscribe = core.subscribe((kind) => {
    if (!root.isConnected) { unsubscribe(); return; }
    if (kind === "pair") { state.scrubbed = null; state.range = null; }
    paintAll();
  });
  paintAll();
  core.refreshSpotPriceIfStale();
  core.ensureHistory(market.rangeDays);
  if (market.flipped) core.ensureAltSeries();
}

// =================================================================================================
// Compare Against (ChartPairSettingsSheet)
// =================================================================================================

const PAIR_ROWS = [
  ["bitcoin", SF.bitcoin(24), "#ff9f0a"],
  ["voo", SF.chartCircle(24), "var(--kaspa)"],
  ["gold", SF.hexCircle(24), "#ffd60a"],
  ["silver", SF.hexCircle(24), "#8e8e93"],
];

export function showCompareSheet() {
  const body = () => `
    <div class="pf-compare">
      <div class="pf-compare-title">Compare Against</div>
      <p class="muted pf-compare-text">Tap the price or your value to see it in the pair you pick here. One at a time.</p>
      <div class="pf-glass pf-compare-card">
        ${PAIR_ROWS.map(([pair, icon, tint], i) => `
          ${i ? '<div class="pf-divider inset56"></div>' : ""}
          <div class="pf-compare-row">
            <span class="pf-compare-icon" style="color:${tint}">${icon}</span>
            <span class="pf-compare-text-block"><span class="strong">${esc(core.CHART_PAIRS[pair].title)}</span><span class="muted pf-caption">${esc(core.CHART_PAIRS[pair].subtitle)}</span></span>
            <button class="toggle ${store.chartPair === pair ? "on" : ""}" data-pair="${pair}" role="switch" aria-checked="${store.chartPair === pair}" aria-label="${esc(core.CHART_PAIRS[pair].title)}"></button>
          </div>`).join("")}
      </div>
    </div>`;
  const panel = openPanel({ title: "", body: body(), size: 440, className: "pf-barless" });
  const bind = () => {
    for (const toggle of panel.body.querySelectorAll("[data-pair]")) {
      toggle.onclick = async () => {
        const pair = toggle.dataset.pair;
        await core.setChartPair(store.chartPair === pair ? null : pair);
        panel.setBody(body());
        bind();
      };
    }
  };
  bind();
}
