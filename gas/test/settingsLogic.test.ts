import { describe, expect, it } from "vitest";
import {
  applySettingsPatch,
  apiSeverityFilter,
  effectiveColdZoneSettings,
  getColdAfterDays,
  getColdFloorDays,
  getColdTargetSharePct,
  getColdZoneMode,
  withColdAfterDays,
  withColdFloorDays,
  withColdTargetSharePct,
  withColdZoneMode,
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

describe("applySettingsPatch (the single save bar's one atomic write)", () => {
  const base = () => ({
    fetch_severities: ["CRITICAL", "HIGH"],
    display_severities: ["CRITICAL"],
    show_no_fix: true,
    include_eol: true,
    retention_days: 180,
    auto_compact: true,
  });

  it("touches nothing for an empty patch", () => {
    expect(applySettingsPatch(base(), {})).toEqual(base());
  });

  it("leaves fields the reader did not edit alone, rather than rewriting them", () => {
    const out = applySettingsPatch(base(), { autoCompact: false });
    expect(out["auto_compact"]).toBe(false);
    expect(out["retention_days"]).toBe(180);
    expect(out["fetch_severities"]).toEqual(["CRITICAL", "HIGH"]);
  });

  it("ignores a key it does not own instead of writing it onto the dict", () => {
    const out = applySettingsPatch(base(), { nonsense: 1, autoCompact: false });
    expect("nonsense" in out).toBe(false);
  });

  // The ordering property this function exists to guarantee. Widening both scopes in ONE edit
  // has to work: apply display first and it clamps against the OLD scan scope, so MEDIUM ends
  // up scanned but not shown — a register the reader never asked for.
  it("widens the scan scope before clamping the display scope against it", () => {
    const out = applySettingsPatch(base(), {
      fetchSeverities: ["CRITICAL", "HIGH", "MEDIUM"],
      displaySeverities: ["CRITICAL", "HIGH", "MEDIUM"],
    });
    expect(out["fetch_severities"]).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
    expect(out["display_severities"]).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
  });

  it("still clamps a display severity the narrowed scan scope no longer pulls", () => {
    const out = applySettingsPatch(base(), { fetchSeverities: ["CRITICAL"] });
    expect(out["display_severities"]).toEqual(["CRITICAL"]);
  });

  it("writes every owned field when the whole page is edited at once", () => {
    const out = applySettingsPatch(base(), {
      fetchSeverities: ["CRITICAL", "HIGH", "MEDIUM"],
      displaySeverities: ["CRITICAL", "MEDIUM"],
      showNoFix: false,
      includeEol: false,
      riskRule: { kev: false, exploit: true, epss: true, epssThreshold: 0.25 },
      retentionDays: 90,
      autoCompact: false,
    });
    expect(out["show_no_fix"]).toBe(false);
    expect(out["include_eol"]).toBe(false);
    expect(out["retention_days"]).toBe(90);
    expect(out["auto_compact"]).toBe(false);
    expect(out["display_severities"]).toEqual(["CRITICAL", "MEDIUM"]);
    expect((out["risk_rule"] as { rule: { epssThreshold: number } }).rule.epssThreshold).toBe(0.25);
  });

  it("turns sealing off when the retention window is patched to null", () => {
    expect(applySettingsPatch(base(), { retentionDays: null })["retention_days"]).toBeNull();
  });
});

// --------------------------------------------------------------------------- cold zone

describe("cold-zone settings", () => {
  // THE TWO-WAY SPLIT IS THE WHOLE POINT of these four readers, and it is what every case
  // below is about: junk — anything that is not a number (or, for the mode, not a string in
  // the set) — means NOTHING WAS CHOSEN and falls back to the default, while a REAL value
  // outside the range still points at an end of that range and is CLAMPED toward it.
  describe("the window", () => {
    it("defaults when the key is missing entirely", () => {
      expect(getColdAfterDays({})).toBe(90);
    });

    it.each([null, undefined, "", "  ", "ninety", true, false, [], {}, NaN, Infinity])(
      "falls back to the default for junk (%p) rather than casting it to a number",
      (junk) => {
        expect(getColdAfterDays({ cold_after_days: junk as unknown })).toBe(90);
      },
    );

    it("clamps a real number below the floor instead of defaulting it", () => {
      // 3 is not junk: the operator asked for the shortest window this register offers.
      expect(getColdAfterDays({ cold_after_days: 3 })).toBe(7);
    });

    it("clamps a real number above the ceiling instead of defaulting it", () => {
      expect(getColdAfterDays({ cold_after_days: 400 })).toBe(365);
    });

    it("keeps an in-range value, and floors a fractional one", () => {
      expect(getColdAfterDays({ cold_after_days: 45 })).toBe(45);
      expect(getColdAfterDays({ cold_after_days: 45.9 })).toBe(45);
    });

    it("reads a numeric string, because a hand-edited settings cell is still an answer", () => {
      expect(getColdAfterDays({ cold_after_days: "120" })).toBe(120);
    });

    it("stores the CLEANED value, so a bad write cannot survive on the sheet", () => {
      expect(withColdAfterDays({}, 400)["cold_after_days"]).toBe(365);
      expect(withColdAfterDays({}, "nope")["cold_after_days"]).toBe(90);
    });
  });

  describe("the mode", () => {
    it("defaults to fixed when nothing is stored", () => {
      expect(getColdZoneMode({})).toBe("fixed");
    });

    it("accepts both known modes", () => {
      expect(getColdZoneMode({ cold_zone_mode: "fixed" })).toBe("fixed");
      expect(getColdZoneMode({ cold_zone_mode: "relative" })).toBe("relative");
    });

    it("trims and lowercases a genuine string", () => {
      expect(getColdZoneMode({ cold_zone_mode: " RELATIVE " })).toBe("relative");
    });

    it("falls back rather than clamping for an unrecognized string", () => {
      // There is no nearest legal value in a two-member set, so "warm" means nothing chosen.
      expect(getColdZoneMode({ cold_zone_mode: "warm" })).toBe("fixed");
    });

    it.each([null, undefined, 0, 1, true, [], {}, ["relative"]])(
      "refuses a non-string (%p) BEFORE casting it",
      (junk) => {
        // String(null) is "null" and String({}) is "[object Object]" — a cast-first version
        // would happen to pass today and break the day somebody names a mode "null".
        expect(getColdZoneMode({ cold_zone_mode: junk as unknown })).toBe("fixed");
      },
    );

    it("stores the cleaned mode", () => {
      expect(withColdZoneMode({}, " Relative ")["cold_zone_mode"]).toBe("relative");
      expect(withColdZoneMode({}, 7)["cold_zone_mode"]).toBe("fixed");
    });
  });

  describe("the target share and the floor", () => {
    it("default when nothing is stored", () => {
      expect(getColdTargetSharePct({})).toBe(20);
      expect(getColdFloorDays({})).toBe(14);
    });

    it("clamp real numbers at both ends", () => {
      expect(getColdTargetSharePct({ cold_target_share_pct: 0 })).toBe(1);
      expect(getColdTargetSharePct({ cold_target_share_pct: 80 })).toBe(50);
      expect(getColdFloorDays({ cold_floor_days: 0 })).toBe(1);
      expect(getColdFloorDays({ cold_floor_days: 900 })).toBe(365);
    });

    it("fall back for junk", () => {
      expect(getColdTargetSharePct({ cold_target_share_pct: "half" })).toBe(20);
      expect(getColdFloorDays({ cold_floor_days: null })).toBe(14);
    });

    it("store cleaned values", () => {
      expect(withColdTargetSharePct({}, 80)["cold_target_share_pct"]).toBe(50);
      expect(withColdFloorDays({}, -5)["cold_floor_days"]).toBe(1);
    });
  });

  describe("effectiveColdZoneSettings — the one door", () => {
    it("answers all four defaults for an empty dict", () => {
      expect(effectiveColdZoneSettings({})).toEqual({
        mode: "fixed", coldAfterDays: 90, targetSharePct: 20, floorDays: 14,
      });
    });

    it("answers all four defaults for null and undefined", () => {
      // A hand-built fixture or a partial mock must not reach coldZoneProfile as undefineds.
      expect(effectiveColdZoneSettings(null)).toEqual({
        mode: "fixed", coldAfterDays: 90, targetSharePct: 20, floorDays: 14,
      });
      expect(effectiveColdZoneSettings(undefined).mode).toBe("fixed");
    });

    it("never answers a relative mode with nothing to aim at", () => {
      // The combination the profile refuses: mode from one place, numbers from another.
      const out = effectiveColdZoneSettings({ cold_zone_mode: "relative" });
      expect(out.mode).toBe("relative");
      expect(out.targetSharePct).toBe(20);
      expect(out.floorDays).toBe(14);
    });

    it("reads each field through the same cleaner the store writes with", () => {
      expect(
        effectiveColdZoneSettings({
          cold_zone_mode: "RELATIVE",
          cold_after_days: 400,
          cold_target_share_pct: "35",
          cold_floor_days: 0.5,
        }),
      ).toEqual({ mode: "relative", coldAfterDays: 365, targetSharePct: 35, floorDays: 1 });
    });
  });

  describe("applySettingsPatch", () => {
    it("writes all four cold fields, cleaned, when the page saves them together", () => {
      const out = applySettingsPatch({}, {
        coldZoneMode: "relative",
        coldAfterDays: 400,
        coldTargetSharePct: 0,
        coldFloorDays: 30,
      });
      expect(out["cold_zone_mode"]).toBe("relative");
      expect(out["cold_after_days"]).toBe(365);
      expect(out["cold_target_share_pct"]).toBe(1);
      expect(out["cold_floor_days"]).toBe(30);
    });

    it("touches only the cold field named in the patch", () => {
      const base = { cold_zone_mode: "relative", cold_after_days: 30, cold_floor_days: 21 };
      const out = applySettingsPatch(base, { coldAfterDays: 45 });
      expect(out["cold_after_days"]).toBe(45);
      expect(out["cold_zone_mode"]).toBe("relative");
      expect(out["cold_floor_days"]).toBe(21);
      expect("cold_target_share_pct" in out).toBe(false);
    });
  });
});
