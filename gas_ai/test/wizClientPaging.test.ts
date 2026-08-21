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

  it("retries smaller on the tenant's internal error, which wears a 200's clothes", async () => {
    // The third form of the errors-only envelope, and the one the rule above did not know
    // about. Wiz returns its generic internal error as HTTP 200 with no data — same shape as
    // a rejected enum, opposite meaning. It is a 504 in disguise, so it gets a 504's retry.
    //
    // Verbatim from the first sync that ever collected graph rows at scale: two hours in,
    // 84,912 rows deep, one page too expensive to assemble. The fallback built for exactly
    // that case declined to fire because the message shape said "document verdict", and the
    // step it happened on took the whole run down with it.
    const { smallerPageCouldHelp, WizQueryError } = await import("../src/server/wizClientAi");
    const internal =
      "Wiz response carried no data: oops! an internal error has occurred. for reference " +
      "purposes, this is your request id: 57047012-a695-4a7f-a6c3-3c7d8ebec259";
    expect(smallerPageCouldHelp(new WizQueryError(internal))).toBe(true);

    // And the distinction is the point: a verdict about the DOCUMENT still buys nothing at 50
    // rows, even though it arrives in the same envelope.
    expect(smallerPageCouldHelp(
      new WizQueryError("Wiz response carried no data: failed to parse object type [AI_TOOL]"),
    )).toBe(false);
  });
});

describe("isTenantRefusal", () => {
  it("draws the line at the transport boundary, so our own bugs stay fatal", async () => {
    // What an OPTIONAL step is allowed to survive. A schema rejection and a tenant-side
    // internal error are both "Wiz will not serve this", and for an enhancement step the
    // right answer to both is to record it and carry on — the alternative cost two hours of
    // fetched rows to a transient failure on a step whose contract is that it may fail.
    //
    // A TypeError from our own code is NOT that. Skipping our bugs is how a sync reports
    // success over a dataset it silently mangled, which is the failure this whole area exists
    // to avoid.
    const { isTenantRefusal, WizQueryError } = await import("../src/server/wizClientAi");
    for (const m of [
      "Wiz query failed (HTTP 400): cannot represent value",
      "Wiz response carried no data: oops! an internal error has occurred.",
      "Wiz query failed after retries (HTTP 504).",
      "Wiz query failed after retries (HTTP 429).",
    ]) expect(isTenantRefusal(new WizQueryError(m)), m).toBe(true);

    expect(isTenantRefusal(new TypeError("Cannot read properties of null"))).toBe(false);
    expect(isTenantRefusal(new Error("something in a normalizer"))).toBe(false);
    expect(isTenantRefusal("not an error at all")).toBe(false);
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
