// THE FAN OF SURVIVAL CURVES ON `#/mttr`, AND WHAT HAS TO BE TRUE OF EACH CARD.
//
// Ported from gas_devsecops/test/mttrFan.test.js. `test/mttrViews.test.js` owns the view
// models P1.1 brought over (`kmHalfLifeView`, `rateView`, `kmP90View`, `meterPctFor`,
// `rmstView`); the fan's own model is held here, and `test/kmPerSev.test.ts` holds the server
// end of "one estimate, two views".
//
// WHY A PURE VIEW MODEL AT ALL. This project's vitest run sets no `environment` (no jsdom, no
// `document`), so everything that can be WRONG about a card has to live outside the DOM half:
// which severities get a card, in what order, which are skipped, and what each card's caption
// SAYS. The caption is the load-bearing half — see the colour note below.
//
// COLOUR IS NEVER THE CUE. Six curves in one grid is where "severity never carries meaning by
// colour alone" (PRODUCT.md, Accessibility; DESIGN.md's severity palette) bites hardest: the
// red/orange/amber band sits 1.6 apart under deuteranopia. Each card therefore carries the
// severity badge (dot + word) and a caption that states the half-life in words, and it is the
// CAPTION this file pins, because a caption that silently became a dash would leave the colour
// doing the work alone.

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { severityCurvesView } from "../src/client/js/pages/mttr.js";

// `charts.js` takes its Chart.js constructor by INJECTION (`installChartRuntime`), not by
// static import — see that file's own header for why — so the harness here is a recorder
// handed to that seam rather than a `vi.mock("chart.js")`. `vi.resetModules()` is what puts
// this file in the isolated vitest project (vitest.config.ts's classifier reads the source),
// which matters because installing a runtime mutates module scope.
const state = vi.hoisted(() => ({ calls: [] }));
class FakeChart {
  constructor(canvas, config) {
    state.calls.push(config);
  }

  destroy() {}

  static register() {}

  static getChart() {
    return undefined;
  }
}
function fakeCanvas() {
  return {
    setAttribute() {},
    getContext: () => null,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  };
}
async function loadCharts() {
  vi.resetModules();
  state.calls = [];
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const charts = await import("../src/client/js/charts.js");
  charts.installChartRuntime(FakeChart, []);
  return charts;
}

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

const SRC = readFileSync(new URL("../src/client/js/pages/mttr.js", import.meta.url), "utf8");

/** A shipKM-narrowed curve, the shape `api.ts::shipKM` puts on the wire. */
function km(over) {
  return {
    curve: [{ t: 1, s: 0.9 }, { t: 7, s: 0.6 }, { t: 30, s: 0.4 }],
    median: 12,
    medianLowerBound: null,
    p90: 44,
    mean: 15,
    meanTruncated: false,
    restrictionTime: 30,
    events: 6,
    censored: 4,
    total: 10,
    ...over,
  };
}

// CRITICAL crosses half; HIGH never does (bound only); LOW is measured but slow. MEDIUM, INFO
// and UNKNOWN are absent from the payload entirely — the server only emits a severity that had
// rows, and this is the case that proves the view does not invent a card for the other three.
const REMEDIATION = {
  kmPerSev: {
    CRITICAL: km({ median: 5, medianLowerBound: null, events: 3, censored: 1, total: 4 }),
    HIGH: km({ median: null, medianLowerBound: 68, events: 1, censored: 3, total: 4 }),
    LOW: km({ median: 41, medianLowerBound: null, events: 2, censored: 0, total: 2 }),
  },
  kmMedianPerSev: { CRITICAL: 5, HIGH: null, LOW: 41 },
  kmLowerBoundPerSev: { CRITICAL: null, HIGH: 68, LOW: null },
};

describe("severityCurvesView — one card per severity that has a curve", () => {
  it("emits a card only for the severities the payload actually carries", () => {
    const cards = severityCurvesView(REMEDIATION, SEVERITIES);
    expect(cards.map((c) => c.sev)).toEqual(["CRITICAL", "HIGH", "LOW"]);
  });

  it("keeps severity order rather than the payload's key order", () => {
    // A payload whose keys arrived worst-last still draws worst-first: the fan is read as a
    // sequence, and a grid that ordered itself by whatever the server serialised would put LOW
    // at the top on one load and CRITICAL on the next.
    const shuffled = {
      kmPerSev: {
        LOW: REMEDIATION.kmPerSev.LOW,
        CRITICAL: REMEDIATION.kmPerSev.CRITICAL,
        HIGH: REMEDIATION.kmPerSev.HIGH,
      },
    };
    expect(severityCurvesView(shuffled, SEVERITIES).map((c) => c.sev))
      .toEqual(["CRITICAL", "HIGH", "LOW"]);
  });

  it("the caption says 'at least N' where the median is null and only a bound is real", () => {
    const cards = severityCurvesView(REMEDIATION, SEVERITIES);
    const high = cards.find((c) => c.sev === "HIGH");
    expect(high.caption).toContain("at least 68 days");
    expect(high.half.isLowerBound).toBe(true);
    // And the measured cases do NOT get the prefix — "at least 5 days" would be a weaker claim
    // than the one the estimator actually made.
    const crit = cards.find((c) => c.sev === "CRITICAL");
    expect(crit.caption).toContain("5 days");
    expect(crit.caption).not.toContain("at least");
    expect(crit.half.isLowerBound).toBe(false);
  });

  it("the caption prints the censoring split, so a card is never a curve with no denominator", () => {
    const cards = severityCurvesView(REMEDIATION, SEVERITIES);
    const high = cards.find((c) => c.sev === "HIGH");
    expect(high.caption).toContain("1 event,");
    expect(high.caption).toContain("3 censored");
    expect(cards.find((c) => c.sev === "CRITICAL").caption).toContain("3 events,");
  });

  it("says 'not measured' rather than printing an em dash where neither number exists", () => {
    // PRODUCT.md's corollary, on a card: never a zero, and never a dash, that means unknown.
    const cards = severityCurvesView({
      kmPerSev: {
        INFO: km({ median: null, medianLowerBound: null, events: 0, censored: 5, total: 5 }),
      },
    }, SEVERITIES);
    expect(cards).toHaveLength(1);
    expect(cards[0].caption).toContain("not measured");
    expect(cards[0].caption).not.toContain("—");
    expect(cards[0].half.measured).toBe(false);
  });

  it("skips a severity whose curve has no steps rather than drawing an empty axis", () => {
    // An axis with no staircase asserts "measured, and flat"; the severity simply had nothing
    // to plot. The stat maps still list it, which is why the filter reads the CURVE.
    const cards = severityCurvesView({
      kmPerSev: {
        CRITICAL: km({ curve: [] }),
        HIGH: km({ curve: null }),
        LOW: REMEDIATION.kmPerSev.LOW,
      },
      kmMedianPerSev: { CRITICAL: null, HIGH: null, LOW: 41 },
    }, SEVERITIES);
    expect(cards.map((c) => c.sev)).toEqual(["LOW"]);
  });

  // gas's OWN ADDITION to the ported model, and the reason for it: this register runs six
  // severities against gas_devsecops's practical three, and the summary table under the fan
  // lists a severity whether or not its curve has steps. A severity that vanished from the
  // grid while keeping its table row is an absence a reader reads as a broken chart, so it is
  // NAMED instead — the same rule as "not measured" one `it` above, applied to a whole card.
  it("names the severities it skipped, so a missing card is a stated fact and not a gap", () => {
    const cards = severityCurvesView({
      kmPerSev: {
        CRITICAL: km({ curve: [] }),
        HIGH: km({ curve: null }),
        LOW: REMEDIATION.kmPerSev.LOW,
      },
    }, SEVERITIES);
    expect(cards.skipped).toEqual(["CRITICAL", "HIGH"]);
    // And a fan with nothing skipped says nothing — an empty list, never a sentence about
    // zero severities.
    expect(severityCurvesView(REMEDIATION, SEVERITIES).skipped).toEqual([]);
  });

  it("hands on the SAME curve reference the chart is drawn from", () => {
    // ui/chartTable.js's one rule: the table and the canvas are built from one array, named
    // once. A view model that copied or re-derived the points would be the first place the two
    // could disagree.
    const cards = severityCurvesView(REMEDIATION, SEVERITIES);
    expect(cards[0].curve).toBe(REMEDIATION.kmPerSev.CRITICAL.curve);
  });

  it("degrades to no cards at all on an absent payload", () => {
    expect(severityCurvesView(null, SEVERITIES).map((c) => c.sev)).toEqual([]);
    expect(severityCurvesView({}, SEVERITIES).map((c) => c.sev)).toEqual([]);
    expect(severityCurvesView({ kmPerSev: {} }, SEVERITIES).skipped).toEqual([]);
  });
});

// =========================================================================================
//  The fan's own source shape, and the legend the wrapper draws
// =========================================================================================

describe("the fan is wired the way the rest of the page's charts are", () => {
  it("draws its cards with the shared survivalCurve wrapper, in a severity colour", () => {
    expect(SRC).toContain("charts.survivalCurve(");
    // The severity fills are READ OFF THE BOOTSTRAP PALETTE (`SEVERITY_COLORS`, api.ts), never
    // retyped here — CLAUDE.md: the severity palette is byte-identical across all four
    // surfaces, and a page-local hex is the one way that stops being true.
    expect(SRC).toMatch(/color:\s*boot\.palette\.colors\[/);
  });

  it("never hard-codes a severity hex on the page that draws six of them", () => {
    // The register's own severity fills live in src/domain/config.ts and reach the client
    // through `bootstrap.palette.colors`. A six-digit hex anywhere in this page would be a
    // seventh copy of a palette that already has four.
    expect(SRC).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("labels every card with the severity badge, so colour is never the only cue", () => {
    expect(SRC).toContain("sevBadge(card.sev)");
  });

  it("names the severity in the card's marker legend, never \"all\"", () => {
    // The register-wide curve's markers read "Median (KM, all)" — "all" meaning all findings,
    // closed and open. On a per-severity small multiple that word is false: the diamond on the
    // CRITICAL card is CRITICAL's own restricted mean, not the register's, and a legend that
    // misnames its own population is exactly the failure PRODUCT.md's sixth principle exists
    // to stop.
    return loadCharts().then((charts) => {
      charts.survivalCurve(
        fakeCanvas(),
        [{ t: 1, s: 0.9 }, { t: 30, s: 0.5 }],
        { median: 12, mean: 20 },
        { color: "#dc2626", subject: "for CRITICAL findings", scope: "CRITICAL" },
      );
      const cfg = state.calls[state.calls.length - 1];
      const labels = cfg.data.datasets.slice(1).map((d) => d.label);
      expect(labels).toEqual(["Median (KM, CRITICAL)", "Mean (KM · RMST, CRITICAL)"]);
      for (const l of labels) expect(l).not.toContain("all");
      // The staircase takes the severity fill; the markers stay brand ink whatever the line
      // is, because they mean "this is the Kaplan-Meier estimate" and that does not change
      // per card.
      expect(cfg.data.datasets[0].borderColor).toBe("#dc2626");
      expect(cfg.data.datasets[1].backgroundColor).toBe(charts.ACCENT);
    });
  });

  it("leaves the OVERALL curve's labels and ink byte-identical when no scope is named", () => {
    // The register-wide curve above the fan is estimated over all findings and must keep
    // saying so — and must keep drawing in the brand blue it always has.
    return loadCharts().then((charts) => {
      charts.survivalCurve(fakeCanvas(), [{ t: 1, s: 0.9 }], {
        naiveMedian: 5, median: 6, naiveMean: 8, mean: 9,
      });
      const cfg = state.calls[state.calls.length - 1];
      expect(cfg.data.datasets.slice(1).map((d) => d.label)).toEqual([
        "Median (closed)", "Median (KM, all)", "Mean (closed)", "Mean (KM · RMST, all)",
      ]);
      expect(cfg.data.datasets[0].borderColor).toBe(charts.ACCENT);
    });
  });

  it("never rewrites the closed-only markers, whose parenthetical is a method not a population", () => {
    // PERTURBATION (run 2026-09-07 on this branch, then reverted): `scopeSuffix: "all)"` was
    // added to the two naive markers as well, on the reasoning that every label should name
    // its severity. Observed: the closed-only markers came back as "Median (CRITICAL)" /
    // "Mean (CRITICAL)", which deletes the one word telling a reader they are the naive,
    // closed-only statistics sitting beside the Kaplan-Meier ones. Failure:
    //
    //   FAIL  test/mttrFan.test.js > ... > never rewrites the closed-only markers, whose
    //         parenthetical is a method not a population
    //     AssertionError: expected [ 'Median (CRITICAL)', …(3) ] to deeply equal
    //     [ 'Median (closed)', …(3) ]     -"Median (closed)"  +"Median (CRITICAL)"
    //
    //   Test Files  1 failed (1) ; Tests  1 failed | 15 passed (16)
    return loadCharts().then((charts) => {
      charts.survivalCurve(
        fakeCanvas(),
        [{ t: 1, s: 0.9 }],
        { naiveMedian: 5, median: 6, naiveMean: 8, mean: 9 },
        { scope: "CRITICAL" },
      );
      const cfg = state.calls[state.calls.length - 1];
      expect(cfg.data.datasets.slice(1).map((d) => d.label)).toEqual([
        "Median (closed)", "Median (KM, CRITICAL)",
        "Mean (closed)", "Mean (KM · RMST, CRITICAL)",
      ]);
    });
  });

  it("the page's own header no longer says the per-severity curve is withheld", () => {
    // The defect this package closed on the server side: `api.ts` said, in prose, that a curve
    // ships only where something plots it — and withheld the per-severity ones on that
    // reasoning. Something plots them now.
    const api = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
    expect(api).toContain("THE RULE IS \"A CURVE SHIPS WHERE SOMETHING PLOTS IT\"");
    expect(api).toContain("kmPerSev[s] = shipKM(k);");
  });
});
