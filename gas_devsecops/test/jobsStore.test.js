// The job row is a CHECKPOINT before it is a progress indicator, and this file exists because
// nothing tested that it survived the trip to the sheet.
//
// A sheet stores cells, not objects. `writeGrid` projects a row onto the tab's DECLARED
// headers (`sheetsDb.ts:446`) and discards every other key, silently — `ensureHeaders` says so
// in its own doc comment. So the fake below models exactly that projection rather than storing
// the objects it is handed: mocking it away would mock away the only thing under test.
//
// What it caught: `JobRow` was forked from gas_ai (`sync_id`, `step_index`, `nodes_so_far`,
// `part_refs_json`) while `TAB_HEADERS[TABS.jobs]` was written for this register (`scan_id`,
// `scope`, `findings_so_far`, `page_size`, `journal_ref`). All four fork-era fields were
// dropped on write and read back as the defaults in `rowToJob`. Nothing threw. A resumed hop
// would have read `cursor: null, page: 0` every time and re-walked the whole register from the
// start, forever — the failure is not a crash, it is an infinite polite re-fetch.

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [], headers: [] }));

vi.mock("../src/server/sheetsDb", async () => {
  const actual = await vi.importActual("../src/server/sheetsDb");
  const headers = actual.TAB_HEADERS[actual.TABS.jobs];
  state.headers = headers;
  // toCell / fromCell, verbatim in behaviour: null and undefined become the empty cell, and
  // an empty cell reads back as null. Nothing else is transformed.
  const project = (r) => headers.map((h) => (r[h] === null || r[h] === undefined ? "" : r[h]));
  const unproject = (cells) => Object.fromEntries(
    headers.map((h, i) => [h, cells[i] === "" || cells[i] === undefined ? null : cells[i]]),
  );
  return {
    ...actual,
    appendRows: (_tab, rows) => { for (const r of rows) state.rows.push(project(r)); },
    readAll: () => state.rows.map(unproject),
    readTail: (_tab, n) => state.rows.slice(-Math.max(1, n)).map(unproject),
    updateWhere: (_tab, keyColumn, keyValue, patch) => {
      const idx = state.rows.findIndex((cells) => unproject(cells)[keyColumn] === keyValue);
      if (idx < 0) return false;
      state.rows[idx] = project({ ...unproject(state.rows[idx]), ...patch });
      return true;
    },
  };
});

const props = vi.hoisted(() => ({}));
vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k) => props[k] ?? null,
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }),
});

const load = () => import("../src/server/jobsStore");

/** A job at the start of its `sca` step, as `startScan` creates one. */
const fresh = (over = {}) => ({
  job_id: "scan-1", kind: "scan", phase: "FETCHING",
  scan_id: "2026-08-28T09:00:00Z", scope: "sca",
  cursor: null, page: 0, findings_so_far: 0, page_size: 500, total_count: 0,
  params_json: JSON.stringify({ scopes: ["sca", "sast", "secrets"] }),
  journal_ref: null, error: null,
  ...over,
});

beforeEach(() => {
  state.rows.length = 0;
  for (const k of Object.keys(props)) delete props[k];
  vi.resetModules();
});

describe("the checkpoint survives the sheet", () => {
  it("reads back every field it wrote, not a sample of them", async () => {
    // THE ONE THIS FILE EXISTS FOR, and it asserts the WHOLE row on purpose. A per-field
    // spot-check only catches the fields someone thought to list; whole-row equality catches
    // the next field whose name drifts from its column, in either direction.
    //
    // It has to compare what `rowToJob` PRODUCES against what `createJob` wrote, because a
    // fixture supplies its own keys — checking the fixture's keys against the headers would
    // have passed against the fork-era shape and proved nothing (measured: it did).
    const { createJob, getJob } = await load();
    const written = createJob(fresh({
      cursor: "eyJvZmZzZXQiOjE1MDB9", page: 3, findings_so_far: 1500, total_count: 17991,
      journal_ref: "1AbCdEf", error: null,
    }));
    expect(getJob("scan-1")).toEqual(written);
  });

  it("reads back the cursor and page a hop stopped on", async () => {
    // The same guarantee stated as the consequence, because the consequence is the point:
    // before the shapes were reconciled this returned `cursor: null, page: 0` —
    // indistinguishable from a scan that had not started, so every hop re-walked the whole
    // register from the beginning.
    const { createJob, updateJob, getJob } = await load();
    createJob(fresh());
    updateJob("scan-1", {
      cursor: "eyJvZmZzZXQiOjE1MDB9", page: 3, findings_so_far: 1500, total_count: 17991,
    });

    const job = getJob("scan-1");
    expect(job.cursor).toBe("eyJvZmZzZXQiOjE1MDB9");
    expect(job.page).toBe(3);
    expect(job.findings_so_far).toBe(1500);
    expect(job.total_count).toBe(17991);
  });

  it("remembers which scope's step is in flight", async () => {
    // A job covers three registers in sequence and each commits its own scans row, so a
    // resumed hop that did not know its scope could reconcile `sast` observations against
    // the `sca` prior — the exact confusion reconcile's own scope guard exists to refuse.
    const { createJob, updateJob, getJob } = await load();
    createJob(fresh());
    updateJob("scan-1", { scope: "secrets", cursor: null, page: 0 });
    expect(getJob("scan-1").scope).toBe("secrets");
  });

  it("keeps the applied severity gate, not a reference to the setting", async () => {
    // A scan records the gate it APPLIED. Settings can move mid-walk, and a hop that re-read
    // them would stamp today's gate on pages fetched under yesterday's.
    const { createJob, getJob } = await load();
    createJob(fresh({ params_json: JSON.stringify({ severities: { sca: ["CRITICAL"] } }) }));
    expect(JSON.parse(getJob("scan-1").params_json).severities.sca).toEqual(["CRITICAL"]);
  });

  it("does not confuse an empty cell with the string 'null'", async () => {
    // Sheets round-trips absence as "", and a stringified null as "null". Both must read as
    // null, or a resumed hop asks the tenant for the literal cursor "null".
    const { createJob, updateJob, getJob } = await load();
    createJob(fresh());
    expect(getJob("scan-1").cursor).toBeNull();
    updateJob("scan-1", { cursor: "null" });
    expect(getJob("scan-1").cursor).toBeNull();
  });
});

describe("single-flight", () => {
  it("finds the running job, and forgets it once it is terminal", async () => {
    const { createJob, updateJob, activeJob } = await load();
    createJob(fresh());
    expect(activeJob().job_id).toBe("scan-1");
    updateJob("scan-1", { phase: "DONE" });
    expect(activeJob()).toBeNull();
  });

  it("self-heals a flag left behind by a crash mid-transition", async () => {
    const { createJob, activeJob } = await load();
    createJob(fresh({ phase: "DONE" }));
    // createJob sets the flag unconditionally; the tab says nothing is running.
    expect(activeJob()).toBeNull();
    expect(props.ACTIVE_JOB_ID).toBeUndefined();
  });

  it("answers 'no job' without reading the sheet at all", async () => {
    // Every bootstrap asks this and almost every answer is no. The fast path is what keeps
    // that one Properties read instead of a whole-tab read.
    const { activeJob } = await load();
    const sheets = await import("../src/server/sheetsDb");
    const spy = vi.spyOn(sheets, "readAll");
    expect(activeJob()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("staleness is decided here, not in the browser", () => {
  it("calls a job with no heartbeat for half an hour stale", async () => {
    const { isStaleJob, STALE_JOB_MS } = await load();
    const at = (ms) => ({ updated_at: new Date(ms).toISOString() });
    const now = Date.parse("2026-08-28T12:00:00Z");
    expect(isStaleJob(at(now - STALE_JOB_MS - 1), now)).toBe(true);
    expect(isStaleJob(at(now - 60_000), now)).toBe(false);
  });

  it("refuses to call an unparseable heartbeat dead", async () => {
    // The row was only just written and the sheet has not handed the timestamp back yet.
    // Reading that as dead would let a running scan be reclaimed out from under itself.
    const { isStaleJob } = await load();
    expect(isStaleJob({ updated_at: "" })).toBe(false);
  });
});
