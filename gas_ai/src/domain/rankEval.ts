// DOES THE RANK PUT THE RIGHT THING FIRST — measured against the register's own history,
// with the label it actually has rather than the one it would like.
//
// WHAT THE LABEL IS, AND WHAT IT IS NOT. The only outcome this register can observe is a
// DISAPPEARANCE: `ai_issues` is overwritten every sync and gated to OPEN + IN_PROGRESS, so a
// remediated issue vanishes and `issueLedger.ts` dates that vanishing. "Resolved by t+h"
// therefore means `disappearedAt <= t+h` and nothing stronger — an upper bound whose error is
// the sync interval. Every figure below inherits that, which is why the report leads with the
// honesty block instead of the numbers.
//
// AND A ROW WHOSE WINDOW HAS NOT CLOSED IS UNKNOWN, NEVER "NOT REMEDIATED". If `t+h` runs
// past the last sync that could have seen the row leave, the register has not finished
// looking, and reading that silence as "still open" is the single failure that would make
// every precision figure here flatter and more confident than the evidence. Unknowns are
// counted, published beside the number they are missing from, and widen the coverage and
// efficiency brackets in both directions. The point estimate is computed over LABELLED rows
// only and the unknowns never move it — they only say how far it could be wrong.
//
// THE PAIR IS THE UNIT, AND A SCOPE CHANGE BREAKS IT. A sync `t` is evaluated only when the
// NEXT committed sync applied the same `register_scope`. The ledger already refuses to resolve
// by absence across a scope change (`reconcileIssueLedger`'s `scopeCovers` guard), so a pair
// spanning one carries labels the ledger deliberately declined to write; scoring against them
// would price the register's own refusal as a wave of non-remediation. The skipped pairs are
// counted rather than dropped in silence. An EMPTY scope is unknown and never "the same
// scope", for the reason `prevScopeSignature === null` skips one file over: a pair that cannot
// prove both syncs asked the same question is not a comparison.
//
// PORTED FROM `gas/src/domain/program.ts`, NOT IMPORTED — the OS-vulnerability register's
// `Rate`, its confusion matrix and its `finalize` bounds. Two registers, two schemas, and a
// shared module would make one's population change break the other's build; the same argument
// `rank.ts` makes for the exploitation ladder and `issueLedger.ts` makes for the scope guard.
//
// TWO DELIBERATE DIVERGENCES FROM THAT PORT, both stated here so a reader comparing the files
// does not read them as drift:
//
//   1. THE UNKNOWN AXIS IS TRANSPOSED. There, the CLASSIFICATION is what can be missing (a row
//      whose KEV/EPSS signals were never captured) and the outcome is always known. Here the
//      classification — is this row in the top k — is always known, and the OUTCOME is what can
//      be missing. So `unknownRemediated`/`unknownOpen` become `unknownHigh`/`unknownLow`, and
//      each bound is still the extreme re-labelling of those rows, which is what `finalize`
//      actually means.
//   2. EVERY PUBLISHED RATIO IS A FRACTION 0..1, where the port multiplies by 100. Precision@k
//      sits in the same table row as coverage and efficiency, and two units in one row is how a
//      reader misreads both. The bracket arithmetic is unchanged; only the scale is.
//
// NO CLOCK. `syncs` carry their own timestamps and the horizon is a parameter — the discipline
// `readModelStore.ts` states for the whole domain layer, and what makes a multi-sync history
// testable without a fake clock.

import type { IssueLedgerRow } from "./issueLedger";
import { DEFAULT_RANK_RULE, rankOne, type RankInput, type RankRule } from "./rank";
import { bootstrapCI, effectiveCardinality, kendallTauB, mulberry32, tieRate } from "./rankStats";
import { mean } from "./util";

const DAY_MS = 86400000;

/** Draws the random baseline averages over. Enough to steady the mean, cheap enough to run. */
const RANDOM_DRAWS = 20;

/** Resamples per bootstrap interval, matching the count the ordinality suites use. */
const BOOTSTRAP_SAMPLES = 200;

/** The interval needs a distribution to resample; below this it would be theatre. */
const MIN_SYNCS_FOR_CI = 3;

/** Any integer. Named so a caller that wants a different one has to say so out loud. */
export const DEFAULT_EVAL_SEED = 1234567;

/**
 * A rate with the bounds the unlabelled population implies — `program.ts`'s `Rate`, in
 * fractions rather than percentages (see the header).
 *
 * `point` is the rate over labelled rows only. `lo`/`hi` are what it would be if every
 * unlabelled row turned out to be the worst / best case for that rate. When nothing is
 * unlabelled, lo === point === hi; otherwise the width of the bracket IS the size of the
 * doubt, which makes the missing outcomes impossible to hide behind a confident figure.
 */
export interface Rate {
  point: number | null;
  lo: number | null;
  hi: number | null;
}

const NO_RATE: Rate = { point: null, lo: null, hi: null };

function frac(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

/** What the ledger can say about one row at one horizon. `unknown` is a third answer, not a no. */
export type EvalLabel = "resolved" | "open" | "unknown";

/**
 * The 2x2 over labelled rows, with the unlabelled ones kept OUTSIDE it so they can never be
 * mistaken for a quadrant.
 *
 * "At risk" here is the ranker's own claim — the row sits in the top k — so `coverage` reads
 * "of the rows this ranker put on top, how many left the register inside the horizon" and
 * `efficiency` reads "of the rows that left, how many the top k had caught". The port's words
 * are kept because the arithmetic and the bounds are the port's; what stands in for its
 * "high risk" is stated here rather than assumed from the name.
 */
export interface EvalMatrix {
  /** In the top k and gone by t+h — the ranker put the work first. */
  tp: number;
  /** Outside the top k and gone by t+h — remediation the ranking did not lead with. */
  fp: number;
  /** In the top k and still there at t+h — risk the ranker named and nobody cleared. */
  fn: number;
  /** Outside the top k and still there — correctly deprioritised. */
  tn: number;
  /** Top-k rows whose outcome the register has not finished observing. */
  unknownHigh: number;
  /** Rows outside the top k with the same gap. */
  unknownLow: number;
  labelled: number;
  unknown: number;
  total: number;
  resolved: number;
  open: number;
  atRisk: number;
  notAtRisk: number;
  coverage: Rate;
  efficiency: Rate;
  /**
   * (tp + fn) / labelled — the share of labelled rows the top k covers, which is exactly the
   * efficiency a ranker choosing AT RANDOM would score. The same reading `program.ts` gives
   * its `prevalence`: an efficiency at or below this means the ordering is not ordering.
   */
  prevalence: number | null;
  /**
   * labelled / total — the honesty number every rate above is conditional on. Named for the
   * LABEL rather than the port's `signalCoveragePct`, because what is missing here is the
   * outcome, not the classifier's input.
   */
  labelCoverage: number | null;
}

function emptyMatrix(): EvalMatrix {
  return {
    tp: 0, fp: 0, fn: 0, tn: 0,
    unknownHigh: 0, unknownLow: 0,
    labelled: 0, unknown: 0, total: 0,
    resolved: 0, open: 0, atRisk: 0, notAtRisk: 0,
    coverage: NO_RATE, efficiency: NO_RATE,
    prevalence: null, labelCoverage: null,
  };
}

/**
 * Finalize a matrix whose six counts are filled — `program.ts`'s `finalize`, transposed onto
 * the unknown outcome.
 *
 *   coverage = tp / (tp + fn)
 *     lo   every unknown TOP-K row was really still open (they join fn, the worst case)
 *     hi   every unknown TOP-K row was really gone       (they join tp)
 *     Rows outside the top k cannot move it in either direction.
 *
 *   efficiency = tp / (tp + fp)
 *     lo   every unknown row OUTSIDE the top k was really gone (they join fp) and every
 *          unknown top-k row was really open
 *     hi   the mirror: unknown top-k rows gone, unknown outside rows open
 */
function finalize(m: EvalMatrix): EvalMatrix {
  m.labelled = m.tp + m.fp + m.fn + m.tn;
  m.unknown = m.unknownHigh + m.unknownLow;
  m.total = m.labelled + m.unknown;
  m.resolved = m.tp + m.fp;
  m.open = m.fn + m.tn;
  m.atRisk = m.tp + m.fn;
  m.notAtRisk = m.fp + m.tn;
  m.coverage = {
    point: frac(m.tp, m.tp + m.fn),
    lo: frac(m.tp, m.tp + m.fn + m.unknownHigh),
    hi: frac(m.tp + m.unknownHigh, m.tp + m.unknownHigh + m.fn),
  };
  m.efficiency = {
    point: frac(m.tp, m.tp + m.fp),
    lo: frac(m.tp, m.tp + m.fp + m.unknownLow),
    hi: frac(m.tp + m.unknownHigh, m.tp + m.unknownHigh + m.fp),
  };
  m.prevalence = frac(m.atRisk, m.labelled);
  m.labelCoverage = frac(m.labelled, m.total);
  return m;
}

/**
 * Precision at one cut of the queue.
 *
 * `precision` is computed over the LABELLED rows in the top k, and `unknownInTopK` is what it
 * was computed without. `applicable` is false when k exceeds the population: a precision@100
 * answered by taking 40 rows is a precision@40 wearing the wrong name, so it is refused rather
 * than silently narrowed.
 */
export interface PrecisionAtK {
  k: number;
  precision: number | null;
  resolvedInTopK: number;
  labelledInTopK: number;
  unknownInTopK: number;
  applicable: boolean;
}

/** One evaluated sync: the queue as it stood at `at`, judged at `at + horizonDays`. */
export interface RankEvalPoint {
  syncId: string;
  at: string;
  horizonEndsAt: string;
  /** The sync that proved the pair comparable by applying the same scope. */
  nextSyncId: string;
  registerScope: string;
  population: number;
  labelled: number;
  unknown: number;
  resolved: number;
  open: number;
  precisionAtK: PrecisionAtK[];
  /** The largest requested k that fits the population — what the matrix calls "at risk". */
  kAtRisk: number | null;
  matrix: EvalMatrix;
  /** Share of pairs this basis cannot separate at this sync; 1.0 is a basis that ranks nothing. */
  tieRate: number;
  effectiveCardinality: number;
  /** Rank agreement with the previous evaluated sync, over the ids both populations hold. */
  tau: number | null;
  tauCommonIds: number;
}

export interface MeanPrecision {
  k: number;
  mean: number | null;
  /** How many evaluated syncs answered this k. A mean of one sync is one sync. */
  n: number;
  ci: { lo: number; hi: number } | null;
}

/** One ordering, evaluated over every comparable sync. */
export interface RankEvalBasis {
  key: string;
  label: string;
  note: string;
  points: RankEvalPoint[];
  meanPrecisionAtK: MeanPrecision[];
  /** Counts pooled across the evaluated syncs, then finalized once. */
  matrix: EvalMatrix;
  meanTieRate: number | null;
  meanEffectiveCardinality: number | null;
  meanTau: number | null;
  tauN: number;
}

export interface RankEvalReport {
  /** False whenever there is nothing to measure. The bases are then null, not zeroed. */
  computed: boolean;
  /** What has to happen before a figure exists, in a sentence a reader can act on. */
  waitingFor: string | null;
  horizonDays: number;
  ks: number[];
  seed: number;
  syncsAvailable: number;
  comparablePairs: number;
  /** Adjacent syncs that applied DIFFERENT scopes — every one is a pair not measured. */
  scopeChanges: number;
  /** Adjacent syncs where either scope is blank: unknown, and never read as "the same". */
  unknownScopePairs: number;
  /** Every row the ledger holds, whether or not any evaluated sync could see it. */
  totalRows: number;
  /** Rows that entered at least one evaluated population. */
  evaluatedRows: number;
  /** Of those, the ones the register finished observing at least once. */
  labelledRows: number;
  /** Of those, the ones it never did. `labelledRows + unknownRows === evaluatedRows`. */
  unknownRows: number;
  lastSyncAt: string | null;
  candidate: RankEvalBasis | null;
  baselines: {
    rankV1: RankEvalBasis | null;
    dueAtOnly: RankEvalBasis | null;
    random: RankEvalBasis | null;
    /** Always null here — see `severityOnlyNote`. */
    severityOnly: null;
  };
  severityOnlyNote: string;
}

export interface RankEvalSync {
  syncId: string;
  finishedAt: string;
  registerScope: string;
}

export interface RankEvalInput {
  ledger: readonly IssueLedgerRow[];
  syncs: readonly RankEvalSync[];
  rule: RankRule;
  horizonDays: number;
  ks: readonly number[];
  seed?: number;
}

/**
 * The severity baseline cannot be run, and this says so instead of returning a zero.
 *
 * `IssueLedgerRow` freezes the rank inputs and nothing else; severity is not among them.
 * Widening the ledger tab to carry it is a schema change with its own no-migration contract
 * and belongs in its own round — reporting an unmeasurable baseline as `null` with a reason is
 * the honest half of that.
 */
export const SEVERITY_ONLY_NOTE =
  "Not measured: the lifecycle ledger freezes the rank inputs only, and Wiz's severity is not "
  + "one of them. Ranking by severity would need a ledger column that does not exist yet.";

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(String(iso));
  return Number.isFinite(n) ? n : null;
}

/** The rank inputs a ledger row froze, with absent kept absent — `freezeInputs`' own pairing. */
function rankInputOf(row: IssueLedgerRow): RankInput {
  const out: RankInput = { id: row.issueId, ruleId: row.ruleId };
  if (row.dueAt) out.dueAt = row.dueAt;
  if (row.createdAt) out.createdAt = row.createdAt;
  if (row.aiAdjacency !== undefined) out.aiAdjacency = row.aiAdjacency;
  // The TIER is what says a fold ran, so the peak travels inside its guard, exactly as the
  // ledger writes it. A peak without a tier would be a probability nobody attributed.
  if (row.exploitationTier !== undefined) {
    out.exploitationTier = row.exploitationTier;
    out.epssPeak = row.epssPeak ?? null;
  }
  return out;
}

/**
 * A vector scorer: the whole population at once, so the random baseline can draw one stream
 * per (sync, draw) rather than one per row.
 */
type Scorer = (rows: readonly IssueLedgerRow[], atIso: string, pointIndex: number) => number[];

/**
 * An undated row's place on the `dueAtOnly` scale. Finite on purpose: `-Infinity` would make
 * `Math.sign(-Inf - -Inf)` NaN inside `kendallTauB`, turning "two undated rows are tied" into
 * a silently poisoned correlation.
 */
const UNDATED_SCORE = Number.MIN_SAFE_INTEGER;

function candidateScorer(rule: RankRule): Scorer {
  return (rows, atIso) => rows.map((r) => rankOne(rankInputOf(r), rule, atIso).score);
}

const dueAtScorer: Scorer = (rows) =>
  rows.map((r) => {
    const due = ms(r.dueAt);
    // Negated, so soonest-due sorts first on the same descending comparator every basis uses.
    return due === null ? UNDATED_SCORE : -due;
  });

/**
 * A fresh draw per (sync, draw), NOT one ordering reused across syncs.
 *
 * The difference is the whole reading of the tau column: a fixed random ordering agrees with
 * itself perfectly and would report tau 1, which says a random queue is as stable as a
 * reasoned one. Re-drawing each sync is what "picking at random" actually means, and its tau
 * lands near 0, which is the honest baseline for the candidate's own stability.
 */
function randomScorer(seed: number, draw: number): Scorer {
  return (rows, _atIso, pointIndex) => {
    const rng = mulberry32(seed + draw * 1000003 + pointIndex * 10007);
    return rows.map(() => rng());
  };
}

/** Descending score, ties broken by id — a deterministic queue, never an accidental one. */
function orderOf(rows: readonly IssueLedgerRow[], scores: readonly number[]): number[] {
  const idx = rows.map((_, i) => i);
  idx.sort((a, b) => {
    const d = scores[b]! - scores[a]!;
    if (d !== 0) return d < 0 ? -1 : 1;
    const ia = rows[a]!.issueId;
    const ib = rows[b]!.issueId;
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });
  return idx;
}

/** One comparable pair: the sync being ranked, and the population and labels it stands over. */
interface EvalWindow {
  sync: RankEvalSync;
  nextSyncId: string;
  atMs: number;
  horizonEndMs: number;
  rows: IssueLedgerRow[];
  labels: EvalLabel[];
}

function cleanKs(raw: readonly number[] | undefined): number[] {
  const out: number[] = [];
  for (const k of raw ?? []) {
    const n = Math.floor(Number(k));
    if (Number.isFinite(n) && n > 0 && out.indexOf(n) < 0) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

/** The evaluated syncs, in order, with the incomparable pairs counted rather than dropped. */
function comparableWindows(
  syncs: readonly RankEvalSync[],
  ledger: readonly IssueLedgerRow[],
  horizonDays: number,
): { windows: EvalWindow[]; scopeChanges: number; unknownScopePairs: number; ordered: RankEvalSync[] } {
  const ordered = (syncs ?? [])
    .filter((s) => s && s.syncId && ms(s.finishedAt) !== null)
    .slice()
    .sort((a, b) => ms(a.finishedAt)! - ms(b.finishedAt)!);

  // How late the register was still asking THIS scope's question. A row can only be observed
  // to leave by a sync that was looking for it, so an "open at t+h" claim needs a same-scope
  // sync at or after t+h; the ledger's own disappearance guard is the other half of this rule.
  const coverEnd: Record<string, number> = {};
  for (const s of ordered) {
    const scope = String(s.registerScope ?? "");
    if (!scope) continue;
    const at = ms(s.finishedAt)!;
    if (coverEnd[scope] === undefined || at > coverEnd[scope]!) coverEnd[scope] = at;
  }

  const windows: EvalWindow[] = [];
  let scopeChanges = 0;
  let unknownScopePairs = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    const sync = ordered[i]!;
    const next = ordered[i + 1]!;
    const scope = String(sync.registerScope ?? "");
    const nextScope = String(next.registerScope ?? "");
    if (!scope || !nextScope) {
      unknownScopePairs += 1;
      continue;
    }
    if (scope !== nextScope) {
      scopeChanges += 1;
      continue;
    }
    const atMs = ms(sync.finishedAt)!;
    const horizonEndMs = atMs + horizonDays * DAY_MS;
    const covered = coverEnd[scope] ?? null;
    const rows: IssueLedgerRow[] = [];
    const labels: EvalLabel[] = [];
    for (const row of ledger) {
      const first = ms(row.firstSeenAt);
      if (first === null || first > atMs) continue;
      const gone = ms(row.disappearedAt);
      if (gone !== null && gone <= atMs) continue; // already left before the queue was drawn
      rows.push(row);
      if (gone !== null && gone <= horizonEndMs) labels.push("resolved");
      else if (covered !== null && covered >= horizonEndMs) labels.push("open");
      else labels.push("unknown");
    }
    windows.push({ sync, nextSyncId: next.syncId, atMs, horizonEndMs, rows, labels });
  }
  return { windows, scopeChanges, unknownScopePairs, ordered };
}

function pointFor(
  window: EvalWindow,
  pointIndex: number,
  scorer: Scorer,
  ks: readonly number[],
  prev: { scores: Record<string, number> } | null,
): { point: RankEvalPoint; scores: Record<string, number> } {
  const { rows, labels } = window;
  const scores = scorer(rows, window.sync.finishedAt, pointIndex);
  const order = orderOf(rows, scores);

  const counts = { resolved: 0, open: 0, unknown: 0 };
  for (const l of labels) counts[l] += 1;

  const precisionAtK: PrecisionAtK[] = [];
  let kAtRisk: number | null = null;
  for (const k of ks) {
    if (k > rows.length) {
      precisionAtK.push({
        k, precision: null, resolvedInTopK: 0, labelledInTopK: 0, unknownInTopK: 0,
        applicable: false,
      });
      continue;
    }
    kAtRisk = k;
    let resolvedInTopK = 0;
    let labelledInTopK = 0;
    let unknownInTopK = 0;
    for (let i = 0; i < k; i++) {
      const label = labels[order[i]!]!;
      if (label === "unknown") unknownInTopK += 1;
      else {
        labelledInTopK += 1;
        if (label === "resolved") resolvedInTopK += 1;
      }
    }
    precisionAtK.push({
      k,
      precision: labelledInTopK > 0 ? resolvedInTopK / labelledInTopK : null,
      resolvedInTopK,
      labelledInTopK,
      unknownInTopK,
      applicable: true,
    });
  }

  const matrix = emptyMatrix();
  if (kAtRisk !== null) {
    const inTopK = new Array<boolean>(rows.length).fill(false);
    for (let i = 0; i < kAtRisk; i++) inTopK[order[i]!] = true;
    for (let i = 0; i < rows.length; i++) {
      const label = labels[i]!;
      if (label === "unknown") {
        if (inTopK[i]) matrix.unknownHigh += 1;
        else matrix.unknownLow += 1;
      } else if (label === "resolved") {
        if (inTopK[i]) matrix.tp += 1;
        else matrix.fp += 1;
      } else if (inTopK[i]) matrix.fn += 1;
      else matrix.tn += 1;
    }
  }
  finalize(matrix);

  // Agreement with the previous evaluated sync, over the ids both populations hold. Fewer
  // than two shared rows is no ranking to compare, which is a null rather than a 0.
  const byId: Record<string, number> = {};
  for (let i = 0; i < rows.length; i++) byId[rows[i]!.issueId] = scores[i]!;
  let tau: number | null = null;
  let tauCommonIds = 0;
  if (prev) {
    const a: number[] = [];
    const b: number[] = [];
    for (const id of Object.keys(byId)) {
      const before = prev.scores[id];
      if (before === undefined) continue;
      a.push(before);
      b.push(byId[id]!);
    }
    tauCommonIds = a.length;
    if (a.length >= 2) tau = kendallTauB(a, b);
  }

  return {
    point: {
      syncId: window.sync.syncId,
      at: window.sync.finishedAt,
      horizonEndsAt: new Date(window.horizonEndMs).toISOString(),
      nextSyncId: window.nextSyncId,
      registerScope: String(window.sync.registerScope ?? ""),
      population: rows.length,
      labelled: counts.resolved + counts.open,
      unknown: counts.unknown,
      resolved: counts.resolved,
      open: counts.open,
      precisionAtK,
      kAtRisk,
      matrix,
      tieRate: tieRate(scores.slice()),
      effectiveCardinality: effectiveCardinality(scores.slice()),
      tau,
      tauCommonIds,
    },
    scores: byId,
  };
}

/** Mean over the entries that have a value; null when none does. */
function meanOf(values: Array<number | null>): number | null {
  const kept = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return kept.length ? mean(kept) : null;
}

/** Pool the points into one basis: counts summed and finalized once, everything else averaged. */
function basisFrom(
  key: string,
  label: string,
  note: string,
  points: RankEvalPoint[],
  ks: readonly number[],
  seed: number,
): RankEvalBasis {
  const pooled = emptyMatrix();
  for (const p of points) {
    pooled.tp += p.matrix.tp;
    pooled.fp += p.matrix.fp;
    pooled.fn += p.matrix.fn;
    pooled.tn += p.matrix.tn;
    pooled.unknownHigh += p.matrix.unknownHigh;
    pooled.unknownLow += p.matrix.unknownLow;
  }
  finalize(pooled);

  const meanPrecisionAtK: MeanPrecision[] = ks.map((k) => {
    const values: number[] = [];
    for (const p of points) {
      const cut = p.precisionAtK.find((c) => c.k === k);
      if (cut && cut.precision !== null) values.push(cut.precision);
    }
    // The interval is over SYNCS, and below three of them a resampled distribution would be
    // three numbers wearing an error bar. `n` is published either way so the caller can see
    // what the mean is a mean of.
    const ci = values.length >= MIN_SYNCS_FOR_CI
      ? bootstrapCI(values, (sample) => mean(sample) ?? 0, BOOTSTRAP_SAMPLES, seed)
      : null;
    return { k, mean: values.length ? mean(values) : null, n: values.length, ci };
  });

  return {
    key,
    label,
    note,
    points,
    meanPrecisionAtK,
    matrix: pooled,
    meanTieRate: meanOf(points.map((p) => p.tieRate)),
    meanEffectiveCardinality: meanOf(points.map((p) => p.effectiveCardinality)),
    meanTau: meanOf(points.map((p) => p.tau)),
    tauN: points.filter((p) => p.tau !== null).length,
  };
}

/** Every point of one basis, in sync order, each carrying its tau against the one before it. */
function pointsFor(windows: EvalWindow[], scorer: Scorer, ks: readonly number[]): RankEvalPoint[] {
  const points: RankEvalPoint[] = [];
  let prev: { scores: Record<string, number> } | null = null;
  for (let i = 0; i < windows.length; i++) {
    const { point, scores } = pointFor(windows[i]!, i, scorer, ks, prev);
    points.push(point);
    prev = { scores };
  }
  return points;
}

/**
 * Average one point across the random baseline's draws.
 *
 * The counts are averaged and the rates derived from the averages, rather than the rates being
 * averaged: one rule, applied once, and it keeps the published matrix and the published rate
 * arithmetically consistent with each other. The counts are therefore fractional here — an
 * EXPECTED matrix over `RANDOM_DRAWS` draws, which is what a random baseline is.
 */
function averagePoints(perDraw: RankEvalPoint[][]): RankEvalPoint[] {
  const first = perDraw[0] ?? [];
  return first.map((base, i) => {
    const draws = perDraw.map((points) => points[i]!);
    const matrix = emptyMatrix();
    matrix.tp = mean(draws.map((d) => d.matrix.tp))!;
    matrix.fp = mean(draws.map((d) => d.matrix.fp))!;
    matrix.fn = mean(draws.map((d) => d.matrix.fn))!;
    matrix.tn = mean(draws.map((d) => d.matrix.tn))!;
    matrix.unknownHigh = mean(draws.map((d) => d.matrix.unknownHigh))!;
    matrix.unknownLow = mean(draws.map((d) => d.matrix.unknownLow))!;
    finalize(matrix);
    return {
      ...base,
      matrix,
      precisionAtK: base.precisionAtK.map((cut, ci) => ({
        k: cut.k,
        applicable: cut.applicable,
        precision: meanOf(draws.map((d) => d.precisionAtK[ci]!.precision)),
        resolvedInTopK: mean(draws.map((d) => d.precisionAtK[ci]!.resolvedInTopK))!,
        labelledInTopK: mean(draws.map((d) => d.precisionAtK[ci]!.labelledInTopK))!,
        unknownInTopK: mean(draws.map((d) => d.precisionAtK[ci]!.unknownInTopK))!,
      })),
      tieRate: mean(draws.map((d) => d.tieRate))!,
      effectiveCardinality: mean(draws.map((d) => d.effectiveCardinality))!,
      tau: meanOf(draws.map((d) => d.tau)),
    };
  });
}

/**
 * The whole evaluation: the candidate rule and three baselines over one population and one set
 * of labels, plus the honesty block that says what the figures are conditional on.
 */
export function evaluateRank(input: RankEvalInput): RankEvalReport {
  const ledger = (input?.ledger ?? []).filter((r) => r && r.issueId);
  const horizonDays = Number.isFinite(input?.horizonDays) && input.horizonDays > 0
    ? input.horizonDays
    : 30;
  const ks = cleanKs(input?.ks);
  const seed = Number.isFinite(input?.seed) ? Number(input.seed) : DEFAULT_EVAL_SEED;
  const rule = input?.rule ?? DEFAULT_RANK_RULE;

  const { windows, scopeChanges, unknownScopePairs, ordered } =
    comparableWindows(input?.syncs ?? [], ledger, horizonDays);

  const evaluated: Record<string, boolean> = {};
  let labelledRows = 0;
  let evaluatedRows = 0;
  for (const w of windows) {
    for (let i = 0; i < w.rows.length; i++) {
      const id = w.rows[i]!.issueId;
      const wasLabelled = evaluated[id];
      if (wasLabelled === undefined) {
        evaluatedRows += 1;
        evaluated[id] = w.labels[i] !== "unknown";
        if (evaluated[id]) labelledRows += 1;
      } else if (!wasLabelled && w.labels[i] !== "unknown") {
        evaluated[id] = true;
        labelledRows += 1;
      }
    }
  }

  const lastSync = ordered.length ? ordered[ordered.length - 1]! : null;
  const base: RankEvalReport = {
    computed: false,
    waitingFor: null,
    horizonDays,
    ks,
    seed,
    syncsAvailable: ordered.length,
    comparablePairs: windows.length,
    scopeChanges,
    unknownScopePairs,
    totalRows: ledger.length,
    evaluatedRows,
    labelledRows,
    unknownRows: evaluatedRows - labelledRows,
    lastSyncAt: lastSync ? lastSync.finishedAt : null,
    candidate: null,
    baselines: { rankV1: null, dueAtOnly: null, random: null, severityOnly: null },
    severityOnlyNote: SEVERITY_ONLY_NOTE,
  };

  // AN UNMEASURED EVALUATION IS NOT AN EVALUATION OF ZEROES. Both refusals return the bases
  // as null and a sentence naming what is missing, rather than a table of 0.00s that states
  // four facts about a question nobody has been able to ask yet.
  if (windows.length < 1) {
    base.waitingFor = ordered.length < 2
      ? `A label needs two committed syncs under one register scope; ${ordered.length} recorded so far.`
      : "No two consecutive syncs applied the same register scope, so nothing is comparable — "
        + `${scopeChanges} scope change(s) and ${unknownScopePairs} pair(s) with an unrecorded scope.`;
    return base;
  }
  if (labelledRows < 1) {
    base.waitingFor = `No row's outcome is known yet: the ${horizonDays}-day horizon on every `
      + "comparable sync ends after the last sync that could have seen a row leave.";
    return base;
  }
  if (!ks.length) {
    base.waitingFor = "No cut of the queue was asked for, so there is nothing to score at.";
    return base;
  }

  const randomDraws: RankEvalPoint[][] = [];
  for (let d = 0; d < RANDOM_DRAWS; d++) {
    randomDraws.push(pointsFor(windows, randomScorer(seed, d), ks));
  }

  base.computed = true;
  base.candidate = basisFrom(
    "candidate",
    "Candidate rule",
    "The rule the register ranks by now.",
    pointsFor(windows, candidateScorer(rule), ks),
    ks,
    seed,
  );
  base.baselines.rankV1 = basisFrom(
    "rankV1",
    "Rank v1",
    "The shipped default: the operator's rule weight and the overdue clock, half each.",
    pointsFor(windows, candidateScorer(DEFAULT_RANK_RULE), ks),
    ks,
    seed,
  );
  base.baselines.dueAtOnly = basisFrom(
    "dueAtOnly",
    "Due date only",
    "Soonest deadline first, undated rows last.",
    pointsFor(windows, dueAtScorer, ks),
    ks,
    seed,
  );
  base.baselines.random = basisFrom(
    "random",
    "Random",
    `Mean of ${RANDOM_DRAWS} seeded draws, re-drawn at every sync.`,
    averagePoints(randomDraws),
    ks,
    seed,
  );
  return base;
}
