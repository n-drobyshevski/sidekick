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
// TWO RULES, both read off the ledger as it stands now:
//
//   1. AN ASSET HAS ONE CURRENT DOMAIN — the one its MOST RECENT sighting resolves to (tag
//      first, then a manual rule; `resolveDomain`). Every finding on that asset, open or
//      resolved, takes it. Safe because every input a domain rule reads is asset-level
//      (names, subscription, support group, tags — `domainRules.hasDomainInputs`), so one
//      resolution per asset is the same answer per finding, just current.
//   2. A SUPPORT GROUP IS PINNED TO ONE DOMAIN — the one most of its CURRENT assets sit in
//      (an asset is current while it carries an open finding; a group with none falls back to
//      all its assets). Every finding in the group counts there, whatever its own asset's tag
//      says. A named domain beats Unassigned / Not attributable however few assets hold it —
//      "these two hosts are tagged CROSS, the rest untagged" pins to CROSS, not to the gap.
//      Ties go to the domain holding more of the group's findings, then to the name.
//
// Findings with no support group keep rule 1 alone; a row whose asset never appears with an
// identity (compacted history) keeps its own resolution.
//
// Pure: the server builds one of these per data version (`server/currentDomains.ts`) and
// every read path asks it. The tag key and the compiled rules arrive inside `resolve`.

import { NOT_ATTRIBUTABLE, type ResolvedDomain } from "./resolveDomain";
import { UNASSIGNED } from "./domainRules";
import { type Rec } from "./util";

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
 * ONE PASS, AND THE JOINS RUN ON ONE ROW PER ASSET. The ledger is ~10⁵ rows and the estate
 * ~10³ assets; the support-group join and the tag parse are only ever needed on each asset's
 * NEWEST row (an asset lives in one subscription, so its group is on that row too), so
 * `annotate` gets exactly those — it attaches `_supportGroup` and `_bizDomain` in place — and
 * `resolve` (`resolveDomain` with the current rules and tag key bound) runs once per asset.
 */
export function buildDomainAssignment(
  rows: Rec[],
  annotate: (newest: Rec[]) => void,
  resolve: (r: Rec) => ResolvedDomain,
): DomainAssignment {
  const newest = new Map<string, Rec>();
  const openAssets = new Set<string>();
  const findingsOf = new Map<string, number>();
  for (const r of rows) {
    const key = assetKeyOf(r);
    if (!key) continue;
    const prev = newest.get(key);
    if (!prev || lastSeenMs(r) > lastSeenMs(prev)) newest.set(key, r);
    if (!String(r["resolved_at"] ?? "").trim()) openAssets.add(key);
    findingsOf.set(key, (findingsOf.get(key) ?? 0) + 1);
  }
  const heads = [...newest.values()].map((r) => ({ ...r }));
  annotate(heads);
  const keys = [...newest.keys()];
  const assetDomain = new Map<string, ResolvedDomain>();
  const groupAssets = new Map<string, string[]>();
  keys.forEach((key, i) => {
    const head = heads[i]!;
    assetDomain.set(key, resolve(head));
    const sg = String(head["_supportGroup"] ?? "");
    if (!sg) return;
    let list = groupAssets.get(sg);
    if (!list) groupAssets.set(sg, (list = []));
    list.push(key);
  });

  const groupDomain = new Map<string, string>();
  for (const [sg, assets] of groupAssets) {
    const current = assets.filter((a) => openAssets.has(a));
    const counted = current.length ? current : assets;
    const votes = new Map<string, number>();
    const findings = new Map<string, number>();
    for (const a of counted) {
      const d = assetDomain.get(a)!.name;
      votes.set(d, (votes.get(d) ?? 0) + 1);
    }
    for (const a of assets) {
      const d = assetDomain.get(a)!.name;
      findings.set(d, (findings.get(d) ?? 0) + (findingsOf.get(a) ?? 0));
    }
    const ranked = [...votes.entries()].sort((x, y) =>
      Number(isTail(x[0])) - Number(isTail(y[0]))
      || y[1] - x[1]
      || (findings.get(y[0]) ?? 0) - (findings.get(x[0]) ?? 0)
      || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
    if (ranked.length) groupDomain.set(sg, ranked[0]![0]);
  }
  return { groupDomain, assetDomain };
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
