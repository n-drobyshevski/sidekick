// Persistence of one sync's graph: enrichment → tab rewrite → Drive snapshot →
// sync_history append (the commit record, always LAST — no history row means the
// sync never happened and the previous snapshot stays authoritative).
//
// Read model: the Drive snapshot is the fast path for getGraph; the tabs are the
// inspectable/exportable source of truth and the fallback when the snapshot is
// missing or unreadable.

import {
  buildAarsHintsFromFindings,
  enrichGraphDoc,
  withDataFindingNodes,
  withExcessivePrivilegeNodes,
  withExposureEvidence,
  withHumanAccess,
  withIdentityAccessNodes,
  withInternetExposureNodes,
  withMissingGuardrailNodes,
  withIssueAttribution,
  withPostureTiers,
  withProblemVerdicts,
  withSensitiveDataNodes,
  type AarsHints,
} from "../domain/graphEnrich";
import { withDataFindingCounts } from "../domain/syncNormalize";
import type {
  ConfigRuleRow, DataFindingRow, FindingRow, FrameworkPolicyRow, FrameworkRow, GEdge, GNode,
  GraphDoc, IdentityFindingRow, IssueRow, NodeKind, PostureRow,
} from "../domain/graphTypes";
import type { EffectiveAccessRow } from "../domain/effectiveAccess";
import { edgeId } from "../domain/graphTypes";
import { aarsSeverity, derivationSignature, type AarsBands, type AarsRule } from "../domain/aars";
import { DERIVATION_VERSION, isOpenGap, isUnresolvedIssue, normalizeAarsSeverity } from "../domain/config";
import {
  countProblemOutcomes,
  decideProblem,
  deriveFindingProblemInput,
  deriveProblemInput,
  stripProblemFields,
  type ProblemVerdictInput,
} from "../domain/problem";
import { vectorSignature, type ProblemRule } from "../domain/problemRule";
import { censusPostureTiers, countPostureTiers, type Tier as PostureTier } from "../domain/posture";
import type { PostureRule } from "../domain/postureRule";
import { OTHER_GROUP_ID } from "../domain/toxicCombos";
import type { Severity } from "../domain/config";
import { countAarsSeverities, countProjectTotals, encodeProjectTotals } from "../domain/aarsTrend";
import { midrankPercentiles } from "../domain/rankStats";
import { inProject, planPrune, type PruneCensus } from "../domain/prunePlan";
import { nowIso, type Rec } from "../domain/util";
import { readGraphSnapshot, trashGraphSnapshot, writeGraphSnapshot } from "./archiveStore";
import { bumpDataVersion, bumpWizDataVersion } from "./serverCache";
import * as settingsStore from "./settingsStore";
import {
  appendRows, cellCount, gridSize, overwrite, readAll, TABS, trimSurplusRows, TRIM_BUFFER_ROWS,
} from "./sheetsDb";

// ------------------------------------------------------------- row (de)serializers
// Cells are plain text ("@"): booleans serialize as "true"/"false" ("null" for the
// tri-state internet flag), arrays/objects as JSON — byte-stable round trips.

function boolCell(v: boolean | undefined): string {
  return v ? "true" : "false";
}
function triCell(v: boolean | null | undefined): string {
  return v === null || v === undefined ? "null" : v ? "true" : "false";
}
/**
 * Exported, unlike the `boolCell`/`triCell` half of the pair, because a reader that walks the
 * ledger DIRECTLY still has to decode it. `registerScopeDiagnostic` deliberately reads the flat
 * tab rather than a parsed `GNode` (see its own comment), and the first version of it compared
 * the cell against a JS `true` — which the tab, being plain text, can never hold. That bug was
 * silent: it reported "no risk conditions" on a register full of them. Sharing the decoder is
 * what makes that class of mistake impossible rather than merely unlikely.
 */
export function parseBool(v: unknown): boolean {
  return String(v) === "true";
}
/** See `parseBool` for why this is exported. */
export function parseTri(v: unknown): boolean | null {
  const s = String(v);
  return s === "true" ? true : s === "false" ? false : null;
}
export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v === "") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/**
 * `projects_json` two-branch reader. A cell THIS version wrote holds full objects
 * (`{id, name, businessImpact}`, from `assetToRow`); a cell an OLDER version wrote holds
 * bare project names. The shape of the first element tells the two apart — a string means
 * legacy, an object means current — and an empty array satisfies both branches identically,
 * so it never has to guess.
 *
 * The legacy branch fabricates `proj-<lowercased name>` ids EXACTLY as the old unconditional
 * code did. That recipe is load-bearing for an existing ledger: it is what those rows'
 * project ids already are, and a rescore must keep producing the same ones rather than
 * re-keying every project on an asset a live sync hasn't touched since this shipped.
 */
export function parseAssetProjects(v: unknown): NonNullable<GNode["projects"]> {
  const raw = parseJson<unknown[]>(v, []);
  if (typeof raw[0] === "string") {
    return (raw as unknown[]).map((name) => ({
      id: `proj-${String(name).toLowerCase()}`,
      name: String(name),
    }));
  }
  return raw as NonNullable<GNode["projects"]>;
}

export function assetToRow(n: GNode): Rec {
  return {
    id: n.id,
    kind: n.kind,
    name: n.name,
    native_type: n.nativeType ?? null,
    cloud: n.cloudPlatform ?? null,
    region: n.region ?? null,
    status: n.status ?? null,
    account_id: n.cloudAccount?.id ?? null,
    account_name: n.cloudAccount?.name ?? null,
    // Full project objects, not just names: `rowToAsset` used to fabricate a `proj-<name>`
    // id and drop `businessImpact` entirely on the way back in, which is what stranded the
    // signal ai/AARS_ASSESSMENT.md §7 named as the highest-value follow-up. A row this
    // writes is always read back through the object branch of `rowToAsset`'s two-branch
    // reader below; the legacy string-array branch exists only for rows an OLDER version
    // wrote.
    projects_json: JSON.stringify(n.projects ?? []),
    // The asset-level worst-of `enrichGraphDoc` folds from `projects[].businessImpact` —
    // `?? null`, never a default, so an asset Wiz reported no impact for reads back
    // undefined rather than as a false "LBI".
    business_impact: n.businessImpact ?? null,
    first_seen: n.firstSeen ?? null,
    last_seen: n.lastSeen ?? null,
    internet: triCell(n.isAccessibleFromInternet),
    open_internet: triCell(n.isOpenToAllInternet),
    // triCell, not boolCell, for the same reason `internet` above uses it: these five are
    // TRI-STATE. boolCell(undefined) writes "false", which turns "Wiz never evaluated this"
    // into "evaluated, and negative" the moment a row round-trips the sheet — and that made
    // posture.capabilityOf/containmentOf and problem.impactOf unable to report `unknown` at
    // all. guardrail_missing is the sharpest of the five: syncNormalize only ever sets it
    // TRUE (the traversal is a negated scan), so "false" here has never once meant "we looked
    // and a guardrail is attached" — yet containmentOf reads it, paired with a non-exposed
    // flag, as STRONG containment.
    sensitive_data: triCell(n.hasSensitiveData),
    sensitive_access: triCell(n.hasAccessToSensitiveData),
    high_priv: triCell(n.hasHighPrivileges),
    admin_priv: triCell(n.hasAdminPrivileges),
    guardrail_missing: triCell(n.guardrailMissing),
    technology_categories: (n.technologyCategories ?? []).join(","),
    severity: n.severity ?? null,
    aars: n.aars ?? null,
    aars_severity: n.aarsSeverity ?? null,
    // `?? null` so an unstamped node stays unstamped rather than being claimed for rule 0.
    aars_rule_version: n.aarsRuleVersion ?? null,
    aars_pillars_json: n.aarsPillars ? JSON.stringify(n.aarsPillars) : null,
    aars_input_json: n.aarsInput ? JSON.stringify(n.aarsInput) : null,
    combo_groups: (n.comboGroups ?? []).join(","),
    tags_json: n.tags ? JSON.stringify(n.tags) : null,
    identity_purpose: n.identityPurpose ?? null,
    issue_analytics_json: n.issueAnalytics ? JSON.stringify(n.issueAnalytics) : null,
    // `?? null` rather than `?? 0`: a store the traversal never reached must read back as
    // undefined, not as "zero findings". The graph draws no aggregate for either, but the
    // pillar-C knob and the DSPM coverage state both need to tell them apart.
    data_finding_count: n.dataFindingCount ?? null,
    data_findings_json: n.dataFindingSeverities ? JSON.stringify(n.dataFindingSeverities) : null,
    exposure_level: n.exposureLevel ?? null,
    port_validation: n.portValidation ?? null,
    // `null` rather than `"{}"` when there is no evidence, and rowToAsset reads it back as
    // undefined: an asset the exposure steps never reached must not become one they reached
    // and found clean. conditionState falls through to the flags for the first and would
    // have to keep falling through for the second — but only one of them is honest about it.
    exposure_evidence_json: n.exposureEvidence ? JSON.stringify(n.exposureEvidence) : null,
    // `?? null`, never `?? false`: an identity row the tenant reported no dormancy for must
    // read back as undefined. "Not reported" and "in use" are different answers.
    inactive: n.inactive === undefined ? null : boolCell(n.inactive),
    inactive_timeframe: n.inactiveTimeframe ?? null,
    human_access_json: n.humanAccess ? JSON.stringify(n.humanAccess) : null,
    display_name: n.displayName ?? null,
    email: n.email ?? null,
    publisher: n.publisher ?? null,
    discovery_methods: (n.discoveryMethods ?? []).join(","),
    // Phase 6: the Asset Posture Tier — `?? null`, never a default: a synthetic node, or a
    // real one the fold never reached, must read back as undefined rather than as tier 0.
    posture_tier: n.postureTier ?? null,
    posture_input_json: n.postureInput ? JSON.stringify(n.postureInput) : null,
    worst_open_problem: n.worstOpenProblem ?? null,
  };
}

export function rowToAsset(r: Rec): GNode {
  const node: GNode = {
    id: String(r["id"] ?? ""),
    kind: String(r["kind"] ?? "AI_AGENT") as NodeKind,
    name: String(r["name"] ?? ""),
    nativeType: (r["native_type"] as string | null) ?? undefined,
    cloudPlatform: (r["cloud"] as string | null) ?? undefined,
    region: (r["region"] as string | null) ?? undefined,
    status: (r["status"] as string | null) ?? undefined,
    firstSeen: (r["first_seen"] as string | null) ?? undefined,
    lastSeen: (r["last_seen"] as string | null) ?? undefined,
    isAccessibleFromInternet: parseTri(r["internet"]),
    isOpenToAllInternet: parseTri(r["open_internet"]),
    projects: parseAssetProjects(r["projects_json"]),
  };
  // The five tri-state flags, read the way `inactive` is read below: assigned only when the
  // cell carries a verdict, so an unevaluated flag stays absent instead of arriving as a
  // definite `false`. parseTri maps "true"/"false" to booleans and everything else — "null",
  // an empty cell, a pre-upgrade row — to null, which is what makes this backward compatible:
  // a ledger written before this change holds "false" and still reads back `false`, so no
  // tenant re-scores on upgrade. The correction arrives on the next full sync, the same
  // contract business_impact and posture_tier already ship under.
  const sensitiveData = parseTri(r["sensitive_data"]);
  if (sensitiveData !== null) node.hasSensitiveData = sensitiveData;
  const sensitiveAccess = parseTri(r["sensitive_access"]);
  if (sensitiveAccess !== null) node.hasAccessToSensitiveData = sensitiveAccess;
  const highPriv = parseTri(r["high_priv"]);
  if (highPriv !== null) node.hasHighPrivileges = highPriv;
  const adminPriv = parseTri(r["admin_priv"]);
  if (adminPriv !== null) node.hasAdminPrivileges = adminPriv;
  const guardrailMissing = parseTri(r["guardrail_missing"]);
  if (guardrailMissing !== null) node.guardrailMissing = guardrailMissing;
  const account = (r["account_id"] as string | null) ?? null;
  if (account) {
    node.cloudAccount = { id: account, name: String(r["account_name"] ?? account) };
  }
  // `?? null`, not a default: an asset Wiz reported no business impact for (or that
  // predates this column) must read back as undefined, never as a false "LBI".
  const businessImpact = (r["business_impact"] as string | null) ?? null;
  if (businessImpact) node.businessImpact = businessImpact;
  const severity = (r["severity"] as string | null) ?? null;
  if (severity) node.severity = severity as Severity;
  if (r["aars"] !== null && r["aars"] !== undefined) node.aars = Number(r["aars"]);
  // A ledger written before the rename still has an `aars_band` header holding a
  // `MINIMAL`; normalizeAarsSeverity reads either spelling, so no re-sync is needed.
  const aarsSev = normalizeAarsSeverity(r["aars_severity"] ?? r["aars_band"]);
  if (aarsSev) node.aarsSeverity = aarsSev;
  const pillars = parseJson<GNode["aarsPillars"] | null>(r["aars_pillars_json"], null);
  if (pillars) node.aarsPillars = pillars;
  const aarsInput = parseJson<GNode["aarsInput"] | null>(r["aars_input_json"], null);
  if (aarsInput) node.aarsInput = aarsInput;
  // Only when the cell holds a real number. A row written before this column existed reads
  // back undefined — unknown, not "the current rule" and not 0.
  const ruleVersion = Number(r["aars_rule_version"]);
  if (r["aars_rule_version"] !== "" && r["aars_rule_version"] !== null
      && r["aars_rule_version"] !== undefined && Number.isFinite(ruleVersion)) {
    node.aarsRuleVersion = ruleVersion;
  }
  const combos = String(r["combo_groups"] ?? "");
  if (combos) node.comboGroups = combos.split(",").filter(Boolean);
  const tags = parseJson<GNode["tags"] | null>(r["tags_json"], null);
  if (tags) node.tags = tags;
  const techCats = String(r["technology_categories"] ?? "").split(",").filter(Boolean);
  if (techCats.length) node.technologyCategories = techCats;
  const purpose = (r["identity_purpose"] as string | null) ?? null;
  if (purpose) node.identityPurpose = purpose;
  const analytics = parseJson<GNode["issueAnalytics"] | null>(r["issue_analytics_json"], null);
  if (analytics) node.issueAnalytics = analytics;
  const findingCount = r["data_finding_count"];
  if (findingCount !== null && findingCount !== undefined && String(findingCount) !== "") {
    node.dataFindingCount = Number(findingCount);
  }
  const findingSevs = parseJson<Record<string, number> | null>(r["data_findings_json"], null);
  if (findingSevs) node.dataFindingSeverities = findingSevs;
  const exposureLevel = (r["exposure_level"] as string | null) ?? null;
  if (exposureLevel) node.exposureLevel = exposureLevel;
  const portValidation = (r["port_validation"] as string | null) ?? null;
  if (portValidation) node.portValidation = portValidation;
  // Only when the cell actually holds a record. A ledger written before these columns
  // existed reads back as undefined, and conditionState falls through to the flags exactly
  // as it did before the exposure steps were added.
  const evidence = parseJson<GNode["exposureEvidence"] | null>(r["exposure_evidence_json"], null);
  if (evidence) node.exposureEvidence = evidence;
  // parseTri rather than parseBool: an empty cell is "not reported", and reading it as false
  // would report every identity in a pre-upgrade ledger as demonstrably in use.
  const inactive = parseTri(r["inactive"]);
  if (inactive !== null) node.inactive = inactive;
  const inactiveTimeframe = (r["inactive_timeframe"] as string | null) ?? null;
  if (inactiveTimeframe) node.inactiveTimeframe = inactiveTimeframe;
  const humanAccess = parseJson<GNode["humanAccess"] | null>(r["human_access_json"], null);
  if (humanAccess) node.humanAccess = humanAccess;
  // Set only when the cell holds something, like every other appended column: a ledger written
  // before these headers existed reads back as undefined, and the register prints "—" rather
  // than an empty-looking value that would read as "Wiz says there is no publisher".
  const displayName = (r["display_name"] as string | null) ?? null;
  if (displayName) node.displayName = displayName;
  const email = (r["email"] as string | null) ?? null;
  if (email) node.email = email;
  const publisher = (r["publisher"] as string | null) ?? null;
  if (publisher) node.publisher = publisher;
  const methods = String(r["discovery_methods"] ?? "").split(",").filter(Boolean);
  if (methods.length) node.discoveryMethods = methods;
  // Phase 6: absent reads as undefined, never a default — a synthetic node, or a row
  // written before this phase, must not read as tier 0 or as posture-decided.
  const postureTier = r["posture_tier"];
  if (postureTier !== null && postureTier !== undefined && String(postureTier) !== "") {
    node.postureTier = Number(postureTier);
  }
  const postureInput = parseJson<GNode["postureInput"] | null>(r["posture_input_json"], null);
  if (postureInput) node.postureInput = postureInput;
  const worstOpenProblem = (r["worst_open_problem"] as string | null) ?? null;
  if (worstOpenProblem) node.worstOpenProblem = worstOpenProblem;
  return node;
}

export function edgeToRow(e: GEdge): Rec {
  return {
    id: e.id,
    src: e.src,
    dst: e.dst,
    type: e.type,
    negated: boolCell(e.negated),
    access_type: e.accessType ?? null,
  };
}

export function rowToEdge(r: Rec): GEdge {
  const e: GEdge = {
    id: String(r["id"] ?? ""),
    src: String(r["src"] ?? ""),
    dst: String(r["dst"] ?? ""),
    type: String(r["type"] ?? "USES") as GEdge["type"],
  };
  if (parseBool(r["negated"])) e.negated = true;
  const access = (r["access_type"] as string | null) ?? null;
  if (access) e.accessType = access as GEdge["accessType"];
  return e;
}

export function issueToRow(i: IssueRow): Rec {
  return {
    id: i.id,
    rule_id: i.ruleId,
    rule_name: i.ruleName,
    combo_group: i.comboGroup,
    native_severity: i.nativeSeverity,
    adjusted_severity: i.adjustedSeverity,
    status: i.status,
    asset_id: i.assetId,
    asset_name: i.assetName,
    region: i.region ?? null,
    account: i.account ?? null,
    projects_json: JSON.stringify(i.projects ?? []),
    frameworks_json: JSON.stringify(i.frameworks ?? {}),
    justification: i.justification ?? null,
    created_at: i.createdAt ?? null,
    due_at: i.dueAt ?? null,
    resolution_recommendation: i.resolutionRecommendation ?? null,
    remediation: i.remediation ?? null,
    issue_type: i.issueType ?? null,
    updated_at: i.updatedAt ?? null,
    resolved_at: i.resolvedAt ?? null,
    resolution_reason: i.resolutionReason ?? null,
    resolved_by: i.resolvedBy ?? null,
    assignee: i.assignee ?? null,
    // Comma-joined, matching combo_groups / technology_categories on ai_assets; the
    // _json suffix is reserved for structured values.
    environments: (i.environments ?? []).join(","),
    validated_exploitable: boolCell(i.validatedAsExploitable),
    business_impact: i.businessImpact ?? null,
    entity_status: i.entityStatus ?? null,
    subscription_id: i.subscriptionId ?? null,
    ignore_note: i.ignoreNote ?? null,
    ignore_expired_at: i.ignoreExpiredAt ?? null,
    ticket_urls: (i.ticketUrls ?? []).join(","),
    ai_verdict: i.aiVerdict ?? null,
    ai_recommended_severity: i.aiRecommendedSeverity ?? null,
    // Phase 4: the Problem/Decision-Vector verdict. `?? null`, never a default: a resolved
    // issue (or one synced before this phase) carries none of the three, and reading that
    // as some fallback outcome would assert a decision nobody made.
    problem_outcome: i.problemOutcome ?? null,
    problem_input_json: i.problemInput ? JSON.stringify(i.problemInput) : null,
    problem_rule_version: i.problemRuleVersion ?? null,
    // Joined, not JSON: a short id list reads in the sheet, and nothing needs to round-trip
    // a structure here. Empty string when attribution found nothing, which rowToIssue reads
    // back as an empty ARRAY rather than as absent — "we looked and found none".
    attributed_asset_ids: (i.attributedAssetIds ?? []).join(","),
    attribution_hop: i.attributionHop ?? null,
  };
}

export function rowToIssue(r: Rec): IssueRow {
  const issue: IssueRow = {
    id: String(r["id"] ?? ""),
    ruleId: String(r["rule_id"] ?? ""),
    ruleName: String(r["rule_name"] ?? ""),
    // A ledger written before the Other bucket existed holds "" for every unclassified
    // issue. Without this fallback those rows keep falling out of every rollup until
    // someone happens to re-sync.
    comboGroup: String(r["combo_group"] ?? "") || OTHER_GROUP_ID,
    nativeSeverity: String(r["native_severity"] ?? "UNKNOWN") as Severity,
    adjustedSeverity: String(r["adjusted_severity"] ?? "UNKNOWN") as Severity,
    status: String(r["status"] ?? "OPEN"),
    assetId: String(r["asset_id"] ?? ""),
    assetName: String(r["asset_name"] ?? ""),
    region: (r["region"] as string | null) ?? undefined,
    account: (r["account"] as string | null) ?? undefined,
    projects: parseJson<string[]>(r["projects_json"], []),
    frameworks: parseJson<IssueRow["frameworks"]>(r["frameworks_json"], {}),
    justification: (r["justification"] as string | null) ?? undefined,
    createdAt: (r["created_at"] as string | null) ?? undefined,
    dueAt: (r["due_at"] as string | null) ?? undefined,
    resolutionRecommendation: (r["resolution_recommendation"] as string | null) ?? undefined,
    remediation: (r["remediation"] as string | null) ?? undefined,
    issueType: (r["issue_type"] as string | null) ?? undefined,
    updatedAt: (r["updated_at"] as string | null) ?? undefined,
    resolvedAt: (r["resolved_at"] as string | null) ?? undefined,
    resolutionReason: (r["resolution_reason"] as string | null) ?? undefined,
    resolvedBy: (r["resolved_by"] as string | null) ?? undefined,
    assignee: (r["assignee"] as string | null) ?? undefined,
    businessImpact: (r["business_impact"] as string | null) ?? undefined,
    entityStatus: (r["entity_status"] as string | null) ?? undefined,
    subscriptionId: (r["subscription_id"] as string | null) ?? undefined,
    ignoreNote: (r["ignore_note"] as string | null) ?? undefined,
    ignoreExpiredAt: (r["ignore_expired_at"] as string | null) ?? undefined,
    aiVerdict: (r["ai_verdict"] as string | null) ?? undefined,
    aiRecommendedSeverity:
      ((r["ai_recommended_severity"] as string | null) ?? undefined) as Severity | undefined,
  };
  // Set only when non-empty, so a round trip preserves "not captured" as undefined
  // rather than promoting it to an empty array or a false.
  const environments = String(r["environments"] ?? "").split(",").filter(Boolean);
  if (environments.length) issue.environments = environments;
  const ticketUrls = String(r["ticket_urls"] ?? "").split(",").filter(Boolean);
  if (ticketUrls.length) issue.ticketUrls = ticketUrls;
  if (parseBool(r["validated_exploitable"])) issue.validatedAsExploitable = true;
  // Attribution. The HOP is what says whether the fold ran: a row synced before attribution
  // existed carries neither, and must read back as undefined so `issuesByAssetFor` falls back
  // to the raw assetId rather than treating the row as reaching no AI asset at all. An empty
  // id list WITH a hop is the genuine "we looked and found none" — a different fact, and the
  // reason these two are read together rather than the list alone deciding.
  const attributionHop = (r["attribution_hop"] as string | null) ?? null;
  if (attributionHop === "direct" || attributionHop === "RUNS_AS" || attributionHop === "none") {
    issue.attributionHop = attributionHop;
    issue.attributedAssetIds = String(r["attributed_asset_ids"] ?? "").split(",").filter(Boolean);
  }
  // Phase 4: absent reads as undefined, never a default — a row this app synced before the
  // verdict existed (or a resolved issue that never got one) must not read as decided.
  const problemOutcome = (r["problem_outcome"] as string | null) ?? null;
  if (problemOutcome) issue.problemOutcome = problemOutcome;
  const problemInput = parseJson<ProblemVerdictInput | null>(r["problem_input_json"], null);
  if (problemInput) issue.problemInput = problemInput;
  const problemRuleVersion = r["problem_rule_version"];
  if (
    problemRuleVersion !== null &&
    problemRuleVersion !== undefined &&
    String(problemRuleVersion) !== ""
  ) {
    issue.problemRuleVersion = Number(problemRuleVersion);
  }
  return issue;
}

/**
 * A Sheets cell holds at most 50,000 characters and rejects the whole write past that.
 * `opa_policy` is the only column here that carries an unbounded document (a rule's full
 * Rego), so it is the only one clamped — losing the tail of one policy is recoverable,
 * failing the sync's findings write is not. The marker makes a clamped value legible
 * rather than mysteriously truncated.
 */
const CELL_MAX = 50000;
const CLAMP_MARKER = "\n… truncated for storage";
function cell(v: string | undefined): string | null {
  if (v === undefined) return null;
  if (v.length <= CELL_MAX) return v;
  return v.slice(0, CELL_MAX - CLAMP_MARKER.length) + CLAMP_MARKER;
}

/**
 * The read side of an optional text column, as `(r[k] as string | null) ?? undefined`
 * written once instead of two dozen times. fromCell already maps an empty cell to null;
 * a column a legacy row never had reads as undefined. Both mean "not recorded".
 */
function optional(v: unknown): string | undefined {
  return v === null || v === undefined || v === "" ? undefined : String(v);
}

export function findingToRow(f: FindingRow): Rec {
  return {
    id: f.id,
    resource_id: f.resourceId,
    rule_short_id: f.ruleShortId,
    severity: f.severity,
    remediation: cell(f.remediation),
    framework_codes: (f.frameworkCodes ?? []).join(","),

    name: f.name ?? null,
    status: f.status ?? null,
    result: f.result ?? null,
    // Tri-state, like the internet flag: "null" for a response that never carried the
    // field. isOpenGap only tombstones on an explicit true, so absent must not read false.
    deleted: triCell(f.deleted),
    first_seen_at: f.firstSeenAt ?? null,
    analyzed_at: f.analyzedAt ?? null,

    rule_id: f.ruleId ?? null,
    rule_graph_id: f.ruleGraphId ?? null,
    rule_name: f.ruleName ?? null,
    rule_description: cell(f.ruleDescription),
    remediation_instructions: cell(f.remediationInstructions),
    opa_policy: cell(f.opaPolicy),
    risks_json: f.risks && f.risks.length ? JSON.stringify(f.risks) : null,
    threats_json: f.threats && f.threats.length ? JSON.stringify(f.threats) : null,

    resource_name: f.resourceName ?? null,
    resource_type: f.resourceType ?? null,
    resource_status: f.resourceStatus ?? null,
    target_external_id: f.targetExternalId ?? null,
    source: f.source ?? null,

    subscription_id: f.subscriptionId ?? null,
    subscription_name: f.subscriptionName ?? null,
    cloud_provider: f.cloudProvider ?? null,
    projects_json: f.projects && f.projects.length ? JSON.stringify(f.projects) : null,
    business_impact: f.businessImpact ?? null,

    ignore_rule_ids_json:
      f.ignoreRuleIds && f.ignoreRuleIds.length ? JSON.stringify(f.ignoreRuleIds) : null,
    iac_finding_ids_json:
      f.iacFindingIds && f.iacFindingIds.length ? JSON.stringify(f.iacFindingIds) : null,

    // Phase 4: the Problem/Decision-Vector verdict — same three columns, same `?? null`
    // convention, as ai_issues above.
    problem_outcome: f.problemOutcome ?? null,
    problem_input_json: f.problemInput ? JSON.stringify(f.problemInput) : null,
    problem_rule_version: f.problemRuleVersion ?? null,
  };
}

export function rowToFinding(r: Rec): FindingRow {
  const finding: FindingRow = {
    id: String(r["id"] ?? ""),
    resourceId: String(r["resource_id"] ?? ""),
    ruleShortId: String(r["rule_short_id"] ?? ""),
    severity: String(r["severity"] ?? "UNKNOWN") as Severity,
    remediation: optional(r["remediation"]),
    frameworkCodes: String(r["framework_codes"] ?? "").split(",").filter(Boolean),

    name: optional(r["name"]),
    status: optional(r["status"]),
    result: optional(r["result"]),
    firstSeenAt: optional(r["first_seen_at"]),
    analyzedAt: optional(r["analyzed_at"]),

    ruleId: optional(r["rule_id"]),
    ruleGraphId: optional(r["rule_graph_id"]),
    ruleName: optional(r["rule_name"]),
    ruleDescription: optional(r["rule_description"]),
    remediationInstructions: optional(r["remediation_instructions"]),
    opaPolicy: optional(r["opa_policy"]),
    risks: parseJson<string[]>(r["risks_json"], []),
    threats: parseJson<string[]>(r["threats_json"], []),

    resourceName: optional(r["resource_name"]),
    resourceType: optional(r["resource_type"]),
    resourceStatus: optional(r["resource_status"]),
    targetExternalId: optional(r["target_external_id"]),
    source: optional(r["source"]),

    subscriptionId: optional(r["subscription_id"]),
    subscriptionName: optional(r["subscription_name"]),
    cloudProvider: optional(r["cloud_provider"]),
    projects: parseJson<FindingRow["projects"]>(r["projects_json"], []),
    businessImpact: optional(r["business_impact"]),

    ignoreRuleIds: parseJson<string[]>(r["ignore_rule_ids_json"], []),
    iacFindingIds: parseJson<string[]>(r["iac_finding_ids_json"], []),
  };
  // Absent stays absent: a legacy row has no `deleted` cell at all, and reading that as
  // `false` would assert a tombstone check that never ran.
  const deleted = parseTri(r["deleted"]);
  if (deleted !== null) finding.deleted = deleted;
  // Phase 4: same absent-reads-undefined contract as rowToIssue's block above.
  const problemOutcome = (r["problem_outcome"] as string | null) ?? null;
  if (problemOutcome) finding.problemOutcome = problemOutcome;
  const problemInput = parseJson<ProblemVerdictInput | null>(r["problem_input_json"], null);
  if (problemInput) finding.problemInput = problemInput;
  const problemRuleVersion = r["problem_rule_version"];
  if (
    problemRuleVersion !== null &&
    problemRuleVersion !== undefined &&
    String(problemRuleVersion) !== ""
  ) {
    finding.problemRuleVersion = Number(problemRuleVersion);
  }
  return finding;
}

export function dataFindingToRow(f: DataFindingRow): Rec {
  return {
    id: f.id,
    resource_id: f.resourceId,
    name: f.name,
    severity: f.severity,
  };
}

export function rowToDataFinding(r: Rec): DataFindingRow {
  return {
    id: String(r["id"] ?? ""),
    resourceId: String(r["resource_id"] ?? ""),
    name: String(r["name"] ?? ""),
    severity: String(r["severity"] ?? "UNKNOWN") as Severity,
  };
}

// ------------------------------------------------- compliance framework posture

export function frameworkToRow(f: FrameworkRow): Rec {
  return {
    id: f.id,
    name: f.name,
    description: f.description ?? "",
    builtin: f.builtin,
    enabled: f.enabled,
    policy_types: (f.policyTypes ?? []).join(","),
  };
}

export function rowToFramework(r: Rec): FrameworkRow {
  return {
    id: String(r["id"] ?? ""),
    name: String(r["name"] ?? ""),
    description: String(r["description"] ?? "") || undefined,
    builtin: r["builtin"] === true || r["builtin"] === "TRUE" || r["builtin"] === "true",
    enabled: r["enabled"] === true || r["enabled"] === "TRUE" || r["enabled"] === "true",
    policyTypes: String(r["policy_types"] ?? "").split(",").filter(Boolean),
    // Never stored. Resolved against the settings selection by the API model, which is the
    // only place that knows.
    selected: false,
  };
}

export function configRuleToRow(r: ConfigRuleRow): Rec {
  return {
    id: r.id,
    short_id: r.shortId,
    name: r.name,
    subject_entity_type: r.subjectEntityType ?? "",
    external_refs: (r.externalRefs ?? []).join(","),
  };
}

export function rowToConfigRule(r: Rec): ConfigRuleRow {
  return {
    id: String(r["id"] ?? ""),
    shortId: String(r["short_id"] ?? ""),
    name: String(r["name"] ?? ""),
    subjectEntityType: String(r["subject_entity_type"] ?? "") || undefined,
    externalRefs: String(r["external_refs"] ?? "").split(",").filter(Boolean),
  };
}

export function identityFindingToRow(f: IdentityFindingRow): Rec {
  return {
    id: f.id,
    resource_id: f.resourceId,
    resource_name: f.resourceName ?? null,
    rule_id: f.ruleId ?? null,
    rule_short_id: f.ruleShortId,
    rule_name: f.ruleName ?? null,
    severity: f.severity,
    status: f.status ?? null,
    result: f.result ?? null,
    first_seen_at: f.firstSeenAt ?? null,
    analyzed_at: f.analyzedAt ?? null,
    remediation: f.remediation ?? null,
    hygiene: f.hygiene,
  };
}

export function rowToIdentityFinding(r: Rec): IdentityFindingRow {
  return {
    id: String(r["id"] ?? ""),
    resourceId: String(r["resource_id"] ?? ""),
    resourceName: (r["resource_name"] as string | null) ?? undefined,
    ruleId: (r["rule_id"] as string | null) ?? undefined,
    ruleShortId: String(r["rule_short_id"] ?? ""),
    ruleName: (r["rule_name"] as string | null) ?? undefined,
    severity: (String(r["severity"] ?? "UNKNOWN")) as Severity,
    status: (r["status"] as string | null) ?? undefined,
    result: (r["result"] as string | null) ?? undefined,
    firstSeenAt: (r["first_seen_at"] as string | null) ?? undefined,
    analyzedAt: (r["analyzed_at"] as string | null) ?? undefined,
    remediation: (r["remediation"] as string | null) ?? undefined,
    // Defaulted rather than validated: the column is written by this app from the matcher's
    // verdict, so an unrecognised value means a hand-edited cell, and MFA is the reading that
    // over-reports rather than under-reports.
    hygiene: (String(r["hygiene"] ?? "MFA") === "DORMANT" ? "DORMANT" : "MFA"),
  };
}

/**
 * A posture cell's percentage, round-tripped through a Sheets cell.
 *
 * The empty string is null, NOT zero. A blank cell means Wiz sent no posture — the
 * emptyPostureReason column beside it says why — and reading it as 0 would turn "nothing
 * to assess" into "everything failed", which is the exact inversion this whole column pair
 * exists to prevent.
 */
function cellPct(v: unknown): number | null {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

export function postureToRow(p: PostureRow): Rec {
  return {
    framework_id: p.frameworkId,
    level: p.level,
    category_external_id: p.categoryExternalId ?? "",
    subcategory_external_id: p.subcategoryExternalId ?? "",
    node_id: p.nodeId ?? "",
    title: p.title,
    description: p.description ?? "",
    // Null stays empty rather than becoming 0 — see cellPct.
    posture_pct: p.posturePct === null ? "" : p.posturePct,
    pass_count: p.passCount,
    fail_count: p.failCount,
    pass_subcategory_count: p.passSubCategoryCount ?? "",
    fail_subcategory_count: p.failSubCategoryCount ?? "",
    empty_posture_reason: p.emptyPostureReason ?? "",
    assessment_scope: p.assessmentScope ?? "",
    mapping_rationale: p.mappingRationale ?? "",
    tags_json: p.tags && p.tags.length ? JSON.stringify(p.tags) : "",
  };
}

export function rowToPosture(r: Rec): PostureRow {
  const num = (v: unknown): number => {
    const n = Number(v ?? 0);
    return isFinite(n) ? n : 0;
  };
  const optNum = (v: unknown): number | undefined =>
    v === "" || v === null || v === undefined ? undefined : num(v);
  return {
    frameworkId: String(r["framework_id"] ?? ""),
    level: (String(r["level"] ?? "subcategory") as PostureRow["level"]),
    categoryExternalId: String(r["category_external_id"] ?? "") || undefined,
    subcategoryExternalId: String(r["subcategory_external_id"] ?? "") || undefined,
    nodeId: String(r["node_id"] ?? "") || undefined,
    title: String(r["title"] ?? ""),
    description: String(r["description"] ?? "") || undefined,
    posturePct: cellPct(r["posture_pct"]),
    passCount: num(r["pass_count"]),
    failCount: num(r["fail_count"]),
    passSubCategoryCount: optNum(r["pass_subcategory_count"]),
    failSubCategoryCount: optNum(r["fail_subcategory_count"]),
    emptyPostureReason: String(r["empty_posture_reason"] ?? "") || null,
    assessmentScope: String(r["assessment_scope"] ?? "") || undefined,
    mappingRationale: String(r["mapping_rationale"] ?? "") || undefined,
    tags: parseJson(r["tags_json"], []) as { key: string; value: string }[],
  };
}

export function frameworkPolicyToRow(p: FrameworkPolicyRow): Rec {
  return {
    framework_id: p.frameworkId,
    category_external_id: p.categoryExternalId,
    subcategory_external_id: p.subcategoryExternalId,
    policy_id: p.policyId,
    policy_kind: p.policyKind,
    short_id: p.shortId ?? "",
    name: p.name,
    severity: p.severity,
    enabled: p.enabled ?? "",
    builtin: p.builtin ?? "",
    pass_count: p.passCount,
    fail_count: p.failCount,
    assessed_count: p.assessedCount,
    rejected_count: p.rejectedCount,
    no_resource_to_assess: p.noResourceToAssess,
    target_native_type: p.targetNativeType ?? "",
    subject_entity_type: p.subjectEntityType ?? "",
    cloud_provider: p.cloudProvider ?? "",
    has_auto_remediation: p.hasAutoRemediation ?? "",
  };
}

export function rowToFrameworkPolicy(r: Rec): FrameworkPolicyRow {
  const num = (v: unknown): number => {
    const n = Number(v ?? 0);
    return isFinite(n) ? n : 0;
  };
  const optBool = (v: unknown): boolean | undefined =>
    v === "" || v === null || v === undefined
      ? undefined
      : v === true || v === "TRUE" || v === "true";
  return {
    frameworkId: String(r["framework_id"] ?? ""),
    categoryExternalId: String(r["category_external_id"] ?? ""),
    subcategoryExternalId: String(r["subcategory_external_id"] ?? ""),
    policyId: String(r["policy_id"] ?? ""),
    policyKind: (String(r["policy_kind"] ?? "CONTROL") as FrameworkPolicyRow["policyKind"]),
    shortId: String(r["short_id"] ?? "") || undefined,
    name: String(r["name"] ?? ""),
    severity: String(r["severity"] ?? "UNKNOWN") as Severity,
    enabled: optBool(r["enabled"]),
    builtin: optBool(r["builtin"]),
    passCount: num(r["pass_count"]),
    failCount: num(r["fail_count"]),
    assessedCount: num(r["assessed_count"]),
    rejectedCount: num(r["rejected_count"]),
    noResourceToAssess:
      r["no_resource_to_assess"] === true ||
      r["no_resource_to_assess"] === "TRUE" ||
      r["no_resource_to_assess"] === "true",
    targetNativeType: String(r["target_native_type"] ?? "") || undefined,
    subjectEntityType: String(r["subject_entity_type"] ?? "") || undefined,
    cloudProvider: String(r["cloud_provider"] ?? "") || undefined,
    hasAutoRemediation: optBool(r["has_auto_remediation"]),
  };
}

// ----------------------------------------------------------------------- persist

export interface SyncMeta {
  syncId: string;
  mode: "dry-run" | "live";
  startedAt: string;
  apiCalls: number;
}

/**
 * Enrich and commit one sync. Caller holds the script lock. Returns the enriched
 * document (the getGraph read model, ISSUE nodes included).
 */
export function persistSync(
  rawDoc: GraphDoc,
  issues: IssueRow[],
  hints: AarsHints | undefined,
  meta: SyncMeta,
  now?: number,
  findings: FindingRow[] = [],
  dataFindings: DataFindingRow[] = [],
  frameworks: FrameworkRow[] = [],
  posture: PostureRow[] = [],
  frameworkPolicies: FrameworkPolicyRow[] = [],
  // One object rather than three more positionals. This signature is already ten arguments
  // long and the next caller to get the order wrong would do it silently; these three arrived
  // together and are read together, so they travel together.
  extras: {
    configRules?: ConfigRuleRow[];
    identityFindings?: IdentityFindingRow[];
    effectiveAccess?: EffectiveAccessRow[];
  } = {},
): GraphDoc {
  const { version: ruleVersion, rule } = settingsStore.getAarsRule();
  // Counts first: pillar C prices them, so they have to be on the nodes before enrichment.
  const counted = withDataFindingCounts(rawDoc, dataFindings);
  // Then the exposure join, for the same reason one step further out: pillar D reads
  // internet reachability through riskConditions, which now reads the topology this fold
  // puts on the asset. Both run before enrichGraphDoc because enrichment is where the score
  // is computed, and a score computed from an un-joined node would price a hosted agent as
  // UNDETERMINED forever.
  const exposed = withExposureEvidence(counted);
  // Human reach, same reasoning one step further: it is an edge fact that the tab-direct read
  // models can never see, so it is joined onto the asset before anything reads a number off
  // one. It prices no pillar, so its position relative to enrichment is not load-bearing —
  // it sits here to keep the "join what was synced, then enrich" order true of the whole
  // sequence rather than of two thirds of it.
  const reachable = withHumanAccess(exposed, {
    identityFindings: extras.identityFindings ?? [],
    effectiveAccess: extras.effectiveAccess ?? [],
  });
  // Attribution BEFORE enrichment, because enrichment is what reads it: `issuesByAssetFor`
  // joins on `attributedAssetIds`, and a score computed from un-attributed issues would charge
  // the service account and nothing else — which is the state this fold exists to end. It runs
  // against `reachable`, the last doc before enrichment, so the RUNS_AS edges it walks are the
  // ones the sync actually persisted.
  //
  // Unconditional, exactly like the exposure and human-reach joins above it: the fold only
  // RECORDS where an issue could be attributed. Whether anything is scored from that is the
  // rule's decision (`AarsRule.issueAttribution`, `ProblemRule.attributionJoin`), and both
  // default to `direct`. Gating the fold itself on the rule would mean a tenant that later
  // flips the knob has no attribution on its ledger to flip TO, and would need a full re-sync
  // to get one — so the evidence is collected always and priced on request.
  const attributedIssues = withIssueAttribution(reachable, issues);
  const enriched = enrichGraphDoc(reachable, attributedIssues, hints, rule);

  // The problem/decision-vector verdict, BESIDE the AARS enrichment above, never inside
  // it — see withProblemVerdicts's own comment for why the two must stay independently
  // re-runnable. Runs against `enriched.nodes` rather than `reachable`'s, so a row's
  // `mission` axis reads the SAME freshly-recomputed `businessImpact` AARS's pillars do,
  // and its `exposure` axis reads the same exposureEvidence/humanAccess join both already
  // carry through unchanged from the two `with*` folds above.
  const { version: problemRuleVersion, rule: problemRule } = settingsStore.getProblemRule();
  const { issues: decidedIssues, findings: decidedFindings } = withProblemVerdicts(
    enriched,
    attributedIssues,
    findings,
    problemRule,
    problemRuleVersion,
  );

  // Phase 6: the Asset Posture Tier, a THIRD independent fold — see withPostureTiers's own
  // comment. Runs against the already-DECIDED issues/findings (not the raw synced ones), so
  // `worstOpenProblem` folds from the same verdicts the register shows, and against
  // `enriched.nodes` for the same "freshest businessImpact / exposure join" reason
  // `withProblemVerdicts` does above it.
  const { version: postureRuleVersion, rule: postureRule } = settingsStore.getPostureRule();
  const posturedRaw = withPostureTiers(enriched, decidedIssues, decidedFindings, postureRule);

  // Stamp the rule that produced these scores onto every node, tab and snapshot alike. A sync
  // scores the whole register in one pass, so this is also what HEALS a register left holding
  // two versions by a scoped rescore: after a sync there is exactly one version again.
  const postured: GraphDoc = {
    ...posturedRaw,
    nodes: posturedRaw.nodes.map((n) => ({ ...n, aarsRuleVersion: ruleVersion })),
  };

  // Tabs hold the real (non-synthetic) nodes; ISSUE nodes are derivable from ai_issues.
  const assetNodes = realNodes(postured.nodes);
  const assetEdges = postured.edges.filter((e) => e.type !== "HAS_ISSUE");
  overwrite(TABS.assets, assetNodes.map(assetToRow));
  // UNGUARDED ON PURPOSE, unlike the framework/posture writes forty lines down. Those are
  // guarded because their steps are per-framework and genuinely optional per tenant, so an
  // empty result there means "not asked" and blanking would lose a good answer.
  //
  // Here an empty result means the six graph traversals produced nothing, and that is a
  // finding — the most important one this app can surface. Guarding it would carry the
  // previous sync's edges forward through a collection failure and make the failure invisible
  // for as long as one old sync happened to have worked, which is the one outcome worth
  // avoiding more than the data loss. So the wipe is real and deliberate: a zero-edge sync
  // erases the last one's edges, and the answer to that is to make the emptiness LOUD
  // (JobParams.stepRows, and the reach panel's Enriched stage) rather than to hide it.
  overwrite(TABS.edges, assetEdges.map(edgeToRow));
  overwrite(TABS.issues, decidedIssues.map(issueToRow));
  overwrite(TABS.findings, decidedFindings.map(findingToRow));
  overwrite(TABS.dataFindings, dataFindings.map(dataFindingToRow));

  // Compliance-framework posture. Written like every other data tab — wholesale, BEFORE
  // the history row — so a sync that dies here leaves no commit record and the previous
  // posture stands.
  //
  // Guarded on emptiness, unlike the tabs above: the posture steps are optional AND
  // per-framework, so a tenant that rejects them (or an operator who has selected no
  // framework) would otherwise have last sync's posture blanked by a battery that never
  // asked. The other tabs are always queried, so empty there really means empty.
  if (frameworks.length) overwrite(TABS.frameworks, frameworks.map(frameworkToRow));
  if (posture.length) overwrite(TABS.frameworkPosture, posture.map(postureToRow));
  if (frameworkPolicies.length) {
    overwrite(TABS.frameworkPolicies, frameworkPolicies.map(frameworkPolicyToRow));
  }
  // Conditional for the same reason the three above are, and for one more: CONFIG_RULES is
  // SKIPPED BY DESIGN on most syncs (the monthly freshness gate), so an unconditional
  // overwrite would delete the catalogue every day and restore it once a month.
  const configRules = extras.configRules ?? [];
  if (configRules.length) overwrite(TABS.configRules, configRules.map(configRuleToRow));
  // NOT conditional. This one is queried on every sync, so empty really does mean the tenant
  // has no open identity-hygiene findings — and a register still saying three people lack MFA
  // after they have all fixed it is worse than an empty one.
  overwrite(TABS.identityFindings, (extras.identityFindings ?? []).map(identityFindingToRow));

  const snapshotRef = writeGraphSnapshot(postured);

  // Commit record LAST.
  appendRows(TABS.syncHistory, [{
    sync_id: meta.syncId,
    started_at: meta.startedAt,
    finished_at: nowIso(now),
    status: "SUCCESS",
    mode: meta.mode,
    node_count: postured.nodes.length,
    edge_count: postured.edges.length,
    issue_count: issues.length,
    api_calls: meta.apiCalls,
    snapshot_ref: snapshotRef,
    error: null,
    // The AARS distribution at this sync — the only record of it, since the snapshot
    // this row points at is overwritten by the next sync. Feeds the inventory trend.
    aars_severity_json: JSON.stringify(countAarsSeverities(postured.nodes)),
    // Which scoring model produced that distribution: counts from two versions are not
    // on the same scale, and the trend chart says so rather than drawing a false step.
    aars_rule_version: ruleVersion,
    // The outcome distribution this sync decided, over BOTH decided populations at once —
    // mirrors aars_severity_json exactly, one row down.
    problem_outcome_json: JSON.stringify(countProblemOutcomes([...decidedIssues, ...decidedFindings])),
    // Which problem rule produced it — mirrors aars_rule_version, and moves independently
    // of it, exactly as the two settings keys (aars_rule / problem_rule) do.
    problem_rule_version: problemRuleVersion,
    // The same two distributions per project, so the inventory trend can follow the sidebar
    // from here forward — the one figure in the app that had to refuse it. Written from the
    // SAME populations as the two register-wide columns above (`postured.nodes`, and the two
    // decided sets), so the scoped series and the whole-register series can never be counting
    // different things.
    //
    // Null when the map would not fit in a cell (encodeProjectTotals), and null is a value
    // this row is allowed to carry: the register-wide totals beside it are unaffected, and a
    // scoped series with a missing point says so rather than inventing one. A trend
    // refinement must not be able to fail a commit.
    project_totals_json: encodeProjectTotals(
      countProjectTotals(postured.nodes, [...decidedIssues, ...decidedFindings]),
    ),
    // The posture distribution, WITH its scope split — the third model's series, and the one
    // that did not exist. `censusPostureTiers` reports tiers plus `withheld` (in scope, not yet
    // measured) plus `outOfScope` (this lattice does not describe the kind) plus the total, so
    // every share it feeds has its own denominator travelling beside it.
    //
    // Counted over `postured.nodes` — the same population the two columns above read — so the
    // three series can never be describing different landscapes.
    posture_tier_json: JSON.stringify(censusPostureTiers(postured.nodes)),
    // Which posture rule produced it; moves independently of the other two, exactly as the
    // three settings keys do.
    posture_rule_version: postureRuleVersion,
    // The normalizer generation these readings were collected under. A change here means the
    // stored facts changed MEANING, which Recompute cannot repair — see DERIVATION_VERSION.
    // Recorded per sync so the trend can mark the break rather than let a legitimate collapse
    // in the tiered population read as risk improving.
    derivation_version: DERIVATION_VERSION,
  }]);
  settingsStore.setScoredRuleVersion(ruleVersion);
  settingsStore.setDecidedRuleVersion(problemRuleVersion);
  settingsStore.setComputedPostureVersion(postureRuleVersion);
  // Stamped from commit() ONLY — never from rescoreInventory or redecideProblems. Those
  // re-price facts already in the sheet; this records how those facts got there, and a
  // rescore does not change that. Stamping it there would clear a staleness warning that a
  // rescore cannot actually resolve.
  settingsStore.setSyncDerivationVersion(DERIVATION_VERSION);
  commit();
  return postured;
}

/**
 * Re-score every persisted asset under the current rule, without touching the Wiz API:
 * every input the score needs is already on the tabs (issue framework codes, finding
 * framework codes, and the asset's own CIEM/DSPM flags). Rewrites the assets tab and the
 * Drive snapshot, and does NOT append a sync_history row — a rescore is not a sync, and
 * inventing a commit record would put a point on the trend for a landscape that never moved.
 *
 * Caller holds the script lock.
 */
export function rescoreInventory(): {
  version: number;
  assetCount: number;
  counts: Record<string, number>;
  /** The project the write was limited to, "" when the whole register was rescored. */
  scope: string;
  /** Assets left on an older rule — non-zero only after a scoped rescore. */
  untouched: number;
} {
  const { version, rule } = settingsStore.getAarsRule();
  const view = settingsStore.getProjectView();
  const enriched = enrichFromTabs(rule);
  if (!enriched) {
    settingsStore.setScoredRuleVersion(version);
    return { version, assetCount: 0, counts: countAarsSeverities([]), scope: view, untouched: 0 };
  }

  // Same split as persistSync: the tabs hold the real nodes, ISSUE nodes stay derivable.
  const rescored = realNodes(enriched.nodes).map(
    (n) => ({ ...n, aarsRuleVersion: version }) as GNode,
  );

  // ENRICH WIDE, WRITE NARROW. The re-derivation has to run over the whole register even
  // when the write will not: pillar inputs cross assets (host-exposure inheritance is the
  // clearest case), so enriching only the in-view subset would score those assets against a
  // truncated graph and produce numbers that differ from a full rescore of the same rule.
  const kept = view ? rescored.filter((n) => inProject(n.projects, view)) : rescored;
  const untouched = rescored.length - kept.length;

  let assetNodes: GNode[];
  let doc = enriched;
  if (!view) {
    assetNodes = rescored;
  } else {
    // Merge: out-of-view rows keep the score AND the version they already had. Reading the
    // prior rows before the write is what makes this a merge rather than a partial wipe.
    const priorById = new Map(loadAssets().map((a) => [a.id, a]));
    const keptIds = new Set(kept.map((n) => n.id));
    assetNodes = rescored.map((n) => (keptIds.has(n.id) ? n : priorById.get(n.id) ?? n));
    // The snapshot has to agree with the tab. `registerScopeDiagnostic` treats a snapshot
    // that disagrees with the ledger as a finding in its own right, so a merged tab and a
    // fully-rescored snapshot would be a self-inflicted one.
    const mergedById = new Map(assetNodes.map((n) => [n.id, n]));
    doc = {
      ...enriched,
      nodes: enriched.nodes.map((n) => mergedById.get(n.id) ?? n),
    };
  }

  overwrite(TABS.assets, assetNodes.map(assetToRow));
  writeGraphSnapshot(doc);

  // The global marker is now the OLDEST version any asset carries, not simply the version
  // just written. It drives the "scores are stale" badge, and after a scoped rescore the
  // register really is partly behind — reporting the new version would say the opposite.
  // `undefined` (a row predating the column) is unknown and cannot be assumed current, so it
  // holds the marker back too.
  settingsStore.setScoredRuleVersion(oldestRuleVersion(assetNodes, version));
  commit();
  return {
    version,
    assetCount: kept.length,
    counts: countAarsSeverities(doc.nodes),
    scope: view,
    untouched,
  };
}

/**
 * The oldest rule version present, or `fallback` on an empty register.
 *
 * An asset with no recorded version pins this to 0: it was scored by SOME rule nobody wrote
 * down, which is exactly the state the staleness badge should keep flagging until a sync or a
 * full rescore stamps every row.
 */
function oldestRuleVersion(nodes: readonly GNode[], fallback: number): number {
  if (!nodes.length) return fallback;
  let oldest = Infinity;
  for (const n of nodes) oldest = Math.min(oldest, n.aarsRuleVersion ?? 0);
  return Number.isFinite(oldest) ? oldest : fallback;
}

/** How many assets sit at each AARS rule version — empty until a scoped rescore mixes them. */
export function aarsVersionSpread(): Array<{ version: number | null; assets: number }> {
  const byVersion = new Map<number | null, number>();
  for (const a of loadAssets()) {
    const v = a.aarsRuleVersion ?? null;
    byVersion.set(v, (byVersion.get(v) ?? 0) + 1);
  }
  return [...byVersion.entries()]
    .map(([version, assets]) => ({ version, assets }))
    // Newest first, with the unstamped rows last — they are the least current thing here.
    .sort((x, y) => (y.version ?? -1) - (x.version ?? -1));
}

/**
 * Score every persisted asset under an arbitrary rule and return the result WITHOUT
 * writing anything — what the AARS Rules page previews before you commit to it. Shares
 * `enrichFromTabs` with the recompute, so the preview is the recompute, minus the writes.
 */
export function scoreAssetsWith(rule: AarsRule): GNode[] {
  const enriched = enrichFromTabs(rule);
  if (!enriched) return [];
  return realNodes(enriched.nodes);
}

/**
 * Re-enrich the persisted graph under `rule`, feeding each asset the SAME AARS inputs its
 * score was built from. Where a row predates the `aars_input_json` column the inputs are
 * rebuilt from findings, which is what the sync's live path would have derived anyway.
 *
 * "Same inputs" is right for a PRICING change (severityPoints, gapPoints, a cap) — that is
 * the whole point of this function, and why a rescore costs zero Wiz calls. It is wrong for
 * a DERIVATION change: `rule.gapSources` decides WHICH GAPS EXIST (deriveAarsInput), and a
 * persisted input built under the old flags does not contain the gaps the new ones would
 * add. Reusing it unconditionally meant flipping `fiveRs` on and hitting Recompute moved
 * nothing until the next full sync — the exact bug `derivedUnder` exists to close: a
 * persisted input is only trusted here when its signature still matches `rule`'s, or it
 * predates the field entirely (legacy — reused, so no tenant re-scores on upgrade). Anything
 * else is left OUT of `hints`, so `enrichGraphDoc` falls through to a fresh
 * `deriveAarsInput` (or to whatever `buildAarsHintsFromFindings` computed above, which is
 * itself a fresh derivation under the current `rule` and already carries a matching
 * signature) instead of a stale one wearing the new rule's clothes.
 */
function enrichFromTabs(rule: AarsRule): GraphDoc | null {
  const base = loadRawGraph();
  if (!base) return null;
  const issues = loadIssues();
  const hints: AarsHints = { ...buildAarsHintsFromFindings(loadFindings(), base, issues, rule) };
  const sig = derivationSignature(rule);
  for (const node of base.nodes) {
    const input = node.aarsInput;
    if (input && (input.derivedUnder === undefined || input.derivedUnder === sig)) {
      hints[node.id] = input;
    }
  }
  return enrichGraphDoc(base, issues, hints, rule);
}

/**
 * Re-decide every persisted issue and finding under `rule`, without touching the Wiz API:
 * every input a verdict needs is already on the tabs (the issue/finding's own fields, and
 * the asset's own CIEM/exposure/business-impact columns).
 *
 * UNLIKE `enrichFromTabs` above, this does NOT reuse a persisted input unconditionally —
 * it reuses it only when `problemRule.vectorSignature(rule)` still matches what the row
 * was decided under (or the row predates the field entirely — legacy, reused, so no tenant
 * redecides on upgrade). This is the SAME `derivedUnder` precedent `enrichFromTabs`
 * follows for AARS, applied to this rule's own derivation knobs
 * (`exploitationByRuleId` / `remediateVerdicts` / `totalImpactGroups` / `missingMission`)
 * rather than `gapSources` — DO NOT let this regress to unconditional reuse the way the
 * AARS rescore briefly did: an operator flips `missingMission` from MEDIUM to LOW, hits
 * Redecide, and nothing should move for a row whose vector was actually built under the
 * old default — it must re-derive, not keep answering for a rule that no longer exists.
 *
 * `decideProblem` itself (the `outcomeRules` cascade) is ALWAYS re-run under the CURRENT
 * `rule`, whether the vector was reused or freshly derived: reordering or editing
 * `outcomeRules` changes what a vector ROUTES TO, never WHICH VECTOR a row has, so it must
 * never be gated by the same signature check the vector-reuse decision uses. A rule edit
 * that touches only `outcomeRules` therefore reuses every persisted `problemInput`
 * untouched and still redecides every outcome — the "pure ordering change" case
 * `problem.test.ts` / `redecideProblems.test.ts` pin.
 *
 * A row that no longer passes its own gate (`isUnresolvedIssue` / `isOpenGap`) is stripped
 * rather than redecided — see `stripProblemFields`. This can only happen here if the row
 * changed status without a sync in between, which does not happen (status is a synced
 * field), but the strip keeps this function correct independent of that fact rather than
 * relying on it.
 */
function redecideFromTabs(
  rule: ProblemRule,
  ruleVersion: number | undefined,
): { issues: IssueRow[]; findings: FindingRow[] } {
  const byId = new Map(loadAssetsRaw().map((n) => [n.id, n]));
  const sig = vectorSignature(rule);

  const reuseOrDerive = <Row extends { problemInput?: ProblemVerdictInput }>(
    row: Row,
    node: GNode | undefined,
    derive: () => ProblemVerdictInput,
  ): ProblemVerdictInput => {
    const persisted = row.problemInput;
    if (persisted && (persisted.derivedUnder === undefined || persisted.derivedUnder === sig)) {
      return persisted; // reused verbatim, own (possibly legacy) signature and all
    }
    return { ...derive(), derivedUnder: sig };
  };

  const stampVersion = <Row extends { problemRuleVersion?: number }>(row: Row): Row => {
    if (ruleVersion === undefined) {
      // A preview (decideProblemsWith): nothing is being saved, so no real version exists
      // to stamp. Strip whatever the source row carried rather than let a stale number
      // from a PRIOR real redecide leak through as if it described this preview.
      if (row.problemRuleVersion === undefined) return row;
      const next = { ...row };
      delete next.problemRuleVersion;
      return next;
    }
    return { ...row, problemRuleVersion: ruleVersion };
  };

  const issues = loadIssues().map((issue) => {
    if (!isUnresolvedIssue(issue)) return stripProblemFields(issue);
    const input = reuseOrDerive(issue, byId.get(issue.assetId), () =>
      deriveProblemInput(issue, byId.get(issue.assetId), rule));
    const { outcome } = decideProblem(input.vector, rule);
    return stampVersion({ ...issue, problemOutcome: outcome, problemInput: input });
  });

  const findings = loadFindings().map((finding) => {
    if (!isOpenGap(finding)) return stripProblemFields(finding);
    const input = reuseOrDerive(finding, byId.get(finding.resourceId), () =>
      deriveFindingProblemInput(finding, byId.get(finding.resourceId), rule));
    const { outcome } = decideProblem(input.vector, rule);
    return stampVersion({ ...finding, problemOutcome: outcome, problemInput: input });
  });

  return { issues, findings };
}

/**
 * Re-decide every persisted issue and finding under the current problem rule, and rewrite
 * the two tabs. Same non-negotiable as `rescoreInventory`: NOT a sync — zero Wiz calls, and
 * no `sync_history` row, because inventing a commit record would put a point on the
 * outcome trend for a landscape that never moved.
 *
 * Caller holds the script lock.
 */
export function redecideProblems(): {
  version: number;
  issueCount: number;
  findingCount: number;
  outcomes: Record<string, number>;
} {
  const { version, rule } = settingsStore.getProblemRule();
  const { issues, findings } = redecideFromTabs(rule, version);

  overwrite(TABS.issues, issues.map(issueToRow));
  overwrite(TABS.findings, findings.map(findingToRow));

  settingsStore.setDecidedRuleVersion(version);
  commit();

  return {
    version,
    issueCount: issues.filter((i) => i.problemOutcome !== undefined).length,
    findingCount: findings.filter((f) => f.problemOutcome !== undefined).length,
    outcomes: countProblemOutcomes([...issues, ...findings]),
  };
}

/**
 * Decide every persisted issue and finding under an ARBITRARY rule and return the result
 * WITHOUT writing anything — what a future Problem Rules page previews before committing
 * to it. Shares `redecideFromTabs` with the real redecide, so the preview is the redecide,
 * minus the writes and the version stamp (there is no real version for a rule that has not
 * been saved).
 */
export function decideProblemsWith(rule: ProblemRule): { issues: IssueRow[]; findings: FindingRow[] } {
  return redecideFromTabs(rule, undefined);
}

/**
 * Fold posture tiers over the persisted assets under an arbitrary `rule`, reading the
 * persisted `problemOutcome`s off `ai_issues` / `ai_findings` exactly as they stand (no
 * re-derivation needed there — `derivePostureInput` never reads a problem verdict, only
 * `worstOpenProblem` does, and that fold is a pure read of an already-decided field).
 * Costs zero Wiz calls: every input `withPostureTiers` needs is already on the tabs. Shared
 * by `recomputePostures` (writes) and `previewPostureRule` (does not) — the same
 * one-function-two-callers shape `decideProblemsWith` / `redecideProblems` share.
 */
function postureFromTabs(rule: PostureRule): GNode[] {
  const nodes = loadAssetsRaw();
  if (!nodes.length) return [];
  const doc: GraphDoc = { nodes, edges: [], syncedAt: "" };
  return withPostureTiers(doc, loadIssues(), loadFindings(), rule).nodes;
}

/**
 * Score every persisted asset's posture tier under an ARBITRARY rule and return the result
 * WITHOUT writing anything — what the AARS Rules page's Posture tab previews before
 * committing to it. Shares `postureFromTabs` with the real recompute, so the preview is
 * the recompute, minus the writes.
 */
export function posturesWith(rule: PostureRule): GNode[] {
  return postureFromTabs(rule);
}

/**
 * Re-tier every persisted asset under the current posture rule, and rewrite the assets
 * tab. Same non-negotiable as `rescoreInventory` / `redecideProblems`: NOT a sync — zero
 * Wiz calls, and no `sync_history` row, because inventing a commit record would put a
 * point on a trend for a landscape that never moved.
 *
 * Does NOT rewrite the Drive snapshot — mirrors `redecideProblems`'s choice, not
 * `rescoreInventory`'s: `postureFromTabs` builds its working doc from `loadAssetsRaw()`
 * alone (no ISSUE nodes, unlike `enrichFromTabs`'s call into `enrichGraphDoc`), so writing
 * it back to Drive would silently drop every ISSUE node from the cached graph until the
 * next real sync. `TABS.assets` is the read model every consumer of a posture tier
 * actually reads (`loadAssets` — Inventory's tier column never goes through
 * `loadGraphDoc`), so the Security Graph page carrying a stale `postureTier` on its copy
 * of a node until the next sync is the same accepted trade-off `redecideProblems` already
 * makes for `problemOutcome` on ISSUE nodes.
 *
 * Caller holds the script lock.
 */
export function recomputePostures(): {
  version: number;
  assetCount: number;
  tierCounts: Record<PostureTier, number>;
} {
  const { version, rule } = settingsStore.getPostureRule();
  const nodes = postureFromTabs(rule);

  overwrite(TABS.assets, nodes.map(assetToRow));
  settingsStore.setComputedPostureVersion(version);
  commit();

  return { version, assetCount: nodes.length, tierCounts: countPostureTiers(nodes) };
}

/**
 * The pre-enrichment graph, rebuilt from the tabs. The tabs are the right source here
 * (the Drive snapshot is post-enrichment, and re-enriching it would duplicate every
 * ISSUE node); the previous run's AARS fields are dropped so a rescore is a genuine
 * recomputation rather than a patch over stale scores — an asset that stops being
 * scorable must lose its score, not keep the old one.
 */
function loadRawGraph(): GraphDoc | null {
  const nodes = loadAssetsRaw();
  if (!nodes.length) return null;
  const edges = readAll(TABS.edges).map(rowToEdge);
  const latest = latestSync();
  return {
    nodes: nodes.map(stripAarsScore),
    edges,
    syncedAt: latest ? String(latest["finished_at"] ?? "") : "",
  };
}

function stripAarsScore(n: GNode): GNode {
  if (n.aars === undefined && n.aarsSeverity === undefined && n.aarsPillars === undefined) return n;
  const next = { ...n };
  delete next.aars;
  delete next.aarsSeverity;
  delete next.aarsPillars;
  // Nothing writes `aarsPercentile` (it is read-derived), but an unscored node must not
  // carry one either way — a percentile with no score behind it is a rank into nothing.
  delete next.aarsPercentile;
  return next;
}

// -------------------------------------------------------------------- read model

// Per-execution memos: one API call can need the same read model several times
// (getGraph resolves seeds from issues AND loads the doc, whose tab-rebuild
// fallback re-reads issues). Module state dies with the GAS execution, so these
// can never serve cross-request data; writers below invalidate them anyway.
let graphDocMemo: GraphDoc | null | undefined;
let assetsMemo: GNode[] | undefined;
let edgesMemo: GEdge[] | undefined;
let issuesMemo: IssueRow[] | undefined;
let findingsMemo: FindingRow[] | undefined;
let dataFindingsMemo: DataFindingRow[] | undefined;
let frameworksMemo: FrameworkRow[] | undefined;
let postureMemo: PostureRow[] | undefined;
let frameworkPoliciesMemo: FrameworkPolicyRow[] | undefined;
let configRulesMemo: ConfigRuleRow[] | undefined;
let identityFindingsMemo: IdentityFindingRow[] | undefined;
/**
 * `loadAssets`'s output, keyed by what produced it.
 *
 * `assetsMemo` above holds the RAW rows, and until the percentile landed that was enough:
 * `withCurrentBands` returns its input array unchanged whenever every stored band already
 * agrees with the rule, which for a freshly-scored ledger is every time — so `loadAssets`
 * cost nothing to call repeatedly and four call sites per request did. Stamping a
 * percentile always allocates (every scored node gets a field the raw row does not have),
 * so without this the same landscape would be copied once per caller.
 *
 * Keyed on the raw array's IDENTITY and on the bands in force, not merely stored, so
 * settingsStore.saveSettings's invariant survives verbatim: it bumps the data version
 * without dropping these memos, on the stated grounds that a rule change is picked up
 * because the bands are read per call. A band edit changes `bandKey`, misses this memo and
 * re-derives — which is that same promise, kept by the key rather than by luck.
 */
let derivedAssetsMemo: { raw: GNode[]; bandKey: string; out: GNode[] } | undefined;

function invalidateReadMemos(): void {
  graphDocMemo = undefined;
  assetsMemo = undefined;
  derivedAssetsMemo = undefined;
  issuesMemo = undefined;
  findingsMemo = undefined;
  dataFindingsMemo = undefined;
  frameworksMemo = undefined;
  postureMemo = undefined;
  frameworkPoliciesMemo = undefined;
  configRulesMemo = undefined;
  identityFindingsMemo = undefined;
}

/**
 * Close a write: bump the data version so caches miss, and drop this execution's read
 * memos so a later read in the same request sees what was just written.
 *
 * Named because the pair was written out three times and settingsStore called only the
 * first half — the caches invalidated, the memos did not. Exported so that store can use
 * it too, rather than keeping its own half-version.
 */
export function commit(): void {
  bumpDataVersion();
  // The Wiz-facing half. Bumped HERE rather than in persistSync so that all three callers
  // reach it — a rescore and, more importantly, resetData(). A version that only a sync
  // moved would let a cached live expansion outlive a full data wipe by up to six hours,
  // and expandAsset's guard cannot catch that: with the graph gone it finds no node, skips
  // the kind check, and serves the stale answer.
  bumpWizDataVersion();
  invalidateReadMemos();
}

/**
 * The real landscape: the synthetic ISSUE and SUMMARY nodes are graph furniture, not assets,
 * and every asset-facing read drops them. Byte-identical filter, written three times.
 */
function realNodes(nodes: GNode[]): GNode[] {
  return nodes.filter((n) => n.kind !== "ISSUE" && n.kind !== "SUMMARY");
}

/** The enriched graph: Drive snapshot fast path, tab rebuild fallback. */
export function loadGraphDoc(): GraphDoc | null {
  if (graphDocMemo !== undefined) return graphDocMemo;
  graphDocMemo = loadGraphDocUncached();
  return graphDocMemo;
}

/**
 * A Drive snapshot written before the rename carries `aarsBand`, and its value may be
 * the old `MINIMAL`. Normalize on read so an existing snapshot keeps scoring the
 * inventory without a re-sync; the next sync rewrites it in the current shape.
 */
export function normalizeLegacyAars(doc: GraphDoc): GraphDoc {
  let touched = false;
  const nodes = doc.nodes.map((n) => {
    const loose = n as GNode & { aarsBand?: unknown };
    if (loose.aarsBand === undefined && n.aarsSeverity === undefined) return n;
    touched = true;
    const next: GNode & { aarsBand?: unknown } = { ...loose };
    delete next.aarsBand;
    const sev = normalizeAarsSeverity(n.aarsSeverity ?? loose.aarsBand);
    if (sev) next.aarsSeverity = sev;
    else delete next.aarsSeverity;
    return next;
  });
  return touched ? { ...doc, nodes } : doc;
}

/**
 * Risk topology (data findings, sensitive data, internet exposure, excessive rights, human
 * identity access, missing guardrail) is derived on read, not persisted — so it applies to
 * already-synced graphs and never reaches the asset/inventory tables (which read
 * TABS.assets directly, bypassing this doc). See the with* helpers in graphEnrich.
 *
 * withDataFindingNodes runs INNERMOST. It only reads persisted columns, so ordering is not
 * load-bearing for correctness — but the aggregate is evidence hanging off a real store, and
 * building the real topology before the stubs that stand in for it keeps the rule "enrich
 * what was synced, then hang stand-ins off what was not" true of the composition itself.
 */
function withRiskNodes(doc: GraphDoc): GraphDoc {
  return withMissingGuardrailNodes(
    withIdentityAccessNodes(
      withExcessivePrivilegeNodes(
        withInternetExposureNodes(withSensitiveDataNodes(withDataFindingNodes(doc))),
      ),
    ),
  );
}

/**
 * Re-derive each asset's AARS level from its persisted score under the CURRENT bands.
 * Levels are cheap to recompute and carry no history of their own, so moving a threshold
 * applies at once and retroactively — no rescore, no re-sync. The persisted
 * `aars_severity` survives only as the answer for a node with no score, which is where
 * the legacy `aars_band` / `MINIMAL` spellings still live.
 */
export function withCurrentBands(nodes: GNode[], bands: AarsBands): GNode[] {
  let touched = false;
  const out = nodes.map((n) => {
    if (typeof n.aars !== "number") return n;
    const sev = aarsSeverity(n.aars, bands);
    if (sev === n.aarsSeverity) return n;
    touched = true;
    return { ...n, aarsSeverity: sev };
  });
  return touched ? out : nodes;
}

/**
 * Attach each scored asset's landscape percentile — the statistic that carries the ranking
 * claim now that the BAND does not (ai/AARS_SCORING_ASSESSMENT.md §3: 19 of 30 assets land
 * CRITICAL, HIGH and MEDIUM empty, so the band names no queue).
 *
 * READ PATH ONLY, and the asymmetry with `withCurrentBands` above is deliberate. A band is
 * re-derivable from ONE asset's stored score, so a persisted `aars_severity` is a usable
 * fallback for a node the current rule cannot band. A percentile is not: it is computed
 * against the whole scored population, so it is invalidated by any change to any OTHER
 * asset. There is therefore no column, no fallback and no write — attaching it here, after
 * the population is assembled, is the only place it can be correct.
 *
 * The population is exactly "nodes carrying a numeric `aars`", which excludes ISSUE nodes
 * and every unscored asset. Callers publish that count (`api.ts`'s `aarsScored`) rather
 * than leaving the denominator implied — the S-test AARS_SCORING_ASSESSMENT.md §3 sets for
 * any published aggregate.
 */
export function withAarsPercentile(nodes: GNode[]): GNode[] {
  const scored: number[] = [];
  for (const n of nodes) if (typeof n.aars === "number") scored.push(n.aars);
  if (!scored.length) return nodes;
  const percentiles = midrankPercentiles(scored);
  // Whole percent: 1/30 of a landscape is ~3.3 points, so a decimal would advertise a
  // precision the population does not have. Rounded here rather than in rankStats.ts,
  // which stays a pure-statistics module with no opinion about display.
  let i = 0;
  return nodes.map((n) => {
    if (typeof n.aars !== "number") return n;
    return { ...n, aarsPercentile: Math.round(percentiles[i++]!) };
  });
}

function currentBands(): AarsBands {
  return settingsStore.getAarsRule().rule.bands;
}

/**
 * The two read-time AARS derivations, applied together. Both are population- or
 * rule-dependent and neither is persisted in a usable form, so a read path that ran only
 * one of them would ship a banded asset with no percentile (or the reverse) and the
 * surfaces would disagree about the same asset. One helper, three call sites.
 */
function withAarsReadDerivations(nodes: GNode[]): GNode[] {
  return withAarsPercentile(withCurrentBands(nodes, currentBands()));
}

function withBandsApplied(doc: GraphDoc): GraphDoc {
  const nodes = withAarsReadDerivations(doc.nodes);
  return nodes === doc.nodes ? doc : { ...doc, nodes };
}

function loadGraphDocUncached(): GraphDoc | null {
  const snap = readGraphSnapshot();
  if (snap) return withRiskNodes(withBandsApplied(normalizeLegacyAars(snap)));

  const assetRows = readAll(TABS.assets);
  if (!assetRows.length) return null;
  const nodes = withAarsReadDerivations(assetRows.map(rowToAsset));
  const edges = readAll(TABS.edges).map(rowToEdge);
  const issues = loadIssues().filter(isUnresolvedIssue);
  for (const issue of issues) {
    nodes.push({
      id: issue.id,
      kind: "ISSUE",
      name: issue.ruleName,
      severity: issue.adjustedSeverity,
      comboGroups: issue.comboGroup ? [issue.comboGroup] : [],
      status: issue.status,
    });
    edges.push({
      id: edgeId(issue.assetId, "HAS_ISSUE", issue.id),
      src: issue.assetId,
      dst: issue.id,
      type: "HAS_ISSUE",
    });
  }
  const latest = latestSync();
  return withRiskNodes({
    nodes,
    edges,
    syncedAt: latest ? String(latest["finished_at"] ?? "") : "",
  });
}

/** Assets exactly as persisted — the recompute's input, and nobody else's. */
function loadAssetsRaw(): GNode[] {
  if (assetsMemo === undefined) assetsMemo = readAll(TABS.assets).map(rowToAsset);
  return assetsMemo;
}

/**
 * The inventory read model. Reads TABS.assets directly (it never goes through
 * loadGraphDoc), so the band re-derivation has to happen here too or the table and the
 * graph would disagree about what "CRITICAL" means.
 */
export function loadAssets(): GNode[] {
  const raw = loadAssetsRaw();
  const bands = currentBands();
  const bandKey = `${bands.critical}|${bands.high}|${bands.medium}|${bands.low}`;
  const memo = derivedAssetsMemo;
  if (memo && memo.raw === raw && memo.bandKey === bandKey) return memo.out;
  const out = withAarsReadDerivations(raw);
  derivedAssetsMemo = { raw, bandKey, out };
  return out;
}

/**
 * Edges exactly as persisted on `ai_edges` — never the synthetic HAS_ISSUE / risk-condition
 * edges `loadGraphDocUncached` adds at read time for the graph page. This is the same
 * population `registerScopeDiagnostic`'s edge census reads (`readAll(TABS.edges)`), and is
 * what `reach.ts`'s `estateReach` needs to ask "which relationship types actually populated"
 * without silently counting synthetic furniture as a Wiz-derived relationship.
 */
export function loadEdges(): GEdge[] {
  if (edgesMemo === undefined) edgesMemo = readAll(TABS.edges).map(rowToEdge);
  return edgesMemo;
}

export function loadIssues(): IssueRow[] {
  if (issuesMemo === undefined) issuesMemo = readAll(TABS.issues).map(rowToIssue);
  return issuesMemo;
}

export function loadFindings(): FindingRow[] {
  if (findingsMemo === undefined) findingsMemo = readAll(TABS.findings).map(rowToFinding);
  return findingsMemo;
}

export function loadDataFindings(): DataFindingRow[] {
  if (dataFindingsMemo === undefined) {
    dataFindingsMemo = readAll(TABS.dataFindings).map(rowToDataFinding);
  }
  return dataFindingsMemo;
}

export function loadFrameworks(): FrameworkRow[] {
  if (frameworksMemo === undefined) frameworksMemo = readAll(TABS.frameworks).map(rowToFramework);
  return frameworksMemo;
}

/**
 * The rule catalogue. Read far more often than it is written — the hygiene matchers resolve
 * against it at every step build, and the shortId gloss reads it on every render — which is
 * the other half of the argument for the monthly refresh gate.
 */
export function loadConfigRules(): ConfigRuleRow[] {
  if (configRulesMemo === undefined) {
    configRulesMemo = readAll(TABS.configRules).map(rowToConfigRule);
  }
  return configRulesMemo;
}

export function loadIdentityFindings(): IdentityFindingRow[] {
  if (identityFindingsMemo === undefined) {
    identityFindingsMemo = readAll(TABS.identityFindings).map(rowToIdentityFinding);
  }
  return identityFindingsMemo;
}

export function loadPosture(): PostureRow[] {
  if (postureMemo === undefined) postureMemo = readAll(TABS.frameworkPosture).map(rowToPosture);
  return postureMemo;
}

export function loadFrameworkPolicies(): FrameworkPolicyRow[] {
  if (frameworkPoliciesMemo === undefined) {
    frameworkPoliciesMemo = readAll(TABS.frameworkPolicies).map(rowToFrameworkPolicy);
  }
  return frameworkPoliciesMemo;
}

export function syncHistory(): Rec[] {
  return readAll(TABS.syncHistory);
}

/** Most recent committed sync row, or null. */
export function latestSync(): Rec | null {
  const rows = syncHistory();
  return rows.length ? rows[rows.length - 1] : null;
}

/** Wipe all synced data (tabs + snapshot). Caller holds the script lock. */
export function resetData(): void {
  overwrite(TABS.assets, []);
  overwrite(TABS.edges, []);
  overwrite(TABS.issues, []);
  overwrite(TABS.findings, []);
  overwrite(TABS.dataFindings, []);
  overwrite(TABS.syncHistory, []);
  trashGraphSnapshot();
  commit();
}

// --------------------------------------------------------------------------- prune

/** One rewritten tab's row count, before and after. */
export interface PruneTabCount {
  tab: string;
  before: number;
  after: number;
}

export interface PruneResult {
  projectId: string;
  dryRun: boolean;
  census: PruneCensus;
  tabs: PruneTabCount[];
  cellsBefore: number;
  /** Measured after a real prune; PROJECTED from the same arithmetic on a dry run. */
  cellsAfter: number;
}

/** The child tabs, and the column that names the asset each row hangs off. */
const PRUNE_CHILDREN: Array<[tab: string, ownerColumn: string]> = [
  // NEVER `projects_json`. An issue's own project cell holds NAMES, not ids (IssueRow.projects
  // in graphTypes.ts), so an id comparison there matches nothing and matches it silently. The
  // asset link is the authoritative one, and is what the project view filter uses too.
  [TABS.issues, "asset_id"],
  [TABS.findings, "resource_id"],
  [TABS.dataFindings, "resource_id"],
  [TABS.identityFindings, "resource_id"],
];

/**
 * What trimming a tab down to `keptRows` would give back, in cells.
 *
 * Mirrors `trimSurplusRows` exactly — the same buffer, the same header row — because a
 * preview that used a rounder rule would be a second answer to a question the storage figure
 * already answers one way.
 */
function projectedCellsFreed(tab: string, keptRows: number): number {
  const { rows, cols } = gridSize(tab);
  return Math.max(0, rows - (keptRows + 1 + TRIM_BUFFER_ROWS)) * cols;
}

/**
 * The Drive snapshot, pruned to match the tabs.
 *
 * It is the read fast path for getGraph (`loadGraphDocUncached`), so leaving it alone would
 * have the Security Graph page keep drawing assets the register no longer holds. Trashing it
 * would also be correct, and is what `resetData` does — but the tabs rebuild is then paid on
 * every read until the next sync, and this whole feature exists to make reads cheaper.
 *
 * `persistSync` writes the WHOLE document here, so the snapshot carries the synthetic ISSUE
 * nodes and their HAS_ISSUE edges alongside the real assets. Filtering it on asset ids alone
 * would silently strip every issue from the graph, so the kept issue ids join the keep-set
 * for this one purpose. The derived risk nodes (sensitive data, exposure, guardrails) are
 * added at read time by `withRiskNodes` and are not in here to prune.
 */
function pruneGraphSnapshot(keptNodeIds: Set<string>): void {
  const snap = readGraphSnapshot();
  if (!snap) return;
  const nodes = snap.nodes.filter((n) => keptNodeIds.has(n.id));
  const edges = snap.edges.filter((e) => keptNodeIds.has(e.src) && keptNodeIds.has(e.dst));
  writeGraphSnapshot({ ...snap, nodes, edges });
}

/**
 * Keep one project's subtree and delete the rest of the register, in place.
 *
 * The subtraction `resetData` cannot express. A register synced before WIZ_PROJECT_ID_V2 was
 * set holds every project the tenant returned; re-fetching the wanted slice costs hours of
 * Wiz API calls, while the unwanted rows are already identifiable from what is on the tabs.
 *
 * Rows are filtered AS ROWS — read raw, written raw — so a column this file does not model
 * cannot be dropped on the way through. The one cell that is parsed is `projects_json`, and
 * it goes through `parseAssetProjects` rather than JSON.parse because cells written by an
 * older version hold bare name strings; a raw parse reads every one of those rows as
 * belonging to no project at all, which under rule 2 of the planner decides their fate.
 *
 * Untouched: the framework tabs and the rule catalogue (Wiz's vocabulary, not this tenant's
 * posture), settings, jobs, and `sync_history`. History rows record what a sync actually
 * fetched; rewriting them to agree with a later deletion would be a different untruth than
 * leaving them, and the panel says so rather than quietly picking one.
 *
 * Caller holds the script lock.
 */
export function pruneToProject(projectId: string, opts: { dryRun: boolean }): PruneResult {
  const assetRows = readAll(TABS.assets);
  const edgeRows = readAll(TABS.edges);

  const { keep, census } = planPrune(
    assetRows.map((r) => ({
      id: String(r["id"] ?? ""),
      projects: parseAssetProjects(r["projects_json"]),
    })),
    edgeRows.map((r) => ({ src: String(r["src"] ?? ""), dst: String(r["dst"] ?? "") })),
    projectId,
  );

  // The refusal that matters. An id no asset carries — a typo, a project this register was
  // never scoped to fetch, a stale pick — keeps nothing, and a control labelled "remove data
  // outside a project" must not be the way someone empties the register by accident.
  if (!keep.size) {
    throw new Error(
      "No asset in this register belongs to that project, so this would delete everything. " +
      "Use Reset synced data if clearing the register is what you want.");
  }

  const keptAssets = assetRows.filter((r) => keep.has(String(r["id"] ?? "")));
  const keptEdges = edgeRows.filter(
    (r) => keep.has(String(r["src"] ?? "")) && keep.has(String(r["dst"] ?? "")));
  const children = PRUNE_CHILDREN.map(([tab, ownerColumn]) => {
    const rows = readAll(tab);
    return { tab, rows, kept: rows.filter((r) => keep.has(String(r[ownerColumn] ?? ""))) };
  });

  // Children first, assets last, in the census as in the write below.
  const tabs: PruneTabCount[] = [
    ...children.map((c) => ({ tab: c.tab, before: c.rows.length, after: c.kept.length })),
    { tab: TABS.edges, before: edgeRows.length, after: keptEdges.length },
    { tab: TABS.assets, before: assetRows.length, after: keptAssets.length },
  ];

  const cellsBefore = cellCount();
  if (opts.dryRun) {
    const freed = tabs.reduce((acc, t) => acc + projectedCellsFreed(t.tab, t.after), 0);
    return {
      projectId, dryRun: true, census, tabs, cellsBefore,
      cellsAfter: Math.max(0, cellsBefore - freed),
    };
  }

  // Invalidate BEFORE the first write, not only after the last. The 6-minute execution
  // ceiling can end this function between two tabs, and `commit()` at the end would then
  // never run — leaving caches serving pre-prune rows against post-prune tabs for up to six
  // hours. Bumping first makes the worst case a cold read of a half-pruned register, which is
  // recoverable by running it again; the alternative is a mix nothing can detect.
  bumpDataVersion();
  bumpWizDataVersion();

  // Children before assets, deliberately. Interrupted here, the register holds assets whose
  // issues have already gone — under-reporting, and re-running finishes the job. The other
  // order leaves issue and finding rows pointing at assets that no longer exist, which every
  // join downstream has to cope with.
  for (const c of children) {
    overwrite(c.tab, c.kept);
    trimSurplusRows(c.tab);
  }
  overwrite(TABS.edges, keptEdges);
  trimSurplusRows(TABS.edges);
  overwrite(TABS.assets, keptAssets);
  trimSurplusRows(TABS.assets);

  // The surviving assets PLUS the surviving issues: the snapshot carries the synthetic ISSUE
  // nodes, so an asset-only keep-set would strip every issue from the graph page.
  const keptNodeIds = new Set<string>(keep);
  const keptIssues = children.find((c) => c.tab === TABS.issues);
  for (const r of keptIssues?.kept ?? []) keptNodeIds.add(String(r["id"] ?? ""));
  pruneGraphSnapshot(keptNodeIds);

  commit();
  return { projectId, dryRun: false, census, tabs, cellsBefore, cellsAfter: cellCount() };
}
