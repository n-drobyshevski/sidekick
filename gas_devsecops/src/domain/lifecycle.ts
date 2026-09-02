// Cross-scan finding identity and ledger-sourced MTTR — the port of
// gas/src/domain/lifecycle.ts, renamed and reshaped for the three-scope register.
//
// RULE 1 (the D1 brief): scope is part of the key.
//   finding_key = "<scope>:" + identity
//   identity    = "id:" + node.id                                            for sca / sast
//               = "h:" + sha1Hex(secretDataId + "|" + path + "|" + lineNumber)
//                     .slice(0, 16)                                          for secrets
//
// gas/'s vulnKey prefers node.id and falls back to a hash of (cve|asset|type|cloud|component)
// only when no id is present — a fallback this register does not need: sca and sast nodes
// always carry a Wiz-assigned `id` (Q_SCA / Q_SAST both select it), so findingKey does not
// port that fallback branch.
//
// Secrets NEVER key on node.id or externalId. Both differ between the REPOSITORY and
// REPOSITORY_BRANCH twins Wiz emits for the same credential — PROBE_FINDINGS.md §10.6/§10.7
// measured 187 such twin keys, with externalId differing on every one of them (Wiz builds it
// from the resource, and the branch form inserts a branch segment) and the two twins'
// firstSeenAt disagreeing by a median of 19.9 days. Keying on secretDataId+path+lineNumber
// instead collapses the twins into one row; sheetsDb.ts's TAB_HEADERS[TABS.ledger] comment is
// the full argument and the ledger population this hash is read back against.

import { sha1Hex } from "./sha1";
import type { Scope } from "./config";
import { SEVERITY_ORDER, SLA_TARGETS } from "./config";
import { normalizeSeverity } from "./severity";
import { clean, mean, median, parseTs, pyStr, quantile, type Rec } from "./util";

/**
 * Stable cross-scan identity for a finding, scoped: "<scope>:id:<wiz node id>" for sca/sast,
 * "<scope>:h:<16-hex>" for secrets. See the module header for why secrets hashes
 * (secretDataId, path, lineNumber) rather than trusting node.id/externalId, and why sca/sast
 * have no hash fallback the way gas/'s vulnKey does.
 */
export function findingKey(scope: Scope, node: Rec): string {
  if (scope === "secrets") {
    const secretDataId = pyStr(clean(node["secretDataId"]) ?? "");
    const path = pyStr(clean(node["path"]) ?? "");
    const lineNumber = pyStr(clean(node["lineNumber"]) ?? "");
    const basis = `${secretDataId}|${path}|${lineNumber}`;
    return `${scope}:h:${sha1Hex(basis).slice(0, 16)}`;
  }
  const rawId = node["id"];
  const id = typeof rawId === "string" ? rawId.trim() : pyStr(clean(rawId) ?? "");
  return `${scope}:id:${id}`;
}

// --------------------------------------------------------------------------- #
//  mttrFromLedger — the ledger-sourced (perSev, overall) MTTR summary
// --------------------------------------------------------------------------- #
//
// gas/'s mttrFromLedger delegates to metrics.ts's summarize(), which has not been ported to
// gas_devsecops yet (out of scope for D1 — this package is types/primitives/config only, and
// metrics.ts is not among D1's listed files). The reduction is inlined below rather than left
// unported, because mttr_from_ledger.json fixture parity is part of D1's own test list. THIS
// IS A DELIBERATE DUPLICATE of gas/src/domain/metrics.ts's summarize(): when metrics.ts is
// ported to this package, replace the block below with an import and delete the local copy —
// do not let both live on independently.

export interface SevStats {
  mttr_mean: number | null;
  mttr_median: number | null;
  resolved: number;
  open: number;
  open_age_p50: number | null;
  open_age_p90: number | null;
  sla_target: number | null;
  sla_compliant: number;
  sla_pct: number | null;
}

export interface OverallStats {
  mttr_mean?: number | null;
  mttr_median?: number | null;
  resolved?: number;
  open?: number;
}

export interface MttrSummary {
  perSev: Record<string, SevStats>;
  overall: OverallStats;
}

interface SummaryRow {
  sev: string;
  firstSeen: number | null; // epoch ms
  resolved: number | null; // epoch ms
}

const DAY_MS = 86_400_000;

/** Reduce normalized rows to (perSev, overall) — inlined port of metrics._summarize; see above. */
function summarize(work: SummaryRow[], now?: number): MttrSummary {
  if (!work.length) return { perSev: {}, overall: {} };
  const nowMs = now ?? Date.now();

  const mttrDays = (r: SummaryRow): number | null =>
    r.resolved !== null && r.firstSeen !== null ? (r.resolved - r.firstSeen) / DAY_MS : null;
  const ageDays = (r: SummaryRow): number | null =>
    r.firstSeen !== null ? (nowMs - r.firstSeen) / DAY_MS : null;

  const perSev: Record<string, SevStats> = {};
  for (const sev of SEVERITY_ORDER) {
    const sub = work.filter((r) => r.sev === sev);
    if (!sub.length) continue;
    const resolvedDays = sub.map(mttrDays).filter((d): d is number => d !== null);
    const openAges = sub
      .filter((r) => r.resolved === null && r.firstSeen !== null)
      .map(ageDays)
      .filter((d): d is number => d !== null);
    const target = SLA_TARGETS[sev] ?? null;
    const withinSla =
      target !== null && resolvedDays.length
        ? resolvedDays.filter((d) => d <= target).length
        : 0;
    perSev[sev] = {
      mttr_mean: resolvedDays.length ? mean(resolvedDays) : null,
      mttr_median: resolvedDays.length ? median(resolvedDays) : null,
      resolved: resolvedDays.length,
      open: openAges.length,
      open_age_p50: openAges.length ? median(openAges) : null,
      open_age_p90: openAges.length ? quantile(openAges, 0.9) : null,
      sla_target: target,
      sla_compliant: withinSla,
      sla_pct: resolvedDays.length && target !== null ? (withinSla / resolvedDays.length) * 100 : null,
    };
  }

  const allMttr = work.map(mttrDays).filter((d): d is number => d !== null);
  const overall: OverallStats = {
    mttr_mean: allMttr.length ? mean(allMttr) : null,
    mttr_median: allMttr.length ? median(allMttr) : null,
    resolved: work.filter((r) => r.resolved !== null).length,
    open: work.filter((r) => r.resolved === null).length,
  };
  return { perSev, overall };
}

/**
 * (perSev, overall) MTTR summary from durable ledger lifecycle rows — the exact contract of
 * gas/'s mttrFromLedger, computed from first_seen/resolved_at/severity. Column names are
 * unchanged from gas/ (severity, first_seen, resolved_at all survive the sheetsDb.ts rename
 * unchanged — only asset_id/asset_name/cve moved), so no per-field rename was needed here.
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
