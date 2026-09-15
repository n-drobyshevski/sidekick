// Business-domain ingestion + join. A domain is the value of a repository's `Wiz/Domain` tag
// (e.g. "SAP", "CROSS"); findings carry their repository but not its tags, so we graphSearch
// every tagged repository once, build a repository-identity → domain map, and attach `_domain`
// to each record live — never baked into the ledger.
//
// THE MIRROR OF gas/src/server/supportGroups.ts, structurally and for the same reason. There,
// a Support Group lives on a SUBSCRIPTION that findings carry without its tags; here, a domain
// lives on a REPOSITORY that findings carry without its tags. gas/'s own `bizDomains.ts` is
// the SHORT one precisely because its register does get the tag for free on every finding —
// this register does not, and src/domain/domainTag.ts's header records exactly which three
// query documents cannot ask for it and how that was established.
//
// THE MAP LOOKUP LIVES HERE, OUTSIDE THE PURE DOMAIN LAYER. `src/domain/domainScope.ts` only
// ever reads the pre-attached `_domain` field, so every catalogue, predicate and coverage
// figure stays testable without a spreadsheet. Fetch and persist go through the domain-map tab
// so a refresh bumps DATA_VERSION and every cached derivation repaints.

import { domainOfTags, recordTags, resolveDomainTagKey } from "../domain/domainTag";
import { DOMAIN_FIELD } from "../domain/domainScope";
import { present, type Rec } from "../domain/util";
import { getProp, PROP_KEYS } from "./props";
import { bumpDataVersion } from "./serverCache";
import { ensureTab, overwrite, readAll, TABS } from "./sheetsDb";
import { queryPage } from "./wizClient";
import { MAX_PAGES, PAGE_SIZE, reposByTagQuery } from "./wizReposQuery";

/**
 * The domain tag key in effect — the configured override, else the default. The single source
 * of truth for the fetch query below and for the Settings map-health readout.
 */
export function configuredDomainTagKey(): string {
  return resolveDomainTagKey(getProp(PROP_KEYS.wizDomainTagKey));
}

/** The fold both sides of the join use, so keys and lookups agree. */
export function foldToken(v: unknown): string {
  return String(v).trim().toLowerCase();
}

// --------------------------------------------------------------------------- the join

/**
 * Repository-identity columns a finding record can carry.
 *
 * ALL OF THEM, AND ANY ONE HIT IS ENOUGH. `repo_id` is what reconcile.ts writes from SCA's
 * `vulnerableAsset.id` and SAST's/secrets' `resource.id`; whether a graphSearch entity's `id`
 * is the same identifier is not something this tree can verify without the live tenant, and
 * guessing wrong yields a join that silently matches nothing. So the map is indexed under every
 * token a repository entity carries (below) and probed with every token a finding carries, and
 * the first overlap wins. That is gas/'s answer to the identical uncertainty about
 * subscriptions, and it is the one that degrades to "no domain" rather than to a wrong one.
 */
const RECORD_ID_COLS = ["repo_id", "repo_name"];
const FRAME_ID_COLS = [
  "vulnerableAsset.id", "vulnerableAsset.name",
  "resource.id", "resource.name", "resource.externalId",
];

function recordIdentityTokens(record: Rec): string[] {
  const out: string[] = [];
  for (const col of RECORD_ID_COLS) {
    const v = record[col];
    if (present(v)) out.push(String(v));
  }
  for (const col of FRAME_ID_COLS) {
    const v = record[col];
    if (present(v)) {
      out.push(String(v));
      continue;
    }
    const [head, leaf] = col.split(".");
    const node = record[head];
    if (node && typeof node === "object" && !Array.isArray(node)) {
      const nested = (node as Rec)[leaf];
      if (present(nested)) out.push(String(nested));
    }
  }
  return out;
}

/**
 * The domain for one record from a given map, or null when no identity hits.
 *
 * A record that already carries its own tag bag is answered from THAT first, before the map is
 * consulted. Nothing in this register produces such a record today — that is the whole reason
 * the map exists — but `domainOfTags` is the cheaper and more direct answer wherever the tag
 * does travel with the row, and a register that later learns to fetch it (a schema change on
 * Wiz's side, a different asset type) must not keep answering from a stale join instead.
 */
export function resolveDomain(record: Rec, map: Record<string, string>, tagKey: string): string | null {
  const own = domainOfTags(recordTags(record), tagKey);
  if (own) return own;
  for (const token of recordIdentityTokens(record)) {
    const domain = map[foldToken(token)];
    if (domain) return domain;
  }
  return null;
}

/**
 * Attach `_domain` to each record from the current map (in place).
 *
 * NO-OP ON AN EMPTY MAP — no refresh yet, or no tagged repository — so the field simply stays
 * unset and every domain scope and breakdown is inert rather than wrong. That is the same
 * failure mode `attachSupportGroups` chose, and it is the one that keeps "we never learned"
 * distinguishable from "nobody owns any of this".
 */
export function attachDomains(records: Rec[]): void {
  const map = getDomainMap();
  if (!Object.keys(map).length) return;
  const tagKey = configuredDomainTagKey();
  for (const r of records) {
    const domain = resolveDomain(r, map, tagKey);
    if (domain) r[DOMAIN_FIELD] = domain;
  }
}

// ------------------------------------------------------------------------ persistence

// Per-execution memo, for loadSettings' reason: every attachDomains call would otherwise
// re-read the whole tab. Module state dies with the GAS execution, so it can never serve
// cross-request data.
let mapMemo: Record<string, string> | undefined;

/** Drop this module's per-execution memo. */
export function resetDomainMapMemo(): void {
  mapMemo = undefined;
}

/**
 * The persisted repository-identity → domain map. `{}` before the first refresh.
 *
 * FAILS SOFT, AND THIS IS A PRODUCTION DECISION RATHER THAN A CONVENIENCE. Every read model
 * takes its rows from `readModels.baseSnapshot`, which attaches domains — so a throw here
 * would take down the Executive, MTTR, Program, Register, Repos and History pages over a
 * lookup table that only decorates them. The domain axis is ADDITIVE: the register answered
 * every one of its questions without it until now, and it must keep answering them when the
 * map is unreachable.
 *
 * An unreadable map is therefore the SAME STATE as an unrefreshed one — no domains known — and
 * `attachDomains` already treats that as a no-op rather than as an error. The switcher's
 * domain group simply does not appear, `scope.noDomain` equals the register, and the Settings
 * map-health readout says zero keys. All of which is true.
 *
 * It is logged, not swallowed: a GAS execution log line is how an operator finds out that the
 * map is unreachable for a reason other than "never refreshed", which the readout alone cannot
 * tell them. The memo is set either way, so a broken tab costs one failed read per execution
 * rather than one per model.
 */
export function getDomainMap(): Record<string, string> {
  if (mapMemo !== undefined) return mapMemo;
  const map: Record<string, string> = {};
  try {
    ensureTab(TABS.domainMap);
    for (const row of readAll(TABS.domainMap)) {
      const token = String(row["token"] ?? "");
      const domain = String(row["domain"] ?? "");
      if (token && domain) map[token] = domain;
    }
  } catch (e) {
    console.warn(`Domain map unreadable — no domains attached this execution: ${String(e)}`);
  }
  mapMemo = map;
  return map;
}

/**
 * Persist the map and invalidate every cached read.
 *
 * The version bump is not optional: read models are keyed by it, so a refreshed map that did
 * not bump would leave every cached domain figure answering for the old attribution.
 */
export function setDomainMap(map: Record<string, string>): void {
  ensureTab(TABS.domainMap);
  const rows = Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([token, domain]) => ({ token, domain }));
  overwrite(TABS.domainMap, rows);
  mapMemo = { ...map };
  bumpDataVersion();
}

// ----------------------------------------------------------------------------- fetch

/** Coerce an entity's `properties` (object, JSON string, or absent) to a plain object. */
function entityProperties(entity: Rec): Rec {
  const p = entity["properties"];
  if (p && typeof p === "object" && !Array.isArray(p)) return p as Rec;
  if (typeof p === "string" && p) {
    try {
      const parsed = JSON.parse(p) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Rec;
    } catch {
      // A tenant-dependent blob we cannot read carries no domain, and is not a failed refresh.
    }
  }
  return {};
}

/**
 * Property keys that identify a repository. Every one that is present is indexed, for
 * `recordIdentityTokens`' reason above.
 */
const PROP_ID_KEYS = [
  "id", "externalId", "providerUniqueId", "repositoryId", "repositoryName",
  "fullName", "name", "cloudProviderURL",
];

/**
 * One repository entity's domain and the folded identity tokens to index it under.
 *
 * `domain` is null when the entity carries no such tag. Pure and defensive — the `properties`
 * blob layout is tenant-dependent, so an unreadable shape yields no domain rather than
 * throwing and taking a whole refresh down with it.
 */
export function parseRepoEntity(
  entity: Rec,
  tagKey: string,
): { domain: string | null; tokens: string[] } {
  const props = entityProperties(entity);
  // ONE normaliser for every tag shape — see domainTag.recordTags. The graphSearch array form
  // (`properties.tags` as `[{key, value}]`), the object form and the flat `tag:<key>` form are
  // all read by it, so this function does not carry a fourth copy of that logic.
  const domain = domainOfTags(recordTags(props), tagKey);
  const tokens: string[] = [];
  if (domain) {
    for (const k of PROP_ID_KEYS) {
      const v = props[k];
      if (present(v) && String(v).trim()) tokens.push(foldToken(v));
    }
    for (const k of ["id", "name"]) {
      const v = entity[k];
      if (present(v) && String(v).trim()) tokens.push(foldToken(v));
    }
  }
  return { domain, tokens };
}

export interface DomainRefresh {
  /** Tagged repositories seen. */
  repos: number;
  /** Identity tokens indexed. */
  keys: number;
  /** Distinct domains. */
  domains: number;
  tagKey: string;
}

/**
 * Fetch every repository carrying the domain tag and build the identity → domain map.
 *
 * Pages via the graphSearch endCursor. `queryPage` already resolves the connection by FINDING
 * the root key that carries `nodes`/`pageInfo` rather than guessing it, so a graphSearch
 * response needs no second transport here — reusing it is what keeps this register from
 * growing gas/'s separate `graphSearchPage`, which exists there only because that client
 * hardcodes its root.
 *
 * Never partial-throws on a surprising entity shape: one it cannot read yields no domain and is
 * skipped, so a single odd repository cannot cost the other few thousand their attribution.
 */
export function fetchRepoDomains(): { map: Record<string, string>; stats: DomainRefresh } {
  const tagKey = configuredDomainTagKey();
  const query = reposByTagQuery(tagKey);
  const map: Record<string, string> = {};
  const domains = new Set<string>();
  let cursor: string | null = null;
  let repos = 0;
  let logged = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = queryPage(query, { first: PAGE_SIZE, after: cursor });
    for (const node of result.nodes) {
      const entities = (node["entities"] as Rec[]) ?? [];
      for (const entity of entities) {
        // Log one raw entity per refresh: the `properties` layout is tenant-specific, and this
        // is the capture to tune PROP_ID_KEYS against if the join comes back empty.
        if (!logged) {
          console.log(`Domain-tag sample entity: ${JSON.stringify(entity).slice(0, 800)}`);
          logged = true;
        }
        const { domain, tokens } = parseRepoEntity(entity, tagKey);
        if (!domain) continue; // only tagged repositories contribute
        for (const token of tokens) map[token] = domain;
        repos += 1;
        domains.add(domain);
      }
    }
    if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break;
    cursor = result.pageInfo.endCursor;
  }

  return { map, stats: { repos, keys: Object.keys(map).length, domains: domains.size, tagKey } };
}

/**
 * Refresh the persisted repository → domain map.
 *
 * Lock-free: the API endpoint wraps it in the mutation lock, exactly as gas/'s does.
 */
export function refreshRepoDomains(): DomainRefresh {
  const { map, stats } = fetchRepoDomains();
  setDomainMap(map);
  return stats;
}

/**
 * What the Settings readout says about the map, without fetching anything.
 *
 * SEPARATE FROM THE REFRESH STATS on purpose. `DomainRefresh` describes what one fetch saw;
 * this describes what the register is CURRENTLY joining against, which is what an operator
 * looking at an empty domain switcher needs. The two disagree exactly when a refresh has not
 * been run since the tag key changed — which is the case worth being able to see.
 */
export function mapHealth(): { keys: number; domains: number; tagKey: string } {
  const map = getDomainMap();
  return {
    keys: Object.keys(map).length,
    domains: new Set(Object.values(map)).size,
    tagKey: configuredDomainTagKey(),
  };
}
