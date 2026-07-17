import { describe, expect, it } from "vitest";
import {
  apiSeverityFilter,
  canonicalSeverities,
  getDisplaySeverities,
  getDomains,
  getRetentionDays,
  getShowNoFix,
  getSupportGroupMap,
  withDomains,
  withFetchSeverities,
  withShowNoFix,
  withSupportGroupMap,
} from "../src/domain/settingsLogic";

describe("settings logic", () => {
  it("canonicalizes severity lists", () => {
    expect(canonicalSeverities(["high", "INFORMATIONAL", "bogus"], ["CRITICAL"])).toEqual([
      "HIGH",
      "INFO",
    ]);
    expect(canonicalSeverities("nope", ["CRITICAL", "HIGH"])).toEqual(["CRITICAL", "HIGH"]);
    expect(canonicalSeverities([], ["CRITICAL"])).toEqual(["CRITICAL"]);
    expect(canonicalSeverities(["UNKNOWN"], ["CRITICAL"])).toEqual(["CRITICAL"]);
  });

  it("clamps display to the fetch scope", () => {
    const s = { fetch_severities: ["CRITICAL", "HIGH"], display_severities: ["MEDIUM", "HIGH"] };
    expect(getDisplaySeverities(s)).toEqual(["HIGH"]);
    expect(getDisplaySeverities({ fetch_severities: ["LOW"], display_severities: ["HIGH"] }))
      .toEqual(["LOW"]);
  });

  it("re-clamps display when fetch shrinks", () => {
    const s = withFetchSeverities(
      { fetch_severities: ["CRITICAL", "HIGH", "MEDIUM"], display_severities: ["MEDIUM"] },
      ["CRITICAL"],
    );
    expect(s["display_severities"]).toEqual(["CRITICAL"]);
  });

  it("retention clamps to the minimum and honors null=off", () => {
    expect(getRetentionDays({})).toBe(180);
    expect(getRetentionDays({ retention_days: 7 })).toBe(30);
    expect(getRetentionDays({ retention_days: null })).toBeNull();
    expect(getRetentionDays({ retention_days: "bogus" })).toBe(180);
  });

  it("domains version bumps on save and cleans junk items", () => {
    const s = withDomains({}, [{ name: "A", rules: [] }, "junk", { name: " " }]);
    expect(getDomains(s)).toEqual({ version: 1, items: [{ name: "A", rules: [] }] });
    const s2 = withDomains(s, []);
    expect(getDomains(s2).version).toBe(2);
  });

  it("support-group map version bumps on save and keeps only string→string entries", () => {
    expect(getSupportGroupMap({})).toEqual({ version: 0, map: {} });
    const s = withSupportGroupMap({}, {
      "sub-1": "CS-SUPPLY-MONITORING",
      "sub-2": "",        // empty value dropped
      "": "orphan",       // empty key dropped
      "sub-3": 42,        // non-string value dropped
    });
    expect(getSupportGroupMap(s)).toEqual({
      version: 1,
      map: { "sub-1": "CS-SUPPLY-MONITORING" },
    });
    const s2 = withSupportGroupMap(s, { "sub-9": "CS-OTHER" });
    expect(getSupportGroupMap(s2).version).toBe(2);
    // a corrupt blob reads as empty, never throws
    expect(getSupportGroupMap({ support_group_map: "junk" })).toEqual({ version: 0, map: {} });
  });

  it("show-no-fix defaults true; only a real boolean overrides; junk falls back to true", () => {
    expect(getShowNoFix({})).toBe(true); // absent -> today's behavior
    expect(getShowNoFix({ show_no_fix: false })).toBe(false);
    expect(getShowNoFix({ show_no_fix: true })).toBe(true);
    expect(getShowNoFix({ show_no_fix: "false" })).toBe(true); // non-boolean junk -> true
    expect(getShowNoFix({ show_no_fix: 0 })).toBe(true);
    expect(getShowNoFix({ show_no_fix: null })).toBe(true);
  });

  it("withShowNoFix coerces to a boolean", () => {
    expect(withShowNoFix({}, false)).toEqual({ show_no_fix: false });
    expect(withShowNoFix({ a: 1 }, true)).toEqual({ a: 1, show_no_fix: true });
    // truthy/falsy inputs are coerced, never stored raw.
    expect(withShowNoFix({}, 0 as unknown as boolean)).toEqual({ show_no_fix: false });
    expect(withShowNoFix({}, 1 as unknown as boolean)).toEqual({ show_no_fix: true });
  });

  it("apiSeverityFilter maps INFO and elides the full scope", () => {
    expect(apiSeverityFilter(["CRITICAL", "INFO"])).toEqual(["CRITICAL", "INFORMATIONAL"]);
    expect(apiSeverityFilter(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"])).toBeNull();
  });
});
