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
//
// THE DIRTY/SAVE-BAR MECHANICS BELOW ARE NOT THIS FILE'S OWN ANY MORE. `normalizeTab`,
// `changedFields`, `settingsPatch`, `changeSummary`, `changeCountText` and `tabStatus` were
// byte-identical or near enough across gas/, gas_ai/ and gas_devsecops/ — three copies of one
// rule agreeing by having been typed the same way. `gas_shared/ui/settingsForm.js` is that one
// rule now, a factory closed over THIS file's own `SETTINGS_TABS`/`SETTING_FIELDS` below, so
// this file still owns the registry and every other app import of these six names keeps
// working unchanged. What stays genuinely local: the registry itself, `settingsDraft` (this
// register's own payload shape), `fieldErrors`/`validateDraft`/`draftWarnings` (this register's
// own rules) and `clampDisplayToFetch` (nothing else has a display/fetch subset relationship to
// enforce). See settingsForm.js's own header for why its `sameValue` leaf is
// `a === b || Object.is(a, b)` rather than this file's old `JSON.stringify` comparison, and for
// why `dirtyTabs` — one of the functions this file used to export — did not come back: nothing
// in `pages/settings.js` has called it since `tabStatus` replaced it (see the comment at that
// call site), and its only remaining caller was this app's own test file.

import { settingsForm } from "../../../../gas_shared/ui/settingsForm.js";

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

const kernel = settingsForm({ tabs: SETTINGS_TABS, fields: SETTING_FIELDS, defaultTab: DEFAULT_TAB });

/**
 * The bound kernel — see gas_shared/ui/settingsForm.js's header for `normalizeTab`'s two-
 * argument form (this app only ever calls it with one; every SETTINGS_TABS key is always
 * built), `changeCountText`'s array signature, `tabStatus`'s key-presence reading of `errors`,
 * and `sameValue`'s `a === b || Object.is(a, b)` leaf.
 */
export const {
  normalizeTab, changedFields, settingsPatch, changeSummary, changeCountText, tabStatus,
  TAB_FIELDS,
} = kernel;

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

/**
 * Per-field legality of the draft, independent of any other field's state — unlike
 * `validateDraft` below, which stops at the FIRST failure it finds (in a fixed priority
 * order) so it can hand the save button one message and one tab to jump to. This is the same
 * four rules, in the shape a live inline error needs: a reader who has broken the scan scope
 * AND typed a bad EPSS value at the same time is entitled to see BOTH spans lit at once, not
 * just whichever one `validateDraft` would have reported first.
 *
 * Returns one entry per checked field, `null` when that field is legal. `validateDraft`
 * below is now DEFINED IN TERMS OF THIS — a priority order over the same four checks — so the
 * two can never quietly diverge into two different opinions about what "legal" means.
 */
export function fieldErrors(draft) {
  const errs = {
    fetchSeverities: null, displaySeverities: null, riskRule: null, retentionDays: null,
  };
  if (!draft.fetchSeverities.length) {
    errs.fetchSeverities = "At least one severity must stay in the scan scope.";
  }
  if (!draft.displaySeverities.length) {
    errs.displaySeverities = "At least one severity must stay visible in the display filter.";
  } else {
    const fetchSet = new Set(draft.fetchSeverities);
    const stray = draft.displaySeverities.find((s) => !fetchSet.has(s));
    if (stray) {
      errs.displaySeverities =
        `${stray} is shown but not scanned — the display filter is always a subset of the scan scope.`;
    }
  }
  const t = draft.riskRule.epssThreshold;
  if (!Number.isFinite(t) || t < 0 || t > 1) {
    errs.riskRule = "The EPSS threshold must be between 0 and 1.";
  }
  if (draft.retentionDays !== null) {
    const d = Number(draft.retentionDays);
    if (!Number.isFinite(d) || d < 30) {
      errs.retentionDays = "The retention window must be at least 30 days.";
    }
  }
  return errs;
}

/**
 * Whether the draft may be sent, and why not. These are the same rules the per-panel saves
 * enforced today, gathered in one place: an empty scope is not a legal register, and the display
 * filter is a subset of the scan scope by construction rather than by server rescue.
 *
 * Returns `{ ok, message, tab }` — `tab` so the caller can switch to the offending control
 * rather than leaving the reader to hunt for it behind a tab. The ORDER below is a priority,
 * not a coincidence: fixing the scan scope first is what makes the display-filter message
 * that follows it meaningful (a stray display severity is moot noise while the scope itself
 * is still empty).
 */
export function validateDraft(draft) {
  const errs = fieldErrors(draft);
  if (errs.fetchSeverities) return { ok: false, tab: "register", message: errs.fetchSeverities };
  if (errs.displaySeverities) return { ok: false, tab: "register", message: errs.displaySeverities };
  if (errs.riskRule) return { ok: false, tab: "risk", message: errs.riskRule };
  if (errs.retentionDays) return { ok: false, tab: "lifecycle", message: errs.retentionDays };
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
