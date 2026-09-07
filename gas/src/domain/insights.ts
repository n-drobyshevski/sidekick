// Insight aggregations for the OS-vulnerabilities view: exploitability summary,
// risk concentration, aging buckets, scan-over-scan movement, top CVEs, and the
// configurable breakdown that replaces the findings table.
//
// GAS-first module (no Python fixture parity — the Streamlit side is discontinued).
// Pure functions over plain arrays: current-scan frame records (dotted keys, `_sev`
// normalized by findings.currentScan) or ledger base rows (durable lifecycle with
// age_days). Each function documents which source it expects and why.

import {
  EPSS_PRIORITY_THRESHOLD, RESOLVED_STATUSES, SEVERITY_ORDER, SLA_TARGETS,
} from "./config";
import type { BaseRow, ScanRow } from "./ledgerCore";
import { type RiskRow, type RiskRule, RISK_TIER_ORDER, riskTier } from "./program";
import { normalizeSeverity } from "./severity";
import { parseTs, type Rec } from "./util";

// Re-exported from config so the many existing `from "./insights"` importers keep resolving;
// see the note beside the definition for why it moved.
export { EPSS_PRIORITY_THRESHOLD };

export const AGE_BUCKET_EDGES = [7, 30, 90] as const;
export const AGE_BUCKET_LABELS = ["0-7d", "8-30d", "31-90d", "90+d"] as const;

const WIDE_KEY = "vulnerableAsset.hasWideInternetExposure";
const LIMITED_KEY = "vulnerableAsset.hasLimitedInternetExposure";

function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

function sev(r: Rec): string {
  const s = r["_sev"];
  return typeof s === "string" && s ? s : normalizeSeverity(r["severity"]);
}


function epssOf(r: Rec): number | null {
  const v = r["epssProbability"];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export interface ExploitSummary {
  open: number;
  kev: number;
  exploit: number;
  highEpss: number;
  internetExposed: number;
  // False when no record in the scan carries the exposure key at all — the slim
  // projection predates the field — as opposed to a genuine zero.
  exposureKnown: boolean;
}

export interface SeverityStat {
  total: number;
  open: number;
  resolved: number;
}

/**
 * Per-severity total / open / resolved over the current-scan frame — the severity
 * breakdown card's data (count with an "N open · N resolved" split). Open vs resolved
 * is the same status test the rest of this module uses; every record lands in exactly
 * one bucket, so open + resolved === total per severity.
 */
export function severityStats(records: Rec[]): Record<string, SeverityStat> {
  const out: Record<string, SeverityStat> = {};
  for (const r of records) {
    const s = sev(r);
    const stat = out[s] ?? (out[s] = { total: 0, open: 0, resolved: 0 });
    stat.total += 1;
    if (isOpen(r["status"])) stat.open += 1;
    else stat.resolved += 1;
  }
  return out;
}

/** Aggregate exploit signals over OPEN current-scan records (only the frame has them). */
export function exploitSummary(records: Rec[]): ExploitSummary {
  const out: ExploitSummary = {
    open: 0, kev: 0, exploit: 0, highEpss: 0, internetExposed: 0,
    exposureKnown: records.some((r) => WIDE_KEY in r && r[WIDE_KEY] !== undefined),
  };
  for (const r of records) {
    if (!isOpen(r["status"])) continue;
    out.open += 1;
    if (r["hasCisaKevExploit"] === true) out.kev += 1;
    if (r["hasExploit"] === true) out.exploit += 1;
    const epss = epssOf(r);
    if (epss !== null && epss >= EPSS_PRIORITY_THRESHOLD) out.highEpss += 1;
    if (r[WIDE_KEY] === true || r[LIMITED_KEY] === true) out.internetExposed += 1;
  }
  return out;
}

export interface AgeBuckets {
  perSev: Record<string, [number, number, number, number]>;
  totalOpen: number;
}

/**
 * Age distribution of still-open findings, bucketed 0-7 / 8-30 / 31-90 / 90+ days.
 * Input is ledger base rows because age_days derives from the durable first_seen
 * (survives re-detection); rows without an age (resolved, or missing first_seen)
 * are skipped.
 */
export function ageBuckets(rows: Pick<BaseRow, "severity" | "status" | "age_days">[]): AgeBuckets {
  const { perKey, totalOpen } = ageBucketsBy(rows, (r) => normalizeSeverity(r.severity));
  return { perSev: perKey, totalOpen };
}

/** The same four buckets over an arbitrary key, so the histogram can stack by risk tier
 *  instead of by severity — which is the whole point on a register that scans one severity.
 *  `ageBuckets` is this function with the key fixed to severity; both skip rows with no
 *  finite age, so `totalOpen` here can be lower than the open count shown elsewhere. */
export function ageBucketsBy<T extends { status: string; age_days: number | null }>(
  rows: T[],
  keyOf: (row: T) => string,
): { perKey: Record<string, [number, number, number, number]>; totalOpen: number } {
  const perKey: Record<string, [number, number, number, number]> = {};
  let totalOpen = 0;
  for (const row of rows) {
    if (!isOpen(row.status)) continue;
    const age = row.age_days;
    if (typeof age !== "number" || !Number.isFinite(age)) continue;
    const bucket = age <= AGE_BUCKET_EDGES[0] ? 0 : age <= AGE_BUCKET_EDGES[1] ? 1 : age <= AGE_BUCKET_EDGES[2] ? 2 : 3;
    const k = keyOf(row);
    if (!perKey[k]) perKey[k] = [0, 0, 0, 0];
    perKey[k][bucket] += 1;
    totalOpen += 1;
  }
  return { perKey, totalOpen };
}

// Open findings older than this many days are the "aged" backlog the grouped
// oldest-views rank by — the 90+ tail of the age buckets above.
export const AGED_OPEN_EDGE = AGE_BUCKET_EDGES[2];

export interface OldestFinding {
  cve: string | null;
  asset: string | null;
  subscription: string | null;
  severity: string; // normalized
  ageDays: number;
}

export interface OldestGroup {
  key: string; // the group value ("(none)" for blank/missing)
  agedCount: number; // open findings older than AGED_OPEN_EDGE days
  openCount: number; // all open findings in the group
  oldestDays: number; // age of the group's single oldest open finding
  // Representative attribution captured for the asset view only (see rankGroups meta).
  subscription?: string;
  domain?: string;
}

export interface OldestOpen {
  findings: OldestFinding[];
  byAsset: OldestGroup[];
  bySupportGroup: OldestGroup[];
  byDomain: OldestGroup[];
}

type OldestRow = Pick<
  BaseRow,
  "cve" | "severity" | "status" | "asset_name" | "subscription_name" | "age_days"
> & {
  _domain?: unknown;
  _supportGroup?: unknown;
};

/** Finite age of an open row, or null when resolved / missing (skipped by callers). */
function openAge(row: OldestRow): number | null {
  if (!isOpen(row.status)) return null;
  const age = row.age_days;
  return typeof age === "number" && Number.isFinite(age) ? age : null;
}

/**
 * Rank the busiest-aging groups: bucket open rows (with a finite age) by keyFn,
 * count the 90+ tail and the total open, track the single oldest, then order by
 * aged tail desc, oldest age desc, key asc. Empty groups never form (only open
 * rows are added); the result is capped to topN. `meta` (asset view only) records
 * representative attribution once, from the first row that creates each group — all
 * findings on an asset share a subscription and (asset-level rules) a domain.
 */
function rankGroups(
  rows: OldestRow[],
  keyFn: (r: OldestRow) => string,
  topN: number,
  meta?: (r: OldestRow) => Partial<Pick<OldestGroup, "subscription" | "domain">>,
): OldestGroup[] {
  const groups = new Map<string, OldestGroup>();
  for (const row of rows) {
    const age = openAge(row);
    if (age === null) continue;
    const raw = keyFn(row);
    const key = raw && raw.trim() !== "" ? raw : "(none)";
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, agedCount: 0, openCount: 0, oldestDays: 0, ...(meta ? meta(row) : {}) }));
    g.openCount += 1;
    if (age > AGED_OPEN_EDGE) g.agedCount += 1;
    if (age > g.oldestDays) g.oldestDays = age;
  }
  return [...groups.values()]
    .sort((a, b) => b.agedCount - a.agedCount || b.oldestDays - a.oldestDays || a.key.localeCompare(b.key))
    .slice(0, topN);
}

/**
 * The oldest open findings for the aging panel's four toggle views. `findings` is the
 * top-N individual open findings by age; `byAsset` / `bySupportGroup` / `byDomain` rank
 * those entities by their 90+ day open backlog (see rankGroups). Consumes ledger base
 * rows (age_days is durable); grouped views expect _domain / _supportGroup pre-attached
 * by the server (asset_name is native to the row).
 */
export function oldestOpen(rows: OldestRow[], topN = 7): OldestOpen {
  const findings: OldestFinding[] = rows
    .map((r) => ({ r, age: openAge(r) }))
    .filter((x): x is { r: OldestRow; age: number } => x.age !== null)
    .sort((a, b) => b.age - a.age)
    .slice(0, topN)
    .map(({ r, age }) => ({
      cve: r.cve,
      asset: r.asset_name,
      subscription: r.subscription_name,
      severity: normalizeSeverity(r.severity),
      ageDays: age,
    }));
  return {
    findings,
    byAsset: rankGroups(rows, (r) => String(r.asset_name ?? ""), topN, (r) => ({
      subscription: String(r.subscription_name ?? ""),
      domain: String(r._domain ?? ""),
    })),
    bySupportGroup: rankGroups(rows, (r) => String(r._supportGroup ?? ""), topN),
    byDomain: rankGroups(rows, (r) => String(r._domain ?? ""), topN),
  };
}

export interface Movement {
  newCount: number;
  resolvedCount: number;
  reopenedCount: number;
  persisting: number;
  hasPrevious: boolean;
}

/**
 * Scan-over-scan movement. New/resolved/reopened pass through from the latest flat
 * scan's ScanRow (reconcile computed them exactly; never re-derive); persisting =
 * open ledger rows seen in the latest scan that predate it.
 */
export function movement(
  baseRows: Pick<BaseRow, "status" | "first_scan_id" | "last_scan_id">[],
  latestFlatScan: Pick<ScanRow, "scan_id" | "new_count" | "resolved_count" | "reopened_count"> | null,
  scanCount: number,
): Movement {
  if (!latestFlatScan) {
    return { newCount: 0, resolvedCount: 0, reopenedCount: 0, persisting: 0, hasPrevious: scanCount > 1 };
  }
  let persisting = 0;
  for (const row of baseRows) {
    if (!isOpen(row.status)) continue;
    if (row.last_scan_id === latestFlatScan.scan_id && row.first_scan_id !== latestFlatScan.scan_id) {
      persisting += 1;
    }
  }
  // Persisting is derived from `baseRows`, so when the caller passes a no-fix-filtered
  // population (the show-no-fix toggle off) it filters with them. New/Resolved/Reopened come
  // from the scan-wide reconcile deltas below and can't be re-split without re-reconciling the
  // raw archives, so they stay scan-wide — the client's "scan-wide" caveat covers them.
  return {
    newCount: latestFlatScan.new_count,
    resolvedCount: latestFlatScan.resolved_count,
    reopenedCount: latestFlatScan.reopened_count,
    persisting,
    hasPrevious: scanCount > 1,
  };
}

// ============================================ open-backlog movement, scan over scan
//
// WHY THIS EXISTS BESIDE `movement`, WHICH ALREADY SAYS "MOVEMENT". `movement` above reports
// the LATEST scan's reconcile deltas: what arrived, what closed, what came back, between the
// last two scans. On a register scanned daily that is one day of news, and a day of news is
// noise — a leader asking "is the backlog going up or down" gets an answer that swings on
// whichever scan ran this morning. This asks the different question: how many findings were
// open a WEEK ago, and how many are open now.
//
// THE TWO ENDPOINTS ARE SCANS, NOT DATES ON A CALENDAR. A register only learns anything when
// it looks, so comparing "now" against "seven days ago" would credit the register with
// changes on days nobody scanned. `until` is the newest flat scan; `since` is the most recent
// flat scan at least `minGapDays` older than it. Under that gap the comparison is REFUSED and
// the actual span is published, so a reader learns "this register has only looked twice in
// three days" rather than "no comparison available".
//
// GROUPED SCANS ARE NOT ENDPOINTS. A grouped scan reconciles nothing (`persistGroupedScan`
// writes zero deltas by construction), so it moved no finding into or out of the backlog and
// cannot be one side of a difference. `program.movementWindowScans` filters the same way for
// the same reason.
//
// `open` IS THE LIVE COUNT AND `prevOpen` IS A REPLAY, and the two are on one clock: a finding
// is only ever dated closed at the scan that stopped seeing it, so replaying `openAsOf` at
// `until` reproduces the live count exactly. `test/movement.test.ts` holds that equality
// rather than assuming it. Using the live count for `open` is what stops this block and the
// severity tiles beside it printing two different open totals.

/** A comparison this register will publish needs at least this much daylight between the two
 *  observations. Under it, two scans describe the same week and their difference is noise. */
export const MOVEMENT_MIN_GAP_DAYS = 7;

const MOVEMENT_DAY_MS = 86_400_000;

/** Days, to one decimal — a span of 13.5 d is not "14" and not "13". */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Open as of instant `d`: born by then, and not dated closed before it. */
function openAsOf(row: Pick<BaseRow, "first_seen" | "resolved_at">, d: number): boolean {
  const first = parseTs(row.first_seen);
  if (first === null || first > d) return false;
  const resolved = parseTs(row.resolved_at);
  return resolved === null || resolved > d;
}

export interface OpenMovementRow {
  severity: string;
  open: number;
  prevOpen: number;
  delta: number;
}

export interface OpenMovement {
  comparable: boolean;
  /** Why not, when not. Null exactly when `comparable` is true. */
  reason: "noScan" | "oneScan" | "tooClose" | null;
  since: string | null;
  until: string | null;
  /** The span the comparison covers — and on `tooClose`, the REAL span the log can offer,
   *  which is the most a reader can be told about how long this register has been watching. */
  gapDays: number | null;
  rows: OpenMovementRow[];
  total: { open: number; prevOpen: number; delta: number };
}

type MovementScan = { ts?: unknown; shape?: unknown };
type MovementRow = Pick<BaseRow, "severity" | "status" | "first_seen" | "resolved_at">;

const NO_TOTAL = { open: 0, prevOpen: 0, delta: 0 };

/**
 * Week-over-week movement in the OPEN BACKLOG, per severity — and the honest reason when
 * there is none.
 *
 * `severities` is the DISPLAY gate in force. When it names severities, those are the rows
 * published, in `SEVERITY_ORDER`; a severity in the gate holding no findings is a genuine
 * zero and is drawn. When it is null (no gate — every severity selected), the rows are the
 * severities actually PRESENT in the population, again in `SEVERITY_ORDER`. What never
 * happens either way is a `0` row for a severity the gate excluded: that zero would be a
 * measurement, and the gate is a refusal to measure (CLAUDE.md, "The Outside").
 */
export function openMovement(
  rows: MovementRow[],
  scans: MovementScan[],
  opts: { minGapDays?: number; now?: number; severities?: string[] | null } = {},
): OpenMovement {
  const minGapDays = opts.minGapDays === undefined ? MOVEMENT_MIN_GAP_DAYS : opts.minGapDays;
  const gate = opts.severities ?? null;

  const instants = scans
    .filter((s) => s["shape"] !== "grouped")
    .map((s) => parseTs(s["ts"]))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

  if (!instants.length) {
    return {
      comparable: false, reason: "noScan", since: null, until: null, gapDays: null,
      rows: [], total: { ...NO_TOTAL },
    };
  }
  const until = instants[instants.length - 1] as number;
  if (instants.length === 1) {
    return {
      comparable: false, reason: "oneScan", since: null, until: iso(until), gapDays: null,
      rows: [], total: { ...NO_TOTAL },
    };
  }

  // Newest-first, so `since` is the NEWEST scan that still clears the minimum — the most
  // recent seven days of scanning, not the whole ledger. Taking the oldest instead would
  // answer a question about the register's whole life and call it a week.
  let since: number | null = null;
  for (let i = instants.length - 2; i >= 0; i -= 1) {
    if ((until - (instants[i] as number)) / MOVEMENT_DAY_MS >= minGapDays) {
      since = instants[i] as number;
      break;
    }
  }
  if (since === null) {
    return {
      comparable: false,
      reason: "tooClose",
      since: null,
      until: iso(until),
      // The WIDEST span the log can offer, not the nearest gap: "the saved scans span 3 days"
      // is the fact a reader needs, and it is what makes "run again next week" the obvious
      // next move rather than a mystery.
      gapDays: round1((until - (instants[0] as number)) / MOVEMENT_DAY_MS),
      rows: [],
      total: { ...NO_TOTAL },
    };
  }

  const nowBySev = new Map<string, number>();
  const thenBySev = new Map<string, number>();
  const present = new Set<string>();
  let open = 0;
  let prevOpen = 0;
  for (const row of rows) {
    const s = normalizeSeverity(row.severity);
    if (isOpen(row.status)) {
      nowBySev.set(s, (nowBySev.get(s) ?? 0) + 1);
      present.add(s);
      open += 1;
    }
    if (openAsOf(row, since)) {
      thenBySev.set(s, (thenBySev.get(s) ?? 0) + 1);
      // Present at EITHER endpoint, not merely in the ledger. A severity whose every finding
      // closed before `since` has nothing to say about this week; one that closed DURING it
      // reads {open: 0, prevOpen: 5, delta: -5}, which is the best news the block can carry.
      present.add(s);
      prevOpen += 1;
    }
  }

  // The union of "the gate asked for it" and "the population has it", and both halves earn
  // their place. A gated severity with no findings is a genuine ZERO — somebody selected it
  // and the answer is none — so it is drawn. A severity that is present but outside the gate
  // (UNKNOWN rides along with every gate, exactly as `filterSeverities` keeps it) is a real
  // count and is drawn too, which is also what makes the rows sum to `total`. What never
  // appears is a `0` for a severity the gate excluded AND the register does not hold: that
  // zero would be a measurement, and the gate is a refusal to measure.
  const wanted = new Set(present);
  if (gate !== null) for (const s of gate) wanted.add(normalizeSeverity(s));

  const out: OpenMovementRow[] = [];
  for (const s of SEVERITY_ORDER) {
    if (!wanted.has(s)) continue;
    const n = nowBySev.get(s) ?? 0;
    const p = thenBySev.get(s) ?? 0;
    out.push({ severity: s, open: n, prevOpen: p, delta: n - p });
  }

  return {
    comparable: true,
    reason: null,
    since: iso(since),
    until: iso(until),
    gapDays: round1((until - since) / MOVEMENT_DAY_MS),
    rows: out,
    total: { open, prevOpen, delta: open - prevOpen },
  };
}

// Groupable dimensions for the multi-level breakdown — the dotted frame-record columns
// each dimension maps to (the old group-by vocabulary, plus CVE = the finding name).
export const GROUP_COLUMNS: Record<string, string> = {
  domain: "_domain",
  supportGroup: "_supportGroup",
  asset: "vulnerableAsset.name",
  atype: "vulnerableAsset.type",
  cloud: "vulnerableAsset.cloudPlatform",
  os: "vulnerableAsset.operatingSystem",
  subscription: "vulnerableAsset.subscriptionName",
  cve: "name",
};

// Ledger analogue of GROUP_COLUMNS for the historical group trend: each breakdown
// dimension maps to the base-row (LedgerRow) column carrying its value. _domain and
// _supportGroup are server-attached before the trend runs; the rest are native columns.
//
// `os` is intentionally absent: LedgerRow has no operating-system column (reconcile.ts),
// so a historical OS trend is impossible without a ledger schema change. The UI degrades
// to an honest empty state when the top-level dimension is `os`.
export const GROUP_BASE_FIELDS: Record<string, string> = {
  domain: "_domain",
  supportGroup: "_supportGroup",
  asset: "asset_name",
  atype: "asset_type",
  cloud: "cloud",
  subscription: "subscription_name",
  cve: "cve",
};

export interface GroupNode {
  key: string; // the group value ("(none)" for blank/missing)
  dim: string; // the dimension this level groups by
  total: number;
  open: number;
  assets: number; // distinct affected assets in the group
  sevCounts: Record<string, number>;
  kev: boolean; // any finding in the group is a CISA KEV
  exploit: boolean; // any finding in the group has a public exploit
  children: GroupNode[]; // next level; [] at the deepest level
}

/**
 * Multi-level breakdown: group frame records by an ordered list of dimensions into a
 * nested tree (e.g. ["domain","asset"] → domains, each with its assets). Each level is
 * ranked busiest-first and capped; children are computed only for the kept nodes so the
 * tree stays bounded. Aggregates cover all records (open + resolved) like the old flat
 * breakdown; kev/exploit flag whether any finding in the group carries them.
 */
export function groupTree(records: Rec[], keys: string[], perLevelCap = 20): GroupNode[] {
  if (!keys.length || !records.length) return [];
  const [key, ...rest] = keys;
  const column = GROUP_COLUMNS[key];
  if (!column) return [];
  const buckets = new Map<string, Rec[]>();
  for (const r of records) {
    const raw = r[column];
    const k = raw === null || raw === undefined || String(raw).trim() === "" ? "(none)" : String(raw);
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, (arr = []));
    arr.push(r);
  }
  const rows = [...buckets.entries()].map(([k, recs]) => {
    const assets = new Set<string>();
    const sevCounts: Record<string, number> = {};
    let open = 0;
    let kev = false;
    let exploit = false;
    for (const r of recs) {
      if (isOpen(r["status"])) open += 1;
      const s = sev(r);
      sevCounts[s] = (sevCounts[s] ?? 0) + 1;
      const a = String(r["vulnerableAsset.name"] ?? "");
      if (a) assets.add(a);
      if (r["hasCisaKevExploit"] === true) kev = true;
      if (r["hasExploit"] === true) exploit = true;
    }
    const node: GroupNode = {
      key: k, dim: key, total: recs.length, open, assets: assets.size,
      sevCounts, kev, exploit, children: [],
    };
    return { recs, node };
  });
  rows.sort((a, b) => b.node.total - a.node.total || a.node.key.localeCompare(b.node.key));
  const kept = rows.slice(0, perLevelCap);
  if (rest.length) {
    for (const row of kept) row.node.children = groupTree(row.recs, rest, perLevelCap);
  }
  return kept.map((row) => row.node);
}

// =========================================================== risk-ladder aggregations
// The OS-vulnerabilities page's spine. Everything below reads the DURABLE ledger rows
// (has_kev / has_exploit / epss are LedgerRow columns, so tiers survive compaction and can
// be replayed across scan history) except where a function documents a frame join — internet
// exposure lives only on the current-scan frame and cannot trend.

/** Open findings per tier, plus the honesty number that has to travel with them. */
export interface RiskTierStats {
  perTier: Record<string, number>;
  open: number;
  /** Open rows whose tier is `unknown`. Published beside every tier figure: a null on
   *  has_kev / has_exploit / epss means NOT CAPTURED, and rendering that as a clean zero is
   *  the exact mistake `program.classifyRisk`'s three-valued verdict exists to prevent. */
  unclassified: number;
}

type TierRow = RiskRow & { status: string };

/** Open-only tier counts over ledger base rows. Resolved rows are excluded because the page
 *  ranks what is still outstanding; `movement` covers what closed. */
export function riskTierStats(rows: TierRow[], rule: RiskRule): RiskTierStats {
  const perTier: Record<string, number> = {};
  for (const t of RISK_TIER_ORDER) perTier[t] = 0;
  let open = 0;
  for (const row of rows) {
    if (!isOpen(row.status)) continue;
    open += 1;
    perTier[riskTier(row, rule)] += 1;
  }
  return { perTier, open, unclassified: perTier["unknown"] ?? 0 };
}

/**
 * The triage funnel: five nested populations, each a strict subset of the one above it.
 *
 *   open        -> every open finding in scope
 *   intel       -> ...whose exploit signals were actually captured (tier !== unknown)
 *   exploitable -> ...on the KEV catalog or with a public exploit
 *   exposed     -> ...on a host reachable from outside
 *   overdue     -> ...and already past its severity SLA
 *
 * Nesting is what makes the shape readable when the counts span orders of magnitude: each
 * step states its share of the step above, so a tier holding fourteen rows out of twelve
 * hundred is legible rather than invisible.
 *
 * Two joins worth naming. Exposure is a frame property (`vulnerableAsset.has*InternetExposure`
 * is not a ledger column), so callers pass the set of exposed `vuln_key`s from the current
 * scan; when the frame predates those keys, `exposureKnown` is false and the last two steps
 * are NOT rendered as zero — absent is not none. And "overdue" runs on the ACTIONABLE clock
 * (`actionable_age_days`), the same clock the MTTR page's headline uses, so a finding still
 * awaiting a vendor fix is never counted as a breach nobody could have prevented.
 */
export interface TriageFunnel {
  open: number;
  intel: number;
  exploitable: number;
  exposed: number;
  overdue: number;
  unclassified: number;
  exposureKnown: boolean;
}

type FunnelRow = RiskRow & {
  status: string;
  vuln_key: string;
  actionable_age_days: number | null;
};

export function triageFunnel(
  rows: FunnelRow[],
  rule: RiskRule,
  exposedKeys: Set<string>,
  exposureKnown: boolean,
): TriageFunnel {
  const out: TriageFunnel = {
    open: 0, intel: 0, exploitable: 0, exposed: 0, overdue: 0,
    unclassified: 0, exposureKnown,
  };
  for (const row of rows) {
    if (!isOpen(row.status)) continue;
    out.open += 1;
    const tier = riskTier(row, rule);
    if (tier === "unknown") {
      out.unclassified += 1;
      continue;
    }
    out.intel += 1;
    if (tier !== "kev" && tier !== "exploit") continue;
    out.exploitable += 1;
    if (!exposureKnown || !exposedKeys.has(row.vuln_key)) continue;
    out.exposed += 1;
    const target = SLA_TARGETS[normalizeSeverity(row.severity)];
    const age = row.actionable_age_days;
    // Strict `>`, matching remediation.openPastSla — a finding on its due date is in SLA.
    if (typeof target === "number" && typeof age === "number" && Number.isFinite(age) && age > target) {
      out.overdue += 1;
    }
  }
  return out;
}

/** One row of a concentration list: a group value and the open findings sitting under it. */
export interface ConcentrationRow {
  key: string;
  open: number;
  assets: number; // distinct assets carrying those open findings
  kev: number; // how many of them are on the KEV catalog
}

export interface Concentration {
  /** dimension -> top rows, ranked by OPEN findings. */
  perDim: Record<string, ConcentrationRow[]>;
  /** dimension -> groups that exist but did not make the cut. Rendered as "N more", because
   *  a truncated list that says nothing reads as a complete one. */
  moreDim: Record<string, number>;
}

/**
 * Top-N groups per dimension, over current-scan frame records.
 *
 * Deliberately NOT `groupTree`: that ranks by `total` (open + resolved) because the breakdown
 * tree reports on the whole scan, and reusing its ordering for a list captioned "by open
 * findings" would put a group that closed everything above one that closed nothing. This
 * counts and ranks open rows only.
 */
export function concentration(records: Rec[], dims: string[], topN = 5): Concentration {
  const perDim: Record<string, ConcentrationRow[]> = {};
  const moreDim: Record<string, number> = {};
  for (const dim of dims) {
    const column = GROUP_COLUMNS[dim];
    if (!column) continue;
    const buckets = new Map<string, { open: number; assets: Set<string>; kev: number }>();
    for (const r of records) {
      if (!isOpen(r["status"])) continue;
      const raw = r[column];
      const k = raw === null || raw === undefined || String(raw).trim() === ""
        ? "(none)" : String(raw);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { open: 0, assets: new Set(), kev: 0 }));
      b.open += 1;
      const a = String(r["vulnerableAsset.name"] ?? "");
      if (a) b.assets.add(a);
      if (r["hasCisaKevExploit"] === true) b.kev += 1;
    }
    const rows = [...buckets.entries()]
      .map(([key, b]) => ({ key, open: b.open, assets: b.assets.size, kev: b.kev }))
      .sort((a, b) => b.open - a.open || a.key.localeCompare(b.key));
    perDim[dim] = rows.slice(0, topN);
    moreDim[dim] = Math.max(0, rows.length - topN);
  }
  return { perDim, moreDim };
}

/**
 * Median age of the open backlog, in days — the hero's "how stale is this pile" mini-stat.
 *
 * Median rather than mean because remediation ages are heavily right-skewed: a handful of
 * year-old stragglers drag a mean somewhere no actual finding sits. Interpolates the midpoint
 * on an even count, matching the percentile convention the MTTR page already uses. Rows with
 * no finite age are skipped, so this reports on the rows it could actually measure.
 */
export function openAgeMedian(rows: Pick<BaseRow, "status" | "age_days">[]): number | null {
  const ages: number[] = [];
  for (const row of rows) {
    if (!isOpen(row.status)) continue;
    const age = row.age_days;
    if (typeof age === "number" && Number.isFinite(age)) ages.push(age);
  }
  if (!ages.length) return null;
  ages.sort((a, b) => a - b);
  const mid = (ages.length - 1) / 2;
  const lo = Math.floor(mid);
  const hi = Math.ceil(mid);
  return lo === hi ? ages[lo] : (ages[lo] + ages[hi]) / 2;
}

// ==================================================== SLA window consumed, in tenths
//
// THE AGE BUCKETS ANSWER "HOW OLD"; THIS ANSWERS "HOW LATE", and on a mixed-severity
// register those are different questions. A 20-day CRITICAL and a 20-day LOW sit in the same
// 8-30d bar while one is nearly three windows past its deadline and the other has used less
// than a quarter of its own. Dividing the age by the row's OWN target puts every severity on
// one axis: bucket k is the k-th tenth of the window that has been used, and 9-k is what is
// left.
//
// THREE POPULATIONS LEAVE THE BARS, and each leaves for a different reason, so each is
// counted separately rather than folded into one "other":
//
//   - `pastWindow` — age >= the target. Measured, and deliberately NOT drawn: a tenth is a
//     fraction of a window, and a finding past its window has no tenth left to plot. Drawing
//     it in bucket 9 would make the last bar mean two things at once ("in its final tenth"
//     and "past the deadline by any amount"), which is exactly the reading the chart exists
//     to separate. It is per severity because the breaches are not evenly spread across them.
//   - `noWindow` — no finite age, or no finite positive target for the row's severity.
//     UNKNOWN has no entry in SLA_TARGETS, so a row whose severity never normalized has no
//     deadline to be measured against; neither has a row with no `age_days`. Both are
//     unmeasured, and an unmeasured row is never a zeroth tenth (CLAUDE.md, "The Outside").
//   - resolved rows, which are not open findings at all.
//
// `Number(null)` is 0 AND FINITE, so both the age and the target are refused BEFORE any cast:
// a `Number(row.age_days)` first would read null, "", [] and false as a brand-new finding in
// bucket 0 — the most reassuring bucket on the chart — and a `Number(targets[sev])` first
// would read a missing target as 0 and then divide by it.
//
// `slaTargets` is a PARAMETER rather than a read of config's SLA_TARGETS, so the function
// stays pure over its arguments and a test can state the window it means. The call site
// (api.ts) imports the constant.

export const SLA_DECILE_LABELS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export interface SlaConsumed {
  /** Tenth-of-window labels, "0".."9" — bucket k is time used, 9-k is time left. */
  labels: string[];
  /** severity -> ten counts, one per tenth. Only severities with a drawn row appear. */
  perSev: Record<string, number[]>;
  /** severity -> open findings at or past their window. Counted, never drawn. */
  pastWindow: Record<string, number>;
  /** Open findings with no finite age, or no finite positive target. Not a zero. */
  noWindow: number;
  /** Rows actually drawn — the sum of every `perSev` array. */
  totalOpen: number;
}

export function slaConsumedDeciles(
  rows: Pick<BaseRow, "severity" | "status" | "age_days">[],
  slaTargets: Record<string, number>,
): SlaConsumed {
  const out: SlaConsumed = {
    labels: [...SLA_DECILE_LABELS],
    perSev: {},
    pastWindow: {},
    noWindow: 0,
    totalOpen: 0,
  };
  for (const row of rows) {
    if (!isOpen(row.status)) continue;
    const age = row.age_days;
    // Refused before any cast: Number(null) is 0 and finite, and bucket 0 is a claim.
    if (typeof age !== "number" || !Number.isFinite(age)) {
      out.noWindow += 1;
      continue;
    }
    const s = normalizeSeverity(row.severity);
    const w = slaTargets[s];
    // Same refusal for the denominator, plus `w <= 0`: a zero window is not a deadline
    // everything has missed, it is an absent one, and dividing by it yields Infinity.
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) {
      out.noWindow += 1;
      continue;
    }
    if (age >= w) {
      out.pastWindow[s] = (out.pastWindow[s] ?? 0) + 1;
      continue;
    }
    // age < w and w > 0, so the quotient is in [0, 1) and the floor is in 0..9 already; the
    // clamp holds against a float landing one ULP high at the top of the range.
    const k = Math.min(9, Math.max(0, Math.floor((10 * age) / w)));
    const arr = out.perSev[s] ?? (out.perSev[s] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    arr[k] += 1;
    out.totalOpen += 1;
  }
  return out;
}
