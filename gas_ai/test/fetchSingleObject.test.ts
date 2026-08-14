// fetchSingleObject, and the silent failure it exists to prevent.
//
// Every other Wiz root this app reads is a connection, so every reader goes through
// `fetchPage` → `readConnection`. `securityFramework(id:)` returns ONE OBJECT, and reusing
// the connection reader on it does not throw: it finds no `nodes` and returns `rows: []`.
//
// That matters because every posture step is `optional: true` — one framework a tenant
// lacks must not fail the whole battery. An optional step that "succeeds" with zero rows
// is recorded as a success, so the failure would be invisible: no error, no skip recorded,
// an empty Compliance page, and a Wiz Scans area reporting `partial` for a reason nobody
// could find. So a missing object has to be an ERROR, stated as one.

import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_FETCH = globalThis.UrlFetchApp;

/** Minimal GAS fakes: just enough for gqlPost to run one request. */
function stubWiz(response: unknown, status = 200): void {
  (globalThis as Record<string, unknown>).PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k: string) =>
        ({ WIZ_API_URL: "https://api.test/graphql", WIZ_AUTH_URL: "https://auth.test/oauth/token",
          WIZ_CLIENT_ID: "id", WIZ_CLIENT_SECRET: "secret" } as Record<string, string>)[k] ?? null,
      setProperty: () => undefined,
      deleteProperty: () => undefined,
    }),
  };
  (globalThis as Record<string, unknown>).CacheService = {
    getScriptCache: () => ({ get: () => "test-token", put: () => undefined }),
  };
  (globalThis as Record<string, unknown>).Utilities = {
    sleep: () => undefined,
    base64Encode: (s: string) => Buffer.from(String(s)).toString("base64"),
  };
  (globalThis as Record<string, unknown>).UrlFetchApp = {
    fetch: () => ({
      getResponseCode: () => status,
      getContentText: () => JSON.stringify(response),
    }),
  };
}

afterEach(() => {
  (globalThis as Record<string, unknown>).UrlFetchApp = ORIGINAL_FETCH;
  vi.resetModules();
});

describe("fetchSingleObject", () => {
  it("returns the object as a one-row page so every step shares one shape", async () => {
    stubWiz({ data: { securityFramework: { id: "wf-id-275", name: "OWASP Agentic" } } });
    const { fetchSingleObject } = await import("../src/server/wizClientAi");
    const page = fetchSingleObject("securityFramework", { query: "query {}" });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]["id"]).toBe("wf-id-275");
    // Never paginates: there is no next page of a single object, and claiming otherwise
    // would send the battery round a loop.
    expect(page.hasNextPage).toBe(false);
    expect(page.endCursor).toBeNull();
  });

  it("THROWS on a missing object rather than reporting an empty success", async () => {
    // The trap. readConnection would return rows: [] here and the optional step would be
    // recorded as a clean run against a tenant that has nothing — permanently invisible.
    stubWiz({ data: { securityFramework: null } });
    const { fetchSingleObject } = await import("../src/server/wizClientAi");
    expect(() => fetchSingleObject("securityFramework", { query: "query {}" }))
      .toThrow(/securityFramework/);
  });

  it("throws when the field is absent from the response entirely", async () => {
    stubWiz({ data: {} });
    const { fetchSingleObject } = await import("../src/server/wizClientAi");
    expect(() => fetchSingleObject("securityFramework", { query: "query {}" })).toThrow();
  });

  it("sends no paging variables — this operation declares none", async () => {
    const sent: unknown[] = [];
    stubWiz({ data: { securityFramework: { id: "wf-id-275" } } });
    (globalThis as Record<string, unknown>).UrlFetchApp = {
      fetch: (_url: string, opts: { payload: string }) => {
        sent.push(JSON.parse(opts.payload));
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ data: { securityFramework: { id: "x" } } }),
        };
      },
    };
    const { fetchSingleObject } = await import("../src/server/wizClientAi");
    fetchSingleObject("securityFramework", {
      query: "query {}",
      extraVariables: { id: "wf-id-275" },
    });
    const vars = (sent[0] as { variables: Record<string, unknown> }).variables;
    expect(vars["id"]).toBe("wf-id-275");
    // A strict server rejects undeclared variables, and fetchPage injects both of these
    // unconditionally — which is the other half of why this reader is separate.
    expect(vars).not.toHaveProperty("first");
    expect(vars).not.toHaveProperty("after");
  });
});
