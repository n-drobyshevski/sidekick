// OS vulnerabilities — the default page. Insights over the current scan and the
// durable ledger instead of a findings table (Wiz already has one of those):
// KPI band, severity breakdown, exploitability summary, risk concentration, aging
// of open findings, scan-over-scan movement, and a multi-level grouping breakdown.

import {
  destroyChart, groupPalette, groupPie, groupTrendLines, severityTrendLines, stackedAgeBar,
} from "../charts.js";
import { bootstrap, setParams, swrCall } from "../store.js";
import {
  clear, el, emptyState, eolHiddenNote, fmtDate, helpTip, kpiCard, noFixHiddenNote, nvdUrl, openSheet, pager,
  scopeBar, sectionLabel, severityScopeFilter,
} from "../ui.js";

// Rows per page in the "Oldest open findings" panel's prev/next pagination. The server ships
// up to 100 rows per view (see api.getInsights → oldest), so this yields up to ten pages.
const OLDEST_PAGE_SIZE = 10;

// Keep in sync with AGE_BUCKET_LABELS in src/domain/insights.ts (the client bundle
// can't import the TS domain module).
const AGE_LABELS = ["0-7d", "8-30d", "31-90d", "90+d"];

// UPPERCASE severity key -> Title Case display label ("CRITICAL" -> "Critical").
function sevTitle(sev) {
  return sev.charAt(0) + sev.slice(1).toLowerCase();
}

// Whole-day label for an age in days ("412d"). The server ships fractional day counts.
function fmtDays(n) {
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

export async function renderOverview(main, params, ctx) {
  const boot = await bootstrap();

  // Which severities scope every section on this page. Defaults to the app-wide display
  // setting so Overview opens scoped like MTTR; falls back to all selectable if empty.
  // Page-local and non-persisted: resets to the display setting on each visit.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];

  main.append(
    el("div", { class: "page-head" },
      el("h1", {}, "OS vulnerabilities"),
      severityScopeFilter({
        selectable: boot.palette.selectable, scope: sevScope,
        onApply: () => loadInsights(), ariaContext: "OS vulnerabilities",
      })),
    el("p", { class: "page-sub" },
      "What's exploitable, where risk concentrates, and what to fix next. ",
      el("a", { href: "#/mttr", target: "_self" }, "Remediation performance →"),
    ),
  );

  const scopeChips = scopeBar({
    domain: ctx.domain, supportGroup: ctx.supportGroup, onClear: ctx.clearScope,
  });
  if (scopeChips) main.append(scopeChips);
  if (boot.settings.showNoFix === false) main.append(noFixHiddenNote());
  if (boot.settings.includeEol === false) main.append(eolHiddenNote());

  if (!boot.latestScan) {
    main.append(emptyState(
      "No scan saved yet.",
      "Use “Run scan” in the sidebar to take the first measurement.",
    ));
    return;
  }

  // Ordered grouping path for the Breakdown table, persisted across insights repaints.
  // Seeded from the URL (?by=domain,asset) or a default: the value chain's domains at
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

  const kpiRow = el("div", { class: "kpi-row" });
  const sevChartCanvas = el("canvas", { id: "sev-chart" });
  // Shown in place of the line when there isn't enough scan history to plot a trend.
  const sevChartMsg = el("p", { class: "chart-empty muted", style: "display:none" });
  const sevCardHost = el("div", {});
  // Severity breakdown: a section label over two columns — the per-severity stat card
  // (left, open count leading) beside the open-per-severity trend line (right).
  const sevSection = el("div", {},
    sectionLabel("Severity breakdown"),
    el("div", { class: "chart-grid", style: "align-items:start" },
      sevCardHost,
      el("div", { class: "chart-card" },
        el("div", { class: "chart-box" }, sevChartCanvas, sevChartMsg),
        el("p", { class: "chart-caption muted" }, "Open findings by severity, per scan.")),
    ),
  );
  const insightsHost = el("div", {}, el("p", { class: "muted" }, "Computing insights…"));
  main.append(kpiRow, sevSection, insightsHost);

  renderHeadline(null);

  // One batched RPC; revisits paint instantly from the session cache and repaint
  // in the background only when the revalidated payload differs.
  const paint = (data) => {
    renderHeadline(data);
    renderInsights(data);
  };
  async function loadInsights() {
    paint(await swrCall("api_getInsights",
      { domain: ctx.domain || "", supportGroup: ctx.supportGroup || "",
        severities: scopeParam() },
      paint));
  }
  await loadInsights();

  // Null when every selectable severity is chosen (no filter → shares the default cache
  // entry); otherwise the chosen subset, which the server keeps alongside UNKNOWN.
  function scopeParam() {
    return sevScope.length === boot.palette.selectable.length ? null : [...sevScope];
  }

  /** Scan-summary band (Total / Open / Resolved) + severity breakdown. At the
   *  whole-chain view counts come from bootstrap so they match the sidebar and survive
   *  grouped scans; under a Value Chain filter they come from the (domain-scoped)
   *  insights payload instead. Open/Resolved need insights, so they show "…" until it
   *  loads. */
  function renderHeadline(insights) {
    clear(kpiRow);
    // Any active scope (value chain, sidebar support group, or severity filter) makes the
    // headline read the server's scoped counts instead of whole-scan bootstrap counts, so
    // Total/Open/Resolved and the severity split stay coherent with the sections below.
    const scoped = ctx.domain || ctx.supportGroup || scopeParam();
    const filtered = !!(scoped && insights && insights.flatScan);
    const counts = filtered ? insights.counts : boot.counts;
    const total = filtered
      ? insights.total
      : Object.values(boot.counts).reduce((a, b) => a + b, 0);
    const open = insights && insights.flatScan ? insights.exploit.open : null;
    kpiRow.append(
      kpiCard("Total findings", total.toLocaleString(),
        `scan ${fmtDate(boot.latestScan.ts)} — ${boot.latestScan.mode}`),
      kpiCard("Open", open !== null ? open.toLocaleString() : "…", "awaiting remediation"),
      kpiCard("Resolved", open !== null ? (total - open).toLocaleString() : "…",
        "closed in this scan"),
    );
    requestAnimationFrame(() => {
      // The line plots open findings per severity across the saved scans. It needs the
      // insights payload and at least two scans; until then show an honest note rather
      // than a degenerate one-point line. Severities not enabled in the display setting
      // are dropped inside severityTrendLines via sevScope.
      const trend = insights && insights.flatScan ? insights.openTrend : null;
      if (trend && trend.length >= 2) {
        sevChartMsg.style.display = "none";
        sevChartCanvas.style.display = "";
        severityTrendLines(sevChartCanvas, trend, boot.palette, sevScope);
      } else {
        destroyChart(sevChartCanvas);
        sevChartCanvas.style.display = "none";
        sevChartMsg.textContent = insights
          ? "Trend appears after the second scan."
          : "Computing trend…";
        sevChartMsg.style.display = "";
      }
    });
    renderSevCard(insights);
  }

  /** Severity breakdown card: one row per severity CRITICAL–LOW (INFO/UNKNOWN omitted)
   *  enabled in the display setting, each a color dot + label. The headline number is the
   *  count of OPEN findings — what the analyst acts on — with resolved + total demoted to
   *  the sub-line, and a delta chip comparing open against the previous scan's open. All
   *  three need the insights payload, so the value shows "…" until it loads; the delta
   *  needs a second scan for a baseline. The open-per-severity series is scoped like the
   *  rest of the page, so the baseline stays valid under a Value Chain / support filter. */
  function renderSevCard(insights) {
    const loaded = insights && insights.flatScan;
    const sevStats = loaded ? insights.sevStats : null;
    // Previous scan's open-per-severity, from the same scoped series that feeds the line.
    // A severity absent from that scan means zero open then, so default to 0 when a
    // baseline scan exists — otherwise leave it null so no chip renders.
    const trend = loaded ? insights.openTrend : null;
    const prevBySev = trend && trend.length >= 2 ? trend[trend.length - 2].bySev : null;
    const displaySet = new Set(sevScope);
    const card = el("div", { class: "stat-card" });
    for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW"].filter((s) => displaySet.has(s))) {
      const stat = sevStats && sevStats[sev];
      const open = stat ? stat.open || 0 : null;
      const prevOpen = prevBySev ? prevBySev[sev] || 0 : null;
      card.append(
        el("div", { class: "stat-card__row" },
          el("span", { class: "stat-card__name" },
            el("span", { class: "sev-dot", "aria-hidden": "true",
              style: `background:${boot.palette.colors[sev]}` }),
            sevTitle(sev)),
          el("span", { class: "stat-card__value-group" },
            el("span", { class: "stat-card__value num" },
              open !== null ? open.toLocaleString() : "…"),
            stat
              ? el("span", { class: "stat-card__sub-value" },
                `${(stat.resolved || 0).toLocaleString()} resolved · ` +
                `${(stat.total || 0).toLocaleString()} total`)
              : null),
          open !== null ? deltaChip(open, prevOpen) : null,
        ),
      );
    }
    clear(sevCardHost).append(card);
    // Data-quality note: findings whose severity never normalized to CRITICAL–LOW/INFO are
    // still folded into every total on this card and above (SEVERITY_ORDER includes
    // UNKNOWN) — they just have no row of their own, since the card is deliberately
    // CRITICAL–LOW only. Optional-chained: sevStats is null until insights load, and a
    // stale pre-fallback cache simply omits UNKNOWN entirely.
    if (sevStats?.UNKNOWN?.total > 0) {
      sevCardHost.append(el("p", { class: "section-note" },
        `${sevStats.UNKNOWN.total.toLocaleString()} finding(s) have an unrecognized ` +
        "severity — counted in totals, not shown above."));
    }
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

    renderExploitability(insights);
    renderAging(insights);
    renderMovement(insights);
    // The multi-dimension group explorer (group-by controls + pie + trend + expandable tree)
    // is the page's heaviest surface — it opens in a drawer so the default scroll stays
    // focused. The grouping path still persists to the URL (?by=) from inside the sheet.
    insightsHost.append(sectionLabel("Breakdown"));
    insightsHost.append(el("p", { class: "small muted", style: "margin:-6px 0 10px" },
      "Group open findings by any dimension — domain, asset, CVE, OS … — and drill in."));
    insightsHost.append(el("button", {
      type: "button",
      onclick: () => openSheet((body) => renderBreakdown(body),
        { title: "Breakdown", subtitle: "Group open findings by any dimension and drill in." }),
    }, "Explore breakdown →"));
  }

  // ------------------------------------------------------- exploitability & priority

  function renderExploitability(insights) {
    const s = insights.exploit;
    // The "open-only, signals overlap" caveat moves from an always-on note onto the section
    // label's hover, matching the MTTR convention.
    insightsHost.append(el("h2", { class: "section-label" },
      helpTip("Exploitability & priority",
        [`Open findings only — ${s.open.toLocaleString()} open in this scan; ` +
          "one finding can carry several signals."],
        { className: "help-label" })));
    const tiles = el("div", { class: "kpi-row" },
      kpiCard("CISA KEV", s.kev.toLocaleString(), "known exploited in the wild"),
      kpiCard("Exploit available", s.exploit.toLocaleString(), "public exploit exists"),
      kpiCard("EPSS ≥ 10%", s.highEpss.toLocaleString(), "predicted exploitation likelihood"),
      s.exposureKnown
        ? kpiCard("Internet-exposed", s.internetExposed.toLocaleString(), "reachable from outside")
        : kpiCard("Internet-exposed", "n/a", "rescan to capture exposure"),
    );
    insightsHost.append(tiles);
    // Awaiting-vendor-fix line: open findings with no patch available yet, sourced from the
    // insights payload (awaitingVendorFix over the same scoped base). Sits outside the SLA
    // clock, and explains the open-count step-up once fix-tracking rolled out. Optional-
    // chained so a stale pre-rollout cache simply omits it rather than throwing. Hidden
    // entirely when the vendor-fix filter is off — awaiting stats arrive zeroed then, and the
    // page-level honesty note already covers it.
    const aw = insights.awaiting;
    if (boot.settings.showNoFix !== false && aw && aw.overall > 0) {
      const pct = aw.pctOfOpen !== null && aw.pctOfOpen !== undefined
        ? ` (${aw.pctOfOpen.toFixed(0)}% of open)` : "";
      insightsHost.append(el("p", { class: "small muted", style: "margin:8px 0 0" },
        `${aw.overall.toLocaleString()} open finding${aw.overall === 1 ? "" : "s"}${pct} `
        + "awaiting a vendor fix — no patch is available yet, so they sit outside the SLA "
        + "clock. Included in the register since fix-tracking rolled out."));
    }
  }

  // ------------------------------------------------------------------------- aging

  function renderAging(insights) {
    insightsHost.append(sectionLabel("Aging of open findings"));
    if (!insights.aging.totalOpen) {
      insightsHost.append(emptyState("No open findings in the durable base."));
      return;
    }
    const canvas = el("canvas", { id: "aging-chart" });
    insightsHost.append(el("div", { class: "chart-card" },
      el("h3", {}, "How long open findings have been open"),
      el("div", { class: "small muted", style: "margin-bottom:8px" },
        `${insights.aging.totalOpen.toLocaleString()} still-open findings, bucketed by age since first seen.`),
      el("div", { class: "chart-box" }, canvas),
    ));
    // The histogram above answers "how aged is the backlog?"; the ranked detail — the
    // longest-open findings and the assets / support groups / domains carrying the 90+ tail —
    // moves into a drawer to answer "which ones?". `oldest` is missing when a newer client
    // meets an older/cached payload, so the button only shows when it's present.
    if (insights.oldest) {
      insightsHost.append(el("button", {
        type: "button", style: "margin-top:10px",
        onclick: () => openSheet(
          (body) => body.append(renderOldestPanel(insights.oldest)),
          { title: "Oldest open findings",
            subtitle: "The longest-open findings, and the assets, groups and domains carrying the aged backlog." }),
      }, "Oldest open findings →"));
    }
    requestAnimationFrame(() => {
      stackedAgeBar(canvas, AGE_LABELS, insights.aging.perSev, boot.palette);
    });
  }

  /** Right-column panel for the aging section: a segmented toggle over the oldest-open
   *  views with a ranked table beneath. Repaints from the already-loaded payload, no RPC. */
  function renderOldestPanel(oldest) {
    let view = "findings";
    // Current page within the active view, reset to 0 whenever the view switches. The server
    // ships the full (capped) row set for every view, so paging is pure client-side slicing —
    // no RPC per page.
    let page = 0;
    const toggle = el("div", { class: "filter-bar", role: "group", "aria-label": "Oldest open findings view" });
    const tableHost = el("div", {});
    const pagerHost = el("div", {});
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
          paint();
        },
      }, label);
      toggle.append(btn);
    }

    function paint() {
      const individual = view === "findings";
      caption.textContent = individual
        ? "Longest-open findings, oldest first."
        : "Ranked by open findings older than 90 days.";
      const allRows = (individual ? oldest.findings : oldest[view]) || [];
      const pageCount = Math.max(1, Math.ceil(allRows.length / OLDEST_PAGE_SIZE));
      // Clamp when a view switch (or a smaller payload on revalidation) leaves `page` past the end.
      if (page >= pageCount) page = pageCount - 1;
      const pageRows = allRows.slice(page * OLDEST_PAGE_SIZE, (page + 1) * OLDEST_PAGE_SIZE);
      // The Assets view carries per-asset Subscription / Domain; other group views don't.
      const extraCols = view === "byAsset"
        ? [{ header: "Subscription", get: (g) => g.subscription || "—" },
           { header: "Domain", get: (g) => g.domain || "—" }]
        : [];
      clear(tableHost).append(individual
        ? oldestFindingsTable(pageRows)
        : oldestGroupTable(pageRows, OLDEST_VIEWS.find(([v]) => v === view)[1], extraCols));
      // Prev/Next controls (pager() shows just "N rows" when a single page fits). onPage
      // repaints from the already-loaded rows, so paging never hits the server.
      clear(pagerHost);
      if (allRows.length) {
        pagerHost.append(pager(page, pageCount, allRows.length, (p) => { page = p; paint(); }));
      }
    }

    paint();
    return el("div", { class: "chart-card" },
      el("h3", {}, "Oldest open findings"),
      toggle, tableHost, pagerHost, caption);
  }

  /** Ranked table of individual oldest open findings (CVE · Asset · Subscription · Severity · Age). */
  function oldestFindingsTable(rows) {
    if (!rows || !rows.length) return emptyState("No open findings to rank.");
    const body = el("tbody", {});
    for (const r of rows) {
      const cve = r.cve && r.cve !== "(none)"
        ? el("a", { href: nvdUrl(r.cve), target: "_blank", rel: "noopener" }, r.cve)
        : (r.cve || "—");
      body.append(el("tr", {},
        el("td", {}, cve),
        el("td", {}, r.asset || "—"),
        el("td", {}, r.subscription || "—"),
        el("td", {}, el("span", { class: "sev-dot", "aria-hidden": "true",
          style: `background:${boot.palette.colors[r.severity] || "var(--text-3)"}` }),
          sevTitle(r.severity)),
        el("td", { class: "num" }, fmtDays(r.ageDays)),
      ));
    }
    return el("div", { class: "table-wrap" },
      el("table", { class: "data" },
        el("thead", {}, el("tr", {},
          ...["CVE", "Asset", "Subscription", "Severity", "Age"].map((h) => el("th", { scope: "col" }, h)))),
        body));
  }

  /** Ranked table of the 90+ day open backlog per group (Group [· extras] · 90+ days · Open ·
   *  Oldest). extraCols ([{ header, get }]) render right after the group-name column — the
   *  Assets view uses them for Subscription / Domain; other group views pass none. */
  function oldestGroupTable(rows, dimLabel, extraCols = []) {
    if (!rows || !rows.length) return emptyState("No open findings to rank.");
    const body = el("tbody", {});
    for (const g of rows) {
      body.append(el("tr", {},
        el("td", {}, el("strong", {}, g.key)),
        ...extraCols.map((c) => el("td", {}, c.get(g))),
        el("td", { class: "num" }, g.agedCount.toLocaleString()),
        el("td", { class: "num" }, g.openCount.toLocaleString()),
        el("td", { class: "num" }, fmtDays(g.oldestDays)),
      ));
    }
    return el("div", { class: "table-wrap" },
      el("table", { class: "data" },
        el("thead", {}, el("tr", {},
          el("th", { scope: "col" }, dimLabel),
          ...extraCols.map((c) => el("th", { scope: "col" }, c.header)),
          el("th", { scope: "col" }, "90+ days"),
          el("th", { scope: "col" }, "Open"),
          el("th", { scope: "col" }, "Oldest"))),
        body));
  }

  // ---------------------------------------------------------------------- movement

  function renderMovement(insights) {
    const m = insights.movement;
    insightsHost.append(sectionLabel("Scan-over-scan movement"));
    if (!m.hasPrevious) {
      insightsHost.append(el("p", { class: "muted" },
        "First scan — movement appears once there is a previous scan to compare against."));
      return;
    }
    // Compact by default: the two trajectory numbers (New vs Newly resolved — are we gaining
    // or losing ground) inline, with the full New / Newly resolved / Reopened / Persisting
    // breakdown and the scope caveat one click away in a drawer.
    const miniStat = (value, label) => el("div", {},
      el("div", { class: "mini-value num" }, value),
      el("div", { class: "mini-label" }, label));
    const renderMovementDetail = (body) => {
      body.append(el("div", { class: "kpi-row" },
        kpiCard("New", m.newCount.toLocaleString(), "first seen in the latest scan"),
        kpiCard("Newly resolved", m.resolvedCount.toLocaleString(), "closed since the previous scan"),
        kpiCard("Reopened", m.reopenedCount.toLocaleString(), "back after being resolved"),
        kpiCard("Persisting", m.persisting.toLocaleString(), "open since an earlier scan"),
      ));
      if (ctx.domain || ctx.supportGroup) {
        body.append(el("p", { class: "small muted", style: "margin:12px 0 0" },
          "New / Resolved / Reopened are scan-wide — scan-over-scan deltas can't be " +
          "split by the active filter. Persisting reflects the filtered scope."));
      }
    };
    insightsHost.append(el("div",
      { style: "display:flex; gap:32px; align-items:flex-end; flex-wrap:wrap" },
      miniStat(m.newCount.toLocaleString(), "New"),
      miniStat(m.resolvedCount.toLocaleString(), "Newly resolved"),
      el("button", {
        type: "button", style: "margin-left:auto",
        onclick: () => openSheet(renderMovementDetail, { title: "Scan-over-scan movement" }),
      }, "Movement details →"),
    ));
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
      destroyChart(canvas);
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
        requestAnimationFrame(() => groupPie(pieCanvas, slices));
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
          requestAnimationFrame(() => groupTrendLines(lineCanvas, td.points, series));
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
        const remove = groupKeys.length > 1
          ? el("button", { class: "linklike danger", title: "Remove this level", "aria-label": "Remove grouping level",
              onclick: () => { groupKeys.splice(i, 1); syncAndReload(); } }, "×")
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
   *  rows: the top level is open, deeper levels collapsed until their parent expands. */
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
            el("span", { class: "mix-text small muted num" }, mixText(node.sevCounts) || "—"))),
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
