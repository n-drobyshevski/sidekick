// Normalization of live Wiz responses into the graph model. Defensive throughout:
// the reponse_schemas/ captures don't exist yet, so shapes are inferred from the
// query selection sets in ai/queries/*.md — missing fields become undefined, and an
// unrecognized row is skipped, never thrown on.
//
// graphSearch rows return the SELECTED entities of one matched path, not edges — the
// traversed edge is implied by the query pattern, so each battery step reconstructs
// its edges from the entity types present in the row (unit-tested; verify against
// captured responses when they land in ai/queries/reponse_schemas/).

import type { Severity } from "./config";
import {
  edgeId,
  kindFromWizType,
  type GEdge,
  type GNode,
  type GraphDoc,
  type IssueRow,
} from "./graphTypes";
import { classifyIssue, type ComboGroup } from "./toxicCombos";
import { clean, type Rec } from "./util";

function str(v: unknown): string | undefined {
  const c = clean(v);
  return c === null ? undefined : String(c);
}

function bool(v: unknown): boolean {
  return v === true;
}

function triBool(v: unknown): boolean | null {
  return v === true ? true : v === false ? false : null;
}

/** One CloudResource (cloudResourcesV2 node or graphSearch entity) → GNode, or null. */
export function normalizeCloudResource(raw: Rec): GNode | null {
  const id = str(raw["id"]);
  // Real tenants return display-style types ("AI Agent"), the design docs used
  // enum style ("AI_AGENT") — kindFromWizType accepts both.
  const kind = kindFromWizType(raw["type"]);
  if (!id || !kind) return null;
  const node: GNode = {
    id,
    kind,
    name: str(raw["name"]) ?? id,
    nativeType: str(raw["nativeType"]),
    cloudPlatform: str(raw["cloudPlatform"]),
    region: str(raw["region"]),
    status: str(raw["status"]),
    firstSeen: str(raw["firstSeen"]),
    lastSeen: str(raw["lastSeen"]),
    externalId: str(raw["externalId"]),
    isAccessibleFromInternet: triBool(raw["isAccessibleFromInternet"]),
    hasSensitiveData: bool(raw["hasSensitiveData"]),
    hasAccessToSensitiveData: bool(raw["hasAccessToSensitiveData"]),
    hasHighPrivileges: bool(raw["hasHighPrivileges"]),
    hasAdminPrivileges: bool(raw["hasAdminPrivileges"]),
  };
  const account = raw["cloudAccount"] as Rec | null | undefined;
  if (account && typeof account === "object") {
    const accId = str(account["id"]);
    if (accId) {
      node.cloudAccount = {
        id: accId,
        name: str(account["name"]) ?? accId,
        externalId: str(account["externalId"]),
        cloudProvider: str(account["cloudProvider"]),
      };
    }
  }
  const projects = raw["projects"];
  if (Array.isArray(projects)) {
    node.projects = projects
      .map((p) => {
        const rec = p as Rec;
        const pid = str(rec["id"]);
        const name = str(rec["name"]);
        // businessImpact is nested under riskProfile in the API, not flat on Project.
        const riskProfile = rec["riskProfile"] as Rec | null | undefined;
        const businessImpact = riskProfile && typeof riskProfile === "object"
          ? str(riskProfile["businessImpact"])
          : undefined;
        return pid && name ? { id: pid, name, businessImpact } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
  }
  const tags = raw["tags"];
  if (Array.isArray(tags)) {
    node.tags = tags
      .map((t) => {
        const rec = t as Rec;
        const key = str(rec["key"]);
        return key ? { key, value: str(rec["value"]) ?? "" } : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
  }
  return node;
}

export interface NormalizedPart {
  nodes: GNode[];
  edges: GEdge[];
  issues: IssueRow[];
}

export function emptyPart(): NormalizedPart {
  return { nodes: [], edges: [], issues: [] };
}

/** cloudResourcesV2 inventory page → nodes only. */
export function normalizeInventoryPage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const raw of rows) {
    const node = normalizeCloudResource(raw);
    if (node) part.nodes.push(node);
  }
  return part;
}

/**
 * cloudResourcesV2 page filtered by relatedIssue.sourceRuleId → nodes plus one
 * reconstructed OPEN issue per asset. The inventory API doesn't expose per-asset
 * issue multiplicity, so multi-instance issues collapse to one row per asset —
 * a documented fidelity limit until the Wiz issues API is wired.
 */
export function normalizeRuleAssetsPage(rows: Rec[], group: ComboGroup): NormalizedPart {
  const part = emptyPart();
  for (const raw of rows) {
    const node = normalizeCloudResource(raw);
    if (!node) continue;
    part.nodes.push(node);
    part.issues.push({
      id: `live-${group.ruleId}-${node.id}`,
      ruleId: group.ruleId,
      ruleName: group.title,
      comboGroup: group.id,
      nativeSeverity: group.nativeSeverity,
      adjustedSeverity: group.adjustedSeverity,
      status: "OPEN",
      assetId: node.id,
      assetName: node.name,
      region: node.region,
      account: node.cloudAccount?.name,
      projects: (node.projects ?? []).map((p) => p.name),
      frameworks: group.frameworks,
    });
  }
  return part;
}

function entitiesOf(row: Rec): GNode[] {
  if (!row || typeof row !== "object") return [];
  const entities = row["entities"];
  if (!Array.isArray(entities)) return [];
  return entities
    .map((e) => normalizeCloudResource(e as Rec))
    .filter((n): n is GNode => n !== null);
}

/** graphSearch "agents without guardrail" page → agents flagged guardrailMissing. */
export function normalizeNoGuardrailPage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const row of rows) {
    for (const node of entitiesOf(row)) {
      if (node.kind !== "AI_AGENT") continue;
      node.guardrailMissing = true;
      part.nodes.push(node);
    }
  }
  return part;
}

/**
 * graphSearch "agent RUNS_AS service account (HAS_FINDING excessive access)" page →
 * all path entities + the implied RUNS_AS / HAS_FINDING edges.
 */
export function normalizeRunsAsPage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const row of rows) {
    const entities = entitiesOf(row);
    const agent = entities.find((e) => e.kind === "AI_AGENT");
    const sa = entities.find((e) => e.kind === "SERVICE_ACCOUNT");
    const findings = entities.filter(
      (e) => e.kind === "EXCESSIVE_ACCESS_FINDING" || e.kind === "LATERAL_MOVEMENT_FINDING",
    );
    part.nodes.push(...entities);
    if (agent && sa) {
      part.edges.push({ id: edgeId(agent.id, "RUNS_AS", sa.id), src: agent.id, dst: sa.id, type: "RUNS_AS" });
      for (const f of findings) {
        part.edges.push({ id: edgeId(sa.id, "HAS_FINDING", f.id), src: sa.id, dst: f.id, type: "HAS_FINDING" });
      }
    }
  }
  return part;
}

/**
 * graphSearch "identities with high-privilege access to agents" page → identities +
 * agents + the implied identity → ALLOWS_ACCESS_TO → agent edge.
 */
export function normalizeIdentityAccessPage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const row of rows) {
    const entities = entitiesOf(row);
    const agent = entities.find((e) => e.kind === "AI_AGENT");
    const identities = entities.filter(
      (e) => e.kind === "USER_ACCOUNT" || e.kind === "SERVICE_ACCOUNT" || e.kind === "ACCESS_ROLE",
    );
    part.nodes.push(...entities);
    if (!agent) continue;
    for (const identity of identities) {
      part.edges.push({
        id: edgeId(identity.id, "ALLOWS_ACCESS_TO", agent.id),
        src: identity.id,
        dst: agent.id,
        type: "ALLOWS_ACCESS_TO",
        accessType: "HIGH_PRIVILEGE",
      });
    }
  }
  return part;
}

/** Merge battery parts: last-write-wins per node id, but sticky flags never unset. */
export function mergeParts(parts: NormalizedPart[], syncedAt: string): {
  doc: GraphDoc;
  issues: IssueRow[];
} {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const issues = new Map<string, IssueRow>();
  for (const part of parts) {
    for (const node of part.nodes) {
      const prev = nodes.get(node.id);
      if (!prev) {
        nodes.set(node.id, { ...node });
        continue;
      }
      // Later steps see narrower projections of the same resource; merge field-wise
      // so a step that omits a field can't erase what an earlier step established.
      const merged: GNode = { ...prev };
      for (const [k, v] of Object.entries(node)) {
        if (v !== undefined && v !== null && v !== false) {
          (merged as unknown as Rec)[k] = v;
        }
      }
      nodes.set(node.id, merged);
    }
    for (const edge of part.edges) edges.set(edge.id, edge);
    for (const issue of part.issues) issues.set(issue.id, issue);
  }
  return {
    doc: { nodes: [...nodes.values()], edges: [...edges.values()], syncedAt },
    issues: [...issues.values()],
  };
}

/** Worst → best, for deterministic issue ordering in the merged output. */
export function issueOrder(a: IssueRow, b: IssueRow): number {
  const rank = (s: Severity) => ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"].indexOf(s);
  return rank(a.adjustedSeverity) - rank(b.adjustedSeverity) || (a.id < b.id ? -1 : 1);
}

export { classifyIssue };
