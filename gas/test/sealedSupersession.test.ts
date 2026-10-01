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
import {
  pruneEpisodesCore,
  purgeCheckpointByKeys,
  purgeCheckpointForPrunedEpisodes,
} from "../src/domain/purge";
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
  const checkpoints: Checkpoint[] = [];
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
    checkpoints.push(plan.checkpoint!);
  }
  return { state, checkpoint, checkpoints, read };
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

// Pruning the superseded episode must not take the reopen that replaced it with it. The
// checkpoint the second compaction wrote holds a1's REOPENED lifecycle, and deleteScansCore
// seeds a1 from that row (the supersession is sealed, so the episode no longer masks it). Purge
// the row along with the episode and the finding vanished at the next scan deletion.
describe("pruning a superseded episode keeps the lifecycle that replaced it", () => {
  const steps: Step[] = [
    { records: ALL, ts: T(2) },
    { records: [resolvedNode(A1, T(3)), ...NO_A1], ts: T(3) }, // a1 fixed
    { records: NO_A1, ts: T(4) },
    { records: NO_A1, ts: T(5) },
    { compact: "c1", cutoff: T(3) }, // seals a1's resolution
    { records: ALL, ts: T(6) }, // a1 reopens
    { records: ALL, ts: T(7) },
    { records: ALL, ts: T(8) },
    { records: ALL, ts: T(9) },
    { records: NO_A1, ts: T(10) }, // and disappears: resolved again, not yet sealed
    { records: NO_A1, ts: T(11) },
    { records: NO_A1, ts: T(12) },
    { compact: "c2", cutoff: T(9) }, // seals the reopen while a1 is still open
  ];
  const criteria = { resolvedBeforeMs: Date.parse(T(4)), severities: null };

  function setup() {
    const { state, checkpoints, read } = run(steps);
    const out = pruneEpisodesCore(state, criteria);
    // The scenario did what it says: the one pruned episode is a1's first, sealed-superseded one.
    expect(out.pruned.map((e) => [e.vuln_key, e.resolved_at, e.superseded_by_scan])).toEqual([
      ["id:a1", T(3), T(6)],
    ]);
    expect(checkpoints.map((cp) => cp.ledger.find((r) => r.vuln_key === "id:a1")?.status)).toEqual([
      "RESOLVED",
      "OPEN",
    ]);
    expect(state.ledger["id:a1"]).toMatchObject({ status: "RESOLVED", resolved_at: T(10), reopened_count: 1 });
    return { state, out, checkpoints, read };
  }

  it("NEGATIVE CONTROL: purging the key from the newest checkpoint loses a1 on the next delete", () => {
    const { out, checkpoints, read } = setup();
    const cp = purgeCheckpointByKeys(checkpoints[1]!, new Set(out.prunedKeys)).checkpoint;
    const { state: rebuilt } = deleteScansCore(out.state, [T(12)], read, cp, Date.parse(T(20)));
    expect(rebuilt.ledger["id:a1"]).toBeUndefined();
  });

  it("purges the pruned lifecycle only from the checkpoints that hold it", () => {
    const { state, out, checkpoints } = setup();
    const [c1, c2] = checkpoints.map((cp) => purgeCheckpointForPrunedEpisodes(cp, out.pruned, state.scans));
    // c1 predates the reopen: its a1 row IS the pruned lifecycle.
    expect(c1!.removed).toBe(1);
    expect(c1!.checkpoint.ledger.some((r) => r.vuln_key === "id:a1")).toBe(false);
    // c2 sealed the reopening scan: its a1 row is the lifecycle that replaced the episode.
    expect(c2!.removed).toBe(0);
    expect(c2!.checkpoint).toEqual(checkpoints[1]);
  });

  it("a later scan deletion keeps a1's reopened lifecycle", () => {
    const { state, out, checkpoints, read } = setup();
    const cp = purgeCheckpointForPrunedEpisodes(checkpoints[1]!, out.pruned, state.scans).checkpoint;
    const { state: rebuilt } = deleteScansCore(out.state, [T(12)], read, cp, Date.parse(T(20)));
    expect(rebuilt.ledger["id:a1"]).toMatchObject({
      status: "RESOLVED",
      first_seen: T(1),
      resolved_at: T(10),
      reopened_count: 1,
    });
    // The row it was before the delete (T(12) never saw a1), but for the replay's
    // `first_scan_id` — see the second test above.
    expect({ ...rebuilt.ledger["id:a1"], first_scan_id: null }).toEqual({
      ...out.state.ledger["id:a1"],
      first_scan_id: null,
    });
    expect(rebuilt.episodes).toEqual(out.state.episodes);
    const keys = baseRows(rebuilt, Date.parse(T(20))).map((r) => r.vuln_key);
    expect(keys.filter((k) => k === "id:a1")).toHaveLength(1);
  });
});
