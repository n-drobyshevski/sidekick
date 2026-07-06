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
import { expectParity, fixture } from "./helpers";

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
      const expected = fx.steps[stepNames[i]];
      expectParity(scansTable(state), expected.scans);
      expectParity(state.ledger, expected.ledger);
      expectParity(obsTable(obsByScan), expected.observations);
      expectParity(state.episodes, expected.episodes);
    });

    // Delete s2 -> replay survivors; identical to a ledger that never saw s2.
    const readPayload = (row: ScanRow) => {
      const key = ids.find((k) => fx.scans[k].id === row.scan_id)!;
      return envelope(fx.scans[key].records);
    };
    const del = deleteScansCore(state, [fx.scans.s2.id], readPayload, null);
    expectParity(del.result, fx.steps.delete_result);
    const expected = fx.steps.after_delete_scan2;
    expectParity(scansTable(del.state), expected.scans);
    expectParity(del.state.ledger, expected.ledger);
    expectParity(obsTable(del.observationsByScan), expected.observations);
    expectParity(del.state.episodes, expected.episodes);
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
      archiveBytes: fx.expected.dry_run.archive_bytes_freed,
    });
    expectParity(plan.result, fx.expected.dry_run);
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
    expectParity(
      Object.fromEntries(
        Object.entries(plan.result).filter(
          ([k]) => !["archive_bytes_freed", "db_bytes_freed"].includes(k),
        ),
      ),
      fx.expected.real,
    );

    const applied = plan.state!;
    const expected = fx.expected.after_compact;
    expectParity(scansTable(applied), expected.scans);
    expectParity(applied.ledger, expected.ledger);
    // Episodes: compare without the storage-specific compaction_id.
    expectParity(
      applied.episodes.map(({ compaction_id, ...rest }) => rest),
      expected.episodes,
    );

    // Checkpoint parity (keyed by vuln_key; row order is storage-specific).
    expect(plan.checkpoint!.floor_scan_id).toBe(fx.expected.checkpoint.floor_scan_id);
    expect(plan.checkpoint!.floor_ts).toBe(fx.expected.checkpoint.floor_ts);
    const cpByKey = Object.fromEntries(plan.checkpoint!.ledger.map((r) => [r.vuln_key, r]));
    const expByKey = Object.fromEntries(
      fx.expected.checkpoint.ledger.map((r: any) => [r.vuln_key, r]),
    );
    expectParity(cpByKey, expByKey);

    // Sealed scans refuse deletion.
    expect(() =>
      deleteScansCore(applied, [fx.scans.s1.id], readPayload, plan.checkpoint),
    ).toThrow(SealedScanError);

    // Deleting a post-floor scan replays from the checkpoint.
    const del = deleteScansCore(applied, [fx.scans.s3.id], readPayload, plan.checkpoint, now);
    expectParity(del.result, fx.expected.delete_s3_result);
    const afterDel = fx.expected.after_delete_s3;
    expectParity(scansTable(del.state), afterDel.scans);
    expectParity(del.state.ledger, afterDel.ledger);
    expectParity(
      del.state.episodes.map(({ compaction_id, ...rest }) => rest),
      afterDel.episodes,
    );
    expectParity(obsTable(del.observationsByScan), afterDel.observations);
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
