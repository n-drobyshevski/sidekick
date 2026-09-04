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

// ============================================================================ per-tab status
//
// TAB_FIELDS below is NOT SETTING_FIELDS above. SETTING_FIELDS/SETTINGS_TABS predate the page
// that shipped (graph/compliance/access/system, over defaultDepth/maxNodes/autoExpand/
// fiveRsPins) and nothing in src/ or test/ ever imported them — grepped clean before writing
// this. pages/settings.js built its own Register/Deadlines/Access/System tabs over the real
// seven-field Settings contract with its own parallel FIELD_TABS constant instead. Rather than
// widen that gap, TAB_FIELDS is the real map and pages/settings.js's own FIELD_TABS now reads
// `= TAB_FIELDS` so the two cannot drift, the same promise SETTING_FIELDS's header makes for
// the tabs that were never built.

/**
 * Field -> owning tab for the real Settings page's save-bar batch. Mirrors FIELD_TABS in
 * pages/settings.js, which re-exports this constant rather than restating it.
 */
export const TAB_FIELDS = {
  scopes: "register",
  fetchSeverities: "register",
  slaTargets: "deadlines",
  syncSchedule: "system",
  autoCompact: "system",
  retentionDays: "system",
};

/** Order-insensitive equality for a draft field value — arrays and per-scope records copy the
 * same shape `changedFields` above already compares this way; kept local rather than shared
 * so this module never imports from pages/settings.js (the DOM half imports FROM here, not
 * the other way around). */
function sameFieldValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) return false;
    return ka.every((k) => sameFieldValue(a[k], b[k]));
  }
  return a === b;
}

/**
 * Per-tab dirty/invalid state, so a tablist can show which HIDDEN tab holds unsaved or
 * illegal state without a reader opening it first.
 *
 * `dirty` — true when some field owned by that tab differs between `draft` and `saved`.
 * `saved` MUST be the last-SAVED snapshot, never the initial-load one that never changes
 * across a session: a field changed and then changed back to the saved value is not dirty,
 * the same rule `changedFields` above already applies to the save bar's own count. Passing
 * an initial-load snapshot here instead would make a revert read as still-dirty forever.
 *
 * `invalid` — true when `errors` names a field owned by that tab. `errors` is any object
 * keyed by field name; only KEY PRESENCE is read, so the caller's contract is to delete a
 * key once that field clears rather than to set it to a falsy message.
 *
 * `tabFields` is the field->tab map to read (TAB_FIELDS in production) — a parameter rather
 * than a closed-over constant so this stays testable against a synthetic shape.
 *
 * Returns one entry per tab NAMED IN tabFields; a tab that owns no field there (Access, on
 * this page) never appears and is therefore never dirty or invalid by construction.
 */
export function tabStatus(draft, saved, errors, tabFields) {
  const fields = tabFields || {};
  const d = draft || {};
  const s = saved || {};
  const errs = errors || {};
  const tabs = {};
  for (const tab of new Set(Object.values(fields))) tabs[tab] = { dirty: false, invalid: false };
  for (const [field, tab] of Object.entries(fields)) {
    if (!tabs[tab]) continue;
    if (!sameFieldValue(s[field], d[field])) tabs[tab].dirty = true;
    if (Object.prototype.hasOwnProperty.call(errs, field)) tabs[tab].invalid = true;
  }
  return tabs;
}
