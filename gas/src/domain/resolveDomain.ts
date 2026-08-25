// Which domain a finding belongs to — one answer, from two mechanisms, in a fixed order.
//
// THE TAG LEADS. `Wiz/Domain` is a label the tenant wrote on the resource in Wiz, and it is
// the principal attribution: wherever it is present it wins outright. The manual-group rules
// an operator writes in Settings are the FALLBACK — they claim what the tenant has not tagged
// yet, and shrink as tagging improves. That is the whole of the model, and the order is the
// point: an operator should not have to hand-write one rule per domain value and keep it in
// sync with a vocabulary Wiz already publishes.
//
// It could not always have been this way, and the reason is worth recording: until the ledger
// carried `tags_json` through compaction, every resolved lifecycle past the retention floor
// lost its tag. Resolved lifecycles are exactly the MTTR denominator, so a tag-first model
// would have thinned out silently as the floor advanced. See the comment on `EpisodeRow`.
//
// THREE TERMINAL STATES, and the third is what stops the second from lying:
//
//   tag present            → that value, verbatim              source "tag"
//   no tag, has inputs     → the rule verdict, or UNASSIGNED    source "rule" / "none"
//   no attribution inputs  → NOT_ATTRIBUTABLE                   source "missing"
//
// The third state is the population `hasDomainInputs` identifies: compacted episodes and
// pre-v5 / imported resolved history, which carry no name, no subscription and no tags, so
// there is nothing for any mechanism to read. They used to be DROPPED from the MTTR split
// behind a footnote, precisely because counting them as UNASSIGNED "would swamp the breakdown
// with a giant fake Unassigned domain that has no counterpart on the live Attribution page".
// Naming them instead solves that better than dropping did: UNASSIGNED goes back to meaning
// only the actionable "had a chance and matched nothing" population, the unattributable rows
// stay visible in every figure they affect, and nothing is quietly missing from a total.
//
// READ IT AS "NO INPUT SURVIVED", NOT "NO INPUT EVER EXISTED" — this bucket is smaller than it
// looks and shrinks without an operator doing anything. The vulnerability query fetches
// `status: [OPEN, RESOLVED]`, so Wiz keeps re-listing these sealed lifecycles with their
// resource's full tag bag; `reconcileEpisodeCollisions` takes the bag off the re-listed row
// before dropping it, and the history backfill recovers the rest from the scan archives. What
// stays here is what nothing we can still read holds an input for.
//
// RESOLVED ON READ, never baked. `WIZ_DOMAIN_TAG_KEY` is a Script Property and the rules are a
// settings blob; both must stay correctable without a re-scan.

import { assignDomain, hasDomainInputs, recordTags, UNASSIGNED, type CompiledDomain } from "./domainRules";
import { DEFAULT_DOMAIN_TAG_KEY, domainOfTags } from "./domainTag";
import { type Rec } from "./util";

/**
 * The bucket for a row that carries no attribution input at all.
 *
 * Not a domain, and deliberately not spelled like one — a reader who sees it in a breakdown
 * should read "this app cannot answer for these", not "an owner called Not attributable".
 */
export const NOT_ATTRIBUTABLE = "Not attributable";

/** Where a resolved domain came from. Carried beside it so Attribution can audit both. */
export type DomainSource = "tag" | "rule" | "none" | "missing";

export interface ResolvedDomain {
  name: string;
  source: DomainSource;
}

/**
 * The domain for one record, tag first.
 *
 * `_bizDomain` is read off the record when the caller has already attached it
 * (`bizDomains.attachBizDomains`), which every server path does — re-parsing `tags_json` per
 * row would be the same answer at a cost. `tagKey` is the fallback for a caller that has not.
 */
export function resolveDomain(
  record: Rec,
  compiled: CompiledDomain[],
  tagKey: string = DEFAULT_DOMAIN_TAG_KEY,
): ResolvedDomain {
  const attached = record["_bizDomain"];
  const tag = typeof attached === "string" && attached
    ? attached
    : domainOfTags(recordTags(record), tagKey);
  if (tag) return { name: tag, source: "tag" };
  // Checked AFTER the tag, because a tag IS one of the inputs `hasDomainInputs` counts — a
  // row that got here has none of them, tag included.
  if (!hasDomainInputs(record)) return { name: NOT_ATTRIBUTABLE, source: "missing" };
  const ruled = assignDomain(record, compiled);
  return { name: ruled, source: ruled === UNASSIGNED ? "none" : "rule" };
}

/** Just the name — the shape every existing `_domain` call site wants. */
export function resolveDomainName(
  record: Rec,
  compiled: CompiledDomain[],
  tagKey?: string,
): string {
  return resolveDomain(record, compiled, tagKey).name;
}

/**
 * The ordered universe of domain names, for a table that must show every bucket including the
 * empty ones (a manual group matching nothing is a dead rule worth seeing).
 *
 * Order: tag values first — they are the principal mechanism and the tenant's own vocabulary —
 * then the manual groups in the priority order their rules are evaluated in, then the two
 * tails. Both tails go last and exactly once, extending the rule
 * `attribution.orderedWithUnassignedLast` already applied to one of them: `UNASSIGNED` is a
 * result you can act on, `NOT_ATTRIBUTABLE` is not, so it sits below even that.
 *
 * Tag values are sorted rather than left in encounter order, because their order carries no
 * meaning — unlike the rules, where position IS priority.
 */
export function resolvedDomainNames(tagValues: Iterable<string>, ruleNames: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>([UNASSIGNED, NOT_ATTRIBUTABLE]);
  for (const v of [...new Set(tagValues)].sort()) {
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  for (const n of ruleNames) {
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  out.push(UNASSIGNED, NOT_ATTRIBUTABLE);
  return out;
}

/** Sort comparator keeping the two tails last, for callers ranking by size rather than order. */
export function domainRank(name: string): number {
  if (name === NOT_ATTRIBUTABLE) return 2;
  if (name === UNASSIGNED) return 1;
  return 0;
}
