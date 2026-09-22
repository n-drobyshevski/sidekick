// The LANDSCAPE's derived compliance posture — the Assurance hero's percentage, computed
// over the controls that actually apply to this landscape rather than as a mean of Wiz's
// per-framework scores.
//
// WHAT THIS REPLACED, AND WHY. The hero used to show `complianceKpis.averagePosture`: the
// arithmetic mean of whatever frameworks happened to be scored, each taken at Wiz's own
// figure. That number has two defects, and neither is cosmetic.
//
//   1. IT AVERAGES SCORES, NOT WORK. A framework with four controls and a framework with
//      four hundred count the same. Wiz's own per-framework aggregation is opaque
//      (compliancePosture.ts says so at length), so the mean is an average of four numbers
//      nobody can decompose — it moves when a small framework moves and barely notices when
//      a large one does.
//   2. ITS DENOMINATOR IS NOT THE REGISTER'S. Wiz scores each framework over everything it
//      maps. This app's register lists only the controls that APPLY — the ones Wiz actually
//      evaluated against something (`isAssessedPolicy`), minus the 5Rs rules nothing has
//      judged AI-relevant (`dropUnselected`), minus the rules disabled in Wiz. A page
//      listing one population under a number describing a larger one is exactly the implied
//      confidence PRODUCT.md forbids, and it is the same gap fiveRsPosture.ts closed for one
//      framework. This module closes it for the landscape.
//
// SAY IT PLAINLY: THIS IS NOT A BETTER ESTIMATE OF THE MEAN. It is a different question with
// a different denominator, answered by this app rather than by Wiz — which is why
// `wizAveragePosture` and `scoredFrameworks` are carried alongside in `LandscapePosture`
// rather than dropped. Both claims travel together, exactly as `FiveRsPosture` carries
// `wizPosturePct`, so nothing downstream can mistake one for a correction of the other. Wiz's
// own figures in storage are never overwritten: this module only reads the trees.
//
// THE POPULATION IS DISTINCT CONTROLS, NOT MAPPING ROWS. One control mapped by six
// subcategories across three frameworks is ONE thing to fix, and its pass/fail counts are
// simply repeated on every mapping row Wiz sends — so the walk below dedupes by policyId
// across the WHOLE landscape and takes the MAX, never the sum. That is the identical
// discipline `sharedControls` (complianceOverview.ts) and `scopeFiveRs`
// (complianceScope.ts) apply at their own scopes, and summing here would report a control
// failing in three frameworks as three failures — inflating the denominator and making this
// figure impossible to reconcile with `complianceKpis.failingPolicies`, which counts
// distinct.
//
// WHAT THIS CANNOT SEE, and the trend card beside the hero has to say so: a percentage over
// today's applicable controls cannot be attributed to a sync that ran under a different
// scope. `sync_history` records Wiz's per-framework figures and their mean
// (domain/complianceTrend.ts), so THAT is what has a history and that is what the line
// draws. Unstated, a hero at 97% over a line at 92% reads as a bug — the same disclosure
// compliance.js already makes for the 5Rs hero.

import { postureBandOf, type PostureBand } from "./compliancePosture";
import type { FrameworkTree } from "./compliancePosture";
import { clampAwayFromFalseExtreme } from "./fiveRsPosture";

export interface LandscapePosture {
  /**
   * Headline. round(pass / (pass + fail)) over the applicable controls. Null, never 0.
   *
   * Resource-weighted, like the 5Rs derived figure and like Wiz's own percentages: it is a
   * share of CHECKS, so a control failing on two hundred resources weighs two hundred
   * times one failing on one. `controlPassPct` below is the control-weighted reading of the
   * same population, shipped beside it rather than instead of it.
   */
  posturePct: number | null;
  postureBand: PostureBand | null;
  /** Secondary, control-weighted: applicable controls with zero failures, over applicable. */
  controlPassPct: number | null;
  cleanPolicyCount: number;
  failingPolicyCount: number;
  /**
   * Distinct controls behind `posturePct` — the denominator this hero's sub-line names.
   *
   * "Applicable" is three filters, all applied before this counts anything: Wiz evaluated
   * the control against something (`isAssessedPolicy`, already applied by
   * `buildFrameworkTree` — an unassessed rule never reaches a tree), the control survived
   * the 5Rs AI-scope pin (`dropUnselected`, already applied by the caller that built these
   * trees), and Wiz does not have it switched off (`enabled !== false`, applied here).
   */
  applicablePolicyCount: number;
  /**
   * Controls excluded for `enabled === false` — named rather than dropped silently, the
   * same contract `FiveRsPosture.disabledPolicyCount` keeps.
   */
  disabledPolicyCount: number;
  /** Frameworks contributing at least one applicable control. The hero's other denominator. */
  frameworkCount: number;
  /** Raw evaluation totals behind posturePct. */
  passCount: number;
  failCount: number;
  /**
   * The figure this one replaced in the hero — `complianceKpis.averagePosture`, the mean of
   * Wiz's own per-framework scores — carried through untouched, with the count it averaged.
   *
   * Not vestigial: the trend line beside the hero still draws it (it is what has a history),
   * the Wiz Scans page still reports it, and the hero's own disclosure names it. Shipping it
   * here rather than making each consumer reach into a sibling `kpis` field is the same
   * self-describing-payload rule `FiveRsPosture.frameworkId` exists for.
   */
  wizAveragePosture: number | null;
  scoredFrameworks: number;
}

/**
 * Whether a control counts toward the derived landscape posture.
 *
 * `enabled !== false`, not `enabled === true`, for the reason `isActiveFiveRsPolicy` gives:
 * `enabled` is tri-state optional (syncNormalize.ts does `triBool(...) ?? undefined`), and a
 * rule carrying real evaluation counts must never leave the arithmetic because Wiz declined
 * to state a flag. The harder fact outranks the missing signal — the same conservative
 * direction `isAssessedPolicy` takes.
 *
 * The other two halves of "applicable" are NOT re-tested here, and that is deliberate rather
 * than an omission: a tree only ever carries assessed policies, and the caller applied the
 * 5Rs scope before building the trees. Re-deriving either here would be a second opinion
 * about a decision made once upstream, which is how a hero comes to describe a population
 * its own register does not list.
 */
export function isApplicableControl(enabled: boolean | undefined): boolean {
  return enabled !== false;
}

interface ControlAccumulator {
  passCount: number;
  failCount: number;
  enabled?: boolean;
  frameworkIds: Set<string>;
}

/**
 * Derive the landscape's posture over the applicable controls in `trees`.
 *
 * ALWAYS returns an object, never null — unlike `fiveRsDerivedPosture`, whose null means
 * "there is no such framework to describe". There is always a landscape; what varies is
 * whether it has a posture, and that is `posturePct: null`, which is the distinction this
 * whole register is built to keep.
 *
 * `trees` must be the SAME trees the page renders — already 5Rs-scoped by the caller (see
 * `isApplicableControl`). Handing this the unscoped set would put a hero over a population
 * the register below it does not list, which is the bug this module exists to fix.
 */
export function landscapeDerivedPosture(
  trees: ReadonlyArray<FrameworkTree>,
  wiz: { averagePosture: number | null; scoredFrameworks: number },
): LandscapePosture {
  // Distinct by policyId across EVERY framework — see the file header on why the population
  // is controls rather than mapping rows.
  const byPolicy = new Map<string, ControlAccumulator>();
  for (const tree of trees) {
    for (const category of tree.categories) {
      for (const sub of category.subcategories) {
        for (const p of sub.policies) {
          let acc = byPolicy.get(p.policyId);
          if (!acc) {
            acc = {
              passCount: 0,
              failCount: 0,
              // Sticky-false's initial reading, overridden below by any later row saying
              // false — `scopeFiveRs` accumulates `enabled` the identical way.
              enabled: p.enabled,
              frameworkIds: new Set<string>(),
            };
            byPolicy.set(p.policyId, acc);
          }
          // MAX, never sum: one control is evaluated once, and its counts are repeated on
          // every mapping row. Summing would multiply a control by how many frameworks
          // happen to cite it.
          if (p.passCount > acc.passCount) acc.passCount = p.passCount;
          if (p.failCount > acc.failCount) acc.failCount = p.failCount;
          // Sticky false: a rule disabled on any mapping row is disabled, permanently. The
          // conservative direction — a control Wiz has switched off somewhere is not one
          // this landscape can claim credit for passing.
          if (p.enabled === false) acc.enabled = false;
          acc.frameworkIds.add(tree.frameworkId);
        }
      }
    }
  }

  let passCount = 0;
  let failCount = 0;
  let cleanPolicyCount = 0;
  let failingPolicyCount = 0;
  let applicablePolicyCount = 0;
  let disabledPolicyCount = 0;
  const frameworks = new Set<string>();

  for (const acc of byPolicy.values()) {
    if (!isApplicableControl(acc.enabled)) {
      disabledPolicyCount += 1;
      continue;
    }
    applicablePolicyCount += 1;
    passCount += acc.passCount;
    failCount += acc.failCount;
    if (acc.failCount === 0) cleanPolicyCount += 1;
    else failingPolicyCount += 1;
    // Counted off the APPLICABLE controls only, so the hero cannot name a framework that
    // contributes nothing to the number beside it.
    for (const id of acc.frameworkIds) frameworks.add(id);
  }

  // NULL, NEVER 0 — the governing rule of compliancePosture.ts ("a posture that does not
  // exist is never a zero") applied one scope up. A landscape with no applicable control,
  // or whose applicable controls have never evaluated anything, has NO posture; it does not
  // have a failing one, and a hero drawing a red bar at 0% over an empty register would be
  // `posture ?? 0` wearing the biggest number on the page.
  const posturePct = applicablePolicyCount === 0 || passCount + failCount === 0
    ? null
    : clampAwayFromFalseExtreme(
      Math.round((100 * passCount) / (passCount + failCount)),
      failCount > 0,
      passCount > 0,
    );

  // A REAL zero survives here (every applicable control failing something) — collapsing it
  // to null would be the same mistake in reverse, hiding a true answer rather than a
  // missing one. Only an empty population is null.
  const controlPassPct = applicablePolicyCount === 0
    ? null
    : clampAwayFromFalseExtreme(
      Math.round((100 * cleanPolicyCount) / applicablePolicyCount),
      failingPolicyCount > 0,
      cleanPolicyCount > 0,
    );

  return {
    posturePct,
    postureBand: postureBandOf(posturePct),
    controlPassPct,
    cleanPolicyCount,
    failingPolicyCount,
    applicablePolicyCount,
    disabledPolicyCount,
    frameworkCount: frameworks.size,
    passCount,
    failCount,
    wizAveragePosture: wiz.averagePosture,
    scoredFrameworks: wiz.scoredFrameworks,
  };
}
