// OS vulnerabilities — the default page. Insights over the current scan and the
// durable ledger instead of a findings table (Wiz already has one of those):
// KPI band, severity breakdown, exploitability summary, risk concentration, aging
// of open findings, scan-over-scan movement, and a configurable grouping breakdown.

import { hBar, severityBar, stackedAgeBar } from "../charts.js";
import { bootstrap, setParams, swrCall } from "../store.js";
import {
  changeChip, clear, el, emptyState, kpiCard, nvdUrl, sectionLabel, sevBadge,
} from "../ui.js";

// Keep in sync with AGE_BUCKET_LABELS in src/domain/insights.ts (the client bundle
// can't import the TS domain module).
const AGE_LABELS = ["0-7d", "8-30d", "31-90d", "90+d"];

// Grouping options for the breakdown section; "domain" is offered only when
// domains are configured (mirrors the old table's group-by vocabulary).
const BREAKDOWN_OPTIONS = [
  ["domain", "Domain"],
  ["subscription", "Subscription"],
  ["asset", "Asset"],
  ["atype", "Asset type"],
  ["cloud", "Cloud"],
  ["os", "Operating system"],
];
const DEFAULT_BY = "atype";

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

  const validBy = BREAKDOWN_OPTIONS
    .filter(([v]) => v !== "domain" || boot.domainNames.length > 1)
    .map(([v]) => v);
  const state = { by: validBy.includes(params.by) ? params.by : DEFAULT_BY };

  const kpiRow = el("div", { class: "kpi-row" });
  const sevChartCanvas = el("canvas", { id: "sev-chart" });
  const sevSection = el("div", {},
    el("div", { class: "chart-card" },
      el("h3", {}, "Severity breakdown"),
      el("div", { class: "chart-box" }, sevChartCanvas),
    ),
    el("div", { class: "kpi-row", style: "margin-top:14px" }),
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

  /** KPI band + severity breakdown. At the whole-chain view ("Value Chain") counts
   *  come from bootstrap so they match the sidebar and survive grouped scans. Under a
   *  Value Chain filter they come from the (domain-scoped) insights payload instead —
   *  otherwise the band would read whole-scan while Open below it is filtered. No
   *  per-chain baseline exists, so the scan-over-scan change chips are dropped there. */
  function renderHeadline(insights) {
    clear(kpiRow);
    const filtered = !!(ctx.domain && insights && insights.flatScan);
    const counts = filtered ? insights.counts : boot.counts;
    const total = filtered
      ? insights.total
      : Object.values(boot.counts).reduce((a, b) => a + b, 0);
    const chip = (s) => (filtered ? null : changeChip(boot.counts[s], boot.prevCounts[s]));
    kpiRow.append(
      kpiCard("Total findings", total.toLocaleString(),
        `scan ${boot.latestScan.ts.slice(0, 10)} — ${boot.latestScan.mode}`),
      kpiCard("Open", insights && insights.flatScan
        ? insights.exploit.open.toLocaleString() : "…",
        "awaiting remediation"),
      ...boot.palette.order
        .filter((s) => counts[s])
        .slice(0, 2)
        .map((s) => kpiCard(s, counts[s].toLocaleString(), null, chip(s))),
    );
    requestAnimationFrame(() => {
      severityBar(sevChartCanvas, counts, boot.palette);
    });
    const cards = clear(sevSection.lastChild);
    for (const sev of boot.palette.order) {
      if (!counts[sev]) continue;
      cards.append(
        el("div", { class: "kpi-card" },
          sevBadge(sev),
          el("div", { class: "kpi-value num" },
            counts[sev].toLocaleString(),
            chip(sev),
          ),
        ),
      );
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
        `last per-finding scan from ${insights.scan.ts.slice(0, 10)}.`));
    }

    renderExploitability(insights);
    renderConcentration(insights);
    renderAging(insights);
    renderMovement(insights);
    renderBreakdown(insights);
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

  // ------------------------------------------------------------- risk concentration

  function renderConcentration(insights) {
    insightsHost.append(sectionLabel("Risk concentration"));
    if (!insights.topAssets.length) {
      insightsHost.append(emptyState("No open findings — no asset concentration to show."));
      return;
    }
    const canvas = el("canvas", { id: "top-assets-chart" });
    const list = el("div", { class: "rank-list" });
    for (const a of insights.topAssets) {
      list.append(el("div", { class: "rank-row" },
        el("div", {},
          el("div", {}, el("strong", {}, a.asset)),
          el("div", { style: "margin-top:4px" }, mixStrip(a.sevCounts)),
          el("div", { class: "small muted", style: "margin-top:2px" }, mixText(a.sevCounts)),
        ),
        el("div", { class: "num", title: "Open findings on this asset" },
          `${a.total.toLocaleString()} open`),
      ));
    }
    insightsHost.append(el("div", { class: "chart-grid" },
      el("div", { class: "chart-card" },
        el("h3", {}, "Top assets by weighted risk"),
        el("div", { class: "small muted", style: "margin-bottom:8px" },
          "Open findings weighted by severity (CRITICAL 4 … LOW 1)."),
        el("div", { class: "chart-box" }, canvas),
      ),
      el("div", { class: "card" },
        el("h3", {}, "Severity mix per asset"),
        list,
      ),
    ));
    requestAnimationFrame(() => {
      hBar(canvas, insights.topAssets.map((a) => ({ label: a.asset, value: a.weighted })));
    });
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

    if (insights.topCves.length) {
      const table = el("table", { class: "data" },
        el("thead", {}, el("tr", {},
          ...["CVE", "Severity", "Assets", "Findings", "Risk"]
            .map((h) => el("th", { scope: "col" }, h)))),
      );
      const tbody = el("tbody", {});
      for (const c of insights.topCves) {
        const risky = [];
        if (c.kev) risky.push("KEV");
        if (c.exploit) risky.push("Exploit");
        tbody.append(el("tr", {},
          el("td", {}, el("a", {
            href: nvdUrl(c.cve), target: "_blank", rel: "noopener",
          }, c.cve)),
          el("td", {}, sevBadge(c.severity)),
          el("td", { class: "num" }, c.assets.toLocaleString()),
          el("td", { class: "num" }, c.findings.toLocaleString()),
          el("td", {}, risky.join(" · ") || ""),
        ));
      }
      table.append(tbody);
      insightsHost.append(el("div", { class: "card", style: "margin-top:14px" },
        el("h3", {}, "Most widespread open CVEs"),
        el("p", { class: "small muted", style: "margin:2px 0 10px" },
          "Ranked by the number of distinct assets affected."),
        el("div", { class: "table-wrap" }, table),
      ));
    }
  }

  // --------------------------------------------------------------------- breakdown

  function renderBreakdown(insights) {
    insightsHost.append(sectionLabel("Breakdown"));
    const sel = el("select", { "aria-label": "Break down by" },
      ...BREAKDOWN_OPTIONS
        .filter(([v]) => validBy.includes(v))
        .map(([v, label]) => el("option", { value: v, selected: v === state.by || null }, label)),
    );
    const listHost = el("div", {});
    sel.addEventListener("change", () => {
      state.by = sel.value;
      setParams({ by: state.by === DEFAULT_BY ? "" : state.by });
      renderList();
    });
    insightsHost.append(
      el("div", { class: "filter-bar" },
        el("div", { class: "field" },
          el("label", { class: "field-label" }, "Break down by"), sel)),
      listHost,
    );
    renderList();

    function renderList() {
      clear(listHost);
      const groups = insights.breakdowns[state.by] || [];
      if (!groups.length) {
        listHost.append(emptyState("Nothing to break down for this grouping."));
        return;
      }
      const list = el("div", { class: "rank-list" });
      for (const g of groups) {
        list.append(el("div", { class: "rank-row" },
          el("div", {},
            el("div", {}, el("strong", {}, g.key),
              el("span", { class: "small muted", style: "margin-left:8px" },
                `${Math.round(g.share * 100)}% of findings`)),
            el("div", { style: "margin-top:4px" }, mixStrip(g.sevCounts)),
            el("div", { class: "small muted", style: "margin-top:2px" }, mixText(g.sevCounts)),
          ),
          el("div", { class: "num" },
            el("div", {}, `${g.total.toLocaleString()} total`),
            el("div", { class: "small muted" }, `${g.open.toLocaleString()} open`),
          ),
        ));
      }
      list.append(el("p", { class: "small muted" },
        "Busiest groups first" + (groups.length >= 15 ? " (showing the 15 largest)" : "") + "."));
      listHost.append(list);
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
