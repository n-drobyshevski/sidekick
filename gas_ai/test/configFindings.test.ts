// The Cloud Configuration register's arithmetic, and the predicate the whole feature
// hangs on.
//
// isOpenGap gets the most attention here because it is the single definition of
// "compliance gap" in the app: AARS pillar B, kpis.complianceGaps, the register's counts
// and the asset drill-down's Compliance pane all route through it. If it drifts, four
// numbers drift together and nothing errors.

import { describe, expect, it } from "vitest";
import { isOpenGap } from "../src/domain/config";
import {
  configFacetCounts, configTotals, filterConfigRows, resolveConfigQuery, rollupByControl,
  sortConfigRows, toConfigView,
} from "../src/domain/configFindings";
import type { FindingRow } from "../src/domain/graphTypes";

function finding(over: Partial<FindingRow> = {}): FindingRow {
  return {
    id: "f-1",
    resourceId: "res-1",
    ruleShortId: "SUB-082",
    severity: "MEDIUM",
    frameworkCodes: ["SUB-082"],
    status: "OPEN",
    result: "FAIL",
    ...over,
  };
}

describe("isOpenGap", () => {
  it("counts a failing, open, live finding", () => {
    expect(isOpenGap(finding())).toBe(true);
  });

  it("does not count a resolved finding, which comes back PASS", () => {
    expect(isOpenGap(finding({ status: "RESOLVED", result: "PASS" }))).toBe(false);
  });

  it("does not count a rejected finding — accepted risk is not outstanding work", () => {
    expect(isOpenGap(finding({ status: "REJECTED" }))).toBe(false);
  });

  it("does not count a tombstoned finding even while it still reads FAIL/OPEN", () => {
    expect(isOpenGap(finding({ deleted: true }))).toBe(false);
  });

  it("counts a PASS result as no gap regardless of status", () => {
    expect(isOpenGap(finding({ result: "PASS" }))).toBe(false);
  });

  // The upgrade path. Rows written before the ai_findings tab gained `result` and
  // `status` carry neither, and every one of them was already filtered to FAIL + OPEN at
  // ingest. Reading them as "not a gap" would drop AARS pillar B to zero on any rescore
  // taken before the next sync rewrites the tab — silently, since a zero is a real number.
  it("treats a legacy row with neither field as the gap it was stored as", () => {
    const legacy = finding({ status: undefined, result: undefined });
    expect(isOpenGap(legacy)).toBe(true);
  });

  it("still judges a legacy row that carries only one of the two fields", () => {
    expect(isOpenGap(finding({ status: undefined }))).toBe(true);
    expect(isOpenGap(finding({ result: undefined }))).toBe(true);
    expect(isOpenGap(finding({ status: undefined, result: "PASS" }))).toBe(false);
    expect(isOpenGap(finding({ result: undefined, status: "RESOLVED" }))).toBe(false);
  });

  it("reads an explicit deleted:false as alive, not as missing", () => {
    expect(isOpenGap(finding({ deleted: false }))).toBe(true);
  });
});

describe("toConfigView", () => {
  it("derives linkage, exception and IaC flags from the stored row", () => {
    const view = toConfigView(finding({
      ignoreRuleIds: ["ig-1"],
      iacFindingIds: ["iac-1"],
      projects: [{ id: "p1", name: "PROJECT-ALPHA", businessImpact: "LBI" }],
    }), true);
    expect(view.linked).toBe(true);
    expect(view.ignored).toBe(true);
    expect(view.iac).toBe(true);
    expect(view.gap).toBe(true);
    expect(view.projects).toEqual(["PROJECT-ALPHA"]);
  });

  it("is not linked when the caller says the resource is absent from the inventory", () => {
    expect(toConfigView(finding({ resourceType: "REGION" }), false).linked).toBe(false);
  });
});

describe("configTotals", () => {
  const rows = [
    toConfigView(finding({ id: "a", severity: "HIGH" }), true),
    toConfigView(finding({ id: "b", resourceId: "res-2", severity: "MEDIUM" }), false),
    toConfigView(finding({ id: "c", resourceId: "res-3", status: "RESOLVED", result: "PASS" }), true),
    toConfigView(finding({ id: "d", resourceId: "res-4", ruleShortId: "IAM-267" }), false),
  ];

  it("counts failing controls, not stored rows", () => {
    const t = configTotals(rows);
    expect(t.findings).toBe(4);
    expect(t.gaps).toBe(3);
  });

  it("reports the unlinked share of the gaps, not of every row", () => {
    // Row "c" is unlinked-and-resolved in no sense: it is linked. Rows b and d are the
    // unlinked gaps. A count over all rows rather than over gaps would answer 2 here too,
    // so the case makes b/d gaps and c linked to keep the two readings distinguishable.
    expect(configTotals(rows).unlinkedGaps).toBe(2);
  });

  it("draws the severity mix from gaps only", () => {
    // The resolved row is HIGH-adjacent noise: counting it would draw risk the landscape no
    // longer carries.
    const mix = configTotals(rows).severityMix;
    expect(mix.HIGH).toBe(1);
    expect(mix.MEDIUM).toBe(2);
  });

  it("counts distinct controls and distinct resources", () => {
    const t = configTotals(rows);
    expect(t.controls).toBe(2);
    expect(t.resources).toBe(4);
  });
});

describe("rollupByControl", () => {
  const rows = [
    toConfigView(finding({ id: "a", ruleShortId: "IAM-236", severity: "HIGH", ruleName: "Bedrock roles", firstSeenAt: "2026-02-01T00:00:00Z" }), true),
    toConfigView(finding({ id: "b", ruleShortId: "IAM-236", severity: "CRITICAL", resourceId: "res-2", ruleName: "Bedrock roles", firstSeenAt: "2026-01-01T00:00:00Z" }), false),
    toConfigView(finding({ id: "c", ruleShortId: "IAM-236", severity: "HIGH", resourceId: "res-2", ruleName: "Bedrock roles" }), false),
    toConfigView(finding({ id: "d", ruleShortId: "SUB-082", severity: "LOW", resourceId: "res-9", ruleName: "CMEK" }), true),
  ];

  it("groups findings into the control that produced them", () => {
    const out = rollupByControl(rows);
    expect(out.map((c) => c.ruleShortId)).toEqual(["IAM-236", "SUB-082"]);
    expect(out[0].findings).toBe(3);
  });

  it("counts DISTINCT resources, so one rule failing twice on a resource is one resource", () => {
    // b and c both key to res-2. A row count would answer 3 and overstate the blast radius.
    expect(rollupByControl(rows)[0].resources).toBe(2);
  });

  it("takes the worst severity across the group", () => {
    expect(rollupByControl(rows)[0].severity).toBe("CRITICAL");
  });

  it("takes the EARLIEST firstSeenAt — how long the control has been failing", () => {
    expect(rollupByControl(rows)[0].firstSeenAt).toBe("2026-01-01T00:00:00Z");
  });

  it("splits linked from unlinked inside the control", () => {
    const c = rollupByControl(rows)[0];
    expect(c.linked).toBe(1);
    expect(c.unlinked).toBe(2);
  });

  // The three numbers a reader compares in the table are all DISTINCT-resource counts, so
  // "N failing of M resources" is a ratio between the same unit rather than findings over
  // resources. res-2 carries two failing findings and must count once.
  it("counts failing and off-inventory in resources, not in findings", () => {
    const c = rollupByControl(rows)[0];
    expect(c.findings).toBe(3);
    expect(c.gaps).toBe(3);
    expect(c.resources).toBe(2);
    expect(c.gapResources).toBe(2);
    expect(c.unlinkedGapResources).toBe(1);
  });

  it("does not count a resource whose only finding resolved as still failing", () => {
    const resolvedOnly = [
      toConfigView(finding({ id: "x", ruleShortId: "SUB-900", resourceId: "r-1" }), true),
      toConfigView(finding({
        id: "y", ruleShortId: "SUB-900", resourceId: "r-2",
        status: "RESOLVED", result: "PASS",
      }), true),
    ];
    const c = rollupByControl(resolvedOnly)[0];
    expect(c.resources).toBe(2);
    expect(c.gapResources).toBe(1);
  });

  it("orders worst-first, then by blast radius", () => {
    expect(rollupByControl(rows).map((c) => c.severity)).toEqual(["CRITICAL", "LOW"]);
  });
});

describe("filterConfigRows", () => {
  const rows = [
    toConfigView(finding({ id: "a", severity: "HIGH", cloudProvider: "AWS" }), true),
    toConfigView(finding({ id: "b", severity: "LOW", cloudProvider: "GCP", resourceId: "r2" }), false),
    toConfigView(finding({ id: "c", severity: "HIGH", cloudProvider: "GCP", resourceId: "r3", ignoreRuleIds: ["ig"] }), false),
  ];

  it("ORs inside a dimension", () => {
    const q = resolveConfigQuery({ severities: "HIGH,LOW" });
    expect(filterConfigRows(rows, q)).toHaveLength(3);
  });

  it("ANDs across dimensions", () => {
    const q = resolveConfigQuery({ severities: "HIGH", clouds: "GCP" });
    expect(filterConfigRows(rows, q).map((r) => r.id)).toEqual(["c"]);
  });

  it("ANDs inside flags, because 'failing AND ignored' is the triage question", () => {
    const q = resolveConfigQuery({ flags: "gap,ignored" });
    expect(filterConfigRows(rows, q).map((r) => r.id)).toEqual(["c"]);
  });

  it("filters on linkage", () => {
    expect(filterConfigRows(rows, resolveConfigQuery({ linkage: "unlinked" })).map((r) => r.id))
      .toEqual(["b", "c"]);
  });

  it("ignores a linkage or flag value that is not in the vocabulary", () => {
    const q = resolveConfigQuery({ linkage: "sideways", flags: "nonsense" });
    expect(q.linkage).toEqual([]);
    expect(q.flags).toEqual([]);
    expect(filterConfigRows(rows, q)).toHaveLength(3);
  });
});

describe("configFacetCounts", () => {
  const rows = [
    toConfigView(finding({ id: "a", severity: "HIGH", cloudProvider: "AWS" }), true),
    toConfigView(finding({ id: "b", severity: "LOW", cloudProvider: "GCP", resourceId: "r2" }), false),
  ];

  it("counts an option against the OTHER dimensions, not against its own", () => {
    // With severity=HIGH picked, the severity facet must still report LOW's real count —
    // otherwise every option you have not picked reads 0 and the number is useless.
    const counts = configFacetCounts(rows, resolveConfigQuery({ severities: "HIGH" }));
    const low = counts.severities.filter((o) => o.value === "LOW")[0];
    expect(low.count).toBe(1);
  });

  it("keeps a selected value on the list at 0 when it stops matching", () => {
    const counts = configFacetCounts(
      rows,
      resolveConfigQuery({ severities: "CRITICAL" }),
    );
    expect(counts.severities.filter((o) => o.value === "CRITICAL")[0]).toEqual({
      value: "CRITICAL", count: 0,
    });
  });

  it("reports the matched total alongside the facets", () => {
    expect(configFacetCounts(rows, resolveConfigQuery({ clouds: "AWS" })).matched).toBe(1);
  });
});

describe("sortConfigRows", () => {
  const rows = [
    toConfigView(finding({ id: "b", severity: "LOW" }), true),
    toConfigView(finding({ id: "a", severity: "LOW" }), true),
    toConfigView(finding({ id: "c", severity: "CRITICAL" }), true),
  ];

  it("sorts worst-first by default", () => {
    expect(sortConfigRows(rows, "severity")[0].severity).toBe("CRITICAL");
  });

  // The tie-break is NOT multiplied by the direction. Flipping the column's direction
  // reverses the severities and leaves equal rows in the same order, so paging through a
  // register where most rows share a severity does not reshuffle under you.
  it("breaks ties on id ascending, whichever way the column sorts", () => {
    expect(sortConfigRows(rows, "severity", "desc").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortConfigRows(rows, "severity", "asc").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
