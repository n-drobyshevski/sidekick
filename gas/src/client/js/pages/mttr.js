// MTTR & SLA — remediation performance from the durable ledger. Hero stat, trend
// charts, per-severity SLA table, posture bars. Never fetches from Wiz.

import {
  destroyChart, groupPalette, groupPie, groupTrendLines, openResolvedLines, stackedAgeBar,
  trendLine,
} from "../charts.js";
import { bootstrap, swrCall } from "../store.js";
import {
  changeChip, clear, el, emptyState, fmtDays, helpTip, scopeBar, sectionLabel, sevBadge,
  severityScopeFilter,
} from "../ui.js";

// Keep in sync with RESOLUTION_BUCKET_LABELS in src/domain/remediation.ts (the client
// bundle can't import the TS domain module) — used only if an older cached payload
// somehow carries buckets without labels.
const RESOLUTION_LABELS = ["≤1d", "2–7d", "8–30d", "31–90d", "90+d"];

// Timeframe presets for the Trends charts. null = no window (full history).
const TREND_WINDOWS = [
  ["5d", 5], ["2w", 14], ["30d", 30], ["60d", 60], ["90d", 90], ["All", null],
];

// Which basis the "By domain" chart pair draws: the plain median over all resolutions, or
// the fast-lane-excluded tail (line switches series, pie switches population). Module-scoped
// so the choice survives repaints (severity re-apply, SWR revalidation) within the session
// without localStorage ceremony.
let domainTrendMode = "median";

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

  const heroHost = el("div", {});
  const chartsHost = el("div", {});
  const resolutionHost = el("div", {});
  const slaHost = el("div", {});
  const byDomainHost = el("div", {});
  main.append(heroHost, chartsHost, resolutionHost, slaHost, byDomainHost);

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
    clear(resolutionHost);
    clear(slaHost);
    clear(byDomainHost);
    // One batched RPC — summary and trends share a single ledger-state load
    // server-side. Revisits paint instantly from the session cache and repaint in
    // the background only if the revalidated data differs.
    const paint = (data) => {
      renderHero(data.mttr, data.trends);
      renderCharts(data.trends, data.mttr);
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
    // Compact Median / Excl. fast lane switch inline with the section label — the same
    // aria-pressed segmented pattern as the Trends timeframe toggle. It governs BOTH charts
    // below (pie population + line series); clicking repaints from the closed-over payload.
    const threshold = byDomain.thresholdDays ?? 1;
    const mttrModes = [
      ["median", "Median"],
      ["tail", "Excl. fast lane"],
    ];
    const modeSeg = el("div", { class: "seg-row", role: "group", "aria-label": "MTTR basis" },
      ...mttrModes.map(([mode, label]) =>
        el("button", {
          type: "button", class: "seg-btn seg-btn--sm",
          "aria-pressed": String(mode === domainTrendMode),
          title: mode === "tail"
            ? `With the fast lane removed (resolutions ≤ ${threshold}d)` : null,
          onclick: () => {
            domainTrendMode = mode;
            for (const b of modeSeg.children) b.setAttribute("aria-pressed", "false");
            modeSeg.children[mttrModes.findIndex(([m]) => m === mode)]
              .setAttribute("aria-pressed", "true");
            paintPie();
            paintLine();
          },
        }, label)));
    byDomainHost.append(el("div", { class: "section-head" }, sectionLabel("By domain"), modeSeg));
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

    // Line: per-domain median MTTR (days) replayed over scan history — plain median or the
    // fast-lane-excluded tail median, per the segmented switch.
    function paintLine() {
      const tail = domainTrendMode === "tail";
      const points = (trend && (tail ? trend.tailPoints : trend.points)) || [];
      lineCaption.textContent = tail
        ? `Median MTTR (days) by domain excluding resolutions ≤ ${threshold}d, per scan.`
        : "Median MTTR (days) by domain, per scan.";
      if (points.length < 2) {
        showMsg(lineCanvas, lineMsg, "Trend appears after the second saved scan.");
        return;
      }
      showChart(lineCanvas, lineMsg);
      groupTrendLines(lineCanvas, points, series, {
        unit: "days",
        nullAsGap: true,
        describe: tail
          ? "Median MTTR in days per domain over scan history, fast lane excluded."
          : "Median MTTR in days per domain over scan history.",
      });
    }

    // Pie: each domain's share of the population the switch selects — all resolved
    // findings (the set the MTTR median runs over) or just the tail beyond the fast lane.
    // Tooltip detail carries the matching per-domain median. Canonical groups/hues stay
    // fixed across the toggle (slices resize, never recolor); a domain with no tail
    // resolutions simply drops out in tail mode.
    function paintPie() {
      const tail = domainTrendMode === "tail";
      const byName = new Map(byDomain.rows.map((r) => [r.domain, r]));
      const countOf = (r) => (tail ? (r?.tailResolved ?? 0) : (r?.resolved ?? 0));
      pieCaption.textContent = tail
        ? `Each domain's share of resolutions slower than the fast lane (> ${threshold}d).`
        : "Each domain's share of resolved findings — the population feeding MTTR.";
      const slices = groups
        .map((name) => {
          const r = byName.get(name);
          return {
            label: name,
            value: countOf(r),
            color: colors.get(name),
            detail: tail
              ? "Median excl. fast lane " + fmtDays(r?.tailMedian)
              : "Median MTTR " + fmtDays(r?.median),
          };
        })
        .filter((s) => s.value > 0);
      const other = byDomain.rows
        .filter((r) => !inGroups.has(r.domain))
        .reduce((a, r) => a + countOf(r), 0);
      if (other > 0) slices.push({ label: "Other", value: other, color: colors.get("Other") });
      if (!slices.length) {
        showMsg(pieCanvas, pieMsg, tail
          ? "No resolutions beyond the fast lane."
          : "No resolved findings to partition.");
        return;
      }
      showChart(pieCanvas, pieMsg);
      groupPie(pieCanvas, slices, {
        subject: tail
          ? "Resolutions beyond the fast lane by domain"
          : "Resolved findings by domain",
      });
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
      ["Excl. fast lane",
        ["Median remediation time after removing the fast lane (resolutions ≤ " +
          `${byDomain.thresholdDays ?? 1}d), so auto-patched vulns don't drag the median ` +
          "toward zero."]],
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
        el("td", { class: "num" }, fmtDays(r.tailMedian)),
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
    const awaitingTotal = byDomain.rows.reduce((a, r) => a + (r.awaiting ?? 0), 0);
    if (awaitingTotal > 0) {
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
    const median = mttr.overall.mttr_median;
    const hist = trends.history;
    const prev = hist.length > 1 ? hist[hist.length - 2] : null;
    // The prev snapshot (mttr_history) is global across chain/support/severity, while the
    // current values are scoped by the active filters. Diffing them would show a fake delta
    // (a small domain's 5d vs the global 45d prev reads as "−40d"), so only show the change
    // chips at the unscoped whole-chain / all-severities view where the populations match.
    const scoped = scopeParam() !== null || domain || supportGroup;

    // `remediation` is additive on the server (see the plan) — a stale cached response
    // from before the rollout won't carry it, so every read below is optional-chained and
    // every affected mini/cell degrades to "—" rather than throwing.
    const rem = mttr.remediation;
    // Actionable-clock open-past-SLA, falling back to the from-detection value for a stale
    // pre-actionable cache (both share the {open, breached, pct} shape).
    const openPastSla = rem?.openPastSlaActionable?.overall ?? rem?.openPastSla?.overall;
    const overallPctiles = rem?.pctiles?.overall; // {p50, p90, count}
    const awaiting = rem?.awaiting; // {perSev, overall, openTotal, pctOfOpen}

    const minis = el("div", { class: "hero-minis" });
    const miniDefs = [
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
      ["Awaiting vendor fix", fmtAwaiting(awaiting), null],
      ["MTTR p90", fmtDays(overallPctiles?.p90), null],
      // p90 of open-finding age, not the single oldest — labelled to match the table below.
      ["Open age p90", fmtDays(mttr.oldestDays),
        !scoped && prev && prev.oldest_open_days !== null && mttr.oldestDays !== null
          ? changeChip(mttr.oldestDays, prev.oldest_open_days, { fmt: fmtDays }) : null],
    ];
    for (const [label, value, chip] of miniDefs) {
      minis.append(el("div", {},
        el("div", { class: "mini-label" }, label),
        el("div", { class: "mini-value num" }, value, chip || null),
      ));
    }
    const resolved = mttr.overall.resolved ?? 0;
    const open = mttr.overall.open ?? 0;
    // The metric itself (label + value) is the hover/focus target — no separate "i" glyph.
    const metric = helpTip(
      [
        el("div", { class: "label" }, "Median MTTR" + (domain ? ` — ${domain}` : "")),
        el("div", { class: "hero-value num" },
          median !== null && median !== undefined ? fmtDays(median) : "—",
          !scoped && prev && median !== null
            ? changeChip(median, prev.median_days, { fmt: fmtDays }) : null,
        ),
      ],
      [
        "Median days from first detection to remediation.",
        `Over ${resolved.toLocaleString()} resolved finding${resolved === 1 ? "" : "s"} — `
          + "open ones aren't counted (they show as Open age p90).",
        "A vuln that disappears between scans counts as resolved.",
      ],
      { className: "hero-metric" },
    );
    heroHost.append(
      el("div", { class: "hero" },
        metric,
        el("div", { class: "hero-src" },
          `${mttr.rowCount.toLocaleString()} tracked lifecycle(s) in the durable base · ` +
          `${resolved.toLocaleString()} resolved · ${open.toLocaleString()} open`),
        minis,
      ),
    );
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
    const tailMedianCanvas = el("canvas", { id: "tail-median-trend" });
    const openResolvedCanvas = el("canvas", { id: "open-resolved" });
    const openSlaCanvas = el("canvas", { id: "open-sla-trend" });

    const points = trend.length
      ? trend.map((t) => ({ x: t.date, y: t.median_days, reconstructed: t.reconstructed }))
      : history.map((h) => ({ x: h.date, y: h.median_days, reconstructed: false }));

    // MTTR excl. fast lane — reconstructed-trend only (mttr_history snapshots don't carry
    // it: the series depends on the configurable fast-lane window, so it's recomputed live
    // from lifecycles rather than persisted under whatever window was set at snapshot time).
    const tailMedianPoints = trend
      .map((t) => ({ x: t.date, y: t.tail_median_days, reconstructed: t.reconstructed }))
      .filter((p) => p.y !== null && p.y !== undefined);

    // Same fallback shape as `points` above, but for open_past_sla — a column that doesn't
    // exist on history rows saved before this feature shipped. Those rows carry `null`
    // (never a false 0, see historyStore.loadHistory), so they're filtered out here rather
    // than drawn as a dip to zero.
    const openSlaPoints = (trend.length
      ? trend.map((t) => ({ x: t.date, y: t.open_past_sla, reconstructed: t.reconstructed }))
      : history.map((h) => ({ x: h.date, y: h.open_past_sla, reconstructed: false })))
      .filter((p) => p.y !== null && p.y !== undefined);

    // A "trend" needs at least two points — one lone dot is not a trajectory. This matches the
    // Open-vs-resolved gate and the "after two saved scans" copy below.
    const hasTrend = points.length > 1;
    const hasTailTrend = tailMedianPoints.length > 1;
    const hasOpenSlaTrend = openSlaPoints.length > 1;
    const grid = el("div", { class: "chart-grid", style: "align-items:start" });
    if (hasTrend) {
      grid.append(el("div", { class: "chart-card" },
        el("h3", {}, "MTTR trend"),
        el("div", { class: "chart-box" }, mttrCanvas)));
    }
    if (hasTailTrend) {
      grid.append(el("div", { class: "chart-card" },
        el("h3", {}, "MTTR excl. fast lane"),
        el("div", { class: "chart-box" }, tailMedianCanvas)));
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
        el("div", { class: "chart-box" }, openSlaCanvas)));
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
      if (hasTailTrend) {
        trendLine(tailMedianCanvas, tailMedianPoints, { yLabel: "days", xRange });
      }
      if (trend.length > 1) {
        openResolvedLines(openResolvedCanvas, trend, { xRange });
      }
      if (hasOpenSlaTrend) {
        trendLine(openSlaCanvas, openSlaPoints, { yLabel: "findings", xRange });
      }
    });
  }

  /** Resolution profile: the histogram of time-to-resolve (stacked by severity) beside a
   *  compact stat card of fast-lane / tail-median / Kaplan–Meier numbers. All of it comes
   *  from `mttr.remediation`, which is additive on the server — skip the whole section
   *  when it's missing (stale cache) or empty (no resolved lifecycles to bucket yet). */
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

    const fastLane = rem.fastLane || {};
    const statCard = el("div", { class: "card" },
      statRow("Fast lane",
        fastLane.fastLanePct !== null && fastLane.fastLanePct !== undefined
          ? `${fastLane.fastLanePct.toFixed(0)}% ≤ ${fastLane.thresholdDays}d` : "—",
        [`Share of resolved findings closed within ${fastLane.thresholdDays} days — ` +
          "mostly auto-patched vulns found just before a patch window."]),
      statRow("Median (excl. fast lane)", fmtDays(fastLane.tailMedian),
        ["Median remediation time after removing the fast lane, so auto-patched vulns " +
          "don't drag the median toward zero."]),
      statRow("KM median (from detection)", fmtDays(rem.kmMedian),
        ["Kaplan–Meier median time-to-remediation. Counts still-open findings as censored " +
          "(not-yet-resolved) instead of ignoring them, so it isn't biased low by fresh " +
          "fast-patched vulns. “—” means over half of findings are still open."]),
      statRow("KM median (actionable)", fmtDays(rem.kmMedianActionable),
        ["The same Kaplan–Meier median, but the clock starts when a vendor fix became " +
          "available rather than at first detection — so a fix that arrives late doesn't " +
          "count against the team. Findings still awaiting a vendor fix don't count at all."]),
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
      ["Awaiting",
        ["Open findings with no vendor fix available yet — excluded from the SLA clock " +
          "until a fix appears, so they don't count as breached above."]],
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
        el("td", { class: "num" }, (mttr.remediation?.awaiting?.perSev?.[sev] ?? 0).toLocaleString()),
        el("td", { class: "num" }, fmtDays(d.open_age_p90)),
        el("td", { class: "num" }, d.sla_target ? `${d.sla_target}d` : "—"),
        el("td", { class: "num" }, d.sla_pct !== null ? `${d.sla_pct.toFixed(0)}%` : "—"),
      ));
    }
    table.append(tbody);
    slaHost.append(el("div", { class: "table-wrap" }, table));
  }
}
