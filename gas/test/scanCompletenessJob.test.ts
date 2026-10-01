// The scan job's half of the completeness gate: what the page walk measures about itself and
// hands to the persist (scanJobs.ts), and what it refuses to hand over at all.
//
// The gate (gas_shared/domain/scanCompleteness.ts) can only judge what it is told — the tenant's
// total, and whether any page came back carrying GraphQL errors. Both are facts of the FETCH,
// spread over pages and over continuation hops, so they travel on the job row and reach
// `ledgerStore.persistFlatScan` as `completeness` (a full scan) or `incremental` (a quick
// refresh, which inherits its baseline's verdict). A walk that hits MAX_PAGES with the cursor
// still reporting more fails rather than saving a truncated register, and a deferred scan is
// recorded as a warning.
//
// scanJobs, jobsStore and locks are the REAL modules; the jobs tab is an in-memory table, and
// the Drive/ledger/Wiz edges are fakes whose calls are observable.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const H = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  props: {} as Record<string, string>,
  pages: [] as Record<string, unknown>[],
  maxPages: 1000,
  persisted: [] as Record<string, unknown>[],
  outcome: null as unknown,
  recorded: [] as unknown[][],
  slim: {} as Record<string, unknown[]>,
  scanRows: [] as Record<string, unknown>[],
}));

vi.mock("../src/server/sheetsDb", () => ({
  TABS: { jobs: "jobs" },
  ensureTab: () => {},
  appendRows: (_tab: string, rows: Row[]) => { H.jobs.push(...rows.map((r) => ({ ...r }))); },
  readAll: () => H.jobs,
  readTail: (_tab: string, n: number) => H.jobs.slice(-n),
  updateWhere: (_tab: string, key: string, value: unknown, patch: Row) => {
    const row = H.jobs.find((r) => r[key] === value);
    if (!row) return false;
    Object.assign(row, patch);
    return true;
  },
}));
vi.mock("../src/server/archiveStore", () => ({
  readJournal: () => null,
  trashFile: () => {},
  trashScanArchive: () => {},
  scanFolder: (scanId: string) => ({ getId: () => `folder-${scanId}` }),
  readSlimRecords: (scanId: string) => H.slim[scanId] ?? [],
  readPageRuns: () => [],
  readScanPayload: () => null,
  writeScanPage: () => {},
  writeSlimRecords: () => {},
  writePageRuns: () => {},
  writeFrame: () => {},
}));
vi.mock("../src/server/ledgerStore", () => ({
  writeStateTables: () => {},
  scanRowExists: () => false,
  persistFlatScan: (records: unknown[], options: Row) => {
    H.persisted.push({ records, ...options });
    return H.outcome ?? {
      deltas: { new_count: 0, resolved_count: 0, reopened_count: 0 },
      scanRow: { scan_id: options["scanId"], total: records.length, disappearance: "complete" },
      absent: 0,
    };
  },
  compactLedger: () => {},
  latestFlatScanRow: () => H.scanRows[H.scanRows.length - 1] ?? null,
  loadScanRows: () => H.scanRows,
}));
vi.mock("../src/server/api", () => ({ scheduleWarm: () => true }));
vi.mock("../src/server/errorLog", () => ({
  recordError: (...args: unknown[]) => { H.recorded.push(args); },
}));
vi.mock("../src/server/frameCore", () => ({ buildFrame: () => ({}), pageOfFromRuns: () => () => 1 }));
vi.mock("../src/server/historyStore", () => ({ recordSnapshot: () => {} }));
vi.mock("../src/server/settingsStore", () => ({
  getFetchSeverities: () => null,
  getAutoCompact: () => false,
  getRetentionDays: () => null,
}));
vi.mock("../src/server/supportGroups", () => ({ refreshSupportGroups: () => {} }));
vi.mock("../src/server/wizClient", () => ({
  get MAX_PAGES() { return H.maxPages; },
  WizQueryError: class WizQueryError extends Error {},
  WizDeltaFilterError: class WizDeltaFilterError extends Error {},
  fetchPage: (opts: { pageNumber: number }) => {
    const page = H.pages[Math.min(opts.pageNumber, H.pages.length - 1)]!;
    return { endCursor: `c${opts.pageNumber + 1}`, totalCount: null, partialErrors: [], ...page };
  },
}));

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => H.props[k] ?? null,
    setProperty: (k: string, v: string) => { H.props[k] = v; },
    deleteProperty: (k: string) => { delete H.props[k]; },
  }),
});
vi.stubGlobal("LockService", {
  getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }),
});
vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => [],
  deleteTrigger: () => {},
  newTrigger: () => ({ timeBased: () => ({ after: () => ({ create: () => {} }) }) }),
});

import { continueJob, startScan } from "../src/server/scanJobs";

const n = (id: string): Row => ({ id, name: `CVE-${id}`, severity: "HIGH", status: "OPEN" });

beforeEach(() => {
  H.jobs.length = 0;
  for (const k of Object.keys(H.props)) delete H.props[k];
  H.props["WIZ_API_URL"] = "https://api.example.wiz.io/graphql";
  H.props["WIZ_API_TOKEN"] = "token";
  H.pages = [];
  H.maxPages = 1000;
  H.persisted.length = 0;
  H.outcome = null;
  H.recorded.length = 0;
  H.slim = {};
  H.scanRows = [];
});

describe("the page walk's account of itself reaches the gate", () => {
  it("keeps the total from page 0 and counts every PARTIAL page — nodes kept, errors counted", () => {
    H.pages = [
      { nodes: [n("1"), n("2")], totalCount: 5, hasNextPage: true },
      { nodes: [n("3")], hasNextPage: true, partialErrors: ["Cannot return null for Weakness.name"] },
      { nodes: [n("4")], hasNextPage: false, partialErrors: ["upstream timeout"] },
    ];
    startScan();
    expect(H.persisted).toHaveLength(1);
    expect(H.persisted[0]!["records"]).toHaveLength(4);
    expect(H.persisted[0]!["completeness"]).toEqual({ reportedTotal: 5, partialPages: 2 });
    expect(H.persisted[0]!["incremental"]).toBeNull();
    expect(H.jobs[0]).toMatchObject({ phase: "DONE", total_reported: true, partial_pages: 2 });
  });

  it("a tenant total of 0 is a measurement, and no total at all is not", () => {
    H.pages = [{ nodes: [], totalCount: 0, hasNextPage: false }];
    startScan();
    expect(H.persisted[0]!["completeness"]).toEqual({ reportedTotal: 0, partialPages: 0 });

    H.jobs.length = 0;
    H.pages = [{ nodes: [], totalCount: null, hasNextPage: false }];
    startScan();
    expect(H.persisted[1]!["completeness"]).toEqual({ reportedTotal: null, partialPages: 0 });
  });

  it("survives a continuation hop on the job row: a RECONCILING resume reads it back", () => {
    const base = {
      kind: "scan", phase: "RECONCILING", cursor: null, page: 2, findings_so_far: 0,
      page_size: 0, total_count: 0, journal_ref: null, error: null,
      params_json: JSON.stringify({
        mode: "live", severities: null, extraFilterBy: null, incremental: false, baselineScanId: null,
      }),
      started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    H.jobs.push({ ...base, job_id: "scan-a", scan_id: "s-a", total_reported: true, partial_pages: 2 });
    continueJob();
    expect(H.persisted[0]!["completeness"]).toEqual({ reportedTotal: 0, partialPages: 2 });

    // A job row from before the columns existed: a 0 total reads as NOT reported, so an empty
    // walk defers rather than resolving the register.
    H.jobs.push({ ...base, job_id: "scan-b", scan_id: "s-b" });
    continueJob();
    expect(H.persisted[1]!["completeness"]).toEqual({ reportedTotal: null, partialPages: 0 });
  });
});

describe("MAX_PAGES", () => {
  it("fails the scan instead of saving a truncated register", () => {
    H.maxPages = 3;
    H.pages = [{ nodes: [n("1")], totalCount: 9, hasNextPage: true }];
    expect(() => startScan()).toThrow(/Refusing to truncate/);
    expect(H.persisted).toHaveLength(0);
    expect(H.jobs[0]).toMatchObject({ phase: "FAILED", page: 3 });
    expect(String(H.jobs[0]!["error"])).toMatch(/MAX_PAGES \(3\)/);
  });

  it("a walk that ENDS on the last allowed page is complete, not truncated", () => {
    H.maxPages = 2;
    H.pages = [
      { nodes: [n("1")], totalCount: 2, hasNextPage: true },
      { nodes: [n("2")], hasNextPage: false },
    ];
    startScan();
    expect(H.persisted).toHaveLength(1);
    expect(H.jobs[0]).toMatchObject({ phase: "DONE" });
  });
});

describe("a deferred scan is a warning in the error log", () => {
  it("names the reason and the counts, and how many open findings were held", () => {
    H.pages = [{ nodes: [n("1"), n("2")], totalCount: 20, hasNextPage: false }];
    H.outcome = {
      deltas: { new_count: 0, resolved_count: 0, reopened_count: 0 },
      scanRow: {
        scan_id: "s1", mode: "live", total: 2, reported_total: 20, partial_pages: 0, duplicates: 0,
        disappearance: "deferred:short",
      },
      absent: 7,
    };
    startScan();
    const warnings = H.recorded.filter((r) => r[0] === "scanCompleteness");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![2]).toBe("warning");
    expect(warnings[0]![1]).toBe(
      "Scan s1 looked incomplete (short: 2 received, 20 reported, 0 duplicate(s), 0 partial " +
        "page(s)). 7 open finding(s) it did not return were left open; the next complete scan " +
        "will resolve them.",
    );
    expect(H.jobs[0]).toMatchObject({ phase: "DONE" });
  });

  it("a quick refresh says it inherited the deferral rather than that its delta was short", () => {
    H.scanRows = [{
      scan_id: "2026-08-01T00:00:00Z", ts: "2026-08-01T00:00:00Z", shape: "flat",
      severities: null, disappearance: "deferred:empty",
    }];
    H.slim["2026-08-01T00:00:00Z"] = [n("1")];
    H.pages = [{ nodes: [n("2")], totalCount: 1, hasNextPage: false }];
    H.outcome = {
      deltas: { new_count: 1, resolved_count: 0, reopened_count: 0 },
      scanRow: { scan_id: "s2", mode: "incremental", total: 2, disappearance: "deferred:empty" },
      absent: 3,
    };
    startScan({ incremental: true });
    const warnings = H.recorded.filter((r) => r[0] === "scanCompleteness");
    expect(warnings.map((w) => w[1])).toEqual([
      "Quick refresh s2 was built on a deferred scan (empty), so it was deferred too. 3 open " +
        "finding(s) it did not return were left open; the next complete scan will resolve them.",
    ]);
  });

  it("a complete scan records nothing", () => {
    H.pages = [{ nodes: [n("1")], totalCount: 1, hasNextPage: false }];
    startScan();
    expect(H.recorded.filter((r) => r[0] === "scanCompleteness")).toEqual([]);
  });
});

describe("a quick refresh hands over its baseline's verdict, not a gate of its own", () => {
  it("passes the baseline's stored verdict and the DELTA's own duplicates and partial pages", () => {
    H.scanRows = [{
      scan_id: "2026-08-01T00:00:00Z", ts: "2026-08-01T00:00:00Z", shape: "flat",
      severities: null, disappearance: "deferred:short",
    }];
    H.slim["2026-08-01T00:00:00Z"] = [n("1"), n("2")];
    H.pages = [{ nodes: [n("2"), n("3"), n("3")], totalCount: 3, hasNextPage: false, partialErrors: ["x"] }];
    startScan({ incremental: true });
    expect(H.persisted).toHaveLength(1);
    const p = H.persisted[0]!;
    expect(p["completeness"]).toBeNull();
    expect(p["incremental"]).toEqual({
      baselineDisappearance: "deferred:short", partialPages: 1, duplicates: 1,
    });
    // The merged set: baseline 1, 2 with the delta laid over, 3 appended once.
    expect((p["records"] as Row[]).map((r) => r["id"])).toEqual(["1", "2", "3"]);
  });
});
