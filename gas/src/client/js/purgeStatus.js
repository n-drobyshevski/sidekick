// Pure view-model for the severity-purge status line (Data → Maintenance). No DOM, so it is
// unit-tested — the `backfillStatusView` / `scanProgressView` pattern.
//
// It exists to keep four honest-state rules out of render code, where they get lost:
//   - an unrecorded total is never printed as a denominator;
//   - a job that has stopped making progress says so rather than claiming to run;
//   - SEALED scans are not residue. Compaction pruned their archives, so there is nothing
//     left in them to replay — "nothing to rewrite", not a failure;
//   - UNREADABLE scans ARE residue, and a run with any of them is NOT "complete". Those
//     archives still hold the purged findings, so deleting a scan could replay them back.
//     Saying "done" there would be the one lie this whole feature exists to avoid.
//
// The one import is `num` from the UI barrel. That is a FIGURE formatter, not a DOM one — it
// builds nothing and touches no document — so the "no DOM" claim above still holds and this
// module still runs under the node test environment.

import { num } from "./ui.js";

/** Minutes since an ISO timestamp, or null when it doesn't parse. */
function minutesSince(iso, now) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / 60000));
}

/**
 * A count off the PurgeStatus payload, where a missing count really is zero.
 *
 * `Number(v || 0)` refused only the FALSY values, and it refused them by luck: the `|| 0`
 * had to catch null before the cast because `Number(null)` is 0 and finite, which is the
 * trap CLAUDE.md names. What neither half could refuse is a value that was never a number —
 * `Number("n/a")` is NaN, and this helper's one caller prints it, so a single bad field
 * used to put the literal string "NaN archive(s)" in front of an operator deciding whether
 * a purge finished. `num` refuses before the cast and hands back the stated 0 instead.
 *
 * The 0 is deliberate and not inherited: an unreported `scansDone` is zero archives
 * rewritten, and the two places where a missing figure means something else — an
 * unrecorded `scansTotal`, an unparseable timestamp — are guarded on their own below
 * rather than through this helper.
 */
function n(v) {
  return num(v, 0);
}

/** "1 finding" / "4,312 findings" — plural and grouped, since these numbers get large. */
function count(v, one, many) {
  const x = n(v);
  return `${x.toLocaleString()} ${x === 1 ? one : many}`;
}

/**
 * PurgeStatus (or null) → `{ text, busy, poll, pct, complete, warn }`.
 *
 *   busy      disable the purge button (a live job owns the slot)
 *   poll      schedule another status read
 *   pct       progress percentage, or null when the total was never recorded
 *   complete  every reachable archive was rewritten
 *   warn      render the line as a warning rather than plain muted text
 */
export function purgeStatusView(b, now = Date.now()) {
  if (!b) return { text: "Never run.", busy: false, poll: false, pct: null, complete: false, warn: false };

  const r = b.result || {};

  if (b.phase === "PURGING" || b.phase === "PERSISTING") {
    if (b.stale) {
      // Running on paper but silent past the stale threshold: the continuation stopped firing.
      // Say so and hand the button back — starting again reclaims the dead job. Left claiming
      // "Running", it would also be silently blocking the daily scan, since jobs are
      // single-flight across kinds.
      const mins = minutesSince(b.updatedAt, now);
      return {
        text:
          "Appears stalled — no progress" +
          (mins === null ? "" : ` for ${mins} minute(s)`) +
          `, after ${n(b.scansDone)} archive(s). Start again to reclaim it.`,
        busy: false,
        poll: false,
        pct: null,
        complete: false,
        warn: true,
      };
    }
    // A total of 0 means the count was never recorded, NOT that there are no scans. Report the
    // count alone rather than the nonsense "N of 0".
    const total = n(b.scansTotal);
    return {
      text: total
        ? `Rewriting scan archives — ${n(b.scansDone)} of ${total} done.`
        : `Rewriting scan archives — ${n(b.scansDone)} done so far.`,
      busy: true,
      poll: true,
      pct: total ? Math.round((n(b.scansDone) / total) * 100) : null,
      complete: false,
      warn: false,
    };
  }

  if (b.phase === "FAILED") {
    return {
      text: `Last run failed: ${b.error || "unknown error"}. The findings already removed stay removed; re-run to finish the archives.`,
      busy: false,
      poll: false,
      pct: null,
      complete: false,
      warn: true,
    };
  }

  // Terminal. Lead with what was actually removed, then what could not be reached.
  const removed = n(r.ledgerRemoved) + n(r.episodeRemoved);
  const parts = [`Purged ${count(removed, "lifecycle", "lifecycles")}`];
  if (r.scansRewritten) parts.push(`${count(r.scansRewritten, "archive", "archives")} rewritten`);
  if (r.recordsRemoved) parts.push(`${count(r.recordsRemoved, "record", "records")} dropped`);
  // Only surfaced when non-zero: naming what couldn't be reached matters, a row of zeroes
  // is noise.
  if (r.scansSealed) parts.push(`${n(r.scansSealed)} sealed (nothing to rewrite)`);
  if (r.cellsBefore && r.cellsAfter) {
    const freed = n(r.cellsBefore) - n(r.cellsAfter);
    // The MEASURED delta, not a projection — and reported even when it is zero or negative,
    // because "the meter didn't move" is the finding, not something to hide.
    parts.push(`${freed.toLocaleString()} spreadsheet cell(s) reclaimed`);
  }

  const unreadable = n(r.scansUnreadable);
  if (unreadable) {
    return {
      text:
        parts.join(" · ") +
        `. ${unreadable} archive(s) could not be read — those findings can still be replayed ` +
        `back by deleting a scan. Re-run the purge to retry them.`,
      busy: false,
      poll: false,
      pct: null,
      complete: false,
      warn: true,
    };
  }

  return { text: parts.join(" · ") + ".", busy: false, poll: false, pct: null, complete: true, warn: false };
}
