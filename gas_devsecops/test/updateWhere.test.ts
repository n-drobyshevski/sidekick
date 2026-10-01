// `sheetsDb.updateWhere` over the dev harness's real Sheets fake: it reads the tail of the tab
// first and falls back to the rest only when the key is not there.
//
// The cost being removed was a whole-tab read on EVERY job-row write — `jobsStore.updateJob`
// runs once per fetched page, the `jobs` tab gains a row per sync and is never trimmed, and the
// row being written is almost always the one appended moments ago. The fake counts the cells
// each `getValues` reads, so the saving is measured rather than asserted.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootServer, measure, teardownServer } from "./gasEnv";

type SheetsDb = typeof import("../src/server/sheetsDb");
let db: SheetsDb;

const ROWS = 400;
const jobRow = (i: number) => ({ job_id: `job-${i}`, kind: "sync", phase: "DONE", page: i });

beforeEach(async () => {
  const server = await bootServer();
  server.setup();
  db = await import("../src/server/sheetsDb");
  db.appendRows(db.TABS.jobs, Array.from({ length: ROWS }, (_, i) => jobRow(i)));
});

afterEach(() => {
  teardownServer();
});

const phaseOf = (id: string) =>
  db.readAll(db.TABS.jobs).find((r) => r["job_id"] === id)?.["phase"];

describe("updateWhere", () => {
  it("writes the newest row off a bounded tail read", () => {
    const cols = db.TAB_HEADERS[db.TABS.jobs]!.length;
    const { value, counters } = measure(() =>
      db.updateWhere(db.TABS.jobs, "job_id", `job-${ROWS - 1}`, { phase: "FETCHING" }));
    expect(value).toBe(true);
    expect(phaseOf(`job-${ROWS - 1}`)).toBe("FETCHING");
    // The header (ensureHeaders) plus at most 50 trailing rows — nowhere near the whole tab.
    expect(counters.cellsRead).toBeLessThanOrEqual(51 * cols + cols);
    expect(counters.cellsRead).toBeLessThan(ROWS * cols);
  });

  it("falls back to the rest of the tab for a key above the tail", () => {
    expect(db.updateWhere(db.TABS.jobs, "job_id", "job-0", { phase: "FAILED" })).toBe(true);
    expect(phaseOf("job-0")).toBe("FAILED");
    expect(phaseOf("job-1")).toBe("DONE");
  });

  it("patches only the keys it is given, and only the matching row", () => {
    db.updateWhere(db.TABS.jobs, "job_id", "job-200", { phase: "PERSISTING" });
    const rows = db.readAll(db.TABS.jobs);
    expect(rows.filter((r) => r["phase"] === "PERSISTING").map((r) => r["job_id"])).toEqual(["job-200"]);
    expect(rows.find((r) => r["job_id"] === "job-200")!["page"]).toBe(200);
  });

  it("answers false for a key the tab does not hold, and writes nothing", () => {
    const before = JSON.stringify(db.readAll(db.TABS.jobs));
    expect(db.updateWhere(db.TABS.jobs, "job_id", "job-missing", { phase: "FAILED" })).toBe(false);
    expect(JSON.stringify(db.readAll(db.TABS.jobs))).toBe(before);
  });

  it("finds a key on a tab shorter than the tail", () => {
    db.overwrite(db.TABS.jobs, [jobRow(1), jobRow(2)]);
    expect(db.updateWhere(db.TABS.jobs, "job_id", "job-1", { phase: "CANCELLED" })).toBe(true);
    expect(phaseOf("job-1")).toBe("CANCELLED");
    expect(db.updateWhere(db.TABS.jobs, "job_id", "job-9", { phase: "CANCELLED" })).toBe(false);
  });
});
