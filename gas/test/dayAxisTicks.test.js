// THE LAST TWO DATES ON A TREND AXIS, PRINTED ON TOP OF EACH OTHER.
//
// `charts.js::dayAxis` sets `bounds: "data"` so the axis ends where the data ends — no invented
// empty space past the last scan. Chart.js's `generateTicks` honours that by anchoring the tick
// grid on the bounds themselves (`niceMin = rmin`, `niceMax = rmax`) and stepping from `rmin` by
// a nice `spacing`, then appending `rmax`. The final gap is therefore `span % spacing`: whatever
// the data leaves over, from 0 to a full step.
//
// Chart.js tries to catch the collision that creates and cannot, for a reason worth keeping: the
// generator merges the last stepped tick into `rmax` when the two are within
// `relativeLabelSize(max, minSpacing, …)`, and that size is `0.75 * minSpacing * ('' + value)
// .length` — measured on the RAW NUMBER. Our x values are epoch days, so `'' + 20704` is five
// characters while `fmtDay` paints "29-aug-2026", eleven. `autoSkip` is no help either: it
// measures real label widths but assumes ticks are EVENLY spaced, and the remainder tick is the
// one that is not.
//
// MEASURED on the dev harness at 2026-09-08, `#/mttr` → "Open vs resolved", 578px axis over
// 20494..20704: ticks [20494, 20544, 20594, 20644, 20694, 20704], gaps [50,50,50,50,10]. The
// 10-day remainder is 27px where the label is 68px, so the last two labels overprinted. The same
// shape was on `#/history` and `#/program`; "SLA quality" left a 52-day remainder on the same
// generator and read fine, which is what makes this the REMAINDER's defect and not the chart's.
//
// EVERY ARRAY BELOW IS A REAL MEASUREMENT off that harness, not a hand-built fixture — the
// windows were walked by clicking the timeframe control and reading `scale.ticks` back.

import { describe, expect, it } from "vitest";

import {
  DAY_LABEL_EMS, TICK_LABEL_GUTTER_PX, dayLabelPitchPx, dropRemainderTick,
} from "../src/client/js/charts.js";

/** `[{value}]` from a bare list of epoch days, the shape `generateTicks` hands over. */
const ticks = (...values) => values.map((value) => ({ value }));
const values = (list) => list.map((t) => t.value);

/** The axis font this app draws ticks in (`charts.js`'s own FONT.size). */
const FONT_PX = 12;
const PITCH = dayLabelPitchPx(FONT_PX);

/** Pixels per day for an axis `widthPx` wide showing `spanDays`. */
const pxPerDay = (widthPx, spanDays) => widthPx / spanDays;

// =========================================================================================
//  1. The measured label width, which every threshold here is derived from
// =========================================================================================

describe("dayLabelPitchPx: the width a fmtDay label actually needs", () => {
  it("is the measured 5.7 font sizes plus a gutter", () => {
    // measureText at 12px over the real labels gave 65.5px ("10-feb-2026") to 68.4px
    // ("29-aug-2026"). 5.7 * 12 = 68.4 — the widest, so the pitch clears every date.
    expect(DAY_LABEL_EMS * FONT_PX).toBeCloseTo(68.4, 5);
    expect(PITCH).toBeCloseTo(68.4 + TICK_LABEL_GUTTER_PX, 5);
  });

  it("scales with the font rather than pinning a pixel count", () => {
    expect(dayLabelPitchPx(24)).toBeCloseTo(2 * (PITCH - TICK_LABEL_GUTTER_PX)
      + TICK_LABEL_GUTTER_PX, 5);
  });
});

// =========================================================================================
//  2. The two windows that were broken, and the ones that never were
// =========================================================================================

describe("dropRemainderTick: the crowded neighbour goes, the data's own end stays", () => {
  it("drops it on the All window — the 27px gap that started this", () => {
    // #/mttr "Open vs resolved", 578px over 210 days.
    const before = ticks(20494, 20544, 20594, 20644, 20694, 20704);
    const after = dropRemainderTick(before, pxPerDay(578, 210), PITCH);

    expect(values(after)).toEqual([20494, 20544, 20594, 20644, 20704]);
    // The last tick — the data's own end, and where the plotted line visibly stops — survives.
    expect(after[after.length - 1].value).toBe(20704);
  });

  it("drops it on the 90d window, where a ratio rule would not have", () => {
    // 572px over 90 days: step 20, remainder 10 — ratio EXACTLY 0.5, so the first cut of this
    // fix (finalGap < step * 0.5) kept it. In pixels it is 63.6 under a 68.4px label, which is
    // still an overprint. This case is why the rule is measured in pixels.
    const before = ticks(20614, 20634, 20654, 20674, 20694, 20704);
    const gapPx = 10 * pxPerDay(572, 90);
    expect(gapPx).toBeLessThan(PITCH);
    expect(10 / 20).toBe(0.5); // the ratio that read as "clear enough"

    expect(values(dropRemainderTick(before, pxPerDay(572, 90), PITCH)))
      .toEqual([20614, 20634, 20654, 20674, 20704]);
  });

  it("leaves a remainder that is merely short but legible", () => {
    // #/mttr "SLA quality", All: gaps [50,50,50,52]. Chart.js had already merged its own last
    // tick, so there is nothing crowded here — and 52 days is 143px besides.
    const before = ticks(20502, 20552, 20602, 20652, 20704);
    expect(values(dropRemainderTick(before, pxPerDay(572, 202), PITCH)))
      .toEqual([20502, 20552, 20602, 20652, 20704]);
  });

  for (const [label, list, widthPx, span] of [
    ["60d", [20644, 20654, 20664, 20674, 20684, 20694, 20704], 572, 60],
    ["30d", [20674, 20679, 20684, 20689, 20694, 20699, 20704], 572, 30],
    ["2w", [20690, 20692, 20694, 20696, 20698, 20700, 20702, 20704], 576, 14],
    ["5d", [20699, 20700, 20701, 20702, 20703, 20704], 566, 5],
  ]) {
    it(`leaves the evenly stepped ${label} window untouched`, () => {
      const before = ticks(...list);
      expect(dropRemainderTick(before, pxPerDay(widthPx, span), PITCH)).toBe(before);
    });
  }
});

// =========================================================================================
//  3. Both conditions bite, and the guards refuse rather than throw
// =========================================================================================

describe("dropRemainderTick: what it refuses to touch", () => {
  it("never touches an axis whose final gap IS a full step, however crowded", () => {
    // Evenly spaced and far too tight for the labels — 8 ticks across 200px. That is autoSkip's
    // job and autoSkip does it correctly, because the spacing it assumes is the spacing there
    // is. Stepping in here would hand autoSkip the one thing it cannot model.
    const before = ticks(20690, 20692, 20694, 20696, 20698, 20700, 20702, 20704);
    expect(2 * pxPerDay(200, 14)).toBeLessThan(PITCH); // the real gap: 2 days = 29px
    expect(dropRemainderTick(before, pxPerDay(200, 14), PITCH)).toBe(before);
  });

  it("refuses anything too short to have a step", () => {
    expect(dropRemainderTick(ticks(20694, 20704), 3, PITCH)).toEqual(ticks(20694, 20704));
    expect(dropRemainderTick(ticks(20704), 3, PITCH)).toEqual(ticks(20704));
    expect(dropRemainderTick([], 3, PITCH)).toEqual([]);
    expect(dropRemainderTick(null, 3, PITCH)).toBeNull();
  });

  it("refuses a scale it cannot measure in, rather than guessing one", () => {
    const before = ticks(20494, 20544, 20594, 20644, 20694, 20704);
    for (const bad of [0, -1, NaN, Infinity, undefined, null]) {
      expect(dropRemainderTick(before, bad, PITCH), `pxPerUnit ${bad}`).toBe(before);
      expect(dropRemainderTick(before, 2.75, bad), `pitch ${bad}`).toBe(before);
    }
  });

  it("refuses a non-ascending or degenerate tick run", () => {
    const flat = ticks(20694, 20694, 20694);
    expect(dropRemainderTick(flat, 2.75, PITCH)).toBe(flat);
    const backwards = ticks(20704, 20694, 20684);
    expect(dropRemainderTick(backwards, 2.75, PITCH)).toBe(backwards);
  });
});

// =========================================================================================
//  4. PERTURBATION — each rejected rule, run against the case that rejected it
// =========================================================================================
//
// CLAUDE.md: "a guard that fires on nothing is a finding, not a pass." Both halves of the
// condition are reproduced here in their defective form, on the same measured input, so the
// failure each one causes is visible rather than described.

describe("dropRemainderTick: the rules that were tried and did not hold", () => {
  it("ratio-only would have shipped the 90d overprint", () => {
    // The first cut: drop when the final gap is under half the step. On 90d the ratio is
    // exactly 0.5, so it keeps a 63.6px gap under a 68.4px label.
    const ratioOnly = (list, minRatio = 0.5) => {
      const last = list[list.length - 1].value;
      const prev = list[list.length - 2].value;
      const step = prev - list[list.length - 3].value;
      return (last - prev) >= step * minRatio ? list : [...list.slice(0, -2), list[list.length - 1]];
    };
    const before = ticks(20614, 20634, 20654, 20674, 20694, 20704);

    expect(values(ratioOnly(before))).toEqual(values(before)); // kept — the defect
    expect(values(dropRemainderTick(before, pxPerDay(572, 90), PITCH))).not.toEqual(values(before));
  });

  it("pixels-only would thin an evenly stepped axis autoSkip already handles", () => {
    // Drop the `finalGap < step` half and a crowded-but-even axis loses a tick to this instead
    // of to autoSkip — an uneven gap manufactured where there was none.
    const pixelsOnly = (list, px, pitch) => {
      const last = list[list.length - 1].value;
      const prev = list[list.length - 2].value;
      return (last - prev) * px >= pitch ? list : [...list.slice(0, -2), list[list.length - 1]];
    };
    const even = ticks(20690, 20692, 20694, 20696, 20698, 20700, 20702, 20704);

    expect(values(pixelsOnly(even, pxPerDay(200, 14), PITCH))).toHaveLength(even.length - 1);
    expect(dropRemainderTick(even, pxPerDay(200, 14), PITCH)).toBe(even);
  });

  it("dropping the LAST tick instead would end the axis short of the series", () => {
    // The other way round: keep the stepped grid, drop the data's own end. The axis then stops
    // at 29-aug while the plotted line runs to 08-sep — a chart that looks cut off mid-series.
    const before = ticks(20494, 20544, 20594, 20644, 20694, 20704);
    const dropLast = before.slice(0, -1);

    expect(dropLast[dropLast.length - 1].value).toBe(20694);
    expect(20704 - 20694).toBe(10); // ten days of line drawn past the final label
    const kept = dropRemainderTick(before, pxPerDay(578, 210), PITCH);
    expect(kept[kept.length - 1].value).toBe(20704);
  });
});
