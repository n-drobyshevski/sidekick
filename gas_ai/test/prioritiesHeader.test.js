// The front door's ONE header: the half-life hero, the movement aside, and the stat strip
// both register modes share.
//
// WHY THIS FILE EXISTS AT ALL. Priorities used to build two headers — `kpiRow` in problems
// mode and `actionHeadline` in action mode — and the page's own comment named the result as a
// defect ("it left the two modes of one page looking like two different pages"). One
// `renderHeader` replaces both; the claims it makes are in `problemView.js`, DOM-free, and
// this file holds them there rather than in a screenshot.
//
// TWO KINDS OF CLAIM, AND THEY FAIL DIFFERENTLY. `halfLifeView` and `movementView` are
// FIGURE claims: a null median must not print as a zero, a missing comparison must not print
// a previous count nobody measured. The source sweep in section 3 is a SHAPE claim: the page
// must call the shared header once, must empty the strip on a first run, and must not build
// a canvas above its own first-run return. A figure claim fails as a wrong sentence; a shape
// claim fails as a page that draws two headers or paints a chart over an unsynced register.
//
// Every guard below is perturbed with the defective rewrite reproduced inline as its own
// named `it`, per CLAUDE.md's working discipline: a guard that fires on nothing is a finding.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";
import { absentText, fmtCount, fmtDays } from "../../gas_shared/ui/figures.js";
import { halfLifeView, movementView } from "../src/client/js/pages/problemView.js";

const PROBLEMS = code(readFileSync(
  new URL("../src/client/js/pages/problems.js", import.meta.url), "utf8",
));

/** The dev fixture's own half-life head, as `getProblems` ships it (P2.5a's commit body:
 *  8 events, 31 censored, 39 total, median null, medianLowerBound 8 d, 1 returned row). */
const FIXTURE_HALF_LIFE = {
  median: null,
  medianLowerBound: 8,
  p90: null,
  events: 8,
  censored: 31,
  total: 39,
  returnedExcluded: 1,
  unmeasurable: 0,
  asOf: "2026-09-08T05:00:00Z",
  curve: [],
};

/** The dev fixture's own movement head (P2.2's commit body): the previous comparison spans
 *  ONE day, not a week — the week row is a separate, older endpoint. */
const FIXTURE_MOVEMENT = {
  previous: {
    since: "2026-09-07T05:00:00Z",
    until: "2026-09-08T05:00:00Z",
    gapDays: 1,
    deltas: { new: 3, resolved: 6, reopened: 1, carried: 2, skippedNarrowedScope: 0 },
    open: 32,
    prevOpen: 34,
    direction: "down",
  },
  week: {
    since: "2026-09-01T05:00:00Z",
    until: "2026-09-08T05:00:00Z",
    gapDays: 7,
    deltas: { new: 20, resolved: 6, reopened: 1, carried: 2, skippedNarrowedScope: 0 },
    open: 32,
    prevOpen: 18,
    direction: "up",
  },
  reasons: { previous: null, week: null },
  spanDays: 8,
};

// =========================================================================================
//  1. halfLifeView — three states, and none of them is a zero
// =========================================================================================

describe("halfLifeView states the estimate, or states that there is none", () => {
  it("a measured median prints as days, with the events and the censored count beside it", () => {
    const view = halfLifeView({ median: 12, medianLowerBound: null, events: 20, censored: 4 });
    expect(view.measured).toBe(true);
    expect(view.isLowerBound).toBe(false);
    expect(view.value).toBe(fmtDays(12));
    expect(view.value).toBe("12 days");
    expect(view.qualifier).toContain("20 events");
    expect(view.qualifier).toContain("4 censored");
    // The measured branch never hedges: no bound is published beside a median.
    expect(view.qualifier).not.toMatch(/at least/);
  });

  it("a censored curve publishes the LOWER BOUND, prefixed 'at least' and never '>'", () => {
    const view = halfLifeView(FIXTURE_HALF_LIFE);
    expect(view.measured).toBe(true);
    expect(view.isLowerBound).toBe(true);
    expect(view.value).toBe("at least 8 days");
    // ">" claims the true figure is STRICTLY beyond the bound; "at least" says it is that far
    // out or further, which is the only thing the curve licenses. DESIGN.md section 10.
    expect(view.value).not.toContain(">");
    expect(view.qualifier).toContain("the curve has not reached half");
    expect(view.qualifier).toContain("8 events");
    expect(view.qualifier).toContain("31 still open");
  });

  it("a bound with NO events says nothing has left yet, rather than naming a curve", () => {
    // Reachable on a register that has synced twice and resolved nothing: every row is
    // censored, so the bound is the longest open lifetime and there is no curve at all.
    const view = halfLifeView({ median: null, medianLowerBound: 30, events: 0, censored: 12 });
    expect(view.value).toBe("at least 30 days");
    expect(view.qualifier).toContain("no issue has left the register yet");
    expect(view.qualifier).not.toContain("the curve has not reached half");
  });

  it("nothing measurable at all returns absentText — the constant, never a typed dash", () => {
    for (const input of [null, undefined, {}, { median: null, medianLowerBound: null }]) {
      const view = halfLifeView(input);
      expect(view.measured).toBe(false);
      // MEASURED IN THE BROWSER, and the reason this is not `null`: `heroStat` promotes the
      // absentText STRING to the muted `absent()` node and passes anything else through, so a
      // null renders an EMPTY hero value. The first-run hero did exactly that on an unsynced
      // store until this package looked at it.
      expect(view.value).toBe(absentText);
      expect(view.qualifier).toMatch(/no issue lifetime has been recorded yet/);
      expect(view.qualifier).not.toMatch(/\b0\b/);
    }
  });

  // PERTURBATION for the state above: a null value is what an "absent is just null" rewrite
  // would return, and it is INVISIBLE — `valueOrAbsent` hands it straight to `el()`, which
  // renders nothing at all where the page's largest figure should be. Reproduced inline
  // because the defect is in the SHARED component's contract, not in this file.
  it("a null value would render an EMPTY hero, which is why the constant is returned", () => {
    const valueOrAbsent = (v) => (v === absentText ? "<muted dash node>" : v);
    expect(valueOrAbsent(null)).toBeNull();
    expect(valueOrAbsent(halfLifeView(null).value)).toBe("<muted dash node>");
  });

  it("the returned-row count appears only when there is one to report", () => {
    const withReturned = halfLifeView({ ...FIXTURE_HALF_LIFE, returnedExcluded: 1 });
    expect(withReturned.qualifier).toContain("1 returned row excluded");
    const withThree = halfLifeView({ ...FIXTURE_HALF_LIFE, returnedExcluded: 3 });
    expect(withThree.qualifier).toContain("3 returned rows excluded");
    const withNone = halfLifeView({ ...FIXTURE_HALF_LIFE, returnedExcluded: 0 });
    expect(withNone.qualifier).not.toContain("returned");
    // Absent, not zero: a missing count is not "0 returned rows excluded" either.
    const absentCount = halfLifeView({ ...FIXTURE_HALF_LIFE, returnedExcluded: null });
    expect(absentCount.qualifier).not.toContain("returned");
  });

  it("rows the ledger could not read are named too, on the same rule", () => {
    const unread = halfLifeView({ ...FIXTURE_HALF_LIFE, unmeasurable: 2 });
    expect(unread.qualifier).toContain("2 rows the ledger could not read");
    expect(halfLifeView(FIXTURE_HALF_LIFE).qualifier).not.toContain("could not read");
  });

  it("asOf becomes the figure's own date line, and is null when the estimator sent none", () => {
    expect(halfLifeView(FIXTURE_HALF_LIFE).asOfNote).toMatch(/^Measured to /);
    expect(halfLifeView({ ...FIXTURE_HALF_LIFE, asOf: null }).asOfNote).toBeNull();
  });

  it("reads no clock — the same payload gives the same sentence twice", () => {
    expect(halfLifeView(FIXTURE_HALF_LIFE)).toEqual(halfLifeView(FIXTURE_HALF_LIFE));
  });

  // PERTURBATION: the defective rewrite this section exists to catch, reproduced inline and
  // shown printing a confident zero for a median nobody measured. `fmtDays` refuses a null
  // on its own; `median ?? 0` defeats that refusal one call earlier, which is exactly the
  // shape CLAUDE.md names ("Number(null) is 0, and it is finite").
  it("the null-is-a-dash claim is falsified by a `median ?? 0` rewrite", () => {
    const defective = (km) => fmtDays((km && km.median) ?? 0);
    expect(defective({ median: null, medianLowerBound: 8 })).toBe("0 days");
    // The real view refuses: the same input yields the BOUND, never a zero.
    expect(halfLifeView({ median: null, medianLowerBound: 8 }).value).toBe("at least 8 days");
    expect(halfLifeView({ median: null, medianLowerBound: null }).value).toBe(absentText);
  });
});

// =========================================================================================
//  2. movementView — a comparison, or the reason there is not one
// =========================================================================================

describe("movementView reports what moved, and why it cannot say more", () => {
  it("both comparisons present: two rows, each with its direction spelled in a WORD", () => {
    const view = movementView(FIXTURE_MOVEMENT);
    expect(view.rows).toHaveLength(2);
    const [prev, week] = view.rows;

    expect(prev.label).toBe("Issues");
    expect(prev.chip.direction).toBe("down");
    // The glyph is the page's business and is aria-hidden there; the WORD is what a screen
    // reader gets and what the pill prints.
    expect(prev.chip.word).toBe("down 2");
    expect(prev.text).toBe("32 open, was 34");
    expect(prev.dates).toMatch(/^since /);

    // NEVER "a week": the fixture's previous gap is ONE day. The week row is its own
    // comparison against its own, older endpoint.
    expect(prev.label).not.toMatch(/week/i);
    expect(week.label).toBe("vs 7 days ago");
    expect(week.chip.direction).toBe("up");
    expect(week.chip.word).toBe("up 14");
    expect(week.text).toBe("32 open, was 18");
  });

  it("the week row states the gap it actually found, not the seven-day floor", () => {
    const wide = movementView({
      ...FIXTURE_MOVEMENT,
      week: { ...FIXTURE_MOVEMENT.week, gapDays: 9 },
    });
    expect(wide.rows[1].label).toBe("vs 9 days ago");
  });

  it("a growing backlog reads bad and a shrinking one ok — the register's reading, not a sign",
    () => {
      const view = movementView(FIXTURE_MOVEMENT);
      expect(view.rows[0].chip.kind).toBe("ok");
      expect(view.rows[1].chip.kind).toBe("bad");
      const flat = movementView({
        ...FIXTURE_MOVEMENT,
        previous: { ...FIXTURE_MOVEMENT.previous, open: 32, prevOpen: 32, direction: "flat" },
      });
      expect(flat.rows[0].chip.kind).toBe("neutral");
      expect(flat.rows[0].chip.word).toBe("unchanged");
    });

  it("no ledger: the previous comparison becomes a sentence about the SYNC LOG", () => {
    const view = movementView({
      previous: null,
      week: null,
      reasons: { previous: "noLedger", week: "noLedger" },
      spanDays: 40,
    });
    expect(view.rows).toEqual([]);
    expect(view.notes.join(" ")).toContain("before the lifecycle ledger existed");
  });

  it("too close: the note publishes the span the saved syncs really do cover", () => {
    const view = movementView({
      previous: FIXTURE_MOVEMENT.previous,
      week: null,
      reasons: { previous: null, week: "tooClose" },
      spanDays: 3.2,
    });
    expect(view.rows).toHaveLength(1);
    const note = view.notes.find((n) => n.includes("a week ago"));
    expect(note).toContain("the saved syncs span");
    expect(note).toContain(fmtDays(3.2));
    expect(note).toContain("3.2 days");
  });

  it("every reason in backlogMovement's vocabulary resolves to words, never to a key", () => {
    for (const reason of ["noSync", "oneSync", "noLedger", "rescoped"]) {
      const view = movementView({ previous: null, week: null, reasons: { previous: reason } });
      const note = view.notes.find((n) => n.includes("the previous sync"));
      expect(note, reason).toBeTruthy();
      expect(note, reason + " leaked its key into the sentence").not.toContain(reason);
    }
  });

  it("no comparison prints NO previous count — there is no earlier population to print", () => {
    const view = movementView({
      previous: null,
      week: null,
      reasons: { previous: "oneSync", week: "tooClose" },
      spanDays: 0.5,
    });
    const all = JSON.stringify(view);
    expect(all).not.toMatch(/was /);
    expect(all).not.toMatch(/"open"/);
  });

  it("the findings line stands on every state, measured or not", () => {
    for (const input of [FIXTURE_MOVEMENT, null, undefined, { reasons: {} }]) {
      expect(movementView(input).notes).toContain("Findings carry no lifecycle ledger.");
    }
  });

  it("an absent payload never throws and never invents a row", () => {
    expect(movementView(null).rows).toEqual([]);
    expect(movementView(undefined).rows).toEqual([]);
    expect(movementView({}).rows).toEqual([]);
  });

  // PERTURBATION: the defective rewrite, reproduced inline. Filling a null comparison's
  // previous count with a zero prints "was 0" — a claim that the register held nothing at a
  // sync that never happened, in exactly the ink a measured figure uses.
  it("the no-previous-count claim is falsified by a `prevOpen ?? 0` rewrite", () => {
    const defective = (cmp) => "32 open, was " + fmtCount((cmp && cmp.prevOpen) ?? 0);
    expect(defective(null)).toBe("32 open, was 0");
    // The real view emits no row at all for a null comparison, so there is no "was" to read.
    expect(JSON.stringify(movementView({
      previous: null, week: null, reasons: { previous: "oneSync", week: "noLedger" },
    }))).not.toContain("was ");
  });
});

// =========================================================================================
//  3. problems.js draws ONE header, and empties it on a first run
// =========================================================================================

/** Occurrences of `re` in `src`. */
function count(src, re) {
  return (src.match(re) || []).length;
}

/**
 * Every `pageHeader({ … })` call's opening window — wide enough to see whether it carries a
 * `hero:`, and CUT AT THE NEXT CALL so two headers close together are never counted as one.
 *
 * A plain `/pageHeader\(\{[\s\S]{0,400}/g` match does exactly that: the first window swallows
 * the second call and the sweep reports one header where the source has two. The
 * perturbation at the end of this file is written with both calls inside 400 characters
 * precisely because that is the shape the naive form cannot see.
 */
function pageHeaderWindows(src) {
  const out = [];
  const re = /pageHeader\(\{/g;
  let m;
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index + m[0].length);
    const next = rest.indexOf("pageHeader({");
    out.push(rest.slice(0, next === -1 ? 400 : Math.min(400, next)));
  }
  return out;
}

describe("the page calls one shared header, in both modes", () => {
  it("exactly one pageHeader call carries a hero", () => {
    const windows = pageHeaderWindows(PROBLEMS);
    // Two calls: the static title block (route/lede/help, no figure) and the header block.
    expect(windows.length, "problems.js calls pageHeader nowhere").toBeGreaterThan(0);
    const withHero = windows.filter((w) => /\bhero:/.test(w));
    expect(withHero.length, "problems.js builds " + withHero.length + " figure headers; the "
      + "two register modes must share ONE").toBe(1);
  });

  it("the hero is the half-life, read through the view model rather than formatted inline", () => {
    expect(PROBLEMS).toContain('heroStat(\n        "Issue half-life",');
    expect(PROBLEMS).toMatch(/halfLifeView\(data && data\.halfLife\)/);
    // The retired pair: neither builder may come back.
    expect(PROBLEMS).not.toMatch(/function\s+kpiRow\s*\(/);
    expect(PROBLEMS).not.toMatch(/function\s+actionHeadline\s*\(/);
  });

  it("the stat strip is EMPTIED on a first run, never filled with zeros", () => {
    expect(PROBLEMS, "problems.js does not empty its stat strip on the first run")
      .toMatch(/stats: first\.show \? \[\] :/);
  });

  it("the movement aside is dropped on a first run too", () => {
    expect(PROBLEMS).toMatch(/aside: first\.show \? null : renderMovement\(/);
  });

  it("the foot of the page links to the two pages behind the freshness line", () => {
    expect(PROBLEMS).toContain('href: "#/data"');
    expect(PROBLEMS).toContain('href: "#/scans"');
    expect(PROBLEMS).toMatch(/sectionLabel\("Last sync", \{ term: "sync" \}\)/);
    expect(PROBLEMS).toMatch(/statusPill\("neutral", "Dry run"/);
  });

  it("no canvas is built above the first-run return", () => {
    const gate = /if \(first\.show\) \{[\s\S]{0,600}?\n\s*return;\s*\n\s*\}/.exec(PROBLEMS);
    expect(gate, "problems.js has no first-run gate").not.toBeNull();
    const returnAt = gate.index + gate[0].length;
    const canvasAt = PROBLEMS.indexOf('el("canvas"');
    expect(canvasAt, "problems.js draws no canvas at all — nothing to check").toBeGreaterThan(-1);
    expect(returnAt, "a first run would paint a chart over a register nobody has synced")
      .toBeLessThan(canvasAt);
  });

  it("the cover curve sits in a chart-card in the body, not in the header aside", () => {
    expect(PROBLEMS).toMatch(/function coverCard\(data\)/);
    expect(PROBLEMS).toMatch(/target\.append\(coverCard\(data\)\);/);
    // One canvas, one table under it: the count P1.2's own registry pins.
    expect(count(PROBLEMS, /el\("canvas"/g)).toBe(1);
    expect(count(PROBLEMS, /\bchartTable\(\{/g)).toBe(1);
  });

  // PERTURBATION: the two shape claims above, run through the SAME functions against source
  // that breaks each of them. A `stats: stats` header fills the strip on a first run (four
  // zeros over a register nobody synced), and a second `hero:` header is the two-modes-two-
  // pages defect this package closed.
  it("the shape checks catch a filled strip and a second figure header", () => {
    const REGRESSED = `
      main.append(pageHeader({ route: "problems", lede: "x" }));
      function renderHeader(activeView, data) {
        const stats = buildStats(data);
        return pageHeader({ hero: heroStat("Issue half-life", null, "x"), stats: stats });
      }
      function actionHeadline(data) {
        return pageHeader({ hero: heroStat("Open problems", "38", "x"), stats: [] });
      }
    `;
    const stripped = code(REGRESSED);
    expect(pageHeaderWindows(stripped).filter((w) => /\bhero:/.test(w)).length).toBe(2);
    expect(stripped).not.toMatch(/stats: first\.show \? \[\] :/);
    expect(stripped).toMatch(/function\s+actionHeadline\s*\(/);
  });
});
