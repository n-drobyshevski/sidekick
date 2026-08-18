// The Help page's rendering of src/domain/measureSpec.ts — Phase 8 of the
// Prioritization-to-Prediction rebuild: what a published number on this app's pages
// actually means, where it comes from, and who it is for.
//
// A MIRROR, same reason codebook.js is one: the client bundle cannot import a TS module
// (comboView.js's own header states the wall this repeats), and every field below is
// ANNOTATION — prose about a number, never an input the app computes anything from — so
// duplicating it here carries none of the drift risk a computed value would (codebook.js's
// own rule 1). What CAN drift is the two files disagreeing about which measures exist or
// what family/type each one claims; test/helpContent.test.js's "the measure specifications"
// block cross-checks every id here against MEASURE_SPECS in the TS module directly, so an
// id added, renamed or removed on one side and not the other fails the build.
//
// Deliberately NOT a full copy of every NIST/ISO field: an operator reading this page wants
// "what does this number mean and where do I read it", not the whole audit record. `goal`,
// `formula`, `dataSource`, `reportingFormat`, `measurementMethod` and `revisionDue` are the
// six fields that answer that; `scope`, `target`, `implementationEvidence` and
// `timeBasedReference` stay in the TS module as the fuller record for an actual audit.

export const MEASURE_ENTRIES = [
  {
    id: "aars-score", measure: "AARS score", type: "impact", measurementMethod: "Objective",
    goal: "One comparable risk number per AI asset, priced from what a sync actually "
      + "collected — never asserted.",
    formula: "computeAars(aarsInput, aarsRule): four pillars, summed and clamped to 0–100.",
    dataSource: "ai_assets.aars, ai_assets.aars_input_json",
    reportingFormat: "AI Inventory table; asset detail sheet's pillar bars.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-band", measure: "AARS band", type: "impact", measurementMethod: "Objective",
    goal: "The score's own severity level, re-derived from the rule in force on every read. "
      + "A MODEL diagnostic and an opt-in filter, not a claim about one asset (P2c) — the "
      + "Inventory table and the asset sheet lead with aars-percentile instead.",
    formula: "bandRanges(rule.bands) applied to the stored aars — no re-sync required.",
    dataSource: "ai_assets.aars, ai_assets.aars_severity",
    reportingFormat: "AI Inventory filter drawer and asset-sheet secondary chip; AARS trend "
      + "chart; AARS Rules page band occupancy; bootstrap KPI counts.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-percentile", measure: "aarsPercentile", type: "impact", measurementMethod: "Objective",
    goal: "A statement about RANK WITHIN THIS ESTATE, not absolute risk — the same rule put "
      + "100% of the demo estate in CRITICAL and 97.58% of a live estate in INFO under "
      + "identical bands. Moves whenever the ESTATE moves, even when this asset's own score "
      + "does not.",
    formula: "midrankPercentiles(scores): for a tied score, every member shares the tie "
      + "block's average rank (rankStats.ts), computed fresh over the scored population on "
      + "every read.",
    dataSource: "ai_assets.aars",
    reportingFormat: "AI Inventory table's primary AARS column; the asset detail sheet's "
      + "lead verdict figure.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-distinct-scores", measure: "distinctScores", type: "effectiveness",
    measurementMethod: "Objective",
    goal: "Measures the MODEL's separating power, not the estate's risk — a rule can render "
      + "a confident number for every asset while carrying zero ranking information.",
    formula: "new Set(scores).size, over every scored asset in the preview.",
    dataSource: "ai_assets.aars",
    reportingFormat: "AARS Rules page, rule-preview Discrimination panel.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-tie-rate", measure: "tieRate", type: "effectiveness", measurementMethod: "Objective",
    goal: "Same as distinctScores, at the scale of PAIRS: 1.0 means every pair of scored "
      + "assets shares a value, so any ordering within the estate is arbitrary.",
    formula: "Σ C(n_k,2) / C(N,2) over the distinct-value groups (rankStats.tieRate).",
    dataSource: "ai_assets.aars",
    reportingFormat: "AARS Rules page, rule-preview Discrimination panel.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-effective-cardinality", measure: "effectiveCardinality", type: "effectiveness",
    measurementMethod: "Objective",
    goal: "Same as distinctScores, weighted by population — one outlier score does not "
      + "claim the same discrimination credit an even split would.",
    formula: "exp(Shannon entropy) over the score distribution (rankStats.effectiveCardinality).",
    dataSource: "ai_assets.aars",
    reportingFormat: "AARS Rules page, rule-preview Discrimination panel.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-pillar-saturation", measure: "Pillar saturation", type: "effectiveness",
    measurementMethod: "Objective",
    goal: "Locates WHICH pillar of the model has stopped discriminating — a pillar pinned "
      + "at its cap for most of the estate still renders a plausible total score.",
    formula: "Assets at or above each pillar's cap (aarsRule.ts's ruleDiscrimination).",
    dataSource: "ai_assets.aars_pillars_json",
    reportingFormat: "AARS Rules page, rule-preview Discrimination panel.",
    revisionDue: "2027-08-13",
  },
  {
    id: "problem-outcome-distribution", measure: "Problem outcome distribution",
    type: "impact", measurementMethod: "Subjective",
    goal: "How open issues and failing findings split across Act/Attend/Track ★/Track.",
    formula: "countProblemOutcomes(rows) over OUTCOME_VALUES, zero-filled. One input axis "
      + "(exploitation) can be set via an LLM rater's verdict — see measurementMethod.",
    dataSource: "ai_issues.problem_outcome, ai_findings.problem_outcome",
    reportingFormat: "Priorities page KPI row; Priority column throughout.",
    revisionDue: "2027-08-13",
  },
  {
    id: "problem-axis-unknown-rate", measure: "Per-axis unknown rate", type: "implementation",
    measurementMethod: "Objective",
    goal: "THE MOST IMPORTANT MEASURE ON THIS PAGE. A high value does NOT mean the estate "
      + "is safe — it means the model cannot prioritise, because the evidence one axis "
      + "needs was never collected. Reading it as reassurance is the misuse this exists to prevent.",
    formula: "Fraction of the decided population unresolved on each axis (treeDiscrimination.unknownRate).",
    dataSource: "ai_issues.problem_input_json, ai_findings.problem_input_json",
    reportingFormat: "AARS Rules page, Problem tree tab's preview.",
    revisionDue: "2027-08-13",
  },
  {
    id: "posture-tier-distribution", measure: "Posture tier distribution", type: "impact",
    measurementMethod: "Objective",
    goal: "How many assets sit in each capability-envelope tier (1 best, 4 worst) — "
      + "independent of what has been found on the asset.",
    formula: "countPostureTiers(nodes) over TIER_VALUES, zero-filled.",
    dataSource: "ai_assets.posture_tier",
    reportingFormat: "AI Inventory Posture column; Priorities page's ranking.",
    revisionDue: "2027-08-13",
  },
  {
    id: "issue-sla-tally", measure: "SLA tally", type: "efficiency", measurementMethod: "Objective",
    goal: "How much of the open-issue register is racing a clock — past-due, due-soon or "
      + "no deadline at all, kept apart.",
    formula: "slaState(dueAt, now) bucketed per issue (comboDigest.ts).",
    dataSource: "ai_issues.due_at",
    reportingFormat: "Toxic Combinations KPI row; Priorities page's SLA tiebreak.",
    revisionDue: "2027-08-13",
  },
  {
    id: "compliance-gaps", measure: "complianceGaps", type: "effectiveness",
    measurementMethod: "Objective",
    goal: "How many cloud-configuration controls are failing right now — one definition, "
      + "shared by every page that counts it.",
    formula: "isOpenGap(finding) filter, then a count.",
    dataSource: "ai_findings.result, ai_findings.status",
    reportingFormat: "AI Inventory KPI row; Cloud Configuration register header.",
    revisionDue: "2027-08-13",
  },
  {
    id: "compliance-gaps-unlinked", measure: "complianceGapsUnlinked", type: "implementation",
    measurementMethod: "Objective",
    goal: "How much of complianceGaps this app can attribute to a modeled AI asset — a "
      + "fact about THIS APP's own graph coverage, not about Wiz's controls.",
    formula: "Open gaps whose resourceId is not a key in the current asset set.",
    dataSource: "ai_findings.resource_id, ai_assets.id",
    reportingFormat: "AI Inventory KPI row, beside complianceGaps.",
    revisionDue: "2027-08-13",
  },
  {
    id: "guardrail-coverage-pct", measure: "guardrailCoveragePct", type: "implementation",
    measurementMethod: "Objective",
    goal: "Share of managed AI agents with no missing-guardrail finding raised — an "
      + "absence of evidence, not a confirmed control (see the record's own caveat).",
    formula: "protectedAgents / agents × 100, rounded; null when there are no agents.",
    dataSource: "ai_assets.guardrail_missing, ai_assets.kind",
    reportingFormat: "Wiz Scans coverage area.",
    revisionDue: "2027-08-13",
  },
  {
    id: "toxic-combo-patterns-active", measure: "patternsActive / patternsTotal",
    type: "impact", measurementMethod: "Objective",
    goal: "How many of the four modelled toxic-combination patterns currently have an "
      + "open issue firing.",
    formula: "Count of REGISTER_GROUPS with at least one matching unresolved issue.",
    dataSource: "ai_issues.combo_group, ai_issues.status",
    reportingFormat: "Toxic Combinations page KPI row.",
    revisionDue: "2027-08-13",
  },
  {
    id: "framework-average-posture", measure: "averagePosture", type: "effectiveness",
    measurementMethod: "Objective",
    goal: "One number for estate-wide compliance across every synced framework — unscored "
      + "frameworks are excluded rather than read as zero.",
    formula: "Mean posture_pct across framework rows whose state resolves to 'scored'.",
    dataSource: "ai_framework_posture.posture_pct",
    reportingFormat: "Compliance Posture page's headline strip.",
    revisionDue: "2027-08-13",
  },
  {
    id: "action-concentration-ratio", measure: "Action concentration",
    type: "impact", measurementMethod: "Objective",
    goal: "Whether the estate has LEVERAGE to exploit \u2014 whether a handful of fixes closes "
      + "most of the open board. A ratio near 1:1 is not a healthy reading: it means every "
      + "problem is its own distinct fix and ranking actions buys nothing over ranking "
      + "problems.",
    formula: "concentrationRatio over rankActionsByCover's marginal set-cover: distinct "
      + "actions, the union total they sum back to, and the share the top 10 alone close.",
    dataSource: "ai_issues.rule_id, ai_findings.rule_short_id, ai_findings.rule_id",
    reportingFormat: "Priorities page's action list header and its cumulative-cover curve.",
    revisionDue: "2027-08-13",
  },
  {
    id: "estate-reach-stages", measure: "Estate reach stage ladder", type: "impact",
    measurementMethod: "Objective",
    goal: "What fraction of the AI estate a sync actually touched, in paired counts — never "
      + "a bare percentage, so a stage with nothing behind it (‘0 of 22 attributed’) "
      + "cannot be misread as a clean result.",
    formula: "estateReach(...).stages: in register, observed, enriched, attributed, decided "
      + "— each { covered, total } over the AI-kinded register.",
    dataSource: "ai_assets.kind, ai_assets.business_impact, ai_assets.worst_open_problem, "
      + "ai_assets.aars, ai_edges.type, ai_issues.status, ai_findings.result",
    reportingFormat: "Wiz Scans page, Estate reach section; AI Inventory headline card.",
    revisionDue: "2027-08-13",
  },
  {
    id: "estate-reach-edge-census", measure: "Edge census", type: "implementation",
    measurementMethod: "Objective",
    goal: "Which of the 23 declared graph relationship types this deployment has ever "
      + "populated — a dead type quietly removes a class of question the graph looks "
      + "able to answer.",
    formula: "estateReach(...).edges: ai_edges.type censused against EDGE_TYPES, the same "
      + "logic registerScopeDiagnostic already runs by hand.",
    dataSource: "ai_edges.type",
    reportingFormat: "Wiz Scans page, Estate reach section's edge census.",
    revisionDue: "2027-08-13",
  },
  {
    id: "estate-reach-axis-known-rate", measure: "Per-axis known %", type: "implementation",
    measurementMethod: "Objective",
    goal: "THE SAME WARNING AS Per-axis unknown rate, restated positively: a high known% "
      + "does NOT mean the estate is safe — it means the decision tree cannot "
      + "prioritise on that axis until it does not. An empty population reads 0%, never a "
      + "false 100%.",
    formula: "1 − treeDiscrimination(decided).unknownRate per axis, inverted at reach.ts's "
      + "own boundary; 0 when nothing has ever been decided.",
    dataSource: "ai_issues.problem_input_json, ai_findings.problem_input_json",
    reportingFormat: "Wiz Scans page, Estate reach section's axis-coverage panel.",
    revisionDue: "2027-08-13",
  },
];
