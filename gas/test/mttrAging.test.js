// "OPEN FINDINGS BY AGE" ON `#/mttr`, AND WHAT HAS TO BE TRUE OF THE SECTION.
//
// Ported from gas_devsecops/test/mttrAging.test.js. Its section 5 ("SLA window consumed") does
// NOT port — this register has no deciles chart on the MTTR page (overview.js draws one, and
// its own model is not this one's), so porting those describes would be checking for a section
// that was never here.
//
// This project's vitest run sets no `environment` (no jsdom, no `document`), so everything
// that can be WRONG about the section lives in the pure view model: which severities are drawn,
// whether the row totals still add up to the bucketed population, what the SLA edge SAYS per
// severity, and whether a rule is drawn at all.
//
// THE EDGE IS THE LOAD-BEARING HALF, AND IT IS WORDS BEFORE IT IS A LINE.
// `charts.js::stackedAgeBar` takes ONE `slaEdgeAfter` index, and `SLA_TARGETS` is five
// different deadlines (7 / 14 / 30 / 90 / 180 d) landing in four different buckets. A single
// dashed rule over six stacked series would therefore be a claim about five severities that is
// true of one. `agingView` emits `edgeAfter` only when every severity drawn agrees AND that
// shared bucket is an exact boundary; otherwise the legend line and the table's "Past SLA for"
// column carry it — which is also the non-colour route to the fact, per PRODUCT.md's
// accessibility bar.
//
// WHY THE TOTALS MATTER. The register's other aging table (`pages/_charts.js`'s
// `agingTableModel`) deliberately has NO total column, because a null bucket count would have
// to be summed as a zero to produce one. `agingView`'s own `row.total` is dense by
// construction — `agingDistribution` ships a four-number tuple per severity — so the total is
// real, and the view returns null for the WHOLE row rather than a partial sum if a cell ever
// arrives absent.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { agingView, slaEdgeLegend } from "../src/client/js/pages/mttr.js";

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

  it("the bars cover totalOpen and the undated remainder is OUTSIDE them, never inside", () => {
    // `totalOpen` is the BUCKETED count, not the open population — `agingDistribution`'s own
    // doc states `totalOpen + unaged` is the open population, and the section prints the
    // remainder rather than letting the bars quietly cover fewer rows than the hero does.
    const vm = agingView(remediation({ unaged: 7 }), ORDER);
    expect(vm.rows.reduce((n, r) => n + r.total, 0)).toBe(56);
    expect(vm.unaged).toBe(7);
    expect(vm.denominator).toContain("7 further open findings");
  });

  it("lists exactly the severities the chart will draw, and in severity order", () => {
    // `stackedAgeBar` filters its datasets with `palette.order.filter((s) => perSev[s])`; a
    // column for LOW here would be a column with no bar beside it.
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
    // CLAUDE.md's `Number(null)` rule. A row missing one severity's count is a row whose total
    // was never measured; `fmtCount(null)` then prints the em dash the chart's gap already
    // implies.
    const vm = agingView(
      remediation({ perSev: { CRITICAL: [4, null, 1, 5], HIGH: [10, 8, 6, 16] } }),
      ORDER,
    );
    expect(vm.rows[1].total).toBeNull();
    expect(vm.rows[0].total).toBe(14);
  });

  // PERTURBATION. The tempting rewrite is the arithmetic-shaped one: sum the row with
  // `Number(v) || 0` so the column is always a number and never a dash. Reproduced here over
  // the SAME payload the `it` above uses, so the difference is visible rather than described.
  it("is not a vacuous guard — the cast-through sum prints a confident 14 where the row was never measured", () => {
    const payload = remediation({
      perSev: { CRITICAL: [4, null, 1, 5], HIGH: [10, 8, 6, 16] },
    });
    const bucket = 1; // the 8-30d row, whose CRITICAL cell is null

    // The rewrite: cast each cell and let a falsy one fall to zero.
    const castThrough = ["CRITICAL", "HIGH"]
      .reduce((n, sev) => n + (Number(payload.aging.perSev[sev][bucket]) || 0), 0);
    expect(castThrough).toBe(8);
    expect(Number.isFinite(castThrough)).toBe(true);

    // The guard: one unmeasured cell poisons the whole total, because the sum of a
    // measurement and an absence is an absence.
    expect(agingView(payload, ORDER).rows[bucket].total).toBeNull();

    // And it is not merely that null is falsy — every absent shape CLAUDE.md names does it,
    // which is why the view refuses BEFORE the cast rather than after.
    for (const absent of [null, undefined, "", [], false]) {
      expect(Number(absent) || 0, `Number(${JSON.stringify(absent)}) || 0`).toBe(0);
      const poisoned = agingView(
        remediation({ perSev: { CRITICAL: [4, absent, 1, 5] } }), ORDER,
      );
      expect(poisoned.rows[bucket].total, JSON.stringify(absent)).toBeNull();
    }
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
    // CRITICAL's edge is bucket 0, so 8-30d onward is wholly late for it; HIGH and MEDIUM sit
    // at bucket 1, so only 31-90d onward is.
    expect(vm.rows.map((r) => r.breaches)).toEqual([
      [],
      ["CRITICAL"],
      ["CRITICAL", "HIGH", "MEDIUM"],
      ["CRITICAL", "HIGH", "MEDIUM"],
    ]);
  });

  it("draws NO single rule when the severities disagree about where the edge is", () => {
    // CRITICAL at bucket 0 and HIGH/MEDIUM at bucket 1: one line would be wrong for two of the
    // three series.
    expect(agingView(remediation(), ORDER).edgeAfter).toBeNull();
  });

  it("draws no rule either when the shared bucket is not an exact boundary", () => {
    // HIGH alone: 14 d is inside 8-30d, so a line at the END of that bar would put late
    // findings on the in-SLA side of it. `slaEdgeExact` is the only field that distinguishes
    // this case from the one below, which is why the server ships it.
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
    expect(vm.denominator).toContain("measured from first detection to now");
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
  it("hands the wrapper the same arrays the table model was built from", () => {
    // ui/chartTable.js's one rule: named once at the call site, handed to both. The model is
    // `agingTableModel(vm.labels, vm.perSev, …)` and the wrapper is
    // `charts.stackedAgeBar(canvas, vm.labels, vm.perSev, …)`.
    expect(SRC).toContain("agingTableModel(vm.labels, vm.perSev, vm.sevs, \"Age bucket\")");
    expect(SRC).toMatch(/vm\.labels,\s*\n\s*vm\.perSev,/);
    expect(SRC).toContain("charts.stackedAgeBar(");
  });

  it("draws EXACTLY the severities the table lists, by handing the wrapper its own order", () => {
    // `stackedAgeBar` filters with `palette.order.filter((s) => perSev[s])`, so handing it the
    // whole bootstrap order and the table `vm.sevs` would be two filters that agree today and
    // could stop agreeing. One list, both places.
    expect(SRC).toContain("{ order: vm.sevs, colors: boot.palette.colors }");
  });

  it("stops at the first-run notice rather than stacking a heading over an empty box", () => {
    // MEASURED at `?noseed#/mttr` before this gate: the page drew the first-run notice and
    // then a "Distribution" heading and an "Open findings by age" heading, each over its own
    // empty box — three answers to one question, two of them phrased as measurements ("no
    // open findings to age yet") about a register nobody has read. `renderCharts` has made
    // this same `!mttr.rowCount` test since it was written; all four sections make it now.
    const gated = SRC.match(/if \(!mttr\.rowCount\) return;/g) || [];
    expect(gated.length).toBeGreaterThanOrEqual(4);
    for (const fn of ["renderFan", "renderAging", "renderSurvivalCurve"]) {
      const at = SRC.indexOf("function " + fn + "(mttr)");
      expect(at, fn + " not found").toBeGreaterThan(-1);
      expect(SRC.slice(at, at + 1400), fn + " draws before its first-run return")
        .toContain("if (!mttr.rowCount) return;");
    }
  });

  it("reads the SLA targets off the payload rather than restating five numbers", () => {
    // `test/riskLadderSync.test.ts` polices overview.js's own hand-copied `SLA_TARGETS_DAYS`
    // for exactly this reason; the aging section takes the targets from `aging.slaTargets`, so
    // there is no second copy on this page to police.
    expect(SRC).toContain("slaEdgeLegend(vm.edges)");
    expect(SRC).not.toContain("SLA_TARGETS_DAYS");
  });
});

// =========================================================================================
//  5. The legend line the section draws instead of five sentences
// =========================================================================================

describe("slaEdgeLegend: the deadlines come from the payload, and a missing one says so", () => {
  it("prints every severity in the order the bars are stacked, with its own target", () => {
    const vm = agingView(remediation(), ORDER);
    expect(slaEdgeLegend(vm.edges)).toBe("CRITICAL 7 d · HIGH 14 d · MEDIUM 30 d");
  });

  it("follows an edited deadline rather than a literal", () => {
    const moved = slaEdgeLegend([{ sev: "CRITICAL", target: 3 }, { sev: "HIGH", target: 21 }]);
    expect(moved).toBe("CRITICAL 3 d · HIGH 21 d");
    expect(moved).not.toContain("7 d");
  });

  it("says \"no target\" for a severity with no deadline, and never \"null d\"", () => {
    const line = slaEdgeLegend([
      { sev: "CRITICAL", target: 7 }, { sev: "UNKNOWN", target: null },
    ]);
    expect(line).toBe("CRITICAL 7 d · UNKNOWN no target");
    expect(line).not.toMatch(/null|undefined|NaN/);
    // No target is exactly WHY that severity has no edge — dropping the row would delete the
    // finding rather than report it.
    expect(line).toContain("UNKNOWN");
  });

  it("draws no legend at all where there are no bars", () => {
    expect(slaEdgeLegend([])).toBeNull();
    expect(slaEdgeLegend(null)).toBeNull();
    expect(slaEdgeLegend(undefined)).toBeNull();
  });
});
