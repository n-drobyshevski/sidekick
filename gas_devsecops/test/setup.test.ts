// setup()'s trigger battery: one daily sync at the saved hour, three staggered warm passes.
//
// PORTED FROM gas/test/setup.test.ts, adapted to this register's handler names
// (trigger_dailySync / trigger_warmReadModels — scanJobs.ts's dailySync/watchdogSync/
// continueJob live beside a DIFFERENT handler, trigger_continueSync / trigger_watchdogSync,
// installed transiently by scanJobs.ts itself, not by setup()) and to this file's own
// WARM_READY_BY_HOURS (still [9, 13, 17] — same working-day rationale gas/ used).
//
// TWO THINGS ARE PINNED HERE AND THEY FAIL DIFFERENTLY, same split gas/'s copy of this file
// documents. The first is the builder chain: a ClockTriggerBuilder method that does not exist
// throws at setup() time, which is why the stub below records the chain rather than accepting
// anything and the specs assert on the hours/minutes/tz/days that reached it. The second is
// convergence: a ClockTrigger exposes its handler function and NOTHING ELSE, so
// `getProjectTriggers()` alone cannot tell a correctly-scheduled set from a stale one — that is
// what `PROP_KEYS.warmTriggerSchedule` is for, and "a second setup() run installs nothing new"
// is the property this file exists to prove, not just assert once.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Built { handler: string; hour?: number; nearMinute?: number; tz?: string; days?: number }

const props: Record<string, string> = {};
const built: Built[] = [];
const deleted: string[] = [];
let installed: string[] = [];

vi.mock("../src/server/sheetsDb", () => ({ ensureTabs: () => {} }));
// setup() installs the daily trigger at the SAVED hour. The settings tab is the store's
// business, not this file's — the stub hands back whatever hour a spec sets.
const settings = vi.hoisted(() => ({ syncSchedule: 5 }));
vi.mock("../src/server/settingsStore", () => ({
  loadSettings: () => ({ syncSchedule: settings.syncSchedule }),
}));

vi.stubGlobal("SpreadsheetApp", {
  create: () => ({ getId: () => "ss-1" }),
  openById: (id: string) => ({ getId: () => id }),
});
vi.stubGlobal("DriveApp", { createFolder: () => ({ getId: () => "folder-1" }) });
vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => props[k] ?? null,
    setProperty: (k: string, v: string) => { props[k] = v; },
    deleteProperty: (k: string) => { delete props[k]; },
  }),
});
vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => installed.map((h) => ({ getHandlerFunction: () => h })),
  deleteTrigger: (t: { getHandlerFunction: () => string }) => {
    const h = t.getHandlerFunction();
    deleted.push(h);
    const i = installed.indexOf(h);
    if (i >= 0) installed.splice(i, 1);
  },
  newTrigger: (handler: string) => {
    const rec: Built = { handler };
    const b = {
      timeBased: () => b,
      everyDays: (n: number) => { rec.days = n; return b; },
      atHour: (h: number) => { rec.hour = h; return b; },
      nearMinute: (m: number) => { rec.nearMinute = m; return b; },
      inTimezone: (tz: string) => { rec.tz = tz; return b; },
      create: () => { built.push(rec); installed.push(handler); return rec; },
    };
    return b;
  },
});

// setup() also seeds the access allowlist, which reads the effective user — nothing else in
// this file touches Session, but without the stub every spec dies with "Session is not
// defined" rather than with an assertion, which is how a missing GAS global always presents.
vi.stubGlobal("Session", {
  getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }),
});

const DAILY = "trigger_dailySync";
const WARM = "trigger_warmReadModels";
const warmBuilds = () => built.filter((b) => b.handler === WARM);
const dailyBuilds = () => built.filter((b) => b.handler === DAILY);

async function load() {
  return import("../src/server/setup");
}

beforeEach(() => {
  for (const k of Object.keys(props)) delete props[k];
  props["LEDGER_SPREADSHEET_ID"] = "ss-1";
  props["ARCHIVE_FOLDER_ID"] = "folder-1";
  props["ALLOWED_USERS"] = "owner@example.com"; // pre-seeded: not this file's concern
  built.length = 0;
  deleted.length = 0;
  installed = [];
  settings.syncSchedule = 5;
  vi.resetModules();
});

describe("a first setup() installs exactly the standing battery", () => {
  it("installs 4 triggers total: 1 daily sync + 3 warm passes", async () => {
    const { setup } = await load();
    setup();
    expect(installed).toHaveLength(4);
    expect(dailyBuilds()).toHaveLength(1);
    expect(warmBuilds()).toHaveLength(3);
  });

  it("installs the daily sync under trigger_dailySync, once a day", async () => {
    const { setup } = await load();
    setup();
    expect(dailyBuilds()).toHaveLength(1);
    expect(dailyBuilds()[0].days).toBe(1);
  });

  it("installs the warm passes under trigger_warmReadModels, once a day each", async () => {
    const { setup } = await load();
    setup();
    for (const b of warmBuilds()) expect(b.days).toBe(1);
  });

  it("puts the three warm triggers at three DISTINCT hours", async () => {
    const { setup } = await load();
    setup();
    const hours = warmBuilds().map((b) => b.hour);
    expect(new Set(hours).size).toBe(hours.length);
    expect(hours).toHaveLength(3);
  });

  it("fires the warm passes an hour early, narrowed with nearMinute", async () => {
    const { setup } = await load();
    setup();
    // WARM_READY_BY_HOURS is [9, 13, 17]; each trigger fires the hour before.
    expect(warmBuilds().map((b) => b.hour)).toEqual([8, 12, 16]);
    for (const b of warmBuilds()) expect(b.nearMinute).toBe(30);
  });

  it("pins the warm schedule to Europe/Paris regardless of the manifest", async () => {
    const { setup } = await load();
    setup();
    for (const b of warmBuilds()) expect(b.tz).toBe("Europe/Paris");
  });

  it("records the installed schedule as a signature after every trigger is created", async () => {
    const { setup, warmTriggerSchedule } = await load();
    setup();
    expect(props["WARM_TRIGGER_SCHEDULE"]).toBe(warmTriggerSchedule());
  });

  it("reports what it installed, not the stale 'none installed' note", async () => {
    const { setup } = await load();
    const report = setup();
    expect(report).not.toMatch(/none installed/i);
    expect(report).toMatch(/daily sync trigger: installed/i);
    expect(report).toMatch(/warm triggers: installed/i);
  });
});

describe("a second setup() on an unchanged signature adds nothing", () => {
  it("installs zero additional triggers", async () => {
    const { setup } = await load();
    setup();
    const countAfterFirst = installed.length;
    built.length = 0;
    deleted.length = 0;
    setup();
    expect(built).toEqual([]);
    expect(deleted).toEqual([]);
    expect(installed).toHaveLength(countAfterFirst);
    expect(installed).toHaveLength(4);
  });

  it("leaves the daily trigger alone across repeated runs", async () => {
    const { setup } = await load();
    setup();
    setup();
    setup();
    expect(dailyBuilds()).toHaveLength(1); // only ever built once, across all three calls
    expect(installed.filter((h) => h === DAILY)).toHaveLength(1);
  });
});

describe("changing the schedule reinstalls once, not additively", () => {
  it("rebuilds the warm set exactly once when the signature no longer matches", async () => {
    const { setup, warmTriggerSchedule } = await load();
    setup();
    built.length = 0;
    deleted.length = 0;
    // Simulate a stale deployment: same trigger COUNT, different recorded schedule. Count
    // alone cannot see this, which is the whole reason the signature is recorded.
    props["WARM_TRIGGER_SCHEDULE"] = "Europe/Paris|0,4,8@30";
    setup();
    expect(deleted).toHaveLength(3); // the old warm set, torn down whole
    expect(warmBuilds()).toHaveLength(3); // rebuilt, not appended to 6
    expect(installed.filter((h) => h === WARM)).toHaveLength(3);
    expect(installed).toHaveLength(4); // 1 daily + 3 warm, not 1 + 6
    expect(props["WARM_TRIGGER_SCHEDULE"]).toBe(warmTriggerSchedule());
  });

  it("rebuilds over a legacy trigger under the handler with no recorded signature", async () => {
    // A deployment from before this package carries a warm trigger under this handler with NO
    // WARM_TRIGGER_SCHEDULE property at all (the property is new). Nothing distinguishes it
    // from a correct one except the missing signature, which is exactly what should trigger a
    // rebuild rather than a silent "looks installed, leave it" skip.
    installed = [WARM];
    const { setup } = await load();
    setup();
    expect(deleted).toEqual([WARM]);
    expect(warmBuilds()).toHaveLength(3);
    expect(installed).toHaveLength(4);
  });

  it("does not touch the daily trigger while reconciling the warm set", async () => {
    installed = [DAILY, WARM];
    props["DAILY_SYNC_SCHEDULE"] = "Europe/Paris|5"; // the daily trigger is already current
    const { setup } = await load();
    setup();
    expect(deleted).toEqual([WARM]);
    expect(installed).toContain(DAILY);
    expect(dailyBuilds()).toHaveLength(0); // already installed, so never rebuilt
  });

  it("leaves the property stale if a create() fails part-way, so the next run retries", async () => {
    const real = (globalThis as { ScriptApp: { newTrigger: unknown } }).ScriptApp.newTrigger;
    let n = 0;
    (globalThis as { ScriptApp: { newTrigger: unknown } }).ScriptApp.newTrigger = (h: string) => {
      const b = (real as (h: string) => Record<string, (x?: unknown) => unknown>)(h);
      const create = b["create"];
      b["create"] = () => { if (h === WARM && ++n === 2) throw new Error("quota"); return create(); };
      return b;
    };
    try {
      const { setup } = await load();
      expect(() => setup()).toThrow(/quota/);
      expect(props["WARM_TRIGGER_SCHEDULE"]).toBeUndefined();
    } finally {
      (globalThis as { ScriptApp: { newTrigger: unknown } }).ScriptApp.newTrigger = real;
    }
  });
});

describe("the daily sync trigger follows Settings.syncSchedule", () => {
  // The daily trigger used to be deduplicated by handler name alone, so a changed hour could
  // never reach it. Like the warm set it now converges on a recorded signature
  // (`DAILY_SYNC_SCHEDULE`, `${tz}|${hour}`) — and the properties below are the warm set's:
  // fresh installs honour it, a legacy unsigned trigger is replaced exactly once, a second run
  // is a no-op, a moved hour reinstalls once rather than adding a second trigger.

  it("installs a fresh deployment at the saved hour, pinned to Europe/Paris", async () => {
    settings.syncSchedule = 14;
    const { setup, dailySyncSchedule } = await load();
    const report = setup();
    expect(dailyBuilds()).toEqual([{ handler: DAILY, days: 1, hour: 14, tz: "Europe/Paris" }]);
    expect(props["DAILY_SYNC_SCHEDULE"]).toBe(dailySyncSchedule(14));
    expect(props["DAILY_SYNC_SCHEDULE"]).toBe("Europe/Paris|14");
    expect(report).toMatch(/daily sync trigger: installed \(14:00 Europe\/Paris\)/i);
  });

  it("uses the same timezone the warm triggers are pinned to", async () => {
    const { setup, TRIGGER_TZ } = await load();
    setup();
    expect(dailyBuilds()[0].tz).toBe(TRIGGER_TZ);
    for (const b of warmBuilds()) expect(b.tz).toBe(TRIGGER_TZ);
  });

  it("replaces a legacy daily trigger with no recorded signature exactly once", async () => {
    // A deployment from before the signature: one daily trigger, no DAILY_SYNC_SCHEDULE. It may
    // well fire at the right hour, but nothing can tell — so it is rebuilt once, and the
    // property written then is what makes the next run leave it alone.
    installed = [DAILY];
    const { setup } = await load();
    const first = setup();
    expect(deleted.filter((h) => h === DAILY)).toEqual([DAILY]);
    expect(dailyBuilds()).toHaveLength(1);
    expect(installed.filter((h) => h === DAILY)).toHaveLength(1);
    expect(first).toMatch(/daily sync trigger: installed .*\(replaced 1\)/i);

    built.length = 0;
    deleted.length = 0;
    const second = setup();
    expect(dailyBuilds()).toEqual([]);
    expect(deleted).toEqual([]);
    expect(second).toMatch(/daily sync trigger: already installed/i);
  });

  it("a second setup() at an unchanged hour builds and deletes nothing", async () => {
    settings.syncSchedule = 7;
    const { setup } = await load();
    setup();
    built.length = 0;
    deleted.length = 0;
    setup();
    expect(built).toEqual([]);
    expect(deleted).toEqual([]);
    expect(installed.filter((h) => h === DAILY)).toHaveLength(1);
  });

  it("a changed hour reinstalls the daily trigger exactly once, and leaves the warm set", async () => {
    const { setup } = await load();
    setup();
    built.length = 0;
    deleted.length = 0;
    settings.syncSchedule = 22;
    setup();
    expect(deleted).toEqual([DAILY]);
    expect(dailyBuilds().map((b) => b.hour)).toEqual([22]);
    expect(warmBuilds()).toEqual([]);
    expect(installed.filter((h) => h === DAILY)).toHaveLength(1);
    expect(props["DAILY_SYNC_SCHEDULE"]).toBe("Europe/Paris|22");

    built.length = 0;
    deleted.length = 0;
    setup(); // and converged: the next run is a no-op again
    expect(built).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it("collapses duplicate daily triggers into one even when the signature matches", async () => {
    // Two triggers under the handler run the sync twice a day; a matching signature does not
    // make that correct, so the count is part of the no-op test.
    installed = [DAILY, DAILY];
    props["DAILY_SYNC_SCHEDULE"] = "Europe/Paris|5";
    const { reconcileDailySyncTrigger } = await load();
    reconcileDailySyncTrigger(5);
    expect(deleted).toEqual([DAILY, DAILY]);
    expect(installed.filter((h) => h === DAILY)).toHaveLength(1);
  });

  it("keeps the old trigger and leaves the signature unwritten when create() throws", async () => {
    const real = (globalThis as { ScriptApp: { newTrigger: unknown } }).ScriptApp.newTrigger;
    (globalThis as { ScriptApp: { newTrigger: unknown } }).ScriptApp.newTrigger = (h: string) => {
      const b = (real as (h: string) => Record<string, (x?: unknown) => unknown>)(h);
      b["create"] = () => { throw new Error("quota"); };
      return b;
    };
    try {
      installed = [DAILY];
      const { reconcileDailySyncTrigger } = await load();
      expect(() => reconcileDailySyncTrigger(9)).toThrow(/quota/);
      expect(props["DAILY_SYNC_SCHEDULE"]).toBeUndefined();
      // Created before the old one is deleted: a failed create leaves the register syncing at
      // the old hour, not not syncing at all.
      expect(deleted).toEqual([]);
      expect(installed).toEqual([DAILY]);
    } finally {
      (globalThis as { ScriptApp: { newTrigger: unknown } }).ScriptApp.newTrigger = real;
    }
  });
});
