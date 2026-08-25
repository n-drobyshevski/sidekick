// Business-domain join: the value of a resource's `Wiz/Domain` tag, attached to each record
// as `_bizDomain`.
//
// The mirror of supportGroups.attachSupportGroups, and deliberately so — but with one step
// fewer, which is the whole reason this file is short. A Support Group lives on the
// SUBSCRIPTION, which findings do not carry, so that join needs a graphSearch over every
// tagged subscription and a persisted map. A business domain lives on the RESOURCE, and
// `vulnerableAsset.tags` is already in the vulnerability query and already persisted per
// finding as `tags_json` — so there is nothing to fetch here at all. Turning the tag on is a
// Script Property, not a sync.
//
// The tag key is resolved on READ, never baked (see domain/domainTag.ts): the raw tag bag is
// already in the ledger, so a `_bizDomain` column would be a second copy of a fact the sheet
// holds, and correcting a mistyped key would mean a full re-scan instead of an edit.

import { domainOfTags, resolveDomainTagKey } from "../domain/domainTag";
import { recordTags } from "../domain/domainRules";
import { type Rec } from "../domain/util";
import { getProp, PROP_KEYS } from "./props";

/**
 * The domain tag key in effect — the configured override, else the default. The single source
 * of truth for the join below and for the coverage figure the switcher's caption prints.
 */
export function configuredDomainTagKey(): string {
  return resolveDomainTagKey(getProp(PROP_KEYS.wizDomainTagKey));
}

/**
 * The business domain for one record, from whichever tag shape it carries.
 *
 * `recordTags` is the domain engine's own normaliser and handles all three: the nested
 * `vulnerableAsset.tags` object a raw node carries, the `vulnerableAsset.tags.<key>` columns a
 * flattened frame carries, and the `tags_json` string a ledger row carries. Reusing it is what
 * keeps a value chain's `tag:` condition and this scope reading the same tags.
 */
export function bizDomainOf(record: Rec, key: string): string | null {
  return domainOfTags(recordTags(record), key);
}

/**
 * Attach `_bizDomain` to each record (in place).
 *
 * A record with no such tag is left UNSET rather than given a placeholder — an untagged
 * resource contributes nothing to a facet, exactly as a blank cloud already does, and a
 * synthetic "Untagged" bucket would offer the resources we know least about as though they
 * were an owner. The count of them is what the caption carries instead.
 */
export function attachBizDomains(records: Rec[]): void {
  const key = configuredDomainTagKey();
  for (const r of records) {
    const domain = bizDomainOf(r, key);
    if (domain) r["_bizDomain"] = domain;
  }
}
