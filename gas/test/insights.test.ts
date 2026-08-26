import { describe, expect, it } from "vitest";
import {
  AGE_BUCKET_LABELS,
  EPSS_PRIORITY_THRESHOLD,
  GROUP_BASE_FIELDS,
  GROUP_COLUMNS,
  ageBuckets,
  ageBucketsBy,
  concentration,
  exploitSummary,
  groupTree,
  movement,
  oldestOpen,
  openAgeMedian,
  riskTierStats,
  severityStats,
  triageFunnel,
} from "../src/domain/insights";
import { DEFAULT_RISK_RULE } from "../src/domain/program";
import type { Rec } from "../src/domain/util";

const WIDE = "vulnerableAsset.hasWideInternetExposure";
const LIMITED = "vulnerableAsset.hasLimitedInternetExposure";
const ASSET = "vulnerableAsset.name";

function rec(over: Rec = {}): Rec {
  return { name: "CVE-2024-0001", severity: "HIGH", _sev: "HIGH", status: "OPEN", ...over };
}

describe("severityStats", () => {
  it("splits each severity into total / open / resolved", () => {
    const records = [
      rec({ _sev: "CRITICAL", status: "OPEN" }),
      rec({ _sev: "CRITICAL", status: "RESOLVED" }),
      rec({ _sev: "CRITICAL", status: "OPEN" }),
      rec({ _sev: "HIGH", status: "RESOLVED" }),
    ];
    const stats = severityStats(records);
    expect(stats.CRITICAL).toEqual({ total: 3, open: 2, resolved: 1 });
    expect(stats.HIGH).toEqual({ total: 1, open: 0, resolved: 1 });
    // open + resolved === total for every bucket
    for (const s of Object.values(stats)) expect(s.open + s.resolved).toBe(s.total);
  });
});

describe("exploitSummary", () => {
  it("counts open findings only", () => {
    const records = [
      rec({ hasCisaKevExploit: true, hasExploit: true, epssProbability: 0.5, [WIDE]: true }),
      rec({ status: "RESOLVED", hasCisaKevExploit: true, hasExploit: true }),
      rec({ [LIMITED]: true }),
    ];
    const s = exploitSummary(records);
    expect(s).toEqual({ open: 2, kev: 1, exploit: 1, highEpss: 1, internetExposed: 2, exposureKnown: true });
  });

  it("distinguishes exposure-unknown from a genuine zero", () => {
    expect(exploitSummary([rec()]).exposureKnown).toBe(false);
    expect(exploitSummary([rec({ [WIDE]: false })]).exposureKnown).toBe(true);
    expect(exploitSummary([rec({ [WIDE]: false })]).internetExposed).toBe(0);
  });

  it("EPSS boundary is >= threshold", () => {
    const below = exploitSummary([rec({ epssProbability: EPSS_PRIORITY_THRESHOLD - 0.01 })]);
    const at = exploitSummary([rec({ epssProbability: EPSS_PRIORITY_THRESHOLD })]);
    expect(below.highEpss).toBe(0);
    expect(at.highEpss).toBe(1);
  });
});

describe("ageBuckets", () => {
  const row = (age_days: number | null, severity = "HIGH", status = "OPEN") => ({ severity, status, age_days });

  it("buckets at the documented edges", () => {
    const { perSev } = ageBuckets([
      row(0), row(7.0),        // bucket 0
      row(7.01), row(30.0),    // bucket 1
      row(30.5), row(90.0),    // bucket 2
      row(90.1), row(400),     // bucket 3
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
});

describe("movement", () => {
  const base = (status: string, first: string, last: string) => ({
    status, first_scan_id: first, last_scan_id: last,
  });
  const scan = { scan_id: "s3", new_count: 4, resolved_count: 2, reopened_count: 1 };

  it("passes scan-row deltas through and counts persisting", () => {
    const rows = [
      base("OPEN", "s1", "s3"),      // persisting
      base("OPEN", "s3", "s3"),      // new this scan — not persisting
      base("OPEN", "s1", "s2"),      // not seen in latest — not persisting
      base("RESOLVED", "s1", "s3"),  // resolved — not persisting
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
});

describe("oldestOpen", () => {
  // Base-row shape the aggregation reads: age_days + status + cve/severity/asset_name/
  // subscription_name and the server-attached _domain / _supportGroup.
  const brow = (over: Record<string, unknown> = {}) => ({
    cve: "CVE-2024-0001", severity: "HIGH", status: "OPEN", asset_name: "web-1",
    subscription_name: "sub-1", age_days: 10, _domain: "Payments", _supportGroup: "SG-A", ...over,
  });

  it("findings: sorted by age desc, capped at topN, resolved & null-age excluded", () => {
    const { findings } = oldestOpen([
      brow({ cve: "old", age_days: 400 }),
      brow({ cve: "mid", age_days: 100 }),
      brow({ cve: "young", age_days: 5 }),
      brow({ cve: "resolved", age_days: 999, status: "RESOLVED" }),
      brow({ cve: "noage", age_days: null }),
    ], 2);
    expect(findings.map((f) => f.cve)).toEqual(["old", "mid"]);
    expect(findings[0]).toEqual({
      cve: "old", asset: "web-1", subscription: "sub-1", severity: "HIGH", ageDays: 400,
    });
  });

  it("groups: agedCount is the >90d tail, oldestDays the max, open counts all open", () => {
    const { byDomain } = oldestOpen([
      brow({ _domain: "Payments", age_days: 120 }),  // aged
      brow({ _domain: "Payments", age_days: 91 }),   // aged (strictly > 90)
      brow({ _domain: "Payments", age_days: 90 }),   // not aged (boundary)
      brow({ _domain: "Payments", age_days: 5 }),
      brow({ _domain: "Payments", age_days: 999, status: "RESOLVED" }), // excluded
    ]);
    expect(byDomain).toHaveLength(1);
    expect(byDomain[0]).toEqual({ key: "Payments", agedCount: 2, openCount: 4, oldestDays: 120 });
  });

  it("groups: ranked agedCount desc, then oldestDays desc, then key asc; blank -> (none)", () => {
    const { bySupportGroup } = oldestOpen([
      brow({ _supportGroup: "A", age_days: 200 }),   // A: aged 1, oldest 200
      brow({ _supportGroup: "B", age_days: 300 }),   // B: aged 1, oldest 300
      brow({ _supportGroup: "", age_days: 95 }),     // (none): aged 1, oldest 95
      brow({ _supportGroup: "C", age_days: 10 }),    // C: aged 0, oldest 10
    ]);
    // aged-count ties (all 1) broken by oldestDays desc: B(300) > A(200) > (none)(95); C last (aged 0).
    expect(bySupportGroup.map((g) => g.key)).toEqual(["B", "A", "(none)", "C"]);
  });

  it("keys each grouped view off its own dimension; asset uses asset_name", () => {
    const { byAsset } = oldestOpen([
      brow({ asset_name: "host-a", age_days: 100 }),
      brow({ asset_name: "host-a", age_days: 50 }),
      brow({ asset_name: "host-b", age_days: 200 }),
    ]);
    expect(byAsset.map((g) => g.key)).toEqual(["host-b", "host-a"]);
    expect(byAsset[0]).toEqual({
      key: "host-b", agedCount: 1, openCount: 1, oldestDays: 200, subscription: "sub-1", domain: "Payments",
    });
    expect(byAsset[1]).toMatchObject({ key: "host-a", openCount: 2 });
  });

  it("asset view carries representative subscription + domain; other group views omit them", () => {
    const rows = [
      brow({ asset_name: "host-a", subscription_name: "sub-x", _domain: "Core", _supportGroup: "SG-1", age_days: 100 }),
      brow({ asset_name: "host-a", subscription_name: "sub-x", _domain: "Core", _supportGroup: "SG-1", age_days: 50 }),
    ];
    const { findings, byAsset, bySupportGroup, byDomain } = oldestOpen(rows);
    expect(findings[0].subscription).toBe("sub-x");
    expect(byAsset[0]).toMatchObject({ key: "host-a", subscription: "sub-x", domain: "Core" });
    // Subscription / domain are asset-view attribution only.
    expect(bySupportGroup[0].subscription).toBeUndefined();
    expect(bySupportGroup[0].domain).toBeUndefined();
    expect(byDomain[0].subscription).toBeUndefined();
    expect(byDomain[0].domain).toBeUndefined();
  });

  it("empty base yields empty lists", () => {
    expect(oldestOpen([])).toEqual({ findings: [], byAsset: [], bySupportGroup: [], byDomain: [] });
  });
});

describe("GROUP_BASE_FIELDS", () => {
  it("omits os (no OS column in the ledger — no historical OS trend)", () => {
    expect("os" in GROUP_BASE_FIELDS).toBe(false);
    expect(GROUP_BASE_FIELDS["os"]).toBeUndefined();
  });

  it("covers exactly the groupable dimensions minus os", () => {
    expect(new Set(Object.keys(GROUP_BASE_FIELDS))).toEqual(
      new Set(Object.keys(GROUP_COLUMNS).filter((k) => k !== "os")),
    );
  });
});

describe("groupTree", () => {
  it("aggregates one level: total/open/assets/sevCounts, (none) bucket, busiest-first", () => {
    const records = [
      rec({ [ASSET]: "a", "vulnerableAsset.type": "VM" }),
      rec({ [ASSET]: "b", "vulnerableAsset.type": "VM", status: "RESOLVED" }),
      rec({ [ASSET]: "c", "vulnerableAsset.type": "Container", _sev: "CRITICAL" }),
      rec({ [ASSET]: "d" }),
    ];
    const out = groupTree(records, ["atype"]);
    expect(out.map((g) => g.key)).toEqual(["VM", "(none)", "Container"]);
    expect(out[0]).toMatchObject({
      key: "VM", dim: "atype", total: 2, open: 1, assets: 2, sevCounts: { HIGH: 2 }, children: [],
    });
  });

  it("nests by the ordered key list (domain -> asset)", () => {
    const records = [
      rec({ _domain: "Payments", [ASSET]: "a" }),
      rec({ _domain: "Payments", [ASSET]: "a" }),
      rec({ _domain: "Payments", [ASSET]: "b" }),
      rec({ _domain: "Core", [ASSET]: "c" }),
    ];
    const out = groupTree(records, ["domain", "asset"]);
    expect(out.map((g) => g.key)).toEqual(["Payments", "Core"]);
    const payments = out[0];
    expect(payments.total).toBe(3);
    expect(payments.children.map((c) => c.key)).toEqual(["a", "b"]);
    expect(payments.children[0]).toMatchObject({ key: "a", dim: "asset", total: 2, assets: 1 });
  });

  it("flags kev/exploit if any finding in the group carries them; caps per level", () => {
    const records = [
      rec({ name: "CVE-X", [ASSET]: "a", hasCisaKevExploit: true }),
      rec({ name: "CVE-X", [ASSET]: "b" }),
      rec({ name: "CVE-Y", [ASSET]: "a", hasExploit: true }),
    ];
    const out = groupTree(records, ["cve"]);
    expect(out[0]).toMatchObject({ key: "CVE-X", assets: 2, total: 2, kev: true, exploit: false });
    expect(out[1]).toMatchObject({ key: "CVE-Y", assets: 1, total: 1, kev: false, exploit: true });

    const many = Array.from({ length: 5 }, (_, i) => rec({ "vulnerableAsset.type": "t-" + i }));
    expect(groupTree(many, ["atype"], 3)).toHaveLength(3);
    expect(groupTree([rec()], ["nope"])).toEqual([]);
    expect(groupTree([], ["atype"])).toEqual([]);
  });
});


// ==================================================== risk-ladder aggregations (Option A)

const RULE = DEFAULT_RISK_RULE;

function tierRow(over: Record<string, unknown> = {}) {
  return {
    vuln_key: "k1",
    severity: "CRITICAL",
    status: "OPEN",
    has_kev: false,
    has_exploit: false,
    epss: 0,
    age_days: 10,
    actionable_age_days: 10,
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
    expect(stats.perTier).toEqual({ kev: 1, exploit: 1, epss: 1, none: 2, unknown: 1 });
    expect(stats.open).toBe(6); // the RESOLVED row is excluded
    expect(stats.unclassified).toBe(1);
    // every open row lands in exactly one tier
    const summed = Object.values(stats.perTier).reduce((a, b) => a + b, 0);
    expect(summed).toBe(stats.open);
  });

  it("reports every tier key even when a tier is empty", () => {
    const stats = riskTierStats([tierRow()], RULE);
    expect(Object.keys(stats.perTier).sort()).toEqual(
      ["epss", "exploit", "kev", "none", "unknown"],
    );
  });
});

describe("triageFunnel", () => {
  it("nests each step strictly inside the one above it", () => {
    const rows = [
      tierRow({ vuln_key: "a", has_kev: true, actionable_age_days: 40 }), // exposed + overdue
      tierRow({ vuln_key: "b", has_exploit: true, actionable_age_days: 2 }), // exposed, in SLA
      tierRow({ vuln_key: "c", has_exploit: true }), // exploitable, not exposed
      tierRow({ vuln_key: "d", epss: 0.9 }), // intel, not exploitable
      tierRow({ vuln_key: "e" }), // intel only
      tierRow({ vuln_key: "f", has_kev: null }), // unclassified
      tierRow({ vuln_key: "g", status: "RESOLVED", has_kev: true }), // excluded
    ];
    const f = triageFunnel(rows, RULE, new Set(["a", "b"]), true);
    expect(f.open).toBe(6);
    expect(f.intel).toBe(5);
    expect(f.unclassified).toBe(1);
    expect(f.exploitable).toBe(3);
    expect(f.exposed).toBe(2); // "c" is exploitable but not in the exposed set
    expect(f.overdue).toBe(1); // only "a" is past the 7-day CRITICAL SLA
    // monotonically narrowing, which is what makes the shape readable
    expect(f.open).toBeGreaterThanOrEqual(f.intel);
    expect(f.intel).toBeGreaterThanOrEqual(f.exploitable);
    expect(f.exploitable).toBeGreaterThanOrEqual(f.exposed);
    expect(f.exposed).toBeGreaterThanOrEqual(f.overdue);
  });

  it("stops at exploitable when exposure was never captured", () => {
    // A frame predating the exposure keys must not render as "nothing is exposed".
    const rows = [tierRow({ vuln_key: "a", has_kev: true, actionable_age_days: 40 })];
    const f = triageFunnel(rows, RULE, new Set(), false);
    expect(f.exploitable).toBe(1);
    expect(f.exposed).toBe(0);
    expect(f.overdue).toBe(0);
    expect(f.exposureKnown).toBe(false);
  });

  it("counts overdue on the actionable clock, strictly past the target", () => {
    const at = triageFunnel(
      [tierRow({ vuln_key: "a", has_kev: true, actionable_age_days: 7 })], RULE, new Set(["a"]), true);
    const past = triageFunnel(
      [tierRow({ vuln_key: "a", has_kev: true, actionable_age_days: 7.5 })], RULE, new Set(["a"]), true);
    expect(at.overdue).toBe(0); // on the due date is still in SLA
    expect(past.overdue).toBe(1);
    // a finding with no actionable clock yet (awaiting a vendor fix) is never a breach
    const awaiting = triageFunnel(
      [tierRow({ vuln_key: "a", has_kev: true, actionable_age_days: null })], RULE, new Set(["a"]), true);
    expect(awaiting.exposed).toBe(1);
    expect(awaiting.overdue).toBe(0);
  });
});

describe("ageBucketsBy", () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({ status: "OPEN", age_days: 3, severity: "CRITICAL", ...over }) as never;

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
      .toEqual(ageBuckets(rows).perSev);
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
  const r = (over: Rec = {}) => rec({ status: "OPEN", [ASSET]: "host-a", ...over });

  it("ranks by OPEN findings, not by total", () => {
    // `groupTree` ranks by open+resolved; a list captioned "by open findings" must not
    // inherit that ordering, or a group that closed everything outranks one that closed none.
    const c = concentration(
      [
        r({ [ASSET]: "busy-but-closed", status: "RESOLVED" }),
        r({ [ASSET]: "busy-but-closed", status: "RESOLVED" }),
        r({ [ASSET]: "busy-but-closed", status: "RESOLVED" }),
        r({ [ASSET]: "still-open" }),
        r({ [ASSET]: "still-open" }),
      ],
      ["asset"],
    );
    expect(c.perDim.asset.map((x) => x.key)).toEqual(["still-open"]);
    expect(c.perDim.asset[0].open).toBe(2);
  });

  it("counts distinct assets and KEV findings per group", () => {
    const c = concentration(
      [
        r({ name: "CVE-1", [ASSET]: "h1", hasCisaKevExploit: true }),
        r({ name: "CVE-1", [ASSET]: "h2" }),
        r({ name: "CVE-1", [ASSET]: "h2" }),
      ],
      ["cve"],
    );
    expect(c.perDim.cve[0]).toEqual({ key: "CVE-1", open: 3, assets: 2, kev: 1 });
  });

  it("reports how many groups were dropped rather than truncating silently", () => {
    const records = ["a", "b", "c", "d", "e", "f", "g"].map((k) => r({ [ASSET]: k }));
    const c = concentration(records, ["asset"], 5);
    expect(c.perDim.asset).toHaveLength(5);
    expect(c.moreDim.asset).toBe(2);
  });

  it("folds blank group values into (none) and ignores unknown dimensions", () => {
    const c = concentration([r({ [ASSET]: "" }), r({ [ASSET]: "  " })], ["asset", "nope"]);
    expect(c.perDim.asset[0].key).toBe("(none)");
    expect(c.perDim.nope).toBeUndefined();
  });
});

describe("openAgeMedian", () => {
  const row = (age: number | null, status = "OPEN") =>
    ({ status, age_days: age }) as never;

  it("interpolates the midpoint and ignores resolved / ageless rows", () => {
    expect(openAgeMedian([row(1), row(3), row(9)])).toBe(3);
    expect(openAgeMedian([row(2), row(4)])).toBe(3);
    expect(openAgeMedian([row(2), row(4), row(1000, "RESOLVED"), row(null)])).toBe(3);
    expect(openAgeMedian([])).toBeNull();
    expect(openAgeMedian([row(null)])).toBeNull();
  });

  it("resists the right skew a mean would follow", () => {
    // Nine fresh findings and one year-old straggler: the median stays where the backlog
    // actually is, which is the whole reason this is not a mean.
    const rows = [...Array(9)].map(() => row(2)).concat([row(400)]);
    expect(openAgeMedian(rows)).toBe(2);
  });
});
