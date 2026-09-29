// WHICH DOMAIN A FINDING COUNTS UNDER, decided by TODAY's domain repartition rather than by
// whatever tags the finding's asset carried the last time the scanner saw that finding.
//
// THE DRIFT THIS REMOVES. A ledger row keeps its asset's tag bag as of its LAST sighting
// (`reconcile.ts` refreshes `tags_json` on every scan that returns the finding, and never
// again once it stops being returned). An open finding is therefore always current, and a
// resolved one is frozen at the day it closed. Retag an asset from RETAIL to CROSS and its
// history stays in RETAIL while its backlog moves to CROSS: one host's MTTR split across two
// domains, and a support group listed under a domain none of its hosts are in any more.
//
// THREE RULES, the first two read off the ledger as it stands now:
//
//   1. AN ASSET HAS ONE CURRENT DOMAIN — the one its MOST RECENT sighting resolves to (tag
//      first, then a manual rule; `resolveDomain`). Every finding on that asset, open or
//      resolved, takes it. Safe because every input a domain rule reads is asset-level
//      (names, subscription, support group, tags — `domainRules.hasDomainInputs`), so one
//      resolution per asset is the same answer per finding, just current.
//   2. EVERY SUPPORT GROUP IS PINNED TO ONE DOMAIN — the one most of its CURRENT assets sit in
//      (an asset is current while it carries an open finding; a group with none falls back to
//      all its assets). A group's assets are every asset any of its findings sits on — read
//      off each row's own subscription, never assumed from the asset's newest row. Every finding in the group counts there, whatever its own asset's tag
//      says. A named domain beats Unassigned / Not attributable however few assets hold it —
//      "these two hosts are tagged CROSS, the rest untagged" pins to CROSS, not to the gap.
//      Ties go to the domain holding more of the group's findings, then to the name.
//   3. AN ADMIN OVERRIDE OF A GROUP'S DOMAIN WINS over rule 2 (settings `supportGroupDomains`,
//      set from the MTTR row sheet or Settings → Domains), with the reason it was set.
//
// Findings with no support group keep rule 1 alone; a row whose asset never appears with an
// identity (compacted history) keeps its own resolution.
//
// Pure: the server builds one of these per data version (`server/currentDomains.ts`) and
// every read path asks it. The tag key and the compiled rules arrive inside `resolve`.

import { NOT_ATTRIBUTABLE, type ResolvedDomain } from "./resolveDomain";
import { UNASSIGNED } from "./domainRules";
import { type Rec } from "./util";
import { assignGroupDomains } from "../../../gas_shared/domain/groupDomainVote";

/** Where an assigned domain came from: the group's pin, the asset's current resolution, or the
 *  row's own (an asset the ledger cannot identify). */
export type AssignedSource = "group" | "asset" | "row";

export interface AssignedDomain {
  name: string;
  source: AssignedSource;
}

export interface DomainAssignment {
  /** Support group → the one domain it counts under. */
  groupDomain: Map<string, string>;
  /** Support group → how its domain was decided: an admin override, or the host vote. */
  groupSource: Map<string, "override" | "auto">;
  /** Asset key → its current resolved domain (name + tag/rule/none/missing). */
  assetDomain: Map<string, ResolvedDomain>;
}

/** An asset's identity on a ledger row or a flattened frame record; "" when it has none. */
export function assetKeyOf(r: Rec): string {
  const id = r["asset_id"] ?? r["vulnerableAsset.id"];
  if (id !== null && id !== undefined && String(id) !== "") return "id:" + String(id);
  const name = String(r["asset_name"] ?? r["vulnerableAsset.name"] ?? "").trim();
  return name && name !== "(compacted)" ? "name:" + name : "";
}

function lastSeenMs(r: Rec): number {
  const t = Date.parse(String(r["last_seen"] ?? ""));
  return Number.isFinite(t) ? t : -Infinity;
}

const isTail = (name: string) => name === UNASSIGNED || name === NOT_ATTRIBUTABLE;

/**
 * Build the assignment from the whole ledger's base rows.
 *
 * GROUP MEMBERSHIP IS READ OFF EVERY ROW, NOT OFF AN ASSET'S NEWEST ONE. A finding's support
 * group comes from ITS OWN subscription (`groupOf`), and an asset's rows do not all share one:
 * a host moved between subscriptions keeps its old findings in the old group, and one asset id
 * can surface under several subscriptions (a shared image). The first cut of this took each
 * group's assets from the newest rows only — so a group that owned no asset's newest row was
 * never pinned, its findings fell through to their assets' domains, and it was listed under
 * several domains: exactly the defect this module exists to remove. Every group that owns any
 * row is pinned now, and `groupOf` is the caller's job to make cheap (the server caches it per
 * subscription).
 *
 * THE DOMAIN JOINS STILL RUN ON ONE ROW PER ASSET: the tag parse and the rules only need each
 * asset's NEWEST row, so `annotate` gets exactly those (attaching `_supportGroup` and
 * `_bizDomain` in place — a manual rule may read either) and `resolve` (`resolveDomain` with the
 * current rules and tag key bound) runs once per asset. A row with no asset identity (compacted
 * history) votes with its own resolution, and only for a group that has no identified asset.
 */
export function buildDomainAssignment(
  rows: Rec[],
  groupOf: (r: Rec) => string,
  annotate: (newest: Rec[]) => void,
  resolve: (r: Rec) => ResolvedDomain,
  overrides: ReadonlyMap<string, string> = new Map(),
): DomainAssignment {
  // THE VOTE IS SHARED with the code register (gas_shared/domain/groupDomainVote.ts); this is
  // the OS register's reading of it — assets are hosts, Unassigned / Not attributable are real
  // buckets a group of untagged hosts may be pinned to, and the vote never widens past the
  // current hosts (both switches set to exactly what this function did before it moved).
  return assignGroupDomains<Rec, ResolvedDomain>(rows, {
    keyOf: assetKeyOf,
    groupOf,
    lastSeenMs,
    isOpen: (r) => !String(r["resolved_at"] ?? "").trim(),
    annotateHeads: annotate,
    resolveHead: resolve,
    resolveKeyless: resolve,
    nameOf: (d) => d.name,
    isNamed: (name) => !isTail(name),
    pinUnnamed: true,
    widenWhenNoNamedCurrent: false,
  }, overrides);
}

/**
 * The domain one record counts under. `_supportGroup` must already be attached; `resolveRow`
 * is the record's own resolution, used only when neither rule above can speak for it.
 */
export function assignedDomain(
  r: Rec,
  a: DomainAssignment,
  resolveRow: (r: Rec) => ResolvedDomain,
): AssignedDomain {
  const sg = String(r["_supportGroup"] ?? "");
  const pinned = sg ? a.groupDomain.get(sg) : undefined;
  if (pinned !== undefined) return { name: pinned, source: "group" };
  const key = assetKeyOf(r);
  const asset = key ? a.assetDomain.get(key) : undefined;
  if (asset) return { name: asset.name, source: "asset" };
  return { name: resolveRow(r).name, source: "row" };
}
