// In-browser fakes of the GAS services the server bundle touches, for local UI/UX
// work (dev/serve.mjs). Everything is in-memory and resets on reload; dev/boot.js
// re-seeds deterministic dry-run data each load. Fidelity notes:
//   - Utilities.gzip/ungzip are identity transforms. That is safe end-to-end:
//     archiveStore.parseGzBlob sniffs the gzip magic bytes and falls back to
//     plain-text parsing, and serverCache only round-trips its own blobs.
//   - LockService always grants the lock (single-threaded page).
//   - ScriptApp triggers are recorded; a trigger_continueScan / trigger_continueSync
//     one-shot actually fires via setTimeout so a multi-hop sync still completes.
//   - UrlFetchApp is the one shim that is NOT a fake: it forwards to the dev server
//     (/_fetch), which holds the credentials and makes the real call. With none
//     configured the proxy refuses and the app stays dry-run, as before.

(function () {
  "use strict";

  // -------------------------------------------------------------------- counters
  //
  // Service-call counters, so a claim about cost can be MEASURED rather than asserted.
  // Both of these count something the real platform charges for and the fakes do not:
  // a PropertiesService read is a ~10-50ms round trip in GAS and free here, and a
  // getValues() over a whole tab is the single most expensive thing this app does.
  //
  // Deliberately NOT part of snapshot()/restore(): they describe what the code just
  // DID, not what the world currently holds, so restoring a grid must not rewind them.
  // Reset explicitly instead.
  const counters = { propGet: 0, propSet: 0, rangeReads: 0, cellsRead: 0 };

  // ------------------------------------------------------------------------ Blob
  class FakeBlob {
    constructor(data, contentType, name) {
      this._data = data; // string or byte array
      this._type = contentType || null;
      this._name = name || null;
    }
    getDataAsString() {
      return typeof this._data === "string"
        ? this._data
        : new TextDecoder().decode(Uint8Array.from(this._data, (b) => b & 0xff));
    }
    getBytes() {
      return typeof this._data === "string"
        ? Array.from(new TextEncoder().encode(this._data))
        : this._data;
    }
    getName() { return this._name; }
    setName(n) { this._name = n; return this; }
    getContentType() { return this._type; }
  }

  // -------------------------------------------------------------------- Utilities
  function bytesToBinary(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(
        null,
        Array.from(bytes.slice(i, i + 0x8000), (b) => b & 0xff),
      );
    }
    return s;
  }

  window.Utilities = {
    newBlob: (data, contentType, name) => new FakeBlob(data, contentType, name),
    gzip: (blob, name) => new FakeBlob(blob._data, "application/x-gzip", name || blob._name),
    ungzip: (blob) => new FakeBlob(blob._data, "application/json", blob._name),
    base64Encode: (input) =>
      typeof input === "string"
        ? btoa(bytesToBinary(new TextEncoder().encode(input)))
        : btoa(bytesToBinary(input)),
    base64Decode: (s) => Array.from(atob(s), (c) => c.charCodeAt(0)),
    // A real block, not a no-op: the only caller is the 429/5xx backoff in wizClientAi,
    // and against a live tenant a backoff that returns instantly is the burst it was
    // written to break up. Server code here is synchronous (see UrlFetchApp), so spinning
    // is the only way to wait. Capped so a bad number cannot hang the tab indefinitely.
    //
    // THE ESCAPE HATCH IS NOT OPTIONAL, and the reason is specific rather than tidiness.
    // `test/gasEnv.ts` boots this file under `vi.useFakeTimers({ toFake: ["Date"] })` with a
    // FROZEN clock, so `Date.now()` never advances and `Date.now() < end` can never become
    // false — the spin is INFINITE, not slow, and being synchronous it cannot be interrupted
    // by a test timeout. It bites exactly one test today (`scopedPosture.test.ts` stubs an
    // HTTP 500 and drives the 5xx backoff), which is how it went unnoticed: 8 of its 9 cases
    // pass and the 9th takes the vitest worker down with it.
    //
    // So the block is skipped when the harness says so. There is nothing to be polite to in a
    // unit test — vitest never reaches a tenant — and honouring the flag keeps live behaviour
    // byte-identical rather than trading a real backoff for a faster suite.
    sleep: (ms) => {
      if (window.__GAS_SHIM_INSTANT_SLEEP__) return;
      const end = Date.now() + Math.min(Math.max(0, Number(ms) || 0), 30_000);
      while (Date.now() < end) { /* spin */ }
    },
    getUuid: () =>
      (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
  };

  // ------------------------------------------------------------ PropertiesService
  const props = new Map();
  window.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => { counters.propGet++; return props.has(k) ? props.get(k) : null; },
      setProperty: (k, v) => { counters.propSet++; props.set(k, String(v)); },
      deleteProperty: (k) => { props.delete(k); },
      getProperties: () => Object.fromEntries(props),
      getKeys: () => [...props.keys()],
    }),
  };

  // ----------------------------------------------------------------- LockService
  window.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      waitLock: () => {},
      releaseLock: () => {},
      hasLock: () => true,
    }),
  };

  // ---------------------------------------------------------------- CacheService
  const cache = new Map();
  const scriptCache = {
    get: (k) => (cache.has(k) ? cache.get(k) : null),
    getAll: (keys) => {
      const out = {};
      for (const k of keys) if (cache.has(k)) out[k] = cache.get(k);
      return out;
    },
    put: (k, v) => { cache.set(k, String(v)); },
    putAll: (entries) => {
      for (const [k, v] of Object.entries(entries)) cache.set(k, String(v));
    },
    remove: (k) => { cache.delete(k); },
    removeAll: (keys) => { for (const k of keys) cache.delete(k); },
  };
  window.CacheService = {
    getScriptCache: () => scriptCache,
    getUserCache: () => scriptCache,
    getDocumentCache: () => scriptCache,
  };

  // -------------------------------------------------------------------- DriveApp
  let driveSeq = 0;
  const driveFiles = new Map(); // id -> FakeFile
  const driveFolders = new Map(); // id -> FakeFolder

  function iterator(items) {
    let i = 0;
    return { hasNext: () => i < items.length, next: () => items[i++] };
  }

  class FakeFile {
    constructor(blob, parent) {
      this._id = `file-${++driveSeq}`;
      this._blob = blob;
      this._parent = parent;
      this._trashed = false;
      driveFiles.set(this._id, this);
    }
    getId() { return this._id; }
    getName() { return this._blob.getName() || "unnamed"; }
    getBlob() { return this._blob; }
    getSize() {
      const d = this._blob._data;
      return typeof d === "string" ? d.length : d.length;
    }
    setTrashed(t) { this._trashed = t; return this; }
    isTrashed() { return this._trashed; }
    getUrl() { return `#drive-file/${this._id}`; }
    getDownloadUrl() { return `#drive-download/${this._id}`; }
  }

  class FakeFolder {
    constructor(name) {
      this._id = `folder-${++driveSeq}`;
      this._name = name;
      this._folders = [];
      this._files = [];
      this._trashed = false;
      driveFolders.set(this._id, this);
    }
    getId() { return this._id; }
    getName() { return this._name; }
    getUrl() { return `#drive-folder/${this._id}`; }
    setTrashed(t) { this._trashed = t; return this; }
    isTrashed() { return this._trashed; }
    createFolder(name) {
      const f = new FakeFolder(name);
      this._folders.push(f);
      return f;
    }
    createFile(blob) {
      const f = new FakeFile(blob, this);
      this._files.push(f);
      return f;
    }
    getFoldersByName(name) {
      return iterator(this._folders.filter((f) => !f._trashed && f._name === name));
    }
    getFilesByName(name) {
      return iterator(this._files.filter((f) => !f._trashed && f.getName() === name));
    }
    getFiles() {
      return iterator(this._files.filter((f) => !f._trashed));
    }
    getFolders() {
      return iterator(this._folders.filter((f) => !f._trashed));
    }
  }

  window.DriveApp = {
    createFolder: (name) => new FakeFolder(name),
    getFolderById: (id) => {
      const f = driveFolders.get(id);
      if (!f || f._trashed) throw new Error(`No Drive folder ${id}`);
      return f;
    },
    getFileById: (id) => {
      const f = driveFiles.get(id);
      if (!f || f._trashed) throw new Error(`No Drive file ${id}`);
      return f;
    },
  };

  // -------------------------------------------------------------- SpreadsheetApp
  let ssSeq = 0;
  const spreadsheets = new Map();

  class FakeRange {
    constructor(sheet, row, col, numRows, numCols) {
      this._sh = sheet;
      this._r = row; this._c = col;
      this._nr = numRows; this._nc = numCols;
    }
    setNumberFormat() { return this; }
    setValues(values) {
      this._sh._ensure(this._r + this._nr - 1, this._c + this._nc - 1);
      for (let i = 0; i < this._nr; i++) {
        for (let j = 0; j < this._nc; j++) {
          this._sh._grid[this._r - 1 + i][this._c - 1 + j] = values[i][j];
        }
      }
      return this;
    }
    getValues() {
      counters.rangeReads++;
      counters.cellsRead += this._nr * this._nc;
      this._sh._ensure(this._r + this._nr - 1, this._c + this._nc - 1);
      const out = [];
      for (let i = 0; i < this._nr; i++) {
        out.push(this._sh._grid[this._r - 1 + i].slice(this._c - 1, this._c - 1 + this._nc));
      }
      return out;
    }
    clearContent() {
      this._sh._ensure(this._r + this._nr - 1, this._c + this._nc - 1);
      for (let i = 0; i < this._nr; i++) {
        for (let j = 0; j < this._nc; j++) {
          this._sh._grid[this._r - 1 + i][this._c - 1 + j] = "";
        }
      }
      return this;
    }
  }

  class FakeSheet {
    constructor(name) {
      this._name = name;
      this._grid = [];
      this._maxCols = 26;
      this._ensure(100, 26);
    }
    _ensure(rows, cols) {
      if (cols > this._maxCols) this._maxCols = cols;
      for (const row of this._grid) {
        while (row.length < this._maxCols) row.push("");
      }
      while (this._grid.length < rows) {
        this._grid.push(new Array(this._maxCols).fill(""));
      }
    }
    getName() { return this._name; }
    getRange(row, col, numRows, numCols) {
      return new FakeRange(this, row, col, numRows ?? 1, numCols ?? 1);
    }
    getMaxRows() { return this._grid.length; }
    getMaxColumns() { return this._maxCols; }
    getLastRow() {
      for (let i = this._grid.length - 1; i >= 0; i--) {
        if (this._grid[i].some((v) => v !== "" && v !== null && v !== undefined)) {
          return i + 1;
        }
      }
      return 0;
    }
    getLastColumn() {
      let last = 0;
      for (const row of this._grid) {
        for (let j = row.length - 1; j >= last; j--) {
          if (row[j] !== "" && row[j] !== null && row[j] !== undefined) {
            last = j + 1;
            break;
          }
        }
      }
      return last;
    }
    // Reclaiming the grid a shrunken tab left allocated (sheetsDb.trimSurplusRows). Real
    // Sheets prices getMaxRows() whether the rows hold anything or not, so deleting them is
    // the only thing that moves the cell count.
    deleteRows(rowPosition, howMany) {
      this._grid.splice(rowPosition - 1, howMany);
      return this;
    }
    setFrozenRows() { return this; }
  }

  class FakeSpreadsheet {
    constructor(name) {
      this._id = `ss-${++ssSeq}`;
      this._name = name;
      this._sheets = [new FakeSheet("Sheet1")];
      spreadsheets.set(this._id, this);
    }
    getId() { return this._id; }
    getName() { return this._name; }
    setSpreadsheetTimeZone() { return this; }
    getSheetByName(name) {
      return this._sheets.find((s) => s._name === name) || null;
    }
    insertSheet(name) {
      const sh = new FakeSheet(name);
      this._sheets.push(sh);
      return sh;
    }
    getSheets() { return this._sheets.slice(); }
    deleteSheet(sh) {
      this._sheets = this._sheets.filter((s) => s !== sh);
    }
  }

  window.SpreadsheetApp = {
    create: (name) => new FakeSpreadsheet(name),
    openById: (id) => {
      const ss = spreadsheets.get(id);
      if (!ss) throw new Error(`No spreadsheet ${id}`);
      return ss;
    },
  };

  // ------------------------------------------------------------------- ScriptApp
  const triggers = [];
  let triggerSeq = 0;
  window.ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t) => {
      const i = triggers.indexOf(t);
      if (i >= 0) triggers.splice(i, 1);
    },
    newTrigger: (handler) => {
      const builder = {
        timeBased: () => builder,
        everyDays: () => builder,
        atHour: () => builder,
        after: () => builder,
        create: () => {
          const trigger = {
            getHandlerFunction: () => handler,
            getUniqueId: () => `trigger-${++triggerSeq}`,
          };
          triggers.push(trigger);
          // Both names on purpose: gas_ai spills a long live sync onto trigger_continueSync
          // (syncJobs.CONTINUE_HANDLER), and without firing it a real sync stops at the first
          // budget expiry and never resumes — looking exactly like a hang.
          if (handler === "trigger_continueScan" || handler === "trigger_continueSync") {
            setTimeout(() => {
              try { window.Server.jobs.continueJob(); }
              catch (e) { console.error("continueJob failed:", e); }
            }, 100);
          }
          return trigger;
        },
      };
      return builder;
    },
  };

  // ----------------------------------------------------------------- UrlFetchApp
  // Forwarded to the dev server (/_fetch), which holds the credentials and does the real
  // call — the browser cannot reach api.wiz.io itself (CORS), and the secrets are kept out
  // of the page: what travels from here is a placeholder the proxy substitutes.
  //
  // Synchronous XHR, deliberately. UrlFetchApp blocks in GAS and every caller is written
  // for that, so the alternative is not "async here" but "rewrite the server". The cost is
  // a frozen tab for the duration of a sync, which is what a GAS execution is anyway.
  window.UrlFetchApp = {
    fetch: (url, params) => {
      const p = params || {};
      const method = String(p.method || "get").toUpperCase();
      const contentType = p.contentType || null;
      let payload = p.payload;
      if (payload != null && typeof payload !== "string") {
        if (payload instanceof FakeBlob) payload = payload.getDataAsString();
        else if (contentType && contentType.indexOf("json") >= 0) payload = JSON.stringify(payload);
        // GAS form-encodes an object payload when the content type is not JSON; the token
        // request depends on that, so reproduce it rather than posting [object Object].
        else payload = new URLSearchParams(payload).toString();
      }
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/_fetch", false);
      xhr.setRequestHeader("content-type", "application/json");
      xhr.send(JSON.stringify({ url, method, contentType, headers: p.headers || {}, payload }));
      if (xhr.status !== 200) {
        throw new Error(`dev fetch proxy unreachable (HTTP ${xhr.status}) for ${url}`);
      }
      const res = JSON.parse(xhr.responseText);
      // A proxy refusal is not a tenant answer, so it throws instead of arriving as a
      // status code the app would report as "Wiz said no".
      if (res.error) throw new Error(`dev fetch proxy: ${res.error}`);
      if (!p.muteHttpExceptions && res.status >= 400) {
        throw new Error(`Request failed for ${url} returned code ${res.status}.`);
      }
      const headers = res.headers || {};
      return {
        getResponseCode: () => res.status,
        getContentText: () => res.body,
        getAllHeaders: () => headers,
        getHeaders: () => headers,
        getBlob: () =>
          new FakeBlob(res.body, headers["content-type"] || "application/octet-stream", "response"),
      };
    },
  };

  // ------------------------------------------------------------------- __gasFakes
  //
  // Save and reinstate every mutable thing the fakes above hold, so a test can get back to
  // a known state without rebuilding the world.
  //
  // The alternative, and what the suite used to do, was `vi.resetModules()` plus a re-import
  // of the server graph plus a fresh dry-run sync before EVERY test — half a megabyte of
  // TypeScript re-executed and a whole sample landscape regenerated to undo a handful of
  // row writes. This turns that into a copy of the grids.
  //
  // Object IDENTITY is preserved on purpose: `restore` writes back into the same FakeSheet,
  // FakeFolder and FakeFile instances rather than building new ones, so a handle something
  // memoized before the snapshot still refers to the live object afterwards. Instances
  // created after the snapshot are dropped from the id maps, which is what makes a restore
  // an undo rather than a merge.
  //
  // It lives here, with the fakes, rather than in a test-only file: these are the closures
  // that own the state, and a second copy of this knowledge would be one more thing to keep
  // in step.

  const snapshotSheet = (sh) => ({
    sh, name: sh._name, maxCols: sh._maxCols, grid: sh._grid.map((r) => r.slice()),
  });
  const restoreSheet = (s) => {
    s.sh._name = s.name;
    s.sh._maxCols = s.maxCols;
    // Copied again on the way out, so one snapshot can be restored any number of times.
    s.sh._grid = s.grid.map((r) => r.slice());
  };

  window.__gasFakes = {
    /** Service calls made since the last resetCounters(). See `counters` above. */
    counters() { return { ...counters }; },
    resetCounters() {
      for (const k of Object.keys(counters)) counters[k] = 0;
    },

    snapshot() {
      return {
        props: new Map(props),
        cache: new Map(cache),
        triggers: triggers.slice(),
        triggerSeq,
        ssSeq,
        driveSeq,
        spreadsheets: [...spreadsheets].map(([id, ss]) => ({
          id, ss, sheets: ss._sheets.map(snapshotSheet),
        })),
        driveFolders: [...driveFolders].map(([id, f]) => ({
          id, f, name: f._name, trashed: f._trashed,
          folders: f._folders.slice(), files: f._files.slice(),
        })),
        driveFiles: [...driveFiles].map(([id, f]) => ({
          id, f, blob: f._blob, parent: f._parent, trashed: f._trashed,
        })),
      };
    },

    restore(snap) {
      props.clear();
      for (const [k, v] of snap.props) props.set(k, v);
      cache.clear();
      for (const [k, v] of snap.cache) cache.set(k, v);

      triggers.length = 0;
      triggers.push(...snap.triggers);
      triggerSeq = snap.triggerSeq;
      ssSeq = snap.ssSeq;
      driveSeq = snap.driveSeq;

      spreadsheets.clear();
      for (const e of snap.spreadsheets) {
        e.ss._sheets = e.sheets.map((s) => s.sh);
        e.sheets.forEach(restoreSheet);
        spreadsheets.set(e.id, e.ss);
      }

      driveFolders.clear();
      for (const e of snap.driveFolders) {
        e.f._name = e.name;
        e.f._trashed = e.trashed;
        e.f._folders = e.folders.slice();
        e.f._files = e.files.slice();
        driveFolders.set(e.id, e.f);
      }

      driveFiles.clear();
      for (const e of snap.driveFiles) {
        e.f._blob = e.blob;
        e.f._parent = e.parent;
        e.f._trashed = e.trashed;
        driveFiles.set(e.id, e.f);
      }
    },
  };
})();
