// Rank remediation ACTIONS, not problems — Phase P1a of the Prioritization-to-Prediction
// rebuild, built directly on top of Phase 7's `problems.ts` union.
//
// WHY THIS MODULE EXISTS. `problems.ts` ranks 221 open problems against each other; on a
// live tenant that is not the bottleneck, because most of those 221 rows are the SAME fix
// repeated across many resources — `configFindings.ts`'s own header gives the canonical
// example, one Bedrock confused-deputy rule failing on sixteen IAM roles with the same
// name, the same severity and the same remediation. The question a reader actually has is
// "which handful of fixes clears the board", and answering it means grouping problems by
// the ACTION that closes them and ranking THAT list — not re-sorting the 221 rows louder.
//
// REUSE, NOT REBUILD. The counting this module needs already exists three times in this
// codebase: `configFindings.rollupByControl` groups findings by `ruleShortId` and is
// already sorted by leverage; `complianceOverview.sharedControls` ranks failing controls
// by how many frameworks one fix satisfies and carries `hasAutoRemediation`;
// `complianceScope.ts` indexes by BOTH `ruleId` and `ruleShortId` because which one a
// given row actually populated depends on the policy kind. This module borrows all three
// ideas — the by-rule rollup, the auto-remediation flag, the dual-key join — but ranks the
// WHOLE union (issues ∪ findings) `problems.ts` already assembles, which none of the three
// above scope to.

import type { FrameworkPolicyRow } from "./graphTypes";
import { OUTCOME_VALUES } from "./problem";
import type { ProblemRow } from "./problems";

// --------------------------------------------------------------------------- the key

/**
 * `${kind}|${ruleId}|${ruleShortId}` — both id fields participate, and `kind` stays part
 * of the key rather than being folded away, for two separate reasons documented below.
 * Never parsed back apart; every field the key describes also rides on `ActionRow`
 * directly, so a reader never needs to split this string to know what it names.
 */
export type ActionKey = string;

/**
 * Both `ruleId` and `ruleShortId` participate, empty string standing in for "this row's
 * kind doesn't carry one" — the SAME reason `complianceScope.ts`'s dual index keys a
 * finding by both identifiers at once (~line 190 there): a CONTROL-kind policy has no
 * `shortId`, while a cloud-configuration rule does, and which one a given row actually
 * populated depends on the policy kind, not on anything this function can infer. Using
 * both rather than picking one is what keeps two rules that legitimately share one id
 * field (an issue's `ruleId` and a finding's empty `ruleShortId`, say) from colliding into
 * one bogus action.
 *
 * `kind` stays IN the key rather than being a separate column two actions could otherwise
 * tie on, because ISSUES AND FINDINGS ARE NOT MERGED INTO ONE ACTION. There is no field
 * that joins a Wiz issue rule (`wc-id-3217`) to a cloud-configuration rule (`IAM-267`) —
 * `sourceCloudConfigurationRule` is the field that would do it, and this app neither
 * queries nor stores it. Merging the two populations under a shared rule id would be a
 * guess this module refuses to make; keeping `kind` in the key is what keeps an issue rule
 * and a finding rule that happen to share a numeric id from colliding into one action too.
 */
export function actionKeyOf(row: Pick<ProblemRow, "kind" | "ruleId" | "ruleShortId">): ActionKey {
  return `${row.kind}|${row.ruleId ?? ""}|${row.ruleShortId ?? ""}`;
}

// ------------------------------------------------------------------------- the rollup

export interface ActionRow {
  key: ActionKey;
  kind: "ISSUE" | "FINDING";
  ruleId?: string;
  ruleShortId?: string;
  /** The rule name — the first non-empty `title` among the action's own problems. */
  title: string;
  /** How many open problems this one action closes. */
  problems: number;
  /** Distinct assets it touches — an unlinked problem (`assetId` null) contributes none. */
  assets: number;
  /**
   * MAX over the group's own problem verdicts, never a mean — the identical "worst wins"
   * discipline `configFindings.rollupByControl`'s `severity` field and `problems.ts`'s
   * `compareProblems` both already apply, at this rollup's own grain. A bare `Outcome`
   * string, or `""` when EVERY problem in the group is undecided — never a number, and
   * never an average of the four queues, which is not a value there is a queue for.
   */
  worstOutcome: string;
  /** Count of the group's problems per `Outcome` value, zeros omitted — the shape's own detail. */
  outcomeMix: Record<string, number>;
  severityMix: Record<string, number>;
  /** Distinct, so an analyst sees at a glance whether HBI is anywhere in this action's blast. */
  businessImpacts: string[];
  /** `hasAutoRemediation` where known — false until `withAutoRemediation` below joins it in. */
  autoRemediable: boolean;
  /** Problems with an IaC origin — a shift-left fix exists for this many of them. */
  iac: number;
  /** Problems someone already refused to fix — negative feasibility, not a count to be proud of. */
  ignored: number;
  /** Earliest across the group — how long this has been true, not how long the newest instance has. */
  firstSeenAt?: string;
  /**
   * The per-RULE remediation text, never the per-instance one. `problems.ts`'s
   * `ProblemRow.ruleRemediation` is already sourced correctly per kind (an issue's
   * `resolutionRecommendation`, a finding's `remediationInstructions`) — seeing this field
   * diverge within one action would mean the SAME rule's template changed between two
   * findings, which is why the first non-empty value (by problem id, for determinism) wins
   * rather than the last: an action's remediation should read as stable as the rule it
   * names, not flicker with whichever problem happened to sync last.
   */
  remediation?: string;
}

const NO_OUTCOME = "";

/**
 * Worst-first position on the outcome scale, mirroring `problems.ts`'s own private
 * `outcomeRank` and `configFindings.ts`'s `priorityRank` exactly — three byte-identical
 * copies now, kept apart because none of the three files may import from the others'
 * private scope, and because "worst first" is cheap enough to duplicate correctly but
 * expensive to get wrong from a shared import three ranking modules would all have to trust.
 */
function outcomeRank(o: string): number {
  const i = (OUTCOME_VALUES as readonly string[]).indexOf(o);
  return i < 0 ? OUTCOME_VALUES.length : i;
}

/** One action candidate's stats over whatever pool of rows it was scored against. */
interface Candidate {
  key: ActionKey;
  rows: ProblemRow[];
  worstRank: number;
  assetCount: number;
}

function candidatesFrom(pool: readonly ProblemRow[]): Map<ActionKey, ProblemRow[]> {
  const groups = new Map<ActionKey, ProblemRow[]>();
  for (const row of pool) {
    const key = actionKeyOf(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

function scoreCandidate(key: ActionKey, rows: ProblemRow[]): Candidate {
  let worstRank = OUTCOME_VALUES.length; // starts at NO_OUTCOME's own rank
  const assetIds = new Set<string>();
  for (const row of rows) {
    const rank = outcomeRank(row.problemOutcome);
    if (rank < worstRank) worstRank = rank;
    if (row.assetId) assetIds.add(row.assetId);
  }
  return { key, rows, worstRank, assetCount: assetIds.size };
}

/**
 * The round's winner, worst-first at every level — mirrors `compareProblems`'s own numbered
 * cascade in shape, at the action grain instead of the problem grain:
 *
 * 1. WORST OUTCOME among the candidate's OWN remaining problems (ACT < ATTEND < TRACK_STAR
 *    < TRACK, undecided last) — the same reason `compareProblems` puts outcome first: which
 *    queue a problem belongs in is the loudest fact about it, and an action inherits its
 *    urgency from the worst thing it would close.
 * 2. REMAINING PROBLEMS CLOSED, descending — the leverage this whole module exists to
 *    surface: an action worth ranking first is one that clears the most of the board.
 * 3. DISTINCT ASSETS TOUCHED, descending — two actions tied on outcome and count can still
 *    describe very different blast radii; the wider one is the more consequential fix.
 * 4. KEY, ascending — final stability, the same role `compareProblems`'s own id tiebreak plays.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.worstRank !== b.worstRank) return a.worstRank - b.worstRank;
  if (a.rows.length !== b.rows.length) return b.rows.length - a.rows.length;
  if (a.assetCount !== b.assetCount) return b.assetCount - a.assetCount;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** One `ActionRow`, built from every problem the greedy loop credited to this action. */
function buildActionRow(key: ActionKey, rows: ProblemRow[]): ActionRow {
  // Sorted by problem id before folding, not left in whatever order the caller's array
  // happened to hold: `title` and `remediation` below take the first non-empty value they
  // see, and that pick must not depend on input order for the same reason `rankProblems`
  // never leaves a tie to `Map#values()` iteration order.
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const first = sorted[0]!;

  const assetIds = new Set<string>();
  const outcomeMix: Record<string, number> = {};
  const severityMix: Record<string, number> = {};
  const businessImpacts = new Set<string>();
  let worstRank = OUTCOME_VALUES.length;
  let worstOutcome = NO_OUTCOME;
  let iac = 0;
  let ignored = 0;
  let firstSeenAt = "";
  let title = "";
  let remediation: string | undefined;

  for (const row of sorted) {
    if (row.assetId) assetIds.add(row.assetId);
    outcomeMix[row.problemOutcome] = (outcomeMix[row.problemOutcome] ?? 0) + 1;
    if (row.severity) severityMix[row.severity] = (severityMix[row.severity] ?? 0) + 1;
    if (row.businessImpact) businessImpacts.add(row.businessImpact);
    const rank = outcomeRank(row.problemOutcome);
    // Strict `<`, not `<=`: the FIRST row (by id) to reach a given worst rank keeps it,
    // matching the same "first non-empty wins, deterministically" rule `title` and
    // `remediation` below already follow.
    if (rank < worstRank) {
      worstRank = rank;
      worstOutcome = row.problemOutcome;
    }
    if (row.iac) iac += 1;
    if (row.ignored) ignored += 1;
    // Earliest wins — the action has been fixable since its oldest problem appeared,
    // the same "earliest, not latest" rule `configFindings.rollupByControl` applies to
    // a control's own `firstSeenAt`.
    if (row.firstSeenAt && (!firstSeenAt || row.firstSeenAt < firstSeenAt)) {
      firstSeenAt = row.firstSeenAt;
    }
    if (!title && row.title) title = row.title;
    if (!remediation && row.ruleRemediation) remediation = row.ruleRemediation;
  }

  return {
    key,
    kind: first.kind,
    ruleId: first.ruleId,
    ruleShortId: first.ruleShortId,
    title: title || first.title,
    problems: rows.length,
    assets: assetIds.size,
    worstOutcome,
    outcomeMix,
    severityMix,
    businessImpacts: [...businessImpacts].sort(),
    autoRemediable: false,
    iac,
    ignored,
    firstSeenAt: firstSeenAt || undefined,
    remediation,
  };
}

/**
 * Greedy MARGINAL set-cover, NOT an independent sort of static group sizes.
 *
 * Score every candidate action over the REMAINING uncovered problems, take the best, then
 * remove exactly the problem rows (by `id`) that action closes before scoring the next
 * round — never remove by asset. That last clause is the trap: two actions on DIFFERENT
 * rules routinely share an asset (the same bucket can carry both a public-access finding
 * and a missing-encryption finding), and a round that marked the ASSET "handled" once one
 * fix touched it would silently shrink a second action's true remaining count even though
 * fixing the first action's rule does nothing for the second's. Removing by problem id
 * keeps every action's count answerable to exactly the problems ITS OWN rule closes, no
 * more and no less — the same "resources vs gapResources are different units" discipline
 * `configFindings.rollupByControl`'s own header argues for, applied to the removal step
 * instead of to two adjacent table columns.
 *
 * `limit` truncates the OUTPUT after ranking, never the input the ranking itself sees: a
 * caller asking for the top 10 must get the true top 10, not the top 10 of some smaller
 * pool the limit accidentally excluded rows from.
 *
 * WHAT THIS IS NOT DOING YET, stated so nobody reads more into it than it earns. Under
 * today's `ActionKey` every problem row carries exactly one (kind, ruleId, ruleShortId),
 * so the candidate groups PARTITION the rows rather than overlapping them — and greedy
 * set-cover over a partition is arithmetically identical to sorting the groups by size.
 * The loop is therefore not currently correcting any double-count; it is the shape the
 * ranking has to already be in for the group key to widen later without a rewrite. The
 * keys that would make it bite are the ones that genuinely span rules: an IaC template id
 * (`FindingRow.iacFindingIds`, today reduced to a boolean at every read), or a policy id
 * from `humanAccess.policyIds` — one template fix closing findings under several different
 * rules at once. When one of those becomes a key, the groups overlap, the marginal
 * re-scoring starts changing the order, and this function needs no change. Until then,
 * `test/actions.test.ts`'s overlap fixture is guarding the removal SEMANTICS (by id, never
 * by asset), not a live double-count.
 */
export function rankActionsByCover(rows: readonly ProblemRow[], limit?: number): ActionRow[] {
  let remaining = rows.slice();
  const ranked: ActionRow[] = [];

  while (remaining.length > 0) {
    const groups = candidatesFrom(remaining);
    let best: Candidate | null = null;
    for (const [key, groupRows] of groups) {
      const candidate = scoreCandidate(key, groupRows);
      if (!best || compareCandidates(candidate, best) < 0) best = candidate;
    }
    if (!best) break; // unreachable — groups is non-empty whenever remaining is

    ranked.push(buildActionRow(best.key, best.rows));

    // Remove exactly the covered problem ids — see this function's own header.
    const covered = new Set(best.rows.map((r) => r.id));
    remaining = remaining.filter((r) => !covered.has(r.id));
  }

  return limit !== undefined && limit >= 0 ? ranked.slice(0, limit) : ranked;
}

// ---------------------------------------------------------------------- auto-remediation

/**
 * Folds `hasAutoRemediation` onto already-ranked actions via the SAME dual-key join
 * `complianceScope.ts` uses to link a finding to its framework policy (~line 190 there):
 * matched by `ruleId` first, then by `ruleShortId`, because which identifier a given
 * `FrameworkPolicyRow` actually carries as its own `policyId`/`shortId` depends on the
 * policy kind, exactly as it does on the finding side. A separate pass rather than folded
 * into `rankActionsByCover` itself, because the join's source — `ai_framework_policies` —
 * is compliance-framework data `problems.ts`'s union has no reason to load; keeping the
 * two concerns apart means the greedy ranking stays provable from `ProblemRow[]` alone.
 *
 * `hasAutoRemediation` is a SPARSE BIT — absent on every seed row and, per
 * `complianceOverview.ts`'s own header, only ever present on a cloud-configuration policy
 * — so most actions this join reaches stay `false`, which is the honest reading ("not
 * known to be auto-remediable"), never a claim that no fix exists.
 */
export function withAutoRemediation(
  actions: readonly ActionRow[],
  policies: readonly FrameworkPolicyRow[],
): ActionRow[] {
  const byId = new Map<string, boolean>();
  const byShortId = new Map<string, boolean>();
  for (const p of policies) {
    if (p.hasAutoRemediation !== true) continue;
    byId.set(p.policyId, true);
    if (p.shortId) byShortId.set(p.shortId, true);
  }
  return actions.map((a) => {
    const auto =
      (a.ruleId !== undefined && byId.get(a.ruleId) === true) ||
      (a.ruleShortId !== undefined && byShortId.get(a.ruleShortId) === true);
    return auto ? { ...a, autoRemediable: true } : a;
  });
}

// -------------------------------------------------------------------------- the curve

/**
 * Cumulative problems closed after taking the top N actions — the one self-evidencing
 * headline this module exists to produce: "your problems collapse to N actions; the top
 * 10 close K%." `ranked` must already be in cover order (`rankActionsByCover`'s own
 * output); this function does no re-ranking of its own, only a running sum.
 */
export function coverCurve(
  ranked: readonly ActionRow[],
  total: number,
): Array<{ rank: number; cumulative: number; share: number }> {
  const out: Array<{ rank: number; cumulative: number; share: number }> = [];
  let cumulative = 0;
  let rank = 0;
  for (const a of ranked) {
    rank += 1;
    cumulative += a.problems;
    out.push({ rank, cumulative, share: total > 0 ? cumulative / total : 0 });
  }
  return out;
}

/**
 * The headline concentration figure: how many actions it takes to name the whole board,
 * and how much of it the first ten alone close. `top10Share` is the number the
 * `action-concentration-ratio` measure spec (measureSpec.ts) publishes — see that record's
 * own `goal` for what a ratio near 1:1 (no leverage) would mean on this data.
 */
export function concentrationRatio(
  ranked: readonly ActionRow[],
  total: number,
): { actions: number; problems: number; top10Share: number } {
  const problems = ranked.reduce((n, a) => n + a.problems, 0);
  const top10 = ranked.slice(0, 10).reduce((n, a) => n + a.problems, 0);
  return {
    actions: ranked.length,
    problems,
    top10Share: total > 0 ? top10 / total : 0,
  };
}
