import { describe, expect, it } from "vitest";
import {
  AGE_BUCKET_LABELS,
  EPSS_PRIORITY_THRESHOLD,
  ageBuckets,
  exploitSummary,
  groupTree,
  movement,
  oldestOpen,
  severityStats,
} from "../src/domain/insights";
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
  // Base-row shape the aggregation reads: age_days + status + cve/severity/asset_name and
  // the server-attached _domain / _supportGroup.
  const brow = (over: Record<string, unknown> = {}) => ({
    cve: "CVE-2024-0001", severity: "HIGH", status: "OPEN", asset_name: "web-1",
    age_days: 10, _domain: "Payments", _supportGroup: "SG-A", ...over,
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
    expect(findings[0]).toEqual({ cve: "old", asset: "web-1", severity: "HIGH", ageDays: 400 });
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
    expect(byAsset[0]).toEqual({ key: "host-b", agedCount: 1, openCount: 1, oldestDays: 200 });
    expect(byAsset[1]).toMatchObject({ key: "host-a", openCount: 2 });
  });

  it("empty base yields empty lists", () => {
    expect(oldestOpen([])).toEqual({ findings: [], byAsset: [], bySupportGroup: [], byDomain: [] });
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

