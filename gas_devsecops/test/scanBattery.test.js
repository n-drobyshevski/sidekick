// The battery, with the storage faked and everything else real.
//
// `sheetsDb` is replaced by an in-memory grid that projects rows onto the DECLARED headers,
// exactly as a sheet does — so `ledgerStore`, `settingsStore`, `jobsStore` and `sync` all run
// their real code against it, and so does `reconcile`. That matters: the failures under test
// here are not "an exception was raised", they are "N findings resolved that were never
// fixed", and only the real reconciler can answer that.
//
// `archiveStore` and `wizClient` are faked at the boundary — one is Drive, the other is the
// network. Everything between them is the shipped code.
//
// EVERY MUTATION BELOW WAS RUN, and the numbers in the comments are measured, not estimated.
// One of them is worth stating up front: the two guards that protect the population — commit
// the scan row LAST, and refuse a page count that disagrees with the checkpoint — turned out
// to be INDEPENDENT. The first attempt at the commit-last mutation was defeated by the page
// count check instead, which is how that was found; it had to be made faithful (refreshing
// the job row before committing) before it isolated the rule it was aimed at.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_SCANS } from "../dev/sampleData.dev";

/* --------------------------------------------------------------- the fake sheet */

const sheets = vi.hoisted(() => ({ tabs: {}, headers: {} }));

vi.mock("../src/server/sheetsDb", async () => {
  const actual = await vi.importActual("../src/server/sheetsDb");
  sheets.headers = actual.TAB_HEADERS;
  const rows = (tab) => (sheets.tabs[tab] ??= []);
  const hdr = (tab) => actual.TAB_HEADERS[tab] ?? [];
  // toCell / fromCell: null and undefined become the empty cell, an empty cell reads null.
  const project = (tab, r) => hdr(tab).map((h) => (r[h] === null || r[h] === undefined ? "" : r[h]));
  const unproject = (tab, cells) => Object.fromEntries(
    hdr(tab).map((h, i) => [h, cells[i] === "" || cells[i] === undefined ? null : cells[i]]),
  );
  return {
    ...actual,
    ensureTabs: () => {},
    dataRowCount: (tab) => rows(tab).length,
    readAll: (tab) => rows(tab).map((c) => unproject(tab, c)),
    readTail: (tab, n) => rows(tab).slice(-Math.max(1, n)).map((c) => unproject(tab, c)),
    appendRows: (tab, rs) => { for (const r of rs) rows(tab).push(project(tab, r)); },
    overwrite: (tab, rs) => { sheets.tabs[tab] = rs.map((r) => project(tab, r)); },
    updateWhere: (tab, key, value, patch) => {
      const i = rows(tab).findIndex((c) => unproject(tab, c)[key] === value);
      if (i < 0) return false;
      rows(tab)[i] = project(tab, { ...unproject(tab, rows(tab)[i]), ...patch });
      return true;
    },
  };
});

const scansTab = () => (sheets.tabs.scans ?? []).map((cells) => Object.fromEntries(
  sheets.headers.scans.map((h, i) => [h, cells[i]]),
));
const ledgerRowCount = () => (sheets.tabs.finding_ledger ?? []).length;
const resolvedInLedger = () => {
  const hs = sheets.headers.finding_ledger;
  const si = hs.indexOf("status");
  return (sheets.tabs.finding_ledger ?? []).filter((c) => c[si] === "RESOLVED").length;
};

/* ------------------------------------------------------------- the fake archive */

const drive = vi.hoisted(() => ({ pages: {}, journals: {}, trashed: [], dropPage: null }));
const pageKey = (sync, step, page) => `${sync}|${step}|${page}`;

vi.mock("../src/server/archiveStore", () => ({
  syncFolder: (syncId) => ({ getId: () => `folder-${syncId}` }),
  writeSyncPage: (syncId, step, page, payload) => {
    // `dropPage` models the file that is written and then cannot be read back — a Drive
    // hiccup, a truncated blob. The checkpoint still counts it; the disk no longer has it.
    if (drive.dropPage === page) return `file-${syncId}-${step}-${page}`;
    drive.pages[pageKey(syncId, step, page)] = payload;
    return `file-${syncId}-${step}-${page}`;
  },
  // The REAL refusals, reimplemented at the fake's level: a page count that disagrees with
  // the checkpoint is a refusal, not a shorter list. `test/archiveStore.test.js` holds the
  // shipped implementation of the same two rules.
  readSyncStepPages: (syncId, step, expected) => {
    const found = Object.keys(drive.pages).filter((k) => k.startsWith(`${syncId}|${step}|`));
    if (found.length !== expected) {
      throw new Error(
        `Sync ${syncId} step ${step} recorded ${expected} page(s) but ${found.length} are on disk.`,
      );
    }
    return found
      .sort((a, b) => Number(a.split("|")[2]) - Number(b.split("|")[2]))
      .map((k) => drive.pages[k]);
  },
  syncStepPageCount: (syncId, step) =>
    Object.keys(drive.pages).filter((k) => k.startsWith(`${syncId}|${step}|`)).length,
  trashSyncStepPages: (syncId, step) => {
    for (const k of Object.keys(drive.pages)) {
      if (k.startsWith(`${syncId}|${step}|`)) delete drive.pages[k];
    }
  },
  writeGzJson: (_folder, name, payload) => {
    drive.journals[name] = payload;
    return { getId: () => `journal-${name}` };
  },
  readGzJsonFile: (id) => drive.journals[String(id).replace(/^journal-/, "")] ?? null,
  trashFile: (id) => { drive.trashed.push(id); },
}));

/* -------------------------------------------------------------- the fake tenant */

const tenant = vi.hoisted(() => ({ pages: {}, calls: [], failAt: null, truncate: false }));

vi.mock("../src/server/wizClient", async () => {
  const queries = await vi.importActual("../src/server/wizQueries");
  return {
    ...queries,
    MAX_PAGES: 8, // small, so truncation is reachable without 1000 fake pages
    fetchPage: (scope, opts) => {
      const pages = tenant.pages[scope] ?? [];
      const index = opts.cursor ? Number(opts.cursor.split(":")[1]) : 0;
      tenant.calls.push({ scope, cursor: opts.cursor, severities: opts.severities });
      clock.now += clock.perPageMs;
      if (tenant.failAt && tenant.failAt.scope === scope && tenant.failAt.page === index) {
        throw new Error("the tenant refused this page");
      }
      const nodes = pages[index] ?? [];
      const more = tenant.truncate || index + 1 < pages.length;
      return {
        nodes,
        hasNextPage: more,
        endCursor: more ? `${scope}:${index + 1}` : null,
        totalCount: pages.reduce((n, p) => n + p.length, 0),
        pageSize: 500,
        partialErrors: [],
      };
    },
  };
});

/* ---------------------------------------------------------------- GAS globals */

const props = vi.hoisted(() => ({}));
const triggers = vi.hoisted(() => ({ armed: [] }));
// Time is explicit rather than real: `Date.now` returns `clock.now`, and every page fetched
// advances it by `clock.perPageMs`. That makes "the budget ran out mid-walk" a property of
// the fixture instead of a race, and it is why these specs are deterministic.
const clock = vi.hoisted(() => ({ now: Date.parse("2026-09-01T09:00:00Z"), perPageMs: 0 }));

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k) => props[k] ?? null,
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }),
});
vi.stubGlobal("CacheService", {
  getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }),
});
vi.stubGlobal("LockService", {
  getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
});
vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => triggers.armed.slice(),
  deleteTrigger: (t) => {
    const i = triggers.armed.indexOf(t);
    if (i >= 0) triggers.armed.splice(i, 1);
  },
  newTrigger: (handler) => {
    const b = {
      timeBased: () => b,
      after: () => b,
      create: () => {
        const t = { getHandlerFunction: () => handler };
        triggers.armed.push(t);
        return t;
      },
    };
    return b;
  },
});

const load = () => import("../src/server/scanJobs");

/** Split one scope's sample nodes into `n` pages, so paging is real. */
function paginate(nodes, n) {
  const size = Math.ceil(nodes.length / n) || 1;
  const out = [];
  for (let i = 0; i < nodes.length; i += size) out.push(nodes.slice(i, i + size));
  return out.length ? out : [[]];
}

function seedSettings(scopes, fetchSeverities) {
  sheets.tabs.settings = [];
  const put = (k, v) => sheets.tabs.settings.push([k, JSON.stringify(v)]);
  put("scopes", scopes);
  put("fetchSeverities", fetchSeverities);
}

beforeEach(() => {
  sheets.tabs = {};
  drive.pages = {}; drive.journals = {}; drive.trashed = []; drive.dropPage = null;
  tenant.pages = {}; tenant.calls = []; tenant.failAt = null; tenant.truncate = false;
  triggers.armed.length = 0;
  for (const k of Object.keys(props)) delete props[k];
  props.WIZ_API_URL = "https://api.test/graphql";
  props.WIZ_CLIENT_ID = "cid";
  props.WIZ_CLIENT_SECRET = "csecret";
  clock.now = Date.parse("2026-09-01T09:00:00Z");
  clock.perPageMs = 0;
  vi.spyOn(Date, "now").mockImplementation(() => clock.now);
  vi.resetModules();
});

afterEach(() => { vi.restoreAllMocks(); });

/* --------------------------------------------------------------------- specs */

describe("a scan that does not finish writes NO scan row", () => {
  it("leaves the scope uncommitted when the tenant refuses a page mid-walk", async () => {
    // THE ONE THE FILE EXISTS FOR. A scan row is a claim that the scope was covered, and
    // `reconcile` resolves by ABSENCE — so a row over half a walk does not raise an error,
    // it publishes a remediation programme that never happened.
    seedSettings(["sca"], { sca: [] });
    tenant.pages.sca = paginate(SAMPLE_SCANS[0].nodes.sca, 3);
    tenant.failAt = { scope: "sca", page: 1 };

    const { startScan } = await load();
    expect(() => startScan()).toThrow(/refused this page/);

    expect(scansTab()).toEqual([]);
    expect(ledgerRowCount()).toBe(0);

    // MEASURED. Commit the in-flight step on the failure path instead — the "save what we
    // got" any reasonable person writes — and this scan appends a row reading `total: 32`
    // against a true population of 94. Sixty-two findings never enter the ledger at all, so
    // the next scan meets them as NEW with a first_seen a day late, and their real age is
    // gone. The row itself looks like a successful scan.
  });

  it("records the failure against the scope that failed", async () => {
    seedSettings(["sca"], { sca: [] });
    tenant.pages.sca = paginate(SAMPLE_SCANS[0].nodes.sca, 2);
    tenant.failAt = { scope: "sca", page: 1 };

    const { startScan, jobStatus } = await load();
    expect(() => startScan()).toThrow();
    const job = jobStatus();
    expect(job).toBeNull(); // terminal, so it is no longer the active job
    const jobs = sheets.tabs.jobs.map((c) => Object.fromEntries(
      sheets.headers.jobs.map((h, i) => [h, c[i]]),
    ));
    expect(jobs[0].phase).toBe("FAILED");
    expect(String(jobs[0].error)).toContain("[sca]");
  });

  it("refuses a truncated walk instead of recording it as coverage", async () => {
    // MAX_PAGES exists to stop a non-terminating cursor, and the sibling BREAKS there and
    // persists as though the walk had finished. On a register that resolves by absence that
    // turns a runaway cursor into a mass remediation, so here it fails the step.
    seedSettings(["sast"], { sast: [] });
    tenant.pages.sast = paginate(SAMPLE_SCANS[0].nodes.sast, 3);
    tenant.truncate = true; // hasNextPage is never false

    const { startScan } = await load();
    expect(() => startScan()).toThrow(/Refusing to record a partial walk/);
    expect(scansTab()).toEqual([]);
  });

  it("refuses when the pages on disk disagree with the checkpoint", async () => {
    // THE QUIETEST FAILURE IN THE CHAIN, and the only spec here that needs two scans to
    // show it. One page that writes and will not read back is ~half a population absent
    // from the observation set — and absence IS the resolution signal, so every finding it
    // held closes, dated to this scan, counted as a fix, indistinguishable from real ones.
    //
    // So: scan the scope completely, then scan it again with a page missing.
    seedSettings(["sca"], { sca: [] });
    tenant.pages.sca = paginate(SAMPLE_SCANS[0].nodes.sca, 2);

    const { startScan } = await load();
    startScan();
    const afterFirst = { rows: scansTab().length, resolved: resolvedInLedger() };
    expect(afterFirst.rows).toBe(1);
    expect(afterFirst.resolved).toBe(0);

    // A day later. The clock has to move: a job id is minted from the timestamp, and
    // `runScan`'s idempotence gate would otherwise recognise the scan id and no-op — which
    // is correct behaviour and would have made this spec pass without testing anything.
    clock.now += 86_400_000;
    drive.dropPage = 2;
    expect(() => startScan()).toThrow(/but 1 are on disk/);

    // Nothing moved: no second scan row, and not one finding resolved.
    expect(scansTab()).toHaveLength(1);
    expect(resolvedInLedger()).toBe(0);

    // MEASURED. Let the reader skip the page it cannot read — the behaviour this repo
    // shipped until now — and the second scan commits normally with `resolved_count: 47`.
    // Forty-seven of ninety-four findings close, dated to that scan, counted as fixes.
    // Exactly the half the missing page held. Nothing anywhere reports an error, and the
    // MTTR page gets a very good week.
  });
});

describe("the budget", () => {
  it("checkpoints, arms a continuation, and commits nothing", async () => {
    seedSettings(["sca"], { sca: [] });
    tenant.pages.sca = paginate(SAMPLE_SCANS[0].nodes.sca, 4);

    // 20s a page against a 45s first-hop fetch budget: three pages, then a yield.
    clock.perPageMs = 20_000;

    const { startScan } = await load();
    startScan();

    expect(scansTab()).toEqual([]);
    expect(triggers.armed.map((t) => t.getHandlerFunction())).toContain("trigger_continueScan");
    const jobs = sheets.tabs.jobs.map((c) => Object.fromEntries(
      sheets.headers.jobs.map((h, i) => [h, c[i]]),
    ));
    expect(jobs[0].phase).toBe("FETCHING");
    expect(Number(jobs[0].page)).toBeGreaterThan(0);
    expect(String(jobs[0].cursor)).toContain("sca:");
  });

  it("resumes from the stored cursor and commits exactly one row", async () => {
    seedSettings(["sca"], { sca: [] });
    tenant.pages.sca = paginate(SAMPLE_SCANS[0].nodes.sca, 4);

    clock.perPageMs = 20_000;
    const { startScan, continueJob } = await load();
    startScan();
    clock.perPageMs = 0; // the continuation hop has 4.5 minutes and four pages to go

    const pagesBefore = Object.keys(drive.pages).length;
    continueJob();

    const rows = scansTab();
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe("sca");
    expect(Number(rows[0].total)).toBe(SAMPLE_SCANS[0].nodes.sca.length);
    // It carried on rather than starting over: the pages already on disk were not re-walked
    // from page 1, which is what a lost cursor looks like.
    expect(Object.keys(drive.pages).length).toBeGreaterThan(pagesBefore);
    expect(tenant.calls.filter((c) => c.cursor === null)).toHaveLength(1);
  });
});

describe("three scopes, three clocks", () => {
  it("commits one row per scope, each with its own scan id", async () => {
    seedSettings(["sca", "sast", "secrets"], { sca: [], sast: [], secrets: [] });
    for (const s of ["sca", "sast", "secrets"]) {
      tenant.pages[s] = paginate(SAMPLE_SCANS[0].nodes[s], 2);
    }
    const { startScan } = await load();
    startScan();

    const rows = scansTab();
    expect(rows.map((r) => r.scope)).toEqual(["sca", "sast", "secrets"]);
    expect(new Set(rows.map((r) => r.scan_id)).size).toBe(3);
    expect(rows.every((r) => r.mode === "live")).toBe(true);
    expect(rows.every((r) => String(r.raw_ref).startsWith("folder-"))).toBe(true);
  });

  it("keeps the rows of scopes that DID finish when a later one fails", async () => {
    // A job is three walks, not one. The first two covered their scopes and their rows are
    // true; throwing them away because the third failed would lose real coverage — and
    // leaving a row for the third would invent some.
    seedSettings(["sca", "sast", "secrets"], { sca: [], sast: [], secrets: [] });
    for (const s of ["sca", "sast", "secrets"]) {
      tenant.pages[s] = paginate(SAMPLE_SCANS[0].nodes[s], 2);
    }
    tenant.failAt = { scope: "secrets", page: 0 };

    const { startScan } = await load();
    expect(() => startScan()).toThrow();
    expect(scansTab().map((r) => r.scope)).toEqual(["sca", "sast"]);
  });
});

describe("the gate a scan applied is the gate it recorded", () => {
  it("does not pick up a settings change made mid-walk", async () => {
    // The guard is that `params_json` is frozen at job start. Without it a resumed hop reads
    // today's settings, so pages fetched under CRITICAL,HIGH get stamped with CRITICAL — and
    // the disappearance guard then believes HIGH was covered by a scan that never asked.
    seedSettings(["sca"], { sca: ["CRITICAL", "HIGH"] });
    tenant.pages.sca = paginate(SAMPLE_SCANS[0].nodes.sca, 4);

    clock.perPageMs = 20_000;
    const { startScan, continueJob } = await load();
    startScan();
    clock.perPageMs = 0;

    // An operator narrows the gate while the walk is parked.
    seedSettings(["sca"], { sca: ["CRITICAL"] });
    const settings = await import("../src/server/settingsStore");
    settings.resetSettingsMemo(); // a resumed hop is a fresh execution, so its memo is cold

    continueJob();

    // Both halves matter: the row records what was applied, AND the resumed fetch asked for
    // it. A test that checked only the label would pass while the wire had changed.
    expect(scansTab()[0].severities).toBe("CRITICAL,HIGH");
    const resumed = tenant.calls.filter((c) => c.cursor !== null);
    expect(resumed.length).toBeGreaterThan(0);
    for (const c of resumed) expect(c.severities).toEqual(["CRITICAL", "HIGH"]);
  });
});

describe("starting and stopping", () => {
  it("refuses to start without credentials rather than inventing a sample scan", async () => {
    // Both siblings quietly dry-run here. `runSampleSync` already owns that path, so a second
    // source behind this button means pressing Run scan and getting invented figures back
    // under a real-looking scan row.
    delete props.WIZ_CLIENT_ID;
    delete props.WIZ_CLIENT_SECRET;
    seedSettings(["sca"], { sca: [] });
    const { startScan } = await load();
    expect(() => startScan()).toThrow(/No Wiz credentials/);
    expect(scansTab()).toEqual([]);
  });

  it("stops a running walk between pages, committing nothing", async () => {
    seedSettings(["sca"], { sca: [] });
    tenant.pages.sca = paginate(SAMPLE_SCANS[0].nodes.sca, 4);
    clock.perPageMs = 20_000;
    const { startScan, cancelScan, jobStatus } = await load();
    const started = startScan();

    const res = cancelScan(started.jobId);
    expect(res.stopped).toBe(true);
    expect(jobStatus()).toBeNull();
    expect(scansTab()).toEqual([]);
    // The abandoned step's pages go; nothing referenced them.
    expect(Object.keys(drive.pages)).toEqual([]);
  });

  it("reports the job already running rather than starting a second one", async () => {
    seedSettings(["sca"], { sca: [] });
    tenant.pages.sca = paginate(SAMPLE_SCANS[0].nodes.sca, 4);
    clock.perPageMs = 20_000;
    const { startScan } = await load();
    const first = startScan();

    const second = startScan();
    expect(second.jobId).toBe(first.jobId);
    expect(second.message).toMatch(/already in progress/);
    expect(sheets.tabs.jobs).toHaveLength(1);
  });
});

describe("what the progress poll may see", () => {
  it("never ships the cursor, the gate or the project id", async () => {
    // Polled every three seconds for the length of a scan. The cursor is a production
    // tenant's pagination handle; params_json carries the severity gate and project scope.
    seedSettings(["sca"], { sca: [] });
    tenant.pages.sca = paginate(SAMPLE_SCANS[0].nodes.sca, 4);
    clock.perPageMs = 20_000;
    const { startScan, jobStatus } = await load();
    startScan();

    const status = jobStatus();
    expect(status).not.toBeNull();
    expect(Object.keys(status).sort()).toEqual([
      "error", "findings_so_far", "job_id", "page", "phase", "scope", "stale",
      "started_at", "step", "steps_total", "total_count", "updated_at",
    ]);
    expect(JSON.stringify(status)).not.toContain("sca:");
  });
});
