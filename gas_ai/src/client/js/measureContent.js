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
    id: "aars-score", measure: "Findings score", type: "impact",
    measurementMethod: "Objective",
    goal: "One comparable number per AI asset for what has already been FOUND on it, priced "
      + "from what a sync actually collected — never asserted.",
    formula: "computeAars(aarsInput, aarsRule): four pillars, summed and clamped to 0–100.",
    dataSource: "ai_assets.aars, ai_assets.aars_input_json",
    reportingFormat: "Scoring Models page only \u2014 the model editor, its rule preview and its "
      + "sandbox. It left the AI Inventory register and the asset detail sheet with the "
      + "rest of the derived verdicts; both read counts now.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-band", measure: "Findings score level", type: "impact",
    measurementMethod: "Objective",
    goal: "The score's own level, re-derived from the rule in force on every read. Context "
      + "beside a score and a distribution over the landscape — not a per-asset decision, "
      + "because on this landscape its top level holds most of the scored assets.",
    formula: "bandRanges(rule.bands) applied to the stored aars — no re-sync required.",
    dataSource: "ai_assets.aars, ai_assets.aars_severity",
    reportingFormat: "Scoring Models page only, as a rule diagnostic \u2014 band occupancy and the "
      + "preview's movers. The inventory\u0027s level strip and level trend are gone; that "
      + "page charts open issues, cloud findings and posture fails over time instead.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-distinct-scores", measure: "distinctScores", type: "effectiveness",
    measurementMethod: "Objective",
    goal: "Measures the MODEL's separating power, not the landscape's risk — a rule can render "
      + "a confident number for every asset while carrying zero ranking information.",
    formula: "new Set(scores).size, over every scored asset in the preview.",
    dataSource: "ai_assets.aars",
    reportingFormat: "Scoring Models page, rule-preview Discrimination panel.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-tie-rate", measure: "tieRate", type: "effectiveness", measurementMethod: "Objective",
    goal: "Same as distinctScores, at the scale of PAIRS: 1.0 means every pair of scored "
      + "assets shares a value, so any ordering within the landscape is arbitrary.",
    formula: "Σ C(n_k,2) / C(N,2) over the distinct-value groups (rankStats.tieRate).",
    dataSource: "ai_assets.aars",
    reportingFormat: "Scoring Models page, rule-preview Discrimination panel.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-effective-cardinality", measure: "effectiveCardinality", type: "effectiveness",
    measurementMethod: "Objective",
    goal: "Same as distinctScores, weighted by population — one outlier score does not "
      + "claim the same discrimination credit an even split would.",
    formula: "exp(Shannon entropy) over the score distribution (rankStats.effectiveCardinality).",
    dataSource: "ai_assets.aars",
    reportingFormat: "Scoring Models page, rule-preview Discrimination panel.",
    revisionDue: "2027-08-13",
  },
  {
    id: "aars-pillar-saturation", measure: "Pillar saturation", type: "effectiveness",
    measurementMethod: "Objective",
    goal: "Locates WHICH pillar of the model has stopped discriminating — a pillar pinned "
      + "at its cap for most of the landscape still renders a plausible total score.",
    formula: "Assets at or above each pillar's cap (aarsRule.ts's ruleDiscrimination).",
    dataSource: "ai_assets.aars_pillars_json",
    reportingFormat: "Scoring Models page, rule-preview Discrimination panel.",
    revisionDue: "2027-08-13",
  },
  {
    id: "problem-outcome-distribution", measure: "Problem outcome distribution",
    type: "impact", measurementMethod: "Subjective",
    goal: "How open issues and failing findings split across Act/Attend/Track*/Track.",
    formula: "countProblemOutcomes(rows) over OUTCOME_VALUES, zero-filled. One input axis "
      + "(exploitation) can be set via an LLM rater's verdict — see measurementMethod.",
    dataSource: "ai_issues.problem_outcome, ai_findings.problem_outcome",
    reportingFormat: "Scoring Models page, Problem tree tab\u0027s preview. It was the "
      + "Priorities KPI row and a Priority column on three registers; those now read "
      + "Wiz\u0027s severity.",
    revisionDue: "2027-08-13",
  },
  {
    id: "problem-axis-unknown-rate", measure: "Per-axis unknown rate", type: "implementation",
    measurementMethod: "Objective",
    goal: "THE MOST IMPORTANT MEASURE ON THIS PAGE. A high value does NOT mean the landscape "
      + "is safe — it means the model cannot prioritise, because the evidence one axis "
      + "needs was never collected. Reading it as reassurance is the misuse this exists to prevent.",
    formula: "Fraction of the decided population unresolved on each axis (treeDiscrimination.unknownRate).",
    dataSource: "ai_issues.problem_input_json, ai_findings.problem_input_json",
    reportingFormat: "Scoring Models page, Problem tree tab\u0027s preview.",
    revisionDue: "2027-08-13",
  },
  {
    id: "posture-tier-distribution", measure: "Posture tier distribution", type: "impact",
    measurementMethod: "Objective",
    goal: "How many assets sit in each capability-envelope tier (1 best, 4 worst) — "
      + "independent of what has been found on the asset.",
    formula: "countPostureTiers(nodes) over TIER_VALUES, zero-filled.",
    dataSource: "ai_assets.posture_tier",
    reportingFormat: "Scoring Models page, Posture tab\u0027s preview. It was an inventory "
      + "column, an inventory headline and a level of the Priorities ranking; none of the "
      + "three reads it now.",
    revisionDue: "2027-08-13",
  },
  {
    id: "issue-sla-tally", measure: "SLA tally", type: "efficiency", measurementMethod: "Objective",
    goal: "How much of the open-issue register is racing a clock — past-due, due-soon or "
      + "no deadline at all, kept apart.",
    formula: "slaState(dueAt, now) bucketed per issue (comboDigest.ts).",
    dataSource: "ai_issues.due_at",
    reportingFormat: "Toxic Combinations KPI row; Priorities page\u0027s ranking, where the "
      + "SLA clock is now the second level rather than the third.",
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
    goal: "Share of SCANNED AI agents with no missing-guardrail finding raised — an absence "
      + "of evidence, not a confirmed control, and reported beside the count the scan never "
      + "reached rather than folded in with it.",
    formula: "protectedAgents (guardrailMissing === false) / (agents - guardrailUnknownAgents) "
      + "× 100, rounded; null when nothing was scanned.",
    dataSource: "ai_assets.guardrail_missing, ai_assets.kind",
    reportingFormat: "Wiz Scans coverage area, beside protectedAgents and guardrailUnknownAgents.",
    revisionDue: "2027-08-13",
  },
  {
    id: "posture-scope-split", measure: "posture tiers, withheld, out of scope", 
    type: "implementation", measurementMethod: "Objective",
    goal: "How much of the register the posture lattice actually rates — and for the rest, "
      + "which of the two reasons applies. Withheld is a coverage gap someone can close; out "
      + "of scope says this lattice does not describe this kind of asset, and nothing can.",
    formula: "censusPostureTiers(nodes): tier counts (zeros kept) plus withheld, outOfScope "
      + "and total, split on whether the node carries a posture vector at all.",
    dataSource: "sync_history.posture_tier_json, ai_assets.posture_tier, ai_assets.posture_input_json",
    reportingFormat: "Inventory posture header; the Posture column reason per row; the posture "
      + "trend series.",
    revisionDue: "2027-08-13",
  },
  {
    id: "derivation-version-currency", measure: "derivation version, ledger vs code",
    type: "implementation", measurementMethod: "Objective",
    goal: "Whether the stored facts were collected by the normalizer now running. The one "
      + "staleness Recompute cannot repair, because the old value was destroyed at ingest — "
      + "so the warning names a full sync as its remedy.",
    formula: "derivationIsStale(settings, DERIVATION_VERSION); an unstamped ledger reads "
      + "stale, the opposite default to the three rule-version markers.",
    dataSource: "sync_history.derivation_version, settings.key, settings.value_json",
    reportingFormat: "Staleness banner; break markers on every sync_history trend series.",
    revisionDue: "2027-08-13",
  },  {
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
    goal: "One number for landscape-wide compliance across every synced framework — unscored "
      + "frameworks are excluded rather than read as zero.",
    formula: "Mean posture_pct across framework rows whose state resolves to 'scored'.",
    dataSource: "ai_framework_posture.posture_pct",
    reportingFormat: "Compliance Posture page's headline strip.",
    revisionDue: "2027-08-13",
  },
  {
    id: "action-concentration-ratio", measure: "Action concentration",
    type: "impact", measurementMethod: "Objective",
    goal: "Whether the landscape has LEVERAGE to exploit \u2014 whether a handful of fixes closes "
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
    id: "landscape-reach-stages", measure: "Landscape reach stage ladder", type: "impact",
    measurementMethod: "Objective",
    goal: "What fraction of the AI landscape a sync actually touched, in paired counts — never "
      + "a bare percentage, so a stage with nothing behind it (‘0 of 22 attributed’) "
      + "cannot be misread as a clean result.",
    formula: "estateReach(...).stages: in register, observed, enriched, decided — each "
      + "{ covered, total } over the AI-kinded register. Four, not five: business-impact "
      + "tagging left the ladder (it arrives on the inventory hop, so it does not depend on "
      + "the stages above it), and ‘decided’ no longer accepts a bare AARS score, which "
      + "every AI-kinded asset carries and which made the stage a permanent 100%.",
    dataSource: "ai_assets.kind, ai_assets.worst_open_problem, ai_edges.type, "
      + "ai_assets.exposure_evidence_json, ai_assets.human_access_json, ai_issues.status, "
      + "ai_findings.result",
    reportingFormat: "Wiz Scans page, Landscape reach section; AI Inventory headline card.",
    revisionDue: "2027-08-13",
  },
  {
    id: "landscape-impact-tagged", measure: "Impact-tagged share", type: "implementation",
    measurementMethod: "Objective",
    goal: "How much of the AI register carries a Wiz business-impact tier — the tenant's "
      + "project-tagging discipline, not this pipeline's reach. It sat in the reach ladder "
      + "until a live tenant printed 95% of it above 1% observed.",
    formula: "estateReach(...).impactTagged: AI-kinded rows with a non-empty "
      + "business_impact, over all AI-kinded rows.",
    dataSource: "ai_assets.business_impact, ai_assets.kind",
    reportingFormat: "Wiz Scans page, Landscape reach section — beside the ladder, not in it.",
    revisionDue: "2027-08-13",
  },
  {
    id: "sync-step-yield", measure: "Rows returned per sync step", type: "implementation",
    measurementMethod: "Objective",
    goal: "Tell a step that ran and matched nothing apart from a step that was never reached. "
      + "The skipped list records refusals and the truncated list records page caps; a step "
      + "the tenant accepts that returns zero rows was in neither.",
    formula: "Raw response rows per step id, summed across pages and resume hops, persisted "
      + "with the commit. Present with 0 means ran-and-empty; absent means not recorded.",
    dataSource: "settings.key / settings.value_json — the settings tab is a key/value "
      + "store, and this reading lives under the last_step_rows key, beside "
      + "last_skipped_steps and last_truncated_steps.",
    reportingFormat: "Wiz Scans page, each area's drill-down — a pill beside the existing "
      + "skipped and truncated pills.",
    revisionDue: "2027-08-13",
  },
  {
    id: "landscape-reach-edge-census", measure: "Edge census", type: "implementation",
    measurementMethod: "Objective",
    goal: "Which of the 23 declared graph relationship types this deployment has ever "
      + "populated — a dead type quietly removes a class of question the graph looks "
      + "able to answer.",
    formula: "estateReach(...).edges: ai_edges.type censused against EDGE_TYPES, the same "
      + "logic registerScopeDiagnostic already runs by hand.",
    dataSource: "ai_edges.type",
    reportingFormat: "Wiz Scans page, Landscape reach section's edge census.",
    revisionDue: "2027-08-13",
  },
  {
    id: "landscape-reach-axis-known-rate", measure: "Per-axis known %", type: "implementation",
    measurementMethod: "Objective",
    goal: "THE SAME WARNING AS Per-axis unknown rate, restated positively: a high known% "
      + "does NOT mean the landscape is safe — it means the decision tree cannot "
      + "prioritise on that axis until it does not. An empty population reads 0%, never a "
      + "false 100%.",
    formula: "1 − treeDiscrimination(decided).unknownRate per axis, inverted at reach.ts's "
      + "own boundary; 0 when nothing has ever been decided.",
    dataSource: "ai_issues.problem_input_json, ai_findings.problem_input_json",
    reportingFormat: "Wiz Scans page, Landscape reach section's axis-coverage panel.",
    revisionDue: "2027-08-13",
  },
];
