// REACH — the landscape-grain coverage roll-up. Phase P2b of the AARS scoring assessment
// (ai/AARS_SCORING_ASSESSMENT.md §3, the Specific test) asks a blunt question this app
// could not answer with a single number before this file: what fraction of the AI landscape
// did a sync actually TOUCH? A live tenant showing 97.58% of assets at AARS INFO and 97.2%
// of them landing on the posture fallback tier reads as "an exceptionally clean landscape" and
// reads equally well as "the landscape was never assessed" — `registerScopeDiagnostic`
// (server/diagnostics.ts) exists because those two readings call for opposite responses
// and nothing distinguished them. REACH is the same distinguishing question, computed once,
// pure, and shipped to every page instead of run by hand from the Apps Script editor.
//
// THIS IS A ROLL-UP, NOT A NEW MECHANISM. Six coverage mechanisms already exist in this
// codebase, each honest and each right at its own grain:
//   1. the four-state Posture Tier (posture.ts) — a capability envelope per asset;
//   2. `coverageSummary` (complianceOverview.ts) — which frameworks this deployment selected;
//   3. `unknownRate` (problemRule.ts's `treeDiscrimination`, postureRule.ts's
//      `postureDiscrimination`) — how often one axis of one rule could not be read;
//   4. `complianceGapsUnlinked` (api.ts) — the share of failing controls no AI asset owns;
//   5. the scan-area tally (scanContent.js's `coverageTally`) — whether a sync STEP ran;
//   6. `ConditionTally` (comboDigest.ts) — how many assets hold each risk condition.
// None of them answers "of everything on the register, how much did the pipeline actually
// reach, in one funnel a reader can hold in their head". That is the gap this file closes —
// by reading the same stored facts those six mechanisms already trust, never a seventh
// definition of any of them.
//
// OUTPUT IS PAIRED COUNTS, NEVER A SCORE. Every stage below is `{ covered, total }`, and
// `covered` is always a subset of a `total` recomputable from the same stored inputs
// `registerScopeDiagnostic` reads — the Specific test in ai/AARS_SCORING_ASSESSMENT.md §3:
// "no scored aggregate ships without its excluded-population count beside it." A UI that
// collapses a pair to a bare percentage, or prints `0` for a population nothing was ever
// asked about, has broken the one property that makes this file worth having — the caller
// renders `--` for a zero-total pair rather than a number that reads as measured.
//
// SCOPE. Stage 1 is measured over the WHOLE register (every row on `ai_assets`, substrate
// included — the exposure/identity/data-reach traversals pull in buckets, service accounts
// and hosts by design, exactly as `registerScopeDiagnostic`'s own header documents) and
// reports how much of it is AI-kinded. Stages 2 through 5 are then measured over THAT
// AI-kinded subset only: once the register's own scope question is answered, the funnel
// that follows is a claim about the AI landscape, not about the substrate that happens to
// share a tab with it. Each stage's own comment below names the exact predicate and the
// exact stored fields it reads.
//
// AXES ARE THE ONE PLACE THIS FILE CONVERTS RATHER THAN REPORTS RAW. `treeDiscrimination`
// (problemRule.ts) reports `unknownRate` — right for its own diagnostic audience, wrong for
// a posture panel: CIS Controls v8's own measurement guidance frames a metric so a RISING
// line reads as improvement, and "exploitation known on 2.7% of decided items" is the
// framing that behaves that way. "97.3% unknown" is the same fact stated so a rising line
// reads as WORSE, which is backwards for a panel whose whole point is legibility at a
// glance. So this file calls `treeDiscrimination` — never reimplements it — and inverts its
// unknownRate to a knownRate at this one boundary. `problemRule.ts` itself is UNTOUCHED.
//
// THE ONE PLACE A NAIVE INVERSION WOULD LIE: an axis with zero decided items has
// `unknownRate` 0 by construction (nothing to divide), and `1 - 0 = 1` would report "100%
// known" for a population that was never read at all — the exact false-green failure mode
// this whole panel exists to refuse. `axisKnown` below special-cases the empty population to
// `0`, not `1`: the conservative default, matching this codebase's standing rule that an
// unevidenced reading is never allowed to look better than an evidenced bad one (the same
// bias `SystemExposure.UNVERIFIED` and `conditionState`'s `null` already carry — see
// problem.ts and riskConditions.ts). A caller still must not render that `0` as a bare
// percentage on an empty population — see the PAIRED COUNTS note above.

import { AI_ASSET_KINDS, EDGE_TYPES, type GEdge, type GNode } from "./graphTypes";
import type { FindingRow, IssueRow } from "./graphTypes";
import { isOpenGap, isUnresolvedIssue } from "./config";
import { conditionHolds } from "./riskConditions";
import { CONDITION_KEYS } from "./toxicCombos";
import { OUTCOME_VALUES, type DecisionVector, type Outcome } from "./problem";
import { treeDiscrimination } from "./problemRule";

export interface ReachStage {
  key: string;
  label: string;
  covered: number;
  total: number;
}

/**
 * Declared relationship types that `graphEnrich` draws at READ time rather than a sync
 * persisting them — the four risk-condition stubs, the data-finding fold, and HAS_ISSUE.
 * They never appear on `ai_edges` and never should; listing them here is what lets the
 * census report a real coverage gap without an audience learning to discount it.
 *
 * Kept in this module rather than graphTypes.ts on purpose: it is a claim about where each
 * edge is BUILT, which only the census cares about, and graphTypes.ts's EDGE_TYPES is
 * deliberately a flat vocabulary with no provenance attached.
 */
export const READ_TIME_EDGE_TYPES: readonly string[] = [
  "HAS_ISSUE",
  "HAS_SENSITIVE_DATA",
  "HAS_ACCESS_TO_SENSITIVE_DATA",
  "EXPOSED_TO_INTERNET",
  "HAS_EXCESSIVE_PRIVILEGE",
  "HAS_DATA_FINDING",
];

export interface EstateReach {
  stages: ReachStage[];
  kinds: Array<{ kind: string; total: number; signal: number; ai: boolean }>;
  /**
   * `dead` is the coverage finding — declared in EDGE_TYPES and produced by nothing.
   * `synthetic` is drawn at graph-read time and correctly absent from `ai_edges`; it is
   * reported separately so its absence is never read as a gap. See the census below.
   */
  edges: { populated: string[]; dead: string[]; synthetic: string[]; declared: number };
  /** Per-axis known fraction (0–1) — NOT unknown. See this file's header for the inversion. */
  axes: Record<string, number>;
  /**
   * How many issues/findings `axes` was computed over — the same population
   * `treeDiscrimination` calls `decided`. `axes` alone cannot tell a caller "0% known" apart
   * from "nothing has been decided yet": both leave every axis reading `0` by this file's
   * own conservative default (see the header). A caller MUST treat `axesPopulation === 0`
   * as "no data" (render `--`), never as a measured 0% — the same PAIRED COUNTS discipline
   * every stage below is held to.
   */
  axesPopulation: number;
}

export interface EstateReachInput {
  /** Every row on `ai_assets`, exactly as persisted — `syncStore.loadAssets()`'s output. */
  assets: GNode[];
  /** Every row on `ai_issues`, resolved and unresolved both — filtered internally. */
  issues: IssueRow[];
  /** Every row on `ai_findings`, passing and failing both — filtered internally. */
  findings: FindingRow[];
  /**
   * Every row on `ai_edges`, exactly as persisted — the same population
   * `registerScopeDiagnostic`'s edge census reads (`readAll(TABS.edges)`), never the
   * synthetic HAS_ISSUE / risk-condition edges `loadGraphDoc` adds at read time. Reusing
   * the persisted rows here is what keeps this census and that one in permanent agreement.
   */
  edges: GEdge[];
}

/**
 * A row this app decided a problem outcome for — the same admission test api.ts's
 * `decidedForDiscrimination` applies to feed `previewProblemRule`'s `treeDiscrimination`
 * call, duplicated here in miniature rather than imported: api.ts is the server layer built
 * ON this domain layer, so a domain module cannot import from it without inverting that
 * dependency. Both copies exist to satisfy the same three-part admission test — an outcome,
 * a persisted `problemInput`, and an outcome value this build still recognises — and if
 * this test and that one ever need to diverge, that is itself a finding worth its own PR,
 * not a thing to paper over by importing across the layer boundary.
 */
function isDecidedRow(row: { problemOutcome?: string; problemInput?: { vector: DecisionVector; unknowns: string[] } }): boolean {
  return !!row.problemOutcome && !!row.problemInput
    && (OUTCOME_VALUES as readonly string[]).includes(row.problemOutcome);
}

/** Whether a graph traversal ever reached this AI asset at all — stage 3, "enriched". */
function isEnriched(edgeTouched: ReadonlySet<string>, a: GNode): boolean {
  if (edgeTouched.has(a.id)) return true;
  const ev = a.exposureEvidence;
  if (ev && (((ev.hostIds?.length ?? 0) > 0) || ((ev.endpointIds?.length ?? 0) > 0))) return true;
  return (a.humanAccess?.identityIds?.length ?? 0) > 0;
}

/**
 * `estateReach` — the whole roll-up, one pass over what a sync already persisted. See this
 * file's header for the six mechanisms it stands on and the boundary at which it converts
 * an unknown rate to a known one.
 */
export function estateReach(input: EstateReachInput): EstateReach {
  const { assets, issues, findings, edges } = input;

  // ---- shared sets, built once ------------------------------------------------------
  const unresolvedIssues = issues.filter(isUnresolvedIssue);
  const openFindings = findings.filter(isOpenGap);
  const issueAssetIds = new Set(unresolvedIssues.map((i) => i.assetId));
  const findingResourceIds = new Set(openFindings.map((f) => f.resourceId));

  const edgeTouched = new Set<string>();
  for (const e of edges) {
    edgeTouched.add(e.src);
    edgeTouched.add(e.dst);
  }

  // Stage 2, "observed" — an unresolved issue, an open failing finding, or a held risk
  // condition (the same four `CONDITION_KEYS` `comboDigest.ConditionTally` already tallies,
  // read here per-asset through `conditionHolds` rather than off the raw sheet booleans
  // `registerScopeDiagnostic` reads, so a hosted asset's host-hop exposure evidence counts).
  // Denominator: every row this predicate could possibly be asked about — see `kinds` below
  // for the whole-register version and each stage's own comment for the AI-kinded one.
  const hasSignal = (a: GNode): boolean =>
    issueAssetIds.has(a.id) || findingResourceIds.has(a.id)
    || CONDITION_KEYS.some((k) => conditionHolds(a, k));

  // ---- the kind histogram: registerScopeDiagnostic's finding, permanent in the UI --------
  // Every row on ai_assets, substrate included — this is deliberately NOT scoped to
  // AI_ASSET_KINDS, because the whole point of the histogram is to let a reader see whether
  // one non-AI kind dominates the register before trusting any AI-scoped fraction below it.
  const byKind = new Map<string, { total: number; signal: number }>();
  for (const a of assets) {
    const slot = byKind.get(a.kind) ?? { total: 0, signal: 0 };
    slot.total += 1;
    if (hasSignal(a)) slot.signal += 1;
    byKind.set(a.kind, slot);
  }
  const kinds = [...byKind.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([kind, s]) => ({
      kind,
      total: s.total,
      signal: s.signal,
      ai: (AI_ASSET_KINDS as readonly string[]).includes(kind),
    }));

  // ---- the five stages ------------------------------------------------------------------
  const aiAssets = assets.filter((a) => (AI_ASSET_KINDS as readonly string[]).includes(a.kind));

  const stages: ReachStage[] = [
    // 1. IN REGISTER. Denominator: every row on ai_assets (assets.length). Covered: the
    // AI-kinded subset (AI_ASSET_KINDS membership on ai_assets.kind) — the same number
    // registerScopeDiagnostic prints as "in AI_ASSET_KINDS". Everything past this stage is
    // scoped to that covered count, which is why it becomes every later stage's total.
    { key: "register", label: "In register", covered: aiAssets.length, total: assets.length },
    // 2. OBSERVED. Denominator: the AI-kinded population stage 1 established. Covered: AI
    // assets where hasSignal() holds — ai_issues.status (unresolved), ai_findings.result /
    // .status (open gap), or ai_assets' four condition columns (sensitive_data,
    // sensitive_access, high_priv, admin_priv, guardrail_missing, internet /
    // exposure_evidence_json) via conditionHolds. An asset with none of these contributes
    // nothing any scoring model can read — "carrying any signal" in
    // registerScopeDiagnostic's own words.
    {
      key: "observed", label: "Observed",
      covered: aiAssets.filter(hasSignal).length, total: aiAssets.length,
    },
    // 3. ENRICHED. Denominator: the AI-kinded population. Covered: AI assets a graph
    // traversal actually reached — participates in a row of ai_edges (src or dst), or
    // carries folded exposure evidence (ai_assets.exposure_evidence_json) or human-access
    // evidence (ai_assets.human_access_json). An asset with none of these was never walked
    // by anything past the mandatory inventory query.
    {
      key: "enriched", label: "Enriched",
      covered: aiAssets.filter((a) => isEnriched(edgeTouched, a)).length, total: aiAssets.length,
    },
    // 4. ATTRIBUTED. Denominator: the AI-kinded population. Covered: AI assets carrying a
    // business-impact tier (ai_assets.business_impact) — Wiz's own HBI/MBI/LBI read off the
    // asset's projects, folded at enrich time. Absent means no project reported one, or the
    // asset carries no project at all; never read as LOW (graphTypes.ts's own doc comment).
    {
      key: "attributed", label: "Attributed",
      covered: aiAssets.filter((a) => !!a.businessImpact).length, total: aiAssets.length,
    },
    // 5. DECIDED. Denominator: the AI-kinded population. Covered: AI assets carrying a
    // problem verdict (ai_assets.worst_open_problem, folded from the Phase 4 tree onto the
    // asset by graphEnrich.withProblemVerdicts) OR a persisted AARS score (ai_assets.aars).
    // Either is a model having reached a conclusion about this asset; an asset with neither
    // sits in the register unscored and unrouted.
    {
      key: "decided", label: "Decided",
      covered: aiAssets.filter((a) => typeof a.aars === "number" || a.worstOpenProblem !== undefined).length,
      total: aiAssets.length,
    },
  ];

  // ---- the edge census: registerScopeDiagnostic's own logic, not a second one -----------
  // Against the DECLARED vocabulary (EDGE_TYPES), never merely against what was found — a
  // census that only ever names what it saw could never report a dead relationship type,
  // which is the one thing it exists to report.
  //
  // But absent from `ai_edges` is NOT the same claim as never produced, and collapsing the
  // two would make this panel commit the exact error it exists to prevent, pointed the other
  // way. Six of the declared types are drawn at graph-READ time by `graphEnrich`'s stub
  // folds — the risk-condition edges and HAS_ISSUE — so they are correctly absent from the
  // persisted tab and their absence says nothing at all about coverage. Reporting them
  // beside USES_TOOL, which is declared in EDGE_TYPES and constructed by nothing anywhere,
  // would inflate the gap from four to ten and teach a reader to discount the number. So the
  // census splits them: `dead` is the honest coverage finding, `synthetic` is bookkeeping.
  const seenTypes = new Set(edges.map((e) => e.type as string));
  const populated = (EDGE_TYPES as readonly string[]).filter((t) => seenTypes.has(t));
  const unseen = (EDGE_TYPES as readonly string[]).filter((t) => !seenTypes.has(t));
  const synthetic = unseen.filter((t) => (READ_TIME_EDGE_TYPES as readonly string[]).includes(t));
  const dead = unseen.filter((t) => !(READ_TIME_EDGE_TYPES as readonly string[]).includes(t));

  // ---- per-axis known%: treeDiscrimination, called once, inverted at this boundary ------
  const decidedRows = [...issues, ...findings].filter(isDecidedRow);
  const decided = decidedRows.map((r) => ({
    outcome: r.problemOutcome as Outcome,
    vector: r.problemInput!.vector,
    unknowns: r.problemInput!.unknowns,
  }));
  const td = treeDiscrimination(decided);
  const n = decided.length;
  // n === 0 forces 0, never `1 - 0`. See this file's header for why that inversion would
  // otherwise report "100% known" on an axis nothing has ever been read on.
  const axisKnown = (rate: number): number => (n > 0 ? 1 - rate : 0);
  const axes: Record<string, number> = {
    exploitation: axisKnown(td.unknownRate.exploitation),
    impact: axisKnown(td.unknownRate.impact),
    exposure: axisKnown(td.unknownRate.exposure),
    mission: axisKnown(td.unknownRate.mission),
  };

  return {
    stages,
    kinds,
    edges: { populated, dead, synthetic, declared: EDGE_TYPES.length },
    axes,
    axesPopulation: n,
  };
}
