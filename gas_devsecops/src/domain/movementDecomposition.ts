// WHAT MOVED THE OPEN COUNT, and which half of it was work.
//
// The port of gas/src/domain/program.ts's `movementDecomposition` / `movementWindowScans`
// (commit 930c7f1). The arithmetic and the identity are that file's, verbatim in substance;
// what changes here is that this register has THREE scopes sharing one scans tab, so the scope
// is a required parameter and the filtering happens INSIDE the function rather than by a
// calling convention (CLAUDE.md, on reconcile: "filters the prior ITSELF rather than trusting
// a calling convention"). See the `scope` note on `movementDecomposition` below.
//
// THE FILE IS NOT `movement.ts` ON PURPOSE. `test/movement.test.ts` already names a DIFFERENT
// measurement — `readModels.ts`'s `openMovement`, the week-over-week open backlog, whose
// endpoints are SYNCS (a scan_id shared by up to three scopes). This one decomposes a 28-day
// window bounded by two scans OF ONE SCOPE into named causes. Two figures, two windows, two
// files.
//
// PRODUCT.md principle 6 — "the representation is not the work" — has a specific failure in
// mind here. The open count can fall for two completely different reasons: findings were
// fixed, or the register stopped looking at them. A scan whose severity gate narrowed from
// CRITICAL/HIGH/MEDIUM to CRITICAL/HIGH sheds every MEDIUM finding at once, and the headline
// improves exactly as it would after a remediation wave. Nothing on a trend line distinguishes
// the two. So this decomposes the change over a window into its named causes and LABELS them:
//
//   measured        `observed`  — the API itself said the finding was resolved.
//   administrative  `bounded`   — the finding stopped appearing and was dated by the scan that
//                                 first missed it. An upper bound on the death date, not a
//                                 measurement of one (CLAUDE.md: "a death date is not always a
//                                 measurement"). It is the honest half of a remediation figure
//                                 to report separately, because a withdrawn population, a
//                                 renamed asset and a real fix all look like this — and on
//                                 THIS register it is the majority case by construction:
//                                 `SAST_FETCH_RESOLVED` is false and secrets have no resolved
//                                 state either, so for two of the three scopes every death
//                                 date is dated by disappearance.
//
// `outsideGate` IS REPORTED BESIDE THEM AND NEVER SUMMED IN, and that is the one arithmetic
// decision in this file worth arguing about. It is a STOCK — how many open findings currently
// sit outside the gate the last scan applied — not a FLOW over the window. Adding it to
// `administrative` would double-count every one of those rows on every subsequent window
// (they stay outside the gate until someone widens it), and would make `administrative +
// measured` stop reconciling with the identity below. The gate exclusion is a fact about what
// the last scan COULD have seen; the flows are facts about what it DID see.
//
// THE IDENTITY, AND WHY THE RESIDUAL IS PUBLISHED RATHER THAN ABSORBED:
//
//     netChange  ==  arrivals - observed - bounded + reopened
//
// The left side is replayed from the durable rows (`first_seen` / `resolved_at`); the right
// side is read off the scan rows reconcile wrote plus the rows' own resolution provenance.
// They are two independent measurements of the same movement, and in live data they will not
// always agree — `new_count` counts findings NEW TO A SCAN while the replay counts findings
// BORN in the window, and Wiz's `firstDetectedAt` can predate the scan that first saw it; a
// reopen RE-DERIVES `first_seen` from the API (CLAUDE.md's standing open question), so a
// reopened finding can leave the replay looking like an arrival. Each of those is a real gap
// between two real numbers. `identityGap` publishes it. Tuning it to zero — by deriving one
// side from the other, or by folding the residual into a bucket — would produce books that
// always balance and never measure anything.
//
// WHAT IS REFUSED RATHER THAN CAST (CLAUDE.md: `Number(null)` is 0, and it is finite):
//   - a scan whose `ts` will not parse is in no window at all       -> `skippedScans`
//   - a `new_count` / `reopened_count` that is not a finite number contributes NOTHING and is
//     counted, so a half-measured window cannot print a confident total -> `partialCounts`
//   - a row whose `first_seen` will not parse cannot be replayed    -> `unplacedRows`
//   - a resolved row whose `resolution_src` is neither "api" nor "disappeared" is neither
//     measured nor administrative                                   -> `unattributed`
// Every one of those also widens `identityGap`, which is the point: the gap is where the
// unmeasurable part of the window shows up.
//
// NO `shape` FILTER, AND THAT IS NOT AN OMISSION. gas/'s version drops grouped scans before
// counting anything, because gas/'s scans tab carries a `shape` column and a grouped scan is
// counts-only. This register's `ScanRow` (ledgerTypes.ts) has no `shape` column at all — every
// scope's fetch is a flat per-finding scan — so porting the filter would ship a predicate that
// can never be false, and a dead exclusion reads as a live guard the next time someone changes
// the tab. `compaction.ts`'s `selectSealCandidates` drops the same filter for the same reason,
// and says so in its own header.

import { RESOLUTION_API, RESOLUTION_DISAPPEARED, RESOLVED_STATUSES, type Scope } from "./config";
import { parseSeverities } from "./compaction";
import type { BaseRow } from "./ledgerTypes";
import { normalizeSeverity } from "./severity";
import { parseTs } from "./util";

const DAY_MS = 86_400_000;

/** Same open/resolved test the rest of the domain uses (brick metrics.is_open). */
function isOpen(status: unknown): boolean {
  return !RESOLVED_STATUSES.has(String(status ?? "").toUpperCase());
}

export interface Movement {
  /** Which register this decomposition covers. Echoed so a caller cannot mislabel it. */
  scope: Scope;
  /** Sum of `new_count` over the in-window scans OF THIS SCOPE. */
  arrivals: number;
  /** Resolutions the API itself reported, dated in the window. Measured remediation. */
  observed: number;
  /** Resolutions dated by disappearance. An upper bound on the date; administrative. */
  bounded: number;
  /** Sum of `reopened_count` over the same scans — risk that came back. */
  reopened: number;
  /**
   * OPEN rows of this scope whose severity is not in the gate the newest in-window scan of
   * this scope applied. A STOCK, not a flow: reported beside the movement, never added to it.
   * 0 when that scan carried no gate — "no gate" means every severity was in scope, never
   * "everything is outside". On `secrets` the gate is OFF by default
   * (`DEFAULT_FETCH_SEVERITIES.secrets = []`), which serializes to `severities: null`, so this
   * is 0 there for a reason that is a fact about the register rather than a missing value.
   */
  outsideGate: number;
  /** Replayed from this scope's rows: open at `until` minus open at `since`. */
  netChange: number;
  /** The half of the movement that is a measured remediation. */
  measured: number;
  /** The half that is administrative — dated by absence rather than by an API statement. */
  administrative: number;
  /** Resolved in the window with no usable provenance. In neither half; published. */
  unattributed: number;
  /** netChange - (arrivals - observed - bounded + reopened). Published, never tuned away. */
  identityGap: number;
  identityHolds: boolean;
  scansInWindow: number;
  /** Scans OF THIS SCOPE whose `ts` could not be parsed, so they sit in no window. */
  skippedScans: number;
  /** In-window `new_count` / `reopened_count` values that were not finite numbers. */
  partialCounts: number;
  /** Rows whose `first_seen` could not be parsed, so the replay could not place them. */
  unplacedRows: number;
  /** The window as parsed, echoed so a caller cannot mislabel the figure. */
  sinceMs: number;
  untilMs: number;
}

export type MovementRow = Pick<
  BaseRow,
  "scope" | "severity" | "status" | "first_seen" | "resolved_at" | "resolution_src"
>;

/**
 * The scan-tab fields this reads. `scope` is REQUIRED and is compared, not trusted: a scans tab
 * holding all three registers hands every caller rows it did not ask for.
 */
export type MovementScan = {
  scope?: unknown;
  ts?: unknown;
  severities?: unknown;
  new_count?: unknown;
  reopened_count?: unknown;
};

/**
 * Add a scan count into a running total, refusing anything that is not already a number.
 *
 * `Number(null)`, `Number("")`, `Number([])` and `Number(false)` are all 0 and all finite, so a
 * cast-then-`isFinite` guard reads every one of them as a measured zero. The type test comes
 * FIRST and nothing is cast at all.
 */
function addCount(total: number, v: unknown, refused: { n: number }): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    refused.n += 1;
    return total;
  }
  return total + v;
}

/** The window test for a resolution or a scan: half-open, so an endpoint scan is counted once. */
function inWindow(t: number | null, sinceMs: number, untilMs: number): boolean {
  return t !== null && t > sinceMs && t <= untilMs;
}

/**
 * Decompose the change in one scope's open count between two instants into its causes.
 *
 * `scope` IS A REQUIRED POSITIONAL PARAMETER AND THE FILTERING HAPPENS HERE. Three registers
 * share one `finding_ledger` and one `scans` tab, and every row of the other two scopes is
 * absent from any given scan BY CONSTRUCTION — which is exactly the shape that makes
 * disappearance dangerous in this package (CLAUDE.md: "Three scopes in one ledger, and
 * DISAPPEARANCE IS THE DANGEROUS PART"). Trusting a caller to have pre-filtered would let the
 * first SAST scan be compared against a window bounded by SCA scans, and every SAST row would
 * then be "open at since, open at until" inside a window its register never looked at. So a row
 * or a scan carrying another scope is EXCLUDED, never counted, and `reconcile.ts` makes the
 * same choice for the same reason.
 *
 * The endpoints are SCANS, not calendar dates (the caller picks them; see
 * `movementWindowScans`), for the reason test/movement.test.ts states for its own
 * week-over-week figure: a register only learns something on the days it looks, so a window
 * bounded by dates it did not look on attributes another period's arrivals to this one.
 *
 * Refuses an unparseable or inverted window rather than returning a zeroed decomposition — a
 * Movement of all zeroes reads as "nothing happened", which is a measurement, and no
 * measurement was made.
 */
export function movementDecomposition(
  rows: MovementRow[],
  scans: MovementScan[],
  window: { since: string | number; until: string | number },
  scope: Scope,
): Movement {
  const sinceMs = parseTs(window.since);
  const untilMs = parseTs(window.until);
  if (sinceMs === null || untilMs === null || !(sinceMs < untilMs)) {
    throw new Error(
      "movementDecomposition: the window endpoints must be two parseable instants, "
        + "since before until — got " + JSON.stringify(window),
    );
  }

  // ---- the scan side: arrivals, reopenings, and the gate the last scan in the window applied.
  const refused = { n: 0 };
  let arrivals = 0;
  let reopened = 0;
  let scansInWindow = 0;
  let skippedScans = 0;
  let newestTs: number | null = null;
  let newestScan: MovementScan | null = null;
  for (const s of scans) {
    // The scope filter, first and unconditionally — see the doc comment above.
    if (s["scope"] !== scope) continue;
    const t = parseTs(s["ts"]);
    if (t === null) {
      skippedScans += 1;
      continue;
    }
    if (!inWindow(t, sinceMs, untilMs)) continue;
    scansInWindow += 1;
    arrivals = addCount(arrivals, s["new_count"], refused);
    reopened = addCount(reopened, s["reopened_count"], refused);
    if (newestTs === null || t > newestTs) {
      newestTs = t;
      newestScan = s;
    }
  }

  // The gate as the NEWEST in-window scan OF THIS SCOPE applied it — the one whose population
  // the register is currently showing. `parseSeverities` answers null for absent, empty, full
  // and unparseable alike, and all four mean the same thing: nothing was gated out.
  const gate = newestScan ? parseSeverities(newestScan["severities"]) : null;
  const gateSet = gate && gate.length ? new Set(gate) : null;

  // ---- the row side: resolutions by provenance, the replay, and what could not be placed.
  let observed = 0;
  let bounded = 0;
  let unattributed = 0;
  let outsideGate = 0;
  let openAtSince = 0;
  let openAtUntil = 0;
  let unplacedRows = 0;
  for (const row of rows) {
    if (row.scope !== scope) continue;
    const first = parseTs(row.first_seen);
    const resolved = parseTs(row.resolved_at);

    if (inWindow(resolved, sinceMs, untilMs)) {
      const src = String(row.resolution_src ?? "").trim().toLowerCase();
      if (src === RESOLUTION_API) observed += 1;
      else if (src === RESOLUTION_DISAPPEARED) bounded += 1;
      else unattributed += 1;
    }

    // The stock, not a flow: what is open NOW and outside what the last scan looked at.
    if (gateSet && isOpen(row.status) && !gateSet.has(normalizeSeverity(row.severity))) {
      outsideGate += 1;
    }

    if (first === null) {
      unplacedRows += 1;
      continue;
    }
    if (first <= sinceMs && (resolved === null || resolved > sinceMs)) openAtSince += 1;
    if (first <= untilMs && (resolved === null || resolved > untilMs)) openAtUntil += 1;
  }

  const netChange = openAtUntil - openAtSince;
  const identityGap = netChange - (arrivals - observed - bounded + reopened);

  return {
    scope,
    arrivals,
    observed,
    bounded,
    reopened,
    outsideGate,
    netChange,
    measured: observed,
    administrative: bounded,
    unattributed,
    identityGap,
    identityHolds: identityGap === 0,
    scansInWindow,
    skippedScans,
    partialCounts: refused.n,
    unplacedRows,
    sinceMs,
    untilMs,
  };
}

/**
 * The window's two endpoints FOR ONE SCOPE: the newest scan of that scope, and the newest scan
 * of that scope at least `minDays` older than it.
 *
 * THE ENDPOINTS ARE SCANS, NOT CALENDAR DATES, and they are THIS SCOPE'S SCANS. A register only
 * learns something on the days it looks, so a window running from "28 days ago" to "now"
 * attributes to this window every arrival a scan happened to first see inside it — including
 * findings born in a stretch nobody scanned. And with three registers in one tab, taking the
 * tab's own newest and oldest rows would give the FIRST SAST SCAN a window bounded by SCA scans
 * — fifty of them, none of which ever looked at a SAST finding. So the scope filter is here
 * too, and `test/movementDecomposition.test.ts` holds exactly that case.
 *
 * `reason` rather than a sentence: the copy belongs to the surface that prints it. On
 * `tooClose` the SPAN the log actually offers travels too, so the reader learns "this register
 * has only been saving scans for 9 days" rather than the bare "no comparison". `reason: null`
 * IS the ok case — gas/'s spelling, kept, so the two ports read the same.
 */
export type MovementWindow =
  | { since: number; until: number; days: number; reason: null }
  | {
    since: null;
    until: number | null;
    days: number | null;
    reason: "noScans" | "oneScan" | "tooClose";
  };

export function movementWindowScans(
  scans: { scope?: unknown; ts?: unknown }[],
  minDays: number,
  scope: Scope,
): MovementWindow {
  const flat = scans
    .filter((s) => s["scope"] === scope)
    .map((s) => parseTs(s["ts"]))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);
  if (!flat.length) return { since: null, until: null, days: null, reason: "noScans" };
  const until = flat[flat.length - 1] as number;
  const spanDays = Math.round(((until - (flat[0] as number)) / DAY_MS) * 10) / 10;
  if (flat.length === 1) return { since: null, until, days: 0, reason: "oneScan" };
  const cutoff = until - minDays * DAY_MS;
  // Newest-first, so the window is the SHORTEST one that still clears the minimum — the most
  // recent 28 days of scanning, not the whole ledger.
  for (let i = flat.length - 2; i >= 0; i -= 1) {
    const t = flat[i] as number;
    if (t <= cutoff) {
      return { since: t, until, days: Math.round(((until - t) / DAY_MS) * 10) / 10, reason: null };
    }
  }
  return { since: null, until, days: spanDays, reason: "tooClose" };
}
