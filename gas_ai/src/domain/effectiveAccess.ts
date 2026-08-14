// Effective permissions: not "who holds a role", but "what can this person actually do".
//
// `IDENTITY_ACCESS` walks the BINDING topology — AI asset ← ALLOWS_ACCESS_TO ←
// ACCESS_ROLE_BINDING → BOUND_TO → USER_ACCOUNT, with the role's own `accessType`. That is the
// structure, and it is what the Security Graph draws. It cannot say which permissions the
// binding actually confers, or which policy confers them.
//
// `entityEffectiveAccessEntries` can. Each entry is one (granted entity, accessible resource)
// pair carrying `permissions` as real permission strings and, per path, the
// `principalPolicies` and `resourcePolicies` that grant it — which is the remediation target.
//
// TWO VOCABULARIES, NEVER ONE FIELD. This root's `accessTypes` is `DATA` (and its siblings);
// the binding traversal's is `ADMIN` / `HIGH_PRIVILEGE`. They are different axes that happen
// to share a word, and merging them is exactly the one-word-two-meanings error riskConditions
// .ts exists to prevent — that file's whole header is the story of two consumers disagreeing
// about one condition. So the two never share a field: `humanAccess.identityIds` stays the
// binding answer and `humanAccess.effectiveIds` is this one, and any figure built from them
// names which grade of evidence it has.

import type { Rec } from "./util";

/**
 * The access types this step asks for.
 *
 * `DATA` is what the console capture sends, and keeping it makes the claim specifically "can
 * reach this asset's data" rather than "has some access". Widening it here would widen what
 * the figure means without anything on the page saying so.
 */
export const EFFECTIVE_ACCESS_TYPES = ["DATA"] as const;

/** The granted-entity types worth asking about: people, not the agents' own identities. */
export const EFFECTIVE_GRANTED_TYPES = ["USER_ACCOUNT"] as const;

/**
 * The `$filterBy` for Q_EFFECTIVE_ACCESS, transcribed from the console capture. Pure — the
 * type list and the scope are parameters, so the document stays static and this is testable.
 */
export function effectiveAccessFilter(
  types: readonly string[],
  scope: string[] | null,
): Rec {
  const filterBy: Rec = {
    grantedEntity: {},
    grantedEntityType: { equals: [...EFFECTIVE_GRANTED_TYPES] },
    resource: {},
    resourceType: { equals: [...types] },
    accessTypes: { equals: [...EFFECTIVE_ACCESS_TYPES] },
  };
  if (scope && scope.length) filterBy["projectId"] = scope;
  return filterBy;
}

/** One decoded effective-access entry: who, what, and the evidence for it. */
export interface EffectiveAccessRow {
  identityId: string;
  identityName?: string;
  resourceId: string;
  accessTypes: string[];
  permissions: string[];
  /** Policy ids from every path's principal and resource policies, deduped. */
  policyIds: string[];
  policyNames: string[];
}

function str(v: unknown): string | undefined {
  return v === null || v === undefined || v === "" ? undefined : String(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : [];
}

function addUnique(list: string[], value: string | undefined): void {
  if (value && list.indexOf(value) < 0) list.push(value);
}

/** The `{ policy, grantedEntity }` pairs off one path leg, folded into the id/name lists. */
function collectPolicies(raw: unknown, ids: string[], names: string[]): void {
  if (!Array.isArray(raw)) return;
  for (const entry of raw as Rec[]) {
    if (!entry || typeof entry !== "object") continue;
    const policy = entry["policy"] as Rec | null | undefined;
    if (!policy || typeof policy !== "object") continue;
    addUnique(ids, str(policy["id"]));
    addUnique(names, str(policy["name"]));
  }
}

/**
 * One `entityEffectiveAccessEntries` node → a row, or null when it names no pair.
 *
 * Permissions are unioned from the entry AND its paths: the top-level list is the effective
 * union, but a tenant that returns it empty while populating the paths would otherwise report
 * an entry with no permissions at all — and "reachable with no permissions" is not a sentence
 * this app should ever print.
 */
export function toEffectiveAccessRow(raw: Rec): EffectiveAccessRow | null {
  if (!raw || typeof raw !== "object") return null;
  const granted = raw["grantedEntity"] as Rec | null | undefined;
  const resource = raw["accessibleResource"] as Rec | null | undefined;
  const identityId = granted && typeof granted === "object" ? str(granted["id"]) : undefined;
  const resourceId = resource && typeof resource === "object" ? str(resource["id"]) : undefined;
  if (!identityId || !resourceId) return null;

  const accessTypes: string[] = [];
  const permissions: string[] = [];
  const policyIds: string[] = [];
  const policyNames: string[] = [];
  for (const t of strings(raw["accessTypes"])) addUnique(accessTypes, t);
  for (const p of strings(raw["permissions"])) addUnique(permissions, p);

  const paths = raw["paths"];
  if (Array.isArray(paths)) {
    for (const path of paths as Rec[]) {
      if (!path || typeof path !== "object") continue;
      for (const t of strings(path["accessTypes"])) addUnique(accessTypes, t);
      for (const p of strings(path["permissions"])) addUnique(permissions, p);
      collectPolicies(path["principalPolicies"], policyIds, policyNames);
      collectPolicies(path["resourcePolicies"], policyIds, policyNames);
    }
  }

  return {
    identityId,
    identityName: str(granted!["name"]),
    resourceId,
    accessTypes,
    permissions,
    policyIds,
    policyNames,
  };
}
