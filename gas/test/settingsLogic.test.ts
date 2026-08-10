import { describe, expect, it } from "vitest";
import {
  apiSeverityFilter,
  canonicalSeverities,
  getDisplaySeverities,
  getDomains,
  getRetentionDays,
  getIncludeEol,
  getRiskRule,
  getShowNoFix,
  getSupportGroupMap,
  withDomains,
  withFetchSeverities,
  withRiskRule,
  withIncludeEol,
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

  it("getIncludeEol defaults to true and ignores non-boolean junk", () => {
    expect(getIncludeEol({})).toBe(true); // absent -> included (whole register)
    expect(getIncludeEol({ include_eol: false })).toBe(false);
    expect(getIncludeEol({ include_eol: true })).toBe(true);
    expect(getIncludeEol({ include_eol: "false" })).toBe(true); // non-boolean junk -> true
    expect(getIncludeEol({ include_eol: 0 })).toBe(true);
    expect(getIncludeEol({ include_eol: null })).toBe(true);
  });

  it("withIncludeEol coerces to a boolean", () => {
    expect(withIncludeEol({}, false)).toEqual({ include_eol: false });
    expect(withIncludeEol({ a: 1 }, true)).toEqual({ a: 1, include_eol: true });
    expect(withIncludeEol({}, 0 as unknown as boolean)).toEqual({ include_eol: false });
    expect(withIncludeEol({}, 1 as unknown as boolean)).toEqual({ include_eol: true });
  });

  it("apiSeverityFilter maps INFO and elides the full scope", () => {
    expect(apiSeverityFilter(["CRITICAL", "INFO"])).toEqual(["CRITICAL", "INFORMATIONAL"]);
    expect(apiSeverityFilter(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"])).toBeNull();
  });
});

describe("risk rule (coverage/efficiency classifier)", () => {
  it("defaults to all three signals at the project EPSS cut", () => {
    const { version, rule } = getRiskRule({});
    expect(version).toBe(0);
    expect(rule).toEqual({ kev: true, exploit: true, epss: true, epssThreshold: 0.1 });
  });

  it("round-trips a stored rule and bumps the version on every save", () => {
    const s1 = withRiskRule({}, { kev: true, exploit: false, epss: true, epssThreshold: 0.3 });
    const got = getRiskRule(s1);
    expect(got.version).toBe(1);
    expect(got.rule).toEqual({ kev: true, exploit: false, epss: true, epssThreshold: 0.3 });
    // The version is what cache keys hang off, so it must move even on an identical rule.
    expect(getRiskRule(withRiskRule(s1, got.rule)).version).toBe(2);
  });

  it("clamps the EPSS threshold into [0, 1] and rejects junk", () => {
    expect(getRiskRule(withRiskRule({}, { epssThreshold: 5 })).rule.epssThreshold).toBe(1);
    expect(getRiskRule(withRiskRule({}, { epssThreshold: -2 })).rule.epssThreshold).toBe(0);
    expect(getRiskRule(withRiskRule({}, { epssThreshold: "nope" })).rule.epssThreshold).toBe(0.1);
  });

  it("persists an all-disabled rule as-is, with no silent fallback to the default", () => {
    // An all-disabled rule decides nothing, so every finding classifies unknown and the page
    // says so. Quietly restoring the default here would hide that from the operator.
    const s = withRiskRule({}, { kev: false, exploit: false, epss: false, epssThreshold: 0.1 });
    const { rule } = getRiskRule(s);
    expect(rule.kev).toBe(false);
    expect(rule.exploit).toBe(false);
    expect(rule.epss).toBe(false);
  });

  it("falls back to the default for a malformed blob", () => {
    expect(getRiskRule({ risk_rule: "nope" }).rule.kev).toBe(true);
    expect(getRiskRule({ risk_rule: { version: 4 } }).rule.epss).toBe(true);
    expect(getRiskRule({ risk_rule: { version: 4 } }).version).toBe(4);
  });
});
