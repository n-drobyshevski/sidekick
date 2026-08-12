// The client bundle can't import the TypeScript domain module, so the browser carries a
// hand-kept copy of it in src/client/js/assetQuery.js. That copy decides what a filtered,
// sorted, paged view means for every tenant under CLIENT_ALL_MAX — which is most of them —
// and client JS is never typechecked or linted, so nothing else would notice it drifting.
//
// This runs ONE table of cases through both implementations and requires identical
// answers. "Added a dimension server-side and forgot the browser" fails here, instead of
// shipping a deep link that resolves to different rows depending on how big the tenant is.
//
// The one asymmetry worth naming: the TS side coerces through a local `str()` and the JS
// side through the same helper, and the row projection (assetTableRow in src/server/api.ts)
// only ever emits strings, numbers, booleans, null and string[]. So there is no value a
// real row can carry where `String(v)` and the TS `str(v)` disagree.

import { describe, expect, it } from "vitest";
import * as ts from "../src/domain/assetTable";
import type { Rec } from "../src/domain/util";

// A variable specifier on purpose: a literal would make tsc demand type declarations for a
// plain-JS client module that has no business carrying any.
const MIRROR_PATH = "../src/client/js/assetQuery.js";
const js = (await import(MIRROR_PATH)) as unknown as typeof ts;

const ROWS: Rec[] = [
  {
    id: "a", name: "Agent-Alpha", kind: "AI_AGENT", cloud: "AWS", region: "us-east-1",
    aars: 62, aarsSeverity: "HIGH", severity: "HIGH",
    combos: 1, guardrailMissing: true, agentic: true, projects: ["Alpha", "Shared"],
  },
  {
    id: "b", name: "agent-beta", kind: "AI_AGENT", cloud: "GCP", region: "eu-west-1",
    aars: 71, aarsSeverity: "CRITICAL", severity: "CRITICAL",
    combos: 3, guardrailMissing: false, agentic: true, projects: ["Shared"],
  },
  {
    id: "c", name: "Model-Gamma", kind: "AI_MODEL", cloud: "AWS", region: "us-east-1",
    aars: null, aarsSeverity: null, severity: null,
    combos: 0, guardrailMissing: false, agentic: false, projects: [],
  },
  {
    id: "d", name: "Bucket-Delta", kind: "BUCKET", cloud: null, region: null,
    aars: 30, aarsSeverity: "MEDIUM", severity: "LOW",
    combos: 0, guardrailMissing: true, agentic: false, projects: ["Beta"],
  },
  {
    id: "e", name: "mcp-Epsilon", kind: "MCP_SERVER", cloud: "AZURE", region: "westeurope",
    aars: 30, aarsSeverity: "MEDIUM", severity: "MEDIUM",
    combos: 2, guardrailMissing: true, agentic: false, projects: ["Beta", "Shared"],
  },
];

/** Every shape a URL or caller can realistically hand these functions. */
const PARAM_CASES: Rec[] = [
  {},
  { q: "  AGENT " },
  { kind: "AI_AGENT" },
  { kinds: "AI_AGENT,BUCKET" },
  { kinds: ["AI_AGENT", "MCP_SERVER"] },
  { kinds: ",, AI_AGENT ,AI_AGENT," },
  { cloud: "AWS" },
  { clouds: "AWS,AZURE" },
  { regions: "us-east-1" },
  { region: "eu-west-1" },
  { projects: "Shared" },
  { projects: "Alpha,Beta" },
  { aarsSeverity: "CRITICAL" },
  { aarsSeverities: "CRITICAL,MEDIUM" },
  { band: "MINIMAL" },
  { band: "BOGUS" },
  { aarsSeverity: "HIGH", band: "LOW" },
  { aarsSeverities: "HIGH,BOGUS,minimal" },
  { severities: "critical,bogus,LOW" },
  { severity: "MEDIUM" },
  { flags: "combo" },
  { flags: "guardrail,agentic" },
  { flags: "combo,nope,AGENTIC" },
  { kinds: "AI_AGENT", clouds: "GCP", flags: "agentic" },
  { q: "agent", aarsSeverities: "CRITICAL", projects: "Shared" },
  { sort: "name" },
  { sort: "name", dir: "desc" },
  { sort: "severity" },
  { sort: "combos", dir: "asc" },
  { sort: "nonsense", dir: "sideways" },
  { page: "3", pageSize: 100_000 },
  { page: -5, pageSize: 0 },
  { page: 2.7, pageSize: -10 },
];

const ids = (rows: Rec[]): unknown[] => rows.map((r) => r["id"]);

describe("assetQuery.js mirrors assetTable.ts", () => {
  it("exports the same surface", () => {
    for (const name of [
      "resolveAssetQuery", "matchesAssetQuery", "filterAssetRows", "sortAssetRows",
      "facetCounts", "pageOf", "hasAssetFlag", "assetComparator",
      "ASSET_SORTS", "ASSET_FLAGS", "FACET_KEYS", "DEFAULT_SORT_DIR", "ASSET_COMPARATORS",
    ]) {
      expect(js, `assetQuery.js is missing ${name}`).toHaveProperty(name);
    }
    expect(js.ASSET_SORTS).toEqual(ts.ASSET_SORTS);
    expect(js.ASSET_FLAGS).toEqual([...ts.ASSET_FLAGS]);
    expect(js.FACET_KEYS).toEqual([...ts.FACET_KEYS]);
    expect(js.DEFAULT_SORT_DIR).toEqual(ts.DEFAULT_SORT_DIR);
  });

  it("resolves every param shape identically", () => {
    for (const params of PARAM_CASES) {
      expect(js.resolveAssetQuery(params), JSON.stringify(params))
        .toEqual(ts.resolveAssetQuery(params));
    }
  });

  it("selects the same rows for every query", () => {
    for (const params of PARAM_CASES) {
      const jq = js.resolveAssetQuery(params);
      const tq = ts.resolveAssetQuery(params);
      expect(ids(js.filterAssetRows(ROWS, jq)), JSON.stringify(params))
        .toEqual(ids(ts.filterAssetRows(ROWS, tq)));
    }
  });

  it("orders the same way for every column in both directions", () => {
    for (const sort of ts.ASSET_SORTS) {
      for (const dir of ["asc", "desc"] as const) {
        expect(ids(js.sortAssetRows(ROWS, sort, dir)), `${sort}/${dir}`)
          .toEqual(ids(ts.sortAssetRows(ROWS, sort, dir)));
      }
      // …and with the direction left to the column's own default.
      expect(ids(js.sortAssetRows(ROWS, sort)), `${sort}/default`)
        .toEqual(ids(ts.sortAssetRows(ROWS, sort)));
    }
  });

  it("counts facets identically, including the flags AND-semantics", () => {
    for (const params of PARAM_CASES) {
      const jq = js.resolveAssetQuery(params);
      const tq = ts.resolveAssetQuery(params);
      expect(js.facetCounts(ROWS, jq), JSON.stringify(params))
        .toEqual(ts.facetCounts(ROWS, tq));
    }
  });

  it("agrees on `matched` with a straight filter, for every query", () => {
    for (const params of PARAM_CASES) {
      const tq = ts.resolveAssetQuery(params);
      expect(ts.facetCounts(ROWS, tq).matched, JSON.stringify(params))
        .toBe(ts.filterAssetRows(ROWS, tq).length);
    }
  });

  it("pages identically", () => {
    for (const size of [1, 2, 3, 25]) {
      for (const page of [-1, 0, 1, 2, 99]) {
        expect(js.pageOf(ROWS, page, size), `${page}/${size}`)
          .toEqual(ts.pageOf(ROWS, page, size));
      }
    }
  });
});
