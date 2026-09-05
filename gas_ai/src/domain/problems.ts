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
import {
  rankOne,
  type AiAdjacency,
  type ExploitationTier,
  type RankRule,
} from "./rank";
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

  // ---- WP6: the rank model's own INPUTS, carried onto the projection rather than left on
  // the source row. `withRankScores` takes a `ProblemRow`, so a term whose field never
  // reached this shape is a term the ranker reads as unmeasured — silently, and at full
  // strength, since the blend renormalises over what it can see. Projecting them is what
  // makes "this term scored null" mean "the source row had nothing to say" rather than
  // "the projection dropped it".
  /**
   * The exploitation ladder folded up from the row's linked findings, upstream. Absent is
   * `unknown` is UNMEASURED — `rank.exploitationOf` reads all three the same way and never
   * as `none`, which is the opposite claim.
   */
  exploitationTier?: ExploitationTier;
  /** The highest EPSS across those findings; demotes an `epss` tier below the rule's bar. */
  epssPeak?: number | null;
  /** Reasons text only — how many findings the tier was folded from. */
  exploitationFindingCount?: number;
  /** Where the row sits relative to the AI estate. Absent means no adjacency pass ran. */
  aiAdjacency?: AiAdjacency;
  /** The edge label an `ADJACENT` row came through — reasons text only. */
  adjacencyVia?: string;
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
  /**
   * WHICH DATE the clock read — `dueAt`, `createdAt`, or `null` when it read neither. Beside
   * `rankTimed` rather than folded into it: "overdue by 40 days" and "born 40 days ago and
   * nobody set a deadline" are both a measured clock and they are not the same claim, and a
   * surface that showed one number for both would be inventing a deadline.
   */
  rankTimeBasis?: "dueAt" | "createdAt" | null;
  /**
   * One clause per term that ENTERED the score, in blend order — `rank.ts`'s own `reasons`,
   * carried whole. This is the row's answer to "why is this above that one", and it is
   * shipped rather than re-derived on a surface for the same reason `rankScore` is: two
   * derivations of one number eventually disagree with no way for a reader to tell which is
   * lying.
   */
  rankReasons?: string[];
  /** The term names behind `rankReasons`, same order and same length — the audit half. */
  rankMeasured?: string[];
  /**
   * The exploitation and adjacency readings, published EVEN WHEN THEIR SHARE IS 0 and the
   * score therefore did not use them. `rank.ts`'s header states the argument: a reading the
   * score did not use is still a reading, and the evaluation harness needs it to decide
   * whether the share should move. `null` is unmeasured, never a zero reading.
   */
  rankExploitation?: number | null;
  rankAdjacency?: number | null;
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

/**
 * The five rank inputs the source rows carry, read STRUCTURALLY.
 *
 * Structural rather than off `IssueRow` / `FindingRow` for the reason `rank.ts`'s own header
 * gives for being shape-typed: these are three strings and two numbers, and a structural read lets
 * this projection compile against a ledger schema that has not grown the exploitation fold
 * yet — a row without them is a row the ranker reads as unmeasured, which is exactly what an
 * un-folded ledger IS. Not a cast: an unrecognised tier is dropped rather than passed
 * through, and `rank.exploitationOf` would read it as `null` anyway, so the two agree.
 */
interface RankSourceFields {
  exploitationTier?: unknown;
  epssPeak?: unknown;
  exploitationFindingCount?: unknown;
  aiAdjacency?: unknown;
  adjacencyVia?: unknown;
}

const EXPLOITATION_TIERS: readonly string[] = ["kev", "exploit", "epss", "none", "unknown"];
const AI_ADJACENCIES: readonly string[] = ["DIRECT", "ADJACENT", "UNLINKED"];

type RankInputFields = Pick<
  ProblemRow,
  "exploitationTier" | "epssPeak" | "exploitationFindingCount" | "aiAdjacency" | "adjacencyVia"
>;

function rankInputsOf(row: RankSourceFields): RankInputFields {
  const tier = String(row.exploitationTier ?? "").trim().toLowerCase();
  const adjacency = String(row.aiAdjacency ?? "").trim().toUpperCase();
  const peak = typeof row.epssPeak === "number" && Number.isFinite(row.epssPeak)
    ? row.epssPeak
    : undefined;
  const count = typeof row.exploitationFindingCount === "number"
    && Number.isFinite(row.exploitationFindingCount)
    ? row.exploitationFindingCount
    : undefined;
  const via = String(row.adjacencyVia ?? "").trim();
  return {
    exploitationTier: EXPLOITATION_TIERS.indexOf(tier) >= 0
      ? (tier as ExploitationTier)
      : undefined,
    epssPeak: peak,
    exploitationFindingCount: count,
    aiAdjacency: AI_ADJACENCIES.indexOf(adjacency) >= 0 ? (adjacency as AiAdjacency) : undefined,
    adjacencyVia: via || undefined,
  };
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
    ...rankInputsOf(issue as RankSourceFields),
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
    // The same read as the issue arm, against a row type that carries none of these fields
    // today. Deliberate: the fold is upstream of this projection and may reach findings
    // later, and an arm that silently could not see them would be the harder bug of the two.
    ...rankInputsOf(finding as RankSourceFields),
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
 * Stamp every row with the minimal model's score, and with the readings behind it. Pure: the
 * caller supplies the rule and the clock, exactly as `comboDigest` takes its `nowIso` rather
 * than reading one.
 *
 * EVERY FIELD `RankInput` OFFERS IS FILLED HERE, and that is the whole change over the
 * two-field version this replaced. The blend renormalises over the terms it can READ, so a
 * term whose input never reached the ranker is not scored low — it is dropped from both
 * halves of the fraction, and the row is silently ranked on fewer terms than the operator's
 * rule asked for. A half-filled `RankInput` therefore does not under-read the model; it
 * changes which model ran, on which rows, invisibly.
 */
export function withRankScores(
  rows: readonly ProblemRow[],
  rule: RankRule,
  nowIso: string,
): ProblemRow[] {
  return rows.map((row) => {
    const result = rankOne(
      {
        id: row.id,
        ruleId: row.ruleId,
        ruleShortId: row.ruleShortId,
        dueAt: row.dueAt ?? undefined,
        // THE BIRTH DATE, AND IT IS `firstSeenAt` ON BOTH ARMS. `FindingRow` carries no
        // `createdAt` field at all — `findingToProblemRow` maps its `firstSeenAt` into this
        // one, and `issueToProblemRow` maps the issue's own `createdAt` into the same place.
        // One field, one meaning: when this row started being true. Read only by
        // `timeSource: "dueAtElseAge"`, and only where there is no deadline.
        createdAt: row.firstSeenAt,
        exploitationTier: row.exploitationTier,
        epssPeak: row.epssPeak,
        exploitationFindingCount: row.exploitationFindingCount,
        aiAdjacency: row.aiAdjacency,
        adjacencyVia: row.adjacencyVia,
      },
      rule,
      nowIso,
    );
    return {
      ...row,
      rankScore: result.score,
      rankTimed: result.timeComponent !== null,
      rankTimeBasis: result.timeBasis,
      rankReasons: result.reasons,
      rankMeasured: result.measuredTerms,
      rankExploitation: result.exploitationComponent,
      rankAdjacency: result.adjacencyComponent,
    };
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
 *
 * THERE IS NOW AN OPTIONAL LEVEL 0, AND IT IS OFF. `compareProblemsBy(true)` puts
 * `rankScore` descending above all four, with an unranked row last; `compareProblemsBy(false)`
 * IS this function, by identity rather than by resemblance, so every existing caller and
 * every pinned expectation below is the same code path it was. The flag comes from the
 * `rank_leads_sort` setting, which DEFAULTS TO FALSE — the iron rule: leading the register by
 * a model's own number is a tuning change, it ships as a knob that does not move, and the
 * evaluation harness's figures are what should move it. The knob exists at all because a
 * rank nobody can put in front of the order it proposes cannot be evaluated against the one
 * it would replace; `getProblems` publishes `rankLeadsSort` and `rankSignature` beside the
 * rows so a page can say which of the two orders it is showing rather than leaving a reader
 * to infer it from the shuffle.
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

/**
 * The comparator this register orders by, with or without the rank model in the lead.
 *
 * `false` returns `compareProblems` ITSELF rather than a wrapper that delegates to it: the
 * proof that turning the flag off changes nothing is then a fact about the reference, not a
 * claim about a function body that could drift. An unscored row (`rankScore` absent, or a
 * non-finite number) sorts LAST at level 0 and then falls through to the four levels below —
 * the same "missing sorts last" convention `severityRank` and `slaRank` already keep, for the
 * same reason: a row the model never scored is not a mild row.
 */
export function compareProblemsBy(
  leadWithRank: boolean,
): (a: ProblemRow, b: ProblemRow) => number {
  if (!leadWithRank) return compareProblems;
  return (a, b) => {
    const ra = typeof a.rankScore === "number" && Number.isFinite(a.rankScore) ? a.rankScore : null;
    const rb = typeof b.rankScore === "number" && Number.isFinite(b.rankScore) ? b.rankScore : null;
    if (ra === null && rb !== null) return 1;
    if (rb === null && ra !== null) return -1;
    // Descending: a higher score is a worse row, and this cascade is worst-first throughout.
    if (ra !== null && rb !== null && ra !== rb) return rb - ra;
    return compareProblems(a, b);
  };
}

/**
 * A ranked copy — never sorts the caller's array in place, matching `sortAssetRows`.
 *
 * `leadWithRank` defaults to false, so every existing caller keeps today's order exactly.
 */
export function rankProblems(
  rows: readonly ProblemRow[],
  leadWithRank = false,
): ProblemRow[] {
  return [...rows].sort(compareProblemsBy(leadWithRank));
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
