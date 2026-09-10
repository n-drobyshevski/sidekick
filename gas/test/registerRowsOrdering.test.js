// THE ORDERING RULE, MEASURED TWICE.
//
// `sortRegisterRows` (server, TypeScript, `src/domain/pagePayload.ts`) and its client twin
// `sortRows` (`gas_shared/ui/tableModel.js`) cannot literally share code — the client bundle
// is plain JS and cannot import a TS module, the same constraint that makes `TIER_ORDER` a
// hand-kept mirror in `client/js/charts.js` (see test/riskLadderSync.test.ts). So this file
// runs BOTH over the same fixtures and asserts identical arrangements, nulls included.
//
// That identity is the claim that lets the client draw a page the server has already ordered:
// if the two ever drift, a reader clicking a column header would get a different arrangement
// from the one the pager cut into pages, and a row could appear twice or never.
//
// A plain `.js` test file (not `.ts`) purely so it can import the untyped client module
// without tripping `tsc --noEmit`'s "no declaration file" error under `strict`;
// `test/registerRows.test.ts` holds everything else about the register-rows slice and model.

import { describe, expect, it } from "vitest";
import { SEVERITY_ORDER } from "../src/domain/config";
import { RISK_TIER_ORDER } from "../src/domain/program";
import {
  compareRegisterValues,
  nullsLastOrder,
  pageOfRegisterRows,
  registerSortValue,
  sortRegisterRows,
} from "../src/domain/pagePayload";
import { compareValues, nullsLast, pageOf, sortRows } from "../../gas_shared/ui/tableModel.js";

describe("the ordering rule — server and client comparators agree", () => {
  it("compareRegisterValues / nullsLastOrder agree with their client twins on every case", () => {
    const cases = [
      [1, 2], [2, 1], [1, 1], ["b", "a"], ["A", "a"], [true, false], [false, true],
      [null, null], [null, 5], [5, null], [undefined, 5], [5, undefined],
      [null, undefined], [undefined, null],
    ];
    for (const [a, b] of cases) {
      expect(nullsLastOrder(a, b)).toBe(nullsLast(a, b));
      if (nullsLastOrder(a, b) === null) {
        expect(compareRegisterValues(a, b)).toBe(compareValues(a, b));
      }
    }
  });

  it("a DATE column orders identically, nulls last in both directions", () => {
    // Deliberately mixed spellings: a zoned instant, a naive one and a date-only value that
    // all denote the same day, so "compared as instants" is what is being measured rather
    // than string order. The client is handed the same parsed value the server sorts on —
    // the rule under test is where the NULLS land and how ties break, not the parser.
    const rows = [
      { vuln_key: "k1", first_seen: "2026-03-01T00:00:00Z" },
      { vuln_key: "k2", first_seen: null },
      { vuln_key: "k3", first_seen: "2026-01-15 08:30:00" },
      { vuln_key: "k4", first_seen: "2026-05-20" },
      { vuln_key: "k5", first_seen: undefined },
      { vuln_key: "k6", first_seen: "2026-01-15T08:30:00" }, // same instant as k3
    ];
    const value = registerSortValue("first_seen");
    const tiebreak = (r) => r["vuln_key"];

    const asc = sortRegisterRows(rows, { value, tiebreak });
    expect(asc.map((r) => r["vuln_key"])).toEqual(["k3", "k6", "k1", "k4", "k2", "k5"]);
    const desc = sortRegisterRows(rows, { value, descending: true, tiebreak });
    expect(desc.map((r) => r["vuln_key"])).toEqual(["k4", "k1", "k3", "k6", "k2", "k5"]);
    // Nulls LAST in both directions — the whole point of keeping them outside the flip.
    expect(asc.slice(-2).map((r) => r["vuln_key"])).toEqual(["k2", "k5"]);
    expect(desc.slice(-2).map((r) => r["vuln_key"])).toEqual(["k2", "k5"]);

    expect(sortRows(rows, { value, tiebreak }).map((r) => r["vuln_key"]))
      .toEqual(asc.map((r) => r["vuln_key"]));
    expect(sortRows(rows, { value, descending: true, tiebreak }).map((r) => r["vuln_key"]))
      .toEqual(desc.map((r) => r["vuln_key"]));
  });

  it("a NUMBER column orders identically — 9 below 10, nulls last, both directions", () => {
    const rows = [
      { vuln_key: "k1", age_days: 30 },
      { vuln_key: "k2", age_days: null }, // resolved rows carry no age
      { vuln_key: "k3", age_days: 9 },
      { vuln_key: "k4", age_days: 10 },
      { vuln_key: "k5", age_days: "" }, // blank is missing, not zero
      { vuln_key: "k6", age_days: 100 },
    ];
    const value = registerSortValue("age_days");
    const tiebreak = (r) => r["vuln_key"];

    const asc = sortRegisterRows(rows, { value, tiebreak });
    expect(asc.map((r) => r["vuln_key"])).toEqual(["k3", "k4", "k1", "k6", "k2", "k5"]);
    const desc = sortRegisterRows(rows, { value, descending: true, tiebreak });
    expect(desc.map((r) => r["vuln_key"])).toEqual(["k6", "k1", "k4", "k3", "k2", "k5"]);

    // The client is given the SAME per-column value function's answers, so the two are
    // compared on the arrangement rather than on who normalizes.
    expect(sortRows(rows, { value, tiebreak }).map((r) => r["vuln_key"]))
      .toEqual(asc.map((r) => r["vuln_key"]));
    expect(sortRows(rows, { value, descending: true, tiebreak }).map((r) => r["vuln_key"]))
      .toEqual(desc.map((r) => r["vuln_key"]));
  });

  it("SEVERITY orders CRITICAL -> INFO, and the client agrees from the same rank", () => {
    const rows = [
      { vuln_key: "k1", severity: "LOW" },
      { vuln_key: "k2", severity: "CRITICAL" },
      { vuln_key: "k3", severity: "INFO" },
      { vuln_key: "k4", severity: "HIGH" },
      { vuln_key: "k5", severity: "MEDIUM" },
      { vuln_key: "k6", severity: "bogus" }, // normalizes to UNKNOWN, sinks last
      { vuln_key: "k7", severity: null },
    ];
    const value = registerSortValue("severity");
    const tiebreak = (r) => r["vuln_key"];
    const server = sortRegisterRows(rows, { value, tiebreak });
    expect(server.map((r) => r["severity"])).toEqual([
      "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "bogus", null,
    ]);
    // The rule the client encodes is SEVERITY_ORDER position; an unrecognised or absent
    // severity sinks through the vocabulary (UNKNOWN is the last entry) rather than through
    // nullsLast, which is why `bogus` and `null` land together at the end.
    const rank = (r) => {
      const s = String(r["severity"] ?? "").toUpperCase();
      const i = SEVERITY_ORDER.indexOf(s);
      return i === -1 ? SEVERITY_ORDER.indexOf("UNKNOWN") : i;
    };
    expect(sortRows(rows, { value: rank, tiebreak }).map((r) => r["vuln_key"]))
      .toEqual(server.map((r) => r["vuln_key"]));
  });

  it("RISK_TIER orders kev -> unknown, and the client agrees from the same rank", () => {
    // Ascending is worst-first here for the same reason it is on severity: the tier is an
    // order over EVIDENCE, and alphabetically `epss` would open the register.
    const rows = [
      { vuln_key: "k1", risk_tier: "none" },
      { vuln_key: "k2", risk_tier: "unknown" },
      { vuln_key: "k3", risk_tier: "kev" },
      { vuln_key: "k4", risk_tier: "epss" },
      { vuln_key: "k5", risk_tier: "exploit" },
      { vuln_key: "k6", risk_tier: "not-a-tier" },
    ];
    const value = registerSortValue("risk_tier");
    const tiebreak = (r) => r["vuln_key"];
    const server = sortRegisterRows(rows, { value, tiebreak });
    expect(server.map((r) => r["risk_tier"]))
      .toEqual(["kev", "exploit", "epss", "none", "unknown", "not-a-tier"]);

    const rank = (r) => {
      const i = RISK_TIER_ORDER.indexOf(String(r["risk_tier"] ?? ""));
      return i === -1 ? RISK_TIER_ORDER.length : i;
    };
    expect(sortRows(rows, { value: rank, tiebreak }).map((r) => r["vuln_key"]))
      .toEqual(server.map((r) => r["vuln_key"]));
  });

  it("the TIEBREAK is never flipped by `descending`, on either side", () => {
    // A column of equal values is the case the tiebreak exists for. If it flipped with the
    // direction, reversing the sort would reshuffle rows that did not move.
    const rows = [
      { vuln_key: "k3", status: "OPEN" },
      { vuln_key: "k1", status: "OPEN" },
      { vuln_key: "k2", status: "OPEN" },
    ];
    const value = registerSortValue("status");
    const tiebreak = (r) => r["vuln_key"];
    const asc = sortRegisterRows(rows, { value, tiebreak }).map((r) => r["vuln_key"]);
    const desc = sortRegisterRows(rows, { value, descending: true, tiebreak })
      .map((r) => r["vuln_key"]);
    expect(asc).toEqual(["k1", "k2", "k3"]);
    expect(desc).toEqual(asc);
    expect(sortRows(rows, { value, tiebreak }).map((r) => r["vuln_key"])).toEqual(asc);
    expect(sortRows(rows, { value, descending: true, tiebreak }).map((r) => r["vuln_key"]))
      .toEqual(desc);
  });

  it("pageOfRegisterRows and the client's pageOf agree, including the clamp", () => {
    const rows = Array.from({ length: 37 }, (_, i) => i);
    for (const [page, size] of [[0, 10], [3, 10], [99, 10], [-1, 10], [0, 250], [2, 1]]) {
      expect(pageOfRegisterRows(rows, page, size)).toEqual(pageOf(rows, page, size));
    }
    // And on an empty register: one page, page 0, no rows — not a division by zero.
    expect(pageOfRegisterRows([], 5, 50)).toEqual(pageOf([], 5, 50));
  });
});
