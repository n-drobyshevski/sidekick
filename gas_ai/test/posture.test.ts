// The asset posture vector: axis derivation, the first-match tier decision, and
// `worstOpenProblem`'s MAX-never-mean contract.

import { describe, expect, it } from "vitest";
import {
  decidePosture,
  derivePostureInput,
  enumeratePostureVectors,
  postureVectorMatches,
  tierEstablished,
  worstOpenProblem,
  type PostureVector,
} from "../src/domain/posture";
import { DEFAULT_POSTURE_RULE, type PostureRule } from "../src/domain/postureRule";
import type { GNode } from "../src/domain/graphTypes";

const RULE: PostureRule = DEFAULT_POSTURE_RULE;

let seq = 0;
function nodeFixture(over: Partial<GNode> = {}): GNode {
  seq += 1;
  return { id: `node-${seq}`, kind: "AI_AGENT", name: "Fixture Agent", ...over };
}

// ----------------------------------------------------------------------------- capability

describe("capability — identity power and data reach", () => {
  it("admin privileges → BROAD", () => {
    const node = nodeFixture({ hasAdminPrivileges: true });
    expect(derivePostureInput(node, RULE).vector.capability).toBe("BROAD");
  });

  it("admin-level human access → BROAD", () => {
    const node = nodeFixture({ humanAccess: { identityIds: ["u1"], admin: true } });
    expect(derivePostureInput(node, RULE).vector.capability).toBe("BROAD");
  });

  it("high privilege ALONE is only SCOPED — BROAD needs sensitive access too", () => {
    const node = nodeFixture({ hasHighPrivileges: true });
    expect(derivePostureInput(node, RULE).vector.capability).toBe("SCOPED");
  });

  it("high privilege AND sensitive-data access together → BROAD", () => {
    const node = nodeFixture({ hasHighPrivileges: true, hasAccessToSensitiveData: true });
    expect(derivePostureInput(node, RULE).vector.capability).toBe("BROAD");
  });

  it("sensitive-data access alone → SCOPED", () => {
    const node = nodeFixture({ hasAccessToSensitiveData: true });
    expect(derivePostureInput(node, RULE).vector.capability).toBe("SCOPED");
  });

  it("nothing observed → MINIMAL, and 'capability' is pushed onto unknowns", () => {
    const node = nodeFixture({});
    const { vector, unknowns } = derivePostureInput(node, RULE);
    expect(vector.capability).toBe("MINIMAL");
    expect(unknowns).toContain("capability");
  });

  it("an explicit false on every source IS an observation — MINIMAL without an unknown", () => {
    const node = nodeFixture({
      hasAdminPrivileges: false, hasHighPrivileges: false, hasAccessToSensitiveData: false,
    });
    const { vector, unknowns } = derivePostureInput(node, RULE);
    expect(vector.capability).toBe("MINIMAL");
    expect(unknowns).not.toContain("capability");
  });

  it("a humanAccess record with no admin flag still counts as an observation", () => {
    const node = nodeFixture({ humanAccess: { identityIds: ["u1"] } });
    const { unknowns } = derivePostureInput(node, RULE);
    expect(unknowns).not.toContain("capability");
  });

  it("no node at all → MINIMAL and unknown", () => {
    const { vector, unknowns } = derivePostureInput(undefined, RULE);
    expect(vector.capability).toBe("MINIMAL");
    expect(unknowns).toContain("capability");
  });
});

// ---------------------------------------------------------------------------- containment

describe("containment — guardrail coverage corroborated by confirmed non-exposure", () => {
  it("guardrailMissing: true → WEAK", () => {
    const node = nodeFixture({ guardrailMissing: true });
    expect(derivePostureInput(node, RULE).vector.containment).toBe("WEAK");
  });

  it("guardrailMissing: false ALONE is only PARTIAL — it is absence of evidence, not a control", () => {
    const node = nodeFixture({ guardrailMissing: false });
    expect(derivePostureInput(node, RULE).vector.containment).toBe("PARTIAL");
  });

  it("guardrailMissing: false AND confirmed non-exposure → STRONG", () => {
    const node = nodeFixture({
      guardrailMissing: false, isAccessibleFromInternet: false, isOpenToAllInternet: false,
    });
    expect(derivePostureInput(node, RULE).vector.containment).toBe("STRONG");
  });

  it("guardrailMissing: false but internet-exposed → PARTIAL, never STRONG", () => {
    const node = nodeFixture({ guardrailMissing: false, isAccessibleFromInternet: true });
    expect(derivePostureInput(node, RULE).vector.containment).toBe("PARTIAL");
  });

  it("undefined guardrailMissing → PARTIAL, and 'containment' is pushed onto unknowns", () => {
    const node = nodeFixture({});
    const { vector, unknowns } = derivePostureInput(node, RULE);
    expect(vector.containment).toBe("PARTIAL");
    expect(unknowns).toContain("containment");
  });

  it("no node at all → PARTIAL and unknown", () => {
    const { vector, unknowns } = derivePostureInput(undefined, RULE);
    expect(vector.containment).toBe("PARTIAL");
    expect(unknowns).toContain("containment");
  });
});

// ---------------------------------------------------------------------------- consequence

describe("consequence — what a realized failure would cost", () => {
  it("HBI business impact → SEVERE", () => {
    const node = nodeFixture({ businessImpact: "HBI" });
    expect(derivePostureInput(node, RULE).vector.consequence).toBe("SEVERE");
  });

  it("a CRITICAL entry in dataFindingSeverities → SEVERE, even with no businessImpact", () => {
    const node = nodeFixture({ dataFindingCount: 3, dataFindingSeverities: { CRITICAL: 1, LOW: 2 } });
    expect(derivePostureInput(node, RULE).vector.consequence).toBe("SEVERE");
  });

  it("MBI business impact → MODERATE", () => {
    const node = nodeFixture({ businessImpact: "MBI" });
    expect(derivePostureInput(node, RULE).vector.consequence).toBe("MODERATE");
  });

  it("any positive dataFindingCount with no CRITICAL entry → MODERATE", () => {
    const node = nodeFixture({ dataFindingCount: 2, dataFindingSeverities: { LOW: 2 } });
    expect(derivePostureInput(node, RULE).vector.consequence).toBe("MODERATE");
  });

  it("LBI or nothing observed → LIMITED", () => {
    expect(derivePostureInput(nodeFixture({ businessImpact: "LBI" }), RULE).vector.consequence).toBe(
      "LIMITED",
    );
    expect(derivePostureInput(nodeFixture({}), RULE).vector.consequence).toBe("LIMITED");
  });

  it("businessImpact absent AND dataFindingCount undefined → unknown; dataFindingCount: 0 is NOT unknown", () => {
    const neverCollected = nodeFixture({});
    expect(derivePostureInput(neverCollected, RULE).unknowns).toContain("consequence");

    const collectedClean = nodeFixture({ dataFindingCount: 0 });
    const { vector, unknowns } = derivePostureInput(collectedClean, RULE);
    expect(vector.consequence).toBe("LIMITED");
    expect(unknowns).not.toContain("consequence");
  });

  it("a FindingRow-shaped node's own businessImpact resolves the same way as an issue's", () => {
    const node = nodeFixture({ businessImpact: "HBI", dataFindingCount: undefined });
    expect(derivePostureInput(node, RULE).vector.consequence).toBe("SEVERE");
  });
});

// -------------------------------------------------------------------------- decidePosture

describe("decidePosture — first match wins, fallback is -1", () => {
  it("matches the first row whose (partial) condition the vector satisfies", () => {
    const vector: PostureVector = { capability: "BROAD", containment: "WEAK", consequence: "SEVERE" };
    const { tier, matchedRuleIndex } = decidePosture(vector, RULE);
    // Row 0 is the lethal-trifecta row and cannot match a bare vector — row 1 is the first
    // real match for exactly this combination.
    expect(tier).toBe(4);
    expect(matchedRuleIndex).toBe(1);
  });

  it("the lethal-trifecta row never matches a vector without its three legs", () => {
    const vector: PostureVector = { capability: "BROAD", containment: "WEAK", consequence: "SEVERE" };
    expect(postureVectorMatches(vector, RULE.tierRules[0]!.when)).toBe(false);
  });

  it("an omitted axis in `when` is a wildcard", () => {
    const vector: PostureVector = { capability: "BROAD", containment: "PARTIAL", consequence: "LIMITED" };
    const { tier, matchedRuleIndex } = decidePosture(vector, RULE);
    // Row 5 ({ capability: BROAD } → 2) is the first row this leaf satisfies.
    expect(tier).toBe(2);
    expect(matchedRuleIndex).toBe(5);
  });

  it("falls back with matchedRuleIndex -1 when nothing matches", () => {
    // A rule with NO trailing wildcard row — `decidePosture`'s raw fallback contract,
    // tested independent of DEFAULT_POSTURE_RULE's own shape. DEFAULT_POSTURE_RULE no
    // longer exercises matchedRuleIndex -1 at all (see the test right after this one):
    // it ends in an explicit `when: {}` row precisely so a fully-known vector always
    // matches a NAMED row rather than the bare fallback — see postureRule.ts's own
    // comment on `DEFAULT_POSTURE_RULE` for why.
    const bare: PostureRule = {
      tierRules: [{ when: { consequence: "SEVERE" }, tier: 2 }], fallbackTier: 1, topTierCeiling: 1,
    };
    const vector: PostureVector = { capability: "SCOPED", containment: "PARTIAL", consequence: "MODERATE" };
    const { tier, matchedRuleIndex } = decidePosture(vector, bare);
    expect(tier).toBe(bare.fallbackTier);
    expect(matchedRuleIndex).toBe(-1);
  });

  it("DEFAULT_POSTURE_RULE's own trailing row claims what used to be the bare fallback", () => {
    // The exact vector the test above used to exercise as a fallback now matches the
    // cascade's own last row (index 9: `{ when: {}, tier: 1 }`) instead — a named row,
    // not `matchedRuleIndex: -1`. That is Change 2's whole point: a FULLY KNOWN vector
    // ("SCOPED/PARTIAL/MODERATE" is not missing any axis) still gets an explicit,
    // auditable answer rather than a silent default.
    const vector: PostureVector = { capability: "SCOPED", containment: "PARTIAL", consequence: "MODERATE" };
    const { tier, matchedRuleIndex } = decidePosture(vector, RULE);
    expect(tier).toBe(1);
    expect(matchedRuleIndex).toBe(RULE.tierRules.length - 1);
  });

  it("every one of the 27 leaves decides to a tier in {1,2,3,4}", () => {
    for (const v of enumeratePostureVectors()) {
      const { tier } = decidePosture(v, RULE);
      expect([1, 2, 3, 4]).toContain(tier);
    }
  });
});

// ---------------------------------------------------------------------- worstOpenProblem

describe("worstOpenProblem — the MAX of a typed ordinal, never a mean", () => {
  it("returns the worst (earliest in OUTCOME_VALUES) outcome present", () => {
    expect(worstOpenProblem(["TRACK", "ATTEND", "TRACK_STAR"])).toBe("ATTEND");
    expect(worstOpenProblem(["TRACK", "ACT", "ATTEND"])).toBe("ACT");
    expect(worstOpenProblem(["TRACK"])).toBe("TRACK");
  });

  it("undefined for an empty list", () => {
    expect(worstOpenProblem([])).toBeUndefined();
  });

  it("ignores an unrecognised outcome string rather than crashing", () => {
    expect(worstOpenProblem(["NONSENSE", "TRACK"])).toBe("TRACK");
    expect(worstOpenProblem(["NONSENSE"])).toBeUndefined();
  });

  it("order of the input list never matters — only rank does", () => {
    expect(worstOpenProblem(["TRACK", "TRACK_STAR", "ACT", "ATTEND"])).toBe("ACT");
    expect(worstOpenProblem(["ACT", "TRACK", "TRACK_STAR", "ATTEND"])).toBe("ACT");
  });
});

// -------------------------------------------------------------------- tierEstablished

describe("tierEstablished — a posture that was never observed is never placed", () => {
  it("true when every axis was observed, whatever it read", () => {
    expect(tierEstablished([])).toBe(true);
  });

  it("false the moment even ONE axis is unknown — not only when all three are", () => {
    expect(tierEstablished(["consequence"])).toBe(false);
    expect(tierEstablished(["capability"])).toBe(false);
    expect(tierEstablished(["capability", "consequence"])).toBe(false);
    expect(tierEstablished(["capability", "containment", "consequence"])).toBe(false);
  });

  it("agrees with derivePostureInput's own unknowns on a real node", () => {
    const partiallyObserved = nodeFixture({ hasAdminPrivileges: true, guardrailMissing: true });
    const { unknowns } = derivePostureInput(partiallyObserved, RULE);
    // capability and containment are observed above; consequence never is.
    expect(unknowns).toEqual(["consequence"]);
    expect(tierEstablished(unknowns)).toBe(false);

    const fullyObserved = nodeFixture({
      hasAdminPrivileges: true, guardrailMissing: true, businessImpact: "HBI",
    });
    expect(tierEstablished(derivePostureInput(fullyObserved, RULE).unknowns)).toBe(true);
  });
});

// ------------------------------------------------------ posture is not a sum of problems

describe("a zero-open-problem asset can still sit at a high tier", () => {
  it("BROAD capability + WEAK containment decides tier 4 with no issues or findings in sight", () => {
    // This is the module's whole thesis, made concrete: derivePostureInput never looks at
    // an issue or a finding at all — only at the node's own capability/containment/data
    // fields — so an asset with a clean register still reads its true tier.
    const node = nodeFixture({ hasAdminPrivileges: true, guardrailMissing: true, businessImpact: "HBI" });
    const { vector } = derivePostureInput(node, RULE);
    expect(decidePosture(vector, RULE).tier).toBe(4);
  });
});
