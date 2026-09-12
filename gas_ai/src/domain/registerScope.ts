// WHICH RISK CATEGORIES THE ISSUE REGISTER COLLECTS — and why that list is stamped.
//
// Every figure this app publishes about issues — the register total, AARS pillar A, the
// Toxic Combinations page, the tab literally called `ai_issues` — counts the rows one
// `frameworkCategory` filter returned. Widening that filter does not extend the register;
// it CHANGES WHAT EVERY PUBLISHED FIGURE COUNTS, silently, because nothing on the wire
// says which category a row came back under: `Issue` carries 51 fields and not one names a
// category (AARS_LIVE_MEASUREMENTS.md §6.8). A count of 6,073 beside a count of 99 is not
// growth in the landscape, it is a different question being answered.
//
// Two consequences, and they are the whole reason this module exists:
//
//   1. THE STAMP. A row is written with the category it was FETCHED under
//      (`IssueRow.categories`), because it is the only place that fact can survive. The
//      list is per-step, so an issue that sits in two selected categories arrives twice
//      and merges to one row carrying both stamps — see mergeParts.
//
//   2. THE SIGNATURE. Each sync records the scope it APPLIED (`sync_history.register_scope`),
//      never the one settings hold at read time. A stored ledger and a widened setting
//      disagree until the next sync, and an operator comparing today's total against
//      yesterday's has to be told that rather than left to discover it.
//
// The signature is a SORTED JOIN, not a hash, for the same reason `problemRule.vectorSignature`
// is: it appears in a sheet cell and in a staleness notice, where a human has to be able to
// read what changed. A hash would say only that something did.
//
// It also carries the OTHER scope decision — which perimeters the battery collected from —
// because that changes what every figure counts for exactly the same reason a category list
// does. See `SyncScope` and `registerScopeSignature` below, and read the note there on why
// only the widening is stamped before changing either.

import { RISK_CATEGORY_ID } from "./toxicCombos";

/**
 * The categories offered as a register scope, with the open-issue count each carried on the
 * reference tenant.
 *
 * TENANT FIGURES, dated, NOT pinned by any test — they are a fact about one estate on one
 * day (AARS_LIVE_MEASUREMENTS.md §6.1, measured 2026-08-23, VALUE-CHAIN project scope) and
 * they are here to say why this set and not another. 74 categories carry at least one open
 * issue in that scope and the sum across them is 74,209 against a ceiling of 14,617 — each
 * issue sits in roughly five categories — so picking by count would be wrong. The four
 * largest are 6k–9.5k rows of general IT hygiene each, and taking them makes the models
 * WORSE, not just more expensive: at the ceiling the estate is 58% INFORMATIONAL, which
 * drops effective severity cardinality from 2.88 to 2.64 (§6.2).
 *
 *   wct-id-1998                            AI Security                   99 open issues
 *   wct-id-3                               Vulnerability Assessment     677
 *   41a3ed79-9a2c-4466-9109-f845fd057bd4   High Profile Threats         536
 *   5c3c85b5-bb94-4ee7-8f3e-c186d0229280   Data Security                439
 *   1f28667a-9d12-48dd-898d-d326bb422f8d   Key & Secret Management    1,390
 *   861eb856-54f6-4d1b-8ca1-1d6130841d20   Identity Management        3,477
 *
 * A CANDIDATE LIST, not a permitted set: `cleanCategoryIds` does not reject an id outside
 * it. Wiz's `securityCategories` returns 500+ rows including CIS benchmark and UUID-keyed
 * custom categories (§6.8), and a tenant whose ids differ from these would be locked out of
 * its own register by a whitelist.
 */
export const CANDIDATE_CATEGORIES: ReadonlyArray<{ id: string; name: string }> = [
  { id: RISK_CATEGORY_ID, name: "AI Security" },
  { id: "wct-id-3", name: "Vulnerability Assessment" },
  { id: "41a3ed79-9a2c-4466-9109-f845fd057bd4", name: "High Profile Threats" },
  { id: "5c3c85b5-bb94-4ee7-8f3e-c186d0229280", name: "Data Security" },
  { id: "1f28667a-9d12-48dd-898d-d326bb422f8d", name: "Key & Secret Management" },
  { id: "861eb856-54f6-4d1b-8ca1-1d6130841d20", name: "Identity Management" },
];

/**
 * What the register collects when nobody has chosen — TODAY'S BEHAVIOUR, exactly.
 *
 * The widening is a knob, and a knob ships defaulting to what shipped before it. Everything
 * pinned about this register (the golden payloads, the scoring vectors, the page copy that
 * says "AI") is true of this one category and of no other list.
 */
export const DEFAULT_CATEGORY_IDS: readonly string[] = [RISK_CATEGORY_ID];

/**
 * Coerce a stored or posted category list into one the battery can run.
 *
 * Strings only, trimmed, deduped, empties dropped — and an empty result falls back to the
 * default rather than becoming an empty filter. An empty `frameworkCategory` is not "no
 * categories", it is NO FILTER AT ALL: the register would silently collect the whole
 * project (14,617 issues where the scope holds 99), which is the exact failure the stamp
 * exists to make visible. Given order is preserved, because it is the order the generated
 * steps run in and a battery whose step list reorders itself between reads is not
 * reproducible.
 */
export function cleanCategoryIds(v: unknown): string[] {
  if (!Array.isArray(v)) return DEFAULT_CATEGORY_IDS.slice();
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen[id]) continue;
    seen[id] = true;
    out.push(id);
  }
  return out.length ? out : DEFAULT_CATEGORY_IDS.slice();
}

// ------------------------------------------------------------- the OTHER half of the scope
//
// WHICH PERIMETERS THE SYNC COLLECTS FROM, as opposed to which risk categories it collects.
// The two are orthogonal and both change what every published figure counts, which is why
// the vocabulary for both lives here.
//
// `project` is what this app has always done: every step carries the WIZ_PROJECT_ID_V2
// project filter, and the register answers for that one perimeter. `tenant` sends no project
// filter at all — the same thing an unset property has always done — so the battery collects
// every perimeter the credentials can see.

/** What the sync collects from: the configured project alone, or every perimeter. */
export type SyncScope = "project" | "tenant";

/**
 * What the sync collects from when nobody has chosen — TODAY'S BEHAVIOUR, exactly.
 *
 * Same iron rule as DEFAULT_CATEGORY_IDS above: a knob ships defaulting to what shipped
 * before it, so no tenant's figures move on upgrade.
 */
export const DEFAULT_SYNC_SCOPE: SyncScope = "project";

/**
 * Coerce a stored or posted value into a scope the battery can run.
 *
 * A two-state enum, so anything unrecognised folds back to the default rather than being
 * refused: the alternative is a hand-edited settings cell that throws on every read, and
 * `project` is the narrow answer — degrading towards collecting LESS than asked is the safe
 * direction for a knob whose other setting spends execution budget.
 */
export function cleanSyncScope(v: unknown): SyncScope {
  return v === "tenant" ? "tenant" : DEFAULT_SYNC_SCOPE;
}

/**
 * The project filter the battery should apply, from the setting and the property together.
 *
 * PURE, and that is the point: `projectScope()` in server/props.ts is this function plus two
 * reads, so the decision itself is testable without GAS globals — the same split
 * `resolveWizAuthMode` already makes one file over.
 *
 * `tenant` yields null, which every variable builder already reads as "send no project
 * filter". So does `project` with nothing configured: a blank property has never meant
 * anything else, and inventing an error here would break the dry run and every tenant who
 * has simply never set it.
 */
export function resolveProjectScope(
  scope: SyncScope,
  propId: string | null,
): string[] | null {
  if (scope === "tenant") return null;
  return typeof propId === "string" && propId.trim() ? [propId.trim()] : null;
}

/** The suffix a tenant-wide sync stamps on its signature. Not a category id — see below. */
const TENANT_SUFFIX = "#tenant";

/**
 * The scope a sync applied, as one comparable, READABLE token.
 *
 * SORTED, so reordering the same set is not a change — the order decides which step runs
 * first and nothing else, and a notice that fired on a drag-and-drop would train an
 * operator to ignore it. Joined with `|` rather than hashed so the notice can print both
 * sides and the sheet cell can be read by eye.
 *
 * ONLY THE WIDENING IS STAMPED, and that asymmetry is deliberate. When a project filter was
 * applied the token is BYTE-IDENTICAL to what this function returned before perimeters were
 * a setting, so every ledger already on disk keeps matching and the next sync resolves the
 * rows it should instead of counting the whole register as `skippedNarrowedScope` once. The
 * price, stated because somebody will hit it: moving WIZ_PROJECT_ID_V2 from one project to
 * another still stamps nothing, so the ledger will read the rows that left with the old
 * project as departures — exactly as it does today, unchanged by this knob.
 *
 * `applied` is THE SCOPE THAT RAN — whatever `projectScope()` returned — never the setting.
 * An operator who selects `project` with the property blank gets `#tenant`, because that is
 * what the battery did. Typed as the applied filter rather than as the enum so that handing
 * it the setting by mistake is a compile error, not a silently wrong stamp.
 */
export function registerScopeSignature(
  ids: readonly string[],
  applied: readonly string[] | null,
): string {
  const categories = cleanCategoryIds(ids.slice()).slice().sort().join("|");
  // Keyed on "no project filter reached the wire", not on `=== null`: an empty list would
  // also send no filter, and the stamp has to describe what Wiz was asked.
  return applied && applied.length ? categories : categories + TENANT_SUFFIX;
}

/** A signature read back apart: the categories it names, and whether it ran tenant-wide. */
export interface RegisterScopeParts {
  categories: string[];
  tenantWide: boolean;
}

/**
 * Split a stored signature back into its two halves.
 *
 * The ONE parser, because the suffix is glued to the last category id and any reader that
 * splits on `|` alone prints `wct-id-3#tenant` as though a category were called that. Both
 * surfaces that show a signature to a person go through this (the issue sheet's Register
 * scope row, and the scope-drift notice), which is why it is here rather than in either.
 */
export function describeRegisterScope(signature: unknown): RegisterScopeParts {
  const raw = typeof signature === "string" ? signature : "";
  const tenantWide = raw.slice(-TENANT_SUFFIX.length) === TENANT_SUFFIX;
  const body = tenantWide ? raw.slice(0, -TENANT_SUFFIX.length) : raw;
  return { categories: body ? body.split("|") : [], tenantWide };
}

/**
 * A signature as a person reads it: the categories, and the perimeter note when there is one.
 *
 * SILENT about the perimeter in the project case, and that silence is accurate rather than
 * lazy. An unsuffixed token records that SOME project filter applied and never which one —
 * see registerScopeSignature's own note on the cost that buys — so naming the project here
 * would be a claim the stamp cannot support, and every row written before this knob existed
 * carries exactly that token.
 */
export function formatRegisterScope(signature: unknown): string {
  const { categories, tenantWide } = describeRegisterScope(signature);
  const list = categories.join(", ");
  if (!tenantWide) return list;
  return list ? `${list} (all perimeters)` : "all perimeters";
}
