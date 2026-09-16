// The project catalogue and membership predicate — the data foundation for a project-scope
// selector in the app header (a later package builds the UI).
//
// Ported in spirit, not in code, from gas_ai/src/domain/graphTypes.ts's ProjectRef /
// ProjectCatalogueEntry / projectCatalogue and gas_ai/src/domain/prunePlan.ts's inProject.
// Two differences from that model, both deliberate:
//
//   * KEYED ON `slug`, NOT `id`. gas_ai's ProjectRef keys on `id` because its project switcher
//     reads a live in-memory graph. This register has no such graph — only ledger ROWS — and
//     reconcile.ts's projectsJson/projectsListJson (P1 of this package) already settled on
//     `slug` (falling back to `id`) as this register's stable machine identity for a project,
//     because a display name can be re-typed without the project changing. Following that
//     choice here rather than introducing a second one.
//
//   * SOURCED FROM THE `projects_json` LEDGER COLUMN, not from a live GNode's `projects` field.
//     reconcile.ts's projectsListJson is what fills that column (P1); parseProjects below is
//     its reader.
//
// PURE. No Apps Script globals, no import from src/server/ — ledgerStore.ts and any later
// UI/API package build on this module, never the other way around.

import { isOrgWideProject } from "./config";
import { isProduct, isSupportGroup, productOf, supportGroupOf } from "./projectGrain";
import type { Rec } from "./util";

/**
 * One project a ledger row belongs to.
 *
 * `isFolder` is TRI-STATE. `undefined` means the row predates the `projects_json` column, or
 * the API did not report `isFolder` on this particular project — NEVER read it as `false`.
 * Wiz returns projects as a flat list with no parent links (reconcile.ts's ownerProject/
 * ownerPath comment: a live probe sample carries "VALUE-CHAIN folder, product-TATTOO-idp leaf,
 * CE-TRANSPORT folder, GITHUB-DKTUNITED leaf" on one node, in that order, with no ancestry), so
 * a folder and a leaf are told apart ONLY by this flag when it is present at all.
 */
export interface ProjectRef {
  slug: string;
  name: string;
  isFolder?: boolean;
}

/**
 * Parse the `projects_json` column (reconcile.ts's `projectsListJson`) back into `ProjectRef[]`.
 *
 * NEVER THROWS. `projects_json` is a plain-text spreadsheet cell: null before this package
 * shipped, blank if a person clears it, and whatever a hand edit leaves behind. Any of those —
 * or a value that parses but is not an array of `{slug, name}` objects — comes back as `[]`
 * rather than a caught exception every caller has to remember to guard against. A malformed
 * cell must degrade the project switcher to "no projects known for this row", not crash the
 * page it feeds.
 *
 * ORGANISATION-WIDE PROJECTS ARE DROPPED HERE, at the one place the stored column becomes
 * something this app reasons about (`config.ts::ORG_WIDE_PROJECTS` says which and why). One
 * filter rather than three: the catalogue, the membership predicate and the unattributed
 * count below all read through this function, and so does every server caller
 * (`api.ts` bootstrap, `readModels.ts`'s scoping), so the tenant's org tag cannot be offered
 * as a switcher row in one place while still matching rows in another.
 *
 * A ROW WHOSE ONLY PROJECT IS THE ORG TAG THEREFORE COMES BACK `[]` — and is counted by
 * `unattributedCount`, which is the honest answer rather than a rounding-down: nobody has
 * filed that repository under anything you can pick, and the header caption says so out loud
 * ("N have no project"). Silently leaving it in the catalogue would have said the opposite.
 */
export function parseProjects(projectsJson: string | null | undefined): ProjectRef[] {
  if (!projectsJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(projectsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ProjectRef[] = [];
  for (const p of parsed) {
    if (p === null || typeof p !== "object" || Array.isArray(p)) continue;
    const rec = p as Rec;
    const slug = rec["slug"];
    const name = rec["name"];
    if (typeof slug !== "string" || slug === "" || typeof name !== "string") continue;
    if (isOrgWideProject(slug, name)) continue;
    const ref: ProjectRef = { slug, name };
    // Tri-state: only set the key when the parsed value is actually a boolean. A malformed or
    // missing isFolder must come back as `undefined`, never as `false`.
    if (typeof rec["isFolder"] === "boolean") ref.isFolder = rec["isFolder"];
    out.push(ref);
  }
  return out;
}

/** The shape this module needs of a row. Any ledger/base row satisfies it structurally. */
export interface ProjectsCarrier {
  projects_json?: string | null;
}

/** One row of the project switcher's list: a project, and how much of the register holds it. */
export interface ProjectCatalogueEntry {
  slug: string;
  name: string;
  isFolder?: boolean;
  /** Rows in the CURRENT register carrying this project. Not a Wiz-side total. */
  findings: number;
  /**
   * For a PRODUCT: the support group it sits inside, or `null` when nobody can say.
   *
   * `null` covers two different situations that the switcher must not merge with each other
   * and must not merge with "this is not a product": no support group co-occurred with it at
   * all, or SEVERAL did. `supportGroupCount` is what tells them apart, and the picker says
   * `2 support groups` rather than picking one — see the field below.
   */
  supportGroup: string | null;
  /**
   * How many distinct support groups this product was seen under. `0` for everything that is
   * not a product, and for a product nothing was ever filed beside.
   *
   * PRESENT ON EVERY ENTRY, not only on products, so the payload has one shape and a reader
   * never has to test for the key's existence before testing its value.
   */
  supportGroupCount: number;
}

/**
 * The distinct projects the register's rows belong to, folders first, then by name.
 *
 * Derived from the rows rather than from a live Wiz projects-catalogue query — the same
 * property gas_ai's `projectCatalogue` keeps, for the same reason: a project nothing in the
 * CURRENT register carries is simply absent from the picker, rather than present and
 * answering zero. An empty register (no rows, or no row carrying any project) yields `[]`.
 *
 * `isFolder` merges FIRST-NON-`undefined`-WINS across every occurrence of the same slug: a row
 * whose scan predates the field, or whose API response omitted `isFolder` on this project on
 * this observation, must not blank out what an earlier or later row already measured, and
 * once a project is known to be a folder or a leaf nothing here un-learns it.
 *
 * THE PARENT EDGE COMES FROM CO-OCCURRENCE, and this is the only place it could. Wiz reports
 * no ancestry — but it flattens the WHOLE chain onto every finding, so a support group and a
 * product appearing on the same row ARE an edge, observed rather than assumed. Collected in
 * the pass this function already makes, so it costs no second parse.
 *
 * A PRODUCT SEEN UNDER TWO SUPPORT GROUPS NAMES NEITHER. A catalogue entry is a summary over
 * many rows, and a picker hint reading `Product · CE-TRANSPORT` on a product that actually
 * spans two groups is a false structural claim a reader will act on. Same posture as
 * `server/fixNext.ts`, which already declines to name an owner when a ranked group disagrees.
 * Note this is the OPPOSITE of what `projectGrain.supportGroupOf` does for a single ROW, and
 * deliberately: a row that carries two groups really is inside both and must still land in a
 * bucket, or the breakdown stops adding up.
 */
export function projectCatalogue(
  rows: readonly ProjectsCarrier[],
): ProjectCatalogueEntry[] {
  const bySlug = new Map<string, ProjectCatalogueEntry>();
  const parentsOf = new Map<string, Set<string>>();
  for (const row of rows) {
    const projects = parseProjects(row.projects_json);
    const groups = projects.filter((p) => isSupportGroup(p.name)).map((p) => p.name);
    for (const p of projects) {
      if (groups.length && isProduct(p.name)) {
        let parents = parentsOf.get(p.slug);
        if (!parents) {
          parents = new Set<string>();
          parentsOf.set(p.slug, parents);
        }
        for (const g of groups) parents.add(g);
      }
      const seen = bySlug.get(p.slug);
      if (!seen) {
        bySlug.set(p.slug, {
          slug: p.slug,
          name: p.name,
          isFolder: p.isFolder,
          findings: 1,
          supportGroup: null,
          supportGroupCount: 0,
        });
        continue;
      }
      seen.findings += 1;
      if (seen.isFolder === undefined && p.isFolder !== undefined) seen.isFolder = p.isFolder;
    }
  }
  for (const [slug, parents] of parentsOf) {
    const entry = bySlug.get(slug);
    if (!entry) continue;
    entry.supportGroupCount = parents.size;
    entry.supportGroup = parents.size === 1 ? [...parents][0]! : null;
  }
  return [...bySlug.values()].sort((a, b) =>
    a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1,
  );
}

/**
 * Does this row's project list reach `slug`.
 *
 * ONE `.some()`, NO TREE WALK. Wiz returns the WHOLE ancestor chain flattened onto every
 * finding — the probe sample above carries both folders and the leaf together on one node —
 * so a single slug match on a FOLDER already reaches its entire subtree; this module never
 * needs to know the tree's actual shape to answer "is this row inside that project".
 *
 * THIS IS THE SINGLE DEFINITION of project membership. A later package (the app-header
 * selector, any project-scoped view or export) must call this rather than writing a second
 * `.some()` over a row's projects — two copies of the question is how a codebase ends up with
 * two answers to "what is inside VALUE-CHAIN", which is exactly the class of drift CLAUDE.md
 * already records for this repo's other duplicated predicates (`OBJECT_FILTERS`, the severity
 * palette).
 *
 * An empty slug matches nothing — there is no "everything" project, so a caller that forgot to
 * resolve a selection into a real slug fails closed rather than silently matching every row.
 */
export function inProject(projects: readonly ProjectRef[] | undefined, slug: string): boolean {
  if (!slug) return false;
  return (projects ?? []).some((p) => p.slug === slug);
}

/**
 * Rows carrying NO project at all.
 *
 * These rows are invisible to every entry `projectCatalogue` produces and to every
 * `inProject` check — an empty `projects[]` reaches no slug and swells no catalogue count. A
 * later package building the project-scope selector must report this figure OUT LOUD (an
 * "N findings have no known project" caption) rather than let those rows silently vanish from
 * every scoped view, which is the same "absent is never zero" argument CLAUDE.md already
 * makes for this codebase's tri-state flags — applied here to a population rather than a field.
 */
export function unattributedCount(rows: readonly ProjectsCarrier[]): number {
  let count = 0;
  for (const row of rows) {
    if (parseProjects(row.projects_json).length === 0) count += 1;
  }
  return count;
}

// --------------------------------------------------------------------------- #
//  the two grains: support group and product, attached on read
// --------------------------------------------------------------------------- #

/** The shape `attachProjectGrain` reads and writes. Any ledger/base row satisfies it. */
export interface ProjectGrainCarrier extends ProjectsCarrier {
  owner_project?: string | null;
  owner_path?: string | null;
  _supportGroup?: string | null;
  _product?: string | null;
}

/**
 * Attach `_supportGroup` and `_product` to each row (in place).
 *
 * TWO DIMENSIONS, NOT ONE COLUMN. The tenant files every repository under a CS/CE/LU SUPPORT
 * GROUP and under a `product-…` PRODUCT, and one support group holds many products
 * (`projectGrain.ts` carries the vocabulary and the full argument). `owner_project` collapsed
 * both into a single string whose grain depended on the order Wiz returned the array in; these
 * two fields are what every breakdown, ranking and roll-up groups by instead.
 *
 * ATTACHED, NEVER A COLUMN — the same choice `_domain` made, for a stronger version of the
 * same reason. A prefix rule is the tenant's vocabulary, and vocabulary changes: a fourth
 * support-group prefix, a renamed product marker, a repository re-filed in Wiz. Baked into the
 * ledger, each of those would cost a full re-scan to correct, and — because reconcile merges
 * these columns latest-wins-NEVER-ERASED — a stale value would keep winning even then. This
 * register has already paid that bill once: `ledgerStore.ownerOf` and `scrubOrgWideOwners`
 * exist only because `ORG_WIDE_PROJECTS` was applied to a stored column. Derived on read, a
 * corrected rule is one edit and a page reload.
 *
 * NEVER A NO-OP, unlike `repoDomains.attachDomains`. That one is gated on a join map that may
 * never have been refreshed, so it legitimately leaves every row unset; this is a pure
 * function of the row and always answers what the row can support. A field left UNSET here
 * therefore means the row genuinely carries no such attribution — which is a finding, not a
 * gap in the plumbing, and is reported as its own bucket rather than defaulted to a
 * placeholder.
 */
export function attachProjectGrain(rows: readonly ProjectGrainCarrier[]): void {
  for (const row of rows) {
    const projects = parseProjects(row.projects_json);
    const group = supportGroupOf(projects, row.owner_path);
    const product = productOf(projects, row.owner_project);
    if (group !== null) row._supportGroup = group;
    if (product !== null) row._product = product;
  }
}
