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
//                                  written". ITS ONE TIME-INVARIANT BLOCK SAYS SO: `coldZone`
//                                  is measured at `ledgerClock(n.scope)`, not at `snap.now`
//                                  like everything else here, and publishes
//                                  `coldZoneAsOfSource` — an idle time is "how long since
//                                  something happened", so dating it by the wall clock would
//                                  grow it by an hour every time this entry was rebuilt while
//                                  the ledger stood still.
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
//                                  wall-clock read hiding inside a durable file. `coldZone`
//                                  is durable on the same terms and needs no re-censoring at
//                                  all: it never reads `age_days`, deriving every duration
//                                  from `first_seen` and the three movement columns against
//                                  the ledger clock it is handed. The operator's threshold
//                                  joins the CACHE KEY (`dsRepos2`), because a saved window
//                                  changes every verdict in the block — and so do the three
//                                  RELATIVE-MODE fields (`coldZoneMode`, `coldTargetSharePct`,
//                                  `coldFloorDays`) added beside it, on the identical
//                                  argument. NO NAMESPACE BUMP CAME WITH THEM, and the
//                                  reasoning belongs here beside the `dsRepos1 -> dsRepos2`
//                                  note (on `reposModel` itself) rather than in a commit
//                                  message: that bump was needed because the PAYLOAD grew a
//                                  block under an UNCHANGED key, so a warm file was still
//                                  addressable and still answered — with a page section
//                                  missing. This change is the opposite shape. The durable
//                                  filename is `rm-<name>-<sha1(JSON(params))>`
//                                  (readModelStore.ts's `readModelFileName` over
//                                  serverCache.ts's `paramsHash`), so three new fields in the
//                                  params object move the hash and every pre-existing file
//                                  becomes UNREACHABLE by the new key: there is nothing stale
//                                  left to serve, and a bump would only orphan the fixed-mode
//                                  files an operator who never switches modes is still
//                                  hitting. The two other staleness guards are unchanged and
//                                  still hold: `currentStamp()` carries `BUILD_ID`, and
//                                  `MAX_AGE_MS` is 7 days. The same three fields join
//                                  `dsExecutive1` below, in the same order.
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
  type ColdZoneMode,
  type Scope,
} from "../domain/config";
import {
  effectiveColdZoneSettings,
  effectiveExcludeEndOfLifeFromMttr,
  effectiveSlaTargets,
} from "../domain/settingsLogic";
import { coldZoneHeadline, coldZoneProfile, type NewestScan } from "../domain/coldZone";
import type { BaseRow, ScanRow } from "../domain/ledgerTypes";
import { normalizeSeverity } from "../domain/severity";
import { parseSeverities } from "../domain/compaction";
import { attachProjectGrain, inProject, parseProjects } from "../domain/projectScope";
import { isProduct, isSupportGroup } from "../domain/projectGrain";
import { inDomain } from "../domain/domainScope";
import { isEndOfLife } from "../domain/lifecycleTag";
import { attachRepoTags } from "./repoTags";
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
import {
  movementDecomposition,
  movementWindowScans,
  type MovementRow,
  type MovementWindow,
} from "../domain/movementDecomposition";
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
import { ageBuckets, agingDistribution, concentration, movement, oldestOpen, riskTierStats, severityStats, slaConsumedDeciles, triageFunnel } from "../domain/insights";
import { kmMedianAsOf } from "../domain/trend";
import { fixNext } from "./fixNext";
import {
  latestScanRow,
  loadBaseRows,
  loadProgramTrend,
  loadScanRows,
  loadTrend,
  previousSeverityCounts,
} from "./ledgerStore";
import { latestHistory, listHistory } from "./historyStore";
import { activeJob } from "./jobsStore";
import { cellCount, gridSize, TAB_HEADERS, TABS } from "./sheetsDb";
import { BASE_FILTER_WORDS } from "./wizQueries";
import { loadSettings } from "./settingsStore";
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
  /**
   * The VIEW scope — a project slug, or null for the whole register. Read from
   * `settingsStore.loadSettings().projectView` below, NEVER from `p` (a caller's page
   * params): this is app-header chrome, the same global-not-per-page status
   * `settingsLogic.ts`'s own header assigns it, so a stale bookmark or a page that forgot to
   * forward a param can never disagree with what the header shows. Deliberately absent from
   * the public `ModelParams` — nothing calling in from `api.ts` is meant to set it directly.
   */
  project: string | null;
  /**
   * The OTHER view scope — a business-domain tag value, or null for the whole register. Read
   * from `settingsStore.loadSettings().domainView` below and absent from `ModelParams` for
   * every reason `project` above is: it is app-header chrome, and a page that set it directly
   * could disagree with what the header shows.
   *
   * AT MOST ONE OF `project` AND `domain` IS EVER SET — `settingsLogic.withProjectView` /
   * `withDomainView` clear each other on the way in. `scopedRows` still applies both, because
   * a filter that is null is a no-op and writing it as a chain rather than a branch means a
   * stored pair carrying both narrows to the intersection instead of silently ignoring one.
   */
  domain: string | null;
  /**
   * The SLA windows actually in force — `settingsLogic.effectiveSlaTargets`, read off
   * `settingsStore.loadSettings()` exactly once here, same as `project` above. NEVER a
   * `ModelParams` field for the same reason `project` is not one: a per-page override would
   * let one caller ask this register to report an attainment number no other page on it
   * would agree with. `buildMttr`, `buildExecutive` and `buildRegister` are the readers —
   * see `insights.agingDistribution` / `triageFunnel`, `remediation.openPastSla`,
   * `lifecycle.mttrFromLedger` and `fixNext`'s matching parameters.
   */
  slaTargets: Record<string, number>;
  /**
   * The cold-zone threshold actually in force — `settingsLogic.effectiveColdAfterDays`, read
   * off the SAME `loadSettings()` call as `project`, `domain` and `slaTargets` above, and NOT
   * a `ModelParams` field for their reason unchanged: a per-page override would let one caller
   * publish a cold-repository count no other page on this register would agree with.
   *
   * Read through `effectiveColdZoneSettings` rather than off the field directly because
   * `coldZoneProfile` REFUSES a non-positive threshold (it derives its buckets as thirds of
   * this number), so a settings row that never went through `cleanSettings` would take the
   * Repositories page down rather than degrade to the shared default.
   *
   * IN FIXED MODE THIS IS THE LINE; IN RELATIVE MODE IT IS NOT. The profile publishes
   * `cold_after_days` as the EFFECTIVE line whichever mode drew it, and keeps this number as
   * `fixed_after_days`. Nothing here needs to know which: all four fields go in, one line
   * comes out.
   */
  coldAfterDays: number;
  /**
   * Which definition draws the line — `settingsLogic.effectiveColdZoneSettings().mode`, read
   * off the SAME `loadSettings()` call as everything above it, and NOT a `ModelParams` field
   * for `slaTargets`' and `coldAfterDays`' reason unchanged: a per-page override would let one
   * caller publish a cold-repository count no other page on this register would agree with.
   */
  coldZoneMode: ColdZoneMode;
  /**
   * The share relative mode aims at, per cent. Not a `ModelParams` field, same argument.
   *
   * TRAVELS WITH THE MODE, ALWAYS — `coldZoneProfile` THROWS in relative mode when this is
   * absent, so `norm()` takes it and `floorDays` below from the same
   * `effectiveColdZoneSettings()` call that produced `coldZoneMode`, never from three separate
   * reads that could disagree about whether a target was stored. Carried (and keyed) in fixed
   * mode too, where the profile ignores it: a params object whose shape depends on the mode
   * would make the two cache keys below mode-shaped as well.
   */
  coldTargetSharePct: number;
  /** The floor the derived line may not go below, in days. Not a `ModelParams` field, same
   *  argument; travels with the mode for the same reason `coldTargetSharePct` does. */
  coldFloorDays: number;
  /**
   * Whether retired repositories are left out of the cold zone. Not a `ModelParams` field, for
   * the same argument as the four above and with more force: this one changes WHO IS COUNTED,
   * so a per-page override would let the Executive card and the Repositories page report cold
   * shares of two different estates.
   */
  coldExcludeEndOfLife: boolean;
  /**
   * Whether the REMEDIATION-SPEED figures leave retired repositories out — the half-life and
   * its curve, the SLA attainment, the open-age distribution, the capacity rates, the time to
   * revoke. `settingsLogic.effectiveExcludeEndOfLifeFromMttr`, off the same `loadSettings()`
   * call as everything above it.
   *
   * NOT A `ModelParams` FIELD, for `coldExcludeEndOfLife`'s reason with the same force: this
   * changes WHO IS MEASURED, and the Executive's hero half-life and the MTTR page's are the
   * same number read twice. A per-page override is exactly how they would stop being.
   *
   * ITS OWN FIELD, NOT THE COLD-ZONE ONE REUSED. The two settings are independent by design
   * (see `Settings.excludeEndOfLifeFromMttr`); collapsing them here would make the page that
   * reads one silently obey the other.
   */
  mttrExcludeEndOfLife: boolean;
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
  // One `loadSettings()` for every field it feeds below — `project`, `slaTargets` and the five
  // cold-zone fields are independent readings of the same settings row, not eight separate
  // reasons to fetch it eight times.
  const settings = loadSettings();
  // `cleanProjectView` already collapses anything that is not a genuine string to "" — this
  // is just the last step, turning that "no scope stored" value into the `null` every other
  // knob here uses for "not narrowed".
  const projectRaw = settings.projectView;
  const project = projectRaw ? projectRaw : null;
  // The same last step for the domain scope, through the same `cleanViewScope` guarantee.
  const domainRaw = settings.domainView;
  const domain = domainRaw ? domainRaw : null;
  // ALL FIVE COLD-ZONE FIELDS THROUGH ONE DOOR, off the same settings object. See
  // `effectiveColdZoneSettings`'s own header: reading the mode from one place and the two
  // relative-mode numbers from another is exactly how `coldZoneProfile` ends up handed a
  // relative mode with nothing to aim at, which it throws on.
  const cold = effectiveColdZoneSettings(settings);
  return {
    scope,
    severities,
    showNoFix: p?.showNoFix !== false,
    project,
    domain,
    slaTargets: effectiveSlaTargets(settings),
    coldAfterDays: cold.coldAfterDays,
    coldZoneMode: cold.mode,
    coldTargetSharePct: cold.targetSharePct,
    coldFloorDays: cold.floorDays,
    coldExcludeEndOfLife: cold.excludeEndOfLife,
    // ITS OWN DOOR, not a sixth field on `effectiveColdZoneSettings`. That bundle exists
    // because `coldZoneProfile`'s options must travel together; this one travels with none of
    // them and governs a different family on five other pages.
    mttrExcludeEndOfLife: effectiveExcludeEndOfLifeFromMttr(settings),
  };
}

/** The key a cached model is stored under. Spelled out so the field order is stable. */
function keyOf(n: NormParams): Rec {
  return {
    scope: n.scope, severities: n.severities, showNoFix: n.showNoFix,
    project: n.project, domain: n.domain,
  };
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
 *
 * THE REPOSITORY-TAG JOIN HAPPENS HERE, ONCE, AND THIS IS THE ONLY PLACE IT CAN. `_domain` and
 * `_lifecycle` are resolved on read and never persisted (see domain/domainTag.ts and
 * domain/lifecycleTag.ts), so a row that has not been through `attachRepoTags` carries neither
 * — and every model below takes its rows from this one snapshot. Attaching anywhere further
 * down would mean one model answering by domain while another silently reported the whole
 * register; attaching further up, inside `loadBaseRows`, would put a server-side join inside
 * the store that every pure test constructs rows through.
 *
 * `refreshRepoTags` bumps the data version, so a refreshed map invalidates this memo by the
 * same mechanism a sync does — the map is never joined against stale rows, nor rows against a
 * stale map.
 *
 * THE TWO PROJECT GRAINS ATTACH HERE TOO, for exactly the argument above — `_supportGroup` and
 * `_product` are derived on read, so a model reading rows that never passed through
 * `attachProjectGrain` would report the whole register where another reported one product.
 *
 * ONE DIFFERENCE WORTH STATING, because it changes what an unset field MEANS. The tag join
 * is gated on a map that may never have been refreshed, so `attachRepoTags` can legitimately
 * be a whole-register no-op. `attachProjectGrain` is a pure function of the row and never is:
 * a row without `_product` is a row the tenant filed under no product, not a row the plumbing
 * has not reached yet.
 */
function baseSnapshot(): BaseSnapshot {
  const version = dataVersion();
  if (!baseMemo || baseMemo.version !== version) {
    const now = Date.now();
    const rows = loadBaseRows({ now });
    attachRepoTags(rows as unknown as Rec[]);
    attachProjectGrain(rows);
    baseMemo = { version, now, rows };
  }
  return baseMemo;
}

/** Test seam: drop the per-execution base-row memo. */
export function __resetModelMemosForTest(): void {
  baseMemo = undefined;
  clockMemo = undefined;
  newestScanMemo = undefined;
}

interface LedgerClock {
  /** Epoch ms of the newest scan, or the wall clock when no sync has ever saved one. */
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

let newestScanMemo: { version: string; byScope: Partial<Record<Scope, NewestScan>> } | undefined;

/**
 * The newest scan OF EACH SCOPE — what `coldZone` tests "the scanner still returns this
 * repository" against.
 *
 * PER SCOPE, NOT ONE NEWEST SCAN. A sync that collected sca alone writes one scan row; testing
 * every row of every register against it would mark every sast and secrets finding in the
 * estate as having vanished, which is the single worst thing that block could say.
 *
 * A SCOPE WITH NO SCAN ON RECORD IS LEFT OUT OF THIS MAP ON PURPOSE. Its absence is the input
 * `coldZone` reads as "observation is undecidable here" — it keeps those repositories observed
 * and names the scope in `scopes_without_scan`. Filling the gap with a placeholder (a null
 * `scan_id`, or the whole-register newest) would turn "we cannot tell" into a claim, and the
 * claim it would make is the accusing one.
 *
 * Memoised beside `clockMemo` and keyed on `dataVersion()` for its reason unchanged: a
 * mutate-then-read inside one execution must rebuild rather than serve what it just
 * invalidated.
 */
function newestScanByScope(): Partial<Record<Scope, NewestScan>> {
  const version = dataVersion();
  if (!newestScanMemo || newestScanMemo.version !== version) {
    const byScope: Partial<Record<Scope, NewestScan>> = {};
    const newestMs: Partial<Record<Scope, number>> = {};
    for (const s of loadScanRows()) {
      const ms = parseTs(s.ts);
      if (ms === null) continue;
      const scope = s.scope;
      const seen = newestMs[scope];
      if (seen !== undefined && ms <= seen) continue;
      newestMs[scope] = ms;
      byScope[scope] = { scan_id: s.scan_id, ts: s.ts };
    }
    newestScanMemo = { version, byScope };
  }
  return newestScanMemo.byScope;
}

// --------------------------------------------------------------------------------------- //
//  Row pipelines
// --------------------------------------------------------------------------------------- //

function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

/**
 * Scope + view-project + display-severity narrowing. The no-fix toggle is applied
 * separately — see below.
 *
 * THE PROJECT FILTER GOES THROUGH `inProject`, THE SINGLE DEFINITION — never a second
 * `.some()` over `parseProjects(row.projects_json)`. A row carrying no project at all
 * (`parseProjects` returns `[]`) matches no slug and so drops out of every scoped view,
 * which is `unattributedCount`'s population and is reported at `bootstrap`, not silently
 * redistributed into "no scope selected".
 *
 * THE DOMAIN FILTER GOES THROUGH `inDomain`, FOR THE SAME REASON AND WITH THE SAME
 * CONSEQUENCE. A row whose repository carries no domain tag — or whose repository the join map
 * has not seen — has no `_domain` and matches no name, so it drops out of every domain-scoped
 * view. That population is `noDomainCount`'s and is reported at `bootstrap` as `scope.noDomain`,
 * where the switcher's caption says it out loud.
 */
function scopedRows(rows: BaseRow[], n: NormParams): BaseRow[] {
  let out = rows;
  if (n.scope) out = out.filter((r) => r.scope === n.scope);
  if (n.project) out = out.filter((r) => inProject(parseProjects(r.projects_json), n.project!));
  if (n.domain) out = out.filter((r) => inDomain(r, n.domain!));
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
 * What the remediation-speed figures measure over: the rows handed in, minus the ones on
 * repositories the tenant has RETIRED — and the counts that say what happened.
 *
 * `classifiableRows`' TWIN, above, and deliberately the same shape: *"secrets are removed and
 * counted, never coerced"* is the rule this file already keeps for a population an estimator
 * must not see, and this is a second population with a second reason.
 *
 * WHY THE FILTER IS HERE AND NOT INSIDE THE ESTIMATORS, which is the design decision this
 * function embodies rather than merely implements:
 *
 *   * `remediation.kaplanMeier` is pinned byte-for-byte against brick's PySpark output
 *     (`test/fixtures/brick/km.json`), and `program.capacityByMonth` against `capacity.json`.
 *     A population filter inside either would break the port's parity with the pipeline over a
 *     setting the pipeline does not have.
 *   * `insights.ts` states the convention outright at `slaConsumedDeciles`: its only caller
 *     "hands it rows `visibleRows` has ALREADY narrowed… A caller wanting one register filters
 *     before the call."
 *   * It is possible here and was not in the cold zone. `coldZoneProfile` had to own its own
 *     exclusion because relative mode DERIVES its line from the surviving population, so a cut
 *     applied afterwards would move the line and then hide what moved it. Nothing in this
 *     family has that feedback loop: every figure is a function of the rows it is given.
 *
 * COUNTED IN BOTH SETTINGS. `endOfLifeRepos` is the retired population whether or not the
 * caller asked for it to go, which is what makes the setting discoverable instead of hidden —
 * `coldZone.ts` publishes the same figure for the same reason, and `remediation.ts`'s
 * `LatencySegments` states the general rule: what a population lost is "reported beside the
 * estimate rather than inferred from it", because a reader cannot otherwise tell a small
 * register from a badly-measured one.
 *
 * NEVER GUESSES. Only a positively recognised end-of-life reading removes anything
 * (`lifecycleTag.isEndOfLife`): a row whose repository carries no lifecycle tag, or one in a
 * vocabulary this register has not been taught, stays in. Absence is never retirement.
 *
 * REPOSITORIES ARE COUNTED DISTINCTLY, by `repo_id`, because the sentence this feeds says "N
 * repositories" and a register has thousands of rows across tens of them. Rows with a blank
 * `repo_id` belong to no repository and can never be retired, so they pass through untouched.
 */
function liveRepoRows(
  rows: BaseRow[],
  exclude: boolean,
): { rows: BaseRow[]; endOfLifeRepos: number; excludedRepos: number; excludedRows: number } {
  const retired = new Set<string>();
  const kept: BaseRow[] = [];
  let excludedRows = 0;
  for (const r of rows) {
    if (!isEndOfLife(r._lifecycle)) {
      kept.push(r);
      continue;
    }
    const id = String(r.repo_id ?? "").trim();
    if (id) retired.add(id);
    if (!exclude) {
      kept.push(r);
      continue;
    }
    excludedRows += 1;
  }
  return {
    rows: exclude ? kept : rows,
    endOfLifeRepos: retired.size,
    excludedRepos: exclude ? retired.size : 0,
    excludedRows,
  };
}

/** The `liveRepoRows` result as the five payloads carry it. Spelled once, so the client's one
 *  shared sentence reads the same keys wherever it is drawn. */
interface EndOfLifeBlock {
  /** The setting, echoed — the note says a different thing in each state. */
  excluded: boolean;
  /** Retired repositories these rows touched, counted in BOTH settings. */
  repos: number;
  /** Of those, how many actually left: `repos` when the switch is on, 0 when it is off. */
  excludedRepos: number;
  /** Findings that went with them — the measurement this read is no longer about. */
  excludedRows: number;
}

function endOfLifeBlock(
  cut: { endOfLifeRepos: number; excludedRepos: number; excludedRows: number },
  exclude: boolean,
): EndOfLifeBlock {
  return {
    excluded: exclude,
    repos: cut.endOfLifeRepos,
    excludedRepos: cut.excludedRepos,
    excludedRows: cut.excludedRows,
  };
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
  // EVERY BLOCK ON THIS PAGE IS A REMEDIATION-SPEED FIGURE, so the cut is taken once here and
  // the two row variables below are what it produced — there is no figure on this page the
  // exclusion should reach and does not, and none it should spare. `scoped` is cut too: it
  // feeds the vendor-latency estimate, which is a duration like the rest.
  const cut = liveRepoRows(visibleRows(snap.rows, n), n.mttrExcludeEndOfLife);
  const scoped = liveRepoRows(scopedRows(snap.rows, n), n.mttrExcludeEndOfLife).rows;
  const rows = cut.rows;

  const { perSev, overall } = mttrFromLedger(
    rows as unknown as Rec[],
    { now: snap.now, slaTargets: n.slaTargets },
  );
  const { slaPct, oldestDays } = overallSlaOldest(perSev);

  // Per-severity KM off ONE curve per severity, keyed by normalized severity so it lines up
  // with `perSev` (UNKNOWN included). The naive closed-only stats bias low on a wave of fresh
  // open findings; these do not.
  //
  // THE CURVE SHIPS, NOT ONLY ITS THREE STATISTICS. This block used to compute one
  // `kaplanMeier(rs)` per severity and keep the median, the lower bound and the P90 off it,
  // discarding the staircase that produced all three — so no surface in the app could compare
  // severity survival SHAPES, and three fixed statistics cannot say that CRITICAL closes fast
  // and then stalls, or that LOW never moves at all. `kmPerSev` is that same curve, narrowed
  // by the SAME `shipKM` the overall curve goes through, so the two views of one estimate
  // cannot drift: `kmPerSev[s].median` IS `kmMedianPerSev[s]` by construction.
  //
  // The three flat maps stay. They are what `mttrSeverityRows` reads and what the page's
  // summary table draws, and collapsing them into `kmPerSev` would rewrite a read path for no
  // measured gain. Keys are emitted in `SEVERITY_ORDER` so the client's fan needs no sort.
  const kmMedianPerSev: Record<string, number | null> = {};
  const kmP90PerSev: Record<string, number | null> = {};
  const kmLowerBoundPerSev: Record<string, number | null> = {};
  const kmPerSev: Record<string, ShippedKM> = {};
  {
    const bySev: Record<string, BaseRow[]> = {};
    for (const r of rows) {
      const s = normalizeSeverity(r.severity);
      (bySev[s] ?? (bySev[s] = [])).push(r);
    }
    const seen = Object.keys(bySev);
    const ordered = (SEVERITY_ORDER as readonly string[])
      .filter((s) => seen.indexOf(s) >= 0)
      .concat(seen.filter((s) => (SEVERITY_ORDER as readonly string[]).indexOf(s) < 0));
    for (const s of ordered) {
      const k = kaplanMeier(bySev[s]!);
      kmMedianPerSev[s] = k.median;
      kmLowerBoundPerSev[s] = k.medianLowerBound;
      kmP90PerSev[s] = kmQuantileFromCurve(k.curve, 0.9);
      kmPerSev[s] = shipKM(k);
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
    // WHO THIS PAGE MEASURED OVER, published whether or not anybody was removed — the figure
    // that makes the setting discoverable rather than hidden, and the only way a reader can
    // check a denominator that quietly shrank.
    endOfLife: endOfLifeBlock(cut, n.mttrExcludeEndOfLife),
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
      kmPerSev,
      openPastSla: openPastSla(rows, { slaTargets: n.slaTargets }),
      /**
       * The open backlog as an age DISTRIBUTION, against the per-severity SLA edge.
       *
       * `openPastSla` above it is the same population reduced to one ratio per severity; a
       * ratio cannot say whether the breaches are a week late or a year late, and every
       * surveyed vendor but two compresses age into exactly that percentage. This ships the
       * shape as well, over the SAME `rows` every other block here measures — so the scope,
       * project, severity and no-fix filters apply to it identically.
       *
       * `unaged` is on the wire for the reason `ageBuckets` could not put it there: an open
       * row with no readable `first_seen` is not young, it is undated, and the page prints
       * that count rather than letting the bars quietly cover fewer rows than the hero does.
       */
      aging: agingDistribution(rows, undefined, n.slaTargets),
      /**
       * The SAME open rows, against their OWN deadline instead of the shared 7/30/90 edges:
       * how much of each finding's SLA window it has consumed, in tenths.
       *
       * `aging` above it cannot be this chart. Its bucket edges are fixed while the target
       * varies fivefold across severities, which is exactly why `slaEdge` is per severity
       * and the page draws one hairline only when every severity in scope agrees on it. This
       * normalises by the row's own window instead: every severity shares one axis, and the
       * two populations that have no tenth to plot — past the window, and no window at all —
       * are counted separately rather than folded into a bar.
       *
       * `n.slaTargets` — the EFFECTIVE windows (the shared constant, overridden by whatever
       * this register's operator saved on the Deadlines tab) — is passed in from HERE rather
       * than read inside `insights.ts`, which keeps that function pure over its arguments;
       * the client never receives the table.
       */
      slaConsumed: slaConsumedDeciles(rows, n.slaTargets),
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
        openPastSla: openPastSla(actionableView(scaVisible), { slaTargets: n.slaTargets }),
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
  // "dsMttr1" -> "dsMttr2": the payload gained `remediation.slaConsumed`; a warm dsMttr1
  // entry has none of it, and the section would be missing entirely from a page whose other
  // figures are drawn — a chart absent for a cache reason reads as a register with nothing
  // inside its windows.
  //
  // `slaTargets` JOINS THE KEY (not just `keyOf`'s base four) because this compute reads it —
  // `openPastSla`, `agingDistribution` and `mttrFromLedger`'s `sla_target`/`sla_pct` all take
  // it as an argument below. Without it in the key, an operator saving a new Deadlines window
  // would keep serving the OLD attainment figures for up to `CLOCK_TTL_SEC`, off a cache entry
  // whose params look identical to the one now in effect. `secretsModel`'s own key (below)
  // shows the mirror rule: a param the compute does not read never joins a key either.
  // `mttrExcludeEndOfLife` joins it on the identical argument one clause later: it decides
  // which repositories every figure below is measured over, so an operator flipping it and
  // reloading would otherwise read the OLD half-life off an entry whose params look the same.
  return cached(
    "dsMttr2",
    { ...keyOf(n), slaTargets: n.slaTargets, mttrExcludeEndOfLife: n.mttrExcludeEndOfLife },
    () => buildMttr(n),
    CLOCK_TTL_SEC,
  );
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
  // The one block on this page that is NOT measured at `snap.now`. See `coldZone` below.
  const clock = ledgerClock(n.scope);

  const counts: Record<string, number> = {};
  let open = 0;
  for (const r of rows) {
    if (!isOpen(r.status)) continue;
    open += 1;
    const s = normalizeSeverity(r.severity);
    counts[s] = (counts[s] ?? 0) + 1;
  }

  // THE CUT REACHES THE HALF-LIFE AND NOTHING ELSE ON THIS PAGE, and that asymmetry is the
  // whole care this block needs. `severityCounts`, `tiers`, `movement` and `fixNext` below are
  // counts of what is OPEN, and a retired repository's open findings are real — removing them
  // would shrink the backlog this page reports, which is the one thing the exclusion promises
  // not to do. So it is applied here, to the KM input, and the page says so in one sentence.
  //
  // `total` / `open` / `resolved` / `awaiting` stay over the whole `sub` for the same reason:
  // they are states, not durations.
  const execCut = liveRepoRows(rows, n.mttrExcludeEndOfLife);
  const byScope = (n.scope ? [n.scope] : [...SCOPES]).map((scope) => {
    const sub = rows.filter((r) => r.scope === scope);
    const km = kaplanMeier(execCut.rows.filter((r) => r.scope === scope));
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
    // The half-life half of this payload, and the count of what it left out. Named for the
    // family rather than for the page, because the page draws both kinds of figure.
    endOfLife: endOfLifeBlock(execCut, n.mttrExcludeEndOfLife),
    // The week-over-week half-life delta is a duration, so it is cut like the hero it sits
    // beside — otherwise "half-life down 4 days" could be the exclusion rather than any work.
    weekTrend: weekTrend(
      liveRepoRows(scoped, n.mttrExcludeEndOfLife).rows, n, snap.now,
    ),
    // What to do next, and what the list left out. One call, one pass over the rows the
    // severity tiles already counted, so the ranked figure and the tiles cannot disagree.
    // `slaTargets` is the EFFECTIVE map so tier 2/3's "past SLA" gate — and therefore
    // `unranked.insideSla` — agree with the same windows `mttrModel` measures against.
    fixNext: fixNext(rows, { now: snap.now, slaTargets: n.slaTargets }) as unknown as Rec,
    movement: openMovement(rows, n),
    // The cold-zone HEADLINE — totals, clock and threshold, never the per-repo or per-team
    // arrays (`coldZoneHeadline`'s own "capped in the model, not sliced at the edge" note).
    // The Repositories page draws the tables; this page draws one figure out of the totals.
    //
    // MEASURED AT `ledgerClock(n.scope)`, NOT AT `snap.now`, and that is the whole care this
    // block needs. Every number in it is "how long since something happened": dated by the
    // wall clock it would grow by an hour every time this 1 h cache entry was rebuilt, so a
    // register nobody had synced for a month would drift into the cold zone on its own, with
    // no new observation behind the change. `coldZoneAsOfSource` publishes which clock that
    // was — "wallClock" when there is no scan to date the register from.
    coldZone: coldZoneHeadline(coldZoneProfile(rows, {
      now: clock.asOf,
      observedFrom: clock.observedFrom,
      coldAfterDays: n.coldAfterDays,
      mode: n.coldZoneMode,
      targetSharePct: n.coldTargetSharePct,
      floorDays: n.coldFloorDays,
      excludeEndOfLife: n.coldExcludeEndOfLife,
      newestScanByScope: newestScanByScope(),
    })),
    coldZoneAsOfSource: clock.asOfSource,
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

/** A comparison this register will publish needs at least this much daylight between the two
 *  observations. Under it, two syncs describe the same week and their difference is noise. */
const MOVEMENT_MIN_GAP_DAYS = 7;

/** Days, to one decimal — a gap of 13.5 d is not "14" and not "13". */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The distinct instants a SYNC happened at. One sync writes one `scans` row per scope, so
 *  the scan log holds three rows per run here; the movement compares RUNS, not rows. */
function syncInstants(): { iso: string; ms: number }[] {
  const seen = new Map<number, string>();
  for (const s of loadScanRows()) {
    const ms = parseTs(s.ts);
    if (ms === null) continue;
    if (!seen.has(ms)) seen.set(ms, s.ts);
  }
  return [...seen.entries()]
    .map(([ms, iso]) => ({ ms, iso }))
    .sort((a, b) => a.ms - b.ms);
}

/** Open as of instant `d`: born by then, and not dated closed before it. */
function openAsOf(r: BaseRow, d: number): boolean {
  const first = parseTs(r.first_seen);
  if (first === null || first > d) return false;
  const resolved = parseTs(r.resolved_at);
  return resolved === null || resolved > d;
}

/**
 * Week-over-week movement in the OPEN BACKLOG, per register — and the honest reason when
 * there is none.
 *
 * WHY THIS EXISTS BESIDE `weekTrend`, WHICH ALREADY SAID "MOVEMENT". `weekTrend` compares the
 * Kaplan-Meier half-life now against the half-life a week ago. On a young register that curve
 * never falls to half at either endpoint — measured on the dev seed: 416 of 554 lifecycles
 * still open, `km.median === null`, `medianLowerBound === 293.9 d` — so `kmMedianAsOf` returns
 * null twice, `weekTrend` refuses to substitute a bound for a median, and the aside published
 * "no comparison" forever. That refusal is CORRECT and is not what changed here. What was
 * missing is a movement figure that a censored curve cannot suppress: the open count is
 * observable whether or not half the register has closed.
 *
 * THE TWO ENDPOINTS ARE SYNCS, NOT DATES ON A CALENDAR. A register only learns anything when
 * it looks, so comparing "now" against "seven days ago" would credit the register with changes
 * on days nobody synced. `until` is the newest sync; `since` is the most recent sync at least
 * MOVEMENT_MIN_GAP_DAYS older than it. Under that gap the comparison is refused and the ACTUAL
 * span is published, so a reader learns "this register has only looked twice in three days"
 * rather than "no comparison available".
 *
 * `open` IS THE LIVE COUNT AND `prevOpen` IS A REPLAY, and the two are on the same clock: a
 * finding is only ever dated closed at the scan that stopped seeing it, so replaying at `until`
 * reproduces the live count exactly. `test/movement.test.ts` holds that equality rather than
 * assuming it. Using the live count here is what keeps this block and the severity tiles above
 * it from printing two different open totals.
 */
function openMovement(rows: BaseRow[], n: NormParams): Rec {
  const instants = syncInstants();
  const scopes: Scope[] = n.scope ? [n.scope] : [...SCOPES];
  const until = instants.length ? instants[instants.length - 1]! : null;

  if (until === null) {
    return { comparable: false, reason: "noSync", syncs: 0, since: null, until: null, days: null };
  }
  if (instants.length === 1) {
    return {
      comparable: false, reason: "oneSync", syncs: 1, since: null, until: until.iso, days: null,
    };
  }

  let since: { iso: string; ms: number } | null = null;
  for (let i = instants.length - 2; i >= 0; i -= 1) {
    if ((until.ms - instants[i]!.ms) / DAY_MS >= MOVEMENT_MIN_GAP_DAYS) {
      since = instants[i]!;
      break;
    }
  }
  if (since === null) {
    // The widest span the log can offer, not the nearest gap — it is the most a reader can be
    // told about how long this register has been watching.
    return {
      comparable: false,
      reason: "tooClose",
      syncs: instants.length,
      since: null,
      until: until.iso,
      days: round1((until.ms - instants[0]!.ms) / DAY_MS),
    };
  }

  const perScope: Rec = {};
  let open = 0;
  let prevOpen = 0;
  for (const scope of scopes) {
    const sub = rows.filter((r) => r.scope === scope);
    const nowOpen = sub.filter((r) => isOpen(r.status)).length;
    const thenOpen = sub.filter((r) => openAsOf(r, since!.ms)).length;
    perScope[scope] = { open: nowOpen, prevOpen: thenOpen, delta: nowOpen - thenOpen };
    open += nowOpen;
    prevOpen += thenOpen;
  }

  return {
    comparable: true,
    reason: null,
    syncs: instants.length,
    since: since.iso,
    until: until.iso,
    days: round1((until.ms - since.ms) / DAY_MS),
    perScope,
    total: { open, prevOpen, delta: open - prevOpen },
  };
}

export function executiveModel(p?: ModelParams): Rec {
  const n = norm(p);
  // `slaTargets` joins the key because `fixNext` (inside `buildExecutive`) reads it — see
  // `mttrModel`'s matching comment for why a param the compute reads has to be in the key.
  // `coldAfterDays` joins it beside them on the identical argument, one block later: the
  // cold-zone headline is computed from it, so an operator saving a new window and reloading
  // would otherwise keep reading the OLD cold count for up to `CLOCK_TTL_SEC` off an entry
  // whose params look identical to the one now in force.
  //
  // AND THE THREE RELATIVE-MODE FIELDS JOIN IT FOR THE SAME REASON, IN A FIXED ORDER matching
  // `reposModel`'s. The mode is the sharpest case of the rule: flipping fixed -> relative
  // changes nothing about `coldAfterDays`, so without `coldZoneMode` in the key the params
  // would be byte-identical across a change that moves every verdict in the block. They are
  // keyed in BOTH modes rather than only in the one that reads them, so that a params object
  // never changes SHAPE with the mode — a key that sometimes carries three fewer fields makes
  // "same params" mean two different things.
  return cached(
    "dsExecutive1",
    {
      ...keyOf(n),
      slaTargets: n.slaTargets,
      coldAfterDays: n.coldAfterDays,
      coldZoneMode: n.coldZoneMode,
      coldTargetSharePct: n.coldTargetSharePct,
      coldFloorDays: n.coldFloorDays,
      // BOTH END-OF-LIFE SWITCHES JOIN THE KEY, on this file's standing rule that a param the
      // compute reads has to be in the key. The cold-zone one was missing while its four
      // siblings were present — `settingsStore.saveSettings` bumps the data version, so that
      // was an invariant broken rather than a stale read anyone could observe, but an
      // invariant that is true of four fields out of five is no rule at all for whoever adds
      // the sixth.
      coldExcludeEndOfLife: n.coldExcludeEndOfLife,
      mttrExcludeEndOfLife: n.mttrExcludeEndOfLife,
    },
    () => buildExecutive(n),
    CLOCK_TTL_SEC,
  );
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
  // NO `language` ON EITHER CODE REGISTER, and the two lost it for different reasons.
  //
  // On sca it restated "By repository" one level coarser: a dependency finding's language is a
  // property of the REPOSITORY it sits in, not of the finding, so its four rows (PYTHON 105,
  // GO 70, JAVA 70, JAVASCRIPT 35 on the sample register) are the same 280 findings the
  // repository card already groups.
  //
  // On sast the language IS a fact about the code the weakness is in — this entry used to say
  // so, and say that sast therefore keeps it — but it still names an attribute nobody
  // remediates against, and it sat beside `cwe`, which is the weakness axis a reader acts on.
  // Removed on the same reading, one register later.
  //
  // THIS COPY DOES NOT DECIDE WHAT RENDERS. `concentrationModel(payload, dims)` maps over the
  // dims the PAGE hands it, so removing a name here alone yields a card with zero rows rather
  // than no card; `pages/sca.js` and `pages/sast.js` carry the matching lists and say so.
  //
  // `domain` IS ON ALL THREE, because unlike `language` it is not a restatement of another
  // card: a domain cuts ACROSS the project hierarchy (a domain owns repositories that several
  // projects file, and a project can hold repositories several domains own), and it is the
  // axis a reader escalates along — a project is where Wiz files the work, a domain is who
  // answers for it. It is also the one dimension here that can be empty for a legitimate
  // reason (the join map has never been refreshed), and the card that results says `(none)`
  // for every row rather than disappearing — which is the honest shape, and is why
  // `concentrationModel` keeping zero-row cards is left alone rather than special-cased.
  //
  // `owner_project` IS GONE, REPLACED BY TWO CARDS, and that is the correction this list
  // exists to record. The tenant files every repository under a CS/CE/LU SUPPORT GROUP and
  // under a `product-…` PRODUCT (src/domain/projectGrain.ts), and `owner_project` held
  // whichever of the two Wiz happened to return first — so a single card was ranking products
  // against support groups and calling the mixture "By owning project".
  //
  // BOTH GRAINS ARE LISTED, and neither is a restatement of the other in `language`'s sense.
  // One support group holds MANY products, so the group's total is a roll-up the product card
  // cannot express: the product card names the worst single product, and only the group card
  // can show that three mediocre products under one group add up to the largest backlog
  // anyone owns. It is also the escalation grain — you tell a support group, not a product.
  sca: ["repo", "product", "support_group", "domain"],
  sast: ["repo", "cwe", "product", "support_group", "domain"],
  secrets: ["repo", "secret_kind", "product", "support_group", "domain"],
};

/**
 * The dimensions above, minus the one the ACTIVE SCOPE has already answered.
 *
 * A breakdown by the thing you are standing inside is a single row restating the hero.
 * `scopedRows` filters to one project or one domain, so under a `CS-…` scope "By support
 * group" is one bar reading the register's own open count back; under a `product-…` scope
 * "By product" is; under a domain scope "By business domain" is. All three were drawn, and
 * the card carried a denominator sentence saying "across the 1 group(s) listed" — a section
 * spending a card to tell a reader something they chose.
 *
 * WHICH GRAIN A PROJECT SCOPE ANSWERS IS THE TENANT'S NAMING RULE, not a fact Wiz reports, so
 * the two predicates come from `projectGrain.ts` rather than from a prefix test written here.
 * A project scope that is NEITHER (a business unit, a plain leaf, `GITHUB-…`) drops nothing:
 * it collapses no grain, and guessing that it does would hide a card that still partitions.
 *
 * IT TAKES THE PROJECT'S NAME, NOT ITS SLUG, and that is the whole reason this is a separate
 * parameter rather than `n.project`. The view scope is stored as a SLUG — `projectCatalogue`
 * keys on it because "a display name can be re-typed without the project changing", and
 * `scopeOptions` ships `value: p.slug` while classifying with `projectKind(p)`, which reads
 * `p.name`. Handing `n.project` straight to `isSupportGroup` would therefore ask a naming
 * convention about a machine identity: right whenever a tenant's slug happens to echo its
 * name, and silently a no-op the moment it does not. `scopedProjectName` does the lookup.
 *
 * ONLY THE SCOPED DIMENSION GOES. A one-bucket card is not by itself a reason to drop one —
 * "By business domain" showing a single `(none)` on an untagged register is the one place this
 * register lets unattributed rows be seen as a bucket (see `insights.GROUP_COLUMNS`), and
 * dropping it for thinness would delete that signal rather than a redundancy.
 *
 * A PRODUCT SCOPE KEEPS "By support group", deliberately. A product's repositories may name
 * two different support groups — README's rule is that a summary hiding a disagreement is
 * worse than one reporting it — so that card is only usually one row, and where it is two the
 * reader needs to see it. Where it is genuinely one, it costs a bar; where it is not, it is
 * the disagreement.
 *
 * EXPORTED so the rule can be read back without booting a read model. It is a pure list
 * filter over two name predicates, and every interesting case is a project name — testing it
 * through `registerModel` would mean building a ledger per case to assert a list. One spec
 * below does go the whole way through, so the wiring is pinned too; the rest come here.
 */
export function scopedConcentrationDims(
  dims: string[],
  scope: { projectName: string | null; domain: string | null },
): string[] {
  const answered = new Set<string>();
  if (scope.domain) answered.add("domain");
  if (scope.projectName && isSupportGroup(scope.projectName)) answered.add("support_group");
  if (scope.projectName && isProduct(scope.projectName)) answered.add("product");
  return dims.filter((d) => !answered.has(d));
}

/**
 * The display name of the project a slug scopes to, read back off the rows that carry it.
 *
 * There is no project table to look this up in — `projectCatalogue` derives the switcher's
 * list from `projects_json` on the rows themselves, and this is the same derivation asked for
 * one slug. The first match wins because `parseProjects` already keys on slug, so every
 * occurrence of one slug carries the same name.
 *
 * DELIBERATELY OVER THE WHOLE BASE, not the scoped-and-filtered rows: what grain a scope
 * answers is a fact about the tenant's naming, and it must not change because a reader
 * deselected a severity. Null when nothing carries the slug — a scope on a project this
 * register no longer holds — and null drops nothing, which is the right answer for a scope
 * whose population is empty anyway.
 */
function scopedProjectName(rows: BaseRow[], slug: string): string | null {
  for (const r of rows) {
    for (const p of parseProjects(r.projects_json)) {
      if (p.slug === slug) return p.name;
    }
  }
  return null;
}

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
    // The dimensions are per REGISTER, because `insights.GROUP_COLUMNS` maps to real ledger
    // columns and a dimension the scope never fills would rank one "(none)" bucket. Asking for
    // a name outside that table is silently DROPPED by `concentration`, so the list is spelled
    // from the table rather than from what a page might like to see.
    //
    // …and then per VIEW SCOPE, which is what `scopedConcentrationDims` takes off: the card
    // for the grain the reader is standing inside is one bar restating the hero. The server
    // owns MEMBERSHIP for both reasons; the page owns ORDER (its own dim list). That division
    // is why `concentrationModel` skips a dim this payload does not carry instead of drawing
    // an empty card for it — the two copies no longer have to be edited together.
    concentration: concentration(
      rows as unknown as Rec[],
      scopedConcentrationDims(CONCENTRATION_DIMS[scope], {
        projectName: scoped.project ? scopedProjectName(snap.rows, scoped.project) : null,
        domain: scoped.domain,
      }),
      5,
      scope,
    ),
    tiers: riskTierStats(scopedTierRows(rows), undefined, scope),
    funnel: triageFunnel(rows as never, undefined, new Set<string>(), false, scope, n.slaTargets),
    awaiting: awaitingVendorFix(rows, { scope }),
    latestScan: latest,
    signalCoverage: signalCoverage(rows),

    // WHAT THIS PAGE MEASURED, AND WHAT IT NEVER LOOKED AT. Three things narrow a register
    // before one figure on it is computed: the rows themselves, the severity gate THE LAST
    // SCAN OF THIS SCOPE APPLIED, and the base Wiz filter this scope's query carries. Each
    // makes a count fall, and none can be published as a `0` — the rows they removed were
    // never fetched, so a count there would measure a population nobody looked at.
    //
    // THE GATE COMES OFF THE SCAN ROW, never off `n.severities`. A scan records the gate it
    // APPLIED (runScan's `severities` override), and the two differ across a settings change;
    // stamping today's gate on yesterday's measurement is the same class of error the
    // disappearance guard exists to prevent.
    //
    // `parseSeverities` returns NULL for a gate that covered everything — including the empty
    // string and the full list — and null is what "all severities" is spelled as here. It must
    // not be flattened to `[]`: `secrets` DEFAULTS to an empty gate
    // (DEFAULT_FETCH_SEVERITIES.secrets), so the all-severities case is the live one on a
    // third of this product, not a theoretical edge.
    population: {
      inScope: rows.length,
      gate: latest ? parseSeverities(latest.severities) : null,
      filters: BASE_FILTER_WORDS[scope],
    },
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
    // "dsRegister1" -> "dsRegister2": the payload gained `population` (in-scope count, the
    // gate the last scan applied, the base filter words). A warm dsRegister1 entry carries
    // none of it, and the page would draw no provenance line at all over figures that have
    // one — worse than a stale number, because it is a silently missing caveat.
    // `slaTargets` joins the key because `triageFunnel`'s `overdue` step (inside
    // `buildRegister`) reads it — see `mttrModel`'s matching comment.
    "dsRegister2",
    { ...keyOf(n), scope, slaTargets: n.slaTargets },
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
  /** SECRETS ONLY: credential states to keep (VALID/INVALID/UNKNOWN/ERROR). */
  validation?: unknown;
  /** SECRETS ONLY: detector confidence grades to keep, matched against what the rows carry. */
  confidence?: unknown;
}

export type RowStatusFilter = "all" | "open" | "resolved";

function normRowStatus(v: unknown): RowStatusFilter {
  const s = String(v ?? "").toLowerCase();
  return s === "open" || s === "resolved" ? s : "all";
}

/** The four values `validation_state` can carry, per `domain/secretsLifecycle.ts`. */
const SECRET_VALIDATION_STATES = ["VALID", "INVALID", "UNKNOWN", "ERROR"] as const;

/**
 * A requested filter list, uppercased and de-duplicated, from an array or a comma string.
 *
 * Refuses null/undefined/blank BEFORE any cast — `String(null)` is `"null"`, which would
 * become a filter value matching nothing and narrow a register to zero rows while looking
 * like a measurement.
 */
function normFilterList(v: unknown): string[] {
  const raw: unknown[] = Array.isArray(v)
    ? v
    : typeof v === "string" ? v.split(",") : [];
  const out: string[] = [];
  for (const item of raw) {
    if (item === null || item === undefined) continue;
    const s = String(item).trim().toUpperCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * A row's credential state for filtering: BLANK IS UNKNOWN, not a fourth thing.
 *
 * `secretsLifecycle.ts`'s rule 2 is that UNKNOWN, ERROR, null and blank are all UNMEASURED;
 * the ledger stores whichever of them Wiz sent. A "Never checked" filter that matched only
 * the literal string UNKNOWN would silently drop every row whose column is empty — which on
 * this tenant is most of the register.
 */
function rowValidationState(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "" ? "UNKNOWN" : s;
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
  // SPREAD `n`, not a hand-built literal — the view-project scope (and anything else `norm`
  // ever adds) rides along automatically instead of being a field someone has to remember to
  // repeat. A literal here once meant the header count narrowed while this page's own row
  // list did not; see the file's module header ("THE TRAP").
  const scoped = visibleRows(snap.rows, { ...n, scope, severities });

  const status = normRowStatus(p?.status);
  const byStatus = status === "all"
    ? scoped
    : scoped.filter((r) => isOpen(r.status) === (status === "open"));

  // TWO SECRETS-ONLY FILTERS, APPLIED AFTER THE STATUS ONE — and refused everywhere else the
  // way `severities` is refused HERE. Severity is this register's non-axis (it grades a
  // detection, not whether a credential is live); the axes that answer the question a reader
  // came with are the credential's own state and the detector's confidence, and until now
  // neither could be asked for on the per-finding table.
  //
  // THE CONFIDENCE ALLOW-LIST IS MEASURED, NOT WRITTEN DOWN. `SecretInstanceConfidence` is
  // the tenant's vocabulary, not this app's — the live tenant spells it "High" while the dev
  // fixture spells it "HIGH" — so the accepted values are the DISTINCT VALUES THE SCOPED
  // POPULATION ACTUALLY CARRIES, uppercased. A hard-coded list would refuse a grade this
  // tenant uses, or accept one it does not and quietly return an empty register.
  //
  // AN UNRECOGNISED VALUE FALLS BACK TO NO FILTER rather than to an empty page, matching the
  // `sort` fallback directly above: a hand-edited hash is where these arrive, and answering
  // a typo with "0 findings" states a measurement about a population nobody asked for. The
  // applied lists are echoed back in the payload, so the client can see what actually bit.
  const isSecrets = scope === "secrets";
  const validation = isSecrets
    ? normFilterList(p?.validation)
      .filter((v) => (SECRET_VALIDATION_STATES as readonly string[]).includes(v))
    : [];
  const grades = isSecrets
    ? Array.from(new Set(scoped.map((r) => String(r.confidence ?? "").trim().toUpperCase())))
      .filter((v) => v !== "")
    : [];
  const confidence = isSecrets
    ? normFilterList(p?.confidence).filter((v) => grades.includes(v))
    : [];

  const rows = validation.length || confidence.length
    ? byStatus.filter((r) => {
      if (validation.length && !validation.includes(rowValidationState(r.validation_state))) {
        return false;
      }
      return !confidence.length
        || confidence.includes(String(r.confidence ?? "").trim().toUpperCase());
    })
    : byStatus;

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
    // Null, not [], for "no filter applied" — and null on the two scopes that cannot carry
    // one at all, the same shape `severities` takes above. An empty array would read as a
    // filter that matched nothing.
    validation: validation.length ? validation : null,
    confidence: confidence.length ? confidence : null,
    secretFiltersSupported: isSecrets,
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
/**
 * THIS SYNC'S OWN TWIN FOLD, off the newest per-day history blob — or NOTHING AT ALL.
 *
 * WHERE THE FIGURE ACTUALLY LIVES, and it is not where this register's own comments said it
 * did. `reconcile()` computes `TwinStats` and hands it back; `persistFlatScan` receives it and
 * returns it BESIDE the row it builds; the `ScanRow` it pushes has no `twins` field, and
 * `TAB_HEADERS[TABS.scans]` has no such column — so there has never been a scan row to read it
 * off, and `writeGrid` would have dropped it if there had been. `ledgerStore`'s `twins` is on
 * the transient `ScopeOutcome` handed to the sync's caller and dies with the request. The one
 * DURABLE copy is `scanJobs.ts`'s `dailyStats()`, which puts `twins` into the per-sync stats
 * `historyStore.recordDaily` writes as `history/<YYYY-MM-DD>.json.gz`. That is the grain the
 * figure belongs at anyway: the fold is a property of one reconcile pass, not of a row.
 *
 * REFUSE, NEVER SUBSTITUTE. No entry, a sweep whose newest sync never looked at secrets, or a
 * block that is not a `TwinStats` ships NOTHING — the key is omitted — and never
 * `emptyTwinStats()`. `{keys: 0, folded: 0}` is a MEASUREMENT: it says a sync looked and found
 * no credential reported against both a repository and a branch. The client's `twinFoldView`
 * already tells the two apart ("Twin fold: not measured on this sync" against "0 twins
 * folded"), and `test/wordsOneLevelDown.test.js` pins the distinction with a reproduced
 * cast-first rewrite that reads four of five absent shapes as a measured zero. Sending a zero
 * for an absence walks straight into it.
 *
 * EVERY FIELD IS REFUSED BY TYPE BEFORE ANY CAST, the same rule the client half applies, and
 * all three must be present: `Number(null)` is 0 and finite, so a `keys` of null cast here
 * would arrive on the page as a confident fold of nothing. `medianGapDays` is legitimately
 * `null` whenever nothing folded — that is a real value and it travels — but a MISSING key is
 * a block this app did not write, and a block this app did not write is not a measurement.
 *
 * THE DATE TRAVELS BESIDE THE STATS, BECAUSE A CLOCK HAS TO SAY WHERE IT STARTED
 * (PRODUCT.md's seventh principle). The blob is one file per UTC day, latest write wins, so
 * this is the last sync recorded on the last day anything was recorded — which can be
 * Tuesday's fold read on Friday. `twinsAsOf` is the day that file names, shipped as a SIBLING
 * rather than folded into the block: `twins` has to stay a faithful `TwinStats` of exactly
 * `{keys, folded, medianGapDays}`, because the client's absent-vs-measured-zero decision keys
 * on those three fields and a fourth one in there would be a fourth thing to interpret.
 *
 * THE DAY, NOT THE INSTANT. `dailyStats` also writes an `at` timestamp, and it is tempting to
 * prefer it — but the FILE's grain is the day (a second sync the same day overwrites the
 * first), so a precise time read off it would claim more than the store can keep. The day is
 * what the file name means and the day is what is published.
 *
 * A DATE THAT DID NOT ARRIVE IS NOT TODAY. A malformed or missing date omits `twinsAsOf` and
 * the stats still ship: the fold was measured, only its day is unknown, and the page states
 * the fold without a date rather than substituting one. Same refusal the stats make.
 */
const HISTORY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function latestSecretsTwins(): { twins: Rec; asOf: string | null } | null {
  const entry = latestHistory();
  const stats = entry && entry.stats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;
  const scopes = (stats as Rec)["scopes"];
  if (!Array.isArray(scopes)) return null;
  const block = (scopes as Rec[])
    .find((s) => s && typeof s === "object" && s["scope"] === "secrets");
  const twins = block ? block["twins"] : null;
  if (!twins || typeof twins !== "object" || Array.isArray(twins)) return null;
  const t = twins as Rec;
  const keys = t["keys"];
  const folded = t["folded"];
  if (typeof keys !== "number" || !Number.isFinite(keys)) return null;
  if (typeof folded !== "number" || !Number.isFinite(folded)) return null;
  if (!("medianGapDays" in t)) return null;
  const gap = t["medianGapDays"];
  if (gap !== null && (typeof gap !== "number" || !Number.isFinite(gap))) return null;
  // Refused by type before any cast, like the three above. `listHistory`/`latestHistory`
  // derive the date from the file NAME through the same regex, so a bad one here means the
  // store's own naming contract broke — which is a reason to say nothing about the day, not
  // a reason to invent one.
  const date = entry.date;
  const asOf = typeof date === "string" && HISTORY_DAY_RE.test(date) ? date : null;
  return { twins: { keys, folded, medianGapDays: gap }, asOf };
}

function buildSecrets(n: NormParams): Rec {
  const snap = baseSnapshot();
  // Scope is pinned; severities are deliberately NOT applied. showNoFix cannot bite either —
  // `baseRowNoFix` is false for every non-sca row by construction — but it is honoured for
  // symmetry so the pipeline reads the same everywhere. SPREAD `n` rather than hand-listing
  // its fields, for the same reason `registerRowsModel` does — see that call's comment.
  const rows = visibleRows(snap.rows, { ...n, scope: "secrets", severities: null });
  const secretRows = rows as unknown as SecretRow[];
  // ONE FIGURE ON THIS PAGE IS A DURATION, and it is the only one the exclusion reaches. The
  // coverage, the validity rate, the removal-vs-rotation split and every segment are counts of
  // what the register HOLDS — a leaked credential in a retired repository is still leaked.
  const secretsCut = liveRepoRows(rows, n.mttrExcludeEndOfLife);
  const fold = latestSecretsTwins();

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
    timeToRevoke: timeToRevoke(
      secretsCut.rows as unknown as SecretRow[], { now: snap.now },
    ),
    endOfLife: endOfLifeBlock(secretsCut, n.mttrExcludeEndOfLife),
    removalVsRotation: removalVsRotation(secretRows),
    segments: {
      validation_state: bySegment(secretRows, "validation_state"),
      confidence: bySegment(secretRows, "confidence"),
      secret_kind: bySegment(secretRows, "secret_kind"),
    },
    signalCoverage: signalCoverage(rows),
    // THE FOLD THIS SYNC ACTUALLY DID, AND THE DAY IT WAS MEASURED — or neither key is here.
    // See `latestSecretsTwins` for where the only durable copy lives, why an absence is never
    // a zero, and why the date rides beside the block instead of inside it. SPREAD rather
    // than assigned so a refusal omits the keys entirely: `twins: null` would be a third
    // shape for the client to read where two already say everything it can say, and
    // `twinsAsOf: null` would be a date claim about a fold that has no date.
    ...(fold ? { twins: fold.twins, ...(fold.asOf ? { twinsAsOf: fold.asOf } : {}) } : {}),
  };
}

export function secretsModel(p?: ModelParams): Rec {
  const n = norm(p);
  // The key omits `severities` because the model does. Carrying a param the compute ignores
  // would mint one entry per severity selection, all holding the same bytes.
  return cached(
    "dsSecrets1",
    // `mttrExcludeEndOfLife` is here because `timeToRevoke` reads it; `severities` is not
    // because nothing does. One rule, both directions.
    { scope: "secrets", showNoFix: n.showNoFix, mttrExcludeEndOfLife: n.mttrExcludeEndOfLife },
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
  // TWO POPULATIONS THIS PAGE MAY NOT MEASURE, COMPOSED IN ORDER. Secrets are refused because
  // `program.resolveRule` throws on them; retired repositories are refused because the operator
  // asked. Both are counted and published beside the rates they changed — `excludedSecrets` has
  // always been, and the second one joins it rather than hiding behind it.
  const live = liveRepoRows(visible, n.mttrExcludeEndOfLife);
  const { rows, excludedSecrets } = classifiableRows(live.rows);
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
    endOfLife: endOfLifeBlock(live, n.mttrExcludeEndOfLife),
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
  const { rows } = classifiableRows(
    liveRepoRows(scopedRows(all, n), n.mttrExcludeEndOfLife).rows,
  );
  return loadProgramTrend(undefined, {
    severities: n.severities,
    base: rows,
    ...(n.scope ? { scope: n.scope } : {}),
  });
}

export function programModel(p?: ModelParams): Rec {
  const n = norm(p);
  // "dsProgram1" -> "dsProgram2": `capacity` gained `closedPerMonthMean`. The durable copy
  // has no TTL to age it out, so a shape change has to move the name or the page draws the
  // absent mark beside a live close rate until the next commit rewrites the file.
  return durablyCached(
    "dsProgram2",
    { ...keyOf(n), mttrExcludeEndOfLife: n.mttrExcludeEndOfLife },
    () => buildProgram(n),
  );
}

// --------------------------------------------------------------------------------------- //
//  6. reposModel — durablyCached
// --------------------------------------------------------------------------------------- //

/**
 * The estate: repositories as the asset, and the same measurements rolled up to the product
 * the tenant owns them by.
 *
 * BOTH GRAINS AND BOTH POPULATIONS. `assetProfile` groups on `repo` or on `product`;
 * `assetProfilePopulations` stacks the `all` and `high_risk` cuts.
 *
 * THE LANGUAGE CUT IS GONE FROM THIS PAYLOAD, and the reason is the same one that removed it
 * from both code registers' concentration lists (`CONCENTRATION_DIMS` above): a repository's
 * language is not something anyone remediates against, and grouping by it restated the
 * repository card one level coarser. What replaced it is the grain the tenant actually owns
 * work by — a product — so one table with a repo/product switch says what two tables used to,
 * and says the second half of it usefully. `assets.ts` KEEPS its `language` grouping: brick's
 * fixture pins that shape, and the parity is worth more than the branch costs. "How much does a typical repository carry" and "are we closing high risk faster than
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
    byProduct: assetProfilePopulations(rows, { ...opts, groupBy: "product" }),
    // `visible`, NOT the re-censored `rows` copy: this module never reads `age_days`, so
    // handing it the rewritten rows would only hide which population it actually measured.
    coldZone: coldZoneProfile(visible, {
      now: clock.asOf,
      observedFrom: clock.observedFrom,
      coldAfterDays: n.coldAfterDays,
      mode: n.coldZoneMode,
      targetSharePct: n.coldTargetSharePct,
      floorDays: n.coldFloorDays,
      excludeEndOfLife: n.coldExcludeEndOfLife,
      newestScanByScope: newestScanByScope(),
    }),
    signalCoverage: signalCoverage(visible),
  };
}

export function reposModel(p?: ModelParams): Rec {
  const n = norm(p);
  // "dsRepos1" -> "dsRepos2": the payload gained the `coldZone` block. The durable copy has no
  // TTL to age it out, so a warm dsRepos1 Drive file — which carries no cold zone at all —
  // would serve a Repositories page with its first section missing entirely, and a section
  // absent for a cache reason reads as an estate where nothing has gone quiet.
  //
  // `coldAfterDays` JOINS THE KEY, the same rule `mttrModel` states for `slaTargets`: this
  // compute reads it, and a durable entry keyed without it would keep answering with the
  // previous threshold's verdicts until the next commit rewrote the file.
  //
  // SO DO THE THREE RELATIVE-MODE FIELDS, in this fixed order (mode, target, floor) — the same
  // order `executiveModel` uses, because two key builders that list the same fields differently
  // are two chances to drop one. The durable layer has no TTL at all, so the argument is
  // sharper here than on the 1 h entry: an operator who switches to relative mode and reloads
  // would read the fixed mode's verdicts off a warm Drive file FOREVER, until the next commit
  // happened to rewrite it, if the mode were not in the name.
  //
  // NO NAMESPACE BUMP ("dsRepos2" STAYS) — see this file's caching-audit header for the full
  // argument: new params fields change the sha1 the filename is built from, so no old file is
  // addressable by the new key in the first place.
  return durablyCached(
    "dsRepos2",
    {
      ...keyOf(n),
      coldAfterDays: n.coldAfterDays,
      coldZoneMode: n.coldZoneMode,
      coldTargetSharePct: n.coldTargetSharePct,
      coldFloorDays: n.coldFloorDays,
      // The fifth cold-zone field, which belonged here from the day it shipped — see
      // `executiveModel`'s key for the rule it was one field short of. This page draws no
      // remediation-speed aggregate, so `mttrExcludeEndOfLife` is deliberately NOT here: a
      // param the compute does not read never joins a key either.
      coldExcludeEndOfLife: n.coldExcludeEndOfLife,
    },
    () => buildRepos(n),
  );
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
 *
 * MIXED UNDER THE VIEW-PROJECT SCOPE, AND THE PAYLOAD SAYS SO RATHER THAN PRESENTING ONE
 * POPULATION. `rows` / `kpis` / `trend` come from `visibleRows` / `trendFor`, which run
 * through `scopedRows` and DO narrow to `n.project`. `scans` and `perScope`, though, come off
 * `loadScanRows()` directly — a `ScanRow` is a per-scan BATTERY record (`scan_id, ts, scope,
 * severities, total, ...`) with no project dimension at all, so there is no subtree of it to
 * select. `history` (`listHistory()`) is the same shape of fact: a whole-register snapshot
 * per UTC day, recorded before this package's project scope existed. `scanScopeApplies:
 * false` names exactly which three keys that covers, so a client cannot draw them as if they
 * had narrowed alongside the rest of this payload.
 *
 * `movement` / `movementNote` ARE PER SCOPE AND ALWAYS COVER ALL THREE. See
 * `domain/movementDecomposition.ts` for the arithmetic and `movementPopulation` below for the
 * one filter this block deliberately does NOT inherit from the KPI band.
 */

// The movement window is 28 days wide and BOUNDED BY SCANS OF ONE SCOPE, not by calendar dates
// — see `movementWindowScans` for why, and for why the scope filter is inside it. The COPY
// lives here rather than in the domain: the domain answers with a reason code, and a reason a
// reader can act on is a fact about this page ("run another sync"), not about the arithmetic.
const MOVEMENT_WINDOW_DAYS = 28;

function movementNoteFor(win: MovementWindow): string {
  if (win.reason === "noScans") {
    return "No scans are saved for this register yet — nothing to decompose.";
  }
  if (win.reason === "oneScan") {
    return "One scan only — a movement is a difference between two of them.";
  }
  return `No scan of this register at least ${MOVEMENT_WINDOW_DAYS} days older than its latest`
    + (win.days === null ? "" : ` — its saved scans span ${win.days} days`)
    + ".";
}

/**
 * The population the decomposition replays — the KPI band's, MINUS the severity filter.
 *
 * BOTH VIEW SCOPES and the no-fix toggle DO apply: they narrow which findings are the
 * reader's. The DISPLAY SEVERITY FILTER MUST NOT, and that is the one thing this function
 * exists to say. `outsideGate` counts open rows whose severity the last scan never looked at;
 * running it over a population a display filter had already narrowed to the same severities
 * would report 0 — "nothing was hidden" — exactly when something was, which is the confusion
 * the whole section was built to end.
 */
function movementPopulation(rows: BaseRow[], n: NormParams): MovementRow[] {
  let scoped = rows;
  if (n.project) {
    scoped = scoped.filter((r) => inProject(parseProjects(r.projects_json), n.project!));
  }
  if (n.domain) scoped = scoped.filter((r) => inDomain(r, n.domain!));
  return n.showNoFix ? scoped : scoped.filter((r) => !baseRowNoFix(r));
}

function buildHistory(n: NormParams): Rec {
  const snap = baseSnapshot();
  const clock = ledgerClock(n.scope);
  const scansAll = loadScanRows();
  const scans = (n.scope ? scansAll.filter((s) => s.scope === n.scope) : scansAll)
    .slice()
    .reverse(); // newest first, as the table draws it

  const rows = visibleRows(snap.rows, n);
  const historyCut = liveRepoRows(rows, n.mttrExcludeEndOfLife);

  const movementRows = movementPopulation(snap.rows, n);
  const movement: Rec = {};
  const movementNote: Rec = {};
  for (const scope of SCOPES) {
    const win = movementWindowScans(scansAll, MOVEMENT_WINDOW_DAYS, scope);
    movement[scope] = win.reason === null
      ? movementDecomposition(
        movementRows,
        scansAll,
        { since: win.since, until: win.until },
        scope,
      )
      : null;
    movementNote[scope] = win.reason === null ? null : movementNoteFor(win);
  }

  return {
    asOf: clock.asOf,
    asOfSource: clock.asOfSource,
    observedFrom: clock.observedFrom,
    scope: n.scope,
    severities: n.severities,
    showNoFix: n.showNoFix,
    scans,
    perScope: perScopeScanStats(scansAll),
    // One block per register, ALWAYS all three — a window and a gate are per-scope facts and
    // this page draws the three side by side. Each block is keyed by the scope it measured and
    // `movement[scope].scope` echoes it, so two registers' movement can never be read as one.
    movement,
    movementNote,
    kpis: {
      tracked: rows.length,
      open: rows.filter((r) => isOpen(r.status)).length,
      resolvedAllTime: rows.filter((r) => !isOpen(r.status)).length,
      // THE KM MEDIAN, AND NOTHING BESIDE IT — the comment above this block used to say
      // exactly that while the field below it shipped `medianMttr: overall.mttr_median`, the
      // plain median over resolved rows. The page drew THAT one, captioned with the
      // `half-life` glossary term, which defines a Kaplan-Meier figure that keeps still-open
      // findings as censored evidence. On the dev seed the two disagree by a factor of three:
      // 93 days against the MTTR page's "at least 297 days" over the same population, because
      // the plain median drops the 416 rows that have not closed yet. The naive field is
      // retired rather than left on the wire beside the honest one — a payload key nothing
      // reads is the next reader's trap (CLAUDE.md's "a settings key nothing reads is worse
      // than no key", applied to a payload field) — so `km` is the only median this page can
      // publish, and where the curve never reaches half `medianLowerBound` is what is true.
      // THE ONE SPEED FIGURE ON THIS PAGE, so the one thing the exclusion touches here. The
      // three counts above it are what the register HOLDS and stay whole; this is how long a
      // finding lived, and a repository nobody is meant to remediate has no business in it.
      km: shipKM(kaplanMeier(historyCut.rows)),
    },
    endOfLife: endOfLifeBlock(historyCut, n.mttrExcludeEndOfLife),
    // `mttrPageTrendSlice` reads both of these keys.
    history: listHistory(),
    trend: trendFor(n, snap.rows),
    // See the block comment above: `scans`, `perScope` and `history` are per-scan/per-day
    // facts with no project OR domain dimension and do NOT narrow with either view scope;
    // everything else in this payload does. The note names whichever scope is actually live,
    // because "scoped to the selected project" over a domain scope would be a wrong answer to
    // the only question the note exists to answer.
    scanScopeApplies: false,
    scanScopeNote: n.project || n.domain
      ? "scans, perScope and history describe the whole register — a sync and a "
        + "daily snapshot carry no "
        + (n.project ? "project" : "domain")
        + " dimension to narrow by. Only rows/kpis/trend above are scoped to the selected "
        + (n.project ? "project" : "domain") + "."
      : null,
  };
}

function trendFor(n: NormParams, all: BaseRow[]): Rec[] {
  // PRE-TOGGLE rows on purpose: `loadTrend` excludes no-fix findings AS OF each date, so a
  // finding whose fix landed in March re-enters the series at March. Filtering up front would
  // delete it from the whole history instead.
  // THE LIFECYCLE HAS NO DATE, so unlike the no-fix rule above it cannot be applied as-of each
  // point: the tag says what a repository is NOW, not what it was in March. The exclusion is
  // therefore taken over the whole series — a repository retired today was never in it — and
  // that asymmetry with the line directly above is deliberate rather than an oversight.
  // (`loadTrend` re-projects to seven columns and `_lifecycle` does not survive the projection,
  // so the cut has to be here in any case.)
  return loadTrend({
    severities: n.severities,
    showNoFix: n.showNoFix,
    base: liveRepoRows(scopedRows(all, n), n.mttrExcludeEndOfLife).rows,
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
  // "dsHistory1" -> "dsHistory2": the payload gained `movement` / `movementNote`, one block
  // per register. A warm dsHistory1 entry carries neither, and this page's new section would
  // draw its empty state — "no movement decomposition in this payload" — over a window that is
  // perfectly measurable, for up to a week of durable-store MAX_AGE.
  return durablyCached(
    "dsHistory2",
    { ...keyOf(n), mttrExcludeEndOfLife: n.mttrExcludeEndOfLife },
    () => buildHistory(n),
  );
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
 *
 * TAKES NO PARAMS AT ALL, AND `scopeApplies: false` IS WHY. Every figure here prices sheet /
 * Drive BYTES — an allocated grid, a cell ceiling, a scan count — and a spreadsheet tab has no
 * project column to narrow one row's worth of storage by. The view-project scope genuinely
 * cannot apply here, so the payload says so rather than silently describing the whole
 * register under a chip that would otherwise imply it is scoped like every other page.
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
    scopeApplies: false,
    scopeNote: "Storage prices sheet and Drive bytes for the whole spreadsheet — there is no "
      + "project column on a tab to narrow one row's worth of storage by. These figures always "
      + "describe the whole register, regardless of the view-project scope.",
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
