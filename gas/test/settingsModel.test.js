// The Settings draft model: what counts as a change, who owns it, and what the page refuses
// to send. Pure logic, so it is pinned here rather than through a DOM.

import { describe, expect, it } from "vitest";
import {
  changeCountText,
  changeSummary,
  changedFields,
  clampDisplayToFetch,
  DEFAULT_TAB,
  dirtyTabs,
  draftWarnings,
  normalizeTab,
  SETTING_FIELDS,
  SETTING_KEYS,
  SETTINGS_TABS,
  settingsDraft,
  settingsPatch,
  validateDraft,
} from "../src/client/js/settingsModel.js";

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

  it("reports dirty tabs in tablist order, not edit order", () => {
    const d = draft();
    d.retentionDays = 90;      // lifecycle
    d.riskRule.epss = false;   // risk
    expect(dirtyTabs(changedFields(draft(), d))).toEqual(["risk", "lifecycle"]);
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
