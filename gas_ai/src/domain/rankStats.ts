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
// estate, which is too small to trust a single point estimate from.
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
 * measures how much of the WHOLE estate sits in blocks at all. 0 for N < 2 (no pairs exist).
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
 */
function mulberry32(seed: number): () => number {
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
 * rate) computed on a 30-asset seed estate into an honest claim about how much that number
 * would wobble on a differently-sampled estate the same size, instead of reporting a point
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

/**
 * Midrank (average) percentile: each value's position in `values`, 0–100, sorted ascending.
 * Exists because AARS's absolute bands have no population-independent meaning — the same
 * rule put 100% of the demo estate in CRITICAL and 97.58% of a live estate in INFO. A
 * percentile is comparable ACROSS populations the way an absolute band never can be.
 *
 * TIES ARE THE WHOLE REASON THIS IS ITS OWN FUNCTION rather than a one-line sort-and-index.
 * `tieRate` above measures how often this matters: 0.30 on the seed estate, meaning nearly a
 * third of asset pairs share a score. Assigning those tied assets DIFFERENT percentiles —
 * whatever a stable sort happened to do with the tie — would manufacture an ordering this
 * model does not have and cannot defend if asked which of the two came first. Midrank is the
 * standard fix (equivalent to `scipy.stats.percentileofscore(..., kind="mean")`, and to
 * `rankdata(..., method="average")` rescaled to 0–100): every member of a tied block is
 * assigned the block's MIDRANK — the average of the 1-indexed ranks the block spans — so
 * ties share one value rather than being arbitrarily broken.
 *
 * Formula, for a tie block occupying 1-indexed ranks [a, b] (b === a for an untied value):
 *   midrank   = (a + b) / 2
 *   percentile = (midrank − 0.5) / N × 100
 * The −0.5 centers each value in the slice of the 0–100 scale its rank owns, rather than
 * anchoring it to the slice's upper edge — this is what keeps a single value from reading as
 * either the 0th or the 100th percentile of itself (see the single-value case below) and
 * what makes the formula agree with `percentileofscore`'s "mean" convention exactly:
 * (countBelow + countBelowOrEqual) / (2N) × 100 reduces to the same expression once
 * countBelow and countBelowOrEqual are rewritten as the tie block's rank span.
 *
 * Identity cases this reduces to, all provable from the formula above rather than special-
 * cased in the code:
 *   - Empty list: returns [] — there is no population to rank anything against.
 *   - Single value: the only "tie block" spans rank [1, 1], midrank 1, percentile
 *     (1 − 0.5)/1 × 100 = 50 — the sole reasonable answer when there is nothing to compare
 *     against, and the same 50 a fully-tied list of any size reduces to below.
 *   - All tied: one block spanning [1, N], midrank (N+1)/2, percentile
 *     ((N+1)/2 − 0.5)/N × 100 = 50 for every N — indistinguishable assets get the
 *     distribution's exact middle, never an arbitrary spread.
 *   - Clean (all-distinct) ordering of N values: ranks are untied, so this reduces to the
 *     familiar (rank − 0.5)/N × 100 percentile-rank ladder, e.g. N=4 → 12.5/37.5/62.5/87.5.
 *
 * Pure and AARS-free like every other export in this file — see the file header. Returns
 * percentiles in the SAME ORDER as `values`, not sorted, so a caller can zip the result back
 * onto whatever else is indexed the same way (asset ids, node references) without carrying
 * a second array of original positions.
 */
export function midrankPercentiles(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];

  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  const percentiles = new Array<number>(n);

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]!] === values[order[i]!]) j++;
    // Tie block spans sorted positions [i, j] (0-indexed) — 1-indexed ranks [i+1, j+1].
    const midrank = (i + 1 + (j + 1)) / 2;
    const percentile = ((midrank - 0.5) / n) * 100;
    for (let k = i; k <= j; k++) percentiles[order[k]!] = percentile;
    i = j + 1;
  }

  return percentiles;
}
