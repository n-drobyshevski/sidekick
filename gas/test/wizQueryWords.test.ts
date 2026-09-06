// A FILTER THAT REACHES THE SCREEN UNNAMED IS THE DEFECT THIS FILE EXISTS FOR.
//
// The Overview line publishes `BASE_FILTER_WORDS` as "these are the base filters this
// register's query carries". That is a claim about `BASE_VARIABLES.filterBy`, and the two can
// drift in exactly one direction that nothing else would catch: someone adds a filter key
// upstream (`wizQuery.ts` is GENERATED from os_vulns.py, so it can change without anyone here
// touching a line of prose), the population narrows, every count on the page falls, and the
// line still lists the old filters as if it were complete. A shorter list is not a smaller
// caveat; it is a wrong one.
//
// So the count is bound to the filter's own keys rather than written down.

import { describe, expect, it } from "vitest";

import { BASE_VARIABLES } from "../src/server/wizQuery";
import { BASE_FILTER_WORDS, UNNAMED_FILTER_KEYS } from "../src/server/wizClient";

type Rec = Record<string, unknown>;

/**
 * The keys a word is owed: everything in `filterBy` except the severity gate (stated
 * separately, from the scan row that applied it) and the status list (the register's
 * definition of a finding, not a narrowing of the population).
 */
function nameableKeys(filterBy: Rec): string[] {
  const skip = new Set<string>(UNNAMED_FILTER_KEYS as readonly string[]);
  return Object.keys(filterBy).filter((k) => !skip.has(k));
}

const FILTER_BY = BASE_VARIABLES.filterBy as unknown as Rec;

describe("os: the base filter is named in full", () => {
  it("gives one word to every filter key that is not the gate or the status list", () => {
    const keys = nameableKeys(FILTER_BY);
    expect(
      BASE_FILTER_WORDS.length,
      `${keys.length} nameable filter key(s) [${keys.join(", ")}] but `
      + `${BASE_FILTER_WORDS.length} word(s) — a filter is on screen unnamed, or a word names `
      + "a filter that is no longer there",
    ).toBe(keys.length);
  });

  it("states the gate separately rather than as a filter word — it is not even in the base", () => {
    // buildVariables injects `severity` per scan from the settings; the baseline carries none.
    // A word for it here would be a second, stale statement of the gate the line already reads
    // off the scan row that applied it.
    expect(Object.keys(FILTER_BY)).not.toContain("severity");
    expect(Object.keys(FILTER_BY)).toContain("status");
  });

  it("keeps every word a distinct, short, digit-free phrase", () => {
    for (const w of BASE_FILTER_WORDS) {
      expect(typeof w).toBe("string");
      expect(w.trim().length, `"${w}" is empty`).toBeGreaterThan(0);
      expect(w.length, `"${w}" is too long to sit in a one-line caption`).toBeLessThanOrEqual(60);
      // The words describe the filter, never this tenant's counts — same rule helpContent
      // holds for the glossary.
      expect(w, `"${w}" quotes a figure`).not.toMatch(/\d/);
    }
    expect(new Set(BASE_FILTER_WORDS).size).toBe(BASE_FILTER_WORDS.length);
  });

  it("names no filter the query does not carry — hasFix is the live example", () => {
    // os_vulns.py still ships `hasFix: true`; this register dropped it deliberately (the
    // broadened, no-hasFix ingestion REMEDIATION_ROLLOUT_ISO dates). A word for it would
    // describe a narrowing that no longer happens.
    expect(Object.keys(FILTER_BY)).not.toContain("hasFix");
    for (const w of BASE_FILTER_WORDS) expect(w.toLowerCase()).not.toContain("fix");
  });

  // A guard that fires on nothing is a finding, not a pass: the same arithmetic is run against
  // a filter with one key added, and it has to disagree. If this stops failing, the check
  // above has stopped being a check.
  it("would fail if a filter key were added upstream and left unnamed", () => {
    const widened = { ...FILTER_BY, hasFix: true };
    expect(nameableKeys(widened).length).toBe(nameableKeys(FILTER_BY).length + 1);
    expect(BASE_FILTER_WORDS.length).not.toBe(nameableKeys(widened).length);
  });
});
