// The glossary's own shape contract. helpContent.js is prose, not logic, but a broken shape
// in it fails silently: a duplicate id shadows an entry nobody notices is unreachable, a
// missing `lines` array renders nothing where a tip card should be, and a card that only shows
// its first two lines (gas_shared/ui/tipPlace.js's `glossaryTipLines`) makes a run-on first
// line an invisible truncation rather than a build failure. This file is what turns those into
// a red test instead of a quiet gap.
//
// THE MODEL AND THE ROUTE ARE NOT HERE. `gas_shared/test/contracts/help.js` holds those, and
// test/pagesHelp.test.js registers it — this file is the half that is genuinely this
// register's: which words it defines, and whether the definitions still say what they were
// moved here to say.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allEntries, findEntry } from "../src/client/js/helpContent.js";

const ENTRIES = allEntries();

// The twenty-one definitions P7 lifted out of this register's own `tip(` call sites. Every one
// of them was already written somewhere in src/client/js; none is new copy. A renamed or
// dropped id fails here before it fails at a call site.
const EXPECTED_IDS = [
  "quick-refresh", "rule-health",
  "km-median", "naive-median", "vendor-fix-wait",
  "mttr-by-dimension", "mttr-contribution", "median-mttr-by-dimension",
  "triage-funnel", "risk-tiers",
  "coverage", "efficiency",
  "cell-tp", "cell-fp", "cell-fn", "cell-tn",
  "cell-unclassified-remediated", "cell-unclassified-open",
  "no-captured-signal", "coverage-efficiency-trend", "rule-sensitivity",
];

// Long enough for the three-line entries in the file (the longest first-two line today is 218
// characters), short enough that a paragraph masquerading as a tip line would still fail. The
// tip card renders only the first two. Same figure gas_devsecops uses, for the same reason.
const MAX_TIP_LINE_LENGTH = 220;

describe("os: allEntries", () => {
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
    // glossaryTipLines() shows only the first two lines; a run-on line there is an invisible
    // truncation, not a cosmetic overflow, so it is worth pinning here. Five of the seeded
    // entries were over this bar on the first pass and were split rather than trimmed.
    for (const e of ENTRIES) {
      for (const line of e.lines.slice(0, 2)) {
        expect(line.length, `${e.id}'s tip-card line is ${line.length} chars: "${line}"`)
          .toBeLessThanOrEqual(MAX_TIP_LINE_LENGTH);
      }
    }
  });

  it("quotes no figure from this tenant", () => {
    // NOTHING HERE READS A PAYLOAD, and prose is where that discipline breaks first: an entry
    // that stated "here 412 of 1,204" would be stale the next scan and would have no way to
    // say so. Live arithmetic stays at the call site that measured it — which is exactly why
    // the coverage and efficiency triggers kept their first line and took only `term`.
    //
    // A MEASURED figure, not any figure, and the difference is the whole assertion. "50%" in
    // the Kaplan-Meier entry is where the median is DEFINED to sit — a constant of the method,
    // true in every tenant — so the sweep looks for the two shapes a tenant figure actually
    // takes here: grouped thousands, and a percentage. Written this way after the first pass
    // flagged that 50%, which was this test being wrong rather than the prose.
    const METHOD_CONSTANTS = ["50%"];
    for (const e of ENTRIES) {
      let text = e.lines.join(" ");
      for (const c of METHOD_CONSTANTS) text = text.split(c).join("");
      expect(text, `${e.id} quotes a grouped figure`).not.toMatch(/\b\d{1,3}(,\d{3})+\b/);
      expect(text, `${e.id} quotes a measured percentage`).not.toMatch(/\b\d+(\.\d+)?%/);
    }
  });
});

describe("os: findEntry", () => {
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

// The measurement decisions the seeded entries carry. These are not restatements of the entry
// text — each pins the fact the entry has to get right, so a future edit that keeps the prose
// fluent but drifts the claim fails loudly instead of shipping.
describe("os: the measurement decisions the seeded entries encode", () => {
  const text = (id) => findEntry(id).lines.join(" ").toLowerCase();

  it("km-median: censors the still-open, and states the lower-bound notation", () => {
    const t = text("km-median");
    expect(t).toContain("censored");
    // The "> X d" reading is the whole reason this figure needs an entry: without it the
    // hero's own value is unreadable.
    expect(t).toContain("> x d");
    expect(t).toMatch(/at least/);
  });

  it("naive-median: says it is the BIASED comparison, not the better number", () => {
    const t = text("naive-median");
    expect(t).toMatch(/closed findings only/);
    expect(t).toMatch(/biases this down|biased/);
    expect(t).not.toMatch(/censored observation/);
  });

  it("vendor-fix-wait: censors rather than drops, and refuses a zero-length wait", () => {
    const t = text("vendor-fix-wait");
    expect(t).toContain("censored, not dropped");
    expect(t).toMatch(/never counted as a zero-length wait/);
  });

  it("quick-refresh: says deletions are NOT detected", () => {
    // The trap the whole entry exists for. A quick refresh that silently left resolved
    // findings open is the one way this control can lie about the register.
    expect(text("quick-refresh")).toMatch(/deletions aren't detected/);
  });

  it("rule-health: names all four states and separates Malformed from Never matches", () => {
    const t = text("rule-health");
    for (const state of ["fires", "shadowed", "never matches", "malformed"]) {
      expect(t, `rule-health omits "${state}"`).toContain(state);
    }
    expect(t).toMatch(/first-match/);
  });

  it("coverage and efficiency: each names its ratio and refuses to stand alone", () => {
    expect(text("coverage")).toContain("tp / (tp + fn)");
    expect(text("efficiency")).toContain("tp / (tp + fp)");
    expect(text("coverage")).toMatch(/never published apart|read it against efficiency/);
  });

  it("the four 2x2 cells say which rate each one moves", () => {
    expect(text("cell-tp")).toMatch(/numerator of both/);
    expect(text("cell-fp")).toMatch(/pulls efficiency down/);
    expect(text("cell-fn")).toMatch(/pulls coverage down/);
    expect(text("cell-tn")).toMatch(/neither/);
  });

  it("the unclassified pair sits OUTSIDE the 2x2 rather than in a corner of it", () => {
    for (const id of ["cell-unclassified-remediated", "cell-unclassified-open",
      "no-captured-signal"]) {
      expect(text(id), `${id} does not say it is excluded`).toMatch(/excluded|outside/);
    }
    // Absent is never zero: unscored is a different claim from not high risk.
    expect(text("no-captured-signal")).toMatch(/not low risk|unscored/);
    expect(text("cell-unclassified-open")).toMatch(/not the same claim as not high risk/);
  });

  it("coverage-efficiency-trend: says the classification is NOT replayed per date", () => {
    const t = text("coverage-efficiency-trend");
    expect(t).toMatch(/not re-evaluated per date/);
    expect(t).toMatch(/reconstructed/);
    expect(t).toMatch(/under-counted/);
  });

  it("rule-sensitivity: says the ground truth is the rule itself", () => {
    const t = text("rule-sensitivity");
    expect(t).toMatch(/ground truth here is the rule itself/);
    expect(t).toMatch(/narrow rule/);
  });

  it("the three by-dimension entries are dimension-NEUTRAL", () => {
    // The call sites interpolate the active grouping noun ("MTTR by domain"); the entries
    // must not, or the book would state one register's control state as a definition.
    for (const id of ["mttr-by-dimension", "mttr-contribution", "median-mttr-by-dimension"]) {
      const t = findEntry(id).term + " " + text(id);
      expect(t, `${id} names a specific dimension`).not.toMatch(/\bdomain\b|resource group/i);
    }
  });

  it("mttr-contribution and median-mttr-by-dimension each name the other", () => {
    // They are two lenses on one card, and each is only readable against the other: rate
    // against leverage. An entry that described its lens alone would be half a definition.
    expect(text("mttr-contribution")).toMatch(/leverage, not rate/);
    expect(text("median-mttr-by-dimension")).toMatch(/contribution to mttr/);
  });
});

// =========================================================================================
//  The seed came out of the pages, and the pages now reach back for it
// =========================================================================================
//
// The claim this package rests on is "the sentence lives once". That is only true if the
// entries and the call sites are actually joined, so this reads the pages as source text and
// checks both halves: every id here is reached by at least one page, and no page still carries
// the sentence it handed over.
describe("os: the seeded entries reach their call sites", () => {
  const src = (rel) => readFileSync(new URL("../src/client/js/" + rel, import.meta.url), "utf8");
  const SOURCES = [
    "app.js", "pages/attribution.js", "pages/executive.js", "pages/mttr.js",
    "pages/overview.js", "pages/program.js",
  ].map(src).join("\n");

  it("names every entry id at least once, across the six pages the copy came from", () => {
    const unreached = ENTRIES.map((e) => e.id).filter((id) => !SOURCES.includes(`"${id}"`));
    expect(unreached, "seeded entries no call site reaches").toEqual([]);
  });

  it("leaves no page still restating a sentence the book now owns", () => {
    // One phrase per entry that was UNIQUE to the copy that moved. A page that still carries
    // one of these has a second copy of the definition, which is the drift this package
    // exists to end — and it is exactly what the Kaplan–Meier entry was suffering from, in
    // two files, before it moved.
    const MOVED = [
      "count as censored observations instead of being ignored",
      "means the curve never dropped to 50%",
      "Fires — claims findings under first-match priority",
      "Work correctly left undone",
      "Outside the 2×2 on purpose",
      "Both rates recomputed at each date",
      "Up and to the right is better",
      "Each step is a strict subset of the one above it",
      "Deletions aren't detected — run a full scan for those",
    ];
    for (const phrase of MOVED) {
      expect(SOURCES, `a page still restates: "${phrase}"`).not.toContain(phrase);
    }
  });
});
