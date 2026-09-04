// Program performance — remediation coverage, efficiency, and capacity, the metric family
// from the Cisco Kenna / Cyentia "Prioritization to Prediction" research.
//
// MTTR & SLA answers "how fast are we closing risk". This page answers "are we closing the
// RIGHT risk", and it is built to be *checked*, not just read: every figure is traceable from
// the hero down to the individual finding. The confusion matrix carries real counts and each
// cell opens the findings behind it; the classifier that produced those counts is stated in
// words and editable in Settings; the share of the register that could not be classified at
// all is shown beside every rate rather than quietly dropped; and the whole classified set
// exports as CSV so a reader can recompute the page in a spreadsheet.

import { chartUnavailable, loadCharts } from "../chartsLoader.js";
import { call } from "../api.js";
import { bootstrap, swrCall } from "../store.js";
import {
  clear, downloadText, el, emptyState, fmtDate, helpTip, openSheet, pager, scopeBar,
  sectionLabel, sevBadge, skeleton, statusPill, toast,
} from "../ui.js";

// Matrix cells, in reading order. `key` matches the server's `matrix_cell` / cohort quadrant
// so a cell button and its drill-down can't drift apart. `word` is the plain-English label
// that sits beside the TP/FP/FN/TN shorthand — the shorthand alone is jargon, and a leader
// reading this page should not have to decode it.
const CELLS = {
  tp: {
    abbr: "TP",
    word: "Fixed, and it mattered",
    help: "High risk under the active rule, and remediated. The numerator of both coverage and efficiency.",
  },
  fp: {
    abbr: "FP",
    word: "Fixed, but low risk",
    help: "Not high risk under the active rule, but remediated anyway. Effort that may have been more productive elsewhere — this is what pulls efficiency down.",
  },
  fn: {
    abbr: "FN",
    word: "High risk, still open",
    help: "High risk under the active rule and not yet remediated. Unremediated risk — this is what pulls coverage down.",
  },
  tn: {
    abbr: "TN",
    word: "Correctly deprioritized",
    help: "Not high risk, and still open. Work correctly left undone.",
  },
  unknownRemediated: {
    abbr: "",
    word: "Unclassified, remediated",
    help: "Remediated, but no exploit signal was ever captured for it, so it cannot be scored either way. Excluded from both rates and reflected in their published ranges.",
  },
  unknownOpen: {
    abbr: "",
    word: "Unclassified, still open",
    help: "Still open, and no exploit signal was ever captured for it. Excluded from both rates and reflected in their published ranges.",
  },
};

/** Percent to one decimal, or an em dash when the denominator was empty (never a fake 0%). */
function pct(v) {
  return v === null || v === undefined ? "—" : v.toFixed(1) + "%";
}

/** Percent with no decimals, for dense table cells. */
function pct0(v) {
  return v === null || v === undefined ? "—" : Math.round(v) + "%";
}

/** The rate itself. Paired with rangeNode below, never shown without it. */
function rateText(rate) {
  return rate ? pct(rate.point) : "—";
}

/**
 * The uncertainty the unclassified population implies, as a subordinate clause beside the
 * rate: "50.0–66.7%". Rendered only when there is real doubt — with every finding classified
 * the bounds collapse onto the point and the figure stands bare.
 *
 * This is the honest-state device the whole page hangs on: the width of the range IS the size
 * of the unclassified bucket, so missing data cannot hide behind a confident-looking number.
 */
function rangeNode(rate) {
  if (!rate || rate.lo === null || rate.hi === null || rate.point === null) return null;
  if (Math.abs(rate.hi - rate.lo) < 0.05) return null;
  return el("span", { class: "prog-range" }, pct(rate.lo) + "–" + pct(rate.hi));
}

const VERDICT = {
  gaining: { pill: "ok", glyph: "▲", text: "Gaining ground" },
  "keeping-up": { pill: "neutral", glyph: "=", text: "Keeping up" },
  "falling-behind": { pill: "bad", glyph: "▼", text: "Falling behind" },
};

/** Net-capacity verdict as a pill carrying a glyph and a word — never colour alone. */
function verdictPill(v) {
  const spec = VERDICT[v];
  if (!spec) return el("span", { class: "muted" }, "—");
  return statusPill(spec.pill, spec.glyph + " " + spec.text);
}

export async function renderProgram(main, _params, ctx) {
  const boot = await bootstrap();

  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];
  const severities =
    sevScope.length === boot.palette.selectable.length ? null : sevScope;

  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";
  const params = { domain, supportGroup, severities };

  let paint;
  const dataPromise = swrCall("api_getProgramPage", params, (fresh) => paint && paint(fresh));

  main.append(
    el("h1", {}, "Program performance"),
    el("p", { class: "page-sub" },
      "Whether remediation effort lands on the findings that matter. Coverage is how much " +
      "of the high-risk population got fixed; efficiency is how much of the fixing was " +
      "high-risk. They pull against each other, so neither means anything alone."),
  );

  const scopeChips = scopeBar({ domain, supportGroup, onClear: ctx.clearScope });
  if (scopeChips) main.append(scopeChips);

  const heroHost = el("div", {});
  const matrixHost = el("div", {});
  const trendHost = el("div", {});
  const ruleHost = el("div", {});
  const capacityHost = el("div", {});
  const methodHost = el("div", {});
  main.append(heroHost, matrixHost, trendHost, ruleHost, capacityHost, methodHost);

  renderSkeleton();

  // One failing section must not blank the page — same guard pattern as the executive view.
  function guard(label, host, fn) {
    try {
      fn();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[program] " + label + " render failed:", e);
      if (host) clear(host).append(emptyState("Couldn't render " + label + "."));
    }
  }

  paint = (data) => {
    const p = data && data.program;
    const trends = (data && data.trends && data.trends.trend) || [];
    if (!p || !p.rowCount) {
      clear(heroHost).append(emptyState(
        "No lifecycle data yet.",
        "Coverage and efficiency need at least one saved scan.",
      ));
      [matrixHost, trendHost, ruleHost, capacityHost, methodHost].forEach((h) => clear(h));
      return;
    }
    guard("headline", heroHost, () => renderHero(p));
    guard("confusion matrix", matrixHost, () => renderMatrix(p));
    guard("trend", trendHost, () => renderTrend(trends));
    guard("classifier", ruleHost, () => renderRule(p));
    guard("capacity", capacityHost, () => renderCapacity(p));
    guard("methodology", methodHost, () => renderMethodology(p, trends));
  };

  try {
    paint(await dataPromise);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[program] getProgramPage failed:", e);
    clear(heroHost).append(emptyState(
      "Couldn't load program performance.",
      "Try running a scan or reloading the page.",
    ));
    [matrixHost, trendHost, ruleHost, capacityHost, methodHost].forEach((h) => clear(h));
  }

  function renderSkeleton() {
    clear(heroHost).append(
      el("div", { class: "hero", role: "status", "aria-label": "Computing coverage" },
        el("div", { style: "display:flex; align-items:baseline; gap:32px; flex-wrap:wrap" },
          skeleton("title", { width: "150px" }),
          skeleton("stat", { width: "96px" })),
        el("div", { style: "margin-top:10px" }, skeleton("line", { width: "60%" })),
        el("div", { class: "hero-minis" },
          ...[0, 1, 2, 3].map(() => el("div", {},
            el("div", { style: "margin-bottom:8px" }, skeleton("line", { width: "84px" })),
            skeleton("stat", { width: "56px" }))))),
    );
    clear(matrixHost).append(
      el("div", { style: "margin:28px 0 12px" }, skeleton("line", { width: "180px" })),
      el("div", { class: "table-wrap", style: "padding:14px" },
        ...[0, 1, 2].map(() => el("div", { style: "margin:10px 0" }, skeleton("line")))),
    );
  }

  // ------------------------------------------------------------------------ hero

  /**
   * One hero value (DESIGN.md allows exactly one per page): coverage — the risk-facing
   * number. Efficiency sits beside it a step down, the same `metric` + secondary-stat
   * pairing the MTTR page uses for its KM and naive medians, so the pair reads together
   * without a second 2rem figure competing.
   */
  function renderHero(p) {
    clear(heroHost);
    const m = p.matrix;
    const cov = helpTip(
      [
        el("div", { class: "label" }, "Remediation coverage"),
        el("div", { class: "hero-value num" }, rateText(m.coverage), rangeNode(m.coverage)),
      ],
      [
        "Of every finding the active rule calls high risk, the share that has been " +
          "remediated. TP / (TP + FN) — here " + m.tp.toLocaleString() + " of " +
          (m.tp + m.fn).toLocaleString() + ".",
        "The bracketed range is what coverage would be if every unclassified finding turned " +
          "out to be high risk (low end) or not (high end). It closes to a single number " +
          "once every finding carries a captured exploit signal.",
        "Higher is better, but coverage alone is easy to buy by fixing everything — read it " +
          "against efficiency.",
      ],
      { className: "hero-metric" },
    );
    const eff = helpTip(
      [
        el("div", { class: "label" }, "Efficiency"),
        el("div", { class: "kpi-value num" }, rateText(m.efficiency), rangeNode(m.efficiency)),
      ],
      [
        "Of everything remediated, the share that was actually high risk. TP / (TP + FP) — " +
          "here " + m.tp.toLocaleString() + " of " + (m.tp + m.fp).toLocaleString() + ".",
        "The remainder is effort spent on findings the rule did not flag. Some of that is " +
          "unavoidable: one patch often closes several CVEs at once, and only one of them " +
          "may be the dangerous one.",
        m.prevalence !== null
          ? "Picking findings at random would score about " + pct(m.prevalence) +
            " here, because that is the share of classified findings that are high risk. " +
            "Efficiency at or below that means the program is not prioritizing."
          : "There is no classified population yet to compare against.",
      ],
      { className: "hero-metric" },
    );

    const minis = el("div", { class: "hero-minis" });
    const capOverall = p.capacity || {};
    const capHigh = p.capacityHighRisk || {};
    const miniDefs = [
      ["High risk, still open", m.fn.toLocaleString(), null],
      ["High risk, remediated", m.tp.toLocaleString(), null],
      [
        "Monthly close rate",
        capOverall.mmcrMean !== null && capOverall.mmcrMean !== undefined
          ? pct0(capOverall.mmcrMean)
          : "—",
        capOverall.oneInN
          ? el("span", { class: "prog-range" }, "1 in " + capOverall.oneInN.toFixed(1))
          : null,
      ],
      ["Net capacity (high risk)", verdictPill(capHigh.verdict), null],
    ];
    for (const [label, value, extra] of miniDefs) {
      minis.append(el("div", {},
        el("div", { class: "mini-label" }, label),
        el("div", { class: "mini-value num" }, value, extra || null)));
    }

    heroHost.append(
      el("div", { class: "hero" },
        el("div", { style: "display:flex; align-items:baseline; gap:32px; flex-wrap:wrap" },
          cov, eff),
        el("div", { class: "hero-src" },
          m.total.toLocaleString() + " tracked lifecycle(s) · " +
          m.classified.toLocaleString() + " classified (" + pct0(m.signalCoveragePct) + ") · " +
          m.unknown.toLocaleString() + " with no captured exploit signal"),
        minis),
    );

    // Honest state, stated where it cannot be missed rather than buried in the methodology
    // block: a rate computed over a thin slice of the register is not a rate for the
    // register, and the reader has to know that before acting on the number above.
    if (m.signalCoveragePct !== null && m.signalCoveragePct < 80) {
      heroHost.append(el("p", { class: "note note--warn" },
        statusPill("warn", "⚠ " + pct0(100 - m.signalCoveragePct) + " unclassified"),
        " These rates describe only the " + m.classified.toLocaleString() +
        " lifecycle(s) that carry a captured exploit signal. Findings recorded before " +
        "exploit intelligence was stored in the ledger cannot be scored; run the risk " +
        "backfill from Settings to recover what the scan archives still hold."));
    }
  }

  // -------------------------------------------------------------- confusion matrix

  /**
   * The transparency centrepiece: the 2×2 with real counts, every cell a button into the
   * findings behind it. The unclassified counts sit in their own row BELOW the matrix rule,
   * never inside the 2×2, so they cannot be misread as a quadrant.
   *
   * Deliberately uncoloured. These are counts, not severities, and DESIGN.md's Rationed Ink
   * rule reserves saturation for real risk signal — a red-washed FN cell would be exactly the
   * "security-vendor theater" the product explicitly steers away from. The quadrants are
   * distinguished by their words and their position.
   */
  function renderMatrix(p) {
    clear(matrixHost);
    const m = p.matrix;
    matrixHost.append(el("div", { class: "section-head" },
      sectionLabel("What the effort landed on"),
      el("button", {
        class: "linklike",
        onclick: () => exportCsv(""),
      }, "Download classified rows (CSV)")));

    const cell = (key, count) => {
      const spec = CELLS[key];
      const btn = el("button", {
        type: "button",
        class: "prog-cell",
        onclick: () => openCohort(key, count),
        "aria-label": spec.word + ": " + count.toLocaleString() + " findings. Open the list.",
        disabled: count ? null : true,
      },
        el("span", { class: "prog-cell-count num" }, count.toLocaleString()),
        el("span", { class: "prog-cell-word" },
          spec.abbr ? el("span", { class: "prog-cell-abbr" }, spec.abbr) : null,
          spec.word));
      return el("td", {}, helpTip(btn, [spec.help], { className: "help-cell" }));
    };

    const table = el("table", { class: "data prog-matrix" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, ""),
        el("th", { scope: "col" }, "Remediated"),
        el("th", { scope: "col" }, "Still open"),
        el("th", { scope: "col" }, "Total"))),
      el("tbody", {},
        el("tr", {},
          el("th", { scope: "row" }, "High risk"),
          cell("tp", m.tp),
          cell("fn", m.fn),
          el("td", { class: "num" }, m.highRisk.toLocaleString())),
        el("tr", {},
          el("th", { scope: "row" }, "Not high risk"),
          cell("fp", m.fp),
          cell("tn", m.tn),
          el("td", { class: "num" }, m.notHighRisk.toLocaleString())),
        el("tr", { class: "prog-unknown-row" },
          el("th", { scope: "row" },
            helpTip("No captured signal",
              ["Outside the 2×2 on purpose: these findings are not 'low risk', they are " +
                "unscored. Counting them as low risk would inflate efficiency and deflate " +
                "coverage at the same time, so they are excluded from both and reported here."],
              { className: "help-label" })),
          cell("unknownRemediated", m.unknownRemediated),
          cell("unknownOpen", m.unknownOpen),
          el("td", { class: "num" }, m.unknown.toLocaleString()))),
    );
    matrixHost.append(el("div", { class: "table-wrap" }, table));
    matrixHost.append(el("p", { class: "note" },
      "Coverage reads across the top row (" + m.tp.toLocaleString() + " of " +
      m.highRisk.toLocaleString() + "). Efficiency reads down the Remediated column (" +
      m.tp.toLocaleString() + " of " + (m.tp + m.fp).toLocaleString() +
      "). Select any cell for the findings behind it."));
  }

  /** Drill-down: the actual findings in one matrix cell, paged, from the durable ledger. */
  function openCohort(quadrant, total) {
    const spec = CELLS[quadrant];
    let page = 0;
    openSheet((body) => {
      const host = el("div", {});
      body.append(host);
      const load = async () => {
        clear(host).append(el("div", { class: "muted" }, "Loading…"));
        try {
          const res = await call("api_getRiskCohort", {
            ...params, quadrant, page, pageSize: 50,
          });
          clear(host);
          if (!res.rows.length) {
            host.append(emptyState("No findings in this cell."));
            return;
          }
          const table = el("table", { class: "data" },
            el("thead", {}, el("tr", {},
              el("th", { scope: "col" }, "Finding"),
              el("th", { scope: "col" }, "Severity"),
              el("th", { scope: "col" }, "Signals"),
              el("th", { scope: "col" }, "First seen"),
              el("th", { scope: "col" }, "Resolved"))));
          const tbody = el("tbody", {});
          for (const r of res.rows) {
            tbody.append(el("tr", {},
              el("td", {},
                el("div", {}, r.cve || r.vuln_key),
                el("div", { class: "muted small" }, r.asset_name || "")),
              el("td", {}, sevBadge(r.severity)),
              el("td", { class: "small" }, signalText(r)),
              el("td", { class: "small" }, fmtDate(r.first_seen)),
              el("td", { class: "small" }, r.resolved_at ? fmtDate(r.resolved_at) : "—")));
          }
          table.append(tbody);
          host.append(el("div", { class: "table-wrap" }, table));
          if (res.pageCount > 1) {
            host.append(pager(res.page, res.pageCount, res.total, (n) => {
              page = n;
              load();
            }));
          }
        } catch (e) {
          clear(host).append(emptyState("Couldn't load these findings.", e.message));
        }
      };
      body.append(el("div", { style: "margin-bottom:12px" },
        el("button", { class: "linklike", onclick: () => exportCsv(quadrant) },
          "Download this cell as CSV")));
      load();
    }, {
      title: spec.word,
      subtitle: total.toLocaleString() + " finding(s) · " + spec.help,
      width: "min(720px, 96vw)",
      storageKey: "programCohortWidth",
    });
  }

  /** Why a row landed where it did — the per-finding justification, in words. */
  function signalText(r) {
    if (r.risk_class === "unknown") return "not captured";
    if (r.risk_class === "low") return "none fired";
    const names = { kev: "CISA KEV", exploit: "exploit", epss: "EPSS" };
    return String(r.fired_signals || "")
      .split(" ")
      .filter(Boolean)
      .map((s) => names[s] || s)
      .join(", ");
  }

  async function exportCsv(quadrant) {
    try {
      const res = await call("api_getExportCoverageCsv", { ...params, quadrant });
      downloadText(res.filename, res.content, "text/csv;charset=utf-8");
      toast(res.rows.toLocaleString() + " row(s) exported.");
    } catch (e) {
      toast("Export failed: " + e.message, "error");
    }
  }

  // ----------------------------------------------------------------------- trend

  function renderTrend(points) {
    clear(trendHost);
    if (!points.length) return;
    trendHost.append(sectionLabel("Over time"));
    const box = el("div", { class: "chart-box" }, el("canvas", {}));
    const card = el("div", { class: "chart-card" },
      el("h3", {}, helpTip("Coverage & efficiency over time",
        ["Both rates recomputed at each date over the findings that existed then: a finding " +
          "counts as remediated from its resolution date onward, and as open before it.",
          "Risk classification is NOT re-evaluated per date — each finding carries the signals " +
          "ever observed for it. A CVE that only reached the KEV catalog later therefore counts " +
          "as high risk in earlier points too. That makes the early series read pessimistically, " +
          "and it is what stops last week's plotted value from changing every time a scan lands.",
          "Shaded region: dates before the first saved scan, reconstructed from first-detection " +
          "dates. Closures there are under-counted, because a finding that simply stopped " +
          "appearing is dated to the scan that noticed."],
        { className: "help-label" })),
      box);
    trendHost.append(card);
    const canvas = box.querySelector("canvas");
    loadCharts().then((charts) => {
      charts.coverageEfficiencyLines(canvas, points);
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.error("[program] trend chart failed:", e);
      chartUnavailable(canvas);
    });
  }

  // ------------------------------------------------------------------- classifier

  function renderRule(p) {
    clear(ruleHost);
    const s = p.signals || {};
    ruleHost.append(el("div", { class: "section-head" },
      sectionLabel("How high risk is decided"),
      el("a", { href: "#/settings", target: "_self", class: "linklike" }, "Edit the rule →")));

    const clauses = el("ul", { class: "prog-clauses" });
    const clauseRow = (on, label, fired, missing) => {
      if (!on) return null;
      return el("li", {},
        el("span", { class: "prog-clause-name" }, label),
        el("span", { class: "num" }, fired.toLocaleString()),
        missing
          ? el("span", { class: "muted small" },
            " · " + missing.toLocaleString() + " never captured")
          : null);
    };
    const rule = p.rule || {};
    [
      clauseRow(rule.kev, "Listed in the CISA KEV catalog", s.kev || 0, s.kevMissing || 0),
      clauseRow(rule.exploit, "A public exploit exists", s.exploit || 0, s.exploitMissing || 0),
      clauseRow(rule.epss,
        "EPSS at or above " + (rule.epssThreshold ?? 0).toFixed(2),
        s.epss || 0, s.epssMissing || 0),
    ].filter(Boolean).forEach((n) => clauses.append(n));

    ruleHost.append(el("div", { class: "prog-rule-card" },
      el("p", { class: "prog-rule-sentence" },
        "A finding is high risk when ", el("strong", {}, p.ruleSentence || "—"), "."),
      clauses,
      el("p", { class: "note" },
        "The clauses overlap — a finding can satisfy several — so these counts do not sum to " +
        "the " + (s.anyOf || 0).toLocaleString() + " findings flagged high risk overall."),
    ));

    const sens = (p.sensitivity || []).filter(
      (x) => x.coverage !== null && x.efficiency !== null,
    );
    if (sens.length > 1) {
      const box = el("div", { class: "chart-box chart-box--tall" }, el("canvas", {}));
      ruleHost.append(el("div", { class: "chart-card" },
        el("h3", {}, helpTip("How much the rule choice matters",
          ["Each point is one combination of signals, scored over this same register: how much " +
            "of what THAT rule calls high risk got fixed (coverage, across) versus how much of " +
            "the fixing it would credit (efficiency, up). The active rule is the filled diamond.",
            "Up and to the right is better, and no rule reaches the corner — that trade-off is " +
            "the whole point of tracking both numbers.",
            "This measures sensitivity to the rule, not which rule is objectively right: the " +
            "ground truth here is the rule itself, so a narrow rule can look flattering simply " +
            "by flagging less."],
          { className: "help-label" })),
        box));
      // The one caveat that must not depend on a hover: each point is scored against its OWN
      // definition of high risk, so a narrow rule can post high coverage simply by flagging
      // few findings. Without this the chart invites the reading that KEV-only "wins".
      ruleHost.append(el("p", { class: "note" },
        "Each point is scored against its own definition of high risk, so the points are not " +
        "competing on a common yardstick: a narrow rule reaches high coverage by flagging " +
        "little. Read this as how sensitive the headline is to the rule, not as which rule " +
        "is right."));
      const canvas = box.querySelector("canvas");
      loadCharts().then((charts) => {
        charts.coverageEfficiencyScatter(canvas, sens);
      }).catch((e) => {
        // eslint-disable-next-line no-console
        console.error("[program] scatter failed:", e);
        chartUnavailable(canvas);
      });
    }
  }

  // --------------------------------------------------------------------- capacity

  function renderCapacity(p) {
    clear(capacityHost);
    const cap = p.capacity || {};
    const capHigh = p.capacityHighRisk || {};
    const months = (cap.months || []).slice(-12);
    if (!months.length) return;

    capacityHost.append(sectionLabel("Remediation capacity"));
    capacityHost.append(el("p", { class: "note" },
      "How much of the open backlog the program closes per month, and whether high-risk work " +
      "is arriving faster than it is being cleared. The research benchmark is that a typical " +
      "organization closes about one in ten open findings per month, largely regardless of size."));

    const highByMonth = {};
    for (const m of capHigh.months || []) highByMonth[m.month] = m;

    const table = el("table", { class: "data" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, "Month"),
        el("th", { scope: "col" }, "Open at start"),
        el("th", { scope: "col" }, "Opened"),
        el("th", { scope: "col" }, "Closed"),
        el("th", { scope: "col" },
          helpTip("Close rate",
            ["Closed during the month as a share of the backlog open at its start."],
            { className: "help-label" })),
        el("th", { scope: "col" },
          helpTip("High-risk net",
            ["High-risk findings closed minus high-risk findings opened, that month. " +
              "Positive means the program gained ground on the work that matters."],
            { className: "help-label" })),
        el("th", { scope: "col" },
          helpTip("Cross-check",
            ["Resolutions reported independently by the scans that ran in this month " +
              "(reconcile's own per-scan deltas). It should track the Closed column; where it " +
              "does not, the scan cadence crossed a month boundary or the scans were severity-" +
              "scoped."],
            { className: "help-label" })))),
    );
    const tbody = el("tbody", {});
    for (const m of months) {
      const hi = highByMonth[m.month];
      const tags = [];
      if (m.partial) tags.push("in progress");
      if (m.reconstructed) tags.push("reconstructed");
      tbody.append(el("tr", {},
        el("td", {},
          m.month,
          tags.length ? el("span", { class: "muted small" }, " " + tags.join(", ")) : null),
        el("td", { class: "num" }, m.openAtStart.toLocaleString()),
        el("td", { class: "num" }, m.opened.toLocaleString()),
        el("td", { class: "num" }, m.closed.toLocaleString()),
        el("td", { class: "num num--key" }, pct0(m.mmcr)),
        el("td", { class: "num" },
          hi ? (hi.net > 0 ? "+" : "") + hi.net.toLocaleString() : "—"),
        el("td", { class: "num muted" },
          m.scanClosed === null || m.scanClosed === undefined
            ? "—"
            : m.scanClosed.toLocaleString())));
    }
    table.append(tbody);
    capacityHost.append(el("div", { class: "table-wrap" }, table));
    if (cap.monthsCounted) {
      capacityHost.append(el("p", { class: "note" },
        "Mean close rate " + pct(cap.mmcrMean) +
        (cap.oneInN ? " (about one in " + cap.oneInN.toFixed(1) + ")" : "") +
        " over " + cap.monthsCounted + " complete month(s). Months still in progress, and " +
        "months before the first saved scan, are excluded from that mean."));
    } else {
      // Say why the headline figure is absent rather than leaving an em dash to be
      // misread as zero. Every month here is either still running or predates the scan
      // history, and a mean over reconstructed months would understate the close rate
      // (closures before the first scan are systematically under-counted).
      capacityHost.append(el("p", { class: "note" },
        "No complete month has been fully observed yet, so there is no mean close rate. " +
        "Months marked reconstructed predate the first saved scan and under-count closures; " +
        "the month in progress is not over. The per-month figures above are still exact for " +
        "what was observed."));
    }
  }

  // ------------------------------------------------------------------ methodology

  /**
   * Always present, collapsed by default. Everything a reader needs to reproduce or dispute
   * the figures above: the arithmetic with this register's own numbers substituted in, what
   * "remediated" means here, which global filters were in force, and the known limits.
   */
  function renderMethodology(p, points) {
    clear(methodHost);
    const m = p.matrix;
    const t = p.toggles || {};
    const details = el("details", { class: "prog-method" });
    details.append(el("summary", {}, "How these numbers are calculated"));

    const dl = el("dl", { class: "prog-method-list" });
    const item = (term, ...body) => {
      dl.append(el("dt", {}, term));
      dl.append(el("dd", {}, ...body));
    };

    item("Coverage",
      el("code", {}, "TP / (TP + FN)"),
      " = " + m.tp.toLocaleString() + " / " + (m.tp + m.fn).toLocaleString() +
      " = " + pct(m.coverage.point) + ". Of the findings the rule calls high risk, the " +
      "share already remediated.");
    item("Efficiency",
      el("code", {}, "TP / (TP + FP)"),
      " = " + m.tp.toLocaleString() + " / " + (m.tp + m.fp).toLocaleString() +
      " = " + pct(m.efficiency.point) + ". Of everything remediated, the share that was " +
      "high risk.");
    item("Random baseline",
      pct(m.prevalence) + " of classified findings are high risk, so a program choosing " +
      "findings at random would score about that efficiency. Anything at or below it is " +
      "not prioritizing.");
    item("The high-risk rule",
      p.ruleSentence + ". Editable in Settings; changing it re-derives every figure on this " +
      "page, including the historical series, because only the raw signals are stored — the " +
      "verdict is computed at read time.");
    item("What counts as remediated",
      "A finding whose status is resolved, remediated, fixed or closed — including one that " +
      "simply stopped appearing in scans, which is dated to the scan that noticed. That is a " +
      "slightly generous reading of 'remediated', and it is the same one MTTR uses.");
    item("Unclassified findings",
      m.unknown.toLocaleString() + " of " + m.total.toLocaleString() + " (" +
      pct0(100 - (m.signalCoveragePct ?? 0)) + ") carry no captured exploit signal. They are " +
      "excluded from both rates rather than assumed harmless — assuming harmless would " +
      "inflate efficiency and deflate coverage simultaneously. The bracketed range beside " +
      "each rate is what it would become if all of them turned out one way or the other.");
    item("Sticky signals",
      "Exploit signals accumulate and never reverse: once a finding has been seen on the KEV " +
      "catalog or with a public exploit, it stays high risk, and its EPSS is the peak ever " +
      "observed. This keeps the trend from rewriting its own history, and it errs toward " +
      "counting more work as high risk rather than less.");
    item("Filters in force",
      (t.showNoFix === false
        ? "Findings with no vendor fix available are EXCLUDED, so they are absent from both " +
          "denominators. "
        : "Findings with no vendor fix available are included. ") +
      (t.includeEol === false
        ? "End-of-life OS findings are EXCLUDED."
        : "End-of-life OS findings are included.") +
      " Both are global settings and both move these denominators.");
    if (points.length) {
      const recon = points.filter((x) => x.reconstructed).length;
      item("History",
        points.length.toLocaleString() + " point(s)" +
        (recon
          ? ", of which " + recon.toLocaleString() + " precede the first saved scan and are " +
            "reconstructed from first-detection dates. Closures in that region are " +
            "under-counted, so early coverage reads low."
          : ", all from saved scans."));
    }
    item("Checking this yourself",
      "Export the classified rows and count them. The CSV carries each finding's raw signals, " +
      "the verdict derived from them, and the matrix cell it landed in, so " +
      "'high risk AND remediated' in a spreadsheet should equal the " + m.tp.toLocaleString() +
      " shown above.");

    details.append(dl);
    details.append(el("div", { style: "margin-top:12px" },
      el("button", { class: "linklike", onclick: () => exportCsv("") },
        "Download classified rows (CSV)")));
    methodHost.append(details);
  }
}
