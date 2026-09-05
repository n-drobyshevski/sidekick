// THE DATA-TABLE ALTERNATIVE UNDER EVERY CANVAS, and the two ways it can silently stop
// being one.
//
// This project's vitest run sets no `environment` (see vitest.config.ts), so there is no
// jsdom and no `document` — which is exactly why `ui/chartTable.js` keeps its pure half
// bigger than its DOM half. `chartTableModel` does all of the FORMATTING, and formatting is
// where the load-bearing mistake lives: CLAUDE.md's `Number(null)` rule ("absent is never
// zero") has already bitten this repo twice, once in `cleanSettings` and once in a client
// `num(v, fallback)` helper that rendered every genuinely-null figure as a confident `0`.
// A chart draws a gap for a null; a table that printed `0` in the same cell would be
// asserting a measurement nobody made, right beside the chart that refused to.
//
// The second failure mode is a canvas that never gets a table at all — which is the defect
// this package was opened for, and which comes back the moment somebody adds a ninth chart.
// That one cannot be caught by calling anything, so it is checked over the pages' SOURCE
// TEXT, comment-stripped by the same `code()` shape `pagesLit.test.js` and
// `pagesRegisters.test.js` already use.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { chartTableModel, survivalTableModel } from "../../gas_shared/ui/chartTable.js";

// ------------------------------------------------------------------ the comment stripper

/**
 * The file with its `//` comments removed — string-aware, so a comment marker inside a
 * quoted string survives. Copied from `test/pagesLit.test.js`'s `code()`, which copied it
 * from `test/pagesRegisters.test.js`; both of those are protected files this package may not
 * edit, so this is a third copy rather than a shared import.
 *
 * IT MATTERS HERE FOR THE SAME REASON IT MATTERS THERE: `ui/chartTable.js`'s own prose and
 * several page comments NAME `el("canvas"` and `chartTable(` while explaining the rule, and
 * a raw-text count would be thrown off by the sentence that states it.
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

describe("chartTableModel never renders an absent figure as a confident zero", () => {
  // PERTURBATION (run 2026-09-04, then reverted): `FORMATTERS.count` in
  // src/client/js/ui/chartTable.js was changed from `fmtCount` to
  // `(v) => String(Number(v) || 0)` — the shape of the defect `ui/figures.js`'s own header
  // documents, where `Number(null)` is `0` and `0` is finite. Observed:
  //
  //   FAIL  test/chartTable.test.js > ... > a null cell renders as an em dash, not as 0
  //     AssertionError: expected '0' to be '—' // Object.is equality
  //      ❯ test/chartTable.test.js  expect(model.rows[1][1]).toBe("—");
  //
  //   Test Files  1 failed | ... ; Tests  1 failed | 3 passed (in this describe block)
  //
  // The zero case below stayed GREEN under the perturbation, which is the point of having
  // both: only the pair distinguishes "formats nulls correctly" from "prints an em dash for
  // everything falsy".
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

  it("the num1 format (a unit-less column whose heading carries the unit) refuses null too", () => {
    const m = chartTableModel({
      columns: [{ key: "weeks", label: "Weeks", format: "num1" }],
      rows: [{ weeks: 0 }, { weeks: null }, { weeks: 2.5 }],
    });
    expect(m.rows.map((r) => r[0])).toEqual(["0.0", "—", "2.5"]);
  });

  it("an absent LABEL is an em dash as well — a blank cell would read as a drawn blank bar", () => {
    const m = chartTableModel({
      columns: [{ key: "label", label: "Repository", format: "text" }],
      rows: [{ label: "" }, { label: null }, { label: "repo-a" }],
    });
    expect(m.rows.map((r) => r[0])).toEqual(["—", "—", "repo-a"]);
  });
});

// =========================================================================================
//  2. Every canvas in every page has a table beside it
// =========================================================================================

describe("every chart canvas ships a data-table alternative", () => {
  // PERTURBATION (run 2026-09-04, then reverted): a ninth canvas was added to
  // src/client/js/pages/executive.js — `const perturb = el("canvas");` — a page that draws
  // no chart and therefore builds no table. Observed:
  //
  //   FAIL  test/chartTable.test.js > ... > each page builds exactly one chartTable per canvas
  //     AssertionError: executive.js builds 1 canvas(es) and 0 chartTable(s): expected 0 to be 1
  //      ❯ test/chartTable.test.js
  //
  // PER-FILE COUNTS, not a nearest-enclosing-function scan, because the counts are what
  // actually bite: every one of the five files that draws a canvas draws it in the same
  // function that builds its table, and an approximate function-body parser over arrow
  // chains and `.then()` callbacks would be a second, worse parser to maintain. A file that
  // gained a canvas without a table fails here whichever function it was added to.
  it("each page builds exactly one chartTable per canvas", () => {
    for (const file of PAGE_FILES) {
      const src = PAGE_CODE[file];
      const canvases = count(src, /el\("canvas"/g);
      const tables = count(src, /\bchartTable\(/g);
      expect(
        tables,
        `${file} builds ${canvases} canvas(es) and ${tables} chartTable(s)`,
      ).toBe(canvases);
    }
  });

  it("the register still draws the ten canvases it composes, counted so a deletion shows", () => {
    // A count, so a canvas DELETED to make the test above pass is visible as a change here
    // rather than as a silent green.
    //
    // 8 -> 9 (W1, the per-severity survival fan). The ninth canvas is ONE `el("canvas"`
    // literal in mttr.js, inside the loop that builds the fan under "The clock, by severity"
    // — one card, and therefore one drawn canvas, per severity present in
    // `remediation.kmPerSev`, so the SOURCE count moves by one however many cards render.
    // The claim above is untouched by that: this number moves only when a chart is added or
    // removed ON PURPOSE, and a canvas quietly deleted to satisfy the per-file rule still
    // shows up here as a change rather than as a silent green.
    //
    // 9 -> 10 (W2, the open-findings-by-age stack). The tenth canvas is the aging bar in
    // mttr.js, under "Open findings by age" between the SLA table and the time-to-close
    // distribution — one `el("canvas"` literal, one drawn chart, one `chartTable` beside it.
    const total = PAGE_FILES.reduce((n, f) => n + count(PAGE_CODE[f], /el\("canvas"/g), 0);
    expect(total).toBe(10);
  });

  it("every chartTable call is handed the canvas it describes, so aria-details is wired", () => {
    for (const file of PAGE_FILES) {
      const src = PAGE_CODE[file];
      const calls = src.match(/\bchartTable\(\{[\s\S]{0,120}/g) || [];
      for (const call of calls) {
        expect(call, `${file}: a chartTable call names no canvas`).toMatch(/canvas/);
      }
    }
  });
});

// =========================================================================================
//  3. The model lists the whole series
// =========================================================================================

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

  it("keeps the input order rather than sorting behind the chart's back", () => {
    const model = chartTableModel({
      columns: [{ key: "y", label: "Half-life", format: "days" }],
      rows: [{ y: 9 }, { y: 3 }, { y: 40 }],
    });
    expect(model.rows.map((r) => r[0])).toEqual(["9.0 d", "3.0 d", "40.0 d"]);
  });

  it("the survival model carries the risk set the canvas cannot say, one row per step", () => {
    // KMPoint is {t, s, atRisk, events} (src/domain/remediation.ts) — there is NO per-point
    // censor count on it, so the model publishes `atRisk` and `events`, which the estimator
    // really recorded, rather than inventing one. This is the SECRETS page's shape: it reads
    // `ttr.km.curve` straight off the domain result, so all four fields survive.
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

  it("and drops those two columns where the payload never shipped them", () => {
    // MEASURED, 2026-09-04 on `#/mttr` at the dev seed: `readModels.ts::shipKM` narrows the
    // curve to `{t, s}`, so the first draft of this model rendered an em dash in "At risk"
    // and "Closed here" on all 130 rows. Two columns that CANNOT be anything but an em dash
    // are not an honest absence — they assert a measurement that was never on the wire. The
    // three columns the payload does carry stay exactly as they are.
    const model = survivalTableModel([{ t: 7, s: 0.9 }, { t: 21, s: 0.45 }]);
    expect(model.columns.map((c) => c.label)).toEqual(["Weeks", "Days", "Still open"]);
    expect(model.rows).toEqual([["1.0", "7.0 d", "90.0%"], ["3.0", "21.0 d", "45.0%"]]);
  });

  it("an empty curve is an empty table, not a row of zeroes", () => {
    expect(survivalTableModel([]).rows).toEqual([]);
    expect(survivalTableModel(null).rows).toEqual([]);
  });
});

// =========================================================================================
//  4. The hero severity bar has a key, and disappears rather than drawing an empty box
// =========================================================================================

describe("the SCA and SAST hero bars carry a key, and nothing at all at zero", () => {
  // PERTURBATION (run 2026-09-04, then reverted): the `sevKeyRow(heroSevs),` line was deleted
  // from `paintSca` in src/client/js/pages/sca.js. Observed:
  //
  //   FAIL  test/chartTable.test.js > ... > sca.js pairs the hero bar with a key row, behind
  //         a zero-total guard
  //     AssertionError: sca.js draws sevSegmentBar with no sevKeyRow beside it, or outside a
  //     zero-total guard: expected 'const heroSevs = sevEntries(vm.counts…' to match /…/
  //
  // The bar is COLOUR AND NOTHING ELSE without the key — five segments, no counts — which is
  // the one thing DESIGN.md rules out outright; and with no guard an empty ledger draws an
  // empty bordered rectangle that reads as a broken widget rather than as "nothing open".
  for (const file of ["sca.js", "sast.js"]) {
    it(`${file} pairs the hero bar with a key row, behind a zero-total guard`, () => {
      const src = PAGE_CODE[file];
      const decl = src.match(/const (\w+) = sevEntries\([\s\S]*?\);/);
      expect(decl, `${file} does not name its hero severity entries once`).toBeTruthy();
      const name = decl[1];
      const guarded = new RegExp(
        `${name}\\.length\\s*\\?\\s*\\[[\\s\\S]*?sevSegmentBar\\(${name}`
        + `[\\s\\S]*?sevKeyRow\\(${name}\\)[\\s\\S]*?\\]\\s*:\\s*null`,
      );
      expect(
        src,
        `${file} draws sevSegmentBar with no sevKeyRow beside it, or outside a zero-total guard`,
      ).toMatch(guarded);
    });

    it(`${file} builds those entries exactly once, so the bar and the key cannot disagree`, () => {
      expect(count(PAGE_CODE[file], /sevEntries\(/g), `${file}`).toBe(1);
    });
  }

  it("secrets keeps no severity axis — it gains neither a hero bar nor a key", () => {
    // The register-wide rule pinned in pagesLit.test.js exit gate 4, restated here because
    // THIS package touched secrets.js (it gained a survival table) and could have carried a
    // severity helper in with it.
    expect(PAGE_CODE["secrets.js"]).not.toMatch(/\bsevSegmentBar\b|\bsevKeyRow\b|\bsevEntries\b/);
  });
});
