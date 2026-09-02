// The transport, and the four ways it is allowed to fail.
//
// Everything here is a stub. NOTHING IN THIS FILE MAY REACH THE TENANT — the live one is a
// production security tenant, and a test suite that can send a query to it is a test suite
// that will, on someone's laptop, at scale, by accident. `UrlFetchApp` is replaced wholesale
// and every reply is written here.
//
// WHAT IS PINNED, AND WHY EACH ONE IS PINNED RATHER THAN TRUSTED:
//
//   the 401 refresh          a rejected token must be dropped, re-issued and retried ONCE;
//                            twice is a loop against a credential that is simply wrong
//   the backoff sequence     [1000, 2000, 4000], not [1000, 2000, 4000, 8000] — the fourth
//                            sleep precedes the throw and buys nothing but budget
//   the 4xx immediacy        the schema does not change its mind, and a shape rejection has
//                            to arrive carrying VALIDATION_INVALID_TYPE_VARIABLE or it reads
//                            like an empty register
//   the connection refusal   every DEFECT shape from test/probeHelpers.test.js, because the
//                            probe already shipped the false zero once
//   PARTIAL                  fixture-only; no live PARTIAL in five probe passes
//   the size probe           once per scan, on page 0, and then it sticks
//   MAX_PAGES                throws rather than truncating
//   the token                never appears in a thrown message

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ the harness */

const API_URL = "https://api.test.app.wiz.io/graphql";
const AUTH_URL = "https://auth.test.app.wiz.io/oauth/token";

// Deliberately shaped so a leak is unmistakable in an assertion failure.
const CACHED_TOKEN = "CACHED-TOKEN-MUST-NOT-LEAK";
const ISSUED_TOKEN = "ISSUED-TOKEN-MUST-NOT-LEAK";
const STATIC_TOKEN = "STATIC-TOKEN-MUST-NOT-LEAK";
const CLIENT_SECRET = "CLIENT-SECRET-MUST-NOT-LEAK";

interface Reply {
  status?: number;
  body?: unknown;
  text?: string;
  throws?: string;
}

interface GqlCall {
  first: unknown;
  after: unknown;
  authorization: unknown;
}

let props: Record<string, string> = {};
let cached: string | null = null;
let cacheOps: string[] = [];
let sleeps: number[] = [];
let gqlCalls: GqlCall[] = [];
let authCalls: number = 0;
let replies: Reply[] = [];
let authReplies: Reply[] = [];

/** The reply for the nth call, repeating the last one forever. */
function replyFor(queue: Reply[], n: number): Reply {
  return queue[Math.min(n, queue.length - 1)] ?? {};
}

function respond(reply: Reply) {
  if (reply.throws) throw new Error(reply.throws);
  return {
    getResponseCode: () => reply.status ?? 200,
    getContentText: () => reply.text ?? JSON.stringify(reply.body ?? {}),
  };
}

beforeEach(() => {
  props = {
    WIZ_API_URL: API_URL,
    WIZ_AUTH_URL: AUTH_URL,
    WIZ_CLIENT_ID: "client-id",
    WIZ_CLIENT_SECRET: CLIENT_SECRET,
  };
  cached = CACHED_TOKEN;
  cacheOps = [];
  sleeps = [];
  gqlCalls = [];
  authCalls = 0;
  replies = [{ status: 200, body: okBody() }];
  authReplies = [{ status: 200, body: { access_token: ISSUED_TOKEN, expires_in: 3600 } }];

  vi.stubGlobal("PropertiesService", {
    getScriptProperties: () => ({
      getProperty: (k: string) => props[k] ?? null,
      setProperty: (k: string, v: string) => {
        props[k] = v;
      },
      deleteProperty: (k: string) => {
        delete props[k];
      },
    }),
  });
  vi.stubGlobal("CacheService", {
    getScriptCache: () => ({
      get: (k: string) => {
        cacheOps.push(`get:${k}`);
        return cached;
      },
      put: (k: string, v: string, ttl: number) => {
        cacheOps.push(`put:${k}:${ttl}`);
        cached = v;
      },
      remove: (k: string) => {
        cacheOps.push(`remove:${k}`);
        cached = null;
      },
    }),
  });
  // Recorded, never waited on. `Utilities.sleep` in the dev shims busy-waits on Date.now(),
  // which under a frozen test clock is an infinite loop rather than a slow one.
  vi.stubGlobal("Utilities", { sleep: (ms: number) => sleeps.push(ms) });
  vi.stubGlobal("UrlFetchApp", {
    fetch: (url: string, opts: Record<string, unknown>) => {
      if (url === AUTH_URL) return respond(replyFor(authReplies, authCalls++));
      const sent = JSON.parse(String(opts["payload"])) as { variables: Record<string, unknown> };
      const headers = (opts["headers"] ?? {}) as Record<string, unknown>;
      gqlCalls.push({
        first: sent.variables["first"],
        after: sent.variables["after"],
        authorization: headers["Authorization"],
      });
      return respond(replyFor(replies, gqlCalls.length - 1));
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  // A fresh module registry per test. wizClient holds no module-level mutable state, but the
  // reset is also what puts this file in vitest.config.ts's isolated `stateful` project —
  // where a file that replaces four GAS globals belongs.
  vi.resetModules();
});

function page(nodes: unknown[], over: Record<string, unknown> = {}) {
  return {
    nodes,
    totalCount: nodes.length,
    pageInfo: { hasNextPage: false, endCursor: null },
    ...over,
  };
}

function okBody(nodes: unknown[] = [{ id: "a" }], root = "sastFindings") {
  return { data: { [root]: page(nodes) } };
}

async function load() {
  return import("../src/server/wizClient");
}

/* --------------------------------------------------------------------- the token */

describe("getToken", () => {
  it("uses a static WIZ_API_TOKEN verbatim, without touching the cache or the auth URL", async () => {
    props["WIZ_API_TOKEN"] = `  ${STATIC_TOKEN}  `;
    const { getToken } = await load();
    expect(getToken()).toBe(STATIC_TOKEN);
    expect(authCalls).toBe(0);
    expect(cacheOps).toEqual([]);
  });

  it("prefers the cached OAuth token, and re-issues only when told to", async () => {
    const { getToken } = await load();
    expect(getToken()).toBe(CACHED_TOKEN);
    expect(authCalls).toBe(0);

    // forceRefresh REMOVES rather than merely skipping the read: the entry is known bad, and
    // leaving it means every other execution in the six-hour window pays its own 401 to
    // rediscover that.
    expect(getToken(true)).toBe(ISSUED_TOKEN);
    expect(authCalls).toBe(1);
    expect(cacheOps.some((op) => op.startsWith("remove:"))).toBe(true);
  });

  it("caps the cache TTL at max(60, min(expires_in - 300, 21600))", async () => {
    const ttlFor = async (expiresIn: number): Promise<number> => {
      authReplies = [{ status: 200, body: { access_token: ISSUED_TOKEN, expires_in: expiresIn } }];
      cacheOps = [];
      const { getToken } = await load();
      getToken(true);
      const put = cacheOps.find((op) => op.startsWith("put:"));
      return Number(String(put).split(":").pop());
    };
    expect(await ttlFor(3600)).toBe(3300); // the ordinary hour, five minutes early
    expect(await ttlFor(100)).toBe(60); // floor: a short token still caches
    expect(await ttlFor(86_400)).toBe(21_600); // ceiling: CacheService's own 6h maximum
  });

  it("refuses a token response with no access_token rather than caching an empty string", async () => {
    authReplies = [{ status: 200, body: { token_type: "Bearer" } }];
    const { getToken, WizQueryError } = await load();
    expect(() => getToken(true)).toThrow(WizQueryError);
    expect(() => getToken(true)).toThrow(/no access_token/);
  });
});

/* ------------------------------------------------------------------ 401 handling */

describe("a rejected token", () => {
  it("is dropped, re-issued and retried ONCE — and the retry carries the new token", async () => {
    replies = [{ status: 401, body: { errors: [{ message: "unauthorized" }] } }, { status: 200, body: okBody() }];
    const { queryPage } = await load();
    const result = queryPage("query {}", { first: 500 });

    expect(result.nodes).toEqual([{ id: "a" }]);
    expect(gqlCalls.map((c) => c.authorization)).toEqual([
      `Bearer ${CACHED_TOKEN}`,
      `Bearer ${ISSUED_TOKEN}`,
    ]);
    expect(authCalls).toBe(1);
    expect(cacheOps.some((op) => op.startsWith("remove:"))).toBe(true);
  });

  it("throws on the SECOND 401 instead of refreshing again", async () => {
    // Refreshing twice against a credential that is simply wrong is a loop, not a retry.
    replies = [{ status: 401, body: { errors: [{ message: "unauthorized" }] } }];
    const { queryPage } = await load();
    expect(() => queryPage("query {}", {})).toThrow(/HTTP 401/);
    expect(gqlCalls).toHaveLength(2);
    expect(authCalls).toBe(1);
  });

  it("does not try to refresh a STATIC token — there is nothing to exchange", async () => {
    props["WIZ_API_TOKEN"] = STATIC_TOKEN;
    replies = [{ status: 401, body: { errors: [{ message: "unauthorized" }] } }];
    const { queryPage } = await load();
    expect(() => queryPage("query {}", {})).toThrow(/WIZ_API_TOKEN was rejected/);
    expect(gqlCalls).toHaveLength(1);
    expect(authCalls).toBe(0);
  });

  it("refreshes on a 401 that arrives AFTER a 5xx, which an attempt-index guard would miss", async () => {
    // The rule is "once per POST", not "only if the first thing that happened was a 401".
    replies = [{ status: 503 }, { status: 401, body: { errors: [{ message: "expired" }] } }, { status: 200, body: okBody() }];
    const { queryPage } = await load();
    expect(queryPage("query {}", {}).nodes).toHaveLength(1);
    expect(gqlCalls.map((c) => c.authorization)).toEqual([
      `Bearer ${CACHED_TOKEN}`,
      `Bearer ${CACHED_TOKEN}`,
      `Bearer ${ISSUED_TOKEN}`,
    ]);
  });
});

/* --------------------------------------------------------------------- backoff */

describe("backoff", () => {
  it("sleeps 1000, 2000, 4000 across four attempts on 429 — and NOT an 8000 before the throw", async () => {
    // The fourth sleep in the gas original precedes the throw. Eight seconds of a six-minute
    // execution budget, spent to change nothing.
    replies = [{ status: 429 }];
    const { queryPage } = await load();
    expect(() => queryPage("query {}", {})).toThrow(/after retries \(HTTP 429\)/);
    expect(gqlCalls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("treats a 5xx the same way", async () => {
    replies = [{ status: 503 }];
    const { queryPage } = await load();
    expect(() => queryPage("query {}", {})).toThrow(/after retries \(HTTP 503\)/);
    expect(gqlCalls).toHaveLength(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("recovers without exhausting the budget when the retry succeeds", async () => {
    replies = [{ status: 500 }, { status: 200, body: okBody() }];
    const { queryPage } = await load();
    expect(queryPage("query {}", {}).nodes).toHaveLength(1);
    expect(sleeps).toEqual([1000]);
  });
});

/* ------------------------------------------------------------------- other 4xx */

describe("a 4xx", () => {
  it("throws IMMEDIATELY, carrying the GraphQL code — the filter-shape refusal must be legible", async () => {
    // Verbatim from PROBE_FINDINGS.md §4: the refusal that fetched zero SAST rows for a whole
    // pass while looking exactly like an empty register. If the code does not reach the
    // message, the next one looks the same way.
    replies = [
      {
        status: 400,
        body: {
          data: null,
          errors: [
            {
              message: "invalid type for variable: 'filterBy'",
              extensions: { code: "VALIDATION_INVALID_TYPE_VARIABLE", name: "filterBy" },
            },
          ],
        },
      },
    ];
    const { queryPage } = await load();
    let message = "";
    try {
      queryPage("query {}", {});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("HTTP 400");
    expect(message).toContain("VALIDATION_INVALID_TYPE_VARIABLE");
    expect(message).toContain("invalid type for variable");
    // One attempt. The schema does not change its mind on the fourth ask.
    expect(gqlCalls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("falls back to the raw body when the failure is not a GraphQL envelope", async () => {
    replies = [{ status: 403, text: "<html><body>Forbidden by proxy</body></html>" }];
    const { queryPage } = await load();
    expect(() => queryPage("query {}", {})).toThrow(/Forbidden by proxy/);
  });
});

/* ------------------------------------------------------- the connection, found */

describe("resolveConnection", () => {
  // The shape list is test/probeHelpers.test.js's, reused rather than re-derived: the client
  // has to refuse exactly what the probe refuses, or the false zero comes back on the path
  // that writes to the ledger instead of the path that writes to a report.
  const conn = (nodes: unknown[], totalCount: number) => ({
    nodes,
    totalCount,
    pageInfo: { hasNextPage: false },
  });

  it("finds the connection whatever the root is called", async () => {
    const { resolveConnection } = await load();
    for (const root of ["sastFindings", "vulnerabilityFindings", "secretInstances"]) {
      const got = resolveConnection({ [root]: conn([{ id: "a" }], 843) });
      expect(got.ok, `${root} not resolved`).toBe(true);
      if (got.ok) {
        expect(got.root).toBe(root);
        expect(got.conn["totalCount"]).toBe(843);
      }
    }
  });

  it("resolves a root it has never heard of, which is the whole point", async () => {
    const { resolveConnection } = await load();
    const got = resolveConnection({ iacFindings: conn([{ id: "x" }], 7) });
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.root).toBe("iacFindings");
  });

  it("REFUSES rather than returning an empty connection, for every DEFECT shape", async () => {
    const { resolveConnection } = await load();
    const shapes: (Record<string, unknown> | null | undefined)[] = [
      null,
      undefined,
      {},
      { __typename: "Query" },
      { count: 5 },
      { someOtherThing: { total: 3 } },
      // The two §10.2 calls out as mattering most: the key is THERE and the value is not a
      // connection. That is the shape the next regression takes.
      { secretInstances: null },
      { secretInstances: {} },
    ];
    for (const data of shapes) {
      const got = resolveConnection(data);
      expect(got.ok, `${JSON.stringify(data)} should not resolve`).toBe(false);
      if (!got.ok) expect(Array.isArray(got.keys)).toBe(true);
    }
  });

  it("reports the root keys it did see, so the miss is diagnosable", async () => {
    const { resolveConnection } = await load();
    const got = resolveConnection({ someOtherThing: { total: 3 } });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.keys).toEqual(["someOtherThing"]);
  });

  it("does not mistake a non-connection sibling for the connection", async () => {
    const { resolveConnection } = await load();
    const got = resolveConnection({ meta: { version: 2 }, secretInstances: conn([{ id: "a" }], 1) });
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.root).toBe("secretInstances");
  });

  it("accepts a pageInfo-only connection, and one that legitimately has zero rows", async () => {
    const { resolveConnection } = await load();
    const pageInfoOnly = resolveConnection({ someConn: { pageInfo: { hasNextPage: false } } });
    expect(pageInfoOnly.ok).toBe(true);
    const empty = resolveConnection({ secretInstances: conn([], 0) });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.conn["nodes"]).toEqual([]);
  });
});

describe("queryPage on a response with no connection", () => {
  it("throws and NAMES THE KEYS, rather than returning a page of zero rows", async () => {
    // The failure this whole guard exists for: an 843-row register that printed 0 node(s)
    // with no error beside it. Through the client, a zero has to prove it looked.
    replies = [{ status: 200, body: { data: { secretInstances: null } } }];
    const { queryPage } = await load();
    expect(() => queryPage("query {}", {})).toThrow(/root keys: \[secretInstances\]/);
  });

  it("distinguishes an errors-only envelope from a shapeless one", async () => {
    replies = [{ status: 200, body: { errors: [{ message: "field is unknown" }] } }];
    const { queryPage } = await load();
    expect(() => queryPage("query {}", {})).toThrow(/carried no data: .*field is unknown/);
  });

  it("returns a genuine empty page when the connection is really empty", async () => {
    replies = [{ status: 200, body: { data: { secretInstances: page([], { totalCount: 0 }) } } }];
    const { queryPage } = await load();
    const result = queryPage("query {}", {});
    expect(result.nodes).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.partialErrors).toEqual([]);
  });
});

/* --------------------------------------------------------------------- PARTIAL */

describe("a PARTIAL response", () => {
  it("returns the nodes AND surfaces partialErrors", async () => {
    // FIXTURE-ONLY. gas/'s captured sast_response.json is a 200 with 40 good nodes and one
    // error about a null Weakness name; brick/devsecops raises on it and would reject the
    // whole page. No live PARTIAL has been reproduced on this tenant in five probe passes
    // (PROBE_FINDINGS.md §7) — this path is here so the first one does not lose 40 rows.
    replies = [
      {
        status: 200,
        body: {
          data: { sastFindings: page([{ id: "a" }, { id: "b" }], { totalCount: 11_406 }) },
          errors: [{ message: "Cannot return null for non-nullable field Weakness.name" }],
        },
      },
    ];
    const { queryPage } = await load();
    const result = queryPage("query {}", {});
    expect(result.nodes).toHaveLength(2);
    expect(result.totalCount).toBe(11_406);
    expect(result.partialErrors).toEqual([
      "Cannot return null for non-nullable field Weakness.name",
    ]);
  });

  it("leaves partialErrors empty on a healthy page", async () => {
    const { queryPage } = await load();
    expect(queryPage("query {}", {}).partialErrors).toEqual([]);
  });
});

/* ------------------------------------------------------------ the size fallback */

describe("smallerPageCouldHelp", () => {
  it("refuses the failures a smaller page cannot fix", async () => {
    const { smallerPageCouldHelp, WizQueryError } = await load();
    const no = [
      "Wiz query failed after retries (HTTP 429).",
      "Wiz query failed (HTTP 400): VALIDATION_INVALID_TYPE_VARIABLE: invalid type for variable",
      "Wiz response carried no data: failed to parse object type",
      "Wiz response carried no connection; root keys: [secretInstances].",
    ];
    for (const m of no) expect(smallerPageCouldHelp(new WizQueryError(m)), m).toBe(false);
  });

  it("allows a gateway 5xx, a transport error, and the tenant's 200-clothed internal error", async () => {
    const { smallerPageCouldHelp, WizQueryError } = await load();
    expect(smallerPageCouldHelp(new WizQueryError("Wiz query failed after retries (HTTP 504)."))).toBe(true);
    expect(smallerPageCouldHelp(new Error("Address unavailable"))).toBe(true);
    expect(smallerPageCouldHelp(new SyntaxError("Unexpected end of JSON input"))).toBe(true);
    expect(
      smallerPageCouldHelp(
        new WizQueryError(
          "Wiz response carried no data: oops! an internal error has occurred. for reference " +
            "purposes, this is your request id: 57047012-a695-4a7f-a6c3-3c7d8ebec259",
        ),
      ),
    ).toBe(true);
  });
});

describe("fetchPage", () => {
  it("probes PAGE_SIZE on page 0, falls back once, and the decision STICKS for the scan", async () => {
    const { fetchPage, newScanPaging, PAGE_SIZE, PAGE_SIZE_FALLBACK } = await load();
    const paging = newScanPaging();

    // Page 0: a transport failure at 500, served at 250.
    replies = [{ throws: "Timeout" }, { status: 200, body: okBody() }];
    expect(fetchPage("sast", { after: null }, paging).nodes).toHaveLength(1);
    expect(gqlCalls.map((c) => c.first)).toEqual([PAGE_SIZE, PAGE_SIZE_FALLBACK]);
    expect(paging.pageSize).toBe(PAGE_SIZE_FALLBACK);
    expect(paging.pageNumber).toBe(1);

    // Page 1 asks for 250 straight away — no second probe, and the cursor rides through.
    gqlCalls = [];
    replies = [{ status: 200, body: okBody() }];
    fetchPage("sast", { after: "cursor-1" }, paging);
    expect(gqlCalls).toHaveLength(1);
    expect(gqlCalls[0]!.first).toBe(PAGE_SIZE_FALLBACK);
    expect(gqlCalls[0]!.after).toBe("cursor-1");
    expect(paging.pageNumber).toBe(2);
  });

  it("does NOT probe on a later page — a size that served page 0 is not the problem on page 40", async () => {
    const { fetchPage, PAGE_SIZE } = await load();
    replies = [{ throws: "Timeout" }];
    const paging = { pageSize: PAGE_SIZE, pageNumber: 40 };
    expect(() => fetchPage("sast", {}, paging)).toThrow(/Timeout/);
    expect(gqlCalls).toHaveLength(1);
    expect(paging.pageSize).toBe(PAGE_SIZE);
    expect(paging.pageNumber).toBe(40);
  });

  it("does NOT re-walk a rate-limited page, nor a 4xx, nor a shapeless response", async () => {
    const { fetchPage, newScanPaging } = await load();

    replies = [{ status: 429 }];
    expect(() => fetchPage("sast", {}, newScanPaging())).toThrow(/429/);
    expect(gqlCalls).toHaveLength(4); // the four inside queryPage, and nothing more

    gqlCalls = [];
    replies = [{ status: 400, body: { errors: [{ message: "bad field" }] } }];
    expect(() => fetchPage("sast", {}, newScanPaging())).toThrow(/HTTP 400/);
    expect(gqlCalls).toHaveLength(1);

    gqlCalls = [];
    replies = [{ status: 200, body: { data: { secretInstances: null } } }];
    expect(() => fetchPage("secrets", {}, newScanPaging())).toThrow(/root keys/);
    expect(gqlCalls).toHaveLength(1);
  });

  it("never retries UP, and never re-asks at a size it is already at", async () => {
    const { fetchPage, PAGE_SIZE_FALLBACK } = await load();
    replies = [{ throws: "Timeout" }];
    const paging = { pageSize: PAGE_SIZE_FALLBACK, pageNumber: 0 };
    expect(() => fetchPage("sca", {}, paging)).toThrow(/Timeout/);
    expect(gqlCalls).toHaveLength(1);
    expect(gqlCalls[0]!.first).toBe(PAGE_SIZE_FALLBACK);
  });

  it("throws at MAX_PAGES rather than truncating the register in silence", async () => {
    // A walk stopped quietly at a thousand pages hands the ledger a partial register that
    // looks complete — the same class of lie as a zero that did not look.
    const { fetchPage, MAX_PAGES, PAGE_SIZE } = await load();
    const paging = { pageSize: PAGE_SIZE, pageNumber: MAX_PAGES };
    expect(() => fetchPage("sca", {}, paging)).toThrow(/MAX_PAGES \(1000\)/);
    expect(gqlCalls).toHaveLength(0); // refused before it spent a call
  });

  it("refuses a scope with no query document rather than sending an empty one", async () => {
    const { fetchPage } = await load();
    expect(() =>
      fetchPage("iac" as never, {}),
    ).toThrow(/no query document for scope "iac"/);
    expect(gqlCalls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ the secrets */

describe("no thrown message carries a credential", () => {
  it("redacts a bearer token a gateway echoed back at us", async () => {
    props["WIZ_API_TOKEN"] = STATIC_TOKEN;
    replies = [
      {
        status: 400,
        body: {
          errors: [{ message: `rejected credential Bearer ${STATIC_TOKEN} for this tenant` }],
        },
      },
    ];
    const { queryPage } = await load();
    let message = "";
    try {
      queryPage("query {}", {});
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain(STATIC_TOKEN);
    expect(message).toContain("<redacted>");
  });

  it("redacts client_secret and access_token from a failed auth exchange", async () => {
    // The auth POST sends client_secret in its payload. A proxy that echoes the request back
    // inside its error body puts that secret one throw away from a job row and a log line.
    authReplies = [
      {
        status: 401,
        text: JSON.stringify({
          error: "invalid_client",
          client_secret: CLIENT_SECRET,
          access_token: ISSUED_TOKEN,
        }),
      },
    ];
    const { getToken } = await load();
    let message = "";
    try {
      getToken(true);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("Wiz token request failed (401)");
    expect(message).not.toContain(CLIENT_SECRET);
    expect(message).not.toContain(ISSUED_TOKEN);
  });

  it("keeps the token out of a PARTIAL page's errors too", async () => {
    replies = [
      {
        status: 200,
        body: {
          data: { sastFindings: page([{ id: "a" }]) },
          errors: [{ message: `downstream refused Bearer ${CACHED_TOKEN}` }],
        },
      },
    ];
    const { queryPage } = await load();
    const result = queryPage("query {}", {});
    expect(result.partialErrors.join(" ")).not.toContain(CACHED_TOKEN);
  });
});
