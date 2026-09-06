// The two crosses this register draws, and the arithmetic each one can be wrong about.
//
// Two pages ask two yes/no questions about one population and used to draw the answer as a
// table: `secrets.js`'s "Removed is not rotated" as five columns with a prose Reading column,
// and `program.js`'s confusion matrix as three columns with the reading appended to each
// count. `gas_shared/ui/quad.js` draws both as the 2x2 they are, and this file holds the two
// call-site models — the half that decides WHAT is crossed with what, which corner is toned,
// and (the one genuinely load-bearing decision) which total the shares are read against.
//
// PURE, BECAUSE THE DOM HALF IS NOT WHERE THE MISTAKE LIVES. `quadTable` is a `<table>` with
// `<th scope>` axes and nothing to get wrong; `quadModel` refuses a missing corner and a
// toned corner with no word. What is left is exactly two page-local functions, and this
// project's vitest has no jsdom, so those two are what a test can hold.
//
// THE PROGRAM CROSS'S TOTAL IS THE ONE TO WATCH. Its four corners sum to `classified`, never
// to `total` — the unclassified rows are held OUTSIDE the grid, under a hatch — so passing
// `total` would leave four shares that visibly do not reach 100% with nothing on the grid
// saying why. The perturbation for that is reproduced inline below rather than described.

import { describe, expect, it } from "vitest";

import { quadModel } from "../../gas_shared/ui/quad.js";
import { REMOVAL_CELLS, removalQuadModel, secretsModel } from "../src/client/js/pages/secrets.js";
import { confusionQuadModel, confusionView } from "../src/client/js/pages/program.js";

// =========================================================================================
//  Fixtures
// =========================================================================================

/**
 * The secrets corners, with the same four counts `test/pagesRegisters.test.js` uses, so the
 * two files describe one register: 3 removed-and-rotated, 17 removed-not-rotated, 1
 * rotated-not-removed, 40 neither, 61 in the register.
 */
function removalVm(over) {
  return {
    removalVsRotation: {
      total: 61,
      cells: REMOVAL_CELLS.map((c) => ({
        ...c,
        count: { removedAndRotated: 3, removedNotRotated: 17, rotatedNotRemoved: 1, neither: 40 }[c.id],
      })),
      ...(over || {}),
    },
  };
}

/**
 * The program matrix, in `domain/program.ts`'s own shape. 300 classified across the four
 * corners and 100 unclassified — chosen so `classified` and `total` are DIFFERENT numbers,
 * which is the only condition under which the share-denominator case below can bite.
 */
function matrixFixture() {
  return {
    tp: 120, fn: 80, fp: 40, tn: 60,
    unknownRemediated: 5, unknownOpen: 95,
    classified: 300, total: 400,
    coverage: { point: 60, lo: 40, hi: 80 },
    efficiency: { point: 75, lo: 55, hi: 95 },
    prevalence: 50,
    signalCoveragePct: 75,
  };
}

// =========================================================================================
//  1. Secrets: removal against rotation
// =========================================================================================

describe("secrets — the removal/rotation cross", () => {
  const model = removalQuadModel(removalVm());

  it("crosses the two axes the page names, in the words a screen reader announces", () => {
    expect(model.rows.label).toBe("String out of HEAD");
    expect(model.cols.label).toBe("Credential confirmed dead");
    // The answer words say what the answer MEANS, not "Yes"/"No" — those are what `<th
    // scope="row">` and `<th scope="col">` are read out as beside every figure.
    expect([model.rows.yes, model.rows.no]).toEqual(["Out of HEAD", "Still in HEAD"]);
    expect([model.cols.yes, model.cols.no]).toEqual(["Confirmed dead", "Not confirmed"]);
  });

  it("puts each of the four counts in the corner its two booleans name", () => {
    const at = (row, col) => model.corners.find((c) => c.row === row && c.col === col);
    expect(at(true, true).count).toBe(3); // removed and rotated
    expect(at(true, false).count).toBe(17); // removed, NOT rotated — the alarm
    expect(at(false, true).count).toBe(1);
    expect(at(false, false).count).toBe(40);
    expect(model.corners.reduce((n, c) => n + c.count, 0)).toBe(61);
  });

  it("reads every share against the register, and they sum to one", () => {
    expect(model.total).toBe(61);
    const sum = model.corners.reduce((n, c) => n + c.share, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(model.corners.find((c) => c.row && !c.col).shareText).toBe("27.9%");
  });

  it("tones the alarm corner and never tones one without a word", () => {
    const alarm = model.corners.find((c) => c.row && !c.col);
    expect(alarm.tone).toBe("warn");
    expect(alarm.label).toBe("Removed, not rotated");
    // The clean corner is the only "ok" one; the other two are neutral, because "rotated but
    // still committed" is noise rather than a success and "neither" is the register's normal
    // condition. Every corner carries its word whether toned or not.
    expect(model.corners.filter((c) => c.tone === "ok").map((c) => c.label))
      .toEqual(["Removed and rotated"]);
    for (const c of model.corners) expect(typeof c.label).toBe("string");
    for (const c of model.corners) expect(c.label.trim().length).toBeGreaterThan(0);
  });

  it("carries each corner's old Reading sentence into the corner's own help", () => {
    for (const corner of model.corners) {
      const source = REMOVAL_CELLS.find((c) => c.label === corner.label);
      expect(corner.help.lines).toEqual([source.reading]);
    }
  });

  it("builds no alarm chip of its own — the page injects one, for exactly one corner", () => {
    // The default resolver hands back nothing, so the model stays callable with no DOM (this
    // project has no jsdom) and the page keeps its own claim about which corner is an alarm.
    for (const c of model.corners) expect(c.alarm).toBe(null);
    const marked = removalQuadModel(
      removalVm(),
      (id) => (id === "removedNotRotated" ? { chip: id } : null),
    );
    const carrying = marked.corners.filter((c) => c.alarm);
    expect(carrying).toHaveLength(1);
    expect(carrying[0].label).toBe("Removed, not rotated");
  });

  it("names no severity anywhere in it — pagesLit gate 4/7, restated at the model", () => {
    // `quad.js` is severity-free by construction and this is the call site that depends on
    // it. Serialised so a `sev` key at any depth fails, the way `pagesLit.test.js` sweeps
    // `secretsModel`'s own output.
    const serialised = JSON.stringify(model);
    expect(serialised).not.toMatch(/sev/i);
    expect(serialised).not.toMatch(/severity/i);
  });

  it("says “not measured” rather than zero for a register nobody has read", () => {
    // `secretsModel({})` is the first-run shape: every corner count is null and the total is
    // null. Four zeroes in a 2x2 would be four strong claims about a population nobody has
    // looked at.
    const empty = removalQuadModel(secretsModel({}));
    for (const c of empty.corners) {
      expect(c.count).toBe(null);
      expect(c.measured).toBe(false);
      expect(c.share).toBe(null);
      expect(c.countText).toBe("—");
      expect(c.shareText).toBe("—");
    }
    expect(JSON.stringify(empty)).not.toMatch(/"count":0/);
  });
});

// =========================================================================================
//  2. Coverage & efficiency: classification against outcome
// =========================================================================================

describe("program — the confusion matrix as a cross", () => {
  const view = confusionView(matrixFixture());
  const model = confusionQuadModel(view);

  it("crosses what the rule said against what happened", () => {
    expect([model.rows.label, model.rows.yes, model.rows.no])
      .toEqual(["Classified", "High risk", "Not high risk"]);
    expect([model.cols.label, model.cols.yes, model.cols.no])
      .toEqual(["Outcome", "Remediated", "Still open"]);
  });

  it("places the four cells the way confusionView keys them", () => {
    const at = (row, col) => model.corners.find((c) => c.row === row && c.col === col);
    expect(at(true, true).count).toBe(120); // tp
    expect(at(true, false).count).toBe(80); // fn
    expect(at(false, true).count).toBe(40); // fp
    expect(at(false, false).count).toBe(60); // tn
    expect(at(true, true).label).toBe("Work that mattered");
    expect(at(true, false).label).toBe("Unremediated risk");
  });

  /**
   * THE ONE DECISION IN THIS MODEL, AND ITS PERTURBATION.
   *
   * The shares are read against `classified` (300), not against `total` (400). The four
   * corners partition the classified population by construction — `confusionView` asserts
   * `cellTotal === classified` and `test/pagesProgram.test.js` pins it — and the 100
   * unclassified rows are a SIBLING of the array, drawn beside the grid under a hatch.
   *
   * The tempting rewrite ("the denominator of a rate on this page is the population in
   * scope") is reproduced below rather than described: it leaves four shares summing to 75%
   * on a grid whose own arithmetic is complete, with nothing on the grid to explain the
   * missing quarter — a cross that reads as a rendering fault instead of as a measurement.
   */
  it("reads the shares against the classified rows, which is what the corners partition", () => {
    expect(model.total).toBe(300);
    expect(model.corners.reduce((n, c) => n + c.share, 0)).toBeCloseTo(1, 10);
    expect(model.corners.find((c) => c.row && c.col).shareText).toBe("40.0%");

    // PERTURBATION, inline: the same four corners against `total`.
    const overTotal = quadModel({
      rows: { label: "Classified", yes: "High risk", no: "Not high risk" },
      cols: { label: "Outcome", yes: "Remediated", no: "Still open" },
      cells: model.corners.map((c) => ({
        row: c.row, col: c.col, count: c.count, label: c.label, tone: c.tone,
      })),
      total: view.total,
      unit: "findings",
    });
    const sum = overTotal.corners.reduce((n, c) => n + c.share, 0);
    expect(sum).toBeCloseTo(0.75, 10);
    expect(sum).not.toBeCloseTo(1, 3);
  });

  it("keeps the unclassified rows out of every corner", () => {
    // The load-bearing negative: fold `unknownOpen` into the tempting corner (tn) and the
    // corner count stops matching `confusionView`'s own cell.
    const tn = model.corners.find((c) => !c.row && !c.col);
    expect(tn.count).toBe(60);
    expect(tn.count).not.toBe(matrixFixture().tn + matrixFixture().unknownOpen);
    expect(model.corners.reduce((n, c) => n + c.count, 0)).toBe(view.classified);
    expect(model.corners.reduce((n, c) => n + c.count, 0)).not.toBe(view.total);
  });

  it("tones the diagonal and never tones a corner without its word", () => {
    const tone = (row, col) => model.corners.find((c) => c.row === row && c.col === col).tone;
    expect(tone(true, true)).toBe("ok");
    expect(tone(true, false)).toBe("bad");
    // Effort spent on a finding the rule did not rate high is the COST side of the pair this
    // page publishes, not an error — "warn", never "bad".
    expect(tone(false, true)).toBe("warn");
    expect(tone(false, false)).toBe("neutral");
    for (const c of model.corners) expect(c.label.trim().length).toBeGreaterThan(0);
  });
});

// =========================================================================================
//  3. The refusals both call sites lean on
// =========================================================================================

describe("quadModel refuses what a page would otherwise draw silently", () => {
  const axes = {
    rows: { label: "R", yes: "Ry", no: "Rn" },
    cols: { label: "C", yes: "Cy", no: "Cn" },
  };
  const four = [
    { row: true, col: true, count: 1, label: "a" },
    { row: true, col: false, count: 2, label: "b" },
    { row: false, col: true, count: 3, label: "c" },
    { row: false, col: false, count: 4, label: "d" },
  ];

  it("throws on a toned corner with no word — colour is never the only carrier", () => {
    const cells = four.map((c, i) => (i === 1 ? { ...c, label: "", tone: "warn" } : c));
    expect(() => quadModel({ ...axes, cells, total: 10 })).toThrow(/tone is never/);
  });

  it("throws on a missing corner rather than drawing an empty box", () => {
    expect(() => quadModel({ ...axes, cells: four.slice(0, 3), total: 10 }))
      .toThrow(/expected exactly one cell/);
  });

  it("is what both page models actually go through", () => {
    // Without this the two describes above could be testing hand-rolled objects that merely
    // look like a quad model.
    expect(() => removalQuadModel({ removalVsRotation: { total: 1, cells: [] } })).toThrow();
    expect(() => confusionQuadModel({ cells: [], classified: 0 })).toThrow();
  });
});
