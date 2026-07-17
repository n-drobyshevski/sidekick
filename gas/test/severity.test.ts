import { describe, expect, it } from "vitest";
import { effectiveSeverity, normalizeSeverity, countBySeverity } from "../src/domain/severity";
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

describe("effectiveSeverity", () => {
  it("keeps a real top-level severity — vendor/nvd never override it", () => {
    expect(
      effectiveSeverity({ severity: "critical", vendorSeverity: "LOW", nvdSeverity: "HIGH" }),
    ).toEqual({ severity: "CRITICAL", source: "severity" });
  });

  it("falls back to vendorSeverity when the top-level severity is blank", () => {
    expect(effectiveSeverity({ severity: "", vendorSeverity: "high" })).toEqual({
      severity: "HIGH",
      source: "vendorSeverity",
    });
  });

  it("falls back to nvdSeverity when severity and vendorSeverity are both blank", () => {
    expect(
      effectiveSeverity({ severity: "", vendorSeverity: "  ", nvdSeverity: "medium" }),
    ).toEqual({ severity: "MEDIUM", source: "nvdSeverity" });
  });

  it("returns {UNKNOWN, null} when every candidate is blank", () => {
    expect(effectiveSeverity({ severity: "", vendorSeverity: null, nvdSeverity: undefined })).toEqual(
      { severity: "UNKNOWN", source: null },
    );
    expect(effectiveSeverity({})).toEqual({ severity: "UNKNOWN", source: null });
  });

  it("resolves the INFORMATIONAL alias through a fallback candidate", () => {
    expect(effectiveSeverity({ severity: "", vendorSeverity: "INFORMATIONAL" })).toEqual({
      severity: "INFO",
      source: "vendorSeverity",
    });
  });

  it("treats a non-string / whitespace / unrecognized top-level severity as blank and falls through", () => {
    expect(effectiveSeverity({ severity: 5, vendorSeverity: "LOW" })).toEqual({
      severity: "LOW",
      source: "vendorSeverity",
    });
    expect(effectiveSeverity({ severity: "  ", nvdSeverity: "CRITICAL" })).toEqual({
      severity: "CRITICAL",
      source: "nvdSeverity",
    });
    expect(effectiveSeverity({ severity: "bogus", vendorSeverity: "HIGH" })).toEqual({
      severity: "HIGH",
      source: "vendorSeverity",
    });
  });
});
