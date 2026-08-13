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

/**
 * Internet reachability, as pillar D reads it.
 *
 * The three states are NOT a severity ramp — `UNDETERMINED` is an epistemic state, not a
 * middling amount of exposure. Wiz reports `isAccessibleFromInternet: null` for a hosted
 * agent because reachability is inherited from the VM or Cloud Run service underneath it
 * and was never evaluated on the agent itself (ai/custom_score.md:82-127 walks exactly
 * this case). Pricing it BELOW confirmed exposure and ABOVE none is the honest reading:
 * it says "this needs checking", and it must never be collapsed into either neighbour.
 */
export type InternetExposure = "CONFIRMED" | "UNDETERMINED" | "NONE";

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
  /**
   * Optional so every input built before pillar D existed still scores: absent reads as
   * NONE, and the spec rule prices all three states at zero anyway.
   */
  internetExposure?: InternetExposure;
}

export interface AarsResult {
  score: number;                 // 0–100, integer
  severity: AarsSeverity;
  /** `exposure` is pillar D; it is 0 under the spec rule, which does not price exposure. */
  pillars: { toxic: number; compliance: number; data: number; exposure: number };
}

// ------------------------------------------------------------------------- the rule

export type GapMatch = "exact" | "prefix";

/** One row of the pillar-B pricing cascade. Rows are tried in order; first match wins. */
export interface GapPointRule {
  match: GapMatch;
  code: string;
  points: number;
}

/**
 * How the multi-issue multiplier responds to the issue COUNT.
 *
 * `flat` is the spec: >1 issue multiplies once, however many there are — so two issues and
 * forty score the same. In the applied table that already inverts the ranking, with
 * AWSReservedSSO (8 open issues, 65) sorting BELOW Agent-G (2 open issues, 66).
 *
 * `log2` spreads the same multiplier over the count: `1 + (m-1)·log2(n)`. It is chosen
 * over a linear term because risk from repetition compounds with diminishing returns —
 * the tenth instance of a condition tells you much less than the second. It is also the
 * conservative choice for THIS model, because it agrees with `flat` exactly at n=1 and
 * n=2: adopting it re-prices only the assets whose count the flat rule was discarding.
 */
export type MultiIssueScaling = "flat" | "log2";

/**
 * How pillar-B gap prices combine.
 *
 * `sum` is the spec. Its weakness is measurable rather than theoretical: the live
 * derivation (graphEnrich.deriveAarsInput) emits one gap per distinct framework code, and
 * Wiz maps a single toxic-combination issue onto 2–3 OWASP LLM codes AND 2 ASI codes AND
 * an ML title. At ~5.5 codes per asset the sum reaches 45–55 against a 30-point cap, so
 * EVERY asset prices at the cap and the whole cascade stops discriminating.
 *
 * `rss` is root-sum-square, √(Σ p²). It is identical to `sum` for a single gap, grows
 * sublinearly thereafter, and so keeps the pillar off its ceiling. It also softens the
 * triple-charge that three overlapping taxonomies apply to one underlying condition
 * (LLM03 / ASI04 / ML_SUPPLY_CHAIN are one supply-chain risk, priced three times).
 */
export type GapAggregation = "sum" | "rss";

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
  /** How `multiIssueMultiplier` scales with the issue count. Defaults to the spec's `flat`. */
  multiIssueScaling: MultiIssueScaling;
  pillarACap: number;
  /** Ordered pricing cascade for gap codes — FIRST MATCH WINS. */
  gapPoints: GapPointRule[];
  /** Price for a code no row matches. Governs tenant-specific finding shortIds. */
  gapFallbackPoints: number;
  /** How the matched prices combine. Defaults to the spec's `sum`. */
  gapAggregation: GapAggregation;
  pillarBCap: number;
  dataExposurePoints: Record<DataExposure, number>;
  dataAmplifier: number;
  /**
   * Pillar D — internet reachability. All zeros in the spec rule, which scores exposure
   * nowhere despite the graph computing it as a first-class node
   * (graphEnrich.withInternetExposureNodes) and the doc devoting a section to it.
   */
  exposurePoints: Record<InternetExposure, number>;
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
  multiIssueScaling: "flat",
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
  gapAggregation: "sum",
  pillarBCap: 30,
  dataExposurePoints: { SENSITIVE: 20, DATA_ACCESS: 10, NONE: 0 },
  // 5Rs framework at 53% — data-exposure controls are systemically weak, so all
  // data-related points are amplified (ai/custom_score.md Pillar C).
  dataAmplifier: 1.1,
  // Pillar D is OFF in the spec rule. The doc reports internet exposure beside the score
  // but never adds it to one, so scoring it here would change every published number.
  exposurePoints: { CONFIRMED: 0, UNDETERMINED: 0, NONE: 0 },
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

/**
 * The count multiplier. Both scalings agree at n≤1 (×1) and n=2 (×m) — that identity is
 * what lets `log2` be adopted without re-pricing any asset whose count the spec was
 * already reading correctly, and it is asserted in aars.test.ts.
 */
export function multiIssueFactor(count: number, rule: AarsRule): number {
  if (count <= 1) return 1;
  if (rule.multiIssueScaling === "log2") {
    return 1 + (rule.multiIssueMultiplier - 1) * Math.log2(count);
  }
  return rule.multiIssueMultiplier;
}

/** Combine priced gaps per the rule's aggregation. Identical for zero or one gap. */
export function aggregateGapPoints(points: number[], rule: AarsRule): number {
  if (rule.gapAggregation === "rss") {
    return Math.round(Math.sqrt(points.reduce((acc, p) => acc + p * p, 0)));
  }
  return points.reduce((acc, p) => acc + p, 0);
}

export function computeAars(input: AarsInput, rule: AarsRule = DEFAULT_AARS_RULE): AarsResult {
  let toxic = worstSeverityPoints(input.issueSeverities, rule);
  toxic *= multiIssueFactor(input.issueSeverities.length, rule);
  toxic = Math.min(rule.pillarACap, Math.round(toxic));

  const compliance = Math.min(
    rule.pillarBCap,
    aggregateGapPoints(
      input.gaps.map((g) => g.points ?? gapPointsFor(g.code, rule)),
      rule,
    ),
  );

  const data = Math.round((rule.dataExposurePoints[input.dataExposure] ?? 0) * rule.dataAmplifier);

  // Pillar D is NOT amplified: dataAmplifier is the 5Rs data-security signal, and
  // reachability is a network fact that signal says nothing about.
  const exposure = rule.exposurePoints[input.internetExposure ?? "NONE"] ?? 0;

  const score = Math.min(AARS_MAX_SCORE, toxic + compliance + data + exposure);
  return {
    score,
    severity: aarsSeverity(score, rule.bands),
    pillars: { toxic, compliance, data, exposure },
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
