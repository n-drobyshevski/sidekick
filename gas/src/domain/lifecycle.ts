// Cross-scan vulnerability identity and ledger-sourced MTTR — the port of
// wiz_dashboard/domain/lifecycle.py.

import { sha1Hex } from "./sha1";
import { normalizeSeverity } from "./severity";
import { summarize, type MttrSummary, type SummaryRow } from "./metrics";
import { present, parseTs, pyStr, type Rec } from "./util";

/**
 * First present value among dotted keys, tolerating nested vulnerableAsset dicts.
 * Accepts both flattened "vulnerableAsset.name" keys and the raw nested node shape.
 * Returns "" when nothing matches.
 */
export function field(record: Rec, ...keys: string[]): string {
  for (const k of keys) {
    const v = record[k];
    if (present(v)) return pyStr(v);
  }
  const va = record["vulnerableAsset"];
  if (va && typeof va === "object" && !Array.isArray(va)) {
    for (const k of keys) {
      const leaf = k.split(".").pop()!;
      const v = (va as Rec)[leaf];
      if (present(v)) return pyStr(v);
    }
  }
  return "";
}

/**
 * Stable cross-scan identity for a finding: "id:<wiz finding id>" when present, else
 * "h:" + sha1(CVE|asset|type|cloud|component)[:16].
 */
export function vulnKey(record: Rec): string {
  const fid = record["id"];
  if (typeof fid === "string" && fid.trim()) return `id:${fid.trim()}`;

  const cve = field(record, "name");
  const asset =
    field(record, "vulnerableAsset.id", "assetId") || field(record, "vulnerableAsset.name");
  const atype = field(record, "vulnerableAsset.type", "type");
  const cloud = field(record, "vulnerableAsset.cloudPlatform", "cloudPlatform");
  const component = field(record, "detailedName", "detailedNameV2");
  const basis = [cve, asset, atype, cloud, component].join("|");
  return "h:" + sha1Hex(basis).slice(0, 16);
}

/**
 * (perSev, overall) MTTR summary from durable ledger lifecycle rows — the exact
 * contract of metrics.calculateMttr, but computed from first_seen/resolved_at.
 */
export function mttrFromLedger(
  ledgerRows: Iterable<Rec>,
  opts: { now?: number } = {},
): MttrSummary {
  const rows = [...ledgerRows];
  if (!rows.length) return { perSev: {}, overall: {} };
  const work: SummaryRow[] = rows.map((r) => ({
    sev: "severity" in r ? normalizeSeverity(r["severity"]) : "UNKNOWN",
    firstSeen: parseTs(r["first_seen"]),
    resolved: parseTs(r["resolved_at"]),
  }));
  return summarize(work, opts.now);
}
