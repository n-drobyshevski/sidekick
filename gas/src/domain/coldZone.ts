// The cold zone: where nothing is closing at all.
//
// The rest of this register answers "how fast is vulnerability risk closing". This module
// answers the other question — WHERE HAS IT STOPPED. An asset can carry a small backlog and
// still be the worst thing on the page if nobody has touched it since January; an asset with
// a thousand findings and a fix landing every week is not a problem of engagement. Backlog
// size cannot tell those two apart, so this family measures IDLE TIME instead of volume.
//
// Structural twin of `src/domain/program.ts`'s profiles: options carry the clock
// (`observedFrom` / `now`) and the classifier (`rule`), an unparseable clock REFUSES rather
// than casting to null, rows that belong to no asset are dropped AND COUNTED, rows the rule
// cannot decide are carried at risk `unknown` and counted, and the published order has a name
// tie-break so two runs over the same ledger diff cleanly.
//
// Pure: no clock of its own, no I/O, no persistence. Every duration here is measured against
// the caller's `now`, which the server sets to the LEDGER's clock (the newest flat scan's
// `ts`), never `Date.now()` — an idle time dated by the wall clock would grow every time the
// page was opened and would be a different number on every read of the same durable cache.
//
// -------------------------------------------------------------------------------------
// WHAT THIS IS A PORT OF, AND WHAT WAS DELIBERATELY DROPPED ON THE WAY. The definition comes
// from the code register (`gas_devsecops/src/domain/coldZone.ts`), which measures
// repositories rolled up per owning project over three scopes. Here the grain is different,
// and so are three things:
//
//   grain            REPOSITORY becomes ASSET (`asset_id` / `asset_name`, with `asset_type`
//                    and `cloud` carried as descriptive columns). The OS ledger row
//                    (`reconcile.ts`'s `LedgerRow`) has no repository column at all.
//   roll-up          `owner_project` — a stored column there — becomes `_supportGroup`, which
//                    is NOT a ledger column here: the server attaches it live from the
//                    support-group map (`server/supportGroups.ts`). A row with no group is a
//                    real row under `COLD_GROUP_NONE`, never a drop, and with no map loaded
//                    every asset lands there — which is a fact about the map, and the page
//                    says so.
//   MOVEMENT         there, movement was the latest of `resolved_at` / `removed_at` /
//                    `rotated_at`, and the winning column was published as
//                    `last_movement_kind` (ranked by `MOVEMENT_RANK` when two landed on the
//                    same instant). This register has ONE remediation column, `resolved_at`,
//                    so `MovementKind`, `MOVEMENT_RANK` and `last_movement_kind` are all
//                    gone: with a single event there is no kind to name and no tie to break.
//                    What is KEPT is the fold that reads the column REGARDLESS OF STATUS (see
//                    `foldRow`) and `reopened_open`, because a reopen CLEARS `resolved_at`
//                    (`reconcile.ts`: "Genuine reopen") — a returned finding erases the only
//                    movement this register has, and the count is published so a silent asset
//                    can explain itself.
//   observation      there, one newest scan PER SCOPE. Here, one newest flat scan PER
//                    SEVERITY — see the next block.
//   unclassified     there, `secrets` rows, which `program.resolveRule` refuses by design.
//                    Here, `unclassified_rows`: rows `program.classifyRisk` returns
//                    `"unknown"` for, because an enabled signal was never captured on them
//                    (or because the operator's rule enables no signal at all). They are real
//                    open findings and count as such; they can never be high risk.
//
// -------------------------------------------------------------------------------------
// TWO STATES, NOT ONE, and the second one is the whole reason this module is careful:
//
//   cold        the asset is still being scanned, it still has open findings, and no finding
//               on it has been resolved for at least the threshold. That is a fact about the
//               SUPPORT GROUP.
//   unobserved  the scanner stopped returning the asset. That is a fact about the SCANNER,
//               and it is tested FIRST, because `reconcile` resolves findings that are absent
//               from the newest scan BY DISAPPEARANCE (`config.RESOLUTION_DISAPPEARED`). An
//               asset that drops out of coverage therefore looks mass-remediated in exactly
//               one scan. Reading that as warmth would reward losing sight of an asset, which
//               is the single worst thing this page could do. So an unobserved asset is never
//               warm, never cold, sits in no idle bucket, and publishes `disappeared_at` and
//               how many findings closed at that instant so the reader can see the shape of
//               the drop-out.
//
// OBSERVATION IS PER SEVERITY, OVER FLAT SCANS ONLY, and both halves of that are load-bearing:
//   * PER SEVERITY, because this register syncs a chosen set of severities and `reconcile`
//     already gates disappearance the same way ("This severity wasn't scanned — absence is
//     expected, not resolution", via `prevScanIdBySeverity`). Keying observation on the single
//     newest scan would mark every HIGH asset unobserved the morning after a CRITICAL-only
//     sweep, which would contradict the register's own rule about the same rows.
//   * FLAT SCANS ONLY, because a grouped scan writes no per-finding observations at all
//     (`ledgerCore.persistGroupedScan`) — it could not tell us whether an asset was returned.
//     The map handed in is therefore built from flat scans alone; this module takes it as
//     given and does not re-derive it. The clock (`now` / `observedFrom`) comes from the same
//     place, for the same reason.
//
// WHAT THE COLUMNS REFUSE TO SAY:
//   * `observedFrom === null` ⇒ `assets`, `groups`, `totals`, `bucket_edges` and
//     `bucket_labels` are ALL null, never empty arrays and never zeros. With no scan on
//     record the register cannot say when it started watching, and every figure here is
//     "how long since something happened" — a duration with no origin. `row_count`,
//     `dropped_no_asset`, `unclassified_rows` and `severities_without_scan` still report, so
//     an empty section can prove it looked.
//   * An asset with no movement on record gets NO `idle_days`. It gets `idle_bound_days`
//     — a LOWER bound measured from the later of "when we started watching" and "when this
//     asset's oldest finding was first seen" — and `idle_is_bound: true` so the page
//     prints "≥ N d" rather than a number nobody measured. Never having seen a close is not
//     the same fact as having measured a long silence, and the two must not render alike.
//   * `cold_share_pct` and the two totals shares are NULL over an empty denominator, never
//     0%. "No asset has open findings" and "0% of them are cold" are different answers.
//   * `oldest_open_age_days` is derived from `first_seen` against the caller's `now`, NEVER
//     from the row's stored `age_days` — that column is a wall-clock read and would make
//     this block disagree with itself across two loads of the same cached model.
//   * A severity that has rows but no scan on record is UNDECIDABLE, so the asset stays
//     observed (the conservative direction: we do not accuse a support group of vanishing on
//     the strength of a missing scan row) and the severity is named in
//     `severities_without_scan`.
//
// THRESHOLD SEMANTICS: `>=`, everywhere. Exactly 90.0 days idle is cold, matching the
// register's "≥ N" wording rule (README / DESIGN.md) — the page never prints ">".
//
// -------------------------------------------------------------------------------------
// TWO WAYS TO DRAW THAT LINE, and only one of them is a constant:
//
//   fixed     the operator names the WINDOW. An asset is cold after `coldAfterDays` of
//             silence, and that number means the same thing on every estate and in every
//             week. It is the default, and it is what an absent `mode` means.
//   relative  the operator names a SHARE, and the line in days is DERIVED from the estate:
//             the idlest `targetSharePct` per cent of the assets that are observed and carry
//             open findings are the cold zone. The line follows the population instead of
//             standing still while the population moves underneath it — the argument EPSS
//             makes for publishing a percentile beside a probability (config.ts carries the
//             sources and the two failure modes the floor answers).
//
// Both modes produce ONE effective threshold in days, and `cold_after_days` is ALWAYS that
// effective line: every verdict, every bucket edge and every label downstream reads it, and
// nothing downstream has to know which mode produced it. The operator's fixed window is still
// published as `fixed_after_days`, so the page can say what was asked for as well as what was
// drawn.
//
// WHAT THE RELATIVE MODE REFUSES TO SAY:
//   * It never interpolates. The cut is a RANK — the k-th largest reading, with
//     `k = min(n, max(1, ceil(target/100 × n)))` — so the line always sits ON an asset
//     somebody can go and look at, and ties at the cutoff are ALL cold. The threshold stays
//     "≥", and two assets idle the same number of days can never land on opposite sides of it.
//   * It never goes below `floorDays`. A share always names somebody, however healthy the
//     estate; the floor is what stops "the idlest 20%" being a slander on four assets that
//     were all touched last week. When the floor holds, `floor_applied` says so and
//     `derived_days` publishes the line that was refused.
//   * It never claims the target was met. `achieved_share_pct` is published beside
//     `target_share_pct` in BOTH modes, and the two disagree in both directions by design —
//     below when the floor holds the zone smaller than asked, above when ties at the cutoff
//     widen it.
//   * An asset with no movement on record ranks at its LOWER BOUND (`idle_reading_days`),
//     the same number the fixed mode classifies and prints it by. That is a systematic
//     UNDER-estimate of its silence, so the cost is published: `cold_bound_only` counts the
//     cold assets whose idle time was never actually measured.
//   * With no eligible asset at all, the line rests on the floor and `derived_days` is
//     NULL — nothing was derived, which is not the same fact as "zero days" — while
//     `eligible_assets` reports 0 so the empty answer can prove it looked.
//
// The SUPPORT GROUP rank is the same idea one level up and is deliberately kept separate from
// the verdict: `relative_rank` orders the groups that have assets with open findings by the
// share of those assets that are cold, and in relative mode the coldest `targetSharePct` of
// them are marked `in_coldest_share`. A group with no cold asset is never marked, whatever the
// arithmetic says (the `C` clamp), and ties are extended through rather than broken by the
// label — a badge that depended on alphabetical order would be a fact about spelling.

import {
  COLD_ZONE_MODES,
  DEFAULT_COLD_ZONE_MODE,
  RESOLUTION_DISAPPEARED,
  isOpenStatus,
  type ColdZoneMode,
} from "./config";
import type { BaseRow } from "./ledgerCore";
import { classifyRisk, type RiskClass, type RiskRow, type RiskRule } from "./program";
import { normalizeSeverity } from "./severity";
import { parseTs, present, toIso } from "./util";

const DAY_MS = 86_400_000;

/** The label the null `_supportGroup` bucket is published under — a real row, never a drop. */
export const COLD_GROUP_NONE = "(no support group)";

// --------------------------------------------------------------------------- input shape

/**
 * The projection this module reads. A `BaseRow` satisfies it structurally, which is the
 * intended input; the narrow type is here so a test (or a page) can build one without
 * inventing 30 ledger columns — the same bargain the rest of the domain makes.
 *
 * `RiskRow` rides along because `risk_class` is not a stored column in this register: it is
 * derived per row by `program.classifyRisk`, so "high risk sitting cold" and the classifier
 * card cannot disagree about what "high" means.
 *
 * `_supportGroup` is NOT a ledger column: `server/supportGroups.attachSupportGroups` writes it
 * onto the row from the live map, so it is typed `unknown` and optional — absent, blank and
 * unmapped all mean the same thing here, and all three land under `COLD_GROUP_NONE`.
 */
export type ColdRow = RiskRow &
  Pick<
    BaseRow,
    | "asset_id"
    | "asset_name"
    | "asset_type"
    | "cloud"
    | "severity"
    | "status"
    | "first_seen"
    | "last_seen"
    | "resolved_at"
    | "resolution_src"
    | "reopened_count"
    | "last_scan_id"
  > & { _supportGroup?: unknown };

/** The newest FLAT scan that covered one severity — what "the scanner still sees this" tests against. */
export interface NewestScan {
  scan_id: string | null;
  ts: string | number | Date | null;
}

export interface ColdZoneOptions {
  /** The evaluation instant. An option, never `Date.now()` — this module is pure. */
  now: string | number | Date;
  /**
   * The earliest flat scan on record — when this register started WATCHING. `null` is a
   * legitimate, explicit answer ("we do not know"), and it makes every derived block null.
   * There is no default: a clock has to say where it started.
   */
  observedFrom: string | number | Date | null;
  /**
   * How long a silence has to be before it is cold, in days. REQUIRED and not defaulted
   * here: the default lives in `config.DEFAULT_COLD_AFTER_DAYS` and reaches this function
   * through the settings layer, so there is exactly one place an operator's choice can be
   * overridden and exactly one place to look when a published figure disagrees with it.
   */
  coldAfterDays: number;
  /**
   * `"fixed"` (the default when absent) or `"relative"`. Absent means fixed rather than
   * throwing, because the fixed window is the older contract and every caller that predates
   * relative mode is still asking for exactly what it used to get.
   */
  mode?: ColdZoneMode;
  /**
   * The share of eligible assets the cold zone should hold, in per cent. REQUIRED in
   * relative mode and REFUSED silently by nothing: there is no default here, for the same
   * reason `coldAfterDays` has none — the operator's choice lives in the settings layer
   * (`config.DEFAULT_COLD_TARGET_SHARE_PCT`, clamped to its bounds there), and a default in
   * this module would be a second place for a published figure to come from.
   */
  targetSharePct?: number;
  /** The line's floor in days, REQUIRED in relative mode. See the module header. */
  floorDays?: number;
  /**
   * Per NORMALIZED severity, the newest FLAT scan that covered it. A severity absent from
   * this map is undecidable, not stale. Keys are `severity.normalizeSeverity` values
   * (`config.SEVERITY_ORDER`), so a blank or unrecognized severity is looked up as
   * `"UNKNOWN"`.
   */
  newestScanBySeverity: Record<string, NewestScan>;
  /**
   * The classifier. REQUIRED, unlike the code register's optional per-scope rule: there is
   * one register here and `program.classifyRisk` never throws, so the operator's rule is the
   * only thing that can decide `high` — and defaulting it in this module would be a second
   * place a published "high risk sitting cold" count could come from.
   */
  rule: RiskRule;
}

// --------------------------------------------------------------------------- output shape

/** Asset states, in the order the verdict table tests them. */
export type ColdVerdict = "unobserved" | "clear" | "cold" | "warm" | "watching";

/** Support-group states, rolled up from the assets that have open findings. */
export type GroupVerdict = "fully-cold" | "partly-cold" | "warm" | "clear";

export interface ColdAssetRow {
  asset_id: string;
  /** Display name; falls back to the id when no row carried one. */
  asset_name: string | null;
  /** Descriptive, never a key: two assets of the same type are not the same asset. */
  asset_type: string | null;
  cloud: string | null;
  /** `_supportGroup`. NULL is a real answer and is rolled up under `COLD_GROUP_NONE`. */
  support_group: string | null;
  open_findings: number;
  open_high_risk: number;
  /** Age of the oldest OPEN finding, from `first_seen` against `now`. Never from `age_days`. */
  oldest_open_age_days: number | null;
  /** Latest `resolved_at` over ALL rows, open or not. See `foldRow` for why status is ignored. */
  last_movement_at: string | null;
  /** Measured silence. NULL means no movement was ever recorded — not "zero days idle". */
  idle_days: number | null;
  /** The LOWER bound used when nothing was ever measured. Null when `idle_days` is real. */
  idle_bound_days: number | null;
  idle_is_bound: boolean;
  /** What the page prints: the measurement if there is one, else the bound (as "≥ N d"). */
  idle_reading_days: number | null;
  /** The scanner still returns this asset in the newest flat scan of some severity it has rows in. */
  observed: boolean;
  last_observed_at: string | null;
  /**
   * How long the scanner has been silent about this asset, in days from `last_observed_at`.
   *
   * The duration rather than the two dates, for the reason `oldest_open_age_days` is a duration
   * too: nothing in this client subtracts one timestamp from another, because a page that did
   * would be measuring against the reader's clock instead of the ledger's. NULL when no row was
   * ever seen at all, which is not "zero days invisible".
   *
   * Published for every asset and meaningful for the unobserved ones — an observed asset reads
   * near zero here by construction, and the cost of computing it is one subtraction already in
   * hand.
   */
  unobserved_for_days: number | null;
  /** The instant that closed the most findings by DISAPPEARANCE — the drop-out's fingerprint. */
  disappeared_at: string | null;
  /** How many findings closed at that instant. A big number beside a recent date is a drop-out. */
  disappeared_at_last_observation: number;
  /** Open findings that have come back at least once — why an asset with no movement went quiet. */
  reopened_open: number;
  verdict: ColdVerdict;
  cold: boolean;
  /** Idle bucket 0..3, or 4 for "not yet measurable". NULL for unobserved and clear assets. */
  bucket: number | null;
}

export interface ColdGroupRow {
  support_group: string | null;
  label: string;
  assets: number;
  assets_observed: number;
  assets_unobserved: number;
  /** See `ColdZoneTotals` — the two kinds of unobserved, summing to `assets_unobserved`. */
  assets_unobserved_open: number;
  assets_unobserved_clear: number;
  /** OBSERVED assets with at least one open finding — the denominator of `cold_share_pct`. */
  assets_with_open: number;
  cold_assets: number;
  watching_assets: number;
  warm_assets: number;
  clear_assets: number;
  open_findings: number;
  open_in_cold: number;
  high_risk_in_cold: number;
  /** Open findings on assets the scanner has lost sight of — counted apart, never cold. */
  open_in_unobserved: number;
  cold_share_pct: number | null;
  /** Over OBSERVED assets only: a drop-out's disappearance close is not this group's work. */
  last_movement_at: string | null;
  verdict: GroupVerdict;
  /**
   * 1..G over the groups that have assets with open findings, by `cold_share_pct` desc,
   * `open_in_cold` desc, label asc. NULL for a group with nothing open — it has no cold
   * share, and giving it a rank would invent a position for a group that is not in the
   * race. Computed in BOTH modes, so the payload has one shape.
   */
  relative_rank: number | null;
  /**
   * The coldest `targetSharePct` of the ranked groups. Only ever true in relative mode,
   * never true for a group with no cold asset, and extended through ties.
   */
  in_coldest_share: boolean;
  /** Assets per idle bucket, length 5 (the fifth is "not yet measurable"). */
  buckets: number[];
  /** Open findings per idle bucket, same length — a cell says how much sits in it, not just how many. */
  bucket_open: number[];
}

export interface ColdZoneTotals {
  assets: number;
  assets_observed: number;
  assets_unobserved: number;
  /**
   * The two kinds of unobserved, which are not the same news and were drawn as one.
   *
   * `unobserved` is tested before `clear`, so an asset that was remediated and then
   * DECOMMISSIONED stays unobserved for as long as the ledger remembers it: nothing open, and
   * no scan will ever list it again. On a register with ordinary asset churn that tail grows
   * without bound and comes to dominate any picture drawn over `assets` — 1,947 of 2,404 on
   * the tenant that prompted this, which read as a coverage catastrophe and was mostly
   * machines that no longer exist. The other kind is the one this page exists for: an asset
   * the scanner has lost sight of that is STILL CARRYING open findings — backlog nobody is
   * looking at any more, and nobody will be told about again.
   *
   * They sum to `assets_unobserved`, so every existing reader is unaffected and the split
   * proves itself. `open_in_unobserved` is the findings figure over the same population.
   */
  assets_unobserved_open: number;
  assets_unobserved_clear: number;
  assets_with_open: number;
  cold_assets: number;
  watching_assets: number;
  warm_assets: number;
  clear_assets: number;
  open_findings: number;
  open_in_cold: number;
  high_risk_in_cold: number;
  open_in_unobserved: number;
  /** cold assets / assets with open findings. NULL over an empty denominator. */
  cold_asset_share_pct: number | null;
  /** open findings sitting cold / all open findings — the Executive card's one number. */
  cold_backlog_share_pct: number | null;
  groups: number;
  groups_fully_cold: number;
  groups_partly_cold: number;
  /** Groups marked `in_coldest_share`. Always 0 in fixed mode — the badge is relative. */
  groups_in_coldest_share: number;
  /** Assets with no support group at all — the attribution gap, published as a figure. */
  assets_no_support_group: number;
  buckets: number[];
  bucket_open: number[];
}

export interface ColdZoneResult {
  /** `observedFrom !== null`. False ⇒ every derived block below is null. */
  measurable: boolean;
  /** Which definition drew the line. `"fixed"` when the caller said nothing. */
  mode: ColdZoneMode;
  /**
   * THE EFFECTIVE LINE, in days — in fixed mode the operator's window, in relative mode the
   * derived cut lifted to the floor. Everything downstream (verdicts, buckets, labels, the
   * page's prose) reads this one number and nothing downstream branches on the mode.
   */
  cold_after_days: number;
  /** The operator's fixed window, published in both modes so "asked for" survives the switch. */
  fixed_after_days: number;
  /** The share the line was aimed at, in per cent. NULL in fixed mode — nothing was aimed at. */
  target_share_pct: number | null;
  /**
   * The share the line actually drew: cold assets / assets with open findings. Published in
   * BOTH modes (in fixed mode it is the same number as `totals.cold_asset_share_pct`, said
   * where the target can be read beside it), and NULL over an empty denominator — "no asset
   * has an open finding" is not "0% of them are cold".
   */
  achieved_share_pct: number | null;
  /** The floor the derived line may not go below. NULL in fixed mode — there is no derivation. */
  floor_days: number | null;
  /** True when the floor held the line ABOVE the derived cut, so the zone came out smaller. */
  floor_applied: boolean;
  /**
   * The k-th largest idle reading, floored to whole days — the line the estate asked for
   * before the floor was applied. NULL in fixed mode and NULL when nothing was eligible;
   * "not derived" is a different fact from "derived at zero".
   */
  derived_days: number | null;
  /** Observed assets with at least one open finding: the population the share is of. */
  eligible_assets: number | null;
  /**
   * Cold assets whose idle time is a LOWER BOUND rather than a measurement. The cost of
   * ranking an asset that has never closed anything at the bound it can prove.
   */
  cold_bound_only: number | null;
  observed_from: string | null;
  /** The instant every duration here was measured against — the clock says where it stood. */
  as_of: string;
  /** Lower edge of each of the four measured buckets: `[0, t/3, 2t/3, t]`. */
  bucket_edges: number[] | null;
  bucket_labels: string[] | null;
  assets: ColdAssetRow[] | null;
  groups: ColdGroupRow[] | null;
  totals: ColdZoneTotals | null;
  /** Rows handed in, before any drop — so a zero elsewhere can prove it looked. */
  row_count: number;
  /** Rows with a blank `asset_id`: dropped, because they belong to no asset, AND counted. */
  dropped_no_asset: number;
  /**
   * Rows `program.classifyRisk` returned `"unknown"` for: an enabled signal was never
   * captured on them, or the operator's rule enables no signal at all. They are real open
   * findings and count toward `open_findings`; they can never count toward `open_high_risk`,
   * because a missing signal is not an observed negative. Published so a small
   * "high risk sitting cold" figure can be read as a measurement gap rather than good news.
   */
  unclassified_rows: number;
  /** Severities with rows but no flat scan on record: observation is undecidable, and said so. */
  severities_without_scan: string[];
}

/** The Executive projection: the totals and the clock, never the per-asset or per-group arrays. */
export interface ColdZoneHeadline {
  measurable: boolean;
  /** Which definition drew the line — the Executive card names the mode it is reading. */
  mode: ColdZoneMode;
  /** The EFFECTIVE line, exactly as on `ColdZoneResult`. */
  cold_after_days: number;
  fixed_after_days: number;
  target_share_pct: number | null;
  achieved_share_pct: number | null;
  floor_days: number | null;
  floor_applied: boolean;
  derived_days: number | null;
  eligible_assets: number | null;
  cold_bound_only: number | null;
  observed_from: string | null;
  as_of: string;
  totals: ColdZoneTotals | null;
  row_count: number;
  dropped_no_asset: number;
  unclassified_rows: number;
  severities_without_scan: string[];
}

// --------------------------------------------------------------------------- small helpers

/** True for null / undefined / NaN / whitespace-only — `util.present` read the other way. */
function blank(v: unknown): boolean {
  return !present(v);
}

/**
 * Three-way compare for sorts. Private because `util.ts` has none: the rest of this domain
 * sorts numbers with subtraction and strings with `localeCompare` or an inline ternary, and
 * this module needs one deterministic tie-break it can chain with `||` in four places.
 */
function cmp<T>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `numerator / denominator * 100`, or NULL when there is nothing to divide by.
 * NULL, never 0 — a share over an empty population is unknown, and rendering it as 0% is a
 * lie the reader cannot detect. Same rule as the rest of the domain's `safePct`.
 */
function safePct(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

/** Whole days between two instants, fractional and floored at 0 — never rounded. */
function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, (toMs - fromMs) / DAY_MS);
}

/** Bucket labels print at most one decimal, so a threshold of 100 reads "33.3", not "33.333…". */
function fmtDays(n: number): string {
  return String(Number(n.toFixed(1)));
}

/** The published order of asset states — worst engagement first. */
const VERDICT_RANK: Record<ColdVerdict, number> = {
  cold: 0,
  unobserved: 1,
  watching: 2,
  warm: 3,
  clear: 4,
};

// --------------------------------------------------------------------------- per asset

interface AssetAcc {
  assetId: string;
  assetName: string | null;
  assetType: string | null;
  cloud: string | null;
  supportGroup: string | null;
  severities: Set<string>;
  rowsBySeverity: Map<string, ColdRow[]>;
  open: number;
  openHigh: number;
  reopenedOpen: number;
  /** Earliest `first_seen` over OPEN rows — the oldest thing still sitting there. */
  oldestOpenFirstSeen: number | null;
  /** Earliest `first_seen` over ALL rows — one half of the idle lower bound. */
  earliestFirstSeen: number | null;
  lastSeen: number | null;
  movementAt: number | null;
  /** Disappearance closes, counted per instant: the mode is the drop-out's fingerprint. */
  disappeared: Map<number, number>;
}

/**
 * What pass A knows about one asset: everything the threshold CANNOT change.
 *
 * The split exists for the relative mode. The line is derived from `idleReading` over the
 * eligible population, so those facts have to be complete before any line is drawn — and they
 * are, because observation and "has anything open" are decided by the scanner and the ledger,
 * never by the window. That is what makes the derivation a single pass instead of a
 * fixed-point iteration over "who is cold".
 */
interface AssetFacts {
  acc: AssetAcc;
  observed: boolean;
  idleDays: number | null;
  idleBoundDays: number | null;
  idleReading: number | null;
  disappearedAt: number | null;
  disappearedCount: number;
  /** `observed && open > 0` — the population the relative share is a share OF. */
  eligible: boolean;
}

function newAcc(assetId: string): AssetAcc {
  return {
    assetId,
    assetName: null,
    assetType: null,
    cloud: null,
    supportGroup: null,
    severities: new Set(),
    rowsBySeverity: new Map(),
    open: 0,
    openHigh: 0,
    reopenedOpen: 0,
    oldestOpenFirstSeen: null,
    earliestFirstSeen: null,
    lastSeen: null,
    movementAt: null,
    disappeared: new Map(),
  };
}

/**
 * Fold one row into its asset.
 *
 * MOVEMENT IS READ REGARDLESS OF STATUS, and that is not an oversight. `reconcile` writes
 * `resolved_at` beside a RESOLVED status and clears it on a reopen, so on a well-formed
 * ledger the two agree — but an imported or merged shard can carry a `resolved_at` under a
 * status this register has never seen (`isOpenStatus` deliberately reads an unfamiliar status
 * as OPEN), and a close that happened is remediation work whatever the status column ended up
 * saying. Gating movement on the row being closed would report an actively-remediating group
 * as frozen on exactly those rows.
 */
function foldRow(acc: AssetAcc, row: ColdRow, risk: RiskClass): void {
  if (acc.assetName === null && !blank(row.asset_name)) acc.assetName = String(row.asset_name);
  if (acc.assetType === null && !blank(row.asset_type)) acc.assetType = String(row.asset_type);
  if (acc.cloud === null && !blank(row.cloud)) acc.cloud = String(row.cloud);
  if (acc.supportGroup === null && !blank(row._supportGroup)) {
    acc.supportGroup = String(row._supportGroup);
  }

  const sev = normalizeSeverity(row.severity);
  acc.severities.add(sev);
  const bucket = acc.rowsBySeverity.get(sev);
  if (bucket) bucket.push(row);
  else acc.rowsBySeverity.set(sev, [row]);

  const open = isOpenStatus(row.status);
  const firstSeen = parseTs(row.first_seen);
  if (firstSeen !== null && (acc.earliestFirstSeen === null || firstSeen < acc.earliestFirstSeen)) {
    acc.earliestFirstSeen = firstSeen;
  }
  const lastSeen = parseTs(row.last_seen);
  if (lastSeen !== null && (acc.lastSeen === null || lastSeen > acc.lastSeen)) acc.lastSeen = lastSeen;

  if (open) {
    acc.open += 1;
    if (risk === "high") acc.openHigh += 1;
    if (Number(row.reopened_count) > 0) acc.reopenedOpen += 1;
    if (firstSeen !== null && (acc.oldestOpenFirstSeen === null || firstSeen < acc.oldestOpenFirstSeen)) {
      acc.oldestOpenFirstSeen = firstSeen;
    }
  }

  // ONE movement column in this register, so no kind to publish and no tie to break: the
  // latest `resolved_at` wins outright. See the module header on the dropped `MovementKind`.
  const movedAt = parseTs(row.resolved_at);
  if (movedAt !== null && (acc.movementAt === null || movedAt > acc.movementAt)) {
    acc.movementAt = movedAt;
  }

  if (String(row.resolution_src ?? "") === RESOLUTION_DISAPPEARED) {
    const at = parseTs(row.resolved_at);
    if (at !== null) acc.disappeared.set(at, (acc.disappeared.get(at) ?? 0) + 1);
  }
}

/**
 * Is the scanner still returning this asset?
 *
 * PER SEVERITY, and observed if ANY severity reaches its own newest flat scan — a
 * CRITICAL-only sweep must not mark every HIGH row of a perfectly healthy asset as vanished,
 * which is the same rule `reconcile` applies when it decides whether an absence is a
 * resolution. The primary test is `last_scan_id === newestScanBySeverity[sev].scan_id`; a
 * blank `last_scan_id` falls back to `last_seen >= newest.ts`, because an older ledger row can
 * carry the sighting without the scan id. A severity with rows but NO scan on record is
 * undecidable and resolves to observed — and is named in `severities_without_scan`, so the
 * reader knows which way the doubt fell.
 */
function isObserved(
  acc: AssetAcc,
  newestBySeverity: Record<string, NewestScan>,
  severitiesWithoutScan: Set<string>,
): boolean {
  let observed = false;
  for (const sev of acc.severities) {
    const newest = newestBySeverity[sev];
    if (!newest) {
      severitiesWithoutScan.add(sev);
      observed = true;
      continue;
    }
    const rows = acc.rowsBySeverity.get(sev) ?? [];
    const newestTs = parseTs(newest.ts);
    for (const row of rows) {
      if (!blank(row.last_scan_id)) {
        if (!blank(newest.scan_id) && String(row.last_scan_id) === String(newest.scan_id)) {
          observed = true;
          break;
        }
        continue;
      }
      const lastSeen = parseTs(row.last_seen);
      if (newestTs !== null && lastSeen !== null && lastSeen >= newestTs) {
        observed = true;
        break;
      }
    }
  }
  return observed;
}

/** `[0,t/3) [t/3,2t/3) [2t/3,t) [t,∞)` — bucket 3 is cold, by construction. */
function bucketOf(readingDays: number, t: number): number {
  if (readingDays >= t) return 3;
  if (readingDays >= (2 * t) / 3) return 2;
  if (readingDays >= t / 3) return 1;
  return 0;
}

// --------------------------------------------------------------------------- the entry point

/**
 * The cold-zone profile: one row per asset, one per support group, and the totals.
 *
 * The verdict table, first match wins — the ORDER is the contract:
 *
 *   1  no row reaches the newest flat scan of any severity the asset has rows in  unobserved
 *   2  open_findings === 0                                                        clear
 *   3  idle_days !== null    && idle_days       >= coldAfterDays                  cold (measured)
 *   4  idle_days === null    && idle_bound_days >= coldAfterDays                  cold (bound)
 *   5  idle_days !== null                                                         warm
 *   6  otherwise (no movement, bound under threshold)                             watching
 *
 * Rule 1 sits first for the reason the module header gives: disappearance-resolution makes a
 * drop-out look mass-remediated, so coverage is decided before remediation is read. Rule 4
 * exists because an asset that has NEVER closed anything is the strongest possible case of
 * cold, and refusing to say so just because nothing was measured would hide exactly the assets
 * this page is for — the bound is published alongside so the claim is auditable. Rule 6 is the
 * honest remainder: no movement, and not enough watched time to call it.
 */
export function coldZoneProfile(rows: ColdRow[], opts: ColdZoneOptions): ColdZoneResult {
  // REFUSE BEFORE CASTING. A typo in a timestamp would otherwise silently publish a
  // duration measured from the epoch, and every asset would be cold.
  const nowMs = parseTs(opts.now);
  if (nowMs === null) {
    throw new Error(`coldZoneProfile: unparseable now (${JSON.stringify(opts.now)})`);
  }
  const observedFromOpt = opts.observedFrom ?? null;
  const observedFromMs = observedFromOpt === null ? null : parseTs(observedFromOpt);
  if (observedFromOpt !== null && observedFromMs === null) {
    throw new Error(
      `coldZoneProfile: unparseable observedFrom (${JSON.stringify(observedFromOpt)})`,
    );
  }
  const t = Number(opts.coldAfterDays);
  if (!Number.isFinite(t) || t <= 0) {
    // The buckets are thirds of this number; a zero or a NaN would make every edge
    // meaningless and every asset cold. Clamping belongs in the settings layer
    // (`COLD_AFTER_DAYS_MIN`/`MAX`), so anything that gets past it is a caller bug.
    throw new Error(`coldZoneProfile: coldAfterDays must be a positive number (${String(opts.coldAfterDays)})`);
  }

  // The mode, and the two options it makes REQUIRED. Relative mode without a target or a
  // floor is not a shape this module can guess its way out of: a default target would be a
  // second place a published share could come from, and a missing floor would let a healthy
  // estate's sort order decide who is cold. Both refusals are caller bugs — the settings
  // layer clamps these to `config`'s bounds before they ever get here.
  const mode: ColdZoneMode = opts.mode ?? DEFAULT_COLD_ZONE_MODE;
  if (!COLD_ZONE_MODES.includes(mode)) {
    throw new Error(
      `coldZoneProfile: mode must be one of ${COLD_ZONE_MODES.join(" | ")} (${JSON.stringify(opts.mode)})`,
    );
  }
  const relative = mode === "relative";
  const targetSharePct = relative ? Number(opts.targetSharePct) : null;
  const floorDays = relative ? Number(opts.floorDays) : null;
  if (relative && (!Number.isFinite(targetSharePct!) || targetSharePct! <= 0 || targetSharePct! > 100)) {
    throw new Error(
      `coldZoneProfile: relative mode requires targetSharePct in (0, 100] (${String(opts.targetSharePct)})`,
    );
  }
  if (relative && (!Number.isFinite(floorDays!) || floorDays! <= 0)) {
    throw new Error(
      `coldZoneProfile: relative mode requires floorDays to be a positive number (${String(opts.floorDays)})`,
    );
  }

  // Classify once, over every row — the counts below report on what was handed in, not on
  // what survived. `classifyRisk` never throws: a row whose enabled signals were never
  // captured comes back `unknown`, which is a measurement gap and is counted as one.
  let unclassifiedRows = 0;
  const classified: { row: ColdRow; risk: RiskClass }[] = [];
  for (const row of rows) {
    const risk = classifyRisk(row, opts.rule);
    if (risk === "unknown") unclassifiedRows += 1;
    classified.push({ row, risk });
  }

  // Rows with no asset belong to no cell of this page. Dropped, and counted.
  let droppedNoAsset = 0;
  const byAsset = new Map<string, AssetAcc>();
  for (const { row, risk } of classified) {
    if (blank(row.asset_id)) {
      droppedNoAsset += 1;
      continue;
    }
    const id = String(row.asset_id).trim();
    let acc = byAsset.get(id);
    if (!acc) {
      acc = newAcc(id);
      byAsset.set(id, acc);
    }
    foldRow(acc, row, risk);
  }

  // Observation is decided even when the block is not measurable, so `severities_without_scan`
  // reports either way — the reader needs to know coverage is undecidable before they need
  // to know how long the silence was.
  const severitiesWithoutScan = new Set<string>();
  const observedById = new Map<string, boolean>();
  for (const acc of byAsset.values()) {
    observedById.set(acc.assetId, isObserved(acc, opts.newestScanBySeverity, severitiesWithoutScan));
  }
  const severitiesWithoutScanList = [...severitiesWithoutScan].sort(cmp);

  const base = {
    observed_from: observedFromMs === null ? null : toIso(observedFromMs),
    as_of: toIso(nowMs)!,
    row_count: rows.length,
    dropped_no_asset: droppedNoAsset,
    unclassified_rows: unclassifiedRows,
    severities_without_scan: severitiesWithoutScanList,
  };
  const modeBase = {
    mode,
    fixed_after_days: t,
    target_share_pct: targetSharePct,
    floor_days: floorDays,
  };

  if (observedFromMs === null) {
    // No clock, so no population, so nothing to derive a line FROM. In relative mode the line
    // still has to be a number the page can print, and the only number that owes nothing to a
    // population we could not read is the floor. `derived_days`, `eligible_assets` and
    // `cold_bound_only` are null for the same reason `assets` is: they are facts about an
    // estate this read never got to look at.
    return {
      measurable: false,
      ...modeBase,
      cold_after_days: relative ? floorDays! : t,
      achieved_share_pct: null,
      floor_applied: false,
      derived_days: null,
      eligible_assets: null,
      cold_bound_only: null,
      ...base,
      bucket_edges: null,
      bucket_labels: null,
      assets: null,
      groups: null,
      totals: null,
    };
  }

  // ---------------------------------------------------------------- pass A: what the
  // threshold cannot change. Idle time, the bound, observation and the drop-out fingerprint
  // are all decided before any line is drawn — which is exactly why the relative line can be
  // derived from them without a fixed-point iteration. `unobserved` and `clear` are
  // threshold-independent too, so the eligible population is knowable here.
  const facts: AssetFacts[] = [];
  for (const acc of byAsset.values()) {
    const observed = observedById.get(acc.assetId) === true;
    const idleDays = acc.movementAt === null ? null : daysBetween(acc.movementAt, nowMs);
    // The bound: the later of "when we started watching" and "when this asset's oldest
    // finding was first seen". Watching time before the asset existed is not silence
    // anybody could have broken, and neither is the asset's life before we looked.
    const boundStart =
      acc.earliestFirstSeen === null ? observedFromMs : Math.max(observedFromMs, acc.earliestFirstSeen);
    const idleBoundDays = idleDays === null ? daysBetween(boundStart, nowMs) : null;
    const idleReading = idleDays ?? idleBoundDays;

    let disappearedAt: number | null = null;
    let disappearedCount = 0;
    for (const [at, count] of acc.disappeared) {
      // The MODE, with the later instant winning a tie: a mass close is one scan's event,
      // and the most recent one is the drop-out the reader is looking at.
      if (count > disappearedCount || (count === disappearedCount && disappearedAt !== null && at > disappearedAt)) {
        disappearedAt = at;
        disappearedCount = count;
      }
    }

    facts.push({
      acc,
      observed,
      idleDays,
      idleBoundDays,
      idleReading,
      disappearedAt,
      disappearedCount,
      // Eligible for the share: still scanned, and something is still open on it. An asset
      // the scanner lost is not evidence about engagement, and one with nothing open cannot be
      // in a zone that measures unclosed work.
      eligible: observed && acc.open > 0,
    });
  }

  // ---------------------------------------------------------------- the derivation
  const eligible = facts.filter((f) => f.eligible);
  const eligibleAssets = eligible.length;
  let derivedDays: number | null = null;
  let floorApplied = false;
  let effective = t;
  if (relative) {
    if (eligibleAssets > 0) {
      // A RANK, NOT `util.quantile`. That helper interpolates between the two neighbouring
      // order statistics, which would put the line at a number NO asset sits on (46.4 days
      // between one at 44 and one at 50) and would make the resulting count unpredictable at
      // small n — a "20% cut" that catches 1 of 5 in one estate and 2 of 5 in another with
      // the same shape. The k-th largest reading is a line the reader can go and stand on, and
      // because the test stays `>=`, ties AT that reading are all cold rather than being split
      // by an interpolation nobody can see.
      const readings = eligible.map((f) => f.idleReading!).sort((a, b) => b - a);
      const k = Math.min(eligibleAssets, Math.max(1, Math.ceil((targetSharePct! / 100) * eligibleAssets)));
      // Floored to WHOLE DAYS so `fmtDays` prose and the "≥ N d" cells cannot contradict each
      // other. Flooring can only ever widen the zone, so `cold_assets >= k` still holds.
      derivedDays = Math.floor(readings[k - 1]);
      effective = Math.max(derivedDays, floorDays!);
      floorApplied = derivedDays < floorDays!;
    } else {
      // Nothing to rank. The line rests on the floor, and `derived_days` stays NULL rather
      // than reporting a zero nobody derived. `floor_applied` is false because the floor held
      // nothing back — there was no derived line for it to overrule.
      effective = floorDays!;
      derivedDays = null;
      floorApplied = false;
    }
  }

  const bucketEdges = [0, effective / 3, (2 * effective) / 3, effective];
  const bucketLabels = [
    `${fmtDays(0)}–${fmtDays(effective / 3)} d`,
    `${fmtDays(effective / 3)}–${fmtDays((2 * effective) / 3)} d`,
    `${fmtDays((2 * effective) / 3)}–${fmtDays(effective)} d`,
    `≥ ${fmtDays(effective)} d`,
    "not yet measurable",
  ];

  // ---------------------------------------------------------------- pass B: the verdict and
  // the bucket, read off the EFFECTIVE line — the only place either mode's choice can matter.
  const assets: ColdAssetRow[] = [];
  let coldBoundOnly = 0;
  for (const f of facts) {
    const { acc, observed, idleDays, idleBoundDays, idleReading, disappearedAt, disappearedCount } = f;

    let verdict: ColdVerdict;
    if (!observed) verdict = "unobserved";
    else if (acc.open === 0) verdict = "clear";
    else if (idleDays !== null && idleDays >= effective) verdict = "cold";
    else if (idleDays === null && idleBoundDays !== null && idleBoundDays >= effective) verdict = "cold";
    else if (idleDays !== null) verdict = "warm";
    else verdict = "watching";

    if (verdict === "cold" && idleDays === null) coldBoundOnly += 1;

    const bucket =
      verdict === "unobserved" || verdict === "clear"
        ? null
        : verdict === "watching"
          ? 4
          : bucketOf(idleReading!, effective);

    assets.push({
      asset_id: acc.assetId,
      asset_name: acc.assetName,
      asset_type: acc.assetType,
      cloud: acc.cloud,
      support_group: acc.supportGroup,
      open_findings: acc.open,
      open_high_risk: acc.openHigh,
      oldest_open_age_days:
        acc.oldestOpenFirstSeen === null ? null : daysBetween(acc.oldestOpenFirstSeen, nowMs),
      last_movement_at: toIso(acc.movementAt),
      idle_days: idleDays,
      idle_bound_days: idleBoundDays,
      idle_is_bound: idleDays === null,
      idle_reading_days: idleReading,
      observed,
      last_observed_at: toIso(acc.lastSeen),
      unobserved_for_days: acc.lastSeen === null ? null : daysBetween(acc.lastSeen, nowMs),
      disappeared_at: toIso(disappearedAt),
      disappeared_at_last_observation: disappearedCount,
      reopened_open: acc.reopenedOpen,
      verdict,
      cold: verdict === "cold",
      bucket,
    });
  }

  assets.sort(
    (a, b) =>
      VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
      b.open_findings - a.open_findings ||
      cmp(a.asset_name ?? a.asset_id, b.asset_name ?? b.asset_id),
  );

  const groups = rankGroups(rollUp(assets), mode, targetSharePct);
  const totals = totalsOf(assets, groups);

  return {
    measurable: true,
    ...modeBase,
    cold_after_days: effective,
    achieved_share_pct: totals.cold_asset_share_pct,
    floor_applied: floorApplied,
    derived_days: derivedDays,
    eligible_assets: eligibleAssets,
    cold_bound_only: coldBoundOnly,
    ...base,
    bucket_edges: bucketEdges,
    bucket_labels: bucketLabels,
    assets,
    groups,
    totals,
  };
}

/**
 * Per support group. The NULL key is a real bucket and is labelled `COLD_GROUP_NONE` — it is
 * never dropped and never pinned last, because "nobody is on the hook for these assets" is one
 * of the answers the page exists to give, not a gap in the data to be tidied away. It is also
 * where every asset lands when the support-group map has never been loaded, which the page
 * says in the map-health wording rather than leaving the reader to guess.
 */
function rollUp(assets: ColdAssetRow[]): ColdGroupRow[] {
  const byGroup = new Map<string | null, ColdAssetRow[]>();
  for (const a of assets) {
    const list = byGroup.get(a.support_group);
    if (list) list.push(a);
    else byGroup.set(a.support_group, [a]);
  }

  const out: ColdGroupRow[] = [];
  for (const [supportGroup, list] of byGroup) {
    const buckets = [0, 0, 0, 0, 0];
    const bucketOpen = [0, 0, 0, 0, 0];
    let observed = 0;
    let unobserved = 0;
    let unobservedOpen = 0;
    let unobservedClear = 0;
    let withOpen = 0;
    let coldAssets = 0;
    let watching = 0;
    let warm = 0;
    let clear = 0;
    let openFindings = 0;
    let openInCold = 0;
    let highInCold = 0;
    let openInUnobserved = 0;
    let lastMovement: number | null = null;

    for (const a of list) {
      openFindings += a.open_findings;
      if (a.observed) {
        observed += 1;
        // Over OBSERVED assets only: a drop-out's disappearance close is the scanner's
        // event, not this group's work, and must not refresh the group's last-movement date.
        const at = parseTs(a.last_movement_at);
        if (at !== null && (lastMovement === null || at > lastMovement)) lastMovement = at;
      } else {
        unobserved += 1;
        openInUnobserved += a.open_findings;
        // Split on the one question that separates a coverage problem from a decommissioning:
        // is anything still open on it? The asset's verdict stays `unobserved` either way —
        // this is a count, not a sixth state, so nothing downstream of the verdict moves.
        if (a.open_findings > 0) unobservedOpen += 1;
        else unobservedClear += 1;
      }
      if (a.bucket !== null) {
        buckets[a.bucket] += 1;
        bucketOpen[a.bucket] += a.open_findings;
      }
      switch (a.verdict) {
        case "cold":
          coldAssets += 1;
          withOpen += 1;
          openInCold += a.open_findings;
          highInCold += a.open_high_risk;
          break;
        case "warm":
          warm += 1;
          withOpen += 1;
          break;
        case "watching":
          watching += 1;
          withOpen += 1;
          break;
        case "clear":
          clear += 1;
          break;
        default:
          break;
      }
    }

    const verdict: GroupVerdict =
      withOpen === 0 ? "clear" : coldAssets === withOpen ? "fully-cold" : coldAssets > 0 ? "partly-cold" : "warm";

    out.push({
      support_group: supportGroup,
      label: supportGroup ?? COLD_GROUP_NONE,
      assets: list.length,
      assets_observed: observed,
      assets_unobserved: unobserved,
      assets_unobserved_open: unobservedOpen,
      assets_unobserved_clear: unobservedClear,
      assets_with_open: withOpen,
      cold_assets: coldAssets,
      watching_assets: watching,
      warm_assets: warm,
      clear_assets: clear,
      open_findings: openFindings,
      open_in_cold: openInCold,
      high_risk_in_cold: highInCold,
      open_in_unobserved: openInUnobserved,
      cold_share_pct: safePct(coldAssets, withOpen),
      last_movement_at: toIso(lastMovement),
      verdict,
      // Filled by `rankGroups`, which runs over the finished roll-up: the rank is a fact about
      // the whole set of groups, so no single group's fold can know it.
      relative_rank: null,
      in_coldest_share: false,
      buckets,
      bucket_open: bucketOpen,
    });
  }

  out.sort(
    (a, b) => b.cold_assets - a.cold_assets || b.open_in_cold - a.open_in_cold || cmp(a.label, b.label),
  );
  return out;
}

/**
 * The group-level relative position, added to the finished roll-up WITHOUT reordering it.
 *
 * The published order is the one `rollUp` set (cold assets desc), because that is the order
 * the table is read in and changing it under a reader would be a different page. The rank is a
 * separate column measured on a different axis — the SHARE of a group's open-finding assets
 * that are cold, so a group with three cold assets out of three outranks one with five out of
 * fifty. Tie-breaks: `open_in_cold` desc, then label asc for determinism.
 *
 * Three refusals, all of them about not badging somebody the arithmetic merely swept up:
 *   * Only groups with `assets_with_open > 0` are ranked at all. A group with nothing open
 *     has a NULL cold share, and a rank over a null is an invention.
 *   * `C` — the ranked groups that actually have a cold asset — CLAMPS the badge. "The coldest
 *     20%" of an estate where only one group has anything cold is that one group, never a
 *     second one whose cold share is zero.
 *   * Ties at the cutoff are extended through, on `(cold_share_pct, open_in_cold)`. The label
 *     tie-break orders the table; it must never decide a badge, because that would make the
 *     mark a fact about spelling.
 *
 * Fixed mode still computes the ranks — the payload has one shape in both modes, and the
 * column can be read without the badge — but marks nobody: `in_coldest_share` is a statement
 * about a target share, and fixed mode never named one.
 */
function rankGroups(
  groups: ColdGroupRow[],
  mode: ColdZoneMode,
  targetSharePct: number | null,
): ColdGroupRow[] {
  const ranked = groups
    .filter((group) => group.assets_with_open > 0)
    .sort(
      (a, b) =>
        (b.cold_share_pct ?? 0) - (a.cold_share_pct ?? 0) ||
        b.open_in_cold - a.open_in_cold ||
        cmp(a.label, b.label),
    );
  const rankOf = new Map<ColdGroupRow, number>();
  ranked.forEach((group, i) => rankOf.set(group, i + 1));

  const total = ranked.length;
  const withCold = ranked.filter((group) => group.cold_assets > 0).length;
  let want = 0;
  if (mode === "relative" && withCold > 0 && targetSharePct !== null) {
    want = Math.min(withCold, Math.max(1, Math.ceil((targetSharePct / 100) * total)));
    // Extend through a tie at the cutoff — see the refusals above. The walk stops at `withCold`
    // by construction as well as by the guard: every group past that point has a cold share
    // of 0, which cannot tie with the share of a group that has a cold asset.
    while (
      want < withCold &&
      (ranked[want].cold_share_pct ?? 0) === (ranked[want - 1].cold_share_pct ?? 0) &&
      ranked[want].open_in_cold === ranked[want - 1].open_in_cold
    ) {
      want += 1;
    }
  }

  // A NEW array in the PUBLISHED order — `rankGroups` is pure and the caller's sort survives it.
  return groups.map((group) => {
    const rank = rankOf.get(group) ?? null;
    return { ...group, relative_rank: rank, in_coldest_share: rank !== null && rank <= want };
  });
}

function totalsOf(assets: ColdAssetRow[], groups: ColdGroupRow[]): ColdZoneTotals {
  const buckets = [0, 0, 0, 0, 0];
  const bucketOpen = [0, 0, 0, 0, 0];
  const t: ColdZoneTotals = {
    assets: assets.length,
    assets_observed: 0,
    assets_unobserved: 0,
    assets_unobserved_open: 0,
    assets_unobserved_clear: 0,
    assets_with_open: 0,
    cold_assets: 0,
    watching_assets: 0,
    warm_assets: 0,
    clear_assets: 0,
    open_findings: 0,
    open_in_cold: 0,
    high_risk_in_cold: 0,
    open_in_unobserved: 0,
    cold_asset_share_pct: null,
    cold_backlog_share_pct: null,
    groups: groups.length,
    groups_fully_cold: 0,
    groups_partly_cold: 0,
    groups_in_coldest_share: 0,
    assets_no_support_group: 0,
    buckets,
    bucket_open: bucketOpen,
  };

  for (const group of groups) {
    t.assets_observed += group.assets_observed;
    t.assets_unobserved += group.assets_unobserved;
    t.assets_unobserved_open += group.assets_unobserved_open;
    t.assets_unobserved_clear += group.assets_unobserved_clear;
    t.assets_with_open += group.assets_with_open;
    t.cold_assets += group.cold_assets;
    t.watching_assets += group.watching_assets;
    t.warm_assets += group.warm_assets;
    t.clear_assets += group.clear_assets;
    t.open_findings += group.open_findings;
    t.open_in_cold += group.open_in_cold;
    t.high_risk_in_cold += group.high_risk_in_cold;
    t.open_in_unobserved += group.open_in_unobserved;
    if (group.verdict === "fully-cold") t.groups_fully_cold += 1;
    if (group.verdict === "partly-cold") t.groups_partly_cold += 1;
    // Counted off the rows themselves rather than passed in from the derivation, so the
    // figure and the marks on the table can never disagree about how many were badged.
    if (group.in_coldest_share) t.groups_in_coldest_share += 1;
    if (group.support_group === null) t.assets_no_support_group = group.assets;
    for (let i = 0; i < 5; i += 1) {
      buckets[i] += group.buckets[i];
      bucketOpen[i] += group.bucket_open[i];
    }
  }

  t.cold_asset_share_pct = safePct(t.cold_assets, t.assets_with_open);
  t.cold_backlog_share_pct = safePct(t.open_in_cold, t.open_findings);
  return t;
}

/**
 * The Executive card's slice: the totals, the clock and the threshold — never the arrays.
 *
 * CAPPED IN THE MODEL, NOT SLICED AT THE EDGE (the `fixNext` pattern). A page that received
 * the whole profile and rendered one number would ship every asset name in the estate into a
 * payload that had no use for them, and the next reader of that payload would have no way to
 * know which half was meant to be drawn.
 */
export function coldZoneHeadline(result: ColdZoneResult): ColdZoneHeadline {
  return {
    measurable: result.measurable,
    mode: result.mode,
    cold_after_days: result.cold_after_days,
    fixed_after_days: result.fixed_after_days,
    target_share_pct: result.target_share_pct,
    achieved_share_pct: result.achieved_share_pct,
    floor_days: result.floor_days,
    floor_applied: result.floor_applied,
    derived_days: result.derived_days,
    eligible_assets: result.eligible_assets,
    cold_bound_only: result.cold_bound_only,
    observed_from: result.observed_from,
    as_of: result.as_of,
    totals: result.totals,
    row_count: result.row_count,
    dropped_no_asset: result.dropped_no_asset,
    unclassified_rows: result.unclassified_rows,
    severities_without_scan: result.severities_without_scan,
  };
}
