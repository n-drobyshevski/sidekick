// The confusion matrix as a cross — `pages/program.js`'s `confusionView`/`confusionQuadModel`,
// ported from `gas_devsecops/test/quadPages.test.js`'s "program" half. gas has no secrets
// register, so there is no removal/rotation cross to port beside it — this file holds only
// the one cross this app draws.
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
import { confusionQuadModel, confusionView } from "../src/client/js/pages/program.js";

/**
 * The program matrix, in `src/domain/program.ts`'s own finalized shape. 300 classified across
 * the four corners and 100 unclassified — chosen so `classified` and `total` are DIFFERENT
 * numbers, which is the only condition under which the share-denominator case below can bite.
 */
function matrixFixture() {
  return {
    tp: 120, fn: 80, fp: 40, tn: 60,
    unknownRemediated: 5, unknownOpen: 95,
    classified: 300, unknown: 100, total: 400,
    highRisk: 200, notHighRisk: 100, remediated: 165, open: 235,
    coverage: { point: 60, lo: 40, hi: 80 },
    efficiency: { point: 75, lo: 55, hi: 95 },
    prevalence: 50,
    signalCoveragePct: 75,
  };
}

// =========================================================================================
//  The confusion matrix as a cross
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

  it("places the four corners the way confusionView keys them", () => {
    const at = (row, col) => model.corners.find((c) => c.row === row && c.col === col);
    expect(at(true, true).count).toBe(120); // tp
    expect(at(true, false).count).toBe(80); // fn
    expect(at(false, true).count).toBe(40); // fp
    expect(at(false, false).count).toBe(60); // tn
    // gas's OWN wording (CELLS, pages/program.js) — not gas_devsecops's — so the glossary
    // entries those readings link to keep describing what is actually on screen.
    expect(at(true, true).label).toBe("Fixed, and it mattered");
    expect(at(true, false).label).toBe("High risk, still open");
    expect(at(false, true).label).toBe("Fixed, but low risk");
    expect(at(false, false).label).toBe("Correctly deprioritized");
  });

  it("reuses gas's OWN cell-tp/cell-fp/cell-fn/cell-tn glossary ids as each corner's help", () => {
    const at = (row, col) => model.corners.find((c) => c.row === row && c.col === col);
    expect(at(true, true).help).toEqual({ term: "cell-tp" });
    expect(at(true, false).help).toEqual({ term: "cell-fn" });
    expect(at(false, true).help).toEqual({ term: "cell-fp" });
    expect(at(false, false).help).toEqual({ term: "cell-tn" });
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
//  The refusal both call sites lean on
// =========================================================================================

describe("quadModel refuses what this page would otherwise draw silently", () => {
  it("is what confusionQuadModel actually goes through", () => {
    // Without this the describe above could be testing a hand-rolled object that merely
    // looks like a quad model.
    expect(() => confusionQuadModel({ cells: [], classified: 0 })).toThrow();
  });

  it("throws on a toned corner with no word, reached through confusionQuadModel", () => {
    const brokenView = confusionView(matrixFixture());
    brokenView.cells[0].label = "";
    expect(() => confusionQuadModel(brokenView)).toThrow(/tone is never/);
  });
});
