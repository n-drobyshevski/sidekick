// The estate-wide Priorities: issues UNION findings, ranked together on one scale —
// Phase 7 of the Prioritization-to-Prediction rebuild.
//
// Neither existing page can answer "what do I work on Monday". `toxicCombos.ts` scopes
// issues to one expanded combination pattern; `configFindings.ts` scopes findings to the
// Cloud Configuration register. This module is the union of the two populations, projected
// into one shared row shape and ranked against each other on one scale — the thing neither
// page's scope lets it do.
//
// PURE AND DOMAIN-LAYER ON PURPOSE, same reasoning `assetTable.ts`'s own header gives and
// `toxicCombos.ts`'s comboSummary leans on: a ranking a reader can unit-test without
// booting the server is a ranking that cannot silently drift from what the endpoint ships.
// `compareProblems` below is the one true tiebreak; `api.ts`'s `getProblems` calls it and
// adds nothing of its own.

import type { DecisionVector, AmplificationFactor } from "./problem";
import { OUTCOME_VALUES, nodeAmplificationVector } from "./problem";
import type { FindingRow, GNode, IssueRow } from "./graphTypes";
import { isOpenGap, isUnresolvedIssue, type Severity } from "./config";
import type { Tier } from "./posture";

export type ProblemKind = "ISSUE" | "FINDING";

/**
 * Row ceiling for shipping the whole ranked union in one payload, mirroring
 * `assetTable.CLIENT_ALL_MAX` / `configFindings.CONFIG_CLIENT_ALL_MAX`. Under it the
 * browser holds every row, already ranked, and filters/paginates locally — the exact
 * `combos.js` issue-table shape this page's client module copies. Past it the server
 * applies the outcome filter and pages, like `getConfigFindings` past its own ceiling.
 */
export const PROBLEMS_CLIENT_ALL_MAX = 1000;

/**
 * One row on the Priorities page — an already-decided issue or finding, projected down to
 * exactly what the page ranks by and links from. Deliberately slimmer than `IssueRow` /
 * `FindingRow`: the drill-down (the Toxic Combinations issue sheet, the Cloud
 * Configuration finding sheet) fetches its own full record by `id`, the same "the register
 * row is a summary, the sheet fetches the rest" discipline `ConfigFindingView` keeps.
 */
export interface ProblemRow {
  id: string;
  kind: ProblemKind;
  /** The rule name — issuesV2's `ruleName`, or a finding's `ruleName`/`ruleShortId` fallback. */
  title: string;
  /** Null when the row's resource is not an asset the AI graph models (an unlinked finding). */
  assetId: string | null;
  assetName: string;
  /**
   * `Outcome`, stored as a bare string — `""` when this row was never decided (a row
   * synced before Phase 4, or one `decideProblemsWith` skipped). `""` is not a fifth
   * outcome; it sorts worse than TRACK in `compareProblems`, mirroring the identical
   * convention `configFindings.ts`'s `priorityRank` already documents: "not a 'TRACK or
   * better' claim, it is the absence of one."
   */
  problemOutcome: string;
  /** Null exactly when `problemOutcome` is `""` — nothing was ever derived to rank by. */
  vector: DecisionVector | null;
  unknowns: string[];
  /** SLA deadline. Null for a FINDING — `FindingRow` carries no `dueAt` field at all. */
  dueAt: string | null;
  /** The asset's posture tier, BESIDE the outcome — never blended into it (posture.ts's own rule). */
  postureTier: Tier | null;
  /** The within-outcome tiebreak vector problem.ts's own header names for exactly this use. */
  amplification: Record<string, AmplificationFactor>;
  /** Wiz's own severity — adjusted for an issue, the finding's own rating for a finding. */
  severity: Severity | null;

  // ---- P1a: the action key and the fields actions.ts's rollup needs, added purely
  // additively to this projection (every field below is optional or has a safe boolean
  // default, so no existing reader of a row built before this phase breaks).
  //
  // WHY THE KEY LIVES HERE RATHER THAN BEING RE-DERIVED FROM `title`. `title` is a rule
  // NAME, and names collide and drift (a rule renamed mid-sync, two differently-worded
  // rules that happen to render the same string) in a way an id does not — so a grouping
  // that mattered enough to rank a whole page by needed the id, not the label. See
  // actions.ts's own header for the full `ActionKey` reasoning.
  /** issuesV2's `ruleId` — always present (falls back to the combo group's own id, never
   *  absent) on an ISSUE row; absent on a FINDING row, which has no such field. */
  ruleId?: string;
  /** A finding's `ruleShortId` (e.g. `SUB-082`) — absent on an ISSUE row, which has none. */
  ruleShortId?: string;
  /** Worst of `projects[].riskProfile.businessImpact`, straight off the source row — same
   *  field IssueRow and FindingRow both already carry under this exact name. */
  businessImpact?: string;
  /** Whether Wiz traced this ROW back to IaC (`FindingRow.iacFindingIds`) — always false
   *  for an ISSUE row, which carries no such link. */
  iac: boolean;
  /** Whether an accepted-risk decision covers this ROW (`FindingRow.ignoreRuleIds`) —
   *  always false for an ISSUE row; `ignoreNote` is freeform lifecycle text, not this. */
  ignored: boolean;
  /** How long this has been true — issuesV2's `createdAt` for an issue, a configuration
   *  finding's `firstSeenAt` for a finding. Absent when the source never carried one. */
  firstSeenAt?: string;
  /**
   * The RULE's remediation template, never the per-instance text — `resolutionRecommendation`
   * for an issue, `FindingRow.remediationInstructions` for a finding. Named apart from any
   * plain `remediation` on purpose: `IssueRow.remediation` is a permanently empty column no
   * normalizer ever writes (do not read it), and `FindingRow.remediation` is per-INSTANCE and
   * genuinely diverges within one rule — `sheetsDb.ts`'s own `ai_findings` header notes
   * `remediation_instructions` repeats verbatim across every finding of the same rule, which
   * is exactly why THIS field, not that one, is safe for actions.ts to aggregate by rule.
   */
  ruleRemediation?: string;
}

/** One open toxic-combination issue, projected. */
export function issueToProblemRow(issue: IssueRow, node: GNode | undefined): ProblemRow {
  return {
    id: issue.id,
    kind: "ISSUE",
    title: issue.ruleName,
    assetId: issue.assetId || null,
    assetName: issue.assetName,
    problemOutcome: issue.problemOutcome ?? "",
    vector: issue.problemInput?.vector ?? null,
    unknowns: issue.problemInput?.unknowns ?? [],
    dueAt: issue.dueAt ?? null,
    postureTier: (node?.postureTier as Tier | undefined) ?? null,
    amplification: nodeAmplificationVector(node),
    severity: issue.adjustedSeverity ?? null,
    ruleId: issue.ruleId || undefined,
    businessImpact: issue.businessImpact,
    // No IaC link and no ignore-rule list on an issue — see this field's own doc comment.
    iac: false,
    ignored: false,
    firstSeenAt: issue.createdAt,
    ruleRemediation: issue.resolutionRecommendation,
  };
}

/**
 * One open, failing configuration finding, projected. `assetId`/`assetName` read the
 * GRAPH NODE, not the finding's own `resourceId`/`resourceName`, so an unlinked finding
 * (most AI-security rules fail on a region, an IAM policy, an identity no agent runs as —
 * `getAssets`'s own `complianceGapsUnlinked` comment) reports `assetId: null` rather than a
 * resource id the Inventory has never heard of, while still showing a readable name.
 */
export function findingToProblemRow(finding: FindingRow, node: GNode | undefined): ProblemRow {
  return {
    id: finding.id,
    kind: "FINDING",
    title: finding.ruleName || finding.ruleShortId || "",
    assetId: node ? node.id : null,
    assetName: node ? node.name : (finding.resourceName || finding.resourceId),
    problemOutcome: finding.problemOutcome ?? "",
    vector: finding.problemInput?.vector ?? null,
    unknowns: finding.problemInput?.unknowns ?? [],
    // FindingRow carries no SLA deadline — Wiz's config-finding evaluations have no dueAt
    // field, only issuesV2 does. Null, never a made-up date.
    dueAt: null,
    postureTier: (node?.postureTier as Tier | undefined) ?? null,
    amplification: nodeAmplificationVector(node),
    severity: finding.severity ?? null,
    ruleId: finding.ruleId,
    ruleShortId: finding.ruleShortId || undefined,
    businessImpact: finding.businessImpact,
    iac: (finding.iacFindingIds ?? []).length > 0,
    ignored: (finding.ignoreRuleIds ?? []).length > 0,
    firstSeenAt: finding.firstSeenAt,
    ruleRemediation: finding.remediationInstructions,
  };
}

/**
 * The union, whole. THE INVARIANT: `buildProblemRows(issues, findings, …).length` must
 * equal `issues.filter(isUnresolvedIssue).length + findings.filter(isOpenGap).length`
 * exactly — the same "nothing vanishes" guarantee `comboSummary` documents in
 * toxicCombos.ts (~line 220), applied here at the wider union scope: every unresolved
 * issue and every open finding lands in exactly one row, whether or not a verdict was
 * ever decided for it (see `ProblemRow.problemOutcome`'s own comment for the undecided
 * case). `test/problems.test.ts` asserts the count directly, and `getProblems` in api.ts
 * reports both halves so a caller can check it too.
 */
export function buildProblemRows(
  issues: readonly IssueRow[],
  findings: readonly FindingRow[],
  assetsById: ReadonlyMap<string, GNode>,
): ProblemRow[] {
  const rows: ProblemRow[] = [];
  for (const issue of issues) {
    if (!isUnresolvedIssue(issue)) continue;
    rows.push(issueToProblemRow(issue, assetsById.get(issue.assetId)));
  }
  for (const finding of findings) {
    if (!isOpenGap(finding)) continue;
    rows.push(findingToProblemRow(finding, assetsById.get(finding.resourceId)));
  }
  return rows;
}

// ------------------------------------------------------------------------------ ranking

/**
 * Position on the outcome scale, worst (ACT) first; undecided (`""`) sorts LAST, after
 * TRACK — mirrors `configFindings.ts`'s `priorityRank` exactly, for the identical reason.
 */
function outcomeRank(o: string): number {
  const i = (OUTCOME_VALUES as readonly string[]).indexOf(o);
  return i < 0 ? OUTCOME_VALUES.length : i;
}

/**
 * Worse tier (4) ranks first; an unscored asset (`null`) is UNKNOWN, not "no capability",
 * and must not silently outrank a known worse tier — so it sorts as though it were BELOW
 * tier 1, the same "missing sorts last" convention `assetTable.ts`'s own `score()` applies
 * to a missing AARS/posture-tier value.
 */
function postureRank(t: Tier | null): number {
  return t === null ? 0 : t;
}

const DAY_MS = 86400000;

/**
 * Deadline as a sortable number, soonest (including overdue, which is negative) first; a
 * row with no readable date sorts LAST either way — the same idea `dueRank` in this app's
 * client carries in `pages/comboView.js`, reproduced here because the domain layer cannot
 * import client code (nor should the client re-derive a ranking the domain layer owns).
 *
 * `Number.MAX_SAFE_INTEGER`, not `Infinity`: two rows that BOTH lack a deadline must
 * subtract to `0` so the comparator falls through to the next tiebreak level.
 * `Infinity - Infinity` is `NaN`, and a comparator that ever returns `NaN` stops the sort
 * on that pair (undefined behaviour that reads as "did nothing" in the engines this app
 * runs on) — silently burying the amplification and id levels beneath it. This was caught
 * by `problems.test.ts` before it ever reached a page.
 */
function slaRank(dueAt: string | null): number {
  const t = Date.parse(dueAt || "");
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/** The amplification vector's fixed axis order — `nodeAmplificationVector`'s own key order. */
const AMPLIFICATION_KEYS = ["tools", "identity", "persistence", "multiAgent", "context", "language"] as const;

/**
 * One amplification factor as a sortable number, HIGHER reading first. `null` (unmeasured)
 * is not evidence of amplification and must never outrank a confirmed reading — problem.ts's
 * own "absent must be null, never 0" discipline applies here too, so an unmeasured factor
 * sorts as the LOWEST possible reading on its axis, strictly below an explicit `0`.
 */
function amplificationFactorRank(v: AmplificationFactor | undefined): number {
  return v === null || v === undefined ? -1 : v;
}

/**
 * The Priorities page's ranking, worst-first at every level. Each level exists because the
 * level above it can and does tie — two rows in the same queue, on assets of the same
 * posture, due the same day — and the page still has to put ONE of them above the other,
 * every time, the same row, forever.
 *
 * 1. OUTCOME (ACT < ATTEND < TRACK_STAR < TRACK, undecided last). The whole reason this
 *    page exists: which queue a problem belongs in is the first and loudest fact about it.
 *
 * 2. ASSET POSTURE TIER, worst (4) first, unscored last. Two rows sharing an outcome can
 *    still describe very different Mondays: a TRACK_STAR issue on a BROAD-capability,
 *    WEAK-containment asset carries standing exposure a TRACK_STAR issue on a
 *    MINIMAL/STRONG asset does not. Posture is exactly the "what could this asset do, and
 *    what stands in its way" reading `posture.ts`'s own header argues is a fact
 *    independent of what has been found — which is why it breaks a tie the outcome itself
 *    cannot.
 *
 * 3. SLA URGENCY from `dueAt`, soonest (including overdue) first, no-deadline last. Once
 *    outcome and posture agree, a clock is the next most legible, most actionable
 *    difference between two problems — and the one a reader would reach for by hand if
 *    asked to break the tie themselves.
 *
 * 4. THE AMPLIFICATION VECTOR, compared lexicographically over its fixed axis order
 *    (tools, identity, persistence, multiAgent, context, language), each axis read
 *    higher-reading-first. `problem.ts`'s own header calls this vector "a within-outcome
 *    tiebreak for display" — this is that use, one level further down than "within
 *    outcome" alone because posture and SLA already resolved the two more legible ties
 *    first. It never reaches this deep for most rows; it exists for the residue.
 *
 * 5. ID, ascending. Final stability: two rows that agree on all four readings above must
 *    still sort the same way every time this runs, or a repaint would silently reshuffle
 *    a page nothing about the underlying data changed — the same discipline
 *    `comboView.js`'s `sortIssues` and `assetTable.ts`'s comparators both keep.
 */
export function compareProblems(a: ProblemRow, b: ProblemRow): number {
  const outcome = outcomeRank(a.problemOutcome) - outcomeRank(b.problemOutcome);
  if (outcome !== 0) return outcome;

  const posture = postureRank(b.postureTier) - postureRank(a.postureTier);
  if (posture !== 0) return posture;

  const sla = slaRank(a.dueAt) - slaRank(b.dueAt);
  if (sla !== 0) return sla;

  for (const key of AMPLIFICATION_KEYS) {
    const diff = amplificationFactorRank(b.amplification[key])
      - amplificationFactorRank(a.amplification[key]);
    if (diff !== 0) return diff;
  }

  return a.id.localeCompare(b.id);
}

/** A ranked copy — never sorts the caller's array in place, matching `sortAssetRows`. */
export function rankProblems(rows: readonly ProblemRow[]): ProblemRow[] {
  return [...rows].sort(compareProblems);
}

/**
 * Rows by outcome, `""` (undecided) kept alongside the four real outcomes — zeros kept,
 * same reasoning `problem.countProblemOutcomes` documents: an outcome nothing reached is
 * the finding, not an absence.
 */
export function countProblemRowsByOutcome(rows: readonly ProblemRow[]): Record<string, number> {
  const counts: Record<string, number> = { ACT: 0, ATTEND: 0, TRACK_STAR: 0, TRACK: 0, "": 0 };
  for (const r of rows) counts[r.problemOutcome] = (counts[r.problemOutcome] ?? 0) + 1;
  return counts;
}
