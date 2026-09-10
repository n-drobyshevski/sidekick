// The Priorities page as pure functions of state — filter/facet state, URL
// round-tripping, and the DISPLAY-column sort a reader can layer on top of the server's
// own rank.
//
// Split out of problems.js for the same reason comboView.js was split out of combos.js —
// the same reasoning, verbatim: this is the part that is wrong in ways a screenshot won't
// show, and it is the part testable without a DOM. problems.js turns what these return
// into elements and does nothing else clever.
//
// One thing this file deliberately does NOT do: re-derive the page's default ranking.
// `src/domain/problems.ts`'s `compareProblems` — severity, then SLA urgency, then age,
// then id — is the one true order, computed
// server-side in `getProblems` and shipped already sorted. The client bundle cannot
// import that TS module (the same wall `comboView.js`'s own header names for
// `DUE_SOON_DAYS` and `CONDITION_KEYS`), so rather than hand-copy a five-level cascade
// here and risk the two silently disagreeing, this file offers only INDEPENDENT
// single-column sorts — the same relationship `pages/comboView.js`'s `ISSUE_COMPARATORS`
// has to the toxic-combination ranking `rankGroups` already applied. "No sort selected"
// means "trust the order the server sent."

import { dueRank, fmtDate, plural } from "../../../../../gas_shared/ui/format.js";
import { absentText, fmtCount, fmtDays, num } from "../../../../../gas_shared/ui/figures.js";

export const KIND_VALUES = ["ISSUE", "FINDING"];
export const SEVERITY_RANK = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "UNKNOWN"];

/**
 * The page's two register modes — collapsed-to-actions (P1b) or the original one-row-per-
 * problem table. "actions" is the DEFAULT: the self-evidencing "N problems collapse to M
 * actions" headline is the thing worth opening on, the same reason `config.js` opens on
 * BY CONTROL rather than BY FINDING. Because it is the default, it serializes to `null` in
 * `problemParamPatch` below — exactly how `config.js:113` keeps ITS default mode out of the
 * URL — so the common case never grows a `?mode=actions` nobody chose. An unknown or absent
 * value reads as "actions", never as an error.
 */
export const MODE_VALUES = ["actions", "problems"];

/** Rows fetched, filtered and sorted entirely client-side under this ceiling — mirrors the
 *  server's own `PROBLEMS_CLIENT_ALL_MAX` (src/domain/problems.ts). Past it `getProblems`
 *  pages server-side and this page forwards the severity filter and the page number to it. */
export const PAGE_SIZE = 25;

// ------------------------------------------------------------------------ URL state

/** Read the hash params into view state, dropping anything this page doesn't offer. */
export function readProblemParams(params) {
  const p = params || {};
  const severity = String(p.severity || "").toUpperCase();
  const kind = String(p.kind || "").toUpperCase();
  const mode = String(p.mode || "").toLowerCase();
  const page = Number(p.page);
  return {
    mode: MODE_VALUES.indexOf(mode) >= 0 ? mode : "actions",
    severity: SEVERITY_RANK.indexOf(severity) >= 0 ? severity : "",
    kind: KIND_VALUES.indexOf(kind) >= 0 ? kind : "",
    q: p.q || "",
    sort: PROBLEM_COMPARATORS[p.sort] ? p.sort : "",
    dir: String(p.dir) === "-1" ? -1 : 1,
    page: Number.isFinite(page) && page > 1 ? Math.floor(page) - 1 : 0,
  };
}

/**
 * The inverse, shaped for setParams. Every key is present — buildHash drops the empty
 * ones — so clearing a filter actually removes it from the URL instead of leaving a
 * stale value behind. Mirrors `comboParamPatch` in comboView.js.
 */
export function problemParamPatch(state) {
  const s = state || {};
  return {
    // Same "the default is null" rule config.js:113 states for its own mode param — the
    // whole reason problems mode carries a URL param at all is so an "actions" reader's
    // link never grows one.
    mode: s.mode && s.mode !== "actions" ? s.mode : "",
    severity: s.severity || "",
    kind: s.kind || "",
    q: s.q || "",
    sort: s.sort || "",
    dir: s.sort && s.dir === -1 ? "-1" : "",
    page: s.page ? String(s.page + 1) : "",
  };
}

// -------------------------------------------------------------------------- filtering

/**
 * Row-level filters, applied to whatever rows the page currently holds. When the server
 * answered `all: true` this runs over the whole ranked union; past `PROBLEMS_CLIENT_ALL_MAX`
 * the severity half is already applied server-side (so this is a no-op re-check on that
 * axis) and `kind`/`q` narrow only the current page — the same degrade
 * `getConfigFindings`'s paged path accepts for its own client-only affordances.
 */
export function applyProblemFilters(rows, state) {
  const s = state || {};
  const q = String(s.q || "").trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (s.severity && String(r.severity || "").toUpperCase() !== s.severity) return false;
    if (s.kind && r.kind !== s.kind) return false;
    if (q) {
      const hay = [r.title, r.assetName].join(" ").toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

/** The severity and kind values actually present, for the filter pills — worst-first. */
export function problemFilterOptions(rows) {
  const severities = new Set();
  const kinds = new Set();
  for (const r of rows || []) {
    if (r.severity) severities.add(String(r.severity).toUpperCase());
    if (r.kind) kinds.add(r.kind);
  }
  return {
    severities: SEVERITY_RANK.filter((sv) => severities.has(sv)),
    kinds: KIND_VALUES.filter((k) => kinds.has(k)),
  };
}

// -------------------------------------------------------------------------- sorting

function sevIndex(sev) {
  const i = SEVERITY_RANK.indexOf(String(sev || "").toUpperCase());
  return i < 0 ? SEVERITY_RANK.length : i;
}

/**
 * Each comparator is the column's natural FIRST-click order — worst first for the risk
 * columns, A-first for the identity columns. `dir` flips it. Mirrors the shape
 * `comboView.js`'s `ISSUE_COMPARATORS` and `assetTable.ts`'s comparators both use.
 */
export const PROBLEM_COMPARATORS = {
  asset: (a, b) => String(a.assetName || "").localeCompare(String(b.assetName || "")),
  title: (a, b) => String(a.title || "").localeCompare(String(b.title || "")),
  kind: (a, b) => String(a.kind || "").localeCompare(String(b.kind || "")),
  severity: (a, b) => sevIndex(a.severity) - sevIndex(b.severity),
  due: (a, b) => dueRank(a) - dueRank(b),
  // The minimal model's order. The number is computed SERVER-SIDE and arrives on the row —
  // this only reads it, which is the distinction actionView.js's header insists on. An
  // unscored row sorts last rather than as zero.
  //
  // THE COLUMN IS SURFACED NOW, and this comment used to say it was not — "not surfaced
  // while the scoring models sit behind the experimental gate". That reasoning was about
  // the three DERIVED VERDICTS (the AARS band, the posture tier, the ACT/ATTEND outcome),
  // which measured a whole landscape into one band and are confined to the workbench by
  // test/verdictIsolation.test.ts. The rank is not one of them: it is an order over one
  // queue, computed from the operator's own judgement table and a clock, and it ships with
  // the clauses that produced it (`rankReasons`) so the number can be interrogated rather
  // than taken. Whether it LEADS the register's order is a separate question, and its
  // answer is the `rank_leads_sort` setting, off by default.
  rank: (a, b) => rankValue(b) - rankValue(a),
  firstSeen: (a, b) => {
    const x = String((a && a.firstSeenAt) || "");
    const y = String((b && b.firstSeenAt) || "");
    if (x === y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x < y ? -1 : 1;
  },
};

/** `-1` for a row the server never scored, so it lands after every scored one either way. */
function rankValue(row) {
  const v = row && typeof row.rankScore === "number" ? row.rankScore : -1;
  return v;
}

/** Columns whose natural order reads as descending — for aria-sort and the glyph. */
/**
 * Columns whose natural order reads as descending — for aria-sort and the glyph.
 *
 * `rank` is here for the reason `severity` is: a higher score is a WORSE row, so the first
 * click has to show the worst first. `due` and `firstSeen` stay out — both open at the near
 * end (soonest, oldest), which is already ascending.
 */
export const PROBLEM_SORT_DESC = { severity: true, rank: true };

export function sortProblems(rows, key, dir) {
  const cmp = PROBLEM_COMPARATORS[key];
  const list = (rows || []).slice();
  if (!cmp) return list;
  const sign = dir === -1 ? -1 : 1;
  return list.sort((a, b) => {
    const d = cmp(a, b) * sign;
    if (d !== 0) return d;
    // A stable tiebreak, so a re-sort of equal rows never reshuffles them under the eye —
    // same idiom `sortIssues` (comboView.js) closes with.
    return String(a.assetName || "").localeCompare(String(b.assetName || ""))
      || String(a.id || "").localeCompare(String(b.id || ""));
  });
}

// ----------------------------------------------------------------------- the rank cell

/** The disclosure's label, in one place: the page draws it and the test asserts it. */
export const RANK_REASON_LABEL = "Why this rank";

/**
 * The rank cell as data — the number, and whether the clock behind it was measured.
 *
 * TWO DP RATHER THAN THE RAW FLOAT. The score is a blend of four 0..1 readings and lands on
 * long tails (`0.6000000000000001` is an ordinary value of it); printing that would offer a
 * precision the model does not have and make two equal rows look different. Two places is
 * more than the ladders can distinguish and enough to read an order by.
 *
 * `untimed` is NOT a formatting flag. `rankTimed === false` means the clock term was
 * UNMEASURED and dropped from both halves of the blend, so the score beside it was computed
 * from fewer terms than the rule asked for — a different claim about a similar-looking
 * number, which is exactly the pair a surface has to keep apart. It carries a WORD (`note`),
 * never a tint or a glyph alone: severity and status never carry meaning by colour alone
 * here, and neither does this.
 *
 * A row the server never scored reads `—` rather than `0.00`: an unscored row has not scored
 * zero, and the comparator already sorts it last for the same reason.
 */
export function rankCellModel(row) {
  const r = row || {};
  const scored = typeof r.rankScore === "number" && isFinite(r.rankScore);
  const untimed = scored && r.rankTimed === false;
  return {
    scored,
    score: scored ? r.rankScore.toFixed(2) : absentText,
    untimed,
    // The basis is named where there is one, because "overdue by 40 days" and "born 40 days
    // ago with no deadline set" are both a measured clock and are not the same reading.
    basis: scored && r.rankTimed !== false ? String(r.rankTimeBasis || "") : "",
    note: untimed ? "no deadline on this row, so the clock term was not read" : "",
  };
}

/**
 * The clauses behind the score, as plain lines. One per term that ENTERED the blend, in the
 * model's own order — `rank.ts` emits `reasons` and `measuredTerms` the same length and the
 * same order, and this reads the first without re-deriving it.
 *
 * Empty for a row that was never scored, and empty is not a failure to explain: there is
 * nothing to explain about a number that was never computed. The page draws no disclosure
 * at all in that case rather than an empty one.
 */
export function rankReasonLines(row) {
  const list = (row && row.rankReasons) || [];
  return list.map((line) => String(line || "")).filter(Boolean);
}

/**
 * Which column the table shows as its active sort when the reader has chosen none.
 *
 * "No sort selected" means "trust the order the server sent" (this file's own header), and
 * the server now sends one of TWO orders. Naming the rank column when it led is the header
 * saying which — a reader who cannot tell a severity-led order from a rank-led one is being
 * asked to trust an order they cannot name. `""` keeps today's unmarked header exactly.
 */
export function defaultProblemSort(rankLeadsSort) {
  return rankLeadsSort === true ? "rank" : "";
}

// ------------------------------------------------------------------------ the first run

// ONE LABEL, USED FOUR TIMES, so the four cannot drift apart. It names the CONTROL rather
// than a page, because there is no page to send the reader to — the sync battery lives in
// the rail, on every route, and this page has no settings toggle that would change when it
// unlocks. Ported shape: gas's `pages/executive.js` `executiveFirstRunView` names this
// pattern first — an itemised `emptyState` in place of the generic notice on the app's own
// front door, because a leader reading this page alone is owed the full unlock list, not
// one line. gas's rail button says "Run scan"; this app's says "Sync now" (app.js's own
// MANIFEST.sync.noun is "sync"), so the label is this file's own rather than a shared import.
const SYNC_NOW = "Sync now — the button in the rail";

/**
 * The itemised first-run panel this register's front door owes a reader, as data.
 *
 * WHY THIS PAGE GETS A PANEL AND NOT THE GENERIC `firstRunNotice`. Every other route this
 * wave touches replaces a whole page with one sentence — this one page nobody reaches
 * without going through it, and it is where a reader with no history yet is owed the full
 * list of what a sync would put on screen, not a single undifferentiated "nothing here".
 * `firstRunNotice` has no `items` slot for exactly that reason: a one-line notice and an
 * itemised unlock list are different claims, not two sizes of the same one.
 *
 * FOUR ITEMS, AND THREE OF THEM NAME FEATURES THIS FILE DOES NOT DRAW YET. "Movement" and
 * "Issue half-life" are P2.2 and P2.5 — later packages in the same wave. Naming them here
 * is not a bug: the panel's whole job is to tell a reader what SYNCING unlocks, and what it
 * unlocks does not wait on which package happens to have landed first. A reader who runs
 * the first sync today and returns after P2.5 ships sees the half-life appear where this
 * panel already told them it would.
 *
 * WHY IT IS PURE. Every unlock condition is a claim about the sync battery — the first sync
 * exists or it does not, a second one seven days later exists or it does not, an issue has
 * disappeared between two syncs or it has not. Those are testable without a DOM, and
 * `problems.js` turns the result into elements and does nothing else clever, the same
 * relationship this file's own header states for every other export here.
 *
 * `show` is exactly `!boot.latestSync` — the SAME whole-page gate `problems.js` used to
 * decide with a bare `if`, kept here as the one place that decision is made rather than
 * duplicated between the page and its view model.
 *
 * @param {object|null|undefined} boot  `bootstrap()`'s reply
 */
export function prioritiesFirstRunView(boot) {
  const show = !(boot && boot.latestSync);
  if (!show) return { show: false, heading: "", hint: "", items: [] };

  return {
    show: true,
    // The same two sentences `gas_shared/ui/feedback.js`'s `firstRunNotice` would print for
    // `synced: false` — this panel cannot call it directly (it has no `items` slot), so the
    // wording is carried here by hand rather than through the shared function. Keep the two
    // in sync if either changes.
    heading: "No sync has run yet, so nothing on this page has been measured.",
    hint: "Every figure below waits on a different thing. None of them is a zero, and none of "
      + "them is shown as one.",
    items: [
      {
        figure: "Open problems",
        unlock: "The first sync. Until one has run there is no open union to count, and a row "
          + "of zeros would be a measurement of one nobody took.",
        route: null,
        routeLabel: SYNC_NOW,
      },
      {
        figure: "Movement",
        unlock: "Two syncs at least seven days apart, for the week-over-week row. A single "
          + "sync has nothing to compare against.",
        route: null,
        routeLabel: SYNC_NOW,
      },
      {
        figure: "Issue half-life",
        unlock: "A sync that sees an issue disappear. Every issue open since the first sync "
          + "is still a censored observation, not a measured clock.",
        route: null,
        routeLabel: SYNC_NOW,
      },
      {
        figure: "The ranked queue",
        unlock: "The first sync. Nothing can be ranked before the union it ranks over exists.",
        route: null,
        routeLabel: SYNC_NOW,
      },
    ],
  };
}

// ------------------------------------------------------------------- the half-life hero

/**
 * The issue half-life as a sentence, or as the refusal to make one.
 *
 * A PORT OF gas's `kmHalfLifeView` (`gas/src/client/js/pages/mttr.js`), with this register's
 * counts folded into the qualifier. Three outcomes, three different claims:
 *
 *   median present          "41 days"           a measured median: the curve fell to half
 *   median null + bound     "at least 41 days"  the curve never reached half inside the
 *                                               observed window, so the median is at LEAST
 *                                               the longest lifetime anybody watched
 *   neither                 absentText          nothing to rest on. NOT zero, and not a
 *                                               fabricated bound either
 *
 * THE THIRD STATE RETURNS `absentText`, THE SHARED CONSTANT — not a null and not a typed
 * dash. MEASURED, because the plan for this package had it the other way round: `heroStat`
 * promotes the absentText STRING to the muted `absent()` node (`valueOrAbsent`,
 * `gas_shared/ui/controls.js`) and passes anything ELSE through unchanged, so a null renders
 * an EMPTY hero value, not a dash. The first-run hero shipped that way until this package
 * measured it in the browser. Returning the constant keeps the character out of this file
 * and lets the one component that owns how an absence looks draw it.
 *
 * "AT LEAST", NEVER ">". A lower bound says the true figure is that far out OR FURTHER;
 * ">" claims it is strictly beyond, which is a different and unmeasured statement.
 * gas_ai/DESIGN.md section 10 states this rule for every bounded figure in this register.
 *
 * WHAT THE ESTIMATE COULD NOT MEASURE RIDES IN THE QUALIFIER. `returnedExcluded` counts rows
 * at `episode > 1` (a reopened issue whose second episode has no recorded start date, since
 * `issueLedger.ts` bumps the episode without stamping when), so it is measurable in principle
 * and unmeasurable by THIS ledger; `unmeasurable` counts rows whose own dates would not
 * parse. Both are the Outside of this measurement, and CLAUDE.md's rule is that the screen
 * names it rather than letting the population look complete.
 *
 * NO CLOCK. `asOf` is the newest date any row was observed at, derived by the estimator from
 * the data itself; this function reads no wall clock, so the same payload always produces the
 * same sentence.
 *
 * @param {object|null|undefined} halfLife  the `halfLife` head off getProblems/getActions
 */
export function halfLifeView(halfLife) {
  const hl = halfLife || null;
  const median = num(hl && hl.median);
  const bound = num(hl && hl.medianLowerBound);
  const events = num(hl && hl.events, 0);
  const censored = num(hl && hl.censored, 0);
  const returned = num(hl && hl.returnedExcluded, 0);
  const unread = num(hl && hl.unmeasurable, 0);
  const asOf = hl && hl.asOf ? String(hl.asOf) : null;

  // Every branch below appends the same two "what was left out" clauses, so they are built
  // once. An absent count prints nothing at all: a clause reading "0 returned rows excluded"
  // is a sentence about nothing.
  const outside = [];
  if (returned > 0) outside.push(plural(returned, "returned row") + " excluded");
  if (unread > 0) outside.push(plural(unread, "row") + " the ledger could not read");
  const tail = outside.length ? " · " + outside.join(" · ") : "";

  const view = {
    measured: false,
    isLowerBound: false,
    value: absentText,
    qualifier: "not measured",
    days: null,
    events,
    censored,
    asOfNote: asOf
      ? "Measured to " + fmtDate(asOf) + ", the last date any issue was observed."
      : null,
  };

  if (median !== null) {
    view.measured = true;
    view.days = median;
    view.value = fmtDays(median);
    view.qualifier = "half of every issue the register has recorded had left it by then · "
      + plural(events, "event") + ", " + fmtCount(censored) + " censored" + tail;
    return view;
  }
  if (bound !== null) {
    view.measured = true;
    view.isLowerBound = true;
    view.days = bound;
    view.value = "at least " + fmtDays(bound);
    // A bound with NO events is a different claim from a bound the curve simply never
    // finished: nothing has left the register at all, so there is no curve to have fallen.
    // Saying "the curve has not reached half" there would imply one had started.
    view.qualifier = (events > 0
      ? "the curve has not reached half · " + plural(events, "event") + ", "
        + fmtCount(censored) + " still open"
      : "no issue has left the register yet · " + fmtCount(censored) + " still open") + tail;
    return view;
  }
  // Reachable on an empty ledger (no observation at all) and on a payload carrying no
  // half-life head. The counts are not printed: there is nothing to count them over.
  view.qualifier = "no issue lifetime has been recorded yet" + tail;
  return view;
}

// --------------------------------------------------------------------- the movement aside

/** How a null comparison reads, in words. The keys are `backlogMovement`'s own reason
 *  vocabulary (`src/domain/backlogMovement.ts`), and every one of them names a fact about
 *  the SYNC LOG rather than about the backlog, which is the point: a missing comparison is
 *  not a backlog that did not move. */
const MOVEMENT_REASONS = {
  noSync: "no sync has run yet",
  oneSync: "one sync so far",
  noLedger: "a sync recorded before the lifecycle ledger existed",
  rescoped: "the register's scope changed, so the two counts are over two populations",
};

/**
 * One comparison as a row: the label, the chip, the pair the chip is FROM, and the date it
 * reaches back to.
 *
 * THE RAW PAIR RIDES BESIDE THE CHIP, the same decision gas's `movementRow` states: a chip
 * reading "down 2" is a claim about two numbers, and a reader who cannot see both has to
 * trust it. "32 open, was 34" is the arithmetic in the open.
 *
 * THE DIRECTION IS A WORD, never a glyph and never a sign. `chip.word` carries it, the page
 * puts that word in the pill's own visible text AND its `aria-label`, and the triangle it
 * draws beside it is `aria-hidden`.
 */
function movementRowView(label, cmp) {
  const open = num(cmp.open);
  const prevOpen = num(cmp.prevOpen);
  const delta = open === null || prevOpen === null ? null : Math.abs(open - prevOpen);
  const direction = cmp.direction === "up" || cmp.direction === "down" ? cmp.direction : "flat";
  const word = direction === "flat" || delta === null || delta === 0
    ? "unchanged"
    : direction + " " + fmtCount(delta);
  return {
    label,
    // "bad" for a growing backlog, "ok" for a shrinking one: the register's own reading of
    // the direction, not the sign of a subtraction.
    chip: {
      direction,
      word,
      kind: direction === "up" ? "bad" : direction === "down" ? "ok" : "neutral",
    },
    text: fmtCount(open) + " open, was " + fmtCount(prevOpen),
    dates: cmp.since ? "since " + fmtDate(cmp.since) : null,
  };
}

/**
 * The movement aside, as data.
 *
 * TWO ROWS AT MOST, AND NEITHER IS ASSUMED. `previous` compares against the last commit
 * record, whatever its age. On the dev fixture that gap is ONE DAY, so nothing here calls
 * that row "a week"; the week row is a separate comparison with its own endpoint, and its
 * label states the gap it actually found rather than a constant, because `backlogMovement`
 * returns the newest row at least seven days back and that row can be nine days old.
 *
 * A NULL COMPARISON BECOMES WORDS, NOT A ZERO. `reasons` names why the register cannot make
 * each comparison, and every one of those is a fact about the sync log; printing a plus or
 * minus zero there would be a measurement nobody took. `prevOpen` is never printed for a
 * null comparison, because there is no previous population to print.
 *
 * ONE STANDING LINE, ALWAYS. The whole reading is over ISSUES: findings never enter the
 * lifecycle ledger (`syncStore.ts`), so no sync has ever recorded one arriving or leaving.
 * Letting "movement" quietly mean "issue movement" is the kind of unstated scope this
 * register's own help entry exists to stop.
 *
 * @param {object|null|undefined} movement  the `movement` head off getProblems/getActions
 * @returns {{rows: Array, notes: string[]}}
 */
export function movementView(movement) {
  const m = movement || null;
  const reasons = (m && m.reasons) || {};
  const rows = [];
  const notes = [];

  if (m && m.previous) {
    rows.push(movementRowView("Issues", m.previous));
  } else {
    notes.push("No comparison with the previous sync: "
      + (MOVEMENT_REASONS[reasons.previous] || "no comparison could be made") + ".");
  }

  if (m && m.week) {
    const gap = num(m.week.gapDays);
    rows.push(movementRowView("vs " + (gap === null ? "a week" : fmtDays(gap)) + " ago", m.week));
  } else if (reasons.week === "tooClose") {
    // The span is the fact that makes "look again next week" the obvious next move, so it is
    // published rather than replaced by "not enough history".
    const span = num(m && m.spanDays);
    notes.push("No comparison with a week ago: the saved syncs span "
      + (span === null ? "less than a day" : fmtDays(span)) + ".");
  } else {
    notes.push("No comparison with a week ago: "
      + (MOVEMENT_REASONS[reasons.week] || "no comparison could be made") + ".");
  }

  notes.push("Findings carry no lifecycle ledger.");
  return { rows, notes };
}
