// THE DATA-TABLE ALTERNATIVE UNDER EVERY CANVAS — ported from `gas/test/chartTable.test.js`
// (itself ported from `gas_devsecops/test/chartTable.test.js`), adapted to this app's TWO
// chart-bearing pages (`inventory.js`, `problems.js`) and its own `pages/_charts.js` model
// builders (`trendTableModel`, `coverTableModel` — new here; neither gas's five builders nor
// gas_devsecops's `agingTableModel`/`severityCountsTableModel` have a counterpart in this
// register's chart shapes).
//
// This project's vitest run sets no `environment` (vitest.config.ts's "pure" project runs
// `isolate: false` with no jsdom) — the same split gas's and gas_devsecops's own copies of
// this file use: `chartTableModel` and the two builders over it are pure and exercised
// directly (`pages/_charts.js` imports neither `../ui.js` nor `../chartsLoader.js` — see its
// own header for why that matters); the DOM half (`chartTable` itself, and the two page
// functions that call it) is read as SOURCE TEXT, comment-stripped first.
//
// BASELINE, MEASURED WHEN THIS FILE WAS WRITTEN: `chartTable(` call sites in gas_ai = 0;
// `el("canvas"` occurrences in source = inventory.js 2 (the counts-over-time trend, and the
// posture-trend card helper called three times from one literal), problems.js 1 (the action
// mode's cumulative-cover curve). No other page file carries one. Every one of those 3
// canvases gained exactly one `chartTable(` call beside it — 2 call sites in inventory.js (one
// per canvas LITERAL; the posture card's single call site is exercised three times at
// runtime) and 1 in problems.js.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { chartTableModel, chartTablePaged } from "../../gas_shared/ui/chartTable.js";
import { code } from "../../gas_shared/test/contracts/emptyStates.js";
import { coverTableModel, trendTableModel } from "../src/client/js/pages/_charts.js";

const PAGES_DIR = fileURLToPath(new URL("../src/client/js/pages/", import.meta.url));
const PAGE_FILES = readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js"));
const PAGE_CODE = Object.fromEntries(
  PAGE_FILES.map((f) => [f, code(readFileSync(PAGES_DIR + f, "utf8"))]),
);
const count = (src, re) => (src.match(re) || []).length;

// =========================================================================================
//  1. An absent figure is an em dash; a measured zero is a zero
// =========================================================================================
//
// Byte-identical in substance to gas's and gas_devsecops's own copies of this section — there
// is only one `chartTableModel` (`gas_shared/ui/chartTable.js`), so the same measurement
// holds here.

describe("chartTableModel never renders an absent figure as a confident zero", () => {
  // PERTURBATION (documented in gas_devsecops/test/chartTable.test.js, run there and reverted,
  // not re-run here — this package may not edit gas_shared/): `FORMATTERS.count` changed from
  // `fmtCount` to `(v) => String(Number(v) || 0)` fails exactly the first `it` below and
  // leaves the second green — only the pair distinguishes "formats nulls correctly" from
  // "prints an em dash for everything falsy".
  const series = [
    { date: "2026-01-01", open: 0, rate: 0 },
    { date: "2026-01-02", open: null, rate: null },
  ];
  const model = chartTableModel({
    columns: [
      { key: "date", label: "Date", format: "text" },
      { key: "open", label: "Open", format: "count" },
      { key: "rate", label: "Coverage %", format: "pct" },
    ],
    rows: series,
  });

  it("a null cell renders as an em dash, not as 0", () => {
    expect(model.rows[1][1]).toBe("—"); // count
    expect(model.rows[1][2]).toBe("—"); // pct
  });

  it("a measured zero renders as 0, in each format's own units", () => {
    expect(model.rows[0][1]).toBe("0");
    expect(model.rows[0][2]).toBe("0.0%");
  });
});

// =========================================================================================
//  2. Every canvas in every page has a table beside it
// =========================================================================================

describe("every chart canvas ships a data-table alternative", () => {
  // PERTURBATION: a second canvas added to a page that draws no chart and therefore builds no
  // table. Reproduced inline, run through the SAME counting function the real files are
  // checked with — this package owns the counting logic itself (it does not live in a shared
  // file this test can cite by transcript, the same reasoning gas's and gas_devsecops's own
  // copies of this perturbation give).
  it("the counting function reports a mismatch: two canvases, one chartTable(", () => {
    const REGRESSED = `
      export function renderThing(main) {
        const a = el("canvas", {});
        const b = el("canvas", {});
        main.append(chartTable({ canvas: a, model: chartTableModel({}) }));
      }
    `;
    const stripped = code(REGRESSED);
    const canvases = count(stripped, /el\("canvas"/g);
    const tables = count(stripped, /\bchartTable\(/g);
    expect(canvases).toBe(2);
    expect(tables).toBe(1);
    expect(tables).not.toBe(canvases);
  });

  // PER-FILE COUNTS, not a nearest-enclosing-function scan — same reasoning as gas's and
  // gas_devsecops's own copies: every file that draws a canvas draws it in the same function
  // (or the same enclosing card-builder closure) that builds its table, and an approximate
  // function-body parser over arrow chains and `.then()` callbacks would be a second, worse
  // parser to maintain. A file that gains a canvas with no table fails here whichever function
  // it was added to.
  it("each page builds exactly one chartTable per canvas", () => {
    for (const file of PAGE_FILES) {
      const src = PAGE_CODE[file];
      const canvases = count(src, /el\("canvas"/g);
      const tables = count(src, /\bchartTable\(/g);
      expect(tables, `${file} builds ${canvases} canvas(es) and ${tables} chartTable(s)`)
        .toBe(canvases);
    }
  });

  it("the two chart pages still draw the 3 canvases they compose, counted so a deletion shows", () => {
    // A count, so a canvas deleted to make the test above pass is visible as a change here
    // rather than as a silent green. THIS IS A REGISTRY, so a number that moves says what
    // joined or left.
    //
    //   inventory.js  2  — the counts-over-time trend (issues / findings / posture fails), and
    //                      the posture-trend card helper (`postureTrendCard`, one canvas
    //                      LITERAL called three times at runtime for adjacency, exploitation
    //                      and category — the SOURCE count is 1 for that literal, 2 total with
    //                      the counts trend)
    //   problems.js   1  — action mode's cumulative-cover curve
    //
    // No other page file draws a canvas — measured with a plain grep before this file was
    // written: zero hits across every other file in `pages/`.
    const perFile = { "inventory.js": 2, "problems.js": 1 };
    let total = 0;
    for (const [file, expected] of Object.entries(perFile)) {
      const n = count(PAGE_CODE[file], /el\("canvas"/g);
      expect(n, file).toBe(expected);
      total += n;
    }
    expect(total).toBe(3);
    for (const file of PAGE_FILES) {
      if (file in perFile) continue;
      expect(count(PAGE_CODE[file], /el\("canvas"/g), file).toBe(0);
    }
  });

  it("no page declares a function named chartCard — the name that used to shadow the shared "
    + "component base", () => {
    // `inventory.js`'s posture-trend helper used to be a page-local `chartCard`, a name that
    // reads as one more `gas_shared/ui/` primitive when it is in fact page-specific — renamed
    // to `postureTrendCard`. PERTURBATION is the assertion itself: this `it` fails the moment
    // the old name comes back, on any page.
    for (const file of PAGE_FILES) {
      expect(PAGE_CODE[file], file).not.toMatch(/\bfunction\s+chartCard\s*\(/);
    }
  });

  it("every chartTable call is handed the canvas it describes, so aria-details is wired", () => {
    for (const file of PAGE_FILES) {
      const src = PAGE_CODE[file];
      const calls = src.match(/\bchartTable\(\{[\s\S]{0,160}/g) || [];
      for (const call of calls) {
        expect(call, `${file}: a chartTable call names no canvas`).toMatch(/canvas/);
      }
    }
  });
});

// =========================================================================================
//  3. The chartTable model reads the SAME array the chart wrapper is handed
// =========================================================================================
//
// `ui/chartTable.js`'s one rule: the table is built from the array reference the chart
// wrapper receives, named once. A textual check, per this package's own brief — for every
// `chartTable(` call site, the identifier passed as the model builder's first argument must
// appear again nearby, inside the `charts.<wrapper>(...)` call reading the same population.

/** The identifier passed as the first argument to a `*TableModel(` call inside `window` — the
 *  value `ui/chartTable.js`'s rule says must be the SAME reference the chart wrapper reads.
 *  `null` when the window carries no such call (nothing to check). */
function modelArrayIdent(window) {
  const m = /\b\w*TableModel\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/.exec(window);
  return m ? m[1] : null;
}

/** Does `ident` appear inside the argument list of a `charts.<wrapper>(...)` call in
 *  `window`? Scoped to the 400 characters AFTER each such call's opening paren — wide enough
 *  for every real call site here and narrow enough that merely DECLARING a same-named
 *  variable near the table (and never actually handing it to the wrapper) does not count. */
function usedInWrapperCall(window, ident) {
  const escaped = ident.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bounded = new RegExp(`\\b${escaped}\\b`);
  const wrapperRe = /charts\.\w+\(/g;
  let m;
  while ((m = wrapperRe.exec(window))) {
    if (bounded.test(window.slice(m.index, m.index + 400))) return true;
  }
  return false;
}

/** For every `chartTable(` call in `src`, a window of surrounding source wide enough to reach
 *  both the eager table build and the `charts.<wrapper>(...)` call reading the same array. */
function chartTableWindows(src, span = 2000) {
  const out = [];
  const re = /\bchartTable\(/g;
  let m;
  while ((m = re.exec(src))) {
    const start = Math.max(0, m.index - span);
    const end = Math.min(src.length, m.index + span);
    out.push(src.slice(start, end));
  }
  return out;
}

describe("every chartTable's model is built from the array the wrapper plots", () => {
  for (const file of ["inventory.js", "problems.js"]) {
    it(`${file}: every chartTable( call's model array is read again in a charts.<wrapper>( call nearby`, () => {
      const windows = chartTableWindows(PAGE_CODE[file]);
      expect(windows.length, `${file} has no chartTable( calls to check`).toBeGreaterThan(0);
      for (const [i, window] of windows.entries()) {
        const ident = modelArrayIdent(window);
        expect(ident, `${file} chartTable #${i + 1}: no *TableModel( call found nearby`)
          .not.toBeNull();
        expect(usedInWrapperCall(window, ident), `${file} chartTable #${i + 1}: "${ident}" is `
          + "never read inside a nearby charts.<wrapper>( call").toBe(true);
      }
    });
  }

  // PERTURBATION: the model is deliberately built from a DIFFERENT array than the one the
  // wrapper reads — the drift `ui/chartTable.js`'s header warns a second derivation invites.
  // A plain "does the identifier appear twice nearby" count would MISS this: `otherPoints` is
  // declared right beside the table and would satisfy that weaker check on its own
  // declaration alone, which is exactly why the real check above looks INSIDE a
  // `charts.<wrapper>(` call rather than just counting occurrences in the window.
  it("the same-array check catches a model built from a different identifier than the wrapper reads", () => {
    const DRIFTED = `
      function render() {
        const points = fetchPoints();
        const otherPoints = deriveSomethingElse();
        card.append(chartTable({
          canvas,
          model: trendTableModel(otherPoints, series),
        }));
        loadCharts().then((charts) => {
          charts.trendLine(canvas, points.map((pt) => ({ x: pt.at })), { yLabel: "count" });
        });
      }
    `;
    const stripped = code(DRIFTED);
    const [window] = chartTableWindows(stripped);
    const ident = modelArrayIdent(window);
    expect(ident).toBe("otherPoints");
    // "otherPoints" is declared and read once by the model builder — never inside the
    // `charts.trendLine(...)` call, which reads the unrelated "points".
    expect(usedInWrapperCall(window, ident)).toBe(false);
  });
});

// =========================================================================================
//  4. `trendTableModel` — the counts-trend / posture-card shape
// =========================================================================================

describe("trendTableModel keeps a gap a gap — never a plotted zero", () => {
  const series = [
    { key: "issues", label: "Open issues" },
    { key: "findings", label: "Cloud findings" },
  ];
  const points = [
    { at: "2026-01-01T00:00:00.000Z", counts: { issues: 12, findings: 0 } },
    { at: "2026-01-08T00:00:00.000Z", counts: { issues: null, findings: 3 } },
    { at: "2026-01-15T00:00:00.000Z", counts: { issues: 9 } }, // findings undefined
  ];
  const model = trendTableModel(points, series);

  it("emits one row per point, one column per series plus the sync column", () => {
    expect(model.columns.map((c) => c.label)).toEqual(["Sync", "Open issues", "Cloud findings"]);
    expect(model.rows).toHaveLength(3);
  });

  it("a null count renders as an em dash, never a plotted 0", () => {
    expect(model.rows[1][1]).toBe("—"); // issues: null
  });

  it("an undefined count (the key absent from that point's counts) renders as the same em dash", () => {
    expect(model.rows[2][2]).toBe("—"); // findings: key absent
  });

  it("a measured zero renders as 0, not as absence", () => {
    expect(model.rows[0][2]).toBe("0"); // findings: 0
  });

  it("an empty points array is an empty table, not a row of zeroes", () => {
    expect(trendTableModel([], series).rows).toEqual([]);
    expect(trendTableModel(null, series).rows).toEqual([]);
  });

  it("a custom xValue overrides the default sync-date reader", () => {
    const m = trendTableModel(points, series, { xLabel: "Week", xValue: (p) => p.at.slice(0, 10) });
    expect(m.columns[0].label).toBe("Week");
    expect(m.rows[0][0]).toBe("2026-01-01");
  });

  // PERTURBATION, reproduced inline rather than asserted from a comment: the tempting
  // "simplify away the null check" rewrite CLAUDE.md's working discipline names —
  // `Number(v) || 0` — folds a genuine gap to a confident, plotted zero. Run through the
  // real chartTableModel formatting path so the failure is the same shape a reviewer would
  // see on screen: "0" where the real model prints the dash.
  it("a rewrite that folds null to 0 prints \"0\" where the real model prints the dash", () => {
    const DEFECTIVE_READ = (row, key) => Number((row.counts || {})[key]) || 0;
    const defectiveModel = chartTableModel({
      columns: [
        { key: "issues", label: "Open issues", format: "count", value: (r) => DEFECTIVE_READ(r, "issues") },
      ],
      rows: points,
    });
    expect(defectiveModel.rows[1][0]).toBe("0");
    expect(defectiveModel.rows[1][0]).not.toBe(model.rows[1][1]);
    expect(model.rows[1][1]).toBe("—");
  });
});

// =========================================================================================
//  5. `coverTableModel` — the cumulative-cover curve
// =========================================================================================

describe("coverTableModel lists the whole curve, sharing the same refusal problems.js's own "
  + "actionHeadline applies to top10Share", () => {
  const curve = [
    { rank: 1, cumulative: 4, share: 0.4 },
    { rank: 2, cumulative: 7, share: 0.7 },
    { rank: 3, cumulative: 10, share: 1 },
  ];
  const model = coverTableModel(curve);

  it("one row per curve point, in rank order", () => {
    expect(model.rows).toHaveLength(curve.length);
    expect(model.columns.map((c) => c.label))
      .toEqual(["Rank", "Problems closed, cumulative", "Share"]);
  });

  it("share is read as a percentage — the multiply happens AFTER the refusal", () => {
    expect(model.rows[0]).toEqual(["1", "4", "40.0%"]);
    expect(model.rows[2]).toEqual(["3", "10", "100.0%"]);
  });

  it("a null share prints the em dash, never a confident 0% (num(null) * 100 === 0 is the trap)", () => {
    const withGap = coverTableModel([{ rank: 1, cumulative: 4, share: null }]);
    expect(withGap.rows[0][2]).toBe("—");
  });

  it("rows equal the curve length even when it is longer than the default page size", () => {
    const long = Array.from({ length: 12 }, (_, i) => ({
      rank: i + 1, cumulative: i + 1, share: (i + 1) / 12,
    }));
    expect(coverTableModel(long).rows).toHaveLength(12);
  });

  it("an empty or absent curve is an empty table, not a row of zeroes", () => {
    expect(coverTableModel([]).rows).toEqual([]);
    expect(coverTableModel(null).rows).toEqual([]);
  });
});

// =========================================================================================
//  6. A long table pages rather than truncating — the shared decision, unchanged here
// =========================================================================================

describe("chartTablePaged decides once, from the row count against the default", () => {
  it("a table at or under the default page size is offered no pager at all", () => {
    expect(chartTablePaged(0)).toBe(false);
    expect(chartTablePaged(12)).toBe(false);
  });

  it("the seeded cover curve (12 actions) needs no pager", () => {
    expect(chartTablePaged(12)).toBe(false);
  });
});
