// The business domain a repository belongs to, read off its `domain` tag.
//
// Ported from gas/src/domain/domainTag.ts, which carries the same idea for the OS-vulnerability
// register. The tenant tags each repository with the domain that owns it; that is the one
// attribution fact this register can carry without deriving anything — not a rule, not a
// score, not a verdict, just a string the tenant wrote on the resource.
//
// THE TWO PORTS READ DIFFERENT KEYS, AND THAT IS THE DATA, NOT A DRIFT. gas/ defaults to
// `Wiz/Domain`, the namespaced key Wiz's own console writes onto a cloud resource. This
// register's subject is a repository, and a repository's domain reaches Wiz from the tenant's
// own catalogue under the bare word `domain` — the same road, and the same spelling habit, the
// `lifecycle` tag arrives by. See DEFAULT_DOMAIN_TAG_KEY.
//
// WHY THE TAG CANNOT COME OFF A FINDING HERE, which is the whole reason this register went
// without a domain axis until now and the reason `src/server/repoTags.ts` exists at all.
// gas/ reads the tag straight off `vulnerableAsset.tags`, already in its vulnerability query
// and already persisted per finding. This register cannot: its asset is a repository branch,
// and the finding-level asset types do not expose `tags`.
//
//   Q_SCA      `VulnerableAssetRepositoryBranch` — the ONE member of the vulnerableAsset union
//              that Wiz's own console query does not select `tags` on. gas/src/server/
//              wizQuery.ts is that console capture verbatim: `tags` appears on all twelve other
//              members and is absent from this one. A field the schema lacks fails the WHOLE
//              document, so adding it speculatively would take SCA syncing down.
//   Q_SAST     `resource { id name type }`. PROBE_FINDINGS.md §7.3 introspected the sibling
//              secrets type and printed no `tags` among its fields.
//   Q_SECRETS  `SecretInstanceResource!` — same introspection, same absence.
//
// So the tag is fetched SEPARATELY, by a graphSearch over repository entities, and joined onto
// findings by repository identity. That is not a workaround invented here: it is exactly what
// gas/src/server/supportGroups.ts already does for `Wiz/provisioning`, which lives on a
// SUBSCRIPTION that findings likewise carry without its tags. One register's domain is the
// other register's support group, structurally.
//
// RESOLVED ON READ, NEVER BAKED. The key is configurable, and a key baked into the ledger
// would mean a full re-scan to correct a typo. The join map is persisted; the ANSWER is not.
// `_domain` is attached to records in memory by repoTags.attachRepoTags and never written to
// a ledger column — the same discipline `gas/` keeps for `_bizDomain` and `_supportGroup`, and
// for the same reason: a stale baked column wins for anything reading the tab directly.
//
// ABSENCE IS REPORTED AS A COUNT, NOT AS A SENTINEL VALUE. An untagged repository has no
// domain and contributes nothing to a facet, exactly as a row with no project already does —
// there is deliberately no "Untagged" domain value, because offering the repositories we know
// least about as though they were an owner is the lie a coverage figure exists to prevent. The
// bootstrap's `scope.noDomain` is what discharges that duty instead, the same way
// `scope.unattributed` already does for projects (see src/client/js/ui/projectScope.js).

import { present, type Rec } from "./util";

/**
 * The tag key this register reads a domain off, when nothing overrides it.
 *
 * A BARE WORD, and `lifecycleTag.DEFAULT_LIFECYCLE_TAG_KEY`'s twin rather than gas/'s
 * `Wiz/Domain`. The difference is a statement about where each tag COMES FROM. gas/'s subject
 * is a cloud resource and its key is the one Wiz's console writes and namespaces; this
 * register's subject is a repository, and a repository's domain is a property the tenant
 * carries on the repository itself (a GitHub custom property, a platform catalogue) which
 * reaches Wiz under whatever key that system already used. Both tags this register reads
 * travel that road, so both default to the word the tenant's own catalogue uses.
 *
 * WHICH MAKES THE DEFAULT A GUESS, where gas/'s is a fact — and the same cheap-guess discharge
 * `lifecycleTag.ts` documents applies here: `WIZ_DOMAIN_TAG_KEY` overrides it
 * (server/props.ts), the key match is case-insensitive (`tagValue`), and `repoTags.mapHealth`
 * publishes how many repositories the key actually PLACED. A default that matches nothing shows
 * up on the Settings page as a zero an operator can act on, rather than as a column that is
 * quietly empty everywhere. A tenant that does spell it `Wiz/Domain` sets the Script Property;
 * README.md's Setup section names it.
 */
export const DEFAULT_DOMAIN_TAG_KEY = "domain";

/** The configured key, else the default — one source of truth for fold and read alike. */
export function resolveDomainTagKey(configured: string | null | undefined): string {
  const k = (configured ?? "").trim();
  return k || DEFAULT_DOMAIN_TAG_KEY;
}

/**
 * A record's tag bag, normalised out of every shape this register stores tags in.
 *
 * FOUR SHAPES, ONE ANSWER, and the count is not padding — each one is a real source in this
 * tree and reading only some of them is how a domain goes missing on one page and not another:
 *
 *   `tags_json` string        a ledger row's own column — but see the warning below
 *   nested `<asset>.tags`     a raw node, as the SCA query would return it
 *   flat `<asset>.tags.<key>` a flattened frame record
 *   `[{key, value}]` array    a graphSearch entity's `properties.tags` — the shape
 *                             repoTags.ts actually reads, since that is where this
 *                             register's tags come from at all
 *
 * gas/ splits these across `domainRules.recordTags` (the first three) and
 * `supportGroups.supportGroupValue` (the array and `tag:` forms), because there they arrive on
 * two different objects. Here they arrive on the same axis, so they are one function — two
 * normalisers is how a codebase ends up with two answers to "what tags does this carry".
 *
 * `tags_json` IN THIS REGISTER IS NOT TAGS, and reading this function without knowing that is
 * how someone later concludes the join is redundant. reconcile.ts writes
 * `tags_json: projectsJson(rec) ?? tagsJson(rec)`, and every node carries `projects[]`, so the
 * column holds the collapsed `{slug: name}` PROJECT MAP. The fallback half of that expression
 * cannot fire on a live row either: `tagsJson` reads `vulnerableAsset.tags`, and
 * `server/wizQueries.ts` does not select `tags` anywhere in any of the three documents — that
 * absence is the premise this whole module rests on. So on a ledger row the column is the
 * project map or it is null; it is never a tag bag.
 *
 * It is still read HERE, first, because the column is what its NAME promises on any row where a
 * tag bag did land (the SCA fixture that keeps `tagsJson` live), and because a register that
 * later learns to fetch tags per finding should not need this function changed. What changed is
 * WHO TRUSTS IT: `carriedTags` below is this same fold minus that one source, and
 * `repoTags.resolveRepoTags` — the only reader that meets a ledger row — uses that instead.
 *
 * THAT SPLIT IS WHAT LETS THE DEFAULT KEY BE A BARE WORD. The column is deliberately left as it
 * is rather than "corrected": `projects_json` already carries the uncollapsed list,
 * `test/reconcile.test.ts` pins this output byte-for-byte, and deployed sheets hold project maps
 * in it today. But the own-bag read runs BEFORE the join map and wins, so a tag key that
 * collides with a PROJECT SLUG would have read a project name as a domain, for every finding in
 * that project. `Wiz/Domain` could not collide (slugs carry no `/`) and `domain` plainly can —
 * as `lifecycle` already could. Excluding the column closes it for both, by construction, and
 * without asking the reader to hold "unless the slug happens to be spelled like the key" in
 * their head.
 *
 * NEVER THROWS. Every input is either a spreadsheet cell or a tenant-dependent `properties`
 * blob; an unreadable one yields `{}` so the caller reports "no domain known" rather than
 * taking a page down.
 */
export function recordTags(record: Rec | null | undefined): Rec {
  if (!record) return {};
  // The column goes in FIRST and `carriedTags` overwrites it, which is the precedence the
  // single fold had when all four shapes wrote into one bag in this order. A spread copies
  // every own enumerable key regardless of value, so a carried key explicitly set to
  // `undefined` still wins, exactly as `out[k] = v` did.
  return { ...tagsJsonColumn(record), ...carriedTags(record) };
}

/**
 * The `tags_json` COLUMN, parsed — `{}` for absent, blank, non-JSON, or a JSON array.
 *
 * Private, and split out of `recordTags` only so `carriedTags` can be the SAME fold minus this
 * one source rather than a second normaliser with its own answer to "what tags does this carry".
 */
function tagsJsonColumn(record: Rec): Rec {
  const out: Rec = {};
  const raw = record["tags_json"];
  if (typeof raw === "string" && raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Rec)) out[k] = v;
      }
    } catch {
      // A hand-edited cell that is not JSON carries no tags, and is not a broken page.
    }
  }
  return out;
}

/**
 * The tags a record genuinely CARRIES — every shape `recordTags` folds except the `tags_json`
 * COLUMN. This is the bag a repository tag is resolved from (`server/repoTags.resolveRepoTags`).
 *
 * WHY THE COLUMN IS REFUSED AT THE SOURCE rather than discriminated per row. See `recordTags`
 * above for what that column actually holds here; the question this comment answers is why the
 * obvious narrower guard was rejected. `projects_json` being non-empty looks like it identifies
 * exactly the rows whose `tags_json` is a project map, and it does at the moment reconcile
 * writes them — `projectsJson` and `projectsListJson` iterate the same `projectList` and both
 * return null on an empty result. It does NOT survive the round trip, in both directions:
 *
 *   * A row last written before `projects_json` existed as a column carries the project map
 *     with that column blank. `domain/projectGrain.ts`'s `owner_path` fallback exists for
 *     exactly that population, and it is the population a register knows least about.
 *   * `reconcile.ts:1032-1033` never erases either column independently, so a finding seen once
 *     WITH `projects[]` and later without it can end up with a stale `projects_json` beside a
 *     fresh `tags_json` — and the guard would then suppress a bag that is real.
 *
 * The column is not a tag source in this register at all. That is a fact about the QUERY
 * DOCUMENTS, not about any row, so it is answered where facts about documents belong.
 *
 * IF SCA EVER SELECTS `tags`, this function is still right and `reconcile.ts:461` is what needs
 * changing: it writes `projectsJson(rec)` first, so the column would keep holding the project
 * map no matter what the document grew. Do not "restore" the column read on the strength of a
 * query change alone.
 */
export function carriedTags(record: Rec | null | undefined): Rec {
  if (!record) return {};
  const out: Rec = {};

  // The asset's own bag, nested or flattened. Both asset spellings, because SCA's node calls
  // it `vulnerableAsset` and SAST's and secrets' call it `resource` (reconcile.ts's
  // `attributes` dispatch is the same asymmetry).
  for (const asset of ["vulnerableAsset", "resource"]) {
    const node = record[asset];
    if (node && typeof node === "object" && !Array.isArray(node)) {
      const nested = (node as Rec)["tags"];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        for (const [k, v] of Object.entries(nested as Rec)) out[k] = v;
      }
    }
    const flatBag = record[`${asset}.tags`];
    if (flatBag && typeof flatBag === "object" && !Array.isArray(flatBag)) {
      for (const [k, v] of Object.entries(flatBag as Rec)) out[k] = v;
    }
    const prefix = `${asset}.tags.`;
    for (const [k, v] of Object.entries(record)) {
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
    }
  }

  // The array form a graphSearch entity carries, and the flat `tag:<key>` properties beside it.
  addTagList(out, record["tags"]);
  for (const [k, v] of Object.entries(record)) {
    if (k.startsWith("tag:")) out[k.slice(4)] = v;
  }

  return out;
}

/** `[{key, value}]` (or a plain object) under a `tags` field, folded into `out` in place. */
function addTagList(out: Rec, tags: unknown): void {
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (!t || typeof t !== "object" || Array.isArray(t)) continue;
      const key = (t as Rec)["key"];
      if (!present(key)) continue;
      out[String(key)] = (t as Rec)["value"];
    }
    return;
  }
  if (tags && typeof tags === "object") {
    for (const [k, v] of Object.entries(tags as Rec)) out[k] = v;
  }
}

/**
 * The value of ONE tag key in a tag bag, or null when the bag carries none.
 *
 * THE GENERIC READER, and `domainOfTags` below is now a one-line projection of it rather than
 * its own copy. This register reads two repository tags off the same bags through the same
 * fetch — the business domain (this file) and the lifecycle (`lifecycleTag.ts`) — and the three
 * rules below are properties of a TAG, not of a domain. A second copy of them is how one of the
 * two later grows a case-sensitivity the other does not have.
 *
 * The KEY match is case-insensitive: a tenant's catalogue writes `Domain` or `domain` as its
 * own conventions had it, and the operator typing a Script Property need not have guessed which.
 * Either way the tag must not silently select nothing. (The same reason held when the default
 * was the namespaced `Wiz/Domain`, which most people writing about it spelled `Wiz/domain`.)
 *
 * The VALUE comes back as written, only trimmed. It is a label a person chose, and folding its
 * case would print something the Wiz console does not. (`lifecycleTag.isEndOfLife` folds a COPY
 * of it to compare; it never folds what gets displayed.)
 *
 * A tag present with a blank value is null, not a value named "": an empty string is not an
 * owner, and a switcher row with no name is not a scope.
 */
export function tagValue(tags: Rec | null | undefined, key: string): string | null {
  const want = String(key ?? "").trim().toLowerCase();
  if (!want || !tags) return null;
  for (const [k, v] of Object.entries(tags)) {
    if (String(k).trim().toLowerCase() !== want) continue;
    if (!present(v)) continue;
    const value = String(v).trim();
    if (value) return value;
  }
  return null;
}

/** The domain for one tag bag, or null when it carries none. See `tagValue` for the rules. */
export function domainOfTags(
  tags: Rec | null | undefined,
  key: string = DEFAULT_DOMAIN_TAG_KEY,
): string | null {
  return tagValue(tags, key);
}

/** The domain for one record, from whichever tag shape it carries. */
export function domainOf(record: Rec, key: string = DEFAULT_DOMAIN_TAG_KEY): string | null {
  return domainOfTags(recordTags(record), key);
}
