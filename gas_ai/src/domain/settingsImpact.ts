// What the Settings page needs in order to state, beside each control, what that control is
// currently doing to the register — the AI-register twin of `gas/src/domain/settingsImpact.ts`.
// Read that file's header first; the thesis is the same one: "a figure that appears only
// after you save is not decision support, it is a receipt."
//
// THREE CONTROLS, THREE FIGURES.
//
//   1. THE REGISTER-SCOPE CATEGORY PICKER (registerScope.ts's `CANDIDATE_CATEGORIES`). An
//      issue is fetched under a SET of categories — `frameworkCategory` is a union query, and
//      `IssueRow.categories` is the stamp of which categories asked for a given row
//      (registerScope.ts's own header: "Issue carries 51 fields and not one names a
//      category"). The question the picker asks is a set-CONTAINMENT question — "how many
//      open issues are stamped ONLY with categories this draft removes" — and a union cannot
//      be answered from marginal per-category counts any more than `anyOf` can in the risk
//      cube: two categories that both stamp the same row would be double-subtracted. So this
//      ships a CUBE too: the joint distribution of which candidate categories (of up to six)
//      stamp each open issue, keyed by a bitmask over `CANDIDATE_CATEGORIES`. See
//      `CategoryCube`.
//
//   2. THE RANK MODEL'S FOUR TERM SHARES (`domain/rank.ts`). Each term the blend can weight
//      only ever prices the rows it can actually READ — `rankOne` drops an unmeasured term
//      from both sides of the fraction rather than scoring it 0 — so the mistake this control
//      invites is putting a large share on a term most of the queue cannot measure. This ships
//      how many rows in the Priorities queue measure each term. See `TermCoverage`.
//
//   3. `autoExpand` (settings.js). Its stated cost is "one Wiz API call per agent per scan",
//      which is not a number a reader can act on without the other factor: how many agents.
//      This ships that count.
//
// THE HONESTY REQUIREMENT the category cube exists to keep. A category the register has
// never collected has no rows stamped with it at all, and its count is therefore
// indistinguishable from a category that WAS collected and simply has zero open issues right
// now — UNLESS something on the payload says which is which. `aarsTrend.ts`'s
// `CATEGORY_SPEC.absentKeyIsNull` already draws exactly this line for the category TREND
// ("an absent key is a sync that never counted that category"); `CategoryCube.measuredCandidateIds`
// draws it here. See that field's own comment for why it is built from the live ledger and the
// live setting, and deliberately not from `sync_history.category_counts_json`.

import { CANDIDATE_CATEGORIES } from "./registerScope";

// ------------------------------------------------------------------------- the category cube

export interface CategoryCube {
  /** Open issues the cube was built from — the register-wide open population, unfiltered by
   *  project view (the register-scope setting is register-wide, not per-project). */
  total: number;
  /**
   * Keyed by a bitmask over `candidateIds` (bit i set means the row carries candidate i's
   * stamp), as a decimal string — `"5"` is bits 0 and 2. Sparse: a mask no open row carries
   * is simply absent, exactly like the risk cube's cells being mostly zero. Mask `"0"` is
   * real and means "stamped with none of the six candidates" — a row fetched only under a
   * category outside the candidate list (registerScope.ts's own point: the list is a
   * candidate set, not a permitted one).
   */
  cells: Record<string, number>;
  /** `CANDIDATE_CATEGORIES` ids, in bit order — bit i of a mask is `candidateIds[i]`. */
  candidateIds: string[];
  /**
   * Which candidate ids this cube can actually answer for. A candidate NOT in this list has
   * no evidence either way in `cells` — its count is not 0, it is UNMEASURED, and a client
   * that read a missing bit as "zero open issues" would be reading a widened-but-unsynced (or
   * never-tried) category as a clean register.
   *
   * BUILT FROM TWO SOURCES, UNIONED: the categories the register is CURRENTLY CONFIGURED to
   * collect (`settingsStore.getIssueCategories()` at call time — forward-looking: about to be
   * true, or already true if a sync has run since), and any candidate whose bit is actually
   * set on some row in `cells` (backward-looking: it has been collected at some point and the
   * ledger still carries the evidence).
   *
   * WHY NOT `sync_history.category_counts_json` (`aarsTrend.CATEGORY_COUNTS_COLUMN`). It was
   * the other candidate source and it was rejected for being unreliable at exactly the grain
   * this field needs: `countIssueCategories` (which writes that column) omits a category's
   * key entirely whenever ZERO of that sync's issues carried its stamp — so "collected this
   * category, and it was genuinely empty that sync" and "never collected it" are ALREADY the
   * same absent key in that column, for the one sync that matters most (today's scope, if it
   * has a zero count). Scanning the column's whole history does not close that gap — it only
   * shrinks it, and at the cost of a full `sync_history` read this endpoint has no other
   * reason to take. The chosen source is free (built from data this cube already walks) and
   * is honest about what it is: current configuration plus current evidence, not a full
   * historical reconstruction.
   */
  measuredCandidateIds: string[];
}

/** A row's stamp set as a bitmask over `candidateIds`. Bits for ids outside the list are dropped. */
export function categoryMaskOf(
  categories: readonly string[] | undefined,
  candidateIds: readonly string[],
): number {
  let mask = 0;
  for (const cat of categories ?? []) {
    const idx = candidateIds.indexOf(cat);
    if (idx >= 0) mask |= 1 << idx;
  }
  return mask;
}

/**
 * The joint distribution over stamp sets, for whichever `candidateIds` the caller names (the
 * server always calls this with `CANDIDATE_CATEGORIES`' own ids; a test can name a shorter
 * list to keep fixtures small). `configuredIds` is the register's CURRENT `issueCategories`
 * setting — see `CategoryCube.measuredCandidateIds` for why it feeds the honesty field and
 * nothing else; it does not gate which rows get counted, since a row's own stamp already
 * says what it was fetched under.
 */
export function buildCategoryCube(
  rows: ReadonlyArray<{ categories?: readonly string[] }>,
  candidateIds: readonly string[],
  configuredIds: readonly string[],
): CategoryCube {
  const cells: Record<string, number> = {};
  let seenBits = 0;
  for (const r of rows) {
    const mask = categoryMaskOf(r.categories, candidateIds);
    seenBits |= mask;
    const key = String(mask);
    cells[key] = (cells[key] ?? 0) + 1;
  }
  const configured = new Set(configuredIds);
  const measuredCandidateIds = candidateIds.filter(
    (id, i) => configured.has(id) || (seenBits & (1 << i)) !== 0,
  );
  return { total: rows.length, cells, candidateIds: [...candidateIds], measuredCandidateIds };
}

/**
 * Rows stamped with AT LEAST ONE of `selectedIdx` (candidate bit indices) — the union count a
 * marginal cannot give, because a row stamped with two selected candidates must be counted
 * once, not twice. Empty `selectedIdx` is "nothing selected" and returns 0, matching
 * `cleanCategoryIds`'s refusal to treat an empty filter as "no categories" rather than
 * "unfiltered" — the picker itself must never let a draft reach that state, but the reader
 * must not divide-by-a-lie if it briefly does.
 */
export function categoryUnionCount(cube: CategoryCube, selectedIdx: readonly number[]): number {
  let bits = 0;
  for (const i of selectedIdx) bits |= 1 << i;
  if (!bits) return 0;
  let sum = 0;
  for (const [key, count] of Object.entries(cube.cells)) {
    if (Number(key) & bits) sum += count;
  }
  return sum;
}

/** Open issues stamped with one candidate — the marginal, trivially the union of one bit. */
export function categoryMarginalCount(cube: CategoryCube, idx: number): number {
  return categoryUnionCount(cube, [idx]);
}

/**
 * Open issues stamped with at least one of `droppedIdx` and NONE of `keptIdx` — "stamped only
 * with categories the draft removes", the set-containment figure marginals cannot answer.
 * `keptIdx` is the draft's remaining selection (not "everything minus dropped" in the
 * abstract — the caller's actual kept set), so a row stamped with a dropped candidate AND a
 * still-kept one is correctly NOT counted: re-fetching under the narrowed scope would still
 * return it via the kept stamp.
 */
export function categoryDroppedOnlyCount(
  cube: CategoryCube,
  keptIdx: readonly number[],
  droppedIdx: readonly number[],
): number {
  let keptBits = 0;
  for (const i of keptIdx) keptBits |= 1 << i;
  let droppedBits = 0;
  for (const i of droppedIdx) droppedBits |= 1 << i;
  let sum = 0;
  for (const [key, count] of Object.entries(cube.cells)) {
    const mask = Number(key);
    if ((mask & keptBits) === 0 && (mask & droppedBits) !== 0) sum += count;
  }
  return sum;
}

/** The three figures the picker needs, computed together so a caller cannot request one alone
 *  and forget the other two exist. */
export interface CategoryScopeImpact {
  /** Open issues stamped with at least one category in `selectedIds` — the union. */
  inScopeOpen: number;
  /** Open issues per candidate, id to marginal count — every id in `cube.candidateIds`,
   *  whether or not it is in `cube.measuredCandidateIds` (a caller must consult that
   *  separately; a 0 here beside an unmeasured id is not a claim about the register). */
  perCategory: Record<string, number>;
  /** Open issues stamped only with categories dropped between `previousIds` and `selectedIds`. */
  droppedOnlyOpen: number;
}

export function categoryScopeImpact(
  cube: CategoryCube,
  selectedIds: readonly string[],
  previousIds: readonly string[] = selectedIds,
): CategoryScopeImpact {
  const idxOf = (id: string): number => cube.candidateIds.indexOf(id);
  const selectedIdx = selectedIds.map(idxOf).filter((i) => i >= 0);
  const previousIdx = previousIds.map(idxOf).filter((i) => i >= 0);
  const droppedIdx = previousIdx.filter((i) => selectedIdx.indexOf(i) < 0);
  const perCategory: Record<string, number> = {};
  cube.candidateIds.forEach((id, i) => {
    perCategory[id] = categoryMarginalCount(cube, i);
  });
  return {
    inScopeOpen: categoryUnionCount(cube, selectedIdx),
    perCategory,
    droppedOnlyOpen: categoryDroppedOnlyCount(cube, selectedIdx, droppedIdx),
  };
}

/** `CANDIDATE_CATEGORIES`' own ids, in the order the server always builds the cube against. */
export const DEFAULT_CANDIDATE_IDS: readonly string[] = CANDIDATE_CATEGORIES.map((c) => c.id);

// ---------------------------------------------------------------------- rank term coverage

/** The rank inputs (`domain/rank.ts`'s `RankInput`) read structurally, the way `problems.ts`
 *  reads them onto `ProblemRow` — a row without a field is a row the model reads as
 *  unmeasured for that term, never as a zero. */
export interface TermCoverageInput {
  dueAt?: string | null;
  /** `rank.ts`'s `createdAt` — `ProblemRow.firstSeenAt` on the caller's side. */
  createdAt?: string | null;
  exploitationTier?: string | null;
  aiAdjacency?: string | null;
}

export interface TermCoverage {
  /** Rows in the queue this was computed over. */
  total: number;
  /** Rows the RULE term measures — always every row, via `defaultRuleWeight`. Shipped rather
   *  than assumed, so a reader never has to take "always" on faith. */
  rule: number;
  /**
   * TWO counts, not one, because `timeSource` switches which date the clock reads and the
   * figure has to move live with it: `dueAt` for `dueAtOnly`, `createdAt` as the FALLBACK
   * `dueAtElseAge` reaches for on a row with no deadline. These are independent raw counts,
   * not a union — a row with both a parseable `dueAt` and `createdAt` counts in both, because
   * which one the CLOCK actually reads depends on the `timeSource` toggle, and only the
   * reader (not this module) knows which toggle state it is drawing.
   */
  time: { dueAt: number; createdAt: number };
  /** Rows the exploitation term measures — tier present and not `unknown` (`rank.exploitationOf`
   *  reads absent and `unknown` identically: a measurement gap, never `none`). */
  exploitation: number;
  /** Rows the adjacency term measures — `aiAdjacency` present (`UNLINKED` included: it is a
   *  measurement, not an absence, exactly as `rank.adjacencyOf` reads it). */
  adjacency: number;
}

function parsesAsDate(v: string | null | undefined): boolean {
  return typeof v === "string" && v !== "" && Number.isFinite(Date.parse(v));
}

/**
 * How many rows in a queue actually measure each of the four rank terms — the number that
 * makes "putting a large share on a term most rows cannot measure" a visible mistake rather
 * than one the operator discovers after saving. Mirrors, deliberately loosely, the presence
 * checks `rank.ts`'s own `timeOf` / `exploitationOf` / `adjacencyOf` make before a term is
 * allowed to enter the blend at all.
 */
export function termCoverageOf(rows: ReadonlyArray<TermCoverageInput>): TermCoverage {
  let dueAtN = 0;
  let createdAtN = 0;
  let exploitationN = 0;
  let adjacencyN = 0;
  for (const r of rows) {
    if (parsesAsDate(r.dueAt)) dueAtN += 1;
    if (parsesAsDate(r.createdAt)) createdAtN += 1;
    const tier = String(r.exploitationTier ?? "").trim().toLowerCase();
    if (tier && tier !== "unknown") exploitationN += 1;
    if (r.aiAdjacency) adjacencyN += 1;
  }
  return {
    total: rows.length,
    rule: rows.length,
    time: { dueAt: dueAtN, createdAt: createdAtN },
    exploitation: exploitationN,
    adjacency: adjacencyN,
  };
}
