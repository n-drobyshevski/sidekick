// The ordering rule, measured twice: `sortRegisterRows` (server, TypeScript,
// `domain/pagePayload.ts`) and its client twin `sortRows` (`ui/tableModel.js`) cannot
// literally share code — the client bundle is plain JS and cannot import a TS module — so
// this file runs both over the same fixtures and asserts identical arrangements, nulls
// included. It is a plain `.js` test file (not `.ts`) purely so it can import the untyped
// client module without tripping `tsc --noEmit`'s "no declaration file" error under
// `strict`; `test/registerRows.test.ts` holds everything else about the register-rows slice
// and model.

import { describe, expect, it } from "vitest";
import { SEVERITY_ORDER } from "../src/domain/config";
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
    ];
    for (const [a, b] of cases) {
      expect(nullsLastOrder(a, b)).toBe(nullsLast(a, b));
      if (nullsLastOrder(a, b) === null) {
        expect(compareRegisterValues(a, b)).toBe(compareValues(a, b));
      }
    }
  });

  it("sorts severity CRITICAL -> INFO, both server and client comparators agree", () => {
    const rows = [
      { finding_key: "k1", severity: "LOW" },
      { finding_key: "k2", severity: "CRITICAL" },
      { finding_key: "k3", severity: "INFO" },
      { finding_key: "k4", severity: "HIGH" },
      { finding_key: "k5", severity: "MEDIUM" },
      { finding_key: "k6", severity: "bogus" }, // normalizes to UNKNOWN, sinks last
    ];
    const value = registerSortValue("severity");
    const serverOrder = sortRegisterRows(rows, { value, tiebreak: (r) => r["finding_key"] });
    expect(serverOrder.map((r) => r["severity"])).toEqual([
      "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO", "bogus",
    ]);
    // The client twin, driven by the SAME precomputed rank (a plain client bundle cannot
    // import registerSortValue, but the rule it encodes — SEVERITY_ORDER position — is the
    // thing under test, not the TS/JS boundary).
    const rank = (r) =>
      SEVERITY_ORDER.indexOf(SEVERITY_ORDER.includes(String(r["severity"])) ? String(r["severity"]) : "UNKNOWN");
    const clientOrder = sortRows(rows, { value: rank, tiebreak: (r) => r["finding_key"] });
    expect(clientOrder.map((r) => r["finding_key"])).toEqual(serverOrder.map((r) => r["finding_key"]));
  });

  it("sorts age_days numerically with NULLS LAST, ascending and descending, both comparators", () => {
    const rows = [
      { finding_key: "k1", age_days: 30 },
      { finding_key: "k2", age_days: null }, // resolved rows carry no age_days
      { finding_key: "k3", age_days: 5 },
      { finding_key: "k4", age_days: 100 },
      { finding_key: "k5", age_days: null },
    ];
    const value = registerSortValue("age_days");

    const asc = sortRegisterRows(rows, { value, tiebreak: (r) => r["finding_key"] });
    expect(asc.map((r) => r["finding_key"])).toEqual(["k3", "k1", "k4", "k2", "k5"]);
    expect(asc.slice(-2).map((r) => r["age_days"])).toEqual([null, null]); // explicit: nulls LAST

    const desc = sortRegisterRows(rows, { value, descending: true, tiebreak: (r) => r["finding_key"] });
    expect(desc.map((r) => r["finding_key"])).toEqual(["k4", "k1", "k3", "k2", "k5"]);
    expect(desc.slice(-2).map((r) => r["age_days"])).toEqual([null, null]); // nulls LAST even reversed

    const clientAsc = sortRows(rows, { value: (r) => r["age_days"], tiebreak: (r) => r["finding_key"] });
    expect(clientAsc.map((r) => r["finding_key"])).toEqual(asc.map((r) => r["finding_key"]));

    const clientDesc = sortRows(rows, {
      value: (r) => r["age_days"], descending: true, tiebreak: (r) => r["finding_key"],
    });
    expect(clientDesc.map((r) => r["finding_key"])).toEqual(desc.map((r) => r["finding_key"]));
  });

  it("pageOfRegisterRows and the client's pageOf agree, including the clamp", () => {
    const rows = Array.from({ length: 37 }, (_, i) => i);
    for (const [page, size] of [[0, 10], [3, 10], [99, 10], [-1, 10], [0, 250]]) {
      const server = pageOfRegisterRows(rows, page, size);
      const client = pageOf(rows, page, size);
      expect(server).toEqual(client);
    }
  });
});
