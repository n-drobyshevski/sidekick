// OS vulnerabilities — the default page. KPI band, click-to-filter severity bar,
// severity cards with scan-over-scan deltas, URL-mirrored filter bar, paginated or
// grouped findings table, drill-down sheet, CSV export.

import { call } from "../api.js";
import { severityBar } from "../charts.js";
import { bootstrap, listJoin, listSplit, setParams } from "../store.js";
import {
  changeChip, clear, confirmDialog, downloadText, el, emptyState, fmtDate, kpiCard,
  nvdUrl, openSheet, pager, sectionLabel, sevBadge, toast,
} from "../ui.js";

export async function renderOverview(main, params) {
  const boot = await bootstrap();
  main.append(
    el("h1", {}, "OS vulnerabilities"),
    el("p", { class: "page-sub" },
      "CVEs with a fix available on host workloads, from the Wiz Security Graph. ",
      el("a", { href: "#/mttr" }, "Remediation performance →"),
    ),
  );

  if (!boot.latestScan) {
    main.append(emptyState(
      "No scan saved yet.",
      "Use “Run scan” in the sidebar to take the first measurement.",
    ));
    return;
  }

  // Filter state mirrors to hash params (shareable views).
  const state = {
    sev: listSplit(params.sev),
    status: listSplit(params.status),
    atype: listSplit(params.atype),
    cloud: listSplit(params.cloud),
    dom: listSplit(params.dom),
    q: params.q || "",
    group: params.group || "",
    page: Number(params.page || 0),
  };

  const kpiRow = el("div", { class: "kpi-row" });
  const sevChartCanvas = el("canvas", { id: "sev-chart" });
  const chartCard = el("div", { class: "chart-card" },
    el("h3", {}, "Severity breakdown"),
    el("div", { class: "small muted", style: "margin-bottom:8px" },
      "Click a bar to filter the table; click again to clear."),
    el("div", { class: "chart-box" }, sevChartCanvas),
  );
  const sevCards = el("div", { class: "kpi-row", style: "margin-top:14px" });
  const filterBar = el("div", { class: "filter-bar", role: "search" });
  const tableHost = el("div", {});
  main.append(kpiRow, chartCard, sevCards, sectionLabel("Findings"), filterBar, tableHost);

  buildFilterBar();
  await load();

  function mirror() {
    setParams({
      sev: listJoin(state.sev),
      status: listJoin(state.status),
      atype: listJoin(state.atype),
      cloud: listJoin(state.cloud),
      dom: listJoin(state.dom),
      q: state.q,
      group: state.group,
      page: state.page || "",
    });
  }

  function buildFilterBar() {
    clear(filterBar);
    // Severity pills (display scope only).
    const pillRow = el("div", { class: "pill-row", role: "group", "aria-label": "Severity filter" });
    for (const sev of boot.settings.displaySeverities) {
      const active = state.sev.includes(sev);
      pillRow.append(
        el("button", {
          class: `sev-pill sev-${sev}`,
          "aria-pressed": active ? "true" : "false",
          onclick: () => {
            toggle(state.sev, sev);
            state.page = 0;
            mirror();
            buildFilterBar();
            load();
          },
        }, sev),
      );
    }
    filterBar.append(el("div", { class: "field" }, el("label", { class: "field-label" }, "Severity"), pillRow));

    const opts = boot.filterOptions;
    filterBar.append(
      multiSelect("Status", opts.statuses, state.status, reload),
      multiSelect("Asset type", opts.assetTypes, state.atype, reload),
      multiSelect("Cloud", opts.clouds, state.cloud, reload),
    );
    if (boot.domainNames.length > 1) {
      filterBar.append(multiSelect("Domain", boot.domainNames, state.dom, reload));
    }

    const search = el("input", {
      type: "search", placeholder: "CVE or asset…", value: state.q,
      "aria-label": "Search CVE or asset name",
    });
    let debounce;
    search.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.q = search.value;
        state.page = 0;
        mirror();
        load();
      }, 300);
    });
    filterBar.append(el("div", { class: "field" }, el("label", { class: "field-label" }, "Search"), search));

    const groupSel = el("select", { "aria-label": "Group by" },
      ...[["", "None"], ["severity", "Severity"], ["status", "Status"], ["atype", "Asset type"],
        ["cloud", "Cloud"], ["asset", "Asset"], ["subscription", "Subscription"], ["domain", "Domain"]]
        .map(([v, label]) => el("option", { value: v, selected: state.group === v || null }, label)),
    );
    groupSel.addEventListener("change", () => {
      state.group = groupSel.value;
      state.page = 0;
      mirror();
      load();
    });
    filterBar.append(el("div", { class: "field" }, el("label", { class: "field-label" }, "Group by"), groupSel));

    if (hasFilters()) {
      filterBar.append(el("button", {
        onclick: () => {
          state.sev = []; state.status = []; state.atype = []; state.cloud = [];
          state.dom = []; state.q = ""; state.page = 0;
          mirror(); buildFilterBar(); load();
        },
      }, "Clear filters"));
    }

    filterBar.append(el("button", { onclick: exportCsv }, "Download CSV"));
  }

  function reload() {
    state.page = 0;
    mirror();
    buildFilterBar();
    load();
  }

  function hasFilters() {
    return state.sev.length || state.status.length || state.atype.length ||
      state.cloud.length || state.dom.length || state.q;
  }

  function multiSelect(label, options, selected, onChange) {
    const sel = el("select", { multiple: false, "aria-label": label },
      el("option", { value: "" }, `All`),
      ...options.map((o) =>
        el("option", { value: o, selected: selected.includes(o) || null }, o)),
    );
    // Single-select UI backing a list state keeps the bar compact; the URL still
    // supports comma lists set by chart clicks or hand-edited links.
    sel.addEventListener("change", () => {
      selected.length = 0;
      if (sel.value) selected.push(sel.value);
      onChange();
    });
    return el("div", { class: "field" }, el("label", { class: "field-label" }, label), sel);
  }

  function toggle(list, value) {
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1);
    else list.push(value);
  }

  async function load() {
    clear(tableHost).append(el("p", { class: "muted" }, "Loading findings…"));
    const res = await call("api_getFindings", {
      severities: state.sev.length ? state.sev : undefined,
      statuses: state.status,
      assetTypes: state.atype,
      clouds: state.cloud,
      domains: state.dom,
      q: state.q,
      groupBy: state.group,
      page: state.page,
      pageSize: 100,
    });

    // KPI band (unfiltered headline; filtered count shows on the table).
    clear(kpiRow);
    const total = Object.values(boot.counts).reduce((a, b) => a + b, 0);
    const openCount = res.groups === null && !hasFilters()
      ? null // computed below from statuses when cheap; keep the band honest
      : null;
    void openCount;
    kpiRow.append(
      kpiCard("Total findings", total.toLocaleString(),
        `scan ${boot.latestScan.ts.slice(0, 10)} — ${boot.latestScan.mode}`),
      kpiCard("Showing", res.total.toLocaleString(), hasFilters() ? "filtered" : "all displayed severities"),
      ...boot.palette.order
        .filter((s) => boot.counts[s])
        .slice(0, 2)
        .map((s) => kpiCard(s, boot.counts[s].toLocaleString(),
          null, changeChip(boot.counts[s], boot.prevCounts[s]))),
    );

    // Severity chart + cards reflect the filtered set.
    requestAnimationFrame(() => {
      severityBar(sevChartCanvas, res.counts, boot.palette, (sev) => {
        toggle(state.sev, sev);
        state.page = 0;
        mirror();
        buildFilterBar();
        load();
      });
    });

    clear(sevCards);
    for (const sev of boot.palette.order) {
      if (!res.counts[sev] && !boot.counts[sev]) continue;
      sevCards.append(
        el("div", { class: "kpi-card" },
          sevBadge(sev),
          el("div", { class: "kpi-value num" },
            (res.counts[sev] ?? 0).toLocaleString(),
            changeChip(boot.counts[sev] ?? 0, boot.prevCounts[sev]),
          ),
        ),
      );
    }

    clear(tableHost);
    if (res.groups) {
      renderGroups(res);
    } else if (!res.rows.length) {
      tableHost.append(emptyState("No findings match the current filters."));
    } else {
      tableHost.append(findingsTable(res.rows));
      tableHost.append(pager(res.page, res.pageCount, res.total, (p) => {
        state.page = p;
        mirror();
        load();
      }));
    }
  }

  function renderGroups(res) {
    tableHost.append(el("p", { class: "muted small" },
      `${res.total.toLocaleString()} findings in ${res.groups.length} group(s)` +
      (res.groups.length >= 30 ? " (showing the 30 largest)" : "")));
    for (const g of res.groups) {
      const det = el("details", { class: "card", style: "margin-bottom:10px; padding:10px 16px" });
      const sevBits = boot.palette.order
        .filter((s) => g.sevCounts[s])
        .map((s) => `${s} ${g.sevCounts[s]}`)
        .join(" · ");
      det.append(
        el("summary", { style: "cursor:pointer" },
          el("strong", {}, g.key), `  —  ${g.count} finding(s)`,
          el("span", { class: "small muted", style: "margin-left:8px" }, sevBits)),
      );
      const body = el("div", { style: "margin-top:10px" });
      det.addEventListener("toggle", () => {
        if (det.open && !body.hasChildNodes()) {
          body.append(findingsTable(g.rows));
          if (g.count > g.rows.length) {
            body.append(el("p", { class: "small muted" },
              `Showing the first ${g.rows.length} of ${g.count}.`));
          }
        }
      });
      det.append(body);
      tableHost.append(det);
    }
  }

  function findingsTable(rows) {
    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        ...["Severity", "CVE", "Component", "Status", "Asset", "Type", "Cloud",
          "First seen", "Resolved", "Fix", "Risk"].map((h) => el("th", { scope: "col" }, h)),
      )),
    );
    const tbody = el("tbody", {});
    for (const r of rows) {
      const risky = [];
      if (r.hasExploit) risky.push("Exploit");
      if (r.hasCisaKevExploit) risky.push("KEV");
      const tr = el("tr", { class: "clickable", tabindex: "0", role: "button",
        "aria-label": `Open detail for ${r.name}` },
        el("td", {}, sevBadge(r._sev)),
        el("td", {}, el("a", {
          href: nvdUrl(r.name),
          target: "_blank", rel: "noopener",
          onclick: (e) => e.stopPropagation(),
        }, r.name || "—")),
        el("td", {}, r.detailedName || "—"),
        el("td", {}, r.status || "—"),
        el("td", { title: r["vulnerableAsset.name"] || "" }, r["vulnerableAsset.name"] || "—"),
        el("td", {}, r["vulnerableAsset.type"] || "—"),
        el("td", {}, r["vulnerableAsset.cloudPlatform"] || "—"),
        el("td", { class: "num" }, fmtDate(r.firstDetectedAt)),
        el("td", { class: "num" }, fmtDate(r.resolvedAt)),
        el("td", {}, r.fixedVersion || "—"),
        el("td", {}, risky.join(" · ") || ""),
      );
      const open = () => openDetail(r);
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
      tbody.append(tr);
    }
    table.append(tbody);
    return el("div", { class: "table-wrap" }, table);
  }

  async function openDetail(row) {
    openSheet(async (sheet, close) => {
      sheet.append(
        el("div", { class: "sheet-header", style: `border-left-color: ${boot.palette.colors[row._sev] || "#e6e6e9"}` },
          el("div", {},
            el("div", {}, sevBadge(row._sev), " ", el("strong", {}, row.name || "Finding")),
            el("div", { class: "small muted", style: "margin-top:4px" },
              row["vulnerableAsset.name"] || ""),
          ),
          el("button", { onclick: close, "aria-label": "Close detail" }, "✕"),
        ),
      );
      const body = el("div", { class: "sheet-body" }, el("p", { class: "muted" }, "Loading detail…"));
      sheet.append(body);
      let detail;
      try {
        detail = await call("api_getFindingDetail", { vulnKey: row._vuln_key });
      } catch (e) {
        clear(body).append(el("p", { class: "muted" }, `Couldn't load detail: ${e.message}`));
        return;
      }
      clear(body);
      const rec = detail.record || row;
      body.append(
        kvSection("Finding", {
          CVE: rec.name, Component: rec.detailedName, Severity: rec._sev ?? rec.severity,
          Status: rec.status, "Fixed version": rec.fixedVersion,
          "Detection method": rec.detectionMethod, Source: rec.dataSourceName,
        }),
        kvSection("Risk", {
          "CVSS score": rec.score, "Vendor severity": rec.vendorSeverity,
          "NVD severity": rec.nvdSeverity, "EPSS severity": rec.epssSeverity,
          "EPSS probability": rec.epssProbability,
          "Exploit available": rec.hasExploit ? "Yes" : "No",
          "CISA KEV": rec.hasCisaKevExploit ? "Yes" : "No",
        }),
        kvSection("Asset", {
          Name: rec["vulnerableAsset.name"], Type: rec["vulnerableAsset.type"],
          Cloud: rec["vulnerableAsset.cloudPlatform"],
          Subscription: rec["vulnerableAsset.subscriptionName"],
          OS: rec["vulnerableAsset.operatingSystem"], Region: rec["vulnerableAsset.region"],
        }),
        kvSection("Lifecycle", {
          "First detected": rec.firstDetectedAt, "Last detected": rec.lastDetectedAt,
          Resolved: rec.resolvedAt, Published: rec.publishedDate,
        }),
        el("div", { class: "sheet-section" },
          el("a", {
            class: "btn", target: "_blank", rel: "noopener",
            href: nvdUrl(rec.name),
            style: "text-decoration:none; display:inline-block; padding:6px 14px",
          }, "Open in NVD ↗"),
        ),
      );
      if (detail.raw) {
        const details = el("details", { class: "sheet-section" },
          el("summary", { class: "label", style: "cursor:pointer" }, "Raw JSON"),
        );
        details.append(el("pre", { class: "raw-json" }, JSON.stringify(detail.raw, null, 2)));
        body.append(details);
      }
    });
  }

  function kvSection(title, pairs) {
    const dl = el("dl", { class: "kv" });
    let any = false;
    for (const [k, v] of Object.entries(pairs)) {
      if (v === null || v === undefined || v === "") continue;
      any = true;
      dl.append(el("dt", {}, k), el("dd", {}, String(v)));
    }
    if (!any) return el("span", {});
    return el("div", { class: "sheet-section" }, el("span", { class: "label" }, title), dl);
  }

  async function exportCsv() {
    if (state.group) {
      toast("CSV export uses the flat view — clearing grouping.", "warn");
    }
    const big = boot.latestScan.total > 2000;
    if (big) {
      const go = await confirmDialog({
        title: "Prepare CSV?",
        body: `This will build a CSV of ${boot.latestScan.total.toLocaleString()} rows on the server.`,
        confirmLabel: "Prepare & download",
      });
      if (!go) return;
    }
    try {
      const res = await call("api_getExportCsv", {
        source: "findings",
        severities: state.sev.length ? state.sev : undefined,
        statuses: state.status, assetTypes: state.atype, clouds: state.cloud,
        domains: state.dom, q: state.q,
      });
      downloadText(res.filename, res.content, "text/csv;charset=utf-8");
    } catch (e) {
      toast(`Export failed: ${e.message}`, "error");
    }
  }
}
