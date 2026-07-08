// The graph model: typed nodes (AI assets, supporting infrastructure, findings, and
// synthetic issue/summary nodes) and typed edges (the Wiz security-graph relationship
// vocabulary, from ai/ai_agents_discovery_queries.md and ai/queries/*).

import type { AarsBand, Severity } from "./config";

export const NODE_KINDS = [
  // AI assets (Wiz AI-SPM resource types)
  "AI_AGENT", "AI_MODEL", "AI_GUARDRAIL", "AI_PIPELINE", "AI_DATASET", "MCP_SERVER",
  // AI assets seen in real tenants (Wiz inventory display names, normalized) —
  // appended so the original kinds keep their declaration order.
  "AI_AGENT_REGISTRY", "AI_DEPLOYMENT", "AI_EXTENSION", "AI_GATEWAY",
  "AI_SERVICE", "AI_SKILL", "AI_SKILL_TEMPLATE", "AI_TOOL",
  // identities
  "SERVICE_ACCOUNT", "USER_ACCOUNT", "ACCESS_ROLE", "ACCESS_ROLE_BINDING",
  // data
  "BUCKET", "DATABASE",
  // compute / supply chain
  "VIRTUAL_MACHINE", "SERVERLESS", "CONTAINER_IMAGE", "REPOSITORY",
  // CIEM finding entities
  "EXCESSIVE_ACCESS_FINDING", "LATERAL_MOVEMENT_FINDING",
  // synthetic
  "ISSUE",    // one node per open risk issue (toxic-combination instance)
  "SUMMARY",  // collapse node: "+N more <kind>" emitted by the projection
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

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
  // Enrichment, computed once at sync time and persisted:
  severity?: Severity;      // worst attached open-issue severity (ISSUE nodes: own severity)
  aars?: number;            // AI Asset Risk Score 0–100 (AI assets only)
  aarsBand?: AarsBand;
  aarsPillars?: { toxic: number; compliance: number; data: number };
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
  comboGroup: string;          // ComboGroup.id, "" when unclassified
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
}
