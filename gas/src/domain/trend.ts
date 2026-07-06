// Cumulative open/resolved/MTTR/SLA trend — the port of ledger._trend_from_frames.
//
// For each saved flat scan timestamp: vulns open vs resolved as of that instant, the
// median MTTR of everything resolved by then, the In-SLA share, and the oldest-open
// age (max over severities of the p90 open age) — matching the headline KPIs.

import { SEVERITY_ORDER, SLA_TARGETS } from "./config";
import { normalizeSeverity } from "./severity";
import { median, parseTs, quantile, type Rec } from "./util";

export interface TrendPoint {
  date: string; // the scan ts (ISO)
  open: number;
  resolved: number;
  median_days: number | null;
  sla_pct: number | null;
  oldest_open_days: number | null;
}

const DAY_MS = 86_400_000;

/**
 * scans: rows with {ts, shape}; base: ledger+episode rows with {severity, first_seen,
 * resolved_at, mttr_days}. severities (optional) restricts to those + UNKNOWN.
 */
export function trendFromFrames(
  scans: Rec[],
  base: Rec[],
  severities: string[] | null = null,
): TrendPoint[] {
  let rows = base;
  if (severities !== null && base.length) {
    const keep = new Set([...severities, "UNKNOWN"]);
    rows = base.filter((r) => keep.has(normalizeSeverity(r["severity"])));
  }
  if (!scans.length || !rows.length) return [];

  const flatTs = scans
    .filter((s) => s["shape"] === "flat")
    .map((s) => ({ iso: String(s["ts"]), ms: parseTs(s["ts"]) }))
    .filter((t): t is { iso: string; ms: number } => t.ms !== null)
    .sort((a, b) => a.ms - b.ms);
  if (!flatTs.length) return [];

  const parsed = rows.map((r) => ({
    first: parseTs(r["first_seen"]),
    resolvedAt: parseTs(r["resolved_at"]),
    mttr: typeof r["mttr_days"] === "number" && !Number.isNaN(r["mttr_days"])
      ? (r["mttr_days"] as number)
      : null,
    sev: normalizeSeverity(r["severity"]),
  }));

  const out: TrendPoint[] = [];
  for (const ts of flatTs) {
    const resolvedMask = parsed.map((r) => r.resolvedAt !== null && r.resolvedAt <= ts.ms);
    const openMask = parsed.map(
      (r) =>
        r.first !== null &&
        r.first <= ts.ms &&
        (r.resolvedAt === null || r.resolvedAt > ts.ms),
    );

    const resolvedMttr = parsed
      .filter((_, i) => resolvedMask[i])
      .map((r) => r.mttr)
      .filter((m): m is number => m !== null);
    const med = median(resolvedMttr);

    // In-SLA %: of everything resolved-by-ts with an MTTR sample, the share whose MTTR
    // met its severity target (no-target severities count against).
    const denom = resolvedMttr.length;
    const within = parsed.filter(
      (r, i) =>
        resolvedMask[i] &&
        r.mttr !== null &&
        SLA_TARGETS[r.sev] !== undefined &&
        r.mttr <= SLA_TARGETS[r.sev],
    ).length;
    const slaPct = denom ? (within / denom) * 100 : null;

    // Oldest open: max over severities of the p90 open age as of ts.
    const p90s: number[] = [];
    for (const sev of SEVERITY_ORDER) {
      const ages = parsed
        .filter((r, i) => openMask[i] && r.sev === sev)
        .map((r) => (ts.ms - r.first!) / DAY_MS);
      if (ages.length) {
        const p = quantile(ages, 0.9);
        if (p !== null) p90s.push(p);
      }
    }
    const oldest = p90s.length ? Math.max(...p90s) : null;

    out.push({
      date: ts.iso,
      open: openMask.filter(Boolean).length,
      resolved: resolvedMask.filter(Boolean).length,
      median_days: med !== null ? Math.round(med * 1000) / 1000 : null,
      sla_pct: slaPct !== null ? Math.round(slaPct * 10) / 10 : null,
      oldest_open_days: oldest !== null ? Math.round(oldest * 1000) / 1000 : null,
    });
  }
  return out;
}
