// Pure view-model for the backfill status line. `.ts` importing a client `.js` works under
// vitest (no allowJs needed at runtime); backfillStatusView is DOM-free — the
// scanProgress.test.ts pattern.

import { describe, expect, it } from "vitest";
// @ts-expect-error — client module is plain JS, no d.ts
import { backfillStatusView } from "../src/client/js/backfillStatus.js";

const NOW = Date.parse("2026-08-10T12:00:00Z");
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString();

const running = (over: Record<string, unknown> = {}) => ({
  jobId: "backfill-1",
  phase: "BACKFILLING",
  scansDone: 7,
  scansTotal: 12,
  result: {},
  error: null,
  updatedAt: ago(1),
  stale: false,
  ...over,
});

describe("backfillStatusView while running", () => {
  it("shows N of M when the total was recorded", () => {
    const v = backfillStatusView(running(), NOW);
    expect(v.text).toBe("Running — 7 of 12 scan(s) replayed.");
    expect(v.busy).toBe(true);
    expect(v.poll).toBe(true);
  });

  // The reported bug: a jobs tab predating the total_count column drops the write, so the
  // total reads 0 and the line said "Running — 7 of 0 scan(s) replayed." An unrecorded total
  // is not a total of zero, and must never be printed as a denominator.
  it("omits the denominator entirely when the total was never recorded", () => {
    const v = backfillStatusView(running({ scansTotal: 0 }), NOW);
    expect(v.text).toBe("Running — 7 scan(s) replayed so far.");
    expect(v.text).not.toContain("of 0");
    expect(v.busy).toBe(true);
  });
});

describe("backfillStatusView when the job has stalled", () => {
  // A stalled job is not just a cosmetic problem: jobs are single-flight across kinds, so
  // one left claiming to run blocks the daily scan. The line has to say so, and the button
  // has to come back so pressing it can reclaim the job.
  it("names the stall, its age, and hands the button back", () => {
    const v = backfillStatusView(running({ stale: true, updatedAt: ago(45) }), NOW);
    expect(v.text).toBe(
      "Appears stalled — no progress for 45 minute(s), after 7 scan(s). Start again to reclaim it.",
    );
    expect(v.busy).toBe(false);
    expect(v.poll).toBe(false); // stop polling a job that isn't moving
  });

  it("drops the age clause rather than printing NaN when the timestamp is unusable", () => {
    const v = backfillStatusView(running({ stale: true, updatedAt: "" }), NOW);
    expect(v.text).toBe("Appears stalled — no progress, after 7 scan(s). Start again to reclaim it.");
    expect(v.text).not.toMatch(/NaN/);
  });
});

describe("backfillStatusView terminal states", () => {
  it("reports a finished run, hiding the zero rows that carry no information", () => {
    const v = backfillStatusView(
      {
        phase: "DONE",
        scansDone: 7,
        scansTotal: 7,
        result: { scansReplayed: 7, ledgerRowsTouched: 40, episodeRowsTouched: 2, stillUnknown: 5 },
        error: null,
        updatedAt: ago(1),
        stale: false,
      },
      NOW,
    );
    // Both residues print even at zero: "0 still unattributable" and "we never looked" are
    // different answers, and only an unconditional figure tells a reader which one this is.
    expect(v.text).toBe(
      "7 scan(s) replayed · 42 lifecycle(s) filled · 0 domain tag(s) recovered · " +
        "5 still unclassified · 0 still unattributable.",
    );
    expect(v.busy).toBe(false);
  });

  it("names what could not be recovered when there is any", () => {
    const v = backfillStatusView(
      {
        phase: "DONE",
        scansDone: 9,
        scansTotal: 9,
        result: { scansReplayed: 6, scansSealed: 2, scansUnreadable: 1, stillUnknown: 300 },
        error: null,
        updatedAt: ago(1),
        stale: false,
      },
      NOW,
    );
    expect(v.text).toContain("2 sealed (archives pruned)");
    expect(v.text).toContain("1 unreadable");
    expect(v.text).toContain("300 still unclassified");
  });

  it("surfaces a failure message", () => {
    const v = backfillStatusView(
      { phase: "FAILED", scansDone: 3, scansTotal: 9, result: {}, error: "boom", updatedAt: ago(1), stale: false },
      NOW,
    );
    expect(v.text).toBe("Last run failed: boom");
    expect(v.busy).toBe(false);
  });

  it("handles never having run", () => {
    expect(backfillStatusView(null, NOW)).toEqual({ text: "Never run.", busy: false, poll: false });
  });
});
