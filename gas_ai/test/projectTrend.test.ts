// The trend's per-project dimension — counted at commit, read back per project.
//
// Its own file rather than more of aarsTrend.test.ts, the way expandCacheVersion.test.ts sits
// beside expandAsset.test.ts: same module, a distinct concern with its own invariant.
//
// THE INVARIANT. sync_history recorded register-wide totals and nothing else, which made the
// inventory trend the one figure in the app that had to refuse the project switcher outright —
// a past point had no project on the row to be re-scoped BY. It now carries a blob beside those
// totals, so a scoped read is a different COLUMN rather than a filter. That column has two
// different absences and both must SKIP the point: a row written before it existed, and a
// project that held nothing at that sync. Neither may be plotted as a zero, because a line
// dropping to zero and a line that has not started yet are opposite claims about a landscape.

import { describe, expect, it } from "vitest";
import {
  PROJECT_TOTALS_COLUMN,
  PROJECT_TOTALS_MAX_CHARS,
  aarsTrendFromHistory,
  countProjectTotals,
  encodeProjectTotals,
  problemTrendFromHistory,
  type ProjectTotals,
} from "../src/domain/aarsTrend";
import { AARS_SEVERITY_ORDER } from "../src/domain/config";
import type { Rec } from "../src/domain/util";

const asset = (id: string, projects: string[], aarsSeverity?: string) =>
  ({ id, projects: projects.map((p) => ({ id: p })), aarsSeverity });

const historyRow = (over: Rec): Rec =>
  ({ status: "SUCCESS", finished_at: "2026-06-20T05:00:00Z", ...over });

describe("countProjectTotals", () => {
  it("gives a folder its whole subtree, because an asset carries its ancestors", () => {
    // No tree walk here, and none wanted: Wiz attributes an asset to every project it belongs
    // to, ancestors included, so incrementing per id sums the subtree by construction — and by
    // exactly the rule api.ts `viewAssets` filters with, which is what keeps this series and
    // the figures beside it describing one population.
    const totals = countProjectTotals([
      asset("a1", ["unit", "alpha"], "CRITICAL"),
      asset("a2", ["unit", "beta"], "HIGH"),
    ], []);
    expect(totals["unit"]!.aars["CRITICAL"]).toBe(1);
    expect(totals["unit"]!.aars["HIGH"]).toBe(1);
    expect(totals["alpha"]!.aars["CRITICAL"]).toBe(1);
    expect(totals["alpha"]!.aars["HIGH"]).toBe(0);
    expect(totals["beta"]!.aars["HIGH"]).toBe(1);
  });

  it("writes a zeroed entry for a project holding only unscored assets", () => {
    // THE CONTRACT THE READER DEPENDS ON. Present-with-zeros means "measured, and it was
    // zero"; absent means "held nothing at that sync". Drop the zeroed entry and the two
    // collapse into one, and every project's line starts at the dawn of the ledger.
    const totals = countProjectTotals([asset("a1", ["quiet"])], []);
    expect(totals["quiet"]).toBeDefined();
    for (const sev of AARS_SEVERITY_ORDER) expect(totals["quiet"]!.aars[sev]).toBe(0);
  });

  it("has no entry for a project holding no asset", () => {
    expect(countProjectTotals([asset("a1", ["alpha"], "LOW")], [])["beta"]).toBeUndefined();
  });

  it("ignores an asset Wiz attributed to no project", () => {
    // It belongs to no project, so it belongs to no project's series — the same answer the
    // scoped gap count already gives for a finding on a resource no asset models.
    expect(countProjectTotals([asset("a1", [], "CRITICAL")], [])).toEqual({});
  });

  it("attributes issues and findings through their asset, like viewIssues/viewFindings", () => {
    const totals = countProjectTotals(
      [asset("a1", ["unit", "alpha"], "HIGH"), asset("a2", ["unit", "beta"], "LOW")],
      [
        { assetId: "a1", problemOutcome: "ACT" },        // an issue, keyed assetId
        { resourceId: "a2", problemOutcome: "TRACK" },   // a finding, keyed resourceId
        { assetId: "ghost", problemOutcome: "ACT" },     // asset not in the register
        { assetId: "a1", problemOutcome: "NOT_A_VALUE" },
      ],
    );
    expect(totals["unit"]!.outcome["ACT"]).toBe(1);
    expect(totals["unit"]!.outcome["TRACK"]).toBe(1);
    expect(totals["alpha"]!.outcome["ACT"]).toBe(1);
    expect(totals["alpha"]!.outcome["TRACK"]).toBe(0);
    // A row whose asset is not in the register contributes to nothing, and never mints a
    // project of its own out of an id no asset claims.
    expect(totals["ghost"]).toBeUndefined();
    // An outcome outside the vocabulary is dropped rather than counted under its own name.
    expect(Object.keys(totals["alpha"]!.outcome)).not.toContain("NOT_A_VALUE");
  });
});

describe("encodeProjectTotals", () => {
  it("refuses rather than truncating when the map will not fit one cell", () => {
    // A trend refinement must never fail a sync commit, and must never write a PREFIX of the
    // projects — which reads as "held nothing" for everyone past the cut. Null is a value the
    // row is allowed to carry; the register-wide totals beside it are unaffected.
    const huge: Record<string, ProjectTotals> = {};
    for (let i = 0; i < 4000; i++) {
      huge[`project-with-a-realistic-length-identifier-${i}`] =
        { aars: { CRITICAL: i }, outcome: { ACT: i } };
    }
    expect(JSON.stringify(huge).length).toBeGreaterThan(PROJECT_TOTALS_MAX_CHARS);
    expect(encodeProjectTotals(huge)).toBeNull();
  });

  it("encodes an ordinary map", () => {
    const json = encodeProjectTotals(countProjectTotals([asset("a1", ["alpha"], "LOW")], []));
    expect(json).toContain("alpha");
    expect(JSON.parse(String(json))["alpha"]["aars"]["LOW"]).toBe(1);
  });
});

describe("aarsTrendFromHistory, scoped to a project", () => {
  const blob = (o: Rec) => JSON.stringify(o);
  const HISTORY: Rec[] = [
    // Recorded before the column existed.
    historyRow({ finished_at: "2026-06-01T00:00:00Z", aars_severity_json: JSON.stringify({ CRITICAL: 9 }) }),
    // Column present; alpha is not in the register yet.
    historyRow({
      finished_at: "2026-06-02T00:00:00Z",
      aars_severity_json: JSON.stringify({ CRITICAL: 9 }),
      [PROJECT_TOTALS_COLUMN]: blob({ beta: { aars: { CRITICAL: 4 }, outcome: {} } }),
    }),
    // alpha appears, holding nothing that scored — a MEASURED zero.
    historyRow({
      finished_at: "2026-06-03T00:00:00Z",
      aars_severity_json: JSON.stringify({ CRITICAL: 9 }),
      [PROJECT_TOTALS_COLUMN]: blob({
        alpha: { aars: { CRITICAL: 0, HIGH: 0 }, outcome: {} },
        beta: { aars: { CRITICAL: 4 }, outcome: {} },
      }),
    }),
    historyRow({
      finished_at: "2026-06-04T00:00:00Z",
      aars_severity_json: JSON.stringify({ CRITICAL: 9 }),
      [PROJECT_TOTALS_COLUMN]: blob({ alpha: { aars: { CRITICAL: 2, HIGH: 5 }, outcome: {} } }),
    }),
  ];

  it("reads the project's own counts, never the register's", () => {
    const points = aarsTrendFromHistory(HISTORY, 90, "alpha");
    expect(points.map((p) => p.counts["CRITICAL"])).toEqual([0, 2]);
    expect(points[points.length - 1]!.counts["HIGH"]).toBe(5);
    // Every row carries the register column, so the unscoped series keeps all four points.
    // Scoping is what drops points here — the difference is the question, not the data.
    expect(aarsTrendFromHistory(HISTORY).map((p) => p.counts["CRITICAL"])).toEqual([9, 9, 9, 9]);
  });

  it("skips a row recorded before the column rather than plotting a zero", () => {
    expect(aarsTrendFromHistory(HISTORY, 90, "alpha")[0]!.at).toBe("2026-06-03T00:00:00Z");
  });

  it("tells 'not in the register' apart from 'in it, and measured zero'", () => {
    // The pair that has to stay distinguishable: 06-02 carries no `alpha` key at all (absent
    // — skipped), 06-03 carries one whose counts are all zero (measured — plotted). Collapse
    // them and a project's line runs back to the beginning of the ledger along zero.
    const ats = aarsTrendFromHistory(HISTORY, 90, "alpha").map((p) => p.at);
    expect(ats).not.toContain("2026-06-02T00:00:00Z");
    expect(ats).toContain("2026-06-03T00:00:00Z");
  });

  it("returns nothing for a project the ledger has never held", () => {
    expect(aarsTrendFromHistory(HISTORY, 90, "never-synced")).toEqual([]);
  });

  it("survives a blob that is not JSON, or not an object", () => {
    // Same defensive posture the register-wide path already takes: an unreadable cell is an
    // absent measurement, not a zero and not a throw.
    for (const bad of ["{not json", "[]", "\"a string\"", "", null]) {
      const rows = [historyRow({ [PROJECT_TOTALS_COLUMN]: bad })];
      expect(aarsTrendFromHistory(rows, 90, "alpha")).toEqual([]);
    }
  });

  it("reads the problem series out of the same cell, under its own key", () => {
    const rows: Rec[] = [historyRow({
      problem_outcome_json: JSON.stringify({ ACT: 1 }),
      [PROJECT_TOTALS_COLUMN]: blob({
        alpha: { aars: { CRITICAL: 7 }, outcome: { ACT: 3, TRACK: 1 } },
      }),
    })];
    const points = problemTrendFromHistory(rows, 90, "alpha");
    expect(points[0]!.counts["ACT"]).toBe(3);
    expect(points[0]!.counts["TRACK"]).toBe(1);
    // One cell carries both series; each spec reads its own key and never the other's.
    expect(aarsTrendFromHistory(rows, 90, "alpha")[0]!.counts["CRITICAL"]).toBe(7);
  });
});
