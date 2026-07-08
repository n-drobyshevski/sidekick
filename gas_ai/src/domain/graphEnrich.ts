// Sync-time enrichment: attaches severity / AARS / combo membership to nodes, and
// materializes one ISSUE node + HAS_ISSUE edge per open issue. Runs ONCE per sync
// (the result is persisted), never per request.

import { computeAars, gap, type AarsGap, type AarsInput, type DataExposure } from "./aars";
import { SEVERITY_ORDER, type Severity } from "./config";
import {
  AI_ASSET_KINDS,
  edgeId,
  type FindingRow,
  type GEdge,
  type GNode,
  type GraphDoc,
  type IssueRow,
} from "./graphTypes";

export interface AarsHint {
  gaps: AarsGap[];
  dataExposure: DataExposure;
}
export type AarsHints = Record<string, AarsHint>;

function severityRank(s: string | undefined): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(s ?? "");
  return i === -1 ? SEVERITY_ORDER.length : i; // lower = worse
}

function worstSeverity(severities: Severity[]): Severity | undefined {
  let worst: Severity | undefined;
  for (const s of severities) {
    if (worst === undefined || severityRank(s) < severityRank(worst)) worst = s;
  }
  return worst;
}

/**
 * Data-exposure classification (AARS pillar C bucket) from a node's CIEM/DSPM flags.
 * Extracted so the hint path (buildAarsHintsFromFindings) and the non-hint path
 * (deriveAarsInput) always agree — the topology in withSensitiveDataNodes mirrors the
 * SENSITIVE branch exactly.
 */
export function dataExposureOf(node: GNode): DataExposure {
  if (node.hasAccessToSensitiveData || node.hasSensitiveData) return "SENSITIVE";
  if (node.hasHighPrivileges || node.hasAdminPrivileges) return "DATA_ACCESS";
  return "NONE";
}

/**
 * Heuristic AARS input for live data (dry-run seeds carry exact hints transcribed
 * from ai/custom_score.md instead): compliance gaps = the distinct framework codes on
 * the asset's open issues plus NO_GUARDRAIL when guardrail coverage flagged the node;
 * data exposure from the CIEM/DSPM flags.
 */
export function deriveAarsInput(node: GNode, nodeIssues: IssueRow[]): AarsInput {
  const codes = new Set<string>();
  for (const issue of nodeIssues) {
    const fw = issue.frameworks ?? {};
    for (const c of fw.owaspLlm ?? []) codes.add(c);
    for (const c of fw.owaspAgentic ?? []) codes.add(c);
    for (const c of fw.owaspMl ?? []) codes.add(`ML_${c.replace(/\s+/g, "_").toUpperCase()}`);
  }
  const gaps: AarsGap[] = [...codes].sort().map((c) => gap(c));
  if (node.guardrailMissing) gaps.push(gap("NO_GUARDRAIL"));
  const dataExposure = dataExposureOf(node);
  return {
    // AARS Pillar A scores Wiz-NATIVE severities (the applied table in
    // ai/custom_score.md: MEDIUM ×1.2 = 24); the adjusted severity is a display
    // lens, not a scoring input — using it would double-count the 5Rs amplifier.
    issueSeverities: nodeIssues.map((i) => i.nativeSeverity),
    gaps,
    dataExposure,
  };
}

/**
 * Turn config-findings into per-asset AARS hints so live Pillar B stops being purely
 * heuristic: for each resource carrying ≥1 failing finding, the hint's gaps are the
 * union of (a) what deriveAarsInput would compute from the asset's open issues +
 * guardrail flag and (b) one gap per distinct framework code the findings contribute —
 * so no existing signal is lost and real failing controls add real points (computeAars
 * still caps pillar B at 30). dataExposure comes from deriveAarsInput, so hinted and
 * un-hinted assets classify identically. Assets with no findings are omitted and fall
 * through to deriveAarsInput unchanged.
 */
export function buildAarsHintsFromFindings(
  findings: FindingRow[],
  doc: GraphDoc,
  issues: IssueRow[],
): AarsHints {
  const open = issues.filter((i) => i.status === "OPEN");
  const issuesByAsset = new Map<string, IssueRow[]>();
  for (const issue of open) {
    if (!issuesByAsset.has(issue.assetId)) issuesByAsset.set(issue.assetId, []);
    issuesByAsset.get(issue.assetId)!.push(issue);
  }
  const codesByResource = new Map<string, string[]>();
  for (const f of findings) {
    if (!codesByResource.has(f.resourceId)) codesByResource.set(f.resourceId, []);
    codesByResource.get(f.resourceId)!.push(...f.frameworkCodes);
  }
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  const hints: AarsHints = {};
  for (const [resourceId, codes] of codesByResource) {
    const node = nodeById.get(resourceId);
    if (!node) continue;
    const base = deriveAarsInput(node, issuesByAsset.get(resourceId) ?? []);
    const seen = new Set(base.gaps.map((g) => g.code));
    const gaps = [...base.gaps];
    for (const c of codes) {
      if (c && !seen.has(c)) {
        seen.add(c);
        gaps.push(gap(c));
      }
    }
    hints[resourceId] = { gaps, dataExposure: base.dataExposure };
  }
  return hints;
}

/**
 * Enrich a raw synced graph: per-node severity (worst adjusted severity of its open
 * issues), combo membership, AARS for AI assets and any node carrying issues, plus
 * ISSUE nodes and HAS_ISSUE edges. Pure; returns a new document.
 */
export function enrichGraphDoc(
  doc: GraphDoc,
  issues: IssueRow[],
  hints?: AarsHints,
): GraphDoc {
  const open = issues.filter((i) => i.status === "OPEN");
  const byAsset = new Map<string, IssueRow[]>();
  for (const issue of open) {
    if (!byAsset.has(issue.assetId)) byAsset.set(issue.assetId, []);
    byAsset.get(issue.assetId)!.push(issue);
  }

  const nodes: GNode[] = doc.nodes.map((raw) => {
    const node: GNode = { ...raw };
    const nodeIssues = byAsset.get(node.id) ?? [];

    if (nodeIssues.length) {
      node.severity = worstSeverity(nodeIssues.map((i) => i.adjustedSeverity));
      const groups: string[] = [];
      for (const i of nodeIssues) {
        if (i.comboGroup && !groups.includes(i.comboGroup)) groups.push(i.comboGroup);
      }
      node.comboGroups = groups;
    }

    const hint = hints?.[node.id];
    const scorable =
      node.kind !== "ISSUE" &&
      node.kind !== "SUMMARY" &&
      (AI_ASSET_KINDS.includes(node.kind) || nodeIssues.length > 0 || hint !== undefined);
    if (scorable) {
      const input = hint
        ? { issueSeverities: nodeIssues.map((i) => i.nativeSeverity), ...hint }
        : deriveAarsInput(node, nodeIssues);
      const result = computeAars(input);
      node.aars = result.score;
      node.aarsBand = result.band;
      node.aarsPillars = result.pillars;
    }
    return node;
  });

  const issueNodes: GNode[] = open.map((issue) => ({
    id: issue.id,
    kind: "ISSUE",
    name: issue.ruleName,
    severity: issue.adjustedSeverity,
    comboGroups: issue.comboGroup ? [issue.comboGroup] : [],
    status: issue.status,
  }));

  const issueEdges: GEdge[] = open.map((issue) => ({
    id: edgeId(issue.assetId, "HAS_ISSUE", issue.id),
    src: issue.assetId,
    dst: issue.id,
    type: "HAS_ISSUE",
  }));

  return {
    nodes: [...nodes, ...issueNodes],
    edges: [...doc.edges, ...issueEdges],
    syncedAt: doc.syncedAt,
  };
}

/**
 * Read-time data-exposure topology (AARS pillar C): append one synthetic
 * SENSITIVE_DATA node + edge per node that holds or can reach sensitive data, so the
 * pillar is visible in the graph and relationship views the way ISSUE nodes make the
 * toxic pillar visible. The predicate mirrors the "SENSITIVE" classification in
 * `deriveAarsInput` exactly, so topology and score always agree; HOLDS
 * (`hasSensitiveData`) wins over ACCESS when both flags are set — consistent with the
 * score collapsing both to "SENSITIVE".
 *
 * Derived on READ (applied by loadGraphDoc), never persisted: it therefore covers
 * already-synced graphs without a re-sync and never leaks into the asset/inventory
 * tables. Idempotent — skips any node that already has its `sensitive|<id>` stub — and
 * pure (returns a new document, or the same one when nothing is flagged).
 */
export function withSensitiveDataNodes(doc: GraphDoc): GraphDoc {
  const existing = new Set(
    doc.nodes.filter((n) => n.kind === "SENSITIVE_DATA").map((n) => n.id),
  );
  const sensitiveNodes: GNode[] = [];
  const sensitiveEdges: GEdge[] = [];
  for (const node of doc.nodes) {
    if (node.kind === "SENSITIVE_DATA") continue;
    if (!node.hasSensitiveData && !node.hasAccessToSensitiveData) continue;
    const sensId = `sensitive|${node.id}`;
    if (existing.has(sensId)) continue;
    const type: GEdge["type"] = node.hasSensitiveData
      ? "HAS_SENSITIVE_DATA"
      : "HAS_ACCESS_TO_SENSITIVE_DATA";
    sensitiveNodes.push({ id: sensId, kind: "SENSITIVE_DATA", name: "Sensitive data" });
    sensitiveEdges.push({ id: edgeId(node.id, type, sensId), src: node.id, dst: sensId, type });
  }
  if (!sensitiveNodes.length) return doc;
  return {
    nodes: [...doc.nodes, ...sensitiveNodes],
    edges: [...doc.edges, ...sensitiveEdges],
    syncedAt: doc.syncedAt,
  };
}

/**
 * Read-time internet-exposure topology: append one synthetic INTERNET_EXPOSURE node +
 * edge per node that is reachable from the internet, so exposure reads as a first-class
 * neighbor the way SENSITIVE_DATA does for the data pillar. Derived on READ (applied by
 * loadGraphDoc), never persisted — covers already-synced graphs and never leaks into the
 * asset/inventory tables. Idempotent and pure.
 *
 * The predicate is strict `=== true`: `isAccessibleFromInternet` / `isOpenToAllInternet`
 * are tri-state (true / false / null), and null means exposure is inherited from the
 * underlying compute and undetermined — which must NOT be drawn as a definite exposure.
 */
export function withInternetExposureNodes(doc: GraphDoc): GraphDoc {
  const existing = new Set(
    doc.nodes.filter((n) => n.kind === "INTERNET_EXPOSURE").map((n) => n.id),
  );
  const exposureNodes: GNode[] = [];
  const exposureEdges: GEdge[] = [];
  for (const node of doc.nodes) {
    if (node.kind === "INTERNET_EXPOSURE") continue;
    if (node.isAccessibleFromInternet !== true && node.isOpenToAllInternet !== true) continue;
    const expId = `internet|${node.id}`;
    if (existing.has(expId)) continue;
    exposureNodes.push({ id: expId, kind: "INTERNET_EXPOSURE", name: "Internet exposure" });
    exposureEdges.push({
      id: edgeId(node.id, "EXPOSED_TO_INTERNET", expId),
      src: node.id,
      dst: expId,
      type: "EXPOSED_TO_INTERNET",
    });
  }
  if (!exposureNodes.length) return doc;
  return {
    nodes: [...doc.nodes, ...exposureNodes],
    edges: [...doc.edges, ...exposureEdges],
    syncedAt: doc.syncedAt,
  };
}
