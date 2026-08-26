// The register-settings draft model: which knobs exist, which tab owns each, what changed
// between the saved state and the draft, and whether the draft is legal to send.
//
// Pure — no DOM, no RPC — so the save bar's wording, the per-tab dirty markers and the
// validation messages are unit-testable without a browser. That is the pattern this codebase
// already uses for client logic (backfillStatusView, capacityView, scanProgressView, railItems).
//
// ONE source of truth for field → tab ownership. The save bar names the owning tab and the tab
// itself wears a dirty marker; both read SETTING_FIELDS, so a knob can never be listed under one
// tab in the bar and another on the tablist.

/** The five tabs, in order. `key` is what rides in the hash (`#/settings?tab=risk`). */
export const SETTINGS_TABS = [
  { key: "register", label: "Register" },
  { key: "risk", label: "Risk" },
  { key: "attribution", label: "Attribution" },
  { key: "lifecycle", label: "Lifecycle" },
  { key: "system", label: "System" },
];

export const DEFAULT_TAB = "register";

/**
 * Every knob the page-level save bar owns, and where it lives. Deliberately NOT every control
 * on the page: manual groups and the access roster write different stores behind their own
 * validation, so they keep their own save affordance rather than being folded in here. Mixing
 * two save models inside one form is the thing to avoid; two forms with one model each is fine.
 */
export const SETTING_FIELDS = {
  fetchSeverities: { tab: "register", label: "scan scope" },
  displaySeverities: { tab: "register", label: "display filter" },
  showNoFix: { tab: "register", label: "vendor-fix filter" },
  includeEol: { tab: "register", label: "end-of-life filter" },
  riskRule: { tab: "risk", label: "high-risk classifier" },
  retentionDays: { tab: "lifecycle", label: "retention window" },
  autoCompact: { tab: "lifecycle", label: "auto-compact" },
};

export const SETTING_KEYS = Object.keys(SETTING_FIELDS);

/** A tab key the hash is allowed to name; anything else falls back to the first tab. */
export function normalizeTab(key) {
  return SETTINGS_TABS.some((t) => t.key === key) ? key : DEFAULT_TAB;
}

/**
 * Lift `boot.settings` into a flat draft over exactly SETTING_KEYS. Arrays and the rule object
 * are copied, not aliased, so editing the draft can never mutate the bootstrap payload the rest
 * of the app is still reading.
 */
export function settingsDraft(settings) {
  const s = settings || {};
  const rule = (s.riskRule && s.riskRule.rule) || {};
  return {
    fetchSeverities: [...(s.fetchSeverities || [])],
    displaySeverities: [...(s.displaySeverities || [])],
    showNoFix: s.showNoFix !== false,
    includeEol: s.includeEol !== false,
    riskRule: {
      kev: rule.kev !== false,
      exploit: rule.exploit !== false,
      epss: rule.epss !== false,
      epssThreshold: typeof rule.epssThreshold === "number" ? rule.epssThreshold : 0.1,
    },
    retentionDays: s.retentionDays === null || s.retentionDays === undefined
      ? null
      : Number(s.retentionDays),
    autoCompact: !!s.autoCompact,
  };
}

/** Order-insensitive for the severity arrays: reordering pills is not an edit. */
function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The field keys whose draft value differs from the saved one, in SETTING_KEYS order. */
export function changedFields(saved, draft) {
  return SETTING_KEYS.filter((k) => !sameValue(saved[k], draft[k]));
}

/** Only the changed fields, ready to send as one atomic patch. */
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
 * Whether the draft may be sent, and why not. These are the same rules the per-panel saves
 * enforced today, gathered in one place: an empty scope is not a legal register, and the display
 * filter is a subset of the scan scope by construction rather than by server rescue.
 *
 * Returns `{ ok, message, tab }` — `tab` so the caller can switch to the offending control
 * rather than leaving the reader to hunt for it behind a tab.
 */
export function validateDraft(draft) {
  if (!draft.fetchSeverities.length) {
    return {
      ok: false,
      tab: "register",
      message: "At least one severity must stay in the scan scope.",
    };
  }
  if (!draft.displaySeverities.length) {
    return {
      ok: false,
      tab: "register",
      message: "At least one severity must stay visible in the display filter.",
    };
  }
  const fetchSet = new Set(draft.fetchSeverities);
  const stray = draft.displaySeverities.find((s) => !fetchSet.has(s));
  if (stray) {
    return {
      ok: false,
      tab: "register",
      message: `${stray} is shown but not scanned — the display filter is always a subset of the scan scope.`,
    };
  }
  const t = draft.riskRule.epssThreshold;
  if (!Number.isFinite(t) || t < 0 || t > 1) {
    return { ok: false, tab: "risk", message: "The EPSS threshold must be between 0 and 1." };
  }
  if (draft.retentionDays !== null) {
    const d = Number(draft.retentionDays);
    if (!Number.isFinite(d) || d < 30) {
      return {
        ok: false,
        tab: "lifecycle",
        message: "The retention window must be at least 30 days.",
      };
    }
  }
  return { ok: true, message: "", tab: null };
}

/**
 * Consequences worth a confirm rather than a refusal — both are legal registers, and both are
 * almost always a mistake. Returns the prompts to put to the reader, in order, or [] for none.
 * Kept separate from validateDraft because "illegal" and "surprising" are different answers and
 * the caller handles them differently.
 */
export function draftWarnings(saved, draft) {
  const out = [];
  if (saved.fetchSeverities.includes("CRITICAL") && !draft.fetchSeverities.includes("CRITICAL")) {
    out.push({
      tab: "register",
      title: "Drop CRITICAL from scans?",
      body: "Scans will stop measuring critical findings entirely. This is rarely intended.",
      confirmLabel: "Drop CRITICAL",
    });
  }
  const r = draft.riskRule;
  if (!r.kev && !r.exploit && !r.epss) {
    out.push({
      tab: "risk",
      title: "Save a rule with no signals?",
      body: "A rule with every signal disabled decides nothing, so every finding will read as "
        + "unclassified on Program performance. Nothing is restored for you.",
      confirmLabel: "Save anyway",
    });
  }
  return out;
}

/**
 * Enforce display ⊆ fetch on the draft in place, returning the severities that were dropped.
 * Called whenever the scan scope shrinks, so the promise the copy makes is kept by the control
 * rather than by the server quietly clamping it after the fact.
 */
export function clampDisplayToFetch(draft) {
  const fetchSet = new Set(draft.fetchSeverities);
  const dropped = draft.displaySeverities.filter((s) => !fetchSet.has(s));
  if (dropped.length) {
    draft.displaySeverities = draft.displaySeverities.filter((s) => fetchSet.has(s));
  }
  return dropped;
}
