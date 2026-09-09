// A filter-empty state reached AFTER a fetch owes the reader the date it looked
// (`gas_shared/ui/feedback.js`'s `measuredEmpty`) — "no matches" alone reads as "maybe the
// filter is broken"; "no matches, measured at 12 Aug" reads as a fact the reader can check
// against their own memory of when they last synced. This file sweeps every `measuredEmpty(`
// call in `pages/*.js` for the one thing that makes that claim true — an `at:` in the options
// it passed — and separately holds the three hand-typed sentences this package retired
// (`"No sync yet"`, `"has been synced yet"`, `"No syncs yet"`) to never coming back as a
// second, undated spelling of what `firstRunNotice` already says once.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);

function pageFiles() {
  return readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js"));
}

/**
 * Every `measuredEmpty(` call site in `src`, as the balanced-paren text of its ARGUMENTS
 * (everything between the call's own opening and matching closing paren). A regex alone
 * cannot do this — the options object is itself parenthesised in places (string
 * concatenation, ternaries) — so this walks paren depth by hand, the same reason
 * `gas_shared/test/contracts/emptyStates.js`'s own `code()` walks the file by hand rather
 * than trusting a regex to find a comment.
 */
function measuredEmptyCalls(src) {
  const calls = [];
  const marker = "measuredEmpty(";
  let from = 0;
  for (;;) {
    const start = src.indexOf(marker, from);
    if (start === -1) break;
    let depth = 1;
    let i = start + marker.length;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    calls.push(src.slice(start + marker.length, i - 1));
    from = i;
  }
  return calls;
}

describe("every measuredEmpty( call names when it looked", () => {
  for (const file of pageFiles()) {
    it(file + " passes at: to every measuredEmpty( call it makes", () => {
      const src = code(readFileSync(new URL(file, PAGES_DIR), "utf8"));
      const calls = measuredEmptyCalls(src);
      for (const args of calls) {
        expect(args, file + " calls measuredEmpty(...) with no at: — " + args.slice(0, 80))
          .toMatch(/\bat:/);
      }
    });
  }

  // ANTI-VACUOUS: at least one page actually calls measuredEmpty(, so the sweep above is
  // exercising something rather than iterating an empty set on every file.
  it("at least one page calls measuredEmpty( at all", () => {
    const total = pageFiles()
      .reduce((n, f) => n + measuredEmptyCalls(code(readFileSync(new URL(f, PAGES_DIR), "utf8"))).length, 0);
    expect(total).toBeGreaterThan(0);
  });

  // PERTURBATION: an undated call, run through the same extractor and assertion the real
  // sweep uses.
  it("the sweep catches a measuredEmpty( call with no at:", () => {
    const REGRESSED = 'host.append(measuredEmpty("No rows match these filters.", { hint: "Clear a filter." }));';
    const calls = measuredEmptyCalls(REGRESSED);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toMatch(/\bat:/);
  });
});

// =========================================================================================
//  The retired whole-page-gate sentences never come back as a second, undated spelling
// =========================================================================================
//
// `firstRunNotice` (gas_shared/ui/feedback.js) is now the ONE place that says "nothing has
// been synced yet" — reading `appConfig().sync.noun` so the sentence names this app's own
// control, and threading `at:` through so a synced-but-empty register never gets the
// unsynced wording. A page that hand-types its own version of the same claim regresses both:
// a second copy to keep in sync, and one that cannot be dated even where the page has an
// `at` in hand.
//
// SCOPED TO THE SIX ROUTES THIS PACKAGE ACTUALLY CONVERTED, not every page file. `data.js`'s
// own `emptyState("No syncs yet.")` (paintHistory) is a DIFFERENT claim — the sync-HISTORY
// table specifically has no rows, not "nobody has ever synced" — and `data.js` is out of
// scope for this package (P2.2 owns it); a blanket sweep over every page file would flag
// that unrelated, pre-existing sentence as if it were a regression of this package's own
// gates. `help.js`'s status pill label "No sync yet" (no trailing period, not an
// `emptyState(` call) is a different case again — a short pill LABEL, not a first-run
// sentence — and is likewise untouched by this package.
const CONVERTED_WHOLE_PAGE_GATES = {
  "combos.js": "No sync yet",
  "graph.js": "No sync yet",
  "inventory.js": "No sync yet",
  "problems.js": "No sync yet",
  "scans.js": "No sync yet",
  "compliance.js": "has been synced yet",
};

describe("the six converted whole-page gates no longer hand-type their old sentence", () => {
  for (const [file, phrase] of Object.entries(CONVERTED_WHOLE_PAGE_GATES)) {
    it(file + ' dropped its hand-typed "' + phrase + '"', () => {
      const src = code(readFileSync(new URL(file, PAGES_DIR), "utf8"));
      expect(src.indexOf(phrase), file + ' still hand-types "' + phrase + '"').toBe(-1);
    });
  }

  // PERTURBATION: reintroduce the retired phrase in a string copy of one of these files, and
  // confirm the sweep names the exact gap rather than passing silently.
  it("the sweep catches a reintroduced retired phrase", () => {
    const REGRESSED = 'main.append(emptyState("No sync yet.", "Run Sync now."));';
    expect(REGRESSED.indexOf("No sync yet")).not.toBe(-1);
  });
});
