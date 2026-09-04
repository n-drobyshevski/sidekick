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
import { call } from "../../../../../gas_shared/api.js";
import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import {
  PAGE_SIZES, absent, clear, dataTable, downloadText, el, emptyState, errorState, fmtDate,
  heroStat, openSheet, pageHeader, scopeBar, sectionLabel, sevBadge, skeleton, statusPill,
  tableFooter, tip, toast,
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

/**
 * The same percent, in a position that can hold a Node.
 *
 * `pct` and `pct0` above have to keep returning STRINGS: three call sites each concatenate them
 * into a sentence (the range beside a rate, the hero source line, the methodology arithmetic),
 * and `absent()` is a Node, which `+` would render as "[object HTMLSpanElement]". So the muted
 * dash arrives here instead, at the two call sites that are real cells. The defect it closes is
 * the one `absent()` exists for: a black "—" in a numeric column reads with exactly the weight
 * of a measured figure, and this one sits directly under a column of real close rates.
 */
function pct0Cell(v) {
  return v === null || v === undefined ? absent() : pct0(v);
}

/**
 * Cell content at caption size, as a span rather than as a class on the cell.
 *
 * `dataTable` lands `col.className` on the <th> as well as on every <td>, which is exactly what
 * the numeric columns here want — a right-aligned heading over right-aligned figures. `.small`
 * is the opposite case: it is 12px where a table heading is 11px, so putting it on the column
 * would enlarge the heading in order to shrink the column. A span keeps the two apart.
 */
function small(...kids) {
  return el("span", { class: "small" }, ...kids);
}

/**
 * The rate itself. Paired with rangeNode below, never shown without it.
 *
 * BOTH of its call sites are Node child positions (the coverage hero value and the efficiency
 * stat beside it), so this one may return `absent()` rather than a bare dash. It now refuses a
 * null `point` as well as a null rate: `pct(null)` was already returning the dash for it, in
 * black, which is the case this whole helper family exists to keep out of the ink of a measured
 * number.
 */
function rateText(rate) {
  if (!rate || rate.point === null || rate.point === undefined) return absent();
  return pct(rate.point);
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
  // `absent()` IS this span, written once — same tag, same class, same dash. Spelling it out
  // here was one of the six hand-typed em dashes the shared helper was promoted to end.
  if (!spec) return absent();
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

  main.append(pageHeader({
    hero: heroStat(
      "Security",
      "Program performance",
      "Whether remediation effort lands on the findings that matter. Coverage and efficiency "
        + "pull against each other, so neither means anything alone.",
    ),
  }));

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
      console.error("[program] " + label + " render failed:", e);
      // errorState, NOT emptyState — see the same guard on the executive page: a section
      // that threw is a defect, not an absence, and the exception belongs in a disclosure
      // rather than on the floor.
      if (host) {
        clear(host).append(errorState("Couldn't render " + label + ".",
          { detail: String((e && e.message) || e) }));
      }
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
    console.error("[program] getProgramPage failed:", e);
    // errorState, NOT emptyState — the same correction the per-section `guard` above already
    // carries. An RPC that THREW was being announced through emptyState's role="status", in the
    // same dashed box this register uses for "no scan saved yet", so a screen reader heard a
    // crash as calm news; and the exception itself went nowhere but the console. The hint
    // sentence goes with it: a disclosure carrying the real message beats advice that may not
    // apply. gas_shared/test/contracts/emptyStates.js is what now holds the distinction.
    clear(heroHost).append(errorState("Couldn't load program performance.",
      { detail: String((e && e.message) || e) }));
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
    const cov = tip(
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
      ]
    );
    const eff = tip(
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
      ]
    );

    const minis = el("div", { class: "hero-minis" });
    const capOverall = p.capacity || {};
    const capHigh = p.capacityHighRisk || {};
    const miniDefs = [
      ["High risk, still open", m.fn.toLocaleString(), null],
      ["High risk, remediated", m.tp.toLocaleString(), null],
      [
        "Monthly close rate",
        pct0Cell(capOverall.mmcrMean),
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
      return el("td", {}, tip(btn, [spec.help]));
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
            tip("No captured signal",
              ["Outside the 2×2 on purpose: these findings are not 'low risk', they are " +
                "unscored. Counting them as low risk would inflate efficiency and deflate " +
                "coverage at the same time, so they are excluded from both and reported here."])),
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
    // The size the sheet opens at, and now also a size the reader can change. It has to be a
    // member of the `sizes` list handed to tableFooter below or the <select> renders blank —
    // `sizeSelect.value = String(pageSize)` matches no option and the browser falls back to the
    // first entry, which would then lie about how many rows are on screen.
    let pageSize = 50;
    openSheet((body) => {
      const host = el("div", {});
      body.append(host);
      const load = async () => {
        clear(host).append(el("div", { class: "muted" }, "Loading…"));
        try {
          const res = await call("api_getRiskCohort", {
            ...params, quadrant, page, pageSize,
          });
          clear(host);
          if (!res.rows.length) {
            host.append(emptyState("No findings in this cell."));
            return;
          }
          host.append(dataTable({
            columns: [
              {
                key: "finding",
                label: "Finding",
                cell: (r) => el("div", {},
                  el("div", {}, r.cve || r.vuln_key),
                  el("div", { class: "muted small" }, r.asset_name || "")),
              },
              { key: "severity", label: "Severity", cell: (r) => sevBadge(r.severity) },
              // `.small` rides on a span inside the cell rather than on `className`, and the
              // three columns below do the same. `dataTable` puts `col.className` on the <th>
              // too — which is what the numeric tables on this page WANT — but `.small` is
              // 12px against the heading's own 11px, so spending it there would enlarge three
              // headings to shrink three columns.
              { key: "signals", label: "Signals", cell: (r) => small(signalText(r)) },
              { key: "first_seen", label: "First seen", cell: (r) => small(fmtDate(r.first_seen)) },
              {
                key: "resolved_at",
                label: "Resolved",
                // A row still open has no resolution date, and the black dash that used to
                // stand here read as a value in the same ink as the dates above it. `absent()`
                // is a Node, so it replaces the whole cell content rather than being wrapped.
                cell: (r) => (r.resolved_at ? small(fmtDate(r.resolved_at)) : absent()),
              },
            ],
            rows: res.rows,
          }));
          // tableFooter, and UNCONDITIONALLY, where `pager` was drawn only above one page.
          // Two things were wrong with that. A cohort that fitted on one page printed no count
          // at all, so the sheet's subtitle was the only place the size of the cell appeared —
          // and the shared pager's single-page branch is the one that pluralises ("1 row", not
          // the "1 rows" a hand-built count gives), so gating it off threw away the correct
          // spelling along with the number. Second, fifty rows was the only page size on offer.
          // `onPageSize` is handed a page already recomputed to hold the row that was on top, so
          // widening the page does not also move the reader somewhere else.
          host.append(tableFooter({
            page: res.page,
            pageCount: res.pageCount,
            total: res.total,
            pageSize,
            sizes: PAGE_SIZES,
            onPage: (n) => { page = n; load(); },
            onPageSize: (size, nextPage) => { pageSize = size; page = nextPage; load(); },
          }));
        } catch (e) {
          clear(host).append(errorState("Couldn't load these findings.",
            { detail: String((e && e.message) || e) }));
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
      // `resizable: true` replaces `storageKey: "programCohortWidth"`, the same substitution the
      // MTTR by-domain sheet needed and for the same reason: `storageKey` was one of gas's own
      // sheet options and the shared `openSheet` destructures a fixed set, ignoring anything
      // else without complaint — so this drawer had quietly stopped being resizable at all. The
      // shared sheet persists the width itself, under one key for every resizable sheet.
      resizable: true,
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
      el("h3", {}, tip("Coverage & efficiency over time",
        ["Both rates recomputed at each date over the findings that existed then: a finding " +
          "counts as remediated from its resolution date onward, and as open before it.",
          "Risk classification is NOT re-evaluated per date — each finding carries the signals " +
          "ever observed for it. A CVE that only reached the KEV catalog later therefore counts " +
          "as high risk in earlier points too. That makes the early series read pessimistically, " +
          "and it is what stops last week's plotted value from changing every time a scan lands.",
          "Shaded region: dates before the first saved scan, reconstructed from first-detection " +
          "dates. Closures there are under-counted, because a finding that simply stopped " +
          "appearing is dated to the scan that noticed."])),
      box);
    trendHost.append(card);
    const canvas = box.querySelector("canvas");
    loadCharts().then((charts) => {
      charts.coverageEfficiencyLines(canvas, points);
    }).catch((e) => {
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
        // The muted dash rather than a bold black one: with no rule sentence in the payload the
        // sentence has no predicate, and setting that absence in the same bold ink as a real
        // rule claims the register has one.
        "A finding is high risk when ", el("strong", {}, p.ruleSentence || absent()), "."),
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
        el("h3", {}, tip("How much the rule choice matters",
          ["Each point is one combination of signals, scored over this same register: how much " +
            "of what THAT rule calls high risk got fixed (coverage, across) versus how much of " +
            "the fixing it would credit (efficiency, up). The active rule is the filled diamond.",
            "Up and to the right is better, and no rule reaches the corner — that trade-off is " +
            "the whole point of tracking both numbers.",
            "This measures sensitivity to the rule, not which rule is objectively right: the " +
            "ground truth here is the rule itself, so a narrow rule can look flattering simply " +
            "by flagging less."])),
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

    // `dataTable`: a static seven-column list, one header row, no colspan. The three column
    // definitions that carried a `tip` become `help`, which the component attaches the same way
    // — and the six numeric columns now carry `num` on the heading as well as the cells, so each
    // label sits over its own figures instead of adrift to the left of them.
    capacityHost.append(dataTable({
      columns: [
        {
          key: "month",
          label: "Month",
          cell: (m) => {
            const tags = [];
            if (m.partial) tags.push("in progress");
            if (m.reconstructed) tags.push("reconstructed");
            return el("span", {},
              m.month,
              tags.length ? el("span", { class: "muted small" }, " " + tags.join(", ")) : null);
          },
        },
        {
          key: "openAtStart",
          label: "Open at start",
          className: "num",
          cell: (m) => m.openAtStart.toLocaleString(),
        },
        { key: "opened", label: "Opened", className: "num", cell: (m) => m.opened.toLocaleString() },
        { key: "closed", label: "Closed", className: "num", cell: (m) => m.closed.toLocaleString() },
        {
          key: "mmcr",
          label: "Close rate",
          className: "num num--key",
          help: ["Closed during the month as a share of the backlog open at its start."],
          // A month with no backlog at its start has no close rate, and the black dash `pct0`
          // returned for it read as a measured figure in a column of measured figures.
          cell: (m) => pct0Cell(m.mmcr),
        },
        {
          key: "highRiskNet",
          label: "High-risk net",
          className: "num",
          help: ["High-risk findings closed minus high-risk findings opened, that month. " +
            "Positive means the program gained ground on the work that matters."],
          cell: (m) => {
            const hi = highByMonth[m.month];
            // No high-risk row for this month is "we never scored it", not "net zero".
            if (!hi) return absent();
            return (hi.net > 0 ? "+" : "") + hi.net.toLocaleString();
          },
        },
        {
          key: "scanClosed",
          label: "Cross-check",
          className: "num",
          help: ["Resolutions reported independently by the scans that ran in this month " +
            "(reconcile's own per-scan deltas). It should track the Closed column; where it " +
            "does not, the scan cadence crossed a month boundary or the scans were severity-" +
            "scoped."],
          // `.muted` stays on a span inside the cell rather than on the column: it would
          // otherwise repaint this heading a different grey from the six beside it.
          cell: (m) => (m.scanClosed === null || m.scanClosed === undefined
            ? absent()
            : el("span", { class: "muted" }, m.scanClosed.toLocaleString())),
        },
      ],
      rows: months,
    }));
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
