// Executive — the front door, and the one page a leader is allowed to read alone.
//
// ONE NUMBER, AND IT IS ALLOWED TO REFUSE TO BE A NUMBER. The hero is the register's
// remediation half-life read off a Kaplan-Meier curve. Where that curve never falls to
// half — which is the normal state of a young register carrying more open findings than
// closed ones — there IS no median, and the page publishes `medianLowerBound` as "at least
// N days" instead. PRODUCT.md's sixth principle is the whole reason this file exists in
// this shape: a clock has to say where it started, and a bare number in the hero slot would
// be claiming a measurement nobody made. `executiveHeroView` is where that decision lives,
// pure and exported, so the claim is testable without a DOM.
//
// NO CHART ON THE FRONT DOOR, and that is a decision rather than an omission. Chart.js is
// ~170 KB fetched over `google.script.run` on the first route that draws one
// (chartsLoader.js); the landing page draws none, so the front door never pays for it. The
// survival curve, its censor markers and the per-severity split live on MTTR & SLA, one
// link away — see `curveNote` below, which also states the payload reason.
//
// WHAT THIS PAGE IS SENT, and what it therefore cannot say. `api_getExecutivePage` composes
// two read-models and slices one of them hard (domain/pagePayload.ts::execMttrSlice): the
// hero arrives as `{median, medianLowerBound}` and NOTHING else — no `curve`, no `censored`,
// no `events`. So the hero's qualifier line names resolved and still-open lifecycles, which
// are in the payload, and does not claim they are the estimator's event and censored counts,
// which are not. `execGroupSlice` narrows the per-register split to `{group, kmMedian, open}`,
// dropping each register's own `kmMedianLowerBound` — so a register whose curve never
// reaches half shows a dash there rather than a bound, and says so.

import { bootstrap, swrCall } from "../store.js";
import {
  clear, dataTable, days1, el, emptyState, errorState, fmtCount, fmtDate, fmtDateTime,
  fmtDays, heroStat, kpiCard, num, pageHeader, pluralize, sectionLabel, sevBadge,
  skeleton, statRow, statusPill,
} from "../ui.js";
// THE HALF-LIFE DECISION IS IMPORTED, NOT REPEATED. `execMttrSlice` is a slice of the MTTR
// page's own payload (api.ts says so), so the rule that turns `{median, medianLowerBound}`
// into a sentence has to be the same rule on both pages or the front door and the detail page
// could describe the same estimate differently. It lives on the page that owns the clock.
// `fmtCount`/`fmtDays` themselves come from `../ui.js` now, not from `./mttr.js` — see
// `ui/figures.js`'s module header.
import { kmHalfLifeView, rateView } from "./mttr.js";

const SCOPE_LABELS = { sca: "Dependencies (SCA)", sast: "Code (SAST)", secrets: "Secrets" };

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
 * bare "41 days" would state a median that was never observed; collapsing it to "—" would
 * throw away a true statement. So it is published, prefixed, and flagged.
 *
 * @param {object|null|undefined} payload  `api_getExecutivePage`'s reply
 * @returns {{measured: boolean, value: string, isLowerBound: boolean, days: number|null,
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
    measured: half.measured,
    value: half.value,
    isLowerBound: half.isLowerBound,
    days: half.days,
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

/**
 * The three registers side by side: how much is open in each, and how fast each closes.
 *
 * THE HALF-LIFE COLUMN CAN ONLY BE A NUMBER OR A DASH HERE. `execGroupSlice` ships
 * `kmMedian` and drops `kmMedianLowerBound`, so a register whose curve never reaches half
 * arrives as `kmMedian: null` with no bound behind it. That renders as "—" plus a footnote
 * pointing at MTTR & SLA, never as a 0 and never as an invented figure.
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
      const kmMedian = r.kmMedian === null || r.kmMedian === undefined ? null : Number(r.kmMedian);
      const open = Number(r.open || 0);
      return {
        scope,
        label: SCOPE_LABELS[scope] || String(scope),
        open,
        share: rateView(
          totalOpen > 0 ? (open / totalOpen) * 100 : null,
          totalOpen,
          fmtCount(totalOpen) + " open across the registers",
        ),
        kmMedian,
        kmText: kmMedian !== null && Number.isFinite(kmMedian) ? fmtDays(kmMedian) : "—",
        // True where the register HAS lifecycles but no observable median. The bound that
        // would replace the dash is not in this payload.
        boundNotShipped: kmMedian === null,
      };
    })
    .sort((a, b) => b.open - a.open);
  return {
    show: rows.length > 0,
    rows,
    totalOpen,
    anyBoundMissing: rows.some((r) => r.boundNotShipped),
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
      reason: "Under a week of history, or the half-life was not observable at one of the two"
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
      ? "Half-life unchanged versus last week"
      : "Half-life " + (direction === "up" ? "up" : "down") + " " + magnitude
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
      repoText: repo === null ? "—" : repo,
      ownerProject: g.owner_project === null || g.owner_project === undefined
        ? null
        : String(g.owner_project),
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
    // The links land on the register, not on the repository: no register page reads a
    // repository filter out of the hash today (`readRegisterParams` takes `sev` and `nofix`
    // and nothing else). Saying so costs a sentence; a link that silently ignores half of
    // what it promised costs a reader's trust in every other link on the page.
    linkNote: "Each link opens that register unfiltered — the register pages take a severity"
      + " filter and a fix-availability switch, and no repository filter yet.",
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
      figure: "Remediation half-life",
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

/** The one valid scope a deep link may narrow this page to. */
function scopeParam(params) {
  const s = params && params.scope;
  return s === "sca" || s === "sast" || s === "secrets" ? s : null;
}

export async function renderExecutive(host, params, _ctx) {
  const boot = await bootstrap();
  const scope = scopeParam(params);

  let paint = null;
  const data = swrCall(
    "api_getExecutivePage",
    scope ? { scope } : {},
    (fresh) => paint && paint(fresh),
  );

  const noticeHost = el("div", {});
  const heroHost = el("div", {});
  // Directly under the hero and ABOVE the tiles: the hero states the register's claim about
  // itself, this states what follows from it, and only then comes the description.
  const fixHost = el("div", {});
  const sevHost = el("div", {});
  const registerHost = el("div", {});
  const scanHost = el("div", {});
  host.append(noticeHost, heroHost, fixHost, sevHost, registerHost, scanHost);

  // One failing section must never blank the front door.
  function guard(label, target, fn) {
    try {
      fn();
    } catch (e) {
      console.error("[executive] " + label + " render failed:", e);
      // A render that THREW is a defect, not an absence — see feedback.js. `emptyState` here
      // announced a crash in a role="status" box, in the same voice this page uses for "no
      // sync saved yet", and swallowed the exception entirely.
      clear(target).append(errorState(
        "Couldn't render " + label + ".",
        { detail: String((e && e.message) || e) },
      ));
    }
  }

  clear(heroHost).append(
    el("div", { role: "status", "aria-label": "Computing the remediation half-life" },
      skeleton("line", { width: "220px" }),
      skeleton("stat", { width: "260px", height: "56px" })),
  );
  guard("the last-sync caption", scanHost, renderScan);

  paint = (payload) => {
    const first = executiveFirstRunView(payload, boot);
    guard("the first-run panel", noticeHost, () => renderFirstRun(first));
    guard("the half-life", heroHost, () => renderHero(payload, first));
    // SUPPRESSED, not dashed. See `executiveFirstRunView`: a dash still holds a figure's slot
    // and reads as "coming", while the panel above has already named what each of these
    // waits on. Both blocks are cleared so a stale paint cannot leave zeros behind them.
    if (first.show) {
      clear(fixHost);
      clear(sevHost);
      clear(registerHost);
      return;
    }
    guard("the fix-next list", fixHost, () => renderFixNext(payload));
    guard("open findings by severity", sevHost, () => renderSeverity(payload));
    guard("the register split", registerHost, () => renderRegisters(payload));
  };

  try {
    paint(await data);
  } catch (e) {
    console.error("[executive] api_getExecutivePage failed:", e);
    clear(heroHost).append(errorState(
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

    heroHost.append(pageHeader({
      hero: heroStat(
        "Remediation half-life",
        view.value,
        view.qualifier,
        { term: "half-life" },
      ),
      aside: renderMovement(payload),
      // "Tracked 0 · Resolved 0 · Still open 0" is three zeros over a ledger nobody has read.
      // The hero's own "Not measured" and its qualifier already carry the honest version, and
      // the panel above names what the counts wait on.
      stats: first && first.show ? [] : stats,
    }));

    if (view.isLowerBound) {
      heroHost.append(el("p", { class: "small muted" },
        "The survival curve never falls to half within the observed window, so there is no"
        + " median to publish. What is true is the bound above: more than half of what is"
        + " tracked is still open, so the half-life is at least that long."));
    } else if (!view.measured) {
      heroHost.append(el("p", { class: "small muted" },
        "No lifecycle has a readable clock yet. This is “not measured”, not zero —"
        + " the half-life needs at least one observation to rest on."));
    }
    heroHost.append(curveNote());
  }

  /**
   * Where the curve is, and why it is not here.
   *
   * The stub promised one figure with its censored count beside it, and that is what the
   * hero draws. The CURVE itself is not in this payload — `execMttrSlice` ships two scalars
   * — so this points at the page that has it rather than drawing an empty box on the front
   * door or paying 170 KB for a chart the landing page was sliced to avoid.
   */
  function curveNote() {
    return el("p", { class: "small muted" },
      "The survival curve, its censor markers and the per-severity split are on ",
      el("a", { class: "linklike", href: "#/mttr" }, "MTTR & SLA"),
      ". This page is sent the estimate only, not the curve behind it.");
  }

  /**
   * One row of the movement strip: a register, its chip, and the pair the chip is FROM.
   *
   * The raw pair rides beside the delta on purpose. A chip reading "−40" is a claim about two
   * numbers, and a reader who cannot see both has to trust it; "280 open, was 320" is the
   * arithmetic in the open. `null` chip means the previous count was not measurable, and that
   * renders as words rather than as a ±0 (see `deltaChipView`).
   */
  function movementRow(label, r) {
    const row = el("div", { class: "movement-row" },
      el("span", { class: "movement-label small" }, label));
    if (r.chip) {
      const glyph = r.chip.direction === "up" ? "▲" : r.chip.direction === "down" ? "▼" : "=";
      row.append(el("span", {
        class: "pill " + r.chip.kind,
        // The glyph is decorative; the label spells the direction and the size in words.
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
   * Movement, and what it is movement OF — now two measurements rather than one.
   *
   * THE OPEN BACKLOG LEADS. It is observable on any register that has synced twice; the
   * half-life comparison below it is the better statement but needs a Kaplan-Meier median at
   * BOTH endpoints, which a young register does not have (this seed: no median at all, a lower
   * bound of 293.9 days). Where the half-life comparison exists it is drawn underneath, in its
   * own words; where it does not, nothing is drawn for it — the open-backlog block above has
   * already said what moved, and a second "no comparison" line would only restate the first.
   */
  function renderMovement(payload) {
    const open = openMovementView(payload && payload.movement);
    const half = executiveMovementView(payload && payload.weekTrend);
    const box = el("div", { class: "page-strip" },
      el("div", { class: "kpi-label" }, "Movement"));

    if (!open.show) {
      box.append(el("div", { class: "small muted" },
        "No open-backlog comparison. " + open.reason));
    } else {
      box.append(el("div", { class: "movement-rows" },
        movementRow("All registers", open.total),
        ...open.rows.map((r) => movementRow(r.label, r))));
      box.append(el("div", { class: "small muted" }, open.dates));
      box.append(el("div", { class: "small muted" },
        "A rising count is worse. The comparison is between two syncs, not between two"
        + " calendar dates — a register only learns anything on the days it looks."));
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
   * EVERY ROW CARRIES ITS UNITS. "7" is not a figure; "7 open findings" is. The oldest age
   * carries "days" for the same reason, and a group whose rows have no readable age says so
   * rather than printing a 0.
   */
  function renderFixNext(payload) {
    const view = fixNextView(payload, boot);
    clear(fixHost);
    if (!view.show) return;

    fixHost.append(sectionLabel("Fix next"));
    fixHost.append(el("p", { class: "small muted" },
      "Ranked by what cannot wait rather than by severity: a credential somebody confirmed is"
      + " live, then a dependency finding with a published fix that is already late, then a"
      + " critical weakness in first-party code that is already late. Grouped by repository,"
      + " because that is the smallest unit somebody can be asked to own."));

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
              "aria-label": it.tierLabel + " — " + it.repoText + ", " + it.countText
                + ", " + it.oldestText + ". " + it.linkLabel,
            }, it.repoText)),
          el("div", { class: "fixnext-meta small muted" },
            it.scopeLabel + " · " + it.countText + " · " + it.oldestText
            + " · " + (it.ownerProject === null
              ? "no single owning project"
              : it.ownerProject)),
        ));
      }
      fixHost.append(list);
    }

    fixHost.append(el("p", { class: "small muted" }, view.unrankedSentence));
    if (view.cutNote) fixHost.append(el("p", { class: "small muted" }, view.cutNote));
    fixHost.append(el("p", { class: "small muted" }, view.linkNote));
  }

  // -------------------------------------------------------------------------- severity

  function renderSeverity(payload) {
    const view = executiveSeverityView(payload, boot.severityOrder);
    clear(sevHost);
    if (!view.show) {
      sevHost.append(sectionLabel("Open findings by severity"));
      sevHost.append(emptyState("No severity tally in this payload."));
      return;
    }
    sevHost.append(sectionLabel("Open findings by severity"));
    const row = el("div", { class: "kpi-row" });
    for (const t of view.tiles) {
      row.append(kpiCard(sevBadge(t.sev), fmtCount(t.count), "open"));
    }
    sevHost.append(row);
    sevHost.append(el("p", { class: "small muted" },
      fmtCount(view.open) + " open of " + fmtCount(view.total) + " tracked. Severity is the"
      + " grade Wiz put on the detection; on the secrets register it grades the detection and"
      + " not whether the credential is live, which is why that register is segmented"
      + " differently on its own page."));
    if (view.note) sevHost.append(el("p", { class: "small muted" }, view.note));
  }

  // ------------------------------------------------------------------------- registers

  function renderRegisters(payload) {
    const view = executiveRegisterView(payload && payload.byScope);
    clear(registerHost);
    registerHost.append(sectionLabel("The three registers"));
    if (!view.show) {
      registerHost.append(emptyState(
        "No per-register split yet.",
        "It appears once a sync has saved findings for at least one register.",
      ));
      return;
    }
    registerHost.append(dataTable({
      columns: [
        { key: "label", label: "Register", cell: (r) => r.label },
        {
          key: "open",
          label: "Open",
          className: "num",
          cell: (r) => fmtCount(r.open),
        },
        {
          key: "share",
          label: "Share of the open backlog",
          cell: (r) => el("span", {},
            el("span", { class: "num" }, r.share.text),
            " ",
            // `baseEmpty` over the visible text, the raw denominator in the attribute —
            // the same split mttr.js's `denominatorNode` makes, and for the same reason:
            // "not measured 0 open across the registers" reads as a measurement of nothing.
            el("span", {
              class: "small muted",
              "data-denominator": r.share.denominator === null ? "none" : String(r.share.denominator),
            }, r.share.baseEmpty ? "— " + r.share.emptyLabel : r.share.denominatorLabel)),
        },
        {
          key: "km",
          label: "Half-life",
          className: "num",
          help: { term: "half-life" },
          cell: (r) => r.kmText,
        },
      ],
      rows: view.rows,
      className: "exec-registers",
    }));
    registerHost.append(el("p", { class: "small muted" },
      "Three registers, three clocks. The same CVE arriving through a dependency and through"
      + " first-party code is two findings with two clocks, so these are never summed into one"
      + " number."));
    if (view.anyBoundMissing) {
      registerHost.append(el("p", { class: "small muted" },
        "A dash means that register's curve never falls to half. Its lower bound is not in"
        + " this payload; MTTR & SLA publishes it."));
    }
  }

  // ------------------------------------------------------------------------- last sync

  /**
   * When the register last looked. The CONTROL to look again is the Run sync button in the
   * rail — one button in one place, so a reader is never offered two that could disagree
   * about what is already running.
   *
   * ON AN EMPTY LEDGER THIS SECTION DEFERS RATHER THAN RESTATES. It used to print "No sync
   * saved yet." over its own call to action — the same claim and the same instruction the
   * first-run panel already carries at the top of this page, several screens up. Two copies
   * of one sentence drift, and a second call to action invites a reader to hunt for a second
   * control. The section still earns its place because it answers what the panel does not —
   * WHEN did the register last look — so it answers that, and leaves the rest where it is.
   */
  function renderScan() {
    clear(scanHost);
    scanHost.append(sectionLabel("Last sync"));
    const latest = boot.latestSync;
    if (!latest) {
      scanHost.append(emptyState(
        "Never.",
        "What each figure is waiting for is listed in the panel at the top of this page.",
      ));
      return;
    }
    // EVERY REGISTER THE SYNC TOUCHED, not the one that sorted first. One run writes one
    // `scans` row per scope; naming a single one here reported a third of the observation as
    // the whole of it — on the page that argues two sections above that the three registers
    // are three clocks and are never collapsed into one.
    scanHost.append(el("p", { class: "scan-caption" },
      fmtDateTime(latest.ts)
      + " · " + fmtCount(latest.total) + " " + pluralize(Number(latest.total || 0), "finding")
      + " across " + fmtCount(latest.scopes.length)
      + " " + pluralize(latest.scopes.length, "register")));
    scanHost.append(el("ul", { class: "scan-scopes small muted" },
      ...latest.scopes.map((s) => el("li", {},
        (SCOPE_LABELS[s.scope] || s.scope)
        + " · " + fmtCount(s.total) + " " + pluralize(Number(s.total || 0), "finding")
        // The coverage half of the caption. `null` means the severity gate was off for that
        // register and it looked at everything — which is the SECRETS default, so rendering
        // it as "none" would invert the most deliberate choice in this product.
        + " · " + (s.severities ? "severities " + s.severities : "all severities"),
      ))));
    scanHost.append(el("p", { class: "small muted" },
      "What that sync changed is on ",
      el("a", { class: "linklike", href: "#/history" }, "Scan history"),
      ", which is the page sent the per-scan arrival and closure counts — one row per register"
      + " per sync. Run another with the Run sync button in the rail."));
    if (!boot.hasCredentials) {
      scanHost.append(el("p", { class: "small muted" },
        "No Wiz credentials are configured, so these figures come from a dry run rather than"
        + " from the tenant."));
    }
  }
}
