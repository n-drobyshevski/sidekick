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
 * So this module reads exactly two things by default, and the consequence is the point: **it
 * needs no graph**. No traversal, no attribution hop, no asset join, no measurability
 * tri-state. Those exist to feed axes that do not vary. `normalizeIssuesPage` touches zero
 * nodes and zero edges, so one query stands the default model up.
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
 *
 * ---------------------------------------------------------------------------------------
 * v2: FOUR TERMS, A RENORMALISING BLEND, AND A DEFAULT THAT DOES NOT MOVE.
 *
 * The model now knows how to read four terms — the operator's rule judgement, the clock, an
 * exploitation ladder folded up from a row's linked findings, and whether the row sits on or
 * beside an AI asset. Two of them are new and BOTH ARE OFF BY DEFAULT (`shares.exploitation`
 * and `shares.adjacency` are 0 in `DEFAULT_RANK_RULE`), because this is a tuning change and
 * the iron rule applies: a preset opts in, the default does not move, and `test/rank.test.ts`
 * pins a 12-row score vector computed from the pre-v2 code to prove it.
 *
 * WHY THE BLEND RENORMALISES OVER MEASURED TERMS. A term nobody measured is `null`, and a
 * `null` is dropped from BOTH sides of the fraction rather than entering as a zero. This is
 * the same rule the whole repo turns on — absent is never zero — applied to a weighted mean:
 * scoring an unmeasured term as 0 would say "we looked at the exploitation evidence and there
 * is none", which on the reference tenant would be a claim about 68 asset edges nobody
 * traversed. Dropping it says "we know three things about this row instead of four", which is
 * what actually happened, and it keeps a sparsely-attributed row rankable against a
 * fully-attributed one instead of sinking it to the floor. The v1 collapse at
 * `timeComponent === null -> score = ruleComponent` is the two-term special case of exactly
 * this formula, and stays byte-identical under the v1 shares.
 *
 * A term whose share is 0 is NOT READ, which is why it leaves `measuredTerms` and `reasons`
 * as well as the fraction, and why `rankSignature` names only the non-zero ones. Its
 * component is still computed and published on the result: a reading the score did not use is
 * still a reading, and the evaluation harness needs it to decide whether the share should
 * move.
 */

/** One operator judgement: this rule matters this much. The only knob the model really has. */
export interface RuleWeight {
  ruleId: string;
  /** 0 = ignore rows carrying this rule, 1 = the most this operator will say about anything. */
  weight: number;
}

/**
 * The exploitation ladder, PORTED from the OS register's `riskTier` rather than imported: the
 * two registers read different populations through different queries, and a shared type would
 * make one register's schema change break the other's build. The order and the vocabulary are
 * deliberately identical, because "on the CISA KEV catalog" has to mean the same thing on both
 * surfaces — and `unknown` stays last there for the same reason it maps to `null` here: it is
 * a measurement gap, not a low score.
 */
export type ExploitationTier = "kev" | "exploit" | "epss" | "none" | "unknown";

/** Where a row sits relative to the AI estate. Absent means no adjacency pass ran. */
export type AiAdjacency = "DIRECT" | "ADJACENT" | "UNLINKED";

/** Which date the clock term read. `dueAtElseAge` is the only source that can answer `createdAt`. */
export type TimeSource = "dueAtOnly" | "dueAtElseAge";

/** The four terms, in blend order. `reasons` is emitted in this order too. */
export type RankTerm = "rule" | "time" | "exploitation" | "adjacency";

const TERM_ORDER: readonly RankTerm[] = ["rule", "time", "exploitation", "adjacency"];

export interface RankShares {
  rule: number;
  time: number;
  exploitation: number;
  adjacency: number;
}

export interface ExploitationWeights {
  kev: number;
  exploit: number;
  epss: number;
  none: number;
}

export interface AdjacencyWeights {
  DIRECT: number;
  ADJACENT: number;
  UNLINKED: number;
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
   * Day thresholds for the AGE axis, read only when `timeSource` is `dueAtElseAge` and the row
   * carries no `dueAt`. No floor bucket here — there is no "not yet born".
   *
   * WHICH TIME SIGNAL WINS DEPENDS ON THE REGISTER. Overdue beats age 3.96 to 3.86 on the AI
   * slice, and that is the ONLY slice where `dueAt` coverage is 100%. Widen the category set
   * and coverage falls to 38.4%, and at the whole-project ceiling to 26.4%, while age keeps
   * 100% coverage by construction and its effective cardinality rises to 4.26
   * (`ai/AARS_LIVE_MEASUREMENTS.md` §6.3). So age is the fallback, not the replacement.
   */
  ageDayBuckets: readonly number[];
  /** `dueAtOnly` is v1's clock exactly. `dueAtElseAge` falls back to age on an undated row. */
  timeSource: TimeSource;
  /** Ladder rung -> 0..1 reading. `none` is mid-low, not 0: an observed absence is a measurement. */
  exploitationWeights: ExploitationWeights;
  /**
   * The EPSS rung applies only at or above this probability; below it the row reads `none`.
   * Ported value, not a new opinion: the OS register's `EPSS_PRIORITY_THRESHOLD` is 0.1.
   */
  epssThreshold: number;
  /**
   * Adjacency -> 0..1 reading. `UNLINKED` is MID-SCALE AND THAT IS THE WHOLE POINT: edges are
   * sparse here — 68 asset edges on the reference tenant — so "no known link to an AI asset"
   * is overwhelmingly a statement about the graph's coverage rather than about the row. A zero
   * would bury every row the attribution hop has not reached yet.
   */
  adjacencyWeights: AdjacencyWeights;
  /** Each term's share of the blend. They need not sum to 1; the blend renormalises. */
  shares: RankShares;
  /**
   * v1's single knob, KEPT FOR BACKWARD COMPATIBILITY and held equal to `shares.time` by
   * `cleanRankRule`. A persisted v1 rule carries this and no `shares`, and reading it as
   * `{rule: 1 - timeShare, time: timeShare}` is what makes such a rule score identically
   * under the four-term blend.
   */
  timeShare: number;
}

export const DEFAULT_RANK_RULE: RankRule = {
  ruleWeights: [],
  defaultRuleWeight: 0.5,
  overdueDayBuckets: [0, 30, 90, 180, 365],
  ageDayBuckets: [30, 90, 180, 365, 540],
  timeSource: "dueAtOnly",
  exploitationWeights: { kev: 1, exploit: 0.7, epss: 0.6, none: 0.2 },
  epssThreshold: 0.1,
  adjacencyWeights: { DIRECT: 1, ADJACENT: 0.7, UNLINKED: 0.4 },
  shares: { rule: 0.5, time: 0.5, exploitation: 0, adjacency: 0 },
  timeShare: 0.5,
};

/**
 * The opt-in v2 preset: all four terms on, age as the clock's fallback.
 *
 * THESE FOUR NUMBERS ARE A STARTING POINT TO BE MOVED BY THE EVALUATION HARNESS'S NUMBERS,
 * NOT BY TASTE. They encode one prior and nothing more — that the two graph-fed terms together
 * should not outweigh the two row-fed ones that are already measured to separate 6.53 between
 * them. Whichever share the harness finds carries discrimination should rise; whichever reads
 * as a constant on the live population should fall to 0, at which point `rankSignature` stops
 * naming it and the term stops being read at all.
 *
 * No `>730d` age bucket: §6.3 measured that bucket empty on every slice in scope, and a bucket
 * nothing ever lands in is a step of the ladder that silently compresses the rest.
 */
export const RANK_PRESET_V2: RankRule = {
  ...DEFAULT_RANK_RULE,
  timeSource: "dueAtElseAge",
  shares: { rule: 0.25, time: 0.30, exploitation: 0.30, adjacency: 0.15 },
  timeShare: 0.30,
};

export interface RankResult {
  /** 0..1. The only published number this model has. */
  score: number;
  ruleComponent: number;
  /**
   * `null` when the row carries no readable date the current `timeSource` can use — UNMEASURED,
   * not zero. A row with no deadline has not "waited zero days"; nobody set a deadline. Scoring
   * it as fresh would rank it below every dated row on a fact nobody established.
   */
  timeComponent: number | null;
  overdueDays: number | null;
  /** Index into `overdueDayBuckets`, `-1` for not yet due, `null` when undated. */
  bucket: number | null;
  /**
   * Age in days from `createdAt`, whenever that date parses — INDEPENDENT of which basis the
   * clock actually used. A reading the score did not use is still a reading.
   */
  ageDays: number | null;
  /** Which date `timeComponent` came from; `null` when the clock is unmeasured. */
  timeBasis: "dueAt" | "createdAt" | null;
  /** `null` when the tier is `unknown` or absent — never silently `none`. */
  exploitationComponent: number | null;
  /** `null` when no adjacency pass ran. `UNLINKED` is a measurement and scores mid-scale. */
  adjacencyComponent: number | null;
  /** The terms that actually entered the blend: measured AND carrying a non-zero share. */
  measuredTerms: string[];
  /** One clause per entry in `measuredTerms`, same order. The two arrays are the same length. */
  reasons: string[];
}

/** The fields the model reads, plus the id it ranks. Findings carry `ruleShortId`. */
export interface RankInput {
  id?: string;
  ruleId?: string;
  ruleShortId?: string;
  dueAt?: string;
  /** Birth date. Read only by `timeSource: "dueAtElseAge"`, and only when `dueAt` is absent. */
  createdAt?: string;
  /** Folded up from the row's linked findings upstream; absent === `unknown` === unmeasured. */
  exploitationTier?: ExploitationTier;
  /** The highest EPSS seen across those findings. Demotes an `epss` tier below the threshold. */
  epssPeak?: number | null;
  /** Absent === unmeasured: no adjacency pass ran. `UNLINKED` is a different claim entirely. */
  aiAdjacency?: AiAdjacency;
  /** Reasons text only — how many findings the tier was folded from. */
  exploitationFindingCount?: number;
  /** Reasons text only — the edge label the adjacency came through. */
  adjacencyVia?: string;
}

const DAY_MS = 86400000;

/** The rule id this row ranks under — `ruleId` for an issue, `ruleShortId` for a finding. */
export function rankKeyOf(row: RankInput): string {
  return String(row.ruleId ?? row.ruleShortId ?? "").trim();
}

function weightFor(key: string, rule: RankRule): number {
  for (const row of rule.ruleWeights ?? []) {
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
 * Clamp into 0..1, but fall back to a stated default when the value is ABSENT OR UNREADABLE
 * rather than collapsing it to 0. `clamp01` is the right answer for a number an operator typed
 * out of range; this is the right answer for a field a persisted rule predates.
 */
function num01(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** A persisted rule can carry anything in a field; this is "an object, or nothing at all". */
function objOf(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Ascending, deduped, non-negative. A negative day threshold is not a reading of anything. */
function cleanBuckets(raw: unknown, fallback: readonly number[]): number[] {
  const arr = Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isFinite(n) && n >= 0) : [];
  const out = Array.from(new Set(arr)).sort((a, b) => a - b);
  return out.length ? out : [...fallback];
}

/**
 * The four shares, with v1's single knob read as the two-term case.
 *
 * Defensive rather than trusting `cleanRankRule` to have run: `rankOne` is called with rules
 * that came off the Script Properties of a deployment older than this file.
 */
function sharesOf(rule: RankRule): RankShares {
  const raw = rule?.shares;
  if (raw && typeof raw === "object") {
    return {
      rule: num01(raw.rule, DEFAULT_RANK_RULE.shares.rule),
      time: num01(raw.time, DEFAULT_RANK_RULE.shares.time),
      exploitation: num01(raw.exploitation, DEFAULT_RANK_RULE.shares.exploitation),
      adjacency: num01(raw.adjacency, DEFAULT_RANK_RULE.shares.adjacency),
    };
  }
  const time = clamp01(rule?.timeShare ?? DEFAULT_RANK_RULE.timeShare);
  return { rule: 1 - time, time, exploitation: 0, adjacency: 0 };
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
  const buckets = rule.overdueDayBuckets ?? DEFAULT_RANK_RULE.overdueDayBuckets;
  // Steps above the floor: not-yet-due plus one per threshold cleared.
  const steps = buckets.length + 1;
  if (days <= 0) return { days, bucket: -1, component: 0 };
  let idx = 0;
  for (let i = 0; i < buckets.length; i++) if (days > buckets[i]!) idx = i + 1;
  return { days, bucket: idx - 1, component: idx / (steps - 1) };
}

/** How many thresholds a positive day count clears, and that as a 0..1 reading. */
function ladderOf(days: number, buckets: readonly number[]): { idx: number; steps: number; component: number } {
  const steps = buckets.length;
  let idx = 0;
  for (let i = 0; i < steps; i++) if (days > buckets[i]!) idx = i + 1;
  return { idx, steps, component: steps > 0 ? idx / steps : 0 };
}

const round = (n: number): number => Math.round(n);

/** Short number for a reason clause: no trailing zeroes, no exponent surprise. */
const num = (n: number): string => String(Number(n.toFixed(3)));

interface TimeReading {
  days: number | null;
  bucket: number | null;
  component: number | null;
  ageDays: number | null;
  basis: "dueAt" | "createdAt" | null;
  reason: string;
}

/**
 * The clock, under whichever source the rule names.
 *
 * `dueAtOnly` is v1 unchanged. `dueAtElseAge` reaches for the birth date ONLY when there is no
 * deadline — a deadline is an operator's own statement about when this had to be done, and an
 * age is the absence of one, so the deadline always wins where both exist.
 */
function timeOf(row: RankInput, rule: RankRule, nowIso: string): TimeReading {
  const now = Date.parse(nowIso);
  const created = row.createdAt ? Date.parse(row.createdAt) : NaN;
  const ageDays = Number.isFinite(created) && Number.isFinite(now) ? (now - created) / DAY_MS : null;
  const od = overdueOf(row, rule, nowIso);

  if (od.component !== null) {
    const buckets = rule.overdueDayBuckets ?? DEFAULT_RANK_RULE.overdueDayBuckets;
    const days = od.days!;
    const reason = days <= 0
      ? "not yet due"
      : `overdue ${round(days)}d (bucket ${od.bucket! + 1} of ${buckets.length})`;
    return { days, bucket: od.bucket, component: od.component, ageDays, basis: "dueAt", reason };
  }

  const source = rule?.timeSource === "dueAtElseAge" ? "dueAtElseAge" : "dueAtOnly";
  if (source !== "dueAtElseAge" || ageDays === null) {
    return { days: null, bucket: null, component: null, ageDays, basis: null, reason: "" };
  }
  const buckets = rule.ageDayBuckets ?? DEFAULT_RANK_RULE.ageDayBuckets;
  const rung = ladderOf(ageDays, buckets);
  return {
    days: null,
    bucket: null,
    component: rung.component,
    ageDays,
    basis: "createdAt",
    reason: `age ${round(ageDays)}d, no deadline set (bucket ${rung.idx} of ${rung.steps})`,
  };
}

interface TermReading {
  component: number | null;
  reason: string;
}

/** " on 3 linked findings", or nothing at all when the fold did not say how many. */
function foldedFrom(count: number | undefined): string {
  const n = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.round(count)) : null;
  if (n === null) return "";
  return ` on ${n} linked finding${n === 1 ? "" : "s"}`;
}

/**
 * The exploitation term.
 *
 * THE TIER IS TRUSTED AS GIVEN. The fold upstream already walked the row's linked findings and
 * applied the ladder, exactly as `riskTier` does on the OS register; re-deciding it here from a
 * loose EPSS would be a second classifier over the same population, and two classifiers
 * eventually disagree with no way for a reader to tell which one is lying. `epssThreshold` does
 * one thing only: it demotes an `epss` tier that does not clear the bar down to `none`.
 *
 * `unknown` — and absent, which is the same claim — is `null`. Never `none`: "we did not look"
 * and "we looked and found nothing" are the two readings this whole repo exists to keep apart.
 */
function exploitationOf(row: RankInput, rule: RankRule): TermReading {
  const weights = rule?.exploitationWeights ?? DEFAULT_RANK_RULE.exploitationWeights;
  const tier = String(row.exploitationTier ?? "").trim().toLowerCase();
  const from = foldedFrom(row.exploitationFindingCount);
  const peak = typeof row.epssPeak === "number" && Number.isFinite(row.epssPeak) ? row.epssPeak : null;
  const threshold = num01(rule?.epssThreshold, DEFAULT_RANK_RULE.epssThreshold);

  if (tier === "kev") return { component: clamp01(weights.kev), reason: `KEV${from || " on a linked finding"}` };
  if (tier === "exploit") return { component: clamp01(weights.exploit), reason: "exploit available, no KEV" };
  if (tier === "epss") {
    if (peak !== null && peak >= threshold) {
      return { component: clamp01(weights.epss), reason: `EPSS ${num(peak)} ≥ ${num(threshold)}` };
    }
    const seen = peak === null ? "EPSS not captured" : `EPSS ${num(peak)} < ${num(threshold)}`;
    return { component: clamp01(weights.none), reason: `${seen}, no exploit observed` };
  }
  if (tier === "none") {
    return { component: clamp01(weights.none), reason: `no exploit observed${from}` };
  }
  return { component: null, reason: "" };
}

/** Where the row sits relative to the AI estate. Absent is unmeasured, `UNLINKED` is not. */
function adjacencyOf(row: RankInput, rule: RankRule): TermReading {
  const weights = rule?.adjacencyWeights ?? DEFAULT_RANK_RULE.adjacencyWeights;
  const value = String(row.aiAdjacency ?? "").trim().toUpperCase();
  const via = String(row.adjacencyVia ?? "").trim();
  if (value === "DIRECT") return { component: clamp01(weights.DIRECT), reason: "on an AI asset" };
  if (value === "ADJACENT") {
    return {
      component: clamp01(weights.ADJACENT),
      reason: via ? `adjacent to an AI asset via ${via}` : "adjacent to an AI asset",
    };
  }
  if (value === "UNLINKED") {
    return { component: clamp01(weights.UNLINKED), reason: "no known link to an AI asset" };
  }
  return { component: null, reason: "" };
}

/**
 * One row's score: a weighted mean over the terms this row actually has a reading for.
 *
 * When the clock is unmeasured the blend collapses to the rule alone rather than treating the
 * missing half as zero. That is the honest reading — the model knows one thing about the row
 * instead of two — and it keeps an undated row rankable rather than sinking it to the floor.
 * Under v1's shares that collapse is arithmetically identical to the four-term formula, which
 * is why the default's score vector is unchanged to the bit.
 */
export function rankOne(row: RankInput, rule: RankRule, nowIso: string): RankResult {
  const ruleComponent = weightFor(rankKeyOf(row), rule);
  const time = timeOf(row, rule, nowIso);
  const exploitation = exploitationOf(row, rule);
  const adjacency = adjacencyOf(row, rule);
  const shares = sharesOf(rule);

  const key = rankKeyOf(row);
  const terms: Record<RankTerm, TermReading & { share: number }> = {
    rule: {
      component: ruleComponent,
      share: shares.rule,
      reason: `rule ${key || "unattributed"} weight ${ruleComponent.toFixed(2)}`,
    },
    time: { component: time.component, share: shares.time, reason: time.reason },
    exploitation: { ...exploitation, share: shares.exploitation },
    adjacency: { ...adjacency, share: shares.adjacency },
  };

  let numerator = 0;
  let denominator = 0;
  let only: number | null = null;
  const measuredTerms: string[] = [];
  const reasons: string[] = [];
  for (const name of TERM_ORDER) {
    const term = terms[name];
    if (term.component === null || term.share <= 0) continue;
    numerator += term.share * term.component;
    denominator += term.share;
    only = measuredTerms.length === 0 ? term.component : null;
    measuredTerms.push(name);
    reasons.push(term.reason);
  }

  // A mean of ONE term is that term, and saying so is not an optimisation — it is the only
  // form that is exact. Measured against the pre-v2 code over 308 rows x 7 timeShares: the
  // renormalised form disagreed on exactly one, an undated row at `timeShare` 0.7, where
  // `1 - 0.7` is `0.30000000000000004` and `(0.30000000000000004 * 0.9) / 0.30000000000000004`
  // lands a ULP high at `0.9000000000000001`. v1 returned `ruleComponent` untouched there. The
  // difference is benign in direction and not in kind — the same argument
  // `CROSSING_EPSILON` makes in the sibling register — so the single-term case never divides.

  return {
    // Nothing read at all — every share zeroed, or every term unmeasured — still ranks by the
    // one thing that is never null, rather than by a manufactured 0.
    score: only !== null ? only : denominator > 0 ? numerator / denominator : ruleComponent,
    ruleComponent,
    timeComponent: time.component,
    overdueDays: time.days,
    bucket: time.bucket,
    ageDays: time.ageDays,
    timeBasis: time.basis,
    exploitationComponent: exploitation.component,
    adjacencyComponent: adjacency.component,
    measuredTerms,
    reasons,
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

/**
 * What a persisted score was computed AGAINST — the same argument `problemRule.vectorSignature`
 * makes, and the same failure it exists to stop: a knob that changes WHICH READING a row gets
 * has to join the signature, or a stored input is reused across the flip and the knob appears
 * to do nothing.
 *
 * So this names the derivation knobs and NOT the pricing ones. `ruleWeights` and the weight
 * tables move what a reading is WORTH, which is a re-score of the same readings; `timeSource`,
 * the two bucket ladders and `epssThreshold` move which bucket a row lands in. The shares are
 * in only by PRESENCE: a term at share 0 is not read at all, so 0.3 -> 0.2 is a re-price and
 * 0.3 -> 0 is a derivation change. A joined string rather than a hash, so a mismatch in a log
 * says what differs.
 */
export function rankSignature(rule: RankRule): string {
  const r = rule ?? DEFAULT_RANK_RULE;
  const shares = sharesOf(r);
  const read = TERM_ORDER.filter((t) => shares[t] > 0);
  const source = r.timeSource === "dueAtElseAge" ? "dueAtElseAge" : "dueAtOnly";
  const age = cleanBuckets(r.ageDayBuckets, DEFAULT_RANK_RULE.ageDayBuckets);
  const overdue = cleanBuckets(r.overdueDayBuckets, DEFAULT_RANK_RULE.overdueDayBuckets);
  return [
    "rank",
    `time=${source}`,
    `age=${age.join(",")}`,
    `overdue=${overdue.join(",")}`,
    `epss=${num(num01(r.epssThreshold, DEFAULT_RANK_RULE.epssThreshold))}`,
    `terms=${read.join(",")}`,
  ].join("|");
}

/** Clamp an operator-supplied rule into range without rejecting it, mirroring `cleanAarsRule`. */
export function cleanRankRule(v: Partial<RankRule> | null | undefined): RankRule {
  const raw = (v ?? {}) as Partial<RankRule> & Record<string, unknown>;
  const d = DEFAULT_RANK_RULE;

  // A rule persisted before v2 carries `timeShare` and no `shares`. Reading it as the two-term
  // case is what makes it score identically under the four-term blend.
  const rawShares = raw.shares && typeof raw.shares === "object" ? objOf(raw.shares) : null;
  const legacyTime = clamp01(raw.timeShare ?? d.timeShare);
  const shares: RankShares = rawShares
    ? {
        rule: num01(rawShares["rule"], d.shares.rule),
        time: num01(rawShares["time"], d.shares.time),
        exploitation: num01(rawShares["exploitation"], d.shares.exploitation),
        adjacency: num01(rawShares["adjacency"], d.shares.adjacency),
      }
    : { rule: 1 - legacyTime, time: legacyTime, exploitation: 0, adjacency: 0 };

  const ew = objOf(raw.exploitationWeights);
  const aw = objOf(raw.adjacencyWeights);

  return {
    ruleWeights: (Array.isArray(raw.ruleWeights) ? raw.ruleWeights : [])
      .filter((r): r is RuleWeight => Boolean(r) && typeof r.ruleId === "string" && r.ruleId.trim() !== "")
      .map((r) => ({ ruleId: r.ruleId.trim(), weight: clamp01(r.weight) })),
    defaultRuleWeight: clamp01(raw.defaultRuleWeight ?? d.defaultRuleWeight),
    overdueDayBuckets: cleanBuckets(raw.overdueDayBuckets, d.overdueDayBuckets),
    ageDayBuckets: cleanBuckets(raw.ageDayBuckets, d.ageDayBuckets),
    // The SPEC value on anything unreadable, never the newer one: a rule that cannot say which
    // clock it meant gets the clock every stored score was computed against.
    timeSource: raw.timeSource === "dueAtElseAge" ? "dueAtElseAge" : "dueAtOnly",
    exploitationWeights: {
      kev: num01(ew["kev"], d.exploitationWeights.kev),
      exploit: num01(ew["exploit"], d.exploitationWeights.exploit),
      epss: num01(ew["epss"], d.exploitationWeights.epss),
      none: num01(ew["none"], d.exploitationWeights.none),
    },
    epssThreshold: num01(raw.epssThreshold, d.epssThreshold),
    adjacencyWeights: {
      DIRECT: num01(aw["DIRECT"], d.adjacencyWeights.DIRECT),
      ADJACENT: num01(aw["ADJACENT"], d.adjacencyWeights.ADJACENT),
      UNLINKED: num01(aw["UNLINKED"], d.adjacencyWeights.UNLINKED),
    },
    shares,
    // Held equal to `shares.time`, in both directions. Two fields naming one fact is how the
    // two of them drift, and a v1 reader still reaches for this one.
    timeShare: shares.time,
  };
}

/**
 * The operator's existing judgement table, read as rank weights.
 *
 * DELIBERATELY NOT A NEW SETTINGS KEY. `ProblemRule.exploitationByRuleId` is already a
 * per-rule operator judgement keyed on the same rule id this model ranks by, already
 * persisted, already versioned, and already edited through a picker backed by the rule-id
 * census. Inventing a second per-rule table beside it would ask an operator to say the same
 * thing twice and then drift.
 *
 * The maturity ladder maps onto weight in its own order — REALIZED is a rule someone has seen
 * exploited, FEASIBLE is one they think could be. A rule absent from the table keeps
 * `defaultRuleWeight`, which is mid-scale rather than zero for the reason that field states.
 *
 * `base` is spread, so every v2 field — the shares included — flows through from whichever
 * rule the caller handed in rather than being reset to the default's.
 */
const MATURITY_WEIGHT: Record<string, number> = {
  REALIZED: 1,
  DEMONSTRATED: 0.8,
  FEASIBLE: 0.6,
};

export function rankRuleFromExploitation(
  rows: ReadonlyArray<{ ruleId?: string; maturity?: string }> | undefined,
  base: RankRule = DEFAULT_RANK_RULE,
): RankRule {
  const weights: RuleWeight[] = [];
  for (const row of rows ?? []) {
    const ruleId = String(row?.ruleId ?? "").trim();
    if (!ruleId) continue;
    const weight = MATURITY_WEIGHT[String(row?.maturity ?? "").toUpperCase()];
    if (weight === undefined) continue;
    weights.push({ ruleId, weight });
  }
  return { ...base, ruleWeights: weights };
}
