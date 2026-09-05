// Week-over-week movement in the OPEN BACKLOG, and the honest refusal when there is none.
//
// WHAT THIS BLOCK EXISTS TO FIX, MEASURED RATHER THAN ASSUMED. Executive's Movement aside read
// `weekTrend` — the Kaplan-Meier half-life now against the half-life a week ago — and had said
// "No week-over-week comparison" on every load since the page shipped. That is not a defect in
// `weekTrend`: probed against the dev seed on 2026-09-04, `mttr.remediation.km.median` is
// `null` with `medianLowerBound = 293.9 d`, because 416 of 554 lifecycles are still open. The
// curve never falls to half, so `kmMedianAsOf` returns null at BOTH endpoints and `weekTrend`
// correctly refuses to substitute a bound for a median. `weekTrend` is left exactly as it was.
// What was missing was a movement figure a censored curve cannot suppress — the open count,
// which is observable whether or not half the register has closed.
//
// THE ENDPOINTS ARE SYNCS, NOT CALENDAR DATES. A register only learns something on the days it
// looks, so `until` is the newest sync and `since` is the most recent sync at least seven days
// older. Where no such pair exists the block refuses and publishes the span it DOES have, so a
// reader learns "this register has looked twice in three days" rather than "no comparison".
//
// PERTURBATION (run 2026-09-04, reverted) — see "refuses a pair closer than a week" below.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseRow, ScanRow } from "../src/domain/ledgerTypes";
import type { Scope } from "../src/domain/config";

const H = vi.hoisted(() => ({
  version: "v1",
  rows: [] as BaseRow[],
  scans: [] as ScanRow[],
}));

const store = new Map<string, unknown>();
function memo(name: string, params: unknown, compute: () => unknown): unknown {
  const k = `${name}|${JSON.stringify(params ?? null)}|${H.version}`;
  if (store.has(k)) return store.get(k);
  const v = compute();
  store.set(k, v);
  return v;
}

vi.mock("../src/server/serverCache", () => ({
  cached: (n: string, p: unknown, c: () => unknown) => memo(n, p, c),
  dataVersion: () => H.version,
}));
vi.mock("../src/server/readModelStore", () => ({
  durablyCached: (n: string, p: unknown, c: () => unknown) => memo(n, p, c),
  duringWarm: <T,>(fn: () => T): T => fn(),
  sweepReadModels: () => 0,
}));
vi.mock("../src/server/ledgerStore", () => ({
  loadBaseRows: () => H.rows.map((r) => ({ ...r })),
  loadScanRows: () => H.scans.slice(),
  loadTrend: () => [],
  loadProgramTrend: () => [],
  latestScanRow: (scope: Scope) => H.scans.filter((s) => s.scope === scope).slice(-1)[0] ?? null,
  previousSeverityCounts: () => ({}),
}));
vi.mock("../src/server/historyStore", () => ({ listHistory: () => [] }));
vi.mock("../src/server/jobsStore", () => ({ activeJob: () => null }));
vi.mock("../src/server/settingsStore", () => ({ loadSettings: () => ({ projectView: "" }) }));
vi.mock("../src/server/sheetsDb", async (orig) => {
  const actual = await orig<typeof import("../src/server/sheetsDb")>();
  return { ...actual, cellCount: () => 1000, gridSize: () => ({ rows: 10, cols: 39 }) };
});

import { __resetModelMemosForTest, executiveModel } from "../src/server/readModels";

const ALL = { scope: null, severities: null, showNoFix: true } as const;

const T0 = "2026-06-01T08:00:00.000Z";
const T3 = "2026-06-04T08:00:00.000Z";
const T14 = "2026-06-15T08:00:00.000Z";

function scan(ts: string, scope: Scope): ScanRow {
  return {
    scan_id: `${scope}-${ts}`, ts, scope, mode: "sample", severities: null,
    total: 0, new_count: 0, resolved_count: 0, reopened_count: 0,
    raw_ref: null, obs_ref: null, sealed: 0,
  };
}

/** One sync writes one `scans` row per scope — the movement compares RUNS, not rows. */
function sync(ts: string): ScanRow[] {
  return [scan(ts, "sca"), scan(ts, "sast"), scan(ts, "secrets")];
}

function row(o: { key: string; scope: Scope; first: string; resolved?: string | null }): BaseRow {
  const resolved = o.resolved ?? null;
  return {
    finding_key: o.key, scope: o.scope, identifier: o.key, component: null, severity: "HIGH",
    repo_id: "r1", repo_name: "repo-one", branch: "main", platform: "github",
    first_seen: o.first, last_seen: T14,
    status: resolved ? "RESOLVED" : "OPEN",
    resolved_at: resolved, resolution_src: resolved ? "disappeared" : null,
    reopened_count: 0, first_scan_id: null, last_scan_id: null,
    fix_date: null, fix_observed_at: null, fixed_version: null,
    has_kev: null, has_exploit: null, epss: null, risk_observed_at: null,
    cwe: null, ai_verdict: null, language: null, file_path: null, start_line: null, origin: null,
    secret_kind: null, rotated_at: null, removed_at: null,
    validation_state: null, validated_at: null, confidence: null,
    owner_project: "proj-a", owner_path: null, tags_json: null, projects_json: null,
    mttr_days: null, age_days: 30,
    fix_available_at: o.first, actionable_from: o.first,
    mttr_actionable_days: null, actionable_age_days: null, awaiting_vendor_fix: false,
  };
}

/**
 * Three SCA findings and two SAST ones, arranged so both registers MOVE and move differently:
 *
 *   sca   two born before T0 (one of them closed at T14), one born at T14
 *         -> open at T0: 2, open now: 2   (delta 0, and a 0 delta must still be published)
 *   sast  one born before T0, one born at T14, nothing closed
 *         -> open at T0: 1, open now: 2   (delta +1, the backlog grew)
 */
function seed(): void {
  H.rows = [
    row({ key: "sca:1", scope: "sca", first: "2026-05-01T00:00:00Z" }),
    row({ key: "sca:2", scope: "sca", first: "2026-05-01T00:00:00Z", resolved: T14 }),
    row({ key: "sca:3", scope: "sca", first: T14 }),
    row({ key: "sast:1", scope: "sast", first: "2026-05-01T00:00:00Z" }),
    row({ key: "sast:2", scope: "sast", first: T14 }),
  ];
}

/** The replay the producer uses for `prevOpen`, restated here so the spec can check `open`
 *  against it independently rather than trusting the producer's own arithmetic. */
function openAsOf(scope: Scope, iso: string): number {
  const d = Date.parse(iso);
  return H.rows.filter((r) => {
    if (r.scope !== scope) return false;
    const first = Date.parse(String(r.first_seen));
    if (!(first <= d)) return false;
    const res = r.resolved_at === null ? null : Date.parse(String(r.resolved_at));
    return res === null || res > d;
  }).length;
}

beforeEach(() => {
  store.clear();
  H.version = `v${Math.random()}`;
  seed();
  H.scans = [];
  __resetModelMemosForTest();
});

function movementOf(): Record<string, any> {
  return (executiveModel(ALL) as any).movement;
}

describe("two syncs a fortnight apart", () => {
  beforeEach(() => { H.scans = [...sync(T0), ...sync(T14)]; });

  it("publishes the comparison, and names the two dates it compared", () => {
    const m = movementOf();
    expect(m.comparable).toBe(true);
    expect(m.reason).toBeNull();
    expect(m.since).toBe(T0);
    expect(m.until).toBe(T14);
    expect(m.days).toBe(14);
    expect(m.syncs).toBe(2);
  });

  it("gives each register its own pair, and a 0 delta is still published", () => {
    const m = movementOf();
    expect(m.perScope["sca"]).toEqual({ open: 2, prevOpen: 2, delta: 0 });
    expect(m.perScope["sast"]).toEqual({ open: 2, prevOpen: 1, delta: 1 });
    expect(m.perScope["secrets"]).toEqual({ open: 0, prevOpen: 0, delta: 0 });
    expect(m.total).toEqual({ open: 4, prevOpen: 3, delta: 1 });
  });

  it("the live open count equals a replay at `until` — the two clocks agree", () => {
    // The producer publishes the LIVE open count as `open` so the aside and the severity tiles
    // above it cannot print two different totals. That is only sound because a finding is
    // dated closed at the scan that stopped seeing it, so nothing can close between the newest
    // sync and now. This spec is that claim, held rather than assumed.
    const m = movementOf();
    for (const scope of ["sca", "sast", "secrets"] as Scope[]) {
      expect(m.perScope[scope].open, `${scope} live vs replay at until`)
        .toBe(openAsOf(scope, T14));
    }
  });

  it("counts SYNCS, not scan rows — three scopes per run is one observation", () => {
    expect(H.scans.length).toBe(6);
    expect(movementOf().syncs).toBe(2);
  });

  it("collapses to the one register when the page is scoped", () => {
    const m = (executiveModel({ ...ALL, scope: "sast" }) as any).movement;
    expect(Object.keys(m.perScope)).toEqual(["sast"]);
    expect(m.total).toEqual({ open: 2, prevOpen: 1, delta: 1 });
  });
});

describe("syncs too close together", () => {
  // PERTURBATION (run 2026-09-04, reverted). The gap gate in `openMovement`
  // (src/server/readModels.ts) was removed, taking the most recent prior sync regardless:
  //     if (true) { since = instants[i]!; break; }
  // Observed — 2 failed | 12 passed:
  //   FAIL  test/movement.test.ts > syncs too close together > refuses a pair closer than a week, and says how close
  //     AssertionError: expected true to be false // Object.is equality
  //   FAIL  test/movement.test.ts > syncs too close together > publishes the widest span the log offers, not the nearest gap
  //     AssertionError: expected null to be 'tooClose' // Object.is equality
  // Without the gate a three-day difference is published as a week-over-week movement, which
  // is the failure this whole block exists to avoid: two syncs inside one week describe the
  // same week, and their difference is arrival noise rather than a trend.
  it("refuses a pair closer than a week, and says how close", () => {
    H.scans = [...sync(T0), ...sync(T3)];
    const m = movementOf();
    expect(m.comparable).toBe(false);
    expect(m.reason).toBe("tooClose");
    expect(m.days).toBe(3);
    expect(m.until).toBe(T3);
    expect(m.since).toBeNull();
    expect(m.perScope).toBeUndefined();
  });

  it("publishes the widest span the log offers, not the nearest gap", () => {
    // Three syncs inside six days: the nearest prior gap is 2 days, but what a reader needs
    // to know is that the register has only been watching for 6.
    H.scans = [...sync(T0), ...sync("2026-06-05T08:00:00.000Z"), ...sync("2026-06-07T08:00:00.000Z")];
    const m = movementOf();
    expect(m.reason).toBe("tooClose");
    expect(m.syncs).toBe(3);
    expect(m.days).toBe(6);
  });

  it("takes the most recent QUALIFYING sync when several clear the gate", () => {
    // T0, T3 and T14: both T0 (14 d) and T3 (11 d) clear seven days, and the more recent one
    // is the better comparison — a stale endpoint would credit the register with two weeks of
    // movement it did not observe in one.
    H.scans = [...sync(T0), ...sync(T3), ...sync(T14)];
    const m = movementOf();
    expect(m.comparable).toBe(true);
    expect(m.since).toBe(T3);
    expect(m.days).toBe(11);
  });
});

describe("a register that has barely looked", () => {
  it("says `one sync only` rather than inventing a second endpoint", () => {
    H.scans = sync(T14);
    const m = movementOf();
    expect(m.comparable).toBe(false);
    expect(m.reason).toBe("oneSync");
    expect(m.syncs).toBe(1);
    expect(m.until).toBe(T14);
    expect(m.days).toBeNull();
  });

  it("says `no sync` on an unread ledger — not a comparison against zero", () => {
    H.scans = [];
    const m = movementOf();
    expect(m.comparable).toBe(false);
    expect(m.reason).toBe("noSync");
    expect(m.syncs).toBe(0);
    expect(m.since).toBeNull();
    expect(m.until).toBeNull();
    expect(m.days).toBeNull();
  });
});

describe("the half-life comparison beside it", () => {
  it("is left untouched — the two measure different things", () => {
    H.scans = [...sync(T0), ...sync(T14)];
    const m = executiveModel(ALL) as any;
    // `weekTrend` still refuses here (no observable KM median on this population), and that
    // refusal is not what the open-backlog block replaced. Both keys ship.
    expect(m).toHaveProperty("weekTrend");
    expect(m).toHaveProperty("movement");
    expect(m.movement.comparable).toBe(true);
  });
});
