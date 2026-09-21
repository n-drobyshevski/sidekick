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

/**
 * The six tabs, in order. `key` is what rides in the hash (`#/settings?tab=risk`). Access owns
 * no batched field below (the roster saves itself — see accessEditor.js's own header) and is
 * not always BUILT: `pages/settings.js` draws it only when `renderAccessPanel()` answers a
 * node, exactly as gas_ai's and gas_devsecops's own Access tabs do, so `normalizeTab` here is
 * always called with the built tab keys as its second argument, never with none.
 */
export const SETTINGS_TABS = [
  { key: "register", label: "Register" },
  { key: "risk", label: "Risk" },
  { key: "attribution", label: "Attribution" },
  { key: "lifecycle", label: "Lifecycle" },
  { key: "access", label: "Access" },
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
  // The four cold-zone knobs, on Lifecycle beside retention and not one of it: retention says
  // how long the register KEEPS a scan, these say how long an asset may go with nothing
  // closing before the register calls it cold. Both are deadlines an operator sets over the
  // whole estate rather than promises about one finding, which is why they share a tab. All
  // four sit on the SAME tab deliberately: the mode decides which of the other three controls
  // is on screen, so a registry that housed them apart would let the save bar offer "jump to"
  // a tab whose control the current mode has hidden.
  coldZoneMode: { tab: "lifecycle", label: "cold-zone mode" },
  coldAfterDays: { tab: "lifecycle", label: "cold-zone window" },
  coldTargetSharePct: { tab: "lifecycle", label: "cold-zone target share" },
  coldFloorDays: { tab: "lifecycle", label: "cold-zone floor" },
};

/**
 * The cold-zone bounds and defaults, mirrored from src/domain/config.ts. The client never
 * imports the TS domain modules (see pages/settings.js's RETENTION_FLOOR_DAYS comment for the
 * rule), so these are second literals held equal to the source of truth by a test rather than
 * by an import. The MODE is a CLOSED SET rather than a range, which is the one place the
 * pattern differs: an unrecognized string has no nearest legal value to be clamped toward, so
 * both this file and the server FALL BACK to "fixed".
 */
export const COLD_MODES = ["fixed", "relative"];
export const DEFAULT_COLD_ZONE_MODE = "fixed";
export const COLD_AFTER_DAYS_MIN = 7;
export const COLD_AFTER_DAYS_MAX = 365;
export const DEFAULT_COLD_AFTER_DAYS = 90;
export const COLD_TARGET_SHARE_PCT_MIN = 1;
export const COLD_TARGET_SHARE_PCT_MAX = 50;
export const DEFAULT_COLD_TARGET_SHARE_PCT = 20;
export const COLD_FLOOR_DAYS_MIN = 1;
export const COLD_FLOOR_DAYS_MAX = 365;
export const DEFAULT_COLD_FLOOR_DAYS = 14;

export const SETTING_KEYS = Object.keys(SETTING_FIELDS);

const kernel = settingsForm({ tabs: SETTINGS_TABS, fields: SETTING_FIELDS, defaultTab: DEFAULT_TAB });

/**
 * The bound kernel — see gas_shared/ui/settingsForm.js's header for `normalizeTab`'s two-
 * argument form. `pages/settings.js` now calls it WITH the second argument: Access is not
 * always built (see SETTINGS_TABS' own comment above), so a stale `#/settings?tab=access`
 * bookmark from a reader who has since lost roster access must land somewhere real rather than
 * selecting a tab that was never drawn this render. See also `changeCountText`'s array
 * signature, `tabStatus`'s key-presence reading of `errors`, and `sameValue`'s
 * `a === b || Object.is(a, b)` leaf.
 */
export const {
  normalizeTab, changedFields, settingsPatch, changeSummary, changeCountText, tabStatus,
  TAB_FIELDS,
} = kernel;

/**
 * A real, finite number off the bootstrap payload, or the shared default — the same
 * refuse-before-you-cast guard `domain/settingsLogic.ts`'s `numericOrNull` applies server-side,
 * and for the same reason: `Number(null)`, `Number("")`, `Number(false)` and `Number([])` are
 * all 0, so a cast-first lift would turn four different kinds of "nothing stored" into the
 * smallest legal value the field has instead of into its default.
 */
function coldNumber(v, fallback) {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
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
    // The cold-zone four. The mode defaults to "fixed" rather than to whatever the payload
    // happened to carry, because "fixed" is what an absent mode MEANS everywhere else in this
    // register (domain/coldZone.ts reads an absent `mode` as fixed); the three numbers are
    // coerced so a string from a hand-edited settings cell cannot reach the number inputs as
    // a string and come back out of `changedFields` looking edited when nothing was typed.
    coldZoneMode: COLD_MODES.indexOf(s.coldZoneMode) >= 0
      ? s.coldZoneMode
      : DEFAULT_COLD_ZONE_MODE,
    coldAfterDays: coldNumber(s.coldAfterDays, DEFAULT_COLD_AFTER_DAYS),
    coldTargetSharePct: coldNumber(s.coldTargetSharePct, DEFAULT_COLD_TARGET_SHARE_PCT),
    coldFloorDays: coldNumber(s.coldFloorDays, DEFAULT_COLD_FLOOR_DAYS),
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
    coldZoneMode: null, coldAfterDays: null, coldTargetSharePct: null, coldFloorDays: null,
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
  // The cold-zone four. ALL FOUR ARE CHECKED IN BOTH MODES, even though only some of them are
  // on screen at a time: the draft carries every one of them whichever mode is selected (see
  // pages/settings.js — the relative-mode controls are hidden, never disabled, and their values
  // are preserved), so a value typed in one mode and left behind in the other is still what
  // would be SAVED, and refusing to check it would let it through unseen.
  const cw = Number(draft.coldAfterDays);
  if (!Number.isFinite(cw) || cw < COLD_AFTER_DAYS_MIN || cw > COLD_AFTER_DAYS_MAX) {
    errs.coldAfterDays = "The cold-zone window must be at least " + COLD_AFTER_DAYS_MIN
      + " days and at most " + COLD_AFTER_DAYS_MAX + " days.";
  }
  const ct = Number(draft.coldTargetSharePct);
  if (
    !Number.isFinite(ct) || ct < COLD_TARGET_SHARE_PCT_MIN || ct > COLD_TARGET_SHARE_PCT_MAX
  ) {
    errs.coldTargetSharePct = "The cold-zone target share must be at least "
      + COLD_TARGET_SHARE_PCT_MIN + "% and at most " + COLD_TARGET_SHARE_PCT_MAX + "%.";
  }
  const cf = Number(draft.coldFloorDays);
  if (!Number.isFinite(cf) || cf < COLD_FLOOR_DAYS_MIN || cf > COLD_FLOOR_DAYS_MAX) {
    errs.coldFloorDays = "The cold-zone floor must be at least " + COLD_FLOOR_DAYS_MIN
      + " day and at most " + COLD_FLOOR_DAYS_MAX + " days.";
  }
  // A FALLBACK EVERYWHERE ELSE, AN ERROR HERE, and the difference is who is answering. The
  // server falls back to "fixed" for an unreadable stored mode because a settings cell nobody
  // is looking at has to resolve to something; this page's own control can only ever produce
  // one of the two, so a draft holding anything else means something upstream went wrong and
  // saying so beats silently saving a mode the reader never picked.
  if (COLD_MODES.indexOf(draft.coldZoneMode) < 0) {
    errs.coldZoneMode = "The cold-zone mode must be either fixed or relative.";
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
  // The mode first of the cold four: it decides which of the other three the reader can see,
  // so a message about a window they cannot reach would send them to a tab with no such control.
  if (errs.coldZoneMode) return { ok: false, tab: "lifecycle", message: errs.coldZoneMode };
  if (errs.coldAfterDays) return { ok: false, tab: "lifecycle", message: errs.coldAfterDays };
  if (errs.coldTargetSharePct) {
    return { ok: false, tab: "lifecycle", message: errs.coldTargetSharePct };
  }
  if (errs.coldFloorDays) return { ok: false, tab: "lifecycle", message: errs.coldFloorDays };
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
        + "unclassified on Coverage & efficiency. Nothing is restored for you.",
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
