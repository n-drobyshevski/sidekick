// The client's P11 rank-cube reader against the domain layer's, over the same cubes.
//
// There are deliberately two implementations — the browser cannot import TypeScript — so the
// only thing keeping them honest is this file, in the shape of test/categoryCubeModel.test.js
// and gas/test/riskCube.test.js: it pins src/client/js/rankCubeModel.js against
// src/domain/settingsImpact.ts's P11 section so the histogram, the moved-count, the tau and the
// top-N carry-over the ranking panel shows while an operator edits a draft are the same figures
// a save would actually produce.

import { describe, expect, it } from "vitest";
import {
  parseRankTupleKey as jsParse,
  rankCubeTauB as jsTauB,
  rankCubeTopN as jsTopN,
  rankRowsMovedBeyond as jsMoved,
  rankScoreHistogram as jsHistogram,
  scoreFromTuple as jsScore,
} from "../src/client/js/rankCubeModel.js";
import {
  buildRankCube,
  parseRankTupleKey as tsParse,
  rankCubeTauB as tsTauB,
  rankCubeTopN as tsTopN,
  rankRowsMovedBeyond as tsMoved,
  rankScoreHistogram as tsHistogram,
  scoreFromTuple as tsScore,
} from "../src/domain/settingsImpact";
import { cleanRankRule, RANK_PRESET_V2 } from "../src/domain/rank";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = "2026-09-13T09:00:00Z";
const NOW_MS = Date.parse(NOW);
const RULE_IDS = Array.from({ length: 30 }, (_, i) => `rule-${i}`);
const TIERS = ["kev", "exploit", "epss", "none", "unknown", undefined];
const ADJACENCIES = ["DIRECT", "ADJACENT", "UNLINKED", undefined];

function population(n = 500, seed = 4242) {
  const rng = mulberry32(seed);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const tier = TIERS[Math.floor(rng() * TIERS.length)];
    rows.push({
      id: `row-${i}`,
      ruleId: RULE_IDS[Math.floor(rng() * RULE_IDS.length)],
      dueAt: rng() < 0.6
        ? new Date(NOW_MS + (rng() * 800 - 400) * 86400000).toISOString()
        : undefined,
      createdAt: rng() < 0.9
        ? new Date(NOW_MS - rng() * 700 * 86400000).toISOString()
        : undefined,
      exploitationTier: tier,
      epssPeak: tier === "epss" ? (rng() < 0.1 ? null : Math.round(rng() * 100) / 100) : null,
      aiAdjacency: ADJACENCIES[Math.floor(rng() * ADJACENCIES.length)],
    });
  }
  return rows;
}

const buildRule = cleanRankRule({
  ...RANK_PRESET_V2,
  ruleWeights: [
    { ruleId: RULE_IDS[0], weight: 1 },
    { ruleId: RULE_IDS[1], weight: 0.8 },
    { ruleId: RULE_IDS[2], weight: 0.6 },
  ],
  defaultRuleWeight: 0.5,
});

const rows = population();
const cube = buildRankCube(rows, buildRule, NOW);

function draftOf(rule) {
  return {
    shares: rule.shares,
    timeSource: rule.timeSource,
    exploitationWeights: rule.exploitationWeights,
    adjacencyWeights: rule.adjacencyWeights,
    epssThreshold: rule.epssThreshold,
  };
}

const RULES = [
  draftOf(buildRule),
  draftOf(cleanRankRule({ ...buildRule, timeSource: "dueAtOnly" })),
  draftOf(cleanRankRule({ ...buildRule, shares: { rule: 1, time: 0, exploitation: 0, adjacency: 0 } })),
  draftOf(cleanRankRule({ ...buildRule, shares: { rule: 0, time: 0, exploitation: 1, adjacency: 0 } })),
  draftOf(cleanRankRule({ ...buildRule, epssThreshold: 0.29 })),
  draftOf(cleanRankRule({ ...buildRule, adjacencyWeights: { DIRECT: 0.9, ADJACENT: 0.4, UNLINKED: 0.05 } })),
];

describe("the browser's rank-cube reader matches the domain layer's", () => {
  it("built a cube worth comparing — many distinct tuples populated", () => {
    expect(Object.keys(cube.cells).length).toBeGreaterThan(10);
    expect(cube.total).toBe(rows.length);
  });

  it("parseRankTupleKey agrees on every populated key", () => {
    for (const key of Object.keys(cube.cells)) {
      expect(jsParse(key)).toEqual(tsParse(key));
    }
  });

  it("scoreFromTuple agrees for every tuple, under every rule", () => {
    for (const rule of RULES) {
      for (const key of Object.keys(cube.cells)) {
        const tuple = jsParse(key);
        expect(jsScore(tuple, rule, cube), `${key} under ${JSON.stringify(rule)}`)
          .toBe(tsScore(tuple, rule, cube));
      }
    }
  });

  it("agrees on the score histogram, at several bucket counts", () => {
    for (const rule of RULES) {
      for (const buckets of [10, 20, 25]) {
        expect(jsHistogram(cube, rule, buckets)).toEqual(tsHistogram(cube, rule, buckets));
      }
    }
  });

  it("agrees on rows-moved-beyond, at several thresholds", () => {
    for (let i = 0; i < RULES.length - 1; i++) {
      for (const threshold of [0, 0.05, 0.1, 0.25, 0.5]) {
        expect(jsMoved(cube, RULES[i], RULES[i + 1], threshold), `threshold ${threshold}`)
          .toBe(tsMoved(cube, RULES[i], RULES[i + 1], threshold));
      }
    }
  });

  it("agrees on kendallTauB between every pair of rules", () => {
    for (let i = 0; i < RULES.length; i++) {
      for (let j = 0; j < RULES.length; j++) {
        const js = jsTauB(cube, RULES[i], RULES[j]);
        const ts = tsTauB(cube, RULES[i], RULES[j]);
        expect(js, `pair ${i},${j}`).toBeCloseTo(ts, 10);
      }
    }
  });

  it("agrees on top-N carry-over, at several N", () => {
    for (const n of [1, 5, 25, 50, 200, cube.total]) {
      const js = jsTopN(cube, RULES[0], RULES[2], n);
      const ts = tsTopN(cube, RULES[0], RULES[2], n);
      expect(js, `n=${n}`).toEqual(ts);
    }
  });
});

describe("degenerate inputs — say nothing rather than guess", () => {
  it("an absent cube draws nothing from every reader", () => {
    expect(jsHistogram(undefined, RULES[0])).toEqual([]);
    expect(jsHistogram(null, RULES[0])).toEqual([]);
    expect(jsMoved(undefined, RULES[0], RULES[1], 0.1)).toBeNull();
    expect(jsTauB(undefined, RULES[0], RULES[1])).toBeNull();
    expect(jsTopN(undefined, RULES[0], RULES[1], 50)).toBeNull();
  });

  it("an empty cube is zero rows everywhere, not an absent one", () => {
    const empty = buildRankCube([], buildRule, NOW);
    expect(jsHistogram(empty, RULES[0]).every((n) => n === 0)).toBe(true);
    expect(jsMoved(empty, RULES[0], RULES[1], 0)).toBe(0);
    expect(jsTauB(empty, RULES[0], RULES[1])).toBe(0);
    expect(jsTopN(empty, RULES[0], RULES[1], 50)).toEqual({
      n: 50, topA: 0, topB: 0, carryOver: { lo: 0, hi: 0 },
    });
  });
});
