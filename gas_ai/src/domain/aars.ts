// AARS — AI Asset Risk Score, the port of ai/custom_score.md. Three pillars:
//   A (0–50)  toxic-combination participation: worst open-issue severity, ×1.2 when
//             the asset appears in more than one issue, capped at 50
//   B (0–30)  compliance framework gaps: summed per-gap points, capped at 30
//   C (0–22)  data exposure: sensitive 20 / unconfirmed data access 10 / none 0,
//             then the systemic 5Rs=53% amplifier ×1.1 (→ 22 / 11 / 0)
//
// Every number above is a DEFAULT, not a constant: the scoring model is an `AarsRule`
// that deployments tune from the AARS Rules page. `DEFAULT_AARS_RULE` is the spec, and
// the applied 14-row table in ai/custom_score.md is normative *for it* — aars.test.ts
// reproduces every row exactly under the defaults. The 0–100 range itself is not
// tunable: it is what "AARS" means.

import type { AarsSeverity, Severity } from "./config";

export type DataExposure = "SENSITIVE" | "DATA_ACCESS" | "NONE";

export interface AarsGap {
  code: string;    // "LLM06", "ASI10", "ML_DATA_POISONING", "FIVE_RS", "NO_GUARDRAIL", "DEPRECATED_MODEL"
  /**
   * An explicit price for this one gap. Normally absent: the code is priced by the
   * rule's cascade at scoring time, which is what lets a rule change reach gaps that
   * were built before the rule was known (deriveAarsInput, the dry-run seed hints).
   */
  points?: number;
}

export interface AarsInput {
  issueSeverities: Severity[];   // severities of the asset's OPEN issues (one per issue)
  gaps: AarsGap[];               // compliance gaps, priced by the rule unless overridden
  dataExposure: DataExposure;
}

export interface AarsResult {
  score: number;                 // 0–100, integer
  severity: AarsSeverity;
  pillars: { toxic: number; compliance: number; data: number };
}

// ------------------------------------------------------------------------- the rule

export type GapMatch = "exact" | "prefix";

/** One row of the pillar-B pricing cascade. Rows are tried in order; first match wins. */
export interface GapPointRule {
  match: GapMatch;
  code: string;
  points: number;
}

/** Score thresholds, worst first. Each must sit strictly above the next. */
export interface AarsBands {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export type IssueSeverityKey = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface AarsRule {
  severityPoints: Record<IssueSeverityKey, number>;
  multiIssueMultiplier: number;
  pillarACap: number;
  /** Ordered pricing cascade for gap codes — FIRST MATCH WINS. */
  gapPoints: GapPointRule[];
  /** Price for a code no row matches. Governs tenant-specific finding shortIds. */
  gapFallbackPoints: number;
  pillarBCap: number;
  dataExposurePoints: Record<DataExposure, number>;
  dataAmplifier: number;
  bands: AarsBands;
}

/**
 * The scoring model exactly as ai/custom_score.md specifies it. The gapPoints array is
 * the doc's pillar-B table written as an ordered cascade: the two secondary OWASP LLM
 * rows (LLM04/LLM05) and the two named gaps are exact matches that must be tried before
 * the family prefixes below them, or LLM04 would price as a primary LLM gap.
 */
export const DEFAULT_AARS_RULE: AarsRule = {
  severityPoints: { CRITICAL: 50, HIGH: 35, MEDIUM: 20, LOW: 8 },
  multiIssueMultiplier: 1.2,
  pillarACap: 50,
  gapPoints: [
    { match: "exact", code: "NO_GUARDRAIL", points: 10 },
    { match: "exact", code: "DEPRECATED_MODEL", points: 5 },
    { match: "exact", code: "LLM04", points: 5 },
    { match: "exact", code: "LLM05", points: 5 },
    { match: "prefix", code: "LLM", points: 10 },
    { match: "prefix", code: "ASI", points: 10 },
    { match: "prefix", code: "ML", points: 5 },
    { match: "exact", code: "FIVE_RS", points: 5 },
    { match: "prefix", code: "5R", points: 5 },
  ],
  gapFallbackPoints: 5,
  pillarBCap: 30,
  dataExposurePoints: { SENSITIVE: 20, DATA_ACCESS: 10, NONE: 0 },
  // 5Rs framework at 53% — data-exposure controls are systemically weak, so all
  // data-related points are amplified (ai/custom_score.md Pillar C).
  dataAmplifier: 1.1,
  bands: { critical: 70, high: 50, medium: 30, low: 10 },
};

/** The AARS scale itself: not tunable, unlike everything in `AarsRule`. */
export const AARS_MAX_SCORE = 100;

/** Price one gap code against a rule's cascade, falling back to `gapFallbackPoints`. */
export function gapPointsFor(code: string, rule: AarsRule = DEFAULT_AARS_RULE): number {
  const c = String(code ?? "").trim().toUpperCase();
  for (const row of rule.gapPoints) {
    const hit = row.match === "exact" ? c === row.code : c.startsWith(row.code);
    if (hit) return row.points;
  }
  return rule.gapFallbackPoints;
}

/** Spec pricing for a gap code. Prefer `gapPointsFor(code, rule)` where a rule is in hand. */
export function defaultGapPoints(code: string): number {
  return gapPointsFor(code, DEFAULT_AARS_RULE);
}

/**
 * A gap to be priced by the rule at scoring time; pass `points` only to override the
 * cascade for this one gap.
 */
export function gap(code: string, points?: number): AarsGap {
  return points === undefined ? { code } : { code, points };
}

export function aarsSeverity(
  score: number,
  bands: AarsBands = DEFAULT_AARS_RULE.bands,
): AarsSeverity {
  if (score >= bands.critical) return "CRITICAL";
  if (score >= bands.high) return "HIGH";
  if (score >= bands.medium) return "MEDIUM";
  if (score >= bands.low) return "LOW";
  return "INFO";
}

function worstSeverityPoints(severities: Severity[], rule: AarsRule): number {
  let worst = 0;
  for (const s of severities) {
    const p = rule.severityPoints[s as IssueSeverityKey] ?? 0;
    if (p > worst) worst = p;
  }
  return worst;
}

export function computeAars(input: AarsInput, rule: AarsRule = DEFAULT_AARS_RULE): AarsResult {
  let toxic = worstSeverityPoints(input.issueSeverities, rule);
  if (input.issueSeverities.length > 1) toxic *= rule.multiIssueMultiplier;
  toxic = Math.min(rule.pillarACap, Math.round(toxic));

  const compliance = Math.min(
    rule.pillarBCap,
    input.gaps.reduce((acc, g) => acc + (g.points ?? gapPointsFor(g.code, rule)), 0),
  );

  const data = Math.round((rule.dataExposurePoints[input.dataExposure] ?? 0) * rule.dataAmplifier);

  const score = Math.min(AARS_MAX_SCORE, toxic + compliance + data);
  return {
    score,
    severity: aarsSeverity(score, rule.bands),
    pillars: { toxic, compliance, data },
  };
}

/**
 * Per-gap pricing for one input, in the order the gaps were supplied — what the sandbox
 * and the asset drill-down show so a pillar-B total can be read back to the rows that
 * produced it.
 */
export function gapBreakdown(
  gaps: AarsGap[],
  rule: AarsRule = DEFAULT_AARS_RULE,
): Array<{ code: string; points: number; overridden: boolean }> {
  return gaps.map((g) => ({
    code: g.code,
    points: g.points ?? gapPointsFor(g.code, rule),
    overridden: g.points !== undefined,
  }));
}
