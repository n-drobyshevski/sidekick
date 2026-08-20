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
// the rejection said nothing about whether `RUNS_AS` is the right name for that hop. That
// question is still open, and it is answerable only now that the shape is out of the way —
// which is the entire reason the names below are UNCHANGED from the inline versions. Fixing two
// things at once would leave the next probe unable to say which one it was reporting on.
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

import { type SelectSpec } from "./graphExpand";

/** The AI kinds these traversals are rooted at. See the header for why this is not widened. */
export const AGENT_PATH_ROOTS: readonly string[] = ["AI_AGENT"];

/**
 * Agents with NO guardrail protecting them — the `negate: true` leg.
 *
 * The negated node is walked and not selected: it must not exist, so there is nothing of it to
 * put in a slot. `negate` is the one construct in this file with no capture behind it — no
 * request in exemples/ carries the key — so if this step keeps failing after the shape fix while
 * the other three pass, `negate` is the first thing to suspect rather than `PROTECTED_BY`.
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
      { type: "AI_GUARDRAIL", select: false, negate: true, edge: { type: "PROTECTED_BY" } },
    ],
  };
}

/** Execution identity: which service account an agent runs as. */
export function agentRunsAsSpec(roots: readonly string[] = AGENT_PATH_ROOTS): SelectSpec {
  return {
    type: [...roots],
    relationships: [{ type: "SERVICE_ACCOUNT", edge: { type: "RUNS_AS" } }],
  };
}

/** CIEM: the agent's service account and any excessive-access finding on it. */
export function saExcessiveAccessSpec(roots: readonly string[] = AGENT_PATH_ROOTS): SelectSpec {
  return {
    type: [...roots],
    relationships: [
      {
        type: "SERVICE_ACCOUNT",
        edge: { type: "RUNS_AS" },
        relationships: [{ type: "EXCESSIVE_ACCESS_FINDING", edge: { type: "HAS_FINDING" } }],
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
 * DATABASE_SERVER is in the store list because `kindFromWizType` returns null for a kind this
 * model has not declared and the normalizer then drops the ENTIRE row — losing the agent and the
 * service account, not just the store.
 */
export function sensitiveDataAccessSpec(
  roots: readonly string[] = AGENT_PATH_ROOTS,
): SelectSpec {
  return {
    type: [...roots],
    relationships: [
      {
        type: "SERVICE_ACCOUNT",
        edge: { type: "RUNS_AS" },
        relationships: [
          {
            type: ["BUCKET", "DATABASE", "DATABASE_SERVER"],
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
