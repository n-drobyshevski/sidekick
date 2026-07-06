import { describe, expect, it } from "vitest";
import {
  AGE_BUCKET_LABELS,
  EPSS_PRIORITY_THRESHOLD,
  ageBuckets,
  breakdown,
  exploitSummary,
  movement,
  topAssets,
  topCves,
} from "../src/domain/insights";
import type { Rec } from "../src/domain/util";

const WIDE = "vulnerableAsset.hasWideInternetExposure";
const LIMITED = "vulnerableAsset.hasLimitedInternetExposure";
const ASSET = "vulnerableAsset.name";

function rec(over: Rec = {}): Rec {
  return { name: "CVE-2024-0001", severity: "HIGH", _sev: "HIGH", status: "OPEN", ...over };
}

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

describe("topAssets", () => {
  it("one CRITICAL outweighs three LOW", () => {
    const records = [
      rec({ _sev: "CRITICAL", [ASSET]: "big" }),
      rec({ _sev: "LOW", [ASSET]: "many" }),
      rec({ _sev: "LOW", [ASSET]: "many" }),
      rec({ _sev: "LOW", [ASSET]: "many" }),
    ];
    const out = topAssets(records, 10);
    expect(out[0]).toMatchObject({ asset: "big", total: 1, weighted: 4, sevCounts: { CRITICAL: 1 } });
    expect(out[1]).toMatchObject({ asset: "many", total: 3, weighted: 3, sevCounts: { LOW: 3 } });
  });

  it("skips resolved rows and caps at n", () => {
    const records = [
      rec({ [ASSET]: "a", status: "RESOLVED" }),
      rec({ [ASSET]: "b" }),
      rec({ [ASSET]: "c" }),
    ];
    const out = topAssets(records, 1);
    expect(out).toHaveLength(1);
    expect(out[0].asset).toBe("b"); // equal weight, name asc
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

describe("topCves", () => {
  it("counts distinct assets, not findings", () => {
    const records = [
      rec({ name: "CVE-X", [ASSET]: "a" }),
      rec({ name: "CVE-X", [ASSET]: "a" }),
      rec({ name: "CVE-X", [ASSET]: "b", _sev: "CRITICAL", hasCisaKevExploit: true }),
      rec({ name: "CVE-Y", [ASSET]: "a", hasExploit: true }),
      rec({ name: "CVE-Y", [ASSET]: "b", status: "RESOLVED" }),
    ];
    const out = topCves(records, 10);
    expect(out[0]).toEqual({ cve: "CVE-X", severity: "CRITICAL", assets: 2, findings: 3, kev: true, exploit: false });
    expect(out[1]).toEqual({ cve: "CVE-Y", severity: "HIGH", assets: 1, findings: 1, kev: false, exploit: true });
  });
});

describe("breakdown", () => {
  it("computes totals, opens, shares, and the (none) bucket", () => {
    const records = [
      rec({ [ASSET]: "a", "vulnerableAsset.type": "VM" }),
      rec({ [ASSET]: "b", "vulnerableAsset.type": "VM", status: "RESOLVED" }),
      rec({ [ASSET]: "c", "vulnerableAsset.type": "Container", _sev: "CRITICAL" }),
      rec({ [ASSET]: "d" }),
    ];
    const out = breakdown(records, "atype");
    expect(out.map((g) => g.key)).toEqual(["VM", "(none)", "Container"]);
    const vm = out[0];
    expect(vm).toMatchObject({ total: 2, open: 1, share: 0.5, sevCounts: { HIGH: 2 } });
    expect(out.reduce((acc, g) => acc + g.share, 0)).toBeCloseTo(1);
  });

  it("caps groups and maps the os key", () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      rec({ "vulnerableAsset.operatingSystem": "os-" + i }),
    );
    expect(breakdown(records, "os", 3)).toHaveLength(3);
    expect(breakdown(records, "os", 10)[0].key).toBe("os-0");
  });

  it("returns [] for an unknown key or empty input", () => {
    expect(breakdown([rec()], "nope")).toEqual([]);
    expect(breakdown([], "atype")).toEqual([]);
  });
});
