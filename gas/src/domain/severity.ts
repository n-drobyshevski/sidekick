// Severity normalization and counting — the port of wiz_dashboard/domain/severity.py.

import { SEVERITY_ORDER } from "./config";
import type { Rec } from "./util";

export function normalizeSeverity(sev: unknown): string {
  if (typeof sev !== "string") return "UNKNOWN";
  const s = sev.toUpperCase().trim();
  if (s === "INFORMATIONAL" || s === "INFO") return "INFO";
  return (SEVERITY_ORDER as readonly string[]).includes(s) ? s : "UNKNOWN";
}

// Severity fallback with provenance. A finding may carry a blank/unrecognized top-level
// `severity` yet still have a usable `vendorSeverity` or `nvdSeverity` — probe them in
// that order and return the first that normalizes to something other than UNKNOWN, along
// with which field it came from (`source` is null only when every candidate is UNKNOWN).
// Byte-identical to normalizeSeverity(severity) on records lacking vendor/nvd fields, so
// baking it upstream in slimRecord leaves the fixture-locked reconcile/metrics path at zero
// diff. INFORMATIONAL→INFO flows through every candidate (each goes through normalizeSeverity).
export function effectiveSeverity(rec: Rec): {
  severity: string;
  source: "severity" | "vendorSeverity" | "nvdSeverity" | null;
} {
  const candidates = ["severity", "vendorSeverity", "nvdSeverity"] as const;
  for (const source of candidates) {
    const sev = normalizeSeverity(rec[source]);
    if (sev !== "UNKNOWN") return { severity: sev, source };
  }
  return { severity: "UNKNOWN", source: null };
}

export function countBySeverity(records: Rec[]): Record<string, number> {
  // Column-level gate, like the pandas version: no severity column at all → {}.
  if (!records.length || !records.some((r) => "severity" in r)) return {};
  const counts: Record<string, number> = {};
  for (const rec of records) {
    const sev = normalizeSeverity(rec["severity"]);
    counts[sev] = (counts[sev] ?? 0) + 1;
  }
  return counts;
}
