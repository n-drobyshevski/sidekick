// The completeness gate and the repository drop-out — the two rules that decide when ABSENCE
// is allowed to resolve a finding (src/domain/scanCompleteness.ts, reconcile.ts's absence
// pass, ledgerCore.disappearanceWindow).
//
// Hand-written throughout: gas/ and brick have no golden for either rule. Every scenario is a
// short sequence of sca scans over three repositories, small enough that each expected value
// can be read off the records in the test itself.

import { describe, expect, it } from "vitest";
import {
  DROPOUT_MIN_OPEN,
  RESOLUTION_DISAPPEARED,
  RESOLUTION_REPO_DROPOUT,
} from "../src/domain/config";
import {
  baseRows,
  disappearanceWindow,
  emptyState,
  persistFlatScan,
  prevScanIdBySeverity,
  scansAsc,
} from "../src/domain/ledgerCore";
import type { LedgerState, ScanRow } from "../src/domain/ledgerTypes";
import { mttrFromLedger } from "../src/domain/lifecycle";
import {
  buildCheckpoint,
  deleteScansCore,
  toEpisodeRow,
  type PayloadReader,
} from "../src/domain/maintenance";
import { movementDecomposition } from "../src/domain/movementDecomposition";
import { capacityByMonth, confusionMatrix, type RiskRow } from "../src/domain/program";
import { kaplanMeier } from "../src/domain/remediation";
import {
  assessCompleteness,
  completenessTolerance,
  disappearanceValue,
  distinctNodes,
  readDisappearance,
} from "../src/domain/scanCompleteness";
import { cohortSlaAttainment, trendFromFrames } from "../src/domain/trend";
import type { Rec } from "../src/domain/util";

// --------------------------------------------------------------------------- fixtures

const T = (day: number): string => new Date(Date.UTC(2026, 5, day)).toISOString().replace(".000Z", "Z");

/** One sca node on a repository. `id` is the finding; `repo` is the vulnerableAsset id. */
function node(id: string, repo: string, severity = "HIGH", extra: Rec = {}): Rec {
  return {
    id,
    name: `CVE-${id}`,
    severity,
    status: "OPEN",
    firstDetectedAt: T(1),
    vulnerableAsset: { id: repo, name: `org/${repo}`, type: "REPOSITORY" },
    ...extra,
  };
}

/** Repo A: a1..a4. Repo B: b1..b3. Repo C: c1, c2 — below the drop-out threshold. */
const A = ["a1", "a2", "a3", "a4"].map((id) => node(id, "A"));
const B = ["b1", "b2", "b3"].map((id) => node(id, "B"));
const C = ["c1", "c2"].map((id) => node(id, "C"));
const ALL = [...A, ...B, ...C];

type Completeness = { reportedTotal: number | null; partialPages: number };
const complete = (n: number): Completeness => ({ reportedTotal: n, partialPages: 0 });

function live(
  state: LedgerState,
  records: Rec[],
  ts: string,
  completeness: Completeness = complete(records.length),
) {
  return persistFlatScan(state, records, {
    scope: "sca",
    mode: "live",
    scanId: ts,
    scannedSeverities: ["CRITICAL", "HIGH"],
    completeness,
  });
}

const row = (state: LedgerState, id: string) => state.ledger[`sca:id:${id}`]!;

// --------------------------------------------------------------------------- the gate

describe("assessCompleteness — the three reasons, first match wins", () => {
  const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }));

  it("empty: no records while open rows exist", () => {
    expect(assessCompleteness({ records: [], reportedTotal: null, partialPages: 0, priorOpen: 4 }).reason)
      .toBe("empty");
    expect(assessCompleteness({ records: [], reportedTotal: 12, partialPages: 0, priorOpen: 4 }).reason)
      .toBe("empty");
  });

  it("empty is NOT a deferral when the tenant reported a total of 0 — that is a measurement", () => {
    expect(assessCompleteness({ records: [], reportedTotal: 0, partialPages: 0, priorOpen: 4 }).reason)
      .toBeNull();
  });

  it("empty is not a deferral on a register with nothing open to lose", () => {
    expect(assessCompleteness({ records: [], reportedTotal: null, partialPages: 0, priorOpen: 0 }).reason)
      .toBeNull();
  });

  it("short: fewer distinct nodes than the reported total minus max(5, 1%)", () => {
    // total 1,000 -> tolerance 10: 990 is inside it, 989 is not.
    expect(completenessTolerance(1000)).toBe(10);
    expect(assessCompleteness({ records: nodes(990), reportedTotal: 1000, partialPages: 0, priorOpen: 0 }).reason)
      .toBeNull();
    expect(assessCompleteness({ records: nodes(989), reportedTotal: 1000, partialPages: 0, priorOpen: 0 }).reason)
      .toBe("short");
    // A small register gets the absolute floor: total 100 -> tolerance 5.
    expect(completenessTolerance(100)).toBe(5);
    expect(assessCompleteness({ records: nodes(95), reportedTotal: 100, partialPages: 0, priorOpen: 0 }).reason)
      .toBeNull();
    expect(assessCompleteness({ records: nodes(94), reportedTotal: 100, partialPages: 0, priorOpen: 0 }).reason)
      .toBe("short");
  });

  it("a partial page disables short — SAST returns one on every run (PROBE_FINDINGS.md §12.3)", () => {
    expect(assessCompleteness({ records: nodes(50), reportedTotal: 127, partialPages: 1, priorOpen: 0 }).reason)
      .toBeNull();
  });

  it("short needs a reported total: none, or a reported 0, is not a comparison", () => {
    expect(assessCompleteness({ records: nodes(3), reportedTotal: null, partialPages: 0, priorOpen: 0 }).reason)
      .toBeNull();
  });

  it("duplicates: more repeated node ids than max(5, 1%) of the records", () => {
    const five = [...nodes(100), ...nodes(5)]; // 105 records, 5 repeats, tolerance 5
    expect(assessCompleteness({ records: five, reportedTotal: null, partialPages: 0, priorOpen: 0 }))
      .toEqual({ reason: null, distinct: 100, duplicates: 5 });
    const six = [...nodes(100), ...nodes(6)];
    expect(assessCompleteness({ records: six, reportedTotal: null, partialPages: 0, priorOpen: 0 }).reason)
      .toBe("duplicates");
  });

  it("distinct counts node ids, so secrets twins (two ids, one ledger key) are not duplicates", () => {
    const twinA = { id: "x1", secretDataId: "s", path: "p", lineNumber: 1, resource: { type: "REPOSITORY" } };
    const twinB = { id: "x2", secretDataId: "s", path: "p", lineNumber: 1, resource: { type: "REPOSITORY_BRANCH" } };
    expect(distinctNodes([twinA, twinB])).toEqual({ distinct: 2, duplicates: 0 });
    // And a node with no id is never merged with another.
    expect(distinctNodes([{}, {}])).toEqual({ distinct: 2, duplicates: 0 });
  });

  it("the stored verdict round-trips, and a blank cell is a LEGACY row", () => {
    expect(disappearanceValue(null)).toBe("complete");
    expect(disappearanceValue("short")).toBe("deferred:short");
    expect(readDisappearance("deferred:short")).toEqual({ legacy: false, deferred: true, reason: "short" });
    expect(readDisappearance("complete")).toEqual({ legacy: false, deferred: false, reason: null });
    for (const blank of [null, undefined, ""]) {
      expect(readDisappearance(blank)).toEqual({ legacy: true, deferred: false, reason: null });
    }
  });
});

// --------------------------------------------------------------------------- deferral

describe("a deferred scan lands what it saw and resolves nothing by absence", () => {
  it("records the verdict and the fetch's own account on the scan row", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    // Wiz says 20, the scan holds 4: short by more than the 5-row floor.
    const out = live(state, A, T(3), complete(20));
    expect(out.scanRow).toMatchObject({
      disappearance: "deferred:short",
      reported_total: 20,
      partial_pages: 0,
      duplicates: 0,
      dropout_count: null,
      resolved_count: 0,
    });
    // B and C are absent, held open, and counted as such.
    expect(out.absence).toEqual({ absent: 5, dropouts: 0, dropoutRepos: 0, resumed: 0 });
    for (const id of ["b1", "c1"]) expect(row(state, id).status).toBe("OPEN");
  });

  it("an empty scan defers rather than resolving the whole register", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    const out = live(state, [], T(3), { reportedTotal: null, partialPages: 0 });
    expect(out.scanRow!.disappearance).toBe("deferred:empty");
    expect(Object.values(state.ledger).every((r) => r.status === "OPEN")).toBe(true);
  });

  it("the next complete scan resolves across the WHOLE window since the last complete one", () => {
    const state = emptyState();
    live(state, ALL, T(2)); // complete
    // Deferred: returns A and C and a NEW finding a5; misses B.
    live(state, [...A, ...C, node("a5", "A")], T(3), complete(20));
    // Complete: returns A only (a1..a4). Missing now:
    //   b1..b3  last seen at T(2), absent through the deferred scan  -> window member T(2)
    //   c1, c2  last seen in the DEFERRED scan T(3)                  -> window member T(3)
    //   a5      first and last seen in the deferred scan              -> window member T(3)
    const out = live(state, A, T(4));
    expect(out.scanRow!.disappearance).toBe("complete");
    for (const id of ["c1", "c2", "a5"]) {
      expect(row(state, id)).toMatchObject({ status: "RESOLVED", resolution_src: RESOLUTION_DISAPPEARED, resolved_at: T(4) });
    }
    // B vanished whole, with three open findings: a drop-out, not three fixes.
    for (const id of ["b1", "b2", "b3"]) {
      expect(row(state, id)).toMatchObject({ status: "RESOLVED", resolution_src: RESOLUTION_REPO_DROPOUT });
    }
    expect(out.deltas.resolved_count).toBe(3); // c1, c2, a5 — the drop-outs are apart
    expect(out.scanRow!.dropout_count).toBe(3);
    expect(out.absence).toMatchObject({ absent: 6, dropouts: 3, dropoutRepos: 1 });
  });

  it("the window keeps per-severity coverage: a severity no deferred scan looked at is unaffected", () => {
    const state = emptyState();
    // Complete, unscoped: sees a HIGH and a MEDIUM.
    persistFlatScan(state, [node("h1", "A"), node("m1", "A", "MEDIUM")], {
      scope: "sca", mode: "live", scanId: T(2), scannedSeverities: null, completeness: complete(2),
    });
    // Deferred, HIGH-only.
    persistFlatScan(state, [], {
      scope: "sca", mode: "live", scanId: T(3), scannedSeverities: ["HIGH"],
      completeness: { reportedTotal: null, partialPages: 0 },
    });
    const w = disappearanceWindow(state.scans, "sca")!;
    // HIGH: the deferred scan, then back to the complete one. MEDIUM: only the complete one —
    // the HIGH-only scan never looked for it, so it is not in MEDIUM's window at all.
    expect(w.bySeverity["HIGH"]).toEqual([T(3), T(2)]);
    expect(w.bySeverity["MEDIUM"]).toEqual([T(2)]);
    expect(w.fallback).toEqual([T(3), T(2)]);
  });

  it("a register that never deferred gets exactly prevScanIdBySeverity's one-scan window", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    live(state, ALL, T(3));
    persistFlatScan(state, ALL, { scope: "sca", mode: "live", scanId: T(4), scannedSeverities: null });
    const w = disappearanceWindow(state.scans, "sca")!;
    const prev = prevScanIdBySeverity(state.scans, "sca")!;
    for (const [sev, id] of Object.entries(prev)) expect(w.bySeverity[sev]).toEqual([id]);
    expect(Object.keys(w.bySeverity).sort()).toEqual(Object.keys(prev).sort());
    expect(w.fallback).toEqual([T(4)]);
  });
});

// --------------------------------------------------------------------------- legacy

describe("legacy behaviour is unchanged", () => {
  it("a caller that passes no completeness gets no gate, no drop-out, and null record columns", () => {
    const state = emptyState();
    persistFlatScan(state, ALL, { scope: "sca", mode: "live", scanId: T(2) });
    // B vanishes whole — legacy rules resolve it by disappearance, as before.
    const out = persistFlatScan(state, [...A, ...C], { scope: "sca", mode: "live", scanId: T(3) });
    expect(out.scanRow).toMatchObject({
      reported_total: null, partial_pages: null, duplicates: null, disappearance: null, dropout_count: null,
    });
    for (const id of ["b1", "b2", "b3"]) expect(row(state, id).resolution_src).toBe(RESOLUTION_DISAPPEARED);
    expect(out.deltas.resolved_count).toBe(3);
  });

  it("an empty legacy scan still resolves everything, exactly as before the gate", () => {
    const state = emptyState();
    persistFlatScan(state, ALL, { scope: "sca", mode: "live", scanId: T(2) });
    const out = persistFlatScan(state, [], { scope: "sca", mode: "live", scanId: T(3) });
    expect(out.deltas.resolved_count).toBe(ALL.length);
  });
});

// --------------------------------------------------------------------------- drop-out

describe("repository drop-out", () => {
  it(`needs at least ${DROPOUT_MIN_OPEN} absent open rows — a smaller repository resolves normally`, () => {
    const state = emptyState();
    live(state, ALL, T(2));
    const out = live(state, [...A, ...B], T(3)); // C (two findings) vanishes whole
    for (const id of ["c1", "c2"]) expect(row(state, id).resolution_src).toBe(RESOLUTION_DISAPPEARED);
    expect(out.scanRow!.dropout_count).toBe(0);
    expect(out.deltas.resolved_count).toBe(2);
  });

  it("is not a drop-out while the repository still returns any node", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    // A keeps one finding and loses three: those are fixes on a repository still in view.
    live(state, [A[0]!, ...B, ...C], T(3));
    for (const id of ["a2", "a3", "a4"]) expect(row(state, id).resolution_src).toBe(RESOLUTION_DISAPPEARED);
  });

  it("closes the rows with no MTTR clock and outside every remediation figure", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    live(state, [...A, ...C], T(10)); // B leaves; nothing else moves
    live(state, [...A], T(12)); // C (two) resolves normally — the one real fix population
    const base = baseRows(state, { now: Date.parse(T(20)) });
    const b1 = base.find((r) => r.finding_key === "sca:id:b1")!;
    expect(b1).toMatchObject({
      status: "RESOLVED",
      resolution_src: RESOLUTION_REPO_DROPOUT,
      resolved_at: T(10),
      mttr_days: null,
      mttr_actionable_days: null,
      age_days: null,
      removed_at: null,
    });

    // KM: the three drop-outs are neither events nor censored.
    const km = kaplanMeier(base);
    expect(km.events).toBe(2);
    expect(km.censored).toBe(4); // a1..a4 still open

    // The ledger summary: B is neither resolved nor open.
    const summary = mttrFromLedger(base as unknown as Rec[], { now: Date.parse(T(20)) });
    expect(summary.overall).toMatchObject({ resolved: 2, open: 4 });

    // The trend: B leaves the open count at T(10) and never enters the resolved count.
    const scans = state.scans.map((s) => ({ ts: s.ts, scope: s.scope }));
    const trend = trendFromFrames(scans, base as unknown as Rec[]);
    expect(trend.map((p) => [p.open, p.resolved])).toEqual([[9, 0], [6, 0], [4, 2]]);

    // SLA attainment: a drop-out is not a resolution on time. Every row actionable from T(1),
    // HIGH's 14-day deadline is T(15), and by T(20) the whole cohort's verdict is knowable:
    // c1, c2 resolved on time (T(12)), a1..a4 still open — 2 of 6. Counted, the three
    // drop-outs (closed T(10), inside the deadline) would read as on time: 5 of 9.
    const att = cohortSlaAttainment(
      [{ date: T(20) }],
      base.map((r) => ({ ...r, actionable_from: T(1) })) as unknown as Rec[],
    );
    expect(att[0]!.sla_attainment_pct).toBe(33.3);

    // Coverage: a drop-out is not remediated (and not open).
    const m = confusionMatrix(base as unknown as RiskRow[]);
    expect(m.total).toBe(6);

    // Capacity: June closes 2, not 5.
    const cap = capacityByMonth(base, state.scans as unknown as Rec[], { now: Date.parse(T(20)) });
    expect(cap.months.map((mo) => mo.closed)).toEqual([2]);

    // The movement decomposition files them as administrative, beside the disappearances.
    const mv = movementDecomposition(base, state.scans as unknown as Rec[], { since: T(2), until: T(12) }, "sca");
    expect(mv).toMatchObject({ observed: 0, bounded: 5, unattributed: 0, identityHolds: true });
  });

  it("a returning repository RESUMES the episode — no reopen, first_seen kept", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    live(state, [...A, ...C], T(3)); // B drops out
    const firstSeen = row(state, "b1").first_seen;
    const back = live(state, ALL, T(4));
    for (const id of ["b1", "b2", "b3"]) {
      expect(row(state, id)).toMatchObject({
        status: "OPEN",
        resolved_at: null,
        resolution_src: null,
        reopened_count: 0,
        first_seen: firstSeen,
        last_scan_id: T(4),
      });
    }
    expect(back.deltas).toEqual({ new_count: 0, resolved_count: 0, reopened_count: 0 });
    expect(back.absence.resumed).toBe(3);
  });

  it("a returning repository's finding that the API now reports resolved closes as an API resolution", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    live(state, [...A, ...C], T(3));
    live(state, [...A, ...C, { ...B[0]!, status: "RESOLVED", resolvedAt: T(3) }, B[1]!, B[2]!], T(4));
    expect(row(state, "b1")).toMatchObject({ status: "RESOLVED", resolution_src: "api", resolved_at: T(3) });
  });

  it("a SEALED drop-out episode resumes the same way when its repository comes back", () => {
    const state = emptyState();
    live(state, ALL, T(2));
    live(state, [...A, ...C], T(3)); // B drops out
    // Compaction seals B's three rows into resolved_episodes and drops the live rows.
    for (const id of ["b1", "b2", "b3"]) {
      const key = `sca:id:${id}`;
      state.episodes.push(toEpisodeRow(state.ledger[key]!, "cmp-1"));
      delete state.ledger[key];
    }
    const back = live(state, ALL, T(4));
    expect(back.deltas).toEqual({ new_count: 0, resolved_count: 0, reopened_count: 0 });
    expect(back.absence.resumed).toBe(3);
    expect(row(state, "b1")).toMatchObject({ status: "OPEN", reopened_count: 0, first_seen: T(1) });
    expect(state.episodes.every((e) => e.superseded_by_scan === T(4))).toBe(true);
  });

  it("a secrets drop-out does not claim the string left HEAD", () => {
    const state = emptyState();
    const secret = (id: string, repo: string, line: number): Rec => ({
      id, secretDataId: `sd-${id}`, path: "cfg.yml", lineNumber: line, status: "OPEN",
      firstSeenAt: T(1), resource: { id: repo, name: `org/${repo}`, type: "REPOSITORY" },
    });
    const R = [secret("s1", "R", 1), secret("s2", "R", 2), secret("s3", "R", 3)];
    const keep = [secret("k1", "K", 1)];
    const opts = (ts: string, recs: Rec[]) => ({
      scope: "secrets" as const, mode: "live", scanId: ts, scannedSeverities: [],
      completeness: complete(recs.length),
    });
    persistFlatScan(state, [...R, ...keep], opts(T(2), [...R, ...keep]));
    persistFlatScan(state, keep, opts(T(3), keep));
    const dropped = Object.values(state.ledger).filter((r) => r.resolution_src === RESOLUTION_REPO_DROPOUT);
    expect(dropped).toHaveLength(3);
    for (const r of dropped) expect(r.removed_at).toBeNull();
  });
});

// --------------------------------------------------------------------------- replay

describe("replay re-applies the stored verdict — live persist and delete-and-replay agree", () => {
  /**
   * Four sca scans that exercise both rules — a deferral, a drop-out, a resume — then a
   * throwaway sast scan under its own id, so there is something to delete that the sca
   * sequence never depended on. Deleting it replays all four sca scans from their archived
   * records alone; without the stored verdict the deferred scan would replay as a legacy one
   * and resolve B and C on the spot.
   */
  function sequence(): { state: LedgerState; payloads: Map<string, Rec[]> } {
    const state = emptyState();
    const payloads = new Map<string, Rec[]>();
    const step = (records: Rec[], ts: string, completeness: { reportedTotal: number | null; partialPages: number }) => {
      payloads.set(`${ts}|sca`, records);
      live(state, records, ts, completeness);
    };
    step(ALL, T(2), complete(ALL.length));
    step(A, T(3), complete(20)); // deferred: short
    step([...A, ...C], T(4), complete(6)); // complete: B drops out
    step(ALL, T(5), complete(ALL.length)); // B returns, resumed
    step(A, T(6), complete(4)); // complete: B drops out again, C resolves
    payloads.set(`${T(7)}|sast`, []);
    persistFlatScan(state, [], { scope: "sast", mode: "live", scanId: T(7), completeness: complete(0) });
    return { state, payloads };
  }

  const reader = (payloads: Map<string, Rec[]>): PayloadReader =>
    (r: ScanRow) => payloads.get(`${r.scan_id}|${r.scope}`) ?? null;

  it("the live sequence did what the scenario says", () => {
    const { state } = sequence();
    const sca = scansAsc(state.scans, "sca");
    expect(sca.map((s) => s.disappearance)).toEqual([
      "complete", "deferred:short", "complete", "complete", "complete",
    ]);
    expect(sca.map((s) => s.dropout_count)).toEqual([0, null, 3, 0, 3]);
    expect(row(state, "b1")).toMatchObject({ resolution_src: RESOLUTION_REPO_DROPOUT, reopened_count: 0 });
    expect(row(state, "c1").resolution_src).toBe(RESOLUTION_DISAPPEARED);
  });

  it("delete-and-replay reproduces the live ledger and scan rows byte for byte", () => {
    const { state, payloads } = sequence();
    const { state: rebuilt } = deleteScansCore(
      state,
      [T(7)],
      reader(payloads),
      null,
      Date.parse(T(20)),
    );
    const scaOnly = (s: LedgerState) =>
      Object.fromEntries(Object.entries(s.ledger).filter(([k]) => k.startsWith("sca:")));
    expect(scaOnly(rebuilt)).toEqual(scaOnly(state));
    expect(scansAsc(rebuilt.scans, "sca")).toEqual(scansAsc(state.scans, "sca"));
  });

  it("the checkpoint replay reaches the same ledger as the live sequence", () => {
    const { state, payloads } = sequence();
    const rows = scansAsc(state.scans);
    const floor = rows[rows.length - 1]!;
    const cp = buildCheckpoint(rows, rows, null, floor, reader(payloads));
    const byKey = Object.fromEntries(cp.ledger.map((r) => [r.finding_key, r]));
    expect(byKey).toEqual(state.ledger);
  });
});
