// Deterministic dry-run seed data, transcribed from the anonymized posture docs in
// ai/ (ai_issues_and_complience_overview.md — the 29 issues in 4 toxic-combination
// groups — and custom_score.md — the applied AARS table). Everything is fixed: no
// Date.now(), no randomness, so dev reloads and tests see identical data.
//
// Volume is deliberately amplified beyond the 14 named agents (extra buckets on the
// autogen agent's service account, extra user accounts on the chatbot) so the graph
// projection's per-kind caps and SUMMARY collapse nodes visibly engage at depth 3.

import { gap } from "../domain/aars";
import type { AarsHints } from "../domain/graphEnrich";
import type { GEdge, GNode, GraphDoc, IssueRow, NodeKind } from "../domain/graphTypes";
import { edgeId } from "../domain/graphTypes";
import { classifyIssue } from "../domain/toxicCombos";

const T0 = "2026-04-02T08:00:00Z"; // firstSeen for long-lived assets
const T1 = "2026-06-28T05:00:00Z"; // lastSeen (the seed "sync" horizon)

interface NodeSeed {
  id: string;
  kind: NodeKind;
  name: string;
  nativeType?: string;
  cloud?: string;
  region?: string;
  status?: string;
  account?: { id: string; name: string };
  projects?: string[];
  internet?: boolean | null;
  sensitiveData?: boolean;
  sensitiveAccess?: boolean;
  highPriv?: boolean;
  adminPriv?: boolean;
  guardrailMissing?: boolean;
}

function node(seed: NodeSeed): GNode {
  return {
    id: seed.id,
    kind: seed.kind,
    name: seed.name,
    nativeType: seed.nativeType,
    cloudPlatform: seed.cloud,
    region: seed.region,
    status: seed.status ?? "Active",
    firstSeen: T0,
    lastSeen: T1,
    isAccessibleFromInternet: seed.internet === undefined ? false : seed.internet,
    hasSensitiveData: seed.sensitiveData ?? false,
    hasAccessToSensitiveData: seed.sensitiveAccess ?? false,
    hasHighPrivileges: seed.highPriv ?? false,
    hasAdminPrivileges: seed.adminPriv ?? false,
    guardrailMissing: seed.guardrailMissing ?? false,
    cloudAccount: seed.account ? { id: seed.account.id, name: seed.account.name } : undefined,
    projects: (seed.projects ?? []).map((name) => ({ id: `proj-${name.toLowerCase()}`, name })),
  };
}

function edge(src: string, type: GEdge["type"], dst: string, accessType?: GEdge["accessType"]): GEdge {
  return { id: edgeId(src, type, dst), src, dst, type, accessType };
}

// ------------------------------------------------------------------ AI agents (GCP)

interface AgentSeed extends Omit<NodeSeed, "kind"> {
  saAccess?: Array<{ target: string; accessType?: GEdge["accessType"] }>;
}

const GCP_MANAGED = "aiplatform#ReasoningEngine";
const GCP_HOSTED = "hostedAiAgent";

function gcpAgent(seed: AgentSeed): NodeSeed {
  return {
    ...seed,
    kind: "AI_AGENT",
    cloud: seed.cloud ?? "GCP",
    nativeType: seed.nativeType ?? GCP_MANAGED,
  };
}

const AGENTS: NodeSeed[] = [
  gcpAgent({
    id: "agent-a", name: "Agent-A", region: "europe-west1",
    account: { id: "gcp-account-01", name: "gcp-account-01" },
    projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-b", name: "Agent-B", region: "us-west1",
    account: { id: "gcp-account-01", name: "gcp-account-01" },
    projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-autogen", name: "AGENT_AUTOGEN_DO_NOT_DELETE", region: "us-west1",
    account: { id: "gcp-account-01", name: "gcp-account-01" },
    projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
    sensitiveAccess: true, highPriv: true, adminPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-d-test", name: "dev-agent-D-test", region: "europe-west3",
    account: { id: "gcp-account-02", name: "gcp-account-02" },
    projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-d", name: "dev-agent-D", region: "europe-west3",
    account: { id: "gcp-account-02", name: "gcp-account-02" },
    projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-e", name: "Agent-E", region: "us-west1",
    account: { id: "gcp-account-03", name: "gcp-account-03" },
    projects: ["PROJECT-ALPHA", "PROJECT-GAMMA"],
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-f", name: "agent-F", region: "europe-west4",
    projects: ["PROJECT-ALPHA"],
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-f-preprod", name: "agent-F-preprod", region: "europe-west4",
    projects: ["PROJECT-ALPHA"],
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-g", name: "Agent-G", region: "europe-west4",
    projects: ["PROJECT-ALPHA", "PROJECT-ETA"],
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-h-chatbot", name: "agent-H-chatbot", region: "europe-west1",
    nativeType: GCP_HOSTED,
    account: { id: "gcp-account-05", name: "gcp-account-05" },
    projects: ["PROJECT-ALPHA", "PROJECT-DELTA", "PROJECT-EPSILON"],
    internet: null, // hosted: exposure inherited from the Cloud Run service
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-i", name: "agent-I", region: "europe-west4",
    nativeType: GCP_HOSTED, status: "Inactive",
    account: { id: "gcp-account-04", name: "gcp-account-04" },
    projects: ["PROJECT-ALPHA", "PROJECT-ZETA"],
    internet: null, // hosted: exposure inherited from the VM
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-j", name: "agent-J", region: "europe-west1",
    account: { id: "gcp-account-07", name: "gcp-account-07" },
    projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
    sensitiveAccess: false, highPriv: true, guardrailMissing: false,
  }),
  gcpAgent({
    id: "agent-k", name: "agent-K", region: "europe-west1",
    account: { id: "gcp-account-07", name: "gcp-account-07" },
    projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
    sensitiveAccess: false, highPriv: true, guardrailMissing: false,
  }),
  // A guardrail-protected agent with no issues — the healthy contrast case.
  gcpAgent({
    id: "agent-l-support", name: "Agent-L-support", region: "europe-west1",
    account: { id: "gcp-account-03", name: "gcp-account-03" },
    projects: ["PROJECT-ALPHA"],
  }),
];

// ------------------------------------------------------- AWS IAM roles (Bedrock G1)

const AWS_ROLE_COUNT = 8;
const awsRoles: NodeSeed[] = [];
for (let i = 1; i <= AWS_ROLE_COUNT; i++) {
  const n = String(i).padStart(2, "0");
  awsRoles.push({
    id: `role-finance-admin-${n}`,
    kind: "ACCESS_ROLE",
    name: `AWSReservedSSO_FinanceAdmin_${n}`,
    nativeType: "role",
    cloud: "AWS",
    account: { id: "aws-account-prod-01", name: "aws-account-prod-01" },
    projects: ["PROJECT-ALPHA"],
    highPriv: true,
    sensitiveAccess: true,
  });
}

// ------------------------------------------------------------- supporting entities

const SUPPORT: NodeSeed[] = [
  // Guardrails (3 in the tenant; only Agent-L is actually protected)
  { id: "guardrail-alpha", kind: "AI_GUARDRAIL", name: "guardrail-alpha", cloud: "GCP", region: "europe-west1", projects: ["PROJECT-ALPHA"] },
  { id: "guardrail-beta", kind: "AI_GUARDRAIL", name: "guardrail-beta", cloud: "GCP", region: "europe-west4", projects: ["PROJECT-ALPHA"] },
  { id: "guardrail-bedrock", kind: "AI_GUARDRAIL", name: "bedrock-guardrail-default", cloud: "AWS", projects: ["PROJECT-ALPHA"] },
  // Models
  { id: "model-bedrock-claude", kind: "AI_MODEL", name: "anthropic.claude-3-5-sonnet", nativeType: "bedrock#foundationModel", cloud: "AWS", account: { id: "aws-account-prod-01", name: "aws-account-prod-01" }, projects: ["PROJECT-ALPHA"] },
  { id: "model-text-embedding-005", kind: "AI_MODEL", name: "text-embedding-005", nativeType: "aiplatform#model", cloud: "GCP", region: "us-west1", status: "Deprecated", projects: ["PROJECT-ALPHA"] },
  // MCP server + pipeline + dataset
  { id: "mcp-internal-tools", kind: "MCP_SERVER", name: "mcp-internal-tools", cloud: "GCP", region: "europe-west1", projects: ["PROJECT-ALPHA"] },
  { id: "pipeline-training-01", kind: "AI_PIPELINE", name: "pipeline-training-01", cloud: "GCP", region: "us-west1", projects: ["PROJECT-ALPHA"] },
  { id: "dataset-support-transcripts", kind: "AI_DATASET", name: "dataset-support-transcripts", cloud: "GCP", region: "europe-west1", sensitiveData: true, projects: ["PROJECT-ALPHA"] },
  // Data resources
  { id: "bucket-customer-pii", kind: "BUCKET", name: "bucket-customer-pii", cloud: "GCP", region: "europe-west1", sensitiveData: true, projects: ["PROJECT-ALPHA"] },
  { id: "bucket-finance-reports", kind: "BUCKET", name: "bucket-finance-reports", cloud: "GCP", region: "europe-west1", sensitiveData: true, projects: ["PROJECT-BETA"] },
  { id: "bucket-partner-data", kind: "BUCKET", name: "bucket-partner-data", cloud: "GCP", region: "europe-west4", sensitiveData: true, projects: ["PROJECT-ETA"] },
  { id: "bucket-pricing-models", kind: "BUCKET", name: "bucket-pricing-models", cloud: "GCP", region: "europe-west4", sensitiveData: true, projects: ["PROJECT-ALPHA"] },
  { id: "bucket-training-data", kind: "BUCKET", name: "bucket-training-data", cloud: "GCP", region: "us-west1", projects: ["PROJECT-ALPHA"] },
  { id: "db-customer-core", kind: "DATABASE", name: "db-customer-core", cloud: "GCP", region: "europe-west1", sensitiveData: true, projects: ["PROJECT-ALPHA"] },
  { id: "db-analytics", kind: "DATABASE", name: "db-analytics", cloud: "GCP", region: "europe-west1", projects: ["PROJECT-DELTA"] },
  // Compute / supply chain for the hosted agents
  { id: "vm-agent-i-host", kind: "VIRTUAL_MACHINE", name: "vm-agent-i-host", cloud: "GCP", region: "europe-west4", internet: false, projects: ["PROJECT-ZETA"] },
  { id: "run-agent-h", kind: "SERVERLESS", name: "cloudrun-agent-h", cloud: "GCP", region: "europe-west1", internet: true, projects: ["PROJECT-DELTA"] },
  { id: "img-agent-h", kind: "CONTAINER_IMAGE", name: "img-agent-h:latest", cloud: "GCP", projects: ["PROJECT-DELTA"] },
  { id: "repo-agent-h", kind: "REPOSITORY", name: "repo-agent-h", projects: ["PROJECT-DELTA"] },
  // CIEM findings
  { id: "finding-ea-autogen", kind: "EXCESSIVE_ACCESS_FINDING", name: "Excessive access: sa-agent-autogen", cloud: "GCP" },
  { id: "finding-ea-agent-h", kind: "EXCESSIVE_ACCESS_FINDING", name: "Excessive access: sa-agent-h", cloud: "GCP" },
  { id: "finding-lm-agent-i", kind: "LATERAL_MOVEMENT_FINDING", name: "Lateral movement: sa-agent-i", cloud: "GCP" },
];

// -------------------------------------------------------------------------- edges

const edges: GEdge[] = [];
const extraNodes: NodeSeed[] = [];

// One service account per GCP agent (execution identity).
const GCP_AGENT_IDS = [
  "agent-a", "agent-b", "agent-autogen", "agent-d-test", "agent-d", "agent-e",
  "agent-f", "agent-f-preprod", "agent-g", "agent-h-chatbot", "agent-i",
  "agent-j", "agent-k", "agent-l-support",
];
for (const agentId of GCP_AGENT_IDS) {
  const saId = `sa-${agentId}`;
  extraNodes.push({
    id: saId,
    kind: "SERVICE_ACCOUNT",
    name: `${saId}@iam.gserviceaccount.com`,
    cloud: "GCP",
    highPriv: agentId !== "agent-l-support",
    sensitiveAccess: !["agent-j", "agent-k", "agent-l-support"].includes(agentId),
  });
  edges.push(edge(agentId, "RUNS_AS", saId));
}

// IAM access from service accounts to data resources (the sensitive-data legs).
const SA_ACCESS: Array<[string, string, GEdge["accessType"]]> = [
  ["sa-agent-a", "bucket-customer-pii", "HIGH_PRIVILEGE"],
  ["sa-agent-a", "db-customer-core", "READ"],
  ["sa-agent-b", "bucket-customer-pii", "HIGH_PRIVILEGE"],
  ["sa-agent-autogen", "bucket-finance-reports", "ADMIN"],
  ["sa-agent-autogen", "db-customer-core", "HIGH_PRIVILEGE"],
  ["sa-agent-d-test", "bucket-training-data", "WRITE"],
  ["sa-agent-d-test", "db-customer-core", "READ"],
  ["sa-agent-d", "bucket-training-data", "WRITE"],
  ["sa-agent-d", "db-customer-core", "READ"],
  ["sa-agent-e", "bucket-customer-pii", "HIGH_PRIVILEGE"],
  ["sa-agent-f", "bucket-pricing-models", "HIGH_PRIVILEGE"],
  ["sa-agent-f-preprod", "bucket-pricing-models", "HIGH_PRIVILEGE"],
  ["sa-agent-g", "bucket-partner-data", "HIGH_PRIVILEGE"],
  ["sa-agent-h-chatbot", "db-customer-core", "HIGH_PRIVILEGE"],
  ["sa-agent-h-chatbot", "db-analytics", "READ"],
  ["sa-agent-i", "bucket-customer-pii", "HIGH_PRIVILEGE"],
  ["sa-agent-j", "db-analytics", "READ"],
  ["sa-agent-k", "db-analytics", "READ"],
];
for (const [sa, target, accessType] of SA_ACCESS) {
  edges.push(edge(sa, "ALLOWS_ACCESS_TO", target, accessType));
}

// CIEM findings on the worst identities.
edges.push(edge("sa-agent-autogen", "HAS_FINDING", "finding-ea-autogen"));
edges.push(edge("sa-agent-h-chatbot", "HAS_FINDING", "finding-ea-agent-h"));
edges.push(edge("sa-agent-i", "HAS_FINDING", "finding-lm-agent-i"));

// AWS Bedrock invocation chain: every FinanceAdmin role can invoke the model; the
// guardrail exists in the tenant but is NOT enforced for these roles (that absence is
// the Group 1 toxic combination — modeled as guardrailMissing on each role).
for (const role of awsRoles) {
  role.guardrailMissing = true;
  edges.push(edge(role.id, "CAN_INVOKE", "model-bedrock-claude"));
}

// Guardrail coverage: only Agent-L is protected.
edges.push(edge("agent-l-support", "PROTECTED_BY", "guardrail-alpha"));
edges.push(edge("model-bedrock-claude", "ENFORCES", "guardrail-bedrock"));

// Hosted agents: compute + supply chain.
edges.push(edge("agent-i", "HOSTED_ON", "vm-agent-i-host"));
edges.push(edge("agent-h-chatbot", "HOSTED_ON", "run-agent-h"));
edges.push(edge("agent-h-chatbot", "BUILT_FROM", "img-agent-h"));
edges.push(edge("img-agent-h", "BUILT_FROM", "repo-agent-h"));

// Model / tool / dataset usage.
edges.push(edge("agent-a", "USES_MODEL", "model-text-embedding-005"));
edges.push(edge("agent-b", "USES_MODEL", "model-text-embedding-005"));
edges.push(edge("agent-h-chatbot", "INVOKES_TOOL", "mcp-internal-tools"));
edges.push(edge("agent-l-support", "INVOKES_TOOL", "mcp-internal-tools"));
edges.push(edge("pipeline-training-01", "USES_DATASET", "dataset-support-transcripts"));
edges.push(edge("dataset-support-transcripts", "STORED_IN", "bucket-customer-pii"));
edges.push(edge("agent-e", "USES_DATASET", "dataset-support-transcripts"));

// Volume amplifiers (cap/collapse demos): the autogen service account reaches many
// buckets; many human identities can reach the customer-facing chatbot.
for (let i = 1; i <= 14; i++) {
  const n = String(i).padStart(2, "0");
  const id = `bucket-autogen-scratch-${n}`;
  extraNodes.push({ id, kind: "BUCKET", name: `bucket-autogen-scratch-${n}`, cloud: "GCP", region: "us-west1", projects: ["PROJECT-BETA"] });
  edges.push(edge("sa-agent-autogen", "ALLOWS_ACCESS_TO", id, "WRITE"));
}
for (let i = 1; i <= 12; i++) {
  const n = String(i).padStart(2, "0");
  const id = `user-ops-${n}`;
  extraNodes.push({ id, kind: "USER_ACCOUNT", name: `ops.user${n}@example.com`, cloud: "GCP" });
  edges.push(edge(id, "ALLOWS_ACCESS_TO", "agent-h-chatbot", i <= 2 ? "ADMIN" : "READ"));
}

// -------------------------------------------------------------------------- issues

interface IssueSeed {
  id: string;
  ruleId: string;
  ruleName: string;
  assetId: string;
  assetName: string;
  nativeSeverity: "MEDIUM" | "LOW";
  region?: string;
  account?: string;
  projects?: string[];
  justification: string;
  frameworks: IssueRow["frameworks"];
  createdAt: string;
}

function issue(seed: IssueSeed): IssueRow {
  const group = classifyIssue({ sourceRuleId: seed.ruleId, ruleName: seed.ruleName });
  return {
    id: seed.id,
    ruleId: seed.ruleId,
    ruleName: seed.ruleName,
    comboGroup: group ? group.id : "",
    nativeSeverity: seed.nativeSeverity,
    adjustedSeverity: group ? group.adjustedSeverity : seed.nativeSeverity,
    status: "OPEN",
    assetId: seed.assetId,
    assetName: seed.assetName,
    region: seed.region,
    account: seed.account,
    projects: seed.projects,
    frameworks: seed.frameworks,
    justification: seed.justification,
    createdAt: seed.createdAt,
  };
}

const RULE_G1 = "Allow model invoke without Guardrail for user or role";
const RULE_G2 = "Managed AI Agent with high privileges or sensitive data access";
const RULE_G3 = "AI Agent hosted on VM/serverless with high privileges or sensitive data access";
const RULE_G4 = "AI resource using overly permissive execution identity";

const issues: IssueRow[] = [];
let issueSeq = 0;
function nextIssueId(): string {
  issueSeq += 1;
  return `iss-${String(issueSeq).padStart(3, "0")}`;
}

// Group 1 — 8 Bedrock roles (MEDIUM → HIGH).
for (const role of awsRoles) {
  issues.push(issue({
    id: nextIssueId(),
    ruleId: "wc-id-2742",
    ruleName: RULE_G1,
    assetId: role.id,
    assetName: role.name,
    nativeSeverity: "MEDIUM",
    account: "aws-account-prod-01",
    projects: ["PROJECT-ALPHA"],
    justification:
      "No content filtering, data protection, or compliance enforcement on AI model calls.",
    frameworks: { owaspLlm: ["LLM06", "LLM02"], owaspAgentic: ["ASI02", "ASI03"], fiveRs: ["Restrict"] },
    createdAt: "2026-05-14T09:12:00Z",
  }));
}

// Group 2 — 13 managed-agent issues (MEDIUM → HIGH).
const G2: Array<{ assetId: string; count: number; llm: string[]; asi: string[]; ml?: string[]; fiveRs: string[]; why: string }> = [
  { assetId: "agent-a", count: 1, llm: ["LLM06", "LLM01"], asi: ["ASI03", "ASI01"], ml: ["Data Poisoning"], fiveRs: ["Restrict"], why: "Prompt injection reaches PII and credentials; 5Rs gap confirms data is not restricted." },
  { assetId: "agent-b", count: 1, llm: ["LLM06", "LLM01"], asi: ["ASI03", "ASI01"], ml: ["Data Poisoning"], fiveRs: ["Restrict"], why: "Over-privileged IAM on a customer-facing managed agent." },
  { assetId: "agent-autogen", count: 4, llm: ["LLM06", "LLM07"], asi: ["ASI10"], ml: ["Supply Chain"], fiveRs: ["Reduce", "Restrict"], why: "Auto-generated agent — likely forgotten, still over-privileged." },
  { assetId: "agent-d-test", count: 1, llm: ["LLM06", "LLM04"], asi: ["ASI03", "ASI06"], ml: ["Data Poisoning"], fiveRs: ["Reconfigure"], why: "Dev/test agent with prod-level IAM — violates least privilege." },
  { assetId: "agent-d", count: 1, llm: ["LLM06", "LLM04"], asi: ["ASI03", "ASI06"], ml: ["Data Poisoning"], fiveRs: ["Reconfigure"], why: "Dev agent with excessive IAM — training-data exposure risk." },
  { assetId: "agent-e", count: 1, llm: ["LLM06", "LLM02"], asi: ["ASI03", "ASI01"], ml: ["Input Manipulation"], fiveRs: ["Restrict"], why: "Innovation agent with sensitive data access and no guardrail." },
  { assetId: "agent-f", count: 1, llm: ["LLM06", "LLM02"], asi: ["ASI03", "ASI02"], ml: ["Model Theft"], fiveRs: ["Restrict"], why: "Pricing agent with financial data access — high business impact." },
  { assetId: "agent-f-preprod", count: 1, llm: ["LLM06", "LLM02"], asi: ["ASI03", "ASI02"], ml: ["Model Theft"], fiveRs: ["Reconfigure"], why: "Pre-prod pricing agent — same risk as prod." },
  { assetId: "agent-g", count: 2, llm: ["LLM06", "LLM02"], asi: ["ASI03", "ASI01"], ml: ["Data Poisoning"], fiveRs: ["Restrict"], why: "Business-partner data agent — PII and partner-data exposure risk." },
];
for (const g of G2) {
  const asset = AGENTS.find((a) => a.id === g.assetId)!;
  for (let i = 0; i < g.count; i++) {
    issues.push(issue({
      id: nextIssueId(),
      ruleId: "wc-id-3217",
      ruleName: RULE_G2,
      assetId: asset.id,
      assetName: asset.name,
      nativeSeverity: "MEDIUM",
      region: asset.region,
      account: asset.account?.name,
      projects: asset.projects,
      justification: g.why,
      frameworks: { owaspLlm: g.llm, owaspAgentic: g.asi, owaspMl: g.ml, fiveRs: g.fiveRs },
      createdAt: "2026-05-20T11:40:00Z",
    }));
  }
}

// Group 3 — 6 hosted-agent issues (MEDIUM → HIGH): agent-I ×4, agent-H ×2.
const G3: Array<{ assetId: string; count: number; llm: string[]; asi: string[]; why: string; fiveRs: string[] }> = [
  { assetId: "agent-i", count: 4, llm: ["LLM06", "LLM01"], asi: ["ASI03", "ASI05"], fiveRs: ["Restrict", "Reduce"], why: "Inactive agents still holding sensitive data access — lateral-movement risk via compromised compute." },
  { assetId: "agent-h-chatbot", count: 2, llm: ["LLM06", "LLM02", "LLM05"], asi: ["ASI02", "ASI03"], fiveRs: ["Restrict"], why: "Chatbot agent on serverless with excessive IAM — user-facing attack surface." },
];
for (const g of G3) {
  const asset = AGENTS.find((a) => a.id === g.assetId)!;
  for (let i = 0; i < g.count; i++) {
    issues.push(issue({
      id: nextIssueId(),
      ruleId: "wc-id-3230",
      ruleName: RULE_G3,
      assetId: asset.id,
      assetName: asset.name,
      nativeSeverity: "MEDIUM",
      region: asset.region,
      account: asset.account?.name,
      projects: asset.projects,
      justification: g.why,
      frameworks: { owaspLlm: g.llm, owaspAgentic: g.asi, fiveRs: g.fiveRs },
      createdAt: "2026-06-03T07:25:00Z",
    }));
  }
}

// Group 4 — 2 permissive-identity issues (LOW → MEDIUM).
for (const assetId of ["agent-j", "agent-k"]) {
  const asset = AGENTS.find((a) => a.id === assetId)!;
  issues.push(issue({
    id: nextIssueId(),
    ruleId: "wc-id-3123",
    ruleName: RULE_G4,
    assetId: asset.id,
    assetName: asset.name,
    nativeSeverity: "LOW",
    region: asset.region,
    account: asset.account?.name,
    projects: asset.projects,
    justification:
      "Latent privileges — a compromised agent inherits every permission of its execution identity.",
    frameworks: { owaspAgentic: ["ASI03"], fiveRs: ["Reconfigure"] },
    createdAt: "2026-06-10T15:02:00Z",
  }));
}

// ------------------------------------------------------ per-asset AARS pillar inputs
// Transcribed from the applied table in ai/custom_score.md (normative). Live syncs
// derive these heuristically (graphEnrich.deriveAarsInput); dry-run pins the doc.

const HINTS: AarsHints = {
  "agent-a": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-b": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-autogen": { gaps: [gap("LLM06"), gap("ASI10"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-d-test": { gaps: [gap("LLM04"), gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-d": { gaps: [gap("LLM04"), gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-e": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-f": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-f-preprod": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-g": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-h-chatbot": { gaps: [gap("LLM06"), gap("LLM05"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-i": { gaps: [gap("LLM06"), gap("NO_GUARDRAIL")], dataExposure: "SENSITIVE" },
  "agent-j": { gaps: [gap("ASI03")], dataExposure: "DATA_ACCESS" },
  "agent-k": { gaps: [gap("ASI03")], dataExposure: "DATA_ACCESS" },
  // Deprecated-model usage shows up on the model itself, not the agents.
  "model-text-embedding-005": { gaps: [gap("DEPRECATED_MODEL")], dataExposure: "NONE" },
};
for (const role of awsRoles) {
  HINTS[role.id] = {
    gaps: [gap("LLM01"), gap("LLM02"), gap("ASI02")],
    dataExposure: "DATA_ACCESS",
  };
}

// ------------------------------------------------------------------------- exports

export const SEED_NODES: GNode[] = [...AGENTS, ...awsRoles, ...SUPPORT, ...extraNodes].map(node);
export const SEED_EDGES: GEdge[] = edges;
export const SEED_ISSUES: IssueRow[] = issues;
export const SEED_AARS_HINTS: AarsHints = HINTS;

/** The raw (un-enriched) seed graph; persistSync enriches it like a live sync. */
export function seedGraphDoc(syncedAt: string): GraphDoc {
  return { nodes: SEED_NODES, edges: SEED_EDGES, syncedAt };
}
