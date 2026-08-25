// The Priorities page as pure functions: URL round-tripping, filtering, facets and the
// display-column comparators. Same shape as comboView.test.js — the page's logic is
// tested here, the page's pixels are checked in the dev harness.

import { describe, expect, it } from "vitest";
import {
  KIND_VALUES, MODE_VALUES, OUTCOME_RANK, PROBLEM_COMPARATORS, PROBLEM_SORT_DESC,
  applyProblemFilters, problemFilterOptions, problemParamPatch, readProblemParams,
  sortProblems,
} from "../src/client/js/pages/problemView.js";

const ROWS = [
  {
    id: "iss-1", kind: "ISSUE", title: "Missing guardrail", assetName: "Bravo Agent",
    severity: "CRITICAL", dueAt: "2026-08-01T00:00:00Z",
  },
  {
    id: "cfg-1", kind: "FINDING", title: "Encryption at rest", assetName: "Alpha Store",
    severity: "MEDIUM", dueAt: null,
  },
  {
    id: "iss-2", kind: "ISSUE", title: "Excessive privilege", assetName: "Charlie Agent",
    severity: "HIGH", dueAt: "2026-08-20T00:00:00Z",
  },
  {
    id: "iss-3", kind: "ISSUE", title: "Weak TLS", assetName: "Delta Agent",
    severity: "LOW", dueAt: null,
  },
];

describe("URL round-trip", () => {
  it("reads a full view back out of the hash", () => {
    const state = readProblemParams({
      severity: "high", kind: "finding", q: "agent", sort: "due", dir: "-1", page: "3",
    });
    expect(state).toEqual({
      mode: "actions", severity: "HIGH", kind: "FINDING", q: "agent",
      sort: "due", dir: -1, page: 2, // 1-based in the URL, 0-based in the page
    });
  });

  it("drops a severity, kind or sort key this page doesn't offer", () => {
    // `?outcome=ACT` is among them: the decision cascade's vocabulary does not overlap
    // this register's, so a link carrying one resolves to no filter rather than to a
    // severity that happens to share a name.
    const state = readProblemParams({ outcome: "ACT", severity: "SOMETHING_ELSE", kind: "ASSET", sort: "bogus" });
    expect(state.severity).toBe("");
    expect(state.outcome).toBeUndefined();
    expect(state.kind).toBe("");
    expect(state.sort).toBe("");
  });

  it("defaults page to 0 and dir to 1 when absent", () => {
    const state = readProblemParams({});
    expect(state.page).toBe(0);
    expect(state.dir).toBe(1);
  });

  it("round-trips through problemParamPatch, dropping only what is empty", () => {
    const state = readProblemParams({ severity: "critical", q: "x", sort: "due", dir: "-1", page: "2" });
    expect(problemParamPatch(state)).toEqual({
      mode: "", severity: "CRITICAL", kind: "", q: "x", sort: "due", dir: "-1", page: "2",
    });
  });

  it("clears dir and page from the patch once their driving state clears", () => {
    expect(problemParamPatch({})).toEqual({
      mode: "", severity: "", kind: "", q: "", sort: "", dir: "", page: "",
    });
  });
});

describe("mode round-trip", () => {
  it("defaults to actions when absent", () => {
    expect(readProblemParams({}).mode).toBe("actions");
  });

  it("reads a valid mode back out of the hash", () => {
    expect(readProblemParams({ mode: "problems" }).mode).toBe("problems");
    expect(readProblemParams({ mode: "ACTIONS" }).mode).toBe("actions"); // case-insensitive
  });

  it("drops an unknown mode to the default", () => {
    expect(readProblemParams({ mode: "bogus" }).mode).toBe("actions");
  });

  it("lists exactly the two modes this page offers", () => {
    expect(MODE_VALUES).toEqual(["actions", "problems"]);
  });

  it("serializes the default mode to null so it never appears in the URL", () => {
    expect(problemParamPatch({ mode: "actions" }).mode).toBe("");
    expect(problemParamPatch({}).mode).toBe("");
  });

  it("serializes the non-default mode explicitly", () => {
    expect(problemParamPatch({ mode: "problems" }).mode).toBe("problems");
  });

  it("round-trips a non-default mode through read → patch → read", () => {
    const state = readProblemParams({ mode: "problems" });
    const patch = problemParamPatch(state);
    expect(readProblemParams(patch).mode).toBe("problems");
  });
});

describe("applyProblemFilters", () => {
  it("filters by severity", () => {
    const filtered = applyProblemFilters(ROWS, { severity: "CRITICAL" });
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
    const filtered = applyProblemFilters(ROWS, { kind: "ISSUE", severity: "HIGH" });
    expect(filtered.map((r) => r.id)).toEqual(["iss-2"]);
  });

  it("returns every row when nothing is active", () => {
    expect(applyProblemFilters(ROWS, {}).length).toBe(ROWS.length);
  });
});

describe("problemFilterOptions", () => {
  it("lists only the severities and kinds actually present, worst-first", () => {
    const options = problemFilterOptions(ROWS);
    expect(options.severities).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
    expect(options.kinds).toEqual(KIND_VALUES); // both ISSUE and FINDING appear
  });

  it("never lists an unrated ('') severity as a pill", () => {
    const options = problemFilterOptions(ROWS);
    expect(options.severities).not.toContain("");
  });
});

describe("PROBLEM_COMPARATORS / sortProblems", () => {
  it("severity: worst (CRITICAL) first, unrated last", () => {
    const sorted = sortProblems(ROWS, "severity", 1);
    expect(sorted.map((r) => r.id)).toEqual(["iss-1", "iss-2", "cfg-1", "iss-3"]);
  });

  it("firstSeen: oldest first, undated last", () => {
    const rows = [
      { id: "newer", firstSeenAt: "2026-06-01T00:00:00Z" },
      { id: "undated" },
      { id: "older", firstSeenAt: "2026-04-01T00:00:00Z" },
    ];
    expect(sortProblems(rows, "firstSeen", 1).map((r) => r.id))
      .toEqual(["older", "newer", "undated"]);
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
    sortProblems(input, "severity", 1);
    expect(input.map((r) => r.id)).toEqual(ROWS.map((r) => r.id));
  });

  it("an unknown sort key returns the rows unsorted, as a copy", () => {
    const out = sortProblems(ROWS, "bogus", 1);
    expect(out).not.toBe(ROWS);
    expect(out.map((r) => r.id)).toEqual(ROWS.map((r) => r.id));
  });

  it("flags the risk columns as naturally-descending", () => {
    // `rank` joined `severity` here in the merge that brought main's Priorities model onto
    // this branch. THE CLAIM THIS ASSERTION USED TO ENCODE was "severity is the only
    // descending column", which was true on main because main has no `rank` comparator. The
    // merged tree does have one — the three cases below this block exercise it, and one of
    // them asserts PROBLEM_SORT_DESC.rank is true — so the exhaustive form contradicted a
    // sibling case rather than describing the code. A comparator that sorts worst-first has
    // to be flagged descending or the first click shows the BEST row first, which is the
    // same reason severity is here.
    expect(PROBLEM_SORT_DESC).toEqual({ severity: true, rank: true });
    expect(PROBLEM_COMPARATORS.due).toBeTypeOf("function");
    expect(PROBLEM_SORT_DESC.due).toBeUndefined(); // due opens soonest-first, i.e. ascending
  });
});

describe("rank ordering (the minimal model's column)", () => {
  // The score itself is computed server-side and tested in test/rank.test.ts. What belongs
  // here is only what the client does with it: read it, never recompute it.
  const row = (id, rankScore) => ({
    id, kind: "ISSUE", title: "t", assetName: "a", problemOutcome: "TRACK_STAR",
    severity: "MEDIUM", postureTier: null, dueAt: null, rankScore,
  });

  it("orders by the server's score, highest first", () => {
    const out = sortProblems([row("lo", 0.2), row("hi", 0.9), row("mid", 0.5)], "rank", 1);
    expect(out.map((r) => r.id)).toEqual(["hi", "mid", "lo"]);
  });

  it("puts a row the server never scored last, not first", () => {
    // Absent is not zero and it is certainly not "most urgent" — an unscored row must not be
    // able to jump the queue on a value nobody computed.
    const out = sortProblems([row("unscored", undefined), row("scored", 0.1)], "rank", 1);
    expect(out.map((r) => r.id)).toEqual(["scored", "unscored"]);
  });

  it("is registered as a descending-by-default column", () => {
    expect(PROBLEM_SORT_DESC.rank).toBe(true);
  });
});
