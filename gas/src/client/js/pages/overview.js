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
  groupPalette, tierPalette,
} from "../charts.js";
import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { bootstrap, setParams, swrCall } from "../../../../../gas_shared/store.js";
import {
  absent, clear, dataTable, el, emptyState, errorState, fmtDate, glossaryTip, kpiCard, nvdUrl, openSheet, pageHeader, scopeBar, sectionLabel, skeleton, tableFooter, tip,
  tipAnchor, tipLabel,
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

// Whole-day label for an age in days ("412d"). The server ships fractional day counts.
//
// NOT `fmtDays`, and the rename is what stops an accident rather than a style preference:
// the barrel now carries a `fmtDays` of its own (gas_shared/ui/figures.js, "412 days") and a
// `fmtSpan` (ui/span.js, "1.1y"), and THIS one is neither. A page that later adds `fmtDays`
// to its import list would have shadowed or redeclared it silently.
function fmtAgeDays(n) {
  return `${Math.round(n).toLocaleString()}d`;
}

/** Streamlit-style signed delta chip vs a previous value: arrow + absolute change +
 *  "· ±N%". A rising count is worse (red), falling is better (green), unchanged shows a
 *  neutral ±0. Returns null when there's no previous value to compare against. */
function deltaChip(current, previous) {
  if (previous === null || previous === undefined || Number.isNaN(previous)) return null;
  const delta = current - previous;
  if (!delta) return el("span", { class: "sev-delta flat", "aria-label": "unchanged" }, "±0");
  const rising = delta > 0;
  const arrow = rising ? "▲" : "▼";
  const sign = rising ? "+" : "−";
  const mag = Math.abs(delta).toLocaleString();
  const pct = previous ? Math.round(Math.abs((delta / previous) * 100)) : null;
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

// Oldest-open panel toggle views: [payload key, label]. "findings" lists individual
// findings; the rest key insights.oldest.{byAsset,bySupportGroup,byDomain} and rank each
// entity by its 90+ day open backlog.
const OLDEST_VIEWS = [
  ["findings", "Findings"],
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
  const boot = await bootstrap();

  // Which severities scope every section on this page: the app-wide display setting,
  // falling back to all selectable if it is empty. Read-only here — the setting is the
  // only place it changes, so every page reads the same scope.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];

  main.append(pageHeader({
    route: "overview",
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
    main.append(emptyState(
      "No scan saved yet.",
      "Use “Run scan” in the sidebar to take the first measurement.",
    ));
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

  // The hero — one per page, borderless (DESIGN.md). "Act now" is the page's whole argument
  // in one figure: of everything open, this is what carries both evidence of exploitation and
  // a way in. It is deliberately allowed to be small.
  const heroHost = el("div", { class: "hero" });
  const insightsHost = el("div", {}, el("p", { class: "muted" }, "Computing insights…"));
  main.append(heroHost, insightsHost);

  renderHero(null);

  // One batched RPC; revisits paint instantly from the session cache and repaint
  // in the background only when the revalidated payload differs.
  const paint = (data) => {
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

  /** The hero: one figure, borderless, no card (DESIGN.md allows exactly one per page).
   *
   *  "Act now" is the page's argument compressed to a number — open findings that carry
   *  BOTH evidence of exploitation (KEV or a public exploit) and a way in (a host reachable
   *  from outside). It is meant to be small. On a register where every row is Critical, a
   *  count of everything is not a priority; the intersection is.
   *
   *  When the scan predates the exposure fields the intersection is unknowable, so the hero
   *  falls back to the KEV count and says so rather than printing a confident zero. */
  function renderHero(insights) {
    clear(heroHost);
    const loaded = insights && insights.flatScan;
    const f = loaded ? insights.funnel : null;
    const exposureKnown = !!(f && f.exposureKnown);
    const value = !loaded ? null
      : exposureKnown ? f.exposed : (insights.tiers?.perTier?.kev ?? 0);
    const source = !loaded
      ? "…"
      : exposureKnown
        ? "On the CISA KEV catalog or with a public exploit, on a host reachable from "
          + `outside · open findings, scan ${fmtDate(insights.scan.ts)}`
        : "On the CISA KEV catalog. Internet exposure was not captured in this scan, so the "
          + "narrower figure can't be computed.";
    heroHost.append(
      el("span", { class: "label" }, "Act now"),
      el("div", { class: "hero-value num" }, value === null ? "…" : value.toLocaleString()),
      el("p", { class: "hero-src" }, source),
    );
    // The provenance line used to be a `title` attribute, which el() now throws on — and it
    // was carrying real content (which clock "Past SLA" is measured on), not a restatement of
    // the label, so a native tooltip no keyboard or touch reader could open was the wrong
    // place for it. tipAnchor, not tip(): these tiles are figures, not controls, and turning
    // four of them into buttons would add four tab stops to a hero that has none.
    const mini = (v, label, help) => {
      const node = el("div", {},
        el("div", { class: "mini-value num" }, v),
        el("div", { class: "mini-label" }, label));
      return help ? tipAnchor(node, () => [help]) : node;
    };
    const past = loaded && insights.pastSla ? insights.pastSla.overall : null;
    const aw = loaded ? insights.awaiting : null;
    const median = loaded ? insights.medianOpenAge : null;
    heroHost.append(el("div", { class: "hero-minis" },
      mini(loaded ? (f.open || 0).toLocaleString() : "…", "Open"),
      mini(past ? past.breached.toLocaleString() : "…", "Past SLA",
        "On the vendor-fix clock, matching the MTTR page — a finding with no patch "
        + "available yet is not counted as a breach."),
      mini(aw ? (aw.overall || 0).toLocaleString() : "…", "Awaiting vendor fix"),
      // absent(), not a typed dash: no median open age means the insights payload never
      // measured one, and the muted dash is the app's one way of saying that.
      mini(median === null || median === undefined ? absent() : fmtAgeDays(median),
        "Median open age"),
    ));
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
    let view = "findings";
    // Fetched views, by name. Lives as long as the open drawer.
    const loaded = new Map();
    // Current page within the active view, reset to 0 whenever the view switches.
    let page = 0;
    // Rows per page, adjustable from the footer and kept across a view switch: a reader who
    // asked to see fifty rows meant it about the panel, not about one of its four tabs.
    let pageSize = OLDEST_PAGE_SIZE;
    const toggle = el("div", { class: "filter-bar", role: "group", "aria-label": "Oldest open findings view" });
    const tableHost = el("div", {});
    const footerHost = el("div", {});
    const caption = el("p", { class: "chart-caption muted" });
    for (const [value, label] of OLDEST_VIEWS) {
      const btn = el("button", {
        class: "seg-btn", type: "button",
        "aria-pressed": view === value ? "true" : "false",
        onclick: () => {
          if (view === value) return;
          view = value;
          page = 0;
          toggle.querySelectorAll("button.seg-btn").forEach((b) =>
            b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
          ensure();
        },
      }, label);
      toggle.append(btn);
    }

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
      const individual = view === "findings";
      caption.textContent = individual
        ? "Longest-open findings, oldest first."
        : "Ranked by open findings older than 90 days.";
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
        ? [{ key: "subscription", label: "Subscription", cell: (g) => g.subscription || absent() },
           { key: "domain", label: "Domain", cell: (g) => g.domain || absent() }]
        : [];
      clear(tableHost).append(individual
        ? oldestFindingsTable(pageRows)
        : oldestGroupTable(pageRows, OLDEST_VIEWS.find(([v]) => v === view)[1], extraCols));
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
    return el("div", { class: "chart-card" },
      el("h3", {}, "Oldest open findings"),
      toggle, tableHost, footerHost, caption);
  }

  /** Ranked table of individual oldest open findings (CVE · Asset · Subscription · Severity · Age). */
  function oldestFindingsTable(rows) {
    if (!rows || !rows.length) return emptyState("No open findings to rank.");
    // The dashes are absent(): a finding with no CVE, asset or subscription recorded is a
    // finding the scan told us nothing about for that column, and a dash in the same ink as
    // the values beside it claims otherwise.
    const columns = [
      { key: "cve", label: "CVE", cell: (r) => (r.cve && r.cve !== "(none)"
        ? el("a", { href: nvdUrl(r.cve), target: "_blank", rel: "noopener" }, r.cve)
        : (r.cve || absent())) },
      { key: "asset", label: "Asset", cell: (r) => r.asset || absent() },
      { key: "subscription", label: "Subscription", cell: (r) => r.subscription || absent() },
      // Severity is the dot AND the word — never the colour alone.
      { key: "severity", label: "Severity", cell: (r) => [
        el("span", { class: "sev-dot", "aria-hidden": "true",
          style: `background:${boot.palette.colors[r.severity] || "var(--text-3)"}` }),
        sevTitle(r.severity),
      ] },
      { key: "age", label: "Age", className: "num", cell: (r) => fmtAgeDays(r.ageDays) },
    ];
    return dataTable({ columns, rows });
  }

  /** Ranked table of the 90+ day open backlog per group (Group [· extras] · 90+ days · Open ·
   *  Oldest). extraCols is a dataTable column spec spliced in right after the group-name
   *  column — the Assets view uses it for Subscription / Domain; other group views pass none.
   *
   *  The column list therefore varies between views, which is fine here and would not be
   *  everywhere: the whole table is rebuilt on each paint (paint() clears tableHost), so
   *  nothing holds a stale header. */
  function oldestGroupTable(rows, dimLabel, extraCols = []) {
    if (!rows || !rows.length) return emptyState("No open findings to rank.");
    const columns = [
      { key: "key", label: dimLabel, cell: (g) => el("strong", {}, g.key) },
      ...extraCols,
      { key: "aged", label: "90+ days", className: "num",
        cell: (g) => g.agedCount.toLocaleString() },
      { key: "open", label: "Open", className: "num",
        cell: (g) => g.openCount.toLocaleString() },
      { key: "oldest", label: "Oldest", className: "num",
        cell: (g) => fmtAgeDays(g.oldestDays) },
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
    insightsHost.append(sectionLabel("Scan-over-scan movement"));
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
    const toggle = el("div", { class: "seg-row", role: "group", "aria-label": "Concentration dimension" });
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
      clear(listHost).append(rows.length ? list : emptyState("Nothing open in this dimension."));
      // Never let a truncated list read as a complete one.
      noteHost.textContent = more
        ? `Top ${rows.length} by open findings · ${more.toLocaleString()} more not shown.`
        : `All ${rows.length} ranked by open findings.`;
    }

    for (const [value, label] of CONCENTRATION_DIMS) {
      if (!conc.perDim[value]) continue;
      const btn = el("button", {
        class: "seg-btn seg-btn--sm", type: "button",
        "aria-pressed": dim === value ? "true" : "false",
        onclick: () => {
          if (dim === value) return;
          dim = value;
          toggle.querySelectorAll("button.seg-btn").forEach((b) =>
            b.setAttribute("aria-pressed", b === btn ? "true" : "false"));
          paintList();
        },
      }, label);
      toggle.append(btn);
    }
    insightsHost.append(el("div", { class: "section-head" },
      el("h2", { class: "section-label" }, "Where it concentrates"), toggle));
    insightsHost.append(listHost, noteHost);
    paintList();
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
    const lineCanvas = el("canvas", {});
    const lineMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    const lineCaption = el("p", { class: "chart-caption muted" });
    const chartGrid = el("div", { class: "chart-grid", style: "align-items:start" },
      el("div", { class: "chart-card" },
        el("h3", {}, "Group share"),
        el("div", { class: "chart-box" }, pieCanvas, pieMsg),
        pieCaption),
      el("div", { class: "chart-card" },
        el("h3", {}, "Group trend"),
        el("div", { class: "chart-box" }, lineCanvas, lineMsg),
        lineCaption),
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
      // Fire-and-forget: nothing to destroy if Chart.js never loaded (nothing was ever
      // drawn), and the message swap below doesn't wait on it either way.
      loadCharts().then((charts) => charts.destroyChart(canvas)).catch(() => {});
      canvas.style.display = "none";
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
      } else {
        const slices = head.map((n) => ({ label: n.key, value: n.open, color: colors.get(n.key) }));
        if (tailOpen > 0) {
          slices.push({ label: "Other", value: tailOpen, color: colors.get("Other") });
        }
        showChart(pieCanvas, pieMsg);
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
        return;
      }
      if (!names.length) {
        showMsg(lineCanvas, lineMsg, "No groups to trend.");
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
        } else if (!td.points || td.points.length < 2) {
          showMsg(lineCanvas, lineMsg, "Trend appears after the second scan.");
        } else {
          showChart(lineCanvas, lineMsg);
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
      host.append(emptyState("Nothing to break down for this grouping."));
      return;
    }
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        ...["Group", "Severity", "Assets", "Findings", "Open", "Risk"]
          .map((h) => el("th", { scope: "col" }, h)))),
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
        // Severity is the color strip plus the exact per-severity counts — never color alone.
        el("td", {},
          el("div", { class: "mix-cell" },
            mixStrip(node.sevCounts),
            // absent() rather than a typed dash: a group with no severity counts had none
            // reported, which is not the same as a group whose mix is empty by measurement.
            el("span", { class: "mix-text small muted num" },
              mixText(node.sevCounts) || absent()))),
        el("td", { class: "num" }, node.assets.toLocaleString()),
        el("td", { class: "num" }, node.total.toLocaleString()),
        el("td", { class: "num" }, node.open.toLocaleString()),
        el("td", {}, risky.join(" · ") || ""),
      );
    }
  }

  // ----------------------------------------------------------------------- helpers

  /** Proportional severity-mix bar. Decorative: the exact counts are carried by the visible
   *  .mix-text span the caller renders beside it, so the strip is aria-hidden to avoid a
   *  double announcement. Color is never the sole cue. */
  function mixStrip(sevCounts) {
    const total = boot.palette.order.reduce((a, s) => a + (sevCounts[s] || 0), 0);
    const strip = el("div", { class: "mix-strip", "aria-hidden": "true" });
    if (!total) return strip;
    for (const s of boot.palette.order) {
      if (!sevCounts[s]) continue;
      const span = el("span", {});
      span.style.width = `${(sevCounts[s] / total) * 100}%`;
      span.style.background = boot.palette.colors[s];
      strip.append(span);
    }
    return strip;
  }

  function mixText(sevCounts) {
    return boot.palette.order
      .filter((s) => sevCounts[s])
      .map((s) => `${s} ${sevCounts[s]}`)
      .join(" · ");
  }
}
