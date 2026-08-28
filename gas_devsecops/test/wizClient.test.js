// The transport, which is the one file in src/ that touches the network.
//
// Everything here runs against a stubbed UrlFetchApp — no tenant is reached, and none needs
// to be: what is under test is how this code reads an answer, not what the answer says. The
// probe already establishes the wire semantics against the live tenant; these are the
// behaviours the probe has nothing to say about, because it has no retry, no backoff and no
// 429 handling at all.
//
// The specs that matter most are the ones about what is NOT a page: a 200 with no connection
// in it, and a 200 that is not JSON. An empty page returned from either would be read by the
// next scan's disappearance pass as the whole register having been remediated.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConnection as probeResolve } from "../probeHelpers.mjs";

const props = vi.hoisted(() => ({}));
const cache = vi.hoisted(() => ({ store: {}, puts: [] }));
const http = vi.hoisted(() => ({ calls: [], replies: [] }));
const slept = vi.hoisted(() => ({ ms: [] }));

vi.stubGlobal("PropertiesService", {
  getScriptProperties: () => ({
    getProperty: (k) => props[k] ?? null,
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: (k) => { delete props[k]; },
  }),
});
vi.stubGlobal("CacheService", {
  getScriptCache: () => ({
    get: (k) => cache.store[k] ?? null,
    put: (k, v, ttl) => { cache.store[k] = v; cache.puts.push({ k, ttl }); },
    remove: (k) => { delete cache.store[k]; },
  }),
});
vi.stubGlobal("Utilities", { sleep: (ms) => { slept.ms.push(ms); } });
/**
 * The scripted transport, RE-INSTALLED IN beforeEach rather than stubbed once.
 *
 * `vi.stubGlobal` inside a test outlives that test, so the authorization block below — which
 * replaces UrlFetchApp with one that throws — silently broke the first spec to run after it.
 * Measured: "leaves a rejected token reported as a credentials problem" failed against a
 * global still throwing the French refusal from three tests earlier.
 */
const httpStub = {
  fetch: (url, params) => {
    http.calls.push({ url, params });
    const reply = http.replies.shift();
    if (!reply) throw new Error(`no stubbed reply for ${url}`);
    return {
      getResponseCode: () => reply.code,
      getContentText: () => (typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body)),
    };
  },
};
vi.stubGlobal("UrlFetchApp", httpStub);

const load = () => import("../src/server/wizClient");

/** A well-formed one-page response for a scope, ready to be stubbed in. */
const page = (root, nodes, over = {}) => ({
  code: 200,
  body: {
    data: {
      [root]: {
        nodes,
        totalCount: over.totalCount ?? nodes.length,
        pageInfo: { hasNextPage: over.hasNextPage ?? false, endCursor: over.endCursor ?? null },
      },
    },
    ...(over.errors ? { errors: over.errors } : {}),
  },
});

const TOKEN_OK = { code: 200, body: { access_token: "t-abc", expires_in: 3600 } };

beforeEach(() => {
  for (const k of Object.keys(props)) delete props[k];
  cache.store = {}; cache.puts.length = 0;
  http.calls.length = 0; http.replies.length = 0;
  slept.ms.length = 0;
  props.WIZ_API_URL = "https://api.test.app.wiz.io/graphql";
  props.WIZ_CLIENT_ID = "cid";
  props.WIZ_CLIENT_SECRET = "csecret";
  vi.stubGlobal("UrlFetchApp", httpStub);
  vi.resetModules();
});

describe("the token", () => {
  it("uses a raw WIZ_API_TOKEN verbatim and exchanges nothing", async () => {
    props.WIZ_API_TOKEN = "  static-token  ";
    const { getToken } = await load();
    expect(getToken()).toBe("static-token");
    expect(http.calls).toHaveLength(0);
  });

  it("exchanges client credentials once and caches the result", async () => {
    const { getToken } = await load();
    http.replies.push(TOKEN_OK);
    expect(getToken()).toBe("t-abc");
    expect(getToken()).toBe("t-abc"); // second call is served from cache
    expect(http.calls).toHaveLength(1);
    const body = http.calls[0].params.payload;
    expect(body.grant_type).toBe("client_credentials");
    expect(body.audience).toBe("wiz-api");
    expect(http.calls[0].params.contentType).toBe("application/x-www-form-urlencoded");
  });

  it("keeps the cache TTL inside what CacheService will actually accept", async () => {
    // Five minutes of margin below expires_in, floored at a minute, and ceilinged at six
    // hours — CacheService refuses anything longer, and a silently rejected put means a
    // token exchange on every single page.
    const { getToken } = await load();
    http.replies.push({ code: 200, body: { access_token: "a", expires_in: 86400 } });
    getToken();
    expect(cache.puts[0].ttl).toBe(21_600);

    cache.store = {};
    http.replies.push({ code: 200, body: { access_token: "b", expires_in: 400 } });
    getToken(true);
    expect(cache.puts[1].ttl).toBe(100);

    cache.store = {};
    http.replies.push({ code: 200, body: { access_token: "c", expires_in: 10 } });
    getToken(true);
    expect(cache.puts[2].ttl).toBe(60);
  });

  it("refuses a 200 that carries no access_token", async () => {
    // Carrying an empty string forward would make every following page 401, and the walk
    // would report a query problem for a credentials one.
    const { getToken, WizAuthError } = await load();
    http.replies.push({ code: 200, body: { token_type: "Bearer" } });
    expect(() => getToken()).toThrow(WizAuthError);
  });
});

describe("what is not a page", () => {
  it("REFUSES a 200 whose data holds no connection, rather than reading it as zero rows", async () => {
    // PROBE_FINDINGS.md §9.1, one layer down. There a false zero produced a wrong report;
    // here it would be handed to the disappearance pass as "nothing is in this register any
    // more", and the whole scope would resolve as remediated.
    const { fetchPage, WizError } = await load();
    http.replies.push(TOKEN_OK, { code: 200, body: { data: { somethingElse: { count: 0 } } } });
    expect(() => fetchPage("sast")).toThrow(WizError);
  });

  it("refuses a 200 that is not JSON", async () => {
    const { fetchPage, WizError } = await load();
    http.replies.push(TOKEN_OK, { code: 200, body: "<html>gateway</html>" });
    expect(() => fetchPage("sast")).toThrow(WizError);
  });

  it("carries GraphQL errors that arrived WITH data instead of rejecting the page", async () => {
    // The captured sast_response.json is exactly this: a 200 with 40 good nodes and an
    // errors array beside them. brick/devsecops raises on any `errors`, which would throw
    // that response away wholesale — so the errors ride along and the rows are kept.
    const { fetchPage } = await load();
    http.replies.push(TOKEN_OK, page("sastFindings", [{ id: "a" }], {
      errors: [{ message: "field x unavailable" }],
    }));
    const res = fetchPage("sast");
    expect(res.nodes).toHaveLength(1);
    expect(res.partialErrors).toEqual(["field x unavailable"]);
  });

  it("finds the connection wherever the scope puts it", async () => {
    const { fetchPage } = await load();
    http.replies.push(TOKEN_OK, page("secretInstances", [{ id: "s" }], { totalCount: 1958 }));
    expect(fetchPage("secrets").totalCount).toBe(1958);
  });

  it("refuses a connection under the WRONG root", async () => {
    // The case a generic resolver cannot see: rows arrived, they parse, they have a pageInfo
    // — they are just another scope's population. Reading them would fill one register with
    // another's findings, and the next scan would resolve everything legitimately there.
    // (This spec caught a wrong fixture in this very file: sca's root is
    // `vulnerabilityFindings`, not `scaFindings`.)
    const { fetchPage, WizError } = await load();
    http.replies.push(TOKEN_OK, page("sastFindings", [{ id: "a" }]));
    expect(() => fetchPage("secrets")).toThrow(WizError);
  });
});

describe("resolveConnection stays pinned to the probe's copy", () => {
  // Two copies exist because one is a GAS bundle and the other a standalone Node script;
  // neither can import the other. The thing worse than two copies is two copies that
  // disagree about what "no rows" means, so they are run over the same table here.
  const cases = [
    { data: { sastFindings: { nodes: [], pageInfo: {} } }, root: "sastFindings" },
    { data: { secretInstances: { pageInfo: { hasNextPage: false } } }, root: "secretInstances" },
    { data: { a: null, b: { nodes: [1] } }, root: "b" },
    { data: { count: 0 }, root: null },
    { data: {}, root: null },
    { data: null, root: null },
  ];

  it("agrees on every case", async () => {
    const { resolveConnection } = await load();
    for (const c of cases) {
      const mine = resolveConnection(c.data);
      const theirs = probeResolve(c.data);
      expect(mine === null ? null : mine.root).toBe(c.root);
      expect(theirs.ok ? theirs.root : null).toBe(c.root);
    }
  });
});

describe("retrying", () => {
  it("refreshes the token once on a 401, and only when there is something to refresh", async () => {
    const { fetchPage } = await load();
    http.replies.push(TOKEN_OK, { code: 401, body: { m: "expired" } },
      { code: 200, body: { access_token: "t-new", expires_in: 3600 } },
      page("sastFindings", [{ id: "a" }]));
    expect(fetchPage("sast").nodes).toHaveLength(1);
    expect(http.calls.filter((c) => c.url.includes("oauth/token"))).toHaveLength(2);
  });

  it("does not retry a static token that was rejected — it names the remedy instead", async () => {
    // Nothing here can re-mint it, so a retry just spends another call and reports the same
    // 401. The message is the useful output.
    props.WIZ_API_TOKEN = "stale";
    const { fetchPage, WizAuthError } = await load();
    http.replies.push({ code: 401, body: { m: "expired" } });
    expect(() => fetchPage("sast")).toThrow(WizAuthError);
    expect(http.calls).toHaveLength(1); // one call, not a refresh and not a smaller ask

    http.replies.push({ code: 401, body: { m: "expired" } });
    expect(() => fetchPage("sast")).toThrow(/WIZ_CLIENT_ID/);
  });

  it("backs off on 429 and 5xx, then gives up rather than looping", async () => {
    const { fetchPage, WizError } = await load();
    http.replies.push(TOKEN_OK,
      { code: 429, body: {} }, { code: 503, body: {} },
      { code: 500, body: {} }, { code: 502, body: {} });
    expect(() => fetchPage("sast")).toThrow(WizError);
    expect(slept.ms).toEqual([1000, 2000, 4000, 8000]);
    // No second round at 250: throttling is not a size problem, and four more calls during
    // an outage buy nothing but a longer wait for the same answer.
    expect(http.calls.filter((c) => c.url.includes("graphql"))).toHaveLength(4);
  });

  it("succeeds on a retry after one transient failure", async () => {
    const { fetchPage } = await load();
    http.replies.push(TOKEN_OK, { code: 503, body: {} }, page("sastFindings", [{ id: "a" }]));
    expect(fetchPage("sast").nodes).toHaveLength(1);
  });

  it("does not back off on a 4xx — a malformed filter will not fix itself", async () => {
    // The one shape this register has shipped twice: HTTP 400
    // VALIDATION_INVALID_TYPE_VARIABLE, which fetches zero rows while looking like an empty
    // register. Sleeping between attempts would only make it slower to find out.
    const { fetchPage, WizRefusedError } = await load();
    const refusal = { code: 400, body: { errors: [{ message: "VALIDATION_INVALID_TYPE_VARIABLE" }] } };
    http.replies.push(TOKEN_OK, refusal, refusal); // the 500-row ask, then the 250-row one
    expect(() => fetchPage("sast")).toThrow(WizRefusedError);
    expect(slept.ms).toEqual([]);
  });
});

describe("the page-size fallback is a cost path, not a retry", () => {
  it("drops to 250 once when 500 is refused", async () => {
    const { fetchPage } = await load();
    http.replies.push(TOKEN_OK,
      { code: 400, body: { errors: [{ message: "query is too expensive" }] } },
      page("vulnerabilityFindings", [{ id: "a" }]));
    const res = fetchPage("sca");
    expect(res.pageSize).toBe(250);
    const asks = http.calls.filter((c) => c.url.includes("graphql"))
      .map((c) => JSON.parse(c.params.payload).variables.first);
    expect(asks).toEqual([500, 250]);
  });

  it("does not mask an auth failure behind a smaller ask", async () => {
    // Retrying a 401 at 250 rows would report a credentials problem as a data problem, and
    // spend a second call to do it.
    const { fetchPage, WizAuthError } = await load();
    props.WIZ_API_TOKEN = "stale";
    http.replies.push({ code: 403, body: {} });
    expect(() => fetchPage("sca")).toThrow(WizAuthError);
    expect(http.calls).toHaveLength(1);
  });

  it("does not fall back again once it is already at the floor", async () => {
    const { fetchPage, WizError } = await load();
    http.replies.push(TOKEN_OK, { code: 400, body: { errors: [{ message: "too expensive" }] } });
    expect(() => fetchPage("sca", { first: 250 })).toThrow(WizError);
    expect(http.calls.filter((c) => c.url.includes("graphql"))).toHaveLength(1);
  });
});

describe("testConnection turns 'present' into 'measured'", () => {
  it("exchanges a fresh token rather than trusting a cached one", async () => {
    // A cached token outlives a revoked client secret by up to six hours, so a connection
    // test that accepted one would keep reporting success after the credentials stopped
    // working — which is the exact claim it exists to stop the app making.
    const { testConnection } = await load();
    cache.store.wiz_token = "stale-but-cached";
    http.replies.push(TOKEN_OK, page("sastFindings", [{ id: "a" }], { totalCount: 127 }));
    expect(testConnection()).toEqual({ ok: true, rows: 127 });
    expect(http.calls[0].url).toContain("oauth/token");
  });

  it("asks for one row, not a page", async () => {
    const { testConnection } = await load();
    http.replies.push(TOKEN_OK, page("sastFindings", [{ id: "a" }]));
    testConnection();
    const gql = http.calls.find((c) => c.url.includes("graphql"));
    expect(JSON.parse(gql.params.payload).variables.first).toBe(1);
  });
});

describe("Apps Script itself refusing the call", () => {
  // The failure that shipped and reached an operator: the deployment's authorization predates
  // the bundle ever calling UrlFetchApp, so the platform throws BEFORE any request is made —
  // through none of the branches above — and its sentence names a scope URL and no remedy.
  //
  // THE TWO LANGUAGES ARE THE POINT OF THIS BLOCK. The message is localised, and the report
  // that prompted it arrived in French: an English-only match would pass every test in this
  // file and fail for the person who hit it. This repo has already paid for that once —
  // sheetsDb.ts deliberately does not test for "exceeds the maximum" for the same reason,
  // against the same tenant. Only the scope URL is locale-independent.
  const FRENCH = "Vous n'êtes pas autorisé à appeler UrlFetchApp.fetch. Autorisations "
    + "requises : https://www.googleapis.com/auth/script.external_request";
  const ENGLISH = "You do not have permission to call UrlFetchApp.fetch. Required "
    + "permissions: https://www.googleapis.com/auth/script.external_request";

  const throwOnFetch = (message) => {
    vi.stubGlobal("UrlFetchApp", { fetch: () => { throw new Error(message); } });
  };

  it("recognises the refusal in French", async () => {
    throwOnFetch(FRENCH);
    const { fetchPage, WizNotAuthorizedError } = await load();
    expect(() => fetchPage("sast")).toThrow(WizNotAuthorizedError);
  });

  it("recognises it in English too", async () => {
    throwOnFetch(ENGLISH);
    const { fetchPage, WizNotAuthorizedError } = await load();
    expect(() => fetchPage("sast")).toThrow(WizNotAuthorizedError);
  });

  it("carries the remedy, not the scope URL", async () => {
    // What the operator can act on. The middle step is the one that is skipped: pushing code
    // does not change what the /exec URL serves.
    throwOnFetch(FRENCH);
    const { fetchPage } = await load();
    expect(() => fetchPage("sast")).toThrow(/wizDiagnostic\(\)/);
    expect(() => fetchPage("sast")).toThrow(/New version/);
  });

  it("catches it at the TOKEN call too, not only the query", async () => {
    // getToken is the first thing to touch the network, so in OAuth mode it is where the
    // refusal actually lands — the query branch would never be reached.
    throwOnFetch(FRENCH);
    const { getToken, WizNotAuthorizedError } = await load();
    expect(() => getToken()).toThrow(WizNotAuthorizedError);
  });

  it("does NOT claim an ordinary failure is an authorization problem", async () => {
    // The guard only fires on the scope URL. A network blip or a bad URL must keep its own
    // message, or every transport failure would send the reader to redeploy the web app.
    throwOnFetch("DNS lookup failed for api.test.app.wiz.io");
    const { fetchPage, WizNotAuthorizedError } = await load();
    expect(() => fetchPage("sast")).toThrow(/DNS lookup failed/);
    expect(() => fetchPage("sast")).not.toThrow(WizNotAuthorizedError);
  });

  it("leaves a rejected token reported as a credentials problem", async () => {
    // The other side of the same line: an HTTP 401 is the tenant refusing the secret, and it
    // must not be dressed up as a deployment scope issue.
    const { fetchPage, WizAuthError, WizNotAuthorizedError } = await load();
    props.WIZ_API_TOKEN = "stale";
    http.replies.push({ code: 401, body: { m: "expired" } });
    expect(() => fetchPage("sast")).toThrow(WizAuthError);
    http.replies.push({ code: 401, body: { m: "expired" } });
    expect(() => fetchPage("sast")).not.toThrow(WizNotAuthorizedError);
  });
});
