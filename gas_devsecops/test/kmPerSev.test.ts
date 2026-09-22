// THE PER-SEVERITY CURVES, AND THE TWO VIEWS OF ONE ESTIMATE.
//
// `buildMttr` has always run `kaplanMeier(rs)` once per severity and kept three numbers off
// each curve — median, lower bound, P90 — then discarded the staircase that produced all
// three. Nothing in the app could compare severity survival SHAPES, and three fixed statistics
// cannot say that CRITICAL closes fast and then stalls, or that LOW never moves. W1 ships that
// same curve as `remediation.kmPerSev`.
//
// WHAT THIS FILE HOLDS, and neither half is decorative:
//
//   1. THE TWO VIEWS AGREE. `kmPerSev[s].median` and `kmMedianPerSev[s]` are the same number
//      because they come off the same `kaplanMeier` call — not because two computations
//      happen to land together. A future edit that recomputes one of them (over a different
//      population, or after a filter) is exactly the drift this asserts against, and it is a
//      real risk: `kmMedianPerSev` is what the summary table draws and `kmPerSev` is what the
//      fan above it draws, so a disagreement would put two different half-lives on one screen.
//      The HIGH row below is the case that bites: its median is null and only the BOUND is
//      real, so a check comparing medians alone would pass on `null === null`.
//
//   2. THE CURVE IS NARROWED, by the SAME `shipKM` the overall curve goes through. `KMPoint`
//      is `{t, s, atRisk, events}`; the wire carries `{t, s}`. Six curves is six times the
//      transfer of one, so the narrowing is worth more here than anywhere else — and
//      `survivalTableModel` reads the presence of `atRisk` to decide whether to publish the
//      risk-set columns at all, so an un-narrowed curve would silently change the TABLE too.
//
// PERTURBATION (run 2026-09-04, then reverted): `kmPerSev[s] = shipKM(k);` in
// src/server/readModels.ts was changed to `kmPerSev[s] = k as unknown as ShippedKM;` — the
// un-narrowed domain result, which is what a reader who did not know about `shipKM` would
// write. Observed:
//
//   FAIL  test/kmPerSev.test.ts > ... > the curve is shipKM-narrowed, one point at a time
//     AssertionError: CRITICAL point 0 carries fields shipKM drops:
//     expected [ 'atRisk', 'events', 's', 't' ] to deeply equal [ 's', 't' ]
//
//   FAIL  test/kmPerSev.test.ts > ... > every entry is the same curve the three stat maps
//         were read off, including where only the BOUND is real
//     AssertionError: CRITICAL p90: expected undefined to be null // Object.is equality
//     (`KMResult` has no `p90` at all; `shipKM` is where `kmQuantileFromCurve(curve, 0.9)`
//     is added, so un-narrowing turns a measured null into an absent field.)
//
//   Test Files  1 failed (1) ; Tests  2 failed | 4 passed (6)
//
// The un-narrowed shape passed the "one entry per severity" and key-ORDER assertions, which is
// why the shape check is separate from the count: only the pair distinguishes "ships a curve
// per severity" from "ships the RIGHT curve per severity".

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEVERITY_ORDER } from "../src/domain/config";
import type { Scope } from "../src/domain/config";
import type { BaseRow, ScanRow } from "../src/domain/ledgerTypes";

const H = vi.hoisted(() => ({ rows: [] as BaseRow[], store: new Map<string, unknown>() }));

// The same mock set `test/readModels.test.ts` uses, minus the parts this file does not read:
// what is under test is one block of `buildMttr`, not the cache layers or the stores.
function memo(name: string, params: unknown, compute: () => unknown): unknown {
  const k = name + "|" + JSON.stringify(params ?? null);
  if (!H.store.has(k)) H.store.set(k, compute());
  return H.store.get(k);
}
vi.mock("../src/server/serverCache", () => ({
  cached: (n: string, p: unknown, c: () => unknown) => memo(n, p, c),
  dataVersion: () => "v1",
}));
vi.mock("../src/server/readModelStore", () => ({
  durablyCached: (n: string, p: unknown, c: () => unknown) => memo(n, p, c),
  duringWarm: <T,>(fn: () => T): T => fn(),
  sweepReadModels: () => 0,
}));
vi.mock("../src/server/ledgerStore", () => ({
  loadBaseRows: () => H.rows.map((r) => ({ ...r })),
  loadScanRows: (): ScanRow[] => [],
  loadTrend: () => [],
  loadProgramTrend: () => [],
  latestScanRow: () => null,
  previousSeverityCounts: () => ({}),
}));
vi.mock("../src/server/historyStore", () => ({ listHistory: () => [] }));
vi.mock("../src/server/jobsStore", () => ({ activeJob: () => null }));
vi.mock("../src/server/settingsStore", () => ({ loadSettings: () => ({ projectView: "" }) }));

import { __resetModelMemosForTest, mttrModel } from "../src/server/readModels";

const NOW = Date.parse("2026-03-11T00:00:00Z");
const DAY = 86_400_000;

function row(key: string, severity: string, first: string, resolved: string | null): BaseRow {
  const mttr = resolved ? (Date.parse(resolved) - Date.parse(first)) / DAY : null;
  const age = resolved ? null : (NOW - Date.parse(first)) / DAY;
  return {
    finding_key: key,
    scope: "sca" as Scope,
    identifier: key,
    component: null,
    severity,
    repo_id: "r1",
    repo_name: "repo-one",
    branch: "main",
    platform: "github",
    first_seen: first,
    last_seen: "2026-03-01T00:00:00Z",
    status: resolved ? "RESOLVED" : "OPEN",
    resolved_at: resolved,
    resolution_src: resolved ? "disappeared" : null,
    reopened_count: 0,
    first_scan_id: "sync-1",
    last_scan_id: "sync-2",
    fix_date: null,
    fix_observed_at: null,
    fixed_version: null,
    has_kev: null,
    has_exploit: null,
    epss: null,
    risk_observed_at: null,
    cwe: null,
    ai_verdict: null,
    language: null,
    file_path: null,
    start_line: null,
    origin: null,
    secret_kind: null,
    rotated_at: null,
    removed_at: null,
    validation_state: null,
    validated_at: null,
    confidence: null,
    owner_project: "proj-a",
    owner_path: "org/proj-a",
    tags_json: null,
    projects_json: null,
    mttr_days: mttr,
    age_days: age,
    fix_available_at: first,
    actionable_from: first,
    mttr_actionable_days: mttr,
    actionable_age_days: age,
    awaiting_vendor_fix: false,
  } as BaseRow;
}

// Three severities, three DIFFERENT survival shapes — the point of drawing six curves at all.
//
// MTTR delayed-entry package: `buildMttr`'s per-severity `kaplanMeier` call now passes
// `{ horizonDays, minRisk: true }` (server/readModels.ts's `KM_OPTS`), so every curve here is
// ALSO cut at the Gebski et al. reliability boundary — `n(t) >= max(10, 50*S(t-))`, which near
// S=1 (the first event) requires a risk set of at least 50. The original 2-4-row-per-severity
// fixture failed that at its very first event every time (any population under 50 does — see
// test/kmDelayedEntry.test.ts's own "first event already fails" case), which would have made
// every curve here empty regardless of its actual survival shape — not a demonstration of
// anything. Each severity below is rescaled to >= 60 rows, keeping the SAME qualitative shape
// the original hand-picked rows told:
//
//   CRITICAL  closes fast: 55 of 60 resolve within the first 11 days (5/day — ties, not one
//             row at a time), 5 stay open. Pure removals with no intervening censoring mean
//             survival after D cumulative removals out of N is exactly (N-D)/N regardless of
//             how they group into ties, so S(day 6) = (60 - 30)/60 = 0.5 exactly -> median 6.
//             Reliability holds through day 11 (n(11) = 10 lands exactly on the floor of 10,
//             and the fail condition is strict "<", so it still passes).
//   HIGH      stalls: 5 of 60 resolve, one per day across days 1..5; 55 stay open. Survival
//             never drops below (60-5)/60 ~= 0.917, so the median never crosses — only
//             `medianLowerBound` is publishable. All 5 events clear reliability (the tightest
//             check, day 5: n=56 against a threshold of 50*S(4) ~= 46.7).
//   LOW       moves slowly but does move: all 60 resolve, one per day across days 1..60 — the
//             same "pure removals" identity as CRITICAL, just spread six times as wide, so the
//             median crosses on day 30 instead of day 6: slower, but real, and (50/60 < 1, so
//             only the absolute floor of 10 can ever bind here) still safely inside the
//             reliable region, which only starts failing past day 51.
//
// INFO/UNKNOWN have no rows at all, which is the "one entry per severity PRESENT" case.
function seed(): void {
  const ANCHOR = "2026-01-01T00:00:00Z";
  const plusDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString();
  const rows: BaseRow[] = [];

  for (let day = 1; day <= 11; day++) {
    for (let i = 0; i < 5; i++) {
      rows.push(row(`c-${day}-${i}`, "CRITICAL", ANCHOR, plusDays(ANCHOR, day)));
    }
  }
  for (let i = 0; i < 5; i++) rows.push(row(`c-open-${i}`, "CRITICAL", ANCHOR, null));

  for (let day = 1; day <= 5; day++) {
    rows.push(row(`h-${day}`, "HIGH", ANCHOR, plusDays(ANCHOR, day)));
  }
  for (let i = 0; i < 55; i++) rows.push(row(`h-open-${i}`, "HIGH", ANCHOR, null));

  for (let day = 1; day <= 60; day++) rows.push(row(`l-${day}`, "LOW", ANCHOR, plusDays(ANCHOR, day)));

  H.rows = rows;
}

interface ShippedCurve {
  curve: { t: number; s: number }[];
  median: number | null;
  medianLowerBound: number | null;
  p90: number | null;
  events: number;
  censored: number;
  total: number;
}
interface Remediation {
  kmPerSev: Record<string, ShippedCurve>;
  kmMedianPerSev: Record<string, number | null>;
  kmLowerBoundPerSev: Record<string, number | null>;
  kmP90PerSev: Record<string, number | null>;
}

let rem: Remediation;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  H.store.clear();
  seed();
  __resetModelMemosForTest();
  vi.stubGlobal("console", { ...console, warn: () => {}, log: () => {} });
  const model = mttrModel({ scope: null, severities: null, showNoFix: true }) as unknown as {
    remediation: Remediation;
  };
  rem = model.remediation;
});

describe("buildMttr ships one Kaplan-Meier curve per severity", () => {
  it("has an entry for every severity that has rows, and none for the ones that do not", () => {
    expect(Object.keys(rem.kmPerSev).slice().sort()).toEqual(["CRITICAL", "HIGH", "LOW"]);
    expect(Object.keys(rem.kmPerSev)).not.toContain("INFO");
    expect(Object.keys(rem.kmPerSev)).not.toContain("UNKNOWN");
    // The three stat maps and the curve map cover exactly the same severities — a severity in
    // one and not the other would draw a card with no row, or a row with no card.
    expect(Object.keys(rem.kmPerSev).slice().sort())
      .toEqual(Object.keys(rem.kmMedianPerSev).slice().sort());
  });

  it("emits its keys in the domain severity order, so the client needs no sort", () => {
    const order = SEVERITY_ORDER as readonly string[];
    const keys = Object.keys(rem.kmPerSev);
    expect(keys).toEqual(order.filter((s) => keys.indexOf(s) >= 0));
    expect(keys).toEqual(["CRITICAL", "HIGH", "LOW"]);
  });

  it("every entry is the same curve the three stat maps were read off, including where only the BOUND is real", () => {
    for (const sev of Object.keys(rem.kmPerSev)) {
      const km = rem.kmPerSev[sev]!;
      expect(km.median, sev + " median").toBe(rem.kmMedianPerSev[sev]);
      expect(km.medianLowerBound, sev + " bound").toBe(rem.kmLowerBoundPerSev[sev]);
      expect(km.p90, sev + " p90").toBe(rem.kmP90PerSev[sev]);
    }
  });

  it("is not vacuous: one severity crosses half and one never does", () => {
    // Without this the agreement check above could be three pairs of nulls agreeing.
    expect(rem.kmPerSev["CRITICAL"]!.median).not.toBeNull();
    expect(rem.kmPerSev["HIGH"]!.median).toBeNull();
    expect(rem.kmPerSev["HIGH"]!.medianLowerBound).not.toBeNull();
    expect(rem.kmLowerBoundPerSev["HIGH"]).not.toBeNull();
  });

  it("the curve is shipKM-narrowed, one point at a time", () => {
    for (const sev of Object.keys(rem.kmPerSev)) {
      const km = rem.kmPerSev[sev]!;
      expect(Array.isArray(km.curve), sev + " curve").toBe(true);
      expect(km.curve.length, sev + " has no steps").toBeGreaterThan(0);
      km.curve.forEach((p, i) => {
        expect(
          Object.keys(p).slice().sort(),
          sev + " point " + i + " carries fields shipKM drops",
        ).toEqual(["s", "t"]);
      });
    }
  });

  it("carries the censoring counts the card's caption has to print, and they add up", () => {
    const high = rem.kmPerSev["HIGH"]!;
    expect(high.events).toBe(5); // days 1..5
    expect(high.censored).toBe(55); // still open
    expect(high.total).toBe(60);
    const crit = rem.kmPerSev["CRITICAL"]!;
    expect(crit.events + crit.censored).toBe(crit.total);
  });
});
