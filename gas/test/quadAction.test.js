// `quad.js`'s `cellAction` — the corner's one ACTION control, additive beside the label's one
// DEFINITION control (`gas_shared/ui/quad.js`'s own header). Two claims, held separately
// because they can be wrong in different ways:
//
//   SOURCE  `cellNode` in `gas_shared/ui/quad.js` appends `cellAction(corner)` between the
//           share line and the caller's alarm chip, and `pages/program.js` actually passes
//           one. This project has no jsdom, so the DOM shape is read as source text rather
//           than rendered and inspected — the same house move `test/pagesHelp.test.js` and
//           `test/columnHelp.test.js` already make for this app.
//
//   MODEL   `matrixCellActionSpec` (`pages/program.js`) is the pure half of the drill-down
//           button: which quadrant a corner opens, and — the one guard worth a test —
//           whether it should open anything at all. An empty corner has no findings behind
//           it, so a button that opens one anyway is a control that LOOKS actionable and
//           isn't. The perturbation drops the guard and captures the result, per CLAUDE.md:
//           "a guard that fires on nothing is a finding, not a pass."

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { matrixCellActionSpec } from "../src/client/js/pages/program.js";

const QUAD_SRC = readFileSync(
  new URL("../../gas_shared/ui/quad.js", import.meta.url), "utf8",
);
const PROGRAM_SRC = readFileSync(
  new URL("../src/client/js/pages/program.js", import.meta.url), "utf8",
);

// =========================================================================================
//  Source: the wiring itself
// =========================================================================================

describe("quad.js: cellAction sits between the share line and the alarm chip", () => {
  it("cellNode appends the action's own node after quad-share and before the alarm append", () => {
    const cellNode = QUAD_SRC.slice(
      QUAD_SRC.indexOf("function cellNode("),
      QUAD_SRC.indexOf("\n}", QUAD_SRC.indexOf("function cellNode(")),
    );
    const shareAt = cellNode.indexOf("quad-share");
    const actionAt = cellNode.indexOf("cellAction(corner)");
    const alarmAt = cellNode.indexOf("corner.alarm");
    expect(shareAt).toBeGreaterThan(-1);
    expect(actionAt).toBeGreaterThan(-1);
    expect(alarmAt).toBeGreaterThan(-1);
    expect(shareAt).toBeLessThan(actionAt);
    expect(actionAt).toBeLessThan(alarmAt);
  });

  it("quadTable accepts cellAction as an option and defaults it to null (no-op)", () => {
    expect(QUAD_SRC).toMatch(/cellAction\s*=\s*null/);
  });
});

describe("program.js: the matrix cross passes cellAction to quadTable", () => {
  it("wires cellAction into the quadTable call over the confusion matrix", () => {
    const call = PROGRAM_SRC.slice(
      PROGRAM_SRC.indexOf("quadTable(model,"),
      PROGRAM_SRC.indexOf("}));", PROGRAM_SRC.indexOf("quadTable(model,")),
    );
    expect(call).toContain("cellAction:");
    // The corner's own button reuses the existing drill-down, not a new one.
    expect(call).toContain("matrixCellActionSpec(corner)");
    expect(call).toContain("openCohort(spec.quadrant, spec.count)");
  });
});

// =========================================================================================
//  Model: which corner gets a button, and which does not
// =========================================================================================

function corner(over) {
  return { row: true, col: true, count: 12, label: "Work that mattered", ...over };
}

describe("matrixCellActionSpec: the count > 0 guard", () => {
  it("opens the corner a caller actually counted", () => {
    const spec = matrixCellActionSpec(corner());
    expect(spec).not.toBeNull();
    expect(spec.quadrant).toBe("tp");
    expect(spec.count).toBe(12);
    expect(spec.ariaLabel).toContain("Work that mattered");
    expect(spec.ariaLabel).toContain("12");
  });

  it("maps all four corners to the matrix's own quadrant keys", () => {
    expect(matrixCellActionSpec(corner({ row: true, col: true })).quadrant).toBe("tp");
    expect(matrixCellActionSpec(corner({ row: true, col: false })).quadrant).toBe("fn");
    expect(matrixCellActionSpec(corner({ row: false, col: true })).quadrant).toBe("fp");
    expect(matrixCellActionSpec(corner({ row: false, col: false })).quadrant).toBe("tn");
  });

  it("gets NO action on an empty corner", () => {
    expect(matrixCellActionSpec(corner({ count: 0 }))).toBeNull();
  });

  it("gets NO action on an unmeasured corner", () => {
    expect(matrixCellActionSpec(corner({ count: null }))).toBeNull();
  });

  /**
   * THE PERTURBATION. Dropping the `count > 0` guard — scoring only "did we get a
   * quadrant back" — hands an empty corner a live button that opens a cohort sheet with
   * nothing in it. Reproduced inline and captured, rather than asserted from a comment.
   */
  it("the tempting rewrite (drop the guard) opens a control on an empty corner", () => {
    function withoutGuard(c) {
      if (!c) return null;
      const quadrant = c.row ? (c.col ? "tp" : "fn") : (c.col ? "fp" : "tn");
      return { quadrant, count: c.count, ariaLabel: c.label + ": open the findings" };
    }
    const empty = corner({ count: 0 });
    expect(matrixCellActionSpec(empty)).toBeNull();
    const broken = withoutGuard(empty);
    expect(broken).not.toBeNull();
    expect(broken.quadrant).toBe("tp");
    expect(broken.count).toBe(0);
  });
});
