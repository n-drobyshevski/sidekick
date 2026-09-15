// The domain catalogue and membership predicate — the data foundation for the domain half of
// the app-header scope selector.
//
// The sibling of `src/domain/projectScope.ts`, and deliberately shaped like it: same catalogue
// /predicate/coverage trio, same "derived from the ROWS the register holds, never from a live
// catalogue" rule. Two differences, both forced by where a domain comes from:
//
//   * KEYED ON THE NAME, not on a slug. A project has a slug because Wiz gives it one; a
//     domain is a TAG VALUE — a string a person typed on a resource — and there is no second
//     identity to key on. Two repositories tagged `SAP` are one domain because the string
//     matches, which is the whole of the model.
//
//   * READ OFF `_domain`, ATTACHED IN MEMORY, not off a persisted column. `projects_json` is a
//     ledger column; `_domain` is put on a record by `src/server/repoDomains.ts` at read time
//     from the join map, and is never written to the sheet. See domainTag.ts's header for why
//     it is resolved rather than baked. Everything below therefore takes rows that have
//     ALREADY been through `attachDomains` — a caller that forgets sees an empty catalogue and
//     a `noDomainCount` equal to the register, which reads as "we never learned" rather than
//     as a wrong answer.
//
// PURE. No Apps Script globals, no import from src/server/.

/** The field `repoDomains.attachDomains` writes. Spelled once, here. */
export const DOMAIN_FIELD = "_domain";

/** The shape this module needs of a row. Any ledger/base row satisfies it structurally. */
export interface DomainCarrier {
  _domain?: string | null;
}

/** One row of the domain switcher's list: a domain, and how much of the register it holds. */
export interface DomainCatalogueEntry {
  name: string;
  /** Rows in the CURRENT register carrying this domain. Not a Wiz-side total. */
  findings: number;
}

/** The domain on a row, or `""` when it carries none. */
export function domainOfRow(row: DomainCarrier | null | undefined): string {
  const v = row ? row._domain : null;
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The distinct domains the register's rows belong to, by name.
 *
 * Derived from the rows rather than from the join map, and the difference is the point: the
 * map knows every tagged repository in the tenant, including ones this register has never
 * fetched a finding for. A domain nothing in the CURRENT register carries is simply absent
 * from the picker, rather than present and answering zero — the same property
 * `projectScope.projectCatalogue` keeps, for the same reason. A zero meaning "nothing here"
 * and a zero meaning "never synced" look identical on screen and call for opposite reactions.
 */
export function domainCatalogue(rows: readonly DomainCarrier[]): DomainCatalogueEntry[] {
  const byName = new Map<string, DomainCatalogueEntry>();
  for (const row of rows) {
    const name = domainOfRow(row);
    if (!name) continue;
    const seen = byName.get(name);
    if (seen) seen.findings += 1;
    else byName.set(name, { name, findings: 1 });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Is this row inside that domain.
 *
 * THIS IS THE SINGLE DEFINITION of domain membership, for the reason `projectScope.inProject`
 * spells out at length: two copies of the question is how a codebase ends up with two answers
 * to it. An empty `name` matches nothing — there is no "everything" domain, so a caller that
 * forgot to resolve a selection into a real one fails closed rather than matching every row.
 *
 * The comparison is EXACT, not folded. `domainOfTags` already returns the tag value verbatim,
 * and two tenants' `SAP` and `sap` are two labels a person typed; collapsing them here would
 * merge buckets the Wiz console shows apart, and the switcher's own list is built from these
 * same strings, so a row can only ever be asked about a name the catalogue already produced.
 */
export function inDomain(row: DomainCarrier | null | undefined, name: string): boolean {
  if (!name) return false;
  return domainOfRow(row) === name;
}

/**
 * Rows carrying NO domain at all.
 *
 * These rows are invisible to every entry `domainCatalogue` produces and to every `inDomain`
 * check. The switcher must report this figure OUT LOUD rather than let those rows silently
 * vanish from every scoped view — without it, "1,204 of 8,331" quietly attributes the other
 * 7,127 to some other domain, when the truth for most of them is that nobody tagged the
 * repository. Same argument, same discharge, as `projectScope.unattributedCount`.
 *
 * It counts TWO populations that a reader cannot tell apart from here and does not need to:
 * a repository the tenant has not tagged, and a repository the join map has never seen
 * because the map was never refreshed. `repoDomains.mapHealth` is what separates those, and
 * the Settings readout is where it is said.
 */
export function noDomainCount(rows: readonly DomainCarrier[]): number {
  let count = 0;
  for (const row of rows) {
    if (!domainOfRow(row)) count += 1;
  }
  return count;
}
