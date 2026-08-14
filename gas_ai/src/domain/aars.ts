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
  /**
   * Severities of the DSPM data findings this asset can REACH — one entry per finding,
   * exactly as `issueSeverities` is one entry per issue, summed over every classified
   * datastore on its RUNS_AS → ALLOWS_ACCESS_TO path.
   *
   * Absent means "not collected" (the traversal was never run, or the row predates it),
   * never "none found". The spec rule prices it at zero either way, so the distinction only
   * bites once a rule turns the term on.
   */
  dataFindingSeverities?: Severity[];
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

/**
 * Which derivations are allowed to RAISE a gap, as opposed to how gaps are priced.
 *
 * Coverage belongs on the rule for the same reason pricing does: it is a judgement the
 * operator owns and must be able to read back. Every source is off by default, because
 * switching one on re-prices assets and the applied table in ai/custom_score.md is
 * normative for the default rule.
 *
 * All three exist to fix the same defect: three rows of the DEFAULT cascade
 * (`FIVE_RS`, the `5R` family, `DEPRECATED_MODEL`) price codes that NOTHING in the live
 * pipeline emits. They are not shadowed — `shadowedGapRules` cannot see them — they are
 * unreachable, and the signal each one needs is already sitting in the sheets.
 */
export interface GapSources {
  /**
   * `5R_<VALUE>` from `IssueRow.frameworks.fiveRs`. The values are literally "Restrict",
   * "Reduce", "Reconfigure", so they land on the codebook's existing 5R_ entries.
   */
  fiveRs?: boolean;
  /** `DEPRECATED_MODEL` from `node.status === "Deprecated"`. */
  deprecatedModel?: boolean;
  /**
   * `INACTIVE_AGENT` from `node.status === "Inactive"`. A dormant agent that still holds
   * its privileges and data reach is the ASI10 "Rogue Agents" shape — it is not watched,
   * not maintained, and not missed if abused.
   */
  inactiveAgent?: boolean;
  /**
   * Label a failing config finding with the framework codes WIZ says its rule maps to,
   * from the synced compliance-framework posture, instead of the codes a regex found in
   * the rule's tags.
   *
   * This raises no new gap. Every finding keeps its id, its severity and its place in the
   * count; only `frameworkCodes` grows, so pillar B prices the same gaps against different
   * cascade rows. That is the fix it exists for: the rows naming ASI / ML_ / 5R_ codes have
   * never been able to fire, because the only source of those codes was
   * `frameworkCodesFromRule` scraping an OWASP token out of a tag value — which works only
   * on a tenant that happens to write one there.
   *
   * OFF by default, following every other knob here: turning it on moves scores, so no
   * tenant re-scores on upgrade and the change goes through the AARS Rules preview like any
   * other rule edit. It also does nothing at all until a posture sync has run.
   */
  frameworkMapping?: boolean;
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
  /** How `multiIssueMultiplier` scales with the issue count. Defaults to the spec's `flat`. */
  multiIssueScaling: MultiIssueScaling;
  pillarACap: number;
  /** Ordered pricing cascade for gap codes — FIRST MATCH WINS. */
  gapPoints: GapPointRule[];
  /** Price for a code no row matches. Governs tenant-specific finding shortIds. */
  gapFallbackPoints: number;
  /** How the matched prices combine. Defaults to the spec's `sum`. */
  gapAggregation: GapAggregation;
  /** Which derivations may raise a gap. All off in the spec rule. */
  gapSources: GapSources;
  /**
   * Per-severity weight on a gap contributed by a failing config finding. The spec
   * weights them all at 1, so a CRITICAL failing control prices exactly like a LOW one.
   */
  findingSeverityWeights: Record<IssueSeverityKey, number>;
  pillarBCap: number;
  dataExposurePoints: Record<DataExposure, number>;
  dataAmplifier: number;
  /**
   * Pillar C's FINDING term — points for the WORST data-finding severity the asset reaches,
   * scaled by how many it reaches. All zeros in the spec rule.
   *
   * This is what ai/AARS_ASSESSMENT.md:74,190 measures the need for: pillar C sits at its
   * ceiling for 20 of 30 assets under BOTH the spec rule and v2, because it prices a
   * boolean — "reaches sensitive data" — that most of the estate shares, and the assessment
   * calls that "a true fact about the estate rather than a modelling error". A pillar
   * constant across two thirds of the population ranks nothing. The finding term reads what
   * the boolean cannot: WHICH data, and how much of it.
   *
   * Its arithmetic is pillar A's — worst severity, scaled by count — deliberately, because
   * that is the shape this model already uses for "N instances of a graded thing" and a
   * second shape would be a second thing to audit.
   */
  dataFindingPoints: Record<IssueSeverityKey, number>;
  /** How `dataFindingPoints` scales with the finding COUNT. `flat` reads only the worst. */
  dataFindingScaling: MultiIssueScaling;
  /** The count multiplier, under `log2`. Ignored under `flat`. */
  dataFindingMultiplier: number;
  /**
   * Ceiling on pillar C as a whole (exposure tier + findings).
   *
   * Explicit for the first time. It used to be implicit in the arithmetic — 20 × 1.1 = 22,
   * the largest value the tier alone could reach — which was adequate while the tier was
   * the only term. Adding a second unbounded term needs the bound said out loud.
   */
  pillarCCap: number;
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
  // Off: switching any of these on adds gaps the doc's applied table never priced.
  gapSources: {
    fiveRs: false, deprecatedModel: false, inactiveAgent: false, frameworkMapping: false,
  },
  // All 1: the spec reads a failing control as present-or-absent, never as more or less
  // severe. Kept as a knob because ai_findings.severity is already persisted and unused.
  findingSeverityWeights: { CRITICAL: 1, HIGH: 1, MEDIUM: 1, LOW: 1 },
  pillarBCap: 30,
  dataExposurePoints: { SENSITIVE: 20, DATA_ACCESS: 10, NONE: 0 },
  // 5Rs framework at 53% — data-exposure controls are systemically weak, so all
  // data-related points are amplified (ai/custom_score.md Pillar C).
  dataAmplifier: 1.1,
  // OFF: every point zero, so the term contributes nothing and pillar C is arithmetically
  // what it has always been. ai/custom_score.md's applied 14-row table — which pins
  // test/aars.test.ts — therefore keeps passing untouched. Sixth knob to follow that
  // convention, after multiIssueScaling, gapAggregation, gapSources, findingSeverityWeights
  // and exposurePoints.
  dataFindingPoints: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  dataFindingScaling: "flat",
  dataFindingMultiplier: 1,
  // 22 = the old implicit ceiling (20 × 1.1), so naming it changes no score.
  pillarCCap: 22,
  // Pillar D is OFF in the spec rule. The doc reports internet exposure beside the score
  // but never adds it to one, so scoring it here would change every published number.
  exposurePoints: { CONFIRMED: 0, UNDETERMINED: 0, NONE: 0 },
  bands: { critical: 70, high: 50, medium: 30, low: 10 },
};

/**
 * A calibrated alternative to the spec rule, offered on the Rules page and adopted
 * deliberately — never a default. It exists because `DEFAULT_AARS_RULE` was fitted to the
 * 14-row applied table in ai/custom_score.md, where each asset carries 2–3 hand-picked gap
 * codes, and the live derivation produces 5–6. Under the spec rule on live data pillar B
 * sits at its cap for every scored agent, the estate collapses onto ~5 distinct scores,
 * and the HIGH and MEDIUM levels are unreachable.
 *
 * What changed, and why each one:
 *
 *   Pillar A 45  `log2` scaling, so the issue count is read past ">1". Points lowered from
 *                the spec's 50/35/20/8 to leave headroom for the count term instead of
 *                spending the whole pillar on the worst severity.
 *   Pillar B 25  `rss`, which is what takes this pillar off its ceiling — the six-code
 *                live shape prices ~23 rather than a clamped 30. All three gap sources on,
 *                which is what makes the cascade's dead rows fire. The cascade order is
 *                the spec's, plus a row for INACTIVE_AGENT so it is priced deliberately
 *                rather than by the fallback.
 *   Pillar C 12  Halved, the amplifier folded into the points, and SPLIT into a tier term
 *                and a finding term. The 5Rs ×1.1 is a tenant-wide constant: it cannot
 *                change a ranking, only inflate every score, yet it decides individual band
 *                membership (it is the whole reason agent-H-chatbot is CRITICAL at 71 rather
 *                than HIGH at 69). Baking it in makes the pillar say what it means. The
 *                split is what stops the pillar being near-constant: the boolean it used to
 *                price alone is shared by two thirds of the estate, so the findings an asset
 *                actually reaches now carry half the pillar's weight.
 *   Pillar D 18  The budget pillar C gave up. Reachability is the signal the spec computes,
 *                draws on the graph, writes a section of the doc about, and never scores.
 *                UNDETERMINED is priced well below CONFIRMED: it means "nobody has checked
 *                this hosted agent", which is worth surfacing and must not outrank a
 *                confirmed exposure.
 *
 * The caps sum to exactly 100, so the scale is used rather than clamped, and the bands are
 * refitted to the distribution this actually produces.
 */
export const AARS_V2_RULE: AarsRule = {
  severityPoints: { CRITICAL: 40, HIGH: 28, MEDIUM: 16, LOW: 6 },
  multiIssueMultiplier: 1.2,
  multiIssueScaling: "log2",
  pillarACap: 45,
  gapPoints: [
    { match: "exact", code: "NO_GUARDRAIL", points: 10 },
    { match: "exact", code: "INACTIVE_AGENT", points: 10 },
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
  gapAggregation: "rss",
  // frameworkMapping stays OFF even here, where every other dormant source is on. Two
  // reasons, and neither is timidity: ai/AARS_ASSESSMENT.md calibrated this preset before
  // posture was collected at all, so switching it on would make the preset differ from the
  // measurement that justifies its numbers; and its effect is DATA-DEPENDENT — it does
  // nothing until a posture sync has run, then changes scores — so a preset carrying it
  // would silently re-score an estate on the strength of an unrelated sync finishing.
  // It is switched on deliberately, through the Rules page, with the same preview.
  gapSources: {
    fiveRs: true, deprecatedModel: true, inactiveAgent: true, frameworkMapping: false,
  },
  findingSeverityWeights: { CRITICAL: 1.5, HIGH: 1.2, MEDIUM: 1, LOW: 0.6 },
  pillarBCap: 25,
  // Split, so the pillar takes more than two values. Reaching sensitive data is worth 6 —
  // half what it was, because it is what most of the estate shares — and what you reach is
  // worth up to 6 more. An asset with one MEDIUM finding scores 6+2=8; one with three
  // CRITICALs scores 6+7=13, clamped to the 12 cap. Two values become five.
  dataExposurePoints: { SENSITIVE: 6, DATA_ACCESS: 3, NONE: 0 },
  dataAmplifier: 1,
  dataFindingPoints: { CRITICAL: 6, HIGH: 4, MEDIUM: 2, LOW: 1 },
  dataFindingScaling: "log2",
  dataFindingMultiplier: 1.2,
  pillarCCap: 12,
  exposurePoints: { CONFIRMED: 18, UNDETERMINED: 7, NONE: 0 },
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

/** The largest price any of these severities carries in `points`. Zero for an empty list. */
function worstPoints(severities: Severity[], points: Record<IssueSeverityKey, number>): number {
  let worst = 0;
  for (const s of severities) {
    const p = points[s as IssueSeverityKey] ?? 0;
    if (p > worst) worst = p;
  }
  return worst;
}

function worstSeverityPoints(severities: Severity[], rule: AarsRule): number {
  return worstPoints(severities, rule.severityPoints);
}

/**
 * Both scalings agree at n≤1 (×1) and n=2 (×m); see multiIssueFactor, which is this with the
 * pillar-A knobs bound. Shared so pillar C's count term cannot drift from pillar A's.
 */
function countFactor(count: number, scaling: MultiIssueScaling, multiplier: number): number {
  if (count <= 1) return 1;
  if (scaling === "log2") return 1 + (multiplier - 1) * Math.log2(count);
  return multiplier;
}

/**
 * The count multiplier. Both scalings agree at n≤1 (×1) and n=2 (×m) — that identity is
 * what lets `log2` be adopted without re-pricing any asset whose count the spec was
 * already reading correctly, and it is asserted in aars.test.ts.
 */
export function multiIssueFactor(count: number, rule: AarsRule): number {
  return countFactor(count, rule.multiIssueScaling, rule.multiIssueMultiplier);
}

/**
 * Pillar C's finding term: the worst reachable data-finding severity, scaled by how many
 * findings are reachable. Zero when nothing was collected AND when nothing was found — the
 * two are distinguished upstream (an absent list vs an empty one), not here, because both
 * add nothing to a score.
 */
export function dataFindingPointsFor(severities: Severity[], rule: AarsRule): number {
  if (!severities.length) return 0;
  return Math.round(
    worstPoints(severities, rule.dataFindingPoints) *
      countFactor(severities.length, rule.dataFindingScaling, rule.dataFindingMultiplier),
  );
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

  // Pillar C in two terms: the exposure TIER (does it reach sensitive data at all) and the
  // FINDINGS (what, and how much). The amplifier covers both — the 5Rs weakness it encodes
  // is about data-security controls generally, which is exactly what a data finding reports.
  const dataTier = rule.dataExposurePoints[input.dataExposure] ?? 0;
  const dataFound = dataFindingPointsFor(input.dataFindingSeverities ?? [], rule);
  const data = Math.min(rule.pillarCCap, Math.round((dataTier + dataFound) * rule.dataAmplifier));

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
