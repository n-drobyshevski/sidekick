// The eight read-models the pages are built from, and the warm pass that keeps them hot.
//
// RESTRUCTURE, NOT A COPY. In gas/ these live inline inside `src/server/api.ts` (2,757 lines)
// as `mttrData`, `programData`, `insightsData`, `groupingData`, `groupTrendData`,
// `mttrTrendData`, `programTrendData`, `scanHistoryData` and the `cached*` wrappers beside
// them, composed by `getMttrPage` / `getProgramPage` / `getExecutivePage`. Those functions are
// the specification; the builders live here so `api.ts` stays a thin envelope layer.
//
// WHAT THIS FILE DOES NOT DO: it does not slice for the wire. `domain/pagePayload.ts` owns
// that (`execMttrSlice`, `execGroupSlice`, `programTrendSlice`, `mttrPageTrendSlice`,
// `historyTrendSlice`, `scanRowsSlice`, `jobSummarySlice`, …). S5 builds models; S7 assembles
// and slices. Where a model's natural output feeds an existing slice, the field names below
// are chosen to match that slice's reads exactly — `programModel().trend` for
// `programTrendSlice`, `historyModel().{history,trend,scans}` for the two trend slices and
// `scanRowsSlice`, `executiveModel().byScope` for `execGroupSlice` / `mttrGroupTableSlice`.
//
// ONE IMPORT RUNS THE OTHER WAY AND IT IS NOT A SLICE. `registerRowsModel` takes the ORDERING
// rule — `sortRegisterRows` / `registerSortValue` / `pageOfRegisterRows` and the two constants
// beside them — from `domain/pagePayload.ts`, because the order a paged register comes back in
// is part of what the page is sent and there must be exactly ONE rule deciding it (see that
// file's "register rows" header). The SLICE is still applied in `api.ts`: this model returns
// the page's `BaseRow`s and `registerRowsSlice` narrows them there, which is the same
// S5-builds / S7-slices split every other endpoint keeps.
//
// --------------------------------------------------------------------------------------- //
//  THE CACHING AUDIT, PER MODEL. It is not inherited, and getting it wrong makes a stale
//  figure look authoritative.
// --------------------------------------------------------------------------------------- //
//
//   model         layer            why
//   ------------  ---------------  ----------------------------------------------------------
//   executive     cached, 1 h      Open counts, the week-over-week KM badge and the per-scope
//                                  KM medians are all as-of NOW. `kmMedianAsOf(base, …, now)`
//                                  moves every time it is called; a durable copy would say
//                                  "measured now" and mean "measured whenever the file was
//                                  written".
//   mttr          cached, 1 h      SLA arithmetic. `openPastSla` breaches on
//                                  `age_days > target` with a strict `>`, so a single day
//                                  moves individual rows across the threshold; the open-age
//                                  p50/p90 and the KM censoring times drift with the clock too.
//   secrets       cached, 1 h      Open exposure. `timeToRevoke` right-censors live
//                                  credentials at `now − first_seen`, which is the whole
//                                  point of the figure — the exposure grows while nobody
//                                  rotates. A frozen copy of it reads as a shrinking exposure.
//   register      cached, 1 h      Age buckets (0-7/8-30/31-90/90+) and the oldest-open
//                                  ranking. A bucket edge is a wall-clock edge.
//   registerRows  NOT CACHED       One payload per (scope, filters) TIMES page x pageSize x
//                                  sort x dir x status. Caching that mints hundreds of entries
//                                  holding slices of one array, evicts the models worth
//                                  keeping, and still misses on the first click of every new
//                                  sort. It reads the shared `baseSnapshot()`, so the
//                                  derivation is paid once per execution either way.
//   ------------  ---------------  ----------------------------------------------------------
//   program       durablyCached    Time-invariant BY CONSTRUCTION, not by luck. The confusion
//                                  matrix, signal breakdown and rule sensitivity read `status`
//                                  and the risk columns and no clock at all. The two clock
//                                  inputs that remain — `capacityByMonth`'s `now` (which month
//                                  is `partial`) and `observationWindowDays` — are handed the
//                                  LEDGER's own clock (the newest scan's `ts`), never
//                                  `Date.now()`. readModelStore's header states the rule this
//                                  rests on: "Stored timestamps like a scan's `ts` are facts
//                                  about the ledger, not drift, and are fine."
//   repos         durablyCached    Same argument, one step further. `assetProfile` reads
//                                  `opts.now` (for `window_months`) AND each row's `age_days`
//                                  (for KM censoring), so the rows are re-censored at the
//                                  ledger clock first — `atLedgerClock()` below. Without that
//                                  re-censoring the half-life column would be the one
//                                  wall-clock read hiding inside a durable file.
//   history       durablyCached    The scan log is a stored fact; the KPI band counts rows and
//                                  reads `mttr_days`, which is `resolved_at − first_seen` off
//                                  the ledger. The trend backbone emits one point per saved
//                                  scan plus one per day of pre-first-scan history and stops
//                                  at the last scan — it never reaches for today.
//   storage       durablyCached    Cell counts, scan counts, the oldest scan's `ts`. Facts
//                                  about the spreadsheet.
//
// Every model publishes `asOf` (the instant it measured at) and the durable four publish
// `asOfSource` — "scan" when the ledger's own clock was available, "wallClock" when there is
// no scan to date the register from. A clock has to say where it started, including when it
// had to fall back.
//
// ABSENT IS NEVER ZERO. `has_kev` / `has_exploit` / `epss` / `ai_verdict` / `validation_state`
// are tri-state or structurally unavailable per scope, so every rate here travels with its
// denominator and a `missing` count. `signalCoverage()` is the shared shape; `ai_verdict` is
// null everywhere in this tenant, and 0 % is REPORTED rather than hidden.
//
// SECRETS HAVE NO SEVERITY AXIS. `DEFAULT_FETCH_SEVERITIES.secrets = []` and empty means all,
// so the register is the whole CODE population; severity there grades a DETECTION (641
// `SAAS_API_KEY` rows are LOW). `secretsModel` ignores `params.severities` outright, keeps it
// out of its cache key, and segments by `validation_state` / `confidence` / `secret_kind`.
// `registerModel("secrets")` does the same and publishes `secretsLifecycle`'s own refusal
// sentence in place of a severity breakdown.
//
// THE ACTIONABLE CLOCK IS SCOPED TO SCA AND SAYS SO. `ledgerCore.baseRows` collapses
// `fix_available_at` onto `first_seen` for sast and secrets, so `mttr_actionable_days ===
// mttr_days` and `awaiting_vendor_fix === false` there by construction. Averaging it across
// three scopes would be two-thirds a restatement of MTTR, so `mttrModel.remediation.actionable`
// is computed over sca rows only and carries `scope: "sca"` plus the count it left out.
//
// ONE DERIVATION FOR THE WHOLE SET. `baseSnapshot()` memoizes `loadBaseRows()` per execution,
// keyed on `dataVersion()` so a mutate-then-read in one execution cannot serve rows it just
// invalidated. `loadTrend` / `loadProgramTrend` take a `base` option and are handed that same
// array, so building all eight models costs exactly one `loadBaseRows()`.

import {
  DEFAULT_RISK_RULE,
  DEFAULT_SAST_RISK_RULE,
  RESOLVED_STATUSES,
  SCOPES,
  SEVERITY_ORDER,
  ruleForScope,
  type Scope,
} from "../domain/config";
import type { BaseRow, ScanRow } from "../domain/ledgerTypes";
import { normalizeSeverity } from "../domain/severity";
import { clampInt, parseTs, type Rec } from "../domain/util";
import {
  REGISTER_ROWS_DEFAULT_PAGE_SIZE,
  REGISTER_ROWS_PAGE_SIZE_CAP,
  REGISTER_ROW_DEFAULT_SORT,
  pageOfRegisterRows,
  registerRowColumns,
  registerSortValue,
  sortRegisterRows,
} from "../domain/pagePayload";
import { mttrFromLedger } from "../domain/lifecycle";
import { overallSlaOldest } from "../domain/metrics";
import {
  actionableView,
  awaitingVendorFix,
  baseRowNoFix,
  kaplanMeier,
  kmQuantileFromCurve,
  latencySegments,
  latencyView,
  mttrPercentiles,
  openPastSla,
  resolutionBuckets,
  type KMResult,
} from "../domain/remediation";
import {
  capacityByMonth,
  confusionBySeverity,
  observationWindowDays,
  ruleSensitivity,
  ruleSentence,
  signalBreakdown,
  type AnyRiskRule,
  type RiskRow,
} from "../domain/program";
import { assetProfilePopulations, type AssetRow } from "../domain/assets";
import {
  SEVERITY_AXIS_REFUSAL,
  bySegment,
  postDetectionValidityRate,
  removalVsRotation,
  timeToRevoke,
  validationCoverage,
  type SecretRow,
} from "../domain/secretsLifecycle";
import { ageBuckets, concentration, movement, oldestOpen, riskTierStats, severityStats, triageFunnel } from "../domain/insights";
import { kmMedianAsOf } from "../domain/trend";
import {
  latestScanRow,
  loadBaseRows,
  loadProgramTrend,
  loadScanRows,
  loadTrend,
  previousSeverityCounts,
} from "./ledgerStore";
import { listHistory } from "./historyStore";
import { activeJob } from "./jobsStore";
import { cellCount, gridSize, TAB_HEADERS, TABS } from "./sheetsDb";
import { cached, dataVersion } from "./serverCache";
import { durablyCached, duringWarm, sweepReadModels } from "./readModelStore";

// --------------------------------------------------------------------------------------- //
//  Parameters
// --------------------------------------------------------------------------------------- //

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** 1 h, against the six-hour CacheService ceiling — the clock models' TTL. */
const CLOCK_TTL_SEC = 3600;

/** The page cap on the oldest-open ranking; the drawer pages through it client-side. */
const OLDEST_TOP_N = 100;

/** Wall-clock budget for one warm pass. GAS kills an execution at six minutes. */
export const WARM_BUDGET_MS = 270_000;

export interface ModelParams {
  /** Narrow every figure to one register. Omit / null for all three. */
  scope?: Scope | null;
  /** Display-severity filter. Omit / null / empty for every severity. */
  severities?: string[] | null;
  /**
   * When false, findings awaiting a vendor fix drop out of the point-in-time blocks (they
   * cannot be remediated, so they are outside every deadline) while the trend series exclude
   * them AS OF each historical date — a fix landing later re-admits the row at that point.
   * Default true.
   */
  showNoFix?: boolean;
}

interface NormParams {
  scope: Scope | null;
  severities: string[] | null;
  showNoFix: boolean;
}

/**
 * Params as a canonical object — the cache key AND the durable filename derive from it, so
 * key order and "absent vs null" have to be settled in exactly one place.
 */
function norm(p?: ModelParams): NormParams {
  const scopeRaw = p?.scope ?? null;
  const scope = scopeRaw && (SCOPES as readonly string[]).includes(scopeRaw) ? scopeRaw : null;
  const sevRaw = p?.severities ?? null;
  const severities = Array.isArray(sevRaw) && sevRaw.length
    ? sevRaw.map((s) => normalizeSeverity(s)).filter((s, i, a) => a.indexOf(s) === i).sort()
    : null;
  return { scope, severities, showNoFix: p?.showNoFix !== false };
}

/** The key a cached model is stored under. Spelled out so the field order is stable. */
function keyOf(n: NormParams): Rec {
  return { scope: n.scope, severities: n.severities, showNoFix: n.showNoFix };
}

// --------------------------------------------------------------------------------------- //
//  One derivation per execution
// --------------------------------------------------------------------------------------- //

interface BaseSnapshot {
  version: string;
  /** The instant `age_days` / `actionable_age_days` on these rows were computed against. */
  now: number;
  rows: BaseRow[];
}

let baseMemo: BaseSnapshot | undefined;

/**
 * The one `loadBaseRows()` the whole model set shares.
 *
 * KEYED ON `dataVersion()`, not merely "computed once". `ledgerStore.invalidateLedgerMemos()`
 * bumps that version on every write, so a mutate-then-read inside a single execution rebuilds
 * rather than serving the rows it had just invalidated — the same hazard `serverCache`'s own
 * memos guard, for the same reason.
 */
function baseSnapshot(): BaseSnapshot {
  const version = dataVersion();
  if (!baseMemo || baseMemo.version !== version) {
    const now = Date.now();
    baseMemo = { version, now, rows: loadBaseRows({ now }) };
  }
  return baseMemo;
}

/** Test seam: drop the per-execution base-row memo. */
export function __resetModelMemosForTest(): void {
  baseMemo = undefined;
  clockMemo = undefined;
}

interface LedgerClock {
  /** Epoch ms of the newest scan, or the wall clock when nothing has ever been scanned. */
  asOf: number;
  asOfSource: "scan" | "wallClock";
  /** ISO of the earliest scan — when this register started WATCHING. Null with no scans. */
  observedFrom: string | null;
}

let clockMemo: { version: string; all: LedgerClock; byScope: Partial<Record<Scope, LedgerClock>> } | undefined;

/**
 * The LEDGER's clock: newest scan `ts` for "now", earliest for "when we started looking".
 *
 * This is what makes the durable three durable. A figure dated by the newest scan is a
 * function of the ledger and nothing else, so a stored copy answers identically forever; a
 * figure dated by `Date.now()` is not, and would be a stale number wearing a fresh label.
 *
 * `wallClock` is the honest fallback and is PUBLISHED rather than hidden: with no scan on
 * record there is no ledger clock to read, so the model says which clock it used.
 */
function ledgerClock(scope: Scope | null): LedgerClock {
  const version = dataVersion();
  if (!clockMemo || clockMemo.version !== version) {
    clockMemo = { version, all: buildClock(null), byScope: {} };
  }
  if (scope === null) return clockMemo.all;
  const hit = clockMemo.byScope[scope];
  if (hit) return hit;
  const built = buildClock(scope);
  clockMemo.byScope[scope] = built;
  return built;
}

function buildClock(scope: Scope | null): LedgerClock {
  const scans = loadScanRows().filter((s) => scope === null || s.scope === scope);
  let newest: number | null = null;
  let earliest: number | null = null;
  let earliestIso: string | null = null;
  for (const s of scans) {
    const ms = parseTs(s.ts);
    if (ms === null) continue;
    if (newest === null || ms > newest) newest = ms;
    if (earliest === null || ms < earliest) {
      earliest = ms;
      earliestIso = s.ts;
    }
  }
  return newest === null
    ? { asOf: Date.now(), asOfSource: "wallClock", observedFrom: earliestIso }
    : { asOf: newest, asOfSource: "scan", observedFrom: earliestIso };
}

// --------------------------------------------------------------------------------------- //
//  Row pipelines
// --------------------------------------------------------------------------------------- //

function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

/** Scope + display-severity narrowing. The no-fix toggle is applied separately — see below. */
function scopedRows(rows: BaseRow[], n: NormParams): BaseRow[] {
  let out = rows;
  if (n.scope) out = out.filter((r) => r.scope === n.scope);
  if (n.severities) {
    const keep = new Set(n.severities);
    out = out.filter((r) => keep.has(normalizeSeverity(r.severity)));
  }
  return out;
}

/**
 * The population every point-in-time block measures: scoped, severity-filtered, and — when the
 * toggle is off — without the findings that have no vendor fix to deploy.
 *
 * The trend series deliberately do NOT read this: they take the pre-toggle rows and exclude
 * no-fix findings as-of each date instead, so a fix landing in March re-admits its finding at
 * March rather than deleting it from the whole series.
 */
function visibleRows(rows: BaseRow[], n: NormParams): BaseRow[] {
  const scoped = scopedRows(rows, n);
  return n.showNoFix ? scoped : scoped.filter((r) => !baseRowNoFix(r));
}

/** Rows a program/asset classifier may touch: `ruleForScope("secrets")` is null and
 *  `program.resolveRule` THROWS on one, so secrets are removed and counted, never coerced. */
function classifiableRows(rows: BaseRow[]): { rows: BaseRow[]; excludedSecrets: number } {
  const kept: BaseRow[] = [];
  let excludedSecrets = 0;
  for (const r of rows) {
    if (r.scope === "secrets") excludedSecrets += 1;
    else kept.push(r);
  }
  return { rows: kept, excludedSecrets };
}

/**
 * Re-censor open rows at the LEDGER clock.
 *
 * `age_days` on a base row is `(now − first_seen)`, computed at load against the wall clock.
 * `assetProfile` reads it for Kaplan–Meier censoring, so a durable asset profile built over
 * unmodified rows would carry one wall-clock read inside an otherwise time-invariant payload —
 * exactly the failure the durable layer exists to avoid. Resolved rows are untouched: their
 * `mttr_days` is `resolved_at − first_seen` and no clock enters it.
 */
function atLedgerClock<T extends Pick<BaseRow, "status" | "first_seen" | "age_days">>(
  rows: T[],
  asOf: number,
): T[] {
  return rows.map((r) => {
    if (!isOpen(r.status)) return r;
    const first = parseTs(r.first_seen);
    if (first === null) return r;
    return { ...r, age_days: Math.max(0, asOf - first) / DAY_MS };
  });
}

// --------------------------------------------------------------------------------------- //
//  Absent is never zero
// --------------------------------------------------------------------------------------- //

export interface SignalCoverage {
  /** Rows the signal COULD have been evaluated on (total − notApplicable). */
  applicable: number;
  measured: number;
  missing: number;
  /** measured / applicable, or null when nothing was applicable — never a fake 0 %. */
  coveragePct: number | null;
  /** Rows whose scope has no such column at all. Not a gap; a different question. */
  notApplicable: number;
  total: number;
}

function coverageOf(
  rows: BaseRow[],
  applies: (r: BaseRow) => boolean,
  measured: (r: BaseRow) => boolean,
): SignalCoverage {
  let applicable = 0;
  let seen = 0;
  let na = 0;
  for (const r of rows) {
    if (!applies(r)) {
      na += 1;
      continue;
    }
    applicable += 1;
    if (measured(r)) seen += 1;
  }
  return {
    applicable,
    measured: seen,
    missing: applicable - seen,
    coveragePct: applicable > 0 ? (seen / applicable) * 100 : null,
    notApplicable: na,
    total: rows.length,
  };
}

export interface RiskSignalCoverage {
  has_kev: SignalCoverage;
  has_exploit: SignalCoverage;
  epss: SignalCoverage;
  ai_verdict: SignalCoverage;
  validation_state: SignalCoverage;
}

/**
 * Coverage of every tri-state signal a rate on this register can rest on.
 *
 * `ai_verdict` is null everywhere in this tenant — coverage 0 %, and it is REPORTED here
 * rather than left to be inferred from a SAST rule that never fires its `aiVerdict` clause.
 * Each signal's `notApplicable` is the count of rows whose scope has no such column, which is
 * a different statement from "we never looked".
 */
export function signalCoverage(rows: BaseRow[]): RiskSignalCoverage {
  const isSca = (r: BaseRow) => r.scope === "sca";
  const isSast = (r: BaseRow) => r.scope === "sast";
  const isSecrets = (r: BaseRow) => r.scope === "secrets";
  return {
    has_kev: coverageOf(rows, isSca, (r) => r.has_kev !== null),
    has_exploit: coverageOf(rows, isSca, (r) => r.has_exploit !== null),
    epss: coverageOf(rows, isSca, (r) => r.epss !== null),
    ai_verdict: coverageOf(rows, isSast, (r) => r.ai_verdict !== null && String(r.ai_verdict) !== ""),
    validation_state: coverageOf(
      rows,
      isSecrets,
      (r) => r.validation_state !== null && String(r.validation_state).trim() !== "",
    ),
  };
}

// --------------------------------------------------------------------------------------- //
//  Kaplan–Meier, shipped
// --------------------------------------------------------------------------------------- //

export interface ShippedKM {
  /** `{t, s}` only. The estimator needs `atRisk`/`events` to BUILD the curve; the chart
   *  plots two fields, and one point per distinct resolution time means the register decides
   *  this array's length. Narrowed here because it is a transfer concern, not a domain one. */
  curve: { t: number; s: number }[];
  median: number | null;
  /** Published INSTEAD of a median where the curve never reaches half. Never collapsed into
   *  `median` — "> 41 d" and "41 d" are different claims. */
  medianLowerBound: number | null;
  p90: number | null;
  mean: number | null;
  meanTruncated: boolean;
  restrictionTime: number | null;
  events: number;
  censored: number;
  total: number;
}

function shipKM(km: KMResult): ShippedKM {
  return {
    curve: km.curve.map((p) => ({ t: p.t, s: p.s })),
    median: km.median,
    medianLowerBound: km.medianLowerBound,
    p90: kmQuantileFromCurve(km.curve, 0.9),
    mean: km.mean,
    meanTruncated: km.meanTruncated,
    restrictionTime: km.restrictionTime,
    events: km.events,
    censored: km.censored,
    total: km.total,
  };
}

/** The KM stats WITHOUT the curve, plus the segment counts that say how much of the
 *  population was measured at all. gas/'s `latencySummary`, scoped. */
function latencySummary(rows: BaseRow[], now: number, scope: Scope | undefined): Rec {
  const km = kaplanMeier(latencyView(rows, "detection", now, { scope }));
  return {
    median: km.median,
    medianLowerBound: km.medianLowerBound,
    mean: km.mean,
    meanTruncated: km.meanTruncated,
    restrictionTime: km.restrictionTime,
    events: km.events,
    censored: km.censored,
    total: km.total,
    segments: latencySegments(rows, "detection", now, { scope }),
  };
}

// --------------------------------------------------------------------------------------- //
//  1. mttrModel — cached, 1 h
// --------------------------------------------------------------------------------------- //

/**
 * Time-to-remediate over one scope selection: the per-severity table, the survival estimate,
 * the SLA backlog and the two clocks.
 *
 * THE ACTIONABLE CLOCK IS A SEPARATE, SCA-ONLY BLOCK. `baseRows` collapses `fix_available_at`
 * onto `first_seen` for sast and secrets, so over all three scopes `mttr_actionable_days` is
 * `mttr_days` for two thirds of the rows and the "actionable" figure would be a restatement of
 * the one above it. `remediation.actionable` therefore carries `scope: "sca"`, its own row
 * count, and the count of rows it declined to measure.
 */
function buildMttr(n: NormParams): Rec {
  const snap = baseSnapshot();
  const scoped = scopedRows(snap.rows, n);
  const rows = visibleRows(snap.rows, n);

  const { perSev, overall } = mttrFromLedger(rows as unknown as Rec[], { now: snap.now });
  const { slaPct, oldestDays } = overallSlaOldest(perSev);

  // Per-severity KM median + p90 off ONE curve per severity, keyed by normalized severity so
  // it lines up with `perSev` (UNKNOWN included). The naive closed-only stats bias low on a
  // wave of fresh open findings; these do not.
  const kmMedianPerSev: Record<string, number | null> = {};
  const kmP90PerSev: Record<string, number | null> = {};
  const kmLowerBoundPerSev: Record<string, number | null> = {};
  {
    const bySev: Record<string, BaseRow[]> = {};
    for (const r of rows) {
      const s = normalizeSeverity(r.severity);
      (bySev[s] ?? (bySev[s] = [])).push(r);
    }
    for (const [s, rs] of Object.entries(bySev)) {
      const k = kaplanMeier(rs);
      kmMedianPerSev[s] = k.median;
      kmLowerBoundPerSev[s] = k.medianLowerBound;
      kmP90PerSev[s] = kmQuantileFromCurve(k.curve, 0.9);
    }
  }

  // sca only — see the block comment above. Computed off `scoped` rather than `rows`: the
  // awaiting-vendor-fix population IS what the no-fix toggle hides, so honouring the toggle
  // here would leave only the findings that got a fix and report how fast those were fixed.
  const scaScoped = scoped.filter((r) => r.scope === "sca");
  const scaVisible = rows.filter((r) => r.scope === "sca");

  return {
    asOf: snap.now,
    scope: n.scope,
    severities: n.severities,
    showNoFix: n.showNoFix,
    rowCount: rows.length,
    perSev,
    overall,
    slaPct,
    oldestDays,
    remediation: {
      pctiles: mttrPercentiles(rows),
      buckets: resolutionBuckets(rows),
      km: shipKM(kaplanMeier(rows)),
      kmMedianPerSev,
      kmP90PerSev,
      kmLowerBoundPerSev,
      openPastSla: openPastSla(rows),
      awaiting: awaitingVendorFix(rows),
      /**
       * The second clock, scoped and labelled. `notMeasured` is every scoped row this block
       * refused to price — sast and secrets have no vendor to wait on, so their actionable
       * clock is their detection clock and including them would inflate the sample with
       * copies of the figure above.
       */
      actionable: {
        scope: "sca" as const,
        rowCount: scaVisible.length,
        notMeasured: rows.length - scaVisible.length,
        openPastSla: openPastSla(actionableView(scaVisible)),
        km: shipKM(kaplanMeier(actionableView(scaVisible))),
        /** How long we waited for a fix to EXIST, over the pre-toggle sca population. Pairs
         *  additively with the clock above: exposure = latency + actionable. */
        vendorLatency: latencySummary(scaScoped, snap.now, "sca"),
      },
    },
    signalCoverage: signalCoverage(rows),
  };
}

export function mttrModel(p?: ModelParams): Rec {
  const n = norm(p);
  return cached("dsMttr1", keyOf(n), () => buildMttr(n), CLOCK_TTL_SEC);
}

// --------------------------------------------------------------------------------------- //
//  2. executiveModel — cached, 1 h
// --------------------------------------------------------------------------------------- //

/**
 * The landing page's own blocks. Deliberately NOT a superset of `mttrModel`: `getExecutivePage`
 * composes the two (gas/'s `getExecutivePage` does the same, via `execMttrSlice`), so shipping
 * the hero twice would pay for two Kaplan–Meier curves on one load.
 *
 * `byScope` is this register's answer to gas/'s by-domain split — three registers, three
 * clocks — and is shaped for `pagePayload.execGroupSlice` / `mttrGroupTableSlice` verbatim:
 * `{dimension, rows:[{group, kmMedian, open, …}]}`.
 *
 * `weekTrend` is the KM median now against the KM median a week ago, both replayed from the
 * ledger by `kmMedianAsOf`. Null — no badge — when the register has under a week of history or
 * either endpoint's median is unobservable under censoring. It never invents a number, and it
 * never quietly substitutes a lower bound for one.
 */
function buildExecutive(n: NormParams): Rec {
  const snap = baseSnapshot();
  const scoped = scopedRows(snap.rows, n);
  const rows = visibleRows(snap.rows, n);

  const counts: Record<string, number> = {};
  let open = 0;
  for (const r of rows) {
    if (!isOpen(r.status)) continue;
    open += 1;
    const s = normalizeSeverity(r.severity);
    counts[s] = (counts[s] ?? 0) + 1;
  }

  const byScope = (n.scope ? [n.scope] : [...SCOPES]).map((scope) => {
    const sub = rows.filter((r) => r.scope === scope);
    const km = kaplanMeier(sub);
    return {
      group: scope,
      dimension: "scope",
      total: sub.length,
      open: sub.filter((r) => isOpen(r.status)).length,
      resolved: sub.filter((r) => !isOpen(r.status)).length,
      kmMedian: km.median,
      kmMedianLowerBound: km.medianLowerBound,
      awaiting: awaitingVendorFix(sub).overall,
    };
  });

  return {
    asOf: snap.now,
    scope: n.scope,
    severities: n.severities,
    showNoFix: n.showNoFix,
    severityCounts: { counts, open, total: rows.length },
    byScope: { dimension: "scope", rows: byScope },
    weekTrend: weekTrend(scoped, n, snap.now),
    tiers: riskTierStats(scopedTierRows(rows), undefined),
    signalCoverage: signalCoverage(rows),
  };
}

/** `riskTierStats` reads `status` beside the risk columns; a BaseRow already carries both. */
function scopedTierRows(rows: BaseRow[]): (RiskRow & { status: string })[] {
  return rows as unknown as (RiskRow & { status: string })[];
}

function weekTrend(scoped: BaseRow[], n: NormParams, now: number): Rec | null {
  if (!scoped.length) return null;
  let earliest = Infinity;
  for (const r of scoped) {
    const f = parseTs(r.first_seen);
    if (f !== null && f < earliest) earliest = f;
  }
  const weekAgo = now - WEEK_MS;
  if (!Number.isFinite(earliest) || earliest > weekAgo) return null;
  const base = scoped as unknown as Rec[];
  const opts = { hideNoFix: !n.showNoFix, ...(n.scope ? { scope: n.scope } : {}) };
  const current = kmMedianAsOf(base, n.severities, now, opts);
  const previous = kmMedianAsOf(base, n.severities, weekAgo, opts);
  if (current === null || previous === null) return null;
  return {
    current,
    previous,
    deltaDays: Math.round((current - previous) * 1000) / 1000,
    days: 7,
  };
}

export function executiveModel(p?: ModelParams): Rec {
  const n = norm(p);
  return cached("dsExecutive1", keyOf(n), () => buildExecutive(n), CLOCK_TTL_SEC);
}

// --------------------------------------------------------------------------------------- //
//  3. registerModel(scope) — cached, 1 h
// --------------------------------------------------------------------------------------- //

/**
 * One register's own page: what is open, how old it is, what moved, and where it concentrates.
 *
 * SCOPE IS REQUIRED. This is the per-register view (`sca.js`, `sast.js`, `secrets.js`), and a
 * scope-less version would be `executiveModel` with the honesty removed — `movement` reads the
 * latest scan OF a scope (`ledgerCore.latestScan` requires one) and the change badge compares
 * the previous scan of the SAME register.
 *
 * ON SECRETS THERE IS NO SEVERITY BREAKDOWN. `counts` / `sevStats` / `previousSeverityCounts`
 * are null and `severityAxis` carries `secretsLifecycle`'s own refusal sentence, because
 * severity there grades a detection rather than whether a credential is live. The segment
 * tables take their place; `secretsModel` carries the lifecycle proper.
 *
 * `funnel.exposureKnown` is FALSE, always, and that is a measurement rather than an oversight:
 * internet exposure is a property of a host, and this register's asset is a repository. The
 * funnel therefore stops at `exploitable` and the page must not draw a zero below it.
 */
/** Concentration dimensions per register — every name is a key of `insights.GROUP_COLUMNS`. */
const CONCENTRATION_DIMS: Record<Scope, string[]> = {
  sca: ["repo", "language", "owner_project"],
  sast: ["repo", "cwe", "language", "owner_project"],
  secrets: ["repo", "secret_kind", "owner_project"],
};

function buildRegister(scope: Scope, n: NormParams): Rec {
  const snap = baseSnapshot();
  const scoped = { ...n, scope };
  const rows = visibleRows(snap.rows, scoped);
  const isSecrets = scope === "secrets";

  const latest = latestScanRow(scope);
  const scanCount = loadScanRows().filter((s) => s.scope === scope).length;

  return {
    asOf: snap.now,
    scope,
    severities: isSecrets ? null : n.severities,
    showNoFix: n.showNoFix,
    rowCount: rows.length,
    open: rows.filter((r) => isOpen(r.status)).length,
    resolved: rows.filter((r) => !isOpen(r.status)).length,

    // The severity axis, or the reason there is not one.
    severityAxis: isSecrets ? { supported: false, reason: SEVERITY_AXIS_REFUSAL } : { supported: true },
    counts: isSecrets ? null : countsOf(rows),
    sevStats: isSecrets ? null : severityStats(rows as unknown as Rec[], scope),
    previousCounts: isSecrets ? null : previousSeverityCounts(scope),
    segments: isSecrets
      ? {
        validation_state: bySegment(rows as unknown as SecretRow[], "validation_state"),
        confidence: bySegment(rows as unknown as SecretRow[], "confidence"),
        secret_kind: bySegment(rows as unknown as SecretRow[], "secret_kind"),
      }
      : null,

    aging: ageBuckets(rows, scope),
    oldest: oldestOpen(rows, OLDEST_TOP_N, scope),
    movement: movement(rows, latest, scanCount, scope),
    // The dimensions are per scope, because `insights.GROUP_COLUMNS` maps to real ledger
    // columns and a dimension the scope never fills would rank one "(none)" bucket. Asking for
    // a name outside that table is silently DROPPED by `concentration`, so the list is spelled
    // from the table rather than from what a page might like to see.
    concentration: concentration(rows as unknown as Rec[], CONCENTRATION_DIMS[scope], 5, scope),
    tiers: riskTierStats(scopedTierRows(rows), undefined, scope),
    funnel: triageFunnel(rows as never, undefined, new Set<string>(), false, scope),
    awaiting: awaitingVendorFix(rows, { scope }),
    latestScan: latest,
    signalCoverage: signalCoverage(rows),
  };
}

function countsOf(rows: BaseRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const s = normalizeSeverity(r.severity);
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

export function registerModel(scope: Scope, p?: ModelParams): Rec {
  const n = norm(p);
  // `scope` is part of the KEY, not merely of the payload: three registers share one ledger
  // and one cache namespace, and a key that omitted it would serve sast's page from sca's entry.
  return cached(
    "dsRegister1",
    { ...keyOf(n), scope },
    () => buildRegister(scope, n),
    CLOCK_TTL_SEC,
  );
}

// --------------------------------------------------------------------------------------- //
//  3b. registerRowsModel(scope) — NOT cached, and that is the audit answer
// --------------------------------------------------------------------------------------- //

/**
 * How a row page narrows the register, on top of `ModelParams`.
 *
 * Every field arrives off an RPC and is therefore `unknown`: `api.ts` transports and this
 * normalizes, the same division `modelParams` / `norm` already keep for the other three
 * knobs. A second normalization at the endpoint would be a second answer to "absent vs
 * null vs nonsense", free to drift from this one.
 */
export interface RowPageParams extends ModelParams {
  /** Zero-based, like `pageOfRegisterRows` and the `pager` control. Clamped into range. */
  page?: unknown;
  /** Clamped into [1, REGISTER_ROWS_PAGE_SIZE_CAP] — never honoured above the cap. */
  pageSize?: unknown;
  /** A column of this scope's own list; anything else falls back to the scope's default. */
  sort?: unknown;
  dir?: unknown;
  /** "open" | "resolved" | anything else = "all". */
  status?: unknown;
}

export type RowStatusFilter = "all" | "open" | "resolved";

function normRowStatus(v: unknown): RowStatusFilter {
  const s = String(v ?? "").toLowerCase();
  return s === "open" || s === "resolved" ? s : "all";
}

/**
 * One page of per-finding rows for one register.
 *
 * NOT CACHED, AND THE AUDIT IS WHY RATHER THAN AN OVERSIGHT. Every other model on this file
 * is one payload per (scope, severities, showNoFix); this one is one payload per that TIMES
 * page times pageSize times sort times dir times status. Caching it would mint hundreds of
 * entries holding slices of the same array, evict the eight models that are worth keeping,
 * and still miss on the first click of every new sort. What it costs instead is one sort of
 * the scoped population per call — and `baseSnapshot()` means the derivation itself is
 * shared with whatever else the same execution builds, so a page that fetches its aggregates
 * and its first row page pays ONE `loadBaseRows()`, not two.
 *
 * PAGING AND SORTING ARE SERVER-SIDE. The sca register is ~18,800 rows; shipping all of them
 * into an HtmlService page and sorting there would be absurd, and it would also put a second
 * ordering rule in the browser where it could disagree with this one. The rule itself lives
 * in `domain/pagePayload.ts` beside the slice — see that file's header for why, and for the
 * cross-check that holds it identical to `ui/tableModel.js`.
 *
 * SEVERITY IS IGNORED ON SECRETS, exactly as `secretsModel` ignores it: the gate is off for
 * that scope (`DEFAULT_FETCH_SEVERITIES.secrets = []`, empty means all) because severity
 * there grades a DETECTION. `severityFilterSupported` says so in the payload rather than
 * leaving a control that silently does nothing.
 *
 * ROWS COME BACK AS `BaseRow`s, UNSLICED. `api.ts` applies `registerRowsSlice` — S5 builds,
 * S7 assembles and slices, the same split `jobSummarySlice` is applied under. Only the
 * page's rows are returned, so the unsliced array is at most `REGISTER_ROWS_PAGE_SIZE_CAP`
 * long.
 */
export function registerRowsModel(scope: Scope, p?: RowPageParams): Rec {
  const n = norm(p);
  const snap = baseSnapshot();
  const severityFilterSupported = scope !== "secrets";
  const severities = severityFilterSupported ? n.severities : null;
  const scoped = visibleRows(snap.rows, { scope, severities, showNoFix: n.showNoFix });

  const status = normRowStatus(p?.status);
  const rows = status === "all"
    ? scoped
    : scoped.filter((r) => isOpen(r.status) === (status === "open"));

  const def = REGISTER_ROW_DEFAULT_SORT[scope]!;
  const columns = registerRowColumns(scope);
  const asked = typeof p?.sort === "string" ? p.sort : "";
  // A sort on a column this scope does not carry would order every row by `undefined` and
  // leave the register in `loadBaseRows` order while claiming to be sorted. Fall back.
  const sort = columns.includes(asked) ? asked : def.sort;
  const askedDir = String(p?.dir ?? "").toLowerCase();
  const dir: "asc" | "desc" = askedDir === "asc" || askedDir === "desc"
    ? askedDir
    : (sort === def.sort ? def.dir : "asc");

  const pageSize = clampInt(
    p?.pageSize,
    REGISTER_ROWS_DEFAULT_PAGE_SIZE,
    1,
    REGISTER_ROWS_PAGE_SIZE_CAP,
  );
  const sorted = sortRegisterRows(rows as unknown as Rec[], {
    value: registerSortValue(sort),
    descending: dir === "desc",
    // The row identity, and it is unique by construction (`lifecycle.findingKey`), so the
    // arrangement is total: two requests for the same page return the same rows.
    tiebreak: (r) => r["finding_key"],
  });
  const cut = pageOfRegisterRows(sorted, clampInt(p?.page, 0, 0, Number.MAX_SAFE_INTEGER), pageSize);

  return {
    asOf: snap.now,
    scope,
    columns: columns.slice(),
    rows: cut.rows,
    total: sorted.length,
    page: cut.page,
    pageCount: cut.pageCount,
    pageSize,
    sort,
    dir,
    status,
    severities,
    severityFilterSupported,
    showNoFix: n.showNoFix,
  };
}

// --------------------------------------------------------------------------------------- //
//  4. secretsModel — cached, 1 h
// --------------------------------------------------------------------------------------- //

/**
 * Credentials in the repository, on the axes that speak to whether one is live.
 *
 * NO SEVERITY AXIS, AND NO SEVERITY IN THE KEY. `DEFAULT_FETCH_SEVERITIES.secrets = []` and
 * empty means all, so this register is the whole CODE population; severity grades a DETECTION
 * (641 `SAAS_API_KEY` rows sit at LOW) and says nothing about whether the credential works.
 * `params.severities` is ignored outright rather than silently applied — a filtered secrets
 * register would look like the register while being a subset of it — and the payload says so.
 *
 * CACHED RATHER THAN DURABLE because `timeToRevoke` right-censors every live credential at
 * `now − first_seen`. The open exposure is supposed to grow while nobody rotates; a stored
 * copy would report it shrinking.
 *
 * REMOVED IS NOT ROTATED. `removalVsRotation` is the 2x2 of the two independent events, and
 * `removedNotRotated` is what the page leads with.
 */
function buildSecrets(n: NormParams): Rec {
  const snap = baseSnapshot();
  // Scope is pinned; severities are deliberately NOT applied. showNoFix cannot bite either —
  // `baseRowNoFix` is false for every non-sca row by construction — but it is honoured for
  // symmetry so the pipeline reads the same everywhere.
  const rows = visibleRows(snap.rows, { scope: "secrets", severities: null, showNoFix: n.showNoFix });
  const secretRows = rows as unknown as SecretRow[];

  return {
    asOf: snap.now,
    scope: "secrets" as const,
    // NOT an echo of what the caller asked for. `severities` is deliberately absent from this
    // model's cache key, so ONE entry serves every selection — and a payload echoing the
    // requesting caller's list would report whichever caller happened to compute it. The
    // refusal is a property of the register, so that is all it states.
    severityAxis: { supported: false, reason: SEVERITY_AXIS_REFUSAL },
    rowCount: rows.length,
    open: rows.filter((r) => isOpen(r.status)).length,
    coverage: validationCoverage(secretRows),
    validity: postDetectionValidityRate(secretRows),
    timeToRevoke: timeToRevoke(secretRows, { now: snap.now }),
    removalVsRotation: removalVsRotation(secretRows),
    segments: {
      validation_state: bySegment(secretRows, "validation_state"),
      confidence: bySegment(secretRows, "confidence"),
      secret_kind: bySegment(secretRows, "secret_kind"),
    },
    signalCoverage: signalCoverage(rows),
  };
}

export function secretsModel(p?: ModelParams): Rec {
  const n = norm(p);
  // The key omits `severities` because the model does. Carrying a param the compute ignores
  // would mint one entry per severity selection, all holding the same bytes.
  return cached(
    "dsSecrets1",
    { scope: "secrets", showNoFix: n.showNoFix },
    () => buildSecrets(n),
    CLOCK_TTL_SEC,
  );
}

// --------------------------------------------------------------------------------------- //
//  5. programModel — durablyCached
// --------------------------------------------------------------------------------------- //

/**
 * Prioritization-to-Prediction: coverage, efficiency and capacity.
 *
 * TIME-INVARIANT BY CONSTRUCTION. The confusion matrix, the signal breakdown and the
 * sensitivity sweep read `status` and the risk columns; the two figures that DO want a clock —
 * which capacity month is `partial`, and how wide the observation window is — are handed
 * `ledgerClock()`, the newest scan's `ts`. That is a stored fact about the ledger, so this
 * payload answers identically for as long as the ledger does not move, which is what earns it
 * a Drive-backed copy.
 *
 * NO SINGLE RULE IS PASSED DOWN. `ruleForScope` gives sca a `RiskRule` and sast a
 * `SastRiskRule`, and forcing one across both would classify half the register under a rule
 * built for the other half. Every call below omits `rule` so each row resolves its own, and
 * `sensitivity` is computed PER SCOPE because `ruleSensitivity` needs one active rule.
 *
 * SECRETS ARE EXCLUDED AND COUNTED. `program.resolveRule` throws on a secrets row rather than
 * inventing a classification; `excludedSecrets` is what it refused, published beside every
 * rate so the denominator is legible.
 */
function buildProgram(n: NormParams): Rec {
  const snap = baseSnapshot();
  const clock = ledgerClock(n.scope);
  const visible = visibleRows(snap.rows, n);
  const { rows, excludedSecrets } = classifiableRows(visible);
  const riskRows = rows as unknown as RiskRow[];

  const scans = loadScanRows() as unknown as Rec[];
  const capacityRows = rows as unknown as (RiskRow & {
    first_seen: string | null;
    resolved_at: string | null;
  })[];

  const perScopeSensitivity: Record<string, unknown> = {};
  for (const scope of SCOPES) {
    if (scope === "secrets") continue;
    if (n.scope && n.scope !== scope) continue;
    const sub = riskRows.filter((r) => r.scope === scope);
    if (!sub.length) continue;
    const rule = ruleForScope(scope) as AnyRiskRule;
    perScopeSensitivity[scope] = {
      rule,
      sentence: ruleSentence(rule),
      points: ruleSensitivity(sub, rule),
    };
  }

  const { perSev, overall } = confusionBySeverity(riskRows);

  return {
    asOf: clock.asOf,
    asOfSource: clock.asOfSource,
    observedFrom: clock.observedFrom,
    scope: n.scope,
    severities: n.severities,
    showNoFix: n.showNoFix,
    rowCount: rows.length,
    excludedSecrets,
    rules: {
      sca: { rule: DEFAULT_RISK_RULE, sentence: ruleSentence(DEFAULT_RISK_RULE) },
      sast: { rule: DEFAULT_SAST_RISK_RULE, sentence: ruleSentence(DEFAULT_SAST_RISK_RULE) },
      secrets: null,
    },
    matrix: overall,
    perSev,
    signals: signalBreakdown(riskRows),
    sensitivity: perScopeSensitivity,
    // Whole-register capacity AND the high-risk cut. P2P v3's net remediation capacity is
    // specifically the high-risk population; the overall close rate is what the 1-in-10
    // benchmark refers to. The two routinely disagree, so both are published rather than one
    // unlabelled number.
    capacity: capacityByMonth(capacityRows, scans, {
      now: clock.asOf,
      maxMonths: 24,
      ...(clock.observedFrom !== null ? { observedFrom: clock.observedFrom } : {}),
    }),
    capacityHighRisk: capacityByMonth(capacityRows, scans, {
      now: clock.asOf,
      highRiskOnly: true,
      maxMonths: 24,
      closedObserved: null,
      ...(clock.observedFrom !== null ? { observedFrom: clock.observedFrom } : {}),
    }),
    observationDays: observationWindowDays(rows, clock.asOf),
    signalCoverage: signalCoverage(visible),
    // `pagePayload.programTrendSlice` reads exactly this key. Empty under a secrets scope —
    // coverage and efficiency are rates over a high-risk population and that scope has none,
    // so an empty series is the honest answer rather than a line of zeroes.
    trend: n.scope === "secrets" ? [] : programTrendFor(n, snap.rows),
    trendSupported: n.scope !== "secrets",
  };
}

function programTrendFor(n: NormParams, all: BaseRow[]): Rec[] {
  // The trend takes the PRE-toggle rows: `loadProgramTrend` has no as-of no-fix mode, and the
  // population it replays is the classifiable one.
  const { rows } = classifiableRows(scopedRows(all, n));
  return loadProgramTrend(undefined, {
    severities: n.severities,
    base: rows,
    ...(n.scope ? { scope: n.scope } : {}),
  });
}

export function programModel(p?: ModelParams): Rec {
  const n = norm(p);
  return durablyCached("dsProgram1", keyOf(n), () => buildProgram(n));
}

// --------------------------------------------------------------------------------------- //
//  6. reposModel — durablyCached
// --------------------------------------------------------------------------------------- //

/**
 * The estate: repositories as the asset, and the language cut beside them.
 *
 * BOTH GROUPINGS AND BOTH POPULATIONS. `assetProfile` groups on `language` (brick's own
 * fixture pins that) or on `repo`; `assetProfilePopulations` stacks the `all` and `high_risk`
 * cuts. "How much does a typical repository carry" and "are we closing high risk faster than
 * it arrives" routinely disagree, and which one an unlabelled number meant is not recoverable
 * afterwards — so every row carries `population` and the page must filter on it.
 *
 * RE-CENSORED AT THE LEDGER CLOCK before it goes anywhere near the profile. `assetProfile`
 * reads `age_days` for its Kaplan–Meier half-life, and `age_days` as loaded is a wall-clock
 * read; `atLedgerClock` rewrites it as "age at the last measurement" so the durable copy is a
 * function of the ledger alone. `observedFrom` is the earliest scan — null is a legitimate
 * answer that makes `window_months`, `mmcr_p50` and the three capacity shares null rather
 * than inventing a window.
 */
function buildRepos(n: NormParams): Rec {
  const snap = baseSnapshot();
  const clock = ledgerClock(n.scope);
  const visible = visibleRows(snap.rows, n);
  const rows = atLedgerClock(visible, clock.asOf) as unknown as AssetRow[];
  const opts = { observedFrom: clock.observedFrom, now: clock.asOf };

  return {
    asOf: clock.asOf,
    asOfSource: clock.asOfSource,
    observedFrom: clock.observedFrom,
    scope: n.scope,
    severities: n.severities,
    showNoFix: n.showNoFix,
    rowCount: visible.length,
    byRepo: assetProfilePopulations(rows, { ...opts, groupBy: "repo" }),
    byLanguage: assetProfilePopulations(rows, { ...opts, groupBy: "language" }),
    signalCoverage: signalCoverage(visible),
  };
}

export function reposModel(p?: ModelParams): Rec {
  const n = norm(p);
  return durablyCached("dsRepos1", keyOf(n), () => buildRepos(n));
}

// --------------------------------------------------------------------------------------- //
//  7. historyModel — durablyCached
// --------------------------------------------------------------------------------------- //

/**
 * What was actually measured and when, plus the trend backbone three pages draw from.
 *
 * SHAPED FOR THE EXISTING SLICES. `scans` feeds `pagePayload.scanRowsSlice`; `{history, trend}`
 * feeds `mttrPageTrendSlice` (MTTR page, which reads `history` for its change chips and as the
 * young-ledger fallback) and `historyTrendSlice` (Scan History, which drops `history` whole).
 * One cached backbone, three views of it — which is why the trend lives here rather than
 * inside `mttrModel`: `mttrModel` is a clock model on a 1 h TTL, and the trend is not.
 *
 * TIME-INVARIANT. `trendFromBase(..., {backfill:true})` emits one point per saved scan plus one
 * per day of pre-first-scan history and stops at the newest scan; every SLA and KM decorator is
 * evaluated as-of a point's own date. Nothing here reaches for today.
 */
function buildHistory(n: NormParams): Rec {
  const snap = baseSnapshot();
  const clock = ledgerClock(n.scope);
  const scansAll = loadScanRows();
  const scans = (n.scope ? scansAll.filter((s) => s.scope === n.scope) : scansAll)
    .slice()
    .reverse(); // newest first, as the table draws it

  const rows = visibleRows(snap.rows, n);
  const { overall } = mttrFromLedger(rows as unknown as Rec[], { now: snap.now });

  return {
    asOf: clock.asOf,
    asOfSource: clock.asOfSource,
    observedFrom: clock.observedFrom,
    scope: n.scope,
    severities: n.severities,
    showNoFix: n.showNoFix,
    scans,
    perScope: perScopeScanStats(scansAll),
    kpis: {
      tracked: rows.length,
      open: rows.filter((r) => isOpen(r.status)).length,
      resolvedAllTime: rows.filter((r) => !isOpen(r.status)).length,
      // The KM median, NOT the naive closed-only one, and its lower bound beside it: where the
      // curve never reaches half there is no median to print and the bound is what is true.
      medianMttr: overall.mttr_median ?? null,
      km: shipKM(kaplanMeier(rows)),
    },
    // `mttrPageTrendSlice` reads both of these keys.
    history: listHistory(),
    trend: trendFor(n, snap.rows),
  };
}

function trendFor(n: NormParams, all: BaseRow[]): Rec[] {
  // PRE-TOGGLE rows on purpose: `loadTrend` excludes no-fix findings AS OF each date, so a
  // finding whose fix landed in March re-enters the series at March. Filtering up front would
  // delete it from the whole history instead.
  return loadTrend({
    severities: n.severities,
    showNoFix: n.showNoFix,
    base: scopedRows(all, n),
    ...(n.scope ? { scope: n.scope } : {}),
  });
}

function perScopeScanStats(scans: ScanRow[]): Record<string, Rec> {
  const out: Record<string, Rec> = {};
  for (const scope of SCOPES) {
    const sub = scans.filter((s) => s.scope === scope);
    const last = sub.length ? sub[sub.length - 1]! : null;
    out[scope] = {
      scans: sub.length,
      sealed: sub.filter((s) => s.sealed === 1).length,
      firstScanTs: sub.length ? sub[0]!.ts : null,
      lastScanTs: last ? last.ts : null,
      lastTotal: last ? last.total : null,
    };
  }
  return out;
}

export function historyModel(p?: ModelParams): Rec {
  const n = norm(p);
  return durablyCached("dsHistory1", keyOf(n), () => buildHistory(n));
}

// --------------------------------------------------------------------------------------- //
//  8. storageModel — durablyCached
// --------------------------------------------------------------------------------------- //

/**
 * The ALLOCATED grid of every declared tab, plus whatever else lives in the spreadsheet.
 *
 * DIVERGENCE (gas/): `sheetsDb` here exports `cellCount()` (the whole spreadsheet) and
 * `gridSize(tab)` (one tab) but no `cellUsage()`, so the per-tab breakdown is assembled from
 * the declared `TABS` and the remainder is published as `cellsOther` rather than being folded
 * into the total silently. A tab that cannot be read is reported as an error string beside its
 * name — a missing number here must not read as a zero-cell tab.
 */
function cellsByTab(): { tabs: { tab: string; cells: number | null; error?: string }[]; known: number } {
  const tabs: { tab: string; cells: number | null; error?: string }[] = [];
  let known = 0;
  for (const tab of Object.values(TABS)) {
    try {
      const g = gridSize(tab);
      const cells = g.rows * g.cols;
      known += cells;
      tabs.push({ tab, cells });
    } catch (e) {
      tabs.push({ tab, cells: null, error: String(e) });
    }
  }
  return { tabs, known };
}

/**
 * What the register costs, and what is consuming the ceiling.
 *
 * `cellCount()` walks every sheet in the spreadsheet, which is the reason this is cached at
 * all. `ledgerRowCells` is read off the LIVE header list rather than hardcoded, so the
 * headroom estimate stays right as ledger columns are added.
 *
 * `unknownSeverityCount` is a data-quality diagnostic, not a severity breakdown: it counts
 * rows whose severity did not normalize to anything in `SEVERITY_ORDER`.
 */
function buildStorage(): Rec {
  const snap = baseSnapshot();
  const clock = ledgerClock(null);
  const scans = loadScanRows();
  const total = cellCount();
  const usage = cellsByTab();
  const rows = snap.rows;

  const perScope: Record<string, Rec> = {};
  for (const scope of SCOPES) {
    perScope[scope] = {
      findings: rows.filter((r) => r.scope === scope).length,
      scans: scans.filter((s) => s.scope === scope).length,
    };
  }

  return {
    asOf: clock.asOf,
    asOfSource: clock.asOfSource,
    cellCount: total,
    cellLimit: 10_000_000,
    cellsByTab: usage.tabs,
    /** The spreadsheet minus the declared tabs — sheets nothing here manages. */
    cellsOther: total - usage.known,
    ledgerRowCells: (TAB_HEADERS[TABS.ledger] ?? []).length,
    scanCount: scans.length,
    sealedCount: scans.filter((s) => s.sealed === 1).length,
    oldestScanTs: scans.length ? scans[0]!.ts : null,
    newestScanTs: scans.length ? scans[scans.length - 1]!.ts : null,
    trackedFindings: rows.length,
    perScope,
    distinctSeverities: [...new Set(rows.map((r) => normalizeSeverity(r.severity)))].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a as never) - SEVERITY_ORDER.indexOf(b as never),
    ),
    unknownSeverityCount: rows.filter((r) => normalizeSeverity(r.severity) === "UNKNOWN").length,
  };
}

export function storageModel(): Rec {
  return durablyCached("dsStorage1", null, () => buildStorage());
}

// --------------------------------------------------------------------------------------- //
//  The warm pass
// --------------------------------------------------------------------------------------- //

export interface WarmReport {
  warmed: number;
  skipped: number;
  swept: number;
  /** Set when the pass did not run at all. */
  blockedBy: string | null;
  elapsedMs: number;
}

/**
 * The (name, params) pairs the warm asks for — A FIXED HANDFUL, and that is a correctness
 * property rather than a budget one.
 *
 * `readModelStore` only WRITES while `duringWarm` is running, precisely because deterministic
 * filenames bound the Drive file count only while the key space is bounded. This list is that
 * bound. Enumerating scopes x severity selections x toggle states here would multiply the
 * post-scan tail — inside a six-minute execution cap — to warm slices a reader may never open;
 * the unscoped landing pages are the ones that must be instant, and they are the ones warmed.
 */
function warmTargets(): { label: string; run: () => unknown }[] {
  const all: ModelParams = { scope: null, severities: null, showNoFix: true };
  const targets: { label: string; run: () => unknown }[] = [
    // The durable four first: they are what the Drive layer exists for, and a budget cut-out
    // that never reached them would leave the expensive answers cold overnight.
    { label: "history", run: () => historyModel(all) },
    { label: "program", run: () => programModel(all) },
    { label: "repos", run: () => reposModel(all) },
    { label: "storage", run: () => storageModel() },
    { label: "executive", run: () => executiveModel(all) },
    { label: "mttr", run: () => mttrModel(all) },
    { label: "secrets", run: () => secretsModel(all) },
  ];
  for (const scope of SCOPES) {
    targets.push({ label: `register:${scope}`, run: () => registerModel(scope, all) });
  }
  return targets;
}

/**
 * Precompute the read-models the landing pages open with.
 *
 * SKIPPED ENTIRELY WHILE A JOB IS IN FLIGHT, and the reason is correctness rather than
 * politeness. `activeJob()` is single-flight across kinds, so one check covers scan, compact
 * and import. A commit landing mid-warm bumps DATA_VERSION and makes everything just computed
 * unreachable — waste — but worse, a PERSISTING job is part-way through a wholesale
 * `overwrite`, so a warm reading the ledger then would cache a TORN read under the pre-bump
 * version and serve it for the rest of that window. A caller that wants a post-scan warm must
 * therefore run it once the job row has reached a terminal phase, not from inside the job.
 *
 * BUDGETED, because a killed execution warms nothing and reports nothing: every entry it had
 * already computed is still cached, the ones it never reached stay cold, and there is no line
 * anywhere saying which. Stopping at the budget and returning "warmed N, N left cold" degrades
 * instead of failing. Every entry is guarded so one failure never aborts the rest.
 *
 * THE SWEEP IS SKIPPED AFTER A BUDGET CUT-OUT. The keep-list is what the warm actually
 * touched; short by whatever never ran, it would trash live entries and rewrite them next pass.
 */
export function warmReadModels(budgetMs: number = WARM_BUDGET_MS): WarmReport {
  const job = activeJob();
  if (job) {
    const reason = `${job.kind} job ${job.job_id} is ${job.phase}`;
    console.log(`Read-model warm: skipped, ${reason}`);
    return { warmed: 0, skipped: 0, swept: 0, blockedBy: reason, elapsedMs: 0 };
  }
  return duringWarm(() => warmInner(budgetMs));
}

function warmInner(budgetMs: number): WarmReport {
  const t0 = Date.now();
  let warmed = 0;
  let skipped = 0;
  for (const target of warmTargets()) {
    if (Date.now() - t0 >= budgetMs) {
      skipped += 1;
      continue;
    }
    try {
      target.run();
      warmed += 1;
    } catch (e) {
      console.warn(`Read-model warm (${target.label}) failed: ${e}`);
    }
  }
  if (skipped) {
    console.warn(`Read-model warm: out of budget after ${warmed} entries, ${skipped} left cold`);
  }
  const swept = skipped ? 0 : sweepReadModels();
  return { warmed, skipped, swept, blockedBy: null, elapsedMs: Date.now() - t0 };
}
