// The axis reading, reshaped into the segments the bar draws.
//
// The COUNTING half of this used to live here as `axisTally(decided, key, values)`, walking
// the per-row array the preview shipped. It walks the same population in problemRule.ts now
// — see `treeDiscrimination.axisReadings` for why it moved — and its own tests moved with
// it. What is left here is display arithmetic: shares, ranks, and the hatch's portion.
//
// Plain .js for the reason helpContent.test.js writes out — tsconfig has no allowJs, so a
// .ts test importing a client .js module fails `tsc --noEmit`, and `npm run check` is
// typecheck && test && build, so vitest would never run.

import { describe, expect, it } from "vitest";
import { axisSegments } from "../../gas_shared/ui/axisBar.js";

const EXPLOIT = ["ACTIVE", "SUSPECTED", "UNKNOWN"];

/** A domain reading, in the zero-filled shape `treeDiscrimination.axisReadings` hands over. */
const reading = (counts, unknowns = {}) => ({
  total: Object.values(counts).reduce((a, b) => a + b, 0),
  counts,
  unknowns,
});

describe("axisSegments", () => {
  it("carries each value's count and its share of the whole", () => {
    const t = axisSegments(reading({ ACTIVE: 1, SUSPECTED: 0, UNKNOWN: 3 }), EXPLOIT);
    expect(t.total).toBe(4);
    expect(t.segments.map((s) => [s.value, s.count])).toEqual([
      ["ACTIVE", 1], ["SUSPECTED", 0], ["UNKNOWN", 3],
    ]);
    expect(t.segments[0].share).toBeCloseTo(0.25);
    expect(t.segments[2].share).toBeCloseTo(0.75);
  });

  it("keeps a value nothing reached, because a zero here is a finding", () => {
    // "No reading on this axis ever came out ACTIVE" is worth seeing, not hiding.
    const t = axisSegments(reading({ ACTIVE: 0, SUSPECTED: 0, UNKNOWN: 1 }), EXPLOIT);
    expect(t.segments.map((s) => s.value)).toEqual(EXPLOIT);
    expect(t.segments[0].count).toBe(0);
  });

  it("draws unknown WITHIN the value it landed on, not as a value of its own", () => {
    // A MEDIUM mission may be Wiz's answer or the operator's fallback; both are MEDIUM.
    const t = axisSegments(
      reading({ HIGH: 1, MEDIUM: 2, LOW: 0 }, { HIGH: 0, MEDIUM: 1, LOW: 0 }),
      ["HIGH", "MEDIUM", "LOW"],
    );
    const medium = t.segments.find((s) => s.value === "MEDIUM");
    expect(medium.count).toBe(2);
    expect(medium.unknown).toBe(1);
    expect(medium.unknownShare).toBeCloseTo(0.5);
    expect(t.segments.find((s) => s.value === "HIGH").unknown).toBe(0);
  });

  it("ranks segments in the order the axis declares, not the order the map enumerates", () => {
    // The ramp is monotone ink in the axis's own order; a reordered object must not move it.
    const t = axisSegments(reading({ UNKNOWN: 1, ACTIVE: 1, SUSPECTED: 1 }), EXPLOIT);
    expect(t.segments.map((s) => [s.value, s.rank])).toEqual([
      ["ACTIVE", 0], ["SUSPECTED", 1], ["UNKNOWN", 2],
    ]);
  });

  it("reports zeros rather than NaN on an empty landscape", () => {
    const t = axisSegments(reading({ ACTIVE: 0, SUSPECTED: 0, UNKNOWN: 0 }), EXPLOIT);
    expect(t.total).toBe(0);
    expect(t.segments.every((s) => s.share === 0 && s.unknownShare === 0)).toBe(true);
  });

  it("survives a missing reading — a preview that has not landed paints nothing, not NaN", () => {
    // paintReading(null) is the page's own "no preview yet" path; this is the guard for the
    // shape one step in, where a partial response would otherwise reach the arithmetic.
    const t = axisSegments(null, EXPLOIT);
    expect(t.total).toBe(0);
    expect(t.segments.map((s) => s.count)).toEqual([0, 0, 0]);
    expect(t.segments.every((s) => s.share === 0 && s.unknownShare === 0)).toBe(true);
  });
});
