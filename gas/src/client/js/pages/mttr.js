// MTTR & SLA — remediation performance from the durable ledger. Hero stat, trend
// charts, per-severity SLA table, posture bars. Never fetches from Wiz.

import { openResolvedLines, trendLine } from "../charts.js";
import { bootstrap, swrCall } from "../store.js";
import {
  changeChip, clear, el, emptyState, fmtDays, scopeBar, sectionLabel, sevBadge,
  severityScopeFilter,
} from "../ui.js";

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
      "How fast risk gets closed, measured over observed lifecycles in the durable base."),
  );

  const scopeChips = scopeBar({
    domain: ctx.domain, supportGroup: ctx.supportGroup, onClear: ctx.clearScope,
  });
  if (scopeChips) main.append(scopeChips);

  const heroHost = el("div", {});
  const chartsHost = el("div", { class: "chart-grid" });
  const slaHost = el("div", {});
  const byDomainHost = el("div", {});
  main.append(heroHost, chartsHost, slaHost, byDomainHost);

  // Scope comes from the global Value Chain + Support group filters in the sidebar;
  // "" = no filter on that dimension.
  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";

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
    clear(slaHost);
    clear(byDomainHost);
    // One batched RPC — summary and trends share a single ledger-state load
    // server-side. Revisits paint instantly from the session cache and repaint in
    // the background only if the revalidated data differs.
    const paint = (data) => {
      renderHero(data.mttr, data.trends);
      renderCharts(data.trends, data.mttr);
      renderSla(data.mttr);
      renderByDomain(data.byDomain);
    };
    paint(await swrCall("api_getMttrPage",
      { domain, supportGroup, severities: scopeParam() }, paint));
  }

  /** Per-domain remediation, shown only at the whole-chain view (the server omits it
   *  when a single value chain is selected). A value chain is composed of domains, so
   *  this is how each component is doing. */
  function renderByDomain(byDomain) {
    clear(byDomainHost);
    if (!byDomain || !byDomain.rows.length || boot.domainNames.length < 2) return;
    byDomainHost.append(sectionLabel("By domain"));
    byDomainHost.append(el("p", { class: "small muted", style: "margin:-6px 0 12px" },
      "Remediation for each domain that makes up the value chain."));
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        ...["Domain", "Median MTTR", "In SLA", "Open", "Resolved", "Tracked"]
          .map((h) => el("th", { scope: "col" }, h)))),
    );
    const tbody = el("tbody", {});
    for (const r of byDomain.rows) {
      tbody.append(el("tr", {},
        el("td", {}, r.domain),
        el("td", { class: "num" }, fmtDays(r.median)),
        el("td", { class: "num" }, r.slaPct !== null && r.slaPct !== undefined
          ? `${r.slaPct.toFixed(0)}%` : "—"),
        el("td", { class: "num" }, (r.open ?? 0).toLocaleString()),
        el("td", { class: "num" }, (r.resolved ?? 0).toLocaleString()),
        el("td", { class: "num" }, (r.tracked ?? 0).toLocaleString()),
      ));
    }
    table.append(tbody);
    byDomainHost.append(el("div", { class: "table-wrap" }, table));
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
          ? changeChip(mttr.slaPct, prev.sla_pct, { invert: true, suffix: "%" }) : null],
      // p90 of open-finding age, not the single oldest — labelled to match the table below.
      ["Open age p90", fmtDays(mttr.oldestDays),
        prev && prev.oldest_open_days !== null && mttr.oldestDays !== null
          ? changeChip(mttr.oldestDays, prev.oldest_open_days, { fmt: fmtDays }) : null],
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
          prev && median !== null ? changeChip(median, prev.median_days, { fmt: fmtDays }) : null,
        ),
        el("div", { class: "hero-src" },
          `${mttr.rowCount.toLocaleString()} tracked lifecycle(s) in the durable base`),
        minis,
      ),
    );
  }

  function renderCharts(trends, mttr) {
    clear(chartsHost);
    // With no lifecycle data the hero already shows the single, unified empty state — don't
    // stack a second "Trends appear…" panel beneath it.
    if (!mttr.rowCount) return;
    const mttrCanvas = el("canvas", { id: "mttr-trend" });
    const openResolvedCanvas = el("canvas", { id: "open-resolved" });

    const points = trends.trend.length
      ? trends.trend.map((t) => ({ x: t.date, y: t.median_days }))
      : trends.history.map((h) => ({ x: h.date, y: h.median_days }));

    // A "trend" needs at least two points — one lone dot is not a trajectory. This matches the
    // Open-vs-resolved gate and the "after two saved scans" copy below.
    const hasTrend = points.length > 1;
    if (hasTrend) {
      chartsHost.append(el("div", { class: "chart-card" },
        el("h3", {}, "MTTR trend"),
        el("div", { class: "chart-box" }, mttrCanvas)));
    }
    if (trends.trend.length > 1) {
      chartsHost.append(el("div", { class: "chart-card" },
        el("h3", {}, "Open vs resolved"),
        el("div", { class: "chart-box" }, openResolvedCanvas)));
    }
    if (!chartsHost.hasChildNodes()) {
      chartsHost.append(emptyState("Trends appear after two saved scans."));
      return;
    }
    if (domain) {
      chartsHost.append(el("p", { class: "small muted", style: "grid-column:1/-1; margin:0" },
        "Trends span every value chain — per-chain history isn't stored."));
    }

    requestAnimationFrame(() => {
      if (hasTrend) {
        trendLine(mttrCanvas, points.filter((p) => p.y !== null), { yLabel: "days" });
      }
      if (trends.trend.length > 1) {
        openResolvedLines(openResolvedCanvas, trends.trend);
      }
    });
  }

  function renderSla(mttr) {
    clear(slaHost);
    // The per-severity breakdown (table + posture bars) follows the severity dropdown,
    // so it always matches the severities feeding the hero and trend above.
    const sevs = boot.palette.order.filter((s) => mttr.perSev[s] && sevScope.includes(s));
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
