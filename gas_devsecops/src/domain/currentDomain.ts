// WHICH DOMAIN A FINDING COUNTS UNDER in this register — today's domain repartition, one answer
// for every read path. The OS register's rules (gas/src/domain/currentDomain.ts), taken from the
// same vote (gas_shared/domain/groupDomainVote.ts), in repository words:
//
//   1. A REPOSITORY HAS ONE CURRENT DOMAIN — the one its NEWEST row resolves to through the
//      repository-tag join (`repoTags.resolveRepoTags`). Here this is nearly a no-op, and it is
//      kept anyway: a ledger row carries no tag bag of its own (`domainTag.carriedTags` refuses
//      the `tags_json` project map), so every row was already joined against the CURRENT map —
//      no resolved history freezes at an old tag the way the OS ledger's did. What it buys is
//      one join per repository instead of per row, and one answer for all of a repository's
//      rows when their identity tokens differ (a renamed repository).
//   2. EVERY SUPPORT GROUP IS PINNED TO ONE DOMAIN — the one most of its CURRENT repositories
//      (those with an open finding) are tagged in. THE BEHAVIOUR CHANGE: a team whose repos are
//      tagged into several domains used to be listed under every one of them. The group is the
//      row's own `_supportGroup` — its PRIMARY group (`projectGrain.supportGroupOf`, the
//      lowest-sorting CS-/CE-/LU- name); a repository filed under two groups votes for its
//      primary one only.
//   3. AN ADMIN OVERRIDE WINS (settings `supportGroupDomains`), with the reason it was set.
//
// "NO DOMAIN" IS NOT A BUCKET HERE. Where the OS register has an Unassigned tail a group can be
// pinned to, this register leaves `_domain` unset on an untagged row. So only a named domain can
// win a vote; when none of a group's CURRENT repositories is tagged the vote widens to all of
// them, and when none of those is either the group stays unpinned and each row keeps its own
// repository's (empty) domain — `pinUnnamed: false`, `widenWhenNoNamedCurrent: true`.
//
// Pure: `server/currentDomains.ts` builds one of these per cache stamp.

import { assignGroupDomains, type GroupDomainAssignment } from "../../../gas_shared/domain/groupDomainVote";
import { RESOLVED_STATUSES } from "./config";
import { COMPACTED_ASSET } from "./ledgerCore";
import { parseTs } from "./util";

type Rec = Record<string, unknown>;

/** A repository's identity on a ledger row: its id, else its name; "" for sealed history. */
export function repoKeyOf(r: Rec): string {
  const id = String(r["repo_id"] ?? "").trim();
  if (id) return "id:" + id;
  const name = String(r["repo_name"] ?? "").trim();
  return name && name !== COMPACTED_ASSET ? "name:" + name : "";
}

export type RepoDomainAssignment = GroupDomainAssignment<string>;

/**
 * Build the assignment from the whole ledger's rows, each already carrying `_supportGroup`
 * (`attachProjectGrain`). `resolveRepo` is the tag join on one repository's newest row ("" for
 * none); `overrides` are the admin's group → domain settings.
 */
export function buildRepoDomainAssignment(
  rows: readonly Rec[],
  resolveRepo: (head: Rec) => string,
  overrides: ReadonlyMap<string, string> = new Map(),
): RepoDomainAssignment {
  return assignGroupDomains<Rec, string>(rows, {
    keyOf: repoKeyOf,
    groupOf: (r) => String(r["_supportGroup"] ?? ""),
    lastSeenMs: (r) => parseTs(r["last_seen"]) ?? -Infinity,
    isOpen: (r) => !RESOLVED_STATUSES.has(String(r["status"] ?? "").toUpperCase()),
    annotateHeads: () => {},
    resolveHead: (head) => resolveRepo(head) || "",
    resolveKeyless: (r) => resolveRepo(r) || "",
    nameOf: (d) => d,
    isNamed: (name) => name !== "",
    pinUnnamed: false,
    widenWhenNoNamedCurrent: true,
  }, overrides);
}

/** The domain one row counts under: its group's pin, else its repository's, else "". */
export function assignedDomainOf(r: Rec, a: RepoDomainAssignment): string {
  const sg = String(r["_supportGroup"] ?? "");
  const pinned = sg ? a.groupDomain.get(sg) : undefined;
  if (pinned !== undefined) return pinned;
  const key = repoKeyOf(r);
  return (key && a.assetDomain.get(key)) || "";
}
