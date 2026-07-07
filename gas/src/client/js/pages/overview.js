// OS vulnerabilities — the default page. Insights over the current scan and the
// durable ledger instead of a findings table (Wiz already has one of those):
// KPI band, severity breakdown, exploitability summary, risk concentration, aging
// of open findings, scan-over-scan movement, and a multi-level grouping breakdown.

import { severityBar, stackedAgeBar } from "../charts.js";
import { bootstrap, setParams, swrCall } from "../store.js";
import {
  clear, el, emptyState, kpiCard, nvdUrl, sectionLabel,
} from "../ui.js";

// Keep in sync with AGE_BUCKET_LABELS in src/domain/insights.ts (the client bundle
// can't import the TS domain module).
const AGE_LABELS = ["0-7d", "8-30d", "31-90d", "90+d"];

// UPPERCASE severity key -> Title Case display label ("CRITICAL" -> "Critical").
function sevTitle(sev) {
  return sev.charAt(0) + sev.slice(1).toLowerCase();
}

/** Streamlit-style signed delta chip vs a previous value: arrow + absolute change +
 *  "· ±N%". A rising count is worse (red), falling is better (green), unchanged shows a
 *  neutral ±0. Returns null when there's no previous value to compare against. */
function deltaChip(current, previous) {
  if (previous === null || previous === undefined || Number.isNaN(previous)) return null;
  const delta = current - previous;
  if (!delta) return el("span", { class: "sev-delta flat" }, "±0");
  const rising = delta > 0;
  const arrow = rising ? "▲" : "▼";
  const sign = rising ? "+" : "−";
  const mag = Math.abs(delta).toLocaleString();
  const pct = previous ? Math.round(Math.abs((delta / previous) * 100)) : null;
  return el("span", { class: `sev-delta ${rising ? "bad" : "good"}` },
    el("span", { "aria-hidden": "true" }, arrow), ` ${sign}${mag}`,
    pct !== null ? el("span", { class: "sev-delta-pct" }, ` · ${sign}${pct}%`) : null,
  );
}

// Groupable dimensions for the multi-level Breakdown table (value -> label). Mirrors
// GROUP_COLUMNS in src/domain/insights.ts (the client bundle can't import the TS module).
const GROUP_DIMENSIONS = [
  ["domain", "Domain"],
  ["asset", "Asset"],
  ["atype", "Asset type"],
  ["cloud", "Cloud"],
  ["os", "Operating system"],
  ["subscription", "Subscription"],
  ["cve", "CVE"],
];

export async function renderOverview(main, params, ctx) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "OS vulnerabilities"),
    el("p", { class: "page-sub" },
      "What the latest scan means: what is exploitable, where risk concentrates, and what to fix next. ",
      el("a", { href: "#/mttr", target: "_self" }, "Remediation performance →"),
    ),
  );

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

  const kpiRow = el("div", { class: "kpi-row" });
  const sevChartCanvas = el("canvas", { id: "sev-chart" });
  const sevCardHost = el("div", {});
  // Severity breakdown: a section label over two columns — the per-severity stat card
  // (left) beside the severity bar (right), mirroring the Streamlit OS-vulns page.
  const sevSection = el("div", {},
    sectionLabel("Severity breakdown"),
    el("div", { class: "chart-grid", style: "align-items:start" },
      sevCardHost,
      el("div", { class: "chart-card" },
        el("div", { class: "chart-box" }, sevChartCanvas)),
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
  paint(await swrCall("api_getInsights", { domain: ctx.domain || "" }, paint));

  /** Scan-summary band (Total / Open / Resolved) + severity breakdown. At the
   *  whole-chain view counts come from bootstrap so they match the sidebar and survive
   *  grouped scans; under a Value Chain filter they come from the (domain-scoped)
   *  insights payload instead. Open/Resolved need insights, so they show "…" until it
   *  loads. */
  function renderHeadline(insights) {
    clear(kpiRow);
    const filtered = !!(ctx.domain && insights && insights.flatScan);
    const counts = filtered ? insights.counts : boot.counts;
    const total = filtered
      ? insights.total
      : Object.values(boot.counts).reduce((a, b) => a + b, 0);
    const open = insights && insights.flatScan ? insights.exploit.open : null;
    kpiRow.append(
      kpiCard("Total findings", total.toLocaleString(),
        `scan ${boot.latestScan.ts.slice(0, 10)} — ${boot.latestScan.mode}`),
      kpiCard("Open", open !== null ? open.toLocaleString() : "…", "awaiting remediation"),
      kpiCard("Resolved", open !== null ? (total - open).toLocaleString() : "…",
        "closed in this scan"),
    );
    requestAnimationFrame(() => {
      // The breakdown only shows severities enabled in the display setting — a
      // severity the user hasn't turned on (e.g. Low/Medium) is omitted, not zeroed.
      const displaySet = new Set(boot.settings.displaySeverities);
      const shown = {};
      for (const s of boot.palette.order) if (displaySet.has(s) && counts[s]) shown[s] = counts[s];
      severityBar(sevChartCanvas, shown, boot.palette);
    });
    renderSevCard(insights, filtered, counts);
  }

  /** Severity breakdown card (mirrors the Streamlit stat list): one row per severity
   *  CRITICAL–LOW (INFO/UNKNOWN omitted) that is enabled in the display setting, each a
   *  color dot + label, the count with an "N open · N resolved" split, and a delta chip
   *  vs the previous scan. The split needs the insights payload; the delta is dropped
   *  under a Value Chain filter (no per-chain baseline), matching the headline. */
  function renderSevCard(insights, filtered, counts) {
    const sevStats = insights && insights.flatScan ? insights.sevStats : null;
    const displaySet = new Set(boot.settings.displaySeverities);
    const card = el("div", { class: "stat-card" });
    for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW"].filter((s) => displaySet.has(s))) {
      const count = counts[sev] || 0;
      const stat = sevStats && sevStats[sev];
      card.append(
        el("div", { class: "stat-card__row" },
          el("span", { class: "stat-card__name" },
            el("span", { class: "sev-dot", "aria-hidden": "true",
              style: `background:${boot.palette.colors[sev]}` }),
            sevTitle(sev)),
          el("span", { class: "stat-card__value-group" },
            el("span", { class: "stat-card__value num" }, count.toLocaleString()),
            stat
              ? el("span", { class: "stat-card__sub-value" },
                `${(stat.open || 0).toLocaleString()} open · ` +
                `${(stat.resolved || 0).toLocaleString()} resolved`)
              : null),
          filtered ? null : deltaChip(count, boot.prevCounts[sev]),
        ),
      );
    }
    clear(sevCardHost).append(card);
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
        `last per-finding scan from ${insights.scan.ts.slice(0, 10)}.`));
    }

    renderExploitability(insights);
    renderAging(insights);
    renderMovement(insights);
    renderBreakdown();
  }

  // ------------------------------------------------------- exploitability & priority

  function renderExploitability(insights) {
    const s = insights.exploit;
    insightsHost.append(sectionLabel("Exploitability & priority"));
    const tiles = el("div", { class: "kpi-row" },
      kpiCard("CISA KEV", s.kev.toLocaleString(), "known exploited in the wild"),
      kpiCard("Exploit available", s.exploit.toLocaleString(), "public exploit exists"),
      kpiCard("EPSS ≥ 10%", s.highEpss.toLocaleString(), "predicted exploitation likelihood"),
      s.exposureKnown
        ? kpiCard("Internet-exposed", s.internetExposed.toLocaleString(), "reachable from outside")
        : kpiCard("Internet-exposed", "n/a", "rescan to capture exposure"),
    );
    insightsHost.append(
      el("p", { class: "small muted", style: "margin:-14px 0 10px" },
        `Open findings only (${s.open.toLocaleString()} open in this scan); one finding can carry several signals.`),
      tiles,
    );
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
        `${insights.aging.totalOpen.toLocaleString()} still-open findings from the durable ` +
        "ledger, bucketed by age since first seen."),
      el("div", { class: "chart-box" }, canvas),
    ));
    requestAnimationFrame(() => {
      stackedAgeBar(canvas, AGE_LABELS, insights.aging.perSev, boot.palette);
    });
  }

  // ---------------------------------------------------------------------- movement

  function renderMovement(insights) {
    const m = insights.movement;
    insightsHost.append(sectionLabel("Scan-over-scan movement"));
    if (!m.hasPrevious) {
      insightsHost.append(el("p", { class: "muted" },
        "First scan — movement appears once there is a previous scan to compare against."));
    } else {
      insightsHost.append(el("div", { class: "kpi-row" },
        kpiCard("New", m.newCount.toLocaleString(), "first seen in the latest scan"),
        kpiCard("Resolved", m.resolvedCount.toLocaleString(), "closed by the latest scan"),
        kpiCard("Reopened", m.reopenedCount.toLocaleString(), "back after being resolved"),
        kpiCard("Persisting", m.persisting.toLocaleString(), "open since an earlier scan"),
      ));
      if (ctx.domain) {
        insightsHost.append(el("p", { class: "small muted", style: "margin:8px 0 0" },
          "New / Resolved / Reopened are chain-wide — scan-over-scan deltas can't be " +
          "split by value chain. Persisting reflects this value chain."));
      }
    }
  }

  // --------------------------------------------------------------------- breakdown

  /** Consolidated breakdown: an ordered grouping path (Domain → Asset → …) rendered as
   *  an expandable tree table. Domain and CVE are just dimensions here — grouping by CVE
   *  reproduces the old Top-CVEs table. Data comes from api_getGrouping (the insights
   *  payload doesn't carry arbitrary N-level groupings). */
  function renderBreakdown() {
    insightsHost.append(sectionLabel("Breakdown"));
    const controls = el("div", { class: "filter-bar" });
    const tableHost = el("div", {});
    insightsHost.append(controls, tableHost);
    renderControls();
    loadGrouping();

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
      setParams({ by: groupKeys.join(",") });
      renderControls();
      loadGrouping();
    }

    async function loadGrouping() {
      clear(tableHost).append(el("p", { class: "muted" }, "Grouping…"));
      const keys = groupKeys.slice();
      const paint = (data) => {
        if (keys.join(",") !== groupKeys.join(",")) return; // a newer path superseded this
        renderTree(tableHost, (data && data.groups) || []);
      };
      paint(await swrCall("api_getGrouping", { domain: ctx.domain || "", keys }, paint));
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
        if (caret) caret.textContent = expanded.has(row.id) ? "▾" : "▸";
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
        caret = el("span", { class: "tree-caret", role: "button", tabindex: "0",
          "aria-label": "Expand or collapse group", onclick: () => toggle(id) }, "▸");
        caret.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(id); }
        });
      } else {
        caret = el("span", { class: "tree-caret-spacer", "aria-hidden": "true" });
      }
      const risky = [];
      if (node.kev) risky.push("KEV");
      if (node.exploit) risky.push("Exploit");
      return el("tr", {},
        el("td", { style: `padding-left:${depth * 20 + 8}px` },
          el("span", { style: "display:inline-flex; align-items:center; gap:6px" }, caret, label)),
        el("td", {}, mixStrip(node.sevCounts)),
        el("td", { class: "num" }, node.assets.toLocaleString()),
        el("td", { class: "num" }, node.total.toLocaleString()),
        el("td", { class: "num" }, node.open.toLocaleString()),
        el("td", {}, risky.join(" · ") || ""),
      );
    }
  }

  // ----------------------------------------------------------------------- helpers

  /** Proportional severity-mix bar. Color is paired with the textual counts the
   *  caller renders beside it (mixText) and an aria-label — never color alone. */
  function mixStrip(sevCounts) {
    const total = boot.palette.order.reduce((a, s) => a + (sevCounts[s] || 0), 0);
    const strip = el("div", {
      class: "mix-strip", role: "img", "aria-label": mixText(sevCounts) || "no findings",
    });
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
