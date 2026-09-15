// Reading the P11 rank cube in the browser — the client half of `domain/settingsImpact.ts`'s
// "P11: rank cube" section. Read THAT header first: the tuple, why `ruleWeightKey` is a WEIGHT
// NUMBER rather than a rule id (and what breaks that), and why top-N carry-over is a RANGE.
//
// This file only ever READS a cube the server already built (`buildRankCube` stays server-side
// — the client never builds one, same split `categoryCubeModel.js` keeps with `buildCategoryCube`).
// It is a deliberate second implementation, in JS, because the client cannot import the
// TypeScript domain layer; test/rankCubeModel.test.js pins every function here against its TS
// twin over the same cubes, the same way gas/test/riskCube.test.js pins its sibling.
//
// EVERYTHING DEGRADES ON AN ABSENT OR MALFORMED CUBE. `pages/settings.js` calls these only
// after `impact.rankCube` resolves, but every function here is also defensive on its own terms
// — a missing/empty cube reads as "nothing to say" (0 rows, an all-zero histogram, `null` tau,
// a zero-width carry-over), never a thrown exception and never a guessed number.

/** True 0..1 clamp, mirroring the TS domain's `rankClamp01` — refuses non-finite input to 0
 *  rather than propagating a NaN into a blend. */
function clamp01(v) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

const EXPL_DECODE = { k: "kev", e: "exploit", p: "epss", n: "none", u: "unmeasured" };
const ADJ_DECODE = { D: "DIRECT", A: "ADJACENT", U: "UNLINKED", u: "unmeasured" };

/** The inverse of the TS domain's `rankTupleKey` — see that function's own header for the
 *  field order this depends on. */
export function parseRankTupleKey(key) {
  const parts = String(key).split("|");
  const due = parts[1];
  const age = parts[2];
  const bin = parts[4];
  return {
    ruleWeightKey: Number(parts[0]),
    dueStep: due === "x" ? null : Number(due),
    ageStep: age === "x" ? null : Number(age),
    exploitationTier: EXPL_DECODE[parts[3]] || "unmeasured",
    epssBin: bin === "x" ? null : Number(bin),
    adjacency: ADJ_DECODE[parts[5]] || "unmeasured",
  };
}

/** The bin cut a threshold falls at — `RiskCube`/`settingsImpact.ts`'s own convention and its
 *  own epsilon, independently implemented (see this file's header on why there are two). */
function epssCutOf(threshold, bins) {
  return Math.max(0, Math.min(bins, Math.ceil(threshold * bins - 1e-9)));
}

/**
 * A tuple's score under a draft (or saved) rule — `rank.rankOne`'s own arithmetic, reproduced
 * exactly over a tuple's four already-classified readings. Mirrors
 * `settingsImpact.scoreFromTuple`; test/rankCubeModel.test.js pins the two.
 */
export function scoreFromTuple(tuple, rule, cube) {
  const r = rule || {};
  const shares = r.shares || {};
  const ruleComponent = tuple.ruleWeightKey;

  let timeComponent = null;
  if (tuple.dueStep !== null) {
    timeComponent = cube.overdueSteps > 0 ? tuple.dueStep / cube.overdueSteps : 0;
  } else if (r.timeSource === "dueAtElseAge" && tuple.ageStep !== null) {
    timeComponent = cube.ageSteps > 0 ? tuple.ageStep / cube.ageSteps : 0;
  }

  const ew = r.exploitationWeights || {};
  let exploitationComponent = null;
  if (tuple.exploitationTier === "kev") exploitationComponent = clamp01(ew.kev);
  else if (tuple.exploitationTier === "exploit") exploitationComponent = clamp01(ew.exploit);
  else if (tuple.exploitationTier === "none") exploitationComponent = clamp01(ew.none);
  else if (tuple.exploitationTier === "epss") {
    const cut = epssCutOf(clamp01(r.epssThreshold), cube.epssBins);
    exploitationComponent = tuple.epssBin !== null && tuple.epssBin >= cut
      ? clamp01(ew.epss)
      : clamp01(ew.none);
  }

  const aw = r.adjacencyWeights || {};
  let adjacencyComponent = null;
  if (tuple.adjacency === "DIRECT") adjacencyComponent = clamp01(aw.DIRECT);
  else if (tuple.adjacency === "ADJACENT") adjacencyComponent = clamp01(aw.ADJACENT);
  else if (tuple.adjacency === "UNLINKED") adjacencyComponent = clamp01(aw.UNLINKED);

  const terms = [
    { component: ruleComponent, share: clamp01(shares.rule) },
    { component: timeComponent, share: clamp01(shares.time) },
    { component: exploitationComponent, share: clamp01(shares.exploitation) },
    { component: adjacencyComponent, share: clamp01(shares.adjacency) },
  ];
  let numerator = 0;
  let denominator = 0;
  let only = null;
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

/** `[{key, count, tuple}]` for every populated cell — the shared first step every reader below
 *  takes, so a malformed cube is refused in exactly one place. */
function cellsOf(cube) {
  if (!cube || !cube.cells || typeof cube.cells !== "object") return [];
  const out = [];
  for (const key of Object.keys(cube.cells)) {
    const count = cube.cells[key];
    if (!count) continue;
    out.push({ key, count, tuple: parseRankTupleKey(key) });
  }
  return out;
}

/** The score histogram under one rule. `[]` (never an array of zeros presented as a real
 *  reading) when the cube never arrived. */
export function rankScoreHistogram(cube, rule, buckets = 20) {
  const cells = cellsOf(cube);
  if (!cells.length && !(cube && cube.total === 0)) return [];
  const out = new Array(buckets).fill(0);
  for (const c of cells) {
    const score = scoreFromTuple(c.tuple, rule, cube);
    const idx = Math.max(0, Math.min(buckets - 1, Math.floor(score * buckets)));
    out[idx] += c.count;
  }
  return out;
}

/** Rows whose score moves by more than `threshold` between two rules. `null` when the cube
 *  never arrived — not 0, which would read as "measured, and nothing moved". */
export function rankRowsMovedBeyond(cube, ruleA, ruleB, threshold) {
  if (!cube || !cube.cells) return null;
  let moved = 0;
  for (const c of cellsOf(cube)) {
    const a = scoreFromTuple(c.tuple, ruleA, cube);
    const b = scoreFromTuple(c.tuple, ruleB, cube);
    if (Math.abs(a - b) > threshold) moved += c.count;
  }
  return moved;
}

/**
 * Kendall's tau-b between two orderings of the same queue, over tuples WITH MULTIPLICITY —
 * mirrors `settingsImpact.rankCubeTauB`; see that function's own header for the weighted
 * formula and why it is exact rather than an approximation. `null` on an absent cube.
 */
export function rankCubeTauB(cube, ruleA, ruleB) {
  if (!cube || !cube.cells) return null;
  const groups = cellsOf(cube).map((c) => ({
    a: scoreFromTuple(c.tuple, ruleA, cube),
    b: scoreFromTuple(c.tuple, ruleB, cube),
    count: c.count,
  }));
  const n = groups.reduce((s, g) => s + g.count, 0);
  if (n < 2) return 0;

  let concordantMinusDiscordant = 0;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const gi = groups[i];
      const gj = groups[j];
      const sign = Math.sign(gi.a - gj.a) * Math.sign(gi.b - gj.b);
      if (sign !== 0) concordantMinusDiscordant += sign * gi.count * gj.count;
    }
  }

  const n0 = (n * (n - 1)) / 2;
  const tiedWeight = (pick) => {
    const byValue = new Map();
    for (const g of groups) {
      const v = pick(g);
      byValue.set(v, (byValue.get(v) || 0) + g.count);
    }
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

/** Tuples grouped by SCORE under one rule, worst (highest score) first. */
function bandsOf(cube, rule) {
  const byScore = new Map();
  for (const c of cellsOf(cube)) {
    const score = scoreFromTuple(c.tuple, rule, cube);
    let band = byScore.get(score);
    if (!band) { band = { score, count: 0, keys: [] }; byScore.set(score, band); }
    band.count += c.count;
    band.keys.push(c.key);
  }
  return [...byScore.values()].sort((x, y) => y.score - x.score);
}

/** Per tuple key, the [lo, hi] row-count range within the first `n` overall positions — see
 *  settingsImpact.ts's own `rankCubeTupleRanges` for the derivation. */
function tupleRanges(cube, rule, n) {
  const out = new Map();
  let before = 0;
  for (const band of bandsOf(cube, rule)) {
    const k = Math.max(0, Math.min(band.count, n - before));
    for (const key of band.keys) {
      const tupleCount = cube.cells[key] || 0;
      const lo = Math.max(0, k - (band.count - tupleCount));
      const hi = Math.min(k, tupleCount);
      out.set(key, { lo, hi });
    }
    before += band.count;
  }
  return out;
}

/**
 * The top-N carry-over: of the rows in the top `n` under `ruleA`, how many are still in the
 * top `n` under `ruleB`. Mirrors `settingsImpact.rankCubeTopN`. `null` on an absent cube —
 * this file draws no honesty line the TS domain did not already draw; see this file's header.
 */
export function rankCubeTopN(cube, ruleA, ruleB, n) {
  if (!cube || !cube.cells) return null;
  const rangesA = tupleRanges(cube, ruleA, n);
  const rangesB = tupleRanges(cube, ruleB, n);
  let lo = 0;
  let hi = 0;
  for (const c of cellsOf(cube)) {
    const a = rangesA.get(c.key) || { lo: 0, hi: 0 };
    const b = rangesB.get(c.key) || { lo: 0, hi: 0 };
    lo += Math.max(0, a.lo + b.lo - c.count);
    hi += Math.min(a.hi, b.hi);
  }
  return { n, topA: Math.min(n, cube.total || 0), topB: Math.min(n, cube.total || 0), carryOver: { lo, hi } };
}
