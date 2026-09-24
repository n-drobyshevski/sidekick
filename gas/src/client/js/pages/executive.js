// Executive — the front door, and the one page a leader is allowed to read alone.
//
// THE CENTRED 720px COLUMN IS GONE. This page spent its whole life as a `.exec` one-pager
// inherited from the Streamlit build: max-width 720, text-align centre, a clamp()ed hero
// value two steps above every other figure in the app, and a row of bordered severity tiles.
// gas/DESIGN.md §6 wrote the retirement down before it happened — every other sidekick's
// front door is the shared `pageHeader()` shape (hero stat, one qualifying aside, a stat
// strip closed by a hairline), and a leadership one-pager bolted onto a sidebar app is the
// big-number template PRODUCT.md's anti-references reject. The page reads like the register
// it belongs to now, and `.exec*` leaves `styles/pages.css` with it.
//
// ONE NUMBER, AND IT IS ALLOWED TO REFUSE TO BE A NUMBER. The hero is the register's
// remediation half-life read off a Kaplan-Meier curve. Where that curve never falls to half
// — the normal state of a register carrying more open findings than closed ones — there IS
// no median, and the page publishes `medianLowerBound` as "at least N days" instead.
// `executiveHeroView` is where that decision lives, pure and exported, so the claim is
// testable without a DOM.
//
// NO CHART ON THE FRONT DOOR, and that is a decision rather than an omission. Chart.js is
// ~170 KB fetched over `google.script.run` on the first route that draws one
// (chartsLoader.js); the landing page draws none, so the front door never pays for it. The
// survival curve, its censor markers and the per-severity split live on MTTR & SLA, one link
// away — see `curveNote` below. `test/executiveFixNext.test.js` states the rule as ZERO
// canvases in this file, because a ranked list is exactly the kind of block somebody would
// later reach for a bar chart to draw.
//
// WHAT THIS PAGE IS SENT. `api_getExecutivePage` composes four read-models and slices two of
// them hard (domain/pagePayload.ts). The hero arrives as `{median, medianLowerBound}` and
// NOTHING else — no `curve`, no `censored`, no `events` — so the hero's qualifier names
// resolved and still-open lifecycles, which ARE in the payload, and does not claim they are
// the estimator's event and censored counts, which are not. `fixNext` is the ranked list
// plus its unranked accounting; `movement` is open-backlog movement across at least a week
// of scans; `byDomain` is the per-group split; `severityCounts` is the open tally.
//
// IT ANSWERS FOR THE HEADER SCOPE, like every other page, and the scope chip rides with the
// figures rather than in the shell. What kept this page exempt from the switcher for a long
// time was the severity tiles, which read bootstrap's register-wide tally: a scoped hero over
// unscoped tiles is not a smaller truth, it is two populations on one screen with nothing
// distinguishing them. Once the server could ship a scoped tally (`severityCounts`) the
// exemption had nothing holding it up.
//
// THE WEEK-OVER-WEEK COMPARISON NEEDS NO SCOPE GATE, and that is worth stating because the
// equivalent chips on the MTTR page do (mttr.js: "EVERY SCOPE THE SHELL CAN HOLD HAS TO BE
// LISTED HERE"). Those diff a scoped current value against the register-wide `mttr_history`
// snapshots, so a scope makes them compare two different populations. `executiveWeekTrend`
// computes both of its endpoints from the same `scopedBaseRows`, so it is scope-correct by
// construction. Do not add a predicate here.
//
// The view functions below are pure and exported so the claims they encode are testable in
// node — the split scanProgress.js and capacity.js already use, and for the same reason.

import { bootstrap, swrParts } from "../../../../../gas_shared/store.js";
import {
  briefDelta, briefFigure, briefFigures, briefList, briefSplit, briefSplits, briefStatus,
  clear, collapsibleSection, dataTable, disclosure, dotGrid, el, motionOk, emptyState, errorState,
  fmtCount, fmtDate, fmtDateTime, fmtDays, fmtSpan, foldTail, num, pageHeader,
  pluralize, relativeAge, ringMark,
  scopeBar, sectionLabel, skeleton, slopeMark, statusPill, tipLabel, unitSquares,
  FINE_UNITS, unitRow, unitScale,
  absent, days1,
  absentText, pct1,
} from "../ui.js";
// THE HALF-LIFE DECISION IS IMPORTED, NOT REPEATED. `execMttrSlice` is a slice of the MTTR
// page's own payload (api.ts says so), so the rule that turns `{median, medianLowerBound}`
// into a sentence has to be the same rule on both pages or the front door and the detail page
// could describe the same estimate differently. It lives on the page that owns the clock.
import { kmHalfLifeView } from "./mttr.js";
import { groupCutNote } from "./_groupSplit.js";
// THE PRESENT/UNOBSERVED SPLIT IS IMPORTED, NOT REPEATED — same reason as the half-life above.
// `backlogSplitView` is `mttr.backlog`'s one sentence shape, shared with `pages/mttr.js` and
// `pages/overview.js` so the hero, the aging charts and the open-count strip all describe one
// blind spot in one voice.
import { backlogSplitView } from "./_backlog.js";
// `findEntry` READS THE BOOK'S OWN "fix-next" LINES so the heading's tip can carry BOTH the
// ranking rule and what a click does, in one trigger — see `renderFixNext`'s own comment on
// why `linkNote` moved off the surface and onto here rather than growing a second `?`.
import { findEntry } from "../helpContent.js";

// ------------------------------------------------------------------------- view models

/**
 * The hero, decided rather than formatted.
 *
 * THE THREE OUTCOMES ARE THREE DIFFERENT CLAIMS and the view keeps them apart:
 *
 *   median present        "41 days"          — half the register closed within that
 *   median null, bound    "at least 41 days" — the curve never reached half; 41 d is the
 *                                              longest thing observed, so the median is at
 *                                              LEAST that. `isLowerBound` is true.
 *   neither               "Not measured"     — no observations at all. Not a zero.
 *
 * The second case is the one this register was built to get right. Rendering the bound as a
 * bare "41 days" would state a median that was never observed; collapsing it to a dash would
 * throw away a true statement. So it is published, prefixed, and flagged.
 *
 * THE QUALIFIER NEVER GLUES "Not measured" TO A COUNT. With nothing tracked there is no
 * "0 tracked lifecycles" to print beside the refusal — a zero there is a measurement of a
 * population nobody looked at, which is the exact failure the hero's own value just refused.
 *
 * @param {object|null|undefined} payload  `api_getExecutivePage`'s reply
 * @returns {{measured: boolean, value: string, isLowerBound: boolean, days: number|null,
 *            tracked: number, resolved: number, open: number, qualifier: string}}
 */
export function executiveHeroView(payload) {
  const mttr = (payload && payload.mttr) || null;
  const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
  const tracked = num(mttr && mttr.rowCount, 0);
  const overall = (mttr && mttr.overall) || {};
  const resolved = num(overall.resolved, 0);
  const open = num(overall.open, 0);

  const half = kmHalfLifeView(km);

  // Deliberately NOT called "events" and "censored". The estimator's own counts are not in
  // this payload (execMttrSlice drops them), and resolved/open are close but not identical —
  // a row whose first_seen will not parse contributes to neither. The MTTR page has the real
  // pair; this line says what it actually knows.
  const qualifier = tracked
    ? fmtCount(tracked) + " tracked " + pluralize(tracked, "lifecycle")
      + " · " + fmtCount(resolved) + " resolved · " + fmtCount(open) + " still open"
    : "No lifecycles tracked yet.";

  // The present/unobserved split behind "still open" above — `open` already counts both;
  // this names how much of it the scanner has stopped answering for. NEVER FOLDED INTO THE
  // QUALIFIER: it is its own line (`renderHero` draws it through `heroLines`), because "still
  // open" and "unobserved" are different claims and gluing them into one sentence is exactly
  // what this package exists to stop happening. Hides cleanly (`show: false`) when there is
  // nothing unobserved.
  const split = backlogSplitView(mttr && mttr.backlog);

  return {
    measured: half.measured,
    value: half.value,
    isLowerBound: half.isLowerBound,
    days: half.days,
    tracked,
    resolved,
    open,
    qualifier,
    backlogLine: split.line,
    backlogCaption: split.caption,
  };
}

/** Shown in a tile whose count is still in flight. Only reachable under a scope: unscoped,
 *  the numbers come off bootstrap and are already in hand when the page first paints. */
const PENDING = "…";

/**
 * What the "Open findings by severity" block says. Pure so the scoped/unscoped split is
 * testable.
 *
 * OPEN ONLY, ON BOTH PATHS. Both sources are open-only: bootstrap's `openCounts` and the
 * server's `executiveSeverityCounts`, whose `total` is the count AFTER `isOpenStatus`
 * filtering — so `total` here is the open population, never everything ever tracked.
 *
 * UNSCOPED, THE SOURCE STAYS BOOTSTRAP — deliberately, not by omission. This is the default
 * landing page and it must paint real numbers on the first synchronous pass rather than flash
 * a placeholder while an RPC lands. The two tallies provably agree: bootstrap counts the open
 * rows of `visibleFrame(scan.records)` and `scopedFrameRecords("", "", [])` returns exactly
 * that frame, filtered the same way, so the repaint when the payload arrives is a no-op. That
 * agreement is load-bearing and pinned in test/executiveView.test.js — narrowing one
 * population without the other reintroduces the flicker this avoids.
 *
 * A LEVEL WITH ZERO OPEN FINDINGS KEEPS ITS KEY, and an all-zero scope also gets a sentence.
 * A missing key reads as a render that failed; an honest 0 does not. But five bare zeros
 * under a live hero — a domain whose live work has closed, or `Not attributable`, which no
 * open finding can ever land in — need the sentence saying why they are zero.
 *
 * `count` RIDES BESIDE `value`, and that is what the segment bar draws. The formatted string
 * is what the old tiles printed and what test/executiveView.test.js still reads; the number
 * is what `sevSegmentBar` needs, and deriving one from the other at the call site would put a
 * parse in front of a figure that was a number the whole way down.
 *
 * THE MOVEMENT STRIP SUPERSEDES THIS BLOCK WHENEVER IT CAN BE DRAWN, and that is what
 * `movement` decides. The two describe ONE population — `api.ts` builds both from the same
 * `baseVisible` rows under the same severity gate — and the movement strip says strictly more
 * about it: a row per severity with the open count, a `unitRow` tally of that count, the
 * previous count and the direction. Drawn together, this page stated 27 CRITICAL and 39 HIGH
 * twice, a screen apart, in two different pictures — and only the copy down here had to
 * apologise for its own arithmetic, because dropping UNKNOWN from the key row is what makes
 * 27 + 39 = 66 sit under a hero that counts 70. The movement rows carry UNKNOWN and sum to
 * their own total; there is nothing to reconcile up there.
 *
 * SO IT IS A FALLBACK, NOT A DELETION. `openMovement` needs two scans at least seven days
 * apart (`insights.ts`), which a register in its first week does not have — and in that state
 * the movement strip prints "No open-backlog comparison" and this block is the ONLY thing on
 * the front door that breaks the open backlog down at all. Exactly one of the two is on the
 * page at any time, and it is always the richer one available.
 *
 * WHAT THAT COSTS, STATED RATHER THAN HIDDEN. With no severity gate in force, `openMovement`
 * publishes only the severities PRESENT at either endpoint, so a level the register held
 * nothing in all week loses the "LOW 0" key the paragraph above insists on. That rule still
 * governs this block wherever it IS drawn; what is given up is a zero for a level nobody has
 * a finding in this week or last, which is the emptiest bucket on the page.
 *
 * `movement` UNDEFINED MEANS "NOT COMPARABLE", so a caller that does not pass it gets the
 * block — the shape every test in test/executiveView.test.js was written against.
 *
 * @param {{order: string[], scope: string[], bootCounts: object,
 *          payload: object|null|undefined, scoped: boolean,
 *          movement?: object|null}} args
 */
export function executiveSeverityView({ order, scope, bootCounts, payload, scoped, movement }) {
  // READ THROUGH `openMovementView`, never through a second copy of its rule. Whether a
  // comparison exists is `insights.openMovement`'s decision, published as `comparable` and
  // already interpreted once on this page; asking "does `movement.rows` have anything in it"
  // here would be a second opinion that could disagree with the strip actually rendered.
  if (openMovementView(movement).show) {
    return {
      show: false, supersededBy: "movement",
      pending: false, tiles: [], open: null, openAll: null, note: null,
      populationLine: null, populationExplain: null,
    };
  }
  const all = order || [];
  const sevs = all.filter((s) => scope.includes(s));
  const build = (read) => sevs.map((sev) => {
    const count = read(sev);
    return { sev, count, value: count === null ? PENDING : count.toLocaleString() };
  });
  const sum = (tiles) => tiles.reduce((n, t) => n + (t.count === null ? 0 : t.count), 0);
  const done = (tiles, openAll, note) => {
    const open = sum(tiles);
    const pop = line(open, openAll);
    return {
      show: true, supersededBy: null,
      pending: false, tiles, open, openAll, note,
      populationLine: pop.text,
      // NULL WHEN THE TWO POPULATIONS AGREE — there is nothing to explain, and `renderSeverity`
      // draws a plain paragraph rather than a tip trigger over a line with nothing behind it.
      populationExplain: pop.explain,
    };
  };
  if (!scoped) {
    const c = bootCounts || {};
    // `num(v, 0)`, never `Number(v) || 0`: a severity bootstrap did not tally is a 0 because
    // the fallback says so, not because a cast invented one.
    //
    // THE SECOND TOTAL IS THE GATE'S OWN POPULATION, not the whole register. `filterSeverities`
    // keeps UNKNOWN alongside every gate, so the hero and the movement strip above measure the
    // display scope PLUS UNKNOWN — which is exactly this sum. Summing every level instead would
    // pair the picture's 66 with a 113 that appears nowhere else on the page, which explains
    // one discrepancy by inventing a bigger one.
    return done(
      build((sev) => num(c[sev], 0)),
      all.filter((sev) => scope.includes(sev) || sev === "UNKNOWN")
        .reduce((n, sev) => n + num(c[sev], 0), 0),
      null,
    );
  }
  if (!payload) {
    return {
      show: true, supersededBy: null,
      pending: true, tiles: build(() => null), open: null, openAll: null, note: null,
      populationLine: null, populationExplain: null,
    };
  }
  const counts = payload.counts || {};
  // `flatScan: false` means there is no scan to count at all — the last-scan section already
  // says so, and an honest 0 there needs no second sentence about the scope.
  const note = payload.flatScan && !payload.total ? "No open findings in this scope." : null;
  return done(build((sev) => num(counts[sev], 0)), num(payload.total, 0), note);
}

/**
 * The population line, and the reason it has two shapes.
 *
 * MEASURED ON THE DEV SEED, at 1280: the picture drew CRITICAL 27 + HIGH 39 and stated
 * "66 open findings", six inches under a hero reading "70 still open" and a movement row
 * reading "70 open, was 75". Both numbers are right and they are about DIFFERENT populations.
 * The display-severity setting was CRITICAL+HIGH; `filterSeverities` keeps UNKNOWN alongside
 * every gate (`SELECTABLE_SEVERITIES` excludes it, so it can never be in the display scope
 * and is never excluded by one either), so four open findings sit in the hero and in the
 * movement strip while being at no level this picture has to draw them at. A page carrying
 * two totals that disagree by four, with nothing saying why, reads as arithmetic that has
 * gone wrong.
 *
 * THE NUMBERS STAY ON THE SURFACE; THE REASON MOVES ONE LEVEL DOWN. This used to be one
 * paragraph reading "66 open findings at the severities this page shows. The figures above
 * count 70: a severity gate always keeps findings graded UNKNOWN, and this picture has no
 * level to draw them at." — two sentences, the second one an EXPLANATION of why the two
 * figures differ rather than an honesty statement a reader needs without asking for it. Both
 * numbers still print where a reader can see them without hovering anything (`text`); the
 * explanation of WHY they differ is `explain`, for `renderSeverity` to hang on a `tipLabel`
 * over that same line. Where the two populations agree there is nothing to explain and
 * `explain` is null — "66 open findings, of 66" was a caveat about nothing before, and a tip
 * trigger over a line with nothing behind it would be a control that does nothing.
 *
 * @returns {{text: string, explain: string[]|null}}
 */
function line(open, openAll) {
  const shown = fmtCount(open) + " open " + pluralize(open, "finding");
  if (openAll <= open) return { text: shown + ".", explain: null };
  return {
    text: fmtCount(open) + " open at the shown severities · " + fmtCount(openAll)
      + " including UNKNOWN",
    explain: [
      "The figures elsewhere on this page count " + fmtCount(openAll) + "; this picture"
      + " counts only the " + fmtCount(open) + " at the severities it shows.",
      "A severity gate always keeps findings graded UNKNOWN, and this picture has no level"
      + " to draw them at.",
    ],
  };
}

/**
 * What the per-group remediation split says, and whether it is worth drawing at all.
 *
 * THE DIMENSION FOLLOWS THE SCOPE, server-tagged: per-domain at the whole-register view,
 * per-support-group when a domain is picked, per-ASSET when a support group is picked. Only the
 * middle one is a degeneracy fix — splitting BY domain while scoped TO one domain is a single
 * row restating the hero. The asset case replaces a split that worked (by-domain inside a
 * support group was a real multi-row answer); it is an editorial choice, because a support
 * group is a team and the thing a team patches is a host. Only `mttrByDomainData` aliases
 * `group` into `domain`, so the name has to be read through `group ?? domain` or the other two
 * splits render a column of blanks.
 *
 * THE ONE-ROW GUARD APPLIES TO EVERY DIMENSION HERE. It used to be a deliberate divergence from
 * mttr.js, which guarded only the support-group branch; mttr.js now guards all three too, so
 * the two pages agree. The `domainNames` gate stays on the domain dimension alone: it is the
 * CONFIGURED universe, and a register with one configured domain has nothing to split by.
 *
 * EVERY GROUP IT IS GIVEN IS LISTED. This used to cap at five and call itself a summary, which
 * quietly made the section unable to answer the question it poses: a domain outside the top five
 * by open backlog could carry the worst MTTR on the page and never appear, with nothing on
 * screen saying rows had been dropped. That is still the rule — but for an ESTATE-SIZED
 * dimension "everything" is not a payload the landing page can carry, so the asset split is
 * bounded upstream (`ASSET_TOP_N`) and arrives with a `cut` describing exactly what it lost.
 * The difference from the old five-row cap is the whole point: the bound is stated on the page.
 * Ordering still puts the biggest backlog first.
 *
 * @param {object|null|undefined} byDomain  the server's `byDomain` slice
 * @param {{domainNames: string[]}} args
 */
export function executiveByDomainView(byDomain, { domainNames }) {
  if (!byDomain || !byDomain.rows || !byDomain.rows.length) return { show: false };
  const dim = byDomain.dimension;
  if (dim !== "supportGroup" && dim !== "asset" && (domainNames || []).length < 2) {
    return { show: false };
  }
  if (byDomain.rows.length < 2) return { show: false };
  const rows = [...byDomain.rows]
    .sort((a, b) => (b.open ?? 0) - (a.open ?? 0))
    .map((r) => ({ name: r.group ?? r.domain, kmMedian: r.kmMedian, open: r.open ?? 0 }));
  const TITLES = {
    supportGroup: "MTTR by support group",
    asset: "MTTR by asset",
  };
  const HEADERS = { supportGroup: "Support group", asset: "Asset" };
  return {
    show: true,
    title: TITLES[dim] || "MTTR by domain",
    columnHeader: HEADERS[dim] || "Domain",
    rows,
    // What the split's cap dropped, or null where nothing did. Read off the payload, not off
    // the dimension: which dimensions are bounded is the server's fact to state.
    cutNote: groupCutNote(byDomain.cut, (HEADERS[dim] || "Domain").toLowerCase()),
    // True where at least one group's curve never fell to half. `execGroupSlice` ships
    // `kmMedian` and drops `kmMedianLowerBound`, so such a group arrives as null with no
    // bound behind it: the cell is a dash and the footnote says what the dash means.
    anyBoundMissing: rows.some((r) => r.kmMedian === null || r.kmMedian === undefined),
  };
}

/**
 * A signed change against a previous value, made pure so what it CLAIMS is testable without
 * a DOM.
 *
 * RISING IS WORSE HERE. This chip is only ever handed an open-finding count, and a backlog
 * that grew is a backlog that grew. The arrow at the call site is decorative
 * (`aria-hidden`); `direction` and `aria` restate it in words, because a glyph or a tint may
 * never be the only cue.
 *
 * NO PREVIOUS VALUE MEANS NO CHIP, NOT A ZERO ONE. `null` returns null, and the caller draws
 * nothing — a "±0" over an absent comparison is the confident-zero failure this register
 * keeps closing. The percentage is dropped in two more cases for the same reason: a previous
 * value of 0 has no percentage to give, and a change that ROUNDS to 0 % would print "0 %"
 * beside a non-zero count and read as no movement at all.
 *
 * @param {number|null|undefined} current
 * @param {number|null|undefined} previous
 */
export function deltaChipView(current, previous) {
  const prev = num(previous);
  const cur = num(current);
  if (prev === null || cur === null) return null;

  const delta = cur - prev;
  if (delta === 0) {
    return {
      direction: "flat", delta: 0, pct: null, text: "unchanged", aria: "unchanged",
      kind: "neutral",
    };
  }
  const rising = delta > 0;
  const mag = Math.abs(delta);
  const rounded = prev ? Math.round((mag / prev) * 100) : 0;
  const pct = rounded === 0 ? null : rounded;
  return {
    direction: rising ? "up" : "down",
    delta,
    pct,
    // THE WORD CARRIES IT, not the glyph and not the tint. "up 4" / "down 4" / "unchanged"
    // is the pill's own visible text, so a reader who cannot resolve the ▲ still reads the
    // direction off the pill rather than off its colour.
    text: (rising ? "up " : "down ") + fmtCount(mag) + (pct === null ? "" : " · " + pct + "%"),
    aria: (rising ? "up " : "down ") + fmtCount(mag)
      + (pct === null ? "" : ", " + pct + " percent")
      + (rising ? ", the backlog grew" : ", the backlog shrank"),
    kind: rising ? "bad" : "ok",
  };
}

const MOVEMENT_REASONS = {
  noScan: "No scan has saved a population yet, so there are no two observations to compare.",
  oneScan: "One scan only. A comparison needs two, and the second has to fall at least a week"
    + " after the first.",
  tooClose: "The scans on record are too close together to compare.",
};

/**
 * Movement in the OPEN BACKLOG, per severity, between two scans the server actually names.
 *
 * WHY THIS IS NOT `executiveMovementView`. That one reads `weekTrend` — the half-life now
 * against the half-life a week ago — and withholds a badge whenever the Kaplan-Meier curve
 * fails to reach half at either endpoint, which on a young register is always. So the aside
 * said "no comparison" permanently, not because nothing moved but because the measure it was
 * asking for is unobservable. Both blocks stay. The half-life comparison is the better
 * statement where it exists; this one is the statement censoring cannot suppress.
 *
 * THE DATES ARE PART OF THE FIGURE. "Down 9" means nothing without the interval it is over,
 * so `since` / `until` / `gapDays` are rendered beside the chips rather than implied — the
 * sixth design principle applied to a delta instead of to a duration.
 *
 * THE REFUSAL CARRIES THE REAL SPAN, and only on `tooClose`, because that is the only reason
 * code the server dates: `openMovement` publishes `gapDays` as the WIDEST span the scan log
 * can offer there and null on the other two. So the extra sentence appears exactly where
 * there is a number behind it, by construction rather than by a second condition.
 */
export function openMovementView(movement) {
  const m = movement || null;
  if (!m || !m.comparable) {
    const reason = MOVEMENT_REASONS[(m && m.reason) || "noScan"] || MOVEMENT_REASONS.noScan;
    const gap = m ? num(m.gapDays) : null;
    return {
      show: false,
      reason: gap === null
        ? reason
        : reason + " The two most recent scans are " + fmtDays(gap)
          + " apart; a week is the minimum.",
      gapDays: gap,
    };
  }
  const rows = (Array.isArray(m.rows) ? m.rows : []).map((r) => ({
    severity: String(r.severity),
    label: String(r.severity),
    open: num(r.open),
    prevOpen: num(r.prevOpen),
    delta: num(r.delta),
    chip: deltaChipView(r.open, r.prevOpen),
  }));
  const total = m.total || {};
  return {
    show: true,
    since: m.since || null,
    until: m.until || null,
    gapDays: num(m.gapDays),
    rows,
    total: {
      label: "All severities",
      open: num(total.open),
      prevOpen: num(total.prevOpen),
      delta: num(total.delta),
      chip: deltaChipView(total.open, total.prevOpen),
    },
    // WHICH two observations, in the display zone, so a reader can check the delta against
    // Scan History rather than take it on trust.
    //
    // `fmtDays`, NOT `days1`, AND THE PORTED COMMENT HERE ARGUED THE OPPOSITE. It read
    // "`days1`, not `fmtDays`: the interval is the ORIGIN of the delta, and `fmtDays` rounds
    // anything past 10 to a whole day — 13.5 days between two scans is not 14 days." That
    // reasoning is real and it is not the rule this register runs: P1.1 set the grain by
    // CONTEXT, not by importance — a duration inside a sentence takes whole days in words
    // (`fmtDays`), a duration in a table cell takes the tenth-of-a-day figure (`days1`) —
    // and "7.0 d apart" in the middle of an English sentence reads as a cell that escaped
    // its table. The cost is stated rather than hidden: `fmtDays` keeps a decimal under ten
    // days and rounds above it, so a 13.5-day interval prints "14 days" here. The exact
    // figure is still in `gapDays` on the model, and Scan History is one link away with the
    // two scan rows themselves.
    dates: "Between the scans on " + fmtDate(m.since) + " and " + fmtDate(m.until)
      + " — " + fmtDays(m.gapDays) + " apart.",
  };
}

/**
 * Movement, and what it is movement OF.
 *
 * `weekTrend` is the KM median now against the KM median replayed a week ago — both computed
 * from the same scoped population, so it is scope-correct by construction (see the module
 * header). Null when the register is under a week old or either endpoint's median is
 * unobservable: `executiveWeekTrend` refuses to substitute a lower bound for a median, so an
 * absent badge means "not comparable", never "unchanged".
 */
export function executiveMovementView(weekTrend) {
  if (!weekTrend) {
    return {
      show: false,
      reason: "Under a week of history, or the half-life was not observable at one of the two"
        + " endpoints. No comparison is published rather than a made-up one.",
    };
  }
  // `num`, NOT `Number`. `Number(null)` is 0 and 0 IS finite, so a weekTrend object carrying
  // no delta at all sailed through the old guard and drew a confident "±0 · vs last week" —
  // the page asserting MTTR had not moved when nothing had been measured.
  const delta = num(weekTrend.deltaDays);
  if (delta === null) {
    return { show: false, reason: "The week-over-week delta is not a number." };
  }
  const direction = delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const magnitude = fmtDays(Math.abs(delta));
  return {
    show: true,
    direction,
    // Up = slower remediation = worse. Stated in words so the arrow is never the only cue.
    label: direction === "flat"
      ? "Half-life unchanged versus last week"
      : "Half-life " + direction + " " + magnitude
        + " versus last week, so remediation is " + (direction === "up" ? "slower" : "faster"),
    magnitude: direction === "flat"
      ? "unchanged"
      : (direction === "up" ? "up " : "down ") + magnitude,
    current: num(weekTrend.current),
    previous: num(weekTrend.previous),
    days: num(weekTrend.days, 7),
  };
}

/** Tier -> the `.pill` kind. The tier's own words carry it; the tint only repeats them. */
const TIER_KINDS = { 1: "bad", 2: "warn", 3: "neutral" };

/**
 * Fix next — the ranked list, and the sentence that accounts for everything it left out.
 *
 * WHY THE FRONT DOOR'S SECOND BLOCK RATHER THAN ITS FIRST. The hero is the register's claim
 * about itself; this is the instruction that follows from it. Both sit above the severity
 * picture, because a distribution is a description and a leader reading top-down should meet
 * the two claims before the description.
 *
 * IT IS ABSENT ON A FIRST RUN, NOT EMPTY. `executiveFirstRunView` already names every figure
 * that is waiting and what unlocks it; a ranked list of nothing underneath that panel would be
 * a second, weaker statement of the same absence. `show` is decided by that same view rather
 * than by a second copy of the first-run rule.
 *
 * A SCANNED REGISTER WITH NOTHING RANKED IS A DIFFERENT STATE AND SAYS SO. `empty` is true
 * when the register has open rows but no group cleared a tier — which is good news — and the
 * unranked counts are the evidence for it rather than a blank panel.
 *
 * A PAYLOAD WITH NO `fixNext` KEY IS A THIRD STATE, and it is neither of those: an older
 * cached entry, or a server that did not compute the block. It withholds the list and says
 * so in one sentence, because a section that silently disappears is indistinguishable from a
 * register with nothing to fix.
 */
/**
 * THE QUERY A FIX-NEXT LINK LANDS ON, and the one rule it has to keep: THE FILTERED TABLE
 * MUST BE A SUPERSET OF THE GROUP, never a subset. A link that lands on fewer rows than the
 * card counted makes the register look like it lost them.
 *
 * Read off `domain/fixNext.ts`'s own `classify`, clause by clause:
 *
 *   tier 1  `exposureKnown && has_kev === true && exposedKeys.has(key)` — no SLA gate and no
 *           fix gate. So: `status=open&exposed=1`.
 *   tier 2  `awaiting_vendor_fix !== true`, past SLA, `fix_available_at` present, and
 *           (`has_kev` or `has_exploit`). So: `status=open&fix=fixable`.
 *   tier 3  the same minus the exploit signals, plus `severity === CRITICAL`. Same query.
 *
 * WHY NO `tier=kev` ON TIER 1, WHICH IS THE OBVIOUS-LOOKING MAPPING AND IS WRONG. The
 * register's `tier` filter is `program.riskTier`, and `riskTier` returns "kev" only when the
 * operator's RISK RULE has the KEV clause enabled (`firedSignals` tests `rule.kev &&
 * row.has_kev === true`). `fixNext` tier 1 reads `has_kev` directly and asks the rule
 * nothing. With the KEV clause switched off in Settings every tier-1 row classifies as
 * `exploit`, `epss`, `none` or `unknown`, and `tier=kev` would land on a table missing all of
 * them — a strict SUBSET, which is the one thing this link may not be. The same argument
 * rules `tier=kev,exploit` out of tier 2. The register has no SLA filter either, so the
 * lateness half of tiers 2 and 3 simply is not narrowed; a superset is the correct answer.
 *
 * THE OWNER DOES NOT TRAVEL, and that is a measurement rather than a preference.
 * `fixNext.ts` publishes `params.supportGroup` for exactly this link, but the register's
 * support-group scope is `activeSupportGroup` in `app.js` — module state, set only by the
 * header switcher and NEVER read out of the hash. A `supportGroup=` param on this URL would
 * be a key nothing reads: the table would open unscoped while the link claimed otherwise.
 * Teaching `overview.js` to read it instead would put two scopes on one page — a header
 * saying "all groups" over a table showing one — which is the incoherence the single-scope
 * rule in `app.js` exists to prevent. So the link narrows by TIER only, the card beside it
 * names the owner, and the register's own header is where a reader narrows to it.
 */
export function fixNextQuery(tier) {
  const parts = tier === 1
    ? ["status=open", "exposed=1"]
    : ["status=open", "fix=fixable"];
  return "?" + parts.join("&");
}

export function fixNextView(payload, boot) {
  const first = executiveFirstRunView(payload, boot);
  const block = (payload && payload.fixNext) || null;
  if (first.show) {
    return { show: false, firstRun: true, missing: false, items: [], unranked: null };
  }
  if (!block) {
    return {
      show: false,
      firstRun: false,
      missing: true,
      items: [],
      unranked: null,
      missingNote: "This payload carries no ranked list, so none is drawn. Every open finding"
        + " is still listed on OS vulnerabilities.",
    };
  }

  const groups = Array.isArray(block.groups) ? block.groups : [];
  const items = groups.map((g, i) => {
    const tier = num(g.tier, 0);
    const count = num(g.count, 0);
    const assets = num(g.assets, 0);
    const owner = g.owner === null || g.owner === undefined || g.owner === ""
      ? null
      : String(g.owner);
    const oldest = num(g.oldestAgeDays);
    const domain = g.domain === null || g.domain === undefined || g.domain === ""
      ? null
      : String(g.domain);
    const topCve = g.topCve && g.topCve.cve
      ? { cve: String(g.topCve.cve), count: num(g.topCve.count, 0) }
      : null;
    // EVERY PART IS OMITTED RATHER THAN DASHED. A dash inside a running sentence reads as
    // punctuation, not as an absence, so "7 open findings, — hosts" says nothing true. The
    // parts a group does not have simply are not in its sentence.
    //
    // CLAUSES, NOT A SENTENCE — "on" and "mostly" DROPPED. The joined form used to read "11
    // open findings on 4 hosts · mostly CVE-2024-3094 (5) · oldest 412 days · domain Payments":
    // a preposition stitching two clauses together in the FIRST one and a hedge word in the
    // second that the density walker counts the same as any other word. Every unit still names
    // itself exactly once (findings, hosts, days) and nothing measured is dropped to buy the
    // shorter form — the CVE's own count stays, because "which CVE, and how much of the group
    // is it" is two different facts and cutting the second to fit a word budget is exactly the
    // trade CLAUDE.md's own package brief rules out.
    const parts = [
      fmtCount(count) + " open " + pluralize(count, "finding"),
      assets > 0 ? fmtCount(assets) + " " + pluralize(assets, "host") : null,
      topCve ? topCve.cve + " (" + fmtCount(topCve.count) + ")" : null,
      // `fmtDays`, for the same reason the movement sentence above uses it: this is a clause
      // in a running sentence, not a table cell. "oldest 210 days", never "oldest 210.0 d".
      oldest === null ? null : "oldest " + fmtDays(oldest),
      domain === null ? null : "domain " + domain,
    ].filter(Boolean);
    const meta = parts.join(" · ");
    return {
      rank: i + 1,
      tier,
      tierLabel: String(g.label || ""),
      kind: TIER_KINDS[tier] || "neutral",
      owner,
      // Never a dash: a finding carrying no support group and no subscription is a gap in
      // ATTRIBUTION, and the register has words for that. The group is still real.
      ownerText: owner === null ? "No owner recorded" : owner,
      ownerKind: g.ownerKind || null,
      ownerKindWord: g.ownerKind === "supportGroup"
        ? " · support group"
        : g.ownerKind === "subscription" ? " · subscription" : null,
      count,
      assets,
      topCve,
      oldestDays: oldest,
      domain,
      meta,
      // `route` is "overview" for every group the server ranks; read rather than hard-coded,
      // so a later tier that lives on another page arrives correctly without a client edit.
      href: "#/" + String(g.route || "overview") + fixNextQuery(tier),
      linkLabel: "Open the OS vulnerabilities register",
    };
  });

  const u = block.unranked || {};
  const unranked = {
    noFix: num(u.noFix, 0),
    unclassified: num(u.unclassified, 0),
    insideSla: num(u.insideSla, 0),
    other: num(u.other, 0),
    // O1c: unobserved, and not yet past target at its last sighting — see domain/fixNext.ts.
    // Never folded into `insideSla`, which is a claim only an OBSERVED row can back.
    unknown: num(u.unknown, 0),
  };
  const ranked = num(block.ranked, 0);
  const openTotal = num(block.openTotal, 0);
  const groupsCut = num(block.groupsCut, 0);
  const findingsCut = num(block.findingsCut, 0);

  // ONE SENTENCE, A REASON PER COUNT, AND NO REASON WITH NOTHING BEHIND IT. A list captioned
  // "top 8" and nothing else has quietly deleted the rest of the backlog; a clause reading
  // "0 are waiting on a vendor fix" is a measurement of an empty bucket dressed as an
  // explanation, so a zero reason is dropped rather than printed.
  const clauses = [
    unranked.noFix ? fmtCount(unranked.noFix) + " are waiting on a vendor fix" : null,
    unranked.insideSla
      ? fmtCount(unranked.insideSla) + " are inside their SLA window"
      : null,
    // "unobserved, not yet late" — never "in SLA", never anything implying compliance: the
    // scanner has not confirmed it either way, so the sentence does not claim it did.
    unranked.unknown
      ? fmtCount(unranked.unknown) + " are unobserved, not yet late"
      : null,
    unranked.unclassified
      ? fmtCount(unranked.unclassified)
        + " could not be classified because no risk signal was captured"
      : null,
    unranked.other
      ? fmtCount(unranked.other) + " are past SLA without meeting any tier's bar"
      : null,
  ].filter(Boolean);
  const lead = fmtCount(ranked) + " of " + fmtCount(openTotal) + " open "
    + pluralize(openTotal, "finding") + " are ranked above.";
  const list = clauses.length > 1
    ? clauses.slice(0, -1).join(", ") + ", and " + clauses[clauses.length - 1]
    : clauses.join("");
  const unrankedSentence = clauses.length
    ? lead + " The rest are not: " + list + "."
    : lead + " Nothing is left over: every open finding earned a tier.";

  return {
    show: true,
    firstRun: false,
    missing: false,
    items,
    unranked,
    unrankedSentence,
    // THE SAME TWO NUMBERS, ON THE SURFACE. The figure and the picture come first and the
    // accounting one level down: this line is what a reader sees, and `unrankedSentence` is
    // what the `disclosure` under it holds.
    rankedShort: fmtCount(ranked) + " of " + fmtCount(openTotal) + " open "
      + pluralize(openTotal, "finding") + " ranked",
    ranked,
    openTotal,
    empty: items.length === 0,
    emptyReason: "Nothing to rank: no known-exploited finding on a reachable host, no"
      + " exploitable finding past its SLA window, and no critical finding past its window.",
    cutNote: groupsCut > 0
      ? fmtCount(groupsCut) + " more " + pluralize(groupsCut, "group") + " holding "
        + fmtCount(findingsCut) + " " + pluralize(findingsCut, "finding")
        + (groupsCut === 1 ? " is" : " are")
        + " not shown; the register lists every open finding."
      : null,
    // EXPOSURE IS A CURRENT-SCAN FACT, so tier 1 is only decidable when the scan carried the
    // field. `fixNext` publishes `exposureKnown: false` rather than a tier-1 count of 0,
    // because a zero there would be a measurement and this is a refusal to measure.
    exposureNote: block.exposureKnown === true
      ? null
      : "Tier 1 could not be measured: the last scan carried no exposure field, so a"
        + " known-exploited finding on a reachable host cannot be told from one that is not.",
    linkNote: "Each link opens the register filtered to that group's tier — a superset "
      + "of the group, since the register cannot narrow by owner from a link.",
  };
}

/**
 * The cold zone, as the one figure a leader reads about it: how much of the open backlog is
 * sitting on assets where nothing is moving.
 *
 * ONE NUMBER, AND IT IS A SHARE RATHER THAN A COUNT. "412 open findings are cold" is a figure
 * whose meaning changes with the size of the register; "31.4% of the backlog is cold" is the
 * same fact read against the only denominator that makes it comparable week to week. Both are
 * published — the share is the value, the pair behind it is the sentence underneath — because
 * a rate without its denominator is not a measurement.
 *
 * NULL IS AN ANSWER AND IT IS NOT ZERO. `cold_backlog_share_pct` is null over an empty
 * denominator — a register with no open findings at all has no cold SHARE, and rendering that
 * as 0.0% would say the backlog is all warm when there is no backlog. The card draws the muted
 * dash instead, which is what every other absent figure on this page draws.
 *
 * THE SHAPE IS CHECKED, NOT THE FLAG. `api_getExecutivePage` ships `coldZone` as a
 * `ColdZoneHeadline` — the totals and the clock, never the per-asset or per-group arrays — and
 * sets `totals` to null in exactly the case `measurable: false` describes. A payload that said
 * `measurable: true` over a null `totals` (an older server answering a newer client) would pass
 * a flag check and then throw inside the renderer, which `guard()` would dress as a red error
 * box for what is really an absence. So this decides for itself from what arrived.
 *
 * `coldZoneAsOfSource` IS CARRIED BECAUSE THE CLOCK CAN SLIP. Every duration in the cold-zone
 * family is measured at the LEDGER's clock — the newest flat scan's timestamp — so the same
 * saved ledger always reads the same number. Where the server could not find that clock it
 * falls back to the wall clock and says so, and a figure measured against "now" grows a little
 * every time the page is opened. That is a different reading from the one the card otherwise
 * promises, so the denominator sentence says which it is rather than quietly printing both the
 * same way. TRUE unless the server SAID it fell back: an older payload that carries no source
 * at all is not evidence of a wall-clock reading.
 *
 * AND THE MODE RIDES ALONG, for the reason the Cold zone page's caption spells out at length:
 * `cold_after_days` is the EFFECTIVE line in both modes, so one number reaches this card
 * whichever definition drew it, and "at least 47 days" means something different when a person
 * chose 47 than when the estate's tenth-idlest asset did. The card still prints ONE figure; the
 * denominator sentence is where the difference is stated.
 *
 * @param {object|null|undefined} payload  `api_getExecutivePage`'s reply
 */
export function coldShareView(payload) {
  const cz = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload.coldZone
    : null;
  const present = !!cz && typeof cz === "object" && !Array.isArray(cz);
  const totals = present && cz.totals && typeof cz.totals === "object" && !Array.isArray(cz.totals)
    ? cz.totals
    : null;
  const measurable = present && cz.measurable === true && totals !== null;
  const source = payload && typeof payload.coldZoneAsOfSource === "string"
    ? payload.coldZoneAsOfSource
    : null;
  // Absent means the older contract — the fixed window — and only the literal "relative" is
  // relative. Same refusal as pages/coldZoneModel.js's `coldZoneView`, for the same reason.
  const mode = present && cz.mode === "relative" ? "relative" : "fixed";
  const modeFields = {
    mode,
    targetSharePct: present ? num(cz.target_share_pct) : null,
    achievedSharePct: present ? num(cz.achieved_share_pct) : null,
    floorApplied: present && cz.floor_applied === true,
    derivedDays: present ? num(cz.derived_days) : null,
    floorDays: present ? num(cz.floor_days) : null,
  };
  if (!measurable) {
    return {
      show: false,
      measurable: false,
      atLedgerClock: source !== "wallClock",
      pct: null,
      openInCold: 0,
      openFindings: 0,
      coldAssets: 0,
      assetsWithOpen: 0,
      coldAfterDays: present ? num(cz.cold_after_days) : null,
      ...modeFields,
    };
  }
  return {
    show: true,
    measurable: true,
    ...modeFields,
    atLedgerClock: source !== "wallClock",
    pct: num(totals.cold_backlog_share_pct),
    openInCold: num(totals.open_in_cold, 0),
    openFindings: num(totals.open_findings, 0),
    coldAssets: num(totals.cold_assets, 0),
    assetsWithOpen: num(totals.assets_with_open, 0),
    coldAfterDays: num(cz.cold_after_days),
  };
}

/**
 * The front door on a ledger nobody has read, and what would change that.
 *
 * WHAT THIS REPLACES. With no scan saved, this page rendered `0 tracked lifecycles · 0
 * resolved · 0 open` and a row of severity tiles each reading 0 — every one of them a
 * confident zero over a population nobody has looked at.
 *
 * PRODUCT.md's corollary is the rule being applied: *"No MTTR yet" is a state a reader can
 * act on; "MTTR is 0 days" is a confident lie.* The same holds for a count. So on an unread
 * ledger the zero-valued blocks are SUPPRESSED rather than dashed — a dash still occupies the
 * slot of a figure and invites a reader to wait for it to fill — and this panel takes their
 * place, naming each missing figure with the ONE condition that unlocks it and where that
 * control lives.
 *
 * IT IS NOT ONE STATE, IT IS TWO. No scan at all is a first run. A scan that ran and saved
 * nothing is a MEASUREMENT: the tenant answered, and the answer was empty. `synced` keeps
 * them apart, because "no scan has run yet" over a completed scan would be false.
 *
 * EVERY ITEM'S ROUTE IS null HERE, and that is a fact about this register rather than an
 * oversight. gas_devsecops sends three of its items to Settings, because a register can be
 * switched off for collection there and its SLA windows are editable; this app collects one
 * population and takes its SLA windows from `src/domain/config.ts`, so there is no setting a
 * reader could change that would fill any of these four. The one control is the rail's Run
 * scan button, and `emptyState` renders a null-route item's label as plain text for exactly
 * that reason (ui/feedback.js).
 *
 * WHY IT IS PURE. Every unlock condition is a claim about the domain — the half-life needs a
 * closed lifecycle, the movement block needs two endpoints a week apart, the ranking needs
 * risk signals on record. Those are testable without a DOM and they are the part that can go
 * wrong.
 *
 * @param {object|null|undefined} payload  `api_getExecutivePage`'s reply
 * @param {object|null|undefined} boot     `bootstrap()`'s reply
 */
export function executiveFirstRunView(payload, boot) {
  const b = boot || {};
  const hero = executiveHeroView(payload);
  const synced = !!b.latestScan;
  if (hero.tracked > 0) return { show: false, synced, heading: "", hint: "", items: [] };

  // ONE LABEL, USED FOUR TIMES, so the four cannot drift apart. It names the CONTROL rather
  // than a page, because there is no page to send the reader to.
  const RUN_SCAN = "Run scan — the button in the rail";

  return {
    show: true,
    synced,
    heading: synced
      ? "The last scan saved no findings, so there is nothing here to measure yet."
      : "No scan has run yet, so nothing on this page has been measured.",
    hint: "Every figure below waits on a different thing. None of them is a zero, and none of"
      + " them is shown as one.",
    items: [
      {
        figure: "Remediation half-life",
        unlock: "One closed lifecycle with a readable clock. A finding is dated closed at the"
          + " scan that stopped seeing it, so the first close needs a second scan.",
        route: null,
        routeLabel: RUN_SCAN,
      },
      {
        figure: "Open findings by severity",
        unlock: "The first scan. Until one has run there is no open population to break down,"
          + " and a row of zeros would be a measurement of one nobody took.",
        route: null,
        routeLabel: RUN_SCAN,
      },
      {
        figure: "Fix next",
        unlock: "Risk signals captured by a scan: whether a finding is known-exploited,"
          + " whether a fix is published, and whether its host is reachable from outside."
          + " Nothing can be ranked before any of them is on record.",
        route: null,
        routeLabel: RUN_SCAN,
      },
      {
        figure: "Week-over-week movement",
        unlock: "Two scans at least seven days apart. Under a week of history there is no"
          + " comparison to publish, and none is invented.",
        route: null,
        routeLabel: RUN_SCAN,
      },
    ],
  };
}

// ----------------------------------------------------------------------------- the page

export async function renderExecutive(main, _params, ctx) {
  const boot = await bootstrap();

  // Which severities every metric on this page reflects — the app-wide "Display severity"
  // setting, so the exec view opens scoped exactly like Overview and MTTR; falls back to all
  // selectable if that setting is somehow empty.
  const sevScope = boot.settings.displaySeverities?.length
    ? [...boot.settings.displaySeverities]
    : [...boot.palette.selectable];
  // Null when every selectable severity is chosen (no filter → shares the MTTR page's default
  // cache entry); otherwise the chosen subset, which the server keeps alongside UNKNOWN.
  const severities = sevScope.length === boot.palette.selectable.length ? null : sevScope;

  // The scope in force, from the header switcher — a domain or a support group, at most one
  // of them; "" = no filter on that dimension. Same read as every other page.
  const domain = ctx.domain || "";
  const supportGroup = ctx.supportGroup || "";
  const scoped = Boolean(domain || supportGroup);

  // A SCOPE CHANGE NEEDS NO INVALIDATION: swrCall keys on name + JSON.stringify(params), so
  // each scope is its own entry and the previous one stays valid.
  // FOUR PARTS, IN PARALLEL. Each is its own google.script.run execution and Apps Script runs
  // them concurrently, so a cold front door costs its slowest read-model rather than the sum
  // of all four (a serial cold load was measured at 146 s). The server's part table
  // (api.ts `getExecutivePage`) keeps the keys disjoint, so the merge is the single-call payload.
  let paint;
  const execData = swrParts(
    "api_getExecutivePage",
    ["mttr", "insights", "coldZone", "byDomain"],
    { domain, supportGroup, severities },
    (fresh) => paint && paint(fresh),
  );

  // THE BRIEFING (2026-09-24, DESIGN.md §6a). The page is four headline figures, two splits
  // and the ranked list, read at a glance — every figure carrying a small picture of its own
  // claim (gas_shared/ui/briefing.js). The honesty rules did not move: a lower bound still
  // says "at least", an unread ledger still says "Not measured", and every picture repeats a
  // figure printed beside it. The ranked list is ONE block, Fix next, last on the page: shut,
  // it shows its top three; opened, the full list — with its cap and exposure caveats folded
  // in beside it — replaces them in place. (It was a "Fix first" preview above a separate,
  // folded Fix next: the same groups twice, under two names.)
  const statusHost = el("div", {});
  const noticeHost = el("div", {});
  const figuresHost = el("div", {});
  const splitsHost = el("div", {});
  // LAST ON THE PAGE, AND SHUT: the worklist, for a different reader on a different errand.
  // `fixOpen` outlives the paint — swrCall paints twice on a warm cache, so a section whose
  // open state lived on the node would snap shut under a reader who had just expanded it.
  const fixHost = el("div", {});
  let fixOpen = false;
  // THE TITLE BLOCK IS STATIC, AND THE h1 DOES NOT WAIT ON AN RPC.
  main.append(pageHeader({ route: "executive" }));
  // The scope chip qualifies every figure below it. Null when nothing is scoped.
  const scopeChips = scopeBar({ domain, supportGroup, onClear: ctx.clearScope });
  if (scopeChips) main.append(scopeChips);
  const brief = el("div", { class: "brief" });
  main.append(brief);
  brief.append(statusHost, noticeHost, figuresHost, splitsHost, fixHost);

  // This is the default landing page, so a single failing section must never blank the whole
  // view. Each section renders inside a guard: on error it logs a tagged trace and drops an
  // honest fallback into that host, while the rest of the page still paints.
  function guard(label, target, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[executive] " + label + " render failed:", e);
      clear(target).append(errorState("Couldn't render " + label + ".",
        { detail: String((e && e.message) || e) }));
    }
  }

  clear(figuresHost).append(
    el("div", { role: "status", "aria-label": "Computing the headline figures" },
      skeleton("line", { width: "220px" }),
      skeleton("stat", { width: "260px", height: "56px" })),
  );
  guard("the scan status", statusHost, renderStatus);

  paint = (payload) => {
    const first = executiveFirstRunView(payload, boot);
    guard("the first-run panel", noticeHost, () => renderFirstRun(first));
    guard("the headline figures", figuresHost, () => renderFigures(payload, first));
    // SUPPRESSED, not dashed — see `executiveFirstRunView`. The panel above has already named
    // what each of these waits on.
    if (first.show) {
      clear(splitsHost);
      clear(fixHost);
      return;
    }
    guard("the splits", splitsHost, () => renderSplits(payload));
    guard("the fix-next list", fixHost, () => renderFixNext(payload));
  };

  try {
    paint(await execData);
  } catch (e) {
    console.error("[executive] api_getExecutivePage failed:", e);
    clear(figuresHost).append(errorState("Couldn't load remediation data.", {
      detail: String((e && e.message) || e),
      onRetry: () => ctx.refresh(),
    }));
  }

  // ------------------------------------------------------------------- the first run

  function renderFirstRun(first) {
    clear(noticeHost);
    if (!first.show) return;
    noticeHost.append(emptyState(first.heading, first.hint, {
      variant: "firstrun",
      items: first.items,
    }));
  }

  // ---------------------------------------------------------------------- the status line

  /**
   * When every figure below was measured, in one line. It replaces the "Last scan" section:
   * the timestamp qualifies ALL of the page's numbers, so it belongs above them, not after.
   * A scan older than a week turns the dot amber and says how old in words.
   */
  function renderStatus() {
    clear(statusHost);
    const latest = boot.latestScan;
    if (!latest) {
      statusHost.append(briefStatus({ tone: "neutral", parts: ["No scan has run yet"] }));
      return;
    }
    const t = typeof latest.ts === "number" ? latest.ts : Date.parse(latest.ts);
    const stale = Number.isFinite(t) && Date.now() - t > 7 * 86400000;
    statusHost.append(briefStatus({
      tone: stale ? "warn" : "ok",
      parts: [
        "Scan of " + fmtDateTime(latest.ts),
        el("span", { class: stale ? "brief-status__warn" : null }, relativeAge(latest.ts)),
        fmtCount(latest.total) + " " + pluralize(num(latest.total, 0), "finding"),
        boot.hasCredentials ? null : statusPill("neutral", "Dry run", {
          lines: ["No Wiz credentials are stored; scans are simulated."],
        }),
        el("a", { class: "linklike", href: "#/history" }, "Scan history"),
      ],
    }));
  }

  // ------------------------------------------------------------------ the four figures

  function renderFigures(payload, first) {
    clear(figuresHost);
    const hero = executiveHeroView(payload);
    const open = openMovementView(payload && payload.movement);
    figuresHost.append(briefFigures(
      openFigure(open, hero),
      halfLifeFigure(hero, payload),
      first && first.show ? null : actFigure(payload),
      first && first.show ? null : coldFigure(payload),
    ));
  }

  /** Open findings now, the week-on-week change, and the two readings as a zero-based slope. */
  function openFigure(open, hero) {
    const label = tipLabel("Open findings", { term: "movement" });
    if (!open.show) {
      return briefFigure({
        label,
        value: hero.tracked ? fmtCount(hero.open) : absentText,
        caption: "No week-on-week comparison yet. " + open.reason,
      });
    }
    const t = open.total;
    return briefFigure({
      label,
      value: fmtCount(t.open),
      delta: briefDelta(t.chip),
      visual: slopeMark({
        from: t.prevOpen,
        to: t.open,
        fromLabel: fmtCount(t.prevOpen) + " · " + fmtDate(open.since),
        toLabel: fmtCount(t.open) + " · " + fmtDate(open.until),
        label: "Open findings went from " + fmtCount(t.prevOpen) + " to " + fmtCount(t.open)
          + " between " + fmtDate(open.since) + " and " + fmtDate(open.until),
      }),
      caption: "Scans " + fmtDays(open.gapDays) + " apart",
    });
  }

  /** The half-life, a ring of how much of the tracked backlog is fixed, and its honesty. */
  function halfLifeFigure(view, payload) {
    const half = executiveMovementView(payload && payload.weekTrend);
    const delta = half.show
      ? el("span", {
        class: "brief-delta brief-delta--"
          + (half.direction === "flat" ? "neutral" : half.direction === "up" ? "bad" : "ok"),
        "aria-label": half.label,
      }, half.magnitude)
      : null;
    const value = !view.measured
      ? "Not measured"
      : (view.isLowerBound ? "≥ " : "") + fmtCount(Math.round(view.days));
    return briefFigure({
      label: tipLabel("Half-life", heroHelp(view)),
      value,
      valueClass: view.measured ? null : "brief-value--text",
      unit: view.measured ? pluralize(Math.round(view.days), "day") : null,
      delta,
      visual: view.tracked
        ? [
          ringMark({
            part: view.resolved,
            whole: view.tracked,
            label: fmtCount(view.resolved) + " of " + fmtCount(view.tracked)
              + " tracked findings resolved",
          }),
          el("p", { class: "brief-caption" },
            el("strong", {}, fmtCount(view.resolved)), " fixed", el("br"),
            el("strong", {}, fmtCount(view.open)), " still open"),
        ]
        : null,
      caption: view.isLowerBound
        ? "At least: the curve never falls to half inside the window."
        : view.backlogLine || null,
      link: { href: "#/mttr", text: "MTTR & SLA" },
    });
  }

  /**
   * The hero label's tip: the STATE picks the lines, and the LABEL picks the term. The term
   * does not move with the state — a control whose destination changes with the data is a
   * control a reader cannot learn.
   */
  function heroHelp(view) {
    if (view.isLowerBound) {
      return {
        term: "half-life",
        lines: [
          "The curve never falls to half inside the window, so there is no median.",
          "The half-life is at least the longest thing observed — the figure above.",
        ],
      };
    }
    if (!view.measured) {
      return {
        term: "half-life",
        lines: [
          "No lifecycle has a readable clock yet: not measured, not zero.",
          "The half-life needs at least one observation to rest on.",
        ],
      };
    }
    return { term: "half-life" };
  }

  /** How many owner groups have something that cannot wait — one square per group, by tier. */
  function actFigure(payload) {
    const view = fixNextView(payload, boot);
    const label = tipLabel("Act now", { term: "fix-next" });
    if (!view.show) {
      return briefFigure({ label, value: absentText, caption: view.missingNote || null });
    }
    if (view.empty) {
      return briefFigure({ label, value: "0", unit: "groups", caption: view.emptyReason });
    }
    const byTier = new Map();
    view.items.forEach((it) => {
      const k = it.tier;
      if (!byTier.has(k)) byTier.set(k, { label: it.tierLabel, n: 0 });
      byTier.get(k).n += 1;
    });
    const legend = [...byTier.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => fmtCount(v.n) + " " + v.label.toLowerCase());
    return briefFigure({
      label,
      value: fmtCount(view.items.length),
      unit: pluralize(view.items.length, "group"),
      visual: unitSquares({
        tones: view.items.map((it) => "t" + Math.min(Math.max(it.tier, 1), 3)),
        label: legend.join(", "),
      }),
      caption: legend.join(" · ") + ". " + view.rankedShort + ".",
      action: fixButton("Fix next"),
    });
  }

  /**
   * The share of the open backlog nobody has moved, as filled dots out of a hundred. Its
   * DENOMINATOR SENTENCE is the old card's, word for word — window, relative-mode clause and
   * clock caveat — leading the label's tip and riding on the node (`briefFigure` carries
   * `figureCard`'s contract), so the percentage never appears without its base.
   */
  function coldFigure(payload) {
    const view = coldShareView(payload);
    if (!view.show) {
      return briefFigure({
        label: "Cold zone",
        help: { term: "cold-zone" },
        value: "Not measured",
        valueClass: "brief-value--text",
        caption: "Appears once a scan has saved the movement before it.",
      });
    }
    const windowText = view.coldAfterDays === null
      ? "the cold-zone window"
      : "at least " + fmtDays(view.coldAfterDays);
    const targetText = fmtCount(view.targetSharePct) + "%";
    const modeClause = view.mode !== "relative"
      ? ""
      : view.floorApplied === true
        ? " — the floor, which holds the zone smaller than the " + targetText + " asked for"
        : " — the line relative mode set so the idlest " + targetText + " of assets with open"
          + " findings are cold";
    const clock = view.atLedgerClock
      ? "Measured at the last scan, never against today."
      : "Measured against the current time rather than the last scan — the clock the ledger"
        + " was measured at could not be read, so this figure moves as the page is reopened.";
    return briefFigure({
      label: "Cold zone",
      help: { term: "cold-zone" },
      denominator:
        fmtCount(view.openInCold) + " of " + fmtCount(view.openFindings) + " open findings, on "
        + fmtCount(view.coldAssets) + " of " + fmtCount(view.assetsWithOpen) + " assets with"
        + " open findings where nothing has been resolved for " + windowText + modeClause + ". "
        + clock,
      value: view.pct === null ? absentText : pct1(view.pct),
      visual: dotGrid({
        sharePct: view.pct,
        label: fmtCount(view.openInCold) + " of " + fmtCount(view.openFindings)
          + " open findings sit on assets with nothing resolved for " + windowText,
      }),
      caption: el("span", {},
        el("strong", {}, fmtCount(view.openInCold)), " of " + fmtCount(view.openFindings)
        + " open findings, on ",
        el("strong", {}, fmtCount(view.coldAssets)), " of " + fmtCount(view.assetsWithOpen)
        + " assets idle for " + windowText + "."
        + (view.atLedgerClock ? "" : " This figure moves as the page is reopened.")),
      link: { href: "#/coldZone", text: "Cold zone" },
    });
  }

  // ------------------------------------------------------------------------- the splits

  function renderSplits(payload) {
    clear(splitsHost);
    const splits = [renderByDomain(payload && payload.byDomain), renderSeverity(payload)]
      .filter(Boolean);
    if (splits.length) splitsHost.append(briefSplits(...splits));
  }

  /**
   * Where the open backlog sits — by domain, or one level down when the scope is a domain or
   * a support group. The Kaplan-Meier medians the old table carried ride in the foot, for the
   * groups whose curve reached half; a group that never did is simply not named there.
   */
  function renderByDomain(byDomain) {
    const view = executiveByDomainView(byDomain, { domainNames: boot.domainNames });
    if (!view.show) return null;
    const parts = foldTail(
      view.rows.map((r, i) => ({ label: r.name, value: r.open, tone: "r" + (i + 1) })),
      4,
    );
    const medians = view.rows
      .filter((r) => r.kmMedian !== null && r.kmMedian !== undefined)
      .map((r) => r.name + " " + fmtSpan(r.kmMedian));
    const noun = view.columnHeader.toLowerCase();
    return briefSplit({
      label: "By " + noun,
      parts,
      aria: "Open findings by " + noun + ": "
        + parts.map((p) => p.label + " " + fmtCount(p.value)).join(", "),
      foot: medians.length
        ? el("span", {},
          tipLabel("Median MTTR where reached", {
            term: "half-life",
            lines: [
              "Kaplan-Meier median time to remediation for each group.",
              "A group whose curve never falls to half has no median yet; MTTR & SLA"
              + " publishes the bound.",
            ],
          }),
          ": " + medians.join(" · "))
        : null,
      // THE CAP STAYS ITS OWN PARAGRAPH, on the surface — a population statement about what
      // the split left out (top 20 assets), not a caption to be folded into the foot.
      after: [view.cutNote ? el("p", { class: "small muted" }, view.cutNote) : null],
    });
  }

  /**
   * The open backlog by severity. Where a week-on-week comparison exists its rows carry the
   * change under each count; otherwise the scoped tally stands alone (see
   * `executiveSeverityView` — exactly one of the two is ever on the page).
   */
  function renderSeverity(payload) {
    const open = openMovementView(payload && payload.movement);
    const rank = (sev) => {
      const i = boot.palette.order.indexOf(sev);
      return i < 0 ? 99 : i;
    };
    let parts;
    let foot = null;
    let note = null;
    if (open.show && open.rows.length) {
      parts = [...open.rows]
        .sort((a, b) => rank(a.severity) - rank(b.severity))
        .map((r) => ({
          label: titleCase(r.severity),
          value: r.open,
          tone: r.severity,
          note: briefDelta(r.chip, { form: "count" }),
        }));
    } else {
      const view = executiveSeverityView({
        order: boot.palette.order,
        scope: sevScope,
        bootCounts: boot.openCounts,
        payload: payload && payload.severityCounts,
        scoped,
        movement: payload && payload.movement,
      });
      if (!view.show || view.pending || !view.tiles.length) return null;
      parts = view.tiles.map((t) => ({ label: titleCase(t.sev), value: t.count, tone: t.sev }));
      // THE POPULATION LINE STAYS ON THE SURFACE in the fallback, short form printed and its
      // reason on a tip — the tally can leave a level out, and the reader must be told.
      foot = view.populationExplain
        ? tipLabel(view.populationLine, { lines: view.populationExplain })
        : view.populationLine;
      note = view.note || null;
    }
    return briefSplit({
      label: tipLabel("By severity", {
        lines: [
          "Severity is the grade Wiz put on the finding, counted over OPEN findings only.",
        ],
      }),
      parts,
      aria: "Open findings by severity: "
        + parts.map((p) => fmtCount(p.value) + " " + p.label).join(", "),
      foot,
      after: [note ? el("p", { class: "small muted" }, note) : null],
    });
  }

  function titleCase(s) {
    const t = String(s || "");
    return t.charAt(0) + t.slice(1).toLowerCase();
  }

  // ------------------------------------------------------------------------ fix next

  /** Opens the folded Fix next section and brings it into view. */
  function fixButton(text) {
    return el("button", {
      type: "button",
      class: "brief-more",
      onclick: () => {
        const details = fixHost.querySelector("details");
        if (!details) return;
        details.open = true;
        fixOpen = true;
        // No glide for a reader who asked for less motion — helpPage.js makes the same call.
        details.scrollIntoView({ block: "start", behavior: motionOk() ? "smooth" : "auto" });
      },
    }, text, el("span", { "aria-hidden": "true" }, " →"));
  }

  /**
   * The ranked list of GROUPS — last on the page, and behind its own heading.
   *
   * NO CHART AND NO CANVAS, which is the module header's hard rule and is not relaxed for a
   * ranking. The order IS the claim, so it is a table with a rank column rather than a stack
   * of divs: a screen reader hears "row 1 of 8" and gets the same argument the page is making
   * visually. (It was an `<ol>` until the prose round — see DESIGN.md §9.)
   *
   * EVERY ROW CARRIES ITS UNITS. "7" is not a figure; "7 open findings" is. A group whose
   * rows have no readable age, no CVE and no single domain simply says less, rather than
   * printing a dash where each of those would have gone.
   *
   * SHUT, IT PREVIEWS; OPEN, IT LISTS. The shut section shows its top three rows (the
   * briefing's `briefList`) under the heading, and opening it swaps them for the full table,
   * so the same groups are never on screen twice.
   *
   * COLLAPSIBLE, AND SHUT UNTIL A READER OPENS IT. This is the page's one WORKLIST — a
   * different reader on a different errand from the leader the hero is written for — and it
   * is also its longest block by a wide margin. Everything it holds folds together, the
   * caveats with the figures they qualify, so nothing in it is ever on screen without its
   * caveat; the denominator rides on the heading so the shut section still says how much of
   * the backlog is behind it. See the host declaration above for why `fixOpen` is the page's
   * and not the node's.
   */
  function renderFixNext(payload) {
    const view = fixNextView(payload, boot);
    clear(fixHost);
    if (!view.show) {
      if (view.missing) {
        // NOT COLLAPSIBLE, and that is not an inconsistency. There is no section here to fold
        // — one sentence saying why the list is absent is the whole block, and a toggle over
        // a single sentence is a control that hides an honesty statement and buys nothing.
        fixHost.append(sectionLabel("Fix next", { term: "fix-next" }));
        fixHost.append(el("p", { class: "small muted" }, view.missingNote));
      }
      return;
    }

    // THE RANKING RULE IS A DEFINITION, so it lives where a definition lives: the `fix-next`
    // entry, reached from the heading. `linkNote` RIDES ALONG ON THE SAME TRIGGER rather than
    // growing a second `?` beside it — it used to be its own surface paragraph under the list
    // ("Each link opens the register unfiltered…"), which is an EXPLANATION of what a click
    // does, not an honesty statement a reader needs without asking. The book's own two lines
    // are read explicitly (`findEntry`, not the `{term}` shape `tipLabel` would otherwise
    // resolve to) so the caller's line can sit alongside them in one card instead of replacing
    // them — the same "own copy first, book's copy behind it" order `figureCard`'s
    // `figureCardModel` uses for a denominator.
    const fixNextEntry = findEntry("fix-next");
    // THE DENOMINATOR IS THE SHUT SECTION'S OWN CAPTION. "25 of 70 open findings ranked" used
    // to sit under the table as a surface paragraph; it is the one line that tells a reader
    // what is behind the toggle and how much of the backlog it speaks for, so it rides on the
    // heading instead and is legible whether the section is open or closed. It is NOT moved
    // behind a signifier — the disclosure under it still holds the five reasons, exactly as
    // before — it moved UP, onto the thing it measures.
    const section = collapsibleSection("Fix next", {
      help: {
        term: "fix-next",
        lines: [...(fixNextEntry ? fixNextEntry.lines : []), view.linkNote],
      },
      hint: view.rankedShort,
      open: fixOpen,
      // Per reader, across visits — the flag above only survives this page's own repaints.
      remember: "execFixNext",
      onToggle: (o) => { fixOpen = o; preview.hidden = o; },
    });
    const preview = previewOf(view);
    preview.hidden = section.node.open;
    fixHost.append(section.node, preview);
    const fix = section.body;

    if (view.empty) {
      fix.append(emptyState("Nothing is ranked.", view.emptyReason));
    } else {
      // A RANKED TABLE, NOT AN ORDERED LIST — and the order is still the claim. The `<ol>`
      // this replaces drew each group as a pill, a link and a `·`-joined meta sentence ("2
      // open findings · 1 host · CVE-2026-90001 (1) · oldest 210 days · domain CROSS"), which
      // is five facts in five different units set as one run of prose. Eight of them were
      // eight of this page's nine prose blocks under the density walker, and a reader
      // comparing "oldest 210 days" against "oldest 46 days" three rows down was scanning
      // sentences for a number. A table gives every fact its own column, so the ages compare
      // down one column and the counts down another; the rank column keeps "1 of 8" as a
      // statement a screen reader makes ("row 1 of 8"), which is what the `<ol>` was for.
      //
      // THE OPEN COLUMN CARRIES A TALLY, one unit for the whole table (the shipped DevSecOps
      // Executive pattern), so the magnitudes read against each other at a glance. The fine
      // ladder, capped at twelve marks, because these are small counts in a narrow column.
      //
      // `it.meta` STAYS ON THE VIEW and on every link's accessible name: the sentence is still
      // the right shape for a screen reader announcing one row, and the tests pin it.
      const tableUnit = unitScale(
        view.items.reduce((m, it) => (it.count > m ? it.count : m), 0),
        { units: FINE_UNITS, maxMarks: 12 },
      );
      fix.append(dataTable({
        className: "fixnext-table",
        columns: [
          { key: "rank", label: "#", className: "num", cell: (r) => String(r.rank) },
          { key: "tier", label: "Tier", cell: (r) => statusPill(r.kind, r.tierLabel) },
          {
            key: "owner",
            label: "Group",
            cell: (r) => el("span", {},
              el("a", {
                class: "linklike fixnext-repo",
                href: r.href,
                "aria-label": r.tierLabel + " — " + r.ownerText + ", " + r.meta + ". "
                  + r.linkLabel,
              }, r.ownerText),
              r.ownerKindWord ? el("span", { class: "small muted" }, r.ownerKindWord) : null),
          },
          {
            key: "count",
            label: "Open",
            className: "num",
            cell: (r) => el("span", {},
              unitRow(r.count, {
                unit: tableUnit,
                label: fmtCount(r.count) + " open, one mark per "
                  + (tableUnit === 1 ? "finding" : fmtCount(tableUnit) + " findings"),
              }),
              el("span", { class: "num" }, fmtCount(r.count))),
          },
          {
            key: "assets",
            label: "Hosts",
            className: "num",
            cell: (r) => (r.assets > 0 ? fmtCount(r.assets) : absent()),
          },
          {
            key: "cve",
            label: "Leading CVE",
            help: ["The CVE carried by the most findings in the group, and how many of them."],
            cell: (r) => (r.topCve
              ? el("span", {}, r.topCve.cve, " ",
                el("span", { class: "small muted num" }, "(" + fmtCount(r.topCve.count) + ")"))
              : absent()),
          },
          {
            key: "oldest",
            label: "Oldest",
            className: "num",
            // `days1` in a cell, `fmtDays` in a sentence — the grain is the context's, and the
            // meta sentence on the link keeps its worded whole days.
            cell: (r) => (r.oldestDays === null ? absent() : days1(r.oldestDays)),
          },
          { key: "domain", label: "Domain", cell: (r) => (r.domain === null ? absent() : r.domain) },
        ],
        rows: view.items,
      }));
    }

    // The five reasons behind the unranked rest, in a closed `disclosure`. NOT a tip: the
    // sentence is an ACCOUNTING, and a hover card is the wrong shape for something a reader
    // may want to read twice and compare against the register pages. The two numbers it
    // accounts for are on the section's own heading now — see `hint` above.
    fix.append(disclosure(
      "Why the rest are not ranked",
      el("p", { class: "small muted" }, view.unrankedSentence),
    ));
    // KEPT ON THIS SECTION'S SURFACE. A cap is a task constraint — the reader is looking at a
    // list that stops before the backlog does — and so is a tier that could not be measured at
    // all. Neither is behind a second signifier: they fold with the table they qualify, which
    // is the one arrangement in which a figure is never on screen without its caveat.
    if (view.cutNote) fix.append(el("p", { class: "small muted" }, view.cutNote));
    if (view.exposureNote) {
      fix.append(el("p", { class: "small muted" }, view.exposureNote));
    }
    // `view.linkNote` ITSELF IS UNCHANGED AND STILL ON THE VIEW MODEL — only the render moved,
    // onto the heading's own tip above. See that append for why.
  }

  /** The shut section's top three rows, and the way into the rest. Empty when nothing ranked. */
  function previewOf(view) {
    const preview = el("div", { class: "brief-fix__preview" });
    if (view.empty) return preview;
    preview.append(briefList({
      label: null,
      rows: view.items.slice(0, 3).map((r) => ({
        tone: "t" + Math.min(Math.max(r.tier, 1), 3),
        primary: r.ownerText,
        secondary: r.tierLabel,
        figure: fmtCount(r.count) + " open",
        meta: r.oldestDays === null ? "" : fmtDays(r.oldestDays),
        href: r.href,
        aria: r.tierLabel + " — " + r.ownerText + ", " + r.meta + ". " + r.linkLabel,
      })),
    }));
    if (view.items.length > 3) {
      preview.append(fixButton("All " + fmtCount(view.items.length) + " "
        + pluralize(view.items.length, "group")));
    }
    return preview;
  }
}
