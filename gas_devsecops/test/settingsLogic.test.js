// Settings semantics, and one migration that has to be right the first time.
//
// fetchSeverities was a single flat array applied to every scope until PROBE_FINDINGS.md
// §8.3 showed what that costs: CRITICAL/HIGH inherited from the vulnerability registers
// deletes PASSWORD 209 -> 0 and CERTIFICATE 160 -> 0 from the secrets register, so it
// contains no passwords at all. It is now a record. Any deployment that has saved settings
// still holds the array, and it must not be silently reset.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, cleanSettings, validateSettings, withSettings,
} from "../src/domain/settingsLogic";
import { DEFAULT_FETCH_SEVERITIES, SCOPES } from "../src/domain/config";

describe("the per-scope severity defaults", () => {
  it("keeps CRITICAL/HIGH on the vulnerability registers", () => {
    expect(DEFAULT_FETCH_SEVERITIES.sca).toEqual(["CRITICAL", "HIGH"]);
    expect(DEFAULT_FETCH_SEVERITIES.sast).toEqual(["CRITICAL", "HIGH"]);
  });

  it("reaches to MEDIUM on secrets, because the estate's passwords sit below HIGH", () => {
    // PROVISIONAL. §8.3 established those 369 rows are below HIGH, not that they are AT
    // MEDIUM. If the crosstab says LOW, this list is still wrong and the register still has
    // no passwords in it — which is the failure this default exists to fix.
    expect(DEFAULT_FETCH_SEVERITIES.secrets).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
    expect(DEFAULT_FETCH_SEVERITIES.secrets.length)
      .toBeGreaterThan(DEFAULT_FETCH_SEVERITIES.sca.length);
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
    // The point of the record: a missing scope takes ITS OWN default, not another's.
    const s = cleanSettings({ fetchSeverities: { sca: ["CRITICAL"] } });
    expect(s.fetchSeverities.sca).toEqual(["CRITICAL"]);
    expect(s.fetchSeverities.secrets).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
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
