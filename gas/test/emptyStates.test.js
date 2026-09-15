// First-run states of THIS register, and the two things it kept confusing with them.
//
// THE SHARED HALF LIVES IN gas_shared/test/contracts/emptyStates.js, registered from
// test/shared.test.js: a failure is never dressed as an absence, a first-run notice is the
// same component on every page that carries it, and an empty state says when it looked.
// What stayed here is the two claims that are true of THIS app's own pages and could not be
// stated over the shared contract's route-name-only view of them.
//
// PORTED FROM gas_devsecops/test/emptyStates.test.js's SHAPE — see that file's own header —
// but this half is smaller: gas_devsecops's local file also pins its own view-function
// arithmetic (executiveFirstRunView, kmP90View, rateView), which this package did not touch.
// What P1.3 actually changed on this register is WHERE a page's first-run return sits
// relative to its content, and whether a dated empty state actually carries a date — so
// those are the two things pinned here.
//
// WHY SOURCE TEXT. There is no jsdom in this app (vitest.config.ts sets no `environment`), and
// both claims are about the SHAPE of a module's source (does a return precede a draw call; does
// a call pass a named argument) rather than about any one rendered output. `code()` strips
// comments first (both `//` and `/* */`), so a doc comment quoting the patterns below — this
// file's own header included — never trips its own guard.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);

function pageSource(route) {
  return code(readFileSync(new URL(route + ".js", PAGES_DIR), "utf8"));
}

// =========================================================================================
//  1. The first-run return sits BEFORE any content it would otherwise draw
// =========================================================================================
//
// history.js and overview.js each gate their whole page on `!boot.latestScan` and return —
// no KPI cards, no table, no charts — rather than the earlier shape, where the page-wide
// `emptyState`/return sat ABOVE hosts that were about to be filled a few lines later in the
// SAME function on a re-render, or (history.js, before P1.3) sat nowhere at all: the KPI band
// painted straight off the RPC response with no gate of its own. A page that draws its return
// after the first canvas/card call it owns would ship both the notice and the content it is
// supposed to replace.

/** The index just after a `firstRunNotice({ … }); return;` pair — literally, the shape a
 *  page-level first-run gate takes here: the notice appended, then an explicit early return
 *  in the very next statement. -1 when the file has no such pair at all. */
function firstRunReturnIndex(stripped) {
  const m = /firstRunNotice\(\{[\s\S]{0,400}?\}\)\);?\s*\n\s*return;/.exec(stripped);
  return m ? m.index + m[0].length : -1;
}

/** The earliest point the page draws a canvas or a KPI card — the two content shapes every
 *  route this package touched actually uses. -Infinity is never returned: a file with
 *  neither has nothing for the first-run return to precede, so that file is not asserted on. */
function firstContentIndex(stripped) {
  const idxs = [stripped.indexOf('el("canvas"'), stripped.indexOf("kpiCard(")]
    .filter((i) => i !== -1);
  return idxs.length ? Math.min(...idxs) : Infinity;
}

describe("history and overview return before drawing any content on first run", () => {
  for (const route of ["history", "overview"]) {
    it(`pages/${route}.js's first-run branch precedes its own canvas/kpiCard content`, () => {
      const stripped = pageSource(route);
      const returnAt = firstRunReturnIndex(stripped);
      expect(returnAt, `pages/${route}.js has no firstRunNotice({ … }); return; pair in source`)
        .toBeGreaterThan(-1);
      const contentAt = firstContentIndex(stripped);
      expect(contentAt, `pages/${route}.js has neither el("canvas" nor kpiCard( — nothing for `
        + "the first-run return to precede; this route may no longer belong in this describe")
        .not.toBe(Infinity);
      expect(returnAt, `pages/${route}.js draws canvas/kpiCard content BEFORE its first-run `
        + "return — a first run would paint both the notice and the content it replaces")
        .toBeLessThan(contentAt);
    });
  }

  // PERTURBATION: the defective ordering this describe exists to catch, run through the SAME
  // two functions the real files go through.
  it("the check catches content drawn before the first-run return", () => {
    const REGRESSED = `
      export async function renderThing(main) {
        const kpiRow = el("div", {});
        kpiRow.append(kpiCard("Tracked", "0"));
        if (!boot.latestScan) {
          main.append(firstRunNotice({ synced: false }));
          return;
        }
      }
    `;
    const stripped = code(REGRESSED);
    expect(firstRunReturnIndex(stripped)).toBeGreaterThan(-1);
    expect(firstContentIndex(stripped)).toBeLessThan(firstRunReturnIndex(stripped));
  });
});

// =========================================================================================
//  2. Every measuredEmpty() call actually carries a date
// =========================================================================================
//
// `measuredEmpty(message, { at, hint })` is what tells a reader "we looked, and here is
// when" apart from a plain `emptyState` that cannot say that at all — the whole reason a page
// reaches for it over the plain component. A call that FORGOT the `at:` would still compile,
// still render, and would look identical to a correctly-dated one in a code review that only
// checked "did this page import measuredEmpty" — so the sweep reads the actual argument list.

/** `measuredEmpty(` followed, before the first `{`, by the message argument, then an object
 *  literal carrying `at:` before its own close. Mirrors the shared contract's own
 *  `firstRunNotice(\{[^}]*\bat:` technique (emptyStates.js) for the same reason: a single-
 *  level brace scan is enough here because neither call ever nests a second `{` inside its
 *  options object. */
const MEASURED_EMPTY_WITH_AT = /measuredEmpty\([^{]*\{[^}]*\bat:/g;

function measuredEmptyCallCount(stripped) {
  return (stripped.match(/measuredEmpty\(/g) || []).length;
}
function measuredEmptyWithAtCount(stripped) {
  return (stripped.match(MEASURED_EMPTY_WITH_AT) || []).length;
}

describe("every measuredEmpty() call passes an at:", () => {
  it("pages/overview.js: every measuredEmpty( call carries at: in its options object", () => {
    const stripped = pageSource("overview");
    const total = measuredEmptyCallCount(stripped);
    expect(total, "no measuredEmpty( calls at all — this describe has nothing to check; if "
      + "overview.js genuinely dropped its last one, delete this it() with that reason")
      .toBeGreaterThan(0);
    expect(measuredEmptyWithAtCount(stripped), `${total} measuredEmpty( call(s) in overview.js, `
      + "not all of them carry at: — a filter-empty state with no date reads exactly like one "
      + "that never measured anything").toBe(total);
  });

  // NOT A VACUOUS SWEEP. The check above only bites where measuredEmpty( already carries
  // `at:`; this perturbation proves the counting function actually catches a call that is
  // missing it, rather than passing on any input by construction.
  it("the sweep catches a measuredEmpty( call with no at:", () => {
    const REGRESSED = `
      function renderNothing() {
        return measuredEmpty("Nothing to show.", { hint: "try again later" });
      }
    `;
    const stripped = code(REGRESSED);
    expect(measuredEmptyCallCount(stripped)).toBe(1);
    expect(measuredEmptyWithAtCount(stripped)).toBe(0);
  });

  it("the sweep's stripper does not fire on a comment merely mentioning measuredEmpty", () => {
    const commentOnly = `
      // measuredEmpty("Nothing to show.") used to have no at: — see history
      export function render() { return "fine"; }
    `;
    expect(measuredEmptyCallCount(code(commentOnly))).toBe(0);
  });
});
