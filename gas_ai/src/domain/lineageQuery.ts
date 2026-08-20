// The lineage traversal: what a pipeline produces, what it reads, and where it writes.
//
// WHY THIS EXISTS. `AI_PIPELINE` (7,759 rows) and `AI_DATASET` (3,141) are 79% of the
// register and carry almost no signal. That is not because Wiz knows nothing about them —
// it is because nothing has ever asked. Every battery traversal is rooted either at the
// literal `AI_AGENT` (the four in agentPathQuery.ts) or at the whole resolved AI type list
// with only identity and reachability legs below it (identityQuery.ts, exposureQuery.ts).
// A pipeline can therefore be reached as the ANCHOR of an access or exposure question, and
// never as the subject of a lineage one. This is the first traversal that stands at a
// pipeline and walks what pipelines are for.
//
// EVERY HOP HERE IS ALREADY PROVEN ON THE WIRE, and none of them is new vocabulary. All
// four names are carried by AGENT_EXPANSION (graphExpand.ts), which is transcribed verbatim
// from exemples/ai_agent_expand_request.js and was accepted by this tenant. They are
// registered in `HOP` for the same reason every other hop is: so the provenance test
// refuses a sixth hand-written name.
//
// PROVENANCE, LEG BY LEG — because a relationship name is only half of a hop. The other
// half is where you stand when you walk it, and the capture is evidence about both. Walking
// AGENT_EXPANSION for (standing point, relationship, reverse) triples gives:
//
//   READS_DATA_FROM  forward   standing at AI_PIPELINE          -> AI_DATASET | BUCKET
//   READS_DATA_FROM  forward   standing at AI_DATASET | BUCKET  -> BUCKET | DATABASE
//   READS_DATA_FROM  forward   standing at AI_AGENT             -> AI_DATASET | BUCKET
//   STORES_DATA_IN   forward   standing at AI_AGENT             -> BUCKET
//   PRODUCES         REVERSED  standing at AI_MODEL | AI_SERVICE -> AI_PIPELINE
//
// So the two `READS_DATA_FROM` legs below are not merely name-proven: their standing points
// are the console's own, transcribed unchanged. This traversal asks a pipeline what it reads
// exactly as the capture already did.
//
// The other two are re-anchored, and one of them is the whole reason this header exists:
//
//   · `PRODUCES` appears ONLY reversed, from the model. That tells us the tenant's edge runs
//     pipeline → model — so standing at the PIPELINE the same hop is **forward**. Copying the
//     capture's flag would invert it, and an inverted hop returns zero rows rather than an
//     error: the failure that reads exactly like "this tenant has no lineage". Same lesson as
//     ENTITLES/BOUND_TO, and `test/lineageQuery.test.ts` pins the triples rather than the name.
//
//   · `STORES_DATA_IN` appears only from an AI_AGENT. Standing at a pipeline or a dataset is
//     new, and it is a claim about what those kinds do rather than about the relationship.
//
// WHAT THE EVIDENCE DOES AND DOES NOT SAY. The one captured expansion returned 43 slots
// with 4 matched and 39 null. Of the hops used here, only `STORES_DATA_IN` produced a row
// (slot 7, a staging bucket); the `READS_DATA_FROM` subtree and the whole `PRODUCES`
// pipeline leg came back null. So these names are ACCEPTED, not OBSERVED, and one agent's
// expansion says nothing about 7,759 pipelines either way. An empty result here is a real
// possible answer and must read as `stepRows.LINEAGE = 0`, never as a missing step.
//
// WHAT IS DELIBERATELY LEFT OUT.
//
//   · The `HAS_DATA_FINDING` legs. AGENT_EXPANSION hangs one off every store, and the
//     classified-store findings are where the risk signal actually is. They are omitted
//     from this first version on purpose: `HAS_DATA_FINDING` is a READ_TIME_EDGE_TYPE
//     (reach.ts) that no traversal is supposed to persist, filing a finding needs
//     normalizeSensitiveDataAccessPage's `stores.length === 1` attribution rule, and each
//     extra leg is another way for the step to come back empty for a reason that is not
//     "this tenant has no lineage". The question this step has to answer first is whether a
//     pipeline-rooted traversal returns anything at all. The findings are the next change,
//     with the slot arity test to catch the shift.
//
//   · Project scope. `scope` is a parameter and the caller passes `null`, tenant-wide, like
//     the four agent-rooted traversals. Scoping it would cap the reachable population at one
//     project while the inventory that produced the 7,759 pipelines is tenant-wide — so a low
//     Enriched number would be guaranteed by construction, and it would import the exact
//     confound the exposure steps are currently suspected of carrying.
//
//   · `VERSION_OF`, `REGISTERED_IN`, `HAS_DATA_STORE`, `INSTANCE_OF`, `BUILT_FROM`, and the
//     invocation names `CALLS`, `SEND_MESSAGES_TO`, `INTEGRATED_WITH`, `DEPENDS_ON`.
//
//     These were held back because their only evidence was a remembered introspection log, and
//     adding a name on that basis is the mistake this whole investigation started from. That
//     objection is now DISCHARGED: exemples/tenant_vocabulary.js is the log, written down, and
//     **all nine exist on this tenant**. What is still missing for each is the other half of a
//     hop — the standing point. Knowing `VERSION_OF` exists does not say whether a model
//     versions a model or a dataset versions a dataset, and a hop walked from the wrong end
//     returns zero rows rather than an error. So each is a leg with its own argument to make,
//     not a name to add; `test/tenantVocabulary.test.js` now checks the name half offline, and
//     the standing point still has to come from a capture or a probe that returns rows.

import { HOP, type SelectSpec } from "./graphExpand";

/**
 * The kinds this traversal stands at.
 *
 * Both are members of AI_RESOURCE_TYPE_CANDIDATES (wizQueriesAi.ts), so both are already
 * verified against the tenant's entity enum by `resolveAiResourceTypes` before any query is
 * sent — see `lineageRoots`.
 */
export const LINEAGE_ROOT_CANDIDATES: readonly string[] = ["AI_PIPELINE", "AI_DATASET"];

/**
 * The root list, narrowed to what this tenant actually declares.
 *
 * Sending an entity type the tenant's `GraphEntityType` does not have fails coercion of the
 * WHOLE `$query` variable — the step then collects nothing, and the reason names the type
 * rather than the traversal. That is how `DATABASE_SERVER` silently emptied the
 * sensitive-data step (see sensitiveDataAccessSpec). Intersecting first means one missing
 * kind costs its own leg and not the query.
 *
 * An empty intersection falls back to the candidates verbatim, matching how
 * `chooseAiResourceTypes` degrades when introspection is unavailable: on a tenant that
 * cannot be asked, ask for what we would have asked for anyway and let the tenant refuse.
 */
export function lineageRoots(types: readonly string[]): string[] {
  const declared = new Set(types);
  const narrowed = LINEAGE_ROOT_CANDIDATES.filter((t) => declared.has(t));
  return narrowed.length ? narrowed : [...LINEAGE_ROOT_CANDIDATES];
}

/**
 * Pipeline / dataset lineage: production, ingestion, and storage.
 *
 * Every leg is `optional`, which is what lets one traversal stand at two kinds. A dataset
 * produces no model and reads from nothing, so it matches only the `STORES_DATA_IN` leg and
 * pads the rest with nulls; requiring any leg would collapse the whole query to pipelines
 * that happen to have all three. AGENT_EXPANSION makes the same choice for the same reason.
 *
 * The slot layout this renders to (pre-order, every node selected) — the normalizer reads it
 * POSITIONALLY and cannot do otherwise, because BUCKET occupies three slots and only its
 * position says which leg it arrived on:
 *
 *   0  AI_PIPELINE | AI_DATASET      the root
 *   1    AI_MODEL | AI_SERVICE       PRODUCES         what this pipeline produces
 *   2    AI_DATASET | BUCKET         READS_DATA_FROM  what it ingests
 *   3      BUCKET | DATABASE         READS_DATA_FROM  where that dataset ultimately lives
 *   4    BUCKET                      STORES_DATA_IN   where it writes
 */
export function lineageSpec(roots: readonly string[] = LINEAGE_ROOT_CANDIDATES): SelectSpec {
  return {
    type: [...roots],
    relationships: [
      { type: ["AI_MODEL", "AI_SERVICE"], optional: true, edge: HOP.PRODUCES },
      {
        type: ["AI_DATASET", "BUCKET"],
        optional: true,
        edge: HOP.READS_DATA_FROM,
        relationships: [
          { type: ["BUCKET", "DATABASE"], optional: true, edge: HOP.READS_DATA_FROM },
        ],
      },
      { type: "BUCKET", optional: true, edge: HOP.STORES_DATA_IN },
    ],
  };
}
