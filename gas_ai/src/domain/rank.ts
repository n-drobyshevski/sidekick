/**
 * The minimal model: order a queue by what an operator knows and how long it has waited.
 *
 * WHY THIS EXISTS AT ALL. The problem tree reads four axes, spends 54 leaves on them, and on
 * the reference tenant produces a tie rate of 1.000 and an effective cardinality of 1.00 —
 * it separates ZERO pairs. Every axis it reads is a constant here: `validatedAsExploitable`
 * is false on 100% of issues, `businessImpact` is MBI on 839 of 840, severity is one value on
 * 96%, and the agent privilege flags read 0 of 69 measured. Meanwhile two fields already flat
 * on the issue row score 2.40 (source rule id) and 3.96 (overdue bucket), and together 6.53.
 * See `ai/AARS_LIVE_MEASUREMENTS.md` §3, measured with `rankStats.ts`.
 *
 * So this module reads exactly two things, and the consequence is the point: **it needs no
 * graph**. No traversal, no attribution hop, no asset join, no measurability tri-state. Those
 * exist to feed axes that do not vary. `normalizeIssuesPage` touches zero nodes and zero
 * edges, so one query stands the whole model up.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It emits a score and a percentile, never a band. There is
 * no ACT / ATTEND vocabulary here, and adding one would be a mistake rather than a feature:
 * ACT is empty on this tenant BECAUSE the estate has no internet-facing AI asset and no HBI,
 * which is a true reading, and banding the top decile of a rank into "ACT" would manufacture
 * urgency the data does not support. A rank answers "which first", which is the question a
 * 189-row queue of identically-classified rows actually has.
 *
 * SHAPE-TYPED, not `IssueRow`, for the reason `problemCensus` gives: this is arithmetic over
 * two strings and a date, and a structural parameter keeps it testable without the graph
 * vocabulary. It also lets a FINDING row in, which carries `ruleShortId` rather than `ruleId`.
 */

/** One operator judgement: this rule matters this much. The only knob the model really has. */
export interface RuleWeight {
  ruleId: string;
  /** 0 = ignore rows carrying this rule, 1 = the most this operator will say about anything. */
  weight: number;
}

export interface RankRule {
  ruleWeights: RuleWeight[];
  /**
   * What a rule nobody has judged is worth. NOT zero: an unjudged rule is unjudged, not
   * harmless, and zeroing it would silently bury every row an operator has not got to yet —
   * the same "absent is never zero" failure that made an unassessed asset render as a clean
   * Tier 1. Mid-scale, so naming a rule can move it in either direction.
   */
  defaultRuleWeight: number;
  /**
   * Day thresholds for the overdue axis, ascending, exclusive lower bounds past `dueAt`.
   * Six buckets with the implicit not-yet-due one below them.
   *
   * ABSOLUTE DAYS, AND THAT IS LOAD-BEARING. The obvious alternative — overdue as a fraction
   * of the SLA window Wiz itself set, `(now - dueAt) / (dueAt - createdAt)` — was measured and
   * is degenerate: p25 = p50 = p75 = 0.87. Wiz sizes the window roughly in proportion to
   * whatever makes an issue old, so dividing by it normalises away the very variance the
   * signal carries. The ratio looked more principled and destroyed the measurement.
   */
  overdueDayBuckets: readonly number[];
  /**
   * How much of the score the clock owns, 0..1; the rule owns the rest. A blend rather than a
   * product so that a zero on either side does not annihilate the other — an operator setting
   * one rule to zero should sink those rows, not make the clock stop mattering everywhere.
   */
  timeShare: number;
}

export const DEFAULT_RANK_RULE: RankRule = {
  ruleWeights: [],
  defaultRuleWeight: 0.5,
  overdueDayBuckets: [0, 30, 90, 180, 365],
  timeShare: 0.5,
};

export interface RankResult {
  /** 0..1. The only published number this model has. */
  score: number;
  ruleComponent: number;
  /**
   * `null` when the row carries no `dueAt` — UNMEASURED, not zero. A row with no deadline has
   * not "waited zero days"; nobody set a deadline. Scoring it as fresh would rank it below
   * every dated row on a fact nobody established.
   */
  timeComponent: number | null;
  overdueDays: number | null;
  /** Index into `overdueDayBuckets`, `-1` for not yet due, `null` when undated. */
  bucket: number | null;
}

/** The two fields the model reads, plus the id it ranks. Findings carry `ruleShortId`. */
export interface RankInput {
  id?: string;
  ruleId?: string;
  ruleShortId?: string;
  dueAt?: string;
}

const DAY_MS = 86400000;

/** The rule id this row ranks under — `ruleId` for an issue, `ruleShortId` for a finding. */
export function rankKeyOf(row: RankInput): string {
  return String(row.ruleId ?? row.ruleShortId ?? "").trim();
}

function weightFor(key: string, rule: RankRule): number {
  for (const row of rule.ruleWeights) {
    if (row && String(row.ruleId ?? "").trim() === key) return clamp01(row.weight);
  }
  return clamp01(rule.defaultRuleWeight);
}

function clamp01(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Which overdue bucket a row sits in, and that bucket as a 0..1 reading.
 *
 * Not-yet-due is its own floor rather than bucket 0, so "due next week" and "one day late" are
 * not the same reading. Undated returns null all the way up — see `RankResult.timeComponent`.
 */
export function overdueOf(
  row: RankInput,
  rule: RankRule,
  nowIso: string,
): { days: number | null; bucket: number | null; component: number | null } {
  const due = row.dueAt ? Date.parse(row.dueAt) : NaN;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(due) || !Number.isFinite(now)) {
    return { days: null, bucket: null, component: null };
  }
  const days = (now - due) / DAY_MS;
  const buckets = rule.overdueDayBuckets;
  // Steps above the floor: not-yet-due plus one per threshold cleared.
  const steps = buckets.length + 1;
  if (days <= 0) return { days, bucket: -1, component: 0 };
  let idx = 0;
  for (let i = 0; i < buckets.length; i++) if (days > buckets[i]!) idx = i + 1;
  return { days, bucket: idx - 1, component: idx / (steps - 1) };
}

/**
 * One row's score.
 *
 * When the clock is unmeasured the blend collapses to the rule alone rather than treating the
 * missing half as zero. That is the honest reading — the model knows one thing about the row
 * instead of two — and it keeps an undated row rankable rather than sinking it to the floor.
 */
export function rankOne(row: RankInput, rule: RankRule, nowIso: string): RankResult {
  const ruleComponent = weightFor(rankKeyOf(row), rule);
  const time = overdueOf(row, rule, nowIso);
  const share = clamp01(rule.timeShare);
  const score = time.component === null
    ? ruleComponent
    : (1 - share) * ruleComponent + share * time.component;
  return {
    score,
    ruleComponent,
    timeComponent: time.component,
    overdueDays: time.days,
    bucket: time.bucket,
  };
}

/** Every row scored, input order preserved so a caller can zip it back onto its own list. */
export function rankAll(
  rows: ReadonlyArray<RankInput>,
  rule: RankRule,
  nowIso: string,
): RankResult[] {
  return (rows ?? []).map((r) => rankOne(r ?? {}, rule, nowIso));
}

/**
 * The rule ids present in a landscape, commonest first — what the weights table has to offer
 * an operator, and the same argument `problemCensus` makes for the exploitation table: a free
 * list of opaque ids is unanswerable unless the editor can show what the strings could be.
 */
export function rankCensus(
  rows: ReadonlyArray<RankInput>,
): Array<{ ruleId: string; rows: number }> {
  const counts: Record<string, number> = {};
  for (const row of rows ?? []) {
    const key = rankKeyOf(row ?? {});
    if (key) counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.keys(counts)
    .map((ruleId) => ({ ruleId, rows: counts[ruleId]! }))
    .sort((a, b) => b.rows - a.rows || a.ruleId.localeCompare(b.ruleId));
}

/** Clamp an operator-supplied rule into range without rejecting it, mirroring `cleanAarsRule`. */
export function cleanRankRule(v: Partial<RankRule> | null | undefined): RankRule {
  const raw = v ?? {};
  const buckets = Array.isArray(raw.overdueDayBuckets) && raw.overdueDayBuckets.length
    ? [...raw.overdueDayBuckets].map(Number).filter(Number.isFinite).sort((a, b) => a - b)
    : [...DEFAULT_RANK_RULE.overdueDayBuckets];
  return {
    ruleWeights: (Array.isArray(raw.ruleWeights) ? raw.ruleWeights : [])
      .filter((r): r is RuleWeight => Boolean(r) && typeof r.ruleId === "string" && r.ruleId.trim() !== "")
      .map((r) => ({ ruleId: r.ruleId.trim(), weight: clamp01(r.weight) })),
    defaultRuleWeight: clamp01(raw.defaultRuleWeight ?? DEFAULT_RANK_RULE.defaultRuleWeight),
    overdueDayBuckets: buckets.length ? buckets : [...DEFAULT_RANK_RULE.overdueDayBuckets],
    timeShare: clamp01(raw.timeShare ?? DEFAULT_RANK_RULE.timeShare),
  };
}
