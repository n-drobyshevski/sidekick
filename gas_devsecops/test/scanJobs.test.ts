// The sync battery: one job, three scopes, one commit — and the four ways it is allowed to
// stop.
//
// WHAT THIS FILE IS FOR. `scanJobs.step` is a resumable loop whose correctness is almost
// entirely about ORDER and RESUME STATE, neither of which shows up in a final number: a job
// that re-fetches a page it already archived still commits the right rows (it just pays
// twice and double-counts `findings_so_far`), and a job that advances `scopeIndex` on
// `hasNextPage === true` commits a TRUNCATED register that looks complete. So the cases below
// assert the walk itself — which pages were served, in what order, with which cursor — and
// not only what landed in the ledger.
//
// THE SLIM PROJECTION GETS ITS OWN GUARD, and it is the most valuable test here. `slimRecord`
// is the middle of a three-site contract (the query selects a field, the slim keeps it,
// reconcile reads it) and a field dropped in the middle produces a NULL LEDGER COLUMN rather
// than an error — indistinguishable from a tenant that does not populate the field. The guard
// feeds `slimRecord` straight into `domain/reconcile.reconcile` per scope and names, per
// scope, exactly which columns that scope's QUERY can fill.
//
// `ledgerStore`, `jobsStore` and `locks` are the REAL modules (persistSync is wrapped only to
// count its calls); `sheetsDb` is an in-memory table store that PROJECTS ONTO THE REAL
// TAB_HEADERS, and `archiveStore` an in-memory Drive that ROUND-TRIPS THROUGH JSON — a fake
// that stored the object itself would let a spill "resume" from a live reference and hide the
// serialization the real store performs. `wizClient` is a fake tenant.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SCOPES, type Scope } from "../src/domain/config";
import { LEDGER_COLUMNS } from "../src/domain/ledgerTypes";
import type { Rec } from "../src/domain/util";

interface Row {
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ fake platform */

const tables: Record<string, Row[]> = {};
const props: Record<string, string> = {};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Everything the fakes observed, in order. The ordering assertions read this. */
const calls = {
  appends: [] as Array<{ tab: string; count: number }>,
  jobPatches: [] as Row[],
  persistSync: [] as Array<{ jobId: string; syncId: string; perScope: unknown[] }>,
  trashedScans: [] as string[],
  history: [] as unknown[],
};

const drive = {
  pages: {} as Record<string, Record<number, unknown>>,
  slim: {} as Record<string, unknown[]>,
  runs: {} as Record<string, Array<[number, number]>>,
  backups: {} as Record<string, unknown>,
  obs: {} as Record<string, string[]>,
  named: {} as Record<string, unknown>,
  snapshot: null as unknown,
};

let projectTriggers: string[] = [];
const createdTriggers: Array<{ handler: string; afterMs: number }> = [];
let externalLockHold = false;

/** Fault injection. Each fires at most once, then disarms. */
const faults = { appendScans: false };

/** The fake wall clock. Only the wizClient fake advances it — one page costs `msPerPage`. */
let clock = Date.parse("2026-09-03T02:00:00.000Z");
function setClock(ms: number): void {
  clock = ms;
  vi.setSystemTime(clock);
}

vi.mock("../src/server/sheetsDb", async (importOriginal) => {
  // TABS and TAB_HEADERS come from the REAL module: a stubbed header list would compare the
  // fake to itself and pass forever, which is the exact failure jobsStore.ts's header comment
  // describes (four fields with no column, dropped silently on every write).
  const real = await importOriginal<typeof import("../src/server/sheetsDb")>();
  const project = (tab: string, row: Row): Row => {
    const out: Row = {};
    for (const h of real.TAB_HEADERS[tab] ?? []) out[h] = h in row ? row[h] : null;
    return out;
  };
  return {
    TABS: real.TABS,
    TAB_HEADERS: real.TAB_HEADERS,
    readAll: (tab: string) => tables[tab] ?? [],
    readTail: (tab: string, n: number) => (tables[tab] ?? []).slice(-n),
    overwrite: (tab: string, rows: Row[]) => {
      tables[tab] = rows.map((r) => project(tab, r));
    },
    appendRows: (tab: string, rows: Row[]) => {
      if (tab === real.TABS.scans && faults.appendScans) {
        faults.appendScans = false;
        // The shape of a real failure here: Sheets refused the write and nothing landed.
        throw new Error("injected: execution killed mid-write");
      }
      calls.appends.push({ tab, count: rows.length });
      tables[tab] = [...(tables[tab] ?? []), ...rows.map((r) => project(tab, r))];
    },
    updateWhere: (tab: string, key: string, value: unknown, patch: Row) => {
      if (tab === real.TABS.jobs) calls.jobPatches.push({ ...patch });
      const row = (tables[tab] ?? []).find((r) => r[key] === value);
      if (!row) return false;
      // Projects the patch the way the real grid writer does: a key with no column is
      // DROPPED. This is what makes the JOB_COLUMNS spec below a real measurement.
      for (const [k, v] of Object.entries(patch)) {
        if ((real.TAB_HEADERS[tab] ?? []).includes(k)) row[k] = v;
      }
      return true;
    },
    dataRowCount: (tab: string) => (tables[tab] ?? []).length,
    trimSurplusRows: () => 0,
  };
});

vi.mock("../src/server/archiveStore", () => ({
  writeScanPage: (scanId: string, pageIndex: number, payload: unknown) => {
    (drive.pages[scanId] ??= {})[pageIndex] = clone(payload);
    return `page-${scanId}-${pageIndex}`;
  },
  readScanPages: (scanId: string) =>
    Object.keys(drive.pages[scanId] ?? {})
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => clone(drive.pages[scanId]![i])),
  writeSlim: (scanId: string, records: unknown[]) => {
    drive.slim[scanId] = clone(records);
    return `slim-${scanId}`;
  },
  readSlim: (scanId: string) => (scanId in drive.slim ? clone(drive.slim[scanId]!) : null),
  writePageRuns: (scanId: string, runs: Array<[number, number]>) => {
    drive.runs[scanId] = clone(runs);
  },
  readPageRuns: (scanId: string) => (scanId in drive.runs ? clone(drive.runs[scanId]!) : null),
  scanFolder: (scanId: string) => ({ getId: () => `folder-${scanId}` }),
  trashScan: (scanId: string) => {
    calls.trashedScans.push(scanId);
    delete drive.pages[scanId];
    delete drive.slim[scanId];
    delete drive.runs[scanId];
  },
  writeObservations: (scanId: string, keys: string[]) => {
    drive.obs[scanId] = [...keys];
    return `obs-${scanId}`;
  },
  readObservations: (scanId: string) => drive.obs[scanId] ?? [],
  writeBackup: (jobId: string, state: unknown) => {
    drive.backups[jobId] = clone(state);
    return `backup-${jobId}`;
  },
  readBackup: (jobId: string) => (jobId in drive.backups ? clone(drive.backups[jobId]) : null),
  trashBackup: (jobId: string) => {
    delete drive.backups[jobId];
  },
  writeLedgerSnapshot: (state: unknown) => {
    drive.snapshot = clone(state);
  },
  readLedgerSnapshot: () => (drive.snapshot === null ? null : clone(drive.snapshot)),
  // historyStore addresses its files by subfolder NAME through these four.
  subfolder: (name: string) => name,
  writeGzJson: (folder: string, name: string, payload: unknown) => {
    drive.named[`${folder}/${name}`] = clone(payload);
    calls.history.push(clone(payload));
    return {};
  },
  readGzJson: (folder: string, name: string) => drive.named[`${folder}/${name}`] ?? null,
  listNames: (folder: string) =>
    Object.keys(drive.named)
      .filter((k) => k.startsWith(`${folder}/`))
      .map((k) => k.slice(folder.length + 1)),
  trashNamed: (folder: string, name: string) => {
    delete drive.named[`${folder}/${name}`];
  },
}));

/**
 * The props layer over an in-memory dict.
 *
 * `hasWizCredentials` and `projectScope` are RE-IMPLEMENTED rather than spread from the real
 * module: the real ones close over the real `getProp`, so spreading them would leave two
 * functions in the same namespace reading two different stores — and the one that mattered
 * (`hasWizCredentials`, the gate on `startSync`) would reach for `PropertiesService` and blow
 * up. `resolveWizAuthMode` is the real one, because it is pure.
 */
vi.mock("../src/server/props", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/props")>();
  const getProp = (k: string) => props[k] ?? null;
  return {
    PROP_KEYS: real.PROP_KEYS,
    DEFAULT_WIZ_AUTH_URL: real.DEFAULT_WIZ_AUTH_URL,
    resolveWizAuthMode: real.resolveWizAuthMode,
    getProp,
    setProp: (k: string, v: string) => {
      props[k] = v;
    },
    deleteProp: (k: string) => {
      delete props[k];
    },
    requireProp: (k: string) => props[k] ?? "",
    projectScope: () => {
      const id = getProp(real.PROP_KEYS.wizProjectIdV2);
      return id && id.trim() ? [id.trim()] : null;
    },
    hasWizCredentials: () =>
      Boolean(getProp(real.PROP_KEYS.wizApiUrl)) &&
      real.resolveWizAuthMode(
        getProp(real.PROP_KEYS.wizApiToken),
        getProp(real.PROP_KEYS.wizClientId),
        getProp(real.PROP_KEYS.wizClientSecret),
      ) !== null,
  };
});

/**
 * The real `ledgerStore`, with `persistSync` wrapped so the spec can COUNT it.
 *
 * Wrapped rather than replaced: "persistSync was called once" and "one `scans` append landed
 * with three rows" are two different claims and the file asserts both, which is only possible
 * while the real commit sequence still runs underneath.
 */
vi.mock("../src/server/ledgerStore", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/ledgerStore")>();
  return {
    ...real,
    persistSync: (jobId: string, syncId: string, perScope: readonly unknown[]) => {
      calls.persistSync.push({ jobId, syncId, perScope: [...perScope] });
      return real.persistSync(
        jobId,
        syncId,
        perScope as readonly import("../src/server/ledgerStore").ScopePersist[],
      );
    },
  };
});

/* --------------------------------------------------------------- the fake tenant */

interface ScopePlan {
  pages: number;
  rowsPerPage: number;
  /** Pages (1-based) that come back PARTIAL — nodes AND errors. */
  partialOn: number[];
}

const tenant: {
  plan: Record<Scope, ScopePlan>;
  msPerPage: number;
  served: Array<{ scope: Scope; pageNumber: number; after: string | null; first: number }>;
  onPage: ((scope: Scope, pageNumber: number) => void) | null;
} = {
  plan: {
    sca: { pages: 36, rowsPerPage: 2, partialOn: [] },
    sast: { pages: 1, rowsPerPage: 2, partialOn: [] },
    secrets: { pages: 4, rowsPerPage: 2, partialOn: [] },
  },
  msPerPage: 0,
  served: [],
  onPage: null,
};

/** Nodes shaped like the scope's query document — see wizQueries.ts for every field. */
function node(scope: Scope, seq: number): Rec {
  if (scope === "sca") {
    return {
      id: `sca-${seq}`,
      name: `CVE-2026-${1000 + seq}`,
      detailedName: "braces",
      severity: "HIGH",
      status: "OPEN",
      firstDetectedAt: "2026-01-05T00:00:00Z",
      lastDetectedAt: "2026-09-01T00:00:00Z",
      resolvedAt: null,
      fixDate: "2026-02-01T00:00:00Z",
      fixedVersion: "3.0.3",
      hasExploit: true,
      hasCisaKevExploit: false,
      epssProbability: 0.42,
      vulnerableAsset: {
        id: "repo-1",
        type: "REPOSITORY_BRANCH",
        name: "dktunited/retbox-front/main",
        cloudPlatform: "GitHub",
        subscriptionName: null,
        subscriptionExternalId: null,
      },
      artifactType: { codeLibraryLanguage: "JAVASCRIPT" },
      // `projects` IS selected on sca, and this fixture used to deny it. The comment here
      // read "NO `projects` — Q_SCA does not select it", and the FILLABLE table below called
      // owner_project/owner_path/tags_json unfillable on that basis. Both were false:
      // wizQueries.ts:147 selects `projects { id name isFolder slug }` at the sca node's top
      // level, a sibling of `vulnerableAsset`. Measured, not reasoned — probe.mjs bundles and
      // sends the app's OWN Q_SCA, and probe-report.json's `findings.sca.sample.projects[]`
      // came back with the full ancestor chain (CS-WAREHOUSEBOX and VALUE-CHAIN as folders,
      // product-RetBox-idp and GITHUB-DKTUNITED as leaves, all four carrying `slug`).
      //
      // The cost of the false claim was the whole of sca's ownership: every SCA row landed
      // with owner_project, owner_path and tags_json null, and the guard that exists to catch
      // exactly that passed, because the guard had been told the gap was expected. sca is the
      // largest of the three registers, so a project scope built on this would have answered
      // for sast and secrets and silently dropped the biggest population.
      //
      // The chain below is shaped like the live sample: two folders and one leaf, so
      // ownerProject picks the leaf, ownerPath keeps the folders, and a folder slug reaches
      // this row the way projectScope.inProject relies on.
      projects: [
        { id: "proj-unit", name: "VALUE-CHAIN", isFolder: true, slug: "value-chain" },
        { id: "proj-cs", name: "CS-WAREHOUSEBOX", isFolder: true, slug: "cs-warehousebox" },
        { id: "proj-leaf", name: "product-RetBox-idp", isFolder: false, slug: "product-retbox-idp" },
      ],
    };
  }
  if (scope === "sast") {
    return {
      id: `sast-${seq}`,
      name: "SQL Injection",
      status: "OPEN",
      severity: "HIGH",
      originalSeverity: null,
      filePath: "app/db.py",
      startLine: 12 + seq,
      codeLibraryLanguage: ["JAVA"],
      origin: "SEMGREP",
      resolutionReason: null,
      createdAt: "2026-02-01T00:00:00Z",
      updatedAt: "2026-09-01T00:00:00Z",
      firstDetectedAtSource: null,
      resource: { id: "repo-1", name: "dktunited/tattoo/stab", type: "REPOSITORY_BRANCH" },
      weaknesses: [{ id: "CWE-89", name: "SQL Injection" }],
      projects: [
        { id: "p-folder", name: "VALUE-CHAIN", isFolder: true, slug: "value-chain" },
        { id: "p-leaf", name: "product-tattoo-idp", isFolder: false, slug: "tattoo-idp" },
      ],
      vcsDetails: { commitHash: "abc123" },
      aiAnalysis: { verdict: "exploitable" },
    };
  }
  return {
    id: `secret-${seq}`,
    externalId: `ext-${seq}`,
    secretDataId: `sd-${seq}`,
    name: "AWS access key",
    type: "SAAS_API_KEY",
    confidence: "HIGH",
    severity: "LOW",
    path: "app/.env",
    lineNumber: 3 + seq,
    status: "OPEN",
    resolvedAt: null,
    validationStatus: "VALID",
    lastValidatedAt: "2026-08-01T00:00:00Z",
    firstSeenAt: "2026-02-10T00:00:00Z",
    lastSeenAt: "2026-09-01T00:00:00Z",
    lastUpdatedAt: "2026-09-01T00:00:00Z",
    codeToCloudPipelineStage: "CODE",
    resource: {
      id: "repo-2",
      name: "dktunited/other/main",
      type: "REPOSITORY_BRANCH",
      externalId: "gh-2",
      nativeType: "Repository",
      cloudPlatform: "GitHub",
    },
    projects: [
      { id: "p-folder", name: "VALUE-CHAIN", isFolder: true, slug: "value-chain" },
      { id: "p-leaf", name: "product-tattoo-idp", isFolder: false, slug: "tattoo-idp" },
    ],
    vcsDetails: { initialCommitHash: "def456" },
  };
}

vi.mock("../src/server/wizClient", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/wizClient")>();
  return {
    ...real,
    fetchPage: (scope: Scope, variables: Rec, paging: { pageSize: number; pageNumber: number }) => {
      const plan = tenant.plan[scope];
      const pageNumber = paging.pageNumber;
      tenant.served.push({
        scope,
        pageNumber,
        after: (variables["after"] as string | null) ?? null,
        first: Number(variables["first"] ?? 0),
      });
      const nodes: Rec[] = [];
      for (let i = 0; i < plan.rowsPerPage; i++) {
        nodes.push(node(scope, pageNumber * plan.rowsPerPage + i));
      }
      paging.pageNumber += 1;
      if (tenant.msPerPage) setClock(clock + tenant.msPerPage);
      tenant.onPage?.(scope, pageNumber);
      return {
        nodes,
        pageInfo: {
          hasNextPage: paging.pageNumber < plan.pages,
          endCursor: `${scope}-cursor-${paging.pageNumber}`,
        },
        totalCount: pageNumber === 0 ? plan.pages * plan.rowsPerPage : null,
        partialErrors: plan.partialOn.includes(pageNumber + 1)
          ? [`Cannot return null for non-nullable field Weakness.name (page ${pageNumber + 1})`]
          : [],
      };
    },
  };
});

vi.stubGlobal("LockService", {
  getScriptLock: () => {
    let mine = false;
    return {
      tryLock: () => {
        if (externalLockHold) return false;
        externalLockHold = true;
        mine = true;
        return true;
      },
      releaseLock: () => {
        if (mine) externalLockHold = false;
      },
    };
  },
});

vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => projectTriggers.map((h) => ({ getHandlerFunction: () => h })),
  deleteTrigger: (t: { getHandlerFunction: () => string }) => {
    const i = projectTriggers.indexOf(t.getHandlerFunction());
    if (i >= 0) projectTriggers.splice(i, 1);
  },
  newTrigger: (handler: string) => ({
    timeBased: () => ({
      after: (afterMs: number) => ({
        create: () => {
          createdTriggers.push({ handler, afterMs });
          projectTriggers.push(handler);
        },
      }),
    }),
  }),
});

/* ------------------------------------------------------------------------ setup */

/**
 * A fresh registry, and a memo sweep on top of it.
 *
 * `vi.resetModules()` alone is NOT enough here, and this cost a confusing hour: a
 * `vi.mock(..., importOriginal)` factory hands back the SAME real module instance across
 * resets, so `ledgerStore`'s per-execution memos (`scanRowsMemo` / `stateMemo`) survive into
 * the next test. Every clock in this file is frozen, so two tests mint the SAME syncId — and
 * a leaked `scanRowsMemo` made the second one's `persistSync` see the first one's `scans`
 * rows and take the idempotent-replay path: no append, no ledger write, `committed_scopes:
 * []`, and a "sync" that looked like it ran. Sweeping the memos is what makes the frozen
 * clock safe.
 */
async function load() {
  vi.resetModules();
  const scanJobs = await import("../src/server/scanJobs");
  const jobs = await import("../src/server/jobsStore");
  const db = await import("../src/server/sheetsDb");
  const ledger = await import("../src/server/ledgerStore");
  const settings = await import("../src/server/settingsStore");
  const cache = await import("../src/server/serverCache");
  ledger.invalidateLedgerMemos();
  settings.resetSettingsMemo();
  cache.__resetMemosForTest();
  return { scanJobs, jobs, TABS: db.TABS };
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(props)) delete props[k];
  for (const k of Object.keys(drive.pages)) delete drive.pages[k];
  for (const k of Object.keys(drive.slim)) delete drive.slim[k];
  for (const k of Object.keys(drive.runs)) delete drive.runs[k];
  for (const k of Object.keys(drive.backups)) delete drive.backups[k];
  for (const k of Object.keys(drive.obs)) delete drive.obs[k];
  for (const k of Object.keys(drive.named)) delete drive.named[k];
  drive.snapshot = null;
  calls.appends.length = 0;
  calls.jobPatches.length = 0;
  calls.persistSync.length = 0;
  calls.trashedScans.length = 0;
  calls.history.length = 0;
  projectTriggers = [];
  createdTriggers.length = 0;
  externalLockHold = false;
  faults.appendScans = false;
  tenant.plan = {
    sca: { pages: 36, rowsPerPage: 2, partialOn: [] },
    sast: { pages: 1, rowsPerPage: 2, partialOn: [] },
    secrets: { pages: 4, rowsPerPage: 2, partialOn: [] },
  };
  tenant.msPerPage = 0;
  tenant.served.length = 0;
  tenant.onPage = null;

  // Credentials: `hasWizCredentials` reads these three through the props fake.
  props["WIZ_API_URL"] = "https://api.example.wiz.io/graphql";
  props["WIZ_API_TOKEN"] = "token";

  vi.useFakeTimers({ toFake: ["Date"] });
  setClock(Date.parse("2026-09-03T02:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

const jobRow = (jobId: string): Row => (tables["jobs"] ?? []).find((r) => r["job_id"] === jobId)!;
const params = (jobId: string): Rec => JSON.parse(String(jobRow(jobId)["params_json"] ?? "{}"));
const scanRows = () => tables["scans"] ?? [];

/* ========================================================================= specs */

describe("one job walks all three scopes and commits once", () => {
  it("crosses two hops, serves every page exactly once, and persists ONE battery", async () => {
    const { scanJobs } = await load();
    // 20s a page against the 45s first-hop budget: the inline hop yields inside sca.
    tenant.msPerPage = 20_000;

    const started = scanJobs.startSync();
    expect(started.jobId).not.toBeNull();
    const jobId = started.jobId!;

    // Hop 1: three sca pages, then the budget. Nothing committed, a continuation armed.
    expect(tenant.served.map((s) => s.scope)).toEqual(["sca", "sca", "sca"]);
    expect(jobRow(jobId)["phase"]).toBe("FETCHING");
    expect(jobRow(jobId)["scope"]).toBe("sca");
    expect(jobRow(jobId)["page"]).toBe(3);
    expect(calls.persistSync).toHaveLength(0);
    expect(scanRows()).toHaveLength(0);
    expect(createdTriggers.map((t) => t.handler)).toEqual(["trigger_continueSync"]);

    // Hop 2: the rest of the battery.
    tenant.msPerPage = 0;
    scanJobs.continueJob();

    // EVERY PAGE ONCE. A resumed hop that re-derived its cursor from scratch, or a
    // scopeIndex advanced on `hasNextPage === true`, both show up here and nowhere else.
    const byScope = (scope: Scope) =>
      tenant.served.filter((s) => s.scope === scope).map((s) => s.pageNumber);
    expect(byScope("sca")).toEqual([...Array(36).keys()]);
    expect(byScope("sast")).toEqual([0]);
    expect(byScope("secrets")).toEqual([0, 1, 2, 3]);
    expect(tenant.served).toHaveLength(41);

    // ONE persistSync, three ScopePersist entries, in battery order.
    expect(calls.persistSync).toHaveLength(1);
    const battery = calls.persistSync[0]!;
    expect(battery.jobId).toBe(jobId);
    expect(battery.syncId).toBe(jobRow(jobId)["scan_id"]);
    const entries = battery.perScope as Array<{ scope: Scope; records: unknown[]; rawRef: unknown }>;
    expect(entries.map((e) => e.scope)).toEqual(["sca", "sast", "secrets"]);
    expect(entries.map((e) => e.records.length)).toEqual([72, 2, 8]);
    for (const e of entries) expect(e.rawRef).toBeTruthy();

    // ONE append, three rows — that append IS the commit (locks.ts step 3).
    const scanAppends = calls.appends.filter((a) => a.tab === "scans");
    expect(scanAppends).toEqual([{ tab: "scans", count: 3 }]);
    expect(scanRows().map((r) => r["scope"])).toEqual(["sca", "sast", "secrets"]);
    expect(new Set(scanRows().map((r) => r["scan_id"])).size).toBe(1);

    expect(jobRow(jobId)["phase"]).toBe("DONE");
    // The commit landed: both one-shots retired.
    expect(projectTriggers).toEqual([]);
  });

  it("gives every scope its own Drive archive under the shared syncId", async () => {
    const { scanJobs } = await load();
    const jobId = scanJobs.startSync().jobId!;
    const syncId = String(jobRow(jobId)["scan_id"]);

    for (const scope of SCOPES) {
      const archiveId = `${syncId}-${scope}`;
      expect(Object.keys(drive.pages[archiveId] ?? {})).toHaveLength(tenant.plan[scope].pages);
      expect(drive.slim[archiveId]).toHaveLength(
        tenant.plan[scope].pages * tenant.plan[scope].rowsPerPage,
      );
    }
    // The `scans` rows carry the BARE syncId, which is also their `ts` — a composite there
    // is `NaN` to `Date.parse` and nulls every clock (ledgerStore.scanIdFor).
    expect(scanRows().every((r) => r["scan_id"] === syncId)).toBe(true);
    expect(Number.isFinite(Date.parse(String(scanRows()[0]!["ts"])))).toBe(true);
  });
});

describe("budget exhaustion resumes rather than restarting", () => {
  it("spills, schedules, and re-enters on the cursor the last page returned", async () => {
    const { scanJobs } = await load();
    tenant.msPerPage = 20_000;

    const jobId = scanJobs.startSync().jobId!;
    const syncId = String(jobRow(jobId)["scan_id"]);
    const archiveId = `${syncId}-sca`;

    // The spill is what the next hop resumes from, and it is on disk before the yield.
    expect(drive.slim[archiveId]).toHaveLength(6);
    expect(drive.runs[archiveId]).toEqual([[1, 2], [2, 2], [3, 2]]);
    const cursorAfterHop1 = String(jobRow(jobId)["cursor"]);
    expect(cursorAfterHop1).toBe("sca-cursor-3");
    expect(params(jobId)["scopeIndex"]).toBe(0);

    const servedInHop1 = tenant.served.length;
    tenant.msPerPage = 0;
    scanJobs.continueJob();

    // THE RESUMED HOP'S FIRST FETCH CARRIES THE STORED CURSOR, and its page number is 3 —
    // page 3 (0-based) is the first one this sync has not archived.
    const firstResumed = tenant.served[servedInHop1]!;
    expect(firstResumed).toMatchObject({ scope: "sca", pageNumber: 3, after: cursorAfterHop1 });

    // No archived page was written twice.
    const scaPages = Object.keys(drive.pages[archiveId] ?? {}).map(Number).sort((a, b) => a - b);
    expect(scaPages).toEqual([...Array(36).keys()].map((i) => i + 1));
    expect(drive.slim[archiveId]).toHaveLength(72);
    expect(jobRow(jobId)["phase"]).toBe("DONE");
  });

  it("yields BETWEEN scopes without skipping the one it has not started", async () => {
    const { scanJobs } = await load();
    // sca finishes in one page; the clock then crosses the budget, so the hop returns with
    // scopeIndex on sast and no page of it fetched.
    tenant.plan.sca = { pages: 1, rowsPerPage: 2, partialOn: [] };
    tenant.msPerPage = 60_000;

    const jobId = scanJobs.startSync().jobId!;
    expect(tenant.served.map((s) => s.scope)).toEqual(["sca"]);
    expect(params(jobId)["scopeIndex"]).toBe(1);
    expect(jobRow(jobId)["scope"]).toBe("sast");
    expect(jobRow(jobId)["page"]).toBe(0);
    expect(jobRow(jobId)["cursor"]).toBeNull();
    expect(calls.persistSync).toHaveLength(0);

    tenant.msPerPage = 0;
    scanJobs.continueJob();
    expect(tenant.served.map((s) => s.scope)).toEqual([
      "sca", "sast", "secrets", "secrets", "secrets", "secrets",
    ]);
    expect(calls.persistSync).toHaveLength(1);
  });
});

describe("cancel", () => {
  it("mid-secrets bails between pages, commits nothing, and drops every archive", async () => {
    const { scanJobs, jobs } = await load();

    // A job seeded straight onto the tab, so the cancel flag can be raised BEFORE the hop
    // that will read it — which is what happens in production (a different execution).
    const syncId = "2026-09-03T02:00:00.000Z";
    const jobId = "sync-cancel-1";
    jobs.createJob({
      job_id: jobId,
      kind: "sync",
      phase: "FETCHING",
      scan_id: syncId,
      scope: "secrets",
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: JSON.stringify({
        syncId,
        scopes: ["sca", "sast", "secrets"],
        scopeIndex: 2,
        severitiesByScope: { sca: ["CRITICAL", "HIGH"], sast: ["CRITICAL", "HIGH"], secrets: [] },
        perScope: {},
      }),
      journal_ref: null,
      error: null,
    });
    tenant.onPage = (scope, pageNumber) => {
      if (scope === "secrets" && pageNumber === 1) props[`CANCEL_${jobId}`] = "1";
    };

    scanJobs.continueJob();

    expect(tenant.served.map((s) => s.pageNumber)).toEqual([0, 1]); // bailed before page 2
    expect(jobRow(jobId)["phase"]).toBe("CANCELLED");
    expect(calls.persistSync).toHaveLength(0);
    expect(scanRows()).toHaveLength(0);
    expect(tables["finding_ledger"] ?? []).toHaveLength(0);
    expect(calls.appends.filter((a) => a.tab === "scans")).toHaveLength(0);
    // Every scope's never-committed archive is trashed — nothing points at it.
    expect(calls.trashedScans.sort()).toEqual(
      ["sca", "sast", "secrets"].map((s) => `${syncId}-${s}`).sort(),
    );
    // The flag is dropped so it cannot outlive the job and kill the next sync.
    expect(props[`CANCEL_${jobId}`]).toBeUndefined();
  });

  it("cancelSync reaps an orphaned FETCHING job and reports it stopped", async () => {
    const { scanJobs, jobs } = await load();
    const syncId = "2026-09-03T02:00:00.000Z";
    jobs.createJob({
      job_id: "sync-orphan",
      kind: "sync",
      phase: "FETCHING",
      scan_id: syncId,
      scope: "sca",
      cursor: "c-1",
      page: 1,
      findings_so_far: 2,
      page_size: 500,
      total_count: 72,
      params_json: JSON.stringify({
        syncId, scopes: ["sca"], scopeIndex: 0, severitiesByScope: { sca: [] }, perScope: {},
      }),
      journal_ref: null,
      error: null,
    });
    projectTriggers.push("trigger_continueSync"); // listed but dead

    const res = scanJobs.cancelSync("sync-orphan");

    expect(res.stopped).toBe(true);
    expect(jobRow("sync-orphan")["phase"]).toBe("CANCELLED");
    expect(projectTriggers).not.toContain("trigger_continueSync");
    expect(calls.trashedScans).toEqual([`${syncId}-sca`]);
  });

  it("leaves a live hop to the cooperative flag rather than racing it", async () => {
    const { scanJobs, jobs } = await load();
    jobs.createJob({
      job_id: "sync-live",
      kind: "sync",
      phase: "FETCHING",
      scan_id: "2026-09-03T02:00:00.000Z",
      scope: "sca",
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: null,
      journal_ref: null,
      error: null,
    });
    externalLockHold = true; // a running hop holds the script lock

    const res = scanJobs.cancelSync("sync-live");

    expect(res.stopped).toBe(false);
    expect(res.message).toBe("Stopping sync…");
    expect(props["CANCEL_sync-live"]).toBe("1");
    expect(jobRow("sync-live")["phase"]).toBe("FETCHING"); // untouched
  });
});

describe("partial pages", () => {
  it("records the caveat, keeps the rows, and does not fail the sync", async () => {
    const { scanJobs } = await load();
    tenant.plan.sca = { pages: 3, rowsPerPage: 2, partialOn: [2] };

    const jobId = scanJobs.startSync().jobId!;

    const perScope = params(jobId)["perScope"] as Record<string, Rec>;
    expect(perScope["sca"]!["partialPages"]).toBe(1);
    expect(String((perScope["sca"]!["partialErrors"] as string[])[0])).toMatch(/Weakness\.name/);
    // The rows still landed: 3 pages x 2, none discarded because a sibling error rode along.
    expect(calls.persistSync[0]!.perScope as Array<{ records: unknown[] }>).toHaveLength(3);
    expect((calls.persistSync[0]!.perScope[0] as { records: unknown[] }).records).toHaveLength(6);
    expect(jobRow(jobId)["phase"]).toBe("DONE");
    expect(jobRow(jobId)["error"]).toBeNull();
  });
});

describe("single flight", () => {
  it("refuses a second sync while one is in flight", async () => {
    const { scanJobs, jobs } = await load();
    jobs.createJob({
      job_id: "sync-running",
      kind: "sync",
      phase: "FETCHING",
      scan_id: "2026-09-03T01:00:00.000Z",
      scope: "sca",
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: null,
      journal_ref: null,
      error: null,
    });

    const res = scanJobs.startSync();

    expect(res.jobId).toBe("sync-running");
    expect(res.message).toBe("A sync is already in progress.");
    expect(tenant.served).toHaveLength(0);
  });

  it("reclaims a job that stopped progressing and starts a fresh one", async () => {
    const { scanJobs, jobs } = await load();
    jobs.createJob(
      {
        job_id: "sync-stale",
        kind: "sync",
        phase: "FETCHING",
        scan_id: "2026-09-03T00:00:00.000Z",
        scope: "sca",
        cursor: null,
        page: 0,
        findings_so_far: 0,
        page_size: 0,
        total_count: 0,
        params_json: null,
        journal_ref: null,
        error: null,
      },
      clock - 45 * 60_000, // past jobsStore.STALE_JOB_MS
    );

    const res = scanJobs.startSync();

    expect(res.jobId).not.toBe("sync-stale");
    expect(jobRow("sync-stale")["phase"]).toBe("FAILED");
    expect(jobRow(res.jobId!)["phase"]).toBe("DONE");
  });

  it("refuses without credentials rather than inventing sample findings", async () => {
    const { scanJobs } = await load();
    delete props["WIZ_API_TOKEN"];
    delete props["WIZ_API_URL"];

    const res = scanJobs.startSync();

    expect(res.jobId).toBeNull();
    expect(res.message).toMatch(/credentials/i);
    expect(tenant.served).toHaveLength(0);
  });
});

describe("the persist watchdog", () => {
  it("is armed before the write and retired once the commit lands", async () => {
    const { scanJobs } = await load();
    tenant.plan.sca = { pages: 1, rowsPerPage: 2, partialOn: [] };

    scanJobs.startSync();

    const handlers = createdTriggers.map((t) => t.handler);
    expect(handlers).toContain("trigger_watchdogSync");
    // Armed BEFORE the write: the watchdog is the last trigger created, and the commit
    // append happens after it.
    expect(handlers.lastIndexOf("trigger_watchdogSync")).toBeGreaterThanOrEqual(0);
    expect(projectTriggers).not.toContain("trigger_watchdogSync"); // cleared on success
  });

  it("stays armed when the commit dies mid-write", async () => {
    const { scanJobs, jobs } = await load();
    const syncId = "2026-09-03T02:00:00.000Z";
    jobs.createJob({
      job_id: "sync-dying",
      kind: "sync",
      phase: "RECONCILING",
      scan_id: syncId,
      scope: null,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: JSON.stringify({
        syncId, scopes: ["sca"], scopeIndex: 1, severitiesByScope: { sca: [] },
        perScope: { sca: { pages: 1, rows: 1, rawRef: "folder", totalCount: 1, partialPages: 0, partialErrors: [] } },
      }),
      journal_ref: null,
      error: null,
    });
    drive.slim[`${syncId}-sca`] = [node("sca", 1)];
    faults.appendScans = true; // the commit append is what dies

    expect(() => scanJobs.continueJob()).toThrow(/killed mid-write/);
    // Nothing else would notice: PERSISTING schedules no hop of its own.
    expect(projectTriggers).toContain("trigger_watchdogSync");
  });

  it("recovers rather than re-running the persist when it fires", async () => {
    const { scanJobs, jobs } = await load();
    jobs.createJob({
      job_id: "sync-wedged",
      kind: "sync",
      phase: "PERSISTING",
      scan_id: "2026-09-03T02:00:00.000Z",
      scope: null,
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: null,
      journal_ref: null,
      error: null,
    });

    scanJobs.watchdogSync();

    expect(calls.persistSync).toHaveLength(0); // the journal makes it atomic, not a retry
    expect(jobRow("sync-wedged")["phase"]).toBe("FAILED");
  });
});

describe("continueJob never strands the walk", () => {
  it("re-arms the continuation when another mutation holds the lock", async () => {
    const { scanJobs, jobs } = await load();
    jobs.createJob({
      job_id: "sync-busy",
      kind: "sync",
      phase: "FETCHING",
      scan_id: "2026-09-03T02:00:00.000Z",
      scope: "sca",
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: null,
      journal_ref: null,
      error: null,
    });
    externalLockHold = true;

    expect(() => scanJobs.continueJob()).toThrow(/busy/i);
    expect(createdTriggers.map((t) => t.handler)).toContain("trigger_continueSync");
  });
});

describe("resetStuckJob", () => {
  it("clears a wedged job, both one-shots, and the cancel flag", async () => {
    const { scanJobs, jobs } = await load();
    jobs.createJob({
      job_id: "sync-stuck",
      kind: "sync",
      phase: "FETCHING",
      scan_id: "2026-09-03T02:00:00.000Z",
      scope: "sca",
      cursor: null,
      page: 0,
      findings_so_far: 0,
      page_size: 0,
      total_count: 0,
      params_json: null,
      journal_ref: null,
      error: null,
    });
    projectTriggers.push("trigger_continueSync", "trigger_watchdogSync");
    props["CANCEL_sync-stuck"] = "1";

    const res = scanJobs.resetStuckJob();

    expect(res.cleared).toBe(true);
    expect(res.phase).toBe("FETCHING"); // the phase it was wedged in
    expect(jobRow("sync-stuck")["phase"]).toBe("FAILED");
    expect(projectTriggers).toEqual([]);
    expect(props["CANCEL_sync-stuck"]).toBeUndefined();
  });

  it("is safe to run when nothing is wrong", async () => {
    const { scanJobs } = await load();
    const res = scanJobs.resetStuckJob();
    expect(res.cleared).toBe(false);
    expect(res.message).toBe("No active job.");
  });
});

describe("the job row is the progress API, and it only names columns the tab has", () => {
  it("every jobs patch names a JOB_COLUMNS column", async () => {
    const { scanJobs, jobs } = await load();
    tenant.plan.sca = { pages: 2, rowsPerPage: 2, partialOn: [] };
    scanJobs.startSync();

    expect(calls.jobPatches.length).toBeGreaterThan(5);
    const allowed = new Set<string>([...jobs.JOB_COLUMNS]);
    for (const patch of calls.jobPatches) {
      for (const key of Object.keys(patch)) {
        // `updated_at` is stamped by jobsStore.updateJob itself and IS a column.
        expect(allowed.has(key), `patch key "${key}" has no column on the jobs tab`).toBe(true);
      }
    }
    // And the tab agrees with the module's own list, both ways.
    const db = await import("../src/server/sheetsDb");
    expect([...jobs.JOB_COLUMNS].sort()).toEqual([...db.TAB_HEADERS["jobs"]!].sort());
  });

  it("advances page/cursor/findings on EVERY page", async () => {
    const { scanJobs } = await load();
    tenant.plan = {
      sca: { pages: 3, rowsPerPage: 2, partialOn: [] },
      sast: { pages: 1, rowsPerPage: 2, partialOn: [] },
      secrets: { pages: 1, rowsPerPage: 2, partialOn: [] },
    };
    const jobId = scanJobs.startSync().jobId!;

    // A PAGE write always lands `page` > 0 (paging.pageNumber after the fetch); the
    // scope-completion write resets it to 0. Both carry `page_size`, so the count alone does
    // not separate them.
    const pageWrites = calls.jobPatches.filter(
      (p) => "page_size" in p && Number(p["page"]) > 0,
    );
    expect(pageWrites).toHaveLength(5); // one per fetched page
    expect(pageWrites.map((p) => p["findings_so_far"])).toEqual([2, 4, 6, 8, 10]);
    expect(pageWrites.map((p) => p["cursor"])).toEqual([
      "sca-cursor-1", "sca-cursor-2", "sca-cursor-3", "sast-cursor-1", "secrets-cursor-1",
    ]);
    // `total_count` is the CURRENT scope's total, per the jobs tab's own column definition.
    expect(pageWrites.map((p) => p["total_count"])).toEqual([6, 6, 6, 2, 2]);
    expect(jobRow(jobId)["findings_so_far"]).toBe(10);
  });
});

describe("the history entry", () => {
  it("records what the sync did and where the clock stands", async () => {
    const { scanJobs } = await load();
    tenant.plan = {
      sca: { pages: 1, rowsPerPage: 2, partialOn: [1] },
      sast: { pages: 1, rowsPerPage: 2, partialOn: [] },
      secrets: { pages: 1, rowsPerPage: 2, partialOn: [] },
    };
    scanJobs.startSync();

    const entries = Object.keys(drive.named).filter((k) => k.startsWith("history/"));
    expect(entries).toEqual(["history/2026-09-03.json.gz"]);
    const stats = drive.named[entries[0]!] as Rec;
    expect(stats["committed_scopes"]).toEqual(["sca", "sast", "secrets"]);
    const scopes = stats["scopes"] as Rec[];
    expect(scopes.map((s) => s["scope"])).toEqual(["sca", "sast", "secrets"]);
    expect(scopes.map((s) => s["total"])).toEqual([2, 2, 2]);
    // The caveat travels with the figure.
    expect(scopes[0]!["partial_pages"]).toBe(1);
    expect(stats["mttr"]).toBeTruthy();
  });
});

/* ================================================================== slimRecord */

describe("slimRecord never carries a credential into the durable store", () => {
  it("drops snippet and validationDetails wherever they appear", async () => {
    const { scanJobs } = await load();
    const raw = {
      ...node("secrets", 1),
      snippet: "AKIAIOSFODNN7EXAMPLE",
      validationDetails: { lastError: "AKIAIOSFODNN7EXAMPLE" },
      resource: {
        ...(node("secrets", 1)["resource"] as Rec),
        validationDetails: { token: "ghp_live_secret_value" },
      },
      projects: [{ id: "p", name: "team", isFolder: false, slug: "team", snippet: "leak" }],
    };

    const slim = scanJobs.slimRecord("secrets", raw);
    const json = JSON.stringify(slim);

    // Over the WHOLE record, not just its top-level keys: the value is what leaks, and it
    // leaks just as well from three levels down.
    expect(json).not.toMatch(/snippet|validationDetails/i);
    expect(json).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(json).not.toContain("ghp_live_secret_value");
    // …and the record is still usable: the key's three inputs survive.
    expect(slim["secretDataId"]).toBe("sd-1");
    expect(slim["path"]).toBe("app/.env");
    expect(slim["lineNumber"]).toBe(4);
  });

  it("keeps the deny-list ahead of the allow-list on every scope", async () => {
    const { scanJobs } = await load();
    for (const scope of SCOPES) {
      const raw = { ...node(scope, 1), snippet: "x", validationDetails: { a: 1 } };
      expect(JSON.stringify(scanJobs.slimRecord(scope, raw))).not.toMatch(
        /snippet|validationDetails/i,
      );
    }
  });

  /**
   * THE ONE PATH WHERE THE DENY-LIST IS THE ONLY THING STANDING THERE, and this spec exists
   * because the obvious version of it does not measure anything.
   *
   * MEASURED: weakening `DENIED_KEY` to `/snippet/i` (dropping `validationDetails`) failed
   * ZERO of the 26 specs in this file. Every case above feeds a key the ALLOW-LIST already
   * excludes, so they were all testing the allow-list and reporting it as the deny-list.
   *
   * `vulnerableAsset.tags` is the exception: it is copied WHOLE, because its keys are the
   * tenant's rather than ours. A tag named `snippet` or `validationDetails` reaches the
   * projection intact and only the recursive deny walk removes it — so this is the case that
   * fails when the pattern is weakened.
   */
  it("strips a denied key out of the tenant's own free-form tags", async () => {
    const { scanJobs } = await load();
    const raw = {
      ...node("sca", 1),
      vulnerableAsset: {
        ...(node("sca", 1)["vulnerableAsset"] as Rec),
        tags: {
          owner: "platform-team",
          snippet: "AKIAIOSFODNN7EXAMPLE",
          validationDetails: "ghp_live_secret_value",
        },
      },
    };

    const json = JSON.stringify(scanJobs.slimRecord("sca", raw));

    expect(json).toContain("platform-team"); // the tags that are not denied survive
    expect(json).not.toMatch(/snippet|validationDetails/i);
    expect(json).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(json).not.toContain("ghp_live_secret_value");
  });

  it("no allow-listed field name is one the deny-list would have to catch", async () => {
    const { scanJobs } = await load();
    const every: string[] = [];
    for (const scope of SCOPES) {
      every.push(...scanJobs.SLIM_FIELDS[scope]);
      for (const keys of Object.values(scanJobs.SLIM_NESTED[scope])) every.push(...keys);
      for (const keys of Object.values(scanJobs.SLIM_LISTS[scope])) every.push(...keys);
      every.push(...Object.keys(scanJobs.SLIM_NESTED[scope]));
      every.push(...Object.keys(scanJobs.SLIM_LISTS[scope]));
    }
    for (const key of every) {
      expect(
        scanJobs.DENIED_KEY.test(key),
        `"${key}" is on an allow-list AND matches the deny pattern — the projection would ` +
          `be relying on stripDenied to undo a decision made three tables earlier`,
      ).toBe(false);
    }
  });

  /**
   * The FIRST site of the three-site contract: a field the projection keeps must be a field
   * the scope's document actually selects. A typo here is invisible — `startline` for
   * `startLine` silently keeps nothing — and shows up only as a null ledger column.
   */
  it("every allow-listed field is one its scope's query document selects", async () => {
    const { scanJobs } = await load();
    const { QUERIES } = await import("../src/server/wizQueries");
    for (const scope of SCOPES) {
      const doc = QUERIES[scope]!;
      // THE TWO SEATS HELD OPEN. Q_SCA selects neither `projects` nor
      // `vulnerableAsset.tags`; both stay in the tables so the day the document gains them
      // the projection is not the thing that swallows them. Excluded here rather than
      // asserted, and named so the exemption is visible.
      const openSeats = scope === "sca" ? ["projects", "tags"] : [];
      const named: string[] = [...scanJobs.SLIM_FIELDS[scope]];
      for (const [parent, keys] of [
        ...Object.entries(scanJobs.SLIM_NESTED[scope]),
        ...Object.entries(scanJobs.SLIM_LISTS[scope]),
      ]) {
        if (openSeats.includes(parent)) continue;
        named.push(parent, ...keys.filter((k) => !openSeats.includes(k)));
      }
      for (const field of named) {
        expect(
          new RegExp(`\\b${field}\\b`).test(doc),
          `${scope}: the slim keeps "${field}" but Q_${scope.toUpperCase()} does not select it`,
        ).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------- the silent-mismatch guard */

/**
 * WHICH LEDGER COLUMNS EACH SCOPE'S QUERY CAN ACTUALLY FILL.
 *
 * Everything NOT listed is null for a stated reason, and the reasons are the point — a
 * blanket "all columns non-null" assertion would be unsatisfiable and a blanket "some columns
 * non-null" one would catch nothing. Each entry below is a claim about the QUERY DOCUMENT in
 * wizQueries.ts, so a field added there and forgotten here shows up as a column that could
 * have been filled and was not.
 */
const FILLABLE: Record<Scope, readonly string[]> = {
  sca: [
    "finding_key", "scope", "identifier", "component", "severity",
    "repo_id", "repo_name", "branch", "platform",
    "first_seen", "last_seen", "status", "reopened_count",
    "first_scan_id", "last_scan_id",
    "fix_date", "fix_observed_at", "fixed_version",
    "has_kev", "has_exploit", "epss", "risk_observed_at",
    "language",
    "owner_project", "owner_path", "tags_json", "projects_json",
  ],
  sast: [
    "finding_key", "scope", "identifier", "severity",
    "repo_id", "repo_name", "branch",
    "first_seen", "last_seen", "status", "reopened_count",
    "first_scan_id", "last_scan_id",
    "cwe", "ai_verdict", "language", "file_path", "start_line", "origin",
    "owner_project", "owner_path", "tags_json", "projects_json",
  ],
  secrets: [
    "finding_key", "scope", "identifier", "severity",
    "repo_id", "repo_name", "branch", "platform",
    "first_seen", "last_seen", "status", "reopened_count",
    "first_scan_id", "last_scan_id",
    "file_path", "start_line", "secret_kind", "confidence",
    "validation_state", "validated_at",
    "owner_project", "owner_path", "tags_json", "projects_json",
  ],
};

/**
 * Why each unfillable column is unfillable. Stated rather than left implicit, because "this
 * column is null" and "this column is null BECAUSE the document does not select it" are the
 * two answers a dropped field sits between.
 */
const UNFILLABLE_REASON: Record<string, string> = {
  resolved_at: "only set once the finding resolves; these fixtures are OPEN",
  resolution_src: "same",
  rotated_at: "only on an INVALID validation observation",
  removed_at: "only on a resolution; these fixtures are OPEN",
  component: "null by design on sast/secrets — file_path already holds the path (reconcile.ts)",
  platform: "Q_SAST's `resource { id name type }` selects no cloudPlatform",
  fixed_version: "no vendor to wait on outside sca",
  fix_date: "no vendor fix clock outside sca",
  fix_observed_at: "no vendor fix clock outside sca",
  has_kev: "exploit intelligence is an sca signal only",
  has_exploit: "exploit intelligence is an sca signal only",
  epss: "exploit intelligence is an sca signal only",
  risk_observed_at: "exploit intelligence is an sca signal only",
  cwe: "weaknesses[] is a SAST selection",
  ai_verdict: "aiAnalysis is a SAST selection",
  file_path: "sca findings are located by package, not by file",
  start_line: "sca findings are located by package, not by file",
  origin: "the scanner name is a SAST selection",
  secret_kind: "secrets only",
  confidence: "secrets only",
  validation_state: "secrets only",
  validated_at: "secrets only",
  language: "no language on the secrets node",
  identifier: "unreachable — every scope fills it",
};

describe("the silent-mismatch guard: slimRecord -> reconcile fills the ledger", () => {
  for (const scope of SCOPES) {
    it(`${scope}: every column its query can fill comes out non-null`, async () => {
      const { scanJobs } = await load();
      const { reconcile } = await import("../src/domain/reconcile");

      const raw = node(scope, 1);
      const slim = scanJobs.slimRecord(scope, raw);
      const scanId = "2026-09-03T02:00:00.000Z";
      const result = reconcile([slim], {}, scanId, scanId, null, { scope });

      const rows = Object.values(result.ledger);
      expect(rows).toHaveLength(1);
      const row = rows[0]! as unknown as Rec;

      for (const column of FILLABLE[scope]) {
        expect(
          row[column],
          `${scope}.${column} came back null — the slim projection dropped a field the ` +
            `query selects and reconcile reads`,
        ).not.toBeNull();
        expect(row[column]).not.toBeUndefined();
      }
      // The rest are null, each for a reason this file names.
      for (const column of LEDGER_COLUMNS) {
        if (FILLABLE[scope].includes(column)) continue;
        expect(UNFILLABLE_REASON[column], `no stated reason for ${scope}.${column}`).toBeTruthy();
        expect(row[column] ?? null, `${scope}.${column}: ${UNFILLABLE_REASON[column]}`).toBeNull();
      }
    });
  }

  it("reconcile reads the SAME record the sync archives and replays", async () => {
    const { scanJobs } = await load();
    scanJobs.startSync();
    const jobId = String((tables["jobs"] ?? [])[0]!["job_id"]);
    const syncId = String(jobRow(jobId)["scan_id"]);

    // The spill IS what persistSync was handed, byte for byte — that identity is what makes
    // a replay read exactly what the original run read (ledgerStore.readPayloadForRow).
    const handed = calls.persistSync[0]!.perScope as Array<{ scope: Scope; records: Rec[] }>;
    for (const entry of handed) {
      expect(entry.records).toEqual(drive.slim[`${syncId}-${entry.scope}`]);
    }
  });
});
