// Monthly remediation capacity (domain/program.ts's capacity half): Mean Monthly Close
// Rate, net flow, the P2P v3 gaining / keeping-up / falling-behind verdict, and the two
// honesty flags — `partial` and `reconstructed`.
//
// WHAT THIS FILE IS NOT. The D5 brief asked for `gas/test/capacity.test.ts` ported. That
// file is about a different "capacity" entirely: it exercises `gas/src/client/js/capacity.js`,
// the Google Sheets CELL-BUDGET meter on the Data page (cellCount vs. cellLimit, headroom
// expressed in findings, per-tab bars). It imports no domain module, this register has no
// `src/client/js/capacity.js`, and none of its behaviour belongs to program.ts. Porting it
// here would have produced a green file that pins nothing about capacity metrics. So this
// file holds the capacity-METRIC suite instead: the `capacityByMonth` block lifted from
// gas/test/program.test.ts, plus the five brick cases the brief actually requires. The
// spreadsheet meter is a client-layer concern and should be ported with that layer.
//
// Sources, same two oracles as program.test.ts:
//   gas/test/program.test.ts::capacityByMonth  — hand-worked months, scan-delta cross-check
//   test/fixtures/brick/capacity.json          — brick/devsecops/metrics.py's PySpark output

import { describe, expect, it } from "vitest";
import {
  capacityByMonth,
  capacityPopulations,
  observationWindowDays,
  type Capacity,
  type RiskRow,
} from "../src/domain/program";
import {
  DEFAULT_RISK_RULE,
  NET_CAPACITY_BAND_PCT,
  POPULATION_ALL,
  POPULATION_HIGH_RISK,
  type RiskRule,
} from "../src/domain/config";
import { normalizeSeverity } from "../src/domain/severity";
import { brickFixture, expectParity } from "./helpers";

const RULE: RiskRule = DEFAULT_RISK_RULE;

type CapRow = RiskRow & { first_seen: string | null; resolved_at: string | null };

function row(over: Partial<CapRow> = {}): CapRow {
  return {
    scope: "sca",
    severity: "HIGH",
    status: "OPEN",
    has_kev: false,
    has_exploit: false,
    epss: 0.01,
    cwe: null,
    ai_verdict: null,
    first_seen: null,
    resolved_at: null,
    ...over,
  };
}

describe("capacityByMonth", () => {
  const NOW = Date.parse("2026-04-10T00:00:00Z");
  const cap = (over: Partial<CapRow> & { first_seen: string; resolved_at: string | null }) =>
    row(over);
  // One scan in January, so nothing is flagged reconstructed from February on. `shape` is
  // gas/'s flat-vs-grouped column; this register's scan log has none, and the grouped row
  // below is here only to pin that a gas-shaped log still reads identically.
  const scans = [
    { ts: "2026-01-02T00:00:00Z", shape: "flat", resolved_count: 0 },
    { ts: "2026-02-02T00:00:00Z", shape: "flat", resolved_count: 1 },
    { ts: "2026-03-02T00:00:00Z", shape: "flat", resolved_count: 2 },
    { ts: "2026-03-03T00:00:00Z", shape: "grouped", resolved_count: 99 }, // never counted
  ];

  const rows = [
    // Opened January, closed February.
    cap({ first_seen: "2026-01-05T00:00:00Z", resolved_at: "2026-02-10T00:00:00Z" }),
    // Opened January, closed March.
    cap({ first_seen: "2026-01-06T00:00:00Z", resolved_at: "2026-03-10T00:00:00Z" }),
    // Opened January, still open.
    cap({ first_seen: "2026-01-07T00:00:00Z", resolved_at: null }),
    // Opened March, still open.
    cap({ first_seen: "2026-03-20T00:00:00Z", resolved_at: null }),
  ];
  const out = capacityByMonth(rows, scans, { rule: RULE, now: NOW });

  it("buckets by UTC calendar month from the earliest first_seen to now", () => {
    expect(out.months.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });

  it("counts opened, closed, and the backlog open at each month start", () => {
    const [jan, feb, mar, apr] = out.months;
    expect(jan!.opened).toBe(3);
    expect(jan!.closed).toBe(0);
    expect(jan!.openAtStart).toBe(0); // nothing existed before January
    expect(feb!.openAtStart).toBe(3);
    expect(feb!.closed).toBe(1);
    expect(feb!.mmcr).toBeCloseTo(33.3333333, 6); // 1 of 3
    expect(mar!.openAtStart).toBe(2);
    expect(mar!.opened).toBe(1);
    expect(mar!.closed).toBe(1);
    expect(apr!.openAtStart).toBe(2);
  });

  it("flags the current month partial and pre-first-scan months reconstructed", () => {
    const byKey = Object.fromEntries(out.months.map((m) => [m.month, m]));
    expect(byKey["2026-04"]!.partial).toBe(true);
    expect(byKey["2026-03"]!.partial).toBe(false);
    // January ends after the 2026-01-02 scan, so it is directly observed.
    expect(byKey["2026-01"]!.reconstructed).toBe(false);
  });

  it("excludes the partial current month from the mean close rate", () => {
    // Only February and March are complete, observed, and had an open backlog:
    //   Feb 1/3 = 33.333%, Mar 1/2 = 50%  ->  mean 41.666%
    expect(out.monthsCounted).toBe(2);
    expect(out.mmcrMean).toBeCloseTo(41.6666667, 6);
    expect(out.oneInN).toBeCloseTo(2.4, 6);
  });

  it("carries the scan-delta cross-check and ignores grouped scans", () => {
    const byKey = Object.fromEntries(out.months.map((m) => [m.month, m]));
    expect(byKey["2026-02"]!.scanClosed).toBe(1);
    expect(byKey["2026-03"]!.scanClosed).toBe(2); // the grouped scan's 99 is excluded
    expect(byKey["2026-04"]!.scanClosed).toBeNull(); // no scans ran that month
  });

  it("excludes the first scan from the cross-check", () => {
    // The first reconcile counts every already-resolved finding the API returns as a
    // resolution, whenever it was really fixed — a different question from "closed this
    // month", and including it makes January's cross-check look wildly wrong.
    const byKey = Object.fromEntries(out.months.map((m) => [m.month, m]));
    expect(byKey["2026-01"]!.scanClosed).toBeNull();
    const withBigFirst = capacityByMonth(
      rows,
      [{ ts: "2026-01-02T00:00:00Z", shape: "flat", resolved_count: 500 }, ...scans.slice(1)],
      { rule: RULE, now: NOW },
    );
    expect(withBigFirst.months.find((m) => m.month === "2026-01")!.scanClosed).toBeNull();
  });

  it("gives the P2P v3 verdict from net flow", () => {
    const byKey = Object.fromEntries(out.months.map((m) => [m.month, m]));
    expect(byKey["2026-02"]!.net).toBe(1); // closed 1, opened 0
    expect(byKey["2026-02"]!.verdict).toBe("gaining");
    expect(byKey["2026-03"]!.net).toBe(0); // closed 1, opened 1
    expect(byKey["2026-03"]!.verdict).toBe("keeping-up");
  });

  it("keeps a dead band around zero so one finding cannot flip a verdict", () => {
    // 100 open at the start of February, one closed and none opened: net +1%, inside the
    // +/-2 point band, so the month reads "keeping up" rather than "gaining ground".
    const hundred = Array.from({ length: 100 }, (_, i) =>
      cap({
        first_seen: "2026-01-05T00:00:00Z",
        resolved_at: i === 0 ? "2026-02-10T00:00:00Z" : null,
      }),
    );
    const feb = capacityByMonth(hundred, scans, { rule: RULE, now: NOW }).months.find(
      (m) => m.month === "2026-02",
    )!;
    expect(feb.netPct).toBeCloseTo(1, 9);
    expect(NET_CAPACITY_BAND_PCT).toBe(2);
    expect(feb.verdict).toBe("keeping-up");
  });

  it("restricts to the high-risk population when asked", () => {
    const mixed = [
      cap({ first_seen: "2026-01-05T00:00:00Z", resolved_at: "2026-02-10T00:00:00Z", has_kev: true }),
      cap({ first_seen: "2026-01-06T00:00:00Z", resolved_at: "2026-02-11T00:00:00Z" }), // low
    ];
    const all = capacityByMonth(mixed, scans, { rule: RULE, now: NOW });
    const high = capacityByMonth(mixed, scans, { rule: RULE, highRiskOnly: true, now: NOW });
    expect(all.months.find((m) => m.month === "2026-02")!.closed).toBe(2);
    expect(high.months.find((m) => m.month === "2026-02")!.closed).toBe(1);
  });

  it("returns an empty result rather than throwing on an empty register", () => {
    const empty = capacityByMonth([], scans, { rule: RULE, now: NOW });
    expect(empty.months).toEqual([]);
    expect(empty.mmcrMean).toBeNull();
    expect(empty.verdict).toBeNull();
  });

  it("drops rows with no birth date rather than dating them from nothing", () => {
    const out2 = capacityByMonth([row({ first_seen: null })], scans, { rule: RULE, now: NOW });
    expect(out2.months).toEqual([]);
  });

  it("caps the series to the trailing maxMonths, most recent last", () => {
    const trimmed = capacityByMonth(rows, scans, { rule: RULE, now: NOW, maxMonths: 2 });
    expect(trimmed.months.map((m) => m.month)).toEqual(["2026-03", "2026-04"]);
    // The summary still describes the whole series — trimming is a display concern.
    expect(trimmed.monthsCounted).toBe(2);
    expect(trimmed.mmcrMean).toBeCloseTo(41.6666667, 6);
  });
});

describe("observationWindowDays", () => {
  it("measures from the earliest birth date to now", () => {
    const now = Date.parse("2026-03-02T00:00:00Z");
    // 2026-01-31 -> 2026-03-02 is 30 days (Jan) + 1 (Feb has 28 in 2026, so 28) ... stated
    // as the arithmetic it actually is: (now - first) / 86_400_000.
    const first = "2026-01-31T00:00:00Z";
    const expected = (now - Date.parse(first)) / 86_400_000;
    expect(expected).toBe(30); // 1 day left of January + 28 of February + 1 of March
    expect(observationWindowDays([{ first_seen: first }, { first_seen: "2026-02-10T00:00:00Z" }], now))
      .toBeCloseTo(30, 9);
  });

  it("has no window at all when nothing carries a date", () => {
    expect(observationWindowDays([], Date.now())).toBeNull();
    expect(observationWindowDays([{ first_seen: null }], Date.now())).toBeNull();
  });
});

// =======================================================================================
//  brick/devsecops parity — capacity.json
// =======================================================================================
//
// NAME MAPPING, brick snake_case -> this module's camelCase:
//
//   brick column        this module
//   ------------------  -----------------------------------------------------------------
//   month               CapacityMonth.month, as "YYYY-MM"; brick emits the month's first
//                       instant ("2026-04-01T00:00:00Z"). Mapped by appending "-01T00:00:00Z"
//                       rather than truncating the expectation, so a wrong month cannot pass.
//   open_at_start       CapacityMonth.openAtStart
//   net_pct             CapacityMonth.netPct
//   closed_observed     CapacityMonth.scanClosed  (gas/'s name for the same cross-check)
//   mmcr_mean           Capacity.mmcrMean         \
//   months_counted      Capacity.monthsCounted     |  brick cross-joins the summary onto
//   net_total           Capacity.netTotal          |  every month row; here it lives once
//   one_in_n            Capacity.oneInN            |  on the Capacity object.
//   overall_verdict     Capacity.verdict          /
//   population          the CapacityPopulations key: "all" -> .all, "high_risk" -> .highRisk
//
//   PARAMETERS
//   now                 CapacityOptions.now (epoch ms)
//   observed_from       CapacityOptions.observedFrom   (null = no horizon)
//   high_risk_only      CapacityOptions.highRiskOnly
//   closed_observed     CapacityOptions.closedObserved, as a month-keyed Record
//
// NOTHING IS UNMAPPED: every column of brick's capacity frame is asserted above, and every
// field this module publishes appears in one of the rows below. `maxMonths` is the one
// option with no brick counterpart — it is a display cap gas/ added and brick has no
// notion of, so it is pinned by hand in the block above instead.

type BrickCapRow = Record<string, unknown>;

function brickRows(cap: Capacity, population?: string): BrickCapRow[] {
  return cap.months.map((m) => {
    const out: BrickCapRow = {
      month: `${m.month}-01T00:00:00Z`,
      opened: m.opened,
      closed: m.closed,
      open_at_start: m.openAtStart,
      mmcr: m.mmcr,
      net: m.net,
      net_pct: m.netPct,
      partial: m.partial,
      verdict: m.verdict,
      reconstructed: m.reconstructed,
      closed_observed: m.scanClosed,
      mmcr_mean: cap.mmcrMean,
      months_counted: cap.monthsCounted,
      net_total: cap.netTotal,
      one_in_n: cap.oneInN,
      overall_verdict: cap.verdict,
    };
    if (population !== undefined) out["population"] = population;
    return out;
  });
}

/** brick's silver projection of a CVE node, with the two lifecycle dates capacity reads. */
function fromCveNode(n: Record<string, any>): CapRow {
  return {
    scope: "sca",
    severity: normalizeSeverity(n["severity"]),
    status: n["status"],
    has_kev: n["hasCisaKevExploit"] ?? null,
    has_exploit: n["hasExploit"] ?? null,
    epss: n["epssProbability"] ?? null,
    cwe: null,
    ai_verdict: null,
    first_seen: n["firstDetectedAt"] ?? null,
    resolved_at: n["resolvedAt"] ?? null,
  };
}

/** The exporter's `(month, closed_observed)` frame as the Record the option takes. */
function closedObservedRecord(rows: Record<string, any>[] | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows ?? []) out[String(r["month"])] = Number(r["closed_observed"]);
  return out;
}

describe("brick parity — capacity.json", () => {
  const cases = brickFixture<{ cases: any[] }>("capacity").cases;
  const byName = Object.fromEntries(cases.map((c) => [c.name, c]));

  it("covers exactly the five cases the exporter dumps", () => {
    expect(cases.map((c) => c.name)).toEqual([
      "by_month_no_horizon",
      "by_month_observed_from",
      "by_month_high_risk_only",
      "by_month_closed_observed",
      "populations",
    ]);
  });

  /** The four single-population cases: same nodes, four different parameter sets. */
  for (const name of [
    "by_month_no_horizon",
    "by_month_observed_from",
    "by_month_high_risk_only",
    "by_month_closed_observed",
  ]) {
    it(`agrees with Spark on ${name}`, () => {
      const c = byName[name]!;
      const rows: CapRow[] = c.input.nodes.map(fromCveNode);
      const actual = capacityByMonth(rows, [], {
        rule: DEFAULT_RISK_RULE,
        now: Date.parse(c.params.now),
        observedFrom: c.params.observed_from,
        highRiskOnly: c.params.high_risk_only,
        closedObserved: closedObservedRecord(c.input.closed_observed),
      });
      expectParity(brickRows(actual), c.expected, 1e-9);
    });
  }

  it("agrees with Spark on capacity_populations, both halves", () => {
    const c = byName["populations"]!;
    const rows: CapRow[] = c.input.nodes.map(fromCveNode);
    const pops = capacityPopulations(rows, [], {
      rule: DEFAULT_RISK_RULE,
      now: Date.parse(c.params.now),
      observedFrom: c.params.observed_from,
      closedObserved: closedObservedRecord(c.input.closed_observed),
    });
    // brick stacks the two populations and orders by (population, month): "all" then
    // "high_risk", alphabetically as it happens.
    expectParity(
      [...brickRows(pops.all, POPULATION_ALL), ...brickRows(pops.highRisk, POPULATION_HIGH_RISK)],
      c.expected,
      1e-9,
    );
  });

  it("withholds the reconcile cross-check from the high-risk half", () => {
    // Not incidental. `closed_observed` is reconcile's own resolution count and reconcile
    // does not label risk, so against the high-risk rows it would compare two different
    // populations — worse than no cross-check. brick passes None there and so does this.
    const c = byName["populations"]!;
    const rows: CapRow[] = c.input.nodes.map(fromCveNode);
    const pops = capacityPopulations(rows, [], {
      rule: DEFAULT_RISK_RULE,
      now: Date.parse(c.params.now),
      observedFrom: c.params.observed_from,
      closedObserved: closedObservedRecord(c.input.closed_observed),
    });
    expect(pops.all.months.some((m) => m.scanClosed !== null)).toBe(true);
    expect(pops.highRisk.months.every((m) => m.scanClosed === null)).toBe(true);
  });

  it("reads every month as observed when there is no horizon at all", () => {
    // DIVERGENCE from gas/, pinned here because it is the one place the two upstreams
    // disagree on a value rather than a name: gas/ flags every month `reconstructed` when it
    // finds no scan; brick flags none, on the argument that there is nothing to have missed
    // if nothing was ever watched. brick is this register's spec and `by_month_no_horizon`
    // pins it — 4 months, none reconstructed, and mmcrMean therefore counts 2 of them.
    const c = byName["by_month_no_horizon"]!;
    const rows: CapRow[] = c.input.nodes.map(fromCveNode);
    const out = capacityByMonth(rows, [], {
      rule: DEFAULT_RISK_RULE,
      now: Date.parse(c.params.now),
      observedFrom: null,
    });
    expect(out.months.every((m) => !m.reconstructed)).toBe(true);
    expect(out.monthsCounted).toBe(2);
    // ...and with a horizon in June, April and May drop out of the mean: 1 month counted.
    const horizoned = capacityByMonth(rows, [], {
      rule: DEFAULT_RISK_RULE,
      now: Date.parse(c.params.now),
      observedFrom: "2026-06-01T00:00:00Z",
    });
    expect(horizoned.months.map((m) => m.reconstructed)).toEqual([true, true, false, false]);
    expect(horizoned.monthsCounted).toBe(1);
  });
});
