// The repositories-carrying-a-tag query. One tag key in, every REPOSITORY entity carrying it
// out, with its whole `properties` blob — so the caller reads whatever tags that blob holds,
// not merely the one it filtered on (src/server/repoTags.ts runs it once per key and merges).
//
// Hand-written, and transcribed in shape from gas/src/server/wizSubscriptionsQuery.ts — the
// same mechanism for the same reason: findings carry their asset but not its tags, so the tags
// are fetched once, separately, and joined. See src/domain/domainTag.ts's header for why the
// finding documents cannot simply select `tags` here the way gas/'s does.
//
// THE TAG KEY IS INLINED INTO THE `where` LITERAL, not passed as a `$variable`, and that is
// inherited evidence rather than a preference: gas_ai found a `$variable` inside a graphSearch
// `where` literal fragile against this gateway, and gas/ has shipped the inlined form since.
// Paging rides the standard `$first`/`$after` variables, which the gateway is happy with.
// The key is validated before interpolation so a misconfigured Script Property can never
// inject GraphQL.
//
// TWO ENTITY TYPES, NOT ONE. This register's findings name a repository BRANCH on SCA
// (`VulnerableAssetRepositoryBranch`) and a repository on SAST/secrets (`resource`), and the
// tenant may carry the tag on either. Asking for both and indexing whatever comes back under
// every identity token it has (repoTags.ts) is what keeps the join from depending on which
// of the two the tenant actually tags — a dependency nothing here could verify without the
// live tenant, and exactly the class of guess PROBE_FINDINGS.md §4 is a record of.
//
// ONE KEY PER CALL, AND THE CALLER PAGES IT TWICE. Whether `tags: { CONTAINS: [{key: a},
// {key: b}] }` means "carries both" or "carries either" is not something this tree can
// establish without the live tenant, and the two readings differ by an entire estate. So the
// document keeps the single-key shape that has been in production since this file shipped,
// and the caller runs it once per key — pages, never correctness, is what that costs.

export const PAGE_SIZE = 100;
export const PAGE_SIZE_FALLBACK = 50;
/** A few thousand repositories at 100/page is more than this tenant has. */
export const MAX_PAGES = 50;

/** A tag key safe to inline into the GraphQL document (no quotes/backslashes/control). */
export function isSafeTagKey(key: string): boolean {
  return /^[\w/.:-]{1,120}$/.test(key);
}

/**
 * Build the repositories-by-tag query for one tag key.
 *
 * THROWS on an unsafe key, rather than escaping it or falling back to the default. A tag key
 * is operator input that reaches a query document; the two safe answers are "this is a tag
 * key" and "refuse", and silently substituting a different key would answer a question nobody
 * asked and attribute the whole register to the wrong vocabulary.
 */
export function reposByTagQuery(tagKey: string): string {
  if (!isSafeTagKey(tagKey)) {
    throw new Error(
      `Unsafe repository tag key ${JSON.stringify(tagKey)} — allowed: ` +
        "letters, digits, _ . : / - (max 120 chars).",
    );
  }
  return (
    "query GetRepositoriesByTag($first: Int, $after: String) {\n" +
    "  graphSearch(\n" +
    "    query: {\n" +
    "      type: [REPOSITORY, REPOSITORY_BRANCH]\n" +
    "      select: true\n" +
    '      where: { tags: { CONTAINS: [{ key: "' + tagKey + '" }] } }\n' +
    "    }\n" +
    "    first: $first\n" +
    "    after: $after\n" +
    "  ) {\n" +
    "    pageInfo { hasNextPage endCursor }\n" +
    "    nodes { entities { id name properties } }\n" +
    "  }\n" +
    "}\n"
  );
}
