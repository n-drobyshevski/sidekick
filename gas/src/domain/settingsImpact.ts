// What the Settings page needs in order to state, beside each control, what that control is
// currently doing to the register.
//
// THE PROBLEM THIS SOLVES. The high-risk classifier's readout has to move as you drag the EPSS
// threshold — a figure that appears only after you save is not decision support, it is a
// receipt. Recomputing per keystroke means either shipping every base row to the browser
// (thousands of rows over google.script.run, per page load) or shipping something small the
// client can re-aggregate itself.
//
// So this builds a CUBE: the joint distribution of (has_kev x has_exploit x EPSS bin). The
// marginals alone would not do — `anyOf` is a UNION over the enabled clauses, and a union
// cannot be recovered from marginal counts. The joint can answer every question the classifier
// card asks, at any threshold and for any subset of enabled clauses, from ~900 integers.
//
// Both flag axes are TRI-state on purpose. `null` means the signal was never captured, which is
// not the same as an observed false: a row whose EPSS was never measured is unclassified, not
// clean. Collapsing that to `false` is exactly the mistake program.ts is written to avoid, and
// the cube would launder it if it kept only two states. See `classifyRisk` there.
//
// The client half that reads this lives in src/client/js/riskCube.js — plain JS, because the
// client cannot import TypeScript. test/settingsImpact.test.ts pins the two against
// program.signalBreakdown so they cannot drift apart.

import type { RiskRule, SignalBreakdown } from "./program";

/** Observed true, observed false, or never captured. */
export type Tri = "t" | "f" | "n";

/**
 * EPSS bin count. 100 bins of 0.01 — finer than any threshold the control can produce.
 *
 * Every cell's `epss` array is `EPSS_BINS + 1` long. Bin i (< EPSS_BINS) covers
 * [i/100, (i+1)/100); the extra top bin holds scores of exactly 1.0. That bin is not padding:
 * without it, a score of 1.0 has to be clamped into the [0.99, 1.00) bin, and a threshold of
 * 1.00 then counts zero rows when it should count precisely those. `>=` has to mean `>=` at
 * both ends of the range.
 */
export const EPSS_BINS = 100;

export interface RiskCell {
  /**
   * `epss[i]` counts rows whose EPSS falls in bin i, for i in [0, bins]; the final index is
   * the exactly-1.0 bin. `noEpss` counts rows whose EPSS was never captured.
   */
  epss: number[];
  noEpss: number;
}

export interface RiskCube {
  total: number;
  bins: number;
  /** Keyed `${kev}${exploit}` over Tri x Tri — nine cells, all present, most usually zero. */
  cells: Record<string, RiskCell>;
}

export type RiskCubeRow = {
  has_kev: boolean | null;
  has_exploit: boolean | null;
  epss: number | null;
};

function tri(v: boolean | null | undefined): Tri {
  if (v === true) return "t";
  if (v === false) return "f";
  return "n";
}

/**
 * The bin an EPSS score falls in. 1.0 lands in the last bin rather than off the end, and a
 * non-finite score is treated as never captured — same test `firedSignals` uses, so a NaN
 * cannot fire a clause here and fail to fire one there.
 */
export function epssBin(v: number, bins = EPSS_BINS): number {
  // A perfect score gets the dedicated top bin, so a threshold of 1.00 can still find it.
  if (v >= 1) return bins;
  // The epsilon pairs with the one in breakdownFromCube's cut, and both are load-bearing.
  // `0.29 * 100` is 28.999999999999996, so a bare floor() put a row scoring exactly 0.29 into
  // bin 28 while the cut for a 0.29 threshold started at bin 29 — the row was dropped from a
  // count it defines. Nudging both by far less than a bin makes the two agree on every edge.
  return Math.max(0, Math.min(bins - 1, Math.floor(v * bins + 1e-9)));
}

export function emptyCube(bins = EPSS_BINS): RiskCube {
  const cells: Record<string, RiskCell> = {};
  for (const k of ["t", "f", "n"] as Tri[]) {
    for (const x of ["t", "f", "n"] as Tri[]) {
      cells[`${k}${x}`] = { epss: new Array(bins + 1).fill(0), noEpss: 0 };
    }
  }
  return { total: 0, bins, cells };
}

export function buildRiskCube(rows: RiskCubeRow[], bins = EPSS_BINS): RiskCube {
  const cube = emptyCube(bins);
  for (const r of rows) {
    const cell = cube.cells[`${tri(r.has_kev)}${tri(r.has_exploit)}`]!;
    if (typeof r.epss === "number" && Number.isFinite(r.epss)) cell.epss[epssBin(r.epss, bins)]! += 1;
    else cell.noEpss += 1;
    cube.total += 1;
  }
  return cube;
}

/**
 * Re-derive `signalBreakdown` from the cube alone. This is the function the client mirrors in
 * JS; keeping a TypeScript copy here is what lets the test assert cube-vs-rows equality against
 * program.signalBreakdown over the same population.
 *
 * A threshold is `>=`, matching `firedSignals`. Because bin i covers [i/bins, (i+1)/bins), a
 * threshold falling inside a bin would over-count that bin — so the cut is taken at
 * `ceil(t * bins)`, i.e. only bins entirely at or above the threshold count. That makes the
 * readout conservative at sub-bin precision rather than optimistic, and exact on any threshold
 * that lands on a bin edge (every 0.01 step, which is what the control offers).
 */
export function breakdownFromCube(cube: RiskCube, rule: RiskRule): SignalBreakdown {
  const out: SignalBreakdown = {
    kev: 0, exploit: 0, epss: 0, anyOf: 0,
    kevMissing: 0, exploitMissing: 0, epssMissing: 0,
  };
  // The epsilon is not decoration: 0.07 * 100 is 7.000000000000001 in binary floating point,
  // and a bare ceil() would push the cut a whole bin too high and silently drop every row
  // between 0.07 and 0.08 from the count. Nudging down by far less than a bin fixes the
  // representation error without disturbing a genuinely mid-bin threshold.
  const cut = Math.max(0, Math.min(cube.bins, Math.ceil(rule.epssThreshold * cube.bins - 1e-9)));
  for (const [key, cell] of Object.entries(cube.cells)) {
    const k = key[0] as Tri;
    const x = key[1] as Tri;
    const kevFires = rule.kev && k === "t";
    const exploitFires = rule.exploit && x === "t";
    const cellTotal = cell.noEpss + cell.epss.reduce((a, b) => a + b, 0);
    if (!cellTotal) continue;

    if (kevFires) out.kev += cellTotal;
    if (exploitFires) out.exploit += cellTotal;
    if (rule.kev && k === "n") out.kevMissing += cellTotal;
    if (rule.exploit && x === "n") out.exploitMissing += cellTotal;
    if (rule.epss) out.epssMissing += cell.noEpss;

    let epssHits = 0;
    if (rule.epss) for (let i = cut; i <= cube.bins; i++) epssHits += cell.epss[i]!;
    out.epss += epssHits;

    // The union. A row already fired by KEV or exploit is counted once, whatever EPSS says.
    if (kevFires || exploitFires) out.anyOf += cellTotal;
    else out.anyOf += epssHits;
  }
  return out;
}

/** EPSS bins collapsed to a coarser display histogram, plus the never-captured tail. */
export function epssHistogram(cube: RiskCube, buckets = 20): { buckets: number[]; unmeasured: number } {
  const out = new Array(buckets).fill(0);
  let unmeasured = 0;
  const per = cube.bins / buckets;
  for (const cell of Object.values(cube.cells)) {
    unmeasured += cell.noEpss;
    // <= bins: the exactly-1.0 bin folds into the top display bucket, where it belongs.
    for (let i = 0; i <= cube.bins; i++) {
      if (cell.epss[i]) out[Math.min(buckets - 1, Math.floor(i / per))]! += cell.epss[i]!;
    }
  }
  return { buckets: out, unmeasured };
}

/**
 * What each display toggle currently removes from the register. Deliberately measured over the
 * UNFILTERED population, because the filters are hard no-ops when they are on: asking "what
 * would turning this off hide?" cannot be answered by looking at what is currently visible.
 *
 * `either` is reported because the two sets OVERLAP — an end-of-life OS notice can also be
 * awaiting a vendor fix — so `noFix + eol` is not the number of rows the pair removes, and a
 * page that added them would overstate it.
 */
export interface ToggleImpact {
  total: number;
  noFix: number;
  eol: number;
  either: number;
}

export function toggleImpact<T>(
  rows: T[],
  isNoFix: (r: T) => boolean,
  isEol: (r: T) => boolean,
): ToggleImpact {
  const out: ToggleImpact = { total: rows.length, noFix: 0, eol: 0, either: 0 };
  for (const r of rows) {
    const n = isNoFix(r);
    const e = isEol(r);
    if (n) out.noFix += 1;
    if (e) out.eol += 1;
    if (n || e) out.either += 1;
  }
  return out;
}

/**
 * Per-severity counts over the unfiltered base, for the scan-scope preview. The bootstrap's
 * counts are already narrowed by the display filter, so they cannot answer "what would adding
 * MEDIUM back show me?" — previewing a change to a filter needs the population from before
 * that filter ran.
 */
export function severityCensus<T>(rows: T[], severityOf: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const s = severityOf(r);
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

/**
 * The scans a retention window would seal, as ages in days. The two most recent full scans are
 * always kept whatever the window says (maintenance.ts owns that floor), so they are marked
 * rather than left for the page to re-derive and get subtly wrong.
 */
export interface ScanAge {
  ageDays: number;
  sealed: boolean;
  /** Held back from sealing regardless of the window. */
  pinned: boolean;
}

export function scanAges(
  scans: { ts: string; sealed: 0 | 1 }[],
  now: number,
  keepRecent = 2,
): ScanAge[] {
  // loadScanRows() is ascending; the page reads newest-first, and "the two most recent" has to
  // mean the two most recent, not the two oldest.
  const desc = [...scans].reverse();
  return desc.map((s, i) => {
    const t = Date.parse(s.ts);
    return {
      ageDays: Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0,
      sealed: !!s.sealed,
      pinned: i < keepRecent,
    };
  });
}

/** How many unsealed, unpinned scans the given window would seal on the next pass. */
export function wouldSeal(ages: ScanAge[], retentionDays: number | null): number {
  if (retentionDays === null) return 0;
  return ages.filter((a) => !a.sealed && !a.pinned && a.ageDays > retentionDays).length;
}
