// The Asset Posture Tier — Phase 6 of the Prioritization-to-Prediction rebuild, and a
// deliberate STRUCTURAL PORT of problem.ts/problemRule.ts (the Phase 3/5 decision tree)
// onto a different question. Read problem.ts's own header before this one; the two exist
// side by side for reasons this file does not repeat.
//
// AN ASSET'S POSTURE IS ITS CAPABILITY ENVELOPE AGAINST ITS CONTAINMENT — NOT THE SUM OF
// WHAT HAS BEEN FOUND ON IT. Two reasons, and both are load-bearing:
//
//   1. An agent with ZERO open issues and unrestricted tool access over sensitive data is
//      not low risk. A model that aggregates open problems (count them, sum their
//      severities, average their outcomes) reads that agent as "nothing to see" — it has
//      no findings to aggregate — right up until the day something is found on it, at
//      which point the capability was there the whole time and nobody was watching it.
//      Posture answers "what could this asset do, and what is standing in its way" —
//      a question that has an answer even when nothing has gone wrong YET.
//
//   2. Averaging across findings is exactly what the ordinal critique in
//      ai/AARS_SCORING_ASSESSMENT.md §3 rules out — points on an ordinal scale (severity
//      levels, privilege tiers, exposure states) do not carry the equal-interval property
//      an average assumes, so "the mean of three MEDIUM findings and one CRITICAL" is not
//      a meaningful number, it is an arithmetic operation performed on labels. This module
//      answers with the same mechanism `decideProblem` does — a first-match-wins cascade
//      over a fixed lattice — for the same reason: an ORDER is a claim a human can read
//      back as a sentence, and a MEAN is not.
//
// A LATTICE WITH A FIRST-MATCH-WINS CASCADE — NOT AN AVERAGE. Restated once more because
// it is the single most important design decision in this file: an average over "available
// dimensions" REWARDS MISSING DATA. An asset with only `capability` measured, pinned at its
// worst reading (BROAD), and both `containment` and `consequence` unmeasured, averages —
// under any scheme that drops the unmeasured axes rather than penalizing them — to the SAME
// number as an asset whose measured BROAD capability sits inside a STRONG containment with
// LIMITED consequence. The fix a mean-based design reaches for is a "critical-dimension
// override" (if ANY axis reads at its worst, override the mean) — and once that override
// exists, the mean is decorative: the override is doing 100% of the classification work on
// every asset that has one worst-reading axis, and the mean only ever speaks for the
// (usually thin) remainder. `decidePosture` below is that override with the mean deleted:
// first-match-wins over an ORDERED rule table, exactly `problem.decideProblem`'s shape,
// because it is the SAME mechanism solving the SAME problem a second time.

import type { GNode } from "./graphTypes";
import { OUTCOME_VALUES, type Outcome } from "./problem";
import { conditionState } from "./riskConditions";
import type { PostureRule } from "./postureRule";

// ------------------------------------------------------------------------- the vector

/** Identity power and data reach. `BROAD` is the worst reading — see `derivePostureInput`. */
export type Capability = "BROAD" | "SCOPED" | "MINIMAL";
export const CAPABILITY_VALUES: readonly Capability[] = ["BROAD", "SCOPED", "MINIMAL"];

/** How much stands between the asset and the outside world. `WEAK` is the worst reading. */
export type Containment = "WEAK" | "PARTIAL" | "STRONG";
export const CONTAINMENT_VALUES: readonly Containment[] = ["WEAK", "PARTIAL", "STRONG"];

/** What a realized failure would cost. `SEVERE` is the worst reading. */
export type Consequence = "SEVERE" | "MODERATE" | "LIMITED";
export const CONSEQUENCE_VALUES: readonly Consequence[] = ["SEVERE", "MODERATE", "LIMITED"];

/**
 * The 27-cell lattice: capability × containment × consequence, 3 × 3 × 3. `Partial` of
 * this interface is what `PostureRule.tierRules[].when` matches against — see
 * `postureVectorMatches`.
 *
 * The three "lethal trifecta" legs (Willison: private data reach ∧ untrusted-content
 * ingress ∧ external egress capacity — a pattern independent of, and orthogonal to,
 * capability/containment/consequence) live here too, but OFF the 27-cell lattice: they
 * are optional, and `enumeratePostureVectors` below builds its 27 leaves from
 * `CAPABILITY_VALUES` × `CONTAINMENT_VALUES` × `CONSEQUENCE_VALUES` alone, never touching
 * them, so their presence on this interface cannot inflate the 27 and no leaf's identity
 * (`postureKey`) ever reads them. They are modelled as fields on `PostureVector` — rather
 * than as a fourth value bolted onto one of the three enums above — for one reason:
 * `PostureRule.tierRules[].when` is typed `Partial<PostureVector>`, mirroring
 * `problemRule.OutcomeRule.when`'s `Partial<DecisionVector>` exactly, and that is the ONLY
 * shape a cascade row can reference. A fourth enum literal would have to join
 * `CAPABILITY_VALUES` (or one of its siblings) to be enumerable at all, which would make
 * the trifecta ONE MORE READING of capability instead of what it actually is: a different,
 * later axis this app has almost no signal for. Three narrow optional fields say that
 * honestly; a stretched fourth enum value would not.
 *
 * `derivePostureInput` NEVER sets any of the three — see that function's own comment for
 * why even `privateData`, which technically has a real source (`hasAccessToSensitiveData` /
 * `businessImpact`, the same signals `consequence` already reads), is left undefined here
 * too. This is what makes `DEFAULT_POSTURE_RULE`'s lethal-trifecta row GENUINELY
 * unreachable — not shadowed, not merely unexercised by today's estate, but structurally
 * unable to match any of the 27 canonical leaves OR any live-derived vector, which is what
 * `unreachableTierRules` (postureRule.ts) checks and the Posture tab labels dead.
 */
export interface PostureVector {
  capability: Capability;
  containment: Containment;
  consequence: Consequence;
  /** See this interface's own comment. Never set by `derivePostureInput` today. */
  privateData?: boolean;
  /** Never set by `derivePostureInput` — no untrusted-ingress signal exists anywhere in graphTypes.ts. */
  untrustedIngress?: boolean;
  /** Never set by `derivePostureInput` — no external-egress signal exists anywhere in graphTypes.ts. */
  externalEgress?: boolean;
}

/** 4 = worst, matching the "lower rank number = better" convention `severityRank` also uses inverted. */
export type Tier = 1 | 2 | 3 | 4;
export const TIER_VALUES: readonly Tier[] = [1, 2, 3, 4];

/** All 27 leaves, in a fixed, deterministic order — nesting the three axes in declared order. */
export function enumeratePostureVectors(): PostureVector[] {
  const out: PostureVector[] = [];
  for (const capability of CAPABILITY_VALUES) {
    for (const containment of CONTAINMENT_VALUES) {
      for (const consequence of CONSEQUENCE_VALUES) {
        out.push({ capability, containment, consequence });
      }
    }
  }
  return out;
}

/**
 * A stable string key for a CELL — the 27-lattice identity, deliberately built from only
 * the three canonical axes. The trifecta fields are never part of a cell's identity: they
 * cannot appear on any of the 27 enumerated leaves (see `PostureVector`'s own comment), so
 * folding them into the key would either be redundant (always absent) or, worse, invite a
 * future edit to start keying occupancy maps on a field that is never actually observed.
 */
export function postureKey(v: PostureVector): string {
  return `${v.capability}|${v.containment}|${v.consequence}`;
}

/**
 * Whether a vector satisfies a rule row's condition. Mirrors `problem.vectorMatches`
 * exactly, widened to the three optional trifecta fields: an axis (or leg) absent from
 * `when` is a WILDCARD, and a leg PRESENT in `when` can only ever match a vector that also
 * carries it — which, for the trifecta legs, no vector ever does (see `PostureVector`'s
 * comment), so a `when` naming any of them is unreachable by construction rather than by
 * convention. Exported so `postureRule.ts` tests the SAME predicate `decidePosture` uses
 * when it enumerates leaves (`cellCoverage`, `shadowedTierRules`, `unreachableTierRules`).
 */
export function postureVectorMatches(vector: PostureVector, when: Partial<PostureVector>): boolean {
  if (when.capability !== undefined && when.capability !== vector.capability) return false;
  if (when.containment !== undefined && when.containment !== vector.containment) return false;
  if (when.consequence !== undefined && when.consequence !== vector.consequence) return false;
  if (when.privateData !== undefined && when.privateData !== vector.privateData) return false;
  if (when.untrustedIngress !== undefined && when.untrustedIngress !== vector.untrustedIngress) return false;
  if (when.externalEgress !== undefined && when.externalEgress !== vector.externalEgress) return false;
  return true;
}

/**
 * First-match-wins over `rule.tierRules`. `matchedRuleIndex` is `-1` exactly when the
 * fallback fired — same contract as `problem.decideProblem`, and the same reason: an audit
 * trail can always say WHICH row (or "no row") produced a tier.
 */
export function decidePosture(
  vector: PostureVector,
  rule: PostureRule,
): { tier: Tier; matchedRuleIndex: number } {
  for (let i = 0; i < rule.tierRules.length; i++) {
    const row = rule.tierRules[i]!;
    if (postureVectorMatches(vector, row.when)) return { tier: row.tier, matchedRuleIndex: i };
  }
  return { tier: rule.fallbackTier, matchedRuleIndex: -1 };
}

// ------------------------------------------------------------------- deriving the axes

export interface PostureInput {
  vector: PostureVector;
  /** Axis names ("capability" | "containment" | "consequence") whose reading could not be established. */
  unknowns: string[];
}

/**
 * Capability: identity power and data reach.
 *
 * `BROAD` when `hasAdminPrivileges === true` OR `humanAccess?.admin === true` OR
 * (`hasHighPrivileges === true` AND `hasAccessToSensitiveData === true`) — admin identity
 * power, OR high privilege paired with reach into classified data, which is the same
 * "elevated rights ∧ sensitive reach" combination `problem.impactOf`'s TOTAL reading and
 * `riskConditions`'s EXCESSIVE_PRIVILEGE branch both treat as the ceiling case.
 * `SCOPED` when `hasHighPrivileges === true` OR `hasAccessToSensitiveData === true` alone.
 * `MINIMAL` otherwise.
 *
 * TOOL BREADTH BELONGS HERE AND CANNOT BE READ. `USES_TOOL` / `INVOKES_TOOL` are declared
 * in `EDGE_TYPES` (graphTypes.ts) and produced by NO LIVE QUERY this app runs — they exist
 * only in the hand-authored `sampleData.ts` seed and the never-persisted `AGENT_EXPANSION`
 * fixture (see `problem.amplificationVector`'s own header for the identical finding on the
 * `tools` amplification factor). This function does NOT silently treat that absence as "no
 * tools": it has no tool-breadth source to read at all, so capability is derived entirely
 * from identity/data-reach flags, and when EVERY ONE of those sources is unobservable
 * (`hasAdminPrivileges`, `hasHighPrivileges`, `hasAccessToSensitiveData` all `undefined`
 * AND no `humanAccess` record at all), `"capability"` is pushed onto `unknowns` — the same
 * "unknown is a RATE, not a fourth VALUE" contract `problem.impactOf` keeps for technical
 * impact. A capability read as MINIMAL under this function is "nothing OBSERVED grants
 * broad power", never "tool access was checked and found narrow".
 */
function capabilityOf(node: GNode | undefined): { capability: Capability; unknown: boolean } {
  const admin = node?.hasAdminPrivileges;
  const highPriv = node?.hasHighPrivileges;
  const sensitiveAccess = node?.hasAccessToSensitiveData;
  const humanAdmin = node?.humanAccess?.admin;

  const broad = admin === true || humanAdmin === true || (highPriv === true && sensitiveAccess === true);
  const scoped = highPriv === true || sensitiveAccess === true;
  const capability: Capability = broad ? "BROAD" : scoped ? "SCOPED" : "MINIMAL";

  const unknown = admin === undefined && highPriv === undefined && sensitiveAccess === undefined && !node?.humanAccess;
  return { capability, unknown };
}

/**
 * Containment: how much stands between the asset and the outside world.
 *
 * `WEAK` when `guardrailMissing === true`. `STRONG` when `guardrailMissing === false` AND
 * `conditionState(node, "INTERNET_EXPOSURE") === false` — BOTH, never guardrail coverage
 * alone. `guardrailMissing === false` is an ABSENCE OF EVIDENCE, not a control: no
 * positive `PROTECTED_BY` edge is ever synced (see `GNode.guardrailMissing`'s own comment
 * and `kpis.protectedAgents`'s — both note the flag is an inference from a negated-edge
 * scan, not a confirmed guardrail). Reading `guardrailMissing === false` alone as STRONG
 * would let "we found no missing-guardrail finding" masquerade as "this asset is
 * contained" for an asset wide open to the internet. That is why STRONG needs the SECOND,
 * independent signal — a definite non-exposure through `riskConditions.conditionState`,
 * never the raw `isAccessibleFromInternet` flag (see `problem.exposureOf`'s identical
 * discipline) — before the absence of a guardrail finding is allowed to read as
 * containment rather than as "nobody has said otherwise". `PARTIAL` otherwise: a
 * guardrail-coverage negative that is not corroborated by a confirmed non-exposure, or a
 * confirmed exposure regardless of guardrail coverage.
 *
 * Unknown exactly when `guardrailMissing` is `undefined` — the coverage scan never
 * reached this asset, as opposed to reaching it and reporting either verdict.
 */
function containmentOf(node: GNode | undefined): { containment: Containment; unknown: boolean } {
  const missing = node?.guardrailMissing;
  if (missing === true) return { containment: "WEAK", unknown: false };
  const notExposed = node !== undefined && conditionState(node, "INTERNET_EXPOSURE") === false;
  const confirmedContained = missing === false && notExposed;
  return { containment: confirmedContained ? "STRONG" : "PARTIAL", unknown: missing === undefined };
}

/**
 * Consequence: what a realized failure would cost.
 *
 * `SEVERE` when `businessImpact === "HBI"` OR the worst entry in `dataFindingSeverities`
 * is CRITICAL (with a positive count). `MODERATE` when `businessImpact === "MBI"` OR any
 * entry in `dataFindingSeverities` carries a positive count (or `dataFindingCount > 0`,
 * for a row whose per-severity breakdown was not captured). `LIMITED` otherwise.
 *
 * Both `dataFindingSeverities` and `dataFindingCount` are DATASTORE-only fields
 * (`GNode`'s own comment) — a non-datastore asset (an agent, a service account) simply
 * never carries them, and reads consequence purely off `businessImpact`, exactly the way
 * `problem.missionOf` does.
 *
 * Unknown exactly when BOTH `businessImpact` is absent AND `dataFindingCount` is
 * `undefined` — the latter, not merely "no CRITICAL/positive entries in
 * `dataFindingSeverities`", because `dataFindingCount` is the field that tells "never
 * collected" apart from "collected and clean" (`GNode.dataFindingCount`'s own comment: a
 * store the traversal never reached must read back as undefined, not as zero findings).
 * Reading unknown-ness off `dataFindingSeverities` alone would conflate "no map at all"
 * with "an empty map", which is exactly the distinction that field's own absent-vs-zero
 * contract exists to keep.
 */
function consequenceOf(node: GNode | undefined): { consequence: Consequence; unknown: boolean } {
  const businessImpact = node?.businessImpact;
  const severities = node?.dataFindingSeverities ?? {};
  const worstCritical = (severities["CRITICAL"] ?? 0) > 0;
  const anyFinding = (node?.dataFindingCount ?? 0) > 0 || Object.values(severities).some((c) => c > 0);

  const severe = businessImpact === "HBI" || worstCritical;
  const moderate = businessImpact === "MBI" || anyFinding;
  const consequence: Consequence = severe ? "SEVERE" : moderate ? "MODERATE" : "LIMITED";

  const unknown = businessImpact === undefined && node?.dataFindingCount === undefined;
  return { consequence, unknown };
}

/**
 * The full posture vector for one asset. Every axis is derived exactly as this file's own
 * axis functions document; nothing here re-decides anything.
 *
 * `rule` is accepted for signature symmetry with `problem.deriveProblemInput` and
 * `problem.amplificationVector` — both take a parameter unread by at least part of their
 * own logic, for the same forward-compatibility reason. UNLIKE `deriveProblemInput`,
 * nothing here reads it TODAY: none of capability/containment/consequence resolves
 * through an operator-maintained table the way `problem.ts`'s exploitation axis resolves
 * through `rule.exploitationByRuleId` — every posture axis is a fixed read of the node's
 * own fields. That is also why `PostureVector`'s persisted form (`GNode.postureInput`,
 * see graphTypes.ts) carries no `derivedUnder` signature the way `ProblemVerdictInput`
 * does: there is no derivation knob a rule edit could make stale, so a persisted vector
 * never needs re-deriving — only re-DECIDING (`decidePosture`) under a new `rule`, and
 * `graphEnrich.withPostureTiers` always re-derives fresh rather than reusing a persisted
 * input, because the derivation is cheap, pure, and rule-independent.
 */
export function derivePostureInput(node: GNode | undefined, rule: PostureRule): PostureInput {
  void rule; // see this function's own comment — accepted for symmetry, unread today
  const unknowns: string[] = [];

  const { capability, unknown: capabilityUnknown } = capabilityOf(node);
  if (capabilityUnknown) unknowns.push("capability");

  const { containment, unknown: containmentUnknown } = containmentOf(node);
  if (containmentUnknown) unknowns.push("containment");

  const { consequence, unknown: consequenceUnknown } = consequenceOf(node);
  if (consequenceUnknown) unknowns.push("consequence");

  return { vector: { capability, containment, consequence }, unknowns };
}

/**
 * The worst OPEN problem verdict across an asset's issues and findings — a typed
 * `Outcome`, returned as the MAX (worst), never a mean, never a count.
 *
 * This is the ONLY aggregation the ordinal argument in this file's own header sanctions:
 * `Outcome` is itself an ordered, four-valued category (`problem.OUTCOME_VALUES`, worst
 * first), and "the worst of several ordinal readings" is a MAX over a total order — a
 * well-defined operation on an ordinal scale, unlike a mean. Typing the return as
 * `Outcome | undefined` rather than as a numeric rank is what stops the next edit from
 * quietly widening this into an average: there is no numeric field here to sum, so nobody
 * can accidentally divide it by a count. Returns `undefined` for an empty list — an asset
 * with no open issues or findings has no worst problem, which is exactly the state
 * `posture.ts`'s own header opens with: it is a DIFFERENT fact from a low posture tier,
 * and folding the two together (reading "no open problem" as "no risk") is the failure
 * this whole module exists to avoid.
 */
/**
 * Tally decided nodes by tier, zeros kept — a tier nothing reached this run is the finding,
 * not an absence, the same reasoning `problem.countProblemOutcomes` applies to outcomes.
 * Reads `node.postureTier` off already-folded nodes (`graphEnrich.withPostureTiers`'s
 * output); a node the fold never reached (absent `postureTier`) contributes nothing.
 */
export function countPostureTiers(nodes: ReadonlyArray<{ postureTier?: number }>): Record<Tier, number> {
  const counts: Record<Tier, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const n of nodes) {
    const t = n.postureTier;
    if (t === 1 || t === 2 || t === 3 || t === 4) counts[t]++;
  }
  return counts;
}

export function worstOpenProblem(outcomes: readonly string[]): Outcome | undefined {
  let worstIndex = -1;
  let worst: Outcome | undefined;
  for (const o of outcomes) {
    const idx = (OUTCOME_VALUES as readonly string[]).indexOf(o);
    if (idx === -1) continue; // an unrecognised outcome string is ignored, never crashes the fold
    if (worstIndex === -1 || idx < worstIndex) {
      worstIndex = idx;
      worst = o as Outcome;
    }
  }
  return worst;
}
