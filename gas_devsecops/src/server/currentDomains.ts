// This register's ONE answer to "which domain does this finding count under" — the rules and
// why live in `domain/currentDomain.ts`; this is the server end: build the assignment once per
// cache stamp from the whole ledger, and write `_domain` through it on every read path.
//
// EVERY PATH THAT PUTS A FINDING IN A DOMAIN GOES THROUGH HERE: the shared base snapshot every
// read model reads (`readModels.baseSnapshot`), the header's catalogue and counts
// (`bootCore`), and the CSV export (`api.getExportCsv`). One path left on the raw per-row tag
// join would put the same finding in two domains on two pages. What stays raw, on purpose, is
// the MAP HEALTH audit (`repoTags.mapHealth` / `resolveDomain`): it measures the tag map itself.
//
// Keyed on `dataVersion()`, like the base snapshot it is written onto: it moves on every ledger
// write, settings save (an admin override) and tag-map refresh (`repoTags.setRepoTagMap` bumps it).

import { getSupportGroupDomains } from "../../../gas_shared/domain/sgDomainOverrides";
import { assignedDomainOf, buildRepoDomainAssignment, type RepoDomainAssignment } from "../domain/currentDomain";
import { DOMAIN_FIELD } from "../domain/domainScope";
import { attachProjectGrain } from "../domain/projectScope";
import type { Rec } from "../domain/util";
import * as ledgerStore from "./ledgerStore";
import * as repoTags from "./repoTags";
import { dataVersion } from "./serverCache";
import { loadSettings } from "./settingsStore";

let memo: { stamp: string; assignment: RepoDomainAssignment } | undefined;

function build(wholeLedger: readonly Rec[]): RepoDomainAssignment {
  const t0 = Date.now();
  const map = repoTags.getRepoTagMap();
  const tagged = Object.keys(map).length > 0;
  // The tag keys only when there is a map to read them against — `attachRepoTags`'s own order.
  const keys = tagged ? repoTags.configuredTagKeys() : null;
  const overrides = getSupportGroupDomains(loadSettings() as unknown as Rec).items;
  const assignment = buildRepoDomainAssignment(
    wholeLedger,
    // An empty map resolves nothing — the same "we never learned" answer attachRepoTags gives.
    (head) => (keys ? repoTags.resolveRepoTags(head, map, keys).domain || "" : ""),
    new Map(overrides.map((o) => [o.group, o.domain])),
  );
  console.log(JSON.stringify({
    stage: "domainAssignment", repos: assignment.assetDomain.size,
    groups: assignment.groupDomain.size, overrides: overrides.length, ms: Date.now() - t0,
  }));
  return assignment;
}

function assignmentFor(wholeLedger: () => readonly Rec[]): RepoDomainAssignment {
  const stamp = dataVersion();
  if (!memo || memo.stamp !== stamp) memo = { stamp, assignment: build(wholeLedger()) };
  return memo.assignment;
}

function write(rows: Rec[], a: RepoDomainAssignment): void {
  for (const r of rows) {
    const d = assignedDomainOf(r, a);
    if (d) r[DOMAIN_FIELD] = d;
    else delete r[DOMAIN_FIELD];
  }
}

/**
 * Write `_domain` onto the WHOLE ledger's rows — the caller's array is also what the assignment
 * is built from on a memo miss. `_supportGroup` must already be attached (`attachProjectGrain`).
 */
export function attachCurrentDomains(wholeLedger: Rec[]): void {
  write(wholeLedger, assignmentFor(() => wholeLedger));
}

/**
 * Write `_domain` onto a SUBSET of the ledger (the CSV export reads one register). On a memo
 * miss the assignment is built from the whole ledger, never from the subset — a group's pin is
 * a fact about all its repositories, not about the ones one register happens to list.
 */
export function attachCurrentDomainsTo(subset: Rec[]): void {
  attachProjectGrain(subset as never);
  write(subset, assignmentFor(() => {
    const all = ledgerStore.loadBaseRows() as unknown as Rec[];
    attachProjectGrain(all as never);
    return all;
  }));
}

/** How a support group's domain was decided — null for a group nobody pinned or set. */
export function groupDomainSource(group: string): "override" | "auto" | null {
  return memo ? memo.assignment.groupSource.get(group) ?? null : null;
}

/** The domains a support group may be set to: every domain a repository resolves to today,
 *  plus every domain an override already names. Sorted. */
export function assignableDomains(): string[] {
  const a = assignmentFor(() => {
    const all = ledgerStore.loadBaseRows() as unknown as Rec[];
    attachProjectGrain(all as never);
    return all;
  });
  const names = new Set<string>([...a.assetDomain.values(), ...a.groupDomain.values()]);
  names.delete("");
  return [...names].sort();
}

/** Test seam: drop the per-execution assignment memo. */
export function resetCurrentDomainsMemo(): void {
  memo = undefined;
}
