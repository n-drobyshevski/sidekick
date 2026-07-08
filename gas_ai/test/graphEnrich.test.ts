// Enrichment over the seed graph: severity/AARS/combo membership on assets, ISSUE
// nodes + HAS_ISSUE edges materialized, and the applied-table scores reproduced
// end-to-end through the hint path.

import { describe, expect, it } from "vitest";
import { enrichGraphDoc, withSensitiveDataNodes } from "../src/domain/graphEnrich";
import type { GraphDoc } from "../src/domain/graphTypes";
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
    expect(issueNodes).toHaveLength(29);
    expect(issueEdges).toHaveLength(29);
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

  it("withSensitiveDataNodes adds one node + edge per data-exposed asset (pillar C)", () => {
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
    expect(sensNodes).toHaveLength(flagged.length);
    expect(sensEdges).toHaveLength(flagged.length);

    const baseIds = new Set(base.nodes.map((n) => n.id));
    for (const e of sensEdges) {
      expect(baseIds.has(e.src)).toBe(true);
      expect(e.dst).toBe(`sensitive|${e.src}`);
      expect(sensNodes.some((n) => n.id === e.dst)).toBe(true);
    }

    // HOLDS assets use HAS_SENSITIVE_DATA; access-only assets use HAS_ACCESS_TO_SENSITIVE_DATA.
    const sensBySrc = new Map(sensEdges.map((e) => [e.src, e]));
    expect(sensBySrc.get("bucket-customer-pii")?.type).toBe("HAS_SENSITIVE_DATA");
    expect(sensBySrc.get("agent-a")?.type).toBe("HAS_ACCESS_TO_SENSITIVE_DATA");

    // Synthetic nodes never carry an AARS score.
    for (const n of sensNodes) expect(n.aars).toBeUndefined();
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

  it("reproduces the applied-table AARS end-to-end (hint path)", () => {
    const doc = enriched();
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    expect(byId.get("agent-autogen")?.aars).toBe(76);
    expect(byId.get("agent-autogen")?.aarsBand).toBe("CRITICAL");
    expect(byId.get("agent-h-chatbot")?.aars).toBe(71);
    expect(byId.get("agent-h-chatbot")?.aarsBand).toBe("CRITICAL");
    expect(byId.get("agent-d")?.aars).toBe(67);
    expect(byId.get("agent-g")?.aars).toBe(66);
    expect(byId.get("agent-i")?.aars).toBe(66);
    expect(byId.get("agent-a")?.aars).toBe(62);
    expect(byId.get("agent-j")?.aars).toBe(29);
    expect(byId.get("agent-j")?.aarsBand).toBe("LOW");
  });

  it("asset severity = worst adjusted issue severity; combo membership attached", () => {
    const doc = enriched();
    const agentA = doc.nodes.find((n) => n.id === "agent-a")!;
    expect(agentA.severity).toBe("HIGH"); // MEDIUM native, adjusted HIGH
    expect(agentA.comboGroups).toEqual(["gcp-managed-privileged"]);
    const agentJ = doc.nodes.find((n) => n.id === "agent-j")!;
    expect(agentJ.severity).toBe("MEDIUM"); // LOW native, adjusted MEDIUM
  });

  it("healthy protected agent gets a MINIMAL score and no combo membership", () => {
    const doc = enriched();
    const safe = doc.nodes.find((n) => n.id === "agent-l-support")!;
    expect(safe.aarsBand).toBe("MINIMAL");
    expect(safe.severity).toBeUndefined();
    expect(safe.comboGroups).toBeUndefined();
  });

  it("is pure: input document is not mutated", () => {
    const raw = seedGraphDoc(T);
    const before = JSON.stringify(raw);
    enrichGraphDoc(raw, SEED_ISSUES, SEED_AARS_HINTS);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
