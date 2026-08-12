// The inventory table's per-request slice: query resolution, the filter predicate, the
// comparators and the page clamp. These pin the contract the client mirrors for the
// small-inventory path, so a filtered deep link resolves to the same rows on either path.

import { describe, expect, it } from "vitest";
import {
  ASSET_COMPARATORS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  filterAssetRows,
  matchesAssetQuery,
  pageOf,
  resolveAssetQuery,
  sortAssetRows,
} from "../src/domain/assetTable";
import type { Rec } from "../src/domain/util";

const ROWS: Rec[] = [
  { id: "a", name: "Agent-A", kind: "AI_AGENT", cloud: "AWS", aars: 62, aarsBand: "HIGH" },
  { id: "b", name: "agent-b", kind: "AI_AGENT", cloud: "GCP", aars: 71, aarsBand: "CRITICAL" },
  { id: "c", name: "Model-C", kind: "AI_MODEL", cloud: "AWS", aars: null, aarsBand: null },
  { id: "d", name: "Bucket-D", kind: "BUCKET", cloud: null, aars: 30, aarsBand: "MEDIUM" },
];

describe("resolveAssetQuery", () => {
  it("defaults an empty param bag to page 0 of the AARS sort", () => {
    expect(resolveAssetQuery({})).toEqual({
      q: "", kind: "", cloud: "", band: "", sort: "aars", page: 0, pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it("lower-cases and trims the search term", () => {
    expect(resolveAssetQuery({ q: "  Agent " }).q).toBe("agent");
  });

  it("falls back to the AARS sort for an unknown sort key", () => {
    expect(resolveAssetQuery({ sort: "region" }).sort).toBe("aars");
    expect(resolveAssetQuery({ sort: "name" }).sort).toBe("name");
  });

  it("clamps hostile paging params instead of trusting them", () => {
    expect(resolveAssetQuery({ page: -5 }).page).toBe(0);
    expect(resolveAssetQuery({ page: "3" }).page).toBe(3);
    expect(resolveAssetQuery({ page: 2.7 }).page).toBe(2);
    expect(resolveAssetQuery({ page: "nonsense" }).page).toBe(0);
    expect(resolveAssetQuery({ pageSize: 100_000 }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(resolveAssetQuery({ pageSize: 0 }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(resolveAssetQuery({ pageSize: -10 }).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("matchesAssetQuery", () => {
  const q = (over: Partial<Rec>) => resolveAssetQuery(over as Rec);

  it("matches the name case-insensitively, anywhere in the string", () => {
    expect(filterAssetRows(ROWS, q({ q: "AGENT" })).map((r) => r["id"])).toEqual(["a", "b"]);
    expect(filterAssetRows(ROWS, q({ q: "-c" })).map((r) => r["id"])).toEqual(["c"]);
  });

  it("filters kind, cloud and band exactly", () => {
    expect(filterAssetRows(ROWS, q({ kind: "AI_AGENT" })).map((r) => r["id"])).toEqual(["a", "b"]);
    expect(filterAssetRows(ROWS, q({ cloud: "AWS" })).map((r) => r["id"])).toEqual(["a", "c"]);
    expect(filterAssetRows(ROWS, q({ band: "CRITICAL" })).map((r) => r["id"])).toEqual(["b"]);
  });

  it("treats a missing cloud as empty, never as a match", () => {
    expect(matchesAssetQuery(ROWS[3], q({ cloud: "AWS" }))).toBe(false);
    expect(matchesAssetQuery(ROWS[3], q({ cloud: "" }))).toBe(true);
  });

  it("ANDs every active filter", () => {
    expect(filterAssetRows(ROWS, q({ q: "agent", cloud: "GCP" })).map((r) => r["id"]))
      .toEqual(["b"]);
    expect(filterAssetRows(ROWS, q({ kind: "AI_AGENT", band: "MEDIUM" }))).toEqual([]);
  });
});

describe("sortAssetRows", () => {
  it("orders by AARS descending, unscored assets last", () => {
    expect(sortAssetRows(ROWS, "aars").map((r) => r["id"])).toEqual(["b", "a", "d", "c"]);
  });

  it("orders by name, and by kind/cloud with AARS breaking the tie", () => {
    expect(sortAssetRows(ROWS, "name").map((r) => r["id"])).toEqual(["a", "b", "d", "c"]);
    expect(sortAssetRows(ROWS, "kind").map((r) => r["id"])).toEqual(["b", "a", "c", "d"]);
    expect(sortAssetRows(ROWS, "cloud").map((r) => r["id"])).toEqual(["d", "a", "c", "b"]);
  });

  it("copies rather than reordering the cached model's array", () => {
    const original = [...ROWS];
    sortAssetRows(ROWS, "name");
    expect(ROWS).toEqual(original);
  });

  it("sorts an unscored-only set without throwing", () => {
    const rows: Rec[] = [{ name: "x" }, { name: "y" }];
    expect(sortAssetRows(rows, "aars")).toHaveLength(2);
    expect(ASSET_COMPARATORS.aars(rows[0], rows[1])).toBe(0);
  });
});

describe("pageOf", () => {
  const rows: Rec[] = Array.from({ length: 7 }, (_, i) => ({ id: String(i) }));

  it("slices the requested page", () => {
    expect(pageOf(rows, 0, 3).rows.map((r) => r["id"])).toEqual(["0", "1", "2"]);
    expect(pageOf(rows, 1, 3).rows.map((r) => r["id"])).toEqual(["3", "4", "5"]);
    expect(pageOf(rows, 2, 3).rows.map((r) => r["id"])).toEqual(["6"]);
    expect(pageOf(rows, 0, 3).pageCount).toBe(3);
  });

  it("clamps a page past the end to the last page, so a stale link still shows rows", () => {
    const p = pageOf(rows, 99, 3);
    expect(p.page).toBe(2);
    expect(p.rows.map((r) => r["id"])).toEqual(["6"]);
  });

  it("clamps a negative page to the first", () => {
    expect(pageOf(rows, -4, 3).page).toBe(0);
  });

  it("reports one empty page for an empty result set", () => {
    expect(pageOf([], 3, 25)).toEqual({ rows: [], page: 0, pageCount: 1 });
  });
});
