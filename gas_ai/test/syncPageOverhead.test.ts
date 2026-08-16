// The per-page overhead the battery used to pay, and the two invariants that keep it down.
//
// Neither of these is a Wiz call. They matter because they decide how many pages fit inside
// one 6-minute execution, and a page that does not fit costs a resume hop — which costs a
// 30-second trigger delay and eats the daily trigger-runtime quota.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

interface DriveCounts {
  getFolderById: number;
  getFoldersByName: number;
  createFile: number;
}

/**
 * A DriveApp fake that counts folder lookups. Deliberately hand-rolled rather than taken
 * from dev/gas-shims.js: what is under test IS the number of service calls, so the fake has
 * to be the thing that counts them.
 */
function stubDrive(): DriveCounts {
  const counts: DriveCounts = { getFolderById: 0, getFoldersByName: 0, createFile: 0 };
  const makeFolder = (id: string): Record<string, unknown> => ({
    getId: () => id,
    getName: () => id,
    getFoldersByName: (name: string) => {
      counts.getFoldersByName += 1;
      let served = false;
      return {
        hasNext: () => !served,
        next: () => {
          served = true;
          return makeFolder(`${id}/${name}`);
        },
      };
    },
    createFolder: (name: string) => makeFolder(`${id}/${name}`),
    setTrashed: () => undefined,
    getFilesByName: () => ({ hasNext: () => false, next: () => undefined }),
    createFile: () => {
      counts.createFile += 1;
      return { getId: () => "file-1" };
    },
  });

  (globalThis as Record<string, unknown>).PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k: string) => (k === "ARCHIVE_FOLDER_ID" ? "root" : null),
      setProperty: () => undefined,
      deleteProperty: () => undefined,
    }),
  };
  (globalThis as Record<string, unknown>).Utilities = {
    gzip: () => ({ getBytes: () => [] }),
    newBlob: () => ({}),
  };
  (globalThis as Record<string, unknown>).DriveApp = {
    getFolderById: (id: string) => {
      counts.getFolderById += 1;
      return makeFolder(id);
    },
  };
  return counts;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

describe("the Drive folder chain is resolved once, not once per page", () => {
  it("costs the same folder lookups for twenty pages as for one", async () => {
    const counts = stubDrive();
    const { writeSyncPage } = await import("../src/server/archiveStore");

    writeSyncPage("sync-1", 0, 1, [{ id: "a" }]);
    const afterFirst = { ...counts };
    // The chain is getFolderById(root) + getFoldersByName("syncs") + getFoldersByName(id).
    expect(afterFirst.getFolderById).toBe(1);
    expect(afterFirst.getFoldersByName).toBe(2);

    for (let page = 2; page <= 20; page += 1) writeSyncPage("sync-1", 0, page, [{ id: "a" }]);

    // Nineteen more pages, nineteen more file writes, and NOT ONE more folder lookup. It
    // used to be four Drive operations and a Script Property read per page.
    expect(counts.createFile).toBe(20);
    expect(counts.getFolderById).toBe(afterFirst.getFolderById);
    expect(counts.getFoldersByName).toBe(afterFirst.getFoldersByName);
  });

  it("keeps a separate handle per sync, so two syncs do not share a folder", async () => {
    const counts = stubDrive();
    const { writeSyncPage } = await import("../src/server/archiveStore");
    writeSyncPage("sync-1", 0, 1, []);
    writeSyncPage("sync-2", 0, 1, []);
    // Root and "syncs" resolved once between them; the per-sync folder resolved twice.
    expect(counts.getFolderById).toBe(1);
    expect(counts.getFoldersByName).toBe(3);
  });

  it("never hands back a folder this execution just trashed", async () => {
    const counts = stubDrive();
    const store = await import("../src/server/archiveStore");
    store.writeSyncPage("sync-1", 0, 1, []);
    const before = counts.getFoldersByName;
    store.trashSyncArchive("sync-1");
    store.writeSyncPage("sync-1", 0, 2, []);
    expect(counts.getFoldersByName).toBeGreaterThan(before);
  });
});

describe("the job checkpoint stays inside the client's liveness window", () => {
  it("CHECKPOINT_MS is strictly under syncProgress.js's STALL_MS", () => {
    // `updated_at` is a liveness signal, not cosmetic progress: past STALL_MS the sync card
    // says "Waiting for next step…" while the battery is actively fetching. This is why the
    // throttle is time-based and not every-Nth-page — one slow page would breach a count.
    const checkpoint = Number(/const CHECKPOINT_MS = ([\d_]+);/
      .exec(read("src/server/syncJobs.ts"))![1].replace(/_/g, ""));
    const stall = Number(/const STALL_MS = (\d+);/
      .exec(read("src/client/js/syncProgress.js"))![1]);
    expect(checkpoint).toBeGreaterThan(0);
    expect(checkpoint).toBeLessThan(stall);
  });

  it("still writes unconditionally on the paths that must be durable", () => {
    const src = read("src/server/syncJobs.ts");
    const battery = src.slice(src.indexOf("function runBattery"));
    // The deadline spill, which is what a resume hop reads back.
    expect(battery).toMatch(/scheduleContinuation\(\);/);
    expect(battery.slice(0, battery.indexOf("scheduleContinuation")))
      .toMatch(/part_refs_json: JSON\.stringify\(refs\)/);
    // The step boundary, which now has to carry the row count the page loop stopped writing.
    const boundary = battery.slice(battery.indexOf("spillHopPart();\n      stepIndex += 1;"));
    expect(boundary).toMatch(/nodes_so_far: nodesSoFar/);
  });

  it("checkpoints the first page of every step, so a new total_count lands at once", () => {
    const src = read("src/server/syncJobs.ts");
    expect(src).toMatch(/if \(page === 1 \|\| Date\.now\(\) - lastCheckpoint >= CHECKPOINT_MS\)/);
  });
});
