// The briefing's geometry models (gas_shared/ui/briefing.js) — the claims its pictures make,
// checked without a DOM. See the module header for why each rule exists.
import { describe, expect, it } from "vitest";
import {
  clockModel, dotGridModel, foldTail, ringModel, slopeModel, splitModel,
} from "../../gas_shared/ui/briefing.js";

describe("slopeModel — zero-based, so a small move draws as a small move", () => {
  it("draws 420 -> 413 as nearly flat", () => {
    const m = slopeModel(420, 413);
    expect(m.show).toBe(true);
    expect(m.direction).toBe("down");
    expect(Math.abs(m.y2 - m.y1)).toBeLessThan(1);
  });
  it("refuses a missing or negative reading", () => {
    expect(slopeModel(null, 4).show).toBe(false);
    expect(slopeModel(-1, 4).show).toBe(false);
  });
  it("calls an unchanged reading flat", () => {
    expect(slopeModel(7, 7).direction).toBe("flat");
  });
});

describe("ringModel and dotGridModel — a real part never draws as nothing", () => {
  it("gives 1 of 10,000 a visible sliver, and 0 an empty track", () => {
    expect(ringModel(1, 10000).arc).toBeGreaterThan(0);
    expect(ringModel(0, 10).arc).toBe(0);
  });
  it("refuses a zero whole", () => {
    expect(ringModel(3, 0).show).toBe(false);
  });
  it("fills one cell for 0.7%, none for 0%", () => {
    expect(dotGridModel(0.7).filled).toBe(1);
    expect(dotGridModel(0).filled).toBe(0);
    expect(dotGridModel(5.3).filled).toBe(5);
  });
});

describe("splitModel and foldTail", () => {
  it("refuses a zero total and keeps zero parts off the track", () => {
    expect(splitModel([{ value: 0 }]).show).toBe(false);
    const m = splitModel([{ label: "a", value: 3 }, { label: "b", value: 0 }, { label: "c", value: 1 }]);
    expect(m.rows.map((r) => r.label)).toEqual(["a", "c"]);
    expect(m.rows[0].pct).toBe(75);
  });
  it("folds everything past the kept head into one part, and leaves a short list alone", () => {
    const parts = [5, 4, 3, 2, 1].map((v, i) => ({ label: "p" + i, value: v }));
    const folded = foldTail(parts, 2);
    expect(folded).toHaveLength(3);
    expect(folded[2]).toMatchObject({ value: 6, folded: 3, tone: "rest" });
    expect(foldTail(parts.slice(0, 3), 2)).toHaveLength(3);
  });
});

describe("clockModel — each half-life against its own target", () => {
  const m = clockModel([
    { days: 98.6, target: 14 },
    { days: 210, bounded: true, target: 7 },
    { days: 5, target: 7 },
    { days: 3, bounded: true, target: 30 },
    { days: null, target: 30, age: 200 },
  ]);
  it("marks over, within, and says nothing for a bound that sits inside its target", () => {
    expect(m.rows.map((r) => r.verdict)).toEqual(["over", "over", "within", null, null]);
  });
  it("draws no half-life marker where there is no reading, but keeps the open-age marker", () => {
    expect(m.rows[4].halfPos).toBe(null);
    expect(m.rows[4].agePos).not.toBe(null);
  });
  it("uses a log axis wide enough for every reading, open ages included", () => {
    expect(m.max).toBeGreaterThanOrEqual(210 * 1.15);
    const seven = m.ticks.find((t) => t.days === 7).pos;
    const ninety = m.ticks.find((t) => t.days === 90).pos;
    expect(seven).toBeGreaterThan(20); // a 7-day target is not a hairline at the left edge
    expect(ninety).toBeGreaterThan(seven);
  });
});
