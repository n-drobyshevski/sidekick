// The Settings draft model: what counts as a change, who owns it, and what the page refuses
// to send. Pure logic, so it is pinned here rather than through a DOM.

import { describe, expect, it } from "vitest";
import {
  changeCountText,
  COLD_AFTER_DAYS_MAX,
  COLD_AFTER_DAYS_MIN,
  COLD_FLOOR_DAYS_MAX,
  COLD_FLOOR_DAYS_MIN,
  COLD_MODES,
  COLD_TARGET_SHARE_PCT_MAX,
  COLD_TARGET_SHARE_PCT_MIN,
  DEFAULT_COLD_AFTER_DAYS,
  DEFAULT_COLD_FLOOR_DAYS,
  DEFAULT_COLD_TARGET_SHARE_PCT,
  DEFAULT_COLD_ZONE_MODE,
  changeSummary,
  changedFields,
  clampDisplayToFetch,
  DEFAULT_TAB,
  draftWarnings,
  fieldErrors,
  normalizeTab,
  SETTING_FIELDS,
  SETTING_KEYS,
  SETTINGS_TABS,
  settingsDraft,
  settingsPatch,
  TAB_FIELDS,
  tabStatus,
  validateDraft,
} from "../src/client/js/settingsModel.js";
import * as config from "../src/domain/config";

const BOOT = {
  fetchSeverities: ["CRITICAL", "HIGH", "MEDIUM"],
  displaySeverities: ["CRITICAL", "HIGH"],
  showNoFix: true,
  includeEol: true,
  riskRule: { version: 3, rule: { kev: true, exploit: true, epss: true, epssThreshold: 0.1 } },
  retentionDays: 180,
  autoCompact: true,
};

const draft = () => settingsDraft(BOOT);

describe("settingsDraft", () => {
  it("lifts boot.settings into a flat draft over exactly the owned keys", () => {
    expect(Object.keys(draft()).sort()).toEqual([...SETTING_KEYS].sort());
  });

  it("copies rather than aliases, so editing a draft cannot mutate the bootstrap payload", () => {
    const boot = JSON.parse(JSON.stringify(BOOT));
    const d = settingsDraft(boot);
    d.fetchSeverities.push("LOW");
    d.riskRule.kev = false;
    expect(boot.fetchSeverities).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
    expect(boot.riskRule.rule.kev).toBe(true);
  });

  it("treats an absent boolean as on, matching the server's `!== false` defaults", () => {
    const d = settingsDraft({ ...BOOT, showNoFix: undefined, includeEol: undefined });
    expect(d.showNoFix).toBe(true);
    expect(d.includeEol).toBe(true);
  });

  it("keeps retention null distinct from zero — null means sealing is off", () => {
    expect(settingsDraft({ ...BOOT, retentionDays: null }).retentionDays).toBeNull();
    expect(settingsDraft({ ...BOOT, retentionDays: 0 }).retentionDays).toBe(0);
  });
});

describe("changedFields", () => {
  it("is empty for an untouched draft", () => {
    expect(changedFields(draft(), draft())).toEqual([]);
  });

  it("reports only what moved", () => {
    const d = draft();
    d.showNoFix = false;
    expect(changedFields(draft(), d)).toEqual(["showNoFix"]);
  });

  it("sees inside the risk rule", () => {
    const d = draft();
    d.riskRule.epssThreshold = 0.05;
    expect(changedFields(draft(), d)).toEqual(["riskRule"]);
  });

  it("does not count a reordered severity list as an edit", () => {
    const d = draft();
    d.fetchSeverities = ["MEDIUM", "CRITICAL", "HIGH"];
    expect(changedFields(draft(), d)).toEqual([]);
  });

  it("does count an added or removed severity", () => {
    const d = draft();
    d.fetchSeverities = ["CRITICAL", "HIGH"];
    expect(changedFields(draft(), d)).toEqual(["fetchSeverities"]);
  });
});

describe("settingsPatch", () => {
  it("carries only the changed fields, so a save writes nothing it was not asked to", () => {
    const d = draft();
    d.autoCompact = false;
    d.riskRule.kev = false;
    expect(settingsPatch(draft(), d)).toEqual({
      riskRule: { kev: false, exploit: true, epss: true, epssThreshold: 0.1 },
      autoCompact: false,
    });
  });

  it("is empty when nothing moved", () => {
    expect(settingsPatch(draft(), draft())).toEqual({});
  });
});

describe("tab ownership", () => {
  it("assigns every owned field to a real tab", () => {
    const keys = SETTINGS_TABS.map((t) => t.key);
    for (const [field, meta] of Object.entries(SETTING_FIELDS)) {
      expect(keys, `${field} names a tab that exists`).toContain(meta.tab);
    }
  });

  it("names the owning tab for each change so a hidden edit stays findable", () => {
    const d = draft();
    d.riskRule.epssThreshold = 0.3;
    expect(changeSummary(changedFields(draft(), d))).toEqual([
      { field: "riskRule", label: "high-risk classifier", tab: "risk", tabLabel: "Risk" },
    ]);
  });

  it("counts changes in plain words", () => {
    expect(changeCountText([])).toBe("0 unsaved changes");
    expect(changeCountText(["showNoFix"])).toBe("1 unsaved change");
    expect(changeCountText(["showNoFix", "includeEol"])).toBe("2 unsaved changes");
  });
});

describe("normalizeTab", () => {
  it("accepts a real tab key", () => {
    expect(normalizeTab("risk")).toBe("risk");
  });

  it("falls back rather than rendering an empty page for a junk deep link", () => {
    expect(normalizeTab("nonsense")).toBe(DEFAULT_TAB);
    expect(normalizeTab(undefined)).toBe(DEFAULT_TAB);
    expect(normalizeTab("")).toBe(DEFAULT_TAB);
  });
});

describe("validateDraft", () => {
  it("passes the shipped defaults", () => {
    expect(validateDraft(draft()).ok).toBe(true);
  });

  it("refuses an empty scan scope", () => {
    const d = draft();
    d.fetchSeverities = [];
    const v = validateDraft(d);
    expect(v.ok).toBe(false);
    expect(v.tab).toBe("register");
  });

  it("refuses an empty display filter", () => {
    const d = draft();
    d.displaySeverities = [];
    expect(validateDraft(d).ok).toBe(false);
  });

  it("refuses a display severity outside the scan scope, and names it", () => {
    const d = draft();
    d.displaySeverities = ["CRITICAL", "LOW"];
    const v = validateDraft(d);
    expect(v.ok).toBe(false);
    expect(v.message).toContain("LOW");
  });

  it("refuses an EPSS threshold outside [0,1] and points at the Risk tab", () => {
    for (const bad of [-0.1, 1.5, Number.NaN]) {
      const d = draft();
      d.riskRule.epssThreshold = bad;
      const v = validateDraft(d);
      expect(v.ok, String(bad)).toBe(false);
      expect(v.tab).toBe("risk");
    }
  });

  it("accepts the inclusive bounds of the EPSS threshold", () => {
    for (const ok of [0, 1]) {
      const d = draft();
      d.riskRule.epssThreshold = ok;
      expect(validateDraft(d).ok, String(ok)).toBe(true);
    }
  });

  it("refuses a retention window under the 30-day floor", () => {
    const d = draft();
    d.retentionDays = 7;
    const v = validateDraft(d);
    expect(v.ok).toBe(false);
    expect(v.tab).toBe("lifecycle");
  });

  it("ignores the retention floor when sealing is off", () => {
    const d = draft();
    d.retentionDays = null;
    expect(validateDraft(d).ok).toBe(true);
  });
});

describe("draftWarnings", () => {
  it("says nothing about an ordinary edit", () => {
    const d = draft();
    d.autoCompact = false;
    expect(draftWarnings(draft(), d)).toEqual([]);
  });

  it("asks before dropping CRITICAL out of the scan scope", () => {
    const d = draft();
    d.fetchSeverities = ["HIGH", "MEDIUM"];
    const w = draftWarnings(draft(), d);
    expect(w).toHaveLength(1);
    expect(w[0].tab).toBe("register");
  });

  it("does not ask again when CRITICAL was already out before the edit", () => {
    const saved = settingsDraft({ ...BOOT, fetchSeverities: ["HIGH"], displaySeverities: ["HIGH"] });
    const d = settingsDraft({ ...BOOT, fetchSeverities: ["HIGH", "MEDIUM"], displaySeverities: ["HIGH"] });
    expect(draftWarnings(saved, d)).toEqual([]);
  });

  it("asks before saving a rule that decides nothing, and does not rescue it", () => {
    const d = draft();
    d.riskRule = { kev: false, exploit: false, epss: false, epssThreshold: 0.1 };
    const w = draftWarnings(draft(), d);
    expect(w).toHaveLength(1);
    expect(w[0].tab).toBe("risk");
    // The warning is a confirm, not a repair: the draft is handed back untouched.
    expect(d.riskRule.kev).toBe(false);
  });

  it("can raise both at once", () => {
    const d = draft();
    d.fetchSeverities = ["HIGH", "MEDIUM"];
    d.riskRule = { kev: false, exploit: false, epss: false, epssThreshold: 0.1 };
    expect(draftWarnings(draft(), d)).toHaveLength(2);
  });
});

describe("fieldErrors", () => {
  it("is all-null for the shipped defaults", () => {
    const errs = fieldErrors(draft());
    expect(Object.values(errs).every((v) => v === null)).toBe(true);
  });

  it("names every field validateDraft would have stopped at, independently and all at once", () => {
    // Two breakages that do NOT interact — fetchSeverities/displaySeverities are left legal —
    // so both fire independently rather than one masking the other in priority order.
    const d = draft();
    d.riskRule.epssThreshold = 5;
    d.retentionDays = 7;
    const errs = fieldErrors(d);
    expect(errs.riskRule).toContain("between 0 and 1");
    expect(errs.retentionDays).toContain("30 days");
    expect(errs.fetchSeverities).toBeNull();
    expect(errs.displaySeverities).toBeNull();
  });

  it("a broken scan scope also breaks the display filter that now sits outside it, and names both", () => {
    // NOT independent, and rightly so: draining fetchSeverities to [] makes every surviving
    // displaySeverities entry a "stray" (outside the new, empty scope) by the same subset
    // rule validateDraft enforces — this is the real interdependency, not a bug.
    const d = draft();
    d.fetchSeverities = [];
    const errs = fieldErrors(d);
    expect(errs.fetchSeverities).toContain("scan scope");
    expect(errs.displaySeverities).toContain("CRITICAL");
  });

  it("is what validateDraft's own priority order is now built from", () => {
    // Two independent breakages; validateDraft reports only the higher-priority one, but
    // fieldErrors — which the page uses for inline spans — knows about both.
    const d = draft();
    d.fetchSeverities = [];
    d.retentionDays = 7;
    expect(validateDraft(d).tab).toBe("register"); // fetchSeverities wins the race
    const errs = fieldErrors(d);
    expect(errs.fetchSeverities).toBeTruthy();
    expect(errs.retentionDays).toBeTruthy(); // but the inline span for Lifecycle still lights
  });
});

describe("tabStatus", () => {
  it("is clean for an untouched, valid draft, on every tab that owns a batched field", () => {
    const status = tabStatus(draft(), draft(), {}, TAB_FIELDS);
    for (const tab of new Set(Object.values(TAB_FIELDS))) {
      expect(status[tab], tab).toEqual({ dirty: false, invalid: false });
    }
  });

  it("never mentions a tab that owns no batched field — Attribution and System save "
    + "themselves and are absent by construction, not merely clean", () => {
    const status = tabStatus(draft(), draft(), {}, TAB_FIELDS);
    expect(status.attribution).toBeUndefined();
    expect(status.system).toBeUndefined();
  });

  it("marks dirty and invalid independently — a field can be one without the other", () => {
    const d = draft();
    d.autoCompact = false; // lifecycle: dirty, not invalid
    const status = tabStatus(d, draft(), { fetchSeverities: "bad" }, TAB_FIELDS); // register: invalid, not dirty
    expect(status.lifecycle).toEqual({ dirty: true, invalid: false });
    expect(status.register).toEqual({ dirty: false, invalid: true });
    expect(status.risk).toEqual({ dirty: false, invalid: false });
  });

  it("a field error on tab X marks only X invalid, never a sibling tab", () => {
    const status = tabStatus(draft(), draft(), { riskRule: "bad EPSS" }, TAB_FIELDS);
    expect(status.risk.invalid).toBe(true);
    expect(status.register.invalid).toBe(false);
    expect(status.lifecycle.invalid).toBe(false);
  });

  it("reads errors by KEY PRESENCE — an empty-string message still counts as an error", () => {
    // The documented contract (tabStatus's own header): a caller clears a field by DELETING
    // the key, never by setting it to a falsy value. A value of "" is still present.
    const status = tabStatus(draft(), draft(), { retentionDays: "" }, TAB_FIELDS);
    expect(status.lifecycle.invalid).toBe(true);
  });

  // ========================================================================== perturbation
  //
  // THE CLAIM UNDER TEST: an error is cleared by DELETING its key, and tabStatus must read
  // presence, never truthiness — CLAUDE.md names the general form of this trap three times
  // over for `Number(null)`; here the analogous mistake is `if (errors[field])` instead of
  // `field in errors`. Confirmed to fail before being corrected: with the truthy-read form
  // below and `errors = { retentionDays: "" }` (a field "cleared" the documented way,
  // i.e. set to a falsy placeholder rather than deleted), running
  //   expect(defectiveTabStatus(...).lifecycle.invalid).toBe(true)
  // failed with
  //   AssertionError: expected false to be true
  // because `errors.retentionDays` is `""`, which is falsy, so the truthy read missed it —
  // exactly the case a reader who cleared a field by blanking rather than deleting hits.
  it("a truthiness read instead of key-presence misses a falsy-but-present error", () => {
    function defectiveTabStatus(d, saved, errors, tabFields) {
      const tabs = {};
      for (const tab of new Set(Object.values(tabFields))) tabs[tab] = { dirty: false, invalid: false };
      for (const [field, tab] of Object.entries(tabFields)) {
        if (!tabs[tab]) continue;
        if (JSON.stringify(saved[field]) !== JSON.stringify(d[field])) tabs[tab].dirty = true;
        if (errors[field]) tabs[tab].invalid = true; // THE BUG: truthiness, not presence
      }
      return tabs;
    }

    const errors = { retentionDays: "" }; // present, but a falsy value
    const defective = defectiveTabStatus(draft(), draft(), errors, TAB_FIELDS);
    expect(defective.lifecycle.invalid).toBe(false); // the bug: misses it

    const real = tabStatus(draft(), draft(), errors, TAB_FIELDS);
    expect(real.lifecycle.invalid).toBe(true); // the real implementation does not
  });
});

describe("clampDisplayToFetch", () => {
  it("drops display severities the scan no longer pulls, and reports which", () => {
    const d = draft();
    d.fetchSeverities = ["CRITICAL"];
    expect(clampDisplayToFetch(d)).toEqual(["HIGH"]);
    expect(d.displaySeverities).toEqual(["CRITICAL"]);
  });

  it("is a no-op when display is already a subset", () => {
    const d = draft();
    expect(clampDisplayToFetch(d)).toEqual([]);
    expect(d.displaySeverities).toEqual(["CRITICAL", "HIGH"]);
  });

  it("leaves a legal draft legal", () => {
    const d = draft();
    d.fetchSeverities = ["CRITICAL"];
    clampDisplayToFetch(d);
    expect(validateDraft(d).ok).toBe(true);
  });
});

// --------------------------------------------------------------------------- cold zone

describe("the cold-zone mirrors of src/domain/config.ts", () => {
  // The client never imports the TS domain modules, so settingsModel.js carries second
  // literals for the bounds and defaults. This is the test that comment promises: the mirrors
  // are held equal to the source of truth here rather than by an import.
  it("match the domain constants exactly", () => {
    expect(COLD_MODES).toEqual([...config.COLD_ZONE_MODES]);
    expect(DEFAULT_COLD_ZONE_MODE).toBe(config.DEFAULT_COLD_ZONE_MODE);
    expect(DEFAULT_COLD_AFTER_DAYS).toBe(config.DEFAULT_COLD_AFTER_DAYS);
    expect(COLD_AFTER_DAYS_MIN).toBe(config.COLD_AFTER_DAYS_MIN);
    expect(COLD_AFTER_DAYS_MAX).toBe(config.COLD_AFTER_DAYS_MAX);
    expect(DEFAULT_COLD_TARGET_SHARE_PCT).toBe(config.DEFAULT_COLD_TARGET_SHARE_PCT);
    expect(COLD_TARGET_SHARE_PCT_MIN).toBe(config.COLD_TARGET_SHARE_PCT_MIN);
    expect(COLD_TARGET_SHARE_PCT_MAX).toBe(config.COLD_TARGET_SHARE_PCT_MAX);
    expect(DEFAULT_COLD_FLOOR_DAYS).toBe(config.DEFAULT_COLD_FLOOR_DAYS);
    expect(COLD_FLOOR_DAYS_MIN).toBe(config.COLD_FLOOR_DAYS_MIN);
    expect(COLD_FLOOR_DAYS_MAX).toBe(config.COLD_FLOOR_DAYS_MAX);
  });
});

describe("the cold-zone draft", () => {
  it("puts all four knobs on the Lifecycle tab", () => {
    for (const key of ["coldZoneMode", "coldAfterDays", "coldTargetSharePct", "coldFloorDays"]) {
      expect(SETTING_FIELDS[key].tab).toBe("lifecycle");
    }
  });

  it("lifts the four defaults when the bootstrap payload carries none of them", () => {
    // A register nobody has configured, and a payload trimmed before these fields existed.
    const d = settingsDraft(BOOT);
    expect(d.coldZoneMode).toBe("fixed");
    expect(d.coldAfterDays).toBe(90);
    expect(d.coldTargetSharePct).toBe(20);
    expect(d.coldFloorDays).toBe(14);
  });

  it("lifts stored values through", () => {
    const d = settingsDraft({
      ...BOOT,
      coldZoneMode: "relative", coldAfterDays: 45, coldTargetSharePct: 35, coldFloorDays: 21,
    });
    expect(d).toMatchObject({
      coldZoneMode: "relative", coldAfterDays: 45, coldTargetSharePct: 35, coldFloorDays: 21,
    });
  });

  it("refuses an unknown mode from the payload rather than carrying it into the draft", () => {
    expect(settingsDraft({ ...BOOT, coldZoneMode: "warm" }).coldZoneMode).toBe("fixed");
  });

  it.each([null, "", false, []])(
    "does not cast %p to a number — Number() would make all four of these zero",
    (junk) => {
      const d = settingsDraft({ ...BOOT, coldAfterDays: junk, coldFloorDays: junk });
      expect(d.coldAfterDays).toBe(90);
      expect(d.coldFloorDays).toBe(14);
    },
  );

  it("reads a numeric string, because a hand-edited settings cell is still an answer", () => {
    expect(settingsDraft({ ...BOOT, coldTargetSharePct: "35" }).coldTargetSharePct).toBe(35);
  });

  it("sends all four in the patch when they are edited", () => {
    const saved = settingsDraft(BOOT);
    const d = settingsDraft(BOOT);
    d.coldZoneMode = "relative";
    d.coldAfterDays = 120;
    d.coldTargetSharePct = 35;
    d.coldFloorDays = 21;
    expect(settingsPatch(saved, d)).toEqual({
      coldZoneMode: "relative", coldAfterDays: 120, coldTargetSharePct: 35, coldFloorDays: 21,
    });
  });
});

describe("cold-zone field errors", () => {
  const cold = (over) => ({ ...settingsDraft(BOOT), ...over });

  it("passes a default draft", () => {
    const errs = fieldErrors(cold({}));
    expect(errs.coldZoneMode).toBeNull();
    expect(errs.coldAfterDays).toBeNull();
    expect(errs.coldTargetSharePct).toBeNull();
    expect(errs.coldFloorDays).toBeNull();
  });

  it("words the window's bounds as \"at least\" and \"at most\", never as symbols", () => {
    expect(fieldErrors(cold({ coldAfterDays: 3 })).coldAfterDays).toBe(
      "The cold-zone window must be at least 7 days and at most 365 days.",
    );
    expect(fieldErrors(cold({ coldAfterDays: 400 })).coldAfterDays).toBe(
      "The cold-zone window must be at least 7 days and at most 365 days.",
    );
  });

  it("words the target share and the floor the same way", () => {
    expect(fieldErrors(cold({ coldTargetSharePct: 0 })).coldTargetSharePct).toBe(
      "The cold-zone target share must be at least 1% and at most 50%.",
    );
    expect(fieldErrors(cold({ coldFloorDays: 900 })).coldFloorDays).toBe(
      "The cold-zone floor must be at least 1 day and at most 365 days.",
    );
  });

  it("names both modes when the mode is neither of them", () => {
    expect(fieldErrors(cold({ coldZoneMode: "warm" })).coldZoneMode).toBe(
      "The cold-zone mode must be either fixed or relative.",
    );
  });

  it("checks the relative-mode numbers in FIXED mode too", () => {
    // The controls are hidden in fixed mode, never disabled, and the draft still carries
    // them — so a bad value left behind in the other mode is still what would be saved.
    const errs = fieldErrors(cold({ coldZoneMode: "fixed", coldFloorDays: 0 }));
    expect(errs.coldFloorDays).not.toBeNull();
  });

  it("checks the window in RELATIVE mode too, because it is still published", () => {
    const errs = fieldErrors(cold({ coldZoneMode: "relative", coldAfterDays: 0 }));
    expect(errs.coldAfterDays).not.toBeNull();
  });

  it("lights every broken cold field at once, unlike validateDraft", () => {
    const errs = fieldErrors(cold({ coldAfterDays: 1, coldTargetSharePct: 99, coldFloorDays: 0 }));
    expect(errs.coldAfterDays).not.toBeNull();
    expect(errs.coldTargetSharePct).not.toBeNull();
    expect(errs.coldFloorDays).not.toBeNull();
  });
});

describe("validateDraft over the cold zone", () => {
  const cold = (over) => ({ ...settingsDraft(BOOT), ...over });

  it("sends the reader to Lifecycle", () => {
    const v = validateDraft(cold({ coldAfterDays: 400 }));
    expect(v.ok).toBe(false);
    expect(v.tab).toBe("lifecycle");
  });

  it("reports the MODE before any of the three numbers it governs", () => {
    // The mode decides which controls are on screen; a message about a window the reader
    // cannot reach would send them to a tab with no such control.
    const v = validateDraft(cold({ coldZoneMode: "warm", coldAfterDays: 400 }));
    expect(v.message).toBe("The cold-zone mode must be either fixed or relative.");
  });

  it("still reports the retention window first — the older field keeps its priority", () => {
    const v = validateDraft(cold({ retentionDays: 5, coldAfterDays: 400 }));
    expect(v.message).toBe("The retention window must be at least 30 days.");
  });

  it("passes a legal cold draft in both modes", () => {
    expect(validateDraft(cold({ coldZoneMode: "fixed" })).ok).toBe(true);
    expect(validateDraft(cold({ coldZoneMode: "relative" })).ok).toBe(true);
  });
});
