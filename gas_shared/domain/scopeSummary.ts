// The scoped viewer's one page, projected from the read-models every other page already builds.
//
// NOTHING HERE IS A NEW MEASUREMENT. A scoped viewer's MTTR is `mttrData` over their rows and
// their trend is `mttrTrendData` over the same rows — the SAME estimators the MTTR page runs,
// just over a narrower population — so a full user who picks the same domain in the header and
// a scoped viewer holding it read one number, not two that happen to agree today. This module
// only chooses which of those figures travel, and keeps the payload small enough that the page
// opens from one cache read.
//
// SHARED BY BOTH REGISTERS. gas feeds it `mttrData` / `mttrTrendData`; gas_devsecops feeds it
// `mttrModel` / `historyModel` — the same field names (`perSev`, `overall`, `slaPct`,
// `remediation.km`, `remediation.openPastSla`, `trend[]`) because the two MTTR pages were built
// from one design. A field one of them does not publish reads as absent, never as zero.
//
// Pure: both apps' tests pin the projection without a GAS global.

type Rec = Record<string, unknown>;

const DEFAULT_SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

export interface ScopeSummarySev {
  sev: string;
  open: number;
  resolved: number;
  /** Kaplan-Meier median days (still-open findings censored). */
  kmMedian: number | null;
  kmP90: number | null;
  /** Share of resolved findings closed inside their SLA target, 0-100. */
  slaPct: number | null;
  /** Open findings older than their SLA target. */
  pastSla: number;
  slaTarget: number | null;
  awaiting: number;
}

export interface ScopeSummaryPoint {
  date: string;
  open: number | null;
  medianDays: number | null;
}

export interface ScopeSummary {
  asOf: string;
  scan: { ts: string | null; total: number | null } | null;
  open: number;
  resolved: number;
  mttr: {
    median: number | null;
    medianLowerBound: number | null;
    p90: number | null;
    naiveMedian: number | null;
  };
  sla: {
    /** Resolved inside target, 0-100. */
    attainmentPct: number | null;
    /** Open past target / open with a knowable SLA status. */
    pastSla: number;
    pastSlaPct: number | null;
    unknown: number;
  };
  awaiting: { count: number; pctOfOpen: number | null };
  backlog: { observed: number; unobserved: number } | null;
  perSev: ScopeSummarySev[];
  trend: ScopeSummaryPoint[];
}

/** How many trend points travel. The page draws a sparkline, not the MTTR page's chart. */
export const SUMMARY_TREND_POINTS = 60;

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function numOr0(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function obj(v: unknown): Rec {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

/** Evenly thinned, endpoints kept — the newest point is the one the tiles above it describe. */
export function thinPoints<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) return points.slice(-Math.max(max, 1));
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]!);
  return out;
}

/**
 * `mttr` is `mttrData`'s payload and `trend` is `mttrTrendData`'s, both over the viewer's rows.
 * Severities appear in `SEVERITY_ORDER`, and only those with something in them.
 */
export function scopeSummaryOf(
  mttr: Rec,
  trend: Rec,
  meta: { asOf: string; scan: { ts: string | null; total: number | null } | null },
  severityOrder: readonly string[] = DEFAULT_SEVERITY_ORDER,
): ScopeSummary {
  const perSev = obj(mttr["perSev"]);
  const overall = obj(mttr["overall"]);
  const rem = obj(mttr["remediation"]);
  const km = obj(rem["km"]);
  const kmMedianPerSev = obj(rem["kmMedianPerSev"]);
  const kmP90PerSev = obj(rem["kmP90PerSev"]);
  const past = obj(rem["openPastSla"]);
  const pastPerSev = obj(past["perSev"]);
  const pastOverall = obj(past["overall"]);
  const awaiting = obj(rem["awaiting"]);
  const awaitingPerSev = obj(awaiting["perSev"]);
  const backlog = obj(mttr["backlog"]);

  const seen = Object.keys(perSev);
  const ordered = severityOrder
    .filter((s) => seen.indexOf(s) >= 0)
    .concat(seen.filter((s) => severityOrder.indexOf(s) < 0));
  const sevRows: ScopeSummarySev[] = [];
  for (const sev of ordered) {
    const st = obj(perSev[sev]);
    const open = numOr0(st["open"]);
    const resolved = numOr0(st["resolved"]);
    if (!open && !resolved) continue;
    sevRows.push({
      sev,
      open,
      resolved,
      kmMedian: numOrNull(kmMedianPerSev[sev]),
      kmP90: numOrNull(kmP90PerSev[sev]),
      slaPct: numOrNull(st["sla_pct"]),
      pastSla: numOr0(obj(pastPerSev[sev])["breached"]),
      slaTarget: numOrNull(st["sla_target"]),
      awaiting: numOr0(awaitingPerSev[sev]),
    });
  }

  const points = Array.isArray(trend["trend"]) ? (trend["trend"] as Rec[]) : [];
  const trendOut = thinPoints(points, SUMMARY_TREND_POINTS).map((p) => ({
    date: String(p["date"] ?? ""),
    open: numOrNull(p["open"]),
    // The KM median where the trend carries one, the naive median otherwise — the same
    // preference the MTTR page's headline line makes.
    medianDays: numOrNull(p["km_median_days"]) ?? numOrNull(p["median_days"]),
  }));

  return {
    asOf: meta.asOf,
    scan: meta.scan,
    open: numOr0(overall["open"]),
    resolved: numOr0(overall["resolved"]),
    mttr: {
      median: numOrNull(km["median"]),
      medianLowerBound: numOrNull(km["medianLowerBound"]),
      // gas publishes the overall p90 beside the curve; gas_devsecops inside it.
      p90: numOrNull(rem["kmP90"]) ?? numOrNull(km["p90"]),
      naiveMedian: numOrNull(km["naiveMedian"]),
    },
    sla: {
      attainmentPct: numOrNull(mttr["slaPct"]),
      pastSla: numOr0(pastOverall["breached"]),
      pastSlaPct: numOrNull(pastOverall["pct"]),
      unknown: numOr0(pastOverall["unknown"]),
    },
    awaiting: {
      count: numOr0(awaiting["overall"]),
      pctOfOpen: numOrNull(awaiting["pctOfOpen"]),
    },
    backlog: Object.keys(backlog).length
      ? { observed: numOr0(backlog["observed"]), unobserved: numOr0(backlog["unobserved"]) }
      : null,
    perSev: sevRows,
    trend: trendOut,
  };
}
