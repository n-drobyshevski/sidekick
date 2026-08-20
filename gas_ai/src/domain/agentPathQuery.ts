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
// THE ROOTS ARE NO LONGER THE "AI_AGENT" LITERAL, and the day this header said would be a
// call-site edit arrived. A live probe measured what the narrow root cost — standing at every
// AI kind instead of at agents alone, with nothing else changed:
//
//   RUNS_AS                190 rows ->   260
//   SA_FINDINGS             49      ->   571
//   SENSITIVE_DATA_ACCESS  751      -> 1,285
//
// (Row counts, not asset counts: graphSearch returns one row per PATH, so the two steps with
// fanning legs report a multiple of their population. Each step is compared against ITSELF
// with one variable changed, which is what makes these readable at all.)
//
// The condition this header attached to the widening was real and had to be paid: all three
// normalizers anchored on `find(e => e.kind === "AI_AGENT")`, so a wider root would have
// collected every extra row and discarded it — three times the Wiz calls, identical numbers,
// nothing anywhere to say why. `syncNormalize.rootAiAsset` replaced that anchor in the same
// change, and a test fails if it is put back.
//
// GUARDRAIL_GAPS widened too, but NOT to the same list — see `GUARDRAIL_SUBJECT_KINDS` below.
// Its output is an absence, and an absence asserted over the wrong population is a fabricated
// finding rather than a wider net.
//
// WHAT IS STILL DELIBERATELY NOT CHANGED HERE:
//
//   · Project scope stays absent. These four send no `projectId` today while IDENTITY_ACCESS
//     and the exposure steps send one; changing that would narrow results on any tenant with
//     WIZ_PROJECT_ID_V2 set. The builders take a `scope` argument so the switch is available,
//     and the callers pass `null` — see the note on `agentPathVariables` in wizQueriesAi.ts.
//     The same probe found that scope is exactly why the two exposure steps read zero.
//
// ONE THING THE SPEC FORM CANNOT SAY, and why that is fine. `toGraphEntityQuery` omits `select`
// entirely for an unselected node rather than emitting `select: false`. The console does the
// same: exemples/ai_agent_expand_request.js carries 43 `"select": true` keys across a 45-node
// traversal whose two unselected nodes have no `select` key at all, and the tenant answered it.

import { HOP, type SelectSpec } from "./graphExpand";
import { WIRE_ACCESS_TYPES } from "./identityQuery";

/** The AI kinds these traversals are rooted at. See the header for why this is not widened. */
export const AGENT_PATH_ROOTS: readonly string[] = ["AI_AGENT"];

/**
 * The kinds a guardrail is asked about — the subjects of GUARDRAIL_GAPS.
 *
 * NOT the whole AI type list, and the difference is a measured one. This traversal reports an
 * ABSENCE, and `guardrailMissing` is the only producer of the MISSING_GUARDRAIL risk condition
 * that AARS prices in pillar B. Probed tenant-wide 2026-08-20:
 *
 *   AI_AGENT                            690 flagged unprotected
 *   AI_AGENT + AI_MODEL + AI_SERVICE  1,760
 *   all 14 AI kinds                  ~10,000
 *
 * Rooting it at everything would multiply the condition roughly fourteenfold across pipelines
 * and datasets — assets a guardrail does not attach to — which is not a wider net but a
 * fabricated finding on most of the register.
 *
 * PROVENANCE IS UNEVEN ACROSS THESE THREE, and that is worth knowing rather than smoothing
 * over. `PROTECTS` is walked from an AI_AGENT and from an AI_MODEL in the console capture
 * (AGENT_EXPANSION subtrees 6 and 5). AI_SERVICE is walked from by NO capture — it is here by
 * decision, on the reading that a hosted model-serving endpoint is the kind of thing a
 * guardrail fronts.
 *
 * So the probe measured each kind on its own, and the split is reassuring rather than merely
 * reported: AI_AGENT 690, **AI_MODEL 913**, AI_SERVICE 157 — summing exactly to the 1,760 the
 * combined query returns, so nothing is double-counted. The bulk of the widening is the kind
 * with capture evidence behind it, and the kind resting on judgement alone contributes 157 of
 * the 1,070 increase. If AI_SERVICE ever needs defending or dropping, that is the number, and
 * `npm run probe -- --diagnose` re-measures it.
 */
export const GUARDRAIL_SUBJECT_KINDS: readonly string[] = ["AI_AGENT", "AI_MODEL", "AI_SERVICE"];

/**
 * The guardrail roots, narrowed to what this tenant declares.
 *
 * Same defence as `lineageRoots`: an entity type the tenant's `GraphEntityType` lacks fails
 * coercion of the whole `$query` variable, so one absent kind would empty the step rather than
 * cost its own leg. An empty intersection falls back to the list verbatim and lets the tenant
 * refuse, which is a louder failure than matching nothing.
 */
export function guardrailRoots(types: readonly string[]): string[] {
  const declared = new Set(types);
  const narrowed = GUARDRAIL_SUBJECT_KINDS.filter((t) => declared.has(t));
  return narrowed.length ? narrowed : [...GUARDRAIL_SUBJECT_KINDS];
}

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
export function noGuardrailSpec(
  roots: readonly string[] = GUARDRAIL_SUBJECT_KINDS,
): SelectSpec {
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

/**
 * CIEM: AI assets whose execution identity holds high privileges, and what grants them.
 *
 * TRANSCRIBED FROM A CONSOLE EXPORT, not composed here. The Wiz console's own
 * "AI assets with a high-privileged identity" query, exported as code against this tenant,
 * returned TWELVE rows — each an AI_AGENT, a SERVICE_ACCOUNT and an IAM_BINDING. That is the
 * only version of this traversal anything has ever proved works, so it is the one shipped.
 *
 * THREE THINGS THE EXPORT CHANGED, each of which this spec had wrong:
 *
 * 1. It asks for `PRINCIPAL`, not `SERVICE_ACCOUNT`. The tenant answers with the concrete
 *    subtype — all twelve rows came back `SERVICE_ACCOUNT` — so `normalizeRunsAsPage`'s
 *    `find(kind === "SERVICE_ACCOUNT")` still matches, and asking for the supertype also
 *    catches a user-backed identity this spec could never see before.
 *
 * 2. The privilege test is a PROPERTY on the principal — `hasHighPrivileges: { EQUALS: true }` —
 *    not a hop to a finding. That is the direct route to the EXCESSIVE_PRIVILEGE risk condition,
 *    and `normalizeCloudResource` already reads that flag off any entity's properties, so the
 *    scored signal arrives with no normalizer change at all.
 *
 * 3. The binding is `IAM_BINDING`, reached by walking `ENTITLES` REVERSED from the principal —
 *    the opposite flag from `identityAccessSpec`, which stands at the binding instead. Same
 *    relationship, two standing points; see HOP in graphExpand.ts.
 *
 * The finding leg is KEPT, and optional. It is independently proven — AGENT_EXPANSION's capture
 * decodes slot 2 as `CONTAINS -> EXCESSIVE_ACCESS_FINDING` — and `normalizeRunsAsPage` already
 * emits an edge for it, so dropping it would lose a working signal in exchange for nothing. Every
 * leg below the principal is optional for the same reason the console makes them so: a
 * high-privileged identity is worth reporting whether or not the binding that granted it, or a
 * finding about it, comes back in the same row.
 *
 * NOT TRANSCRIBED: the export's final `ALLOWS_ACCESS_TO -> SUBSCRIPTION | CLOUD_ORGANIZATION`
 * leg. It names the blast radius of the binding, which is worth having, but neither kind is
 * declared in NODE_KINDS and both returned nothing in the captures — so it would be two more
 * kinds to declare, an icon and a layout rank each, for a leg with no observed rows. Its own
 * change, with its own evidence.
 */
export function saExcessiveAccessSpec(roots: readonly string[] = AGENT_PATH_ROOTS): SelectSpec {
  return {
    type: [...roots],
    relationships: [
      {
        type: "PRINCIPAL",
        edge: HOP.RUNS_AS,
        where: { hasHighPrivileges: { EQUALS: true } },
        relationships: [
          {
            type: "IAM_BINDING",
            edge: HOP.ENTITLED_BY,
            optional: true,
            where: { accessTypes: { EQUALS: [...WIRE_ACCESS_TYPES] } },
            relationships: [
              {
                type: "ACCESS_ROLE_PERMISSION",
                edge: HOP.GRANTS_PERMISSION,
                optional: true,
                where: { accessTypes: { EQUALS: [...WIRE_ACCESS_TYPES] } },
              },
            ],
          },
          { type: "EXCESSIVE_ACCESS_FINDING", edge: HOP.HAS_FINDING, optional: true },
        ],
      },
    ],
  };
}

/**
 * The data-exposure path: agent → execution identity → **its binding** → classified store →
 * data findings.
 *
 * THE BINDING IS NOT DECORATION — it is the hop that makes this query return anything, and
 * leaving it out is why this step reported zero on a tenant holding 147 matching paths. Three
 * probes, one variable each, run 2026-08-20 against the live tenant:
 *
 *   AI_AGENT -ACTING_AS→ SERVICE_ACCOUNT -ALLOWS_ACCESS_TO→ store         0 rows
 *   AI_AGENT -ACTING_AS→ PRINCIPAL ←ENTITLES− IAM_BINDING -ALLOWS_ACCESS_TO→ store   160 rows
 *   ...the same, with `hasSensitiveData: true` on the store                147 rows
 *
 * So `ALLOWS_ACCESS_TO` is anchored at the BINDING on this tenant, not at the identity. Asked
 * of a SERVICE_ACCOUNT it is a hop that cannot match — and it answers with zero rows and no
 * error, which is indistinguishable from "no AI agent reaches sensitive data" and was read
 * that way. AGENT_EXPANSION always walked it through the binding; this spec did not, and
 * nothing compared the two.
 *
 * The third probe is the one that mattered for shipping: 160 unfiltered against 147 filtered
 * says the `hasSensitiveData` narrowing was never the problem, so the filter stays. Getting
 * rows back from a shape is not evidence for the shape you are about to ship.
 *
 * `DATA_RESOURCE` is deliberately NOT added to the store list even though the probe's version
 * carried it: it is not in NODE_KINDS, so normalizeCloudResource would drop every one, and the
 * step would collect entities it cannot keep. Same trap as DB_SERVER below, and its own change.
 *
 * The finding leg is `optional` and the ones before it are not, for the reason the inline
 * version recorded: a store Wiz has classified but on which no finding rule has fired must
 * still draw, and requiring the finding would collapse the whole path back to nothing.
 * Requiring the rest costs nothing, because without them there is no path.
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
        // PRINCIPAL, not SERVICE_ACCOUNT, for the reason saExcessiveAccessSpec records: the
        // tenant answers the supertype with the concrete subtype, so the normalizer's
        // `find(kind === "SERVICE_ACCOUNT")` still matches and a user-backed identity stops
        // being invisible.
        type: "PRINCIPAL",
        edge: HOP.RUNS_AS,
        relationships: [
          {
            // The waypoint that makes the whole path resolve, and it is not selected: a
            // binding is how the grant is modelled, not a fact this step reports. The edge
            // the normalizer writes stays identity → store, which is what EDGE_TYPES means by
            // ALLOWS_ACCESS_TO and what the graph draws.
            type: "IAM_BINDING",
            select: false,
            edge: HOP.ENTITLED_BY,
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
      },
    ],
  };
}
