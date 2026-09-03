// The RPC surface: the envelope, what each endpoint is allowed to put on the wire, and the
// two ordering facts the post-sync tail rests on.
//
// EVERYTHING BELOW RUNS OVER A LEDGER THIS FILE ACTUALLY SYNCED. `sheetsDb` is an in-memory
// table store projecting onto the REAL `TAB_HEADERS`, `archiveStore` an in-memory Drive, and
// `wizClient` a three-scope tenant of nine rows — so `beforeEach` runs one whole sync battery
// and every read endpoint below answers from a committed ledger with a `scans` row, a `jobs`
// row and a `mttr_history` entry behind it. A hand-stubbed read-model would have proved that
// `run()` wraps a function; it would not have proved that the function it wraps can be reached
// from a real register.
//
// THREE THINGS HERE HAVE NO SYMPTOM WHEN THEY BREAK, and they are why the file is this long:
//
//   1. `getJobStatus` leaking `cursor` / `journal_ref`. The payload still renders; the browser
//      simply also now holds a production tenant's pagination token and a Drive file id. The
//      assertion is over the full `JSON.stringify`, not `Object.keys`, because a raw
//      `params_json` string would pass a key check while carrying the cursor inside its text.
//   2. The post-sync warm's ORDERING. `warmReadModels` refuses while `activeJob()` is
//      non-null, and it works today only because `finishSync` sets `phase: "DONE"` BEFORE
//      calling `afterPersist`. Moving that update after `afterPersist` reads as a tidy-up and
//      silently disables the warm forever — every page correct, every sync successful, and the
//      first load after each sync paying a full recompute with nothing anywhere saying so.
//   3. The auto-compaction DEFAULT. S7 moved that gate from a Script Property (unset = off) to
//      `Settings.autoCompact` (default false). The two agree only if the default did not move,
//      and "the default is false" is a reading of a literal — so this asserts the BEHAVIOUR: a
//      sync over default settings compacts zero times.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCOPES, type Scope } from "../src/domain/config";
import type { Rec } from "../src/domain/util";
import type { WarmReport } from "../src/server/readModels";

interface Row {
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ fake platform */

const tables: Record<string, Row[]> = {};
const props: Record<string, string> = {};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Every warm report `scanJobs.afterPersist` produced, in order. Spec 2 reads this. */
const warmReports: WarmReport[] = [];
/** Every `ledgerStore.compactLedger` call. Spec 3 reads this. */
const compactCalls: Array<{ retentionDays: number | null; dryRun: boolean }> = [];
/** How many times a script lock was actually acquired. The write-RPC spec reads this. */
let lockAcquisitions = 0;
let externalLockHold = false;

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

vi.mock("../src/server/sheetsDb", async (importOriginal) => {
  // TABS and TAB_HEADERS come from the REAL module. A stubbed header list would compare the
  // fake to itself, and `getExportCsv` reads `TAB_HEADERS[TABS.ledger]` for its column list —
  // so the CSV spec below would be asserting against its own fixture rather than the ledger.
  const real = await importOriginal<typeof import("../src/server/sheetsDb")>();
  const project = (tab: string, row: Row): Row => {
    const out: Row = {};
    for (const h of real.TAB_HEADERS[tab] ?? []) out[h] = h in row ? row[h] : null;
    return out;
  };
  return {
    TABS: real.TABS,
    TAB_HEADERS: real.TAB_HEADERS,
    SCHEMA_VERSION: real.SCHEMA_VERSION,
    readAll: (tab: string) => tables[tab] ?? [],
    readTail: (tab: string, n: number) => (tables[tab] ?? []).slice(-n),
    overwrite: (tab: string, rows: Row[]) => {
      tables[tab] = rows.map((r) => project(tab, r));
    },
    appendRows: (tab: string, rows: Row[]) => {
      tables[tab] = [...(tables[tab] ?? []), ...rows.map((r) => project(tab, r))];
    },
    updateWhere: (tab: string, key: string, value: unknown, patch: Row) => {
      const row = (tables[tab] ?? []).find((r) => r[key] === value);
      if (!row) return false;
      for (const [k, v] of Object.entries(patch)) {
        if ((real.TAB_HEADERS[tab] ?? []).includes(k)) row[k] = v;
      }
      return true;
    },
    dataRowCount: (tab: string) => (tables[tab] ?? []).length,
    trimSurplusRows: () => 0,
    gridSize: (tab: string) => ({
      rows: (tables[tab] ?? []).length + 1,
      cols: (real.TAB_HEADERS[tab] ?? []).length,
    }),
    cellCount: () =>
      Object.entries(tables).reduce(
        (n, [tab, rows]) => n + (rows.length + 1) * (real.TAB_HEADERS[tab]?.length ?? 1),
        0,
      ),
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
  scanFolder: (scanId: string) => ({ getId: () => `folder-${scanId}`, getFiles: () => ({ hasNext: () => false }) }),
  trashScan: (scanId: string) => {
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
  subfolder: (name: string) => name,
  writeGzJson: (folder: string, name: string, payload: unknown) => {
    drive.named[`${folder}/${name}`] = clone(payload);
    return {};
  },
  readGzJson: (folder: string, name: string) => drive.named[`${folder}/${name}`] ?? null,
  readGzJsonNamed: (folder: string, name: string) => drive.named[`${folder}/${name}`] ?? null,
  listNames: (folder: string) =>
    Object.keys(drive.named)
      .filter((k) => k.startsWith(`${folder}/`))
      .map((k) => k.slice(folder.length + 1)),
  trashNamed: (folder: string, name: string) => {
    delete drive.named[`${folder}/${name}`];
  },
}));

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
    projectScope: () => null,
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
 * The two cache layers as per-execution memos keyed on the version.
 *
 * `bumpDataVersion` really does move the version, because `ledgerStore` bumps it on commit and
 * a fake that did not would let a read endpoint serve the pre-sync answer for the whole file.
 */
const cacheState = { version: 1, store: new Map<string, unknown>() };
const memo = (name: string, params: unknown, compute: () => unknown): unknown => {
  const k = `${name}|${JSON.stringify(params ?? null)}|${cacheState.version}`;
  if (cacheState.store.has(k)) return cacheState.store.get(k);
  const v = compute();
  cacheState.store.set(k, v);
  return v;
};

vi.mock("../src/server/serverCache", () => ({
  cached: (name: string, params: unknown, compute: () => unknown) => memo(name, params, compute),
  dataVersion: () => String(cacheState.version),
  bumpDataVersion: () => {
    cacheState.version += 1;
  },
  bumpWizDataVersion: () => {},
  wizDataVersion: () => "w1",
  paramsHash: (p: unknown) => JSON.stringify(p ?? null),
  currentStamp: () => "stamp",
}));

vi.mock("../src/server/readModelStore", () => ({
  durablyCached: (name: string, params: unknown, compute: () => unknown) =>
    memo(name, params, compute),
  duringWarm: <T,>(fn: () => T): T => fn(),
  sweepReadModels: () => 0,
  __resetMemosForTest: () => {},
}));

/**
 * The REAL warm, wrapped so the spec can read the report `afterPersist` got.
 *
 * `warmReadModels` returns `{blockedBy}` when `activeJob()` is non-null and `{warmed}` when it
 * ran, so the report IS the observation: `blockedBy === null` is the statement that no job was
 * active at the moment the warm was called, measured by the code that has to be right, not by
 * a second copy of the rule in this file.
 */
vi.mock("../src/server/readModels", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/readModels")>();
  return {
    ...real,
    warmReadModels: (budgetMs?: number) => {
      const report = real.warmReadModels(budgetMs);
      warmReports.push(report);
      return report;
    },
  };
});

/** The real ledgerStore, with `compactLedger` observed. */
vi.mock("../src/server/ledgerStore", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/ledgerStore")>();
  return {
    ...real,
    compactLedger: (retentionDays: number | null, dryRun = false, now?: number) => {
      compactCalls.push({ retentionDays, dryRun });
      return real.compactLedger(retentionDays, dryRun, now);
    },
  };
});

/** Access is decided by `Session` in the real module; the RPC layer only asks one question. */
vi.mock("../src/server/access", () => ({
  canEditUsers: () => true,
}));

/* --------------------------------------------------------------- the fake tenant */

/** One page per scope, three rows each — enough for a whole battery inside one inline hop. */
function node(scope: Scope, seq: number): Rec {
  if (scope === "sca") {
    return {
      id: `sca-${seq}`,
      name: `CVE-2026-${1000 + seq}`,
      detailedName: "braces",
      severity: seq === 0 ? "CRITICAL" : "HIGH",
      status: "OPEN",
      firstDetectedAt: "2026-01-05T00:00:00Z",
      lastDetectedAt: "2026-09-01T00:00:00Z",
      resolvedAt: null,
      // One row with no fix date at all — the only scope that can be awaiting a vendor.
      fixDate: seq === 2 ? null : "2026-02-01T00:00:00Z",
      fixedVersion: seq === 2 ? null : "3.0.3",
      hasExploit: true,
      hasCisaKevExploit: false,
      epssProbability: 0.42,
      vulnerableAsset: {
        id: `repo-${seq % 2}`,
        type: "REPOSITORY_BRANCH",
        name: `dktunited/repo-${seq % 2}/main`,
        cloudPlatform: "GitHub",
        subscriptionName: null,
        subscriptionExternalId: null,
      },
      artifactType: { codeLibraryLanguage: "JAVASCRIPT" },
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
      resource: { id: "repo-1", name: "dktunited/repo-1/main", type: "REPOSITORY_BRANCH" },
      weaknesses: [{ id: "CWE-89", name: "SQL Injection" }],
      projects: [{ id: "p-leaf", name: "product-one", isFolder: false, slug: "product-one" }],
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
    // LOW on purpose: severity grades a DETECTION on this register, and the secrets endpoints
    // must not be filtering by it. A fixture that made every secret CRITICAL would hide that.
    severity: "LOW",
    path: "app/.env",
    lineNumber: 3 + seq,
    status: "OPEN",
    resolvedAt: null,
    validationStatus: seq === 0 ? "VALID" : "UNKNOWN",
    lastValidatedAt: "2026-08-01T00:00:00Z",
    firstSeenAt: "2026-02-10T00:00:00Z",
    lastSeenAt: "2026-09-01T00:00:00Z",
    lastUpdatedAt: "2026-09-01T00:00:00Z",
    codeToCloudPipelineStage: "CODE",
    resource: {
      id: "repo-2",
      name: "dktunited/repo-2/main",
      type: "REPOSITORY_BRANCH",
      externalId: "gh-2",
      nativeType: "Repository",
      cloudPlatform: "GitHub",
    },
    projects: [{ id: "p-leaf", name: "product-one", isFolder: false, slug: "product-one" }],
    vcsDetails: { initialCommitHash: "def456" },
  };
}

vi.mock("../src/server/wizClient", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/wizClient")>();
  return {
    ...real,
    fetchPage: (scope: Scope, _v: Rec, paging: { pageSize: number; pageNumber: number }) => {
      const nodes = [0, 1, 2].map((i) => node(scope, i));
      paging.pageNumber += 1;
      return {
        nodes,
        pageInfo: { hasNextPage: false, endCursor: `${scope}-cursor-secret-token` },
        totalCount: 3,
        partialErrors: [],
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
        lockAcquisitions += 1;
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
      after: () => ({
        create: () => {
          projectTriggers.push(handler);
        },
      }),
    }),
  }),
});

vi.stubGlobal("HtmlService", {
  createHtmlOutputFromFile: () => ({ getContent: () => "<script>/* charts */</script>" }),
});

/* ------------------------------------------------------------------------ setup */

type Api = typeof import("../src/server/api");

/**
 * A fresh module registry, then a memo sweep on top of it.
 *
 * `vi.resetModules()` alone is not enough: a `vi.mock(..., importOriginal)` factory hands back
 * the SAME real module instance across resets, so `ledgerStore`'s per-execution memos and
 * `readModels`'s base-row snapshot survive into the next test — and the clock is frozen here,
 * so two tests would otherwise mint the same syncId and the second commit would take the
 * idempotent-replay path while looking like it ran.
 */
async function load(): Promise<{ api: Api; scanJobs: typeof import("../src/server/scanJobs") }> {
  vi.resetModules();
  const api = await import("../src/server/api");
  const scanJobs = await import("../src/server/scanJobs");
  const ledger = await import("../src/server/ledgerStore");
  const settings = await import("../src/server/settingsStore");
  const models = await import("../src/server/readModels");
  ledger.invalidateLedgerMemos();
  settings.resetSettingsMemo();
  models.__resetModelMemosForTest();
  cacheState.store.clear();
  return { api, scanJobs };
}

describe("bootstrap's freshness caption reports the SYNC, not one of its rows", () => {
  /**
   * THE DEFECT THIS PINS was visible on the rendered page before it was visible in a test.
   * One sync writes one `scans` row per scope, all sharing the bare syncId in `scan_id` and
   * all written with the same timestamp. `bootstrap` picked the newest row under a strict
   * `ts > latest.ts`, so among three equal timestamps it kept whichever it met first — and
   * Executive rendered "Last scan · Dependencies (SCA) · 310 findings" for a sync that had
   * also written 30 SAST and 112 secrets findings.
   *
   * Asserting the SHAPE is not enough here: a payload naming one scope is a perfectly valid
   * shape. What has to be asserted is that the count of registers equals the count of scans
   * rows the sync actually wrote, and that the total is their sum.
   */
  it("names every register the sync wrote a row for, and totals them", async () => {
    const { api } = await syncedRegister();
    const boot = api.bootstrap({});
    expect(boot.ok).toBe(true);
    const sync = boot.data!.latestSync;
    expect(sync, "a committed battery must produce a latestSync").not.toBeNull();

    const { TABS } = await import("../src/server/sheetsDb");
    const rows = (tables[TABS.scans] ?? []) as Rec[];
    const members = rows.filter((r) => String(r["scan_id"]) === sync!.sync_id);
    expect(members.length, "the fixture battery should write one row per scope").toBe(3);

    expect(sync!.scopes).toHaveLength(members.length);
    expect(sync!.scopes.map((s) => s.scope).sort()).toEqual(["sast", "sca", "secrets"]);
    expect(sync!.total).toBe(members.reduce((a, r) => a + Number(r["total"] ?? 0), 0));
  });

  it("carries each register's own coverage, because they differ by design", async () => {
    const { api } = await syncedRegister();
    const sync = api.bootstrap({}).data!.latestSync!;
    const bySc = new Map(sync.scopes.map((s) => [s.scope, s.severities]));
    // secrets runs with the gate OFF — null means ALL, and a single shared coverage field
    // could not have expressed that alongside a narrowed sca/sast in the same sync.
    expect(bySc.get("secrets")).toBeNull();
    expect(bySc.has("sca")).toBe(true);
  });

  it("orders the registers by battery order, so the caption does not reshuffle per load", async () => {
    const { api } = await syncedRegister();
    const sync = api.bootstrap({}).data!.latestSync!;
    expect(sync.scopes.map((s) => s.scope)).toEqual(["sca", "sast", "secrets"]);
  });
});

/** One committed battery over all three scopes, and the api module that can read it. */
async function syncedRegister(): Promise<{ api: Api; jobId: string }> {
  const { api, scanJobs } = await load();
  const started = scanJobs.startSync();
  expect(started.jobId, started.message).not.toBeNull();
  // Every read below is a fresh GAS execution in production; drop the memos so it behaves so.
  const ledger = await import("../src/server/ledgerStore");
  const models = await import("../src/server/readModels");
  ledger.invalidateLedgerMemos();
  models.__resetModelMemosForTest();
  cacheState.store.clear();
  return { api, jobId: started.jobId! };
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
  projectTriggers = [];
  externalLockHold = false;
  lockAcquisitions = 0;
  warmReports.length = 0;
  compactCalls.length = 0;
  cacheState.version = 1;
  cacheState.store.clear();

  props["WIZ_API_URL"] = "https://api.example.wiz.io/graphql";
  props["WIZ_API_TOKEN"] = "token";

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-09-03T02:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/* ========================================================================= specs */

// --------------------------------------------------------------------------------------- //
//  1. The envelope
// --------------------------------------------------------------------------------------- //

/** Name -> the params that endpoint is called with. Every read RPC on the surface. */
const READ_RPCS: Array<[string, unknown]> = [
  ["bootstrap", {}],
  ["getSettings", {}],
  ["getChartsBundle", {}],
  ["getExecutivePage", {}],
  ["getMttrPage", {}],
  ["getProgramPage", {}],
  ["getRegisterPage", { scope: "sca" }],
  ["getRegisterPage", { scope: "sast" }],
  ["getSecretsPage", {}],
  ["getRegisterRows", { scope: "sca" }],
  ["getRegisterRows", { scope: "sast" }],
  ["getRegisterRows", { scope: "secrets" }],
  ["getReposPage", {}],
  ["getScanHistory", {}],
  ["getStorageStats", {}],
  ["getJobStatus", {}],
  ["getExportCsv", {}],
  ["getRecentErrors", {}],
  ["compact", { dryRun: true }],
];

describe("every read RPC answers over a committed ledger", () => {
  it("returns ok:true with data, for each of them", async () => {
    const { api } = await syncedRegister();
    for (const [name, params] of READ_RPCS) {
      const res = (api as unknown as Rec)[name] as (p: unknown) => Rec;
      const out = res(params);
      expect(out["ok"], `${name}(${JSON.stringify(params)}) failed: ${out["error"]}`).toBe(true);
      expect(out, `${name} carries no data key`).toHaveProperty("data");
    }
  });

  it("a thrown error becomes {ok:false} with an errorKind and NO stack", async () => {
    const { api } = await syncedRegister();
    // A scope the surface refuses is the cheapest real throw on the read path.
    const out = api.getRegisterPage({ scope: "nope" }) as unknown as Rec;
    expect(out["ok"]).toBe(false);
    expect(out["errorKind"]).toBe("error");
    expect(typeof out["error"]).toBe("string");
    // The message, not the Error object: a stack names file paths and internals, and
    // google.script.run would carry every line of it to the browser.
    expect(String(out["error"])).not.toContain("at ");
    expect(String(out["error"])).not.toContain(".ts:");
    expect(out).not.toHaveProperty("stack");
  });

  it("distinguishes a busy store from a broken one — errorKind is the client's fork", async () => {
    const { api } = await syncedRegister();
    externalLockHold = true; // somebody else holds the script lock
    try {
      const out = api.deleteScans({ scanIds: ["nope"] }) as unknown as Rec;
      expect(out["ok"]).toBe(false);
      expect(out["errorKind"]).toBe("busy");
    } finally {
      externalLockHold = false;
    }
  });

  /**
   * THE SWEEP, over EVERY read RPC rather than the three caught by hand.
   *
   * FOUND: `getRegisterPage` / `getSecretsPage` shipped `latestScan` as the RAW `ScanRow`
   * `buildRegister` (readModels.ts) attaches for `movement()`'s change badge —
   * `raw_ref`/`obs_ref` included, straight onto the wire, in code already committed before
   * this package started. `getScanHistory` proved the allowlist (`scanRowsSlice`,
   * `pagePayload.ts`) worked for the ARRAY shape; nothing had applied it to this SINGULAR
   * one. `latestScanSlice` is the same allowlist, so there is exactly one column list
   * deciding what a scan may publish, in either shape.
   *
   * Asserted over the FULL `JSON.stringify` of the RPC's `data`, at any depth — a key-only
   * check (`Object.keys` / `toHaveProperty`) would miss a leak nested inside `latestScan` or
   * smuggled inside a stringified sub-field, exactly like `getJobStatus`'s own
   * cursor/journal_ref case above.
   */
  it("no read RPC's payload carries cursor, journal_ref, raw_ref or obs_ref, at any depth", async () => {
    const { api, jobId } = await syncedRegister();
    const rpcs: Array<[string, unknown]> = [...READ_RPCS, ["getJobStatus", { jobId }]];
    for (const [name, params] of rpcs) {
      const res = (api as unknown as Rec)[name] as (p: unknown) => Rec;
      const out = res(params);
      const json = JSON.stringify(out["data"]);
      for (const banned of ["raw_ref", "obs_ref", "journal_ref", "cursor"]) {
        expect(json, `${name}(${JSON.stringify(params)}) leaks "${banned}"`)
          .not.toContain(banned);
      }
      // The VALUE, not only the key — `secret-token` is the fake tenant's cursor text,
      // baked into the fixture specifically so a leak through a differently-named field
      // (e.g. smuggled inside a serialized sub-object) still gets caught.
      expect(json, `${name} leaks the fake tenant's cursor value`).not.toContain("secret-token");
    }
  });
});

// --------------------------------------------------------------------------------------- //
//  2. getJobStatus — the poll that must not carry secrets
// --------------------------------------------------------------------------------------- //

describe("getJobStatus", () => {
  it("goes through jobSummarySlice, not the raw JobRow", async () => {
    const { api, jobId } = await syncedRegister();
    const data = (api.getJobStatus({ jobId }) as unknown as Rec)["data"] as Rec;
    // The slice's own two additions. A raw JobRow has neither, so their presence is the
    // evidence that the row went through it rather than around it.
    expect(data).toHaveProperty("stale");
    expect(data).toHaveProperty("incremental");
    // …and the fields the progress card actually draws survived.
    for (const k of ["job_id", "kind", "phase", "scope", "page", "findings_so_far", "error"]) {
      expect(data, `jobSummarySlice dropped ${k}`).toHaveProperty(k);
    }
    expect(data["job_id"]).toBe(jobId);
  });

  /**
   * ASSERTED OVER THE FULL SERIALIZED TEXT, not over `Object.keys`.
   *
   * `cursor` is the Wiz `endCursor` for a production security tenant and `journal_ref` is a
   * Drive file id. A key check passes while either is smuggled inside `params_json`'s string —
   * which is exactly how a "just spread the row and delete two fields" implementation leaks
   * them. The fake tenant's cursor carries the literal `secret-token` so this can look for the
   * VALUE as well as the column name.
   */
  it("never carries cursor or journal_ref, including inside params_json text", async () => {
    const { api, jobId } = await syncedRegister();
    const text = JSON.stringify((api.getJobStatus({ jobId }) as unknown as Rec)["data"]);
    expect(text).not.toContain("cursor");
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("journal_ref");
    expect(text).not.toContain("params_json");
  });

  it("answers about the active job when given no id, and null when there is none", async () => {
    const { api } = await syncedRegister();
    // The battery committed, so nothing is active.
    expect((api.getJobStatus({}) as unknown as Rec)["data"]).toBeNull();
    expect((api.getJobStatus() as unknown as Rec)["ok"]).toBe(true);
  });
});

// --------------------------------------------------------------------------------------- //
//  3. The secrets asymmetry, in the surface
// --------------------------------------------------------------------------------------- //

describe("the register endpoints", () => {
  it("getRegisterPage REFUSES secrets and names the endpoint that serves it", async () => {
    const { api } = await syncedRegister();
    const out = api.getRegisterPage({ scope: "secrets" }) as unknown as Rec;
    expect(out["ok"]).toBe(false);
    expect(String(out["error"])).toContain("getSecretsPage");
  });

  it("getRegisterPage refuses a missing scope rather than defaulting to one", async () => {
    const { api } = await syncedRegister();
    expect((api.getRegisterPage({}) as unknown as Rec)["ok"]).toBe(false);
  });

  it("getSecretsPage carries the lifecycle and NO severity axis", async () => {
    const { api } = await syncedRegister();
    const data = (api.getSecretsPage({}) as unknown as Rec)["data"] as Rec;
    const secrets = data["secrets"] as Rec;
    const register = data["register"] as Rec;
    expect((secrets["severityAxis"] as Rec)["supported"]).toBe(false);
    expect((register["severityAxis"] as Rec)["supported"]).toBe(false);
    expect(register["counts"]).toBeNull();
    expect(register["sevStats"]).toBeNull();
    // What replaces the severity breakdown.
    for (const k of ["coverage", "validity", "timeToRevoke", "removalVsRotation", "segments"]) {
      expect(secrets, `secretsModel lost ${k}`).toHaveProperty(k);
    }
    // The segments table ships ONCE, from the model that ignores severity.
    expect(register).not.toHaveProperty("segments");
  });

  /**
   * The severity filter must not reach the secrets register. `DEFAULT_FETCH_SEVERITIES.secrets`
   * is empty (= all) precisely because severity there grades a detection, and the fixture's
   * secrets are all LOW — so a filter that leaked through would return an empty register while
   * looking like an empty register.
   */
  it("ignores a severity selection on secrets", async () => {
    const { api } = await syncedRegister();
    const unfiltered = (api.getSecretsPage({}) as unknown as Rec)["data"] as Rec;
    const filtered = (api.getSecretsPage({ severities: ["CRITICAL"] }) as unknown as Rec)["data"] as Rec;
    const rows = (d: Rec) => ((d["secrets"] as Rec)["rowCount"]);
    expect(rows(unfiltered)).toBeGreaterThan(0);
    expect(rows(filtered)).toBe(rows(unfiltered));
  });
});

// --------------------------------------------------------------------------------------- //
//  3b. getRegisterRows — the per-finding row set, over all three scopes
// --------------------------------------------------------------------------------------- //

describe("getRegisterRows", () => {
  it("refuses a missing or unknown scope rather than defaulting to one", async () => {
    const { api } = await syncedRegister();
    expect((api.getRegisterRows({}) as unknown as Rec)["ok"]).toBe(false);
    expect((api.getRegisterRows({ scope: "nope" }) as unknown as Rec)["ok"]).toBe(false);
  });

  it("serves all three scopes, unlike getRegisterPage — secrets is NOT refused here", async () => {
    const { api } = await syncedRegister();
    const out = api.getRegisterRows({ scope: "secrets" }) as unknown as Rec;
    expect(out["ok"]).toBe(true);
  });

  it("each row carries only that scope's REGISTER_ROW_COLUMNS plus finding_key", async () => {
    const { api } = await syncedRegister();
    const { REGISTER_ROW_COLUMNS, REGISTER_ROW_KEY } = await import("../src/domain/pagePayload");
    for (const scope of SCOPES) {
      const data = (api.getRegisterRows({ scope }) as unknown as Rec)["data"] as Rec;
      const rows = data["rows"] as Rec[];
      expect(rows.length).toBeGreaterThan(0);
      const expectedKeys = [REGISTER_ROW_KEY, ...REGISTER_ROW_COLUMNS[scope]!].sort();
      for (const r of rows) expect(Object.keys(r).sort()).toEqual(expectedKeys);
    }
  });

  it("carries no raw_ref/obs_ref on any scope's rows", async () => {
    const { api } = await syncedRegister();
    for (const scope of SCOPES) {
      const data = (api.getRegisterRows({ scope }) as unknown as Rec)["data"] as Rec;
      const json = JSON.stringify(data["rows"]);
      expect(json).not.toContain("raw_ref");
      expect(json).not.toContain("obs_ref");
    }
  });

  /** The non-negotiable, over a REAL synced secrets register rather than a hand-built one. */
  it("secrets rows carry no credential-value-shaped key, full JSON.stringify", async () => {
    const { api } = await syncedRegister();
    const data = (api.getRegisterRows({ scope: "secrets" }) as unknown as Rec)["data"] as Rec;
    const json = JSON.stringify(data["rows"]);
    expect(json).not.toMatch(/snippet|validationDetails|secretValue/i);
  });

  it("secrets carries no severity column and reports severityFilterSupported: false", async () => {
    const { api } = await syncedRegister();
    const data = (api.getRegisterRows({ scope: "secrets" }) as unknown as Rec)["data"] as Rec;
    expect(data["severityFilterSupported"]).toBe(false);
    for (const r of data["rows"] as Rec[]) expect(r).not.toHaveProperty("severity");
  });

  it("returns {ok:true} with the {rows,total,page,pageSize,sort,dir} shape", async () => {
    const { api } = await syncedRegister();
    const out = api.getRegisterRows({ scope: "sca" }) as unknown as Rec;
    expect(out["ok"]).toBe(true);
    const data = out["data"] as Rec;
    for (const k of ["rows", "total", "page", "pageSize", "sort", "dir"]) {
      expect(data, `getRegisterRows dropped ${k}`).toHaveProperty(k);
    }
  });
});

// --------------------------------------------------------------------------------------- //
//  4. The page slices — S5's claim that no new slice was needed
// --------------------------------------------------------------------------------------- //

describe("each read model reaches its slice", () => {
  it("getExecutivePage: mttrModel -> execMttrSlice, byScope -> execGroupSlice", async () => {
    const { api } = await syncedRegister();
    const d = (api.getExecutivePage({}) as unknown as Rec)["data"] as Rec;
    const mttr = d["mttr"] as Rec;
    // execMttrSlice's exact shape: four numbers, and NOT the whole mttr model.
    expect(Object.keys(mttr).sort()).toEqual(["overall", "remediation", "rowCount"]);
    expect(Object.keys(mttr["overall"] as Rec).sort()).toEqual(["open", "resolved"]);
    expect(mttr).not.toHaveProperty("sla");
    const byScope = d["byScope"] as Rec;
    expect(byScope["dimension"]).toBe("scope");
    const row = (byScope["rows"] as Rec[])[0]!;
    // execGroupSlice keeps three keys and drops `total` / `resolved` / `awaiting`.
    expect(Object.keys(row).sort()).toEqual(["group", "kmMedian", "open"]);
  });

  it("getMttrPage: historyModel -> mttrPageTrendSlice, keeping `history`", async () => {
    const { api } = await syncedRegister();
    const d = (api.getMttrPage({}) as unknown as Rec)["data"] as Rec;
    const trends = d["trends"] as Rec;
    expect(trends).toHaveProperty("history"); // the young-ledger fallback lives here
    expect(Array.isArray(trends["trend"])).toBe(true);
    // The summary DOES ship from this endpoint (divergence from gas/, which splits it).
    expect(d["mttr"]).toHaveProperty("remediation");
    expect(d["byScope"]).toHaveProperty("rows");
  });

  it("getScanHistory: scans -> scanRowsSlice, trend -> historyTrendSlice, history DROPPED", async () => {
    const { api } = await syncedRegister();
    const d = (api.getScanHistory({}) as unknown as Rec)["data"] as Rec;
    expect(d).not.toHaveProperty("history");
    expect(d).not.toHaveProperty("trend"); // the fat backbone; `trends` is the projection
    expect(d["trends"]).toHaveProperty("trend");
    const scans = d["scans"] as Rec[];
    expect(scans.length).toBe(SCOPES.length);
    for (const s of scans) {
      // SCAN_ROW_KEYS is an allowlist; the two Drive ids are not in it.
      expect(s).not.toHaveProperty("raw_ref");
      expect(s).not.toHaveProperty("obs_ref");
      expect(s).toHaveProperty("scope");
    }
  });

  it("getProgramPage: trend -> programTrendSlice, and the raw key does not ship twice", async () => {
    const { api } = await syncedRegister();
    const d = (api.getProgramPage({}) as unknown as Rec)["data"] as Rec;
    expect(d["program"]).not.toHaveProperty("trend");
    const points = (d["trends"] as Rec)["trend"] as Rec[];
    for (const p of points) {
      expect(Object.keys(p).sort()).toEqual(["coverage_pct", "date", "efficiency_pct", "reconstructed"]);
    }
  });
});

// --------------------------------------------------------------------------------------- //
//  5. The CSV export
// --------------------------------------------------------------------------------------- //

describe("getExportCsv", () => {
  it("emits exactly the ledger's own columns — no derived field, no invented one", async () => {
    const { api } = await syncedRegister();
    const db = await import("../src/server/sheetsDb");
    const d = (api.getExportCsv({}) as unknown as Rec)["data"] as Rec;
    const header = String(d["content"]).split("\r\n")[0]!.split(",");
    expect(header).toEqual(db.TAB_HEADERS[db.TABS.ledger]);
    // `loadBaseRows` returns LedgerRow + five derived clock fields. None may reach the file.
    for (const derived of [
      "mttr_days", "age_days", "fix_available_at", "actionable_from",
      "mttr_actionable_days", "actionable_age_days", "awaiting_vendor_fix",
    ]) {
      expect(header, `${derived} is not a ledger column`).not.toContain(derived);
    }
    expect(d["columns"]).toBe(db.TAB_HEADERS[db.TABS.ledger]!.length);
  });

  it("exports one line per row and no secret value — there is no column for one", async () => {
    const { api } = await syncedRegister();
    const d = (api.getExportCsv({}) as unknown as Rec)["data"] as Rec;
    const lines = String(d["content"]).split("\r\n");
    expect(lines.length).toBe(Number(d["rowCount"]) + 1);
    expect(Number(d["rowCount"])).toBe(9); // three scopes x three fixture rows
    for (const banned of ["snippet", "validationDetails", "secret_value"]) {
      expect(String(d["content"])).not.toContain(banned);
    }
  });

  it("narrows by scope", async () => {
    const { api } = await syncedRegister();
    const d = (api.getExportCsv({ scope: "sast" }) as unknown as Rec)["data"] as Rec;
    expect(d["rowCount"]).toBe(3);
    expect(d["scope"]).toBe("sast");
  });
});

// --------------------------------------------------------------------------------------- //
//  6. getRecentErrors — the jobs tab, and the honesty about what that omits
// --------------------------------------------------------------------------------------- //

describe("getRecentErrors", () => {
  it("reads the jobs tab's error column and says so", async () => {
    const { api } = await syncedRegister();
    tables["jobs"]!.push({
      job_id: "sync-broken", kind: "sync", phase: "FAILED", scan_id: null, scope: "sca",
      cursor: "sca-cursor-secret-token", page: 4, findings_so_far: 8, page_size: 50,
      total_count: 9, params_json: '{"syncId":"x"}', journal_ref: "drive-file-id",
      error: "Recovered: execution died mid-sync.",
      started_at: "2026-09-02T02:00:00Z", updated_at: "2026-09-02T02:31:00Z",
    });
    const d = (api.getRecentErrors({}) as unknown as Rec)["data"] as Rec;
    const errors = d["errors"] as Rec[];
    expect(errors).toHaveLength(1);
    expect(errors[0]!["job_id"]).toBe("sync-broken");
    expect(errors[0]!["error"]).toContain("died mid-sync");
    // The panel must be able to state its own scope — this is not gas/'s error-log tab.
    expect(d["covers"]).toBe("jobs");
    expect(String(d["note"])).toContain("no error-log tab");
  });

  it("is an allowlist, not a spread — no cursor, no journal_ref", async () => {
    const { api } = await syncedRegister();
    tables["jobs"]!.push({
      job_id: "sync-broken", kind: "sync", phase: "FAILED", scan_id: null, scope: "sca",
      cursor: "sca-cursor-secret-token", page: 4, findings_so_far: 8, page_size: 50,
      total_count: 9, params_json: "{}", journal_ref: "drive-file-id", error: "boom",
      started_at: "2026-09-02T02:00:00Z", updated_at: "2026-09-02T02:31:00Z",
    });
    const text = JSON.stringify((api.getRecentErrors({}) as unknown as Rec)["data"]);
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("drive-file-id");
    expect(text).not.toContain("journal_ref");
  });

  it("reports a clean register as no errors rather than as an empty panel", async () => {
    const { api } = await syncedRegister();
    const d = (api.getRecentErrors({}) as unknown as Rec)["data"] as Rec;
    expect(d["errors"]).toEqual([]);
    expect(d["covers"]).toBe("jobs");
  });
});

// --------------------------------------------------------------------------------------- //
//  7. The lock
// --------------------------------------------------------------------------------------- //

describe("the write path", () => {
  it("every mutating RPC takes the script lock", async () => {
    const { api } = await syncedRegister();
    const writes: Array<[string, () => Rec]> = [
      ["putSettings", () => api.putSettings({ settings: { showExperimental: true } }) as unknown as Rec],
      ["deleteScans", () => api.deleteScans({ scanIds: [] }) as unknown as Rec],
      ["compact", () => api.compact({ retentionDays: 400 }) as unknown as Rec],
      ["resetLedger", () => api.resetLedger() as unknown as Rec],
    ];
    for (const [name, call] of writes) {
      const before = lockAcquisitions;
      const out = call();
      expect(out["ok"], `${name}: ${out["error"]}`).toBe(true);
      expect(lockAcquisitions, `${name} did not take the lock`).toBeGreaterThan(before);
    }
  });

  /**
   * THE DRY RUN IS A READ. Routing it through `mutate` would make opening the Data page
   * contend with a running sync for a plan that writes nothing — measured here by holding the
   * lock and watching the preview answer anyway.
   */
  it("compact({dryRun:true}) answers while somebody else holds the lock", async () => {
    const { api } = await syncedRegister();
    externalLockHold = true;
    try {
      const out = api.compact({ dryRun: true, retentionDays: 400 }) as unknown as Rec;
      expect(out["ok"]).toBe(true);
      expect(compactCalls.some((c) => c.dryRun)).toBe(false); // it previews, never compacts
    } finally {
      externalLockHold = false;
    }
  });

  /**
   * `runSync` and `cancelSync` use `run`, not `mutate`, because `startSync` takes the lock
   * itself and `cancelSync` is lock-free by design. Nesting `withScriptLock` would give the
   * inner frame's `finally` a `releaseLock()` on a lock the outer frame still holds — so the
   * assertion is that ONE acquisition happens, not two.
   */
  it("runSync takes the lock exactly once — the delegate's, not a second one", async () => {
    const { api } = await load();
    lockAcquisitions = 0;
    const out = api.runSync({}) as unknown as Rec;
    expect(out["ok"]).toBe(true);
    expect(lockAcquisitions).toBe(1);
  });

  it("cancelSync takes no lock of its own", async () => {
    const { api } = await syncedRegister();
    lockAcquisitions = 0;
    const out = api.cancelSync({ jobId: "no-such-job" }) as unknown as Rec;
    expect(out["ok"]).toBe(true);
    expect(lockAcquisitions).toBe(0);
  });
});

// --------------------------------------------------------------------------------------- //
//  8. The two inherited-TODO pins
// --------------------------------------------------------------------------------------- //

describe("the post-sync warm, and the ordering nothing else pins", () => {
  /**
   * THE ONE THAT MATTERS.
   *
   * `warmReadModels` no-ops while `jobsStore.activeJob()` is non-null and returns
   * `{blockedBy}` saying which job stopped it. It runs at all only because `finishSync` sets
   * `phase: "DONE"` BEFORE calling `afterPersist`, and `activeJob()` returns null for any
   * terminal phase. Move that update below `afterPersist` — which reads as a tidy-up, since
   * "finish, then do the chores" is the more natural order — and the warm is disabled forever
   * with NO symptom: the sync still commits, every figure is still right, and the only
   * evidence is that the first load after every sync recomputes from cold.
   *
   * So both halves are asserted. `blockedBy === null` is the ordering. A non-zero `warmed` is
   * the proof that the pass did work rather than merely being allowed to.
   */
  it("runs with no active job, and actually warms", async () => {
    await syncedRegister();
    expect(warmReports).toHaveLength(1);
    expect(warmReports[0]!.blockedBy).toBeNull();
    expect(warmReports[0]!.warmed).toBeGreaterThan(0);
    expect(warmReports[0]!.skipped).toBe(0);
  });

  it("warms every target the warm list declares", async () => {
    await syncedRegister();
    // 7 fixed + one per scope. Spelled as the arithmetic rather than as a literal so adding a
    // scope moves it on its own.
    expect(warmReports[0]!.warmed).toBe(7 + SCOPES.length);
  });
});

describe("auto-compaction after a sync", () => {
  /**
   * S7 moved this gate from a raw `AUTO_COMPACT_DAYS` Script Property (unset = off) to
   * `Settings.autoCompact` (default false). Those two agree only if the default did not move,
   * and reading the literal `false` proves nothing about the wiring — so the assertion is the
   * BEHAVIOUR: a sync over untouched settings compacts zero times.
   */
  it("does NOT run under default settings — the rewire did not move the default", async () => {
    await syncedRegister();
    expect(compactCalls).toEqual([]);
  });

  it("runs once an operator turns it on, with the retention window from Settings", async () => {
    const { api, scanJobs } = await load();
    const saved = api.putSettings({
      settings: { autoCompact: true, retentionDays: 45 },
    }) as unknown as Rec;
    expect(saved["ok"], String(saved["error"])).toBe(true);
    compactCalls.length = 0;

    const started = scanJobs.startSync();
    expect(started.jobId).not.toBeNull();
    expect(compactCalls).toHaveLength(1);
    expect(compactCalls[0]!.retentionDays).toBe(45);
    expect(compactCalls[0]!.dryRun).toBe(false);
  });

  /** And the property it replaced is gone — not kept as a silent second home for the value. */
  it("no longer reads the AUTO_COMPACT_DAYS property", async () => {
    props["AUTO_COMPACT_DAYS"] = "7";
    await syncedRegister();
    expect(compactCalls).toEqual([]);
  });
});
