// The business domain a resource belongs to, read off its `Wiz/Domain` tag.
//
// Ported from gas_ai/src/domain/domainTag.ts, which carries the same idea for the AI
// landscape. Wiz tags resources with the domain that owns them — "CROSS", "SAP", "EXAMPLE
// DOMAIN" in the captures. That is the one attribution fact this app can carry without
// deriving anything: not a rule, not a score, not a verdict, just a string the tenant wrote
// on the resource.
//
// IT IS NOT A VALUE CHAIN, and the two must never be conflated in the UI. A value chain
// (`domainRules.ts`, `_domain`) is a bucket THIS APP computes from rules an operator wrote in
// Settings; a business domain is a label the TENANT wrote in Wiz. They can disagree, and when
// they do the disagreement is information — which is why the header switcher lists them as two
// groups rather than merging them into one dimension. The field is `_bizDomain` for the same
// reason: `_domain` was taken, and by the other thing.
//
// RESOLVED ON READ, NEVER BAKED. The key is configurable, and a key baked into the ledger
// would mean a full re-scan to correct a typo. The raw material is already persisted —
// `tags_json` on every ledger row, and `vulnerableAsset.tags` on every frame record — so a
// column here would be a second copy of a fact the sheet already holds, and the stale one
// would win for anything reading the tab directly. `_supportGroup` is attached the same way
// and for the same reason.
//
// ABSENCE IS REPORTED AS A COUNT, NOT AS A SENTINEL VALUE. An untagged resource has a blank
// domain and contributes nothing to a facet, exactly as a blank cloud or subscription already
// does — there is deliberately no "Untagged" row in the switcher, because offering "the assets
// we know least about" as though it were an owner is the lie the coverage figure exists to
// prevent. `domainCoverage` discharges that duty instead, and discharges it better: a tenant
// that tags nothing has no domain data at all, which must read as "we never learned" rather
// than as "nobody owns any of this", and a per-row sentinel could not tell those apart.

import { present, type Rec } from "./util";

/** The tag key as the captures spell it. Capital D — but see the fold in `domainOfTags`. */
export const DEFAULT_DOMAIN_TAG_KEY = "Wiz/Domain";

/**
 * The domain for one resource's tag bag, or null when it carries none.
 *
 * gas/ holds tags as an object map (`{env: "prod", "Wiz/Domain": "SAP"}`) rather than the
 * `[{key, value}]` array the AI tool's graph query returns — `domainRules.recordTags()` is
 * what normalises the three shapes this register stores them in — so this takes the map.
 *
 * The KEY match is case-insensitive: the captures say `Wiz/Domain` while every human writing
 * about it says `Wiz/domain`, and an operator who types the latter into a Script Property must
 * not silently select nothing.
 *
 * The VALUE comes back as written, only trimmed. It is a label a person chose, and folding its
 * case would print something the Wiz console does not.
 *
 * A tag present with a blank value is null, not a domain named "": an empty string is not an
 * owner, and a switcher row with no name is not a scope.
 */
export function domainOfTags(tags: Rec | null | undefined, key: string = DEFAULT_DOMAIN_TAG_KEY): string | null {
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

/** The configured key, else the default — one source of truth for fold and read alike. */
export function resolveDomainTagKey(configured: string | null | undefined): string {
  const k = (configured ?? "").trim();
  return k || DEFAULT_DOMAIN_TAG_KEY;
}

/**
 * How much of the register the domain tag actually covers.
 *
 * This is the switcher's defence against reading a thin Domains group as a fact about the
 * tenant. Reported as an aggregate over the whole set, so it stays a count of something Wiz
 * said and never becomes a per-row claim.
 */
export function domainCoverage(
  records: ReadonlyArray<Rec>,
  key: string,
  domainOf: (record: Rec) => string | null,
): { key: string; tagged: number; total: number } {
  let tagged = 0;
  for (const r of records) if (domainOf(r)) tagged += 1;
  return { key, tagged, total: records.length };
}
