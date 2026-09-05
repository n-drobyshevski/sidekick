// What the rank-evaluation panel puts in front of a reader — the DOM-free half.
//
// The split is the one prunePanelView.js and navModel.js argue for: the decisions worth
// testing here are about WORDING and about which figures are allowed to look like numbers,
// and none of them needs a document.
//
// TWO RULES GOVERN EVERY STRING THIS FILE PRODUCES.
//
// 1. A NULL IS NOT A ZERO, AND IT HAS TO SAY SO IN WORDS. `0.0%` and "nobody could measure
//    this" are the same pixel width and the same colour, and one of them is a result. Every
//    unmeasured cell reads as an em-dash followed by the word `unmeasured`, so a reader
//    skimming the column cannot mistake a gap for a floor — the same reason the code
//    register puts the provenance of a death date in the WORD rather than in the styling.
//
// 2. A BRACKET IS DROPPED ONLY WHEN THERE IS NOTHING IN IT. `lo === point === hi` means no
//    row's outcome was unknown, so the bare number IS the whole claim; anything else keeps
//    its bracket, because the width of that bracket is the size of the doubt and it is the
//    one part of this panel that a confident-looking figure would hide.
//
// The server sends fractions (0..1); the percent sign is applied here, once, so no caller
// can multiply twice.

/** The em-dash-plus-word every unmeasured cell reads as. */
export const UNMEASURED = "— unmeasured";

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/** A 0..1 fraction as a percentage with one decimal, or null when there is nothing to show. */
export function formatFraction(value, digits = 1) {
  return isNum(value) ? (value * 100).toFixed(digits) + "%" : null;
}

/**
 * A `Rate` — `{point, lo, hi}` in fractions — as one string.
 *
 * `point (lo–hi)` where the bounds differ from the point, the bare point where they do not,
 * and the unmeasured phrase where there is no point at all. A point-less rate that still has
 * bounds keeps them: "we could not measure this, and here is how wide the answer could be"
 * is strictly more than "we could not measure this".
 */
export function formatRate(rate) {
  const r = rate || {};
  const point = formatFraction(r.point);
  const spread = isNum(r.lo) && isNum(r.hi) && (r.lo !== r.point || r.hi !== r.point)
    ? formatFraction(r.lo) + "–" + formatFraction(r.hi)
    : null;
  if (point === null) return spread ? UNMEASURED + " (" + spread + ")" : UNMEASURED;
  return spread ? point + " (" + spread + ")" : point;
}

/** A correlation is not a percentage; two decimals and its own sign. */
export function formatTau(value) {
  return isNum(value) ? value.toFixed(2) : UNMEASURED;
}

/**
 * The order the bases are read in: the rule in force first, then what it has to beat.
 *
 * `severityOnly` is deliberately absent — the report carries it as a permanent null with a
 * reason, and a row of em-dashes in the table would invite a reader to wonder which sync it
 * was waiting for. It belongs in the note under the table, where the reason fits.
 */
const BASIS_ORDER = ["candidate", "rankV1", "dueAtOnly", "random"];

function basisOf(report, key) {
  if (key === "candidate") return report.candidate || null;
  return (report.baselines || {})[key] || null;
}

/**
 * One row per basis, each cell already a string.
 *
 * Empty whenever the report is not computed: there is no table in that state, only the
 * sentence saying what is missing, and returning four rows of dashes instead would be four
 * statements about a question nobody has been able to ask yet.
 */
export function rankEvalRows(report) {
  if (!report || !report.computed) return [];
  const ks = Array.isArray(report.ks) ? report.ks : [];
  const rows = [];
  for (const key of BASIS_ORDER) {
    const basis = basisOf(report, key);
    if (!basis) continue;
    const means = Array.isArray(basis.meanPrecisionAtK) ? basis.meanPrecisionAtK : [];
    const matrix = basis.matrix || {};
    rows.push({
      key,
      label: basis.label || key,
      note: basis.note || "",
      precision: ks.map((k) => {
        const cut = means.find((m) => m && m.k === k) || null;
        const text = cut && isNum(cut.mean) ? formatFraction(cut.mean) : UNMEASURED;
        return {
          k,
          value: cut && isNum(cut.mean) ? cut.mean : null,
          // How many evaluated syncs the mean is a mean of, so a reader can see when it is
          // one sync wearing an average's clothes.
          n: cut ? cut.n : 0,
          ci: cut ? cut.ci : null,
          text,
        };
      }),
      coverage: { rate: matrix.coverage || null, text: formatRate(matrix.coverage) },
      efficiency: { rate: matrix.efficiency || null, text: formatRate(matrix.efficiency) },
      tau: { value: isNum(basis.meanTau) ? basis.meanTau : null, n: basis.tauN || 0, text: formatTau(basis.meanTau) },
      tieRate: isNum(basis.meanTieRate) ? basis.meanTieRate : null,
    });
  }
  return rows;
}

/**
 * The honesty block, in the order a reader has to take it: how much history there is, how
 * much of it was comparable, how much of the population has an outcome at all, and only then
 * the window every figure was measured over.
 *
 * Every entry is present whether or not the report computed, because the block is what a
 * `waitingFor` state has INSTEAD of numbers.
 */
export function rankEvalHonesty(report) {
  const r = report || {};
  const pairs = isNum(r.comparablePairs) ? r.comparablePairs : 0;
  const skipped = (isNum(r.scopeChanges) ? r.scopeChanges : 0)
    + (isNum(r.unknownScopePairs) ? r.unknownScopePairs : 0);
  const labelled = isNum(r.labelledRows) ? r.labelledRows : 0;
  const evaluated = isNum(r.evaluatedRows) ? r.evaluatedRows : 0;
  return [
    {
      key: "syncs",
      label: "Syncs available",
      value: String(isNum(r.syncsAvailable) ? r.syncsAvailable : 0),
    },
    {
      key: "pairs",
      label: "Comparable pairs",
      value: String(pairs),
      // Named rather than implied: a run of skipped pairs is the register being re-scoped,
      // and it is the difference between "nothing happened" and "we declined to measure".
      note: skipped
        ? skipped + " pair" + (skipped === 1 ? "" : "s") + " skipped: the register scope moved"
        : "",
    },
    {
      key: "labelled",
      label: "Rows with an outcome",
      value: labelled + " of " + evaluated,
      note: evaluated > labelled
        ? (evaluated - labelled) + " still being observed — counted, never scored as open"
        : "",
    },
    {
      key: "horizon",
      label: "Horizon",
      value: (isNum(r.horizonDays) ? r.horizonDays : 0) + " days",
      note: "Remediation is dated by DISAPPEARANCE, so every figure is an upper bound.",
    },
  ];
}
