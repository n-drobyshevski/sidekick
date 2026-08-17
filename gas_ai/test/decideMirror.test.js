// decideMirror.js re-walks the SAME cascade src/domain/problem.ts and src/domain/posture.ts
// walk, in plain JS, so the lattice can repaint on a keystroke instead of a debounced round
// trip — see decideMirror.js's own header. This is the contract that keeps that claim true:
// every exported vocabulary, every enumeration order, every match predicate and every
// coverage tally is run through both the mirror and the TS domain over the full 54/27-leaf
// space, a battery of crafted edge-case rules, and a seeded fuzz loop, and required to
// agree bit-for-bit. A `.js` test file importing a `.ts` module is fine — see
// configViewMirror.test.js's own header for why; `tsconfig.json` has no `allowJs`, so this
// file must stay `.js`, never `.ts`, or `tsc --noEmit` fails before vitest ever runs.

import { describe, it, expect } from "vitest";
import * as mirror from "../src/client/js/decideMirror.js";
import * as tsProblem from "../src/domain/problem";
import * as tsProblemRule from "../src/domain/problemRule";
import * as tsPosture from "../src/domain/posture";
import * as tsPostureRule from "../src/domain/postureRule";

// --------------------------------------------------------------------------- fuzz plumbing

// mulberry32 — small, dependency-free, deterministic for a given seed. No Math.random
// anywhere in this file: a fuzz failure has to reproduce on every run or it is useless as a
// regression guard.
function mulberry32(seed) {
  let s = seed | 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function randomProblemRule(rng) {
  const rowCount = Math.floor(rng() * 8); // 0..7 rows, including the empty-cascade case
  const outcomeRules = [];
  for (let i = 0; i < rowCount; i++) {
    const when = {};
    if (rng() < 0.5) when.exploitation = pick(rng, tsProblem.EXPLOITATION_VALUES);
    if (rng() < 0.5) when.impact = pick(rng, tsProblem.IMPACT_VALUES);
    if (rng() < 0.5) when.exposure = pick(rng, tsProblem.EXPOSURE_VALUES);
    if (rng() < 0.5) when.mission = pick(rng, tsProblem.MISSION_VALUES);
    outcomeRules.push({ when, outcome: pick(rng, tsProblem.OUTCOME_VALUES) });
  }
  return {
    outcomeRules,
    fallbackOutcome: pick(rng, tsProblem.OUTCOME_VALUES),
    exploitationByRuleId: [],
    remediateVerdicts: ["REMEDIATE"],
    totalImpactGroups: [],
    missingMission: "MEDIUM",
    actLeafCeiling: 1,
  };
}

function randomPostureRule(rng) {
  const rowCount = Math.floor(rng() * 8);
  const tierRules = [];
  for (let i = 0; i < rowCount; i++) {
    const when = {};
    if (rng() < 0.5) when.capability = pick(rng, tsPosture.CAPABILITY_VALUES);
    if (rng() < 0.5) when.containment = pick(rng, tsPosture.CONTAINMENT_VALUES);
    if (rng() < 0.5) when.consequence = pick(rng, tsPosture.CONSEQUENCE_VALUES);
    // Occasionally name a trifecta leg too — both sides must agree these rows claim
    // nothing, exactly as often as they occur.
    if (rng() < 0.15) when.privateData = rng() < 0.5;
    if (rng() < 0.15) when.untrustedIngress = rng() < 0.5;
    if (rng() < 0.15) when.externalEgress = rng() < 0.5;
    tierRules.push({ when, tier: pick(rng, tsPosture.TIER_VALUES) });
  }
  return { tierRules, fallbackTier: pick(rng, tsPosture.TIER_VALUES), topTierCeiling: 1 };
}

// -------------------------------------------------------------------------------- vocabulary

describe("vocabulary agrees with the TS domain", () => {
  it("problem axis and outcome value lists are identical arrays", () => {
    expect(mirror.EXPLOITATION_VALUES).toEqual([...tsProblem.EXPLOITATION_VALUES]);
    expect(mirror.IMPACT_VALUES).toEqual([...tsProblem.IMPACT_VALUES]);
    expect(mirror.EXPOSURE_VALUES).toEqual([...tsProblem.EXPOSURE_VALUES]);
    expect(mirror.MISSION_VALUES).toEqual([...tsProblem.MISSION_VALUES]);
    expect(mirror.OUTCOME_VALUES).toEqual([...tsProblem.OUTCOME_VALUES]);
  });

  it("posture axis and tier value lists are identical arrays", () => {
    expect(mirror.CAPABILITY_VALUES).toEqual([...tsPosture.CAPABILITY_VALUES]);
    expect(mirror.CONTAINMENT_VALUES).toEqual([...tsPosture.CONTAINMENT_VALUES]);
    expect(mirror.CONSEQUENCE_VALUES).toEqual([...tsPosture.CONSEQUENCE_VALUES]);
    expect(mirror.TIER_VALUES).toEqual([...tsPosture.TIER_VALUES]);
  });
});

// ---------------------------------------------------------------------------- enumeration

describe("enumeration order agrees with the TS domain", () => {
  it("enumerateDecisionVectors agrees element-for-element, including order", () => {
    expect(mirror.enumerateDecisionVectors()).toEqual(tsProblem.enumerateDecisionVectors());
  });

  it("enumeratePostureVectors agrees element-for-element, including order", () => {
    expect(mirror.enumeratePostureVectors()).toEqual(tsPosture.enumeratePostureVectors());
  });

  it("leafKey agrees with problem.ts for every one of the 54 vectors", () => {
    for (const v of tsProblem.enumerateDecisionVectors()) {
      expect(mirror.leafKey(v)).toBe(tsProblem.leafKey(v));
    }
  });

  it("postureKey agrees with posture.ts for every one of the 27 vectors", () => {
    for (const v of tsPosture.enumeratePostureVectors()) {
      expect(mirror.postureKey(v)).toBe(tsPosture.postureKey(v));
    }
  });
});

// -------------------------------------------------------------------------- match predicates

describe("vectorMatches / postureVectorMatches are literal ports of the TS predicates", () => {
  const problemWhens = [
    {},
    { exploitation: "ACTIVE" },
    { mission: "LOW" },
    { exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "HIGH" },
    { impact: "PARTIAL", exposure: "UNVERIFIED" },
  ];

  it("agrees with problem.vectorMatches across a spread of whens, for every vector", () => {
    for (const v of tsProblem.enumerateDecisionVectors()) {
      for (const w of problemWhens) {
        expect(mirror.vectorMatches(v, w)).toBe(tsProblem.vectorMatches(v, w));
      }
    }
  });

  const postureWhens = [
    {},
    { capability: "BROAD" },
    { containment: "WEAK", consequence: "SEVERE" },
    // The trifecta case this file's header calls out by name: both spellings of "not
    // true" must be equally unreachable, and the mirror must agree with the TS domain
    // that they are.
    { privateData: true },
    { privateData: false },
    { privateData: true, untrustedIngress: true, externalEgress: true },
  ];

  it("agrees with posture.postureVectorMatches across a spread of whens, for every vector", () => {
    for (const v of tsPosture.enumeratePostureVectors()) {
      for (const w of postureWhens) {
        expect(mirror.postureVectorMatches(v, w)).toBe(tsPosture.postureVectorMatches(v, w));
      }
    }
  });
});

// ---------------------------------------------------------------------------- crafted rules

// DEFAULT_PROBLEM_RULE plus six well-formed crafted rules — every `when` here is already
// in-vocabulary, so decideProblem's internal cleanWhen is a no-op and the mirror can be
// compared directly against tsProblem.decideProblem (no cleanProblemRule needed on either
// side). The junk/out-of-vocabulary case gets its own dedicated section below.
const PROBLEM_CRAFTED_RULES = [
  tsProblemRule.DEFAULT_PROBLEM_RULE,
  { // empty rule list — every vector must fall back
    outcomeRules: [], fallbackOutcome: "TRACK", exploitationByRuleId: [],
    remediateVerdicts: [], totalImpactGroups: [], missingMission: "MEDIUM", actLeafCeiling: 1,
  },
  { // a leading all-wildcard `when` swallows everything after it
    outcomeRules: [
      { when: {}, outcome: "ATTEND" },
      { when: { exploitation: "ACTIVE" }, outcome: "ACT" },
    ],
    fallbackOutcome: "TRACK", exploitationByRuleId: [],
    remediateVerdicts: [], totalImpactGroups: [], missingMission: "MEDIUM", actLeafCeiling: 1,
  },
  { // duplicate `when`s — the first must win every time, the second must claim nothing
    outcomeRules: [
      { when: { exploitation: "ACTIVE" }, outcome: "ACT" },
      { when: { exploitation: "ACTIVE" }, outcome: "ATTEND" },
      { when: {}, outcome: "TRACK" },
    ],
    fallbackOutcome: "TRACK", exploitationByRuleId: [],
    remediateVerdicts: [], totalImpactGroups: [], missingMission: "MEDIUM", actLeafCeiling: 1,
  },
  { // a `when` naming only the last-declared axis
    outcomeRules: [
      { when: { mission: "LOW" }, outcome: "TRACK_STAR" },
      { when: {}, outcome: "TRACK" },
    ],
    fallbackOutcome: "TRACK", exploitationByRuleId: [],
    remediateVerdicts: [], totalImpactGroups: [], missingMission: "MEDIUM", actLeafCeiling: 1,
  },
  { // a longer mixed cascade exercising several axis combinations at once
    outcomeRules: [
      { when: { exploitation: "ACTIVE", impact: "TOTAL" }, outcome: "ACT" },
      { when: { exposure: "OPEN", mission: "HIGH" }, outcome: "ATTEND" },
      { when: { exposure: "UNVERIFIED" }, outcome: "TRACK_STAR" },
      { when: { mission: "MEDIUM" }, outcome: "TRACK_STAR" },
    ],
    fallbackOutcome: "TRACK", exploitationByRuleId: [],
    remediateVerdicts: [], totalImpactGroups: [], missingMission: "MEDIUM", actLeafCeiling: 1,
  },
  { // a single wildcard row — every vector routes through row 0, fallback never fires
    outcomeRules: [{ when: {}, outcome: "TRACK" }],
    fallbackOutcome: "ACT", exploitationByRuleId: [],
    remediateVerdicts: [], totalImpactGroups: [], missingMission: "MEDIUM", actLeafCeiling: 1,
  },
];

const POSTURE_CRAFTED_RULES = [
  tsPostureRule.DEFAULT_POSTURE_RULE,
  { // empty rule list
    tierRules: [], fallbackTier: 2, topTierCeiling: 1,
  },
  { // leading all-wildcard
    tierRules: [
      { when: {}, tier: 2 },
      { when: { capability: "BROAD" }, tier: 4 },
    ],
    fallbackTier: 1, topTierCeiling: 1,
  },
  { // duplicate whens
    tierRules: [
      { when: { containment: "WEAK" }, tier: 4 },
      { when: { containment: "WEAK" }, tier: 3 },
      { when: {}, tier: 1 },
    ],
    fallbackTier: 1, topTierCeiling: 1,
  },
  { // a `when` naming only the last-declared axis
    tierRules: [
      { when: { consequence: "LIMITED" }, tier: 1 },
      { when: {}, tier: 2 },
    ],
    fallbackTier: 2, topTierCeiling: 1,
  },
  { // a longer mixed cascade
    tierRules: [
      { when: { capability: "BROAD", containment: "WEAK" }, tier: 4 },
      { when: { consequence: "SEVERE" }, tier: 3 },
      { when: { capability: "MINIMAL" }, tier: 1 },
    ],
    fallbackTier: 2, topTierCeiling: 1,
  },
  { // trifecta row alongside ordinary rows — must claim zero cells, never shadow anything real
    tierRules: [
      { when: { privateData: true, untrustedIngress: true, externalEgress: true }, tier: 4 },
      { when: { capability: "BROAD" }, tier: 3 },
      { when: {}, tier: 1 },
    ],
    fallbackTier: 1, topTierCeiling: 1,
  },
];

describe("decideProblem agrees with problem.ts across all 54 vectors, for every crafted rule", () => {
  const vectors = tsProblem.enumerateDecisionVectors();
  it.each(PROBLEM_CRAFTED_RULES.map((rule, i) => [i, rule]))("rule %i", (_i, rule) => {
    for (const v of vectors) {
      expect(mirror.decideProblem(v, rule)).toEqual(tsProblem.decideProblem(v, rule));
    }
  });
});

describe("decidePosture agrees with posture.ts across all 27 vectors, for every crafted rule", () => {
  const vectors = tsPosture.enumeratePostureVectors();
  it.each(POSTURE_CRAFTED_RULES.map((rule, i) => [i, rule]))("rule %i", (_i, rule) => {
    for (const v of vectors) {
      expect(mirror.decidePosture(v, rule)).toEqual(tsPosture.decidePosture(v, rule));
    }
  });
});

describe("leafCoverage / cellCoverage deep-equal the TS originals", () => {
  it.each(PROBLEM_CRAFTED_RULES.map((rule, i) => [i, rule]))("problem rule %i", (_i, rule) => {
    expect(mirror.leafCoverage(rule)).toEqual(tsProblemRule.leafCoverage(rule));
  });

  it.each(POSTURE_CRAFTED_RULES.map((rule, i) => [i, rule]))("posture rule %i", (_i, rule) => {
    expect(mirror.cellCoverage(rule)).toEqual(tsPostureRule.cellCoverage(rule));
  });
});

// ------------------------------------------------------------------- the trifecta zero-claim

describe("a privateData leg named either way claims zero cells, on both sides", () => {
  it("privateData:true and privateData:false each claim zero of 27", () => {
    const trueRule = {
      tierRules: [{ when: { privateData: true }, tier: 4 }, { when: {}, tier: 1 }],
      fallbackTier: 1, topTierCeiling: 1,
    };
    const falseRule = {
      tierRules: [{ when: { privateData: false }, tier: 4 }, { when: {}, tier: 1 }],
      fallbackTier: 1, topTierCeiling: 1,
    };

    const mirrorTrue = mirror.cellCoverage(trueRule);
    const mirrorFalse = mirror.cellCoverage(falseRule);
    expect(mirrorTrue.byRow[0]).toBe(0);
    expect(mirrorFalse.byRow[0]).toBe(0);
    expect(mirrorTrue).toEqual(tsPostureRule.cellCoverage(trueRule));
    expect(mirrorFalse).toEqual(tsPostureRule.cellCoverage(falseRule));
  });
});

// --------------------------------------------------------------------- junk when, raw + clean

describe("an out-of-vocabulary value and a junk key, checked raw AND through cleanProblemRule", () => {
  const rawRule = {
    outcomeRules: [
      // "BOGUS" is not an Exploitation, "junkKey" is not an axis at all — cleanWhen must
      // drop both, turning this row into "mission: HIGH" alone (a wildcard on every other
      // axis), not into an unsatisfiable row.
      { when: { exploitation: "BOGUS", junkKey: "nope", mission: "HIGH" }, outcome: "ACT" },
      { when: {}, outcome: "TRACK" },
    ],
    fallbackOutcome: "TRACK", exploitationByRuleId: [],
    remediateVerdicts: [], totalImpactGroups: [], missingMission: "MEDIUM", actLeafCeiling: 1,
  };
  const cleanedRule = tsProblemRule.cleanProblemRule(rawRule);
  const vectors = tsProblem.enumerateDecisionVectors();

  it("the mirror's internal cleaning matches feeding the already-cleaned rule to the TS domain", () => {
    for (const v of vectors) {
      expect(mirror.decideProblem(v, rawRule)).toEqual(tsProblem.decideProblem(v, cleanedRule));
    }
  });

  it("cleaning is idempotent: mirror and TS agree on the already-cleaned rule directly too", () => {
    for (const v of vectors) {
      expect(mirror.decideProblem(v, cleanedRule)).toEqual(tsProblem.decideProblem(v, cleanedRule));
    }
  });

  it("leafCoverage over the raw rule (mirror cleans internally) equals TS's coverage of the cleaned rule", () => {
    expect(mirror.leafCoverage(rawRule)).toEqual(tsProblemRule.leafCoverage(cleanedRule));
  });
});

describe("posture: an out-of-vocabulary value and a junk key, checked raw AND through cleanPostureRule", () => {
  const rawRule = {
    tierRules: [
      { when: { capability: "GIGANTIC", junkKey: "nope", consequence: "SEVERE" }, tier: 4 },
      { when: {}, tier: 1 },
    ],
    fallbackTier: 1, topTierCeiling: 1,
  };
  const cleanedRule = tsPostureRule.cleanPostureRule(rawRule);
  const vectors = tsPosture.enumeratePostureVectors();

  it("the mirror's internal cleaning matches feeding the already-cleaned rule to the TS domain", () => {
    for (const v of vectors) {
      expect(mirror.decidePosture(v, rawRule)).toEqual(tsPosture.decidePosture(v, cleanedRule));
    }
  });

  it("cleaning is idempotent: mirror and TS agree on the already-cleaned rule directly too", () => {
    for (const v of vectors) {
      expect(mirror.decidePosture(v, cleanedRule)).toEqual(tsPosture.decidePosture(v, cleanedRule));
    }
  });

  it("cellCoverage over the raw rule (mirror cleans internally) equals TS's coverage of the cleaned rule", () => {
    expect(mirror.cellCoverage(rawRule)).toEqual(tsPostureRule.cellCoverage(cleanedRule));
  });
});

// ------------------------------------------------------------------------------- seeded fuzz

describe("seeded fuzz: ~200 generated rules, coverage must deep-equal", () => {
  it("problem rules", () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 200; i++) {
      const rule = randomProblemRule(rng);
      expect(mirror.leafCoverage(rule), `seed step ${i}`).toEqual(tsProblemRule.leafCoverage(rule));
    }
  });

  it("posture rules", () => {
    const rng = mulberry32(0x5eed5eed);
    for (let i = 0; i < 200; i++) {
      const rule = randomPostureRule(rng);
      expect(mirror.cellCoverage(rule), `seed step ${i}`).toEqual(tsPostureRule.cellCoverage(rule));
    }
  });
});

// --------------------------------------------------------------------------------- sanity net

describe("sanity net — the two facts the domain files document", () => {
  it("DEFAULT_POSTURE_RULE yields tier4 1, tier3 6, tier2 18, tier1 2 of 27", () => {
    const coverage = mirror.cellCoverage(tsPostureRule.DEFAULT_POSTURE_RULE);
    expect(coverage.total).toBe(27);
    expect(coverage.byTier).toEqual({ 1: 2, 2: 18, 3: 6, 4: 1 });
  });

  it("DEFAULT_PROBLEM_RULE yields ACT 6 of 54, and shadowedOutcomeRules is []", () => {
    const coverage = mirror.leafCoverage(tsProblemRule.DEFAULT_PROBLEM_RULE);
    expect(coverage.total).toBe(54);
    expect(coverage.byOutcome.ACT).toBe(6);
    expect(tsProblemRule.shadowedOutcomeRules(tsProblemRule.DEFAULT_PROBLEM_RULE)).toEqual([]);
  });
});

// ------------------------------------------------------------------- the verdict half of cleaning

/**
 * The `when` half of the server's cleaning was mirrored from the start; the VERDICT half —
 * `cleanOutcome` / `cleanTier` on the row's own outcome and tier — was not, and these two
 * cases are why it had to be. Both compare against `cleanProblemRule` / `cleanPostureRule`
 * followed by the real TS decision, which is exactly what the server does to a posted draft,
 * rather than against a hand-written expectation.
 *
 * The string-tier case is not hypothetical. `select.value` is always a string, so a tier
 * arriving from the cascade's own dropdown is `"3"`; the server coerces it and an uncleaned
 * mirror would not, drawing a rule the operator had just set as a cell that decided nothing.
 */
describe("row verdicts are cleaned the way the server cleans them", () => {
  it("an out-of-vocabulary outcome falls back, it does not pass through", () => {
    const raw = {
      outcomeRules: [{ when: { mission: "HIGH" }, outcome: "BANANA" }],
      fallbackOutcome: "TRACK",
    };
    const cleaned = tsProblemRule.cleanProblemRule(raw);
    for (const v of tsProblem.enumerateDecisionVectors()) {
      expect(mirror.decideProblem(v, raw)).toEqual(tsProblem.decideProblem(v, cleaned));
    }
  });

  it("a junk rule-level fallbackOutcome degrades once, to the documented default", () => {
    const raw = { outcomeRules: [{ when: { mission: "HIGH" }, outcome: "NOPE" }], fallbackOutcome: "ALSO_NOPE" };
    const cleaned = tsProblemRule.cleanProblemRule(raw);
    for (const v of tsProblem.enumerateDecisionVectors()) {
      expect(mirror.decideProblem(v, raw)).toEqual(tsProblem.decideProblem(v, cleaned));
    }
  });

  it("a tier arriving from a <select> as the string \"3\" decides as 3", () => {
    const raw = { tierRules: [{ when: { capability: "BROAD" }, tier: "3" }], fallbackTier: 2 };
    const cleaned = tsPostureRule.cleanPostureRule(raw);
    for (const v of tsPosture.enumeratePostureVectors()) {
      expect(mirror.decidePosture(v, raw)).toEqual(tsPosture.decidePosture(v, cleaned));
    }
    expect(mirror.decidePosture({ capability: "BROAD", containment: "WEAK", consequence: "SEVERE" }, raw).tier).toBe(3);
  });

  it("an out-of-range tier falls back, and a string fallbackTier is coerced too", () => {
    const raw = { tierRules: [{ when: { capability: "BROAD" }, tier: 9 }], fallbackTier: "1" };
    const cleaned = tsPostureRule.cleanPostureRule(raw);
    for (const v of tsPosture.enumeratePostureVectors()) {
      expect(mirror.decidePosture(v, raw)).toEqual(tsPosture.decidePosture(v, cleaned));
    }
  });

  it("coverage tallies agree once verdicts are cleaned", () => {
    const problemRaw = {
      outcomeRules: [
        { when: { exploitation: "ACTIVE" }, outcome: "NOT_AN_OUTCOME" },
        { when: { mission: "HIGH" }, outcome: "ATTEND" },
      ],
      fallbackOutcome: "TRACK",
    };
    expect(mirror.leafCoverage(problemRaw))
      .toEqual(tsProblemRule.leafCoverage(tsProblemRule.cleanProblemRule(problemRaw)));

    const postureRaw = {
      tierRules: [{ when: { containment: "WEAK" }, tier: "4" }, { when: { capability: "BROAD" }, tier: 0 }],
      fallbackTier: 2,
    };
    expect(mirror.cellCoverage(postureRaw))
      .toEqual(tsPostureRule.cellCoverage(tsPostureRule.cleanPostureRule(postureRaw)));
  });
});
