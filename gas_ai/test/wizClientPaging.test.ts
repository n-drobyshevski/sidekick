// fetchPage's size fallback, and the failures it must NOT spend a second walk on.
//
// `gqlPost` already retries 429/5xx four times with backoff. The fallback sits ON TOP of
// that: before this test existed, any error that was not a 4xx bought a whole second
// gqlPost at the smaller size, so one throttled page cost eight POSTs and every HTTP-200
// enum rejection during per-candidate type probing cost two.
//
// The rule under test: retry smaller only when a smaller page could plausibly change the
// answer (gateway 5xx, transport/timeout, parse failure). A rate limit, a GraphQL error
// envelope and a connection-shape mismatch are all verdicts that do not move with `first`.

import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.UrlFetchApp;

interface Reply {
  status?: number;
  body?: unknown;
  throws?: string;
}

/** Stubs GAS and replays `replies` in order, repeating the last one forever. */
function stubWiz(replies: Reply[]): { calls: { first: unknown }[] } {
  const calls: { first: unknown }[] = [];
  (globalThis as Record<string, unknown>).PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k: string) =>
        ({
          WIZ_API_URL: "https://api.test/graphql",
          WIZ_AUTH_URL: "https://auth.test/oauth/token",
          WIZ_CLIENT_ID: "id",
          WIZ_CLIENT_SECRET: "secret",
        } as Record<string, string>)[k] ?? null,
      setProperty: () => undefined,
      deleteProperty: () => undefined,
    }),
  };
  (globalThis as Record<string, unknown>).CacheService = {
    getScriptCache: () => ({ get: () => "test-token", put: () => undefined }),
  };
  (globalThis as Record<string, unknown>).Utilities = { sleep: () => undefined };
  (globalThis as Record<string, unknown>).UrlFetchApp = {
    fetch: (_url: string, opts: { payload: string }) => {
      const sent = JSON.parse(opts.payload) as { variables: Record<string, unknown> };
      calls.push({ first: sent.variables["first"] });
      const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (reply.throws) throw new Error(reply.throws);
      return {
        getResponseCode: () => reply.status ?? 200,
        getContentText: () => JSON.stringify(reply.body ?? {}),
      };
    },
  };
  return { calls };
}

const OK_PAGE = {
  data: {
    cloudResourcesV2: { nodes: [{ id: "a" }], pageInfo: { hasNextPage: false }, totalCount: 1 },
  },
};

afterEach(() => {
  (globalThis as Record<string, unknown>).UrlFetchApp = ORIGINAL_FETCH;
  vi.resetModules();
});

describe("smallerPageCouldHelp", () => {
  it("refuses the failures a smaller page cannot fix", async () => {
    const { smallerPageCouldHelp, WizQueryError } = await import("../src/server/wizClientAi");
    const no = [
      "Wiz query failed after retries (HTTP 429).",
      "Wiz query failed (HTTP 400): cannot represent value",
      "Wiz response carried no data: failed to parse object type [AI_TOOL]",
      "Wiz response carried no cloudResourcesV2 connection.",
    ];
    for (const m of no) expect(smallerPageCouldHelp(new WizQueryError(m))).toBe(false);
  });

  it("allows the ones it can — gateway 5xx, and anything that is not a query error", async () => {
    const { smallerPageCouldHelp, WizQueryError } = await import("../src/server/wizClientAi");
    expect(smallerPageCouldHelp(new WizQueryError("Wiz query failed after retries (HTTP 504)."))).toBe(true);
    // A transport error, a timeout or a parse failure on a truncated body all arrive as
    // something other than WizQueryError — that is the "response was too big" bucket.
    expect(smallerPageCouldHelp(new Error("Address unavailable"))).toBe(true);
    expect(smallerPageCouldHelp(new SyntaxError("Unexpected end of JSON input"))).toBe(true);
  });
});

describe("fetchPage size fallback", () => {
  it("does NOT re-walk a rate-limited page — the amplification this replaced", async () => {
    const { calls } = stubWiz([{ status: 429 }]);
    const { fetchCloudResourcesPage } = await import("../src/server/wizClientAi");
    expect(() => fetchCloudResourcesPage({ query: "query {}" })).toThrow(/429/);
    // Four attempts inside gqlPost and nothing more. It used to be eight.
    expect(calls).toHaveLength(4);
  });

  it("does NOT re-walk an HTTP-200 GraphQL error envelope", async () => {
    // The shape a tenant returns for a rejected enum value — the oracle
    // probeCandidateTypes reads. Costing two calls per candidate was pure waste.
    const { calls } = stubWiz([
      { status: 200, body: { errors: [{ message: "failed to parse object type [AI_TOOL]" }] } },
    ]);
    const { fetchCloudResourcesPage } = await import("../src/server/wizClientAi");
    expect(() => fetchCloudResourcesPage({ query: "query {}" })).toThrow(/failed to parse object type/);
    expect(calls).toHaveLength(1);
  });

  it("does NOT re-walk a connection-shape mismatch", async () => {
    const { calls } = stubWiz([{ status: 200, body: { data: { cloudResourcesV2: null } } }]);
    const { fetchCloudResourcesPage } = await import("../src/server/wizClientAi");
    expect(() => fetchCloudResourcesPage({ query: "query {}" })).toThrow(/connection/);
    expect(calls).toHaveLength(1);
  });

  it("still rethrows a 4xx untouched", async () => {
    const { calls } = stubWiz([{ status: 400, body: { errors: [{ message: "bad field" }] } }]);
    const { fetchCloudResourcesPage } = await import("../src/server/wizClientAi");
    expect(() => fetchCloudResourcesPage({ query: "query {}" })).toThrow(/HTTP 400/);
    expect(calls).toHaveLength(1);
  });

  it("DOES retry smaller on a transport error, at PAGE_SIZE_FALLBACK", async () => {
    const { calls } = stubWiz([{ throws: "Timeout" }, { status: 200, body: OK_PAGE }]);
    const { fetchCloudResourcesPage } = await import("../src/server/wizClientAi");
    const { PAGE_SIZE, PAGE_SIZE_FALLBACK } = await import("../src/server/wizQueriesAi");
    const page = fetchCloudResourcesPage({ query: "query {}" });
    expect(page.rows).toHaveLength(1);
    expect(calls.map((c) => c.first)).toEqual([PAGE_SIZE, PAGE_SIZE_FALLBACK]);
  });

  it("DOES retry smaller on a gateway 5xx, once gqlPost has exhausted its own retries", async () => {
    const replies: Reply[] = [
      { status: 504 }, { status: 504 }, { status: 504 }, { status: 504 },
      { status: 200, body: OK_PAGE },
    ];
    const { calls } = stubWiz(replies);
    const { fetchCloudResourcesPage } = await import("../src/server/wizClientAi");
    const { PAGE_SIZE_FALLBACK } = await import("../src/server/wizQueriesAi");
    expect(fetchCloudResourcesPage({ query: "query {}" }).rows).toHaveLength(1);
    expect(calls).toHaveLength(5);
    expect(calls[4].first).toBe(PAGE_SIZE_FALLBACK);
  });

  it("never retries UP — a first:1 probe stays at 1", async () => {
    // probeCandidateTypes asks for one row. The old fallback answered a failure there by
    // asking for FIFTY, which is not a fallback at all.
    const { calls } = stubWiz([{ throws: "Timeout" }]);
    const { fetchCloudResourcesPage } = await import("../src/server/wizClientAi");
    expect(() => fetchCloudResourcesPage({ query: "query {}", first: 1 })).toThrow(/Timeout/);
    expect(calls).toHaveLength(1);
    expect(calls[0].first).toBe(1);
  });
});
