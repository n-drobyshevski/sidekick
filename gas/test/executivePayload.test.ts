// WHAT THE EXECUTIVE LANDING PAGE IS SENT, pinned field by field.
//
// The failure this guards is not a crash and would never show on screen. api_getExecutivePage
// composes read-models built for the MTTR page — deliberately, so both share one cache entry —
// and it used to return them whole. Measured on the seeded estate, 8,716 of 13,068 bytes went
// down the wire on the default landing page with nothing reading them: two Kaplan-Meier curves
// (`km` and the actionable-clock `kmActionable`, one point per distinct event time) and a
// per-group trend series with no chart under it.
//
// That is a scaling cost, not a fixed one — the curve grows with the number of distinct
// resolution times — and it is invisible from the page, which renders identically either way.
// So the only thing that keeps the payload trimmed is an assertion that it is. These specs
// enumerate the surviving keys exactly: adding a field to `mttrData`'s remediation block is
// free, but adding it to what EXEC ships has to be a decision someone made on purpose.

import { describe, expect, it } from "vitest";

import { execGroupSlice, execMttrSlice } from "../src/domain/executivePayload";

// A realistic mttrData return: everything the MTTR page reads, of which exec reads four numbers.
const FULL_MTTR = {
  perSev: { CRITICAL: { count: 12, median: 3 }, HIGH: { count: 40, median: 9 } },
  overall: { count: 99, resolved: 32, open: 67, median: 12.5, p90: 88 },
  slaPct: 61.2,
  oldestDays: 412,
  rowCount: 99,
  remediation: {
    pctiles: { overall: { p50: 12, p90: 88 } },
    buckets: { "0-7": 4, "8-30": 11 },
    km: {
      curve: Array.from({ length: 52 }, (_, i) => ({ t: i, s: 1 - i / 104 })),
      median: null,
      medianLowerBound: 118.4,
      mean: 63.2,
      restrictionTime: 118.4,
      meanTruncated: true,
      naiveMean: 40.1,
      naiveMedian: 21,
      events: 32,
      censored: 67,
      total: 99,
    },
    kmP90: null,
    kmMedianPerSev: { CRITICAL: 3 },
    kmP90PerSev: { CRITICAL: 9 },
    openPastSla: { CRITICAL: 5, HIGH: 12 },
    kmActionable: { curve: Array.from({ length: 31 }, (_, i) => ({ t: i, s: 1 })), median: 9 },
    openPastSlaActionable: { CRITICAL: 2 },
    awaiting: { CRITICAL: 1 },
  },
};

describe("execMttrSlice — the hero's four numbers, and nothing else", () => {
  it("ships exactly rowCount, overall.{resolved,open} and km.{median,medianLowerBound}", () => {
    const out = execMttrSlice(FULL_MTTR)!;
    expect(Object.keys(out).sort()).toEqual(["overall", "remediation", "rowCount"]);
    expect(Object.keys(out.overall as object).sort()).toEqual(["open", "resolved"]);
    expect(Object.keys(out.remediation as object)).toEqual(["km"]);
    expect((out.remediation as { km: object }).km).toEqual({
      median: null, medianLowerBound: 118.4,
    });
  });

  // The whole point: the curves are the payload, and they scale with the register.
  it("drops both Kaplan-Meier curves and every unread remediation block", () => {
    const json = JSON.stringify(execMttrSlice(FULL_MTTR));
    for (const gone of ["curve", "kmActionable", "pctiles", "buckets", "openPastSla",
      "kmMedianPerSev", "kmP90PerSev", "awaiting", "perSev", "slaPct", "oldestDays"]) {
      expect(json).not.toContain(gone);
    }
  });

  it("cuts the payload by well over an order of magnitude", () => {
    const before = JSON.stringify(FULL_MTTR).length;
    const after = JSON.stringify(execMttrSlice(FULL_MTTR)).length;
    expect(after).toBeLessThan(before / 20);
  });

  it("keeps the client's read paths intact", () => {
    const out = execMttrSlice(FULL_MTTR) as {
      rowCount: number; overall: { resolved: number; open: number };
      remediation: { km: { median: number | null; medianLowerBound: number | null } };
    };
    expect(out.rowCount).toBe(99);
    expect(out.overall.open).toBe(67);
    expect(out.remediation.km.medianLowerBound).toBe(118.4);
  });

  // fmtKmMedian renders "—" for a missing estimate, and reaches it through `remediation?.km`.
  // An empty remediation object and an absent one have to arrive there the same way.
  it("leaves remediation empty rather than absent when there is no KM result", () => {
    const out = execMttrSlice({ rowCount: 0, overall: {}, remediation: {} })!;
    expect(out.remediation).toEqual({});
  });

  it("returns null for a missing or non-object slice", () => {
    expect(execMttrSlice(null)).toBeNull();
    expect(execMttrSlice(undefined)).toBeNull();
  });
});

const FULL_GROUP = {
  dimension: "domain",
  rows: [
    { group: "CROSS", domain: "CROSS", median: 5, p90: 40, kmMedian: 12, slaPct: 70,
      openPastSla: 3, awaiting: 1, open: 18, resolved: 9 },
    { group: "SAP", domain: "SAP", median: 7, p90: 55, kmMedian: null, slaPct: 61,
      openPastSla: 5, awaiting: 0, open: 13, resolved: 4 },
  ],
  trend: {
    groups: ["CROSS", "SAP"],
    points: Array.from({ length: 40 }, (_, i) => ({ d: i, CROSS: i, SAP: i * 2 })),
    kmPoints: Array.from({ length: 40 }, (_, i) => ({ d: i, CROSS: i })),
  },
};

describe("execGroupSlice — three columns and the dimension tag", () => {
  it("ships only the columns the exec table draws", () => {
    const out = execGroupSlice(FULL_GROUP)!;
    expect(Object.keys(out).sort()).toEqual(["dimension", "rows"]);
    expect((out.rows as object[]).map((r) => Object.keys(r).sort()))
      .toEqual([["group", "kmMedian", "open"], ["group", "kmMedian", "open"]]);
  });

  it("drops the trend series, which no chart on this page reads", () => {
    expect(JSON.stringify(execGroupSlice(FULL_GROUP))).not.toContain("trend");
  });

  // Only mttrByDomainData writes the `domain` alias; shipping both sends each name twice.
  it("collapses the group/domain alias to one field", () => {
    const json = JSON.stringify(execGroupSlice(FULL_GROUP));
    expect(json).not.toContain("domain\":");
    expect(json).toContain("CROSS");
    expect((json.match(/CROSS/g) ?? []).length).toBe(1);
  });

  // The by-support-group split writes `group` alone — the fallback must not lose the name.
  it("reads the name from group, falling back to domain", () => {
    const out = execGroupSlice({ dimension: "supportGroup", rows: [{ group: "CS-INIX", open: 3 }] })!;
    expect((out.rows as { group: string }[])[0].group).toBe("CS-INIX");
    const legacy = execGroupSlice({ dimension: "domain", rows: [{ domain: "SAP", open: 1 }] })!;
    expect((legacy.rows as { group: string }[])[0].group).toBe("SAP");
  });

  // Not capped here on purpose — "how many to show" lives in executiveByDomainView, where the
  // gating rules are tested. Capping in both places would put the number in two.
  it("keeps every row, leaving the cap to the view", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ group: "g" + i, open: i, kmMedian: 1 }));
    expect((execGroupSlice({ dimension: "domain", rows })!.rows as object[]).length).toBe(9);
  });

  it("survives a missing or empty payload", () => {
    expect(execGroupSlice(null)).toBeNull();
    expect(execGroupSlice({ dimension: "domain" })!.rows).toEqual([]);
  });
});
