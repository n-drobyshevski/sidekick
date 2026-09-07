// THE DATA-TABLE ALTERNATIVE UNDER EVERY CANVAS — ported from
// gas_devsecops/test/chartTable.test.js, adapted to this app's four chart-bearing pages
// (mttr.js, overview.js, program.js, history.js) and its own `pages/_charts.js` model
// builders (`agingTableModel`, `severityCountsTableModel` are ported unchanged in shape;
// `trendTableModel` / `pieTableModel` / `barsTableModel` / `scatterTableModel` /
// `sparkTableModel` are new here — see that file's own header).
//
// This project's vitest run sets no `environment` (vitest.config.ts), so there is no jsdom and
// no `document` — the same split gas_devsecops's own copy of this file uses: `chartTableModel`
// and every builder over it are pure and exercised directly; the DOM half (`chartTable`,
// `chartCard`) is read as SOURCE TEXT, comment-stripped first.
//
// BASELINE, MEASURED ON THIS BRANCH BEFORE THIS PACKAGE: `chartTable(` call sites in gas = 0;
// `el("canvas"` occurrences in source = mttr 9, overview 6, program 2, history 2 (some
// conditional, some inside a sheet/drawer that only renders when opened). After this package
// every one of those 19 canvases has exactly one `chartTable(` call beside it — see the pinned
// count below.
//
// SECTION 5 OF THE PORTED FILE (the SCA/SAST hero severity bar + key row) DOES NOT PORT: none
// of these four pages draws a `sevSegmentBar`/`sevKeyRow`/`sevEntries` hero bar — that pattern
// is `gas_devsecops`'s own register-summary convention and has no counterpart here. Checked
// with a plain grep before writing this file: zero hits across `pages/{mttr,overview,program,
// history}.js`.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  chartTableModel, chartTablePaged, survivalTableModel,
} from "../../gas_shared/ui/chartTable.js";
import { DEFAULT_PAGE_SIZE, pageOf } from "../../gas_shared/ui/tableModel.js";

// ------------------------------------------------------------------ the comment stripper

/**
 * The file with its `//` comments removed — string-aware, so a comment marker inside a quoted
 * string survives. Copied from gas_devsecops/test/chartTable.test.js's `code()` (itself copied
 * from `test/pagesLit.test.js`'s), for the identical reason: `ui/chartTable.js`'s own header
 * and several page comments below NAME `el("canvas"` and `chartTable(` while explaining the
 * rule, and a raw-text count would be thrown off by the sentence that states it.
 */
function code(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    out += c;
    i++;
  }
  return out;
}

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
// Byte-identical to gas_devsecops's own copy of this section: there is only one
// `chartTableModel` (`gas_shared/ui/chartTable.js`), so the same measurement holds here.

describe("chartTableModel never renders an absent figure as a confident zero", () => {
  // PERTURBATION (documented in gas_devsecops/test/chartTable.test.js, run there and reverted):
  // `FORMATTERS.count` changed from `fmtCount` to `(v) => String(Number(v) || 0)` fails exactly
  // the first `it` below and leaves the second green — which is the point of pairing them: only
  // the pair distinguishes "formats nulls correctly" from "prints an em dash for everything
  // falsy". Not re-run here (this package may not edit `gas_shared/`); the shared module's own
  // test carries the failing-output transcript.
  const series = [
    { date: "2026-01-01", open: 0, rate: 0, days: 0 },
    { date: "2026-01-02", open: null, rate: null, days: null },
  ];
  const model = chartTableModel({
    columns: [
      { key: "date", label: "Date", format: "text" },
      { key: "open", label: "Open", format: "count" },
      { key: "rate", label: "Coverage %", format: "pct" },
      { key: "days", label: "Half-life", format: "days" },
    ],
    rows: series,
  });

  it("a null cell renders as an em dash, not as 0", () => {
    expect(model.rows[1][1]).toBe("—"); // count
    expect(model.rows[1][2]).toBe("—"); // pct
    expect(model.rows[1][3]).toBe("—"); // days
  });

  it("a measured zero renders as 0, in each format's own units", () => {
    expect(model.rows[0][1]).toBe("0");
    expect(model.rows[0][2]).toBe("0.0%");
    expect(model.rows[0][3]).toBe("0.0 d");
  });
});

// =========================================================================================
//  2. Every canvas in every page has a table beside it
// =========================================================================================

describe("every chart canvas ships a data-table alternative", () => {
  // PERTURBATION: a ninth canvas added to a page that draws no chart and therefore builds no
  // table. Reproduced here as a standalone snippet run through the SAME counting function the
  // real files are checked with — the same shape gas_devsecops's own perturbation comment
  // describes, run inline here since this package owns the counting logic itself (it does not
  // live in a shared file this test can cite by transcript).
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

  // PER-FILE COUNTS, not a nearest-enclosing-function scan — same reasoning as
  // gas_devsecops's own copy: every one of the four files that draws a canvas draws it in the
  // same function (or the same enclosing drawer-builder closure) that builds its table, and an
  // approximate function-body parser over arrow chains and `.then()` callbacks would be a
  // second, worse parser to maintain. A file that gains a canvas with no table fails here
  // whichever function it was added to.
  it("each page builds exactly one chartTable per canvas", () => {
    for (const file of PAGE_FILES) {
      const src = PAGE_CODE[file];
      const canvases = count(src, /el\("canvas"/g);
      const tables = count(src, /\bchartTable\(/g);
      expect(tables, `${file} builds ${canvases} canvas(es) and ${tables} chartTable(s)`)
        .toBe(canvases);
    }
  });

  it("the four chart pages still draw the 19 canvases they compose, counted so a deletion shows", () => {
    // A count, so a canvas deleted to make the test above pass is visible as a change here
    // rather than as a silent green. Per file, measured on this branch:
    //   mttr.js      9  — survival curve, resolution-bucket histogram, MTTR-over-time,
    //                     open-vs-resolved, open-past-SLA, SLA-quality (6, on the main page);
    //                     the by-domain drawer's contribution/median lens pair and its MTTR-by-
    //                     domain line (3, inside a sheet that only renders when opened)
    //   overview.js  6  — the per-tier trend small-multiples grid (one canvas literal, one
    //                     combined table for the whole grid — see tierTrendCard's own comment),
    //                     aging-by-tier, SLA-window-consumed, scan-over-scan open backlog, and
    //                     the breakdown sheet's group-share pie and group-trend line (2, inside
    //                     a sheet)
    //   program.js   2  — coverage/efficiency over time, the rule-sensitivity scatter
    //   history.js   2  — open vs resolved, MTTR trend (KM median)
    const perFile = {
      "mttr.js": 9, "overview.js": 6, "program.js": 2, "history.js": 2,
    };
    let total = 0;
    for (const [file, expected] of Object.entries(perFile)) {
      const n = count(PAGE_CODE[file], /el\("canvas"/g);
      expect(n, file).toBe(expected);
      total += n;
    }
    expect(total).toBe(19);
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
// `chartTable(` call site, the identifier (or dotted property path) passed as the model
// builder's first argument must appear again nearby, which is where the `charts.<wrapper>(`
// call reading the same population sits (either right beside the table, inside the same
// eager card build, or a few lines later inside that block's own `loadCharts().then(...)` /
// `painters.push(...)`).

/** The identifier or dotted-property path passed as the first argument to a `*TableModel(`
 *  call inside `window` — the value `ui/chartTable.js`'s rule says must be the SAME reference
 *  the chart wrapper reads. `null` when the window carries no such call (nothing to check). */
function modelArrayIdent(window) {
  const m = /\b\w*TableModel\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/.exec(window);
  return m ? m[1] : null;
}

/** Does `ident` appear inside the argument list of a `charts.<wrapper>(...)` call in
 *  `window`? Scoped to the 400 characters AFTER each such call's opening paren — wide enough
 *  for every real call site here (none of this app's wrapper calls run that long) and narrow
 *  enough that merely DECLARING a same-named variable near the table (and never actually
 *  handing it to the wrapper) does not count, which a plain "appears twice nearby" count would
 *  have missed — see the perturbation below, which is exactly that miss. */
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
 *  both the eager table build and the `charts.<wrapper>(...)` call reading the same array —
 *  measured against this package's own four files, whose furthest pair (history.js's KM-median
 *  card, which builds its table beside a whole SECOND chart card's worth of markup before its
 *  own `loadCharts().then(...)` block) sits at 1,192 characters. */
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

// ONE DOCUMENTED EXCEPTION, counted and named — the same discipline CLAUDE.md's own
// `DASH_ALLOWLIST` (test/figures.test.js) states for the identical reason: a silent skip is
// how a real regression hides, so the exception names exactly which call it covers and why.
//
// `pages/overview.js`'s `tierTrendCard` (1st of its 6 `chartTable(` calls) draws the table from
// `trend` — the raw per-scan `{date, byGroup}` array, which carries a real date every tier
// shares — while each tier's OWN canvas plots `series`, a `trend.map((p) => p.byGroup[tier] ||
// 0)` DERIVED from it for that one tier. The two are the same underlying population; they
// differ only in that the table is the more honest of the two readings (`trend`'s real `null`
// survives; `series`'s `|| 0` cannot draw one). That is a stated design decision (see
// `tierTrendCard`'s own comment), not the silent drift this check exists to catch elsewhere.
const SAME_ARRAY_EXCEPTIONS = new Map([["overview.js", new Set([0])]]);

describe("every chartTable's model is built from the array the wrapper plots", () => {
  for (const file of ["mttr.js", "overview.js", "program.js", "history.js"]) {
    it(`${file}: every chartTable( call's model array is read again in a charts.<wrapper>( call nearby`, () => {
      const windows = chartTableWindows(PAGE_CODE[file]);
      expect(windows.length, `${file} has no chartTable( calls to check`).toBeGreaterThan(0);
      const exceptions = SAME_ARRAY_EXCEPTIONS.get(file) || new Set();
      for (const [i, window] of windows.entries()) {
        if (exceptions.has(i)) continue;
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
  // A plain "does the identifier appear twice nearby" count would MISS this: `otherRows` is
  // declared right beside the table and would satisfy that weaker check on its own declaration
  // alone, which is exactly why the real check above looks INSIDE a `charts.<wrapper>(` call
  // rather than just counting occurrences in the window.
  it("the same-array check catches a model built from a different identifier than the wrapper reads", () => {
    const DRIFTED = `
      function render() {
        const rows = fetchRows();
        const otherRows = deriveSomethingElse();
        card.append(chartTable({
          canvas,
          model: trendTableModel(otherRows, [{ key: "y", label: "Y" }]),
        }));
        loadCharts().then((charts) => {
          charts.trendLine(canvas, rows, { yLabel: "days" });
        });
      }
    `;
    const stripped = code(DRIFTED);
    const [window] = chartTableWindows(stripped);
    const ident = modelArrayIdent(window);
    expect(ident).toBe("otherRows");
    // "otherRows" is declared and read once by the model builder — never inside the
    // `charts.trendLine(...)` call, which reads the unrelated "rows".
    expect(usedInWrapperCall(window, ident)).toBe(false);
  });
});

// =========================================================================================
//  4. The model lists the whole series, and a long one pages rather than truncating
// =========================================================================================
//
// Byte-identical in substance to gas_devsecops's own copy of these two sections — the shared
// module (`gas_shared/ui/chartTable.js`) is the same file, so the same measurements hold.

describe("the model is the same population as the chart", () => {
  it("emits exactly one row per input point — no truncation, no filtering", () => {
    for (const n of [0, 1, 7, 250]) {
      const rows = Array.from({ length: n }, (_, i) => ({ open: i, resolved: n - i }));
      const model = chartTableModel({
        columns: [
          { key: "open", label: "Open" },
          { key: "resolved", label: "Resolved" },
        ],
        rows,
      });
      expect(model.rows).toHaveLength(n);
      expect(model.rows.every((r) => r.length === 2)).toBe(true);
    }
  });

  it("the survival model carries the risk set the canvas cannot say, one row per step", () => {
    const model = survivalTableModel([
      { t: 7, s: 0.9, atRisk: 10, events: 1 },
      { t: 21, s: 0.45, atRisk: 8, events: 4 },
    ]);
    expect(model.columns.map((c) => c.label))
      .toEqual(["Weeks", "Days", "Still open", "At risk", "Closed here"]);
    expect(model.rows).toEqual([
      ["1.0", "7.0 d", "90.0%", "10", "1"],
      ["3.0", "21.0 d", "45.0%", "8", "4"],
    ]);
  });

  it("an empty curve is an empty table, not a row of zeroes", () => {
    expect(survivalTableModel([]).rows).toEqual([]);
    expect(survivalTableModel(null).rows).toEqual([]);
  });
});

describe("a long chart table pages, and paging does not narrow the population", () => {
  it("a table at or under the default page size is offered no pager at all", () => {
    expect(chartTablePaged(0)).toBe(false);
    expect(chartTablePaged(1)).toBe(false);
    expect(chartTablePaged(DEFAULT_PAGE_SIZE)).toBe(false);
    expect(chartTablePaged(DEFAULT_PAGE_SIZE + 1)).toBe(true);
    expect(chartTablePaged(130)).toBe(true);
  });

  it("every page concatenated is the model, in the model's own order — pinned on the "
    + "130-row Kaplan-Meier shape this app's own MTTR survival curve and by-severity fan use", () => {
    const curve = Array.from({ length: 130 }, (_, i) => ({ t: i + 1, s: 1 - i / 200 }));
    const model = survivalTableModel(curve);
    expect(model.rows).toHaveLength(130);

    for (const size of [15, 25, 50, 100, 250]) {
      const seen = [];
      let pageCount = null;
      for (let p = 0; ; p++) {
        const view = pageOf(model.rows, p, size);
        pageCount = view.pageCount;
        seen.push(...view.rows);
        if (p >= view.pageCount - 1) break;
      }
      expect(seen, `at ${size} / page`).toEqual(model.rows);
      expect(pageCount).toBe(Math.ceil(130 / size));
    }
  });
});
