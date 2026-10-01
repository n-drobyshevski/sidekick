// The completeness gate before disappearance — the rule that decides when ABSENCE is allowed to
// resolve a finding (gas_shared/domain/scanCompleteness.ts, reconcile.ts's disappearance pass,
// ledgerCore.disappearanceWindow).
//
// Hand-written throughout: the Python this register was ported from had no gate, so there is no
// golden to compare against. Every scenario is a short sequence of scans over three hosts, small
// enough that each expected value can be read off the records in the test itself. Ported from
// gas_devsecops/test/scanCompleteness.test.ts minus the repository drop-out, which gas/ does not
// have (by decision).

import { describe, expect, it } from "vitest";
import {
  assessCompleteness,
  completenessTolerance,
  disappearanceValue,
  distinctNodes,
  readDisappearance,
} from "../../gas_shared/domain/scanCompleteness";
import { coerceScan } from "../src/domain/importMerge";
import { buildMigrationBundle } from "../src/domain/exportBundle";
import {
  baseRows,
  disappearanceWindow,
  emptyState,
  newestFlatScanBySeverity,
  persistFlatScan,
  persistGroupedScan,
  prevScanIdBySeverity,
  scansAsc,
  type LedgerState,
  type ScanRow,
} from "../src/domain/ledgerCore";
import { buildCheckpoint, deleteScansCore, type PayloadReader } from "../src/domain/maintenance";
import { mergeNodes } from "../src/domain/transform";
import type { Rec } from "../src/domain/util";

// --------------------------------------------------------------------------- fixtures

const T = (day: number): string => new Date(Date.UTC(2026, 5, day)).toISOString().replace(".000Z", "Z");

/** One finding on a host. `id` is the Wiz node id, so the ledger key is `id:<id>`. */
function node(id: string, host: string, severity = "HIGH", extra: Rec = {}): Rec {
  return {
    id,
    name: `CVE-2026-${id}`,
    severity,
    status: "OPEN",
    firstDetectedAt: T(1),
    vulnerableAsset: { id: `vm-${host}`, name: `host-${host}`, type: "VIRTUAL_MACHINE" },
    ...extra,
  };
}

/** Host A: a1..a4. Host B: b1..b3. Host C: c1, c2. */
const A = ["a1", "a2", "a3", "a4"].map((id) => node(id, "A"));
const B = ["b1", "b2", "b3"].map((id) => node(id, "B"));
const C = ["c1", "c2"].map((id) => node(id, "C"));
const ALL = [...A, ...B, ...C];

type Completeness = { reportedTotal: number | null; partialPages: number };
const complete = (n: number): Completeness => ({ reportedTotal: n, partialPages: 0 });
const SCOPE = ["CRITICAL", "HIGH"];

function live(
  state: LedgerState,
  records: Rec[],
  ts: string,
  completeness: Completeness = complete(records.length),
) {
  return persistFlatScan(state, records, {
    mode: "live",
    scanId: ts,
    scannedSeverities: SCOPE,
    completeness,
  });
}

const row = (state: LedgerState, id: string) => state.ledger[`id:${id}`]!;
const statuses = (state: LedgerState, ids: string[]) => ids.map((id) => row(state, id).status);

// --------------------------------------------------------------------------- the gate itself

describe("assessCompleteness — the three reasons and their tolerance edges", () => {
  const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));

  it("empty: no records while open rows exist — unless the tenant reported a total of 0", () => {
    expect(assessCompleteness({ records: [], reportedTotal: null, partialPages: 0, priorOpen: 4 }).reason)
      .toBe("empty");
    expect(assessCompleteness({ records: [], reportedTotal: 12, partialPages: 0, priorOpen: 4 }).reason)
      .toBe("empty");
    expect(assessCompleteness({ records: [], reportedTotal: 0, partialPages: 0, priorOpen: 4 }).reason)
      .toBeNull();
    expect(assessCompleteness({ records: [], reportedTotal: null, partialPages: 0, priorOpen: 0 }).reason)
      .toBeNull();
  });

  it("short: fewer distinct nodes than the reported total minus max(5, 1%)", () => {
    expect(completenessTolerance(1000)).toBe(10);
    expect(assessCompleteness({ records: nodes(990), reportedTotal: 1000, partialPages: 0, priorOpen: 0 }).reason)
      .toBeNull();
    expect(assessCompleteness({ records: nodes(989), reportedTotal: 1000, partialPages: 0, priorOpen: 0 }).reason)
      .toBe("short");
    expect(completenessTolerance(100)).toBe(5);
    expect(assessCompleteness({ records: nodes(95), reportedTotal: 100, partialPages: 0, priorOpen: 0 }).reason)
      .toBeNull();
    expect(assessCompleteness({ records: nodes(94), reportedTotal: 100, partialPages: 0, priorOpen: 0 }).reason)
      .toBe("short");
  });

  it("a partial page disables short — its count is suspect", () => {
    expect(assessCompleteness({ records: nodes(50), reportedTotal: 127, partialPages: 1, priorOpen: 0 }).reason)
      .toBeNull();
  });

  it("duplicates: more repeated node ids than max(5, 1%) of the records", () => {
    expect(assessCompleteness({ records: [...nodes(100), ...nodes(5)], reportedTotal: null, partialPages: 0, priorOpen: 0 }))
      .toEqual({ reason: null, distinct: 100, duplicates: 5 });
    expect(assessCompleteness({ records: [...nodes(100), ...nodes(6)], reportedTotal: null, partialPages: 0, priorOpen: 0 }).reason)
      .toBe("duplicates");
    expect(distinctNodes([{}, {}])).toEqual({ distinct: 2, duplicates: 0 });
  });

  it("the stored verdict round-trips, and a blank cell is a LEGACY row", () => {
    expect(disappearanceValue(null)).toBe("complete");
    expect(disappearanceValue("empty")).toBe("deferred:empty");
    expect(readDisappearance("deferred:empty")).toEqual({ legacy: false, deferred: true, reason: "empty" });
    for (const blank of [null, undefined, ""]) {
      expect(readDisappearance(blank)).toEqual({ legacy: true, deferred: false, reason: null });
    }
  });
});

// --------------------------------------------------------------------------- at persist

describe("each reason, as gas's persistFlatScan applies it", () => {
  it("an EMPTY full scan — the wrong project, an expired filter — defers instead of resolving everything", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    const out = live(state, [], T(3), { reportedTotal: null, partialPages: 0 });
    expect(out.scanRow).toMatchObject({
      disappearance: "deferred:empty",
      reported_total: null,
      partial_pages: 0,
      duplicates: 0,
      resolved_count: 0,
    });
    expect(out.absent).toBe(ALL.length);
    expect(Object.values(state.ledger).every((r) => r.status === "OPEN")).toBe(true);
  });

  it("…while a tenant that REPORTED a total of 0 has measured everything gone, and it resolves", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    const out = live(state, [], T(3), complete(0));
    expect(out.scanRow!.disappearance).toBe("complete");
    expect(out.deltas.resolved_count).toBe(ALL.length);
  });

  it("short: 9 rows against a total of 14 is inside the 5-row floor; against 15 it is not", () => {
    const inside = emptyState();
    live(inside, ALL, T(2));
    expect(live(inside, ALL, T(3), complete(14)).scanRow!.disappearance).toBe("complete");

    const state = emptyState();
    live(state, ALL, T(2));
    const out = live(state, A, T(3), complete(15)); // 4 of 15
    expect(out.scanRow).toMatchObject({ disappearance: "deferred:short", reported_total: 15 });
    expect(statuses(state, ["b1", "c1"])).toEqual(["OPEN", "OPEN"]);
    expect(out.absent).toBe(5);
  });

  it("a partial page disables short: the same 4-of-15 scan with one partial page resolves", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    const out = live(state, A, T(3), { reportedTotal: 15, partialPages: 1 });
    expect(out.scanRow).toMatchObject({ disappearance: "complete", partial_pages: 1 });
    expect(out.deltas.resolved_count).toBe(5);
  });

  it("duplicates: five repeated ids pass (the 5-row floor), six defer", () => {
    const ok = emptyState();
    live(ok, ALL, T(2));
    const five = live(ok, [...ALL, ...A, B[0]!], T(3), { reportedTotal: null, partialPages: 0 });
    expect(five.scanRow).toMatchObject({ disappearance: "complete", duplicates: 5 });

    const state = emptyState();
    live(state, ALL, T(2));
    // Six repeats of A and B — and C missing, which is exactly what a cursor that walks rows
    // twice tends to cost.
    const six = live(state, [...A, ...B, ...A, B[0]!, B[1]!], T(3), { reportedTotal: null, partialPages: 0 });
    expect(six.scanRow).toMatchObject({ disappearance: "deferred:duplicates", duplicates: 6 });
    expect(statuses(state, ["c1", "c2"])).toEqual(["OPEN", "OPEN"]);
  });
});

// --------------------------------------------------------------------------- the window

describe("a deferred scan lands what it saw; the next complete scan resolves across the window", () => {
  it("resolves everything missed since the last complete scan, at the complete scan's ts", () => {
    const state = emptyState();
    live(state, ALL, T(2)); // complete
    // Deferred: returns A and C and a NEW finding a5; misses B.
    const deferred = live(state, [...A, ...C, node("a5", "A")], T(3), complete(20));
    expect(deferred.scanRow!.disappearance).toBe("deferred:short");
    expect(deferred.deltas).toEqual({ new_count: 1, resolved_count: 0, reopened_count: 0 });
    // Complete: returns A only. Missing now:
    //   b1..b3  last seen at T(2), absent through the deferred scan  -> window member T(2)
    //   c1, c2  last seen in the DEFERRED scan T(3)                  -> window member T(3)
    //   a5      first and last seen in the deferred scan              -> window member T(3)
    const out = live(state, A, T(4));
    expect(out.scanRow!.disappearance).toBe("complete");
    for (const id of ["b1", "b2", "b3", "c1", "c2", "a5"]) {
      expect(row(state, id)).toMatchObject({ status: "RESOLVED", resolution_src: "disappeared", resolved_at: T(4) });
    }
    expect(out.deltas.resolved_count).toBe(6);
    expect(out.absent).toBe(6);
  });

  it("keeps per-severity coverage: a severity no deferred scan looked at keeps its one-scan window", () => {
    const state = emptyState();
    // Complete, unscoped: sees a HIGH and a MEDIUM.
    persistFlatScan(state, [node("h1", "A"), node("m1", "A", "MEDIUM")], {
      mode: "live", scanId: T(2), scannedSeverities: null, completeness: complete(2),
    });
    // Deferred, HIGH-only.
    persistFlatScan(state, [], {
      mode: "live", scanId: T(3), scannedSeverities: ["HIGH"],
      completeness: { reportedTotal: null, partialPages: 0 },
    });
    const w = disappearanceWindow(state.scans)!;
    expect(w.bySeverity["HIGH"]).toEqual([T(3), T(2)]);
    expect(w.bySeverity["MEDIUM"]).toEqual([T(2)]);
    expect(w.fallback).toEqual([T(3), T(2)]);
    // A complete HIGH-only scan that measured nothing left resolves h1 across the window, and
    // leaves the MEDIUM row alone — nobody looked for it.
    const out = persistFlatScan(state, [], {
      mode: "live", scanId: T(4), scannedSeverities: ["HIGH"], completeness: complete(0),
    });
    expect(out.deltas.resolved_count).toBe(1);
    expect(row(state, "h1").status).toBe("RESOLVED");
    expect(row(state, "m1").status).toBe("OPEN");
  });

  it("a register that never deferred gets exactly prevScanIdBySeverity's one-scan window", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    live(state, ALL, T(3));
    persistFlatScan(state, ALL, { mode: "live", scanId: T(4), scannedSeverities: null });
    persistGroupedScan(state, [], { mode: "live", scanId: T(5) });
    const w = disappearanceWindow(state.scans)!;
    const prev = prevScanIdBySeverity(state.scans)!;
    for (const [sev, id] of Object.entries(prev)) expect(w.bySeverity[sev]).toEqual([id]);
    expect(Object.keys(w.bySeverity).sort()).toEqual(Object.keys(prev).sort());
    expect(w.fallback).toEqual([T(5)]);
  });
});

// --------------------------------------------------------------------------- legacy

describe("legacy behaviour is unchanged", () => {
  it("a caller that passes no completeness gets no gate and null record columns", () => {
    const state = emptyState();
    persistFlatScan(state, ALL, { mode: "dry-run", scanId: T(2) });
    const out = persistFlatScan(state, A, { mode: "dry-run", scanId: T(3) });
    expect(out.scanRow).toMatchObject({
      reported_total: null, partial_pages: null, duplicates: null, disappearance: null,
    });
    expect(out.deltas.resolved_count).toBe(5);
  });

  it("an empty legacy scan still resolves everything, exactly as before the gate", () => {
    const state = emptyState();
    persistFlatScan(state, ALL, { mode: "live", scanId: T(2) });
    const out = persistFlatScan(state, [], { mode: "live", scanId: T(3) });
    expect(out.deltas.resolved_count).toBe(ALL.length);
  });

  it("a blank stored verdict replays as a legacy row: no gate, nothing written back", () => {
    const state = emptyState();
    persistFlatScan(state, ALL, { mode: "live", scanId: T(2) });
    const out = persistFlatScan(state, [], {
      mode: "live", scanId: T(3),
      stored: { reported_total: null, partial_pages: null, duplicates: null, disappearance: null },
    });
    expect(out.scanRow!.disappearance).toBeNull();
    expect(out.deltas.resolved_count).toBe(ALL.length);
  });
});

// --------------------------------------------------------------------------- incremental

describe("a quick refresh inherits its baseline's verdict instead of being gated", () => {
  /** The scan job's merge: the baseline's records with the delta laid over them. */
  const incremental = (
    state: LedgerState, baseline: Rec[], delta: Rec[], ts: string, baselineTs: string,
  ) => {
    const base = state.scans.find((s) => s.scan_id === baselineTs)!;
    return persistFlatScan(state, mergeNodes(baseline, delta), {
      mode: "incremental",
      scanId: ts,
      scannedSeverities: SCOPE,
      incremental: {
        baselineDisappearance: base.disappearance ?? null,
        partialPages: 0,
        duplicates: distinctNodes(delta).duplicates,
      },
    });
  };

  it("on a complete baseline it is complete and closes only what the API closed", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    const fixed = { ...A[0]!, status: "RESOLVED", resolvedAt: T(3) };
    const out = incremental(state, ALL, [fixed], T(3), T(2));
    expect(out.scanRow).toMatchObject({
      disappearance: "complete", reported_total: null, partial_pages: 0, duplicates: 0,
    });
    expect(out.absent).toBe(0);
    expect(out.deltas.resolved_count).toBe(1);
    expect(row(state, "a1").resolution_src).toBe("api");
  });

  it("on a DEFERRED baseline it is deferred too: the merged set carries the baseline's gaps", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    live(state, A, T(3), complete(20)); // deferred: misses B and C
    const out = incremental(state, A, [C[0]!], T(4), T(3));
    expect(out.scanRow!.disappearance).toBe("deferred:short");
    // b1..b3 and c2 were never seen by the baseline; resolving them here would publish the
    // deferred scan's gaps as fixes one scan late.
    expect(statuses(state, ["b1", "b2", "b3", "c2"])).toEqual(["OPEN", "OPEN", "OPEN", "OPEN"]);
    expect(out.absent).toBe(4);
    // And the next complete full scan resolves them across the whole window.
    const full = live(state, [...A, ...C], T(5));
    expect(full.deltas.resolved_count).toBe(3);
    expect(statuses(state, ["b1", "c2"])).toEqual(["RESOLVED", "OPEN"]);
  });
});

// --------------------------------------------------------------------------- replay

describe("replay re-applies the stored verdict — live persist, delete-and-replay and checkpoint agree", () => {
  /**
   * Five scans with a deferral in the middle, then a sixth to delete. Deleting it replays the
   * five from their archived payloads alone; without the stored verdict the deferred scan would
   * replay as a legacy one and resolve B and C on the spot.
   */
  function sequence(): { state: LedgerState; payloads: Map<string, Rec[]> } {
    const state = emptyState();
    const payloads = new Map<string, Rec[]>();
    const step = (records: Rec[], ts: string, completeness: Completeness) => {
      payloads.set(ts, records);
      live(state, records, ts, completeness);
    };
    step(ALL, T(2), complete(ALL.length));
    step(A, T(3), complete(20)); // deferred: short
    step([...A, ...C], T(4), complete(6)); // complete: B resolves across the window
    step(ALL, T(5), complete(ALL.length)); // B returns: reopened
    step([], T(6), { reportedTotal: null, partialPages: 0 }); // deferred: empty
    return { state, payloads };
  }

  const reader = (payloads: Map<string, Rec[]>): PayloadReader =>
    (r: ScanRow) => {
      const records = payloads.get(r.scan_id);
      return records ? { data: { vulnerabilityFindings: { nodes: records } } } : null;
    };

  it("the live sequence did what the scenario says", () => {
    const { state } = sequence();
    expect(scansAsc(state.scans).map((s) => s.disappearance)).toEqual([
      "complete", "deferred:short", "complete", "complete", "deferred:empty",
    ]);
    expect(scansAsc(state.scans).map((s) => s.resolved_count)).toEqual([0, 0, 3, 0, 0]);
    expect(row(state, "b1")).toMatchObject({ status: "OPEN", reopened_count: 1 });
    expect(Object.values(state.ledger).every((r) => r.status === "OPEN")).toBe(true);
  });

  it("delete-and-replay reproduces the live ledger and scan rows byte for byte", () => {
    const { state: twin } = sequence();
    const { state, payloads } = sequence();
    payloads.set(T(7), A);
    live(state, A, T(7)); // the scan to delete
    const { state: rebuilt } = deleteScansCore(state, [T(7)], reader(payloads), null, Date.parse(T(20)));
    expect(rebuilt.ledger).toEqual(twin.ledger);
    expect(scansAsc(rebuilt.scans)).toEqual(scansAsc(twin.scans));
  });

  it("the checkpoint replay reaches the same ledger as the live sequence", () => {
    const { state, payloads } = sequence();
    const rows = scansAsc(state.scans);
    const floor = rows[rows.length - 1]!;
    const cp = buildCheckpoint(rows, rows, null, floor, reader(payloads));
    const byKey = Object.fromEntries(cp.ledger.map((r) => [r.vuln_key, r]));
    expect(byKey).toEqual(state.ledger);
  });

  it("a migration bundle carries the verdict, and the importer reads it back", () => {
    const { state } = sequence();
    const bundle = buildMigrationBundle(state, [], { exportedAt: T(20) });
    expect(bundle.scans.map((s) => s["disappearance"])).toEqual([
      "complete", "deferred:short", "complete", "complete", "deferred:empty",
    ]);
    const back = bundle.scans.map((s) => coerceScan(s));
    expect(back.map((s) => s.disappearance)).toEqual(bundle.scans.map((s) => s["disappearance"]));
    expect(back[1]).toMatchObject({ reported_total: 20, partial_pages: 0, duplicates: 0, sealed: 1 });
    // A bundle from before the gate (migrate.py's, or an older export) carries no verdict:
    // legacy, not "complete" and not a zero.
    expect(coerceScan({ scan_id: T(2), ts: T(2) })).toMatchObject({
      reported_total: null, partial_pages: null, duplicates: null, disappearance: null,
    });
  });
});

// --------------------------------------------------------------------------- observation

describe("a deferred newest scan does not make what it missed unobserved", () => {
  it("the newest-scan map carries the window back to the last complete scan, only when deferred", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    live(state, ALL, T(3));
    // Never deferred: the map is what it always was — no window field at all.
    expect(newestFlatScanBySeverity(state.scans)["HIGH"]).toEqual({ scan_id: T(3), ts: T(3) });
    live(state, A, T(4), complete(20)); // deferred
    expect(newestFlatScanBySeverity(state.scans)["HIGH"]).toEqual({
      scan_id: T(4), ts: T(4), window_ids: [T(4), T(3)],
    });
  });

  it("a row last seen in the complete scan before a deferred one is still observed", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    live(state, A, T(3), complete(20)); // deferred: misses B and C
    const rows = baseRows(state, Date.parse(T(10)), newestFlatScanBySeverity(state.scans));
    const b1 = rows.find((r) => r.vuln_key === "id:b1")!;
    expect(b1).toMatchObject({ status: "OPEN", observed: true });
    // …and once a complete scan has adjudicated them, the window closes behind it.
    live(state, A, T(4));
    expect(newestFlatScanBySeverity(state.scans)["HIGH"]).toEqual({ scan_id: T(4), ts: T(4) });
  });
});
