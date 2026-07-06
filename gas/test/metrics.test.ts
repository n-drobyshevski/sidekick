import { describe, expect, it } from "vitest";
import { calculateMttr, overallSlaOldest } from "../src/domain/metrics";
import { expectParity, fixture } from "./helpers";

describe("calculateMttr (fixture parity)", () => {
  const fx = fixture("metrics");
  it("matches the Python per-severity and overall summary", () => {
    const { perSev, overall } = calculateMttr(fx.records, Date.parse(fx.now));
    expectParity(perSev, fx.expected.per_sev);
    expectParity(overall, fx.expected.overall);
  });
  it("matches overall_sla_oldest", () => {
    const { perSev } = calculateMttr(fx.records, Date.parse(fx.now));
    const { slaPct, oldestDays } = overallSlaOldest(perSev);
    expectParity(slaPct, fx.expected.overall_sla_oldest.sla_pct);
    expectParity(oldestDays, fx.expected.overall_sla_oldest.oldest_days);
  });
});

describe("calculateMttr edge cases", () => {
  it("returns empty without a first-seen column", () => {
    const fx = fixture("metrics_no_first_seen");
    const { perSev, overall } = calculateMttr(fx.records);
    expect(perSev).toEqual(fx.expected.per_sev);
    expect(overall).toEqual(fx.expected.overall);
  });
  it("returns empty for no records", () => {
    expect(calculateMttr([])).toEqual({ perSev: {}, overall: {} });
  });
});
