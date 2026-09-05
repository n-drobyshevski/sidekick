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

/**
 * The scope a sync applied, as one comparable, READABLE token.
 *
 * SORTED, so reordering the same set is not a change — the order decides which step runs
 * first and nothing else, and a notice that fired on a drag-and-drop would train an
 * operator to ignore it. Joined with `|` rather than hashed so the notice can print both
 * sides and the sheet cell can be read by eye.
 */
export function registerScopeSignature(ids: readonly string[]): string {
  return cleanCategoryIds(ids.slice()).slice().sort().join("|");
}
