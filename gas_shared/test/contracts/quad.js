// `ui/quad.js` — two yes/no questions crossed, and the four counts that answer them.
//
// WHY THIS IS A CONTRACT AND NOT AN APP TEST. Two of the three registers already draw a 2x2
// (the secrets register's removed-versus-rotated cross; the program lane's confusion matrix),
// and they drew it as two different five-column tables with two different prose columns. The
// arithmetic — which corner is which, what a share is read against, what an unmeasured corner
// says — is one rule, and running it against every app that registers this file is what stops
// it becoming two rules again.
//
// THREE GUARDS, EACH PERTURBED INLINE. A guard that fires on nothing is a finding (CLAUDE.md),
// so each case below reproduces the tempting wrong version beside the shipped one and shows
// the two disagreeing on the same input:
//
//   1. ABSENT IS NEVER ZERO. `Number(null)` is 0 and finite, so `count / total` computed after
//      a bare cast gives an unmeasured corner a real 0.0% share and a real "0" to print.
//   2. TONE NEVER TRAVELS ALONE. A corner painted `bad` with no word is a cell whose only
//      meaning is its fill — the exact thing DESIGN.md's accessibility bar forbids.
//   3. THE SHARES ARE READ AGAINST THE STATED TOTAL, not against the sum of the corners. Those
//      two are the same number only when the 2x2 partitions the population, and a caller whose
//      cross covers a SUBSET (the program lane's matrix leaves unclassified rows outside it)
//      would otherwise get shares that sum to 1 over a population that is not the register.
//
// The DOM half gets source-text assertions rather than a render: these apps have no jsdom, and
// the claims worth holding here — real `<th scope>` axes, no severity spelling — are properties
// of the module rather than of any one output.

import { readFileSync } from "node:fs";

import { code } from "./emptyStates.js";

// Comment-stripped, for the reason emptyStates.js states once: every module header in
// this package explains its prohibition by QUOTING it, so a raw-text sweep fails on the
// sentence that states the rule rather than on a violation of it.
const QUAD_SRC = code(readFileSync(new URL("../../ui/quad.js", import.meta.url), "utf8"));

/** A complete, valid spec — every case below starts from this and perturbs one thing. */
function baseSpec(overrides) {
  return Object.assign({
    rows: { label: "Out of HEAD", yes: "Removed", no: "Still there" },
    cols: { label: "Credential dead", yes: "Confirmed dead", no: "Not confirmed" },
    total: 100,
    unit: "secrets",
    cells: [
      { row: true, col: true, count: 40, label: "Rotated", tone: "ok" },
      { row: true, col: false, count: 25, label: "Removed, not rotated", tone: "bad" },
      { row: false, col: true, count: 10, label: "Dead but still committed", tone: "warn" },
      { row: false, col: false, count: 25, label: "Live and committed" },
    ],
  }, overrides || {});
}

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {string}   ctx.app
 * @param {Function} ctx.quadModel  the module under test, handed over rather than imported by
 *   a fixed relative path — this contract is registered from three different depths and a
 *   hard-coded "../../gas_shared/ui/quad.js" would resolve to nothing from the wrong one.
 */
export function registerQuadContract(ctx) {
  const { describe, it, expect, app, quadModel } = ctx;

  describe(app + ": quadModel() orders the four corners and prices them", () => {
    it("returns the corners in one fixed order, whatever order the caller gave them", () => {
      const shuffled = baseSpec().cells.slice().reverse();
      const m = quadModel(baseSpec({ cells: shuffled }));
      expect(m.corners.map((c) => [c.row, c.col])).toEqual([
        [true, true], [true, false], [false, true], [false, false],
      ]);
      expect(m.corners.map((c) => c.count)).toEqual([40, 25, 10, 25]);
    });

    it("shares are read against the stated total and sum to 1 when the cross partitions it", () => {
      const m = quadModel(baseSpec());
      const sum = m.corners.reduce((a, c) => a + c.share, 0);
      expect(sum).toBeCloseTo(1, 10);
      expect(m.corners[0].share).toBeCloseTo(0.4, 10);
      expect(m.corners[0].shareText).toBe("40.0%");
    });

    // GUARD 3, PERTURBED. A cross that covers a SUBSET of the register — the program lane's
    // confusion matrix leaves unclassified rows outside it — must not renormalise onto its own
    // corners, or it reports 100% coverage of a population it only partly measured.
    it("PERTURBATION PROOF: shares over the corner SUM would claim the whole population", () => {
      const subset = baseSpec({ total: 200 });
      const m = quadModel(subset);
      const overSum = m.corners.map((c) => c.count / 100); // the defective renormalisation
      expect(overSum.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
      expect(m.corners.reduce((a, c) => a + c.share, 0)).toBeCloseTo(0.5, 10);
      expect(m.corners[0].shareText).toBe("20.0%");
    });

    it("states each corner as \"N of M <unit>\"", () => {
      const m = quadModel(baseSpec());
      expect(m.corners[0].text).toBe("40 of 100 secrets");
      const noUnit = quadModel(baseSpec({ unit: "" }));
      expect(noUnit.corners[0].text).toBe("40 of 100");
    });
  });

  describe(app + ": quadModel() — absent is never zero (failure of presence)", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["an array", []],
      ["false", false],
      ["an object", {}],
    ])("a count of %s is the absent dash, contributes no share, and says \"not measured\"",
      (_label, bad) => {
        const m = quadModel(baseSpec({
          cells: baseSpec().cells.map((c, i) => (i === 3 ? { ...c, count: bad } : c)),
        }));
        const corner = m.corners[3];
        expect(corner.count).toBeNull();
        expect(corner.measured).toBe(false);
        expect(corner.countText).toBe("—");
        expect(corner.share).toBeNull();
        expect(corner.shareText).toBe("—");
        expect(corner.text).toBe("not measured");
      });

    // GUARD 1, PERTURBED. The tempting body is `const n = Number(cell.count); … n / total`,
    // and `Number(null)` / `Number("")` / `Number([])` / `Number(false)` are all `0` AND
    // finite — so every one of those unmeasured corners prints a confident "0" over a "0.0%",
    // which is a measurement nobody made.
    it("PERTURBATION PROOF: a cast-first share reads null/blank/[]/false as a measured 0", () => {
      function castFirstDefective(count, total) {
        const n = Number(count); // the anti-pattern: cast BEFORE refusing
        return Number.isFinite(n) ? { count: n, share: n / total } : { count: null, share: null };
      }
      for (const bad of [null, "", [], false]) {
        const wrong = castFirstDefective(bad, 100);
        expect(wrong.count, JSON.stringify(bad)).toBe(0);
        expect(wrong.share, JSON.stringify(bad)).toBe(0);

        const m = quadModel(baseSpec({
          cells: baseSpec().cells.map((c, i) => (i === 0 ? { ...c, count: bad } : c)),
        }));
        expect(m.corners[0].count, JSON.stringify(bad)).toBeNull();
        expect(m.corners[0].share, JSON.stringify(bad)).toBeNull();
      }
    });

    it("a total nobody measured leaves every share null, but keeps every count", () => {
      const m = quadModel(baseSpec({ total: null }));
      expect(m.corners.map((c) => c.share)).toEqual([null, null, null, null]);
      expect(m.corners.map((c) => c.count)).toEqual([40, 25, 10, 25]);
      expect(m.corners[0].text).toBe("40 secrets");
    });

    it("a total of 0 is a measurement and still yields no share — division, not absence", () => {
      const zeroed = baseSpec().cells.map((c) => ({ ...c, count: 0 }));
      const m = quadModel(baseSpec({ total: 0, cells: zeroed }));
      expect(m.corners.map((c) => c.count)).toEqual([0, 0, 0, 0]);
      expect(m.corners.map((c) => c.share)).toEqual([null, null, null, null]);
      expect(m.corners[0].text).toBe("0 of 0 secrets");
    });
  });

  describe(app + ": quadModel() refuses what would draw a lie", () => {
    // GUARD 2, PERTURBED. Drop the word from a toned corner and the model refuses; the
    // "defective" alternative below is what a component that merely defaulted the label to ""
    // would produce — a cell whose entire meaning is a 12% red wash.
    it("PERTURBATION PROOF: a bad-toned corner with no word is refused, not drawn", () => {
      const noWord = baseSpec({
        cells: baseSpec().cells.map((c, i) => (i === 1 ? { ...c, label: "" } : c)),
      });
      function defaultingDefective(cell) {
        return { tone: cell.tone || "neutral", label: cell.label || "" }; // draws a bare tint
      }
      expect(defaultingDefective(noWord.cells[1])).toEqual({ tone: "bad", label: "" });
      expect(() => quadModel(noWord)).toThrow(/tone is never the only carrier/);
    });

    it("a neutral corner owes a word too, with its own reason", () => {
      const noWord = baseSpec({
        cells: baseSpec().cells.map((c, i) => (i === 3 ? { ...c, label: null } : c)),
      });
      expect(() => quadModel(noWord)).toThrow(/every cell needs a short label/);
    });

    it("a missing or duplicated corner is refused — an empty box reads as a measured zero", () => {
      const three = baseSpec({ cells: baseSpec().cells.slice(0, 3) });
      expect(() => quadModel(three)).toThrow(/exactly one cell/);
      const dupe = baseSpec({ cells: [...baseSpec().cells, baseSpec().cells[0]] });
      expect(() => quadModel(dupe)).toThrow(/exactly one cell/);
    });

    it("an unknown tone is refused rather than silently drawn neutral", () => {
      const odd = baseSpec({
        cells: baseSpec().cells.map((c, i) => (i === 0 ? { ...c, tone: "critical" } : c)),
      });
      expect(() => quadModel(odd)).toThrow(/unknown tone/);
    });

    it("an axis missing either answer word is refused — those words are the th's", () => {
      expect(() => quadModel(baseSpec({ rows: { label: "Out of HEAD", yes: "Removed" } })))
        .toThrow(/needs a label and both answer words/);
      expect(() => quadModel(baseSpec({ cols: { label: "", yes: "a", no: "b" } })))
        .toThrow(/needs a label and both answer words/);
    });
  });

  describe(app + ": quadModel() says the whole grid in one sentence", () => {
    it("names both axes, both answer words per corner, and every reading", () => {
      const { aria } = quadModel(baseSpec());
      expect(aria).toContain("Out of HEAD against Credential dead");
      expect(aria).toContain("over 100 secrets");
      for (const word of ["Removed", "Still there", "Confirmed dead", "Not confirmed"]) {
        expect(aria, word).toContain(word);
      }
      for (const reading of [
        "Rotated", "Removed, not rotated", "Dead but still committed", "Live and committed",
      ]) {
        expect(aria, reading).toContain(reading);
      }
      expect(aria).toContain("40 of 100 secrets, 40.0 percent");
    });

    it("an unmeasured corner says so in the sentence rather than reading as a zero", () => {
      const { aria } = quadModel(baseSpec({
        cells: baseSpec().cells.map((c, i) => (i === 2 ? { ...c, count: null } : c)),
      }));
      expect(aria).toContain("Dead but still committed, not measured.");
      expect(aria).not.toContain("Dead but still committed, 0");
    });
  });

  describe(app + ": quadTable() is a real table, and knows nothing about severity", () => {
    it("heads both axes with scoped th's rather than with a grid of divs", () => {
      expect(QUAD_SRC).toContain("scope: \"col\"");
      expect(QUAD_SRC).toContain("scope: \"row\"");
    });

    it("never sets a title attribute — el() throws on one, and this is the ban restated", () => {
      expect(QUAD_SRC).not.toMatch(/\btitle:\s*/);
    });

    // GATE 4/7 REACHES IN HERE. gas_devsecops's secrets page may carry no severity axis in its
    // executable code, and the secrets triage cross is the first caller of this module — so a
    // severity class or helper reaching the shared component would defeat that gate from
    // outside the file it sweeps.
    it("spells no severity class, level or helper anywhere", () => {
      expect(QUAD_SRC).not.toMatch(/\bsev-[A-Za-z]/);
      expect(QUAD_SRC).not.toMatch(/sevbar|sevBadge|sevKeyRow|sevSegmentBar|SEVERITY_/);
      expect(QUAD_SRC).not.toMatch(/\bCRITICAL\b|\bHIGH\b|\bMEDIUM\b/);
    });

    it("pairs every data-tone with the corner's own word, in the same node", () => {
      // The renderer writes `data-tone` and the label together; the model has already refused
      // any corner that has one without the other (above), so the pairing cannot be broken
      // from a call site — only from this file, which is what this line watches.
      expect(QUAD_SRC).toMatch(/"data-tone": corner\.tone/);
      expect(QUAD_SRC).toMatch(/class: "quad-label"/);
    });
  });
}
