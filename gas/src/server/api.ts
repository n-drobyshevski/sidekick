// google.script.run API surface. Every endpoint returns {ok, data} | {ok:false,
// error} so the client wrapper promisifies uniformly. Reads never take the script
// lock; mutations run inside withScriptLock + recoverIfNeeded.

import {
  SEVERITY_COLORS,
  SEVERITY_ORDER,
  SELECTABLE_SEVERITIES,
  RESOLVED_STATUSES,
} from "../domain/config";
import { domainNames, validateDomains, compileDomains, assignDomain, assignDomains, hasDomainInputs, UNASSIGNED } from "../domain/domainRules";
import { coverage, ruleHealth, supportGroupBreakdown, unassignedResources, untaggedSubscriptions } from "../domain/attribution";
import { mttrFromLedger, vulnKey } from "../domain/lifecycle";
import type { BaseRow } from "../domain/ledgerCore";
import { extractNodes } from "../domain/transform";
import { overallSlaOldest } from "../domain/metrics";
import { normalizeSeverity } from "../domain/severity";
import {
  actionableView,
  awaitingVendorFix,
  baseRowNoFix,
  isEndOfLifeName,
  kaplanMeier,
  kmQuantileFromCurve,
  mttrPercentiles,
  openPastSla,
  recordEol,
  recordNoFix,
  resolutionBuckets,
} from "../domain/remediation";
import { validateBundle } from "../domain/importMerge";
import { buildMigrationBundle, bundleCounts } from "../domain/exportBundle";
import { SealedScanError, LedgerRebuildError } from "../domain/maintenance";
import { nowIso, parseTs, present, type Rec } from "../domain/util";
import { kmMedianAsOf, kmMedianByGroupTrend, medianMttrByGroupTrend, openByGroupTrend, openBySeverityTrend } from "../domain/trend";
import * as insights from "../domain/insights";
import * as program from "../domain/program";
import {
  execGroupSlice, execMttrSlice, historyTrendSlice, mttrGroupTableSlice, mttrGroupTrendSlice,
  jobSummarySlice, mttrPageTrendSlice, oldestOpenSlice, overviewInsightsSlice,
  programTrendSlice, scanRowsSlice,
} from "../domain/pagePayload";
import * as archive from "./archiveStore";
import * as errorLog from "./errorLog";
import * as findings from "./findings";
import * as history from "./historyStore";
import { activeJob, getJob, isStaleJob, isTerminalPhase, type JobRow } from "./jobsStore";
import { durablyCached, duringWarm, sweepReadModels } from "./readModelStore";
import * as ledgerStore from "./ledgerStore";
import { LedgerBusyError, recoverIfNeeded, withScriptLock } from "./locks";
import { hasWizCredentials } from "./props";
import * as backfillJobs from "./backfillJobs";
import * as purgeJobs from "./purgeJobs";
import * as scanJobs from "./scanJobs";
import { BUILD_ID, cached, dataVersion } from "./serverCache";
import * as settingsStore from "./settingsStore";
import { cellUsage, SCHEMA_VERSION, TAB_HEADERS, TABS } from "./sheetsDb";
import {
  NOT_ATTRIBUTABLE,
  resolveDomainName,
  resolvedDomainNames,
} from "../domain/resolveDomain";
import * as bizDomains from "./bizDomains";
import * as supportGroups from "./supportGroups";

export interface ApiResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  errorKind?: string;
}

function run<T>(fn: () => T, label = "api"): ApiResult<T> {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    const kind =
      e instanceof SealedScanError
        ? "sealed"
        : e instanceof LedgerRebuildError
          ? "rebuild"
          : e instanceof LedgerBusyError
            ? "busy"
            : "error";
    // Capture into the durable recent-errors log so a failure is visible in-app (Settings →
    // Diagnostics), not just the execution transcript. "busy" is skipped — it's the expected
    // "a scan is running, retry" contention signal, not a fault, and would evict real errors.
    if (kind !== "busy") errorLog.recordError(label, e, kind);
    return { ok: false, error: String(e instanceof Error ? e.message : e), errorKind: kind };
  }
}

function mutate<T>(fn: () => T, label = "api"): ApiResult<T> {
  return run(
    () =>
      withScriptLock(() => {
        recoverIfNeeded();
        return fn();
      }),
    label,
  );
}

// ------------------------------------------------------------------------ bootstrap

export function bootstrap(_p?: unknown): ApiResult {
  return run(() => ({
    // The core is a pure function of ledger + settings state — cached per DATA_VERSION.
    // "bootstrapCore" → "bootstrapCore2": counts / unassigned / filterOptions now honor the
    // show-no-fix toggle and settings gained `showNoFix`; params null → {showNoFix} so the
    // on/off states cache separately and no stale old-shape entry survives the deploy.
    // "bootstrapCore2" → "bootstrapCore3": the payload gained `scopeCounts`, which the header's
    // scope switcher reads for its denominator. A cached old-shape entry has none, and the
    // caption would render "undefined of undefined" until the next data version.
    // "bootstrapCore3" → "bootstrapCore4": it gained the business-domain catalogue and its
    // counts, for the switcher's third group, and WIZ_DOMAIN_TAG_KEY joined the params.
    // "bootstrapCore4" → "bootstrapCore5": `domainNames` is now the RESOLVED universe (tag
    // values first) and `scopeCounts` gained `baseRows` / `notAttributable`. A cached
    // old-shape entry would offer only the manual groups in the switcher — the one thing this
    // change exists to fix — and print an undefined second figure in its caption.
    //
    // WIZ_DOMAIN_TAG_KEY HAS LEFT THESE PARAMS, and is not missing: it moved into the GLOBAL
    // cache stamp (`serverCache.domainTagStamp`). It belonged there all along — it changes
    // which tag every row is read from, which now moves the domain split on every cached
    // payload in the app, not just this one — and carrying it here as well would only hash a
    // value the key already carries.
    // "bootstrapCore5" → "bootstrapCore6": the payload SHED its unread fields — `prevCounts`
    // (which cost a Drive fetch, ungzip and parse of the previous scan's entire observation
    // set for six integers nothing rendered), the `statuses`/`assetTypes`/`clouds` filter
    // vocabularies (three O(N) passes over the frame, no reader), `scopeCounts.noBizDomain`
    // (whose own comment admitted as much), `palette.glyphs`/`slaTargets`, and
    // `latestScan.shape`/`severities`. Bump so no stale fat entry survives the persistent
    // dataVersion; a reader that wanted any of them would have been broken already.
    ...(durablyCached("bootstrapCore6", { showNoFix: settingsStore.getShowNoFix() }, bootstrapCore) as Rec),
    // Live per-request fields: never cached (activeJob changes every poll tick).
    hasCredentials: hasWizCredentials(),
    activeJob: activeJobSummary(),
  }));
}

function bootstrapCore(): Rec {
  const scan = findings.currentScan();
  const latest = ledgerStore.latestScanRow();
  const showNoFix = settingsStore.getShowNoFix();
  // When the toggle is off, no-fix findings drop out of the bootstrap counts, the unassigned
  // tally, and the filter-option domains, so the whole payload stays coherent with the
  // filtered views. No-op on the default path.
  const records = scan ? visibleFrame(scan.records) : [];
  const counts: Record<string, number> = {};
  let unassignedCount = 0;
  // What the header's scope switcher counts over. Tallied in the SAME pass as the severity
  // counts above, and over the same `records`, so the caption's denominator is the population
  // the rest of the payload describes rather than a second reading that could disagree with it.
  //
  // `noSupportGroup` is the figure the caption cannot leave off. A support group covering 120
  // of 8,000 findings looks like a small group either way; what tells a reader whether the
  // other 7,880 belong to some other group or to nobody at all is how many carry no group at
  // all — and the support-group tag is optional, so "nobody said" is the common case.
  //
  const domainCounts: Record<string, number> = {};
  const supportGroupCounts: Record<string, number> = {};
  // The `Wiz/Domain` values the register carries, for the switcher's Domains list. Collected
  // rather than configured: the vocabulary is whatever the tenant wrote on its resources, and
  // a list built from anything else would offer slices whose pages render zero.
  const seenTags = new Set<string>();
  let noSupportGroup = 0;
  let noBizDomain = 0;
  for (const r of records) {
    const sev = String(r["_sev"]);
    counts[sev] = (counts[sev] ?? 0) + 1;
    // UNASSIGNED IS A REAL BUCKET AND IS COUNTED LIKE ANY OTHER. `domainNames()` appends it to
    // the configured list, so the switcher offers it as a scope; excluding it here would draw
    // that row as "0 findings" over a bucket that is often the largest one in the register.
    // `unassignedCount` is the same rows counted a second time, for the callers that ask
    // "how much did no rule claim" without scoping to it.
    //
    // `_domain` is already the RESOLVED value here — `findings.currentScan()` writes it tag
    // first — so these counts describe the same buckets every split and chart draws.
    const dom = String(r["_domain"] ?? "");
    if (dom) domainCounts[dom] = (domainCounts[dom] ?? 0) + 1;
    if (dom === UNASSIGNED) unassignedCount += 1;
    const sg = String(r["_supportGroup"] ?? "");
    if (sg) supportGroupCounts[sg] = (supportGroupCounts[sg] ?? 0) + 1;
    else noSupportGroup += 1;
    const bd = String(r["_bizDomain"] ?? "");
    if (bd) seenTags.add(bd);
    else noBizDomain += 1;
  }
  // THE SECOND PASS IS OVER BASE ROWS, AND IT HAS TO BE, for two figures the frame cannot give:
  //
  //   - the not-attributable count. Every open finding in the frame carries a name and a
  //     subscription, so the frame's tally is structurally zero. The population that lands
  //     there is compacted and imported RESOLVED history — base rows only — which is exactly
  //     the MTTR denominator the by-domain charts are built from.
  //   - the tag vocabulary. A domain that stopped appearing in live findings still owns
  //     resolved lifecycles, and the switcher has to offer it or those rows are unreachable.
  //
  // `loadBaseRows()` reads through the same cached state the historical pages use, and this
  // whole function is memoized per data version, so the extra pass costs one traversal.
  const domainItems = settingsStore.getDomains().items;
  const compiled = compileDomains(domainItems);
  const baseRows = ledgerStore.loadBaseRows() as unknown as Rec[];
  bizDomains.attachBizDomains(baseRows);
  let notAttributable = 0;
  for (const r of baseRows) {
    const bd = String(r["_bizDomain"] ?? "");
    if (bd) { seenTags.add(bd); continue; }
    // No tag: `missing` is precisely "no attribution input at all", which is what
    // `resolveDomain` tests next. Asked directly rather than through `resolveDomainName` so
    // the rule engine is not run for an answer that cannot depend on it.
    if (!hasDomainInputs(r)) notAttributable += 1;
  }
  return {
    // The deployed code stamp (esbuild-injected source hash; "dev" locally). Surfaced so an
    // operator can confirm at a glance whether a `clasp push` actually took — the recurring "I
    // deployed the fix but still see the old behaviour" confusion.
    buildId: BUILD_ID,
    palette: {
      order: SEVERITY_ORDER,
      colors: SEVERITY_COLORS,
      selectable: SELECTABLE_SEVERITIES,
    },
    settings: {
      fetchSeverities: settingsStore.getFetchSeverities(),
      displaySeverities: settingsStore.getDisplaySeverities(),
      retentionDays: settingsStore.getRetentionDays(),
      autoCompact: settingsStore.getAutoCompact(),
      showNoFix,
      includeEol: settingsStore.getIncludeEol(),
      domains: settingsStore.getDomains(),
      riskRule: settingsStore.getRiskRule(),
    },
    latestScan: latest
      ? {
          scanId: latest.scan_id,
          ts: latest.ts,
          mode: latest.mode,
          total: latest.total,
        }
      : null,
    counts,
    unassignedCount,
    // THE RESOLVED UNIVERSE, not the rule list. A tag value is a domain a finding can actually
    // land in, so a switcher built from `domainNames(items)` alone would offer only the manual
    // groups and leave every tag-attributed bucket unreachable — the exact failure the tag-first
    // model exists to fix. Order comes from `resolvedDomainNames`: tag values, then rules in
    // priority order, then Unassigned, then Not attributable.
    domainNames: resolvedDomainNames(seenTags, domainNames(domainItems)),
    // The scope switcher's arithmetic, kept apart from `filterOptions.supportGroups` and
    // `domainNames` so the readers that already take those as bare name lists (the domains
    // editor, the switcher's own option builders) keep their shape. `register` is the
    // denominator every caption carries: "1,204" alone cannot tell a small manual group from a
    // small register, and those call for opposite reactions.
    scopeCounts: {
      register: records.length,
      domains: domainCounts,
      supportGroups: supportGroupCounts,
      unassigned: unassignedCount,
      noSupportGroup,
      // Both over base rows, and paired on purpose: "412 not attributable" is unreadable
      // without the population it is 412 of, and that population is not `register`.
      baseRows: baseRows.length,
      notAttributable,
    },
    // Which tag the business domain was read off. Surfaced because the figure beside it is
    // meaningless without it: "82 carry no domain" is a fact about `Wiz/Domain` specifically,
    // and an operator who mistyped WIZ_DOMAIN_TAG_KEY would otherwise read a tenant-wide
    // tagging failure off their own typo.
    domainTagKey: bizDomains.configuredDomainTagKey(),
    filterOptions: scan
      ? {
          subscriptions: findings.distinct(records, "vulnerableAsset.subscriptionName"),
          supportGroups: findings.distinct(records, "_supportGroup"),
        }
      : {
          statuses: [], assetTypes: [], clouds: [], subscriptions: [],
          supportGroups: [],
        },
  };
}

/**
 * A JobRow for the client, plus a server-computed `stale`. The client used to infer "stuck"
 * by comparing `updated_at` against the *browser's* clock, which makes a wedged job look
 * healthy (or a healthy one look wedged) on any machine whose clock is off. Staleness is a
 * property of the job, so the server — which owns both the timestamp and the threshold in
 * jobsStore.isStaleJob — is the one that should decide it.
 */
function jobSummary(job: JobRow | null): Rec | null {
  if (!job) return null;
  return jobSummarySlice(job, !isTerminalPhase(job.phase) && isStaleJob(job));
}

function activeJobSummary(): Rec | null {
  return jobSummary(activeJob());
}


/** A params array field (e.g. the Overview support-group multi-select) as string[]. */
function readStringArray(p: unknown, key: string): string[] {
  const raw = (p as Rec)?.[key];
  return Array.isArray(raw) ? (raw as unknown[]).map(String) : [];
}

/**
 * Support-group predicate combining the global sidebar single-select (`single`) and the
 * page multi-select (`set`) by INTERSECTION: a value must satisfy both filters that are
 * active. Either empty means that filter is inactive (no narrowing).
 */
function supportGroupPredicate(single: string, set: string[]): (v: string) => boolean {
  const keep = set.length ? new Set(set) : null;
  return (v) => (!single || v === single) && (!keep || keep.has(v));
}

function sevCountsOf(rows: Rec[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const sev = String(r["_sev"]);
    out[sev] = (out[sev] ?? 0) + 1;
  }
  return out;
}

// --------------------------------------------------------------------------- insights

/**
 * Everything the insights view needs in one round trip: exploitability summary,
 * risk concentration, aging, movement, top CVEs, and all six breakdown groupings
 * (so the client's grouping switch repaints with zero RPCs). Current-scan blocks
 * read the frame (only it has exploit/exposure fields); aging and movement read
 * the durable ledger.
 */
function insightsData(p?: unknown): Rec {
  const scan = findings.currentScan();
  if (!scan) return { flatScan: false };
  // Global manual-group filter: "" means all of them (no filter). The frame
  // records already carry _domain (findings.currentScan); base rows get it assigned
  // here, mirroring mttrData/baseRowsData. Filter up front and feed the existing
  // aggregations unchanged — no insights.ts signature changes.
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  const sgActive = Boolean(supportGroup) || supportGroupSet.length > 0;
  const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
  let recs = scan.records;
  let base = ledgerStore.loadBaseRows();
  // Base rows carry no _supportGroup / _bizDomain / _domain natively (only asset_name,
  // the subscription columns and tags_json), so attach all three up front —
  // unconditionally, because the oldest-open grouped views rank by them even at the
  // whole-register view. attachSupportGroups resolves _supportGroup from the current map,
  // attachBizDomains reads the domain tag out of tags_json, and _domain is assigned per
  // row like the frame's (findings.currentScan).
  supportGroups.attachSupportGroups(base as unknown as Rec[]);
  bizDomains.attachBizDomains(base as unknown as Rec[]);
  const compiled = compileDomains(settingsStore.getDomains().items);
  for (const r of base as unknown as Rec[]) r["_domain"] = resolveDomainName(r, compiled);
  if (domain || sgActive) {
    if (sgActive) {
      recs = recs.filter((r) => sgMatch(String(r["_supportGroup"] ?? "")));
      base = base.filter((r) => sgMatch(String((r as unknown as Rec)["_supportGroup"] ?? "")));
    }
    if (domain) {
      recs = recs.filter((r) => String(r["_domain"] ?? UNASSIGNED) === domain);
      base = base.filter((r) => String((r as unknown as Rec)["_domain"] ?? UNASSIGNED) === domain);
    }
  }
  const severities = readSeverities(p);
  recs = filterSeverities(recs, severities);
  base = filterSeverities(base as unknown as Rec[], severities) as unknown as typeof base;
  // End-of-life OS toggle: when off, EOL lifecycles drop from BOTH the frame and the base up front
  // — including the base `openTrend` reads unfiltered below — so every block excludes them the same
  // way (EOL is a current-state fact with no as-of dimension, unlike no-fix). No-op when included.
  const includeEol = settingsStore.getIncludeEol();
  recs = filterEolFrame(recs, includeEol);
  base = filterEolBase(base as unknown as Rec[], includeEol) as unknown as typeof base;
  // Global show-no-fix toggle. When off, no-fix findings drop out of the current-scan blocks
  // and the durable-ledger blocks (counts/total/sevStats/exploit + aging/oldest/awaiting/
  // movement). `openTrend` is the exception: it keeps the (EOL-filtered) base and excludes no-fix
  // rows AS OF each historical date (a fixed-later finding re-enters at the point its fix
  // landed), so it reads the {hideNoFix} option instead of a pre-filtered population.
  const showNoFix = settingsStore.getShowNoFix();
  const recsVisible = filterNoFixFrame(recs, showNoFix);
  const baseVisible = filterNoFixBase(base as unknown as Rec[], showNoFix) as unknown as typeof base;
  const latestFlat = ledgerStore.latestFlatScanRow();
  return {
    flatScan: true,
    domain,
    supportGroup,
    scan: { scanId: scan.scanId, ts: scan.ts, total: scan.total },
    // Domain-scoped severity counts + total so the Overview headline can stay
    // coherent under a filter (the KPI band otherwise reads whole-scan bootstrap
    // counts). Movement's new/resolved/reopened remain chain-wide — see below.
    counts: sevCountsOf(recsVisible),
    total: recsVisible.length,
    // Per-severity total/open/resolved for the severity breakdown card.
    sevStats: insights.severityStats(recsVisible),
    // Open findings per severity over time — powers the breakdown line chart. Uses the
    // UNFILTERED base + severities and the as-of no-fix exclusion, so the series matches the
    // counts shown beside it while letting a fixed-later finding re-enter at the right date.
    openTrend: openBySeverityTrend(
      ledgerStore.loadScanRows() as unknown as Rec[],
      base as unknown as Rec[],
      severities,
      { hideNoFix: !showNoFix },
    ),
    exploit: insights.exploitSummary(recsVisible),
    // Open findings awaiting a vendor fix (no patch available yet) over the same scoped base
    // rows — sourced here so the Overview can explain the post-rollout open-count step-up.
    // (Naturally zero when the toggle hides them, so the client drops the surface entirely.)
    awaiting: awaitingVendorFix(baseVisible),
    aging: insights.ageBuckets(baseVisible),
    // Oldest open findings + 90+ backlog per asset / support group / domain, for the aging
    // panel's toggle. Capped at 100 (up from the old top-7) so the client can page through the
    // aged tail with prev/next controls — the whole set ships once and repaints client-side,
    // no per-page RPC. The panel triages the oldest backlog, so 100 rows is ample depth.
    oldest: insights.oldestOpen(
      baseVisible as unknown as Parameters<typeof insights.oldestOpen>[0],
      100,
    ),
    // Movement's Persisting is filtered (it's derived from these base rows); New/Resolved/
    // Reopened come from scan-wide reconcile deltas and stay scan-wide (see movement()).
    movement: insights.movement(baseVisible, latestFlat, ledgerStore.loadScanRows().length),
  };
}

// 1h TTL like the MTTR summary: aging carries wall-clock-relative day counts. Keyed on
// domain so per-chain payloads don't clobber each other. Extracted so warmReadModels and the
// getInsights endpoint share one cache entry.
const cachedInsightsData = (p?: unknown) =>
  cached(
    // "insights" → "insights2": the payload now honors the show-no-fix toggle (counts,
    // total, sevStats, exploit, aging, oldest, awaiting, movement, and the as-of openTrend
    // all reflect it); key gains showNoFix so on/off states don't share an entry.
    // "insights2" → "insights3": `oldest.*` now carries up to 100 rows (was 7) for the aging
    // panel's prev/next pagination; bump so stale 7-row entries can't survive the deploy.
    "insights3",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      supportGroups: readStringArray(p, "supportGroups"),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => insightsData(p),
    3600,
  );

export function getInsights(p?: unknown): ApiResult {
  return run(() => overviewInsightsSlice(cachedInsightsData(p)));
}

/** One oldest-open view, for the aging drawer. Reads the SAME cached entry `getInsights` does,
 *  so opening the drawer is a slice of a warm payload rather than a second `baseVisible`
 *  rebuild — and `insights.oldestOpen(baseVisible, 100)` stays exactly as it is, still computed
 *  and still cached, just no longer shipped to every reader who never opens the drawer.
 *
 *  `view` is applied AFTER the cache read and is deliberately not part of any key: all four
 *  views live in one entry, so the second and third toggles cost a slice, not a compute. */
export function getOldestOpen(p?: unknown): ApiResult {
  return run(() => oldestOpenSlice(cachedInsightsData(p), String((p as Rec)?.["view"] ?? "")));
}

// ------------------------------------------------------------------------- grouping

/**
 * Frame records for the current scan, scoped to a domain and/or Support Group(s).
 *
 * `_domain` is already RESOLVED on every frame record (findings.currentScan writes it tag
 * first), so this is a filter and never a join — and a `Wiz/Domain` tag value selects here
 * exactly as a manual group does, because by this point they are the same field.
 */
function scopedFrameRecords(
  domain: string, supportGroup: string, supportGroupSet: string[],
): Rec[] {
  const scan = findings.currentScan();
  if (!scan) return [];
  let recs = scan.records;
  if (supportGroup || supportGroupSet.length) {
    const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
    recs = recs.filter((r) => sgMatch(String(r["_supportGroup"] ?? "")));
  }
  if (domain) recs = recs.filter((r) => String(r["_domain"] ?? UNASSIGNED) === domain);
  return visibleFrame(recs);
}

/** The multi-level breakdown tree for an ordered list of grouping dimensions. */
function groupingData(p?: unknown): Rec {
  const scan = findings.currentScan();
  if (!scan) return { flatScan: false, keys: [], groups: [] };
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  const raw = (p as Rec)?.["keys"];
  const keys = (Array.isArray(raw) ? (raw as unknown[]).map(String) : [])
    .filter((k) => k in insights.GROUP_COLUMNS);
  return {
    flatScan: true,
    keys,
    groups: insights.groupTree(
      filterSeverities(
        scopedFrameRecords(domain, supportGroup, supportGroupSet), readSeverities(p)),
      keys),
  };
}

// Extracted so warmReadModels and the getGrouping endpoint share one cache entry.
const cachedGroupingData = (p?: unknown) => {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  const raw = (p as Rec)?.["keys"];
  const keys = Array.isArray(raw) ? (raw as unknown[]).map(String) : [];
  // "grouping" → "grouping2": the breakdown tree is built over scopedFrameRecords, which
  // now honors the show-no-fix toggle; key gains showNoFix so on/off states cache apart.
  return cached("grouping2",
    {
      domain, supportGroup, supportGroups: supportGroupSet, keys,
      severities: readSeverities(p), showNoFix: settingsStore.getShowNoFix(),
    },
    () => groupingData(p), 3600);
};

export function getGrouping(p?: unknown): ApiResult {
  return run(() => cachedGroupingData(p));
}

// ------------------------------------------------------------------- group trend

/**
 * Open findings over scan history for the top-level breakdown groups — the durable-ledger
 * counterpart of the current-scan `groupingData` tree, powering the Breakdown
 * group-evolution line chart. Scopes the base rows to the same header scope
 * (mirroring `insightsData`), then replays the ledger per flat scan.
 *
 * `key` is the top-level grouping dimension; `groups` are the canonical top-N group names
 * the client already derived from the grouping payload, so pie and line bucket/color the
 * same groups. A dimension with no ledger column — `os`, absent from `GROUP_BASE_FIELDS`
 * — returns `supported: false`; the UI shows an honest empty state and still draws the
 * pie from the grouping payload.
 */
function groupTrendData(p?: unknown): Rec {
  const key = String((p as Rec)?.["key"] ?? "");
  const groups = readStringArray(p, "groups");
  const field = insights.GROUP_BASE_FIELDS[key];
  const scan = findings.currentScan();
  if (!field || !scan) return { supported: false, key, groups: [], points: [] };

  // Same base-row scoping as insightsData: base rows carry no _supportGroup / _domain
  // natively, so attach both up front, then apply the domain / support-group filters.
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  const sgActive = Boolean(supportGroup) || supportGroupSet.length > 0;
  const sgMatch = supportGroupPredicate(supportGroup, supportGroupSet);
  let base = ledgerStore.loadBaseRows() as unknown as Rec[];
  supportGroups.attachSupportGroups(base);
  bizDomains.attachBizDomains(base);
  const compiled = compileDomains(settingsStore.getDomains().items);
  for (const r of base) r["_domain"] = resolveDomainName(r, compiled);
  if (sgActive) base = base.filter((r) => sgMatch(String(r["_supportGroup"] ?? "")));
  if (domain) base = base.filter((r) => String(r["_domain"] ?? UNASSIGNED) === domain);

  // Base stays unfiltered here — the as-of {hideNoFix} exclusion re-admits a fixed-later
  // finding at the point its fix landed, matching the openTrend series in insightsData.
  const points = openByGroupTrend(
    ledgerStore.loadScanRows() as unknown as Rec[],
    base,
    (r) => String(r[field] ?? ""),
    groups,
    { severities: readSeverities(p), hideNoFix: !settingsStore.getShowNoFix() },
  );
  return { supported: true, key, groups, points };
}

export function getGroupTrend(p?: unknown): ApiResult {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const supportGroupSet = readStringArray(p, "supportGroups");
  return run(() =>
    // "groupTrend" → "groupTrend2": the open-by-group series now excludes no-fix findings
    // as-of-date when the toggle is off; key gains showNoFix so on/off states cache apart.
    cached("groupTrend2",
      {
        domain, supportGroup, supportGroups: supportGroupSet,
        key: String((p as Rec)?.["key"] ?? ""),
        groups: readStringArray(p, "groups"),
        severities: readSeverities(p),
        showNoFix: settingsStore.getShowNoFix(),
      },
      () => groupTrendData(p), 3600),
  );
}

// --------------------------------------------------------------------- attribution

/**
 * Everything the "Attribution" page needs in one round trip: coverage KPIs, per-rule
 * fired/matched health, the full (unpaginated) unassigned-resource explorer rows,
 * untagged-subscription rollups, and whether the support-group map is configured.
 * Deliberately ignores the global Value-Chain / Support-group filters — the page
 * audits the mapping itself, not a filtered view of it.
 */
function attributionData(p?: unknown): Rec {
  const scan = findings.currentScan();
  if (!scan) return { flatScan: false };
  const recs = visibleFrame(filterSeverities(scan.records, readSeverities(p)));
  const dom = settingsStore.getDomains();
  const compiled = compileDomains(dom.items);
  const sgMap = settingsStore.getSupportGroupMap();
  const sgKeys = Object.keys(sgMap.map);
  // Distinct groups the persisted map can resolve TO — surfaced so an operator can tell an
  // empty/unrefreshed map (keys 0) apart from a populated one that simply isn't joining the
  // findings' subscription identity (keys > 0 but every finding still resolves to "(none)").
  const sgMapGroups = new Set(Object.values(sgMap.map)).size;
  // The universe the coverage table enumerates, over the same frame it counts. Tag values come
  // from the frame rather than from a configured list because there is no configured list: the
  // vocabulary is whatever the tenant wrote on its resources.
  const seenTags = new Set<string>();
  for (const r of recs) {
    const t = String(r["_bizDomain"] ?? "");
    if (t) seenTags.add(t);
  }
  return {
    flatScan: true,
    scan: { scanId: scan.scanId, ts: scan.ts },
    coverage: coverage(recs, resolvedDomainNames(seenTags, domainNames(dom.items))),
    ruleHealth: ruleHealth(recs, compiled),
    unassignedAll: unassignedResources(recs, compiled),
    // Findings split by resolved support group — the support-group coverage table + the
    // resolved/unresolved headline the page needs to troubleshoot the join.
    supportGroups: supportGroupBreakdown(recs),
    untagged: untaggedSubscriptions(recs).slice(0, 200),
    supportGroupMap: {
      configured: sgKeys.length > 0,
      keys: sgKeys.length,
      groups: sgMapGroups,
      tagKey: supportGroups.configuredTagKey(),
      // A sample of the identity tokens the map is actually indexed under (folded, as the
      // join compares them) — the concrete map side of the join, to eyeball against the
      // subscription id / ext id / name the findings carry when nothing resolves.
      sampleKeys: sgKeys.slice(0, 12),
    },
  };
}

/** Attribution page in one round trip; the whole payload is cached per DATA_VERSION +
 *  severities, and `unassignedAll` is paginated OUTSIDE the cache so every page shares
 *  one cached compute. */
// The whole attribution payload cached per DATA_VERSION + (severities, showNoFix). Extracted
// so warmReadModels and the endpoint share one entry; pagination happens OUTSIDE the cache in
// getAttribution, so every page reuses this one compute.
const cachedAttributionData = (p?: unknown) =>
  // "attribution" → "attribution2": coverage / rule-health / unassigned now honor the
  // show-no-fix toggle; key gains showNoFix so on/off states cache apart.
  // "attribution2" → "attribution3": payload gained the support-group breakdown
  // (`supportGroups`) and richer `supportGroupMap` (groups + tagKey); bump so a stale
  // old-shape entry can't survive the persistent dataVersion.
  // "attribution3" → "attribution4": `supportGroupMap` gained `sampleKeys` (indexed
  // subscription identities); bump so a stale sampleKeys-less entry can't survive.
  // "attribution4" → "attribution5": `coverage` gained `bySource` and the domain is now
  // resolved tag-first, so both the per-domain rows and the KPIs mean something different. An
  // old-shape entry would render the by-source strip as four blanks and split by rules only.
  durablyCached(
    "attribution5",
    { severities: readSeverities(p), showNoFix: settingsStore.getShowNoFix() },
    () => attributionData(p),
  );

export function getAttribution(p?: unknown): ApiResult {
  return run(() => {
    const data = cachedAttributionData(p);
    if (!(data as Rec)["flatScan"]) return data;
    const { unassignedAll, ...rest } = data as Rec & { unassignedAll: unknown[] };
    const params = (p ?? {}) as Rec;
    const pageSize = Math.min(Math.max(Number(params["pageSize"] ?? 50), 1), 200);
    const pageCount = Math.max(1, Math.ceil(unassignedAll.length / pageSize));
    const page = Math.min(Math.max(Number(params["page"] ?? 0), 0), pageCount - 1);
    return {
      ...rest,
      unassigned: {
        rows: unassignedAll.slice(page * pageSize, (page + 1) * pageSize),
        total: unassignedAll.length,
        page,
        pageCount,
      },
    };
  });
}

// ----------------------------------------------------------------------------- MTTR

// The severity subset the MTTR page (or any caller) restricts to; null/absent means
// every severity. Read once, keyed on identically, and applied identically everywhere.
function readSeverities(p?: unknown): string[] | null {
  const raw = (p as Rec)?.["severities"];
  return Array.isArray(raw) ? (raw as unknown[]).map(String) : null;
}

// Restrict ledger rows to the chosen severities (+ UNKNOWN, never hidden) — mirrors the
// trend path (trendFromFrames) so the summary, by-domain split, and trend all filter the
// same way. A null list means "all severities" and skips the filter entirely.
function filterSeverities(rows: Rec[], severities: string[] | null): Rec[] {
  if (severities === null || !rows.length) return rows;
  const keep = new Set([...severities, "UNKNOWN"]);
  return rows.filter((r) => keep.has(normalizeSeverity(r["severity"])));
}

// The global "show findings without a vendor fix" toggle, applied at every finding-derived
// choke point. Both are HARD no-ops when showNoFix is true (the default) — the read happens
// once per data function via settingsStore.getShowNoFix(), and when off the no-fix rows
// (baseRowNoFix / recordNoFix — resolved rows and legacy pre-rollout rows never qualify)
// drop out of the population before any aggregation runs.
function filterNoFixBase(rows: Rec[], showNoFix: boolean): Rec[] {
  if (showNoFix || !rows.length) return rows;
  return rows.filter((r) => !baseRowNoFix(r as unknown as BaseRow));
}
function filterNoFixFrame(records: Rec[], showNoFix: boolean): Rec[] {
  if (showNoFix || !records.length) return records;
  return records.filter((r) => !recordNoFix(r));
}

// The global "include end-of-life OS findings" toggle, the EOL sibling of the no-fix filter above.
// An EOL finding is one Wiz flags (isOperatingSystemEndOfLife) OR its per-host EOL-OS notice, whose
// vulnerability name — not a CVE — identifies it (recordEol / isEndOfLifeName). That flag lives only
// on the current-scan frame, never on the durable ledger, so the two choke points differ: frame
// records apply recordEol directly, while base rows filter by BOTH their `cve` (= the finding name,
// so the notice matches everywhere, even resolved history) AND a join on the set of vuln_keys the
// frame currently marks EOL (so a flagged CVE on an EOL host drops too). Both are HARD no-ops when
// includeEol is true (the default). Excluding EOL drops the lifecycle from analysis entirely — an
// EOL OS can't be remediated by patching the finding, so it would otherwise sit open forever,
// skewing MTTR/SLA.
function eolVulnKeys(): Set<string> {
  const keys = cached("eolKeys", {}, (): string[] => {
    const scan = findings.currentScan();
    if (!scan) return [];
    const out: string[] = [];
    for (const r of scan.records as Rec[]) {
      if (recordEol(r)) out.push(vulnKey(r));
    }
    return out;
  });
  return new Set(keys);
}
function filterEolBase(rows: Rec[], includeEol: boolean): Rec[] {
  if (includeEol || !rows.length) return rows;
  const keys = eolVulnKeys();
  return rows.filter(
    (r) => !(keys.has(String(r["vuln_key"] ?? "")) || isEndOfLifeName(r["cve"])),
  );
}
function filterEolFrame(records: Rec[], includeEol: boolean): Rec[] {
  if (includeEol || !records.length) return records;
  return records.filter((r) => !recordEol(r));
}

// Both display filters (no vendor fix + end-of-life OS) at once, for the frame and base-row surfaces.
// Every finding-derived data function funnels its population through these so the two toggles apply
// uniformly and no site can drift by honoring only one. Settings are read here (memoized per
// execution); a toggle change bumps DATA_VERSION, so all cached payloads recompute against it.
function visibleFrame(records: Rec[]): Rec[] {
  return filterEolFrame(
    filterNoFixFrame(records, settingsStore.getShowNoFix()),
    settingsStore.getIncludeEol(),
  );
}
function visibleBase(rows: Rec[]): Rec[] {
  return filterEolBase(
    filterNoFixBase(rows, settingsStore.getShowNoFix()),
    settingsStore.getIncludeEol(),
  );
}

// The durable base rows narrowed to the active domain / support group
// scope — the shared preamble both the MTTR summary and the MTTR trend key their populations
// off, so the hero and the charts beneath it always measure the same findings. The joins run
// only when a scope is active (otherwise the whole base passes through untouched), matching the
// old inline scoping. Severity / no-fix filtering stays with each caller, which apply their own.
//
// A base row carries no `_supportGroup` or `_bizDomain` natively — only `tags_json` and its
// subscription columns — so both are attached here rather than assumed, which is the one way
// this differs from scopedFrameRecords above.
function scopedBaseRows(domain: string, supportGroup: string): Rec[] {
  let rows = ledgerStore.loadBaseRows() as unknown as Rec[];
  if (domain || supportGroup) {
    supportGroups.attachSupportGroups(rows);
    if (supportGroup) rows = rows.filter((r) => String(r["_supportGroup"] ?? "") === supportGroup);
    if (domain) {
      // Resolved, not rule-assigned: the scope has to name the same buckets the splits do, or
      // picking a tag-derived domain would filter to nothing.
      const compiled = compileDomains(settingsStore.getDomains().items);
      bizDomains.attachBizDomains(rows);
      rows = rows.filter((r) => resolveDomainName(r, compiled) === domain);
    }
  }
  return rows;
}

function mttrData(p?: unknown): Rec {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  let rows = scopedBaseRows(domain, supportGroup);
  rows = filterSeverities(rows, readSeverities(p));
  // Global show-no-fix toggle: drop awaiting-vendor-fix rows so the whole remediation block
  // (percentiles, buckets, KM, open-past-SLA, awaiting) measures only the fixable population.
  // No-op on the default path.
  rows = visibleBase(rows);
  const { perSev, overall } = mttrFromLedger(rows);
  const { slaPct, oldestDays } = overallSlaOldest(perSev);
  // Remediation-tail block over the same scoped rows (BaseRows cast to Rec by loadBaseRows;
  // cast back for the typed remediation projection).
  const remRows = rows as unknown as BaseRow[];
  // Per-severity Kaplan–Meier median + p90 (still-open findings censored) so the per-severity
  // table shows the same censoring-aware clock as the hero, not the naive closed-only stats
  // that bias low on a wave of fresh open findings. Both read off one KM curve per severity.
  // Keyed by normalized severity to line up with `perSev` (UNKNOWN included). Grouped over the
  // same from-detection rows as the overall `km` below.
  const kmMedianPerSev: Record<string, number | null> = {};
  const kmP90PerSev: Record<string, number | null> = {};
  {
    const bySev: Record<string, BaseRow[]> = {};
    for (const r of remRows) {
      const s = normalizeSeverity((r as unknown as Rec)["severity"]);
      (bySev[s] ?? (bySev[s] = [])).push(r);
    }
    for (const [s, rs] of Object.entries(bySev)) {
      const k = kaplanMeier(rs);
      kmMedianPerSev[s] = k.median;
      kmP90PerSev[s] = kmQuantileFromCurve(k.curve, 0.9);
    }
  }
  // Full Kaplan–Meier estimate (curve + KM median/RMST mean + naive comparison stats), open
  // findings right-censored so the headline isn't biased low by fresh fast patches.
  const kmFull = kaplanMeier(remRows);
  // THE CURVE IS THE PAYLOAD, so it ships two of its four fields. `KMPoint` carries
  // `{t, s, atRisk, events}` — the risk set and event count at each step, which the estimator
  // needs to BUILD the curve and which `test/remediation.test.ts` pins on it — but the only
  // reader downstream is the survival chart, and `charts.js` plots `t` against `s`. One point
  // per distinct resolution time means the register decides the array's length, so halving a
  // point's width is a saving that grows with the ledger. Narrowed here rather than in
  // `KMPoint`: this is a transfer concern, and the domain type is right as it stands.
  const km = { ...kmFull, curve: kmFull.curve.map((p) => ({ t: p.t, s: p.s })) };
  const remediation = {
    pctiles: mttrPercentiles(remRows),
    buckets: resolutionBuckets(remRows),
    km,
    // Overall censoring-aware KM p90 off that same curve (smallest t with S(t) ≤ 0.10) — the
    // slow-tail sibling of the KM median that replaces the naive `pctiles.overall.p90` in the
    // KPI band. Null (renders "—") when too much is still open to observe it.
    kmP90: kmQuantileFromCurve(kmFull.curve, 0.9),
    kmMedianPerSev,
    kmP90PerSev,
    openPastSla: openPastSla(remRows),
    // Actionable-clock companion (clock starts at vendor-fix availability): the same function
    // over the actionableView projection. Awaiting-vendor-fix rows carry null actionable
    // fields, so they drop out of it while staying in `awaiting`.
    //
    // ITS KM ESTIMATE USED TO SIT BESIDE IT and had no reader anywhere — a second complete
    // `KMResult`, curve included, built by a second `kaplanMeier` over a second
    // `actionableView` pass, serialized on every MTTR and Executive load. The actionable
    // CLOCK is read (`mttr.js` draws `openPastSlaActionable` in the KPI band and the
    // per-severity table); only its survival estimate never was. Removing it is compute as
    // well as transfer.
    openPastSlaActionable: openPastSla(actionableView(remRows)),
    awaiting: awaitingVendorFix(remRows),
  };
  return { perSev, overall, slaPct, oldestDays, rowCount: rows.length, remediation };
}

// ------------------------------------------------------- program performance (P2P)

/**
 * Remediation coverage / efficiency / capacity over the same scoped population every other
 * page measures — scopedBaseRows -> filterSeverities -> visibleBase, in that order, so the
 * Domain / Support group / severity scope and both global toggles apply identically.
 *
 * The show-no-fix and end-of-life toggles move these denominators materially (a finding with
 * no vendor fix cannot be remediated, so excluding it changes what "should have been fixed"
 * means), which is why the payload reports which toggles were in force and the page names
 * them in its methodology block rather than leaving the reader to guess.
 */
function programData(p?: unknown): Rec {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const rule = settingsStore.getRiskRule().rule;
  let rows = scopedBaseRows(domain, supportGroup);
  rows = filterSeverities(rows, readSeverities(p));
  rows = visibleBase(rows);
  const riskRows = rows as unknown as program.RiskRow[];
  const { perSev, overall } = program.confusionBySeverity(riskRows, rule);
  const capacityRows = rows as unknown as (program.RiskRow & {
    first_seen: string | null;
    resolved_at: string | null;
  })[];
  const scans = ledgerStore.loadScanRows() as unknown as Rec[];
  return {
    rule,
    ruleSentence: program.ruleSentence(rule),
    matrix: overall,
    perSev,
    signals: program.signalBreakdown(riskRows, rule),
    sensitivity: program.ruleSensitivity(riskRows, rule),
    // Whole-register capacity and the high-risk-only cut: P2P v3's net remediation capacity
    // is specifically about the high-risk population, but the overall close rate is the
    // figure the 1-in-10 benchmark refers to, so the page shows both.
    capacity: program.capacityByMonth(capacityRows, scans, { rule, maxMonths: 24 }),
    capacityHighRisk: program.capacityByMonth(capacityRows, scans, {
      rule,
      highRiskOnly: true,
      maxMonths: 24,
    }),
    observationDays: program.observationWindowDays(rows as unknown as BaseRow[]),
    rowCount: rows.length,
    // Named so the methodology block can state what was excluded before any of this counted.
    toggles: {
      showNoFix: settingsStore.getShowNoFix(),
      includeEol: settingsStore.getIncludeEol(),
    },
  };
}

function programTrendData(p?: unknown): Rec {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const rule = settingsStore.getRiskRule().rule;
  const rows = visibleBase(
    filterSeverities(scopedBaseRows(domain, supportGroup), readSeverities(p)),
  ) as unknown as BaseRow[];
  return { trend: ledgerStore.loadProgramTrend(rule, readSeverities(p), rows) };
}

function mttrTrendData(p?: unknown): Rec {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const severities = readSeverities(p);
  const scoped = Boolean(domain || supportGroup);
  // Scope the reconstructed trend to the active domain + Support group by handing the
  // pre-filtered base rows to loadTrend (the scans backbone stays whole). Under a scope the
  // persisted mttr_history snapshots — always whole-register — no longer describe the shown
  // population, so drop them; the reconstructed trend stands on its own (the client already
  // suppresses the history-based change chips whenever a scope is active).
  // EOL toggle: drop end-of-life lifecycles from the trend's base up front (no-fix stays as-of via
  // loadTrend below). A whole-register history snapshot can't be EOL-filtered, so when EOL is
  // excluded the snapshots no longer describe the shown population — drop them like a scope does.
  const includeEol = settingsStore.getIncludeEol();
  const rows = filterEolBase(
    scopedBaseRows(domain, supportGroup) as unknown as Rec[],
    includeEol,
  ) as unknown as BaseRow[];
  return {
    history: scoped || !includeEol ? [] : history.loadHistory(),
    // showNoFix off → the open / KM-median series exclude no-fix findings as-of-date; the
    // resolved / median / SLA-burn / attainment series are untouched (see loadTrend).
    trend: ledgerStore.loadTrend(severities, settingsStore.getShowNoFix(), rows),
  };
}

// The "(none)" bucket label for rows the support-group map can't resolve — one bucket so an
// unattributed tail doesn't fragment the split.
const NONE_SUPPORT_GROUP = "(none)";

// Shared per-group remediation rows + trend for the MTTR breakdown, used by both the by-domain
// and by-support-group variants. `rows` must already carry the grouping key at `keyField`
// (e.g. "_domain" / "_supportGroup"); `orderedNames` fixes the table order (names with no rows
// are skipped). Each row is keyed by a generic `group` label; the trend is the canonical
// top-5-by-resolved (median + KM) over the same population. Reuses mttrFromLedger /
// overallSlaOldest / kaplanMeier, so no domain-layer change.
function remediationGroups(
  rows: Rec[],
  keyField: string,
  orderedNames: string[],
  scanRows: Rec[],
): { rows: Rec[]; trend: { groups: string[]; points: unknown; kmPoints: unknown } } {
  const buckets = new Map<string, Rec[]>();
  for (const r of rows) {
    const name = String(r[keyField] ?? "");
    let arr = buckets.get(name);
    if (!arr) buckets.set(name, (arr = []));
    arr.push(r);
  }
  const out: Rec[] = [];
  for (const name of orderedNames) {
    const drows = buckets.get(name);
    if (!drows || !drows.length) continue;
    const { perSev, overall } = mttrFromLedger(drows);
    const { slaPct } = overallSlaOldest(perSev);
    const rem = drows as unknown as BaseRow[];
    const km = kaplanMeier(rem);
    out.push({
      group: name,
      median: overall.mttr_median ?? null,
      // Censoring-aware KM p90 (open findings right-censored), the slow-tail sibling of the KM
      // median below — read off the same survival curve (smallest t with S(t) ≤ 0.10) so the
      // tail isn't biased low by the fast-patched vulns that close first, the way a closed-only
      // percentile would be. Null (renders "—") when too much is still open to observe it.
      p90: kmQuantileFromCurve(km.curve, 0.9),
      // Censoring-aware KM median (open findings right-censored) — the column that replaces
      // the old "Excl. fast lane" tail median.
      kmMedian: km.median,
      slaPct,
      // Actionable-clock open-past-SLA (measured from vendor-fix availability, awaiting
      // rows excluded) — the same basis the hero and severity table now use.
      openPastSla: openPastSla(actionableView(rem)).overall,
      // Open findings in this bucket still awaiting a vendor fix — surfaced as a footnote
      // under the table, not a column.
      awaiting: awaitingVendorFix(rem).overall,
      open: overall.open ?? 0,
      resolved: overall.resolved ?? 0,
    });
  }
  // Trend shares the exact scoped population and the canonical group order the table just
  // built — the groups that actually carry resolved work, capped at 5 (the categorical palette
  // size, charts.js CATEGORICAL), the rest folds to "Other".
  const groups = out
    .filter((r) => (r["resolved"] as number) > 0)
    .sort((a, b) => (b["resolved"] as number) - (a["resolved"] as number))
    .slice(0, 5)
    .map((r) => String(r["group"]));
  const keyOf = (r: Rec) => String(r[keyField] ?? "");
  const points = medianMttrByGroupTrend(scanRows, rows, keyOf, groups, { severities: null });
  // KM-median series (open findings right-censored) — the chart's default clock; the naive
  // `points` above is kept only as the toggle's comparison. Same scoped rows, same canonical
  // groups/keyOf, so KM and naive line up point-for-point.
  const kmPoints = kmMedianByGroupTrend(scanRows, rows, keyOf, groups, { severities: null });
  return { rows: out, trend: { groups, points, kmPoints } };
}

// Per-domain remediation summary for the "By domain" section shown at the unscoped
// (aggregate) view — this splits the same ledger base rows the MTTR hero uses by their
// resolved domain. Tag values first, then the manual groups in priority order, then Unassigned
// and Not attributable; empty buckets omitted.
function mttrByDomainData(p?: unknown): Rec {
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  let rows = filterSeverities(
    ledgerStore.loadBaseRows() as unknown as Rec[],
    readSeverities(p),
  );
  // Same show-no-fix toggle as mttrData, so the by-domain split matches the hero.
  rows = visibleBase(rows);
  supportGroups.attachSupportGroups(rows);
  if (supportGroup) rows = rows.filter((r) => String(r["_supportGroup"] ?? "") === supportGroup);
  // THE INPUT-LESS ROWS ARE NO LONGER DROPPED. They used to be filtered out here behind a
  // footnote, because counting them as Unassigned "would swamp the breakdown with a giant fake
  // Unassigned domain that has no counterpart on the live Attribution page". `resolveDomain`
  // gives them a name of their own instead — Not attributable — which answers that objection
  // better than the drop did: Unassigned goes back to meaning only the actionable population,
  // and a reader can see how much history the register cannot speak for rather than having to
  // read a footnote about what is missing from the total.
  bizDomains.attachBizDomains(rows);
  const items = settingsStore.getDomains().items;
  const compiled = compileDomains(items);
  const seenTags = new Set<string>();
  for (const r of rows) {
    r["_domain"] = resolveDomainName(r, compiled);
    const tag = String(r["_bizDomain"] ?? "");
    if (tag) seenTags.add(tag);
  }
  const scanRows = ledgerStore.loadScanRows() as unknown as Rec[];
  const { rows: out, trend } = remediationGroups(
    rows, "_domain", resolvedDomainNames(seenTags, domainNames(items)), scanRows,
  );
  // Keep `domain` alongside the generic `group` label so the Executive page (reads r.domain)
  // and any older client stay byte-compatible.
  for (const r of out) r["domain"] = r["group"];
  return { dimension: "domain", rows: out, trend };
}

// Per-support-group remediation for the "By support group" section shown when a single Value
// Chain is selected — the by-domain split would be one row then, so this splits that domain's
// scoped base rows by their attached `_supportGroup` instead. Same row/trend shape as
// mttrByDomainData so the client renders it identically (relabelled). Groups with no rows are
// omitted; the unresolved tail folds into one "(none)" bucket. When support groups aren't
// configured, attachSupportGroups is inert so everything lands in "(none)" (one group) and the
// client hides the section — nothing to split by.
function mttrBySupportGroupData(p?: unknown): Rec {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  let rows = filterSeverities(
    ledgerStore.loadBaseRows() as unknown as Rec[],
    readSeverities(p),
  );
  rows = visibleBase(rows);
  supportGroups.attachSupportGroups(rows);
  // Scope to the selected domain (resolve, keep the matching rows) so the split shows the
  // support groups WITHIN it — mirroring how the hero is scoped.
  const compiled = compileDomains(settingsStore.getDomains().items);
  if (domain) {
    bizDomains.attachBizDomains(rows);
    rows = rows.filter((r) => resolveDomainName(r, compiled) === domain);
  }
  // A header support-group scope narrows to that one group (the split then collapses to a
  // single row and the client hides it) — applied so the population matches the hero.
  if (supportGroup) rows = rows.filter((r) => String(r["_supportGroup"] ?? "") === supportGroup);
  for (const r of rows) r["_supportGroup"] = String(r["_supportGroup"] ?? "") || NONE_SUPPORT_GROUP;
  // Order the table by bucket size (largest support group first), "(none)" always last.
  const sizes = new Map<string, number>();
  for (const r of rows) {
    const g = String(r["_supportGroup"]);
    sizes.set(g, (sizes.get(g) ?? 0) + 1);
  }
  const orderedNames = [...sizes.keys()].sort((a, b) => {
    if (a === NONE_SUPPORT_GROUP) return 1;
    if (b === NONE_SUPPORT_GROUP) return -1;
    return (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0);
  });
  const scanRows = ledgerStore.loadScanRows() as unknown as Rec[];
  const { rows: out, trend } = remediationGroups(rows, "_supportGroup", orderedNames, scanRows);
  return { dimension: "supportGroup", rows: out, trend };
}

// Cached per DATA_VERSION, keyed on exactly the params each computation reads — so
// the single and batched endpoints share entries regardless of extra params.
// The MTTR summary carries wall-clock-relative open ages (p50/p90/oldest), so its
// TTL is 1h — a ≤0.04-day drift — instead of the 6h the version-keyed data allows.
const cachedMttrData = (p?: unknown) =>
  cached(
    // "mttr" → "mttr2": payload gained the `remediation` block; dataVersion persists across
    // deploys, so bumping the namespace prevents serving a stale old-shape entry (up to 1h).
    // "mttr2" → "mttr3": remediation gained the actionable-clock keys (kmMedianActionable,
    // openPastSlaActionable, awaiting); same reasoning — bump so no stale entry lacks them.
    // "mttr3" → "mttr4": fast-lane machinery removed; remediation now carries the full KM
    // estimate (km / kmActionable) and dropped fastLane / scalar kmMedian; bump so no stale
    // old-shape entry survives the persistent dataVersion.
    // "mttr4" → "mttr5": the remediation block now honors the show-no-fix toggle (awaiting
    // rows dropped when off); key gains showNoFix so on/off states don't share an entry.
    // "mttr5" → "mttr6": remediation gained `kmMedianPerSev` (per-severity KM median for the
    // per-severity table); bump so no stale entry lacks it.
    // "mttr7" → "mttr8": remediation DROPPED `kmActionable` (a full second KMResult with no
    // reader in the client) and `km.curve` points lost `atRisk`/`events` (the survival chart
    // plots only `t` and `s`). A stale entry is not merely fatter — it is a different shape —
    // so bump rather than let one survive the persistent dataVersion.
    // "mttr6" → "mttr7": remediation gained the censoring-aware KM p90 — `kmP90` (overall, for
    // the KPI band) and `kmP90PerSev` (per-severity table) — replacing the naive `pctiles` p90
    // at those call sites; bump so no stale entry lacks them.
    "mttr8",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => mttrData(p),
    3600,
  );
const cachedMttrTrendData = (p?: unknown) =>
  // "mttrTrend" → "mttrTrend2": trend points gained `open_past_sla`; namespace bump avoids a
  // stale old-shape entry surviving the deploy under the persistent dataVersion.
  // "mttrTrend2" → "mttrTrend3": trend points gained the backlog-flow series (sla_net /
  // sla_entered / sla_cleared, sla_attainment_pct) and open_past_sla switched to the
  // actionable clock; bump so a stale old-shape entry can't survive the persistent dataVersion.
  // "mttrTrend3" → "mttrTrend4": the tail-median series (tail_median_days) became the KM-median
  // series (km_median_days) and the fast-lane window left the key; bump so no stale entry
  // survives.
  // "mttrTrend4" → "mttrTrend5": the open / KM-median series now exclude no-fix findings
  // as-of-date when the toggle is off; key gains showNoFix so on/off states cache apart.
  // "mttrTrend5" → "mttrTrend6": the reconstructed trend now scopes to the active domain /
  // Support group (was always whole-register); key gains domain + supportGroup so scopes cache
  // apart.
  durablyCached(
    "mttrTrend6",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => mttrTrendData(p),
  );
// Domain-independent (always all domains); severity-scoped; 1h TTL like the summary
// (carries open ages).
// Program performance. Keyed on the risk rule's VERSION token rather than the rule itself:
// the payload is a pure function of the rule, and the version bumps on every save (see
// settingsLogic.withRiskRule), so the token is sufficient and keeps the key short — the same
// trick the domains blob uses. 1h TTL like the MTTR summary: the capacity months are
// wall-clock relative.
const cachedProgramData = (p?: unknown) =>
  cached(
    "program1",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
      includeEol: settingsStore.getIncludeEol(),
      riskRuleVersion: settingsStore.getRiskRule().version,
    },
    () => programData(p),
    3600,
  );
const cachedProgramTrendData = (p?: unknown) =>
  durablyCached(
    "programTrend1",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
      includeEol: settingsStore.getIncludeEol(),
      riskRuleVersion: settingsStore.getRiskRule().version,
    },
    () => programTrendData(p),
  );
const cachedMttrByDomainData = (p?: unknown) =>
  cached(
    // "mttrByDomain" → "mttrByDomain2": payload shape changed (added p90/tailMedian/
    // openPastSla, dropped tracked/oldestDays); dataVersion persists across deploys, so
    // bumping the namespace prevents serving a stale old-shape entry.
    // "mttrByDomain2" → "mttrByDomain3": payload gained `trend` (median-MTTR-by-domain
    // lines); same reasoning — bump the namespace so a stale trend-less entry can't survive.
    // "mttrByDomain3" → "mttrByDomain4": trend gained `tailPoints` (fast-lane-excluded
    // medians for the chart's Median / Excl. fast lane toggle).
    // "mttrByDomain4" → "mttrByDomain5": rows gained `tailResolved` (the toggle now also
    // drives the Remediation-share pie).
    // "mttrByDomain5" → "mttrByDomain6": rows gained `awaiting` and switched `openPastSla`
    // to the actionable-clock view; bump so a stale from-detection entry can't survive.
    // "mttrByDomain6" → "mttrByDomain7": fast-lane machinery removed — rows' `tailMedian` /
    // `tailResolved` became a single `kmMedian`, `trend` lost `tailPoints`, the payload
    // dropped `thresholdDays`, and the fast-lane window left the key; bump so no stale
    // old-shape entry survives.
    // "mttrByDomain7" → "mttrByDomain8": the per-domain split now honors the show-no-fix
    // toggle (awaiting rows dropped when off); key gains showNoFix so on/off states cache apart.
    // "mttrByDomain8" → "mttrByDomain9": `trend` gained the KM-median-by-domain series
    // (`kmPoints`) that the chart now defaults to; bump so a stale kmPoints-less entry can't
    // survive the persistent dataVersion.
    // "mttrByDomain9" → "mttrByDomain10": rows/trend now exclude rows with no domain inputs
    // (unattributable compacted/imported resolved history) and the payload gained `excluded`;
    // bump so no stale old-shape entry survives the persistent dataVersion.
    // "mttrByDomain10" → "mttrByDomain11": `p90` switched from the naive closed-only percentile
    // to the censoring-aware KM p90 (off the same survival curve as the KM median); same shape,
    // new value, so bump the namespace to retire stale naive-p90 entries.
    // "mttrByDomain11" → "mttrByDomain12": the colored-group cap dropped from 8 to 5 (matching the
    // new categorical palette), so `trend.groups`/`points`/`kmPoints` now carry fewer groups and a
    // larger pooled "Other"; bump so a stale 8-group entry can't survive the persistent dataVersion.
    // "mttrByDomain12" → "mttrByDomain13": rows gained a generic `group` label + the payload a
    // `dimension` tag (shared with the by-support-group split); bump so no stale entry lacks them.
    // "mttrByDomain13" → "mttrByDomain14": the domain is now RESOLVED tag-first, the
    // input-less rows are a `Not attributable` bucket instead of an exclusion, and the payload
    // dropped `excluded`. Every row's group label can change, so a stale entry is not merely
    // incomplete — it is a different split. Bump.
    //
    // The key still omits `bizDomain`, and that is now correct rather than a defect: it used to
    // be one, because `mttrByDomainData` filtered on a param the key never carried, so a scoped
    // payload could be served from another scope's entry. That dimension is gone. `domain` is
    // omitted for a different reason and it is NOT a repeat of that bug: both callers route a
    // domain scope to `cachedMttrBySupportGroupData` instead (getMttrPage, getExecutivePage), so
    // this entry is only ever reached with `domain === ""` and cannot be read at another. The
    // `supportGroup` it DOES read is in the key.
    "mttrByDomain14",
    {
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => mttrByDomainData(p),
    3600,
  );

// The by-support-group split shown when a domain is selected — domain-scoped (keyed on
// domain, unlike the by-domain split), 1h TTL like the summary (carries open ages).
const cachedMttrBySupportGroupData = (p?: unknown) =>
  cached(
    // "mttrBySupportGroup1" → "mttrBySupportGroup2": the payload dropped its always-zero
    // `excluded` block and the `domain` scope now resolves tag-first, so the rows a domain
    // scope selects can differ. Bump so no stale entry survives the persistent dataVersion.
    "mttrBySupportGroup2",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => mttrBySupportGroupData(p),
    3600,
  );

export function getMttr(p?: unknown): ApiResult {
  return run(() => cachedMttrData(p));
}

/** The Scan History page's trend series, and its only caller — the MTTR page reads its own
 *  copy through `getMttrPage`. Projected to the five fields these two charts draw, and without
 *  `history`: that array is the whole `mttr_history` tab, and this page never touches it. */
export function getMttrTrend(p?: unknown): ApiResult {
  return run(() => historyTrendSlice(cachedMttrTrendData(p)));
}

/** MTTR page in one round trip (summary + trends share one state load). The breakdown section
 *  adapts to the scope: at the whole-chain view it's the per-domain split; when a single Value
 *  Chain is selected the by-domain split would be one row, so it becomes the per-support-group
 *  split within that domain. Both carry a `dimension` tag so the client relabels accordingly. */
export function getMttrPage(p?: unknown): ApiResult {
  const domain = String((p as Rec)?.["domain"] ?? "");
  return run(() => ({
    // THE SUMMARY IS NOT MISSING — it is the other RPC's job. `mttr.js` already fires
    // `api_getMttr` with identical params, and both endpoints resolve the SAME
    // `cachedMttrData` entry, so returning it here too shipped it twice per page load: 9,372
    // bytes on the seeded estate, two Kaplan-Meier curves included. On a cold cache it was
    // worse than duplicate transfer — the two RPCs are separate GAS executions, so both
    // computed it. The page composes the two payloads instead; see `mttrPaintPlan`.
    trends: mttrPageTrendSlice(cachedMttrTrendData(p)),
    byDomain: mttrGroupTableSlice(
      domain ? cachedMttrBySupportGroupData(p) : cachedMttrByDomainData(p),
    ),
  }));
}

/** The by-group drawer's trend series, fetched when it opens. Repeats getMttrPage's dimension
 *  switch verbatim — it has to, both because the switch reads `domain` and because the params
 *  must match key-for-key to hit the entry that page already warmed. Deliberately NOT folded
 *  into `getGroupTrend`, which serves Overview's breakdown and is a different series. */
export function getMttrByDomainTrend(p?: unknown): ApiResult {
  const domain = String((p as Rec)?.["domain"] ?? "");
  return run(() => mttrGroupTrendSlice(
    domain ? cachedMttrBySupportGroupData(p) : cachedMttrByDomainData(p),
  ));
}

/** Kick off the risk-signal backfill (recovers exploit intelligence from scan archives). */
export function startRiskBackfill(_p?: unknown): ApiResult {
  return mutate(() => backfillJobs.startBackfill());
}

/** Backfill progress / last report, for the Settings panel and the page's honesty note. */
export function getRiskBackfillStatus(_p?: unknown): ApiResult {
  return run(() => ({ backfill: backfillJobs.backfillStatus() }));
}

/** Program performance page in one round trip (matrix + capacity + the trend series). */
export function getProgramPage(p?: unknown): ApiResult {
  return run(() => ({
    program: cachedProgramData(p),
    // Four fields of twelve: the coverage/efficiency pair the two lines are drawn from. The
    // rest is the shared `TrendPoint` base plus the high-risk decorator, none of it read here,
    // multiplied by a backbone that carries one point per day of pre-scan history.
    trends: programTrendSlice(cachedProgramTrendData(p)),
  }));
}

/**
 * The findings behind one cell of the confusion matrix — the drill-down that makes the
 * numbers checkable rather than merely stated.
 *
 * Deliberately NOT built on getFindings: that reads the current-scan frame, and the two
 * cells a reader most wants to interrogate (TP and FP — what we remediated) consist largely
 * of findings that are no longer in any frame, including everything resolved by
 * disappearance. So this reads the durable base, the same population the matrix counted.
 *
 * `quadrant` is one of tp / fp / fn / tn / unknownRemediated / unknownOpen; anything else
 * returns the empty cohort rather than silently falling back to "everything".
 */
export function getRiskCohort(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const quadrant = String(params["quadrant"] ?? "");
    const rows = cachedRiskCohortRows(p, quadrant);
    const page = Math.max(0, Number(params["page"] ?? 0));
    const pageSize = Math.min(500, Math.max(1, Number(params["pageSize"] ?? 100)));
    const start = page * pageSize;
    return {
      quadrant,
      total: rows.length,
      page,
      pageCount: Math.ceil(rows.length / pageSize),
      rows: rows.slice(start, start + pageSize),
    };
  });
}

/** CSV of every classified row — the audit artifact. Carries the raw signals AND the derived
 *  verdict, so a reader can recompute the whole page in a spreadsheet and check it against
 *  what the UI claims. Optionally scoped to one matrix cell via `quadrant`. */
export function getExportCoverageCsv(p?: unknown): ApiResult {
  return run(() => {
    const quadrant = String((p as Rec)?.["quadrant"] ?? "");
    // Uncached on purpose, unlike the drill-down's read above. An export is a deliberate
    // one-shot over the whole cohort; letting it populate and evict cache entries would have it
    // compete for a shared budget with the interactive read-models, to save a pass nobody
    // repeats.
    const rows = riskCohortRows(p, quadrant);
    const cols = [
      "vuln_key", "cve", "severity", "status", "first_seen", "resolved_at", "resolution_src",
      "has_kev", "has_exploit", "epss", "risk_observed_at", "risk_class", "fired_signals",
      "matrix_cell",
    ];
    const lines = [cols.join(",")];
    for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
    // `content` + CRLF matches getExportCsv, so the client's download path is identical.
    return {
      content: lines.join("\r\n"),
      filename:
        "wiz-coverage-" + (quadrant || "all") + "-" + nowIso().slice(0, 10) + ".csv",
      rows: rows.length,
    };
  });
}

/** Shared population for the cohort drill-down and the CSV: scoped base rows, each tagged
 *  with its risk class, the clauses that fired, and its matrix cell. */
/**
 * The classified cohort, cached, with pagination applied OUTSIDE it.
 *
 * This was the only page endpoint in the file with no cache at all, and it is the one where
 * that hurts most: `riskCohortRows` runs `scopedBaseRows` + `filterSeverities` + `visibleBase`
 * + a per-row `classifyRisk` and `firedSignals` over the ENTIRE scoped base, and then the
 * endpoint throws all but one 100-row page away. Every Next click in the matrix drill-down
 * re-did the whole pass.
 *
 * The shape is `getAttribution`'s (see its `unassignedAll` slice): cache the full set, slice
 * per request. `page`/`pageSize` are deliberately NOT in the key — paging must not multiply the
 * entries — while `quadrant` is, because it selects which rows exist. `riskRuleVersion` joins
 * for the reason `program1` carries it: the rule decides every row's class, so a changed rule
 * is a different cohort. 1h TTL, matching its siblings.
 */
const cachedRiskCohortRows = (p: unknown, quadrant: string): Rec[] =>
  cached(
    "riskCohort1",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      quadrant,
      showNoFix: settingsStore.getShowNoFix(),
      riskRuleVersion: settingsStore.getRiskRule().version,
    },
    () => riskCohortRows(p, quadrant),
    3600,
  );

function riskCohortRows(p: unknown, quadrant: string): Rec[] {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const rule = settingsStore.getRiskRule().rule;
  const rows = visibleBase(
    filterSeverities(scopedBaseRows(domain, supportGroup), readSeverities(p)),
  );
  const out: Rec[] = [];
  for (const r of rows) {
    const riskRow = r as unknown as program.RiskRow;
    const cls = program.classifyRisk(riskRow, rule);
    const open = !RESOLVED_STATUSES.has(String(r["status"] ?? "").toUpperCase());
    const cell =
      cls === "unknown"
        ? open ? "unknownOpen" : "unknownRemediated"
        : cls === "high"
          ? open ? "fn" : "tp"
          : open ? "tn" : "fp";
    if (quadrant && cell !== quadrant) continue;
    out.push({
      vuln_key: r["vuln_key"],
      cve: r["cve"],
      severity: r["severity"],
      status: r["status"],
      first_seen: r["first_seen"],
      resolved_at: r["resolved_at"],
      resolution_src: r["resolution_src"],
      asset_name: r["asset_name"],
      has_kev: r["has_kev"],
      has_exploit: r["has_exploit"],
      epss: r["epss"],
      risk_observed_at: r["risk_observed_at"],
      risk_class: cls,
      fired_signals: program.firedSignals(riskRow, rule).join(" "),
      matrix_cell: cell,
    });
  }
  return out;
}

/** Executive landing page in one round trip — the lean sibling of getMttrPage. The exec
 *  view paints only the KM-median hero (`mttr`) and the per-domain split (`byDomain`); it
 *  never reads the trend series, so this endpoint deliberately omits `cachedMttrTrendData`
 *  — the heaviest read-model (full history backbone + per-point KM curves + SLA-burn +
 *  cohort attainment). Skipping it keeps the default landing page's cold path off that
 *  reconstruction entirely. The remediation slices come from the *same* `cached()` entries
 *  the MTTR page uses, AT WHATEVER SCOPE IS IN FORCE — so exec→MTTR navigation at one scope
 *  still lands warm, and the only difference is which slices this round trip computes.
 *
 *  `severityCounts` is the one slice with no MTTR-page counterpart. The exec tiles used to
 *  read bootstrap's register-wide tally, which is exactly what kept this page from honoring
 *  the header scope at all: a scoped hero over unscoped tiles is not a smaller truth, it is
 *  two populations on one screen with nothing distinguishing them.
 *
 *  EVERY SLICE IS PROJECTED BEFORE IT LEAVES (src/domain/pagePayload.ts). Sharing MTTR's
 *  cache entries is what this endpoint is for, but it used to ship them whole: measured on the
 *  seeded estate, 8,716 of 13,068 bytes were serialized and sent on the default landing page
 *  without anything reading them — most of it two Kaplan-Meier curves and a per-group trend
 *  series with no chart under it. The projections run on the CACHED value, so every entry and
 *  every warm hand-off to the MTTR page survives untouched; what goes is the transfer, which
 *  is paid on every load rather than once per scope. */
// Days the executive MTTR badge looks back — "last week".
const WEEK_MS = 7 * 86_400_000;

// Week-over-week KM-median delta for the executive hero badge: the KM median now vs the KM median
// as of ~7 days ago, both over the same scoped + severity population via the ledger's as-of
// estimator (the one the MTTR trend line replays). Severity-scoped, so it stays honest under a
// display-severity filter — unlike the whole-register mttr_history snapshots the MTTR page can only
// chip at the unscoped view, and KM-consistent with the hero value (mttr_history only ever held the
// naive median). Returns null (→ no badge) when the register has under a week of history or either
// endpoint's median is unobservable under censoring.
function executiveWeekTrend(p?: unknown): Rec | null {
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const severities = readSeverities(p);
  const hideNoFix = !settingsStore.getShowNoFix();
  // EOL exclusion applies to both endpoints of the delta (drop those lifecycles up front); no-fix
  // stays as-of inside kmMedianAsOf via hideNoFix.
  const base = filterEolBase(scopedBaseRows(domain, supportGroup), settingsStore.getIncludeEol());
  if (!base.length) return null;
  // Need at least a week of history to have something to compare against.
  let earliest = Infinity;
  for (const r of base) {
    const f = parseTs(r["first_seen"]);
    if (f !== null && f < earliest) earliest = f;
  }
  const now = Date.now();
  const weekAgo = now - WEEK_MS;
  if (!Number.isFinite(earliest) || earliest > weekAgo) return null;
  const current = kmMedianAsOf(base, severities, now, { hideNoFix });
  const previous = kmMedianAsOf(base, severities, weekAgo, { hideNoFix });
  if (current === null || previous === null) return null;
  return {
    current,
    previous,
    deltaDays: Math.round((current - previous) * 1000) / 1000,
    days: 7,
  };
}

const cachedExecutiveWeekTrend = (p?: unknown) =>
  cached(
    "execWeekTrend",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => executiveWeekTrend(p),
    3600,
  );

// Open findings by severity for the executive tiles, over the CURRENT SCAN and narrowed to the
// active scope. This slice exists because the tiles used to read bootstrap's `counts`, which is
// register-wide by construction — so a scoped Executive would have shown a domain's KM median
// directly above the whole register's open counts, with nothing on screen saying the two measure
// different populations. `scopedFrameRecords` already applies `visibleFrame` (the show-no-fix and
// EOL toggles), so the tiles cannot drift from the hero beside them.
//
// `supportGroupSet` is [] on purpose: the header switcher sets one scope at a time and never a
// multi-group list, so the single `supportGroup` param is the whole story here.
function executiveSeverityCounts(p?: unknown): Rec {
  const scan = findings.currentScan();
  if (!scan) return { flatScan: false, counts: {}, total: 0 };
  const domain = String((p as Rec)?.["domain"] ?? "");
  const supportGroup = String((p as Rec)?.["supportGroup"] ?? "");
  const recs = filterSeverities(
    scopedFrameRecords(domain, supportGroup, []),
    readSeverities(p),
  );
  return { flatScan: true, counts: sevCountsOf(recs), total: recs.length };
}

// A new namespace rather than a bump of an existing one — nothing served this shape before, so
// no stale entry can survive. `includeEol` is absent from the key for the same reason it is
// absent from "mttr7" and "mttrByDomain14": setIncludeEol goes through mutate(), which bumps
// DATA_VERSION, and the version is already part of every key. Leave the asymmetry with
// `showNoFix` alone — that one is carried for symmetry with its siblings, not because it must be.
const cachedExecutiveSeverityCounts = (p?: unknown) =>
  cached(
    "execSevCounts1",
    {
      domain: String((p as Rec)?.["domain"] ?? ""),
      supportGroup: String((p as Rec)?.["supportGroup"] ?? ""),
      severities: readSeverities(p),
      showNoFix: settingsStore.getShowNoFix(),
    },
    () => executiveSeverityCounts(p),
    3600,
  );

export function getExecutivePage(p?: unknown): ApiResult {
  const domain = String((p as Rec)?.["domain"] ?? "");
  return run(() => ({
    mttr: execMttrSlice(cachedMttrData(p)),
    // The same dimension switch getMttrPage makes: splitting BY domain while scoped TO one
    // domain yields a single row, so a domain scope splits by support group within it instead.
    byDomain: execGroupSlice(
      domain ? cachedMttrBySupportGroupData(p) : cachedMttrByDomainData(p),
    ),
    // Already minimal — four scalars and a per-severity tally — so these two ship whole.
    weekTrend: cachedExecutiveWeekTrend(p),
    severityCounts: cachedExecutiveSeverityCounts(p),
  }));
}

// --------------------------------------------------------------------- scan history

function scanHistoryData(): Rec {
  const scans = ledgerStore.loadScanRows().slice().reverse(); // newest first
  // KPI band only: drop no-fix findings when the toggle is off, so tracked/open/resolved/
  // median match the rest of the dashboard. The scans table (+ delete flow) stays unfiltered.
  const base = visibleBase(ledgerStore.loadBaseRows() as unknown as Rec[]) as unknown as BaseRow[];
  const open = base.filter((r) => r.status === "OPEN").length;
  const resolved = base.filter((r) => r.status === "RESOLVED").length;
  const { overall } = mttrFromLedger(base as unknown as Rec[]);
  return {
    scans,
    kpis: {
      tracked: base.length,
      open,
      resolvedAllTime: resolved,
      medianMttr: overall.mttr_median ?? null,
    },
  };
}

const cachedScanHistoryData = () =>
  // "scanHistory" → "scanHistory2": the KPI band now drops no-fix findings when the toggle is
  // off; params null → {showNoFix} so on/off states cache apart and no stale entry survives.
  durablyCached("scanHistory2", { showNoFix: settingsStore.getShowNoFix() }, scanHistoryData);

export function getScanHistory(_p?: unknown): ApiResult {
  return run(() => {
    const d = cachedScanHistoryData() as Rec;
    // The scans tab, narrowed to the ten columns the table draws. Projected here rather than
    // in the cached compute so `scanHistory2` keeps its shape and no namespace moves.
    return { ...d, scans: scanRowsSlice(d["scans"]) };
  });
}


// ------------------------------------------------------------------ jobs & mutations

export function runScan(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  return run(
    () =>
      scanJobs.startScan({
        incremental: Boolean(params["incremental"]),
        sampleShape: (params["sampleShape"] as string) ?? undefined,
      }),
    "scan",
  );
}

export function getJobStatus(p?: unknown): ApiResult {
  return run(() => {
    const jobId = String((p as Rec)?.["jobId"] ?? "");
    return jobId ? jobSummary(getJob(jobId)) : activeJobSummary();
  });
}

export function cancelScan(p?: unknown): ApiResult {
  return run(() => scanJobs.cancelScan(String((p as Rec)?.["jobId"] ?? "")));
}

/**
 * Refuse the two operations that REPLAY scan archives while a severity purge is mid-walk.
 *
 * Both take the script lock but neither consults `activeJob()`, and the purge's archive walk
 * releases the lock between hops — so without this an operator could, in that window:
 *   - delete a scan, rebuilding the ledger from archives only half of which are rewritten, or
 *   - compact, whose `buildCheckpoint` replays un-rewritten pages straight back into the new
 *     checkpoint (maintenance.ts:249-279), re-contaminating the rebuild baseline for good.
 * Either silently applies a partial, arbitrary purge to live state.
 */
function assertNoActivePurge(what: string): void {
  if (purgeJobs.activePurgeJob()) {
    throw new LedgerBusyError(
      `A severity purge is still rewriting scan archives — ${what} would replay the ones it ` +
        `hasn't reached yet. Wait for it to finish, then retry.`,
    );
  }
}

export function deleteScans(p?: unknown): ApiResult {
  const scanIds = (((p as Rec)?.["scanIds"] as string[]) ?? []).map(String);
  return mutate(() => {
    assertNoActivePurge("deleting a scan");
    return ledgerStore.deleteScans(scanIds);
  });
}

export function compact(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  const dryRun = Boolean(params["dryRun"]);
  const days =
    params["retentionDays"] !== undefined
      ? Number(params["retentionDays"])
      : settingsStore.getRetentionDays();
  if (dryRun) return run(() => ledgerStore.compactLedger(days, true));
  return mutate(() => {
    assertNoActivePurge("compacting");
    return ledgerStore.compactLedger(days, false);
  });
}

// ------------------------------------------------------------------------ maintenance

/** Days → the ISO date rows must be on or after to survive a trim. */
function cutoffDate(days: number, now?: number): string {
  return new Date((now ?? Date.now()) - days * 86_400_000).toISOString().slice(0, 10);
}

function severityList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

/** Dry-run counts for all three Maintenance operations, from one state read. */
export function previewMaintenance(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  const episodeDays = Math.max(1, Number(params["episodeDays"] ?? 365));
  const historyDays = Math.max(1, Number(params["historyDays"] ?? 365));
  const now = Date.now();
  return run(() =>
    ledgerStore.previewMaintenance(
      severityList(params["severities"]),
      {
        resolvedBeforeMs: now - episodeDays * 86_400_000,
        severities: severityList(params["episodeSeverities"]).length
          ? severityList(params["episodeSeverities"])
          : null,
      },
      cutoffDate(historyDays, now),
    ),
  );
}

export function startSeverityPurge(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  // Not `mutate`: startSeverityPurge takes the script lock itself with a longer timeout (the
  // phase-0 rewrite can be a 100k-row write), the same way startRiskBackfill does.
  return run(
    () =>
      purgeJobs.startSeverityPurge(
        severityList(params["severities"]),
        params["alsoNarrowScope"] !== false,
      ),
    "startSeverityPurge",
  );
}

export function getPurgeStatus(_p?: unknown): ApiResult {
  return run(() => ({ purge: purgeJobs.purgeStatus() }));
}

export function pruneEpisodes(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  const days = Math.max(1, Number(params["days"] ?? 365));
  const sevs = severityList(params["severities"]);
  return mutate(() => {
    assertNoActivePurge("pruning episodes");
    return ledgerStore.pruneEpisodes({
      resolvedBeforeMs: Date.now() - days * 86_400_000,
      severities: sevs.length ? sevs : null,
    });
  });
}

export function trimHistory(p?: unknown): ApiResult {
  const days = Math.max(1, Number(((p ?? {}) as Rec)["days"] ?? 365));
  return mutate(() => ledgerStore.trimHistory(cutoffDate(days)));
}

// --------------------------------------------------------------------------- import

/** One-shot migration import: a Streamlit bundle merged into the ledger + history. */
// The client gzips large payloads to fit google.script.run; ungzip here. `fallbackKey`
// lets older/no-gzip callers still send the parsed object (e.g. `bundle`, `manifest`).
function payloadOf(params: Rec, fallbackKey: string): unknown {
  if (typeof params["gzipB64"] === "string") {
    return JSON.parse(
      Utilities.ungzip(
        Utilities.newBlob(Utilities.base64Decode(params["gzipB64"] as string), "application/x-gzip"),
      ).getDataAsString("UTF-8"),
    );
  }
  return params[fallbackKey];
}

export function importMigration(p?: unknown): ApiResult {
  return mutate(() => {
    const params = (p ?? {}) as Rec;
    const bundle = validateBundle(payloadOf(params, "bundle"));
    const counts = ledgerStore.importBundle(bundle);
    const hist = history.importHistory(bundle.mttr_history);
    return { ...counts, history_added: hist.added, history_skipped: hist.skipped };
  });
}

// ------------------------------------------------------- sharded (multi-part) import
export function importBegin(p?: unknown): ApiResult {
  return mutate(() => ledgerStore.importBeginSharded(payloadOf((p ?? {}) as Rec, "manifest")));
}

export function importShard(p?: unknown): ApiResult {
  return mutate(() => {
    const params = (p ?? {}) as Rec;
    const shard = payloadOf(params, "shard") as Rec;
    const index = Number(params["index"] ?? shard?.["index"] ?? 0);
    return ledgerStore.importApplyShard(String(params["sessionId"] ?? ""), index, {
      ledger: (shard?.["ledger"] as Rec[]) ?? [],
      episodes: (shard?.["episodes"] as Rec[]) ?? [],
    });
  });
}

export function importFinalize(p?: unknown): ApiResult {
  return mutate(() =>
    ledgerStore.importFinalizeSharded(String(((p ?? {}) as Rec)["sessionId"] ?? "")),
  );
}

export function importAbort(p?: unknown): ApiResult {
  return mutate(() =>
    ledgerStore.importAbortSharded(String(((p ?? {}) as Rec)["sessionId"] ?? "")),
  );
}

export function importStatus(p?: unknown): ApiResult {
  return run(() => {
    const jobId = String(((p ?? {}) as Rec)["jobId"] ?? "");
    return jobId ? getJob(jobId) : activeJobSummary();
  });
}

/** Wipe the ledger back to a fresh, never-compacted state (so a migration import can run). */
export function resetLedger(): ApiResult {
  return mutate(() => {
    // Best-effort: drop any continuation trigger first so a running scan can't repopulate the
    // tabs after the wipe (a stray one no-ops once the jobs tab is cleared, but stop it early).
    try {
      scanJobs.clearContinuationTriggers();
    } catch (e) {
      console.warn(`resetLedger: continuation-trigger cleanup skipped: ${e}`);
    }
    return ledgerStore.resetLedger();
  });
}

// -------------------------------------------------------------------------- reports

const REPORT_SOURCE = "OS vulnerabilities";

export function getReport(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const format = String(params["format"] ?? "markdown");
    const scan = findings.currentScan();
    if (!scan) return { content: "", filename: "", matrix: [] };
    // Honor the global scope — domain or support group (empty = no filter). Both arrive as
    // arrays because the report has always taken them that way; the header switcher sends at
    // most one value in one of them. `domains` matches the RESOLVED domain, so a `Wiz/Domain`
    // tag value scopes a report exactly as a manual group does.
    const domains = (params["domains"] as string[]) ?? [];
    const sgFilter = (params["supportGroups"] as string[]) ?? [];
    // Report counts + MTTR honor the global vendor-fix and EOL filters, like the dashboard views.
    const displayed = visibleFrame(
      findings.applyFilters(scan.records, {
        severities: settingsStore.getDisplaySeverities(),
        domains,
        supportGroups: sgFilter,
      }),
    );
    const counts = sevCountsOf(displayed);
    let baseRows = ledgerStore.loadBaseRows() as unknown as Rec[];
    if (domains.length || sgFilter.length) {
      supportGroups.attachSupportGroups(baseRows);
      if (sgFilter.length) {
        const keep = new Set(sgFilter);
        baseRows = baseRows.filter((r) => keep.has(String(r["_supportGroup"] ?? "")));
      }
      if (domains.length) {
        const compiled = compileDomains(settingsStore.getDomains().items);
        bizDomains.attachBizDomains(baseRows);
        baseRows = baseRows.filter((r) => domains.includes(resolveDomainName(r, compiled)));
      }
    }
    baseRows = visibleBase(baseRows);
    const { perSev, overall } = mttrFromLedger(baseRows);
    void perSev;
    const generated = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const matrix = [
      {
        source: REPORT_SOURCE,
        ...Object.fromEntries(SEVERITY_ORDER.map((s) => [s, counts[s] ?? 0])),
        total: displayed.length,
        medianMttr: overall.mttr_median ?? null,
        open: overall.open ?? 0,
      },
    ];
    if (format === "json") {
      return {
        content: JSON.stringify({ generated, sources: matrix }, null, 2),
        filename: `wiz-report-${generated.slice(0, 10)}.json`,
        matrix,
      };
    }
    if (format === "csv") {
      const cols = findings.TABLE_COLUMNS.filter((c) => !c.startsWith("_"));
      const lines = [cols.join(",")];
      for (const r of displayed) {
        lines.push(cols.map((c) => csvCell(r[c])).join(","));
      }
      return {
        content: lines.join("\r\n"),
        filename: `wiz-report-${generated.slice(0, 10)}.csv`,
        matrix,
      };
    }
    const md = [
      `# Security summary — ${generated}`,
      "",
      `## ${REPORT_SOURCE}`,
      "",
      `| Severity | Count |`,
      `| --- | ---: |`,
      ...SEVERITY_ORDER.filter((s) => counts[s]).map((s) => `| ${s} | ${counts[s]} |`),
      `| **Total** | **${displayed.length}** |`,
      "",
      `Median MTTR: ${overall.mttr_median != null ? overall.mttr_median.toFixed(1) + " days" : "—"}`,
      `Open findings: ${overall.open ?? 0}`,
    ].join("\n");
    return { content: md, filename: `wiz-report-${generated.slice(0, 10)}.md`, matrix };
  });
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function getExportCsv(p?: unknown): ApiResult {
  return run(() => {
    const params = (p ?? {}) as Rec;
    const scan = findings.currentScan();
    if (!scan) return { content: "", filename: "" };
    const filtered = visibleFrame(
      findings.applyFilters(scan.records, {
        severities: (params["severities"] as string[]) ?? settingsStore.getDisplaySeverities(),
        statuses: (params["statuses"] as string[]) ?? [],
        assetTypes: (params["assetTypes"] as string[]) ?? [],
        clouds: (params["clouds"] as string[]) ?? [],
        domains: (params["domains"] as string[]) ?? [],
        supportGroups: (params["supportGroups"] as string[]) ?? [],
        q: (params["q"] as string) ?? "",
      }),
    );
    const cols = findings.TABLE_COLUMNS.filter((c) => !c.startsWith("_"));
    const lines = [cols.join(",")];
    for (const r of filtered) lines.push(cols.map((c) => csvCell(r[c])).join(","));
    return {
      content: lines.join("\r\n"),
      filename: `wiz-os-vulnerabilities-${scan.scanId.slice(0, 10)}.csv`,
    };
  });
}

export function getExportRawUrl(p?: unknown): ApiResult {
  return run(() => {
    const scanId = String((p as Rec)?.["scanId"] ?? "");
    const row = scanId
      ? ledgerStore.loadScanRows().find((s) => s.scan_id === scanId)
      : ledgerStore.latestScanRow();
    if (!row?.raw_ref) return { urls: [] };
    const folder = DriveApp.getFolderById(row.raw_ref);
    const urls: Array<{ name: string; url: string }> = [];
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (/^page-\d+\.json(\.gz)?$/.test(f.getName())) {
        urls.push({ name: f.getName(), url: f.getDownloadUrl() });
      }
    }
    urls.sort((a, b) => (a.name < b.name ? -1 : 1));
    return { urls, folderUrl: folder.getUrl() };
  });
}

/**
 * Export the whole durable register as a migration bundle and return a Drive download URL.
 *
 * The counterpart to `importMigration`. Same `kind`/`version`, so the file this writes is
 * re-importable here — and it is what carries a deployment's accumulated history to
 * another surface (see brick/import_bundle.py) instead of stranding it in Sheets.
 *
 * Reads through `loadState()`, which takes the Drive snapshot fast path: one gzip read
 * rather than a 100k-row getValues, which is what keeps a month of history inside the
 * 6-minute execution cap. No lock: this is a read, and a bundle assembled mid-write would
 * still be internally consistent because the snapshot is rewritten wholesale.
 */
export function exportMigrationBundle(_p?: unknown): ApiResult {
  return run(() => {
    const exportedAt = nowIso();
    const bundle = buildMigrationBundle(ledgerStore.loadState(), history.loadHistory(), {
      exportedAt,
      schemaVersion: SCHEMA_VERSION,
    });
    // ':' is legal in a Drive filename but awkward in every shell that later touches it.
    const stamp = exportedAt.replace(/[:]/g, "");
    const written = archive.writeMigrationExport(`migration-${stamp}.json.gz`, bundle);
    return { ...written, exported_at: exportedAt, counts: bundleCounts(bundle) };
  });
}

// ------------------------------------------------------------------------- settings

export function getSettings(_p?: unknown): ApiResult {
  return run(() => ({
    fetchSeverities: settingsStore.getFetchSeverities(),
    displaySeverities: settingsStore.getDisplaySeverities(),
    retentionDays: settingsStore.getRetentionDays(),
    autoCompact: settingsStore.getAutoCompact(),
    showNoFix: settingsStore.getShowNoFix(),
    includeEol: settingsStore.getIncludeEol(),
    domains: settingsStore.getDomains(),
    riskRule: settingsStore.getRiskRule(),
  }));
}

export function setSeverities(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  return mutate(() => {
    if (params["fetch"]) settingsStore.setFetchSeverities(params["fetch"]);
    if (params["display"]) settingsStore.setDisplaySeverities(params["display"]);
    return {
      fetchSeverities: settingsStore.getFetchSeverities(),
      displaySeverities: settingsStore.getDisplaySeverities(),
    };
  });
}

export function setRetention(p?: unknown): ApiResult {
  const days = (p as Rec)?.["days"];
  return mutate(() => {
    settingsStore.setRetentionDays(days === null || days === undefined ? null : Number(days));
    return { retentionDays: settingsStore.getRetentionDays() };
  });
}

export function setAutoCompact(p?: unknown): ApiResult {
  return mutate(() => {
    settingsStore.setAutoCompact(Boolean((p as Rec)?.["on"]));
    return { autoCompact: settingsStore.getAutoCompact() };
  });
}

export function setShowNoFix(p?: unknown): ApiResult {
  return mutate(() => {
    settingsStore.setShowNoFix(Boolean((p as Rec)?.["on"]));
    return { showNoFix: settingsStore.getShowNoFix() };
  });
}

export function setIncludeEol(p?: unknown): ApiResult {
  return mutate(() => {
    settingsStore.setIncludeEol(Boolean((p as Rec)?.["on"]));
    return { includeEol: settingsStore.getIncludeEol() };
  });
}

/** Set the high-risk classifier rule behind coverage / efficiency. Saving bumps the rule's
 *  version, which every program cache entry keys on, so the whole page re-derives — including
 *  the historical series, since classification happens at read time and nothing is persisted
 *  per-row except the raw signals. */
export function setRiskRule(p?: unknown): ApiResult {
  return mutate(() => {
    settingsStore.setRiskRule((p as Rec)?.["rule"]);
    return { riskRule: settingsStore.getRiskRule() };
  });
}

/** Atomic combined write of retention window + auto-compact — the client sets both at once,
 *  so this avoids the partial-commit window two separate calls left. */
export function setRetentionSettings(p?: unknown): ApiResult {
  const params = (p ?? {}) as Rec;
  const days = params["days"];
  return mutate(() => {
    settingsStore.setRetentionAndCompact(
      days === null || days === undefined ? null : Number(days),
      Boolean(params["autoCompact"]),
    );
    return {
      retentionDays: settingsStore.getRetentionDays(),
      autoCompact: settingsStore.getAutoCompact(),
    };
  });
}

export function getDomains(_p?: unknown): ApiResult {
  return run(() => settingsStore.getDomains());
}

export function saveDomains(p?: unknown): ApiResult {
  const items = ((p as Rec)?.["items"] as unknown[]) ?? [];
  return mutate(() => {
    const errors = validateDomains(items);
    if (errors.length) return { saved: false, errors };
    settingsStore.setDomains(items);
    // Domain rules changed → the frame's memoized _domain attachment is stale.
    findings.invalidateFrameMemo();
    return { saved: true, errors: [], domains: settingsStore.getDomains() };
  });
}

export function previewDomains(p?: unknown): ApiResult {
  return run(() => {
    const items = ((p as Rec)?.["items"] as unknown[]) ?? [];
    const compiled = compileDomains(items);
    const scan = findings.currentScan();
    const records = scan?.records ?? [];
    const perDomain: Record<string, { count: number; samples: string[] }> = {};
    for (const d of compiled) perDomain[d.name] = { count: 0, samples: [] };
    perDomain[UNASSIGNED] = { count: 0, samples: [] };
    for (const r of records) {
      const name = assignDomain(r, compiled);
      const bucket = perDomain[name] ?? (perDomain[name] = { count: 0, samples: [] });
      bucket.count += 1;
      if (bucket.samples.length < 5) {
        const asset = String(r["vulnerableAsset.name"] ?? "");
        if (asset && !bucket.samples.includes(asset)) bucket.samples.push(asset);
      }
    }
    return { total: records.length, perDomain };
  });
}

/**
 * Refresh the subscription → Support Group map from Wiz (graphSearch over subscriptions
 * tagged with WIZ_SUPPORT_GROUP_TAG_KEY). A mutation: it bumps DATA_VERSION so every
 * cached view repaints with the new mapping. Also runs best-effort at each scan finalize.
 */
export function refreshSupportGroups(_p?: unknown): ApiResult {
  if (!hasWizCredentials()) {
    return { ok: false, error: "Live Wiz credentials are required to refresh support groups." };
  }
  return mutate(() => {
    const stats = supportGroups.refreshSupportGroups();
    // Support-group map changed → the frame's memoized _supportGroup attachment is stale.
    findings.invalidateFrameMemo();
    return stats;
  }, "supportGroupRefresh");
}

/**
 * Recover the `Wiz/Domain` tag for episodes sealed before the ledger carried it, from the
 * Drive checkpoints. The domain-attribution counterpart of the risk backfill — see
 * ledgerStore.backfillEpisodeTags for why this is one RPC and not a resumable job.
 */
export function backfillEpisodeTags(_p?: unknown): ApiResult {
  return mutate(() => {
    const result = ledgerStore.backfillEpisodeTags();
    // Attribution is resolved off the frame's memoized tag attachment too, and the episodes
    // that just changed feed the base-row side of every by-domain figure.
    findings.invalidateFrameMemo();
    return result;
  }, "backfillEpisodeTags");
}

// -------------------------------------------------------------------- diagnostics

/** The recent server-side errors (newest first) for Settings → Diagnostics. */
export function getRecentErrors(_p?: unknown): ApiResult {
  return run(() => errorLog.recentErrors());
}

/** Clear the recent-errors log (the Diagnostics "Clear" action). */
export function clearRecentErrors(_p?: unknown): ApiResult {
  return run(() => {
    errorLog.clearErrors();
    return { cleared: true };
  });
}

// ---------------------------------------------------------------------------- misc

// cellCount() walks every sheet in the spreadsheet — cache it per DATA_VERSION. Extracted so
// warmReadModels and the endpoint share one entry.
const cachedStorageStatsData = () =>
  // "storageStats2" → "storageStats3": payload gained the per-tab capacity breakdown
  // (cellsByTab, ledgerRowCells); dataVersion persists across deploys, so bumping the
  // namespace prevents serving a stale old-shape entry (up to the TTL). The prior bump was
  // for the severity data-quality diagnostic (distinctSeverities, unknownSeverityCount).
  durablyCached("storageStats3", null, () => {
    const scans = ledgerStore.loadScanRows();
    const scan = findings.currentScan();
    const baseRows = ledgerStore.loadBaseRows() as unknown as Rec[];
    const usage = cellUsage();
    return {
      cellCount: usage.total,
      cellLimit: 10_000_000,
      // What is consuming the ceiling, so "nearly full" comes with somewhere to look.
      cellsByTab: usage.tabs,
      // Cells one more tracked vulnerability costs, read off the live header list rather than
      // hardcoded, so the headroom estimate stays right as ledger columns are added.
      ledgerRowCells: (TAB_HEADERS[TABS.vulnLedger] ?? []).length,
      scanCount: scans.length,
      sealedCount: scans.filter((s) => s.sealed).length,
      oldestScanTs: scans.length ? scans[0].ts : null,
      trackedVulns: baseRows.length,
      distinctSeverities: scan ? findings.distinct(scan.records, "severity") : [],
      unknownSeverityCount: baseRows.filter(
        (r) => normalizeSeverity(r["severity"]) === "UNKNOWN",
      ).length,
    };
  });

export function getStorageStats(_p?: unknown): ApiResult {
  return run(() => cachedStorageStatsData());
}

// ------------------------------------------------------------------- cache warming

// The default breakdown grouping key the OS-vulns page opens with at the whole-chain view
// (mirrors overview.js: domains when >1 configured, else asset type). Warmed so the lazy
// "Explore breakdown" drawer opens instantly right after a scan.
function defaultGroupingKeys(): string[] {
  return domainNames(settingsStore.getDomains().items).length > 1 ? ["domain"] : ["atype"];
}

/**
 * Precompute the derived read-models the landing pages open with, so the first analyst load
 * after a scan hits a warm cache instead of paying the full recompute on the interactive path.
 *
 * Every mutation calls bumpDataVersion(), so all cross-request caches go cold after a scan;
 * this runs at the tail of afterPersist (scanJobs), once DATA_VERSION is final (after any
 * auto-compaction), inside the scan job's own execution — the state + current-scan frame are
 * already loaded there, so warming reuses them. Best-effort: every entry is guarded so one
 * failure never aborts the rest or the scan, and the whole thing is a no-op on cache errors.
 *
 * Scope: whole-register only (a specific domain / Support group stays cold — acceptable),
 * for the current show-no-fix state, at both the severity scopes the pages request — the
 * all-severities entry (severities: null, the shared default) plus the configured Display
 * severity subset when it's narrower (pages send exactly that array via scopeParam).
 *
 * That stays true now that Executive honors the header scope: a scoped landing page pays the
 * same cold path every scoped analyst page already pays. Enumerating scopes here would multiply
 * the post-scan tail by domains × support groups × severity scopes, inside the 6-minute
 * execution cap, to warm slices a reader may never open. The unscoped landing page is the one
 * that must be instant, and it is the one warmed.
 */
// Wall-clock budget for one warm pass, matching the scan walk's own hop budget: GAS kills an
// execution at six minutes, and a partial warm that reports itself beats a killed one.
const WARM_BUDGET_MS = 270_000;

export function warmReadModels(budgetMs = WARM_BUDGET_MS): void {
  duringWarm(() => warmReadModelsInner(budgetMs));
}

function warmReadModelsInner(budgetMs: number): void {
  const t0 = Date.now();
  let warmed = 0;
  let skipped = 0;
  // BUDGET, because this is no longer only a scan's tail. As a standalone trigger it becomes
  // the thing that hits the 6-minute execution cap first if the register grows, and a killed
  // execution warms NOTHING — every entry it had already computed is still cached, but the
  // ones it never reached stay cold and nothing reports why. Stopping at the budget and
  // logging "warmed N of M" degrades instead of failing.
  const warm = (label: string, fn: () => unknown) => {
    if (Date.now() - t0 >= budgetMs) { skipped += 1; return; }
    try {
      fn();
      warmed += 1;
    } catch (e) {
      console.warn(`Cache warm (${label}) failed: ${e}`);
    }
  };

  // Severity-independent entries: the bootstrap core (also feeds the sidebar/counts), the
  // scan-history KPI band, and the Settings storage panel (cellCount walks every sheet).
  warm("bootstrap", () => bootstrap());
  warm("scanHistory", () => cachedScanHistoryData());
  warm("storageStats", () => cachedStorageStatsData());

  // The severity scopes the pages actually request (see the executive/mttr/overview/
  // attribution pages): the all-severities entry (severities null, the shared default) plus
  // the configured Display-severity subset when it's narrower.
  const display = settingsStore.getDisplaySeverities();
  const scopes: (string[] | null)[] = [null];
  if (Array.isArray(display) && display.length && display.length < SELECTABLE_SEVERITIES.length) {
    scopes.push([...display]);
  }
  const groupingKeys = defaultGroupingKeys();
  for (const severities of scopes) {
    const p = { domain: "", supportGroup: "", severities };
    warm("mttr", () => cachedMttrData(p));
    warm("mttrByDomain", () => cachedMttrByDomainData(p));
    // Both Executive-only entries, and the week trend was never warmed at all — so the DEFAULT
    // landing page's hero badge paid two full `kmMedianAsOf` passes over the base on the first
    // load after every scan, which is the one load most likely to be someone opening the app.
    warm("execWeekTrend", () => cachedExecutiveWeekTrend(p));
    warm("execSevCounts", () => cachedExecutiveSeverityCounts(p));
    warm("mttrTrend", () => cachedMttrTrendData(p));
    warm("insights", () => cachedInsightsData(p));
    // Program performance is a top-level nav item one click from the landing page, and neither
    // of its read-models was warmed — so the first visit after every scan paid a full
    // `scopedBaseRows` + classifyRisk pass over the whole base, plus the backfilled trend
    // backbone. `mttrBySupportGroup` is the split BOTH the MTTR and Executive pages switch to
    // the moment a domain scope is picked, and it was cold for the same reason.
    warm("program", () => cachedProgramData(p));
    warm("programTrend", () => cachedProgramTrendData(p));
    warm("mttrBySupportGroup", () => cachedMttrBySupportGroupData(p));
    warm("grouping", () => cachedGroupingData({ ...p, keys: groupingKeys }));
    warm("attribution", () => cachedAttributionData({ severities }));
  }
  if (skipped) {
    console.warn(`Cache warm: ran out of budget after ${warmed} entries, ${skipped} left cold`);
  }
  // Names the durable set SHOULD hold after this pass. Anything else in the folder is a leftover
  // from a namespace bump, a changed display-severity subset, or a model dropped from the warm —
  // none of which any future write would ever overwrite, because nothing asks for those names.
  //
  // Skipped after a budget cut-out: the expected list would be short by whatever never ran, and
  // sweeping against it would trash live entries to re-fetch them next pass.
  if (!skipped) sweepReadModels();
}


/**
 * The scheduled entry point — `trigger_warmReadModels` in dist/entry.js.
 *
 * WHY A TRIGGER AT ALL. CacheService's maximum TTL is six hours; it is a platform ceiling, not
 * a choice. Tenants scan daily, so DATA_VERSION does not move for ~24h while every entry lapses
 * three or four times inside that window — and each lapse is a multi-second cold load paid by
 * whoever opens the app next. Re-warming on a schedule costs a few minutes of trigger quota a
 * day and means nobody pays that. The schedule itself lives in setup.ts, and it covers the
 * working day rather than the clock: a fire at 01:00 refreshes entries that lapse before anyone
 * arrives.
 *
 * SKIPPED WHILE A JOB IS IN FLIGHT, and the reason is correctness rather than politeness.
 * `activeJob()` is single-flight across kinds, so one test covers scan, backfill, purge, import
 * and compact. A commit landing mid-warm bumps DATA_VERSION and makes everything just computed
 * unreachable — pure waste — but worse, a PERSISTING job is part-way through an `overwrite`, so
 * a warm reading the ledger then would cache a torn read under the PRE-bump version and serve
 * it for the rest of that window.
 *
 * It deliberately does NOT take the script lock. A 60-120s hold would make an operator's "Run
 * scan" fail with LedgerBusyError on its 30s timeout; the fires are hours apart so two cannot
 * overlap, and the only real race is warm-vs-afterPersist, which the activeJob check covers.
 */
export function warmReadModelsScheduled(): void {
  const job = activeJob();
  if (job) {
    console.log(`Cache warm: skipped, ${job.kind} job ${job.job_id} is ${job.phase}`);
    return;
  }
  warmReadModels();
}
