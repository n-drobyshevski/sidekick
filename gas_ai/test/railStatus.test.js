// What the dot at the foot of the rail says.
//
// It is the whole status readout on the default layout — above 800px the caption beside it is
// visually hidden — so these are not cosmetic assertions. Each one pins a sentence a reader is
// entitled to, in a place where the alternative is a coloured circle and nothing.
//
// Ported from gas/test/railStatus.test.js, narrowed to gas_ai's own facts: one register, one
// job kind ("sync"), running phases FETCHING/RECONCILING/PERSISTING, progress from
// nodes_so_far/total_count — see railStatus.js's own header for the rest.

import { describe, expect, it } from "vitest";
import { DRY_RUN_DETAIL, railStatus, STALE_AFTER_DAYS } from "../src/client/js/railStatus.js";

const NOW = Date.parse("2026-09-01T12:00:00Z");
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();
const DAY_MS = 86_400_000;

const base = {
  hasCredentials: true,
  nowMs: NOW,
  job: null,
};

describe("precedence: running beats everything", () => {
  it("says what is happening now before anything about the past", () => {
    const s = railStatus({
      ...base,
      lastSyncAt: ago(30), // a genuinely stale register, and it must not show
      job: { phase: "FETCHING", nodes_so_far: 1500, total_count: 17991 },
    });
    expect(s.state).toBe("scanning");
    expect(s.label).toBe("Sync in progress");
    expect(s.detail).toBe("1,500 of 17,991 records");
  });

  it("moves through every running phase, not only the first one", () => {
    for (const phase of ["FETCHING", "RECONCILING", "PERSISTING"]) {
      const s = railStatus({ ...base, lastSyncAt: null, job: { phase, nodes_so_far: 1, total_count: 0 } });
      expect(s.state).toBe("scanning");
    }
  });

  it("falls back to a plain count when the tenant reports no total", () => {
    const s = railStatus({
      ...base,
      lastSyncAt: ago(0),
      job: { phase: "PERSISTING", nodes_so_far: 250, total_count: 0 },
    });
    expect(s.detail).toBe("250 records so far");
  });
});

describe("precedence: a failure outranks a stale or fresh register", () => {
  it("reports the failure over a stale register", () => {
    const s = railStatus({ ...base, lastSyncAt: ago(30), job: { phase: "FAILED" } });
    expect(s.state).toBe("bad");
    expect(s.label).toBe("Last sync failed");
  });

  it("reports the failure over a register that never synced", () => {
    const s = railStatus({ ...base, lastSyncAt: null, job: { phase: "FAILED" } });
    expect(s.state).toBe("bad");
    expect(s.label).toBe("Last sync failed");
  });
});

describe("no tenant is not a fault, and it does not override freshness", () => {
  // gas_devsecops ranks `!hasCredentials` ahead of freshness because that app disables its
  // sync button without a tenant — there really is no register behind it. gas_ai falls back to
  // a SIMULATED dry-run sync instead, so a dry-run register can have real sync history with a
  // real, time-varying age. Collapsing that to one constant "Dry run" state would erase
  // whether a dry-run register has gone stale — a fact that stays true, and stays worth
  // knowing, regardless of credential mode. So the mode rides as DETAIL, decorating whichever
  // freshness verdict actually fired.

  it("a dry-run register that has never synced is still NEVER, not a separate dry-run state", () => {
    const s = railStatus({ ...base, hasCredentials: false, lastSyncAt: null });
    expect(s.state).toBe("neutral");
    expect(s.label).toBe("No sync has run yet");
    expect(s.detail).toBe(DRY_RUN_DETAIL);
  });

  it("a dry-run register synced today is OK, decorated, not collapsed to a dry-run-only state", () => {
    const s = railStatus({ ...base, hasCredentials: false, lastSyncAt: ago(0) });
    expect(s.state).toBe("ok");
    expect(s.label).toBe("Synced today");
    expect(s.detail).toBe(DRY_RUN_DETAIL);
  });

  // THE ONE THAT MATTERS. A dry-run register can still be STALE — the mode does not launder
  // the age away.
  it("a dry-run register can still be STALE — the mode does not launder the age away", () => {
    const s = railStatus({ ...base, hasCredentials: false, lastSyncAt: ago(40) });
    expect(s.state).toBe("warn");
    expect(s.label).toBe("Last sync 40 days ago — stale");
    expect(s.detail).toBe(DRY_RUN_DETAIL);
  });

  it("with real credentials, freshness carries no dry-run detail at all", () => {
    const s = railStatus({ ...base, hasCredentials: true, lastSyncAt: ago(0) });
    expect(s.state).toBe("ok");
    expect(s.detail).toBe("");
  });

  it("does not decorate running or failed with the dry-run detail", () => {
    const running = railStatus({
      ...base, hasCredentials: false, lastSyncAt: null,
      job: { phase: "FETCHING", nodes_so_far: 1, total_count: 0 },
    });
    expect(running.detail).not.toContain("Dry run");
    const failed = railStatus({ ...base, hasCredentials: false, lastSyncAt: null, job: { phase: "FAILED" } });
    expect(failed.detail).not.toContain("Dry run");
  });
});

describe("says NEVER SYNCED rather than guessing an age for it", () => {
  it("labels a register with no sync at all", () => {
    const s = railStatus({ ...base, lastSyncAt: null });
    expect(s.state).toBe("neutral");
    expect(s.label).toBe("No sync has run yet");
  });

  it("treats an absent field the same as an explicit null", () => {
    const s = railStatus({ hasCredentials: true, nowMs: NOW, job: null });
    expect(s.label).toBe("No sync has run yet");
  });

  it("treats blank and non-string forms the same as null, before any cast", () => {
    expect(railStatus({ ...base, lastSyncAt: "" }).label).toBe("No sync has run yet");
    expect(railStatus({ ...base, lastSyncAt: undefined }).label).toBe("No sync has run yet");
  });
});

describe("freshness", () => {
  it("calls a same-day sync today and a one-day-old one yesterday", () => {
    expect(railStatus({ ...base, lastSyncAt: ago(0) }).label).toBe("Synced today");
    expect(railStatus({ ...base, lastSyncAt: ago(1) }).label).toBe("Synced yesterday");
  });

  it("calls it stale at exactly the threshold, in the exact wording the design specifies", () => {
    const s = railStatus({ ...base, lastSyncAt: ago(STALE_AFTER_DAYS) });
    expect(s.state).toBe("warn");
    expect(s.label).toBe(`Last sync ${STALE_AFTER_DAYS} days ago — stale`);
  });

  it("does not call an unreadable date fresh", () => {
    // The quiet way a broken clock becomes a green tick.
    const s = railStatus({ ...base, lastSyncAt: "not-a-date" });
    expect(s.state).toBe("neutral");
    expect(s.state).not.toBe("ok");
    expect(s.label).toBe("Sync date could not be read");
  });

  it("a staleAfterDays override moves the threshold", () => {
    const s = railStatus({ ...base, lastSyncAt: ago(1), staleAfterDays: 1 });
    expect(s.state).toBe("warn");
  });

  it("names the day count for an ok sync older than yesterday under a widened threshold", () => {
    const s = railStatus({ ...base, lastSyncAt: ago(3), staleAfterDays: 5 });
    expect(s.state).toBe("ok");
    expect(s.label).toBe("Synced 3 days ago");
  });
});

describe("it survives a payload it does not recognise", () => {
  it("answers rather than throwing on nothing at all", () => {
    // It runs during boot, before anything else has drawn. A throw here is a blank app.
    expect(railStatus().state).toBeTruthy();
    expect(railStatus({}).label).toBeTruthy();
  });
});

// ============================================================================ perturbation
//
// THE CLAIM UNDER TEST: "never synced" must outrank a freshness verdict, checked BEFORE any
// age is computed at all — because a register with no sync has no age to compute. The
// perturbation targets the mechanism a real regression would actually take here: reading an
// ABSENT last-sync timestamp as epoch 0 instead of refusing it — the exact "Number(null) is 0,
// and it is finite" trap CLAUDE.md names three times over, applied to a date instead of a
// count.
//
// Run against the REAL railStatus, `lastSyncAt: null` correctly answers "No sync has run yet"
// (asserted above). The defective copy below deletes the never-synced check and folds a
// missing timestamp into `Date.parse(String(iso ?? ""))` the way a "simplify the two
// branches" rewrite of daysSince() would — `Date.parse("")` is `NaN`, so THAT alone would just
// read as "unreadable"; the version that actually produces a specific wrong age is one that
// falls further back to `byScope[s] || 0`, treating "no sync" as "a sync happened at the Unix
// epoch". Confirmed to fail before being corrected: run with
// `expect(defective(...).label).toBe("No sync has run yet")` instead of the assertion below,
// this failed with
//   AssertionError: expected 'Last sync 20697 days ago — stale' to be 'No sync has run yet'
// which is what "the perturbation bites" means here — the guard is not decorative.
describe("perturbation: reorder never below stale -> a specific, wrong age for a register nobody synced", () => {
  function defectiveRailStatus({ lastSyncAt, nowMs, staleAfterDays }) {
    // THE BUG: the never-synced check is gone, and an absent timestamp folds into "epoch 0"
    // instead of being refused, so a register that has never been synced reads as one synced
    // ~57 years ago.
    const lastTs = lastSyncAt || 0;
    const d = Math.floor((nowMs - lastTs) / DAY_MS);
    if (d >= staleAfterDays) {
      return { state: "warn", label: `Last sync ${d} days ago — stale` };
    }
    return { state: "ok", label: "Synced today" };
  }

  it("the defective ordering reports a specific, wrong age for a register nobody has synced", () => {
    const defective = defectiveRailStatus({ lastSyncAt: null, nowMs: NOW, staleAfterDays: STALE_AFTER_DAYS });
    expect(defective.state).toBe("warn");
    expect(defective.label).not.toBe("No sync has run yet");
    expect(defective.label).toMatch(/^Last sync \d+ days ago — stale$/);
  });

  it("the real implementation refuses to make that mistake", () => {
    const real = railStatus({ ...base, lastSyncAt: null });
    expect(real.state).toBe("neutral");
    expect(real.label).toBe("No sync has run yet");
  });
});
