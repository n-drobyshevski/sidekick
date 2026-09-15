// End-to-end parity: replay the SQLite ledger scenarios through the in-memory
// LedgerState core and compare every table after every step.

import { describe, expect, it } from "vitest";
import {
  baseRows,
  emptyState,
  persistFlatScan,
  scansAsc,
  type LedgerState,
  type ScanRow,
} from "../src/domain/ledgerCore";
import {
  compactLedgerCore,
  deleteScansCore,
  SealedScanError,
} from "../src/domain/maintenance";
import type { Observation } from "../src/domain/reconcile";
import { fixture } from "./helpers";

const SCAN_COLS = [
  "scan_id", "ts", "mode", "shape", "total", "new_count", "resolved_count",
  "reopened_count", "severities", "sealed",
] as const;

function scansTable(state: LedgerState) {
  return scansAsc(state.scans).map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of SCAN_COLS) out[c] = r[c as keyof ScanRow];
    return out;
  });
}

function obsTable(observationsByScan: Record<string, Observation[]>) {
  const all = Object.values(observationsByScan).flat();
  return [...all].sort((a, b) =>
    a.scan_id === b.scan_id
      ? a.vuln_key < b.vuln_key ? -1 : a.vuln_key > b.vuln_key ? 1 : 0
      : a.scan_id < b.scan_id ? -1 : 1,
  );
}

function envelope(records: unknown[]) {
  return { data: { vulnerabilityFindings: { nodes: records } } };
}

describe("ledger flow (SQLite fixture parity)", () => {
  const fx = fixture("ledger_flow");
  const ids = ["s1", "s2", "s3", "s4"] as const;

  it("persist x4 then delete s2 reproduces every table state", () => {
    const state = emptyState();
    const obsByScan: Record<string, Observation[]> = {};
    const stepNames = ["after_scan1", "after_scan2", "after_scan3", "after_scan4"];

    ids.forEach((key, i) => {
      const scan = fx.scans[key];
      const { observations } = persistFlatScan(state, scan.records, {
        mode: "live",
        scanId: scan.id,
      });
      obsByScan[scan.id] = observations;
      expect(scansTable(state)).toMatchSnapshot(`${stepNames[i]}:scans`);
      expect(state.ledger).toMatchSnapshot(`${stepNames[i]}:ledger`);
      expect(obsTable(obsByScan)).toMatchSnapshot(`${stepNames[i]}:observations`);
      expect(state.episodes).toMatchSnapshot(`${stepNames[i]}:episodes`);
    });

    // Delete s2 -> replay survivors; identical to a ledger that never saw s2.
    const readPayload = (row: ScanRow) => {
      const key = ids.find((k) => fx.scans[k].id === row.scan_id)!;
      return envelope(fx.scans[key].records);
    };
    const del = deleteScansCore(state, [fx.scans.s2.id], readPayload, null);
    expect(del.result).toMatchSnapshot("delete_result");
    expect(scansTable(del.state)).toMatchSnapshot("after_delete:scans");
    expect(del.state.ledger).toMatchSnapshot("after_delete:ledger");
    expect(obsTable(del.observationsByScan)).toMatchSnapshot("after_delete:observations");
    expect(del.state.episodes).toMatchSnapshot("after_delete:episodes");
  });

  it("re-persisting an existing scan_id is a no-op returning stored deltas", () => {
    const state = emptyState();
    const first = persistFlatScan(state, fx.scans.s1.records, {
      mode: "live",
      scanId: fx.scans.s1.id,
    });
    const again = persistFlatScan(state, [], { mode: "live", scanId: fx.scans.s1.id });
    expect(again.deltas).toEqual(first.deltas);
    expect(again.scanRow).toBeNull();
    expect(state.scans.length).toBe(1);
  });
});

describe("compaction flow (SQLite fixture parity)", () => {
  const fx = fixture("ledger_compaction");
  const ids = ["s1", "s2", "s3", "s4"] as const;
  const now = Date.parse(fx.now);

  function build(): { state: LedgerState; obsByScan: Record<string, Observation[]> } {
    const state = emptyState();
    const obsByScan: Record<string, Observation[]> = {};
    for (const key of ids) {
      const scan = fx.scans[key];
      const { observations } = persistFlatScan(state, scan.records, {
        mode: "live",
        scanId: scan.id,
      });
      obsByScan[scan.id] = observations;
    }
    return { state, obsByScan };
  }

  const readPayload = (row: ScanRow) => {
    const key = ids.find((k) => fx.scans[k].id === row.scan_id);
    return key ? envelope(fx.scans[key].records) : null;
  };

  it("dry run computes the exact preview", () => {
    const { state, obsByScan } = build();
    const obsCountByScan = Object.fromEntries(
      Object.entries(obsByScan).map(([id, obs]) => [id, obs.length]),
    );
    const plan = compactLedgerCore(state, fx.retention_days, null, readPayload, {
      dryRun: true,
      now,
      compactionId: "cmp-test",
      obsCountByScan,
      // Sheets doesn't expose per-cell byte sizes, so this is an external measurement
      // the pure domain function can't derive itself -- previously the Python fixture's
      // own expected byte count fed back in as an input; now a fixed literal (the fixtures
      // no longer carry `expected` halves) with the same value.
      archiveBytes: 615,
    });
    expect(plan.result).toMatchSnapshot();
    expect(plan.state).toBeNull();
  });

  it("real run seals, converts episodes, and keeps the checkpoint faithful", () => {
    const { state, obsByScan } = build();
    const obsCountByScan = Object.fromEntries(
      Object.entries(obsByScan).map(([id, obs]) => [id, obs.length]),
    );
    const plan = compactLedgerCore(state, fx.retention_days, null, readPayload, {
      now,
      compactionId: "cmp-test",
      obsCountByScan,
    });
    expect(
      Object.fromEntries(
        Object.entries(plan.result).filter(
          ([k]) => !["archive_bytes_freed", "db_bytes_freed"].includes(k),
        ),
      ),
    ).toMatchSnapshot("real_result");

    const applied = plan.state!;
    expect(scansTable(applied)).toMatchSnapshot("after_compact:scans");
    expect(applied.ledger).toMatchSnapshot("after_compact:ledger");
    // Episodes: compare without the storage-specific compaction_id.
    expect(
      applied.episodes.map(({ compaction_id, ...rest }) => rest),
    ).toMatchSnapshot("after_compact:episodes");

    // Checkpoint parity (keyed by vuln_key; row order is storage-specific).
    expect(plan.checkpoint!.floor_scan_id).toMatchSnapshot("checkpoint_floor_scan_id");
    expect(plan.checkpoint!.floor_ts).toMatchSnapshot("checkpoint_floor_ts");
    const cpByKey = Object.fromEntries(plan.checkpoint!.ledger.map((r) => [r.vuln_key, r]));
    expect(cpByKey).toMatchSnapshot("checkpoint");

    // Sealed scans refuse deletion.
    expect(() =>
      deleteScansCore(applied, [fx.scans.s1.id], readPayload, plan.checkpoint),
    ).toThrow(SealedScanError);

    // Deleting a post-floor scan replays from the checkpoint.
    const del = deleteScansCore(applied, [fx.scans.s3.id], readPayload, plan.checkpoint, now);
    expect(del.result).toMatchSnapshot("delete_s3_result");
    expect(scansTable(del.state)).toMatchSnapshot("after_delete_s3:scans");
    expect(del.state.ledger).toMatchSnapshot("after_delete_s3:ledger");
    expect(
      del.state.episodes.map(({ compaction_id, ...rest }) => rest),
    ).toMatchSnapshot("after_delete_s3:episodes");
    expect(obsTable(del.observationsByScan)).toMatchSnapshot("after_delete_s3:observations");
  });

  it("baseRows surfaces episodes with the (compacted) placeholder", () => {
    const { state, obsByScan } = build();
    const plan = compactLedgerCore(state, fx.retention_days, null, readPayload, {
      now,
      compactionId: "cmp-test",
      obsCountByScan: Object.fromEntries(
        Object.entries(obsByScan).map(([id, obs]) => [id, obs.length]),
      ),
    });
    const rows = baseRows(plan.state!, now);
    const compacted = rows.filter((r) => r.asset_name === "(compacted)");
    expect(compacted.map((r) => r.vuln_key).sort()).toEqual(["id:B", "id:D"]);
    // Every episode carries the fields MTTR math reads.
    for (const r of compacted) {
      expect(r.status).toBe("RESOLVED");
      expect(r.mttr_days).not.toBeNull();
    }
  });
});
