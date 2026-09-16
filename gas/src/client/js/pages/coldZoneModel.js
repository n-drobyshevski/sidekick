// The Cold zone page's decisions, with no DOM anywhere near them.
//
// The DOM-free twin of `pages/coldZone.js`, the convention `overviewModel.js`,
// `historyModel.js` and `programCapacity.js` already follow here: the interesting cases on
// this page are PAYLOAD SHAPES — an older server with no `mode`, a half-applied cache entry
// carrying `measurable: true` over a null `totals`, a share that arrived as an explicit null
// — and those are enumerable in node. Pixels are not.
//
// PORTED FROM `gas_devsecops/src/client/js/pages/repos.js` (its `coldZoneView` …
// `coldScatterPoints` block), which reads the same domain family one grain over. What the
// port changes is the NOUNS and one denominator:
//
//   repository      becomes ASSET. `src/domain/coldZone.ts` publishes `assets` / `*_assets`.
//   project         becomes SUPPORT GROUP, joined live from the support-group map rather
//                   than stored on the row — so with no map refreshed every asset lands in
//                   `(no support group)`, which is a fact about the map and the page says so.
//   "resolved,      becomes "resolved". This register has ONE remediation column
//   removed or      (`resolved_at`); there is no rotation and no removal to name, and a
//   rotated"        sentence listing two events that cannot happen here would be noise.
//   secrets carry   becomes UNCLASSIFIED ROWS. The third card's denominator explains why a
//   no risk class   small "high risk sitting cold" figure may be a MEASUREMENT GAP rather
//                   than good news: `program.classifyRisk` returns `"unknown"` for a row
//                   whose enabled risk signals were never captured, and an unknown row is a
//                   real open finding that can never count as a high-risk one.
//
// What the port does NOT change, because each is load-bearing:
//   * `measurable` is decided from the SHAPE, never from the flag — see `coldZoneView`.
//   * An explicit null is an answer and is never rewritten as 0.
//   * NOTATION: prose says "at least N", a cell says "≥ N", and neither ever says ">".
//     Every duration in a sentence here goes through `fmtDays` behind "at least"; the one
//     place a "≥" appears is `coldAssetRows`, through the shared `boundedDays`.

import {
  absentText, boundedDays, fmtCount, fmtDays, num, pct1,
} from "../../../../../gas_shared/ui/figures.js";
import { fmtDate, pluralize } from "../../../../../gas_shared/ui/format.js";
import { MAX_EXACT_CELLS, unitChartModel } from "../../../../../gas_shared/ui/unitChart.js";

/**
 * The label an asset with no `_supportGroup` is filed under.
 *
 * `src/domain/coldZone.ts` exports this exact string as `COLD_GROUP_NONE` and puts it on
 * every group row's `label`, so the group table never spells it itself. It is repeated here
 * for the one place the payload cannot supply it — an ASSET row, whose `support_group` is the
 * raw joined value and is null for exactly these assets. Not imported: no page in this client
 * imports from `src/domain/`, and a one-phrase literal is a smaller cost than pulling a
 * server module into the browser bundle.
 */
export const NO_GROUP = "(no support group)";

/** The word an asset's verdict is printed as. The word is the signal; the dot repeats it. */
export const COLD_VERDICT_LABEL = {
  cold: "Cold",
  warm: "Warm",
  clear: "Clear",
  watching: "Not yet measurable",
  unobserved: "Unobserved",
};

/** The same, for a support group's rollup of its assets. */
export const GROUP_VERDICT_LABEL = {
  "fully-cold": "Fully cold",
  "partly-cold": "Partly cold",
  warm: "Warm",
  clear: "Clear",
};

/**
 * The cold zone, read off the page payload's `coldZone` — a `ColdZoneResult`.
 *
 * REFUSE BEFORE ANY CAST, and refuse on the SHAPE rather than on the flag. `measurable` is a
 * field in the payload, but every block this page draws reads `totals`, `assets` and
 * `groups`, and the domain sets all three to null in exactly the case the flag describes. A
 * payload that said `measurable: true` and carried a null `totals` — an older server, a
 * half-applied durable cache entry — would pass a flag check and then throw inside a render
 * function, which on this page means a whole section is replaced by an error box for what is
 * really an absence. So the view decides `measurable` for itself from what actually arrived,
 * and every array it publishes is a real array whether or not anything was measured.
 *
 * `present` IS NOT `measurable`. `present: false` means no cold-zone block reached this page
 * at all (an old payload); `measurable: false` means the block arrived and honestly says it
 * has no clock yet. Both draw the same notice today; only one of them is a deployment
 * mismatch, and collapsing them would make that invisible.
 */
export function coldZoneView(model) {
  const cz = model && typeof model === "object" && !Array.isArray(model) ? model.coldZone : null;
  const present = !!cz && typeof cz === "object" && !Array.isArray(cz);
  const totals = present && cz.totals && typeof cz.totals === "object" && !Array.isArray(cz.totals)
    ? cz.totals
    : null;
  const assets = present && Array.isArray(cz.assets) ? cz.assets : null;
  const groups = present && Array.isArray(cz.groups) ? cz.groups : null;
  const measurable = present && cz.measurable === true && totals !== null && assets !== null
    && groups !== null;
  const withOpen = totals ? num(totals.assets_with_open, 0) : 0;
  const unobserved = totals ? num(totals.assets_unobserved, 0) : 0;
  // ABSENT IS "fixed", AND ONLY THE EXACT WORD IS RELATIVE. `mode` arrived with the second
  // definition of the line, so a payload that predates it carries no `mode` at all and is
  // asking for exactly what it always got. Anything that is not the literal "relative" — a
  // stray casing, a number, a half-applied cache entry — is read as the older contract rather
  // than cast, for the same reason the shape decides `measurable` above.
  const mode = present && cz.mode === "relative" ? "relative" : "fixed";
  // THE SHARE THE LINE ACTUALLY DREW. A payload that carries the field and a NULL in it is
  // making a real statement ("no asset has an open finding, so there is no share"), so the
  // fallback fires only when the KEY IS MISSING — an older server — and lands on the totals'
  // own copy of the same number. Collapsing the two would turn an honest refusal into a
  // figure copied from somewhere else.
  const achievedRaw = present && Object.prototype.hasOwnProperty.call(cz, "achieved_share_pct")
    ? num(cz.achieved_share_pct)
    : undefined;
  const eligibleRaw = present ? num(cz.eligible_assets) : null;
  return {
    present,
    measurable,
    // WHICH DEFINITION DREW THE LINE — never a second copy of the line itself. `coldAfterDays`
    // below is the EFFECTIVE threshold in both modes (src/domain/coldZone.ts's header), so
    // nothing this page renders branches on the mode to read a number; the mode is read to say
    // WHERE the number came from, which is a different sentence.
    mode,
    // The operator's fixed window, which survives the switch: in relative mode it is what was
    // asked for before the estate was consulted, and it is NOT what the page classifies by.
    fixedAfterDays: present ? num(cz.fixed_after_days) : null,
    targetSharePct: present ? num(cz.target_share_pct) : null,
    achievedSharePct: achievedRaw === undefined
      ? (totals ? num(totals.cold_asset_share_pct) : null)
      : achievedRaw,
    floorDays: present ? num(cz.floor_days) : null,
    floorApplied: present && cz.floor_applied === true,
    derivedDays: present ? num(cz.derived_days) : null,
    // `eligible_assets === totals.assets_with_open` by construction, so an older payload that
    // carries only the totals can still answer "a share of what".
    eligibleAssets: eligibleRaw === null ? (totals ? num(totals.assets_with_open, 0) : null)
      : eligibleRaw,
    // The cold assets whose idle time was never measured — the cost of ranking an asset at the
    // bound it can prove. Null, not 0, when nothing was measurable.
    coldBoundOnly: present ? num(cz.cold_bound_only) : null,
    groupsInColdestShare: totals ? num(totals.groups_in_coldest_share, 0) : 0,
    // The threshold and the clock ride along even when nothing is measurable: a reader asking
    // "cold after how long?" is asking about the setting, not about the data.
    coldAfterDays: present ? num(cz.cold_after_days) : null,
    asOf: present && typeof cz.as_of === "string" ? cz.as_of : null,
    observedFrom: present && typeof cz.observed_from === "string" ? cz.observed_from : null,
    // Rows the classifier could not decide, and severities with no flat scan on record. Both
    // report even where nothing is measurable — that is the whole point of publishing them:
    // an empty section can still prove it looked.
    unclassifiedRows: present ? num(cz.unclassified_rows, 0) : 0,
    severitiesWithoutScan: present && Array.isArray(cz.severities_without_scan)
      ? cz.severities_without_scan.map((s) => String(s))
      : [],
    // FROM THE PAYLOAD, NEVER HARDCODED. The bucket edges move with the threshold (a 120-day
    // window makes them 0-40/40-80/80-120/≥ 120), so a header spelled here would be a second,
    // silently wrong statement of the operator's setting. Null when nothing is measurable,
    // which is exactly when the heat table is not drawn.
    bucketLabels: measurable && Array.isArray(cz.bucket_labels)
      ? cz.bucket_labels.map((l) => String(l))
      : null,
    assets: measurable ? assets : [],
    groups: measurable ? groups : [],
    totals: measurable ? totals : null,
    // IS THERE A POPULATION TO SPEAK ABOUT AT ALL. Not the same question as "is it
    // measurable": a register with a clock and ten assets, every one of them clear and every
    // one still returned by the newest scan, has nothing for this page to say.
    populated: measurable && (withOpen > 0 || unobserved > 0),
  };
}

/**
 * "N of them have no movement on record at all" — the cost of a line drawn over lower bounds.
 *
 * An asset that has never closed anything has no measured silence, only a bound counted from
 * when this register started watching (`coldZone.ts`: `idle_is_bound`). Both modes classify
 * and print it by that bound, which is a systematic UNDER-estimate of how long it has really
 * been quiet — so the count of cold assets resting on one is said out loud rather than left
 * inside a figure that looks measured.
 */
export function boundOnlySentence(n) {
  return n === 1
    ? "1 of them has no movement on record at all, so its idle time is a lower bound."
    : fmtCount(n) + " of them have no movement on record at all, so their idle time is a"
      + " lower bound.";
}

/**
 * WHERE THE LINE CAME FROM, in one sentence, above everything the line decided.
 *
 * The page publishes one threshold in days and every figure under it reads that one number —
 * which is exactly why the number alone is not enough to read the page. Ninety days can be an
 * operator's standing window or the idle time of the tenth-idlest asset on this estate last
 * Tuesday, and those two facts age completely differently: the first is a policy a support
 * group can be held to, the second moves when the population moves and says nothing about any
 * absolute amount of silence. So the caption names the MODE first, then what the mode
 * produced, and in relative mode it also names what it AIMED at — because a share that was
 * asked for and a share that was achieved are two numbers and the register publishes both.
 *
 * WHAT IT REFUSES TO ROUND OFF:
 *   * The floor gets its own clause in both directions. "The 14-day floor did not apply" is a
 *     fact the reader needs in order to trust the derived line; "the floor holds the line
 *     instead" is the reason the zone came out SMALLER than the share asked for, and without
 *     it the achieved share reads as a failure of the estate rather than a deliberate refusal
 *     to slander four assets that were all touched last week.
 *   * "Nothing to rank" is not "0% are cold". With no eligible asset the relative line rests
 *     on the floor and the caption says so, rather than reporting a share over an empty
 *     population.
 *   * Not measurable is its own sentence in both modes: there is no clock, so there is no line
 *     to have landed anywhere, and the caption says what WOULD produce one.
 *
 * @param {object|null|undefined} view  a `coldZoneView` result
 * @returns {string} always a sentence — every state this page can be in has one
 */
export function coldModeCaption(view) {
  const v = view || {};
  const relative = v.mode === "relative";
  const days = num(v.coldAfterDays);
  const floor = num(v.floorDays);
  // "the 14-day floor", or just "the floor" where the payload never said how deep it is. The
  // phrase is built once because it is said in four different sentences below.
  const floorPhrase = floor === null ? "floor" : fmtCount(floor) + "-day floor";
  // The TARGET is an operator's whole-number choice (Settings clamps it to 1..50), so it
  // prints as a count with a per-cent sign; the ACHIEVED share is a measurement and prints
  // through `pct1`. Two different kinds of number, two different formatters.
  const targetText = fmtCount(num(v.targetSharePct)) + "%";
  const eligible = num(v.eligibleAssets, 0);
  const cold = v.totals ? num(v.totals.cold_assets, 0) : 0;
  const achieved = num(v.achievedSharePct);
  const boundOnly = num(v.coldBoundOnly, 0);
  const suffix = boundOnly > 0 ? " " + boundOnlySentence(boundOnly) : "";
  const windowText = days === null ? "the cold-zone window" : "at least " + fmtDays(days);
  const fixedLead = "Fixed window: an asset is cold after " + windowText
    + " with nothing resolved.";
  const coldCount = fmtCount(cold) + " " + pluralize(cold, "asset")
    + (achieved === null ? "" : " (" + pct1(achieved) + ")");
  const coldVerb = cold === 1 ? "is" : "are";

  if (v.measurable !== true) {
    return relative
      ? "Relative mode: the line is derived from the estate once a scan has been saved, and it"
        + " never falls below the " + floorPhrase + "."
      : fixedLead + " The window is set in Settings, on the Lifecycle tab.";
  }
  if (eligible <= 0) {
    return relative
      ? "Relative mode: no asset has an open finding, so there is nothing to rank. The line"
        + " rests on the " + floorPhrase + " until one does."
      : fixedLead + " No asset has an open finding, so there is no share to report.";
  }
  if (!relative) {
    return fixedLead + " " + fmtCount(cold) + " of " + fmtCount(eligible)
      + " assets with open findings"
      + (achieved === null ? "" : " (" + pct1(achieved) + ")")
      + " " + coldVerb + " cold." + suffix;
  }
  const lead = "Relative mode: the line is set so the idlest " + targetText + " of the "
    + fmtCount(eligible) + " assets with open findings are cold.";
  if (v.floorApplied === true) {
    return lead + " The idlest " + targetText + " would have been "
      + fmtDays(num(v.derivedDays)) + ", so the " + floorPhrase + " holds the line instead, and "
      + coldCount + " " + coldVerb + " cold — a smaller zone than the " + targetText
      + " asked for." + suffix;
  }
  return lead + " It landed at " + fmtDays(days) + " idle, and " + coldCount + " " + coldVerb
    + " cold. The " + floorPhrase + " did not apply." + suffix;
}

/**
 * The assets the figures above cannot speak for, as one sentence — or null.
 *
 * `watching` is the domain's verdict for an asset with open findings, no movement ever
 * recorded, and a lower bound still short of the threshold. It is neither cold nor warm, and
 * the reason it exists as its own state is that a REOPEN clears `resolved_at`
 * (`reconcile.ts`), so an asset whose only close came back has no movement on record through
 * no fault of anyone's. Printing it as warm would claim remediation nobody did; printing it as
 * cold would claim a silence nobody has measured yet. So it is counted apart and the count is
 * said out loud under the cards rather than left to the heat table's fifth column to imply.
 */
export function unmeasurableNote(view) {
  const watching = view && view.totals ? num(view.totals.watching_assets, 0) : 0;
  if (!watching) return null;
  const one = watching === 1;
  return fmtCount(watching) + (one ? " asset has" : " assets have") + " no movement on record"
    + " and less idle time than the window, so " + (one ? "it is" : "they are") + " not yet"
    + " measurable — counted in neither the cold figure nor the warm one.";
}

/**
 * The severities observation could not be decided for — or null when every severity with rows
 * had a flat scan covering it.
 *
 * THE RAIL IS SINGLE-SCOPE HERE, so there is no per-scope dot to draw the way the code
 * register's page does; this is the analogue worth surfacing instead. `coldZone.ts` treats a
 * severity with rows but no covering flat scan as UNDECIDABLE and keeps its assets OBSERVED —
 * the conservative direction, because a missing scan row is not evidence that a support group
 * let an asset vanish. That decision moves assets OUT of the unobserved column, so it is
 * stated rather than left to be inferred from a figure that looks complete.
 */
export function severitiesNote(view) {
  const sevs = view && Array.isArray(view.severitiesWithoutScan) ? view.severitiesWithoutScan : [];
  if (!sevs.length) return null;
  return "No flat scan on record covered " + sevs.join(", ") + ", so assets with only those"
    + " rows are kept as observed.";
}

/**
 * The count line under the group table. The "(no support group)" bucket is named ONLY when it
 * is in the table: a sentence that says "including the assets with no support group" over a
 * table with no such row claims a bucket the reader cannot find.
 *
 * @param {{totals?: {assets_no_support_group?: number}|null}|null|undefined} view
 * @param {number} rowCount  the rows the table actually holds
 * @returns {string}
 */
export function groupCountNote(view, rowCount) {
  const rows = num(rowCount, 0);
  const noGroup = view && view.totals ? num(view.totals.assets_no_support_group, 0) : 0;
  const head = fmtCount(rows) + " " + pluralize(rows, "support group");
  if (!noGroup) return head + ".";
  return head + ", including the " + fmtCount(noGroup) + " " + pluralize(noGroup, "asset")
    + " with no support group recorded, counted together as one.";
}

/**
 * The badge's own count line, under the group table — or null when nobody is badged.
 *
 * TWO SENTENCES, AND THE SECOND ONE IS THE REFUSAL. "The coldest 20%" of an estate where one
 * group has anything cold at all is that ONE group: `rankGroups` clamps the badge to the
 * groups that actually have a cold asset, so a reader who counts the marks and finds fewer
 * than the arithmetic implies is seeing the clamp, not a rendering bug. A line that only
 * reported the count would leave that looking like one.
 *
 * Null in fixed mode by construction rather than by a branch here: `in_coldest_share` is only
 * ever true in relative mode, so the total it is counted from is 0 and there is nothing to
 * say. Same shape as `unmeasurableNote` above — a sentence about zero groups is noise.
 */
export function coldestShareNote(view) {
  const n = view ? num(view.groupsInColdestShare, 0) : 0;
  if (!n) return null;
  const one = n === 1;
  return fmtCount(n) + (one ? " support group is" : " support groups are") + " in the coldest "
    + fmtCount(num(view.targetSharePct)) + "% by the share of " + (one ? "its" : "their")
    + " open-finding assets that are cold. A support group with no cold asset is never marked.";
}

/**
 * The cold zone as one population rather than four figures.
 *
 * WHY A PICTURE AND NOT A FIFTH CARD. The four figures above each answer a different question
 * against a different denominator — cold assets against those with open findings, open
 * findings sitting cold against the whole backlog — and none of them says what the estate
 * looks like. "How much of this register is the scanner actually watching" is a part-to-whole,
 * and a reader was reconstructing it from four numbers with four different bottoms.
 *
 * THE FIVE VERDICTS PARTITION THE REGISTER, which is what makes this a waffle and not five
 * bars: `cold + warm + watching + clear` is every OBSERVED asset (coldZone.ts's verdict
 * switch) and `observed + unobserved` is every asset. `unitChartModel` throws if that ever
 * stops being true, which is the guard worth having here — the day a sixth verdict appears, a
 * silently-renormalised grid would be the last place anyone looked.
 *
 * TWO OF THE FIVE ARE HATCHED, AND THAT IS THE WHOLE POINT. `watching` is an asset with open
 * findings whose idle time could not be measured at all; `unobserved` is one the scanner has
 * lost sight of. Neither is a measurement of idleness, and the page spends most of its words
 * insisting they are not counted as warm. `--hatch` is the design system's own token for
 * exactly that claim — "this part is not a measurement".
 *
 * `clear` IS A RING, NOT A FILL. It is measured and it is fine: nothing open to go quiet on.
 * Drawing it solid would put it in the same visual weight class as cold and warm.
 *
 * EXACT WHERE IT CAN BE. Under MAX_EXACT_CELLS assets the lattice is one cell per asset and
 * there is no rounding to explain; above it the lattice is 100 cells and the model says so in
 * its own label.
 */
export function coldCensusModel(view) {
  const t = view && view.totals;
  if (!t) return null;
  const assets = num(t.assets);
  if (assets === null || assets <= 0) return null;
  return unitChartModel({
    unit: "assets",
    total: assets,
    cells: assets <= MAX_EXACT_CELLS ? "exact" : 100,
    segments: [
      { key: "cold", label: "Cold", count: num(t.cold_assets, 0), tone: "bad", fill: "solid" },
      { key: "warm", label: "Warm", count: num(t.warm_assets, 0), tone: "warn", fill: "solid" },
      {
        key: "watching", label: "Idle time not measured", count: num(t.watching_assets, 0),
        tone: "warn", fill: "hatch",
      },
      { key: "clear", label: "Clear", count: num(t.clear_assets, 0), tone: "ok", fill: "ring" },
      {
        key: "unobserved", label: "Out of sight", count: num(t.assets_unobserved, 0),
        tone: "neutral", fill: "hatch",
      },
    ],
  });
}

/**
 * The four figures, as specs — label, value, the sentence under it and the denominator behind
 * it. DOM-free so the claims can be read without a DOM.
 *
 * FOUR CARDS AND FOUR DENOMINATORS. Each of these is a count over a population that is NOT
 * "every asset", and the populations differ from card to card — assets with open findings,
 * open findings, high-risk open findings, and the whole estate — so a shared sentence would be
 * wrong three times out of four.
 */
export function coldKpiCards(view) {
  const t = view && view.totals;
  if (!t) return [];
  const days = view.coldAfterDays;
  const windowText = days === null ? "the cold-zone window" : "at least " + fmtDays(days);
  const withOpen = num(t.assets_with_open, 0);
  const openFindings = num(t.open_findings, 0);
  const openInCold = num(t.open_in_cold, 0);
  const backlogShare = num(t.cold_backlog_share_pct);
  const assetShare = num(t.cold_asset_share_pct);
  const openInUnobserved = num(t.open_in_unobserved, 0);
  // THE SHARE THE LINE DREW, said on the face of the card. `achievedSharePct` is the same
  // number as `cold_asset_share_pct` in fixed mode and falls back to it on an older payload —
  // it is read here because in RELATIVE mode it is the number the target is judged against,
  // and a card that printed the count alone would leave "did the line do what was asked?"
  // unanswerable without opening the denominator.
  const achieved = num(view.achievedSharePct === undefined ? assetShare : view.achievedSharePct);
  const relative = view.mode === "relative";
  const targetText = fmtCount(num(view.targetSharePct)) + "%";
  const floor = num(view.floorDays);
  const floorPhrase = floor === null ? "floor" : fmtCount(floor) + "-day floor";
  // WHERE THE LINE CAME FROM, in the one denominator whose population the line decides. The
  // caption above the page says this at length for the whole page; the card says it again
  // because a denominator is read on its own, one level down from a figure, and "46 assets
  // with open findings" is a population a relative line CHOSE the size of.
  const modeClause = !relative
    ? ""
    : view.floorApplied === true
      ? " Relative mode: the idlest " + targetText + " of them would have been "
        + fmtDays(num(view.derivedDays)) + ", so the " + floorPhrase + " holds the line instead"
        + " and the zone is smaller than the " + targetText + " asked for."
      : " Relative mode: the idlest " + targetText + " of them are the cold zone, and the line"
        + " landed at " + fmtDays(view.coldAfterDays) + " idle.";
  const boundOnly = num(view.coldBoundOnly, 0);
  const boundClause = boundOnly > 0 ? " " + boundOnlySentence(boundOnly) : "";
  const unclassified = num(view.unclassifiedRows, 0);
  // THE MEASUREMENT GAP BEHIND A SMALL HIGH-RISK FIGURE. `program.classifyRisk` returns
  // "unknown" for a row whose enabled risk signals were never captured on it (or where the
  // operator's rule enables no signal at all). Those rows are real open findings and count as
  // such; they can never count as high-risk ones, because a missing signal is not an observed
  // negative. Said on the card because "3 high-risk findings sitting cold" reads as good news
  // and may be the shape of a backfill that has not run.
  const unclassifiedClause = unclassified > 0
    ? " " + fmtCount(unclassified) + " open " + pluralize(unclassified, "finding")
      + " in this register " + (unclassified === 1 ? "carries" : "carry")
      + " no risk class at all — the signals the rule reads were never captured on "
      + (unclassified === 1 ? "it" : "them") + " — so "
      + (unclassified === 1 ? "it is an open finding here and never a high-risk one."
        : "they are open findings here and never high-risk ones.")
    : "";
  return [
    {
      key: "coldAssets",
      label: "Cold assets",
      value: fmtCount(num(t.cold_assets, 0)),
      sub: achieved === null
        ? "Of " + fmtCount(withOpen) + " with open findings"
        : pct1(achieved) + " of " + fmtCount(withOpen) + " with open findings",
      help: { term: "cold-zone" },
      denominator:
        "Of " + fmtCount(withOpen) + " assets with open findings"
        + (achieved === null ? "" : " (" + pct1(achieved) + ")")
        + "." + modeClause + " Cold means no finding resolved for " + windowText
        + ", measured at the last scan." + boundClause,
    },
    {
      key: "openInCold",
      label: "Open findings sitting cold",
      value: fmtCount(openInCold),
      sub: backlogShare === null
        ? "Of " + fmtCount(openFindings) + " open findings"
        : pct1(backlogShare) + " of " + fmtCount(openFindings) + " open findings",
      help: { term: "idle" },
      denominator:
        "Of " + fmtCount(openFindings) + " open findings across every asset"
        + (backlogShare === null ? "" : ", " + pct1(backlogShare) + " of them")
        + ". The backlog on assets where nothing has moved for " + windowText + ".",
    },
    {
      key: "highRiskInCold",
      label: "High-risk findings sitting cold",
      value: fmtCount(num(t.high_risk_in_cold, 0)),
      sub: "Of " + fmtCount(openInCold) + " open in cold assets",
      denominator:
        "Of " + fmtCount(openInCold) + " open findings on cold assets, high risk under the"
        + " active rule." + unclassifiedClause,
    },
    {
      key: "unobserved",
      label: "Unobserved assets",
      value: fmtCount(num(t.assets_unobserved, 0)),
      sub: fmtCount(openInUnobserved) + " open " + pluralize(openInUnobserved, "finding")
        + " on them",
      help: { term: "unobserved" },
      denominator:
        "Of " + fmtCount(num(t.assets, 0)) + " assets in the ledger. The scanner returned"
        + " nothing for these in the newest scan of any severity they have rows in, so their"
        + " findings close by disappearance — counted apart from cold, and never as warm.",
    },
  ];
}

/**
 * One row per support group, formatted.
 *
 * ORDER IS THE PAYLOAD'S, and the table is handed no sort spec so it stays that way.
 * `coldZoneProfile` already sorts groups by cold assets desc, then open-in-cold desc, then
 * label — a rule that belongs beside the one that computed the counts, not re-derived against
 * a formatted string here. The "(no support group)" bucket sorts by the same rule as every
 * other row: it is a group like any other and is never pinned last or hidden.
 */
export function coldGroupRows(view) {
  const groups = view && Array.isArray(view.groups) ? view.groups : [];
  return groups.map((g) => ({
    key: g.support_group === null || g.support_group === undefined
      ? NO_GROUP
      : String(g.support_group),
    label: g.label || NO_GROUP,
    verdict: g.verdict || null,
    verdictWord: GROUP_VERDICT_LABEL[g.verdict] || absentText,
    assets: num(g.assets, 0),
    coldAssets: num(g.cold_assets, 0),
    // NULL IS A REAL ANSWER and it draws NO meter. A group whose assets all read clear has no
    // asset with open findings to divide by, and the domain returns null rather than 0 for
    // exactly that reason; a 0% track here would be a picture asserting that none of its
    // assets has gone cold, which is a different claim from "there was nothing to ask the
    // question of".
    sharePct: num(g.cold_share_pct),
    // THE RANK IS NOT THE ROW NUMBER, and both modes carry it. The table is published in the
    // payload's own order (cold assets desc); the rank orders the same groups on a different
    // axis — the SHARE of their open-finding assets that is cold — so rank 1 is routinely not
    // the first row, and a group with nothing open has NO rank at all rather than a last place
    // it never raced for.
    relativeRank: num(g.relative_rank),
    // Only ever true in relative mode, and never for a group with no cold asset.
    inColdestShare: g.in_coldest_share === true,
    openInCold: num(g.open_in_cold, 0),
    highRiskInCold: num(g.high_risk_in_cold, 0),
    // OVER OBSERVED ASSETS ONLY — the domain says so, and it matters: an asset that dropped
    // out of the scanner closes its findings by disappearance, and folding that date in would
    // date a support group's last movement to a scanner outage.
    lastMovementAt: typeof g.last_movement_at === "string" ? g.last_movement_at : null,
    lastMovementText: typeof g.last_movement_at === "string"
      ? fmtDate(g.last_movement_at)
      : absentText,
  }));
}

/**
 * Which of the five shades a heat cell takes: 0 for nothing at all, then four steps.
 *
 * REFUSED BEFORE ANY CAST, both arguments. `count / max` with either side a string, an array
 * or null produces a NaN that `Math.floor` passes straight through, and `data-level="NaN"`
 * matches no rule in the sheet — a cell that silently loses its shade while still printing its
 * number. Anything that was not a finite number to begin with, and any non-positive maximum,
 * is level 0: no shade, which is what an unshadeable cell should look like.
 *
 * A COUNT OF ZERO IS LEVEL 0 AND NOT LEVEL 1. The lightest shade means "something is here, and
 * it is the least of it"; an empty cell means nothing is there. The table prints the 0 either
 * way — the shade is the redundancy, never the reading.
 *
 * FOUR STEPS, NOT A CONTINUOUS RAMP, and `Math.min(3, …)` is what keeps the top of the scale
 * inside the sheet: `count === max` lands on `floor(4)` and would ask for a fifth step that
 * does not exist.
 */
export function heatLevel(count, max) {
  if (typeof count !== "number" || !Number.isFinite(count)) return 0;
  if (typeof max !== "number" || !Number.isFinite(max)) return 0;
  if (count <= 0 || max <= 0) return 0;
  return 1 + Math.min(3, Math.floor((count / max) * 4));
}

/**
 * The support-group × idle-bucket grid: the columns from the payload, one row per group, and a
 * totals row under them.
 *
 * THE TOTALS ROW CARRIES NO SHADE, deliberately. The ramp compares groups with each other, and
 * the totals are the sum of every one of them — shaded on the same scale, every cell in that
 * row would saturate at the darkest step and say nothing except "this row is bigger", which
 * the reader can already see from the numbers.
 *
 * Returns null where there is no grid to draw — no columns (nothing measurable) or no groups.
 * A caller draws nothing rather than an empty table.
 */
export function heatModel(view) {
  const columns = view && Array.isArray(view.bucketLabels) ? view.bucketLabels : null;
  const groups = view && Array.isArray(view.groups) ? view.groups : [];
  if (!columns || !columns.length || !groups.length) return null;
  const cellsOf = (row) => columns.map((_, i) => ({
    count: num(row && Array.isArray(row.buckets) ? row.buckets[i] : null, 0),
    open: num(row && Array.isArray(row.bucket_open) ? row.bucket_open[i] : null, 0),
  }));
  const rows = groups.map((g) => ({
    key: g.support_group === null || g.support_group === undefined
      ? NO_GROUP
      : String(g.support_group),
    label: g.label || NO_GROUP,
    cells: cellsOf(g),
  }));
  let max = 0;
  for (const row of rows) for (const cell of row.cells) if (cell.count > max) max = cell.count;
  for (const row of rows) for (const cell of row.cells) cell.level = heatLevel(cell.count, max);
  const totals = view.totals
    ? {
      key: "__all__",
      label: "All support groups",
      cells: cellsOf(view.totals).map((c) => ({ ...c, level: 0 })),
    }
    : null;
  return { columns: columns.slice(), rows, totals, max };
}

/**
 * The assets the page is actually about: the cold ones and the ones the scanner has lost sight
 * of, in that order.
 *
 * THE TWO STATES SHARE A TABLE AND NOT A FIGURE. They are different claims — one about a
 * support group, one about the pipeline — which is why the cards above count them separately;
 * but a reader chasing "which assets do I have to do something about" wants one list, and the
 * verdict column says which kind each row is. Warm, clear and not-yet-measurable assets are
 * not in it: they are not what this page is for, and the counts above already say how many.
 *
 * SORTED HERE, AND THE TABLE IS GIVEN NO SORT SPEC, so this order survives to the screen
 * (`sortRows` returns the list untouched when no `value` is given). Cold first, then
 * unobserved; within each, the biggest backlog first, name as the tie-break so two paints over
 * the same payload cannot reshuffle.
 */
export function coldAssetRows(view) {
  const assets = view && Array.isArray(view.assets) ? view.assets : [];
  const rows = assets
    .filter((a) => a && (a.cold === true || a.observed === false))
    .map((a) => {
      const label = a.asset_name || a.asset_id || absentText;
      const bounded = a.idle_is_bound === true;
      const reading = num(a.idle_reading_days);
      // THE ONE BOUND FORMATTER, not a second spelling of it. `boundedDays` is what puts "≥"
      // in front of a lower bound everywhere in this app, and it decides which it is from
      // WHICH ARGUMENT is non-null — so `idle_is_bound` chooses the slot and
      // `idle_reading_days` is the number either way, exactly as the domain publishes them.
      const idle = boundedDays(bounded ? null : reading, bounded ? reading : null);
      const movementAt = typeof a.last_movement_at === "string" ? a.last_movement_at : null;
      return {
        key: a.asset_id || label,
        label,
        group: a.support_group === null || a.support_group === undefined
          ? NO_GROUP
          : String(a.support_group),
        assetType: a.asset_type === null || a.asset_type === undefined
          ? absentText
          : String(a.asset_type),
        cloud: a.cloud === null || a.cloud === undefined ? absentText : String(a.cloud),
        verdict: a.verdict || null,
        verdictWord: COLD_VERDICT_LABEL[a.verdict] || absentText,
        cold: a.cold === true,
        observed: a.observed !== false,
        idleText: idle.text,
        idleBounded: idle.bounded,
        idleDays: reading,
        movementAt,
        movementText: movementAt === null ? absentText : fmtDate(movementAt),
        // WHY AN ASSET CAN HAVE NO MOVEMENT AT ALL, printed beside the absence rather than
        // left as a mystery: a reopen clears `resolved_at`, so an asset whose only close came
        // back reads as never having moved. `returned` is this register's word for that and
        // has its own glossary entry.
        reopenedOpen: num(a.reopened_open, 0),
        open: num(a.open_findings, 0),
        highRisk: num(a.open_high_risk, 0),
        oldestOpenAgeDays: num(a.oldest_open_age_days),
      };
    });
  rows.sort((a, b) => {
    if (a.cold !== b.cold) return a.cold ? -1 : 1;
    if (b.open !== a.open) return b.open - a.open;
    return String(a.label).localeCompare(String(b.label));
  });
  return rows;
}

/**
 * The scatter's points: one per OBSERVED asset that still has an open finding.
 *
 * BOTH FILTERS EARN THEIR PLACE. An unobserved asset has an idle time that measures a scanner
 * outage rather than a support group's silence, so plotting it would put a point in the cold
 * quadrant that no remediation could ever move. An asset with nothing open has no backlog to
 * plot against and would sit on the y axis at zero, adding a row of dots that says only "these
 * are fine" — which the cards already say in one number.
 *
 * `bounded` rides along because the x value is a MEASUREMENT for some assets and a LOWER BOUND
 * for others, and the canvas draws one dot either way: the tooltip and the table beside it are
 * where the difference is stated.
 */
export function coldScatterPoints(view) {
  const assets = view && Array.isArray(view.assets) ? view.assets : [];
  const points = [];
  for (const a of assets) {
    if (!a || a.observed === false) continue;
    const open = num(a.open_findings, 0);
    const idle = num(a.idle_reading_days);
    if (open <= 0 || idle === null) continue;
    points.push({
      label: a.asset_name || a.asset_id || absentText,
      idleDays: idle,
      open,
      cold: a.cold === true,
      bounded: a.idle_is_bound === true,
    });
  }
  return points;
}
