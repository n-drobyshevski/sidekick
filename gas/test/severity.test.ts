import { describe, expect, it } from "vitest";
import { normalizeSeverity, countBySeverity } from "../src/domain/severity";
import { fixture } from "./helpers";

describe("normalizeSeverity (fixture parity)", () => {
  const { cases } = fixture("severity");
  for (const c of cases) {
    it(`${JSON.stringify(c.input)} -> ${c.expected}`, () => {
      expect(normalizeSeverity(c.input)).toBe(c.expected);
    });
  }
});

describe("countBySeverity", () => {
  it("counts normalized severities", () => {
    expect(
      countBySeverity([
        { severity: "critical" },
        { severity: "CRITICAL" },
        { severity: "INFORMATIONAL" },
        { severity: null },
      ]),
    ).toEqual({ CRITICAL: 2, INFO: 1, UNKNOWN: 1 });
  });
  it("returns {} without a severity column", () => {
    expect(countBySeverity([{ name: "x" }])).toEqual({});
    expect(countBySeverity([])).toEqual({});
  });
});
