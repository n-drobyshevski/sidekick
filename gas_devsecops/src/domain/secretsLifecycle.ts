// D7 — the secrets register's own clock: not "when did the finding leave the register",
// which is what every other scope measures, but "when was the credential confirmed dead" —
// and, beside every figure, how many rows nobody has ever checked.
//
// NEW AND DESIGNED. There is no port source for this file. gas/ has no secrets register, and
// brick/devsecops/ never modelled one either (config.ts's `ruleForScope` says so in its own
// comment: secrets returns null because brick had nothing to say about the scope). So every
// measurement decision below was made HERE, and each one is written down with its reason,
// because there is no upstream module to go and read instead. Changing one of these changes
// what the register claims; changing it silently is how a clock starts lying.
//
// The vocabulary is the industry's "time to revoke" (GitGuardian): the clock runs from
// DETECTION to CONFIRMED-INVALID, and removal of the string from the repository does NOT stop
// it. What ships is the median and P90 of that duration, the share inside a chosen SLA, the
// coverage of the validation check itself, and the post-detection validity rate — every one
// of them carrying its denominator.
//
// ------------------------------------------------------------------------------------- //
//  THE DECISIONS THIS MODULE ENCODES
// ------------------------------------------------------------------------------------- //
//
//  1. SCOPE IS FILTERED HERE, NOT BY THE CALLER. Every export takes the whole ledger
//     (LedgerRow[] / BaseRow[]) and keeps `scope === "secrets"` itself, so no page can
//     accidentally price SCA rows through a secrets metric. `validationCoverage` and
//     `timeToRevoke` return `ignoredOtherScopes` — a zero has to prove it looked, and a
//     secrets figure computed over an all-SCA ledger must be able to say so.
//
//  2. MEASURED MEANS `validation_state ∈ {VALID, INVALID}`. UNKNOWN, ERROR, null and blank
//     are UNMEASURED, which is neither alive nor dead. This is the absent-is-never-zero rule
//     applied to the column that carries it: in this tenant 393,443 of 394,927 secret
//     instances read UNKNOWN (sheetsDb.ts's ledger header), so collapsing "never checked"
//     into "not rotated" would misprice 99.6% of the population by construction.
//
//  3. AN UNMEASURED ROW IS EXCLUDED FROM THE CLOCK, NOT CENSORED. Right-censoring asserts
//     "this observation was still alive at time c", and a secret nobody has ever validated
//     supports no such claim — censoring it would feed the survival curve an assertion the
//     data never made. They leave as `excludedUnmeasured` rather than vanishing, so the
//     curve's denominator and the register's row count can be reconciled by the reader.
//
//  4. THE EVENT IS `rotated_at`, AND THE LEDGER'S `status` / `resolved_at` ARE NEVER READ
//     BY THIS CLOCK. Removed is not rotated: a secrets row can be RESOLVED — the string left
//     HEAD — while the credential is still live, and treating that as the death date is
//     exactly the error the four-column secrets lifecycle exists to prevent. `rotated_at` is
//     the ledger's "observed dead at this time" (set from validated_at on the first INVALID);
//     it is the only column that can end this clock.
//
//  5. THE CENSORING TIME IS `now − first_seen`, not `last_seen`. A secret still on the
//     books at the last sync is exposed until it is proven dead, so the exposure runs to the
//     moment of the report. `now` is an explicit option so the figure is reproducible.
//
//  6. A ROW THAT CANNOT BE TIMED IS EXCLUDED AND COUNTED (`excludedNoClock`), NOT ZEROED.
//     Three ways in: no parsable `first_seen`; a derived duration that comes out negative (a
//     death before its birth, or a birth after `now`); or an INVALID row carrying no
//     `rotated_at` — known dead, UNDATED, which is neither an event (no duration) nor
//     censorable (censoring asserts "still alive at c", which INVALID contradicts). No
//     clamping — a negative duration is a data defect and pinning it at zero would hide it
//     inside a healthy-looking median. The exclusion buckets are disjoint and tested in
//     order: wrong scope, then unmeasured, then untimeable.
//
//  7. THE SLA IS AN OPTION WITH A DEFAULT OF 7 DAYS, AND IT IS A CHOSEN OPERATIONAL TARGET
//     RATHER THAN A MEASUREMENT. It is deliberately NOT `SLA_TARGETS[severity]` — that table
//     is not imported here on purpose. Severity grades a DETECTION on this register
//     (config.ts's DEFAULT_FETCH_SEVERITIES.secrets, PROBE_FINDINGS.md §10.3: 641
//     SAAS_API_KEY rows sit at LOW), so deriving a revocation deadline from it would give a
//     live cloud key a 90-day window because the detector was unsure of the string's shape.
//     In-SLA is inclusive (`<= sla`), matching config.ts's "resolved ON OR BEFORE the target".
//
//  8. THERE IS NO SEPARATE `openExposure` FIGURE. THE CENSORED SIDE OF THIS CURVE IS THE OPEN
//     EXPOSURE — `timeToRevoke().censored` is the count of detected, measured-live credentials
//     with no confirmed death, and their ages are already in the risk set the median is
//     estimated from. A second "still open" statistic computed beside the curve would be the
//     same rows counted twice under two names that could drift apart.
//
//  9. `removedNotRotated` IS THE HERO OF THE 2x2. "N secrets left the code and nobody has
//     confirmed the credential is dead" is the sentence this register exists to be able to
//     say; the other three cells are there so the reader can see the denominator it came from.
//     Presence is tested with `present()`, so a blank cell counts as absent rather than set.
//
// 10. `bySegment(rows, "severity")` THROWS, and the axis type makes it a compile error too.
//     Severity grades a detection, not whether a credential is live (CLAUDE.md, and the
//     measured crosstab in PROBE_FINDINGS.md §10.3). A severity segmentation of this register
//     would read like a risk ranking and would not be one, so the module refuses rather than
//     rendering it. `validation_state`, `confidence` and `secret_kind` are the axes that do
//     speak to the question.
//
// 11. PERCENTAGES ARE 0..100, NOT 0..1, matching lifecycle.ts's `sla_pct`; each is null when
//     its denominator is zero rather than 0, because "no rows" and "none of the rows" are
//     different answers.
//
// 12. `twinAudit` REPORTS A FOLD IT DID NOT PERFORM. The repository/branch twin collapse
//     happens in reconcile.ts when the ledger key is built; by the time rows reach this module
//     the duplicates are already gone, so counting `rows.length` here would measure nothing.
//     It therefore takes the statistics recorded by that fold and renders them — and, given
//     null, says that no twin statistics were recorded rather than printing zeros. Pure: no
//     clock, no locale, no I/O.

import { RESOLVED_STATUSES, STATUS_OPEN, STATUS_RESOLVED } from "./config";
import type { LedgerRow } from "./ledgerTypes";
import {
  kaplanMeier,
  kmQuantileFromCurve,
  type KMResult,
  type RemediationRow,
} from "./remediation";
import { cmp, parseTs, present } from "./util";

/** Milliseconds in a day — the same constant lifecycle.ts keeps privately for mttr/age. */
const DAY_MS = 86_400_000;

/**
 * The columns this module reads. A Pick rather than LedgerRow itself so both `LedgerRow[]`
 * and `BaseRow[]` are assignable without a cast, exactly as RemediationRow does for the
 * Kaplan–Meier engine.
 */
export type SecretRow = Pick<
  LedgerRow,
  | "scope"
  | "status"
  | "first_seen"
  | "secret_kind"
  | "rotated_at"
  | "removed_at"
  | "validation_state"
  | "validated_at"
  | "confidence"
>;

/** The two validation states that constitute a MEASUREMENT — decision 2. */
const MEASURED_STATES: ReadonlySet<string> = new Set(["VALID", "INVALID"]);

/** The label a null/blank axis value lands under in `bySegment` — never an empty string. */
export const SEGMENT_NONE = "(none)";

/** The default revocation target, in days. A chosen operational goal — see decision 7. */
export const DEFAULT_REVOKE_SLA_DAYS = 7;

/** Uppercased, trimmed validation state; "" when the column is missing or blank. */
function stateOf(row: SecretRow): string {
  return present(row.validation_state) ? String(row.validation_state).trim().toUpperCase() : "";
}

function isMeasured(row: SecretRow): boolean {
  return MEASURED_STATES.has(stateOf(row));
}

/** Split a ledger into the secrets rows and the count of rows this module ignored. */
function secretsOnly(rows: readonly SecretRow[]): {
  rows: SecretRow[];
  ignoredOtherScopes: number;
} {
  const kept: SecretRow[] = [];
  let ignored = 0;
  for (const row of rows) {
    if (row.scope === "secrets") kept.push(row);
    else ignored += 1;
  }
  return { rows: kept, ignoredOtherScopes: ignored };
}

/** Percentage 0..100, or null when the denominator is zero — decision 11. */
function pct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

// --------------------------------------------------------------------------- #
//  Has anybody looked?
// --------------------------------------------------------------------------- #

export interface ValidationCoverage {
  measured: number; // validation_state VALID or INVALID
  unmeasured: number; // UNKNOWN / ERROR / null / blank
  total: number; // secrets-scope rows seen — the denominator
  coveragePct: number | null; // measured / total, null when total is 0
  ignoredOtherScopes: number;
}

/**
 * How much of the secrets register has actually been validated. This is the denominator every
 * other figure here is read against: a 3-day median time-to-revoke over 0.4% coverage is a
 * statement about four rows, not about the estate, and the page has to be able to say so.
 */
export function validationCoverage(rows: readonly SecretRow[]): ValidationCoverage {
  const { rows: secrets, ignoredOtherScopes } = secretsOnly(rows);
  let measured = 0;
  for (const row of secrets) if (isMeasured(row)) measured += 1;
  return {
    measured,
    unmeasured: secrets.length - measured,
    total: secrets.length,
    coveragePct: pct(measured, secrets.length),
    ignoredOtherScopes,
  };
}

export interface PostDetectionValidity {
  valid: number; // still works
  invalid: number; // confirmed dead
  measured: number; // the denominator: valid + invalid
  ratePct: number | null; // valid / measured, null when nothing was measured
}

/**
 * Of the credentials somebody actually checked, what share still WORKS. The number that says
 * whether detection is followed by revocation at all — a high rate means the register is
 * finding live credentials and nobody is killing them. Unmeasured rows are not in the
 * denominator: they would drag the rate toward zero while representing no evidence either way.
 */
export function postDetectionValidityRate(rows: readonly SecretRow[]): PostDetectionValidity {
  const { rows: secrets } = secretsOnly(rows);
  let valid = 0;
  let invalid = 0;
  for (const row of secrets) {
    const state = stateOf(row);
    if (state === "VALID") valid += 1;
    else if (state === "INVALID") invalid += 1;
  }
  const measured = valid + invalid;
  return { valid, invalid, measured, ratePct: pct(valid, measured) };
}

// --------------------------------------------------------------------------- #
//  Time to revoke
// --------------------------------------------------------------------------- #

export interface TimeToRevokeOptions {
  /** Epoch ms the censored side is measured to. Explicit so the figure is reproducible. */
  now: number;
  /** Revocation target in days. A chosen operational goal, not a measurement — decision 7. */
  sla?: number;
}

export interface TimeToRevoke {
  km: KMResult; // the full survival estimate; km.total === events + censored
  median: number | null; // days; null when the curve never reaches half
  p90: number | null; // days; null when survival never falls to 0.10
  medianLowerBound: number | null; // max observed time when the median is unreachable
  events: number; // rotations observed (rotated_at set and timeable)
  censored: number; // measured-live credentials with no confirmed death — the open exposure
  excludedUnmeasured: number; // nobody ever checked these — decision 3
  excludedNoClock: number; // measured, but no usable duration — decision 6
  total: number; // secrets-scope rows seen; the four counts above sum to it
  withinSlaPct: number | null; // share of EVENTS with mttr <= sla; null when there are none
  sla: number;
  ignoredOtherScopes: number;
}

/**
 * Kaplan–Meier time-to-revoke: detection (`first_seen`) to confirmed-invalid (`rotated_at`),
 * with still-live credentials right-censored at `now − first_seen`.
 *
 * The estimate is computed by RE-PROJECTING secrets rows into `RemediationRow` and handing
 * them to the shared `kaplanMeier` engine — one estimator for the whole product, rather than
 * a second implementation of the same staircase that could drift from it. The projection is
 * deliberate and lossy in one direction: the synthesised `status` is RESOLVED/OPEN according
 * to whether the CREDENTIAL is dead, which is not the ledger's `status` column (decision 4),
 * and `severity` is projected as null because the engine never reads it.
 *
 * There is no separate open-exposure figure: `censored` IS the open exposure (decision 8).
 */
export function timeToRevoke(rows: readonly SecretRow[], opts: TimeToRevokeOptions): TimeToRevoke {
  const { rows: secrets, ignoredOtherScopes } = secretsOnly(rows);
  const sla = opts.sla ?? DEFAULT_REVOKE_SLA_DAYS;

  const projected: RemediationRow[] = [];
  const eventDays: number[] = [];
  let excludedUnmeasured = 0;
  let excludedNoClock = 0;

  for (const row of secrets) {
    const state = stateOf(row);
    if (!MEASURED_STATES.has(state)) {
      excludedUnmeasured += 1;
      continue;
    }
    const born = parseTs(row.first_seen);
    if (born === null) {
      excludedNoClock += 1;
      continue;
    }
    const died = parseTs(row.rotated_at);
    if (died !== null) {
      const days = (died - born) / DAY_MS;
      if (!Number.isFinite(days) || days < 0) {
        excludedNoClock += 1;
        continue;
      }
      eventDays.push(days);
      projected.push({
        severity: null,
        status: STATUS_RESOLVED,
        mttr_days: days,
        age_days: null,
      });
      continue;
    }
    // INVALID with no rotated_at: known dead, UNDATED. It cannot be an event (there is no
    // duration to place on the curve) and it must not be censored either — censoring asserts
    // "still alive at time c", which is precisely what INVALID contradicts. The ledger sets
    // rotated_at from validated_at on the first INVALID, so this should be empty; when it is
    // not, it is a ledger defect and it surfaces as a count rather than padding the risk set.
    if (state === "INVALID") {
      excludedNoClock += 1;
      continue;
    }
    const age = (opts.now - born) / DAY_MS;
    if (!Number.isFinite(age) || age < 0) {
      excludedNoClock += 1;
      continue;
    }
    projected.push({ severity: null, status: STATUS_OPEN, mttr_days: null, age_days: age });
  }

  const km = kaplanMeier(projected);
  let withinSla = 0;
  for (const d of eventDays) if (d <= sla) withinSla += 1;

  return {
    km,
    median: km.median,
    p90: kmQuantileFromCurve(km.curve, 0.9),
    medianLowerBound: km.medianLowerBound,
    events: km.events,
    censored: km.censored,
    excludedUnmeasured,
    excludedNoClock,
    total: secrets.length,
    withinSlaPct: pct(withinSla, eventDays.length),
    sla,
    ignoredOtherScopes,
  };
}

// --------------------------------------------------------------------------- #
//  Removed is not rotated
// --------------------------------------------------------------------------- #

export interface RemovalVsRotation {
  removedAndRotated: number; // string gone, credential confirmed dead — the only clean cell
  removedNotRotated: number; // THE HERO: gone from the code, nobody confirmed it is dead
  rotatedNotRemoved: number; // credential dead, string still committed
  neither: number; // still in the code, still unconfirmed
  total: number;
}

/**
 * The 2x2 of the register's two independent events. `removed_at` says the string left HEAD;
 * `rotated_at` says the credential was observed dead. They are not the same event and they do
 * not imply one another, which is why the ledger carries both columns and why this table is
 * the shape it is. `removedNotRotated` is what the page leads with (decision 9).
 *
 * Over ALL secrets rows — measured or not — because the question here is about the two dates,
 * not about whether the credential was validated.
 */
export function removalVsRotation(rows: readonly SecretRow[]): RemovalVsRotation {
  const { rows: secrets } = secretsOnly(rows);
  const out: RemovalVsRotation = {
    removedAndRotated: 0,
    removedNotRotated: 0,
    rotatedNotRemoved: 0,
    neither: 0,
    total: secrets.length,
  };
  for (const row of secrets) {
    const removed = present(row.removed_at);
    const rotated = present(row.rotated_at);
    if (removed && rotated) out.removedAndRotated += 1;
    else if (removed) out.removedNotRotated += 1;
    else if (rotated) out.rotatedNotRemoved += 1;
    else out.neither += 1;
  }
  return out;
}

// --------------------------------------------------------------------------- #
//  Segmentation — on the axes that speak to "is the credential live"
// --------------------------------------------------------------------------- #

/**
 * The axes this register may be segmented by. `severity` is absent ON PURPOSE and its
 * absence is the type-level half of decision 10; `bySegment` throws on it at runtime too,
 * for callers that reach the function through a cast or from untyped JS.
 */
export type SegmentAxis = "validation_state" | "confidence" | "secret_kind";

export interface SegmentStat {
  segment: string; // the axis value, or SEGMENT_NONE for null/blank
  total: number;
  // The FINDING's state (ledger `status`), not the credential's — a row can be open here and
  // rotated, or resolved here and still live. Both columns are reported for exactly that reason.
  open: number;
  measured: number;
  valid: number;
  invalid: number;
  rotated: number;
  removed: number;
  removedNotRotated: number;
}

/** The refusal message for the severity axis — pinned by test/secretsLifecycle.test.ts. */
export const SEVERITY_AXIS_REFUSAL =
  'bySegment: "severity" is not a valid axis for the secrets register — severity grades a ' +
  "detection, not whether a credential is live. Segment by validation_state, confidence or " +
  "secret_kind instead.";

/**
 * Per-segment counts on one of the three permitted axes, sorted by `total` descending and
 * then by segment name ascending so ties are stable rather than input-ordered.
 *
 * Every segment carries its own denominator (`total`) and its own coverage (`measured`),
 * because a segment with 400 rows and 2 measurements is a different claim from one with 400
 * rows and 400 measurements, and a bare rotation count cannot tell them apart.
 */
export function bySegment(rows: readonly SecretRow[], axis: SegmentAxis): SegmentStat[] {
  if ((axis as string) === "severity") throw new Error(SEVERITY_AXIS_REFUSAL);
  const { rows: secrets } = secretsOnly(rows);
  const buckets = new Map<string, SegmentStat>();
  for (const row of secrets) {
    const raw = row[axis];
    const key = present(raw) ? String(raw).trim() : SEGMENT_NONE;
    let stat = buckets.get(key);
    if (!stat) {
      stat = {
        segment: key,
        total: 0,
        open: 0,
        measured: 0,
        valid: 0,
        invalid: 0,
        rotated: 0,
        removed: 0,
        removedNotRotated: 0,
      };
      buckets.set(key, stat);
    }
    stat.total += 1;
    if (!RESOLVED_STATUSES.has(String(row.status ?? "").toUpperCase())) stat.open += 1;
    const state = stateOf(row);
    if (MEASURED_STATES.has(state)) stat.measured += 1;
    if (state === "VALID") stat.valid += 1;
    else if (state === "INVALID") stat.invalid += 1;
    const rotated = present(row.rotated_at);
    const removed = present(row.removed_at);
    if (rotated) stat.rotated += 1;
    if (removed) stat.removed += 1;
    if (removed && !rotated) stat.removedNotRotated += 1;
  }
  return [...buckets.values()].sort((a, b) => cmp(b.total, a.total) || cmp(a.segment, b.segment));
}

// --------------------------------------------------------------------------- #
//  The twin fold, reported rather than performed
// --------------------------------------------------------------------------- #

/**
 * What the ledger key's repository/branch fold recorded. Produced by reconcile.ts when the
 * rows are keyed; this module only renders it (decision 12).
 *
 *   keys           (secretDataId, path, lineNumber) keys seen under BOTH resource types
 *   folded         duplicate rows the fold removed
 *   medianGapDays  median disagreement between the twins' birth dates, in days
 */
export interface TwinStats {
  keys: number;
  folded: number;
  medianGapDays: number | null;
}

export interface TwinAudit {
  sentence: string;
  keys: number | null;
  folded: number | null;
  medianGapDays: number | null;
}

/** One decimal, trailing ".0" dropped — 19.9 stays 19.9, 20.0 renders as 20. */
function fmtDays(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * The measurement note that goes under the secrets pages: how many credentials Wiz reported
 * twice (once against the repository, once against a branch), and by how much the two copies'
 * birth dates disagreed. PROBE_FINDINGS.md §10.6/§10.7 measured 187 such keys with a median
 * gap of 19.9 days and a max of 285.3, which is why the ledger folds on the triple and takes
 * the earliest date — this sentence is how the reader learns that happened to their data.
 *
 * Given null it says NO STATISTICS WERE RECORDED. It does not print zeros: "0 twins" is a
 * measurement, and a sync that never counted has not made one.
 */
export function twinAudit(twinStats: TwinStats | null): TwinAudit {
  if (twinStats === null) {
    return {
      sentence: "No twin statistics were recorded for this sync.",
      keys: null,
      folded: null,
      medianGapDays: null,
    };
  }
  const { keys, folded, medianGapDays } = twinStats;
  if (keys === 0) {
    return {
      sentence: "No credential was seen on both the repository and a branch in this sync.",
      keys,
      folded,
      medianGapDays,
    };
  }
  const credentials = keys === 1 ? "1 credential was" : `${keys} credentials were`;
  const dupes = folded === 1 ? "1 duplicate row removed" : `${folded} duplicate rows removed`;
  const gap =
    medianGapDays === null
      ? "no birth-date gap was recorded"
      : `the two birth dates differ by a median of ${fmtDays(medianGapDays)} d`;
  return {
    sentence:
      `${credentials} seen on both the repository and a branch and folded to one row each ` +
      `(${dupes}); ${gap}.`,
    keys,
    folded,
    medianGapDays,
  };
}
