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

import { SEVERITY_ORDER, type Severity } from "./config";
import {
  edgeId,
  kindFromWizType,
  severityRank,
  type DataFindingRow,
  type FindingRow,
  type GEdge,
  type GNode,
  type GraphDoc,
  type IssueRow,
} from "./graphTypes";
import { classifyIssue, OTHER_GROUP_ID, type ComboGroup } from "./toxicCombos";
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
  /** DSPM classification findings, keyed to the datastore they were found in. */
  dataFindings: DataFindingRow[];
}

export function emptyPart(): NormalizedPart {
  return { nodes: [], edges: [], issues: [], findings: [], dataFindings: [] };
}

/**
 * The five arms, as ONE named operation over the type.
 *
 * The sync loop used to write this out by hand and carried three of the four: `findings`
 * was never accumulated, so `CONFIG_FINDINGS` — which emits findings and nothing else — had
 * its every page dropped on live syncs, and `ai_findings` was rewritten empty each time.
 * Nothing failed; a real number just read zero. Spelling the arms out at a call site is how
 * that happened, so they are spelled out exactly once, here, and `partIsEmpty` is derived
 * from the same list rather than restating it.
 */
export function appendPart(target: NormalizedPart, part: NormalizedPart): void {
  target.nodes.push(...part.nodes);
  target.edges.push(...part.edges);
  target.issues.push(...part.issues);
  target.findings.push(...part.findings);
  target.dataFindings.push(...part.dataFindings);
}

/** True when a part carries nothing at all — on ANY arm. */
export function partIsEmpty(part: NormalizedPart): boolean {
  return (
    !part.nodes.length && !part.edges.length && !part.issues.length &&
    !part.findings.length && !part.dataFindings.length
  );
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
 * Who resolved an issue. The API returns `{ user }` OR `{ serviceAccount }`, never both;
 * collapse to one display string so the ledger holds a name rather than a shape.
 */
function resolvedByName(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const by = raw as Rec;
  const user = by["user"] as Rec | null | undefined;
  if (user && typeof user === "object") {
    const name = str(user["name"]) ?? str(user["email"]);
    if (name) return name;
  }
  const sa = by["serviceAccount"] as Rec | null | undefined;
  if (sa && typeof sa === "object") return str(sa["name"]);
  return undefined;
}

/**
 * The accepted-risk rationale off the note log, when there is one.
 *
 * `notes` is an ordered log: an ignore writes "Ignored (By Design) by X … Ignored until:
 * Feb 1, 2026", and its lapse later prepends "Status was updated to OPEN … as ignore date
 * expired". Only the rationale is extracted, and the "Ignored until" date inside it is
 * deliberately NOT parsed — `rejectionExpiredAt` is the structured field for that, and the
 * note is free text a human typed.
 */
function ignoreRationale(raw: unknown): string | undefined {
  if (!Array.isArray(raw)) return undefined;
  for (const note of raw as Rec[]) {
    if (!note || typeof note !== "object") continue;
    const text = str(note["text"]);
    if (text && /^Ignored\s*\(/i.test(text)) return text;
  }
  return undefined;
}

/** Worst business impact across an issue's projects — one column answering "does this matter". */
const BUSINESS_IMPACT_ORDER = ["HBI", "MBI", "LBI"];
function worstBusinessImpact(projects: Rec[]): string | undefined {
  let best: string | undefined;
  let bestRank = BUSINESS_IMPACT_ORDER.length;
  for (const p of projects) {
    const profile = p["riskProfile"] as Rec | null | undefined;
    if (!profile || typeof profile !== "object") continue;
    const impact = str(profile["businessImpact"]);
    if (!impact) continue;
    const rank = BUSINESS_IMPACT_ORDER.indexOf(impact);
    if (rank >= 0 && rank < bestRank) {
      bestRank = rank;
      best = impact;
    }
  }
  return best;
}

/** Every serviceTickets[].url, in response order. */
function ticketUrlsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Rec[])
    .map((t) => (t && typeof t === "object" ? str(t["url"]) : undefined))
    .filter((u): u is string => Boolean(u));
}

/**
 * issuesV2 page (the tenant's AI Security register) → one IssueRow per issue (real
 * multiplicity, real native severity) plus a thin GNode reconstructed from each
 * issue's entitySnapshot. The thin node is join-safety: if entitySnapshot.id matches
 * an inventory node it merges field-wise (and is deliberately minimal so it never
 * clobbers the inventory node's richer cloudAccount); if it has no inventory match,
 * the graph stays coherent instead of dangling a HAS_ISSUE edge at a missing node.
 *
 * An issue whose source rule matches no COMBO_GROUPS pattern is stamped OTHER_GROUP_ID,
 * not "" — the filter collects the whole AI category, so unrecognised rules are real
 * register rows rather than noise, and comboSummary gives them their own bucket.
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
    const projectRows = Array.isArray(raw["projects"]) ? (raw["projects"] as Rec[]) : [];
    const projects = projectRows
      .map((p) => str(p["name"]))
      .filter((n): n is string => Boolean(n));

    const assigneeRaw = raw["assignee"] as Rec | null | undefined;
    const aiAnalysis = raw["aiRemediationAnalysis"] as Rec | null | undefined;
    const environments = Array.isArray(raw["environments"])
      ? (raw["environments"] as unknown[])
          .map((e) => str(e))
          .filter((e): e is string => Boolean(e))
      : undefined;
    const ticketUrls = ticketUrlsOf(raw["serviceTickets"]);

    const issue: IssueRow = {
      id: issueId,
      ruleId: ruleId ?? group?.ruleId ?? "",
      ruleName: ruleName ?? group?.title ?? "",
      comboGroup: group?.id ?? OTHER_GROUP_ID,
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
      issueType: str(raw["type"]),
      updatedAt: str(raw["updatedAt"]),
      resolvedAt: str(raw["resolvedAt"]),
      resolutionReason: str(raw["resolutionReason"]),
      resolvedBy: resolvedByName(raw["resolvedBy"]),
      assignee:
        assigneeRaw && typeof assigneeRaw === "object"
          ? str(assigneeRaw["name"]) ?? str(assigneeRaw["primaryEmail"])
          : undefined,
      businessImpact: worstBusinessImpact(projectRows),
      entityStatus: str(snap!["status"]),
      subscriptionId: str(snap!["subscriptionId"]),
      ignoreNote: ignoreRationale(raw["notes"]),
      ignoreExpiredAt: str(raw["rejectionExpiredAt"]),
      aiVerdict:
        aiAnalysis && typeof aiAnalysis === "object" ? str(aiAnalysis["verdict"]) : undefined,
      aiRecommendedSeverity:
        aiAnalysis && typeof aiAnalysis === "object"
          ? (str(aiAnalysis["recommendedSeverity"]) as Severity | undefined)
          : undefined,
    };
    // Only set the array/boolean fields when the response actually carried them, so an
    // absent field stays undefined ("not captured") rather than becoming [] or false.
    if (environments && environments.length) issue.environments = environments;
    if (ticketUrls.length) issue.ticketUrls = ticketUrls;
    if (raw["validatedAsExploitable"] === true) issue.validatedAsExploitable = true;

    part.issues.push(issue);

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
      // Nothing else goes on this node, and that is load-bearing. mergeParts merges
      // field-wise on any truthy value and ISSUES_TOXIC runs AFTER INVENTORY_AI, so a
      // field set here REPLACES the inventory's. entitySnapshot is a point-in-time copy
      // taken when the issue fired: its status can be stale, and its tags are an object
      // map holding whatever the snapshot caught, so either one would quietly overwrite
      // fresher, richer inventory data. Both facts ride on the IssueRow instead
      // (entityStatus, subscriptionId), where they describe the issue rather than
      // claiming to describe the asset.
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

/** The datastore kinds the sensitive-data traversal asks for. */
const DATA_STORE_KINDS: ReadonlySet<string> = new Set(["BUCKET", "DATABASE", "DATABASE_SERVER"]);

/**
 * Raw entities of a graphSearch row, untouched.
 *
 * `entitiesOf` runs each through `normalizeCloudResource`, which knows nothing about
 * `severity` — that field is on DataFinding, not on the CloudResource fragment. So the
 * finding rows are read from the raw array instead of from the normalized nodes.
 */
function rawEntitiesOf(row: Rec): Rec[] {
  const entities = row["entities"];
  return Array.isArray(entities) ? (entities as Rec[]) : [];
}

/**
 * graphSearch "agent → service account → classified store → data findings" page.
 *
 * Emits the path entities MINUS the findings, the two edges the path implies, and one
 * `DataFindingRow` per finding. The findings are deliberately not nodes: the graph draws
 * one aggregate per store (see `withDataFindingNodes`), so a store with two hundred
 * findings costs one node rather than the whole budget.
 *
 * Counts are NOT stamped here. A page is not the step, and `mergeParts` overwrites scalars
 * rather than summing them, so a per-page count would silently become "whatever the last
 * page saw". The counts are folded from the accumulated rows once, at commit, by
 * `withDataFindingCounts`.
 *
 * Attribution: a row carries a flat entity list, so when it holds exactly one store the
 * findings are that store's. When it holds several, nothing in the response says which —
 * those findings are dropped rather than guessed at. `normalizeRunsAsPage` already accepts
 * the same limitation for a multi-service-account path.
 */
export function normalizeSensitiveDataAccessPage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const row of rows) {
    const entities = entitiesOf(row);
    const agent = entities.find((e) => e.kind === "AI_AGENT");
    const sa = entities.find((e) => e.kind === "SERVICE_ACCOUNT");
    const stores = entities.filter((e) => DATA_STORE_KINDS.has(e.kind));

    // Findings are evidence about a store, never inventory — keep them out of ai_assets.
    part.nodes.push(...entities.filter((e) => e.kind !== "DATA_FINDING"));

    if (agent && sa) {
      part.edges.push({
        id: edgeId(agent.id, "RUNS_AS", sa.id), src: agent.id, dst: sa.id, type: "RUNS_AS",
      });
    }
    for (const store of stores) {
      if (!sa) continue;
      // No accessType: the query filters on the store's classification, not on the grant's
      // strength, so claiming HIGH_PRIVILEGE here would assert something never established.
      part.edges.push({
        id: edgeId(sa.id, "ALLOWS_ACCESS_TO", store.id),
        src: sa.id,
        dst: store.id,
        type: "ALLOWS_ACCESS_TO",
      });
    }

    if (stores.length !== 1) continue;
    const storeId = stores[0].id;
    for (const raw of rawEntitiesOf(row)) {
      if (kindFromWizType(raw["type"]) !== "DATA_FINDING") continue;
      const id = str(raw["id"]);
      if (!id) continue;
      part.dataFindings.push({
        id,
        resourceId: storeId,
        name: str(raw["name"]) ?? id,
        severity: normalizeDataFindingSeverity(raw["severity"]),
      });
    }
  }
  return part;
}

/**
 * Wiz spells DSPM severities `DataFindingSeverityCritical`, not `CRITICAL` (see the
 * `EQUALS` list in exemples/toxic_combos_response.js). Strip the prefix and uppercase, so
 * one severity vocabulary reaches the rest of the app; anything unrecognised becomes
 * UNKNOWN rather than a value the severity scale cannot rank.
 */
export function normalizeDataFindingSeverity(v: unknown): Severity {
  const raw = str(v);
  if (!raw) return "UNKNOWN";
  const bare = raw.replace(/^DataFindingSeverity/i, "").toUpperCase();
  return (SEVERITY_ORDER as readonly string[]).includes(bare) ? (bare as Severity) : "UNKNOWN";
}

/**
 * Fold the accumulated data-finding rows onto the stores they were found in.
 *
 * Done once, at commit, over the whole row set rather than per page — see the note on
 * `normalizeSensitiveDataAccessPage`. Stores the traversal reached but found nothing in
 * get an explicit `0`; stores it never reached keep `undefined`, because "clean" and
 * "never asked" are different answers and pillar C prices them differently.
 */
export function withDataFindingCounts(doc: GraphDoc, rows: DataFindingRow[]): GraphDoc {
  if (!rows.length) return doc;
  const byStore = new Map<string, { count: number; sev: Record<string, number> }>();
  for (const row of rows) {
    let acc = byStore.get(row.resourceId);
    if (!acc) {
      acc = { count: 0, sev: {} };
      byStore.set(row.resourceId, acc);
    }
    acc.count += 1;
    acc.sev[row.severity] = (acc.sev[row.severity] ?? 0) + 1;
  }
  return {
    nodes: doc.nodes.map((n) => {
      const acc = byStore.get(n.id);
      if (!acc) return n;
      return { ...n, dataFindingCount: acc.count, dataFindingSeverities: acc.sev };
    }),
    edges: doc.edges,
    syncedAt: doc.syncedAt,
  };
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
  dataFindings: DataFindingRow[];
} {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const issues = new Map<string, IssueRow>();
  const findings = new Map<string, FindingRow>();
  const dataFindings = new Map<string, DataFindingRow>();
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
    for (const df of part.dataFindings ?? []) dataFindings.set(df.id, df);
  }
  return {
    doc: { nodes: [...nodes.values()], edges: [...edges.values()], syncedAt },
    issues: [...issues.values()],
    findings: [...findings.values()],
    // De-duped by finding id, so the count folded from these rows is exact however the
    // battery split its pages.
    dataFindings: [...dataFindings.values()],
  };
}

/**
 * Worst → best, for deterministic issue ordering in the merged output.
 *
 * Uses the shared `severityRank`: the inline `indexOf` this used to carry returned -1 for
 * an unrecognised severity, sorting it BEFORE CRITICAL, where every other ranking in the
 * codebase sorts it last. A fourth hand-written copy of a helper that had already been
 * collapsed from three.
 */
export function issueOrder(a: IssueRow, b: IssueRow): number {
  return severityRank(a.adjustedSeverity) - severityRank(b.adjustedSeverity)
    || (a.id < b.id ? -1 : 1);
}

export { classifyIssue };
