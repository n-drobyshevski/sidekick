// Current-scan findings access + filtering for the web API. The "current frame" is
// the latest flat scan's slim records (Drive), flattened to dotted keys — the same
// shape the Streamlit pages filtered. Memoized per execution.

import { assignDomain, compileDomains, UNASSIGNED } from "../domain/domainRules";
import { vulnKey } from "../domain/lifecycle";
import { normalizeSeverity } from "../domain/severity";
import { extractNodes, flattenNode } from "../domain/transform";
import { present, type Rec } from "../domain/util";
import * as archive from "./archiveStore";
import * as ledgerStore from "./ledgerStore";
import * as settingsStore from "./settingsStore";
import { attachSupportGroups } from "./supportGroups";

export interface CurrentScan {
  scanId: string;
  ts: string;
  mode: string;
  shape: "flat" | "grouped";
  total: number;
  severities: string | null;
  records: Rec[]; // flattened, with _vuln_key and _domain attached
}

let memo: CurrentScan | null | undefined;

// Settings writes that change how _domain/_supportGroup get attached (domain rules,
// the support-group map) must stale this memo — free in real GAS, where module state
// dies with the execution, but load-bearing for same-execution reads-after-write
// (mutation endpoints) and the long-lived dev harness. Mirrors ledgerStore's
// invalidateLedgerMemos() convention.
export function invalidateFrameMemo(): void {
  memo = undefined;
}

export function currentScan(): CurrentScan | null {
  if (memo !== undefined) return memo;
  const row = ledgerStore.latestFlatScanRow();
  if (!row) {
    memo = null;
    return memo;
  }
  const domains = settingsStore.getDomains();
  const compiled = compileDomains(domains.items);

  // Fast path: the scan job precomputed the flattened + sha1-keyed frame. Only the
  // cheap request-dependent fields are attached here — _sev, _supportGroup, and
  // _domain, none baked into the frame so domain-settings/support-group edits never
  // stale it. Support group is attached BEFORE domain assignment so a support_group
  // domain condition can see it.
  const frame = archive.readFrame(row.scan_id) as Rec[] | null;
  let records: Rec[];
  if (frame) {
    records = frame.map((flat) => {
      flat["_sev"] = normalizeSeverity(flat["severity"]);
      return flat;
    });
  } else {
    // Scans persisted before the frame existed: flatten + hash from slim as before.
    let slim = archive.readSlimRecords(row.scan_id) as Rec[] | null;
    if (!slim) {
      const payload = archive.readScanPayload(row.raw_ref);
      slim = payload ? extractNodes(payload) : [];
    }
    records = (slim ?? []).map((n) => {
      const flat = flattenNode(n);
      flat["_vuln_key"] = vulnKey(n);
      flat["_sev"] = normalizeSeverity(flat["severity"]);
      return flat;
    });
  }
  attachSupportGroups(records);
  if (compiled.length) {
    for (const flat of records) flat["_domain"] = assignDomain(flat, compiled);
  } else {
    for (const flat of records) flat["_domain"] = UNASSIGNED;
  }
  memo = {
    scanId: row.scan_id,
    ts: row.ts,
    mode: row.mode,
    shape: row.shape,
    total: row.total,
    severities: row.severities,
    records,
  };
  return memo;
}

export interface FindingsFilters {
  severities?: string[]; // display filter (already ⊆ fetch scope)
  statuses?: string[];
  assetTypes?: string[];
  clouds?: string[];
  domains?: string[];
  supportGroups?: string[];
  q?: string;
}

export function applyFilters(records: Rec[], f: FindingsFilters): Rec[] {
  let out = records;
  if (f.severities?.length) {
    const keep = new Set(f.severities.map(normalizeSeverity));
    out = out.filter((r) => keep.has(String(r["_sev"])));
  }
  if (f.statuses?.length) {
    const keep = new Set(f.statuses.map((s) => s.toUpperCase()));
    out = out.filter((r) => keep.has(String(r["status"] ?? "").toUpperCase()));
  }
  if (f.assetTypes?.length) {
    const keep = new Set(f.assetTypes);
    out = out.filter((r) => keep.has(String(r["vulnerableAsset.type"] ?? "")));
  }
  if (f.clouds?.length) {
    const keep = new Set(f.clouds);
    out = out.filter((r) => keep.has(String(r["vulnerableAsset.cloudPlatform"] ?? "")));
  }
  if (f.domains?.length) {
    const keep = new Set(f.domains);
    out = out.filter((r) => keep.has(String(r["_domain"] ?? UNASSIGNED)));
  }
  if (f.supportGroups?.length) {
    const keep = new Set(f.supportGroups);
    out = out.filter((r) => keep.has(String(r["_supportGroup"] ?? "")));
  }
  if (f.q && f.q.trim()) {
    const q = f.q.trim().toLowerCase();
    out = out.filter(
      (r) =>
        String(r["name"] ?? "").toLowerCase().includes(q) ||
        String(r["vulnerableAsset.name"] ?? "").toLowerCase().includes(q),
    );
  }
  return out;
}

/** Distinct present values of a column, sorted (filter options). */
export function distinct(records: Rec[], column: string): string[] {
  const seen = new Set<string>();
  for (const r of records) {
    const v = r[column];
    if (present(v)) seen.add(String(v));
  }
  return [...seen].sort();
}

// The columns the findings table ships to the client (order = display order).
export const TABLE_COLUMNS = [
  "_vuln_key", "_sev", "_domain", "_supportGroup", "name", "severity", "status",
  "detailedName", "fixedVersion", "firstDetectedAt", "resolvedAt", "lastDetectedAt",
  "score", "epssSeverity", "hasExploit", "hasCisaKevExploit",
  "vulnerableAsset.name", "vulnerableAsset.type", "vulnerableAsset.cloudPlatform",
  "vulnerableAsset.subscriptionName", "vulnerableAsset.operatingSystem",
] as const;

export function tableRow(r: Rec): Rec {
  const out: Rec = {};
  for (const c of TABLE_COLUMNS) out[c] = r[c] ?? null;
  return out;
}
