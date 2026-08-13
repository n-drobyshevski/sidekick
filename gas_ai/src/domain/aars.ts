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

/**
 * Deployment environment, worst first. `UNCLASSIFIED` is the honest default and is NOT the
 * bottom of a ramp: it means no rule matched, so the asset keeps whatever it would have
 * scored before environments existed.
 *
 * Wiz has no environment field on a cloud resource. What the real tenant does have is an
 * account naming convention — `dpcp-production-ck-8ytk`, `dpcp-preproduction-ck-z8g4`,
 * `sap-nonprodpartner`, `inix-horsprod-n0wq`, `ai-industry-pp-4yqw` — which classifies 16 of
 * the 40 agents in gas_ai/exemples/get_ai_agents_reponse.js. That convention is tenant
 * property, not product knowledge, which is why the patterns are a rule the operator edits
 * rather than a constant this file asserts.
 */
export type Environment = "PROD" | "PREPROD" | "NONPROD" | "DEV" | "UNCLASSIFIED";

/** Match mode for an environment rule. `regex` is the escape hatch; `contains` covers most. */
export type EnvMatch = "contains" | "regex";

/**
 * One row of the environment cascade. Rows are tried in order, FIRST MATCH WINS — the same
 * contract as the pillar-B gap cascade, so an operator who has read one has read both.
 * Order is meaning here too: `nonprod` must sit above `prod`, or "sap-nonprodpartner"
 * classifies as production.
 */
export interface EnvironmentRule {
  match: EnvMatch;
  /** Matched case-insensitively against the asset's cloud-account name. */
  pattern: string;
  environment: Environment;
}

/**
 * Effective privilege, as its own axis.
 *
 * It needs one because `dataExposureOf` conflates privilege with data reach: it returns
 * SENSITIVE when the asset touches sensitive data and only falls through to DATA_ACCESS
 * otherwise, so for any asset with sensitive access the privilege level is DISCARDED —
 * and even in the fall-through branch ADMIN and HIGH collapse to one value. The result is
 * that `hasAdminPrivileges` is fetched from Wiz, normalized, persisted in `ai_assets.admin_priv`
 * and read back, yet changes no score anywhere. ADMIN and HIGH are not the same claim, and
 * "holds sensitive data" and "can do anything" are not the same axis.
 */
export type PrivilegeLevel = "ADMIN" | "HIGH" | "NONE";

/**
 * A conjunction that is worth more than the sum of its parts.
 *
 * Additive pillars cannot express one. This product is *named* after toxic combinations,
 * and ai/queries/6_IAM.MD rates "high privilege AND sensitive data AND no guardrail" at
 * +50 precisely because the three together are a different claim from any two of them:
 * the privilege is what makes the data reachable, and the missing guardrail is what makes
 * the reach unmonitored. A sum prices that identically to three unrelated findings.
 *
 * `conditions` are `ConditionKey`s evaluated through `riskConditions.conditionHolds` — the
 * same strict predicate the graph topology and the Toxic Combinations matrix already
 * share, so a bonus can never disagree with the matrix about whether an asset carries a
 * condition. ALL must hold; an empty list never fires.
 */
export interface CombinationRule {
  /** ConditionKey values: MISSING_GUARDRAIL, EXCESSIVE_PRIVILEGE, SENSITIVE_DATA, INTERNET_EXPOSURE. */
  conditions: string[];
  points: number;
  /** Shown verbatim in the drill-down, so a bonus explains itself. */
  label?: string;
}

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
  /** Absent reads as NONE. The spec rule prices every level at zero. */
  privilege?: PrivilegeLevel;
  /** Absent reads as UNCLASSIFIED, which the spec rule prices at zero. */
  environment?: Environment;
  /**
   * The risk conditions this asset actually carries, as `ConditionKey` strings. Resolved
   * by the caller through `riskConditions.conditionHolds` so this module stays free of the
   * graph model — and so the score reads conditions from the one table the matrix reads.
   */
  conditions?: string[];
}

export interface AarsResult {
  score: number;                 // 0–100, integer
  severity: AarsSeverity;
  /**
   * The evidence breakdown. Everything after `data` is priced at 0 by the spec rule, so a
   * default-rule score is still exactly toxic + compliance + data.
   */
  pillars: {
    toxic: number;
    compliance: number;
    data: number;
    exposure: number;
    privilege: number;
    environment: number;
    /** Points from conjunctions that fired. Zero under the spec rule, which has none. */
    combination: number;
  };
  /** Which combination rules fired, in rule order — the evidence behind that number. */
  combinations?: Array<{ label: string; points: number }>;
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
   * `DORMANT_AGENT` for an asset that is still `Active` and still privileged, but has not
   * been seen for `dormantAfterDays`. This is the shadow/orphaned-asset test that
   * ai/ai_agents_discovery_queries.md §11 defines and motivates with
   * AGENT_AUTOGEN_DO_NOT_DELETE — an agent nobody owns, nobody watches, and nobody would
   * miss if it were abused. Distinct from `inactiveAgent`, which reads a status Wiz set;
   * this one is measured from `lastSeen`, so it catches the agent that still *looks* live.
   */
  dormantAgent?: boolean;
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
  /** Age threshold for `gapSources.dormantAgent`, in days. */
  dormantAfterDays: number;
  /**
   * Per-severity weight on a gap contributed by a failing config finding. The spec
   * weights them all at 1, so a CRITICAL failing control prices exactly like a LOW one.
   */
  findingSeverityWeights: Record<IssueSeverityKey, number>;
  pillarBCap: number;
  dataExposurePoints: Record<DataExposure, number>;
  dataAmplifier: number;
  /**
   * Pillar D — internet reachability. All zeros in the spec rule, which scores exposure
   * nowhere despite the graph computing it as a first-class node
   * (graphEnrich.withInternetExposureNodes) and the doc devoting a section to it.
   */
  exposurePoints: Record<InternetExposure, number>;
  /**
   * Effective privilege as its own term. All zero in the spec rule, which reads privilege
   * only as a fallback bucket of pillar C and throws the ADMIN/HIGH distinction away.
   */
  privilegePoints: Record<PrivilegeLevel, number>;
  /**
   * Conjunction bonuses. Unlike the gap cascade this is NOT first-match-wins: every rule
   * whose conditions all hold contributes, because two different conjunctions holding at
   * once really is worse than either alone. Empty in the spec rule.
   */
  combinationRules: CombinationRule[];
  /** Ordered environment cascade over the cloud-account name — FIRST MATCH WINS. */
  environmentRules: EnvironmentRule[];
  /**
   * Points per environment. UNCLASSIFIED is pinned at 0 by `cleanAarsRule` and is not an
   * operator choice: an asset no rule matched must score exactly as it did before
   * environments existed, never as though it had been classified as safe.
   */
  environmentPoints: Record<Environment, number>;
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
  gapSources: { fiveRs: false, deprecatedModel: false, inactiveAgent: false, dormantAgent: false },
  /** Days without a sighting before `dormantAgent` fires. Only read when that source is on. */
  dormantAfterDays: 90,
  // All 1: the spec reads a failing control as present-or-absent, never as more or less
  // severe. Kept as a knob because ai_findings.severity is already persisted and unused.
  findingSeverityWeights: { CRITICAL: 1, HIGH: 1, MEDIUM: 1, LOW: 1 },
  pillarBCap: 30,
  dataExposurePoints: { SENSITIVE: 20, DATA_ACCESS: 10, NONE: 0 },
  // 5Rs framework at 53% — data-exposure controls are systemically weak, so all
  // data-related points are amplified (ai/custom_score.md Pillar C).
  dataAmplifier: 1.1,
  // Pillar D is OFF in the spec rule. The doc reports internet exposure beside the score
  // but never adds it to one, so scoring it here would change every published number.
  exposurePoints: { CONFIRMED: 0, UNDETERMINED: 0, NONE: 0 },
  privilegePoints: { ADMIN: 0, HIGH: 0, NONE: 0 },
  // Empty: the doc's applied table is a pure sum of three pillars, and a conjunction bonus
  // would break every row of it.
  combinationRules: [],
  // A suggested cascade, not an assertion: these are the conventions the reference tenant
  // actually uses, and an operator whose accounts are named differently gets UNCLASSIFIED
  // everywhere until they edit it. Order is load-bearing — every negative form has to sit
  // above `prod`, or "sap-nonprodpartner" and "inix-horsprod-n0wq" classify as production.
  environmentRules: [
    { match: "contains", pattern: "nonprod", environment: "NONPROD" },
    { match: "contains", pattern: "non-prod", environment: "NONPROD" },
    { match: "contains", pattern: "horsprod", environment: "NONPROD" },
    { match: "contains", pattern: "preprod", environment: "PREPROD" },
    { match: "contains", pattern: "pre-prod", environment: "PREPROD" },
    { match: "regex", pattern: "(^|[^a-z])pp([^a-z]|$)", environment: "PREPROD" },
    { match: "regex", pattern: "(^|[^a-z])(dev|test|sandbox|poc|demo)([^a-z]|$)", environment: "DEV" },
    { match: "contains", pattern: "prod", environment: "PROD" },
  ],
  // All zero: the applied table in ai/custom_score.md scores agent-F and agent-F-preprod
  // identically, and the default rule must keep reproducing it.
  environmentPoints: { PROD: 0, PREPROD: 0, NONPROD: 0, DEV: 0, UNCLASSIFIED: 0 },
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
 *   Pillar C 12  Halved, and the amplifier folded into the points. The 5Rs ×1.1 is a
 *                tenant-wide constant: it cannot change a ranking, only inflate every
 *                score, yet it decides individual band membership (it is the whole reason
 *                agent-H-chatbot is CRITICAL at 71 rather than HIGH at 69). Baking it in
 *                makes the pillar say what it means. The weight drops because the pillar
 *                is at its ceiling for two thirds of the estate and so ranks almost
 *                nothing — a near-constant term is not worth 22 points of a 100-point scale.
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
  gapSources: { fiveRs: true, deprecatedModel: true, inactiveAgent: true, dormantAgent: false },
  dormantAfterDays: 90,
  findingSeverityWeights: { CRITICAL: 1.5, HIGH: 1.2, MEDIUM: 1, LOW: 0.6 },
  pillarBCap: 25,
  dataExposurePoints: { SENSITIVE: 12, DATA_ACCESS: 6, NONE: 0 },
  dataAmplifier: 1,
  exposurePoints: { CONFIRMED: 18, UNDETERMINED: 7, NONE: 0 },
  // v2's caps already sum to exactly 100, so it has no budget for the privilege and
  // environment axes. It stays as published — a calibrated model for the signal set that
  // existed when it was written. The newer axes are v3's to spend.
  privilegePoints: { ADMIN: 0, HIGH: 0, NONE: 0 },
  combinationRules: [],
  environmentRules: DEFAULT_AARS_RULE.environmentRules.map((e) => ({ ...e })),
  environmentPoints: { PROD: 0, PREPROD: 0, NONPROD: 0, DEV: 0, UNCLASSIFIED: 0 },
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

/**
 * Classify an account name through the rule's cascade. Same first-match-wins contract as
 * `gapPointsFor`, and the same tolerance for junk: an unreadable regex is skipped rather
 * than thrown, because a hand-edited pattern must not be able to break a whole sync.
 */
export function environmentFor(
  accountName: string | undefined,
  rule: AarsRule = DEFAULT_AARS_RULE,
): Environment {
  const name = String(accountName ?? "").trim().toLowerCase();
  if (!name) return "UNCLASSIFIED";
  for (const row of rule.environmentRules) {
    const p = String(row.pattern ?? "").trim().toLowerCase();
    if (!p) continue;
    if (row.match === "regex") {
      let re: RegExp;
      try {
        re = new RegExp(p);
      } catch {
        continue;
      }
      if (re.test(name)) return row.environment;
    } else if (name.indexOf(p) >= 0) {
      return row.environment;
    }
  }
  return "UNCLASSIFIED";
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

  const privilege = rule.privilegePoints[input.privilege ?? "NONE"] ?? 0;
  const environment = rule.environmentPoints[input.environment ?? "UNCLASSIFIED"] ?? 0;

  const fired = firedCombinations(input.conditions ?? [], rule);
  const combination = fired.reduce((acc, f) => acc + f.points, 0);

  const score = Math.min(
    AARS_MAX_SCORE,
    toxic + compliance + data + exposure + privilege + environment + combination,
  );
  const result: AarsResult = {
    score,
    severity: aarsSeverity(score, rule.bands),
    pillars: { toxic, compliance, data, exposure, privilege, environment, combination },
  };
  // Omitted rather than empty when nothing fired, so the persisted blob does not grow a
  // key for every asset in an estate that uses no conjunctions.
  if (fired.length) result.combinations = fired;
  return result;
}

/**
 * The conjunctions this asset satisfies, in rule order. Every matching rule contributes —
 * see `combinationRules` on why this is not a first-match cascade.
 */
export function firedCombinations(
  conditions: string[],
  rule: AarsRule = DEFAULT_AARS_RULE,
): Array<{ label: string; points: number }> {
  const held = new Set((conditions ?? []).map((c) => String(c).trim().toUpperCase()));
  const out: Array<{ label: string; points: number }> = [];
  for (const row of rule.combinationRules) {
    const keys = (row.conditions ?? []).map((c) => String(c).trim().toUpperCase());
    // An empty rule would otherwise fire on every asset — a term that moves everything
    // equally carries no ranking information at all.
    if (!keys.length) continue;
    if (!keys.every((k) => held.has(k))) continue;
    out.push({ label: row.label || keys.join(" + "), points: row.points });
  }
  return out;
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
