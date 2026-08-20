// The lineage traversal: pipeline/dataset provenance, the 79% of the register nothing has
// ever asked about.
//
// Three things can go wrong here and only one of them announces itself. A wrong entity type
// or a quoted enum is REFUSED, loudly, by the gateway. A wrong relationship name is refused
// too. But a hop walked from the wrong end returns ZERO ROWS and no error at all — and on a
// register where zero rows is also the honest answer for "this tenant has no lineage", that
// failure is indistinguishable from the finding. So the direction pins below are the point of
// this file, not decoration.

import { describe, expect, it } from "vitest";

import {
  AGENT_EXPANSION,
  HOP,
  flattenSlots,
  specVocabulary,
  toGraphEntityQuery,
} from "../src/domain/graphExpand";
import {
  LINEAGE_ROOT_CANDIDATES,
  lineageRoots,
  lineageSpec,
} from "../src/domain/lineageQuery";
import { EDGE_TYPES } from "../src/domain/graphTypes";
import { normalizeLineagePage } from "../src/domain/syncNormalize";
import type { Rec } from "../src/domain/util";

describe("lineageSpec — what it sends", () => {
  it("travels as a variable value, never as GraphQL source with quoted enums", () => {
    // The defect that kept four traversals refused for the life of this app. A SelectSpec
    // cannot express the broken form, which is the point of the spec existing at all: the
    // rendered value is an object, its types are arrays, and its relationships are arrays of
    // input OBJECTS rather than bare strings.
    const q = toGraphEntityQuery(lineageSpec()) as Rec;
    expect(Array.isArray(q["type"])).toBe(true);
    expect(q["type"]).toEqual(["AI_PIPELINE", "AI_DATASET"]);
    const rels = q["relationships"] as Rec[];
    expect(rels).toHaveLength(3);
    for (const rel of rels) {
      expect(Array.isArray(rel["type"])).toBe(true);
      expect((rel["type"] as Rec[])[0]).toHaveProperty("type");
      expect(rel["optional"]).toBe(true);
      expect(rel).not.toHaveProperty("negate");
    }
  });

  it("sends nothing AGENT_EXPANSION has not already had accepted", () => {
    // The provenance rule, applied to a whole traversal rather than to one HOP member. Every
    // name here rides on exemples/ai_agent_expand_request.js, which this tenant answered. A
    // fifth hop invented from a remembered introspection log fails HERE.
    const provenEdges = new Set(specVocabulary(AGENT_EXPANSION).edges);
    for (const edge of specVocabulary(lineageSpec()).edges) {
      expect(provenEdges, edge + " is in no capture this repo holds").toContain(edge);
    }
    const provenKinds = new Set(specVocabulary(AGENT_EXPANSION).entities);
    for (const kind of specVocabulary(lineageSpec()).entities) {
      expect(provenKinds, kind + " is in no capture this repo holds").toContain(kind);
    }
  });

  it("transcribes the capture's standing points, not just its names", () => {
    // The existing HOP provenance test checks that a relationship NAME appears in a capture.
    // That is half a hop. The other half is where you stand when you walk it, and a name-only
    // check cannot catch a direction error — which is the one failure that returns zero rows
    // instead of an error. So this pins (standing point, relationship, reverse) triples.
    //
    // AGENT_EXPANSION is safe to derive them from: exemples/ai_agent_expand_request.js is the
    // OUTPUT of toGraphEntityQuery(AGENT_EXPANSION, id), so the spec and the accepted capture
    // cannot drift apart.
    const triples = (spec: ReturnType<typeof lineageSpec>): string[] => {
      const types = Array.isArray(spec.type) ? spec.type : [spec.type];
      const out: string[] = [];
      for (const child of spec.relationships ?? []) {
        const kids = Array.isArray(child.type) ? child.type : [child.type];
        if (child.edge) {
          out.push(
            types.join("|") + " -" + child.edge.type +
            (child.edge.reverse ? " reversed" : "") + "-> " + kids.join("|"),
          );
        }
        out.push(...triples(child));
      }
      return out;
    };
    const proven = new Set(triples(AGENT_EXPANSION));
    const ours = triples(lineageSpec());

    // Two legs are the console's own, standing point and all — asking a pipeline what it reads
    // is a question the capture already asked, unchanged.
    expect(proven).toContain("AI_PIPELINE -READS_DATA_FROM-> AI_DATASET|BUCKET");
    expect(proven).toContain("AI_DATASET|BUCKET -READS_DATA_FROM-> BUCKET|DATABASE");
    expect(ours).toContain("AI_DATASET|BUCKET -READS_DATA_FROM-> BUCKET|DATABASE");

    // PRODUCES exists in the capture ONLY reversed, from the model. That is the evidence that
    // the tenant's edge runs pipeline -> model, and therefore that ours must be forward.
    expect(proven).toContain("AI_MODEL|AI_SERVICE -PRODUCES reversed-> AI_PIPELINE");
    expect([...proven].filter((t) => t.includes("-PRODUCES"))).toHaveLength(1);
    expect(ours.some((t) => t.includes("PRODUCES reversed"))).toBe(false);

    // STORES_DATA_IN is re-anchored: the capture only ever walks it from an agent. Recorded
    // here so that the one leg standing somewhere new is named rather than assumed.
    expect(proven).toContain("AI_AGENT -STORES_DATA_IN-> BUCKET");
    expect([...proven].filter((t) => t.includes("-STORES_DATA_IN"))).toHaveLength(1);
  });

  it("walks PRODUCES forward, which the capture does not", () => {
    // AGENT_EXPANSION reaches AI_PIPELINE by walking PRODUCES with reverse:true, because it
    // stands at the AI_MODEL. The tenant's edge therefore runs pipeline -> model, so from the
    // pipeline the same hop is FORWARD. Transcribing the capture's flag would invert it and
    // return zero rows silently — the one failure mode that looks like a result.
    expect(HOP.PRODUCES).toEqual({ type: "PRODUCES" });
    expect(HOP.READS_DATA_FROM).toEqual({ type: "READS_DATA_FROM" });
    expect(HOP.STORES_DATA_IN).toEqual({ type: "STORES_DATA_IN" });
    expect(JSON.stringify(toGraphEntityQuery(lineageSpec()))).not.toMatch(/reverse/);
  });

  it("persists only names the model declares", () => {
    for (const slot of flattenSlots(lineageSpec())) {
      if (!slot.edgeType) continue;
      expect(EDGE_TYPES as readonly string[], slot.edgeType + " is not an EdgeType")
        .toContain(slot.edgeType);
    }
  });
});

describe("lineageRoots", () => {
  it("narrows to what the tenant declares, because one absent type empties the query", () => {
    // An entity type the tenant's GraphEntityType lacks fails coercion of the WHOLE $query
    // variable, so the step collects nothing and the reason names the type rather than the
    // traversal. That is how DATABASE_SERVER silently emptied the sensitive-data step.
    expect(lineageRoots(["AI_AGENT", "AI_PIPELINE"])).toEqual(["AI_PIPELINE"]);
    expect(lineageRoots(["AI_AGENT", "AI_PIPELINE", "AI_DATASET"]))
      .toEqual(["AI_PIPELINE", "AI_DATASET"]);
  });

  it("falls back to the candidates rather than sending an empty root list", () => {
    // A tenant that cannot be introspected is not a tenant with no pipelines. Asking for what
    // we would have asked for anyway lets it refuse; an empty type list would match nothing
    // and report that as a finding.
    expect(lineageRoots([])).toEqual([...LINEAGE_ROOT_CANDIDATES]);
  });
});

// ------------------------------------------------------------------ the positional decode

const SLOT_TYPES = ["AI_PIPELINE", "AI_MODEL", "AI_DATASET", "BUCKET", "BUCKET"];

/** A graphSearch row: five slots, null wherever an optional leg found nothing. */
function row(present: Array<string | null>): Rec {
  return {
    entities: present.map((id, i) =>
      id === null ? null : { id, name: id, type: SLOT_TYPES[i] },
    ),
  };
}

describe("normalizeLineagePage", () => {
  it("rebuilds each edge from the slot that carried it", () => {
    const part = normalizeLineagePage([
      row(["pipe-1", "model-1", "ds-1", "bucket-1", "bucket-2"]),
    ]);
    expect(part.edges.map((e) => e.src + "|" + e.type + "|" + e.dst)).toEqual([
      "pipe-1|PRODUCES|model-1",
      "pipe-1|READS_DATA_FROM|ds-1",
      "ds-1|READS_DATA_FROM|bucket-1",
      "pipe-1|STORES_DATA_IN|bucket-2",
    ]);
  });

  it("keeps the null padding, so an unmatched leg shifts nothing", () => {
    // The trap this normalizer exists for. entitiesOf compacts the array; on a positional
    // traversal that silently slides every later entity into the wrong slot, and the edges it
    // then builds are plausible and wrong. Here slots 1 and 3 are empty: the surviving edges
    // must still be attributed to the legs that actually returned.
    const part = normalizeLineagePage([row(["pipe-1", null, "ds-1", null, "bucket-2"])]);
    expect(part.edges.map((e) => e.src + "|" + e.type + "|" + e.dst)).toEqual([
      "pipe-1|READS_DATA_FROM|ds-1",
      "pipe-1|STORES_DATA_IN|bucket-2",
    ]);
  });

  it("stands at a dataset too, matching only the leg a dataset has", () => {
    // One traversal, two root kinds. A dataset produces nothing and ingests nothing, so it
    // pads those legs and matches only STORES_DATA_IN. Requiring any leg would have collapsed
    // the query to pipelines that happen to carry all three.
    const r = row([null, null, null, null, "bucket-9"]);
    (r["entities"] as Rec[])[0] = { id: "ds-root", name: "ds-root", type: "AI_DATASET" };
    const part = normalizeLineagePage([r]);
    expect(part.edges).toHaveLength(1);
    expect(part.edges[0]).toMatchObject({
      src: "ds-root",
      dst: "bucket-9",
      type: "STORES_DATA_IN",
    });
  });

  it("skips a row whose arity does not match the spec instead of half-reading it", () => {
    // Arity is the entire basis of the alignment. A row of a different width means every
    // index is suspect, and a partly decoded row writes edges nobody can audit.
    expect(normalizeLineagePage([row(["pipe-1", "model-1"])]).edges).toEqual([]);
    expect(normalizeLineagePage([{ entities: "nope" }]).edges).toEqual([]);
    expect(normalizeLineagePage([{}]).edges).toEqual([]);
  });

  it("collects every entity it decoded, so the stores become register rows", () => {
    const part = normalizeLineagePage([
      row(["pipe-1", "model-1", "ds-1", "bucket-1", "bucket-2"]),
    ]);
    expect(part.nodes.map((n) => n.id))
      .toEqual(["pipe-1", "model-1", "ds-1", "bucket-1", "bucket-2"]);
  });
});
