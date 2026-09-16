// Settings semantics, and one migration that has to be right the first time.
//
// fetchSeverities was a single flat array applied to every scope until PROBE_FINDINGS.md
// §8.3 showed what that costs: CRITICAL/HIGH inherited from the vulnerability registers
// deletes PASSWORD 209 -> 0 and CERTIFICATE 160 -> 0 from the secrets register, so it
// contains no passwords at all. It is now a record. Any deployment that has saved settings
// still holds the array, and it must not be silently reset.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, DEFAULT_SYNC_HOUR, cleanSettings, effectiveColdAfterDays,
  effectiveColdZoneSettings, effectiveSlaTargets, validateSettings, withSettings,
} from "../src/domain/settingsLogic";
import {
  COLD_AFTER_DAYS_MAX, COLD_AFTER_DAYS_MIN, COLD_FLOOR_DAYS_MAX, COLD_FLOOR_DAYS_MIN,
  COLD_TARGET_SHARE_PCT_MAX, COLD_TARGET_SHARE_PCT_MIN, COLD_ZONE_MODES, DEFAULT_COLD_AFTER_DAYS,
  DEFAULT_COLD_FLOOR_DAYS, DEFAULT_COLD_TARGET_SHARE_PCT, DEFAULT_COLD_ZONE_MODE,
  DEFAULT_FETCH_SEVERITIES, DEFAULT_RETENTION_DAYS, SCOPES, SLA_TARGETS,
} from "../src/domain/config";
import { RETENTION_MIN_DAYS } from "../src/domain/maintenance";
import { TAB_FIELDS, tabStatus } from "../src/client/js/settingsModel";
import { BATCHED_KEYS, TABS, draftFromSettings } from "../src/client/js/pages/settings.js";

const SETTINGS_PAGE_SRC = readFileSync(
  new URL("../src/client/js/pages/settings.js", import.meta.url), "utf8",
);

describe("the per-scope severity defaults", () => {
  it("keeps CRITICAL/HIGH on the vulnerability registers", () => {
    expect(DEFAULT_FETCH_SEVERITIES.sca).toEqual(["CRITICAL", "HIGH"]);
    expect(DEFAULT_FETCH_SEVERITIES.sast).toEqual(["CRITICAL", "HIGH"]);
  });

  it("puts NO severity gate on secrets", () => {
    // This test pinned ["CRITICAL","HIGH","MEDIUM"] and the claim it encoded was "MEDIUM
    // reaches the categories that sit below HIGH". §8.3 had established those rows were
    // below HIGH; it had not established they were AT MEDIUM, and the crosstab in §9.2
    // showed they are not: CERTIFICATE is 160/160 INFORMATIONAL, so MEDIUM captured 0 of
    // it, and PASSWORD splits 107 MEDIUM / 17 LOW / 84 INFORMATIONAL, so it captured half.
    // The register sat at 843 of 1,958 rows with one category missing entirely.
    //
    // Walking the floor down a step at a time kept failing because severity is the wrong
    // gate: it grades a DETECTION (641 SAAS_API_KEY rows are LOW), not whether a credential
    // is live. An empty list sends no severity key at all.
    expect(DEFAULT_FETCH_SEVERITIES.secrets).toEqual([]);
  });

  it("keeps the empty list through a clean, rather than treating it as missing", () => {
    // The whole fix depends on this: cleanFetchSeverities must read [] as the real answer
    // "every severity" and not fall back to a default.
    expect(cleanSettings({}).fetchSeverities.secrets).toEqual([]);
    expect(cleanSettings({ fetchSeverities: { secrets: [] } }).fetchSeverities.secrets).toEqual([]);
  });

  it("has an entry for every scope", () => {
    for (const s of SCOPES) expect(DEFAULT_FETCH_SEVERITIES[s], `${s} has no default`).toBeTruthy();
  });
});

describe("migrating the old flat fetchSeverities", () => {
  it("spreads a stored array across all three scopes", () => {
    // That IS what it meant when it was written: one answer for everything.
    const s = cleanSettings({ fetchSeverities: ["CRITICAL"] });
    expect(s.fetchSeverities).toEqual({
      sca: ["CRITICAL"], sast: ["CRITICAL"], secrets: ["CRITICAL"],
    });
  });

  it("does not silently reset an operator's choice", () => {
    // The failure mode worth guarding: drop the old value, take defaults, and the next save
    // writes them back as though the operator had chosen them.
    const s = cleanSettings({ fetchSeverities: ["CRITICAL", "HIGH", "MEDIUM", "LOW"] });
    expect(s.fetchSeverities.sca).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
  });

  it("falls back per scope when a stored record is partial", () => {
    // The point of the record: a missing scope takes ITS OWN default, not another's — so
    // this asserts against the default rather than a literal, which is what let the last
    // version of it go stale the moment the secrets default changed.
    const s = cleanSettings({ fetchSeverities: { sca: ["CRITICAL"] } });
    expect(s.fetchSeverities.sca).toEqual(["CRITICAL"]);
    expect(s.fetchSeverities.secrets).toEqual([...DEFAULT_FETCH_SEVERITIES.secrets]);
    expect(s.fetchSeverities.sast).toEqual([...DEFAULT_FETCH_SEVERITIES.sast]);
    // and the two really are different answers, which is why the record exists
    expect(s.fetchSeverities.secrets).not.toEqual(s.fetchSeverities.sast);
  });

  it("keeps an explicitly empty list, which means every severity", () => {
    const s = cleanSettings({ fetchSeverities: { secrets: [] } });
    expect(s.fetchSeverities.secrets).toEqual([]);
  });

  it("survives junk without throwing, because a settings row must not take the app down", () => {
    for (const junk of [null, undefined, 42, "CRITICAL", { sca: "nope" }, { sca: [7, {}] }]) {
      const s = cleanSettings({ fetchSeverities: junk });
      for (const scope of SCOPES) expect(Array.isArray(s.fetchSeverities[scope])).toBe(true);
    }
  });

  it("drops a severity the register does not have", () => {
    const s = cleanSettings({ fetchSeverities: { sca: ["CRITICAL", "NONSENSE"] } });
    expect(s.fetchSeverities.sca).toEqual(["CRITICAL"]);
  });
});

describe("the rest of the settings contract", () => {
  it("falls back rather than persisting a register that can never fill", () => {
    expect(cleanSettings({ scopes: [] }).scopes).toEqual([...SCOPES]);
    expect(cleanSettings({ scopes: ["nope"] }).scopes).toEqual([...SCOPES]);
  });

  it("defaults are themselves clean, so a fresh install and a round trip agree", () => {
    expect(cleanSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it("reports a missing severity selection rather than repairing it", () => {
    // Stage two says what a human got wrong; stage one is the only thing that repairs.
    const broken = { ...DEFAULT_SETTINGS, fetchSeverities: {} };
    expect(validateSettings(broken).join(" ")).toMatch(/severity selection/i);
  });

  it("rejects a non-positive SLA target", () => {
    const s = { ...DEFAULT_SETTINGS, slaTargets: { ...DEFAULT_SETTINGS.slaTargets, HIGH: 0 } };
    expect(validateSettings(s).join(" ")).toMatch(/positive number of days/i);
  });

  it("re-cleans a patch rather than trusting it", () => {
    expect(withSettings(DEFAULT_SETTINGS, { scopes: [] }).scopes).toEqual([...SCOPES]);
  });
});

// P5: the Deadlines tab used to be ornamental — every published SLA figure read `SLA_TARGETS`
// directly and `settings.slaTargets` reached nowhere. `effectiveSlaTargets` is the one function
// every server-side reader now calls instead, and this is its own suite (its callers' own
// tests — readModels.test.ts, insights.test.ts, remediation.test.ts, fixNext.test.ts,
// api.test.ts — pin that they WIRE it through, not what it computes).
describe("effectiveSlaTargets: the constant, overlaid with a saved override", () => {
  it("returns the shared constant untouched when nobody overrode anything", () => {
    expect(effectiveSlaTargets(DEFAULT_SETTINGS)).toEqual(SLA_TARGETS);
  });

  it("degrades to the constant for a settings-shaped value with no slaTargets at all", () => {
    // The exact shape `readModels.test.ts`'s `loadSettings()` mock hands every caller — this
    // is what keeps that mock (and any other partial settings fixture) from having to grow a
    // `slaTargets` field it has no reason to care about.
    expect(effectiveSlaTargets({ projectView: "" })).toEqual(SLA_TARGETS);
    expect(effectiveSlaTargets(null)).toEqual(SLA_TARGETS);
    expect(effectiveSlaTargets(undefined)).toEqual(SLA_TARGETS);
  });

  it("overlays a real override on top of the constant, leaving every other severity alone", () => {
    const s = { slaTargets: { ...SLA_TARGETS, CRITICAL: 3 } };
    const out = effectiveSlaTargets(s);
    expect(out.CRITICAL).toBe(3);
    expect(out.HIGH).toBe(SLA_TARGETS.HIGH);
    expect(out.MEDIUM).toBe(SLA_TARGETS.MEDIUM);
    expect(out.LOW).toBe(SLA_TARGETS.LOW);
    expect(out.INFO).toBe(SLA_TARGETS.INFO);
  });

  it("never mutates the shared constant — it is the baseline, not a scratch pad", () => {
    effectiveSlaTargets({ slaTargets: { CRITICAL: 1 } });
    expect(SLA_TARGETS.CRITICAL).toBe(7);
  });

  it("refuses the same junk cleanSettings refuses: zero, negative, non-numeric, falls back", () => {
    const out = effectiveSlaTargets({
      slaTargets: { CRITICAL: 0, HIGH: -5, MEDIUM: "not a number", LOW: 45 },
    });
    expect(out.CRITICAL).toBe(SLA_TARGETS.CRITICAL);
    expect(out.HIGH).toBe(SLA_TARGETS.HIGH);
    expect(out.MEDIUM).toBe(SLA_TARGETS.MEDIUM);
    expect(out.LOW).toBe(45);
  });

  it("floors a fractional override, same rule cleanSettings applies", () => {
    expect(effectiveSlaTargets({ slaTargets: { CRITICAL: 3.9 } }).CRITICAL).toBe(3);
  });

  it("agrees with cleanSettings's own slaTargets field on an already-cleaned Settings", () => {
    // `Settings.slaTargets` is ALREADY the effective map by the time `cleanSettings` is done
    // with it (its own header explains why) — this is the identity that makes that claim
    // measured rather than asserted, over a genuinely mixed set of overrides.
    const cleaned = cleanSettings({ slaTargets: { CRITICAL: 3, LOW: 120 } });
    expect(effectiveSlaTargets(cleaned)).toEqual(cleaned.slaTargets);
  });

  it("reuses cleanSettings's own overlay decision rather than a second copy of it", () => {
    // Whatever `cleanSettings` decides a raw `slaTargets` field means, `effectiveSlaTargets`
    // decides the same thing given the SAME raw value — because both call the one cleaner.
    const raw = { CRITICAL: "14", HIGH: 0, MEDIUM: 45.6, UNKNOWN: 9 };
    expect(effectiveSlaTargets({ slaTargets: raw })).toEqual(cleanSettings({ slaTargets: raw }).slaTargets);
  });
});

// The S6 fields: syncSchedule, autoCompact, retentionDays. Ownership HAS now migrated —
// `server/scanJobs.ts::autoCompactIfDue()` reads `autoCompact` / `retentionDays` and the
// `AUTO_COMPACT_DAYS` Script Property it used to gate on is gone (S7) — and these tests still
// pin the one thing that must never move across that migration: a fresh Settings object means
// "compaction off", exactly as an unset property did. `test/api.test.ts` pins the same claim
// from the other end, as a behaviour: a sync over default settings compacts zero times.
describe("the S6 battery settings", () => {
  it("default to today's behaviour: compaction off", () => {
    // The iron rule (CLAUDE.md): a knob ships defaulting to today's behaviour. The gate this
    // replaced was an unset AUTO_COMPACT_DAYS on every deployment, which scanJobs.ts read as
    // "off". A Settings default of true here would have flipped that on the migration.
    expect(DEFAULT_SETTINGS.autoCompact).toBe(false);
  });

  it("default the retention window to config.ts's DEFAULT_RETENTION_DAYS", () => {
    expect(DEFAULT_SETTINGS.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("default the sync hour to DEFAULT_SYNC_HOUR, the same constant setup.ts installs", () => {
    expect(DEFAULT_SETTINGS.syncSchedule).toBe(DEFAULT_SYNC_HOUR);
  });

  it("round-trip through cleanSettings and withSettings unchanged", () => {
    const patch = { syncSchedule: 14, autoCompact: true, retentionDays: 60 };
    const s = withSettings(DEFAULT_SETTINGS, patch);
    expect(s.syncSchedule).toBe(14);
    expect(s.autoCompact).toBe(true);
    expect(s.retentionDays).toBe(60);
    // And a second clean of the same object is a no-op — settingsStore.saveSettings cleans
    // on every write, so this is the shape a save-then-load must preserve.
    expect(cleanSettings(s)).toEqual(s);
  });

  it("coerces junk syncSchedule to the default rather than throwing", () => {
    for (const junk of [null, undefined, "noon", 24, -1, 3.5, {}]) {
      expect(cleanSettings({ syncSchedule: junk }).syncSchedule).toBe(DEFAULT_SYNC_HOUR);
    }
    // and a valid boundary hour survives
    expect(cleanSettings({ syncSchedule: 0 }).syncSchedule).toBe(0);
    expect(cleanSettings({ syncSchedule: 23 }).syncSchedule).toBe(23);
  });

  it("coerces junk autoCompact to false — only a literal true turns compaction on", () => {
    for (const junk of [null, undefined, "true", 1, {}, []]) {
      expect(cleanSettings({ autoCompact: junk }).autoCompact).toBe(false);
    }
    expect(cleanSettings({ autoCompact: true }).autoCompact).toBe(true);
  });

  it("coerces junk retentionDays to the default rather than throwing", () => {
    for (const junk of [null, undefined, "soon", NaN, {}, []]) {
      expect(cleanSettings({ retentionDays: junk }).retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    }
  });

  it("clamps an out-of-range retentionDays up to RETENTION_MIN_DAYS in cleanSettings", () => {
    // PINNED CHOICE: cleanSettings clamps (never throws, matching every other field's stage-one
    // contract); validateSettings — which never repairs — is what still rejects a value below
    // the floor on a hand-built Settings that skipped stage one.
    expect(cleanSettings({ retentionDays: 1 }).retentionDays).toBe(RETENTION_MIN_DAYS);
    expect(cleanSettings({ retentionDays: 0 }).retentionDays).toBe(RETENTION_MIN_DAYS);
    expect(cleanSettings({ retentionDays: -50 }).retentionDays).toBe(RETENTION_MIN_DAYS);
    // floors a fraction, same rule slaTargets already applies
    expect(cleanSettings({ retentionDays: 45.9 }).retentionDays).toBe(45);
  });

  it("validateSettings rejects a below-floor retentionDays it did not clean", () => {
    const s = { ...DEFAULT_SETTINGS, retentionDays: RETENTION_MIN_DAYS - 1 };
    expect(validateSettings(s).join(" ")).toMatch(/retention window/i);
  });

  it("validateSettings rejects an out-of-range syncSchedule it did not clean", () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, syncSchedule: 24 }).join(" "))
      .toMatch(/sync schedule hour/i);
    expect(validateSettings({ ...DEFAULT_SETTINGS, syncSchedule: -1 }).join(" "))
      .toMatch(/sync schedule hour/i);
    expect(validateSettings({ ...DEFAULT_SETTINGS, syncSchedule: 9.5 }).join(" "))
      .toMatch(/sync schedule hour/i);
  });

  it("accepts a valid, in-range Settings with no complaint", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual([]);
  });
});

// =========================================================================================
//  coldAfterDays: the cold-zone window
// =========================================================================================
//
// The one setting whose stage-one coercion is bounded at BOTH ends. `domain/coldZone.ts`
// derives its four idle buckets as thirds of this number and REFUSES a non-positive one, so a
// value that gets past `cleanSettings` reaches a function that throws on it — which makes the
// clamp below the thing standing between a typo and a Repositories page that will not draw.
describe("the cold-zone window", () => {
  it("defaults to config.ts's DEFAULT_COLD_AFTER_DAYS", () => {
    expect(DEFAULT_SETTINGS.coldAfterDays).toBe(DEFAULT_COLD_AFTER_DAYS);
    expect(DEFAULT_COLD_AFTER_DAYS).toBe(90);
  });

  it("coerces junk to the default rather than throwing", () => {
    for (const junk of [null, undefined, "ninety", NaN, {}, [], ""]) {
      expect(cleanSettings({ coldAfterDays: junk }).coldAfterDays).toBe(DEFAULT_COLD_AFTER_DAYS);
    }
  });

  it("CLAMPS a real out-of-range number instead of defaulting it, at either end", () => {
    // The same distinction cleanRetentionDays draws between "missing" and "typed something
    // out of range": an operator who typed 3 asked for the shortest window they could, not
    // for 90, and one who typed 400 asked for the longest.
    expect(cleanSettings({ coldAfterDays: 3 }).coldAfterDays).toBe(COLD_AFTER_DAYS_MIN);
    expect(cleanSettings({ coldAfterDays: 0 }).coldAfterDays).toBe(COLD_AFTER_DAYS_MIN);
    expect(cleanSettings({ coldAfterDays: -50 }).coldAfterDays).toBe(COLD_AFTER_DAYS_MIN);
    expect(cleanSettings({ coldAfterDays: 400 }).coldAfterDays).toBe(COLD_AFTER_DAYS_MAX);
    // and both ends are inclusive — "at least 7", "at most 365", never ">"
    expect(cleanSettings({ coldAfterDays: COLD_AFTER_DAYS_MIN }).coldAfterDays).toBe(COLD_AFTER_DAYS_MIN);
    expect(cleanSettings({ coldAfterDays: COLD_AFTER_DAYS_MAX }).coldAfterDays).toBe(COLD_AFTER_DAYS_MAX);
  });

  it("floors a fraction, the same rule slaTargets and retentionDays already apply", () => {
    expect(cleanSettings({ coldAfterDays: 45.9 }).coldAfterDays).toBe(45);
  });

  it("round-trips through withSettings, and a second clean is a no-op", () => {
    const s = withSettings(DEFAULT_SETTINGS, { coldAfterDays: 120 });
    expect(s.coldAfterDays).toBe(120);
    expect(cleanSettings(s)).toEqual(s);
  });

  it("validateSettings rejects an out-of-range window it did not clean", () => {
    // PINNED CHOICE, same as retentionDays: cleanSettings clamps and never throws;
    // validateSettings — which never repairs — is what rejects a hand-built Settings that
    // skipped stage one.
    expect(validateSettings({ ...DEFAULT_SETTINGS, coldAfterDays: COLD_AFTER_DAYS_MIN - 1 }).join(" "))
      .toMatch(/cold-zone window/i);
    expect(validateSettings({ ...DEFAULT_SETTINGS, coldAfterDays: COLD_AFTER_DAYS_MAX + 1 }).join(" "))
      .toMatch(/cold-zone window/i);
    expect(validateSettings({ ...DEFAULT_SETTINGS, coldAfterDays: NaN }).join(" "))
      .toMatch(/cold-zone window/i);
    // ...and says it the inclusive way the README's bound rule requires.
    const msg = validateSettings({ ...DEFAULT_SETTINGS, coldAfterDays: 1 }).join(" ");
    expect(msg).toMatch(/at least 7 days/);
    expect(msg).not.toMatch(/>/);
  });

  it("effectiveColdAfterDays degrades a PARTIAL settings object to the default", () => {
    // Why this function exists at all: `server/readModels.ts`'s `norm()` reads it off
    // `loadSettings()`, and a settings row (or a test mock) that never went through
    // cleanSettings would otherwise hand `coldZoneProfile` an undefined it refuses.
    expect(effectiveColdAfterDays(undefined)).toBe(DEFAULT_COLD_AFTER_DAYS);
    expect(effectiveColdAfterDays(null)).toBe(DEFAULT_COLD_AFTER_DAYS);
    expect(effectiveColdAfterDays({})).toBe(DEFAULT_COLD_AFTER_DAYS);
    expect(effectiveColdAfterDays({ coldAfterDays: "junk" })).toBe(DEFAULT_COLD_AFTER_DAYS);
    // a saved value wins, and is clamped by the same coercion cleanSettings uses
    expect(effectiveColdAfterDays({ coldAfterDays: 120 })).toBe(120);
    expect(effectiveColdAfterDays({ coldAfterDays: 400 })).toBe(COLD_AFTER_DAYS_MAX);
  });
});

// =========================================================================================
//  The relative cold zone: coldZoneMode, coldTargetSharePct, coldFloorDays
// =========================================================================================
//
// THE THREE FIELDS THAT MUST TRAVEL TOGETHER. `coldZoneProfile` THROWS when the mode is
// "relative" and either number is missing or out of (0, 100] / non-positive — there is no
// default inside the profile, because a share the caller never named is not a share. So the
// property these tests pin is not only "each field cleans correctly" but "the four of them
// come out of ONE door together", which is what `effectiveColdZoneSettings` is.
describe("the cold-zone mode", () => {
  it("defaults to fixed — every deployment that predates this field keeps its behaviour", () => {
    expect(DEFAULT_SETTINGS.coldZoneMode).toBe(DEFAULT_COLD_ZONE_MODE);
    expect(DEFAULT_COLD_ZONE_MODE).toBe("fixed");
    expect([...COLD_ZONE_MODES]).toEqual(["fixed", "relative"]);
  });

  it("FALLS BACK rather than clamping, because a two-member set has no nearest legal value", () => {
    // The distinction this whole block exists for: `coldAfterDays: 400` is CLAMPED to 365
    // because 400 points at an end of a real range; `coldZoneMode: "warm"` points at nothing,
    // so the only honest reading is "nothing was chosen".
    expect(cleanSettings({ coldZoneMode: "warm" }).coldZoneMode).toBe(DEFAULT_COLD_ZONE_MODE);
    expect(cleanSettings({ coldZoneMode: "" }).coldZoneMode).toBe(DEFAULT_COLD_ZONE_MODE);
  });

  it("coerces junk to the default rather than throwing, INCLUDING the String(null) trap", () => {
    // `cleanViewScope`'s documented trap, on the other side of the cast: `String(null)` is
    // "null" and `String({})` is "[object Object]", so a cleaner that cast before checking
    // would be one renamed mode away from reading a non-string as a real answer. This cleaner
    // refuses anything that is not ALREADY a string.
    for (const junk of [null, undefined, 0, 1, NaN, true, false, {}, [], ["relative"]]) {
      expect(cleanSettings({ coldZoneMode: junk }).coldZoneMode).toBe(DEFAULT_COLD_ZONE_MODE);
    }
  });

  it("reads a genuine string trimmed and lowercased, so a hand-edited cell still works", () => {
    expect(cleanSettings({ coldZoneMode: "RELATIVE" }).coldZoneMode).toBe("relative");
    expect(cleanSettings({ coldZoneMode: " relative " }).coldZoneMode).toBe("relative");
    expect(cleanSettings({ coldZoneMode: " Fixed" }).coldZoneMode).toBe("fixed");
  });

  it("round-trips through withSettings, and a second clean is a no-op", () => {
    const s = withSettings(DEFAULT_SETTINGS, { coldZoneMode: "relative" });
    expect(s.coldZoneMode).toBe("relative");
    expect(cleanSettings(s)).toEqual(s);
  });

  it("validateSettings names both modes, since there is no range to state", () => {
    const msg = validateSettings({ ...DEFAULT_SETTINGS, coldZoneMode: "warm" }).join(" ");
    expect(msg).toBe("The cold-zone mode must be either fixed or relative.");
    expect(validateSettings({ ...DEFAULT_SETTINGS, coldZoneMode: "relative" })).toEqual([]);
  });
});

describe("the cold-zone target share", () => {
  it("defaults to config.ts's DEFAULT_COLD_TARGET_SHARE_PCT", () => {
    expect(DEFAULT_SETTINGS.coldTargetSharePct).toBe(DEFAULT_COLD_TARGET_SHARE_PCT);
    expect(DEFAULT_COLD_TARGET_SHARE_PCT).toBe(20);
  });

  it("coerces junk to the default rather than throwing", () => {
    for (const junk of [null, undefined, "a fifth", NaN, {}, [], ""]) {
      expect(cleanSettings({ coldTargetSharePct: junk }).coldTargetSharePct)
        .toBe(DEFAULT_COLD_TARGET_SHARE_PCT);
    }
  });

  it("CLAMPS a real out-of-range number instead of defaulting it, at either end", () => {
    expect(cleanSettings({ coldTargetSharePct: 0 }).coldTargetSharePct).toBe(COLD_TARGET_SHARE_PCT_MIN);
    expect(cleanSettings({ coldTargetSharePct: -5 }).coldTargetSharePct).toBe(COLD_TARGET_SHARE_PCT_MIN);
    expect(cleanSettings({ coldTargetSharePct: 80 }).coldTargetSharePct).toBe(COLD_TARGET_SHARE_PCT_MAX);
    expect(cleanSettings({ coldTargetSharePct: 100 }).coldTargetSharePct).toBe(COLD_TARGET_SHARE_PCT_MAX);
    // both ends inclusive — "at least 1%", "at most 50%", never ">"
    expect(cleanSettings({ coldTargetSharePct: COLD_TARGET_SHARE_PCT_MIN }).coldTargetSharePct)
      .toBe(COLD_TARGET_SHARE_PCT_MIN);
    expect(cleanSettings({ coldTargetSharePct: COLD_TARGET_SHARE_PCT_MAX }).coldTargetSharePct)
      .toBe(COLD_TARGET_SHARE_PCT_MAX);
  });

  it("floors a fraction, the same rule every other numeric field applies", () => {
    expect(cleanSettings({ coldTargetSharePct: 12.9 }).coldTargetSharePct).toBe(12);
  });

  it("round-trips through withSettings, and a second clean is a no-op", () => {
    const s = withSettings(DEFAULT_SETTINGS, { coldTargetSharePct: 35 });
    expect(s.coldTargetSharePct).toBe(35);
    expect(cleanSettings(s)).toEqual(s);
  });

  it("validateSettings states the range inclusively", () => {
    const msg = validateSettings({ ...DEFAULT_SETTINGS, coldTargetSharePct: 0 }).join(" ");
    expect(msg).toBe("The cold-zone target share must be at least 1% and at most 50%.");
    expect(msg).not.toMatch(/>/);
    expect(validateSettings({ ...DEFAULT_SETTINGS, coldTargetSharePct: 80 }).join(" "))
      .toMatch(/cold-zone target share/i);
    expect(validateSettings({ ...DEFAULT_SETTINGS, coldTargetSharePct: NaN }).join(" "))
      .toMatch(/cold-zone target share/i);
  });
});

describe("the cold-zone floor", () => {
  it("defaults to config.ts's DEFAULT_COLD_FLOOR_DAYS", () => {
    expect(DEFAULT_SETTINGS.coldFloorDays).toBe(DEFAULT_COLD_FLOOR_DAYS);
    expect(DEFAULT_COLD_FLOOR_DAYS).toBe(14);
  });

  it("coerces junk to the default rather than throwing", () => {
    for (const junk of [null, undefined, "a fortnight", NaN, {}, [], ""]) {
      expect(cleanSettings({ coldFloorDays: junk }).coldFloorDays).toBe(DEFAULT_COLD_FLOOR_DAYS);
    }
  });

  it("CLAMPS a real out-of-range number instead of defaulting it, at either end", () => {
    expect(cleanSettings({ coldFloorDays: 0 }).coldFloorDays).toBe(COLD_FLOOR_DAYS_MIN);
    expect(cleanSettings({ coldFloorDays: -9 }).coldFloorDays).toBe(COLD_FLOOR_DAYS_MIN);
    expect(cleanSettings({ coldFloorDays: 900 }).coldFloorDays).toBe(COLD_FLOOR_DAYS_MAX);
    expect(cleanSettings({ coldFloorDays: COLD_FLOOR_DAYS_MIN }).coldFloorDays).toBe(COLD_FLOOR_DAYS_MIN);
    expect(cleanSettings({ coldFloorDays: COLD_FLOOR_DAYS_MAX }).coldFloorDays).toBe(COLD_FLOOR_DAYS_MAX);
    // the ceiling is the fixed window's own, so a floor can never outrun the longest window
    expect(COLD_FLOOR_DAYS_MAX).toBe(COLD_AFTER_DAYS_MAX);
  });

  it("floors a fraction", () => {
    expect(cleanSettings({ coldFloorDays: 21.7 }).coldFloorDays).toBe(21);
  });

  it("round-trips through withSettings, and a second clean is a no-op", () => {
    const s = withSettings(DEFAULT_SETTINGS, { coldFloorDays: 30 });
    expect(s.coldFloorDays).toBe(30);
    expect(cleanSettings(s)).toEqual(s);
  });

  it("validateSettings states the range inclusively", () => {
    const msg = validateSettings({ ...DEFAULT_SETTINGS, coldFloorDays: 0 }).join(" ");
    expect(msg).toBe("The cold-zone floor must be at least 1 day and at most 365 days.");
    expect(msg).not.toMatch(/>/);
    expect(validateSettings({ ...DEFAULT_SETTINGS, coldFloorDays: 10_000 }).join(" "))
      .toMatch(/cold-zone floor/i);
    expect(validateSettings({ ...DEFAULT_SETTINGS, coldFloorDays: NaN }).join(" "))
      .toMatch(/cold-zone floor/i);
  });
});

describe("effectiveColdZoneSettings, the one door to coldZoneProfile", () => {
  const ALL_DEFAULTS = {
    mode: DEFAULT_COLD_ZONE_MODE,
    coldAfterDays: DEFAULT_COLD_AFTER_DAYS,
    targetSharePct: DEFAULT_COLD_TARGET_SHARE_PCT,
    floorDays: DEFAULT_COLD_FLOOR_DAYS,
    // FIVE FIELDS NOW, and the fifth is the one that decides WHO is measured rather than where
    // the line falls — which is exactly why it comes out of the same door: a caller that read
    // the mode here and this flag off the settings row could derive a relative line over one
    // population and then draw the table over another.
    excludeEndOfLife: false,
  };

  it("degrades nothing at all to the five shared defaults", () => {
    // The case that makes this function load-bearing rather than tidy: readModels.test.ts's
    // `loadSettings()` mock returns a PARTIAL settings object, and `coldZoneProfile` throws on
    // a relative mode with no target. Four fields out of one call is what makes "a mode with
    // nothing to aim at" unconstructible.
    expect(effectiveColdZoneSettings(null)).toEqual(ALL_DEFAULTS);
    expect(effectiveColdZoneSettings(undefined)).toEqual(ALL_DEFAULTS);
    expect(effectiveColdZoneSettings({})).toEqual(ALL_DEFAULTS);
  });

  it("fills in the fields a PARTIAL object left out, keeping the ones it carries", () => {
    // Exactly the shape the server's mock hands it: a mode and nothing else. The mode is
    // honoured AND the two numbers it makes mandatory arrive with it.
    expect(effectiveColdZoneSettings({ coldZoneMode: "relative" })).toEqual({
      ...ALL_DEFAULTS, mode: "relative",
    });
    expect(effectiveColdZoneSettings({ coldAfterDays: 120 })).toEqual({
      ...ALL_DEFAULTS, coldAfterDays: 120,
    });
    expect(effectiveColdZoneSettings({ coldTargetSharePct: 35, coldFloorDays: 30 })).toEqual({
      ...ALL_DEFAULTS, targetSharePct: 35, floorDays: 30,
    });
  });

  it("applies each field's own cleaner — junk defaults, a real number is clamped", () => {
    expect(effectiveColdZoneSettings({
      coldZoneMode: " RELATIVE ", coldAfterDays: 400, coldTargetSharePct: 80, coldFloorDays: 0,
      excludeEndOfLife: true,
    })).toEqual({
      mode: "relative",
      coldAfterDays: COLD_AFTER_DAYS_MAX,
      targetSharePct: COLD_TARGET_SHARE_PCT_MAX,
      floorDays: COLD_FLOOR_DAYS_MIN,
      excludeEndOfLife: true,
    });
    expect(effectiveColdZoneSettings({
      coldZoneMode: "warm", coldAfterDays: "junk", coldTargetSharePct: {}, coldFloorDays: [],
      // ONLY A LITERAL `true` EXCLUDES. Deleting repositories from a page on the strength of a
      // truthy string is the one coercion this field must never make.
      excludeEndOfLife: "true",
    })).toEqual(ALL_DEFAULTS);
    expect(effectiveColdZoneSettings({ excludeEndOfLife: 1 }).excludeEndOfLife).toBe(false);
    expect(effectiveColdZoneSettings({ excludeEndOfLife: true }).excludeEndOfLife).toBe(true);
  });

  it("reads a real Settings object back unchanged", () => {
    const s = withSettings(DEFAULT_SETTINGS, {
      coldZoneMode: "relative", coldAfterDays: 120, coldTargetSharePct: 35, coldFloorDays: 30,
      excludeEndOfLife: true,
    });
    expect(effectiveColdZoneSettings(s)).toEqual({
      mode: "relative", coldAfterDays: 120, targetSharePct: 35, floorDays: 30,
      excludeEndOfLife: true,
    });
  });

  it("is what effectiveColdAfterDays is now built on, so the two cannot drift", () => {
    // `effectiveColdAfterDays` kept its exact old contract while gaining a single shared
    // implementation — one coercion of `coldAfterDays` exists in this module's exported
    // surface, so there is nothing for the two functions to disagree about.
    for (const input of [null, undefined, {}, { coldAfterDays: "junk" }, { coldAfterDays: 120 },
      { coldAfterDays: 400 }, { coldAfterDays: 1 }, DEFAULT_SETTINGS]) {
      expect(effectiveColdAfterDays(input)).toBe(effectiveColdZoneSettings(input).coldAfterDays);
    }
  });
});

// projectView: the VIEW scope — which project the pages SHOW, distinct from WIZ_PROJECT_ID_V2
// (the FETCH scope, which stays a Script Property and is never added here — see
// settingsLogic.ts's own header). "" means no scope: show the whole register.
describe("projectView, the view scope", () => {
  it("defaults to \"\" — no scope, the whole register", () => {
    expect(DEFAULT_SETTINGS.projectView).toBe("");
  });

  it("cleanSettings coerces junk to \"\", never to its stringified self", () => {
    // The trap this guards: String(null) is "null", String(undefined) is "undefined",
    // String(0) is "0", String(false) is "false", String({}) is "[object Object]" — a naive
    // `String(v)` cast would turn every one of these into a value that READS as a real (if
    // odd) project slug instead of "nothing was stored here".
    for (const junk of [null, undefined, 0, [], {}, false]) {
      const cleaned = cleanSettings({ projectView: junk }).projectView;
      expect(cleaned, `projectView(${JSON.stringify(junk)}) -> ${JSON.stringify(cleaned)}`).toBe("");
    }
  });

  it("keeps a valid slug through a cleanSettings round trip", () => {
    expect(cleanSettings({ projectView: "value-chain" }).projectView).toBe("value-chain");
  });

  it("trims surrounding whitespace on a stored slug", () => {
    expect(cleanSettings({ projectView: "  value-chain  " }).projectView).toBe("value-chain");
  });

  it("is not validated against any catalogue — any string, including a stale one, is accepted", () => {
    const s = { ...DEFAULT_SETTINGS, projectView: "a-project-that-no-longer-exists" };
    expect(validateSettings(s)).toEqual([]);
  });

  it("withSettings patching an unrelated field leaves projectView intact", () => {
    const withScope = cleanSettings({ ...DEFAULT_SETTINGS, projectView: "value-chain" });
    const patched = withSettings(withScope, { autoCompact: true });
    expect(patched.projectView).toBe("value-chain");
    expect(patched.autoCompact).toBe(true);
  });

  it("withSettings can also patch projectView alone, leaving every other field untouched", () => {
    const patched = withSettings(DEFAULT_SETTINGS, { projectView: "value-chain" });
    expect(patched.projectView).toBe("value-chain");
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key === "projectView") continue;
      expect(patched[key]).toEqual(DEFAULT_SETTINGS[key]);
    }
  });

  it("clearing projectView back to \"\" survives a round trip", () => {
    const withScope = cleanSettings({ ...DEFAULT_SETTINGS, projectView: "value-chain" });
    const cleared = withSettings(withScope, { projectView: "" });
    expect(cleared.projectView).toBe("");
  });
});

// =========================================================================================
// tabStatus (P7): per-tab dirty/invalid state for the Settings tablist
// =========================================================================================
//
// A field changed or invalid on a HIDDEN tab was only discoverable through the save bar's
// "Jump to error" — a reader had to open Register, Deadlines and System in turn to find out
// which one actually held the unsaved or illegal state. tabStatus() answers that per tab,
// off TAB_FIELDS, the same field->tab map pages/settings.js's own FIELD_TABS now re-exports
// (see the comment there) so the tablist and the save bar can never name a field under two
// different tabs.
describe("tabStatus: per-tab dirty and invalid state", () => {
  const saved = draftFromSettings(DEFAULT_SETTINGS);

  it("TAB_FIELDS names exactly the seven real batched fields, and only real tab keys", () => {
    // The "cannot drift" claim, checked as data rather than assumed: the pure module's map
    // and the DOM half's own BATCHED_KEYS (pages/settings.js's Object.keys(FIELD_TABS), which
    // is now `= TAB_FIELDS`) must name the exact same field set.
    expect(Object.keys(TAB_FIELDS).sort()).toEqual([...BATCHED_KEYS].sort());
    const tabKeys = new Set(TABS.map((t) => t.key));
    for (const [field, tab] of Object.entries(TAB_FIELDS)) {
      expect(tabKeys.has(tab), `TAB_FIELDS.${field} names an unknown tab "${tab}"`).toBe(true);
    }
  });

  it("(a) a field changed on one tab marks ONLY that tab dirty", () => {
    // slaTargets is owned by "deadlines" (TAB_FIELDS.slaTargets). Changing it must not mark
    // "register" or "system" dirty, and must not mark anything invalid.
    const draft = draftFromSettings(DEFAULT_SETTINGS);
    draft.slaTargets = { ...draft.slaTargets, HIGH: draft.slaTargets.HIGH + 1 };
    const status = tabStatus(draft, saved, {}, TAB_FIELDS);
    expect(status.deadlines.dirty).toBe(true);
    expect(status.register.dirty).toBe(false);
    expect(status.system.dirty).toBe(false);
    for (const tab of Object.keys(status)) expect(status[tab].invalid).toBe(false);
  });

  it("(b) a field changed then changed back to the SAVED value is dirty nowhere", () => {
    // A save having already happened mid-session, so "saved" and "the value at initial page
    // load" are genuinely DIFFERENT objects — the distinction tabStatus's own docstring draws
    // ("saved MUST be the last-SAVED snapshot, never the initial-load one"). A test that only
    // ever reverts to the ORIGINAL load value could pass even if tabStatus quietly compared
    // against the wrong one, since the two would be identical; this one cannot.
    const initialLoad = draftFromSettings(DEFAULT_SETTINGS);
    const afterFirstSave = draftFromSettings(DEFAULT_SETTINGS);
    afterFirstSave.retentionDays = initialLoad.retentionDays + 10; // what actually got saved
    const draft = draftFromSettings(DEFAULT_SETTINGS);
    draft.retentionDays = afterFirstSave.retentionDays + 5; // change again
    draft.retentionDays = afterFirstSave.retentionDays; // revert to what was ACTUALLY saved
    const status = tabStatus(draft, afterFirstSave, {}, TAB_FIELDS);
    for (const tab of Object.keys(status)) {
      expect(status[tab].dirty, `${tab} read dirty after a revert to the saved value`).toBe(false);
    }
  });

  it("(c) an error on a tab-2 (deadlines) field marks ONLY that tab invalid", () => {
    const draft = draftFromSettings(DEFAULT_SETTINGS); // draft itself stays legal/unchanged
    const status = tabStatus(draft, saved, { slaTargets: "not a positive number of days" }, TAB_FIELDS);
    expect(status.deadlines.invalid).toBe(true);
    expect(status.register.invalid).toBe(false);
    expect(status.system.invalid).toBe(false);
    // and NOT dirty — draft never changed, so an in-progress bad keystroke that never
    // committed is invalid without being dirty, the case that makes the two flags independent.
    expect(status.deadlines.dirty).toBe(false);
  });

  it("(d) every TAB_FIELDS key is a real Settings field, and every batched field the page's "
    + "OWN SOURCE actually reads/writes via `draft.<field>` is named in TAB_FIELDS", () => {
    // "exists in the settings shape": every key TAB_FIELDS names is a real property of a
    // cleaned Settings object.
    for (const field of Object.keys(TAB_FIELDS)) {
      expect(
        Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, field),
        `TAB_FIELDS names "${field}", which is not a real Settings field`,
      ).toBe(true);
    }
    // "in exactly one tab", checked against the PAGE'S OWN SOURCE TEXT rather than against
    // BATCHED_KEYS: BATCHED_KEYS is `Object.keys(FIELD_TABS)` and FIELD_TABS is now `=
    // TAB_FIELDS` (the same object, not a copy), so a field dropped from TAB_FIELDS drops
    // out of BATCHED_KEYS in lockstep and a TAB_FIELDS-vs-BATCHED_KEYS comparison can never
    // catch that removal — a guard that fires on nothing. Grepping the DOM half's own
    // `draft.<field>` reads/writes is independent of TAB_FIELDS's own definition: the seven
    // fields below are how each panel builder actually reads and mutates the draft, and stay
    // in the source even if TAB_FIELDS is edited.
    const fieldsSourceActuallyDrivesTheDraftFor = [
      "scopes", "fetchSeverities", "slaTargets", "coldAfterDays",
      // The cold-zone mode and the two numbers only relative mode reads. All three are driven
      // from the Deadlines panel exactly as `coldAfterDays` is — the mode's `segmented`
      // onChange writes `draft.coldZoneMode`, the two number inputs write their own fields —
      // so all three belong in this sweep, and in TAB_FIELDS.
      "coldZoneMode", "coldTargetSharePct", "coldFloorDays",
      // The fifth cold-zone field, driven from the same panel by a `switchToggle` rather than
      // by a number input — and the only one of the five that is not read by a mode branch, so
      // it is on screen in both modes and belongs in this sweep for both.
      "excludeEndOfLife",
      "syncSchedule", "autoCompact", "retentionDays",
    ];
    for (const field of fieldsSourceActuallyDrivesTheDraftFor) {
      const re = new RegExp(`draft\\.${field}\\b`);
      expect(re.test(SETTINGS_PAGE_SRC), `settings.js never reads/writes draft.${field}`).toBe(true);
      expect(
        Object.prototype.hasOwnProperty.call(TAB_FIELDS, field),
        `settings.js drives draft.${field} but TAB_FIELDS does not name it`,
      ).toBe(true);
    }
    // and nothing extra: TAB_FIELDS names exactly this set, not a superset with a stray or
    // stale field.
    expect(Object.keys(TAB_FIELDS).sort()).toEqual([...fieldsSourceActuallyDrivesTheDraftFor].sort());
  });

  it("a tab owning no field (access) never appears, so it is never dirty or invalid by "
    + "construction", () => {
    const draft = draftFromSettings(DEFAULT_SETTINGS);
    draft.scopes = [...draft.scopes].reverse().concat("bogus-marker-removed-below");
    draft.scopes = [...saved.scopes]; // no real change, just exercising the path
    const status = tabStatus(draft, saved, { notARealField: "x" }, TAB_FIELDS);
    expect(status.access).toBeUndefined();
  });

  // PERTURBATION 1 (actually performed against src/client/js/settingsModel.js, then
  // reverted): tabStatus's `dirty` check was changed to compare against the FIRST `saved`
  // object the module ever saw (a module-level `__PERTURBATION_1_initialLoad`, cached on
  // first call and reused forever) instead of the `saved` argument on every call — i.e. an
  // initial-load snapshot standing in for the current saved state.
  //
  // Case (b) above is deliberately built so `saved` and "the value at initial load" are TWO
  // DIFFERENT objects (`afterFirstSave` models a save that already moved retentionDays past
  // what a first-ever load would have shown), specifically so this perturbation has something
  // to bite: a version of (b) that only ever reverted to the ORIGINAL load value could pass
  // even while comparing against the wrong snapshot, since the two would then be identical.
  //
  // MEASURED RESULT (`npx vitest run test/settingsLogic.test.js`): 1 of 40 tests in the file
  // failed — exactly case (b) — `AssertionError: system read dirty after a revert to the
  // saved value: expected true to be false`. Cases (a), (c), (d) and the access-tab test all
  // pass `saved` (the describe-scope snapshot) on their first-ever call to tabStatus in the
  // run, so the cache seeds itself correctly for them and they stayed green; only (b), which
  // supplies a DIFFERENT `saved` (`afterFirstSave`) than the one already cached, is exposed.
  // Reverted immediately after the observation; `test/settingsLogic.test.js` was back to
  // 40/40 green on the next run.
  //
  // PERTURBATION 2 (actually performed against src/client/js/settingsModel.js, then
  // reverted): `retentionDays: "system"` was deleted from TAB_FIELDS.
  //
  // The FIRST version of test (d) compared `BATCHED_KEYS.length` against
  // `Object.keys(TAB_FIELDS).length` — and it did NOT catch this. pages/settings.js's own
  // `FIELD_TABS` is now `= TAB_FIELDS` (the same object reference, not a copy — the whole
  // point of the "cannot drift" design), so `BATCHED_KEYS` (`Object.keys(FIELD_TABS)`) shrinks
  // in lockstep with `TAB_FIELDS` and the two can never disagree in length. That IS the guard
  // that fires on nothing CLAUDE.md warns about, caught by actually running the perturbation
  // rather than by inspection — test (d) was rewritten to grep pages/settings.js's own SOURCE
  // TEXT for `draft.retentionDays` (independent of TAB_FIELDS's own definition: the DOM code
  // that reads and writes `draft.retentionDays` stays in the file even when the map forgets
  // it) and assert every such field is named in TAB_FIELDS.
  //
  // MEASURED RESULT with the rewritten test
  // (`npx vitest run test/settingsLogic.test.js test/pagesSettings.test.js`): 2 of 89 tests
  // failed. Test (d) above: `settings.js drives draft.retentionDays but TAB_FIELDS does not
  // name it: expected false to be true`. The second failure is OUTSIDE this file, in
  // test/pagesSettings.test.js's own pre-existing "BATCHED_KEYS is six of the seven fields"
  // assertion — an EXPECTED and CORRECT consequence, not a side effect to explain away: it is
  // the DOM half (BATCHED_KEYS, unedited by this package) actually breaking because TAB_FIELDS
  // is its single source of truth now, which is the "cannot drift" property working end to
  // end rather than a coincidence. The other 87 tests, including the other four cases in this
  // block, stayed green — (a)/(b)/(c) exercise `slaTargets`, not `retentionDays`, so a hole in
  // TAB_FIELDS for an unrelated field is invisible to them. Reverted immediately after the
  // observation; both files were back to fully green (40/40, 49/49) on the next run.
});
