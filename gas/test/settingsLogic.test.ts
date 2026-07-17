import { describe, expect, it } from "vitest";
import {
  apiSeverityFilter,
  canonicalSeverities,
  getDisplaySeverities,
  getDomains,
  getFastLaneDays,
  getRetentionDays,
  getSupportGroupMap,
  withDomains,
  withFastLaneDays,
  withFetchSeverities,
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

  it("fast-lane window defaults to 1, keeps fractional, rejects junk, clamps to 90", () => {
    expect(getFastLaneDays({})).toBe(1);
    expect(getFastLaneDays({ fast_lane_days: 2 })).toBe(2);
    expect(getFastLaneDays({ fast_lane_days: 0.5 })).toBe(0.5); // fractional kept, no trunc
    expect(getFastLaneDays({ fast_lane_days: 0 })).toBe(1);
    expect(getFastLaneDays({ fast_lane_days: -3 })).toBe(1);
    expect(getFastLaneDays({ fast_lane_days: "bogus" })).toBe(1);
    expect(getFastLaneDays({ fast_lane_days: 200 })).toBe(90);
  });

  it("withFastLaneDays stores the already-clamped value", () => {
    expect(withFastLaneDays({}, 5)["fast_lane_days"]).toBe(5);
    expect(withFastLaneDays({}, -3)["fast_lane_days"]).toBe(1);
    expect(withFastLaneDays({}, 500)["fast_lane_days"]).toBe(90);
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

  it("apiSeverityFilter maps INFO and elides the full scope", () => {
    expect(apiSeverityFilter(["CRITICAL", "INFO"])).toEqual(["CRITICAL", "INFORMATIONAL"]);
    expect(apiSeverityFilter(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"])).toBeNull();
  });
});
