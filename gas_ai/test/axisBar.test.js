// The axis reading tally: what each decision axis actually produced across the landscape.
//
// Plain .js for the reason helpContent.test.js writes out — tsconfig has no allowJs, so a
// .ts test importing a client .js module fails `tsc --noEmit`, and `npm run check` is
// typecheck && test && build, so vitest would never run.

import { describe, expect, it } from "vitest";
import { axisTally } from "../src/client/js/ui/axisBar.js";

const row = (vector, unknowns = []) => ({ outcome: "TRACK", vector, unknowns });
const EXPLOIT = ["ACTIVE", "SUSPECTED", "UNKNOWN"];

describe("axisTally", () => {
  it("counts each value and the share of the whole", () => {
    const t = axisTally(
      [
        row({ exploitation: "ACTIVE" }),
        row({ exploitation: "UNKNOWN" }),
        row({ exploitation: "UNKNOWN" }),
        row({ exploitation: "UNKNOWN" }),
      ],
      "exploitation",
      EXPLOIT,
    );
    expect(t.total).toBe(4);
    expect(t.segments.map((s) => [s.value, s.count])).toEqual([
      ["ACTIVE", 1], ["SUSPECTED", 0], ["UNKNOWN", 3],
    ]);
    expect(t.segments[0].share).toBeCloseTo(0.25);
    expect(t.segments[2].share).toBeCloseTo(0.75);
  });

  it("keeps a value nothing reached, because a zero here is a finding", () => {
    // "No reading on this axis ever came out ACTIVE" is worth seeing, not hiding.
    const t = axisTally([row({ exploitation: "UNKNOWN" })], "exploitation", EXPLOIT);
    expect(t.segments.map((s) => s.value)).toEqual(EXPLOIT);
    expect(t.segments[0].count).toBe(0);
  });

  it("counts unknown WITHIN the value it landed on, not as a value of its own", () => {
    // A MEDIUM mission may be Wiz's answer or the operator's fallback; both are MEDIUM.
    const t = axisTally(
      [
        row({ mission: "MEDIUM" }),
        row({ mission: "MEDIUM" }, ["mission"]),
        row({ mission: "HIGH" }),
      ],
      "mission",
      ["HIGH", "MEDIUM", "LOW"],
    );
    const medium = t.segments.find((s) => s.value === "MEDIUM");
    expect(medium.count).toBe(2);
    expect(medium.unknown).toBe(1);
    expect(medium.unknownShare).toBeCloseTo(0.5);
    expect(t.segments.find((s) => s.value === "HIGH").unknown).toBe(0);
  });

  it("ignores an unknown flag for a DIFFERENT axis", () => {
    const t = axisTally([row({ mission: "HIGH" }, ["exposure"])], "mission", ["HIGH", "MEDIUM", "LOW"]);
    expect(t.segments[0].unknown).toBe(0);
  });

  it("skips rows carrying no reading on this axis rather than counting them anywhere", () => {
    const t = axisTally(
      [row({ exploitation: "ACTIVE" }), row({}), row({ exploitation: "NONSENSE" })],
      "exploitation",
      EXPLOIT,
    );
    expect(t.total).toBe(1);
  });

  it("reports zeros rather than NaN on an empty landscape", () => {
    const t = axisTally([], "exploitation", EXPLOIT);
    expect(t.total).toBe(0);
    expect(t.segments.every((s) => s.share === 0 && s.unknownShare === 0)).toBe(true);
  });
});
