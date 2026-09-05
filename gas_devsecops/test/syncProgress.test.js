// syncProgress.js's state logic, exercised without a browser — `syncViewModel` and
// `shouldContinuePolling` are pure functions of a job summary (`jobSummarySlice`'s shape) and
// the wall clock, so this file never imports a DOM. Same posture as shared.test.js and
// charts.test.js: hold the SOURCE against its own contract rather than boot a renderer.
//
// The job summary this file builds mirrors src/domain/pagePayload.ts's `jobSummarySlice`
// output: job_id, kind, phase, scope, page, findings_so_far, total_count, started_at,
// updated_at, error, stale, incremental — never `cursor` or `journal_ref` (that module's own
// SECURITY RULE). The "never reads cursor/journal_ref" case below still puts both on the
// fixture, on purpose: the view model must ignore them even if a future server bug ever let
// them leak onto the wire, not merely because today's server never sends them.

import { describe, expect, it, vi } from "vitest";
import { shouldContinuePolling, syncViewModel, SYNC_SCOPES } from "../src/client/js/syncProgress.js";

const NOW = Date.parse("2026-09-03T12:00:00Z");

/** A job summary, defaulted to a healthy mid-FETCHING sca row. `updated_at` sits 2s before
 *  NOW — well under STALL_MS (15s) — so a fixture is "still moving" unless a test says
 *  otherwise; the stall/stuck behaviour itself gets its own timestamps where it matters. */
function job(overrides = {}) {
  return {
    job_id: "job-1",
    kind: "sync",
    phase: "FETCHING",
    scope: "sca",
    page: 3,
    findings_so_far: 1500,
    total_count: 17991,
    started_at: new Date(NOW - 5 * 60 * 1000).toISOString(),
    updated_at: new Date(NOW - 2000).toISOString(),
    error: null,
    stale: false,
    incremental: false,
    ...overrides,
  };
}

describe("SYNC_SCOPES", () => {
  it("walks sca, then sast, then secrets — src/domain/config.ts's SCOPES order", () => {
    expect(SYNC_SCOPES).toEqual(["sca", "sast", "secrets"]);
  });
});

describe("shouldContinuePolling", () => {
  it("stops on a null job — nothing running, never started or already reclaimed", () => {
    expect(shouldContinuePolling(null)).toBe(false);
    expect(shouldContinuePolling(undefined)).toBe(false);
  });

  it("stops on every terminal phase", () => {
    for (const phase of ["DONE", "FAILED", "CANCELLED"]) {
      expect(shouldContinuePolling(job({ phase })), phase).toBe(false);
    }
  });

  it("continues through every non-terminal phase", () => {
    for (const phase of ["FETCHING", "RECONCILING", "PERSISTING"]) {
      expect(shouldContinuePolling(job({ phase })), phase).toBe(true);
    }
  });
});

// A minimal stand-in for app.js's real poll loop (watchJob/applyJob/stopWatch), built ONLY
// from the exported `shouldContinuePolling` — so this proves the predicate actually stops a
// live timer, not just that a view object looks different. app.js's own loop cannot be
// imported here (it is wired to module-scope DOM state), so this is the closest a
// DOM-free test gets to the real thing: same gate, same clearInterval call, same shape.
function pollUntilStopped(fetchJob) {
  let timer = setInterval(() => {}, 3000);
  const tick = () => {
    const j = fetchJob();
    if (!shouldContinuePolling(j)) {
      clearInterval(timer);
      timer = null;
    }
  };
  tick();
  return { tick, isRunning: () => timer !== null };
}

describe("the poll actually stops (not just the view)", () => {
  it("clears the timer on a null job", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const poller = pollUntilStopped(() => null);
      expect(poller.isRunning()).toBe(false);
      expect(clearSpy).toHaveBeenCalledTimes(1);
    } finally {
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each(["DONE", "FAILED", "CANCELLED"])("clears the timer on phase %s", (phase) => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const poller = pollUntilStopped(() => job({ phase }));
      expect(poller.isRunning()).toBe(false);
      expect(clearSpy).toHaveBeenCalledTimes(1);
    } finally {
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does NOT clear the timer while a job is still running", () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const poller = pollUntilStopped(() => job({ phase: "FETCHING" }));
      expect(poller.isRunning()).toBe(true);
      expect(clearSpy).not.toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("the three-scope walk", () => {
  it("produces three distinct scope labels", () => {
    const v = syncViewModel(job({ phase: "FETCHING", scope: "sca" }), NOW);
    const labels = v.scopeSequence.map((s) => s.label);
    expect(labels).toEqual(["SCA", "SAST", "Secrets"]);
    expect(new Set(labels).size).toBe(3);
  });

  it("marks sca active and the rest queued while sca is in flight", () => {
    const v = syncViewModel(job({ phase: "FETCHING", scope: "sca" }), NOW);
    expect(v.scopeSequence.map((s) => s.status)).toEqual(["active", "todo", "todo"]);
  });

  it("marks sca complete once sast is in flight", () => {
    const v = syncViewModel(job({ phase: "FETCHING", scope: "sast" }), NOW);
    expect(v.scopeSequence.map((s) => s.status)).toEqual(["done", "active", "todo"]);
  });

  it("marks sca and sast complete once secrets is in flight", () => {
    const v = syncViewModel(job({ phase: "FETCHING", scope: "secrets" }), NOW);
    expect(v.scopeSequence.map((s) => s.status)).toEqual(["done", "done", "active"]);
  });

  it("names the in-flight register in the phase label", () => {
    expect(syncViewModel(job({ phase: "FETCHING", scope: "sca" }), NOW).phaseLabel)
      .toBe("Fetching SCA");
    expect(syncViewModel(job({ phase: "FETCHING", scope: "sast" }), NOW).phaseLabel)
      .toBe("Fetching SAST");
    expect(syncViewModel(job({ phase: "FETCHING", scope: "secrets" }), NOW).phaseLabel)
      .toBe("Fetching Secrets");
  });

  it("reads every scope as done once the walk is past FETCHING, whatever scope is left "
    + "on the row (scanJobs.ts nulls it out the moment the last scope finishes)", () => {
    for (const phase of ["RECONCILING", "PERSISTING", "DONE"]) {
      const v = syncViewModel(job({ phase, scope: null }), NOW);
      expect(v.scopeSequence.map((s) => s.status), phase).toEqual(["done", "done", "done"]);
    }
  });
});

describe("the full phase sequence renders a distinct state for each", () => {
  it("FETCHING, RECONCILING, PERSISTING and DONE are four different views", () => {
    const views = ["FETCHING", "RECONCILING", "PERSISTING", "DONE"].map((phase) =>
      syncViewModel(job({ phase, scope: phase === "FETCHING" ? "sca" : null }), NOW),
    );
    const phases = views.map((v) => v.phase);
    expect(phases).toEqual(["FETCHING", "RECONCILING", "PERSISTING", "DONE"]);
    // No two renders collapse to the same JSON — each phase is visibly its own state, not a
    // shared "running" bucket with an unread field distinguishing them.
    const serialized = views.map((v) => JSON.stringify(v));
    expect(new Set(serialized).size).toBe(4);
    expect(views.map((v) => v.phaseLabel))
      .toEqual(["Fetching SCA", "Reconciling ledger", "Saving", "Complete"]);
    expect(views.map((v) => v.state)).toEqual(["running", "running", "running", "done"]);
  });
});

describe("failed vs. cancelled", () => {
  it("FAILED surfaces job.error and reads as failed, not cancelled", () => {
    const v = syncViewModel(job({ phase: "FAILED", scope: null, error: "Wiz API: 500" }), NOW);
    expect(v.state).toBe("failed");
    expect(v.phaseLabel).toBe("Failed");
    expect(v.error).toBe("Wiz API: 500");
  });

  it("a bad round-trip error ('null'/'undefined' strings, blank) reads as no error", () => {
    for (const raw of [null, "null", "undefined", "", "   "]) {
      const v = syncViewModel(job({ phase: "FAILED", scope: null, error: raw }), NOW);
      expect(v.error, JSON.stringify(raw)).toBe("");
    }
  });

  it("CANCELLED reads as cancelled, never as failed", () => {
    const v = syncViewModel(job({ phase: "CANCELLED", scope: null, error: null }), NOW);
    expect(v.state).toBe("cancelled");
    expect(v.state).not.toBe("failed");
    expect(v.phaseLabel).toBe("Cancelled");
    expect(v.phaseLabel).not.toMatch(/fail/i);
  });
});

describe("the view model never reads cursor or journal_ref", () => {
  it("holds even when the job summary carries them (a server bug should not ride the wire)", () => {
    const dirty = job({
      cursor: "wiz-endcursor-secret-abc123",
      journal_ref: "drive-file-secret-xyz789",
    });
    const v = syncViewModel(dirty, NOW);
    const out = JSON.stringify(v);
    expect(out).not.toContain("cursor");
    expect(out).not.toContain("journal_ref");
    expect(out).not.toContain("wiz-endcursor-secret-abc123");
    expect(out).not.toContain("drive-file-secret-xyz789");
  });
});

describe("an unknown or missing total_count", () => {
  it("renders no percent and no full bar when total_count is null", () => {
    const v = syncViewModel(job({ phase: "FETCHING", total_count: null }), NOW);
    expect(v.pct).toBeNull();
    expect(v.scopeTotal).toBeNull();
    expect(JSON.stringify(v)).not.toContain("NaN");
  });

  it("renders no percent and no full bar when total_count is 0 (unknown, per the jobs tab's "
    + "own column definition)", () => {
    const v = syncViewModel(job({ phase: "FETCHING", total_count: 0 }), NOW);
    expect(v.pct).toBeNull();
    expect(v.scopeTotal).toBeNull();
    expect(JSON.stringify(v)).not.toContain("NaN");
  });

  it("renders no percent when total_count is missing from the object entirely", () => {
    const j = job({ phase: "FETCHING" });
    delete j.total_count;
    const v = syncViewModel(j, NOW);
    expect(v.pct).toBeNull();
    expect(JSON.stringify(v)).not.toContain("NaN");
  });

  it("never divides findings_so_far by total_count — cumulative over one scope's total is "
    + "not a percentage of anything past the first register", () => {
    // The numbers are the real shape of the trap: by the time the walk reaches sast, the
    // cumulative count is the whole sca register and total_count is sast's 127 rows, so the
    // bad ratio is ~14,567%. page/page_size say sast is one page into a one-page register.
    const v = syncViewModel(
      job({
        phase: "FETCHING", scope: "sast",
        findings_so_far: 18500, total_count: 127, page: 0, page_size: 500,
      }),
      NOW,
    );
    expect(v.pct).toBe(0);            // page 0 of 1 — not 14567
    expect(v.pct).not.toBe(Math.round((18500 * 100) / 127));
  });

  it("reports the page-based fraction of the CURRENT register, capped below 100", () => {
    // 18 pages of 500 done, 18,839 rows in the sca register -> 9000/18839 = 47.8% -> 48.
    const v = syncViewModel(
      job({
        phase: "FETCHING", scope: "sca",
        findings_so_far: 9000, total_count: 18839, page: 18, page_size: 500,
      }),
      NOW,
    );
    expect(v.pct).toBe(48);
    expect(v.scopePct).toBe(48);
  });

  it("caps at 99 while still fetching, so the bar cannot claim done before DONE", () => {
    // The last page overshoots: 1 page of 500 over a 127-row register is 394%.
    const v = syncViewModel(
      job({
        phase: "FETCHING", scope: "sast",
        findings_so_far: 18966, total_count: 127, page: 1, page_size: 500,
      }),
      NOW,
    );
    expect(v.pct).toBe(99);
  });

  it("has no page-based fraction outside FETCHING — RECONCILING and PERSISTING are not paged", () => {
    for (const phase of ["RECONCILING", "PERSISTING"]) {
      const v = syncViewModel(
        job({ phase, scope: null, total_count: 18839, page: 38, page_size: 500 }),
        NOW,
      );
      expect(v.pct, phase).toBeNull();
    }
  });

  it("is exactly 100 once the job is DONE", () => {
    const v = syncViewModel(job({ phase: "DONE", scope: null, total_count: 0 }), NOW);
    expect(v.pct).toBe(100);
  });
});

describe("a stalled or stuck run reads as such rather than as a healthy fetch", () => {
  it("flags stalled between continuation hops (>15s since the last row write) and swaps "
    + "the phase label rather than still naming the register", () => {
    const v = syncViewModel(
      job({ phase: "FETCHING", scope: "sast", updated_at: new Date(NOW - 20_000).toISOString() }),
      NOW,
    );
    expect(v.stalled).toBe(true);
    expect(v.phaseLabel).toBe("Waiting for next step…");
  });

  it("flags stuck after 5 minutes of silence", () => {
    const v = syncViewModel(
      job({ phase: "FETCHING", updated_at: new Date(NOW - 6 * 60 * 1000).toISOString() }),
      NOW,
    );
    expect(v.stuck).toBe(true);
  });

  it("never flags a terminal job as stalled or stuck, whatever its last-updated time reads", () => {
    for (const phase of ["DONE", "FAILED", "CANCELLED"]) {
      const v = syncViewModel(
        job({ phase, scope: null, updated_at: new Date(NOW - 60 * 60 * 1000).toISOString() }),
        NOW,
      );
      expect(v.stalled, phase).toBe(false);
      expect(v.stuck, phase).toBe(false);
    }
  });
});

describe("a null job renders nothing", () => {
  it("returns null rather than throwing", () => {
    expect(syncViewModel(null, NOW)).toBeNull();
    expect(syncViewModel(undefined, NOW)).toBeNull();
  });
});
