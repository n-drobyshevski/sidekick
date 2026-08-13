// The graph model: typed nodes (AI assets, supporting infrastructure, findings, and
// synthetic issue/summary nodes) and typed edges (the Wiz security-graph relationship
// vocabulary, from ai/ai_agents_discovery_queries.md and ai/queries/*).

import type { AarsGap, DataExposure, InternetExposure } from "./aars";
import type { AarsSeverity, Severity } from "./config";
import { SEVERITY_ORDER } from "./config";

/**
 * Position on the severity scale, LOWER = WORSE, with anything unrecognised sorting last.
 *
 * Graph-local on purpose. It lived as three byte-identical private copies in graphEnrich,
 * graphProject and graphLayout; it is not in severity.ts because that file is declared the
 * port of wiz_dashboard/domain/severity.py and this helper has no Python twin.
 *
 * Note the sign: assetTable.ts has its own `sevRank` built on an INVERTED scale
 * (higher = worse) for column sorting. The two look alike and mean opposite things — do
 * not fold them together.
 */
export function severityRank(s: string | undefined): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(s ?? "");
  return i === -1 ? SEVERITY_ORDER.length : i;
}

export const NODE_KINDS = [
  // AI assets (Wiz AI-SPM resource types)
  "AI_AGENT", "AI_MODEL", "AI_GUARDRAIL", "AI_PIPELINE", "AI_DATASET", "MCP_SERVER",
  // AI assets seen in real tenants (Wiz inventory display names, normalized) —
  // appended so the original kinds keep their declaration order.
  "AI_AGENT_REGISTRY", "AI_DEPLOYMENT", "AI_EXTENSION", "AI_GATEWAY",
  "AI_SERVICE", "AI_SKILL", "AI_SKILL_TEMPLATE", "AI_TOOL",
  // identities
  "SERVICE_ACCOUNT", "USER_ACCOUNT", "ACCESS_ROLE", "ACCESS_ROLE_BINDING", "ACCESS_KEY",
  // data
  "BUCKET", "DATABASE",
  // compute / supply chain
  "VIRTUAL_MACHINE", "SERVERLESS", "CONTAINER_IMAGE", "REPOSITORY",
  // CIEM finding entities
  "EXCESSIVE_ACCESS_FINDING", "LATERAL_MOVEMENT_FINDING",
  // Synthesized from the identity-access scan: one per AI asset a HUMAN identity can reach
  // at high privilege. Declared beside the CIEM findings rather than with the other
  // synthetic kinds below, so the grouped layout files it with the access finding it
  // complements — that layout orders its blocks by this list.
  "IDENTITY_ACCESS_FINDING",
  // synthetic
  "ISSUE",    // one node per open risk issue (toxic-combination instance)
  "SUMMARY",  // collapse node: "+N more <kind>" emitted by the projection
  "SENSITIVE_DATA",     // one node per data-exposed asset (AARS pillar C topology)
  "INTERNET_EXPOSURE",  // one node per internet-exposed asset (exposure topology)
  "EXCESSIVE_PRIVILEGE", // one node per over-privileged asset (CIEM rights topology)
  "MISSING_GUARDRAIL",   // one node per unguarded AI asset (guardrail-coverage topology)
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * Risk evidence: nodes that exist only to say something about the asset they hang off,
 * as opposed to inventory the tenant owns. They carry no cloud, project, or (for the
 * derived ones) severity of their own, so the graph's inventory filters skip them and
 * the grouped layout resolves their bucket from their parent — otherwise a node-type or
 * cloud filter silently severs the attack path it is meant to narrow.
 */
export const RISK_NODE_KINDS: readonly NodeKind[] = [
  "ISSUE", "SENSITIVE_DATA", "INTERNET_EXPOSURE", "EXCESSIVE_PRIVILEGE", "MISSING_GUARDRAIL",
  "EXCESSIVE_ACCESS_FINDING", "LATERAL_MOVEMENT_FINDING", "IDENTITY_ACCESS_FINDING",
];

export function isRiskKind(kind: string): boolean {
  return (RISK_NODE_KINDS as readonly string[]).includes(kind);
}

/** AI-SPM asset kinds — the graph's focal nodes and default seeds. */
export const AI_ASSET_KINDS: readonly NodeKind[] = [
  "AI_AGENT", "AI_MODEL", "AI_GUARDRAIL", "AI_PIPELINE", "AI_DATASET", "MCP_SERVER",
  "AI_AGENT_REGISTRY", "AI_DEPLOYMENT", "AI_EXTENSION", "AI_GATEWAY",
  "AI_SERVICE", "AI_SKILL", "AI_SKILL_TEMPLATE", "AI_TOOL",
];

/**
 * A Wiz `type` value → NodeKind, tolerant of both spellings real tenants use:
 * enum-style ("AI_AGENT") and inventory display names ("AI Agent Registry").
 * Normalization is mechanical (uppercase, non-alphanumerics → "_"), then a
 * membership check; unknown types map to null and the row is skipped.
 */
export function kindFromWizType(t: unknown): NodeKind | null {
  if (typeof t !== "string" || !t.trim()) return null;
  const norm = t.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return (NODE_KINDS as readonly string[]).includes(norm) ? (norm as NodeKind) : null;
}

export const EDGE_TYPES = [
  "HAS_ISSUE",            // asset → ISSUE
  "PROTECTED_BY",         // AI_AGENT → AI_GUARDRAIL (negated = guardrail MISSING)
  "RUNS_AS",              // AI_AGENT → SERVICE_ACCOUNT (execution identity)
  "ALLOWS_ACCESS_TO",     // identity → resource (IAM; carries accessType)
  "HAS_FINDING",          // identity → EXCESSIVE_ACCESS/LATERAL_MOVEMENT finding
  "USES",                 // generic dependency
  "USES_TOOL",            // AI_AGENT → SERVERLESS / tool
  "INVOKES_TOOL",         // AI_AGENT → MCP_SERVER / AI_AGENT
  "USES_MODEL",           // AI_AGENT → AI_MODEL
  "USES_DATASET",         // AI_AGENT → AI_DATASET
  "STORED_IN",            // AI_DATASET → BUCKET
  "HOSTED_ON",            // hosted AI_AGENT → VIRTUAL_MACHINE / SERVERLESS
  "BUILT_FROM",           // AI_AGENT → CONTAINER_IMAGE → REPOSITORY
  "CAN_INVOKE",           // ACCESS_ROLE → AI_MODEL (Bedrock)
  "ENFORCES",             // AI_MODEL → AI_GUARDRAIL
  "BOUND_TO",             // ACCESS_ROLE_BINDING → identity
  "PERMITS_ACCESS_ROLE",  // ACCESS_ROLE_BINDING → ACCESS_ROLE
  "HAS_SENSITIVE_DATA",           // asset → SENSITIVE_DATA (holds sensitive data)
  "HAS_ACCESS_TO_SENSITIVE_DATA", // identity/agent → SENSITIVE_DATA (can reach it)
  "EXPOSED_TO_INTERNET",          // asset → INTERNET_EXPOSURE (reachable from the internet)
  "HAS_EXCESSIVE_PRIVILEGE",      // asset/identity → EXCESSIVE_PRIVILEGE (admin or high rights)
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export type AccessType = "READ" | "WRITE" | "ADMIN" | "HIGH_PRIVILEGE";

export interface GNode {
  id: string;
  kind: NodeKind;
  name: string;
  nativeType?: string;
  cloudPlatform?: string;
  region?: string;
  status?: string;
  firstSeen?: string;
  lastSeen?: string;
  externalId?: string;
  // Exposure flags: true/false when Wiz determined them, null when exposure is
  // inherited from underlying compute and undetermined (hosted agents).
  isAccessibleFromInternet?: boolean | null;
  isOpenToAllInternet?: boolean | null;
  hasSensitiveData?: boolean;
  hasAccessToSensitiveData?: boolean;
  hasAdminPrivileges?: boolean;
  hasHighPrivileges?: boolean;
  // Guardrail-coverage scan result (PROTECTED_BY with negate:true): the protective
  // edge is ABSENT. A node flag, not a negated edge — there is no real guardrail
  // endpoint to point at; the client renders it as a dashed "no guardrail" stub.
  guardrailMissing?: boolean;
  cloudAccount?: { id: string; name: string; externalId?: string; cloudProvider?: string };
  projects?: Array<{ id: string; name: string; businessImpact?: string }>;
  tags?: Array<{ key: string; value: string }>;
  technologyCategories?: string[]; // Wiz technology.categories[].name (e.g. "AI Service")
  // Agentic-identity enrichment (cloudResourcesV2 + identityPurpose:AGENTIC):
  identityPurpose?: string; // "AGENTIC" for agent execution identities
  issueAnalytics?: {        // per-identity related-issue severity rollup (display-only)
    total: number;
    info: number;
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  // Enrichment, computed once at sync time and persisted:
  severity?: Severity;      // worst attached open-issue severity (ISSUE nodes: own severity)
  aars?: number;            // AI Asset Risk Score 0–100 (AI assets only)
  aarsSeverity?: AarsSeverity;
  aarsPillars?: { toxic: number; compliance: number; data: number; exposure?: number };
  /**
   * What the score was computed FROM, minus the issue severities (those stay in the issues
   * tab and are read back from it). Persisted because the inputs are not otherwise
   * recoverable: a dry-run sync scores from hints pinned to ai/custom_score.md, and a live
   * sync from findings that may since have changed. Re-pricing these under a new rule is
   * what "recompute" means — re-deriving them would answer a different question.
   */
  aarsInput?: {
    gaps: AarsGap[];
    dataExposure: DataExposure;
    /** Absent on rows persisted before pillar D existed; re-derived on the next enrich. */
    internetExposure?: InternetExposure;
  };
  comboGroups?: string[];   // toxic-combination group ids this node participates in
  // SUMMARY nodes only:
  summaryOf?: NodeKind;
  summaryCount?: number;
  memberIds?: string[];
}

export interface GEdge {
  id: string; // deterministic: edgeId(src, type, dst, negated)
  src: string;
  dst: string;
  type: EdgeType;
  negated?: boolean;   // PROTECTED_BY negate:true — the protective edge is ABSENT
  accessType?: AccessType;
}

export interface GraphDoc {
  nodes: GNode[];
  edges: GEdge[];
  syncedAt: string;
}

/** Deterministic edge identity — dedupe key across sync steps. */
export function edgeId(src: string, type: EdgeType, dst: string, negated?: boolean): string {
  return `${src}|${type}|${dst}${negated ? "|neg" : ""}`;
}

/** Open-issue row shape shared by the issues tab, fixtures, and enrichment. */
export interface IssueRow {
  id: string;
  ruleId: string;
  ruleName: string;
  comboGroup: string;          // ComboGroup.id; OTHER_GROUP_ID when no rule pattern matched
  nativeSeverity: Severity;
  adjustedSeverity: Severity;
  status: string;              // OPEN / RESOLVED / ...
  assetId: string;
  assetName: string;
  region?: string;
  account?: string;
  projects?: string[];
  frameworks?: {
    owaspLlm?: string[];
    owaspAgentic?: string[];
    owaspMl?: string[];
    fiveRs?: string[];
  };
  justification?: string;
  createdAt?: string;
  dueAt?: string;                    // issuesV2 dueAt (SLA deadline)
  resolutionRecommendation?: string; // sourceRule control recommendation (issuesV2)
  remediation?: string;              // config-finding remediation text (Phase 2)

  // ---- issuesV2 lifecycle and context (exemples/risk_issues_response.js)
  // All optional: the per-rule Q_RULE_ASSETS fallback synthesises issues from the
  // inventory API, which carries none of this, so absent means "not captured" and
  // never "not true".
  issueType?: string;                // TOXIC_COMBINATION | CLOUD_CONFIGURATION
  updatedAt?: string;
  resolvedAt?: string;
  resolutionReason?: string;
  resolvedBy?: string;               // user name/email, else service-account name
  assignee?: string;
  environments?: string[];
  validatedAsExploitable?: boolean;
  businessImpact?: string;           // worst of projects[].riskProfile.businessImpact
  entityStatus?: string;             // entitySnapshot.status — Active | Inactive
  subscriptionId?: string;
  /** The "Ignored (By Design) …" rationale, when one is on the note log. */
  ignoreNote?: string;
  /** rejectionExpiredAt — when an accepted-risk decision lapsed and reopened the issue. */
  ignoreExpiredAt?: string;
  ticketUrls?: string[];
  aiVerdict?: string;                // aiRemediationAnalysis.verdict, e.g. REMEDIATE
  aiRecommendedSeverity?: Severity;
}

/**
 * A failing compliance-configuration finding (configurationFindings), keyed to the
 * resource it fails on. Feeds AARS pillar B (one gap per distinct failing control)
 * and carries the human remediation text. `frameworkCodes` are the AARS gap codes the
 * finding contributes (rule shortId + any recognizable OWASP token on the rule).
 */
export interface FindingRow {
  id: string;
  resourceId: string;
  ruleShortId: string;
  severity: Severity;
  remediation?: string;
  frameworkCodes: string[];
}
