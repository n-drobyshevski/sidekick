import { describe, expect, it } from "vitest";
import { calculateMttr, overallSlaOldest } from "../src/domain/metrics";
import { fixture } from "./helpers";

describe("calculateMttr (fixture parity)", () => {
  const fx = fixture("metrics");
  it("matches the Python per-severity and overall summary", () => {
    const { perSev, overall } = calculateMttr(fx.records, Date.parse(fx.now));
    expect(perSev).toMatchSnapshot("perSev");
    expect(overall).toMatchSnapshot("overall");
  });
  it("matches overall_sla_oldest", () => {
    const { perSev } = calculateMttr(fx.records, Date.parse(fx.now));
    const { slaPct, oldestDays } = overallSlaOldest(perSev);
    expect(slaPct).toMatchSnapshot("slaPct");
    expect(oldestDays).toMatchSnapshot("oldestDays");
  });
});

describe("calculateMttr edge cases", () => {
  it("returns empty without a first-seen column", () => {
    const fx = fixture("metrics_no_first_seen");
    const { perSev, overall } = calculateMttr(fx.records);
    expect(perSev).toMatchSnapshot("perSev");
    expect(overall).toMatchSnapshot("overall");
  });
  it("returns empty for no records", () => {
    expect(calculateMttr([])).toEqual({ perSev: {}, overall: {} });
  });
});
