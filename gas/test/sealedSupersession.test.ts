// A supersession a later compaction sealed survives delete-and-replay.
//
// A sealed episode is superseded by the scan that brought its finding back — a genuine reopen
// of a compacted resolution (ledgerCore.reconcileEpisodeCollisions). When a SECOND compaction
// then seals that scan, the replay after a delete never re-runs it, so the supersession cannot
// be re-derived: deleteScansCore has to keep it, and the live row the checkpoint holds for that
// key has to seed the rebuild. Reset instead, the old episode came back beside the new one and
// the finding was counted twice (or, still open at the second floor, lost its live row).
//
// Each scenario is checked for replay parity: run it, add one more scan, delete that scan — and
// the result must equal never having added it.

import { describe, expect, it } from "vitest";
import { baseRows, emptyState, persistFlatScan, scansAsc, type LedgerState } from "../src/domain/ledgerCore";
import type { Checkpoint } from "../src/domain/compaction";
import { compactLedgerCore, deleteScansCore, type PayloadReader } from "../src/domain/maintenance";
import type { Rec } from "../src/domain/util";

const DAY = 86_400_000;
const T = (day: number): string => new Date(Date.UTC(2026, 5, day)).toISOString().replace(".000Z", "Z");

function node(id: string, extra: Rec = {}): Rec {
  return {
    id,
    name: `CVE-2026-${id}`,
    severity: "HIGH",
    status: "OPEN",
    firstDetectedAt: T(1),
    vulnerableAsset: { id: `asset-${id}`, name: `host-${id}`, type: "VIRTUAL_MACHINE" },
    ...extra,
  };
}

const ALL = ["a1", "a2", "a3", "b1", "b2"].map((id) => node(id));
const A1 = ALL[0]!;
const NO_A1 = ALL.filter((n) => n["id"] !== "a1");
const resolvedNode = (n: Rec, at: string): Rec => ({ ...n, status: "RESOLVED", resolvedAt: at });
const envelope = (nodes: Rec[]) => ({ data: { vulnerabilityFindings: { nodes } } });

type Step = { records: Rec[]; ts: string } | { compact: string; cutoff: string };

function run(steps: Step[]) {
  let state = emptyState();
  let checkpoint: Checkpoint | null = null;
  const payloads = new Map<string, unknown>();
  const read: PayloadReader = (r) => payloads.get(r.scan_id) ?? null;
  for (const s of steps) {
    if ("records" in s) {
      payloads.set(s.ts, envelope(s.records));
      persistFlatScan(state, s.records, { mode: "live", scanId: s.ts });
      continue;
    }
    // 30 days is the retention floor, so the cutoff lands exactly on `s.cutoff`.
    const plan = compactLedgerCore(state, 30, checkpoint, read, {
      compactionId: s.compact,
      now: Date.parse(s.cutoff) + 30 * DAY,
    });
    expect(plan.result.no_op).toBe(false);
    state = plan.state!;
    checkpoint = plan.checkpoint;
  }
  return { state, checkpoint, read };
}

/** Run `steps`, add one more scan, delete it — and compare with never having added it. */
function parity(steps: Step[], extra: { records: Rec[]; ts: string }) {
  const twin = run(steps).state;
  const withExtra = run([...steps, extra]);
  const { state: rebuilt } = deleteScansCore(
    withExtra.state, [extra.ts], withExtra.read, withExtra.checkpoint, Date.parse(T(20)),
  );
  const keys = baseRows(rebuilt, Date.parse(T(20))).map((r) => r.vuln_key);
  return { twin, rebuilt, keys };
}

describe("a supersession a later compaction sealed survives delete-and-replay", () => {
  it("genuine reopen of a sealed episode, resolved again, that sealed too", () => {
    const steps: Step[] = [
      { records: ALL, ts: T(2) },
      { records: [resolvedNode(A1, T(3)), ...NO_A1], ts: T(3) }, // a1 fixed
      { records: NO_A1, ts: T(4) },
      { records: NO_A1, ts: T(5) },
      { compact: "c1", cutoff: T(3) }, // seals a1's resolution
      { records: ALL, ts: T(6) }, // a1 reopens
      { records: [resolvedNode(A1, T(7)), ...NO_A1], ts: T(7) }, // and is fixed again
      { records: NO_A1, ts: T(8) },
      { records: NO_A1, ts: T(9) },
      { compact: "c2", cutoff: T(7) }, // seals the scan that superseded it, and the second fix
    ];
    const { twin, rebuilt, keys } = parity(steps, { records: NO_A1, ts: T(10) });
    // The scenario did what it says: one superseded episode and one standing one.
    const a1 = twin.episodes.filter((e) => e.vuln_key === "id:a1");
    expect(a1.map((e) => [e.resolved_at, e.reopened_count, e.superseded_by_scan])).toEqual([
      [T(3), 0, T(6)],
      [T(7), 1, null],
    ]);
    expect(keys.filter((k) => k === "id:a1")).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rebuilt.episodes).toEqual(twin.episodes);
    expect(rebuilt.ledger).toEqual(twin.ledger);
    expect(scansAsc(rebuilt.scans)).toEqual(scansAsc(twin.scans));
  });

  it("genuine reopen sealed while the finding is still open keeps its live row", () => {
    const steps: Step[] = [
      { records: ALL, ts: T(2) },
      { records: [resolvedNode(A1, T(3)), ...NO_A1], ts: T(3) },
      { records: NO_A1, ts: T(4) },
      { records: NO_A1, ts: T(5) },
      { compact: "c1", cutoff: T(3) },
      { records: ALL, ts: T(6) }, // a1 reopens and stays open
      { records: ALL, ts: T(7) },
      { records: ALL, ts: T(8) },
      { compact: "c2", cutoff: T(6) },
    ];
    const { twin, rebuilt, keys } = parity(steps, { records: ALL, ts: T(9) });
    expect(twin.ledger["id:a1"]).toMatchObject({ status: "OPEN", reopened_count: 1 });
    expect(rebuilt.ledger["id:a1"]).toMatchObject({ status: "OPEN", reopened_count: 1 });
    expect(keys.filter((k) => k === "id:a1")).toHaveLength(1);
    expect(rebuilt.episodes).toEqual(twin.episodes);
    // Byte for byte but one column: the checkpoint replays without episodes, so it reaches a1's
    // reopen through reconcile's own reopen branch, which keeps the first lifecycle's
    // `first_scan_id` where the live collision path stamped the reopening scan.
    const sansFirstScan = (l: LedgerState["ledger"]) =>
      Object.fromEntries(Object.entries(l).map(([k, r]) => [k, { ...r, first_scan_id: null }]));
    expect(sansFirstScan(rebuilt.ledger)).toEqual(sansFirstScan(twin.ledger));
    // The replayed scans see a1 as the open row it was, never as a second reopen.
    expect(scansAsc(rebuilt.scans)).toEqual(scansAsc(twin.scans));
  });
});
