// The subscription → Support Group query. A Support Group is the value of the
// `Wiz/provisioning` tag on a SUBSCRIPTION entity (e.g. "CS-SUPPLY-MONITORING"),
// so we graphSearch every subscription carrying that tag and read its value.
//
// Hand-written (unlike the generated wizQuery.ts). Transcribed from the operator's
// verified console query GetSubscriptionsByWizProvisioningTag: the tag key is inlined
// into the `where` literal exactly as the working capture sends it (gas_ai found a
// `$variable` inside a graphSearch `where` literal fragile against the gateway), while
// paging rides the standard `$first`/`$after` variables. The tag key is validated
// before interpolation so it can never inject GraphQL.

export const PAGE_SIZE = 100;
export const PAGE_SIZE_FALLBACK = 50;
export const MAX_PAGES = 50; // a few hundred subscriptions at 100/page is plenty

/** A tag key safe to inline into the GraphQL document (no quotes/backslashes/control). */
export function isSafeTagKey(key: string): boolean {
  return /^[\w/.:-]{1,120}$/.test(key);
}

/**
 * Build the subscriptions-by-tag query for one tag key. Throws on an unsafe key so a
 * misconfigured Script Property fails loudly instead of producing a malformed document.
 */
export function subscriptionsByTagQuery(tagKey: string): string {
  if (!isSafeTagKey(tagKey)) {
    throw new Error(
      `Unsafe WIZ_SUPPORT_GROUP_TAG_KEY ${JSON.stringify(tagKey)} — allowed: ` +
        "letters, digits, _ . : / - (max 120 chars).",
    );
  }
  return (
    "query GetSubscriptionsByWizProvisioningTag($first: Int, $after: String) {\n" +
    "  graphSearch(\n" +
    "    query: {\n" +
    "      type: [SUBSCRIPTION]\n" +
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
