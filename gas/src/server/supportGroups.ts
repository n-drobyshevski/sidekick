// Support Group ingestion + join. A Support Group is the value of a subscription's
// `Wiz/provisioning` tag (e.g. "CS-SUPPLY-MONITORING"); findings carry their
// subscription but not its tags, so we graphSearch every tagged subscription once,
// build a subscription-identity → group map, and attach `_supportGroup` to each
// record live (never baked into the ledger — mirrors how `_domain` is resolved).
//
// The subscription→group map lookup lives here, OUTSIDE the pure domain engine: the
// engine only reads the pre-attached `_supportGroup` field. Fetch/persist go through
// settingsStore so a refresh bumps DATA_VERSION and every cached derivation repaints.

import { present, type Rec } from "../domain/util";
import { DEFAULT_SUPPORT_GROUP_TAG_KEY, getProp, PROP_KEYS } from "./props";
import * as settingsStore from "./settingsStore";
import { graphSearchPage } from "./wizClient";
import { MAX_PAGES, PAGE_SIZE, subscriptionsByTagQuery } from "./wizSubscriptionsQuery";

/** The same trim+lowercase fold the domain engine uses, so keys and lookups agree. */
export function foldToken(v: unknown): string {
  return String(v).trim().toLowerCase();
}

// Subscription-identity columns a finding record can carry (frame dotted keys +
// nested vulnerableAsset + ledger columns). Any overlap with a map key is a hit.
const FRAME_ID_COLS = [
  "vulnerableAsset.subscriptionId",
  "vulnerableAsset.subscriptionExternalId",
  "vulnerableAsset.subscriptionName",
];
const LEDGER_ID_COLS = ["subscription_ext_id", "subscription_name"];

function recordIdentityTokens(record: Rec): string[] {
  const out: string[] = [];
  const va = record["vulnerableAsset"];
  for (const col of FRAME_ID_COLS) {
    const v = record[col];
    if (present(v)) out.push(String(v));
    else if (va && typeof va === "object" && !Array.isArray(va)) {
      const leaf = (va as Rec)[col.split(".").pop()!];
      if (present(leaf)) out.push(String(leaf));
    }
  }
  for (const col of LEDGER_ID_COLS) {
    const v = record[col];
    if (present(v)) out.push(String(v));
  }
  return out;
}

/** The Support Group for one record from a given map, or null when no identity hits. */
export function resolveSupportGroup(record: Rec, map: Record<string, string>): string | null {
  for (const token of recordIdentityTokens(record)) {
    const group = map[foldToken(token)];
    if (group) return group;
  }
  return null;
}

/**
 * Attach `_supportGroup` to each record from the current map (in place). No-op when the
 * map is empty (no refresh yet / no tagged subscriptions) so the field simply stays unset
 * and every support-group filter/condition is inert rather than wrong.
 */
export function attachSupportGroups(records: Rec[]): void {
  const { map } = settingsStore.getSupportGroupMap();
  if (!Object.keys(map).length) return;
  for (const r of records) {
    const group = resolveSupportGroup(r, map);
    if (group) r["_supportGroup"] = group;
  }
}

/** The Support Group tag key in effect — the configured override, else the default. The
 *  single source of truth for both the fetch query and the Attribution page's map-health note. */
export function configuredTagKey(): string {
  return getProp(PROP_KEYS.wizSupportGroupTagKey)?.trim() || DEFAULT_SUPPORT_GROUP_TAG_KEY;
}

// --------------------------------------------------------------- fetch (graphSearch)

/** Coerce an entity's `properties` (object, JSON string, or absent) to a plain object. */
function entityProperties(entity: Rec): Rec {
  const p = entity["properties"];
  if (p && typeof p === "object" && !Array.isArray(p)) return p as Rec;
  if (typeof p === "string" && p) {
    try {
      const parsed = JSON.parse(p);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Rec;
    } catch {
      // fall through
    }
  }
  return {};
}

// Property keys that identify the subscription; findings join on ext-id / name, so all
// forms are indexed and any one overlapping is enough.
const PROP_ID_KEYS = [
  "subscriptionId", "subscriptionExternalId", "externalId", "cloudProviderID",
  "providerId", "subscriptionName", "name",
];

/** The Support Group value from an entity's tags, across the shapes Wiz may return. */
function supportGroupValue(props: Rec, tagKey: string): string | null {
  const tags = props["tags"];
  // Object form: { "Wiz/provisioning": "CS-SUPPLY-MONITORING", ... }
  if (tags && typeof tags === "object" && !Array.isArray(tags)) {
    const v = (tags as Rec)[tagKey];
    if (present(v) && String(v).trim()) return String(v).trim();
  }
  // Array form: [{ key: "Wiz/provisioning", value: "..." }, ...]
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (t && typeof t === "object" && String((t as Rec)["key"]) === tagKey) {
        const v = (t as Rec)["value"];
        if (present(v) && String(v).trim()) return String(v).trim();
      }
    }
  }
  // Flat form: properties["tag:Wiz/provisioning"]
  const flat = props[`tag:${tagKey}`];
  if (present(flat) && String(flat).trim()) return String(flat).trim();
  return null;
}

/**
 * Parse one subscription entity into its Support Group and the folded identity tokens to
 * index it under. `group` is null when the entity carries no support-group tag. Pure and
 * defensive — the `properties` blob layout is tenant-dependent, so an unreadable shape
 * yields no group rather than throwing.
 */
export function parseSubscriptionEntity(
  entity: Rec,
  tagKey: string,
): { group: string | null; tokens: string[] } {
  const props = entityProperties(entity);
  const group = supportGroupValue(props, tagKey);
  const tokens: string[] = [];
  if (group) {
    for (const k of PROP_ID_KEYS) {
      const v = props[k];
      if (present(v) && String(v).trim()) tokens.push(foldToken(v));
    }
    for (const k of ["id", "name"]) {
      const v = entity[k];
      if (present(v) && String(v).trim()) tokens.push(foldToken(v));
    }
  }
  return { group, tokens };
}

/**
 * Index one subscription entity into the map under every identity token it carries.
 * Returns the Support Group value (for counting), or null when the entity is untagged.
 */
function recordSubscription(map: Record<string, string>, entity: Rec, tagKey: string): string | null {
  const { group, tokens } = parseSubscriptionEntity(entity, tagKey);
  if (!group) return null; // only tagged subscriptions contribute
  for (const token of tokens) map[token] = group;
  return group;
}

export interface SupportGroupRefresh {
  subscriptions: number; // tagged subscriptions seen
  keys: number; // identity tokens indexed
  groups: number; // distinct support groups
  tagKey: string;
}

/**
 * Fetch every subscription carrying the support-group tag and build the identity→group
 * map. Pages via graphSearch endCursor. Never partial-throws on a surprising entity shape
 * (the `properties` blob layout is tenant-dependent) — a shape it can't read just yields
 * no group and is skipped.
 */
export function fetchSupportGroups(): { map: Record<string, string>; stats: SupportGroupRefresh } {
  const tagKey = configuredTagKey();
  const query = subscriptionsByTagQuery(tagKey);
  const map: Record<string, string> = {};
  const groups = new Set<string>();
  let cursor: string | null = null;
  let subscriptions = 0;
  let logged = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = graphSearchPage(query, { first: PAGE_SIZE, after: cursor });
    for (const node of result.nodes) {
      const entities = (node["entities"] as Rec[]) ?? [];
      for (const entity of entities) {
        // Log one raw entity on first fetch: the `properties` layout is tenant-specific
        // and this is the capture to tune recordSubscription against.
        if (!logged) {
          console.log(`Support-group sample entity: ${JSON.stringify(entity).slice(0, 800)}`);
          logged = true;
        }
        const group = recordSubscription(map, entity, tagKey);
        if (group) {
          subscriptions += 1;
          groups.add(group);
        }
      }
    }
    if (!result.hasNextPage || !result.endCursor) break;
    cursor = result.endCursor;
  }
  return {
    map,
    stats: { subscriptions, keys: Object.keys(map).length, groups: groups.size, tagKey },
  };
}

/**
 * Refresh the persisted subscription→Support Group map. Lock-free: the API endpoint wraps
 * it in the mutation lock, and afterPersist calls it while already holding the scan lock.
 * setSupportGroupMap bumps the settings version → DATA_VERSION, invalidating cached views.
 */
export function refreshSupportGroups(): SupportGroupRefresh {
  const { map, stats } = fetchSupportGroups();
  settingsStore.setSupportGroupMap(map);
  return stats;
}
