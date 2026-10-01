// deploymentDiagnostic() — "is this installation wired up", run from the Apps Script editor.
//
// Its value is entirely in being BELIEVED, and that is lost in both directions: a FAIL on a
// healthy deployment (gas_devsecops's first copy counted a handler nothing installs) teaches
// operators to skip the line, and an OK on a broken one (a daily trigger installed before the
// timezone was pinned passes any count check) is worse. So the first spec runs the REAL setup()
// against stubbed globals and requires the diagnostic to find nothing wrong with what it built —
// the names it counts are then the names setup() installs, by construction rather than by a
// second list in this file. The rest break one thing at a time and require exactly that FAIL.

import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({
  props: {} as Record<string, string>,
  triggers: [] as string[],
  jobs: [] as Record<string, unknown>[],
  logged: [] as string[],
}));

vi.mock("../src/server/sheetsDb", () => ({
  TABS: { scans: "scans", jobs: "jobs" },
  TAB_HEADERS: {},
  SCHEMA_VERSION: 2,
  ensureTabs: () => {},
  readAll: (tab: string) => (tab === "jobs" ? H.jobs : []),
  readTail: () => [],
  ledgerSpreadsheet: () => ({ getName: () => "Wiz Sidekick OS Ledger" }),
  dataRowCount: () => 3,
  cellCount: () => 1234,
}));
vi.mock("../src/server/archiveStore", () => ({ ensureFolders: () => {} }));

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => H.props[k] ?? null,
    setProperty: (k: string, v: string) => { H.props[k] = v; },
    deleteProperty: (k: string) => { delete H.props[k]; },
  }),
});
vi.stubGlobal("ScriptApp", {
  getProjectTriggers: () => H.triggers.map((h) => ({ getHandlerFunction: () => h })),
  deleteTrigger: (t: { getHandlerFunction: () => string }) => {
    const i = H.triggers.indexOf(t.getHandlerFunction());
    if (i >= 0) H.triggers.splice(i, 1);
  },
  newTrigger: (handler: string) => {
    const b: Record<string, unknown> = {};
    for (const k of ["timeBased", "everyDays", "atHour", "nearMinute", "inTimezone", "after"]) {
      b[k] = () => b;
    }
    b["create"] = () => { H.triggers.push(handler); };
    return b;
  },
});
vi.stubGlobal("SpreadsheetApp", { openById: (id: string) => ({ getId: () => id }) });
vi.stubGlobal("DriveApp", { createFolder: () => ({ getId: () => "folder-1" }) });
vi.stubGlobal("Session", {
  getActiveUser: () => ({ getEmail: () => "owner@example.com" }),
  getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }),
});

import { deploymentDiagnostic } from "../src/server/diagnostics";
import { setup } from "../src/server/setup";

const fails = (report: string) => report.split("\n").filter((l) => l.includes("FAIL"));
const lineFor = (report: string, label: string) =>
  report.split("\n").find((l) => l.includes(`${label}:`)) ?? "";

/** A deployment setup() has just installed, with credentials and an allowlist. */
function healthy(): void {
  H.props["LEDGER_SPREADSHEET_ID"] = "ss-1";
  H.props["ARCHIVE_FOLDER_ID"] = "folder-1";
  H.props["WIZ_API_URL"] = "https://api.example.wiz.io/graphql";
  H.props["WIZ_CLIENT_ID"] = "id";
  H.props["WIZ_CLIENT_SECRET"] = "secret";
  setup();
}

beforeEach(() => {
  for (const k of Object.keys(H.props)) delete H.props[k];
  H.triggers.length = 0;
  H.jobs.length = 0;
  H.logged.length = 0;
  vi.spyOn(console, "log").mockImplementation((m: unknown) => { H.logged.push(String(m)); });
});

describe("a deployment setup() just built", () => {
  it("passes every check — the names counted are the names setup() installs", () => {
    healthy();
    const report = deploymentDiagnostic();
    expect(fails(report)).toEqual([]);
    expect(lineFor(report, "Daily scan trigger")).toContain("installed (Europe/Paris|5)");
    expect(lineFor(report, "Warm triggers")).toContain("3 installed");
    expect(lineFor(report, "Pending one-shots")).toContain("none");
    expect(lineFor(report, "Triggers used")).toContain("4 of 20");
  });

  it("logs every line as it goes — the editor shows the log, never the return value", () => {
    healthy();
    H.logged.length = 0;
    const report = deploymentDiagnostic();
    expect(H.logged.join("\n")).toBe(report);
  });
});

describe("the daily scan trigger", () => {
  it("fails a trigger installed before the signature existed", () => {
    healthy();
    delete H.props["DAILY_TRIGGER_SCHEDULE"];
    expect(lineFor(deploymentDiagnostic(), "Daily scan trigger")).toMatch(/FAIL.*\(unrecorded\)/);
  });

  it("fails duplicates, saying how often the scan runs", () => {
    healthy();
    H.triggers.push("trigger_dailyScan");
    expect(lineFor(deploymentDiagnostic(), "Daily scan trigger")).toMatch(/FAIL.*2 installed.*2x a day/);
  });

  it("fails a missing one", () => {
    healthy();
    H.triggers.splice(H.triggers.indexOf("trigger_dailyScan"), 1);
    expect(lineFor(deploymentDiagnostic(), "Daily scan trigger")).toMatch(/FAIL.*not installed/);
  });
});

describe("the warm triggers", () => {
  it("fails the wrong count", () => {
    healthy();
    H.triggers.splice(H.triggers.indexOf("trigger_warmReadModels"), 1);
    expect(lineFor(deploymentDiagnostic(), "Warm triggers")).toMatch(/FAIL.*2 installed, expected 3/);
  });

  it("fails the right count on a stale schedule", () => {
    healthy();
    H.props["WARM_TRIGGER_SCHEDULE"] = "Europe/Paris|0,4,8@30";
    expect(lineFor(deploymentDiagnostic(), "Warm triggers")).toMatch(/FAIL.*schedule Europe\/Paris\|0,4,8@30/);
  });
});

describe("pending one-shots, by handler", () => {
  it("names a scan hop with no scan in flight as stray, and a warm one-shot as not", () => {
    healthy();
    H.triggers.push("trigger_continueScan", "trigger_continueWarm");
    const line = lineFor(deploymentDiagnostic(), "Pending one-shots");
    expect(line).toMatch(/^\s+OK/);
    expect(line).toContain("1 scan hop / watchdog");
    expect(line).toContain("1 warm");
    expect(line).toContain("1 with no matching job in flight");
  });

  it("counts backfill and purge hops under their own names", () => {
    healthy();
    H.triggers.push("trigger_continueBackfill", "trigger_continuePurge");
    const line = lineFor(deploymentDiagnostic(), "Pending one-shots");
    expect(line).toContain("1 backfill hop");
    expect(line).toContain("1 purge hop");
  });

  it("a scan's own hop is not stray while the scan is in flight", () => {
    healthy();
    const now = new Date().toISOString();
    H.jobs.push({
      job_id: "scan-1", kind: "scan", phase: "PERSISTING", page: 4, findings_so_far: 900,
      started_at: now, updated_at: now,
    });
    H.triggers.push("trigger_continueScan");
    const report = deploymentDiagnostic();
    expect(lineFor(report, "Pending one-shots")).not.toContain("no matching job");
    expect(lineFor(report, "Job in flight")).toContain("scan scan-1 — PERSISTING");
  });

  it("fails two warm one-shots — each arming clears the last", () => {
    healthy();
    H.triggers.push("trigger_continueWarm", "trigger_continueWarm");
    expect(lineFor(deploymentDiagnostic(), "Pending one-shots")).toMatch(/FAIL.*more than one warm/);
  });

  it("reports a support-group refresh still queued", () => {
    healthy();
    H.props["SUPPORT_GROUP_REFRESH_PENDING"] = "2026-10-01T05:10:00Z";
    expect(lineFor(deploymentDiagnostic(), "Queued support-group refresh"))
      .toContain("since 2026-10-01T05:10:00Z");
  });
});

describe("the 20-trigger budget", () => {
  it("fails with no slot left for a job's next hop", () => {
    healthy();
    while (H.triggers.length < 20) H.triggers.push("trigger_someoneElse");
    expect(lineFor(deploymentDiagnostic(), "Triggers used")).toMatch(/FAIL.*20 of 20/);
  });

  it("passes with one slot left", () => {
    healthy();
    while (H.triggers.length < 19) H.triggers.push("trigger_someoneElse");
    expect(lineFor(deploymentDiagnostic(), "Triggers used")).toMatch(/OK.*19 of 20/);
  });
});

describe("an unconfigured deployment", () => {
  it("names what setup() has not done yet", () => {
    const report = deploymentDiagnostic();
    expect(lineFor(report, "Ledger spreadsheet")).toMatch(/FAIL.*run setup\(\)/);
    expect(lineFor(report, "Archive folder")).toMatch(/FAIL.*run setup\(\)/);
    expect(lineFor(report, "Wiz credentials")).toMatch(/FAIL.*dry-run/);
    expect(lineFor(report, "Daily scan trigger")).toMatch(/FAIL.*not installed/);
  });
});
