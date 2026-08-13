// Pure view-model for the ledger capacity section (Data page) and the Settings storage panel.
// `.ts` importing a client `.js` works under vitest (no allowJs needed at runtime);
// capacityView is DOM-free.

import { describe, expect, it } from "vitest";
// @ts-expect-error — client module is plain JS, no d.ts
import { capacityState, capacityView } from "../src/client/js/capacity.js";

const LIMIT = 10_000_000;

const stats = (over: Record<string, unknown> = {}) => ({
  cellCount: 500_000,
  cellLimit: LIMIT,
  ledgerRowCells: 24,
  cellsByTab: [
    { name: "jobs", rows: 1000, cols: 14, cells: 14_000 },
    { name: "vuln_ledger", rows: 12_000, cols: 24, cells: 288_000 },
    { name: "resolved_episodes", rows: 8_000, cols: 15, cells: 120_000 },
  ],
  ...over,
});

describe("capacityState", () => {
  it("stays neutral below the warn line, so an ordinary ledger isn't painted as a problem", () => {
    expect(capacityState(0, LIMIT)).toBe("");
    expect(capacityState(5_999_999, LIMIT)).toBe("");
  });

  it("warns from 60% and escalates at 85%", () => {
    expect(capacityState(6_000_000, LIMIT)).toBe("warn");
    expect(capacityState(8_499_999, LIMIT)).toBe("warn");
    expect(capacityState(8_500_000, LIMIT)).toBe("bad");
    expect(capacityState(LIMIT, LIMIT)).toBe("bad");
  });

  it("has no opinion without a limit to measure against", () => {
    expect(capacityState(1000, 0)).toBe("");
  });
});

describe("capacityView", () => {
  it("reports the ratio and leaves the state neutral at ordinary usage", () => {
    const v = capacityView(stats());
    expect(v.pct).toBeCloseTo(5, 5);
    expect(v.free).toBe(9_500_000);
    expect(v.state).toBe("");
    expect(v.note).toBeNull();
  });

  it("expresses headroom in vulnerabilities, not cells", () => {
    // 9.5M free / 24 cells per ledger row. "3.9M cells free" is not a number anyone can act on.
    expect(capacityView(stats()).headroomVulns).toBe(395_833);
  });

  it("scales headroom to the live column count rather than a hardcoded row width", () => {
    expect(capacityView(stats({ ledgerRowCells: 28 })).headroomVulns).toBe(339_285);
  });

  it("orders tabs by size and shares them against what is used, not the ceiling", () => {
    const v = capacityView(stats());
    expect(v.tabs.map((t: { name: string }) => t.name)).toEqual([
      "vuln_ledger", "resolved_episodes", "jobs",
    ]);
    expect(v.tabs[0].share).toBeCloseTo(57.6, 1); // 288,000 of 500,000
    expect(v.tabs[2].share).toBeCloseTo(2.8, 1);
  });

  it("scales the bars against the largest tab so small tabs stay readable", () => {
    // Against the 10M ceiling every row would render as an identical hairline: the biggest
    // tab here is under 3% of the limit.
    const v = capacityView(stats());
    expect(v.tabs[0].barPct).toBe(100);
    expect(v.tabs[1].barPct).toBeCloseTo(41.7, 1);
  });

  it("carries an actionable note once the ledger is filling up", () => {
    expect(capacityView(stats({ cellCount: 7_000_000 })).note).toMatch(/retention window/i);
    expect(capacityView(stats({ cellCount: 9_000_000 })).note).toMatch(/refuses new rows/i);
  });

  it("degrades to the meter alone on a pre-rollout payload", () => {
    // cellsByTab / ledgerRowCells are additive; a stale cached entry omits both and must
    // collapse to null rather than rendering a breakdown of zeroes.
    const v = capacityView({ cellCount: 500_000, cellLimit: LIMIT });
    expect(v.tabs).toEqual([]);
    expect(v.headroomVulns).toBeNull();
    expect(v.pct).toBeCloseTo(5, 5);
  });

  it("survives an empty spreadsheet without dividing by zero", () => {
    const v = capacityView({ cellCount: 0, cellLimit: LIMIT, ledgerRowCells: 24, cellsByTab: [] });
    expect(v.pct).toBe(0);
    expect(v.tabs).toEqual([]);
    expect(v.headroomVulns).toBe(416_666);
  });

  it("clamps a spreadsheet somehow over the ceiling to a full bar", () => {
    const v = capacityView(stats({ cellCount: 11_000_000 }));
    expect(v.pct).toBe(100);
    expect(v.free).toBe(0);
    expect(v.headroomVulns).toBe(0);
  });
});
