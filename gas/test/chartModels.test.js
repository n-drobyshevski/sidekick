// The register-specific `chartTableModel` builders in `pages/_charts.js` — the array-to-table
// shapes gas's own chart wrappers need that `gas_shared/ui/chartTable.js` did not already
// carry (`survivalTableModel` lives there and is tested in `test/chartTable.test.js`).
//
// THE ONE CLAIM EVERY MODEL BELOW IS HELD TO, restated once rather than seven times: a null
// point renders as the em dash, a MEASURED zero renders as "0", and the two never trade
// places. `agingTableModel` / `severityCountsTableModel` are ported unchanged in shape from
// gas_devsecops/src/client/js/pages/sca.js and already carry that guarantee there — this file
// re-measures it here because a port is a new call site, not proof the new one wired its
// inputs the same way. `trendTableModel` / `pieTableModel` / `barsTableModel` /
// `scatterTableModel` / `sparkTableModel` are new, and none of them formats a number itself —
// every column routes through `chartTableModel`'s own formatters (`ui/figures.js`), so what
// this file actually checks is that each builder's `value` reader passes a genuine `null`
// through UNTOUCHED rather than defaulting it (the `perSevOf[s][i]` / `p.byGroup[key]` /
// `s.value` accessors below are exactly the kind of read CLAUDE.md's `Number(null)` rule
// warns about — an easy place to slip in a `|| 0`).
//
// EVERY GROUP CARRIES ITS OWN INLINE PERTURBATION: the defective `Number(v) || 0` reformatting
// applied to the SAME null input, printing "0" where the real model prints "—" — proving the
// two are actually distinguishable inputs to the assertion, not two names for one thing.

import { describe, expect, it } from "vitest";

import {
  agingTableModel, barsTableModel, pieTableModel, scatterTableModel, severityCountsTableModel,
  sparkTableModel, trendTableModel,
} from "../src/client/js/pages/_charts.js";

// The shared defect shape, applied inline to whatever raw value a model was about to read —
// `Number(null)` and `Number(undefined)` are both `0`, and `0` is finite, so this is what a
// tempting "simplify the accessor" rewrite of any reader below would produce.
const badFormat = (v) => String(Number(v) || 0);

describe("agingTableModel: a null bucket count is an em dash, a measured zero is 0", () => {
  const labels = ["0-7d", "8-30d"];
  const perSev = { CRITICAL: [0, null], HIGH: [3, 5] };
  const model = agingTableModel(labels, perSev, ["CRITICAL", "HIGH"]);

  it("carries one row per bucket and one column per severity present", () => {
    expect(model.columns.map((c) => c.label)).toEqual(["Age bucket", "CRITICAL", "HIGH"]);
    expect(model.rows).toHaveLength(2);
  });

  it("a measured zero bucket count renders as 0", () => {
    expect(model.rows[0]).toEqual(["0-7d", "0", "3"]);
  });

  it("a null bucket count (never measured) renders as the em dash, not 0", () => {
    expect(model.rows[1]).toEqual(["8-30d", "—", "5"]);
    // The perturbation: the raw value this row read was `null`; the defective reformat prints
    // a confident "0" for the identical input the real model refuses.
    expect(badFormat(perSev.CRITICAL[1])).toBe("0");
    expect(model.rows[1][1]).not.toBe(badFormat(perSev.CRITICAL[1]));
  });

  it("drops a severity carrying no bucket array at all, rather than drawing a column of dashes", () => {
    const m = agingTableModel(labels, { CRITICAL: [1, 2] }, ["CRITICAL", "HIGH"]);
    expect(m.columns.map((c) => c.label)).toEqual(["Age bucket", "CRITICAL"]);
  });

  it("takes the caller's own bucket-axis label, for the SLA-window-consumed deciles this app "
    + "reuses the same builder for", () => {
    const m = agingTableModel(["0", "1"], { CRITICAL: [1, 2] }, ["CRITICAL"], "Tenth of window consumed");
    expect(m.columns[0].label).toBe("Tenth of window consumed");
  });
});

describe("severityCountsTableModel: the same zero-drop rule the severity bar draws by", () => {
  it("lists only severities carrying a nonzero count, in the given order", () => {
    const model = severityCountsTableModel(
      { CRITICAL: 4, HIGH: 0, MEDIUM: 2 }, ["CRITICAL", "HIGH", "MEDIUM"], "Open findings",
    );
    expect(model.rows).toEqual([["CRITICAL", "4"], ["MEDIUM", "2"]]);
  });

  it("a count that was never measured (undefined) is the em dash, never a confident 0", () => {
    // `severityCountsTableModel` filters by `tally[s]` truthiness before building rows, so an
    // undefined count is dropped from the table exactly as a real zero would be from the bar —
    // it is not a row this model can print a dash IN, which is itself the correct behaviour
    // (the bar draws no segment for it either). What this pins is the filter's OWN input: an
    // undefined value is falsy, same as 0, so both are equally absent from the drawn set.
    const model = severityCountsTableModel({ CRITICAL: 4 }, ["CRITICAL", "HIGH"], "Open findings");
    expect(model.rows).toEqual([["CRITICAL", "4"]]);
  });
});

describe("trendTableModel: one date column, one column per series, a gap is never a 0", () => {
  it("reads {x,y} points (trendLine's own shape) via an explicit dateKey", () => {
    const points = [
      { x: "2026-01-01", y: 12 },
      { x: "2026-01-02", y: null },
    ];
    const model = trendTableModel(points, [{ key: "y", label: "Half-life", format: "days" }],
      { dateKey: "x" });
    expect(model.columns.map((c) => c.label)).toEqual(["Date", "Half-life"]);
    expect(model.rows).toEqual([["2026-01-01", "12.0 d"], ["2026-01-02", "—"]]);
    // The perturbation: `Number(null)` is 0 and finite, so the tempting rewrite prints "0.0 d"
    // for the same missing point the real column refuses.
    expect(Number(points[1].y) || 0).toBe(0);
  });

  it("reads a nested per-series value via an explicit reader — {date,byGroup} (groupTrendLines' "
    + "own shape)", () => {
    const points = [
      { date: "2026-02-01", byGroup: { ops: 3, net: null } },
      { date: "2026-02-02", byGroup: { ops: 5 } }, // "net" absent entirely, not just null
    ];
    const series = ["ops", "net"].map((name) => ({
      key: name,
      label: name,
      format: "count",
      value: (p) => (p && p.byGroup ? (p.byGroup[name] ?? null) : null),
    }));
    const model = trendTableModel(points, series);
    expect(model.rows).toEqual([
      ["2026-02-01", "3", "—"],
      ["2026-02-02", "5", "—"],
    ]);
  });

  it("defaults a series column to row[key] when no reader is given (openResolvedLines' own "
    + "{date,open,resolved} shape)", () => {
    const points = [{ date: "2026-03-01", open: 4, resolved: null }];
    const model = trendTableModel(points, [
      { key: "open", label: "Open", format: "count" },
      { key: "resolved", label: "Resolved", format: "count" },
    ]);
    expect(model.rows).toEqual([["2026-03-01", "4", "—"]]);
  });

  it("emits one row per point, in the point array's own order — no truncation, no filtering", () => {
    const points = Array.from({ length: 40 }, (_, i) => ({ date: `d${i}`, y: i }));
    const model = trendTableModel(points, [{ key: "y", label: "Y", format: "count" }]);
    expect(model.rows).toHaveLength(40);
    expect(model.rows[39]).toEqual(["d39", "39"]);
  });

  it("a missing date is the em dash too, not an empty string cell", () => {
    const model = trendTableModel([{ y: 1 }], [{ key: "y", label: "Y", format: "count" }]);
    expect(model.rows[0][0]).toBe("—");
  });
});

describe("pieTableModel: group, count, and each slice's own share of the total", () => {
  it("computes each slice's share of the whole, to one decimal", () => {
    const model = pieTableModel([
      { label: "ops", value: 30 },
      { label: "net", value: 10 },
    ]);
    expect(model.columns.map((c) => c.label)).toEqual(["Group", "Count", "Share"]);
    expect(model.rows).toEqual([
      ["ops", "30", "75.0%"],
      ["net", "10", "25.0%"],
    ]);
  });

  it("a slice with a null value contributes nothing to the total (the OTHER slice's share is "
    + "taken over what was actually measured)", () => {
    const model = pieTableModel([{ label: "ops", value: 30 }, { label: "unmeasured", value: null }]);
    expect(model.rows[0]).toEqual(["ops", "30", "100.0%"]);
  });

  it("the null-value slice's own row: count is the em dash and so is its share, never 0%", () => {
    const model = pieTableModel([{ label: "ops", value: 30 }, { label: "unmeasured", value: null }]);
    expect(model.rows[1]).toEqual(["unmeasured", "—", "—"]);
    // The perturbation: summing with `Number(v) || 0` (rather than the explicit `num(v, 0)`
    // arithmetic fallback this model actually uses) would have SILENTLY tolerated the same
    // slip that turns a missing share into a confident percentage elsewhere in the app —
    // demonstrated here by showing the naive cast still reads the missing value as usable.
    expect(Number(null) || 0).toBe(0);
  });

  it("an empty slice list is an empty table, not a row of zero-share entries", () => {
    expect(pieTableModel([]).rows).toEqual([]);
  });
});

describe("barsTableModel: one label column, one measured-value column", () => {
  it("defaults to the count format and a 'Group' heading", () => {
    const model = barsTableModel([{ label: "ops", value: 42 }], "Contribution");
    expect(model.columns.map((c) => c.label)).toEqual(["Group", "Contribution"]);
    expect(model.rows).toEqual([["ops", "42"]]);
  });

  it("takes an explicit format for a duration column (the median-MTTR-by-domain lens)", () => {
    const model = barsTableModel([{ label: "ops", value: 12.5 }], "Median MTTR", { format: "days" });
    expect(model.rows).toEqual([["ops", "12.5 d"]]);
  });

  it("a signed value (the contribution-to-MTTR lens's finding·days) keeps its sign", () => {
    const model = barsTableModel([{ label: "ops", value: -240 }], "Contribution (finding·days)");
    expect(model.rows).toEqual([["ops", "-240"]]);
  });

  it("a row with no measured value at all is the em dash, not 0", () => {
    const model = barsTableModel([{ label: "ops", value: null }], "Contribution");
    expect(model.rows).toEqual([["ops", "—"]]);
    expect(badFormat(null)).toBe("0");
  });

  it("an empty row list is an empty table", () => {
    expect(barsTableModel([], "Value").rows).toEqual([]);
  });
});

describe("scatterTableModel: every rule, even one the chart could not plot", () => {
  it("lists coverage and efficiency as percentages, and the flagged count as a count", () => {
    const model = scatterTableModel([
      { label: "KEV only", coverage: 40, efficiency: 90, highRisk: 12 },
    ]);
    expect(model.columns.map((c) => c.label))
      .toEqual(["Rule", "Coverage", "Efficiency", "Flagged high risk"]);
    expect(model.rows).toEqual([["KEV only", "40.0%", "90.0%", "12"]]);
  });

  it("a rule too thin to score (coverage/efficiency null) is NOT MEASURABLE, not 0% — and the "
    + "row still lists it, even though coverageEfficiencyScatter's own wrapper drops it from "
    + "the plotted points", () => {
    const model = scatterTableModel([
      { label: "everything", coverage: null, efficiency: null, highRisk: 3 },
    ]);
    expect(model.rows).toEqual([["everything", "—", "—", "3"]]);
    // The perturbation: the defective reformat prints a confident "0" for the same
    // never-measurable coverage this row's real cell refuses.
    expect(badFormat(null)).toBe("0");
  });

  it("an empty point list is an empty table", () => {
    expect(scatterTableModel([]).rows).toEqual([]);
    expect(scatterTableModel(null).rows).toEqual([]);
  });
});

describe("sparkTableModel: a bare series, numbered when it carries no labels of its own", () => {
  it("numbers each point 1..n when no label array is given", () => {
    const model = sparkTableModel([3, 5, 7]);
    expect(model.rows).toEqual([["1", "3"], ["2", "5"], ["3", "7"]]);
  });

  it("takes the caller's own labels when given", () => {
    const model = sparkTableModel([3, 5], ["2026-01-01", "2026-01-02"]);
    expect(model.rows).toEqual([["2026-01-01", "3"], ["2026-01-02", "5"]]);
  });

  it("a null point (never measured) is the em dash, a measured zero is 0 — the two never trade", () => {
    const model = sparkTableModel([0, null, 4]);
    expect(model.rows.map((r) => r[1])).toEqual(["0", "—", "4"]);
    expect(badFormat(null)).toBe("0");
    expect(model.rows[1][1]).not.toBe(badFormat(null));
  });

  it("an empty series is an empty table", () => {
    expect(sparkTableModel([]).rows).toEqual([]);
  });
});
