// Reading the risk cube in the browser.
//
// The server sends the joint distribution of (has_kev x has_exploit x EPSS bin) once — see
// src/domain/settingsImpact.ts for why a joint and not three marginals — and this re-aggregates
// it locally so the high-risk classifier's figures move as you flip a switch or drag the
// threshold, without a round trip per keystroke.
//
// This is a deliberate second implementation of `breakdownFromCube`, in JS, because the client
// cannot import the TypeScript domain layer. test/riskCube.test.js pins the two against each
// other over the same cubes, and test/settingsImpact.test.ts pins that one against
// program.signalBreakdown over the same rows — so all three agree or the suite goes red.

/**
 * Re-derive the per-clause breakdown from the cube.
 * Returns `{ kev, exploit, epss, anyOf, kevMissing, exploitMissing, epssMissing, total }`.
 *
 * The clauses are OR-ed, so a finding can satisfy several and these do NOT sum to `anyOf`.
 * The caller has to say so; presenting them as a partition is the misreading to prevent.
 */
export function breakdownFromCube(cube, rule) {
  const out = {
    kev: 0, exploit: 0, epss: 0, anyOf: 0,
    kevMissing: 0, exploitMissing: 0, epssMissing: 0,
    total: (cube && cube.total) || 0,
  };
  if (!cube || !cube.cells) return out;
  // Both epsilons mirror settingsImpact.ts exactly. They are not slack: 0.07 * 100 is
  // 7.000000000000001 and 0.29 * 100 is 28.999999999999996, so an un-nudged cut and an
  // un-nudged bin disagree by a whole bin about a row sitting on its own threshold.
  const cut = Math.max(0, Math.min(cube.bins, Math.ceil(rule.epssThreshold * cube.bins - 1e-9)));
  for (const key of Object.keys(cube.cells)) {
    const cell = cube.cells[key];
    const k = key[0];
    const x = key[1];
    const kevFires = rule.kev && k === "t";
    const exploitFires = rule.exploit && x === "t";
    let cellTotal = cell.noEpss;
    for (let i = 0; i < cell.epss.length; i++) cellTotal += cell.epss[i];
    if (!cellTotal) continue;

    if (kevFires) out.kev += cellTotal;
    if (exploitFires) out.exploit += cellTotal;
    if (rule.kev && k === "n") out.kevMissing += cellTotal;
    if (rule.exploit && x === "n") out.exploitMissing += cellTotal;
    if (rule.epss) out.epssMissing += cell.noEpss;

    let epssHits = 0;
    if (rule.epss) for (let i = cut; i <= cube.bins; i++) epssHits += cell.epss[i] || 0;
    out.epss += epssHits;

    // The union: a row already fired by KEV or exploit counts once, whatever EPSS says.
    if (kevFires || exploitFires) out.anyOf += cellTotal;
    else out.anyOf += epssHits;
  }
  return out;
}

/**
 * The same cube with every resolved cell emptied, so an open-only figure comes out of
 * `breakdownFromCube` rather than a second copy of the same union logic:
 *
 *     breakdownFromCube(openSlice(cube), rule)  // open
 *     breakdownFromCube(cube, rule)             // all time
 *
 * A union over enabled clauses cannot be recovered by subtraction, which is why the status
 * axis is in the cube at all rather than shipped as a pair of totals. Mirrors
 * settingsImpact.openSlice; test/riskCube.test.js pins the two together.
 */
export function openSlice(cube) {
  if (!cube || !cube.cells) return cube;
  const cells = {};
  let total = 0;
  for (const key of Object.keys(cube.cells)) {
    const cell = cube.cells[key];
    if (key[2] === "o") {
      cells[key] = { epss: cell.epss.slice(), noEpss: cell.noEpss };
      total += cell.noEpss;
      for (let i = 0; i < cell.epss.length; i++) total += cell.epss[i];
    } else {
      cells[key] = { epss: new Array(cube.bins + 1).fill(0), noEpss: 0 };
    }
  }
  return { total, bins: cube.bins, cells };
}

/** The display histogram: `buckets` coarse bars plus the never-captured tail. */
export function epssHistogram(cube, buckets = 20) {
  const out = new Array(buckets).fill(0);
  let unmeasured = 0;
  if (!cube || !cube.cells) return { buckets: out, unmeasured };
  const per = cube.bins / buckets;
  for (const key of Object.keys(cube.cells)) {
    const cell = cube.cells[key];
    unmeasured += cell.noEpss;
    // <= bins: the exactly-1.0 bin folds into the top bucket, where it belongs.
    for (let i = 0; i <= cube.bins; i++) {
      if (cell.epss[i]) out[Math.min(buckets - 1, Math.floor(i / per))] += cell.epss[i];
    }
  }
  return { buckets: out, unmeasured };
}

/**
 * The rule as a sentence — the same wording the Program page prints, so a reader who moves
 * between the two never has to translate. Mirrors program.ruleSentence.
 */
export function ruleSentence(rule) {
  const parts = [];
  if (rule.kev) parts.push("CISA KEV");
  if (rule.exploit) parts.push("public exploit");
  if (rule.epss) parts.push("EPSS >= " + Number(rule.epssThreshold).toFixed(2));
  return parts.length ? parts.join(" or ") : "no signal enabled";
}

/** True when the rule enables no clause at all, so it decides nothing. */
export function ruleIsEmpty(rule) {
  return !rule.kev && !rule.exploit && !rule.epss;
}
