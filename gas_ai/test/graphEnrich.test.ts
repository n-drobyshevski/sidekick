// Enrichment over the seed graph: severity/AARS/combo membership on assets, ISSUE
// nodes + HAS_ISSUE edges materialized, and the applied-table scores reproduced
// end-to-end through the hint path.

import { describe, expect, it } from "vitest";
import { enrichGraphDoc } from "../src/domain/graphEnrich";
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
