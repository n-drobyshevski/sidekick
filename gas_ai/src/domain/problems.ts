// The landscape-wide Priorities: issues UNION findings, ranked together on one scale —
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
import { SEVERITY_ORDER, isOpenGap, isUnresolvedIssue, type Severity } from "./config";
import { rankOne, type RankRule } from "./rank";
import { postureStateOf, type PostureState, type Tier } from "./posture";

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
   * The asset's owning business domain. Null for the same rows `assetId` is null for, and
   * for the same reason: an unlinked finding has no node to read a tag from.
   */
  domain: string | null;
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
  /**
   * WHY there is no tier, when there is none. Null only for a row whose asset the graph never
   * carried at all — a third kind of absence, which the register already shows as an unlinked
   * finding. `WITHHELD` is a coverage gap someone can close; `OUT_OF_SCOPE` says this lattice
   * does not describe this kind of asset, and no amount of measuring would change that.
   *
   * Shipping only the tier forced both to render as the same blank cell, which on a live
   * register is the overwhelming majority of rows and reads as breakage rather than as an
   * honest refusal to rate.
   */
  postureState: PostureState | null;
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
  /**
   * The minimal model's ordering key, 0..1 — `domain/rank.ts`. Computed SERVER-SIDE and shipped
   * on the row on purpose: `actionView.js`'s header argues at length against a client-computed
   * sort presented as a smart default, because the headline figures above these tables are
   * computed over the server's order and the two would silently disagree. One ranking authority.
   */
  rankScore?: number;
  /**
   * False when the row carries no deadline, so the clock half of `rankScore` is UNMEASURED and
   * the score is the operator judgement alone. Shipped separately rather than folded into the
   * number, so a surface can hatch it instead of implying a reading nobody took.
   */
  rankTimed?: boolean;
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
    domain: node?.domain ?? null,
    problemOutcome: issue.problemOutcome ?? "",
    vector: issue.problemInput?.vector ?? null,
    unknowns: issue.problemInput?.unknowns ?? [],
    dueAt: issue.dueAt ?? null,
    postureTier: (node?.postureTier as Tier | undefined) ?? null,
    postureState: node ? postureStateOf(node) : null,
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
    domain: node?.domain ?? null,
    problemOutcome: finding.problemOutcome ?? "",
    vector: finding.problemInput?.vector ?? null,
    unknowns: finding.problemInput?.unknowns ?? [],
    // FindingRow carries no SLA deadline — Wiz's config-finding evaluations have no dueAt
    // field, only issuesV2 does. Null, never a made-up date.
    dueAt: null,
    postureTier: (node?.postureTier as Tier | undefined) ?? null,
    postureState: node ? postureStateOf(node) : null,
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

/**
 * Stamp every row with the minimal model's score. Pure: the caller supplies the rule and the
 * clock, exactly as `comboDigest` takes its `nowIso` rather than reading one.
 */
export function withRankScores(
  rows: readonly ProblemRow[],
  rule: RankRule,
  nowIso: string,
): ProblemRow[] {
  return rows.map((row) => {
    const result = rankOne(
      { id: row.id, ruleId: row.ruleId, ruleShortId: row.ruleShortId, dueAt: row.dueAt ?? undefined },
      rule,
      nowIso,
    );
    return { ...row, rankScore: result.score, rankTimed: result.timeComponent !== null };
  });
}

// ------------------------------------------------------------------------------ ranking

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
 * runs on) — silently burying the age and id levels beneath it. This was caught by
 * `problems.test.ts` before it ever reached a page.
 */
function slaRank(dueAt: string | null): number {
  const t = Date.parse(dueAt || "");
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

/**
 * Wiz's severity as a sortable number, worst first; an unrated row sorts LAST.
 *
 * Same "missing sorts last" convention every other comparator in this app keeps. A row with
 * no severity is not a mild row — it is one Wiz never rated — and it must not be able to
 * outrank a known CRITICAL by being absent.
 */
function severityRank(sev: Severity | null): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(String(sev ?? ""));
  return i < 0 ? SEVERITY_ORDER.length : i;
}

/**
 * The Priorities page's ranking, worst-first at every level. Each level exists because the
 * level above it can and does tie — two rows of the same severity, due the same day — and
 * the page still has to put ONE of them above the other, every time, the same row, forever.
 *
 * THE OUTCOME AND THE POSTURE TIER USED TO LEAD IT, and both are gone from here. They are
 * this app's own derived verdicts, they are experimental, and they now reach the Scoring
 * Models page and nothing else. What replaced them is not a weaker version of the same
 * claim; it is a claim Wiz itself makes, plus a clock.
 *
 * 1. SEVERITY, worst first, unrated last. Wiz's own rating — adjusted for an issue, the
 *    finding's own for a finding. It is the loudest fact about a problem that this app did
 *    not invent.
 *
 * 2. SLA URGENCY from `dueAt`, soonest (including overdue) first, no-deadline last. Once
 *    severity agrees, a clock is the next most legible, most actionable difference between
 *    two problems — and the one a reader would reach for by hand if asked to break the tie
 *    themselves. It was level 3 before and simply moved up.
 *
 * 3. AGE from `firstSeenAt`, oldest first. A problem that has been open longer has been
 *    declined longer. This replaces the amplification vector, which was the problem
 *    MODEL's own input vector — ranking by it was ranking by the model through a side
 *    door — and unlike that vector, "this one has been open since April" is a fact a
 *    reader can verify in the row itself.
 *
 * 4. ID, ascending. Final stability: two rows that agree on all three readings above must
 *    still sort the same way every time this runs, or a repaint would silently reshuffle a
 *    page nothing about the underlying data changed — the same discipline
 *    `comboView.js`'s `sortIssues` and `assetTable.ts`'s comparators both keep.
 */
export function compareProblems(a: ProblemRow, b: ProblemRow): number {
  const sev = severityRank(a.severity) - severityRank(b.severity);
  if (sev !== 0) return sev;

  const sla = slaRank(a.dueAt) - slaRank(b.dueAt);
  if (sla !== 0) return sla;

  // Oldest first, and an absent date last: a row whose source never carried one is not
  // "brand new", it is unknown, and it must not jump ahead of a dated row either way.
  const aSeen = a.firstSeenAt || "";
  const bSeen = b.firstSeenAt || "";
  if (aSeen !== bSeen) {
    if (!aSeen) return 1;
    if (!bSeen) return -1;
    return aSeen < bSeen ? -1 : 1;
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
