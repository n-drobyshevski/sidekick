// The repository → domain query. A domain is the value of the `Wiz/Domain` tag on a
// REPOSITORY entity, so we graphSearch every repository carrying that tag and read its value.
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
// every identity token it has (repoDomains.ts) is what keeps the join from depending on which
// of the two the tenant actually tags — a dependency nothing here could verify without the
// live tenant, and exactly the class of guess PROBE_FINDINGS.md §4 is a record of.

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
      `Unsafe WIZ_DOMAIN_TAG_KEY ${JSON.stringify(tagKey)} — allowed: ` +
        "letters, digits, _ . : / - (max 120 chars).",
    );
  }
  return (
    "query GetRepositoriesByWizDomainTag($first: Int, $after: String) {\n" +
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
