import { describe, expect, it } from "vitest";
import {
  apiSeverityFilter,
  canonicalSeverities,
  getDisplaySeverities,
  getDomains,
  getRetentionDays,
  withDomains,
  withFetchSeverities,
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

  it("apiSeverityFilter maps INFO and elides the full scope", () => {
    expect(apiSeverityFilter(["CRITICAL", "INFO"])).toEqual(["CRITICAL", "INFORMATIONAL"]);
    expect(apiSeverityFilter(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"])).toBeNull();
  });
});
