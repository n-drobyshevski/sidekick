// A Wiz page that arrives with BOTH a findings connection and GraphQL `errors` is partial: its
// nodes are good and its count is suspect. `queryPage` used to return the nodes and drop the
// errors on the floor, which made such a page indistinguishable from a whole one — and the
// completeness gate (gas_shared/domain/scanCompleteness.ts) needs exactly that distinction to
// know when not to compare a scan against the tenant's total.

import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ body: {} as unknown }));

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k: string) =>
      ({ WIZ_API_URL: "https://api.example.wiz.io/graphql", WIZ_API_TOKEN: "token" })[k] ?? null,
  }),
});
vi.stubGlobal("UrlFetchApp", {
  fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(H.body) }),
});
vi.stubGlobal("Utilities", { sleep: () => {} });

import { queryPage } from "../src/server/wizClient";

const connection = {
  nodes: [{ id: "f1" }, { id: "f2" }],
  pageInfo: { hasNextPage: true, endCursor: "c1" },
  totalCount: 40,
};

beforeEach(() => {
  H.body = {};
});

describe("queryPage keeps a partial page's errors beside its nodes", () => {
  it("returns the nodes AND the error messages", () => {
    H.body = {
      data: { vulnerabilityFindings: connection },
      errors: [{ message: "Cannot return null for non-nullable field" }, { message: "timeout" }],
    };
    const page = queryPage({});
    expect(page.nodes).toHaveLength(2);
    expect(page.totalCount).toBe(40);
    expect(page.partialErrors).toEqual(["Cannot return null for non-nullable field", "timeout"]);
  });

  it("a healthy page carries none", () => {
    H.body = { data: { vulnerabilityFindings: connection } };
    expect(queryPage({}).partialErrors).toEqual([]);
  });

  it("an errors-only response is still a failure, not a partial page", () => {
    H.body = { errors: [{ message: "unknown field" }] };
    expect(() => queryPage({})).toThrow(/no findings connection/);
  });
});
