// Insight aggregations for the code register: exploitability/risk-ladder summaries, aging
// buckets, scan-over-scan movement, the oldest-open panel, and the configurable breakdown
// that replaces a findings table. Port of gas/src/domain/insights.ts, reshaped for the
// three-scope (sca/sast/secrets) register — see ledgerTypes.ts's header for the column
// renames this file inherits (vuln_key -> finding_key, cve -> identifier, asset_* -> repo_*).
//
// GAS-first module (no Python fixture parity — the Streamlit side is discontinued). Pure
// functions over ledger BaseRow-shaped records (Rec, flat columns).
//
// WHAT WAS DROPPED FROM gas/'s VERSION, AND WHY (the D9 brief's instruction: one line each):
//
//   exploitSummary                 host-only + superseded. `internetExposed` reads
//                                   vulnerableAsset.has{Wide,Limited}InternetExposure, a VM/host
//                                   attribute with no analog on any LedgerRow column — a git
//                                   repository has no "internet exposure". Its kev/exploit/
//                                   highEpss counts (which double-count a row across all three
//                                   buckets by design) are superseded here by riskTierStats,
//                                   whose RISK_TIER_ORDER partitions the same population into
//                                   one tier each AND is unknown-aware, which exploitSummary
//                                   never was.
//   `_sev` frame shortcut          no analog. gas/'s sev() preferred a precomputed `_sev` field
//                                   attached by the current-scan frame builder (findings.ts,
//                                   currentScan). This register has no such frame abstraction
//                                   yet (reconcile.ts, ported separately) — every function here
//                                   already reads a row's own `severity` column directly.
//   domain / supportGroup          host-only. `_domain` / `_supportGroup` are server-attached
//   (GROUP_COLUMNS dims, and        from Wiz/Domain-style tags on a VM/host asset; a source
//   oldestOpen's bySupportGroup /   repository carries no such taxonomy. The repo's ownership
//   byDomain views)                axis here is `owner_project` (from projects[], every scope).
//   atype / cloud / os /           host-only. Asset type, cloud platform, operating system and
//   subscription (GROUP_COLUMNS    cloud subscription are VM/host attributes with no repository
//   dims)                          analog; `owner_project` already carries subscription's
//                                   ownership-attribution role (see oldestOpen below).
//   cve (GROUP_COLUMNS dim)        out of the D9 brief's exact set. The brief names GROUP_COLUMNS
//                                   as exactly {repo, language, owner_project, secret_kind, cwe};
//                                   grouping by one specific identifier is better served by
//                                   search/filter than by a ranked breakdown tree.
//   GROUP_BASE_FIELDS (separate     merged away. gas/'s split existed because current-scan frame
//   dotted-key mapping for the      records use dotted keys ("vulnerableAsset.name") while ledger
//   historical trend)               rows use flat columns ("asset_name"). This register has no
//                                   such frame yet (see `_sev` above), so every function already
//                                   reads the ledger's own flat columns and one GROUP_COLUMNS
//                                   mapping serves both current and historical grouping.
//
// SCOPE FILTER: every function below takes an optional trailing `scope?: Scope` (gas/'s single-
// register version took none) — this ledger's rows share one table across sca/sast/secrets
// (config.ts's `scope` is part of every row's identity), so a page scoped to one register has
// to be able to ask for just its rows. Defaults to all rows, matching gas/'s original behaviour
// exactly when the argument is omitted.

import { EPSS_PRIORITY_THRESHOLD, RESOLVED_STATUSES, SLA_TARGETS, type RiskRule, type Scope } from "./config";
import type { BaseRow, ScanRow } from "./ledgerTypes";
import { normalizeSeverity } from "./severity";
import type { Rec } from "./util";

function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

function sev(r: Rec): string {
  return normalizeSeverity(r["severity"]);
}

/** Drop rows whose `scope` does not match, when a scope filter was requested. No-op otherwise. */
function byScope<T extends { scope: Scope }>(rows: T[], scope?: Scope): T[] {
  return scope ? rows.filter((r) => r.scope === scope) : rows;
}

// =========================================================== risk-tier classification (local)
//
// DELIBERATE DUPLICATE of gas/src/domain/program.ts's risk-tier classification (RiskRow,
// RiskTier, RISK_TIER_ORDER, ruleIsEmpty, firedSignals, classifyRisk, riskTier) — program.ts
// has not been ported to gas_devsecops yet (a concurrent D9-sibling package another agent owns;
// out of bounds for this package per its brief). riskTierStats and triageFunnel below ARE in
// D9's explicit scope, and both need this classification, so it is copied here rather than left
// unported. It reuses config.ts's `RiskRule` (already present there, byte-identical shape to
// gas/program.ts's), so only the tier logic itself is duplicated, not the rule type.
//
// WHEN program.ts IS PORTED TO THIS PACKAGE, replace this block with an import and delete the
// local copy — do not let both live on independently. (Same pattern D1's lifecycle.ts used for
// metrics.summarize(), and the same instruction: this is the D9 package's own reported finding.)
//
// Classification is unchanged from gas/: it reads has_kev / has_exploit / epss, which
// ledgerTypes.ts marks SCA ONLY. A sast/secrets row structurally carries all three as null, so
// it is never misclassified "low" here — every enabled signal on it reads unseen, and
// classifyRisk's step 2 puts it in `unknown` rather than manufacturing a negative from missing
// data. That is the correct answer today (no sast/secrets risk rule exists yet to say
// otherwise), not a gap this file introduces.

export type RiskRow = Pick<BaseRow, "severity" | "status" | "has_kev" | "has_exploit" | "epss">;

export type RiskTier = "kev" | "exploit" | "epss" | "none" | "unknown";

/** Worst evidence first; `unknown` last because it is a measurement gap, not a low score. */
export const RISK_TIER_ORDER: RiskTier[] = ["kev", "exploit", "epss", "none", "unknown"];

/** True when the rule enables no signal at all — nothing is decidable, so everything is unknown. */
function ruleIsEmpty(rule: RiskRule): boolean {
  return !rule.kev && !rule.exploit && !rule.epss;
}

/** Whether an enabled signal was actually observed on this row (null = never captured). */
function seen(row: RiskRow, rule: RiskRule): { kev: boolean; exploit: boolean; epss: boolean } {
  return {
    kev: !rule.kev || row.has_kev != null,
    exploit: !rule.exploit || row.has_exploit != null,
    epss: !rule.epss || (typeof row.epss === "number" && Number.isFinite(row.epss)),
  };
}

/** Which enabled clauses fired. Empty for `low` and `unknown` rows. */
function firedSignals(row: RiskRow, rule: RiskRule): ("kev" | "exploit" | "epss")[] {
  const out: ("kev" | "exploit" | "epss")[] = [];
  if (rule.kev && row.has_kev === true) out.push("kev");
  if (rule.exploit && row.has_exploit === true) out.push("exploit");
  if (
    rule.epss &&
    typeof row.epss === "number" &&
    Number.isFinite(row.epss) &&
    row.epss >= rule.epssThreshold
  ) {
    out.push("epss");
  }
  return out;
}

type RiskClass = "high" | "low" | "unknown";

/** Three-valued classification — see gas/program.ts's classifyRisk for the full reasoning. */
function classifyRisk(row: RiskRow, rule: RiskRule): RiskClass {
  if (ruleIsEmpty(rule)) return "unknown";
  if (firedSignals(row, rule).length) return "high";
  const s = seen(row, rule);
  if (!s.kev || !s.exploit || !s.epss) return "unknown";
  return "low";
}

/** Which tier a row lands in — a REFINEMENT of classifyRisk, never a second opinion. */
export function riskTier(row: RiskRow, rule: RiskRule): RiskTier {
  const cls = classifyRisk(row, rule);
  if (cls !== "high") return cls === "low" ? "none" : "unknown";
  const fired = firedSignals(row, rule);
  if (fired.includes("kev")) return "kev";
  if (fired.includes("exploit")) return "exploit";
  return "epss";
}

// ============================================================================ severity stats

export interface SeverityStat {
  total: number;
  open: number;
  resolved: number;
}

/**
 * Per-severity total / open / resolved. Open vs resolved is the same status test the rest of
 * this module uses; every record lands in exactly one bucket, so open + resolved === total.
 */
export function severityStats(records: Rec[], scope?: Scope): Record<string, SeverityStat> {
  const rows = scope ? records.filter((r) => r["scope"] === scope) : records;
  const out: Record<string, SeverityStat> = {};
  for (const r of rows) {
    const s = sev(r);
    const stat = out[s] ?? (out[s] = { total: 0, open: 0, resolved: 0 });
    stat.total += 1;
    if (isOpen(r["status"])) stat.open += 1;
    else stat.resolved += 1;
  }
  return out;
}

// ================================================================================ age buckets

export const AGE_BUCKET_EDGES = [7, 30, 90] as const;
export const AGE_BUCKET_LABELS = ["0-7d", "8-30d", "31-90d", "90+d"] as const;

export interface AgeBuckets {
  perSev: Record<string, [number, number, number, number]>;
  totalOpen: number;
}

/**
 * Age distribution of still-open findings, bucketed 0-7 / 8-30 / 31-90 / 90+ days. `age_days`
 * derives from the durable `first_seen` (survives re-detection); rows without an age (resolved,
 * or missing first_seen) are skipped.
 */
export function ageBuckets(
  rows: Pick<BaseRow, "severity" | "status" | "age_days" | "scope">[],
  scope?: Scope,
): AgeBuckets {
  const { perKey, totalOpen } = ageBucketsBy(rows, (r) => normalizeSeverity(r.severity), scope);
  return { perSev: perKey, totalOpen };
}

/** The same four buckets over an arbitrary key, so the histogram can stack by risk tier
 *  instead of by severity — which is the whole point on a register that scans one severity.
 *  `ageBuckets` is this function with the key fixed to severity; both skip rows with no
 *  finite age, so `totalOpen` here can be lower than the open count shown elsewhere. */
export function ageBucketsBy<T extends { status: string; age_days: number | null; scope: Scope }>(
  rowsIn: T[],
  keyOf: (row: T) => string,
  scope?: Scope,
): { perKey: Record<string, [number, number, number, number]>; totalOpen: number } {
  const rows = byScope(rowsIn, scope);
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

// Open findings older than this many days are the "aged" backlog the oldest-open view ranks
// by — the 90+ tail of the age buckets above.
export const AGED_OPEN_EDGE = AGE_BUCKET_EDGES[2];

// ============================================================================== oldest open

export interface OldestFinding {
  identifier: string | null; // gas/'s `cve` — renamed per ledgerTypes.ts's cve -> identifier
  repo: string | null; // gas/'s `asset` — renamed per ledgerTypes.ts's asset_name -> repo_name
  ownerProject: string | null; // gas/'s `subscription` — the ownership analog here (see header)
  severity: string; // normalized
  ageDays: number;
}

export interface OldestGroup {
  key: string; // the group value ("(none)" for blank/missing)
  agedCount: number; // open findings older than AGED_OPEN_EDGE days
  openCount: number; // all open findings in the group
  oldestDays: number; // age of the group's single oldest open finding
  ownerProject?: string; // representative attribution — byRepo only
}

export interface OldestOpen {
  findings: OldestFinding[];
  byRepo: OldestGroup[]; // gas/'s byAsset — the "asset" here is a repository
}

type OldestRow = Pick<
  BaseRow,
  "identifier" | "severity" | "status" | "repo_name" | "owner_project" | "age_days" | "scope"
>;

/** Finite age of an open row, or null when resolved / missing (skipped by callers). */
function openAge(row: OldestRow): number | null {
  if (!isOpen(row.status)) return null;
  const age = row.age_days;
  return typeof age === "number" && Number.isFinite(age) ? age : null;
}

/**
 * Rank the busiest-aging groups: bucket open rows (with a finite age) by keyFn, count the 90+
 * tail and the total open, track the single oldest, then order by aged tail desc, oldest age
 * desc, key asc. Empty groups never form; the result is capped to topN. `meta` records
 * representative attribution once, from the first row that creates each group.
 */
function rankGroups(
  rows: OldestRow[],
  keyFn: (r: OldestRow) => string,
  topN: number,
  meta?: (r: OldestRow) => Partial<Pick<OldestGroup, "ownerProject">>,
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
 * The oldest open findings for the aging panel. `findings` is the top-N individual open
 * findings by age; `byRepo` ranks repositories by their 90+ day open backlog (see rankGroups).
 * Consumes ledger base rows (age_days is durable).
 */
export function oldestOpen(rows: OldestRow[], topN = 7, scope?: Scope): OldestOpen {
  const scoped = byScope(rows, scope);
  const findings: OldestFinding[] = scoped
    .map((r) => ({ r, age: openAge(r) }))
    .filter((x): x is { r: OldestRow; age: number } => x.age !== null)
    .sort((a, b) => b.age - a.age)
    .slice(0, topN)
    .map(({ r, age }) => ({
      identifier: r.identifier,
      repo: r.repo_name,
      ownerProject: r.owner_project,
      severity: normalizeSeverity(r.severity),
      ageDays: age,
    }));
  return {
    findings,
    byRepo: rankGroups(scoped, (r) => String(r.repo_name ?? ""), topN, (r) => ({
      ownerProject: String(r.owner_project ?? ""),
    })),
  };
}

// ================================================================================== movement

export interface Movement {
  newCount: number;
  resolvedCount: number;
  reopenedCount: number;
  persisting: number;
  hasPrevious: boolean;
}

/**
 * Scan-over-scan movement. New/resolved/reopened pass through from the latest flat scan's
 * ScanRow (reconcile computed them exactly; never re-derive); persisting = open ledger rows
 * seen in the latest scan that predate it.
 */
export function movement(
  baseRowsIn: Pick<BaseRow, "status" | "first_scan_id" | "last_scan_id" | "scope">[],
  latestFlatScan: Pick<ScanRow, "scan_id" | "new_count" | "resolved_count" | "reopened_count"> | null,
  scanCount: number,
  scope?: Scope,
): Movement {
  if (!latestFlatScan) {
    return { newCount: 0, resolvedCount: 0, reopenedCount: 0, persisting: 0, hasPrevious: scanCount > 1 };
  }
  const baseRows = byScope(baseRowsIn, scope);
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

// =========================================================================== group breakdown

// Groupable dimensions for the multi-level breakdown, mapped directly to their LedgerRow/
// BaseRow flat column — see the module header for what gas/'s GROUP_COLUMNS dropped and why.
// Exactly the D9 brief's set: repo, language, owner_project, secret_kind, cwe.
export const GROUP_COLUMNS: Record<string, string> = {
  repo: "repo_name",
  language: "language",
  owner_project: "owner_project",
  secret_kind: "secret_kind",
  cwe: "cwe",
};

export interface GroupNode {
  key: string; // the group value ("(none)" for blank/missing)
  dim: string; // the dimension this level groups by
  total: number;
  open: number;
  repos: number; // distinct repositories affected (gas/'s `assets` — the asset here is a repo)
  sevCounts: Record<string, number>;
  kev: boolean; // any finding in the group is a CISA KEV (SCA only; always false off-scope)
  exploit: boolean; // any finding in the group has a public exploit (SCA only)
  children: GroupNode[]; // next level; [] at the deepest level
}

/**
 * Multi-level breakdown: group rows by an ordered list of dimensions into a nested tree. Each
 * level is ranked busiest-first and capped; children are computed only for the kept nodes.
 * Aggregates cover all rows (open + resolved); kev/exploit flag whether any finding in the
 * group carries them (never manufactured from a null — see the risk-tier section above).
 */
export function groupTree(records: Rec[], keys: string[], perLevelCap = 20, scope?: Scope): GroupNode[] {
  const rows = scope ? records.filter((r) => r["scope"] === scope) : records;
  if (!keys.length || !rows.length) return [];
  const [key, ...rest] = keys;
  const column = GROUP_COLUMNS[key];
  if (!column) return [];
  const buckets = new Map<string, Rec[]>();
  for (const r of rows) {
    const raw = r[column];
    const k = raw === null || raw === undefined || String(raw).trim() === "" ? "(none)" : String(raw);
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, (arr = []));
    arr.push(r);
  }
  const rowsOut = [...buckets.entries()].map(([k, recs]) => {
    const repos = new Set<string>();
    const sevCounts: Record<string, number> = {};
    let open = 0;
    let kev = false;
    let exploit = false;
    for (const r of recs) {
      if (isOpen(r["status"])) open += 1;
      const s = sev(r);
      sevCounts[s] = (sevCounts[s] ?? 0) + 1;
      const a = String(r["repo_name"] ?? "");
      if (a) repos.add(a);
      if (r["has_kev"] === true) kev = true;
      if (r["has_exploit"] === true) exploit = true;
    }
    const node: GroupNode = {
      key: k, dim: key, total: recs.length, open, repos: repos.size,
      sevCounts, kev, exploit, children: [],
    };
    return { recs, node };
  });
  rowsOut.sort((a, b) => b.node.total - a.node.total || a.node.key.localeCompare(b.node.key));
  const kept = rowsOut.slice(0, perLevelCap);
  if (rest.length) {
    for (const row of kept) row.node.children = groupTree(row.recs, rest, perLevelCap);
  }
  return kept.map((row) => row.node);
}

// =========================================================== risk-ladder aggregations
// Reads the DURABLE ledger rows (has_kev / has_exploit / epss are LedgerRow columns, so tiers
// survive compaction and can be replayed across scan history).

/** Open findings per tier, plus the honesty number that has to travel with them. */
export interface RiskTierStats {
  perTier: Record<string, number>;
  open: number;
  /** Open rows whose tier is `unknown`. Published beside every tier figure: a null on
   *  has_kev / has_exploit / epss means NOT CAPTURED (structurally, for sast/secrets — see the
   *  risk-tier section above), and rendering that as a clean zero is the exact mistake the
   *  three-valued verdict exists to prevent. */
  unclassified: number;
}

type TierRow = RiskRow & { status: string; scope: Scope };

/** Open-only tier counts. Resolved rows are excluded because the page ranks what is still
 *  outstanding; `movement` covers what closed. */
export function riskTierStats(rowsIn: TierRow[], rule: RiskRule, scope?: Scope): RiskTierStats {
  const rows = byScope(rowsIn, scope);
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
 * Two joins worth naming. Exposure is a frame property with no ledger column, so callers pass
 * the set of exposed `finding_key`s (gas/'s `vuln_key`, renamed per ledgerTypes.ts) from the
 * current scan; when the frame predates those keys, `exposureKnown` is false and the last two
 * steps are NOT rendered as zero. And "overdue" runs on the ACTIONABLE clock
 * (`actionable_age_days`), so a finding still awaiting a vendor fix is never counted as a
 * breach nobody could have prevented.
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
  finding_key: string;
  actionable_age_days: number | null;
  scope: Scope;
};

export function triageFunnel(
  rowsIn: FunnelRow[],
  rule: RiskRule,
  exposedKeys: Set<string>,
  exposureKnown: boolean,
  scope?: Scope,
): TriageFunnel {
  const rows = byScope(rowsIn, scope);
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
    if (!exposureKnown || !exposedKeys.has(row.finding_key)) continue;
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
  repos: number; // distinct repos carrying those open findings (gas/'s `assets`)
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
 * Top-N groups per dimension, over open rows.
 *
 * Deliberately NOT `groupTree`: that ranks by `total` (open + resolved), and reusing its
 * ordering for a list captioned "by open findings" would put a group that closed everything
 * above one that closed nothing. This counts and ranks open rows only.
 */
export function concentration(records: Rec[], dims: string[], topN = 5, scope?: Scope): Concentration {
  const rows = scope ? records.filter((r) => r["scope"] === scope) : records;
  const perDim: Record<string, ConcentrationRow[]> = {};
  const moreDim: Record<string, number> = {};
  for (const dim of dims) {
    const column = GROUP_COLUMNS[dim];
    if (!column) continue;
    const buckets = new Map<string, { open: number; repos: Set<string>; kev: number }>();
    for (const r of rows) {
      if (!isOpen(r["status"])) continue;
      const raw = r[column];
      const k = raw === null || raw === undefined || String(raw).trim() === ""
        ? "(none)" : String(raw);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { open: 0, repos: new Set(), kev: 0 }));
      b.open += 1;
      const a = String(r["repo_name"] ?? "");
      if (a) b.repos.add(a);
      if (r["has_kev"] === true) b.kev += 1;
    }
    const rowsRanked = [...buckets.entries()]
      .map(([key, b]) => ({ key, open: b.open, repos: b.repos.size, kev: b.kev }))
      .sort((a, b) => b.open - a.open || a.key.localeCompare(b.key));
    perDim[dim] = rowsRanked.slice(0, topN);
    moreDim[dim] = Math.max(0, rowsRanked.length - topN);
  }
  return { perDim, moreDim };
}

/**
 * Median age of the open backlog, in days — the hero's "how stale is this pile" mini-stat.
 *
 * Median rather than mean because remediation ages are heavily right-skewed. Interpolates the
 * midpoint on an even count, matching the percentile convention the MTTR page uses. Rows with
 * no finite age are skipped, so this reports on the rows it could actually measure.
 */
export function openAgeMedian(rowsIn: Pick<BaseRow, "status" | "age_days" | "scope">[], scope?: Scope): number | null {
  const rows = byScope(rowsIn, scope);
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

// Re-exported so the many `from "./insights"` importers this table's users expect keep
// resolving (gas/'s insights.ts re-exports it from config for the same reason).
export { EPSS_PRIORITY_THRESHOLD };
