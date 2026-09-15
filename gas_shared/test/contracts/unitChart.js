// `ui/unitChart.js` — countable quantity as countable marks, in two layouts.
//
// WHY THIS IS A CONTRACT AND NOT AN APP TEST. The tally shipped in exactly one place — the
// DevSecOps Executive page's open-backlog isotype — and `test/executivePictogram.test.js` held
// its arithmetic there. The moment a second register draws one, "how many marks is this count"
// stops being a fact about that page and becomes a fact about the design system; running it
// against every app that registers this file is what stops it becoming three rules again. The
// cast-first perturbation below IS that file's, carried over intact rather than rewritten,
// because it is the best perturbation in the repo and its value is precisely that it has been
// read and understood already.
//
// FIVE GUARDS, EACH PERTURBED INLINE. A guard that fires on nothing is a finding (CLAUDE.md),
// so each case reproduces the tempting wrong version beside the shipped one and shows the two
// disagreeing on the same input:
//
//   1. REFUSE BEFORE THE CAST. `Number(["3"])` is 3 and `Number("106")` is 106, so a cast-first
//      `unitCounts` draws marks for a value that was never a number, and nothing in the output
//      says so.
//   2. THE UNIT IS PER TABLE, NOT PER ROW. A per-row unit makes 280 and 30 draw the same
//      picture — a bar chart with its axis deleted, which is the one thing marks are drawn
//      INSTEAD of.
//   3. LARGEST REMAINDER, NOT PER-PART ROUNDING. The naive `Math.round(count/total*cells)` is
//      wrong twice over on the same input class: it leaves holes in the lattice (which read as
//      an unmeasured remainder), and it rounds a small-but-real segment to nothing (a measured
//      category drawn as absent — `sparkline.js`'s cast-first defect, in grid form).
//   4. THE SHARES ARE READ AGAINST THE STATED TOTAL, not against the sum of the segments. Those
//      are the same number only when the segments partition the population, and every register
//      here has one they do not — out-of-scope assets, unattributable rows, unobserved repos.
//   5. A FILL IS NEVER THE FIRST CUE. A segment painted `bad` with no word is a cell whose only
//      meaning is its colour, which DESIGN.md's accessibility bar forbids outright.
//
// The DOM half gets source-text assertions rather than a render: these apps have no jsdom, and
// the claims worth holding here — the `.isotype` class the density walker counts, no severity
// spelling — are properties of the module rather than of any one output.

import { readFileSync } from "node:fs";

import { code } from "./emptyStates.js";

// Comment-stripped, for the reason emptyStates.js states once: this module's header explains
// its prohibitions by QUOTING them, so a raw-text sweep would fail on the sentence stating the
// rule rather than on a violation of it.
const SRC = code(readFileSync(new URL("../../ui/unitChart.js", import.meta.url), "utf8"));

/**
 * @param {{describe, it, expect, app: string,
 *          unitScale, unitCounts, unitChartModel,
 *          COUNT_UNITS?, FINE_UNITS?, MAX_MARKS?, MAX_EXACT_CELLS?}} ctx
 */
export function registerUnitChartContract(ctx) {
  const {
    describe, it, expect, app,
    unitScale, unitCounts, unitChartModel,
    COUNT_UNITS, MAX_MARKS = 40, MAX_EXACT_CELLS = 144,
  } = ctx;

  const where = `unitChart contract (${app})`;

  // =======================================================================================
  //  1. unitScale — one unit for the whole table
  // =======================================================================================

  describe(`${where}: unitScale — one unit per table`, () => {
    it("40 open picks unit 10", () => {
      expect(unitScale(40)).toBe(10);
    });

    it("401 open picks unit 20", () => {
      // 401 / 10 is 40.1, one tenth of a mark over the ceiling — the ladder steps rather than
      // letting the biggest row run past MAX_MARKS.
      expect(unitScale(401)).toBe(20);
      expect(unitScale(400)).toBe(10);
    });

    it("18 800 open picks unit 500", () => {
      // The live SCA register's order of magnitude: 18 800 / 500 is 37.6 marks.
      expect(unitScale(18800)).toBe(500);
    });

    it("a non-finite maximum falls back to the finest rung", () => {
      for (const bad of [null, undefined, "", [], false, NaN, Infinity, "400", ["400"]]) {
        expect(unitScale(bad)).toBe(10);
      }
      // Non-positive is the same refusal: there is no table to size against.
      expect(unitScale(0)).toBe(10);
      expect(unitScale(-50)).toBe(10);
    });

    it("the largest row still fits inside MAX_MARKS at the unit it picks", () => {
      for (const n of [1, 40, 401, 999, 18800, 250000]) {
        expect(n / unitScale(n)).toBeLessThanOrEqual(MAX_MARKS);
      }
    });

    it("a finer ladder is the caller's to name, and is honoured", () => {
      // FINE_UNITS exists because a population of frameworks or scan areas is one a reader can
      // enumerate, and the coarse ladder would draw all of them as one clipped mark.
      expect(unitScale(12, { units: [1, 2, 5, 10] })).toBe(1);
      expect(unitScale(120, { units: [1, 2, 5, 10] })).toBe(5);
    });

    it("the default ladder is the one the Executive page shipped", () => {
      // Named so the promotion cannot be quietly re-tuned: changing this array changes a
      // shipped picture in gas_devsecops with nothing else failing.
      if (COUNT_UNITS) {
        expect(COUNT_UNITS).toEqual([10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]);
      }
    });
  });

  // =======================================================================================
  //  2. unitCounts — whole marks, and how much of one more
  // =======================================================================================

  describe(`${where}: unitCounts — whole marks and tenths`, () => {
    it("0 open draws no marks", () => {
      expect(unitCounts(0, 10)).toEqual({ full: 0, partialTenths: 0 });
    });

    it("9 open at unit 10 is a partial mark and no full one", () => {
      expect(unitCounts(9, 10)).toEqual({ full: 0, partialTenths: 9 });
    });

    it("10 open is one full mark and no partial", () => {
      expect(unitCounts(10, 10)).toEqual({ full: 1, partialTenths: 0 });
    });

    it("106 open is ten full marks and a six-tenths one", () => {
      expect(unitCounts(106, 10)).toEqual({ full: 10, partialTenths: 6 });
    });

    it("280 open is twenty-eight full marks", () => {
      expect(unitCounts(280, 10)).toEqual({ full: 28, partialTenths: 0 });
    });

    it("a remainder that rounds to ten carries into a full mark", () => {
      // 199 at unit 20: nine whole marks and 19/20 of one more, which rounds to ten tenths. Ten
      // tenths IS a full mark — drawing it as a "partial" one would be a mark clipped to 100%,
      // pixel-identical to a full mark and one short in the count.
      expect(unitCounts(199, 20)).toEqual({ full: 10, partialTenths: 0 });
      expect(unitCounts(198, 20)).toEqual({ full: 9, partialTenths: 9 });
    });

    it("a non-finite count draws nothing", () => {
      for (const bad of [null, undefined, "", [], false, NaN, Infinity, -1, "3", ["3"], {}]) {
        expect(unitCounts(bad, 10)).toEqual({ full: 0, partialTenths: 0 });
      }
    });

    it("a non-finite or non-positive unit draws nothing", () => {
      for (const bad of [null, undefined, "", [], false, NaN, 0, -10, "10"]) {
        expect(unitCounts(106, bad)).toEqual({ full: 0, partialTenths: 0 });
      }
    });

    it("the marks always account for the whole count, to within a tenth of a unit", () => {
      const unit = 50;
      for (const n of [1, 49, 50, 51, 137, 999, 18800]) {
        const { full, partialTenths } = unitCounts(n, unit);
        const drawn = (full + partialTenths / 10) * unit;
        expect(Math.abs(drawn - n)).toBeLessThanOrEqual(unit / 20);
      }
    });
  });

  // =======================================================================================
  //  PERTURBATION 1 — cast first, and the refusal stops biting
  //  Carried intact from gas_devsecops/test/executivePictogram.test.js.
  // =======================================================================================

  describe(`${where}: perturbation — cast first`, () => {
    // The defective rewrite, inline, exactly as the "simplify the two branches" edit would
    // leave it: cast first, then let Number.isFinite decide. CLAUDE.md records this same shape
    // biting three times; the point of reproducing it here rather than asserting the rule from
    // a comment is that a future reader can SEE which inputs the two forms disagree about.
    function unitCountsCastFirst(n, unit) {
      const v = Number(n);
      const u = Number(unit);
      if (!Number.isFinite(v) || v <= 0) return { full: 0, partialTenths: 0 };
      if (!Number.isFinite(u) || u <= 0) return { full: 0, partialTenths: 0 };
      const full = Math.floor(v / u);
      const tenths = Math.round((10 * (v % u)) / u);
      return tenths >= 10
        ? { full: full + 1, partialTenths: 0 }
        : { full, partialTenths: Math.max(0, tenths) };
    }

    it("agrees with the guarded form on everything that was really a number", () => {
      for (const n of [0, 1, 9, 10, 106, 198, 199, 280, 18800]) {
        expect(unitCountsCastFirst(n, 10)).toEqual(unitCounts(n, 10));
      }
    });

    it("disagrees on a value that was never a measurement, and that is the whole guard", () => {
      // These four all cast to 0 and are refused by BOTH forms — which is why a refusal set
      // made only of them would pass against the defective rewrite and prove nothing.
      for (const silent of [null, "", [], false]) {
        expect(unitCountsCastFirst(silent, 10)).toEqual({ full: 0, partialTenths: 0 });
        expect(unitCounts(silent, 10)).toEqual({ full: 0, partialTenths: 0 });
      }

      // These are where the two forms part company. `Number(["3"])` is 3: a one-element array
      // of a numeric string casts clean, and the cast-first version draws three tenths of a
      // mark for it. The guarded version refuses it, because it was never a number.
      for (const bites of ["3", ["3"], "106"]) {
        expect(unitCounts(bites, 10)).toEqual({ full: 0, partialTenths: 0 });
        expect(unitCountsCastFirst(bites, 10)).not.toEqual({ full: 0, partialTenths: 0 });
      }
      expect(unitCountsCastFirst(["3"], 10)).toEqual({ full: 0, partialTenths: 3 });
      expect(unitCountsCastFirst("106", 10)).toEqual({ full: 10, partialTenths: 6 });

      // The unit refuses on the same asymmetry: a stringly-typed unit reaches the arithmetic in
      // the cast-first form and silently sizes the whole table.
      expect(unitCounts(106, "10")).toEqual({ full: 0, partialTenths: 0 });
      expect(unitCountsCastFirst(106, "10")).toEqual({ full: 10, partialTenths: 6 });
    });
  });

  // =======================================================================================
  //  PERTURBATION 2 — a unit per row instead of a unit per table
  // =======================================================================================

  describe(`${where}: perturbation — a per-row unit`, () => {
    it("makes two rows an order of magnitude apart draw the same picture", () => {
      const rows = [280, 30];

      // Shipped: one unit for the table, from the biggest row. Every other row draws fewer
      // marks IN THAT UNIT, so the ratio between two rows is the ratio between their counts.
      const tableUnit = unitScale(Math.max(...rows));
      const shipped = rows.map((n) => unitCounts(n, tableUnit).full);
      expect(shipped).toEqual([28, 3]);

      // The tempting rewrite: size each row against itself so every row fills the same width.
      const perRow = rows.map((n) => unitCounts(n, unitScale(n)).full);
      expect(perRow).toEqual([28, 3]);

      // At THIS pair the two forms agree, which is exactly why a test that stopped here would
      // prove nothing. Take a pair that straddles a rung and they part company: 401 and 400
      // are one finding apart and the per-row form draws them at different units, so the
      // smaller row draws MORE marks than the bigger one.
      const straddle = [401, 400];
      const straddleTable = unitScale(Math.max(...straddle));
      const shippedStraddle = straddle.map((n) => unitCounts(n, straddleTable).full);
      const perRowStraddle = straddle.map((n) => unitCounts(n, unitScale(n)).full);
      expect(shippedStraddle).toEqual([20, 20]);
      expect(perRowStraddle).toEqual([20, 40]);
      expect(perRowStraddle[1]).toBeGreaterThan(perRowStraddle[0]);
    });
  });

  // =======================================================================================
  //  3. unitChartModel — the part-to-whole
  // =======================================================================================

  const seg = (label, count, extra) => Object.assign({ label, count }, extra || {});

  describe(`${where}: unitChartModel — the lattice`, () => {
    it("cells sum exactly to the lattice", () => {
      const m = unitChartModel({
        segments: [seg("Cold", 34), seg("Warm", 33), seg("Clear", 33)],
        total: 100, unit: "repositories", cells: 10,
      });
      const drawn = m.segments.reduce((a, s) => a + s.cells, 0)
        + (m.remainder ? m.remainder.cells : 0);
      expect(drawn).toBe(10);
    });

    it("reads every share against the STATED total, not the segments' own sum", () => {
      // Three segments covering 60 of a stated 100: the shares are 30/20/10, and the leftover
      // is a named remainder rather than being absorbed.
      const m = unitChartModel({
        segments: [seg("Cold", 30), seg("Warm", 20), seg("Clear", 10)],
        total: 100, unit: "repositories", cells: 100, remainderLabel: "Unobserved",
      });
      expect(m.segments.map((s) => s.shareText)).toEqual(["30.0%", "20.0%", "10.0%"]);
      expect(m.remainder).toBeTruthy();
      expect(m.remainder.cells).toBe(40);
      expect(m.remainder.count).toBe(40);
      expect(m.remainder.label).toBe("Unobserved");
    });

    it("an unmeasured count is absent, contributes no cells and no share", () => {
      const m = unitChartModel({
        segments: [seg("Cold", 30), seg("Warm", null)],
        total: 100, unit: "repositories", cells: 100,
      });
      expect(m.segments[1].countText).toBe("—");
      expect(m.segments[1].shareText).toBe("—");
      expect(m.segments[1].cells).toBe(0);
    });

    it("a zero denominator is unmeasured, never zero percent", () => {
      for (const bad of [0, null, undefined, "", [], false, NaN, -5, "100"]) {
        const m = unitChartModel({
          segments: [seg("Cold", 30)], total: bad, unit: "repositories",
        });
        expect(m.measured).toBe(false);
        expect(m.segments[0].shareText).toBe("—");
        expect(m.aria).toContain("Not measured");
      }
    });

    it("exact mode is one cell per member and no rounding at all", () => {
      const m = unitChartModel({
        segments: [seg("Live", 7), seg("Partial", 3), seg("Unscanned", 2)],
        total: 12, unit: "scan areas", cells: "exact",
      });
      expect(m.exact).toBe(true);
      expect(m.cells).toBe(12);
      expect(m.segments.map((s) => s.cells)).toEqual([7, 3, 2]);
      expect(m.rounded).toBe(false);
    });

    it("refuses exact mode over a population nobody could count", () => {
      expect(() => unitChartModel({
        segments: [seg("Open", 4000)], total: 4000, unit: "findings", cells: "exact",
      })).toThrow(/exact/);
      // The boundary itself is allowed; one past it is not.
      expect(() => unitChartModel({
        segments: [seg("Open", 1)], total: MAX_EXACT_CELLS, unit: "findings", cells: "exact",
      })).not.toThrow();
    });

    it("refuses a segment with no word", () => {
      // data-tone and data-fill are the second and third cues, never the first.
      expect(() => unitChartModel({
        segments: [{ count: 30, tone: "bad" }], total: 100, unit: "repositories",
      })).toThrow(/label/);
      expect(() => unitChartModel({
        segments: [{ label: "   ", count: 30 }], total: 100, unit: "repositories",
      })).toThrow(/label/);
    });

    it("refuses a tone outside the quad's four, which is what keeps severity out", () => {
      expect(() => unitChartModel({
        segments: [seg("Critical", 30, { tone: "critical" })], total: 100, unit: "findings",
      })).toThrow(/tone/);
    });

    it("refuses a fill outside the three silhouettes", () => {
      expect(() => unitChartModel({
        segments: [seg("Cold", 30, { fill: "stripe" })], total: 100, unit: "repositories",
      })).toThrow(/fill/);
    });

    it("refuses a `unit` it would otherwise have to guess", () => {
      // "findings" is right in two registers and wrong in the third; the same refusal
      // severitySplitModel's own `unit` and diagnostics.js's missingTone already use.
      for (const bad of [undefined, null, "", "   ", 5]) {
        expect(() => unitChartModel({
          segments: [seg("Cold", 30)], total: 100, unit: bad,
        })).toThrow(/unit/);
      }
    });

    it("refuses segments that sum past the stated total", () => {
      // Two overlapping populations read as one partition: the only silent outcomes are a
      // truncated category or a meaningless grid.
      expect(() => unitChartModel({
        segments: [seg("Re-rated", 70), seg("Unclassified", 60)],
        total: 100, unit: "issues",
      })).toThrow(/overlap/);
    });

    it("refuses more segments than a reader can hold keys for", () => {
      const many = ["a", "b", "c", "d", "e", "f", "g"].map((k) => seg(k, 1));
      expect(() => unitChartModel({ segments: many, total: 100, unit: "findings" }))
        .toThrow(/segments/);
    });

    it("states every segment in words in its one aria sentence", () => {
      const m = unitChartModel({
        segments: [seg("Cold", 30), seg("Warm", 20)],
        total: 100, unit: "repositories",
      });
      expect(m.aria).toContain("Of 100 repositories");
      expect(m.aria).toContain("Cold 30 (30.0%)");
      expect(m.aria).toContain("Warm 20 (20.0%)");
    });
  });

  // =======================================================================================
  //  PERTURBATION 3 — per-part rounding instead of largest remainder
  // =======================================================================================

  describe(`${where}: perturbation — per-part rounding`, () => {
    // The tempting one-liner, inline. It is wrong in two independent ways on two different
    // inputs, and both matter, so both are shown.
    const naive = (parts, total, cells) =>
      parts.map((p) => Math.round((p.count / total) * cells));

    it("rounds a small but REAL segment away to nothing", () => {
      const parts = [seg("A", 1), seg("B", 1), seg("C", 98)];
      expect(naive(parts, 100, 10)).toEqual([0, 0, 10]);

      // Two measured categories drawn as nothing, which reads as absent — `sparkline.js`'s
      // cast-first defect wearing a lattice. The shipped model gives each the cell it earned.
      const m = unitChartModel({ segments: parts, total: 100, unit: "findings", cells: 10 });
      expect(m.segments.map((s) => s.cells)).toEqual([1, 1, 8]);
      for (const s of m.segments) expect(s.cells).toBeGreaterThan(0);
    });

    it("leaves a hole in the lattice, which reads as an unmeasured remainder", () => {
      const parts = [seg("A", 34), seg("B", 33), seg("C", 33)];
      expect(naive(parts, 100, 10).reduce((a, b) => a + b, 0)).toBe(9);

      const m = unitChartModel({ segments: parts, total: 100, unit: "findings", cells: 10 });
      expect(m.segments.reduce((a, s) => a + s.cells, 0)).toBe(10);
      expect(m.remainder).toBeNull();
    });
  });

  // =======================================================================================
  //  PERTURBATION 4 — the denominator taken from the segments themselves
  // =======================================================================================

  describe(`${where}: perturbation — a renormalised denominator`, () => {
    it("claims all of a population it only partly measured", () => {
      const segments = [seg("Cold", 30), seg("Warm", 20), seg("Clear", 10)];

      // The rewrite: derive the total from the parts. Every share inflates and they sum to
      // 100% over a population that is 60% measured — the unobserved repositories vanish.
      const derived = segments.reduce((a, s) => a + s.count, 0);
      expect(derived).toBe(60);
      const renormalised = segments.map((s) => (s.count / derived) * 100);
      expect(renormalised.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);

      const m = unitChartModel({
        segments, total: 100, unit: "repositories", remainderLabel: "Unobserved",
      });
      const stated = m.segments.map((s) => s.share);
      expect(stated).toEqual([30, 20, 10]);
      expect(stated.reduce((a, b) => a + b, 0)).toBe(60);
      // And the 40 the renormalised form erased is named rather than absorbed.
      expect(m.remainder.count).toBe(40);
    });
  });

  // =======================================================================================
  //  4. The module itself — source-text claims, since these suites have no jsdom
  // =======================================================================================

  describe(`${where}: the module`, () => {
    it("draws the class the density walker already counts", () => {
      // densityModel.mjs's NAMED_VISUAL_CLASSES holds "isotype". Renaming this would zero the
      // one visual bucket with committed history and make every stored baseline incomparable.
      expect(SRC).toMatch(/"isotype"/);
      expect(SRC).toMatch(/isotype--grid/);
    });

    it("names no severity and imports no severity module", () => {
      // The same source sweep contracts/quad.js runs, for the same reason: gas_devsecops's
      // secrets page is gated against a severity axis in its executable code, and a shared
      // component is exactly the back door such a gate cannot see through.
      expect(SRC).not.toMatch(/severity\.js/);
      expect(SRC).not.toMatch(/sev-fill-|sevBadge|sevSegmentBar|CRITICAL/);
    });

    it("carries no colour literal", () => {
      // Colour belongs in the two token files; this module paints through data-tone/data-fill.
      expect(SRC).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(SRC).not.toMatch(/\brgba?\(/);
    });

    it("carries no backtick in any string that survives minification", () => {
      // THIS ONE BROKE THE BUILD BEFORE IT WAS WRITTEN. esbuild lowers template literals, so
      // backticks in SOURCE are fine and the ones in this module's own comments are stripped
      // by minify — but a backtick CHARACTER inside a string literal survives both, and every
      // app's esbuild.config.mjs fails the build on it (the proxy that guard replays strips
      // comments with a tokenizer that does not understand backticks, and would leave the
      // bundle unbalanced). `code()` has already removed the comments, so what is left here is
      // executable text: any backtick in it is either a template literal esbuild will lower or
      // a string that will fail the build, and this module uses no template literals.
      expect(SRC).not.toMatch(/`/);
    });

    it("wraps each picture in ONE role=img rather than N nodes", () => {
      const roles = SRC.match(/role: "img"/g) || [];
      expect(roles.length).toBe(2); // one for the tally, one for the lattice
    });
  });
}
