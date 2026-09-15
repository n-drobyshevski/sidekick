// OS vulnerabilities. Insights over the current scan and the durable ledger instead of a
// findings table (Wiz already has one of those): an "act now" hero, a triage funnel, risk
// tiers with per-tier sparklines, aging against the SLA clock, scan-over-scan movement, and
// where the backlog concentrates.
//
// EXPLOITABILITY IS THE SPINE, NOT SEVERITY, and that is the whole design.
//
// The register is filtered at fetch time, so severity is close to a constant here. Every
// surface built on it degenerated: the breakdown card was one row, the trend one line, the
// age bar one colour, the breakdown tree's severity strip a solid block on every row. Four
// controls carrying zero bits, over a page whose remaining sections were buttons.
//
// So the axis is exploit intelligence — which the ledger already carries durably in
// has_kev / has_exploit / epss, and can therefore trend exactly the way severity did. The
// classifier is program.riskTier, a refinement of the Program page's classifyRisk rather
// than a second opinion, so the two pages can never disagree on how much is unclassified.
//
// See gas/README.md, "OS vulnerabilities: exploitability is the spine, not severity".

import {
  TIER_COLORS, TIER_GLYPHS, TIER_LABELS, TIER_ORDER, TIER_TEXT,
  groupPalette, hideChartWhenSettled, tierPalette,
} from "../charts.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { overviewHeroView, populationLine, slaConsumedCaption } from "./overviewModel.js";
import { agingTableModel, pieTableModel, trendTableModel } from "./_charts.js";
import {
  PROVENANCE_HELP, PROVENANCE_LABEL, activeRegisterFilters, filterSentence, fixLabel,
  provenance, readRegisterParams, registerFirstRunView, registerParamPatch,
} from "./registerModel.js";
import { findingRowLabel, openFindingSheet } from "./findingSheet.js";
import { rateCell } from "./_rates.js";
import { meterPctFor, rateView } from "./mttr.js";
import { call } from "../../../../../gas_shared/api.js";
import { bootstrap, navigate, setParams, swrCall } from "../../../../../gas_shared/store.js";
import {
  DEFAULT_PAGE_SIZE, absent, chartTable, clear, closeActiveSheet, dataTable, days1, el,
  emptyState, errorState, firstRunNotice, fmtDate, glossaryTip, heroStat, kpiCard,
  measuredEmpty, num, nvdUrl, openSheet, pageHeader, pct1, scopeBar, sectionLabel, segmented,
  sevBadge, sevEntries, sevKeyRow, sevSegmentBar, sevSpoken, skeleton, skeletonStack, statRow,
  tableFooter, tip, tipAnchor, tipLabel, togglePills, triCell,
} from "../ui.js";

// Rows per page in the "Oldest open findings" panel's pagination. The server ships
// up to 100 rows for the view being shown (api.getOldestOpen), so this yields up to ten pages,
// and paging stays client-side — in GAS the round trip is the expensive unit, not the few KB.
const OLDEST_PAGE_SIZE = 10;
// The sizes that panel's footer offers. NOT the shared PAGE_SIZES: its smallest step is 25,
// which cannot show the 10 this panel opens on, and 100 is the whole payload — a "250 / page"
// option would name rows the server never sent.
const OLDEST_PAGE_SIZES = [10, 25, 50, 100];

// Keep in sync with AGE_BUCKET_LABELS in src/domain/insights.ts (the client bundle
// can't import the TS domain module).
const AGE_LABELS = ["0-7d", "8-30d", "31-90d", "90+d"];

// UPPERCASE severity key -> Title Case display label ("CRITICAL" -> "Critical").
function sevTitle(sev) {
  return sev.charAt(0) + sev.slice(1).toLowerCase();
}

// `fmtAgeDays` USED TO LIVE HERE: a hand-rolled whole-day label ("412d") with no null check at
// all — `Math.round(n)` on a null/undefined `n` is `NaN`, printing the unparseable "NaNd" rather
// than either a confident zero or an honest absence. It predated `ui/figures.js`'s shared day
// formatters and its own header explained why it kept a third name rather than becoming a
// silent second `fmtDays` — a real distinction from `fmtSpan` (ui/span.js, which changes UNIT
// across three orders of magnitude) but not from the shared pair `figures.js` already ships:
// `days1` ("412.0 d") for a table cell and `fmtDays` ("412 days") for hero/tile prose are
// exactly the two grains this formatter was reinventing under a third name and a fourth
// spelling ("412d", no space, no decimal, rounded). Its three call sites below now take the
// shared formatter that matches their POSITION — the Rule this package converges every page
// on: hero/tile prose -> `fmtDays`, table cells -> `days1`.

/** Streamlit-style signed delta chip vs a previous value: arrow + absolute change +
 *  "· ±N%". A rising count is worse (red), falling is better (green), unchanged shows a
 *  neutral ±0. Returns null when there's no previous value to compare against.
 *
 *  `num()`, not the hand-rolled `previous === null || previous === undefined ||
 *  Number.isNaN(previous)` check this used to open with: that guard read `current` with a bare
 *  subtraction, so `current - previous` on a null `current` was `0 - previous` (`Number(null)`
 *  is 0) rather than a refusal — a confident, signed chip over a count nobody measured. Both
 *  arguments now go through the same allowlist before either is compared or subtracted. The
 *  one caller on this page (`renderTiers`) always passes real numbers (`t.perTier[tier] || 0`,
 *  `prev[tier] || 0`), so this closes a gap nothing here can currently reach today rather than
 *  a reproducible one — the same "a stale cache could still hit this" discipline the removed
 *  `fmtAgeDays` comment above stated outright. */
function deltaChip(current, previous) {
  const c = num(current);
  const p = num(previous);
  if (c === null || p === null) return null;
  const delta = c - p;
  if (!delta) return el("span", { class: "sev-delta flat", "aria-label": "unchanged" }, "±0");
  const rising = delta > 0;
  const arrow = rising ? "▲" : "▼";
  const sign = rising ? "+" : "−";
  const mag = Math.abs(delta).toLocaleString();
  const pct = p ? Math.round(Math.abs((delta / p) * 100)) : null;
  // The ▲/▼ glyph is decorative; restate direction in words so this reads in the same
  // vocabulary as changeChip for assistive tech.
  const aria = `${rising ? "up" : "down"} ${mag}${pct !== null ? `, ${pct} percent` : ""}`;
  return el("span", { class: `sev-delta ${rising ? "bad" : "good"}`, "aria-label": aria },
    el("span", { "aria-hidden": "true" }, arrow), ` ${sign}${mag}`,
    pct !== null ? el("span", { class: "sev-delta-pct" }, ` · ${sign}${pct}%`) : null,
  );
}

// Groupable dimensions for the multi-level Breakdown table (value -> label). Mirrors
// GROUP_COLUMNS in src/domain/insights.ts (the client bundle can't import the TS module).
const GROUP_DIMENSIONS = [
  ["domain", "Domain"],
  ["supportGroup", "Support group"],
  ["asset", "Asset"],
  ["atype", "Asset type"],
  ["cloud", "Cloud"],
  ["os", "Operating system"],
  ["subscription", "Subscription"],
  ["cve", "CVE"],
];

// Oldest-open panel toggle views: [payload key, label]. Each keys
// insights.oldest.{byAsset,bySupportGroup,byDomain} and ranks that entity by its 90+ day
// open backlog.
//
// THE "Findings" VIEW IS GONE AND IT WAS THE REGISTER ALL ALONG. It listed individual
// findings with five columns and no key, from a payload capped at 100 rows, inside a
// drawer — a worse copy of the findings table now at the foot of the page, which is the
// whole ledger, server-sorted, with a per-row drill-down. Two tables of findings on one
// page, disagreeing about how many there are, is not a choice a reader should have to
// make; the panel keeps the three GROUPED rankings, which the register table genuinely
// cannot draw, and links to the register for the fourth.
const OLDEST_VIEWS = [
  ["byAsset", "Assets"],
  ["bySupportGroup", "Support groups"],
  ["byDomain", "Domains"],
];

// Dimensions offered by the on-page concentration lists, in the order they are toggled.
// A subset of GROUP_DIMENSIONS: the full N-level pivot stays in the Breakdown drawer, and
// these four are the ones worth answering without a click. Mirrors the `dims` argument
// api.ts passes to insights.concentration.
const CONCENTRATION_DIMS = [
  ["asset", "Assets"],
  ["cve", "CVEs"],
  ["supportGroup", "Support groups"],
  ["os", "Operating system"],
];

// Keep in sync with SLA_TARGETS in src/domain/config.ts and AGE_BUCKET_EDGES in
// src/domain/insights.ts (the client bundle can't import the TS domain modules). The SLA
// edge is only drawn when a single severity is in scope AND its target lands exactly on the
// first bucket edge — otherwise one line would stand for several different deadlines.
const SLA_TARGETS_DAYS = { CRITICAL: 7, HIGH: 14, MEDIUM: 30, LOW: 90, INFO: 180 };
const AGE_BUCKET_FIRST_EDGE = 7;

export async function renderOverview(main, params, ctx) {
  // A SHEET OUTLIVES THE PAINT THAT OPENED IT. `openSheet`'s own hook closes on a change of
  // ROUTE NAME only (gas_shared/ui/sheet.js), and every control in the findings toolbar below
  // rewrites this route's QUERY PARAMS — so a filter change repaints the page under an open
  // finding sheet still wired to the previous render's rows, leaving a scrim over the new
  // page with nothing on screen explaining why. Closing here, at the top of every paint,
  // covers both paths.
  closeActiveSheet();
  const boot = await bootstrap();

  // Which severities scope every section on this page: the app-wide display setting,
  // falling back to all selectable if it is empty. Read-only here — the setting is the
  // only place it changes, so every page reads the same scope.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];

  main.append(pageHeader({
    route: "overview",
    help: { term: "risk-tiers" },
    lede: "What is exploitable, where risk concentrates, and what to fix next.",
  }));
  // The route out stays a paragraph rather than joining the lede: a link inside the hero
  // sub-line would be the only interactive thing in a block that is otherwise a statement.
  main.append(el("p", { class: "page-sub" },
    el("a", { href: "#/mttr", target: "_self" }, "Remediation performance →")));

  // When one severity is in scope, a severity breakdown is one row, a severity trend is one
  // line and a severity-stacked bar is one colour. Say so rather than drawing four controls
  // that each carry no information. Repainted with the page, not fixed at load, because the
  // scope filter can narrow to one severity mid-session.
  const scopeNote = el("p", { class: "section-note" });
  main.append(scopeNote);
  function paintScopeNote(insights) {
    clear(scopeNote);
    if (sevScope.length === 1) {
      scopeNote.append(
        `This register scans ${sevTitle(sevScope[0])} severity only, so severity is not an axis `
        + "on this page. Findings are ranked by exploit intelligence, exposure and age instead.");
    }
    // The severity scope always keeps UNKNOWN alongside the chosen severities (see
    // filterSeverities), so rows whose severity never normalized are counted in every figure
    // on this page while matching no severity the register displays. The old severity card
    // carried this caveat; nothing else would, and it is exactly the kind of thing "honest
    // state" means. Optional-chained: a stale pre-fallback cache omits UNKNOWN entirely.
    const unknown = insights?.sevStats?.UNKNOWN?.total;
    if (unknown > 0) {
      if (scopeNote.firstChild) scopeNote.append(" ");
      scopeNote.append(
        `${unknown.toLocaleString()} finding${unknown === 1 ? " has" : "s have"} an `
        + "unrecognized severity — included in every count here regardless of severity scope.");
    }
  }
  paintScopeNote(null);

  const scopeChips = scopeBar({
    domain: ctx.domain, supportGroup: ctx.supportGroup, onClear: ctx.clearScope,
  });
  if (scopeChips) main.append(scopeChips);

  if (!boot.latestScan) {
    // THE SHARED FIRST-RUN NOTICE, not a hand-rolled emptyState. Nothing below this point is
    // built yet — the hero and insights hosts are appended further down — so this return
    // leaves no hero dash, no stats, and no canvas behind it.
    main.append(firstRunNotice({
      synced: false,
      hint: "Use “Run scan” in the sidebar to take the first measurement.",
    }));
    return;
  }

  // Ordered grouping path for the Breakdown table, persisted across insights repaints.
  // Seeded from the URL (?by=domain,asset) or a default: the manual groups at
  // the whole-chain view, else asset type. Mutated in place (splice/push) so the closure
  // reference stays stable.
  const groupDims = GROUP_DIMENSIONS.map(([v]) => v);
  const paramKeys = [...new Set((params.by || "").split(",").map((s) => s.trim()))]
    .filter((k) => groupDims.includes(k));
  const groupKeys = paramKeys.length
    ? paramKeys
    : (!ctx.domain && boot.domainNames.length > 1 ? ["domain"] : ["atype"]);

  // Persist the breakdown grouping path (setParams replaces the query string).
  function persistParams() {
    setParams({ by: groupKeys.join(",") });
  }

  // The hero — one per page (DESIGN.md). "Act now" is the page's whole argument in one
  // figure: of everything open, this is what carries both evidence of exploitation and a way
  // in. It is deliberately allowed to be small. `renderHero` fills this host with a second
  // `pageHeader` carrying no route, so the page still has exactly one h1.
  const heroHost = el("div", {});
  const insightsHost = el("div", {}, el("p", { class: "muted" }, "Computing insights…"));
  main.append(heroHost, insightsHost);

  renderHero(null);

  // The latest successfully-painted insights payload, held for its `scan.ts` alone: the
  // drawer sections below (Oldest open findings, Concentration, Breakdown) build their own
  // "nothing matched" states well after this closure's `insights` parameter has gone out of
  // scope, and a filter-empty state that cannot say WHEN it looked is indistinguishable from
  // one that never measured anything.
  let lastInsights = null;

  // One batched RPC; revisits paint instantly from the session cache and repaint
  // in the background only when the revalidated payload differs.
  const paint = (data) => {
    lastInsights = data;
    paintScopeNote(data);
    renderHero(data);
    renderInsights(data);
  };
  // The insights params, in one place. THE DRAWER MUST SEND THESE BYTE-FOR-BYTE: both endpoints
  // derive their cache key from them, so a drifting param would miss the entry this page just
  // warmed and pay a full `baseVisible` rebuild instead of a slice. `view` is added on top and
  // is deliberately not part of any key — all four views live in the one entry.
  function insightsParams() {
    return {
      domain: ctx.domain || "", supportGroup: ctx.supportGroup || "",
      severities: scopeParam(),
    };
  }
  async function loadInsights() {
    paint(await swrCall("api_getInsights", insightsParams(), paint));
  }
  await loadInsights();

  // Null when every selectable severity is chosen (no filter → shares the default cache
  // entry); otherwise the chosen subset, which the server keeps alongside UNKNOWN.
  function scopeParam() {
    return sevScope.length === boot.palette.selectable.length ? null : [...sevScope];
  }

  /**
   * THE HERO STRIP — a second `pageHeader`, deliberately with no `route`.
   *
   * `pageHeader({ route })` is what draws an `<h1>`, and this page already has one: the
   * static header at the top, whose `?` defines the PAGE ("risk-tiers"). Passing no route
   * here is the opt-out the shared component offers (gas_shared/ui/controls.js), so the page
   * keeps exactly one h1 while this block gets the header's three levels — hero, aside,
   * stat strip — instead of the hand-rolled `.hero` / `.hero-minis` / `.mini-*` markup it
   * used to carry. The `?` on the hero LABEL defines the FIGURE, which is a different
   * question from the one the h1's `?` answers.
   *
   * The decision of WHAT it says is `overviewHeroView` (pages/overviewModel.js) — pure, and
   * exercised in node, because the interesting cases are payload shapes (a scan that carried
   * no exposure field, an unread ledger, a median nobody measured) rather than pixels.
   */
  function renderHero(insights) {
    clear(heroHost);
    const loaded = !!(insights && insights.flatScan);
    // The register-level first run, which is NOT the page-level one above: `!boot.latestScan`
    // means nobody ever scanned, and this means a scan ran and the ledger still holds nothing
    // in scope. Both end in a dash rather than in a zero.
    const firstRun = registerFirstRunView(
      loaded && insights.population ? insights.population.inScope : 0,
      !!boot.latestScan,
      boot.latestScan ? boot.latestScan.ts : null,
    );
    const view = overviewHeroView(loaded ? insights : null, firstRun);

    const openSevs = sevEntries(openBySeverity(insights), boot.palette.order);
    // WHAT THE FIGURES WERE MEASURED OVER — the in-scope count, the severity gate the last
    // scan applied, and the base filters every query carries. Quiet on purpose: provenance,
    // not a figure, and the only place on the page that says the register is a filtered slice
    // rather than the fleet. Null (an older cached payload with no `population` block, or a
    // register nobody has read) draws nothing rather than half a sentence.
    const population = loaded && !view.firstRun ? populationLine(insights) : null;
    const aside = openSevs.length || population
      ? el("div", { class: "page-strip" },
        openSevs.length
          ? [
            sevSegmentBar(openSevs, { size: "md", label: "Open findings by severity" }),
            sevKeyRow(openSevs),
          ]
          : null,
        population ? el("p", { class: "small muted" }, population.text) : null,
      )
      : null;

    heroHost.append(pageHeader({
      hero: heroStat("Act now", view.value,
        view.qualifier + (view.scanTs ? " Scan " + fmtDate(view.scanTs) + "." : ""),
        view.lines.length ? { lines: view.lines } : null),
      aside,
      stats: view.stats.map(statFromView),
    }));
  }

  /** One `statRow` from the view model's description of it. A `rate` stat carries its base
   *  through `rateCell`/`rateView` (pages/_rates.js, pages/mttr.js) and fills a meter only
   *  where the rate was really measured — `meterPctFor` returns null otherwise, and
   *  `meter()`'s own `Number(value) || 0` would draw a confident 0% fill without it. */
  function statFromView(stat) {
    const help = stat.term
      ? (stat.lines ? { lines: stat.lines, term: stat.term } : { term: stat.term })
      : (stat.lines || null);
    if (stat.kind !== "rate") return statRow(stat.name, stat.value, stat.sub, null, help);
    const rate = rateView(stat.pct, stat.denominator, stat.denominatorLabel, stat.emptyLabel);
    return statRow(stat.name, rateCell(rate), stat.sub, meterPctFor(rate), help);
  }

  /** Open findings per severity, off `sevStats` — the per-severity `{total, open, resolved}`
   *  block. `counts` beside it is the whole current scan (open AND resolved), so a strip
   *  built from it would be a different population from every figure around it. */
  function openBySeverity(insights) {
    const stats = insights && insights.sevStats ? insights.sevStats : null;
    if (!stats) return {};
    const out = {};
    for (const sev of boot.palette.order) out[sev] = num(stats[sev] && stats[sev].open, 0);
    return out;
  }

  function renderInsights(insights) {
    clear(insightsHost);
    if (!insights.flatScan) {
      insightsHost.append(emptyState(
        "The ledger holds no per-finding scan yet.",
        "Insights need a flat (per-finding) scan — grouped scans carry only counts. " +
        "Run a scan from the sidebar.",
      ));
      return;
    }
    // Honest source: when the latest scan is grouped, insights read the last flat one.
    if (insights.scan.scanId !== boot.latestScan.scanId) {
      insightsHost.append(el("p", { class: "small muted" },
        `The latest scan is grouped (counts only) — insight sections below read the ` +
        `last per-finding scan from ${fmtDate(insights.scan.ts)}.`));
    }

    renderFunnel(insights);
    renderTiers(insights);
    renderAging(insights);
    renderSlaConsumed(insights);
    renderMovement(insights);
    renderConcentration(insights);
    // The multi-dimension group explorer (group-by controls + pie + trend + expandable tree)
    // stays in a drawer: the concentration lists above answer "where is it piling up" on the
    // page, and this answers "let me pivot it myself", which is a different, rarer question.
    insightsHost.append(el("button", {
      type: "button", style: "margin-top:12px",
      onclick: () => openSheet((body) => renderBreakdown(body),
        { title: "Breakdown", subtitle: "Group open findings by any dimension and drill in." }),
    }, "Explore breakdown →"));
    // THE REGISTER ITSELF, LAST. Everything above is an aggregate over the population; this
    // is the population. It sits at the foot because a reader arrives with a question the
    // figures answer and leaves with a row they have to act on.
    renderRegister(insights);
  }

  // ------------------------------------------------------------------- triage funnel

  /** One rung: a label, a proportional bar, the count, and its share of the step above.
   *  Bars are drawn as a share of the WIDEST step (open), so the narrowing is visible; the
   *  "N% of previous" figure is what stays readable when a step drops two orders of
   *  magnitude, which on this register it does. */
  function funnelStep({ label, value, prev, open, note, emphasis }) {
    const pctOpen = open ? Math.round((value / open) * 100) : 0;
    const width = open ? Math.max(0.6, (value / open) * 100) : 0;
    const pctPrev = prev === null || prev === undefined || !prev
      ? null : Math.round((value / prev) * 100);
    return el("div", { class: "funnel-step" + (emphasis ? " funnel-step--act" : "") },
      el("div", { class: "funnel-step__head" },
        el("span", { class: "funnel-step__label" }, label),
        el("span", { class: "funnel-step__value num" }, value.toLocaleString()),
        el("span", { class: "funnel-step__pct num muted" }, `${pctOpen}% of open`),
      ),
      el("div", { class: "funnel-track" },
        el("span", { class: "funnel-fill", style: `width:${width}%` })),
      note || pctPrev !== null
        ? el("p", { class: "funnel-step__note small muted" },
          pctPrev !== null ? `${pctPrev}% of the step above` : null,
          pctPrev !== null && note ? " · " : null,
          note || null)
        : null,
    );
  }

  function renderFunnel(insights) {
    const f = insights.funnel;
    insightsHost.append(el("h2", { class: "section-label" },
      // The book already says it, so say it once: glossaryTip shows the entry's first
      // two lines and Enter opens the whole thing on the key sheet.
      glossaryTip("Triage funnel", "triage-funnel")));
    const steps = el("div", { class: "funnel" });
    steps.append(funnelStep({
      label: "Open", value: f.open, prev: null, open: f.open,
      note: "in scope for this scan",
    }));
    steps.append(funnelStep({
      label: "Exploit intelligence present", value: f.intel, prev: f.open, open: f.open,
      note: f.unclassified
        ? `${f.unclassified.toLocaleString()} unclassified — never captured, not clean`
        : null,
    }));
    steps.append(funnelStep({
      label: "On CISA KEV, or a public exploit exists",
      value: f.exploitable, prev: f.intel, open: f.open,
    }));
    if (f.exposureKnown) {
      steps.append(funnelStep({
        label: "…and reachable from outside",
        value: f.exposed, prev: f.exploitable, open: f.open,
      }));
      steps.append(funnelStep({
        label: "…and past its SLA",
        value: f.overdue, prev: f.exposed, open: f.open,
        note: "on the vendor-fix clock", emphasis: true,
      }));
    }
    insightsHost.append(steps);
    if (!f.exposureKnown) {
      insightsHost.append(el("p", { class: "section-note" },
        "Internet exposure was not captured in this scan, so the funnel stops here — the "
        + "remaining two steps would read as zero, which is not the same as none. Run a scan "
        + "to capture exposure."));
    }
  }

  // ----------------------------------------------------------------------- risk tiers

  /** The tier card. This is the direct replacement for the old severity breakdown card:
   *  same shape, same slot, an axis that varies. Tiers are a refinement of the Program
   *  page's classifier, so the unclassified count here and there always agree. */
  function renderTiers(insights) {
    const t = insights.tiers;
    const trend = insights.tierTrend || [];
    const prev = trend.length >= 2 ? trend[trend.length - 2].byGroup : null;
    insightsHost.append(el("div", { class: "section-head" },
      el("h2", { class: "section-label" },
        // THE FIRST LINE WAS THE ACTIVE RULE'S OWN SENTENCE — a state of a setting rather
        // than a definition — so it stays in place and `term` adds the route to the general
        // entry beside it. Routed through `tipLabel` rather than `tip` because when there is
        // no rule to state there is no line either, and `tip(label, [], { term })` would
        // build a trigger whose card never opens (scheduleOpen bails on an empty lines
        // array) while Enter still navigated. tipLabel is the one place that decides between
        // the three help shapes, and `{ term }` alone is its glossary-only case.
        tipLabel("Risk tiers", insights.riskRule
          ? { lines: [`High risk is ${insights.riskRule.sentence}.`], term: "risk-tiers" }
          : { term: "risk-tiers" })),
    ));
    const card = el("div", { class: "stat-card" });
    for (const tier of TIER_ORDER) {
      const open = t.perTier[tier] || 0;
      const share = t.open ? ((open / t.open) * 100).toFixed(1) : "0.0";
      card.append(el("div", { class: "stat-card__row" },
        el("span", { class: "stat-card__name" },
          el("span", {
            class: "tier-swatch" + (tier === "unknown" ? " tier-swatch--hatch" : ""),
            "aria-hidden": "true",
            style: tier === "unknown" ? null : `background:${TIER_COLORS[tier]}`,
          }),
          el("span", { style: `color:${TIER_TEXT[tier]}` }, TIER_LABELS[tier]),
        ),
        el("span", { class: "stat-card__value-group" },
          el("span", { class: "stat-card__value num" }, open.toLocaleString()),
          el("span", { class: "stat-card__sub-value" },
            tier === "unknown"
              ? "not captured — not clean"
              : `${share}% of open`),
        ),
        prev ? deltaChip(open, prev[tier] || 0) : null,
      ));
    }
    insightsHost.append(el("div", { class: "chart-grid", style: "align-items:start" },
      card, tierTrendCard(insights)));
  }

  /** Small multiples, one frame per tier — NOT one shared axis.
   *
   *  The tiers routinely span two orders of magnitude (a dozen KEV rows beside several
   *  hundred with no known exploit). On a shared scale the small series flattens onto the
   *  baseline and reads as "nothing here", which is the opposite of what it means. Each tier
   *  gets its own scale, so shape is comparable even though height is not; the count beside
   *  the sparkline carries the magnitude the scale deliberately drops. */
  function tierTrendCard(insights) {
    const trend = insights.tierTrend || [];
    const card = el("div", { class: "chart-card" }, el("h3", {}, "Tier trend"));
    if (trend.length < 2) {
      card.append(el("p", { class: "muted small" }, "Trend appears after the second scan."));
      return card;
    }
    const grid = el("div", { class: "spark-grid" });
    const pending = [];
    for (const tier of TIER_ORDER) {
      const series = trend.map((p) => p.byGroup[tier] || 0);
      const canvas = el("canvas", {});
      grid.append(el("div", { class: "spark" },
        el("div", { class: "spark__head" },
          el("span", { class: "spark__glyph", "aria-hidden": "true",
            style: `color:${TIER_TEXT[tier]}` }, TIER_GLYPHS[tier]),
          el("span", { class: "spark__label" }, TIER_LABELS[tier])),
        el("div", { class: "spark__box" }, canvas),
        el("div", { class: "spark__value num" }, (series[series.length - 1] || 0).toLocaleString()),
      ));
      pending.push({ canvas, series, tier });
    }
    card.append(grid);
    // ONE TABLE FOR THE WHOLE GRID, NOT FIVE. All five small multiples share one x axis — the
    // same `trend` array each tier's own `series` above is read from — so a `trendTableModel`
    // over `trend` itself (one date column, one column per tier) is the row-for-row reading of
    // every sparkline at once. Five near-identical two-column "Point"/"Value" disclosures beside
    // a grid this compact would be noise: a reader who opens one learns nothing the next four
    // don't repeat, and the shared date each tier's series doesn't carry on its own is lost the
    // moment it is split five ways. `aria-details` is wired to the GRID, not to any one tier's
    // canvas — a long description naming five series belongs to the group of pictures, not to
    // one of them. And unlike each tier's own `series` (which reads a missing count as `0` so
    // the chart has something to plot), this table reads `byGroup[tier]` directly and prints a
    // genuinely unmeasured point as the em dash — the more honest of the two readings, which is
    // exactly what a data-table alternative is for.
    card.append(chartTable({
      canvas: grid,
      caption: "Every point of the five lines above: date, and each tier's open-finding count "
        + "on that date.",
      model: trendTableModel(trend, TIER_ORDER.map((tier) => ({
        key: tier,
        label: TIER_LABELS[tier],
        format: "count",
        value: (p) => (p && p.byGroup ? (p.byGroup[tier] ?? null) : null),
      }))),
    }));
    loadCharts().then((charts) => {
      for (const { canvas, series, tier } of pending) {
        charts.sparkline(canvas, series, {
          color: TIER_COLORS[tier],
          desc: `${TIER_LABELS[tier]}: ${series[0]} to ${series[series.length - 1]} open findings `
            + `across ${series.length} scans.`,
        });
      }
    }).catch(() => {
      for (const { canvas } of pending) chartUnavailable(canvas);
    });
    card.append(el("p", { class: "chart-caption muted" },
      "Tiers are computed from today's signals and applied backwards: has_kev and has_exploit "
      + "never revert, and EPSS is the peak observed. So this traces the BACKLOG moving "
      + "between tiers, not intelligence arriving."));
    return card;
  }


  // ----------------------------------------------------------------------------- aging

  /** Aging, stacked by TIER rather than by severity, with the SLA edge drawn on it.
   *
   *  Two changes from what this used to be. The stack now carries information: with one
   *  severity in scope the old chart was a single-colour "stack" with a legend explaining
   *  that one colour. And the 7-day Critical SLA lands exactly on the first bucket edge, so
   *  every bar to the right of the line is a breach — something the chart has implied since
   *  it was written and never said out loud.
   *
   *  The breach count comes from `openPastSla` on the actionable clock, the same figure the
   *  MTTR page's headline uses, so the two pages cannot print different numbers for one
   *  fleet. That is also why it can be lower than "everything past bucket one": a finding
   *  with no vendor fix available has no clock running. */
  function renderAging(insights) {
    const aging = insights.agingTier;
    insightsHost.append(sectionLabel("Aging of open findings"));
    if (!aging || !aging.totalOpen) {
      insightsHost.append(emptyState("No open findings in the durable base."));
      return;
    }
    const past = insights.pastSla ? insights.pastSla.overall : null;
    const canvas = el("canvas", { id: "aging-chart" });
    // The denominator is open findings whose SLA clock has STARTED, which is smaller than the
    // open count whenever anything is awaiting a vendor fix — those have no clock to breach.
    // Naming it in the headline is cheaper than making the reader reconcile two numbers.
    const headline = past && past.breached
      ? `${past.breached.toLocaleString()} of ${past.open.toLocaleString()} open findings with a `
        + "running SLA clock are past it."
      : "How long open findings have been open";
    insightsHost.append(el("div", { class: "chart-card" },
      el("h3", {}, headline),
      el("div", { class: "small muted", style: "margin-bottom:8px" },
        `${aging.totalOpen.toLocaleString()} still-open findings, bucketed by age since first `
        + "seen and split by risk tier."),
      el("div", { class: "chart-box" }, canvas),
      el("p", { class: "chart-caption muted" },
        "SLA is measured on the vendor-fix clock, so a finding still awaiting a patch is not "
        + "counted as a breach. Rows with no recorded age are omitted from the bars, which is "
        + "why this total can trail the open count above."),
      // The same `AGE_LABELS` / `aging.perTier` the wrapper below is handed, named once here.
      chartTable({
        canvas,
        caption: "Every bar of the stack as a count: one row per age bucket, one column per "
          + "risk tier drawn.",
        model: agingTableModel(AGE_LABELS, aging.perTier, TIER_ORDER, "Age"),
      }),
    ));
    loadCharts().then((charts) => {
      charts.stackedAgeBar(
        canvas, AGE_LABELS, aging.perTier, tierPalette(),
        "Open findings by age bucket and risk tier.",
        // The 7-day Critical SLA coincides with the first bucket edge. Only mark it when the
        // scope is a single severity whose target actually lands there — with a mixed scope
        // one edge would stand for several different deadlines and mean nothing.
        slaEdgeIndex() === null ? {} : { slaEdgeAfter: 0, slaEdgeLabel: slaEdgeLabel() },
      );
    }).catch(() => {
      chartUnavailable(canvas);
    });
    const aw = insights.awaiting;
    if (boot.settings.showNoFix !== false && aw && aw.overall > 0) {
      const pct = aw.pctOfOpen !== null && aw.pctOfOpen !== undefined
        ? ` (${aw.pctOfOpen.toFixed(0)}% of open)` : "";
      insightsHost.append(el("p", { class: "section-note" },
        `${aw.overall.toLocaleString()} open finding${aw.overall === 1 ? "" : "s"}${pct} `
        + "awaiting a vendor fix — no patch is available yet, so they sit outside the SLA "
        + "clock entirely."));
    }
    insightsHost.append(el("button", {
      type: "button", style: "margin-top:10px",
      // renderOldestPanel RETURNS its card; openSheet passes the body in and ignores the
      // return value, so it has to be appended rather than handed over directly.
      onclick: () => openSheet((body) => body.append(renderOldestPanel()), {
        title: "Oldest open findings",
        subtitle: "The longest-open findings, and the assets, support groups and manual groups "
          + "carrying the 90+ day backlog.",
      }),
    }, "Oldest open findings →"));
  }

  /** The same open findings against their OWN deadline: how much of each one's SLA window has
   *  been used, in tenths. Bucket k is time used, 9-k is time left.
   *
   *  This is the chart the aging bars above cannot be. Their edges are fixed at 7/30/90 days
   *  while the target varies fivefold across severities, which is why the SLA hairline is only
   *  drawn when a single severity is in scope (`slaEdgeIndex`) — one line cannot stand for five
   *  deadlines. Normalising by the row's own window removes the problem instead of hiding it:
   *  every severity shares one axis, and no edge is needed because EVERY DRAWN BAR IS INSIDE
   *  THE WINDOW. Hence no `slaEdgeAfter` here.
   *
   *  The stack is by SEVERITY, not by tier, and that is the point rather than an oversight:
   *  severity is what picks the denominator, so the colour on this chart names the deadline
   *  each bar was measured against. `tierPalette()` would colour by a variable this figure
   *  does not use.
   *
   *  Two populations are counted and not drawn, and the caption says so — a finding past its
   *  window has no tenth left to plot, and one with no age or no target was never measurable.
   *  Neither is a zeroth tenth. */
  function renderSlaConsumed(insights) {
    const consumed = insights.slaConsumed;
    // A cached payload written before this block existed. No section at all rather than a
    // heading over an empty state: "no open findings with a window" would be a measurement,
    // and nothing here measured anything.
    if (!consumed || !Array.isArray(consumed.labels)) return;
    insightsHost.append(sectionLabel("SLA window consumed", { term: "sla-target" }));
    const past = consumed.pastWindow && typeof consumed.pastWindow === "object"
      ? Object.values(consumed.pastWindow) : [];
    const anyPast = past.some((v) => typeof v === "number" && v > 0);
    // A measured zero, unlike the case above: rows were read and none of them landed inside a
    // window. Same empty-state pattern renderAging uses.
    //
    // KEPT AS `emptyState`, NOT `measuredEmpty` — a one-line decision, not an oversight. This
    // is a STRUCTURAL absence (no open finding has a window at all, the same shape as
    // renderAging's "No open findings in the durable base." two sections up) rather than a
    // per-filter "nothing matched" like the ranking/breakdown states below it; the page-level
    // first-run gate above has already ruled out "nobody has scanned", which is the one
    // question a date on THIS notice would add.
    if (!consumed.totalOpen && !anyPast) {
      insightsHost.append(emptyState("No open findings with a measurable SLA window."));
      return;
    }
    const canvas = el("canvas", { id: "sla-consumed-chart" });
    insightsHost.append(el("div", { class: "chart-card" },
      el("h3", {}, "How much of the SLA window is used"),
      el("div", { class: "small muted", style: "margin-bottom:8px" },
        `${(consumed.totalOpen || 0).toLocaleString()} open findings still inside their window, `
        + "placed by the tenth of it they have consumed and split by severity."),
      el("div", { class: "chart-box" }, canvas),
      el("p", { class: "chart-caption muted" }, slaConsumedCaption(consumed)),
      // The same `consumed.labels` / `consumed.perSev` the wrapper below is handed, named once
      // here — `ui/chartTable.js`'s one rule. `agingTableModel` is generic over its label
      // array; the header word is passed because these labels are tenths, not age buckets.
      chartTable({
        canvas,
        caption: "Every bar of the stack as a count: one row per tenth of the SLA window "
          + "consumed, one column per severity drawn.",
        model: agingTableModel(
          consumed.labels, consumed.perSev, boot.palette.order, "Tenth of window consumed",
        ),
      }),
    ));
    loadCharts().then((charts) => {
      charts.stackedAgeBar(
        canvas, consumed.labels, consumed.perSev, boot.palette,
        "Open findings by tenth of their SLA window consumed, stacked by severity.",
        {},
      );
    }).catch(() => {
      chartUnavailable(canvas);
    });
  }

  /** The SLA edge is only meaningful when one severity is in scope: the buckets are fixed at
   *  7/30/90 days while the target varies per severity, so a mixed scope would draw one line
   *  standing for several deadlines. Returns null when it should not be drawn. */
  function slaEdgeIndex() {
    return sevScope.length === 1 && SLA_TARGETS_DAYS[sevScope[0]] === AGE_BUCKET_FIRST_EDGE
      ? 0 : null;
  }
  function slaEdgeLabel() {
    return `${SLA_TARGETS_DAYS[sevScope[0]]}-day ${sevTitle(sevScope[0])} SLA`;
  }


  /** Right-column panel for the aging section: a segmented toggle over the oldest-open views
   *  with a ranked table beneath.
   *
   *  Each view is fetched the first time it is shown and remembered for the life of the panel,
   *  so the default costs one round trip, a re-toggle costs none, and the three views most
   *  readers never open cost nothing at all. Paging within a view stays client-side: the
   *  server ships all 100 rows of the view it answers for, and an RPC behind every Next click
   *  would trade the one thing this panel does well for bytes that do not matter. */
  function renderOldestPanel() {
    let view = "byAsset";
    // Fetched views, by name. Lives as long as the open drawer.
    const loaded = new Map();
    // Current page within the active view, reset to 0 whenever the view switches.
    let page = 0;
    // Rows per page, adjustable from the footer and kept across a view switch: a reader who
    // asked to see fifty rows meant it about the panel, not about one of its four tabs.
    let pageSize = OLDEST_PAGE_SIZE;
    // The shared segmented() control, replacing a hand-rolled .filter-bar of .seg-btn buttons.
    const toggle = segmented({
      options: OLDEST_VIEWS.map(([value, label]) => ({ value, label })),
      value: view,
      ariaLabel: "Oldest open findings view",
      onChange: (v) => {
        if (view === v) return;
        view = v;
        page = 0;
        toggle.set(v);
        ensure();
      },
    });
    const tableHost = el("div", {});
    const footerHost = el("div", {});
    const caption = el("p", { class: "chart-caption muted" });

    /** Fetch the active view unless it is already in hand, then repaint. */
    function ensure() {
      if (loaded.has(view)) { paint(); return; }
      paint(); // pending state first, so the toggle responds immediately
      const want = view;
      swrCall("api_getOldestOpen", { ...insightsParams(), view: want }, (fresh) => absorb(fresh))
        .then(absorb)
        .catch((e) => {
          console.error("[overview] getOldestOpen failed:", e);
          if (!tableHost.isConnected || view !== want) return;
          clear(tableHost).append(errorState("Couldn't load the ranked rows.",
            { detail: String((e && e.message) || e) }));
          clear(footerHost);
        });
    }

    /** Take a response only if the drawer is still open and still showing what it answers for
     *  — the toggle can be clicked again while a request is in flight, and painting a ranked
     *  table under the wrong heading is worse than a slow one. */
    function absorb(res) {
      if (!res || !tableHost.isConnected) return;
      loaded.set(res.view, res.rows || []);
      if (res.view === view) paint();
    }

    function paint() {
      caption.textContent = "Ranked by open findings older than 90 days.";
      if (!loaded.has(view)) {
        clear(tableHost).append(el("div", { role: "status", "aria-label": "Loading ranked rows" },
          ...[0, 1, 2, 3, 4].map(() =>
            el("div", { style: "margin-bottom:10px" }, skeleton("line")))));
        clear(footerHost);
        return;
      }
      const allRows = loaded.get(view) || [];
      const pageCount = Math.max(1, Math.ceil(allRows.length / pageSize));
      // Clamp when a view switch (or a smaller payload on revalidation) leaves `page` past the end.
      if (page >= pageCount) page = pageCount - 1;
      const pageRows = allRows.slice(page * pageSize, (page + 1) * pageSize);
      // The Assets view carries per-asset Subscription / Domain; other group views don't.
      // absent() rather than a typed dash: an asset with no subscription recorded is a gap in
      // the payload, and the muted dash is what says so without asserting a value.
      const extraCols = view === "byAsset"
        ? [
          {
            key: "subscription",
            label: "Subscription",
            help: ["The asset's cloud subscription."],
            cell: (g) => g.subscription || absent(),
          },
          {
            key: "domain",
            label: "Domain",
            help: ["The domain this asset resolved to."],
            cell: (g) => g.domain || absent(),
          },
        ]
        : [];
      clear(tableHost).append(
        oldestGroupTable(pageRows, OLDEST_VIEWS.find(([v]) => v === view)[1], extraCols));
      // The footer, not the bare pager it used to draw. Two things were wrong: the pager
      // printed the count unpluralised, so a one-row ranking read "1 rows"; and ten rows was
      // the only page size a reader could ever have, on a panel whose payload is a hundred.
      // onPage/onPageSize repaint from the already-loaded rows, so neither hits the server.
      clear(footerHost);
      if (allRows.length) {
        footerHost.append(tableFooter({
          page,
          pageCount,
          total: allRows.length,
          pageSize,
          sizes: OLDEST_PAGE_SIZES,
          onPage: (p) => { page = p; paint(); },
          onPageSize: (size, nextPage) => { pageSize = size; page = nextPage; paint(); },
        }));
      }
    }

    ensure();
    // THE FOURTH VIEW IS A LINK, NOT A TABLE. Individual findings live in the register at
    // the foot of the page, which holds all of them rather than the ranking's first hundred
    // and can say what each one is; asking the same question twice on one page is how two
    // counts of one population end up on one screen. `navigate` (not `setParams`) because
    // the answer is a shareable URL — and because only a real hash change re-enters the
    // route, which is what repaints the table under the new order.
    const toRegister = el("button", {
      type: "button",
      class: "linklike",
      onclick: () => {
        closeActiveSheet();
        // THE SECTION THAT IS ON SCREEN NOW IS NOT THE ONE TO SCROLL TO, and three measured
        // wrong answers are why this is not a one-liner (seeded harness, 1280x900, the
        // section sitting 3,355px down a `<main>` that is the scroll container):
        //
        //   `setTimeout(…, 0)`      `renderOverview` awaits `api_getInsights` before
        //                           `renderRegister` runs, so there is no new `#findings` yet.
        //                           Measured `scrollTop: 0`.
        //   scroll on first sight   The first frame finds the PREVIOUS render's section, still
        //                           in the DOM because the repaint has not started, and scrolls
        //                           to it as the page is torn down under it. Measured
        //                           `scrollTop: 52` against a target at 3,355.
        //   scroll on a fresh node  Better, and still early: the section arrives carrying a
        //                           SKELETON and the table that replaces it is taller.
        //
        // So: a DIFFERENT node from the one on screen now, carrying real rows. The budget is
        // frames rather than a timer because what is being waited on is a paint; when it runs
        // out the section is scrolled to anyway, which is right for the one case where no
        // repaint is coming — a reader who was already at this exact sort order, where the
        // hash does not change and no `hashchange` fires.
        const prevSection = document.getElementById("findings");
        const hashBefore = location.hash;
        navigate("overview", { by: groupKeys.join(","), sort: "age_days", dir: "desc" });
        const repainting = location.hash !== hashBefore;
        let framesLeft = 240;
        const seek = () => {
          const target = document.getElementById("findings");
          const fresh = !repainting || (target && target !== prevSection);
          const painted = target && target.querySelector("table.data tbody tr");
          if (target && fresh && (painted || framesLeft <= 0)) {
            target.scrollIntoView({ block: "start", behavior: "auto" });
            return;
          }
          if (framesLeft-- > 0) requestAnimationFrame(seek);
        };
        requestAnimationFrame(seek);
      },
    }, "Open the findings table, oldest first \u2192");
    return el("div", { class: "chart-card" },
      el("h3", {}, "Oldest open findings"),
      toggle, tableHost, footerHost, caption,
      el("p", { class: "small muted" }, toRegister));
  }

  /** Ranked table of the 90+ day open backlog per group (Group [· extras] · 90+ days · Open ·
   *  Oldest). extraCols is a dataTable column spec spliced in right after the group-name
   *  column — the Assets view uses it for Subscription / Domain; other group views pass none.
   *
   *  The column list therefore varies between views, which is fine here and would not be
   *  everywhere: the whole table is rebuilt on each paint (paint() clears tableHost), so
   *  nothing holds a stale header. */
  function oldestGroupTable(rows, dimLabel, extraCols = []) {
    if (!rows || !rows.length) {
      return measuredEmpty("No open findings to rank.", { at: lastInsights?.scan?.ts });
    }
    const columns = [
      {
        key: "key",
        label: dimLabel,
        help: [`The ${dimLabel.toLowerCase()} this row's 90+ day backlog is ranked against.`],
        cell: (g) => el("strong", {}, g.key),
      },
      ...extraCols,
      {
        key: "aged",
        label: "90+ days",
        className: "num",
        help: ["Open findings in this group older than 90 days."],
        cell: (g) => g.agedCount.toLocaleString(),
      },
      {
        key: "open",
        label: "Open",
        className: "num",
        help: ["Open findings in this group, at every age."],
        cell: (g) => g.openCount.toLocaleString(),
      },
      {
        key: "oldest",
        label: "Oldest",
        className: "num",
        help: ["The single oldest open finding in this group, in days."],
        cell: (g) => days1(g.oldestDays),
      },
    ];
    return dataTable({ columns, rows });
  }

  // ---------------------------------------------------------------------- movement

  /** Movement, promoted out of its drawer. It used to be two numbers and a button, which is
   *  a lot of vertical space to spend on a link. The four counts are the whole story and they
   *  fit in one row; the trend beside them answers the question the counts raise, which is
   *  whether this scan was typical. */
  function renderMovement(insights) {
    const m = insights.movement;
    insightsHost.append(sectionLabel("Scan-over-scan movement", { lines: [
      "Four counts against the previous scan: New, Newly resolved, Reopened and Persisting — "
      + "not a comparison to a calendar date, since the register only learns something on the "
      + "days it scans.",
    ] }));
    if (!m.hasPrevious) {
      insightsHost.append(el("p", { class: "muted" },
        "First scan — movement appears once there is a previous scan to compare against."));
      return;
    }
    // Two-up rather than the auto-fit default: this row sits in half the width beside the
    // trend, where auto-fit lands on three columns and orphans the fourth tile on its own line.
    const tiles = el("div", { class: "kpi-row kpi-row--2" },
      kpiCard("New", m.newCount.toLocaleString(), "first seen in the latest scan"),
      kpiCard("Newly resolved", m.resolvedCount.toLocaleString(), "closed since the previous scan"),
      kpiCard("Reopened", m.reopenedCount.toLocaleString(), "back after being resolved"),
      kpiCard("Persisting", m.persisting.toLocaleString(), "open since an earlier scan"),
    );
    const canvas = el("canvas", {});
    const trend = insights.openTrend || [];
    const card = el("div", { class: "chart-card" }, el("h3", {}, "Open backlog, per scan"));
    if (trend.length >= 2) {
      card.append(el("div", { class: "chart-box" }, canvas));
      card.append(el("p", { class: "chart-caption muted" },
        "Total open findings at each saved scan."));
      // trendLine reads {x, y} on a proportional epoch-day axis — NOT {date, value}.
      const points = trend.map((p) => ({
        x: p.date,
        y: Object.values(p.bySev || {}).reduce((a, b) => a + (b || 0), 0),
      }));
      // `points` — the same array the wrapper below is handed — read once, into both.
      card.append(chartTable({
        canvas,
        caption: "Every point of the line above: date and total open findings.",
        model: trendTableModel(points, [
          { key: "y", label: "Open findings", format: "count" },
        ], { dateKey: "x" }),
      }));
      loadCharts().then((charts) => {
        charts.trendLine(canvas, points, { yLabel: "Open findings" });
      }).catch(() => {
        chartUnavailable(canvas);
      });
    } else {
      card.append(el("p", { class: "muted small" }, "Trend appears after the second scan."));
    }
    insightsHost.append(el("div", { class: "chart-grid chart-grid--2", style: "align-items:start" },
      el("div", {}, tiles), card));
    if (ctx.domain || ctx.supportGroup) {
      insightsHost.append(el("p", { class: "section-note" },
        "New / Newly resolved / Reopened are scan-wide — scan-over-scan deltas can't be "
        + "split by the active filter. Persisting reflects the filtered scope."));
    }
  }

  // ----------------------------------------------------------------- concentration

  /** Where the backlog piles up, on the page rather than behind a button.
   *
   *  Ranked by OPEN findings, which is not the same ordering the breakdown tree uses (that
   *  ranks by open + resolved, because it reports on the whole scan). A group that closed
   *  everything must not outrank one that closed nothing on a list captioned "open". */
  function renderConcentration(insights) {
    const conc = insights.concentration;
    if (!conc || !conc.perDim) return;
    let dim = CONCENTRATION_DIMS.find(([k]) => conc.perDim[k]?.length)?.[0];
    if (!dim) return;
    // The shared segmented() control — this used to be a hand-rolled .seg-row of .seg-btn--sm
    // buttons, one of five duplicates of the same aria-pressed recipe across this app.
    const availableDims = CONCENTRATION_DIMS.filter(([value]) => conc.perDim[value]);
    const toggle = segmented({
      options: availableDims.map(([value, label]) => ({ value, label })),
      value: dim,
      ariaLabel: "Concentration dimension",
      onChange: (v) => {
        if (dim === v) return;
        dim = v;
        toggle.set(v);
        paintList();
      },
    });
    const listHost = el("div", {});
    const noteHost = el("p", { class: "section-note" });

    function paintList() {
      const rows = conc.perDim[dim] || [];
      const more = conc.moreDim ? conc.moreDim[dim] || 0 : 0;
      const top = rows.length ? rows[0].open : 0;
      const list = el("div", { class: "rank-list" });
      for (const row of rows) {
        const width = top ? Math.max(1, (row.open / top) * 100) : 0;
        // Blast radius is only interesting when the group ISN'T an asset — grouping by asset
        // and then reporting "1 asset" on every row is a column of noise.
        const meta = [];
        if (dim !== "asset") {
          meta.push(`${row.assets.toLocaleString()} asset${row.assets === 1 ? "" : "s"}`);
        }
        if (row.kev) meta.push(`${row.kev.toLocaleString()} on CISA KEV`);
        list.append(el("div", { class: "rank-row" },
          el("div", {},
            el("div", { class: "rank-row__name" }, row.key),
            el("div", { class: "mix-strip", "aria-hidden": "true" },
              el("span", { style: `width:${width}%; background:#6b7280` })),
            meta.length ? el("div", { class: "small muted" }, meta.join(" · ")) : null,
          ),
          el("div", { class: "num rank-row__value" }, row.open.toLocaleString()),
        ));
      }
      // Dated: an empty rank list under a dimension the reader just picked is a measurement
      // of THIS scan's open findings, not a claim that the dimension itself is broken.
      clear(listHost).append(rows.length
        ? list
        : measuredEmpty("Nothing open in this dimension.", { at: insights.scan.ts }));
      // Never let a truncated list read as a complete one.
      noteHost.textContent = more
        ? `Top ${rows.length} by open findings · ${more.toLocaleString()} more not shown.`
        : `All ${rows.length} ranked by open findings.`;
    }

    insightsHost.append(el("div", { class: "section-head" },
      el("h2", { class: "section-label" }, "Where it concentrates"), toggle));
    insightsHost.append(listHost, noteHost);
    paintList();
  }


  // ------------------------------------------------------------- the findings themselves

  /**
   * THE REGISTER'S OWN ROWS — server-paged, server-sorted, one per finding.
   *
   * Every other read model on this page is an AGGREGATE, and the one question a reader
   * arrives with ("show me the findings, and let me sort them") had no answer on the page at
   * all. `api_getRegisterRows` is the endpoint that does: the whole ledger, not a page the
   * browser holds, so a click on a heading re-fetches rather than re-sorting an array in
   * hand. The ordering rule lives on the server (`domain/pagePayload.ts`'s
   * `sortRegisterRows`) and this component only ever reads back what the server ordered.
   *
   * EVERY CONTROL WRITES THE URL, through `navigate` and never `setParams`.
   * `history.replaceState` fires no `hashchange`, so a filter would rewrite the URL and leave
   * the page showing the previous fetch — and, more to the point, a filtered register has to
   * be a LINK somebody can send. That is what lets the Executive page's fix-next list land on
   * a filtered table rather than on the whole register.
   */
  function renderRegister(insights) {
    const filters = readRegisterParams(params);
    const scanTs = insights && insights.scan ? insights.scan.ts : null;
    const section = el("section", { id: "findings" });
    section.append(sectionLabel("Findings", {
      lines: [
        "Every finding the register holds, open and resolved, one row each — server-paged "
        + "and server-sorted, so pressing a heading asks for a different order rather than "
        + "re-arranging what is already on screen.",
        "Open a row for everything the register knows about that finding.",
      ],
    }));
    section.append(registerToolbar(filters, insights));
    section.append(registerRowsTable(filters, scanTs));
    insightsHost.append(section);
  }

  /** Rewrite the hash with one filter changed, KEEPING the params this page owns for other
   *  reasons (`by`, the breakdown grouping path). A control that silently dropped them would
   *  reset the drawer every time somebody changed a tier. The page index resets on any filter
   *  change: page 4 of the old set is not page 4 of the new one. */
  function goFilters(filters, patch) {
    navigate("overview", {
      by: groupKeys.join(","),
      ...registerParamPatch({ ...filters, page: 0 }),
      ...patch,
    });
  }

  /** Status, fix availability, tier and reachability, as one toolbar. */
  function registerToolbar(filters, insights) {
    const bar = el("div", { class: "toolbar" });

    bar.append(el("div", { class: "toolbar-group" },
      el("span", { class: "small muted" }, "State"),
      segmented({
        options: [
          { value: "open", label: "Open",
            title: "Only findings still in the register." },
          { value: "resolved", label: "Resolved",
            title: "Only findings that have left it. Read the State word beside each one: a "
              + "resolution can be an observed event or a scan that stopped seeing it." },
          { value: "all", label: "All",
            title: "Open and resolved together, the whole register." },
        ],
        value: filters.status,
        ariaLabel: "Findings: state",
        onChange: (v) => goFilters(filters, { status: v === "open" ? "" : v }),
      })));

    bar.append(el("div", { class: "toolbar-group" },
      el("span", { class: "small muted" }, "Fix"),
      segmented({
        options: [
          { value: "all", label: "All", title: "Every row, whatever the vendor has published." },
          { value: "fixable", label: "Fix available",
            title: "Only rows where a vendor fix has been observed, which are the ones whose "
              + "actionable clock has started." },
          { value: "awaiting", label: "Awaiting vendor fix",
            title: "Only open rows with no published patch. They are waiting on a vendor, "
              + "not on a team, and they sit outside the SLA clock entirely." },
        ],
        value: filters.fix,
        ariaLabel: "Findings: fix availability",
        onChange: (v) => goFilters(filters, { fix: v === "all" ? "" : v }),
      })));

    // NEUTRAL PILLS, NOT SEVERITY PILLS. `togglePills` defaults to `pillClass: "sev-pill"`
    // and `sevClass: true`, which would stamp a `sev-kev` class onto a control that is not a
    // severity filter — and a tier is emphatically not a severity here (gas/README.md,
    // "exploitability is the spine, not severity"). `unknown` KEEPS ITS PILL AND ITS WORD:
    // it is a measurement gap, and a filter that silently omitted it would make the rows
    // nobody looked at unreachable from this table.
    bar.append(el("div", { class: "toolbar-group" },
      el("span", { class: "small muted" }, "Tier"),
      togglePills({
        options: TIER_ORDER.map((t) => ({ value: t, label: TIER_LABELS[t] })),
        selected: filters.tier,
        ariaLabel: "Findings: risk tier",
        pillClass: "kind-pill",
        sevClass: false,
        onToggle: (t) => {
          const next = new Set(filters.tier);
          if (next.has(t)) next.delete(t);
          else next.add(t);
          goFilters(filters, { tier: TIER_ORDER.filter((x) => next.has(x)).join(",") });
        },
      })));

    // THE EXPOSURE TOGGLE IS DISABLED WITH A REASON, not hidden and not silently satisfied.
    // `exposureKnown: false` means the last scan carried no exposure field at all, so
    // applying the filter would answer "0 internet-facing findings" — a measurement — where
    // the truth is that nothing looked. A disabled control does not reliably take the
    // pointer/focus events a bare tooltip needs, which is why the reason arrives through
    // `tipAnchor` on a wrapper rather than through `tip()` on the button itself.
    const supported = !!(insights && insights.funnel && insights.funnel.exposureKnown);
    const exposedBtn = el("button", {
      type: "button",
      class: "kind-pill",
      "aria-pressed": filters.exposed ? "true" : "false",
      disabled: supported ? null : "",
      onclick: () => goFilters(filters, { exposed: filters.exposed ? "" : "1" }),
    }, "Internet-reachable only");
    bar.append(el("div", { class: "toolbar-group" },
      el("span", { class: "small muted" }, "Reachability"),
      supported
        ? exposedBtn
        : el("span", { class: "tip-disabled-wrap" },
          tipAnchor(exposedBtn, () => [
            "The last scan carried no exposure field, so a reachable host cannot be told "
            + "from one that is not. Filtering on it would answer 0 — a measurement — where "
            + "the truth is that nothing looked.",
          ]))));
    return bar;
  }

  /** The columns, with a definition on every heading. Every `sortable` key is a member of
   *  `REGISTER_ROW_COLUMNS`, so the server never falls back to its default order behind a
   *  heading a reader just pressed. */
  function registerColumns() {
    return [
      {
        // SEVERITY SORTS BY MEANING, and the server ranks it against `SEVERITY_ORDER` where
        // CRITICAL is 0 — so ASCENDING is worst-first. A register that defaulted this column
        // to descending would open on LOW.
        key: "severity", label: "Severity", sortable: true,
        help: ["The finding's severity as the scan assigned it. Sorted by MEANING rather "
          + "than alphabetically: ascending is worst-first."],
        cell: (r) => sevBadge(r.severity),
      },
      {
        key: "cve", label: "CVE", sortable: true,
        help: ["The finding's CVE identifier. The link opens its NVD entry."],
        cell: (r) => (r.cve
          ? el("a", { href: nvdUrl(r.cve), target: "_blank", rel: "noopener" }, r.cve)
          : absent()),
      },
      {
        key: "risk_tier", label: "Tier", sortable: true,
        help: { term: "unclassified", lines: [
          "Which exploit signal put this finding where it is, under the risk rule in force. "
          + "Unclassified is a measurement gap, not a low score.",
        ] },
        cell: (r) => (r.risk_tier ? (TIER_LABELS[r.risk_tier] || r.risk_tier) : absent()),
      },
      {
        key: "asset_name", label: "Asset", sortable: true,
        help: ["The host workload carrying this finding."],
        cell: (r) => r.asset_name || absent(),
      },
      {
        key: "subscription_name", label: "Subscription", sortable: true,
        help: ["The cloud subscription the asset belongs to."],
        cell: (r) => r.subscription_name || absent(),
      },
      {
        key: "support_group", label: "Support group", sortable: true,
        help: ["The owning group, from the subscription map. A dash is a gap in attribution, "
          + "not a finding nobody owns."],
        cell: (r) => r.support_group || absent(),
      },
      {
        key: "first_seen", label: "First seen", sortable: true,
        help: ["The first scan that returned this finding, where the detection clock starts."],
        cell: (r) => fmtDate(r.first_seen),
      },
      {
        key: "awaiting_vendor_fix", label: "Fix", sortable: true,
        help: { term: "awaiting-fix" },
        cell: (r) => fixLabel(r.awaiting_vendor_fix),
      },
      {
        key: "has_kev", label: "KEV", sortable: true,
        help: { term: "kev" },
        cell: (r) => triCell(r.has_kev),
      },
      {
        key: "has_exploit", label: "Exploit", sortable: true,
        help: { term: "known-exploit" },
        cell: (r) => triCell(r.has_exploit),
      },
      {
        key: "epss", label: "EPSS", className: "num", sortable: true,
        help: { term: "epss" },
        cell: (r) => (r.epss === null || r.epss === undefined
          ? absent() : pct1(Number(r.epss) * 100)),
      },
      {
        key: "internet_exposed", label: "Reachable", sortable: true,
        help: { term: "internet-exposed", lines: [
          "A dash is not a No: either the scan carried no exposure field, or the finding is "
          + "no longer in the current frame at all, which every row resolved by "
          + "disappearance is.",
        ] },
        cell: (r) => triCell(r.internet_exposed),
      },
      {
        key: "age_days", label: "Age", className: "num", sortable: true,
        help: { term: "age" },
        cell: (r) => days1(r.age_days),
      },
      {
        // The server sorts the raw `status` column; the word below is a rendering of it and
        // of `resolution_src` / `reopened_count`, which ride the same row unsorted.
        key: "status", label: "State", sortable: true,
        help: { term: "returned", lines: [
          PROVENANCE_HELP.bounded,
          PROVENANCE_HELP.returned,
        ] },
        cell: (r) => PROVENANCE_LABEL[provenance(r)],
      },
    ];
  }

  /** The paged table itself. `swrCall` for the first page (a revisit paints from the session
   *  cache while it revalidates); a plain `call` for every navigation after it, because a
   *  reader who pressed Next is asking for something the cache cannot already hold. */
  function registerRowsTable(filters, scanTs) {
    const state = {
      page: filters.page, pageSize: DEFAULT_PAGE_SIZE, sort: filters.sort, dir: filters.dir,
    };
    const host = el("div", { class: "table-host" });
    let first = true;

    function requestParams() {
      const p = {
        domain: ctx.domain || "", supportGroup: ctx.supportGroup || "",
        severities: scopeParam(),
        page: state.page, pageSize: state.pageSize, sort: state.sort, dir: state.dir,
        status: filters.status, fix: filters.fix,
      };
      if (filters.tier.length) p.tier = filters.tier.join(",");
      if (filters.exposed) p.exposed = true;
      return p;
    }

    function load() {
      host.replaceChildren(skeletonStack(5, {
        widths: ["100%", "100%", "100%", "90%", "70%"],
      }));
      const p = requestParams();
      const send = first ? swrCall("api_getRegisterRows", p) : call("api_getRegisterRows", p);
      first = false;
      send.then((data) => paint(data || {})).catch((e) => {
        host.replaceChildren(errorState("This table could not be loaded.", {
          detail: e && e.message ? e.message : String(e),
          onRetry: load,
        }));
      });
    }

    function paint(data) {
      const rows = Array.isArray(data.rows) ? data.rows : [];
      // The SERVER is the one source of truth for what it actually served — a clamped page
      // or a sort it refused answers back through these, so the footer and the active
      // heading never advertise a request the server declined.
      state.page = num(data.page, state.page);
      state.pageSize = num(data.pageSize, state.pageSize);
      state.sort = data.sort || state.sort;
      state.dir = data.dir === "asc" ? "asc" : "desc";
      const table = dataTable({
        columns: registerColumns(),
        rows,
        stickyHeader: true,
        sort: { key: state.sort, descending: state.dir === "desc" },
        onSort: (key) => {
          state.dir = state.sort === key && state.dir === "desc" ? "asc" : "desc";
          state.sort = key;
          state.page = 0;
          load();
        },
        // THE DRILL-DOWN, and `rows` is exactly the server page in hand — prev/next inside
        // the sheet walks these and no more, because these are the rows the reader can see.
        onRowOpen: (r) => openFindingSheet(r, { rows }),
        rowLabel: (r) => findingRowLabel(r),
        emptyText: "Nothing in this register.",
      });
      const footer = tableFooter({
        page: state.page,
        pageCount: num(data.pageCount, 1),
        total: num(data.total, rows.length),
        pageSize: state.pageSize,
        onPage: (pg) => { state.page = pg; load(); },
        onPageSize: (size, nextPage) => {
          state.pageSize = size;
          state.page = nextPage;
          load();
        },
      });
      // A FILTER THAT MATCHES NOTHING KEEPS ITS FIGURES, and says WHICH filters narrowed it.
      // An unfiltered empty register is a different state and gets `emptyText` instead — a
      // shared "nothing matched the current filters" there would name controls that are not
      // doing anything.
      const sentence = rows.length === 0 && activeRegisterFilters(filters)
        ? filterSentence(filters) : null;
      const notice = sentence ? measuredEmpty(sentence, { at: scanTs }) : null;
      host.replaceChildren(table, footer, ...(notice ? [notice] : []));
    }

    load();
    return host;
  }


  // --------------------------------------------------------------------- breakdown

  /** Consolidated breakdown: an ordered grouping path (Domain → Asset → …) rendered as
   *  an expandable tree table. Domain and CVE are just dimensions here — grouping by CVE
   *  reproduces the old Top-CVEs table. Data comes from api_getGrouping (the insights
   *  payload doesn't carry arbitrary N-level groupings). */
  function renderBreakdown(host) {
    const controls = el("div", { class: "filter-bar" });
    const tableHost = el("div", {});

    // Two charts over the top-level grouping key: a pie partitioning open findings across
    // the top groups (current scan, from the grouping payload the tree already fetched) and
    // a line tracing those same groups over scan history (a separate ledger-replay endpoint).
    // Both color a group via one groupPalette, so its hue is stable across the pair; each
    // card swaps its canvas for a muted message when there's nothing to draw.
    const pieCanvas = el("canvas", {});
    const pieMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    const pieCaption = el("p", { class: "chart-caption muted" });
    const pieTableHost = el("div", {});
    const lineCanvas = el("canvas", {});
    const lineMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    const lineCaption = el("p", { class: "chart-caption muted" });
    const lineTableHost = el("div", {});
    const chartGrid = el("div", { class: "chart-grid", style: "align-items:start" },
      el("div", { class: "chart-card" },
        el("h3", {}, "Group share"),
        el("div", { class: "chart-box" }, pieCanvas, pieMsg),
        pieCaption, pieTableHost),
      el("div", { class: "chart-card" },
        el("h3", {}, "Group trend"),
        el("div", { class: "chart-box" }, lineCanvas, lineMsg),
        lineCaption, lineTableHost),
    );
    host.append(controls, chartGrid, tableHost);
    renderControls();
    loadGrouping();

    // Swap a card between its live canvas and a centered muted message.
    function showChart(canvas, msg) {
      msg.style.display = "none";
      canvas.style.display = "";
    }
    function showMsg(canvas, msg, text) {
      // Still fire-and-forget — the message swap below does not wait on the teardown, and
      // there is nothing to destroy if Chart.js never loaded. What it is NOT is a plain
      // `display = "none"`: Chart.js's destroy restores the canvas's pre-chart inline
      // `display` and lands after this line, so the hidden canvas reappears above the message
      // as a bare 300x150 box (see `charts.js::hideChartWhenSettled` for the measurement, taken
      // on the MTTR page's lens swap — this card has the identical shape). The canvas stays
      // hidden for exactly as long as the message is up, which is what the predicate reads.
      hideChartWhenSettled(canvas, loadCharts, () => msg.style.display !== "none");
      msg.textContent = text;
      msg.style.display = "";
    }

    /** Repaint both breakdown charts from a fresh grouping payload. Charts are open-centric
     *  (the tree sorts by total), so rank the top-level groups by open, keep the top five
     *  with any open finding, and fold ranks past five into one neutral "Other". Five matches
     *  the categorical palette size (charts.js CATEGORICAL). The pie renders from this scan's
     *  payload; the line replays the ledger over scan history. */
    function renderCharts(data) {
      const key0 = groupKeys[0];
      const ranked = ((data && data.groups) || [])
        .filter((n) => (n.open || 0) > 0)
        .sort((a, b) => (b.open || 0) - (a.open || 0));
      const head = ranked.slice(0, 5);
      const tailOpen = ranked.slice(5).reduce((a, n) => a + (n.open || 0), 0);
      const names = head.map((n) => n.key);
      const colors = groupPalette(names);
      const dimLabel = labelFor(key0);

      // Pie: current-scan partition. Works for every dimension (including os).
      pieCaption.textContent = "Open findings by " + dimLabel + ", this scan.";
      if (!head.length) {
        showMsg(pieCanvas, pieMsg, "No open findings to partition.");
        clear(pieTableHost);
      } else {
        const slices = head.map((n) => ({ label: n.key, value: n.open, color: colors.get(n.key) }));
        if (tailOpen > 0) {
          slices.push({ label: "Other", value: tailOpen, color: colors.get("Other") });
        }
        showChart(pieCanvas, pieMsg);
        // `slices` — the same array the wrapper below is handed — read once, into both.
        clear(pieTableHost).append(chartTable({
          canvas: pieCanvas,
          caption: "Every slice of the pie above: group, count and share of the total.",
          model: pieTableModel(slices),
        }));
        loadCharts().then((charts) => {
          charts.groupPie(pieCanvas, slices);
        }).catch(() => {
          chartUnavailable(pieCanvas);
        });
      }

      // Line: ledger-replay trend for the same top groups.
      lineCaption.textContent = "Open findings by " + dimLabel + ", per scan.";
      // The ledger has no operating-system column, so an OS trend can't be reconstructed
      // (accepted limitation); skip the fetch and show an honest empty state — the pie above
      // still renders from the current scan.
      if (key0 === "os") {
        showMsg(lineCanvas, lineMsg, "Historical trend isn't available for operating system.");
        clear(lineTableHost);
        return;
      }
      if (!names.length) {
        showMsg(lineCanvas, lineMsg, "No groups to trend.");
        clear(lineTableHost);
        return;
      }
      const series = head.map((n) => ({ name: n.key, color: colors.get(n.key) }));
      if (tailOpen > 0) series.push({ name: "Other", color: colors.get("Other") });
      const params = {
        domain: ctx.domain || "", supportGroup: ctx.supportGroup || "",
        key: key0, groups: names, severities: scopeParam(),
      };
      const paintTrend = (td) => {
        if (key0 !== groupKeys[0]) return; // a newer top-level selection superseded this
        if (!td || td.supported === false) {
          showMsg(lineCanvas, lineMsg, "Historical trend isn't available for this grouping.");
          clear(lineTableHost);
        } else if (!td.points || td.points.length < 2) {
          showMsg(lineCanvas, lineMsg, "Trend appears after the second scan.");
          clear(lineTableHost);
        } else {
          showChart(lineCanvas, lineMsg);
          // `td.points` / `series` — the same references the wrapper below is handed.
          clear(lineTableHost).append(chartTable({
            canvas: lineCanvas,
            caption: "Every point of the lines above: date and each group's open-finding "
              + "count.",
            model: trendTableModel(td.points, series.map((s) => ({
              key: s.name,
              label: s.name,
              format: "count",
              value: (p) => (p && p.byGroup ? (p.byGroup[s.name] ?? null) : null),
            }))),
          }));
          loadCharts().then((charts) => {
            charts.groupTrendLines(lineCanvas, td.points, series);
          }).catch(() => {
            chartUnavailable(lineCanvas);
          });
        }
      };
      loadTrend();
      async function loadTrend() {
        showMsg(lineCanvas, lineMsg, "Loading trend…");
        clear(lineTableHost);
        try {
          paintTrend(await swrCall("api_getGroupTrend", params, paintTrend));
        } catch (e) {
          if (key0 === groupKeys[0]) showMsg(lineCanvas, lineMsg, "Trend is unavailable.");
        }
      }
    }

    function labelFor(dim) {
      const found = GROUP_DIMENSIONS.find(([v]) => v === dim);
      return found ? found[1] : dim;
    }

    function renderControls() {
      clear(controls);
      groupKeys.forEach((key, i) => {
        const used = new Set(groupKeys.filter((_, j) => j !== i));
        const sel = el("select", { "aria-label": i === 0 ? "Group by" : `then group by (level ${i + 1})` },
          ...GROUP_DIMENSIONS
            .filter(([v]) => v === key || !used.has(v))
            .map(([v, label]) => el("option", { value: v, selected: v === key || null }, label)),
        );
        sel.addEventListener("change", () => { groupKeys[i] = sel.value; syncAndReload(); });
        // The "×" is the whole label, so what it removes has to be said somewhere: the
        // aria-label says it to assistive technology and a `title` used to say it to a mouse.
        // el() throws on `title` now, and `tip` on a button attaches in place — no second
        // control inside the one the reader sees, and no duplicate announcement, because an
        // in-place tip is visual only where an aria-label is already carrying the name.
        const remove = groupKeys.length > 1
          ? tip(el("button", { class: "linklike danger", "aria-label": "Remove grouping level",
              onclick: () => { groupKeys.splice(i, 1); syncAndReload(); } }, "×"),
            ["Remove this level"])
          : null;
        controls.append(el("div", { class: "field" },
          el("label", { class: "field-label" }, i === 0 ? "Group by" : "then by"),
          el("div", { style: "display:flex; gap:6px; align-items:center" }, sel, remove)));
      });
      if (groupKeys.length < GROUP_DIMENSIONS.length) {
        const next = groupDims.find((v) => !groupKeys.includes(v));
        controls.append(el("div", { class: "field" },
          el("label", { class: "field-label", "aria-hidden": "true" }, " "),
          el("button", { onclick: () => { groupKeys.push(next); syncAndReload(); } }, "+ Add level")));
      }
    }

    function syncAndReload() {
      persistParams();
      renderControls();
      loadGrouping();
    }

    async function loadGrouping() {
      clear(tableHost).append(el("p", { class: "muted" }, "Grouping…"));
      const keys = groupKeys.slice();
      const paint = (data) => {
        if (keys.join(",") !== groupKeys.join(",")) return; // a newer path superseded this
        renderTree(tableHost, (data && data.groups) || []);
        renderCharts(data);
      };
      paint(await swrCall("api_getGrouping",
        { domain: ctx.domain || "", supportGroup: ctx.supportGroup || "",
          keys, severities: scopeParam() }, paint));
    }
  }

  /** Render a nested GroupNode[] into the Top-CVEs-style table.data, with expandable
   *  rows: the top level is open, deeper levels collapsed until their parent expands.
   *
   *  STILL HAND-BUILT, and dataTable is the reason rather than the omission. Three things it
   *  cannot express, each load-bearing here:
   *
   *    - a TREE. Its only disclosure primitive is `rowDetail`, one full-width colspan row
   *      after a trigger. This is N levels of same-shaped rows whose visibility is toggled by
   *      `display` on a `<tr>` the caller kept a handle on; dataTable builds its own `<tr>`s
   *      and hands back none, so the only route is repainting through `setRows` — which
   *      destroys the caret the keyboard reader just pressed and drops focus to the body.
   *    - a per-ROW cell class. `td.clickable` (pages.css) puts the pointer cursor on the
   *      group cell of a row that HAS children and leaves a leaf alone; `col.className` is
   *      per column, so every row would claim to expand.
   *    - a per-row cell style. Depth is drawn as `padding-left: depth * 20 + 8px` on that
   *      same `<td>`, and there is nowhere in the column spec to put it.
   *
   *  Converting it would trade a working tree for a flat table that lies about focus. */
  function renderTree(host, groups) {
    clear(host);
    if (!groups.length) {
      // Dated to the last insights scan this closure has seen: the grouping RPC's own
      // payload carries no scan timestamp of its own (api.ts's getGrouping ships only
      // `{flatScan, keys, groups}`), and the two read the same durable base.
      host.append(measuredEmpty("Nothing to break down for this grouping.",
        { at: lastInsights?.scan?.ts }));
      return;
    }
    // TREE_HEAD carries help alongside the plain label list this used to be — `tipLabel` was
    // already imported for the tips elsewhere on this page, so giving the tree's own `<th>`s a
    // definition needed no restructuring of `renderTree` at all, only this one array.
    const TREE_HEAD = [
      ["Group", ["The value of the active grouping dimension, chosen above — domain, asset, "
        + "CVE or another axis."]],
      ["Severity", ["The open findings in this group, split by severity — never color alone."]],
      ["Assets", ["Distinct assets carrying at least one finding in this group."]],
      ["Findings", ["All findings ever tracked in this group, open and resolved."]],
      ["Open", ["Findings in this group not yet resolved."]],
      ["Risk", ["Whether any finding in this group is on the CISA KEV catalog or has a "
        + "public exploit."]],
    ];
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        ...TREE_HEAD.map(([h, help]) => el("th", { scope: "col" }, tipLabel(h, help))))),
    );
    const tbody = el("tbody", {});
    table.append(tbody);

    const rows = [];
    const expanded = new Set();
    let idc = 0;
    (function walk(nodes, depth, parentId) {
      for (const node of nodes) {
        const id = idc++;
        const hasChildren = node.children && node.children.length > 0;
        if (depth === 0) expanded.add(id); // top level starts open
        rows.push({ node, id, parentId, depth, hasChildren });
        if (hasChildren) walk(node.children, depth + 1, id);
      }
    })(groups, 0, -1);

    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const row of rows) {
      row.tr = buildRow(row);
      tbody.append(row.tr);
    }
    host.append(el("div", { class: "table-wrap" }, table));
    host.append(el("p", { class: "small muted", style: "margin-top:8px" },
      "Busiest groups first; up to 20 per level. Click a group to drill in."));
    applyVisibility();

    function visible(row) {
      if (row.parentId < 0) return true;
      const parent = byId.get(row.parentId);
      return visible(parent) && expanded.has(parent.id);
    }
    function applyVisibility() {
      for (const row of rows) {
        row.tr.style.display = visible(row) ? "" : "none";
        const caret = row.tr.querySelector(".tree-caret");
        if (caret) {
          const open = expanded.has(row.id);
          caret.textContent = open ? "▾" : "▸";
          caret.setAttribute("aria-expanded", open ? "true" : "false");
        }
      }
    }
    function toggle(id) {
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      applyVisibility();
    }

    function buildRow(row) {
      const { node, depth, hasChildren, id } = row;
      const label = node.dim === "cve" && node.key !== "(none)"
        ? el("a", { href: nvdUrl(node.key), target: "_blank", rel: "noopener" }, node.key)
        : el("strong", {}, node.key);
      let caret;
      if (hasChildren) {
        // Keyboard toggle lives on the caret; pointer users get the whole label cell (below).
        caret = el("span", { class: "tree-caret", role: "button", tabindex: "0",
          "aria-label": "Expand or collapse group",
          "aria-expanded": expanded.has(id) ? "true" : "false" }, "▸");
        caret.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(id); }
        });
      } else {
        caret = el("span", { class: "tree-caret-spacer", "aria-hidden": "true" });
      }
      const risky = [];
      if (node.kev) risky.push("KEV");
      if (node.exploit) risky.push("Exploit");
      // Unassigned/untagged buckets get a quick escape hatch to the Attribution page's
      // troubleshooting view. `e.target.closest("a")` below already exempts anchor clicks
      // from the row's own expand/collapse toggle (shared with the CVE link).
      const needsInvestigate = (node.dim === "domain" && node.key === "Unassigned") ||
        (node.dim === "supportGroup" && node.key === "(none)");
      const investigateLink = needsInvestigate
        ? el("a", { class: "small muted", style: "margin-left:6px", href: "#/attribution", target: "_self" },
            "investigate →")
        : null;
      const groupCell = el("td",
        { class: hasChildren ? "clickable" : null, style: `padding-left:${depth * 20 + 8}px` },
        el("span", { style: "display:inline-flex; align-items:center; gap:6px" }, caret, label, investigateLink));
      if (hasChildren) {
        // The whole group cell toggles (the footer promises "click a group to drill in"),
        // except clicks on a CVE link, which should still open NVD.
        groupCell.addEventListener("click", (e) => {
          if (e.target.closest("a")) return;
          toggle(id);
        });
      }
      return el("tr", {},
        groupCell,
        // Severity is the shared distribution bar plus the exact per-severity counts —
        // never color alone. `sevSegmentBar` at the in-row size replaced a private
        // `mixStrip`/`mixText` pair that reimplemented the same geometry off
        // `boot.palette` and spelled the counts a fourth way; the bar takes no `label`, so
        // it is aria-hidden decoration and the visible text beside it is the announcement.
        // `sevEntries` drops the empty levels, which is what makes an all-zero group render
        // as `absent()` rather than as an empty rectangle.
        el("td", {},
          el("div", { class: "mix-cell" },
            sevSegmentBar(sevEntries(node.sevCounts, boot.palette.order), { size: "xs" }),
            // absent() rather than a typed dash: a group with no severity counts had none
            // reported, which is not the same as a group whose mix is empty by measurement.
            el("span", { class: "mix-text small muted num" },
              sevSpoken(sevEntries(node.sevCounts, boot.palette.order)) || absent()))),
        el("td", { class: "num" }, node.assets.toLocaleString()),
        el("td", { class: "num" }, node.total.toLocaleString()),
        el("td", { class: "num" }, node.open.toLocaleString()),
        el("td", {}, risky.join(" · ") || ""),
      );
    }
  }

}
