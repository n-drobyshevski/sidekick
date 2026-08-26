// The client's cube reader against the domain layer's, over the same cubes.
//
// There are deliberately two implementations — the browser cannot import TypeScript — so the
// only thing keeping them honest is this file. Chained with settingsImpact.test.ts (cube vs
// program.signalBreakdown over rows), it means the figure the classifier card shows while you
// drag the threshold is the same figure the Program page will show after you save.

import { describe, expect, it } from "vitest";
import {
  breakdownFromCube as jsBreakdown,
  epssHistogram as jsHistogram,
  ruleIsEmpty,
  ruleSentence as jsSentence,
} from "../src/client/js/riskCube.js";
import {
  breakdownFromCube as tsBreakdown,
  buildRiskCube,
  emptyCube,
  epssHistogram as tsHistogram,
} from "../src/domain/settingsImpact";
import { ruleSentence as tsSentence, signalBreakdown } from "../src/domain/program";

function population(n = 500, seed = 987) {
  let s = seed;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const u = rnd();
    rows.push({
      severity: "HIGH",
      status: "open",
      has_kev: u < 0.12 ? true : u < 0.8 ? false : null,
      has_exploit: rnd() < 0.25 ? true : rnd() < 0.88 ? false : null,
      // Include the exact endpoints; they are where the binning used to be wrong.
      epss: rnd() < 0.1 ? null : rnd() < 0.04 ? 1 : Math.round(rnd() * 100) / 100,
    });
  }
  return rows;
}

const rows = population();
const cube = buildRiskCube(rows);

const RULES = [
  { kev: true, exploit: true, epss: true, epssThreshold: 0.1 },
  { kev: true, exploit: false, epss: true, epssThreshold: 0.29 },
  { kev: false, exploit: true, epss: true, epssThreshold: 0.07 },
  { kev: false, exploit: false, epss: true, epssThreshold: 1 },
  { kev: true, exploit: true, epss: false, epssThreshold: 0.1 },
  { kev: false, exploit: false, epss: false, epssThreshold: 0.4 },
];

describe("the browser's cube reader matches the domain layer's", () => {
  for (const rule of RULES) {
    it(`agrees on ${JSON.stringify(rule)}`, () => {
      const js = jsBreakdown(cube, rule);
      const ts = tsBreakdown(cube, rule);
      // The client adds `total` for convenience; compare the shared keys.
      const { total, ...shared } = js;
      expect(shared).toEqual(ts);
      expect(total).toBe(cube.total);
    });
  }

  it("agrees at every 0.01 threshold, which is every value the control can produce", () => {
    for (let i = 0; i <= 100; i++) {
      const rule = { kev: true, exploit: true, epss: true, epssThreshold: i / 100 };
      const { total: _t, ...shared } = jsBreakdown(cube, rule);
      expect(shared, `threshold ${i / 100}`).toEqual(tsBreakdown(cube, rule));
    }
  });

  // The transitive link: the browser's figure is the one the Program page will report.
  it("matches signalBreakdown over the rows the cube was built from", () => {
    for (const rule of RULES) {
      const { total: _t, ...shared } = jsBreakdown(cube, rule);
      expect(shared, JSON.stringify(rule)).toEqual(signalBreakdown(rows, rule));
    }
  });

  it("agrees on the display histogram", () => {
    for (const buckets of [10, 20, 25]) {
      expect(jsHistogram(cube, buckets)).toEqual(tsHistogram(cube, buckets));
    }
  });
});

describe("degenerate inputs", () => {
  it("returns zeros rather than throwing when the payload never arrived", () => {
    const b = jsBreakdown(undefined, RULES[0]);
    expect(b).toMatchObject({ anyOf: 0, total: 0 });
    expect(jsHistogram(null, 20).buckets).toHaveLength(20);
  });

  it("handles an empty cube", () => {
    const empty = emptyCube();
    expect(jsBreakdown(empty, RULES[0]).anyOf).toBe(0);
    expect(jsHistogram(empty, 20).unmeasured).toBe(0);
  });
});

describe("ruleSentence", () => {
  it("words the rule exactly as the Program page does", () => {
    for (const rule of RULES) expect(jsSentence(rule)).toBe(tsSentence(rule));
  });

  it("says plainly that an empty rule enables nothing", () => {
    const off = { kev: false, exploit: false, epss: false, epssThreshold: 0.1 };
    expect(ruleIsEmpty(off)).toBe(true);
    expect(jsSentence(off)).toBe("no signal enabled");
  });
});
