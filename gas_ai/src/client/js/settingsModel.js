// The settings draft model: which knobs the page-level save bar owns, which tab owns each,
// what changed between the saved state and the draft, and whether the draft is legal to send.
//
// Pure — no DOM, no RPC — so the save bar's wording, the per-tab dirty markers and the
// validation messages are unit-testable without a browser. That is the split this codebase
// already uses for client logic (configView, comboView, prunePanelView, navModel, decideMirror,
// tipPlace), and it is the only kind of test this suite can run: there is no jsdom here.
//
// ONE source of truth for field -> tab ownership. The save bar names the owning tab and the tab
// itself wears a dirty marker; both read SETTING_FIELDS, so a knob can never be listed under one
// tab in the bar and another on the tablist.
//
// THE DIRTY/SAVE-BAR MECHANICS BELOW ARE NOT THIS FILE'S OWN ANY MORE. `normalizeTab`,
// `changedFields`, `settingsPatch`, `changeSummary`, `changeCountText` and `tabStatus` were
// byte-identical or near enough across gas/, gas_ai/ and gas_devsecops/. `gas_shared/ui/
// settingsForm.js` is that one rule now, a factory closed over THIS file's own `SETTINGS_TABS`/
// `SETTING_FIELDS` below, so this file still owns the registry and every other module's import
// of these six names keeps working unchanged. What stays genuinely local: the registry itself,
// `settingsDraft`/`validateDraft`/`fieldErrors`/`draftWarnings` (this register's own rules) and
// the register-scope/rank helpers below, none of which any sibling has a use for. See
// settingsForm.js's own header for why its `sameValue` leaf is `a === b || Object.is(a, b)`
// rather than this file's old `JSON.stringify` comparison — this file's own `nodesInput`
// handler in pages/settings.js is the reachable case that leaf closes (an unguarded
// `Number(nodesInput.value)` can be `Infinity`, and `JSON.stringify(Infinity)` collapsed to the
// same string as `JSON.stringify(null)`) — and for why `dirtyTabs`, one of the functions this
// file used to export, did not come back: `tabStatus` replaced its only call site in
// pages/settings.js (see the comment there), and its remaining callers were this app's own test
// file, exercising a function nothing built calls.

import { settingsForm } from "../../../../gas_shared/ui/settingsForm.js";

/** The tabs, in order. `key` is what rides in the hash (`#/settings?tab=compliance`). */
export const SETTINGS_TABS = [
  { key: "graph", label: "Graph" },
  // Neither Graph (traversal defaults) nor Compliance (the 5Rs framework) is "which risk
  // categories the issue register collects" — that scope decision feeds every issue-shaped
  // figure the app publishes (Priorities, AARS, Toxic Combinations), and the ranking that
  // orders those same rows belongs beside it rather than on a page that edits neither. A
  // fifth tab earns its keep here for the reason the others do not: nothing else already
  // owns this question.
  { key: "register", label: "Register" },
  { key: "compliance", label: "Compliance" },
  { key: "access", label: "Access" },
  { key: "system", label: "System" },
];

export const DEFAULT_TAB = "graph";

/**
 * Every knob the page-level save bar owns, and where it lives.
 *
 * Deliberately NOT every control on the page. The access roster writes a different store
 * (Script Properties, through api_saveAccess/api_saveAdmins) behind its own validation, and
 * "show experimental content" writes localStorage and reshapes the nav rail with no server to
 * reject it — both keep their own save affordance. Mixing two save models inside ONE form is
 * the thing to avoid; two forms with one model each is fine.
 *
 * The System tab owns nothing here on purpose: connection status and the build stamp are
 * read-only, and the experimental toggle saves itself. A tab with no batched field simply
 * never goes dirty.
 */
export const SETTING_FIELDS = {
  defaultDepth: { tab: "graph", label: "default depth" },
  maxNodes: { tab: "graph", label: "node budget" },
  autoExpand: { tab: "graph", label: "agent auto-expand" },
  // THREE scope the same register: which perimeters the sync collects FROM, which categories
  // it collects, and how the rows it collects are ordered. Sent and diffed as whole objects,
  // the same discipline `fiveRsPins` already takes below — a delta of a category list or a
  // rank rule is not a smaller edit, it is a different shape the server would have to
  // reconstruct.
  syncScope: { tab: "register", label: "fetch scope" },
  issueCategories: { tab: "register", label: "register categories" },
  rankRule: { tab: "register", label: "priorities ranking" },
  rankLeadsSort: { tab: "register", label: "rank leads sort" },
  fiveRsPins: { tab: "compliance", label: "5Rs scope" },
};

export const SETTING_KEYS = Object.keys(SETTING_FIELDS);

const kernel = settingsForm({ tabs: SETTINGS_TABS, fields: SETTING_FIELDS, defaultTab: DEFAULT_TAB });

/**
 * The bound kernel — see gas_shared/ui/settingsForm.js's header for `normalizeTab`'s two-
 * argument form (`available` is the Access tab's own reason: `renderAccessPanel()` returns null
 * for anyone who may not edit the roster, so a stale `?tab=access` bookmark must land somewhere
 * real), `changeCountText`'s array signature, `tabStatus`'s key-presence reading of `errors`,
 * and `sameValue`'s `a === b || Object.is(a, b)` leaf.
 */
export const {
  normalizeTab, changedFields, settingsPatch, changeSummary, changeCountText, tabStatus,
  TAB_FIELDS,
} = kernel;

/** Pins as the page holds them: two id lists, neither of which is ordered. */
function pinsOf(v) {
  const p = v || {};
  return { in: [...(p.in || [])], out: [...(p.out || [])] };
}

/**
 * Deep-clone a nested settings blob rather than aliasing the payload — the same discipline
 * `pinsOf` takes above, generalised past the two named arrays a pin object carries. `rankRule`
 * is a plain-data tree (numbers, strings, and objects/arrays of those), so a structural clone
 * is exact; nothing on it is a function or a Date.
 */
function cloneOf(v) {
  return v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : {};
}

/**
 * Lift the api_getSettings payload into a flat draft over exactly SETTING_KEYS. Arrays and the
 * pin object are copied, not aliased, so editing the draft can never mutate the payload the
 * rest of the page is still reading.
 *
 * `autoExpand: s.autoExpand !== false` is NOT a style choice — it mirrors getAutoExpand() in
 * domain/settingsLogic.ts, which is `!== false` because settingsStore.loadSettings turns a
 * blank cell into null and this flag is ON by default. Reading it as `=== true` here would
 * show a fresh workbook a control that says off while the server behaves as on.
 */
export function settingsDraft(settings) {
  const s = settings || {};
  return {
    defaultDepth: Number(s.defaultDepth),
    maxNodes: Number(s.maxNodes),
    autoExpand: s.autoExpand !== false,
    fiveRsPins: pinsOf(s.fiveRsPins),
    // Copied, not aliased, for the same reason as fiveRsPins: category toggles mutate the
    // draft array in place (via categoryDraftPatch's caller) and must never reach back into
    // the payload the rest of the page is still reading.
    issueCategories: Array.isArray(s.issueCategories) ? [...s.issueCategories] : [],
    // "project" for anything else, mirroring cleanSyncScope() in domain/registerScope.ts:
    // the server folds an unrecognised value back to the narrow answer, so a draft that read
    // it any other way would show a control disagreeing with what the sync will do.
    syncScope: s.syncScope === "tenant" ? "tenant" : "project",
    rankRule: cloneOf(s.rankRule),
    // Off by default — matches the server's own default (settingsStore.getRankLeadsSort) —
    // rather than duplicating that default as a literal here: an absent flag reads as "not
    // yet turned on," which is what `false` already means.
    rankLeadsSort: s.rankLeadsSort === true,
  };
}

// The built-in bounds, used whenever a caller (validateDraft or fieldErrors) is not handed the
// server's own maxNodesFloor/maxNodesCeiling. ONE place for the four numbers, so the "node
// budget must be between X and Y" message a reader sees inline and the one validateDraft
// refuses a save with can never quietly name two different ranges.
const DEPTH_MIN_DEFAULT = 1;
const DEPTH_MAX_DEFAULT = 3;
const NODES_FLOOR_DEFAULT = 30;
const NODES_CEILING_DEFAULT = 400;

function nodesBounds(bounds) {
  const b = bounds || {};
  return {
    floor: Number.isFinite(b.nodesFloor) ? b.nodesFloor : NODES_FLOOR_DEFAULT,
    ceiling: Number.isFinite(b.nodesCeiling) ? b.nodesCeiling : NODES_CEILING_DEFAULT,
  };
}

/**
 * Whether the draft may be sent, and why not.
 *
 * The server clamps both of these (clampDepth / clampMaxNodes in domain/settingsLogic.ts), so
 * nothing illegal can be stored either way. Refusing here anyway is the point: a silent clamp
 * answers a reader who typed 9999 with a saved 400 and no explanation, and the control should
 * keep the promise its own min/max attributes make.
 *
 * Returns `{ ok, message, tab }` — `tab` so the caller can switch to the offending control
 * rather than leaving the reader to hunt for it behind a tab.
 */
export function validateDraft(draft, bounds) {
  const b = bounds || {};
  const depthMin = Number.isFinite(b.depthMin) ? b.depthMin : DEPTH_MIN_DEFAULT;
  const depthMax = Number.isFinite(b.depthMax) ? b.depthMax : DEPTH_MAX_DEFAULT;
  const { floor, ceiling } = nodesBounds(bounds);

  const d = Number(draft.defaultDepth);
  if (!Number.isFinite(d) || d < depthMin || d > depthMax) {
    return {
      ok: false,
      tab: "graph",
      message: "The default depth must be between " + depthMin + " and " + depthMax + ".",
    };
  }
  const n = Number(draft.maxNodes);
  if (!Number.isFinite(n) || n < floor || n > ceiling) {
    return {
      ok: false,
      tab: "graph",
      message: "The node budget must be between " + floor + " and " + ceiling + ".",
    };
  }
  return { ok: true, message: "", tab: null };
}

/**
 * Per-field legality of the draft, independent of any other field's state — unlike
 * `validateDraft` above, which stops at the FIRST failure it finds (a fixed priority order) so
 * it can hand the save button one message and one tab to jump to.
 *
 * SETTINGS VALIDATES EXACTLY ONE TYPABLE FIELD TODAY: the node budget (`maxNodes`) on the
 * Graph tab. `defaultDepth` is a `<select>` fed only the three legal options
 * (`[1, 2, 3].map(...)`, settings.js) — there is no keystroke that could put it out of range,
 * so it earns no inline alert and this function does not check it. A future typable field
 * gets its own entry here and its own `<span role="alert">` in settings.js; this is not a
 * general-purpose validator, and inventing a second checked field here without a control that
 * can actually go invalid would be asserting a rule with nothing behind it.
 *
 * Returns an object carrying a message ONLY for a field currently invalid — `tabStatus` below
 * reads this by KEY PRESENCE, so a caller's contract is to DELETE the key once the field
 * clears rather than set it to a falsy message (see `tabStatus`'s own header).
 */
export function fieldErrors(draft, bounds) {
  const { floor, ceiling } = nodesBounds(bounds);
  const errs = {};
  const n = Number(draft.maxNodes);
  if (!Number.isFinite(n) || n < floor || n > ceiling) {
    errs.maxNodes = "The node budget must be between " + floor + " and " + ceiling + ".";
  }
  return errs;
}

/**
 * Consequences worth a confirm rather than a refusal — legal, and almost always a mistake.
 * Returns the prompts to put to the reader, in order, or [] for none. Kept separate from
 * validateDraft because "illegal" and "surprising" are different answers and the caller
 * handles them differently.
 *
 * `scope` carries the RESOLVED 5Rs selection under the draft ({ selected, total }), because
 * a pin list alone cannot say how many rules end up in scope: a pin is a diff against a
 * derived value this module never sees. The page computes it and passes it in, which keeps
 * this function pure and the rule testable.
 */
export function draftWarnings(saved, draft, scope) {
  const out = [];
  const s = scope || {};
  if (Number.isFinite(s.selected) && Number.isFinite(s.total) && s.total > 0 && s.selected === 0) {
    out.push({
      tab: "compliance",
      title: "Take every 5Rs rule out of scope?",
      body: "The 5Rs framework will report no rules in scope, so its register and the "
        + "shared-controls band lose every row they draw from it. The percentage Wiz reports "
        + "does not move — only what you can read beneath it.",
      confirmLabel: "Save anyway",
    });
  }
  return out;
}

// --------------------------------------------------------------- register scope + rank draft
//
// Three DOM-free helpers behind the Register tab's checkboxes and number inputs. None of them
// knows a category name, a preset's numbers, or which id is the mandatory one — those all
// travel on the api_getSettings payload (`candidateCategories`, `rankPresets`) and the page
// hands the live values in, so this file duplicates no constant the server already owns.

/**
 * Toggle one candidate category id in the draft list, order preserved.
 *
 * `requiredId` is the category the register cannot function without — in practice
 * `candidateCategories[0].id`, the AI category, but nothing here hardcodes which one that is.
 * Unchecking it is silently ignored rather than refused: a checkbox that snaps back needs no
 * error dialog to explain itself. It is also force-included if a stale or hand-edited draft
 * somehow arrived without it, so the invariant holds regardless of how the draft was built.
 */
export function categoryDraftPatch(categories, id, checked, requiredId) {
  const list = [...(categories || [])];
  const has = list.indexOf(id) >= 0;
  if (checked && !has) list.push(id);
  if (!checked && id !== requiredId) {
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
  }
  if (requiredId && list.indexOf(requiredId) < 0) list.unshift(requiredId);
  return list;
}

/** The nested tables one rank-rule edit is allowed to merge into rather than replace. */
const RANK_NESTED_KEYS = ["shares", "exploitationWeights", "adjacencyWeights"];

/**
 * Apply one field edit to a rank-rule draft, returning a NEW object rather than mutating the
 * one handed in — the page reassigns `draft.rankRule` to the result, the same pattern
 * `draft.fiveRsPins` already uses when a whole sub-object is replaced.
 *
 * A key in `RANK_NESTED_KEYS` merges one level deep, so `rankDraftPatch(rule, { shares: {
 * time: 0.4 } })` moves the clock's share without disturbing `shares.rule`,
 * `shares.exploitation` or `shares.adjacency` — the four share inputs, and the two weight
 * tables, each edit one leaf at a time. Every other key (`epssThreshold`, `timeSource`, …)
 * replaces outright, because there is nothing under it to preserve.
 */
export function rankDraftPatch(rankRule, patch) {
  const base = rankRule || {};
  const out = { ...base };
  const p = patch || {};
  for (const key of Object.keys(p)) {
    const v = p[key];
    if (RANK_NESTED_KEYS.indexOf(key) >= 0 && v && typeof v === "object" && !Array.isArray(v)) {
      out[key] = { ...(base[key] || {}), ...v };
    } else {
      out[key] = v;
    }
  }
  return out;
}

/**
 * Load a preset (`rankPresets.v1` / `.v2`, exactly as api_getSettings ships them) into the
 * draft. A deep clone: the presets are the server's own `DEFAULT_RANK_RULE` /
 * `RANK_PRESET_V2` objects, live in the closure the page holds for its whole visit, and must
 * never be mutated by the field edits that follow a preset load.
 */
export function rankDraftFromPreset(preset) {
  return cloneOf(preset);
}

/**
 * The four shares' sum, for the live read-out beside them. They need not add to 1 — `rank.ts`
 * renormalises the blend over whichever terms are actually measured on a given row — so this
 * is an orientation figure ("where do the four knobs sit relative to one whole"), not a
 * constraint the page enforces or refuses to save on.
 */
export function rankShareTotal(shares) {
  const s = shares || {};
  return ["rule", "time", "exploitation", "adjacency"].reduce((sum, k) => {
    const v = Number(s[k]);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);
}
