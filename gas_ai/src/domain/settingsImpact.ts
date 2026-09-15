// What the Settings page needs in order to state, beside each control, what that control is
// currently doing to the register — the AI-register twin of `gas/src/domain/settingsImpact.ts`.
// Read that file's header first; the thesis is the same one: "a figure that appears only
// after you save is not decision support, it is a receipt."
//
// FOUR CONTROLS, FOUR FIGURES.
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
//   4. P11: THE RANK MODEL'S EFFECT ON THE QUEUE'S ORDER. (2) answers "can this term even be
//      read" — it says nothing about "would tightening this knob change which issue I work on
//      Monday". Two rows score IDENTICALLY under any rule this page can produce whenever they
//      share `(ruleWeightKey, dueStep, ageStep, exploitationTier, epssBin, adjacency)` — see
//      `rank.ts`'s header for the four terms and the ladder — so the queue can be summarized as
//      the SPARSE JOINT over that tuple, a map from tuple to row count, bounded by distinct
//      tuples present rather than by row count. From it the client recomputes, per keystroke,
//      exactly what a rule change does: the score histogram under the draft and the saved rule
//      side by side, how many rows move by more than a threshold, `kendallTauB` between the two
//      orderings, and top-N carry-over. See `RankCube` below for the tuple, the cube, and —
//      most load-bearing — why the top-N carry-over is reported as a RANGE rather than a count.
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
import { DEFAULT_RANK_RULE, rankKeyOf, type AdjacencyWeights, type ExploitationWeights,
  type RankInput, type RankRule, type RankShares, type TimeSource } from "./rank";

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

// ============================================================================== P11: rank cube
//
// THE TUPLE. `rank.rankOne` scores a row from exactly four readings —
// `weightFor(rankKeyOf(row), rule)`, the clock's bucket, the exploitation ladder's rung, and
// the adjacency reading — blended by shares that renormalise over whichever of the four are
// both MEASURED and non-zero. Two rows that agree on all four readings score IDENTICALLY under
// EVERY rule this settings page can produce, because nothing else about a row ever reaches the
// blend. So the tuple this cube keys on is:
//
//     (ruleWeightKey, dueStep, ageStep, exploitationTier, epssBin, adjacency)
//
// `ruleWeightKey` IS THE WEIGHT NUMBER, NOT THE RULE ID — and that is deliberate, not an
// oversight. `ruleWeights` is a per-rule-id table THIS PANEL DOES NOT EDIT (only the four
// shares, the two weight tables, `epssThreshold` and `timeSource` are draft fields — see
// pages/settings.js's `rankField`/`rankLeaf` wiring, which never touches `ruleWeights` or
// `defaultRuleWeight`), so for every rule the draft can actually produce, `weightFor` returns
// the SAME number for a given row as it did when this cube was built. Two rows carrying
// different rule ids that both land on `defaultRuleWeight` (or both land on the same
// `exploitationByRuleId` maturity weight — REALIZED/DEMONSTRATED/FEASIBLE are the only other
// values `rankRuleFromExploitation` ever assigns) are truly interchangeable today, and keying
// on the weight collapses what would otherwise be one cell per rule id (there are hundreds of
// distinct rule ids on a live tenant — see `rank.ts`'s own measurement) into one cell per
// distinct WEIGHT, of which there are at most a handful.
//
// STANDING NOTE, NOT A TODO: IF A LATER PACKAGE ADDS A PER-RULE-WEIGHT EDITOR TO THIS PANEL,
// THIS COLLAPSE STOPS BEING VALID. The moment `ruleWeights` becomes a draft field, two rows
// sharing today's weight number can diverge the instant only one of their rule ids is
// retargeted, and the tuple's first component has to become the rule id itself — at which
// point this cube grows from "hundreds of cells" to "hundreds of cells PER RULE ID", because
// the sparsity that makes it cheap today (distinct WEIGHTS are few) would no longer hold
// (distinct RULE IDS are not). That is a real cost, not a formatting change, and whoever adds
// that editor should re-read this note before assuming the cube still fits `CacheService`'s
// 100 KB ceiling unchanged.
//
// `dueStep` / `ageStep` ARE LADDER INDICES, NOT THE `RankResult.bucket` CONVENTION. Both are
// always computed from the row's OWN `dueAt` / `createdAt` against the ladders the CUBE was
// built with (`overdueDayBuckets` / `ageDayBuckets` — also not draft fields on this panel), so
// a client can score a row under `timeSource: "dueAtOnly"` AND `"dueAtElseAge"` from the same
// tuple without a round trip: `rank.timeOf` always tries the due ladder first regardless of
// `timeSource`, and only reaches for the age ladder when there is no `dueAt` and the source is
// `dueAtElseAge` — `scoreFromTuple` below reproduces exactly that precedence. `null` on either
// means the row carries no parseable date on that axis at all — UNMEASURED, the same
// convention `rank.ts`'s own `RankResult.timeComponent` keeps, never a manufactured step 0.
//
// `exploitationTier` COLLAPSES A ROW WHOSE PEAK EPSS WAS NEVER CAPTURED INTO `"none"` RATHER
// THAN CARRYING A THIRD `epss`-WITH-NO-BIN STATE. `rank.exploitationOf`'s `epss` branch reads
// `weights.none` whenever `epssPeak` is `null` REGARDLESS of `epssThreshold` — a peak that was
// never measured can never clear a bar — so that row prices identically to a `"none"` row under
// every threshold the draft can dial in, and giving it a separate tuple state would only widen
// the cube for a distinction that never changes an answer.
//
// `epssBin` uses the same 100-bin, 0.01-per-bin convention `gas/src/domain/settingsImpact.ts`'s
// `RiskCube` uses for the same reason: the settings panel's EPSS-threshold control steps by
// 0.01 (pages/settings.js's `rankNumber("expl-threshold", …, { step: "0.01" })`), so no
// reachable threshold falls inside a bin. Independently implemented rather than imported —
// `gas_ai` does not import from `gas` (see CLAUDE.md and this repo's fork discipline) — and
// `epssCutOf`'s epsilon nudge exists for the identical floating-point reason `breakdownFromCube`
// documents there: `0.07 * 100` is `7.000000000000001` in IEEE 754, and a bare `ceil` would push
// the cut a whole bin high.
//
// WHY A RANGE, NOT A NUMBER, FOR TOP-N CARRY-OVER. Rows sharing a tuple are INTERCHANGEABLE —
// nothing in the tuple distinguishes them — and their relative order on the actual Priorities
// page is decided by `problems.compareProblems` (severity, then due date, then age, then id),
// none of which this cube carries. When the Nth slot falls strictly inside a tuple's block of
// rows (or, when several tuples tie on score — routine whenever a share is 0, since every
// differing dimension behind a zero share stops affecting the blend — inside the tied BAND of
// tuples), this cube can say exactly how MANY of that block's rows are above the cut (a pure
// position count, independent of row order) but not WHICH ones — so it cannot say how many of
// THOSE SPECIFIC rows also clear the cut under the other rule. `rankCubeTopN` returns the exact
// achievable range `[lo, hi]` rather than picking a point in it; `lo === hi` — the common case,
// whenever no tuple's band straddles the cut under BOTH rules — collapses to a single honest
// number, never a manufactured average of the two ends.

/** The tuple every rank-model rule this settings page can produce reads a row's score through
 *  — see this section's header for why each component is shaped the way it is. */
export interface RankCubeTuple {
  /** `weightFor(rankKeyOf(row), rule)` at cube-build time — a NUMBER, not a rule id; see the
   *  section header for why that collapse is valid today and what would break it. */
  ruleWeightKey: number;
  /** Ladder index over `overdueDayBuckets`, 0 at "not yet due" through `overdueSteps` at the
   *  ladder's top rung. `null` when the row carries no parseable `dueAt` — UNMEASURED. */
  dueStep: number | null;
  /** Ladder index over `ageDayBuckets`, 0 through `ageSteps`. `null` when the row carries no
   *  parseable `createdAt` — UNMEASURED, independent of whether the due ladder measured. */
  ageStep: number | null;
  /** `"epss"` with no captured peak reads as `"none"` — see the section header. Absent or an
   *  unrecognised tier is `"unmeasured"`, never `"none"`: `rank.exploitationOf`'s own line. */
  exploitationTier: "kev" | "exploit" | "epss" | "none" | "unmeasured";
  /** Meaningful only when `exploitationTier` is `"epss"`; `null` otherwise. 100 bins, the
   *  RiskCube convention, independently implemented — see the section header. */
  epssBin: number | null;
  /** `rank.adjacencyOf`'s own four readings; `"unmeasured"` is absent, never `"UNLINKED"` —
   *  `UNLINKED` is itself a measurement (no known link), not a gap. */
  adjacency: "DIRECT" | "ADJACENT" | "UNLINKED" | "unmeasured";
}

/** 100 bins of 0.01 — matches the EPSS-threshold control's own step and `RiskCube.EPSS_BINS`'s
 *  convention (`gas/src/domain/settingsImpact.ts`), independently implemented (no cross-app
 *  import — see the section header). */
export const RANK_EPSS_BINS = 100;

const RANK_DAY_MS = 86400000;

/** Steps cleared above the floor: identical arithmetic to `rank.ts`'s private `overdueOf` /
 *  `ladderOf` loops, duplicated here (they are not exported) because this cube needs the RAW
 *  index on BOTH the due and the age ladder for every row regardless of which one the row's
 *  OWN `timeSource` happens to read — `rankOne` only ever computes the ladder its rule's
 *  `timeSource` asks for, and the whole point of shipping both is letting the client preview
 *  flipping that toggle without a round trip. Small, stable, and pinned by
 *  `test/settingsImpact.test.ts` against `rankOne`'s own scores, so drift is caught immediately. */
function rankLadderIdx(value: number, buckets: readonly number[]): number {
  let idx = 0;
  for (let i = 0; i < buckets.length; i++) if (value > buckets[i]!) idx = i + 1;
  return idx;
}

function rankClamp01(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** `rank.ts`'s private `weightFor`, duplicated for the same reason `rankLadderIdx` is — it is
 *  not exported, and the cube needs the RAW weight, not a value already blended with a share. */
function rankWeightFor(row: RankInput, rule: RankRule): number {
  for (const rw of rule.ruleWeights ?? []) {
    if (rw && String(rw.ruleId ?? "").trim() === rankKeyOf(row)) return rankClamp01(rw.weight);
  }
  return rankClamp01(rule.defaultRuleWeight);
}

/** The bin an EPSS score falls in — `RiskCube.epssBin`'s own convention and its own epsilon,
 *  independently implemented. */
function rankEpssBinOf(v: number, bins = RANK_EPSS_BINS): number {
  if (v >= 1) return bins;
  return Math.max(0, Math.min(bins - 1, Math.floor(v * bins + 1e-9)));
}

/** The bin cut a threshold falls at — `RiskCube`'s `breakdownFromCube`'s own convention and
 *  its own epsilon, independently implemented. Bins at or above the cut clear the threshold. */
function rankEpssCutOf(threshold: number, bins = RANK_EPSS_BINS): number {
  return Math.max(0, Math.min(bins, Math.ceil(threshold * bins - 1e-9)));
}

/** One row's tuple, read against the rule the cube is being built with. */
export function rankTupleOf(row: RankInput, rule: RankRule, nowIso: string): RankCubeTuple {
  const overdueBuckets = rule.overdueDayBuckets ?? DEFAULT_RANK_RULE.overdueDayBuckets;
  const ageBuckets = rule.ageDayBuckets ?? DEFAULT_RANK_RULE.ageDayBuckets;
  const now = Date.parse(nowIso);

  const due = row.dueAt ? Date.parse(row.dueAt) : NaN;
  const dueStep = Number.isFinite(due) && Number.isFinite(now)
    ? rankLadderIdx((now - due) / RANK_DAY_MS, overdueBuckets)
    : null;

  const created = row.createdAt ? Date.parse(row.createdAt) : NaN;
  const ageStep = Number.isFinite(created) && Number.isFinite(now)
    ? rankLadderIdx((now - created) / RANK_DAY_MS, ageBuckets)
    : null;

  const tier = String(row.exploitationTier ?? "").trim().toLowerCase();
  const peak = typeof row.epssPeak === "number" && Number.isFinite(row.epssPeak)
    ? row.epssPeak
    : null;
  let exploitationTier: RankCubeTuple["exploitationTier"] = "unmeasured";
  let epssBin: number | null = null;
  if (tier === "kev") exploitationTier = "kev";
  else if (tier === "exploit") exploitationTier = "exploit";
  else if (tier === "none") exploitationTier = "none";
  else if (tier === "epss") {
    if (peak !== null) { exploitationTier = "epss"; epssBin = rankEpssBinOf(peak); } else exploitationTier = "none";
  }

  const adjRaw = String(row.aiAdjacency ?? "").trim().toUpperCase();
  const adjacency: RankCubeTuple["adjacency"] =
    adjRaw === "DIRECT" || adjRaw === "ADJACENT" || adjRaw === "UNLINKED"
      ? (adjRaw as "DIRECT" | "ADJACENT" | "UNLINKED")
      : "unmeasured";

  return { ruleWeightKey: rankWeightFor(row, rule), dueStep, ageStep, exploitationTier, epssBin, adjacency };
}

const RANK_EXPL_CODE: Record<RankCubeTuple["exploitationTier"], string> = {
  kev: "k", exploit: "e", epss: "p", none: "n", unmeasured: "u",
};
const RANK_EXPL_DECODE: Record<string, RankCubeTuple["exploitationTier"]> = {
  k: "kev", e: "exploit", p: "epss", n: "none", u: "unmeasured",
};
const RANK_ADJ_CODE: Record<RankCubeTuple["adjacency"], string> = {
  DIRECT: "D", ADJACENT: "A", UNLINKED: "U", unmeasured: "u",
};
const RANK_ADJ_DECODE: Record<string, RankCubeTuple["adjacency"]> = {
  D: "DIRECT", A: "ADJACENT", U: "UNLINKED", u: "unmeasured",
};

/** A tuple as the sparse map's key — compact on purpose, `CacheService` caps one entry at
 *  100 KB and this cube is measured against that ceiling (see `test/settingsImpact.test.ts`). */
export function rankTupleKey(t: RankCubeTuple): string {
  return [
    t.ruleWeightKey.toFixed(4),
    t.dueStep === null ? "x" : t.dueStep,
    t.ageStep === null ? "x" : t.ageStep,
    RANK_EXPL_CODE[t.exploitationTier],
    t.epssBin === null ? "x" : t.epssBin,
    RANK_ADJ_CODE[t.adjacency],
  ].join("|");
}

/** The inverse of `rankTupleKey` — every cell in a `RankCube` decodes back into the tuple that
 *  produced it, which is what lets the client re-price it under a draft rule. */
export function parseRankTupleKey(key: string): RankCubeTuple {
  const parts = key.split("|");
  const due = parts[1];
  const age = parts[2];
  const bin = parts[4];
  return {
    ruleWeightKey: Number(parts[0]),
    dueStep: due === "x" ? null : Number(due),
    ageStep: age === "x" ? null : Number(age),
    exploitationTier: RANK_EXPL_DECODE[parts[3] ?? ""] ?? "unmeasured",
    epssBin: bin === "x" ? null : Number(bin),
    adjacency: RANK_ADJ_DECODE[parts[5] ?? ""] ?? "unmeasured",
  };
}

/** The sparse joint over `RankCubeTuple` — every distinct tuple present in the Priorities
 *  queue, mapped to how many rows carry it. `overdueSteps` / `ageSteps` are the ladder LENGTHS
 *  the tuple's `dueStep` / `ageStep` were computed against (their DENOMINATOR under
 *  `scoreFromTuple`'s arithmetic) — shipped once, rather than per cell, because they are fixed
 *  for the whole cube: this panel does not edit either ladder (see the section header). */
export interface RankCube {
  /** Rows the cube was built from — the Priorities queue's own population. */
  total: number;
  /** Tuple key (`rankTupleKey`) to row count. Sparse: bounded by distinct tuples present. */
  cells: Record<string, number>;
  overdueSteps: number;
  ageSteps: number;
  /** `RANK_EPSS_BINS` at build time — shipped for forward compatibility rather than assumed. */
  epssBins: number;
}

export function buildRankCube(
  rows: ReadonlyArray<RankInput>,
  rule: RankRule,
  nowIso: string,
): RankCube {
  const overdueBuckets = rule.overdueDayBuckets ?? DEFAULT_RANK_RULE.overdueDayBuckets;
  const ageBuckets = rule.ageDayBuckets ?? DEFAULT_RANK_RULE.ageDayBuckets;
  const cells: Record<string, number> = {};
  for (const row of rows) {
    const key = rankTupleKey(rankTupleOf(row, rule, nowIso));
    cells[key] = (cells[key] ?? 0) + 1;
  }
  return {
    total: rows.length,
    cells,
    overdueSteps: overdueBuckets.length,
    ageSteps: ageBuckets.length,
    epssBins: RANK_EPSS_BINS,
  };
}

/** The five knobs this settings panel actually edits (`pages/settings.js`'s `rankField` /
 *  `rankLeaf` wiring) — everything `scoreFromTuple` needs and nothing `RankCubeTuple` already
 *  fixed at cube-build time (`ruleWeights`, `defaultRuleWeight`, both day-bucket ladders). */
export interface RankCubeRule {
  shares: RankShares;
  timeSource: TimeSource;
  exploitationWeights: ExploitationWeights;
  adjacencyWeights: AdjacencyWeights;
  epssThreshold: number;
}

/**
 * A tuple's score under a draft (or saved) rule — the arithmetic `rank.rankOne` performs on one
 * row, reproduced exactly over the tuple's four already-classified readings rather than a raw
 * row, so the client can re-price EVERY row in the queue from ~hundreds of cells instead of
 * re-fetching thousands. Pinned in `test/settingsImpact.test.ts` against `rankOne` itself, over
 * many rules, so a divergence is a test failure rather than a silently wrong histogram.
 */
export function scoreFromTuple(tuple: RankCubeTuple, rule: RankCubeRule, cube: RankCube): number {
  const shares = rule.shares ?? DEFAULT_RANK_RULE.shares;
  const ruleComponent = tuple.ruleWeightKey;

  let timeComponent: number | null = null;
  if (tuple.dueStep !== null) {
    timeComponent = cube.overdueSteps > 0 ? tuple.dueStep / cube.overdueSteps : 0;
  } else if (rule.timeSource === "dueAtElseAge" && tuple.ageStep !== null) {
    timeComponent = cube.ageSteps > 0 ? tuple.ageStep / cube.ageSteps : 0;
  }

  const ew = rule.exploitationWeights ?? DEFAULT_RANK_RULE.exploitationWeights;
  let exploitationComponent: number | null = null;
  if (tuple.exploitationTier === "kev") exploitationComponent = rankClamp01(ew.kev);
  else if (tuple.exploitationTier === "exploit") exploitationComponent = rankClamp01(ew.exploit);
  else if (tuple.exploitationTier === "none") exploitationComponent = rankClamp01(ew.none);
  else if (tuple.exploitationTier === "epss") {
    const cut = rankEpssCutOf(rankClamp01(rule.epssThreshold), cube.epssBins);
    exploitationComponent = tuple.epssBin !== null && tuple.epssBin >= cut
      ? rankClamp01(ew.epss)
      : rankClamp01(ew.none);
  }

  const aw = rule.adjacencyWeights ?? DEFAULT_RANK_RULE.adjacencyWeights;
  let adjacencyComponent: number | null = null;
  if (tuple.adjacency === "DIRECT") adjacencyComponent = rankClamp01(aw.DIRECT);
  else if (tuple.adjacency === "ADJACENT") adjacencyComponent = rankClamp01(aw.ADJACENT);
  else if (tuple.adjacency === "UNLINKED") adjacencyComponent = rankClamp01(aw.UNLINKED);

  // Same shape as rankOne's own loop: a mean of ONE measured term is that term exactly (the
  // only exact form — see rank.ts's own comment on the ULP it avoids), and nothing measured at
  // all falls back to the raw rule component, never a manufactured 0.
  const terms: Array<{ component: number | null; share: number }> = [
    { component: ruleComponent, share: rankClamp01(shares.rule) },
    { component: timeComponent, share: rankClamp01(shares.time) },
    { component: exploitationComponent, share: rankClamp01(shares.exploitation) },
    { component: adjacencyComponent, share: rankClamp01(shares.adjacency) },
  ];
  let numerator = 0;
  let denominator = 0;
  let only: number | null = null;
  let measured = 0;
  for (const term of terms) {
    if (term.component === null || term.share <= 0) continue;
    numerator += term.share * term.component;
    denominator += term.share;
    only = measured === 0 ? term.component : null;
    measured += 1;
  }
  return only !== null ? only : denominator > 0 ? numerator / denominator : ruleComponent;
}

/** The score histogram under one rule — a display bucketing, not a threshold classifier, so a
 *  score of exactly 1.0 folds into the top bucket like every other bucket boundary. */
export function rankScoreHistogram(cube: RankCube, rule: RankCubeRule, buckets = 20): number[] {
  const out = new Array(buckets).fill(0) as number[];
  for (const [key, count] of Object.entries(cube.cells)) {
    if (!count) continue;
    const score = scoreFromTuple(parseRankTupleKey(key), rule, cube);
    const idx = Math.max(0, Math.min(buckets - 1, Math.floor(score * buckets)));
    out[idx]! += count;
  }
  return out;
}

/** Rows whose score moves by more than `threshold` between two rules — the exact per-row
 *  count, read off the cube rather than sampled. */
export function rankRowsMovedBeyond(
  cube: RankCube,
  ruleA: RankCubeRule,
  ruleB: RankCubeRule,
  threshold: number,
): number {
  let moved = 0;
  for (const [key, count] of Object.entries(cube.cells)) {
    if (!count) continue;
    const tuple = parseRankTupleKey(key);
    const a = scoreFromTuple(tuple, ruleA, cube);
    const b = scoreFromTuple(tuple, ruleB, cube);
    if (Math.abs(a - b) > threshold) moved += count;
  }
  return moved;
}

/**
 * Kendall's tau-b between two orderings of the SAME queue, computed over tuples WITH
 * MULTIPLICITY rather than over the fully expanded row list — `rankStats.kendallTauB`'s own
 * O(pairs) formula run over hundreds of tuples instead of thousands of rows, weighted so the
 * answer is EXACT rather than an approximation: every pair of rows sharing one tuple ties on
 * both sides by construction (contributing 0, exactly as `rankStats.tiedPairCount` would find
 * by grouping on value) and is counted through the tie terms `n1`/`n2` rather than walked
 * pairwise, while every pair of rows in two DIFFERENT tuples contributes
 * `count_i * count_j * sign(...)` once for the whole block rather than once per row pair. A
 * tuple whose SCORE coincides with another tuple's (routine whenever a share is 0, since every
 * dimension behind a zero share stops distinguishing tuples) is pooled into that tie count too
 * — grouped by the score VALUE, not by tuple identity, the same discipline
 * `rankStats.tiedPairCount` applies to raw values.
 *
 * `test/settingsImpact.test.ts` pins this against `rankStats.kendallTauB` run on a fully
 * expanded row list, for a fixture small enough to expand — the production path here never
 * expands, which is the entire efficiency argument for shipping a cube instead of every row.
 */
export function rankCubeTauB(cube: RankCube, ruleA: RankCubeRule, ruleB: RankCubeRule): number {
  const groups: Array<{ a: number; b: number; count: number }> = [];
  for (const [key, count] of Object.entries(cube.cells)) {
    if (!count) continue;
    const tuple = parseRankTupleKey(key);
    groups.push({ a: scoreFromTuple(tuple, ruleA, cube), b: scoreFromTuple(tuple, ruleB, cube), count });
  }
  const n = groups.reduce((s, g) => s + g.count, 0);
  if (n < 2) return 0;

  let concordantMinusDiscordant = 0;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const gi = groups[i]!;
      const gj = groups[j]!;
      const sign = Math.sign(gi.a - gj.a) * Math.sign(gi.b - gj.b);
      if (sign !== 0) concordantMinusDiscordant += sign * gi.count * gj.count;
    }
  }

  const n0 = (n * (n - 1)) / 2;
  const tiedWeight = (pick: (g: { a: number; b: number }) => number): number => {
    const byValue = new Map<number, number>();
    for (const g of groups) byValue.set(pick(g), (byValue.get(pick(g)) ?? 0) + g.count);
    let pairs = 0;
    for (const m of byValue.values()) pairs += (m * (m - 1)) / 2;
    return pairs;
  };
  const n1 = tiedWeight((g) => g.a);
  const n2 = tiedWeight((g) => g.b);
  const denom = (n0 - n1) * (n0 - n2);
  if (denom <= 0) return 0;
  return concordantMinusDiscordant / Math.sqrt(denom);
}

interface RankCubeBand {
  score: number;
  count: number;
  keys: string[];
}

/** Tuples grouped by SCORE under one rule, worst (highest score) first — the unit `rankCubeTopN`
 *  walks, because two tuples that tie on score are exactly as interchangeable, for ordering
 *  purposes, as two rows inside one tuple are. */
function rankCubeBands(cube: RankCube, rule: RankCubeRule): RankCubeBand[] {
  const byScore = new Map<number, RankCubeBand>();
  for (const [key, count] of Object.entries(cube.cells)) {
    if (!count) continue;
    const score = scoreFromTuple(parseRankTupleKey(key), rule, cube);
    let band = byScore.get(score);
    if (!band) { band = { score, count: 0, keys: [] }; byScore.set(score, band); }
    band.count += count;
    band.keys.push(key);
  }
  return [...byScore.values()].sort((x, y) => y.score - x.score);
}

/**
 * Per tuple, the RANGE of row counts that could sit within the first `n` overall positions —
 * exact (`lo === hi`) whenever the tuple's band does not straddle slot `n`, a genuine range
 * only when it does. `band.count - tupleCount` is "everything else sharing this tuple's band",
 * which bounds how few of THIS tuple's own rows the straddle could be forced to include.
 */
function rankCubeTupleRanges(
  cube: RankCube,
  rule: RankCubeRule,
  n: number,
): Map<string, { lo: number; hi: number }> {
  const out = new Map<string, { lo: number; hi: number }>();
  let before = 0;
  for (const band of rankCubeBands(cube, rule)) {
    const k = Math.max(0, Math.min(band.count, n - before));
    for (const key of band.keys) {
      const tupleCount = cube.cells[key] ?? 0;
      const lo = Math.max(0, k - (band.count - tupleCount));
      const hi = Math.min(k, tupleCount);
      out.set(key, { lo, hi });
    }
    before += band.count;
  }
  return out;
}

export interface RankCubeTopN {
  n: number;
  /** Rows actually within the top `n` under each rule — `min(n, cube.total)`, the two
   *  denominators the carry-over count is a share of. */
  topA: number;
  topB: number;
  /** The achievable range for "rows in the top `n` under BOTH rules". `lo === hi` unless some
   *  tuple's band straddles slot `n` under BOTH orderings at once — see the section header for
   *  why that case cannot be resolved into one number from this cube alone. */
  carryOver: { lo: number; hi: number };
}

/**
 * The top-N composition question: of the rows in the top `n` under the saved rule, how many
 * are still in the top `n` under the draft — see the section header for why the honest answer
 * is a RANGE whenever a tuple's band straddles slot `n` under both orderings, and a single
 * number (`lo === hi`) otherwise.
 */
export function rankCubeTopN(
  cube: RankCube,
  ruleA: RankCubeRule,
  ruleB: RankCubeRule,
  n: number,
): RankCubeTopN {
  const rangesA = rankCubeTupleRanges(cube, ruleA, n);
  const rangesB = rankCubeTupleRanges(cube, ruleB, n);
  let lo = 0;
  let hi = 0;
  for (const [key, count] of Object.entries(cube.cells)) {
    if (!count) continue;
    const a = rangesA.get(key) ?? { lo: 0, hi: 0 };
    const b = rangesB.get(key) ?? { lo: 0, hi: 0 };
    lo += Math.max(0, a.lo + b.lo - count);
    hi += Math.min(a.hi, b.hi);
  }
  return { n, topA: Math.min(n, cube.total), topB: Math.min(n, cube.total), carryOver: { lo, hi } };
}
