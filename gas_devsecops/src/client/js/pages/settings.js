// Settings — Register, Deadlines, Access and System, over one save bar.
//
// THIS PAGE WAS NEVER ASSIGNED. The Phase 2 Wave 5 ownership table covered nine of the ten
// routes and omitted this one; it is the only page still carrying the Phase 1 stub, and the
// stub's own `sections` array (see the version this replaced) is the closest thing this page
// had to a spec: register (scopes + per-scope severities + the Wiz project id), deadlines
// (SLA targets), access (owner/admin/user), system (credentials, schedule, diagnostic).
//
// PURE VIEW MODEL, THIN DOM — the same split every Phase 2 page uses (see pages/data.js's own
// header), because this repo runs no jsdom (vitest.config.ts sets no `environment`): every
// function above `renderSettings` is exercised directly by test/pagesSettings.test.js, and
// `renderSettings` itself is read as source text.
//
// THE CLIENT NEVER IMPORTS domain/*.ts — checked across the other nine pages before writing
// this one, not assumed. SCOPE_LABELS is duplicated here exactly as it already is in
// program.js/executive.js/history.js; RETENTION_FLOOR_DAYS and DEFAULT_SYNC_HOUR mirror
// domain/maintenance.ts's RETENTION_MIN_DAYS and domain/settingsLogic.ts's DEFAULT_SYNC_HOUR
// for the same reason, and are used only to paint a hint BEFORE a save — what the server
// actually stored (including any clamp or fallback) is what `saveReconciliation` reports,
// straight from api_putSettings's own response, never from the local guess.
//
// fetchSeverities.secrets SHIPS [] ON PURPOSE, AND THAT IS THE ONE THING THIS PAGE MUST NOT
// GET WRONG. domain/config.ts's DEFAULT_FETCH_SEVERITIES walks two earlier, wrong answers
// (CRITICAL/HIGH inherited from the vulnerability registers, then MEDIUM on "PASSWORD and
// CERTIFICATE sit below HIGH") before landing on no gate at all: severity grades how a
// scanner classified the DETECTION, not whether the credential is live — 641 SAAS_API_KEY
// rows read LOW. `registerFieldView` below renders an empty list as "All severities", never
// as "None" — see history.js's `isAllSeverities`/`severitiesLabel` for the same predicate
// applied to a scan row instead of a draft.
//
// showExperimental IS ONE OF THE PAGE-EDITABLE Settings FIELDS AND DELIBERATELY GETS NO CONTROL TIED
// TO api_putSettings. The rail's actual "show experimental content" gate
// (app.js: "`experimental` gates a route behind Settings -> show experimental content.") is
// `experimental.js`'s own browser-local flag — nothing in this codebase reads
// `bootstrap.settings.showExperimental` for that purpose. A control here that wrote the
// server-side field would be exactly the thing app.js's own header warns against: "a control
// with nothing behind it is the one thing this app's chrome is careful never to offer." So
// this page reuses `experimental.js`'s real switch (self-saving, immediate) and leaves the
// server-side field as a pass-through the draft still carries, so it is never dropped on save.
//
// wizProjectId IS NOT IN Settings, AND NOT IN Bootstrap EITHER — settingsLogic.ts's own header
// explains why (it is the WIZ_PROJECT_ID_V2 script property, folded into the cache stamp from
// ONE home only). Bootstrap carries no field for it, so the Register tab states that plainly
// instead of fabricating a value or a control this page has no data to back.
//
// ACCESS HAS NO ROSTER RPC IN THIS BUILD. api.ts exposes `canEditAccess` and nothing to list
// or save the allowlist/admin list — those live on Script Properties, set outside this tab.
// So the Access tab is display-only for every viewer regardless of `canEditAccess`: what
// differs is the WORDS a permitted viewer sees (`manageHint`, pointing at where the roster
// actually lives), never a button or field this build cannot back.

import { call } from "../../../../../gas_shared/api.js";
import { bootstrapCached, invalidateBootstrap, setParams } from "../../../../../gas_shared/store.js";
import { setShowExperimental, showExperimental } from "../experimental.js";
import {
  clear, confirmDialog, denomNote, diagnosticCard, diagnosticsPanel, el, errorState, fmtCount,
  fmtDateTime, glossaryTip, heroLines, pageHeader, segmented, skeletonStack, statusPill,
  tipLabel, toast, togglePills,
} from "../ui.js";
import { disclosure, saveBar, settingRow, settingsPanel, switchToggle, tabList } from "../../../../../gas_shared/ui/settings.js";
import { hubUrlPanel } from "../../../../../gas_shared/ui/hubPanel.js";
import {
  DEFAULT_TAB, SETTINGS_TABS, TAB_FIELDS,
  changeCountText, changeSummary, changedFields, draftWarnings, normalizeTab, tabStatus,
  validateDraft,
} from "../settingsModel.js";
import {
  createSlaCutlineReadout, renderRetentionReadout, severityScopeReadout, slaDivergenceNote,
  strandedOpenCount, strandedRowsReadout,
} from "../settingsReadouts.js";

// ============================================================================ vocabulary

// A PLAIN LITERAL, NOT DERIVED AT RUNTIME — an earlier draft of this line read
// `Object.assign({...}, (bootstrapCached() || {}).scopeLabels)`, which never did anything:
// this is module top-level code, evaluated at import time, before app.js's boot() has ever
// called bootstrap() — so `bootstrapCached()` is always null here and the literal always won.
// "A guard that fires on nothing is a finding, not a pass" (CLAUDE.md). This duplicates
// `src/domain/config.ts`'s SCOPE_LABELS BY VALUE (the short form the server ships,
// "Dependencies"/"Code"/"Secrets") rather than reading it — the client never imports
// domain/*.ts (this file's own header states that rule) — so the two copies are held equal by
// a test instead: test/pagesSettings.test.js asserts this literal against the domain export.
export const SCOPE_LABELS = { sca: "Dependencies", sast: "Code", secrets: "Secrets" };
// secrets has no matching glossary entry of its own (its terms — validation-state, rotated,
// removed — describe the lifecycle, not the register as a whole), so it gets a plain label.
const SCOPE_TERMS = { sca: "sca", sast: "sast" };
const LOCAL_SCOPES = ["sca", "sast", "secrets"]; // mirrors domain/config.ts SCOPES

export const RETENTION_FLOOR_DAYS = 30; // domain/maintenance.ts::RETENTION_MIN_DAYS
export const DEFAULT_SYNC_HOUR = 5; // domain/settingsLogic.ts::DEFAULT_SYNC_HOUR

// domain/config.ts::DEFAULT_COLD_AFTER_DAYS / COLD_AFTER_DAYS_MIN / COLD_AFTER_DAYS_MAX,
// mirrored here for the same reason the two constants above are (the client never imports
// domain/*.ts — see the module header) and held equal to them by test/pagesSettings.test.js.
// They paint a hint BEFORE a save; what the server actually stored, clamp included, is what
// `saveReconciliation` reports from api_putSettings's own response.
export const DEFAULT_COLD_AFTER_DAYS = 90;
export const COLD_WINDOW_MIN_DAYS = 7;
export const COLD_WINDOW_MAX_DAYS = 365;

// The relative cold-zone mode's own three mirrors, for the same reason and under the same
// test: domain/config.ts::COLD_ZONE_MODES / DEFAULT_COLD_ZONE_MODE,
// DEFAULT_COLD_TARGET_SHARE_PCT / COLD_TARGET_SHARE_PCT_MIN / _MAX, and
// DEFAULT_COLD_FLOOR_DAYS / COLD_FLOOR_DAYS_MIN / _MAX. The mode is a CLOSED SET rather than
// a range, which is the one place the pattern differs: an unrecognized string has no nearest
// legal value to be clamped toward, so both this page and the server FALL BACK to "fixed".
export const COLD_MODES = ["fixed", "relative"]; // domain/config.ts::COLD_ZONE_MODES
export const PAGE_DEFAULT_COLD_ZONE_MODE = "fixed";
export const COLD_TARGET_MIN_PCT = 1;
export const COLD_TARGET_MAX_PCT = 50;
export const PAGE_DEFAULT_COLD_TARGET_SHARE_PCT = 20;
export const COLD_FLOOR_MIN_DAYS = 1;
export const COLD_FLOOR_MAX_DAYS = 365;
export const PAGE_DEFAULT_COLD_FLOOR_DAYS = 14;

// Settings also carries `projectView` — the VIEW scope, which project the pages SHOW —
// and it is DELIBERATELY ABSENT from SETTINGS_KEYS, from FIELD_TABS, from BATCHED_KEYS and
// from draftFromSettings below. It is app-header chrome, not a settings-page field: a later
// package puts a header control on it that reads and writes it directly through its own
// `api_setProjectView` endpoint, one field at a time, without loading or resending the other
// others. Adding it here would (a) draw a control for it on the wrong page and (b) put it in
// this page's draft, so an ordinary Register/Deadlines/System save — which never touches
// `api_setProjectView` — would round-trip it through `api_putSettings` right alongside
// `showExperimental`'s pass-through problem below, except worse: showExperimental's control
// lives elsewhere in this SAME app and this page still forwards its value, where projectView
// would have no source at all to forward and would silently save back whatever stale value
// this page happened to load with. `test/pagesSettings.test.js` pins the exclusion.
export const SETTINGS_KEYS = [
  "scopes", "fetchSeverities", "slaTargets", "coldAfterDays", "coldZoneMode",
  "coldTargetSharePct", "coldFloorDays", "excludeEndOfLifeFromColdZone",
  "excludeEndOfLifeFromMttr", "showExperimental",
  "syncSchedule", "autoCompact", "retentionDays",
];

// Which of the ten batched fields the save bar owns, and which tab owns each — showExperimental
// is deliberately absent, see the module header. projectView is absent for the separate
// reason given above SETTINGS_KEYS: it has no tab on this page at all.
//
// `= TAB_FIELDS` rather than a second literal, and `TAB_FIELDS` ITSELF now comes straight from
// settingsModel.js's own `SETTING_FIELDS` — the tab-and-label registry both files used to keep
// half of. tabStatus() below computes each tab's dirty/invalid state for the tablist off this
// SAME map, so a field can never be listed under one tab in the save bar and marked on a
// different tab in the tablist.
export const FIELD_TABS = TAB_FIELDS;
export const BATCHED_KEYS = Object.keys(FIELD_TABS);

// TABS/DEFAULT_TAB/normalizeTab/changedFields/changeSummary/changeCountText are re-exported
// from settingsModel.js below rather than declared here — see this page's import line and that
// file's own header.
export const TABS = SETTINGS_TABS;
export { DEFAULT_TAB, changeCountText, changeSummary, changedFields, normalizeTab };

// ============================================================================ pure view model

/**
 * Lift api_getSettings's payload into a flat draft over every page-editable
 * Settings field, defensively — a malformed cell must not crash the page (the server's own `cleanSettings`
 * carries the same never-throw contract; this is its client-side mirror, not a replacement
 * for it). Arrays and per-scope records are copied, never aliased, so editing the draft can
 * never mutate a payload a background revalidation is still holding.
 */
export function draftFromSettings(settings) {
  const s = settings || {};
  const fs = s.fetchSeverities && typeof s.fetchSeverities === "object" ? s.fetchSeverities : {};
  const sla = s.slaTargets && typeof s.slaTargets === "object" ? s.slaTargets : {};
  return {
    scopes: Array.isArray(s.scopes) && s.scopes.length ? [...s.scopes] : [...LOCAL_SCOPES],
    fetchSeverities: Object.fromEntries(
      LOCAL_SCOPES.map((scope) => [scope, Array.isArray(fs[scope]) ? [...fs[scope]] : []]),
    ),
    slaTargets: { ...sla },
    // Defensively, exactly like the two scalars below it: a settings cell holding a string, an
    // object or nothing at all must paint the default rather than put NaN in a number input.
    // The server's own `cleanColdAfterDays` is what CLAMPS a real out-of-range number into
    // [7, 365] — this fallback only covers "not a number at all".
    coldAfterDays: Number.isFinite(Number(s.coldAfterDays))
      ? Number(s.coldAfterDays)
      : DEFAULT_COLD_AFTER_DAYS,
    // The MODE is lifted through `coldModeFieldView` rather than by a second copy of "is it
    // one of the two words": an unrecognized string (or a number, or nothing at all) has to
    // land on "fixed" here exactly as the server's own `cleanColdZoneMode` lands it there, and
    // one function is how that stays true. A genuine string is trimmed and lowercased on the
    // way, so a hand-edited cell holding " RELATIVE " opens the panel in the mode it means.
    coldZoneMode: coldModeFieldView(s.coldZoneMode).value,
    // The two relative-mode numbers, lifted exactly as `coldAfterDays` above is — junk paints
    // the default rather than putting NaN in a number input, and a REAL out-of-range number is
    // carried as typed, because clamping it is the server's job and `saveReconciliation` is
    // what reports the clamp afterwards.
    coldTargetSharePct: Number.isFinite(Number(s.coldTargetSharePct))
      ? Number(s.coldTargetSharePct)
      : PAGE_DEFAULT_COLD_TARGET_SHARE_PCT,
    coldFloorDays: Number.isFinite(Number(s.coldFloorDays))
      ? Number(s.coldFloorDays)
      : PAGE_DEFAULT_COLD_FLOOR_DAYS,
    // Only a literal `true`, mirroring the server's own `cleanSettings`: a settings cell
    // holding a string or a number is not consent to delete repositories from a measurement.
    // Two independent reads — neither switch is a default for the other.
    excludeEndOfLifeFromColdZone: s.excludeEndOfLifeFromColdZone === true,
    excludeEndOfLifeFromMttr: s.excludeEndOfLifeFromMttr === true,
    showExperimental: s.showExperimental === true,
    syncSchedule: Number.isFinite(Number(s.syncSchedule)) ? Number(s.syncSchedule) : DEFAULT_SYNC_HOUR,
    autoCompact: s.autoCompact === true,
    retentionDays: Number.isFinite(Number(s.retentionDays)) ? Number(s.retentionDays) : RETENTION_FLOOR_DAYS,
  };
}

// `changedFields`/`changeSummary`/`changeCountText` are the kernel's (see the import line and
// settingsModel.js's own header). `changedFields` used to scan this page's own SETTINGS_KEYS —
// seven fields, `showExperimental` included — while `changeSummary` filtered its result down to
// the six FIELD_TABS carries; nothing ever set `draft.showExperimental` to a value other than
// what it loaded with, so the gap between the two never actually printed a mismatched count
// beside an empty summary, but it was a live structural inconsistency rather than a proven-safe
// one. Reading `changedFields` off the same six-key registry `changeSummary` and `tabStatus`
// already read closes the gap outright rather than leaving it merely unreachable.

// ---------------------------------------------------------------------------- register tab

// SPLIT IN TWO SO THE ROW CAN SHOW ITS LEDE AND DISCLOSE THE REST (R1's ladder), while
// `registerFieldView().note` — pinned by test/pagesSettings.test.js to still contain
// "detection" — keeps reading the WHOLE sentence, unchanged, below. Only the DOM half
// (`registerScopeBlock`) reads the two halves separately; the model still hands back one note.
const SECRETS_SEVERITY_LEDE = "No severity gate is set by default.";
const SECRETS_SEVERITY_DETAIL =
  "Severity grades how a scanner classified the detection, not whether the credential is "
  + "still live — a SAAS_API_KEY can read LOW and still work. An empty selection here "
  + "requests every severity, which is this register's whole CODE population.";
const SECRETS_ALL_NOTE = SECRETS_SEVERITY_LEDE + " " + SECRETS_SEVERITY_DETAIL;

const SCOPE_ALL_NOTE = "No severities selected requests every severity for this register.";

/**
 * One scope's severity picker, read the same way whichever scope it is — and the one function
 * on this page that most needs to get "empty" right. `fetchSeverities.secrets` ships `[]` on
 * purpose (domain/config.ts's `DEFAULT_FETCH_SEVERITIES`), and `[]` means "every severity",
 * never "no severity". Rendering it as "None selected" would invert the most carefully-argued
 * default in this register — see history.js's `severitiesLabel` for the same "All severities"
 * wording applied to a saved scan row instead of a draft.
 */
export function registerFieldView(scope, list) {
  const selected = Array.isArray(list) ? [...list] : [];
  const allSelected = selected.length === 0;
  return {
    scope,
    label: SCOPE_LABELS[scope] || scope,
    selected,
    allSelected,
    displayText: allSelected ? "All severities" : selected.join(", "),
    note: scope === "secrets" ? SECRETS_ALL_NOTE : SCOPE_ALL_NOTE,
  };
}

// --------------------------------------------------------------------------- deadlines tab

/** SLA rows in severity order, UNKNOWN excluded — SLA_TARGETS never carries it either. */
export function slaFieldRows(slaTargets, severityOrder) {
  const order = (Array.isArray(severityOrder) ? severityOrder : []).filter((s) => s !== "UNKNOWN");
  const targets = slaTargets || {};
  const known = order.filter((sev) => Object.prototype.hasOwnProperty.call(targets, sev));
  const rest = Object.keys(targets).filter((sev) => !known.includes(sev));
  return [...known, ...rest].map((sev) => ({ sev, days: Number(targets[sev]) }));
}

// ------------------------------------------------------------------------------ system tab

/** Read the floor honestly: a value below it shows the floor, not the number that was typed. */
export function retentionFieldView(days) {
  const n = Number(days);
  const value = Number.isFinite(n) ? n : RETENTION_FLOOR_DAYS;
  return {
    value,
    floor: RETENTION_FLOOR_DAYS,
    belowFloor: value < RETENTION_FLOOR_DAYS,
    displayValue: Math.max(value, RETENTION_FLOOR_DAYS),
  };
}

/**
 * The cold-zone window, read the same honest way `retentionFieldView` reads the retention
 * floor — and BOUNDED AT BOTH ENDS, which is the one difference. The retention window has a
 * floor and no ceiling; this one has both, so a value outside the range is reported as
 * `belowFloor` or `aboveCeiling` (with `outOfRange` for the callers that only need to know
 * that something will move) and `displayValue` is what a save would actually store.
 *
 * The RAW typed value is always carried beside them, so a caller can tell "the reader typed
 * 400" from "the register will use 365" — the same distinction the retention view keeps.
 */
export function coldWindowFieldView(days) {
  const n = Number(days);
  const value = Number.isFinite(n) ? n : DEFAULT_COLD_AFTER_DAYS;
  const belowFloor = value < COLD_WINDOW_MIN_DAYS;
  const aboveCeiling = value > COLD_WINDOW_MAX_DAYS;
  return {
    value,
    floor: COLD_WINDOW_MIN_DAYS,
    ceiling: COLD_WINDOW_MAX_DAYS,
    belowFloor,
    aboveCeiling,
    outOfRange: belowFloor || aboveCeiling,
    displayValue: Math.min(COLD_WINDOW_MAX_DAYS, Math.max(COLD_WINDOW_MIN_DAYS, value)),
  };
}

/**
 * The cold-zone MODE, read the way the server reads it: a genuine string, trimmed and
 * lowercased, that is one of the two known modes — anything else is "nothing was chosen" and
 * falls back to fixed.
 *
 * A FALLBACK, NOT A CLAMP, and `known` is what makes that visible to a caller. The two views
 * below this one report `outOfRange` because a number outside a range still points at an end
 * of it; a string outside a two-member set points at nothing, so the honest report is "this
 * was not a mode" and the page shows fixed. `saveReconciliation` uses the same distinction —
 * the clamp notes name a range, the mode note names the string it could not read.
 *
 * `options` is carried here rather than built at the control, so the two labels the segmented
 * control shows are part of the tested view model and not a literal buried in the DOM half.
 */
export function coldModeFieldView(mode) {
  const raw = typeof mode === "string" ? mode.trim().toLowerCase() : "";
  const known = COLD_MODES.indexOf(raw) >= 0;
  const value = known ? raw : PAGE_DEFAULT_COLD_ZONE_MODE;
  return {
    value,
    isRelative: value === "relative",
    known,
    options: [
      { value: "fixed", label: "Fixed window" },
      { value: "relative", label: "Relative" },
    ],
  };
}

/**
 * The relative mode's target share, in per cent — `coldWindowFieldView`'s shape exactly,
 * because it is the same kind of field: bounded at both ends, clamped by the server, and
 * worth reporting honestly rather than silently redrawing. 1..50: a "cold zone" that is more
 * than half the estate is not a zone, and a share of zero would name nobody.
 */
export function coldTargetFieldView(pct) {
  const n = Number(pct);
  const value = Number.isFinite(n) ? n : PAGE_DEFAULT_COLD_TARGET_SHARE_PCT;
  const belowFloor = value < COLD_TARGET_MIN_PCT;
  const aboveCeiling = value > COLD_TARGET_MAX_PCT;
  return {
    value,
    floor: COLD_TARGET_MIN_PCT,
    ceiling: COLD_TARGET_MAX_PCT,
    belowFloor,
    aboveCeiling,
    outOfRange: belowFloor || aboveCeiling,
    displayValue: Math.min(COLD_TARGET_MAX_PCT, Math.max(COLD_TARGET_MIN_PCT, value)),
  };
}

/**
 * The relative mode's floor, in days — the same shape again, 1..365. This is the number that
 * stops a derived line from calling a healthy estate cold: the share always names somebody,
 * and on a landscape where the idlest fifth has been quiet for nine days, nobody should be.
 */
export function coldFloorFieldView(days) {
  const n = Number(days);
  const value = Number.isFinite(n) ? n : PAGE_DEFAULT_COLD_FLOOR_DAYS;
  const belowFloor = value < COLD_FLOOR_MIN_DAYS;
  const aboveCeiling = value > COLD_FLOOR_MAX_DAYS;
  return {
    value,
    floor: COLD_FLOOR_MIN_DAYS,
    ceiling: COLD_FLOOR_MAX_DAYS,
    belowFloor,
    aboveCeiling,
    outOfRange: belowFloor || aboveCeiling,
    displayValue: Math.min(COLD_FLOOR_MAX_DAYS, Math.max(COLD_FLOOR_MIN_DAYS, value)),
  };
}

export const AUTO_COMPACT_OFF_NOTE =
  "Off by default. This preserves the behaviour that shipped before this setting existed — "
  + "turning it on is a choice this page leaves to you, not one it steers you toward.";

/** The maintenance pair, read together — retentionDays is only consulted once autoCompact is true. */
export function maintenanceFieldView(draft) {
  const d = draft || {};
  return {
    autoCompact: d.autoCompact === true,
    retention: retentionFieldView(d.retentionDays),
  };
}

/**
 * What the server actually stored versus what was sent — the honest surface for the two
 * fields `cleanSettings` may silently rewrite: `retentionDays` is CLAMPED up to the floor,
 * `syncSchedule` FALLS BACK to the default when out of range. Reading only `sent` would miss
 * a rewrite this page never asked for; reading only `saved` would miss that one happened at
 * all. Returns human sentences rather than a code, because the only consumer is a toast.
 */
export function saveReconciliation(sent, saved) {
  const notes = [];
  const s = sent || {};
  const r = saved || {};
  if (Number.isFinite(Number(s.retentionDays)) && Number(s.retentionDays) !== Number(r.retentionDays)) {
    notes.push(
      `Retention window saved as ${r.retentionDays} day(s) — raised to the ${RETENTION_FLOOR_DAYS}-day floor.`,
    );
  }
  // The cold-zone window is the third field the server may silently rewrite, and it is CLAMPED
  // (into a range, at either end) rather than defaulted — so the note names the range and the
  // stored value, never "it was rejected".
  if (Number.isFinite(Number(s.coldAfterDays)) && Number(s.coldAfterDays) !== Number(r.coldAfterDays)) {
    notes.push(
      `Cold-zone window saved as ${r.coldAfterDays} days — clamped into the `
      + `${COLD_WINDOW_MIN_DAYS}–${COLD_WINDOW_MAX_DAYS} range.`,
    );
  }
  // The relative mode's two numbers are clamped exactly as the window above is, so they are
  // reported exactly as it is — the range and the stored value, never "it was rejected".
  if (
    Number.isFinite(Number(s.coldTargetSharePct))
    && Number(s.coldTargetSharePct) !== Number(r.coldTargetSharePct)
  ) {
    notes.push(
      `Cold-zone target share saved as ${r.coldTargetSharePct}% — clamped into the `
      + `${COLD_TARGET_MIN_PCT}–${COLD_TARGET_MAX_PCT}% range.`,
    );
  }
  if (Number.isFinite(Number(s.coldFloorDays)) && Number(s.coldFloorDays) !== Number(r.coldFloorDays)) {
    notes.push(
      `Cold-zone floor saved as ${r.coldFloorDays} days — clamped into the `
      + `${COLD_FLOOR_MIN_DAYS}–${COLD_FLOOR_MAX_DAYS}-day range.`,
    );
  }
  // The MODE is the one rewrite that is a FALLBACK rather than a clamp (see coldModeFieldView),
  // so its note names the string the server could not read instead of a range it was pulled
  // into — "clamped into the fixed–relative range" would be nonsense.
  if (typeof s.coldZoneMode === "string" && s.coldZoneMode !== r.coldZoneMode) {
    notes.push(
      `Cold-zone mode saved as ${r.coldZoneMode} — "${s.coldZoneMode}" is not a mode.`,
    );
  }
  if (Number.isFinite(Number(s.syncSchedule)) && Number(s.syncSchedule) !== Number(r.syncSchedule)) {
    notes.push(
      `Sync hour saved as ${r.syncSchedule}:00 — ${s.syncSchedule} was out of range, so it fell back to the default.`,
    );
  }
  return notes;
}

// -------------------------------------------------------------------------------- access tab

/**
 * `canEditAccess` gates WORDS, not a control — this build ships no roster RPC (see the module
 * header), so there is never an editing affordance here for anyone. `manageHint` is the only
 * field that depends on the flag, and it is null for a viewer who may not edit access, so a
 * viewer without permission sees state and nothing that could be mistaken for a way to change
 * it.
 */
export function accessFieldView(canEditAccess) {
  const editable = canEditAccess === true;
  return {
    canEditAccess: editable,
    tiers: [
      { tier: "Owner", note: "Appoints admins. Always allowed, ahead of either list." },
      { tier: "Admin", note: "Maintains the user list." },
      { tier: "User", note: "Can open the app." },
    ],
    failsClosedNote:
      "An allowlist nobody has set reads as owner-only, never as open — access fails closed.",
    manageHint: editable
      ? "The allowlist and admin list are Script Properties (ALLOWED_USERS / ALLOWED_ADMINS); "
        + "an owner or admin sets them outside this tab."
      : null,
  };
}

// ==================================================================================== page

export async function renderSettings(host, params, ctx) {
  host.append(pageHeader({
    route: "settings",
    // "Register, deadlines, access, system" was the hero VALUE — the contents list, not a
    // figure. Same words, one level down, under the h1 the route's PAGES title supplies.
    lede: heroLines(
      "Register, deadlines, access, system",
      "One save bar covers the register, the deadlines and the maintenance schedule. Access "
        + "and the show-experimental preference save themselves, on their own controls.",
    ),
  }));

  const tabHost = el("div", {});
  // A PLAIN GROUPING DIV, ON PURPOSE — not a layout class. Its four children each own their
  // own `hidden` attribute (only the active tab's panel is ever shown), and default block flow
  // already stacks them exactly the way gas/gas_ai append their tab panels straight to `host`
  // with no wrapper at all — nothing here needs a rule to arrange. `settings-panels` used to be
  // the class on this node, with no CSS rule anywhere in the repo behind it; deleted rather than
  // given a no-op rule, since nothing about the four-tabpanel layout above actually needs one.
  const panelHost = el("div", {});
  const bar = saveBar({
    onSave: () => doSave(),
    onDiscard: () => doDiscard(),
    onJump: (key) => tabs.focusTab(key),
  });

  const panels = {
    register: el("div", { id: "tab-panel-register", role: "tabpanel", "aria-labelledby": "tab-register" }),
    deadlines: el("div", {
      id: "tab-panel-deadlines", role: "tabpanel", "aria-labelledby": "tab-deadlines", hidden: true,
    }),
    access: el("div", {
      id: "tab-panel-access", role: "tabpanel", "aria-labelledby": "tab-access", hidden: true,
    }),
    system: el("div", {
      id: "tab-panel-system", role: "tabpanel", "aria-labelledby": "tab-system", hidden: true,
    }),
  };
  panelHost.append(panels.register, panels.deadlines, panels.access, panels.system);
  for (const key of Object.keys(panels)) panels[key].append(skeletonStack(3));

  const tabs = tabList({
    tabs: TABS,
    active: normalizeTab(params && params.tab),
    ariaLabel: "Settings sections",
    idPrefix: "tab",
    onSelect: (key) => {
      for (const k of Object.keys(panels)) panels[k].hidden = k !== key;
      // history.replaceState — does not fire hashchange, does not re-render. Without this,
      // `#/settings?tab=deadlines` could be READ on entry (normalizeTab(params.tab) above) but
      // never PRODUCED by using the page: every click left the address bar on whatever tab the
      // reader arrived at. gas_ai's settings page does the same thing at the same call site.
      setParams({ tab: key });
    },
  });

  host.append(tabHost, bar.node, panelHost);
  tabHost.append(tabs.node);

  const boot = bootstrapCached() || {};
  const severityOrder = (boot.severityOrder && boot.severityOrder.length ? boot.severityOrder : []);
  const scopeList = (boot.scopes && boot.scopes.length ? boot.scopes : LOCAL_SCOPES);

  let saved;
  let draft;
  // Fields currently failing their OWN input's validity check, keyed by SETTINGS_KEYS name —
  // independent of `draft`, on purpose: an in-progress keystroke that fails validation never
  // writes into `draft` (see e.g. the SLA oninput below), so a field can be invalid without
  // being dirty. Cleared wholesale on discard, since `draft` reverts to `saved` and `saved` is
  // always a legal Settings object. tabStatus() below reads only key PRESENCE, so a field is
  // marked valid again by deleting its key, never by setting a falsy message.
  let errors = {};

  function setFieldError(field, message) {
    if (message) errors[field] = message; else delete errors[field];
  }

  // The api_getSettingsImpact payload — decorative, exactly like gas's and gas_ai's own copy of
  // this variable: every control on this page already applied its own edit before this ever
  // resolves, and `repaintReadouts()` below opens with `if (!impact) return;` so a slow or
  // failed fetch costs this page some captions, never a working control.
  let impact = null;
  // Live-readout DOM hosts, reassigned each time buildRegisterPanel()/buildSystemPanel() run
  // (initial load, and again on Discard) so repaintReadouts() always writes into whichever
  // hosts are actually attached to the page right now.
  let severitySplitHosts = {};
  let strandedHost = null;
  let retentionHost = null;
  // Per-severity SLA input elements, so a cutline drag (below) can push its value back into the
  // same plain number field the reader might otherwise type into — see slaCutlines' own comment.
  let slaInputs = {};
  // The standing divergence note's own hosts — PAYLOAD-FREE (slaDivergenceNote reads only
  // boot.slaTargets, already on bootstrap, and the draft), so these are repainted from
  // syncDirty() directly rather than from repaintReadouts()'s `if (!impact) return`-gated body:
  // they must be correct even when the impact payload never arrives.
  let slaDivergenceHosts = {};

  // ONE FAILURE, NOT FOUR. This used to loop over every tab panel and put its own
  // `errorState` in each — four identical red boxes for one fetch that failed once.
  try {
    const settings = await call("api_getSettings", {});
    saved = draftFromSettings(settings);
    draft = draftFromSettings(settings);
  } catch (e) {
    console.error("[settings] api_getSettings failed:", e);
    // The tab strip names sections there is nothing behind yet — hidden along with the panels
    // themselves, rather than left standing over one shared error box.
    tabHost.hidden = true;
    clear(panelHost).append(errorState("Couldn't load settings.", {
      detail: String((e && e.message) || e),
      // A FULL RE-RENDER, not a retry that reuses this closure's `panels`. An earlier draft
      // retried by re-fetching and calling `buildPanels()` in place — but the `clear(panelHost)`
      // above had already DETACHED `panels.register/deadlines/access/system` from the page, so
      // a successful retry populated four now-invisible nodes while the error box stayed on
      // screen, and everything past this catch (dirty tracking, the save bar) never ran because
      // this function had already returned with `saved` left `undefined`. Re-running
      // `renderSettings` from scratch rebuilds fresh panels attached to a fresh `panelHost`.
      onRetry: () => { clear(host); renderSettings(host, params, ctx); },
    }));
    return;
  }

  // THE SLA CUTLINE'S RANGE INPUTS ARE BUILT EXACTLY ONCE HERE, before the first buildPanels()
  // call — never inside buildDeadlinesPanel() or repaintReadouts(), which both run repeatedly
  // (on every edit, and again on Discard). See createSlaCutlineReadout()'s own header: replacing
  // its `<input type="range">` mid-drag silently aborts the drag, so buildDeadlinesPanel() below
  // only ever re-embeds these same instances, and repaintReadouts() only ever calls `.update()`
  // on them.
  const slaCutlines = {};
  for (const row of slaFieldRows(draft.slaTargets, severityOrder)) {
    slaCutlines[row.sev] = createSlaCutlineReadout({ sev: row.sev });
  }

  buildPanels();

  // ------------------------------------------------------------------------- dirty tracking

  function syncDirty() {
    const changed = changedFields(saved, draft);
    const status = tabStatus(draft, saved, errors, FIELD_TABS);
    for (const t of TABS) {
      tabs.setDirty(t.key, !!(status[t.key] && status[t.key].dirty));
      tabs.setInvalid(t.key, !!(status[t.key] && status[t.key].invalid));
    }
    bar.update(changeCountText(changed), changeSummary(changed));
    // Recomputed on every edit, not only on load — the stranded-rows figure and the cutlines'
    // live breach counts are both draft-derived (this file's own settingsReadouts.js header).
    repaintReadouts();
    // UNGATED, unlike repaintReadouts() above — see slaDivergenceHosts' own comment: this note
    // needs nothing from api_getSettingsImpact and must stay correct even when that call never
    // resolves.
    repaintDivergenceNotes();
  }

  /** The standing "this window differs from the canonical one" note, per severity — see
   *  slaDivergenceNote()'s own header for why it reads boot.slaTargets rather than the saved or
   *  effective override. */
  function repaintDivergenceNotes() {
    for (const row of slaFieldRows(draft.slaTargets, severityOrder)) {
      const host = slaDivergenceHosts[row.sev];
      if (!host) continue;
      const note = slaDivergenceNote(row.days, boot.slaTargets && boot.slaTargets[row.sev]);
      host.textContent = note;
      host.hidden = !note;
    }
  }

  /**
   * Everything this page draws from api_getSettingsImpact — decorative, per this file's own
   * `impact` comment above. Every draft-derived readout here (the severity split, the stranded
   * figure, the SLA cutlines) is recomputed from `draft` on every call; the retention timeline
   * is the one that is closer to payload-derived but still reads `draft.retentionDays`, so it is
   * rebuilt here too rather than once at load.
   */
  function repaintReadouts() {
    if (!impact) return; // decorative — every control above already applied its own edit

    const census = (impact.census && impact.census.byScope) || {};
    const selectable = severityOrder.filter((s) => s !== "UNKNOWN");
    for (const scope of scopeList) {
      const host = severitySplitHosts[scope];
      if (!host) continue;
      clear(host).append(
        severityScopeReadout(scope, census[scope], draft.fetchSeverities[scope], selectable),
      );
    }

    if (strandedHost) {
      const stranded = strandedOpenCount(
        census, scopeList, draft.scopes, draft.fetchSeverities, severityOrder,
      );
      clear(strandedHost).append(strandedRowsReadout(stranded));
    }

    if (retentionHost) {
      clear(retentionHost).append(
        renderRetentionReadout(impact.scans, draft.retentionDays, SCOPE_LABELS),
      );
    }

    const ageHistogramByScope = impact.ageHistogram || {};
    const capDays = Number.isFinite(Number(impact.capDays)) ? Number(impact.capDays) : undefined;
    for (const row of slaFieldRows(draft.slaTargets, severityOrder)) {
      const cutline = slaCutlines[row.sev];
      if (!cutline) continue;
      const bins = scopeList.map((sc) => (ageHistogramByScope[sc] || {})[row.sev]);
      const savedDays = Number(saved.slaTargets[row.sev]);
      cutline.update({
        bins,
        windowDays: row.days,
        savedDays: Number.isFinite(savedDays) ? savedDays : row.days,
        capDays,
        onCut: (v) => {
          draft.slaTargets[row.sev] = v;
          const input = slaInputs[row.sev];
          if (input) input.value = String(v);
          syncDirty();
        },
      });
    }
  }

  async function loadImpact() {
    try {
      impact = await call("api_getSettingsImpact", {});
    } catch (e) {
      console.warn("[settings] impact unavailable:", e);
      impact = null;
    }
    repaintReadouts();
  }

  // THE CANONICAL SHAPE IS gas's (pages/settings.js, ~line 1000): validate -> toast + jump on
  // refusal -> the warnings loop -> setBusy(true) -> send -> re-baseline -> syncDirty() -> toast
  // the reconciliation. Only the send itself differs — this app PUTs the whole draft to
  // api_putSettings, gas sends a patch built from settingsPatch(saved, draft) — everything
  // around it is the same sequence for the same reasons.
  async function doSave() {
    // FIRST GATE: a field currently failing its OWN input's validity check (see `errors` above)
    // never reaches `draft` at all — an in-progress "12" being typed over as "-3" leaves
    // `draft.slaTargets` holding the last LEGAL value, so validateDraft below would see nothing
    // wrong. `errors` is the only place that in-progress failure is recorded, so it is consulted
    // first, before the committed draft is judged at all.
    const invalidKeys = Object.keys(errors);
    if (invalidKeys.length) {
      toast("Fix the highlighted field(s) before saving.", "warn");
      const invalidTab = invalidKeys.map((k) => FIELD_TABS[k]).find(Boolean);
      if (invalidTab) tabs.select(invalidTab);
      return;
    }
    // SECOND GATE: the committed draft itself, against settingsModel.js's own rules — an empty
    // register list, or a non-positive SLA target that arrived already-invalid from the server
    // (draftFromSettings never rejects what api_getSettings hands it) and was never retyped.
    const v = validateDraft(draft);
    if (!v.ok) {
      toast(v.message, "warn");
      tabs.select(v.tab);
      return;
    }
    // Legal, and almost always a mistake — dropping a register FREEZES its open findings,
    // narrowing a severity gate strands ledger rows that can never resolve by absence, and a
    // changed SLA window diverges from the other three sidekicks (see settingsModel.js's own
    // header). `ctx` is what draftWarnings needs and this closure already has: `scopeList`/
    // `severityOrder` are this page's own bootstrap-or-fallback reads (above), `SCOPE_LABELS` is
    // this page's own literal (byte-equal to the domain layer, pinned by
    // test/pagesSettings.test.js), and `boot.slaTargets` is api_bootstrap's own SLA_TARGETS —
    // the shared, byte-identical value every sidekick ships, not this draft's own slaTargets.
    const warnings = draftWarnings(saved, draft, {
      scopes: scopeList,
      severityOrder,
      scopeLabels: SCOPE_LABELS,
      sharedSlaTargets: boot.slaTargets,
    });
    for (const w of warnings) {
      const ok = await confirmDialog({
        title: w.title, body: w.body, confirmLabel: w.confirmLabel, danger: true,
      });
      if (!ok) return;
    }
    bar.setBusy(true);
    try {
      const sent = draft;
      const result = await call("api_putSettings", { settings: sent });
      // RE-BASELINE FROM THE SERVER'S OWN RESPONSE, not from `sent` — `cleanSettings` may have
      // clamped retentionDays or fallen back syncSchedule, and `saved` has to reflect what is
      // actually stored, not what was asked for. `draft` is left as-is on purpose: if the server
      // rewrote a value, `saved` and `draft` now disagree on THAT field and syncDirty() below
      // reports it as still unsaved, which is the honest state — the toast right after names the
      // rewrite, this is what makes it visible in the tablist and the save bar too.
      saved = draftFromSettings(result);
      syncDirty();
      const notes = saveReconciliation(sent, result);
      toast(notes.length ? notes.join(" ") : "Settings saved.");
      ctx && ctx.refresh && ctx.refresh();
    } catch (e) {
      toast(`Couldn't save settings: ${(e && e.message) || e}`, "error");
    } finally {
      // ALWAYS, success or failure — the bug this replaces left a successful save with a
      // permanently disabled "Saving…" button sitting above a stale "N unsaved changes" bar.
      bar.setBusy(false);
    }
  }

  function doDiscard() {
    draft = draftFromSettings(saved);
    errors = {};
    buildPanels();
  }

  // ------------------------------------------------------------------------------ builders

  function buildPanels() {
    buildRegisterPanel();
    buildDeadlinesPanel();
    buildAccessPanel();
    buildSystemPanel();
    syncDirty();
  }

  function buildRegisterPanel() {
    // THE MOST VALUABLE READOUT ON THIS PAGE — see settingsReadouts.js's own header: two
    // paragraphs of confirm-dialog prose (settingsModel.js's draftWarnings), turned into a
    // figure that moves live as the scopes/severities below are edited. Sits above the
    // per-scope blocks because it reads across all of them at once.
    strandedHost = el("div", {});
    severitySplitHosts = {};
    const scopesPanel = settingsPanel({
      title: "Registers & severities",
      description: "Which registers a sync collects, and which severities it requests, per register.",
      body: [strandedHost, ...scopeList.map((scope) => registerScopeBlock(scope))],
    });
    const projectPanel = settingsPanel({
      title: "Wiz project scope (what a sync collects)",
      body: [
        el("p", { class: "small muted" },
          "Set by an operator as the WIZ_PROJECT_ID_V2 script property, outside this settings "
          + "tab."),
        disclosure(
          "What this scope decides",
          el("p", {},
            "This decides what a sync COLLECTS from Wiz, not which project the pages SHOW of "
            + "what is already collected — that is a separate, page-level scope set elsewhere "
            + "in the app. This page does not offer to edit either one, and the current fetch "
            + "value is not part of what it is given to draw with."),
        ),
      ],
    });
    clear(panels.register).append(scopesPanel, projectPanel);
  }

  function registerScopeBlock(scope) {
    const id = `settings-scope-${scope}`;
    const labelNode = SCOPE_TERMS[scope]
      ? tipLabel(SCOPE_LABELS[scope] || scope, { term: SCOPE_TERMS[scope] })
      : (SCOPE_LABELS[scope] || scope);

    const checkbox = el("input", {
      type: "checkbox", id,
      checked: draft.scopes.includes(scope) ? true : null,
      onchange: (ev) => {
        const on = ev.target.checked;
        const set = new Set(draft.scopes);
        if (on) set.add(scope); else set.delete(scope);
        draft.scopes = [...set];
        syncDirty();
      },
    });
    const collectRow = settingRow({
      label: labelNode, htmlFor: id,
      description: "Included when a sync runs.",
      control: checkbox,
    });

    const view = registerFieldView(scope, draft.fetchSeverities[scope]);
    const displayEl = el("span", { class: "small" }, view.displayText);
    const pills = togglePills({
      options: severityOrder.filter((s) => s !== "UNKNOWN"),
      selected: draft.fetchSeverities[scope],
      ariaLabel: `${view.label} severities requested`,
      onToggle: (sev) => {
        const set = new Set(draft.fetchSeverities[scope]);
        if (set.has(sev)) set.delete(sev); else set.add(sev);
        draft.fetchSeverities[scope] = [...set];
        displayEl.textContent = registerFieldView(scope, draft.fetchSeverities[scope]).displayText;
        syncDirty();
      },
    });
    // SECRETS GETS THE LEDE ON THE ROW AND THE REST BEHIND A DISCLOSURE; the other two scopes'
    // note (`SCOPE_ALL_NOTE`, 9 words) is already the whole thing there is to say and stays a
    // plain row description. `view.note` itself is untouched (still the full sentence,
    // test/pagesSettings.test.js reads "detection" off it directly) — only the DOM below
    // splits it, and only for the one scope whose note is 50 words rather than 9.
    const severitiesRow = settingRow({
      label: "Severities requested",
      description: scope === "secrets" ? SECRETS_SEVERITY_LEDE : view.note,
      control: el("div", { class: "settings-severity-row" }, pills, displayEl),
    });
    const severityDisclosure = scope === "secrets"
      ? disclosure("Why severity is not a gate for secrets", el("p", {}, SECRETS_SEVERITY_DETAIL))
      : null;

    // The live severity-scope split — a segment per requested severity plus "Not requested",
    // over the OPEN population. registerFieldView() above already renders `[]` as "All
    // severities"; severityScopeReadout() (settingsReadouts.js) must read the identical `[]`
    // the same way, or this bar would contradict the words right above it.
    const splitHost = el("div", {});
    severitySplitHosts[scope] = splitHost;

    return el(
      "div", { class: "settings-scope-block" },
      collectRow, severitiesRow, severityDisclosure, splitHost,
    );
  }

  function buildDeadlinesPanel() {
    const rows = slaFieldRows(draft.slaTargets, severityOrder);
    // One "slaTargets" error for the whole field (it is one SETTINGS_KEYS entry, an object
    // keyed by severity), tracked across however many per-severity rows are invalid right now.
    const invalidSevs = new Set();
    slaInputs = {};
    slaDivergenceHosts = {};
    const body = rows.map((r) => {
      const id = `settings-sla-${r.sev}`;
      const errorId = `${id}-error`;
      const errorEl = el(
        "span", { id: errorId, class: "small settings-field-error", role: "alert", hidden: true },
      );
      const input = el("input", {
        type: "number", id, min: "1", step: "1", value: String(r.days), "aria-describedby": errorId,
        oninput: (ev) => {
          const n = Number(ev.target.value);
          const ok = Number.isFinite(n) && n > 0;
          if (ok) {
            draft.slaTargets[r.sev] = Math.floor(n);
            invalidSevs.delete(r.sev);
          } else {
            invalidSevs.add(r.sev);
          }
          input.setAttribute("aria-invalid", ok ? "false" : "true");
          errorEl.hidden = ok;
          errorEl.textContent = ok ? "" : "Enter a positive whole number of days.";
          setFieldError("slaTargets", invalidSevs.size ? `${invalidSevs.size} remediation window(s) are not a positive number of days.` : null);
          syncDirty();
        },
      });
      slaInputs[r.sev] = input;
      const row = settingRow({
        label: `${r.sev} target`, htmlFor: id,
        description: "Days to remediate. In SLA means resolved on or before this many days.",
        control: el("div", {}, input, errorEl),
      });
      // THE STANDING DIVERGENCE NOTE — payload-free, so it is correct even before/without
      // api_getSettingsImpact; see slaDivergenceHosts' own comment on why it is repainted from
      // syncDirty() directly rather than from the impact-gated repaintReadouts(). Warn-toned,
      // not error-toned, no `role="alert"` — a diverged window is legal (draftWarnings only
      // confirms on save, it never refuses), the same "worth flagging, not wrong" register the
      // retention floor's own warn span already uses just below.
      const divergenceEl = el("p", { class: "small settings-retention-warn", hidden: true });
      slaDivergenceHosts[r.sev] = divergenceEl;
      // THE HEADLINE READOUT — see settingsReadouts.js's own header. Built once, before the
      // first buildPanels() call, and only ever re-embedded here; buildDeadlinesPanel() never
      // constructs a new cutline instance itself.
      const cutline = slaCutlines[r.sev];
      return el("div", {}, row, divergenceEl, cutline ? cutline.node : null);
    });

    // ---- who the remediation-speed figures are measured over, under the windows they are
    // measured against.
    //
    // HERE AND NOT BESIDE ITS TWIN AT THE BOTTOM OF THE PANEL, deliberately. The two switches
    // read almost identically and reach completely different families, so the thing that keeps
    // them apart is not their wording — it is that each one sits with the figures it governs.
    // This one closes the SLA block, whose windows these figures are measured against; the
    // cold-zone one closes the cold-zone block. Stacked together they would read as one
    // decision with two checkboxes.
    const mttrEolSwitch = switchToggle({
      checked: draft.excludeEndOfLifeFromMttr,
      id: "settings-exclude-eol-mttr",
      ariaLabel: "Exclude end-of-life repositories from the remediation-speed figures",
      onChange: (on) => { draft.excludeEndOfLifeFromMttr = on; syncDirty(); },
    });
    body.push(settingRow({
      // THE LABEL NAMES THE FAMILY, because the two switches are otherwise the same words
      // twice on one tab. Their descriptions differ and their positions differ, but a reader
      // scanning bold labels down the panel would see "End-of-life repositories" twice and
      // have no idea which one they were about to flip. The parenthetical is the disambiguator
      // that survives that scan; the glossary term stays on the leading phrase.
      label: glossaryTip("End-of-life repositories (remediation speed)", "end-of-life"),
      htmlFor: "settings-exclude-eol-mttr",
      description: "Leave repositories the tenant has retired out of the half-life, the SLA "
        + "attainment and the open-age distribution. A finished repository distorts them from "
        + "both ends: its closes are archival rather than work, and its open findings will "
        + "never be fixed, so they age inside the backlog forever. Their findings stay in "
        + "every count of what is open. Read off each repository's lifecycle tag — if System "
        + "reports no lifecycles placed, this excludes nothing.",
      control: mttrEolSwitch.node,
    }));

    // ---- the cold zone, AFTER the per-severity rows and inside the same panel.
    //
    // Same tab, not the same kind of deadline: the rows above promise a window for ONE
    // finding, these set how long a whole repository may go with nothing closing before the
    // Repositories page calls it cold. They are last because they are the coarser reading, and
    // here rather than on System because they are deadlines a reader sets, not a maintenance
    // knob.
    //
    // A MODE AND ITS OWN NUMBERS, SHOWN AND HIDDEN RATHER THAN DISABLED. Fixed mode reads one
    // number (the window) and relative mode reads two (the target share and the floor), and
    // the ones the current mode does not read are not merely inert — they are not what the
    // register is measuring at all. A disabled control still says "this is part of the answer,
    // you just may not touch it", which would be a lie in whichever mode is off; a control
    // that is absent says the truth, that this reading has no such number. The draft still
    // carries all three either way, so flipping back and forth never loses a value.
    //
    // Two labels route to the glossary, like the panel's own title routes to `sla-target`:
    // the mode to `cold-zone-mode` and the window to `cold-zone`. A window is a setting whose
    // NAME is a measurement decision, and the entries are where those decisions are written
    // (movement is resolved/removed/rotated, measured at the last scan; the mode entry says
    // what "relative" ranks and against what). The two relative-mode NUMBERS take plain-text
    // labels: they are parameters OF the mode, and the entry that explains them is the one
    // its own label already points at.
    const modeView = coldModeFieldView(draft.coldZoneMode);

    body.push(settingRow({
      label: glossaryTip("Cold-zone mode", "cold-zone-mode"),
      description: "Fixed window calls a repository cold after a set number of idle days. "
        + "Relative draws the line wherever the idlest share of the estate begins, so a chosen "
        + "share of the repositories with open findings is cold whatever the idle times are.",
      control: segmented({
        options: modeView.options,
        value: modeView.value,
        ariaLabel: "Cold-zone mode",
        onChange: (v) => {
          draft.coldZoneMode = v;
          // A field that has just left the screen cannot be corrected, so its in-progress
          // error must not keep doSave()'s first gate closed from behind a control nobody can
          // see. The draft itself is always legal here — an oninput below only ever writes a
          // value it could parse — so the rebuilt inputs come back valid.
          if (v === "relative") {
            setFieldError("coldAfterDays", null);
          } else {
            setFieldError("coldTargetSharePct", null);
            setFieldError("coldFloorDays", null);
          }
          // REBUILD, THEN syncDirty() — the same order buildPanels() uses. syncDirty()
          // repaints live readouts into whichever hosts are attached right now, so painting
          // before the rebuild would write into nodes this call is about to throw away.
          buildDeadlinesPanel();
          syncDirty();
        },
      }),
    }));

    if (!modeView.isRelative) {
      const coldId = "settings-cold-after-days";
      const coldErrorId = `${coldId}-error`;
      const coldWarn = el("span", { class: "small settings-retention-warn", hidden: true });
      const coldError = el(
        "span", { id: coldErrorId, class: "small settings-field-error", role: "alert", hidden: true },
        "Enter a number of days.",
      );
      const coldInput = el("input", {
        type: "number", id: coldId, min: String(COLD_WINDOW_MIN_DAYS), max: String(COLD_WINDOW_MAX_DAYS),
        step: "1", value: String(draft.coldAfterDays), "aria-describedby": coldErrorId,
        oninput: (ev) => {
          const raw = ev.target.value;
          // The same "Number('') is 0, and 0 is finite" trap the two System handlers guard: a
          // blank field is NO INPUT, never "cold immediately", so it is refused before the cast.
          const blank = raw.trim() === "";
          const n = Number(raw);
          const ok = !blank && Number.isFinite(n);
          // Out-of-range-but-real is a WARN, not an error — the server clamps it into the range
          // on save, exactly as a below-floor retention window is clamped up. Only a value that
          // does not parse as a number at all is invalid.
          if (ok) {
            draft.coldAfterDays = Math.floor(n);
            const v = coldWindowFieldView(draft.coldAfterDays);
            coldWarn.hidden = !v.outOfRange;
            coldWarn.textContent = v.outOfRange
              ? `Outside the ${v.floor}–${v.ceiling}-day range — saving will store ${v.displayValue}.`
              : "";
          }
          coldInput.setAttribute("aria-invalid", ok ? "false" : "true");
          coldError.hidden = ok;
          setFieldError("coldAfterDays", ok ? null : "The cold-zone window must be a number.");
          syncDirty();
        },
      });
      body.push(settingRow({
        label: glossaryTip("Cold-zone window", "cold-zone"), htmlFor: coldId,
        description: "Days a repository may sit with open findings and no remediation movement "
          + "before it is called cold. Movement is any finding resolved, removed or rotated.",
        control: el("div", {}, coldInput, coldWarn, coldError),
      }));
    } else {
      // The two relative-mode numbers. Both oninput handlers are the cold-window handler above
      // with the field name changed, deliberately rather than by a shared helper: each one
      // names its own draft field, its own view and its own error sentence, and the three
      // differ in exactly those words.
      const targetId = "settings-cold-target-share";
      const targetErrorId = `${targetId}-error`;
      const targetWarn = el("span", { class: "small settings-retention-warn", hidden: true });
      const targetError = el(
        "span", { id: targetErrorId, class: "small settings-field-error", role: "alert", hidden: true },
        "Enter a percentage.",
      );
      const targetInput = el("input", {
        type: "number", id: targetId, min: String(COLD_TARGET_MIN_PCT), max: String(COLD_TARGET_MAX_PCT),
        step: "1", value: String(draft.coldTargetSharePct), "aria-describedby": targetErrorId,
        oninput: (ev) => {
          const raw = ev.target.value;
          const blank = raw.trim() === "";
          const n = Number(raw);
          const ok = !blank && Number.isFinite(n);
          if (ok) {
            draft.coldTargetSharePct = Math.floor(n);
            const v = coldTargetFieldView(draft.coldTargetSharePct);
            targetWarn.hidden = !v.outOfRange;
            targetWarn.textContent = v.outOfRange
              ? `Outside the ${v.floor}–${v.ceiling}% range — saving will store ${v.displayValue}.`
              : "";
          }
          targetInput.setAttribute("aria-invalid", ok ? "false" : "true");
          targetError.hidden = ok;
          setFieldError("coldTargetSharePct", ok ? null : "The cold-zone target share must be a number.");
          syncDirty();
        },
      });
      // THE DENOMINATOR, AND IT IS NOT DECORATION. This field is a RATE — a share of something
      // — and on every other page in this app a rate travels with the population it is a share
      // OF (`denomNote`, swept by test/pagesLit.test.js's exit gate 3/7). A target share is no
      // exception just because the reader types it rather than reading it: "20%" means nothing
      // until the estate it counts against is named, and the population here is a NARROW one
      // that the profile decides before any line is drawn — a repository the scanner stopped
      // returning is not evidence about engagement, and one with nothing open cannot be in a
      // zone that measures unclosed work. Saying so here is what stops an operator reading
      // "20%" as a fifth of every repository they own.
      body.push(el("div", {},
        settingRow({
          label: "Cold-zone target share", htmlFor: targetId,
          description: "The share of the eligible repositories the line aims to put in the "
            + "cold zone, in %. The idlest ones go first, and ties at the line are all cold, "
            + "so the share actually reached can come out larger.",
          control: el("div", {}, targetInput, targetWarn, targetError),
        }),
        denomNote(
          "A share of the repositories the scanner still returns that have at least one open "
          + "finding; unobserved and clear repositories are not in it. The Repositories page "
          + "reports the share actually reached against this target.",
        ),
      ));

      const floorId = "settings-cold-floor-days";
      const floorErrorId = `${floorId}-error`;
      const floorWarn = el("span", { class: "small settings-retention-warn", hidden: true });
      const floorError = el(
        "span", { id: floorErrorId, class: "small settings-field-error", role: "alert", hidden: true },
        "Enter a number of days.",
      );
      const floorInput = el("input", {
        type: "number", id: floorId, min: String(COLD_FLOOR_MIN_DAYS), max: String(COLD_FLOOR_MAX_DAYS),
        step: "1", value: String(draft.coldFloorDays), "aria-describedby": floorErrorId,
        oninput: (ev) => {
          const raw = ev.target.value;
          const blank = raw.trim() === "";
          const n = Number(raw);
          const ok = !blank && Number.isFinite(n);
          if (ok) {
            draft.coldFloorDays = Math.floor(n);
            const v = coldFloorFieldView(draft.coldFloorDays);
            floorWarn.hidden = !v.outOfRange;
            floorWarn.textContent = v.outOfRange
              ? `Outside the ${v.floor}–${v.ceiling}-day range — saving will store ${v.displayValue}.`
              : "";
          }
          floorInput.setAttribute("aria-invalid", ok ? "false" : "true");
          floorError.hidden = ok;
          setFieldError("coldFloorDays", ok ? null : "The cold-zone floor must be a number.");
          syncDirty();
        },
      });
      body.push(settingRow({
        label: "Cold-zone floor", htmlFor: floorId,
        description: "The fewest idle days the derived line may ever sit at. A share always "
          + "names somebody, and on an estate where nothing has been quiet for long, this is "
          + "what stops the zone being filled anyway.",
        control: el("div", {}, floorInput, floorWarn, floorError),
      }));
    }

    // ---- who the cold zone measures, under where its line falls.
    //
    // LAST IN THE PANEL AND OUTSIDE THE MODE BRANCH, because it is the only cold-zone control
    // both readings share: fixed and relative disagree about where the line goes and agree
    // completely about whether a repository the tenant retired should be behind it.
    //
    // A SWITCH, NOT A THRESHOLD, so it takes `switchToggle` and the System tab's phrasing
    // rather than a number input — and the description carries the one caveat that decides
    // whether it does anything at all: the exclusion reads a repository TAG, so a deployment
    // whose tag key this register never learned excludes nothing. Settings > System's
    // repository-tag card is where that is diagnosable, and the sentence points at it rather
    // than leaving an operator to conclude the switch is broken.
    const eolSwitch = switchToggle({
      checked: draft.excludeEndOfLifeFromColdZone,
      id: "settings-exclude-eol",
      ariaLabel: "Exclude end-of-life repositories",
      onChange: (on) => { draft.excludeEndOfLifeFromColdZone = on; syncDirty(); },
    });
    body.push(settingRow({
      label: glossaryTip("End-of-life repositories (cold zone)", "end-of-life"),
      htmlFor: "settings-exclude-eol",
      description: "Leave repositories the tenant has retired out of the cold zone. Nobody is "
        + "closing findings on a finished repository because nobody is meant to, so counting "
        + "them as cold crowds out the ones that really have gone quiet. This reaches the cold "
        + "zone only — the remediation-speed switch above is separate. Read off each "
        + "repository's lifecycle tag — if System reports no lifecycles placed, this excludes "
        + "nothing.",
      control: eolSwitch.node,
    }));

    const panel = settingsPanel({
      title: glossaryTip("Remediation windows", "sla-target"),
      description: "The same window applies to every register: a CRITICAL finding gets the "
        + "same clock whether it is a host CVE, a dependency CVE or a hardcoded secret.",
      body,
    });
    clear(panels.deadlines).append(panel);
  }

  function buildAccessPanel() {
    const v = accessFieldView(boot.canEditAccess);
    const pill = statusPill(v.canEditAccess ? "ok" : "neutral", v.canEditAccess ? "Can manage access" : "View only");
    const body = [
      settingRow({ label: "Your access", control: pill }),
      ...v.tiers.map((t) => settingRow({ label: t.tier, control: el("span", { class: "small muted" }, t.note) })),
      el("p", { class: "small muted" }, v.failsClosedNote),
    ];
    if (v.manageHint) body.push(el("p", { class: "small muted" }, v.manageHint));
    const panel = settingsPanel({
      title: "Access",
      description: "Two tiers: the owner appoints admins, and admins maintain the user list.",
      body,
    });
    clear(panels.access).append(panel);
  }

  /**
   * The credential row's SECOND fact: not "present" (three non-empty Script Properties, which
   * the shared `diagnosticsPanel` credentials card already draws above this one) but whether
   * the tenant has ever actually ANSWERED with them. A green "Connected" pill on `present`
   * alone invites the stronger reading with nothing beside it to correct that — this card is
   * the correction, not a duplicate.
   *
   * The verification is a real token exchange plus one page of one row
   * (`api_testWizConnection` -> `wizClient.testConnection`), and it drops the cached token
   * first: a cached one outlives a revoked client secret by up to six hours, so a test that
   * accepted it would keep reporting success after the credentials had already stopped
   * working.
   */
  function connectionCard() {
    // `.settings-inline`, not `.health-row`: the notAuthorized state's four-step remedy list
    // is `.settings-remedy`, which drops to its own full-width line via `flex-basis: 100%` —
    // that only works inside a `flex-wrap: wrap` parent, which `.health-row` (the generic
    // one-line diagnostic body) deliberately is not.
    const wrap = el("div", { class: "settings-inline" });
    const paint = (state) => {
      clear(wrap);
      if (!boot.hasCredentials) {
        wrap.append(statusPill("neutral", "Not set — nothing to test"));
        return;
      }
      if (state && state.ok) {
        wrap.append(statusPill("ok", `Verified ${fmtDateTime(state.at)}`));
      } else if (state && state.notAuthorized) {
        // A DIFFERENT FAILURE WITH A DIFFERENT REMEDY, and it is not about Wiz at all: Apps
        // Script refused the outbound call before one was made. The platform's own sentence
        // names a scope URL and nothing a reader can act on — print the steps instead.
        wrap.append(
          statusPill("bad", "Not authorized"),
          el("span", { class: "muted small" },
            "This deployment may not make outbound requests, so it cannot reach Wiz. "
            + "The credentials are not the problem."),
          el("ol", { class: "settings-remedy" },
            el("li", {}, "Push the current build. Its appsscript.json declares "
              + "script.external_request, and a manifest change is what makes Apps Script "
              + "ask for consent — inference alone did not."),
            el("li", {}, "In the Apps Script editor, run wizDiagnostic() and ACCEPT the "
              + "prompt. Read the Execution log: it names which step fails."),
            el("li", {}, "Deploy → Manage deployments → Edit → New version. "
              + "Pushing code does not change what the web app URL serves."),
            el("li", {}, "Check the daily sync trigger still fires: a scope change can "
              + "suspend an installable trigger silently.")),
        );
      } else if (state && state.error) {
        wrap.append(statusPill("bad", "Refused"), el("span", { class: "muted small" }, state.error));
      } else if (boot.wizVerifiedAt) {
        wrap.append(statusPill("ok", `Last verified ${fmtDateTime(boot.wizVerifiedAt)}`));
      } else {
        // Stored, never exercised. Neutral rather than green: nothing is wrong, and nothing
        // has been confirmed either.
        wrap.append(statusPill("neutral", "Stored, never verified"));
      }
      const btn = el("button", {
        class: "linklike",
        disabled: !boot.hasCredentials || (state && state.pending) ? true : null,
        onclick: async () => {
          btn.disabled = true;
          paint({ pending: true });
          try {
            const res = await call("api_testWizConnection", {});
            paint({ ok: true, at: res.at });
            toast(res.rows === null
              ? "The tenant answered."
              : `The tenant answered — ${fmtCount(res.rows)} finding(s) in scope.`);
            // The stored timestamp moved, so the next reader of this page sees it too.
            invalidateBootstrap();
          } catch (e) {
            // `errorKind` is set server-side; the message is the platform's and may be in any
            // language, so the branch must not key on reading it.
            if (e.kind === "not-authorized") paint({ notAuthorized: true });
            else paint({ error: String(e.message || e).slice(0, 200) });
          }
        },
      }, "Test connection");
      wrap.append(btn);
    };
    paint(null);
    return wrap;
  }

  /**
   * The repository → tags join, and whether it is actually joining.
   *
   * TWO TAGS, ONE MAP, TWO PLACEMENT FIGURES. The register joins a business domain
   * (`Wiz/Domain`) and a lifecycle (`lifecycle`) off the same repository entities in one
   * refresh, and this card reports each one's reach SEPARATELY, because they fail separately:
   * the domain key is one Wiz's own console writes, while the lifecycle key is whatever the
   * tenant's own catalogue used, so a perfectly healthy domain half can sit beside a lifecycle
   * half that matches nothing. A single collapsed "placed" would hide exactly that, and the
   * Lifecycle column would just be quietly blank everywhere with nothing on screen saying why.
   *
   * WHY THIS CARD EXISTS AT ALL. The domain scope in the app header and the "By business
   * domain" breakdowns are drawn from a map this register fetches SEPARATELY from any sync —
   * the three finding documents cannot select an asset's tags, so the tag comes from its own
   * graphSearch over repository entities (src/domain/domainTag.ts records why). That makes the
   * map a thing that can be silently absent, and an absent map and an untagged tenant look
   * identical from every other screen: no domain rows in the switcher, `(none)` everywhere in
   * the breakdown. This is the one place those two are told apart.
   *
   * THREE STATES, AND THE THIRD IS THE ONE WORTH DRAWING A CARD FOR:
   *
   *   zero keys                   never refreshed — press the button
   *   keys, but places nothing    fetched, and the map reaches none of this register's repos
   *   keys, and places some       working; the switcher should be offering these domains
   *
   * THE MIDDLE ONE IS WHY THIS CARD REPORTS `placed` RATHER THAN A KEY COUNT. A map can hold
   * thousands of tokens and three domains and still place zero findings, because the identity
   * a repository ENTITY carries in Wiz's graph need not be the one a FINDING carries — nothing
   * in the tree can verify that overlap without the tenant (`repoTags.recordIdentityTokens`
   * says so at length). Reported as keys alone, that state reads as perfect health while every
   * domain figure in the app is empty, which is exactly the confident lie this card exists to
   * prevent.
   *
   * When it happens, the card prints BOTH SIDES OF THE MISMATCH — what the map is keyed on,
   * and what this register calls its repositories. That is the one thing that turns "the
   * domains do not appear" into something an operator can act on or report, and it is why the
   * samples are on screen rather than in an execution log nobody opens.
   *
   * The tag key is printed in every state, because a map that found nothing and a map built
   * against the wrong `WIZ_DOMAIN_TAG_KEY` are the same picture with different causes, and the
   * key is the fact that separates them.
   */
  function domainMapCard() {
    const wrap = el("div", { class: "settings-inline" });
    const paint = (state) => {
      clear(wrap);
      if (state && state.pending) {
        wrap.append(statusPill("neutral", "Refreshing…"));
        return;
      }
      if (state && state.error) {
        wrap.append(statusPill("bad", "Refresh failed"),
          el("span", { class: "muted small" }, state.error));
      } else if (state && state.health) {
        const h = state.health;
        const keys = Number(h.keys) || 0;
        const domains = Number(h.domains) || 0;
        const repos = Number(h.repos) || 0;
        const placed = Number(h.placed) || 0;
        if (!keys) {
          // NEUTRAL, NOT BAD. Nothing is broken — the map has simply never been fetched, which
          // is every deployment's state until someone presses the button once.
          wrap.append(statusPill("neutral", "Never refreshed"));
        } else if (!domains) {
          wrap.append(statusPill("bad", "No domains found"));
        } else if (!placed) {
          // THE STATE THE KEY COUNT USED TO HIDE. The fetch worked and the map is real; it
          // simply does not reach anything this register holds.
          wrap.append(
            statusPill("bad", `${fmtCount(domains)} domain(s), matching none of your repositories`),
            el("span", { class: "muted small" },
              "The map was fetched, but the identities Wiz reports on the tagged repositories "
              + "do not match the ones this register's findings carry, so no finding can be "
              + "placed in a domain. The two lists below are that mismatch."),
            el("div", { class: "settings-remedy" },
              el("div", { class: "muted small" },
                `Map is keyed on: ${(h.sampleTokens || []).join(", ") || "—"}`),
              el("div", { class: "muted small" },
                `This register's repositories: ${(h.sampleUnplaced || []).join(", ") || "—"}`)),
          );
        } else {
          wrap.append(statusPill("ok",
            `${fmtCount(domains)} domain(s) over ${fmtCount(placed)} of `
            + `${fmtCount(repos)} repositories`));
        }
        wrap.append(el("span", { class: "muted small" }, `Domain tag key: ${h.tagKey}`));
        // THE SECOND TAG, ON ITS OWN LINE AND WITH ITS OWN PLACEMENT FIGURE. A zero here
        // beside a healthy domain count is the one state the default key is allowed to be in
        // (it is a guess about the tenant's own vocabulary — see domain/lifecycleTag.ts), and
        // it is the state that makes the Lifecycle column and the end-of-life exclusion do
        // nothing. Said here, once, rather than left for someone to deduce from an empty
        // column on another page.
        const lifePlaced = Number(h.lifecyclePlaced) || 0;
        const lifeKey = h.lifecycleTagKey || "lifecycle";
        wrap.append(el("span", { class: "muted small" },
          keys && !lifePlaced
            ? `No repository lifecycle placed — nothing matches the ${lifeKey} tag, so the `
              + "Lifecycle column is empty and the end-of-life exclusion removes nothing."
            : `Lifecycle tag key: ${lifeKey}`
              + (keys ? ` — placed on ${fmtCount(lifePlaced)} of ${fmtCount(repos)} repositories` : "")));
      } else {
        wrap.append(statusPill("neutral", "Not checked"));
      }
      const btn = el("button", {
        class: "linklike",
        disabled: !boot.hasCredentials || (state && state.pending) ? true : null,
        onclick: async () => {
          btn.disabled = true;
          paint({ pending: true });
          try {
            const res = await call("api_refreshDomains", {});
            // Re-read HEALTH rather than painting the refresh stats. `DomainRefresh` says what
            // the fetch SAW (repositories tagged, domains found); only `mapHealth` says whether
            // any of it reaches this register — and that is the whole question this card
            // answers. The toast keeps the fetch's own figures, because "what came back from
            // Wiz" and "what this register can do with it" are two facts and the card would be
            // hiding the first if the toast restated the second.
            const health = await call("api_domainMapHealth", {});
            paint({ health });
            toast(!res.repos
              ? `No repository carries a ${res.tagKey} or ${res.lifecycleTagKey} tag.`
              : health.placed || health.lifecyclePlaced
                ? `${fmtCount(res.repos)} tagged repository(s), ${fmtCount(res.domains)} `
                  + `domain(s), ${fmtCount(res.lifecycles)} lifecycle(s).`
                : `${fmtCount(res.repos)} tagged repository(s) fetched, but none match this `
                  + "register's repositories — see the card.");
            // The map moved, so every domain figure the shell is holding is stale — including
            // the header switcher's own list, which is built from the bootstrap payload.
            invalidateBootstrap();
            if (ctx && ctx.refresh) ctx.refresh();
          } catch (e) {
            paint({ error: String(e.message || e).slice(0, 200) });
          }
        },
      }, "Refresh repository tags");
      wrap.append(btn);
    };
    paint(null);
    // The CURRENT state, fetched without touching Wiz — `api_domainMapHealth` reads the stored
    // map and nothing else, so opening Settings costs no tenant call. Fired after the first
    // paint for `loadImpact`'s reason: the control already works, this only adds a caption.
    call("api_domainMapHealth", {})
      .then((health) => paint({ health }))
      .catch(() => { /* the neutral "Not checked" pill above is already true */ });
    return wrap;
  }

  function buildSystemPanel() {
    const scheduleId = "settings-sync-hour";
    const scheduleErrorId = `${scheduleId}-error`;
    const scheduleError = el(
      "span", { id: scheduleErrorId, class: "small settings-field-error", role: "alert", hidden: true },
      "Enter a whole number of hours.",
    );
    const scheduleInput = el("input", {
      type: "number", id: scheduleId, min: "0", max: "23", step: "1", value: String(draft.syncSchedule),
      "aria-describedby": scheduleErrorId,
      oninput: (ev) => {
        const raw = ev.target.value;
        // Number("") is 0, and 0 is finite (CLAUDE.md: "Number(null) is 0, and it is
        // finite") — a blank field means NO INPUT, not "hour zero", so blank is refused
        // BEFORE the cast rather than read as a valid midnight. A browser number input also
        // blocks non-numeric keystrokes outright, so blank is the only non-numeric shape this
        // handler will ever actually see; the Number.isFinite check below still guards the
        // rest of the domain (Infinity, -Infinity) defensively.
        const blank = raw.trim() === "";
        const n = Number(raw);
        // Out-of-range-but-numeric is tolerated, not an error: the description below already
        // says it falls back to the default on save rather than being rejected. Only a value
        // that fails to parse as a number at all (blank, non-numeric) is invalid — the same
        // split retentionDays draws below, between "not a number" (invalid) and "a number the
        // server will adjust" (a caption, never an error).
        const numeric = !blank && Number.isFinite(n);
        if (numeric && Number.isInteger(n) && n >= 0 && n <= 23) draft.syncSchedule = n;
        scheduleInput.setAttribute("aria-invalid", numeric ? "false" : "true");
        scheduleError.hidden = numeric;
        setFieldError("syncSchedule", numeric ? null : "The sync hour must be a number.");
        syncDirty();
      },
    });
    const scheduleRow = settingRow({
      label: "Daily sync hour", htmlFor: scheduleId,
      description: `Hour of day (0-23), script-local. An out-of-range value falls back to the `
        + `default (${DEFAULT_SYNC_HOUR}:00) on save rather than being rejected.`,
      control: el("div", {}, scheduleInput, scheduleError),
    });
    const scheduleCaveat = disclosure(
      "Why a saved hour might not move the trigger yet",
      el("p", {}, "The installed daily trigger is deduplicated by its name alone, not by this "
        + "value, so changing the hour after first install can leave the trigger firing at the "
        + "old time until that reconciliation ships."),
    );

    const autoCompactSwitch = switchToggle({
      checked: draft.autoCompact,
      id: "settings-auto-compact",
      ariaLabel: "Automatic compaction",
      onChange: (on) => { draft.autoCompact = on; syncDirty(); },
    });
    const autoCompactRow = settingRow({
      label: "Automatic compaction", htmlFor: "settings-auto-compact",
      description: AUTO_COMPACT_OFF_NOTE,
      control: autoCompactSwitch.node,
    });

    const retentionId = "settings-retention-days";
    const retentionErrorId = `${retentionId}-error`;
    const retentionWarn = el("span", { class: "small settings-retention-warn", hidden: true });
    const retentionError = el(
      "span", { id: retentionErrorId, class: "small settings-field-error", role: "alert", hidden: true },
      "Enter a number of days.",
    );
    const retentionInput = el("input", {
      type: "number", id: retentionId, min: String(RETENTION_FLOOR_DAYS), step: "1",
      value: String(draft.retentionDays), "aria-describedby": retentionErrorId,
      oninput: (ev) => {
        const raw = ev.target.value;
        // Same "Number('') is 0, and it is finite" trap as the sync-hour handler above: a
        // blank field is NO INPUT, not "retain nothing", so it is refused before the cast.
        const blank = raw.trim() === "";
        const n = Number(raw);
        const ok = !blank && Number.isFinite(n);
        // A below-floor-but-real number is a WARN, not an error — the server clamps it on
        // save (see retentionFieldView), same as an out-of-range syncSchedule above. Only a
        // value that fails to parse as a number at all is invalid; previously this handler
        // returned early on that case WITHOUT calling syncDirty(), so the save bar and the
        // tablist never learned a keystroke had happened at all.
        if (ok) {
          draft.retentionDays = Math.floor(n);
          const v = retentionFieldView(draft.retentionDays);
          retentionWarn.hidden = !v.belowFloor;
          retentionWarn.textContent = v.belowFloor
            ? `Below the ${v.floor}-day floor — saving will raise it to ${v.floor}.`
            : "";
        }
        retentionInput.setAttribute("aria-invalid", ok ? "false" : "true");
        retentionError.hidden = ok;
        setFieldError("retentionDays", ok ? null : "The retention window must be a number.");
        syncDirty();
      },
    });
    const retentionRow = settingRow({
      label: "Retention window", htmlFor: retentionId,
      description: `Read only while automatic compaction is on. Floored at ${RETENTION_FLOOR_DAYS} days.`,
      control: el("div", {}, retentionInput, retentionWarn, retentionError),
    });

    // ONE LANE, across every register's scan rows — see settingsReadouts.js's own header on
    // why this register draws one retention timeline rather than three.
    retentionHost = el("div", {});

    const maintenancePanel = settingsPanel({
      title: "Maintenance",
      body: [scheduleRow, scheduleCaveat, autoCompactRow, retentionRow, retentionHost],
    });

    // Self-saving, NOT part of the batch above — see the module header.
    const expSwitch = switchToggle({
      checked: showExperimental(),
      id: "settings-show-experimental",
      ariaLabel: "Show experimental content",
      onChange: (on) => {
        setShowExperimental(on);
        toast(on ? "Experimental content shown." : "Experimental content hidden.");
      },
    });
    const expRow = settingRow({
      label: "Show experimental content", htmlFor: "settings-show-experimental",
      description: "Saves immediately, for this browser only. It decides which unfinished "
        + "routes exist in the nav, not anything this register computes.",
      control: expSwitch.node,
    });
    const prefsPanel = settingsPanel({ title: "Preferences", body: [expRow] });

    // The whole sync, not one of its rows — see api.ts's `latestSync`. A run writes one
    // `scans` row per register, and the diagnostic used to name whichever sorted first.
    const scan = boot.latestSync;
    const scanLine = scan
      ? `${fmtDateTime(scan.ts)} · ${fmtCount(Number(scan.total || 0))} finding(s) across `
        + scan.scopes.map((s) => SCOPE_LABELS[s.scope] || s.scope).join(", ")
      : null;

    // The four deployment read-outs, through gas_shared/ui/diagnostics.js. THESE WERE
    // `settingRow`s, which was the one thing wrong with them: the settings-form vocabulary says
    // "this is a field you may edit", and a build id is not. They are read-out cards now, same
    // four facts in the same order under the same single h2.
    //
    // WHAT THIS REGISTER DOES NOT PASS, and does not gain: no storage meter (its cell usage is
    // on the Data page, where `cellsSummary` computes it), and NO ERRORS SECTION — its
    // `api_getRecentErrors` covers job failures only and is rendered on the Data page. Nothing
    // moved between pages here.
    //
    // NO `client` STAMP EITHER, so no client-vs-server mismatch card. This app used to carry
    // the identical `buildInfo.js` module gas_ai uses for that comparison, imported by
    // NOTHING — dead weight rather than a half-wired feature, and deleted with the rest of
    // Wave 2's dead modules. Wiring the comparison back up is still a new deployment claim for
    // this register, not the same claim expressed once, so it stays undone rather than restored.
    const diagnostics = diagnosticsPanel({
      heading: "Deployment",
      product: { value: boot.product },
      build: { server: boot.buildId },
      credentials: {
        label: "Wiz credentials",
        present: boot.hasCredentials,
        okLabel: "Connected",
        missingLabel: "No credentials",
        // BAD, NOT NEUTRAL. gas_ai draws the same boolean `neutral`, because running that
        // workbook against bundled sample data is a legitimate mode; this register has no
        // sample mode on this path and nothing to sync without credentials, so a missing one
        // is a fault. The shared section refuses to default the tone for exactly this reason.
        missingTone: "bad",
      },
      // An absolute timestamp and no relative-age phrase. `figures.relativeAge` does not exist
      // in gas_shared yet, and inventing one here would put a second age vocabulary beside the
      // one that is coming.
      lastSync: { value: scanLine, emptyText: "No sync recorded yet." },
    });
    // A second fact about the SAME row, not a duplicate of it: `present` (above, from the
    // shared card) is three non-empty Script Properties; this one is whether the tenant has
    // ever actually answered them. Appended to the same grid via `diagnosticsPanel`'s returned
    // handle rather than a second `diagnosticsPanel` call, so the two credential facts sit
    // beside each other under the one "Deployment" heading.
    diagnostics.grid.append(diagnosticCard({
      key: "wizConnection", label: "Wiz connection", body: connectionCard(),
    }));
    // Beside the connection rather than on the Register tab: like the two credential facts
    // above it, this is a statement about what the deployment can currently REACH, not a knob
    // a reader sets. It is also the only card here whose button costs a tenant call, which is
    // why it sits next to the other one that does.
    diagnostics.grid.append(diagnosticCard({
      key: "domainMap", label: "Repository tags", body: domainMapCard(),
    }));

    clear(panels.system).append(
      maintenancePanel,
      // `canEditAccess` is this register's own tier flag, already on the bootstrap payload for
      // the Access tab. `refresh` is what makes the header catch up: the hub button is drawn
      // from the bootstrap payload, so without it a reader saves a URL and the control it is
      // FOR does not move until the next navigation.
      hubUrlPanel({
        hubUrl: boot.hubUrl,
        canEdit: !!boot.canEditAccess,
        onSaved: () => { ctx && ctx.refresh && ctx.refresh(); },
      }),
      prefsPanel,
      diagnostics.node,
    );
  }

  // ------------------------------------------------------------------------------ first paint
  // Fetched after the panels already exist, exactly like gas's own loadImpact(): every control
  // above already works off `draft` alone, so this only ever ADDS captions, on its own schedule.
  await loadImpact();
}
