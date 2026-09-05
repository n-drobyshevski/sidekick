// "OPEN FINDINGS BY AGE" ON `#/mttr`, AND WHAT HAS TO BE TRUE OF THE SECTION.
//
// This project's vitest run sets no `environment` (no jsdom, no `document`), so everything
// that can be WRONG about the section lives in the pure view model: which severities are
// drawn, whether the row totals still add up to the bucketed population, what the SLA edge
// SAYS per severity, and whether a rule is drawn at all.
//
// THE EDGE IS THE LOAD-BEARING HALF, AND IT IS WORDS BEFORE IT IS A LINE.
// `charts.js::stackedAgeBar` takes ONE `slaEdgeAfter` index, and `SLA_TARGETS` is five
// different deadlines (7 / 14 / 30 / 90 / 180 d) landing in four different buckets. A single
// dashed rule over six stacked series would therefore be a claim about five severities that
// is true of one. `agingView` emits `edgeAfter` only when every severity drawn agrees AND
// that shared bucket is an exact boundary; otherwise the per-severity sentences and the
// table's "Past SLA for" column carry it — which is also the non-colour route to the fact,
// per PRODUCT.md's accessibility bar.
//
// WHY THE TOTALS MATTER. The register's other aging table (`sca.js::agingTableModel`)
// deliberately has NO total column, because a null bucket count would have to be summed as a
// zero to produce one. Here the columns are dense by construction — `agingDistribution`
// ships a four-number tuple per severity — so the total is real, and `agingView` returns
// null for the whole row rather than a partial sum if a cell ever arrives absent.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { agingView } from "../src/client/js/pages/mttr.js";

const SRC = readFileSync(new URL("../src/client/js/pages/mttr.js", import.meta.url), "utf8");

const ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

/** A `remediation` payload carrying the server's `aging` block. */
function remediation(over = {}) {
  return {
    aging: {
      labels: ["0-7d", "8-30d", "31-90d", "90+d"],
      perSev: {
        CRITICAL: [4, 2, 1, 5],
        HIGH: [10, 8, 6, 16],
        MEDIUM: [1, 0, 0, 3],
      },
      unaged: 0,
      totalOpen: 56,
      slaEdge: { CRITICAL: 0, HIGH: 1, MEDIUM: 1 },
      slaTargets: { CRITICAL: 7, HIGH: 14, MEDIUM: 30 },
      slaEdgeExact: { CRITICAL: true, HIGH: false, MEDIUM: true },
      ...over,
    },
  };
}

// =========================================================================================
//  1. The table is the chart's own arrays
// =========================================================================================

describe("agingView builds one row per bucket, and the rows add up", () => {
  it("emits one row per label, in the order the chart draws them", () => {
    const vm = agingView(remediation(), ORDER);
    expect(vm.rows.map((r) => r.label)).toEqual(["0-7d", "8-30d", "31-90d", "90+d"]);
  });

  it("row totals sum to totalOpen — the bucketed open population, entire", () => {
    const vm = agingView(remediation(), ORDER);
    expect(vm.rows.map((r) => r.total)).toEqual([15, 10, 7, 24]);
    expect(vm.rows.reduce((n, r) => n + r.total, 0)).toBe(vm.totalOpen);
    expect(vm.totalOpen).toBe(56);
  });

  it("lists exactly the severities the chart will draw, and in severity order", () => {
    // `stackedAgeBar` filters its datasets with `order.filter((s) => perSev[s])`; a column for
    // LOW here would be a column with no bar beside it.
    const vm = agingView(remediation(), ORDER);
    expect(vm.sevs).toEqual(["CRITICAL", "HIGH", "MEDIUM"]);
  });

  it("keeps UNKNOWN when the server sent it, appended after the ordered severities", () => {
    const vm = agingView(
      remediation({
        perSev: { HIGH: [1, 1, 1, 1], UNKNOWN: [0, 2, 0, 0] },
        slaEdge: { HIGH: 1, UNKNOWN: null },
        slaTargets: { HIGH: 14, UNKNOWN: null },
        slaEdgeExact: { HIGH: false, UNKNOWN: false },
        totalOpen: 6,
      }),
      ORDER,
    );
    expect(vm.sevs).toEqual(["HIGH", "UNKNOWN"]);
    expect(vm.rows.map((r) => r.total)).toEqual([1, 3, 1, 1]);
  });

  it("refuses a partial total rather than summing an absent cell as a zero", () => {
    // CLAUDE.md's `Number(null)` rule. A row missing one severity's count is a row whose
    // total was never measured; `fmtCount(null)` then prints the em dash the chart's gap
    // already implies.
    const vm = agingView(
      remediation({ perSev: { CRITICAL: [4, null, 1, 5], HIGH: [10, 8, 6, 16] } }),
      ORDER,
    );
    expect(vm.rows[1].total).toBeNull();
    expect(vm.rows[0].total).toBe(14);
  });

  it("falls back to the four canonical labels if the payload carries none", () => {
    const vm = agingView(remediation({ labels: undefined }), ORDER);
    expect(vm.labels).toEqual(["0-7d", "8-30d", "31-90d", "90+d"]);
    expect(vm.rows).toHaveLength(4);
  });
});

// =========================================================================================
//  2. The SLA edge, per severity
// =========================================================================================

describe("the edge is stated per severity, in words", () => {
  it("names each deadline, its bucket, and whether that bucket is clean", () => {
    const vm = agingView(remediation(), ORDER);
    const byS = Object.fromEntries(vm.edges.map((e) => [e.sev, e]));
    expect(byS.CRITICAL.sentence)
      .toBe("CRITICAL deadline 7 d falls at the end of the first bucket — everything to its"
        + " right is late.");
    // 14 d lands INSIDE 8-30d, so that bar is part in and part out. The two sentences differ
    // because the facts do; one wording for both would be wrong for one of them.
    expect(byS.HIGH.sentence)
      .toBe("HIGH deadline 14 d falls inside the 8-30d bucket — that bucket is part in, part"
        + " out, and everything to its right is late.");
    expect(byS.MEDIUM.sentence)
      .toBe("MEDIUM deadline 30 d falls at the end of the 8-30d bucket — everything to its"
        + " right is late.");
  });

  it("says so plainly when a severity has no target, instead of inventing one", () => {
    const vm = agingView(
      remediation({
        perSev: { UNKNOWN: [1, 0, 0, 0] },
        slaEdge: { UNKNOWN: null },
        slaTargets: { UNKNOWN: null },
        slaEdgeExact: { UNKNOWN: false },
        totalOpen: 1,
      }),
      ORDER,
    );
    expect(vm.edges[0].sentence).toBe("UNKNOWN has no SLA target, so no edge is stated for it.");
    expect(vm.edges[0].bucket).toBeNull();
    expect(vm.rows.every((r) => r.breaches.length === 0)).toBe(true);
  });

  it("marks a bucket as breached only for the severities wholly past their deadline", () => {
    const vm = agingView(remediation(), ORDER);
    // CRITICAL's edge is bucket 0, so 8-30d onward is wholly late for it; HIGH and MEDIUM
    // sit at bucket 1, so only 31-90d onward is.
    expect(vm.rows.map((r) => r.breaches)).toEqual([
      [],
      ["CRITICAL"],
      ["CRITICAL", "HIGH", "MEDIUM"],
      ["CRITICAL", "HIGH", "MEDIUM"],
    ]);
  });

  it("draws NO single rule when the severities disagree about where the edge is", () => {
    // CRITICAL at bucket 0 and HIGH/MEDIUM at bucket 1: one line would be wrong for two of
    // the three series.
    expect(agingView(remediation(), ORDER).edgeAfter).toBeNull();
  });

  it("draws no rule either when the shared bucket is not an exact boundary", () => {
    // HIGH alone: 14 d is inside 8-30d, so a line at the END of that bar would put late
    // findings on the in-SLA side of it.
    const vm = agingView(
      remediation({
        perSev: { HIGH: [3, 3, 3, 3] },
        slaEdge: { HIGH: 1 },
        slaTargets: { HIGH: 14 },
        slaEdgeExact: { HIGH: false },
        totalOpen: 12,
      }),
      ORDER,
    );
    expect(vm.edgeAfter).toBeNull();
  });

  it("draws the rule when every severity drawn agrees AND the boundary is exact", () => {
    // MEDIUM (30 d) and LOW (90 d) do not agree; MEDIUM alone does, and 30 IS a bucket edge.
    const vm = agingView(
      remediation({
        perSev: { MEDIUM: [2, 2, 2, 2] },
        slaEdge: { MEDIUM: 1 },
        slaTargets: { MEDIUM: 30 },
        slaEdgeExact: { MEDIUM: true },
        totalOpen: 8,
      }),
      ORDER,
    );
    expect(vm.edgeAfter).toBe(1);
  });
});

// =========================================================================================
//  3. The caption, the unaged remainder, and the empty case
// =========================================================================================

describe("the section says where its clock started and what it could not measure", () => {
  it("states the origin and that it counts open rows only", () => {
    const vm = agingView(remediation(), ORDER);
    expect(vm.denominator).toContain("measured from first_seen to now");
    expect(vm.denominator).toContain("56 open findings");
    expect(vm.denominator).toContain("Resolved findings are not in this chart");
  });

  it("prints the unaged count when there is one, and stays silent when there is not", () => {
    // "Absent is never zero", and its mirror: an undated open finding is not a young one, so
    // the remainder is a sentence rather than a bar.
    expect(agingView(remediation({ unaged: 3 }), ORDER).denominator)
      .toContain("3 further open findings carry no first-seen date");
    expect(agingView(remediation({ unaged: 1 }), ORDER).denominator)
      .toContain("1 further open finding carries no first-seen date and is bucketed nowhere.");
    expect(agingView(remediation({ unaged: 0 }), ORDER).denominator)
      .not.toContain("first-seen date");
  });

  it("hides itself only when there is nothing open at all — bucketed OR undated", () => {
    expect(agingView(remediation({ perSev: {}, totalOpen: 0, unaged: 0 }), ORDER).show)
      .toBe(false);
    // The case that must NOT hide: every open finding is undated. Hiding here would erase the
    // one fact the section exists to report.
    const undated = agingView(
      remediation({ perSev: { HIGH: [0, 0, 0, 0] }, totalOpen: 0, unaged: 12 }),
      ORDER,
    );
    expect(undated.show).toBe(true);
    expect(undated.denominator).toContain("12 further open findings");
  });

  it("survives a payload with no aging block at all, without throwing", () => {
    for (const input of [undefined, null, {}, { aging: null }]) {
      const vm = agingView(input, ORDER);
      expect(vm.show).toBe(false);
      expect(vm.rows).toHaveLength(4);
      expect(vm.sevs).toEqual([]);
    }
  });
});

// =========================================================================================
//  4. The section's source shape
// =========================================================================================

describe("the section is wired the way the rest of the page's charts are", () => {
  // The register-wide canvas total moved 9 -> 10 in test/chartTable.test.js for this section;
  // the per-file "one chartTable per canvas" rule there is what holds the pairing. Restated
  // here as a source claim so a canvas added to this section without its table shows up in
  // the file that owns the section too.
  it("creates exactly one canvas and one chartTable for the section", () => {
    const canvases = (SRC.match(/el\("canvas"/g) || []).length;
    const tables = (SRC.match(/\bchartTable\(\{/g) || []).length;
    // Four on this page: the overall survival curve, the per-severity fan card, the
    // half-life trend, and this one. `chartTable(` is counted with its opening brace to
    // match the shape ui/chartTable.js is always called with.
    expect(canvases).toBe(4);
    expect(tables).toBe(4);
    expect(SRC).toContain("charts.stackedAgeBar(");
  });

  it("hands the wrapper the same arrays the table model was built from", () => {
    // ui/chartTable.js's one rule: named once at the call site, handed to both.
    expect(SRC).toMatch(/vm\.labels,\s*\n\s*vm\.perSev,/);
  });

  it("reads the severity fills off the stylesheet and never spends the accent as ink", () => {
    expect(SRC).toContain("sevPalette(vm.sevs)");
    // DESIGN.md's Split-Accent Rule: #ffcb13 is 1.52:1 and carries fills only.
    expect(SRC).not.toContain("#ffcb13");
    expect(SRC).not.toContain("var(--accent)");
  });
});
