// Reading the register-scope category cube in the browser.
//
// The server sends the joint distribution of "which candidate categories stamp this open
// issue" once — see src/domain/settingsImpact.ts for why a joint and not six marginals — and
// this re-aggregates it locally so the register-scope picker's figures move as an operator
// checks and unchecks a candidate, without a round trip per click.
//
// This is a deliberate second implementation of categoryUnionCount / categoryMarginalCount /
// categoryDroppedOnlyCount / categoryScopeImpact, in JS, because the client cannot import the
// TypeScript domain layer. test/categoryCubeModel.test.js pins this file against
// src/domain/settingsImpact.ts over the same cubes, the same way gas/test/riskCube.test.js
// pins its sibling.
//
// UNMEASURED IS NOT THIS FILE'S JOB TO GUESS. `cube.measuredCandidateIds` says which
// candidates the cube can answer for; every function here still returns a NUMBER for an id
// outside that list (0, if no row happens to carry that stamp), because the cube has no way
// to refuse mid-arithmetic. A caller that wants to grey out or footnote a candidate the
// register has never collected has to check `measuredCandidateIds` itself, same as the TS
// domain's own callers do — this file draws no honesty line neither of them promised to draw.

/**
 * Open issues stamped with at least one of `selectedIdx` (candidate bit indices) — the union
 * count a marginal cannot give, because a row stamped with two selected candidates must count
 * once, not twice.
 */
export function categoryUnionCount(cube, selectedIdx) {
  let bits = 0;
  for (const i of selectedIdx) bits |= 1 << i;
  if (!cube || !cube.cells || !bits) return 0;
  let sum = 0;
  for (const key of Object.keys(cube.cells)) {
    if (Number(key) & bits) sum += cube.cells[key];
  }
  return sum;
}

/** Open issues stamped with one candidate — the marginal, the union of a single bit. */
export function categoryMarginalCount(cube, idx) {
  return categoryUnionCount(cube, [idx]);
}

/**
 * Open issues stamped with at least one of `droppedIdx` and none of `keptIdx` — "stamped only
 * with categories the draft removes". Mirrors settingsImpact.categoryDroppedOnlyCount exactly;
 * test/categoryCubeModel.test.js pins the two together.
 */
export function categoryDroppedOnlyCount(cube, keptIdx, droppedIdx) {
  let keptBits = 0;
  for (const i of keptIdx) keptBits |= 1 << i;
  let droppedBits = 0;
  for (const i of droppedIdx) droppedBits |= 1 << i;
  if (!cube || !cube.cells) return 0;
  let sum = 0;
  for (const key of Object.keys(cube.cells)) {
    const mask = Number(key);
    if ((mask & keptBits) === 0 && (mask & droppedBits) !== 0) sum += cube.cells[key];
  }
  return sum;
}

/**
 * The three figures the register-scope picker needs, computed together so a caller cannot
 * reach for one and forget the other two exist — the same shape
 * settingsImpact.categoryScopeImpact returns from the TS side.
 *
 * `selectedIds` / `previousIds` are category ids (the picker's own vocabulary), translated to
 * bit indices against `cube.candidateIds` here so neither caller nor test has to track bit
 * positions by hand.
 */
export function categoryScopeImpact(cube, selectedIds, previousIds) {
  const empty = { inScopeOpen: 0, perCategory: {}, droppedOnlyOpen: 0 };
  if (!cube || !cube.cells || !cube.candidateIds) return empty;
  const prev = previousIds === undefined ? selectedIds : previousIds;
  const idxOf = (id) => cube.candidateIds.indexOf(id);
  const selectedIdx = selectedIds.map(idxOf).filter((i) => i >= 0);
  const previousIdx = prev.map(idxOf).filter((i) => i >= 0);
  const droppedIdx = previousIdx.filter((i) => selectedIdx.indexOf(i) < 0);
  const perCategory = {};
  cube.candidateIds.forEach((id, i) => {
    perCategory[id] = categoryMarginalCount(cube, i);
  });
  return {
    inScopeOpen: categoryUnionCount(cube, selectedIdx),
    perCategory,
    droppedOnlyOpen: categoryDroppedOnlyCount(cube, selectedIdx, droppedIdx),
  };
}
