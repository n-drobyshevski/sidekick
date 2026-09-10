// What the dot at the foot of the rail says.
//
// It is the whole status readout on the default layout — above 800px the caption beside it is
// visually hidden — so these are not cosmetic assertions. Each one pins a sentence a reader is
// entitled to, in a place where the alternative is a coloured circle and nothing.
//
// Ported from gas_devsecops/test/railStatus.test.js and collapsed to gas's one register — see
// railStatus.js's own header for why the shape still takes a `scopes` array of one.

import { describe, expect, it } from "vitest";
import { railStatus, STALE_AFTER_DAYS } from "../src/client/js/railStatus.js";

const NOW = Date.parse("2026-09-01T12:00:00Z");
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();
const DAY_MS = 86_400_000;

const base = {
  hasCredentials: true,
  scopes: ["os"],
  nowMs: NOW,
  job: null,
};

describe("precedence: running beats everything", () => {
  it("says what is happening now before anything about the past", () => {
    const s = railStatus({
      ...base,
      lastScanByScope: { os: ago(30) }, // a genuinely stale register, and it must not show
      job: { phase: "FETCHING", kind: "scan", findings_so_far: 1500, total_count: 17991 },
    });
    expect(s.state).toBe("scanning");
    expect(s.label).toBe("Scan in progress");
    expect(s.detail).toBe("1,500 of 17,991");
  });

  it("names the job by its own kind, not always 'scan' — a live backfill is not a scan", () => {
    const s = railStatus({
      ...base,
      lastScanByScope: { os: ago(0) },
      job: { phase: "BACKFILLING", kind: "backfill", findings_so_far: 4, total_count: 12 },
    });
    expect(s.state).toBe("scanning");
    expect(s.label).toBe("Backfill in progress");
    expect(s.detail).toBe("4 of 12");
  });

  it("falls back to a generic count when the tenant reports no total", () => {
    const s = railStatus({
      ...base,
      lastScanByScope: { os: ago(0) },
      job: { phase: "PERSISTING", kind: "scan", findings_so_far: 250, total_count: 0 },
    });
    expect(s.detail).toBe("250 so far");
  });
});

describe("precedence: a failure outranks a stale or fresh register", () => {
  it("reports the failure over a stale register", () => {
    const s = railStatus({
      ...base,
      lastScanByScope: { os: ago(30) },
      job: { phase: "FAILED", kind: "scan" },
    });
    expect(s.state).toBe("bad");
    expect(s.label).toBe("Last scan failed");
  });

  it("names a failed maintenance job by its own noun", () => {
    const s = railStatus({
      ...base,
      lastScanByScope: { os: ago(0) },
      job: { phase: "FAILED", kind: "purge" },
    });
    expect(s.label).toBe("Last purge failed");
  });

  it("falls back to a plain noun for a job whose kind this module does not recognise", () => {
    const s = railStatus({ ...base, lastScanByScope: { os: ago(0) }, job: { phase: "FAILED" } });
    expect(s.label).toBe("Last job failed");
  });
});

describe("no tenant is not a fault, and it does not override freshness", () => {
  // gas_devsecops ranks `!hasCredentials` ahead of freshness because that app disables its
  // sync button without a tenant — there really is no register behind it. gas and gas_ai
  // fall back to a SIMULATED dry-run scan instead, so a dry-run register can have real scan
  // history with a real, time-varying age. Collapsing that to one constant "Dry run" state
  // (the earlier draft of this file) would erase whether a dry-run register has gone stale —
  // a fact that stays true, and stays worth knowing, regardless of credential mode. So the
  // mode rides as DETAIL, decorating whichever freshness verdict actually fired.

  it("a dry-run register that has never scanned is still NEVER, not a separate dry-run state", () => {
    const s = railStatus({ ...base, hasCredentials: false, lastScanByScope: { os: null } });
    expect(s.state).toBe("neutral");
    expect(s.label).toBe("No scan has run yet");
    expect(s.detail).toContain("Dry run");
    expect(s.detail).toContain("simulated");
  });

  it("a dry-run register scanned today is OK, decorated, not collapsed to a dry-run-only state", () => {
    const s = railStatus({ ...base, hasCredentials: false, lastScanByScope: { os: ago(0) } });
    expect(s.state).toBe("ok");
    expect(s.label).toBe("Scanned today");
    expect(s.detail).toContain("Dry run");
  });

  it("a dry-run register can still be STALE — the mode does not launder the age away", () => {
    const s = railStatus({ ...base, hasCredentials: false, lastScanByScope: { os: ago(40) } });
    expect(s.state).toBe("warn");
    expect(s.label).toBe("Last scan 40 days ago — stale");
    expect(s.detail).toContain("Dry run");
  });

  it("with real credentials, freshness carries no dry-run detail at all", () => {
    const s = railStatus({ ...base, hasCredentials: true, lastScanByScope: { os: ago(0) } });
    expect(s.state).toBe("ok");
    expect(s.detail).toBe("");
  });

  it("does not decorate the 'no register collected' state — that is a configuration fact, not a freshness one", () => {
    const s = railStatus({ ...base, hasCredentials: false, scopes: [], lastScanByScope: {} });
    expect(s.state).toBe("neutral");
    expect(s.label).toBe("No register is collected");
    expect(s.detail).toBe("");
  });
});

describe("says NEVER SCANNED rather than guessing an age for it", () => {
  it("labels a register with no scan at all", () => {
    const s = railStatus({ ...base, lastScanByScope: { os: null } });
    expect(s.state).toBe("neutral");
    expect(s.label).toBe("No scan has run yet");
  });

  it("treats an absent key the same as an explicit null", () => {
    const s = railStatus({ ...base, lastScanByScope: {} });
    expect(s.label).toBe("No scan has run yet");
  });
});

describe("freshness", () => {
  it("calls a same-day scan today and a one-day-old one yesterday", () => {
    expect(railStatus({ ...base, lastScanByScope: { os: ago(0) } }).label).toBe("Scanned today");
    expect(railStatus({ ...base, lastScanByScope: { os: ago(1) } }).label).toBe("Scanned yesterday");
  });

  it("calls it stale at exactly the threshold, in the exact wording the sibling's design specifies", () => {
    const s = railStatus({ ...base, lastScanByScope: { os: ago(STALE_AFTER_DAYS) } });
    expect(s.state).toBe("warn");
    expect(s.label).toBe(`Last scan ${STALE_AFTER_DAYS} days ago — stale`);
  });

  it("does not call an unreadable date fresh", () => {
    // The quiet way a broken clock becomes a green tick.
    const s = railStatus({ ...base, lastScanByScope: { os: "not-a-date" } });
    expect(s.state).toBe("neutral");
    expect(s.state).not.toBe("ok");
    expect(s.label).toBe("Scan date could not be read");
  });

  it("a staleAfterDays override moves the threshold", () => {
    const s = railStatus({ ...base, lastScanByScope: { os: ago(1) }, staleAfterDays: 1 });
    expect(s.state).toBe("warn");
  });
});

describe("it survives a payload it does not recognise", () => {
  it("answers rather than throwing on nothing at all", () => {
    // It runs during boot, before anything else has drawn. A throw here is a blank app.
    expect(railStatus().state).toBeTruthy();
    expect(railStatus({}).label).toBeTruthy();
  });

  it("treats an empty scopes list as nothing collected rather than throwing", () => {
    const s = railStatus({ ...base, scopes: [], lastScanByScope: {} });
    expect(s.state).toBe("neutral");
    expect(s.label).toBe("No register is collected");
  });
});

// ============================================================================ perturbation
//
// THE CLAIM UNDER TEST: "never scanned" must outrank a freshness verdict, checked BEFORE any
// age is computed at all — because a register with no scan has no age to compute. Collapsed
// to one scope there is no second, already-fresh scope to average the never-scanned one
// against (the sibling's own version), so the perturbation instead targets the mechanism a
// real regression would actually take here: reading an ABSENT last-scan timestamp as epoch 0
// instead of refusing it — the exact "Number(null) is 0, and it is finite" trap CLAUDE.md
// names three times over, applied to a date instead of a count.
//
// Run against the REAL railStatus, `lastScanByScope: { os: null }` correctly answers
// "No scan has run yet" (asserted above). The defective copy below deletes the never-scanned
// check and folds a missing timestamp into the age loop with `byScope[s] || 0` — treating
// "no scan" as "a scan happened at the Unix epoch" — and prints a wildly wrong but
// plausible-looking STALE verdict instead. Confirmed to fail before being corrected: run with
// `expect(defective(...).label).toBe("No scan has run yet")` instead of the assertion below,
// this failed with
//   AssertionError: expected 'Last scan 20697 days ago — stale' to be 'No scan has run yet'
// which is what "the perturbation bites" means here — the guard is not decorative.
describe("perturbation: a register that has never run must not be read as merely old", () => {
  function defectiveRailStatus({ scopes, lastScanByScope, nowMs }) {
    const byScope = lastScanByScope || {};
    let worst = null;
    for (const s of scopes) {
      // THE BUG: an absent timestamp folds into "epoch 0" instead of being refused, so a
      // register that has never been scanned reads as one scanned ~57 years ago.
      const lastTs = byScope[s] || 0;
      const d = Math.floor((nowMs - lastTs) / DAY_MS);
      if (worst === null || d > worst) worst = d;
    }
    if (worst >= STALE_AFTER_DAYS) {
      return { state: "warn", label: `Last scan ${worst} days ago — stale` };
    }
    return { state: "ok", label: "Scanned today" };
  }

  it("the defective ordering reports a specific, wrong age for a register nobody has scanned", () => {
    const defective = defectiveRailStatus({ scopes: ["os"], lastScanByScope: { os: null }, nowMs: NOW });
    expect(defective.state).toBe("warn");
    expect(defective.label).not.toBe("No scan has run yet");
    expect(defective.label).toMatch(/^Last scan \d+ days ago — stale$/);
  });

  it("the real implementation refuses to make that mistake", () => {
    const real = railStatus({ ...base, lastScanByScope: { os: null } });
    expect(real.state).toBe("neutral");
    expect(real.label).toBe("No scan has run yet");
  });
});
