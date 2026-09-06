// THE SENTENCE THAT SAYS WHICH HALF OF THE MOVEMENT WAS WORK.
//
// `movementView` reads `program.movementDecomposition`. Two of its three jobs are refusals,
// and both are the quiet kind:
//
//   - A GAP SENTENCE PRINTED WHEN THERE IS NO GAP. "The books do not balance by 0" trains a
//     reader to skip the one line that matters on the day it is non-zero.
//   - A CONFIDENT ZERO OVER A PAYLOAD NOBODY DECOMPOSED. An older cached entry carries no
//     movement block at all; coercing that into the sentence prints five measurements of a
//     window that was never measured. The server's own note travels verbatim instead —
//     it is the only thing that knows WHY it declined.
//
// Plain .js and pure, for the reason mttrPaintPlan.test.js and populationLine.test.js write out.

import { describe, expect, it } from "vitest";

import { movementView } from "../src/client/js/pages/historyModel.js";

/** The balanced wide-then-narrow window from test/program.test.ts, as the payload ships it. */
const BALANCED = {
  arrivals: 1, observed: 1, bounded: 1, reopened: 0,
  outsideGate: 1, netChange: -1, measured: 1, administrative: 1,
  unattributed: 0, identityGap: 0, identityHolds: true,
  scansInWindow: 2, skippedScans: 0, partialCounts: 0, unplacedRows: 0,
};

describe("the sentence for a balanced window", () => {
  it("names both halves and the direction the count moved", () => {
    const v = movementView(BALANCED, null);
    expect(v.sentences[0]).toBe(
      "Arrivals 1, closed by observation 1, dated gone by absence 1, returned 0; "
      + "the open count moved −1. Of that movement, 1 is measured remediation and "
      + "1 is administrative.",
    );
  });

  it("keeps the two halves in separate tables, never one total", () => {
    const v = movementView(BALANCED, null);
    expect(v.measuredRows).toHaveLength(1);
    expect(v.measuredRows[0].count).toBe(1);
    expect(v.measuredRows[0].cause).toBe("Closed by observation");
    expect(v.administrativeRows).toHaveLength(1);
    expect(v.administrativeRows[0].count).toBe(1);
    // The administrative row says how the date was arrived at, because "gone by 12 Aug" and
    // "resolved 12 Aug" are the same pixel width (CLAUDE.md).
    expect(v.administrativeRows[0].basis).toMatch(/upper bound/);
  });

  it("puts the gate exclusion in the aside, not in either table", () => {
    const v = movementView(BALANCED, null);
    expect(v.sentence).toContain(
      "1 open finding sits outside the current gate and was not measured by the last scan.",
    );
    expect(v.asideRows[0]).toEqual({
      label: "Open, outside the last scan's severity gate", count: 1,
    });
    for (const row of [...v.measuredRows, ...v.administrativeRows]) {
      expect(row.count).toBe(1); // ...and never 2 — the stock is not folded into a flow
    }
  });

  it("says nothing about the gate when nothing sits outside it", () => {
    const v = movementView({ ...BALANCED, outsideGate: 0 }, null);
    expect(v.sentence).not.toMatch(/outside the current gate/);
    expect(v.asideRows).toEqual([]);
  });

  it("pluralizes the gate line rather than reading '1 findings sit'", () => {
    const v = movementView({ ...BALANCED, outsideGate: 4 }, null);
    expect(v.sentence).toContain(
      "4 open findings sit outside the current gate and were not measured by the last scan.",
    );
  });
});

describe("the gap sentence appears only when the gap is non-zero", () => {
  it("is absent on a window whose books balance", () => {
    const v = movementView(BALANCED, null);
    expect(v.sentence).not.toMatch(/do not balance/);
    expect(v.sentences).toHaveLength(2); // the movement sentence and the gate aside
  });

  it("is published, signed, on a window whose books do not", () => {
    // The perturbation from test/program.test.ts: the newest scan forgot one arrival.
    const v = movementView(
      { ...BALANCED, arrivals: 0, identityGap: 1, identityHolds: false }, null,
    );
    expect(v.sentence).toContain(
      "The books do not balance by +1 — that gap is published, not hidden.",
    );
    // Signed both ways: the direction of the disagreement is the readable part.
    const other = movementView({ ...BALANCED, identityGap: -3 }, null);
    expect(other.sentence).toContain("do not balance by −3");
  });
});

describe("the empty branch", () => {
  const NOTE = "One scan only — a movement is a difference between two of them.";

  it("carries the server's note verbatim", () => {
    for (const payload of [null, undefined, "", 0, {}]) {
      const v = movementView(payload, NOTE);
      expect(v.empty, JSON.stringify(payload)).toBe(NOTE);
      expect(v.sentence).toBeUndefined();
    }
  });

  it("refuses a payload missing a figure rather than printing a zero for it", () => {
    // `Number(null)` is 0 and it is finite; every one of these would otherwise render as a
    // measured "0" inside a sentence about a window nobody decomposed.
    for (const bad of [null, "", [], false, undefined]) {
      const v = movementView({ ...BALANCED, netChange: bad }, NOTE);
      expect(v.empty, `netChange ${JSON.stringify(bad)}`).toBe(NOTE);
    }
    expect(movementView({ ...BALANCED, arrivals: undefined }, NOTE).empty).toBe(NOTE);
  });

  it("still says something when the server sent no note either", () => {
    const v = movementView(null, null);
    expect(v.empty).toBe("No movement decomposition in this payload.");
  });
});
