// The AI Decision Vector — Phase 3 of the Prioritization-to-Prediction rebuild
// (SMART-Repeatable: a security decision must be reachable by a repeatable procedure,
// not by a rater's gut). This is a 4-axis, 54-leaf classification TREE, and it exists to
// answer a different question than AARS (aars.ts) answers.
//
// AARS is a continuous 0–100 SCORE, built to RANK an estate against itself: its entire
// value is that (almost) every asset gets a different number, so "top 10" means
// something. This module is a discrete ROUTING tree, built to sort one issue or finding
// into one of four queues: ACT, ATTEND, TRACK*, TRACK. Its entire value is the opposite
// property — that MOST leaves land in TRACK or TRACK*, because most open issues really
// do deserve "keep watching this", and only a documented, auditable minority earn a
// human interrupt. `problemRule.ts`'s `actLeafCeiling` is what turns "the top band must
// stay scarce" from a hope into a number `validateProblemRule` checks on every edit.
//
// Reusing AARS's shape here — more pillars, summed points, a wider scale — would produce
// a fifth score nobody asked for and lose the property that makes a 4-outcome tree useful
// in the first place: a human can hold four queues in their head and cannot hold a
// distribution of a thousand scores. `decideProblem` below is first-match-wins over an
// ORDERED rule table for exactly the same reason AARS's gap cascade is: the order is the
// model, and it must be readable back as a sentence, not reverse-engineered from a
// formula.
//
// Nothing in this file is wired into api.ts, the store, or the client (Phase 3's whole
// contract — see the phase's PR description). It exists so Phase 4 can decide, from a
// working model run against real and adversarial fixtures, whether wiring it in is worth
// doing at all.

import type { FindingRow, GNode, IssueRow, NodeKind } from "./graphTypes";
import { AI_ASSET_KINDS } from "./graphTypes";
import { conditionState } from "./riskConditions";
import type { ProblemRule } from "./problemRule";

// ------------------------------------------------------------------------- the vector

/**
 * The four outcomes, WORST FIRST. `ACT` means "a human interrupts what they are doing
 * today"; `ATTEND` means "on this week's plan"; `TRACK_STAR` means "re-evaluate on new
 * information — nobody has checked something that matters"; `TRACK` means "the register
 * has this, no action implied". The order is load-bearing wherever a caller sorts by it
 * (worst-first, matching `SEVERITY_ORDER` and `AARS_SEVERITY_ORDER` in config.ts).
 */
export type Outcome = "ACT" | "ATTEND" | "TRACK_STAR" | "TRACK";
export const OUTCOME_VALUES: readonly Outcome[] = ["ACT", "ATTEND", "TRACK_STAR", "TRACK"];

/** Whether exploitation is confirmed, plausible, or simply not established. Three values. */
export type Exploitation = "ACTIVE" | "SUSPECTED" | "UNKNOWN";
export const EXPLOITATION_VALUES: readonly Exploitation[] = ["ACTIVE", "SUSPECTED", "UNKNOWN"];

/**
 * What a successful exploit would get. Deliberately two values, not three. A third
 * ("SIGNIFICANT" sitting between TOTAL and PARTIAL, the way SSVC itself offers it) would
 * take the tree from 3×2×3×3=54 leaves to 3×3×3×3=81 for an axis whose live evidence is
 * thin — today it resolves off three flags and one combo-group membership, nothing finer
 * grained. Fewer leaves that are honestly populated beats more leaves that mostly read
 * UNKNOWN.
 */
export type TechnicalImpact = "TOTAL" | "PARTIAL";
export const IMPACT_VALUES: readonly TechnicalImpact[] = ["TOTAL", "PARTIAL"];

/**
 * Whether the vulnerable system is reachable. `UNVERIFIED` is NOT a discount and NOT a
 * midpoint of severity — it is the epistemic state "nobody has checked", read straight off
 * `riskConditions.conditionState`'s own `null`. See `DEFAULT_PROBLEM_RULE`'s row 7 comment
 * in problemRule.ts for why it routes to `TRACK_STAR` rather than being ignored.
 */
export type SystemExposure = "OPEN" | "CONTROLLED" | "UNVERIFIED";
export const EXPOSURE_VALUES: readonly SystemExposure[] = ["OPEN", "CONTROLLED", "UNVERIFIED"];

/** How much the mission depends on the asset. `HIGH`/`MEDIUM`/`LOW` mirror Wiz's own HBI/MBI/LBI. */
export type Mission = "HIGH" | "MEDIUM" | "LOW";
export const MISSION_VALUES: readonly Mission[] = ["HIGH", "MEDIUM", "LOW"];

/**
 * The tree's own vocabulary — SSVC's four axes (exploitation, technical impact, system
 * exposure, mission/well-being) renamed to this product's domain, nothing more. 3 × 2 ×
 * 3 × 3 = 54 leaves; `enumerateDecisionVectors` below is what actually counts them, so
 * this comment cannot drift from the code the way a hardcoded "54" scattered through the
 * module could.
 */
export interface DecisionVector {
  exploitation: Exploitation;
  impact: TechnicalImpact;
  exposure: SystemExposure;
  mission: Mission;
}

/** All 54 leaves, in a fixed, deterministic order — nesting the axes in their declared order. */
export function enumerateDecisionVectors(): DecisionVector[] {
  const out: DecisionVector[] = [];
  for (const exploitation of EXPLOITATION_VALUES) {
    for (const impact of IMPACT_VALUES) {
      for (const exposure of EXPOSURE_VALUES) {
        for (const mission of MISSION_VALUES) {
          out.push({ exploitation, impact, exposure, mission });
        }
      }
    }
  }
  return out;
}

/**
 * A stable string key for a vector — the leaf-occupancy map's key, and the thing two
 * vectors must agree on to be "the same leaf". Order matches the axis declaration order
 * so the key reads the same way the tree is nested.
 */
export function leafKey(v: DecisionVector): string {
  return `${v.exploitation}|${v.impact}|${v.exposure}|${v.mission}`;
}

/**
 * Whether a vector satisfies a rule row's condition. An axis absent from `when` is a
 * WILDCARD — that is what lets `DEFAULT_PROBLEM_RULE`'s row 4 (`{ exploitation: ACTIVE }`
 * → ATTEND) catch every ACTIVE vector the three ACT rows above it did not, without
 * spelling out the other nine ACTIVE leaves by hand. Exported so `problemRule.ts` can
 * test the SAME predicate `decideProblem` uses when it enumerates leaves
 * (`leafCoverage`, `shadowedOutcomeRules`) — one implementation of "does this row match",
 * so a leaf tally can never disagree with what decided it.
 */
export function vectorMatches(vector: DecisionVector, when: Partial<DecisionVector>): boolean {
  if (when.exploitation !== undefined && when.exploitation !== vector.exploitation) return false;
  if (when.impact !== undefined && when.impact !== vector.impact) return false;
  if (when.exposure !== undefined && when.exposure !== vector.exposure) return false;
  if (when.mission !== undefined && when.mission !== vector.mission) return false;
  return true;
}

/**
 * First-match-wins over `rule.outcomeRules`. `matchedRuleIndex` is `-1` exactly when the
 * fallback fired — a `problemRuleSummary` / audit trail can always say WHICH row (or "no
 * row") produced an outcome, the same guarantee `gapPointsFor`'s cascade walk gives
 * pillar B.
 */
export function decideProblem(
  vector: DecisionVector,
  rule: ProblemRule,
): { outcome: Outcome; matchedRuleIndex: number } {
  for (let i = 0; i < rule.outcomeRules.length; i++) {
    const row = rule.outcomeRules[i]!;
    if (vectorMatches(vector, row.when)) return { outcome: row.outcome, matchedRuleIndex: i };
  }
  return { outcome: rule.fallbackOutcome, matchedRuleIndex: -1 };
}

// ------------------------------------------------------------------- deriving the axes

/** Which route put an issue's exploitation where it landed — the audit trail for the split below. */
export type ExploitationSource = "validated" | "ruleTable" | "aiVerdict" | "none";

export interface ProblemInput {
  vector: DecisionVector;
  /** Axis names ("exploitation" | "impact" | "exposure" | "mission") whose value could not be established. */
  unknowns: string[];
  /**
   * Whether the exposure reading came from an actual traversed path
   * (`node.exposureEvidence` found a host or endpoint), as opposed to a flag asserting
   * reachability with nothing behind it. NOT an axis — folding it in would double the
   * leaf count for a fact that only ever refines OPEN, never redirects the outcome — it
   * is display and a within-outcome tiebreak only. See `exposureOf` below.
   */
  evidenced: boolean;
  exploitationSource: ExploitationSource;
}

const REALIZED_OR_DEMONSTRATED = new Set(["REALIZED", "DEMONSTRATED"]);

/**
 * Exploitation for an ISSUE. THIS SPLIT IS LOAD-BEARING and every branch below exists for
 * a specific, tested reason — read the whole comment before touching any of the three.
 *
 * `ACTIVE` has exactly one door: `issue.validatedAsExploitable === true`. Nothing else may
 * open it, and the reason is `syncNormalize.ts`'s own contract for that field —
 * `if (raw["validatedAsExploitable"] === true) issue.validatedAsExploitable = true;` is
 * the ONLY place it is ever set. It is true-or-ABSENT, never `false`. Wiz saying "we
 * checked and this is not exploitable" and Wiz never having evaluated the issue at all
 * are therefore indistinguishable at this field — which is exactly why the fallback value
 * on this axis is called `UNKNOWN` and not `NONE` or `NOT_EXPLOITABLE`: calling it
 * anything that reads as a negative claim would assert something Wiz never told us.
 *
 * `SUSPECTED` has two doors, and both are DELIBERATELY capped below ACTIVE:
 *
 *   1. `rule.exploitationByRuleId` — an operator-maintained table keyed on the Wiz combo
 *      rule id, at `REALIZED` or `DEMONSTRATED` maturity (`FEASIBLE` does not qualify —
 *      "someone could" is not "someone has", and mixing the two would make every
 *      documented toxic-combination pattern read as suspected exploitation by default).
 *      This is an OPERATOR judgement, entered once per rule and reused across every issue
 *      it fires on — the human-in-the-loop half of the split.
 *
 *   2. `issue.aiVerdict` (`aiRemediationAnalysis.verdict`, e.g. `"REMEDIATE"`) matching
 *      `rule.remediateVerdicts`. This is an LLM RATER's opinion on ONE issue, not a
 *      human's judgement on a rule. It is non-deterministic upstream (the same issue can
 *      re-run to a different verdict) and its inter-rater reliability against a human
 *      analyst is unmeasured — which is precisely ISO 27004's definition of a subjective
 *      indicator, the kind a measurement programme must never let stand alone as evidence
 *      of the worst outcome. So it rides the MIDDLE rung only, same as route 1, and
 *      NEVER alone reaches ACTIVE — that is the SMART-Repeatable guarantee this whole
 *      split protects, and `problem.test.ts` asserts it directly: feed a fixture with
 *      `aiVerdict: "REMEDIATE"` and nothing else, and the vector must read SUSPECTED, not
 *      ACTIVE, no matter how confident the model's own wording sounds.
 *
 * `UNKNOWN` otherwise, and it is the common case — an issue Wiz has neither validated nor
 * matched against the rule table nor rated, which today is most of the register. That
 * rate is the finding, not a footnote: `treeDiscrimination`'s `unknownRate.exploitation`
 * is what makes it visible instead of silently defaulting everything to "probably fine".
 */
function exploitationOfIssue(
  issue: IssueRow,
  rule: ProblemRule,
): { exploitation: Exploitation; source: ExploitationSource } {
  if (issue.validatedAsExploitable === true) return { exploitation: "ACTIVE", source: "validated" };
  const row = rule.exploitationByRuleId.find((r) => r.ruleId === issue.ruleId);
  if (row && REALIZED_OR_DEMONSTRATED.has(row.maturity)) {
    return { exploitation: "SUSPECTED", source: "ruleTable" };
  }
  if (issue.aiVerdict && rule.remediateVerdicts.includes(issue.aiVerdict)) {
    return { exploitation: "SUSPECTED", source: "aiVerdict" };
  }
  return { exploitation: "UNKNOWN", source: "none" };
}

/**
 * Exploitation for a FAILING CONFIG FINDING. A `FindingRow` carries no
 * `validatedAsExploitable` and no `aiVerdict` — Wiz's exploit-validation and AI-remediation
 * pipelines both key off issues, not configuration findings — so a finding can only ever
 * reach `SUSPECTED`, via `rule.exploitationByRuleId` keyed on `finding.ruleShortId`, and
 * never `ACTIVE`. There is no third door to add here later without a new Wiz data source;
 * this is not an oversight, it is the ceiling the data actually supports.
 */
function exploitationOfFinding(
  finding: FindingRow,
  rule: ProblemRule,
): { exploitation: Exploitation; source: ExploitationSource } {
  const row = rule.exploitationByRuleId.find((r) => r.ruleId === finding.ruleShortId);
  if (row && REALIZED_OR_DEMONSTRATED.has(row.maturity)) {
    return { exploitation: "SUSPECTED", source: "ruleTable" };
  }
  return { exploitation: "UNKNOWN", source: "none" };
}

/**
 * Technical impact, shared by the issue and finding derivations. `comboGroup` is optional
 * because `FindingRow` carries no combo-group concept at all (that vocabulary belongs to
 * toxic-combination issues) — passing `undefined` simply removes one of the three sources,
 * exactly as an absent `node` removes the other two.
 *
 * `unknown` is TRUE only when NONE of the three sources produced a signal either way:
 * `hasAdminPrivileges` was never set, there is no `humanAccess` at all, and the combo
 * group (if any) is not one `rule.totalImpactGroups` names. This is worth stating
 * explicitly because the axis itself has only two VALUES (see `TechnicalImpact`'s
 * comment) — `unknowns` reports a RATE that exists independently of whether the axis has
 * a third value to fall into. An estate can be 40% "impact unknown" while every reading
 * that was made still says TOTAL or PARTIAL; collapsing the two would hide exactly the
 * coverage gap this whole tree exists to surface.
 */
function impactOf(
  node: GNode | undefined,
  comboGroup: string | undefined,
  rule: ProblemRule,
): { impact: TechnicalImpact; unknown: boolean } {
  const groupMatch = rule.totalImpactGroups.includes(comboGroup ?? "");
  const total = node?.hasAdminPrivileges === true || node?.humanAccess?.admin === true || groupMatch;
  const unknown = node?.hasAdminPrivileges === undefined && !node?.humanAccess && !groupMatch;
  return { impact: total ? "TOTAL" : "PARTIAL", unknown };
}

/**
 * System exposure, through `riskConditions.conditionState` — NEVER by reading
 * `isAccessibleFromInternet` / `isOpenToAllInternet` directly. That module's own header
 * explains why: those two flags disagreed across the app's two other exposure readers
 * until they were made to share one table, and `graphEnrich.internetExposureOf` is the
 * existing model for "go through the table" that this function copies rather than
 * re-deriving.
 *
 * `true` → OPEN, `false` → CONTROLLED, `null` (or no node at all — a target the graph
 * never reached is exactly as unverified as one it reached but could not read) →
 * UNVERIFIED, and UNVERIFIED always pushes `"exposure"` onto `unknowns`.
 *
 * `evidenced` is set independently of the exposure VALUE: `node.exposureEvidence` having
 * a non-empty `hostIds` or `endpointIds` means a traversal actually walked a path to this
 * asset, as opposed to a flag merely asserting one. It is evidence QUALITY, not a fifth
 * value — see `ProblemInput.evidenced`'s comment for why it stays off the axis.
 */
function exposureOf(node: GNode | undefined): {
  exposure: SystemExposure;
  unknown: boolean;
  evidenced: boolean;
} {
  if (!node) return { exposure: "UNVERIFIED", unknown: true, evidenced: false };
  const state = conditionState(node, "INTERNET_EXPOSURE");
  const exposure: SystemExposure = state === true ? "OPEN" : state === false ? "CONTROLLED" : "UNVERIFIED";
  const evidence = node.exposureEvidence;
  const evidenced =
    !!evidence && ((evidence.hostIds?.length ?? 0) > 0 || (evidence.endpointIds?.length ?? 0) > 0);
  return { exposure, unknown: state === null, evidenced };
}

/**
 * Mission, shared by the issue and finding derivations. `node?.businessImpact` is
 * preferred over the row's own `businessImpact` because the node's copy is the one
 * `enrichGraphDoc` freshly recomputes from the asset's OWN projects on every enrich pass
 * (see `graphTypes.GNode.businessImpact`'s comment); the row's copy can be stale the
 * moment the asset's project membership changes and is kept only as a fallback for a
 * node the graph never carried.
 *
 * Absent (neither source reports HBI/MBI/LBI) reads as `rule.missingMission`, defaulting
 * to MEDIUM — never LOW. "Wiz reported no business impact" and "an unattributed project"
 * are not claims that the mission is unimportant; reading them as LOW would let an
 * unclassified asset quietly discount its own risk.
 */
function missionOf(
  node: GNode | undefined,
  fallbackBusinessImpact: string | undefined,
  rule: ProblemRule,
): { mission: Mission; unknown: boolean } {
  const raw = node?.businessImpact ?? fallbackBusinessImpact;
  if (raw === "HBI") return { mission: "HIGH", unknown: false };
  if (raw === "MBI") return { mission: "MEDIUM", unknown: false };
  if (raw === "LBI") return { mission: "LOW", unknown: false };
  return { mission: rule.missingMission, unknown: true };
}

/**
 * The full vector for one open TOXIC-COMBINATION issue. Every axis is derived exactly as
 * this file's own axis functions document; nothing here re-decides anything, it only
 * assembles the four readings and the unknowns list they leave behind.
 */
export function deriveProblemInput(issue: IssueRow, node: GNode | undefined, rule: ProblemRule): ProblemInput {
  const unknowns: string[] = [];

  const { exploitation, source } = exploitationOfIssue(issue, rule);
  if (exploitation === "UNKNOWN") unknowns.push("exploitation");

  const { impact, unknown: impactUnknown } = impactOf(node, issue.comboGroup, rule);
  if (impactUnknown) unknowns.push("impact");

  const { exposure, unknown: exposureUnknown, evidenced } = exposureOf(node);
  if (exposureUnknown) unknowns.push("exposure");

  const { mission, unknown: missionUnknown } = missionOf(node, issue.businessImpact, rule);
  if (missionUnknown) unknowns.push("mission");

  return { vector: { exploitation, impact, exposure, mission }, unknowns, evidenced, exploitationSource: source };
}

/**
 * The full vector for one FAILING CONFIGURATION FINDING. Same shape as
 * `deriveProblemInput`, with exploitation's ceiling lowered to SUSPECTED (see
 * `exploitationOfFinding`) because a `FindingRow` carries neither of the two fields that
 * can reach ACTIVE or the AI-verdict rung of SUSPECTED.
 *
 * Deliberately does NOT gate on `isOpenGap` (config.ts) itself — the caller is expected to
 * have already filtered to open, failing findings before calling this, the same way
 * `buildAarsHintsFromFindings` filters before deriving. Gating inside would make this
 * function silently skip rows instead of scoring them, which is the wrong failure mode
 * for something that is meant to be called once per finding a caller has already decided
 * is in scope.
 */
export function deriveFindingProblemInput(
  finding: FindingRow,
  node: GNode | undefined,
  rule: ProblemRule,
): ProblemInput {
  const unknowns: string[] = [];

  const { exploitation, source } = exploitationOfFinding(finding, rule);
  if (exploitation === "UNKNOWN") unknowns.push("exploitation");

  // FindingRow carries no comboGroup — the third impact source simply contributes nothing.
  const { impact, unknown: impactUnknown } = impactOf(node, undefined, rule);
  if (impactUnknown) unknowns.push("impact");

  const { exposure, unknown: exposureUnknown, evidenced } = exposureOf(node);
  if (exposureUnknown) unknowns.push("exposure");

  const { mission, unknown: missionUnknown } = missionOf(node, finding.businessImpact, rule);
  if (missionUnknown) unknowns.push("mission");

  return { vector: { exploitation, impact, exposure, mission }, unknowns, evidenced, exploitationSource: source };
}

// --------------------------------------------------------------- the amplification vector

/** One AIVSS-shaped amplification factor: none / partial / full, or genuinely unmeasured. */
export type AmplificationFactor = 0 | 0.5 | 1 | null;

/**
 * AI-asset kinds (a subset of `AI_ASSET_KINDS`) whose entire function is receiving and
 * acting on natural-language instruction — an agent, a tool/skill surface it can invoke,
 * or the registry/gateway/service wrapper around one. Excluded, deliberately:
 * `AI_MODEL` (the underlying model is reached through an API contract, not commanded),
 * `AI_GUARDRAIL` (a control layer, not a command surface), `AI_PIPELINE` (batch ML
 * training, not conversational) and `AI_DATASET` (data, not an actor). The distinction
 * this list draws is exactly the one `language`'s doc comment below needs: "can this
 * asset be steered by what it is told", not "is this asset AI-related".
 */
const AGENTIC_ASSET_KINDS: readonly NodeKind[] = [
  "AI_AGENT", "AI_AGENT_REGISTRY", "MCP_SERVER", "AI_SKILL", "AI_SKILL_TEMPLATE",
  "AI_TOOL", "AI_EXTENSION", "AI_GATEWAY", "AI_SERVICE", "AI_DEPLOYMENT",
];

/**
 * Identity amplification: how much privilege the asset's execution identity carries.
 * `hasAdminPrivileges` / `hasHighPrivileges` are Wiz's own digested read of the RUNS_AS
 * relationship (the same two flags `riskConditions.conditionState`'s EXCESSIVE_PRIVILEGE
 * branch reads directly off the node, with no edge walk of our own) — their PRESENCE is
 * what stands in for "the RUNS_AS identity was evaluated" here, since this function's
 * signature carries no access to the graph's edge list to walk RUNS_AS itself.
 * `humanAccess.permissionCount` adds a second, independent partial-credit signal: a human
 * identity that can reach the asset with real permissions, short of admin.
 */
function identityFactor(node: GNode | undefined): AmplificationFactor {
  if (!node) return null;
  if (node.hasAdminPrivileges === true) return 1;
  const permissionCount = node.humanAccess?.permissionCount;
  if (node.hasHighPrivileges === true || (typeof permissionCount === "number" && permissionCount > 0)) {
    return 0.5;
  }
  if (node.hasAdminPrivileges === false || node.hasHighPrivileges === false || node.humanAccess) return 0;
  return null;
}

/**
 * Context amplification: how much data the asset can reach. `hasSensitiveData` /
 * `hasAccessToSensitiveData` are the direct classification flags; `dataFindingCount` (a
 * datastore-only field) adds a graded reading when the asset reaches a store carrying
 * classified findings without itself tripping either boolean.
 */
function contextFactor(node: GNode | undefined): AmplificationFactor {
  if (!node) return null;
  if (node.hasSensitiveData === true || node.hasAccessToSensitiveData === true) return 1;
  const findingCount = node.dataFindingCount;
  if (typeof findingCount === "number") return findingCount > 0 ? 0.5 : 0;
  if (node.hasSensitiveData === false || node.hasAccessToSensitiveData === false) return 0;
  return null;
}

/**
 * Language amplification: whether natural language IS this asset's control channel. `1`
 * for any node whose kind is in `AGENTIC_ASSET_KINDS`, else `null` — not `0`. A model,
 * dataset or guardrail node is not "confirmed safe from language-driven amplification";
 * the factor simply does not apply to it, which is exactly what `null` means throughout
 * this vector.
 */
function languageFactor(node: GNode | undefined): AmplificationFactor {
  if (!node) return null;
  return (AGENTIC_ASSET_KINDS as readonly string[]).includes(node.kind) ? 1 : null;
}

/**
 * Six AIVSS-shaped amplification factors — `tools`, `identity`, `persistence`,
 * `multiAgent`, `context`, `language` — each `0 | 0.5 | 1` or `null`.
 *
 * READ THIS BEFORE CHANGING ANYTHING BELOW: **absent must be `null`, never `0`.** This is
 * the single most important rule in this function. `tools`, `persistence` and
 * `multiAgent` need the `USES_TOOL` / `INVOKES_TOOL` / `USES_DATASET` edges — and no LIVE
 * Wiz query this app runs produces them. They exist only in two places: the hand-authored
 * `sampleData.ts` seed estate, and the `AGENT_EXPANSION` fixture, which is never
 * persisted. On real tenant data these three factors have NOTHING to read, and this
 * function returns `null` for all three, always, on every live node. An unmeasured
 * factor reading as `0` would render as "confirmed no tool access, confirmed no
 * persistence, confirmed single-agent" — which is not a measurement, it is a guess
 * dressed as one, and it would make the most dangerous unmeasured agents look the safest.
 * That is the exact failure this whole phase exists to make impossible to ship by
 * accident; `problem.test.ts` asserts these three read `null`, never `0`, on a
 * realistic live-shaped node.
 *
 * Only three factors are derivable today, from fields the live graph actually carries:
 * `identity` (`identityFactor`), `context` (`contextFactor`) and `language`
 * (`languageFactor`) — each documented at its own function.
 *
 * `issue` is accepted for signature symmetry with `deriveProblemInput` and because a
 * future factor (e.g. a prompt-injection issue naming the exact tool call it abused)
 * would plausibly key off the ISSUE rather than the node; none of the three factors
 * implemented today read it.
 *
 * This vector is an EXPLANATION — "why does this leaf look the way it does" — and a
 * within-outcome tiebreak for display, and it MUST NEVER reach `decideProblem`: that
 * function's signature takes a `DecisionVector`, which has no slot for it, and
 * `problem.test.ts` asserts that permuting this vector across its whole range while
 * holding the `DecisionVector` fixed never changes `decideProblem`'s outcome. Folding
 * amplification into the decision would let an EXPLANATION silently become a VOTE, which
 * is the one thing a routing tree, as opposed to a score, must never allow.
 */
export function amplificationVector(
  issue: IssueRow,
  node: GNode | undefined,
): Record<string, AmplificationFactor> {
  void issue; // see doc comment — accepted for symmetry, unread by the three live factors
  return {
    tools: null,
    identity: identityFactor(node),
    persistence: null,
    multiAgent: null,
    context: contextFactor(node),
    language: languageFactor(node),
  };
}
