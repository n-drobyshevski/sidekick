// Rank-agreement and distribution statistics, existing for one reason: ai/AARS_ASSESSMENT.md
// §2 says the AARS score "collapses" on live data — fifteen assets tied at 72, every scored
// agent CRITICAL — but that claim was prose, backed by eyeballing a sorted list. Prose does
// not survive a rule change: the next tuning pass needs a NUMBER that says whether the new
// cascade discriminates better or worse than the old one, and a number that can be asserted
// in a test rather than re-read by a human every time.
//
// So: kendallTauB says whether a re-encoding of the inputs preserved the OUTPUT ranking (the
// question §2's "cross-pillar addition" concern turns on); tieRate and effectiveCardinality
// give the "collapses" claim a magnitude instead of an adjective; cohensKappa is the same
// question one step removed — do two SEVERITY BANDINGS agree, not just two raw scores; and
// bootstrapCI puts an honest error bar on any of the above computed from a 30-asset seed
// landscape, which is too small to trust a single point estimate from.
//
// Independently testable on purpose: no import from aars.ts, no Google Apps Script global.
// These are statistics about a list of numbers, not about AARS, and must stay reusable the
// day something other than a score needs a discrimination measurement.

import { quantile } from "./util";

/**
 * Kendall's tau-b — rank correlation between two equal-length lists, corrected for ties in
 * EITHER list. Plain tau (tau-a) treats a tied pair as discordant, which understates
 * agreement whenever the scale is coarse (a 0–100 score collapsed onto 5 distinct values is
 * exactly this scale); tau-b instead removes tied pairs from both the numerator and the
 * denominator, so a rule that intentionally groups equal-risk assets into one band is not
 * penalized for grouping them.
 *
 * tau_b = (C - D) / sqrt((n0 - n1) * (n0 - n2))
 *   n0 = n(n-1)/2                    — all pairs
 *   n1 = Σ t_i(t_i-1)/2 over ties in `a`
 *   n2 = Σ t_j(t_j-1)/2 over ties in `b`
 *   C - D = Σ over pairs of sign(a_i-a_j)·sign(b_i-b_j) — this single sum IS concordant
 *           minus discordant, because the product is +1 when both differences agree in
 *           sign, -1 when they disagree, and 0 whenever either list is tied on that pair.
 *
 * Returns 0 when either denominator factor is 0 — i.e. one of the lists is entirely tied,
 * so there is no ranking in it to compare against the other. Throws on length mismatch
 * rather than silently truncating, because a silently-shortened comparison would still
 * produce a number and that number would be about the wrong pairs.
 */
export function kendallTauB(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`kendallTauB: length mismatch (${a.length} vs ${b.length})`);
  }
  const n = a.length;
  let concordantMinusDiscordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      concordantMinusDiscordant += Math.sign(a[i]! - a[j]!) * Math.sign(b[i]! - b[j]!);
    }
  }
  const n0 = (n * (n - 1)) / 2;
  const n1 = tiedPairCount(a);
  const n2 = tiedPairCount(b);
  const denom = (n0 - n1) * (n0 - n2);
  if (denom <= 0) return 0;
  return concordantMinusDiscordant / Math.sqrt(denom);
}

/** Pairs sharing a value, summed over the distinct-value groups — the n1/n2 term above. */
function tiedPairCount(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let pairs = 0;
  for (const c of counts.values()) pairs += (c * (c - 1)) / 2;
  return pairs;
}

/**
 * Share of PAIRS a model cannot separate: Σ C(n_k,2) / C(N,2) over the distinct-value
 * groups. 1.0 means every pair shares a value — the model ranks nothing; 0 means every
 * value is unique — the model separates every pair. This is the pair-counting twin of
 * `largestTieGroup` in aarsRule.ts: that field names the single worst block, this one
 * measures how much of the WHOLE landscape sits in blocks at all. 0 for N < 2 (no pairs exist).
 */
export function tieRate(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  return tiedPairCount(values) / ((n * (n - 1)) / 2);
}

/**
 * exp(Shannon entropy), in nats: how many distinct values the list BEHAVES as if it has,
 * as opposed to how many it literally has. `distinctScores` in aarsRule.ts counts values;
 * this weights each value by how many assets take it, so a scale of {30: 1 asset, 72: 19
 * assets} reads as barely more than one effective value rather than two — one outlier score
 * does not get to claim the same discrimination credit as an even split does.
 *
 * H = -Σ p_k ln p_k over the value groups; effective cardinality is exp(H). A constant list
 * has one group at p=1, so H=0 and the result is 1.0. A list of N all-distinct values has N
 * groups at p=1/N each, so H=ln(N) and the result is exactly N — the two ends the doc-comment
 * promises. 0 for an empty list, where there is no distribution to measure.
 */
export function effectiveCardinality(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / n;
    entropy += -p * Math.log(p);
  }
  return Math.exp(entropy);
}

/**
 * Where each value sits in its own list, as a percentile of the whole — the statistic that
 * replaces the AARS BAND wherever a surface used to present a band as a decision.
 *
 * WHY THIS EXISTS AT ALL. `ai/AARS_SCORING_ASSESSMENT.md` §3 measured what the bands do on
 * live data: 19 of 30 scored assets land CRITICAL, HIGH and MEDIUM are both empty, tieRate
 * is 0.30 and effectiveCardinality 3.67 against 5 distinct scores. A band holding the
 * entire working population names no action and cuts no queue. A percentile makes the same
 * score say the only thing it can honestly say — where this asset sits relative to the rest
 * of the landscape — and says it against a denominator the caller has to publish.
 *
 * MIDRANK, NOT CDF, AND THE CHOICE IS THE POINT. The obvious form, `(below + equal) / N`,
 * puts every member of a tie block at the block's TOP: the 14 seed assets tied at 72 would
 * all read as the 87th percentile, which is a claim that they beat the 8 assets above
 * them — they do not, they are tied with each other and below those 8. The midrank form,
 * `(below + equal/2) / N`, puts the whole block at its own middle (those 14 read 60), so a
 * tie block gets ONE shared percentile that is honest about being a block. Using the CDF
 * form here would reintroduce exactly the false ordering this statistic was added to stop.
 *
 * Returns exact, unrounded percentages in the input's own index order, never sorted — a
 * caller zipping these back onto values by position must be able to trust the alignment.
 * Rounding is the caller's decision and belongs where the population size is known.
 *
 * NO PRODUCTION CALLER TODAY. `syncStore.withAarsPercentile` was one, and went when the
 * asset surfaces that led with a percentile stopped reading any derived verdict. It stays
 * because this module is the measurement instrument the audit in ai/AARS_SCORING_ASSESSMENT.md
 * is built on, and `kendallTauB`, `cohensKappa` and `bootstrapCI` beside it have only ever
 * had test callers — the ordinality suites are consumers, not scaffolding.
 *
 * A constant list gives every entry 50 — one block spanning the whole landscape, centred.
 * That is the correct reading of "this model separates nothing", and it is the same
 * message `tieRate` returns 1.0 for.
 */
export function midrankPercentiles(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // One pass up the distinct values accumulates each block's `below` count, so the
  // per-value percentile is computed once per BLOCK rather than once per element — and
  // every member of a block therefore reads back a bit-identical number, which is the
  // property the whole doc-comment above turns on.
  const percentileOf = new Map<number, number>();
  let below = 0;
  for (const value of [...counts.keys()].sort((a, b) => a - b)) {
    const size = counts.get(value)!;
    percentileOf.set(value, ((below + size / 2) / n) * 100);
    below += size;
  }
  return values.map((v) => percentileOf.get(v)!);
}

/**
 * Cohen's kappa — chance-corrected agreement between two equal-length CATEGORICAL codings
 * over the same items, e.g. the severity band two rules assign the same asset. Plain percent
 * agreement (po) is inflated by however skewed the category is (if 90% of assets are
 * CRITICAL under both rules, po is ≥0.81 from base rate alone); kappa subtracts the
 * agreement two random labelings would produce by chance (pe) and rescales what is left, so
 * 0 means "no better than chance" and 1 means "perfect".
 *
 * kappa = (po - pe) / (1 - pe), po = observed agreement rate, pe = Σ over `categories` of
 * (a's marginal share of that category) × (b's marginal share of that category).
 *
 * Returns 1 when pe === 1 — every item lands in one category under both codings, so there
 * is no disagreement chance COULD produce and the ordinary formula would divide by zero.
 */
export function cohensKappa(a: string[], b: string[], categories: string[]): number {
  if (a.length !== b.length) {
    throw new Error(`cohensKappa: length mismatch (${a.length} vs ${b.length})`);
  }
  const n = a.length;
  if (n === 0) return 1;

  let matches = 0;
  const countsA = new Map<string, number>();
  const countsB = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) matches++;
    countsA.set(a[i]!, (countsA.get(a[i]!) ?? 0) + 1);
    countsB.set(b[i]!, (countsB.get(b[i]!) ?? 0) + 1);
  }
  const po = matches / n;

  let pe = 0;
  for (const cat of categories) {
    pe += ((countsA.get(cat) ?? 0) / n) * ((countsB.get(cat) ?? 0) / n);
  }
  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

/**
 * mulberry32 — a 32-bit deterministic PRNG, seeded by a single integer. `Math.random()` is
 * FORBIDDEN in this codebase (see the header of `src/server/sampleData.ts`: it breaks
 * reproducibility, and a bootstrap CI that changes on every run is worse than no CI, because
 * it looks precise). mulberry32 is chosen over a linear-congruential generator for the same
 * reason sampleData picks its own generator conventions — a short, auditable core with no
 * dependency — and it passes the usual small-crush suites well enough for a resampling
 * interval, which needs "well distributed", not cryptographic.
 *
 * EXPORTED, because `bootstrapCI` is no longer the only caller that needs a reproducible
 * stream: `rankEval.ts`'s random baseline draws one per (sync, draw), and a second generator
 * beside this one would be a second definition of "seeded" for the same report.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap: resample `values` with replacement `samples` times, compute `stat`
 * on each resample, and return the 2.5th/97.5th percentiles of that distribution as a 95%
 * confidence interval. This is what turns a single discrimination number (a tau-b, a tie
 * rate) computed on a 30-asset seed landscape into an honest claim about how much that number
 * would wobble on a differently-sampled landscape the same size, instead of reporting a point
 * estimate as if it were exact.
 *
 * Seeded and deterministic — the whole point of using mulberry32 above instead of
 * `Math.random()` — so the same (values, stat, samples, seed) always returns the same
 * {lo, hi}. That determinism IS the contract this function exists to keep: a bootstrap CI
 * that cannot be reproduced cannot be pinned in a test, and an unpinned statistic in this
 * codebase is one nobody will notice silently drifting.
 */
export function bootstrapCI<T>(
  values: T[],
  stat: (sample: T[]) => number,
  samples: number,
  seed: number,
): { lo: number; hi: number } {
  const n = values.length;
  const rng = mulberry32(seed);
  const stats: number[] = [];
  for (let s = 0; s < samples; s++) {
    const resample: T[] = new Array(n);
    for (let i = 0; i < n; i++) {
      resample[i] = values[Math.floor(rng() * n)]!;
    }
    stats.push(stat(resample));
  }
  return {
    lo: quantile(stats, 0.025)!,
    hi: quantile(stats, 0.975)!,
  };
}

