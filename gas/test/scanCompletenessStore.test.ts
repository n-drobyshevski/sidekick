// The completeness verdict has to SURVIVE the scans tab, or replay cannot read it back.
//
// `appendRows` / `overwrite` map values by the headers READ OFF THE SHEET (sheetsDb.ts), so a
// deployment whose scans tab predates the completeness columns would silently drop every
// verdict on write — and the next delete-and-replay would read a deferred scan back as a legacy
// one and resolve everything it missed. This drives the real ledgerStore against a sheetsDb fake
// that behaves that way, and checks that the persist heals the header row first and that
// `rowToScan` reads blank cells back as the legacy marker, not as a zero.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const H = vi.hoisted(() => ({
  headers: {} as Record<string, string[]>,
  tables: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock("../src/server/sheetsDb", async () => {
  const real = await vi.importActual<typeof import("../src/server/sheetsDb")>("../src/server/sheetsDb");
  /** Keep only the columns the sheet's header row has — what the real writers do. */
  const project = (tab: string, row: Row): Row => {
    const out: Row = {};
    for (const h of H.headers[tab] ?? []) out[h] = row[h] === undefined ? null : row[h];
    return out;
  };
  return {
    TABS: real.TABS,
    TAB_HEADERS: real.TAB_HEADERS,
    ensureTab: (tab: string) => {
      const have = H.headers[tab] ?? [];
      H.headers[tab] = [...have, ...real.TAB_HEADERS[tab]!.filter((h) => !have.includes(h))];
    },
    readAll: (tab: string) => H.tables[tab] ?? [],
    readTail: (tab: string, n: number) => (H.tables[tab] ?? []).slice(-n),
    overwrite: (tab: string, rows: Row[]) => { H.tables[tab] = rows.map((r) => project(tab, r)); },
    appendRows: (tab: string, rows: Row[]) => {
      H.tables[tab] = [...(H.tables[tab] ?? []), ...rows.map((r) => project(tab, r))];
    },
    updateWhere: (tab: string, key: string, value: unknown, patch: Row) => {
      const row = (H.tables[tab] ?? []).find((r) => r[key] === value);
      if (!row) return false;
      Object.assign(row, project(tab, { ...row, ...patch }));
      return true;
    },
    dataRowCount: (tab: string) => (H.tables[tab] ?? []).length,
  };
});
vi.mock("../src/server/archiveStore", () => ({
  readLedgerSnapshot: () => null,
  writeLedgerSnapshot: () => {},
  writeJournal: () => "journal-1",
  writeObservations: () => "obs-1",
  trashFile: () => {},
}));
vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }),
});

const T = (day: number): string => new Date(Date.UTC(2026, 5, day)).toISOString().replace(".000Z", "Z");
const node = (id: string): Row => ({ id, name: `CVE-${id}`, severity: "HIGH", status: "OPEN" });

/** A scans tab as a deployment from before the gate has it: the twelve original columns. */
const LEGACY_SCAN_HEADERS = [
  "scan_id", "ts", "mode", "shape", "total", "new_count", "resolved_count",
  "reopened_count", "raw_ref", "obs_ref", "severities", "sealed",
];

beforeEach(() => {
  for (const k of Object.keys(H.tables)) delete H.tables[k];
  for (const k of Object.keys(H.headers)) delete H.headers[k];
  H.headers["scans"] = [...LEGACY_SCAN_HEADERS];
  H.headers["vuln_ledger"] = ["vuln_key", "status", "severity", "last_scan_id"];
  H.headers["resolved_episodes"] = ["vuln_key"];
  H.headers["jobs"] = ["job_id", "kind", "phase", "scan_id", "journal_ref"];
  vi.resetModules();
});

describe("a scan's completeness verdict on the scans tab", () => {
  it("lands even on a tab that predates the columns, and reads back verbatim", async () => {
    const store = await import("../src/server/ledgerStore");
    store.persistFlatScan([node("a"), node("b")], {
      mode: "live", scanId: T(2), completeness: { reportedTotal: 2, partialPages: 0 },
    });
    store.persistFlatScan([], {
      mode: "live", scanId: T(3), completeness: { reportedTotal: null, partialPages: 1 },
    });
    expect(H.headers["scans"]).toEqual(expect.arrayContaining(["disappearance", "reported_total"]));
    expect(H.tables["scans"]!.map((r) => r["disappearance"])).toEqual(["complete", "deferred:empty"]);
    const back = (await import("../src/server/ledgerStore")).loadScanRows();
    expect(back.map((s) => [s.disappearance, s.reported_total, s.partial_pages])).toEqual([
      ["complete", 2, 0],
      ["deferred:empty", null, 1],
    ]);
  });

  it("a row written before the gate reads back as LEGACY — null, never 0 or \"complete\"", async () => {
    H.tables["scans"] = [{
      scan_id: T(1), ts: T(1), mode: "live", shape: "flat", total: 3, new_count: 3,
      resolved_count: 0, reopened_count: 0, raw_ref: null, obs_ref: null, severities: null,
      sealed: 0,
    }];
    const store = await import("../src/server/ledgerStore");
    expect(store.loadScanRows()[0]).toMatchObject({
      reported_total: null, partial_pages: null, duplicates: null, disappearance: null,
    });
  });
});
