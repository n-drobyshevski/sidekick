// The Settings draft model: what counts as a change, who owns it, and what the page refuses to
// send. Pure logic, so it is pinned here rather than through a DOM — there is no jsdom in this
// suite, which is exactly why the model is a module of its own.
//
// A .js test, not .ts, and that is load-bearing: tsconfig.json has no allowJs and includes
// test/**/*.ts, so a .ts test importing a client .js module fails `tsc --noEmit` and
// `npm run check` never reaches vitest.

import { describe, expect, it } from "vitest";
import {
  categoryDraftPatch,
  changeCountText,
  changeSummary,
  changedFields,
  DEFAULT_TAB,
  dirtyTabs,
  draftWarnings,
  fieldErrors,
  normalizeTab,
  rankDraftFromPreset,
  rankDraftPatch,
  rankShareTotal,
  SETTING_FIELDS,
  SETTING_KEYS,
  SETTINGS_TABS,
  settingsDraft,
  settingsPatch,
  TAB_FIELDS,
  tabStatus,
  validateDraft,
} from "../src/client/js/settingsModel.js";
// The real rule, not a hand-written copy of its shape — the same argument helpContent.test.js
// makes for importing DEFAULT_AARS_RULE: a fixture that spells out its own `shares` or
// `exploitationWeights` asserts against a fiction, which is exactly how a settings page can
// ship reading a field the model renamed. A .js test importing a .ts domain module is fine;
// only the reverse direction is the one tsc rejects (see this file's own header).
import { DEFAULT_RANK_RULE, RANK_PRESET_V2 } from "../src/domain/rank";

/** The api_getSettings shape, as the page receives it. */
const PAYLOAD = {
  defaultDepth: 2,
  maxNodes: 100,
  maxNodesFloor: 30,
  maxNodesCeiling: 400,
  autoExpand: true,
  hasCredentials: true,
  fiveRsPins: { in: ["p1"], out: ["p2", "p3"] },
  issueCategories: ["wct-id-1998"],
  syncScope: "project",
  rankRule: DEFAULT_RANK_RULE,
  rankLeadsSort: false,
};

/** The candidateCategories shape: the AI category always first, by CANDIDATE_CATEGORIES's own
 * construction — categoryDraftPatch takes that id as a plain argument and never assumes it. */
const CANDIDATES = [
  { id: "wct-id-1998", name: "AI Security" },
  { id: "wct-id-3", name: "Vulnerability Assessment" },
  { id: "cat-data", name: "Data Security" },
];
const AI_ID = CANDIDATES[0].id;

const ALL_TABS = SETTINGS_TABS.map((t) => t.key);

describe("settingsDraft", () => {
  it("lifts exactly the fields the save bar owns", () => {
    expect(Object.keys(settingsDraft(PAYLOAD)).sort()).toEqual([...SETTING_KEYS].sort());
  });

  it("copies the pin lists rather than aliasing the payload", () => {
    const draft = settingsDraft(PAYLOAD);
    draft.fiveRsPins.in.push("p9");
    expect(PAYLOAD.fiveRsPins.in).toEqual(["p1"]);
  });

  it("hands out independent drafts", () => {
    const a = settingsDraft(PAYLOAD);
    const b = settingsDraft(PAYLOAD);
    a.fiveRsPins.out.push("p9");
    expect(b.fiveRsPins.out).toEqual(["p2", "p3"]);
  });

  // THE ONE THAT MATTERS. getAutoExpand() in domain/settingsLogic.ts is `!== false` because
  // settingsStore.loadSettings turns a blank cell into null and the flag is ON by default.
  // Reading it as `=== true` here would show a fresh workbook a control saying "off" while the
  // server went on expanding — a default silently flipped in the UI only.
  it("reads autoExpand as on unless it is explicitly false", () => {
    expect(settingsDraft({ autoExpand: undefined }).autoExpand).toBe(true);
    expect(settingsDraft({ autoExpand: null }).autoExpand).toBe(true);
    expect(settingsDraft({}).autoExpand).toBe(true);
    expect(settingsDraft({ autoExpand: true }).autoExpand).toBe(true);
    expect(settingsDraft({ autoExpand: false }).autoExpand).toBe(false);
  });

  it("survives an empty payload without throwing", () => {
    const d = settingsDraft(undefined);
    expect(d.fiveRsPins).toEqual({ in: [], out: [] });
  });
});

describe("changedFields", () => {
  it("is empty for an untouched draft", () => {
    expect(changedFields(settingsDraft(PAYLOAD), settingsDraft(PAYLOAD))).toEqual([]);
  });

  it("reports each scalar edit", () => {
    const saved = settingsDraft(PAYLOAD);
    const draft = settingsDraft(PAYLOAD);
    draft.defaultDepth = 3;
    draft.autoExpand = false;
    expect(changedFields(saved, draft)).toEqual(["defaultDepth", "autoExpand"]);
  });

  it("returns keys in SETTING_KEYS order, not edit order", () => {
    const saved = settingsDraft(PAYLOAD);
    const draft = settingsDraft(PAYLOAD);
    draft.fiveRsPins.in.push("p9");
    draft.maxNodes = 200;
    expect(changedFields(saved, draft)).toEqual(["maxNodes", "fiveRsPins"]);
  });

  // Re-selecting the same rules in another order is not an edit, so the save bar must not
  // offer to save it and the tab must not go dirty.
  it("is order-insensitive within each pin list", () => {
    const saved = settingsDraft(PAYLOAD);
    const draft = settingsDraft(PAYLOAD);
    draft.fiveRsPins.out = ["p3", "p2"];
    expect(changedFields(saved, draft)).toEqual([]);
  });

  it("sees a pin moving from one list to the other", () => {
    const saved = settingsDraft(PAYLOAD);
    const draft = settingsDraft(PAYLOAD);
    draft.fiveRsPins = { in: ["p1", "p2"], out: ["p3"] };
    expect(changedFields(saved, draft)).toEqual(["fiveRsPins"]);
  });

  it("sees both lists emptied by Reset to derived", () => {
    const saved = settingsDraft(PAYLOAD);
    const draft = settingsDraft(PAYLOAD);
    draft.fiveRsPins = { in: [], out: [] };
    expect(changedFields(saved, draft)).toEqual(["fiveRsPins"]);
  });
});

describe("settingsPatch", () => {
  it("carries only the changed fields, so an untouched knob is never rewritten", () => {
    const saved = settingsDraft(PAYLOAD);
    const draft = settingsDraft(PAYLOAD);
    draft.maxNodes = 250;
    expect(settingsPatch(saved, draft)).toEqual({ maxNodes: 250 });
  });

  it("is empty when nothing changed", () => {
    expect(settingsPatch(settingsDraft(PAYLOAD), settingsDraft(PAYLOAD))).toEqual({});
  });

  it("sends the whole pin object, not a delta of it", () => {
    const saved = settingsDraft(PAYLOAD);
    const draft = settingsDraft(PAYLOAD);
    draft.fiveRsPins = { in: [], out: [] };
    expect(settingsPatch(saved, draft)).toEqual({ fiveRsPins: { in: [], out: [] } });
  });
});

describe("field to tab ownership", () => {
  it("gives every owned key a tab that exists on the tablist", () => {
    for (const k of SETTING_KEYS) {
      expect(ALL_TABS).toContain(SETTING_FIELDS[k].tab);
    }
  });

  it("returns dirty tabs in tablist order, deduplicated", () => {
    // fiveRsPins (compliance) edited first, defaultDepth (graph) second.
    expect(dirtyTabs(["fiveRsPins", "defaultDepth", "maxNodes"])).toEqual(["graph", "compliance"]);
  });

  it("has no dirty tab for an empty change list", () => {
    expect(dirtyTabs([])).toEqual([]);
  });
});

describe("the save bar's wording", () => {
  it("names the owning tab for every change, so one behind an inactive tab is findable", () => {
    expect(changeSummary(["maxNodes", "fiveRsPins"])).toEqual([
      { field: "maxNodes", label: "node budget", tab: "graph", tabLabel: "Graph" },
      { field: "fiveRsPins", label: "5Rs scope", tab: "compliance", tabLabel: "Compliance" },
    ]);
  });

  it("counts in singular and plural", () => {
    expect(changeCountText([])).toBe("0 unsaved changes");
    expect(changeCountText(["maxNodes"])).toBe("1 unsaved change");
    expect(changeCountText(["maxNodes", "autoExpand"])).toBe("2 unsaved changes");
  });
});

describe("normalizeTab", () => {
  it("passes a real tab key through", () => {
    expect(normalizeTab("compliance")).toBe("compliance");
  });

  it("falls back for junk, an empty hash and a missing param", () => {
    expect(normalizeTab("nope")).toBe(DEFAULT_TAB);
    expect(normalizeTab("")).toBe(DEFAULT_TAB);
    expect(normalizeTab(undefined)).toBe(DEFAULT_TAB);
  });

  // The Access tab is not drawn for a reader who may not edit the roster, so a bookmark made by
  // someone who could must land somewhere real rather than selecting a tab that was never built.
  it("rejects a tab the page did not build", () => {
    const built = ["graph", "compliance", "system"];
    expect(normalizeTab("access", built)).toBe(DEFAULT_TAB);
    expect(normalizeTab("compliance", built)).toBe("compliance");
  });

  it("still answers when the default itself was not built", () => {
    expect(normalizeTab("access", ["compliance", "system"])).toBe("compliance");
  });
});

describe("validateDraft", () => {
  const bounds = { nodesFloor: 30, nodesCeiling: 400 };
  const ok = () => settingsDraft(PAYLOAD);

  it("accepts the stored payload", () => {
    expect(validateDraft(ok(), bounds).ok).toBe(true);
  });

  it("refuses a depth outside 1..3 and names the tab holding it", () => {
    const d = ok();
    d.defaultDepth = 0;
    const v = validateDraft(d, bounds);
    expect(v.ok).toBe(false);
    expect(v.tab).toBe("graph");
    expect(v.message).toMatch(/between 1 and 3/);
    d.defaultDepth = 4;
    expect(validateDraft(d, bounds).ok).toBe(false);
  });

  // The server clamps this anyway (clampMaxNodes). Refusing here is the point: a silent clamp
  // answers someone who typed 9999 with a saved 400 and no explanation.
  it("refuses a node budget outside the floor and ceiling", () => {
    const d = ok();
    d.maxNodes = 9999;
    const v = validateDraft(d, bounds);
    expect(v.ok).toBe(false);
    expect(v.tab).toBe("graph");
    expect(v.message).toMatch(/between 30 and 400/);
    d.maxNodes = 10;
    expect(validateDraft(d, bounds).ok).toBe(false);
  });

  it("accepts both ends of the range", () => {
    const d = ok();
    d.maxNodes = 30;
    expect(validateDraft(d, bounds).ok).toBe(true);
    d.maxNodes = 400;
    expect(validateDraft(d, bounds).ok).toBe(true);
  });

  it("refuses a field a number input can produce but a number cannot hold", () => {
    const d = ok();
    d.maxNodes = Number("");
    expect(validateDraft(d, bounds).ok).toBe(false);
  });

  it("falls back to the built-in bounds when none are supplied", () => {
    const d = ok();
    d.maxNodes = 9999;
    expect(validateDraft(d).ok).toBe(false);
    expect(validateDraft(d, {}).ok).toBe(false);
  });
});

describe("draftWarnings", () => {
  const saved = settingsDraft(PAYLOAD);

  it("says nothing when rules remain in scope", () => {
    expect(draftWarnings(saved, settingsDraft(PAYLOAD), { selected: 12, total: 120 })).toEqual([]);
  });

  it("asks before taking every 5Rs rule out of scope", () => {
    const w = draftWarnings(saved, settingsDraft(PAYLOAD), { selected: 0, total: 120 });
    expect(w).toHaveLength(1);
    expect(w[0].tab).toBe("compliance");
    expect(w[0].confirmLabel).toBeTruthy();
  });

  // A framework with no policies at all is not a decision anyone made, so it is not a warning.
  it("does not warn when the framework has no rules to begin with", () => {
    expect(draftWarnings(saved, settingsDraft(PAYLOAD), { selected: 0, total: 0 })).toEqual([]);
  });

  // The Compliance panel degrades on its own terms; with no scope loaded the page passes null
  // and there is nothing to warn about, because nothing could have been edited.
  it("does not warn when the scope never loaded", () => {
    expect(draftWarnings(saved, settingsDraft(PAYLOAD), null)).toEqual([]);
    expect(draftWarnings(saved, settingsDraft(PAYLOAD), undefined)).toEqual([]);
  });
});

describe("settingsDraft: register scope and rank", () => {
  it("copies the category list rather than aliasing the payload", () => {
    const draft = settingsDraft(PAYLOAD);
    draft.issueCategories.push("wct-id-3");
    expect(PAYLOAD.issueCategories).toEqual(["wct-id-1998"]);
  });

  it("defaults an absent category list to empty rather than throwing", () => {
    expect(settingsDraft({}).issueCategories).toEqual([]);
    expect(settingsDraft(undefined).issueCategories).toEqual([]);
  });

  it("reads the fetch scope as `project` for anything but a literal `tenant`", () => {
    // Mirrors cleanSyncScope() in domain/registerScope.ts, which folds an unrecognised value
    // back to the narrow answer. Reading it any other way here would draw a control that
    // disagrees with what the sync will actually do.
    expect(settingsDraft(PAYLOAD).syncScope).toBe("project");
    expect(settingsDraft({ syncScope: "tenant" }).syncScope).toBe("tenant");
    for (const junk of [undefined, null, "", "Tenant", "all", 1, true]) {
      expect(settingsDraft({ syncScope: junk }).syncScope).toBe("project");
    }
  });

  it("deep-clones rankRule so editing the draft cannot mutate the shipped default", () => {
    const draft = settingsDraft(PAYLOAD);
    draft.rankRule.shares.time = 0.9;
    draft.rankRule.exploitationWeights.kev = 0.1;
    expect(PAYLOAD.rankRule.shares.time).toBe(DEFAULT_RANK_RULE.shares.time);
    expect(PAYLOAD.rankRule.exploitationWeights.kev).toBe(DEFAULT_RANK_RULE.exploitationWeights.kev);
  });

  it("defaults an absent rankRule to an empty object rather than throwing", () => {
    expect(settingsDraft({}).rankRule).toEqual({});
  });

  // Off by default, matching settingsStore.getRankLeadsSort — not duplicated as a literal
  // constant, just read the same way autoExpand's default is: absent means "not yet on".
  it("reads rankLeadsSort as off unless the payload says true", () => {
    expect(settingsDraft(PAYLOAD).rankLeadsSort).toBe(false);
    expect(settingsDraft({ rankLeadsSort: true }).rankLeadsSort).toBe(true);
    expect(settingsDraft({ rankLeadsSort: "true" }).rankLeadsSort).toBe(false);
  });

  it("lists the register tab's fields under it, in the tablist", () => {
    expect(SETTING_FIELDS.issueCategories.tab).toBe("register");
    // Both halves of the register's scope are edited on one tab, so the save bar names one
    // place to look however many of them moved.
    expect(SETTING_FIELDS.syncScope.tab).toBe("register");
    expect(SETTING_FIELDS.rankRule.tab).toBe("register");
    expect(SETTING_FIELDS.rankLeadsSort.tab).toBe("register");
    expect(ALL_TABS).toContain("register");
  });
});

describe("categoryDraftPatch", () => {
  it("adds a category that was not selected", () => {
    expect(categoryDraftPatch(["wct-id-1998"], "cat-data", true, AI_ID))
      .toEqual(["wct-id-1998", "cat-data"]);
  });

  it("removes a category that was selected", () => {
    expect(categoryDraftPatch(["wct-id-1998", "cat-data"], "cat-data", false, AI_ID))
      .toEqual(["wct-id-1998"]);
  });

  it("is a no-op checking an already-selected category", () => {
    expect(categoryDraftPatch(["wct-id-1998", "cat-data"], "cat-data", true, AI_ID))
      .toEqual(["wct-id-1998", "cat-data"]);
  });

  // THE ONE THAT MATTERS. The AI category is what makes the register an AI register, so
  // unchecking it is silently ignored rather than refused — a checkbox that snaps back needs
  // no error dialog.
  it("refuses to remove the required category", () => {
    expect(categoryDraftPatch(["wct-id-1998", "cat-data"], AI_ID, false, AI_ID))
      .toEqual(["wct-id-1998", "cat-data"]);
  });

  it("restores the required category to a draft that somehow arrived without it", () => {
    expect(categoryDraftPatch(["cat-data"], "cat-data", true, AI_ID))
      .toEqual(["wct-id-1998", "cat-data"]);
  });

  it("preserves given order rather than sorting", () => {
    expect(categoryDraftPatch(["cat-data", "wct-id-1998"], "wct-id-3", true, AI_ID))
      .toEqual(["cat-data", "wct-id-1998", "wct-id-3"]);
  });
});

describe("rankDraftPatch", () => {
  it("replaces a top-level field outright", () => {
    const out = rankDraftPatch(DEFAULT_RANK_RULE, { epssThreshold: 0.2 });
    expect(out.epssThreshold).toBe(0.2);
    expect(out.timeSource).toBe(DEFAULT_RANK_RULE.timeSource);
  });

  // THE ONE THAT MATTERS. Editing one share must not clobber the other three — each number
  // input in the Settings page patches one leaf at a time.
  it("merges one level into a nested table, leaving its siblings untouched", () => {
    const out = rankDraftPatch(DEFAULT_RANK_RULE, { shares: { time: 0.4 } });
    expect(out.shares).toEqual({ ...DEFAULT_RANK_RULE.shares, time: 0.4 });
  });

  it("merges independently across the two weight tables", () => {
    const out = rankDraftPatch(DEFAULT_RANK_RULE, { exploitationWeights: { kev: 0.5 } });
    expect(out.exploitationWeights).toEqual({ ...DEFAULT_RANK_RULE.exploitationWeights, kev: 0.5 });
    expect(out.adjacencyWeights).toEqual(DEFAULT_RANK_RULE.adjacencyWeights);
  });

  it("does not mutate the rule handed in", () => {
    const base = rankDraftFromPreset(DEFAULT_RANK_RULE);
    const snapshot = JSON.parse(JSON.stringify(base));
    rankDraftPatch(base, { shares: { rule: 0.9 } });
    expect(base).toEqual(snapshot);
  });
});

describe("rankDraftFromPreset", () => {
  it("loads a preset as an independent deep clone", () => {
    const draft = rankDraftFromPreset(RANK_PRESET_V2);
    draft.shares.time = 0.99;
    expect(RANK_PRESET_V2.shares.time).not.toBe(0.99);
  });

  it("carries the preset's own values across, not the other preset's", () => {
    const draft = rankDraftFromPreset(RANK_PRESET_V2);
    expect(draft.timeSource).toBe(RANK_PRESET_V2.timeSource);
    expect(draft.shares).toEqual(RANK_PRESET_V2.shares);
  });

  it("survives an empty preset without throwing", () => {
    expect(rankDraftFromPreset(undefined)).toEqual({});
  });
});

describe("rankShareTotal", () => {
  it("sums the four shares", () => {
    expect(rankShareTotal({ rule: 0.25, time: 0.25, exploitation: 0.25, adjacency: 0.25 })).toBe(1);
  });

  // v1's shares (rule 0.5, time 0.5, exploitation 0, adjacency 0) already sum to 1 — the total
  // is an orientation figure, not a validity check, and both shapes should read sensibly.
  it("reads v1's two-term shares the same way", () => {
    expect(rankShareTotal(DEFAULT_RANK_RULE.shares)).toBeCloseTo(1, 10);
  });

  it("treats a missing or non-numeric share as zero rather than throwing", () => {
    expect(rankShareTotal({})).toBe(0);
    expect(rankShareTotal({ rule: "x", time: 0.3 })).toBe(0.3);
    expect(rankShareTotal(undefined)).toBe(0);
  });
});

// P1.5 — the rail dot and the Settings tab marker. `fieldErrors`/`tabStatus` are ported from
// gas/src/client/js/settingsModel.js (itself ported from gas_devsecops). SETTINGS VALIDATES
// EXACTLY ONE TYPABLE FIELD: the node budget (`maxNodes`) on the Graph tab. `defaultDepth` is
// a `<select>` fed only its three legal options, so it can never be typed invalid and
// `fieldErrors` does not check it — see `fieldErrors`'s own header in settingsModel.js.
describe("fieldErrors", () => {
  const bounds = { nodesFloor: 30, nodesCeiling: 400 };
  const ok = () => settingsDraft({ defaultDepth: 2, maxNodes: 100 });

  it("is empty for a legal draft", () => {
    expect(fieldErrors(ok(), bounds)).toEqual({});
  });

  it("names maxNodes, and only maxNodes, when the node budget is out of range", () => {
    const d = ok();
    d.maxNodes = 9999;
    const errs = fieldErrors(d, bounds);
    expect(Object.keys(errs)).toEqual(["maxNodes"]);
    expect(errs.maxNodes).toMatch(/between 30 and 400/);
  });

  it("never names defaultDepth — it is a <select>, not a typable field", () => {
    const d = ok();
    d.defaultDepth = 0; // illegal under validateDraft, but not a field fieldErrors checks
    expect(fieldErrors(d, bounds)).toEqual({});
  });

  it("refuses a value a number input can produce but a number cannot hold", () => {
    const d = ok();
    d.maxNodes = Number("");
    expect(Object.keys(fieldErrors(d, bounds))).toEqual(["maxNodes"]);
  });

  it("falls back to the same built-in bounds validateDraft uses when none are supplied", () => {
    const d = ok();
    d.maxNodes = 9999;
    expect(fieldErrors(d)).toEqual(fieldErrors(d, {}));
    expect(Object.keys(fieldErrors(d))).toEqual(["maxNodes"]);
    // The message quotes the SAME numbers validateDraft's own refusal does — both are derived
    // from one set of bounds, never two literals that could drift apart.
    expect(fieldErrors(d).maxNodes).toBe(validateDraft(d).message);
  });

  it("accepts both ends of the range", () => {
    const d = ok();
    d.maxNodes = 30;
    expect(fieldErrors(d, bounds)).toEqual({});
    d.maxNodes = 400;
    expect(fieldErrors(d, bounds)).toEqual({});
  });
});

describe("TAB_FIELDS", () => {
  it("is derived from SETTING_FIELDS, so a knob can never disagree with the save bar about which tab owns it", () => {
    for (const k of SETTING_KEYS) {
      expect(TAB_FIELDS[k]).toBe(SETTING_FIELDS[k].tab);
    }
    expect(Object.keys(TAB_FIELDS).sort()).toEqual([...SETTING_KEYS].sort());
  });
});

describe("tabStatus", () => {
  const saved = settingsDraft({ defaultDepth: 2, maxNodes: 100, issueCategories: ["wct-id-1998"] });

  it("marks a tab dirty when a field it owns differs from the saved snapshot", () => {
    const draft = settingsDraft({ defaultDepth: 2, maxNodes: 250, issueCategories: ["wct-id-1998"] });
    const status = tabStatus(draft, saved, {}, TAB_FIELDS);
    expect(status.graph.dirty).toBe(true);
    expect(status.register.dirty).toBe(false);
  });

  it("marks a tab invalid when errors names a field it owns, independent of dirty", () => {
    // Dirty AND invalid at once: an out-of-range edit is both.
    const dirtyAndInvalid = tabStatus(
      settingsDraft({ defaultDepth: 2, maxNodes: 9999 }), saved, { maxNodes: "bad" }, TAB_FIELDS,
    );
    expect(dirtyAndInvalid.graph).toEqual({ dirty: true, invalid: true });

    // Invalid WITHOUT dirty: an in-progress keystroke the caller has not committed to the
    // draft (so the draft still matches `saved`) but has already flagged in `errors`.
    const invalidOnly = tabStatus(settingsDraft(saved), saved, { maxNodes: "bad" }, TAB_FIELDS);
    expect(invalidOnly.graph).toEqual({ dirty: false, invalid: true });

    // Dirty WITHOUT invalid: the ordinary case.
    const dirtyOnly = tabStatus(
      settingsDraft({ defaultDepth: 3, maxNodes: 100 }), saved, {}, TAB_FIELDS,
    );
    expect(dirtyOnly.graph).toEqual({ dirty: true, invalid: false });
  });

  it("gives every tab named in tabFields an entry, dirty and invalid both false when untouched", () => {
    const status = tabStatus(settingsDraft(saved), saved, {}, TAB_FIELDS);
    for (const tab of new Set(Object.values(TAB_FIELDS))) {
      expect(status[tab]).toEqual({ dirty: false, invalid: false });
    }
  });

  it("survives an empty draft/saved/errors/tabFields without throwing", () => {
    expect(tabStatus(undefined, undefined, undefined, undefined)).toEqual({});
  });

  // ========================================================================== perturbation
  //
  // THE CLAIM UNDER TEST: `invalid` is read by KEY PRESENCE, never truthiness — the same
  // "absent is never zero" family CLAUDE.md names for `Number(null)`, applied to an error map
  // instead of a numeric field. A caller clears a field by DELETING the key; a truthiness read
  // instead lets `errors.maxNodes = ""` — a key that is PRESENT but happens to be falsy — read
  // as "not invalid", silently un-invalidating a tab that a caller never actually cleared.
  describe("perturbation: truthiness instead of key presence lets errors.maxNodes = \"\" un-invalidate the tab", () => {
    function defectiveTabStatus(draft, saved, errors, tabFields) {
      const tabs = {};
      for (const tab of new Set(Object.values(tabFields))) tabs[tab] = { dirty: false, invalid: false };
      for (const [field, tab] of Object.entries(tabFields)) {
        if (!tabs[tab]) continue;
        // THE BUG: reads `errors[field]` truthiness instead of asking whether the key exists.
        if (errors[field]) tabs[tab].invalid = true;
      }
      return tabs;
    }

    it("the defective read clears the invalid mark on a key that is present but falsy", () => {
      const status = defectiveTabStatus(
        settingsDraft(saved), saved, { maxNodes: "" }, TAB_FIELDS,
      );
      expect(status.graph.invalid).toBe(false);
    });

    it("the real implementation keeps the tab invalid because the key is still there", () => {
      const status = tabStatus(settingsDraft(saved), saved, { maxNodes: "" }, TAB_FIELDS);
      expect(status.graph.invalid).toBe(true);
    });
  });
});
