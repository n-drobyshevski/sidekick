// archiveStore round-trips, against the in-browser Drive/Properties fakes in
// dev/gas-shims.js. That shim's `Utilities.gzip`/`ungzip` are identity transforms (see its own
// header comment), so these tests assert on JSON CONTENT, never on compressed bytes —
// `parseGzBlob` sniffs the gzip magic bytes and falls back to plain-text parsing, which is
// exactly what a non-gzipped fake blob is.
//
// `test/gasEnv.ts` does not exist in this package yet (a parallel package, H1, is landing it);
// this file evaluates `dev/gas-shims.js` itself, the way `vitest.config.ts`'s
// `statefulFiles()` comment describes, and resets the module registry + archiveStore's memos
// between tests so each one starts from an empty archive folder. Swap the `boot()` helper
// below for gasEnv's `bootServer()` once that lands — the behaviour it exercises should not
// need to change.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerState } from "../src/domain/ledgerTypes";

// archiveStore only checks the OUTER shape of a state (arrays + keyed object) and never reads a
// row, so these tests build deliberately partial rows and cast them.
const partial = (s: object): LedgerState => s as unknown as LedgerState;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type ArchiveStoreModule = typeof import("../src/server/archiveStore");

/**
 * Fresh GAS Drive/Properties fakes + a freshly-imported archiveStore, with a new empty
 * archive root folder already wired into ARCHIVE_FOLDER_ID.
 *
 * `vi.resetModules()` is what makes this file "stateful" under vitest.config.ts's detector
 * (it greps test files for exactly this call), which is what earns it full test isolation —
 * load-bearing, not incidental, since two tests sharing one Drive fake would leak files
 * between them.
 */
async function boot(): Promise<ArchiveStoreModule> {
  vi.resetModules();
  const g = globalThis as Record<string, unknown>;
  g["window"] = globalThis;
  runInThisContext(readFileSync(join(ROOT, "dev/gas-shims.js"), "utf8"), {
    filename: "dev/gas-shims.js",
  });
  const rootId = DriveApp.createFolder("archive-root").getId();
  PropertiesService.getScriptProperties().setProperty("ARCHIVE_FOLDER_ID", rootId);
  return import("../src/server/archiveStore");
}

let store: ArchiveStoreModule;

beforeEach(async () => {
  store = await boot();
});

describe("typed round trips", () => {
  it("writeScanPage / readScanPages", () => {
    expect(store.readScanPages("scan-1")).toEqual([]);
    store.writeScanPage("scan-1", 0, { finding: "a" });
    expect(store.readScanPages("scan-1")).toEqual([{ finding: "a" }]);
  });

  it("writeSlim / readSlim", () => {
    expect(store.readSlim("scan-1")).toBeNull();
    store.writeSlim("scan-1", [{ key: "k1" }, { key: "k2" }]);
    expect(store.readSlim("scan-1")).toEqual([{ key: "k1" }, { key: "k2" }]);
  });

  it("writePageRuns / readPageRuns", () => {
    expect(store.readPageRuns("scan-1")).toBeNull();
    store.writePageRuns("scan-1", [
      [0, 500],
      [1, 342],
    ]);
    expect(store.readPageRuns("scan-1")).toEqual([
      [0, 500],
      [1, 342],
    ]);
  });

  it("writeObservations / readObservations", () => {
    expect(store.readObservations("scan-1")).toEqual([]);
    store.writeObservations("scan-1", ["k1", "k2", "k3"]);
    expect(store.readObservations("scan-1")).toEqual(["k1", "k2", "k3"]);
  });

  it("writeLedgerSnapshot / readLedgerSnapshot — one file, latest wins", () => {
    expect(store.readLedgerSnapshot()).toBeNull();
    // `ledger` is a Record keyed by finding_key (src/domain/ledgerTypes.ts's LedgerState),
    // not an array — the validity check below must accept an object here and still reject one
    // shaped like the OLD array-typed guess this stand-in started from.
    const first = partial({ scans: [{ scan_id: "s1" }], ledger: { v1: { finding_key: "v1" } }, episodes: [] });
    store.writeLedgerSnapshot(first);
    expect(store.readLedgerSnapshot()).toEqual({ version: 1, ...first });

    // A second write REPLACES the snapshot rather than accumulating a history of them.
    const second = partial({ scans: [], ledger: {}, episodes: [{ finding_key: "v2" }] });
    store.writeLedgerSnapshot(second);
    expect(store.readLedgerSnapshot()).toEqual({ version: 1, ...second });
  });

  it("writeBackup / readBackup / trashBackup — keyed by jobId", () => {
    expect(store.readBackup("job-1")).toBeNull();
    const state = partial({ scans: [], ledger: { v1: { finding_key: "v1" } }, episodes: [] });
    store.writeBackup("job-1", state);
    expect(store.readBackup("job-1")).toEqual(state);
    // A second, unrelated job's backup is independent.
    store.writeBackup("job-2", { scans: [], ledger: {}, episodes: [] });
    expect(store.readBackup("job-1")).toEqual(state);

    store.trashBackup("job-1");
    expect(store.readBackup("job-1")).toBeNull();
    // trashBackup is scoped to its own jobId; the sibling backup survives.
    expect(store.readBackup("job-2")).not.toBeNull();
  });

  it("readLedgerSnapshot rejects a document where ledger is shaped as an array", () => {
    // Guards the fix: ledger is a Record<string, LedgerRow>, and a document that instead
    // carries an array there must read back as absent (fall back to the tabs) rather than as
    // a falsely-valid snapshot.
    store.writeGzJson(store.subfolder("snapshots"), "ledger-snapshot.json.gz", {
      version: 1,
      scans: [],
      ledger: [{ finding_key: "v1" }],
      episodes: [],
    });
    expect(store.readLedgerSnapshot()).toBeNull();
  });
});

describe("same-name writes replace rather than accumulate", () => {
  it("a second writeScanPage of the same page leaves exactly one file", () => {
    store.writeScanPage("scan-1", 0, { v: 1 });
    store.writeScanPage("scan-1", 0, { v: 2 });

    let count = 0;
    const files = store.scanFolder("scan-1").getFiles();
    while (files.hasNext()) {
      files.next();
      count += 1;
    }
    expect(count).toBe(1);
    expect(store.readScanPages("scan-1")).toEqual([{ v: 2 }]);
  });

  it("a second writeLedgerSnapshot leaves exactly one snapshot file", () => {
    store.writeLedgerSnapshot({ scans: [], ledger: {}, episodes: [] });
    store.writeLedgerSnapshot(partial({ scans: [{ scan_id: "s1" }], ledger: {}, episodes: [] }));

    let count = 0;
    const files = store.subfolder("snapshots").getFiles();
    while (files.hasNext()) {
      files.next();
      count += 1;
    }
    expect(count).toBe(1);
  });
});

describe("readScanPages ordering", () => {
  it("comes back in page-index order even when written out of order", () => {
    store.writeScanPage("scan-1", 2, { p: 2 });
    store.writeScanPage("scan-1", 0, { p: 0 });
    store.writeScanPage("scan-1", 1, { p: 1 });

    expect(store.readScanPages("scan-1")).toEqual([{ p: 0 }, { p: 1 }, { p: 2 }]);
  });

  it("orders past two digits (page-0002 before page-0010), not lexically by the bare number", () => {
    store.writeScanPage("scan-1", 10, { p: 10 });
    store.writeScanPage("scan-1", 2, { p: 2 });

    expect(store.readScanPages("scan-1")).toEqual([{ p: 2 }, { p: 10 }]);
  });
});

describe("readGzJson", () => {
  it("returns null for a missing file, never throws for absence", () => {
    expect(store.readGzJson(store.subfolder("snapshots"), "nope.json.gz")).toBeNull();
    expect(store.readScanPages("no-such-scan")).toEqual([]);
    expect(store.readSlim("no-such-scan")).toBeNull();
  });

  it("throws, naming the file, when the content is not valid JSON", () => {
    const folder = store.subfolder("snapshots");
    folder.createFile(Utilities.newBlob("not { valid json", "application/json", "bad.json.gz"));
    expect(() => store.readGzJson(folder, "bad.json.gz")).toThrow(/bad\.json\.gz/);
  });
});

describe("trashScan", () => {
  it("removes pages, slim, pageruns and the obs file together", () => {
    store.writeScanPage("scan-1", 0, { p: 0 });
    store.writeSlim("scan-1", [{ k: 1 }]);
    store.writePageRuns("scan-1", [[0, 100]]);
    store.writeObservations("scan-1", ["k1"]);

    store.trashScan("scan-1");

    expect(store.readScanPages("scan-1")).toEqual([]);
    expect(store.readSlim("scan-1")).toBeNull();
    expect(store.readPageRuns("scan-1")).toBeNull();
    expect(store.readObservations("scan-1")).toEqual([]);
  });

  it("leaves an unrelated scan's archive untouched", () => {
    store.writeScanPage("scan-1", 0, { p: 0 });
    store.writeObservations("scan-1", ["k1"]);
    store.writeScanPage("scan-2", 0, { p: 0 });
    store.writeObservations("scan-2", ["k2"]);

    store.trashScan("scan-1");

    expect(store.readScanPages("scan-2")).toEqual([{ p: 0 }]);
    expect(store.readObservations("scan-2")).toEqual(["k2"]);
  });
});

describe("archiveBytes", () => {
  it("totals match the sizes of what was written, by top-level folder", () => {
    const page = { hello: "world" };
    const keys = ["k1", "k2"];
    store.writeScanPage("scan-1", 0, page);
    store.writeObservations("scan-1", keys);

    const bytes = store.archiveBytes();
    expect(bytes["scans"]).toBe(JSON.stringify(page).length);
    expect(bytes["obs"]).toBe(JSON.stringify(keys).length);
    // Untouched folders exist (subfolder() creates on demand) and total zero.
    expect(bytes["backups"]).toBe(0);
    expect(bytes["checkpoints"]).toBe(0);
  });

  it("grows when a same-name write replaces a smaller payload with a larger one", () => {
    store.writeSlim("scan-1", [{ a: 1 }]);
    const before = store.archiveBytes()["scans"];
    store.writeSlim("scan-1", [{ a: 1 }, { b: 2 }, { c: 3 }]);
    const after = store.archiveBytes()["scans"];
    expect(after).toBeGreaterThan(before);
  });
});

describe("ensureFolders", () => {
  it("creates the full folder skeleton and is idempotent", () => {
    const rootId = PropertiesService.getScriptProperties().getProperty("ARCHIVE_FOLDER_ID")!;
    expect(store.ensureFolders(rootId)).toBe(rootId);
    // Running it again must not create a second folder of any name.
    store.ensureFolders(rootId);
    const root = DriveApp.getFolderById(rootId);
    for (const name of ["scans", "obs", "snapshots", "backups", "readmodels", "checkpoints", "history"]) {
      let count = 0;
      const folders = root.getFoldersByName(name);
      while (folders.hasNext()) {
        folders.next();
        count += 1;
      }
      expect(count, `${name} should exist exactly once`).toBe(1);
    }
  });
});
