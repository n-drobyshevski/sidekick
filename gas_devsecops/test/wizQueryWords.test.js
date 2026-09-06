// A FILTER THAT REACHES THE SCREEN UNNAMED IS THE DEFECT THIS FILE EXISTS FOR.
//
// Each register page now publishes `BASE_FILTER_WORDS[scope]` as "these are the base filters
// this register's query carries". That is a claim about `BASE[scope]` in wizQueries.ts, and
// the two can drift in exactly one direction nothing else would catch: someone adds a
// narrowing key upstream, the population shrinks, every count on the page falls, and the line
// still lists the old filters as though it were complete. A shorter caveat is not a smaller
// one; it is a wrong one.
//
// So the count is bound to each scope's own key list rather than written down.
//
// PER SCOPE, because the filters are. `hasFix` narrows SCA and nothing else; SAST's
// default-branch gate is nested under `resource` while SCA's is top-level; secrets carries
// neither. One shared list would have to be wrong about two registers to be right about one.

import { describe, expect, it } from "vitest";

import { SCOPES } from "../src/domain/config";
import { BASE_FILTER_WORDS, UNNAMED_FILTER_KEYS, baseFilterKeys } from "../src/server/wizQueries";

/**
 * The keys a word is owed: every key of this scope's base filter except the ones the words
 * deliberately do not name.
 *
 * `status` is the register's DEFINITION of a finding (`["OPEN", "RESOLVED"]` is every state
 * the ledger has a clock for), not a narrowing of the population — naming it would read as an
 * exclusion that is not one. `severity` is the scan's own gate, stated separately from the
 * scan row that applied it, and is not in `BASE` at all.
 */
function nameableKeys(keys) {
  const skip = new Set(UNNAMED_FILTER_KEYS);
  return keys.filter((k) => !skip.has(k));
}

describe("dso: each register's base filter is named in full", () => {
  it("covers exactly the three scopes, with no fourth quietly unnamed", () => {
    expect(Object.keys(BASE_FILTER_WORDS).sort()).toEqual([...SCOPES].sort());
  });

  for (const scope of SCOPES) {
    it(`${scope}: gives one word to every narrowing key of its base filter`, () => {
      const keys = nameableKeys(baseFilterKeys(scope));
      expect(
        BASE_FILTER_WORDS[scope].length,
        `${scope} has ${keys.length} nameable filter key(s) [${keys.join(", ")}] but `
        + `${BASE_FILTER_WORDS[scope].length} word(s) — a filter is on screen unnamed, or a `
        + "word names a filter that is no longer there",
      ).toBe(keys.length);
    });
  }

  it("names the deliberately unnamed keys rather than leaving them to be re-decided", () => {
    // Spelled out here so a later reader does not have to reverse-engineer the exclusion from
    // an arithmetic mismatch. `status` really is in two of the three base filters; `severity`
    // is in none of them, because buildFilter injects it per sync.
    expect([...UNNAMED_FILTER_KEYS].sort()).toEqual(["severity", "status"]);
    expect(baseFilterKeys("sca")).toContain("status");
    expect(baseFilterKeys("secrets")).toContain("status");
    // SAST carries no status key at all — SAST_FETCH_RESOLVED is false, so the document asks
    // for the default population rather than naming states.
    expect(baseFilterKeys("sast")).not.toContain("status");
    for (const scope of SCOPES) expect(baseFilterKeys(scope)).not.toContain("severity");
  });

  it("names hasFix on sca and nowhere else — it is the one scope with a vendor", () => {
    // The withdrawn-fix gap (`sync.ts`): a fix that is retracted drops the finding out of the
    // filtered population, and leaving the population is what disappearance-resolution means.
    // A reader owed the count is owed the filter that can move it.
    expect(baseFilterKeys("sca")).toContain("hasFix");
    expect(BASE_FILTER_WORDS.sca.join(" ").toLowerCase()).toContain("fix");
    for (const scope of ["sast", "secrets"]) {
      expect(baseFilterKeys(scope)).not.toContain("hasFix");
      expect(BASE_FILTER_WORDS[scope].join(" ").toLowerCase()).not.toContain("fix");
    }
  });

  it("keeps every word a distinct, short, digit-free phrase", () => {
    for (const scope of SCOPES) {
      for (const w of BASE_FILTER_WORDS[scope]) {
        expect(typeof w).toBe("string");
        expect(w.trim().length, `"${w}" is empty`).toBeGreaterThan(0);
        expect(w.length, `"${w}" is too long for a one-line caption`).toBeLessThanOrEqual(70);
        // The words describe the FILTER, never this tenant's counts — the same rule the
        // glossary holds. A figure in here would go stale without anything failing.
        expect(w, `"${w}" quotes a figure`).not.toMatch(/\d/);
      }
      expect(new Set(BASE_FILTER_WORDS[scope]).size).toBe(BASE_FILTER_WORDS[scope].length);
    }
  });

  // A GUARD THAT FIRES ON NOTHING IS A FINDING, NOT A PASS. The same arithmetic is run
  // against each scope's key list with one key added, and it has to disagree with the word
  // count. If this stops failing, the per-scope check above has stopped being a check.
  it("would fail on every scope if a narrowing key were added upstream and left unnamed", () => {
    for (const scope of SCOPES) {
      const widened = [...baseFilterKeys(scope), "vcsDetails"];
      expect(nameableKeys(widened).length).toBe(nameableKeys(baseFilterKeys(scope)).length + 1);
      expect(BASE_FILTER_WORDS[scope].length).not.toBe(nameableKeys(widened).length);
    }
  });
});
