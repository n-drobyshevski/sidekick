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
  // Both scope the same register: which categories it collects, and how the rows it collects
  // are ordered. Sent and diffed as whole objects, the same discipline `fiveRsPins` already
  // takes below — a delta of a category list or a rank rule is not a smaller edit, it is a
  // different shape the server would have to reconstruct.
  issueCategories: { tab: "register", label: "register categories" },
  rankRule: { tab: "register", label: "priorities ranking" },
  rankLeadsSort: { tab: "register", label: "rank leads sort" },
  fiveRsPins: { tab: "compliance", label: "5Rs scope" },
};

export const SETTING_KEYS = Object.keys(SETTING_FIELDS);

/**
 * A tab key the hash is allowed to name; anything else falls back.
 *
 * `available` exists because the Access tab is not always there: renderAccessPanel() returns
 * null for anyone who may not edit the roster, and this app's stated rule is that a non-editor
 * gets no section at all rather than a disabled one. A stale `?tab=access` bookmark must
 * therefore land somewhere real instead of selecting a tab that was never built.
 */
export function normalizeTab(key, available) {
  const keys = available && available.length ? available : SETTINGS_TABS.map((t) => t.key);
  if (keys.indexOf(key) >= 0) return key;
  return keys.indexOf(DEFAULT_TAB) >= 0 ? DEFAULT_TAB : keys[0];
}

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
    rankRule: cloneOf(s.rankRule),
    // Off by default — matches the server's own default (settingsStore.getRankLeadsSort) —
    // rather than duplicating that default as a literal here: an absent flag reads as "not
    // yet turned on," which is what `false` already means.
    rankLeadsSort: s.rankLeadsSort === true,
  };
}

/** Order-insensitive for the pin lists: re-selecting rules in another order is not an edit. */
function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) return false;
    return ka.every((k) => sameValue(a[k], b[k]));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The field keys whose draft value differs from the saved one, in SETTING_KEYS order. */
export function changedFields(saved, draft) {
  return SETTING_KEYS.filter((k) => !sameValue(saved[k], draft[k]));
}

/** Only the changed fields, ready to send as one atomic patch to api_setSettings. */
export function settingsPatch(saved, draft) {
  const out = {};
  for (const k of changedFields(saved, draft)) out[k] = draft[k];
  return out;
}

/** Tab keys carrying at least one changed field, in tablist order. */
export function dirtyTabs(changed) {
  const owned = new Set(changed.map((k) => SETTING_FIELDS[k].tab));
  return SETTINGS_TABS.filter((t) => owned.has(t.key)).map((t) => t.key);
}

const TAB_LABEL = Object.fromEntries(SETTINGS_TABS.map((t) => [t.key, t.label]));

/**
 * What the save bar says. Each change carries the tab that owns it, because a tabbed page can
 * hide a dirty control behind an inactive tab — naming the tab is what makes it findable, and
 * the bar renders each entry as a link to that tab.
 */
export function changeSummary(changed) {
  return changed.map((k) => ({
    field: k,
    label: SETTING_FIELDS[k].label,
    tab: SETTING_FIELDS[k].tab,
    tabLabel: TAB_LABEL[SETTING_FIELDS[k].tab],
  }));
}

export function changeCountText(changed) {
  const n = changed.length;
  return n + " unsaved change" + (n === 1 ? "" : "s");
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
  const depthMin = Number.isFinite(b.depthMin) ? b.depthMin : 1;
  const depthMax = Number.isFinite(b.depthMax) ? b.depthMax : 3;
  const floor = Number.isFinite(b.nodesFloor) ? b.nodesFloor : 30;
  const ceiling = Number.isFinite(b.nodesCeiling) ? b.nodesCeiling : 400;

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
