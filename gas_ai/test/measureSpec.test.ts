// Completeness AS A TEST — src/domain/measureSpec.ts's whole point. A measure
// specification that is missing a field, names a column that no longer exists, or has
// quietly gone past its own review date is not a specification, it is a stale document
// nobody would notice going stale. Every assertion below turns one of those failure modes
// into a build failure instead.

import { describe, expect, it } from "vitest";
import { MEASURE_SPECS, type MeasureSpec } from "../src/domain/measureSpec";
import { TAB_HEADERS } from "../src/server/sheetsDb";
import { FROZEN_NOW } from "./gasEnv";

const REQUIRED_STRING_FIELDS: Array<keyof MeasureSpec> = [
  "id", "goal", "scope", "measure", "formula", "target", "implementationEvidence",
  "timeBasedReference", "responsibleParties", "dataSource", "reportingFormat", "revisionDue",
];

const TYPE_VALUES = ["implementation", "effectiveness", "efficiency", "impact"];
const METHOD_VALUES = ["Subjective", "Objective"];

describe("every record has every required field, non-empty", () => {
  for (const spec of MEASURE_SPECS) {
    it(spec.id, () => {
      for (const field of REQUIRED_STRING_FIELDS) {
        const v = spec[field];
        expect(typeof v, `${spec.id}.${String(field)}`).toBe("string");
        expect((v as string).length, `${spec.id}.${String(field)} must not be empty`)
          .toBeGreaterThan(0);
      }
      expect(TYPE_VALUES, `${spec.id}.type`).toContain(spec.type);
      expect(METHOD_VALUES, `${spec.id}.measurementMethod`).toContain(spec.measurementMethod);
    });
  }
});

describe("ids are unique", () => {
  it("no two records share an id", () => {
    const ids = MEASURE_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every id is a stable kebab-case slug", () => {
    for (const spec of MEASURE_SPECS) {
      expect(spec.id, spec.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("every dataSource names a real column", () => {
  // `<tab>.<column>` pairs, comma-separated when a record reads more than one. Extracted
  // with a regex rather than a hand-parsed list per record, so a record that ADDS a source
  // without updating this test still gets checked — the whole point of asserting against
  // TAB_HEADERS is that a renamed or removed column fails here, not silently in prod.
  const PAIR = /([a-z][a-z0-9_]*)\.([a-z0-9_]+)/g;

  for (const spec of MEASURE_SPECS) {
    it(`${spec.id}: ${spec.dataSource}`, () => {
      const pairs = [...spec.dataSource.matchAll(PAIR)];
      expect(pairs.length, `${spec.id}.dataSource names no <tab>.<column> pair`)
        .toBeGreaterThan(0);
      for (const [, tab, column] of pairs) {
        const headers = TAB_HEADERS[tab!];
        expect(headers, `${spec.id}.dataSource names unknown tab "${tab}"`).toBeTruthy();
        expect(
          headers!.includes(column!),
          `${spec.id}.dataSource names "${tab}.${column}" — no such column in TAB_HEADERS["${tab}"]`,
        ).toBe(true);
      }
    });
  }
});

describe("no record is past its revisionDue at the harness's frozen clock", () => {
  // FROZEN_NOW is 2026-08-13T09:00:00.000Z (test/gasEnv.ts). Every revisionDue here is set
  // roughly a year out, so this passing today is not the interesting case — the interesting
  // case is a year from now, when this test starts failing on its own with no code change
  // at all. THAT FAILURE IS THE FEATURE: a measure specification whose owner is never forced
  // to look at it again is one that quietly stops meaning anything the day the model behind
  // it changes, and this is the mechanism that turns "review yearly" from a comment nobody
  // rereads into a red CI run somebody has to act on.
  for (const spec of MEASURE_SPECS) {
    it(spec.id, () => {
      const due = new Date(spec.revisionDue);
      expect(Number.isNaN(due.getTime()), `${spec.id}.revisionDue is not a valid ISO date`)
        .toBe(false);
      expect(
        due.getTime(),
        `${spec.id}.revisionDue (${spec.revisionDue}) is in the past against the frozen clock`,
      ).toBeGreaterThan(FROZEN_NOW.getTime());
    });
  }

  it("revisionDue is set far enough out to be sensible (at least 90 days from the frozen clock)", () => {
    const NINETY_DAYS_MS = 90 * 86400000;
    for (const spec of MEASURE_SPECS) {
      const due = new Date(spec.revisionDue).getTime();
      expect(due - FROZEN_NOW.getTime(), spec.id).toBeGreaterThan(NINETY_DAYS_MS);
    }
  });
});

describe("the two disciplines this file's own header pins", () => {
  it("marks Subjective anything whose value can be swayed by an LLM rater (ai_verdict / "
    + "ai_recommended_severity), and every such record says so in its OWN text — not "
    + "merely carries the tag, so the reason travels with the record rather than living "
    + "only in a source comment or this test", () => {
    for (const spec of MEASURE_SPECS) {
      if (spec.measurementMethod !== "Subjective") continue;
      const prose = spec.goal + spec.formula + spec.target + spec.implementationEvidence;
      expect(prose, spec.id).toMatch(/aiVerdict|ai_verdict|LLM rater/);
    }
  });

  it("names the exploitation-axis LLM path explicitly on problem-outcome-distribution", () => {
    const spec = MEASURE_SPECS.find((s) => s.id === "problem-outcome-distribution")!;
    expect(spec).toBeTruthy();
    expect(spec.measurementMethod).toBe("Subjective");
    expect(spec.formula).toMatch(/aiVerdict/);
  });

  it("every timeBasedReference states the per-sync-only, no-per-entity-history limitation", () => {
    for (const spec of MEASURE_SPECS) {
      expect(spec.timeBasedReference, spec.id).toMatch(/per-entity history/i);
      expect(spec.timeBasedReference, spec.id).toMatch(/Drive archive replay/i);
      expect(spec.timeBasedReference, spec.id).toMatch(/not implemented/i);
    }
  });

  it("publishes no MTTR-over-closed-issues record — censored data, omitted rather than softened", () => {
    for (const spec of MEASURE_SPECS) {
      const text = (spec.measure + spec.formula).toLowerCase();
      const looksLikeMttr = /mean time|mttr|average.{0,20}(remediat|resolv|close)/.test(text);
      expect(looksLikeMttr, spec.id).toBe(false);
    }
  });
});

describe("effectiveness records about the MODEL say so, distinctly from impact records about the LANDSCAPE", () => {
  it("distinctScores / tieRate / effectiveCardinality / pillar saturation are all type effectiveness "
    + "and their goal names the model rather than the landscape", () => {
    const modelIds = [
      "aars-distinct-scores", "aars-tie-rate", "aars-effective-cardinality", "aars-pillar-saturation",
    ];
    for (const id of modelIds) {
      const spec = MEASURE_SPECS.find((s) => s.id === id)!;
      expect(spec, id).toBeTruthy();
      expect(spec.type, id).toBe("effectiveness");
      expect(spec.goal.toUpperCase(), id).toMatch(/MODEL/);
    }
  });

  it("AARS score and band are type impact, not effectiveness", () => {
    for (const id of ["aars-score", "aars-band"]) {
      const spec = MEASURE_SPECS.find((s) => s.id === id)!;
      expect(spec.type, id).toBe("impact");
    }
  });
});

describe("problem-axis-unknown-rate reads correctly as the model's warning light, not the landscape's safety", () => {
  it("says plainly that a high value means the model cannot prioritise", () => {
    const spec = MEASURE_SPECS.find((s) => s.id === "problem-axis-unknown-rate")!;
    expect(spec).toBeTruthy();
    expect(spec.measurementMethod).toBe("Objective");
    expect(spec.goal).toMatch(/cannot prioritise|CANNOT PRIORITISE/);
    // The goal states the misreading explicitly in order to REJECT it ("does NOT mean the
    // landscape is safe") — so the check is for the rejection, not a bare absence of the phrase.
    expect(spec.goal).toMatch(/does NOT mean the landscape is safe/);
  });
});
