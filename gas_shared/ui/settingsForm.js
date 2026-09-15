// The register-settings draft kernel: which knobs a page-level save bar owns, which tab owns
// each, what changed between the saved state and the draft, and the per-tab dirty/invalid
// state a tablist reads without a reader opening a hidden tab first.
//
// THREE APPS HAD GROWN THE SAME EIGHT FUNCTIONS INDEPENDENTLY: `gas/src/client/js/
// settingsModel.js`, `gas_ai/`'s and `gas_devsecops/`'s own copies. Four are byte-identical
// (`changedFields`, `settingsPatch`, `changeSummary`) or near enough; the rest disagreed in
// ways that were never supposed to be decisions — `normalizeTab`'s arity (gas took one
// argument, the other two took two), `changeCountText`'s string-building (a template literal
// in gas, `+` concatenation in gas_ai), `tabStatus`'s comparator (gas_devsecops called it
// `sameFieldValue`, not `sameValue`, and it answered a different question — see below), and
// `sameValue`'s own leaf. This module is the one answer, closed over each app's own tab+field
// registry so `dirtyTabs`... — see the note on that name below, it is not here — `changeSummary`
// and `tabStatus` never have to be handed the registry on every call.
//
// NOT IN THE BARREL, ON PURPOSE. `ui/index.js` is the DOM component base — `dom.js`'s `el()`
// and every module that reaches it. This file has no `document` in it anywhere, the same way
// `ui/scopeModel.js` and `ui/tableModel.js` do not, but unlike those two it is reached ONLY by
// a direct relative import (`gas_shared/ui/settingsForm.js`), never through `ui/index.js` or an
// app's own `ui.js` re-export of that barrel. Keep it that way: a settings-model test has no
// reason to pull in the other 33 component modules to reach eight pure functions, and pinning
// the import to one literal path is what lets `test/contracts/settingsForm.js` assert it by a
// specifier regex rather than trust that nobody adds it to the barrel later.
//
// `dirtyTabs` IS NOT HERE, AND IT WAS ONE OF THE EIGHT. All three apps ported it forward from
// an earlier design where the tablist read a flat array of dirty tab keys; `tabStatus` replaced
// it with a per-tab `{dirty, invalid}` map (both apps' own `pages/settings.js` say so in a
// comment beside the call site: "tabStatus() replaces the old dirtyTabs(changed) lookup...").
// No page in any of the three apps has imported `dirtyTabs` since — grepped clean across
// `src/`. Its only callers left were `gas/test/settingsModel.test.js` and (two cases, not one)
// `gas_ai/test/settingsDraft.test.js`, each exercising a function nothing built calls. Promoting
// a dead function into a shared kernel would make three apps agree to keep carrying it forever;
// deleting it here and from those two test files is the same call `tabStatus`'s own arrival
// already made in production, just extended to the tests that never caught up to it.
//
// `sameValue`: ARRAY BRANCH (order-insensitive — reordering a set of severity pills is not an
// edit) -> OBJECT BRANCH (same key set, then recurse — a `slaTargets`/`fiveRsPins`-shaped field
// stays order-insensitive even nested inside an object) -> LEAF `a === b || Object.is(a, b)`.
//
// gas's own version has the array branch and the leaf, but never grew the object branch: every
// object-shaped field gas owns (`riskRule`) is built by exactly one `settingsDraft` call on
// both sides of every comparison, so its keys are always inserted in the same order and the
// leaf's whole-object `JSON.stringify` comparison happens to agree with the recursive one on
// every input gas ever hands it. That is a fact about gas's fixtures, not a fact about the
// function — the moment `slaTargets`/`fiveRsPins` (gas_ai's, gas_devsecops's) are compared, a
// key order gas never varies is exactly what an `Object.fromEntries` over a caller-supplied
// order CAN vary, so the object branch is load-bearing for two of the three apps and is kept.
//
// THE LEAF IS WHERE ALL THREE PREDECESSORS DISAGREED WITH THE RIGHT ANSWER, gas included.
// `JSON.stringify(NaN)`, `JSON.stringify(Infinity)` and `JSON.stringify(null)` are all the
// four-byte string `"null"` — the same family of trap CLAUDE.md names for `Number(null)`, one
// constructor over. A leaf that compares `JSON.stringify(a) === JSON.stringify(b)` (gas,
// gas_ai, and gas_devsecops's own dead `sameValue`) therefore reads a broken numeric field
// (`Number("1e400")` is `Infinity`, reachable through an ordinary `<input type="number">` with
// no `Number.isFinite` guard on the way in — `gas_ai/src/client/js/pages/settings.js`'s own
// `nodesInput.oninput` assigns `Number(nodesInput.value)` straight into the draft with no such
// guard) as EQUAL to a saved `null`: the save bar under-counts it and `settingsPatch` omits the
// key entirely, so a reader who "fixed" the field by saving sees nothing move. The other wrong
// answer (`a === b` alone, gas_devsecops's live `sameFieldValue`) is wrong in the opposite
// direction: `NaN !== NaN`, so a field that is legitimately still NaN on both sides — nothing
// changed — reads as permanently dirty and cannot be discarded back to clean. `Object.is`
// closes exactly that one gap (`Object.is(NaN, NaN)` is `true`, `Object.is(NaN, null)` is
// `false`) without reopening the first one, which is why the leaf is the disjunction rather
// than a swap of one cast for the other.
//
// `tabStatus`'s `invalid` reads `errors` BY KEY PRESENCE (`Object.prototype.hasOwnProperty`),
// never truthiness. A caller's contract is to DELETE a key once that field clears rather than
// set it to a falsy placeholder — the same trap CLAUDE.md names for `Number(null)`: an
// `errors.foo = ""` a truthiness check would read as cleared is still a KEY, and a truthiness
// read would silently un-invalidate a tab that is still broken. `test/contracts/settingsForm.js`
// reproduces the wrong version inline and shows it failing, the way `hubUrl.js` reproduces the
// unsafe `safeHubUrl`.
//
// `normalizeTab(key, available)` KEEPS THE TWO-ARGUMENT FORM gas_ai and gas_devsecops use.
// `available` is the tab keys a page actually BUILT this render — gas_ai's and gas_devsecops's
// Access tab is not drawn for a reader who may not edit the roster, so a stale `?tab=access`
// bookmark must land somewhere real instead of selecting a tab that was never built. Calling it
// with one argument (gas's own shape, and any call where every declared tab is always built)
// falls back to every declared tab key, which is exactly gas's original one-argument answer.
//
// `changeCountText(changed)` TAKES THE ARRAY, matching gas's and gas_ai's own signature —
// gas_devsecops's `pages/settings.js` was the odd one out, taking the COUNT
// (`changeCountText(changed.length)`); its caller is fixed to pass the array like the other two
// rather than the kernel growing a second calling convention for one holdout.

/**
 * @param {object} spec
 * @param {{key: string, label: string}[]} spec.tabs  the tablist, in order. `key` is what rides
 *   in the hash (`#/settings?tab=risk`).
 * @param {object} spec.fields  `{fieldName: {tab, label}}` — every knob the page-level save bar
 *   owns. ONE SOURCE OF TRUTH: the save bar names the owning tab (`changeSummary`) and the tab
 *   itself wears the dirty/invalid marker (`tabStatus`); both read this same object, so a field
 *   can never be listed under one tab in the bar and another on the tablist.
 * @param {string} [spec.defaultTab]  falls back to `tabs[0].key`.
 * @returns {{
 *   normalizeTab: Function, changedFields: Function, settingsPatch: Function,
 *   changeSummary: Function, changeCountText: Function, tabStatus: Function,
 *   sameValue: Function, TAB_FIELDS: object, keys: string[], DEFAULT_TAB: string,
 * }}
 */
export function settingsForm(spec) {
  const s = spec || {};
  const tabs = Array.isArray(s.tabs) ? s.tabs : [];
  const tabKeys = tabs.map((t) => t.key);
  const fields = s.fields || {};
  const keys = Object.keys(fields);

  const DEFAULT_TAB = s.defaultTab === undefined ? (tabs[0] && tabs[0].key) : s.defaultTab;
  // THE PROMISE MADE AN ASSERTION, not left as a comment for the next reader to trust. Every
  // one of the three predecessors' headers said some version of "one source of truth for field
  // -> tab ownership" without anything that would catch a typo breaking it.
  if (!DEFAULT_TAB || !tabKeys.includes(DEFAULT_TAB)) {
    throw new Error(
      "settingsForm(): defaultTab " + JSON.stringify(s.defaultTab) + " is missing or names no "
      + "tab in 'tabs' (" + JSON.stringify(tabKeys) + ")",
    );
  }
  for (const k of keys) {
    const tab = fields[k] && fields[k].tab;
    if (!tabKeys.includes(tab)) {
      throw new Error(
        "settingsForm(): field " + JSON.stringify(k) + " names tab " + JSON.stringify(tab)
        + ", which is not in 'tabs' (" + JSON.stringify(tabKeys) + ")",
      );
    }
  }

  const TAB_FIELDS = Object.fromEntries(keys.map((k) => [k, fields[k].tab]));
  const TAB_LABEL = Object.fromEntries(tabs.map((t) => [t.key, t.label]));

  /** See this module's header for why the leaf is `a === b || Object.is(a, b)`. */
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
    return a === b || Object.is(a, b);
  }

  /**
   * A tab key the hash is allowed to name; anything else falls back.
   *
   * `available` is optional — the tab keys a page actually BUILT this render, for a tab (e.g.
   * Access) that is not always drawn. Omitting it is gas's original one-argument shape: every
   * declared tab is treated as built.
   */
  function normalizeTab(key, available) {
    const list = available && available.length ? available : tabKeys;
    if (list.indexOf(key) >= 0) return key;
    return list.indexOf(DEFAULT_TAB) >= 0 ? DEFAULT_TAB : list[0];
  }

  /** The field keys whose draft value differs from the saved one, in registry order. */
  function changedFields(saved, draft) {
    const sv = saved || {};
    const dv = draft || {};
    return keys.filter((k) => !sameValue(sv[k], dv[k]));
  }

  /** Only the changed fields, ready to send as one atomic patch. */
  function settingsPatch(saved, draft) {
    const out = {};
    for (const k of changedFields(saved, draft)) out[k] = draft[k];
    return out;
  }

  /**
   * What the save bar says. Each change carries the tab that owns it, because a tabbed page can
   * hide a dirty control behind an inactive tab — naming the tab is what makes it findable, and
   * the bar renders each entry as a link to that tab.
   *
   * Filters `changed` to keys this registry actually owns before mapping — defensive rather
   * than vacuous: gas_devsecops's page carries a field (`showExperimental`) that is part of its
   * draft shape but owns no batched tab, and a `changed` list built over a WIDER key set than
   * this registry (as that page's own, since-collapsed `changedFields` used to scan) could
   * otherwise hand this function a key with no `fields[k]` to read.
   */
  function changeSummary(changed) {
    return (changed || [])
      .filter((k) => Object.prototype.hasOwnProperty.call(fields, k))
      .map((k) => ({
        field: k, label: fields[k].label, tab: fields[k].tab, tabLabel: TAB_LABEL[fields[k].tab],
      }));
  }

  function changeCountText(changed) {
    const n = (changed || []).length;
    return n + " unsaved change" + (n === 1 ? "" : "s");
  }

  /**
   * Per-tab dirty/invalid state, so a tablist can show which HIDDEN tab holds unsaved or
   * illegal state without a reader opening it first.
   *
   * `dirty` — true when some field owned by that tab differs between `draft` and `saved`.
   * `saved` MUST be the last-SAVED snapshot, never the initial-load one that never changes
   * across a session: a field changed and then changed back to the saved value is not dirty,
   * the same rule `changedFields` above already applies to the save bar's own count.
   *
   * `invalid` — true when `errors` names a field owned by that tab, read by KEY PRESENCE
   * (`Object.prototype.hasOwnProperty`), never truthiness — see this module's header.
   *
   * `tabFields` is the field->tab map to read (`TAB_FIELDS`, this factory's own, in
   * production) — a PARAMETER rather than a value closed over from this call, so a caller can
   * still exercise this against a synthetic shape in a test. Omitting it reads as `{}`, so
   * every tab is absent rather than every tab being (incorrectly) clean.
   *
   * Returns one entry per tab NAMED IN `tabFields`; a tab that owns no batched field never
   * appears and is therefore never dirty or invalid by construction.
   */
  function tabStatus(draft, saved, errors, tabFields) {
    const tf = tabFields || {};
    const d = draft || {};
    const sv = saved || {};
    const errs = errors || {};
    const out = {};
    for (const tab of new Set(Object.values(tf))) out[tab] = { dirty: false, invalid: false };
    for (const [field, tab] of Object.entries(tf)) {
      if (!out[tab]) continue;
      if (!sameValue(sv[field], d[field])) out[tab].dirty = true;
      if (Object.prototype.hasOwnProperty.call(errs, field)) out[tab].invalid = true;
    }
    return out;
  }

  return {
    normalizeTab, changedFields, settingsPatch, changeSummary, changeCountText, tabStatus,
    sameValue, TAB_FIELDS, keys, DEFAULT_TAB,
  };
}
