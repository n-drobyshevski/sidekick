// Settings semantics, kept pure so the half that can be wrong is the half vitest can hold.
//
// Phase 1 carries the settings the shell itself needs. The register's collection knobs
// (which scopes to sync, which severities to request) are declared here rather than in
// Phase 2 because the Settings page reads them today, and a page that offers a control
// with nothing behind it is the thing this product does not do.

import {
  COLD_AFTER_DAYS_MAX, COLD_AFTER_DAYS_MIN, COLD_FLOOR_DAYS_MAX, COLD_FLOOR_DAYS_MIN,
  COLD_TARGET_SHARE_PCT_MAX, COLD_TARGET_SHARE_PCT_MIN, COLD_ZONE_MODES, DEFAULT_COLD_AFTER_DAYS,
  DEFAULT_COLD_FLOOR_DAYS, DEFAULT_COLD_TARGET_SHARE_PCT, DEFAULT_COLD_ZONE_MODE,
  DEFAULT_FETCH_SEVERITIES, DEFAULT_RETENTION_DAYS, SCOPES, SEVERITY_ORDER, SLA_TARGETS,
  type ColdZoneMode, type Scope,
} from "./config";
import { RETENTION_MIN_DAYS } from "./maintenance";
import type { Rec } from "./util";

/**
 * Default hour-of-day (0-23, script-local — Europe/Paris per the manifest) the daily sync
 * trigger is requested to fire at. `server/setup.ts` imports this rather than hardcoding its
 * own literal, so the installed trigger and this field's default can never drift apart even
 * though (see `syncSchedule` below) setup() does not read the field yet.
 */
export const DEFAULT_SYNC_HOUR = 5;

/**
 * TWO PROJECT SCOPES, TWO HOMES — DO NOT MERGE THEM.
 *
 * FETCH scope decides what a sync COLLECTS from Wiz. It is `WIZ_PROJECT_ID_V2`, an operator
 * Script Property (`props.projectScope`) already folded into `serverCache.configStamp` so
 * that changing it invalidates every derived read model. It stays a Script Property and MUST
 * NOT be added here: putting a `wizProjectId` field on `Settings` would give that one value
 * two homes, and the failure that produces is not a conflict anyone sees — it is a cache
 * stamped from one home while the query is built from the other, which reads as a register
 * that will not refresh. That argument is unchanged and still governs the fetch scope.
 *
 * VIEW scope decides what the pages SHOW of whatever the ledger already holds — it never
 * touches `configStamp` and never changes what a sync requests. That is `projectView` below,
 * and it belongs on `Settings` for the opposite reason `wizProjectId` does not: it is a
 * display filter read by page renderers, not a fetch parameter folded into a cache stamp, so
 * there is only one home for it to have and this is that home.
 */
export interface Settings {
  /** Which registers the sync battery collects. At least one, always. */
  scopes: Scope[];
  /**
   * Which severities to request from the API, PER SCOPE. Empty means all.
   *
   * Per-scope rather than one list, for the same reason the defaults are: an operator
   * narrowing SCA to CRITICAL/HIGH must not silently delete every PASSWORD and CERTIFICATE
   * from the secrets register, which is what a shared list does.
   */
  fetchSeverities: Record<Scope, string[]>;
  /** Remediation windows, in days, by severity. */
  slaTargets: Record<string, number>;
  /**
   * How long a repository may sit with open findings and no remediation movement before the
   * cold zone calls it cold, in days.
   *
   * ON THE DEADLINES TAB BESIDE THE SLA WINDOWS, AND IT IS NOT ONE OF THEM. An SLA window is a
   * promise about a single finding ("this CRITICAL is remediated within seven days"); this is
   * a threshold on a SILENCE across a whole repository ("nothing at all has closed here for
   * ninety days"). They share a tab because both are deadlines a reader sets, and they share
   * nothing else: this one has no per-severity grain, it is never compared against
   * `SLA_TARGETS`, and `draftWarnings`'s divergence prompt does not apply to it — the other
   * three sidekicks have no cold zone to disagree with.
   *
   * CLAMPED, NEVER DEFAULTED, WHEN IT IS A REAL NUMBER (`cleanColdAfterDays` below), because
   * `domain/coldZone.ts` derives its four idle buckets as thirds of this value and THROWS on a
   * non-positive one — the clamp here is the only thing standing between an operator's typo
   * and a page on which every repository is cold.
   */
  coldAfterDays: number;
  /**
   * WHICH DEFINITION DRAWS THE COLD LINE — `"fixed"` (the window above, as saved) or
   * `"relative"` (the line derived so that the idlest `coldTargetSharePct` per cent of the
   * repositories with open findings are cold). Default `"fixed"`, which is what every
   * deployment that predates this field already behaves as.
   *
   * A MODE, NOT A FOURTH THRESHOLD. Both readings produce exactly ONE effective line in days
   * — `domain/coldZone.ts` publishes it as `cold_after_days` in both modes — so nothing
   * downstream of the profile branches on this field. It is here, and not on `coldZoneProfile`'s
   * caller, because the choice is the operator's and has to survive a reload.
   *
   * A FALLBACK, NEVER A CLAMP (`cleanColdZoneMode` below). The two other cold-zone fields are
   * numbers on a range where "too small" still names a real intent; this one is a closed set,
   * where an unrecognized string names no intent at all — so it falls back to `"fixed"` rather
   * than being coerced toward some nearest legal value, which for a two-member set would be
   * meaningless.
   */
  coldZoneMode: ColdZoneMode;
  /**
   * The share of the eligible estate relative mode aims the line at, in per cent. Read ONLY in
   * relative mode; carried in both so flipping the mode back and forth never loses it.
   *
   * CLAMPED INTO `[COLD_TARGET_SHARE_PCT_MIN, COLD_TARGET_SHARE_PCT_MAX]` (1..50) WHEN IT IS A
   * REAL NUMBER, junk to the default — `cleanColdAfterDays`'s split exactly. The ceiling is 50
   * rather than 100 because a "cold zone" that is most of the estate is not a zone, it is the
   * estate; the floor is 1 because a share of zero would name nobody and make the whole mode a
   * no-op that still looks configured.
   *
   * LOAD-BEARING FOR THE SERVER: `coldZoneProfile` THROWS in relative mode when this is
   * missing or out of (0, 100], so it must always travel with the mode through
   * `effectiveColdZoneSettings` below rather than being read off the field directly.
   */
  coldTargetSharePct: number;
  /**
   * The floor, in days, that the derived line may never go below. Read ONLY in relative mode.
   *
   * WHY A DERIVED LINE NEEDS A FLOOR AT ALL: a share always names somebody. On a fresh or a
   * healthy estate the idlest 20% might have been idle for nine days, and calling those
   * repositories cold would be a slander the reader cannot act on. The floor is what stops the
   * relative reading from manufacturing a cold zone out of a landscape that does not have one;
   * `coldZoneProfile` publishes `floor_applied` and `derived_days` so the page can say when it
   * held.
   *
   * CLAMPED INTO `[COLD_FLOOR_DAYS_MIN, COLD_FLOOR_DAYS_MAX]` (1..365) when real, junk to the
   * default — the same split again. The ceiling is `COLD_AFTER_DAYS_MAX`, so a floor can never
   * be set beyond the longest fixed window this register will accept.
   */
  coldFloorDays: number;
  /** Show routes flagged experimental in the nav. */
  showExperimental: boolean;
  /**
   * Hour-of-day (0-23, script-local) the daily sync trigger is requested to fire at.
   *
   * STILL CAPTURED AND NOT WIRED, and S7 looked at it and left it on purpose. The blocker is
   * NOT the Sheets read an earlier revision of this comment named — `setup()` calls
   * `ensureTabs` before its trigger block, so the tab exists and an empty one cleans to this
   * same default. It is the RECONCILE: the daily trigger is deduplicated by handler name alone,
   * so a setting read once at install and never again would let an operator change the hour,
   * watch setup() report "already installed", and keep firing at the old time. Converging needs
   * a recorded signature the way `warmTriggerSchedule()` has one, which means a new
   * `PROP_KEYS` entry and a `test/setup.test.ts` case. `server/setup.ts` carries the full
   * statement of this beside `DAILY_SYNC_HOUR`.
   */
  syncSchedule: number;
  /**
   * Whether ledger compaction runs automatically after each committed sync.
   *
   * WIRED (S7). `server/scanJobs.ts::autoCompactIfDue()` reads this field and `retentionDays`
   * below, and the `AUTO_COMPACT_DAYS` Script Property it used to gate on is GONE — not kept
   * as a fallback, because a second home for one value is the failure the `wizProjectId` note
   * above this interface describes: an operator changes the setting, the Data page agrees, and
   * compaction keeps running on whatever the property said.
   *
   * THE DEFAULT DID NOT MOVE ACROSS THAT REWIRE, and that is the property worth keeping: the
   * old gate was an unset Script Property (= off) and this one is `false`, so a fresh install
   * and every existing deployment behave identically until an operator opts in.
   */
  autoCompact: boolean;
  /** Compaction retention window, in days. Read only once `autoCompact` is true. */
  retentionDays: number;
  /**
   * The VIEW scope — which project's rows the pages show, out of everything the ledger holds.
   * `""` means no scope: show the whole register, every project the fetch scope ever collected.
   *
   * Holds a project SLUG, not a Wiz object id, and is deliberately NOT validated against any
   * catalogue of known projects. A stale slug naming a project the register no longer holds
   * must stay clearable — an operator who renamed or retired a project should be able to clear
   * this field and see the whole register again — rather than becoming a trap that some
   * validation step refuses to save because the name it once matched is gone.
   *
   * MUTUALLY EXCLUSIVE WITH `domainView`, and the header control is what enforces it: the
   * two are orthogonal cuts of the same register — a project is where a repository sits in the
   * tenant's hierarchy, a domain is who the tenant says owns it — and a header that carries
   * "the scope" cannot carry two of them and still answer "what am I looking at" in one line.
   * Picking either clears the other; see `withProjectView` / `withDomainView` below, which is
   * where that is done rather than left to two call sites to remember.
   */
  projectView: string;
  /**
   * The other VIEW scope — which business domain's rows the pages show. `""` means no domain
   * scope, exactly as `projectView`'s `""` means no project scope.
   *
   * Holds the TAG VALUE verbatim (`"SAP"`), because that is the only identity a domain has:
   * it is a string a person typed on a repository in Wiz, not an object with a slug. See
   * src/domain/domainScope.ts for why membership compares it exactly rather than folded.
   *
   * NOT VALIDATED against any catalogue of known domains, for `projectView`'s reason
   * unchanged: a stale value naming a domain the register no longer holds must stay
   * clearable rather than becoming a trap some validation step refuses to save.
   */
  domainView: string;
}

export const DEFAULT_SETTINGS: Settings = {
  scopes: [...SCOPES],
  fetchSeverities: {
    sca: [...DEFAULT_FETCH_SEVERITIES.sca],
    sast: [...DEFAULT_FETCH_SEVERITIES.sast],
    secrets: [...DEFAULT_FETCH_SEVERITIES.secrets],
  },
  slaTargets: { ...SLA_TARGETS },
  coldAfterDays: DEFAULT_COLD_AFTER_DAYS,
  coldZoneMode: DEFAULT_COLD_ZONE_MODE,
  coldTargetSharePct: DEFAULT_COLD_TARGET_SHARE_PCT,
  coldFloorDays: DEFAULT_COLD_FLOOR_DAYS,
  showExperimental: false,
  syncSchedule: DEFAULT_SYNC_HOUR,
  autoCompact: false,
  retentionDays: DEFAULT_RETENTION_DAYS,
  projectView: "",
  domainView: "",
};

function asList(v: unknown, allowed: readonly string[]): string[] | null {
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  for (const x of v) {
    const s = String(x).trim().toUpperCase();
    if (allowed.includes(s as never)) seen.add(s);
  }
  return [...seen];
}

/**
 * Coerce the stored fetchSeverities into the per-scope record, MIGRATING THE OLD SHAPE.
 *
 * This setting used to be one flat array applied to every scope, and the settings tab of any
 * existing deployment still holds it that way. A migration that dropped it would silently
 * reset an operator's choice on the next save; one that threw would take the app down over a
 * settings row. So a stored array is read as "this was your answer for every scope" and
 * spread across all three — which is exactly what it meant when it was written.
 *
 * A scope missing from a stored record falls back to ITS OWN default rather than to another
 * scope's, since that is the whole point of the record. An explicitly empty list is a real
 * answer — "every severity" — and survives.
 */
function cleanFetchSeverities(raw: unknown): Record<Scope, string[]> {
  const out = {} as Record<Scope, string[]>;

  if (Array.isArray(raw)) {
    const shared = asList(raw, SEVERITY_ORDER) ?? [];
    for (const scope of SCOPES) {
      out[scope] = shared.length ? [...shared] : [...DEFAULT_FETCH_SEVERITIES[scope]];
    }
    return out;
  }

  const rec = (raw ?? {}) as Record<string, unknown>;
  for (const scope of SCOPES) {
    out[scope] = asList(rec[scope], SEVERITY_ORDER) ?? [...DEFAULT_FETCH_SEVERITIES[scope]];
  }
  return out;
}

/**
 * A finite number, or null for anything that is not one — including `null`/`undefined`
 * themselves and arrays/objects. `Number(null) === 0` and `Number([]) === 0`: naive
 * `Number(v)` coercion would read "not provided" as the valid value zero, so junk has to be
 * screened BEFORE Number() runs, not after.
 */
function numericOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Coerce an hour-of-day into range, falling back to `fallback` on anything else. */
function cleanHourOfDay(v: unknown, fallback: number): number {
  const n = numericOrNull(v);
  if (n === null) return fallback;
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

/**
 * Coerce a retention window, floored at `RETENTION_MIN_DAYS` — the same floor
 * `maintenance.ts`'s `compactLedgerCore` enforces server-side, so a value this stage lets
 * through can never be rejected downstream for being too small. Junk (not a number at all)
 * falls back to the default window; an in-range-but-too-small number is CLAMPED rather than
 * defaulted, same distinction `cleanFetchSeverities` draws between "missing" and "explicitly
 * empty" — a operator who typed 1 asked for the shortest window they could, not for 180.
 */
function cleanRetentionDays(v: unknown): number {
  const n = numericOrNull(v);
  if (n === null) return DEFAULT_RETENTION_DAYS;
  return Math.max(Math.floor(n), RETENTION_MIN_DAYS);
}

/**
 * Coerce a cold-zone window into `[COLD_AFTER_DAYS_MIN, COLD_AFTER_DAYS_MAX]`, floored.
 *
 * THE SAME TWO-WAY SPLIT `cleanRetentionDays` DRAWS, for the same reason: junk — anything that
 * is not a number at all — falls back to the default, while a REAL number outside the range is
 * CLAMPED rather than defaulted. An operator who typed 3 asked for the shortest window they
 * could, not for 90, and one who typed 400 asked for the longest; throwing either answer away
 * and silently restoring the default would tell them nothing and lose what they meant.
 *
 * BOUNDED AT BOTH ENDS, unlike retention's one-sided floor. The floor is what stops the buckets
 * (thirds of this number — `domain/coldZone.ts`) from collapsing into noise, and stops a window
 * shorter than the gap between two syncs from calling every repository cold the moment it is
 * saved. The ceiling is what stops a window longer than this register has been watching, which
 * would make the block permanently unmeasurable while looking configured.
 */
function cleanColdAfterDays(v: unknown): number {
  const n = numericOrNull(v);
  if (n === null) return DEFAULT_COLD_AFTER_DAYS;
  return Math.min(COLD_AFTER_DAYS_MAX, Math.max(COLD_AFTER_DAYS_MIN, Math.floor(n)));
}

/**
 * Coerce a stored cold-zone MODE into one of `COLD_ZONE_MODES`, falling back to
 * `DEFAULT_COLD_ZONE_MODE` for anything else.
 *
 * A FALLBACK, NOT A CLAMP, and that is the one way it differs from the three numeric cleaners
 * around it. `cleanColdAfterDays` clamps because "3" and "400" are real answers pointing at a
 * real end of a real range; there is no nearest legal value for `"warm"` in a two-member set,
 * so the only honest reading of an unrecognized string is "nothing was chosen".
 *
 * REFUSES ANYTHING THAT IS NOT ALREADY A STRING, BEFORE ANY CAST — the exact trap
 * `cleanViewScope` above documents, with teeth here rather than merely a shrug: `String(null)`
 * is `"null"`, `String(undefined)` is `"undefined"`, `String({})` is `"[object Object]"`, and
 * none of those is in `COLD_ZONE_MODES` so a cast-first version would happen to work today —
 * until somebody names a mode `"null"`. A genuine string is trimmed and lowercased first, so
 * `" RELATIVE "` from a hand-edited settings cell is the mode it plainly means.
 */
function cleanColdZoneMode(v: unknown): ColdZoneMode {
  if (typeof v !== "string") return DEFAULT_COLD_ZONE_MODE;
  const m = v.trim().toLowerCase();
  return (COLD_ZONE_MODES as readonly string[]).includes(m) ? (m as ColdZoneMode) : DEFAULT_COLD_ZONE_MODE;
}

/**
 * Coerce the relative mode's target share into `[COLD_TARGET_SHARE_PCT_MIN,
 * COLD_TARGET_SHARE_PCT_MAX]`, floored. `cleanColdAfterDays`'s split, unchanged: junk — not a
 * number at all — falls back to the default, a REAL number outside the range is CLAMPED,
 * because an operator who typed 80 asked for the widest zone this register offers, not for 20.
 */
function cleanColdTargetSharePct(v: unknown): number {
  const n = numericOrNull(v);
  if (n === null) return DEFAULT_COLD_TARGET_SHARE_PCT;
  return Math.min(COLD_TARGET_SHARE_PCT_MAX, Math.max(COLD_TARGET_SHARE_PCT_MIN, Math.floor(n)));
}

/**
 * Coerce the relative mode's floor into `[COLD_FLOOR_DAYS_MIN, COLD_FLOOR_DAYS_MAX]`, floored.
 * The same split for the third time, and deliberately a third function rather than one
 * parameterised helper: each of these three carries its own bounds, its own default and its
 * own reason, and a shared `clampOrDefault(v, lo, hi, d)` would move all three of those out of
 * the place where they can be read beside the field they govern.
 */
function cleanColdFloorDays(v: unknown): number {
  const n = numericOrNull(v);
  if (n === null) return DEFAULT_COLD_FLOOR_DAYS;
  return Math.min(COLD_FLOOR_DAYS_MAX, Math.max(COLD_FLOOR_DAYS_MIN, Math.floor(n)));
}

/**
 * Coerce a stored view scope — a project slug or a domain tag value — into a trimmed string,
 * refusing anything that is not ALREADY a string BEFORE any cast runs. The same trap
 * `numericOrNull` above guards against, on the string side of it: `String(null)` is `"null"`,
 * `String(undefined)` is `"undefined"`, `String(0)` is `"0"`, `String(false)` is `"false"`, and
 * `String({})` is `"[object Object]"` — every one of those would read as a real (if odd) scope
 * instead of "no scope stored" if the value were cast before being checked. Only a genuine
 * string is trimmed and kept; anything else — null, undefined, a number, an array, a plain
 * object — collapses to `""`, the same value a missing field produces.
 *
 * ONE FUNCTION FOR BOTH SCOPES. A project slug and a domain tag value are different
 * vocabularies but the same KIND of stored value: opaque, operator-chosen, and deliberately
 * unvalidated against any catalogue (see `Settings.projectView`). Giving each its own coercion
 * would invite one of them to drift.
 */
function cleanViewScope(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Validate a raw `slaTargets` value down to the overrides worth keeping: a finite, positive
 * number, floored, for a recognized severity. Anything else (missing, non-numeric, zero or
 * negative, an unrecognized key) is left OUT rather than defaulted here — this returns a
 * PARTIAL record of overrides only, never a full one seeded from `SLA_TARGETS`, so both
 * `cleanSettings` below (which spreads the constant first) and `effectiveSlaTargets` (which
 * does the same layering one step later, over whatever `Settings.slaTargets` a caller hands
 * it) can overlay this on the shared baseline without this function taking a position on what
 * the default is.
 */
function cleanSlaTargets(raw: unknown): Record<string, number> {
  // Typed as a full `Record`, not `Partial<Record<...>>`, even though a key is only ever
  // ASSIGNED when valid: an index signature admits an absent key without admitting
  // `undefined` as a VALUE, and spreading a genuinely-partial (optional-value) type into
  // `{...SLA_TARGETS, ...cleanSlaTargets(...)}` would widen every value below to
  // `number | undefined` for no runtime reason — this object never holds `undefined`.
  const out: Record<string, number> = {};
  const rec = (raw || {}) as Record<string, unknown>;
  for (const sev of SEVERITY_ORDER) {
    const v = Number(rec[sev]);
    if (Number.isFinite(v) && v > 0) out[sev] = Math.floor(v);
  }
  return out;
}

/**
 * Stage one: coerce whatever is stored into shape. NEVER throws and never reports — a
 * settings tab edited by hand must not be able to take the app down. Stage two
 * (`validateSettings`) is what tells a human they typed something wrong.
 */
export function cleanSettings(raw: Rec | null | undefined): Settings {
  const r = (raw || {}) as Rec;
  const scopes = (Array.isArray(r.scopes) ? r.scopes : [])
    .map((x) => String(x).trim().toLowerCase())
    .filter((x): x is Scope => (SCOPES as readonly string[]).includes(x));

  return {
    // An empty list would collect nothing while looking configured, so it falls back
    // rather than persisting a register that can never fill.
    scopes: scopes.length ? scopes : [...SCOPES],
    fetchSeverities: cleanFetchSeverities(r.fetchSeverities),
    slaTargets: { ...SLA_TARGETS, ...cleanSlaTargets(r.slaTargets) },
    coldAfterDays: cleanColdAfterDays(r.coldAfterDays),
    coldZoneMode: cleanColdZoneMode(r.coldZoneMode),
    coldTargetSharePct: cleanColdTargetSharePct(r.coldTargetSharePct),
    coldFloorDays: cleanColdFloorDays(r.coldFloorDays),
    showExperimental: r.showExperimental === true,
    syncSchedule: cleanHourOfDay(r.syncSchedule, DEFAULT_SYNC_HOUR),
    // Junk (a string, a number, undefined) coerces to false, same as showExperimental above —
    // only a literal boolean true turns compaction on.
    autoCompact: r.autoCompact === true,
    retentionDays: cleanRetentionDays(r.retentionDays),
    projectView: cleanViewScope(r.projectView),
    // The same coercion, and deliberately the same function: both hold an opaque operator-
    // chosen string whose only invalid form is "not a string". Two copies of that rule is how
    // one of them later grows a difference nobody intended.
    domainView: cleanViewScope(r.domainView),
  };
}

/** Stage two: what a human got wrong, in words. Never repairs — that is stage one's job. */
export function validateSettings(s: Settings): string[] {
  const errs: string[] = [];
  if (!s.scopes.length) errs.push("Choose at least one register to collect.");
  for (const scope of s.scopes) {
    if (!Array.isArray(s.fetchSeverities?.[scope])) {
      errs.push(`No severity selection stored for the ${scope} register.`);
    }
  }
  for (const [sev, days] of Object.entries(s.slaTargets)) {
    if (!Number.isFinite(days) || days <= 0) {
      errs.push(`The SLA target for ${sev} must be a positive number of days.`);
    }
  }
  // Same relationship with stage one as the retention floor below: `cleanColdAfterDays` clamps,
  // so this branch only fires on a hand-built Settings that skipped it. Worded as a range with
  // both ends inclusive ("at least N", never ">") — README's bound rule.
  if (
    !Number.isFinite(s.coldAfterDays)
    || s.coldAfterDays < COLD_AFTER_DAYS_MIN
    || s.coldAfterDays > COLD_AFTER_DAYS_MAX
  ) {
    errs.push(
      `The cold-zone window must be at least ${COLD_AFTER_DAYS_MIN} days and at most `
      + `${COLD_AFTER_DAYS_MAX} days.`,
    );
  }
  // The mode is a closed set, so the message names BOTH members rather than a range — there is
  // no "at least"/"at most" to state about two words. Same relationship with stage one as every
  // branch around it: `cleanColdZoneMode` falls back, so this only fires on a hand-built
  // Settings that skipped it.
  if (!(COLD_ZONE_MODES as readonly string[]).includes(s.coldZoneMode)) {
    errs.push("The cold-zone mode must be either fixed or relative.");
  }
  if (
    !Number.isFinite(s.coldTargetSharePct)
    || s.coldTargetSharePct < COLD_TARGET_SHARE_PCT_MIN
    || s.coldTargetSharePct > COLD_TARGET_SHARE_PCT_MAX
  ) {
    errs.push(
      `The cold-zone target share must be at least ${COLD_TARGET_SHARE_PCT_MIN}% and at most `
      + `${COLD_TARGET_SHARE_PCT_MAX}%.`,
    );
  }
  if (
    !Number.isFinite(s.coldFloorDays)
    || s.coldFloorDays < COLD_FLOOR_DAYS_MIN
    || s.coldFloorDays > COLD_FLOOR_DAYS_MAX
  ) {
    errs.push(
      `The cold-zone floor must be at least ${COLD_FLOOR_DAYS_MIN} day and at most `
      + `${COLD_FLOOR_DAYS_MAX} days.`,
    );
  }
  if (!Number.isInteger(s.syncSchedule) || s.syncSchedule < 0 || s.syncSchedule > 23) {
    errs.push("The sync schedule hour must be a whole number between 0 and 23.");
  }
  // cleanSettings always clamps to this floor; this branch only fires on a hand-built Settings
  // that skipped stage one, same relationship validateSettings has with every other field.
  if (!Number.isFinite(s.retentionDays) || s.retentionDays < RETENTION_MIN_DAYS) {
    errs.push(`The retention window must be at least ${RETENTION_MIN_DAYS} days.`);
  }
  return errs;
}

/** Merge a patch over current settings, then re-clean. */
export function withSettings(current: Settings, patch: Partial<Settings>): Settings {
  return cleanSettings({ ...current, ...patch } as unknown as Rec);
}

/**
 * Set the project view scope, CLEARING the domain one.
 *
 * ONE AT A TIME, ENFORCED STRUCTURALLY. The two view scopes are orthogonal cuts of the same
 * register and both could be applied at once — but the app header carries a single "Scope"
 * control and a single caption, and a control that says `SAP` while a second stored value
 * also narrows to `CE-TRANSPORT` is a header that cannot answer "what am I looking at". gas/
 * learned this with its manual-group and support-group comboboxes, which could both be live,
 * and made it one control for exactly this reason (see gas/src/client/js/scopeKinds.js).
 *
 * The clearing lives HERE rather than in the two API endpoints, so "picking one replaces the
 * other" is a property of the settings themselves and not a rule two call sites have to
 * remember — the same argument `gas_shared/ui/scopeModel.js` makes on the client side.
 */
export function withProjectView(current: Settings, projectView: unknown): Settings {
  return withSettings(current, { projectView, domainView: "" } as Partial<Settings>);
}

/** Set the domain view scope, CLEARING the project one. See `withProjectView`. */
export function withDomainView(current: Settings, domainView: unknown): Settings {
  return withSettings(current, { domainView, projectView: "" } as Partial<Settings>);
}

/**
 * The SLA windows actually in force for THIS register: the shared cross-surface constant,
 * with whatever the operator saved on the Deadlines tab layered on top.
 *
 * WHY THE CONSTANT STAYS THE BASELINE. `config.ts`'s `SLA_TARGETS` is deliberately
 * byte-identical to gas/'s and brick/'s own tables — its own docstring says so — so
 * a CRITICAL finding carries the same seven-day window whichever of the four surfaces is
 * asked: "the four surfaces cannot report different SLA attainment for the same estate". That
 * invariant is real, and it is what this function returns for every severity nobody has
 * touched. Nothing here changes `SLA_TARGETS` itself, and nothing here changes the inclusive
 * `d <= target` comparison it is measured against — nothing downstream reads a target
 * differently depending on where it came from.
 *
 * WHY AN OVERRIDE IS LEGITIMATE ANYWAY. An operator can have a documented, LOCAL reason to
 * remediate faster or slower than the shared baseline — a contractual SLA, a regulatory
 * deadline, one register under unusual load — and the Deadlines tab is exactly the control
 * that lets them say so. That is a DELIBERATE, WARNED-ABOUT divergence, not a defect this
 * function exists to paper over: `draftWarnings` (src/client/js/settingsModel.js) already
 * tells the operator, at save time, that a changed window "would no longer match the window
 * the OS, AI and pipeline registers use". Consistency is the DEFAULT this function falls back
 * to, not a constraint the settings page is forbidden from lifting.
 *
 * AN OVERLAY, NEVER A REPLACEMENT. The constant is spread first and the cleaned override
 * second, so a severity the operator never touched — or touched with something
 * `cleanSlaTargets` refuses (zero, negative, non-numeric) — keeps the shared window rather
 * than silently losing its deadline. Reuses `cleanSlaTargets`, the exact validation
 * `cleanSettings` applies to a freshly-saved draft, rather than a second copy of "finite,
 * positive, floor it" — so a `Settings`-shaped value that never went through `cleanSettings`
 * (a hand-built test fixture, a partial mock, a bootstrap payload trimmed to one field) still
 * degrades to the shared baseline instead of throwing or handing back garbage.
 */
export function effectiveSlaTargets(
  settings: Pick<Settings, "slaTargets"> | null | undefined,
): Record<string, number> {
  return { ...SLA_TARGETS, ...cleanSlaTargets(settings?.slaTargets) };
}

/**
 * The cold-zone window actually in force: whatever the operator saved on the Deadlines tab,
 * cleaned, or the shared default when they never touched it.
 *
 * `effectiveSlaTargets`'S TWIN, AND IT EXISTS FOR THE SAME REASON RATHER THAN FOR SYMMETRY.
 * `server/readModels.ts`'s `norm()` reads this off `settingsStore.loadSettings()`, and a
 * `Settings`-shaped value that never went through `cleanSettings` — a hand-built fixture, a
 * partial mock, a bootstrap payload trimmed to one field — would otherwise hand
 * `coldZoneProfile` an `undefined` it REFUSES (it throws on a non-positive threshold by
 * design). Reusing `cleanColdAfterDays`, the exact coercion `cleanSettings` applies, rather
 * than a second copy of "junk to the default, a real number clamped", is what keeps the figure
 * the page publishes and the figure the settings row displays from ever disagreeing.
 */
export function effectiveColdAfterDays(
  settings: Pick<Settings, "coldAfterDays"> | null | undefined,
): number {
  return effectiveColdZoneSettings(settings).coldAfterDays;
}

/** Everything `coldZoneProfile` needs to draw the line, read off one settings object. */
export interface EffectiveColdZone {
  mode: ColdZoneMode;
  coldAfterDays: number;
  targetSharePct: number;
  floorDays: number;
}

/**
 * THE ONE DOOR between a stored settings row and `domain/coldZone.ts`.
 *
 * WHY IT IS ONE FUNCTION AND NOT FOUR READS. `coldZoneProfile` does not merely prefer its
 * options to arrive together — it THROWS when `mode === "relative"` and `targetSharePct` or
 * `floorDays` is missing or out of range, by design (there is no default for them inside the
 * profile, because a share the caller never named is not a share). So any caller that reads
 * the mode from one place and the two numbers from another has a live way to hand the profile
 * a relative mode with nothing to aim at, and the failure is not a wrong figure — it is the
 * Repositories page refusing to draw. Routing all four through here makes that combination
 * unconstructible: the mode is always accompanied.
 *
 * THE SAME DEGRADATION `effectiveSlaTargets` AND THE OLD `effectiveColdAfterDays` ALREADY GAVE,
 * now over four fields instead of one: a `Settings`-shaped value that never went through
 * `cleanSettings` — a hand-built fixture, `test/readModels.test.ts`'s deliberately PARTIAL
 * `loadSettings()` mock, a bootstrap payload trimmed to one field, `null` itself — comes back
 * as the four shared defaults rather than as `undefined`s the profile refuses. Each field is
 * read through the exact cleaner `cleanSettings` applies, so the figure a page publishes and
 * the figure the settings row displays can never disagree.
 *
 * `effectiveColdAfterDays` IS NOW A PROJECTION OF THIS, not a second implementation — one
 * coercion of `coldAfterDays` exists in this module's exported surface, and the two functions
 * cannot drift because there is nothing for them to drift between.
 */
export function effectiveColdZoneSettings(
  settings:
    | Partial<Pick<Settings, "coldAfterDays" | "coldZoneMode" | "coldTargetSharePct" | "coldFloorDays">>
    | null
    | undefined,
): EffectiveColdZone {
  return {
    mode: cleanColdZoneMode(settings?.coldZoneMode),
    coldAfterDays: cleanColdAfterDays(settings?.coldAfterDays),
    targetSharePct: cleanColdTargetSharePct(settings?.coldTargetSharePct),
    floorDays: cleanColdFloorDays(settings?.coldFloorDays),
  };
}
