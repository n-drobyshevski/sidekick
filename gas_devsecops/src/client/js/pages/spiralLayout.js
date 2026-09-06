// The time spiral's geometry: a scan's open count placed by WHEN it was measured, one turn
// per calendar quarter.
//
// WHY A SPIRAL AND NOT A SECOND LINE CHART. Scan History already draws open-vs-resolved
// against a date axis, and a date axis is the one thing that cannot show a CADENCE: a
// quarter-end push and a mid-quarter patch land at different x positions every quarter, so
// the eye has nothing to line them up against. Wrapping time so that each quarter is one full
// turn puts the same day-of-quarter at the same ANGLE every time, which is the whole claim
// this shape makes — the radius carries elapsed time, the angle carries position within the
// quarter, and a run of dots at 11 o'clock is a quarter-end habit rather than four unrelated
// points.
//
// DOM-FREE ON PURPOSE, like `historyModel.js` beside it. Nothing here touches `document`;
// `pages/history.js` turns these numbers into SVG. This project's vitest run has no jsdom, so
// the half that can actually be wrong — where a point lands, and which rows never get placed
// at all — is the half a test can hold.
//
// TWO REFUSALS, BOTH BEFORE ANY CAST. `Number(null)` is `0` and `0` is finite (CLAUDE.md's
// three-times-bitten rule), and epoch 0 is a REAL POSITION on this chart: 1970-Q1, at the top
// of the innermost turn, dragging every ring outwards to reach it. An undated scan would not
// look absent, it would look like the oldest measurement this register ever took. So a
// timestamp is admitted only if it was a number or a non-empty string to begin with (the
// allowlist `ui/figures.js`'s `num`/`relativeAge` already use), and the same for the count.
// Everything refused is COUNTED in `skipped` rather than dropped silently — a point that is
// not on the chart is part of the Outside, and the section says how many there are.

/**
 * Epoch milliseconds from a payload timestamp, or null.
 *
 * The allowlist is `relativeAge`'s, for the same reason: only a value that was really a number
 * or a really non-empty string is a candidate for the cast, so `null` / `undefined` / `""` /
 * `"   "` / `[]` / `false` never reach `Date.parse` at all. `Number.isFinite` then guards only
 * the values that were genuinely dates — a non-empty string that does not parse ("not a date")
 * is "we cannot say", not "the epoch".
 */
function epochMs(ts) {
  let t;
  if (typeof ts === "number") t = ts;
  else if (typeof ts === "string" && ts.trim() !== "") t = Date.parse(ts);
  else return null;
  return Number.isFinite(t) ? t : null;
}

/**
 * A count from a payload, or null — `ui/figures.js`'s `num` allowlist, inline rather than
 * imported because this module must stay free of the ui barrel (`figures.js` imports
 * `dom.js`). Same discipline, and `test/spiralLayout.test.js` perturbs it.
 */
function countOf(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** The UTC calendar quarter an instant falls in. `index` counts quarters since year 0, so
 *  the difference between two of them is the number of turns between them. */
function quarterOf(ms) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3);
  return { year, q, index: year * 4 + q, key: `${year}-Q${q + 1}` };
}

/** `[start, end)` of a quarter in UTC ms. `Date.UTC(y, 12, 1)` rolls into the next January,
 *  which is exactly the Q4 end this needs. */
function quarterBounds(year, q) {
  return [Date.UTC(year, q * 3, 1), Date.UTC(year, q * 3 + 3, 1)];
}

function keyOfIndex(index) {
  const year = Math.floor(index / 4);
  return `${year}-Q${(index % 4) + 1}`;
}

const TAU = Math.PI * 2;

/**
 * Scan rows as points on an Archimedean spiral.
 *
 *   scans   this app's `ScanRow[]` — `payload.scans`, straight off `getScanHistory`. The
 *           placed figure is `total`, THE SAME FIELD the Saved scans table shows as
 *           "Findings" (`scanRowsView`), so the two cannot disagree.
 *   r0      radius at the first placed quarter's start
 *   dr      radius added per full turn — one quarter
 *   scope   place only this register's scans; null (default) places all three, and every
 *           point carries its own `scope` so the drawing can vary the SHAPE per register.
 *
 * Geometry: `theta = 2π · (ms into the quarter / ms in the quarter)` in UTC, and
 * `r = r0 + dr·turn + dr·(theta / 2π)` — so the radius grows CONTINUOUSLY across a quarter
 * boundary (the last instant of one quarter and the first of the next are dr apart, both at
 * the top) and no two turns can overlap. `x = r·cos(theta − π/2)`, `y = r·sin(theta − π/2)`
 * puts theta 0 at 12 o'clock in SVG's y-down frame.
 *
 * `turn` is the CALENDAR distance from the first placed quarter, not an ordinal over the
 * quarters that happen to have scans: a register nobody scanned for two quarters leaves two
 * empty rings, because the radius is elapsed time and a gap in the register is not a gap in
 * the year.
 *
 * @returns {{points: Array<{x:number,y:number,r:number,theta:number,ts:*,open:number,
 *   scope:*,quarter:string,scanId:*}>, turns:number, skipped:number,
 *   quarters:Array<{key:string,r:number}>}}
 */
export function spiralLayout(scans, opts = {}) {
  const { r0 = 24, dr = 14, scope = null } = opts || {};
  const rows = Array.isArray(scans) ? scans : [];
  // Filtering is not skipping: a scan of another register was never part of the population
  // this call asked about, so it must not inflate the count of rows this chart could not
  // place.
  const population = scope === null || scope === undefined
    ? rows
    : rows.filter((s) => s && s.scope === scope);

  let skipped = 0;
  const placed = [];
  for (const s of population) {
    const ms = epochMs(s && s.ts);
    const open = countOf(s && s.total);
    if (ms === null || open === null) {
      skipped += 1;
      continue;
    }
    placed.push({
      ms, open, ts: s.ts, scope: s.scope === undefined ? null : s.scope, scanId: s.scan_id,
    });
  }
  if (!placed.length) return { points: [], turns: 0, skipped, quarters: [] };

  placed.sort((a, b) => a.ms - b.ms);
  const firstIndex = quarterOf(placed[0].ms).index;
  const lastIndex = quarterOf(placed[placed.length - 1].ms).index;

  const points = placed.map((p) => {
    const q = quarterOf(p.ms);
    const [start, end] = quarterBounds(q.year, q.q);
    const theta = TAU * ((p.ms - start) / (end - start));
    const r = r0 + dr * (q.index - firstIndex) + dr * (theta / TAU);
    const a = theta - Math.PI / 2;
    return {
      x: r * Math.cos(a),
      y: r * Math.sin(a),
      r,
      theta,
      ts: p.ts,
      open: p.open,
      scope: p.scope,
      quarter: q.key,
      scanId: p.scanId,
    };
  });

  const quarters = [];
  for (let i = firstIndex; i <= lastIndex; i += 1) {
    quarters.push({ key: keyOfIndex(i), r: r0 + dr * (i - firstIndex) });
  }
  return { points, turns: quarters.length, skipped, quarters };
}
