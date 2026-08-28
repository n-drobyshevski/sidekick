// What the scan card says, without a DOM.
//
// The drawing half is checked in the browser (that is where this round's three defects were
// found); this is the half that decides the words, the percentage and which controls exist.

import { describe, expect, it } from "vitest";
import { scanProgressView } from "../src/client/js/scanProgress.js";

const NOW = Date.parse("2026-09-01T12:00:00Z");
const labels = { sca: "Dependencies", sast: "Code", secrets: "Secrets" };

const job = (over = {}) => ({
  job_id: "scan-1", phase: "FETCHING", scope: "sca",
  scopes: ["sca", "sast", "secrets"], step: 0, steps_total: 3,
  page: 8, findings_so_far: 4000, total_count: 17991,
  error: null, stale: false,
  started_at: new Date(NOW - 90_000).toISOString(),
  updated_at: new Date(NOW - 5_000).toISOString(),
  ...over,
});
const view = (over) => scanProgressView(job(over), { nowMs: NOW, scopeLabels: labels });

describe("the stepper names the registers", () => {
  it("labels every scope, not only the one in flight", () => {
    // MEASURED IN THE BROWSER. With only `steps_total` on the wire this drew
    // "Dependencies — active, Register 2 — waiting, Register 3 — waiting" — which answers
    // none of the questions the stepper exists for. `scopes` is shipped by `jobStatus` for
    // exactly this.
    expect(view().scopes.map((s) => `${s.label}:${s.status}`))
      .toEqual(["Dependencies:active", "Code:waiting", "Secrets:waiting"]);
  });

  it("marks the registers already committed as done", () => {
    // The fact a reader most wants during a long scan: what is already safe if the rest
    // fails. A scope before the one in flight has its scan row written and its findings in
    // the ledger.
    expect(view({ scope: "secrets", step: 2 }).scopes.map((s) => s.status))
      .toEqual(["done", "done", "active"]);
  });

  it("falls back to the raw key when no label map arrived", () => {
    expect(scanProgressView(job(), { nowMs: NOW }).scopes[0].label).toBe("sca");
  });
});

describe("the percentage", () => {
  it("is determinate only while collecting, and only with a total", () => {
    expect(view().pct).toBe(22);
    expect(view({ total_count: 0 }).pct).toBeNull();
  });

  it("goes indeterminate for reconcile and save", () => {
    // Neither reports progress, so a bar creeping through them would be inventing a rate.
    expect(view({ phase: "RECONCILING" }).pct).toBeNull();
    expect(view({ phase: "PERSISTING" }).pct).toBeNull();
  });

  it("never reaches 100 before it is done", () => {
    // A full bar under a running scan reads as finished. The last page is the one most
    // likely to fail, and a reader who walked away at 100% would not know.
    expect(view({ findings_so_far: 17991 }).pct).toBe(99);
    expect(view({ phase: "DONE" }).pct).toBe(100);
  });
});

describe("stopping", () => {
  it("is offered while collecting", () => {
    expect(view().canStop).toBe(true);
  });

  it("is withdrawn once the commit starts", () => {
    // Reconcile and persist are one indivisible write. Interrupting it is the only way to
    // leave the ledger half-written, which is what the journal exists to undo.
    expect(view({ phase: "RECONCILING" }).canStop).toBe(false);
    expect(view({ phase: "PERSISTING" }).canStop).toBe(false);
  });

  it("is withdrawn from a job the server calls stale", () => {
    // Nothing is running to receive the signal. The card offers a fresh scan instead, and
    // `app.js` brings the Run button back for exactly this state.
    expect(view({ stale: true }).canStop).toBe(false);
  });
});

describe("stalled is not the same as stale", () => {
  it("does not cry stall across a normal hop boundary", () => {
    // The continuation delay is 30 seconds, so a gap of that order IS the shape of a resumed
    // scan. A threshold under it would flash a warning at every hop.
    expect(view({ updated_at: new Date(NOW - 30_000).toISOString() }).stalled).toBe(false);
  });

  it("notes a longer silence, without calling the job dead", () => {
    const v = view({ updated_at: new Date(NOW - 60_000).toISOString() });
    expect(v.stalled).toBe(true);
    expect(v.stale).toBe(false);
    expect(v.canStop).toBe(true); // still offered: nothing says it has stopped
  });

  it("trusts the SERVER's staleness over any local sum", () => {
    // The browser's clock can be minutes off, and the costly direction of that error is a
    // wedged job that still looks live with its recovery hidden behind "still working".
    expect(view({ stale: true, updated_at: new Date(NOW).toISOString() }).stale).toBe(true);
  });
});

describe("terminal states", () => {
  it("names each one in the reader's words", () => {
    expect(view({ phase: "DONE" }).phaseLabel).toBe("Complete");
    expect(view({ phase: "FAILED" }).phaseLabel).toBe("Failed");
    expect(view({ phase: "CANCELLED" }).phaseLabel).toBe("Stopped");
  });

  it("scrubs the two strings a bad round trip leaves in the error", () => {
    expect(view({ phase: "FAILED", error: "null" }).error).toBe("");
    expect(view({ phase: "FAILED", error: "[sca] the tenant refused" }).error)
      .toBe("[sca] the tenant refused");
  });

  it("answers nothing for no job rather than throwing", () => {
    expect(scanProgressView(null)).toBeNull();
  });
});
