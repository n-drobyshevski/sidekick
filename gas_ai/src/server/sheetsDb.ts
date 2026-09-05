// Generic header-mapped tab access over the SIDEKICK AI spreadsheet.
//
// Row 1 of every tab is a frozen header; all reads/writes map columns BY HEADER NAME,
// never by index, so adding a column is non-breaking — writes bring the header row up to
// the declared schema first (see ensureHeaders), so a tab that predates a column receives
// it instead of dropping the value. Empty cells read as null; every
// write is one batched setValues call. Engine copied from the OS-vulns tool; only the
// tab schema differs — here the durable state is a graph snapshot (assets/edges/issues
// wholesale-rewritten per sync), not an append-only vulnerability ledger.

import { PROP_KEYS, requireProp } from "./props";
import { toIso, type Rec } from "../domain/util";

export const TABS = {
  assets: "ai_assets",
  edges: "ai_edges",
  issues: "ai_issues",
  findings: "ai_findings",
  dataFindings: "ai_data_findings",
  frameworks: "ai_frameworks",
  frameworkPosture: "ai_framework_posture",
  frameworkPolicies: "ai_framework_policies",
  configRules: "ai_config_rules",
  identityFindings: "ai_identity_findings",
  issueExploitation: "ai_issue_exploitation",
  issueLedger: "ai_issue_ledger",
  syncHistory: "sync_history",
  settings: "settings",
  jobs: "jobs",
  meta: "meta",
} as const;

export const TAB_HEADERS: Record<string, string[]> = {
  [TABS.assets]: [
    "id", "kind", "name", "native_type", "cloud", "region", "status",
    "account_id", "account_name", "projects_json", "first_seen", "last_seen",
    "internet", "open_internet", "sensitive_data", "sensitive_access", "high_priv",
    "admin_priv", "guardrail_missing", "severity", "aars", "aars_severity",
    "aars_pillars_json", "aars_input_json",
    "combo_groups", "tags_json", "technology_categories",
    "identity_purpose", "issue_analytics_json",
    // DSPM classification on a datastore row. Appended, so an existing ledger picks them
    // up on the next sync with no migration (see the note on ai_issues below).
    "data_finding_count", "data_findings_json",
    // Network exposure. The first two are the dynamic scanner's verdicts and belong to
    // ENDPOINT rows; the third is the join `withExposureEvidence` folds onto an AI asset,
    // and is what lets the Inventory and the combos matrix — which read this tab directly
    // and never see the graph document — agree with the graph about what is exposed.
    // Appended for the same no-migration reason.
    "exposure_level", "port_validation", "exposure_evidence_json",
    // Human identity access. The first two belong to identity rows (Wiz's dormancy read from
    // cloud audit events); the third is the join `withHumanAccess` folds onto an AI asset, so
    // the register and the Scans figure can total reach without reading edges. Appended.
    "inactive", "inactive_timeframe", "human_access_json",
    // Identity display fields (the human title and address an operator gave the account) and
    // the two AI-asset provenance fields the Security Graph's default columns read. All four
    // come out of the graph entity's properties bag. Appended for the usual no-migration
    // reason: ensureHeaders adds declared-but-missing headers to the right of whatever a tab
    // already has, and every read maps by header NAME.
    "display_name", "email", "publisher", "discovery_methods",
    // Worst business-impact tier across the asset's own projects (HBI/MBI/LBI), folded by
    // enrichGraphDoc from `projects[].businessImpact` — the signal ai/AARS_ASSESSMENT.md §7
    // named as dropped at the sheet boundary. Appended, for the usual no-migration reason:
    // ensureHeaders adds declared-but-missing headers to the right of whatever a tab
    // already has, and every read maps by header NAME, so an existing ledger picks this up
    // on its next sync with no migration.
    "business_impact",
    // Phase 6: the Asset Posture Tier (posture.ts, postureRule.ts) — a capability envelope
    // against a containment, folded BESIDE the AARS score above by graphEnrich.withPostureTiers,
    // never blended into it. Appended, same no-migration contract as every block above.
    "posture_tier", "posture_input_json", "worst_open_problem",
    // Which AARS rule version produced this row's score. Per-asset rather than one global
    // marker because a rescore can now be scoped to a project, which leaves the register
    // holding scores from two rules at once — and `counts from two versions are not on the
    // same scale` is a rule this ledger already enforces on sync_history's distribution.
    // Appended, same no-migration contract as every block above: a row written before this
    // existed reads back undefined, which means "unknown", not "the current rule".
    "aars_rule_version",
  ],
  [TABS.edges]: ["id", "src", "dst", "type", "negated", "access_type"],
  [TABS.issues]: [
    "id", "rule_id", "rule_name", "combo_group", "native_severity", "adjusted_severity",
    "status", "asset_id", "asset_name", "region", "account", "projects_json",
    "frameworks_json", "justification", "created_at",
    "due_at", "resolution_recommendation", "remediation",
    // issuesV2 lifecycle and context. Appended, never inserted: ensureHeaders adds
    // declared-but-missing headers to the right of whatever a tab already has and every
    // read maps by header NAME, so a ledger written before this change picks these up on
    // the next sync with no migration and no re-run of setup().
    "issue_type", "updated_at", "resolved_at", "resolution_reason", "resolved_by",
    "assignee", "environments", "validated_exploitable", "business_impact",
    "entity_status", "subscription_id", "ignore_note", "ignore_expired_at",
    "ticket_urls", "ai_verdict", "ai_recommended_severity",
    // Phase 4: the Problem/Decision-Vector verdict (problem.ts, problemRule.ts). Appended,
    // never inserted — same no-migration contract as every block above: ensureHeaders adds
    // declared-but-missing headers to the right, and every read maps by header NAME.
    //
    // Deliberately NO `problem_points` column. The whole argument for a decision tree over
    // a score is that its output is an ACTION (one of four queues), not a number — and a
    // points column sitting next to it would be too tempting a sort comparator to leave
    // alone. Add one and within a week something sorts the register by it, ranks ACT rows
    // against each other by "how ACT" they are, and the tree has quietly grown the score it
    // was built to replace. If a number is ever genuinely needed, it belongs in a rule's own
    // preview surface, never on the row.
    "problem_outcome", "problem_input_json", "problem_rule_version",
    // Which AI assets this issue actually describes, and how they were reached. Appended,
    // same no-migration contract. NOT a replacement for asset_id, which keeps naming the
    // entity Wiz raised the issue on so the drill-down still matches the console — see
    // IssueRow.attributedAssetIds for the measurement that made this necessary.
    "attributed_asset_ids", "attribution_hop",
    // WHICH RISK CATEGORIES THIS ROW WAS COLLECTED UNDER. Appended, same no-migration
    // contract as every block above — and declared here rather than only written, because
    // writeGrid projects a row onto the DECLARED headers and silently discards the rest: an
    // undeclared column is written every sync and read back as a default, forever.
    //
    // Comma-joined, matching `environments` and `attributed_asset_ids`; the `_json` suffix
    // is reserved for structures. A row written before this column reads back as the AI
    // category, which is the only scope those syncs ever ran.
    "categories",
    // THE ISSUE'S OWN PROJECT ATTRIBUTION, as objects. Appended, same no-migration contract —
    // and declared here for the same `writeGrid` reason the block above states.
    //
    // `projects_json` beside it holds NAMES and must keep doing so (the facets and the asset
    // table read them); this holds `{id, name, isFolder, businessImpact}`, because only the
    // id can decide project membership — a name is not unique across the tenant and carries
    // no ancestry. The project view needs that: an issue raised on a VM or an identity has no
    // asset row to hang off, so scoping by the asset alone made every one of them vanish.
    //
    // An EMPTY CELL reads back as undefined, never as an empty array. A row written before
    // this column has unknown refs; a live sync writing `[]` is saying Wiz attributed the
    // issue to nothing. The project view must be able to tell those apart.
    "project_refs_json",
    // WHERE THE ROW SITS RELATIVE TO THE AI ESTATE — DIRECT / ADJACENT / UNLINKED, the edge
    // type the hop came through, and the AI assets it reached. Appended, same no-migration
    // contract, and declared here for the same `writeGrid` reason the two blocks above state:
    // an undeclared column is projected away on every write and read back as a default.
    //
    // The ids are comma-joined, matching `attributed_asset_ids` and `environments`; the
    // `_json` suffix stays reserved for structures. An empty `ai_adjacency` cell reads back as
    // UNDEFINED and never as "UNLINKED" — no pass ran over that row, which is a different
    // claim from having looked and found no link, and the ranker prices the two differently.
    "ai_adjacency", "adjacency_via", "adjacent_asset_ids",
    // THE EXPLOITATION READING, folded from the vulnerability findings that name this issue
    // (ai_issue_exploitation holds the evidence). Appended, same no-migration contract, and
    // declared here for the same `writeGrid` reason the three blocks above state.
    //
    // ALL THREE EMPTY IS THE FOURTH STATE and the one that matters: no evidence pass ran over
    // this row — VULN_FINDINGS was refused, or the row predates the step. `rank.exploitationOf`
    // prices an absent tier as null (the term leaves the blend) and `"none"` as a measurement
    // that scores, so a reader defaulting the blank to "none" would score every register that
    // never ran the step as one where nothing is exploited. `epss_peak` is empty rather than 0
    // for the same reason one column over: 0 is a computed EPSS, blank is no EPSS.
    "exploitation_tier", "epss_peak", "exploitation_findings",
  ],
  [TABS.findings]: [
    "id", "resource_id", "rule_short_id", "severity", "remediation", "framework_codes",
    // The Cloud Configuration register. Appended, never inserted — same contract as the
    // ai_issues block above: ensureHeaders adds declared-but-missing headers to the right
    // and every read maps by header NAME, so a ledger written before this change picks
    // them up on the next sync with no migration and no re-run of setup().
    //
    // Rows written by the previous version carry neither `result` nor `status`. That is
    // why isOpenGap (domain/config.ts) treats an absent field as permissive: those rows
    // were already filtered to FAIL + OPEN at ingest, and demanding the columns would
    // read every one of them as "not a gap".
    "name", "status", "result", "deleted", "first_seen_at", "analyzed_at",
    // The control. rule_description / remediation_instructions / opa_policy repeat
    // verbatim across every finding of the same rule — sixteen identical Rego documents
    // for one Bedrock rule in the sample tenant. Denormalized on purpose: the register
    // reads them per row, the sync rewrites this tab wholesale, and a rules tab would buy
    // a join to save a few hundred cells on a register the framework filter already
    // bounds to the AI landscape.
    "rule_id", "rule_graph_id", "rule_name", "rule_description",
    "remediation_instructions", "opa_policy", "risks_json", "threats_json",
    "resource_name", "resource_type", "resource_status", "target_external_id", "source",
    "subscription_id", "subscription_name", "cloud_provider", "projects_json",
    "business_impact", "ignore_rule_ids_json", "iac_finding_ids_json",
    // Phase 4: the Problem/Decision-Vector verdict. Same three columns as ai_issues above,
    // same no-migration contract, and the same deliberate absence of a `problem_points`
    // column — see that block's comment for why. Gated on `isOpenGap` rather than
    // `isUnresolvedIssue` (graphEnrich.withProblemVerdicts).
    "problem_outcome", "problem_input_json", "problem_rule_version",
  ],
  // DSPM findings, kept apart from the compliance findings above on purpose: that tab
  // prices AARS pillar B and counts as `complianceGaps`, and a classification finding
  // folded into it would inflate both.
  [TABS.dataFindings]: ["id", "resource_id", "name", "severity"],
  // ---- compliance framework posture (securityFramework/complianceAnalytics) ----
  //
  // Three tabs rather than one, because the posture tree has two genuinely different
  // grains and a many-to-many edge between them.
  //
  // `ai_frameworks` is the catalogue: what the tenant has, so Settings can offer a picker
  // instead of asking an operator to type "wf-id-275".
  //
  // No `selected` column. Selection is THIS APP's decision and lives in `settings`; a
  // column here could only ever be a stale copy of it, written by a sync that has no
  // reason to know. The API model folds the two together at read time instead.
  [TABS.frameworks]: ["id", "name", "description", "builtin", "enabled", "policy_types"],
  // `ai_framework_posture` is the TREE, flattened with a `level` discriminator
  // (framework | category | subcategory) rather than split across three tabs. One read
  // path, one wholesale rewrite, and the page rebuilds the hierarchy from external ids.
  //
  // `posture_pct` is stored EXACTLY as Wiz sent it and is never recomputed: it is their
  // number, and a second locally-derived percentage sitting beside it would be two
  // answers to one question. `empty_posture_reason` (NO_RESOURCES / NO_POLICIES) is what
  // keeps a null posture from being read as a confident 0 — see compliancePosture.ts.
  // The 5Rs AI-scoped posture (fiveRsPosture.ts) does not break this rule: it is derived
  // at read time from PolicyScope's own counts and shipped as a separate payload field,
  // never written back over this column.
  [TABS.frameworkPosture]: [
    "framework_id", "level", "category_external_id", "subcategory_external_id",
    "node_id", "title", "description",
    "posture_pct", "pass_count", "fail_count",
    "pass_subcategory_count", "fail_subcategory_count", "empty_posture_reason",
    "assessment_scope", "mapping_rationale", "tags_json",
  ],
  // `ai_framework_policies` is the many-to-many EDGE, one row per
  // (framework, subcategory, policy). The same control maps to several subcategories —
  // one prompt-injection control lands under ASI01, ASI02 and ASI10 — so the mapping IS
  // the row. Keying by policy id alone would lose it, which is exactly the join this
  // feature exists to harvest: it is what lets a failing finding be labelled with the
  // framework codes AARS pillar B already knows how to price.
  [TABS.frameworkPolicies]: [
    "framework_id", "category_external_id", "subcategory_external_id",
    "policy_id", "policy_kind", "short_id", "name", "severity",
    "enabled", "builtin", "pass_count", "fail_count", "assessed_count",
    "rejected_count", "no_resource_to_assess",
    "target_native_type", "subject_entity_type", "cloud_provider", "has_auto_remediation",
  ],
  // ---- the rule catalogue + identity hygiene (cloudConfigurationRules) ----
  //
  // `ai_config_rules` is Wiz's VOCABULARY, not this tenant's posture — the only tab here
  // whose contents do not describe the landscape. It is what turns an opaque `SUB-082` in the
  // AARS cascade into "Vertex AI Metadata Store should be encrypted with a customer-managed
  // key", and what the identity-hygiene matchers resolve MFA and dormancy rules against
  // instead of hardcoding ids that differ per cloud. ~3,858 rows, refreshed monthly rather
  // than daily; see the CONFIG_RULES gate in syncJobs.
  [TABS.configRules]: ["id", "short_id", "name", "subject_entity_type", "external_refs"],
  // `ai_identity_findings` is separate from `ai_findings` for the reason `ai_data_findings`
  // is: that tab prices AARS pillar B through buildAarsHintsFromFindings, which keys hints by
  // resourceId — and a USER_ACCOUNT IS a row in ai_assets, put there by the identity-access
  // traversal. Folding a person's missing MFA in there would give a human being an AI Asset
  // Risk Score.
  [TABS.identityFindings]: [
    "id", "resource_id", "resource_name", "rule_id", "rule_short_id", "rule_name",
    "severity", "status", "result", "first_seen_at", "analyzed_at", "remediation", "hygiene",
  ],
  // Exploitation evidence, one row per ISSUE rather than per finding. The findings themselves
  // are not stored: 7,368 of them fold to at most a few thousand rows here, they describe assets
  // `ai_assets` does not hold (AARS_LIVE_MEASUREMENTS.md §6.4), and the OS-vulnerability register
  // already owns that population. This tab is the fold and its audit trail.
  //
  // `has_kev` / `has_exploit` / `epss_peak` are TRI-STATE and an empty cell means UNMEASURED —
  // Wiz answers null for a signal it never evaluated. The reader must not read a blank as false
  // or as zero; `tier: "unknown"` is what an all-null row says out loud.
  //
  // The three derived columns also ride on `ai_issues` (`exploitation_tier`, `epss_peak`,
  // `exploitation_findings`) so the ranker needs no join. Two homes for one fact, the same split
  // `projects_json` / `project_refs_json` already carries: this tab is the evidence, those
  // columns are the reading, and only this one can say WHICH findings it was folded from.
  [TABS.issueExploitation]: [
    "issue_id", "tier", "has_kev", "has_exploit", "epss_peak",
    "finding_count", "sample_finding_ids", "observed_at",
  ],
  // THE ISSUE LIFECYCLE LEDGER — the one tab here that is never a snapshot.
  //
  // Every other data tab above is rewritten wholesale from what the last sync saw, which is
  // correct for a register that describes today and useless for one that has to say when a
  // row LEFT. `ai_issues` is filtered to OPEN/IN_PROGRESS, so a remediated issue simply
  // vanishes from it on the next sync with nothing recording that it was ever there.
  //
  // "Never overwritten" is a claim about the CONTENT, not about the write call: `syncStore`
  // reconciles the stored rows with this sync's register and writes the whole reconciled grid
  // back, which is a full rewrite of the ledger FROM ITS OWN PRIOR CONTENT and never a
  // replacement of it by the current snapshot. Nothing may write this tab from `ai_issues`
  // alone — that is exactly the erasure the tab exists to prevent.
  //
  // `disappeared_at` IS NOT A RESOLUTION DATE. It is the timestamp of the sync that first
  // failed to see the row: an upper bound whose error is the sync interval. `resolution_src`
  // carries the provenance in the same row so a surface cannot render the date without the
  // word that qualifies it — "gone by", never "resolved". See domain/issueLedger.ts.
  //
  // `register_scope` is the scope the sync that last SAW the row applied; `categories` is the
  // union of every category that has ever matched it. Two different facts — which questions
  // were asked, and which ones answered — and only the first can explain an absence.
  //
  // Comma-joined for `categories`, matching `environments` and `attributed_asset_ids` on
  // ai_issues; the `_json` suffix stays reserved for structures. An empty `exploitation_tier`
  // or `ai_adjacency` cell reads back as UNDEFINED and never as "none"/"UNLINKED": the fold
  // did not reach the row on the sync that last saw it, which the ranker prices differently
  // from a measurement.
  [TABS.issueLedger]: [
    "issue_id", "first_seen_sync", "first_seen_at", "last_seen_sync", "last_seen_at",
    "disappeared_at", "resolution_src", "last_status", "categories", "rule_id",
    "created_at", "due_at", "ai_adjacency", "exploitation_tier", "epss_peak",
    "register_scope", "episode",
  ],
  [TABS.syncHistory]: [
    "sync_id", "started_at", "finished_at", "status", "mode",
    "node_count", "edge_count", "issue_count", "api_calls", "snapshot_ref", "error",
    "aars_severity_json", "aars_rule_version",
    // Phase 4: the outcome distribution this sync produced, and which problem_rule version
    // produced it — the problem-outcome analogue of the two columns just above, feeding
    // aarsTrend.ts's second series. Appended, same no-migration contract.
    "problem_outcome_json", "problem_rule_version",
    // BOTH distributions again, one level down: `{projectId: {aars, outcome}}`, an entry per
    // project holding an asset. One cell rather than a tab, because a sync writes one row and
    // the map is bounded by the project count, not the landscape — see PROJECT_TOTALS_COLUMN
    // in aarsTrend.ts for the shape and for why an absent entry is never read as a zero.
    // Appended, same no-migration contract: rows without it have no scoped series, which the
    // trend reports rather than fabricates.
    "project_totals_json",
    // The count trend's two new series. `issue_count` above is the third and has been
    // written since the first sync this ledger ever recorded, which is why the issues line
    // has full history and these two start empty — appended under the same no-migration,
    // no-backfill contract as everything above them. A row written before these existed
    // carries NO value, and the reader plots a gap rather than a zero: see
    // CountTrendPoint in aarsTrend.ts for why that distinction is load-bearing.
    "finding_count", "posture_fail_count",
    // The posture distribution this sync produced, and which posture rule produced it. It
    // carries the SCOPE SPLIT, not just tiers: an asset can lack a tier because nobody
    // measured it (a coverage gap) or because the lattice does not describe its kind (not a
    // gap at all), and a bare tier count cannot tell those apart.
    "posture_tier_json", "posture_rule_version",
    // Which NORMALIZER produced the readings above, as opposed to which RULE priced them. A
    // rule version moves when an operator edits a model; this moves when a code change alters
    // what a stored fact MEANS, which only a full sync can repair. The trend marks the break
    // here so a step is never read as movement.
    "derivation_version",
    // THE SCOPE THIS SYNC APPLIED — the sorted category signature, not the one settings hold
    // now. The two differ across a settings change, and a total counted under six categories
    // is not comparable with one counted under one; stamping today's list onto yesterday's
    // row would erase exactly the discontinuity the trend has to mark. Same argument as
    // `derivation_version` above it, one axis over: that records what a fact MEANS, this
    // records which population was asked. Empty on a row written before the column, which
    // reads as "unknown" and never as "a different scope".
    "register_scope",
    // THE ADJACENCY CENSUS THIS SYNC MEASURED — `{DIRECT, ADJACENT, UNLINKED, edgesKnown}`,
    // mirroring `aars_severity_json` and `problem_outcome_json` one row up. Appended, same
    // no-migration contract; absent on a row written before the column, which reads as "no
    // adjacency pass" and never as an all-UNLINKED register.
    //
    // `edgesKnown` travels INSIDE the object rather than as its own column because the three
    // counts are unreadable without it: 68 asset edges on the reference tenant means UNLINKED
    // is mostly "not traversed". Splitting them into two columns is how a later reader ends up
    // plotting the counts alone.
    "adjacency_json",
    // THE EXPLOITATION CENSUS THIS SYNC MEASURED — the five tiers, plus the two counts that say
    // what the fold could NOT use (`unjoined`, `droppedNotInRegister`) and the number of findings
    // it read. Appended, same no-migration contract.
    //
    // NULL, NOT A ZEROED CENSUS, when no evidence pass ran. VULN_FINDINGS is optional; a tenant
    // that refuses it has no reading here, and "no issue carries exploitation evidence" is a very
    // different claim from "we never asked". The two counts travel INSIDE the object for the
    // reason `edgesKnown` does one row up: the tier counts are unreadable without them, and split
    // into their own columns a later reader plots the tiers alone.
    "exploitation_json",
    // WHAT THE LIFECYCLE LEDGER DID ON THIS SYNC — `{new, resolved, reopened, carried,
    // skippedNarrowedScope}` (domain/issueLedger.IssueLedgerDeltas). Appended, same
    // no-migration contract as every column above.
    //
    // TRANSITION COUNTS, not a census of the tab: a row present on both syncs is counted by
    // none of the five, so these numbers do not sum to the ledger's size and a reader must not
    // try to make them. `skippedNarrowedScope` is the one to watch — a non-zero there says the
    // category scope moved and that this sync deliberately resolved nothing by absence, which
    // is what keeps a re-scoping from being read as a remediation programme.
    //
    // Rides here rather than on its own tab because it is one object per sync, exactly like
    // `adjacency_json` and `exploitation_json` above it, and because `bootstrap.latestSync`
    // ships the whole history row — so the client gets it with no new endpoint.
    "ledger_json",
    // OPEN ISSUES PER RISK CATEGORY at this sync — `{[categoryId]: openIssues}`, counted once
    // per category a row carries. The scope-over-time series: `register_scope` beside it says
    // WHICH questions this sync asked, and this says what each one answered.
    //
    // THE COUNTS DO NOT SUM TO `issue_count`, and that is a property of the register rather
    // than a defect: an issue sits in roughly five categories on the reference tenant
    // (AARS_LIVE_MEASUREMENTS.md §6.1), arrives once per selected category it matches, and is
    // counted under each. A reader adding them up is measuring the overlap, not the register.
    //
    // A KEY ABSENT FROM THE OBJECT IS NOT A ZERO. A sync run under a narrower scope never
    // collected the categories it was not asked for, so it has no number for them — the
    // trend plots the gap (aarsTrend.ts CATEGORY_SPEC, `absentKeyIsNull`) rather than drawing
    // a category that sat at zero until the day it was selected.
    "category_counts_json",
    // Issues carrying a KEV-tier exploitation reading at this sync — the one exploitation
    // figure that earns a scalar column of its own, because it is the tier every surface
    // leads with.
    //
    // NULL, NOT ZERO, when no evidence pass ran, exactly as `exploitation_json` beside it is
    // null: VULN_FINDINGS is optional, and "no issue is on the KEV catalogue" is a very
    // different claim from "we never asked". Derived from the same fold that writes that
    // census, so the two can never disagree about one sync.
    "kev_linked_count",
  ],
  [TABS.settings]: ["key", "value_json"],
  [TABS.jobs]: [
    "job_id", "kind", "phase", "sync_id", "step_index", "cursor", "page",
    "nodes_so_far", "total_count", "part_refs_json", "params_json", "error",
    "started_at", "updated_at",
  ],
  [TABS.meta]: ["version"],
};

export const SCHEMA_VERSION = 1;

let spreadsheetCache: GoogleAppsScript.Spreadsheet.Spreadsheet | null = null;

/**
 * Drop this module's per-execution memos.
 *
 * Test-only. In GAS these memos die with the execution, so nothing in production ever needs
 * to clear them; under vitest the module registry outlives a test, and `test/gasEnv.ts`
 * calls this so a shared server can be reset without re-importing the whole graph. See the
 * comment on `resetToSynced` there.
 */
export function __resetMemosForTest(): void {
  spreadsheetCache = null;
}


export function ledgerSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  if (spreadsheetCache === null) {
    spreadsheetCache = SpreadsheetApp.openById(requireProp(PROP_KEYS.ledgerSpreadsheetId));
  }
  return spreadsheetCache;
}

export function sheet(tab: string): GoogleAppsScript.Spreadsheet.Sheet {
  const sh = ledgerSpreadsheet().getSheetByName(tab);
  if (!sh) throw new Error(`Missing tab ${tab} — run setup().`);
  return sh;
}

/** Create any missing tab with its frozen header row (idempotent). */
export function ensureTabs(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): void {
  // All timestamps are canonical ISO strings; the spreadsheet timezone must never
  // reinterpret them (and Sheets must not auto-coerce them into locale Dates).
  ss.setSpreadsheetTimeZone("Etc/UTC");
  for (const [tab, headers] of Object.entries(TAB_HEADERS)) {
    let sh = ss.getSheetByName(tab);
    if (!sh) {
      sh = ss.insertSheet(tab);
      // Plain-text format everywhere: ISO timestamps and JSON blobs round-trip
      // byte-stable instead of becoming Date cells in the sheet's locale.
      sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat("@");
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    } else {
      ensureHeaders(sh, tab); // append any headers a newer schema added
    }
  }
  const dflt = ss.getSheetByName("Sheet1");
  if (dflt && ss.getSheets().length > 1) ss.deleteSheet(dflt);
}

/** Cell -> JS value: '' -> null; Date -> canonical ISO; numbers/strings verbatim. */
function fromCell(v: unknown): unknown {
  if (v === "" || v === null || v === undefined) return null;
  // toIso, not a second copy of it: the same floor-to-seconds + strip-".000" expression
  // was written out here and in domain/util.ts.
  if (v instanceof Date) return toIso(v.getTime());
  return v;
}

/** JS value -> cell: null/undefined -> ''. */
function toCell(v: unknown): unknown {
  if (v === null || v === undefined) return "";
  return v;
}

/**
 * Cells one `getValues()` may ask for.
 *
 * Sheets caps the RESPONSE, not the sheet. A tab is free to grow to the spreadsheet's 10M
 * cell ceiling, but one read that tries to carry all of it back is refused outright — "the
 * data requested exceeds the maximum size allowed", in the script owner's locale, thrown
 * before a single row arrives.
 *
 * That is not a hypothetical. On a real tenant every page that read `ai_findings` — the
 * inventory, priorities, the configuration register and compliance posture — failed with
 * exactly that, while every page that did not (toxic combinations, the graph, this page's
 * own storage stats) rendered normally. `ai_assets` at 13,788 rows × 48 columns came back
 * without complaint in the same execution, which is what made it legible: the service was
 * not refusing reads, it was refusing ONE range, because that tab had outgrown a single
 * response and nothing here had ever asked for less than all of it.
 *
 * 200,000 is chosen against that measurement rather than against a documented number, which
 * Google does not publish: the assets read that WORKS is ~662,000 cells, so a third of the
 * nearest known-good figure leaves room for rows carrying much longer text than an asset
 * row does — and the halving below makes the constant a starting point rather than a bet.
 *
 * Blocks, not a paged register. The cap is on the transport, so the cure belongs at the
 * read: the same rows come back, in several responses instead of one, and every caller and
 * every read model above is untouched. Sizing the LEDGER to fit one response would be a
 * different product (and the Data page's prune panel is where that decision already lives).
 */
export const READ_BLOCK_CELLS = 200_000;

/**
 * A tab's grid, in as many reads as it takes.
 *
 * The halving is the same shape as wizClientAi's page-size fallback, and for the same
 * reason: a budget that turns out to be too generous must cost one retry, not a dead page.
 * A block that is refused is re-asked SMALLER rather than skipped — a read that silently
 * returned fewer rows than the tab holds would put a short register in front of an analyst
 * with nothing to say it was short, which on a security ledger is the worst outcome
 * available. Once halved the smaller block is kept for the rest of the tab: the service has
 * already said what it will not carry, and re-asking the generous size at every block would
 * pay for that answer again per block.
 *
 * It halves BLINDLY, where wizClientAi is careful to retry only failures a smaller ask could
 * fix. The difference is that its verdicts arrive as HTTP codes and stable English envelopes,
 * and these arrive as a localized sentence — the tenant this was written for got the size
 * error in French. Any `/exceeds the maximum/` test would have read that as a failure worth
 * no retry and left the page dead in exactly the locale that reported the bug. Halving costs
 * at most a dozen fast rejections before the rethrow, which is the cheaper mistake.
 *
 * When even a single row will not come back the failure is rethrown NAMING the tab and the
 * row it stopped at, because Google's own message says neither, and "which tab" is the
 * entire diagnosis.
 */
function readGrid(
  sh: GoogleAppsScript.Spreadsheet.Sheet,
  tab: string,
  lastRow: number,
  lastCol: number,
): unknown[][] {
  const out: unknown[][] = [];
  let block = Math.max(1, Math.floor(READ_BLOCK_CELLS / Math.max(1, lastCol)));
  let row = 1;
  while (row <= lastRow) {
    const take = Math.min(block, lastRow - row + 1);
    try {
      for (const values of sh.getRange(row, 1, take, lastCol).getValues()) out.push(values);
      row += take;
    } catch (e) {
      if (take <= 1) {
        throw new Error(
          `Reading ${tab} stopped at row ${row} of ${lastRow} (${lastCol} columns): ` +
          `${e instanceof Error ? e.message : String(e)}`,
        );
      }
      block = Math.floor(take / 2);
    }
  }
  return out;
}

/**
 * Data rows as objects keyed by header name, skipping wholly-empty rows.
 *
 * Shared by `readAll` and `readTail` so the two cannot drift in how they coerce a cell or
 * decide a row is empty. `headers` names column i+1 by position and a blank header skips
 * that column rather than compacting it — see `ensureHeaders` for why that alignment is
 * load-bearing.
 */
function mapRows(headers: string[], rows: unknown[][]): Rec[] {
  const out: Rec[] = [];
  for (const values of rows) {
    const row: Rec = {};
    let empty = true;
    for (let j = 0; j < headers.length; j++) {
      const h = headers[j];
      if (!h) continue;
      const v = fromCell(values[j]);
      row[h] = v;
      if (v !== null) empty = false;
    }
    if (!empty) out.push(row);
  }
  return out;
}

/** All data rows of a tab as objects keyed by header name. */
export function readAll(tab: string): Rec[] {
  const sh = sheet(tab);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const values = readGrid(sh, tab, lastRow, lastCol);
  return mapRows(values[0]!.map(String), values.slice(1));
}

/**
 * The LAST `n` data rows of a tab, for a caller that only ever wants recent ones.
 *
 * Two small `getValues` calls — the header row, then a bounded window at the bottom —
 * instead of one over the whole grid. The motivating caller is the progress poll: it runs
 * every three seconds against the `jobs` tab, which gains a row per sync and is never
 * trimmed, so a full read there gets more expensive for the life of the deployment while
 * always answering about a job appended moments ago.
 *
 * Headers are re-read on every call rather than memoized, because the write path
 * (`ensureHeaders`) can append a column between two reads and a stale header list would
 * silently misname every value after the new one.
 *
 * IT IS NOT A SUBSTITUTE FOR `readAll` AND CALLERS MUST NOT TREAT IT AS ONE. A row outside
 * the window is absent, not missing — so any caller whose "not found" means something has to
 * fall back to the full read before believing it. `jobsStore.getJob` does exactly that.
 */
export function readTail(tab: string, n: number): Rec[] {
  const sh = sheet(tab);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0]!.map(String);
  const first = Math.max(2, lastRow - Math.max(1, n) + 1);
  const values = sh.getRange(first, 1, lastRow - first + 1, lastCol).getValues();
  return mapRows(headers, values);
}

/**
 * Bring a tab's header row up to the declared schema, returning the headers to write by.
 *
 * Writes map by header NAME, so a column the sheet has never seen is silently dropped —
 * which is how a renamed column erases itself: the sync writes the new name into a sheet
 * that only has the old one, and every row loses the value. setup() adds new headers, but
 * an upgrade that doesn't re-run it would otherwise keep writing into a schema the sheet
 * no longer has. Only DECLARED columns are added, so a stray key on a row still can't
 * grow the sheet, and they go on the end, so existing column order is untouched.
 *
 * A BLANK HEADER BETWEEN TWO NAMED ONES IS REFUSED, loudly, rather than worked around.
 *
 * This used to compact row 1 with `.filter(Boolean)`, which quietly broke the one thing the
 * whole name-mapping scheme rests on: that the header at index i names column i+1. `readAll`
 * does not compact — it keeps positions and skips blanks — so after a gap the two disagreed
 * about where every subsequent column lived. Writes landed one column to the LEFT of where the
 * next read looked, and the value read back `null`: indistinguishable from a field the tenant
 * never reported. Every write path reaches this function, so it was not one endpoint's problem,
 * and nothing anywhere raised a word about it.
 *
 * Only a hand-edited sheet can produce the state — clearing a header, or inserting a column and
 * not naming it — so refusing costs a healthy ledger nothing. Accommodating it is what turns a
 * five-second manual fix into a register full of nulls nobody can date.
 *
 * Trailing blanks are a different thing and stay legal: row 1's range is read out to the
 * SHEET's last column, so a tab whose data rows run wider than its headers pads on the right.
 * Those carry no data and shift nothing.
 */
function ensureHeaders(sh: GoogleAppsScript.Spreadsheet.Sheet, tab: string): string[] {
  const width = Math.max(sh.getLastColumn(), 1);
  const raw = sh.getRange(1, 1, 1, width).getValues()[0].map(String);

  let lastNamed = -1;
  for (let i = 0; i < raw.length; i++) if (raw[i]) lastNamed = i;
  for (let i = 0; i < lastNamed; i++) {
    if (raw[i]) continue;
    throw new Error(
      `Tab "${tab}" has a blank header at column ${i + 1}, between named columns `
      + `("${raw.slice(0, i).filter(Boolean).pop() ?? "?"}" and "${raw[lastNamed]}"). `
      + "Every read and write maps columns by header name, so a gap silently misfiles every "
      + "value after it. Name the column or delete it, then retry — no data was written.",
    );
  }

  // Equivalent to the old filter for every healthy sheet: with no interior gap, dropping the
  // trailing blanks is the only thing the filter was doing.
  const existing = raw.slice(0, lastNamed + 1);
  const missing = (TAB_HEADERS[tab] ?? []).filter((h) => !existing.includes(h));
  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  return [...existing, ...missing];
}

/**
 * Project rows onto the tab's headers and write them in ONE batched setValues.
 *
 * One call, never a loop: a per-row write is the classic way to blow the 6-minute
 * execution limit, and every write path in this file goes through here.
 */
function writeGrid(
  sh: GoogleAppsScript.Spreadsheet.Sheet, headers: string[], startRow: number, rows: Rec[],
): void {
  if (!rows.length) return;
  const grid = rows.map((r) => headers.map((h) => toCell(r[h])));
  const range = sh.getRange(startRow, 1, grid.length, headers.length);
  range.setNumberFormat("@"); // rows added beyond the original grid stay plain text
  range.setValues(grid);
}

/** Replace ALL data rows of a tab in one batched write. */
export function overwrite(tab: string, rows: Rec[]): void {
  const sh = sheet(tab);
  const headers = ensureHeaders(sh, tab);
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  writeGrid(sh, headers, 2, rows);
}

/** Append rows in one batched write. */
export function appendRows(tab: string, rows: Rec[]): void {
  if (!rows.length) return;
  const sh = sheet(tab);
  writeGrid(sh, ensureHeaders(sh, tab), sh.getLastRow() + 1, rows);
}

/** Data-row count of a tab (rows below the frozen header). */
export function dataRowCount(tab: string): number {
  return Math.max(0, sheet(tab).getLastRow() - 1);
}

/**
 * How many empty rows a shrunken tab keeps in hand before `trimSurplusRows` reclaims any.
 *
 * Not zero, on purpose. `cellCount()` below prices the ALLOCATED grid, so a tab that fell
 * from 14,000 rows to 2,000 is still charged for 14,000 until the surplus is deleted — but
 * trimming it flush would leave every subsequent write growing the grid a row at a time from
 * nothing. A buffer this size leaves the tab in the same shape a freshly created one is in,
 * which is the shape every write path here was already built against.
 */
export const TRIM_BUFFER_ROWS = 1000;

/**
 * Delete the empty grid rows left behind when a tab is rewritten much smaller, and return
 * how many went.
 *
 * `overwrite` clears content but never shrinks the grid, and `cellCount()` prices
 * `getMaxRows() * getMaxColumns()` — the allocation, not the contents. So without this a
 * prune can delete four rows in five and the storage figure on the Data page does not move,
 * which reads as "nothing happened" rather than as "the ceiling is priced differently than
 * you think".
 *
 * Deliberately NOT the sibling tool's `truncateAfter`: that one clears content, which is
 * what a resumable append needs and is exactly the half that does not help here.
 */
export function trimSurplusRows(tab: string, bufferRows: number = TRIM_BUFFER_ROWS): number {
  const sh = sheet(tab);
  // At least one row has to survive, and the header is the row worth surviving.
  const keep = Math.max(sh.getLastRow(), 1) + Math.max(0, bufferRows);
  const surplus = sh.getMaxRows() - keep;
  if (surplus <= 0) return 0;
  sh.deleteRows(keep + 1, surplus);
  return surplus;
}

/**
 * Update the first row where keyColumn === keyValue (returns false when absent).
 *
 * `patch` is partial: a key the patch omits keeps whatever the row already held, which is
 * what lets the sync checkpoint only the fields a hop actually advanced.
 *
 * Goes through `ensureHeaders` like every other write. It used to read the header row
 * directly and skip any patch key whose column was missing — the exact failure that
 * function's own comment describes, on the one write path that wasn't using it. A job
 * checkpointing into a tab written before a column existed lost that field silently.
 */
export function updateWhere(tab: string, keyColumn: string, keyValue: unknown, patch: Rec): boolean {
  const sh = sheet(tab);
  if (sh.getLastRow() < 2) return false;
  const headers = ensureHeaders(sh, tab);
  const lastRow = sh.getLastRow();
  const lastCol = headers.length;
  // Through readGrid like readAll, not because `jobs` and `sync_history` are large today
  // but because this is the same whole-tab range asked the same way: leaving one of the two
  // call sites on a single unbounded read is how the fix comes undone the first time a tab
  // this touches grows.
  const values = readGrid(sh, tab, lastRow, lastCol);
  const keyIdx = headers.indexOf(keyColumn);
  if (keyIdx < 0) return false;
  for (let i = 1; i < values.length; i++) {
    if (fromCell(values[i][keyIdx]) === keyValue) {
      const rowVals = values[i].slice();
      for (const [k, v] of Object.entries(patch)) {
        const idx = headers.indexOf(k);
        if (idx >= 0) rowVals[idx] = toCell(v);
      }
      sh.getRange(i + 1, 1, 1, lastCol).setValues([rowVals]);
      return true;
    }
  }
  return false;
}

/**
 * One tab's ALLOCATED grid — what `cellCount()` below is actually pricing for it.
 *
 * Exists so a prune can project what trimming would reclaim before it writes anything: the
 * preview has to be able to say the storage figure will move, and the only honest way to say
 * that is to do the same arithmetic the figure itself does.
 */
export function gridSize(tab: string): { rows: number; cols: number } {
  const sh = sheet(tab);
  return { rows: sh.getMaxRows(), cols: sh.getMaxColumns() };
}

/** Total cell count across the spreadsheet (storage-stats surface). */
export function cellCount(): number {
  return ledgerSpreadsheet()
    .getSheets()
    .reduce((acc, sh) => acc + sh.getMaxRows() * sh.getMaxColumns(), 0);
}
