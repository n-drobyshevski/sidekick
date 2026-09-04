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
  DEFAULT_SETTINGS, DEFAULT_SYNC_HOUR, cleanSettings, validateSettings, withSettings,
} from "../src/domain/settingsLogic";
import { DEFAULT_FETCH_SEVERITIES, DEFAULT_RETENTION_DAYS, SCOPES } from "../src/domain/config";
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

  it("TAB_FIELDS names exactly the six real batched fields, and only real tab keys", () => {
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
    // `draft.<field>` reads/writes is independent of TAB_FIELDS's own definition: the six
    // fields below are how each panel builder actually reads and mutates the draft, and stay
    // in the source even if TAB_FIELDS is edited.
    const fieldsSourceActuallyDrivesTheDraftFor = [
      "scopes", "fetchSeverities", "slaTargets", "syncSchedule", "autoCompact", "retentionDays",
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
