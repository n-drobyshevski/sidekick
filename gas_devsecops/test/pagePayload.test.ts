// Port of gas/test/pagePayload.test.ts. See pagePayload.ts's header for the three places this
// register's own column names matter (OLDEST_VIEWS, SCAN_ROW_KEYS, JOB_KEYS) — everything else
// here slices generic, duck-typed read-model shapes and needed no reshaping.

import { describe, expect, it } from "vitest";

import {
  execGroupSlice, execMttrSlice, historyTrendSlice, jobSummarySlice, mttrGroupTableSlice,
  mttrGroupTrendSlice, mttrPageTrendSlice, oldestOpenSlice, overviewInsightsSlice,
  programTrendSlice, scanRowsSlice,
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
  dimension: "owner_project",
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

  it("collapses the group/domain alias to one field", () => {
    const json = JSON.stringify(execGroupSlice(FULL_GROUP));
    expect(json).not.toContain("domain\":");
    expect(json).toContain("CROSS");
    expect((json.match(/CROSS/g) ?? []).length).toBe(1);
  });

  it("reads the name from group, falling back to domain", () => {
    const out = execGroupSlice({ dimension: "supportGroup", rows: [{ group: "CS-INIX", open: 3 }] })!;
    expect((out.rows as { group: string }[])[0].group).toBe("CS-INIX");
    const legacy = execGroupSlice({ dimension: "domain", rows: [{ domain: "SAP", open: 1 }] })!;
    expect((legacy.rows as { group: string }[])[0].group).toBe("SAP");
  });

  it("keeps every row, leaving the cap to the view", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ group: "g" + i, open: i, kmMedian: 1 }));
    expect((execGroupSlice({ dimension: "owner_project", rows })!.rows as object[]).length).toBe(9);
  });

  it("survives a missing or empty payload", () => {
    expect(execGroupSlice(null)).toBeNull();
    expect(execGroupSlice({ dimension: "owner_project" })!.rows).toEqual([]);
  });
});

// --------------------------------------------------------------- trend series

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

  it("keeps sla_net, whose operands it drops", () => {
    expect((mttrPageTrendSlice(TRENDS)!.trend as { sla_net: number }[])[0]!.sla_net).toBe(1);
  });

  it("keeps history, unlike the Scan History slice", () => {
    expect(mttrPageTrendSlice(TRENDS)!.history).toEqual(TRENDS.history);
  });
});

describe("historyTrendSlice — five fields, and no history array at all", () => {
  it("keeps only what the two charts draw", () => {
    expect(keysOf(historyTrendSlice(TRENDS), "trend"))
      .toEqual(["date", "km_median_days", "open", "reconstructed", "resolved"]);
  });

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

describe("scanRowsSlice — the columns the table draws (no `shape`, adds `scope`)", () => {
  const ROW = {
    scan_id: "s1", ts: "2026-08-01T00:00:00Z", scope: "sca", mode: "full", total: 161,
    new_count: 4, resolved_count: 2, reopened_count: 0, severities: "CRITICAL,HIGH",
    sealed: 0, raw_ref: "1AbCdEfGhIjKlMnOpQrStUvWxYz012345", obs_ref: "1ZyXwVuTsRqPoNmLkJ",
  };

  it("keeps every column the page reads", () => {
    expect(Object.keys(scanRowsSlice([ROW])[0]!).sort()).toEqual([
      "mode", "new_count", "reopened_count", "resolved_count", "scan_id",
      "scope", "sealed", "severities", "total", "ts",
    ]);
  });

  // Drive file ids for the archived pages and the observation set: internal storage addresses
  // with no client reader, which the browser has no business receiving. D9 brief's explicit
  // security rule for scan rows.
  it("drops the Drive refs", () => {
    const json = JSON.stringify(scanRowsSlice([ROW]));
    expect(json).not.toContain("raw_ref");
    expect(json).not.toContain("obs_ref");
    expect(json).not.toContain("1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
    expect(json).not.toContain("1ZyXwVuTsRqPoNmLkJ");
  });

  it("has no `shape` column to leak — ledgerTypes.ts's ScanRow carries none", () => {
    expect(JSON.stringify(scanRowsSlice([ROW]))).not.toContain("shape");
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
    oldest: { findings: [{ identifier: "CVE-1" }], byRepo: [] },
  };

  it("drops oldest and keeps every other key", () => {
    const out = overviewInsightsSlice(INSIGHTS)!;
    expect(out).not.toHaveProperty("oldest");
    expect(Object.keys(out).sort()).toEqual([
      "aging", "awaiting", "counts", "exploit", "flatScan", "movement",
      "openTrend", "scan", "sevStats", "total",
    ]);
  });

  it("passes through a key it has never heard of", () => {
    expect(overviewInsightsSlice({ ...INSIGHTS, somethingNew: 1 })).toHaveProperty("somethingNew");
  });

  it("returns null for a missing payload", () => {
    expect(overviewInsightsSlice(null)).toBeNull();
  });
});

describe("oldestOpenSlice — one view, and the view it answers for (findings / byRepo only)", () => {
  const INSIGHTS = {
    oldest: { findings: [{ identifier: "CVE-1" }], byRepo: [{ key: "repo-a" }] },
  };

  it("returns the requested view", () => {
    expect(oldestOpenSlice(INSIGHTS, "byRepo")).toEqual({ view: "byRepo", rows: [{ key: "repo-a" }] });
  });

  it("echoes the view back so a raced response can be discarded", () => {
    expect(oldestOpenSlice(INSIGHTS, "byRepo").view).toBe("byRepo");
  });

  it("falls back to findings for an unknown or empty view", () => {
    expect(oldestOpenSlice(INSIGHTS, "nonsense").view).toBe("findings");
    expect(oldestOpenSlice(INSIGHTS, "").rows).toEqual([{ identifier: "CVE-1" }]);
    // gas/'s dropped views (bySupportGroup/byDomain) fall back too — insights.ts never
    // computes them, so requesting one must not surface a stale or undefined slice.
    expect(oldestOpenSlice(INSIGHTS, "bySupportGroup").view).toBe("findings");
    expect(oldestOpenSlice(INSIGHTS, "byDomain").view).toBe("findings");
  });

  it("returns an empty row set rather than throwing on a payload with no oldest block", () => {
    expect(oldestOpenSlice({ flatScan: false }, "findings")).toEqual({ view: "findings", rows: [] });
    expect(oldestOpenSlice(null, "byRepo")).toEqual({ view: "byRepo", rows: [] });
  });
});

describe("the MTTR by-group split, cut in two", () => {
  const GROUP = {
    dimension: "owner_project",
    rows: [{ group: "CROSS", open: 18, awaiting: 2 }, { group: "SAP", open: 13, awaiting: 0 }],
    trend: { groups: ["CROSS"], points: [{ d: 1 }], kmPoints: [{ d: 1 }] },
  };

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
    expect(mttrGroupTableSlice({ dimension: "owner_project" })!.rows).toEqual([]);
    expect(mttrGroupTrendSlice({ dimension: "owner_project" })).toBeNull();
    expect(mttrGroupTrendSlice(null)).toBeNull();
  });
});

// ------------------------------------------------------------------ job status

describe("jobSummarySlice — what a 3-second poll is allowed to carry", () => {
  const JOB = {
    job_id: "scan-1", kind: "sync", phase: "FETCHING", scope: "sca", page: 3, findings_so_far: 400,
    total_count: 1200, started_at: "2026-08-25T10:00:00Z", updated_at: "2026-08-25T10:02:00Z",
    error: null, scan_id: "s1", page_size: 500,
    cursor: "eyJvZmZzZXQiOjUwMH0=", journal_ref: "1AbCdEfGhIjKlMnOpQrStUv",
    params_json: '{"incremental":true,"severities":["CRITICAL"]}',
  };

  it("ships only the fields the progress card draws (plus `scope`, unique to this register)", () => {
    expect(Object.keys(jobSummarySlice(JOB, false)!).sort()).toEqual([
      "error", "findings_so_far", "incremental", "job_id", "kind", "page",
      "phase", "scope", "stale", "started_at", "total_count", "updated_at",
    ]);
  });

  // The D9 brief's security rule, pinned two ways: cursor/journal_ref are absent as top-level
  // keys (implied by the allowlist above), AND absent from the full serialized payload even
  // though the source job also carries them stitched into params_json's raw text — proving the
  // stripping survives a value smuggled through a nested, parsed field, not just a flat key.
  it("drops the Wiz cursor and the journal ref, including a copy smuggled inside params_json text", () => {
    const jobWithSmuggledCopies = {
      ...JOB,
      // The cursor and journal_ref values ALSO appear, verbatim, inside params_json's raw
      // text — e.g. an upstream caller echoing them back for debugging. A key-based strip
      // alone would not catch this; only never re-serializing params_json at all does.
      params_json: JSON.stringify({
        incremental: true,
        severities: ["CRITICAL"],
        cursor: JOB.cursor,
        journal_ref: JOB.journal_ref,
      }),
    };
    const json = JSON.stringify(jobSummarySlice(jobWithSmuggledCopies, false));
    expect(json).not.toContain("cursor");
    expect(json).not.toContain("journal_ref");
    expect(json).not.toContain("eyJvZmZzZXQiOjUwMH0=");
    expect(json).not.toContain("1AbCdEfGhIjKlMnOpQrStUv");
    expect(json).not.toContain("params_json");
    // The rest of params_json's content (unrelated to the two secrets) legitimately survives
    // ONLY as the derived `incremental` boolean, never as raw text.
    expect(JSON.parse(json!).incremental).toBe(true);
  });

  it("resolves incremental server-side instead of shipping the raw params blob", () => {
    expect(jobSummarySlice(JOB, false)!.incremental).toBe(true);
    expect(JSON.stringify(jobSummarySlice(JOB, false))).not.toContain("params_json");
    expect(jobSummarySlice({ ...JOB, params_json: '{"incremental":false}' }, false)!.incremental)
      .toBe(false);
  });

  it("says null rather than false when the params cannot be read", () => {
    expect(jobSummarySlice({ ...JOB, params_json: "{not json" }, false)!.incremental).toBeNull();
    expect(jobSummarySlice({ ...JOB, params_json: null }, false)!.incremental).toBeNull();
  });

  it("carries the caller's staleness verdict", () => {
    expect(jobSummarySlice(JOB, true)!.stale).toBe(true);
    expect(jobSummarySlice(JOB, false)!.stale).toBe(false);
  });

  it("returns null for no job", () => {
    expect(jobSummarySlice(null, false)).toBeNull();
  });
});
