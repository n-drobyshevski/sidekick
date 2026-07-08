// Normalization of live Wiz responses into the graph model. Defensive throughout:
// the cloudResourcesV2 / graphSearch shapes are inferred from the query selection sets
// in ai/queries/*.md, while the issuesV2 / configurationFindings / principals shapes are
// transcribed from the real tenant captures in gas_ai/exemples/*_response.js — missing
// fields become undefined, and an unrecognized row is skipped, never thrown on.
//
// graphSearch rows return the SELECTED entities of one matched path, not edges — the
// traversed edge is implied by the query pattern, so each battery step reconstructs
// its edges from the entity types present in the row (unit-tested; verify against
// captured responses when they land in ai/queries/reponse_schemas/).

import type { Severity } from "./config";
import {
  edgeId,
  kindFromWizType,
  type FindingRow,
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
    isOpenToAllInternet: triBool(raw["isOpenToAllInternet"]),
    hasSensitiveData: bool(raw["hasSensitiveData"]),
    hasAccessToSensitiveData: bool(raw["hasAccessToSensitiveData"]),
    hasHighPrivileges: bool(raw["hasHighPrivileges"]),
    hasAdminPrivileges: bool(raw["hasAdminPrivileges"]),
  };
  const technology = raw["technology"] as Rec | null | undefined;
  if (technology && typeof technology === "object") {
    const cats = technology["categories"];
    if (Array.isArray(cats)) {
      const names = cats
        .map((c) => str((c as Rec)["name"]))
        .filter((n): n is string => Boolean(n));
      if (names.length) node.technologyCategories = names;
    }
  }
  // issueAnalytics is only selected by the principals query; harmless (skipped) elsewhere.
  const ia = raw["issueAnalytics"] as Rec | null | undefined;
  if (ia && typeof ia === "object") {
    const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
    node.issueAnalytics = {
      total: num(ia["issueCount"]),
      info: num(ia["informationalSeverityCount"]),
      low: num(ia["lowSeverityCount"]),
      medium: num(ia["mediumSeverityCount"]),
      high: num(ia["highSeverityCount"]),
      critical: num(ia["criticalSeverityCount"]),
    };
  }
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
  findings: FindingRow[];
}

export function emptyPart(): NormalizedPart {
  return { nodes: [], edges: [], issues: [], findings: [] };
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
 * Agentic-identities page (cloudResourcesV2 filtered by identityPurpose:AGENTIC) →
 * identity nodes flagged AGENTIC. identityPurpose isn't returned by the API (it's a
 * filter), so it's set by construction; issueAnalytics is read by normalizeCloudResource.
 */
export function normalizePrincipalsPage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const raw of rows) {
    const node = normalizeCloudResource(raw);
    if (!node) continue;
    node.identityPurpose = "AGENTIC";
    part.nodes.push(node);
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

/**
 * issuesV2 page (real toxic-combination issues) → one IssueRow per issue (real
 * multiplicity, real native severity) plus a thin GNode reconstructed from each
 * issue's entitySnapshot. The thin node is join-safety: if entitySnapshot.id matches
 * an inventory node it merges field-wise (and is deliberately minimal so it never
 * clobbers the inventory node's richer cloudAccount); if it has no inventory match,
 * the graph stays coherent instead of dangling a HAS_ISSUE edge at a missing node.
 */
export function normalizeIssuesPage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const raw of rows) {
    const issueId = str(raw["id"]);
    const snap = raw["entitySnapshot"] as Rec | null | undefined;
    const assetId = snap && typeof snap === "object" ? str(snap["id"]) : undefined;
    // An issue with no id, or no entity to attach to, can't be scored or drawn — skip.
    if (!issueId || !assetId) continue;

    const sourceRules = Array.isArray(raw["sourceRules"]) ? (raw["sourceRules"] as Rec[]) : [];
    const first = (sourceRules[0] ?? {}) as Rec;
    const ruleId = str(first["id"]);
    const ruleName = str(first["name"]);
    const group = classifyIssue({ sourceRuleId: ruleId ?? null, ruleName: ruleName ?? null });

    const nativeSeverity = (str(raw["severity"]) ?? "UNKNOWN") as Severity;
    const adjustedSeverity = group ? group.adjustedSeverity : nativeSeverity;
    // Control carries resolutionRecommendation directly; CloudConfigurationRule nests
    // it under control{}.
    const control = first["control"] as Rec | null | undefined;
    const resolutionRecommendation =
      str(first["resolutionRecommendation"]) ??
      (control && typeof control === "object" ? str(control["resolutionRecommendation"]) : undefined);

    const assetName = str(snap!["name"]) ?? assetId;
    const projects = Array.isArray(raw["projects"])
      ? (raw["projects"] as Rec[])
          .map((p) => str((p as Rec)["name"]))
          .filter((n): n is string => Boolean(n))
      : [];

    part.issues.push({
      id: issueId,
      ruleId: ruleId ?? group?.ruleId ?? "",
      ruleName: ruleName ?? group?.title ?? "",
      comboGroup: group?.id ?? "",
      nativeSeverity,
      adjustedSeverity,
      status: str(raw["status"]) ?? "OPEN",
      assetId,
      assetName,
      region: str(snap!["region"]),
      account: str(snap!["subscriptionName"]),
      projects,
      frameworks: group?.frameworks,
      createdAt: str(raw["createdAt"]),
      dueAt: str(raw["dueAt"]),
      resolutionRecommendation,
    });

    const kind = kindFromWizType(snap!["type"]);
    if (kind) {
      const node: GNode = { id: assetId, kind, name: assetName };
      const nativeType = str(snap!["nativeType"]);
      if (nativeType) node.nativeType = nativeType;
      const cloud = str(snap!["cloudPlatform"]);
      if (cloud) node.cloudPlatform = cloud;
      const region = str(snap!["region"]);
      if (region) node.region = region;
      const externalId = str(snap!["externalId"]);
      if (externalId) node.externalId = externalId;
      part.nodes.push(node);
    }
  }
  return part;
}

/**
 * Augment de-dup: real issuesV2 rows win over the synthetic per-rule `Q_RULE_ASSETS`
 * rows. Drop each synthetic (`live-*`) issue whose (assetId, comboGroup) is already
 * covered by a real issue, so running both batteries never double-counts an asset in
 * the combos rollup or AARS pillar A. A synthetic issue for an (asset, group) that
 * issuesV2 didn't return survives — the per-rule step is the tenant-tolerance fallback.
 */
export function reconcileIssues(issues: IssueRow[]): IssueRow[] {
  const realKeys = new Set<string>();
  for (const i of issues) {
    if (!i.id.startsWith("live-")) realKeys.add(`${i.assetId}|${i.comboGroup}`);
  }
  return issues.filter(
    (i) => !i.id.startsWith("live-") || !realKeys.has(`${i.assetId}|${i.comboGroup}`),
  );
}

/**
 * AARS gap codes a failing config-finding rule contributes: its shortId (each distinct
 * failing control is one compliance gap, default 5 pts) plus any OWASP-style token
 * (LLM##/ASI##/ML*) found on the rule's tag values or risks, which score higher via
 * defaultGapPoints. Deduped, order-stable.
 */
function frameworkCodesFromRule(rule: Rec | null | undefined, shortId: string): string[] {
  const codes: string[] = [];
  const add = (c: string | undefined) => {
    if (c && !codes.includes(c)) codes.push(c);
  };
  add(shortId || undefined);
  const owasp = /\b(LLM\d{2}|ASI\d{2}|ML[_A-Z]+)\b/;
  const scan = (v: unknown) => {
    const s = typeof v === "string" ? v.toUpperCase() : "";
    const m = s.match(owasp);
    if (m) add(m[0]);
  };
  if (rule && typeof rule === "object") {
    const tags = rule["tags"];
    if (Array.isArray(tags)) for (const t of tags) scan((t as Rec)?.["value"]);
    const risks = rule["risks"];
    if (Array.isArray(risks)) for (const r of risks) scan(r);
  }
  return codes;
}

/**
 * configurationFindings page → FindingRow per FAILING, OPEN finding, keyed to the
 * resource it fails on. Only `result === "FAIL"` (a passing control is not a gap) and
 * OPEN findings are kept; each carries its remediation text and the AARS gap codes it
 * contributes. No nodes/edges/issues — findings are a side channel feeding pillar B.
 */
export function normalizeConfigFindingsPage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const raw of rows) {
    const id = str(raw["id"]);
    if (!id) continue;
    if (str(raw["result"]) !== "FAIL") continue;
    const status = str(raw["status"]);
    if (status && status !== "OPEN") continue;
    const resource = raw["resource"] as Rec | null | undefined;
    const resourceId = resource && typeof resource === "object" ? str(resource["id"]) : undefined;
    if (!resourceId) continue;
    const rule = raw["rule"] as Rec | null | undefined;
    const ruleShortId =
      rule && typeof rule === "object" ? str(rule["shortId"]) ?? "" : "";
    part.findings.push({
      id,
      resourceId,
      ruleShortId,
      severity: (str(raw["severity"]) ?? "UNKNOWN") as Severity,
      remediation: str(raw["remediation"]),
      frameworkCodes: frameworkCodesFromRule(rule, ruleShortId),
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
  findings: FindingRow[];
} {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const issues = new Map<string, IssueRow>();
  const findings = new Map<string, FindingRow>();
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
    for (const finding of part.findings ?? []) findings.set(finding.id, finding);
  }
  return {
    doc: { nodes: [...nodes.values()], edges: [...edges.values()], syncedAt },
    issues: [...issues.values()],
    findings: [...findings.values()],
  };
}

/** Worst → best, for deterministic issue ordering in the merged output. */
export function issueOrder(a: IssueRow, b: IssueRow): number {
  const rank = (s: Severity) => ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"].indexOf(s);
  return rank(a.adjustedSeverity) - rank(b.adjustedSeverity) || (a.id < b.id ? -1 : 1);
}

export { classifyIssue };
