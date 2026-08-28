// The settings draft model: which knobs the page-level save bar owns, which tab owns each,
// what changed between the saved state and the draft, and whether the draft is legal to send.
//
// Pure — no DOM, no RPC — so the save bar's wording, the per-tab dirty markers, the validation
// messages and the warnings are unit-testable without a browser. There is no jsdom in this
// suite, so this split is the only kind of test the client half can have; registerModel.js and
// accessModel.js are the same shape.
//
// ONE source of truth for field -> tab ownership. The save bar names the owning tab and the tab
// itself wears a dirty marker; both read SETTING_FIELDS, so a knob can never be listed under
// one tab in the bar and another on the tablist.

// NO CONSTANTS ARE DUPLICATED HERE. The scopes, the severity order and — above all — the
// shared SLA windows arrive from `api_bootstrap`, which reads them straight from
// src/domain/config.ts. A second copy of SLA_TARGETS in the client would be a second place for
// the four sidekicks' byte-identical windows to drift, and the drift would be invisible: the
// page would simply stop warning about a divergence it had itself introduced. Every function
// below that needs them takes a `ctx`.

/** The tabs, in order. `key` is what rides in the hash (`#/settings?tab=deadlines`). */
export const SETTINGS_TABS = [
  { key: "register", label: "Register" },
  { key: "deadlines", label: "Deadlines" },
  { key: "access", label: "Access" },
  { key: "system", label: "System" },
];

export const DEFAULT_TAB = "register";

/**
 * Every knob the page-level save bar owns, and where it lives.
 *
 * Deliberately NOT every control on the page. The access roster writes a different store
 * (Script Properties, through api_saveAccess / api_saveAdmins) behind its own validation, and
 * "show experimental content" writes localStorage and reshapes the nav rail with no server to
 * reject it — both keep their own save affordance. Mixing two save models inside ONE form is
 * the thing to avoid; two forms with one model each is fine.
 *
 * The System tab owns nothing here on purpose: the credential state, the project scope and the
 * build stamp are read-only, and the experimental toggle saves itself. A tab with no batched
 * field simply never goes dirty.
 */
export const SETTING_FIELDS = {
  scopes: { tab: "register", label: "registers collected" },
  fetchSeverities: { tab: "register", label: "severity scope" },
  slaTargets: { tab: "deadlines", label: "SLA targets" },
};

export const SETTING_KEYS = Object.keys(SETTING_FIELDS);

/**
 * A tab key the hash is allowed to name; anything else falls back.
 *
 * `available` exists because the Access tab is not always there: renderAccessPanel() answers
 * null for anyone who may not edit the roster, and this app's rule is that a non-editor gets no
 * section at all rather than a disabled one. A stale `?tab=access` bookmark must land somewhere
 * real instead of selecting a tab that was never built.
 */
export function normalizeTab(key, available) {
  const keys = available && available.length ? available : SETTINGS_TABS.map((t) => t.key);
  if (keys.indexOf(key) >= 0) return key;
  return keys.indexOf(DEFAULT_TAB) >= 0 ? DEFAULT_TAB : keys[0];
}

/** Per-scope severity lists as the page holds them: copied, never aliased. */
function severitiesOf(v, scopes) {
  const out = {};
  for (const scope of scopes) out[scope] = [...((v || {})[scope] || [])];
  return out;
}

/**
 * Lift the api_getSettings payload into a flat draft over exactly SETTING_KEYS. Arrays and the
 * per-scope object are copied, not aliased, so editing the draft can never mutate the payload
 * the rest of the page is still reading.
 */
export function settingsDraft(settings, ctx) {
  const s = settings || {};
  const c = ctx || {};
  const targets = {};
  for (const sev of c.severityOrder || Object.keys(s.slaTargets || {})) {
    const v = (s.slaTargets || {})[sev];
    if (Number.isFinite(Number(v))) targets[sev] = Number(v);
  }
  return {
    scopes: [...(s.scopes || [])],
    fetchSeverities: severitiesOf(s.fetchSeverities, c.scopes || Object.keys(s.fetchSeverities || {})),
    slaTargets: targets,
  };
}

/** Order-insensitive for the lists: re-picking the same severities in another order is not an edit. */
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
  return `${n} unsaved change${n === 1 ? "" : "s"}`;
}

/**
 * Whether the draft may be sent, and why not.
 *
 * The server re-validates (`validateSettings` in domain/settingsLogic.ts), so nothing illegal
 * can be stored either way. Refusing here anyway is the point: a server refusal after the fact
 * answers a reader with a rejected save and no idea which control caused it.
 *
 * Returns `{ ok, message, tab }` — `tab` so the caller can switch to the offending control
 * rather than leaving the reader to hunt for it behind a tab.
 */
export function validateDraft(draft) {
  if (!draft.scopes.length) {
    return {
      ok: false,
      tab: "register",
      message: "Choose at least one register to collect — with none, a sync has nothing to do.",
    };
  }
  for (const [sev, days] of Object.entries(draft.slaTargets)) {
    if (!Number.isFinite(Number(days)) || Number(days) <= 0) {
      return {
        ok: false,
        tab: "deadlines",
        message: `The SLA target for ${sev} must be a positive number of days.`,
      };
    }
  }
  return { ok: true, message: "", tab: null };
}

/**
 * Consequences worth a confirm rather than a refusal — legal, and almost always a mistake.
 *
 * Kept separate from validateDraft because "illegal" and "surprising" are different answers
 * and the caller handles them differently. Every warning here is grounded in something this
 * register measured or decided, not in a general worry.
 */
export function draftWarnings(saved, draft, ctx) {
  const c = ctx || {};
  const scopes = c.scopes || [];
  const severityOrder = c.severityOrder || [];
  const shared = c.sharedSlaTargets || {};
  const labelOf = (s) => (c.scopeLabels || {})[s] || s;
  const out = [];

  // ---- dropping a register entirely
  const dropped = saved.scopes.filter((s) => draft.scopes.indexOf(s) < 0);
  if (dropped.length) {
    const names = dropped.map(labelOf).join(", ");
    out.push({
      tab: "register",
      title: dropped.length === 1 ? `Stop collecting ${names}?` : "Stop collecting two registers?",
      body: `Nothing will scan ${names} again, so every open finding in it FREEZES: it can `
        + "never be resolved by disappearance, because resolution by absence needs a scan that "
        + "looked. The rows stay in the ledger and in every open count, ageing, until the "
        + "register is collected again.",
      confirmLabel: "Stop collecting",
    });
  }

  // ---- narrowing a severity gate
  //
  // The register's own rule: a scan records the gate it APPLIED, and a severity that was not
  // requested is never resolved by disappearance. So narrowing does not merely collect less —
  // it strands whatever is already in the ledger outside the new gate.
  for (const scope of scopes) {
    if (draft.scopes.indexOf(scope) < 0) continue;
    const before = saved.fetchSeverities[scope] || [];
    const after = draft.fetchSeverities[scope] || [];
    // An EMPTY list means "every severity", never "none" — that is the settled answer for
    // secrets after two wrong ones, and reading it as a narrowing here would invert it.
    const wasAll = !before.length;
    const isAll = !after.length;
    if (isAll) continue;                       // widening to everything strands nothing
    const lost = wasAll
      ? severityOrder.filter((s) => after.indexOf(s) < 0)
      : before.filter((s) => after.indexOf(s) < 0);
    if (!lost.length) continue;
    out.push({
      tab: "register",
      title: `Stop requesting ${lost.join(", ")} from ${labelOf(scope)}?`,
      body: "Findings at those severities are already in the ledger, and a scan that does not "
        + "request them cannot resolve them by absence — the guard that stops an unrequested "
        + "severity mass-resolving also stops it ever closing. They will sit open and ageing "
        + "until the gate is widened again.",
      confirmLabel: "Narrow the scope",
    });
  }

  // ---- diverging from the other three sidekicks
  //
  // SLA_TARGETS is byte-identical across gas/, gas_ai/, brick/devsecops and this register, and
  // that is a decision rather than an accident: a CRITICAL finding gets the same window whether
  // it is a host CVE, a dependency CVE or a hardcoded secret, so the four surfaces cannot
  // report different SLA attainment for the same estate.
  const diverged = Object.keys(draft.slaTargets)
    .filter((sev) => Number.isFinite(Number(shared[sev]))
      && Number(draft.slaTargets[sev]) !== Number(shared[sev]));
  if (diverged.length) {
    out.push({
      tab: "deadlines",
      title: "Report different SLA attainment from the other registers?",
      body: `${diverged.join(", ")} would no longer match the window the OS, AI and pipeline `
        + "surfaces use. They measure the same estate, so the same finding will be inside its "
        + "deadline on one dashboard and past it on another.",
      confirmLabel: "Use different deadlines",
    });
  }

  return out;
}
