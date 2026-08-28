// The archive's two refusals, against the shipped implementation.
//
// `test/scanBattery.test.js` shows what they PREVENT — 47 of 94 findings closing as fixes on
// one dropped page — using a fake that mirrors these rules. This file holds the rules
// themselves, so the mirror cannot drift away from the thing it mirrors.
//
// Drive is faked at the level `archiveStore` actually uses it: folders that hold files by
// name, blobs that carry bytes. `Utilities.gzip` is an identity transform here, exactly as it
// is in `dev/gas-shims.js`, and `parseGzBlob` handles that by sniffing the gzip magic bytes
// before deciding to inflate.

import { beforeEach, describe, expect, it, vi } from "vitest";

const props = vi.hoisted(() => ({ ARCHIVE_FOLDER_ID: "root" }));
const fs = vi.hoisted(() => ({ folders: {}, corrupt: new Set() }));

function makeBlob(text, name) {
  return {
    getName: () => name,
    getBytes: () => Array.from(text).map((c) => c.charCodeAt(0) & 0xff),
    getDataAsString: () => text,
  };
}

const file_trashed = [];

function makeFile(store, entry) {
  return {
    getName: () => entry.name,
    getId: () => `file:${entry.name}`,
    getSize: () => entry.text.length,
    getBlob: () => makeBlob(entry.text, entry.name),
    setTrashed: (v) => {
      file_trashed.push([entry.name, v]);
      if (v) {
        const i = store.files.indexOf(entry);
        if (i >= 0) store.files.splice(i, 1);
      }
    },
  };
}

/** A folder is a bag of files plus child folders, addressed by name. */
function folder(path) {
  fs.folders[path] ??= { files: [], children: {} };
  const self = fs.folders[path];
  const iter = (arr) => {
    let i = 0;
    return { hasNext: () => i < arr.length, next: () => arr[i++] };
  };
  return {
    getId: () => path,
    getFiles: () => iter(self.files.slice().map((e) => makeFile(self, e))),
    getFilesByName: (n) => iter(self.files.filter((e) => e.name === n).map((e) => makeFile(self, e))),
    getFolders: () => iter(Object.keys(self.children).map((c) => folder(`${path}/${c}`))),
    getFoldersByName: (n) => iter(self.children[n] ? [folder(`${path}/${n}`)] : []),
    createFolder: (n) => { self.children[n] = true; return folder(`${path}/${n}`); },
    createFile: (blob) => {
      const name = blob.getName();
      const at = self.files.findIndex((e) => e.name === name);
      if (at >= 0) self.files.splice(at, 1);
      const entry = { name, text: blob.getDataAsString() };
      self.files.push(entry);
      return makeFile(self, entry);
    },
  };
}

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k) => props[k] ?? null,
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }),
});
vi.stubGlobal("DriveApp", {
  getFolderById: (id) => folder(id),
  getFileById: (id) => {
    const name = String(id).replace(/^file:/, "");
    for (const p of Object.keys(fs.folders)) {
      const hit = fs.folders[p].files.find((e) => e.name === name);
      if (hit) return makeFile(fs.folders[p], hit);
    }
    throw new Error(`no such file ${id}`);
  },
});
vi.stubGlobal("Utilities", {
  // Identity, as in the dev shim — but gzip(blob, name) is where the file gets its NAME in
  // GAS, and dropping that argument leaves every archive file called `undefined`. (Measured:
  // it did, and all eight specs failed on `startsWith` of undefined.)
  gzip: (blob, name) => (name ? makeBlob(blob.getDataAsString(), name) : blob),
  ungzip: (blob) => blob,
  newBlob: (text, _type, name) => makeBlob(text, name),
});
vi.spyOn(console, "warn").mockImplementation(() => {});

const load = () => import("../src/server/archiveStore");

beforeEach(async () => {
  fs.folders = {};
  file_trashed.length = 0;
  vi.resetModules();
  const a = await load();
  a.__resetMemosForTest();
});

/** Stage `n` pages of one step, then hand back the module. */
async function stage(n, syncId = "sync-1", step = 0) {
  const a = await load();
  for (let p = 1; p <= n; p += 1) {
    a.writeSyncPage(syncId, step, p, { nodes: [{ id: `p${p}` }] });
  }
  return a;
}

describe("reading a step back", () => {
  it("returns every page, in page order", async () => {
    const a = await stage(12); // enough that lexical order and numeric order could disagree
    const pages = a.readSyncStepPages("sync-1", 0, 12);
    expect(pages.map((p) => p.nodes[0].id))
      .toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"]);
  });

  it("REFUSES when fewer pages are on disk than the checkpoint recorded", async () => {
    // The refusal this module exists for. A short read is not a short list — it is a smaller
    // POPULATION, and `reconcile` reads absence as remediation, so the findings in the
    // missing page close as fixes with nothing reporting an error.
    const a = await stage(3);
    expect(() => a.readSyncStepPages("sync-1", 0, 4))
      .toThrow(/recorded 4 page\(s\) but 3 are on disk/);
  });

  it("refuses when there are MORE pages than recorded, too", async () => {
    // The other direction is not harmless either: it means the checkpoint and the disk
    // disagree about what this walk did, and neither one is trustworthy about the rest.
    const a = await stage(3);
    expect(() => a.readSyncStepPages("sync-1", 0, 2)).toThrow(/but 3 are on disk/);
  });

  it("REFUSES a page it cannot parse, rather than passing over it", async () => {
    // Same population failure, quieter cause: the file is there, the count is right, and the
    // bytes are not JSON. Skipping it is indistinguishable from it never having existed.
    const a = await stage(3);
    fs.folders["root/syncs/sync-1"].files[1].text = "{ truncated";
    expect(() => a.readSyncStepPages("sync-1", 0, 3)).toThrow(/could not be read/);
  });

  it("keeps steps apart", async () => {
    const a = await stage(2, "sync-1", 0);
    a.writeSyncPage("sync-1", 1, 1, { nodes: [{ id: "other" }] });
    expect(a.readSyncStepPages("sync-1", 0, 2)).toHaveLength(2);
    expect(a.readSyncStepPages("sync-1", 1, 1)).toHaveLength(1);
  });
});

describe("abandoning a step", () => {
  it("trashes only that step's pages", async () => {
    // Per step, never the whole sync folder: earlier scopes in the same job may already have
    // committed scan rows naming that folder as their raw_ref, and tidying up an abandoned
    // third step would take the evidence for the first two with it.
    const a = await stage(2, "sync-1", 0);
    a.writeSyncPage("sync-1", 1, 1, { nodes: [] });
    a.trashSyncStepPages("sync-1", 1);
    expect(file_trashed.map((t) => t[0])).toEqual(["step-1-page-0001.json.gz"]);
  });

  it("counts what is on disk without reading it", async () => {
    const a = await stage(5);
    expect(a.syncStepPageCount("sync-1", 0)).toBe(5);
    expect(a.syncStepPageCount("sync-1", 1)).toBe(0);
  });
});

describe("a rewritten page replaces its predecessor", () => {
  it("does not leave two files claiming the same page number", async () => {
    // What makes a resumed hop safe: it re-fetches from the stored cursor and writes the same
    // deterministic name. If that appended instead of replacing, every resume would inflate
    // the page count and then trip the refusal above on a walk that was actually fine.
    const a = await stage(2);
    a.writeSyncPage("sync-1", 0, 2, { nodes: [{ id: "p2-again" }] });
    const pages = a.readSyncStepPages("sync-1", 0, 2);
    expect(pages).toHaveLength(2);
    expect(pages[1].nodes[0].id).toBe("p2-again");
  });
});
