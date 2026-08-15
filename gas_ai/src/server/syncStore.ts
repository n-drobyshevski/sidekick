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
import { aarsSeverity, type AarsBands, type AarsRule } from "../domain/aars";
import { isUnresolvedIssue, normalizeAarsSeverity } from "../domain/config";
import { OTHER_GROUP_ID } from "../domain/toxicCombos";
import type { Severity } from "../domain/config";
import { countAarsSeverities } from "../domain/aarsTrend";
import { nowIso, type Rec } from "../domain/util";
import { readGraphSnapshot, trashGraphSnapshot, writeGraphSnapshot } from "./archiveStore";
import { bumpDataVersion } from "./serverCache";
import * as settingsStore from "./settingsStore";
import { appendRows, overwrite, readAll, TABS } from "./sheetsDb";

// ------------------------------------------------------------- row (de)serializers
// Cells are plain text ("@"): booleans serialize as "true"/"false" ("null" for the
// tri-state internet flag), arrays/objects as JSON — byte-stable round trips.

function boolCell(v: boolean | undefined): string {
  return v ? "true" : "false";
}
function triCell(v: boolean | null | undefined): string {
  return v === null || v === undefined ? "null" : v ? "true" : "false";
}
function parseBool(v: unknown): boolean {
  return String(v) === "true";
}
function parseTri(v: unknown): boolean | null {
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
    projects_json: JSON.stringify((n.projects ?? []).map((p) => p.name)),
    first_seen: n.firstSeen ?? null,
    last_seen: n.lastSeen ?? null,
    internet: triCell(n.isAccessibleFromInternet),
    open_internet: triCell(n.isOpenToAllInternet),
    sensitive_data: boolCell(n.hasSensitiveData),
    sensitive_access: boolCell(n.hasAccessToSensitiveData),
    high_priv: boolCell(n.hasHighPrivileges),
    admin_priv: boolCell(n.hasAdminPrivileges),
    guardrail_missing: boolCell(n.guardrailMissing),
    technology_categories: (n.technologyCategories ?? []).join(","),
    severity: n.severity ?? null,
    aars: n.aars ?? null,
    aars_severity: n.aarsSeverity ?? null,
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
    hasSensitiveData: parseBool(r["sensitive_data"]),
    hasAccessToSensitiveData: parseBool(r["sensitive_access"]),
    hasHighPrivileges: parseBool(r["high_priv"]),
    hasAdminPrivileges: parseBool(r["admin_priv"]),
    guardrailMissing: parseBool(r["guardrail_missing"]),
    projects: parseJson<string[]>(r["projects_json"], []).map((name) => ({
      id: `proj-${String(name).toLowerCase()}`,
      name: String(name),
    })),
  };
  const account = (r["account_id"] as string | null) ?? null;
  if (account) {
    node.cloudAccount = { id: account, name: String(r["account_name"] ?? account) };
  }
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
  const enriched = enrichGraphDoc(reachable, issues, hints, rule);

  // Tabs hold the real (non-synthetic) nodes; ISSUE nodes are derivable from ai_issues.
  const assetNodes = realNodes(enriched.nodes);
  const assetEdges = enriched.edges.filter((e) => e.type !== "HAS_ISSUE");
  overwrite(TABS.assets, assetNodes.map(assetToRow));
  overwrite(TABS.edges, assetEdges.map(edgeToRow));
  overwrite(TABS.issues, issues.map(issueToRow));
  overwrite(TABS.findings, findings.map(findingToRow));
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

  const snapshotRef = writeGraphSnapshot(enriched);

  // Commit record LAST.
  appendRows(TABS.syncHistory, [{
    sync_id: meta.syncId,
    started_at: meta.startedAt,
    finished_at: nowIso(now),
    status: "SUCCESS",
    mode: meta.mode,
    node_count: enriched.nodes.length,
    edge_count: enriched.edges.length,
    issue_count: issues.length,
    api_calls: meta.apiCalls,
    snapshot_ref: snapshotRef,
    error: null,
    // The AARS distribution at this sync — the only record of it, since the snapshot
    // this row points at is overwritten by the next sync. Feeds the inventory trend.
    aars_severity_json: JSON.stringify(countAarsSeverities(enriched.nodes)),
    // Which scoring model produced that distribution: counts from two versions are not
    // on the same scale, and the trend chart says so rather than drawing a false step.
    aars_rule_version: ruleVersion,
  }]);
  settingsStore.setScoredRuleVersion(ruleVersion);
  commit();
  return enriched;
}

/**
 * Re-score every persisted asset under the current rule, without touching the Wiz API:
 * every input the score needs is already on the tabs (issue framework codes, finding
 * framework codes, and the asset's own CIEM/DSPM flags). Rewrites the assets tab and the
 * Drive snapshot, and does NOT append a sync_history row — a rescore is not a sync, and
 * inventing a commit record would put a point on the trend for an estate that never moved.
 *
 * Caller holds the script lock.
 */
export function rescoreInventory(): {
  version: number;
  assetCount: number;
  counts: Record<string, number>;
} {
  const { version, rule } = settingsStore.getAarsRule();
  const enriched = enrichFromTabs(rule);
  if (!enriched) {
    settingsStore.setScoredRuleVersion(version);
    return { version, assetCount: 0, counts: countAarsSeverities([]) };
  }

  // Same split as persistSync: the tabs hold the real nodes, ISSUE nodes stay derivable.
  const assetNodes = realNodes(enriched.nodes);
  overwrite(TABS.assets, assetNodes.map(assetToRow));
  writeGraphSnapshot(enriched);

  settingsStore.setScoredRuleVersion(version);
  commit();
  return {
    version,
    assetCount: assetNodes.length,
    counts: countAarsSeverities(enriched.nodes),
  };
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
 */
function enrichFromTabs(rule: AarsRule): GraphDoc | null {
  const base = loadRawGraph();
  if (!base) return null;
  const issues = loadIssues();
  const hints: AarsHints = { ...buildAarsHintsFromFindings(loadFindings(), base, issues, rule) };
  for (const node of base.nodes) {
    if (node.aarsInput) hints[node.id] = node.aarsInput;
  }
  return enrichGraphDoc(base, issues, hints, rule);
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
  return next;
}

// -------------------------------------------------------------------- read model

// Per-execution memos: one API call can need the same read model several times
// (getGraph resolves seeds from issues AND loads the doc, whose tab-rebuild
// fallback re-reads issues). Module state dies with the GAS execution, so these
// can never serve cross-request data; writers below invalidate them anyway.
let graphDocMemo: GraphDoc | null | undefined;
let assetsMemo: GNode[] | undefined;
let issuesMemo: IssueRow[] | undefined;
let findingsMemo: FindingRow[] | undefined;
let dataFindingsMemo: DataFindingRow[] | undefined;
let frameworksMemo: FrameworkRow[] | undefined;
let postureMemo: PostureRow[] | undefined;
let frameworkPoliciesMemo: FrameworkPolicyRow[] | undefined;
let configRulesMemo: ConfigRuleRow[] | undefined;
let identityFindingsMemo: IdentityFindingRow[] | undefined;

function invalidateReadMemos(): void {
  graphDocMemo = undefined;
  assetsMemo = undefined;
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
  invalidateReadMemos();
}

/**
 * The real estate: the synthetic ISSUE and SUMMARY nodes are graph furniture, not assets,
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

function currentBands(): AarsBands {
  return settingsStore.getAarsRule().rule.bands;
}

function withBandsApplied(doc: GraphDoc): GraphDoc {
  const nodes = withCurrentBands(doc.nodes, currentBands());
  return nodes === doc.nodes ? doc : { ...doc, nodes };
}

function loadGraphDocUncached(): GraphDoc | null {
  const snap = readGraphSnapshot();
  if (snap) return withRiskNodes(withBandsApplied(normalizeLegacyAars(snap)));

  const assetRows = readAll(TABS.assets);
  if (!assetRows.length) return null;
  const nodes = withCurrentBands(assetRows.map(rowToAsset), currentBands());
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
  return withCurrentBands(loadAssetsRaw(), currentBands());
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
