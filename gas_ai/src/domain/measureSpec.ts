// The Measure Specifications — Phase 8 of the Prioritization-to-Prediction rebuild: one
// record per number this product publishes, written to NIST SP 800-55v1 (Dec 2024)'s
// measure-specification template, plus the two ISO/IEC 27004 Annex A fields that template
// omits (`measurementMethod`, `revisionDue`).
//
// WHY THIS FILE EXISTS. Every other Phase in this rebuild answers "what is the number";
// this one answers "what is the number FOR, who reads it, how was it collected, and when
// does someone have to look at it again". A dashboard full of well-computed numbers with
// no such record is a dashboard nobody can audit — an operator cannot tell a measurement
// from an opinion, or a live figure from a stale one, without reading source.
//
// THE TWO DISCIPLINES THIS FILE HOLDS ITSELF TO, BOTH ENFORCED BY test/measureSpec.test.ts:
//
// 1. HONESTY OVER COMFORT. Two categories of record get uncomfortable text on purpose,
//    never softened:
//      - Anything whose value can be swayed by `ai_verdict` (`aiRemediationAnalysis
//        .verdict`) or `ai_recommended_severity` is `measurementMethod: "Subjective"` — an
//        LLM rater's opinion, non-deterministic upstream (problem.ts's own header:
//        "the same issue can re-run to a different verdict"), inter-rater reliability
//        against a human analyst unmeasured. `problem-outcome-distribution` below is that
//        record: the exploitation axis can reach SUSPECTED through `issue.aiVerdict`
//        (never ACTIVE alone — see `exploitationOfIssue` — but SUSPECTED still moves an
//        outcome), so the queue an analyst triages from is not purely deterministic and
//        must not be reported as if it were.
//      - No record here computes an MTTR over closed issues. `IssueRow.resolvedAt` exists
//        and could be subtracted from `createdAt`, but a mean over that population is
//        CENSORED DATA: every still-open issue — usually the worst offenders, the ones a
//        mean-time-to-remediate figure exists to catch — has no close date and would be
//        silently excluded, understating the real remediation time. Rather than publish a
//        number that flatters itself, this file publishes none; a median-with-censoring or
//        a survival curve would be required first, and neither is implemented.
//
// 2. TIME-BASIS HONESTY. `sync_history` is the only append-only tab this app writes —
//    every other data tab (`ai_assets`, `ai_issues`, `ai_findings`, …) is overwritten
//    WHOLESALE on every sync (sheetsDb.ts's own TAB_HEADERS comments say so at each block).
//    There is therefore no per-entity status history anywhere in this ledger: no query can
//    answer "when did THIS asset's score cross into CRITICAL" or "how long has THIS issue
//    sat at ACT" from stored data alone. Every `timeBasedReference` below says so in the
//    same words, because a measure-spec record that overclaims its own time basis is worse
//    than no record — it tells an auditor a history exists that does not. Reconstructing
//    real per-entity history would mean replaying the Drive archive snapshots sync-by-sync,
//    which this app does not implement (see `gas/README.md`'s own scope notes on the
//    archive store).
//
// WHY A TEST ENFORCES `revisionDue`. A measure whose owner never has to look at it again is
// a measure that quietly stops meaning anything the day its underlying model changes — the
// exact failure ai/AARS_ASSESSMENT.md documents for the score itself. Pinning an expiry
// date and FAILING THE BUILD once the frozen test clock passes it (test/measureSpec.test.ts,
// against `test/gasEnv.ts`'s `FROZEN_NOW`) is what turns "review this yearly" from a comment
// nobody rereads into a red CI run somebody has to act on. That failure, when it eventually
// happens, is the feature working as designed — see the test file's own header.

/** NIST SP 800-55v1 §3.2's four measure types. */
export type MeasureType = "implementation" | "effectiveness" | "efficiency" | "impact";

/** ISO/IEC 27004 Annex A — how the value was arrived at, not merely who computed it. */
export type MeasurementMethod = "Subjective" | "Objective";

export interface MeasureSpec {
  id: string;
  /** The security/business goal this measure supports — NIST 800-55v1's "Goal". */
  goal: string;
  /** The population or boundary the measure covers — NIST's "Scope". */
  scope: string;
  /** What is actually counted or computed — NIST's "Measure". */
  measure: string;
  type: MeasureType;
  /** The calculation, precisely — function names, not prose paraphrase. */
  formula: string;
  /** The desired value or threshold, or an honest statement that none is set and why. */
  target: string;
  /** Evidence the underlying activity this measure reports on is actually happening. */
  implementationEvidence: string;
  /** What time period/basis this number covers — see this file's header, discipline 2. */
  timeBasedReference: string;
  /** Who owns collecting/acting on this measure. */
  responsibleParties: string;
  /** `<tab>.<column>` — validated against `TAB_HEADERS` in sheetsDb.ts by the test. */
  dataSource: string;
  /** Where this number is surfaced today. */
  reportingFormat: string;
  measurementMethod: MeasurementMethod;
  /** ISO date. The test fails once the frozen clock passes it — see this file's header. */
  revisionDue: string;
}

/**
 * Every `timeBasedReference` opens with this sentence — see this file's header, discipline
 * 2. Centralized so the sentence cannot drift between records; string-concatenated per
 * record rather than referenced, so `test/measureSpec.test.ts` can assert plain equality
 * of substance without every record importing a helper.
 */
const NO_PER_ENTITY_HISTORY =
  "Per-sync distribution only; per-entity history requires Drive archive replay, which is " +
  "not implemented. Every data tab this measure reads is overwritten wholesale on each " +
  "sync — only sync_history is append-only, and it records landscape-wide aggregates, never " +
  "a per-entity trail.";

const REVISION_DUE = "2027-08-13"; // ~1 year past the frozen test clock (2026-08-13)

export const MEASURE_SPECS: readonly MeasureSpec[] = [
  // -------------------------------------------------------------------------- AARS
  {
    id: "aars-score",
    goal:
      "Give every AI asset a single, comparable risk number so the landscape can be ranked "
      + "and triaged, priced from what a sync actually collected rather than asserted.",
    scope: "Every AI asset in ai_assets carrying a persisted `aars` value as of the last sync.",
    measure: "The AARS score: 0–100, summed across four pillars (toxic-combination "
      + "participation, compliance gaps, data exposure, internet reachability) and clamped.",
    type: "impact",
    formula:
      "computeAars(aarsInput, aarsRule) — src/domain/aars.ts. Persisted per asset as "
      + "aars_input_json (what was priced) and aars (the resulting number); recomputed on "
      + "demand by AARS Rules → Recompute (syncStore.rescoreInventory), never automatically.",
    target:
      "No numeric target — this is a ranking axis, not a compliance gate. This deployment "
      + "sets no house-wide 'acceptable AARS' threshold; an operator's SLA policy, if any, "
      + "lives outside this app.",
    implementationEvidence:
      "aars_input_json is non-empty for every scored asset, and aars_rule_version on the "
      + "settings row matches the version that scored it (bootstrap's aarsRule.stale flag "
      + "reports the mismatch when it does not).",
    timeBasedReference: "Snapshotted at each sync's completion. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "AARS Rules page operator (the model); security analysts (the ranking).",
    dataSource: "ai_assets.aars, ai_assets.aars_input_json",
    reportingFormat:
      "AI Inventory register (sortable score column, shown beside aars-percentile); asset "
      + "detail sheet's verdict number and pillar bars.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
  {
    id: "aars-band",
    goal:
      "Turn the continuous AARS score into a small, nameable set of levels — legitimate as "
      + "a MODEL diagnostic (the AARS trend, the AARS Rules page's band occupancy) and as "
      + "an opt-in filter, over its own scored population every time. NOT a claim about one "
      + "asset (P2c): the same rule has put nearly an entire landscape in CRITICAL on one "
      + "tenant and nearly an entire landscape in INFO on another under identical thresholds, "
      + "so the Inventory table and the asset sheet lead with aars-percentile instead — see "
      + "that record.",
    scope: "Every AI asset carrying an aars_severity value.",
    measure: "AARS band: CRITICAL / HIGH / MEDIUM / LOW / INFO, re-derived from the stored "
      + "score against the rule's band thresholds on every read.",
    type: "impact",
    formula:
      "Re-derived, not stored as a separate decision — bandRanges(rule.bands) applied to "
      + "the persisted aars on every read, so a threshold edit re-bands retroactively with "
      + "no re-sync and no rescore.",
    target:
      "No numeric target — see aars-score. A skewed distribution (most assets in one band) "
      + "is itself the signal aars-tie-rate and aars-effective-cardinality quantify, and on "
      + "the seed landscape it is severe: 19 of 30 scored assets in the top band with two "
      + "bands empty. The band is therefore published as CONTEXT beside a score and as a "
      + "distribution over the landscape, never as a per-asset decision; aars-percentile is "
      + "the placement statistic that replaced it in that role.",
    implementationEvidence: "aarsRule.bands on the settings row (settingsStore.getAarsRule) "
      + "carries four distinct, ordered thresholds — validateAarsRule rejects a rule that does not.",
    timeBasedReference: "Read live against the rule in force. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "AARS Rules page operator (thresholds); security analysts (the read).",
    dataSource: "ai_assets.aars, ai_assets.aars_severity",
    reportingFormat:
      "As CONTEXT: a plain word beside the score in the AI Inventory register and the asset "
      + "detail sheet — never a tinted verdict chip. As a DISTRIBUTION: the Inventory's "
      + "level strip and its per-sync trend chart. As a MODEL DIAGNOSTIC: the AARS Rules "
      + "page's band rail and occupancy read-out, the one surface that still tints it. No "
      + "KPI counts it: the criticalAars and highAars tiles were withdrawn once the top "
      + "band was measured holding the whole working population.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },

  {
    id: "aars-percentile",
    goal:
      "Say where one asset's findings score sits in the landscape that was actually scored, "
      + "so a reader can act on a placement instead of on a band that does not separate "
      + "assets. The band it replaces in this role holds 19 of 30 scored assets in its top "
      + "level on the seed landscape, with two levels empty.",
    scope:
      "Every asset carrying a numeric score at read time — the same population the "
      + "published denominator counts, and the same one the percentile is computed over. "
      + "Unscored assets are excluded from both, never counted as zero.",
    measure:
      "Midrank percentile of the score within the scored population, 0-100, higher = worse. "
      + "Tied scores share ONE percentile by construction, which is the point: a block of "
      + "assets the model cannot separate must not be handed an order it did not earn.",
    type: "impact",
    formula:
      "midrankPercentiles(scores) = (count below + count equal / 2) / N, rounded to whole "
      + "percent when published. The midrank form rather than the cumulative one: with a "
      + "14-asset tie block on the seed landscape, cumulative would read every member at the "
      + "top of its own block and claim it beat the assets genuinely above it.",
    target:
      "No target — a placement is not a threshold. The diagnostic reading is the opposite "
      + "of a bad value: a percentile IDENTICAL across many assets is the honest report of "
      + "a tie the score cannot break, and aars-tie-rate quantifies how much of that there is.",
    implementationEvidence:
      "Every scored asset carries a percentile on every read path (register, graph, detail "
      + "sheet) and none carries one in the ledger — there is no percentile column, and the "
      + "persisted-ledger golden snapshot has none.",
    timeBasedReference:
      "Recomputed on every read against the population as it stands, so an unchanged score "
      + "reads differently once other assets move. " + NO_PER_ENTITY_HISTORY,
    responsibleParties:
      "Security analysts (the read); AARS Rules page operator (the model it is a placement in).",
    dataSource: "ai_assets.aars",
    reportingFormat:
      "AI Inventory register (leads the score cell); asset detail sheet's verdict line, with "
      + "the population size beside it; security graph node badge.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
  // ----------------------------------------------------- the model's own discrimination
  {
    id: "aars-distinct-scores",
    goal:
      "Detect when the scoring MODEL itself has stopped discriminating — a rule can render "
      + "a confident number for every asset while carrying zero ranking information, and "
      + "nothing about a single score reveals that on its own.",
    scope: "Every scored asset in the population `ruleDiscrimination` is run over "
      + "(previewAarsRule's `after` — every asset re-scored under the rule being evaluated).",
    measure:
      "distinctScores: the count of DIFFERENT score values the scored population takes. "
      + "This measures the MODEL's separating power, not the landscape's risk level — an "
      + "landscape that is genuinely uniform in risk and a model that cannot tell assets apart "
      + "produce the identical number, and this record's whole job is to keep that "
      + "ambiguity visible rather than let a healthy-looking score list hide it.",
    type: "effectiveness",
    formula: "new Set(scores).size — rankStats.ts / aarsRule.ts's ruleDiscrimination().",
    target:
      "No fixed target. ai/AARS_ASSESSMENT.md §2 established the SPEC rule collapses to a "
      + "handful of distinct values on live data; there is no house-defined 'enough' "
      + "distinctScores figure, only a documented before/after comparison across rule edits.",
    implementationEvidence:
      "previewAarsRule's discrimination field is populated (never null) whenever at least "
      + "one asset carries a numeric aars — see EMPTY_DISCRIMINATION's guard for the zero case.",
    timeBasedReference: "Computed fresh on each AARS Rules preview request, over the "
      + "landscape as it reads right now. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "AARS Rules page operator, before saving a rule change.",
    dataSource: "ai_assets.aars",
    reportingFormat: "AARS Rules page, rule-preview Discrimination panel (previewAarsRule).",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
  {
    id: "aars-tie-rate",
    goal:
      "Same as aars-distinct-scores — measure the MODEL's discriminative power, not the "
      + "landscape's risk — but at the scale of PAIRS rather than values, which "
      + "distinctScores alone can hide (several small tie groups still look 'distinct').",
    scope: "The same scored population as aars-distinct-scores.",
    measure: "tieRate: the share of asset PAIRS the model cannot separate — 1.0 means "
      + "every pair of scored assets shares a value, so any ordering within the landscape is "
      + "arbitrary; 0 means every score is unique.",
    type: "effectiveness",
    formula: "rankStats.tieRate(scores) = Σ C(n_k,2) / C(N,2) over the distinct-value groups.",
    target: "No fixed target — same reasoning as aars-distinct-scores. A rule edit's tieRate "
      + "before/after is the comparison this figure exists to support, not a threshold.",
    implementationEvidence: "Same as aars-distinct-scores.",
    timeBasedReference: "Computed fresh on each AARS Rules preview request. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "AARS Rules page operator, before saving a rule change.",
    dataSource: "ai_assets.aars",
    reportingFormat: "AARS Rules page, rule-preview Discrimination panel (previewAarsRule).",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
  {
    id: "aars-effective-cardinality",
    goal:
      "Same as aars-distinct-scores and aars-tie-rate — the MODEL's discriminative power, "
      + "not the landscape's risk — weighted by population, so one outlier score does not "
      + "claim the same discrimination credit an even split across values would earn.",
    scope: "The same scored population as aars-distinct-scores.",
    measure:
      "effectiveCardinality: exp(Shannon entropy) over the score distribution — how many "
      + "distinct scores the landscape BEHAVES as if it has. Equals distinctScores only when "
      + "every value is taken equally often; a scale of {30: 1 asset, 72: 19 assets} reads "
      + "as barely more than one effective value, not two.",
    type: "effectiveness",
    formula: "rankStats.effectiveCardinality(scores) = exp(-Σ p_k · ln p_k).",
    target: "No fixed target — same reasoning as aars-distinct-scores.",
    implementationEvidence: "Same as aars-distinct-scores.",
    timeBasedReference: "Computed fresh on each AARS Rules preview request. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "AARS Rules page operator, before saving a rule change.",
    dataSource: "ai_assets.aars",
    reportingFormat: "AARS Rules page, rule-preview Discrimination panel (previewAarsRule).",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
  {
    id: "aars-pillar-saturation",
    goal:
      "Locate WHICH pillar of the MODEL has stopped discriminating, not just that the "
      + "total score has — a pillar pinned at its cap for most of the landscape still renders "
      + "a plausible total, and nothing about the sum alone points back at the pillar "
      + "responsible. Like the three records above it, this measures the MODEL's own "
      + "separating power, not the landscape's risk level.",
    scope: "The same scored population as aars-distinct-scores, per pillar.",
    measure:
      "saturated.{toxic,compliance,data,exposure,score}: count of assets sitting AT or "
      + "above each pillar's cap (and at the 0–100 ceiling for `score`). A pillar whose "
      + "cap is configured to zero (switched off) is excluded from its own saturation "
      + "count rather than reported as saturated for every asset.",
    type: "effectiveness",
    formula: "aarsRule.ts's ruleDiscrimination(): per-asset pillar values compared against "
      + "rule.pillarACap / pillarBCap / the derived data/exposure ceilings.",
    target: "No fixed target. Zero is the aspiration for any pillar an operator wants to "
      + "keep discriminating; ai/AARS_ASSESSMENT.md §7 documents the spec rule's pillar C "
      + "term specifically to drive `saturated.data` down, which is the closest this app "
      + "comes to a stated direction rather than a number.",
    implementationEvidence: "Same as aars-distinct-scores.",
    timeBasedReference: "Computed fresh on each AARS Rules preview request. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "AARS Rules page operator, before saving a rule change.",
    dataSource: "ai_assets.aars_pillars_json",
    reportingFormat: "AARS Rules page, rule-preview Discrimination panel (previewAarsRule).",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },

  // -------------------------------------------------------------------- the problem tree
  {
    id: "problem-outcome-distribution",
    goal:
      "Show how the landscape's open issues and failing findings split across the four "
      + "triage queues (ACT/ATTEND/TRACK ★/TRACK), so a lopsided distribution — everything "
      + "landing in TRACK, or an implausibly large ACT count — is visible as a shape rather "
      + "than requiring someone to read every row.",
    scope: "Every unresolved issue (ai_issues) and every open, failing finding "
      + "(ai_findings) the problem tree has decided a verdict for, in the last sync.",
    measure: "Count of rows per Outcome value, zeros kept.",
    type: "impact",
    formula: "problem.ts's countProblemOutcomes(rows) — tallies row.problemOutcome over "
      + "OUTCOME_VALUES, zero-filled. One of the four inputs to that outcome, the "
      + "exploitation axis, can be set via issue.aiVerdict (exploitationOfIssue's "
      + "aiVerdict door) rather than Wiz's own validatedAsExploitable evidence — see "
      + "measurementMethod.",
    target: "No numeric target. problemRule.ts's actLeafCeiling constrains the MODEL (few "
      + "leaves may resolve to ACT), which bounds this distribution's shape without setting "
      + "a target count — the tree is built so most rows land in TRACK/TRACK ★ by design.",
    implementationEvidence: "problem_input_json is populated on every row this tally counts "
      + "(decidedForDiscrimination's own filter — a row with no input was never decided and "
      + "is excluded, never counted as a silent TRACK).",
    timeBasedReference: "Snapshotted at each sync's completion; sync_history.problem_outcome_json "
      + "additionally records this SAME distribution once per sync as an append-only series "
      + "(feeding the AARS trend chart's second series), which is the one figure in this file "
      + "that DOES have a real, queryable multi-point trend — but still only at the whole-landscape "
      + "grain, never per-entity. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Security analysts (triage); AARS Rules page operator (the Problem tree tab).",
    dataSource: "ai_issues.problem_outcome, ai_findings.problem_outcome, sync_history.problem_outcome_json",
    reportingFormat: "Priorities page KPI row; Priority column on Toxic Combinations / Cloud "
      + "Configuration; AARS trend chart's outcome series.",
    // HONEST AND UNCOMFORTABLE, PER THIS FILE'S HEADER: the exploitation axis — one of the
    // four inputs to every outcome — can reach SUSPECTED through issue.aiVerdict
    // (aiRemediationAnalysis.verdict), an LLM rater's opinion on one issue. It never alone
    // reaches ACTIVE (problem.ts's exploitationOfIssue keeps that door shut), but SUSPECTED
    // still changes which queue a row lands in versus UNKNOWN — so this distribution is NOT
    // purely a deterministic read of Wiz's own evidence, and reporting it as Objective would
    // hide that a human-in-the-loop-free LLM call can move rows on the queue analysts triage
    // from. Non-deterministic upstream (the same issue can re-run to a different verdict) and
    // its inter-rater reliability against a human analyst is unmeasured.
    measurementMethod: "Subjective",
    revisionDue: REVISION_DUE,
  },
  {
    id: "problem-axis-unknown-rate",
    goal:
      "THE MOST IMPORTANT RECORD IN THIS FILE. A high value here does NOT mean the landscape "
      + "is safe — it means the model CANNOT PRIORITISE, because the evidence one of its "
      + "four axes needs was never collected. An unknown exploitation rate of 97% is not "
      + "97% of the landscape confirmed non-exploitable; it is 97% of the landscape this tree has "
      + "no opinion on, defaulting to the least alarming reading by construction. Reading "
      + "a high unknown rate as reassurance is the single most dangerous misuse this "
      + "product's numbers are exposed to, and this record exists to make that misuse hard "
      + "to fall into by accident.",
    scope: "Every issue/finding row `decidedForDiscrimination` admits — one with a "
      + "persisted problem_input_json, i.e. one the tree actually reached a verdict for.",
    measure:
      "unknownRate.{exploitation,impact,exposure,mission}: the fraction of the decided "
      + "population whose reading on that axis could not be established (see problem.ts's "
      + "own per-axis doc comments for exactly what 'could not be established' means on "
      + "each one — e.g. exposure is UNKNOWN when no traversal ever reached the asset).",
    type: "implementation",
    formula: "problemRule.ts's treeDiscrimination(decided) — one division per axis, over "
      + "the same decided population previewProblemRule already assembled.",
    target: "No numeric target is set, deliberately — see this record's own `goal`. A "
      + "target would imply a 'good enough' unknown rate, and there is none: any nonzero "
      + "rate on the exploitation axis, for instance, means that share of the queue is "
      + "sitting on a default rather than evidence.",
    implementationEvidence:
      "Wiz's exploit-validation pipeline (issue.validatedAsExploitable), the combo-group "
      + "impact table, exposure traversal evidence (node.exposureEvidence) and business-"
      + "impact tagging are all upstream CONTROLS whose operating rate this measure reports "
      + "on indirectly — a falling unknown rate is evidence those controls are running "
      + "against more of the landscape, not evidence this app changed anything.",
    timeBasedReference: "Snapshotted at each sync's completion, over the decided population "
      + "as it reads right now. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Security analysts (reading the queue); Wiz tenant administrators "
      + "(the upstream evidence-collection controls this rate reports on).",
    dataSource: "ai_issues.problem_input_json, ai_findings.problem_input_json",
    reportingFormat: "AARS Rules page, Problem tree tab's preview (previewProblemRule's "
      + "treeDiscrimination.unknownRate).",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },

  // ----------------------------------------------------------------------------- posture
  {
    id: "posture-tier-distribution",
    goal:
      "Show how many assets sit in each CAPABILITY-ENVELOPE tier (1 best, 4 worst) — a "
      + "reading independent of what has been FOUND on an asset, so an agent with zero open "
      + "issues but broad, uncontained capability still shows up as a tier worth attention "
      + "rather than reading as clean.",
    scope: "Every AI asset carrying a persisted posture_tier as of the last sync.",
    measure: "Count of assets per Tier value (1–4), zeros kept.",
    type: "impact",
    formula: "posture.ts's countPostureTiers(nodes) — tallies node.postureTier over TIER_VALUES.",
    target: "No numeric target — a distribution weighted toward tier 4 is the finding a "
      + "reader is meant to notice, not a threshold this app enforces.",
    implementationEvidence: "posture_input_json is populated on every asset this tally "
      + "counts, but posture_input_json alone does not guarantee inclusion: a node the "
      + "posture fold never reached carries neither field and is excluded, and a node the "
      + "fold DID reach but could not place a tier for (posture.tierEstablished said no — "
      + "at least one of capability/containment/consequence was never observed) carries "
      + "posture_input_json with no posture_tier and is excluded from THIS tally the same "
      + "way, though never silently: previewPostureRule's postureDiscrimination.unknownRate."
      + "tier reports exactly that population, separately from tier occupancy.",
    timeBasedReference: "Snapshotted at each sync's completion (or the last Recompute "
      + "postures run). " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Security analysts; AARS Rules page operator (the Posture tab).",
    dataSource: "ai_assets.posture_tier, ai_assets.posture_input_json",
    reportingFormat: "AI Inventory Posture column; Priorities page's postureTier tiebreak; "
      + "AARS Rules Posture tab preview.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },

  // -------------------------------------------------------------------------------- SLA
  {
    id: "issue-sla-tally",
    goal:
      "Show how much of the open-issue register is racing a clock, so a reader can "
      + "distinguish 'nothing is due soon' from 'nothing has a deadline at all' — two very "
      + "different states this figure keeps apart rather than collapsing into one.",
    scope: "Every unresolved issue in ai_issues. Configuration findings carry no comparable "
      + "field (FindingRow has no due_at column — Wiz reports no config-finding SLA) and are "
      + "excluded from this tally entirely, not counted as 'no deadline'.",
    measure: "Three counts: past-due (dueAt before now), due-soon (within DUE_SOON_DAYS, "
      + "currently 7), and no-due-date, over the open-issue population.",
    type: "efficiency",
    formula: "comboDigest.ts's per-issue slaState(dueAt, now) via comboDigest(), bucketed "
      + "into totals.pastDue / totals.dueSoon / totals.noDueDate.",
    target: "No numeric target set by this app — a remediation SLA is an operator policy "
      + "this deployment does not encode; pastDue > 0 is the figure a reader is meant to "
      + "notice, not a threshold this app asserts as acceptable or not.",
    implementationEvidence: "issuesV2's dueAt is populated by Wiz's own SLA policy on the "
      + "source rule; a rising no-due-date count reflects that upstream policy's coverage, "
      + "not a gap this app introduces.",
    timeBasedReference: "Computed against the CURRENT wall-clock time on every read (not "
      + "frozen at sync time — an issue due yesterday reads pastDue today even without a "
      + "new sync), over the open-issue population as of the last sync. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Security analysts; the operator who sets remediation SLAs upstream in Wiz.",
    dataSource: "ai_issues.due_at, ai_issues.status",
    reportingFormat: "Toxic Combinations KPI row (Past due); Priorities page's SLA-urgency tiebreak.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },

  // ------------------------------------------------------------------------ compliance
  {
    id: "compliance-gaps",
    goal:
      "Count how many cloud-configuration controls are failing RIGHT NOW — the one "
      + "definition of 'compliance gap' every reader of this app (pillar B's pricing, the "
      + "Cloud Configuration register, this KPI) must agree on, so no two pages can ever "
      + "report a different count for the same landscape.",
    scope: "Every row in ai_findings passing isOpenGap: result FAIL, status OPEN, not deleted.",
    measure: "complianceGaps: count of open, failing configuration findings.",
    type: "effectiveness",
    formula: "config.ts's isOpenGap(finding) applied as a filter, then .length — src/server/"
      + "api.ts's assetsModel() (openGaps.length).",
    target: "No numeric target — this counts a live population an operator is expected to "
      + "work down over time, not compare against a fixed ceiling.",
    implementationEvidence: "ai_findings.result and ai_findings.status are populated for "
      + "every row synced after the widened status filter shipped; a ledger written before "
      + "it has neither column and is read permissively (isOpenGap's own doc comment) so an "
      + "old ledger is not silently zeroed out.",
    timeBasedReference: "Snapshotted at each sync's completion. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Security analysts; cloud platform owners (fixing the underlying misconfiguration).",
    dataSource: "ai_findings.result, ai_findings.status, ai_findings.deleted",
    reportingFormat: "AI Inventory KPI row; Cloud Configuration register header; AARS pillar "
      + "B pricing input.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
  {
    id: "compliance-gaps-unlinked",
    goal:
      "Show how much of complianceGaps THIS APP can actually attribute to a modeled AI "
      + "asset — a fact about this app's own coverage of the AI graph, not about Wiz's "
      + "controls. Most AI-security rules fail on a region, a raw IAM policy, or an "
      + "identity no agent runs as; those gaps are real and counted, but they price no "
      + "asset's AARS score, and a reader comparing complianceGaps against AARS pillar B "
      + "needs this split to understand why the two numbers are not the same.",
    scope: "The compliance-gaps population, narrowed to findings whose resourceId is NOT a "
      + "key in the current ai_assets set.",
    measure: "complianceGapsUnlinked: count of open, failing findings with no matching AI asset.",
    type: "implementation",
    formula: "src/server/api.ts's assetsModel(): openGaps.filter(f => !assetIds[f.resourceId]).length.",
    target: "No numeric target — this is a coverage-visibility figure about the AI graph's "
      + "own reach, not a control an operator can directly close.",
    implementationEvidence: "ai_assets.id set built from the same sync this tally reads, so "
      + "the linkage join always reflects the landscape as of the same snapshot.",
    timeBasedReference: "Snapshotted at each sync's completion. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "This app's own operators — a rising figure here is a prompt to "
      + "widen what the AI graph models, not a prompt to fix a cloud control.",
    dataSource: "ai_findings.resource_id, ai_assets.id",
    reportingFormat: "AI Inventory KPI row, printed beside complianceGaps as 'N of M unlinked'.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },

  // -------------------------------------------------- found while reading the API surface
  {
    id: "guardrail-coverage-pct",
    goal:
      "Show what share of managed AI agents have a confirmed PROTECTED_BY guardrail — the "
      + "one control this app can observe as a negated-edge scan rather than infer.",
    scope: "Every asset of kind AI_AGENT in the last sync.",
    measure: "guardrailCoveragePct: protectedAgents / agents × 100, rounded; null when "
      + "agents is 0 rather than a divide-by-zero or a false 100%.",
    type: "implementation",
    formula: "src/server/api.ts's assetsModel(): protectedAgents = agents.filter(a => "
      + "!a.guardrailMissing).length; guardrailCoveragePct = Math.round(protectedAgents / agents.length * 100).",
    target: "No numeric target set by this app — an operator's own guardrail-coverage "
      + "policy, if any, is external to this deployment.",
    implementationEvidence:
      "guardrail_missing === false is an ABSENCE OF A FINDING, not a confirmed control — "
      + "GNode.guardrailMissing's own doc comment and posture.ts's containmentOf both flag "
      + "this: no positive PROTECTED_BY edge is ever synced, so this percentage measures "
      + "'no missing-guardrail finding was raised', which is a weaker claim than 'a guardrail "
      + "is confirmed present'.",
    timeBasedReference: "Snapshotted at each sync's completion. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Security analysts; AI platform owners (attaching guardrails).",
    dataSource: "ai_assets.guardrail_missing, ai_assets.kind",
    reportingFormat: "Wiz Scans coverage area ('N of M agents protected'); Help's "
      + "missing-guardrail entry.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
  {
    id: "toxic-combo-patterns-active",
    goal:
      "Show how many of the four MODELLED toxic-combination patterns currently have at "
      + "least one open issue firing, out of the four this register knows how to name and "
      + "amplify — the headline figure the Toxic Combinations page opens with.",
    scope: "REGISTER_GROUPS (toxicCombos.ts) — the four modelled patterns plus the Other "
      + "bucket, counted against every unresolved issue in the last sync.",
    measure: "patternsActive / patternsTotal — patterns with count > 0, out of the total "
      + "the register models.",
    type: "impact",
    formula: "comboDigest.ts's comboDigest(): count of REGISTER_GROUPS with at least one "
      + "matching unresolved issue.",
    target: "No numeric target — 0 of 4 is the aspiration in the sense that fewer active "
      + "patterns is better, but this app sets no house threshold.",
    implementationEvidence: "Every unresolved issue carries a comboGroup (classifyIssue at "
      + "ingest, falling back to OTHER_GROUP_ID — toxicCombos.ts's own 'nothing vanishes' "
      + "guarantee), so patternsActive never undercounts by silently dropping an unclassified issue.",
    timeBasedReference: "Snapshotted at each sync's completion. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Security analysts.",
    dataSource: "ai_issues.combo_group, ai_issues.status",
    reportingFormat: "Toxic Combinations page KPI row ('Patterns active').",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
  {
    id: "framework-average-posture",
    goal:
      "Give leadership one number for 'how compliant is the landscape' across every synced "
      + "framework, while keeping unscored frameworks OUT of the average rather than "
      + "letting them silently read as a zero (compliancePosture.ts's own governing rule).",
    scope: "Every framework-level row in ai_framework_posture whose posture state resolves "
      + "to 'scored' (a stored percentage, no empty-posture reason attached).",
    measure: "averagePosture: the mean posture_pct across scored frameworks, rounded; null "
      + "when no framework has scored.",
    type: "effectiveness",
    formula: "compliancePosture.ts's complianceKpis(): Math.round(mean(scored posture_pct)).",
    target: "No numeric target set by this app — a compliance target is a policy decision "
      + "for the operator's own framework mappings, not a number this deployment asserts.",
    implementationEvidence: "posture_pct on each framework-level row is Wiz's own number, "
      + "stored exactly as received and never recomputed (compliancePosture.ts's own "
      + "discipline) — this average is a rollup of Wiz's figures, not a re-derivation of them.",
    timeBasedReference: "Snapshotted at each sync's completion. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Compliance/GRC stakeholders; the operator who selects which frameworks sync.",
    dataSource: "ai_framework_posture.posture_pct, ai_framework_posture.level, "
      + "ai_framework_posture.empty_posture_reason",
    reportingFormat: "Compliance Posture page's headline strip.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },

  // -------------------------------------------------------------------------- P1a actions
  {
    id: "action-concentration-ratio",
    goal:
      "Show whether the landscape has LEVERAGE to exploit — whether a small number of fixes "
      + "closes most of the open-problem board — or whether it does not. A ratio near "
      + "1:1 (N actions for N problems) is not a healthy reading: it means every open "
      + "problem is its own distinct fix, the landscape carries no repeated pattern this "
      + "feature can collapse, and ranking actions instead of problems buys this reader "
      + "nothing over `problems.ts`'s own Priorities ranking. The feature is only useful "
      + "on data where a handful of actions dominate, the way `configFindings.ts`'s own "
      + "header documents for a single Bedrock rule failing on sixteen IAM roles at once.",
    scope: "Every open problem `problems.ts`'s union admits (isUnresolvedIssue ∪ isOpenGap), "
      + "rolled up by `actions.ts`'s `ActionKey` (kind + ruleId + ruleShortId) and ranked by "
      + "`rankActionsByCover`'s marginal set-cover.",
    measure: "concentrationRatio: {actions, problems, top10Share} — the distinct action "
      + "count the union collapses to, the union total it sums back to, and the share of "
      + "that total the top 10 ranked actions alone close.",
    // Impact, not effectiveness: this is a fact about the LANDSCAPE's own shape (how much its
    // open problems repeat one fix), unlike the aars-distinct-scores family above, which is
    // effectiveness because it measures the MODEL's discriminative power over that landscape.
    type: "impact",
    formula: "actions.ts's concentrationRatio(rankActionsByCover(problemRows), total) — "
      + "problems is Σ ActionRow.problems over the ranked list (always equal to `total` "
      + "when the ranked list is not itself truncated); top10Share is Σ the first 10 "
      + "ActionRow.problems divided by `total`.",
    target: "No numeric target — same reasoning as the AARS discrimination records above: "
      + "this measures a property of the CURRENT landscape's shape, not a house threshold. A "
      + "reader comparing actions/problems across two syncs, or top10Share moving toward or "
      + "away from 1.0, is the intended use; a single snapshot has nothing to be compared "
      + "against.",
    implementationEvidence: "rankActionsByCover's own set-cover-completeness invariant "
      + "(test/actions.test.ts) — Σ ActionRow.problems over every ranked action equals the "
      + "union total exactly, with removal, the same guarantee toxicCombos.ts's "
      + "comboSummary documents at its own grain — is what makes `problems` in this record "
      + "trustworthy as a reconciled total rather than an approximation.",
    timeBasedReference: "Snapshotted at each sync's completion, over the union as it reads "
      + "right now. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Security analysts (triage); the operator deciding whether this "
      + "feature is worth surfacing on a given tenant's data at all.",
    dataSource: "ai_issues.rule_id, ai_issues.status, "
      + "ai_findings.rule_id, ai_findings.rule_short_id, ai_findings.result, ai_findings.status",
    reportingFormat: "Actions page headline ('N problems collapse to M actions; the top 10 "
      + "close K%').",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },

  // ------------------------------------------------------------------------ P2b: reach
  {
    id: "landscape-reach-stages",
    goal:
      "Answer, in paired counts a reader cannot mistake for a percentage-only score, what "
      + "fraction of the AI landscape a sync actually TOUCHED — the honest answer on a landscape "
      + "where a live tenant shows 97.58% of assets at AARS INFO and 97.2% reaching the "
      + "posture fallback tier, figures that read as 'clean' and read equally well as "
      + "'never assessed'. A reader seeing '0 of 22 attributed' must see the 22, never a "
      + "bare 0%, or the missing denominator disappears into a number that merely looks bad "
      + "instead of naming exactly how much is unknown.",
    scope: "In register: every row on ai_assets, substrate included. Observed / enriched / "
      + "attributed / decided: the AI-kinded subset that stage establishes (AI_ASSET_KINDS "
      + "membership on ai_assets.kind) — a claim about the AI landscape, not about the buckets "
      + "and service accounts the exposure/identity/data-reach traversals pull in alongside it.",
    measure: "Five { covered, total } pairs: in register (AI-kinded of every row), observed "
      + "(carrying an unresolved issue, an open failing finding, or a held risk condition), "
      + "enriched (touched by a persisted edge, or carrying exposure/human-access evidence), "
      + "attributed (a folded business-impact tier), decided (a persisted AARS score or a "
      + "folded problem verdict).",
    type: "impact",
    formula: "reach.ts's estateReach(...).stages — one filter per stage over syncStore."
      + "loadAssets()/loadIssues()/loadFindings()/loadEdges(), never a re-derivation of "
      + "isUnresolvedIssue/isOpenGap/conditionHolds, which this reuses verbatim.",
    target: "No numeric target — a funnel narrowing toward 0 IS the finding this measure "
      + "exists to surface, not a threshold this deployment enforces. The seed landscape's own "
      + "'0 of 22 attributed' is the demonstration: no house-wide floor would make that "
      + "number less true.",
    implementationEvidence: "Each stage's covered count is recomputable from the SAME "
      + "persisted columns registerScopeDiagnostic already reads by hand — this is that "
      + "diagnostic's finding, permanent in the product rather than run once from the "
      + "Apps Script editor.",
    timeBasedReference: "Snapshotted at each sync's completion, over the register as it "
      + "reads right now. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Security analysts (reading landscape posture); the operator deciding "
      + "whether a low stage matters for THIS tenant's traversal footprint.",
    dataSource: "ai_assets.kind, ai_assets.business_impact, ai_assets.worst_open_problem, "
      + "ai_assets.aars, ai_edges.type, ai_issues.status, ai_findings.result",
    reportingFormat: "Wiz Scans page, Landscape reach section's stage ladder; AI Inventory's "
      + "one-glance headline card.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
  {
    id: "landscape-reach-edge-census",
    goal:
      "Name which of the 23 declared graph relationship types this deployment's queries "
      + "have ever actually populated, and which have not — a dead relationship type "
      + "silently removes a class of question the product LOOKS able to answer (tool scope, "
      + "model provenance, agent-to-agent trust) while every page that draws the graph stays "
      + "visually confident about the edges it does have.",
    scope: "Every row on ai_edges as last synced, censused against EDGE_TYPES "
      + "(graphTypes.ts) — the full declared vocabulary, not merely the types this ledger "
      + "happens to hold.",
    measure: "populated / declared, plus the named list of types with zero rows.",
    type: "implementation",
    formula: "reach.ts's estateReach(...).edges — the identical census "
      + "registerScopeDiagnostic already runs by hand (server/diagnostics.ts), reused rather "
      + "than reimplemented so the two can never quietly disagree.",
    target: "No numeric target — which types are dead is a fact about this tenant's Wiz "
      + "query coverage, not a threshold. A census that always reports '23 of 23' the day "
      + "this app stops asking new questions would be the failure, not the target.",
    implementationEvidence: "populated/dead is read directly off ai_edges.type against the "
      + "EDGE_TYPES constant both graphExpand.ts and the sync normalizer already import — a "
      + "type this app cannot even emit would fail typechecking before it reached this count.",
    timeBasedReference: "Snapshotted at each sync's completion, over the edges tab as it "
      + "reads right now. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "The operator deciding whether to widen the sync's graph queries; "
      + "security analysts relying on a graph-drawn relationship that may not be populated.",
    dataSource: "ai_edges.type",
    reportingFormat: "Wiz Scans page, Landscape reach section's edge census.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
  {
    id: "landscape-reach-axis-known-rate",
    goal:
      "THE SAME WARNING AS problem-axis-unknown-rate, restated for the KNOWN framing this "
      + "panel reports instead: a high known% here does NOT mean the landscape is safe, and a "
      + "low one does NOT mean it is unsafe — it means the decision tree CANNOT PRIORITISE "
      + "on that axis, because the evidence it needs was never collected. Reading a high "
      + "known% as reassurance, or a low one as a body of confirmed-safe findings, is the "
      + "misuse this record exists to make hard to fall into by accident.",
    scope: "The same decided population problem-axis-unknown-rate scopes to: every "
      + "issue/finding row carrying a persisted problem_input_json — one the tree actually "
      + "reached a verdict for.",
    measure: "known.{exploitation,impact,exposure,mission}: 1 minus "
      + "treeDiscrimination.unknownRate over that population, EXCEPT an empty population — "
      + "no row ever decided — which reads 0, never 1 (a naive inversion of an empty "
      + "unknownRate would otherwise report '100% known' on an axis nothing was ever read "
      + "on, the exact false-green failure this whole panel exists to refuse).",
    type: "implementation",
    formula: "reach.ts's estateReach(...).axes, computed by calling problemRule.ts's "
      + "treeDiscrimination(decided) UNCHANGED and inverting its unknownRate at this one "
      + "boundary — never a second per-axis unknown computation. axesPopulation carries the "
      + "decided count, so a caller can render '--' rather than a measured 0% on an empty "
      + "population.",
    target: "No numeric target is set, deliberately — see this record's own `goal`. A "
      + "target would imply a 'good enough' known rate, and there is none.",
    implementationEvidence: "Wiz's exploit-validation pipeline (issue.validatedAsExploitable), "
      + "the combo-group impact table, exposure traversal evidence (node.exposureEvidence) "
      + "and business-impact tagging are the upstream CONTROLS whose operating rate this "
      + "reports on indirectly, exactly as problem-axis-unknown-rate's own record states.",
    timeBasedReference: "Snapshotted at each sync's completion, over the decided population "
      + "as it reads right now. " + NO_PER_ENTITY_HISTORY,
    responsibleParties: "Security analysts (reading the queue); Wiz tenant administrators "
      + "(the upstream evidence-collection controls this rate reports on).",
    dataSource: "ai_issues.problem_input_json, ai_findings.problem_input_json",
    reportingFormat: "Wiz Scans page, Landscape reach section's axis-coverage panel.",
    measurementMethod: "Objective",
    revisionDue: REVISION_DUE,
  },
] as const;
