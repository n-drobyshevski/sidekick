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
  // cheap request-dependent fields are attached here — _sev, and _domain, which is
  // deliberately not baked into the frame so domain-settings edits never stale it.
  const frame = archive.readFrame(row.scan_id) as Rec[] | null;
  let records: Rec[];
  if (frame) {
    records = frame.map((flat) => {
      flat["_sev"] = normalizeSeverity(flat["severity"]);
      flat["_domain"] = compiled.length ? assignDomain(flat, compiled) : UNASSIGNED;
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
      flat["_domain"] = compiled.length ? assignDomain(flat, compiled) : UNASSIGNED;
      return flat;
    });
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
  "_vuln_key", "_sev", "_domain", "name", "severity", "status", "detailedName",
  "fixedVersion", "firstDetectedAt", "resolvedAt", "lastDetectedAt", "score",
  "epssSeverity", "hasExploit", "hasCisaKevExploit",
  "vulnerableAsset.name", "vulnerableAsset.type", "vulnerableAsset.cloudPlatform",
  "vulnerableAsset.subscriptionName", "vulnerableAsset.operatingSystem",
] as const;

export function tableRow(r: Rec): Rec {
  const out: Rec = {};
  for (const c of TABLE_COLUMNS) out[c] = r[c] ?? null;
  return out;
}
