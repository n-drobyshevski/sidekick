// "Posture over time" as pure logic: which series a window can draw, what each point's
// label has to say beside the counts, and what the capacity readout is allowed to claim.
//
// ITS OWN MODULE, for the mechanical reason staleness.js states: pages/inventory.js
// transitively imports charts.js, which reads `window` at module scope, so anything exported
// from the page can only be tested inside a DOM environment. This is data in, data out.
//
// ABSENT IS NEVER ZERO runs through every function here. A series with no number at a point
// carries `null` and the chart breaks the line there; a series with no number at ANY point
// is not drawn at all, because an empty legend entry invites "why is that line zero". Both
// rules are the count trend's, one register deeper — see aarsTrend.ts.

/**
 * The three adjacency states, worst-placed first, with the hue each line takes.
 *
 * CATEGORICAL HUES, not the severity palette — charts.js's own rule for a non-severity
 * series. The order is the stack order: DIRECT (the row is ON an AI asset) at the bottom,
 * because it is the band a reader looks for first.
 */
export const ADJACENCY_SERIES = [
  { key: "DIRECT", label: "On an AI asset", color: "#dc2626" },
  { key: "ADJACENT", label: "One hop away", color: "#ea580c" },
  { key: "UNLINKED", label: "Not linked", color: "#3b82f6" },
];

/** The five exploitation tiers, strongest evidence first. */
export const EXPLOITATION_SERIES = [
  { key: "kev", label: "KEV", color: "#be123c" },
  { key: "exploit", label: "Known exploit", color: "#ea580c" },
  { key: "epss", label: "EPSS over threshold", color: "#8b5cf6" },
  { key: "none", label: "No evidence found", color: "#16a34a" },
  { key: "unknown", label: "Not evaluated", color: "#64748b" },
];

/**
 * The hues a category line can take, cycled by position in the register's own scope order.
 *
 * A cycle rather than a fixed map: the scope is a tenant setting and can hold an id this
 * build has never seen, so there is no palette entry to look up. Colour is never the only
 * cue — every line is named in the legend — which is what makes cycling acceptable at all.
 */
export const CATEGORY_COLORS = [
  "#be123c", "#3b82f6", "#16a34a", "#8b5cf6", "#ea580c", "#0e7490",
];

/** One point's value for a series: `null` for "no number here", never 0. */
export function valueAt(point, key) {
  const counts = (point && point.counts) || {};
  const v = counts[key];
  return v === undefined || v === null ? null : v;
}

/** The series that have a number at SOME point in this window — the ones worth drawing. */
export function presentSeries(points, series) {
  return (series || []).filter((s) => (points || []).some((p) => valueAt(p, s.key) !== null));
}

/**
 * The series that are missing a number at some point INSIDE their own window — the lines
 * that begin in mid-air or break.
 *
 * The caller says so in words, because "the line starts here" and "this was zero until then"
 * are the same picture and only one of them is true.
 */
export function gappySeries(points, series) {
  return (series || []).filter((s) => (points || []).some((p) => valueAt(p, s.key) === null));
}

/** `series` as chart datasets, nulls preserved so Chart.js breaks the line at a gap. */
export function seriesData(points, series) {
  return (series || []).map((s) => ({
    label: s.label,
    color: s.color,
    data: (points || []).map((p) => valueAt(p, s.key)),
  }));
}

/**
 * What each adjacency point's label says BESIDE its counts — the denominator, in words.
 *
 * The counts are unreadable without it. 68 asset edges across the whole reference tenant
 * means an UNLINKED count is measuring how little topology was traversed, not how much of
 * the register is unrelated to the AI estate; and an absent `edgesKnown` (a sync recorded
 * before the denominator was written) must say so rather than print a zero.
 */
export function adjacencyPointNotes(points) {
  return (points || []).map((p) => {
    const known = p && p.annotations ? p.annotations.edgesKnown : null;
    if (known === null || known === undefined) return "Edges traversed: not recorded";
    if (known === 0) {
      return "0 adjacency edges in the graph — nothing to traverse, so every row is unlinked "
        + "by construction";
    }
    return `${known.toLocaleString()} adjacency edges known`;
  });
}

/** The same, for exploitation: how many findings the fold read, and what it could not use. */
export function exploitationPointNotes(points) {
  return (points || []).map((p) => {
    const a = (p && p.annotations) || {};
    if (a.findings === null || a.findings === undefined) return "Findings read: not recorded";
    const parts = [`${a.findings.toLocaleString()} findings read`];
    if (a.unjoined) parts.push(`${a.unjoined.toLocaleString()} carried no issue`);
    if (a.droppedNotInRegister) {
      parts.push(`${a.droppedNotInRegister.toLocaleString()} outside the register`);
    }
    return parts.join(", ");
  });
}

/**
 * The per-category lines, over the vocabulary the SERVER says the register is collecting.
 *
 * Names come from the payload (`labelCategories` already fell back to the id for a category
 * this build has no name for); the fallback is repeated here for a stale cached payload that
 * carries bare ids. A category with no number at any point in the window is dropped by the
 * caller through `presentSeries`, not here.
 */
export function categorySeries(categories) {
  return (categories || []).map((c, i) => {
    const id = typeof c === "string" ? c : c.id;
    const name = typeof c === "string" ? "" : c.name;
    return {
      key: id,
      label: name || id,
      color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
    };
  });
}

/**
 * "A", "A and B", "A, B and C" — a prose list.
 *
 * NOT `listJoin`, which the page also has in scope: that joins with a bare comma because it
 * builds URL parameters, and a sentence reading "Adjacent,Unlinked have no figure" is how a
 * URL helper ends up in prose.
 */
export function labelList(series) {
  const names = (series || []).map((s) => (typeof s === "string" ? s : s.label));
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The word each verdict is spoken as. The WORD is the signal; the dot only repeats it. */
export const CAPACITY_WORDS = {
  gaining: "Gaining ground",
  "keeping-up": "Keeping up",
  "falling-behind": "Falling behind",
};

/**
 * The capacity readout: one word, one number, and a sentence saying what it could not use.
 *
 * NULL IS A FIRST-CLASS ANSWER. Below two comparable syncs there is no verdict at all — one
 * observation of a rate that varies with sync cadence is not a remediation programme — and
 * the readout says "not yet comparable" rather than showing a reassuring "Keeping up" that
 * nothing measured. Same rule as the register's own: a figure states what it measured from
 * and what it did with the rows it could not measure.
 */
export function capacityReadout(capacity) {
  const overall = (capacity && capacity.overall) || null;
  const points = (capacity && capacity.points) || [];
  if (!overall || !overall.syncs) {
    return {
      verdict: null,
      word: "Not yet comparable",
      detail: "No sync has recorded a lifecycle ledger yet — the readout starts at the next one.",
      mmcr: null,
      rows: [],
    };
  }
  const skipped = overall.syncs - overall.comparable;
  const rows = points.map((p) => ({
    syncId: p.syncId,
    at: p.at,
    opened: p.opened,
    closed: p.closed,
    net: p.net,
    comparable: p.comparable,
    // A non-comparable sync's own verdict is withheld by the server, and the reason is worth
    // repeating on the row: its `closed` is understated by construction, so the verdict it
    // would carry has a known direction of error.
    verdict: p.verdict ? CAPACITY_WORDS[p.verdict] || p.verdict : "Not comparable",
  }));
  if (!overall.verdict) {
    return {
      verdict: null,
      word: "Not yet comparable",
      detail: overall.comparable === 0
        // Not "no syncs": there are syncs, and none of them has a comparable one behind it.
        // The first never does, and a sync that re-scoped the register or resolved nothing by
        // absence is answering a different question than the one before it.
        ? "No sync in this window can be compared with the one before it: the first has "
          + "nothing behind it, and a sync that re-scoped the register or resolved nothing "
          + "by absence answers a different question."
        : `${plural(overall.comparable, "comparable sync")} so far; the verdict needs two.`,
      mmcr: null,
      rows,
    };
  }
  return {
    verdict: overall.verdict,
    word: CAPACITY_WORDS[overall.verdict] || overall.verdict,
    detail: `Mean close rate ${overall.mmcr.toFixed(1)}% of the open register per sync, over `
      + `${plural(overall.comparable, "comparable sync")} of ${overall.syncs}`
      + (skipped
        ? `. ${plural(skipped, "sync")} left out: the scope moved, or the sync resolved `
          + "nothing by absence."
        : "."),
    mmcr: overall.mmcr,
    rows,
  };
}

/** "1 sync" / "2 syncs" — the page's own `plural` lives in ui.js, which imports the DOM. */
function plural(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}
