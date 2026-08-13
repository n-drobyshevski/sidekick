// The asset/issue detail-sheet rail as pure data — same shape as comboView.test.js: the
// logic is tested here, the pixels are checked in the dev harness.

import { describe, it, expect } from "vitest";
import {
  assetSections, issueSections, recordCursor, clampSheetWidth,
} from "../src/client/js/recordSections.js";

const ASSET_IDS = [
  "overview", "issues", "compliance", "combos", "aars", "exposure",
  "guardrails", "relationships", "identity", "tags",
];

const ISSUE_IDS = [
  "overview", "fix", "tickets", "accepted", "frameworks", "ai", "facts", "asset",
];

function byId(sections) {
  const map = {};
  for (const s of sections) map[s.id] = s;
  return map;
}

// ------------------------------------------------------------------------- assetSections

describe("assetSections", () => {
  const RICH_DETAIL = {
    node: {
      kind: "AI_AGENT",
      comboGroups: ["gcp-managed-privileged"],
      internet: true,
      openInternet: false,
      sensitiveData: true,
      sensitiveAccess: false,
      highPriv: false,
      adminPriv: false,
      guardrailMissing: true,
      aarsPillars: { toxic: 10, compliance: 4, data: 6 },
      tags: [{ key: "env", value: "prod" }, { key: "team", value: "ml" }],
    },
    issues: [{ id: "i1" }, { id: "i2" }],
    findings: [{ id: "f1" }],
    neighbors: [
      { edge: { type: "RUNS_AS" }, node: { id: "n1" }, direction: "out" },
      { edge: { type: "HAS_ISSUE" }, node: { id: "n2" }, direction: "out" },
    ],
  };

  it("returns every section, in order, on a fully-loaded record", () => {
    const sections = assetSections(RICH_DETAIL);
    expect(sections.map((s) => s.id)).toEqual(ASSET_IDS);
  });

  it("assigns the right label, group and count to each section", () => {
    const map = byId(assetSections(RICH_DETAIL));
    expect(map.overview).toEqual({ id: "overview", label: "Overview", group: null, count: null, empty: false });
    expect(map.issues).toMatchObject({ label: "Issues", group: "Risk", count: 2, empty: false });
    expect(map.compliance).toMatchObject({ label: "Compliance", group: "Risk", count: 1, empty: false });
    expect(map.combos).toMatchObject({ label: "Toxic combinations", group: "Risk", count: 1, empty: false });
    expect(map.aars).toMatchObject({ label: "AARS breakdown", group: "Posture", count: null, empty: false });
    expect(map.exposure).toMatchObject({ label: "Exposure", group: "Posture", count: null, empty: false });
    expect(map.guardrails).toMatchObject({ label: "Guardrails", group: "Posture", count: null, empty: false });
    expect(map.relationships).toMatchObject({ label: "Relationships", group: "Context", count: 2, empty: false });
    expect(map.identity).toMatchObject({ label: "Identity", group: "Context", count: null, empty: false });
    expect(map.tags).toMatchObject({ label: "Tags", group: "Context", count: 2, empty: false });
  });

  it("keeps every section present on a clean record, empty exactly where it should be", () => {
    const clean = {
      node: {
        kind: "VIRTUAL_MACHINE",
        comboGroups: [],
        internet: false,
        openInternet: null,
        sensitiveData: false,
        sensitiveAccess: false,
        highPriv: null,
        adminPriv: false,
        guardrailMissing: false,
        aarsPillars: null,
        tags: [],
      },
      issues: [],
      findings: [],
      neighbors: [],
    };
    const sections = assetSections(clean);
    expect(sections.map((s) => s.id)).toEqual(ASSET_IDS);
    const map = byId(sections);
    expect(map.overview.empty).toBe(false);
    expect(map.identity.empty).toBe(false);
    expect(map.issues.empty).toBe(true);
    expect(map.compliance.empty).toBe(true);
    expect(map.combos.empty).toBe(true);
    expect(map.aars.empty).toBe(true);
    expect(map.exposure.empty).toBe(true);
    expect(map.guardrails.empty).toBe(true);
    expect(map.relationships.empty).toBe(true);
    expect(map.tags.empty).toBe(true);
  });

  it("tolerates a detail object with everything missing or undefined", () => {
    expect(() => assetSections(undefined)).not.toThrow();
    expect(() => assetSections(null)).not.toThrow();
    expect(() => assetSections({})).not.toThrow();
    const sections = assetSections({});
    expect(sections.map((s) => s.id)).toEqual(ASSET_IDS);
    // Nothing to show anywhere except "overview", which is never empty — including
    // "identity", since a node with no kind at all has nothing to head that section with.
    for (const s of sections) {
      expect(s.empty).toBe(s.id !== "overview");
    }
  });

  describe("exposure", () => {
    const base = { comboGroups: [], tags: [] };

    it("is empty when every flag is null — inherited, not evidence of exposure", () => {
      const detail = {
        node: Object.assign({}, base, {
          internet: null, openInternet: null, sensitiveData: null,
          sensitiveAccess: null, highPriv: null, adminPriv: null,
        }),
      };
      expect(byId(assetSections(detail)).exposure.empty).toBe(true);
    });

    it("is empty when every flag is false, same as null", () => {
      const detail = {
        node: Object.assign({}, base, {
          internet: false, openInternet: false, sensitiveData: false,
          sensitiveAccess: false, highPriv: false, adminPriv: false,
        }),
      };
      expect(byId(assetSections(detail)).exposure.empty).toBe(true);
    });

    it("is not empty when any single flag is true", () => {
      const flags = ["internet", "openInternet", "sensitiveData", "sensitiveAccess", "highPriv", "adminPriv"];
      for (const flag of flags) {
        const node = Object.assign({}, base, {
          internet: null, openInternet: null, sensitiveData: null,
          sensitiveAccess: null, highPriv: null, adminPriv: null,
        });
        node[flag] = true;
        expect(byId(assetSections({ node })).exposure.empty).toBe(false);
      }
    });
  });

  describe("guardrails", () => {
    const base = { comboGroups: [], tags: [] };

    it("is empty with no missing flag and no PROTECTED_BY neighbor", () => {
      const detail = { node: Object.assign({}, base, { guardrailMissing: false }), neighbors: [] };
      expect(byId(assetSections(detail)).guardrails.empty).toBe(true);
    });

    it("is not empty when guardrailMissing is true", () => {
      const detail = { node: Object.assign({}, base, { guardrailMissing: true }), neighbors: [] };
      expect(byId(assetSections(detail)).guardrails.empty).toBe(false);
    });

    it("is not empty when a PROTECTED_BY neighbor exists, even with guardrailMissing false", () => {
      const detail = {
        node: Object.assign({}, base, { guardrailMissing: false }),
        neighbors: [{ edge: { type: "PROTECTED_BY" }, node: { id: "g1" }, direction: "out" }],
      };
      expect(byId(assetSections(detail)).guardrails.empty).toBe(false);
    });

    it("ignores neighbor edges of other types", () => {
      const detail = {
        node: Object.assign({}, base, { guardrailMissing: false }),
        neighbors: [{ edge: { type: "RUNS_AS" }, node: { id: "s1" }, direction: "out" }],
      };
      expect(byId(assetSections(detail)).guardrails.empty).toBe(true);
    });
  });
});

// ------------------------------------------------------------------------- issueSections

describe("issueSections", () => {
  const RICH_ISSUE = {
    id: "iss-1",
    assetId: "asset-1",
    assetName: "agent-checkout",
    remediation: "Attach a guardrail before this ships.",
    resolutionRecommendation: "Attach a guardrail.",
    ticketUrls: ["https://tickets.example.test/T-1", "https://tickets.example.test/T-2"],
    ignoreNote: "Accepted by security for Q3.",
    ignoreExpiredAt: "2026-01-01T00:00:00Z",
    frameworks: {
      owaspLlm: ["LLM01", "LLM06"],
      owaspAgentic: ["A03"],
      owaspMl: [],
      fiveRs: ["R1"],
    },
    aiVerdict: "REMEDIATE",
    aiRecommendedSeverity: "HIGH",
  };

  const BARE_ISSUE = {
    id: "iss-2",
    ruleId: "rule-2",
    ruleName: "Bare rule",
    comboGroup: "OTHER",
    nativeSeverity: "LOW",
    adjustedSeverity: "LOW",
    status: "OPEN",
    assetId: "asset-2",
    assetName: "svc-bare",
  };

  it("returns every section, in order, for a rich issue", () => {
    const sections = issueSections({ issue: RICH_ISSUE });
    expect(sections.map((s) => s.id)).toEqual(ISSUE_IDS);
  });

  it("marks nothing empty on a rich issue, and counts tickets and framework codes", () => {
    const map = byId(issueSections({ issue: RICH_ISSUE }));
    for (const id of ISSUE_IDS) expect(map[id].empty).toBe(false);
    expect(map.tickets.count).toBe(2);
    expect(map.frameworks.count).toBe(4); // 2 owaspLlm + 1 owaspAgentic + 0 owaspMl + 1 fiveRs
  });

  it("assigns the right label and group to each section", () => {
    const map = byId(issueSections({ issue: RICH_ISSUE }));
    expect(map.overview).toMatchObject({ label: "Overview", group: null });
    expect(map.fix).toMatchObject({ label: "Recommended fix", group: "Remediation" });
    expect(map.tickets).toMatchObject({ label: "Tickets", group: "Remediation" });
    expect(map.accepted).toMatchObject({ label: "Accepted risk", group: "Remediation" });
    expect(map.frameworks).toMatchObject({ label: "Framework mappings", group: "Context" });
    expect(map.ai).toMatchObject({ label: "Wiz AI analysis", group: "Context" });
    expect(map.facts).toMatchObject({ label: "Facts", group: "Context" });
    expect(map.asset).toMatchObject({ label: "Affected asset", group: "Context" });
  });

  it("empties every optional section on a bare issue, keeping facts, overview and asset", () => {
    const sections = issueSections({ issue: BARE_ISSUE });
    expect(sections.map((s) => s.id)).toEqual(ISSUE_IDS);
    const map = byId(sections);
    expect(map.overview.empty).toBe(false);
    expect(map.facts.empty).toBe(false);
    expect(map.asset.empty).toBe(false); // assetId is present, even on a bare issue
    expect(map.fix.empty).toBe(true);
    expect(map.tickets.empty).toBe(true);
    expect(map.tickets.count).toBe(0);
    expect(map.accepted.empty).toBe(true);
    expect(map.frameworks.empty).toBe(true);
    expect(map.frameworks.count).toBe(0);
    expect(map.ai.empty).toBe(true);
  });

  it("empties the asset section when the issue carries no assetId", () => {
    const noAsset = Object.assign({}, BARE_ISSUE, { assetId: "" });
    expect(byId(issueSections({ issue: noAsset })).asset.empty).toBe(true);
  });

  it("treats a single populated framework bucket as non-empty, counting only its codes", () => {
    const issue = Object.assign({}, BARE_ISSUE, {
      frameworks: { owaspLlm: ["LLM01"] },
    });
    const map = byId(issueSections({ issue }));
    expect(map.frameworks.empty).toBe(false);
    expect(map.frameworks.count).toBe(1);
  });

  it("tolerates a detail object with everything missing or undefined", () => {
    expect(() => issueSections(undefined)).not.toThrow();
    expect(() => issueSections(null)).not.toThrow();
    expect(() => issueSections({})).not.toThrow();
    const map = byId(issueSections({}));
    expect(map.overview.empty).toBe(false);
    expect(map.facts.empty).toBe(false);
    expect(map.asset.empty).toBe(true);
    expect(map.fix.empty).toBe(true);
  });
});

// -------------------------------------------------------------------------- recordCursor

describe("recordCursor", () => {
  it("steps through the middle of a list", () => {
    expect(recordCursor(["a", "b", "c"], 1)).toEqual({
      prevId: "a", nextId: "c", position: 2, total: 3,
    });
  });

  it("has no previous at the first row", () => {
    expect(recordCursor(["a", "b", "c"], 0)).toEqual({
      prevId: null, nextId: "b", position: 1, total: 3,
    });
  });

  it("has no next at the last row", () => {
    expect(recordCursor(["a", "b", "c"], 2)).toEqual({
      prevId: "b", nextId: null, position: 3, total: 3,
    });
  });

  it("has neither prev nor next with a single element", () => {
    expect(recordCursor(["only"], 0)).toEqual({
      prevId: null, nextId: null, position: 1, total: 1,
    });
  });

  it("reports position 0 on an empty array", () => {
    expect(recordCursor([], 0)).toEqual({ prevId: null, nextId: null, position: 0, total: 0 });
  });

  it("reports position 0 when ids is null or missing", () => {
    expect(recordCursor(null, 0)).toEqual({ prevId: null, nextId: null, position: 0, total: 0 });
    expect(recordCursor(undefined, 0)).toEqual({ prevId: null, nextId: null, position: 0, total: 0 });
  });

  it("reports position 0 for an index past the end", () => {
    expect(recordCursor(["a", "b"], 5)).toEqual({ prevId: null, nextId: null, position: 0, total: 2 });
  });

  it("reports position 0 for a negative index", () => {
    expect(recordCursor(["a", "b"], -1)).toEqual({ prevId: null, nextId: null, position: 0, total: 2 });
  });
});

// ----------------------------------------------------------------------- clampSheetWidth

describe("clampSheetWidth", () => {
  it("raises a width below the floor up to the floor", () => {
    expect(clampSheetWidth(100, 280, 45, 1200)).toBe(280);
  });

  it("caps a width above the ceiling down to the ceiling", () => {
    // ceiling = 1200 * 45 / 100 = 540
    expect(clampSheetWidth(900, 280, 45, 1200)).toBe(540);
  });

  it("leaves a width inside the range alone, rounded", () => {
    expect(clampSheetWidth(400, 280, 45, 1200)).toBe(400);
    expect(clampSheetWidth(333.4, 0, 100, 1000)).toBe(333);
  });

  it("lets the ceiling win when it falls below the floor, on a very narrow viewport", () => {
    // ceiling = 300 * 50 / 100 = 150, below the 400 floor.
    expect(clampSheetWidth(1000, 400, 50, 300)).toBe(150);
    expect(clampSheetWidth(0, 400, 50, 300)).toBe(150);
    expect(clampSheetWidth(150, 400, 50, 300)).toBe(150);
  });

  it("falls back to the floor for non-finite inputs", () => {
    expect(clampSheetWidth(NaN, 280, 45, 1200)).toBe(280);
    expect(clampSheetWidth(400, 280, 45, Infinity)).toBe(280);
    expect(clampSheetWidth(400, 280, Infinity, 1200)).toBe(280);
    expect(clampSheetWidth(Infinity, 280, 45, 1200)).toBe(280);
  });

  it("treats a non-finite floor as zero rather than as a special case", () => {
    // minPx itself doesn't parse: it's coerced to 0, and everything else clamps normally.
    expect(clampSheetWidth(400, NaN, 45, 1200)).toBe(400); // inside [0, 540]
    expect(clampSheetWidth(-50, NaN, 45, 1200)).toBe(0); // raised up to the zero floor
  });
});
