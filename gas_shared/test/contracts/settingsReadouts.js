// `ui/settingsReadouts.js` — what a Settings control is doing to the register, right now.
//
// FIVE CLAIMS, EACH ONE A GUARD gas's original file either stated in prose or never had a test
// for at all:
//
//   1. ZERO OF ZERO IS UNMEASURED, NOT ZERO PERCENT. gas's old `pct(n, total)` returned
//      `"0.0%"` for a zero denominator; `impactSplitModel` returns `absentText` for the share
//      and drops the parenthetical from the headline entirely — the one deliberate pixel this
//      package's promotion moved in gas.
//   2. `[]` MEANS ALL, NEVER NONE, in a register that says so — `severitySplitModel`'s
//      `inScope` is a PREDICATE for exactly this reason. The perturbation below reproduces the
//      tempting `(sev) => selected.includes(sev)` shim inline and shows it drawing the wrong
//      bar on gas_devsecops's own empty-selection-means-all default.
//   3. FILL IS NEVER THE ONLY CUE. `tickTimeline` refuses a state that carries a glyph with no
//      word, the same rule `quadTable` applies to a toned corner with no label.
//   4. THE RANGE INPUT IS BUILT ONCE. `createCutHistogram`'s own header states why — the range
//      fires `input` continuously while dragged, and replacing the node mid-drag silently
//      aborts it. Today that rule existed only as a paragraph in two files (gas's
//      `createRiskReadout` and this module); the identity assertion below is the first place
//      it is checked rather than merely claimed.
//   5. `openAndTotal`'s suppression — moved here from gas/test/settingsReadouts.test.js, now
//      that the function itself lives in gas_shared/ui/figures.js.

import { absentText, num } from "../../ui/figures.js";
import { find, findAll, findTag, installDomStub, text } from "../domStub.js";

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {Function} ctx.beforeAll
 * @param {Function} ctx.afterAll
 * @param {string}   ctx.app
 * @param {Function} ctx.impactSplitModel
 * @param {Function} ctx.severitySplitModel
 * @param {Function} ctx.tickTimeline
 * @param {Function} ctx.createCutHistogram
 * @param {Function} ctx.openAndTotal
 */
export function registerSettingsReadoutsContract(ctx) {
  const {
    describe, it, expect, beforeAll, afterAll, app,
    impactSplitModel, severitySplitModel, tickTimeline, createCutHistogram, openAndTotal,
  } = ctx;

  // ============================================================================ impact split
  describe(app + ": impactSplitModel() — zero of zero is unmeasured, not zero percent", () => {
    const base = {
      count: 43, total: 6842, unit: "findings", phrase: "have no vendor fix available",
      includedLabel: "Has a vendor fix", excludedLabel: "No vendor fix",
      on: true, onNote: "on", offNote: "off",
    };

    it("prints the share and the parenthetical when the population is measured", () => {
      const m = impactSplitModel(base);
      expect(m.headline).toBe("43 of 6,842 open findings (0.6%) have no vendor fix available.");
    });

    it("PERTURBATION PROOF: a zero denominator is absentText, and the headline drops the "
      + "parenthetical rather than printing \"(0.0%)\" or \"(—)\"", () => {
      const zeroDefective = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}%` : "0.0%");
      expect(zeroDefective(0, 0)).toBe("0.0%"); // the old, wrong shape

      const m = impactSplitModel({ ...base, count: 0, total: 0 });
      expect(m.headline).toBe("0 of 0 open findings have no vendor fix available.");
      expect(m.headline).not.toContain("(");
      expect(m.headline).not.toContain(absentText);
    });

    it("refuses a missing unit rather than defaulting it", () => {
      for (const bad of [undefined, null, ""]) {
        expect(() => impactSplitModel({ ...base, unit: bad })).toThrow(/unit/);
      }
    });

    it("picks the note by `on` without composing it — the caller's own sentence, verbatim", () => {
      expect(impactSplitModel({ ...base, on: true, onNote: "A", offNote: "B" }).note).toBe("A");
      expect(impactSplitModel({ ...base, on: false, onNote: "A", offNote: "B" }).note).toBe("B");
    });

    it("builds an in/out segment pair splitBar can draw directly", () => {
      const m = impactSplitModel(base);
      expect(m.segments).toEqual([
        { label: "Has a vendor fix", value: 6799, tone: "in" },
        { label: "No vendor fix", value: 43, tone: "out" },
      ]);
    });
  });

  // ========================================================================= severity split
  describe(app + ": severitySplitModel() — inScope is a predicate, never a selected array", () => {
    const spec = {
      selectable: ["CRITICAL", "HIGH", "MEDIUM"],
      bySeverityOpen: { CRITICAL: 10, HIGH: 5, MEDIUM: 2 },
      bySeverityAll: { CRITICAL: 12, HIGH: 5, MEDIUM: 4 },
      openTotal: 17, total: 21, outLabel: "Not scanned", unit: "findings",
    };

    it("draws every selectable severity in scope when inScope always answers true", () => {
      const m = severitySplitModel({ ...spec, inScope: () => true });
      expect(m.inScopeCount).toBe(17);
      expect(m.segments.find((s) => s.tone === "out").value).toBe(0);
    });

    it("PERTURBATION PROOF: the naive Array#includes shim reads an empty selection as NONE "
      + "in scope and draws a bar that is 100% \"not requested\", inverting a register whose "
      + "own default is that [] means every severity", () => {
      const selected = []; // gas_devsecops's own empty-selection-means-all shape
      const naiveInScope = (sev) => selected.includes(sev); // the tempting, wrong shim

      const wrong = severitySplitModel({ ...spec, inScope: naiveInScope });
      expect(wrong.inScopeCount).toBe(0);
      expect(wrong.segments.find((s) => s.tone === "out").value).toBe(17);

      // The register's OWN rule — empty selection means every severity is in scope — expressed
      // as the predicate this module actually requires, and it draws the opposite bar.
      const correctInScope = (sev) => selected.length === 0 || selected.includes(sev);
      const right = severitySplitModel({ ...spec, inScope: correctInScope });
      expect(right.inScopeCount).toBe(17);
      expect(right.segments.find((s) => s.tone === "out").value).toBe(0);
    });

    it("refuses an inScope that is not a function — an array would silently invert the "
      + "empty-selection default rather than fail", () => {
      expect(() => severitySplitModel({ ...spec, inScope: [] })).toThrow(/predicate/);
      expect(() => severitySplitModel({ ...spec, inScope: undefined })).toThrow(/predicate/);
    });

    it("refuses a missing unit rather than defaulting it", () => {
      expect(() => severitySplitModel({ ...spec, inScope: () => true, unit: "" }))
        .toThrow(/unit/);
    });

    it("names every severity's figures in the caption, including the out-of-scope ones", () => {
      const m = severitySplitModel({ ...spec, inScope: (sev) => sev !== "MEDIUM" });
      expect(m.caption).toContain("MEDIUM");
      expect(m.caption).toContain("not scanned");
    });
  });

  // ============================================================================ tick timeline
  describe(app + ": tickTimeline() — fill is never the only cue", () => {
    // The refusal itself runs before tickTimeline ever touches `document` (see its own
    // header), so it needs no stub — but a call that does NOT throw falls through to el(),
    // which does, so the stub covers this whole block rather than one test inside it.
    let uninstall;
    beforeAll(() => { uninstall = installDomStub(); });
    afterAll(() => uninstall());

    it("PERTURBATION PROOF: a state with a glyph and no word is refused, not drawn", () => {
      expect(() => tickTimeline({
        ticks: [{ state: "sealed" }],
        states: { sealed: { glyph: "✓", word: "" } },
      })).toThrow(/glyph but no word/);
    });

    it("a state with no glyph at all needs no word — there is nothing to pair", () => {
      expect(() => tickTimeline({
        ticks: [{ state: "plain" }],
        states: { plain: { glyph: "", word: "" } },
      })).not.toThrow();
    });

    it("draws every tick, the legend and the summary, and names the ariaLabel", () => {
      // No `hint` on either tick here: a hint routes through tipAnchor(), which wires a real
      // `document.addEventListener` on first use — a browser behaviour this repo's domStub
      // deliberately does not grow to cover (see domStub.js's own header, "must not grow into
      // one"). gas's real retention ticks DO carry hints, exercised in the actual browser.
      const node = tickTimeline({
        ticks: [{ state: "sealed" }, { state: "would" }],
        states: { sealed: { glyph: "✓", word: "sealed" }, would: { glyph: "→", word: "would seal" } },
        legend: "the legend",
        summary: "the summary",
        ariaLabel: "the label",
      });
      const track = find(node, "tick-timeline");
      expect(track.getAttribute("aria-label")).toBe("the label");
      const ticks = findAll(node, "tick-timeline__tick");
      expect(ticks).toHaveLength(2);
      expect(text(node)).toContain("the legend");
      expect(text(node)).toContain("the summary");
    });
  });

  // =========================================================================== cut histogram
  describe(app + ": createCutHistogram() — the range input is built exactly once", () => {
    let uninstall;
    beforeAll(() => { uninstall = installDomStub(); });
    afterAll(() => uninstall());

    it("never recreates the <input type=range> across repeated update() calls", () => {
      const hist = createCutHistogram({
        min: 0, max: 1, step: 0.01, buckets: 4, ariaLabel: "cut",
        format: (v) => v.toFixed(2),
      });
      const before = findTag(hist.node, "input")[0];
      expect(before).toBeTruthy();

      hist.update({ counts: [1, 2, 3, 4], cut: 0.1 });
      hist.update({ counts: [4, 3, 2, 1], cut: 0.5 });
      hist.update({ counts: [0, 0, 0, 0], cut: 0.9 });

      const after = findTag(hist.node, "input")[0];
      expect(after).toBe(before);
    });

    it("rewrites the range's own value and the unmeasured line on update", () => {
      const hist = createCutHistogram({
        min: 0, max: 1, step: 0.01, buckets: 4, ariaLabel: "cut",
        format: (v) => v.toFixed(2),
      });
      hist.update({ counts: [1, 2, 3, 4], cut: 0.25, unmeasuredNote: "7 unmeasured." });
      const input = findTag(hist.node, "input")[0];
      expect(input.value).toBe("0.25");
      expect(text(find(hist.node, "cut-hist__unmeasured"))).toBe("7 unmeasured.");

      hist.update({ counts: [4, 3, 2, 1], cut: 0.75, unmeasuredNote: "" });
      expect(input.value).toBe("0.75");
      expect(text(find(hist.node, "cut-hist__unmeasured"))).toBe("");
    });

    it("refuses an unknown scale rather than silently drawing linear", () => {
      expect(() => createCutHistogram({
        min: 0, max: 1, step: 0.01, buckets: 4, ariaLabel: "cut", format: (v) => String(v),
        scale: "log",
      })).toThrow(/scale/);
    });
  });

  // ============================================================================= openAndTotal
  describe(app + ": openAndTotal() — the open figure leads, the total drops when it repeats", () => {
    it("leads with the open figure and carries the total behind it", () => {
      expect(openAndTotal(43, 57)).toBe("43 (57 all time)");
    });

    it("drops the second figure entirely when it would repeat the first", () => {
      expect(openAndTotal(6, 6)).toBe("6");
      expect(openAndTotal(0, 0)).toBe("0");
    });

    it("takes a caller-supplied unit, so a caption can read in its own words", () => {
      expect(openAndTotal(2, 9, "in the register")).toBe("2 (9 in the register)");
    });

    it("groups thousands, matching every other figure on the page", () => {
      expect(openAndTotal(1204, 6842)).toBe("1,204 (6,842 all time)");
    });

    it("treats a missing count as zero rather than rendering undefined", () => {
      expect(openAndTotal(undefined, undefined)).toBe("0");
      expect(openAndTotal(0, 12)).toBe("0 (12 all time)");
    });

    // The resolved population can only add to the total, so open should never exceed it. If it
    // somehow does, say something honest rather than silently collapsing to the suppressed form.
    it("still shows both when open somehow exceeds the total", () => {
      expect(openAndTotal(5, 3)).toBe("5 (3 all time)");
    });

    it("refuses null/[]/false BEFORE casting — num()'s own allowlist, not a bare `|| 0`", () => {
      for (const bad of [null, "", [], false]) {
        expect(num(bad, 0)).toBe(0);
      }
      expect(openAndTotal(null, 10)).toBe("0 (10 all time)");
    });
  });
}
