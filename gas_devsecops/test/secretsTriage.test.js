// The secrets register triages by validity first, and the arithmetic is checkable.
//
// THE FINDING THIS FILE HOLDS. Every vendor that scans source for credentials leads on
// whether the credential is LIVE — GitHub's validity checks, GitGuardian's validity facet,
// TruffleHog's "verified", Wiz's own validation engine — with severity demoted or absent.
// `secrets.js` already agreed in principle: it has never drawn a severity mark, and its
// "By validation state" and "By detector confidence" tables have existed since the page
// shipped. It disagreed in LAYOUT. Those two tables were the sixth and seventh blocks down,
// several screens below the four-corner table and the survival curve, so the first figures a
// reader met were the removal corners and a register/open/ever-validated strip. The eight
// confirmed-live credentials and the ninety-four nobody has checked were the last thing on
// screen rather than the first.
//
// WHAT IS ACTUALLY GUARDED HERE, in three cases:
//
//   1. THE SPINE AND THE TABLE ARE THE SAME MEASUREMENT. `validityTriageView` reads `open`
//      off the `validation_state` segment rows — the very rows the first table draws — so
//      the three figures partition the header strip's "Open" figure and a reader can add
//      them up against the table below. A second computation off `coverage`/`validity` would
//      look right and would silently fold resolved findings in.
//   2. THE ORDER, IN THE SOURCE TEXT. There is no jsdom in this project, so the order the
//      reader meets these blocks in is checked the way `pagesRegisters.test.js` checks the
//      rest of this page's DOM half: as comment-stripped source, by the index of two anchors
//      inside `paintSecrets`.
//   3. THE HERO'S SECOND LINE says the split with its denominator, and says "—" rather than
//      "0" for a register whose validation axis was never computed.
//
// COMMENT-STRIPPED SOURCE, using `emptyStates.test.js`'s stricter stripper for the reason
// that file gives: this header quotes the very strings the cases below forbid, and a helper
// that leaked comment text would fail on its own explanation.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PAIRED_SEGMENT_AXES, secretsModel, validitySentence, validityTriageView,
} from "../src/client/js/pages/secrets.js";

const SECRETS_SRC = readFileSync(
  new URL("../src/client/js/pages/secrets.js", import.meta.url),
  "utf8",
);

/** The file with its comments removed — string-aware, so a `//` inside a quote survives. */
function code(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const SECRETS_CODE = code(SECRETS_SRC);

// =========================================================================================
//  The fixture
// =========================================================================================

/**
 * The seeded shape, copied from `test/pagesRegisters.test.js`'s `secretsPayload` rather than
 * imported — that builder is not exported and that file is protected, so this is the minimal
 * subset the spine actually reads, with the four numbers below carried across verbatim so the
 * two files describe the same register.
 *
 * The validation split it carries: UNKNOWN 56 rows / 38 open, VALID 3 / 3 open, INVALID 2 /
 * 0 open. 38 + 3 + 0 = 41, which is the register's `open`. That the three add up is the
 * property case 1 exists to hold.
 */
function secretsPayload(over) {
  const register = {
    asOf: 1756900000000,
    scope: "secrets",
    rowCount: 61,
    open: 41,
    aging: { perSev: { LOW: [2, 4, 6, 8] }, totalOpen: 31 },
    oldest: { findings: [], byRepo: [] },
    movement: { newCount: 2, resolvedCount: 5, reopenedCount: 0, persisting: 39, hasPrevious: true },
    concentration: { perDim: {}, moreDim: {} },
    latestScan: { scan_id: "s-43", ts: "2026-09-01T05:00:00.000Z", scope: "secrets", total: 61 },
  };
  const secrets = {
    asOf: 1756900000000,
    scope: "secrets",
    rowCount: 61,
    open: 41,
    coverage: { measured: 5, unmeasured: 56, total: 61, coveragePct: (5 / 61) * 100 },
    validity: { valid: 3, invalid: 2, measured: 5, ratePct: 60 },
    timeToRevoke: {
      km: { curve: [{ t: 2, s: 0.9 }], median: 6.5, events: 2, censored: 3, total: 5 },
      median: 6.5, p90: 19.25, medianLowerBound: null, events: 2, censored: 3,
      excludedUnmeasured: 56, excludedNoClock: 0, total: 61, withinSlaPct: 50, sla: 7,
    },
    removalVsRotation: {
      removedAndRotated: 3, removedNotRotated: 17, rotatedNotRemoved: 1, neither: 40, total: 61,
    },
    segments: {
      validation_state: [
        { segment: "UNKNOWN", total: 56, open: 38, measured: 0, valid: 0, invalid: 0, rotated: 0, removed: 15, removedNotRotated: 15 },
        { segment: "VALID", total: 3, open: 3, measured: 3, valid: 3, invalid: 0, rotated: 0, removed: 1, removedNotRotated: 1 },
        { segment: "INVALID", total: 2, open: 0, measured: 2, valid: 0, invalid: 2, rotated: 2, removed: 2, removedNotRotated: 0 },
      ],
      confidence: [
        { segment: "HIGH", total: 40, open: 28, measured: 4, valid: 2, invalid: 2, rotated: 2, removed: 12, removedNotRotated: 11 },
        { segment: "MEDIUM", total: 21, open: 13, measured: 1, valid: 1, invalid: 0, rotated: 0, removed: 6, removedNotRotated: 6 },
      ],
      secret_kind: [
        { segment: "SAAS_API_KEY", total: 33, open: 20, measured: 3, valid: 2, invalid: 1, rotated: 1, removed: 10, removedNotRotated: 9 },
      ],
    },
  };
  return { register, secrets, ...(over || {}) };
}

const VM = secretsModel(secretsPayload());
const TRIAGE = validityTriageView(VM);

/** One figure of the spine, by id. */
const at = (id) => TRIAGE.figures.find((f) => f.id === id);

/** The "By validation state" table's row for one state, as the page will draw it. */
const stateRow = (name) =>
  VM.segments.find((s) => s.axis === "validation_state").rows.find((r) => r.segment === name);

// =========================================================================================
//  1. The spine and the table are the same measurement
// =========================================================================================

describe("the validity spine is the By-validation-state table, read a second way", () => {
  it("gives the reader four figures, live first and the alarm last", () => {
    expect(TRIAGE.figures.map((f) => f.id)).toEqual([
      "live", "unchecked", "dead", "removedNotRotated",
    ]);
    expect(TRIAGE.figures.map((f) => f.label)).toEqual([
      "Confirmed live", "Unchecked", "Confirmed dead", "Removed, not rotated",
    ]);
  });

  it("counts confirmed-live off the VALID row's OPEN cell, not its total", () => {
    expect(at("live").count).toBe(stateRow("VALID").open);
    expect(at("live").count).toBe(3);
  });

  it("counts confirmed-dead off the INVALID row's OPEN cell", () => {
    expect(at("dead").count).toBe(stateRow("INVALID").open);
    expect(at("dead").count).toBe(0);
  });

  /**
   * PERTURBATION (run 2026-09-04, then reverted). In `validityTriageView`, the unchecked
   * bucket was recomputed over `row.total` instead of `row.open` — i.e. "Unchecked" counted
   * over ALL rows in each unmeasured state rather than over the open ones. SIX cases failed,
   * verbatim:
   *
   *   FAIL  … > counts unchecked off the unmeasured rows' OPEN cells
   *           AssertionError: expected 56 to be 38 // Object.is equality
   *   FAIL  … > the three validity figures partition the register's open count
   *           AssertionError: expected 59 to be 41 // Object.is equality
   *   FAIL  … > treats every state that is not VALID or INVALID as unchecked, not as nothing
   *           AssertionError: expected 56 to be 38 // Object.is equality
   *   FAIL  … > carries a denominator on every card, and the open one on the three that share it
   *           AssertionError: expected '56 of 41 open — nobody has asked the …' to be
   *                           '38 of 41 open — nobody has asked the …' // Object.is equality
   *   FAIL  … > makes a whole bucket unknown when one of its open cells is unreadable
   *           AssertionError: expected 56 to be null // Object.is equality
   *   FAIL  … > names live, unchecked and dead against the open count
   *           AssertionError: expected 'Of 41 open findings, 3 credentials st…' to be
   *                           'Of 41 open findings, 3 credentials st…' // Object.is equality
   *
   * 56 is the UNKNOWN row's `total`; 38 is its `open`. The difference is the 18 unchecked
   * findings that have already been resolved — the string left HEAD and nobody ever asked
   * the provider — and counting those as open exposure is precisely the claim this register
   * exists to refuse. Note the fourth failure: the denominator sentence went to "56 of 41",
   * a numerator larger than its own denominator, which is what a figure and its denominator
   * drifting apart actually looks like. Reverted.
   */
  it("counts unchecked off the unmeasured rows' OPEN cells", () => {
    expect(at("unchecked").count).toBe(stateRow("UNKNOWN").open);
    expect(at("unchecked").count).toBe(38);
  });

  it("the three validity figures partition the register's open count", () => {
    const sum = at("live").count + at("unchecked").count + at("dead").count;
    expect(sum).toBe(TRIAGE.open);
    expect(sum).toBe(VM.open);
    expect(sum).toBe(41);
  });

  it("treats every state that is not VALID or INVALID as unchecked, not as nothing", () => {
    // A state nobody anticipated must land in "nobody checked" rather than vanish — the
    // three figures would stop summing to open if it did.
    const withOddState = secretsPayload();
    withOddState.secrets.segments.validation_state = [
      { segment: "UNKNOWN", total: 30, open: 20, measured: 0, valid: 0, invalid: 0, rotated: 0, removed: 0, removedNotRotated: 0 },
      { segment: "PENDING_REVALIDATION", total: 26, open: 18, measured: 0, valid: 0, invalid: 0, rotated: 0, removed: 0, removedNotRotated: 0 },
      { segment: "VALID", total: 3, open: 3, measured: 3, valid: 3, invalid: 0, rotated: 0, removed: 0, removedNotRotated: 0 },
      { segment: "INVALID", total: 2, open: 0, measured: 2, valid: 0, invalid: 2, rotated: 2, removed: 0, removedNotRotated: 0 },
    ];
    const t = validityTriageView(secretsModel(withOddState));
    expect(t.figures.find((f) => f.id === "unchecked").count).toBe(38);
    expect(
      t.figures.find((f) => f.id === "live").count
      + t.figures.find((f) => f.id === "unchecked").count
      + t.figures.find((f) => f.id === "dead").count,
    ).toBe(41);
  });

  it("takes the alarm off the removal table, over the whole register, and says so", () => {
    expect(at("removedNotRotated").count).toBe(17);
    expect(at("removedNotRotated").count)
      .toBe(VM.removalVsRotation.cells.find((c) => c.id === "removedNotRotated").count);
    expect(TRIAGE.registerTotal).toBe(61);
    // Its denominator is 61, not the 41 the other three share — and it states the difference
    // rather than letting the four look like one partition.
    expect(at("removedNotRotated").denominator).toMatch(/17 of 61 secret findings/);
    expect(at("removedNotRotated").denominator).toMatch(/whole register/);
    expect(at("removedNotRotated").alarm).toBe(true);
    for (const id of ["live", "unchecked", "dead"]) expect(at(id).alarm).toBe(false);
  });

  it("carries a denominator on every card, and the open one on the three that share it", () => {
    for (const f of TRIAGE.figures) {
      expect(typeof f.denominator, `${f.id} has no denominator`).toBe("string");
      expect(f.denominator.length).toBeGreaterThan(40);
      expect(typeof f.sub).toBe("string");
    }
    expect(at("live").sub).toBe("3 of 41 open — the provider answered and the credential worked");
    expect(at("unchecked").sub).toBe("38 of 41 open — nobody has asked the provider");
    expect(at("dead").sub).toBe("0 of 41 open — the provider refused it");
  });

  it("says null rather than zero when the validation axis was never computed", () => {
    const noAxis = secretsPayload();
    noAxis.secrets.segments.validation_state = [];
    const t = validityTriageView(secretsModel(noAxis));
    for (const id of ["live", "unchecked", "dead"]) {
      expect(t.figures.find((f) => f.id === id).count, `${id} claimed a zero`).toBe(null);
    }
    expect(t.known).toBe(false);
    // The alarm still has its own source, so it is still a number.
    expect(t.figures.find((f) => f.id === "removedNotRotated").count).toBe(17);
  });

  it("makes a whole bucket unknown when one of its open cells is unreadable", () => {
    const partial = secretsPayload();
    partial.secrets.segments.validation_state = [
      { segment: "UNKNOWN", total: 56, open: null, measured: 0, valid: 0, invalid: 0, rotated: 0, removed: 0, removedNotRotated: 0 },
      { segment: "VALID", total: 3, open: 3, measured: 3, valid: 3, invalid: 0, rotated: 0, removed: 0, removedNotRotated: 0 },
    ];
    const t = validityTriageView(secretsModel(partial));
    expect(t.figures.find((f) => f.id === "unchecked").count).toBe(null);
    expect(t.figures.find((f) => f.id === "live").count).toBe(3);
  });
});

// =========================================================================================
//  2. The order a reader meets the blocks in
// =========================================================================================

describe("validity is the first thing under the hero, in the source that draws it", () => {
  const paint = SECRETS_CODE.slice(SECRETS_CODE.indexOf("function paintSecrets("));

  it("paintSecrets exists and the two anchors are both in it", () => {
    expect(SECRETS_CODE.indexOf("function paintSecrets(")).toBeGreaterThan(-1);
    expect(paint.indexOf("validityTriageView(vm)")).toBeGreaterThan(-1);
    expect(paint.indexOf('sectionCard("Removed is not rotated"')).toBeGreaterThan(-1);
  });

  /**
   * PERTURBATION (run 2026-09-04 in two passes, then reverted). Pass one moved the whole
   * validity block in `paintSecrets` — `const triage = validityTriageView(vm);` and the
   * `kpi-row` append that follows it — to sit AFTER the `sectionCard("Removed is not
   * rotated", …)` append. Pass two did the same to the `card-pair` block. One case failed
   * each time, and they are different cases, which is what makes the pair of them worth
   * keeping rather than one:
   *
   *   FAIL  … > appends the validity KPI row before the four-corner removal table
   *           AssertionError: expected 4457 to be less than 2170
   *   FAIL  … > appends the paired validity and confidence tables before it too
   *           AssertionError: expected 4739 to be less than 1860
   *
   * Reverted both. The order IS the package: the two tables and all four figures existed
   * before this change and sat below the fold, which was the whole defect.
   */
  it("appends the validity KPI row before the four-corner removal table", () => {
    const spine = paint.indexOf("validityTriageView(vm)");
    const corners = paint.indexOf('sectionCard("Removed is not rotated"');
    expect(spine).toBeLessThan(corners);
  });

  it("appends the paired validity and confidence tables before it too", () => {
    const pair = paint.indexOf('class: "card-pair"');
    const corners = paint.indexOf('sectionCard("Removed is not rotated"');
    expect(pair).toBeGreaterThan(-1);
    expect(pair).toBeLessThan(corners);
  });

  it("pairs the validation state with the detector confidence, in that order", () => {
    expect(PAIRED_SEGMENT_AXES).toEqual(["validation_state", "confidence"]);
    // And the third axis is not in the pair, so it stays with the other breakdowns.
    expect(VM.segments.map((s) => s.axis)).toContain("secret_kind");
    expect(PAIRED_SEGMENT_AXES).not.toContain("secret_kind");
  });

  it("draws no severity mark on the new row, restating what pagesLit pins over the file", () => {
    // `test/pagesLit.test.js` holds this over the whole page; this case is here so the
    // failure names the block that reintroduced it if the spine ever grows one.
    expect(SECRETS_CODE).not.toMatch(/\bsevBadge\b/);
    expect(SECRETS_CODE).not.toMatch(/\bsev-[A-Za-z]/);
    const spine = SECRETS_CODE.indexOf("export function validityTriageView(");
    const spineEnd = SECRETS_CODE.indexOf("\nexport function validitySentence(", spine);
    expect(spineEnd).toBeGreaterThan(spine);
    expect(SECRETS_CODE.slice(spine, spineEnd)).not.toMatch(/sev/i);
  });

  it("marks the alarm with a glyph and a word, not with a tint alone", () => {
    expect(SECRETS_CODE).toMatch(/uiIcon\("alert"/);
    expect(SECRETS_CODE).toMatch(/"Unconfirmed"/);
    expect(SECRETS_CODE).toMatch(/chip: f\.alarm \? alarmChip\(\) : null/);
  });
});

// =========================================================================================
//  3. The hero's second line
// =========================================================================================

describe("the hero sub-line says the validity split with its denominator", () => {
  it("names live, unchecked and dead against the open count", () => {
    expect(VM.hero.validitySentence).toBe(
      "Of 41 open findings, 3 credentials still work, 38 nobody has checked and 0 are "
      + "confirmed dead.",
    );
  });

  it("leaves the alarm sentence above it exactly as it was", () => {
    // The hero VALUE is still the removed-but-unrotated corner, and its sentence is still the
    // one `pagesRegisters.test.js` pins. The split is a second line, not a replacement.
    expect(VM.hero.value).toBe("17");
    expect(VM.hero.sentence).toBe(
      "17 secrets left the code and nobody has confirmed the credential is dead.",
    );
  });

  it("renders an em dash, never a zero, when the counts were never measured", () => {
    const noAxis = secretsPayload();
    noAxis.secrets.segments.validation_state = [];
    const sentence = secretsModel(noAxis).hero.validitySentence;
    expect(sentence).toBe(
      "Of 41 open findings, — credentials still work, — nobody has checked and — are "
      + "confirmed dead.",
    );
    expect(sentence).not.toMatch(/\b0\b/);
  });

  it("is null on a first run, so the empty state draws one line and no dashes", () => {
    const vm = secretsModel({});
    expect(vm.firstRun.show).toBe(true);
    expect(vm.hero.validitySentence).toBe(null);
    expect(vm.hero.sentence).not.toMatch(/\d/);
  });

  it("is built by validitySentence from the triage, not typed a second time", () => {
    expect(validitySentence(TRIAGE)).toBe(VM.hero.validitySentence);
  });
});
