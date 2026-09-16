// The tenant's project VOCABULARY: which of a finding's projects is a support group, which is
// a product, and how to read one off a row that predates the column carrying them.
//
// THIS FILE IS THE CONVENTION; `projectScope.ts` IS THE MEASUREMENT. Wiz reports a flat
// `projects[]` with an `isFolder` flag and no parent links (reconcile.ts's ownerProject
// comment: a live probe sample carries "VALUE-CHAIN folder, product-TATTOO-idp leaf,
// CE-TRANSPORT folder, GITHUB-DKTUNITED leaf" on one node, in that order, with no ancestry).
// It does NOT report that `CE-TRANSPORT` is a support group, that `product-TATTOO-idp` is a
// product, or that the second sits inside the first. Those are things the tenant NAMES rather
// than things Wiz MEASURES, and a name rule is the only way to learn them — the same licence
// `config.ts`'s severity vocabulary and this register's CS/CE/LU rule have always had. The
// split into its own file is so that seam is visible: everything here is a convention that
// changes when the tenant changes it, and nothing here is a fact about the API.
//
// ONE SUPPORT GROUP HOLDS MANY PRODUCTS, and that containment is why the two are separate
// dimensions rather than one "owner" column. Collapsing them — which is what `owner_project`
// did until this module existed — produces a column whose grain depends on the order Wiz
// happened to return the array in: usually the product, but a support group for any row where
// one was reported as a leaf and sorted earlier. One column cannot rank two grains against
// each other and mean anything.
//
// IMPORTS NOTHING, on purpose. `projectScope.ts` imports these predicates to build the
// catalogue's parent edge and to attach the two fields; if this file reached back for
// `parseProjects` the two would be a cycle. So the resolvers below take ALREADY-PARSED
// projects plus the two fallback strings as explicit parameters — the arrangement
// `repoDomains.resolveDomain(record, map, tagKey)` already uses for the same reason.
//
// PURE. No Apps Script globals, no import from src/server/.

/**
 * The first segment of a project name — the unit BOTH vocabularies below are read off.
 *
 * THE FIRST SEGMENT, NOT A BARE PREFIX, and the distinction is the whole rule: `CE-TRANSPORT`
 * is a support group; `CENTRAL-OPS` must not be, and `owner-CE-INDUS-cloud` — carrying `CE` in
 * the middle of a compound name — must not be either. Splitting on the separator answers all
 * three, where `startsWith("CE")` gets the second wrong and `includes("CE")` gets the third
 * wrong. The same splitter serves the product rule, so `owner-product-x` is no more a product
 * than `CENTRAL-OPS` is a support group.
 */
function firstSegment(name: unknown): string {
  return String(name ?? "").trim().split(/[-_\s]/)[0] ?? "";
}

/**
 * The tenant's support-group prefixes.
 *
 * One list, exported, because a convention is a thing that changes: a fourth prefix is one
 * edit here rather than a hunt through every caller. `src/client/js/ui/projectScope.js` keeps
 * a mirror of this list — the client cannot import TypeScript — and
 * `test/projectScopeView.test.js` holds the two equal, which is this repo's pattern for a rule
 * both sides of the seam need.
 */
export const SUPPORT_GROUP_PREFIXES: readonly string[] = ["CS", "CE", "LU"];

/** The first segment that marks a product. Lower-cased before comparison; see `isProduct`. */
export const PRODUCT_SEGMENT = "product";

/** Is this project name one of the tenant's support groups. */
export function isSupportGroup(name: unknown): boolean {
  const first = firstSegment(name).toUpperCase();
  return first !== "" && SUPPORT_GROUP_PREFIXES.indexOf(first) >= 0;
}

/**
 * Is this project name one of the tenant's products.
 *
 * A PREFIX RULE, where `config.ts`'s `ORG_WIDE_PROJECTS` deliberately refused one — and the
 * two positions are consistent rather than in tension. There, an exact list was cheap (one
 * connector tag) and a prefix would have been a GUESS about what `GITHUB-…` means, capable of
 * silently hiding a business unit named after a tool. Here the prefix IS the convention: the
 * tenant marks a product by naming it `product-…`, there is no list to keep, and a rule read
 * off the first segment is the only thing that could learn it at all.
 */
export function isProduct(name: unknown): boolean {
  return firstSegment(name).toLowerCase() === PRODUCT_SEGMENT;
}

/** What a project IS, in the tenant's own words where they have any. */
export type ProjectKind = "support" | "product" | "unit" | "project" | "unknown";

/**
 * Classify one project: support group, product, business unit, plain leaf, or not yet known.
 *
 * THE NAME RULES WIN OVER `isFolder`, both of them. A folder named `CS-LOG-ZEN-ECOM` is a
 * folder AND a support group; a `product-…` project whose `isFolder` Wiz omitted is a product
 * and not an "unknown". Calling either one something else because of what Wiz says about
 * nesting would be the app overruling the tenant on the tenant's own vocabulary.
 *
 * SUPPORT BEFORE PRODUCT is arbitrary only in the sense that nothing should match both — a
 * name cannot have two first segments. It is ordered rather than asserted because a tenant
 * that one day names a support group `product-…` should get a stable answer, not a crash.
 *
 * `isFolder` is TRI-STATE (`projectScope.ts`): `undefined` means the row predates the
 * `projects_json` column or the API omitted the flag, and is NEVER read as `false`. That third
 * state is what `"unknown"` is for, and it only ever applies to a project neither name rule
 * claimed.
 */
export function projectKind(p: { name?: unknown; isFolder?: boolean }): ProjectKind {
  if (isSupportGroup(p.name)) return "support";
  if (isProduct(p.name)) return "product";
  if (p.isFolder === true) return "unit";
  if (p.isFolder === false) return "project";
  return "unknown";
}

/** The fields `projectScope.attachProjectGrain` writes. Spelled once, here. */
export const SUPPORT_GROUP_FIELD = "_supportGroup";
export const PRODUCT_FIELD = "_product";

/** The shape the resolvers need of a project. Any `ProjectRef` satisfies it structurally. */
export interface GrainProject {
  name: string;
  isFolder?: boolean;
}

/** Lowest name wins — see `supportGroupOf`. */
function lowestName(names: readonly string[]): string | null {
  if (!names.length) return null;
  return [...names].sort((a, b) => a.localeCompare(b))[0]!;
}

/**
 * The support group a row belongs to, or `null`.
 *
 * TWO SOURCES, IN ORDER. The projects the row carries are the real answer. `owner_path` — the
 * folder names this register has always stored, sorted and joined `" / "` — is the fallback,
 * and it reaches exactly one population: LIVE ROWS LAST WRITTEN BEFORE THE `projects_json`
 * COLUMN EXISTED. Both fields come off the same `projectList(record)` in the same reconcile
 * pass, so no row written since gets one without the other; the fallback is transitional by
 * construction and heals on the next sync that sees the repository. It is worth having anyway,
 * because those stale rows are precisely the population the cold zone measures.
 *
 * IT CANNOT HELP A SEALED EPISODE. Compaction keeps `owner_project` and writes `owner_path`
 * and `projects_json` null (`ledgerCore.ts`'s rowFromEpisode), so a sealed episode answers no
 * support group at all. That is a real absence and is reported as one, never as a placeholder.
 *
 * LOWEST NAME WINS when a row carries two support groups, rather than API order. The row
 * genuinely IS inside both — `projectScope.inProject` will match it for either — so the
 * question is not which is true but which to BUCKET it under, and the answer has to be the
 * same on every scan. API order is not depth order and is not stable, which is the same
 * argument `reconcile.ownerPath` already makes for sorting its own output.
 */
export function supportGroupOf(
  projects: readonly GrainProject[],
  ownerPath?: string | null,
): string | null {
  const named = lowestName(projects.filter((p) => isSupportGroup(p.name)).map((p) => p.name));
  if (named !== null) return named;
  if (typeof ownerPath !== "string" || ownerPath.trim() === "") return null;
  return lowestName(
    ownerPath.split("/").map((seg) => seg.trim()).filter((seg) => isSupportGroup(seg)),
  );
}

/**
 * The product a row belongs to, or `null`.
 *
 * TWO SOURCES, AND THE FALLBACK REFUSES THE ONE CASE IT CAN PROVE WRONG. `owner_project` is
 * usually already the product — `reconcile.ownerProject` prefers one — and it is the ONLY
 * grain a sealed episode carries, so a fallback to it is load-bearing rather than a
 * convenience. But it is also the column whose ambiguity this module exists to end: for
 * exactly the rows where it holds a SUPPORT GROUP, taking it would put a support group in a
 * field named "product" and rank it against real products in every breakdown. So the fallback
 * is taken unless the value is itself a support group, in which case the row answers no
 * product at all.
 *
 * It deliberately does NOT require `product-`. A repository genuinely outside the convention
 * has a real leaf project in `owner_project` and should keep naming it; refusing everything
 * unrecognised would empty the dimension for those rows to no one's benefit. We decline only
 * what we can positively identify as the wrong grain — `reconcile.ts`'s rule that a fabricated
 * owner is worse than a missing one, because only one of the two can be noticed.
 */
export function productOf(
  projects: readonly GrainProject[],
  ownerProject?: string | null,
): string | null {
  const named = lowestName(projects.filter((p) => isProduct(p.name)).map((p) => p.name));
  if (named !== null) return named;
  if (typeof ownerProject !== "string") return null;
  const owner = ownerProject.trim();
  if (owner === "" || isSupportGroup(owner)) return null;
  return owner;
}
