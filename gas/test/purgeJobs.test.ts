// The severity-purge job: phase machine, resumability, and the interaction guards.
//
// jobsStore is the REAL module (the cursor and single-flight behaviour is what's under test);
// sheetsDb is the in-memory table fake the other job specs use, and the Drive/ledger layers
// are mocked so the archive rewrites are observable as call strings.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [k: string]: unknown;
}

const tables: Record<string, Row[]> = {};
let calls: string[] = [];
let projectTriggers: string[] = [];
const createdTriggers: string[] = [];
let scanRowsList: Row[] = [];
let pageStore: Record<string, Record<number, unknown>> = {};
let slimStore: Record<string, unknown[]> = {};
let unreadableScans = new Set<string>();
let tabsResult = { ledgerRemoved: 0, episodeRemoved: 0, checkpointRemoved: 0, scopesNarrowed: 0 };
let fetchSeverities: string[] = ["CRITICAL", "HIGH", "LOW"];
let savedFetchSeverities: string[] | null = null;

const envelope = (nodes: unknown[]) => ({ data: { vulnerabilityFindings: { nodes } } });

vi.mock("../src/server/sheetsDb", () => ({
  TABS: { jobs: "jobs" },
  ensureTab: () => {},
  appendRows: (tab: string, rows: Row[]) => {
    tables[tab] = [...(tables[tab] ?? []), ...rows];
  },
  readAll: (tab: string) => tables[tab] ?? [],
  updateWhere: (tab: string, key: string, value: unknown, patch: Row) => {
    const row = (tables[tab] ?? []).find((r) => r[key] === value);
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  },
  cellUsage: () => ({ total: 1_000_000, tabs: [] }),
}));

vi.mock("../src/server/archiveStore", () => ({
  listScanPageNumbers: (ref: string | null) => {
    const id = String(ref ?? "").replace(/^folder-/, "");
    if (unreadableScans.has(id)) return [];
    return Object.keys(pageStore[id] ?? {}).map(Number).sort((a, b) => a - b);
  },
  readScanPage: (scanId: string, n: number) => pageStore[scanId]?.[n] ?? null,
  writeScanPage: (scanId: string, n: number, payload: unknown) => {
    calls.push(`writeScanPage:${scanId}:${n}`);
    pageStore[scanId] = { ...(pageStore[scanId] ?? {}), [n]: payload };
    return "file";
  },
  readSlimRecords: (scanId: string) => slimStore[scanId] ?? null,
  writeSlimRecords: (scanId: string, recs: unknown[]) => {
    calls.push(`writeSlimRecords:${scanId}`);
    slimStore[scanId] = recs;
    return "file";
  },
  readFrame: () => null,
  writeFrame: () => "file",
  readObservations: () => [],
  writeObservations: () => "obs-new",
  trashPageRuns: (scanId: string) => calls.push(`trashPageRuns:${scanId}`),
}));

vi.mock("../src/server/ledgerStore", () => ({
  loadScanRows: () => scanRowsList,
  purgeSeverityTabs: (sevs: readonly string[], jobId: string) => {
    calls.push(`purgeSeverityTabs:${sevs.join(",")}:${jobId}`);
    return tabsResult;
  },
  setScanObsRef: (scanId: string, ref: string) => calls.push(`setScanObsRef:${scanId}:${ref}`),
}));

vi.mock("../src/server/settingsStore", () => ({
  getFetchSeverities: () => fetchSeverities,
  setFetchSeverities: (s: string[]) => {
    savedFetchSeverities = s;
    calls.push(`setFetchSeverities:${s.join(",")}`);
  },
}));

vi.mock("../src/server/errorLog", () => ({ recordError: () => {} }));

vi.stubGlobal("LockService", {
  getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
});

vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => projectTriggers.map((h) => ({ getHandlerFunction: () => h })),
  deleteTrigger: (t: { getHandlerFunction: () => string }) => {
    const i = projectTriggers.indexOf(t.getHandlerFunction());
    if (i >= 0) projectTriggers.splice(i, 1);
  },
  newTrigger: (handler: string) => ({
    timeBased: () => ({
      after: () => ({
        create: () => {
          createdTriggers.push(handler);
          projectTriggers.push(handler);
        },
      }),
    }),
  }),
});

function scanRow(scan_id: string, ts: string, over: Row = {}): Row {
  return {
    scan_id, ts, mode: "live", shape: "flat", total: 0, new_count: 0, resolved_count: 0,
    reopened_count: 0, raw_ref: `folder-${scan_id}`, obs_ref: null, severities: null,
    sealed: 0, ...over,
  };
}

beforeEach(() => {
  vi.resetModules();
  for (const k of Object.keys(tables)) delete tables[k];
  calls = [];
  projectTriggers = [];
  createdTriggers.length = 0;
  unreadableScans = new Set();
  tabsResult = { ledgerRemoved: 40, episodeRemoved: 2, checkpointRemoved: 5, scopesNarrowed: 3 };
  fetchSeverities = ["CRITICAL", "HIGH", "LOW"];
  savedFetchSeverities = null;
  scanRowsList = [
    scanRow("s1", "2026-01-01T00:00:00Z"),
    scanRow("s2", "2026-02-01T00:00:00Z"),
    scanRow("s3", "2026-03-01T00:00:00Z"),
  ];
  pageStore = {
    s1: { 1: envelope([{ severity: "LOW" }, { severity: "HIGH" }]) },
    s2: { 1: envelope([{ severity: "LOW" }]) },
    s3: { 1: envelope([{ severity: "HIGH" }]) },
  };
  slimStore = { s1: [{ severity: "LOW" }, { severity: "HIGH" }] };
});

describe("startSeverityPurge", () => {
  it("purges the tabs, then walks every archive, and finishes DONE", async () => {
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    const st = startSeverityPurge(["LOW"], false);

    expect(calls.some((c) => c.startsWith("purgeSeverityTabs:LOW:"))).toBe(true);
    expect(st.phase).toBe("DONE");
    expect(st.result.ledgerRemoved).toBe(40);
    expect(st.result.scopesNarrowed).toBe(3);
    expect(st.result.scansRewritten).toBe(3);
    // s1 had one LOW node, s2 had one; s3 had none.
    expect(st.result.recordsRemoved).toBe(2);
    expect(st.result.scansUnreadable).toBe(0);
  });

  it("actually removes the records from the stored pages", async () => {
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    startSeverityPurge(["LOW"], false);
    const nodes = (pageStore.s1[1] as any).data.vulnerabilityFindings.nodes;
    expect(nodes).toEqual([{ severity: "HIGH" }]);
    expect(slimStore.s1).toEqual([{ severity: "HIGH" }]);
  });

  it("rejects an empty severity list", async () => {
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    expect(() => startSeverityPurge([], false)).toThrow(/at least one severity/i);
  });

  it("refuses while another kind of job holds the single-flight slot", async () => {
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    const { createJob, newJobId } = await import("../src/server/jobsStore");
    createJob({
      job_id: newJobId("scan"), kind: "scan", phase: "FETCHING", scan_id: null, cursor: null,
      page: 0, findings_so_far: 0, page_size: 0, total_count: 0, params_json: null,
      journal_ref: null, error: null,
    });
    expect(() => startSeverityPurge(["LOW"], false)).toThrow(/Another job \(scan\) is running/);
  });

  it("counts a scan whose archive can't be read, without aborting the walk", async () => {
    unreadableScans = new Set(["s2"]);
    delete slimStore.s2;
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    const st = startSeverityPurge(["LOW"], false);
    expect(st.result.scansUnreadable).toBe(1);
    expect(st.result.scansRewritten).toBe(2); // the other two still done
    expect(st.phase).toBe("DONE");
  });

  it("counts sealed scans as nothing-to-rewrite rather than touching them", async () => {
    scanRowsList[0] = scanRow("s1", "2026-01-01T00:00:00Z", { sealed: 1 });
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    const st = startSeverityPurge(["LOW"], false);
    expect(st.result.scansSealed).toBe(1);
    expect(calls).not.toContain("writeScanPage:s1:1");
  });

  it("is idempotent — a second run removes nothing more", async () => {
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    startSeverityPurge(["LOW"], false);
    // Clear the job tab so the second run isn't blocked by its own terminal row.
    tables["jobs"] = (tables["jobs"] ?? []).map((r) => ({ ...r, phase: "DONE" }));
    calls = [];
    const again = startSeverityPurge(["LOW"], false);
    expect(again.result.recordsRemoved).toBe(0);
    expect(calls).not.toContain("writeScanPage:s1:1");
  });

  it("trashes the page-run spill of any scan it rewrote (stale once pages shrink)", async () => {
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    startSeverityPurge(["LOW"], false);
    expect(calls).toContain("trashPageRuns:s1");
    expect(calls).not.toContain("trashPageRuns:s3"); // nothing changed there
  });
});

describe("scan-scope narrowing", () => {
  it("drops the purged severities from the fetch scope when asked", async () => {
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    const st = startSeverityPurge(["LOW"], true);
    expect(savedFetchSeverities).toEqual(["CRITICAL", "HIGH"]);
    expect(st.result.scopeNarrowed).toBe(true);
  });

  it("leaves the scope alone when it isn't asked to narrow it", async () => {
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    const st = startSeverityPurge(["LOW"], false);
    expect(savedFetchSeverities).toBe(null);
    expect(st.result.scopeNarrowed).toBe(false);
  });

  it("refuses to empty the scan scope entirely", async () => {
    // withFetchSeverities falls back to the DEFAULTS on an empty list, which would silently
    // re-enable CRITICAL/HIGH — the opposite of what the operator asked for.
    fetchSeverities = ["LOW"];
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    const st = startSeverityPurge(["LOW"], true);
    expect(savedFetchSeverities).toBe(null);
    expect(st.result.scopeNarrowed).toBe(false);
  });
});

describe("continuation", () => {
  /** Run `fn` with Date.now advancing by `stepMs` on every read, so the hop budget expires. */
  function withRunawayClock<T>(stepMs: number, fn: () => T): T {
    const real = Date.now;
    let t = real();
    Date.now = () => {
      t += stepMs;
      return t;
    };
    try {
      return fn();
    } finally {
      Date.now = real;
    }
  }

  it("stops at the budget and schedules its OWN continuation handler", async () => {
    scanRowsList = Array.from({ length: 40 }, (_, i) =>
      scanRow(`x${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
    pageStore = {};
    slimStore = {};
    const { startSeverityPurge } = await import("../src/server/purgeJobs");
    // 20s per clock read blows the 45s first-hop budget after a couple of scans.
    const st = withRunawayClock(20_000, () => startSeverityPurge(["LOW"], false));

    expect(st.phase).toBe("PURGING");
    expect(st.scansDone).toBeGreaterThan(0);
    expect(st.scansDone).toBeLessThan(40); // it really did stop early
    expect(st.scansTotal).toBe(40);
    // Sharing a handler name would let each job's cleanup delete the other's pending hop.
    expect(createdTriggers).toEqual(["trigger_continuePurge"]);
  });

  it("resumes from the cursor on the next hop", async () => {
    scanRowsList = Array.from({ length: 40 }, (_, i) =>
      scanRow(`x${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
    pageStore = {};
    slimStore = {};
    const { startSeverityPurge, continuePurge, purgeStatus } =
      await import("../src/server/purgeJobs");
    const first = withRunawayClock(20_000, () => startSeverityPurge(["LOW"], false));
    const doneAfterFirst = first.scansDone;

    continuePurge(); // real clock: finishes the remaining scans
    const st = purgeStatus();
    expect(st?.phase).toBe("DONE");
    expect(st?.scansDone).toBe(40);
    expect(doneAfterFirst).toBeLessThan(40);
    // The resumed hop retired the pending trigger rather than leaving it armed.
    expect(projectTriggers).not.toContain("trigger_continuePurge");
  });

  it("jobsStore maps the purge kind to that handler, so reclaimIfStale clears the right one", async () => {
    const { CONTINUE_HANDLERS } = await import("../src/server/jobsStore");
    expect(CONTINUE_HANDLERS.purge).toBe("trigger_continuePurge");
  });

  it("continuePurge ignores a job of another kind", async () => {
    const { continuePurge } = await import("../src/server/purgeJobs");
    const { createJob, newJobId, getJob } = await import("../src/server/jobsStore");
    const job = createJob({
      job_id: newJobId("backfill"), kind: "backfill", phase: "BACKFILLING", scan_id: null,
      cursor: null, page: 0, findings_so_far: 0, page_size: 0, total_count: 0,
      params_json: null, journal_ref: null, error: null,
    });
    continuePurge();
    expect(getJob(job.job_id)?.phase).toBe("BACKFILLING");
  });
});

describe("activePurgeJob (the guard behind api.assertNoActivePurge)", () => {
  // deleteScans and compact both REPLAY scan archives. Neither consults activeJob() on its
  // own, and the purge releases the script lock between hops — so without this guard an
  // operator could rebuild the ledger from archives only half of which have been rewritten,
  // or let buildCheckpoint replay un-rewritten pages back into a fresh checkpoint.
  it("is null when nothing is running", async () => {
    const { activePurgeJob } = await import("../src/server/purgeJobs");
    expect(activePurgeJob()).toBe(null);
  });

  it("is null once the purge reaches a terminal phase", async () => {
    const { startSeverityPurge, activePurgeJob } = await import("../src/server/purgeJobs");
    startSeverityPurge(["LOW"], false); // finishes DONE with three small scans
    expect(activePurgeJob()).toBe(null);
  });

  it("is the job while the archive walk is still going", async () => {
    const { activePurgeJob } = await import("../src/server/purgeJobs");
    const { createJob, newJobId } = await import("../src/server/jobsStore");
    const job = createJob({
      job_id: newJobId("purge"), kind: "purge", phase: "PURGING", scan_id: null, cursor: null,
      page: 1, findings_so_far: 0, page_size: 0, total_count: 9, params_json: null,
      journal_ref: null, error: null,
    });
    expect(activePurgeJob()?.job_id).toBe(job.job_id);
  });

  it("ignores an active job of another kind", async () => {
    const { activePurgeJob } = await import("../src/server/purgeJobs");
    const { createJob, newJobId } = await import("../src/server/jobsStore");
    createJob({
      job_id: newJobId("scan"), kind: "scan", phase: "FETCHING", scan_id: null, cursor: null,
      page: 0, findings_so_far: 0, page_size: 0, total_count: 0, params_json: null,
      journal_ref: null, error: null,
    });
    expect(activePurgeJob()).toBe(null);
  });
});

describe("purgeStatus", () => {
  it("reports the last finished purge when none is running", async () => {
    const { startSeverityPurge, purgeStatus } = await import("../src/server/purgeJobs");
    startSeverityPurge(["LOW"], false);
    const st = purgeStatus();
    expect(st?.phase).toBe("DONE");
    expect(st?.result.severities).toEqual(["LOW"]);
  });

  it("is null before anything has ever run", async () => {
    const { purgeStatus } = await import("../src/server/purgeJobs");
    expect(purgeStatus()).toBe(null);
  });
});
