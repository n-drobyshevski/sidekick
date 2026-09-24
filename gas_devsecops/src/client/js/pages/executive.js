// Executive — the front door, and the one page a leader is allowed to read alone.
//
// ONE NUMBER, AND IT IS ALLOWED TO REFUSE TO BE A NUMBER. The hero is the register's
// remediation half-life read off a Kaplan-Meier curve, cut at the point its own risk set stops
// being reliable (the Gebski et al. reliability cut, `domain/remediation.ts`). Where that CUT
// curve never falls to half — which is the normal state of a young register carrying more open
// findings than closed ones — there IS no median, and the page publishes "Not reached" instead,
// with the 25th-percentile reading beside it where one exists. PRODUCT.md's sixth principle is
// the whole reason this file exists in this shape: a clock has to say where it started, and a
// bare number in the hero slot would be claiming a measurement nobody made. `executiveHeroView`
// is where that decision lives, pure and exported, so the claim is testable without a DOM.
//
// NO CHART ON THE FRONT DOOR, and that is a decision rather than an omission. Chart.js is
// ~170 KB fetched over `google.script.run` on the first route that draws one
// (chartsLoader.js); the landing page draws none, so the front door never pays for it. The
// survival curve, its censor markers and the per-severity split live on MTTR & SLA, one
// link away — see `curveNote` below, which also states the payload reason.
//
// WHAT THIS PAGE IS SENT, and what it therefore cannot say. `api_getExecutivePage` composes
// two read-models and slices one of them hard (domain/pagePayload.ts::execMttrSlice): the
// hero arrives as `{median, medianLowerBound, q25, reliableUntil, events, total,
// excludedPreEntry}` — enough to run the SAME `kmHalfLifeView` decision MTTR & SLA does, AND
// (measurement-window package) enough for `windowLineView` to state the window's own sample
// size — and NOTHING else: still no `curve`, still no `censored`. So the hero's qualifier line
// names resolved and still-open lifecycles, which are in the payload, and does not claim they
// are the estimator's event and censored counts — `events`/`total` feed the WINDOW line only,
// never the qualifier, which is why `executiveHeroView` below still reads `tracked`/`resolved`/
// `open` for its own qualifier rather than switching to the estimator's pair now that both are
// on the wire. `execGroupSlice` narrows the per-register split to `{group, kmMedian, kmQ25,
// kmMedianLowerBound, open}` — enough for the byScope table to run the same decision too,
// rather than falling back to a bare dash with a footnote pointing at MTTR & SLA.

import { bootstrap, swrParts } from "../../../../../gas_shared/store.js";
// `scopeParam` used to be DEFINED here — see `./_rates.js`'s header for why one copy now
// serves this page, mttr.js and program.js all three.
import { scopeParam } from "./_rates.js";
import { SCOPE_LABELS_LONG as SCOPE_LABELS } from "./_scopeLabels.js";
import {
  absentText, briefDelta, briefFigure, briefFigures, briefList, briefNotes, briefSkeleton,
  briefSplit, briefSplits, briefStatus, briefTrendDelta, clear, days1, dotGrid, el, emptyState,
  errorState, sentenceStart, sevWord, staleness, tierCounts, tierTone,
  fmtCount, fmtDate, fmtDateTime, fmtDays, num, pageHeader, pct1, pluralize, relativeAge,
  ringMark, slopeMark, statusPill, tipLabel, unitSquares,
} from "../ui.js";
// THE HALF-LIFE DECISION IS IMPORTED, NOT REPEATED. `execMttrSlice` is a slice of the MTTR
// page's own payload (api.ts says so), so the rule that turns `{median, medianLowerBound}`
// into a sentence has to be the same rule on both pages or the front door and the detail page
// could describe the same estimate differently. It lives on the page that owns the clock.
// `fmtCount`/`fmtDays` themselves come from `../ui.js` now, not from `./mttr.js` — see
// `ui/figures.js`'s module header.
import {
  endOfLifeExclusionNote, kmHalfLifeView, rateView, trackingSinceView, WINDOW_LINE_HELP,
  windowLineView,
} from "./mttr.js";

// ------------------------------------------------------------------------- view models

/**
 * The hero, decided rather than formatted — the SAME `kmHalfLifeView` decision the MTTR page's
 * hero makes, imported rather than restated (see the module header).
 *
 * FOUR OUTCOMES now (MTTR delayed-entry package) — `kmHalfLifeView`'s own doc comment has the
 * full account:
 *
 *   median present               "41 days"      — half the register closed within that.
 *   median null, q25 real        "Not reached"  — a quarter closed even though half did not;
 *                                                  `secondary` carries "25% fixed within N d".
 *   neither, but a reliable cut  "Not reached"  — not even a quarter, but the reliability cut
 *                                                  still names a point measured past.
 *   neither                      "Not measured" — no observations at all. Not a zero.
 *
 * Rendering the middle two as a bare number would state a median that was never observed;
 * collapsing them to "—" would throw away a true statement. So the value is published, and the
 * `secondary` line beside it is what a reader is entitled to next.
 *
 * @param {object|null|undefined} payload  `api_getExecutivePage`'s reply
 * @returns {{measured: boolean, value: string, isLowerBound: boolean, days: number|null,
 *            q25Days: number|null, state: string, secondary: string|null,
 *            tracked: number, resolved: number, open: number, qualifier: string,
 *            censoredKnown: boolean}}
 */
export function executiveHeroView(payload) {
  const mttr = (payload && payload.mttr) || null;
  const km = (mttr && mttr.remediation && mttr.remediation.km) || null;
  const tracked = Number((mttr && mttr.rowCount) || 0);
  const overall = (mttr && mttr.overall) || {};
  const resolved = Number(overall.resolved || 0);
  const open = Number(overall.open || 0);

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
    ...half,
    tracked,
    resolved,
    open,
    qualifier,
    // The estimator's censored count is on MTTR & SLA, not here — see the module header.
    censoredKnown: false,
  };
}

/**
 * Open findings by severity, register-wide.
 *
 * `severityCounts.counts` is built from OPEN rows only (`readModels.buildExecutive`), so
 * these tiles are live risk rather than everything ever recorded — and the sub-line says
 * which, because a tile labelled only "CRITICAL" over a number is the exact ambiguity this
 * register keeps closing.
 *
 * A LEVEL WITH ZERO OPEN FINDINGS IS STILL A TILE, so long as the level exists in the
 * severity order. A missing tile reads as a render that failed; an honest 0 does not.
 */
export function executiveSeverityView(payload, order) {
  const block = (payload && payload.severityCounts) || null;
  const counts = (block && block.counts) || {};
  const levels = (order || []).filter((s) => s !== "UNKNOWN" || counts[s]);
  return {
    show: !!block,
    tiles: levels.map((sev) => ({ sev, count: Number(counts[sev] || 0) })),
    open: Number((block && block.open) || 0),
    total: Number((block && block.total) || 0),
    note: block && block.total && !block.open
      ? "Every tracked finding in this register is closed — nothing is open at any severity."
      : null,
  };
}

// THE PICTOGRAM LADDER MOVED. `unitScale` / `unitCounts` in gas_shared/ui/unitChart.js are
// this page's own `pictogramUnit` / `pictogramCounts`, promoted verbatim when the second and
// third registers needed the same picture. The ladder, the 40-mark ceiling and the
// refuse-before-cast rule all travelled with them, and gas_shared/test/contracts/unitChart.js
// is where `test/executivePictogram.test.js`'s perturbations now live — registered from this
// app's own test/shared.test.js, so nothing about the coverage moved with the code.

/**
 * The three registers side by side: how much is open in each, and how fast each closes.
 *
 * THE HALF-LIFE COLUMN RUNS THE SAME `kmHalfLifeView` DECISION AS EVERY OTHER HALF-LIFE ON
 * THIS PRODUCT, now that `execGroupSlice` ships `kmQ25` and `kmMedianLowerBound` alongside
 * `kmMedian` (MTTR delayed-entry package). A register whose curve never reaches half no longer
 * arrives as a bare "—" with a footnote pointing at MTTR & SLA — it arrives with enough to say
 * "Not reached" and, where one exists, the 25th-percentile reading. Only a register with NO
 * observations at all still reads "Not measured".
 */
export function executiveRegisterView(byScope) {
  const raw = byScope && Array.isArray(byScope.rows) ? byScope.rows : [];
  // The share column's base is the OPEN backlog across the registers this payload carries —
  // not every finding ever tracked, and not the register the reader happens to be scoped to.
  // It rides in the denominator node beside every figure so it cannot be guessed at.
  const totalOpen = raw.reduce((a, r) => a + Number(r.open || 0), 0);
  const rows = raw
    .map((r) => {
      const scope = r.group;
      const open = Number(r.open || 0);
      const half = kmHalfLifeView({
        median: r.kmMedian, q25: r.kmQ25, medianLowerBound: r.kmMedianLowerBound,
      });
      return {
        scope,
        label: SCOPE_LABELS[scope] || String(scope),
        open,
        share: rateView(
          totalOpen > 0 ? (open / totalOpen) * 100 : null,
          totalOpen,
          fmtCount(totalOpen) + " open across the registers",
        ),
        half,
        kmText: half.value,
      };
    })
    .sort((a, b) => b.open - a.open);
  return {
    show: rows.length > 0,
    rows,
    totalOpen,
  };
}


/**
 * Movement, and what it is movement OF.
 *
 * `weekTrend` is the KM median now against the KM median replayed a week ago — both computed
 * from the same scoped population, so it is scope-correct by construction. It is NOT the
 * per-scan arrival/closure movement the stub asks for in those words: `getExecutivePage`
 * ships no scan deltas at all (see the module header). So the badge says "half-life" and
 * "versus last week" in its own label rather than borrowing the language of a different
 * measurement.
 *
 * Null when the register is under a week old or either endpoint's median is unobservable —
 * `readModels.weekTrend` refuses to substitute a lower bound for a median, so an absent badge
 * means "not comparable", not "unchanged".
 */
export function executiveMovementView(weekTrend) {
  if (!weekTrend) {
    return {
      show: false,
      reason: "Under a week of history, or the MTTR was not observable at one of the two"
        + " endpoints. No comparison is published rather than a made-up one.",
    };
  }
  const delta = Number(weekTrend.deltaDays);
  if (!Number.isFinite(delta)) return { show: false, reason: "The week-over-week delta is not a number." };
  const direction = delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const magnitude = fmtDays(Math.abs(delta));
  return {
    show: true,
    direction,
    // Up = slower remediation = worse. Stated in words so the arrow is never the only cue.
    label: direction === "flat"
      ? "MTTR unchanged versus last week"
      : "MTTR " + (direction === "up" ? "up" : "down") + " " + magnitude
        + " versus last week — remediation is " + (direction === "up" ? "slower" : "faster"),
    magnitude: direction === "flat" ? "±0" : (direction === "up" ? "↑ " : "↓ ") + magnitude,
    current: weekTrend.current === null || weekTrend.current === undefined
      ? null
      : Number(weekTrend.current),
    previous: weekTrend.previous === null || weekTrend.previous === undefined
      ? null
      : Number(weekTrend.previous),
    days: Number(weekTrend.days || 7),
  };
}

/**
 * A signed change against a previous value — the Streamlit-style chip, ported from gas/'s
 * `overview.js` and made pure so what it CLAIMS is testable without a DOM.
 *
 * RISING IS WORSE HERE. This chip is only ever handed an open-finding count, and a backlog
 * that grew is a backlog that grew. The arrow is decorative (`aria-hidden` at the call site);
 * `direction` and `aria` restate it in words, because a glyph or a tint may never be the only
 * cue.
 *
 * NO PREVIOUS VALUE MEANS NO CHIP, NOT A ZERO ONE. `null` returns null, and the caller draws
 * nothing — a "±0" over an absent comparison is the confident-zero failure this register keeps
 * closing. The percentage is dropped in two more cases for the same reason: a previous value
 * of 0 has no percentage to give, and a change that ROUNDS to 0 % would print "0 %" beside a
 * non-zero count and read as no movement at all. `pct: null` covers all three and the text
 * omits the clause rather than printing a zero.
 *
 * @param {number|null|undefined} current
 * @param {number|null|undefined} previous
 * @returns {{direction: string, delta: number, pct: number|null, text: string, aria: string,
 *            kind: string}|null}
 */
export function deltaChipView(current, previous) {
  const prev = num(previous);
  const cur = num(current);
  if (prev === null || cur === null) return null;

  const delta = cur - prev;
  if (delta === 0) {
    return {
      direction: "flat", delta: 0, pct: null, text: "±0", aria: "unchanged", kind: "neutral",
    };
  }
  const rising = delta > 0;
  const mag = Math.abs(delta);
  const rounded = prev ? Math.round((mag / prev) * 100) : 0;
  const pct = rounded === 0 ? null : rounded;
  const sign = rising ? "+" : "−";
  return {
    direction: rising ? "up" : "down",
    delta,
    pct,
    text: sign + fmtCount(mag) + (pct === null ? "" : " · " + sign + pct + "%"),
    aria: (rising ? "up " : "down ") + fmtCount(mag)
      + (pct === null ? "" : ", " + pct + " percent")
      + (rising ? " — the backlog grew" : " — the backlog shrank"),
    kind: rising ? "bad" : "ok",
  };
}

const MOVEMENT_REASONS = {
  noSync: "No sync has saved a scan yet, so there are no two observations to compare.",
  oneSync: "One sync only. A comparison needs two, and the second has to fall at least a week"
    + " after the first.",
  tooClose: "The syncs on record are too close together to compare.",
};

/**
 * Movement in the OPEN BACKLOG, per register, between two syncs the server actually names.
 *
 * WHY THIS IS NOT `executiveMovementView`. That one reads `weekTrend` — the half-life now
 * against the half-life a week ago — and withholds a badge whenever the Kaplan-Meier curve
 * fails to reach half at either endpoint, which on a young register is always. Measured on the
 * dev seed: 416 of 554 lifecycles still open, no median at all, a lower bound of 293.9 days.
 * So the aside said "no comparison" permanently, not because nothing moved but because the
 * measure it was asking for is unobservable. Both blocks stay. The half-life comparison is the
 * better statement where it exists; this one is the statement censoring cannot suppress.
 *
 * THE DATES ARE PART OF THE FIGURE. "Down 40" means nothing without the interval it is over,
 * so `since` / `until` / `days` are rendered beside the chips rather than implied — the sixth
 * design principle applied to a delta instead of to a duration.
 */
export function openMovementView(movement) {
  const m = movement || null;
  if (!m || !m.comparable) {
    const reason = MOVEMENT_REASONS[(m && m.reason) || "noSync"] || MOVEMENT_REASONS.noSync;
    const days = m ? num(m.days) : null;
    return {
      show: false,
      reason: days === null
        ? reason
        : reason + " The whole scan log spans " + fmtDays(days) + ", and a comparison needs"
          + " two syncs at least 7 days apart.",
      days,
      syncs: m ? num(m.syncs, 0) : 0,
    };
  }
  const per = m.perScope || {};
  const rows = Object.keys(per).map((scope) => {
    const r = per[scope] || {};
    return {
      scope,
      label: SCOPE_LABELS[scope] || String(scope),
      open: num(r.open),
      prevOpen: num(r.prevOpen),
      delta: num(r.delta),
      chip: deltaChipView(r.open, r.prevOpen),
    };
  });
  const total = m.total || {};
  return {
    show: true,
    since: m.since || null,
    until: m.until || null,
    days: num(m.days),
    rows,
    total: {
      open: num(total.open),
      prevOpen: num(total.prevOpen),
      delta: num(total.delta),
      chip: deltaChipView(total.open, total.prevOpen),
    },
    // WHICH two observations, in the display zone, so a reader can check the delta against
    // Scan history rather than take it on trust.
    // `days1`, not `fmtDays`: the interval is the ORIGIN of the delta, and `fmtDays` rounds
    // anything past 10 to a whole day — 13.5 days between two syncs is not "14 days".
    dates: "Between the syncs on " + fmtDate(m.since) + " and " + fmtDate(m.until)
      + " — " + days1(m.days) + " apart.",
  };
}

/** Tier -> the `.pill` kind. The tier's own words carry it; the tint only repeats them. */
const TIER_KINDS = { 1: "bad", 2: "warn", 3: "neutral" };

/**
 * Fix next — the ranked list, and the sentence that accounts for everything it left out.
 *
 * WHY THE FRONT DOOR'S SECOND BLOCK RATHER THAN ITS FIRST. The hero is the register's claim
 * about itself; this is the instruction that follows from it. Both sit above the severity
 * tiles, because a tile row is a description and a leader reading top-down should meet the two
 * claims before the description.
 *
 * IT IS ABSENT ON A FIRST RUN, NOT EMPTY. `executiveFirstRunView` already names every figure
 * that is waiting and what unlocks it; a ranked list of nothing underneath that panel would be
 * a second, weaker statement of the same absence. `show` is decided by that same view rather
 * than by a second copy of the first-run rule.
 *
 * A SYNCED REGISTER WITH NOTHING RANKED IS A DIFFERENT STATE AND SAYS SO. `empty` is true when
 * the register has rows but no group cleared a tier — which is good news — and the unranked
 * counts below are the evidence for it rather than a blank panel.
 */
export function fixNextView(payload, boot) {
  const first = executiveFirstRunView(payload, boot);
  const block = (payload && payload.fixNext) || null;
  if (first.show || !block) {
    return { show: false, firstRun: first.show, items: [], unranked: null, empty: false };
  }

  const groups = Array.isArray(block.groups) ? block.groups : [];
  const items = groups.map((g, i) => {
    const tier = num(g.tier, 0);
    const count = num(g.count, 0);
    const repo = g.repo === null || g.repo === undefined || g.repo === "" ? null : String(g.repo);
    const scope = String(g.scope || "");
    const route = String(g.route || scope);
    return {
      rank: i + 1,
      tier,
      tierLabel: String(g.label || ""),
      kind: TIER_KINDS[tier] || "neutral",
      scope,
      scopeLabel: SCOPE_LABELS[scope] || scope,
      repo,
      // Never "(unknown)": a finding carrying no repository is a gap in attribution, and the
      // em dash is this register's one mark for that.
      repoText: repo === null ? absentText : repo,
      product: g.product === null || g.product === undefined ? null : String(g.product),
      supportGroup: g.supportGroup === null || g.supportGroup === undefined
        ? null
        : String(g.supportGroup),
      // WHO THIS IS FOR, IN THREE STATES RATHER THAN TWO. The product is the grain a reader
      // acts on; the support group above it is who they escalate to, and it is the more
      // likely of the two to agree across a repository's rows — so a group that cannot name
      // one product is not therefore ownerless. Only when neither agrees is there no owner to
      // print, and that itself says the tenant's convention has broken for this repository.
      ownerText: g.product !== null && g.product !== undefined
        ? String(g.product)
        : (g.supportGroup !== null && g.supportGroup !== undefined
          ? String(g.supportGroup) + " (support group)"
          : "no single owner"),
      count,
      countText: fmtCount(count) + " open " + pluralize(count, "finding"),
      oldestDays: num(g.oldestAgeDays),
      oldestText: num(g.oldestAgeDays) === null
        ? "no readable age"
        : "oldest " + fmtDays(g.oldestAgeDays),
      href: "#/" + route,
      linkLabel: "Open the " + (SCOPE_LABELS[scope] || scope) + " register",
    };
  });

  const u = block.unranked || {};
  const unranked = {
    noFix: num(u.noFix, 0),
    unvalidated: num(u.unvalidated, 0),
    insideSla: num(u.insideSla, 0),
    other: num(u.other, 0),
  };
  const ranked = num(block.ranked, 0);
  const openTotal = num(block.openTotal, 0);
  const groupsCut = num(block.groupsCut, 0);
  const findingsCut = num(block.findingsCut, 0);

  // One sentence, four numbers, a reason attached to each. A list captioned "top 8" and
  // nothing else has quietly deleted the rest of the backlog.
  const unrankedSentence =
    fmtCount(ranked) + " of " + fmtCount(openTotal) + " open "
    + pluralize(openTotal, "finding") + " are ranked above. The rest are not: "
    + fmtCount(unranked.noFix) + " awaiting a vendor fix, "
    + fmtCount(unranked.unvalidated) + " secrets not confirmed live (unknown, or observed"
    + " dead), " + fmtCount(unranked.insideSla) + " still inside their SLA window, and "
    + fmtCount(unranked.other) + " below their tier's severity bar or with no deadline to"
    + " measure against.";

  return {
    show: true,
    firstRun: false,
    items,
    unranked,
    unrankedSentence,
    // THE SAME TWO NUMBERS, ON THE SURFACE. Wave A's ladder puts the figure and the picture
    // first and the accounting one level down: this line is what the reader sees, and
    // `unrankedSentence` above — unchanged, still the four reasons with a count each — is
    // what the `disclosure` under it holds. Dropping the sentence and keeping only this would
    // be the "top 8 and nothing else" the sentence was written against; printing both on the
    // surface is what made the section 55 words of prose under a list of eight.
    rankedShort: fmtCount(ranked) + " of " + fmtCount(openTotal) + " open "
      + pluralize(openTotal, "finding") + " ranked",
    ranked,
    openTotal,
    empty: items.length === 0,
    emptyReason: "Nothing to rank: no credential confirmed live, no fixable dependency finding"
      + " past its SLA, and no critical code weakness past its SLA.",
    cutNote: groupsCut > 0
      ? fmtCount(groupsCut) + " further " + pluralize(groupsCut, "group")
        + " carrying " + fmtCount(findingsCut) + " ranked "
        + pluralize(findingsCut, "finding") + " are not drawn — the list is capped at "
        + fmtCount(num(block.limit, items.length)) + "."
      : null,
    // NO LONGER RENDERED, AND KEPT ANYWAY. The links land on the register, not on the
    // repository: no register page reads a repository filter out of the hash today
    // (`readRegisterParams` takes `sev` and `nofix` and nothing else). That was a whole
    // paragraph on the front door explaining what a link does NOT do — a caveat about an
    // affordance nobody had used yet, and the one block on this page whose fate was DELETE
    // rather than disclose. The field stays because `test/executiveFixNext.test.js` asserts
    // the claim on the MODEL ("unfiltered", "no repository filter yet"), which is the right
    // place for it: the day a register page grows a repository filter, that test is what says
    // this sentence is now false.
    linkNote: "Each link opens that register unfiltered — the register pages take a severity"
      + " filter and a fix-availability switch, and no repository filter yet.",
  };
}

/**
 * The cold zone, as the one figure a leader reads about it: how much of the open backlog is
 * sitting on repositories where nothing is moving.
 *
 * ONE NUMBER, AND IT IS A SHARE RATHER THAN A COUNT. "412 open findings are cold" is a figure
 * whose meaning changes with the size of the register; "31.4% of the backlog is cold" is the
 * same fact read against the only denominator that makes it comparable week to week. Both are
 * published — the share is the value, the pair behind it is the sentence underneath — because
 * a rate without its denominator is not a measurement (PRODUCT.md, and `pagesLit` gate 3/7).
 *
 * NULL IS AN ANSWER AND IT IS NOT ZERO. `cold_backlog_share_pct` is null over an empty
 * denominator — a register with no open findings at all has no cold SHARE, and rendering that
 * as 0.0% would say the backlog is all warm when there is no backlog. The card draws
 * `absentText` instead, which is what every other absent figure on this page draws.
 *
 * THE SHAPE IS CHECKED, NOT THE FLAG. `api_getExecutivePage` ships `coldZone` as a
 * `ColdZoneHeadline` — the totals and the clock, never the per-repo or per-team arrays — and
 * sets `totals` to null in exactly the case `measurable: false` describes. A payload that said
 * `measurable: true` over a null `totals` (an older server answering a newer client) would
 * pass a flag check and then throw inside the renderer, which `guard()` would dress as a red
 * error box for what is really an absence. So this decides for itself from what arrived.
 *
 * `coldZoneAsOfSource` IS CARRIED BECAUSE THE CLOCK CAN SLIP. Every duration in the cold-zone
 * family is measured at the LEDGER's clock — the newest scan's timestamp — so the same saved
 * ledger always reads the same number. Where the server could not find that clock it falls
 * back to the wall clock and says so, and a figure measured against "now" grows a little every
 * time the page is opened. That is a different reading from the one the card otherwise
 * promises, so the denominator sentence says which it is rather than quietly printing both the
 * same way.
 *
 * AND THE MODE RIDES ALONG, for the reason the Repositories page's caption spells out at
 * length: `cold_after_days` is the EFFECTIVE line in both modes, so one number reaches this
 * card whichever definition drew it, and "at least 47 days" means something different when a
 * person chose 47 than when the estate's tenth-idlest repository did. The card still prints
 * ONE figure; the denominator sentence is where the difference is stated.
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
  // relative. Same refusal as `pages/repos.js`'s `coldZoneView`, and for the same reason.
  const mode = present && cz.mode === "relative" ? "relative" : "fixed";
  const modeFields = {
    mode,
    targetSharePct: present ? num(cz.target_share_pct) : null,
    achievedSharePct: present ? num(cz.achieved_share_pct) : null,
    floorApplied: present && cz.floor_applied === true,
    derivedDays: present ? num(cz.derived_days) : null,
    floorDays: present ? num(cz.floor_days) : null,
  };
  // THE ONE COVERAGE COUNT THIS CARD CARRIES, of the four `coldZoneHeadline` publishes.
  // `dropped_no_repo` and `unclassified_secrets` explain gaps in figures this card does not
  // draw (the repo table, the high-risk figure — both live on Repositories), so they have
  // nothing to caveat here; `row_count` is a population count with no single-number card to
  // fold into. `scopes_without_scan` is different: it can put a scope's repositories INSIDE
  // this card's own one number while this read cannot tell whether they are cold, which is a
  // doubt about the figure the card shows rather than about one it does not — see
  // `renderColdShare`'s denominator for what it says about that.
  const scopesWithoutScan = present && Array.isArray(cz.scopes_without_scan)
    ? cz.scopes_without_scan.map((s) => String(s))
    : [];
  if (!measurable) {
    return {
      show: false,
      measurable: false,
      atLedgerClock: source !== "wallClock",
      pct: null, openInCold: 0, openFindings: 0, coldRepos: 0, reposWithOpen: 0,
      coldAfterDays: present ? num(cz.cold_after_days) : null,
      scopesWithoutScan,
      ...modeFields,
    };
  }
  return {
    show: true,
    measurable: true,
    ...modeFields,
    // TRUE unless the server SAID it fell back — an older payload that carries no source at
    // all is not evidence of a wall-clock reading, and the caveat is only worth printing where
    // it is known to apply.
    atLedgerClock: source !== "wallClock",
    pct: num(totals.cold_backlog_share_pct),
    openInCold: num(totals.open_in_cold, 0),
    openFindings: num(totals.open_findings, 0),
    coldRepos: num(totals.cold_repos, 0),
    reposWithOpen: num(totals.repos_with_open, 0),
    coldAfterDays: num(cz.cold_after_days),
    scopesWithoutScan,
  };
}

/**
 * The front door on a ledger nobody has read, and what would change that.
 *
 * WHAT THIS REPLACES. With no sync saved, this page rendered `0 lifecycles in the ledger · 0
 * closed findings · 0 kept in as right-censored observations`, five severity tiles each
 * reading `0 open`, and a table of three registers at `0` — every one of them a confident
 * zero over a population nobody has looked at. The only honest sentence on the page ("No sync
 * saved yet") was at the BOTTOM, below all of it. A leader reading top-down met "0 critical
 * open" first, which is indistinguishable from a clean bill of health and is the single most
 * expensive misread this register can produce.
 *
 * PRODUCT.md's corollary is the rule being applied: *"No MTTR yet" is a state a reader can
 * act on; "MTTR is 0 days" is a confident lie.* The same holds for a count. So on an unread
 * ledger the zero-valued blocks are SUPPRESSED rather than dashed — a dash still occupies the
 * slot of a figure and invites a reader to wait for it to fill — and this panel takes their
 * place, naming each missing figure with the ONE condition that unlocks it and where that
 * control lives.
 *
 * IT IS NOT ONE STATE, IT IS TWO. No sync at all is a first run. A sync that ran and saved
 * nothing is a MEASUREMENT: the tenant answered, and the answer was empty. `synced` keeps
 * them apart, because "no sync has run yet" over a completed sync would be false.
 *
 * WHY IT IS PURE. Every unlock condition here is a claim about the domain — the half-life
 * needs a closed lifecycle, the week trend needs two endpoints a week apart, SLA attainment
 * needs a deadline to compare against, a register's count needs that register enabled for
 * collection. Those are testable without a DOM and they are the part that can go wrong.
 *
 * @param {object|null|undefined} payload  `api_getExecutivePage`'s reply
 * @param {object|null|undefined} boot     `bootstrap()`'s reply
 * @returns {{show: boolean, synced: boolean, heading: string, hint: string,
 *            items: Array<{figure: string, unlock: string, route: string|null,
 *                          routeLabel: string}>}}
 */
export function executiveFirstRunView(payload, boot) {
  const b = boot || {};
  const hero = executiveHeroView(payload);
  const synced = !!b.latestSync;
  if (hero.tracked > 0) return { show: false, synced, heading: "", hint: "", items: [] };

  const settings = b.settings || {};
  const enabled = Array.isArray(settings.scopes) ? settings.scopes : [];
  const targets = settings.slaTargets || b.slaTargets || {};
  const hasSlaWindow = Object.keys(targets).length > 0;
  // The action label for a figure the FIRST SYNC unlocks. It names the control rather than
  // a page, because there is no page to send the reader to — `route: null` in an
  // `emptyState` item renders its label as plain text for exactly that reason
  // (ui/feedback.js). One label, used three times, so the three cannot drift apart.
  const RUN_SYNC = "Run sync — the button in the rail";

  const items = [
    {
      figure: "MTTR",
      unlock: "One closed lifecycle with a readable clock. A finding is dated closed at the"
        + " sync that stopped seeing it, so the first close needs a second sync.",
      route: null,
      routeLabel: RUN_SYNC,
    },
    {
      figure: "Week-over-week movement",
      unlock: "Two syncs a week apart. Under a week of history there is no comparison to"
        + " publish, and none is invented.",
      route: null,
      routeLabel: RUN_SYNC,
    },
    {
      figure: "SLA attainment",
      unlock: hasSlaWindow
        ? "One resolved finding to hold against the deadlines already set per severity."
        : "A deadline per severity. Without a window there is nothing for a close date to be"
          + " inside or outside of.",
      route: "#/settings?tab=deadlines",
      routeLabel: "Settings → Deadlines",
    },
  ];

  for (const scope of ["sca", "sast", "secrets"]) {
    const on = enabled.indexOf(scope) !== -1;
    items.push({
      figure: (SCOPE_LABELS[scope] || scope) + " — open findings",
      unlock: on
        ? "This register is enabled for collection; its count arrives with the first sync"
          + " that saves a row for it."
        : "This register is not being collected, so no sync will ever fill this count.",
      route: on ? null : "#/settings?tab=register",
      routeLabel: on ? RUN_SYNC : "Settings → Register",
    });
  }

  return {
    show: true,
    synced,
    heading: synced
      ? "The last sync saved no findings, so there is nothing here to measure yet."
      : "No sync has run yet, so nothing on this page has been measured.",
    hint: "Every figure below waits on a different thing. None of them is a zero, and none of"
      + " them is shown as one.",
    items,
  };
}

// ----------------------------------------------------------------------------- the page
//
// `scopeParam` moved to `./_rates.js` (imported above).

export async function renderExecutive(host, params, _ctx) {
  const boot = await bootstrap();
  const scope = scopeParam(params);

  // TWO PARTS, IN PARALLEL: the hero's MTTR model and everything else are separate
  // google.script.run executions, which Apps Script runs concurrently — a cold front door
  // costs the slower model, not both (api.ts `getExecutivePage`'s part table).
  let paint = null;
  const data = swrParts(
    "api_getExecutivePage",
    ["exec", "mttr"],
    scope ? { scope } : {},
    (fresh) => paint && paint(fresh),
  );

  // THE BRIEFING (2026-09-24, gas_devsecops/DESIGN.md "The briefing"). Four headline figures,
  // two splits, the ranked list and the notes a reader must not miss, read at a glance
  // (gas_shared/ui/briefing.js). The honesty rules did not move: "Not reached" still says so,
  // the tracking window and end-of-life notes stay on the surface, and every picture repeats a
  // figure printed beside it. The ranked list is ONE block, Fix next: shut, it shows its top
  // three; opened, the full list replaces them in place. (It was a "Fix first" preview up here
  // and the full list at the foot of the page — the same groups twice, under two names.)
  const statusHost = el("div", {});
  const noticeHost = el("div", {});
  const figuresHost = el("div", {});
  const splitsHost = el("div", {});
  const notesHost = el("div", {});
  const fixHost = el("div", {});
  const brief = el("div", { class: "brief" });
  host.append(pageHeader({ route: "executive" }), brief);
  brief.append(statusHost, noticeHost, figuresHost, splitsHost, fixHost, notesHost);

  function guard(label, target, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[executive] " + label + " render failed:", e);
      clear(target).append(errorState(
        "Couldn't render " + label + ".",
        { detail: String((e && e.message) || e) },
      ));
    }
  }

  // Stubs in the briefing's own grid, so nothing jumps when the parts land. Each render
  // clears its host first; the first-run branch clears the splits and the list.
  const stub = briefSkeleton();
  clear(figuresHost).append(stub.figures);
  clear(splitsHost).append(stub.splits);
  clear(fixHost).append(stub.list);
  guard("the sync status", statusHost, renderStatus);

  paint = (payload) => {
    const first = executiveFirstRunView(payload, boot);
    guard("the first-run panel", noticeHost, () => renderFirstRun(first));
    guard("the headline figures", figuresHost, () => renderFigures(payload, first));
    guard("the reading notes", notesHost, () => renderNotes(payload));
    if (first.show) {
      clear(fixHost);
      clear(splitsHost);
      return;
    }
    guard("the splits", splitsHost, () => renderSplits(payload));
    guard("the fix-next list", fixHost, () => renderFixNext(payload));
  };

  try {
    paint(await data);
  } catch (e) {
    console.error("[executive] api_getExecutivePage failed:", e);
    clear(figuresHost).append(errorState(
      "Couldn't load remediation data.",
      { detail: String((e && e.message) || e) },
    ));
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
   * When every figure below was measured, in one line — the "Last sync" section's successor.
   * A sync older than a week turns the dot amber and says how old in words: every number on
   * this page is as of that sync, and a stale one is the first thing a reader must know.
   */
  function renderStatus() {
    clear(statusHost);
    const latest = boot.latestSync;
    if (!latest) {
      statusHost.append(briefStatus({ tone: "neutral", parts: ["No sync has run yet"] }));
      return;
    }
    const { stale, tone } = staleness(latest.ts);
    const scopes = Array.isArray(latest.scopes) ? latest.scopes : [];
    statusHost.append(briefStatus({
      tone,
      parts: [
        "Last sync " + fmtDateTime(latest.ts),
        el("span", { class: stale ? "brief-status__warn" : null }, relativeAge(latest.ts)),
        fmtCount(latest.total) + " " + pluralize(Number(latest.total || 0), "finding")
          + " across " + fmtCount(scopes.length) + " " + pluralize(scopes.length, "register"),
        boot.hasCredentials ? null : statusPill("neutral", "Dry run", {
          lines: [
            "No Wiz credentials are configured, so these figures come from a dry run rather"
            + " than from the tenant.",
          ],
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
      first && first.show ? null : renderColdShare(payload),
    ));
  }

  function openFigure(open, hero) {
    const label = tipLabel("Open findings", { term: "movement" });
    if (!open.show) {
      return briefFigure({
        label,
        value: hero.tracked ? fmtCount(hero.open) : absentText,
        caption: "No sync-on-sync comparison yet. " + open.reason,
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
      caption: "Syncs " + days1(open.days) + " apart",
    });
  }

  function halfLifeFigure(view, payload) {
    const half = executiveMovementView(payload && payload.weekTrend);
    const delta = briefTrendDelta(half);
    const numeric = view.measured && !view.isLowerBound && num(view.days) !== null;
    return briefFigure({
      label: tipLabel("MTTR", heroHelp(view)),
      // "Not reached" and "Not measured" are the value, in words, exactly as the MTTR page
      // prints them — `kmHalfLifeView` decides, this page does not re-decide.
      value: numeric ? fmtCount(Math.round(view.days)) : view.value,
      valueClass: numeric ? null : "brief-value--text",
      unit: numeric ? pluralize(Math.round(view.days), "day") : null,
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
      caption: view.secondary ? sentenceStart(view.secondary) + "." : null,
      link: { href: "#/mttr", text: "MTTR & SLA" },
    });
  }

  function heroHelp(view) {
    if (view.isLowerBound) {
      return {
        term: "half-life",
        lines: [
          "The survival curve never falls to half within the observed window, so there is no"
          + " median to publish.",
          view.state === "quartile"
            ? "A quarter of what is tracked has already closed — " + view.secondary + "."
            : "Too few findings have closed within the reliable window to say even that much —"
              + " " + view.secondary + ".",
        ],
      };
    }
    if (!view.measured) {
      return {
        term: "half-life",
        lines: [
          "No lifecycle has a readable clock yet: “not measured”, not zero.",
          "The MTTR needs at least one observation to rest on.",
        ],
      };
    }
    return { term: "half-life" };
  }

  function actFigure(payload) {
    const view = fixNextView(payload, boot);
    const label = tipLabel("Act now", { term: "fix-next" });
    if (!view.show) return briefFigure({ label, value: absentText });
    if (view.empty) {
      return briefFigure({ label, value: "0", unit: "groups", caption: view.emptyReason });
    }
    const { legend } = tierCounts(view.items);
    return briefFigure({
      label,
      value: fmtCount(view.items.length),
      unit: pluralize(view.items.length, "group"),
      visual: unitSquares({
        tones: view.items.map((it) => tierTone(it.tier)),
        label: legend.join(", "),
      }),
      caption: legend.join(" · ") + ". " + view.rankedShort + ".",
    });
  }

  /**
   * The cold zone as a figure. Its DENOMINATOR SENTENCE is the one the old card carried, word
   * for word — the window, the relative-mode clause, the clock caveat and the coverage gap —
   * in the label's tip and on the node (`briefFigure`'s figureCard contract). The coverage gap
   * folds into that same sentence rather than becoming a second note.
   */
  function renderColdShare(payload) {
    const view = coldShareView(payload);
    if (!view.show) {
      return briefFigure({
        label: "Cold zone",
        help: { term: "cold-zone" },
        value: "Not measured",
        valueClass: "brief-value--text",
        caption: "Appears once a sync has saved the movement before it.",
      });
    }
    const windowText = view.coldAfterDays === null
      ? "the cold-zone window"
      : `at least ${fmtDays(view.coldAfterDays)}`;
    const targetText = `${fmtCount(view.targetSharePct)}%`;
    const modeClause = view.mode !== "relative"
      ? ""
      : view.floorApplied === true
        ? ` — the floor, which holds the zone smaller than the ${targetText} asked for`
        : ` — the line relative mode set so the idlest ${targetText} of repositories with open`
          + " findings are cold";
    const clock = view.atLedgerClock
      ? "Measured at the last scan, never against today."
      : "Measured against the current time rather than the last scan — the clock the ledger"
        + " was measured at could not be read, so this figure moves as the page is reopened.";
    const coverageClause = view.scopesWithoutScan.length
      ? ` No scan is on record for ${view.scopesWithoutScan.map((s) => SCOPE_LABELS[s] || s).join(", ")}`
        + `, so this figure cannot say whether ${view.scopesWithoutScan.length === 1 ? "its" : "their"}`
        + " repositories are cold."
      : "";
    return briefFigure({
      label: "Cold zone",
      help: { term: "cold-zone" },
      denominator:
        `${fmtCount(view.openInCold)} of ${fmtCount(view.openFindings)} open findings, on`
        + ` ${fmtCount(view.coldRepos)} of ${fmtCount(view.reposWithOpen)} repositories with`
        + " open findings where nothing has been resolved, removed or rotated for"
        + ` ${windowText}${modeClause}. ${clock}${coverageClause}`,
      value: view.pct === null ? absentText : pct1(view.pct),
      visual: dotGrid({
        sharePct: view.pct,
        label: fmtCount(view.openInCold) + " of " + fmtCount(view.openFindings)
          + " open findings sit on repositories with no movement for " + windowText,
      }),
      caption: el("span", {},
        el("strong", {}, fmtCount(view.openInCold)), " of " + fmtCount(view.openFindings)
        + " open findings, on ",
        el("strong", {}, fmtCount(view.coldRepos)), " of " + fmtCount(view.reposWithOpen)
        + " repositories idle for " + windowText + "."
        + (view.atLedgerClock ? "" : " This figure moves as the page is reopened.")),
      link: { href: "#/repos", text: "Repositories" },
    });
  }

  // ------------------------------------------------------------------------- the splits

  function renderSplits(payload) {
    clear(splitsHost);
    const splits = [renderRegisters(payload), renderSeverity(payload)].filter(Boolean);
    if (splits.length) splitsHost.append(briefSplits(...splits));
  }

  /**
   * The open backlog by register, each part carrying its sync-on-sync change. Three registers,
   * three clocks — the half-lives are never summed, so they ride in the foot one per register.
   */
  function renderRegisters(payload) {
    const view = executiveRegisterView(payload && payload.byScope);
    if (!view.show) return null;
    const open = openMovementView(payload && payload.movement);
    const chips = new Map(open.show ? open.rows.map((r) => [r.scope, r.chip]) : []);
    const parts = view.rows.map((r, i) => ({
      label: r.label,
      value: r.open,
      tone: "r" + (i * 2 + 1),
      note: briefDelta(chips.get(r.scope), { form: "count" }),
    }));
    return briefSplit({
      label: "By register",
      parts,
      aria: "Open findings by register: "
        + parts.map((p) => p.label + " " + fmtCount(p.value)).join(", "),
      foot: el("span", {},
        tipLabel("MTTR per register", {
          term: "half-life",
          lines: [
            "Three registers, three clocks. The same CVE arriving through a dependency and"
            + " through first-party code is two findings with two clocks, so these are never"
            + " summed into one number.",
          ],
        }),
        ": " + view.rows.map((r) => r.label + " " + r.kmText).join(" · ")),
      // EACH SHARE CARRIES ITS BASE: the old table's share cell, one line, with the same
      // empty-base rule — a register with nothing open states that, never "0% of 0".
      after: [el("p", { class: "small muted" },
        "Share of the open backlog: ",
        ...view.rows.flatMap((r, i) => [
          i ? " · " : "",
          r.label + " ",
          el("span", {
            class: "num",
            "data-denominator": r.share.denominator === null ? "none" : String(r.share.denominator),
          }, r.share.baseEmpty ? "— " + r.share.emptyLabel : r.share.text),
        ]),
        view.rows.length && !view.rows[0].share.baseEmpty
          ? " — of " + view.rows[0].share.denominatorLabel
          : "")],
    });
  }

  function renderSeverity(payload) {
    const view = executiveSeverityView(payload, boot.severityOrder);
    if (!view.show) return null;
    const parts = view.tiles.map((t) => ({
      label: sevWord(t.sev),
      value: t.count,
      tone: t.sev,
    }));
    return briefSplit({
      label: tipLabel("By severity", {
        lines: [
          "Severity is the grade Wiz put on the detection, over OPEN findings only.",
          "On secrets it grades the detection, not whether the credential is live.",
        ],
      }),
      parts,
      aria: "Open findings by severity: "
        + parts.map((p) => fmtCount(p.value) + " " + p.label).join(", "),
      foot: fmtCount(view.open) + " open of " + fmtCount(view.total) + " tracked.",
      after: [view.note ? el("p", { class: "small muted" }, view.note) : null],
    });
  }

  // ------------------------------------------------------------------ the reading notes

  /**
   * What qualifies every figure on the page, ON THE SURFACE: how long this register has been
   * watching, the window line, and end-of-life repositories still counted. These are honesty
   * statements, not explanations of a figure, so none of them may move into a tip.
   */
  function renderNotes(payload) {
    clear(notesHost);
    const notes = [];
    const tracking = trackingSinceView(payload);
    if (tracking.show) notes.push(tracking.text);
    const km = (payload && payload.mttr && payload.mttr.remediation
      && payload.mttr.remediation.km) || null;
    const windowLine = windowLineView(payload, km);
    if (windowLine.show) notes.push(tipLabel(windowLine.text, WINDOW_LINE_HELP));
    const eol = endOfLifeExclusionNote(payload && payload.endOfLife, "the MTTR figures");
    if (eol) notes.push(eol);
    const block = briefNotes(notes);
    if (block) notesHost.append(block);
  }

  // ----------------------------------------------------------------------- fix first

  /**
   * The ranked list, cut to its top three GROUPS: the briefing's small table, and the only
   * copy of the ranking on the page. (The full, folded Fix next list under it is gone — the
   * same groups drawn twice, and a worklist on a page read at a glance.)
   *
   * EVERY ROW CARRIES ITS UNITS and links to its own register. The head says how much of the
   * ranking the three rows are ("Top 3 of 8 groups"); how much of the BACKLOG the ranking is
   * rides on the Act now figure's caption (`rankedShort`). The cap stays on the surface under
   * the rows — a constraint on the ranking is a fact a reader needs without opening anything.
   */
  function renderFixNext(payload) {
    const view = fixNextView(payload, boot);
    clear(fixHost);
    if (!view.show) return;
    const label = tipLabel("Fix first", { term: "fix-next" });
    if (view.empty) {
      fixHost.append(el("section", { class: "brief-list" },
        el("div", { class: "brief-list__head" }, el("h2", { class: "brief-label" }, label)),
        emptyState("Nothing is ranked.", view.emptyReason)));
      return;
    }
    const top = view.items.slice(0, 3);
    fixHost.append(briefList({
      label,
      action: el("span", { class: "small muted" }, "Top " + fmtCount(top.length) + " of "
        + fmtCount(view.items.length) + " " + pluralize(view.items.length, "group")),
      rows: top.map((it) => ({
        tone: tierTone(it.tier),
        primary: it.repoText,
        secondary: it.tierLabel + " · " + it.scopeLabel,
        figure: it.countText,
        meta: it.oldestText,
        href: it.href,
        aria: it.tierLabel + " — " + it.repoText + ", " + it.countText + ", " + it.oldestText
          + ". " + it.linkLabel,
      })),
    }));
    if (view.cutNote) fixHost.append(el("p", { class: "small muted" }, view.cutNote));
  }
}
