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
// core (`num`/`fmtCount`/`days1`/`pct1`/`denomNote`) comes straight from `../ui.js` instead:
// `sca.js` no longer hosts a second copy of those five, only the register-shaped helpers
// built on top of them.

import { bootstrapCached, swrCall } from "../../../../../gas_shared/store.js";
import {
  absent, dataTable, days1, denomNote, el, emptyState, firstRunNotice, fmtCount, fmtDate,
  glossaryTip, heroLines, heroStat, meter, num, pageHeader, pct1, skeletonStack, statRow,
  survivalTableModel, uiIcon,
} from "../ui.js";
import {
  boundedDays, chartCard, concentrationModel, figureCard, missingColumnsNote, movementCard,
  movementModel, oldestReposModel, pagedTable, registerFirstRunView, registerRowsTable,
  renderRegisterPage, sectionCard, textCell,
} from "./sca.js";

/**
 * The measurement note about the twin fold, as one string.
 *
 * ~187 keys in the live tenant span both a REPOSITORY and a REPOSITORY_BRANCH resource, with
 * a different `externalId` on each; the ledger keys on (secret, path, line) and keeps the
 * EARLIER of the two birth dates. Keying on externalId would look unique and quietly double
 * the register while misdating 135 of those 187 by a median of three weeks. The dev seed
 * folds about six. The number is not in the payload, so the note states the mechanism and
 * names the tenant figure as a measurement rather than printing it as a live count.
 */
export const TWIN_NOTE =
  "One secret at one line is reported twice by Wiz — once against the repository and once "
  + "against a branch of it — with a different external id each time. The ledger keys on "
  + "(secret, path, line) and keeps the earlier of the two birth dates, so the two rows fold "
  + "into one finding with the older clock. Measured in this tenant: 187 keys spanned both "
  + "forms, the branch copy carried the earlier date in 135 of them, median gap 19.9 days. "
  + "That fold is already applied to every count on this page.";

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
  );

  const vm = {
    scope: "secrets",
    firstRun,
    asOf: reg.asOf ?? sec.asOf ?? null,
    rowCount: num(sec.rowCount, num(reg.rowCount)),
    open: num(sec.open, num(reg.open)),

    // THE HERO IS THE CORNER WHERE THE TWO AXES DISAGREE — suppressed to a dash on a first
    // run for the same reason sca.js's hero is: "0 secrets left the code" over a register
    // nobody has read is a confident claim about a corner nobody has looked at yet.
    hero: {
      label: "Removed, not rotated",
      value: firstRun.show ? "—" : fmtCount(rvr.removedNotRotated),
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
        sub: `${ofOpen(live)} — the provider answered and the credential worked`,
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
        sub: `${ofOpen(unchecked)} — nobody has asked the provider`,
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
        sub: `${ofOpen(dead)} — the provider refused it`,
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
        sub: `${fmtCount(alarm)} of ${fmtCount(registerTotal)} in register — the string left `
          + "HEAD, the credential unconfirmed",
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

/** Credentials in the repository — a lifecycle of its own. */
export function renderSecrets(host) {
  const boot = bootstrapCached();
  const synced = !!(boot && boot.latestSync);

  return renderRegisterPage(host, {
    skeleton: () => skeletonStack(6, { widths: ["70%", "100%", "90%", "100%", "80%", "60%"] }),
    // NO SEVERITIES PARAMETER. `secretsModel` ignores it and its cache key omits it, so
    // sending one would mint an argument that changes nothing and imply a filter that does
    // not exist. `showNoFix` is likewise omitted: it cannot bite on a non-dependency row.
    fetch: () => swrCall("api_getSecretsPage", {}),
    paint: (payload) => paintSecrets(host, secretsModel(payload, { synced })),
  });
}

function paintSecrets(host, vm) {
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
      { term: "secret-resolved" },
    ),
    aside: el("div", { class: "page-strip" },
      el("p", { class: "small muted" },
        "Credentials committed to source. Removing one is not the same as fixing it: the "
        + "string leaving HEAD closes the finding, and the credential stays live until it is "
        + "rotated."),
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

  // FIRST RUN STOPS HERE — see sca.js's paintSca for why every section past this point would
  // otherwise print its own confident "0", including the removed-vs-rotated four-corner table
  // and the revocation survival chart.
  if (vm.firstRun.show) {
    host.append(firstRunNotice({
      synced: vm.firstRun.synced,
      hint: "Secrets arrive with the first sync that saves a row for this register; enable "
        + "it under Settings → Register if it is off.",
    }));
    return;
  }

  host.append(denomNote(vm.hero.denominator));

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
  host.append(el("p", { class: "small muted" },
    "Read the two tables below together: the validation state says whether anybody asked the "
    + "provider, and the detector confidence says how sure the scanner was that the matched "
    + "string is a credential at all. They are counted on separate axes and the register "
    + "carries no joint count, so this is two tables rather than a cross-tab multiplied out "
    + "of two sets of totals."));
  const paired = PAIRED_SEGMENT_AXES
    .map((axis) => vm.segments.find((s) => s.axis === axis))
    .filter(Boolean);
  if (paired.length) host.append(el("div", { class: "card-pair" }, ...paired.map(segmentCard)));

  // ------------------------------------------------------------ removed is not rotated
  host.append(sectionCard("Removed is not rotated", "removed",
    el("p", { class: "small muted" },
      "Two independent events, so two axes. A row is removed when the string leaves HEAD and "
      + "rotated when the credential is observed dead; neither implies the other, and the "
      + "corner where they disagree is the one that matters."),
    el("div", { class: "table-host" }, dataTable({
      columns: [
        { key: "label", label: "Corner", cell: (r) => r.label },
        {
          key: "removed",
          label: "String out of HEAD",
          cell: (r) => (r.removed ? "Yes" : "No"),
          help: { term: "removed" },
        },
        {
          key: "rotated",
          label: "Credential confirmed dead",
          cell: (r) => (r.rotated ? "Yes" : "No"),
          help: { term: "rotated" },
        },
        { key: "count", label: "Findings", className: "num", cell: (r) => fmtCount(r.count) },
        { key: "reading", label: "Reading", cell: (r) => r.reading, wrap: true },
      ],
      rows: vm.removalVsRotation.cells,
      emptyText: "Nothing in this register.",
    })),
    denomNote(vm.removalVsRotation.denominator),
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
  host.append(sectionCard("Has anybody looked?", "validation-state",
    el("p", {}, vm.validationCoverage.denominator),
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
    meter(vm.validationCoverage.coveragePct === null ? 0 : vm.validationCoverage.coveragePct, {
      className: "meter--stat",
      label: `Validation coverage, ${pct1(vm.validationCoverage.coveragePct)}`,
    }),
  ));

  // ------------------------------------------------------------------- time to revoke
  host.append(sectionCard("Time to revoke", "time-to-revoke",
    el("p", { class: "small muted" },
      "Detection to confirmed-invalid, with still-live credentials right-censored at today. "
      + "A credential nobody ever checked supports no claim in either direction, so it is "
      + "excluded from this estimate — and the excluded count is printed beside it."),
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
      figureCard({
        label: "P90",
        value: vm.timeToRevoke.p90Text,
        sub: "nine in ten rotations within this",
        denominator: vm.timeToRevoke.denominator,
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
  host.append(sectionCard("How long the exposure has run", null,
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
    denomNote(vm.aging.denominator),
    el("p", { class: "small muted" },
      glossaryTip("The exposure window runs to rotation, not to removal", "rotated"),
      " — a removed secret is still exposed for as long as the credential works."),
  ));

  // ---------------------------------------------------------------------- breakdowns
  for (const dim of vm.concentration) {
    host.append(sectionCard(dim.label, null,
      el("div", { class: "table-host" }, dataTable({
        columns: [
          { key: "key", label: "Group", cell: (r) => r.key },
          { key: "open", label: "Open", className: "num", cell: (r) => fmtCount(r.open) },
          { key: "repos", label: "Repositories", className: "num", cell: (r) => fmtCount(r.repos) },
        ],
        rows: dim.rows,
        emptyText: "No open findings in this dimension.",
      })),
      denomNote(dim.denominator),
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
  host.append(sectionCard("Every finding in the register", null,
    el("p", { class: "small muted" },
      "Open and resolved, server-paged and server-sorted — click a column to ask for a "
      + "different order rather than re-sorting what is already on screen. No severity "
      + "column: severity here grades a detection, not whether a credential is live."),
    // NO severities PARAMETER, for the same reason the aggregate fetch above sends none:
    // `secretsModel` and `registerRowsModel` both ignore it for this scope outright.
    registerRowsTable({
      scope: "secrets",
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
    el("p", { class: "small muted" }, vm.missingColumns),
  ));

  host.append(movementCard(vm.movement));

  host.append(sectionCard("How the register was counted", "twin",
    el("p", {}, vm.twinNote),
  ));
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
 * One segment axis as a card. Extracted so the two triage axes can be drawn as a pair under
 * the spine while `secret_kind` stays down with the other breakdowns — one table definition,
 * three call sites, rather than the layout change forking the columns.
 */
function segmentCard(seg) {
  return sectionCard(seg.label, seg.glossary,
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
              cell: (r) => (r.measured ? fmtCount(r.measured) : absent()),
              help: { term: "validation-state" },
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
        denomNote(seg.denominator),
      )
      : emptyState("Nothing on this axis.", seg.denominator),
  );
}
