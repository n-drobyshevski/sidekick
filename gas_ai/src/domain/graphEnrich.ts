// Sync-time enrichment: attaches severity / AARS / combo membership to nodes, and
// materializes one ISSUE node + HAS_ISSUE edge per open issue. Runs ONCE per sync
// (the result is persisted), never per request.

import { computeAars, gap, type AarsGap, type AarsInput, type DataExposure } from "./aars";
import { SEVERITY_ORDER, type Severity } from "./config";
import {
  AI_ASSET_KINDS,
  edgeId,
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
  const dataExposure: DataExposure =
    node.hasAccessToSensitiveData || node.hasSensitiveData
      ? "SENSITIVE"
      : node.hasHighPrivileges || node.hasAdminPrivileges
        ? "DATA_ACCESS"
        : "NONE";
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
      node.kind !== "SENSITIVE_DATA" &&
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

  // Data-exposure topology (AARS pillar C): one SENSITIVE_DATA node + edge per
  // data-exposed asset, so the pillar is visible in the graph the way ISSUE nodes
  // make the toxic pillar visible. The predicate mirrors the "SENSITIVE"
  // classification in deriveAarsInput exactly, so topology and score always agree.
  // HOLDS (hasSensitiveData) wins over ACCESS when both flags are set — consistent
  // with the score collapsing both to "SENSITIVE".
  const sensitiveNodes: GNode[] = [];
  const sensitiveEdges: GEdge[] = [];
  for (const node of nodes) {
    if (!node.hasSensitiveData && !node.hasAccessToSensitiveData) continue;
    const sensId = `sensitive|${node.id}`;
    const type: GEdge["type"] = node.hasSensitiveData
      ? "HAS_SENSITIVE_DATA"
      : "HAS_ACCESS_TO_SENSITIVE_DATA";
    sensitiveNodes.push({ id: sensId, kind: "SENSITIVE_DATA", name: "Sensitive data" });
    sensitiveEdges.push({ id: edgeId(node.id, type, sensId), src: node.id, dst: sensId, type });
  }

  return {
    nodes: [...nodes, ...issueNodes, ...sensitiveNodes],
    edges: [...doc.edges, ...issueEdges, ...sensitiveEdges],
    syncedAt: doc.syncedAt,
  };
}
