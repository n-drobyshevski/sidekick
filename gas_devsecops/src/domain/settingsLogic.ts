// Settings semantics, kept pure so the half that can be wrong is the half vitest can hold.
//
// Phase 1 carries the settings the shell itself needs. The register's collection knobs
// (which scopes to sync, which severities to request) are declared here rather than in
// Phase 2 because the Settings page reads them today, and a page that offers a control
// with nothing behind it is the thing this product does not do.

import {
  DEFAULT_FETCH_SEVERITIES, DEFAULT_RETENTION_DAYS, SCOPES, SEVERITY_ORDER, SLA_TARGETS,
  type Scope,
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
   * Mutually exclusive with nothing: this register has exactly one scope dimension, so there
   * is no second view-scope field for this one to conflict with.
   */
  projectView: string;
}

export const DEFAULT_SETTINGS: Settings = {
  scopes: [...SCOPES],
  fetchSeverities: {
    sca: [...DEFAULT_FETCH_SEVERITIES.sca],
    sast: [...DEFAULT_FETCH_SEVERITIES.sast],
    secrets: [...DEFAULT_FETCH_SEVERITIES.secrets],
  },
  slaTargets: { ...SLA_TARGETS },
  showExperimental: false,
  syncSchedule: DEFAULT_SYNC_HOUR,
  autoCompact: false,
  retentionDays: DEFAULT_RETENTION_DAYS,
  projectView: "",
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
 * Coerce the stored view-scope slug into a trimmed string, refusing anything that is not
 * ALREADY a string BEFORE any cast runs — the same trap `numericOrNull` above guards against,
 * on the string side of it. `String(null)` is `"null"`, `String(undefined)` is `"undefined"`,
 * `String(0)` is `"0"`, `String(false)` is `"false"`, and `String({})` is `"[object Object]"`:
 * every one of those would read as a real (if odd) project slug instead of "no scope stored"
 * if the value were cast before being checked. Only a genuine string is trimmed and kept;
 * anything else — null, undefined, a number, an array, a plain object — collapses to `""`,
 * the same value a missing field produces.
 */
function cleanProjectView(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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

  const sla: Record<string, number> = { ...SLA_TARGETS };
  const rawSla = (r.slaTargets || {}) as Rec;
  for (const sev of SEVERITY_ORDER) {
    const v = Number((rawSla as Record<string, unknown>)[sev]);
    if (Number.isFinite(v) && v > 0) sla[sev] = Math.floor(v);
  }

  return {
    // An empty list would collect nothing while looking configured, so it falls back
    // rather than persisting a register that can never fill.
    scopes: scopes.length ? scopes : [...SCOPES],
    fetchSeverities: cleanFetchSeverities(r.fetchSeverities),
    slaTargets: sla,
    showExperimental: r.showExperimental === true,
    syncSchedule: cleanHourOfDay(r.syncSchedule, DEFAULT_SYNC_HOUR),
    // Junk (a string, a number, undefined) coerces to false, same as showExperimental above —
    // only a literal boolean true turns compaction on.
    autoCompact: r.autoCompact === true,
    retentionDays: cleanRetentionDays(r.retentionDays),
    projectView: cleanProjectView(r.projectView),
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
