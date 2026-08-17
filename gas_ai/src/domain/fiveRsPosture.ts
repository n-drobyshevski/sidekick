// The 5Rs framework's DERIVED posture percentage — a different question from Wiz's own,
// answered over a different denominator, and shipped alongside Wiz's figure rather than in
// place of it.
//
// 5Rs is a DATA-security framework Wiz scores against the whole cloud landscape (see
// complianceScope.ts's header). This app narrows the 5Rs REGISTER to its AI-relevant rules —
// scopeFiveRs() derives an in/out verdict per policy — but until this module existed, the
// PERCENTAGE never followed: the hero kept showing Wiz's 85%, computed by Wiz over all seven
// 5Rs rules including the four this register scopes out. A page listing three rules under a
// number that describes seven is exactly the implied confidence PRODUCT.md forbids.
//
// This module closes that gap by recomputing the percentage over the ACTIVE policies only —
// the same set the register lists. Say this plainly, because it is easy to misread the fix
// as "a better estimate of Wiz's 85%": it is not. Wiz's aggregation is opaque
// (compliancePosture.ts says so at length) and there is no way to reproduce it even if that
// were the goal. This is a DIFFERENT metric with a different, smaller, AI-scoped
// denominator — a different question, not a refinement of the old answer. That is why
// `wizPosturePct` is carried alongside in `FiveRsPosture` rather than dropped: the two
// claims travel together so nothing downstream
// can mistake one for a correction of the other, and Wiz's own figure in storage
// (`PostureRow.posturePct`, sheetsDb.ts's `posture_pct` column) is never overwritten — this
// module only ever reads it, never writes it back.

import { postureBandOf, type PostureBand } from "./compliancePosture";
import type { FiveRsScope, PolicyScope } from "./complianceScope";

export interface FiveRsPosture {
  /**
   * Which framework this describes — the same id `FiveRsScope` carries.
   *
   * Present so the payload is SELF-DESCRIBING. A reader holding only this object can tell
   * which rail row or hero it belongs to; without it every consumer would have to reach
   * into the sibling `fiveRsScope.frameworkId` to make the match, which is a coupling
   * between two payload fields that nothing states and a refactor would quietly break.
   */
  frameworkId: string;
  /** Headline. round(pass / (pass + fail)) over active policies. Null, never 0 — see below. */
  posturePct: number | null;
  postureBand: PostureBand | null;
  /** Secondary, control-weighted: active policies with zero failures, over active policies. */
  controlPassPct: number | null;
  cleanPolicyCount: number;
  failingPolicyCount: number;
  activePolicyCount: number;
  /** In AI scope but `enabled === false` — excluded, and named rather than dropped silently. */
  disabledPolicyCount: number;
  /** Raw evaluation totals behind posturePct. */
  passCount: number;
  failCount: number;
  /** Wiz's own framework score, carried through unchanged, for the sub-line that states it. */
  wizPosturePct: number | null;
}

/**
 * Whether a policy counts toward the derived posture: in AI scope AND not disabled in Wiz.
 *
 * `enabled !== false`, not `enabled === true` — `enabled` is tri-state optional
 * (syncNormalize.ts:855 does `triBool(...) ?? undefined`), and a rule carrying real
 * evaluation counts must never be dropped from the arithmetic just because Wiz declined to
 * state a flag. Same conservative direction, for the same reason, as `isAssessedPolicy`
 * (compliancePosture.ts:310): the harder fact (a real number) outranks a missing signal.
 */
export function isActiveFiveRsPolicy(p: PolicyScope): boolean {
  return p.selected && p.enabled !== false;
}

/**
 * Clamp a rounded percentage away from a false 100 or a false 0.
 *
 * Rounding 99.6 up to 100, or 0.4 down to 0, is fine arithmetic and a dishonest claim the
 * moment the "other side" is non-empty: a hero reading "100%" beside 21 failing checks, or
 * "0%" beside 1,769 passing ones, is exactly the implied confidence PRODUCT.md forbids. One
 * helper, shared by posturePct and controlPassPct, so the two clamps cannot drift apart.
 */
function clampAwayFromFalseExtreme(
  rounded: number,
  hasFailing: boolean,
  hasPassing: boolean,
): number {
  if (rounded === 100 && hasFailing) return 99;
  if (rounded === 0 && hasPassing) return 1;
  return rounded;
}

/**
 * Derive the 5Rs posture over the active policies in `scope`, or null when there is no 5Rs
 * framework collected at all (`scope.frameworkId === null`) — the caller renders nothing
 * rather than an empty card, the same contract `scopeFiveRs` itself keeps.
 */
export function fiveRsDerivedPosture(
  scope: FiveRsScope,
  wizPosturePct: number | null,
): FiveRsPosture | null {
  if (scope.frameworkId === null) return null;

  let passCount = 0;
  let failCount = 0;
  let cleanPolicyCount = 0;
  let failingPolicyCount = 0;
  let activePolicyCount = 0;
  let disabledPolicyCount = 0;

  for (const p of scope.policies) {
    if (p.selected && p.enabled === false) disabledPolicyCount += 1;
    if (!isActiveFiveRsPolicy(p)) continue;
    activePolicyCount += 1;
    passCount += p.passCount;
    failCount += p.failCount;
    if (p.failCount === 0) cleanPolicyCount += 1;
    else failingPolicyCount += 1;
  }

  // NULL, NEVER 0 — the governing rule of compliancePosture.ts ("a posture that does not
  // exist is never a zero") applied to the derived figure. A framework scoped down to
  // nothing, or whose active policies have never evaluated anything, has no derived
  // posture — it does not have a failing one.
  const posturePct = activePolicyCount === 0 || passCount + failCount === 0
    ? null
    : clampAwayFromFalseExtreme(
      Math.round((100 * passCount) / (passCount + failCount)),
      failCount > 0,
      passCount > 0,
    );

  // controlPassPct === 0 with a non-zero activePolicyCount is a REAL zero (every active
  // policy is failing something) and must survive — collapsing it to null here would be the
  // same `posture ?? 0` mistake in reverse, hiding a true answer instead of a missing one.
  const controlPassPct = activePolicyCount === 0
    ? null
    : clampAwayFromFalseExtreme(
      Math.round((100 * cleanPolicyCount) / activePolicyCount),
      failingPolicyCount > 0,
      cleanPolicyCount > 0,
    );

  return {
    frameworkId: scope.frameworkId,
    posturePct,
    postureBand: postureBandOf(posturePct),
    controlPassPct,
    cleanPolicyCount,
    failingPolicyCount,
    activePolicyCount,
    disabledPolicyCount,
    passCount,
    failCount,
    wizPosturePct,
  };
}
