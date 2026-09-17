// Where a repository is in its life, read off its `lifecycle` tag — and which of those words
// mean the repository is finished.
//
// `domainTag.ts`'S TWIN, AND DELIBERATELY NOT AN EXTENSION OF IT. The two tags travel the same
// road: a finding carries its repository but not that repository's tags (domainTag.ts's header
// records exactly which three query documents cannot ask for them and how that was
// established), so both are fetched by a graphSearch over repository entities and joined onto
// findings by identity, and both are resolved ON READ rather than baked into a ledger column.
// What they do NOT share is a vocabulary: a domain is an opaque label this register never
// interprets, and a lifecycle has one value — `END_OF_LIFE` — that the cold zone is allowed to
// ACT on. A module that reads a tag and a module that judges its value are two different
// things, and keeping the judgement here is what stops `domainTag.ts` growing an opinion about
// what a domain means. The tag-bag normaliser (`recordTags`) and the key reader (`tagValue`)
// stay there, imported; there is one of each in this package.
//
// WHY A REPOSITORY'S LIFECYCLE IS WORTH A COLUMN AT ALL. This register's whole argument is
// about ENGAGEMENT — how fast a finding dies, and where nothing is closing. A repository the
// tenant has retired answers both questions with a silence that means the opposite of what the
// cold zone reads into it: nobody is remediating because nobody is meant to, and the code is
// not running. Printing that fact beside the backlog is what lets a reader tell an abandoned
// repository from a finished one WITHOUT the app deciding for them; `coldZone.ts`'s opt-in
// exclusion is what lets them act on it once they have.
//
// ABSENCE IS NEVER "ALIVE". An untagged repository has no lifecycle, prints the register's
// absence mark, and is NEVER excluded from anything. Only a positive `END_OF_LIFE` reading
// excludes — the same direction of refusal `program.ts` takes on an unassessed exploit signal,
// and for the same reason: the two mistakes are not symmetric. Under-excluding leaves a
// retired repository in a table where a reader can see and dismiss it; over-excluding deletes
// a live repository from the one page that would have told them it had gone quiet.
//
// PURE. No Apps Script globals, no import from src/server/.

import { recordTags, tagValue } from "./domainTag";
import type { Rec } from "./util";

/**
 * The tag key this register reads a lifecycle off, when nothing overrides it.
 *
 * A BARE WORD, AND SO IS THE DOMAIN'S — the two are twins here, where gas/ reads a namespaced
 * `Wiz/Domain`, and the difference is a statement about where each tag comes from rather than a
 * style choice. Both of this register's tags describe a REPOSITORY: properties the tenant
 * carries on the repository itself (a GitHub custom property, a platform catalogue) which reach
 * Wiz under whatever key that system already used, rather than keys Wiz's own console writes
 * and namespaces onto a cloud resource.
 *
 * WHICH MEANS THE DEFAULT IS A GUESS, AND IT IS BUILT TO BE A CHEAP ONE. `WIZ_LIFECYCLE_TAG_KEY`
 * overrides it (server/props.ts), the key match is case-insensitive (`tagValue`), and
 * `repoTags.mapHealth` publishes how many repositories each key actually PLACED — so a
 * default that matches nothing shows up on the Settings page as a zero an operator can act on,
 * rather than as a column that is quietly empty everywhere. That readout is the reason this
 * default is allowed to be a guess at all.
 */
export const DEFAULT_LIFECYCLE_TAG_KEY = "lifecycle";

/** The configured key, else the default — `resolveDomainTagKey`'s twin, one per tag. */
export function resolveLifecycleTagKey(configured: string | null | undefined): string {
  const k = (configured ?? "").trim();
  return k || DEFAULT_LIFECYCLE_TAG_KEY;
}

/** The field `repoTags.attachRepoTags` writes. Spelled once, here. */
export const LIFECYCLE_FIELD = "_lifecycle";

/** The lifecycle for one tag bag, or null when it carries none. */
export function lifecycleOfTags(
  tags: Rec | null | undefined,
  key: string = DEFAULT_LIFECYCLE_TAG_KEY,
): string | null {
  return tagValue(tags, key);
}

/** The lifecycle for one record, from whichever tag shape it carries. `domainOf`'s twin. */
export function lifecycleOf(record: Rec, key: string = DEFAULT_LIFECYCLE_TAG_KEY): string | null {
  return lifecycleOfTags(recordTags(record), key);
}

/**
 * The lifecycle values that mean the repository is finished.
 *
 * ONE LIST, EXPORTED, for `SUPPORT_GROUP_PREFIXES`' reason: a tenant that spells it
 * `DECOMMISSIONED` as well should cost one edit here, not a hunt through the cold zone.
 */
export const END_OF_LIFE_VALUES: readonly string[] = ["END_OF_LIFE"];

/**
 * Fold a lifecycle value to the form the comparison below is made in: lower case, with every
 * separator removed.
 *
 * SO `END_OF_LIFE`, `end-of-life`, `End Of Life` AND `EndOfLife` ARE ONE VALUE, which is the
 * one thing this module infers and it is worth being explicit about why that is not the
 * inference `config.ts`'s `ORG_WIDE_PROJECTS` refuses. There, the rejected rule was a PREFIX
 * rule over names nobody had agreed on — `GITHUB-…` would have guessed that a business unit
 * named after a tool was a connector tag, a claim about what an unseen name MEANS. Here the
 * word is fixed and the folding only absorbs how it was PUNCTUATED. No new value is admitted:
 * `end-of-life-pending` folds to `endoflifepending` and matches nothing.
 *
 * REFUSED BEFORE ANY CAST, the trap `settingsLogic.cleanViewScope` documents: `String(null)` is
 * `"null"` and `String({})` is `"[object Object]"`, none of which is in the list today — but
 * "happens to be safe" is not the same property as "cannot be wrong", and a tenant is free to
 * name a lifecycle anything.
 */
function foldLifecycle(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const END_OF_LIFE_KEYS: ReadonlySet<string> = new Set(END_OF_LIFE_VALUES.map(foldLifecycle));

/**
 * Is this lifecycle value one that means the repository is finished?
 *
 * FALSE FOR EVERYTHING IT DOES NOT RECOGNISE, including null, blank and a value in a vocabulary
 * this register has never seen. See the module header: the two mistakes are not symmetric, and
 * this is the direction that leaves a reader able to notice.
 */
export function isEndOfLife(value: unknown): boolean {
  const folded = foldLifecycle(value);
  return folded !== "" && END_OF_LIFE_KEYS.has(folded);
}
