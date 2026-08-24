// The Priorities page's action mode as pure functions: filtering, facets and the
// display-column comparators over `ActionRow`. Same shape as problemView.test.js — the
// page's logic is tested here, the page's pixels are checked in the dev harness.

import { describe, expect, it } from "vitest";
import {
  ACTION_COMPARATORS, ACTION_SORT_DESC, KIND_VALUES, SEVERITY_RANK,
  applyActionFilters, actionFilterOptions, sortActions,
} from "../src/client/js/pages/actionView.js";

const ROWS = [
  {
    key: "ISSUE|wc-1|", kind: "ISSUE", title: "Missing guardrail", ruleShortId: undefined,
    worstSeverity: "CRITICAL", problems: 13, assets: 9, firstSeenAt: "2026-06-01T00:00:00Z",
  },
  {
    key: "FINDING||SUB-082", kind: "FINDING", title: "Encryption at rest", ruleShortId: "SUB-082",
    worstSeverity: "HIGH", problems: 4, assets: 4, firstSeenAt: null,
  },
  {
    key: "ISSUE|wc-2|", kind: "ISSUE", title: "Excessive privilege", ruleShortId: undefined,
    worstSeverity: "LOW", problems: 2, assets: 6, firstSeenAt: "2026-07-15T00:00:00Z",
  },
  {
    key: "FINDING||SUB-003", kind: "FINDING", title: "Public bucket", ruleShortId: "SUB-003",
    worstSeverity: "", problems: 1, assets: 1, firstSeenAt: "2026-05-01T00:00:00Z",
  },
];

describe("applyActionFilters", () => {
  it("filters by severity", () => {
    const filtered = applyActionFilters(ROWS, { severity: "CRITICAL" });
    expect(filtered.map((r) => r.key)).toEqual(["ISSUE|wc-1|"]);
  });

  it("filters by kind", () => {
    const filtered = applyActionFilters(ROWS, { kind: "FINDING" });
    expect(filtered.map((r) => r.key)).toEqual(["FINDING||SUB-082", "FINDING||SUB-003"]);
  });

  it("searches title and ruleShortId, case-insensitively", () => {
    expect(applyActionFilters(ROWS, { q: "guardrail" }).map((r) => r.key))
      .toEqual(["ISSUE|wc-1|"]);
    expect(applyActionFilters(ROWS, { q: "sub-082" }).map((r) => r.key))
      .toEqual(["FINDING||SUB-082"]);
  });

  it("ANDs every active dimension", () => {
    const filtered = applyActionFilters(ROWS, { kind: "ISSUE", severity: "LOW" });
    expect(filtered.map((r) => r.key)).toEqual(["ISSUE|wc-2|"]);
  });

  it("returns every row when nothing is active", () => {
    expect(applyActionFilters(ROWS, {}).length).toBe(ROWS.length);
  });

  it("does not throw on a row with no ruleShortId", () => {
    expect(() => applyActionFilters(ROWS, { q: "excessive" })).not.toThrow();
    expect(applyActionFilters(ROWS, { q: "excessive" }).map((r) => r.key))
      .toEqual(["ISSUE|wc-2|"]);
  });
});

describe("actionFilterOptions", () => {
  it("lists only the severities and kinds actually present, worst-first", () => {
    const options = actionFilterOptions(ROWS);
    expect(options.severities).toEqual(["CRITICAL", "HIGH", "LOW"]);
    expect(options.kinds).toEqual(KIND_VALUES); // both ISSUE and FINDING appear
  });

  it("never lists an unrated ('') severity as a pill", () => {
    const options = actionFilterOptions(ROWS);
    expect(options.severities).not.toContain("");
  });
});

describe("ACTION_COMPARATORS / sortActions", () => {
  it("worstSeverity: worst (CRITICAL) first, unrated last", () => {
    const sorted = sortActions(ROWS, "worstSeverity", 1);
    expect(sorted.map((r) => r.key)).toEqual([
      "ISSUE|wc-1|", "FINDING||SUB-082", "ISSUE|wc-2|", "FINDING||SUB-003",
    ]);
  });

  it("closes: most problems closed first", () => {
    const sorted = sortActions(ROWS, "closes", 1);
    expect(sorted.map((r) => r.problems)).toEqual([13, 4, 2, 1]);
  });

  it("assets: most distinct assets first", () => {
    const sorted = sortActions(ROWS, "assets", 1);
    expect(sorted.map((r) => r.assets)).toEqual([9, 6, 4, 1]);
  });

  it("firstSeen: oldest first, no-date last, and never returns NaN for two undated rows", () => {
    const rows = ROWS.concat([{
      key: "ISSUE|wc-3|", kind: "ISSUE", title: "Zzz", worstOutcome: "TRACK",
      problems: 1, assets: 1, firstSeenAt: null,
    }]);
    const sorted = sortActions(rows, "firstSeen", 1);
    expect(sorted[0].key).toBe("FINDING||SUB-003"); // 2026-05-01
    expect(sorted[1].key).toBe("ISSUE|wc-1|"); // 2026-06-01
    expect(sorted[2].key).toBe("ISSUE|wc-2|"); // 2026-07-15
    // Both undated rows must not throw the pair into NaN-driven disorder — the stable
    // key tiebreak decides between them instead.
    expect(sorted.slice(3).map((r) => r.key)).toEqual(["FINDING||SUB-082", "ISSUE|wc-3|"]);
  });

  it("title / kind: A→Z", () => {
    expect(sortActions(ROWS, "title", 1).map((r) => r.title)).toEqual([
      "Encryption at rest", "Excessive privilege", "Missing guardrail", "Public bucket",
    ]);
    expect(sortActions(ROWS, "kind", 1).map((r) => r.kind)[0]).toBe("FINDING"); // F < I
  });

  it("dir flips a column's natural order", () => {
    const asc = sortActions(ROWS, "closes", 1).map((r) => r.key);
    const desc = sortActions(ROWS, "closes", -1).map((r) => r.key);
    expect(desc).toEqual(asc.slice().reverse());
  });

  it("does not mutate its input", () => {
    const input = ROWS.slice();
    sortActions(input, "worstSeverity", 1);
    expect(input.map((r) => r.key)).toEqual(ROWS.map((r) => r.key));
  });

  it("an unknown sort key returns the rows unsorted, as a copy", () => {
    const out = sortActions(ROWS, "bogus", 1);
    expect(out).not.toBe(ROWS);
    expect(out.map((r) => r.key)).toEqual(ROWS.map((r) => r.key));
  });

  it("flags the leverage columns as naturally-descending", () => {
    expect(ACTION_SORT_DESC).toEqual({ worstSeverity: true, closes: true, assets: true });
    expect(ACTION_COMPARATORS.firstSeen).toBeTypeOf("function");
    expect(ACTION_SORT_DESC.firstSeen).toBeUndefined(); // firstSeen opens oldest-first, i.e. ascending
  });

  it("breaks a tie on the action's own key, deterministically", () => {
    const tied = [
      { key: "b", kind: "ISSUE", title: "X", worstOutcome: "ACT", problems: 1, assets: 1 },
      { key: "a", kind: "ISSUE", title: "X", worstOutcome: "ACT", problems: 1, assets: 1 },
    ];
    expect(sortActions(tied, "closes", 1).map((r) => r.key)).toEqual(["a", "b"]);
  });
});
