// kmCurve went from a scan per distinct event time (O(distinct × n)) to one sort and one sweep —
// the same loop gas/ measured at 19 s per curve in production (#320). The rewrite is only
// allowed to be FASTER: every published median, quantile and RMST is read off this curve, so it
// must answer bit-for-bit what the old implementation did. The old one is kept here verbatim as
// the oracle.
import { describe, expect, it } from "vitest";
import { kmCurve } from "../src/domain/remediation";

function kmCurveReference(events: number[], times: number[]) {
  const curve: { t: number; s: number; atRisk: number; events: number }[] = [];
  let s = 1;
  for (const t of [...new Set(events)].sort((a, b) => a - b)) {
    const atRisk = times.filter((x) => x >= t).length;
    if (atRisk === 0) continue;
    const d = events.filter((x) => x === t).length;
    s *= 1 - d / atRisk;
    curve.push({ t, s, atRisk, events: d });
  }
  return curve;
}

// Deterministic PRNG so a failure reproduces.
function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("kmCurve (sort and sweep)", () => {
  it("matches the reference exactly on random registers with ties and censoring", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const n = Math.floor(r() * 400);
      const events: number[] = [];
      const times: number[] = [];
      for (let i = 0; i < n; i++) {
        // Half on a coarse grid (ties), half fractional (the production shape).
        const v = r() < 0.5 ? Math.floor(r() * 20) : r() * 300;
        if (r() < 0.6) { events.push(v); times.push(v); } else times.push(v);
      }
      expect(kmCurve(events, times)).toEqual(kmCurveReference(events, times));
    }
  });

  it("matches the reference on the edge values", () => {
    const cases: [number[], number[]][] = [
      [[], []],
      [[1, 2], []],
      [[], [1, 2]],
      [[NaN, 1, NaN], [NaN, 1, 2]],
      [[Infinity, 1], [Infinity, 1, 5]],
      [[-0, 0, 1], [0, 0, 1]],
      [[3, 3, 3], [3, 3, 3]],
      [[5], [1, 2]], // an event past every time is never at risk
    ];
    for (const [e, t] of cases) expect(kmCurve(e, t)).toEqual(kmCurveReference(e, t));
  });

  it("is linearithmic: 60k rows with thousands of distinct times in well under a second", () => {
    const r = rng(7);
    const events: number[] = [];
    const times: number[] = [];
    for (let i = 0; i < 60_000; i++) {
      const v = r() * 700;
      times.push(v);
      if (i % 3 === 0) events.push(v);
    }
    const t0 = performance.now();
    kmCurve(events, times);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
