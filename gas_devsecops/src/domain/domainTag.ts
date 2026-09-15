// The business domain a repository belongs to, read off its `Wiz/Domain` tag.
//
// Ported from gas/src/domain/domainTag.ts, which carries the same idea for the OS-vulnerability
// register. The tenant tags each repository with the domain that owns it; that is the one
// attribution fact this register can carry without deriving anything — not a rule, not a
// score, not a verdict, just a string the tenant wrote on the resource.
//
// WHY THE TAG CANNOT COME OFF A FINDING HERE, which is the whole reason this register went
// without a domain axis until now and the reason `src/server/repoDomains.ts` exists at all.
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
// `_domain` is attached to records in memory by repoDomains.attachDomains and never written to
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

/** The tag key as Wiz spells it. Capital D — but see the fold in `domainOfTags`. */
export const DEFAULT_DOMAIN_TAG_KEY = "Wiz/Domain";

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
 *                             repoDomains.ts actually reads, since that is where this
 *                             register's tags come from at all
 *
 * gas/ splits these across `domainRules.recordTags` (the first three) and
 * `supportGroups.supportGroupValue` (the array and `tag:` forms), because there they arrive on
 * two different objects. Here they arrive on the same axis, so they are one function — two
 * normalisers is how a codebase ends up with two answers to "what tags does this carry".
 *
 * `tags_json` IN THIS REGISTER IS USUALLY NOT TAGS, and reading this function without knowing
 * that is how someone later concludes the join is redundant. reconcile.ts writes
 * `tags_json: projectsJson(rec) ?? tagsJson(rec)`, and every node carries `projects[]`, so in
 * practice the column holds the collapsed `{slug: name}` project map and the real tag bag is
 * never reached. It is read here anyway, first, because the column is what its NAME promises on
 * any row where a tag bag did land (the SCA fixture that keeps `tagsJson` live), and because a
 * register that later learns to fetch tags per finding should not need this function changed.
 *
 * The column is deliberately left as it is rather than "corrected": `projects_json` already
 * carries the uncollapsed list, `test/reconcile.test.ts` pins this output byte-for-byte, and
 * deployed sheets hold project maps in it today — so rewriting it would churn a persisted
 * schema to no gain, since the domain does not come from that column at all. The one cost is
 * real and worth stating: a `WIZ_DOMAIN_TAG_KEY` that collides with a PROJECT SLUG would read
 * a project name as a domain. Slugs carry no `/` and the default key does, so the default
 * cannot collide; an operator who overrides it to a bare word can.
 *
 * NEVER THROWS. Every input is either a spreadsheet cell or a tenant-dependent `properties`
 * blob; an unreadable one yields `{}` so the caller reports "no domain known" rather than
 * taking a page down.
 */
export function recordTags(record: Rec | null | undefined): Rec {
  if (!record) return {};
  const out: Rec = {};

  // `tags_json` — the ledger's own column, canonical JSON written by reconcile.ts.
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
 * The domain for one tag bag, or null when it carries none.
 *
 * The KEY match is case-insensitive: Wiz spells it `Wiz/Domain` while most people writing
 * about it say `Wiz/domain`, and an operator who types the latter into a Script Property must
 * not silently select nothing.
 *
 * The VALUE comes back as written, only trimmed. It is a label a person chose, and folding its
 * case would print something the Wiz console does not.
 *
 * A tag present with a blank value is null, not a domain named "": an empty string is not an
 * owner, and a switcher row with no name is not a scope.
 */
export function domainOfTags(
  tags: Rec | null | undefined,
  key: string = DEFAULT_DOMAIN_TAG_KEY,
): string | null {
  const want = key.trim().toLowerCase();
  if (!want || !tags) return null;
  for (const [k, v] of Object.entries(tags)) {
    if (String(k).trim().toLowerCase() !== want) continue;
    if (!present(v)) continue;
    const value = String(v).trim();
    if (value) return value;
  }
  return null;
}

/** The domain for one record, from whichever tag shape it carries. */
export function domainOf(record: Rec, key: string = DEFAULT_DOMAIN_TAG_KEY): string | null {
  return domainOfTags(recordTags(record), key);
}
