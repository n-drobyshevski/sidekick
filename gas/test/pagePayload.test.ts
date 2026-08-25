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

import {
  execGroupSlice, execMttrSlice, historyTrendSlice, mttrGroupTableSlice, mttrGroupTrendSlice,
  mttrPageTrendSlice, oldestOpenSlice, overviewInsightsSlice, programTrendSlice, scanRowsSlice,
} from "../src/domain/pagePayload";

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

// --------------------------------------------------------------- trend series

// One backbone, three pages, three different reads. `trendFromBase(..., {backfill:true})`
// emits a point per saved scan PLUS one per DAY of pre-first-scan history, so every unread
// field on a point is multiplied by a length the register decides. Measured on the seeded
// estate: 119 points, and the Program page read 4 of the 12 fields on each.
const TREND_POINT = {
  date: "2026-08-01", open: 40, resolved: 12, median_days: 9, sla_pct: 61,
  oldest_open_days: 412, reconstructed: false, open_past_sla: 7, sla_entered: 3,
  sla_cleared: 2, sla_net: 1, sla_attainment_pct: 88, km_median_days: 14,
  coverage_pct: 33, efficiency_pct: 41, high_risk_open: 9, high_risk_remediated: 4,
  unknown_pct: 2,
};
const TRENDS = { history: [{ date: "2026-07-01", median_days: 8 }], trend: [TREND_POINT] };
const keysOf = (o: unknown, path: string) => {
  const rows = (o as Record<string, unknown>)[path] as Record<string, unknown>[];
  return Object.keys(rows[0]!).sort();
};

describe("mttrPageTrendSlice — nine fields of thirteen", () => {
  it("keeps every series the MTTR page draws", () => {
    expect(keysOf(mttrPageTrendSlice(TRENDS), "trend")).toEqual([
      "date", "km_median_days", "median_days", "open", "open_past_sla",
      "reconstructed", "resolved", "sla_attainment_pct", "sla_net",
    ]);
  });

  it("drops the four nothing reads", () => {
    const json = JSON.stringify(mttrPageTrendSlice(TRENDS)!.trend);
    for (const gone of ["sla_pct", "oldest_open_days", "sla_entered", "sla_cleared"]) {
      expect(json).not.toContain(gone);
    }
  });

  // sla_net is a difference, so shipping both of its operands is shipping the answer twice.
  it("keeps sla_net, whose operands it drops", () => {
    expect((mttrPageTrendSlice(TRENDS)!.trend as { sla_net: number }[])[0]!.sla_net).toBe(1);
  });

  // The MTTR page reads history TWICE — hist[len-2] for the change chips, and the whole array
  // as the chart fallback when the reconstructed series is empty. Dropping it there would
  // blank those charts on exactly the young ledger they exist to cover.
  it("keeps history, unlike the Scan History slice", () => {
    expect(mttrPageTrendSlice(TRENDS)!.history).toEqual(TRENDS.history);
  });
});

describe("historyTrendSlice — five fields, and no history array at all", () => {
  it("keeps only what the two charts draw", () => {
    expect(keysOf(historyTrendSlice(TRENDS), "trend"))
      .toEqual(["date", "km_median_days", "open", "reconstructed", "resolved"]);
  });

  // The whole mttr_history tab, shipped on every visit to a page that never dereferences it.
  it("drops history entirely", () => {
    expect(historyTrendSlice(TRENDS)).not.toHaveProperty("history");
  });
});

describe("programTrendSlice — four fields of twelve", () => {
  it("keeps the coverage/efficiency pair and its axis", () => {
    expect(keysOf(programTrendSlice(TRENDS), "trend"))
      .toEqual(["coverage_pct", "date", "efficiency_pct", "reconstructed"]);
  });

  it("drops the TrendPoint base and the high-risk decorator", () => {
    const json = JSON.stringify(programTrendSlice(TRENDS));
    for (const gone of ["median_days", "sla_pct", "high_risk_open", "high_risk_remediated",
      "unknown_pct", "oldest_open_days"]) {
      expect(json).not.toContain(gone);
    }
  });
});

describe("the trend slices — shared behaviour", () => {
  it("survive an absent or trendless payload", () => {
    expect(mttrPageTrendSlice(null)).toBeNull();
    expect(historyTrendSlice(undefined)).toBeNull();
    expect(programTrendSlice({})!.trend).toEqual([]);
  });

  it("drop a key the point does not carry rather than emitting undefined", () => {
    const sparse = { trend: [{ date: "2026-08-01" }] };
    expect(Object.keys((historyTrendSlice(sparse)!.trend as object[])[0]!)).toEqual(["date"]);
  });
});

// --------------------------------------------------------------- scan history

describe("scanRowsSlice — the ten columns the table draws", () => {
  const ROW = {
    scan_id: "s1", ts: "2026-08-01T00:00:00Z", mode: "full", shape: "flat", total: 161,
    new_count: 4, resolved_count: 2, reopened_count: 0, severities: "CRITICAL,HIGH",
    sealed: false, raw_ref: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345", obs_ref: "1ZyXwVuTsRqPoNmLkJ",
  };

  it("keeps every column the page reads", () => {
    expect(Object.keys(scanRowsSlice([ROW])[0]!).sort()).toEqual([
      "mode", "new_count", "reopened_count", "resolved_count", "scan_id",
      "sealed", "severities", "shape", "total", "ts",
    ]);
  });

  // Drive file ids for the archived pages and the observation set: internal storage addresses
  // with no client reader, which the browser had no business receiving.
  it("drops the Drive refs", () => {
    const json = JSON.stringify(scanRowsSlice([ROW]));
    expect(json).not.toContain("raw_ref");
    expect(json).not.toContain("obs_ref");
    expect(json).not.toContain("1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  });

  it("returns [] for a missing scans array", () => {
    expect(scanRowsSlice(undefined)).toEqual([]);
  });
});

// ------------------------------------------------------------- drawer payloads

describe("overviewInsightsSlice — everything except the drawer's rows", () => {
  const INSIGHTS = {
    flatScan: true, counts: { HIGH: 4 }, total: 4, sevStats: {}, openTrend: [], exploit: {},
    aging: { totalOpen: 3 }, movement: {}, awaiting: {}, scan: { scanId: "s1" },
    oldest: { findings: [{ cve: "CVE-1" }], byAsset: [], bySupportGroup: [], byDomain: [] },
  };

  // 16,434 of 18,064 bytes on the seeded estate — 91% of the payload — for four ranked views
  // of up to 100 rows, of which the panel renders ten rows of one, inside a drawer many
  // readers never open.
  it("drops oldest and keeps every other key", () => {
    const out = overviewInsightsSlice(INSIGHTS)!;
    expect(out).not.toHaveProperty("oldest");
    expect(Object.keys(out).sort()).toEqual([
      "aging", "awaiting", "counts", "exploit", "flatScan", "movement",
      "openTrend", "scan", "sevStats", "total",
    ]);
  });

  // Written as an omit rather than an enumeration precisely so a new insights key travels
  // without anyone editing this file — unlike the executive slices, every other key is read.
  it("passes through a key it has never heard of", () => {
    expect(overviewInsightsSlice({ ...INSIGHTS, somethingNew: 1 })).toHaveProperty("somethingNew");
  });

  it("returns null for a missing payload", () => {
    expect(overviewInsightsSlice(null)).toBeNull();
  });
});

describe("oldestOpenSlice — one view, and the view it answers for", () => {
  const INSIGHTS = {
    oldest: { findings: [{ cve: "CVE-1" }], byAsset: [{ key: "vm" }], bySupportGroup: [], byDomain: [] },
  };

  it("returns the requested view", () => {
    expect(oldestOpenSlice(INSIGHTS, "byAsset")).toEqual({ view: "byAsset", rows: [{ key: "vm" }] });
  });

  // The echo is load-bearing: the toggle can be clicked again mid-flight, and the panel drops
  // any response whose view is no longer active rather than painting it under the wrong heading.
  it("echoes the view back so a raced response can be discarded", () => {
    expect(oldestOpenSlice(INSIGHTS, "byDomain").view).toBe("byDomain");
  });

  it("falls back to findings for an unknown or empty view", () => {
    expect(oldestOpenSlice(INSIGHTS, "nonsense").view).toBe("findings");
    expect(oldestOpenSlice(INSIGHTS, "").rows).toEqual([{ cve: "CVE-1" }]);
  });

  it("returns an empty row set rather than throwing on a payload with no oldest block", () => {
    expect(oldestOpenSlice({ flatScan: false }, "findings")).toEqual({ view: "findings", rows: [] });
    expect(oldestOpenSlice(null, "byAsset")).toEqual({ view: "byAsset", rows: [] });
  });
});

describe("the MTTR by-group split, cut in two", () => {
  const GROUP = {
    dimension: "domain",
    rows: [{ group: "CROSS", open: 18, awaiting: 2 }, { group: "SAP", open: 13, awaiting: 0 }],
    trend: { groups: ["CROSS"], points: [{ d: 1 }], kmPoints: [{ d: 1 }] },
  };

  // rows stay eager: bounded by group count, and the awaiting footnote sums them before the
  // drawer exists.
  it("mttrGroupTableSlice keeps the table and drops the series", () => {
    const out = mttrGroupTableSlice(GROUP)!;
    expect(Object.keys(out).sort()).toEqual(["dimension", "rows"]);
    expect(out.rows).toEqual(GROUP.rows);
    expect(JSON.stringify(out)).not.toContain("kmPoints");
  });

  it("mttrGroupTrendSlice returns exactly the series the drawer draws", () => {
    expect(mttrGroupTrendSlice(GROUP)).toEqual(GROUP.trend);
  });

  it("both survive a payload with no trend at all", () => {
    expect(mttrGroupTableSlice({ dimension: "domain" })!.rows).toEqual([]);
    expect(mttrGroupTrendSlice({ dimension: "domain" })).toBeNull();
    expect(mttrGroupTrendSlice(null)).toBeNull();
  });
});
