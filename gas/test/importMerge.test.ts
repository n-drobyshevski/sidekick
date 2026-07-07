// Migration-import parity: seed from a real migrate.build_migration_bundle export,
// replay the GAS-era scans, and compare every table against the Python ledger's
// "unified history compacted at the import floor" (gas/test/export_migration_fixture.py).

import { describe, expect, it } from "vitest";
import {
  importBundleCore,
  ImportValidationError,
  mergeMttrHistory,
  validateBundle,
} from "../src/domain/importMerge";
import {
  emptyState,
  persistFlatScan,
  scansAsc,
  type LedgerState,
  type ScanRow,
} from "../src/domain/ledgerCore";
import { deleteScansCore, LedgerRebuildError } from "../src/domain/maintenance";
import { expectParity, fixture } from "./helpers";

const SCAN_COLS = [
  "scan_id", "ts", "mode", "shape", "total", "new_count", "resolved_count",
  "reopened_count", "severities", "sealed",
] as const;

const IMPORT_CMP_ID = "imp-test";

function scansTable(state: LedgerState) {
  return scansAsc(state.scans).map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of SCAN_COLS) out[c] = r[c as keyof ScanRow];
    return out;
  });
}

function envelope(records: unknown[]) {
  return { data: { vulnerabilityFindings: { nodes: records } } };
}

interface FixtureScan {
  id: string;
  records: any[];
}

function gasStateOf(gasScans: FixtureScan[]): LedgerState {
  const state = emptyState();
  for (const scan of gasScans) {
    persistFlatScan(state, scan.records, { mode: "live", scanId: scan.id });
  }
  return state;
}

function readerOf(gasScans: FixtureScan[]) {
  return (row: ScanRow) => {
    const scan = gasScans.find((s) => s.id === row.scan_id);
    return scan ? envelope(scan.records) : null;
  };
}

/**
 * The Python fixture's episodes carry real compaction ids; rows minted by the
 * compaction that models the import (the LAST python compaction) map to the TS
 * import's own compactionId, the rest travelled inside the bundle verbatim.
 */
function normalizeExpectedEpisodes(expected: any) {
  const cmpIds: string[] = expected.compaction_ids;
  const importCmp = cmpIds[cmpIds.length - 1];
  return expected.episodes.map((e: any) => ({
    ...e,
    compaction_id: e.compaction_id === importCmp ? IMPORT_CMP_ID : e.compaction_id,
  }));
}

function sortedEpisodes(state: LedgerState) {
  return [...state.episodes].sort((a, b) =>
    a.vuln_key < b.vuln_key ? -1 : a.vuln_key > b.vuln_key ? 1 : 0,
  );
}

describe("importBundleCore (Python fixture parity)", () => {
  const fx = fixture("migration_bundle");
  const now = Date.parse(fx.now);

  it("scenario A: uncompacted bundle merges into overlapping GAS history", () => {
    const a = fx.scenario_a;
    const state = gasStateOf(a.gas_scans);
    const bundle = validateBundle(a.bundle);
    const res = importBundleCore(state, bundle, readerOf(a.gas_scans), {
      compactionId: IMPORT_CMP_ID,
    });

    expect(res.counts).toEqual({
      scans_imported: 3,
      scans_skipped: 0,
      vulns_imported: 4,
      episodes_imported: 0,
      episodes_converted: 1,
      scans_replayed: 2,
    });
    expectParity(scansTable(res.state), a.expected.scans);
    expectParity(res.state.ledger, a.expected.ledger);
    expectParity(sortedEpisodes(res.state), normalizeExpectedEpisodes(a.expected));

    // Checkpoint parity (keyed; row order is storage-specific).
    expect(res.checkpoint.floor_scan_id).toBe(a.expected.checkpoint.floor_scan_id);
    expect(res.checkpoint.floor_ts).toBe(a.expected.checkpoint.floor_ts);
    const cpByKey = Object.fromEntries(res.checkpoint.ledger.map((r) => [r.vuln_key, r]));
    const expByKey = Object.fromEntries(
      a.expected.checkpoint.ledger.map((r: any) => [r.vuln_key, r]),
    );
    expectParity(cpByKey, expByKey);

    // Replayed GAS scans got fresh observations; imported sealed scans none.
    expect(Object.keys(res.observationsByScan).sort()).toEqual(
      a.gas_scans.map((s: FixtureScan) => s.id).sort(),
    );
  });

  it("scenario A: post-import delete replays from the synthetic checkpoint", () => {
    const a = fx.scenario_a;
    const state = gasStateOf(a.gas_scans);
    const res = importBundleCore(state, validateBundle(a.bundle), readerOf(a.gas_scans), {
      compactionId: IMPORT_CMP_ID,
    });
    const del = deleteScansCore(
      res.state,
      [a.delete_t4.id],
      readerOf(a.gas_scans),
      res.checkpoint,
      now,
    );
    expectParity(del.result, a.delete_t4.result);
    expectParity(scansTable(del.state), a.delete_t4.after.scans);
    expectParity(del.state.ledger, a.delete_t4.after.ledger);
    expectParity(sortedEpisodes(del.state), normalizeExpectedEpisodes(a.delete_t4.after));
  });

  it("scenario B: pre-compacted bundle (sealed rows + episodes) merges verbatim", () => {
    const b = fx.scenario_b;
    const state = gasStateOf(b.gas_scans);
    const bundle = validateBundle(b.bundle);
    const res = importBundleCore(state, bundle, readerOf(b.gas_scans), {
      compactionId: IMPORT_CMP_ID,
    });

    expect(res.counts).toEqual({
      scans_imported: 4,
      scans_skipped: 0,
      vulns_imported: 2,
      episodes_imported: 1,
      episodes_converted: 1,
      scans_replayed: 2,
    });
    expectParity(scansTable(res.state), b.expected.scans);
    expectParity(res.state.ledger, b.expected.ledger);
    expectParity(sortedEpisodes(res.state), normalizeExpectedEpisodes(b.expected));

    // The synthetic checkpoint pins the newest imported flat scan and mirrors the
    // bundle's live ledger (episode keys excluded, as delete-rebuild expects).
    expect(res.checkpoint.floor_scan_id).toBe("2026-01-20T06:00:00Z");
    expect(res.checkpoint.ledger.map((r) => r.vuln_key).sort()).toEqual(
      b.bundle.ledger.map((r: any) => r.vuln_key).sort(),
    );
  });

  it("empty GAS state: the bundle becomes the whole (sealed) history", () => {
    const a = fx.scenario_a;
    const res = importBundleCore(emptyState(), validateBundle(a.bundle), () => null, {
      compactionId: IMPORT_CMP_ID,
    });
    expect(res.counts.scans_replayed).toBe(0);
    expect(res.state.scans.every((s) => s.sealed === 1 && s.raw_ref === null)).toBe(true);
    // With no GAS era, every settled RESOLVED baseline row converts (B and E).
    expect(res.counts.episodes_converted).toBe(2);
    const liveKeys = Object.keys(res.state.ledger).sort();
    expect(liveKeys).toEqual(["id:A", "id:C"]);
  });

  it("accepts a slimmed open ledger row (identity + first_seen only)", () => {
    // The slim-open export (migrate.build_split_bundles slim_open=True) ships open vulns as
    // just {vuln_key, first_seen}; a later GAS scan refills the rest. Lock that the importer
    // coerces such a lean row to a valid OPEN row with the age preserved and no stray fields.
    const bundle = validateBundle({
      kind: "wiz-sidekick-migration",
      version: 1,
      exported_at: "2026-06-01T00:00:00Z",
      scans: [{ scan_id: "2020-01-01T00:00:00Z", ts: "2020-01-01T00:00:00Z" }],
      ledger: [{ vuln_key: "id:lean", first_seen: "2020-01-01T00:00:00Z" }],
      episodes: [],
      mttr_history: [],
    });
    const res = importBundleCore(emptyState(), bundle, () => null, {
      compactionId: IMPORT_CMP_ID,
    });
    const row = res.state.ledger["id:lean"];
    expect(row).toBeDefined();
    expect(row.status).toBe("OPEN");
    expect(row.first_seen).toBe("2020-01-01T00:00:00Z");
    expect(row.tags_json).toBeNull();
    expect(res.counts.vulns_imported).toBe(1);
  });
});

describe("importBundleCore guards", () => {
  const fx = fixture("migration_bundle");
  const a = fx.scenario_a;

  it("refuses when the GAS ledger already has sealed history", () => {
    const state = gasStateOf(a.gas_scans);
    state.scans[0].sealed = 1;
    expect(() =>
      importBundleCore(state, validateBundle(a.bundle), readerOf(a.gas_scans), {
        compactionId: IMPORT_CMP_ID,
      }),
    ).toThrow(ImportValidationError);
  });

  it("refuses when imported scans do not strictly predate existing ones", () => {
    const state = gasStateOf(a.gas_scans);
    const bundle = validateBundle(a.bundle);
    const overlapping = {
      ...bundle,
      scans: [...bundle.scans, { ...bundle.scans[0], scan_id: "2026-06-15T00:00:00Z", ts: "2026-06-15T00:00:00Z" }],
    };
    expect(() =>
      importBundleCore(state, overlapping, readerOf(a.gas_scans), {
        compactionId: IMPORT_CMP_ID,
      }),
    ).toThrow(/strictly older/);
    // Equal timestamps refuse too.
    const equal = {
      ...bundle,
      scans: [{ ...bundle.scans[0], scan_id: a.gas_scans[0].id, ts: a.gas_scans[0].id }],
    };
    // Same scan_id is skipped as a duplicate instead; use a distinct id at the same ts.
    equal.scans[0].scan_id = "1999-zzz";
    equal.scans[0].ts = a.gas_scans[0].id;
    expect(() =>
      importBundleCore(state, equal, readerOf(a.gas_scans), { compactionId: IMPORT_CMP_ID }),
    ).toThrow(/strictly older/);
  });

  it("skips duplicate scan_ids (bundle-internal and vs existing)", () => {
    const state = gasStateOf(a.gas_scans);
    const bundle = validateBundle(a.bundle);
    const withDups = {
      ...bundle,
      scans: [...bundle.scans, { ...bundle.scans[0] }, { ...bundle.scans[0], scan_id: a.gas_scans[0].id, ts: a.gas_scans[0].id }],
    };
    const res = importBundleCore(state, withDups, readerOf(a.gas_scans), {
      compactionId: IMPORT_CMP_ID,
    });
    expect(res.counts.scans_skipped).toBe(2);
    expect(res.counts.scans_imported).toBe(3);
  });

  it("throws on unparseable imported timestamps", () => {
    const bundle = validateBundle(a.bundle);
    const bad = { ...bundle, scans: [{ ...bundle.scans[0], scan_id: "bad", ts: "not-a-date" }] };
    expect(() =>
      importBundleCore(emptyState(), bad, () => null, { compactionId: IMPORT_CMP_ID }),
    ).toThrow(/unparseable/);
  });

  it("throws before mutating when a GAS scan's payload is unreadable", () => {
    const state = gasStateOf(a.gas_scans);
    expect(() =>
      importBundleCore(state, validateBundle(a.bundle), () => null, {
        compactionId: IMPORT_CMP_ID,
      }),
    ).toThrow(LedgerRebuildError);
  });
});

describe("validateBundle", () => {
  const fx = fixture("migration_bundle");

  it("accepts a real exporter bundle and defaults missing tables", () => {
    const b = validateBundle(fx.scenario_a.bundle);
    expect(b.kind).toBe("wiz-sidekick-migration");
    const minimal = validateBundle({ kind: "wiz-sidekick-migration", version: 1 });
    expect(minimal.scans).toEqual([]);
    expect(minimal.mttr_history).toEqual([]);
  });

  it("rejects structural problems", () => {
    expect(() => validateBundle(null)).toThrow(ImportValidationError);
    expect(() => validateBundle({ kind: "wiz-sidekick-domains", version: 1 })).toThrow(/kind/);
    expect(() => validateBundle({ kind: "wiz-sidekick-migration", version: 2 })).toThrow(/version/);
    expect(() =>
      validateBundle({ kind: "wiz-sidekick-migration", version: 1, ledger: {} }),
    ).toThrow(/must be a list/);
    expect(() =>
      validateBundle({ kind: "wiz-sidekick-migration", version: 1, scans: [{ ts: "x" }] }),
    ).toThrow(/scan_id/);
    expect(() =>
      validateBundle({ kind: "wiz-sidekick-migration", version: 1, episodes: [{}] }),
    ).toThrow(/vuln_key/);
  });
});

describe("mergeMttrHistory", () => {
  it("existing rows win, imported rows fill, result sorted, bad dates skipped", () => {
    const existing = [
      { date: "2026-06-15", median_days: 9, resolved: 1, open: 2, total: 3, sla_pct: null, oldest_open_days: null },
      { date: "2026-06-30", median_days: 8, resolved: 2, open: 2, total: 4, sla_pct: 75.0, oldest_open_days: 10 },
    ];
    const imported = [
      { date: "2026-01-20", median_days: 5.0, resolved: 3, open: 10, total: 13, sla_pct: 90.0, oldest_open_days: 45.0 },
      { date: "2026-06-15", median_days: 4.0, resolved: 4, open: 9, total: 13, sla_pct: null, oldest_open_days: null },
      { date: "garbage", median_days: 1 },
    ];
    const { rows, added, skipped } = mergeMttrHistory(existing, imported);
    expect(added).toBe(1);
    expect(skipped).toBe(2);
    expect(rows.map((r) => r["date"])).toEqual(["2026-01-20", "2026-06-15", "2026-06-30"]);
    // The collision kept the existing (GAS) row.
    expect(rows[1]["median_days"]).toBe(9);
    // Imported numerics coerced, nulls preserved.
    expect(rows[0]["sla_pct"]).toBe(90.0);
  });

  it("handles empty inputs", () => {
    expect(mergeMttrHistory([], [])).toEqual({ rows: [], added: 0, skipped: 0 });
    const { rows, added } = mergeMttrHistory([], [{ date: "2026-01-01T00:00:00Z", median_days: 2 }]);
    expect(added).toBe(1);
    expect(rows[0]["date"]).toBe("2026-01-01");
  });
});
