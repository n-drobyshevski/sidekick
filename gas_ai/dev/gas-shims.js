// In-browser fakes of the GAS services the server bundle touches, for local UI/UX
// work (dev/serve.mjs). Everything is in-memory and resets on reload; dev/boot.js
// re-seeds deterministic dry-run data each load. Fidelity notes:
//   - Utilities.gzip/ungzip are identity transforms. That is safe end-to-end:
//     archiveStore.parseGzBlob sniffs the gzip magic bytes and falls back to
//     plain-text parsing, and serverCache only round-trips its own blobs.
//   - LockService always grants the lock (single-threaded page).
//   - ScriptApp triggers are recorded; a trigger_continueScan one-shot actually
//     fires via setTimeout so a (hypothetical) multi-hop scan still completes.

(function () {
  "use strict";

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
    sleep: () => {},
    getUuid: () =>
      (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
  };

  // ------------------------------------------------------------ PropertiesService
  const props = new Map();
  window.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (props.has(k) ? props.get(k) : null),
      setProperty: (k, v) => { props.set(k, String(v)); },
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
          if (handler === "trigger_continueScan") {
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
  window.UrlFetchApp = {
    fetch: () => {
      throw new Error("UrlFetchApp is unavailable in the local dev harness (dry-run only).");
    },
  };
})();
