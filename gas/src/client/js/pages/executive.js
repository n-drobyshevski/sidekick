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

import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import {
  clear, dataTable, disclosure, el, emptyState, errorState, fmtCount,
  fmtDate, fmtDateTime, fmtDays, fmtSpan, heroStat, num, pageHeader, pluralize, relativeAge,
  scopeBar, sectionLabel, sevKeyRow, sevSegmentBar, skeleton, statRow, statusPill, tipLabel,
} from "../ui.js";
// THE HALF-LIFE DECISION IS IMPORTED, NOT REPEATED. `execMttrSlice` is a slice of the MTTR
// page's own payload (api.ts says so), so the rule that turns `{median, medianLowerBound}`
// into a sentence has to be the same rule on both pages or the front door and the detail page
// could describe the same estimate differently. It lives on the page that owns the clock.
import { kmHalfLifeView } from "./mttr.js";
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

  return {
    measured: half.measured,
    value: half.value,
    isLowerBound: half.isLowerBound,
    days: half.days,
    tracked,
    resolved,
    open,
    qualifier,
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
 * @param {{order: string[], scope: string[], bootCounts: object,
 *          payload: object|null|undefined, scoped: boolean}} args
 */
export function executiveSeverityView({ order, scope, bootCounts, payload, scoped }) {
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
 * per-support-group when a domain is picked — because splitting BY domain while scoped TO one
 * domain is a single row restating the hero. Only `mttrByDomainData` aliases `group` into
 * `domain`, so the name has to be read through `group ?? domain` or the support-group split
 * renders a column of blanks.
 *
 * THE ONE-ROW GUARD APPLIES TO BOTH DIMENSIONS HERE, which is a deliberate divergence from
 * mttr.js (it guards only the support-group branch). Under a support-group scope the dimension
 * is still "domain" while `domainNames` stays register-wide, so that gate alone would happily
 * draw a one-row table for a group living in a single domain.
 *
 * EVERY GROUP IS LISTED. This used to cap at five and call itself a summary, which quietly made
 * the section unable to answer the question it poses: a domain outside the top five by open
 * backlog could carry the worst MTTR on the page and never appear, with nothing on screen
 * saying rows had been dropped. Ordering still puts the biggest backlog first.
 *
 * @param {object|null|undefined} byDomain  the server's `byDomain` slice
 * @param {{domainNames: string[]}} args
 */
export function executiveByDomainView(byDomain, { domainNames }) {
  if (!byDomain || !byDomain.rows || !byDomain.rows.length) return { show: false };
  const isSg = byDomain.dimension === "supportGroup";
  if (!isSg && (domainNames || []).length < 2) return { show: false };
  if (byDomain.rows.length < 2) return { show: false };
  const rows = [...byDomain.rows]
    .sort((a, b) => (b.open ?? 0) - (a.open ?? 0))
    .map((r) => ({ name: r.group ?? r.domain, kmMedian: r.kmMedian, open: r.open ?? 0 }));
  return {
    show: true,
    title: isSg ? "MTTR by support group" : "MTTR by domain",
    columnHeader: isSg ? "Support group" : "Domain",
    rows,
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
      href: "#/" + String(g.route || "overview"),
      linkLabel: "Open the OS vulnerabilities register",
    };
  });

  const u = block.unranked || {};
  const unranked = {
    noFix: num(u.noFix, 0),
    unclassified: num(u.unclassified, 0),
    insideSla: num(u.insideSla, 0),
    other: num(u.other, 0),
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
    linkNote: "Each link opens the register unfiltered; a later package wires the filter.",
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
  let paint;
  const execData = swrCall(
    "api_getExecutivePage",
    { domain, supportGroup, severities },
    (fresh) => paint && paint(fresh),
  );

  const noticeHost = el("div", {});
  const heroHost = el("div", {});
  // Directly under the hero and ABOVE the severity picture: the hero states the register's
  // claim about itself, this states what follows from it, and only then comes the description.
  const fixHost = el("div", {});
  const sevHost = el("div", {});
  const byDomainHost = el("div", {});
  const scanHost = el("div", {});
  // THE TITLE BLOCK IS STATIC, AND THE h1 DOES NOT WAIT ON AN RPC. The metric header below is
  // built inside `renderHero`, which runs only once the fetch resolves — so the loading
  // skeleton and the fetch-failure errorState each rendered a page with NO `<h1>` in it at
  // all. Appended here instead, once, ahead of every host: the page's name is not a function
  // of its data. Two stacked `.page-header` blocks is the shape gas_ai's `problems` /
  // `combos` / `config` already have.
  main.append(pageHeader({ route: "executive" }));
  // The scope chip qualifies every figure below it, so it sits between the page's name and
  // the first of them. Null when nothing is scoped.
  const scopeChips = scopeBar({ domain, supportGroup, onClear: ctx.clearScope });
  if (scopeChips) main.append(scopeChips);
  main.append(noticeHost, heroHost, fixHost, sevHost, byDomainHost, scanHost);

  // This is the default landing page, so a single failing section must never blank the whole
  // view. Each section renders inside a guard: on error it logs a tagged trace (so a
  // recurrence is diagnosable to the exact section) and drops an honest fallback into that
  // host, while the rest of the page still paints.
  function guard(label, target, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[executive] " + label + " render failed:", e);
      // errorState, NOT emptyState. A section that THREW is a defect in the app; an empty
      // section is a state the register is legitimately in. They were the same dashed box in
      // the same role="status" here, which announced a crash to a screen reader as calm news
      // and dropped the exception on the floor. The disclosure keeps it.
      clear(target).append(errorState("Couldn't render " + label + ".",
        { detail: String((e && e.message) || e) }));
    }
  }

  clear(heroHost).append(
    el("div", { role: "status", "aria-label": "Computing the remediation half-life" },
      skeleton("line", { width: "220px" }),
      skeleton("stat", { width: "260px", height: "56px" })),
  );
  guard("the last-scan caption", scanHost, renderScan);
  // Painted early ONLY where the numbers are already in hand: unscoped, they come off
  // bootstrap and the repaint below is a no-op (see executiveSeverityView). With no scan at
  // all this is certainly a first run, so nothing is drawn and the panel speaks instead.
  if (boot.latestScan) {
    guard("open findings by severity", sevHost, () => renderSeverity(null));
  }

  paint = (payload) => {
    const first = executiveFirstRunView(payload, boot);
    guard("the first-run panel", noticeHost, () => renderFirstRun(first));
    guard("the half-life", heroHost, () => renderHero(payload, first));
    // SUPPRESSED, not dashed. See `executiveFirstRunView`: a dash still holds a figure's slot
    // and reads as "coming", while the panel above has already named what each of these waits
    // on. All three are cleared so a stale paint cannot leave zeros behind them.
    if (first.show) {
      clear(fixHost);
      clear(sevHost);
      clear(byDomainHost);
      return;
    }
    guard("the fix-next list", fixHost, () => renderFixNext(payload));
    guard("open findings by severity", sevHost, () => renderSeverity(payload));
    guard("MTTR by domain", byDomainHost, () => renderByDomain(payload && payload.byDomain));
  };

  try {
    paint(await execData);
  } catch (e) {
    console.error("[executive] api_getExecutivePage failed:", e);
    clear(heroHost).append(errorState("Couldn't load remediation data.", {
      detail: String((e && e.message) || e),
      onRetry: () => ctx.refresh(),
    }));
    // Unscoped, the severity block already holds bootstrap's numbers and those are still
    // true — leave them. Scoped, it holds the pending placeholder, and falling back to the
    // register-wide tally would be exactly the lie this page was rewired to stop telling.
    if (scoped) {
      clear(sevHost).append(errorState("Couldn't load counts for this scope.",
        { detail: String((e && e.message) || e) }));
    }
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

  // ------------------------------------------------------------------------------ hero

  function renderHero(payload, first) {
    const view = executiveHeroView(payload);
    clear(heroHost);

    const stats = [
      statRow("Tracked", fmtCount(view.tracked), "lifecycles in the ledger"),
      statRow("Resolved", fmtCount(view.resolved), "closed findings — the estimator's events"),
      statRow(
        "Still open",
        fmtCount(view.open),
        "kept in as right-censored observations",
        null,
        { term: "censoring" },
      ),
    ];

    // NO `route`: the h1 is in the title block appended once at the top of renderExecutive.
    heroHost.append(pageHeader({
      hero: heroStat("Remediation half-life", view.value, view.qualifier, heroHelp(view)),
      aside: renderMovement(payload),
      // "Tracked 0 · Resolved 0 · Still open 0" is three zeros over a ledger nobody has read.
      // The hero's own "Not measured" and its qualifier already carry the honest version, and
      // the panel above names what the counts wait on.
      stats: first && first.show ? [] : stats,
    }));
    heroHost.append(curveNote());
  }

  /**
   * The hero label's tip: the STATE picks the lines, and the LABEL picks the term.
   *
   * THE TERM DOES NOT MOVE WITH THE STATE. The trigger sits on the words "Remediation
   * half-life", so the entry it navigates to on Enter is that figure's own definition,
   * whatever the figure happens to read this week. A control whose destination changes with
   * the data is a control a reader cannot learn. The state-specific sentence LEADS the lines
   * instead, and `lower-bound` stays reachable from the Key sheet (the by-domain table's own
   * footnote naming it is gone — the column heading's own tip already says what its dash
   * means, see `renderByDomain`).
   */
  function heroHelp(view) {
    if (view.isLowerBound) {
      return {
        term: "half-life",
        lines: [
          "The survival curve never falls to half within the observed window, so there is no"
          + " median to publish.",
          "More than half of what is tracked is still open, so the half-life is at least the"
          + " longest thing observed, which is the figure above.",
        ],
      };
    }
    if (!view.measured) {
      return {
        term: "half-life",
        lines: [
          "No lifecycle has a readable clock yet. This is not measured, not zero: the"
          + " half-life needs at least one observation to rest on.",
        ],
      };
    }
    return { term: "half-life" };
  }

  /**
   * Where the curve is, and why it is not here.
   *
   * The hero draws the estimate. The CURVE itself is not in this payload — `execMttrSlice`
   * ships two scalars — so this points at the page that has it rather than drawing an empty
   * box on the front door or paying 170 KB for a chart the landing page was sliced to avoid.
   */
  function curveNote() {
    return el("p", { class: "small muted" },
      tipLabel("Survival curve", {
        lines: [
          "This page is sent the estimate only, not the curve behind it. The curve, its"
          + " censor markers and the per-severity split are on MTTR & SLA.",
        ],
      }),
      " → ",
      el("a", { class: "linklike", href: "#/mttr" }, "MTTR & SLA"));
  }

  /**
   * One row of the movement strip: a severity, its pill, and the pair the pill is FROM.
   *
   * The raw pair rides beside the delta on purpose. A pill reading "down 9" is a claim about
   * two numbers, and a reader who cannot see both has to trust it; "27 open, was 36" is the
   * arithmetic in the open. A null chip means the previous count was not measurable, and that
   * renders as words rather than as a ±0 (see `deltaChipView`).
   *
   * THE GLYPH NEVER CARRIES THE MEANING. It is `aria-hidden` and the pill's own visible text
   * spells the direction ("up 4" / "down 4" / "unchanged"), so neither the triangle nor the
   * tint is the only cue.
   */
  function movementRow(label, r) {
    const row = el("div", { class: "movement-row" },
      el("span", { class: "movement-label small" }, label));
    if (r.chip) {
      const glyph = r.chip.direction === "up" ? "▲" : r.chip.direction === "down" ? "▼" : "=";
      row.append(el("span", {
        class: "pill " + r.chip.kind,
        "aria-label": label + ", " + r.chip.aria,
      }, el("span", { "aria-hidden": "true" }, glyph), " " + r.chip.text));
    } else {
      row.append(el("span", { class: "small muted" }, "no comparison"));
    }
    row.append(el("span", { class: "small muted movement-counts" },
      fmtCount(r.open) + " open, was " + fmtCount(r.prevOpen)));
    return row;
  }

  /**
   * Movement, as two measurements rather than one.
   *
   * THE OPEN BACKLOG LEADS. It is observable on any register that has scanned twice a week
   * apart; the half-life comparison below it is the better statement but needs a
   * Kaplan-Meier median at BOTH endpoints, which a young register does not have. Where the
   * half-life comparison exists it is drawn underneath, in its own words; where it does not,
   * nothing is drawn for it — the open-backlog block above has already said what moved, and a
   * second "no comparison" line would only restate the first.
   */
  function renderMovement(payload) {
    const open = openMovementView(payload && payload.movement);
    const half = executiveMovementView(payload && payload.weekTrend);
    // THE METHOD SENTENCE IS THE LABEL'S DEFINITION. "A rising count is worse. The comparison
    // is between two scans, not between two calendar dates…" is what the word "Movement"
    // MEANS here; printed as a third line under the rows it was body copy inside a header
    // aside that must not out-weigh the hero beside it.
    const box = el("div", { class: "page-strip" },
      el("div", { class: "kpi-label" }, tipLabel("Movement", { term: "movement" })));

    if (!open.show) {
      box.append(el("div", { class: "small muted" },
        "No open-backlog comparison. " + open.reason));
    } else {
      box.append(el("div", { class: "movement-rows" },
        movementRow(open.total.label, open.total),
        ...open.rows.map((r) => movementRow(r.label, r))));
      box.append(el("div", { class: "small muted" }, open.dates));
    }

    if (half.show) {
      const kind = half.direction === "flat" ? "neutral" : half.direction === "up" ? "bad" : "ok";
      box.append(
        statusPill(kind, half.magnitude),
        el("div", { class: "small muted" }, half.label + "."),
      );
    }
    return box;
  }

  // ------------------------------------------------------------------------- fix next

  /**
   * The ranked list, as an ordered list of GROUPS.
   *
   * NO CHART AND NO CANVAS, which is the module header's hard rule and is not relaxed for a
   * ranking. `<ol>` is the right element because the order IS the claim — a reader using a
   * screen reader hears "1 of 8" and gets the same argument the page is making visually.
   *
   * EVERY ROW CARRIES ITS UNITS. "7" is not a figure; "7 open findings" is. A group whose
   * rows have no readable age, no CVE and no single domain simply says less, rather than
   * printing a dash where each of those would have gone.
   */
  function renderFixNext(payload) {
    const view = fixNextView(payload, boot);
    clear(fixHost);
    if (!view.show) {
      if (view.missing) {
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
    fixHost.append(sectionLabel("Fix next", {
      term: "fix-next",
      lines: [...(fixNextEntry ? fixNextEntry.lines : []), view.linkNote],
    }));

    if (view.empty) {
      fixHost.append(emptyState("Nothing is ranked.", view.emptyReason));
    } else {
      const list = el("ol", { class: "fixnext" });
      for (const it of view.items) {
        list.append(el("li", { class: "fixnext-item" },
          el("div", { class: "fixnext-head" },
            statusPill(it.kind, it.tierLabel),
            el("a", {
              class: "linklike fixnext-repo",
              href: it.href,
              "aria-label": it.tierLabel + " — " + it.ownerText + ", " + it.meta + ". "
                + it.linkLabel,
            }, it.ownerText),
            it.ownerKindWord
              ? el("span", { class: "small muted" }, it.ownerKindWord)
              : null),
          el("div", { class: "fixnext-meta small muted" }, it.meta),
        ));
      }
      fixHost.append(list);
    }

    // The two numbers on the surface; the four reasons behind the rest in a closed
    // `disclosure` under it. NOT a tip: the sentence is an ACCOUNTING, and a hover card is
    // the wrong shape for something a reader may want to read twice and compare against the
    // register pages.
    fixHost.append(el("p", { class: "small muted" }, view.rankedShort));
    fixHost.append(disclosure(
      "Why the rest are not ranked",
      el("p", { class: "small muted" }, view.unrankedSentence),
    ));
    // KEPT ON THE SURFACE. A cap is a task constraint — the reader is looking at a list that
    // stops before the backlog does — and so is a tier that could not be measured at all.
    if (view.cutNote) fixHost.append(el("p", { class: "small muted" }, view.cutNote));
    if (view.exposureNote) {
      fixHost.append(el("p", { class: "small muted" }, view.exposureNote));
    }
    // `view.linkNote` ITSELF IS UNCHANGED AND STILL ON THE VIEW MODEL — only the render moved,
    // onto the heading's own tip above. See that append for why.
  }

  // -------------------------------------------------------------------------- severity

  /**
   * The distribution as ONE PICTURE, which is the picture the register pages already draw.
   *
   * WHAT THIS REPLACES. Five bordered, surface-tinted `.exec-sev-tile`s, each holding a count
   * and a dotted label, reading left to right as five figures of equal weight. A distribution
   * drawn as five equal boxes is the one thing a distribution is not: the reader has to
   * compare five numbers to recover the shape, and 12 CRITICAL beside 12 INFO looked
   * identical. `sevSegmentBar` + `sevKeyRow` is the same data as a shape with every count
   * still written out beside it.
   *
   * A ZERO LEVEL KEEPS ITS KEY, and that is why the entries are built from `view.tiles`
   * rather than through `sevEntries` (which filters `count > 0` — right for a register page's
   * hero, wrong here). The BAR is drawn only when something is open: a `--lg` bar with every
   * segment at flex-grow 0 is an empty bordered box.
   *
   * THE COUNTS ARE MANDATORY, not decoration. The bar is colour, and colour is never the only
   * cue here — the key row carries the level's word and its number, and the population line
   * under it carries the total the bar is a picture of.
   */
  function renderSeverity(data) {
    const view = executiveSeverityView({
      order: boot.palette.order,
      scope: sevScope,
      bootCounts: boot.openCounts,
      payload: data && data.severityCounts,
      scoped,
    });
    clear(sevHost);
    if (!view.tiles.length) return;
    // The method note is a DEFINITION of the axis — what a severity grades, and over which
    // rows — so it sits on the heading rather than under the picture.
    sevHost.append(sectionLabel("Open findings by severity", {
      lines: [
        "Severity is the grade Wiz put on the finding, counted over OPEN findings only.",
        "Resolved history is excluded, so this is live risk rather than everything the"
        + " register has ever recorded.",
      ],
    }));
    if (view.pending) {
      sevHost.append(el("div", { role: "status", "aria-label": "Counting open findings" },
        skeleton("line", { width: "280px" })));
      return;
    }
    const entries = view.tiles.map((t) => ({ sev: t.sev, count: t.count }));
    const strip = el("div", { class: "page-strip" });
    if (view.open > 0) {
      strip.append(sevSegmentBar(entries.filter((e) => e.count > 0), {
        size: "lg",
        // CAPPED, because `.sevbar` is `width: 100%` and this one is not inside a header
        // column. Uncapped it draws a band of saturated severity fill across the page — the
        // "wall of red and orange" DESIGN.md's anti-references name. A strip, not a band.
        width: "min(100%, 44rem)",
        label: "Open findings by severity: "
          + entries.map((e) => fmtCount(e.count) + " " + e.sev).join(", "),
      }));
    }
    strip.append(sevKeyRow(entries));
    sevHost.append(strip);
    // THE TWO NUMBERS STAY ON THE SURFACE; WHY THEY DIFFER IS A TIP. `populationLine` is
    // already the short form ("66 open at the shown severities · 70 including UNKNOWN") —
    // both figures a reader needs are printed with nothing to hover. `populationExplain` is
    // null exactly when the two agree, which is also when there is nothing to explain.
    sevHost.append(el("p", { class: "small muted" },
      view.populationExplain
        ? tipLabel(view.populationLine, { lines: view.populationExplain })
        : view.populationLine));
    if (view.note) sevHost.append(el("p", { class: "small muted" }, view.note));
  }

  // ------------------------------------------------------------------------ by domain

  /**
   * The per-group remediation split — by domain at the whole-register view, by support group
   * within a picked domain. A compact table (group · KM median · open) sorted by open
   * backlog, listing every group; the deeper per-group charts still live on the MTTR page.
   *
   * THE COLUMN HEADINGS CARRY THEIR OWN DEFINITIONS, asked once rather than once per row,
   * which is `ui/tip.js`'s own rule for a definition. This page owns them: the definitions
   * package skips this file.
   */
  function renderByDomain(byDomain) {
    clear(byDomainHost);
    const view = executiveByDomainView(byDomain, { domainNames: boot.domainNames });
    if (!view.show) return;

    byDomainHost.append(sectionLabel(view.title));
    byDomainHost.append(dataTable({
      columns: [
        { key: "name", label: view.columnHeader, cell: (r) => r.name },
        {
          key: "kmMedian",
          label: "Median MTTR (KM)",
          className: "num num--key",
          help: {
            term: "half-life",
            lines: [
              "Kaplan-Meier median time to remediation for this group, with still-open"
              + " findings censored so it is not biased low by fresh, fast-patched findings.",
              ...(view.anyBoundMissing
                ? ["A dash means this group's curve never falls to half. The lower bound that"
                  + " would replace it is not in this payload; MTTR & SLA publishes it."]
                : []),
            ],
          },
          cell: (r) => fmtSpan(r.kmMedian),
        },
        {
          key: "open",
          label: "Open",
          className: "num",
          help: [
            "Open findings in this group right now, over the severities this page is scoped"
            + " to. Resolved history is not counted.",
          ],
          cell: (r) => fmtCount(r.open),
        },
      ],
      rows: view.rows,
    }));
    // NO FOOTNOTE HERE ANY MORE. The dash was explained twice: once on the KM-median column's
    // own heading tip (`view.anyBoundMissing`'s extra line above, "A dash means this group's
    // curve never falls to half…") and again in a paragraph under the table restating the same
    // fact in different words. A column heading is asked once — that is `ui/tip.js`'s own rule
    // for a definition — so the second statement was the explanation repeating itself one level
    // UP rather than staying down, and it is gone rather than kept as a second surface sentence.
  }

  // ------------------------------------------------------------------------- last scan

  /**
   * When the register last looked. THE CONTROL TO LOOK AGAIN IS THE RUN SCAN BUTTON IN THE
   * RAIL — one button in one place, so a reader is never offered two that could disagree
   * about what is already running. This page carried its own primary Run scan for its whole
   * life; it is gone, and the rail's is the one that stays.
   *
   * ON AN EMPTY LEDGER THIS SECTION DEFERS RATHER THAN RESTATES. It used to print "No scan
   * saved yet." over its own call to action — the same claim and the same instruction the
   * first-run panel already carries at the top of this page. The section still earns its
   * place because it answers what the panel does not: WHEN did the register last look.
   */
  function renderScan() {
    clear(scanHost);
    scanHost.append(sectionLabel("Last scan"));
    const latest = boot.latestScan;
    if (!latest) {
      scanHost.append(emptyState(
        "No scan has run yet.",
        "What each figure is waiting for is listed at the top of this page.",
        { variant: "notice" },
      ));
      return;
    }
    scanHost.append(el("p", { class: "scan-caption" },
      fmtDateTime(latest.ts) + " · " + relativeAge(latest.ts)
      + " · " + fmtCount(latest.total) + " "
      + pluralize(num(latest.total, 0), "finding")));
    // A CROSS-LINK IS A LINK. The provenance rides on the phrase rather than following it as
    // a sentence, and the rail's own call to action is not repeated here.
    scanHost.append(el("p", { class: "small muted" },
      tipLabel("What that scan changed", {
        lines: [
          "Scan History is the page sent the per-scan arrival and closure counts, one row"
          + " per scan.",
        ],
      }),
      " → ",
      el("a", { class: "linklike", href: "#/history" }, "Scan History")));
    // A STATE, DRAWN AS A STATE. "Dry run" is what these figures ARE, and a pill is the
    // component this design system already has for a state: two words plus a tint, with the
    // sentence behind it.
    if (!boot.hasCredentials) {
      scanHost.append(el("p", { class: "small muted" }, statusPill("neutral", "Dry run", {
        lines: ["No Wiz credentials are stored; scans are simulated."],
      })));
    }
  }
}
