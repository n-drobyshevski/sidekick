// THE LINE THAT NAMES THE POPULATION, and the two ways it can lie.
//
// `populationLine` builds one sentence under the Overview hero: how many findings are in
// scope, which severity gate the last scan applied, and which base filters the query carries.
// Both failure modes are quiet ones — the kind that ship because the page still renders:
//
//   - AN EMPTY GATE PRINTED AS A GATE. `parseSeverities` returns null for a full or absent
//     gate, but `[]` and `""` reach this function too (an older payload, a fixture), and
//     `[].join(", ")` is `""`. "gate " with nothing after it reads as a gate whose severities
//     went missing, when the fact is the opposite: nothing was gated out.
//   - A ZERO FOR WHAT THE GATE EXCLUDED. Nothing counted those rows — a scan gated to
//     CRITICAL never fetched a MEDIUM finding — so any number there would be a measurement of
//     a population nobody looked at. CLAUDE.md: "The words on screen are 'below the gate',
//     'not scanned', 'unmeasured' — never a `0`".
//
// Plain .js and pure, for the reason mttrPaintPlan.test.js writes out.

import { describe, expect, it } from "vitest";

import { populationLine, slaConsumedCaption } from "../src/client/js/pages/overviewModel.js";

const FILTERS = ["one Wiz project", "virtual machines only"];

const payload = (population) => ({ flatScan: true, population });

describe("os: populationLine names what was measured", () => {
  it("names the gate when one was applied", () => {
    const line = populationLine(payload({
      inScope: 1204, gate: ["CRITICAL", "HIGH"], filters: FILTERS,
    }));
    expect(line.parts[0]).toBe("In scope 1,204");
    expect(line.parts[1]).toBe("gate CRITICAL, HIGH");
    // The filter words travel verbatim and in order — the server writes them, not this file.
    expect(line.parts.slice(2, 4)).toEqual(FILTERS);
    expect(line.text).toBe(
      "In scope 1,204 · gate CRITICAL, HIGH · one Wiz project · virtual machines only"
      + " · below the gate: not counted",
    );
  });

  it("says 'all severities' rather than printing an empty gate", () => {
    // Three spellings of the same fact, and all three arrive: null from parseSeverities, the
    // empty list from an older payload, the empty string from a hand-written fixture.
    for (const gate of [null, undefined, [], ""]) {
      const line = populationLine(payload({ inScope: 7, gate, filters: FILTERS }));
      expect(line.parts[1], `gate ${JSON.stringify(gate)}`).toBe("gate: all severities");
      expect(line.text).not.toMatch(/gate\s*·/);
      // No gate, nothing kept out by one — the phrase would be a claim about nothing.
      expect(line.parts, `gate ${JSON.stringify(gate)}`).not.toContain(
        "below the gate: not counted",
      );
    }
  });

  it("never prints a zero for what the gate excluded", () => {
    const line = populationLine(payload({
      inScope: 0, gate: ["CRITICAL"], filters: FILTERS,
    }));
    const excluded = line.parts[line.parts.length - 1];
    expect(line.text).toContain("not counted");
    expect(excluded).toBe("below the gate: not counted");
    // The assertion this whole test exists for: the excluded part carries NO digit. An
    // in-scope count of 0 is a measurement and stays; the rows below the gate were never
    // fetched, so there is no number to print and inventing one would state a fact about a
    // population nobody looked at.
    expect(excluded).not.toMatch(/\d/);
    expect(line.parts[0]).toBe("In scope 0");
  });

  it("returns null on a payload with no population block", () => {
    // A cached payload written before `population` existed. Half a sentence — the count with
    // no gate and no filters beside it — states the count as the whole story, which is the
    // reading this line exists to prevent.
    expect(populationLine({ flatScan: true })).toBeNull();
    expect(populationLine({ flatScan: true, population: null })).toBeNull();
    expect(populationLine(null)).toBeNull();
    expect(populationLine(undefined)).toBeNull();
  });

  it("renders an unmeasured count as the em dash, never as a zero", () => {
    // Number(null) is 0 and it is finite — the third-time-this-bit rule. fmtCount refuses
    // null/undefined/""/[]/false BEFORE the cast; a rewrite that casts first reads every one
    // of them as a confident zero.
    for (const v of [null, undefined, "", [], false, {}]) {
      const line = populationLine(payload({ inScope: v, gate: null, filters: [] }));
      expect(line.parts[0], `inScope ${JSON.stringify(v)}`).toBe("In scope —");
    }
  });

  it("drops a filter word that is not a non-empty string", () => {
    const line = populationLine(payload({
      inScope: 3, gate: null, filters: ["one Wiz project", "", null, 7, "  spaced  "],
    }));
    expect(line.parts).toEqual([
      "In scope 3", "gate: all severities", "one Wiz project", "spaced",
    ]);
  });
});

// =========================================================================================
//  The perturbation, run here rather than described in a comment
// =========================================================================================
//
// A guard that fires on nothing is a finding, not a pass (CLAUDE.md). So the defective variant
// is reproduced inline — the tempting `gate.length ? … : …`-free version that joins whatever
// arrived — and shown failing the assertion above, rather than the rule being asserted from
// prose. Keep this in step with the real function; if it stops failing, the real guard has
// stopped biting.
describe("os: populationLine's empty-gate guard actually bites", () => {
  /** populationLine with the empty-gate refusal removed: `Array.isArray` only. */
  function defective(insights) {
    const p = insights?.population;
    if (!p) return null;
    const parts = [`In scope ${p.inScope}`];
    const gate = Array.isArray(p.gate) ? p.gate.join(", ") : null;
    parts.push(gate === null ? "gate: all severities" : `gate ${gate}`);
    if (gate !== null) parts.push("below the gate: not counted");
    return { text: parts.join(" · "), parts };
  }

  it("would print a gate with no severities in it, and claim rows below it", () => {
    const input = payload({ inScope: 7, gate: [], filters: [] });
    const bad = defective(input);
    expect(bad.parts[1]).toBe("gate ");
    expect(bad.parts).toContain("below the gate: not counted");

    const good = populationLine(input);
    expect(good.parts[1]).toBe("gate: all severities");
    expect(good.parts).not.toContain("below the gate: not counted");
  });
});

// =========================================================================================
//  slaConsumedCaption — the sentence that names what the bars LEFT OUT
// =========================================================================================
//
// The SLA-window chart draws ten bars and deliberately does not draw two populations: rows at
// or past their window (no tenth left to plot) and rows with no age or no target (never
// measurable against a deadline). Neither can be read off the bars — they would still add up,
// to a smaller number — so the caption is the only place either fact appears.
//
// The failure this guards is the same one populationLine guards above, arriving through a
// different door: `Number(undefined)` is 0 and finite, so an older payload with no
// `pastWindow` key would caption "0 past the window" over rows nobody counted.

describe("os: slaConsumedCaption names the rows that are not drawn", () => {
  const block = (over = {}) => ({
    labels: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    perSev: { CRITICAL: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    pastWindow: {}, noWindow: 0, totalOpen: 1, ...over,
  });

  it("sums pastWindow across severities", () => {
    const text = slaConsumedCaption(block({
      pastWindow: { CRITICAL: 1204, HIGH: 96, LOW: 3 }, noWindow: 12,
    }));
    expect(text).toBe(
      "Bucket k is time used; 9−k is time left. 1,303 past the window are not drawn; "
      + "12 carry no window.",
    );
  });

  it("returns null on an absent block", () => {
    // An older cached payload, or a page state with no insights at all. A caption naming
    // populations it never received would be a claim about nothing.
    for (const v of [null, undefined, "", 0, false, 7]) {
      expect(slaConsumedCaption(v), JSON.stringify(v)).toBeNull();
    }
  });

  it("prints the em dash, never a zero, for a count that is not a number", () => {
    // Number(null), Number(""), Number([]) and Number(false) are all 0 and all finite. A
    // caption that cast first would state "0 carry no window" for a payload that carried no
    // such measurement — the confident zero CLAUDE.md names three times.
    for (const v of [null, undefined, "", [], false, {}]) {
      const text = slaConsumedCaption(block({ noWindow: v }));
      expect(text, `noWindow ${JSON.stringify(v)}`).toContain("— carry no window");
      expect(text, `noWindow ${JSON.stringify(v)}`).not.toContain("0 carry no window");
    }
    // Same for the sum: a missing pastWindow block, and a present one holding an unmeasured
    // severity. One non-number poisons the total rather than being added as a zero — the
    // sum of a measurement and an absence is an absence.
    expect(slaConsumedCaption(block({ pastWindow: undefined })))
      .toContain("— past the window");
    expect(slaConsumedCaption(block({ pastWindow: { CRITICAL: 4, HIGH: null } })))
      .toContain("— past the window");
    // An empty pastWindow IS a measurement: rows were read and none were past. That is a 0.
    expect(slaConsumedCaption(block({ pastWindow: {} }))).toContain("0 past the window");
  });
});
