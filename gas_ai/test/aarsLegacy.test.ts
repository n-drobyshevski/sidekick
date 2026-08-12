// Reading data written before AARS bands were renamed to AARS severity. Both durable
// stores — the Drive graph snapshot and the ai_assets tab — must keep scoring an
// existing tenant without a re-sync, values (`MINIMAL`) included.

import { describe, expect, it } from "vitest";
import type { GraphDoc } from "../src/domain/graphTypes";
import { normalizeLegacyAars, rowToAsset } from "../src/server/syncStore";

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
});
