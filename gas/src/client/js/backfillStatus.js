// Pure view-model for the risk-signal backfill status line (Settings). No DOM, so it is
// unit-tested — the `scanProgressView` pattern in scanProgress.js.
//
// It exists mainly to keep two honest-state rules from being quietly lost in render code:
// an unrecorded total must never be printed as a denominator, and a job that has stopped
// making progress must say so rather than claiming to be running.

/** Minutes since an ISO timestamp, or null when it doesn't parse. */
function minutesSince(iso, now) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((now - t) / 60000));
}

/**
 * BackfillStatus (or null) → `{ text, busy, poll }`.
 *
 *   busy  disable the start button (a live job owns the slot)
 *   poll  schedule another status read
 */
export function backfillStatusView(b, now = Date.now()) {
  if (!b) return { text: "Never run.", busy: false, poll: false };

  if (b.phase === "BACKFILLING") {
    if (b.stale) {
      // Running on paper but silent past the stale threshold: the continuation stopped
      // firing. Say so and hand the button back — pressing it reclaims the dead job and
      // starts a fresh one. Left claiming "Running", it would also be silently blocking the
      // daily scan, since jobs are single-flight across kinds.
      const mins = minutesSince(b.updatedAt, now);
      return {
        text:
          "Appears stalled — no progress" +
          (mins === null ? "" : " for " + mins + " minute(s)") +
          ", after " + (b.scansDone || 0) + " scan(s). Start again to reclaim it.",
        busy: false,
        poll: false,
      };
    }
    // A total of 0 means the count was never recorded — a jobs tab predating the
    // total_count column drops the write — NOT that there are no scans. Report the count
    // alone rather than the nonsense "N of 0", the same way the scan card degrades to an
    // indeterminate bar when it can't compute a percentage.
    return {
      text: b.scansTotal
        ? "Running — " + b.scansDone + " of " + b.scansTotal + " scan(s) replayed."
        : "Running — " + b.scansDone + " scan(s) replayed so far.",
      busy: true,
      poll: true,
    };
  }

  if (b.phase === "FAILED") {
    return {
      text: "Last run failed: " + (b.error || "unknown error"),
      busy: false,
      poll: false,
    };
  }

  const r = b.result || {};
  const parts = [
    (r.scansReplayed || 0) + " scan(s) replayed",
    (r.ledgerRowsTouched || 0) + (r.episodeRowsTouched || 0) + " lifecycle(s) filled",
  ];
  // Only surfaced when non-zero: what could not be recovered is worth naming, but a row of
  // zeroes is noise.
  if (r.scansSealed) parts.push(r.scansSealed + " sealed (archives pruned)");
  if (r.scansUnreadable) parts.push(r.scansUnreadable + " unreadable");
  parts.push((r.stillUnknown || 0) + " still unclassified");
  return { text: parts.join(" · ") + ".", busy: false, poll: false };
}
