// The Secrets register: a credential committed to a repository.
//
// THE ONE REGISTER WHERE A RESOLVED STATUS DOES NOT MEAN THE RISK IS GONE. A secret leaves
// this register when the string leaves HEAD. The credential is live until somebody rotates
// it, and git history keeps the old commit readable either way. Removal and rotation are two
// events, so the page draws them on two independent axes and leads with the corner where
// they disagree.
//
// NO SEVERITY. NOT ANYWHERE ON THIS PAGE, and the absence is a measurement rather than an
// omission. Severity here grades a DETECTION — how confident the scanner is that a matched
// string is a credential shape — not whether the credential works: 641 SAAS_API_KEY rows in
// this tenant sit at LOW and every CERTIFICATE row is INFORMATIONAL. DEFAULT_FETCH_SEVERITIES
// for this scope is empty (empty means all), `secretsModel` ignores the caller's severities
// outright, `registerModel` nulls every severity block, and `bySegment` throws on a
// "severity" axis. This page is the last link in that chain: it segments by validation state,
// confidence and secret kind, and it renders no severity mark, no severity class and no
// severity column. `test/pagesRegisters.test.js` asserts that over the whole file.
//
// VALIDITY IS THE SPINE, AND IT COMES FIRST. Every vendor that scans for credentials triages
// on whether the credential is LIVE — GitHub's validity checks, GitGuardian's validity facet,
// TruffleHog's "verified" flag, Wiz's own validation engine — and severity is demoted or
// absent in all four. This page agreed in principle and disagreed in layout: the validation
// state and the detector confidence were the SIXTH and SEVENTH blocks a reader met, several
// screens below the four-corner table and the survival curve. So the first thing under the
// hero is now `validityTriageView` — confirmed live / unchecked / confirmed dead over the OPEN
// register, plus the removed-but-unrotated alarm — and the two segment tables that carry the
// same measurement in full follow immediately after it, side by side.
//
// THE THREE VALIDITY FIGURES PARTITION THE OPEN REGISTER, and that is why they are read off
// the `validation_state` segment rows rather than off `coverage`/`validity`. `bySegment`
// buckets EVERY secrets row by its state and reports each bucket's own open count, so
// VALID.open + INVALID.open + (everything else).open is exactly the open row count — one
// table, two views, and a reader can check the arithmetic against the table below. Reading
// the same three figures off `postDetectionValidityRate` would count resolved findings too
// and the three would no longer add up to the "Open" figure in the header strip.
//
// NO CROSS-TAB. Validity and confidence qualify each other and a reader will want the joint
// count; the payload does not carry one — `segments` is three INDEPENDENT one-axis
// breakdowns — and a matrix multiplied out of two sets of marginals is a fabrication, not a
// measurement. So the page draws the two tables side by side and says why there is no third.
//
// ITS OWN ENDPOINT, FOR THAT REASON. `api_getRegisterPage` REFUSES this scope;
// `api_getSecretsPage` serves it, in two halves — `register` (the aging, ranking, movement
// and concentration blocks a register page draws) and `secrets` (validation coverage,
// post-detection validity, time-to-revoke, and the removal-vs-rotation 2x2 that replaces the
// severity breakdown).
//
// NEVER RENDER A SECRET'S VALUE. `Q_SECRETS` deliberately omits `snippet` and
// `validationDetails` and slimRecord's deny-list enforces it. This page answers WHICH secret,
// WHERE, HOW OLD and IS IT DEAD from the kind, the repository, the age and the validation
// state. Triage opens Wiz for the value; there is no column for it here and there must not be.
//
// The shared register vocabulary is imported from ./sca.js — see that file's header. Nothing
// severity-flavoured is imported: not sevBadge, not sevEntries, not sevSegmentBar, and not
// the sca aging or oldest-findings models, both of which carry a severity axis. The numeric
// core (`num`/`fmtCount`/`days1`/`pct1`) comes straight from `../ui.js` instead: `sca.js` no
// longer hosts a second copy of those, only the register-shaped helpers built on top of them.
// `denomNote` has left this page entirely — every denominator it printed as a paragraph is
// now a line on the heading or card label it belongs to, and the sentence a test reads is
// written to `data-denominator` by `figureCard` instead.

import {
  bootstrapCached, listJoin, listSplit, navigate, swrCall,
} from "../../../../../gas_shared/store.js";
import {
  absent, absentText, closeActiveSheet, dataTable, days1, el, emptyState, firstRunNotice,
  fmtCount, fmtDate, glossaryTip, heroLines, heroStat, meter, num, pageHeader, pct1,
  pluralize, quadModel, quadTable, sectionLabel, skeletonStack, statRow, survivalTableModel,
  uiIcon,
} from "../ui.js";
import {
  boundedDays, chartCard, concentrationModel, figureCard, missingColumnsNote, movementCard,
  movementModel, oldestReposModel, pagedTable, pillFilterRow, registerFirstRunView,
  registerRowsTable, renderRegisterPage, sectionCard, statusSegment, textCell,
} from "./sca.js";
import { populationLine } from "./registerModel.js";

/**
 * The measurement note about the twin fold, as one string.
 *
 * ~187 keys in the live tenant span both a REPOSITORY and a REPOSITORY_BRANCH resource, with
 * a different `externalId` on each; the ledger keys on (secret, path, line) and keeps the
 * EARLIER of the two birth dates. Keying on externalId would look unique and quietly double
 * the register while misdating 135 of those 187 by a median of three weeks. The dev seed
 * folds about six. The number is not in the payload, so the note states the mechanism and
 * names the tenant figure as a measurement rather than printing it as a live count.
 *
 * IT IS A DATED, ONE-OFF MEASUREMENT — NOT A LIVE FIGURE THIS PAGE RECOMPUTES. The 187/135/
 * 19.9-day numbers came from one read of one tenant and stay fixed here whether or not this
 * scan's own population still spans that many twins; the fold itself IS applied fresh every
 * sync (`reconcile.ts`'s `foldSecretTwins`), only its own SIZE is not re-measured in THIS
 * sentence. The live size is now beside it — `twinFold` below carries this sync's own
 * `{keys, folded, medianGapDays}` — so the two are deliberately different kinds of statement:
 * a dated tenant measurement explaining the mechanism, and a figure off the last sync.
 *
 * WHAT THIS COMMENT USED TO CLAIM, AND WHY IT WAS WRONG. It said the fix was to ship "the
 * scan row's `twins` (`TwinStats`, already on the server — `ledgerStore.ts`)". There is no
 * such field on the scan row: `ScanRow` is eleven fields and `TAB_HEADERS[TABS.scans]` has no
 * twins column, so `writeGrid` would have dropped it even if reconcile's stats had been put
 * there; `ledgerStore`'s `twins` is on the transient `ScopeOutcome` and dies with the
 * request. The only durable copy is the per-sync history blob `scanJobs.ts`'s `dailyStats()`
 * writes, and that is what `readModels.ts`'s `latestSecretsTwins` now reads.
 *
 * STILL MISSING, unchanged by this: the PER-ROW audit trail CLAUDE.md's own entry on this
 * fold names (`twin_count` / `twin_first_seen_spread_days` on each row). `registerModel.js`'s
 * `twinCell` is already written for those and degrades to "absent" because nothing populates
 * them. Seeing WHICH row disagreed by 285 days is not what the register-wide aggregate below
 * answers.
 */
export const TWIN_NOTE =
  "One secret at one line is reported twice by Wiz — once against the repository and once "
  + "against a branch of it — with a different external id each time. The ledger keys on "
  + "(secret, path, line) and keeps the earlier of the two birth dates, so the two rows fold "
  + "into one finding with the older clock. Measured once, in this tenant, on a dated pass — "
  + "not recomputed on every sync: 187 keys spanned both forms, the branch copy carried the "
  + "earlier of the two birth dates in 135 of them, median gap 19.9 days. That fold is already "
  + "applied to every count on this page; only this sentence's own numbers are a snapshot.";

/**
 * This sync's own twin fold, in one line — or the words for a fold nobody reported.
 *
 * ABSENT IS NEVER ZERO, AND IT IS THE WHOLE POINT HERE. "0 twins folded" is a measurement:
 * it says this sync looked and found no credential reported against both a repository and a
 * branch. A payload with no `twins` block has made no such statement, and the two must not
 * print the same. Every field is refused BEFORE the cast (`num`), so a `keys` of `null`,
 * `""` or `[]` cannot become the confident zero `Number()` would hand back.
 *
 * The median gap is refused separately: `TwinStats.medianGapDays` is null whenever nothing
 * folded, so a fold of zero rows has a real count and no gap, and the line says exactly that.
 *
 * AND THE LINE SAYS WHEN IT WAS MEASURED, because a clock has to say where it started
 * (PRODUCT.md's seventh principle). The figure comes off the newest per-UTC-day history blob
 * — one file per day, latest write wins — so on a register nobody has synced since Tuesday
 * this is Tuesday's fold read on Friday. `asOf` is the day that file names, and it arrives as
 * its own payload field (`twinsAsOf`) rather than inside the stats, so the three fields the
 * absent-vs-measured decision keys on stay exactly the three fields of a `TwinStats`.
 *
 * A DATE THAT DID NOT ARRIVE IS NOT TODAY. Refused before any cast, like the counts: a
 * missing or unparseable day prints the fold WITHOUT one rather than dating it now, which
 * would be the same substitution as reading an absent fold as a zero, one field along.
 *
 * THE UNMEASURED LINE TAKES NO DATE, whatever is passed beside it — it makes no claim about
 * a measurement, so there is nothing to date.
 *
 * `fmtDate` IS THE APP'S OWN FORMATTER, not a hand-rolled slice. It renders in the display
 * zone, which is ahead of UTC, so a UTC day never reads back as the day before.
 *
 * @param {{keys?: *, folded?: *, medianGapDays?: *}|null|undefined} twins
 * @param {*} [asOf]  the blob's UTC day, `YYYY-MM-DD` — anything else is no date at all
 * @returns {{measured: boolean, keys: (number|null), folded: (number|null),
 *            medianGapDays: (number|null), asOf: (string|null), line: string}}
 */
export function twinFoldView(twins, asOf) {
  const t = twins && typeof twins === "object" && !Array.isArray(twins) ? twins : null;
  const keys = t ? num(t.keys) : null;
  const folded = t ? num(t.folded) : null;
  const gap = t ? num(t.medianGapDays) : null;
  const day = typeof asOf === "string" && asOf !== "" && !Number.isNaN(Date.parse(asOf))
    ? asOf
    : null;
  if (keys === null || folded === null) {
    return {
      measured: false,
      keys: null,
      folded: null,
      medianGapDays: null,
      asOf: null,
      line: "Twin fold: not measured on this sync",
    };
  }
  const gapText = gap === null ? "no birth-date gap recorded" : `median gap ${days1(gap)}`;
  const when = day === null ? "" : ` · measured ${fmtDate(day)}`;
  return {
    measured: true,
    keys,
    folded,
    medianGapDays: gap,
    asOf: day,
    line: `${fmtCount(folded)} ${pluralize(folded, "twin")} folded · ${gapText}${when}`,
  };
}

/**
 * The 2x2's four cells, named by the two independent axes rather than by a quality grade.
 *
 * REMOVED AND ROTATED ARE SEPARATE BOOLEANS on every cell, which is what stops the table
 * being read as a four-point scale. `removedNotRotated` is the corner the page leads with:
 * the string is gone, so the finding closes, and nobody has confirmed the credential is dead.
 */
export const REMOVAL_CELLS = [
  {
    id: "removedAndRotated",
    removed: true,
    rotated: true,
    label: "Removed and rotated",
    reading: "The string is out of HEAD and the credential was observed dead. The only clean corner.",
  },
  {
    id: "removedNotRotated",
    removed: true,
    rotated: false,
    label: "Removed, not rotated",
    reading: "The string left the code and nobody has confirmed the credential is dead. Still "
      + "readable in git history, and still working until somebody checks.",
  },
  {
    id: "rotatedNotRemoved",
    removed: false,
    rotated: true,
    label: "Rotated, not removed",
    reading: "The credential is dead but the string is still committed. Noise, not exposure.",
  },
  {
    id: "neither",
    removed: false,
    rotated: false,
    label: "Neither",
    reading: "Still in the code, still unconfirmed.",
  },
];

/**
 * The percentage the validation-coverage headline may fill to — or NULL, which draws no bar.
 *
 * THE `Number(null)` TRAP WEARING A METER, for the fourth time in this repository. The call
 * this replaces read `meter(cov.coveragePct === null ? 0 : cov.coveragePct)`: a coverage
 * nobody computed drew an EMPTY TRACK, which is a picture asserting that nothing in this
 * register has ever been validated rather than that nobody could tell. `ui/data.js`'s
 * `meter(value)` opens with `Number(value) || 0`, so the null had to be turned into a decision
 * somewhere, and the old ternary made it the wrong one.
 *
 * A MEASURED ZERO STILL GETS ITS METER, empty: 0 of 61 validated is a measurement and an empty
 * track is its picture. Only an absence gets nothing.
 *
 * @param {{coveragePct?: *}|null|undefined} cov  a `secretsModel().validationCoverage`
 * @returns {number|null}
 */
export function coverageMeterPct(cov) {
  return cov ? num(cov.coveragePct) : null;
}

/**
 * A segment row's validated SHARE, for the bar beside its count — or NULL for no bar.
 *
 * Refused twice before any cast: a row whose total is missing or zero has no share to take
 * (`0/0` is not `0%`), and a row whose measured count is unreadable has nothing to take one
 * of. `num()` does the refusing, so a `total` of `null`, `""` or `[]` cannot arrive here as
 * the finite zero `Number()` would hand back and turn a missing denominator into a full bar
 * or a division by zero.
 *
 * @param {{total?: *, measured?: *}|null|undefined} row  a segment row
 * @returns {number|null}
 */
export function segmentValidatedPct(row) {
  const total = row ? num(row.total) : null;
  const measured = row ? num(row.measured) : null;
  if (total === null || total === 0 || measured === null) return null;
  return (measured / total) * 100;
}

/**
 * Which corner is an alarm, which is clean, and which is neither — as data.
 *
 * TONE IS THE THIRD CUE AND NEVER THE FIRST: `quadModel` REFUSES a toned corner with no
 * label, so every entry here is paired with `REMOVAL_CELLS`'s own two-to-four-word reading.
 * "warn" rather than "bad" on the alarm corner because the page already has one word and one
 * colour for this state — `alarmChip()`'s `pill warn` — and a second, louder one for the
 * same fact would be two vocabularies for one corner.
 */
const REMOVAL_TONES = {
  removedAndRotated: "ok",
  removedNotRotated: "warn",
  rotatedNotRemoved: "neutral",
  neither: "neutral",
};

/**
 * The removal/rotation cross as a `quadModel` — the 2x2 that used to be a five-column table.
 *
 * WHAT IT REPLACES. Five columns — Corner, String out of HEAD (Yes/No), Credential confirmed
 * dead (Yes/No), Findings, Reading — and four rows, one of them carrying a 24-word sentence
 * in a `wrap: true` cell. That is a cross drawn as prose: the reader rebuilds the 2x2 in
 * their head from four rows, the two axis names are restated eight times, and the corner the
 * page LEADS with (removed, not rotated) has no more visual weight than "Neither". Drawn as a
 * cross it is read in a glance, the axis words are announced once per axis by `<th scope>`,
 * and each Reading rides on its own corner's label as a tip.
 *
 * `alarmFor` IS INJECTED RATHER THAN CALLED HERE, and that is what keeps this half pure:
 * `alarmChip()` builds a DOM node and this project's vitest has no jsdom, so a model that
 * built its own chip could not be tested at all. The default hands back nothing, which is
 * also the honest shape — whether a corner is an ALARM is the page's claim about its own
 * population, and `quadTable` appends the caller's chip untouched.
 *
 * The shares are read against `total` — the register — not against the sum of the four
 * corners. Here the two are the same number (every finding lands in exactly one corner) and
 * `quadModel` still takes the stated total, because the day a corner stops being computed
 * the shares must fall short of 100% rather than quietly renormalising.
 *
 * @param {object} vm  a `secretsModel` result
 * @param {(id: string) => *} [alarmFor]  the caller's chip node for a corner id, or null
 */
export function removalQuadModel(vm, alarmFor = () => null) {
  const rvr = (vm && vm.removalVsRotation) || {};
  return quadModel({
    rows: { label: "String out of HEAD", yes: "Out of HEAD", no: "Still in HEAD" },
    cols: { label: "Credential confirmed dead", yes: "Confirmed dead", no: "Not confirmed" },
    cells: (rvr.cells || []).map((c) => ({
      row: !!c.removed,
      col: !!c.rotated,
      count: c.count,
      label: c.label,
      tone: REMOVAL_TONES[c.id] || "neutral",
      alarm: alarmFor(c.id),
      help: { lines: [c.reading] },
    })),
    total: rvr.total,
    unit: "secrets",
  });
}

// =========================================================================================
//  The view model
// =========================================================================================

/**
 * The whole page as data. Pure — see `scaModel`'s note on why the testable half is this half.
 *
 * `payload` is `{register, secrets}`: the register half has had `segments` deleted by the
 * server (both models build it and they disagree — `buildRegister` filters by the caller's
 * severities and `buildSecrets` ignores them, and the one that ignores them is the register),
 * so the segment tables come from the secrets half. Nothing in this model carries a severity
 * axis, a severity count or a severity key.
 */
export function secretsModel(payload, opts) {
  const p = payload || {};
  const reg = p.register || {};
  const sec = p.secrets || {};
  const cov = sec.coverage || {};
  const validity = sec.validity || {};
  const ttr = sec.timeToRevoke || {};
  const rvr = sec.removalVsRotation || {};
  const segments = sec.segments || {};

  const total = num(cov.total, num(sec.rowCount, num(reg.rowCount)));
  const median = boundedDays(ttr.median, ttr.medianLowerBound);
  const firstRun = registerFirstRunView(
    sec.rowCount !== undefined ? sec.rowCount : reg.rowCount,
    opts && opts.synced,
    opts && opts.at,
  );

  const vm = {
    scope: "secrets",
    firstRun,
    asOf: reg.asOf ?? sec.asOf ?? null,
    rowCount: num(sec.rowCount, num(reg.rowCount)),
    open: num(sec.open, num(reg.open)),

    // WHAT THE FIGURES ABOVE WERE MEASURED OVER — the in-scope count, the gate the last scan
    // of THIS scope applied, and the base filters the secrets query carries. Passed straight through:
    // `populationLine` (registerModel.js) is the one place that decides how it reads, so all
    // three registers cannot disagree about it. Null on a payload written before the block
    // existed, and the page draws nothing rather than half a sentence.
    population: reg.population ?? null,

    // THE HERO IS THE CORNER WHERE THE TWO AXES DISAGREE — suppressed to a dash on a first
    // run for the same reason sca.js's hero is: "0 secrets left the code" over a register
    // nobody has read is a confident claim about a corner nobody has looked at yet.
    hero: {
      label: "Removed, not rotated",
      value: firstRun.show ? absentText : fmtCount(rvr.removedNotRotated),
      sentence: firstRun.show
        ? "Nothing has been measured for this register yet."
        : `${fmtCount(rvr.removedNotRotated)} secrets left the code and nobody has `
          + "confirmed the credential is dead.",
      // THE SECOND HERO LINE, filled in below once the model it reads exists. The alarm above
      // is a corner of the removal/rotation table; this is the validity split the whole page
      // now leads with, so the two sit together rather than seven blocks apart. Null on a
      // first run: the line is not drawn at all there, rather than drawn full of dashes.
      validitySentence: null,
      denominator:
        `${fmtCount(rvr.removedNotRotated)} of ${fmtCount(rvr.total)} secret findings have a `
        + "removal date and no rotation date. The credential is live until a validation says "
        + "otherwise, and the old commit stays readable either way.",
    },

    // TWO INDEPENDENT AXES. Each cell states both booleans, so nothing can collapse the
    // table into a single "cleanliness" ranking.
    removalVsRotation: {
      axes: {
        removed: {
          label: "Removed",
          glossary: "removed",
          yes: num(rvr.removedAndRotated) + num(rvr.removedNotRotated),
          no: num(rvr.rotatedNotRemoved) + num(rvr.neither),
          meaning: "the string left the repository's HEAD",
        },
        rotated: {
          label: "Rotated",
          glossary: "rotated",
          yes: num(rvr.removedAndRotated) + num(rvr.rotatedNotRemoved),
          no: num(rvr.removedNotRotated) + num(rvr.neither),
          meaning: "the credential was observed dead",
        },
      },
      cells: REMOVAL_CELLS.map((c) => ({ ...c, count: num(rvr[c.id]) })),
      total: num(rvr.total),
      denominator:
        `${fmtCount(rvr.total)} secret findings, each landing in exactly one of the four `
        + "corners. Removal and rotation are separate columns in the ledger because they are "
        + "separate events; neither implies the other.",
    },

    // THE DENOMINATOR IS THE SENTENCE. ~99.6% of secret instances in this tenant were never
    // validated, and UNKNOWN / ERROR mean UNMEASURED — which is neither live nor dead.
    validationCoverage: {
      measured: num(cov.measured),
      unmeasured: num(cov.unmeasured),
      total,
      coveragePct: cov.coveragePct === null || cov.coveragePct === undefined
        ? null
        : num(cov.coveragePct, null),
      glossary: "validation-state",
      denominator:
        `${fmtCount(cov.measured)} of ${fmtCount(total)} secret findings have ever been `
        + `validated (${pct1(cov.coveragePct)}). The other ${fmtCount(cov.unmeasured)} read `
        + "UNKNOWN or ERROR, which means nobody checked — not that the credential is dead, "
        + "and not that it is alive. Every figure below rests on this denominator.",
    },

    postDetectionValidity: {
      valid: num(validity.valid),
      invalid: num(validity.invalid),
      measured: num(validity.measured),
      ratePct: validity.ratePct === null || validity.ratePct === undefined
        ? null
        : num(validity.ratePct, null),
      denominator:
        `${fmtCount(validity.valid)} of ${fmtCount(validity.measured)} CHECKED credentials `
        + "still work. Unchecked rows are not in this denominator: they would drag the rate "
        + "toward zero while representing no evidence either way.",
    },

    timeToRevoke: {
      medianText: median.text,
      medianIsLowerBound: median.bounded,
      // The number the curve's marker is plotted at, kept beside the text so nothing has to
      // parse a formatted string back into a value. Null when there is no median to plot —
      // a lower bound is not a marker, it is the statement that the curve never got there.
      medianDays: median.bounded || ttr.median === null || ttr.median === undefined
        ? null
        : num(ttr.median, null),
      p90Text: days1(ttr.p90),
      withinSlaPct: ttr.withinSlaPct === null || ttr.withinSlaPct === undefined
        ? null
        : num(ttr.withinSlaPct, null),
      sla: num(ttr.sla, null),
      events: num(ttr.events),
      censored: num(ttr.censored),
      // PRINTED, ALWAYS. Never-validated rows are EXCLUDED, not censored — censoring
      // asserts "still alive at time c", which an unvalidated row cannot support.
      excludedUnmeasured: num(ttr.excludedUnmeasured),
      excludedNoClock: num(ttr.excludedNoClock),
      total: num(ttr.total),
      curve: (ttr.km && Array.isArray(ttr.km.curve)) ? ttr.km.curve : [],
      glossary: "time-to-revoke",
      denominator:
        `${fmtCount(ttr.events)} observed rotations and ${fmtCount(ttr.censored)} still-live `
        + `credentials right-censored at today build this estimate, out of ${fmtCount(ttr.total)} `
        + `rows. ${fmtCount(ttr.excludedUnmeasured)} were EXCLUDED, not censored, because `
        + "nobody ever validated them; a further " + fmtCount(ttr.excludedNoClock)
        + " were measured but carry no usable duration.",
      slaDenominator:
        `Share within SLA is over the ${fmtCount(ttr.events)} observed rotations only, against `
        + `a ${fmtCount(ttr.sla)}-day target.`,
    },

    // The three axes this register may be segmented by. "severity" is not among them and
    // `bySegment` throws on it — see the module header.
    segments: SEGMENT_AXES.map((axis) => ({
      axis: axis.id,
      label: axis.label,
      glossary: axis.glossary,
      rows: (segments[axis.id] || []).map((s) => ({
        segment: String(s.segment ?? "(none)"),
        total: num(s.total),
        open: num(s.open),
        measured: num(s.measured),
        valid: num(s.valid),
        invalid: num(s.invalid),
        rotated: num(s.rotated),
        removed: num(s.removed),
        removedNotRotated: num(s.removedNotRotated),
      })),
      denominator: axis.denominator,
    })),

    // Age buckets summed ACROSS the severity split the payload happens to carry. The split
    // itself is never read out: this page has no severity axis, and a bucket total is a
    // statement about age, which is what the question here actually is.
    aging: bucketTotals(reg.aging),
    oldestRepos: oldestReposModel(reg.oldest),
    concentration: concentrationModel(reg.concentration, ["repo", "secret_kind", "owner_project"]),
    movement: withoutRequestedSeverities(movementModel(reg.movement, reg.latestScan)),

    twinNote: TWIN_NOTE,
    // THE FOLD AS A FIGURE, and "not measured" when the wire does not carry it. `TWIN_NOTE`
    // above is 120 words of mechanism with three frozen tenant numbers in the middle of it,
    // and the `twin` glossary entry says the same three things in the book's own voice. What
    // the entry CANNOT say is what this sync's own fold did, so that is what the page prints
    // — one line, read off the payload, or the words for its absence.
    //
    // `sec.twins` IS THE PER-SYNC HISTORY BLOB'S OWN BLOCK, not a scan-row column: the scan
    // row has never carried one (`readModels.ts`'s `latestSecretsTwins` has the full trace,
    // and this comment claimed the opposite for a whole wave). The server REFUSES rather than
    // substituting — no blob, a sweep that skipped secrets, or a malformed block omits the
    // key — so an absence arrives here as `undefined` and `twinFoldView` says "not measured
    // on this sync", which is a different sentence from a measured "0 twins folded" and must
    // stay one.
    //
    // `twinsAsOf` IS A SIBLING FIELD, NOT PART OF THE BLOCK. The blob is per-UTC-day and
    // latest-write-wins, so a fold can be days old; the day it names rides beside the stats
    // so `twins` stays exactly the three fields of a `TwinStats`. A missing date prints the
    // fold undated rather than as of today.
    twinFold: twinFoldView(sec.twins, sec.twinsAsOf),
    resolvedNote:
      "A secret finding leaving this register means the string is out of HEAD. It does not "
      + "mean the credential is safe, and it does not mean the old commit is unreadable.",
    // "path and line" and "first seen per finding" are DROPPED from this list — both are in
    // `REGISTER_ROW_COLUMNS.secrets` (`file_path`, `start_line`, `first_seen`) and the
    // per-finding table below draws them. "first commit hash" stays: `LEDGER_COLUMNS` has no
    // commit column at all — SAST spells it `vcsDetails.commitHash` and secrets spells it
    // `vcsDetails.initialCommitHash`, and neither has ever been carried into the ledger, so
    // there is nowhere for this table to read it from. That gap is deliberately deferred, not
    // fixed here.
    missingColumns: missingColumnsNote(["first commit hash"]),
  };

  // Derived from the model rather than beside it: the sentence reads the same segment rows
  // the spine and the table below both read, so the three cannot drift into three answers.
  vm.hero.validitySentence = firstRun.show ? null : validitySentence(validityTriageView(vm));
  return vm;
}

// =========================================================================================
//  The validity spine
// =========================================================================================

/** The glossary entry all three validity figures point at. */
const VALIDITY_GLOSSARY = "validation-state";

/** The two validation states that constitute a MEASUREMENT — `secretsLifecycle.ts`'s set. */
export const VALIDITY_MEASURED_STATES = ["VALID", "INVALID"];

/** The `validation_state` segment axis, which the spine and the first table both read. */
const VALIDITY_AXIS = "validation_state";

/** The two axes drawn side by side directly under the spine, in this order. */
export const PAIRED_SEGMENT_AXES = [VALIDITY_AXIS, "confidence"];

/** A segment row's axis value, normalised the way the domain normalises the column. */
function segmentState(row) {
  return String((row && row.segment) ?? "").trim().toUpperCase();
}

/**
 * The four figures a reader of this register needs first, as data.
 *
 * PURE, AND OVER THE OPEN REGISTER. The first three read `open` off the `validation_state`
 * segment rows, which is the same table drawn immediately below — so they partition the
 * header strip's "Open" figure exactly, and a reader can add them up against the table
 * rather than having to trust a second computation. Reading them off `postDetectionValidity`
 * instead would fold resolved findings in and the three would stop summing to Open.
 *
 * "Unchecked" is EVERY state that is not VALID or INVALID — UNKNOWN, ERROR and the blank
 * `(none)` bucket alike — rather than a list of the two spellings this tenant happens to
 * return. A state nobody anticipated must land in "nobody checked", never quietly nowhere.
 *
 * NULL IS AN ANSWER. With no segment rows the three counts are `null`, not `0`: a register
 * whose validation axis was never computed has not measured zero live credentials. One
 * unreadable `open` cell makes its whole bucket null for the same reason — a partial sum
 * printed as a total is the confident-zero failure in a different costume.
 *
 * The fourth figure is the alarm and it is NOT a validity state: `removedNotRotated` is a
 * corner of the removal/rotation table, counted over the whole register (removal resolves a
 * finding, so a removed row is not in the open denominator the other three share). Its
 * denominator says so rather than letting the four look like one partition.
 */
export function validityTriageView(vm) {
  const v = vm || {};
  const axis = (v.segments || []).find((s) => s.axis === VALIDITY_AXIS);
  const rows = (axis && axis.rows) || [];
  const known = rows.length > 0;

  const openWhere = (pred) => {
    if (!known) return null;
    let sum = 0;
    for (const row of rows) {
      if (!pred(segmentState(row))) continue;
      const n = num(row.open);
      if (n === null) return null;
      sum += n;
    }
    return sum;
  };

  const open = num(v.open);
  const live = openWhere((s) => s === "VALID");
  const unchecked = openWhere((s) => !VALIDITY_MEASURED_STATES.includes(s));
  const dead = openWhere((s) => s === "INVALID");

  const rvr = v.removalVsRotation || {};
  const alarmCell = (rvr.cells || []).find((c) => c.id === "removedNotRotated");
  const alarm = alarmCell ? num(alarmCell.count) : null;
  const registerTotal = num(rvr.total);
  const ofOpen = (n) => `${fmtCount(n)} of ${fmtCount(open)} open`;
  // R3's SHORT FORM, and the reading it used to carry is now one level down rather than
  // twice on the page. Each `sub` used to read "3 of 41 open — the provider answered and the
  // credential worked": the denominator AND a clause restating what VALID means. That clause
  // is the opening of the card's own `denominator` sentence below, word for word in
  // substance, and `figureCard` prepends that sentence to the label's tip lines — so the
  // reading was printed twice, once under the figure and once behind its trigger. The sub is
  // the denominator alone now; the tip still LEADS with the sentence.
  const shortOpen = (n) => `${ofOpen(n)} ${pluralize(open, "finding")}`;

  return {
    known,
    open,
    registerTotal,
    figures: [
      {
        id: "live",
        label: "Confirmed live",
        count: live,
        alarm: false,
        glossary: VALIDITY_GLOSSARY,
        sub: shortOpen(live),
        denominator:
          `${ofOpen(live)} findings read VALID: somebody asked the provider and the `
          + "credential answered. The only rows this register can prove are still dangerous, "
          + "and the ones a rotation queue is built from.",
      },
      {
        id: "unchecked",
        label: "Unchecked",
        count: unchecked,
        alarm: false,
        glossary: VALIDITY_GLOSSARY,
        sub: shortOpen(unchecked),
        denominator:
          `${ofOpen(unchecked)} findings read UNKNOWN, ERROR or nothing at all — neither `
          + "live nor dead, and the state most of this register is in. An unchecked "
          + "credential is excluded from the revocation clock below, not counted as dead.",
      },
      {
        id: "dead",
        label: "Confirmed dead",
        count: dead,
        alarm: false,
        glossary: VALIDITY_GLOSSARY,
        sub: shortOpen(dead),
        denominator:
          `${ofOpen(dead)} findings read INVALID: the credential was observed dead. They are `
          + "still open because the string is still in HEAD, which is a separate event with "
          + "its own date.",
      },
      {
        id: "removedNotRotated",
        label: "Removed, not rotated",
        count: alarm,
        alarm: true,
        glossary: "removed",
        sub: `${fmtCount(alarm)} of ${fmtCount(registerTotal)} in the register`,
        denominator:
          `${fmtCount(alarm)} of ${fmtCount(registerTotal)} secret findings have a removal `
          + "date and no rotation date. Counted over the whole register, not the open rows "
          + "the three figures beside it share, because removing the string is what resolves "
          + "the finding — and the credential is live until a validation says otherwise.",
      },
    ],
  };
}

/**
 * The hero's second line: the validity split in one sentence, with its open denominator.
 *
 * Every count goes through `fmtCount`, so a register whose validation axis was never computed
 * says "—" three times rather than claiming three zeros.
 */
export function validitySentence(triage) {
  const at = (id) => (triage.figures.find((f) => f.id === id) || {}).count;
  return `Of ${fmtCount(triage.open)} open findings, ${fmtCount(at("live"))} credentials `
    + `still work, ${fmtCount(at("unchecked"))} nobody has checked and `
    + `${fmtCount(at("dead"))} are confirmed dead.`;
}

const SEGMENT_AXES = [
  {
    id: "validation_state",
    label: "By validation state",
    glossary: "validation-state",
    denominator:
      "VALID and INVALID are measurements; UNKNOWN and ERROR mean nobody checked. Each row "
      + "carries its own total and its own measured count, because 400 rows with 2 checks and "
      + "400 rows with 400 checks are different claims that a rotation count cannot separate.",
  },
  {
    id: "confidence",
    label: "By detector confidence",
    glossary: "validation-state",
    denominator:
      "How sure the detector is that the matched string is a credential at all. This and the "
      + "validation state are this register's volume controls; severity is not one of them.",
  },
  {
    id: "secret_kind",
    label: "By secret kind",
    glossary: "secret-resolved",
    denominator:
      "The kind of credential, which is what rotation is actually organised by. Detector "
      + "confidence and validation state qualify each row; nothing here is graded by severity.",
  },
];

/**
 * Drop the freshness caption's "severities requested" clause, which is meaningless here.
 *
 * NOT COSMETIC, AND NOT ABOUT THE KEY'S NAME. On every other register that clause is real
 * information: a sync that asked for CRITICAL and HIGH has not looked at a MEDIUM, and a
 * reader told only WHEN it ran cannot tell that from a sync that looked at everything. On
 * this scope the gate is OFF — `DEFAULT_FETCH_SEVERITIES.secrets` is empty and empty means
 * all — so the column is null by construction and a caption drawing it could only ever
 * imply a narrowing that never happened. `test/pagesRegisters.test.js` caught it reaching
 * this model, which is the second time the shared movement block has had to be told that
 * this register is not the other two.
 */
function withoutRequestedSeverities(m) {
  const out = { ...m };
  delete out.scanSeverities;
  return out;
}

/**
 * Age buckets as plain totals.
 *
 * `ageBuckets` returns a per-severity matrix. This page reads the COLUMN SUMS and discards
 * the split — deliberately, and not as a convenience: naming a severity anywhere on this
 * page would be the register asserting that a detection grade says something about whether
 * a credential is live.
 */
export function bucketTotals(aging) {
  const a = aging || {};
  const matrix = a.perSev || {};
  const labels = ["0-7d", "8-30d", "31-90d", "90+d"];
  const buckets = labels.map((label, i) => ({
    label,
    total: Object.values(matrix).reduce((sum, arr) => sum + num((arr || [])[i]), 0),
  }));
  return {
    labels,
    buckets,
    totalOpen: num(a.totalOpen),
    denominator:
      `${fmtCount(a.totalOpen)} open secret findings carry a readable age and are bucketed `
      + "here; any open row with no first-seen date is outside this table.",
  };
}

// =========================================================================================
//  The page
// =========================================================================================

/**
 * The four credential states this register can be filtered by, and the words they get.
 *
 * The VALUES are the ledger's (`domain/secretsLifecycle.ts`: VALID and INVALID are the two
 * that constitute a measurement; UNKNOWN and ERROR are both "nobody knows"), the LABELS are
 * what a reader is entitled to see — "Never checked" rather than UNKNOWN, because a blank
 * validation state is the register's normal condition and not an error, and "Check failed"
 * rather than ERROR, because the difference between the two is who failed.
 */
/**
 * Worst first, the way every other graded list in this app is ordered — and only a SORT.
 * The grades offered are still whatever the register returned; this decides where each one
 * sits, and an unrecognised grade keeps its measured place at the end rather than being
 * dropped. `SecretInstanceConfidence` is the tenant's vocabulary, so a name not on this
 * ladder is a grade this app has not met, not an error.
 */
const CONFIDENCE_ORDER = ["HIGH", "MEDIUM", "LOW"];

export const CREDENTIAL_FILTER_OPTIONS = [
  { value: "VALID", label: "Live" },
  { value: "INVALID", label: "Dead" },
  { value: "UNKNOWN", label: "Never checked" },
  { value: "ERROR", label: "Check failed" },
];

/**
 * The three filters this page carries in the hash, normalised.
 *
 * IN THE URL, so a narrowed register is a link somebody can send — the same rule
 * `readRegisterParams` follows for the other two registers. All three narrow the per-finding
 * table only: `api_getSecretsPage`'s aggregates are computed over the whole register and are
 * not refetched, which is why the toolbar says "Findings table" above the controls.
 */
export function readSecretsParams(params) {
  const p = params || {};
  const status = String(p.status || "").toLowerCase();
  return {
    status: status === "open" || status === "resolved" ? status : "",
    validation: listSplit(p.validation).map((v) => v.trim().toUpperCase()).filter(Boolean),
    confidence: listSplit(p.confidence).map((v) => v.trim().toUpperCase()).filter(Boolean),
  };
}

/** Membership toggled in a list, kept in the order the options are offered. */
function toggledIn(list, value, order) {
  const on = new Set(list);
  if (on.has(value)) on.delete(value);
  else on.add(value);
  return order.filter((v) => on.has(v));
}

/**
 * The toolbar this register never had.
 *
 * NO SEVERITY CONTROL, and there is nothing to add one from: `DEFAULT_FETCH_SEVERITIES` is
 * empty for this scope, `secretsModel` ignores severities outright and `registerRowsModel`
 * refuses them. What a reader triages on here is whether the credential is LIVE and how
 * confident the detector was, so those are the two axes — the same two `bySegment` publishes.
 *
 * THE CONFIDENCE VALUES ARE MEASURED, NOT LISTED. They come off the confidence segment rows
 * this page already draws, so the pills offer exactly the grades this tenant returned; a
 * hard-coded HIGH/MEDIUM/LOW would be a second vocabulary free to disagree with the table
 * below it, and would offer a filter for a grade nobody has.
 */
function secretsToolbar(vm, filters) {
  const bar = el("div", { class: "toolbar" });
  const onChange = (patch) => navigate("secrets", {
    status: filters.status,
    validation: listJoin(filters.validation),
    confidence: listJoin(filters.confidence),
    ...patch,
  });

  bar.append(statusSegment(filters.status, onChange));

  const stateOrder = CREDENTIAL_FILTER_OPTIONS.map((o) => o.value);
  bar.append(pillFilterRow({
    label: "Credential",
    options: CREDENTIAL_FILTER_OPTIONS,
    selected: filters.validation,
    ariaLabel: "Findings table: credential state",
    onToggle: (v) => onChange({ validation: listJoin(toggledIn(filters.validation, v, stateOrder)) }),
  }));

  const axis = (vm.segments || []).find((s) => s.axis === "confidence");
  // MEASURED SET, IMPOSED ORDER. Which grades exist is the tenant's answer and is read off
  // the page's own segment rows — a hard-coded list would offer a filter for a grade nobody
  // has. The ORDER is not the tenant's: the segment table is sorted by row count, so the
  // pills came out MEDIUM, HIGH, LOW, which reads as a ranking and is not one. Anything the
  // ladder does not name keeps its measured position, after the ones it does.
  const grades = (axis && axis.rows ? axis.rows : [])
    .map((r) => String(r.segment || "").toUpperCase())
    .filter((v) => v && v !== "(NONE)")
    .sort((a, b) => {
      const rank = (g) => {
        const i = CONFIDENCE_ORDER.indexOf(g);
        return i === -1 ? CONFIDENCE_ORDER.length : i;
      };
      return rank(a) - rank(b);
    });
  if (grades.length) {
    bar.append(pillFilterRow({
      label: "Confidence",
      options: grades,
      selected: filters.confidence,
      ariaLabel: "Findings table: detector confidence",
      onToggle: (v) => onChange({ confidence: listJoin(toggledIn(filters.confidence, v, grades)) }),
    }));
  }
  return bar;
}

/** Credentials in the repository — a lifecycle of its own. */
export function renderSecrets(host, params) {
  const boot = bootstrapCached();
  const synced = !!(boot && boot.latestSync);
  const at = boot && boot.latestSync ? boot.latestSync.ts : null;
  const filters = readSecretsParams(params);

  return renderRegisterPage(host, {
    skeleton: () => skeletonStack(6, { widths: ["70%", "100%", "90%", "100%", "80%", "60%"] }),
    // NO SEVERITIES PARAMETER. `secretsModel` ignores it and its cache key omits it, so
    // sending one would mint an argument that changes nothing and imply a filter that does
    // not exist. `showNoFix` is likewise omitted: it cannot bite on a non-dependency row.
    // The three toolbar filters are not sent here either — they narrow the per-finding table
    // and nothing else, so they ride on `api_getRegisterRows` alone.
    fetch: () => swrCall("api_getSecretsPage", {}),
    paint: (payload) => paintSecrets(host, secretsModel(payload, { synced, at }), filters),
  });
}

function paintSecrets(host, vm, filters) {
  // Same rule as `paintSca`: the toolbar below rewrites this route's own query params, and
  // the shared sheet closes itself only on a change of route NAME — so a filter change would
  // repaint the page under a finding sheet still wired to the previous fetch's rows.
  closeActiveSheet();

  host.append(pageHeader({
    route: "secrets",
    hero: heroStat(
      // `vm.hero.label` — "Removed, not rotated" — is what this figure actually is, and the
      // model has carried the string since the page was written while the call site passed
      // the lane instead. The lane is the header's eyebrow now, so the metric gets its own
      // name back, and "secret-resolved" defines THAT rather than the register.
      vm.hero.label,
      vm.hero.value,
      // TWO LINES, and the order is the argument: the alarm the figure counts, then the
      // validity split it sits inside. On a first run `validitySentence` is null and the
      // hero falls back to the one line, so the empty state is unchanged.
      vm.hero.validitySentence
        ? heroLines(vm.hero.sentence, vm.hero.validitySentence)
        : vm.hero.sentence,
      // THE DENOMINATOR IS ON THE LABEL NOW, not in a paragraph under the header.
      // `vm.hero.denominator` was printed as a `denomNote` two blocks below this call, a
      // 40-word sentence between the toolbar and the validity spine; the figure it explains
      // is in the 2rem slot above it and the trigger is on that figure's own name. The
      // second line is the register's definition — what a secret finding IS here — which was
      // the aside's first paragraph and said, in its own second half, exactly what
      // `vm.resolvedNote` beside it says. One of the two was a duplicate; this is the half
      // that is a definition, so it went where definitions go.
      {
        term: "secret-resolved",
        lines: [
          vm.hero.denominator,
          "Credentials committed to source. Removing one is not the same as fixing it: the"
          + " string leaving HEAD closes the finding, and the credential stays live until it"
          + " is rotated.",
        ],
      },
    ),
    // ONE PARAGRAPH, AND IT IS THE HONESTY STATEMENT. `resolvedNote` — "leaving this
    // register means the string is out of HEAD… it does not mean the credential is safe" —
    // is the page's whole thesis and R2's KEEP case, so it stays on the surface in words.
    aside: el("div", { class: "page-strip" },
      el("p", { class: "small muted" }, vm.resolvedNote),
    ),
    // SUPPRESSED, not dashed — see sca.js's paintSca for the same convention.
    stats: vm.firstRun.show ? [] : [
      statRow("In register", fmtCount(vm.rowCount), "findings, open and resolved"),
      statRow("Open", fmtCount(vm.open), "string still in HEAD"),
      statRow(
        "Ever validated",
        fmtCount(vm.validationCoverage.measured),
        pct1(vm.validationCoverage.coveragePct) + " of the register",
      ),
    ],
  }));

  // WHAT THIS PAGE MEASURED, AND WHAT IT NEVER LOOKED AT — one quiet line under the hero.
  // Provenance, not a figure: the in-scope count, the severity gate the last scan of this
  // register APPLIED, the base filters its query carries, and, where a gate was applied, the
  // fact that what fell below it was never counted rather than counted as none.
  //
  // WITHHELD ON A FIRST RUN, on the same rule as the stat row above it: "In scope 0" over a
  // register nobody has read is one more confident zero, and `firstRunNotice` below already
  // says what is missing.
  const population = vm.firstRun.show ? null : populationLine(vm);
  if (population) host.append(el("p", { class: "small muted" }, population.text));

  // FIRST RUN STOPS HERE — see sca.js's paintSca for why every section past this point would
  // otherwise print its own confident "0", including the removed-vs-rotated four-corner table
  // and the revocation survival chart.
  if (vm.firstRun.show) {
    host.append(firstRunNotice({
      synced: vm.firstRun.synced,
      at: vm.firstRun.at,
      hint: "Secrets arrive with the first sync that saves a row for this register; enable "
        + "it under Settings → Register if it is off.",
    }));
    return;
  }

  // THE TOOLBAR SITS DIRECTLY AFTER THE FIRST-RUN RETURN, before the validity spine — a
  // control over a register nobody has read yet would be three filters against zero rows.
  // `test/secretsTriage.test.js` pins the spine as the first thing under the hero among the
  // BLOCKS that draw figures; this is chrome above them, not a block.
  host.append(secretsToolbar(vm, filters));

  // ------------------------------------------------------------------ the validity spine
  // FIRST, BEFORE THE FOUR CORNERS AND THE CURVE. Whether the credential is live is the
  // question every one of this page's other blocks is read against, so it is the first thing
  // under the hero rather than the sixth block down. `test/secretsTriage.test.js` pins that
  // order in the source text.
  const triage = validityTriageView(vm);
  host.append(el("div", { class: "kpi-row" },
    ...triage.figures.map((f) => figureCard({
      label: f.label,
      value: fmtCount(f.count),
      sub: f.sub,
      help: { term: f.glossary },
      denominator: f.denominator,
      // COLOUR IS NEVER THE ONLY CUE. The alarm card carries a glyph and the word beside it;
      // the tint is the third signal, not the first, and no severity mark is available here
      // by construction — this page has none.
      chip: f.alarm ? alarmChip() : null,
    })),
  ));

  // ------------------------------------------------- validity x confidence, side by side
  //
  // THE 60-WORD LEDE IS A HEADING AND ONE CLAUSE. What it said was two things: what the two
  // axes MEAN (a definition, so it is on the heading, one level down behind the trigger) and
  // that there is NO JOINT COUNT — which is a refusal to measure, R2's KEEP case, so it
  // stays on the surface in the words a reader can act on. A cross-tab multiplied out of two
  // sets of marginals would be a fabrication, and a page that only whispered that behind a
  // tip would be inviting the reader to do the multiplication themselves.
  host.append(sectionLabel("Validity and confidence", {
    term: "validation-state",
    lines: [
      "The validation state says whether anybody asked the provider; the detector confidence"
      + " says how sure the scanner was that the matched string is a credential at all.",
      "The two are counted on separate axes, so a cross-tab would have to be multiplied out"
      + " of two sets of totals — which is a fabrication, not a measurement.",
    ],
  }));
  host.append(el("p", { class: "small muted" },
    "Two axes, counted separately — no joint count."));
  const paired = PAIRED_SEGMENT_AXES
    .map((axis) => vm.segments.find((s) => s.axis === axis))
    .filter(Boolean);
  if (paired.length) host.append(el("div", { class: "card-pair" }, ...paired.map(segmentCard)));

  // ------------------------------------------------------------ removed is not rotated
  //
  // THE LEDE AND THE DENOMINATOR ARE BOTH ON THE HEADING. The 40-word lede said what the two
  // axes are and that neither implies the other — a definition of the cross, which is what
  // the cross itself now draws with its own `<th>` axes. The 36-word `denomNote` under the
  // table said what the four corners are counted over. Both are lines on the section's own
  // label; the two axis cards below keep their denominators through `figureCard`, so the
  // sentence a reader can be SHOWN is still written into `data-denominator` on this page.
  host.append(sectionCard("Removed is not rotated", {
    term: "removed",
    lines: [
      vm.removalVsRotation.denominator,
      "Two independent events, so two axes: a row is removed when the string leaves HEAD and"
      + " rotated when the credential is observed dead. Neither implies the other, and the"
      + " corner where they disagree is the one this page leads with.",
    ],
  },
    quadTable(
      removalQuadModel(vm, (id) => (id === "removedNotRotated" ? alarmChip() : null)),
      { ariaLabel: "Removed against rotated, over every secret finding" },
    ),
    el("div", { class: "kpi-row" },
      figureCard({
        label: vm.removalVsRotation.axes.removed.label,
        value: fmtCount(vm.removalVsRotation.axes.removed.yes),
        sub: vm.removalVsRotation.axes.removed.meaning,
        help: { term: vm.removalVsRotation.axes.removed.glossary },
        denominator:
          `${fmtCount(vm.removalVsRotation.axes.removed.yes)} of `
          + `${fmtCount(vm.removalVsRotation.total)} findings, counted on the removal axis `
          + "alone — independently of whether anything was rotated.",
      }),
      figureCard({
        label: vm.removalVsRotation.axes.rotated.label,
        value: fmtCount(vm.removalVsRotation.axes.rotated.yes),
        sub: vm.removalVsRotation.axes.rotated.meaning,
        help: { term: vm.removalVsRotation.axes.rotated.glossary },
        denominator:
          `${fmtCount(vm.removalVsRotation.axes.rotated.yes)} of `
          + `${fmtCount(vm.removalVsRotation.total)} findings, counted on the rotation axis `
          + "alone — independently of whether anything was removed.",
      }),
    ),
  ));

  // --------------------------------------------------------------- has anybody looked?
  //
  // THE DENOMINATOR WAS PRINTED TWICE — as a full paragraph opening the section, and again
  // through the "Validated" card's own `denominator`, which `figureCard` puts on that card's
  // label and into `data-denominator`. One of the two had to go and it is the paragraph: the
  // sentence is the section's method, so it is on the section's own heading.
  //
  // THE METER IS THE HEADLINE NOW, not a bar trailing three cards. The section asks one
  // question — has anybody looked — and the share that answers it was the last thing on
  // screen, under the three figures it qualifies.
  host.append(sectionCard("Has anybody looked?", {
    term: "validation-state",
    lines: [vm.validationCoverage.denominator],
  },
    coverageHeadline(vm.validationCoverage),
    el("div", { class: "kpi-row" },
      figureCard({
        label: "Validated",
        value: fmtCount(vm.validationCoverage.measured),
        sub: pct1(vm.validationCoverage.coveragePct) + " of the register",
        denominator: vm.validationCoverage.denominator,
      }),
      figureCard({
        label: "Never checked",
        value: fmtCount(vm.validationCoverage.unmeasured),
        sub: "UNKNOWN or ERROR — neither live nor dead",
        denominator:
          `${fmtCount(vm.validationCoverage.unmeasured)} of `
          + `${fmtCount(vm.validationCoverage.total)} findings were never validated. These are `
          + "excluded from the revocation clock rather than counted as still-open exposure.",
      }),
      figureCard({
        label: "Still works",
        value: vm.postDetectionValidity.measured
          ? pct1(vm.postDetectionValidity.ratePct)
          : "Not measured",
        sub: `${fmtCount(vm.postDetectionValidity.valid)} valid of `
          + `${fmtCount(vm.postDetectionValidity.measured)} checked`,
        denominator: vm.postDetectionValidity.denominator,
      }),
    ),
  ));

  // ------------------------------------------------------------------- time to revoke
  // THE 43-WORD LEDE IS THE HEADING'S DEFINITION. What the clock measures FROM and TO, and
  // why an unchecked credential is outside it, is what "time to revoke" MEANS here. The
  // excluded count itself does not move: it is the fourth card, in words, with its own
  // figure — an exclusion is R2's KEEP case and never becomes a hover.
  host.append(sectionCard("Time to revoke", {
    term: "time-to-revoke",
    lines: [
      "Detection to confirmed-invalid, with still-live credentials right-censored at today.",
      "A credential nobody ever checked supports no claim in either direction, so it is"
      + " excluded from this estimate rather than censored inside it.",
    ],
  },
    el("div", { class: "kpi-row" },
      figureCard({
        label: "Median",
        value: vm.timeToRevoke.medianText,
        sub: vm.timeToRevoke.medianIsLowerBound
          ? "a lower bound: the curve never reaches half"
          : "half of rotations happened within this",
        help: { term: "censoring" },
        denominator: vm.timeToRevoke.denominator,
      }),
      // ONE SENTENCE, ONE CARD. This card used to carry the SAME `denominator` string as
      // "Median" beside it — the same 60-word accounting of events, censored rows and the
      // two exclusions, written into two `data-denominator` attributes a column apart. It is
      // one estimate read at two points, so the accounting is stated once, on the first
      // card, and this one routes to the term that defines what a censored estimate is.
      figureCard({
        label: "P90",
        value: vm.timeToRevoke.p90Text,
        sub: "nine in ten rotations within this",
        help: { term: "censoring" },
      }),
      figureCard({
        label: "Within SLA",
        value: vm.timeToRevoke.events ? pct1(vm.timeToRevoke.withinSlaPct) : "Not measured",
        sub: `${fmtCount(vm.timeToRevoke.sla)}-day revocation target`,
        help: { term: "sla-target" },
        denominator: vm.timeToRevoke.slaDenominator,
      }),
      figureCard({
        label: "Excluded, unmeasured",
        value: fmtCount(vm.timeToRevoke.excludedUnmeasured),
        sub: "never validated — excluded, not censored",
        denominator:
          `${fmtCount(vm.timeToRevoke.excludedUnmeasured)} of `
          + `${fmtCount(vm.timeToRevoke.total)} rows are outside this estimate entirely. `
          + "Censoring asserts the credential was still alive at the cut-off, which is "
          + "exactly what an unvalidated row cannot support.",
      }),
    ),
    vm.timeToRevoke.curve.length
      ? chartCard(
        "Survival of a committed credential",
        "Share of detected credentials still un-rotated, by weeks since detection.",
        (api, canvas) => api.survivalCurve(
          canvas,
          vm.timeToRevoke.curve,
          { median: vm.timeToRevoke.medianDays },
        ),
        {
          caption: "Every step of the curve above: weeks and days since detection, the share"
            + " of credentials still un-rotated after that step, the risk set behind it, and"
            + " how many were rotated at that time.",
          model: survivalTableModel(vm.timeToRevoke.curve),
        },
      )
      : emptyState(
        "No revocation curve yet.",
        "A curve needs at least one observed rotation. "
        + `${fmtCount(vm.timeToRevoke.events)} have been observed so far.`,
      ),
  ));

  // ---------------------------------------------------------------------- segments
  // Only the axes not already drawn in the pair above — `secret_kind`, which is a breakdown
  // rather than a triage question and belongs beside the other breakdowns.
  for (const seg of vm.segments) {
    if (PAIRED_SEGMENT_AXES.includes(seg.axis)) continue;
    host.append(segmentCard(seg));
  }

  // ------------------------------------------------------------------------ exposure
  host.append(sectionCard("How long the exposure has run", {
    lines: [vm.aging.denominator],
  },
    el("div", { class: "table-host" }, dataTable({
      columns: [
        { key: "label", label: "Open for", cell: (r) => r.label },
        { key: "total", label: "Findings", className: "num", cell: (r) => fmtCount(r.total) },
        {
          key: "share",
          label: "Share of open",
          cell: (r) => meter(vm.aging.totalOpen ? (r.total / vm.aging.totalOpen) * 100 : 0, {
            className: "meter--stat",
            label: `${r.label}, ${
              pct1(vm.aging.totalOpen ? (r.total / vm.aging.totalOpen) * 100 : null)}`,
          }),
        },
      ],
      rows: vm.aging.buckets,
      emptyText: "Nothing open.",
    })),
    // KEPT ON THE SURFACE, and it is the only sentence in this section that is not method:
    // the window a reader is being shown runs to ROTATION, and a removed secret is still
    // exposed. The denominator that used to sit above it is on the heading now.
    el("p", { class: "small muted" },
      glossaryTip("The exposure window runs to rotation, not to removal", "rotated"),
      " — a removed secret is still exposed for as long as the credential works."),
  ));

  // ---------------------------------------------------------------------- breakdowns
  // Each breakdown's denominator names the groups the top-N ranking cut off, which is a
  // fact about the METHOD of the table under it — so it is a line on the table's own heading
  // rather than a paragraph beneath it, once per dimension.
  for (const dim of vm.concentration) {
    host.append(sectionCard(dim.label, { lines: [dim.denominator] },
      el("div", { class: "table-host" }, dataTable({
        columns: [
          { key: "key", label: "Group", cell: (r) => r.key },
          { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.open) },
          { key: "repos", label: "Repositories", className: "num", cell: (r) => fmtCount(r.repos) },
        ],
        rows: dim.rows,
        emptyText: "No open findings in this dimension.",
      })),
    ));
  }

  // ------------------------------------------------------------- oldest repositories
  host.append(sectionCard("Where the oldest exposure sits", null,
    vm.oldestRepos.length
      ? pagedTable({
        rows: vm.oldestRepos,
        sortSpec: { value: (r) => r.oldestDays, descending: true, tiebreak: (r) => r.key },
        columns: [
          { key: "key", label: "Repository", cell: (r) => r.key },
          { key: "owner", label: "Owning project", cell: (r) => r.ownerProject || absent() },
          { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.openCount) },
          { key: "aged", label: "Open past 90d", className: "num", cell: (r) => fmtCount(r.agedCount) },
          {
            key: "oldest",
            label: "Oldest",
            className: "num",
            cell: (r) => (r.oldestDays === null ? absent() : days1(r.oldestDays)),
          },
        ],
        emptyText: "Nothing open.",
      })
      : emptyState(
        "Nothing open in this register.",
        "Every secret finding is resolved, or no sync has saved one yet. Resolved is not "
        + "rotated: check the corners above before reading that as safe.",
      ),
  ));

  // ------------------------------------------------------------- every finding, server-paged
  // THE LEDE IS ONE LINE AND A HEADING. Two of its three clauses describe how the table
  // BEHAVES (server-paged, server-sorted, a row opens a sheet) — a definition of the control,
  // which is what a heading's tip is for. The third is the honesty statement this register is
  // built on, so it stays on the surface in the shortest words that still say it.
  // `missingColumnsNote`'s sentence — the columns the ledger holds and this page cannot draw
  // — joins it there: it was a paragraph under a thirteen-column table, which is the furthest
  // point on the page from the heading it is about.
  host.append(sectionCard("Every finding in the register", {
    lines: [
      "Open and resolved, server-paged and server-sorted — click a column to ask for a"
      + " different order rather than re-sorting what is already on screen, and open a row"
      + " for everything the register holds about that one finding.",
      vm.missingColumns,
    ],
  },
    el("p", { class: "small muted" },
      "No severity column: severity grades a detection here, not a live credential."),
    // NO severities PARAMETER, for the same reason the aggregate fetch above sends none:
    // `secretsModel` and `registerRowsModel` both ignore it for this scope outright.
    registerRowsTable({
      scope: "secrets",
      status: filters.status,
      validation: filters.validation,
      confidence: filters.confidence,
      at: vm.asOf,
      emptySentence: "Nothing matched the current filters — the credential state and the "
        + "detector confidence are the two axes this register filters on.",
      defaultSort: "first_seen",
      defaultDir: "asc",
      emptyText: "Nothing in this register.",
      columns: [
        {
          key: "identifier", label: "Credential id", sortable: true,
          cell: (r) => textCell(r.identifier),
        },
        { key: "secret_kind", label: "Kind", sortable: true, cell: (r) => textCell(r.secret_kind) },
        {
          key: "confidence", label: "Confidence", sortable: true,
          cell: (r) => textCell(r.confidence), help: { term: "validation-state" },
        },
        { key: "file_path", label: "File", sortable: true, cell: (r) => textCell(r.file_path) },
        {
          key: "start_line", label: "Line", className: "num", sortable: true,
          cell: (r) => (r.start_line === null || r.start_line === undefined ? absent() : String(r.start_line)),
        },
        {
          key: "validation_state", label: "Validation state", sortable: true,
          cell: (r) => textCell(r.validation_state), help: { term: "validation-state" },
        },
        { key: "validated_at", label: "Validated", sortable: true, cell: (r) => fmtDate(r.validated_at) },
        {
          key: "rotated_at", label: "Rotated", sortable: true,
          cell: (r) => fmtDate(r.rotated_at), help: { term: "rotated" },
        },
        {
          key: "removed_at", label: "Removed", sortable: true,
          cell: (r) => fmtDate(r.removed_at), help: { term: "removed" },
        },
        { key: "repo_name", label: "Repository", sortable: true, cell: (r) => textCell(r.repo_name) },
        { key: "branch", label: "Branch", sortable: true, cell: (r) => textCell(r.branch) },
        { key: "first_seen", label: "First seen", sortable: true, cell: (r) => fmtDate(r.first_seen) },
        { key: "last_seen", label: "Last seen", sortable: true, cell: (r) => fmtDate(r.last_seen) },
      ],
    }),
  ));

  host.append(movementCard(vm.movement));

  // ---------------------------------------------------------------- the twin fold
  //
  // 120 WORDS BECAME A FIGURE AND A CONSTRAINT. `TWIN_NOTE` explained the fold, then named
  // three tenant numbers (187 keys, 135, 19.9 days) measured once on a dated pass and frozen
  // in the string — and the `twin` glossary entry, which this heading routes to, already
  // carries all three in the book's own voice. What the entry cannot say is what THIS sync's
  // fold did, and that is the line on the surface: read off the payload, or the words for a
  // figure nobody sent. The second line is the constraint a reader needs before reading any
  // count above it, and it is four words shorter than the sentence that carried it.
  host.append(sectionCard("How the register was counted", "twin",
    el("p", { class: "small muted" }, vm.twinFold.line),
    el("p", { class: "small muted" },
      "The fold is applied to every count on this page."),
  ));
}

/**
 * "5 of 61 validated", and the meter that draws it — or the words for a share nobody took.
 *
 * THE NULL BRANCH IS THE POINT, and it is the `Number(null)` trap wearing a meter for the
 * fourth time in this repository. `ui/data.js`'s `meter(value)` opens with `Number(value) ||
 * 0`, so the call this replaces — `meter(cov.coveragePct === null ? 0 : cov.coveragePct)` —
 * drew an EMPTY TRACK for a coverage nobody computed, which is a picture asserting that
 * nothing has been validated rather than that nobody could tell. A measured zero still gets
 * its meter, empty: 0 of 61 validated is a measurement and an empty track is its picture.
 *
 * The words are the figure and the meter is the redundancy, never the other way round: the
 * count, the total and the percentage are all printed, so a reader who cannot see the fill
 * loses nothing. The meter keeps its own `aria-label` rather than being decorative because
 * it is the section's headline — the one mark answering the question in the heading.
 */
function coverageHeadline(cov) {
  const pct = coverageMeterPct(cov);
  const words = `${fmtCount(cov.measured)} of ${fmtCount(cov.total)} validated`;
  return el("div", { class: "coverage-headline" },
    el("div", { class: "kpi-label" }, words),
    pct === null
      ? el("p", { class: "small muted" }, "Coverage not measured.")
      : meter(pct, { label: `${words}, ${pct1(pct)}` }),
    el("div", { class: "small muted" },
      pct === null ? absentText : pct1(pct) + " of the register"),
  );
}

/**
 * The alarm mark on the removed-but-unrotated card: a glyph AND a word, never a tint alone.
 *
 * The pill's own status dot is suppressed by `.kpi-chip` — the glyph already does that job,
 * and two marks side by side read as two states. There is no severity mark available here in
 * any case: this page has no severity axis, and this is deliberately not one.
 */
function alarmChip() {
  return el("span", { class: "pill warn kpi-chip" }, uiIcon("alert", 12), "Unconfirmed");
}

/**
 * The Validated count, with its own share as a bar beside it.
 *
 * THE SHARE IS THE THIRD ENCODING AND THE ONLY ONE COMPARABLE DOWN THE COLUMN: six counts in
 * six rows are read one at a time, six fills are read as a shape, and the shape is what says
 * "one segment is checked and the rest are not". `decorative` because the count is printed
 * next to it and the column heading says what the bar is a share OF — `ui/data.js`'s own
 * contract for a meter whose figure is already in words.
 *
 * REFUSED BEFORE THE CAST, twice. A row with no readable total gets NO bar rather than a 0%
 * fill (`meter()` would resolve a null to a confident empty track), and the existing
 * "0 measured reads as absent" behaviour of this cell is left exactly as it was — that is a
 * question about this column's vocabulary, not about the bar, and changing it here would be
 * a second change hiding inside this one.
 */
function validatedCell(row) {
  if (!row.measured) return absent();
  const pct = segmentValidatedPct(row);
  const cell = el("span", { class: "rate-with-meter" },
    el("span", { class: "num" }, fmtCount(row.measured)));
  if (pct !== null) cell.append(meter(pct, { className: "meter--stat", decorative: true }));
  return cell;
}

/**
 * One segment axis as a card. Extracted so the two triage axes can be drawn as a pair under
 * the spine while `secret_kind` stays down with the other breakdowns — one table definition,
 * three call sites, rather than the layout change forking the columns.
 */
function segmentCard(seg) {
  // THE AXIS'S DENOMINATOR IS ON ITS HEADING. Each of these three sentences (~45 words) is a
  // statement about what the table under it counts and why it counts it that way, printed
  // once per axis under the table — three paragraphs on one page for three tables that
  // differ only in their axis. `sectionCard` takes every `tipLabel` shape now, so the
  // glossary route and the sentence ride on the same trigger.
  return sectionCard(seg.label, { term: seg.glossary, lines: [seg.denominator] },
    seg.rows.length
      ? el("div", {},
        el("div", { class: "table-host" }, dataTable({
          columns: [
            { key: "segment", label: "Segment", cell: (r) => r.segment },
            { key: "total", label: "Findings", className: "num", cell: (r) => fmtCount(r.total) },
            { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.open) },
            {
              key: "measured",
              label: "Validated",
              className: "num",
              cell: (r) => validatedCell(r),
              // THE METER'S OWN DEFINITION, asked once on the heading rather than once per
              // row — `ui/tip.js`'s rule, and the only shape that does not add a tab stop
              // per segment.
              help: {
                term: "validation-state",
                lines: [
                  "The count is how many of this segment's findings have ever been"
                  + " validated; the bar beside it is that count as a share of the"
                  + " segment's own total, so two segments of different sizes can be"
                  + " compared down the column.",
                ],
              },
            },
            {
              key: "valid",
              label: "Still works",
              className: "num",
              cell: (r) => (r.measured ? fmtCount(r.valid) : absent()),
            },
            {
              key: "rotated",
              label: "Rotated",
              className: "num",
              cell: (r) => fmtCount(r.rotated),
              help: { term: "rotated" },
            },
            {
              key: "removedNotRotated",
              label: "Removed, not rotated",
              className: "num",
              cell: (r) => fmtCount(r.removedNotRotated),
              help: { term: "removed" },
            },
          ],
          rows: seg.rows,
          emptyText: "No findings on this axis.",
        })),
      )
      : emptyState("Nothing on this axis.", seg.denominator),
  );
}
