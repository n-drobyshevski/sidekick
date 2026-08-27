// The Settings draft model: what counts as a change, who owns it, and what the page refuses to
// send. Pure logic, so it is pinned here rather than through a DOM — there is no jsdom in this
// suite, which is exactly why the model is a module of its own.
//
// A .js test, not .ts, and that is load-bearing: tsconfig.json has no allowJs and includes
// test/**/*.ts, so a .ts test importing a client .js module fails `tsc --noEmit` and
// `npm run check` never reaches vitest.

import { describe, expect, it } from "vitest";
import {
  changeCountText,
  changeSummary,
  changedFields,
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

/** The api_getSettings shape, as the page receives it. */
const PAYLOAD = {
  defaultDepth: 2,
  maxNodes: 100,
  maxNodesFloor: 30,
  maxNodesCeiling: 400,
  autoExpand: true,
  hasCredentials: true,
  fiveRsPins: { in: ["p1"], out: ["p2", "p3"] },
};

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
