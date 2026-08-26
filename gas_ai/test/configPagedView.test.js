// Cloud Configuration in its SECOND mode — the one no reader of this repo has seen.
//
// `getConfigFindings` answers in two shapes and says which in `all`: at or under
// CONFIG_CLIENT_ALL_MAX it ships the whole register and the browser filters, sorts and pages
// locally; past it the server does all three and ships ONE page, plus a control rollup over
// the filtered set and facet counts over the whole register.
//
// config.js never read `all`. It built its view from whatever rows it was holding, so past
// the ceiling it labelled a body of fifty "50 findings", drew a pager that ended at page 1,
// and applied its filters, facets and sorts to those fifty — all underneath a header whose
// totals describe the whole register. Nothing on screen said the list was partial. That is a
// wrong answer, not a slow one, and no test could see it: the seed estate is far under 1,000
// findings, so the paged branch is unreachable from the harness through the endpoint.
//
// So the decision moved into configView.js, where it is reachable. `legacyPageView` below is
// what config.js used to compute, written out; every spec that matters here asserts the two
// disagree, which is what makes this file a fix rather than a description.
//
// The rollup half is a MIRROR, in the shape configViewMirror.test.js established: the
// server's `rollupByControl` and the browser's `rollupControls` must produce the same table,
// and they emphatically do not use the same field names to do it — ControlRollup.gaps counts
// failing FINDINGS where this table means failing RESOURCES.

import { describe, expect, it } from "vitest";
import { rollupByControl } from "../src/domain/configFindings";
import {
  adoptControlRollups, applyConfigFilters, configFacetCounts, configPageView,
  configQueryParams, rollupControls, sortConfigRows, CONFIG_FACET_KEYS,
} from "../src/client/js/pages/configView.js";

const PAGE_SIZE = 50;

function row(over) {
  return Object.assign({
    id: "x", name: "n", severity: "MEDIUM", status: "OPEN", result: "FAIL",
    ruleShortId: "R-1", ruleName: "Rule one",
    resourceId: "res-1", resourceName: "Res one", resourceType: "BUCKET",
    cloud: "AWS", subscriptionName: "aws-prod", projects: ["P1"],
    businessImpact: "MBI", firstSeenAt: "2026-03-01T00:00:00Z",
    analyzedAt: "2026-08-01T00:00:00Z", risks: ["AI_SECURITY"],
    linked: false, ignored: false, iac: false, gap: true, domain: "",
    problemOutcome: "ATTEND",
  }, over);
}

/**
 * The fixture carries every case the two rollups could disagree on:
 *
 * - R-1 has the SAME resource twice, so `resources` and `findings` differ and a distinct
 *   count is distinguishable from a row count.
 * - R-1 also has a resolved finding (`gap: false`), so failing-resources differs from
 *   resources, and a linked one, so unlinked-failing differs from failing.
 * - R-2 is worse (CRITICAL) but narrower, and R-3 is the same severity as R-1 with MORE
 *   failing findings but FEWER failing resources — which is the pair that orders differently
 *   under the server's `gaps` than under this table's, and the reason adoptControlRollups
 *   re-sorts rather than renaming.
 * - Blank domains throughout except R-2, whose two findings share one domain.
 */
const ROWS = [
  row({ id: "1", ruleShortId: "R-1", resourceId: "res-a", severity: "HIGH", iac: true,
    firstSeenAt: "2026-01-05T00:00:00Z" }),
  row({ id: "2", ruleShortId: "R-1", resourceId: "res-a", severity: "MEDIUM" }),
  row({ id: "3", ruleShortId: "R-1", resourceId: "res-b", severity: "LOW", linked: true,
    domain: "Payments" }),
  row({ id: "4", ruleShortId: "R-1", resourceId: "res-c", gap: false, status: "RESOLVED",
    result: "PASS" }),
  row({ id: "5", ruleShortId: "R-2", ruleName: "Rule two", resourceId: "res-d",
    severity: "CRITICAL", cloud: "GCP", domain: "Trading", ignored: true }),
  row({ id: "6", ruleShortId: "R-2", ruleName: "Rule two", resourceId: "res-e",
    severity: "HIGH", cloud: "GCP", domain: "Trading" }),
  // Four failing FINDINGS across two failing RESOURCES: more than R-1's three findings on
  // three resources by one count and fewer by the other.
  row({ id: "7", ruleShortId: "R-3", ruleName: "Rule three", resourceId: "res-f",
    severity: "HIGH" }),
  row({ id: "8", ruleShortId: "R-3", ruleName: "Rule three", resourceId: "res-f",
    severity: "HIGH" }),
  row({ id: "9", ruleShortId: "R-3", ruleName: "Rule three", resourceId: "res-g",
    severity: "MEDIUM" }),
  row({ id: "10", ruleShortId: "R-3", ruleName: "Rule three", resourceId: "res-g",
    severity: "MEDIUM" }),
];

const EMPTY_QUERY = {
  q: "", severities: [], statuses: [], clouds: [], resourceTypes: [], rules: [],
  projects: [], domains: [], linkage: [], flags: [],
};
const viewOf = (over) => Object.assign(
  { query: Object.assign({}, EMPTY_QUERY), sort: "severity", descending: true, page: 0 },
  over,
);

/**
 * What config.js computed before this change, restated exactly: filter, sort and page the
 * rows in hand, count them, and group them — with no reference to `all`, `total`, `filtered`,
 * `pageCount` or `facetCounts`.
 */
function legacyPageView(data, view, pageSize) {
  const rows = data.rows || [];
  const filtered = applyConfigFilters(rows, view.query);
  const sorted = sortConfigRows(filtered, view.sort, view.descending);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(Math.max(0, view.page), pageCount - 1);
  return {
    total: rows.length,
    filtered: sorted.length,
    controls: rollupControls(filtered),
    page,
    pageCount,
    facetCounts: configFacetCounts(rows, view.query, CONFIG_FACET_KEYS),
  };
}

describe("the two rollups agree", () => {
  it("produces the same control table from held rows and from the server's own", () => {
    expect(adoptControlRollups(rollupByControl(ROWS))).toEqual(rollupControls(ROWS));
  });

  it("counts gaps and off-inventory in RESOURCES, which is not what ControlRollup.gaps means", () => {
    const mine = rollupControls(ROWS).filter((g) => g.ruleShortId === "R-3")[0];
    const theirs = rollupByControl(ROWS).filter((g) => g.ruleShortId === "R-3")[0];
    // Four failing findings, two failing resources. Reading `gaps` straight off the server
    // would put a findings count in a column whose neighbour is a resource count, and
    // "4 of 2 resources currently failing" is the sentence the table would then say.
    expect(theirs.gaps).toBe(4);
    expect(mine.gaps).toBe(2);
    expect(mine.gaps).toBe(theirs.gapResources);
    expect(mine.unlinked).toBe(theirs.unlinkedGapResources);
  });

  it("orders by failing resources, so the two counts cannot reorder the table", () => {
    // R-1 and R-3 are both worst-HIGH. R-3 has more failing findings (4 vs 3) and fewer
    // failing resources (2 vs 3), so the server's order and this table's differ — and a
    // rename-only adoption would show one order on a small tenant and the other on a large.
    const serverOrder = rollupByControl(ROWS).map((g) => g.ruleShortId);
    const mine = rollupControls(ROWS).map((g) => g.ruleShortId);
    expect(serverOrder).not.toEqual(mine);
    expect(adoptControlRollups(rollupByControl(ROWS)).map((g) => g.ruleShortId)).toEqual(mine);
  });
});

describe("the whole register in hand", () => {
  const data = { all: true, total: ROWS.length, rows: ROWS, totals: {}, facets: {} };

  it("filters, sorts and pages locally, and says no fetch is needed", () => {
    const m = configPageView(data, viewOf(), PAGE_SIZE);
    expect(m.paged).toBe(false);
    expect(m.refetches).toBe(false);
    expect(m.total).toBe(10);
    expect(m.filtered).toBe(10);
    expect(m.slice.length).toBe(10);
    expect(m.pageCount).toBe(1);
  });

  it("narrows to the filter the browser applies", () => {
    const m = configPageView(data, viewOf({
      query: Object.assign({}, EMPTY_QUERY, { clouds: ["GCP"] }),
    }), PAGE_SIZE);
    expect(m.filtered).toBe(2);
    expect(m.controls.map((g) => g.ruleShortId)).toEqual(["R-2"]);
  });

  it("agrees with the legacy view here, which is why the defect stayed invisible", () => {
    // The all branch is every tenant the AI framework filter produces in practice, and on it
    // the old code was right. That is the whole reason this shipped.
    const m = configPageView(data, viewOf(), PAGE_SIZE);
    const legacy = legacyPageView(data, viewOf(), PAGE_SIZE);
    expect(m.filtered).toBe(legacy.filtered);
    expect(m.pageCount).toBe(legacy.pageCount);
    expect(m.controls).toEqual(legacy.controls);
  });

  it("reads a payload with no `all` at all as the whole register", () => {
    // A deployment that predates the field. Absent must not read as `false`, which would put
    // the page into server-paged mode against a server that is not paging.
    const m = configPageView({ total: ROWS.length, rows: ROWS }, viewOf(), PAGE_SIZE);
    expect(m.paged).toBe(false);
    expect(m.filtered).toBe(10);
  });
});

describe("one page of a large register", () => {
  // 4,000 findings, 1,200 matching the filter, page 3 of 24, fifty rows on the wire.
  const page = ROWS.slice(0, 5);
  const data = {
    all: false,
    total: 4000,
    filtered: 1200,
    page: 3,
    pageCount: 24,
    rows: page,
    controls: rollupByControl(ROWS),
    facetCounts: { clouds: [{ value: "AWS", count: 900 }, { value: "GCP", count: 300 }] },
    totals: {},
    facets: {},
  };
  const view = viewOf({ page: 3 });

  it("states the FILTERED REGISTER, where the page counted the rows it was handed", () => {
    const m = configPageView(data, view, PAGE_SIZE);
    expect(m.paged).toBe(true);
    expect(m.filtered).toBe(1200);
    expect(m.total).toBe(4000);
    // The defect, as a number. `plural(sorted.length, "finding")` under a header reading 4,000.
    expect(legacyPageView(data, view, PAGE_SIZE).filtered).toBe(5);
  });

  it("keeps the server's pager, where the page invented one that ended at itself", () => {
    const m = configPageView(data, view, PAGE_SIZE);
    expect([m.page, m.pageCount]).toEqual([3, 24]);
    const legacy = legacyPageView(data, view, PAGE_SIZE);
    // Page 3 of a one-page pager: the old code clamped the page it was ON to the page count
    // it derived from five rows, so the pager both ended immediately and lost the reader's
    // place.
    expect([legacy.page, legacy.pageCount]).toEqual([0, 1]);
  });

  it("takes the server's facet counts, where the page counted its own fifty", () => {
    const m = configPageView(data, view, PAGE_SIZE);
    expect(m.facetCounts.clouds).toEqual([
      { value: "AWS", count: 900 }, { value: "GCP", count: 300 },
    ]);
    // Counted over the page: "GCP · 1" beside a filter that would return 300.
    const legacy = legacyPageView(data, view, PAGE_SIZE);
    expect(legacy.facetCounts.clouds).toEqual([
      { value: "AWS", count: 4 }, { value: "GCP", count: 1 },
    ]);
  });

  it("shows the server's rollup over the filtered set, not a regroup of the page", () => {
    const m = configPageView(data, view, PAGE_SIZE);
    expect(m.controls).toEqual(adoptControlRollups(rollupByControl(ROWS)));
    // The old code regrouped the five rows it held, so a control with 700 findings across
    // the register showed the two that happened to land on this page.
    expect(legacyPageView(data, view, PAGE_SIZE).controls.length).toBeLessThan(m.controls.length);
  });

  it("does not re-sort or re-slice rows the server already ordered and cut", () => {
    // Sorting fifty rows client-side produces an order that is correct for the page and wrong
    // for the register — row 51 belongs before row 1 as often as not.
    const m = configPageView(data, view, PAGE_SIZE);
    expect(m.slice).toEqual(page);
    expect(m.sorted).toEqual(page);
  });

  it("says every affordance now costs a round trip", () => {
    expect(configPageView(data, view, PAGE_SIZE).refetches).toBe(true);
  });
});

describe("the params that carry a view to the server", () => {
  it("omits everything unset, so the unfiltered load keys the same on every visit", () => {
    expect(configQueryParams(viewOf(), PAGE_SIZE)).toEqual({ pageSize: PAGE_SIZE });
  });

  it("names the same params resolveConfigQuery reads", () => {
    const params = configQueryParams(viewOf({
      query: Object.assign({}, EMPTY_QUERY, {
        q: "bedrock", severities: ["HIGH", "LOW"], clouds: ["AWS"], flags: ["gap"],
      }),
      sort: "resource", descending: true, page: 2,
    }), PAGE_SIZE);
    expect(params).toEqual({
      q: "bedrock", severities: "HIGH,LOW", clouds: "AWS", flags: "gap",
      sort: "resource", dir: "desc", page: 2, pageSize: PAGE_SIZE,
    });
  });
});
