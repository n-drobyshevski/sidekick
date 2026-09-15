// THE PER-SEVERITY CURVES, AND THE TWO VIEWS OF ONE ESTIMATE.
//
// Ported from gas_devsecops/test/kmPerSev.test.ts. `mttrData` has always run `kaplanMeier(rs)`
// once per severity and kept two numbers off each curve — the median and the P90 — then
// discarded the staircase that produced both. Nothing in this register could compare severity
// survival SHAPES, and two fixed statistics cannot say that CRITICAL closes fast and then
// stalls, or that LOW never moves. This package ships that same curve as
// `remediation.kmPerSev`, and the lower bound beside it as `kmLowerBoundPerSev`.
//
// WHAT THIS FILE HOLDS, and neither half is decorative:
//
//   1. THE TWO VIEWS AGREE. `kmPerSev[s].median` and `kmMedianPerSev[s]` are the same number
//      because they come off the same `kaplanMeier` call — not because two computations happen
//      to land together. A future edit that recomputes one of them (over a different
//      population, or after a filter) is exactly the drift this asserts against, and it is a
//      real risk: `kmMedianPerSev` is what the summary table draws and `kmPerSev` is what the
//      fan above it draws, so a disagreement would put two different half-lives on one screen.
//      The HIGH row below is the case that bites: its median is null and only the BOUND is
//      real, so a check comparing medians alone would pass on `null === null`.
//
//   2. THE CURVE IS NARROWED, by `shipKM`. `KMPoint` is `{t, s, atRisk, events}`; the wire
//      carries `{t, s}`. Six curves is six times the transfer of one, so the narrowing is
//      worth more here than anywhere else — and `survivalTableModel` reads the PRESENCE of
//      `atRisk` to decide whether to publish the risk-set columns at all, so an un-narrowed
//      curve would silently change the fan's TABLES too.
//
// PERTURBATION (run 2026-09-07 on this branch, then reverted): `kmPerSev[s] = shipKM(k);` in
// src/server/api.ts was changed to `kmPerSev[s] = k as unknown as ShippedKM;` — the un-narrowed
// domain result, which is what a reader who did not know about `shipKM` would write. Observed:
//
//   FAIL  test/kmPerSev.test.ts > ... > the curve is shipKM-narrowed, one point at a time
//     AssertionError: CRITICAL point 0 carries fields shipKM drops:
//     expected [ 'atRisk', 'events', 's', 't' ] to deeply equal [ 's', 't' ]
//
//   FAIL  test/kmPerSev.test.ts > ... > every entry is the same curve the three stat maps were
//         read off, including where only the BOUND is real
//     AssertionError: CRITICAL p90: expected undefined to be null
//     (`KMResult` has no `p90` at all; `shipKM` is where `kmQuantileFromCurve(curve, 0.9)` is
//     added, so un-narrowing turns a measured null into an absent field.)
//
//   Test Files  1 failed (1) ; Tests  3 failed | 4 passed (7)
//
// The third failure is the inline perturbation at the foot of this file, which asserts the
// narrowed shape against the un-narrowed one and therefore fails on the same defect from the
// other side. The un-narrowed shape PASSED the "one entry per severity" and key-ORDER
// assertions, which is why the shape check is separate from the count: only the pair
// distinguishes "ships a curve per severity" from "ships the RIGHT curve per severity".

import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEVERITY_ORDER } from "../src/domain/config";
import { baseRows, emptyState, type LedgerState } from "../src/domain/ledgerCore";
import { emptyRiskSignals, type LedgerRow } from "../src/domain/reconcile";

const NOW = Date.parse("2026-03-11T00:00:00Z");

const H = vi.hoisted(() => ({ rows: [] as unknown[] }));

// The smallest mock set that lets `mttrData` run: the cache layer collapses to a direct call
// (what is under test is one block of `mttrData`, not the caching), the ledger hands back the
// seeded base rows, and the settings are the default both-toggles-on view. Everything else in
// api.ts's import surface imports cleanly under plain Node.
vi.mock("../src/server/serverCache", () => ({
  cached: (_n: string, _p: unknown, compute: () => unknown) => compute(),
  dataVersion: () => "v1",
  BUILD_ID: "dev",
}));
vi.mock("../src/server/ledgerStore", () => ({
  loadBaseRows: () => H.rows,
  loadScanRows: () => [],
  loadTrend: () => [],
}));
vi.mock("../src/server/settingsStore", () => ({
  getShowNoFix: () => true,
  getIncludeEol: () => true,
  getDomains: () => ({ items: [] }),
  getDisplaySeverities: () => [],
  getFetchSeverities: () => [],
}));

import { getMttr } from "../src/server/api";

function row(over: Partial<LedgerRow>): LedgerRow {
  return {
    vuln_key: "id:x", cve: "CVE-2026-1", severity: "HIGH", asset_id: null,
    asset_name: null, asset_type: null, cloud: null, first_seen: null, last_seen: null,
    status: "OPEN", resolved_at: null, resolution_src: null, reopened_count: 0,
    first_scan_id: null, last_scan_id: null, subscription_name: null,
    subscription_ext_id: null, tags_json: null, fix_date: null, fix_observed_at: null,
    published_date: null,
    ...emptyRiskSignals(),
    ...over,
  } as LedgerRow;
}

// Three severities, three DIFFERENT survival shapes — the point of drawing six curves at all:
//
//   CRITICAL  closes fast: three of four resolved inside nine days, so the curve crosses half
//             and there is a real median.
//   HIGH      stalls: one early closure and three findings open since January, so the curve
//             never falls to half and only `medianLowerBound` is publishable.
//   LOW       moves slowly but does move: both resolved, one at ten days and one at forty.
//
// MEDIUM / INFO / UNKNOWN have no rows at all, which is the "one entry per severity PRESENT"
// case.
function seed(): void {
  const state: LedgerState = emptyState();
  const rows = [
    row({ vuln_key: "c1", severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", status: "RESOLVED", resolved_at: "2026-01-06T00:00:00Z" }),
    row({ vuln_key: "c2", severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", status: "RESOLVED", resolved_at: "2026-01-08T00:00:00Z" }),
    row({ vuln_key: "c3", severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", status: "RESOLVED", resolved_at: "2026-01-10T00:00:00Z" }),
    row({ vuln_key: "c4", severity: "CRITICAL", first_seen: "2026-01-01T00:00:00Z", status: "OPEN" }),

    row({ vuln_key: "h1", severity: "HIGH", first_seen: "2026-01-02T00:00:00Z", status: "RESOLVED", resolved_at: "2026-01-05T00:00:00Z" }),
    row({ vuln_key: "h2", severity: "HIGH", first_seen: "2026-01-02T00:00:00Z", status: "OPEN" }),
    row({ vuln_key: "h3", severity: "HIGH", first_seen: "2026-01-02T00:00:00Z", status: "OPEN" }),
    row({ vuln_key: "h4", severity: "HIGH", first_seen: "2026-01-02T00:00:00Z", status: "OPEN" }),

    row({ vuln_key: "l1", severity: "LOW", first_seen: "2026-01-03T00:00:00Z", status: "RESOLVED", resolved_at: "2026-01-13T00:00:00Z" }),
    row({ vuln_key: "l2", severity: "LOW", first_seen: "2026-01-03T00:00:00Z", status: "RESOLVED", resolved_at: "2026-02-12T00:00:00Z" }),
  ];
  for (const r of rows) state.ledger[r.vuln_key] = r;
  H.rows = baseRows(state, NOW);
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
  seed();
  const res = getMttr({}) as { ok: boolean; data?: { remediation: Remediation } };
  expect(res.ok, "getMttr refused the seeded ledger").toBe(true);
  rem = res.data!.remediation;
});

describe("mttrData ships one Kaplan-Meier curve per severity", () => {
  it("has an entry for every severity that has rows, and none for the ones that do not", () => {
    expect(Object.keys(rem.kmPerSev).slice().sort()).toEqual(["CRITICAL", "HIGH", "LOW"]);
    expect(Object.keys(rem.kmPerSev)).not.toContain("MEDIUM");
    expect(Object.keys(rem.kmPerSev)).not.toContain("UNKNOWN");
    // The stat maps and the curve map cover exactly the same severities — a severity in one
    // and not the other would draw a card with no row, or a row with no card.
    expect(Object.keys(rem.kmPerSev).slice().sort())
      .toEqual(Object.keys(rem.kmMedianPerSev).slice().sort());
    expect(Object.keys(rem.kmPerSev).slice().sort())
      .toEqual(Object.keys(rem.kmLowerBoundPerSev).slice().sort());
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

  // PERTURBATION, INLINE. The transcript in this file's header is the real one, run against
  // src/server/api.ts and reverted; this reproduces the same defective value here so the
  // failure is a thing a reader can see rather than a thing they have to take on trust. A
  // `KMResult` and a `ShippedKM` are structurally different in two ways at once, and only the
  // pair of assertions distinguishes them.
  it("is not a vacuous guard — the un-narrowed KMResult fails both halves of the shape check", () => {
    // What `kaplanMeier` actually returns, in the shape the perturbation shipped.
    const unNarrowed = {
      curve: [{ t: 5, s: 0.75, atRisk: 4, events: 1 }],
      median: 5,
      medianLowerBound: null,
      mean: 37,
      restrictionTime: 69,
      meanTruncated: true,
      naiveMean: 7,
      naiveMedian: 7,
      events: 3,
      censored: 1,
      total: 4,
    };
    // 1. Two extra fields per point, which is also what makes `survivalTableModel` publish two
    //    columns the fan's payload cannot fill for the register-wide curve beside it.
    expect(Object.keys(unNarrowed.curve[0]!).slice().sort())
      .toEqual(["atRisk", "events", "s", "t"]);
    expect(Object.keys(rem.kmPerSev["CRITICAL"]!.curve[0]!).slice().sort()).toEqual(["s", "t"]);
    // 2. And `p90` is not a `KMResult` field at all — it is computed inside `shipKM`, so the
    //    un-narrowed shape turns a MEASURED null into an ABSENT field, which is the difference
    //    between "the curve never reached nine in ten" and "nobody looked".
    expect((unNarrowed as Record<string, unknown>)["p90"]).toBeUndefined();
    expect(rem.kmPerSev["CRITICAL"]!.p90).toBeNull();
    expect("p90" in rem.kmPerSev["CRITICAL"]!).toBe(true);
  });
});
