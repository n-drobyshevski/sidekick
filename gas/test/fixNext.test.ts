// The Executive front door's ranking rule, and the accounting that keeps it honest.
//
// `src/domain/fixNext.ts` is pure over its arguments: no Sheets, no Drive, no settings read,
// no clock beyond the `now` it is handed. So everything below runs over hand-built rows, and
// what is under test is the ARGUMENT — which finding earns a leader's attention first, and
// what happens to the ones that do not.
//
// THE SPEC THAT MATTERS MOST HERE IS THE SUM. A ranked top-8 with no denominator is a list
// that silently deletes a backlog: it looks the same whether four findings were left out or
// four thousand. `ranked + noFix + unclassified + insideSla + other === openTotal` is the
// invariant that makes the omission legible, and it is asserted over a fixture that reaches
// EVERY branch rather than over a convenient one.
//
// THE THREE PERTURBATIONS at the bottom each reproduce a defective rewrite INLINE and show it
// giving the wrong answer, rather than asserting the rule from a comment. Two of them are
// rewrites a reviewer would plausibly propose as simplifications.

import { describe, expect, it } from "vitest";

import { fixNext, type FixNextRow } from "../src/domain/fixNext";
import { SLA_TARGETS, isOpenStatus } from "../src/domain/config";
import { DEFAULT_RISK_RULE, type RiskRule, riskTier } from "../src/domain/program";
import { normalizeSeverity } from "../src/domain/severity";

const NOW = Date.parse("2026-09-07T00:00:00Z");
const RULE = DEFAULT_RISK_RULE;

interface RowSpec {
  severity?: string;
  status?: string;
  /** Tri-state on purpose. `undefined` in the spec means "leave it null" — never false. */
  kev?: boolean | null;
  exploit?: boolean | null;
  epss?: number | null;
  /** Whether a vendor fix exists (`fix_available_at` non-null). */
  fix?: boolean;
  awaiting?: boolean;
  /** The ACTIONABLE clock — what lateness is measured on. */
  actionableAge?: number | null;
  /** The DETECTION clock — what `oldestAgeDays` reports, and what tier 2 must NOT read. */
  age?: number | null;
  cve?: string | null;
  asset?: string | null;
  sub?: string | null;
  sg?: string | null;
  domain?: string | null;
  /** Whether this row's `vuln_key` is in the frame's exposed set. */
  exposed?: boolean;
}

let seq = 0;
const exposedKeys = new Set<string>();

/** A base row with only the columns this ranking reads set, and nothing else guessed at. */
function row(spec: RowSpec): FixNextRow {
  seq += 1;
  const key = `vk-${seq}`;
  if (spec.exposed) exposedKeys.add(key);
  const age = spec.age === undefined ? 100 : spec.age;
  return {
    vuln_key: key,
    cve: spec.cve === undefined ? "CVE-2026-0001" : spec.cve,
    severity: spec.severity ?? "CRITICAL",
    status: spec.status ?? "OPEN",
    has_kev: spec.kev === undefined ? null : spec.kev,
    has_exploit: spec.exploit === undefined ? null : spec.exploit,
    epss: spec.epss === undefined ? null : spec.epss,
    fix_available_at: spec.fix === false ? null : "2026-06-01T00:00:00Z",
    awaiting_vendor_fix: spec.awaiting === true,
    actionable_age_days: spec.actionableAge === undefined ? age : spec.actionableAge,
    age_days: age,
    asset_name: spec.asset === undefined ? "web-prod-01" : spec.asset,
    subscription_name: spec.sub === undefined ? "prod-account" : spec.sub,
    _supportGroup: spec.sg === undefined ? "CS-CORE" : spec.sg,
    _domain: spec.domain === undefined ? "RETAIL" : spec.domain,
  };
}

function rows(...specs: RowSpec[]): FixNextRow[] {
  return specs.map(row);
}

/**
 * A population reaching every tier and every unranked reason at once.
 *
 *   tier 1        2 KEV-and-exposed rows owned by CS-A, 1 owned by CS-B. One of the CS-A pair
 *                 is VENDOR-BLOCKED, and one is well inside its window — the tier has neither
 *                 a fix gate nor an SLA gate, and the fixture says so in rows.
 *   tier 2        3 exploitable, fixable, late rows owned by CS-A
 *   tier 3        1 CRITICAL, fixable, late row with the signals captured and none fired
 *   noFix         1 vendor-blocked row that is NOT KEV-and-exposed
 *   unclassified  1 HIGH past SLA with all three signals never captured
 *   insideSla     1 CRITICAL, fixable, 2 days on the actionable clock against a 7-day window
 *   other         1 UNKNOWN severity (no SLA target at all),
 *                 1 row with no readable actionable age,
 *                 1 MEDIUM past SLA whose signals were captured and did not fire
 *   resolved      1 closed row, which must not appear in ANY count
 */
function population(): FixNextRow[] {
  return rows(
    { kev: true, exposed: true, sg: "CS-A", asset: "a1", age: 210, cve: "CVE-A" },
    { kev: true, exposed: true, sg: "CS-A", asset: "a1", age: 5, actionableAge: null,
      fix: false, awaiting: true, cve: "CVE-A" },
    { kev: true, exposed: true, sg: "CS-B", asset: "b1", severity: "HIGH",
      age: 3, actionableAge: 3, cve: "CVE-B" },

    { kev: true, exploit: true, epss: 0.8, sg: "CS-A", asset: "a2", age: 60, cve: "CVE-C" },
    { exploit: true, kev: false, epss: 0.4, sg: "CS-A", asset: "a3", severity: "HIGH",
      age: 40, cve: "CVE-C" },
    { exploit: true, kev: false, epss: 0.4, sg: "CS-A", asset: "a3", severity: "HIGH",
      age: 30, cve: "CVE-D" },

    { kev: false, exploit: false, epss: 0.01, sg: "CS-C", asset: "c1", age: 50, cve: "CVE-E" },

    { kev: false, exploit: false, epss: 0.01, sg: "CS-D", fix: false, awaiting: true,
      actionableAge: null, age: 9 },

    { severity: "HIGH", sg: "CS-D", age: 120 },

    // 120 days since detection, 2 days since a fix existed. The two clocks disagree by 118
    // days here on purpose: it is the row perturbation (c) at the bottom of this file bites.
    { sg: "CS-D", actionableAge: 2, age: 120, kev: false, exploit: false, epss: 0.01 },

    { severity: "UNKNOWN", sg: "CS-D", age: 900, kev: false, exploit: false, epss: 0.01 },
    { sg: "CS-D", actionableAge: null, age: 900, kev: false, exploit: false, epss: 0.01 },
    { severity: "MEDIUM", sg: "CS-D", age: 60, kev: false, exploit: false, epss: 0.01 },

    { kev: true, exposed: true, sg: "CS-A", status: "RESOLVED", age: 900 },
  );
}

/** The default call: exposure joined and known, the default rule, the shipped SLA windows. */
function run(rs: FixNextRow[], over: Record<string, unknown> = {}) {
  return fixNext(rs, {
    rule: RULE, exposedKeys, exposureKnown: true, now: NOW, ...over,
  });
}

describe("the three tiers", () => {
  const out = run(population());

  it("ranks a known-exploited reachable finding first, whatever its clocks say", () => {
    // Of the three tier-1 rows one is vendor-blocked and one is three days old against a
    // 14-day window. Neither fact demotes it: the action is to take the host off the
    // internet, and that needs no patch and no deadline.
    expect(out.groups[0]!.tier).toBe(1);
    expect(out.tiers["1"]).toBe(3);
  });

  it("needs BOTH a fix and a late actionable clock for tier 2", () => {
    const exploitable: RowSpec = { exploit: true, kev: false, epss: 0.4, severity: "HIGH" };
    // 40 days against HIGH's 14-day window, with a fix: tier 2.
    expect(run(rows({ ...exploitable, age: 40 })).tiers["2"]).toBe(1);
    // Same row, no published fix at all: not late, awaiting a vendor.
    expect(run(rows({ ...exploitable, age: 40, fix: false, awaiting: true,
      actionableAge: null })).tiers["2"]).toBe(0);
    // Same row with a fix, 10 days on the actionable clock: inside its window.
    const inside = run(rows({ ...exploitable, age: 40, actionableAge: 10 }));
    expect(inside.tiers["2"]).toBe(0);
    expect(inside.unranked.insideSla).toBe(1);
  });

  it("reserves tier 3 for CRITICAL — a late HIGH with no exploit evidence is not in it", () => {
    const captured = { kev: false, exploit: false, epss: 0.01 };
    expect(run(rows({ ...captured, severity: "CRITICAL", age: 50 })).tiers["3"]).toBe(1);
    const high = run(rows({ ...captured, severity: "HIGH", age: 50 }));
    expect(high.tiers["3"]).toBe(0);
    expect(high.unranked.other).toBe(1);
  });

  it("orders by tier, then count descending, then oldest first, then owner", () => {
    const shape = out.groups.map((g) => [g.tier, g.owner, g.count]);
    expect(shape).toEqual([
      [1, "CS-A", 2],
      [1, "CS-B", 1],
      [2, "CS-A", 3],
      [3, "CS-C", 1],
    ]);
  });

  it("carries the group's assets, its oldest DETECTION age, and its commonest CVE", () => {
    const t2 = out.groups.find((g) => g.tier === 2)!;
    expect(t2.count).toBe(3);
    expect(t2.assets).toBe(2); // a2 and a3, three findings between them
    expect(t2.oldestAgeDays).toBe(60);
    expect(t2.topCve).toEqual({ cve: "CVE-C", count: 2 });
    expect(t2.route).toBe("overview");
    expect(t2.params).toEqual({ supportGroup: "CS-A", tier: 2 });
  });
});

describe("who a group belongs to", () => {
  it("prefers the support group, falls back to the subscription, then to nobody", () => {
    const three = run(rows(
      { kev: true, exposed: true, sg: "CS-A", sub: "prod-account" },
      { kev: true, exposed: true, sg: null, sub: "prod-account" },
      { kev: true, exposed: true, sg: null, sub: null },
    ));
    // All three tie on tier, count and age, so the order falls to the owner comparator, where
    // an unowned group's key is the empty string and therefore sorts first. Arbitrary, and
    // TOTAL, which is the property that matters: the same ledger always produces this list.
    expect(three.groups.map((g) => [g.owner, g.ownerKind])).toEqual([
      [null, null],
      ["CS-A", "supportGroup"],
      ["prod-account", "subscription"],
    ]);
  });

  it("treats a blank support group as absent rather than as a group named ''", () => {
    const out = run(rows({ kev: true, exposed: true, sg: "   ", sub: "prod-account" }));
    expect(out.groups[0]!.owner).toBe("prod-account");
    expect(out.groups[0]!.ownerKind).toBe("subscription");
  });

  it("puts a deep-link supportGroup in params only when the owner IS one", () => {
    const out = run(rows(
      { kev: true, exposed: true, sg: "CS-A" },
      { kev: true, exposed: true, sg: null, sub: "prod-account" },
    ));
    expect(out.groups[0]!.params).toEqual({ supportGroup: "CS-A", tier: 1 });
    // A subscription name is not a value the Overview's support-group filter accepts, so
    // shipping it would produce a link that filters to nothing.
    expect(out.groups[1]!.params).toEqual({ tier: 1 });
  });

  it("refuses to name a domain where the group's rows disagree, or where one has none", () => {
    const agree = run(rows(
      { kev: true, exposed: true, sg: "CS-A", domain: "SAP" },
      { kev: true, exposed: true, sg: "CS-A", domain: "SAP" },
    ));
    expect(agree.groups[0]!.domain).toBe("SAP");

    const disagree = run(rows(
      { kev: true, exposed: true, sg: "CS-A", domain: "SAP" },
      { kev: true, exposed: true, sg: "CS-A", domain: "RETAIL" },
    ));
    expect(disagree.groups[0]!.domain).toBeNull();

    // "Some of these are Not attributable" is not "all of these are SAP".
    const partial = run(rows(
      { kev: true, exposed: true, sg: "CS-A", domain: "SAP" },
      { kev: true, exposed: true, sg: "CS-A", domain: null },
    ));
    expect(partial.groups[0]!.domain).toBeNull();
  });
});

describe("exposure is a join the caller may not have been able to make", () => {
  it("empties tier 1 when the frame carried no exposure fields, and SAYS it did", () => {
    const specs: RowSpec[] = [{ kev: true, exposed: true, age: 3, actionableAge: 3 }];
    const known = run(rows(...specs));
    expect(known.tiers["1"]).toBe(1);
    expect(known.exposureKnown).toBe(true);

    const unknown = run(rows(...specs), { exposureKnown: false });
    expect(unknown.tiers["1"]).toBe(0);
    // The flag is the whole point: without it, this payload is indistinguishable from a
    // register where nothing known-exploited is reachable — absent is not none.
    expect(unknown.exposureKnown).toBe(false);
    // And the row is still accounted for, in the bucket its own clocks earn it.
    expect(unknown.ranked + unknown.unranked.noFix + unknown.unranked.unclassified
      + unknown.unranked.insideSla + unknown.unranked.other).toBe(unknown.openTotal);
  });

  it("never ranks a KEV null as a KEV true — a tri-state is not a truthiness test", () => {
    // HIGH rather than CRITICAL, deliberately: tier 3 claims a late CRITICAL on SEVERITY
    // alone and would rank this row for a reason that has nothing to do with its KEV flag,
    // which is not the claim under test. Measured while writing this — the first version of
    // this spec used the default CRITICAL and read `tiers["3"] === 1`.
    const out = run(rows({ kev: null, exploit: null, epss: null, exposed: true,
      severity: "HIGH", age: 900 }));
    expect(out.tiers["1"]).toBe(0);
    expect(out.tiers["2"]).toBe(0);
    expect(out.tiers["3"]).toBe(0);
    // And it does not count as a CAPTURED signal either: nobody looked, which is what
    // `unclassified` means and is not the same as "looked, and the answer was no".
    expect(out.unranked.unclassified).toBe(1);
    expect(out.unranked.other).toBe(0);
  });

  it("does not rank an exposed row whose KEV flag is an observed false", () => {
    const out = run(rows({ kev: false, exploit: false, epss: 0.01, exposed: true,
      severity: "HIGH", age: 900 }));
    expect(out.tiers["1"]).toBe(0);
    expect(out.unranked.other).toBe(1);
    expect(out.unranked.unclassified).toBe(0);
  });
});

describe("the unranked accounting", () => {
  const out = run(population());

  it("names a reason for every open row it did not rank", () => {
    expect(out.unranked).toEqual({ noFix: 1, unclassified: 1, insideSla: 1, other: 3 });
  });

  it("the ranked and the unranked sum to the open total, with nothing dropped", () => {
    const u = out.unranked;
    const sum = out.ranked + u.noFix + u.unclassified + u.insideSla + u.other;
    expect(sum, `${out.ranked} ranked + ${sum - out.ranked} unranked !== ${out.openTotal} open`)
      .toBe(out.openTotal);
    // And the open total is the OPEN rows only — the one resolved row in the fixture is
    // outside every count here, not filed under "other".
    expect(out.openTotal).toBe(13);
    expect(out.ranked).toBe(7);
  });

  it("counts a vendor-blocked finding under noFix rather than dropping it", () => {
    const one = run(rows({ fix: false, awaiting: true, actionableAge: null, age: 300 }));
    expect(one.unranked).toEqual({ noFix: 1, unclassified: 0, insideSla: 0, other: 0 });
    expect(one.groups).toEqual([]);
    expect(one.openTotal).toBe(1);
  });

  it("calls an unmeasurable age `other`, never `insideSla` — inside SLA is a claim", () => {
    const one = run(rows({ actionableAge: null, kev: false, exploit: false, epss: 0.01 }));
    expect(one.unranked.insideSla).toBe(0);
    expect(one.unranked.other).toBe(1);
  });

  it("never breaches a severity that has no deadline", () => {
    // UNKNOWN has no entry in SLA_TARGETS, so 900 days is not late — it is unmeasured.
    const one = run(rows({ severity: "UNKNOWN", age: 900, kev: false, exploit: false,
      epss: 0.01 }));
    expect(one.unranked.other).toBe(1);
    expect(one.tiers["3"]).toBe(0);
  });

  it("takes the SLA windows it is handed rather than the built-in ones", () => {
    const spec: RowSpec = { severity: "CRITICAL", age: 10, kev: false, exploit: false,
      epss: 0.01 };
    // 10 days: past the default 7-day CRITICAL window, inside a 30-day one.
    expect(run(rows(spec)).tiers["3"]).toBe(1);
    const loose = run(rows(spec), { slaTargets: { CRITICAL: 30 } });
    expect(loose.tiers["3"]).toBe(0);
    expect(loose.unranked.insideSla).toBe(1);
  });

  it("separates `unclassified` from `other` by whether anybody LOOKED", () => {
    const late = { severity: "HIGH" as const, age: 120 };
    const nobodyLooked = run(rows({ ...late, kev: null, exploit: null, epss: null }));
    expect(nobodyLooked.unranked).toEqual(
      { noFix: 0, unclassified: 1, insideSla: 0, other: 0 },
    );
    const lookedAndNothingFired = run(rows({ ...late, kev: false, exploit: false, epss: 0.01 }));
    expect(lookedAndNothingFired.unranked).toEqual(
      { noFix: 0, unclassified: 0, insideSla: 0, other: 1 },
    );
  });
});

describe("the limit", () => {
  /** One tier-1 group per owner, so the group count is the knob under test. */
  function manyOwners(n: number): FixNextRow[] {
    const specs: RowSpec[] = [];
    for (let i = 0; i < n; i += 1) {
      // Descending counts, so truncation cuts the SMALLEST groups and the order is total.
      for (let k = 0; k <= n - i; k += 1) {
        specs.push({ kev: true, exposed: true, sg: `CS-${String(i).padStart(2, "0")}` });
      }
    }
    return rows(...specs);
  }

  it("truncates the groups and reports how many, and how much, it cut", () => {
    const all = run(manyOwners(10), { limit: 1000 });
    expect(all.groupsTotal).toBe(10);
    expect(all.groupsCut).toBe(0);
    expect(all.findingsCut).toBe(0);

    const cut = run(manyOwners(10), { limit: 3 });
    expect(cut.groups.length).toBe(3);
    expect(cut.groupsTotal).toBe(10);
    expect(cut.groupsCut).toBe(7);
    expect(cut.findingsCut).toBe(all.groups.slice(3).reduce((n, g) => n + g.count, 0));
    expect(cut.findingsCut).toBeGreaterThan(0);
  });

  it("counts the whole tier, not the part that survived the limit", () => {
    const cut = run(manyOwners(10), { limit: 3 });
    const drawn = cut.groups.reduce((n, g) => n + g.count, 0);
    expect(cut.tiers["1"]).toBeGreaterThan(drawn);
    expect(cut.tiers["1"]).toBe(cut.ranked);
    const u = cut.unranked;
    expect(cut.ranked + u.noFix + u.unclassified + u.insideSla + u.other).toBe(cut.openTotal);
  });

  it("defaults to eight groups", () => {
    expect(run(manyOwners(20)).groups.length).toBe(8);
    expect(run(manyOwners(20)).limit).toBe(8);
  });
});

describe("an empty register", () => {
  it("returns zeros and no groups rather than throwing", () => {
    const out = run([]);
    expect(out.groups).toEqual([]);
    expect(out.openTotal).toBe(0);
    expect(out.ranked).toBe(0);
    expect(out.unranked).toEqual({ noFix: 0, unclassified: 0, insideSla: 0, other: 0 });
    expect(out.asOf).toBe(NOW);
  });
});

// ---------------------------------------------------------------------- PERTURBATIONS
//
// Each of the three below reproduces a defective rewrite INLINE and asserts that it gives the
// wrong answer, rather than asserting the rule from a comment. A guard that fires on nothing
// is a finding, not a pass (CLAUDE.md), so each one is run against the population that makes
// the defect visible and the difference from `fixNext`'s real answer is what is pinned.

type Variant = "real" | "noFixFirst" | "noContinue" | "detectionClock";

/**
 * `fixNext`'s loop, transcribed, with exactly one line changeable by `variant`. Transcribing
 * rather than importing is the point: a perturbation that could not be written here would be
 * a perturbation the real module's shape already prevents, and these three are all rewrites a
 * reviewer could plausibly land.
 */
function perturbed(rs: FixNextRow[], variant: Variant, keys: Set<string>) {
  const targets: Record<string, number> = SLA_TARGETS;
  const rule: RiskRule = RULE;
  const tiers: Record<string, number> = { 1: 0, 2: 0, 3: 0 };
  const unranked = { noFix: 0, unclassified: 0, insideSla: 0, other: 0 };
  let openTotal = 0;
  let ranked = 0;

  const pastSla = (r: FixNextRow): boolean | null => {
    // (c) reads the DETECTION clock where the real module reads the actionable one.
    const raw = variant === "detectionClock" ? r.age_days : r.actionable_age_days;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    const t = targets[normalizeSeverity(r.severity)];
    if (typeof t !== "number" || !Number.isFinite(t)) return null;
    return raw > t;
  };

  const classify = (r: FixNextRow): { tier?: 1 | 2 | 3; reason?: keyof typeof unranked } => {
    const tier1 = r.has_kev === true && keys.has(r.vuln_key);
    // (a) tests the vendor-fix reason BEFORE tier 1.
    if (variant === "noFixFirst" && r.awaiting_vendor_fix === true) return { reason: "noFix" };
    if (tier1) return { tier: 1 };
    if (r.awaiting_vendor_fix === true) return { reason: "noFix" };
    const late = pastSla(r);
    if (late === null) return { reason: "other" };
    if (!late) return { reason: "insideSla" };
    const fixed = r.fix_available_at !== null && r.fix_available_at !== undefined;
    if (fixed && (r.has_kev === true || r.has_exploit === true)) return { tier: 2 };
    if (fixed && normalizeSeverity(r.severity) === "CRITICAL") return { tier: 3 };
    return riskTier(r, rule) === "unknown" ? { reason: "unclassified" } : { reason: "other" };
  };

  for (const r of rs) {
    if (!isOpenStatus(r.status)) continue;
    openTotal += 1;
    const v = classify(r);
    if (v.reason !== undefined) {
      unranked[v.reason] += 1;
      // (b) deletes this `continue`, so a row is counted twice.
      if (variant !== "noContinue") continue;
    }
    ranked += 1;
    if (v.tier !== undefined) tiers[String(v.tier)] = (tiers[String(v.tier)] ?? 0) + 1;
  }
  return { tiers, unranked, ranked, openTotal };
}

// PERTURBATION (a), run 2026-09-07 against the REAL module then reverted: the
// `awaiting_vendor_fix` test in `classify` was moved ABOVE the tier-1 test.
// Observed — 6 failed | 22 passed:
//   FAIL  the three tiers > ranks a known-exploited reachable finding first, whatever its clocks say
//     AssertionError: expected 2 to be 3 // Object.is equality
//   FAIL  the three tiers > orders by tier, then count descending, then oldest first, then owner
//     AssertionError: expected [ [ 1, 'CS-A', 1 ], ...(3) ] to deeply equal [ [ 1, 'CS-A', 2 ], ...(3) ]
//   FAIL  the unranked accounting > names a reason for every open row it did not rank
//     AssertionError: expected { noFix: 2, unclassified: 1, ...(2) } to deeply equal { noFix: 1, ... }
//   FAIL  the unranked accounting > the ranked and the unranked sum to the open total, with nothing dropped
//     AssertionError: expected 6 to be 7 // Object.is equality
//   (plus the two specs below, which name it)
// The SUM still closes under this defect — the row simply moved buckets — which is why the
// tier count and the group shape have to be pinned separately from it.
describe("perturbation (a): testing noFix before tier 1", () => {
  // The one row this bites: KEV, on an internet-reachable host, and vendor-blocked. There is
  // no patch, so every fix-gated tier passes it over — and the action a leader can take is to
  // take the host off the internet, which needs no patch at all. Filing it under "waiting on
  // a vendor" removes the most urgent row in the register from the list a leader reads.
  const one = rows({ kev: true, exposed: true, fix: false, awaiting: true,
    actionableAge: null, age: 5, sg: "CS-A" });

  it("makes a known-exploited, reachable, vendor-blocked finding LEAVE the list", () => {
    const real = run(one);
    expect(real.tiers["1"]).toBe(1);
    expect(real.unranked.noFix).toBe(0);
    expect(real.groups.length).toBe(1);

    const bad = perturbed(one, "noFixFirst", exposedKeys);
    expect(bad.tiers["1"]).toBe(0);
    expect(bad.unranked.noFix).toBe(1);
    expect(bad.ranked).toBe(0);
  });

  it("costs the whole tier on the fixture, not one row", () => {
    const pop = population();
    expect(run(pop).tiers["1"]).toBe(3);
    // Two of the three survive; the vendor-blocked one is silently reclassified.
    expect(perturbed(pop, "noFixFirst", exposedKeys).tiers["1"]).toBe(2);
    expect(perturbed(pop, "noFixFirst", exposedKeys).unranked.noFix).toBe(2);
  });
});

// PERTURBATION (b), run 2026-09-07 against the REAL module then reverted: the `continue`
// after `unranked[verdict.reason] += 1` was deleted.
// Observed — 6 failed | 22 passed:
//   FAIL  the unranked accounting > the ranked and the unranked sum to the open total, with nothing dropped
//     AssertionError: 13 ranked + 6 unranked !== 13 open: expected 19 to be 13
//   FAIL  the three tiers > orders by tier, then count descending, then oldest first, then owner
//     AssertionError: expected [ [ undefined, 'CS-D', 6 ], ...(4) ] to deeply equal [ [ 1, 'CS-A', 2 ], ...(3) ]
//   FAIL  the unranked accounting > counts a vendor-blocked finding under noFix rather than dropping it
//     AssertionError: expected [ { tier: undefined, ...(10) } ] to deeply equal []
//   (plus three more)
// The SUM case is the one that had to bite, and the message it prints — "13 ranked + 6
// unranked !== 13 open" — is the whole diagnosis in one line.
describe("perturbation (b): dropping the continue after an unranked reason", () => {
  it("overshoots openTotal — every unranked row is counted twice", () => {
    const pop = population();
    const real = run(pop);
    const r = real.unranked;
    expect(real.ranked + r.noFix + r.unclassified + r.insideSla + r.other)
      .toBe(real.openTotal);

    const bad = perturbed(pop, "noContinue", exposedKeys);
    const b = bad.unranked;
    const sum = bad.ranked + b.noFix + b.unclassified + b.insideSla + b.other;
    expect(sum).toBeGreaterThan(bad.openTotal);
    // 13 open rows, 6 of them unranked, so the sum reads 19 against a denominator of 13.
    expect(sum).toBe(19);
    expect(bad.openTotal).toBe(13);
    // The tier counts are untouched, which is exactly why the SUM is the assertion that has
    // to bite: nothing about the drawn list looks wrong.
    expect(bad.tiers).toEqual({ 1: 3, 2: 3, 3: 1 });
  });
});

// PERTURBATION (c), run 2026-09-07 against the REAL module then reverted: `pastSla` was
// changed to read `row.age_days` instead of `row.actionable_age_days`.
// Observed — 7 failed | 21 passed:
//   FAIL  the three tiers > needs BOTH a fix and a late actionable clock for tier 2
//     AssertionError: expected 1 to be +0 // Object.is equality
//   FAIL  the unranked accounting > the ranked and the unranked sum to the open total, with nothing dropped
//     AssertionError: expected 9 to be 7 // Object.is equality
//   FAIL  the unranked accounting > calls an unmeasurable age `other`, never `insideSla`
//     AssertionError: expected +0 to be 1 // Object.is equality
//   (plus four more)
// Note the third: a row with NO actionable age has a perfectly readable detection age, so
// this rewrite does not merely mis-date rows — it manufactures measurements.
describe("perturbation (c): ranking on the detection clock instead of the actionable one", () => {
  // A finding vendor-blocked for four months and patchable for two days. Its detection age is
  // 120 days; its actionable age is 2. Calling it late is calling a team late for a patch
  // that did not exist — the breach nobody could have prevented.
  const one = rows({ severity: "CRITICAL", kev: true, exploit: true, epss: 0.8,
    age: 120, actionableAge: 2, sg: "CS-A" });

  it("makes a vendor-blocked-then-fixed finding breach 118 days early", () => {
    const real = run(one);
    expect(real.tiers["2"]).toBe(0);
    expect(real.unranked.insideSla).toBe(1);

    const bad = perturbed(one, "detectionClock", exposedKeys);
    expect(bad.tiers["2"]).toBe(1);
    expect(bad.unranked.insideSla).toBe(0);
  });

  it("also empties insideSla on the fixture and invents a breach out of a null", () => {
    const pop = population();
    const real = run(pop);
    expect(real.unranked.insideSla).toBe(1);
    expect(real.unranked.other).toBe(3);
    expect(real.tiers["3"]).toBe(1);

    const bad = perturbed(pop, "detectionClock", exposedKeys);
    // Two rows move, and the SECOND is the worse of the two. The 118-day-vendor-blocked row
    // leaves `insideSla` for tier 3, which is the headline defect. But the row with NO
    // readable actionable age — `other`, because inside-SLA is a claim and this one cannot be
    // made — has a perfectly readable DETECTION age of 900 days, so the detection clock reads
    // it as a confident breach. A row nobody could measure becomes the register's worst.
    expect(bad.unranked.insideSla).toBe(0);
    expect(bad.unranked.other).toBe(2);
    expect(bad.tiers["3"]).toBe(3);
  });
});
