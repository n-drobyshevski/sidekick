// The Executive front door's ranking rule, and the accounting that keeps it honest.
//
// `src/server/fixNext.ts` is pure over `BaseRow[]`: no Sheets, no Drive, no clock beyond the
// `now` it is handed. So everything below runs over hand-built rows, and what is under test is
// the ARGUMENT — which finding earns a leader's attention first, and what happens to the ones
// that do not.
//
// THE SPEC THAT MATTERS MOST HERE IS THE SUM. A ranked top-8 with no denominator is a list
// that silently deletes a backlog: it looks the same whether four findings were left out or
// four thousand. `ranked + noFix + unvalidated + insideSla + other === openTotal` is the
// invariant that makes the omission legible, and it is asserted over a fixture that reaches
// every branch rather than over a convenient one.
//
// PERTURBATIONS (run 2026-09-04, both reverted — see the two `it` blocks that name them).

import { describe, expect, it } from "vitest";

import { fixNext } from "../src/server/fixNext";
import type { BaseRow } from "../src/domain/ledgerTypes";
import type { Scope } from "../src/domain/config";

const NOW = Date.parse("2026-09-04T00:00:00Z");

interface RowSpec {
  scope: Scope;
  severity?: string;
  status?: string;
  age?: number | null;
  repo?: string | null;
  owner?: string | null;
  fixAvailable?: boolean;
  validation?: string | null;
}

/** A base row with only the columns this ranking reads set, and everything else inert. */
function row(spec: RowSpec, i: number): BaseRow {
  const sev = spec.severity ?? "CRITICAL";
  return {
    finding_key: `${spec.scope}:${i}`,
    scope: spec.scope,
    identifier: `id-${i}`,
    component: null,
    severity: sev,
    repo_id: spec.repo === undefined ? "repo-a" : spec.repo,
    repo_name: spec.repo === undefined ? "repo-a" : spec.repo,
    branch: null,
    platform: null,
    first_seen: "2026-01-01T00:00:00Z",
    last_seen: "2026-09-01T00:00:00Z",
    status: spec.status ?? "OPEN",
    resolved_at: null,
    resolution_src: null,
    reopened_count: 0,
    first_scan_id: null,
    last_scan_id: null,
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
    validation_state: spec.validation === undefined ? null : spec.validation,
    validated_at: null,
    confidence: null,
    owner_project: spec.owner === undefined ? "payments" : spec.owner,
    owner_path: null,
    tags_json: null,
    projects_json: null,
    mttr_days: null,
    age_days: spec.age === undefined ? 100 : spec.age,
    // sast and secrets collapse this onto first_seen in `ledgerCore.baseRows`, so only sca
    // can ever carry a null here — the fixture keeps that asymmetry.
    fix_available_at: spec.scope === "sca"
      ? (spec.fixAvailable === false ? null : "2026-02-01T00:00:00Z")
      : "2026-01-01T00:00:00Z",
    actionable_from: null,
    mttr_actionable_days: null,
    actionable_age_days: null,
    awaiting_vendor_fix: spec.scope === "sca" && spec.fixAvailable === false,
  };
}

function rows(...specs: RowSpec[]): BaseRow[] {
  return specs.map(row);
}

/**
 * A population reaching every tier and every unranked reason at once.
 *
 *   tier 1   2 live secrets in repo-a, 1 in repo-b
 *   tier 2   3 SCA CRITICAL/HIGH with a fix, past SLA, in repo-a
 *   tier 3   1 SAST CRITICAL past SLA in repo-c
 *   noFix        1 SCA with no published fix (past SLA, so it would otherwise rank)
 *   unvalidated  1 UNKNOWN secret, 1 INVALID secret (confirmed dead is still not live)
 *   insideSla    1 SCA CRITICAL with a fix, 2 days old against a 7-day target
 *   other        1 SCA MEDIUM past its 30-day target (below tier 2's bar),
 *                1 SAST HIGH past its 14-day target (below tier 3's bar),
 *                1 SCA CRITICAL with no readable age
 *   resolved     1 closed row, which must not appear in ANY count
 */
function population(): BaseRow[] {
  return rows(
    { scope: "secrets", validation: "VALID", repo: "repo-a", severity: "LOW" },
    { scope: "secrets", validation: "VALID", repo: "repo-a", severity: "INFO", age: 400 },
    { scope: "secrets", validation: "VALID", repo: "repo-b", severity: "LOW", age: 10 },

    { scope: "sca", severity: "CRITICAL", repo: "repo-a", age: 200 },
    { scope: "sca", severity: "HIGH", repo: "repo-a", age: 50 },
    { scope: "sca", severity: "CRITICAL", repo: "repo-a", age: 30 },

    { scope: "sast", severity: "CRITICAL", repo: "repo-c", age: 90 },

    { scope: "sca", severity: "CRITICAL", repo: "repo-a", age: 300, fixAvailable: false },

    { scope: "secrets", validation: "UNKNOWN", repo: "repo-a" },
    { scope: "secrets", validation: "INVALID", repo: "repo-a" },

    { scope: "sca", severity: "CRITICAL", repo: "repo-a", age: 2 },

    { scope: "sca", severity: "MEDIUM", repo: "repo-a", age: 60 },
    { scope: "sast", severity: "HIGH", repo: "repo-c", age: 60 },
    { scope: "sca", severity: "CRITICAL", repo: "repo-a", age: null },

    { scope: "sca", severity: "CRITICAL", repo: "repo-a", age: 900, status: "RESOLVED" },
  );
}

describe("the three tiers", () => {
  const out = fixNext(population(), { now: NOW });

  it("ranks a confirmed-live secret first, whatever its severity says", () => {
    // Both tier-1 rows are LOW/INFO — severity grades the DETECTION, and the two live
    // credentials outrank three CRITICAL/HIGH dependency findings anyway.
    expect(out.groups[0]!.tier).toBe(1);
    expect(out.groups[0]!.scope).toBe("secrets");
    expect(out.tiers["1"]).toBe(3);
  });

  it("puts a fixable, late SCA finding in tier 2 and a late critical SAST one in tier 3", () => {
    expect(out.tiers["2"]).toBe(3);
    expect(out.tiers["3"]).toBe(1);
    const tier2 = out.groups.filter((g) => g.tier === 2);
    expect(tier2.length).toBe(1);
    expect(tier2[0]!.scope).toBe("sca");
    const tier3 = out.groups.filter((g) => g.tier === 3);
    expect(tier3[0]!.scope).toBe("sast");
    expect(tier3[0]!.repo).toBe("repo-c");
  });

  it("orders by tier, then by count descending, then oldest first", () => {
    const shape = out.groups.map((g) => [g.tier, g.repo, g.count]);
    expect(shape).toEqual([
      [1, "repo-a", 2],
      [1, "repo-b", 1],
      [2, "repo-a", 3],
      [3, "repo-c", 1],
    ]);
  });

  it("groups by repository and carries the oldest age and the one owning project", () => {
    const a = out.groups[0]!;
    expect(a.repo).toBe("repo-a");
    expect(a.count).toBe(2);
    expect(a.oldestAgeDays).toBe(400);
    expect(a.owner_project).toBe("payments");
    expect(a.route).toBe("secrets");
    expect(a.params).toEqual({ scope: "secrets", repo: "repo-a" });
  });

  it("refuses to name an owner where the group's rows disagree", () => {
    const mixed = fixNext(rows(
      { scope: "secrets", validation: "VALID", repo: "repo-a", owner: "payments" },
      { scope: "secrets", validation: "VALID", repo: "repo-a", owner: "billing" },
    ), { now: NOW });
    expect(mixed.groups[0]!.count).toBe(2);
    expect(mixed.groups[0]!.owner_project).toBeNull();
  });

  // PERTURBATION (a), run 2026-09-04 then reverted. `secretIsLive` in src/server/fixNext.ts
  // was widened to rank an INVALID secret as tier 1:
  //     return ["VALID", "INVALID"].includes(String(row.validation_state ?? "").toUpperCase());
  // Observed — 5 failed | 11 passed:
  //   FAIL  test/fixNext.test.ts > the three tiers > ranks a confirmed-live secret first, whatever its severity says
  //     AssertionError: expected 4 to be 3 // Object.is equality
  //   FAIL  test/fixNext.test.ts > the three tiers > orders by tier, then by count descending, then oldest first
  //     AssertionError: expected [ [ 1, 'repo-a', 3 ], ...(3) ] to deeply equal [ [ 1, 'repo-a', 2 ], ...(3) ]
  //   FAIL  test/fixNext.test.ts > the three tiers > groups by repository and carries the oldest age and the one owning project
  //     AssertionError: expected 3 to be 2 // Object.is equality
  //   FAIL  test/fixNext.test.ts > the three tiers > does not rank a secret the tenant reported INVALID
  //     AssertionError: expected [ { tier: 1, ...(8) } ] to deeply equal []
  //   FAIL  test/fixNext.test.ts > the unranked accounting > names a reason for every open row it did not rank
  //     AssertionError: expected 1 to be 2 // Object.is equality
  // Five specs across two describes, so the claim is held in several independent places
  // rather than by the one count that names it.
  it("does not rank a secret the tenant reported INVALID — confirmed dead is not live", () => {
    const only = fixNext(rows({ scope: "secrets", validation: "INVALID" }), { now: NOW });
    expect(only.groups).toEqual([]);
    expect(only.tiers["1"]).toBe(0);
    expect(only.unranked.unvalidated).toBe(1);
  });
});

describe("the unranked accounting", () => {
  const out = fixNext(population(), { now: NOW });

  // PERTURBATION (b), run 2026-09-04 then reverted. The `unranked[verdict.reason] += 1` line
  // in `fixNext` was deleted, leaving a bare `continue` and dropping the accounting entirely.
  // Observed — 7 failed | 9 passed:
  //   FAIL  test/fixNext.test.ts > the unranked accounting > the ranked and the unranked sum to the open total, with nothing dropped
  //     AssertionError: 7 ranked + 0 unranked !== 14 open: expected 7 to be 14 // Object.is equality
  //   FAIL  test/fixNext.test.ts > the unranked accounting > names a reason for every open row it did not rank
  //     AssertionError: expected +0 to be 1 // Object.is equality
  //   (plus the four narrower reason specs, and the INVALID spec above)
  // The SUM case is the one that had to bite, and it is the only one here that would also
  // catch a reason MIS-attributed rather than lost — a bucket credited to the wrong reason
  // leaves the total intact, which is why the four per-reason counts are pinned separately.
  it("names a reason for every open row it did not rank", () => {
    expect(out.unranked.noFix).toBe(1);
    expect(out.unranked.unvalidated).toBe(2);
    expect(out.unranked.insideSla).toBe(1);
    expect(out.unranked.other).toBe(3);
  });

  it("the ranked and the unranked sum to the open total, with nothing dropped", () => {
    const u = out.unranked;
    const sum = out.ranked + u.noFix + u.unvalidated + u.insideSla + u.other;
    expect(sum, `${out.ranked} ranked + ${sum - out.ranked} unranked !== ${out.openTotal} open`)
      .toBe(out.openTotal);
    // And the open total is the OPEN rows only — the one resolved row in the fixture is
    // outside every count here, not filed under "other".
    expect(out.openTotal).toBe(14);
  });

  it("files an SCA finding with no published fix under noFix even when it is past SLA", () => {
    // 300 days old against a 7-day CRITICAL target. Waiting on a vendor is not a slow team,
    // so the no-fix test runs BEFORE the SLA test and this row never reaches tier 2.
    const one = fixNext(rows(
      { scope: "sca", severity: "CRITICAL", age: 300, fixAvailable: false },
    ), { now: NOW });
    expect(one.unranked).toEqual({ noFix: 1, unvalidated: 0, insideSla: 0, other: 0 });
    expect(one.groups).toEqual([]);
  });

  it("calls an unmeasurable age `other`, never `insideSla` — inside SLA is a claim", () => {
    const one = fixNext(rows({ scope: "sca", severity: "CRITICAL", age: null }), { now: NOW });
    expect(one.unranked.insideSla).toBe(0);
    expect(one.unranked.other).toBe(1);
  });

  it("never breaches a severity that has no deadline", () => {
    const one = fixNext(rows({ scope: "sast", severity: "UNKNOWN", age: 5000 }), { now: NOW });
    expect(one.unranked.other).toBe(1);
    expect(one.tiers["3"]).toBe(0);
  });

  it("takes the SLA windows it is handed rather than the built-in ones", () => {
    const spec: RowSpec = { scope: "sca", severity: "CRITICAL", age: 10 };
    // 10 days: past the default 7-day CRITICAL window, inside a 30-day one.
    expect(fixNext(rows(spec), { now: NOW }).tiers["2"]).toBe(1);
    const loose = fixNext(rows(spec), { now: NOW, slaTargets: { CRITICAL: 30 } });
    expect(loose.tiers["2"]).toBe(0);
    expect(loose.unranked.insideSla).toBe(1);
  });
});

describe("the limit", () => {
  /** One tier-1 group per repository, so the group count is the knob under test. */
  function manyRepos(n: number): BaseRow[] {
    const specs: RowSpec[] = [];
    for (let i = 0; i < n; i += 1) {
      // Descending counts, so the truncation cuts the SMALLEST groups and the order is total.
      for (let k = 0; k <= n - i; k += 1) {
        specs.push({ scope: "secrets", validation: "VALID", repo: `repo-${i}` });
      }
    }
    return rows(...specs);
  }

  it("truncates the groups and reports how many, and how much, it cut", () => {
    const all = fixNext(manyRepos(10), { now: NOW, limit: 1000 });
    expect(all.groupsTotal).toBe(10);
    expect(all.groupsCut).toBe(0);
    expect(all.findingsCut).toBe(0);

    const cut = fixNext(manyRepos(10), { now: NOW, limit: 3 });
    expect(cut.groups.length).toBe(3);
    expect(cut.groupsTotal).toBe(10);
    expect(cut.groupsCut).toBe(7);
    expect(cut.findingsCut).toBe(all.groups.slice(3).reduce((n, g) => n + g.count, 0));
    expect(cut.findingsCut).toBeGreaterThan(0);
  });

  it("counts the whole tier, not the part that survived the limit", () => {
    const cut = fixNext(manyRepos(10), { now: NOW, limit: 3 });
    const drawn = cut.groups.reduce((n, g) => n + g.count, 0);
    expect(cut.tiers["1"]).toBeGreaterThan(drawn);
    expect(cut.tiers["1"]).toBe(cut.ranked);
    // The accounting still closes over the WHOLE population, truncation notwithstanding.
    const u = cut.unranked;
    expect(cut.ranked + u.noFix + u.unvalidated + u.insideSla + u.other).toBe(cut.openTotal);
  });

  it("defaults to eight groups", () => {
    expect(fixNext(manyRepos(20), { now: NOW }).groups.length).toBe(8);
    expect(fixNext(manyRepos(20), { now: NOW }).limit).toBe(8);
  });
});

describe("an empty register", () => {
  it("returns zeros and no groups rather than throwing", () => {
    const out = fixNext([], { now: NOW });
    expect(out.groups).toEqual([]);
    expect(out.openTotal).toBe(0);
    expect(out.ranked).toBe(0);
    expect(out.unranked).toEqual({ noFix: 0, unvalidated: 0, insideSla: 0, other: 0 });
    expect(out.asOf).toBe(NOW);
  });
});
