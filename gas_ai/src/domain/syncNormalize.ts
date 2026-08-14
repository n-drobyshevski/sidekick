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
import { HOST_KINDS } from "./exposureQuery";
import {
  AI_ASSET_KINDS,
  edgeId,
  entityField,
  kindFromWizType,
  severityRank,
  type DataFindingRow,
  type EmptyPostureReason,
  type FindingRow,
  type FrameworkPolicyRow,
  type FrameworkRow,
  type GEdge,
  type GNode,
  type GraphDoc,
  type IssueRow,
  type PolicyKind,
  type PostureRow,
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

/**
 * One CloudResource (cloudResourcesV2 node or graphSearch entity) → GNode, or null.
 *
 * The null/non-object guard is load-bearing, not defensive habit. A graphSearch row pads
 * its `entities` array with a literal `null` wherever an `optional` relationship leg found
 * no match — confirmed against the per-agent expansion capture in
 * exemples/ai_agent_expand_response.js, where 39 of 43 slots are null. Without the guard
 * `raw["id"]` throws a TypeError, and because runBattery only forgives an optional step on
 * HTTP 400 (syncJobs.ts), that TypeError fails the entire sync instead of being recorded
 * as a skip. Q_AGENT_SENSITIVE_DATA_ACCESS marks HAS_DATA_FINDING optional, so any
 * classified store with no data finding reaches here.
 */
export function normalizeCloudResource(raw: Rec): GNode | null {
  if (!raw || typeof raw !== "object") return null;
  const id = str(raw["id"]);
  // Real tenants return display-style types ("AI Agent"), the design docs used
  // enum style ("AI_AGENT") — kindFromWizType accepts both.
  const kind = kindFromWizType(raw["type"]);
  if (!id || !kind) return null;
  // Every resource fact goes through entityField, because this function serves two roots
  // that carry them differently: flat on a cloudResourcesV2 node, inside `properties` on a
  // graphSearch entity. Reading raw[key] directly worked only for the first, which is why
  // every graphSearch-fed node used to arrive with a kind and nothing else.
  const f = (key: string): unknown => entityField(raw, key);
  const node: GNode = {
    id,
    kind,
    name: str(raw["name"]) ?? id,
    nativeType: str(f("nativeType")),
    cloudPlatform: str(f("cloudPlatform")),
    region: str(f("region")),
    status: str(f("status")),
    firstSeen: str(f("firstSeen")),
    lastSeen: str(f("lastSeen")),
    externalId: str(f("externalId")),
    isAccessibleFromInternet: triBool(f("isAccessibleFromInternet")),
    isOpenToAllInternet: triBool(f("isOpenToAllInternet")),
    hasSensitiveData: bool(f("hasSensitiveData")),
    hasAccessToSensitiveData: bool(f("hasAccessToSensitiveData")),
    hasHighPrivileges: bool(f("hasHighPrivileges")),
    hasAdminPrivileges: bool(f("hasAdminPrivileges")),
  };
  // Only the principals query selects this flat; on a graphSearch entity it rides in the
  // properties bag, which is how an agentic identity reached through a traversal keeps its
  // purpose instead of looking like an ordinary service account.
  const purpose = str(f("identityPurpose"));
  if (purpose) node.identityPurpose = purpose;
  // ENDPOINT entities only (aliased to exposureLevel_name / portValidationResult in
  // graphTypes.PROPERTY_ALIASES). Set only when present, so every other kind's row stays
  // exactly as it was — and read from the payload rather than inferred from which query
  // returned the row, because the host-exposure traversal returns endpoints unfiltered.
  const exposureLevel = str(f("exposureLevel"));
  if (exposureLevel) node.exposureLevel = exposureLevel;
  const portValidation = str(f("portValidation"));
  if (portValidation) node.portValidation = portValidation;
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
  // Guard kept: projectsOf answers [] for a non-array, and an asset whose response
  // carried no projects key must stay `undefined` here rather than gain an empty list.
  if (Array.isArray(projects)) node.projects = projectsOf(projects);
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
  /** The framework catalogue (FRAMEWORKS_LIST). */
  frameworks: FrameworkRow[];
  /** The flattened posture tree, one row per framework/category/subcategory node. */
  posture: PostureRow[];
  /** The (framework, subcategory, policy) many-to-many edges. */
  frameworkPolicies: FrameworkPolicyRow[];
}

export function emptyPart(): NormalizedPart {
  return {
    nodes: [], edges: [], issues: [], findings: [], dataFindings: [],
    frameworks: [], posture: [], frameworkPolicies: [],
  };
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
  target.frameworks.push(...part.frameworks);
  target.posture.push(...part.posture);
  target.frameworkPolicies.push(...part.frameworkPolicies);
}

/** True when a part carries nothing at all — on ANY arm. */
export function partIsEmpty(part: NormalizedPart): boolean {
  return (
    !part.nodes.length && !part.edges.length && !part.issues.length &&
    !part.findings.length && !part.dataFindings.length &&
    !part.frameworks.length && !part.posture.length && !part.frameworkPolicies.length
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

/** The `id`s of an object list (ignoreRules, sourceMappedIacFindings), in response order. */
function idsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Rec[])
    .map((r) => (r && typeof r === "object" ? str(r["id"]) : undefined))
    .filter((v): v is string => !!v);
}

/** A string array off the response, dropping blanks. Rule `risks` / `threats`. */
function strListOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => str(v)).filter((v): v is string => !!v);
}

/** `projects { id name riskProfile { businessImpact } }` → the flat shape rows store. */
function projectsOf(raw: unknown): Array<{ id: string; name: string; businessImpact?: string }> {
  if (!Array.isArray(raw)) return [];
  return (raw as Rec[])
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      const id = str(p["id"]);
      const name = str(p["name"]);
      if (!id || !name) return null;
      // businessImpact is nested under riskProfile in the API, not flat on Project.
      const profile = p["riskProfile"] as Rec | null | undefined;
      const businessImpact = profile && typeof profile === "object"
        ? str(profile["businessImpact"])
        : undefined;
      return { id, name, businessImpact };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
}

/**
 * configurationFindings page → one FindingRow per finding, keyed to the resource it was
 * evaluated against. No nodes/edges/issues — findings are a side channel that feeds AARS
 * pillar B and backs the Cloud Configuration register.
 *
 * STORES BROADLY, JUDGES NARROWLY. This used to drop everything that was not
 * `result === "FAIL"` and OPEN, which was right while the step only ever asked for OPEN
 * rows. It is wrong now the filter also asks for RESOLVED: a finding that resolved
 * because someone fixed the misconfiguration comes back PASS, so the old gate would have
 * discarded precisely the rows the widened filter exists to collect — and silently, since
 * a dropped row and a tenant with nothing to report look identical downstream.
 *
 * So the gate moved out of the door and into `isOpenGap` (domain/config.ts), which every
 * consumer that counts or prices a finding calls. What survives here is only the two
 * conditions that make a row unusable rather than uninteresting: no id, or no resource to
 * key it to.
 */
export function normalizeConfigFindingsPage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const raw of rows) {
    const id = str(raw["id"]);
    if (!id) continue;
    const resource = raw["resource"] as Rec | null | undefined;
    const resourceId = resource && typeof resource === "object" ? str(resource["id"]) : undefined;
    if (!resourceId) continue;
    const rule = raw["rule"] as Rec | null | undefined;
    const hasRule = !!rule && typeof rule === "object";
    const ruleShortId = hasRule ? str(rule!["shortId"]) ?? "" : "";
    const subscription = raw["subscription"] as Rec | null | undefined;
    const hasSub = !!subscription && typeof subscription === "object";
    const rawProjects = resource && typeof resource === "object" ? resource["projects"] : undefined;

    part.findings.push({
      id,
      resourceId,
      ruleShortId,
      severity: (str(raw["severity"]) ?? "UNKNOWN") as Severity,
      remediation: str(raw["remediation"]),
      frameworkCodes: frameworkCodesFromRule(rule, ruleShortId),

      name: str(raw["name"]),
      status: str(raw["status"]),
      result: str(raw["result"]),
      // Only an explicit `true` is a tombstone. `deleted` absent from the response must
      // stay absent on the row, not become `false` — "not collected" and "collected and
      // false" are different facts, and isOpenGap reads the difference.
      deleted: raw["deleted"] === true ? true : undefined,
      firstSeenAt: str(raw["firstSeenAt"]),
      analyzedAt: str(raw["analyzedAt"]),

      ruleId: hasRule ? str(rule!["id"]) : undefined,
      ruleGraphId: hasRule ? str(rule!["graphId"]) : undefined,
      ruleName: hasRule ? str(rule!["name"]) : undefined,
      ruleDescription: hasRule ? str(rule!["description"]) : undefined,
      remediationInstructions: hasRule ? str(rule!["remediationInstructions"]) : undefined,
      opaPolicy: hasRule ? str(rule!["opaPolicy"]) : undefined,
      risks: hasRule ? strListOf(rule!["risks"]) : [],
      threats: hasRule ? strListOf(rule!["threats"]) : [],

      resourceName: str(resource!["name"]),
      resourceType: str(resource!["type"]),
      resourceStatus: str(resource!["status"]),
      targetExternalId: str(raw["targetExternalId"]),
      source: str(raw["source"]),

      subscriptionId: hasSub ? str(subscription!["id"]) : undefined,
      subscriptionName: hasSub ? str(subscription!["name"]) : undefined,
      cloudProvider: hasSub ? str(subscription!["cloudProvider"]) : undefined,
      projects: projectsOf(rawProjects),
      businessImpact: Array.isArray(rawProjects)
        ? worstBusinessImpact(rawProjects as Rec[])
        : undefined,

      ignoreRuleIds: idsOf(raw["ignoreRules"]),
      iacFindingIds: idsOf(raw["sourceMappedIacFindings"]),
    });
  }
  return part;
}

// ---------------------------------------- compliance framework posture

/**
 * A count Wiz sends as `null`.
 *
 * `null` here means "none", not "unknown" — the console renders these cells blank and the
 * sibling `assessedCount` proves the policy ran. Coerced to 0 so arithmetic downstream
 * never has to guard, which is safe ONLY because emptiness is carried separately by
 * `noResourceToAsses` / `emptyPostureReason` rather than inferred from a zero.
 */
function count(v: unknown): number {
  return typeof v === "number" && isFinite(v) ? v : 0;
}

/**
 * A posture percentage. Kept `number | null` — NOT coerced — because null is the whole
 * point: it is the difference between "scored 0%" and "nothing to score", and the empty
 * reason beside it says which.
 */
function posturePct(v: unknown): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function tagsOf(raw: unknown): { key: string; value: string }[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Rec[])
    .filter((t) => t && typeof t === "object")
    .map((t) => ({ key: str(t["key"]) ?? "", value: str(t["value"]) ?? "" }))
    .filter((t) => t.key !== "" || t.value !== "");
}

/** securityFrameworks page → catalogue rows. `selected` is resolved from settings later. */
export function normalizeFrameworksPage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const id = str(raw["id"]);
    if (!id) continue;
    part.frameworks.push({
      id,
      name: str(raw["name"]) ?? id,
      description: str(raw["description"]),
      builtin: bool(raw["builtin"]),
      enabled: bool(raw["enabled"]),
      policyTypes: strListOf(raw["policyTypes"]),
      selected: false,
    });
  }
  return part;
}

/**
 * The three mutually exclusive policy shapes on a policyAnalytics row.
 *
 * Exactly one of `control` / `cloudConfigurationRule` / `hostConfigurationRule` is
 * non-null; the other two are null. Returning the kind alongside the object is what lets
 * one flattener handle all three without three near-identical branches — and the kind is
 * kept on the row because the detail sheet must not present a Control (a graph query) and
 * a CloudConfigurationRule (a Rego evaluation) as the same sort of thing.
 */
function policyOf(raw: Rec): { kind: PolicyKind; obj: Rec } | null {
  const control = raw["control"];
  if (control && typeof control === "object") return { kind: "CONTROL", obj: control as Rec };
  const cloud = raw["cloudConfigurationRule"];
  if (cloud && typeof cloud === "object") return { kind: "CLOUD_RULE", obj: cloud as Rec };
  const host = raw["hostConfigurationRule"];
  if (host && typeof host === "object") return { kind: "HOST_RULE", obj: host as Rec };
  return null;
}

/**
 * securityFramework → complianceAnalytics → the flattened tree plus the policy edges.
 *
 * Takes the ONE object fetchSingleObject wrapped in a one-row page. Emits:
 *   - one `posture` row per framework / category / subcategory node, level-tagged
 *   - one `frameworkPolicies` row per (framework, subcategory, policy) pair
 *
 * The policy arm is a MANY-TO-MANY EDGE and is emitted once per subcategory a policy maps
 * to, deliberately repeating the policy's metadata. In the sample tenant one
 * prompt-injection control appears under ASI01, ASI02 and ASI10; deduplicating by policy
 * id would destroy exactly the mapping this step exists to collect, and summing these rows
 * as though they were distinct policies would treble-count it. Both are real bugs the row
 * shape makes hard to write: the key is the triple, and nothing here sums.
 *
 * Percentages are carried through EXACTLY as Wiz sent them and never recomputed. Wiz owns
 * the definition of posture; a second locally-derived number beside theirs would be two
 * answers to one question, and the one on screen would depend on which code path ran.
 */
export function normalizeCompliancePosturePage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const frameworkId = str(raw["id"]);
    if (!frameworkId) continue;
    const analytics = raw["complianceAnalytics"] as Rec | null | undefined;
    if (!analytics || typeof analytics !== "object") continue;

    const categories = Array.isArray(analytics["categoryAnalytics"])
      ? (analytics["categoryAnalytics"] as Rec[])
      : [];

    // The framework row. pass/fail at this level are SUBCATEGORY counts, not policy
    // counts — Wiz names them passSubCategoryCount — so they land in the subcategory
    // fields and the policy-count fields stay 0 rather than borrowing a different unit.
    part.posture.push({
      frameworkId,
      level: "framework",
      nodeId: frameworkId,
      title: str(raw["name"]) ?? frameworkId,
      description: str(raw["description"]),
      posturePct: posturePct(analytics["averageCompliancePosture"]),
      passCount: 0,
      failCount: 0,
      passSubCategoryCount: count(analytics["passSubCategoryCount"]),
      failSubCategoryCount: count(analytics["failSubCategoryCount"]),
      emptyPostureReason: str(analytics["emptyPostureReason"]) ?? null,
    });

    for (const cat of categories) {
      if (!cat || typeof cat !== "object") continue;
      const category = cat["category"] as Rec | null | undefined;
      const hasCat = !!category && typeof category === "object";
      const catExternalId = hasCat ? str(category!["externalId"]) ?? "" : "";

      part.posture.push({
        frameworkId,
        level: "category",
        categoryExternalId: catExternalId,
        nodeId: hasCat ? str(category!["id"]) : undefined,
        title: hasCat ? str(category!["name"]) ?? catExternalId : catExternalId,
        description: hasCat ? str(category!["description"]) : undefined,
        posturePct: posturePct(cat["averageCompliancePosture"]),
        passCount: count(cat["passCount"]),
        failCount: count(cat["failCount"]),
        passSubCategoryCount: count(cat["passSubCategoryCount"]),
        failSubCategoryCount: count(cat["failSubCategoryCount"]),
        emptyPostureReason: str(cat["emptyPostureReason"]) ?? null,
      });

      const subs = Array.isArray(cat["subCategoryAnalytics"])
        ? (cat["subCategoryAnalytics"] as Rec[])
        : [];
      for (const sub of subs) {
        if (!sub || typeof sub !== "object") continue;
        const subCategory = sub["subCategory"] as Rec | null | undefined;
        const hasSub = !!subCategory && typeof subCategory === "object";
        const subExternalId = hasSub ? str(subCategory!["externalId"]) ?? "" : "";

        part.posture.push({
          frameworkId,
          level: "subcategory",
          categoryExternalId: catExternalId,
          subcategoryExternalId: subExternalId,
          nodeId: hasSub ? str(subCategory!["id"]) : undefined,
          title: hasSub ? str(subCategory!["title"]) ?? subExternalId : subExternalId,
          description: hasSub ? str(subCategory!["description"]) : undefined,
          posturePct: posturePct(sub["compliancePosture"]),
          passCount: count(sub["passCount"]),
          failCount: count(sub["failCount"]),
          emptyPostureReason: str(sub["emptyPostureReason"]) ?? null,
          assessmentScope: hasSub ? str(subCategory!["assessmentScope"]) : undefined,
          mappingRationale: hasSub ? str(subCategory!["mappingRationale"]) : undefined,
          tags: hasSub ? tagsOf(subCategory!["tags"]) : [],
        });

        const policies = Array.isArray(sub["policyAnalytics"])
          ? (sub["policyAnalytics"] as Rec[])
          : [];
        for (const pol of policies) {
          if (!pol || typeof pol !== "object") continue;
          const picked = policyOf(pol);
          if (!picked) continue;
          const policyId = str(picked.obj["id"]);
          if (!policyId) continue;
          part.frameworkPolicies.push({
            frameworkId,
            categoryExternalId: catExternalId,
            subcategoryExternalId: subExternalId,
            policyId,
            policyKind: picked.kind,
            // Only a CloudConfigurationRule carries shortId ("AIGuardrail-007"); a
            // HostConfigurationRule spells its short name `shortName`, and a Control has
            // neither. This is the field the finding join matches on when present.
            shortId: str(picked.obj["shortId"]) ?? str(picked.obj["shortName"]),
            name: str(picked.obj["name"]) ?? policyId,
            severity: (str(picked.obj["severity"]) ?? "UNKNOWN") as Severity,
            enabled: triBool(picked.obj["enabled"]) ?? undefined,
            builtin: triBool(picked.obj["builtin"]) ?? undefined,
            passCount: count(pol["passCount"]),
            failCount: count(pol["failCount"]),
            assessedCount: count(pol["assessedCount"]),
            rejectedCount: count(pol["rejectedCount"]),
            // Wiz's spelling, one 's'. Kept verbatim on the wire, corrected on the row.
            noResourceToAssess: pol["noResourceToAsses"] === true,
            targetNativeType: str(picked.obj["targetNativeType"]),
            subjectEntityType: str(picked.obj["subjectEntityType"]),
            cloudProvider: str(picked.obj["cloudProvider"]),
            hasAutoRemediation: triBool(picked.obj["hasAutoRemediation"]) ?? undefined,
          });
        }
      }
    }
  }
  return part;
}

/**
 * Relabel findings with the authoritative framework codes. THE ONLY PLACE THIS HAPPENS.
 *
 * Applied at COMMIT, not during normalization, and that ordering is the point: findings are
 * normalized page by page while the battery runs, and the posture steps may not have run
 * yet when the first config-findings page arrives. A per-page join would silently label the
 * early pages and not the late ones — the same finding getting different codes depending on
 * which order Wiz answered in.
 *
 * WHAT THIS DOES NOT DO: add or remove a gap. Every finding in, every finding out, same
 * ids, same severities. Only `frameworkCodes` grows, and only by codes Wiz itself asserts.
 * The gap COUNT that pillar B prices is unchanged; what changes is which cascade row
 * matches — which is the entire point, because the rows naming ASI / ML_ / 5R_ codes have
 * never been able to fire (see graphEnrich's note on the 5Rs mappings).
 *
 * Because it does change scores, the caller gates it on `gapSources.frameworkMapping`,
 * which defaults off.
 */
export function withFrameworkCodes(
  findings: FindingRow[],
  lookup: Record<string, string[]>,
): FindingRow[] {
  if (!findings.length) return findings;
  return findings.map((f) => {
    const extra: string[] = [];
    for (const c of lookup[f.ruleShortId] ?? []) extra.push(c);
    if (f.ruleId) for (const c of lookup[f.ruleId] ?? []) extra.push(c);
    if (!extra.length) return f;
    const codes = f.frameworkCodes.slice();
    for (const c of extra) if (!codes.includes(c)) codes.push(c);
    if (codes.length === f.frameworkCodes.length) return f;
    return { ...f, frameworkCodes: codes };
  });
}

/** The codebook vocabulary a framework's codes belong to, read off its name. */
export type CodeFamily = "OWASP_LLM" | "OWASP_ASI" | "OWASP_ML" | "WIZ_5RS" | "OTHER";

/**
 * Which codebook family a Wiz framework speaks, from its name.
 *
 * By name rather than by id because framework ids are tenant-local (`wf-id-275` here is
 * not `wf-id-275` everywhere) while the names are Wiz's own product strings. A framework
 * this app has no vocabulary for returns OTHER, and OTHER mints no codes at all — see
 * frameworkGapCode.
 */
export function frameworkFamily(name: string): CodeFamily {
  const n = String(name ?? "").toUpperCase();
  if (/\b5\s?RS?\b/.test(n)) return "WIZ_5RS";
  if (n.includes("AGENTIC")) return "OWASP_ASI";
  if (n.includes("MACHINE LEARNING") || /\bML\b/.test(n)) return "OWASP_ML";
  if (n.includes("LLM")) return "OWASP_LLM";
  return "OTHER";
}

/** graphEnrich's existing spelling for a derived code, mirrored so the two sources agree. */
function snake(label: string): string {
  return String(label ?? "").trim().replace(/\s+/g, "_").toUpperCase();
}

/**
 * One posture node → the gap code the AARS cascade prices, or "" for none.
 *
 * Each family spells its codes differently, and getting this wrong is silent: a code
 * nothing recognizes still reaches the cascade and is priced by the fallback row, so it
 * looks like it worked while pricing the wrong thing. The three spellings, from
 * client/js/codebook.js:
 *
 *   - OWASP Agentic: the external id IS the code (`ASI01`). Self-identifying.
 *   - OWASP LLM: the external ids are NUMERIC (`1`, `1.1`) and the code lives in the
 *     CATEGORY NAME — `1 LLM01:2025 Prompt Injection`. Reading the number would be wrong
 *     twice over: `1.1` is not a code, and the framework's own numbering does not track
 *     the OWASP ordinal in every edition. So the name is parsed, and nothing is minted
 *     when it carries no code.
 *   - OWASP ML: `ML_` + the subcategory TITLE, not an ordinal. The codebook says so
 *     outright — "the ML0n below is a mapping this page states, not one the data contains"
 *     — and graphEnrich already derives them this way from issue mappings. `ML01` would be
 *     a code nothing carries.
 *   - Wiz 5Rs: `5R_` + the CATEGORY name (`5R_REDUCE`), not the numeric external id.
 *     `5R_1_1` would match no codebook entry and no cascade row but the fallback.
 *
 * An unrecognized framework mints nothing. That is deliberate: the finding's own shortId
 * is still raised as a gap by frameworkCodesFromRule, so the asset is not under-counted,
 * and inventing a prefix would put a code into the cascade that no rule can be written
 * against on purpose.
 */
export function frameworkGapCode(input: {
  family: CodeFamily;
  categoryName?: string;
  subcategoryExternalId?: string;
  subcategoryTitle?: string;
}): string {
  const ext = String(input.subcategoryExternalId ?? "").trim().toUpperCase();
  if (/^(LLM|ASI)\d{2}$/.test(ext)) return ext;
  if (input.family === "OWASP_LLM") {
    // "1 LLM01:2025 Prompt Injection" → LLM01. The `:2025` is the EDITION, and it decides
    // whether the code may be used at all: the codebook is written against OWASP LLM 2025
    // and warns that the 2026 edition renumbers eight of the ten entries, with two pairs
    // effectively swapping. A 2026 `LLM03` priced against a 2025 `LLM03` row would score
    // Excessive Agency as Supply Chain — a confidently wrong number, which is worse than
    // no number. So an edition this model was not written against mints nothing and the
    // finding falls to its own shortId.
    const m = String(input.categoryName ?? "").toUpperCase()
      .match(/\b(LLM\d{2})\b(?::(\d{4}))?/);
    if (!m) return "";
    if (m[2] && m[2] !== "2025") return "";
    return m[1];
  }
  if (input.family === "OWASP_ML") {
    const title = snake(input.subcategoryTitle ?? "");
    return title ? `ML_${title}` : "";
  }
  if (input.family === "WIZ_5RS") {
    const cat = snake(input.categoryName ?? "");
    return cat ? `5R_${cat}` : "";
  }
  return "";
}

/**
 * The authoritative policy → framework-code lookup, built from the synced posture rows.
 *
 * This is the join the whole AARS half of this feature turns on. Before it, framework
 * codes came from `frameworkCodesFromRule` regex-scraping a rule's tags for an OWASP
 * token — which only ever worked if the tenant happened to write one there. Wiz knows the
 * real mapping and states it here, per framework, per subcategory.
 *
 * Keyed by BOTH `policyId` and `shortId`: a configuration finding carries `rule.id` and
 * `rule.shortId`, and which one matches depends on the policy kind.
 *
 * Note this ADDS NO GAP. It relabels the gaps an asset already had, so pillar B's dormant
 * ASI / ML_ / 5R_ rows can finally match. Counting is untouched.
 */
export function frameworkCodeLookup(
  policies: FrameworkPolicyRow[],
  posture: PostureRow[],
  frameworks: FrameworkRow[],
): Record<string, string[]> {
  const familyByFramework: Record<string, CodeFamily> = {};
  for (const f of frameworks) familyByFramework[f.id] = frameworkFamily(f.name);
  // A framework row in the posture tree also carries the name, so a lookup built from a
  // posture-only sync (no catalogue step) still resolves its family.
  for (const p of posture) {
    if (p.level === "framework" && !familyByFramework[p.frameworkId]) {
      familyByFramework[p.frameworkId] = frameworkFamily(p.title);
    }
  }

  const categoryName: Record<string, string> = {};
  const subcategoryTitle: Record<string, string> = {};
  for (const p of posture) {
    if (p.level === "category") {
      categoryName[`${p.frameworkId}|${p.categoryExternalId ?? ""}`] = p.title;
    } else if (p.level === "subcategory") {
      subcategoryTitle[`${p.frameworkId}|${p.subcategoryExternalId ?? ""}`] = p.title;
    }
  }

  const byKey: Record<string, string[]> = {};
  const add = (key: string | undefined, code: string) => {
    if (!key || !code) return;
    const list = byKey[key] ?? (byKey[key] = []);
    if (!list.includes(code)) list.push(code);
  };
  for (const p of policies) {
    const code = frameworkGapCode({
      family: familyByFramework[p.frameworkId] ?? "OTHER",
      categoryName: categoryName[`${p.frameworkId}|${p.categoryExternalId}`],
      subcategoryExternalId: p.subcategoryExternalId,
      subcategoryTitle: subcategoryTitle[`${p.frameworkId}|${p.subcategoryExternalId}`],
    });
    if (!code) continue;
    add(p.policyId, code);
    add(p.shortId, code);
  }
  return byKey;
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
 * `entitiesOf` runs each through `normalizeCloudResource`, which builds a GNode and a GNode
 * has no `severity` — that fact belongs to the finding, not to the inventory shape. So the
 * finding rows are read from the raw array instead of from the normalized nodes.
 */
function rawEntitiesOf(row: Rec): Rec[] {
  const entities = row["entities"];
  if (!Array.isArray(entities)) return [];
  // Null padding for unmatched `optional` legs must be dropped here too: the caller reads
  // raw["type"] directly, without going through normalizeCloudResource's guard.
  return (entities as unknown[]).filter(
    (e): e is Rec => Boolean(e) && typeof e === "object",
  );
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
        // Through entityField: on a graphSearch entity `severity` rides in the properties
        // bag, not flat. The capture shows it there on the finding entities.
        severity: normalizeDataFindingSeverity(entityField(raw, "severity")),
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

// ---------------------------------------------------------------- network exposure

const HOST_KIND_SET: ReadonlySet<string> = new Set(HOST_KINDS);

/** The raw entity of the first matching kind in a row — the sub-objects `entitiesOf` drops. */
function rawEntityOfKind(row: Rec, kinds: ReadonlySet<string>): Rec | undefined {
  for (const raw of rawEntitiesOf(row)) {
    const kind = kindFromWizType(raw["type"]);
    if (kind && kinds.has(kind)) return raw;
  }
  return undefined;
}

/** Push `value` onto `list` if it is a non-empty string not already there. Order-stable. */
function addUnique(list: string[], value: string | undefined): void {
  if (value && list.indexOf(value) < 0) list.push(value);
}

/**
 * graphSearch "AI asset ← RUNS ← internet-reachable VM / SERVERLESS" page.
 *
 * Emits the asset, the host, the `asset -HOSTED_ON-> host` edge the traversal implies, the
 * host's public-exposure evidence (ports and source ranges), and one ENDPOINT node per
 * `applicationEndpoints` entry with a `host -SERVES-> endpoint` edge.
 *
 * BY TYPE, NOT BY SLOT — and this is the one place that needs saying, because
 * graphExpand.ts:17 spells out at length why the same shortcut is unsound there. It is sound
 * here because the spec has exactly TWO selected nodes over DISJOINT type sets: the root is
 * an AI resource type, the leg is VIRTUAL_MACHINE / SERVERLESS, and neither can appear
 * twice in one row. The battery's other graphSearch normalizers rest on the same property.
 *
 * The endpoints hang off the HOST, not off the asset — that is where the capture puts them
 * (exemples/ai_exposure_host_response.js) and it is why `withExposureEvidence` has to walk
 * `asset -HOSTED_ON-> host -SERVES-> endpoint` and not only the direct edge.
 *
 * NOT NORMALIZED, deliberately: `lateralMovementPaths` and `codeSourcePath`. The document
 * fetches both (the console's own flags), and every page lands whole in the Drive archive
 * via `writeSyncPage`. Turning them into edges is what is refused. A lateral-movement path
 * is an ordered list of arbitrary intermediate hops with no declared relationship between
 * them, and the only capture returns `codeSourcePath: { totalCount: 0, nodes: null }` — so a
 * BUILT_FROM chain written against it would be a guess about a payload nobody has seen,
 * which is precisely the confidently-wrong-edge failure this file exists to avoid. The
 * archive is the response-capture source; a normalizer can be written when there is one.
 */
export function normalizeHostExposurePage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const row of rows) {
    const entities = entitiesOf(row);
    const asset = entities.find((e) => (AI_ASSET_KINDS as readonly string[]).includes(e.kind));
    const host = entities.find((e) => HOST_KIND_SET.has(e.kind));
    part.nodes.push(...entities);
    if (!host) continue;
    if (asset) {
      part.edges.push({
        id: edgeId(asset.id, "HOSTED_ON", host.id),
        src: asset.id,
        dst: host.id,
        type: "HOSTED_ON",
      });
    }

    const rawHost = rawEntityOfKind(row, HOST_KIND_SET);
    const exposures = rawHost ? (rawHost["publicExposures"] as Rec | null | undefined) : undefined;
    const exposureNodes = exposures && typeof exposures === "object" ? exposures["nodes"] : null;
    if (!Array.isArray(exposureNodes)) continue;

    const ports: string[] = [];
    const sourceIpRanges: string[] = [];
    for (const exposure of exposureNodes as Rec[]) {
      if (!exposure || typeof exposure !== "object") continue;
      addUnique(ports, str(exposure["portRange"]));
      addUnique(sourceIpRanges, str(exposure["sourceIpRange"]));
      const endpoints = exposure["applicationEndpoints"];
      if (!Array.isArray(endpoints)) continue;
      for (const rawEndpoint of endpoints as Rec[]) {
        const endpoint = normalizeCloudResource(rawEndpoint);
        if (!endpoint || endpoint.kind !== "ENDPOINT") continue;
        part.nodes.push(endpoint);
        part.edges.push({
          id: edgeId(host.id, "SERVES", endpoint.id),
          src: host.id,
          dst: endpoint.id,
          type: "SERVES",
        });
      }
    }
    // On the HOST, which is the node these facts are true of. `withExposureEvidence` carries
    // them up to the assets it runs; stamping them on the asset here would claim the agent
    // itself listens on those ports.
    if (ports.length || sourceIpRanges.length) {
      const evidence: NonNullable<GNode["exposureEvidence"]> = {};
      if (ports.length) evidence.ports = ports;
      if (sourceIpRanges.length) evidence.sourceIpRanges = sourceIpRanges;
      host.exposureEvidence = evidence;
    }
  }
  return part;
}

/**
 * graphSearch "AI asset → SERVES → validated, High/Medium-rated ENDPOINT" page.
 *
 * Two selected nodes over disjoint type sets again, so by-type is sound — see
 * normalizeHostExposurePage.
 *
 * The endpoint's own `exposureLevel` / `portValidation` ride on the node
 * (normalizeCloudResource reads them from the properties bag). Nothing is stamped from the
 * filter, which is the difference between this step and normalizePrincipalsPage: there, the
 * flag exists only as a claim about the filter and the filter is therefore locked; here the
 * response carries the values, so what is stored is what Wiz said.
 */
export function normalizeEndpointExposurePage(rows: Rec[]): NormalizedPart {
  const part = emptyPart();
  for (const row of rows) {
    const entities = entitiesOf(row);
    const asset = entities.find((e) => (AI_ASSET_KINDS as readonly string[]).includes(e.kind));
    const endpoint = entities.find((e) => e.kind === "ENDPOINT");
    part.nodes.push(...entities);
    if (!asset || !endpoint) continue;
    part.edges.push({
      id: edgeId(asset.id, "SERVES", endpoint.id),
      src: asset.id,
      dst: endpoint.id,
      type: "SERVES",
    });
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
  dataFindings: DataFindingRow[];
  frameworks: FrameworkRow[];
  posture: PostureRow[];
  frameworkPolicies: FrameworkPolicyRow[];
} {
  const nodes = new Map<string, GNode>();
  const edges = new Map<string, GEdge>();
  const issues = new Map<string, IssueRow>();
  const findings = new Map<string, FindingRow>();
  const dataFindings = new Map<string, DataFindingRow>();
  const frameworks = new Map<string, FrameworkRow>();
  // Keyed by the composite the row IS. A posture node is identified by
  // (framework, level, category, subcategory) and a policy edge by
  // (framework, subcategory, policy) — dedupe by anything narrower and the many-to-many
  // collapses, which is the one thing this whole table exists to preserve.
  const posture = new Map<string, PostureRow>();
  const frameworkPolicies = new Map<string, FrameworkPolicyRow>();
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
    for (const f of part.frameworks ?? []) frameworks.set(f.id, f);
    for (const p of part.posture ?? []) {
      posture.set(
        `${p.frameworkId}|${p.level}|${p.categoryExternalId ?? ""}|${p.subcategoryExternalId ?? ""}`,
        p,
      );
    }
    for (const p of part.frameworkPolicies ?? []) {
      frameworkPolicies.set(
        `${p.frameworkId}|${p.subcategoryExternalId}|${p.policyId}`,
        p,
      );
    }
  }
  return {
    doc: { nodes: [...nodes.values()], edges: [...edges.values()], syncedAt },
    issues: [...issues.values()],
    findings: [...findings.values()],
    // De-duped by finding id, so the count folded from these rows is exact however the
    // battery split its pages.
    dataFindings: [...dataFindings.values()],
    frameworks: [...frameworks.values()],
    posture: [...posture.values()],
    frameworkPolicies: [...frameworkPolicies.values()],
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
