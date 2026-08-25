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

/**
 * What the UI calls this model on any surface ABOUT AN ASSET. The one place the string
 * lives, so it cannot drift between a column header, a chip, a sheet caption and a query
 * field label.
 *
 * THE IDENTIFIER AND THE LABEL ARE DELIBERATELY DIFFERENT, and the difference is load-bearing
 * in both directions.
 *
 * The LABEL changed because "AI Asset Risk Score" overclaims. This model is a weighted sum
 * over issues, compliance gaps and data exposure that have already been FOUND; "risk"
 * implies forward-looking consequence, and that is the AssetPosture tier's job (posture.ts:
 * capability × containment × consequence). Calling a backward-looking total a risk score is
 * what let its bands be read as an SLA — see ai/AARS_SCORING_ASSESSMENT.md §3, where the top
 * band holds 19 of 30 scored assets.
 *
 * The IDENTIFIERS did not change, and must not. Eight of them are persisted —
 * `ai_assets.aars` / `aars_severity` / `aars_pillars_json` / `aars_input_json`,
 * `sync_history.aars_severity_json` / `aars_rule_version`, and the `aars_rule` /
 * `aars_scored_version` settings keys — and `sheetsDb.ensureHeaders` only ever APPENDS: it
 * has no rename path and no drop path, so a renamed column would sit beside its predecessor
 * in every tenant's sheet permanently. The evidence is already in the tree: renaming the
 * single field `aarsBand` → `aarsSeverity` still costs four maintained code paths today
 * (`normalizeLegacyAars`, `rowToAsset`'s dual read, and two branches in diagnostics.ts). A
 * label is free to change; a column name is a migration this app cannot perform.
 *
 * The acronym AARS survives on the Scoring Models page, where it names a specific tunable
 * model rather than making a claim about an asset — and that page is now the only place
 * either the label or the number appears. The client mirror of this constant went with the
 * asset surfaces that used to render it: nothing outside this module reads it any more, so
 * there is no second copy left to drift.
 */
export const AARS_DISPLAY_LABEL = "Findings score";

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
 * The unit pillar B prices, as opposed to the cascade that prices it.
 *
 * `"code"` is the spec: one gap per distinct framework code (OWASP LLM / Agentic / ML,
 * 5Rs) plus `NO_GUARDRAIL`. Its defect is measured, not theoretical —
 * ai/AARS_SCORING_ASSESSMENT.md §1: the codes are not Wiz data, they are four hardcoded
 * literals in `toxicCombos.COMBO_GROUPS` keyed to four Wiz rule ids. An issue matching one
 * mints 4–7 codes and pins pillar B at its cap; an issue matching none contributes zero.
 * Worse, three of those literals name the SAME underlying fact three ways — `LLM03` /
 * `ASI04` / `ML_SUPPLY_CHAIN` are one supply-chain condition, not three — so even the
 * "healthy" middle of the distribution over-charges.
 *
 * `"condition"` prices the thing the codes were always standing in for: the four
 * `riskConditions.CONDITION_KEYS` an asset actually holds (`COND_MISSING_GUARDRAIL`,
 * `COND_EXCESSIVE_PRIVILEGE`, `COND_SENSITIVE_DATA`, `COND_INTERNET_EXPOSURE`, each priced
 * once, however many issues or frameworks cite it) plus one charge per distinct
 * toxic-combination group its open issues fall into (`COMBO_<group>`). Framework codes
 * are NOT deleted — `IssueRow.frameworks` is untouched, so the detail sheet and the
 * compliance rollups render exactly as before — pillar B just stops pricing them.
 *
 * Defaults to `"code"`: this is a derivation knob (`derivationSignature` carries it), and
 * every knob in this file ships opt-in so `ai/custom_score.md`'s applied table keeps
 * reproducing untouched. `AARS_V3_RULE` is the first preset to select `"condition"`.
 */
export type GapUnit = "code" | "condition";

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
  /**
   * What a pillar-B gap COUNTS, before the cascade below prices it. Defaults to the spec's
   * `"code"`. See `GapUnit` for what `"condition"` changes and why.
   */
  gapUnit: GapUnit;
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
   * boolean — "reaches sensitive data" — that most of the landscape shares, and the assessment
   * calls that "a true fact about the landscape rather than a modelling error". A pillar
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
  // "code": the spec's unit — one gap per distinct framework code. See `GapUnit`.
  gapUnit: "code",
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
 * sits at its cap for every scored agent, the landscape collapses onto ~5 distinct scores,
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
 *                price alone is shared by two thirds of the landscape, so the findings an asset
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
  // Stays "code", same reasoning as `frameworkMapping` below: this preset was calibrated
  // against the code-unit shape, and switching the unit is a bigger act than this pass —
  // `AARS_V3_RULE` is that act, kept separate so v2 keeps meaning what it always meant.
  gapUnit: "code",
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
  // would silently re-score a landscape on the strength of an unrelated sync finishing.
  // It is switched on deliberately, through the Rules page, with the same preview.
  gapSources: {
    fiveRs: true, deprecatedModel: true, inactiveAgent: true, frameworkMapping: false,
  },
  findingSeverityWeights: { CRITICAL: 1.5, HIGH: 1.2, MEDIUM: 1, LOW: 0.6 },
  pillarBCap: 25,
  // Split, so the pillar takes more than two values. Reaching sensitive data is worth 6 —
  // half what it was, because it is what most of the landscape shares — and what you reach is
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

/**
 * A second calibrated preset — offered beside `AARS_V2_RULE`, never a default — that
 * selects `gapUnit: "condition"` instead of retuning pillar B's aggregation.
 *
 * `AARS_V2_RULE` takes pillar B off its ceiling with `rss`: √(Σ p²) over the SAME 5-6
 * framework codes an issue mints, so it stops clamping but is still summing three
 * taxonomies' names for one fact (ai/AARS_SCORING_ASSESSMENT.md §1's "LLM03 / ASI04 /
 * ML_SUPPLY_CHAIN are one supply-chain condition, charged three times"). v3 fixes the unit
 * itself: `deriveAarsInput` stops emitting a gap per framework code and emits one gap per
 * `riskConditions.CONDITION_KEYS` condition actually HELD, plus one per distinct toxic-
 * combination group — see `GapUnit`. The framework codes stay exactly where they were on
 * `IssueRow.frameworks`; only pillar B's pricing currency changes, so the compliance pages
 * are byte-identical under v3.
 *
 * Everything else is `AARS_V2_RULE`, unchanged: pillar caps 45/25/12/18 = 100, `log2` issue
 * scaling, `rss` gap aggregation (still worth keeping — an asset can hold 2-3 conditions
 * PLUS 2-3 combo groups at once, and `rss` is the same sublinear response to that as it is
 * to a framework-code list), the amplifier folded to 1, and INACTIVE_AGENT / DEPRECATED_MODEL
 * priced explicitly rather than by the fallback.
 *
 * The cascade prices the new vocabulary explicitly rather than falling through to
 * `gapFallbackPoints` (5, inherited from v2):
 *
 *   COND_MISSING_GUARDRAIL    10  Same price `NO_GUARDRAIL` always had — this IS that gap,
 *                                 renamed to the unit that also reaches it from privilege/
 *                                 data findings, not only from `node.guardrailMissing`.
 *   COND_SENSITIVE_DATA        8  Above excessive privilege: reachable sensitive data is
 *   COND_EXCESSIVE_PRIVILEGE   8  what a missing guardrail or a leaked credential turns
 *                                 into an incident, so both outrank the network fact below.
 *   COND_INTERNET_EXPOSURE     6  Lowest of the four on PURPOSE, not because it matters
 *                                 less: pillar D already prices confirmed/undetermined
 *                                 reachability on its own 18-point budget (`exposurePoints`
 *                                 above), so charging it heavily again here would count the
 *                                 same network fact under two pillars. `COND_INTERNET_
 *                                 EXPOSURE` still needs a price — an asset can hold the
 *                                 condition without the traversal that feeds pillar D having
 *                                 run — it just should not compete with pillar D's own share.
 *   COMBO_ (prefix)             5  One toxic-combination pattern, at parity with v2's ML/5R
 *                                 rows — a real but secondary signal once the four conditions
 *                                 underneath it are already priced.
 *
 * `pillarBCap` stays 25, unchanged from v2 — measurement (ai/AARS_ASSESSMENT.md's method,
 * reproduced in test/scoreOrdinality.test.ts §6b) is what justifies that rather than
 * widening it on the suggested prices alone; see that file and ai/AARS_ASSESSMENT.md §6 for
 * the measured comparison against v2.
 */
export const AARS_V3_RULE: AarsRule = {
  ...AARS_V2_RULE,
  gapUnit: "condition",
  gapPoints: [
    { match: "exact", code: "INACTIVE_AGENT", points: 10 },
    { match: "exact", code: "DEPRECATED_MODEL", points: 5 },
    { match: "exact", code: "COND_MISSING_GUARDRAIL", points: 10 },
    { match: "exact", code: "COND_SENSITIVE_DATA", points: 8 },
    { match: "exact", code: "COND_EXCESSIVE_PRIVILEGE", points: 8 },
    { match: "exact", code: "COND_INTERNET_EXPOSURE", points: 6 },
    { match: "prefix", code: "COMBO_", points: 5 },
  ],
};

/** The AARS scale itself: not tunable, unlike everything in `AarsRule`. */
export const AARS_MAX_SCORE = 100;

/**
 * The highest score a rule can actually produce — pillar A's cap + pillar B's cap +
 * pillar C's cap + the largest of pillar D's three exposure prices, clamped to
 * `AARS_MAX_SCORE` exactly as `computeAars`'s own final `Math.min` clamps the score itself.
 *
 * Exists because `AarsRule`'s four caps are independently tunable and nothing ever required
 * them to sum to 100. A live tenant's tuned rule (pillar caps 45/25/6, pillar D off) sums to
 * 76 — but its bands were left at the spec defaults, CRITICAL at 70 and HIGH at 50. Against
 * an achievable maximum of 76, CRITICAL needs 92% of everything the rule can ever award and
 * HIGH needs 66%; on that tenant's data zero assets ever reached either band. Nothing told
 * the operator, because nothing compared a band threshold to the ceiling the rule's OWN caps
 * impose — every check in `validateAarsRule` was local to the bands or to one pillar's own
 * table, none of them ever added the caps up. `validateAarsRule` uses this to catch exactly
 * that shape before a rule is saved; the AARS Rules page's "Pillar caps total N" line is a
 * near-miss at the same fact, computed separately from pillar C's exposure tier alone
 * (excluding the finding term and pillar D entirely) for its stacked-bar illustration — this
 * function is the one place that adds up every term a score can actually contain.
 */
export function achievableMax(rule: AarsRule): number {
  const maxExposure = Math.max(
    rule.exposurePoints.CONFIRMED,
    rule.exposurePoints.UNDETERMINED,
    rule.exposurePoints.NONE,
  );
  return Math.min(
    AARS_MAX_SCORE,
    rule.pillarACap + rule.pillarBCap + rule.pillarCCap + maxExposure,
  );
}

/**
 * A short, human-readable fingerprint of the knobs that change WHICH GAPS EXIST, as
 * opposed to how they price — `gapUnit` plus `gapSources`'s four flags. `gapUnit` had to
 * join this the day it existed, not later: it decides whether pillar B's gaps are framework
 * codes or `COND_*`/`COMBO_*` conditions, which is a more radical change to WHICH GAPS EXIST
 * than any single `gapSources` flag. Leaving it out would repeat exactly the bug Phase 2b's
 * `gapSources` fingerprint was built to fix — an operator flips `gapUnit`, hits Recompute,
 * and the persisted gaps (still framework codes, or still conditions) silently survive until
 * the next full sync. Persisted on `GNode.aarsInput.derivedUnder` (graphEnrich.ts) so a
 * rescore can tell a stale DERIVATION apart from a stale PRICE: `enrichFromTabs`
 * (syncStore.ts) reuses a persisted input to re-PRICE it for free, and that is correct for a
 * `severityPoints` or cap edit — but reusing it across a `gapSources` change silently keeps
 * gaps that no longer reflect the rule. An operator flips `fiveRs` on, hits Recompute, and
 * nothing moves until the next full sync; this signature is what lets `enrichFromTabs` tell
 * the difference and re-derive only when it has to.
 *
 * Deliberately NOT a hash — `sha1.ts` exists and is not used here. This value lands in a
 * sheet cell and inside `aars_input_json`, read by a human comparing two rows; a digest
 * would tell them nothing a name doesn't. Extend the function, not its callers, when a
 * derivation knob is added — and add ONLY derivation knobs. A pricing field
 * (`severityPoints`, `gapPoints`, any cap, …) must never appear here: including one would
 * force every tenant to re-derive on a price tweak, throwing away the zero-Wiz-calls
 * property `enrichFromTabs` exists for.
 */
export function derivationSignature(rule: AarsRule): string {
  const s = rule.gapSources;
  return [
    `gapUnit:${rule.gapUnit}`,
    `fiveRs:${s.fiveRs ? 1 : 0}`,
    `deprecatedModel:${s.deprecatedModel ? 1 : 0}`,
    `inactiveAgent:${s.inactiveAgent ? 1 : 0}`,
    `frameworkMapping:${s.frameworkMapping ? 1 : 0}`,
  ].join("|");
}

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
