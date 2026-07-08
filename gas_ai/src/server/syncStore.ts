// Persistence of one sync's graph: enrichment → tab rewrite → Drive snapshot →
// sync_history append (the commit record, always LAST — no history row means the
// sync never happened and the previous snapshot stays authoritative).
//
// Read model: the Drive snapshot is the fast path for getGraph; the tabs are the
// inspectable/exportable source of truth and the fallback when the snapshot is
// missing or unreadable.

import { enrichGraphDoc, withSensitiveDataNodes, type AarsHints } from "../domain/graphEnrich";
import type { GEdge, GNode, GraphDoc, IssueRow, NodeKind } from "../domain/graphTypes";
import { edgeId } from "../domain/graphTypes";
import type { Severity } from "../domain/config";
import { nowIso, type Rec } from "../domain/util";
import { readGraphSnapshot, trashGraphSnapshot, writeGraphSnapshot } from "./archiveStore";
import { bumpDataVersion } from "./serverCache";
import { appendRows, overwrite, readAll, TABS } from "./sheetsDb";

// ------------------------------------------------------------- row (de)serializers
// Cells are plain text ("@"): booleans serialize as "true"/"false" ("null" for the
// tri-state internet flag), arrays/objects as JSON — byte-stable round trips.

function boolCell(v: boolean | undefined): string {
  return v ? "true" : "false";
}
function triCell(v: boolean | null | undefined): string {
  return v === null || v === undefined ? "null" : v ? "true" : "false";
}
function parseBool(v: unknown): boolean {
  return String(v) === "true";
}
function parseTri(v: unknown): boolean | null {
  const s = String(v);
  return s === "true" ? true : s === "false" ? false : null;
}
function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || v === "") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export function assetToRow(n: GNode): Rec {
  return {
    id: n.id,
    kind: n.kind,
    name: n.name,
    native_type: n.nativeType ?? null,
    cloud: n.cloudPlatform ?? null,
    region: n.region ?? null,
    status: n.status ?? null,
    account_id: n.cloudAccount?.id ?? null,
    account_name: n.cloudAccount?.name ?? null,
    projects_json: JSON.stringify((n.projects ?? []).map((p) => p.name)),
    first_seen: n.firstSeen ?? null,
    last_seen: n.lastSeen ?? null,
    internet: triCell(n.isAccessibleFromInternet),
    sensitive_data: boolCell(n.hasSensitiveData),
    sensitive_access: boolCell(n.hasAccessToSensitiveData),
    high_priv: boolCell(n.hasHighPrivileges),
    admin_priv: boolCell(n.hasAdminPrivileges),
    guardrail_missing: boolCell(n.guardrailMissing),
    severity: n.severity ?? null,
    aars: n.aars ?? null,
    aars_band: n.aarsBand ?? null,
    aars_pillars_json: n.aarsPillars ? JSON.stringify(n.aarsPillars) : null,
    combo_groups: (n.comboGroups ?? []).join(","),
    tags_json: n.tags ? JSON.stringify(n.tags) : null,
  };
}

export function rowToAsset(r: Rec): GNode {
  const node: GNode = {
    id: String(r["id"] ?? ""),
    kind: String(r["kind"] ?? "AI_AGENT") as NodeKind,
    name: String(r["name"] ?? ""),
    nativeType: (r["native_type"] as string | null) ?? undefined,
    cloudPlatform: (r["cloud"] as string | null) ?? undefined,
    region: (r["region"] as string | null) ?? undefined,
    status: (r["status"] as string | null) ?? undefined,
    firstSeen: (r["first_seen"] as string | null) ?? undefined,
    lastSeen: (r["last_seen"] as string | null) ?? undefined,
    isAccessibleFromInternet: parseTri(r["internet"]),
    hasSensitiveData: parseBool(r["sensitive_data"]),
    hasAccessToSensitiveData: parseBool(r["sensitive_access"]),
    hasHighPrivileges: parseBool(r["high_priv"]),
    hasAdminPrivileges: parseBool(r["admin_priv"]),
    guardrailMissing: parseBool(r["guardrail_missing"]),
    projects: parseJson<string[]>(r["projects_json"], []).map((name) => ({
      id: `proj-${String(name).toLowerCase()}`,
      name: String(name),
    })),
  };
  const account = (r["account_id"] as string | null) ?? null;
  if (account) {
    node.cloudAccount = { id: account, name: String(r["account_name"] ?? account) };
  }
  const severity = (r["severity"] as string | null) ?? null;
  if (severity) node.severity = severity as Severity;
  if (r["aars"] !== null && r["aars"] !== undefined) node.aars = Number(r["aars"]);
  const band = (r["aars_band"] as string | null) ?? null;
  if (band) node.aarsBand = band as GNode["aarsBand"];
  const pillars = parseJson<GNode["aarsPillars"] | null>(r["aars_pillars_json"], null);
  if (pillars) node.aarsPillars = pillars;
  const combos = String(r["combo_groups"] ?? "");
  if (combos) node.comboGroups = combos.split(",").filter(Boolean);
  const tags = parseJson<GNode["tags"] | null>(r["tags_json"], null);
  if (tags) node.tags = tags;
  return node;
}

export function edgeToRow(e: GEdge): Rec {
  return {
    id: e.id,
    src: e.src,
    dst: e.dst,
    type: e.type,
    negated: boolCell(e.negated),
    access_type: e.accessType ?? null,
  };
}

export function rowToEdge(r: Rec): GEdge {
  const e: GEdge = {
    id: String(r["id"] ?? ""),
    src: String(r["src"] ?? ""),
    dst: String(r["dst"] ?? ""),
    type: String(r["type"] ?? "USES") as GEdge["type"],
  };
  if (parseBool(r["negated"])) e.negated = true;
  const access = (r["access_type"] as string | null) ?? null;
  if (access) e.accessType = access as GEdge["accessType"];
  return e;
}

export function issueToRow(i: IssueRow): Rec {
  return {
    id: i.id,
    rule_id: i.ruleId,
    rule_name: i.ruleName,
    combo_group: i.comboGroup,
    native_severity: i.nativeSeverity,
    adjusted_severity: i.adjustedSeverity,
    status: i.status,
    asset_id: i.assetId,
    asset_name: i.assetName,
    region: i.region ?? null,
    account: i.account ?? null,
    projects_json: JSON.stringify(i.projects ?? []),
    frameworks_json: JSON.stringify(i.frameworks ?? {}),
    justification: i.justification ?? null,
    created_at: i.createdAt ?? null,
  };
}

export function rowToIssue(r: Rec): IssueRow {
  return {
    id: String(r["id"] ?? ""),
    ruleId: String(r["rule_id"] ?? ""),
    ruleName: String(r["rule_name"] ?? ""),
    comboGroup: String(r["combo_group"] ?? ""),
    nativeSeverity: String(r["native_severity"] ?? "UNKNOWN") as Severity,
    adjustedSeverity: String(r["adjusted_severity"] ?? "UNKNOWN") as Severity,
    status: String(r["status"] ?? "OPEN"),
    assetId: String(r["asset_id"] ?? ""),
    assetName: String(r["asset_name"] ?? ""),
    region: (r["region"] as string | null) ?? undefined,
    account: (r["account"] as string | null) ?? undefined,
    projects: parseJson<string[]>(r["projects_json"], []),
    frameworks: parseJson<IssueRow["frameworks"]>(r["frameworks_json"], {}),
    justification: (r["justification"] as string | null) ?? undefined,
    createdAt: (r["created_at"] as string | null) ?? undefined,
  };
}

// ----------------------------------------------------------------------- persist

export interface SyncMeta {
  syncId: string;
  mode: "dry-run" | "live";
  startedAt: string;
  apiCalls: number;
}

/**
 * Enrich and commit one sync. Caller holds the script lock. Returns the enriched
 * document (the getGraph read model, ISSUE nodes included).
 */
export function persistSync(
  rawDoc: GraphDoc,
  issues: IssueRow[],
  hints: AarsHints | undefined,
  meta: SyncMeta,
  now?: number,
): GraphDoc {
  const enriched = enrichGraphDoc(rawDoc, issues, hints);

  // Tabs hold the real (non-synthetic) nodes; ISSUE nodes are derivable from ai_issues.
  const assetNodes = enriched.nodes.filter((n) => n.kind !== "ISSUE" && n.kind !== "SUMMARY");
  const assetEdges = enriched.edges.filter((e) => e.type !== "HAS_ISSUE");
  overwrite(TABS.assets, assetNodes.map(assetToRow));
  overwrite(TABS.edges, assetEdges.map(edgeToRow));
  overwrite(TABS.issues, issues.map(issueToRow));

  const snapshotRef = writeGraphSnapshot(enriched);

  // Commit record LAST.
  appendRows(TABS.syncHistory, [{
    sync_id: meta.syncId,
    started_at: meta.startedAt,
    finished_at: nowIso(now),
    status: "SUCCESS",
    mode: meta.mode,
    node_count: enriched.nodes.length,
    edge_count: enriched.edges.length,
    issue_count: issues.length,
    api_calls: meta.apiCalls,
    snapshot_ref: snapshotRef,
    error: null,
  }]);
  bumpDataVersion();
  invalidateReadMemos();
  return enriched;
}

// -------------------------------------------------------------------- read model

// Per-execution memos: one API call can need the same read model several times
// (getGraph resolves seeds from issues AND loads the doc, whose tab-rebuild
// fallback re-reads issues). Module state dies with the GAS execution, so these
// can never serve cross-request data; writers below invalidate them anyway.
let graphDocMemo: GraphDoc | null | undefined;
let assetsMemo: GNode[] | undefined;
let issuesMemo: IssueRow[] | undefined;

function invalidateReadMemos(): void {
  graphDocMemo = undefined;
  assetsMemo = undefined;
  issuesMemo = undefined;
}

/** The enriched graph: Drive snapshot fast path, tab rebuild fallback. */
export function loadGraphDoc(): GraphDoc | null {
  if (graphDocMemo !== undefined) return graphDocMemo;
  graphDocMemo = loadGraphDocUncached();
  return graphDocMemo;
}

function loadGraphDocUncached(): GraphDoc | null {
  // Data-exposure topology (AARS pillar C) is derived on read, not persisted — so it
  // applies to already-synced graphs and never reaches the asset/inventory tables
  // (which read TABS.assets directly, bypassing this doc). See withSensitiveDataNodes.
  const snap = readGraphSnapshot();
  if (snap) return withSensitiveDataNodes(snap);

  const assetRows = readAll(TABS.assets);
  if (!assetRows.length) return null;
  const nodes = assetRows.map(rowToAsset);
  const edges = readAll(TABS.edges).map(rowToEdge);
  const issues = loadIssues().filter((i) => i.status === "OPEN");
  for (const issue of issues) {
    nodes.push({
      id: issue.id,
      kind: "ISSUE",
      name: issue.ruleName,
      severity: issue.adjustedSeverity,
      comboGroups: issue.comboGroup ? [issue.comboGroup] : [],
      status: issue.status,
    });
    edges.push({
      id: edgeId(issue.assetId, "HAS_ISSUE", issue.id),
      src: issue.assetId,
      dst: issue.id,
      type: "HAS_ISSUE",
    });
  }
  const latest = latestSync();
  return withSensitiveDataNodes({
    nodes,
    edges,
    syncedAt: latest ? String(latest["finished_at"] ?? "") : "",
  });
}

export function loadAssets(): GNode[] {
  if (assetsMemo === undefined) assetsMemo = readAll(TABS.assets).map(rowToAsset);
  return assetsMemo;
}

export function loadIssues(): IssueRow[] {
  if (issuesMemo === undefined) issuesMemo = readAll(TABS.issues).map(rowToIssue);
  return issuesMemo;
}

export function syncHistory(): Rec[] {
  return readAll(TABS.syncHistory);
}

/** Most recent committed sync row, or null. */
export function latestSync(): Rec | null {
  const rows = syncHistory();
  return rows.length ? rows[rows.length - 1] : null;
}

/** Wipe all synced data (tabs + snapshot). Caller holds the script lock. */
export function resetData(): void {
  overwrite(TABS.assets, []);
  overwrite(TABS.edges, []);
  overwrite(TABS.issues, []);
  overwrite(TABS.syncHistory, []);
  trashGraphSnapshot();
  bumpDataVersion();
  invalidateReadMemos();
}
