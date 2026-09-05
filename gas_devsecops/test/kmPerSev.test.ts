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

// Three severities, three DIFFERENT survival shapes — the point of drawing six curves at all:
//
//   CRITICAL  closes fast: three of four resolved inside nine days, so the curve crosses half
//             and there is a real median.
//   HIGH      stalls: one early closure and three findings open since January, so the curve
//             never falls to half and only `medianLowerBound` is publishable.
//   LOW       moves slowly but does move: both resolved, one at ten days and one at forty.
//
// INFO/UNKNOWN have no rows at all, which is the "one entry per severity PRESENT" case.
function seed(): void {
  H.rows = [
    row("c1", "CRITICAL", "2026-01-01T00:00:00Z", "2026-01-06T00:00:00Z"),
    row("c2", "CRITICAL", "2026-01-01T00:00:00Z", "2026-01-08T00:00:00Z"),
    row("c3", "CRITICAL", "2026-01-01T00:00:00Z", "2026-01-10T00:00:00Z"),
    row("c4", "CRITICAL", "2026-01-01T00:00:00Z", null),

    row("h1", "HIGH", "2026-01-02T00:00:00Z", "2026-01-05T00:00:00Z"),
    row("h2", "HIGH", "2026-01-02T00:00:00Z", null),
    row("h3", "HIGH", "2026-01-02T00:00:00Z", null),
    row("h4", "HIGH", "2026-01-02T00:00:00Z", null),

    row("l1", "LOW", "2026-01-03T00:00:00Z", "2026-01-13T00:00:00Z"),
    row("l2", "LOW", "2026-01-03T00:00:00Z", "2026-02-12T00:00:00Z"),
  ];
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
    expect(high.events).toBe(1);
    expect(high.censored).toBe(3);
    expect(high.total).toBe(4);
    const crit = rem.kmPerSev["CRITICAL"]!;
    expect(crit.events + crit.censored).toBe(crit.total);
  });
});
