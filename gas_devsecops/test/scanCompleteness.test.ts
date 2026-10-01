// The completeness gate and the repository drop-out — the two rules that decide when ABSENCE
// is allowed to resolve a finding (gas_shared/domain/scanCompleteness.ts, reconcile.ts's absence
// pass, ledgerCore.disappearanceWindow).
//
// Hand-written throughout: gas/ and brick have no golden for either rule. Every scenario is a
// short sequence of sca scans over three repositories, small enough that each expected value
// can be read off the records in the test itself.

import { describe, expect, it } from "vitest";
import {
  DROPOUT_MIN_OPEN,
  FETCH_RETURNS_RESOLVED,
  RESOLUTION_API,
  RESOLUTION_DISAPPEARED,
  RESOLUTION_REPO_DROPOUT,
  RMST_HORIZON_DAYS,
} from "../src/domain/config";
import { assetProfile, type AssetRow } from "../src/domain/assets";
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
  compactLedgerCore,
  deleteScansCore,
  toEpisodeRow,
  type Checkpoint,
  type PayloadReader,
} from "../src/domain/maintenance";
import { movementDecomposition } from "../src/domain/movementDecomposition";
import { capacityByMonth, confusionMatrix, type RiskRow } from "../src/domain/program";
import { actionableView, kaplanMeier, latencyView } from "../src/domain/remediation";
import {
  assessCompleteness,
  completenessTolerance,
  disappearanceValue,
  distinctNodes,
  readDisappearance,
} from "../../gas_shared/domain/scanCompleteness";
import { timeToRevoke, type SecretRow } from "../src/domain/secretsLifecycle";
import {
  cohortSlaAttainment,
  kmMedianAsOf,
  trendFromFrames,
  withKmMedian,
} from "../src/domain/trend";
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
    live(state, ALL, T(5));
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
      // Watched open from T(1) until B was last seen at T(5): censored there, never an event —
      // not at T(10), the scan that noticed it gone.
      censor_days: 4,
      // No fixedVersion on these nodes, so no actionable clock to censor either.
      censor_actionable_days: null,
    });
    // Every other row carries no censoring age of its own.
    expect(base.filter((r) => r.censor_days != null)).toHaveLength(3);

    // KM: the three drop-outs are censored where they left, never events.
    const km = kaplanMeier(base, {});
    expect(km.events).toBe(2);
    expect(km.censored).toBe(7); // a1..a4 still open + b1..b3 left coverage
    expect(km.censoredLeftCoverage).toBe(3);

    // The ledger summary: B is neither resolved nor open.
    const summary = mttrFromLedger(base as unknown as Rec[], { now: Date.parse(T(20)) });
    expect(summary.overall).toMatchObject({ resolved: 2, open: 4 });

    // The trend: B leaves the open count at T(10) and never enters the resolved count.
    const scans = state.scans.map((s) => ({ ts: s.ts, scope: s.scope }));
    const trend = trendFromFrames(scans, base as unknown as Rec[]);
    expect(trend.map((p) => [p.open, p.resolved])).toEqual([[9, 0], [9, 0], [6, 0], [4, 2]]);

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

  it("sealed or not, a returning node the API already reports resolved closes the same way", () => {
    // The live path resumes b1's drop-out row and the API closes it ("api", counted). Before
    // the fix the sealed path dropped the fresh row and left the drop-out episode standing —
    // resolved_count 0 and no fix on record.
    const back = [...A, ...C, { ...B[0]!, status: "RESOLVED", resolvedAt: T(3) }, B[1]!, B[2]!];
    const run = (seal: boolean) => {
      const state = emptyState();
      live(state, ALL, T(2));
      live(state, [...A, ...C], T(3)); // B drops out
      if (seal) {
        for (const id of ["b1", "b2", "b3"]) {
          const key = `sca:id:${id}`;
          state.episodes.push(toEpisodeRow(state.ledger[key]!, "cmp-1"));
          delete state.ledger[key];
        }
      }
      const out = live(state, back, T(4));
      const lifecycle = (id: string) => {
        const r = row(state, id);
        return {
          status: r.status, resolved_at: r.resolved_at, resolution_src: r.resolution_src,
          first_seen: r.first_seen, reopened_count: r.reopened_count,
        };
      };
      const base = baseRows(state, { now: Date.parse(T(20)) });
      return {
        deltas: out.deltas,
        resumed: out.absence.resumed,
        rows: ["b1", "b2", "b3"].map(lifecycle),
        mttr: base.find((r) => r.finding_key === "sca:id:b1")!.mttr_days,
        // Nothing the sealed path left behind still answers as a drop-out.
        dropouts: base.filter((r) => r.resolution_src === RESOLUTION_REPO_DROPOUT).length,
      };
    };
    const unsealed = run(false);
    expect(unsealed.rows[0]).toMatchObject({ status: "RESOLVED", resolution_src: RESOLUTION_API });
    expect(unsealed.deltas).toEqual({ new_count: 0, resolved_count: 1, reopened_count: 0 });
    expect(unsealed.mttr).toBe(2);
    expect(run(true)).toEqual(unsealed);
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

// --------------------------------------------------------------------------- SAST

describe("SAST never reads a silent repository as a drop-out", () => {
  // SAST's fetch returns open findings only (wizQueries.ts's SAST_FETCH_RESOLVED), so a
  // repository whose findings were all fixed answers with nothing — exactly what a drop-out
  // looks like on a fetch that does return resolved findings.
  const sast = (id: string, repo: string): Rec => ({
    id, severity: "HIGH", createdAt: T(1),
    resource: { id: repo, name: `org/${repo}`, type: "REPOSITORY" },
  });
  const R = ["r1", "r2", "r3"].map((id) => sast(id, "R"));
  const Q = ["q1", "q2", "q3", "q4"].map((id) => sast(id, "Q"));
  const scan = (state: LedgerState, records: Rec[], ts: string) =>
    persistFlatScan(state, records, {
      scope: "sast",
      mode: "live",
      scanId: ts,
      scannedSeverities: ["CRITICAL", "HIGH"],
      completeness: complete(records.length),
    });

  it("the flag that decides it", () => {
    expect(FETCH_RETURNS_RESOLVED).toEqual({ sca: true, sast: false, secrets: true });
  });

  it("a PR that fixes every finding on a repository closes them as fixes, with a clock", () => {
    const state = emptyState();
    scan(state, [...R, ...Q], T(2));
    const out = scan(state, Q, T(5)); // R's three were fixed
    const key = (id: string) => `sast:id:${id}`;
    for (const id of ["r1", "r2", "r3"]) {
      expect(state.ledger[key(id)]).toMatchObject({
        status: "RESOLVED", resolution_src: RESOLUTION_DISAPPEARED, resolved_at: T(5),
      });
    }
    expect(out.deltas.resolved_count).toBe(3);
    expect(out.absence.dropouts).toBe(0);
    // Not measured, rather than a measured zero: the pass cannot run on this fetch.
    expect(out.scanRow!.dropout_count).toBeNull();
    expect(out.scanRow!.disappearance).toBe("complete");
    const base = baseRows(state, { now: Date.parse(T(20)) });
    const km = kaplanMeier(base, {});
    expect(km.events).toBe(3); // in SAST MTTR, at four days each
    expect(km.curve[0]).toMatchObject({ t: 4, events: 3, atRisk: 7 });
  });

  it("replaying a stored complete SAST scan closes them the same way", () => {
    const state = emptyState();
    scan(state, [...R, ...Q], T(2));
    const first = state.scans[0]!;
    scan(state, Q, T(5));
    const replayed = emptyState();
    for (const [records, sc] of [[[...R, ...Q], first], [Q, state.scans[1]!]] as const) {
      persistFlatScan(replayed, records as Rec[], {
        scope: "sast", mode: "live", scanId: sc.scan_id,
        scannedSeverities: ["CRITICAL", "HIGH"], stored: sc,
      });
    }
    expect(replayed.ledger).toEqual(state.ledger);
  });
});

// --------------------------------------------------------------------------- censoring

describe("a drop-out is censored where it left, in every Kaplan–Meier figure", () => {
  // The review's scenario. 60 findings fixed at day 5; 60 open at day 30; 120 open for 100
  // days on a repository that then leaves the scan. Before the drop-out a quarter has closed
  // and the median is "not reached". Deleting the 120 from the risk set would make it 60 of
  // 120 closed at day 5 — a median of 5 days, conjured out of a repository leaving. Censoring
  // them where they left keeps it not reached.
  const D = (day: number): string =>
    new Date(Date.UTC(2026, 0, 1) + day * 86_400_000).toISOString().replace(".000Z", "Z");
  const sca = (id: string, repo: string, firstDay: number, extra: Rec = {}): Rec => ({
    id, name: `CVE-${id}`, severity: "HIGH", status: "OPEN", firstDetectedAt: D(firstDay),
    vulnerableAsset: { id: repo, name: `org/${repo}`, type: "REPOSITORY" }, ...extra,
  });
  const many = (prefix: string, n: number, repo: string, firstDay: number, extra: Rec = {}) =>
    Array.from({ length: n }, (_, i) => sca(`${prefix}${i}`, repo, firstDay, extra));
  const F = many("f", 60, "F", 0);
  const Ffixed = many("f", 60, "F", 0, { status: "RESOLVED", resolvedAt: D(5) });
  const O = many("o", 60, "O", 70);
  const X = many("x", 120, "X", 0);
  const NOW = Date.parse(D(100));

  function scenario(withDropout: boolean): LedgerState {
    const state = emptyState();
    const step = (records: Rec[], day: number) => persistFlatScan(state, records, {
      scope: "sca", mode: "live", scanId: D(day),
      scannedSeverities: ["CRITICAL", "HIGH"], completeness: complete(records.length),
    });
    step([...F, ...X], 1);
    step([...Ffixed, ...X], 6); // F's 60 are fixed (resolved nodes still come back)
    step([...Ffixed, ...O, ...X], 70);
    if (withDropout) step([...Ffixed, ...O], 100); // X leaves the scan whole
    return state;
  }
  const base = (state: LedgerState) => baseRows(state, { now: NOW });

  it("the scenario did what it says", () => {
    const rows = base(scenario(true));
    expect(rows.filter((r) => r.resolution_src === RESOLUTION_REPO_DROPOUT)).toHaveLength(120);
    expect(rows.filter((r) => r.mttr_days === 5)).toHaveLength(60);
  });

  it("the half-life stays not reached — before and after the repository left", () => {
    for (const withDropout of [false, true]) {
      const rows = base(scenario(withDropout));
      for (const opts of [{}, { horizonDays: RMST_HORIZON_DAYS, minRisk: true }]) {
        const km = kaplanMeier(rows, opts);
        expect(km.median, `dropout=${withDropout} ${JSON.stringify(opts)}`).toBeNull();
        expect(km.events).toBe(60);
        expect(km.censored).toBe(180);
      }
      // S(5) = 1 − 60/240 either way.
      expect(kaplanMeier(rows, {}).curve[0]).toMatchObject({ t: 5, s: 0.75 });
    }
    expect(kaplanMeier(base(scenario(true)), {}).censoredLeftCoverage).toBe(120);
  });

  it("…while every closed-row figure and the backlog leave the drop-outs out", () => {
    const rows = base(scenario(true));
    const summary = mttrFromLedger(rows as unknown as Rec[], { now: NOW });
    expect(summary.overall).toMatchObject({ resolved: 60, open: 60, mttr_median: 5 });
    // No drop-out carries an open age, so no aging or open-past-SLA figure can count one.
    expect(rows.filter((r) => r.age_days !== null).length).toBe(60);
  });

  it("the trend replays and the as-of median agree", () => {
    const state = scenario(true);
    const rows = base(state) as unknown as Rec[];
    const [point] = withKmMedian([{ date: D(100) }], rows);
    expect(point!.km_median_days).toBeNull();
    expect(kmMedianAsOf(rows, null, NOW)).toBeNull();
    expect(kmMedianAsOf(rows, null, NOW, { minRisk: true })).toBeNull();
  });

  it("the actionable clock censors them at the age they left on THAT clock", () => {
    const state = emptyState();
    const fixed = (recs: Rec[]) => recs.map((r) => ({ ...r, fixedVersion: "2.0.0" }));
    live(state, fixed(ALL), T(2));
    live(state, fixed(ALL), T(5));
    live(state, fixed([...A, ...C]), T(10)); // B leaves
    const base = baseRows(state, { now: Date.parse(T(20)) });
    const b1 = base.find((r) => r.finding_key === "sca:id:b1")!;
    // Fixable from its first scan (T(2), fix_observed_at) until it was last seen at T(5).
    expect(b1.censor_actionable_days).toBe(3);
    const km = kaplanMeier(actionableView(base), {});
    expect(km.events).toBe(0);
    expect(km.censored).toBe(9);
    expect(km.censoredLeftCoverage).toBe(3);
  });

  it("censors at the last scan that SAW it, not the later one that noticed it gone", () => {
    // B is last seen at T(2); a deferred scan at T(3) cannot resolve it; the complete scan at
    // T(8) does — resolved_at T(8). Censored there, the three drop-outs would sit in the risk
    // set past a's fixes at day 5 (S = 1 − 4/9, median not reached); censored at their last
    // sighting (day 1) they leave it before, and the median is 5. Every KM reader agrees, and
    // so does the row after it is sealed.
    const fixedA = A.map((n) => ({ ...n, status: "RESOLVED", resolvedAt: T(6) }));
    const run = (seal: boolean, legacy = false) => {
      const state = emptyState();
      live(state, ALL, T(2));
      const deferred = live(state, [...A, ...C], T(3), complete(20)); // short: deferred
      expect(deferred.scanRow!.disappearance).toBe("deferred:short");
      live(state, [...fixedA, ...C], T(8)); // complete: B drops out
      if (seal) {
        for (const id of ["b1", "b2", "b3"]) {
          const key = `sca:id:${id}`;
          const episode = toEpisodeRow(state.ledger[key]!, "cmp-1");
          state.episodes.push(legacy ? { ...episode, last_seen: null } : episode);
          delete state.ledger[key];
        }
      }
      return baseRows(state, { now: Date.parse(T(20)) });
    };
    for (const seal of [false, true]) {
      const base = run(seal);
      const b1 = base.find((r) => r.finding_key === "sca:id:b1")!;
      expect(b1, `seal=${seal}`).toMatchObject({
        resolution_src: RESOLUTION_REPO_DROPOUT, resolved_at: T(8), last_seen: T(2), censor_days: 1,
      });
      const rows = base as unknown as Rec[];
      expect(kaplanMeier(base, {}).median).toBe(5);
      // The vendor-wait clock stops observing a drop-out at the same point.
      const wait = latencyView(base, "detection", Date.parse(T(20)));
      expect(wait.filter((r) => r.age_days === 1)).toHaveLength(3);
      expect(kmMedianAsOf(rows, null, Date.parse(T(20)))).toBe(5);
      expect(withKmMedian([{ date: T(20) }], rows)[0]!.km_median_days).toBe(5);
    }
    // An episode sealed before the tab carried `last_seen` reads as it was sealed: at
    // resolved_at.
    const legacy = run(true, true).find((r) => r.finding_key === "sca:id:b1")!;
    expect(legacy.censor_days).toBe(7);
  });

  it("the per-asset half-life censors them too", () => {
    const rows = base(scenario(true)) as unknown as AssetRow[];
    const profile = assetProfile(rows, { now: D(100), observedFrom: null });
    const overall = profile.rows.find((r) => r.asset_group === "OVERALL")!;
    expect(overall.km_median_days).toBeNull();
  });

  describe("time-to-revoke censors a drop-out's credential where it left, not at now", () => {
    // A credential last measured VALID on a repository that then left the scan used to stay in
    // the risk set censored at `now − first_seen` — an age that grew with every report, under
    // "still-live credentials". It is unobservable after its last sighting: censored at the
    // earlier of `last_seen` and its last validation, and counted apart as `leftCoverage`.
    const secret = (id: string, repo: string, line: number, validatedAt: string | null): Rec => ({
      id, secretDataId: `sd-${id}`, path: "cfg.yml", lineNumber: line, status: "OPEN",
      firstSeenAt: T(1), validationStatus: "VALID",
      ...(validatedAt === null ? {} : { lastValidatedAt: validatedAt }),
      resource: { id: repo, name: `org/${repo}`, type: "REPOSITORY" },
    });
    const opts = (ts: string, recs: Rec[]) => ({
      scope: "secrets" as const, mode: "live", scanId: ts, scannedSeverities: [],
      completeness: complete(recs.length),
    });
    function ttrFor(validatedAt: string | null) {
      const state = emptyState();
      const R = [1, 2, 3].map((i) => secret(`s${i}`, "R", i, validatedAt));
      // Never validated, so it stays out of the clock (decision 3) and the drop-outs are the
      // whole risk set: `maxObserved` is then their censoring age and nothing else's.
      const keep = [{ ...secret("k1", "K", 1, null), validationStatus: "UNKNOWN" }];
      persistFlatScan(state, [...R, ...keep], opts(T(2), [...R, ...keep]));
      persistFlatScan(state, [...R, ...keep], opts(T(5), [...R, ...keep])); // R last seen
      persistFlatScan(state, keep, opts(T(8), keep)); // R leaves the scan
      const base = baseRows(state, { now: Date.parse(T(20)) });
      expect(base.filter((r) => r.resolution_src === RESOLUTION_REPO_DROPOUT)).toHaveLength(3);
      return timeToRevoke(base as unknown as SecretRow[], { now: Date.parse(T(20)) });
    }

    it("at the last sighting when nothing validated it later", () => {
      const ttr = ttrFor(null);
      expect(ttr).toMatchObject({
        events: 0, censored: 3, leftCoverage: 3, excludedUnmeasured: 1, excludedNoClock: 0,
      });
      expect(ttr.km.censoredLeftCoverage).toBe(3);
      // Last seen at T(5), four days in — not nineteen, today's age.
      expect(ttr.km.maxObserved).toBe(4);
    });

    it("at the last validation when that came earlier", () => {
      const ttr = ttrFor(T(4));
      expect(ttr).toMatchObject({ censored: 3, leftCoverage: 3 });
      expect(ttr.km.maxObserved).toBe(3);
      // Validated at detection only: no observed life at all — no usable duration.
      expect(ttrFor(T(1))).toMatchObject({ censored: 0, leftCoverage: 0, excludedNoClock: 3 });
    });
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

// --------------------------------------------------------------------------- sealed supersession

describe("a supersession a later compaction sealed survives delete-and-replay", () => {
  // A sealed episode is superseded by the scan that brought its finding back — a drop-out
  // resuming, or a genuine reopen. When a SECOND compaction then seals that scan, the replay
  // after a delete never re-runs it, so the supersession cannot be re-derived: it has to be
  // kept, and the live row the checkpoint holds for that key has to seed the rebuild. Reset
  // instead, the old episode came back beside the new one and every such finding was counted
  // twice (or, still open at the second floor, lost its live row).
  const DAY = 86_400_000;
  type Step = { records: Rec[]; ts: string } | { compact: string; cutoff: string };

  function run(steps: Step[]) {
    let state = emptyState();
    let checkpoint: Checkpoint | null = null;
    const payloads = new Map<string, Rec[]>();
    const read: PayloadReader = (r) => payloads.get(r.scan_id) ?? null;
    for (const s of steps) {
      if ("records" in s) {
        payloads.set(s.ts, s.records);
        live(state, s.records, s.ts);
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
    const keys = baseRows(rebuilt, { now: Date.parse(T(20)) }).map((r) => r.finding_key);
    return { twin, rebuilt, keys };
  }

  const resolvedNode = (n: Rec, at: string): Rec => ({ ...n, status: "RESOLVED", resolvedAt: at });
  const AC = [...A, ...C];

  it("drop-out sealed, its repository back API-resolved, that sealed too", () => {
    const steps: Step[] = [
      { records: ALL, ts: T(2) },
      { records: AC, ts: T(3) }, // B (three findings) drops out
      { records: AC, ts: T(4) },
      { records: AC, ts: T(5) },
      { compact: "c1", cutoff: T(3) }, // seals the drop-out episodes
      { records: [...AC, ...B.map((n) => resolvedNode(n, T(6)))], ts: T(6) }, // back, resolved
      { records: AC, ts: T(7) },
      { records: AC, ts: T(8) },
      { compact: "c2", cutoff: T(6) }, // seals the scan that superseded them, and the api rows
    ];
    const { twin, rebuilt, keys } = parity(steps, { records: AC, ts: T(9) });
    // The scenario did what it says: one superseded drop-out episode and one live api episode
    // per finding of B.
    const b1 = twin.episodes.filter((e) => e.finding_key === "sca:id:b1");
    expect(b1.map((e) => [e.resolution_src, e.superseded_by_scan])).toEqual([
      [RESOLUTION_REPO_DROPOUT, T(6)],
      [RESOLUTION_API, null],
    ]);
    expect(keys.filter((k) => k === "sca:id:b1")).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rebuilt.episodes).toEqual(twin.episodes);
    expect(rebuilt.ledger).toEqual(twin.ledger);
    expect(scansAsc(rebuilt.scans)).toEqual(scansAsc(twin.scans));
  });

  it("genuine reopen of a sealed episode, resolved again, that sealed too", () => {
    const noA1 = ALL.filter((n) => n["id"] !== "a1");
    const steps: Step[] = [
      { records: ALL, ts: T(2) },
      { records: [resolvedNode(A[0]!, T(3)), ...noA1], ts: T(3) }, // a1 fixed
      { records: noA1, ts: T(4) },
      { records: noA1, ts: T(5) },
      { compact: "c1", cutoff: T(3) }, // seals a1's resolution
      { records: ALL, ts: T(6) }, // a1 reopens
      { records: [resolvedNode(A[0]!, T(7)), ...noA1], ts: T(7) }, // and is fixed again
      { records: noA1, ts: T(8) },
      { records: noA1, ts: T(9) },
      { compact: "c2", cutoff: T(7) },
    ];
    const { twin, rebuilt, keys } = parity(steps, { records: noA1, ts: T(10) });
    const a1 = twin.episodes.filter((e) => e.finding_key === "sca:id:a1");
    expect(a1.map((e) => [e.resolved_at, e.reopened_count, e.superseded_by_scan])).toEqual([
      [T(3), 0, T(6)],
      [T(7), 1, null],
    ]);
    expect(keys.filter((k) => k === "sca:id:a1")).toHaveLength(1);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rebuilt.episodes).toEqual(twin.episodes);
    expect(rebuilt.ledger).toEqual(twin.ledger);
    expect(scansAsc(rebuilt.scans)).toEqual(scansAsc(twin.scans));
  });

  it("genuine reopen sealed while the finding is still open keeps its live row", () => {
    const noA1 = ALL.filter((n) => n["id"] !== "a1");
    const steps: Step[] = [
      { records: ALL, ts: T(2) },
      { records: [resolvedNode(A[0]!, T(3)), ...noA1], ts: T(3) },
      { records: noA1, ts: T(4) },
      { records: noA1, ts: T(5) },
      { compact: "c1", cutoff: T(3) },
      { records: ALL, ts: T(6) }, // a1 reopens and stays open
      { records: ALL, ts: T(7) },
      { records: ALL, ts: T(8) },
      { compact: "c2", cutoff: T(6) },
    ];
    const { twin, rebuilt, keys } = parity(steps, { records: ALL, ts: T(9) });
    expect(twin.ledger["sca:id:a1"]).toMatchObject({ status: "OPEN", reopened_count: 1 });
    expect(rebuilt.ledger["sca:id:a1"]).toMatchObject({ status: "OPEN", reopened_count: 1 });
    expect(keys.filter((k) => k === "sca:id:a1")).toHaveLength(1);
    expect(rebuilt.episodes).toEqual(twin.episodes);
    // Byte for byte but one column: the checkpoint replays without episodes, so it reaches a1's
    // reopen through reconcile's own reopen branch, which keeps the first episode's
    // `first_scan_id` where the live collision path stamped the reopening scan. Nothing reads
    // it off a row no longer first seen in the latest scan (insights.movement).
    const sansFirstScan = (l: LedgerState["ledger"]) =>
      Object.fromEntries(Object.entries(l).map(([k, r]) => [k, { ...r, first_scan_id: null }]));
    expect(sansFirstScan(rebuilt.ledger)).toEqual(sansFirstScan(twin.ledger));
    // The replayed scans see a1 as the open row it was, never as a second reopen.
    expect(scansAsc(rebuilt.scans)).toEqual(scansAsc(twin.scans));
  });
});
