// MTTR & SLA — remediation performance from the durable ledger. Hero stat, trend
// charts, per-severity SLA table, posture bars. Never fetches from Wiz.

import { call } from "../api.js";
import { openResolvedLines, trendLine } from "../charts.js";
import { bootstrap } from "../store.js";
import { changeChip, clear, el, emptyState, fmtDays, sectionLabel, sevBadge } from "../ui.js";

export async function renderMttr(main, params) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "MTTR & SLA"),
    el("p", { class: "page-sub" },
      "How fast risk gets closed, measured over observed lifecycles in the durable base."),
  );

  const controls = el("div", { class: "filter-bar" });
  const heroHost = el("div", {});
  const chartsHost = el("div", { class: "chart-grid" });
  const slaHost = el("div", {});
  main.append(controls, heroHost, chartsHost, slaHost);

  let domain = params.dom || "";
  if (boot.domainNames.length > 1) {
    const sel = el("select", { "aria-label": "Domain" },
      el("option", { value: "" }, "All domains"),
      ...boot.domainNames.map((d) => el("option", { value: d, selected: d === domain || null }, d)),
    );
    sel.addEventListener("change", () => {
      domain = sel.value;
      load();
    });
    controls.append(el("div", { class: "field" },
      el("label", { class: "field-label" }, "Domain"), sel));
  } else {
    controls.remove();
  }

  await load();

  async function load() {
    clear(heroHost).append(el("p", { class: "muted" }, "Computing…"));
    const [mttr, trends] = await Promise.all([
      call("api_getMttr", { domain }),
      call("api_getMttrTrend", {}),
    ]);
    renderHero(mttr, trends);
    renderCharts(trends);
    renderSla(mttr);
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

    const minis = el("div", { class: "hero-minis" });
    const miniDefs = [
      ["In SLA", mttr.slaPct !== null ? `${mttr.slaPct.toFixed(1)}%` : "—",
        prev && prev.sla_pct !== null && mttr.slaPct !== null
          ? changeChip(mttr.slaPct, prev.sla_pct, { invert: true }) : null],
      ["Oldest open (p90)", fmtDays(mttr.oldestDays),
        prev && prev.oldest_open_days !== null && mttr.oldestDays !== null
          ? changeChip(mttr.oldestDays, prev.oldest_open_days) : null],
      ["Resolved", (mttr.overall.resolved ?? 0).toLocaleString(), null],
      ["Open", (mttr.overall.open ?? 0).toLocaleString(), null],
    ];
    for (const [label, value, chip] of miniDefs) {
      minis.append(el("div", {},
        el("div", { class: "mini-label" }, label),
        el("div", { class: "mini-value num" }, value, chip || null),
      ));
    }
    heroHost.append(
      el("div", { class: "hero" },
        el("div", { class: "label" }, "Median MTTR" + (domain ? ` — ${domain}` : "")),
        el("div", { class: "hero-value num" },
          median !== null && median !== undefined ? fmtDays(median) : "—",
          prev && median !== null ? changeChip(median, prev.median_days) : null,
        ),
        el("div", { class: "hero-src" },
          `${mttr.rowCount.toLocaleString()} tracked lifecycle(s) in the durable base`),
        minis,
      ),
    );
  }

  function renderCharts(trends) {
    clear(chartsHost);
    const mttrCanvas = el("canvas", { id: "mttr-trend" });
    const openResolvedCanvas = el("canvas", { id: "open-resolved" });

    const points = trends.trend.length
      ? trends.trend.map((t) => ({ x: t.date, y: t.median_days }))
      : trends.history.map((h) => ({ x: h.date, y: h.median_days }));

    if (points.length) {
      chartsHost.append(el("div", { class: "chart-card" },
        el("h3", {}, "MTTR trend"),
        el("div", { class: "chart-box" }, mttrCanvas)));
    }
    if (trends.trend.length) {
      chartsHost.append(el("div", { class: "chart-card" },
        el("h3", {}, "Open vs resolved"),
        el("div", { class: "chart-box" }, openResolvedCanvas)));
    }
    if (!chartsHost.hasChildNodes()) {
      chartsHost.append(emptyState("Trends appear after two saved scans."));
      return;
    }

    requestAnimationFrame(() => {
      if (points.length) {
        trendLine(mttrCanvas, points.filter((p) => p.y !== null), { yLabel: "days" });
      }
      if (trends.trend.length) {
        openResolvedLines(openResolvedCanvas, trends.trend);
      }
    });
  }

  function renderSla(mttr) {
    clear(slaHost);
    const sevs = boot.palette.order.filter((s) => mttr.perSev[s]);
    if (!sevs.length) return;

    slaHost.append(sectionLabel("Remediation by severity"));
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        ...["Severity", "Median MTTR", "Mean", "Resolved", "Open", "Open age p50",
          "Open age p90", "SLA target", "In SLA"].map((h) => el("th", { scope: "col" }, h)))),
    );
    const tbody = el("tbody", {});
    for (const sev of sevs) {
      const d = mttr.perSev[sev];
      tbody.append(el("tr", {},
        el("td", {}, sevBadge(sev)),
        el("td", { class: "num" }, fmtDays(d.mttr_median)),
        el("td", { class: "num" }, fmtDays(d.mttr_mean)),
        el("td", { class: "num" }, d.resolved),
        el("td", { class: "num" }, d.open),
        el("td", { class: "num" }, fmtDays(d.open_age_p50)),
        el("td", { class: "num" }, fmtDays(d.open_age_p90)),
        el("td", { class: "num" }, d.sla_target ? `${d.sla_target}d` : "—"),
        el("td", { class: "num" }, d.sla_pct !== null ? `${d.sla_pct.toFixed(0)}%` : "—"),
      ));
    }
    table.append(tbody);
    slaHost.append(el("div", { class: "table-wrap" }, table));

    // SLA posture bars: >=90% ok, >=70% warn, else bad (the fixed 90/70 policy).
    slaHost.append(sectionLabel("SLA posture"));
    const posture = el("div", { class: "card" });
    for (const sev of sevs) {
      const d = mttr.perSev[sev];
      if (d.sla_pct === null) continue;
      const state = d.sla_pct >= 90 ? "ok" : d.sla_pct >= 70 ? "warn" : "bad";
      const stateWord = state === "ok" ? "on target" : state === "warn" ? "at risk" : "breached";
      posture.append(
        el("div", { class: "sla-bullet" },
          el("div", { class: "sla-line" },
            el("span", {}, sevBadge(sev), ` target ${d.sla_target}d`),
            el("span", { class: "num" }, `${d.sla_pct.toFixed(1)}% — ${stateWord}`),
          ),
          el("div", { class: "sla-track", role: "img",
            "aria-label": `${sev}: ${d.sla_pct.toFixed(1)} percent within SLA (${stateWord})` },
            el("div", { class: `sla-fill ${state}`, style: `width:${Math.min(d.sla_pct, 100)}%` }),
          ),
        ),
      );
    }
    slaHost.append(posture);
  }
}
