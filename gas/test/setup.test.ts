// The warm-trigger schedule.
//
// TWO THINGS ARE PINNED HERE AND THEY FAIL DIFFERENTLY. The first is the builder chain: a
// ClockTriggerBuilder method that does not exist throws at setup() time, and because dev/boot.js
// runs setup() during boot, such a throw once took down the whole google.script.run shim and made
// every page render "Couldn't reach the server". So the stub below records the chain rather than
// accepting anything, and asserts on the hours and minutes that reached it.
//
// The second is convergence. A ClockTrigger exposes its handler function and NOTHING ELSE — no
// hour, no minute, no timezone — so `getProjectTriggers()` cannot tell a correctly-scheduled
// trigger from the single everyHours(4) trigger a deployment predating this change carries. The
// old "install only when none exist" check would therefore call that deployment done and leave it
// on the round-the-clock schedule forever. These specs pin the recorded-signature reconcile that
// replaces it, in both directions: it rebuilds when the schedule differs, and it stays silent
// when it does not.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Built { handler: string; hour?: number; nearMinute?: number; tz?: string; days?: number }

const props: Record<string, string> = {};
const built: Built[] = [];
const deleted: string[] = [];
let installed: string[] = [];

vi.mock("../src/server/archiveStore", () => ({ ensureFolders: () => {} }));
vi.mock("../src/server/sheetsDb", () => ({ ensureTabs: () => {} }));

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
  getProjectTriggers: () =>
    installed.map((h) => ({ getHandlerFunction: () => h })),
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

// setup() seeds the access allowlist, which reads the effective user. Nothing else in gas/
// touches Session, so this is the only place the stub has to exist for these specs — and
// without it every spec in this file dies with "Session is not defined" rather than with an
// assertion, which is how a missing GAS global always presents here.
let ownerAddress = "owner@example.com";
vi.stubGlobal("Session", {
  getActiveUser: () => ({ getEmail: () => ownerAddress }),
  getEffectiveUser: () => ({ getEmail: () => ownerAddress }),
});

const WARM = "trigger_warmReadModels";
const warmBuilds = () => built.filter((b) => b.handler === WARM);

async function load() {
  return import("../src/server/setup");
}

beforeEach(() => {
  for (const k of Object.keys(props)) delete props[k];
  props.LEDGER_SPREADSHEET_ID = "ss-1";
  props.ARCHIVE_FOLDER_ID = "folder-1";
  built.length = 0;
  deleted.length = 0;
  installed = [];
  ownerAddress = "owner@example.com";
  vi.resetModules();
});

// The allowlist guard fails closed: an unset ALLOWED_USERS admits only the owner. That is the
// right default and an INVISIBLE one, so setup() seeds it — the property being there, with a
// value, is what tells whoever inherits this deployment that a list exists to be widened.
describe("setup seeds the access allowlist without ever narrowing one", () => {
  it("seeds ALLOWED_USERS with the owner when the property is unset", async () => {
    const { setup } = await load();
    setup();
    expect(props.ALLOWED_USERS).toBe("owner@example.com");
  });

  it("leaves an existing list alone", async () => {
    // The bug this catches: a re-run of setup() (which the README asks for after several
    // schema changes) silently reverting everyone an admin has since added.
    props.ALLOWED_USERS = "a@example.com, b@example.com";
    const { setup } = await load();
    setup();
    expect(props.ALLOWED_USERS).toBe("a@example.com, b@example.com");
  });

  it("writes nothing when the owner address is unavailable", async () => {
    // An empty ALLOWED_USERS would read as a configured-but-empty list. It admits the owner
    // either way, but writing one turns "never configured" into "configured to admit nobody",
    // which is a worse thing to hand the next reader.
    ownerAddress = "";
    const { setup } = await load();
    setup();
    expect(props.ALLOWED_USERS).toBeUndefined();
  });
});

describe("the warm schedule fires an hour before the hours it serves", () => {
  // `atHour(9)` does not run at 09:00 — it runs somewhere between 09:00 and 10:00. A trigger
  // named for the hour it serves therefore hands the 09:00 arrival exactly the cold load the
  // warm exists to prevent. Naming the ready-by hours and firing an hour earlier is the whole
  // point of the derivation, so it is pinned as a relationship rather than as three literals.
  it("installs one trigger per configured hour, each one hour early", async () => {
    const { setup } = await load();
    setup();
    expect(warmBuilds().map((b) => b.hour)).toEqual([8, 12, 16]);
  });

  it("narrows the hour-wide window with nearMinute so the pass lands before the hour", async () => {
    // Without this every fire is a uniform draw across its hour, and the 08:xx one is as likely
    // to start at 08:59 — mid-pass at 09:00 — as at 08:01. nearMinute(30) bounds it to 08:15-08:45,
    // which leaves the 60-120s pass finished with margin.
    const { setup } = await load();
    setup();
    for (const b of warmBuilds()) expect(b.nearMinute).toBe(30);
  });

  it("pins the timezone rather than inheriting the manifest's", async () => {
    // `atHour` follows the script timezone by default, and a project re-created with `clasp
    // create` gets the CLI's default — which would move the schedule onto another continent's
    // working day while the client kept rendering Europe/Paris.
    const { setup } = await load();
    setup();
    for (const b of warmBuilds()) expect(b.tz).toBe("Europe/Paris");
  });

  it("uses everyDays, which atHour and nearMinute both require", async () => {
    const { setup } = await load();
    setup();
    for (const b of warmBuilds()) expect(b.days).toBe(1);
  });
});

describe("the gaps stay under the CacheService ceiling", () => {
  // The schedule is only correct if consecutive fires are closer together than the six-hour
  // maximum TTL they exist to stay ahead of; spacing them further apart would leave a hole in
  // the middle of the working day that nothing on screen would reveal. The overnight gap is
  // deliberately NOT covered — that is what the Drive L2 is for — so this walks consecutive
  // in-day pairs only.
  it("spaces each in-day fire under six hours from the last", async () => {
    const { WARM_READY_BY_HOURS } = await load();
    expect(WARM_READY_BY_HOURS.length).toBeGreaterThan(1);
    for (let i = 1; i < WARM_READY_BY_HOURS.length; i++) {
      const gap = WARM_READY_BY_HOURS[i] - WARM_READY_BY_HOURS[i - 1];
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(6);
    }
  });

  it("keeps every fire inside working hours, which is the point of the change", async () => {
    const { WARM_READY_BY_HOURS } = await load();
    for (const h of WARM_READY_BY_HOURS) {
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThanOrEqual(19);
    }
  });
});

describe("setup reconciles the installed schedule", () => {
  it("is a no-op on a second run", async () => {
    const { setup } = await load();
    setup();
    const first = warmBuilds().length;
    built.length = 0;
    deleted.length = 0;
    setup();
    expect(warmBuilds()).toEqual([]);
    expect(deleted).toEqual([]);
    expect(installed.filter((h) => h === WARM)).toHaveLength(first);
  });

  // THE UPGRADE PATH. A deployment from before this change carries exactly one warm trigger, on
  // the old everyHours(4) schedule, and nothing about it is distinguishable from a correct one.
  // Under the old "install when none exist" check it would stay on the round-the-clock schedule
  // forever; this is the spec that fails if that check comes back.
  it("rebuilds the set over a single legacy everyHours trigger", async () => {
    installed = [WARM];
    const { setup, WARM_READY_BY_HOURS } = await load();
    setup();
    expect(deleted).toEqual([WARM]);
    expect(warmBuilds()).toHaveLength(WARM_READY_BY_HOURS.length);
  });

  it("rebuilds when the source schedule changes under an installed one", async () => {
    const { setup, warmScheduleSignature } = await load();
    setup();
    built.length = 0;
    deleted.length = 0;
    // Same trigger count, different schedule — the count alone cannot see this, which is why
    // the signature is recorded rather than inferred.
    props.WARM_TRIGGER_SCHEDULE = "Europe/Paris|0,4,8@30";
    setup();
    expect(deleted).toHaveLength(3);
    expect(warmBuilds().map((b) => b.hour)).toEqual([8, 12, 16]);
    expect(props.WARM_TRIGGER_SCHEDULE).toBe(warmScheduleSignature());
  });

  it("records the signature only after every trigger is created", async () => {
    // A create() that throws part-way must leave the property stale so the next setup() tries
    // again; recording it first would strand a half-built schedule as "correct" permanently.
    const real = (globalThis as { ScriptApp: { newTrigger: unknown } }).ScriptApp.newTrigger;
    let n = 0;
    (globalThis as { ScriptApp: { newTrigger: unknown } }).ScriptApp.newTrigger = (h: string) => {
      const b = (real as (h: string) => Record<string, (x?: unknown) => unknown>)(h);
      const create = b.create;
      b.create = () => { if (h === WARM && ++n === 2) throw new Error("quota"); return create(); };
      return b;
    };
    try {
      const { setup } = await load();
      expect(() => setup()).toThrow(/quota/);
      expect(props.WARM_TRIGGER_SCHEDULE).toBeUndefined();
    } finally {
      (globalThis as { ScriptApp: { newTrigger: unknown } }).ScriptApp.newTrigger = real;
    }
  });

  it("leaves the daily scan trigger alone while rebuilding the warm set", async () => {
    installed = ["trigger_dailyScan", WARM];
    const { setup } = await load();
    setup();
    expect(deleted).toEqual([WARM]);
    expect(installed).toContain("trigger_dailyScan");
    expect(built.some((b) => b.handler === "trigger_dailyScan")).toBe(false);
  });
});
