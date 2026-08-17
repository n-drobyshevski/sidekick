// Reading data written before AARS bands were renamed to AARS severity. Both durable
// stores — the Drive graph snapshot and the ai_assets tab — must keep scoring an
// existing tenant without a re-sync, values (`MINIMAL`) included.

import { describe, expect, it } from "vitest";
import { DEFAULT_AARS_RULE } from "../src/domain/aars";
import type { GNode, GraphDoc } from "../src/domain/graphTypes";
import { assetToRow, normalizeLegacyAars, rowToAsset, withCurrentBands } from "../src/server/syncStore";

const T = "2026-06-28T05:00:00Z";

function legacyDoc(): GraphDoc {
  return {
    // `aarsBand` is not on GNode any more, so a legacy snapshot is only expressible
    // through the loose shape JSON.parse actually hands back.
    nodes: [
      { id: "a", kind: "AI_AGENT", name: "a", aars: 76, aarsBand: "CRITICAL" },
      { id: "b", kind: "AI_AGENT", name: "b", aars: 4, aarsBand: "MINIMAL" },
      { id: "c", kind: "AI_AGENT", name: "c" },
    ] as unknown as GraphDoc["nodes"],
    edges: [],
    syncedAt: T,
  };
}

describe("normalizeLegacyAars (Drive snapshot)", () => {
  it("carries a legacy band over to the renamed field", () => {
    const doc = normalizeLegacyAars(legacyDoc());
    expect(doc.nodes[0].aarsSeverity).toBe("CRITICAL");
  });

  it("reads a legacy MINIMAL as INFO", () => {
    const doc = normalizeLegacyAars(legacyDoc());
    expect(doc.nodes[1].aarsSeverity).toBe("INFO");
  });

  it("drops the old key so the shape doesn't carry both spellings forward", () => {
    const doc = normalizeLegacyAars(legacyDoc());
    for (const n of doc.nodes) {
      expect(Object.prototype.hasOwnProperty.call(n, "aarsBand")).toBe(false);
    }
  });

  it("leaves unscored nodes alone and is idempotent", () => {
    const once = normalizeLegacyAars(legacyDoc());
    expect(once.nodes[2].aarsSeverity).toBeUndefined();
    const twice = normalizeLegacyAars(once);
    expect(twice.nodes.map((n) => n.aarsSeverity)).toEqual(["CRITICAL", "INFO", undefined]);
  });

  it("returns the same document when there is nothing legacy to fix", () => {
    const clean: GraphDoc = {
      nodes: [{ id: "a", kind: "AI_AGENT", name: "a" }],
      edges: [],
      syncedAt: T,
    };
    expect(normalizeLegacyAars(clean)).toBe(clean);
  });
});

describe("rowToAsset (ai_assets tab)", () => {
  const base = { id: "a", kind: "AI_AGENT", name: "a", aars: 71 };

  it("reads the current aars_severity column", () => {
    expect(rowToAsset({ ...base, aars_severity: "CRITICAL" }).aarsSeverity).toBe("CRITICAL");
  });

  it("falls back to a pre-rename aars_band column, MINIMAL included", () => {
    expect(rowToAsset({ ...base, aars_band: "HIGH" }).aarsSeverity).toBe("HIGH");
    expect(rowToAsset({ ...base, aars_band: "MINIMAL" }).aarsSeverity).toBe("INFO");
  });

  it("prefers the current column when a half-migrated sheet carries both", () => {
    const row = { ...base, aars_severity: "HIGH", aars_band: "LOW" };
    expect(rowToAsset(row).aarsSeverity).toBe("HIGH");
  });

  it("leaves the field unset for an unscored or unreadable value", () => {
    expect(rowToAsset({ ...base }).aarsSeverity).toBeUndefined();
    expect(rowToAsset({ ...base, aars_severity: "BOGUS" }).aarsSeverity).toBeUndefined();
  });

  it("reads back the persisted AARS inputs, and tolerates a row written without them", () => {
    const input = { gaps: [{ code: "LLM06" }], dataExposure: "SENSITIVE" };
    expect(rowToAsset({ ...base, aars_input_json: JSON.stringify(input) }).aarsInput)
      .toEqual(input);
    expect(rowToAsset({ ...base }).aarsInput).toBeUndefined();
    expect(rowToAsset({ ...base, aars_input_json: "{oops" }).aarsInput).toBeUndefined();
  });
});

describe("rowToAsset — projects_json two-branch reader", () => {
  const base = { id: "a", kind: "AI_AGENT", name: "a" };

  it("a legacy string-array cell still fabricates proj-<name> ids, unchanged", () => {
    const node = rowToAsset({ ...base, projects_json: JSON.stringify(["proj-a", "proj-b"]) });
    expect(node.projects).toEqual([
      { id: "proj-proj-a", name: "proj-a" },
      { id: "proj-proj-b", name: "proj-b" },
    ]);
  });

  it("a current object cell round-trips id, name and businessImpact through", () => {
    const projects = [{ id: "p1", name: "PROJECT-ALPHA", businessImpact: "HBI" }];
    const node = rowToAsset({ ...base, projects_json: JSON.stringify(projects) });
    expect(node.projects).toEqual(projects);
  });

  it("an empty array satisfies both branches identically", () => {
    expect(rowToAsset({ ...base, projects_json: "[]" }).projects).toEqual([]);
    expect(rowToAsset({ ...base }).projects).toEqual([]);
  });

  it("business_impact absent reads as undefined, never a default", () => {
    expect(rowToAsset({ ...base }).businessImpact).toBeUndefined();
    expect(rowToAsset({ ...base, business_impact: "" }).businessImpact).toBeUndefined();
  });

  it("business_impact present reads back verbatim", () => {
    expect(rowToAsset({ ...base, business_impact: "HBI" }).businessImpact).toBe("HBI");
  });
});

describe("assetToRow — projects_json and business_impact", () => {
  it("writes the full project objects and the asset-level worst-of", () => {
    const row = assetToRow({
      id: "a", kind: "AI_AGENT", name: "a",
      projects: [{ id: "p1", name: "one", businessImpact: "MBI" }],
      businessImpact: "MBI",
    } as GNode);
    expect(row["projects_json"]).toBe(
      JSON.stringify([{ id: "p1", name: "one", businessImpact: "MBI" }]),
    );
    expect(row["business_impact"]).toBe("MBI");
  });

  it("writes null, not a default, when the asset has no business impact", () => {
    const row = assetToRow({ id: "a", kind: "AI_AGENT", name: "a" } as GNode);
    expect(row["business_impact"]).toBeNull();
  });
});

describe("withCurrentBands (levels re-derived on read)", () => {
  const bands = { critical: 60, high: 40, medium: 20, low: 5 };
  const node = (over: Partial<GNode>): GNode =>
    ({ id: "a", kind: "AI_AGENT", name: "a", ...over }) as GNode;

  it("renames a stored level to whatever the current thresholds say", () => {
    const out = withCurrentBands([node({ aars: 62, aarsSeverity: "HIGH" })], bands);
    expect(out[0].aarsSeverity).toBe("CRITICAL");
  });

  it("scores a row that has a number but no level at all", () => {
    expect(withCurrentBands([node({ aars: 7 })], bands)[0].aarsSeverity).toBe("LOW");
    expect(withCurrentBands([node({ aars: 25 })], bands)[0].aarsSeverity).toBe("MEDIUM");
    expect(withCurrentBands([node({ aars: 0 })], bands)[0].aarsSeverity).toBe("INFO");
  });

  it("leaves an unscored node to its stored value — that is where MINIMAL still lives", () => {
    const legacy = node({ aarsSeverity: "INFO" });
    expect(withCurrentBands([legacy], bands)[0].aarsSeverity).toBe("INFO");
  });

  it("does not mutate, and returns the same array when nothing needs renaming", () => {
    const nodes = [node({ aars: 62, aarsSeverity: "CRITICAL" })];
    expect(withCurrentBands(nodes, bands)).toBe(nodes);

    const changing = [node({ aars: 62, aarsSeverity: "HIGH" })];
    withCurrentBands(changing, bands);
    expect(changing[0].aarsSeverity).toBe("HIGH");
  });

  it("is a no-op under the default bands for a correctly-scored row", () => {
    const nodes = [node({ aars: 62, aarsSeverity: "HIGH" })];
    expect(withCurrentBands(nodes, DEFAULT_AARS_RULE.bands)).toBe(nodes);
  });
});
