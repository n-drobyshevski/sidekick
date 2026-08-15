// Deterministic dry-run seed data, transcribed from the anonymized posture docs in
// ai/ (ai_issues_and_complience_overview.md — the 29 issues in 4 toxic-combination
// groups — and custom_score.md — the applied AARS table). Everything is fixed: no
// Date.now(), no randomness, so dev reloads and tests see identical data.
//
// 32 issues, not 29: the live filter collects the whole AI risk category, so the seed
// carries three rows matching no modelled pattern (they land in Other AI risk) and one
// in-progress row. Without them the dry-run demo would show an empty Other card and no
// remediation in flight — features the register has but the default experience wouldn't.
//
// Volume is deliberately amplified beyond the 14 named agents (extra buckets on the
// autogen agent's service account, extra user accounts on the chatbot) so the graph
// projection's per-kind caps and SUMMARY collapse nodes visibly engage at depth 3.

import { gap } from "../domain/aars";
import type { AarsHints } from "../domain/graphEnrich";
import type { EffectiveAccessRow } from "../domain/effectiveAccess";
import type {
  ConfigRuleRow, DataFindingRow, FindingRow, FrameworkPolicyRow, FrameworkRow, GEdge, GNode,
  GraphDoc, IdentityFindingRow, IssueRow, NodeKind, PostureRow,
} from "../domain/graphTypes";
import { edgeId } from "../domain/graphTypes";
import { classifyIssue, OTHER_GROUP_ID } from "../domain/toxicCombos";

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
  openInternet?: boolean | null;
  sensitiveData?: boolean;
  sensitiveAccess?: boolean;
  highPriv?: boolean;
  adminPriv?: boolean;
  guardrailMissing?: boolean;
  techCats?: string[];
  identityPurpose?: string;
  issueAnalytics?: GNode["issueAnalytics"];
  exposureLevel?: string;
  portValidation?: string;
  exposureEvidence?: GNode["exposureEvidence"];
  inactive?: boolean;
  inactiveTimeframe?: string;
  displayName?: string;
  email?: string;
  publisher?: string;
  discoveryMethods?: string[];
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
    isOpenToAllInternet: seed.openInternet === undefined ? false : seed.openInternet,
    hasSensitiveData: seed.sensitiveData ?? false,
    hasAccessToSensitiveData: seed.sensitiveAccess ?? false,
    hasHighPrivileges: seed.highPriv ?? false,
    hasAdminPrivileges: seed.adminPriv ?? false,
    guardrailMissing: seed.guardrailMissing ?? false,
    cloudAccount: seed.account ? { id: seed.account.id, name: seed.account.name } : undefined,
    projects: (seed.projects ?? []).map((name) => ({ id: `proj-${name.toLowerCase()}`, name })),
    technologyCategories: seed.techCats,
    identityPurpose: seed.identityPurpose,
    issueAnalytics: seed.issueAnalytics,
    // Left undefined unless a seed sets them, so every node that is not an endpoint or an
    // exposed host reads back exactly as it did before these columns existed.
    exposureLevel: seed.exposureLevel,
    portValidation: seed.portValidation,
    exposureEvidence: seed.exposureEvidence,
    inactive: seed.inactive,
    inactiveTimeframe: seed.inactiveTimeframe,
    displayName: seed.displayName,
    email: seed.email,
    publisher: seed.publisher,
    discoveryMethods: seed.discoveryMethods,
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
  const nativeType = seed.nativeType ?? GCP_MANAGED;
  return {
    ...seed,
    kind: "AI_AGENT",
    cloud: seed.cloud ?? "GCP",
    nativeType,
    techCats: seed.techCats ?? ["AI Service"],
    // How Wiz found it, mirroring the tenant capture: a managed ReasoningEngine comes from the
    // cloud API, a hosted agent from scanning the workload it runs in. `publisher` is
    // deliberately NOT defaulted — it is null on most agents in that same capture, and the
    // register has to render that honestly rather than showing a value for everything.
    discoveryMethods: seed.discoveryMethods
      ?? [nativeType === GCP_HOSTED ? "MethodWorkloadScanning" : "MethodCloudScanning"],
  };
}

const AGENTS: NodeSeed[] = [
  gcpAgent({
    id: "agent-a", name: "Agent-A", region: "europe-west1",
    account: { id: "gcp-account-01", name: "gcp-account-01" },
    projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
    // Two of the fourteen carry a publisher, matching the shape of the real tenant, where the
    // field is populated for a handful of hand-built agents and null for the rest. The dry run
    // has to exercise BOTH paths or the "—" cell never gets looked at.
    publisher: "Platform Engineering",
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
    internet: true, openInternet: true, // demonstrates the internet-exposure topology node
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
    internet: null, openInternet: null, // hosted: exposure inherited from the Cloud Run service
    sensitiveAccess: true, highPriv: true, guardrailMissing: true,
  }),
  gcpAgent({
    id: "agent-i", name: "agent-I", region: "europe-west4",
    nativeType: GCP_HOSTED, status: "Inactive",
    account: { id: "gcp-account-04", name: "gcp-account-04" },
    projects: ["PROJECT-ALPHA", "PROJECT-ZETA"],
    internet: null, openInternet: null, // hosted: exposure inherited from the VM
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
  { id: "run-agent-h", kind: "SERVERLESS", name: "cloudrun-agent-h", cloud: "GCP", region: "europe-west1", internet: true, openInternet: true, projects: ["PROJECT-DELTA"], exposureEvidence: { ports: ["443", "80"], sourceIpRanges: ["0.0.0.0/0"] } },
  // Network exposure, seeded to put BOTH grades of evidence on one screen and to make them
  // visibly disagree — which is the whole reason the two queries are two steps.
  //
  //   endpoint-agent-h   Low  + Open, on the internet-reachable Cloud Run revision.
  //                      This is the capture's own shape (exemples/ai_exposure_host_response.js):
  //                      openToAllInternet, ports 80 and 443 open to 0.0.0.0/0, and both
  //                      endpoints rated Low because they redirect to SSO. agent-h-chatbot
  //                      is therefore exposed VIA ITS HOST and NOT validated.
  //   endpoint-agent-i   High + Open, served directly by an agent whose VM is NOT reachable.
  //                      The mirror image: validated, with no host exposure behind it.
  //
  // Between them the dry run exercises every branch of withExposureEvidence, including the
  // one that must NOT fire.
  { id: "endpoint-agent-h", kind: "ENDPOINT", name: "https://agent-h-chatbot.a.run.app:443", cloud: "GCP", region: "europe-west1", exposureLevel: "Low", portValidation: "Open", projects: ["PROJECT-DELTA"] },
  { id: "endpoint-agent-i", kind: "ENDPOINT", name: "https://agent-i.internal-tools.example:8443", cloud: "GCP", region: "europe-west4", exposureLevel: "High", portValidation: "Open", projects: ["PROJECT-ZETA"] },
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
// The human title an operator gave the account, where one was given. Deliberately partial:
// Wiz returns `displayName` for accounts somebody named and nothing for the rest, and a
// register that showed a friendly name for every row would be describing a tenant nobody has.
const SA_DISPLAY_NAMES: Record<string, string> = {
  "agent-a": "Vertex AI Agent Service Account",
  "agent-b": "Vertex AI Reasoning Agent Identity",
  "agent-h-chatbot": "Support chatbot runtime identity",
  "agent-l-support": "Support agent (read-only)",
};

for (const agentId of GCP_AGENT_IDS) {
  const saId = `sa-${agentId}`;
  const highPriv = agentId !== "agent-l-support";
  extraNodes.push({
    id: saId,
    kind: "SERVICE_ACCOUNT",
    name: `${saId}@iam.gserviceaccount.com`,
    displayName: SA_DISPLAY_NAMES[agentId],
    email: `${saId}@iam.gserviceaccount.com`,
    cloud: "GCP",
    highPriv,
    sensitiveAccess: !["agent-j", "agent-k", "agent-l-support"].includes(agentId),
    // These execution identities are agentic (identityPurpose:AGENTIC in Wiz); a small
    // related-issue rollup drives the inventory "Agentic identities" KPI + the badge.
    identityPurpose: "AGENTIC",
    techCats: ["Identity"],
    issueAnalytics: highPriv
      ? { total: 1, info: 0, low: 0, medium: 1, high: 0, critical: 0 }
      : { total: 0, info: 0, low: 0, medium: 0, high: 0, critical: 0 },
  });
  edges.push(edge(agentId, "RUNS_AS", saId));
}

// An agentic ACCESS_KEY (long-lived credential) — exercises the ACCESS_KEY node kind.
extraNodes.push({
  id: "key-agent-autogen",
  kind: "ACCESS_KEY",
  name: "AKIA-AUTOGEN-AGENT-KEY",
  cloud: "AWS",
  identityPurpose: "AGENTIC",
  sensitiveAccess: true,
  issueAnalytics: { total: 2, info: 0, low: 1, medium: 1, high: 0, critical: 0 },
});
edges.push(edge("agent-autogen", "RUNS_AS", "key-agent-autogen"));

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
// Network exposure. The endpoint hangs off the HOST for the Cloud Run agent and off the
// AGENT for the VM-hosted one, which is exactly the two shapes withExposureEvidence has to
// walk — the live host-exposure query returns applicationEndpoints on the workload, and the
// endpoint-exposure query returns them on the AI asset.
edges.push(edge("run-agent-h", "SERVES", "endpoint-agent-h"));
edges.push(edge("agent-i", "SERVES", "endpoint-agent-i"));
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
// Twelve operators on the customer-facing chatbot, two of them admins — and the READ ten are
// there to be excluded. A live IDENTITY_ACCESS sync only ever returns ADMIN and
// HIGH_PRIVILEGE bindings, so a figure that counted all twelve would read as "human reach"
// while meaning something no tenant can reproduce.
//
// One admin is DORMANT. That pairing is the whole reason identity dormancy is collected: an
// account nobody has used in ninety days that still holds admin on an internet-reachable
// agent is a backdoor with no one watching it. `user-ops-02` is deliberately the inactive
// one, and `user-ops-03` carries an explicit `inactive: false` so the dry run exercises
// "reported active" as well as "reported dormant" and "never reported".
for (let i = 1; i <= 12; i++) {
  const n = String(i).padStart(2, "0");
  const id = `user-ops-${n}`;
  const seed: NodeSeed = {
    id, kind: "USER_ACCOUNT", name: `ops.user${n}@example.com`, cloud: "GCP",
  };
  if (i === 2) {
    seed.inactive = true;
    seed.inactiveTimeframe = "Inactive90Days";
  } else if (i === 3) {
    seed.inactive = false;
    seed.inactiveTimeframe = "Active";
  }
  extraNodes.push(seed);
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
  dueAt?: string;
  resolutionRecommendation?: string;
  // The issuesV2 half. Optional so the existing seeds stay as they were; a handful of
  // rows below set them so the dry-run demo shows the shape a live sync produces.
  status?: string;
  issueType?: string;
  updatedAt?: string;
  assignee?: string;
  environments?: string[];
  businessImpact?: string;
  entityStatus?: string;
  ignoreNote?: string;
  ignoreExpiredAt?: string;
  ticketUrls?: string[];
  aiVerdict?: string;
  aiRecommendedSeverity?: IssueRow["aiRecommendedSeverity"];
}

function issue(seed: IssueSeed): IssueRow {
  const group = classifyIssue({ sourceRuleId: seed.ruleId, ruleName: seed.ruleName });
  const row: IssueRow = {
    id: seed.id,
    ruleId: seed.ruleId,
    ruleName: seed.ruleName,
    // An unmodelled rule lands in Other rather than "" — the same bucket a live sync
    // would give it, so the dry-run demo shows the register the real one produces.
    comboGroup: group ? group.id : OTHER_GROUP_ID,
    nativeSeverity: seed.nativeSeverity,
    adjustedSeverity: group ? group.adjustedSeverity : seed.nativeSeverity,
    status: seed.status ?? "OPEN",
    assetId: seed.assetId,
    assetName: seed.assetName,
    region: seed.region,
    account: seed.account,
    projects: seed.projects,
    frameworks: seed.frameworks,
    justification: seed.justification,
    createdAt: seed.createdAt,
    dueAt: seed.dueAt,
    resolutionRecommendation: seed.resolutionRecommendation,
    issueType: seed.issueType ?? "TOXIC_COMBINATION",
    updatedAt: seed.updatedAt,
    assignee: seed.assignee,
    businessImpact: seed.businessImpact,
    entityStatus: seed.entityStatus,
    ignoreNote: seed.ignoreNote,
    ignoreExpiredAt: seed.ignoreExpiredAt,
    aiVerdict: seed.aiVerdict,
    aiRecommendedSeverity: seed.aiRecommendedSeverity,
  };
  if (seed.environments?.length) row.environments = seed.environments;
  if (seed.ticketUrls?.length) row.ticketUrls = seed.ticketUrls;
  return row;
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
//
// The first two carry the lifecycle detail a live issuesV2 sync brings back, so the demo
// shows an accepted risk that lapsed and a remediation already under way rather than
// eight identical rows.
awsRoles.forEach((role, n) => {
  const lapsed = n === 0;
  const working = n === 1;
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
    // TOXIC_COMBINATION (the default), because that is what the tenant returns for
    // wc-id-2742 — every node in exemples/risk_issues_response.js carries that type,
    // guardrail rule included. Wiz's issue TYPE and this register's pattern grouping are
    // independent axes, and the seed must not imply they line up.
    updatedAt: "2026-08-13T10:29:28Z",
    environments: ["PRODUCTION"],
    entityStatus: "Active",
    businessImpact: "MBI",
    // Ignored by design until the guardrail baseline landed, then reopened when the
    // ignore date passed. The expiry is the structured field, never parsed out of the note.
    ignoreNote: lapsed
      ? "Ignored (By Design) by MANSUY.\nExplanation: guardrails are being rolled out " +
        "per project team; a baseline has to be agreed before they can be enforced.\n\n" +
        "Ignored until: Feb 1, 2026"
      : undefined,
    ignoreExpiredAt: lapsed ? "2026-02-01T00:00:00Z" : undefined,
    // Remediation under way: the status the register collected and never counted.
    status: working ? "IN_PROGRESS" : undefined,
    assignee: working ? "platform-security@example.com" : undefined,
    ticketUrls: working
      ? ["https://example.slack.com/archives/C0AGUF82MM1/p1775622232097139"]
      : undefined,
    aiVerdict: working ? "REMEDIATE" : undefined,
    aiRecommendedSeverity: working ? "MEDIUM" : undefined,
  }));
});

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
      dueAt: "2026-08-18T11:40:00Z",
      resolutionRecommendation:
        "Apply least-privilege to the agent's execution service account; remove IAM " +
        "bindings that grant access to sensitive data, and attach a guardrail that limits " +
        "the agent's data-access scope at runtime.",
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

// Other AI risk — 3 issues in the AI category matching no modelled pattern.
//
// The live filter collects the whole wct-id-1998 category, and a real tenant's rule set
// is wider than the four combinations this register models. Without a cohort here the
// dry-run demo would render an empty Other card and the bucket would look like dead code.
// All three sit on ONE asset so the AARS movement they cause is attributable to one row.
{
  const asset = AGENTS.find((a) => a.id === "agent-e")!;
  const OTHER_SEEDS: Array<{ ruleId: string; ruleName: string; sev: "MEDIUM" | "LOW"; why: string }> = [
    {
      ruleId: "wc-id-4101",
      ruleName: "AI model endpoint without request logging",
      sev: "LOW",
      why: "Model invocations are not logged, so misuse leaves no trail to investigate.",
    },
    {
      ruleId: "wc-id-4102",
      ruleName: "AI training dataset stored without encryption at rest",
      sev: "MEDIUM",
      why: "Training data is readable to anyone who reaches the bucket.",
    },
    {
      ruleId: "wc-id-4103",
      ruleName: "AI service account key older than 90 days",
      sev: "LOW",
      why: "A long-lived static key on an AI workload widens the window for credential theft.",
    },
  ];
  for (const seed of OTHER_SEEDS) {
    issues.push(issue({
      id: nextIssueId(),
      ruleId: seed.ruleId,
      ruleName: seed.ruleName,
      // CLOUD_CONFIGURATION: the type the register used to filter out entirely, so the
      // demo shows the Type column carrying something other than the tenant's default.
      // Illustrative rather than transcribed — these rule ids are invented, and the Other
      // bucket is defined by its rule not being modelled, never by its Wiz issue type.
      issueType: "CLOUD_CONFIGURATION",
      assetId: asset.id,
      assetName: asset.name,
      nativeSeverity: seed.sev,
      region: asset.region,
      account: asset.account?.name,
      projects: asset.projects,
      justification: seed.why,
      // No frameworks: an unmodelled rule contributes no AARS gap codes, so pillar B is
      // left exactly where it was. Deriving codes from the rule's own risks/tags would
      // re-price every asset with no way to attribute the movement.
      frameworks: undefined,
      createdAt: "2026-07-02T08:15:00Z",
      environments: ["PRODUCTION"],
      businessImpact: "MBI",
      entityStatus: "Active",
      updatedAt: "2026-08-13T10:30:01Z",
    }));
  }
}

// ------------------------------------------------------ per-asset AARS pillar inputs
// Transcribed from the applied table in ai/custom_score.md (normative). Live syncs
// derive these heuristically (graphEnrich.deriveAarsInput); dry-run pins the doc.
// Only the gap CODES are pinned — their points come from the AARS rule in force, so a
// tuned deployment sees its own model applied to the sample estate too.

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

// ----------------------------------------------------------- config-findings (dry-run)
// Compliance findings keyed to the resources they were evaluated against. Display-only in
// dry-run (the applied AARS table is pinned by SEED_AARS_HINTS); on live syncs the
// equivalent findings drive AARS pillar B via buildAarsHintsFromFindings.
//
// The last four rows are the point of this block, not filler. Three of them are keyed to
// a REGION and a RAW_ACCESS_POLICY — resource types NODE_KINDS does not carry — and one
// is RESOLVED. That is what the live tenant actually returns for the AI framework
// category: rules that fail on a region's metadata store or an IAM policy, not on an AI
// asset. Without them the dry run would show a register where every finding links to an
// agent, the unlinked column would always read "—", and the Cloud Configuration page's
// central claim would be untestable outside a live tenant.

const SEED_FINDINGS_DATA: FindingRow[] = [
  {
    id: "cfg-001",
    resourceId: "agent-a",
    ruleShortId: "SUB-082",
    severity: "MEDIUM",
    remediation:
      "Encrypt the Vertex AI metadata store with a customer-managed key and restrict the " +
      "agent service account's access to it.",
    frameworkCodes: ["SUB-082", "LLM06"],
    name: "Vertex AI Metadata Store is not encrypted with a customer-managed key",
    status: "OPEN",
    result: "FAIL",
    firstSeenAt: "2026-06-12T19:42:35Z",
    analyzedAt: "2026-07-07T15:59:10Z",
    ruleId: "60442ee5-452a-48cb-8694-9061c920e10d",
    ruleName: "Vertex AI Metadata Store should be encrypted with a customer-managed key",
    ruleDescription:
      "This rule checks whether the Vertex AI Metadata Store is encrypted with a " +
      "customer-managed key. It fails if kms_key_name is not configured.",
    remediationInstructions:
      "Delete the current Vertex AI Metadata Store, then create a new one with a " +
      "customer-managed key. Encryption cannot be changed after creation.",
    opaPolicy: "package wiz\n\ndefault result = \"pass\"\n\nresult = \"fail\" {\n" +
      "\tnot input.vertexAIMetadataStoreConfiguration.encryption_spec.kms_key_name\n}\n",
    risks: ["AI_SECURITY", "UNPROTECTED_DATA"],
    threats: [],
    resourceName: "Agent A",
    resourceType: "AI_AGENT",
    resourceStatus: "Active",
    source: "WIZ_CSPM",
    subscriptionName: "gcp-account-01",
    cloudProvider: "GCP",
    projects: [
      { id: "proj-project-beta", name: "PROJECT-BETA", businessImpact: "MBI" },
      { id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" },
    ],
    businessImpact: "MBI",
    ignoreRuleIds: [],
    iacFindingIds: [],
  },
  {
    id: "cfg-002",
    resourceId: "agent-h-chatbot",
    ruleShortId: "SUB-114",
    severity: "HIGH",
    remediation:
      "Disable public ingress on the Cloud Run service hosting the agent, or place it " +
      "behind an authenticated load balancer.",
    frameworkCodes: ["SUB-114"],
    name: "AI agent host is reachable from the public internet",
    status: "OPEN",
    result: "FAIL",
    firstSeenAt: "2026-05-02T08:15:00Z",
    analyzedAt: "2026-07-13T21:52:08Z",
    ruleName: "AI agent hosts should not be open to all internet",
    ruleDescription:
      "This rule checks whether the compute hosting an AI agent accepts ingress from " +
      "0.0.0.0/0. It fails when no authenticating front end sits in front of it.",
    risks: ["AI_SECURITY"],
    threats: [],
    resourceName: "agent-H-chatbot",
    resourceType: "AI_AGENT",
    resourceStatus: "Active",
    source: "WIZ_CSPM",
    subscriptionName: "gcp-account-05",
    cloudProvider: "GCP",
    projects: [{ id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
    businessImpact: "LBI",
    // Traced to IaC: the register's shift-left link, and the only seeded row that has one.
    iacFindingIds: ["iac-cloudrun-ingress-1"],
    ignoreRuleIds: [],
  },
  {
    id: "cfg-003",
    resourceId: "agent-e",
    ruleShortId: "SUB-047",
    severity: "MEDIUM",
    remediation: "Enable audit logging for all data access performed by the agent identity.",
    frameworkCodes: ["SUB-047"],
    name: "Data access by the AI agent identity is not audited",
    status: "OPEN",
    result: "FAIL",
    firstSeenAt: "2026-06-25T08:43:01Z",
    analyzedAt: "2026-07-13T21:52:13Z",
    ruleName: "AI agent identities should have data access logging enabled",
    risks: ["AI_SECURITY"],
    threats: [],
    resourceName: "Agent E",
    resourceType: "AI_AGENT",
    resourceStatus: "Active",
    source: "WIZ_CSPM",
    subscriptionName: "gcp-account-03",
    cloudProvider: "GCP",
    projects: [{ id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
    businessImpact: "LBI",
    ignoreRuleIds: [],
    iacFindingIds: [],
  },
  // ---- keyed to resources the AI graph does not model ----
  {
    id: "cfg-004",
    // A REGION. Not a NodeKind, so this prices no AARS score and shows as off-inventory.
    resourceId: "region-europe-west1-packaging",
    ruleShortId: "SUB-082",
    severity: "MEDIUM",
    remediation:
      "Delete and recreate the metadata store with a customer-managed key. Encryption " +
      "cannot be changed after creation.",
    frameworkCodes: ["SUB-082", "LLM06"],
    name: "Vertex AI Metadata Store is not encrypted with a customer-managed key",
    status: "OPEN",
    result: "FAIL",
    firstSeenAt: "2026-06-12T19:42:35Z",
    analyzedAt: "2026-06-19T10:27:22Z",
    ruleId: "60442ee5-452a-48cb-8694-9061c920e10d",
    ruleName: "Vertex AI Metadata Store should be encrypted with a customer-managed key",
    ruleDescription:
      "This rule checks whether the Vertex AI Metadata Store is encrypted with a " +
      "customer-managed key. It fails if kms_key_name is not configured.",
    opaPolicy: "package wiz\n\ndefault result = \"pass\"\n\nresult = \"fail\" {\n" +
      "\tnot input.vertexAIMetadataStoreConfiguration.encryption_spec.kms_key_name\n}\n",
    risks: ["AI_SECURITY", "UNPROTECTED_DATA"],
    threats: [],
    resourceName: "europe-west1 (packaging-data)",
    resourceType: "REGION",
    resourceStatus: "Active",
    targetExternalId: "packaging-data/europe-west1",
    source: "WIZ_CSPM",
    subscriptionName: "packaging-data",
    cloudProvider: "GCP",
    projects: [{ id: "proj-project-gamma", name: "PROJECT-GAMMA", businessImpact: "MBI" }],
    businessImpact: "MBI",
    ignoreRuleIds: [],
    iacFindingIds: [],
  },
  {
    id: "cfg-005",
    // A RAW_ACCESS_POLICY — an IAM policy document, likewise absent from the graph.
    resourceId: "policy-bedrock-invoke-1",
    ruleShortId: "IAM-267",
    severity: "MEDIUM",
    remediation:
      "Add a bedrock:GuardrailIdentifier condition to the policy statement that allows " +
      "bedrock:InvokeModel, or add a Deny that requires one.",
    frameworkCodes: ["IAM-267", "LLM06"],
    name: "IAM policy allows Bedrock model invocation without guardrail condition",
    status: "OPEN",
    result: "FAIL",
    firstSeenAt: "2026-07-21T16:03:20Z",
    analyzedAt: "2026-08-03T23:20:36Z",
    ruleId: "a1f587c5-32ac-4c08-8d91-e53d2d6db828",
    ruleName: "IAM Policy Bedrock Model Invocation should include Guardrail Condition",
    ruleDescription:
      "This rule checks whether IAM policies that allow Bedrock model invocation include " +
      "guardrail conditions. Amazon Bedrock foundation models can process sensitive data " +
      "and generate harmful content; guardrails enforce content filtering and usage policy.",
    remediationInstructions:
      "aws iam create-policy-version --policy-arn {{policyArn}} --set-as-default " +
      "--policy-document '{ … \"Condition\": { \"StringEquals\": " +
      "{ \"bedrock:GuardrailIdentifier\": \"<YOUR_GUARDRAIL_ID>\" } } … }'",
    risks: ["AI_SECURITY"],
    threats: [],
    resourceName: "AIFFORECASTSUPPLY-DEMANDFORECASTEU-IAM-V2-2",
    resourceType: "RAW_ACCESS_POLICY",
    source: "WIZ_CSPM",
    subscriptionName: "aws-account-prod-01",
    cloudProvider: "AWS",
    projects: [{ id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
    businessImpact: "LBI",
    // An accepted risk that still fails: the register shows the exception rather than
    // quietly dropping the row out of the gap count.
    ignoreRuleIds: ["ignore-bedrock-guardrail-waiver"],
    iacFindingIds: [],
  },
  {
    id: "cfg-006",
    // A SERVICE_ACCOUNT no agent in this estate runs as, so still off-inventory.
    resourceId: "sa-bigdata-ai-weatherforecast-pp",
    ruleShortId: "IAM-236",
    severity: "HIGH",
    remediation:
      "Add an aws:SourceAccount or aws:SourceArn condition to the role's trust policy so " +
      "only Bedrock in your own account can assume it.",
    frameworkCodes: ["IAM-236"],
    name: "Bedrock Service Role missing conditions to prevent confused deputy attacks",
    status: "OPEN",
    result: "FAIL",
    firstSeenAt: "2026-01-06T10:48:24Z",
    analyzedAt: "2026-08-07T07:37:39Z",
    ruleId: "1a1b2762-dee3-434f-b5b4-41597c48052b",
    ruleName: "Bedrock Service Roles should prevent confused deputy attacks",
    ruleDescription:
      "Fails when a role trusted by bedrock.amazonaws.com has no Condition with " +
      "aws:SourceAccount or aws:SourceArn. A service with access to several accounts can " +
      "otherwise be tricked into acting on an unintended one.",
    risks: ["AI_SECURITY"],
    threats: [],
    resourceName: "BIGDATA-AI-AIGEN-WEATHERFORECAST-PP",
    resourceType: "SERVICE_ACCOUNT",
    resourceStatus: "Active",
    targetExternalId: "arn:aws:iam::614303399241:role/BIGDATA-AI-AIGEN-WEATHERFORECAST-PP",
    source: "WIZ_CSPM",
    subscriptionName: "aws-account-prod-01",
    cloudProvider: "AWS",
    projects: [{ id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
    businessImpact: "LBI",
    ignoreRuleIds: [],
    iacFindingIds: [],
  },
  {
    id: "cfg-007",
    // RESOLVED, and therefore PASS. Stored for the lifecycle clock, counted by nothing:
    // isOpenGap keeps it out of complianceGaps, AARS pillar B and the severity strip.
    resourceId: "agent-a",
    ruleShortId: "SUB-114",
    severity: "HIGH",
    remediation: "Public ingress was removed from the service hosting this agent.",
    frameworkCodes: ["SUB-114"],
    name: "AI agent host is reachable from the public internet",
    status: "RESOLVED",
    result: "PASS",
    firstSeenAt: "2026-03-11T09:00:00Z",
    analyzedAt: "2026-08-07T07:37:41Z",
    ruleName: "AI agent hosts should not be open to all internet",
    risks: ["AI_SECURITY"],
    threats: [],
    resourceName: "Agent A",
    resourceType: "AI_AGENT",
    resourceStatus: "Active",
    source: "WIZ_CSPM",
    subscriptionName: "gcp-account-01",
    cloudProvider: "GCP",
    projects: [{ id: "proj-project-alpha", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
    businessImpact: "LBI",
    ignoreRuleIds: [],
    iacFindingIds: [],
  },
];

// ------------------------------------------------------------------------- exports

export const SEED_NODES: GNode[] = [...AGENTS, ...awsRoles, ...SUPPORT, ...extraNodes].map(node);
export const SEED_EDGES: GEdge[] = edges;
export const SEED_ISSUES: IssueRow[] = issues;
export const SEED_FINDINGS: FindingRow[] = SEED_FINDINGS_DATA;
export const SEED_AARS_HINTS: AarsHints = HINTS;

/**
 * DSPM findings on the classified datastores the agents can already reach.
 *
 * Sized to put every branch of the topology on one screen:
 *   bucket-customer-pii    3 — the screenshot's count badge, and a mixed severity
 *   db-customer-core       2 — a second store, reached by four different agents
 *   bucket-finance-reports 1 — the aggregate still draws at N=1
 *   bucket-partner-data    0 — classified, nothing found yet: the chain draws with no
 *   bucket-pricing-models  0   aggregate at the end of it
 *
 * `persistSync` folds these into `dataFindingCount` / `dataFindingSeverities` on the store,
 * exactly as it does for a live sync, so the dry run exercises the real path rather than a
 * pre-computed shortcut.
 */
export const SEED_DATA_FINDINGS: DataFindingRow[] = [
  { id: "df-pii-01", resourceId: "bucket-customer-pii", name: "PII: email addresses (12,400 rows)", severity: "CRITICAL" },
  { id: "df-pii-02", resourceId: "bucket-customer-pii", name: "PII: national identification numbers", severity: "HIGH" },
  { id: "df-pii-03", resourceId: "bucket-customer-pii", name: "PCI: primary account numbers", severity: "HIGH" },
  { id: "df-core-01", resourceId: "db-customer-core", name: "PII: postal addresses", severity: "CRITICAL" },
  { id: "df-core-02", resourceId: "db-customer-core", name: "PII: dates of birth", severity: "MEDIUM" },
  { id: "df-fin-01", resourceId: "bucket-finance-reports", name: "Financial: unpublished results", severity: "HIGH" },
];

// ------------------------------------------- compliance framework posture (seed)
//
// Three frameworks, one per codebook vocabulary, so the dry run exercises all three code
// spellings (ASI self-identifying, ML_ from the title, 5R_ from the category name).
//
// The policies are keyed to the shortIds SEED_FINDINGS already uses, which is what makes
// the dry run demonstrate the point of this feature rather than merely draw a page: three
// of those findings (SUB-114, SUB-047, IAM-236) carry NO framework code today, because the
// only source was a regex over rule tags and their tags have none. With posture synced and
// gapSources.frameworkMapping on, they gain real ones — and IAM-236 gains codes from TWO
// frameworks at once, which is the many-to-many the flat policy table exists to preserve.

export const SEED_FRAMEWORKS: FrameworkRow[] = [
  {
    id: "wf-id-275",
    name: "OWASP Top 10 For Agentic Applications 2026",
    description: "Agentic-application risks: goal hijack, tool misuse, rogue agents.",
    builtin: true,
    enabled: true,
    policyTypes: ["CLOUD_CONFIGURATION_RULE", "CONTROL"],
    selected: true,
  },
  {
    id: "wf-id-214",
    name: "5Rs - Wiz for Data Security",
    description: "Wiz's data-security response taxonomy: Reduce, Restrict, Relabel, …",
    builtin: true,
    enabled: true,
    policyTypes: ["CLOUD_CONFIGURATION_RULE", "CONTROL"],
    selected: true,
  },
  {
    id: "wf-id-106",
    name: "OWASP ML Security Top 10",
    description: "Machine-learning security risks: poisoning, inversion, model theft.",
    builtin: true,
    enabled: true,
    policyTypes: ["CONTROL"],
    selected: true,
  },
  {
    id: "wf-id-201",
    name: "OWASP LLM Security Top 10",
    description: "LLM application risks: prompt injection, disclosure, poisoning.",
    builtin: true,
    enabled: true,
    policyTypes: ["CLOUD_CONFIGURATION_RULE", "CONTROL"],
    selected: true,
  },
  // Present in the tenant, NOT selected — so the Settings picker has something to show
  // that is off, and the page can prove selection is this app's decision rather than a
  // list of everything Wiz has.
  {
    id: "wf-id-042",
    name: "CIS Amazon Web Services Foundations Benchmark v3.0",
    description: "General cloud hardening. No AI vocabulary — posture is not collected.",
    builtin: true,
    enabled: true,
    policyTypes: ["CLOUD_CONFIGURATION_RULE"],
    selected: false,
  },
];

function seedCategory(
  frameworkId: string,
  externalId: string,
  title: string,
  posturePct: number | null,
  passCount: number,
  failCount: number,
  emptyPostureReason: string | null = null,
): PostureRow {
  return {
    frameworkId, level: "category", categoryExternalId: externalId,
    nodeId: `wct-seed-${frameworkId}-${externalId}`, title,
    posturePct, passCount, failCount,
    passSubCategoryCount: posturePct === null ? 0 : 1,
    failSubCategoryCount: failCount > 0 ? 1 : 0,
    emptyPostureReason,
  };
}

function seedSubCategory(
  frameworkId: string,
  categoryExternalId: string,
  externalId: string,
  title: string,
  posturePct: number | null,
  passCount: number,
  failCount: number,
  emptyPostureReason: string | null = null,
): PostureRow {
  return {
    frameworkId, level: "subcategory", categoryExternalId, subcategoryExternalId: externalId,
    nodeId: `wsct-seed-${frameworkId}-${externalId}`, title,
    posturePct, passCount, failCount, emptyPostureReason, tags: [],
  };
}

export const SEED_POSTURE: PostureRow[] = [
  // ---- OWASP Agentic 2026 ----
  {
    frameworkId: "wf-id-275", level: "framework", nodeId: "wf-id-275",
    title: "OWASP Top 10 For Agentic Applications 2026",
    posturePct: 96, passCount: 0, failCount: 0,
    passSubCategoryCount: 2, failSubCategoryCount: 2, emptyPostureReason: null,
  },
  seedCategory("wf-id-275", "ASI01", "ASI01 Agent Goal Hijack", 93, 144, 10),
  seedSubCategory("wf-id-275", "ASI01", "ASI01", "ASI01 Agent Goal Hijack", 93, 144, 10),
  seedCategory("wf-id-275", "ASI03", "ASI03 Identity and Privilege Abuse", 99, 6347, 18),
  seedSubCategory("wf-id-275", "ASI03", "ASI03", "ASI03 Identity and Privilege Abuse", 99, 6347, 18),
  // The empty category: nothing in this estate to assess. Posture null, reason given —
  // the case the page must never render as 0%.
  seedCategory("wf-id-275", "ASI08", "ASI08 Cascading Failures", null, 0, 0, "NO_RESOURCES"),
  seedSubCategory("wf-id-275", "ASI08", "ASI08", "ASI08 Cascading Failures", null, 0, 0, "NO_RESOURCES"),
  seedCategory("wf-id-275", "ASI10", "ASI10 Rogue Agents", 99, 16703, 87),
  seedSubCategory("wf-id-275", "ASI10", "ASI10", "ASI10 Rogue Agents", 99, 16703, 87),

  // ---- Wiz 5Rs ----
  {
    frameworkId: "wf-id-214", level: "framework", nodeId: "wf-id-214",
    title: "5Rs - Wiz for Data Security",
    posturePct: 85, passCount: 0, failCount: 0,
    passSubCategoryCount: 1, failSubCategoryCount: 1, emptyPostureReason: null,
  },
  // NO_POLICIES is a DIFFERENT emptiness from NO_RESOURCES: nothing was written to assess,
  // rather than nothing existing to assess against. Both must read as their own state.
  seedCategory("wf-id-214", "1", "Reduce", null, 0, 0, "NO_RESOURCES"),
  seedSubCategory("wf-id-214", "1", "1.1", "Stale data resources", null, 0, 0, "NO_POLICIES"),
  seedCategory("wf-id-214", "2", "Restrict", 85, 194309, 71),
  seedSubCategory("wf-id-214", "2", "2.1", "Public data exposure", 85, 194309, 71),

  // ---- OWASP ML ----
  {
    frameworkId: "wf-id-106", level: "framework", nodeId: "wf-id-106",
    title: "OWASP ML Security Top 10",
    posturePct: 100, passCount: 0, failCount: 0,
    passSubCategoryCount: 1, failSubCategoryCount: 0, emptyPostureReason: null,
  },
  seedCategory("wf-id-106", "ML02", "Data Poisoning Attack", 100, 126000, 0),
  seedSubCategory("wf-id-106", "ML02", "ML02", "Data Poisoning Attack", 100, 126000, 0),

  // ---- OWASP LLM ----
  // The awkward shape: NUMERIC external ids, with the OWASP code carried in the category
  // NAME and stamped with its edition. Seeded so the dry run exercises the one framework
  // whose codes cannot be read off an id.
  {
    frameworkId: "wf-id-201", level: "framework", nodeId: "wf-id-201",
    title: "OWASP LLM Security Top 10",
    posturePct: 95, passCount: 0, failCount: 0,
    passSubCategoryCount: 1, failSubCategoryCount: 1, emptyPostureReason: null,
  },
  seedCategory("wf-id-201", "1", "1 LLM01:2025 Prompt Injection", 90, 691, 70),
  seedSubCategory("wf-id-201", "1", "1.1", "1.1  Prompt Injection", 90, 691, 70),
  seedCategory("wf-id-201", "2", "2 LLM02:2025 Sensitive Information Disclosure", 98, 5929, 100),
  seedSubCategory("wf-id-201", "2", "2.1", "2.1 Sensitive Information Disclosure", 98, 5929, 100),
];

function seedPolicy(
  frameworkId: string,
  categoryExternalId: string,
  subcategoryExternalId: string,
  shortId: string,
  name: string,
  severity: FrameworkPolicyRow["severity"],
  passCount: number,
  failCount: number,
): FrameworkPolicyRow {
  return {
    frameworkId, categoryExternalId, subcategoryExternalId,
    policyId: `pol-${shortId}`,
    policyKind: "CLOUD_RULE",
    shortId, name, severity,
    enabled: true, builtin: true,
    passCount, failCount,
    assessedCount: passCount + failCount,
    rejectedCount: 0,
    noResourceToAssess: passCount + failCount === 0,
    cloudProvider: "AWS",
  };
}

export const SEED_FRAMEWORK_POLICIES: FrameworkPolicyRow[] = [
  // SUB-082 under TWO subcategories of the same framework — the many-to-many, in the
  // simplest form. Summing these rows as distinct policies would double-count it.
  seedPolicy("wf-id-275", "ASI01", "ASI01", "SUB-082",
    "Vertex AI Metadata Store must use a customer-managed key", "MEDIUM", 21, 2),
  seedPolicy("wf-id-275", "ASI10", "ASI10", "SUB-082",
    "Vertex AI Metadata Store must use a customer-managed key", "MEDIUM", 21, 2),
  // IAM-236 under ASI03 *and* under 5Rs Restrict — the many-to-many ACROSS frameworks,
  // which is why the join key is (framework, subcategory, policy) and not the policy.
  seedPolicy("wf-id-275", "ASI03", "ASI03", "IAM-236",
    "Bedrock service roles must prevent confused-deputy access", "HIGH", 1718, 18),
  seedPolicy("wf-id-214", "2", "2.1", "IAM-236",
    "Bedrock service roles must prevent confused-deputy access", "HIGH", 1718, 18),
  seedPolicy("wf-id-275", "ASI03", "ASI03", "IAM-267",
    "Agent service accounts must not hold wildcard data permissions", "HIGH", 42, 3),
  // SUB-114 under ASI10 and under the ML framework — so it picks up an ASI code and an
  // ML_ one, proving the two spellings coexist on one finding.
  seedPolicy("wf-id-275", "ASI10", "ASI10", "SUB-114",
    "Agent must be attached to a guardrail", "HIGH", 9, 5),
  seedPolicy("wf-id-106", "ML02", "ML02", "SUB-114",
    "Agent must be attached to a guardrail", "HIGH", 9, 5),
  seedPolicy("wf-id-214", "2", "2.1", "SUB-047",
    "Training bucket must not allow public write", "CRITICAL", 30, 1),
  // SUB-114 also lands under LLM01, so one finding ends up carrying an ASI code, an ML_
  // code AND an LLM code — three vocabularies on one failing control, which is the point.
  seedPolicy("wf-id-201", "1", "1.1", "SUB-114",
    "Agent must be attached to a guardrail", "HIGH", 9, 5),
  seedPolicy("wf-id-201", "2", "2.1", "IAM-267",
    "Agent service accounts must not hold wildcard data permissions", "HIGH", 42, 3),
  // Nothing to assess: every count zero AND the flag set. Renders as its own state, never
  // as a 0% score.
  {
    frameworkId: "wf-id-275", categoryExternalId: "ASI08", subcategoryExternalId: "ASI08",
    policyId: "pol-AIService-009", policyKind: "CLOUD_RULE", shortId: "AIService-009",
    name: "Agent orchestration must bound retry fan-out", severity: "MEDIUM",
    enabled: true, builtin: true,
    passCount: 0, failCount: 0, assessedCount: 0, rejectedCount: 0,
    noResourceToAssess: true, cloudProvider: "Azure",
  },
  // A Control rather than a cloud rule — no shortId at all, so the finding join can only
  // reach it by uuid. Both keys exist in the lookup for exactly this reason.
  {
    frameworkId: "wf-id-275", categoryExternalId: "ASI01", subcategoryExternalId: "ASI01",
    policyId: "667e01f9-1105-42d5-a66a-e7f739fb4c4f", policyKind: "CONTROL",
    name: "Highly privileged AI agent is not protected by AI guardrails", severity: "MEDIUM",
    enabled: true, builtin: true,
    passCount: 72, failCount: 0, assessedCount: 72, rejectedCount: 0,
    noResourceToAssess: false,
  },
];

/** The raw (un-enriched) seed graph; persistSync enriches it like a live sync. */
export function seedGraphDoc(syncedAt: string): GraphDoc {
  return { nodes: SEED_NODES, edges: SEED_EDGES, syncedAt };
}

/**
 * Prior AARS distributions for the dry-run dataset, oldest first, so the inventory's
 * trend chart has a line to draw without waiting days for real syncs to accumulate.
 * Counts only — the caller dates them one day apart ending at the sync it is running,
 * so the sample trend runs continuously into the live point instead of leaving a gap.
 * The last entry is the estate the seed itself produces, so the trend lands exactly on
 * the distribution charted beside it.
 */
export const SEED_TREND: Array<Record<string, number>> = [
  { CRITICAL: 5, HIGH: 12, MEDIUM: 0, LOW: 2, INFO: 11 },
  { CRITICAL: 5, HIGH: 13, MEDIUM: 0, LOW: 2, INFO: 10 },
  { CRITICAL: 4, HIGH: 15, MEDIUM: 0, LOW: 3, INFO: 9 },
  { CRITICAL: 4, HIGH: 16, MEDIUM: 0, LOW: 3, INFO: 9 },
  { CRITICAL: 3, HIGH: 16, MEDIUM: 0, LOW: 3, INFO: 8 },
  { CRITICAL: 3, HIGH: 17, MEDIUM: 0, LOW: 3, INFO: 8 },
  { CRITICAL: 2, HIGH: 17, MEDIUM: 0, LOW: 3, INFO: 8 },
  { CRITICAL: 2, HIGH: 17, MEDIUM: 0, LOW: 3, INFO: 8 },
];

// ----------------------------------------------- rule catalogue + identity hygiene (dry-run)
//
// A HANDFUL of rules, not a sample of 3,858. The catalogue's job in the dry run is to prove
// three things work — the shortId gloss, the hygiene name matchers, and the subject-type
// guard — and each of these rows is here because it exercises one of them.
//
// The last row is the important one. `IDP-012` matches the MFA pattern and is evaluated
// against an IDENTITY_PROVIDER: a real finding, and not one that says anything about whether
// a PERSON has MFA. It is seeded precisely so the subject guard in identityHygiene.hygieneKindOf
// has something to reject in the dry run rather than only in a unit test.
export const SEED_CONFIG_RULES: ConfigRuleRow[] = [
  {
    id: "rule-iam-159",
    shortId: "IAM-159",
    name: "User should have MFA enabled",
    subjectEntityType: "USER_ACCOUNT",
    externalRefs: [],
  },
  {
    id: "rule-iam-208",
    shortId: "IAM-208",
    name: "User with password-based authentication should have multi-factor authentication (MFA) enabled",
    subjectEntityType: "USER_ACCOUNT",
    externalRefs: [],
  },
  {
    id: "rule-iam-235",
    shortId: "IAM-235",
    name: "User should not be inactive for more than 90 days",
    subjectEntityType: "USER_ACCOUNT",
    externalRefs: [],
  },
  {
    // The gloss the AARS cascade has always lacked: SEED_FINDINGS prices SUB-082 and the
    // codebook has never been able to render what it means.
    id: "rule-sub-082",
    shortId: "SUB-082",
    name: "Vertex AI Metadata Store should be encrypted with a customer-managed key",
    subjectEntityType: "REGION",
    externalRefs: ["CKV_GCP_96", "CKV2_GCP_25"],
  },
  {
    id: "rule-idp-012",
    shortId: "IDP-012",
    name: "WorkSpaces Directory should have multi-factor authentication enabled",
    subjectEntityType: "IDENTITY_PROVIDER",
    externalRefs: [],
  },
];

/**
 * Hygiene findings on two of the twelve operators who can reach agent-H-chatbot.
 *
 * `user-ops-01` is an ADMIN on that agent and has no MFA — the pairing the whole feature
 * exists to surface. `user-ops-02` is the other admin and is the one already seeded dormant,
 * so its dormancy shows up twice by two different routes (the identity's own
 * `inactiveInLast90Days` flag and Wiz's IAM-235 rule) and the page must not double-count it.
 *
 * `user-ops-05` holds only READ, so it is NOT reachable by this register's definition — it is
 * seeded to prove the intersection is real: a person with no MFA who cannot reach an AI asset
 * is an IAM problem and must not reach this app's count.
 */
export const SEED_IDENTITY_FINDINGS: IdentityFindingRow[] = [
  {
    id: "idf-001",
    resourceId: "user-ops-01",
    resourceName: "ops.user01@example.com",
    ruleId: "rule-iam-159",
    ruleShortId: "IAM-159",
    ruleName: "User should have MFA enabled",
    severity: "HIGH",
    status: "OPEN",
    result: "FAIL",
    firstSeenAt: "2026-05-02T09:14:00Z",
    analyzedAt: "2026-08-13T04:00:00Z",
    remediation: "Enrol this account in multi-factor authentication.",
    hygiene: "MFA",
  },
  {
    id: "idf-002",
    resourceId: "user-ops-02",
    resourceName: "ops.user02@example.com",
    ruleId: "rule-iam-235",
    ruleShortId: "IAM-235",
    ruleName: "User should not be inactive for more than 90 days",
    severity: "MEDIUM",
    status: "OPEN",
    result: "FAIL",
    firstSeenAt: "2026-04-18T11:02:00Z",
    analyzedAt: "2026-08-13T04:00:00Z",
    remediation: "Disable or remove accounts that are no longer in use.",
    hygiene: "DORMANT",
  },
  {
    id: "idf-003",
    resourceId: "user-ops-05",
    resourceName: "ops.user05@example.com",
    ruleId: "rule-iam-159",
    ruleShortId: "IAM-159",
    ruleName: "User should have MFA enabled",
    severity: "HIGH",
    status: "OPEN",
    result: "FAIL",
    firstSeenAt: "2026-05-02T09:14:00Z",
    analyzedAt: "2026-08-13T04:00:00Z",
    hygiene: "MFA",
  },
];

/**
 * Effective access: what those people can actually do, and through which policy.
 *
 * `user-ops-01` appears here AND in the binding topology — the same person by two routes, who
 * must be counted once. `user-ops-07` appears ONLY here, holding a READ binding the
 * identity-access traversal never returns: effective access finding a pair the binding
 * traversal missed is the point of running it, and it still counts as reach.
 */
export const SEED_EFFECTIVE_ACCESS: EffectiveAccessRow[] = [
  {
    identityId: "user-ops-01",
    identityName: "ops.user01@example.com",
    resourceId: "agent-h-chatbot",
    accessTypes: ["DATA"],
    permissions: ["aiplatform.endpoints.predict", "storage.objects.get"],
    policyIds: ["policy-ops-admin"],
    policyNames: ["ops-admin-binding"],
  },
  {
    identityId: "user-ops-07",
    identityName: "ops.user07@example.com",
    resourceId: "agent-h-chatbot",
    accessTypes: ["DATA"],
    permissions: ["storage.objects.get"],
    policyIds: ["policy-ops-reader"],
    policyNames: ["ops-reader-binding"],
  },
];
