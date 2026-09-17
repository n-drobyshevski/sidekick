// Repositories — the estate: which repos carry the backlog, which offer a foothold, how fast
// a finding dies on them, and who owns them.
//
// NO gas/ COUNTERPART. This page is new (the OS-vuln register has no repository concept), so
// it is built straight from `domain/assets.ts::assetProfile` — a D6 port of
// brick/metrics.py's asset-centric family — through `readModels.reposModel`, which
// runs the same estimator twice: `groupBy: "repo"` (one row per repository) and
// `groupBy: "product"` (one row per product — the tenant's ownership grain, and the one where
// percentiles across several repos are not trivially one point). The two are the two sides of
// ONE table's switch. A `language` grain exists in `assets.ts` and is what brick's fixture
// pins, but no page draws it: a repository's language is not something anyone remediates
// against, and grouping the same measurements by it restated the repository table one level
// coarser.
//
// DENSITY IS NEVER A MEAN. `AssetProfileRow` publishes `density_p25/p50/p75` and no mean —
// v5 Fig. 10's distribution is "many with <10 but some >1000", and a mean would move when a
// batch of trivial repos is added without real exposure changing. `densityView` below reads
// exactly those three fields and nothing this page draws sums or averages a density.
//
// OWNERSHIP ATTRIBUTION IS ON THIS PAGE NOW, and the route it takes is worth stating because
// it is not the one this page spent its whole life waiting for. `assetProfile()` still does
// not read `owner_project` — its 17 published `AssetProfileRow` columns
// (test/assets.test.ts's `OUTPUT_COLUMNS_ASSET_PROFILE`) have no ownership field and none was
// added — so the density, foothold, half-life and capacity blocks below are unchanged and
// still carry no owner. What changed is that `buildRepos` (readModels.ts) now composes a
// SECOND family into the same payload: `model.coldZone`, a `ColdZoneResult`
// (src/domain/coldZone.ts) built from the ledger rows themselves, where ownership has always
// been. Its `teams` array is one row per PRODUCT — the tenant's finer ownership grain, with
// the CS/CE/LU support group above it carried as a column (src/domain/projectGrain.ts) — and
// a repository with no product at all is a REAL ROW in it under the label "(no product)"
// (`COLD_PRODUCT_NONE`) rather than a
// drop — which is what finally answers the unowned question that used to be stated here as a
// gap, as a count of repositories and of the open findings on them rather than as a
// percentage nobody computed. The old `ownershipView`'s honest refusal is gone because the
// absence it reported is gone, not because the bar for stating one moved.
//
// THE COLD ZONE IS THE SECTION THAT FAMILY DRAWS, and it is first on the page on purpose: the
// rest of this register answers "how fast is code risk closing" and that one answers "where
// has it stopped". See `coldZoneView` below for what the page does with the result, and
// `src/domain/coldZone.ts`'s header for why "cold" and "unobserved" are two states rather
// than one.
//
// THE LINE CAN BE DRAWN TWO WAYS, AND NOTHING HERE BRANCHES ON WHICH. The operator either
// names a WINDOW (fixed: cold after 90 idle days) or names a SHARE (relative: the idlest 20%
// of the repositories with open findings are cold, floored so a healthy estate is not
// slandered). Both produce ONE effective threshold in days, and `cold_after_days` is always
// that threshold — so every figure, bucket and cell below reads one number and no renderer
// asks which mode it came from. What the mode changes is the SENTENCE: `coldModeCaption`
// heads the section with where the line came from, the cold-repositories card's denominator
// repeats it one level down, the product table grows a relative rank beside the absolute
// verdict, and the scatter's rule says "(relative)" when the line was derived. See
// `coldModeCaption` for the copy and for what it refuses to round off.

import { bootstrap, swrCall } from "../../../../../gas_shared/store.js";
import { chartUnavailable, loadCharts } from "../../../../../gas_shared/ui/chartsLoader.js";
import { pagedTable } from "./sca.js";
import {
  absent, absentText, bandBar, bandBarModel, boundedDays, chartTable, chartTableModel, clear,
  days1, denomNote, el, emptyState, errorState, figureCard, filterChipRow, firstRunNotice,
  fmtCount, fmtDate, fmtDays, meter,
  num, onPageTeardown, pageHeader, pct1, pluralize, sectionLabel, segmented, skeletonStack,
  statusPill,
  uiIcon, MAX_EXACT_CELLS, unitChartModel, unitGrid, unitKeyRow,
  tipLabel,
} from "../ui.js";
// `verdictMark` is `pages/program.js`'s own dot-and-word for a capacity verdict, promoted to
// `gas_shared/ui/verdict.js`, so this page's Capacity column can draw the identical
// mark rather than the plain word `VERDICT_LABEL[r.verdict]` printed alone — see that
// module's header for the DOM and the tone mapping.
import { verdictMark } from "../ui.js";

const OVERALL = "OVERALL";

// ---------------------------------------------------------------------------- formatting
//
// `num`, `fmtCount`, `pct1`, `days1`, `denomNote` and `boundedDays` used to be DEFINED here
// — this file had the corrected refuse-before-cast shape (the bug `test/pagesData.test.js`
// caught was fixed in place, not left as a second copy of `sca.js`'s wrong one), which is why
// `ui/figures.js` (the one shared implementation every page in this package now imports)
// matches this file's shape. See that module's header for the defect it replaces.
//
// `boundedDays` was the last of them to move, and it moved because it existed TWICE — here
// and in `sca.js` — spelling the same lower bound two ways.

// Re-exported because `test/pagesData.test.js` — which this package may not edit — still
// imports `boundedDays` from here by name, the same reason `sca.js` re-exports `pct1`.
export { boundedDays };

// ------------------------------------------------------------------------- pure view models

/** The `OVERALL` row of an `AssetProfileResult`, or null if the result is empty/absent. */
export function overallRow(result) {
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  return rows.find((r) => r.asset_group === OVERALL) || null;
}

/** Every group row except `OVERALL` — the per-repo or per-product breakdown. */
export function groupRows(result) {
  const rows = result && Array.isArray(result.rows) ? result.rows : [];
  return rows.filter((r) => r.asset_group !== OVERALL);
}

/**
 * The register-wide density read: p25/p50/p75, over how many repositories, and how many
 * open findings that spans. NEVER a mean — see the module header.
 */
export function densityView(result) {
  const row = overallRow(result);
  return {
    measured: !!row,
    p25: row ? num(row.density_p25) : null,
    p50: row ? num(row.density_p50) : null,
    p75: row ? num(row.density_p75) : null,
    assets: row ? num(row.assets, 0) : 0,
    openFindings: row ? num(row.open_findings, 0) : 0,
  };
}

/**
 * The PAGE's own first-run decision — not `densityView().measured`.
 *
 * `assetProfile()` (src/domain/assets.ts) always pushes an OVERALL row, even a zeroed one, so
 * `overallRow(result)` finds one and `measured` reads true on a ledger nobody has ever synced.
 * That is the right answer for `densityView` itself (a row exists to read, however empty), and
 * the wrong one for deciding whether to show this reader a page of "—" over four more empty
 * section boxes — CLAUDE.md: "An unmeasured register is not a register of zeroes… Every page
 * checks 'has this ever been scanned' before it checks 'how many'."
 *
 * So this page checks `assets` instead: a register that has been profiled has profiled AT
 * LEAST ONE repository. `d.assets` is already `num(row.assets, 0)` — a plain finite number,
 * never null/NaN — but the refusal is spelled out explicitly rather than trusted implicitly,
 * the same "refuse before any cast" shape `usableDate` (gas_shared/ui/feedback.js) applies to
 * a date, applied here to a count.
 *
 * A PROJECT-SCOPE FILTER MATCHING ZERO REPOSITORIES ON A SYNCED LEDGER LANDS ON THIS SAME
 * NOTICE, and that is not a misreading: `firstRunNotice({synced:true, at})` words that case as
 * "the last sync saved no findings, so there is nothing here to measure yet" — which is
 * exactly true of a scoped population that happens to be empty, the same measured-empty-vs-
 * never-measured split `renderGroupTable` below already draws for its own per-group rows.
 */
export function reposFirstRun(d) {
  const assets = d && d.assets;
  return !(typeof assets === "number" && Number.isFinite(assets) && assets > 0);
}

/** v5 Fig. 11: the share of repositories carrying at least one open high-risk finding. */
export function footholdView(result) {
  const row = overallRow(result);
  return {
    measured: !!row,
    pct: row ? num(row.assets_with_high_risk_pct) : null,
    assets: row ? num(row.assets, 0) : 0,
  };
}

/** v5 Fig. 15: the Kaplan–Meier half-life of a finding, at OVERALL or one group's grain. */
export function halfLifeView(row) {
  if (!row) return { measured: false, ...boundedDays(null, null) };
  return { measured: true, ...boundedDays(row.km_median_days, row.km_median_lower_bound) };
}

/**
 * v5 Fig. 21: falling-behind / keeping-up / gaining, over the repositories with a defined
 * net flow — null across the board without an observation window (`window_months === null`,
 * i.e. `observedFrom` was never recorded), never a fabricated 0/0/0 split.
 */
export function capacityView(result) {
  const row = overallRow(result);
  return {
    measured: !!row && row.window_months !== null,
    windowMonths: row ? num(row.window_months) : null,
    fallingBehindPct: row ? num(row.falling_behind_pct) : null,
    maintainingPct: row ? num(row.maintaining_pct) : null,
    gainingPct: row ? num(row.gaining_pct) : null,
    flowing: row ? num(row.assets_flowing, 0) : 0,
    assets: row ? num(row.assets, 0) : 0,
  };
}

/**
 * The cold zone, read off `model.coldZone` — a `ColdZoneResult` (src/domain/coldZone.ts).
 *
 * REFUSE BEFORE ANY CAST, and refuse on the SHAPE rather than on the flag. `measurable` is a
 * field in the payload, but every block this page draws reads `totals`, `repos` and `teams`,
 * and the domain sets all three to null in exactly the case the flag describes. A payload
 * that said `measurable: true` and carried a null `totals` — an older server, a half-applied
 * cache entry — would pass a flag check and then throw inside a render function, which on
 * this page means the whole section is replaced by an error box for what is really an
 * absence. So the view decides `measurable` for itself from what actually arrived, and every
 * array it publishes is a real array whether or not anything was measured.
 *
 * `present` IS NOT `measurable`, and the difference is worth keeping: `present: false` means
 * no cold-zone block reached this page at all (an old payload), `measurable: false` means the
 * block arrived and honestly says it has no clock yet. Both draw the same notice today; only
 * one of them is a deployment mismatch, and collapsing them would make that invisible.
 */
export function coldZoneView(model) {
  const cz = model && typeof model === "object" && !Array.isArray(model) ? model.coldZone : null;
  const present = !!cz && typeof cz === "object" && !Array.isArray(cz);
  const totals = present && cz.totals && typeof cz.totals === "object" && !Array.isArray(cz.totals)
    ? cz.totals
    : null;
  const repos = present && Array.isArray(cz.repos) ? cz.repos : null;
  const teams = present && Array.isArray(cz.teams) ? cz.teams : null;
  const measurable = present && cz.measurable === true && totals !== null && repos !== null
    && teams !== null;
  const reposWithOpen = totals ? num(totals.repos_with_open, 0) : 0;
  const unobserved = totals ? num(totals.repos_unobserved, 0) : 0;
  // ABSENT IS "fixed", AND ONLY THE EXACT WORD IS RELATIVE. `mode` arrived with the second
  // definition of the line, so a payload that predates it carries no `mode` at all and is
  // asking for exactly what it always got. Anything that is not the literal `"relative"` —
  // a stray casing, a number, a half-applied cache entry — is read as the older contract
  // rather than cast, for the same reason the shape decides `measurable` above.
  const mode = present && cz.mode === "relative" ? "relative" : "fixed";
  // THE SHARE THE LINE ACTUALLY DREW. A payload that carries the field and a NULL in it is
  // making a real statement ("no repository has an open finding, so there is no share"), so
  // the fallback fires only when the KEY IS MISSING — an older server — and lands on the
  // totals' own copy of the same number. Collapsing the two would turn an honest refusal
  // into a figure copied from somewhere else.
  const achievedRaw = present && Object.prototype.hasOwnProperty.call(cz, "achieved_share_pct")
    ? num(cz.achieved_share_pct)
    : undefined;
  const eligibleRaw = present ? num(cz.eligible_repos) : null;
  return {
    present,
    measurable,
    // WHICH DEFINITION DREW THE LINE — never a second copy of the line itself. `coldAfterDays`
    // below is the EFFECTIVE threshold in both modes (src/domain/coldZone.ts's header), so
    // nothing this page renders branches on the mode to read a number; the mode is read to
    // say WHERE the number came from, which is a different sentence.
    mode,
    // The operator's fixed window, which survives the switch: in relative mode it is what was
    // asked for before the estate was consulted, and it is NOT what the page classifies by.
    fixedAfterDays: present ? num(cz.fixed_after_days) : null,
    targetSharePct: present ? num(cz.target_share_pct) : null,
    achievedSharePct: achievedRaw === undefined
      ? (totals ? num(totals.cold_repo_share_pct) : null)
      : achievedRaw,
    floorDays: present ? num(cz.floor_days) : null,
    floorApplied: present && cz.floor_applied === true,
    derivedDays: present ? num(cz.derived_days) : null,
    // `eligible_repos === totals.repos_with_open` by construction, so an older payload that
    // carries only the totals can still answer "a share of what".
    eligibleRepos: eligibleRaw === null
      ? (totals ? num(totals.repos_with_open, 0) : null)
      : eligibleRaw,
    // The cold repositories whose idle time was never measured — the cost of ranking a
    // repository at the bound it can prove. Null, not 0, when nothing was measurable.
    coldBoundOnly: present ? num(cz.cold_bound_only) : null,
    // THE POPULATION AN OPERATOR MAY HAVE REMOVED, and the size of what went. Read even on
    // the two notice branches: the fold that produces these happens before the clock is
    // consulted (src/domain/coldZone.ts), so they are real on a register that cannot measure
    // anything else, and "we are not counting eleven repositories here" is worth saying even
    // then. A payload that predates the field carries none, which reads as "no exclusion".
    excludeEndOfLife: present && cz.exclude_end_of_life === true,
    endOfLifeRepos: present ? num(cz.end_of_life_repos, 0) : 0,
    excludedEndOfLife: present ? num(cz.excluded_end_of_life, 0) : 0,
    excludedOpenFindings: present ? num(cz.excluded_open_findings, 0) : 0,
    teamsInColdestShare: totals ? num(totals.teams_in_coldest_share, 0) : 0,
    // The threshold and the clock ride along even when nothing is measurable: a reader asking
    // "cold after how long?" is asking about the setting, not about the data.
    coldAfterDays: present ? num(cz.cold_after_days) : null,
    asOf: present && typeof cz.as_of === "string" ? cz.as_of : null,
    observedFrom: present && typeof cz.observed_from === "string" ? cz.observed_from : null,
    // FROM THE PAYLOAD, NEVER HARDCODED. The bucket edges move with the threshold (a 120-day
    // window makes them 0-40/40-80/80-120/≥ 120), so a header spelled here would be a second,
    // silently wrong statement of the operator's setting. Null when nothing is measurable,
    // which is exactly when the heatmap is not drawn.
    bucketLabels: measurable && Array.isArray(cz.bucket_labels)
      ? cz.bucket_labels.map((l) => String(l))
      : null,
    repos: measurable ? repos : [],
    teams: measurable ? teams : [],
    totals: measurable ? totals : null,
    // IS THERE A POPULATION TO SPEAK ABOUT AT ALL. Not the same question as "is it
    // measurable": a register with a clock and ten repositories, every one of them clear and
    // every one of them still returned by the newest scan, has nothing for this section to say.
    populated: measurable && (reposWithOpen > 0 || unobserved > 0),
  };
}

/**
 * "N of them have no movement on record at all" — the cost of a line drawn over lower bounds.
 *
 * A repository that has never closed anything has no measured silence, only a bound counted
 * from when this register started watching (`coldZone.ts`: `idle_is_bound`). Both modes
 * classify and print it by that bound, which is a systematic UNDER-estimate of how long it
 * has really been quiet — so the count of cold repositories resting on one is said out loud
 * rather than left inside a figure that looks measured.
 */
function boundOnlySentence(n) {
  return n === 1
    ? "1 of them has no movement on record at all, so its idle time is a lower bound."
    : `${fmtCount(n)} of them have no movement on record at all, so their idle time is a`
      + " lower bound.";
}

/**
 * WHERE THE LINE CAME FROM, in one sentence, above everything the line decided.
 *
 * The section publishes one threshold in days and every figure under it reads that one
 * number — which is exactly why the number alone is not enough to read the section. Ninety
 * days can be an operator's standing window or the idle time of the tenth-idlest repository
 * on this estate last Tuesday, and those two facts age completely differently: the first is a
 * policy a team can be held to, the second moves when the population moves and says nothing
 * about any absolute amount of silence. So the caption names the MODE first, then what the
 * mode produced, and in relative mode it also names what it AIMED at — because a share that
 * was asked for and a share that was achieved are two numbers and the register publishes both
 * (`target_share_pct` / `achieved_share_pct`).
 *
 * WHAT IT REFUSES TO ROUND OFF:
 *   * The floor gets its own clause in both directions. "The 14-day floor did not apply" is a
 *     fact the reader needs in order to trust the derived line; "the floor holds the line
 *     instead" is the reason the zone came out SMALLER than the share asked for, and without
 *     it the achieved share reads as a failure of the estate rather than a deliberate refusal
 *     to slander four repositories that were all touched last week.
 *   * "Nothing to rank" is not "0% are cold". With no eligible repository the relative line
 *     rests on the floor and the caption says so, rather than reporting a share over an empty
 *     population.
 *   * Not measurable is its own sentence in both modes: there is no clock, so there is no
 *     line to have landed anywhere, and the caption says what WOULD produce one.
 *
 * NOTATION (README.md, above the Pages table): prose says "at least N", a cell says "≥ N",
 * and neither ever says ">". This is prose, so every duration here goes through `fmtDays`
 * behind "at least", and `test/pagesData.test.js` sweeps every combination for both glyphs.
 *
 * @param {object|null|undefined} view  a `coldZoneView` result
 * @returns {string} always a sentence — every state this section can be in has one
 */
export function coldModeCaption(view) {
  const v = view || {};
  const relative = v.mode === "relative";
  const days = num(v.coldAfterDays);
  const floor = num(v.floorDays);
  // "the 14-day floor", or just "the floor" where the payload never said how deep it is. The
  // phrase is built once because it is said in four different sentences below.
  const floorPhrase = floor === null ? "floor" : `${fmtCount(floor)}-day floor`;
  // The TARGET is an operator's whole-number choice (Settings clamps it to 1..50), so it
  // prints as a count with a per-cent sign; the ACHIEVED share is a measurement and prints
  // through `pct1`. Two different kinds of number, two different formatters.
  const targetText = `${fmtCount(num(v.targetSharePct))}%`;
  const eligible = num(v.eligibleRepos, 0);
  const cold = v.totals ? num(v.totals.cold_repos, 0) : 0;
  const achieved = num(v.achievedSharePct);
  const boundOnly = num(v.coldBoundOnly, 0);
  const suffix = boundOnly > 0 ? ` ${boundOnlySentence(boundOnly)}` : "";
  const windowText = days === null ? "the cold-zone window" : `at least ${fmtDays(days)}`;
  const fixedLead = `Fixed window: a repository is cold after ${windowText} with nothing`
    + " resolved, removed or rotated.";
  const coldCount = `${fmtCount(cold)} ${cold === 1 ? "repository" : "repositories"}`
    + (achieved === null ? "" : ` (${pct1(achieved)})`);
  const coldVerb = cold === 1 ? "is" : "are";

  if (v.measurable !== true) {
    return relative
      ? "Relative mode: the line is derived from the estate once a scan has been saved, and it"
        + ` never falls below the ${floorPhrase}.`
      : `${fixedLead} The window is set in Settings, on the Deadlines tab.`;
  }
  if (eligible <= 0) {
    return relative
      ? "Relative mode: no repository has an open finding, so there is nothing to rank. The"
        + ` line rests on the ${floorPhrase} until one does.`
      : `${fixedLead} No repository has an open finding, so there is no share to report.`;
  }
  if (!relative) {
    return `${fixedLead} ${fmtCount(cold)} of ${fmtCount(eligible)} repositories with open`
      + ` findings${achieved === null ? "" : ` (${pct1(achieved)})`} ${coldVerb} cold.${suffix}`;
  }
  const lead = `Relative mode: the line is set so the idlest ${targetText} of the`
    + ` ${fmtCount(eligible)} repositories with open findings are cold.`;
  if (v.floorApplied === true) {
    return `${lead} The idlest ${targetText} would have been ${fmtDays(num(v.derivedDays))}, so`
      + ` the ${floorPhrase} holds the line instead, and ${coldCount} ${coldVerb} cold — a`
      + ` smaller zone than the ${targetText} asked for.${suffix}`;
  }
  return `${lead} It landed at ${fmtDays(days)} idle, and ${coldCount} ${coldVerb} cold. The`
    + ` ${floorPhrase} did not apply.${suffix}`;
}

/**
 * The repositories the figures above cannot speak for, as one sentence — or null.
 *
 * `watching` is the domain's sixth verdict: a repository with open findings, no movement ever
 * recorded, and a lower bound still short of the threshold. It is neither cold nor warm, and
 * the reason it exists as its own state is that a REOPEN clears the movement columns
 * (reconcile.ts), so a repository whose only close came back has no movement on record
 * through no fault of anyone's. Printing it as warm would claim remediation nobody did;
 * printing it as cold would claim a silence nobody has measured yet. So it is counted apart
 * and the count is said out loud under the cards rather than being left to the heatmap's
 * fifth column to imply.
 */
export function unmeasurableNote(view) {
  const watching = view && view.totals ? num(view.totals.watching_repos, 0) : 0;
  if (!watching) return null;
  const one = watching === 1;
  return `${fmtCount(watching)} ${one ? "repository has" : "repositories have"} no movement on`
    + ` record and less idle time than the window, so ${one ? "it is" : "they are"} not yet`
    + " measurable — counted in neither the cold figure nor the warm one.";
}

/**
 * The count line under the product table. The "(no product)" bucket is named ONLY when it is
 * in the table: a sentence that says "including the repositories with no product recorded"
 * over a table with no such row claims a bucket the reader cannot find.
 *
 * @param {{totals?: {repos_no_product?: number}|null}|null|undefined} view
 * @param {number} rowCount  the rows the table actually holds
 * @returns {string}
 */
export function productCountNote(view, rowCount) {
  const rows = num(rowCount, 0);
  const noProduct = view && view.totals ? num(view.totals.repos_no_product, 0) : 0;
  const head = `${fmtCount(rows)} ${rows === 1 ? "product" : "products"}`;
  if (!noProduct) return `${head}.`;
  return `${head}, including the ${fmtCount(noProduct)} ${noProduct === 1 ? "repository" : "repositories"}`
    + " with no product recorded, counted together as one.";
}

/**
 * What the end-of-life setting is doing to this section, in one sentence — or null.
 *
 * TWO SENTENCES FOR TWO SETTINGS, AND BOTH ARE ABOUT THE SAME POPULATION. On, it says what
 * left and how much backlog went with it, because a share whose denominator quietly shrank is
 * a share nobody can check — the same duty `productCountNote` discharges for the null-product
 * bucket and `boundOnlySentence` for the repositories ranked at a bound. Off, it says the
 * retired repositories are in here, and where the switch is: this section's whole argument is
 * that a long silence means somebody stopped, and for these repositories it does not.
 *
 * BOTH SENTENCES NAME THE COLD ZONE, because there are now two of these switches and they are
 * independent — `mttr.js`'s `endOfLifeExclusionNote` says the same two things about the
 * remediation-speed figures. A note claiming its exclusion was the only one, or that the rows
 * it removed are "counted in every other figure this register publishes", would be false the
 * moment a reader turned the other one on. What stays true in every combination is that
 * neither switch touches a count of what is open, so that is what the second clause says.
 *
 * NULL WHEN THERE ARE NONE, in either setting — `unmeasurableNote`'s rule. A sentence about
 * zero repositories is noise, and it is also the honest reading on a tenant whose lifecycle
 * tag this register never learned: nothing is known, so nothing is claimed. Settings > System
 * is where that case is diagnosable, and it says so rather than this line guessing at it.
 *
 * @param {{excludeEndOfLife?: boolean, endOfLifeRepos?: number,
 *          excludedEndOfLife?: number, excludedOpenFindings?: number}|null|undefined} view
 * @returns {string|null}
 */
export function endOfLifeNote(view) {
  if (!view) return null;
  const total = num(view.endOfLifeRepos, 0);
  if (!total) return null;
  const repos = (n) => `${fmtCount(n)} ${n === 1 ? "repository" : "repositories"}`;
  if (view.excludeEndOfLife !== true) {
    return `${repos(total)} here ${total === 1 ? "is" : "are"} end of life and still counted in`
      + " the cold zone. Settings, under Deadlines, can leave them out.";
  }
  const cut = num(view.excludedEndOfLife, 0);
  const open = num(view.excludedOpenFindings, 0);
  const findings = `${fmtCount(open)} open ${open === 1 ? "finding" : "findings"}`;
  return `${repos(cut)} left out of the cold zone as end of life, with ${findings}.`
    + " Still counted in every count of what is open.";
}

/**
 * The badge's own count line, under the product table — or null when nobody is badged.
 *
 * TWO SENTENCES, AND THE SECOND ONE IS THE REFUSAL. "The coldest 20%" of an estate where one
 * product has anything cold at all is that ONE product: `rankTeams` clamps the badge to the
 * products that actually have a cold repository (`coldZone.ts`'s `C` clamp), so a reader who
 * counts the marks and finds fewer than the arithmetic implies is seeing the clamp, not a
 * rendering bug. A line that only reported the count would leave that looking like one.
 *
 * Null in fixed mode by construction rather than by a branch here: `in_coldest_share` is only
 * ever true in relative mode, so the total it is counted from is 0 and there is nothing to
 * say. Same shape as `unmeasurableNote` above — a sentence about zero products is noise.
 *
 * @param {{teamsInColdestShare?: number, targetSharePct?: number|null}|null|undefined} view
 * @returns {string|null}
 */
export function coldestShareNote(view) {
  const n = view ? num(view.teamsInColdestShare, 0) : 0;
  if (!n) return null;
  const one = n === 1;
  return `${fmtCount(n)} ${one ? "product is" : "products are"} in the coldest`
    + ` ${fmtCount(num(view.targetSharePct))}% by the share of ${one ? "its" : "their"}`
    + " open-finding repositories that are cold. A product with no cold repository is never"
    + " marked.";
}

/**
 * The cold zone as one population rather than four figures.
 *
 * WHY A PICTURE AND NOT A FIFTH CARD. The four figures above each answer a different question
 * against a different denominator — cold repositories against those with open findings, open
 * findings sitting cold against the whole backlog — and none of them says what the estate looks
 * like. "How much of this register is the scanner actually watching" is a part-to-whole, and a
 * reader was reconstructing it from four numbers with four different bottoms.
 *
 * THE FIVE VERDICTS PARTITION THE REGISTER, which is what makes this a waffle and not five
 * bars: `cold + warm + watching + clear` is every OBSERVED repository (coldZone.ts's verdict
 * switch) and `observed + unobserved` is every repository. `unitChartModel` throws if that ever
 * stops being true, which is the guard worth having here — the day a sixth verdict appears, a
 * silently-renormalised grid would be the last place anyone looked.
 *
 * THREE OF THE SIX ARE HATCHED, AND THAT IS THE WHOLE POINT. `watching` is a repository with
 * open findings whose idle time could not be measured at all (`idleDays === null` with no
 * usable bound); the two unobserved segments are ones the scanner has lost sight of. None is a
 * measurement of idleness, and the section spends most of its words insisting they are not
 * counted as warm. `--hatch` is the design system's own token for exactly that claim — "this
 * part is not a measurement" — so the picture makes it where the reader is already looking,
 * instead of only in a sentence underneath.
 *
 * UNOBSERVED IS DRAWN AS TWO, BECAUSE IT WAS NEVER ONE PIECE OF NEWS. `unobserved` is tested
 * before `clear`, so a repository that was remediated and then archived stays unobserved for as
 * long as the ledger remembers it, and a register with ordinary churn accumulates those without
 * bound until they dominate the picture. Split on the one question that tells the two apart —
 * is anything still open on it? — the alarming half is the half that deserved the alarm:
 * backlog stranded on repositories nobody is scanning any more. The verdict does not split
 * (`repos_unobserved` is still their sum), so the tables and the roll-up are untouched. The
 * open half is `bad` HATCHED where `cold` is `bad` SOLID: the same alarm with the measurement
 * missing, told apart by silhouette rather than by colour alone.
 *
 * `warm` IS `ok`, NOT `warn`, AND THAT IS A READING RATHER THAN A PALETTE PREFERENCE. A warm
 * repository carries open findings AND had one resolve inside the window, so on this section's
 * own question — has work stopped? — it is the system working. It is also the LARGEST segment
 * here. Spent on it, `--warn` did two kinds of damage. The census read as roughly half problem,
 * where the alarm is `cold` plus `unobserved_open` and nothing else; and `watching`, the one
 * segment that IS a caveat, wore the same amber as the healthy majority, so the tone said
 * nothing in particular. `--warn` is a text-grade value besides — tokens.base.css records it
 * darkened to #8a5406 so it would clear 4.5:1 AS TEXT on its own tint — and a large flat field
 * of it reads as mud rather than as a warning. Amber now marks exactly one thing on this
 * lattice, and that thing is a measurement nobody could take. The sibling register's
 * `coldCensusModel` carries the same tone and the same argument.
 *
 * SO `warm` AND `clear` SHARE A TONE AND ARE TOLD APART BY SILHOUETTE, which is the pair of
 * channels this component exists to give. Both are fine; one still has work. It is the bargain
 * the two `bad` segments strike above — same red, different shape — read from the other end.
 *
 * `clear` IS A RING, NOT A FILL. It is measured and it is fine: nothing open to go quiet on.
 * The ring is what keeps it out of the weight class of the solid fills, and now that `warm`
 * carries the same tone it is also the only channel telling the two of them apart.
 *
 * EXACT WHERE IT CAN BE. Under MAX_EXACT_CELLS repositories the lattice is one cell per
 * repository and there is no rounding to explain; above it the lattice is 100 cells and the
 * model says so in its own label. Which of the two a reader is looking at is a fact about the
 * register's size, so it is derived here rather than fixed.
 */
export function coldCensusModel(view) {
  const t = view && view.totals;
  if (!t) return null;
  const repos = num(t.repos);
  if (repos === null || repos <= 0) return null;
  return unitChartModel({
    unit: "repositories",
    total: repos,
    cells: repos <= MAX_EXACT_CELLS ? "exact" : 100,
    segments: [
      { key: "cold", label: "Cold", count: num(t.cold_repos, 0), tone: "bad", fill: "solid" },
      { key: "warm", label: "Warm", count: num(t.warm_repos, 0), tone: "ok", fill: "solid" },
      {
        key: "watching", label: "Idle time not measured", count: num(t.watching_repos, 0),
        tone: "warn", fill: "hatch",
      },
      { key: "clear", label: "Clear", count: num(t.clear_repos, 0), tone: "ok", fill: "ring" },
      {
        key: "unobserved_open", label: "Out of sight, backlog open",
        count: num(t.repos_unobserved_open, 0), tone: "bad", fill: "hatch",
      },
      {
        key: "unobserved_clear", label: "Gone, nothing open",
        count: num(t.repos_unobserved_clear, 0), tone: "neutral", fill: "hatch",
      },
    ],
  });
}


/**
 * The four figures, as specs — label, value, the sentence under it and the denominator behind
 * it. DOM-free so the claims can be read without a DOM, the way every other view model on
 * this page is.
 *
 * FOUR CARDS AND FOUR DENOMINATORS (pagesLit gate 3/7). Each of these is a count over a
 * population that is NOT "every repository", and the populations differ from card to card —
 * repositories with open findings, open findings, high-risk open findings, and the whole
 * estate — so a shared sentence would be wrong three times out of four.
 */
export function coldKpiCards(view) {
  const t = view && view.totals;
  if (!t) return [];
  const days = view.coldAfterDays;
  const windowText = days === null ? "the cold-zone window" : `at least ${fmtDays(days)}`;
  const withOpen = num(t.repos_with_open, 0);
  const openFindings = num(t.open_findings, 0);
  const openInCold = num(t.open_in_cold, 0);
  const backlogShare = num(t.cold_backlog_share_pct);
  const repoShare = num(t.cold_repo_share_pct);
  const openInUnobserved = num(t.open_in_unobserved, 0);
  // THE SHARE THE LINE DREW, said on the face of the card. `achievedSharePct` is the same
  // number as `cold_repo_share_pct` in fixed mode and falls back to it on an older payload —
  // it is read here because in RELATIVE mode it is the number the target is judged against,
  // and a card that printed the count alone would leave "did the line do what was asked?"
  // unanswerable without opening the denominator.
  const achieved = num(view.achievedSharePct === undefined ? repoShare : view.achievedSharePct);
  const relative = view.mode === "relative";
  const targetText = `${fmtCount(num(view.targetSharePct))}%`;
  const floor = num(view.floorDays);
  const floorPhrase = floor === null ? "floor" : `${fmtCount(floor)}-day floor`;
  // WHERE THE LINE CAME FROM, in the one denominator whose population the line decides. The
  // caption above the section says this at length for the whole section; the card says it
  // again because a denominator is read on its own, one level down from a figure, and
  // "46 repositories with open findings" is a population a relative line CHOSE the size of.
  const modeClause = !relative
    ? ""
    : view.floorApplied === true
      ? ` Relative mode: the idlest ${targetText} of them would have been`
        + ` ${fmtDays(num(view.derivedDays))}, so the ${floorPhrase} holds the line instead and`
        + ` the zone is smaller than the ${targetText} asked for.`
      : ` Relative mode: the idlest ${targetText} of them are the cold zone, and the line`
        + ` landed at ${fmtDays(view.coldAfterDays)} idle.`;
  const boundOnly = num(view.coldBoundOnly, 0);
  const boundClause = boundOnly > 0 ? ` ${boundOnlySentence(boundOnly)}` : "";
  return [
    {
      key: "coldRepos",
      label: "Cold repositories",
      value: fmtCount(num(t.cold_repos, 0)),
      sub: achieved === null
        ? `Of ${fmtCount(withOpen)} with open findings`
        : `${pct1(achieved)} of ${fmtCount(withOpen)} with open findings`,
      help: { term: "cold-zone" },
      denominator:
        `Of ${fmtCount(withOpen)} repositories with open findings`
        + (achieved === null ? "" : ` (${pct1(achieved)})`)
        + `.${modeClause} Cold means no finding resolved, removed or rotated for ${windowText},`
        + ` measured at the last scan.${boundClause}`,
    },
    {
      key: "openInCold",
      label: "Open findings sitting cold",
      value: fmtCount(openInCold),
      sub: backlogShare === null
        ? `Of ${fmtCount(openFindings)} open findings`
        : `${pct1(backlogShare)} of ${fmtCount(openFindings)} open findings`,
      help: { term: "idle" },
      denominator:
        `Of ${fmtCount(openFindings)} open findings across every repository`
        + (backlogShare === null ? "" : `, ${pct1(backlogShare)} of them`)
        + ". The backlog on repositories where nothing has moved for " + windowText + ".",
    },
    {
      key: "highRiskInCold",
      label: "High-risk findings sitting cold",
      value: fmtCount(num(t.high_risk_in_cold, 0)),
      sub: `Of ${fmtCount(openInCold)} open in cold repositories`,
      denominator:
        `Of ${fmtCount(openInCold)} open findings on cold repositories. Secrets carry no risk`
        + " class at all — there is no exploit intelligence for a leaked string — so they are"
        + " open findings here and never high-risk ones.",
    },
    {
      key: "unobserved",
      label: "Unobserved repositories",
      value: fmtCount(num(t.repos_unobserved, 0)),
      sub: `${fmtCount(openInUnobserved)} open ${pluralize(openInUnobserved, "finding")} on them`,
      help: { term: "unobserved" },
      denominator:
        `Of ${fmtCount(num(t.repos, 0))} repositories in the ledger. The scanner returned`
        + " nothing for these in the last scan of any register they have rows in, so their"
        + " findings close by disappearance — counted apart from cold, and never as warm.",
    },
  ];
}

/** The word a repository's verdict is printed as. The word is the signal; the dot repeats it. */
const COLD_VERDICT_LABEL = {
  cold: "Cold",
  warm: "Warm",
  clear: "Clear",
  watching: "Not yet measurable",
  unobserved: "Unobserved",
};

/** The same, for a product's rollup of its repositories. */
const TEAM_VERDICT_LABEL = {
  "fully-cold": "Fully cold",
  "partly-cold": "Partly cold",
  warm: "Warm",
  clear: "Clear",
};

/**
 * The label a repository the tenant filed under no product is shown with.
 *
 * `src/domain/coldZone.ts` exports this exact string as `COLD_PRODUCT_NONE` and puts it on
 * every team row's `label`, so the product table never spells it itself. It is repeated here
 * for the one place the payload cannot supply it — a REPOSITORY row, whose `product` is the
 * row's own `_product` and is null for exactly these repositories. Not imported: no page in
 * this client imports from `src/domain/` (history.js's header states the rule and why), and a
 * one-word literal is a smaller cost than pulling a server module into the browser bundle.
 */
const NO_PRODUCT = "(no product)";

/**
 * The mark a product whose repositories name no single support group is shown with.
 *
 * TWO SITUATIONS, ONE MARK, and that is deliberate here where it would not be in a figure:
 * either no repository named a group, or they named several. Both mean the same thing to a
 * reader looking for who to escalate to — this column cannot tell them — and the em dash is
 * this register's one mark for "not answered". The distinction is kept in the payload
 * (`support_groups`) for anyone who needs it.
 */
const NO_SUPPORT_GROUP = absentText;

/**
 * One row per product, formatted.
 *
 * ORDER IS THE PAYLOAD'S, and the table is handed no sort spec so it stays that way.
 * `coldZoneProfile` already sorts teams by cold repositories desc, then open-in-cold desc,
 * then label — a rule that belongs beside the one that computed the counts, not re-derived
 * against a formatted string here. The "(no product)" bucket sorts by the same rule as every
 * other row: it is a team like any other and is never pinned last or hidden.
 */
export function coldTeamRows(view) {
  const teams = view && Array.isArray(view.teams) ? view.teams : [];
  return teams.map((t) => ({
    key: t.product === null || t.product === undefined ? NO_PRODUCT : String(t.product),
    label: t.label || NO_PRODUCT,
    // WHO THIS PRODUCT ESCALATES TO. Null where its repositories named no group or named
    // several — see NO_SUPPORT_GROUP for why one mark serves both.
    supportGroup: t.support_group === null || t.support_group === undefined
      ? null
      : String(t.support_group),
    supportGroupText: t.support_group === null || t.support_group === undefined
      ? NO_SUPPORT_GROUP
      : String(t.support_group),
    verdict: t.verdict || null,
    verdictWord: TEAM_VERDICT_LABEL[t.verdict] || absentText,
    repos: num(t.repos, 0),
    coldRepos: num(t.cold_repos, 0),
    // NULL IS A REAL ANSWER and it draws NO meter. A product whose repositories all read
    // clear has no repository with open findings to divide by, and the domain returns null
    // rather than 0 for exactly that reason; a 0% track here would be a picture asserting
    // that none of its repositories has gone cold, which is a different claim from "there was
    // nothing to ask the question of". Same refusal shape as `coverageMeterPct` above.
    sharePct: num(t.cold_share_pct),
    // THE RANK IS NOT THE ROW NUMBER, and both modes carry it. The table is published in the
    // payload's own order (cold repositories desc); the rank orders the same products on a
    // different axis — the SHARE of their open-finding repositories that is cold — so rank 1
    // is routinely not the first row, and a product with nothing open has NO rank at all
    // rather than a last place it never raced for.
    relativeRank: num(t.relative_rank),
    // Only ever true in relative mode, and never for a product with no cold repository.
    inColdestShare: t.in_coldest_share === true,
    openInCold: num(t.open_in_cold, 0),
    highRiskInCold: num(t.high_risk_in_cold, 0),
    // OVER OBSERVED REPOSITORIES ONLY — the domain says so, and it matters: a repository that
    // dropped out of the scanner closes its findings by disappearance, and folding that date
    // in would date a team's last movement to a scanner outage.
    lastMovementAt: typeof t.last_movement_at === "string" ? t.last_movement_at : null,
    lastMovementText: typeof t.last_movement_at === "string"
      ? fmtDate(t.last_movement_at)
      : absentText,
    // THE PRODUCT'S OWN IDLE DISTRIBUTION. `buckets` and `bucket_open` have been on every team
    // row since the domain first published them; nothing here is a new measurement, only the
    // same five figures arriving where the product already is instead of in a grid below.
    bands: bandSpecs(view, t),
    bandTotal: bandTotal(t),
  }));
}

/**
 * The band vocabulary, derived once from the payload's own column labels.
 *
 * THE LABELS COME FROM THE PAYLOAD AND THE RANKS DO NOT. `bucket_labels` moves with the
 * operator's threshold, so a label spelled here would be a second, silently wrong statement of
 * the setting. The RANK is a property of the position: band 0 is always the most recently
 * moved and band 3 is always the cold one, whatever days they stand for.
 *
 * THE LAST BAND HAS NO RANK. "No movement on record yet" is not a point on the idle scale at
 * all, so it takes no step of the ordinal ramp and is drawn as `--hatch`. That also keeps the
 * ramp at the four steps its separations were measured as. Ported from the sibling register's
 * `coldZoneModel.js`, which carries the same argument for assets.
 */
export function coldBandDefs(view) {
  const labels = view && Array.isArray(view.bucketLabels) ? view.bucketLabels : [];
  return labels.map((label, i) => ({
    key: "band:" + i,
    index: i,
    label: String(label),
    rank: i < 4 && i < labels.length - 1 ? i + 1 : null,
  }));
}

/** One row's bands, in the shape `bandBarModel` takes. */
function bandSpecs(view, t) {
  const buckets = t && Array.isArray(t.buckets) ? t.buckets : [];
  const opens = t && Array.isArray(t.bucket_open) ? t.bucket_open : [];
  return coldBandDefs(view).map((d) => {
    const open = num(opens[d.index], 0);
    return {
      key: d.key,
      label: d.label,
      count: num(buckets[d.index]),
      rank: d.rank,
      extra: open > 0 ? fmtCount(open) + " open" : "",
    };
  });
}

function bandTotal(t) {
  const buckets = t && Array.isArray(t.buckets) ? t.buckets : [];
  let total = 0;
  for (const b of buckets) {
    const n = num(b);
    if (n !== null && n > 0) total += n;
  }
  return total;
}

/**
 * The largest row total in the table, which is the scale every bar is drawn against.
 *
 * ONE UNIT PER TABLE, NEVER PER ROW — `gas_shared/ui/bandBar.js` states the defect and its
 * contract perturbs it: a bar normalised to its own row draws a product of 280 repositories
 * and one of 30 at the same length, and the column stops being readable.
 */
export function coldBandScale(rows) {
  let max = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    const n = num(r && r.bandTotal, 0);
    if (n > max) max = n;
  }
  return max;
}

/**
 * The band key row above the table: every band, its estate-wide count, and the open findings
 * sitting in it.
 *
 * THIS IS WHERE THE PER-REPOSITORY GRID WENT. `renderColdHeat` drew one row per REPOSITORY
 * with exactly one lit cell in it — an N x 5 grid carrying N values, which is a column of data
 * wearing a matrix. The per-repository fact is one pill on the repositories table now; the
 * estate-wide distribution is this row, which is also the control.
 */
export function coldBandKeyModel(view) {
  const t = view && view.totals;
  const defs = coldBandDefs(view);
  if (!t || !defs.length) return [];
  const buckets = Array.isArray(t.buckets) ? t.buckets : [];
  const opens = Array.isArray(t.bucket_open) ? t.bucket_open : [];
  return defs.map((d) => ({
    key: d.key,
    index: d.index,
    label: d.label,
    rank: d.rank,
    count: num(buckets[d.index], 0),
    open: num(opens[d.index], 0),
  }));
}

/**
 * What the two controls above the repositories table currently ask for, as one value.
 *
 * TWO AXES, AND VERDICT IS NOT ONE OF THEM. For an observed repository the verdict IS a
 * function of the band, so a verdict axis would be a second, partly-redundant selector that
 * can contradict it. The band rides inside the cut — "all" | "cold" | "lost" | "band:N" —
 * which removes the corner a reader could otherwise ask for and never get: an unobserved
 * repository has NO bucket, so "out of sight" crossed with an idle band is empty by
 * construction.
 *
 * THIS REGISTER HAD NO CUT CONTROL BEFORE. The sibling's three-way cut arrives here with the
 * band, because the band needed a home and the two registers' repository/asset tables answer
 * the same question.
 */
export function coldSelection(cut, product) {
  const c = typeof cut === "string" && cut ? cut : "all";
  const band = c.indexOf("band:") === 0 ? num(Number(c.slice(5))) : null;
  return {
    cut: c,
    band: band !== null && Number.isInteger(band) && band >= 0 ? band : null,
    product: typeof product === "string" && product ? product : null,
  };
}

/**
 * The rows one selection asks for, over the rows the page already holds. No refetch, ever.
 */
export function applyColdSelection(view, sel) {
  const s = sel || coldSelection("all", null);
  const base = s.band !== null ? coldBandRows(view, s.band) : coldRepoRows(view);
  const rows = s.cut === "cold"
    ? base.filter((r) => r.cold)
    : s.cut === "lost"
      ? base.filter((r) => !r.observed && r.open > 0)
      : base;
  return s.product === null ? rows : rows.filter((r) => r.product === s.product);
}

/**
 * What the selection is, in words — for the chip row, the count under the table, and the live
 * region that tells a screen reader the list moved. One sentence, three consumers.
 */
export function coldSelectionNote(view, sel, rowCount) {
  const s = sel || coldSelection("all", null);
  const parts = [];
  if (s.product !== null) parts.push(s.product);
  if (s.band !== null) {
    const def = coldBandDefs(view).find((d) => d.index === s.band);
    if (def) parts.push("idle " + def.label);
  } else if (s.cut === "cold") {
    parts.push("cold only");
  } else if (s.cut === "lost") {
    parts.push("out of sight with backlog open");
  }
  const n = num(rowCount, 0);
  // NOT `pluralize`, which appends an "s" and would say "repositorys". The register already
  // spells this one out in `coldModeCaption` and in mttr.js, for the same reason.
  const head = "Listing " + fmtCount(n) + " " + (n === 1 ? "repository" : "repositories");
  return parts.length ? head + ": " + parts.join(", ") + "." : head + ".";
}

// `heatLevel` AND `heatModel` USED TO LIVE HERE, and they went with the table that drew
// them. The grid shaded a cell by `count / max` over the whole grid, so its ramp encoded
// MAGNITUDE. A band's tone is its own fixed position on the ordinal ramp now
// (gas_shared/ui/bandBar.js), and nothing derives a shade from a ratio any more.

/**
 * The repositories the section is actually about: the cold ones and the ones the scanner has
 * lost sight of, in that order.
 *
 * THE TWO STATES SHARE A TABLE AND NOT A FIGURE. They are different claims — one about a team,
 * one about the pipeline — which is why the cards above count them separately; but a reader
 * chasing "which repositories do I have to do something about" wants one list, and the verdict
 * column says which kind each row is. Warm, clear and not-yet-measurable repositories are not
 * in it: they are not what the section is for, and the counts above already say how many.
 *
 * SORTED HERE, AND THE TABLE IS GIVEN NO SORT SPEC, so this order survives to the screen
 * (`sortRows` returns the list untouched when no `value` is given). Cold first, then
 * unobserved; within each, the biggest backlog first, name as the tie-break so two paints over
 * the same payload cannot reshuffle.
 */
export function coldRepoRows(view) {
  const repos = view && Array.isArray(view.repos) ? view.repos : [];
  const rows = repos
    .filter((r) => r && (r.cold === true || r.observed === false))
    .map(coldRepoRow);
  return sortColdRows(rows);
}

/**
 * The repositories sitting in one idle band, whatever their verdict.
 *
 * WHY NOT `coldRepoRows` WITH A FILTER. That list is deliberately narrow — cold repositories
 * and ones the scanner has lost sight of, because they are what the section is FOR. Bands 0-2
 * are warm repositories and none of them is in it, so a band selection over that list would
 * light the picture and then list nothing, which is worse than not being selectable at all.
 *
 * `bucket` IS THE DOMAIN'S OWN, and null is a real answer: "0..3, or 4 for not yet measurable,
 * NULL for unobserved and clear repositories". A cast or a `== null` comparison would drop a
 * repository with no bucket into band 0.
 */
export function coldBandRows(view, band) {
  if (typeof band !== "number" || !Number.isFinite(band)) return [];
  const repos = view && Array.isArray(view.repos) ? view.repos : [];
  const rows = repos
    .filter((r) => r && num(r.bucket) === band)
    .map(coldRepoRow);
  return sortColdRows(rows);
}

/**
 * ONE ORDER FOR BOTH CUTS. Cold first, then the biggest backlog, then the name as a tie-break
 * so two paints over the same payload cannot reshuffle.
 */
function sortColdRows(rows) {
  rows.sort((a, b) => {
    if (a.cold !== b.cold) return a.cold ? -1 : 1;
    if (b.open !== a.open) return b.open - a.open;
    return String(a.label).localeCompare(String(b.label));
  });
  return rows;
}

/**
 * One repository, formatted. EXTRACTED so `coldRepoRows` and `coldBandRows` cannot drift: two
 * copies of a twenty-field mapping is where a column quietly means something different
 * depending on which control the reader used to get there.
 */
function coldRepoRow(r) {
      const label = r.repo_name || r.repo_id || absentText;
      const bounded = r.idle_is_bound === true;
      const reading = num(r.idle_reading_days);
      // THE ONE BOUND FORMATTER, not a second spelling of it. `boundedDays` (ui/figures.js)
      // is what puts "≥" in front of a lower bound everywhere in this app, and it decides
      // which it is from WHICH ARGUMENT is non-null — so `idle_is_bound` chooses the slot and
      // `idle_reading_days` is the number either way, exactly as the domain publishes them.
      // README.md above the Pages table fixes the notation: "at least N" in prose, "≥ N" in a
      // cell, never ">".
      const idle = boundedDays(bounded ? null : reading, bounded ? reading : null);
      const movementAt = typeof r.last_movement_at === "string" ? r.last_movement_at : null;
      const kind = typeof r.last_movement_kind === "string" ? r.last_movement_kind : null;
      return {
        key: r.repo_id || label,
        label,
        product: r.product === null || r.product === undefined ? NO_PRODUCT : String(r.product),
        // WHAT THE VERDICT COLUMN CANNOT SAY. "Cold" and "retired" look identical in every
        // other cell on this row, and they are opposite readings of the same silence — so the
        // tag is printed whether or not the deployment has chosen to exclude the retired ones.
        // Absent is this app's one absence mark, never a guessed "live".
        lifecycle: typeof r.lifecycle === "string" && r.lifecycle.trim() ? r.lifecycle : null,
        lifecycleText: typeof r.lifecycle === "string" && r.lifecycle.trim()
          ? r.lifecycle
          : absentText,
        verdict: r.verdict || null,
        verdictWord: COLD_VERDICT_LABEL[r.verdict] || absentText,
        cold: r.cold === true,
        observed: r.observed !== false,
        idleText: idle.text,
        idleBounded: idle.bounded,
        idleDays: reading,
        movementAt,
        movementKind: kind,
        movementText: movementAt === null
          ? absentText
          : fmtDate(movementAt) + (kind ? ` · ${kind}` : ""),
        // WHY A REPOSITORY CAN HAVE NO MOVEMENT AT ALL, printed beside the absence rather than
        // left as a mystery: a reopen clears the resolved/removed/rotated columns, so a
        // repository whose only close came back reads as never having moved. `returned` is
        // this register's word for that and has its own glossary entry.
        reopenedOpen: num(r.reopened_open, 0),
        open: num(r.open_findings, 0),
        highRisk: num(r.open_high_risk, 0),
        oldestOpenAgeDays: num(r.oldest_open_age_days),
        // THE BAND THE DOMAIN PUT IT IN, which this mapping used to drop on the floor. It is
        // what makes a band selectable, and what lets the table name a repository's band
        // without re-deriving it from the idle reading and the threshold — which is the whole
        // of what the per-repository grid used to draw.
        band: num(r.bucket),
      };
}

/**
 * The scatter's points: one per OBSERVED repository that still has an open finding.
 *
 * BOTH FILTERS EARN THEIR PLACE. An unobserved repository has an idle time that measures a
 * scanner outage rather than a team's silence, so plotting it would put a point in the cold
 * quadrant that no remediation could ever move. A repository with nothing open has no backlog
 * to plot against and would sit on the y axis at zero, adding a row of dots that says only
 * "these are fine" — which the cards already say in one number.
 *
 * `bounded` rides along because the x value is a MEASUREMENT for some repositories and a LOWER
 * BOUND for others, and the canvas draws one dot either way (the same reason
 * `renderHalfLifeChart` carries the flag): the tooltip and the table beside it are where the
 * difference is stated.
 */
export function coldScatterPoints(view) {
  const repos = view && Array.isArray(view.repos) ? view.repos : [];
  const points = [];
  for (const r of repos) {
    if (!r || r.observed === false) continue;
    const open = num(r.open_findings, 0);
    const idle = num(r.idle_reading_days);
    if (open <= 0 || idle === null) continue;
    points.push({
      label: r.repo_name || r.repo_id || absentText,
      idleDays: idle,
      open,
      cold: r.cold === true,
      bounded: r.idle_is_bound === true,
    });
  }
  return points;
}

/** One row of the per-repo / per-product table, formatted for `pagedTable`'s columns. */
export function tableRow(row) {
  const foothold = num(row.assets_with_high_risk_pct);
  const lifecycle = typeof row.asset_lifecycle === "string" && row.asset_lifecycle.trim()
    ? row.asset_lifecycle
    : null;
  return {
    key: row.asset_group,
    label: row.asset_label || row.asset_group,
    // NULL AT EVERY GRAIN BUT THE REPOSITORY, and the domain refuses it rather than this
    // function guessing: a product is many repositories and can hold several lifecycles at
    // once (`domain/assets.ts`). The column is drawn on one side of the switch for that
    // reason, so the text is only ever read where it is real.
    lifecycle,
    lifecycleText: lifecycle === null ? absentText : lifecycle,
    assets: num(row.assets, 0),
    openFindings: num(row.open_findings, 0),
    densityP50: num(row.density_p50),
    footholdPct: foothold,
    footholdText: foothold === null ? absentText : (foothold >= 100 ? "Yes" : foothold <= 0 ? "No" : pct1(foothold)),
    coverageP50: num(row.asset_coverage_p50),
    halfLife: halfLifeView(row),
    verdict: capacityVerdict(row),
  };
}

/**
 * Which glyph and word the Foothold cell draws, from `tableRow`'s own already-pinned
 * Yes/No/percentage/absent text — the decision that can be wrong, kept separate from the
 * `<span>` around it so it can be tested without a DOM.
 *
 * ONLY THE TWO ENDS GET A GLYPH. `tableRow.footholdText` is "Yes" at 100%, "No" at 0%, a
 * plain percentage in between (a product made of several repositories, most of which will
 * never land on an exact 0 or 100), and `absentText` when nothing was measured — a percentage
 * is not a verdict, so it stays plain text rather than borrowing a glyph that would claim one.
 */
export function footholdCellKind(footholdText) {
  if (footholdText === "Yes") return "yes";
  if (footholdText === "No") return "no";
  if (footholdText === absentText) return "absent";
  return "value";
}

/**
 * The percentage a repository's (or product's) coverage meter may be filled to — or NULL, which
 * draws no meter. Mirrors `pages/program.js`'s `signalMeterPct`: the refusal happens on the
 * value `tableRow` already read through `num()` (refuse-before-cast), never on a second,
 * confident `Number(...)` taken at render time — `meter(Number(row.coverageP50))` would draw
 * an empty 0% track beside an unmeasured cell, which is a picture asserting a coverage of zero
 * where nothing was measured at all.
 *
 * @param {{coverageP50?: number|null}|null|undefined} row  a `tableRow` result
 * @returns {number|null}
 */
export function coverageMeterPct(row) {
  const pct = row && row.coverageP50;
  return typeof pct === "number" && Number.isFinite(pct) ? pct : null;
}

/**
 * Which of falling-behind / keeping-up / gaining a group's net flow lands in, read off the
 * three published shares rather than re-deriving the band — a group with no defined flow
 * (no window, or nothing to compare) verdicts null rather than a guessed "keeping up".
 */
export function capacityVerdict(row) {
  const falling = num(row.falling_behind_pct);
  const maintaining = num(row.maintaining_pct);
  const gaining = num(row.gaining_pct);
  if (falling === null && maintaining === null && gaining === null) return null;
  if (falling >= maintaining && falling >= gaining && falling > 0) return "falling-behind";
  if (gaining >= maintaining && gaining > 0) return "gaining";
  if (maintaining > 0) return "keeping-up";
  return null;
}

const VERDICT_LABEL = {
  "falling-behind": "Falling behind",
  "keeping-up": "Keeping up",
  gaining: "Gaining",
};

// ----------------------------------------------------------------------------- the page

export async function renderRepos(host, _params, _ctx) {
  const boot = await bootstrap();
  host.append(pageHeader({
    route: "repos",
    lede: "Where the backlog sits, which repositories offer a foothold, and who owns them.",
  }));

  const densityHost = el("div", { class: "kpi-row" });
  const coldHost = el("div", {});

  // THE TWO AXES OF THE COLD ZONE'S CROSS-FILTER, and the repaint that serves them. Both are
  // module-local rather than URL parameters, for the reason the sibling register states at
  // length: `setParams` replaces the whole query string and does not re-render, and every row
  // a selection can reach is already in the payload this page holds, so a selection repaints
  // and never refetches.
  //
  // THE BAND RIDES INSIDE THE CUT — "all" | "cold" | "lost" | "band:N" — so the two controls
  // cannot disagree, and the corner that is empty by construction (an unobserved repository
  // has no bucket) cannot be asked for.
  let repoCut = "all";
  let coldProduct = null;
  let repaintRepos = null;
  const repoHost = el("div", {});
  // WHICH GRAIN THE ONE TABLE IS SHOWING. Client-side only: both cuts are in the payload
  // already (`byRepo` and `byProduct`), so flipping it is a repaint and never a refetch —
  // which is the whole reason it can be a switch rather than two tables.
  let groupGrain = "repo";
  // The last payload painted, so the switch can repaint the table without a refetch. Set by
  // `paint` below; null until the first successful load, which is why `grainSwitch` guards.
  let lastModel = null;
  const chartsHost = el("div", { class: "chart-row" });
  // ONE WRAPPER FOR EVERY SECTION BELOW THE DENSITY CARDS, so a first run can clear four
  // headings and their content together in one call — the same "label lives with its box"
  // shape history.js's own `sectionsHost`/`ensureSections()` use, for the same reason: these
  // headings are static text appended once rather than something a renderX function draws.
  const sectionsHost = el("div", {});

  function ensureSections() {
    if (sectionsHost.childNodes.length) return;
    sectionsHost.append(
      // FIRST, AND THAT IS THE POINT OF THE SECTION. Everything below it reads the estate by
      // volume — how many findings, how concentrated, how fast they die. This one reads it by
      // SILENCE, and a reader who scrolls past three tables of counts before meeting the
      // repositories nobody is working on has already been told the wrong thing first.
      sectionLabel("Cold zone", { term: "cold-zone" }),
      coldHost,
      // ONE TABLE, TWO GRAINS. This was two sections — "By repository" and "By language" —
      // and the second is gone: a repository's language is not something anyone remediates
      // against, and grouping the same measurements by it restated the first table one level
      // coarser. What sits beside the repository now is the grain the tenant owns work by, so
      // the switch flips between "which repository carries this" and "which product does",
      // over identical columns.
      //
      // NAMED FOR ITS QUESTION, NOT FOR ITS GRAIN, and that is the whole reason it is not
      // "By repository or product". The switch inside it already says which grain a row is
      // ("One row per: Repository | Product"), so a heading repeating that says nothing twice
      // — and it collided on screen with the cold zone's own "By product" roll-up above,
      // leaving two headings that both answered "how is this grouped?" and neither "what does
      // this tell me?". They are different questions: the cold zone asks who has gone quiet,
      // this asks how much is here and how fast it clears.
      sectionLabel("Backlog and clearance"),
      repoHost,
      sectionLabel("Half-life"),
      chartsHost,
    );
  }

  host.append(densityHost, sectionsHost);

  densityHost.append(skeletonStack(3, { variant: "stat" }));

  let paint = null;
  const promise = swrCall("api_getReposPage", {}, (fresh) => paint && paint(fresh));

  paint = (model) => {
    const result = model && model.byRepo && model.byRepo.all;
    const d = densityView(result);
    const first = reposFirstRun(d);
    renderDensity(model, d, first);
    // FIRST RUN STOPS HERE — one notice above (in `densityHost`), not four more section
    // headings each over their own empty box. Clearing `sectionsHost` detaches its four
    // headings AND the four content hosts nested inside it in one call; `ensureSections()`
    // re-attaches them the next time this runs non-first (see history.js for the identical
    // shape).
    if (first) {
      [coldHost, repoHost, chartsHost, sectionsHost].forEach(clear);
      return;
    }
    ensureSections();
    lastModel = model;
    renderColdZone(model);
    renderGroupTable(model);
    renderHalfLifeChart(model);
  };

  try {
    paint(await promise);
  } catch (e) {
    console.error("[repos] api_getReposPage failed:", e);
    // errorState, because this IS a failure: the RPC did not answer. Every other absence on
    // this page — an unmeasured cold zone, a grain with no rows, a repository whose curve
    // never fell to half — renders through `emptyState` instead, and the split between the two
    // is the whole reason this call site is spelled out rather than shared.
    clear(densityHost).append(errorState(
      "Couldn't load the repository profile.",
      { detail: String((e && e.message) || e) },
    ));
  }

  function renderDensity(model, d, first) {
    const result = model && model.byRepo && model.byRepo.all;
    const f = footholdView(result);
    clear(densityHost);
    if (first) {
      densityHost.append(firstRunNotice({
        synced: !!boot.latestSync,
        at: boot.latestSync ? boot.latestSync.ts : null,
        hint: "The repository profile appears once a sync has saved findings.",
      }));
      return;
    }
    // FIGURE CARDS, NOW — R3's ladder. The numbers a reader compares (p25/p75, the repository
    // count) stay on the surface as the card's `sub`; the "never a mean" method clause moves
    // to the label's own tip, and the full sentence still lands on `data-denominator` so a
    // test reads what a reader reads (see `test/pagesLit.test.js` gate 3/7).
    const densityCard = figureCard({
      label: "Median findings per repository",
      value: fmtCount(d.p50),
      sub: `p25 ${fmtCount(d.p25)} · p75 ${fmtCount(d.p75)} across ${fmtCount(d.assets)} repositories`,
      denominator:
        `p25 ${fmtCount(d.p25)} · p75 ${fmtCount(d.p75)}, across ${fmtCount(d.assets)} repositories `
        + `(${fmtCount(d.openFindings)} open findings). Never a mean — the distribution is long-tailed.`,
    });
    const footholdCard = figureCard({
      label: "Foothold rate",
      value: f.pct === null ? absentText : pct1(f.pct),
      sub: f.assets ? `Of ${fmtCount(f.assets)} repositories` : "No repositories measured",
      help: { term: "foothold" },
      denominator: f.assets ? `Of ${fmtCount(f.assets)} repositories.` : "No repositories measured.",
    });
    densityHost.append(densityCard, footholdCard);
  }

  /**
   * The cold zone: four figures, two tables, a grid and a scatter — or one notice.
   *
   * NEITHER ABSENCE IS AN ERROR, and both are drawn with `emptyState(..., {variant:"notice"})`
   * rather than `errorState`. A register with no scan on record has no clock to measure
   * idleness against, and a register whose repositories are all clear and all still returned
   * by the newest scan has nothing to be idle. Both are states this page renders correctly; a
   * red role="alert" box would tell a reader the page is broken — the exact defect the
   * ownership section that used to sit here was fixed for, and no reason to reintroduce it
   * under a new name.
   */
  function renderColdZone(model) {
    const view = coldZoneView(model);
    clear(coldHost);
    // FIRST, IN ALL THREE BRANCHES. Every figure below is read off one line in days, and the
    // same number means different things depending on which mode drew it — so the sentence
    // that says which one goes ABOVE the figures rather than under them, and it is printed on
    // the two notice branches too, where the line is the only thing there is to say.
    coldHost.append(denomNote(coldModeCaption(view)));
    // WHO IS BEING MEASURED, directly under where the line came from, and on all three
    // branches for the same reason that caption is: both sentences are about the section
    // rather than about its figures, and the population question survives a register that
    // cannot measure anything yet.
    const eol = endOfLifeNote(view);
    if (eol) coldHost.append(denomNote(eol));
    if (!view.measurable) {
      coldHost.append(emptyState(
        "The cold zone is not measured yet.",
        "Idle time is counted from the last scan back to the movement before it, and no scan"
        + " has been saved, so there is no clock to measure idleness against.",
        { variant: "notice" },
      ));
      return;
    }
    if (!view.populated) {
      coldHost.append(emptyState(
        "No repository is sitting still.",
        "Nothing has an open finding to go quiet on, and the scanner has not lost sight of"
        + " any repository. This section appears when one of those two things is true.",
        { variant: "notice" },
      ));
      return;
    }
    renderColdKpis(view);
    renderColdTeams(view);
    renderColdRepos(view);
    renderColdChart(view);
  }

  function renderColdKpis(view) {
    const row = el("div", { class: "kpi-row" });
    for (const card of coldKpiCards(view)) {
      row.append(figureCard({
        label: card.label,
        value: card.value,
        sub: card.sub,
        help: card.help || null,
        denominator: card.denominator,
      }));
    }
    coldHost.append(row);
    // The repositories none of the four figures can speak for, said out loud rather than left
    // to the heatmap's fifth column to imply. Null when there are none — an always-printed
    // sentence about zero repositories is noise.
    const note = unmeasurableNote(view);
    if (note) coldHost.append(denomNote(note));
    renderColdCensus(view);
  }

  /**
   * The census, under the four figures it gives a shape to. Drawn only where the register has
   * repositories to count: `coldCensusModel` returns null otherwise, and a lattice over an
   * unmeasured denominator is the confident zero this page refuses everywhere else.
   *
   * The key row carries every figure in words, which is why this owes no `chartTable`
   * disclosure the way a canvas on this page would — see ui/unitChart.js's `unitKeyRow`.
   */
  function renderColdCensus(view) {
    const model = coldCensusModel(view);
    if (!model || !model.measured) return;
    // THE CLASS IS ON THE CARD, not only on the lattice inside it: the key row is a SIBLING
    // of the grid, and its swatches have to take the same field-grade fills.
    coldHost.append(el("div", { class: "card cold-census" },
      sectionLabel("Every repository, by what the clock can say"),
      unitGrid(model, { className: "cold-census" }),
      unitKeyRow(model)));
  }

  function renderColdTeams(view) {
    const rows = coldTeamRows(view);
    coldHost.append(el("h3", { class: "section-label" }, "By product"));
    if (!rows.length) {
      coldHost.append(emptyState(
        "No product has a repository to report on yet.",
        "A product appears here as soon as one of its repositories carries a finding.",
        { variant: "notice" },
      ));
      return;
    }
    // ONE SCALE FOR THE WHOLE TABLE. See `coldBandScale`, and gas_shared/ui/bandBar.js for the
    // defect it refuses.
    const scale = coldBandScale(rows);
    renderBandKeys(view);

    coldHost.append(pagedTable({
      columns: [
        {
          key: "label", label: "Product",
          // THE ROW'S NAME IS THE CONTROL, one tab stop per row — the stop a clickable row
          // already costs. The bars are NOT controls: five segments per row times N rows is
          // 5N stops, which is the arity rule `quad.js` states.
          cell: (r) => el("button", {
            type: "button", class: "linklike group-pick", "data-group-pick": r.key,
            "aria-pressed": coldProduct === r.key ? "true" : "false",
            onclick: () => pickProduct(r.key),
          }, r.label),
        },
        {
          // THE ESCALATION PATH, beside the grain that has gone cold. The roll-up itself is
          // NOT a second table: the verdicts and the coldest-share badge are calibrated on
          // this population of products (src/domain/coldZone.ts's rollUp says why), and a
          // support-group table would have to re-derive both on a population a tenth the
          // size, where "the coldest 20%" means something else.
          key: "supportGroup", label: "Support group",
          cell: (r) => r.supportGroupText,
        },
        {
          key: "verdict", label: "Verdict",
          // The dot AND the word, never the dot alone — `gas_shared/ui/verdict.js` carries the mapping
          // for both this page's verdict families.
          cell: (r) => verdictMark(r.verdict, r.verdictWord),
        },
        { key: "repos", label: "Repos", className: "num", cell: (r) => fmtCount(r.repos) },
        {
          // THE PER-REPOSITORY GRID, ROLLED UP TO WHERE IT READS. `renderColdHeat` drew one
          // row per repository with exactly one lit cell in it — an N x 5 grid carrying N
          // values. The per-repository fact is a pill on the repositories table now; the
          // shape of a PRODUCT's idle time is this bar, in the row that owns it.
          //
          // `repos` stays a real column beside it: `buckets` sums only to the repositories
          // that HAVE an idle reading, and an unobserved or clear one sits in no band at all,
          // so deriving the count from the distribution would be wrong by exactly the
          // population this section exists to talk about.
          key: "bands", label: "Idle profile",
          help: {
            term: "cold-zone",
            lines: [
              "Every repository with an idle reading, in the band that reading falls in.",
              "Ones the scanner has lost sight of, and ones with nothing open, are in no band.",
            ],
          },
          cell: (r) => {
            const model = bandBarModel({
              bands: r.bands, max: scale, unit: "repositories", name: r.label,
            });
            const wrap = el("span", { class: "bandcell" });
            wrap.bandModel = model;
            wrap.append(bandBar(model, { selected: selectedBand() }));
            return wrap;
          },
        },
        {
          // COUNT AND SHARE IN ONE COLUMN, because they are one fact at two grains and the
          // distribution beside them needs the width more.
          key: "cold", label: "Cold", className: "num",
          help: { term: "cold-zone" },
          cell: (r) => {
            const count = fmtCount(r.coldRepos);
            // A null share draws NO meter: see `coldTeamRows` for the refusal and why an
            // empty track would be a claim rather than a blank.
            if (r.sharePct === null) return el("span", {}, count, " ", absent());
            return el("span", { class: "rate-with-meter" },
              count + " · " + pct1(r.sharePct),
              meter(r.sharePct, { className: "meter--stat", decorative: true }));
          },
        },
        {
          // THE RELATIVE POSITION, beside the absolute verdict rather than instead of it. The
          // rank is computed in both modes so the column always reads; the BADGE is a claim
          // about a target share and only relative mode names one, so it appears only there.
          // `warn` rather than `bad` on purpose: being the coldest product on a healthy
          // estate is a POSITION, not a verdict, and the Verdict column earlier in the same
          // row is where the absolute reading lives.
          key: "coldestRank", label: "Coldest rank", help: { term: "coldest-share" },
          cell: (r) => {
            const rank = r.relativeRank === null ? absentText : fmtCount(r.relativeRank);
            if (!r.inColdestShare) return rank;
            // The pill draws its own dot and its own word, so there is no new class and no
            // new colour here — and the two are separated by a plain space rather than by a
            // wrapper class, because a pill already carries its own padding.
            return el("span", {},
              rank,
              " ",
              statusPill("warn", `Coldest ${fmtCount(view.targetSharePct)}%`));
          },
        },
        {
          key: "openInCold", label: "Open in cold", className: "num",
          cell: (r) => fmtCount(r.openInCold),
        },
        {
          key: "highRiskInCold", label: "High-risk in cold", className: "num",
          cell: (r) => fmtCount(r.highRiskInCold),
        },
        {
          // A DATE, not a figure — left-aligned like every other date column in this app
          // (history.js's "When"). `num` would right-align it against a column of counts it
          // has nothing to line up with.
          key: "lastMovement", label: "Last movement",
          help: {
            term: "idle",
            lines: [
              "The most recent finding resolved, removed or rotated anywhere in the product.",
              "Over the repositories the scanner still returns.",
            ],
          },
          cell: (r) => r.lastMovementText,
        },
      ],
      rows,
      // NO SORT SPEC — see `coldTeamRows`: the payload's own order is the published one, and
      // `sortRows` leaves a list untouched when it is given no value function.
      emptyText: "No product has a repository to report on yet.",
    }));
    coldHost.append(denomNote(productCountNote(view, rows.length)));
    // The marks in the column above, counted — and the clamp that decides how many there are,
    // stated. Null when nobody is marked, which is every product in fixed mode.
    const coldest = coldestShareNote(view);
    if (coldest) coldHost.append(denomNote(coldest));
  }

  /** The band currently selected, as a key, or null. */
  function selectedBand() {
    return repoCut.indexOf("band:") === 0 ? repoCut : null;
  }

  /**
   * The band key row: the grid's estate-wide totals, still on the surface, now the control.
   *
   * WHERE THE FIVE TAB STOPS GO. The bars refuse to be controls because five per row times N
   * rows is 5N stops; this row spends five ONCE, for the whole table, and reads as information
   * whether or not anyone presses it.
   */
  function renderBandKeys(view) {
    const keys = coldBandKeyModel(view);
    if (!keys.length) return;
    const row = el("div", {
      class: "bandkeys", role: "group", "aria-label": "Filter by idle band",
    });
    for (const k of keys) {
      row.append(el("button", {
        type: "button", class: "bandkey", "data-band-key": k.key,
        "data-rank": k.rank === null ? "none" : String(k.rank),
        "aria-pressed": selectedBand() === k.key ? "true" : "false",
        onclick: () => pickBand(k.key),
      },
      el("span", { class: "bandkey__swatch", "aria-hidden": "true" }),
      el("span", { class: "bandkey__label" }, k.label),
      el("span", { class: "bandkey__num num" }, fmtCount(k.count))));
    }
    coldHost.append(row);
  }

  /** Pressing a band, and pressing it again to let go. It MOVES THE CUT rather than sitting
   * beside it, so the two controls can never disagree. */
  function pickBand(key) {
    repoCut = repoCut === key ? "all" : key;
    syncSelection();
  }

  function pickProduct(key) {
    coldProduct = coldProduct === key ? null : key;
    syncSelection();
  }

  /**
   * Repaint what the selection changed, and nothing else.
   *
   * MARKED IN PLACE, NEVER REBUILT. The controls are the band key row and the product name
   * buttons; rebuilding either would tear the focused button out from under the reader
   * mid-press. So the buttons keep their nodes and only their `aria-pressed` moves, the bars
   * are redrawn inside cells nobody is focused in, and the repositories table — which holds no
   * control that could have started this — is the one thing rebuilt wholesale.
   */
  function syncSelection() {
    const band = selectedBand();
    for (const btn of coldHost.querySelectorAll("[data-band-key]")) {
      btn.setAttribute("aria-pressed",
        btn.getAttribute("data-band-key") === band ? "true" : "false");
    }
    for (const btn of coldHost.querySelectorAll("[data-group-pick]")) {
      const on = btn.getAttribute("data-group-pick") === coldProduct;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      const row = btn.closest("tr");
      if (row) row.classList.toggle("is-picked", on);
    }
    for (const cell of coldHost.querySelectorAll(".bandcell")) {
      if (!cell.bandModel) continue;
      clear(cell).append(bandBar(cell.bandModel, { selected: band }));
    }
    if (repaintRepos) repaintRepos();
  }

  // `renderColdHeat` USED TO LIVE HERE, and it was the worst of the two grids this wave
  // folded. It drew one row per REPOSITORY with exactly one lit cell in it -- an N x 5 grid
  // carrying N values, a column of data wearing a matrix. The per-repository fact is one
  // pill on the repositories table now; the shape of a PRODUCT's idle time is a `bandBar` in
  // the roll-up above; and the estate-wide totals row is the band key, which is also the
  // control. `heatLevel` and `heatModel` went with it.

  function renderColdRepos(view) {
    const countOf = (cut) => applyColdSelection(view, coldSelection(cut, coldProduct)).length;

    // THE THREE-WAY CUT ARRIVES IN THIS REGISTER WITH THE BAND. The sibling has had it since
    // the census created a question it could not answer ("out of sight, backlog open" is the
    // one segment that is unambiguously work); here it is new, and it is what gives the band
    // a home — the band is a value OF this control rather than a second state beside it.
    const toggle = segmented({
      options: ["all", "cold", "lost"].map((value) => ({
        value,
        // THE COUNT RIDES ON THE LABEL. A cut a reader cannot size before opening it is a cut
        // they open to find out, and the interesting one here is often empty — good news they
        // should be able to read without a click.
        label: (value === "all" ? "All" : value === "cold" ? "Cold" : "Out of sight, backlog open")
          + " " + fmtCount(countOf(value)),
        title: value === "lost"
          ? "Repositories the newest scan no longer returns that still carry open findings."
            + " Nobody will be told about that backlog again."
          : value === "cold"
            ? "Repositories the scanner still returns, still carrying open findings, with"
              + " nothing resolved for at least the window."
            : "Both: every cold repository and every one the scanner has lost sight of.",
      })),
      value: repoCut,
      ariaLabel: "Which repositories to list",
      onChange: (v) => {
        if (v === repoCut) return;
        // Choosing one of the three clears the band, because the band lives in this value.
        repoCut = v;
        syncSelection();
      },
    });

    const chips = filterChipRow({
      onPatch: (patch) => {
        if (patch.band) repoCut = "all";
        if (patch.product) coldProduct = null;
        syncSelection();
      },
      onClearAll: () => { repoCut = "all"; coldProduct = null; syncSelection(); },
      emptyText: "Showing every repository this section is about.",
      ariaLabel: "Applied filters",
    });

    // THE LIST MOVED, SAID OUT LOUD. A band pressed two sections up changes this table
    // silently for a reader who cannot see it.
    const live = el("p", { class: "sr-only", role: "status", "aria-live": "polite" });

    coldHost.append(el("div", { class: "section-head" },
      el("h3", { class: "section-label" }, "Cold and unobserved repositories"),
      el("div", { class: "toolbar-group" },
        el("span", { class: "small muted" }, "Show"),
        toggle)));
    coldHost.append(chips);
    coldHost.append(live);

    const tableHost = el("div", {});
    coldHost.append(tableHost);
    repaintRepos = paintRepos;
    paintRepos();

    function paintRepos() {
      const sel = coldSelection(repoCut, coldProduct);
      const rows = applyColdSelection(view, sel);
      toggle.set(["all", "cold", "lost"].indexOf(sel.cut) === -1 ? "all" : sel.cut);
      const entries = [];
      if (sel.band !== null) {
        const def = coldBandKeyModel(view).find((k) => k.key === sel.cut);
        if (def) entries.push({ label: "Idle band", value: def.label, patch: { band: true } });
      }
      if (sel.product !== null) {
        entries.push({ label: "Product", value: sel.product, patch: { product: true } });
      }
      chips.sync(entries);
      live.textContent = coldSelectionNote(view, sel, rows.length);
      clear(tableHost);
      if (!rows.length) {
        // A NARROWED CUT THAT IS EMPTY IS A DIFFERENT SENTENCE from an estate with nothing to
        // report. "No repository is cold" over a product the reader just picked would be a
        // claim about the whole register, read off a filtered list.
        const narrowed = sel.band !== null || sel.product !== null;
        tableHost.append(emptyState(
          narrowed
            ? "Nothing in this cut."
            : sel.cut === "lost"
              ? "No backlog has been left behind."
              : sel.cut === "cold"
                ? "No repository is cold."
                : "No repository is cold, and none has dropped out of the scanner.",
          narrowed
            ? coldSelectionNote(view, sel, 0) + " Clear the filter to see the whole list."
            : sel.cut === "lost"
              ? "Every repository the scanner lost sight of had already been cleared when it"
                + " went."
              : "Every repository with an open finding has moved inside the window.",
          { variant: "notice" },
        ));
        return;
      }
      tableHost.append(pagedTable({
      columns: [
        { key: "label", label: "Repository", cell: (r) => r.label },
        { key: "product", label: "Product", cell: (r) => r.product },
        {
          // BESIDE THE OWNER, NOT BESIDE THE VERDICT. It answers "what is this repository",
          // which is the same question the two columns to its left answer, rather than
          // "how is it doing" — and a reader scanning for something to dismiss reads the
          // left of the row.
          key: "lifecycle", label: "Lifecycle", help: { term: "lifecycle" },
          cell: (r) => r.lifecycleText,
        },
        { key: "verdict", label: "Verdict", cell: (r) => verdictMark(r.verdict, r.verdictWord) },
        {
          key: "idle", label: "Idle", className: "num", help: { term: "idle" },
          cell: (r) => r.idleText,
        },
        {
          // THE PER-REPOSITORY GRID, AS ONE CELL. `renderColdHeat` drew a whole N x 5 table to
          // say which band each repository sits in — one lit cell per row. That is one fact,
          // and it belongs beside the reading it bands.
          key: "band", label: "Idle band",
          cell: (r) => {
            const def = coldBandDefs(view).find((d) => d.index === r.band);
            if (!def) return absent();
            return el("span", {
              class: "bandpill",
              "data-rank": def.rank === null ? "none" : String(def.rank),
            }, def.label);
          },
        },
        {
          key: "movement", label: "Last movement",
          // THE TERM OF ART IN THIS COLUMN IS "returned", not "movement": the date needs no
          // glossary, and the suffix beside it does — a repository reading "—" here has had
          // its movement columns CLEARED by a reopen rather than never having moved, and
          // `returned` is this register's word for a finding seen again after it resolved.
          help: {
            term: "returned",
            lines: [
              "The most recent finding resolved, removed or rotated on this repository.",
              "N returned counts open findings that have come back at least once.",
              "A return clears the movement columns, so a repository with returns can show"
              + " none at all.",
            ],
          },
          cell: (r) => {
            if (!r.reopenedOpen) return r.movementText;
            // A repository can read "no movement" because a reopen CLEARED its movement
            // columns, which is a different thing from nothing ever having happened. The count
            // of findings that came back is printed beside the absence so the reader sees why.
            return el("span", {},
              r.movementText,
              el("span", { class: "small muted" }, ` — ${fmtCount(r.reopenedOpen)} returned`));
          },
        },
        { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.open) },
        { key: "highRisk", label: "High-risk", className: "num", cell: (r) => fmtCount(r.highRisk) },
        {
          key: "oldest", label: "Oldest open", className: "num",
          cell: (r) => (r.oldestOpenAgeDays === null ? absentText : days1(r.oldestOpenAgeDays)),
        },
      ],
      rows,
      // NO SORT SPEC — `coldRepoRows` publishes cold first, then unobserved, biggest backlog
      // first inside each, and that order is the section's whole argument.
      emptyText: "No repository is cold, and none has dropped out of the scanner.",
      }));
      // WHICH VERDICTS ARE IN THE LIST, as a short lead with the exclusions behind it. It was
      // a 27-word paragraph; the two words a reader needs without hovering are "cold" and "out
      // of sight", and the census above already draws every verdict with its count. Under a
      // band or a product the lead is the selection's own sentence instead, because "cold, and
      // out of sight" over a narrowed list would describe a population that is not on screen.
      tableHost.append(el("p", { class: "small muted" }, tipLabel(
        sel.band !== null || sel.product !== null
          ? coldSelectionNote(view, sel, rows.length)
          : sel.cut === "lost"
            ? fmtCount(rows.length) + " listed: out of sight, backlog open"
            : sel.cut === "cold"
              ? fmtCount(rows.length) + " listed: cold"
              : fmtCount(rows.length) + " listed: cold, and out of sight",
        {
          lines: [
            "Every cold repository and every one the scanner has lost sight of.",
            "Warm, clear and not-yet-measurable repositories are counted above and not listed"
              + " here.",
          ],
        },
      )));
    }
  }

  /**
   * Idle time against backlog, one dot per repository the newest scan still returns.
   *
   * The same loader dance as `renderHalfLifeChart` below, for the same reasons: Chart.js is a
   * second bundle fetched on demand, a deployment whose CSP refuses it falls back to
   * `chartUnavailable` rather than to a blank box, and the chart is destroyed on teardown so a
   * route change does not leave a live Chart bound to a detached canvas.
   */
  function renderColdChart(view) {
    const points = coldScatterPoints(view);
    coldHost.append(el("h3", { class: "section-label" }, "Idle time against backlog"));
    if (!points.length) {
      coldHost.append(emptyState(
        "No repository to plot yet.",
        "The scatter needs a repository the scanner still returns that has at least one open"
        + " finding.",
        { variant: "notice" },
      ));
      return;
    }
    const canvas = el("canvas");
    coldHost.append(el("div", { class: "chart-card" },
      el("div", { class: "chart-box" }, canvas),
      chartTable({
        canvas,
        caption: "Every repository the newest scan still returns that has an open finding, its"
          + " idle time and its backlog. \"at least\" marks a repository with no movement on"
          + " record — that figure is a lower bound counted from when this register started"
          + " watching, not a measured silence.",
        model: chartTableModel({
          columns: [
            { key: "label", label: "Repository", format: "text" },
            { key: "idleDays", label: "Idle days", format: "days" },
            { key: "open", label: "Open", format: "count" },
            {
              key: "bounded",
              label: "Reading",
              format: "text",
              align: "text",
              value: (p) => (p.bounded ? "at least" : "measured"),
            },
          ],
          rows: points,
        }),
      })));
    loadCharts()
      .then((api) => {
        api.coldZoneScatter(canvas, points, {
          thresholdDays: view.coldAfterDays,
          // The rule's label says "(relative)" when the line was derived, because a dashed
          // rule at 47 days is a different claim depending on where 47 came from.
          mode: view.mode,
        });
        onPageTeardown(() => {
          try {
            api.destroyChart(canvas);
          } catch (e) {
            /* already detached */
          }
        });
      })
      .catch(() => chartUnavailable(canvas));
  }

  /**
   * The one grouped table, and the switch that says which grain it is counting.
   *
   * IDENTICAL COLUMNS ON BOTH SIDES, which is what makes this a switch rather than two
   * tables wearing one heading: every figure here is a property of a POPULATION OF
   * REPOSITORIES — how dense, whether any offers a foothold, how much of what deserved
   * remediation got it, how fast a finding dies, whether closing keeps up with arriving —
   * and a product is just a bigger population of the same thing. Only the row header and the
   * denominator sentence change words.
   *
   * ONE EXTRA COLUMN ON THE PRODUCT SIDE, and it is the honest one: `Repos`, how many
   * repositories the product is made of. Without it a reader cannot tell a product whose
   * single repository is dense from one whose twenty are. The repository side needs no such
   * column — the answer is always one.
   */
  function renderGroupTable(model) {
    const cut = groupGrain === "product"
      ? (model && model.byProduct && model.byProduct.all)
      : (model && model.byRepo && model.byRepo.all);
    const isRepo = groupGrain !== "product";
    const singular = isRepo ? "repository" : "product";
    const plural = isRepo ? "repositories" : "products";
    const rows = groupRows(cut).map(tableRow).sort((a, b) => b.openFindings - a.openFindings);
    clear(repoHost);
    // THE SWITCH IS DRAWN EVEN WHERE THE TABLE IS EMPTY. A reader who lands on a grain with
    // nothing measured has to be able to get back to the one that has something; a control
    // that appeared only on success would strand them.
    repoHost.append(grainSwitch());
    if (!rows.length) {
      repoHost.append(emptyState(
        `No ${plural} measured yet.`,
        `It appears once a sync has saved a finding against at least one ${singular}.`,
      ));
      return;
    }
    const columns = [
      { key: "label", label: isRepo ? "Repository" : "Product", cell: (r) => r.label },
    ];
    // ONE GRAIN-SPECIFIC COLUMN EACH, IN THE SAME SLOT, and they are two halves of the same
    // honesty rather than two exceptions. A product needs `Repos` because without it a reader
    // cannot tell a product whose single repository is dense from one whose twenty are; the
    // repository side needs no such column, because the answer is always one. A repository
    // needs `Lifecycle` because a retired one carries a backlog nobody is meant to clear; the
    // product side cannot have one, because a product spans repositories that need not agree
    // — `assetProfile` publishes `asset_lifecycle` at the repository grain only, so the
    // absence here is the domain's refusal and not a layout choice.
    if (isRepo) {
      columns.push({
        key: "lifecycle", label: "Lifecycle", help: { term: "lifecycle" },
        cell: (r) => r.lifecycleText,
      });
    } else {
      columns.push({ key: "assets", label: "Repos", className: "num", cell: (r) => fmtCount(r.assets) });
    }
    columns.push(
      { key: "open", label: "Open findings", className: "num", cell: (r) => fmtCount(r.openFindings) },
      {
        key: "foothold", label: "Foothold", className: "num", help: { term: "foothold" },
        // A verdict at the two ends (Yes/No) draws a glyph AND the word — colour never
        // carries it alone, per R5. A percentage in between (a product made of several
        // repositories) is not a verdict and stays plain text; absent stays this app's one
        // absence mark. `footholdCellKind` is the pure decision this reads.
        cell: (r) => {
          const kind = footholdCellKind(r.footholdText);
          if (kind === "yes") {
            return el("span", { class: "cell-verdict cell-verdict--ok" }, uiIcon("check", 14), "Yes");
          }
          if (kind === "no") {
            return el("span", { class: "cell-verdict cell-verdict--muted" }, uiIcon("not", 14), "No");
          }
          return r.footholdText;
        },
      },
      {
        key: "coverage", label: "Coverage (p50)", className: "num", help: { term: "coverage" },
        // The percentage plus a picture of it, `decorative` because the figure is already in
        // words right beside it (`.rate-with-meter` — the same recipe MTTR & SLA's rate cells
        // use). `coverageMeterPct` refuses null BEFORE any cast, so an unmeasured cell draws
        // no meter rather than an empty one asserting a coverage of zero.
        cell: (r) => {
          const pct = coverageMeterPct(r);
          if (pct === null) return absentText;
          return el("span", { class: "rate-with-meter" },
            pct1(r.coverageP50),
            meter(pct, { className: "meter--stat", decorative: true }));
        },
      },
      {
        key: "halfLife", label: "Half-life", className: "num", help: { term: "half-life" },
        cell: (r) => r.halfLife.text,
      },
      {
        key: "capacity", label: "Capacity", className: "num", help: { term: "capacity" },
        cell: (r) => verdictMark(r.verdict, r.verdict ? VERDICT_LABEL[r.verdict] : absentText),
      },
    );
    // PAGED, like every other unbounded table in this app. `rows` is one row per repository
    // (or per product) and the estate is not small: the whole list was rendered at once
    // here, so a reader met several hundred rows with no footer, no page size and nothing
    // saying how many there were beyond the count line below. `pagedTable` (sca.js) sorts
    // and pages client-side, which is right for a list the page already holds in full —
    // unlike the per-finding register, which is server-paged because it is 18,800 rows.
    //
    // THE SORT IS THE ONE THIS TABLE ALREADY HAD: most open findings first, tie-broken on
    // the group key so equal counts do not reshuffle between paints. `rows` arrives sorted
    // that way and `sortRows` re-states it rather than changing it.
    repoHost.append(pagedTable({
      columns,
      rows,
      sortSpec: { value: (r) => r.openFindings, descending: true, tiebreak: (r) => r.key },
      emptyText: `No ${plural} measured yet.`,
    }));
    // "MEASURED", NOT "SHOWN", NOW THAT THE TABLE PAGES. The count is the whole set this
    // page holds; the pager above it states which slice of that set is on screen. Leaving
    // the old word would have the two lines disagree — "312 repositories shown" directly
    // under a footer reading 1-25 of 312.
    repoHost.append(denomNote(`${fmtCount(rows.length)} ${rows.length === 1 ? singular : plural} measured.`));
  }

  /**
   * The grain switch. Repaints in place — it never refetches, because both cuts already
   * travelled in the one payload this page loaded.
   *
   * NAMED FOR WHAT A ROW IS, not for what the switch does: "Repository" and "Product" are the
   * row headers the reader will get, so the control and the column agree word for word.
   */
  function grainSwitch() {
    return el("div", { class: "toolbar-group" },
      el("span", { class: "small muted" }, "One row per"),
      segmented({
        options: [
          {
            value: "repo",
            label: "Repository",
            title: "One row per repository — how much each carries and how fast it clears it.",
          },
          {
            value: "product",
            label: "Product",
            title: "The same measurements over every repository the tenant files under one "
              + "product. A repository filed under none is counted under (no product).",
          },
        ],
        value: groupGrain,
        ariaLabel: "Group the table by",
        onChange: (v) => {
          if (v === groupGrain) return;
          groupGrain = v;
          if (lastModel) renderGroupTable(lastModel);
        },
      }));
  }

  function renderHalfLifeChart(model) {
    const rows = groupRows(model && model.byRepo && model.byRepo.all)
      .filter((r) => r.km_median_days !== null || r.km_median_lower_bound !== null)
      .sort((a, b) => (b.km_median_days ?? b.km_median_lower_bound ?? 0) - (a.km_median_days ?? a.km_median_lower_bound ?? 0))
      .slice(0, 15);
    clear(chartsHost);
    if (!rows.length) {
      chartsHost.append(emptyState(
        "Not enough resolved findings yet to chart a per-repository half-life.",
        "It appears once at least one finding in a repository has resolved.",
      ));
      return;
    }
    const canvas = el("canvas");
    // ONE array, built here and handed to both the wrapper and the table below it. `bounded`
    // is carried alongside because the plotted y is a MEDIAN for some repositories and a
    // LOWER BOUND for others — the canvas draws one line either way and cannot say which,
    // and CLAUDE.md's rule is that where the curve never reaches half we publish the bound
    // rather than a number pretending to be the median.
    const points = rows.map((r) => ({
      x: r.asset_label || r.asset_group,
      y: r.km_median_days !== null ? r.km_median_days : r.km_median_lower_bound,
      bounded: r.km_median_days === null,
    }));
    chartsHost.append(el("div", { class: "chart-card" },
      el("h3", { class: "section-label" }, "Slowest-clearing repositories"),
      el("div", { class: "chart-box" }, canvas),
      chartTable({
        canvas,
        caption: "The plotted repositories and their half-life in days. \"at least\" marks a"
          + " repository whose curve never fell to half — that figure is a lower bound, not a"
          + " median.",
        model: chartTableModel({
          columns: [
            { key: "x", label: "Repository", format: "text" },
            { key: "y", label: "Half-life", format: "days" },
            {
              key: "bounded",
              label: "Reading",
              format: "text",
              align: "text",
              value: (p) => (p.bounded ? "at least" : "median"),
            },
          ],
          rows: points,
        }),
      })));
    loadCharts()
      .then((api) => {
        api.trendLine(canvas, points, { yLabel: "days" });
        onPageTeardown(() => {
          try {
            api.destroyChart(canvas);
          } catch (e) {
            /* already detached */
          }
        });
      })
      .catch(() => chartUnavailable(canvas));
  }
}
