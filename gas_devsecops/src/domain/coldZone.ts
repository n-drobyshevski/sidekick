// The cold zone: where nothing is closing at all.
//
// The rest of this register answers "how fast is code risk closing". This module answers the
// other question — WHERE HAS IT STOPPED. A repository can carry a small backlog and still be
// the worst thing on the page if nobody has touched it since January; a repository with a
// thousand findings and a fix landing every week is not a problem of engagement. Backlog size
// cannot tell those two apart, so this family measures IDLE TIME instead of volume.
//
// Structural twin of `src/domain/assets.ts`: options carry the clock (`observedFrom` / `now`)
// and the classifier (`rule`), an unparseable clock REFUSES rather than casting to null,
// rows that belong to no asset are dropped AND COUNTED, `secrets` rows are carried at risk
// `unknown` (because `program.resolveRule` throws on that scope by design) and counted, and
// the published order has a name tie-break so two runs over the same ledger diff cleanly.
//
// Pure: no clock of its own, no I/O, no persistence. Every duration here is measured against
// the caller's `now`, which the server sets to the LEDGER's clock (the newest scan's `ts`),
// never `Date.now()` — an idle time dated by the wall clock would grow every time the page
// was opened and would be a different number on every read of the same durable cache.
//
// -------------------------------------------------------------------------------------
// TWO STATES, NOT ONE, and the second one is the whole reason this module is careful:
//
//   cold        the repository is still being scanned, it still has open findings, and no
//               finding on it has been resolved, removed or rotated for at least the
//               threshold. That is a fact about the TEAM.
//   unobserved  the scanner stopped returning the repository. That is a fact about the
//               SCANNER, and it is tested FIRST, because `reconcile` resolves findings that
//               are absent from the newest scan BY DISAPPEARANCE (reconcile.ts's
//               `RESOLUTION_DISAPPEARED`). A repository that drops out of coverage therefore
//               looks mass-remediated in exactly one scan. Reading that as warmth would
//               reward losing sight of a repository, which is the single worst thing this
//               page could do. So an unobserved repository is never warm, never cold, sits
//               in no idle bucket, and publishes `disappeared_at` and how many findings
//               closed at that instant so the reader can see the shape of the drop-out.
//
// WHAT THE COLUMNS REFUSE TO SAY:
//   * `observedFrom === null` ⇒ `repos`, `teams`, `totals`, `bucket_edges` and
//     `bucket_labels` are ALL null, never empty arrays and never zeros. With no scan on
//     record the register cannot say when it started watching, and every figure here is
//     "how long since something happened" — a duration with no origin. `row_count`,
//     `dropped_no_repo`, `unclassified_secrets` and `scopes_without_scan` still report, so
//     an empty section can prove it looked.
//   * A repository with no movement on record gets NO `idle_days`. It gets `idle_bound_days`
//     — a LOWER bound measured from the later of "when we started watching" and "when this
//     repository's oldest finding was first seen" — and `idle_is_bound: true` so the page
//     prints "≥ N d" rather than a number nobody measured. Never having seen a close is not
//     the same fact as having measured a long silence, and the two must not render alike.
//   * `cold_share_pct` and the two totals shares are NULL over an empty denominator, never
//     0%. "No repository has open findings" and "0% of them are cold" are different answers.
//   * `oldest_open_age_days` is derived from `first_seen` against the caller's `now`, NEVER
//     from the row's stored `age_days` — that column is a wall-clock read and would make
//     this block disagree with itself across two loads of the same cached model.
//   * A scope that has rows but no scan on record is UNDECIDABLE, so the repository stays
//     observed (the conservative direction: we do not accuse a team of vanishing on the
//     strength of a missing scan row) and the scope is named in `scopes_without_scan`.
//
// THRESHOLD SEMANTICS: `>=`, everywhere. Exactly 90.0 days idle is cold, matching the
// register's "≥ N" wording rule (README / PRODUCT.md) — the page never prints ">".

import { RESOLUTION_DISAPPEARED, RESOLVED_STATUSES, type Scope } from "./config";
import type { BaseRow } from "./ledgerTypes";
import { classifyRisk, type AnyRiskRule, type RiskClass, type RiskRow } from "./program";
import { cmp, parseTs, present, toIso } from "./util";

const DAY_MS = 86_400_000;

/** The label the null `owner_project` bucket is published under — a real row, never a drop. */
export const COLD_PROJECT_NONE = "(no project)";

// --------------------------------------------------------------------------- input shape

/**
 * The projection this module reads. A `BaseRow` satisfies it structurally, which is the
 * intended input; the narrow type is here so a test (or a page) can build one without
 * inventing 40 ledger columns — the same bargain `assets.ts`'s `AssetRow` makes.
 *
 * `RiskRow` rides along because `risk_class` is not a stored column in this register: it is
 * derived per row by `program.classifyRisk`, so "high risk sitting cold" and the confusion
 * matrix cannot disagree about what "high" means.
 */
export type ColdRow = RiskRow &
  Pick<
    BaseRow,
    | "repo_id"
    | "repo_name"
    | "owner_project"
    | "scope"
    | "status"
    | "first_seen"
    | "last_seen"
    | "resolved_at"
    | "resolution_src"
    | "removed_at"
    | "rotated_at"
    | "reopened_count"
    | "last_scan_id"
  >;

/** The newest scan of one scope — what "the scanner still sees this repository" is tested against. */
export interface NewestScan {
  scan_id: string | null;
  ts: string | number | Date | null;
}

export interface ColdZoneOptions {
  /** The evaluation instant. An option, never `Date.now()` — this module is pure. */
  now: string | number | Date;
  /**
   * The earliest scan on record — when this register started WATCHING. `null` is a
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
  /** Per scope, the newest scan — a scope absent from this map is undecidable, not stale. */
  newestScanByScope: Partial<Record<Scope, NewestScan>>;
  /** Omit to let each row's scope choose its classifier (`config.ruleForScope`). */
  rule?: AnyRiskRule;
}

// --------------------------------------------------------------------------- output shape

/** Repository states, in the order the verdict table tests them. */
export type ColdVerdict = "unobserved" | "clear" | "cold" | "warm" | "watching";

/** What counts as movement. Three columns, because they are three events. */
export type MovementKind = "resolved" | "removed" | "rotated";

/** Project states, rolled up from the repositories that have open findings. */
export type TeamVerdict = "fully-cold" | "partly-cold" | "warm" | "clear";

export interface ColdRepoRow {
  repo_id: string;
  /** Display name; falls back to the id when no row carried one. */
  repo_name: string | null;
  /** `owner_project`. NULL is a real answer and is rolled up under `COLD_PROJECT_NONE`. */
  project: string | null;
  open_findings: number;
  open_high_risk: number;
  /** Age of the oldest OPEN finding, from `first_seen` against `now`. Never from `age_days`. */
  oldest_open_age_days: number | null;
  /** Latest of `resolved_at` / `removed_at` / `rotated_at` over ALL rows, open or not. */
  last_movement_at: string | null;
  last_movement_kind: MovementKind | null;
  /** Measured silence. NULL means no movement was ever recorded — not "zero days idle". */
  idle_days: number | null;
  /** The LOWER bound used when nothing was ever measured. Null when `idle_days` is real. */
  idle_bound_days: number | null;
  idle_is_bound: boolean;
  /** What the page prints: the measurement if there is one, else the bound (as "≥ N d"). */
  idle_reading_days: number | null;
  /** The scanner still returns this repository in the newest scan of some scope it has rows in. */
  observed: boolean;
  last_observed_at: string | null;
  /** The instant that closed the most findings by DISAPPEARANCE — the drop-out's fingerprint. */
  disappeared_at: string | null;
  /** How many findings closed at that instant. A big number beside a recent date is a drop-out. */
  disappeared_at_last_observation: number;
  /** Open findings that have come back at least once — why a repo with no movement went quiet. */
  reopened_open: number;
  verdict: ColdVerdict;
  cold: boolean;
  /** Idle bucket 0..3, or 4 for "not yet measurable". NULL for unobserved and clear repos. */
  bucket: number | null;
}

export interface ColdTeamRow {
  project: string | null;
  label: string;
  repos: number;
  repos_observed: number;
  repos_unobserved: number;
  /** OBSERVED repos with at least one open finding — the denominator of `cold_share_pct`. */
  repos_with_open: number;
  cold_repos: number;
  watching_repos: number;
  warm_repos: number;
  clear_repos: number;
  open_findings: number;
  open_in_cold: number;
  high_risk_in_cold: number;
  /** Open findings on repositories the scanner has lost sight of — counted apart, never cold. */
  open_in_unobserved: number;
  cold_share_pct: number | null;
  /** Over OBSERVED repositories only: a drop-out's disappearance close is not this team's work. */
  last_movement_at: string | null;
  verdict: TeamVerdict;
  /** Repos per idle bucket, length 5 (the fifth is "not yet measurable"). */
  buckets: number[];
  /** Open findings per idle bucket, same length — a cell says how much sits in it, not just how many. */
  bucket_open: number[];
}

export interface ColdZoneTotals {
  repos: number;
  repos_observed: number;
  repos_unobserved: number;
  repos_with_open: number;
  cold_repos: number;
  watching_repos: number;
  warm_repos: number;
  clear_repos: number;
  open_findings: number;
  open_in_cold: number;
  high_risk_in_cold: number;
  open_in_unobserved: number;
  /** cold repositories / repositories with open findings. NULL over an empty denominator. */
  cold_repo_share_pct: number | null;
  /** open findings sitting cold / all open findings — the Executive card's one number. */
  cold_backlog_share_pct: number | null;
  teams: number;
  teams_fully_cold: number;
  teams_partly_cold: number;
  /** Repositories with no `owner_project` at all — the ownership gap, published as a figure. */
  repos_no_project: number;
  buckets: number[];
  bucket_open: number[];
}

export interface ColdZoneResult {
  /** `observedFrom !== null`. False ⇒ every derived block below is null. */
  measurable: boolean;
  cold_after_days: number;
  observed_from: string | null;
  /** The instant every duration here was measured against — the clock says where it stood. */
  as_of: string;
  /** Lower edge of each of the four measured buckets: `[0, t/3, 2t/3, t]`. */
  bucket_edges: number[] | null;
  bucket_labels: string[] | null;
  repos: ColdRepoRow[] | null;
  teams: ColdTeamRow[] | null;
  totals: ColdZoneTotals | null;
  /** Rows handed in, before any drop — so a zero elsewhere can prove it looked. */
  row_count: number;
  /** Rows with a blank `repo_id`: dropped, because they belong to no repository, AND counted. */
  dropped_no_repo: number;
  /**
   * `secrets` rows carried at `risk_class = "unknown"`. `program.classifyRisk` REFUSES that
   * scope by design (there is no exploit intelligence for a hardcoded string, and severity
   * there grades a DETECTION), so they can never be high risk — but a leaked credential is a
   * real open finding, so they still count toward `open_findings`, and their `removed_at` /
   * `rotated_at` still counts as movement.
   */
  unclassified_secrets: number;
  /** Scopes with rows but no scan on record: observation is undecidable for them, and said so. */
  scopes_without_scan: Scope[];
}

/** The Executive projection: the totals and the clock, never the per-repo or per-team arrays. */
export interface ColdZoneHeadline {
  measurable: boolean;
  cold_after_days: number;
  observed_from: string | null;
  as_of: string;
  totals: ColdZoneTotals | null;
  row_count: number;
  dropped_no_repo: number;
  unclassified_secrets: number;
  scopes_without_scan: Scope[];
}

// --------------------------------------------------------------------------- small helpers

/** Same open/resolved test the rest of the domain uses (brick `metrics.is_open`). */
function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

/** True for null / undefined / NaN / whitespace-only — `util.present` read the other way. */
function blank(v: unknown): boolean {
  return !present(v);
}

/**
 * `numerator / denominator * 100`, or NULL when there is nothing to divide by.
 * NULL, never 0 — a share over an empty population is unknown, and rendering it as 0% is a
 * lie the reader cannot detect. Same rule as `assets.ts`'s `safePct` (metrics.py:179-185).
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

/** Movement beats movement in this order when two land on the same instant. */
const MOVEMENT_RANK: Record<MovementKind, number> = { resolved: 0, removed: 1, rotated: 2 };

/** The published order of repository states — worst engagement first. */
const VERDICT_RANK: Record<ColdVerdict, number> = {
  cold: 0,
  unobserved: 1,
  watching: 2,
  warm: 3,
  clear: 4,
};

// --------------------------------------------------------------------------- per repository

interface RepoAcc {
  repoId: string;
  repoName: string | null;
  project: string | null;
  scopes: Set<Scope>;
  rowsByScope: Map<Scope, ColdRow[]>;
  open: number;
  openHigh: number;
  reopenedOpen: number;
  /** Earliest `first_seen` over OPEN rows — the oldest thing still sitting there. */
  oldestOpenFirstSeen: number | null;
  /** Earliest `first_seen` over ALL rows — one half of the idle lower bound. */
  earliestFirstSeen: number | null;
  lastSeen: number | null;
  movementAt: number | null;
  movementKind: MovementKind | null;
  /** Disappearance closes, counted per instant: the mode is the drop-out's fingerprint. */
  disappeared: Map<number, number>;
}

function newAcc(repoId: string): RepoAcc {
  return {
    repoId,
    repoName: null,
    project: null,
    scopes: new Set(),
    rowsByScope: new Map(),
    open: 0,
    openHigh: 0,
    reopenedOpen: 0,
    oldestOpenFirstSeen: null,
    earliestFirstSeen: null,
    lastSeen: null,
    movementAt: null,
    movementKind: null,
    disappeared: new Map(),
  };
}

/**
 * Fold one row into its repository.
 *
 * MOVEMENT IS READ REGARDLESS OF STATUS, and that is not an oversight. A secrets row can be
 * OPEN and carry a `rotated_at` (reconcile.ts: the credential was observed dead while the
 * string is still in HEAD) or a `removed_at` (the string left HEAD while the credential is
 * still live). Both are real remediation work on this repository. Gating movement on the row
 * being closed would report an actively-rotating team as frozen.
 */
function foldRow(acc: RepoAcc, row: ColdRow, risk: RiskClass): void {
  if (acc.repoName === null && !blank(row.repo_name)) acc.repoName = String(row.repo_name);
  if (acc.project === null && !blank(row.owner_project)) acc.project = String(row.owner_project);
  acc.scopes.add(row.scope);
  const bucket = acc.rowsByScope.get(row.scope);
  if (bucket) bucket.push(row);
  else acc.rowsByScope.set(row.scope, [row]);

  const open = isOpen(row.status);
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

  const moves: [MovementKind, unknown][] = [
    ["resolved", row.resolved_at],
    ["removed", row.removed_at],
    ["rotated", row.rotated_at],
  ];
  for (const [kind, value] of moves) {
    const ms = parseTs(value);
    if (ms === null) continue;
    if (
      acc.movementAt === null ||
      ms > acc.movementAt ||
      (ms === acc.movementAt && MOVEMENT_RANK[kind] < MOVEMENT_RANK[acc.movementKind!])
    ) {
      acc.movementAt = ms;
      acc.movementKind = kind;
    }
  }

  if (String(row.resolution_src ?? "") === RESOLUTION_DISAPPEARED) {
    const at = parseTs(row.resolved_at);
    if (at !== null) acc.disappeared.set(at, (acc.disappeared.get(at) ?? 0) + 1);
  }
}

/**
 * Is the scanner still returning this repository?
 *
 * PER SCOPE, and observed if ANY scope reaches its own newest scan — an sca-only sweep must
 * not mark every sast row of a perfectly healthy repository as vanished. The primary test is
 * `last_scan_id === newestScanByScope[scope].scan_id`; a blank `last_scan_id` falls back to
 * `last_seen >= newest.ts`, because an older ledger row can carry the sighting without the
 * scan id. A scope with rows but NO scan on record is undecidable and resolves to observed —
 * and is named in `scopes_without_scan`, so the reader knows which way the doubt fell.
 */
function isObserved(
  acc: RepoAcc,
  newestByScope: Partial<Record<Scope, NewestScan>>,
  scopesWithoutScan: Set<Scope>,
): boolean {
  let observed = false;
  for (const scope of acc.scopes) {
    const newest = newestByScope[scope];
    if (!newest) {
      scopesWithoutScan.add(scope);
      observed = true;
      continue;
    }
    const rows = acc.rowsByScope.get(scope) ?? [];
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
 * The cold-zone profile: one row per repository, one per project, and the totals.
 *
 * The verdict table, first match wins — the ORDER is the contract:
 *
 *   1  no row reaches the newest scan of any scope the repo has rows in   unobserved
 *   2  open_findings === 0                                                clear
 *   3  idle_days !== null    && idle_days       >= coldAfterDays          cold (measured)
 *   4  idle_days === null    && idle_bound_days >= coldAfterDays          cold (bound)
 *   5  idle_days !== null                                                 warm
 *   6  otherwise (no movement, bound under threshold)                     watching
 *
 * Rule 1 sits first for the reason the module header gives: disappearance-resolution makes a
 * drop-out look mass-remediated, so coverage is decided before remediation is read. Rule 4
 * exists because a repository that has NEVER closed anything is the strongest possible case
 * of cold, and refusing to say so just because nothing was measured would hide exactly the
 * repositories this page is for — the bound is published alongside so the claim is auditable.
 * Rule 6 is the honest remainder: no movement, and not enough watched time to call it.
 */
export function coldZoneProfile(rows: ColdRow[], opts: ColdZoneOptions): ColdZoneResult {
  // REFUSE BEFORE CASTING. A typo in a timestamp would otherwise silently publish a
  // duration measured from the epoch, and every repository would be cold. See assets.ts.
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
    // meaningless and every repository cold. Clamping belongs in the settings layer
    // (`COLD_AFTER_DAYS_MIN`/`MAX`), so anything that gets past it is a caller bug.
    throw new Error(`coldZoneProfile: coldAfterDays must be a positive number (${String(opts.coldAfterDays)})`);
  }

  // Classify once, over every row — the counts below report on what was handed in, not on
  // what survived. `secrets` is refused by program.ts and carried as `unknown` rather than
  // thrown on, exactly as assets.ts does it.
  let unclassifiedSecrets = 0;
  const classified: { row: ColdRow; risk: RiskClass }[] = [];
  for (const row of rows) {
    if (row.scope === "secrets") {
      unclassifiedSecrets += 1;
      classified.push({ row, risk: "unknown" });
      continue;
    }
    classified.push({ row, risk: classifyRisk(row, opts.rule) });
  }

  // Rows with no repository belong to no cell of this page. Dropped, and counted.
  let droppedNoRepo = 0;
  const byRepo = new Map<string, RepoAcc>();
  for (const { row, risk } of classified) {
    if (blank(row.repo_id)) {
      droppedNoRepo += 1;
      continue;
    }
    const id = String(row.repo_id).trim();
    let acc = byRepo.get(id);
    if (!acc) {
      acc = newAcc(id);
      byRepo.set(id, acc);
    }
    foldRow(acc, row, risk);
  }

  // Observation is decided even when the block is not measurable, so `scopes_without_scan`
  // reports either way — the reader needs to know coverage is undecidable before they need
  // to know how long the silence was.
  const scopesWithoutScan = new Set<Scope>();
  const observedById = new Map<string, boolean>();
  for (const acc of byRepo.values()) {
    observedById.set(acc.repoId, isObserved(acc, opts.newestScanByScope, scopesWithoutScan));
  }
  const scopesWithoutScanList = [...scopesWithoutScan].sort(cmp);

  const base = {
    cold_after_days: t,
    observed_from: observedFromMs === null ? null : toIso(observedFromMs),
    as_of: toIso(nowMs)!,
    row_count: rows.length,
    dropped_no_repo: droppedNoRepo,
    unclassified_secrets: unclassifiedSecrets,
    scopes_without_scan: scopesWithoutScanList,
  };

  if (observedFromMs === null) {
    return {
      measurable: false,
      ...base,
      bucket_edges: null,
      bucket_labels: null,
      repos: null,
      teams: null,
      totals: null,
    };
  }

  const bucketEdges = [0, t / 3, (2 * t) / 3, t];
  const bucketLabels = [
    `${fmtDays(0)}–${fmtDays(t / 3)} d`,
    `${fmtDays(t / 3)}–${fmtDays((2 * t) / 3)} d`,
    `${fmtDays((2 * t) / 3)}–${fmtDays(t)} d`,
    `≥ ${fmtDays(t)} d`,
    "not yet measurable",
  ];

  const repos: ColdRepoRow[] = [];
  for (const acc of byRepo.values()) {
    const observed = observedById.get(acc.repoId) === true;
    const idleDays = acc.movementAt === null ? null : daysBetween(acc.movementAt, nowMs);
    // The bound: the later of "when we started watching" and "when this repository's oldest
    // finding was first seen". Watching time before the repository existed is not silence
    // anybody could have broken, and neither is the repository's life before we looked.
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

    let verdict: ColdVerdict;
    if (!observed) verdict = "unobserved";
    else if (acc.open === 0) verdict = "clear";
    else if (idleDays !== null && idleDays >= t) verdict = "cold";
    else if (idleDays === null && idleBoundDays !== null && idleBoundDays >= t) verdict = "cold";
    else if (idleDays !== null) verdict = "warm";
    else verdict = "watching";

    const bucket =
      verdict === "unobserved" || verdict === "clear"
        ? null
        : verdict === "watching"
          ? 4
          : bucketOf(idleReading!, t);

    repos.push({
      repo_id: acc.repoId,
      repo_name: acc.repoName,
      project: acc.project,
      open_findings: acc.open,
      open_high_risk: acc.openHigh,
      oldest_open_age_days:
        acc.oldestOpenFirstSeen === null ? null : daysBetween(acc.oldestOpenFirstSeen, nowMs),
      last_movement_at: toIso(acc.movementAt),
      last_movement_kind: acc.movementKind,
      idle_days: idleDays,
      idle_bound_days: idleBoundDays,
      idle_is_bound: idleDays === null,
      idle_reading_days: idleReading,
      observed,
      last_observed_at: toIso(acc.lastSeen),
      disappeared_at: toIso(disappearedAt),
      disappeared_at_last_observation: disappearedCount,
      reopened_open: acc.reopenedOpen,
      verdict,
      cold: verdict === "cold",
      bucket,
    });
  }

  repos.sort(
    (a, b) =>
      VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict] ||
      b.open_findings - a.open_findings ||
      cmp(a.repo_name ?? a.repo_id, b.repo_name ?? b.repo_id),
  );

  const teams = rollUp(repos);
  const totals = totalsOf(repos, teams);

  return {
    measurable: true,
    ...base,
    bucket_edges: bucketEdges,
    bucket_labels: bucketLabels,
    repos,
    teams,
    totals,
  };
}

/**
 * Per project. The NULL key is a real bucket and is labelled `COLD_PROJECT_NONE` — it is
 * never dropped and never pinned last, because "nobody owns these repositories" is one of
 * the answers the page exists to give, not a gap in the data to be tidied away.
 */
function rollUp(repos: ColdRepoRow[]): ColdTeamRow[] {
  const byProject = new Map<string | null, ColdRepoRow[]>();
  for (const r of repos) {
    const list = byProject.get(r.project);
    if (list) list.push(r);
    else byProject.set(r.project, [r]);
  }

  const out: ColdTeamRow[] = [];
  for (const [project, list] of byProject) {
    const buckets = [0, 0, 0, 0, 0];
    const bucketOpen = [0, 0, 0, 0, 0];
    let observed = 0;
    let unobserved = 0;
    let withOpen = 0;
    let coldRepos = 0;
    let watching = 0;
    let warm = 0;
    let clear = 0;
    let openFindings = 0;
    let openInCold = 0;
    let highInCold = 0;
    let openInUnobserved = 0;
    let lastMovement: number | null = null;

    for (const r of list) {
      openFindings += r.open_findings;
      if (r.observed) {
        observed += 1;
        // Over OBSERVED repositories only: a drop-out's disappearance close is the scanner's
        // event, not this team's work, and must not refresh the team's last-movement date.
        const at = parseTs(r.last_movement_at);
        if (at !== null && (lastMovement === null || at > lastMovement)) lastMovement = at;
      } else {
        unobserved += 1;
        openInUnobserved += r.open_findings;
      }
      if (r.bucket !== null) {
        buckets[r.bucket] += 1;
        bucketOpen[r.bucket] += r.open_findings;
      }
      switch (r.verdict) {
        case "cold":
          coldRepos += 1;
          withOpen += 1;
          openInCold += r.open_findings;
          highInCold += r.open_high_risk;
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

    const verdict: TeamVerdict =
      withOpen === 0 ? "clear" : coldRepos === withOpen ? "fully-cold" : coldRepos > 0 ? "partly-cold" : "warm";

    out.push({
      project,
      label: project ?? COLD_PROJECT_NONE,
      repos: list.length,
      repos_observed: observed,
      repos_unobserved: unobserved,
      repos_with_open: withOpen,
      cold_repos: coldRepos,
      watching_repos: watching,
      warm_repos: warm,
      clear_repos: clear,
      open_findings: openFindings,
      open_in_cold: openInCold,
      high_risk_in_cold: highInCold,
      open_in_unobserved: openInUnobserved,
      cold_share_pct: safePct(coldRepos, withOpen),
      last_movement_at: toIso(lastMovement),
      verdict,
      buckets,
      bucket_open: bucketOpen,
    });
  }

  out.sort(
    (a, b) => b.cold_repos - a.cold_repos || b.open_in_cold - a.open_in_cold || cmp(a.label, b.label),
  );
  return out;
}

function totalsOf(repos: ColdRepoRow[], teams: ColdTeamRow[]): ColdZoneTotals {
  const buckets = [0, 0, 0, 0, 0];
  const bucketOpen = [0, 0, 0, 0, 0];
  const t: ColdZoneTotals = {
    repos: repos.length,
    repos_observed: 0,
    repos_unobserved: 0,
    repos_with_open: 0,
    cold_repos: 0,
    watching_repos: 0,
    warm_repos: 0,
    clear_repos: 0,
    open_findings: 0,
    open_in_cold: 0,
    high_risk_in_cold: 0,
    open_in_unobserved: 0,
    cold_repo_share_pct: null,
    cold_backlog_share_pct: null,
    teams: teams.length,
    teams_fully_cold: 0,
    teams_partly_cold: 0,
    repos_no_project: 0,
    buckets,
    bucket_open: bucketOpen,
  };

  for (const team of teams) {
    t.repos_observed += team.repos_observed;
    t.repos_unobserved += team.repos_unobserved;
    t.repos_with_open += team.repos_with_open;
    t.cold_repos += team.cold_repos;
    t.watching_repos += team.watching_repos;
    t.warm_repos += team.warm_repos;
    t.clear_repos += team.clear_repos;
    t.open_findings += team.open_findings;
    t.open_in_cold += team.open_in_cold;
    t.high_risk_in_cold += team.high_risk_in_cold;
    t.open_in_unobserved += team.open_in_unobserved;
    if (team.verdict === "fully-cold") t.teams_fully_cold += 1;
    if (team.verdict === "partly-cold") t.teams_partly_cold += 1;
    if (team.project === null) t.repos_no_project = team.repos;
    for (let i = 0; i < 5; i += 1) {
      buckets[i] += team.buckets[i];
      bucketOpen[i] += team.bucket_open[i];
    }
  }

  t.cold_repo_share_pct = safePct(t.cold_repos, t.repos_with_open);
  t.cold_backlog_share_pct = safePct(t.open_in_cold, t.open_findings);
  return t;
}

/**
 * The Executive card's slice: the totals, the clock and the threshold — never the arrays.
 *
 * CAPPED IN THE MODEL, NOT SLICED AT THE EDGE (the `fixNext` pattern). A page that received
 * the whole profile and rendered one number would ship every repository name in the estate
 * into a payload that had no use for them, and the next reader of that payload would have no
 * way to know which half was meant to be drawn.
 */
export function coldZoneHeadline(result: ColdZoneResult): ColdZoneHeadline {
  return {
    measurable: result.measurable,
    cold_after_days: result.cold_after_days,
    observed_from: result.observed_from,
    as_of: result.as_of,
    totals: result.totals,
    row_count: result.row_count,
    dropped_no_repo: result.dropped_no_repo,
    unclassified_secrets: result.unclassified_secrets,
    scopes_without_scan: result.scopes_without_scan,
  };
}
