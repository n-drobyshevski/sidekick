// Settings semantics, and one migration that has to be right the first time.
//
// fetchSeverities was a single flat array applied to every scope until PROBE_FINDINGS.md
// §8.3 showed what that costs: CRITICAL/HIGH inherited from the vulnerability registers
// deletes PASSWORD 209 -> 0 and CERTIFICATE 160 -> 0 from the secrets register, so it
// contains no passwords at all. It is now a record. Any deployment that has saved settings
// still holds the array, and it must not be silently reset.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, DEFAULT_SYNC_HOUR, cleanSettings, validateSettings, withSettings,
} from "../src/domain/settingsLogic";
import { DEFAULT_FETCH_SEVERITIES, DEFAULT_RETENTION_DAYS, SCOPES } from "../src/domain/config";
import { RETENTION_MIN_DAYS } from "../src/domain/maintenance";

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

// The S6 fields: syncSchedule, autoCompact, retentionDays. `server/scanJobs.ts` already gates
// post-sync compaction on the Script Property AUTO_COMPACT_DAYS, unset = off, and these tests
// pin the one thing that must never move while that ownership migrates: a fresh Settings
// object still means "compaction off" exactly like an unset property does today.
describe("the S6 battery settings", () => {
  it("default to today's behaviour: compaction off", () => {
    // The iron rule (CLAUDE.md): a knob ships defaulting to today's behaviour. Today,
    // AUTO_COMPACT_DAYS is unset on every deployment, which scanJobs.ts reads as "off". A
    // Settings default of true here would flip that the moment ownership migrates to it.
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
