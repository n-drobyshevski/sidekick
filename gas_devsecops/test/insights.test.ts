// Port of gas/test/insights.test.ts, reshaped for the three-scope register — see insights.ts's
// header for the full list of what was dropped (exploitSummary, domain/supportGroup/atype/
// cloud/os/subscription dimensions, GROUP_BASE_FIELDS) and why, and for the column renames
// (cve -> identifier, asset_name -> repo_name, vuln_key -> finding_key, asset -> repo).
//
// No fixture parity here (insights.ts is GAS-first, same as gas/'s version) — every row below
// is hand-built, same as gas/'s own suite.

import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_RULE, type Scope } from "../src/domain/config";
import {
  AGE_BUCKET_LABELS,
  GROUP_COLUMNS,
  ageBuckets,
  ageBucketsBy,
  concentration,
  groupTree,
  movement,
  oldestOpen,
  openAgeMedian,
  riskTierStats,
  severityStats,
  slaConsumedDeciles,
  triageFunnel,
} from "../src/domain/insights";
import type { Rec } from "../src/domain/util";

function rec(over: Rec = {}): Rec {
  return { identifier: "CVE-2024-0001", severity: "HIGH", status: "OPEN", scope: "sca", ...over };
}

describe("severityStats", () => {
  it("splits each severity into total / open / resolved", () => {
    const records = [
      rec({ severity: "CRITICAL", status: "OPEN" }),
      rec({ severity: "CRITICAL", status: "RESOLVED" }),
      rec({ severity: "CRITICAL", status: "OPEN" }),
      rec({ severity: "HIGH", status: "RESOLVED" }),
    ];
    const stats = severityStats(records);
    expect(stats.CRITICAL).toEqual({ total: 3, open: 2, resolved: 1 });
    expect(stats.HIGH).toEqual({ total: 1, open: 0, resolved: 1 });
    for (const s of Object.values(stats)) expect(s.open + s.resolved).toBe(s.total);
  });

  it("scope filter narrows to one register", () => {
    const records = [
      rec({ severity: "CRITICAL", scope: "sca" }),
      rec({ severity: "CRITICAL", scope: "sast" }),
      rec({ severity: "CRITICAL", scope: "secrets" }),
    ];
    expect(severityStats(records, "sca").CRITICAL!.total).toBe(1);
    expect(severityStats(records).CRITICAL!.total).toBe(3);
  });
});

describe("ageBuckets", () => {
  const row = (age_days: number | null, severity = "HIGH", status = "OPEN", scope: Scope = "sca") =>
    ({ severity, status, age_days, scope });

  it("buckets at the documented edges", () => {
    const { perSev } = ageBuckets([
      row(0), row(7.0),
      row(7.01), row(30.0),
      row(30.5), row(90.0),
      row(90.1), row(400),
    ]);
    expect(perSev.HIGH).toEqual([2, 2, 2, 2]);
    expect(AGE_BUCKET_LABELS).toHaveLength(4);
  });

  it("skips resolved rows and null ages; splits per severity", () => {
    const { perSev, totalOpen } = ageBuckets([
      row(5, "CRITICAL"),
      row(50, "LOW"),
      row(5, "HIGH", "RESOLVED"),
      row(null),
    ]);
    expect(totalOpen).toBe(2);
    expect(perSev.CRITICAL).toEqual([1, 0, 0, 0]);
    expect(perSev.LOW).toEqual([0, 0, 1, 0]);
    expect(perSev.HIGH).toBeUndefined();
  });

  it("scope filter narrows the age distribution to one register", () => {
    const { totalOpen } = ageBuckets(
      [row(5, "HIGH", "OPEN", "sca"), row(5, "HIGH", "OPEN", "sast")],
      "sca",
    );
    expect(totalOpen).toBe(1);
  });
});

describe("movement", () => {
  const base = (status: string, first: string, last: string, scope: Scope = "sca") => ({
    status, first_scan_id: first, last_scan_id: last, scope,
  });
  const scan = { scan_id: "s3", new_count: 4, resolved_count: 2, reopened_count: 1 };

  it("passes scan-row deltas through and counts persisting", () => {
    const rows = [
      base("OPEN", "s1", "s3"),
      base("OPEN", "s3", "s3"),
      base("OPEN", "s1", "s2"),
      base("RESOLVED", "s1", "s3"),
    ];
    expect(movement(rows, scan, 3)).toEqual({
      newCount: 4, resolvedCount: 2, reopenedCount: 1, persisting: 1, hasPrevious: true,
    });
  });

  it("hasPrevious is false on the first scan; null scan row yields zeros", () => {
    expect(movement([], scan, 1).hasPrevious).toBe(false);
    expect(movement([base("OPEN", "s1", "s1")], null, 1)).toEqual({
      newCount: 0, resolvedCount: 0, reopenedCount: 0, persisting: 0, hasPrevious: false,
    });
  });

  it("scope filter narrows the persisting count's population", () => {
    const rows = [base("OPEN", "s1", "s3", "sca"), base("OPEN", "s1", "s3", "sast")];
    expect(movement(rows, scan, 3, "sca").persisting).toBe(1);
    expect(movement(rows, scan, 3).persisting).toBe(2);
  });
});

describe("oldestOpen", () => {
  // Base-row shape the aggregation reads: age_days + status + identifier/severity/repo_name/
  // owner_project. No _domain/_supportGroup — dropped (host-only, see insights.ts's header).
  const brow = (over: Record<string, unknown> = {}) => ({
    identifier: "CVE-2024-0001", severity: "HIGH", status: "OPEN", repo_name: "web-1",
    owner_project: "proj-1", age_days: 10, scope: "sca", ...over,
  });

  it("findings: sorted by age desc, capped at topN, resolved & null-age excluded", () => {
    const { findings } = oldestOpen([
      brow({ identifier: "old", age_days: 400 }),
      brow({ identifier: "mid", age_days: 100 }),
      brow({ identifier: "young", age_days: 5 }),
      brow({ identifier: "resolved", age_days: 999, status: "RESOLVED" }),
      brow({ identifier: "noage", age_days: null }),
    ] as never, 2);
    expect(findings.map((f) => f.identifier)).toEqual(["old", "mid"]);
    expect(findings[0]).toEqual({
      identifier: "old", repo: "web-1", ownerProject: "proj-1", severity: "HIGH", ageDays: 400,
    });
  });

  it("byRepo: agedCount is the >90d tail, oldestDays the max, open counts all open", () => {
    const { byRepo } = oldestOpen([
      brow({ repo_name: "web-1", age_days: 120 }),  // aged
      brow({ repo_name: "web-1", age_days: 91 }),   // aged (strictly > 90)
      brow({ repo_name: "web-1", age_days: 90 }),   // not aged (boundary)
      brow({ repo_name: "web-1", age_days: 5 }),
      brow({ repo_name: "web-1", age_days: 999, status: "RESOLVED" }), // excluded
    ] as never);
    expect(byRepo).toHaveLength(1);
    expect(byRepo[0]).toEqual({
      key: "web-1", agedCount: 2, openCount: 4, oldestDays: 120, ownerProject: "proj-1",
    });
  });

  it("byRepo: ranked agedCount desc, then oldestDays desc, then key asc; blank -> (none)", () => {
    const { byRepo } = oldestOpen([
      brow({ repo_name: "A", age_days: 200 }),   // A: aged 1, oldest 200
      brow({ repo_name: "B", age_days: 300 }),   // B: aged 1, oldest 300
      brow({ repo_name: "", age_days: 95 }),     // (none): aged 1, oldest 95
      brow({ repo_name: "C", age_days: 10 }),    // C: aged 0, oldest 10
    ] as never);
    expect(byRepo.map((g) => g.key)).toEqual(["B", "A", "(none)", "C"]);
  });

  it("asset-view attribution: byRepo carries a representative ownerProject", () => {
    const rows = [
      brow({ repo_name: "host-a", owner_project: "proj-x", age_days: 100 }),
      brow({ repo_name: "host-a", owner_project: "proj-x", age_days: 50 }),
    ];
    const { findings, byRepo } = oldestOpen(rows as never);
    expect(findings[0]!.ownerProject).toBe("proj-x");
    expect(byRepo[0]).toMatchObject({ key: "host-a", ownerProject: "proj-x" });
  });

  it("scope filter narrows the population before ranking", () => {
    const rows = [
      brow({ repo_name: "web-1", age_days: 100, scope: "sca" }),
      brow({ repo_name: "web-2", age_days: 200, scope: "sast" }),
    ];
    const { byRepo } = oldestOpen(rows as never, 7, "sca");
    expect(byRepo.map((g) => g.key)).toEqual(["web-1"]);
  });

  it("empty base yields empty lists", () => {
    expect(oldestOpen([])).toEqual({ findings: [], byRepo: [] });
  });
});

describe("GROUP_COLUMNS — exactly the D9 brief's five dims", () => {
  it("maps each dimension to its flat ledger column", () => {
    expect(GROUP_COLUMNS).toEqual({
      repo: "repo_name",
      language: "language",
      owner_project: "owner_project",
      secret_kind: "secret_kind",
      cwe: "cwe",
    });
  });
});

describe("groupTree", () => {
  it("aggregates one level: total/open/repos/sevCounts, (none) bucket, busiest-first", () => {
    const records = [
      rec({ repo_name: "a", language: "Python" }),
      rec({ repo_name: "b", language: "Python", status: "RESOLVED" }),
      rec({ repo_name: "c", language: "Go", severity: "CRITICAL" }),
      rec({ repo_name: "d" }),
    ];
    const out = groupTree(records, ["language"]);
    expect(out.map((g) => g.key)).toEqual(["Python", "(none)", "Go"]);
    expect(out[0]).toMatchObject({
      key: "Python", dim: "language", total: 2, open: 1, repos: 2, sevCounts: { HIGH: 2 }, children: [],
    });
  });

  it("nests by the ordered key list (owner_project -> repo)", () => {
    const records = [
      rec({ owner_project: "Payments", repo_name: "a" }),
      rec({ owner_project: "Payments", repo_name: "a" }),
      rec({ owner_project: "Payments", repo_name: "b" }),
      rec({ owner_project: "Core", repo_name: "c" }),
    ];
    const out = groupTree(records, ["owner_project", "repo"]);
    expect(out.map((g) => g.key)).toEqual(["Payments", "Core"]);
    const payments = out[0]!;
    expect(payments.total).toBe(3);
    expect(payments.children.map((c) => c.key)).toEqual(["a", "b"]);
    expect(payments.children[0]).toMatchObject({ key: "a", dim: "repo", total: 2, repos: 1 });
  });

  it("flags kev/exploit if any finding in the group carries them; caps per level", () => {
    const records = [
      rec({ cwe: "CWE-79", repo_name: "a", has_kev: true }),
      rec({ cwe: "CWE-79", repo_name: "b" }),
      rec({ cwe: "CWE-89", repo_name: "a", has_exploit: true }),
    ];
    const out = groupTree(records, ["cwe"]);
    expect(out[0]).toMatchObject({ key: "CWE-79", repos: 2, total: 2, kev: true, exploit: false });
    expect(out[1]).toMatchObject({ key: "CWE-89", repos: 1, total: 1, kev: false, exploit: true });

    const many = Array.from({ length: 5 }, (_, i) => rec({ language: "lang-" + i }));
    expect(groupTree(many, ["language"], 3)).toHaveLength(3);
    expect(groupTree([rec()], ["nope"])).toEqual([]);
    expect(groupTree([], ["language"])).toEqual([]);
  });

  it("never flags kev/exploit true from a structurally-null signal (sast/secrets rows)", () => {
    // has_kev/has_exploit are SCA ONLY (ledgerTypes.ts); a sast/secrets row carries them as
    // null, never false — the group flag must still read false, never true, off a null.
    const records = [rec({ scope: "sast", repo_name: "a", has_kev: null, has_exploit: null })];
    const out = groupTree(records, ["repo"]);
    expect(out[0]).toMatchObject({ kev: false, exploit: false });
  });

  it("scope filter narrows the tree to one register", () => {
    const records = [
      rec({ scope: "sca", language: "Python" }),
      rec({ scope: "sast", language: "Java" }),
    ];
    const out = groupTree(records, ["language"], 20, "sca");
    expect(out.map((g) => g.key)).toEqual(["Python"]);
  });
});

// ==================================================== risk-ladder aggregations

const RULE = DEFAULT_RISK_RULE;

function tierRow(over: Record<string, unknown> = {}) {
  return {
    finding_key: "k1",
    severity: "CRITICAL",
    status: "OPEN",
    has_kev: false,
    has_exploit: false,
    epss: 0,
    age_days: 10,
    actionable_age_days: 10,
    scope: "sca",
    ...over,
  } as never;
}

describe("riskTierStats", () => {
  it("counts open rows per tier and publishes the unclassified count", () => {
    const stats = riskTierStats(
      [
        tierRow({ has_kev: true }),
        tierRow({ has_exploit: true }),
        tierRow({ epss: 0.5 }),
        tierRow(),
        tierRow(),
        tierRow({ has_kev: null }),
        tierRow({ status: "RESOLVED", has_kev: true }),
      ],
      RULE,
    );
    // perTier carries every tier program.ts's RISK_TIER_ORDER knows about (three more than the
    // old locally-duplicated RiskTier: cwe/aiVerdict/critical, the SAST tiers), all zero here
    // since every row in this population is scope "sca".
    expect(stats.perTier).toEqual({
      kev: 1, exploit: 1, epss: 1, cwe: 0, aiVerdict: 0, critical: 0, none: 2, unknown: 1,
    });
    expect(stats.open).toBe(6); // the RESOLVED row is excluded
    expect(stats.unclassified).toBe(1);
    const summed = Object.values(stats.perTier).reduce((a, b) => a + b, 0);
    expect(summed).toBe(stats.open);
  });

  it("reports every tier key even when a tier is empty", () => {
    const stats = riskTierStats([tierRow()], RULE);
    // Program.ts's RISK_TIER_ORDER has eight tiers (the five gas/ ones plus the three SAST
    // ones: cwe/aiVerdict/critical), not the five the old locally-duplicated RiskTier knew.
    expect(Object.keys(stats.perTier).sort()).toEqual(
      ["aiVerdict", "critical", "cwe", "epss", "exploit", "kev", "none", "unknown"],
    );
  });

  // FALSIFIED CLAIM, from the pre-D9b duplicate: "a sast row with no matching signal classifies
  // unknown, because no sast risk rule exists". That was true only because insights.ts's local
  // duplicate had no SastRiskRule to classify a sast row with at all — every sast row read
  // has_kev/has_exploit/epss (SCA-only columns, ledgerTypes.ts), found them structurally null,
  // and landed in unknown regardless of its actual weakness class. program.ts's real
  // classifyRisk resolves DEFAULT_SAST_RISK_RULE for a sast row (config.ruleForScope) whenever
  // no rule is passed explicitly, so a sast row with a real Top-25 CWE now classifies HIGH.
  it("a sast row with a Top-25 CWE classifies high under DEFAULT_SAST_RISK_RULE", () => {
    const stats = riskTierStats([
      tierRow({
        scope: "sast", severity: "HIGH", cwe: "CWE-79", ai_verdict: null,
        has_kev: null, has_exploit: null, epss: null,
      }),
    ]);
    expect(stats.perTier.cwe).toBe(1);
    expect(stats.perTier.critical).toBe(0); // severity HIGH, not CRITICAL — only cwe fires
    expect(stats.perTier.unknown).toBe(0);
    expect(stats.unclassified).toBe(0);
  });

  // A secrets row is EXCLUDED before classification, never thrown into it: config.ruleForScope
  // returns null for "secrets" (no exploit intelligence exists for a hardcoded string), and
  // program.classifyRisk/riskTier throw on that — see insights.ts's risk-tier import note. If
  // riskTierStats let one reach riskTier(), this test would throw instead of asserting.
  it("a secrets row is excluded from classification and counted, not thrown", () => {
    const stats = riskTierStats([
      tierRow({ scope: "secrets" }),
      tierRow({ scope: "sca", has_kev: true }),
    ]);
    expect(stats.excludedSecrets).toBe(1);
    expect(stats.open).toBe(1); // the secrets row never joins `open`
    expect(stats.perTier.kev).toBe(1);
    const summed = Object.values(stats.perTier).reduce((a, b) => a + b, 0);
    expect(summed).toBe(stats.open); // excludedSecrets stays outside the tier partition
  });

  it("scope filter narrows the population before classification", () => {
    const rows = [tierRow({ scope: "sca", has_kev: true }), tierRow({ scope: "sast" })];
    const scaOnly = riskTierStats(rows, RULE, "sca");
    expect(scaOnly.open).toBe(1);
    expect(scaOnly.perTier.kev).toBe(1);
  });
});

describe("triageFunnel", () => {
  it("nests each step strictly inside the one above it", () => {
    const rows = [
      tierRow({ finding_key: "a", has_kev: true, actionable_age_days: 40 }),
      tierRow({ finding_key: "b", has_exploit: true, actionable_age_days: 2 }),
      tierRow({ finding_key: "c", has_exploit: true }),
      tierRow({ finding_key: "d", epss: 0.9 }),
      tierRow({ finding_key: "e" }),
      tierRow({ finding_key: "f", has_kev: null }),
      tierRow({ finding_key: "g", status: "RESOLVED", has_kev: true }),
    ];
    const f = triageFunnel(rows, RULE, new Set(["a", "b"]), true);
    expect(f.open).toBe(6);
    expect(f.intel).toBe(5);
    expect(f.unclassified).toBe(1);
    expect(f.exploitable).toBe(3);
    expect(f.exposed).toBe(2);
    expect(f.overdue).toBe(1);
    expect(f.open).toBeGreaterThanOrEqual(f.intel);
    expect(f.intel).toBeGreaterThanOrEqual(f.exploitable);
    expect(f.exploitable).toBeGreaterThanOrEqual(f.exposed);
    expect(f.exposed).toBeGreaterThanOrEqual(f.overdue);
  });

  it("stops at exploitable when exposure was never captured", () => {
    const rows = [tierRow({ finding_key: "a", has_kev: true, actionable_age_days: 40 })];
    const f = triageFunnel(rows, RULE, new Set(), false);
    expect(f.exploitable).toBe(1);
    expect(f.exposed).toBe(0);
    expect(f.overdue).toBe(0);
    expect(f.exposureKnown).toBe(false);
  });

  it("counts overdue on the actionable clock, strictly past the target", () => {
    const at = triageFunnel(
      [tierRow({ finding_key: "a", has_kev: true, actionable_age_days: 7 })], RULE, new Set(["a"]), true);
    const past = triageFunnel(
      [tierRow({ finding_key: "a", has_kev: true, actionable_age_days: 7.5 })], RULE, new Set(["a"]), true);
    expect(at.overdue).toBe(0);
    expect(past.overdue).toBe(1);
    const awaiting = triageFunnel(
      [tierRow({ finding_key: "a", has_kev: true, actionable_age_days: null })], RULE, new Set(["a"]), true);
    expect(awaiting.exposed).toBe(1);
    expect(awaiting.overdue).toBe(0);
  });

  it("scope filter narrows the funnel's population", () => {
    const rows = [
      tierRow({ finding_key: "a", scope: "sca", has_kev: true }),
      tierRow({ finding_key: "b", scope: "sast", has_kev: true }),
    ];
    const scaOnly = triageFunnel(rows, RULE, new Set(["a", "b"]), true, "sca");
    expect(scaOnly.open).toBe(1);
    expect(scaOnly.exploitable).toBe(1);
  });

  // No `rule` argument: each row resolves its OWN scope's default (config.ruleForScope) —
  // the sca row under DEFAULT_RISK_RULE, the sast row under DEFAULT_SAST_RISK_RULE — so one
  // call over a mixed sca+sast population classifies both kinds of row correctly instead of
  // forcing one rule shape onto rows it was never written for.
  it("a mixed sca+sast ledger stays classifiable with no rule argument", () => {
    const rows = [
      tierRow({ finding_key: "a", scope: "sca", has_kev: true }),
      tierRow({
        finding_key: "b", scope: "sast", severity: "HIGH", cwe: "CWE-79", ai_verdict: null,
        has_kev: null, has_exploit: null, epss: null,
      }),
    ];
    const f = triageFunnel(rows, undefined, new Set(["a", "b"]), true);
    expect(f.open).toBe(2);
    expect(f.unclassified).toBe(0);
    expect(f.intel).toBe(2);
    // Only the sca row's tier (kev/exploit) counts toward "exploitable" — the sast row's cwe
    // tier is real evidence (intel), just not the KEV/public-exploit kind this funnel narrows to.
    expect(f.exploitable).toBe(1);
  });

  // A secrets row is excluded before classification, never thrown into it — see riskTierStats's
  // identical test above and insights.ts's risk-tier import note for why.
  it("a secrets row is excluded from the funnel and counted, not thrown", () => {
    const rows = [
      tierRow({ finding_key: "a", scope: "secrets" }),
      tierRow({ finding_key: "b", scope: "sca", has_kev: true, actionable_age_days: 40 }),
    ];
    const f = triageFunnel(rows, RULE, new Set(["b"]), true);
    expect(f.excludedSecrets).toBe(1);
    expect(f.open).toBe(1);
    expect(f.exploitable).toBe(1);
  });
});

describe("ageBucketsBy", () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({ status: "OPEN", age_days: 3, severity: "CRITICAL", scope: "sca", ...over }) as never;

  it("buckets on an arbitrary key", () => {
    const { perKey, totalOpen } = ageBucketsBy(
      [
        row({ age_days: 3, severity: "CRITICAL" }),
        row({ age_days: 20, severity: "CRITICAL" }),
        row({ age_days: 200, severity: "HIGH" }),
      ],
      (r: { severity: string }) => r.severity,
    );
    expect(perKey.CRITICAL).toEqual([1, 1, 0, 0]);
    expect(perKey.HIGH).toEqual([0, 0, 0, 1]);
    expect(totalOpen).toBe(3);
  });

  it("agrees with ageBuckets when keyed by severity", () => {
    const rows = [row({ age_days: 1 }), row({ age_days: 45 }), row({ age_days: 400 })];
    expect(ageBucketsBy(rows, (r: { severity: string }) => r.severity).perKey)
      .toEqual(ageBuckets(rows as never).perSev);
  });

  it("skips rows with no finite age, so totalOpen can trail the open count", () => {
    const { totalOpen } = ageBucketsBy(
      [row(), row({ age_days: null }), row({ age_days: Number.NaN }), row({ status: "RESOLVED" })],
      () => "k",
    );
    expect(totalOpen).toBe(1);
  });
});

describe("concentration", () => {
  const r = (over: Rec = {}) => rec({ status: "OPEN", repo_name: "host-a", ...over });

  it("ranks by OPEN findings, not by total", () => {
    const c = concentration(
      [
        r({ repo_name: "busy-but-closed", status: "RESOLVED" }),
        r({ repo_name: "busy-but-closed", status: "RESOLVED" }),
        r({ repo_name: "busy-but-closed", status: "RESOLVED" }),
        r({ repo_name: "still-open" }),
        r({ repo_name: "still-open" }),
      ],
      ["repo"],
    );
    expect(c.perDim.repo!.map((x) => x.key)).toEqual(["still-open"]);
    expect(c.perDim.repo![0]!.open).toBe(2);
  });

  it("counts distinct repos and KEV findings per group", () => {
    const c = concentration(
      [
        r({ cwe: "CWE-79", repo_name: "h1", has_kev: true }),
        r({ cwe: "CWE-79", repo_name: "h2" }),
        r({ cwe: "CWE-79", repo_name: "h2" }),
      ],
      ["cwe"],
    );
    expect(c.perDim.cwe![0]).toEqual({ key: "CWE-79", open: 3, repos: 2, kev: 1 });
  });

  it("reports how many groups were dropped rather than truncating silently", () => {
    const records = ["a", "b", "c", "d", "e", "f", "g"].map((k) => r({ repo_name: k }));
    const c = concentration(records, ["repo"], 5);
    expect(c.perDim.repo).toHaveLength(5);
    expect(c.moreDim.repo).toBe(2);
  });

  it("folds blank group values into (none) and ignores unknown dimensions", () => {
    const c = concentration([r({ repo_name: "" }), r({ repo_name: "  " })], ["repo", "nope"]);
    expect(c.perDim.repo![0]!.key).toBe("(none)");
    expect(c.perDim.nope).toBeUndefined();
  });

  it("scope filter narrows the ranked population", () => {
    const records = [r({ scope: "sca", repo_name: "a" }), r({ scope: "sast", repo_name: "b" })];
    const c = concentration(records, ["repo"], 5, "sca");
    expect(c.perDim.repo!.map((x) => x.key)).toEqual(["a"]);
  });
});

describe("openAgeMedian", () => {
  const row = (age: number | null, status = "OPEN", scope: Scope = "sca") =>
    ({ status, age_days: age, scope }) as never;

  it("interpolates the midpoint and ignores resolved / ageless rows", () => {
    expect(openAgeMedian([row(1), row(3), row(9)])).toBe(3);
    expect(openAgeMedian([row(2), row(4)])).toBe(3);
    expect(openAgeMedian([row(2), row(4), row(1000, "RESOLVED"), row(null)])).toBe(3);
    expect(openAgeMedian([])).toBeNull();
    expect(openAgeMedian([row(null)])).toBeNull();
  });

  it("resists the right skew a mean would follow", () => {
    const rows = [...Array(9)].map(() => row(2)).concat([row(400)]);
    expect(openAgeMedian(rows)).toBe(2);
  });

  it("scope filter narrows the population before the median is taken", () => {
    const rows = [row(2, "OPEN", "sca"), row(400, "OPEN", "sast")];
    expect(openAgeMedian(rows, "sca")).toBe(2);
  });
});


// THE BARS ANSWER "HOW LATE", AND THE THREE POPULATIONS THAT LEAVE THEM ARE THE TEST.
//
// `slaConsumedDeciles` divides an open finding's age by the target for its OWN severity, so a
// 20-day CRITICAL (nearly three windows gone) and a 20-day LOW (under a quarter) stop sharing
// a bar. Every quiet failure here is a row landing in a bucket it did not earn:
//
//   - `Number(null)` is 0 and it is finite, so an age of null cast first reads as a
//     brand-new finding in bucket 0 — the most reassuring bar on the chart.
//   - a severity with no target (UNKNOWN) cast first reads as a window of 0 days, and
//     age/0 is Infinity, which clamps into bucket 9.
//   - a finding exactly AT its window drawn in bucket 9 makes that bar mean two things at
//     once: "in its final tenth" and "past the deadline by any amount".
//
// A FAILURE OF PRESENCE HERE IS A ROW IN A BUCKET IT DID NOT EARN, and it is the dangerous
// kind: every one of those misreadings moves a row LEFT (into bucket 0, or out of
// `pastWindow`), so the register looks younger and more compliant than it is. The register's
// three scopes share this function through one `buildMttr` call, so a defect here is not
// scoped to one of them.
describe("slaConsumedDeciles", () => {
  const TARGETS = { CRITICAL: 7, HIGH: 14, MEDIUM: 30, LOW: 90, INFO: 180 };
  const row = (age_days: unknown, severity = "CRITICAL", status = "OPEN") =>
    ({ severity, status, age_days } as unknown as Parameters<typeof slaConsumedDeciles>[0][0]);

  it("puts a 3-day CRITICAL at four tenths of a seven-day window", () => {
    // 10 * 3 / 7 = 4.28…, floored to 4: four tenths used, six left.
    const out = slaConsumedDeciles([row(3)], TARGETS);
    expect(out.perSev.CRITICAL).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(out.labels).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect(out.totalOpen).toBe(1);
    expect(out.noWindow).toBe(0);
    expect(out.pastWindow).toEqual({});
  });

  it("clamps a finding at 99% of its window into bucket 9", () => {
    const out = slaConsumedDeciles([row(6.93)], TARGETS);
    expect(out.perSev.CRITICAL[9]).toBe(1);
    expect(out.perSev.CRITICAL.reduce((a, b) => a + b, 0)).toBe(1);
    expect(out.pastWindow.CRITICAL).toBeUndefined();
  });

  it("counts a finding at exactly its window as pastWindow, not as bucket 9", () => {
    // The boundary is `>=`, so the last bar never absorbs a breach. 7.0 days on a 7-day
    // window is a deadline reached, not a ninth tenth in progress.
    const out = slaConsumedDeciles([row(7), row(7.0001), row(40)], TARGETS);
    expect(out.pastWindow).toEqual({ CRITICAL: 3 });
    expect(out.perSev.CRITICAL).toBeUndefined();
    expect(out.totalOpen).toBe(0);
    expect(out.noWindow).toBe(0);
  });

  it("age_days null lands in noWindow, never in bucket 0", () => {
    // Every one of these is 0 under Number() and every one of them is finite. A cast before
    // the refusal reads all five as findings opened today.
    for (const age of [null, undefined, "", [], false]) {
      const out = slaConsumedDeciles([row(age)], TARGETS);
      expect(out.noWindow, `age ${JSON.stringify(age)}`).toBe(1);
      expect(out.perSev, `age ${JSON.stringify(age)}`).toEqual({});
      expect(out.totalOpen, `age ${JSON.stringify(age)}`).toBe(0);
      expect(out.pastWindow, `age ${JSON.stringify(age)}`).toEqual({});
    }
  });

  it("a severity with no SLA target lands in noWindow", () => {
    // UNKNOWN is a local normalization bucket with no entry in SLA_TARGETS, so there is no
    // deadline to measure the row against — and 0 is not one either: 3/0 is Infinity, which
    // the clamp would file in bucket 9 as a finding on the brink.
    const out = slaConsumedDeciles([row(3, "UNKNOWN"), row(3, "NOT_A_SEVERITY")], TARGETS);
    expect(out.noWindow).toBe(2);
    expect(out.perSev).toEqual({});
    expect(slaConsumedDeciles([row(3)], { CRITICAL: 0 }).noWindow).toBe(1);
    expect(slaConsumedDeciles([row(3)], { CRITICAL: -7 }).noWindow).toBe(1);
    expect(slaConsumedDeciles([row(3)], { CRITICAL: NaN }).noWindow).toBe(1);
  });

  it("totalOpen counts only drawn rows", () => {
    const out = slaConsumedDeciles([
      row(1), row(3), row(6.5),          // drawn, CRITICAL
      row(7), row(90),                    // past the window
      row(null), row(3, "UNKNOWN"),       // no window
      row(7, "HIGH"), row(45, "LOW"),     // drawn, other severities
    ], TARGETS);
    const drawn = Object.values(out.perSev)
      .reduce((a, arr) => a + arr.reduce((x, y) => x + y, 0), 0);
    expect(drawn).toBe(out.totalOpen);
    expect(out.totalOpen).toBe(5);
    expect(out.pastWindow).toEqual({ CRITICAL: 2 });
    expect(out.noWindow).toBe(2);
    // The three excluded populations plus the drawn rows account for every open row, and
    // nothing is counted twice.
    const past = Object.values(out.pastWindow).reduce((a, b) => a + b, 0);
    expect(out.totalOpen + past + out.noWindow).toBe(9);
  });

  it("resolved rows are not counted anywhere", () => {
    // Not in the bars, not past the window, not unmeasured — a closed finding has no window
    // left to consume, so it is absent rather than in an "other" bucket.
    const out = slaConsumedDeciles([
      row(3, "CRITICAL", "RESOLVED"),
      row(40, "CRITICAL", "RESOLVED"),
      row(null, "CRITICAL", "RESOLVED"),
    ], TARGETS);
    expect(out).toEqual({
      labels: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
      perSev: {}, pastWindow: {}, noWindow: 0, totalOpen: 0,
    });
  });
});
