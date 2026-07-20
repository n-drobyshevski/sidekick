// The pure token/group <-> map converters behind the support-group-map tab store. The sheet
// I/O around them is thin and untested (like the rest of settingsStore/sheetsDb); these lock
// the conversion + malformed-row filtering that the persistence correctness rests on.
import { describe, expect, it } from "vitest";

import { supportGroupMapToRows, supportGroupRowsToMap } from "../src/server/settingsStore";

describe("support-group map <-> rows", () => {
  it("round-trips a map through rows", () => {
    const map = { "sub-a": "CS-PAY", "guid-1": "CS-NET" };
    const rows = supportGroupMapToRows(map);
    expect(rows).toEqual([
      { token: "sub-a", group: "CS-PAY" },
      { token: "guid-1", group: "CS-NET" },
    ]);
    expect(supportGroupRowsToMap(rows)).toEqual(map);
  });

  it("drops malformed pairs in both directions", () => {
    expect(supportGroupMapToRows({ good: "G", "": "X", bad: "", n: 5 })).toEqual([
      { token: "good", group: "G" },
    ]);
    expect(
      supportGroupRowsToMap([
        { token: "t", group: "G" },
        { token: "", group: "G" },
        { token: "t2", group: "" },
        { token: "t3" },
        { group: "G" },
      ]),
    ).toEqual({ t: "G" });
  });

  it("handles empty / non-object input", () => {
    expect(supportGroupMapToRows(null)).toEqual([]);
    expect(supportGroupMapToRows([1, 2])).toEqual([]);
    expect(supportGroupRowsToMap([])).toEqual({});
  });
});
