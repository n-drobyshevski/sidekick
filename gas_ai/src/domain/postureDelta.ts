// POSTURE DELTA — did a change actually improve anything, computed rather than eyeballed.
//
// WHY THIS EXISTS. Five phases went into finding out why `ai_edges` held zero rows, and every
// one of them ended the same way: deploy, run a diagnostic, and compare the output against a
// screenshot of the last run. That works until two things are true at once, and by the end of
// this investigation several were — a boolean-comparison fix that raises the signal count on its
// own, a guardrail query that moves AARS scores on its own, and a vocabulary fix whose whole
// point was the edges. Reading "the numbers went up" as "the traversals work" would have been
// the same error the traversals themselves were built on: a conclusion drawn from evidence that
// did not support it.
//
// So this module does two things a screenshot cannot.
//
// 1. IT NAMES WHAT EACH MEASURE MOVES FOR. `rising` says whether an increase is better, worse,
//    or neither, and `confound` names the OTHER change that can move a measure — printed on the
//    same line as the number, never as a footnote, because a footnote is read after the reader
//    has already decided.
//
// 2. IT REFUSES TO COLLAPSE. There is no "overall improvement" figure here and there must not be
//    one. Enriched rising while the largest tie group also rises is a real and informative state;
//    an average over the two is a number with no meaning that would hide it. Same discipline as
//    reach.ts's paired counts and aarsRule.ts's refusal to score a rule.
//
// ABSENT IS NOT ZERO, the rule this file inherits from getStepRows and enforces again. A measure
// missing from a baseline was not measured; a measure present with 0 was. Comparing the first
// against a current value produces `no-baseline`, never a delta from zero, because "it went from
// nothing to 12" and "we did not look last time" are different claims.

/** What an increase in a measure means. `neither` marks a denominator or a context reading. */
export type Direction = "better" | "worse" | "neither";

export interface Measure {
  key: string;
  label: string;
  /** `null` when this deployment could not read the measure at all — never a stand-in for 0. */
  value: number | null;
  /**
   * The denominator, where one exists. Kept beside the value rather than divided into it for
   * reach.ts's reason: a rate with no population behind it cannot be told apart from a rate over
   * nothing, and a run whose total moved is not comparable on the raw covered count.
   */
  total?: number | null;
  rising: Direction;
  /**
   * The other change that can move this measure. Non-empty means a delta here is NOT by itself
   * evidence for the change under test.
   */
  confound?: string;
}

export interface PostureSnapshot {
  /** ISO timestamp, supplied by the caller — this module reads no clock. */
  at: string;
  /** The sync whose ledger the measures were read from, when one is known. */
  syncId?: string;
  measures: Measure[];
}

export type Verdict = "better" | "worse" | "unchanged" | "no-baseline" | "not-recorded";

export interface MeasureDelta {
  key: string;
  label: string;
  before: number | null;
  after: number | null;
  beforeTotal: number | null;
  afterTotal: number | null;
  /** Absolute change, or null when either side is unreadable. */
  delta: number | null;
  /**
   * Change in covered/total, in percentage points, when BOTH sides carry a usable denominator.
   * This is the honest comparison whenever the population can move between syncs: 88 of 13,830
   * and 88 of 900 are not the same reading, and the raw delta of 0 would say they were.
   */
  rateDeltaPct: number | null;
  verdict: Verdict;
  rising: Direction;
  confound?: string;
}

/** Whether a pair is usable as a rate: a denominator of 0 divides nothing. */
function hasRate(v: number | null, t: number | null | undefined): boolean {
  return v !== null && typeof t === "number" && t > 0;
}

/**
 * Compare two snapshots, measure by measure, keyed by `key`.
 *
 * Ordering follows the AFTER snapshot, so a newly added measure appears where its author put it
 * rather than at the end, and a measure the current build no longer produces simply drops out —
 * a stale baseline entry is not a finding about posture.
 */
export function compareSnapshots(
  before: PostureSnapshot | null,
  after: PostureSnapshot,
): MeasureDelta[] {
  const prior = new Map<string, Measure>();
  for (const m of before?.measures ?? []) prior.set(m.key, m);

  return after.measures.map((m) => {
    const b = prior.get(m.key);
    const beforeVal = b ? b.value : null;
    const beforeTot = b && b.total !== undefined ? b.total : null;
    const afterTot = m.total !== undefined ? m.total : null;

    // Rate first, when both sides have a population. Falls back to the raw delta, which is the
    // right comparison for a bare count like `edge rows` that has no denominator at all.
    const rateDeltaPct =
      hasRate(beforeVal, beforeTot) && hasRate(m.value, afterTot)
        ? ((m.value as number) / (afterTot as number) - (beforeVal as number) / (beforeTot as number)) * 100
        : null;
    const delta = beforeVal !== null && m.value !== null ? m.value - beforeVal : null;

    let verdict: Verdict;
    if (m.value === null) verdict = "not-recorded";
    else if (!b || beforeVal === null) verdict = "no-baseline";
    else {
      // Judge on the rate wherever one exists — see `rateDeltaPct`. A population that grew while
      // the covered count held flat is a coverage LOSS, and the raw delta calls it unchanged.
      const moved = rateDeltaPct !== null ? rateDeltaPct : (delta as number);
      if (moved === 0) verdict = "unchanged";
      else if (m.rising === "neither") verdict = "unchanged";
      else verdict = (moved > 0) === (m.rising === "better") ? "better" : "worse";
    }

    return {
      key: m.key,
      label: m.label,
      before: beforeVal,
      after: m.value,
      beforeTotal: beforeTot,
      afterTotal: afterTot,
      delta,
      rateDeltaPct,
      verdict,
      rising: m.rising,
      ...(m.confound ? { confound: m.confound } : {}),
    };
  });
}

/**
 * The measures whose movement is evidence for the change under test — i.e. everything that is
 * not a denominator and carries no confound.
 *
 * This is deliberately a FILTER and not a score. A caller wanting "did it work" reads the
 * unconfounded list and sees which way each one went; there is no single number here to quote
 * out of context, because the states this tool exists to surface are the mixed ones.
 */
export function unconfounded(deltas: readonly MeasureDelta[]): MeasureDelta[] {
  return deltas.filter((d) => !d.confound && d.rising !== "neither");
}

/** Measures that moved the wrong way. The list a reader should be made to look at first. */
export function regressions(deltas: readonly MeasureDelta[]): MeasureDelta[] {
  return deltas.filter((d) => d.verdict === "worse");
}

// ------------------------------------------------------------------- building a snapshot

/**
 * Everything a snapshot is read from. Supplied by the caller rather than fetched here, so this
 * module stays pure and the measures below are testable without a tenant, a ledger or a clock.
 */
export interface SnapshotInput {
  at: string;
  syncId?: string;
  /** `estateReach(...)`'s output — stages, edge census, per-axis known rates. */
  reach: {
    stages: ReadonlyArray<{ key: string; label: string; covered: number; total: number }>;
    edges: { populated: readonly string[]; dead: readonly string[]; declared: number };
    axes: Readonly<Record<string, number>>;
    axesPopulation: number;
    impactTagged?: { covered: number; total: number };
  };
  /** `ruleDiscrimination(...)`'s output — how well the current AARS rule separates the estate. */
  aars: {
    scored: number;
    distinctScores: number;
    largestTieGroup: number;
    tieRate: number;
    effectiveCardinality: number;
  } | null;
  /** Rows on `ai_edges`, straight off the tab. The headline, and the one with no denominator. */
  edgeRows: number | null;
  /** Rows each sync step returned, by step id — settings' `last_step_rows`. */
  stepRows: Readonly<Record<string, number>>;
  /** Assets carrying any signal, and the register size. Confounded — see the measure below. */
  signal?: { covered: number; total: number };
}

/**
 * The confound that cost the most to notice, written once and attached to every measure it
 * touches. `registerScopeDiagnostic` compared a plain-text cell against a JS boolean for as long
 * as it existed, so its "carrying any signal" count was issue/finding membership only; repairing
 * that comparison roughly doubled the figure on the seed dataset with no tenant data changing at
 * all. A reader comparing two runs across that fix would credit the traversals for it.
 */
const SIGNAL_CONFOUND =
  "rises on the diagnostic's own boolean fix alone — not evidence any traversal ran";

/**
 * The other one. `MISSING_GUARDRAIL` was permanently false while GUARDRAIL_GAPS was malformed,
 * because `normalizeNoGuardrailPage` is its only producer. Every AARS measure moves the moment
 * that query starts returning, whether or not a single edge was collected.
 */
const AARS_CONFOUND =
  "also moves when MISSING_GUARDRAIL starts being collected — a query fix, not an edge fix";

const AXIS_LABELS: Record<string, string> = {
  exploitation: "Axis known · exploitation",
  impact: "Axis known · technical impact",
  exposure: "Axis known · system exposure",
  mission: "Axis known · mission",
};

export function buildSnapshot(input: SnapshotInput): PostureSnapshot {
  const m: Measure[] = [];

  // ---- edges: the headline, and the only reading with no way to move for another reason ----
  m.push({
    key: "edge-rows",
    label: "Rows on ai_edges",
    value: input.edgeRows,
    rising: "better",
  });
  m.push({
    key: "edge-types-populated",
    label: "Edge types populated",
    value: input.reach.edges.populated.length,
    total: input.reach.edges.populated.length + input.reach.edges.dead.length,
    rising: "better",
  });

  // ---- the reach ladder ----
  for (const s of input.reach.stages) {
    m.push({
      key: `reach-${s.key}`,
      label: `Reach · ${s.label}`,
      value: s.covered,
      total: s.total,
      // `register` is the AI-kinded share of the whole tab: a denominator for everything below
      // it and a statement about the tenant's inventory, not about this pipeline's reach.
      rising: s.key === "register" ? "neither" : "better",
    });
  }
  if (input.reach.impactTagged) {
    m.push({
      key: "reach-impact-tagged",
      label: "Impact-tagged (tenant project tagging)",
      value: input.reach.impactTagged.covered,
      total: input.reach.impactTagged.total,
      // Folded from the asset's own projects on the mandatory inventory hop. It reads high on a
      // landscape where nothing was traversed, which is exactly why it is not a reach stage and
      // why a rise here says nothing about this pipeline.
      rising: "neither",
    });
  }

  // ---- decision-tree axis coverage ----
  for (const [axis, rate] of Object.entries(input.reach.axes)) {
    m.push({
      key: `axis-${axis}`,
      label: AXIS_LABELS[axis] ?? `Axis known · ${axis}`,
      // Stored as a percentage so a delta reads in points rather than in thousandths.
      value: Math.round(rate * 1000) / 10,
      rising: "better",
    });
  }
  m.push({
    key: "axes-population",
    label: "Items the tree decided (axis denominator)",
    value: input.reach.axesPopulation,
    rising: "neither",
  });

  // ---- how well the score separates the estate ----
  if (input.aars) {
    m.push({
      key: "aars-distinct-scores", label: "AARS distinct scores",
      value: input.aars.distinctScores, total: input.aars.scored,
      rising: "better", confound: AARS_CONFOUND,
    });
    m.push({
      key: "aars-largest-tie", label: "AARS largest tie block",
      value: input.aars.largestTieGroup, total: input.aars.scored,
      // The one measure here where DOWN is the win: it is the block a "top N" cuts blindly into.
      rising: "worse", confound: AARS_CONFOUND,
    });
    m.push({
      key: "aars-tie-rate", label: "AARS tie rate (% of pairs unseparated)",
      value: Math.round(input.aars.tieRate * 1000) / 10,
      rising: "worse", confound: AARS_CONFOUND,
    });
    m.push({
      key: "aars-effective-cardinality", label: "AARS effective distinct scores",
      value: Math.round(input.aars.effectiveCardinality * 100) / 100,
      rising: "better", confound: AARS_CONFOUND,
    });
    m.push({
      key: "aars-scored", label: "Assets carrying a score",
      value: input.aars.scored, rising: "neither",
    });
  }

  // ---- per-step yield: which traversal actually returned anything ----
  for (const id of Object.keys(input.stepRows).sort()) {
    m.push({
      key: `step-${id}`,
      label: `Step yield · ${id}`,
      value: input.stepRows[id],
      rising: "better",
    });
  }

  // ---- the confounded one, kept because it is worth watching and labelled so it cannot mislead
  if (input.signal) {
    m.push({
      key: "register-signal", label: "Assets carrying any signal",
      value: input.signal.covered, total: input.signal.total,
      rising: "better", confound: SIGNAL_CONFOUND,
    });
  }

  return { at: input.at, ...(input.syncId ? { syncId: input.syncId } : {}), measures: m };
}
