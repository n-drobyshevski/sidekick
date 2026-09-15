// OPEN-BACKLOG MOVEMENT FOR ONE REGISTER — how many issues are open now, how many were open
// at an earlier commit record, and the honest reason when the two cannot be compared.
//
// THE ARITHMETIC IS A BACKWARDS REPLAY, NOT A STORED SERIES, and that is the whole design.
// `issue_count` on a commit row is a stored open population and would be the obvious thing to
// read — but a row that predates that column, or one written by a path that never counted,
// reads as absent, and there is no way to tell that from a register that really did hold
// nothing. The five per-sync transition counts (`ledger_json`) are the record of what the
// LEDGER did, and they compose:
//
//     open(k)   = open(k-1) + new + reopened - resolved      (what sync k did)
//     open(k-1) = open(k)   - new - reopened + resolved      (the same identity, backwards)
//
// So the only figure this module takes on faith is `openNow` — the live count its caller
// measured off today's register — and every earlier figure is derived from it by undoing one
// sync at a time. A stored count that disagrees with the replay is a defect in the LEDGER, and
// it surfaces as a wrong `prevOpen` rather than as two independent series quietly diverging.
//
// NO CLOCK. `now` is the latest commit row's own `finished_at`; this module reads `Date.now()`
// nowhere. That is `readModelStore.ts`'s eligibility rule — a figure whose value moves with the
// wall clock cannot be cached durably — and it is also the only way "3 days ago" stays the same
// sentence on a page reloaded twice in one session.
//
// WHY THE WALK STOPS, AND WHAT EACH STOP MEANS. A replay is only as good as the weakest step in
// it, so a step that cannot be trusted ends the walk with a NAMED reason rather than
// contributing a plausible number:
//
//   noLedger   a row in the window carries no `ledger_json` — a sync recorded before the
//              lifecycle ledger existed. Absent, never zero: reading a missing cell as five
//              zeroes would claim that sync moved nothing, which is a measurement nobody made.
//
//   rescoped   the register was asked a DIFFERENT QUESTION across this step, so the two open
//              counts are over two populations. `skippedNarrowedScope > 0` is the ledger's own
//              record of it (`reconcileIssueLedger` refuses to resolve by absence when the
//              scope moved, and counts what it refused). The scope-signature comparison beside
//              it catches the one case that count cannot: a WIDENING with no absent rows leaves
//              `skippedNarrowedScope` at 0 while inflating `new` with a category that was never
//              in the prior. CLAUDE.md's rule for this register — a row absent from a register
//              that was asked a different question is not a remediation — cuts both ways, and
//              so does a row PRESENT in one that was asked a wider question.
//
//   tooClose   (`week` only) no saved row is far enough back. The span the log really does
//              cover is published as `spanDays`, because "the saved syncs span 3 days" is the
//              fact that makes "look again next week" the obvious next move.
//
// DIRECTION IS A WORD. A backlog that shrank is "down"; the sign of a delta is not something a
// screen reader can say, and a chip drawn from a sign alone has to invent the word anyway.

import { parseCounts } from "./aarsTrend";
import type { IssueLedgerDeltas } from "./issueLedger";
import { parseTs, type Rec } from "./util";

/**
 * A comparison this register will publish needs at least this much daylight between the two
 * commit records. Under it, two syncs describe the same day and their difference is noise.
 */
export const MOVEMENT_MIN_GAP_DAYS = 7;

const MOVEMENT_DAY_MS = 86_400_000;

/** The five transition counts, as `persistSync` and the dry-run seed both write them. */
const DELTA_KEYS = ["new", "resolved", "reopened", "carried", "skippedNarrowedScope"] as const;

/** Days, to one decimal — a span of 13.5 d is not "14" and not "13". */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface MovementComparison {
  /** `finished_at` of the OLDER endpoint — the sync `prevOpen` is the population after. */
  since: string;
  /** `finished_at` of the latest commit record. This module's entire notion of "now". */
  until: string;
  /** Days between the two endpoints, to one decimal. */
  gapDays: number;
  /**
   * What the ledger DID across the window: the latest row's own five counts for `previous`,
   * and their SUM over every replayed row for `week`. The sum is exact rather than an
   * approximation — the walk visits each row in the window exactly once, and a row it could
   * not visit ends the walk instead of being skipped.
   */
  deltas: IssueLedgerDeltas;
  /** The live open population the caller measured. Never derived here. */
  open: number;
  /** The open population at `since`, replayed backwards from `open`. */
  prevOpen: number;
  direction: "up" | "down" | "flat";
}

export interface BacklogMovement {
  previous: MovementComparison | null;
  week: MovementComparison | null;
  /** Why not, when not. Null exactly when the comparison beside it is non-null. */
  reasons: {
    previous: "noSync" | "oneSync" | "noLedger" | "rescoped" | null;
    week: "tooClose" | "noLedger" | "rescoped" | null;
  };
  /**
   * The WIDEST span the saved commit records cover, oldest to newest — not the nearest gap.
   * Published always, and the figure a `tooClose` reader actually needs: it says how long this
   * register has been watched at all. Null under two rows, where there is no span to state.
   */
  spanDays: number | null;
}

/** One commit record, reduced to the four facts a replay step needs. */
interface Step {
  at: string;
  atMs: number;
  /** `register_scope`. "" is UNKNOWN and never "the same scope as the row beside it". */
  scope: string;
  /** Null for a sync recorded before the ledger existed — absent, not zero. */
  deltas: IssueLedgerDeltas | null;
}

/**
 * The five counts off a `ledger_json` cell, or null.
 *
 * `parseCounts` is `aarsTrend`'s, deliberately — `capacityFromLedgerDeltas` reads the same
 * column off the same rows, and two parsers for one cell is two places for the "absent is not
 * zero" rule to be spelled differently. The `absentKeyIsNull` arm is what matters here: `"{}"`
 * is an object carrying none of the five keys, which the flag reports as five nulls and this
 * function refuses. Without it `"{}"` would read as a sync that moved nothing, and `"null"`
 * (which parses to a non-object) as the same.
 */
function deltasOf(cell: unknown): IssueLedgerDeltas | null {
  const counts = parseCounts(cell, DELTA_KEYS, true);
  if (!counts) return null;
  const out = {} as IssueLedgerDeltas;
  for (const k of DELTA_KEYS) {
    const n = counts[k];
    if (n === null) return null;
    out[k] = n;
  }
  return out;
}

/**
 * The SUCCESS rows carrying a readable instant, oldest first.
 *
 * SORTED HERE rather than trusted: `syncStore.syncHistory()` returns the tab in append order
 * and `api.getSyncHistory` reverses it before shipping, so the same rows reach a caller in
 * either order depending on which side of that reverse it stands. A module assuming one of
 * them would silently replay a register backwards.
 *
 * A non-SUCCESS row is dropped rather than stopping the walk: a failed sync appends no
 * lifecycle transition — `persistSync` writes the commit record LAST — so it describes no step,
 * and its absence from the replay is correct rather than a gap.
 */
function stepsOf(history: readonly Rec[]): Step[] {
  const out: Step[] = [];
  for (const r of history) {
    if (String(r["status"] ?? "") !== "SUCCESS") continue;
    // `||` not `??`, for the reason `capacityFromLedgerDeltas` uses it: an empty sheet cell
    // reads as null here and as "" everywhere else, and both mean "fall back to the start".
    const at = String(r["finished_at"] || r["started_at"] || "");
    const atMs = parseTs(at);
    // Refused BEFORE any arithmetic. A row with no readable instant cannot be placed on the
    // axis at all, and `Number(null)` is 0 — which is 1970, the oldest row in any history.
    if (!at || atMs === null) continue;
    out.push({
      at,
      atMs,
      scope: String(r["register_scope"] ?? ""),
      deltas: deltasOf(r["ledger_json"]),
    });
  }
  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}

/** Undo one sync: open(k-1) = open(k) - new - reopened + resolved. */
function stepBack(open: number, d: IssueLedgerDeltas): number {
  return open - d.new - d.reopened + d.resolved;
}

function directionOf(open: number, prevOpen: number): "up" | "down" | "flat" {
  if (open > prevOpen) return "up";
  if (open < prevOpen) return "down";
  return "flat";
}

/**
 * Whether the step from `older` to `newer` may be replayed, and why not.
 *
 * `newer.deltas` is the one this step applies; `older.deltas` is checked too because a
 * pre-ledger OLDER ENDPOINT carries no scope stamp either, and reporting that as `rescoped`
 * would name the wrong cause for a register that simply predates the ledger.
 */
function stepRefusal(newer: Step, older: Step): "noLedger" | "rescoped" | null {
  if (newer.deltas === null || older.deltas === null) return "noLedger";
  if (newer.deltas.skippedNarrowedScope > 0) return "rescoped";
  if (!newer.scope || !older.scope || newer.scope !== older.scope) return "rescoped";
  return null;
}

/**
 * Movement in the open backlog, replayed off the commit records.
 *
 * `openNow` is the caller's own live count and the replay's only anchor — over ISSUES alone
 * wherever this register's union also holds findings, because findings never enter the
 * lifecycle ledger and its transition counts therefore never described them.
 */
export function backlogMovement(
  history: readonly Rec[],
  opts: { openNow: number; minGapDays?: number },
): BacklogMovement {
  const minGapDays = opts.minGapDays === undefined ? MOVEMENT_MIN_GAP_DAYS : opts.minGapDays;
  // Refuse absent BEFORE any use. Nothing in this build can produce it — `api.ts` passes a
  // `.length` — but an anchor that is not a real count leaves the replay nothing to undo, and
  // "no sync" is the only claim that stays true either way: no comparison was made.
  const anchor = Number.isFinite(opts.openNow) && opts.openNow >= 0
    ? Math.floor(opts.openNow)
    : null;

  const steps = anchor === null ? [] : stepsOf(history);
  const n = steps.length;
  const spanDays = n >= 2
    ? round1((steps[n - 1]!.atMs - steps[0]!.atMs) / MOVEMENT_DAY_MS)
    : null;
  const none = (
    previous: BacklogMovement["reasons"]["previous"],
    week: BacklogMovement["reasons"]["week"],
  ): BacklogMovement => ({ previous: null, week: null, reasons: { previous, week }, spanDays });

  if (n === 0) return none("noSync", "tooClose");
  // One commit record is a register that has been looked at once. There is no earlier
  // population to replay to, and "tooClose" on the week row is literally true: the saved
  // syncs span nothing at all.
  if (n === 1) return none("oneSync", "tooClose");

  const latest = steps[n - 1]!;
  const openNow = anchor as number;

  // ------------------------------------------------------------------------------ previous
  let previous: MovementComparison | null = null;
  let previousReason: BacklogMovement["reasons"]["previous"] = null;
  const priorStep = steps[n - 2]!;
  const priorRefusal = stepRefusal(latest, priorStep);
  if (priorRefusal !== null) {
    previousReason = priorRefusal;
  } else {
    const prevOpen = stepBack(openNow, latest.deltas!);
    previous = {
      since: priorStep.at,
      until: latest.at,
      gapDays: round1((latest.atMs - priorStep.atMs) / MOVEMENT_DAY_MS),
      deltas: { ...latest.deltas! },
      open: openNow,
      prevOpen,
      direction: directionOf(openNow, prevOpen),
    };
  }

  // ---------------------------------------------------------------------------------- week
  // Newest-first, so `since` is the NEWEST row that still clears the minimum — the most recent
  // seven days of syncing, not the whole ledger. Taking the oldest would answer a question
  // about the register's entire life and call it a week.
  let target = -1;
  for (let i = n - 2; i >= 0; i -= 1) {
    if ((latest.atMs - steps[i]!.atMs) / MOVEMENT_DAY_MS >= minGapDays) {
      target = i;
      break;
    }
  }
  if (target < 0) {
    return {
      previous,
      week: null,
      reasons: { previous: previousReason, week: "tooClose" },
      spanDays,
    };
  }

  const sum: IssueLedgerDeltas = {
    new: 0, resolved: 0, reopened: 0, carried: 0, skippedNarrowedScope: 0,
  };
  let open = openNow;
  for (let k = n - 1; k > target; k -= 1) {
    const refusal = stepRefusal(steps[k]!, steps[k - 1]!);
    if (refusal !== null) {
      return {
        previous,
        week: null,
        reasons: { previous: previousReason, week: refusal },
        spanDays,
      };
    }
    const d = steps[k]!.deltas!;
    for (const key of DELTA_KEYS) sum[key] += d[key];
    open = stepBack(open, d);
  }
  const older = steps[target]!;
  return {
    previous,
    week: {
      since: older.at,
      until: latest.at,
      gapDays: round1((latest.atMs - older.atMs) / MOVEMENT_DAY_MS),
      deltas: sum,
      open: openNow,
      prevOpen: open,
      direction: directionOf(openNow, open),
    },
    reasons: { previous: previousReason, week: null },
    spanDays,
  };
}
