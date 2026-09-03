// The glossary's own shape contract. helpContent.js is prose, not logic, but a broken shape
// in it fails silently: a duplicate id shadows an entry nobody notices is unreachable, a
// missing `lines` array renders nothing where a tip card should be, and a card that only
// shows its first two lines (ui/tip.js's `glossaryTipLines`) makes a run-on first line an
// invisible truncation rather than a build failure. This file is what turns those into a
// red test instead of a quiet gap.

import { describe, expect, it } from "vitest";
import { allEntries, findEntry } from "../src/client/js/helpContent.js";

const ENTRIES = allEntries();

// The ids C6 was asked to add, plus the ten that were already there — the full expected
// vocabulary. A renamed or dropped id fails here before it fails at a call site.
const EXPECTED_IDS = [
  "half-life", "censoring", "sla-target", "sast", "sca", "awaiting-fix",
  "two-clocks", "secret-resolved", "coverage", "efficiency",
  "validation-state", "rotated", "removed", "time-to-revoke",
  "foothold", "capacity", "mmcr", "reconstructed", "unclassified",
  "cwe-top-25", "twin",
];

// Long enough for the three-line entries already in the file (the longest today is 164
// characters including its quotes), short enough that a paragraph masquerading as a tip
// line would still fail. The tip card renders only the first two.
const MAX_TIP_LINE_LENGTH = 220;

describe("allEntries", () => {
  it("holds exactly the ids this register expects, in some order", () => {
    expect(ENTRIES.map((e) => e.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("gives every id kebab-case spelling", () => {
    for (const e of ENTRIES) {
      expect(e.id, `${e.id} is not kebab-case`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("never repeats an id", () => {
    const ids = ENTRIES.map((e) => e.id);
    expect(new Set(ids).size, "a duplicate id shadows an entry").toBe(ids.length);
  });

  it("gives every entry a non-empty term", () => {
    for (const e of ENTRIES) {
      expect(typeof e.term, `${e.id}.term`).toBe("string");
      expect(e.term.trim().length, `${e.id}.term is empty`).toBeGreaterThan(0);
    }
  });

  it("gives every entry 2 or 3 lines, each a non-empty string", () => {
    for (const e of ENTRIES) {
      expect(Array.isArray(e.lines), `${e.id}.lines is not an array`).toBe(true);
      expect(e.lines.length, `${e.id} has ${e.lines.length} lines`).toBeGreaterThanOrEqual(2);
      expect(e.lines.length, `${e.id} has ${e.lines.length} lines`).toBeLessThanOrEqual(3);
      for (const line of e.lines) {
        expect(typeof line, `${e.id} has a non-string line`).toBe("string");
        expect(line.trim().length, `${e.id} has an empty line`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the first two lines short enough to stand alone in a tip card", () => {
    // ui/tip.js's glossaryTipLines() shows only the first two lines; a run-on line there is
    // an invisible truncation, not a cosmetic overflow, so it is worth pinning here.
    for (const e of ENTRIES) {
      for (const line of e.lines.slice(0, 2)) {
        expect(line.length, `${e.id}'s tip-card line is ${line.length} chars: "${line}"`)
          .toBeLessThanOrEqual(MAX_TIP_LINE_LENGTH);
      }
    }
  });
});

describe("findEntry", () => {
  it("resolves every id case-insensitively and with surrounding whitespace", () => {
    for (const id of EXPECTED_IDS) {
      expect(findEntry(id)?.id).toBe(id);
      expect(findEntry(id.toUpperCase())?.id).toBe(id);
      expect(findEntry(` ${id} `)?.id).toBe(id);
    }
  });

  it("returns null rather than guessing for an id the book does not hold", () => {
    expect(findEntry("not-a-real-term")).toBeNull();
    expect(findEntry("")).toBeNull();
    expect(findEntry(null)).toBeNull();
    expect(findEntry(undefined)).toBeNull();
  });
});

// The specific measurement decisions C6 was asked to encode. These are not restatements of
// the entry text — each pins the fact the entry has to get right, so a future edit that
// keeps the prose fluent but drifts the claim (e.g. "removed" quietly becoming "resolved")
// fails loudly instead of shipping.
describe("the measurement decisions in the new entries", () => {
  const text = (id) => findEntry(id).lines.join(" ").toLowerCase();

  it("validation-state: names all four states and says UNKNOWN/ERROR are unmeasured", () => {
    const t = text("validation-state");
    for (const state of ["unknown", "valid", "invalid", "error"]) {
      expect(t, `validation-state omits "${state}"`).toContain(state);
    }
    expect(t).toMatch(/unmeasured|nobody has checked|neither/);
  });

  it("rotated: is the credential dying, not the string leaving the code", () => {
    const t = text("rotated");
    expect(t).toMatch(/dead|invalid/);
    expect(t).not.toMatch(/left the (code|repository)/);
  });

  it("removed: is the string leaving HEAD, and says removed is not rotated", () => {
    const t = text("removed");
    expect(t).toMatch(/head|repository/);
    expect(t).toContain("not rotated");
  });

  it("time-to-revoke: excludes the never-validated rather than censoring them", () => {
    const t = text("time-to-revoke");
    expect(t).toContain("excluded");
    expect(t).not.toMatch(/censored, not excluded/);
  });

  it("foothold: one open high-risk finding is enough, on a repo or a language group", () => {
    const t = text("foothold");
    expect(t).toMatch(/repository|repo/);
    expect(t).toMatch(/language/);
    expect(t).toMatch(/high-risk/);
  });

  it("capacity: is a monthly verdict, not a single number", () => {
    const t = text("capacity");
    expect(t).toContain("month");
    expect(t).toMatch(/gaining|falling behind|keeping up/);
  });

  it("mmcr: divides by the month's starting backlog, not by arrivals or the whole register", () => {
    const t = text("mmcr");
    expect(t).toMatch(/start of that month|starting backlog/);
  });

  it("reconstructed: marks a rebuilt month rather than a measured one", () => {
    const t = text("reconstructed");
    expect(t).toMatch(/rebuilt|reconstructed/);
    expect(t).toMatch(/not.*measured|not measured/);
  });

  it("unclassified: sits outside the 2x2, never folded into a corner", () => {
    const t = text("unclassified");
    expect(t).toMatch(/outside/);
    expect(t).toMatch(/2×2|2x2|quadrant/);
  });

  it("cwe-top-25: is the 2024 list, and states the child-folds-to-parent rule with an example", () => {
    const t = text("cwe-top-25");
    expect(t).toContain("2024");
    expect(t).toMatch(/cwe-23/);
    expect(t).toMatch(/cwe-22/);
  });

  it("twin: keys on (secret, path, line) and keeps the earliest birth date", () => {
    const t = text("twin");
    expect(t).toMatch(/path/);
    expect(t).toMatch(/line/);
    expect(t).toMatch(/earlier|earliest/);
    expect(t).toContain("187");
  });
});
