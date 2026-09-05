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
  normalizeTab,
  rankDraftFromPreset,
  rankDraftPatch,
  rankShareTotal,
  SETTING_FIELDS,
  SETTING_KEYS,
  SETTINGS_TABS,
  settingsDraft,
  settingsPatch,
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
