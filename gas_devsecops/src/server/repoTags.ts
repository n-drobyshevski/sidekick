// Repository-tag ingestion + join. This register reads TWO tags off a repository — the
// business domain (`domain`, `domain/domainTag.ts`) and the lifecycle (`lifecycle`,
// `domain/lifecycleTag.ts`) — and findings carry their repository without either of them, so
// both are graphSearched once over repository entities, folded into one repository-identity →
// tags map, and attached to each record live: `_domain` and `_lifecycle`, never baked into the
// ledger.
//
// ONE MODULE, ONE TAB, ONE MEMO, TWO TAGS, and that is a decision rather than an accumulation.
// gas/ keeps `bizDomains.ts` and `supportGroups.ts` apart because there the two values arrive
// on two different OBJECTS (a resource and a subscription) through two different queries. Here
// they arrive on the SAME repository entity, in the same `properties` blob, through the same
// paging loop — so splitting them would mean two tabs, two memos, two refresh buttons and two
// chances for a repository to be placed by one and not the other. What is genuinely two here
// is the VOCABULARY, and that is what lives in the two pure domain modules above.
//
// TWO QUERIES, NOT ONE, AND THE SECOND ONE IS NOT OPTIONAL. The fetch filters on a tag key
// (`where: { tags: { CONTAINS: [{ key }] } }`), so one pass only ever sees repositories
// carrying THAT key. Reading the lifecycle off the entities the domain pass already returned
// would be free and would be wrong: it would silently scope the lifecycle column to the
// domain-tagged estate, so a repository tagged END_OF_LIFE and nothing else would be invisible
// to the very exclusion it is the reason for. Both passes therefore run and MERGE — and each
// pass reads BOTH tags off every entity it sees, so the second pass costs pages, never
// correctness, and a repository carrying both is placed by whichever pass reaches it first.
// A single widened `where` (both keys in one CONTAINS) was NOT attempted: whether that reads as
// AND or as OR is not a thing this tree can verify without the live tenant, and a wrong guess
// there is a silent under-fetch. Two passes of a shape already in production is the version
// that cannot be wrong about a semantics nobody measured.
//
// THE MAP LOOKUP LIVES HERE, OUTSIDE THE PURE DOMAIN LAYER. `src/domain/domainScope.ts` only
// ever reads the pre-attached `_domain` field, so every catalogue, predicate and coverage
// figure stays testable without a spreadsheet. Fetch and persist go through the tag-map tab so
// a refresh bumps DATA_VERSION and every cached derivation repaints.
//
// THE TAB IS STILL CALLED `domain_map`, and the wire names are still `api_refreshDomains` /
// `api_domainMapHealth`. Renaming a persisted tab would orphan every deployed map for a word,
// and a tab this module reads through `TAB_HEADERS` gains its `lifecycle` column on the next
// write without anybody migrating anything (`sheetsDb.ensureHeaders`). The FILE is named for
// what it does, because nothing persists a file name.

import { carriedTags, domainOfTags, recordTags, resolveDomainTagKey } from "../domain/domainTag";
import { DOMAIN_FIELD } from "../domain/domainScope";
import { LIFECYCLE_FIELD, lifecycleOfTags, resolveLifecycleTagKey } from "../domain/lifecycleTag";
import { present, type Rec } from "../domain/util";
import { getProp, PROP_KEYS, setProp } from "./props";
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

/** The lifecycle tag key in effect. Its twin, and read at exactly the same three places. */
export function configuredLifecycleTagKey(): string {
  return resolveLifecycleTagKey(getProp(PROP_KEYS.wizLifecycleTagKey));
}

/** Both keys, read together — so no caller can fetch under one and resolve under the other. */
export interface TagKeys {
  domain: string;
  lifecycle: string;
}

export function configuredTagKeys(): TagKeys {
  return { domain: configuredDomainTagKey(), lifecycle: configuredLifecycleTagKey() };
}

/**
 * What one repository's entry in the map holds.
 *
 * BOTH FIELDS ARE INDEPENDENTLY NULLABLE, and an entry exists as soon as EITHER is known. A
 * repository tagged only with a lifecycle is in the map with `domain: null`, and is placed by
 * the lifecycle column while contributing nothing to any domain facet — which is the honest
 * reading of a tenant that tags its estate unevenly, and the reading `mapHealth` measures
 * separately for each tag rather than collapsing into one "placed" figure.
 */
export interface RepoTags {
  domain: string | null;
  lifecycle: string | null;
}

/** Repository identity token → the tags that repository carries. */
export type RepoTagMap = Record<string, RepoTags>;

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
 * Both tags for one record from a given map, or nulls when no identity hits.
 *
 * A record that already carries its own tag bag is answered from THAT first, before the map is
 * consulted. Nothing in this register produces such a record today — that is the whole reason
 * the map exists — but the direct read is the cheaper and more direct answer wherever the tags
 * do travel with the row, and a register that later learns to fetch them (a schema change on
 * Wiz's side, a different asset type) must not keep answering from a stale join instead.
 *
 * PER TAG, NOT PER RECORD. The own-bag read is taken for each tag separately, so a row that
 * carries its own lifecycle but no domain still gets its domain from the map. Falling back on
 * the pair — "the bag answered nothing at all, so look it up" — would have that row report no
 * domain because it happened to know its own lifecycle.
 *
 * `carriedTags`, NOT `recordTags` — what the row CARRIES, not what its `tags_json` column
 * stores. This is the only reader in the tree that meets a ledger row, and in this register
 * that column holds the collapsed `{slug: name}` project map; read as a tag bag it would answer
 * a bare-word key with a project NAME, and win, because the own bag is consulted first.
 * domainTag.ts's `carriedTags` carries the argument and the two reasons a per-row guard on
 * `projects_json` was not enough.
 */
export function resolveRepoTags(record: Rec, map: RepoTagMap, keys: TagKeys): RepoTags {
  const own = carriedTags(record);
  let domain = domainOfTags(own, keys.domain);
  let lifecycle = lifecycleOfTags(own, keys.lifecycle);
  if (domain !== null && lifecycle !== null) return { domain, lifecycle };
  for (const token of recordIdentityTokens(record)) {
    const hit = map[foldToken(token)];
    if (!hit) continue;
    if (domain === null && hit.domain) domain = hit.domain;
    if (lifecycle === null && hit.lifecycle) lifecycle = hit.lifecycle;
    if (domain !== null && lifecycle !== null) break;
  }
  return { domain, lifecycle };
}

/** The domain alone — `mapHealth` and its tests ask exactly this question. */
export function resolveDomain(record: Rec, map: RepoTagMap, tagKey: string): string | null {
  return resolveRepoTags(record, map, { domain: tagKey, lifecycle: "" }).domain;
}

/** The lifecycle alone. `resolveDomain`'s twin, same refusal shape. */
export function resolveLifecycle(record: Rec, map: RepoTagMap, tagKey: string): string | null {
  return resolveRepoTags(record, map, { domain: "", lifecycle: tagKey }).lifecycle;
}

/**
 * Attach `_domain` and `_lifecycle` to each record from the current map (in place).
 *
 * NO-OP ON AN EMPTY MAP — no refresh yet, or no tagged repository — so both fields simply stay
 * unset and every domain scope, breakdown and lifecycle column is inert rather than wrong. That
 * is the same failure mode `attachSupportGroups` chose, and it is the one that keeps "we never
 * learned" distinguishable from "nobody owns any of this".
 *
 * ONE PASS FOR BOTH TAGS, rather than two exported attachers over the same map. The rows are
 * the whole ledger; walking them twice to set two fields resolved from one lookup would double
 * the cost of the one function every read model depends on.
 */
export function attachRepoTags(records: Rec[]): void {
  const map = getRepoTagMap();
  if (!Object.keys(map).length) return;
  const keys = configuredTagKeys();
  for (const r of records) {
    const { domain, lifecycle } = resolveRepoTags(r, map, keys);
    if (domain) r[DOMAIN_FIELD] = domain;
    if (lifecycle) r[LIFECYCLE_FIELD] = lifecycle;
  }
}

// ------------------------------------------------------------------------ persistence

// Per-execution memo, for loadSettings' reason: every attachRepoTags call would otherwise
// re-read the whole tab. Module state dies with the GAS execution, so it can never serve
// cross-request data.
let mapMemo: RepoTagMap | undefined;

/** Drop this module's per-execution memo. */
export function resetRepoTagMapMemo(): void {
  mapMemo = undefined;
}

/**
 * The persisted repository-identity → tags map. `{}` before the first refresh.
 *
 * FAILS SOFT, AND THIS IS A PRODUCTION DECISION RATHER THAN A CONVENIENCE. Every read model
 * takes its rows from `readModels.baseSnapshot`, which attaches these tags — so a throw here
 * would take down the Executive, MTTR, Program, Register, Repos and History pages over a
 * lookup table that only decorates them. Both axes are ADDITIVE: the register answered every
 * one of its questions without them, and it must keep answering them when the map is
 * unreachable.
 *
 * An unreadable map is therefore the SAME STATE as an unrefreshed one — no tags known — and
 * `attachRepoTags` already treats that as a no-op rather than as an error. The switcher's
 * domain group simply does not appear, `scope.noDomain` equals the register, the Lifecycle
 * column is empty everywhere, and the Settings map-health readout says zero keys. All of which
 * is true.
 *
 * It is logged, not swallowed: a GAS execution log line is how an operator finds out that the
 * map is unreachable for a reason other than "never refreshed", which the readout alone cannot
 * tell them. The memo is set either way, so a broken tab costs one failed read per execution
 * rather than one per model.
 *
 * A ROW WITH NEITHER VALUE IS SKIPPED, which is also how a `domain_map` tab written before the
 * `lifecycle` column existed reads: `readAll` maps by header name, so the missing column comes
 * back absent and every one of those rows still places its domain.
 */
export function getRepoTagMap(): RepoTagMap {
  if (mapMemo !== undefined) return mapMemo;
  const map: RepoTagMap = {};
  try {
    ensureTab(TABS.domainMap);
    for (const row of readAll(TABS.domainMap)) {
      const token = String(row["token"] ?? "");
      const domain = String(row["domain"] ?? "");
      const lifecycle = String(row["lifecycle"] ?? "");
      if (!token || (!domain && !lifecycle)) continue;
      map[token] = { domain: domain || null, lifecycle: lifecycle || null };
    }
  } catch (e) {
    console.warn(`Repository tag map unreadable — no tags attached this execution: ${String(e)}`);
  }
  mapMemo = map;
  return map;
}

/**
 * Persist the map, stamp the keys it was built under, and invalidate every cached read.
 *
 * The version bump is not optional: read models are keyed by it, so a refreshed map that did
 * not bump would leave every cached domain figure answering for the old attribution.
 *
 * THE STAMP IS TAKEN HERE because this is the single write point for the map, and taking it
 * anywhere else is how a map and its provenance drift apart. For the only real writer the keys
 * in force ARE the keys the map was fetched under: `fetchRepoTags` reads them from
 * `configuredTagKeys()` one call earlier and pages once per key. `devSeed.seedRepoTagMap` also
 * lands here, and stamping the configured keys is right for it too — a seeded map is not
 * fetched under any key, so the honest reading is "current", which is what keeps the harness
 * from showing a stale-map warning it cannot act on.
 */
export function setRepoTagMap(map: RepoTagMap): void {
  ensureTab(TABS.domainMap);
  const rows = Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([token, tags]) => ({
      token,
      domain: tags.domain ?? null,
      lifecycle: tags.lifecycle ?? null,
    }));
  overwrite(TABS.domainMap, rows);
  setProp(PROP_KEYS.repoTagMapKeys, JSON.stringify(configuredTagKeys()));
  mapMemo = { ...map };
  bumpDataVersion();
}

/**
 * The keys the persisted map was built under, or null when nothing recorded them.
 *
 * NULL IS "UNKNOWN", NOT "THE SAME". Every sheet written before the stamp existed reads null
 * here, and that population is exactly the one a key change strands — so it must not be folded
 * into agreement. `mapHealth` reports the distinction and the card words it for what is known.
 *
 * Fails soft, like every other read in this file: a hand-edited or truncated property is one
 * unknown provenance, not a Settings page that will not paint.
 */
export function builtUnderKeys(): TagKeys | null {
  const raw = getProp(PROP_KEYS.repoTagMapKeys);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Rec;
    const domain = typeof rec["domain"] === "string" ? rec["domain"] : "";
    const lifecycle = typeof rec["lifecycle"] === "string" ? rec["lifecycle"] : "";
    if (!domain && !lifecycle) return null;
    return { domain, lifecycle };
  } catch {
    return null;
  }
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
      // A tenant-dependent blob we cannot read carries no tags, and is not a failed refresh.
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
 * One repository entity's tags and the folded identity tokens to index it under.
 *
 * TOKENS ARE EMITTED WHEN EITHER TAG ANSWERS, not when the domain does. The fetch below runs a
 * pass per key and merges, so an entity returned by the lifecycle pass must be indexable on the
 * strength of its lifecycle alone — gating on the domain would drop exactly the repositories
 * the second pass exists to reach.
 *
 * Pure and defensive — the `properties` blob layout is tenant-dependent, so an unreadable shape
 * yields no tags rather than throwing and taking a whole refresh down with it.
 */
export function parseRepoEntity(
  entity: Rec,
  keys: TagKeys,
): { domain: string | null; lifecycle: string | null; tokens: string[] } {
  const props = entityProperties(entity);
  // ONE normaliser for every tag shape — see domainTag.recordTags. The graphSearch array form
  // (`properties.tags` as `[{key, value}]`), the object form and the flat `tag:<key>` form are
  // all read by it, so this function does not carry a fourth copy of that logic.
  //
  // `recordTags` HERE AND `carriedTags` IN `resolveRepoTags`, which is not an oversight. This
  // blob is the TENANT's own `properties`; no reconcile pass ever wrote a project map into it,
  // and a tenant property literally named `tags_json` holding a tag object is the one case that
  // branch is still for. The ledger column that had to be refused is a thing this register
  // writes, and it is never on an entity.
  const bag = recordTags(props);
  const domain = domainOfTags(bag, keys.domain);
  const lifecycle = lifecycleOfTags(bag, keys.lifecycle);
  const tokens: string[] = [];
  if (domain || lifecycle) {
    for (const k of PROP_ID_KEYS) {
      const v = props[k];
      if (present(v) && String(v).trim()) tokens.push(foldToken(v));
    }
    for (const k of ["id", "name"]) {
      const v = entity[k];
      if (present(v) && String(v).trim()) tokens.push(foldToken(v));
    }
  }
  return { domain, lifecycle, tokens };
}

export interface RepoTagRefresh {
  /** Repositories seen carrying EITHER tag, across both passes. Double-counts nothing. */
  repos: number;
  /** Identity tokens indexed. */
  keys: number;
  /** Distinct domains. */
  domains: number;
  /** Distinct lifecycle values. */
  lifecycles: number;
  /** The domain tag key the pass ran under. Named `tagKey` since before there were two. */
  tagKey: string;
  lifecycleTagKey: string;
}

/**
 * Fetch every repository carrying either tag and build the identity → tags map.
 *
 * Pages via the graphSearch endCursor. `queryPage` already resolves the connection by FINDING
 * the root key that carries `nodes`/`pageInfo` rather than guessing it, so a graphSearch
 * response needs no second transport here — reusing it is what keeps this register from
 * growing gas/'s separate `graphSearchPage`, which exists there only because that client
 * hardcodes its root.
 *
 * ONE PASS PER DISTINCT KEY. Two keys that resolve to the same string (an operator who points
 * both Script Properties at one tag) run ONE pass, because the second would be the same
 * request returning the same entities; both tags are still read off every entity, so that case
 * loses nothing.
 *
 * Never partial-throws on a surprising entity shape: one it cannot read yields no tags and is
 * skipped, so a single odd repository cannot cost the other few thousand their attribution.
 */
export function fetchRepoTags(): { map: RepoTagMap; stats: RepoTagRefresh } {
  const keys = configuredTagKeys();
  const map: RepoTagMap = {};
  const domains = new Set<string>();
  const lifecycles = new Set<string>();
  // Counted by REPOSITORY rather than by entity-seen, so a repository returned by both passes
  // is one repository. The first token is the identity, for the reason `devSeed.seedDomainMap`
  // states: an entity contributes all of its tokens or none of them.
  const seen = new Set<string>();
  let logged = false;

  const passKeys = keys.domain.trim().toLowerCase() === keys.lifecycle.trim().toLowerCase()
    ? [keys.domain]
    : [keys.domain, keys.lifecycle];

  for (const passKey of passKeys) {
    const query = reposByTagQuery(passKey);
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = queryPage(query, { first: PAGE_SIZE, after: cursor });
      for (const node of result.nodes) {
        const entities = (node["entities"] as Rec[]) ?? [];
        for (const entity of entities) {
          // Log one raw entity per refresh: the `properties` layout is tenant-specific, and
          // this is the capture to tune PROP_ID_KEYS against if the join comes back empty.
          if (!logged) {
            console.log(`Repository-tag sample entity: ${JSON.stringify(entity).slice(0, 800)}`);
            logged = true;
          }
          const { domain, lifecycle, tokens } = parseRepoEntity(entity, keys);
          if (!tokens.length) continue; // carries neither tag
          for (const token of tokens) {
            const prev = map[token];
            map[token] = {
              // LATEST NON-NULL WINS ACROSS PASSES, never an erase. The lifecycle pass sees a
              // repository the domain pass already placed and must not blank its domain
              // because this entity's bag answered nothing for that key.
              domain: domain ?? prev?.domain ?? null,
              lifecycle: lifecycle ?? prev?.lifecycle ?? null,
            };
          }
          if (!seen.has(tokens[0]!)) seen.add(tokens[0]!);
          if (domain) domains.add(domain);
          if (lifecycle) lifecycles.add(lifecycle);
        }
      }
      if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break;
      cursor = result.pageInfo.endCursor;
    }
  }

  return {
    map,
    stats: {
      repos: seen.size,
      keys: Object.keys(map).length,
      domains: domains.size,
      lifecycles: lifecycles.size,
      tagKey: keys.domain,
      lifecycleTagKey: keys.lifecycle,
    },
  };
}

/**
 * Refresh the persisted repository → tags map.
 *
 * Lock-free: the API endpoint wraps it in the mutation lock, exactly as gas/'s does.
 */
export function refreshRepoTags(): RepoTagRefresh {
  const { map, stats } = fetchRepoTags();
  setRepoTagMap(map);
  return stats;
}

export interface MapHealth {
  /** Identity tokens indexed. */
  keys: number;
  /** Distinct domains in the map. */
  domains: number;
  /** Distinct lifecycle values in the map. */
  lifecycles: number;
  tagKey: string;
  lifecycleTagKey: string;
  /**
   * The keys the PERSISTED map was built under, when anything recorded them.
   *
   * THREE STATES, AND THE CARD MUST TELL THEM APART. `null` is "nothing recorded it" — a map
   * written before the stamp existed, which is precisely the population a key change strands,
   * so it is never folded into agreement. Equal to the keys above is the healthy case. Unequal
   * means the map on the tab answers under a key this register no longer reads, and a refresh
   * is what fixes it. Only meaningful when `keys > 0`: with no map at all there is no
   * provenance to disagree with, and the card already says "Never refreshed".
   */
  builtUnder: TagKeys | null;
  /**
   * `builtUnder` disagrees with the keys in force — the map answers under a key this register
   * no longer reads, and a refresh is what fixes it.
   *
   * DECIDED SERVER-SIDE AND SHIPPED, rather than re-derived on the card. The comparison has
   * rules (case-insensitive, trimmed, and an unknown provenance counts as stale) and a second
   * copy of them on the client is how the card and the model come to disagree about what the
   * operator is being told.
   */
  staleKeys: boolean;
  /** Repositories in the `repos` tab — the register's own asset dimension. */
  repos: number;
  /** Of those, how many the map places a DOMAIN for. THE FIGURE THAT MATTERS. */
  placed: number;
  /** Of those, how many the map places a LIFECYCLE for — measured separately, on purpose. */
  lifecyclePlaced: number;
  /** A few map tokens, and a few repository identities the map did NOT place. */
  sampleTokens: string[];
  sampleUnplaced: string[];
}

/** How many of a sample to carry back. Enough to see a shape, few enough to read. */
const SAMPLE = 5;

/**
 * What the Settings readout says about the map, without fetching anything from Wiz.
 *
 * SEPARATE FROM THE REFRESH STATS on purpose. `RepoTagRefresh` describes what one fetch SAW;
 * this describes what the register can currently DO with it.
 *
 * IT MEASURES THE JOIN RATHER THAN ASSERTING IT, and that is the whole point of the rewrite.
 * An earlier version reported keys and domains only — and a map with thousands of keys and
 * three domains reads as healthy while placing exactly zero findings, because the tokens a
 * repository ENTITY carries need not be the ones a FINDING carries (see
 * `recordIdentityTokens`: nothing in this tree can verify that overlap without the live
 * tenant). That is the third state, the one an operator staring at an empty domain switcher
 * is actually in, and a readout that cannot see it is the confident lie the card exists to
 * prevent. `placed` is what separates it from the other two:
 *
 *   keys 0                    never refreshed
 *   keys > 0, placed 0        fetched, but the map reaches none of this register's repos
 *   keys > 0, placed > 0      working — the switcher should be offering these domains
 *
 * TWO PLACEMENT FIGURES, NOT ONE, because the two tags fail independently and for different
 * reasons. A lifecycle key that matches nothing in the tenant's vocabulary — which the
 * `lifecycle` DEFAULT is explicitly allowed to be (`domain/lifecycleTag.ts`) — produces
 * `lifecyclePlaced: 0` beside a perfectly healthy `placed`, and that difference is the whole
 * signal an operator needs to go and correct one Script Property. Collapsing them into one
 * "placed" would hide exactly the state the default was designed to make visible.
 *
 * The samples are carried ONLY to make the middle case actionable. Two lists side by side —
 * what the map is keyed on, what the register's repositories are called — is what turns "the
 * domains do not appear" into a visible mismatch an operator can report, without anyone
 * needing the execution log.
 *
 * JOINED AGAINST THE `repos` TAB, NOT THE LEDGER. It is one row per repository rather than one
 * per finding, it carries the same `repo_id`/`repo_name` the join probes, and reading it costs
 * a fraction of a base-row build — this is a diagnostic on a Settings card, and it must not
 * cost what a page costs.
 */
export function mapHealth(): MapHealth {
  const map = getRepoTagMap();
  const keys = configuredTagKeys();
  const tokens = Object.keys(map);

  let repos = 0;
  let placed = 0;
  let lifecyclePlaced = 0;
  const sampleUnplaced: string[] = [];
  try {
    for (const row of readAll(TABS.repos)) {
      repos += 1;
      const tags = resolveRepoTags(row, map, keys);
      if (tags.lifecycle) lifecyclePlaced += 1;
      if (tags.domain) {
        placed += 1;
        continue;
      }
      if (sampleUnplaced.length < SAMPLE) {
        // The identity as the REGISTER spells it — which is the half of the mismatch the map
        // does not already show.
        sampleUnplaced.push(String(row["repo_name"] ?? row["repo_id"] ?? "(blank)"));
      }
    }
  } catch (e) {
    // Same posture as `getRepoTagMap`: a diagnostic that cannot read the tab reports what it
    // knows rather than taking the Settings page down.
    console.warn(`Repos tab unreadable — repository tag map health is partial: ${String(e)}`);
  }

  const domains = new Set<string>();
  const lifecycles = new Set<string>();
  for (const t of Object.values(map)) {
    if (t.domain) domains.add(t.domain);
    if (t.lifecycle) lifecycles.add(t.lifecycle);
  }

  const builtUnder = builtUnderKeys();
  return {
    keys: tokens.length,
    domains: domains.size,
    lifecycles: lifecycles.size,
    tagKey: keys.domain,
    lifecycleTagKey: keys.lifecycle,
    builtUnder,
    staleKeys: keysAreStale(tokens.length, builtUnder, keys),
    repos,
    placed,
    lifecyclePlaced,
    sampleTokens: tokens.slice(0, SAMPLE),
    sampleUnplaced,
  };
}

/**
 * Does a map of `keyCount` tokens, built under `built`, answer under keys this register no
 * longer reads?
 *
 * EXPORTED SO THE RULE HAS ONE HOME. Compared case-insensitively and trimmed, for `tagValue`'s
 * reason: a map fetched under `Domain` against a property now reading `domain` is the SAME key,
 * and a warning there would send an operator to refresh something that is already right.
 *
 * FALSE WITH NO MAP. There is nothing stale about a map that does not exist, and the card
 * already says "Never refreshed" for that — a deployment that has never pressed the button
 * must not be told its map is out of date on top of it.
 */
export function keysAreStale(
  keyCount: number,
  built: TagKeys | null,
  inForce: TagKeys,
): boolean {
  if (keyCount <= 0) return false;
  if (!built) return true; // unknown provenance is not agreement — see `builtUnderKeys`.
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return !same(built.domain, inForce.domain) || !same(built.lifecycle, inForce.lifecycle);
}
