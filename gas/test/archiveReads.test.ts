// THE ARCHIVE READ PATH IS TOTAL, AND A READ NEVER CREATES A FOLDER.
//
// The incident these specs exist for: a redeploy moves the build stamp, every durable L2 entry
// goes stale at once, `bootstrapCore()` recomputes, `findings.currentScan()` reads the scan frame
// off Drive — and DriveApp answered "Service error: Drive". Nothing caught it, so the throw came
// back out of `api_bootstrap`, which every page awaits before it renders anything, and the shell
// painted "This page failed to load" over every route at once.
//
// Two properties are pinned here and they fail differently:
//
//   TOTAL. Each read answers null / [] on a Drive failure. Every caller already has a fallback
//   behind it (frame -> slim -> raw pages -> [], snapshot -> Sheets tabs), so the register goes
//   slow rather than dark — but only while nothing above it throws.
//
//   NEVER CREATES. `childFolder` used to create a missing folder on the way to reading from it,
//   which is a Drive WRITE on a GET and turns "this archive is missing" into "this archive is
//   empty" — an answer that reads as data rather than as an absence.
//
// And the failure stays visible: each distinct label is recorded once per execution for
// Settings -> System -> Diagnostics, because the Apps Script execution log is not reachable from
// the deployed web app and a `console.warn` there is the same as no report at all.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ------------------------------------------------------------------------ the Drive fake
const recorded: Array<{ op: string; kind: string }> = [];
vi.mock("../src/server/errorLog", () => ({
  recordError: (op: string, _e: unknown, kind: string) => { recorded.push({ op, kind }); },
  recentErrors: () => [],
}));

/** What the fake Drive should do this spec. */
const drive = {
  /** Subfolder name -> { file name -> payload }. A name absent from here is a missing folder. */
  tree: {} as Record<string, Record<string, unknown>>,
  /** Scan id -> { file name -> payload }, under "scans". */
  scans: {} as Record<string, Record<string, unknown>>,
  rootThrows: false,
  foldersThrow: false,
  filesThrow: false,
  created: [] as string[],
};

function iter<T>(items: T[]): { hasNext: () => boolean; next: () => T } {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++]! };
}

// parseGzBlob sniffs the gzip magic and falls back to the raw string, so an un-gzipped blob is a
// legal one — which keeps Utilities out of this fake entirely.
function fakeFile(name: string, payload: unknown): unknown {
  const json = JSON.stringify(payload);
  return {
    getName: () => name,
    getId: () => `file-${name}`,
    getBlob: () => ({
      getBytes: () => [...Buffer.from(json, "utf8")],
      getDataAsString: () => json,
    }),
    setTrashed: () => {},
  };
}

function fakeFolder(name: string, files: Record<string, unknown>, children: string[]): unknown {
  return {
    getId: () => `folder-${name}`,
    getName: () => name,
    getFoldersByName: (n: string) => {
      if (drive.foldersThrow) throw new Error("Erreur liée à un service : Drive");
      return iter(children.includes(n) ? [folderNamed(n)] : []);
    },
    getFilesByName: (n: string) => {
      if (drive.filesThrow) throw new Error("Erreur liée à un service : Drive");
      return iter(n in files ? [fakeFile(n, files[n])] : []);
    },
    getFiles: () => {
      if (drive.filesThrow) throw new Error("Erreur liée à un service : Drive");
      return iter(Object.keys(files).map((n) => fakeFile(n, files[n])));
    },
    createFolder: (n: string) => { drive.created.push(n); return fakeFolder(n, {}, []); },
    createFile: () => fakeFile("written", null),
  };
}

function folderNamed(name: string): unknown {
  if (name === "scans") return fakeFolder("scans", {}, Object.keys(drive.scans));
  if (name in drive.scans) return fakeFolder(name, drive.scans[name]!, []);
  return fakeFolder(name, drive.tree[name] ?? {}, []);
}

vi.stubGlobal("DriveApp", {
  getFolderById: (id: string) => {
    if (drive.rootThrows) throw new Error("Erreur liée à un service : Drive");
    if (id === "root-1") {
      return fakeFolder("root", {}, [...Object.keys(drive.tree), "scans"]);
    }
    throw new Error(`No Drive folder ${id}`);
  },
  getFileById: () => { throw new Error("no file"); },
});

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => (k === "ARCHIVE_FOLDER_ID" ? "root-1" : null),
    setProperty: () => {},
    deleteProperty: () => {},
  }),
});

const load = () => import("../src/server/archiveStore");
let archive: Awaited<ReturnType<typeof load>>;

beforeEach(async () => {
  vi.resetModules();
  drive.tree = { snapshots: {}, readmodels: {}, obs: {} };
  drive.scans = {};
  drive.rootThrows = false;
  drive.foldersThrow = false;
  drive.filesThrow = false;
  drive.created = [];
  recorded.length = 0;
  vi.stubGlobal("console", { ...console, warn: () => {} });
  archive = await load();
});

const FRAME = [{ id: "f-1", _vuln_key: "k1" }];

describe("the happy path still reads", () => {
  it("returns the frame, the slim spill and the snapshot when Drive answers", () => {
    drive.scans["scan-1"] = {
      "frame-v1.json.gz": FRAME,
      "slim.json.gz": [{ id: "f-1" }],
      "pageruns.json.gz": [[1, 1]],
      "page-0001.json.gz": { data: 1 },
    };
    drive.tree["snapshots"] = {
      "ledger-snapshot.json.gz": { version: 1, ledger: { k1: {} }, episodes: [] },
    };
    expect(archive.readFrame("scan-1")).toEqual(FRAME);
    expect(archive.readSlimRecords("scan-1")).toEqual([{ id: "f-1" }]);
    expect(archive.readPageRuns("scan-1")).toEqual([[1, 1]]);
    expect(archive.readScanPage("scan-1", 1)).toEqual({ data: 1 });
    expect(archive.readLedgerSnapshot()?.ledger).toEqual({ k1: {} });
    expect(drive.created).toEqual([]);
  });
});

describe("a Drive service error is an absence, not a throw", () => {
  it("answers null / [] from every read when getFolderById throws", () => {
    drive.rootThrows = true;
    expect(archive.readFrame("scan-1")).toBeNull();
    expect(archive.readSlimRecords("scan-1")).toBeNull();
    expect(archive.readPageRuns("scan-1")).toBeNull();
    expect(archive.readScanPage("scan-1", 1)).toBeNull();
    expect(archive.readLedgerSnapshot()).toBeNull();
    expect(archive.readGzJsonNamed("readmodels", "rm-x.json.gz")).toBeNull();
    expect(archive.listNames("readmodels")).toEqual([]);
    expect(archive.readScanPayload("folder-scan-1")).toBeNull();
    expect(archive.listScanPageNumbers("folder-scan-1")).toEqual([]);
  });

  it("answers the same way when the folder listing throws mid-read", () => {
    drive.foldersThrow = true;
    expect(archive.readFrame("scan-1")).toBeNull();
    expect(archive.readLedgerSnapshot()).toBeNull();
  });

  it("answers the same way when the file lookup throws", () => {
    drive.scans["scan-1"] = { "frame-v1.json.gz": FRAME };
    drive.filesThrow = true;
    expect(archive.readFrame("scan-1")).toBeNull();
    expect(archive.readSlimRecords("scan-1")).toBeNull();
    expect(archive.readLedgerSnapshot()).toBeNull();
  });

  it("answers null for a scan whose archive folder simply is not there", () => {
    expect(archive.readFrame("never-scanned")).toBeNull();
    expect(archive.readSlimRecords("never-scanned")).toBeNull();
  });
});

describe("a read never creates a folder", () => {
  // A GET that mints the folder it failed to find is a Drive write on a read, and it turns a
  // missing archive into an empty one — which every caller then reads as data.
  it("creates nothing when the subfolder is missing", () => {
    delete drive.tree["snapshots"];
    expect(archive.readLedgerSnapshot()).toBeNull();
    expect(archive.readFrame("scan-1")).toBeNull();
    expect(archive.readGzJsonNamed("obs", "obs-1.json.gz")).toBeNull();
    expect(archive.listNames("readmodels")).toEqual([]);
    expect(drive.created).toEqual([]);
  });

  it("creates nothing when the scan folder is missing", () => {
    expect(archive.readPageRuns("scan-404")).toBeNull();
    expect(archive.readScanPage("scan-404", 1)).toBeNull();
    expect(drive.created).toEqual([]);
  });

  // The write half is unchanged: the skeleton still self-heals a deployment that never re-ran
  // setup(), which is why the split is between the two lookups rather than a global switch.
  it("still creates on the write path", () => {
    expect(archive.scanFolder("scan-new").getName()).toBe("scan-new");
    expect(drive.created).toEqual(["scan-new"]);
  });
});

describe("the failure is recorded, once per label per execution", () => {
  // The log is a 25-entry ring in ONE Script Property. A Drive that fails fails for every read in
  // the request, so an unthrottled record would push the first and most informative entry out
  // with copies of itself.
  it("records one entry however many reads hit the same failure", () => {
    drive.rootThrows = true;
    for (let i = 0; i < 5; i += 1) archive.readFrame(`scan-${i}`);
    expect(recorded.filter((r) => r.op === "archiveRead:scans")).toHaveLength(1);
  });

  it("records each distinct label once", () => {
    drive.rootThrows = true;
    archive.readFrame("scan-1");
    archive.readLedgerSnapshot();
    archive.readFrame("scan-2");
    archive.readLedgerSnapshot();
    expect(recorded.map((r) => r.op).sort())
      .toEqual(["archiveRead:scans", "archiveRead:snapshots"]);
    expect(recorded.every((r) => r.kind === "error")).toBe(true);
  });

  it("records nothing when a folder is merely absent", () => {
    // An absence is not a failure: a scan with no archive, or a register that has never warmed a
    // read model, would otherwise fill Diagnostics with entries nobody can act on.
    expect(archive.readFrame("never-scanned")).toBeNull();
    expect(recorded).toEqual([]);
  });
});

// The snapshot is written as v2 (columns + a string dictionary,
// gas_shared/domain/snapshotCodec.ts) and must read back as the same ledger map a v1 file did; a
// v1 file an older deployment left behind still reads (the spec above).
describe("the v2 ledger snapshot", () => {
  it("reads back the ledger and episodes it was encoded from", async () => {
    const { encodeSnapshot } = await import("../../gas_shared/domain/snapshotCodec");
    const ledger = {
      k1: { vuln_key: "k1", status: "OPEN", tags_json: '{"Wiz/Domain":"A"}', epss: 0.2 },
      k2: { vuln_key: "k2", status: "OPEN", tags_json: '{"Wiz/Domain":"A"}', epss: null },
    };
    const episodes = [{ vuln_key: "e1", tags_json: '{"Wiz/Domain":"A"}', reopened_count: 1 }];
    drive.tree["snapshots"] = {
      "ledger-snapshot.json.gz": JSON.parse(JSON.stringify(encodeSnapshot(ledger, episodes))),
    };
    const snap = archive.readLedgerSnapshot();
    expect(snap?.ledger).toStrictEqual(ledger);
    expect(snap?.episodes).toStrictEqual(episodes);
  });
});
