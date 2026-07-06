// Severity normalization and counting — the port of wiz_dashboard/domain/severity.py.

import { SEVERITY_ORDER } from "./config";
import type { Rec } from "./util";

export function normalizeSeverity(sev: unknown): string {
  if (typeof sev !== "string") return "UNKNOWN";
  const s = sev.toUpperCase().trim();
  if (s === "INFORMATIONAL" || s === "INFO") return "INFO";
  return (SEVERITY_ORDER as readonly string[]).includes(s) ? s : "UNKNOWN";
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
