// The four agent-rooted graph traversals: guardrail coverage, execution identity, CIEM
// findings, and the sensitive-data chain.
//
// WHY THESE MOVED HERE FROM INLINE GRAPHQL. All four used to be written as GraphQL SOURCE —
// `type: "AI_AGENT"`, `type: "RUNS_AS"` — string-built into the document body. A live tenant
// refused every one of them, and its reason named the mechanism:
//
//   GraphEntityType cannot represent value: "AI_AGENT"
//   GraphDirectedRelationshipTypeInput cannot represent value: "RUNS_AS"
//
// `AI_AGENT` is not a wrong name — the SAME tenant, in the SAME execution, accepted it inside
// the root type array of the two exposure traversals, which pass their query as the `$query`
// VARIABLE. One name, two outcomes, and the difference is the position it was written in.
// `GraphDirectedRelationshipTypeInput` is an input OBJECT: a relationship is `[{ type, reverse }]`,
// and a bare string cannot be one of those no matter what it spells.
//
// So these four never reached vocabulary validation at all. Every quoted value failed first, and
// the rejection said nothing about whether `RUNS_AS` was the right name for that hop.
//
// TWO FIXES, IN THAT ORDER, AND THE ORDER WAS THE POINT. The shape fix shipped first with the
// names left alone, so that the next probe had one variable to report on. It came back with all
// four steps failing the same way — `invalid type for variable: 'query'`, one cause instead of
// two — and an introspection probe then returned the tenant's 100 relationship members. Of the
// 23 this app declares, five exist here, and every name these traversals sent was absent.
//
// So the names below are NOT the inline versions' names any more. They are the tenant's, taken
// from `HOP` (graphExpand.ts), where each one is pinned to the capture that proves it:
// RUNS_AS → ACTING_AS, HAS_FINDING → CONTAINS, PROTECTED_BY → PROTECTS reversed. What a
// normalizer PERSISTS on ai_edges keeps the old names and is a separate namespace on purpose —
// these specs send ACTING_AS and `normalizeRunsAsPage` writes RUNS_AS.
//
// WHAT IS DELIBERATELY NOT CHANGED HERE, and why each is its own decision:
//
//   · The root stays the "AI_AGENT" literal, though `identityAccessSpec` and both exposure
//     specs root at the tenant-resolved AI type list. Widening is defensible — a model carrying
//     an admin binding is invisible today — but all three normalizers anchor on
//     `find(e => e.kind === "AI_AGENT")`, so a wider root collects rows they then discard, and
//     widening both is a population change on a register holding 7,759 pipelines. `roots` is a
//     parameter so that day is a call-site edit rather than a rewrite of this file.
//
//   · Project scope stays absent. These four send no `projectId` today while IDENTITY_ACCESS
//     and the exposure steps send one; changing that would narrow results on any tenant with
//     WIZ_PROJECT_ID_V2 set. The builders take a `scope` argument so the switch is available,
//     and the callers pass `null` — see the note on `agentPathVariables` in wizQueriesAi.ts.
//
// ONE THING THE SPEC FORM CANNOT SAY, and why that is fine. `toGraphEntityQuery` omits `select`
// entirely for an unselected node rather than emitting `select: false`. The console does the
// same: exemples/ai_agent_expand_request.js carries 43 `"select": true` keys across a 45-node
// traversal whose two unselected nodes have no `select` key at all, and the tenant answered it.

import { HOP, type SelectSpec } from "./graphExpand";

/** The AI kinds these traversals are rooted at. See the header for why this is not widened. */
export const AGENT_PATH_ROOTS: readonly string[] = ["AI_AGENT"];

/**
 * Agents with NO guardrail protecting them — the `negate: true` leg.
 *
 * The negated node is walked and not selected: it must not exist, so there is nothing of it to
 * put in a slot. `negate` is the one construct in this file with no capture behind it — no
 * request in exemples/ carries the key — so if this step alone keeps failing once the shape and
 * the vocabulary are both fixed, `negate` is the first thing to suspect, ahead of `PROTECTS`.
 *
 * It matters more than its size suggests: `normalizeNoGuardrailPage` is the ONLY producer of
 * `guardrailMissing` anywhere in this codebase, and `conditionState` reads that flag as the
 * MISSING_GUARDRAIL risk condition. While this query is refused, one of the four conditions AARS
 * and the posture lattice score on is not unknown — it is permanently false.
 */
export function noGuardrailSpec(roots: readonly string[] = AGENT_PATH_ROOTS): SelectSpec {
  return {
    type: [...roots],
    relationships: [
      { type: "AI_GUARDRAIL", select: false, negate: true, edge: HOP.PROTECTED_BY },
    ],
  };
}

/** Execution identity: which service account an agent runs as. */
export function agentRunsAsSpec(roots: readonly string[] = AGENT_PATH_ROOTS): SelectSpec {
  return {
    type: [...roots],
    relationships: [{ type: "SERVICE_ACCOUNT", edge: HOP.RUNS_AS }],
  };
}

/** CIEM: the agent's service account and any excessive-access finding on it. */
export function saExcessiveAccessSpec(roots: readonly string[] = AGENT_PATH_ROOTS): SelectSpec {
  return {
    type: [...roots],
    relationships: [
      {
        type: "SERVICE_ACCOUNT",
        edge: HOP.RUNS_AS,
        relationships: [{ type: "EXCESSIVE_ACCESS_FINDING", edge: HOP.HAS_FINDING }],
      },
    ],
  };
}

/**
 * The data-exposure path: agent → service account → classified store → data findings.
 *
 * The finding leg is `optional` and the two before it are not, for the reason the inline version
 * recorded: a store Wiz has classified but on which no finding rule has fired must still draw,
 * and requiring the finding would collapse the whole path back to nothing. Requiring the first
 * two costs nothing, because without them there is no path.
 *
 * DATABASE_SERVER is gone from the store list, and the note that justified it was wrong twice.
 * It claimed `kindFromWizType` returning null makes the normalizer drop the ENTIRE row; it does
 * not — `entitiesOf` filters unmappable entities INDIVIDUALLY, so the agent and the service
 * account survive and only that store is lost. And the tenant's GraphEntityType enum has no
 * DATABASE_SERVER at all, so asking for it never widened the net: it made the whole `$query`
 * variable fail coercion, and the step collected nothing whatsoever.
 *
 * `DB_SERVER` is this tenant's spelling. Substituting it would make the query legal and change
 * nothing — the entities would come back and `kindFromWizType` would drop each one, because the
 * kind is undeclared here. Collecting them means adding it to NODE_KINDS, whose declaration
 * order drives the grouped layout, plus icon and rank entries. That is a scope change with its
 * own evidence to gather, not a name fix.
 */
export function sensitiveDataAccessSpec(
  roots: readonly string[] = AGENT_PATH_ROOTS,
): SelectSpec {
  return {
    type: [...roots],
    relationships: [
      {
        type: "SERVICE_ACCOUNT",
        edge: HOP.RUNS_AS,
        relationships: [
          {
            type: ["BUCKET", "DATABASE"],
            edge: { type: "ALLOWS_ACCESS_TO" },
            where: { hasSensitiveData: { EQUALS: true } },
            relationships: [
              { type: "DATA_FINDING", optional: true, edge: { type: "HAS_DATA_FINDING" } },
            ],
          },
        ],
      },
    ],
  };
}
