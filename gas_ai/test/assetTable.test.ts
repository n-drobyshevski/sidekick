// The inventory table's per-request slice: query resolution, the filter predicate, the
// comparators, the facet counter and the page clamp. These pin the contract the client
// mirrors for the small-inventory path, so a filtered deep link resolves to the same rows
// on either path.

import { describe, expect, it } from "vitest";
import {
  ASSET_COMPARATORS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  facetCounts,
  filterAssetRows,
  matchesAssetQuery,
  pageOf,
  resolveAssetQuery,
  sortAssetRows,
} from "../src/domain/assetTable";
import type { Rec } from "../src/domain/util";

const ROWS: Rec[] = [
  {
    id: "a", name: "Agent-A", kind: "AI_AGENT", cloud: "AWS", region: "us-east-1",
    aars: 62, aarsSeverity: "HIGH", severity: "HIGH",
    combos: 1, guardrailMissing: true, agentic: true, projects: ["Alpha"],
  },
  {
    id: "b", name: "agent-b", kind: "AI_AGENT", cloud: "GCP", region: "eu-west-1",
    aars: 71, aarsSeverity: "CRITICAL", severity: "CRITICAL",
    combos: 2, guardrailMissing: false, agentic: true, projects: ["Alpha", "Beta"],
  },
  {
    id: "c", name: "Model-C", kind: "AI_MODEL", cloud: "AWS", region: "us-east-1",
    aars: null, aarsSeverity: null, severity: null,
    combos: 0, guardrailMissing: false, agentic: false, projects: [],
  },
  {
    id: "d", name: "Bucket-D", kind: "BUCKET", cloud: null, region: null,
    aars: 30, aarsSeverity: "MEDIUM", severity: "LOW",
    combos: 0, guardrailMissing: false, agentic: false, projects: ["Beta"],
  },
];

const ids = (rows: Rec[]): unknown[] => rows.map((r) => r["id"]);

describe("resolveAssetQuery", () => {
  it("defaults an empty param bag to page 0 of the AARS sort, worst-first", () => {
    expect(resolveAssetQuery({})).toEqual({
      q: "",
      aarsSeverities: [], severities: [], kinds: [], clouds: [], regions: [],
      projects: [], flags: [],
      sort: "aars", dir: "desc", page: 0, pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it("lower-cases and trims the search term", () => {
    expect(resolveAssetQuery({ q: "  Agent " }).q).toBe("agent");
  });

  it("falls back to the AARS sort for an unknown sort key", () => {
    expect(resolveAssetQuery({ sort: "nonsense" }).sort).toBe("aars");
    expect(resolveAssetQuery({ sort: "name" }).sort).toBe("name");
    expect(resolveAssetQuery({ sort: "region" }).sort).toBe("region");
  });

  it("opens risk columns worst-first and identity columns A→Z, unless told otherwise", () => {
    // A pre-direction `?sort=` link carried no dir, so the default has to reproduce what
    // that link used to mean.
    expect(resolveAssetQuery({ sort: "aars" }).dir).toBe("desc");
    expect(resolveAssetQuery({ sort: "severity" }).dir).toBe("desc");
    expect(resolveAssetQuery({ sort: "combos" }).dir).toBe("desc");
    expect(resolveAssetQuery({ sort: "name" }).dir).toBe("asc");
    expect(resolveAssetQuery({ sort: "aars", dir: "asc" }).dir).toBe("asc");
    expect(resolveAssetQuery({ sort: "name", dir: "DESC" }).dir).toBe("desc");
    expect(resolveAssetQuery({ sort: "name", dir: "sideways" }).dir).toBe("asc");
  });

  it("reads a dimension as a comma string or a real array, dropping blanks and dupes", () => {
    expect(resolveAssetQuery({ kinds: "AI_AGENT,BUCKET" }).kinds).toEqual(["AI_AGENT", "BUCKET"]);
    expect(resolveAssetQuery({ kinds: ["AI_AGENT", "BUCKET"] }).kinds)
      .toEqual(["AI_AGENT", "BUCKET"]);
    expect(resolveAssetQuery({ kinds: ",, AI_AGENT ,AI_AGENT," }).kinds).toEqual(["AI_AGENT"]);
    expect(resolveAssetQuery({ kinds: "" }).kinds).toEqual([]);
  });

  it("folds the single-select spellings into their plural dimension", () => {
    expect(resolveAssetQuery({ kind: "AI_AGENT" }).kinds).toEqual(["AI_AGENT"]);
    expect(resolveAssetQuery({ cloud: "AWS" }).clouds).toEqual(["AWS"]);
    expect(resolveAssetQuery({ project: "Alpha" }).projects).toEqual(["Alpha"]);
    // The plural param wins when a link somehow carries both.
    expect(resolveAssetQuery({ kinds: "BUCKET", kind: "AI_AGENT" }).kinds).toEqual(["BUCKET"]);
  });

  it("still honors the pre-rename `band` param, MINIMAL included", () => {
    // Links shared before AARS bands were renamed to AARS severity must keep resolving.
    expect(resolveAssetQuery({ band: "CRITICAL" }).aarsSeverities).toEqual(["CRITICAL"]);
    expect(resolveAssetQuery({ band: "MINIMAL" }).aarsSeverities).toEqual(["INFO"]);
    expect(resolveAssetQuery({ aarsSeverity: "minimal" }).aarsSeverities).toEqual(["INFO"]);
    // The newer spelling wins when a link somehow carries several.
    expect(resolveAssetQuery({ aarsSeverity: "HIGH", band: "LOW" }).aarsSeverities)
      .toEqual(["HIGH"]);
    expect(resolveAssetQuery({ aarsSeverities: "LOW,HIGH", band: "CRITICAL" }).aarsSeverities)
      .toEqual(["LOW", "HIGH"]);
    // Junk resolves to "no filter" rather than a filter nothing can match.
    expect(resolveAssetQuery({ band: "BOGUS" }).aarsSeverities).toEqual([]);
    expect(resolveAssetQuery({ aarsSeverities: "HIGH,BOGUS" }).aarsSeverities).toEqual(["HIGH"]);
  });

  it("keeps only real issue severities and real risk flags", () => {
    expect(resolveAssetQuery({ severities: "critical,bogus,LOW" }).severities)
      .toEqual(["CRITICAL", "LOW"]);
    expect(resolveAssetQuery({ flags: "combo,nope,AGENTIC" }).flags).toEqual(["combo", "agentic"]);
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
    expect(ids(filterAssetRows(ROWS, q({ q: "AGENT" })))).toEqual(["a", "b"]);
    expect(ids(filterAssetRows(ROWS, q({ q: "-c" })))).toEqual(["c"]);
  });

  it("filters kind, cloud and AARS severity exactly", () => {
    expect(ids(filterAssetRows(ROWS, q({ kind: "AI_AGENT" })))).toEqual(["a", "b"]);
    expect(ids(filterAssetRows(ROWS, q({ cloud: "AWS" })))).toEqual(["a", "c"]);
    expect(ids(filterAssetRows(ROWS, q({ aarsSeverity: "CRITICAL" })))).toEqual(["b"]);
  });

  it("treats a missing cloud as empty, never as a match", () => {
    expect(matchesAssetQuery(ROWS[3], q({ cloud: "AWS" }))).toBe(false);
    expect(matchesAssetQuery(ROWS[3], q({ cloud: "" }))).toBe(true);
  });

  it("ORs the values inside one dimension", () => {
    expect(ids(filterAssetRows(ROWS, q({ kinds: "AI_MODEL,BUCKET" })))).toEqual(["c", "d"]);
    expect(ids(filterAssetRows(ROWS, q({ aarsSeverities: "CRITICAL,MEDIUM" }))))
      .toEqual(["b", "d"]);
    expect(ids(filterAssetRows(ROWS, q({ severities: "CRITICAL,LOW" })))).toEqual(["b", "d"]);
  });

  it("ANDs across dimensions, so adding one can only ever narrow", () => {
    expect(ids(filterAssetRows(ROWS, q({ q: "agent", clouds: "GCP" })))).toEqual(["b"]);
    expect(filterAssetRows(ROWS, q({ kinds: "AI_AGENT", aarsSeverities: "MEDIUM" }))).toEqual([]);
    expect(ids(filterAssetRows(ROWS, q({ kinds: "AI_AGENT,BUCKET", clouds: "AWS" }))))
      .toEqual(["a"]);
  });

  it("matches a project if the row carries any of the selected ones", () => {
    expect(ids(filterAssetRows(ROWS, q({ projects: "Alpha" })))).toEqual(["a", "b"]);
    expect(ids(filterAssetRows(ROWS, q({ projects: "Beta" })))).toEqual(["b", "d"]);
    expect(ids(filterAssetRows(ROWS, q({ projects: "Alpha,Beta" })))).toEqual(["a", "b", "d"]);
    // A row with no projects is never swept in by a project filter.
    expect(matchesAssetQuery(ROWS[2], q({ projects: "Alpha" }))).toBe(false);
  });

  it("filters region like any other single-valued column", () => {
    expect(ids(filterAssetRows(ROWS, q({ regions: "us-east-1" })))).toEqual(["a", "c"]);
    expect(ids(filterAssetRows(ROWS, q({ region: "eu-west-1" })))).toEqual(["b"]);
  });

  it("ANDs the risk flags inside their own dimension, unlike every other one", () => {
    expect(ids(filterAssetRows(ROWS, q({ flags: "combo" })))).toEqual(["a", "b"]);
    expect(ids(filterAssetRows(ROWS, q({ flags: "guardrail" })))).toEqual(["a"]);
    expect(ids(filterAssetRows(ROWS, q({ flags: "agentic" })))).toEqual(["a", "b"]);
    // Ticking a second risk signal narrows to assets carrying both — the triage question.
    expect(ids(filterAssetRows(ROWS, q({ flags: "guardrail,agentic" })))).toEqual(["a"]);
    expect(ids(filterAssetRows(ROWS, q({ flags: "combo,guardrail,agentic" })))).toEqual(["a"]);
  });

  it("treats a missing boolean as false rather than as a match", () => {
    expect(matchesAssetQuery({ name: "x" }, q({ flags: "guardrail" }))).toBe(false);
    expect(matchesAssetQuery({ name: "x", combos: 0 }, q({ flags: "combo" }))).toBe(false);
  });
});

describe("sortAssetRows", () => {
  it("orders by AARS descending, unscored assets last", () => {
    expect(ids(sortAssetRows(ROWS, "aars"))).toEqual(["b", "a", "d", "c"]);
  });

  it("orders by name, and by kind/cloud with AARS breaking the tie", () => {
    expect(ids(sortAssetRows(ROWS, "name"))).toEqual(["a", "b", "d", "c"]);
    expect(ids(sortAssetRows(ROWS, "kind"))).toEqual(["b", "a", "c", "d"]);
    expect(ids(sortAssetRows(ROWS, "cloud"))).toEqual(["d", "a", "c", "b"]);
  });

  it("ranks the severity column by severity, not alphabetically", () => {
    // Alphabetical would put CRITICAL, HIGH, LOW; rank puts the worst first and the
    // unset severity last.
    expect(ids(sortAssetRows(ROWS, "severity"))).toEqual(["b", "a", "d", "c"]);
    expect(ids(sortAssetRows(ROWS, "severity", "asc"))).toEqual(["c", "d", "a", "b"]);
  });

  it("orders by combination count and by region", () => {
    expect(ids(sortAssetRows(ROWS, "combos"))).toEqual(["b", "a", "d", "c"]);
    expect(ids(sortAssetRows(ROWS, "region"))).toEqual(["d", "b", "a", "c"]);
  });

  it("flips the column but never the AARS tie-break", () => {
    // kind descending: BUCKET, AI_MODEL, then the two AI_AGENTs — still worst-first.
    expect(ids(sortAssetRows(ROWS, "kind", "desc"))).toEqual(["d", "c", "b", "a"]);
    expect(ids(sortAssetRows(ROWS, "aars", "asc"))).toEqual(["c", "d", "a", "b"]);
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

describe("facetCounts", () => {
  const counts = (over: Partial<Rec>) => facetCounts(ROWS, resolveAssetQuery(over as Rec));

  it("counts every dimension across the whole set when nothing is filtered", () => {
    const f = counts({});
    expect(f.kinds).toEqual([
      { value: "AI_AGENT", count: 2 }, { value: "AI_MODEL", count: 1 },
      { value: "BUCKET", count: 1 },
    ]);
    // Severity dimensions come back worst-first, not alphabetically.
    expect(f.aarsSeverities).toEqual([
      { value: "CRITICAL", count: 1 }, { value: "HIGH", count: 1 }, { value: "MEDIUM", count: 1 },
    ]);
    expect(f.severities).toEqual([
      { value: "CRITICAL", count: 1 }, { value: "HIGH", count: 1 }, { value: "LOW", count: 1 },
    ]);
    // A row with no cloud contributes to no cloud option.
    expect(f.clouds).toEqual([{ value: "AWS", count: 2 }, { value: "GCP", count: 1 }]);
    // A row on two projects counts toward both.
    expect(f.projects).toEqual([{ value: "Alpha", count: 2 }, { value: "Beta", count: 2 }]);
    expect(f.regions).toEqual([
      { value: "eu-west-1", count: 1 }, { value: "us-east-1", count: 2 },
    ]);
    expect(f.flags).toEqual([
      { value: "combo", count: 2 }, { value: "guardrail", count: 1 },
      { value: "agentic", count: 2 },
    ]);
    expect(f.matched).toBe(ROWS.length);
  });

  it("counts risk flags against the flags already ticked, because they AND", () => {
    // With `agentic` on, "guardrail" must read as "how many are agentic AND missing one",
    // not as the whole-landscape guardrail count — that number is what ticking it would give.
    const f = counts({ flags: "agentic" });
    expect(f.flags).toEqual([
      { value: "combo", count: 2 }, { value: "guardrail", count: 1 },
      { value: "agentic", count: 2 },
    ]);
    expect(counts({ flags: "guardrail" }).flags).toContainEqual({ value: "agentic", count: 1 });
    expect(f.matched).toBe(2);
  });

  it("reports `matched` as the count the table is about to show", () => {
    expect(counts({ kinds: "AI_AGENT" }).matched)
      .toBe(filterAssetRows(ROWS, resolveAssetQuery({ kinds: "AI_AGENT" })).length);
    expect(counts({ q: "zzz" }).matched).toBe(0);
  });

  it("does not let a dimension constrain its own counts", () => {
    // Picking one kind must not zero the other kinds — those numbers are exactly what
    // tells you what switching to them would cost.
    expect(counts({ kinds: "AI_AGENT" }).kinds).toEqual([
      { value: "AI_AGENT", count: 2 }, { value: "AI_MODEL", count: 1 },
      { value: "BUCKET", count: 1 },
    ]);
  });

  it("does let every other dimension constrain it", () => {
    expect(counts({ clouds: "AWS" }).kinds).toEqual([
      { value: "AI_AGENT", count: 1 }, { value: "AI_MODEL", count: 1 },
    ]);
    expect(counts({ kinds: "AI_AGENT" }).clouds).toEqual([
      { value: "AWS", count: 1 }, { value: "GCP", count: 1 },
    ]);
    expect(counts({ q: "agent" }).flags).toEqual([
      { value: "combo", count: 2 }, { value: "guardrail", count: 1 },
      { value: "agentic", count: 2 },
    ]);
  });

  it("keeps a selected value listed at zero so it can still be switched off", () => {
    const f = counts({ clouds: "AZURE" });
    expect(f.clouds).toContainEqual({ value: "AZURE", count: 0 });
    // …and the dimensions it constrains legitimately empty out.
    expect(f.kinds).toEqual([]);
  });
});

describe("pageOf", () => {
  const rows: Rec[] = Array.from({ length: 7 }, (_, i) => ({ id: String(i) }));

  it("slices the requested page", () => {
    expect(ids(pageOf(rows, 0, 3).rows)).toEqual(["0", "1", "2"]);
    expect(ids(pageOf(rows, 1, 3).rows)).toEqual(["3", "4", "5"]);
    expect(ids(pageOf(rows, 2, 3).rows)).toEqual(["6"]);
    expect(pageOf(rows, 0, 3).pageCount).toBe(3);
  });

  it("clamps a page past the end to the last page, so a stale link still shows rows", () => {
    const p = pageOf(rows, 99, 3);
    expect(p.page).toBe(2);
    expect(ids(p.rows)).toEqual(["6"]);
  });

  it("clamps a negative page to the first", () => {
    expect(pageOf(rows, -4, 3).page).toBe(0);
  });

  it("reports one empty page for an empty result set", () => {
    expect(pageOf([], 3, 25)).toEqual({ rows: [], page: 0, pageCount: 1 });
  });
});
