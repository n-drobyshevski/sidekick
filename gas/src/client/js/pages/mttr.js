// MTTR & SLA — remediation performance from the durable ledger. Hero stat, trend
// charts, per-severity SLA table, posture bars. Never fetches from Wiz.

import {
  destroyChart, groupPalette, groupPie, groupTrendLines, openResolvedLines, stackedAgeBar,
  survivalCurve, trendLine,
} from "../charts.js";
import { bootstrap, swrCall } from "../store.js";
import {
  changeChip, clear, el, emptyState, fmtDays, helpTip, noFixHiddenNote, scopeBar, sectionLabel,
  sevBadge, severityScopeFilter,
} from "../ui.js";

// Keep in sync with RESOLUTION_BUCKET_LABELS in src/domain/remediation.ts (the client
// bundle can't import the TS domain module) — used only if an older cached payload
// somehow carries buckets without labels.
const RESOLUTION_LABELS = ["≤1d", "2–7d", "8–30d", "31–90d", "90+d"];

// Timeframe presets for the Trends charts. null = no window (full history).
const TREND_WINDOWS = [
  ["5d", 5], ["2w", 14], ["30d", 30], ["60d", 60], ["90d", 90], ["All", null],
];

// The chosen window persists across visits in localStorage, stored by preset label so a
// stale or hand-edited value degrades to All. Some GAS iframe sandboxes block web storage
// (see attributionPrefill.js), hence the try/catch — blocked storage just means no recall.
const TREND_WINDOW_KEY = "mttrTrendWindow";
function loadTrendWindow() {
  try {
    const hit = TREND_WINDOWS.find(([label]) => label === localStorage.getItem(TREND_WINDOW_KEY));
    return hit ? hit[1] : null;
  } catch {
    return null;
  }
}
function saveTrendWindow(label) {
  try {
    localStorage.setItem(TREND_WINDOW_KEY, label);
  } catch {
    // Sandbox without storage — the choice simply won't survive the visit.
  }
}

// Open-past-SLA cell, shared by the hero mini and the per-severity table: "breached
// (pct%)"; "0" when nothing is open (pct is null then, not a fake 0%); "—" when the
// payload doesn't carry this metric at all (e.g. a stale pre-remediation cache).
function fmtOpenPastSla(o) {
  if (!o || o.open === null || o.open === undefined) return "—";
  if (!o.open) return "0";
  const pct = o.pct !== null && o.pct !== undefined ? `${o.pct.toFixed(0)}%` : "—";
  return `${(o.breached ?? 0).toLocaleString()} (${pct})`;
}

// Awaiting-vendor-fix summary for the hero mini: "N (x% of open)"; "—" when the payload
// doesn't carry the segment at all (a stale pre-actionable cache). pctOfOpen is null when
// nothing is open, so the share is dropped rather than shown as a fake 0%.
function fmtAwaiting(a) {
  if (!a || a.overall === null || a.overall === undefined) return "—";
  const pct = a.pctOfOpen !== null && a.pctOfOpen !== undefined
    ? ` (${a.pctOfOpen.toFixed(0)}% of open)` : "";
  return `${a.overall.toLocaleString()}${pct}`;
}

// Kaplan-Meier median formatter: the exact day count, "> X d" when the curve never drops to
// 50% within the observed window (heavy censoring — the true median is at least that far
// out), or "—" when there's no KM result at all (a stale pre-KM cached payload). `km` is a
// KMResult (or the null/undefined stand-in for one).
function fmtKmMedian(km) {
  if (!km) return "—";
  if (km.median !== null && km.median !== undefined) return fmtDays(km.median);
  if (km.medianLowerBound !== null && km.medianLowerBound !== undefined) {
    return `> ${fmtDays(km.medianLowerBound)}`;
  }
  return "—";
}

// Kaplan-Meier mean (RMST) formatter: a "≥" prefix marks a lower bound (the curve hadn't
// fully decayed to zero by the restriction time τ, so some findings would resolve later),
// else the exact restricted mean.
function fmtKmMean(km) {
  if (!km || km.mean === null || km.mean === undefined) return "—";
  return (km.meanTruncated ? "≥ " : "") + fmtDays(km.mean);
}

// A helpTip'd label/value row for the Resolution profile stat card — reuses the
// per-severity stat-card row classes (hairline divider + name/value) so the visual stays
// identical to "Remediation by severity" below, just without the sev-dot.
function statRow(label, value, lines) {
  return helpTip(
    [
      el("span", { class: "stat-card__name" }, label),
      el("span", { class: "stat-card__value num" }, value),
    ],
    lines,
    { className: "stat-card__row help-label" },
  );
}

export async function renderMttr(main, _params, ctx) {
  const boot = await bootstrap();

  // Which severities feed every metric on this page. Defaults to the app-wide display
  // setting ("which severities every page shows") so MTTR opens scoped like Overview,
  // falling back to all selectable if that setting is somehow empty. Page-local and
  // non-persisted: resets to the display setting on each visit.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];

  main.append(
    el("div", { class: "page-head" },
      el("h1", {}, "MTTR & SLA"),
      severityScopeFilter({
        selectable: boot.palette.selectable, scope: sevScope,
        onApply: () => load(), ariaContext: "MTTR",
      })),
    el("p", { class: "page-sub" },
      "How fast risk gets closed, measured over observed lifecycles in the durable base. " +
      "The SLA clock starts once a vendor fix is available; findings awaiting a vendor fix " +
      "are shown separately."),
  );

  const scopeChips = scopeBar({
    domain: ctx.domain, supportGroup: ctx.supportGroup, onClear: ctx.clearScope,
  });
  if (scopeChips) main.append(scopeChips);
  if (boot.settings.showNoFix === false) main.append(noFixHiddenNote());

  const heroHost = el("div", {});
  const chartsHost = el("div", {});
  const survivalHost = el("div", {});
  const resolutionHost = el("div", {});
  const slaHost = el("div", {});
  const byDomainHost = el("div", {});
  main.append(heroHost, chartsHost, survivalHost, resolutionHost, slaHost, byDomainHost);

  // Scope comes from the global Value Chain + Support group filters in the sidebar;
  // "" = no filter on that dimension.
  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";

  // Trends timeframe (days back from now; null = full history). Recalled from
  // localStorage across visits; falls back to All where storage is unavailable.
  let trendWindowDays = loadTrendWindow();

  await load();

  // Null when every selectable severity is chosen (no filter → shares the default cache
  // entry); otherwise the chosen subset, which the server keeps alongside UNKNOWN.
  function scopeParam() {
    return sevScope.length === boot.palette.selectable.length ? null : [...sevScope];
  }

  async function load() {
    // Put every section into a pending state before the await, so a severity change never
    // leaves the charts / SLA table showing the old scope's numbers beside a "Computing…" hero.
    clear(heroHost).append(el("p", { class: "muted" }, "Computing…"));
    clear(chartsHost);
    clear(survivalHost);
    clear(resolutionHost);
    clear(slaHost);
    clear(byDomainHost);
    // One batched RPC — summary and trends share a single ledger-state load
    // server-side. Revisits paint instantly from the session cache and repaint in
    // the background only if the revalidated data differs.
    const paint = (data) => {
      renderHero(data.mttr, data.trends);
      renderCharts(data.trends, data.mttr);
      renderSurvivalCurve(data.mttr);
      renderResolutionProfile(data.mttr);
      renderSla(data.mttr);
      renderByDomain(data.byDomain);
    };
    paint(await swrCall("api_getMttrPage",
      { domain, supportGroup, severities: scopeParam() }, paint));
  }

  /** Per-domain remediation, shown only at the whole-chain view (the server omits it
   *  when a single value chain is selected). A value chain is composed of domains, so
   *  this is how each component is doing.
   *
   *  Above the table, a chart pair shows how the domains participate in MTTR — both keyed
   *  to the same canonical `byDomain.trend.groups` (resolved-desc, capped at 8 + pooled
   *  "Other") so a domain wears one hue across the two: a "Remediation share" pie
   *  partitioning the *resolved* population (who's carrying the remediation work, tooltip
   *  carrying each domain's median MTTR), and an "MTTR by domain" line replaying each
   *  domain's median MTTR in days over scan history. This section is all-time like its
   *  table — the Trends timeframe toggle is deliberately not wired in. */
  function renderByDomain(byDomain) {
    clear(byDomainHost);
    if (!byDomain || !byDomain.rows.length || boot.domainNames.length < 2) return;
    byDomainHost.append(sectionLabel("By domain"));
    byDomainHost.append(el("p", { class: "small muted", style: "margin:-6px 0 12px" },
      "Remediation for each domain that makes up the value chain."));

    // Chart pair over the domain trend the server ships alongside the table. Each card swaps
    // its canvas for a muted message when there's nothing to draw (copied from overview.js's
    // Breakdown helpers). Both share one groupPalette so a domain's hue is stable across them.
    const pieCanvas = el("canvas", {});
    const pieMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    const pieCaption = el("p", { class: "chart-caption muted" });
    const lineCanvas = el("canvas", {});
    const lineMsg = el("p", { class: "chart-empty muted", style: "display:none" });
    const lineCaption = el("p", { class: "chart-caption muted" });
    byDomainHost.append(el("div", { class: "chart-grid", style: "align-items:start" },
      el("div", { class: "chart-card" },
        el("h3", {}, "Remediation share"),
        el("div", { class: "chart-box" }, pieCanvas, pieMsg),
        pieCaption),
      el("div", { class: "chart-card" },
        el("h3", {}, "MTTR by domain"),
        el("div", { class: "chart-box" }, lineCanvas, lineMsg),
        lineCaption),
    ));

    // Swap a card between its live canvas and a centered muted message.
    function showChart(canvas, msg) {
      msg.style.display = "none";
      canvas.style.display = "";
    }
    function showMsg(canvas, msg, text) {
      destroyChart(canvas);
      canvas.style.display = "none";
      msg.textContent = text;
      msg.style.display = "";
    }

    const trend = byDomain.trend;
    const groups = (trend && trend.groups) || [];
    const colors = groupPalette(groups);
    const inGroups = new Set(groups);
    // Rows outside the canonical groups pool into "Other" — the pie sums their resolved
    // share; the line's Other series is the same pooled remainder the server replays.
    const resolvedOther = byDomain.rows
      .filter((r) => !inGroups.has(r.domain))
      .reduce((a, r) => a + (r.resolved ?? 0), 0);
    const series = groups.map((name) => ({ name, color: colors.get(name) }));
    if (resolvedOther > 0) series.push({ name: "Other", color: colors.get("Other") });

    // Line: per-domain median MTTR (days) replayed over scan history.
    function paintLine() {
      const points = (trend && trend.points) || [];
      lineCaption.textContent = "Median MTTR (days) by domain, per scan.";
      if (points.length < 2) {
        showMsg(lineCanvas, lineMsg, "Trend appears after the second saved scan.");
        return;
      }
      showChart(lineCanvas, lineMsg);
      groupTrendLines(lineCanvas, points, series, {
        unit: "days",
        nullAsGap: true,
        describe: "Median MTTR in days per domain over scan history.",
      });
    }

    // Pie: each domain's share of resolved findings — the population the MTTR median runs
    // over. Tooltip detail carries the matching per-domain median. Canonical groups/hues
    // stay fixed (slices resize, never recolor).
    function paintPie() {
      const byName = new Map(byDomain.rows.map((r) => [r.domain, r]));
      pieCaption.textContent = "Each domain's share of resolved findings — the population feeding MTTR.";
      const slices = groups
        .map((name) => {
          const r = byName.get(name);
          return {
            label: name,
            value: r?.resolved ?? 0,
            color: colors.get(name),
            detail: "Median MTTR " + fmtDays(r?.median),
          };
        })
        .filter((s) => s.value > 0);
      const other = byDomain.rows
        .filter((r) => !inGroups.has(r.domain))
        .reduce((a, r) => a + (r.resolved ?? 0), 0);
      if (other > 0) slices.push({ label: "Other", value: other, color: colors.get("Other") });
      if (!slices.length) {
        showMsg(pieCanvas, pieMsg, "No resolved findings to partition.");
        return;
      }
      showChart(pieCanvas, pieMsg);
      groupPie(pieCanvas, slices, { subject: "Resolved findings by domain" });
    }

    requestAnimationFrame(() => {
      paintPie();
      paintLine();
    });

    // Column headers carry the two new metrics' definitions via helpTip, matching the
    // per-severity table's convention in renderSla above.
    const columns = [
      ["Domain", null],
      ["Median MTTR", null],
      ["MTTR p90",
        ["90th-percentile time from first detection to remediation — the slow tail. Nine " +
          "in ten findings beat it; one in ten is slower."]],
      ["KM median",
        ["Kaplan–Meier median time-to-remediation for this domain. Still-open findings " +
          "count as censored instead of being ignored, so it isn't biased low by fresh " +
          "fast-patched vulns."]],
      ["In SLA", null],
      ["Open past SLA",
        ["Open findings already older than their severity's SLA target. Unlike In-SLA % " +
          "(which only scores resolved findings), an aged-out open CRITICAL counts here."]],
      ["Open", null],
      ["Resolved", null],
    ];
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        ...columns.map(([h, lines]) => el("th", { scope: "col" },
          lines ? helpTip(h, lines, { className: "help-label" }) : h)))),
    );
    const tbody = el("tbody", {});
    for (const r of byDomain.rows) {
      tbody.append(el("tr", {},
        el("td", {}, r.domain),
        el("td", { class: "num" }, fmtDays(r.median)),
        el("td", { class: "num" }, fmtDays(r.p90)),
        el("td", { class: "num" }, fmtDays(r.kmMedian)),
        el("td", { class: "num" }, r.slaPct != null ? `${r.slaPct.toFixed(0)}%` : "—"),
        el("td", { class: "num" }, fmtOpenPastSla(r.openPastSla)),
        el("td", { class: "num" }, (r.open ?? 0).toLocaleString()),
        el("td", { class: "num" }, (r.resolved ?? 0).toLocaleString()),
      ));
    }
    table.append(tbody);
    byDomainHost.append(el("div", { class: "table-wrap" }, table));

    // Awaiting-vendor-fix findings aren't a column (they don't breach any SLA) — a footnote
    // sums the per-domain `awaiting` counts so the excluded population is still visible.
    // Hidden entirely when the vendor-fix filter is off (the counts arrive zeroed anyway, and
    // the page-level honesty note already covers it).
    const awaitingTotal = byDomain.rows.reduce((a, r) => a + (r.awaiting ?? 0), 0);
    if (boot.settings.showNoFix !== false && awaitingTotal > 0) {
      byDomainHost.append(el("p", { class: "small muted", style: "margin:8px 0 0" },
        `${awaitingTotal.toLocaleString()} open finding${awaitingTotal === 1 ? "" : "s"} across `
        + "these domains are awaiting a vendor fix — excluded from Open past SLA until a fix appears."));
    }
  }

  function renderHero(mttr, trends) {
    clear(heroHost);
    if (!mttr.rowCount) {
      heroHost.append(emptyState(
        "No lifecycle data yet.",
        "MTTR needs at least one saved scan with resolved findings.",
      ));
      return;
    }
    const hist = trends.history;
    const prev = hist.length > 1 ? hist[hist.length - 2] : null;
    // The prev snapshot (mttr_history) is global across chain/support/severity, while the
    // current values are scoped by the active filters. Diffing them would show a fake delta
    // (a small domain's 5d vs the global 45d prev reads as "−40d"), so only show the change
    // chips at the unscoped whole-chain / all-severities view where the populations match.
    // The vendor-fix filter folds in too: with it off, the current values exclude no-fix
    // findings while mttr_history's snapshots never did, so a chip would diff filtered
    // against unfiltered populations exactly like a domain/support/severity scope would.
    const scoped = boot.settings.showNoFix === false
      || scopeParam() !== null || domain || supportGroup;

    // `remediation` is additive on the server (see the plan) — a stale cached response
    // from before the rollout won't carry it, so every read below is optional-chained and
    // every affected mini/cell degrades to "—" rather than throwing.
    const rem = mttr.remediation;
    const km = rem?.km; // KMResult — the primary MTTR methodology now
    // Actionable-clock open-past-SLA, falling back to the from-detection value for a stale
    // pre-actionable cache (both share the {open, breached, pct} shape).
    const openPastSla = rem?.openPastSlaActionable?.overall ?? rem?.openPastSla?.overall;
    const overallPctiles = rem?.pctiles?.overall; // {p50, p90, count}
    const awaiting = rem?.awaiting; // {perSev, overall, openTotal, pctOfOpen}

    const minis = el("div", { class: "hero-minis" });
    const miniDefs = [
      // The naive figures are demoted to minis now that Kaplan–Meier is the headline
      // methodology — closed-findings-only, no censoring. The median keeps mttr_history's
      // change chip (the KM series itself isn't persisted, see the plan); the mean has no
      // history series to diff against.
      ["Median (naive, closed)", fmtDays(km?.naiveMedian),
        !scoped && prev && prev.median_days !== null && prev.median_days !== undefined &&
          km?.naiveMedian !== null && km?.naiveMedian !== undefined
          ? changeChip(km.naiveMedian, prev.median_days, { fmt: fmtDays }) : null],
      ["Mean (naive, closed)", fmtDays(km?.naiveMean), null],
      // "of resolved" makes the survivorship explicit: In-SLA % scores only resolved
      // findings, so it can look healthy while the open backlog ages (Open past SLA below).
      ["In SLA (of resolved)", mttr.slaPct !== null ? `${mttr.slaPct.toFixed(1)}%` : "—",
        !scoped && prev && prev.sla_pct !== null && mttr.slaPct !== null
          ? changeChip(mttr.slaPct, prev.sla_pct, { invert: true, suffix: "%" }) : null],
      // Open findings already past their SLA target — unlike In SLA %, this scores open
      // findings too (definition lives on the "Open past SLA" table column below; minis
      // stay plain, matching the existing convention). Up is worse, same as every other
      // count-of-risk chip here, so no invert.
      ["Open past SLA", fmtOpenPastSla(openPastSla),
        !scoped && prev && prev.open_past_sla !== null && prev.open_past_sla !== undefined &&
          openPastSla && openPastSla.breached !== null && openPastSla.breached !== undefined
          ? changeChip(openPastSla.breached, prev.open_past_sla) : null],
      // Open findings with no vendor fix available yet — outside the SLA clock entirely, so
      // shown here rather than folded into Open past SLA. No history series to diff, no chip.
      // Dropped entirely when the vendor-fix filter is off — the page-level honesty note
      // already covers the exclusion, and the count would arrive zeroed anyway.
      boot.settings.showNoFix === false ? null : ["Awaiting vendor fix", fmtAwaiting(awaiting), null],
      ["MTTR p90", fmtDays(overallPctiles?.p90), null],
      // p90 of open-finding age, not the single oldest — labelled to match the table below.
      ["Open age p90", fmtDays(mttr.oldestDays),
        !scoped && prev && prev.oldest_open_days !== null && mttr.oldestDays !== null
          ? changeChip(mttr.oldestDays, prev.oldest_open_days, { fmt: fmtDays }) : null],
    ].filter(Boolean);
    for (const [label, value, chip] of miniDefs) {
      minis.append(el("div", {},
        el("div", { class: "mini-label" }, label),
        el("div", { class: "mini-value num" }, value, chip || null),
      ));
    }
    const resolved = mttr.overall.resolved ?? 0;
    const open = mttr.overall.open ?? 0;
    // The metric itself (label + value) is the hover/focus target — no separate "i" glyph.
    // No change chip on either KM stat: mttr_history only ever persisted the naive median
    // (now a mini above), never a KM series, so there's nothing to diff against.
    const metric = helpTip(
      [
        el("div", { class: "label" }, "Median MTTR (Kaplan–Meier)" + (domain ? ` — ${domain}` : "")),
        el("div", { class: "hero-value num" }, fmtKmMedian(km)),
      ],
      [
        "Kaplan–Meier median days from first detection to remediation. Still-open findings " +
          "count as censored observations instead of being ignored, so a wave of fresh open " +
          "findings can't bias this down.",
        "\"> X d\" means the curve never dropped to 50% within the observed window — over " +
          "half of tracked findings are still open, so the true median is at least that " +
          "many days out.",
        "A vuln that disappears between scans counts as resolved.",
      ],
      { className: "hero-metric" },
    );
    // Second stat, not a second hero — deliberately a step below the 2rem hero value (see
    // DESIGN.md: at most one hero value per page) while still living beside the headline.
    const meanStat = helpTip(
      [
        el("div", { class: "label" }, "Mean MTTR (KM · RMST)"),
        el("div", { class: "kpi-value num" }, fmtKmMean(km)),
      ],
      [
        "Restricted mean survival time (RMST) — the average remediation time up to the " +
          "longest observed lifecycle (τ), with still-open findings censored.",
        "\"≥\" marks a lower bound: the curve hadn't fully decayed to zero by τ, so some " +
          "findings would still resolve later and the true mean is at least this.",
      ],
      { className: "hero-metric" },
    );
    heroHost.append(
      el("div", { class: "hero" },
        el("div", { style: "display:flex; align-items:baseline; gap:32px; flex-wrap:wrap" },
          metric, meanStat),
        el("div", { class: "hero-src" },
          `${mttr.rowCount.toLocaleString()} tracked lifecycle(s) in the durable base · ` +
          `${resolved.toLocaleString()} resolved · ${open.toLocaleString()} open`),
        minis,
      ),
    );
  }

  /** Full-width Kaplan–Meier survival curve card, before Resolution profile. Gated on a
   *  drawable curve: `rem` missing entirely means a stale pre-KM cache (nothing shown, same
   *  convention as renderResolutionProfile); `rem.km` present but empty means genuinely no
   *  resolved findings yet to estimate from (a muted note instead of an empty chart). */
  function renderSurvivalCurve(mttr) {
    clear(survivalHost);
    const rem = mttr.remediation;
    if (!rem) return;
    survivalHost.append(sectionLabel("Remediation survival (Kaplan–Meier)"));
    if (!rem.km?.curve?.length) {
      survivalHost.append(el("p", { class: "muted small" },
        "Not enough resolved findings yet to draw a survival curve — it appears once the " +
        "first remediation is recorded."));
      return;
    }
    const canvas = el("canvas", { id: "survival-curve" });
    survivalHost.append(
      el("div", { class: "chart-card" },
        el("h3", {}, "S(t): share of findings still open"),
        el("div", { class: "chart-box" }, canvas),
        el("p", { class: "chart-caption muted" },
          "Markers: Median (closed), Median (KM, all), Mean (closed), Mean (KM · RMST, all)."),
      ),
    );
    requestAnimationFrame(() => {
      survivalCurve(canvas, rem.km.curve, {
        naiveMedian: rem.km.naiveMedian,
        median: rem.km.median,
        naiveMean: rem.km.naiveMean,
        mean: rem.km.mean,
      });
    });
  }

  function renderCharts(trends, mttr) {
    clear(chartsHost);
    // With no lifecycle data the hero already shows the single, unified empty state — don't
    // stack a second "Trends appear…" panel beneath it.
    if (!mttr.rowCount) return;

    // Window the already-loaded series client-side (no RPC): the charts use a category
    // x-axis, so filtering the arrays before mapping is the whole job. The cutoff comes
    // from the client clock; a ±1-day skew at the window edge is fine for a view filter.
    const cutoff = trendWindowDays === null ? null : Date.now() - trendWindowDays * 86400000;
    const inWindow = (iso) => cutoff === null || Date.parse(iso) >= cutoff;
    const trend = trends.trend.filter((t) => inWindow(t.date));
    const history = trends.history.filter((h) => inWindow(h.date));
    // Pin the x-axis to the chosen window (epoch days) — the charts' day axis is
    // time-proportional, so a 30d window stays 30 days wide even when the data only
    // reaches back a fortnight: short history reads as empty space, not a full chart.
    const xRange = cutoff === null
      ? null
      : { min: Math.floor(cutoff / 86400000), max: Math.floor(Date.now() / 86400000) };

    // Compact timeframe toggle inline with the section label. aria-pressed toggle
    // buttons, not a radiogroup — the same segmented pattern as the report-format and
    // oldest-open controls. Clicking repaints from the closed-over payload.
    const segRow = el("div", { class: "seg-row", role: "group", "aria-label": "Trends timeframe" },
      ...TREND_WINDOWS.map(([label, days]) =>
        el("button", {
          type: "button", class: "seg-btn seg-btn--sm",
          "aria-pressed": String(days === trendWindowDays),
          onclick: () => { trendWindowDays = days; saveTrendWindow(label); renderCharts(trends, mttr); },
        }, label)));
    const sectionHead = el("div", { class: "section-head" }, sectionLabel("Trends"), segRow);

    const mttrCanvas = el("canvas", { id: "mttr-trend" });
    const kmMedianCanvas = el("canvas", { id: "km-median-trend" });
    const openResolvedCanvas = el("canvas", { id: "open-resolved" });
    const openSlaCanvas = el("canvas", { id: "open-sla-trend" });
    const slaBurnCanvas = el("canvas", { id: "sla-burn-trend" });
    const slaAttainmentCanvas = el("canvas", { id: "sla-attainment-trend" });

    // With the vendor-fix filter off, mttr_history's snapshots were captured before any
    // no-fix exclusion existed — falling back to them would paint an unfiltered register on
    // a young ledger with too few reconstructed-trend points. Use the recomputed `trend`
    // array only in that case, even if it leaves the chart with fewer (or zero) points.
    const hideNoFix = boot.settings.showNoFix === false;
    const points = trend.length
      ? trend.map((t) => ({ x: t.date, y: t.median_days, reconstructed: t.reconstructed }))
      : hideNoFix ? [] : history.map((h) => ({ x: h.date, y: h.median_days, reconstructed: false }));

    // KM median trend — reconstructed-trend only (mttr_history snapshots don't carry it: KM
    // needs the full base of events + censoring replayed as-of each date, not a scalar that
    // was persisted at snapshot time).
    const kmMedianPoints = trend
      .map((t) => ({ x: t.date, y: t.km_median_days, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);

    // Same fallback shape as `points` above, but for open_past_sla — a column that doesn't
    // exist on history rows saved before this feature shipped. Those rows carry `null`
    // (never a false 0, see historyStore.loadHistory), so they're filtered out here rather
    // than drawn as a dip to zero.
    const openSlaPoints = (trend.length
      ? trend.map((t) => ({ x: t.date, y: t.open_past_sla, reconstructed: t.reconstructed }))
      : hideNoFix ? [] : history.map((h) => ({ x: h.date, y: h.open_past_sla, reconstructed: false })))
      .filter((p) => p.y !== null && p.y !== undefined);

    // Backlog-flow series — reconstructed-trend only, like the tail median (mttr_history
    // snapshots don't carry them). sla_net is a signed per-window flow (can be negative);
    // sla_attainment_pct is the unbiased cohort In-SLA. Null points (first point / stale
    // history rows) are dropped rather than drawn as a dip to zero.
    const slaBurnPoints = trend
      .map((t) => ({ x: t.date, y: t.sla_net, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);
    const slaAttainmentPoints = trend
      .map((t) => ({ x: t.date, y: t.sla_attainment_pct, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);

    // A "trend" needs at least two points — one lone dot is not a trajectory. This matches the
    // Open-vs-resolved gate and the "after two saved scans" copy below.
    const hasTrend = points.length > 1;
    const hasKmTrend = kmMedianPoints.length > 1;
    const hasOpenSlaTrend = openSlaPoints.length > 1;
    const hasSlaBurn = slaBurnPoints.length > 1;
    const hasSlaAttainment = slaAttainmentPoints.length > 1;
    const grid = el("div", { class: "chart-grid", style: "align-items:start" });
    if (hasKmTrend) {
      // KM ordered first — it's the primary methodology now; naive MTTR trend follows as
      // the comparison series.
      grid.append(el("div", { class: "chart-card" },
        el("h3", {}, "KM median trend"),
        el("div", { class: "chart-box" }, kmMedianCanvas)));
    }
    if (hasTrend) {
      grid.append(el("div", { class: "chart-card" },
        el("h3", {}, "MTTR trend"),
        el("div", { class: "chart-box" }, mttrCanvas)));
    }
    if (trend.length > 1) {
      grid.append(el("div", { class: "chart-card" },
        el("h3", {}, "Open vs resolved"),
        el("div", { class: "chart-box" }, openResolvedCanvas)));
    }
    if (hasOpenSlaTrend) {
      // A separate card, not a third overlay line on Open vs resolved — that pair already
      // deliberately encodes red/green + dash + point-shape; a third line would crowd it.
      grid.append(el("div", { class: "chart-card" },
        el("h3", {}, "Open past SLA"),
        el("div", { class: "chart-box" }, openSlaCanvas),
        el("p", { class: "chart-caption muted" },
          "Open findings past their SLA deadline, now measured from when a vendor fix became "
          + "available rather than first detection. Counts step up at the fix-tracking rollout "
          + "— findings awaiting a vendor fix are now included in the register.")));
    }
    if (hasSlaBurn) {
      // Net backlog-of-breach flow per scan window: findings crossing their SLA deadline
      // minus breached findings cleared. A signed series (can go below zero), so it reads
      // against the zero baseline trendLine's beginAtZero axis already includes.
      grid.append(el("div", { class: "chart-card" },
        el("h3", {}, "SLA burn (net flow)"),
        el("div", { class: "chart-box" }, slaBurnCanvas),
        el("p", { class: "chart-caption muted" },
          "Findings crossing their SLA deadline minus breached findings cleared, per scan. "
          + "Above zero = the past-SLA backlog is growing.")));
    }
    if (hasSlaAttainment) {
      grid.append(el("div", { class: "chart-card" },
        el("h3", {}, "SLA attainment (cohort)"),
        el("div", { class: "chart-box" }, slaAttainmentCanvas),
        el("p", { class: "chart-caption muted" },
          "Of findings whose SLA deadline has passed, the share met on time — unlike In-SLA "
          + "(of resolved), unaffected by how much is still open.")));
    }
    if (!grid.hasChildNodes()) {
      if (trendWindowDays === null) {
        // Nothing to plot at all — same single empty state as before the filter existed.
        chartsHost.append(emptyState("Trends appear after two saved scans."));
      } else {
        // The window is what emptied the section — keep the control so it can be widened.
        chartsHost.append(sectionHead, emptyState("No trend points in this window."));
      }
      return;
    }
    // A labelled section so the page has no h1 → h3 heading skip (the cards are h3).
    chartsHost.append(sectionHead, grid);
    // Caption keyed to the windowed set — no note about shading that isn't on screen.
    if (trend.some((t) => t.reconstructed)) {
      chartsHost.append(el("p", { class: "small muted", style: "margin:4px 0 0" },
        "Shaded days precede the first saved scan — reconstructed from first-detection dates. "
          + "Open counts there are exact; resolved and MTTR are lower bounds."));
    }
    if (domain) {
      chartsHost.append(el("p", { class: "small muted", style: "margin:0" },
        "Trends span every value chain — per-chain history isn't stored."));
    }

    requestAnimationFrame(() => {
      if (hasTrend) {
        trendLine(mttrCanvas, points.filter((p) => p.y !== null), { yLabel: "days", xRange });
      }
      if (hasKmTrend) {
        trendLine(kmMedianCanvas, kmMedianPoints, { yLabel: "days", xRange });
      }
      if (trend.length > 1) {
        openResolvedLines(openResolvedCanvas, trend, { xRange });
      }
      if (hasOpenSlaTrend) {
        trendLine(openSlaCanvas, openSlaPoints, { yLabel: "findings", xRange });
      }
      if (hasSlaBurn) {
        trendLine(slaBurnCanvas, slaBurnPoints, { yLabel: "findings", xRange });
      }
      if (hasSlaAttainment) {
        trendLine(slaAttainmentCanvas, slaAttainmentPoints, { yLabel: "%", xRange });
      }
    });
  }

  /** Resolution profile: the histogram of time-to-resolve (stacked by severity) beside a
   *  compact stat card of Kaplan–Meier + naive-comparison numbers. All of it comes from
   *  `mttr.remediation`, which is additive on the server — skip the whole section when it's
   *  missing (stale cache) or empty (no resolved lifecycles to bucket yet). */
  function renderResolutionProfile(mttr) {
    clear(resolutionHost);
    const rem = mttr.remediation;
    if (!rem || !rem.buckets || !rem.buckets.total) return;

    resolutionHost.append(sectionLabel("Resolution profile"));

    const bucketCanvas = el("canvas", { id: "resolution-buckets" });
    const chartCard = el("div", { class: "chart-card" },
      el("h3", {},
        helpTip("Time to resolve",
          ["How long resolved findings actually took, bucketed by severity. The " +
            "right-hand bars are the tail the median hides."],
          { className: "help-label" })),
      el("div", { class: "chart-box" }, bucketCanvas));

    const km = rem.km;
    const statCard = el("div", { class: "card" },
      statRow("KM median (from detection)", fmtKmMedian(km),
        ["Kaplan–Meier median time-to-remediation. Counts still-open findings as censored " +
          "(not-yet-resolved) instead of ignoring them, so it isn't biased low by fresh " +
          "fast-patched vulns. \"> X d\" means over half of findings are still open."]),
      statRow("KM mean (RMST)", fmtKmMean(km),
        ["Restricted mean survival time — expected remediation time up to the longest " +
          "observed lifecycle, treating still-open findings as censored. \"≥\" marks a " +
          "lower bound when the curve hadn't fully decayed to zero by then."]),
      statRow("KM median (actionable)", fmtKmMedian(rem.kmActionable),
        ["The same Kaplan–Meier median, but the clock starts when a vendor fix became " +
          "available rather than at first detection — so a fix that arrives late doesn't " +
          "count against the team. Findings still awaiting a vendor fix don't count at all."]),
      statRow("Median (naive, closed)", fmtDays(km?.naiveMedian),
        ["Linear-interpolated median over closed findings only. Ignores still-open " +
          "findings entirely, so a wave of fresh fast-patched vulns can drag it down."]),
      statRow("Mean (naive, closed)", fmtDays(km?.naiveMean),
        ["Simple average time-to-resolve over closed findings only."]),
    );

    resolutionHost.append(
      el("div", { class: "chart-grid", style: "align-items:start" }, chartCard, statCard));

    requestAnimationFrame(() => {
      stackedAgeBar(bucketCanvas, rem.buckets.labels || RESOLUTION_LABELS, rem.buckets.perSev,
        boot.palette, "Resolved findings by time-to-resolve bucket and severity.");
    });
  }

  function renderSla(mttr) {
    clear(slaHost);
    // The per-severity breakdown (table + posture bars) follows the severity dropdown,
    // so it always matches the severities feeding the hero and trend above.
    const sevs = boot.palette.order.filter((s) => mttr.perSev[s] && sevScope.includes(s));
    if (!sevs.length) return;

    // Hidden entirely when the vendor-fix filter is off — the counts arrive zeroed anyway,
    // and the page-level honesty note already covers the exclusion. Built conditionally
    // (header and every row's cell) so the table stays column-aligned either way.
    const showAwaiting = boot.settings.showNoFix !== false;

    slaHost.append(sectionLabel("Remediation by severity"));
    // Column headers carry the two new metrics' definitions via helpTip — the hero minis
    // stay plain (the page's existing convention), so this table is where "MTTR p90" and
    // "Open past SLA" get explained.
    const columns = [
      ["Severity", null],
      ["Median MTTR", null],
      ["MTTR p90",
        ["90th-percentile time from first detection to remediation — the slow tail. Nine " +
          "in ten findings beat it; one in ten is slower."]],
      ["Resolved", null],
      ["Open", null],
      ["Open past SLA",
        ["Open findings already older than their severity's SLA target, measured from when " +
          "a vendor fix became available. Unlike In-SLA % (which only scores resolved " +
          "findings), an aged-out open CRITICAL counts here."]],
      ...(showAwaiting ? [["Awaiting",
        ["Open findings with no vendor fix available yet — excluded from the SLA clock " +
          "until a fix appears, so they don't count as breached above."]]] : []),
      ["Open age p90", null],
      ["SLA target", null],
      ["In SLA", null],
    ];
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        ...columns.map(([h, lines]) => el("th", { scope: "col" },
          lines ? helpTip(h, lines, { className: "help-label" }) : h)))),
    );
    const tbody = el("tbody", {});
    for (const sev of sevs) {
      const d = mttr.perSev[sev];
      tbody.append(el("tr", {},
        el("td", {}, sevBadge(sev)),
        el("td", { class: "num" }, fmtDays(d.mttr_median)),
        el("td", { class: "num" }, fmtDays(mttr.remediation?.pctiles?.perSev?.[sev]?.p90)),
        el("td", { class: "num" }, d.resolved),
        el("td", { class: "num" }, d.open),
        el("td", { class: "num" }, fmtOpenPastSla(
          mttr.remediation?.openPastSlaActionable?.perSev?.[sev]
          ?? mttr.remediation?.openPastSla?.perSev?.[sev])),
        showAwaiting
          ? el("td", { class: "num" }, (mttr.remediation?.awaiting?.perSev?.[sev] ?? 0).toLocaleString())
          : null,
        el("td", { class: "num" }, fmtDays(d.open_age_p90)),
        el("td", { class: "num" }, d.sla_target ? `${d.sla_target}d` : "—"),
        el("td", { class: "num" }, d.sla_pct !== null ? `${d.sla_pct.toFixed(0)}%` : "—"),
      ));
    }
    table.append(tbody);
    slaHost.append(el("div", { class: "table-wrap" }, table));
  }
}
