// THE ISSUE HALF-LIFE — a Kaplan-Meier survival curve over the lifecycle ledger, and the
// figure `measureSpec.ts` refused to publish until it existed.
//
// WHAT WAS REFUSED, AND WHY THIS IS NOT THAT. `measureSpec.ts`'s own header still refuses a
// MEAN over closed issues, and that refusal has not moved: a mean over the rows that closed
// silently drops every row that has not, and the rows that have not closed are the ones the
// figure exists to catch. It understates itself by exactly the population it cannot see, and
// nothing about the number says so. What that refusal named as the prerequisite was "a
// median-with-censoring or a survival curve", and this file is it: every still-open issue
// stays IN the estimate as a right-censored observation — it contributes its whole observed
// lifetime to the risk set and never a close date it does not have.
//
// THE CLOCK STARTS WHERE THIS REGISTER STARTED LOOKING. `t` is measured from
// `firstSeenAt` — the ledger's OWN first sighting — and never from Wiz's `createdAt`, which
// this ledger also stores and which can predate the tab by a year (`issueLedger.ts` says so
// in as many words, and the dry-run fixture seeds `iss-gone-NN` rows whose `createdAt` sits
// exactly 365 days before their first sighting so that a reading off the wrong date is
// visible rather than plausible). This module never reads `createdAt`. It never reads
// `Date.now()` either: a censored row's time runs to its LAST SIGHTING, not to today, which
// is what keeps the whole figure time-invariant per data version — `readModelStore.ts`'s
// own eligibility rule for anything cached durably, and the only way one page reloaded twice
// in a session shows one number.
//
// THE DEATH DATE IS AN UPPER BOUND, and the curve inherits that. `disappearedAt` is the
// timestamp of the sync that first FAILED to see the row, so every event time here is at
// most one sync interval too long. That is a property of the register (Wiz never tells it an
// issue was fixed — the query gate drops the row before `resolvedAt` can be read), not of
// this estimator, and the surfaces that draw the figure carry the word "gone by" for it.
//
// A REOPENED ROW IS EXCLUDED AND COUNTED, and that is a limit of the LEDGER, not a choice
// made here. `reconcileIssueLedger` clears `disappearedAt` and bumps `episode` on a reopen
// WITHOUT stamping when the new episode began, so a row at `episode: 2` has one birth date
// (its first ever sighting) and no record of where its current episode started. Measuring
// `disappearedAt - firstSeenAt` across such a row would price the gap between episodes as
// part of the lifetime, and censoring it at `lastSeenAt` would claim an unbroken open run
// that the ledger knows was broken. Both are wrong in the same direction, so the row leaves
// the estimate and `returnedExcluded` says how many did — a count beside the figure, never a
// silent drop. The `episode` help entry states the same limit from the reader's side.
//
// ABSENT IS NEVER ZERO, twice over. `Number(null)` is 0 AND finite, `Date.parse("")` is NaN,
// and a row whose dates do not parse is dropped into `unmeasurable` BEFORE any arithmetic
// touches it — never folded to epoch 0, which would enter the curve as an event roughly
// twenty thousand days long and drag every quantile with it. The test reproduces exactly
// that defective fold inline and shows it failing.

import { parseTs, toIso } from "./util";

/**
 * How far above a threshold a survival value may sit and still count as having crossed it.
 *
 * S(t) IS A RUNNING PRODUCT, so a curve that mathematically lands ON a threshold can land one
 * ULP above it. CLAUDE.md's own example, which `test/issueSurvival.test.ts` runs: ten events
 * at times 1..10 with no censoring gives S(9) = 0.10000000000000002, while the p90 threshold
 * `1 - 0.9` evaluates to 0.09999999999999998 — two separate representation errors leaning
 * opposite ways — so a bare `s <= threshold` skips t=9 and reports 10. The answer would then
 * depend on the ORDER the products accumulated in, which is not a property any published
 * figure may have.
 *
 * DEFINED HERE, and that is worth saying: CLAUDE.md's DevSecOps section claims this constant
 * lives in `gas_devsecops/src/domain/remediation.ts`. It does not — that file (and `gas`'s)
 * compares bare, and both still do. This is the first definition of it in the repo.
 */
export const CROSSING_EPSILON = 1e-9;

const DAY_MS = 86_400_000;

/** One step of the staircase: S(t) after the drop at t, the risk set just before it, and how
 * many events landed on it. The anchor S(0) = 1 is implicit and not stored. */
export interface KMPoint {
  t: number;
  s: number;
  atRisk: number;
  events: number;
}

/** One observation entering the estimate: a lifetime in days, and whether it ENDED there. */
export interface SurvivalObservation {
  t: number;
  /** True for a dated departure; false for a row still open at its last sighting. */
  event: boolean;
}

export interface KMResult {
  curve: KMPoint[];
  /** Smallest event time with S(t) <= 0.5, or null when the curve never falls that far. */
  median: number | null;
  /** The longest observed lifetime, published INSTEAD of a median when there is none. */
  medianLowerBound: number | null;
  /** Smallest event time with S(t) <= 0.10 — nine issues in ten gone by. Null likewise. */
  p90: number | null;
  events: number;
  censored: number;
  total: number;
}

/** The ledger fields this estimate reads, and no others. Both `IssueLedgerRow` and the public
 * projection `api.ts` hands the client satisfy it; `createdAt` is deliberately not in it. */
export interface SurvivalLedgerRow {
  firstSeenAt: string;
  lastSeenAt: string;
  disappearedAt: string | null;
  episode: number;
}

export interface LedgerObservations {
  obs: SurvivalObservation[];
  /** Rows at `episode > 1` — measurable in principle, unmeasurable by THIS ledger. */
  returnedExcluded: number;
  /** Rows whose own dates would not parse, or whose episode is not a number. */
  unmeasurable: number;
}

export interface IssueHalfLife extends KMResult {
  returnedExcluded: number;
  unmeasurable: number;
  /**
   * The latest instant any row in the ledger was observed at — the newest `lastSeenAt` or
   * `disappearedAt` across every row, including the ones the estimate excluded.
   *
   * The figure's own "as of", derived from the data rather than from a clock, so a page can
   * say when the curve was last able to move without this module reading the time.
   */
  asOf: string | null;
}

/**
 * The Kaplan-Meier survival staircase over `events` (departure times) against `times` (the
 * WHOLE risk set — every observation, departed or still open).
 *
 * One point per distinct event time ascending: `atRisk` counts observations still at risk at
 * t (`#{time >= t}`), `d` counts events landing exactly on t, and S(t) is the running product
 * of `1 - d/atRisk`. A distinct event time whose risk set has already emptied is skipped
 * rather than dividing by zero — reachable only when a censored observation ties it exactly.
 */
export function kmCurve(events: readonly number[], times: readonly number[]): KMPoint[] {
  const curve: KMPoint[] = [];
  let s = 1;
  for (const t of [...new Set(events)].sort((a, b) => a - b)) {
    const atRisk = times.filter((x) => x >= t).length;
    if (atRisk === 0) continue;
    const d = events.filter((x) => x === t).length;
    s *= 1 - d / atRisk;
    curve.push({ t, s, atRisk, events: d });
  }
  return curve;
}

/**
 * The q-th quantile off a curve: the smallest event time whose survival has fallen to
 * `S(t) <= 1 - q`, within CROSSING_EPSILON.
 *
 * q = 0.5 is the median (the half-life: the point by which half the issues the register has
 * ever recorded were gone); q = 0.9 is the p90. Null when survival never falls that far,
 * which under heavy censoring is the ordinary case and is a fact about the register rather
 * than a failure — the caller publishes `medianLowerBound` in its place, never a fabricated
 * number.
 */
export function kmQuantileFromCurve(curve: readonly KMPoint[], q: number): number | null {
  const threshold = 1 - q;
  for (const p of curve) if (p.s <= threshold + CROSSING_EPSILON) return p.t;
  return null;
}

/** The median off a curve — the half-life. See `kmQuantileFromCurve`. */
export function kmMedianFromCurve(curve: readonly KMPoint[]): number | null {
  return kmQuantileFromCurve(curve, 0.5);
}

/**
 * Kaplan-Meier over ready-made observations.
 *
 * `medianLowerBound` carries the longest observed lifetime whenever the median is null, so a
 * surface can say "at least N days" rather than an em dash — the curve genuinely did not
 * reach half, and the largest time it DID reach is a measurement. When the median is known
 * the lower bound is null: publishing both would invite a reader to compare a figure against
 * its own floor.
 *
 * No events at all (an empty ledger, or one nothing has ever left) still fills the counts and
 * the lower bound; the curve is empty and both quantiles are null.
 */
export function kaplanMeier(observations: readonly SurvivalObservation[]): KMResult {
  const events: number[] = [];
  const times: number[] = [];
  let censored = 0;
  for (const o of observations) {
    // Guarded rather than assumed: `ledgerObservations` below only ever emits finite times,
    // but this function is exported and a caller building its own observations is exactly
    // where a NaN would enter and poison every product downstream of it.
    if (!Number.isFinite(o.t)) continue;
    times.push(o.t);
    if (o.event) events.push(o.t);
    else censored += 1;
  }

  // Folded rather than `Math.max(...times)`: one entry per ledger row, and spreading a large
  // register into a call blows the argument limit (`util.ts` makes the same choice).
  let longest: number | null = null;
  for (const t of times) if (longest === null || t > longest) longest = t;

  if (!events.length) {
    return {
      curve: [],
      median: null,
      medianLowerBound: longest,
      p90: null,
      events: 0,
      censored,
      total: times.length,
    };
  }

  const curve = kmCurve(events, times);
  const median = kmMedianFromCurve(curve);
  return {
    curve,
    median,
    medianLowerBound: median === null ? longest : null,
    p90: kmQuantileFromCurve(curve, 0.9),
    events: events.length,
    censored,
    total: times.length,
  };
}

/**
 * Days between two instants, refusing both BEFORE any arithmetic.
 *
 * `parseTs` already refuses null, undefined, blank and unparsable strings rather than casting
 * them — the whole reason it is used here instead of `new Date(x).getTime()`, which turns a
 * missing date into NaN only sometimes and a numeric-looking one into a silent success.
 * A negative span (a departure dated before the first sighting) is refused too: it is a
 * corrupt row, not a zero-day fix.
 */
function spanDays(fromIso: unknown, toIsoValue: unknown): number | null {
  const from = parseTs(fromIso);
  const to = parseTs(toIsoValue);
  if (from === null || to === null) return null;
  const days = (to - from) / DAY_MS;
  if (!Number.isFinite(days) || days < 0) return null;
  return days;
}

/**
 * The ledger as survival observations.
 *
 * Every row at `episode === 1` becomes one observation: an EVENT at
 * `disappearedAt - firstSeenAt` when the row has been dated gone, and a CENSORED observation
 * at `lastSeenAt - firstSeenAt` otherwise. The censoring time is the last sighting and never
 * "now" — see this file's header on time-invariance.
 *
 * Rows at `episode > 1` are counted in `returnedExcluded` and never measured (the header says
 * why). Rows whose dates or episode do not parse are counted in `unmeasurable`. Both counts
 * ship beside the figure, because a row this estimate could not read is a fact about the
 * estimate and a page that showed only the survivors would be describing a population it
 * quietly chose.
 */
export function ledgerObservations(
  ledger: readonly SurvivalLedgerRow[],
): LedgerObservations {
  const obs: SurvivalObservation[] = [];
  let returnedExcluded = 0;
  let unmeasurable = 0;

  for (const row of ledger) {
    // Refused before the comparison, not after: `Number(null)` is 0 and IS finite, so a cast
    // here would read a row with no episode at all as a legitimate value below 1.
    const episode = row ? row.episode : undefined;
    if (typeof episode !== "number" || !Number.isFinite(episode)) {
      unmeasurable += 1;
      continue;
    }
    if (episode > 1) {
      returnedExcluded += 1;
      continue;
    }

    const gone = row.disappearedAt;
    // `!= null` rather than a truthiness test: an empty-string cell is not a departure, and
    // it must reach the `unmeasurable` count rather than being read as "still open".
    if (gone !== null && gone !== undefined) {
      const t = spanDays(row.firstSeenAt, gone);
      if (t === null) unmeasurable += 1;
      else obs.push({ t, event: true });
      continue;
    }

    const t = spanDays(row.firstSeenAt, row.lastSeenAt);
    if (t === null) unmeasurable += 1;
    else obs.push({ t, event: false });
  }

  return { obs, returnedExcluded, unmeasurable };
}

/**
 * The published figure: the survival curve over the whole lifecycle ledger, the two counts of
 * what it could not measure, and the instant it was last able to move.
 *
 * A HALF-LIFE, NOT AN AVERAGE. The headline is the median — the point by which half of every
 * issue this register has ever recorded had left it — and where the curve never falls that
 * far (the ordinary case on a young register, where most rows are still open) `median` is
 * null and `medianLowerBound` carries the longest lifetime actually observed. "At least N
 * days" is a measurement; a number invented to fill the gap is not.
 */
export function issueHalfLife(ledger: readonly SurvivalLedgerRow[]): IssueHalfLife {
  const { obs, returnedExcluded, unmeasurable } = ledgerObservations(ledger);

  // The newest instant any row was observed at, over EVERY row — including the reopened and
  // the unreadable ones, because "when could this figure last have moved" is a question about
  // the ledger, not about the subset that entered the curve.
  let latest: number | null = null;
  for (const row of ledger) {
    if (!row) continue;
    for (const value of [row.lastSeenAt, row.disappearedAt]) {
      const ts = parseTs(value);
      if (ts !== null && (latest === null || ts > latest)) latest = ts;
    }
  }

  return {
    ...kaplanMeier(obs),
    returnedExcluded,
    unmeasurable,
    asOf: toIso(latest),
  };
}
