// The business domain a resource belongs to, read off its `Wiz/Domain` tag.
//
// Wiz tags resources with the domain that owns them — "CROSS", "SAP", "EXAMPLE DOMAIN" in
// the committed captures. That is the one attribution fact this app can carry without
// deriving anything: not a score, not a tier, not a verdict, just a string the tenant wrote
// on the resource. Which is why it may appear on pages the three derived models may not.
//
// RESOLVED ON READ, NEVER BAKED. The key is configurable, and a key baked into `ai_assets`
// would mean re-syncing a whole landscape to correct a typo. The sibling gas/ tool made the
// same call for the same reason (`_domain` is attached live in findings.ts and never
// written to the ledger). The raw material is already persisted — `tags_json` — so a column
// here would be a second copy of a fact the sheet already holds, and the stale one would
// win for anything reading the tab directly.
//
// ABSENCE IS REPORTED AS A COUNT, NOT AS A SENTINEL VALUE. An untagged resource has a blank
// domain and contributes nothing to a facet, exactly as a blank cloud or region already
// does. The honest-absence duty is discharged by `domainCoverage` instead, and discharged
// better: `AI_ASSET_PROPERTIES` is an optional step that swallows an HTTP 400 and is the
// only route by which an AI asset's properties bag arrives, so a tenant that rejects it has
// no domain data at all — which must read as "we never learned" and not as "nobody owns any
// of this". A per-row sentinel could not tell those apart either; a coverage figure beside
// the step's own skip record can.

/** The tag key in the captured tenant. Capital D — but see the fold in `domainOfTags`. */
export const DEFAULT_DOMAIN_TAG_KEY = "Wiz/Domain";

/**
 * The domain for one resource's tags, or null when it carries none.
 *
 * The KEY match is case-insensitive: the captures say `Wiz/Domain` while every human
 * writing about it says `Wiz/domain`, and an operator who types the latter into a Script
 * Property must not silently select nothing. The fold is `trim().toLowerCase()`, the same
 * one `gas/`'s `foldToken` uses, so the two tools agree on what case-insensitive means.
 *
 * The VALUE comes back as written, only trimmed. It is a label a person chose, and folding
 * its case would print something the Wiz console does not.
 *
 * A tag present with a blank value is null, not a domain named "": an empty string is not
 * an owner.
 */
export function domainOfTags(
  tags: ReadonlyArray<{ key: string; value: string }> | null | undefined,
  key: string = DEFAULT_DOMAIN_TAG_KEY,
): string | null {
  const want = key.trim().toLowerCase();
  if (!want || !tags) return null;
  for (const t of tags) {
    if (!t || String(t.key).trim().toLowerCase() !== want) continue;
    const value = String(t.value ?? "").trim();
    if (value) return value;
  }
  return null;
}

/** The configured key, else the default — one source of truth for fold and read alike. */
export function resolveDomainTagKey(configured: string | null | undefined): string {
  const k = (configured ?? "").trim();
  return k || DEFAULT_DOMAIN_TAG_KEY;
}

/**
 * How much of the landscape the domain tag actually covers.
 *
 * This is the page's defence against reading an empty Domain facet as a fact about the
 * tenant. Reported as an aggregate over the whole set, so it stays a count of something Wiz
 * said and never becomes a per-asset claim.
 */
export function domainCoverage(
  nodes: ReadonlyArray<{ domain?: string | null }>,
  key: string,
): { key: string; tagged: number; total: number } {
  let tagged = 0;
  for (const n of nodes) if (n.domain) tagged += 1;
  return { key, tagged, total: nodes.length };
}
