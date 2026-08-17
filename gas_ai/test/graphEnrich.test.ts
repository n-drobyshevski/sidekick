// Enrichment over the seed graph: severity/AARS/combo membership on assets, ISSUE
// nodes + HAS_ISSUE edges materialized, and the applied-table scores reproduced
// end-to-end through the hint path.

import { describe, expect, it } from "vitest";
import {
  buildAarsHintsFromFindings,
  dataExposureOf,
  deriveAarsInput,
  enrichGraphDoc,
  internetExposureOf,
  withDataFindingNodes,
  withExcessivePrivilegeNodes,
  withIdentityAccessNodes,
  withInternetExposureNodes,
  withMissingGuardrailNodes,
  withSensitiveDataNodes,
} from "../src/domain/graphEnrich";
import {
  DEFAULT_AARS_RULE, derivationSignature, gapPointsFor, type AarsRule,
} from "../src/domain/aars";
import { cleanAarsRule } from "../src/domain/aarsRule";
import type { Severity } from "../src/domain/config";
import { edgeId } from "../src/domain/graphTypes";
import type { FindingRow, GNode, GraphDoc, IssueRow } from "../src/domain/graphTypes";
import { SEED_AARS_HINTS, SEED_ISSUES, seedGraphDoc } from "../src/server/sampleData";

const T = "2026-06-28T05:00:00Z";

function enriched() {
  return enrichGraphDoc(seedGraphDoc(T), SEED_ISSUES, SEED_AARS_HINTS);
}

describe("enrichGraphDoc", () => {
  it("materializes one ISSUE node + HAS_ISSUE edge per open issue", () => {
    const doc = enriched();
    const issueNodes = doc.nodes.filter((n) => n.kind === "ISSUE");
    const issueEdges = doc.edges.filter((e) => e.type === "HAS_ISSUE");
    expect(issueNodes).toHaveLength(SEED_ISSUES.length);
    expect(issueEdges).toHaveLength(SEED_ISSUES.length);
    for (const e of issueEdges) {
      expect(doc.nodes.some((n) => n.id === e.src)).toBe(true);
      expect(issueNodes.some((n) => n.id === e.dst)).toBe(true);
    }
  });

  it("does NOT persist SENSITIVE_DATA topology (it is derived on read, not at sync)", () => {
    const doc = enriched();
    expect(doc.nodes.some((n) => n.kind === "SENSITIVE_DATA")).toBe(false);
    expect(
      doc.edges.some(
        (e) => e.type === "HAS_SENSITIVE_DATA" || e.type === "HAS_ACCESS_TO_SENSITIVE_DATA",
      ),
    ).toBe(false);
  });

  it("withSensitiveDataNodes adds a stub per data-exposed asset NOT on a real chain", () => {
    const base = enriched();
    const doc = withSensitiveDataNodes(base);
    const flagged = base.nodes.filter(
      (n) => n.hasSensitiveData || n.hasAccessToSensitiveData,
    );
    const sensNodes = doc.nodes.filter((n) => n.kind === "SENSITIVE_DATA");
    const sensEdges = doc.edges.filter(
      (e) => e.type === "HAS_SENSITIVE_DATA" || e.type === "HAS_ACCESS_TO_SENSITIVE_DATA",
    );
    expect(flagged.length).toBeGreaterThan(0);
    // Not one per flagged asset any more: the stub is the FALLBACK, drawn only where no
    // traversable path to a classified store exists. The seed estate has real chains, so a
    // strict per-flag count here would assert the feature is off.
    expect(sensNodes.length).toBeLessThan(flagged.length);
    expect(sensNodes).toHaveLength(sensEdges.length);
    expect(sensNodes.length).toBeGreaterThan(0);

    const baseIds = new Set(base.nodes.map((n) => n.id));
    for (const e of sensEdges) {
      expect(baseIds.has(e.src)).toBe(true);
      expect(e.dst).toBe(`sensitive|${e.src}`);
      expect(sensNodes.some((n) => n.id === e.dst)).toBe(true);
    }

    // Synthetic nodes never carry an AARS score.
    for (const n of sensNodes) expect(n.aars).toBeUndefined();
  });

  it("suppresses the stub for every asset on a real path to a classified store", () => {
    // agent -RUNS_AS-> sa -ALLOWS_ACCESS_TO-> classified bucket. All three are on the chain,
    // so all three lose the stub; the fourth asset is flagged with nowhere to walk and keeps
    // it. That contrast IS the feature — one story per asset, never two.
    const doc: GraphDoc = {
      nodes: [
        { id: "agent", kind: "AI_AGENT", name: "agent", hasAccessToSensitiveData: true },
        { id: "sa", kind: "SERVICE_ACCOUNT", name: "sa", hasAccessToSensitiveData: true },
        { id: "store", kind: "BUCKET", name: "store", hasSensitiveData: true },
        { id: "orphan", kind: "AI_AGENT", name: "orphan", hasAccessToSensitiveData: true },
      ],
      edges: [
        { id: "e1", src: "agent", dst: "sa", type: "RUNS_AS" },
        { id: "e2", src: "sa", dst: "store", type: "ALLOWS_ACCESS_TO" },
      ],
      syncedAt: T,
    };
    const stubs = withSensitiveDataNodes(doc).nodes
      .filter((n) => n.kind === "SENSITIVE_DATA")
      .map((n) => n.id);
    expect(stubs).toEqual(["sensitive|orphan"]);
  });

  it("keeps every stub when the chain was never synced (an older graph)", () => {
    // No ALLOWS_ACCESS_TO edges at all: the suppression set comes back empty and the
    // topology is exactly what it was before this existed. This is what lets an
    // already-synced ledger keep working without a re-sync.
    const doc: GraphDoc = {
      nodes: [
        { id: "agent", kind: "AI_AGENT", name: "agent", hasAccessToSensitiveData: true },
        { id: "store", kind: "BUCKET", name: "store", hasSensitiveData: true },
      ],
      edges: [],
      syncedAt: T,
    };
    const out = withSensitiveDataNodes(doc);
    const bySrc = new Map(
      out.edges.map((e) => [e.src, e.type]),
    );
    expect(bySrc.get("store")).toBe("HAS_SENSITIVE_DATA");
    expect(bySrc.get("agent")).toBe("HAS_ACCESS_TO_SENSITIVE_DATA");
  });

  it("withDataFindingNodes aggregates per store, with a worst severity and a count", () => {
    const doc: GraphDoc = {
      nodes: [
        {
          id: "store", kind: "BUCKET", name: "store", hasSensitiveData: true,
          dataFindingCount: 3, dataFindingSeverities: { CRITICAL: 1, HIGH: 2 },
        },
        // Reached, nothing found: no aggregate, because there is nothing to aggregate.
        { id: "clean", kind: "BUCKET", name: "clean", hasSensitiveData: true, dataFindingCount: 0 },
        // Never reached by the traversal at all — also no aggregate, for a different reason.
        { id: "unasked", kind: "DATABASE", name: "unasked", hasSensitiveData: true },
      ],
      edges: [],
      syncedAt: T,
    };
    const out = withDataFindingNodes(doc);
    const findings = out.nodes.filter((n) => n.kind === "DATA_FINDING");
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("datafinding|store");
    expect(findings[0].name).toBe("Data Findings");
    expect(findings[0].summaryCount).toBe(3);
    expect(findings[0].severity).toBe("CRITICAL");
    expect(out.edges).toEqual([
      { id: edgeId("store", "HAS_DATA_FINDING", "datafinding|store"),
        src: "store", dst: "datafinding|store", type: "HAS_DATA_FINDING" },
    ]);

    // Idempotent — re-applying must not duplicate the aggregate.
    expect(withDataFindingNodes(out).nodes.filter((n) => n.kind === "DATA_FINDING")).toHaveLength(1);
  });

  it("withSensitiveDataNodes is idempotent and covers isolated (edge-less) assets", () => {
    // The reported bug: an inventory-sourced AI_DATASET that holds sensitive data with
    // zero relationship edges (like "Bedrock Logs Dataset") — a topological island.
    const island: GraphDoc = {
      nodes: [{ id: "bedrock-logs", kind: "AI_DATASET", name: "Bedrock Logs Dataset", hasSensitiveData: true }],
      edges: [],
      syncedAt: T,
    };
    const once = withSensitiveDataNodes(island);
    expect(once.nodes).toHaveLength(2);
    expect(once.edges).toHaveLength(1);
    expect(once.edges[0].type).toBe("HAS_SENSITIVE_DATA");
    expect(once.edges[0].dst).toBe("sensitive|bedrock-logs");
    // Re-applying must not duplicate the stub.
    const twice = withSensitiveDataNodes(once);
    expect(twice.nodes).toHaveLength(2);
    expect(twice.edges).toHaveLength(1);
  });

  it("does NOT persist INTERNET_EXPOSURE topology (derived on read, not at sync)", () => {
    const doc = enriched();
    expect(doc.nodes.some((n) => n.kind === "INTERNET_EXPOSURE")).toBe(false);
    expect(doc.edges.some((e) => e.type === "EXPOSED_TO_INTERNET")).toBe(false);
  });

  it("withInternetExposureNodes adds one node + edge per internet-exposed asset", () => {
    const base = enriched();
    const doc = withInternetExposureNodes(base);
    const exposed = base.nodes.filter(
      (n) => n.isAccessibleFromInternet === true || n.isOpenToAllInternet === true,
    );
    const expNodes = doc.nodes.filter((n) => n.kind === "INTERNET_EXPOSURE");
    const expEdges = doc.edges.filter((e) => e.type === "EXPOSED_TO_INTERNET");
    expect(exposed.length).toBeGreaterThan(0); // seed has run-agent-h
    expect(expNodes).toHaveLength(exposed.length);
    expect(expEdges).toHaveLength(exposed.length);
    for (const e of expEdges) {
      expect(e.dst).toBe(`internet|${e.src}`);
      expect(expNodes.some((n) => n.id === e.dst)).toBe(true);
    }
    expect(expEdges.some((e) => e.src === "run-agent-h")).toBe(true);
  });

  it("withInternetExposureNodes ignores false/null exposure and is idempotent", () => {
    const doc: GraphDoc = {
      nodes: [
        { id: "public-vm", kind: "VIRTUAL_MACHINE", name: "public", isAccessibleFromInternet: true },
        { id: "private-vm", kind: "VIRTUAL_MACHINE", name: "private", isAccessibleFromInternet: false },
        // null = inherited/undetermined — must NOT materialize an exposure node.
        { id: "hosted-agent", kind: "AI_AGENT", name: "hosted", isAccessibleFromInternet: null },
      ],
      edges: [],
      syncedAt: T,
    };
    const once = withInternetExposureNodes(doc);
    const expNodes = once.nodes.filter((n) => n.kind === "INTERNET_EXPOSURE");
    expect(expNodes).toHaveLength(1);
    expect(once.edges).toHaveLength(1);
    expect(once.edges[0].dst).toBe("internet|public-vm");
    // Idempotent.
    const twice = withInternetExposureNodes(once);
    expect(twice.nodes.filter((n) => n.kind === "INTERNET_EXPOSURE")).toHaveLength(1);
    expect(twice.edges).toHaveLength(1);
  });

  it("reproduces the applied-table AARS end-to-end (hint path)", () => {
    const doc = enriched();
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    expect(byId.get("agent-autogen")?.aars).toBe(76);
    expect(byId.get("agent-autogen")?.aarsSeverity).toBe("CRITICAL");
    expect(byId.get("agent-h-chatbot")?.aars).toBe(71);
    expect(byId.get("agent-h-chatbot")?.aarsSeverity).toBe("CRITICAL");
    expect(byId.get("agent-d")?.aars).toBe(67);
    expect(byId.get("agent-g")?.aars).toBe(66);
    expect(byId.get("agent-i")?.aars).toBe(66);
    expect(byId.get("agent-a")?.aars).toBe(62);
    expect(byId.get("agent-j")?.aars).toBe(29);
    expect(byId.get("agent-j")?.aarsSeverity).toBe("LOW");
  });

  it("asset severity = worst adjusted issue severity; combo membership attached", () => {
    const doc = enriched();
    const agentA = doc.nodes.find((n) => n.id === "agent-a")!;
    expect(agentA.severity).toBe("HIGH"); // MEDIUM native, adjusted HIGH
    expect(agentA.comboGroups).toEqual(["gcp-managed-privileged"]);
    const agentJ = doc.nodes.find((n) => n.id === "agent-j")!;
    expect(agentJ.severity).toBe("MEDIUM"); // LOW native, adjusted MEDIUM
  });

  it("healthy protected agent scores INFO and carries no combo membership", () => {
    const doc = enriched();
    const safe = doc.nodes.find((n) => n.id === "agent-l-support")!;
    expect(safe.aarsSeverity).toBe("INFO");
    expect(safe.severity).toBeUndefined();
    expect(safe.comboGroups).toBeUndefined();
  });

  it("is pure: input document is not mutated", () => {
    const raw = seedGraphDoc(T);
    const before = JSON.stringify(raw);
    enrichGraphDoc(raw, SEED_ISSUES, SEED_AARS_HINTS);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("records the inputs beside the score, so a rescore can re-price these exact gaps", () => {
    const agentA = enriched().nodes.find((n) => n.id === "agent-a")!;
    expect(agentA.aarsInput).toEqual({
      gaps: [{ code: "LLM06" }, { code: "NO_GUARDRAIL" }],
      dataExposure: "SENSITIVE",
      // Recorded even though the spec rule prices it at 0: pillar D must be re-priceable
      // from the persisted input, exactly like the gaps beside it.
      internetExposure: "NONE",
    });
  });

  it("re-enriching its own asset nodes reproduces the same scores", () => {
    // What rescoreInventory does: the tabs keep only the real nodes, so the second pass
    // gets exactly this input. Feeding back the recorded inputs must be a fixed point, or
    // a recompute under an unchanged rule would silently move the inventory.
    const once = enriched();
    const assets = once.nodes.filter((n) => n.kind !== "ISSUE" && n.kind !== "SUMMARY");
    const hints: Record<string, NonNullable<GNode["aarsInput"]>> = {};
    for (const n of assets) if (n.aarsInput) hints[n.id] = n.aarsInput;

    const twice = enrichGraphDoc(
      { nodes: assets, edges: once.edges.filter((e) => e.type !== "HAS_ISSUE"), syncedAt: T },
      SEED_ISSUES,
      hints,
    );
    const scoreOf = (doc: GraphDoc) =>
      doc.nodes
        .filter((n) => n.aars !== undefined)
        .map((n) => `${n.id}:${n.aars}:${n.aarsSeverity}`)
        .sort();
    expect(scoreOf(twice)).toEqual(scoreOf(once));
  });

  it("re-enriching does not duplicate the ISSUE nodes it materializes", () => {
    const once = enriched();
    const assets = once.nodes.filter((n) => n.kind !== "ISSUE" && n.kind !== "SUMMARY");
    const twice = enrichGraphDoc(
      { nodes: assets, edges: once.edges.filter((e) => e.type !== "HAS_ISSUE"), syncedAt: T },
      SEED_ISSUES,
      SEED_AARS_HINTS,
    );
    expect(twice.nodes.filter((n) => n.kind === "ISSUE")).toHaveLength(
      once.nodes.filter((n) => n.kind === "ISSUE").length,
    );
    expect(new Set(twice.nodes.map((n) => n.id)).size).toBe(twice.nodes.length);
    expect(new Set(twice.edges.map((e) => e.id)).size).toBe(twice.edges.length);
  });

  it("scores through a supplied rule, not through the defaults", () => {
    const doc = enrichGraphDoc(seedGraphDoc(T), SEED_ISSUES, SEED_AARS_HINTS, {
      ...DEFAULT_AARS_RULE,
      bands: { critical: 60, high: 50, medium: 30, low: 10 },
    });
    const agentA = doc.nodes.find((n) => n.id === "agent-a")!;
    expect(agentA.aars).toBe(62);
    expect(agentA.aarsSeverity).toBe("CRITICAL"); // HIGH under the default bands
  });
});

describe("enrichGraphDoc — businessImpact (asset-level worst-of)", () => {
  const doc = (projects: GNode["projects"]): GraphDoc => ({
    nodes: [{ id: "n", kind: "AI_AGENT", name: "n", projects }],
    edges: [],
    syncedAt: T,
  });

  it("folds the worst of the node's own projects onto businessImpact", () => {
    const out = enrichGraphDoc(doc([
      { id: "p1", name: "one", businessImpact: "LBI" },
      { id: "p2", name: "two", businessImpact: "HBI" },
    ]), []);
    expect(out.nodes[0].businessImpact).toBe("HBI");
  });

  it("leaves it unset for no projects, or projects with no recognised tier", () => {
    expect(enrichGraphDoc(doc(undefined), []).nodes[0].businessImpact).toBeUndefined();
    expect(enrichGraphDoc(doc([]), []).nodes[0].businessImpact).toBeUndefined();
    expect(enrichGraphDoc(doc([{ id: "p1", name: "one" }]), []).nodes[0].businessImpact)
      .toBeUndefined();
  });

  it("never moves a score — it is folded independently of the AARS pillars", () => {
    const withImpact = enrichGraphDoc(
      doc([{ id: "p1", name: "one", businessImpact: "HBI" }]),
      SEED_ISSUES,
      SEED_AARS_HINTS,
    ).nodes[0];
    const without = enrichGraphDoc(doc(undefined), SEED_ISSUES, SEED_AARS_HINTS).nodes[0];
    expect(withImpact.aars).toBe(without.aars);
    expect(withImpact.aarsPillars).toEqual(without.aarsPillars);
  });
});

describe("enrichGraphDoc — aarsInput.derivedUnder", () => {
  const issue = (over: Partial<IssueRow>): IssueRow => ({
    id: "iss-1", ruleId: "r", ruleName: "r", comboGroup: "other",
    nativeSeverity: "LOW" as Severity, adjustedSeverity: "LOW" as Severity,
    status: "OPEN", assetId: "n", assetName: "n", ...over,
  });
  const node: GNode = { id: "n", kind: "AI_AGENT", name: "n" };

  it("a fresh no-hint derivation is stamped with today's signature", () => {
    const out = enrichGraphDoc({ nodes: [node], edges: [], syncedAt: T }, [issue({})]);
    expect(out.nodes[0].aarsInput?.derivedUnder).toBe(derivationSignature(DEFAULT_AARS_RULE));
  });

  it("buildAarsHintsFromFindings' hints are stamped too — they are a fresh derivation", () => {
    const findings: FindingRow[] = [{
      id: "f1", resourceId: "n", ruleShortId: "SUB-1", severity: "HIGH" as Severity,
      frameworkCodes: ["LLM06"], status: "OPEN", result: "FAIL",
    }];
    const hints = buildAarsHintsFromFindings(findings, { nodes: [node], edges: [], syncedAt: T }, []);
    expect(hints["n"]?.derivedUnder).toBe(derivationSignature(DEFAULT_AARS_RULE));
    const out = enrichGraphDoc({ nodes: [node], edges: [], syncedAt: T }, [], hints);
    expect(out.nodes[0].aarsInput?.derivedUnder).toBe(derivationSignature(DEFAULT_AARS_RULE));
  });

  it("a pinned hint with no signature of its own (SEED_AARS_HINTS) stays unstamped", () => {
    const agentA = enriched().nodes.find((n) => n.id === "agent-a")!;
    expect(agentA.aarsInput?.derivedUnder).toBeUndefined();
  });

  it("a reused persisted input keeps ITS OWN signature, not today's", () => {
    const stale = derivationSignature({
      ...DEFAULT_AARS_RULE,
      gapSources: { ...DEFAULT_AARS_RULE.gapSources, fiveRs: true },
    });
    const hints = { n: { gaps: [], dataExposure: "NONE" as const, derivedUnder: stale } };
    const out = enrichGraphDoc({ nodes: [node], edges: [], syncedAt: T }, [], hints);
    expect(out.nodes[0].aarsInput?.derivedUnder).toBe(stale);
    expect(out.nodes[0].aarsInput?.derivedUnder).not.toBe(derivationSignature(DEFAULT_AARS_RULE));
  });
});

// The three dead rows. Each of these codes is priced by DEFAULT_AARS_RULE's cascade and
// emitted by nothing, so the rows can never fire — not shadowed, unreachable. Each source
// is off by default, which is what keeps the applied table intact.
describe("deriveAarsInput — gapSources", () => {
  const node = (over: Partial<GNode>): GNode =>
    ({ id: "n", kind: "AI_AGENT", name: "n", ...over }) as GNode;
  const issue = (over: Partial<IssueRow>): IssueRow =>
    ({
      id: "i", ruleId: "r", ruleName: "r", comboGroup: "g",
      nativeSeverity: "MEDIUM", adjustedSeverity: "HIGH", status: "OPEN",
      assetId: "n", assetName: "n", ...over,
    }) as IssueRow;
  const codes = (input: { gaps: Array<{ code: string }> }) => input.gaps.map((g) => g.code);
  const on = (over: Partial<AarsRule["gapSources"]>): AarsRule =>
    cleanAarsRule({ ...DEFAULT_AARS_RULE, gapSources: { ...DEFAULT_AARS_RULE.gapSources, ...over } });

  const withFiveRs = [issue({ frameworks: { owaspLlm: ["LLM06"], fiveRs: ["Restrict", "Reduce"] } })];

  it("raises none of them under the spec rule", () => {
    expect(codes(deriveAarsInput(node({ status: "Deprecated" }), withFiveRs)))
      .toEqual(["LLM06"]);
    expect(codes(deriveAarsInput(node({ status: "Inactive" }), withFiveRs)))
      .toEqual(["LLM06"]);
  });

  it("fiveRs turns the issue's 5Rs mapping into codes the cascade already prices", () => {
    const got = codes(deriveAarsInput(node({}), withFiveRs, on({ fiveRs: true })));
    expect(got).toContain("5R_RESTRICT");
    expect(got).toContain("5R_REDUCE");
    // And those land on the default cascade's `prefix 5R` row rather than the fallback.
    expect(gapPointsFor("5R_RESTRICT", DEFAULT_AARS_RULE)).toBe(5);
  });

  it("deprecatedModel reads the asset's own status, and only that status", () => {
    expect(codes(deriveAarsInput(node({ status: "Deprecated" }), [], on({ deprecatedModel: true }))))
      .toEqual(["DEPRECATED_MODEL"]);
    expect(codes(deriveAarsInput(node({ status: "Active" }), [], on({ deprecatedModel: true }))))
      .toEqual([]);
  });

  it("inactiveAgent flags the dormant-but-privileged agent (ASI10)", () => {
    expect(codes(deriveAarsInput(node({ status: "Inactive" }), [], on({ inactiveAgent: true }))))
      .toEqual(["INACTIVE_AGENT"]);
  });

  it("matches status case-insensitively — the sheet round-trips free text", () => {
    expect(codes(deriveAarsInput(node({ status: "  inactive " }), [], on({ inactiveAgent: true }))))
      .toEqual(["INACTIVE_AGENT"]);
  });
});

describe("buildAarsHintsFromFindings — findingSeverityWeights", () => {
  const doc: GraphDoc = {
    nodes: [{ id: "n", kind: "AI_AGENT", name: "n" }],
    edges: [],
    syncedAt: T,
  };
  const finding = (severity: Severity, code: string): FindingRow =>
    ({ id: `f-${code}`, resourceId: "n", ruleShortId: code, severity, frameworkCodes: [code] });

  it("adds no per-gap override at the spec weights, so the input stays byte-identical", () => {
    const hints = buildAarsHintsFromFindings([finding("CRITICAL", "SUB-082")], doc, []);
    expect(hints["n"]!.gaps).toEqual([{ code: "SUB-082" }]);
  });

  it("prices a CRITICAL failing control above a LOW one once weights are tuned", () => {
    const rule = cleanAarsRule({
      ...DEFAULT_AARS_RULE,
      findingSeverityWeights: { CRITICAL: 2, HIGH: 1.5, MEDIUM: 1, LOW: 0.5 },
    });
    const hints = buildAarsHintsFromFindings(
      [finding("CRITICAL", "SUB-082"), finding("LOW", "SUB-114")],
      doc,
      [],
      rule,
    );
    // Both fall to the cascade's fallback of 5, then take their weight.
    expect(hints["n"]!.gaps).toEqual([{ code: "SUB-082", points: 10 }, { code: "SUB-114", points: 3 }]);
  });

  it("weights a code by the WORST finding that contributed it", () => {
    const rule = cleanAarsRule({
      ...DEFAULT_AARS_RULE,
      findingSeverityWeights: { CRITICAL: 2, HIGH: 1, MEDIUM: 1, LOW: 1 },
    });
    const hints = buildAarsHintsFromFindings(
      [finding("LOW", "SUB-082"), { ...finding("CRITICAL", "SUB-082"), id: "f2" }],
      doc,
      [],
      rule,
    );
    expect(hints["n"]!.gaps).toEqual([{ code: "SUB-082", points: 10 }]);
  });
});

describe("internetExposureOf", () => {
  const node = (over: Partial<GNode>): GNode =>
    ({ id: "a", kind: "AI_AGENT", name: "a", ...over }) as GNode;

  it("reads a confirmed exposure from either flag", () => {
    expect(internetExposureOf(node({ isAccessibleFromInternet: true }))).toBe("CONFIRMED");
    expect(internetExposureOf(node({ isOpenToAllInternet: true }))).toBe("CONFIRMED");
  });

  it("keeps an unevaluated hosted agent UNDETERMINED — never CONFIRMED, never NONE", () => {
    expect(internetExposureOf(node({ isAccessibleFromInternet: null }))).toBe("UNDETERMINED");
    expect(internetExposureOf(node({}))).toBe("UNDETERMINED");
    expect(
      internetExposureOf(node({ isAccessibleFromInternet: false, isOpenToAllInternet: null })),
    ).toBe("UNDETERMINED");
  });

  it("is NONE only when both flags are explicitly false", () => {
    expect(
      internetExposureOf(node({ isAccessibleFromInternet: false, isOpenToAllInternet: false })),
    ).toBe("NONE");
  });
});

describe("dataExposureOf", () => {
  it("classifies sensitive access, then privilege, then none", () => {
    expect(dataExposureOf({ id: "a", kind: "AI_AGENT", name: "a", hasAccessToSensitiveData: true }))
      .toBe("SENSITIVE");
    expect(dataExposureOf({ id: "a", kind: "AI_AGENT", name: "a", hasSensitiveData: true }))
      .toBe("SENSITIVE");
    expect(dataExposureOf({ id: "a", kind: "AI_AGENT", name: "a", hasHighPrivileges: true }))
      .toBe("DATA_ACCESS");
    expect(dataExposureOf({ id: "a", kind: "AI_AGENT", name: "a", hasAdminPrivileges: true }))
      .toBe("DATA_ACCESS");
    expect(dataExposureOf({ id: "a", kind: "AI_AGENT", name: "a" })).toBe("NONE");
  });
});

describe("buildAarsHintsFromFindings", () => {
  const doc: GraphDoc = {
    nodes: [
      { id: "asset-1", kind: "AI_AGENT", name: "A", hasAccessToSensitiveData: true, guardrailMissing: true },
      { id: "asset-2", kind: "AI_AGENT", name: "B" },
    ],
    edges: [],
    syncedAt: T,
  };
  const issues: IssueRow[] = [{
    id: "iss-1", ruleId: "wc-id-3217", ruleName: "r", comboGroup: "gcp-managed-privileged",
    nativeSeverity: "MEDIUM", adjustedSeverity: "HIGH", status: "OPEN",
    assetId: "asset-1", assetName: "A",
    frameworks: { owaspLlm: ["LLM06"] },
  }];
  const findings: FindingRow[] = [
    { id: "f1", resourceId: "asset-1", ruleShortId: "SUB-082", severity: "MEDIUM", frameworkCodes: ["SUB-082", "LLM06"] },
    { id: "f2", resourceId: "missing", ruleShortId: "SUB-099", severity: "LOW", frameworkCodes: ["SUB-099"] },
  ];

  it("unions finding gaps with the issue-framework heuristic + guardrail, deduped", () => {
    const hints = buildAarsHintsFromFindings(findings, doc, issues);
    const h = hints["asset-1"];
    expect(h).toBeDefined();
    const codes = h.gaps.map((g) => g.code).sort();
    // LLM06 from the issue AND the finding (deduped once), NO_GUARDRAIL from the flag,
    // SUB-082 from the finding.
    expect(codes).toEqual(["LLM06", "NO_GUARDRAIL", "SUB-082"]);
    expect(h.dataExposure).toBe("SENSITIVE");
  });

  it("omits resources with no node match, and assets with no findings", () => {
    const hints = buildAarsHintsFromFindings(findings, doc, issues);
    expect(hints["missing"]).toBeUndefined(); // finding f2's resource isn't in the doc
    expect(hints["asset-2"]).toBeUndefined(); // no finding
  });

  // The gate that moved. It used to sit in normalizeConfigFindingsPage, which stored
  // nothing but FAIL + OPEN; now the register also keeps RESOLVED and PASS rows for the
  // lifecycle clock, so without isOpenGap here a control someone already fixed would go
  // on scoring against the asset forever.
  it("prices only failing, open, live findings", () => {
    const priced = (extra: Partial<FindingRow>) =>
      buildAarsHintsFromFindings(
        [{
          id: "f", resourceId: "asset-2", ruleShortId: "SUB-500", severity: "HIGH",
          frameworkCodes: ["SUB-500"], status: "OPEN", result: "FAIL", ...extra,
        }],
        doc,
        [],
      )["asset-2"];

    expect(priced({})).toBeDefined();
    expect(priced({ status: "RESOLVED", result: "PASS" })).toBeUndefined();
    expect(priced({ status: "REJECTED" })).toBeUndefined();
    expect(priced({ deleted: true })).toBeUndefined();
  });

  // The upgrade guarantee: rows written before the tab carried result/status still price
  // exactly what they used to. Every fixture above omits both fields, so the whole of the
  // rest of this file is already asserting it — this names it so a future change to
  // isOpenGap's absent-is-permissive rule fails somewhere that says why.
  it("still prices a legacy row that carries neither result nor status", () => {
    const hints = buildAarsHintsFromFindings(findings, doc, issues);
    expect(hints["asset-1"]!.gaps.map((g) => g.code)).toContain("SUB-082");
  });
});

// ---------------------------------------------------------------------------
// Excessive rights + missing guardrail: the same read-time contract as the
// sensitive-data and internet-exposure topologies above — derived, never
// persisted, idempotent, pure.

describe("withExcessivePrivilegeNodes", () => {
  it("adds one node + HAS_EXCESSIVE_PRIVILEGE edge per over-privileged node", () => {
    const base = enriched();
    const doc = withExcessivePrivilegeNodes(base);
    const realFindingSrc = new Set(
      base.edges
        .filter(
          (e) =>
            e.type === "HAS_FINDING" &&
            base.nodes.some((n) => n.id === e.dst && n.kind === "EXCESSIVE_ACCESS_FINDING"),
        )
        .map((e) => e.src),
    );
    const flagged = base.nodes.filter(
      (n) => (n.hasAdminPrivileges || n.hasHighPrivileges) && !realFindingSrc.has(n.id),
    );
    expect(flagged.length).toBeGreaterThan(0);

    const privNodes = doc.nodes.filter((n) => n.kind === "EXCESSIVE_PRIVILEGE");
    const privEdges = doc.edges.filter((e) => e.type === "HAS_EXCESSIVE_PRIVILEGE");
    expect(privNodes).toHaveLength(flagged.length);
    expect(privEdges).toHaveLength(flagged.length);

    const baseIds = new Set(base.nodes.map((n) => n.id));
    for (const e of privEdges) {
      expect(baseIds.has(e.src)).toBe(true);
      expect(e.dst).toBe(`excessive|${e.src}`);
    }
  });

  it("does not double up on nodes Wiz already reported an EXCESSIVE_ACCESS_FINDING for", () => {
    // sa-agent-autogen carries the real CIEM finding in the seed.
    const doc = withExcessivePrivilegeNodes(enriched());
    expect(doc.nodes.some((n) => n.id === "excessive|sa-agent-autogen")).toBe(false);
    expect(doc.nodes.some((n) => n.id === "finding-ea-autogen")).toBe(true);
  });

  it("names the node for the stronger claim when both privilege flags are set", () => {
    const doc = withExcessivePrivilegeNodes({
      nodes: [
        { id: "a", kind: "AI_AGENT", name: "a", hasAdminPrivileges: true, hasHighPrivileges: true },
        { id: "b", kind: "AI_AGENT", name: "b", hasHighPrivileges: true },
      ],
      edges: [],
      syncedAt: T,
    });
    expect(doc.nodes.find((n) => n.id === "excessive|a")!.name).toBe("Admin privileges");
    expect(doc.nodes.find((n) => n.id === "excessive|b")!.name).toBe("Excessive rights");
  });

  it("is idempotent and returns the same doc when nothing is flagged", () => {
    const once = withExcessivePrivilegeNodes(enriched());
    const twice = withExcessivePrivilegeNodes(once);
    expect(twice.nodes).toHaveLength(once.nodes.length);
    expect(twice.edges).toHaveLength(once.edges.length);

    const clean: GraphDoc = {
      nodes: [{ id: "a", kind: "AI_AGENT", name: "a" }],
      edges: [],
      syncedAt: T,
    };
    expect(withExcessivePrivilegeNodes(clean)).toBe(clean);
  });
});

describe("withIdentityAccessNodes", () => {
  /** A minimal doc: one agent, one human, one service account, one non-AI resource. */
  function doc(edges: GraphDoc["edges"], extraNodes: GNode[] = []): GraphDoc {
    return {
      syncedAt: T,
      nodes: [
        { id: "agent", kind: "AI_AGENT", name: "agent" },
        { id: "human", kind: "USER_ACCOUNT", name: "ops@example.com" },
        { id: "sa", kind: "SERVICE_ACCOUNT", name: "sa" },
        { id: "bucket", kind: "BUCKET", name: "bucket" },
        ...extraNodes,
      ],
      edges,
    };
  }
  const allows = (src: string, dst: string, accessType: "ADMIN" | "HIGH_PRIVILEGE" | "READ") => ({
    id: `${src}|ALLOWS_ACCESS_TO|${dst}`, src, dst, type: "ALLOWS_ACCESS_TO" as const, accessType,
  });

  it("adds one finding per AI asset a human can reach at high privilege", () => {
    const out = withIdentityAccessNodes(doc([allows("human", "agent", "ADMIN")]));
    const found = out.nodes.filter((n) => n.kind === "IDENTITY_ACCESS_FINDING");
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe("identityaccess|agent");
    expect(out.edges.filter((e) => e.dst === "identityaccess|agent")).toEqual([
      { id: "agent|HAS_FINDING|identityaccess|agent", src: "agent", dst: "identityaccess|agent", type: "HAS_FINDING" },
    ]);
  });

  // A service account reaching the agent it runs is normal operation, not a finding —
  // and the graph already draws that identity and that edge.
  it("ignores machine identities", () => {
    const base = doc([allows("sa", "agent", "ADMIN")]);
    expect(withIdentityAccessNodes(base)).toBe(base);
  });

  it("ignores read-level access", () => {
    const base = doc([allows("human", "agent", "READ")]);
    expect(withIdentityAccessNodes(base)).toBe(base);
  });

  it("ignores access to resources that are not AI assets", () => {
    const base = doc([allows("human", "bucket", "ADMIN")]);
    expect(withIdentityAccessNodes(base)).toBe(base);
  });

  // The rule withExcessivePrivilegeNodes already applies: the tenant's own finding is the
  // better evidence, and drawing both shows one problem twice.
  it("defers to a real EXCESSIVE_ACCESS_FINDING on the same asset", () => {
    const base = doc(
      [
        allows("human", "agent", "ADMIN"),
        { id: "agent|HAS_FINDING|ea", src: "agent", dst: "ea", type: "HAS_FINDING" as const },
      ],
      [{ id: "ea", kind: "EXCESSIVE_ACCESS_FINDING", name: "Excessive access" }],
    );
    expect(withIdentityAccessNodes(base)).toBe(base);
  });

  it("emits one finding however many humans reach the asset", () => {
    const out = withIdentityAccessNodes(
      doc(
        [allows("human", "agent", "ADMIN"), allows("human2", "agent", "HIGH_PRIVILEGE")],
        [{ id: "human2", kind: "USER_ACCOUNT", name: "other@example.com" }],
      ),
    );
    expect(out.nodes.filter((n) => n.kind === "IDENTITY_ACCESS_FINDING")).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = withIdentityAccessNodes(doc([allows("human", "agent", "ADMIN")]));
    expect(withIdentityAccessNodes(once)).toBe(once);
  });
});

describe("withMissingGuardrailNodes", () => {
  it("adds one node per unguarded asset, joined by a NEGATED PROTECTED_BY edge", () => {
    const base = enriched();
    const doc = withMissingGuardrailNodes(base);
    const flagged = base.nodes.filter((n) => n.guardrailMissing === true);
    expect(flagged.length).toBeGreaterThan(0);

    const gapNodes = doc.nodes.filter((n) => n.kind === "MISSING_GUARDRAIL");
    expect(gapNodes).toHaveLength(flagged.length);
    expect(gapNodes.every((n) => n.name === "No guardrail")).toBe(true);

    const gapEdges = doc.edges.filter((e) => e.dst.startsWith("noguardrail|"));
    expect(gapEdges).toHaveLength(flagged.length);
    // The absence must stay marked as an absence, or it reads as coverage.
    expect(gapEdges.every((e) => e.type === "PROTECTED_BY" && e.negated === true)).toBe(true);
  });

  it("ignores a merely absent flag — only an explicit true is a finding", () => {
    const doc = withMissingGuardrailNodes({
      nodes: [
        { id: "a", kind: "AI_AGENT", name: "a" },
        { id: "b", kind: "AI_AGENT", name: "b", guardrailMissing: false },
      ],
      edges: [],
      syncedAt: T,
    });
    expect(doc.nodes.some((n) => n.kind === "MISSING_GUARDRAIL")).toBe(false);
  });

  it("is idempotent", () => {
    const once = withMissingGuardrailNodes(enriched());
    const twice = withMissingGuardrailNodes(once);
    expect(twice.nodes).toHaveLength(once.nodes.length);
    expect(twice.edges).toHaveLength(once.edges.length);
  });
});
