import { describe, expect, it } from "vitest";
import { purgeStatusView } from "../src/client/js/purgeStatus.js";

const NOW = Date.parse("2026-08-25T12:00:00Z");

function status(over = {}) {
  return {
    jobId: "purge-1",
    phase: "DONE",
    scansTotal: 10,
    scansDone: 10,
    error: null,
    updatedAt: "2026-08-25T11:59:00Z",
    stale: false,
    result: {
      severities: ["LOW"], scopeNarrowed: true,
      ledgerRemoved: 4000, episodeRemoved: 312, checkpointRemoved: 50, scopesNarrowed: 3,
      scansRewritten: 10, recordsRemoved: 9000, scansSealed: 0, scansUnreadable: 0,
      cellsBefore: 1_000_000, cellsAfter: 900_000,
    },
    ...over,
  };
}

describe("purgeStatusView", () => {
  it("never run", () => {
    const v = purgeStatusView(null, NOW);
    expect(v.text).toBe("Never run.");
    expect(v.busy).toBe(false);
    expect(v.poll).toBe(false);
  });

  it("running with a known total prints a denominator and a percentage", () => {
    const v = purgeStatusView(status({ phase: "PURGING", scansDone: 4 }), NOW);
    expect(v.text).toContain("4 of 10");
    expect(v.pct).toBe(40);
    expect(v.busy).toBe(true);
    expect(v.poll).toBe(true);
  });

  it("an unrecorded total is never printed as a denominator", () => {
    // total_count of 0 means "not recorded" (a jobs tab predating the column), NOT "no
    // scans" — printing "4 of 0" would be nonsense and a percentage would be a lie.
    const v = purgeStatusView(status({ phase: "PURGING", scansTotal: 0, scansDone: 4 }), NOW);
    expect(v.text).not.toContain(" of 0");
    expect(v.text).toContain("4 done so far");
    expect(v.pct).toBe(null);
  });

  it("a stalled job says so and hands the button back", () => {
    const v = purgeStatusView(
      status({ phase: "PURGING", stale: true, updatedAt: "2026-08-25T11:00:00Z" }), NOW);
    expect(v.text).toContain("Appears stalled");
    expect(v.text).toContain("60 minute(s)");
    expect(v.busy).toBe(false);
    expect(v.poll).toBe(false);
    expect(v.warn).toBe(true);
  });

  it("a clean terminal run reports complete, with the MEASURED cell delta", () => {
    const v = purgeStatusView(status(), NOW);
    expect(v.complete).toBe(true);
    expect(v.warn).toBe(false);
    expect(v.text).toContain("4,312 lifecycles");
    expect(v.text).toContain("100,000 spreadsheet cell(s) reclaimed");
  });

  it("unreadable archives are NEVER reported as complete", () => {
    // This is the honesty rule the whole feature turns on: those archives still hold the
    // purged findings, so deleting a scan can replay them back. Saying "done" would be the
    // exact lie the archive walk exists to prevent.
    const v = purgeStatusView(
      status({ result: { ...status().result, scansUnreadable: 2, scansRewritten: 8 } }), NOW);
    expect(v.complete).toBe(false);
    expect(v.warn).toBe(true);
    expect(v.text).toContain("2 archive(s) could not be read");
    expect(v.text).toContain("replayed");
  });

  it("sealed scans are 'nothing to rewrite', not a failure", () => {
    // Compaction pruned their archives, so there is nothing left in them to replay. They are
    // not residue and must not drag the run out of 'complete'.
    const v = purgeStatusView(
      status({ result: { ...status().result, scansSealed: 3 } }), NOW);
    expect(v.complete).toBe(true);
    expect(v.warn).toBe(false);
    expect(v.text).toContain("3 sealed (nothing to rewrite)");
  });

  it("a failed run says the removals already made still stand", () => {
    const v = purgeStatusView(status({ phase: "FAILED", error: "Drive timeout" }), NOW);
    expect(v.text).toContain("Drive timeout");
    expect(v.text).toContain("stay removed");
    expect(v.busy).toBe(false);
    expect(v.warn).toBe(true);
  });

  it("singularizes a count of one", () => {
    const v = purgeStatusView(
      status({ result: { ...status().result, ledgerRemoved: 1, episodeRemoved: 0 } }), NOW);
    expect(v.text).toContain("1 lifecycle ");
  });

  it("reports a zero cell delta rather than hiding it", () => {
    // "the meter didn't move" is a finding, not something to suppress.
    const v = purgeStatusView(
      status({ result: { ...status().result, cellsBefore: 500, cellsAfter: 500 } }), NOW);
    expect(v.text).toContain("0 spreadsheet cell(s) reclaimed");
  });
});
