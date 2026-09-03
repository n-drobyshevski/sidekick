// The journaled commit sequence, end to end: three scopes onto one state, ONE append that is
// the commit, and the two crash windows either side of it.
//
// WHAT THIS FILE IS FOR. `ledgerStore.persistSync` is not atomic and cannot be: it rewrites
// `finding_ledger` and `resolved_episodes` wholesale, writes Drive files, and only then
// appends the `scans` rows. Everything that makes that survivable is ORDERING plus a journal,
// and ordering is exactly the kind of property that keeps working by accident until it does
// not. So the cases below assert the ORDER and the CRASH OUTCOMES, not just the final numbers:
//
//   * three scans rows in ONE appendRows call — a second call would be a second commit point;
//   * a crash between the rewrite and the append leaves NO scans row and a live journal, and
//     `locks.recoverIfNeeded` restores the previous ledger BYTE-FOR-BYTE;
//   * a crash AFTER the append does NOT roll back — the rows on disk are the commit;
//   * a re-run of the same syncId writes nothing at all (no append, no overwrite).
//
// sheetsDb is faked with an in-memory table store that PROJECTS ONTO THE REAL TAB_HEADERS,
// the way `writeGrid` does — a fake that kept every key would pass forever while the
// deployment silently dropped a column (the failure jobsStore.test.ts was written for).
// archiveStore is faked with in-memory files that ROUND-TRIP THROUGH JSON, because the
// journal's whole job is to be a snapshot rather than a live reference: a fake that stored the
// state object itself would "restore" the mutations the crash was supposed to undo.
//
// Modules are re-imported per test so `ledgerStore`'s per-execution memos start cold, as in a
// fresh GAS execution. Importing `locks` from the same registry is also the module-graph
// check: locks -> ledgerStore -> jobsStore has to load, and ledgerStore must never close the
// loop by importing locks.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseTs, type Rec } from "../src/domain/util";

interface Row {
  [k: string]: unknown;
}

const tables: Record<string, Row[]> = {};
const props: Record<string, string> = {};

/** Every write the store made, in order — the ordering assertions read this. */
const calls: { appends: Array<{ tab: string; count: number }>; overwrites: string[] } = {
  appends: [],
  overwrites: [],
};

/** Fault injection. Each fires at most once, then disarms. */
const faults = { appendScans: false, clearJournal: false };

const drive = {
  backups: {} as Record<string, unknown>,
  obs: {} as Record<string, string[]>,
  snapshot: null as unknown,
  trashedScans: [] as string[],
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

vi.mock("../src/server/sheetsDb", async (importOriginal) => {
  // TABS and TAB_HEADERS come from the REAL module: a stubbed header list would compare the
  // fake to itself and pass forever.
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
      calls.overwrites.push(tab);
      tables[tab] = rows.map((r) => project(tab, r));
    },
    appendRows: (tab: string, rows: Row[]) => {
      if (tab === real.TABS.scans && faults.appendScans) {
        faults.appendScans = false;
        // The shape of a real failure here: Sheets refused the write and nothing landed.
        throw new Error("injected: the scans append did not land");
      }
      calls.appends.push({ tab, count: rows.length });
      tables[tab] = [...(tables[tab] ?? []), ...rows.map((r) => project(tab, r))];
    },
    updateWhere: (tab: string, key: string, value: unknown, patch: Row) => {
      if (faults.clearJournal && "journal_ref" in patch && patch["journal_ref"] === null) {
        faults.clearJournal = false;
        throw new Error("injected: died after the commit, before the journal was cleared");
      }
      const row = (tables[tab] ?? []).find((r) => r[key] === value);
      if (!row) return false;
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
  writeObservations: (scanId: string, keys: string[]) => {
    drive.obs[scanId] = [...keys];
    return `obs-${scanId}`;
  },
  readObservations: (scanId: string) => drive.obs[scanId] ?? [],
  trashScan: (scanId: string) => {
    drive.trashedScans.push(scanId);
  },
  readSlim: () => null,
  readScanPages: () => [],
  scanFolder: () => {
    throw new Error("no Drive in this suite");
  },
  readGzJson: () => null,
  writeGzJson: () => ({}),
  subfolder: (name: string) => name,
}));

vi.mock("../src/server/props", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/props")>();
  return {
    PROP_KEYS: real.PROP_KEYS,
    getProp: (k: string) => props[k] ?? null,
    setProp: (k: string, v: string) => {
      props[k] = v;
    },
    deleteProp: (k: string) => {
      delete props[k];
    },
    requireProp: (k: string) => props[k] ?? "",
  };
});

async function load() {
  vi.resetModules();
  const ledger = await import("../src/server/ledgerStore");
  const locks = await import("../src/server/locks");
  const jobs = await import("../src/server/jobsStore");
  const db = await import("../src/server/sheetsDb");
  return { ledger, locks, jobs, TABS: db.TABS };
}

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(props)) delete props[k];
  for (const k of Object.keys(drive.backups)) delete drive.backups[k];
  for (const k of Object.keys(drive.obs)) delete drive.obs[k];
  drive.snapshot = null;
  drive.trashedScans.length = 0;
  calls.appends.length = 0;
  calls.overwrites.length = 0;
  faults.appendScans = false;
  faults.clearJournal = false;
});

// --------------------------------------------------------------------------- #
//  records
// --------------------------------------------------------------------------- #

const scaRec = (id: string, born: string, repo = "r1"): Rec => ({
  id,
  name: `CVE-${id}`,
  detailedName: "braces",
  severity: "HIGH",
  status: "OPEN",
  firstDetectedAt: born,
  vulnerableAsset: {
    id: repo,
    name: "org/repo",
    type: "REPOSITORY",
    cloudPlatform: "GitHub",
  },
  projects: [{ name: "platform-team", isFolder: false }],
});

const sastRec = (id: string, born: string): Rec => ({
  id,
  name: "SQL Injection",
  severity: "HIGH",
  status: "OPEN",
  createdAt: born,
  filePath: "app/db.py",
  startLine: 12,
  resource: { id: "r1", name: "org/repo", type: "REPOSITORY" },
});

const secretRec = (line: number, born: string): Rec => ({
  secretDataId: "sd-1",
  path: "app/.env",
  lineNumber: line,
  severity: "LOW",
  status: "OPEN",
  type: "SAAS_API_KEY",
  confidence: "HIGH",
  firstSeenAt: born,
  resource: { id: "r2", name: "org/other", type: "REPOSITORY" },
});

const GATE = ["CRITICAL", "HIGH"];

function battery(overrides: Partial<Record<"sca" | "sast" | "secrets", Rec[]>> = {}) {
  return [
    {
      scope: "sca" as const,
      records: overrides.sca ?? [scaRec("A", "2026-01-05T00:00:00Z")],
      mode: "live",
      scannedSeverities: GATE,
    },
    {
      scope: "sast" as const,
      records: overrides.sast ?? [sastRec("S1", "2026-02-01T00:00:00Z")],
      mode: "live",
      scannedSeverities: GATE,
    },
    {
      scope: "secrets" as const,
      records: overrides.secrets ?? [secretRec(3, "2026-02-10T00:00:00Z")],
      mode: "live",
      // The gate is OFF on secrets (CLAUDE.md / config.DEFAULT_FETCH_SEVERITIES.secrets).
      scannedSeverities: [],
    },
  ];
}

type Jobs = Awaited<ReturnType<typeof load>>["jobs"];

/**
 * Open a job row the way a sync does. Any predecessor is marked DONE first: jobs are
 * single-flight and `activeJob()` returns the FIRST non-terminal row, so a test that leaves
 * a finished sync's row in FETCHING would hand `recoverIfNeeded` the wrong job and every
 * recovery assertion below would pass or fail for the wrong reason.
 */
function seedJob(jobs: Jobs, jobId: string) {
  const prior = jobs.activeJob();
  if (prior) jobs.updateJob(prior.job_id, { phase: "DONE" });
  jobs.createJob({
    job_id: jobId,
    kind: "sync",
    phase: "FETCHING",
    scan_id: null,
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
}

// --------------------------------------------------------------------------- #

describe("scan ids", () => {
  it("gives one sync three distinct ARCHIVE ids sharing the syncId prefix", async () => {
    const { ledger } = await load();
    const syncId = "2026-06-01T00:00:00Z";
    const ids = (["sca", "sast", "secrets"] as const).map((s) => ledger.scanIdFor(syncId, s));
    expect(ids).toEqual([`${syncId}-sca`, `${syncId}-sast`, `${syncId}-secrets`]);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id.startsWith(`${syncId}-`)).toBe(true);
    expect(ids).not.toContain(syncId);
  });

  /**
   * THE MEASUREMENT THAT KEPT THE COMPOSITE ID OUT OF THE `scans` TAB, and the reason
   * `scanIdFor` is documented as a Drive address rather than a row id.
   *
   * `ledgerCore.persistFlatScan` sets `const scanTs = scanId`, so the scan row's `ts` and
   * every ledger timestamp reconcile derives from it ARE the scan id. A composite id does not
   * parse as a date, and everything downstream reads the clock through `parseTs`.
   */
  it("a composite id is not a timestamp, which is why the scans tab does not use one", () => {
    expect(parseTs("2026-06-01T00:00:00Z-sca")).toBeNull();
    expect(parseTs("2026-06-01T00:00:00Z")).toBe(Date.UTC(2026, 5, 1));
  });
});

describe("persistSync — the commit", () => {
  it("writes three scans rows in ONE append, scoped ledger rows, and a repos row per repo", async () => {
    const { ledger, jobs, TABS } = await load();
    seedJob(jobs, "job-1");
    const syncId = "2026-06-01T00:00:00Z";

    const outcome = ledger.persistSync("job-1", syncId, battery());

    // ONE append, three rows. Two appends would be two commit points.
    const scanAppends = calls.appends.filter((c) => c.tab === TABS.scans);
    expect(scanAppends).toEqual([{ tab: TABS.scans, count: 3 }]);

    const rows = tables[TABS.scans]!;
    // ONE id, three scopes — the pair is the key (ledgerCore.existingScanDeltas).
    expect(rows.map((r) => r["scan_id"])).toEqual([syncId, syncId, syncId]);
    expect(rows.map((r) => r["scope"])).toEqual(["sca", "sast", "secrets"]);
    // And `ts` is a real instant, which is what the whole clock reads through.
    expect(rows.map((r) => r["ts"])).toEqual([syncId, syncId, syncId]);
    expect(parseTs(rows[0]!["ts"])).toBe(Date.UTC(2026, 5, 1));
    // The gate is a volume control on sca/sast and OFF on secrets, and the scan row is where
    // that difference has to survive: a stored scope makes reconcile refuse to resolve
    // anything outside it, so a wrong value here mass-resolves or under-resolves.
    expect(rows.map((r) => r["severities"])).toEqual([
      '["CRITICAL", "HIGH"]',
      '["CRITICAL", "HIGH"]',
      null,
    ]);
    // The obs FILE is per scope, named by the archive id — that is where the composite lives.
    expect(rows.map((r) => r["obs_ref"])).toEqual([
      `obs-${syncId}-sca`,
      `obs-${syncId}-sast`,
      `obs-${syncId}-secrets`,
    ]);
    expect(Object.keys(drive.obs).sort()).toEqual(
      [`${syncId}-sast`, `${syncId}-sca`, `${syncId}-secrets`],
    );
    // The clock landed on the ledger rows as a date rather than as an id.
    for (const row of tables[TABS.ledger]!) {
      expect(parseTs(row["last_seen"])).toBe(Date.UTC(2026, 5, 1));
    }

    // Ledger rows carry their scope, and the keys are scope-prefixed.
    const ledgerRows = tables[TABS.ledger]!;
    expect(ledgerRows.length).toBe(3);
    expect(ledgerRows.map((r) => r["scope"]).sort()).toEqual(["sast", "sca", "secrets"]);
    for (const r of ledgerRows) {
      expect(String(r["finding_key"]).startsWith(`${String(r["scope"])}:`)).toBe(true);
    }

    // One repos row per repo_id — r1 (sca + sast) and r2 (secrets).
    const repos = tables[TABS.repos]!;
    expect(repos.map((r) => r["repo_id"])).toEqual(["r1", "r2"]);
    expect(repos[0]!["repo_name"]).toBe("org/repo");
    // The sca record carries cloudPlatform; the sast one cannot (Q_SAST selects no such
    // field), and a null must not blank what another scope recorded.
    expect(repos[0]!["platform"]).toBe("GitHub");
    // Nothing on a ledger row can fill these two — see repoRows' comment.
    expect(repos[0]!["default_branch"]).toBeNull();
    expect(repos[0]!["projects_json"]).toBeNull();

    // The outcome is client-safe: counts and ids, and no storage address anywhere in it.
    expect(outcome.committed_scopes).toEqual(["sca", "sast", "secrets"]);
    expect(outcome.scopes.map((s) => s.scope)).toEqual(["sca", "sast", "secrets"]);
    expect(outcome.scopes.every((s) => s.written)).toBe(true);
    expect(outcome.scopes.map((s) => s.deltas.new_count)).toEqual([1, 1, 1]);
    const serialized = JSON.stringify(outcome);
    for (const secret of ["obs_ref", "raw_ref", "journal_ref", "cursor", "backup-"]) {
      expect(serialized).not.toContain(secret);
    }

    // Step 7 ran: journal cleared and trashed.
    expect(drive.backups).toEqual({});
    expect(jobs.getJob("job-1")!.journal_ref).toBeNull();
  });

  it("takes the MIN first_seen and the MAX last_seen across a repository's findings", async () => {
    const { ledger, jobs, TABS } = await load();
    seedJob(jobs, "job-1");
    // Two sca findings on r1 with different API birth dates; first_seen = min(birth, scan ts).
    ledger.persistSync("job-1", "2026-06-01T00:00:00Z", battery({
      sca: [scaRec("A", "2026-01-05T00:00:00Z"), scaRec("B", "2026-03-10T00:00:00Z")],
    }));

    seedJob(jobs, "job-2");
    // Second sync: A is gone (resolves, last_seen frozen at sync 1), B persists to sync 2.
    ledger.persistSync("job-2", "2026-07-01T00:00:00Z", battery({
      sca: [scaRec("B", "2026-03-10T00:00:00Z")],
    }));

    const r1 = tables[TABS.repos]!.find((r) => r["repo_id"] === "r1")!;
    // MIN over {2026-01-05 (A), 2026-03-10 (B), 2026-02-01 (sast S1)}.
    expect(r1["first_seen"]).toBe("2026-01-05T00:00:00Z");
    // MAX over {2026-06-01 (A, resolved and frozen), 2026-07-01 (B and S1)}.
    expect(r1["last_seen"]).toBe("2026-07-01T00:00:00Z");
    // A really did stop advancing — otherwise the max above proves nothing.
    const rows = tables[TABS.ledger]!;
    const a = rows.find((r) => r["finding_key"] === "sca:id:A")!;
    expect(a["status"]).toBe("RESOLVED");
    expect(a["last_seen"]).toBe("2026-06-01T00:00:00Z");
    expect(a["resolved_at"]).toBe("2026-07-01T00:00:00Z");
  });

  it("re-running the same syncId writes NOTHING and answers from the stored deltas", async () => {
    const { ledger, jobs, TABS } = await load();
    seedJob(jobs, "job-1");
    const syncId = "2026-06-01T00:00:00Z";
    const first = ledger.persistSync("job-1", syncId, battery());
    const ledgerBefore = JSON.stringify(tables[TABS.ledger]);
    const scansBefore = JSON.stringify(tables[TABS.scans]);

    seedJob(jobs, "job-2");
    // After seeding, so the jobs-tab row the seed appends is not counted as ledger traffic.
    calls.appends.length = 0;
    calls.overwrites.length = 0;
    // Different records on purpose: an idempotent replay must not reconcile them.
    const again = ledger.persistSync("job-2", syncId, battery({
      sca: [scaRec("Z", "2026-05-05T00:00:00Z")],
    }));

    expect(calls.appends).toEqual([]);
    expect(calls.overwrites).toEqual([]);
    expect(JSON.stringify(tables[TABS.ledger])).toBe(ledgerBefore);
    expect(JSON.stringify(tables[TABS.scans])).toBe(scansBefore);
    // No journal was even written — a replay that backed up the state would be a Drive write
    // with no commit record to justify it.
    expect(drive.backups).toEqual({});
    expect(again.committed_scopes).toEqual([]);
    expect(again.scopes.every((s) => s.written)).toBe(false);
    expect(again.scopes.map((s) => s.deltas)).toEqual(first.scopes.map((s) => s.deltas));
  });
});

describe("recoverIfNeeded — the two crash windows", () => {
  it("rolls the ledger back byte-for-byte when the commit never landed", async () => {
    const { ledger, locks, jobs, TABS } = await load();
    seedJob(jobs, "job-1");
    ledger.persistSync("job-1", "2026-06-01T00:00:00Z", battery());

    const ledgerBefore = JSON.stringify(tables[TABS.ledger]);
    const episodesBefore = JSON.stringify(tables[TABS.episodes]);
    const scansBefore = JSON.stringify(tables[TABS.scans]);

    // Sync 2 dies in the window between the wholesale rewrite (step 4/5) and the append (6).
    seedJob(jobs, "job-2");
    faults.appendScans = true;
    expect(() =>
      ledger.persistSync("job-2", "2026-07-01T00:00:00Z", battery({
        sca: [scaRec("A", "2026-01-05T00:00:00Z"), scaRec("C", "2026-06-20T00:00:00Z")],
      })),
    ).toThrow(/did not land/);

    // The damage: the ledger tab holds the provisional rewrite, no scans row claims it.
    expect(tables[TABS.scans]!.some((r) => r["scan_id"] === "2026-07-01T00:00:00Z"))
      .toBe(false);
    expect(JSON.stringify(tables[TABS.ledger])).not.toBe(ledgerBefore);
    const crashed = jobs.getJob("job-2")!;
    expect(crashed.phase).toBe("PERSISTING");
    expect(crashed.journal_ref).toBe("backup-job-2");
    expect(crashed.scan_id).toBe("2026-07-01T00:00:00Z");

    locks.recoverIfNeeded();

    // Restored, byte for byte, on all three tabs.
    expect(JSON.stringify(tables[TABS.ledger])).toBe(ledgerBefore);
    expect(JSON.stringify(tables[TABS.episodes])).toBe(episodesBefore);
    expect(JSON.stringify(tables[TABS.scans])).toBe(scansBefore);
    // The snapshot is the read fast path, so leaving it holding the rolled-back rewrite would
    // make the restore invisible to every reader.
    const snap = drive.snapshot as { ledger: Record<string, unknown> };
    expect(Object.keys(snap.ledger).sort()).toEqual(
      JSON.parse(ledgerBefore).map((r: Row) => String(r["finding_key"])).sort(),
    );
    const after = jobs.getJob("job-2")!;
    expect(after.phase).toBe("FAILED");
    expect(after.journal_ref).toBeNull();
    expect(after.error).toMatch(/RESTORED from the journal/);
    expect(drive.backups).toEqual({});
  });

  it("does NOT roll back when the scans rows are already on disk", async () => {
    const { ledger, locks, jobs, TABS } = await load();
    seedJob(jobs, "job-1");
    ledger.persistSync("job-1", "2026-06-01T00:00:00Z", battery());

    // Sync 2 dies in the OTHER window: after the append, before step 7 cleared the journal.
    seedJob(jobs, "job-2");
    faults.clearJournal = true;
    expect(() =>
      ledger.persistSync("job-2", "2026-07-01T00:00:00Z", battery({
        sca: [scaRec("A", "2026-01-05T00:00:00Z"), scaRec("C", "2026-06-20T00:00:00Z")],
      })),
    ).toThrow(/before the journal was cleared/);

    const committedLedger = JSON.stringify(tables[TABS.ledger]);
    const committedScans = JSON.stringify(tables[TABS.scans]);
    expect(tables[TABS.scans]!.filter((r) => r["scan_id"] === "2026-07-01T00:00:00Z"))
      .toHaveLength(3);
    expect(jobs.getJob("job-2")!.journal_ref).toBe("backup-job-2");

    locks.recoverIfNeeded();

    // The commit stands. Restoring here would DELETE an observation the register made.
    expect(JSON.stringify(tables[TABS.ledger])).toBe(committedLedger);
    expect(JSON.stringify(tables[TABS.scans])).toBe(committedScans);
    const after = jobs.getJob("job-2")!;
    expect(after.phase).toBe("FAILED");
    expect(after.journal_ref).toBeNull();
    expect(after.error).toMatch(/after the commit landed/);
    expect(drive.backups).toEqual({});
  });
});

describe("readers", () => {
  it("loadState prefers the snapshot and falls back to the tabs when there is none", async () => {
    const { ledger, jobs, TABS } = await load();
    seedJob(jobs, "job-1");
    ledger.persistSync("job-1", "2026-06-01T00:00:00Z", battery());

    // Doctor the snapshot so the two sources disagree, and prove which one answers.
    const snap = drive.snapshot as { ledger: Record<string, Rec> };
    snap.ledger["sca:id:A"]!["severity"] = "SNAPSHOT";
    for (const row of tables[TABS.ledger]!) {
      if (row["finding_key"] === "sca:id:A") row["severity"] = "TABS";
    }

    const fresh = await load();
    expect(fresh.ledger.loadState().ledger["sca:id:A"]!.severity).toBe("SNAPSHOT");

    drive.snapshot = null;
    const noSnap = await load();
    expect(noSnap.ledger.loadState().ledger["sca:id:A"]!.severity).toBe("TABS");
  });

  it("latestScanRow answers per scope and ignores another register's scans", async () => {
    const { ledger, jobs } = await load();
    seedJob(jobs, "job-1");
    ledger.persistSync("job-1", "2026-06-01T00:00:00Z", battery());
    seedJob(jobs, "job-2");
    // A second sync of sca ONLY — the newest scan in the whole log belongs to sca.
    ledger.persistSync("job-2", "2026-07-01T00:00:00Z", [
      {
        scope: "sca" as const,
        records: [scaRec("A", "2026-01-05T00:00:00Z")],
        mode: "live",
        scannedSeverities: GATE,
      },
    ]);

    const fresh = await load();
    expect(fresh.ledger.latestScanRow("sca")!.scan_id).toBe("2026-07-01T00:00:00Z");
    // Asking for secrets must NOT hand back sca's newer row: reconcile resolves by
    // disappearance against whatever this returns, so a cross-scope answer would close every
    // open row of a register nobody looked at.
    expect(fresh.ledger.latestScanRow("secrets")!.scan_id).toBe("2026-06-01T00:00:00Z");
    expect(fresh.ledger.latestScanRow("secrets")!.scope).toBe("secrets");
  });

  it("syncCommitted answers on the scans-row prefix, per sync", async () => {
    const { ledger, jobs } = await load();
    seedJob(jobs, "job-1");
    ledger.persistSync("job-1", "2026-06-01T00:00:00Z", battery());
    const fresh = await load();
    expect(fresh.ledger.syncCommitted("2026-06-01T00:00:00Z")).toBe(true);
    expect(fresh.ledger.syncCommitted("2026-07-01T00:00:00Z")).toBe(false);
    // A maintenance write carries no sync id, and must never read as committed.
    expect(fresh.ledger.syncCommitted(null)).toBe(false);
  });
});
