// The editor-run connectivity diagnostic.
//
// It exists because three completely different failures look identical from the app — the
// Settings row says "Refused" for all of them — and they have three different remedies: fix
// the client secret, fix WIZ_API_URL, or re-authorize the deployment. Sending an operator to
// the wrong one costs a redeploy.
//
// Its second job cannot be tested here at all, and is the reason it is a separate function
// from `deploymentDiagnostic()`: running it from the Apps Script editor is what puts the
// consent screen in front of the operator, because Apps Script asks for a scope when code
// needing it actually runs. A diagnostic that only reads Script Properties authorizes nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/domain/settingsLogic";

const props = vi.hoisted(() => ({}));
const http = vi.hoisted(() => ({ replies: [], throwWith: null }));
// A cache that actually caches. With a stub that always missed, step 2's fetchPage re-ran the
// token exchange and ate the page reply — so the diagnostic silently reported step 2 as a
// failure. That is a fixture bug, but it models the production behaviour that matters:
// getToken caches, so one wizDiagnostic run is ONE exchange plus one query, not two of each.
const cache = vi.hoisted(() => ({ store: {} }));

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k) => props[k] ?? null,
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }),
});
vi.stubGlobal("CacheService", {
  getScriptCache: () => ({
    get: (k) => cache.store[k] ?? null,
    put: (k, v) => { cache.store[k] = v; },
    remove: (k) => { delete cache.store[k]; },
  }),
});
vi.stubGlobal("Utilities", { sleep: () => {} });
// deploymentDiagnostic reports which triggers are installed, so it reaches for ScriptApp even
// though nothing on the Wiz path does. Handler names only — all a ClockTrigger exposes.
const triggers = vi.hoisted(() => ({ handlers: [] }));
vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => triggers.handlers.map((h) => ({ getHandlerFunction: () => h })),
});
vi.stubGlobal("UrlFetchApp", {
  fetch: (url) => {
    if (http.throwWith) throw new Error(http.throwWith);
    const reply = http.replies.shift();
    if (!reply) throw new Error(`no stubbed reply for ${url}`);
    return {
      getResponseCode: () => reply.code,
      getContentText: () => JSON.stringify(reply.body),
    };
  },
});

// The ledger half of diagnostics.ts drags in Sheets and Drive on import; none of it is on the
// path under test.
vi.mock("../src/server/sheetsDb", () => ({
  TABS: { scans: "scans", settings: "settings", ledger: "finding_ledger", jobs: "jobs" },
  TAB_HEADERS: {}, SCHEMA_VERSION: 1,
  ensureTab: () => null,
  readAll: () => [], readTail: () => [], overwrite: () => {}, appendRows: () => {},
  updateWhere: () => false, dataRowCount: () => 0, ensureTabs: () => {},
  cellCount: () => 0, ledgerSpreadsheet: () => ({ getName: () => "x" }),
  __resetMemosForTest: () => {},
}));

const TOKEN_OK = { code: 200, body: { access_token: "tok-abcdef", expires_in: 3600 } };
const PAGE_OK = {
  code: 200,
  body: {
    data: {
      sastFindings: { nodes: [{ id: "a" }], totalCount: 127, pageInfo: { hasNextPage: false } },
    },
  },
};

const load = () => import("../src/server/diagnostics");

beforeEach(() => {
  for (const k of Object.keys(props)) delete props[k];
  http.replies.length = 0;
  http.throwWith = null;
  cache.store = {};
  props.WIZ_API_URL = "https://api.test.app.wiz.io/graphql";
  props.WIZ_CLIENT_ID = "client-id-value";
  props.WIZ_CLIENT_SECRET = "client-secret-value";
  triggers.handlers = [];
  vi.resetModules();
});

describe("it names which step failed", () => {
  it("reports both steps passing, and records the verification", async () => {
    const { wizDiagnostic } = await load();
    http.replies.push(TOKEN_OK, PAGE_OK);
    const out = wizDiagnostic();
    expect(out).toContain("Step 1 OK");
    expect(out).toContain("Step 2 OK");
    expect(out).toContain("127 finding(s)");
    // One exchange, not two: step 2 reuses the token step 1 minted.
    expect(http.replies).toHaveLength(0);
    // The same stamp the Settings row reads, so a green editor run and a green Settings row
    // cannot disagree about whether this deployment has ever reached the tenant.
    expect(props.WIZ_VERIFIED_AT).toBeTruthy();
  });

  it("blames the TOKEN when the credentials are refused", async () => {
    const { wizDiagnostic } = await load();
    http.replies.push({ code: 401, body: { error: "invalid_client" } });
    const out = wizDiagnostic();
    expect(out).toContain("Step 1 FAIL");
    expect(out).not.toContain("Step 2");
    expect(out).toMatch(/WIZ_CLIENT_SECRET/);
    expect(props.WIZ_VERIFIED_AT).toBeUndefined();
  });

  it("blames the QUERY when the token was accepted and the query was not", async () => {
    // The distinction that saves a redeploy: the secret is fine, the URL or the service
    // account's reach is not.
    const { wizDiagnostic } = await load();
    http.replies.push(TOKEN_OK, { code: 404, body: { m: "no such path" } });
    const out = wizDiagnostic();
    expect(out).toContain("Step 1 OK");
    expect(out).toContain("Step 2 FAIL");
    expect(out).toMatch(/WIZ_API_URL/);
    expect(props.WIZ_VERIFIED_AT).toBeUndefined();
  });

  it("sends an authorization refusal to the DEPLOYMENT, not to the credentials", async () => {
    // The failure that prompted all of this, in the locale it arrived in. Answering "check
    // your client secret" here would send the operator to the one place that is fine.
    http.throwWith = "Vous n'êtes pas autorisé à appeler UrlFetchApp.fetch. Autorisations "
      + "requises : https://www.googleapis.com/auth/script.external_request";
    const { wizDiagnostic } = await load();
    const out = wizDiagnostic();
    expect(out).toContain("Step 1 FAIL");
    expect(out).toMatch(/NOT the credentials/);
    expect(out).toMatch(/NEW VERSION/);
    expect(out).not.toMatch(/Check WIZ_CLIENT_ID/);
  });

  it("stops before touching the network when there is nothing to test", async () => {
    delete props.WIZ_CLIENT_ID;
    delete props.WIZ_CLIENT_SECRET;
    const { wizDiagnostic } = await load();
    const out = wizDiagnostic();
    expect(out).toContain("STOP");
    expect(out).not.toContain("Step 1");
  });
});

describe("what it prints about the secrets", () => {
  it("shows enough to recognise them and not enough to use them", async () => {
    const { wizDiagnostic } = await load();
    http.replies.push(TOKEN_OK, PAGE_OK);
    const out = wizDiagnostic();
    expect(out).not.toContain("client-secret-value");
    expect(out).toContain("clie…ue");     // first four, last two, and the length
    expect(out).toContain("(19 chars)");
  });

  it("says (unset) rather than printing nothing for a missing one", async () => {
    // An empty value beside a label reads as "this is fine"; the diagnostic exists for the
    // reader who cannot tell which of six properties is the wrong one.
    const { wizDiagnostic } = await load();
    http.replies.push(TOKEN_OK, PAGE_OK);
    expect(wizDiagnostic()).toContain("Static token: (unset)");
  });
});

describe("the report reaches the operator", () => {
  // THE DEFECT THIS BLOCK EXISTS FOR, and it is invisible by construction: the function does
  // all of its work correctly, returns a full report, and the operator sees an empty log.
  //
  // The Apps Script editor does not display a function's return value — the Execution log
  // shows logged output and nothing else. So a diagnostic that only returns its report prints
  // nothing at all when run the way its own README tells you to run it. Reported from a real
  // editor run as "nothing, no error, no status message and just finished", and it cost three
  // exchanges of guessing at what the report would have said.
  //
  // The sibling that works does `console.log(m)` as it builds (gas/src/server/diagnostics.ts),
  // which is why ITS README can say "read the Execution log". Ours logged nothing:
  // `grep -c 'console\.log\|Logger\.log'` over the whole file returned 0.

  const loggedLines = (spy) => spy.mock.calls.map((c) => String(c[0])).join("\n").split("\n");

  it("logs every line wizDiagnostic returns, not just some of them", async () => {
    // Set equality rather than "logged at least once": a partial log is the same defect
    // wearing a smaller hat, and the log is not a summary of the report — it IS the report.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { wizDiagnostic } = await load();
      http.replies.push(TOKEN_OK, PAGE_OK);
      const returned = wizDiagnostic().split("\n");
      expect(loggedLines(spy)).toEqual(returned);
    } finally {
      spy.mockRestore();
    }
  });

  it("logs the failure path too", async () => {
    // The path an operator is most likely to be on when they run this at all.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { wizDiagnostic } = await load();
      http.replies.push({ code: 401, body: { error: "invalid_client" } });
      const returned = wizDiagnostic().split("\n");
      expect(loggedLines(spy)).toEqual(returned);
      expect(loggedLines(spy).join("\n")).toContain("Step 1 FAIL");
    } finally {
      spy.mockRestore();
    }
  });

  it("logs deploymentDiagnostic as well, which had the same hole", async () => {
    // It has a second reader — Settings > System renders its returned string — so the return
    // value stays. Both outputs are the same text.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { deploymentDiagnostic } = await load();
      const returned = deploymentDiagnostic().split("\n");
      expect(loggedLines(spy)).toEqual(returned);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("deploymentDiagnostic's trigger read-out", () => {
  // It used to count `trigger_dailyScan`, a name nothing installs, so it said FAIL on every
  // correctly set-up deployment. These pin it to what setup.ts and scanJobs.ts actually arm.
  const SETUP_INSTALLS = [
    "trigger_dailySync",
    "trigger_warmReadModels", "trigger_warmReadModels", "trigger_warmReadModels",
  ];
  const run = async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { deploymentDiagnostic } = await load();
      return deploymentDiagnostic();
    } finally {
      spy.mockRestore();
    }
  };
  const lineOf = (out, label) => out.split("\n").find((l) => l.includes(`${label}:`)) ?? "";

  it("passes a deployment exactly as setup() leaves it", async () => {
    const { dailySyncSchedule, warmTriggerSchedule } = await import("../src/server/setup");
    triggers.handlers = [...SETUP_INSTALLS];
    props.WARM_TRIGGER_SCHEDULE = warmTriggerSchedule();
    props.DAILY_SYNC_SCHEDULE = dailySyncSchedule(DEFAULT_SETTINGS.syncSchedule);
    const out = await run();
    expect(lineOf(out, "Daily sync trigger")).toMatch(/^\s+OK\s.*Europe\/Paris\|5/);
    expect(lineOf(out, "Warm triggers")).toMatch(/^\s+OK\s.*3 installed/);
    expect(lineOf(out, "Pending one-shots")).toContain(": 0");
    expect(lineOf(out, "Triggers used")).toContain("4 of 20");
    expect(lineOf(out, "Sync in flight")).toContain("none");
    expect(out).not.toContain("Scan in flight");
  });

  it("fails a missing daily trigger and a short warm set", async () => {
    triggers.handlers = ["trigger_warmReadModels"];
    const out = await run();
    expect(lineOf(out, "Daily sync trigger")).toMatch(/FAIL.*run setup\(\)/);
    expect(lineOf(out, "Warm triggers")).toMatch(/FAIL.*1 installed, expected 3/);
  });

  it("fails a full warm set whose recorded schedule is not this build's", async () => {
    triggers.handlers = [...SETUP_INSTALLS];
    props.WARM_TRIGGER_SCHEDULE = "Europe/Paris|7,11,15@0";
    expect(lineOf(await run(), "Warm triggers")).toMatch(/FAIL.*Europe\/Paris\|7,11,15@0/);
  });

  it("fails a daily trigger whose recorded hour is not the saved sync hour", async () => {
    // A Settings save moves the trigger best-effort; when that reinstall failed, this line is
    // where the stale hour shows. Settings are the defaults here (an empty tab), so 5:00.
    triggers.handlers = [...SETUP_INSTALLS];
    props.DAILY_SYNC_SCHEDULE = "Europe/Paris|14";
    const line = lineOf(await run(), "Daily sync trigger");
    expect(line).toMatch(/FAIL.*Europe\/Paris\|14.*Europe\/Paris\|5/);
    expect(line).toMatch(/run setup\(\) as the deploying account/);
  });

  it("fails a daily trigger installed before the hour was recorded", async () => {
    triggers.handlers = [...SETUP_INSTALLS];
    expect(lineOf(await run(), "Daily sync trigger")).toMatch(/FAIL.*\(unrecorded\)/);
  });

  it("fails two daily triggers before it looks at the hour", async () => {
    triggers.handlers = [...SETUP_INSTALLS, "trigger_dailySync"];
    props.DAILY_SYNC_SCHEDULE = "Europe/Paris|5";
    expect(lineOf(await run(), "Daily sync trigger")).toMatch(/FAIL.*2 installed, expected 1/);
  });

  it("counts leftover one-shots and fails when no sync could arm its own", async () => {
    triggers.handlers = [
      ...SETUP_INSTALLS, "trigger_continueSync", "trigger_watchdogSync",
      ...Array.from({ length: 13 }, () => "someoneElsesTrigger"),
    ];
    const out = await run();
    expect(lineOf(out, "Pending one-shots")).toMatch(/2 with no sync in flight/);
    expect(lineOf(out, "Triggers used")).toMatch(/FAIL.*19 of 20/);
  });
});
