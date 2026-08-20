// Human identity access: who can reach an AI asset, and whether that identity is still in
// use.
//
// The traversal is Wiz's own shape — an AI asset is reached THROUGH a role binding, never
// directly, so the binding is walked but not selected:
//
//   AI asset <-ALLOWS_ACCESS_TO- ACCESS_ROLE_BINDING -ENTITLES->  USER_ACCOUNT / SERVICE_ACCOUNT
//                                                    -ALLOWS->     ACCESS_ROLE[accessTypes]
//
// Those are the TENANT's relationship names, taken from `HOP` (graphExpand.ts). This traversal
// used to send `BOUND_TO` and `PERMITS_ACCESS_ROLE`, which exist in no Wiz schema this app has
// ever talked to — an introspection probe returned 100 relationship members and neither was
// among them.
//
// DIRECTION IS A PROPERTY OF WHERE THE TRAVERSAL STANDS, not of the relationship, and this is
// the spec where that nearly went wrong. The capture proving `ENTITLES` stands at the PRINCIPAL
// and carries `reverse: true`; this spec stands at the BINDING and walks the same edge FORWARD.
// Copying the flag across without re-anchoring would have inverted the hop — and the symptom
// would have been zero rows, not an error, so nothing would have said so.
//
// TWO THINGS THIS MODULE EXISTS TO KEEP HONEST.
//
// 1. The root is the TENANT-RESOLVED AI type list, not the literal "AI_AGENT" this query
//    used to carry. A model with an admin binding on it, an MCP server a contractor can
//    reach — neither was collected, and the Scans page had no way to say so. Same narrowing
//    the exposure traversals had, fixed the same way.
//
// 2. `accessType` is READ, not assumed. The query filters on [ADMIN, HIGH_PRIVILEGE] and the
//    normalizer used to stamp HIGH_PRIVILEGE on every edge it built — a claim about the
//    filter rather than about the data, which flattened ADMIN and HIGH_PRIVILEGE into one
//    value and made "how many people are ADMIN on an agent" unanswerable. The ACCESS_ROLE
//    entity is selected, so its own value is right there in the properties bag.

import { HOP, type SelectSpec } from "./graphExpand";

/**
 * The access levels that count as a human reaching an AI asset.
 *
 * Declared ONCE and read from three places: `identityAccessSpec` filters the query on it,
 * `withHumanAccess` tests the edge against it, and `withIdentityAccessNodes` decides whether
 * to draw a stub. Those three used to hold two copies of this list between them.
 */
export const HUMAN_ACCESS_TYPES = ["ADMIN", "HIGH_PRIVILEGE"] as const;

/**
 * The same two levels as the TENANT spells them, for the query filter only.
 *
 * TWO VOCABULARIES, and the split is the point. `HUMAN_ACCESS_TYPES` above is this model's —
 * SCREAMING_SNAKE, what a normalizer persists and every consumer compares against. This is what
 * goes on the wire: the console capture filters `accessTypes` (PLURAL) on `"HighPrivilege"` and
 * `"Data"`, camelCase, and the singular SCREAMING_SNAKE form this query used to send matches
 * nothing on this tenant.
 *
 * BOTH VALUES ARE NOW CAPTURED. `"Admin"` was an inferred guess for one release — the only
 * values any capture showed were `"HighPrivilege"` and `"Data"`, and a reading of those twelve
 * returned bindings was briefly mistaken for the tenant's whole vocabulary. A second console
 * export settled it: the tenant builds `accessTypes: { EQUALS: ["Admin"] }` and answers it with
 * `"nodes": []`. Accepted, and empty — this estate has no AI asset running as an admin identity,
 * which is a fact about the estate rather than about the filter.
 *
 * Exported because `saExcessiveAccessSpec` (agentPathQuery.ts) filters the same axis on the same
 * two values, and two copies of a wire vocabulary is how the first one drifts.
 */
export const WIRE_ACCESS_TYPES = ["Admin", "HighPrivilege"] as const;

/** The identity kinds the ENTITLES leg can return. */
export const BOUND_IDENTITY_KINDS = ["USER_ACCOUNT", "SERVICE_ACCOUNT"] as const;

/**
 * Human/role identities with admin or high-privilege access INTO an AI asset.
 *
 * The binding is `select: false` — it is the mechanism, and the two things worth having are
 * at its ends. That makes the response's positional `entities` array three slots wide (asset,
 * identity, role) even though the traversal is four nodes deep; `toGraphEntityQuery` and
 * `flattenSlots` agree on that because they read the same literal.
 *
 * The reverse leg is spelled `reverse: true` inside the relationship's type object, which is
 * the form both console captures use in the `$query` VARIABLE position
 * (exemples/ai_exposure_*_request.js). The string-built document this replaced spelled the
 * same thing `direction: INBOUND` at the relationship level. Both are accepted; the captured
 * one is the one with evidence behind it, and it is the position we are moving to.
 */
export function identityAccessSpec(types: readonly string[]): SelectSpec {
  return {
    type: [...types],
    relationships: [
      {
        type: "ACCESS_ROLE_BINDING",
        select: false,
        edge: { type: "ALLOWS_ACCESS_TO", reverse: true },
        relationships: [
          {
            type: [...BOUND_IDENTITY_KINDS],
            edge: HOP.BOUND_TO,
          },
          {
            type: "ACCESS_ROLE",
            edge: HOP.PERMITS_ACCESS_ROLE,
            // `accessTypes`, plural, per the capture — the singular form matched nothing.
            where: { accessTypes: { EQUALS: [...WIRE_ACCESS_TYPES] } },
          },
        ],
      },
    ],
  };
}

/**
 * Wiz spells identity purpose `IdentityPurposeAgentic`, not `AGENTIC` — the capture in
 * exemples/agentic_identities_response.js returns the long form in the properties bag while
 * the FILTER takes the short one. Strip the prefix and uppercase, so one vocabulary reaches
 * the rest of the app.
 *
 * Exactly the shape `normalizeDataFindingSeverity` already uses for
 * `DataFindingSeverityCritical`; a second Wiz enum that reads one way and filters another.
 */
export function normalizeIdentityPurpose(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return v.trim().replace(/^IdentityPurpose/i, "").toUpperCase();
}

/**
 * An access level off an ACCESS_ROLE's properties bag, or undefined when the tenant did not
 * carry one.
 *
 * Undefined is what makes the caller's fallback safe: a tenant whose bag omits `accessType`
 * gets exactly the old stamped behaviour, so nothing regresses, and a tenant that does carry
 * it stops having ADMIN reported as HIGH_PRIVILEGE.
 */
export function normalizeAccessType(v: unknown): string | undefined {
  // An array first: the field is `accessTypes` plural on the wire, and a tenant that answers in
  // the spelling it was asked in may well return a list. The old signature took `string` only
  // and returned undefined for anything else, which is indistinguishable from "not present".
  if (Array.isArray(v)) {
    for (const item of v) {
      const hit = normalizeAccessType(item);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof v !== "string" || !v.trim()) return undefined;
  // camelCase FIRST, then punctuation. The tenant answers in the spelling it was asked in —
  // `"HighPrivilege"` — and the old order collapsed that to `HIGHPRIVILEGE`, which matches no
  // member and returned undefined. The caller's fallback then stamped HIGH_PRIVILEGE on every
  // edge including the ADMIN ones, which is precisely the bug this function's header says it
  // exists to end. A separator has to be inserted at the case boundary before anything is
  // uppercased, or there is no boundary left to find.
  const norm = v.trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
  return (HUMAN_ACCESS_TYPES as readonly string[]).indexOf(norm) >= 0 ? norm : undefined;
}
