// Pure view-model for the sync progress card/dialog. `.ts` importing a client `.js`
// works under vitest (no allowJs needed at runtime); syncProgressView is DOM-free.

import { describe, expect, it } from "vitest";
// @ts-expect-error — client module is plain JS, no d.ts
import { syncProgressView } from "../src/client/js/syncProgress.js";

const T0 = Date.parse("2026-07-06T12:00:00Z");
const base = {
  job_id: "sync-1",
  kind: "sync",
  phase: "FETCHING",
  sync_id: "2026-07-06T12:00:00Z",
  page: 0,
  step_index: 0,
  nodes_so_far: 0,
  total_count: 0,
  error: null,
  started_at: "2026-07-06T12:00:00Z",
  updated_at: "2026-07-06T12:00:00Z",
};

describe("syncProgressView", () => {
  it("computes a real percentage while fetching when total_count is known", () => {
    const v = syncProgressView(
      { ...base, page: 7, step_index: 6, nodes_so_far: 3100, total_count: 5000, updated_at: "2026-07-06T12:00:10Z" },
      T0 + 10_000,
    );
    expect(v.state).toBe("running");
    expect(v.pct).toBe(62); // round(3100/5000*100)
    expect(v.countsText).toContain("3,100 rows");
    expect(v.countsText).toContain("query 7");
    expect(v.countsText).toContain("page 7");
    expect(v.canStop).toBe(true);
  });

  it("caps the fetch percentage at 99 until DONE", () => {
    const v = syncProgressView({ ...base, nodes_so_far: 5000, total_count: 5000 }, T0 + 1000);
    expect(v.pct).toBe(99);
  });

  it("is indeterminate while fetching with no total_count", () => {
    const v = syncProgressView({ ...base, page: 2, nodes_so_far: 900 }, T0 + 1000);
    expect(v.pct).toBeNull();
  });

  it("is indeterminate during reconcile/persist and cannot be stopped", () => {
    for (const phase of ["RECONCILING", "PERSISTING"]) {
      const v = syncProgressView({ ...base, phase, nodes_so_far: 5000, total_count: 5000 }, T0);
      expect(v.pct).toBeNull();
      expect(v.canStop).toBe(false);
    }
  });

  it("reports 100% and all steps done on DONE", () => {
    const v = syncProgressView({ ...base, phase: "DONE", nodes_so_far: 5000 }, T0);
    expect(v.state).toBe("done");
    expect(v.pct).toBe(100);
    expect(v.steps.every((s: { status: string }) => s.status === "done")).toBe(true);
  });

  it("surfaces the error text on FAILED", () => {
    const v = syncProgressView({ ...base, phase: "FAILED", error: "boom" }, T0);
    expect(v.state).toBe("failed");
    expect(v.error).toBe("boom");
    expect(v.canStop).toBe(false);
  });

  it("scrubs the string 'null'/'undefined' error a bad round-trip leaves behind", () => {
    expect(syncProgressView({ ...base, error: "null" }, T0).error).toBe("");
    expect(syncProgressView({ ...base, error: "undefined" }, T0).error).toBe("");
    expect(syncProgressView({ ...base, error: "  " }, T0).error).toBe("");
    // A real message that merely mentions null still survives.
    expect(syncProgressView({ ...base, error: "got null cursor" }, T0).error).toBe("got null cursor");
  });

  it("flags a stuck job only after a long silence, and leaves fresh/short stalls alone", () => {
    const fresh = syncProgressView({ ...base, updated_at: "2026-07-06T12:00:00Z" }, T0 + 60_000);
    expect(fresh.stalled).toBe(true); // short stall
    expect(fresh.stuck).toBe(false);
    const dead = syncProgressView({ ...base, updated_at: "2026-07-06T12:00:00Z" }, T0 + 6 * 60_000);
    expect(dead.stuck).toBe(true);
  });

  it("maps CANCELLED to a neutral, unstoppable state", () => {
    const v = syncProgressView({ ...base, phase: "CANCELLED" }, T0);
    expect(v.state).toBe("cancelled");
    expect(v.canStop).toBe(false);
  });

  it("flags a stall when the row hasn't advanced (between trigger hops)", () => {
    const fresh = syncProgressView({ ...base, updated_at: "2026-07-06T12:00:00Z" }, T0 + 5_000);
    expect(fresh.stalled).toBe(false);
    const stale = syncProgressView({ ...base, updated_at: "2026-07-06T12:00:00Z" }, T0 + 20_000);
    expect(stale.stalled).toBe(true);
    expect(stale.phaseLabel).toMatch(/waiting/i);
  });

  it("marks the active phase in the stepper", () => {
    const v = syncProgressView({ ...base, phase: "RECONCILING" }, T0);
    const byKey = Object.fromEntries(v.steps.map((s: { key: string; status: string }) => [s.key, s.status]));
    expect(byKey.FETCHING).toBe("done");
    expect(byKey.RECONCILING).toBe("active");
    expect(byKey.PERSISTING).toBe("todo");
  });

  it("formats elapsed as M:SS and H:MM:SS", () => {
    expect(syncProgressView(base, T0 + 134_000).elapsedText).toBe("2:14");
    expect(syncProgressView(base, T0 + 3_661_000).elapsedText).toBe("1:01:01");
  });
});
