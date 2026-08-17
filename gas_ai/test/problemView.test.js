// The Priorities page as pure functions: URL round-tripping, filtering, facets and the
// display-column comparators. Same shape as comboView.test.js — the page's logic is
// tested here, the page's pixels are checked in the dev harness.

import { describe, expect, it } from "vitest";
import {
  KIND_VALUES, OUTCOME_RANK, PROBLEM_COMPARATORS, PROBLEM_SORT_DESC,
  applyProblemFilters, problemFilterOptions, problemParamPatch, readProblemParams,
  sortProblems,
} from "../src/client/js/pages/problemView.js";

const ROWS = [
  {
    id: "iss-1", kind: "ISSUE", title: "Missing guardrail", assetName: "Bravo Agent",
    problemOutcome: "ACT", postureTier: 4, severity: "CRITICAL", dueAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "cfg-1", kind: "FINDING", title: "Encryption at rest", assetName: "Alpha Store",
    problemOutcome: "TRACK_STAR", postureTier: null, severity: "MEDIUM", dueAt: null,
  },
  {
    id: "iss-2", kind: "ISSUE", title: "Excessive privilege", assetName: "Charlie Agent",
    problemOutcome: "TRACK", postureTier: 2, severity: "HIGH", dueAt: "2026-08-20T00:00:00Z",
  },
  {
    id: "iss-3", kind: "ISSUE", title: "No verdict yet", assetName: "Delta Agent",
    problemOutcome: "", postureTier: 1, severity: "LOW", dueAt: null,
  },
];

describe("URL round-trip", () => {
  it("reads a full view back out of the hash", () => {
    const state = readProblemParams({
      outcome: "attend", kind: "finding", q: "agent", sort: "due", dir: "-1", page: "3",
    });
    expect(state).toEqual({
      outcome: "ATTEND", kind: "FINDING", q: "agent",
      sort: "due", dir: -1, page: 2, // 1-based in the URL, 0-based in the page
    });
  });

  it("drops an outcome, kind or sort key this page doesn't offer", () => {
    const state = readProblemParams({ outcome: "SOMETHING_ELSE", kind: "ASSET", sort: "bogus" });
    expect(state.outcome).toBe("");
    expect(state.kind).toBe("");
    expect(state.sort).toBe("");
  });

  it("defaults page to 0 and dir to 1 when absent", () => {
    const state = readProblemParams({});
    expect(state.page).toBe(0);
    expect(state.dir).toBe(1);
  });

  it("round-trips through problemParamPatch, dropping only what is empty", () => {
    const state = readProblemParams({ outcome: "act", q: "x", sort: "due", dir: "-1", page: "2" });
    expect(problemParamPatch(state)).toEqual({
      outcome: "ACT", kind: "", q: "x", sort: "due", dir: "-1", page: "2",
    });
  });

  it("clears dir and page from the patch once their driving state clears", () => {
    expect(problemParamPatch({})).toEqual({
      outcome: "", kind: "", q: "", sort: "", dir: "", page: "",
    });
  });
});

describe("applyProblemFilters", () => {
  it("filters by outcome", () => {
    const filtered = applyProblemFilters(ROWS, { outcome: "ACT" });
    expect(filtered.map((r) => r.id)).toEqual(["iss-1"]);
  });

  it("filters by kind", () => {
    const filtered = applyProblemFilters(ROWS, { kind: "FINDING" });
    expect(filtered.map((r) => r.id)).toEqual(["cfg-1"]);
  });

  it("searches title and asset name, case-insensitively", () => {
    expect(applyProblemFilters(ROWS, { q: "bravo" }).map((r) => r.id)).toEqual(["iss-1"]);
    expect(applyProblemFilters(ROWS, { q: "GUARDRAIL" }).map((r) => r.id)).toEqual(["iss-1"]);
  });

  it("ANDs every active dimension", () => {
    const filtered = applyProblemFilters(ROWS, { kind: "ISSUE", outcome: "TRACK" });
    expect(filtered.map((r) => r.id)).toEqual(["iss-2"]);
  });

  it("returns every row when nothing is active", () => {
    expect(applyProblemFilters(ROWS, {}).length).toBe(ROWS.length);
  });
});

describe("problemFilterOptions", () => {
  it("lists only the outcomes and kinds actually present, outcomes worst-first", () => {
    const options = problemFilterOptions(ROWS);
    expect(options.outcomes).toEqual(["ACT", "TRACK_STAR", "TRACK"]);
    expect(options.kinds).toEqual(KIND_VALUES); // both ISSUE and FINDING appear
  });

  it("never lists the undecided ('') outcome as a pill", () => {
    const options = problemFilterOptions(ROWS);
    expect(options.outcomes).not.toContain("");
  });
});

describe("PROBLEM_COMPARATORS / sortProblems", () => {
  it("priority: worst outcome (ACT) first, undecided last", () => {
    const sorted = sortProblems(ROWS, "priority", 1);
    expect(sorted.map((r) => r.id)).toEqual(["iss-1", "cfg-1", "iss-2", "iss-3"]);
  });

  it("posture: worst tier (4) first, unscored last", () => {
    const sorted = sortProblems(ROWS, "posture", 1);
    expect(sorted.map((r) => r.id)).toEqual(["iss-1", "iss-2", "iss-3", "cfg-1"]);
  });

  it("severity: worst first", () => {
    const sorted = sortProblems(ROWS, "severity", 1);
    expect(sorted.map((r) => r.id)).toEqual(["iss-1", "iss-2", "cfg-1", "iss-3"]);
  });

  it("due: soonest first, no-deadline last, and never returns NaN for two undated rows", () => {
    const sorted = sortProblems(ROWS, "due", 1);
    expect(sorted[0].id).toBe("iss-1"); // 2026-08-01
    expect(sorted[1].id).toBe("iss-2"); // 2026-08-20
    // cfg-1 and iss-3 both carry dueAt: null — a NaN-producing comparator would leave them
    // in input order or throw; the stable asset-name/id tiebreak must decide instead.
    expect(sorted.slice(2).map((r) => r.id)).toEqual(["cfg-1", "iss-3"]);
  });

  it("asset / title / kind: A→Z", () => {
    expect(sortProblems(ROWS, "asset", 1).map((r) => r.assetName))
      .toEqual(["Alpha Store", "Bravo Agent", "Charlie Agent", "Delta Agent"]);
    expect(sortProblems(ROWS, "kind", 1).map((r) => r.kind)[0]).toBe("FINDING"); // F < I
  });

  it("dir flips a column's natural order", () => {
    const asc = sortProblems(ROWS, "severity", 1).map((r) => r.id);
    const desc = sortProblems(ROWS, "severity", -1).map((r) => r.id);
    expect(desc).toEqual(asc.slice().reverse());
  });

  it("does not mutate its input", () => {
    const input = ROWS.slice();
    sortProblems(input, "priority", 1);
    expect(input.map((r) => r.id)).toEqual(ROWS.map((r) => r.id));
  });

  it("an unknown sort key returns the rows unsorted, as a copy", () => {
    const out = sortProblems(ROWS, "bogus", 1);
    expect(out).not.toBe(ROWS);
    expect(out.map((r) => r.id)).toEqual(ROWS.map((r) => r.id));
  });

  it("flags the risk columns as naturally-descending", () => {
    expect(PROBLEM_SORT_DESC).toEqual({ priority: true, posture: true, severity: true });
    expect(PROBLEM_COMPARATORS.due).toBeTypeOf("function");
    expect(PROBLEM_SORT_DESC.due).toBeUndefined(); // due opens soonest-first, i.e. ascending
  });
});
