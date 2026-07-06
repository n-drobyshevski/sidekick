// The precomputed findings frame must stay byte-identical to the slim fallback path
// in findings.currentScan(): same flattenNode + vulnKey output, plus the _page tag.
// If either side drifts, the fast path and the fallback would disagree per scan.

import { describe, expect, it } from "vitest";
import { vulnKey } from "../src/domain/lifecycle";
import { flattenNode } from "../src/domain/transform";
import type { Rec } from "../src/domain/util";
import { buildFrame, pageOfFromRuns } from "../src/server/frameCore";

const SLIM: Rec[] = [
  {
    id: "f-1",
    name: "CVE-2024-0001",
    severity: "CRITICAL",
    status: "OPEN",
    firstDetectedAt: "2026-01-01T00:00:00Z",
    vulnerableAsset: { id: "a-1", name: "vm-alpha", type: "VIRTUAL_MACHINE", cloudPlatform: "AWS" },
  },
  {
    id: "f-2",
    name: "CVE-2024-0002",
    severity: "HIGH",
    status: "RESOLVED",
    resolvedAt: "2026-02-01T00:00:00Z",
    vulnerableAsset: { id: "a-2", name: "vm-beta", type: "VIRTUAL_MACHINE", cloudPlatform: "Azure" },
  },
  {
    id: "f-3",
    name: "CVE-2024-0003",
    severity: "MEDIUM",
    status: "OPEN",
    vulnerableAsset: { id: "a-3", name: "vm-gamma", type: "CONTAINER", cloudPlatform: "GCP" },
  },
];

describe("buildFrame", () => {
  it("matches the slim fallback mapping exactly, plus _page", () => {
    const frame = buildFrame(SLIM, pageOfFromRuns([[1, 2], [2, 1]], SLIM.length));
    expect(frame).toHaveLength(SLIM.length);
    frame.forEach((rec, i) => {
      const expected = flattenNode(SLIM[i]);
      expected["_vuln_key"] = vulnKey(SLIM[i]);
      const { _page, ...rest } = rec;
      expect(rest).toEqual(expected);
    });
    expect(frame.map((r) => r["_page"])).toEqual([1, 1, 2]);
  });

  it("omits _page when no mapping is available", () => {
    const frame = buildFrame(SLIM, null);
    for (const rec of frame) expect("_page" in rec).toBe(false);
  });

  it("does not mutate the slim records (they go on to persistFlatScan)", () => {
    const before = JSON.stringify(SLIM);
    buildFrame(SLIM, () => 1);
    expect(JSON.stringify(SLIM)).toBe(before);
  });
});

describe("pageOfFromRuns", () => {
  it("expands runs in fetch order", () => {
    const pageOf = pageOfFromRuns([[1, 2], [2, 3], [7, 1]], 6)!;
    expect([0, 1, 2, 3, 4, 5].map(pageOf)).toEqual([1, 1, 2, 2, 2, 7]);
  });

  it("is null when the runs don't cover the record count", () => {
    expect(pageOfFromRuns([[1, 2]], 3)).toBeNull();
    expect(pageOfFromRuns([[1, 4]], 3)).toBeNull();
    expect(pageOfFromRuns(null, 3)).toBeNull();
  });

  it("handles incremental delta page numbering (1001+)", () => {
    const pageOf = pageOfFromRuns([[1001, 1], [1002, 2]], 3)!;
    expect([0, 1, 2].map(pageOf)).toEqual([1001, 1002, 1002]);
  });
});
