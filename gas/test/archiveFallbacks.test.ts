// THE TWO FALLBACKS A DRIVE OUTAGE NOW REACHES.
//
// Making the archive reads total is only half the fix: what makes the app SURVIVE a Drive service
// error is that both of its Drive reads on the load path already had a second source, and a null
// is what selects it. Those fallbacks were written for a missing file, not for a broken service —
// before this, the service error was thrown past them.
//
//   findings.currentScan()   frame -> slim spill -> raw archive pages -> []
//   ledgerStore.loadState()  Drive snapshot -> the vuln_ledger / resolved_episodes tabs
//
// The second one is the one that matters most: the tabs hold the SAME data, so with Drive down
// the register still answers with the whole ledger — slower, and completely correct. Sheets and
// Drive are separate services and one is not usually out with the other.
//
// Real archiveStore, real findings, real ledgerStore; only the two GAS services are fakes.

import { beforeEach, describe, expect, it, vi } from "vitest";

const tables: Record<string, Record<string, unknown>[]> = {};

vi.mock("../src/server/sheetsDb", () => {
  const TABS = {
    scans: "scans",
    vulnLedger: "vuln_ledger",
    episodes: "resolved_episodes",
    compactions: "compactions",
    settings: "settings",
    mttrHistory: "mttr_history",
    schemaMeta: "schema_meta",
    jobs: "jobs",
  };
  return {
    TABS,
    readAll: (tab: string) => tables[tab] ?? [],
    readTail: (tab: string, n: number) => (tables[tab] ?? []).slice(-n),
    overwrite: () => {},
    appendRows: () => {},
    ensureTab: () => {},
    dataRowCount: (tab: string) => (tables[tab] ?? []).length,
    truncateAfter: () => {},
    shrinkTab: () => {},
    updateWhere: () => {},
  };
});

// Neither is under test here, and both reach settings/props of their own.
vi.mock("../src/server/settingsStore", () => ({
  getDomains: () => ({ items: [] }),
  getShowNoFix: () => true,
}));
vi.mock("../src/server/supportGroups", () => ({ attachSupportGroups: () => {} }));
vi.mock("../src/server/bizDomains", () => ({ attachBizDomains: () => {} }));
vi.mock("../src/server/errorLog", () => ({ recordError: () => {}, recentErrors: () => [] }));

// EVERY Drive call fails — the shape of the incident, where the service itself is the thing that
// is down rather than one file being missing.
vi.stubGlobal("DriveApp", {
  getFolderById: () => { throw new Error("Erreur liée à un service : Drive"); },
  getFileById: () => { throw new Error("Erreur liée à un service : Drive"); },
});
vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) => (k === "ARCHIVE_FOLDER_ID" ? "root-1" : null),
    setProperty: () => {},
    deleteProperty: () => {},
  }),
});

beforeEach(() => {
  vi.resetModules();
  for (const k of Object.keys(tables)) delete tables[k];
  vi.stubGlobal("console", { ...console, warn: () => {} });
});

describe("findings.currentScan() with Drive down", () => {
  beforeEach(() => {
    tables["scans"] = [{
      scan_id: "scan-1", ts: "2026-09-01T00:00:00Z", mode: "full", shape: "flat",
      total: 2, new_count: 0, resolved_count: 0, reopened_count: 0,
      raw_ref: "folder-scan-1", obs_ref: null, severities: "", sealed: 0,
    }];
  });

  it("answers the scan with no records rather than throwing out of the bootstrap", async () => {
    const findings = await import("../src/server/findings");
    const scan = findings.currentScan();
    expect(scan).not.toBeNull();
    expect(scan?.scanId).toBe("scan-1");
    // Frame, slim spill and raw pages all unreadable — [] is the honest tail of that chain, and
    // it is what `bootstrapCore` counts over. The counts read 0; the page renders.
    expect(scan?.records).toEqual([]);
  });

  it("is the whole bootstrap-shaped call: nothing on this path throws", async () => {
    const findings = await import("../src/server/findings");
    expect(() => findings.currentScan()).not.toThrow();
  });
});

describe("ledgerStore.loadState() with Drive down", () => {
  it("falls back to the Sheets tabs — the same ledger, from the other service", async () => {
    tables["scans"] = [];
    tables["vuln_ledger"] = [
      { vuln_key: "k1", cve: "CVE-2026-1", severity: "HIGH", status: "OPEN" },
      { vuln_key: "k2", cve: "CVE-2026-2", severity: "LOW", status: "RESOLVED" },
    ];
    tables["resolved_episodes"] = [
      { vuln_key: "k2", cve: "CVE-2026-2", severity: "LOW", compaction_id: "c1" },
    ];
    const ledgerStore = await import("../src/server/ledgerStore");
    const state = ledgerStore.loadState();
    expect(Object.keys(state.ledger).sort()).toEqual(["k1", "k2"]);
    expect(state.episodes).toHaveLength(1);
  });
});
