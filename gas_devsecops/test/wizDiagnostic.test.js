// The editor-run connectivity diagnostic.
//
// It exists because three completely different failures look identical from the app — the
// Settings row says "Refused" for all of them — and they have three different remedies: fix
// the client secret, fix WIZ_API_URL, or re-authorize the deployment. Sending an operator to
// the wrong one costs a redeploy.
//
// Its second job cannot be tested here at all, and is the reason it is a separate function
// from `deploymentDiagnostic()`: running it from the Apps Script editor is what puts the
// consent screen in front of the operator, because Apps Script asks for a scope when code
// needing it actually runs. A diagnostic that only reads Script Properties authorizes nothing.

import { beforeEach, describe, expect, it, vi } from "vitest";

const props = vi.hoisted(() => ({}));
const http = vi.hoisted(() => ({ replies: [], throwWith: null }));
// A cache that actually caches. With a stub that always missed, step 2's fetchPage re-ran the
// token exchange and ate the page reply — so the diagnostic silently reported step 2 as a
// failure. That is a fixture bug, but it models the production behaviour that matters:
// getToken caches, so one wizDiagnostic run is ONE exchange plus one query, not two of each.
const cache = vi.hoisted(() => ({ store: {} }));

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
    put: (k, v) => { cache.store[k] = v; },
    remove: (k) => { delete cache.store[k]; },
  }),
});
vi.stubGlobal("Utilities", { sleep: () => {} });
vi.stubGlobal("UrlFetchApp", {
  fetch: (url) => {
    if (http.throwWith) throw new Error(http.throwWith);
    const reply = http.replies.shift();
    if (!reply) throw new Error(`no stubbed reply for ${url}`);
    return {
      getResponseCode: () => reply.code,
      getContentText: () => JSON.stringify(reply.body),
    };
  },
});

// The ledger half of diagnostics.ts drags in Sheets and Drive on import; none of it is on the
// path under test.
vi.mock("../src/server/sheetsDb", () => ({
  TABS: { scans: "scans", settings: "settings", ledger: "finding_ledger", jobs: "jobs" },
  TAB_HEADERS: {}, SCHEMA_VERSION: 1,
  readAll: () => [], readTail: () => [], overwrite: () => {}, appendRows: () => {},
  updateWhere: () => false, dataRowCount: () => 0, ensureTabs: () => {},
  cellCount: () => 0, ledgerSpreadsheet: () => ({ getName: () => "x" }),
  __resetMemosForTest: () => {},
}));

const TOKEN_OK = { code: 200, body: { access_token: "tok-abcdef", expires_in: 3600 } };
const PAGE_OK = {
  code: 200,
  body: {
    data: {
      sastFindings: { nodes: [{ id: "a" }], totalCount: 127, pageInfo: { hasNextPage: false } },
    },
  },
};

const load = () => import("../src/server/diagnostics");

beforeEach(() => {
  for (const k of Object.keys(props)) delete props[k];
  http.replies.length = 0;
  http.throwWith = null;
  cache.store = {};
  props.WIZ_API_URL = "https://api.test.app.wiz.io/graphql";
  props.WIZ_CLIENT_ID = "client-id-value";
  props.WIZ_CLIENT_SECRET = "client-secret-value";
  vi.resetModules();
});

describe("it names which step failed", () => {
  it("reports both steps passing, and records the verification", async () => {
    const { wizDiagnostic } = await load();
    http.replies.push(TOKEN_OK, PAGE_OK);
    const out = wizDiagnostic();
    expect(out).toContain("Step 1 OK");
    expect(out).toContain("Step 2 OK");
    expect(out).toContain("127 finding(s)");
    // One exchange, not two: step 2 reuses the token step 1 minted.
    expect(http.replies).toHaveLength(0);
    // The same stamp the Settings row reads, so a green editor run and a green Settings row
    // cannot disagree about whether this deployment has ever reached the tenant.
    expect(props.WIZ_VERIFIED_AT).toBeTruthy();
  });

  it("blames the TOKEN when the credentials are refused", async () => {
    const { wizDiagnostic } = await load();
    http.replies.push({ code: 401, body: { error: "invalid_client" } });
    const out = wizDiagnostic();
    expect(out).toContain("Step 1 FAIL");
    expect(out).not.toContain("Step 2");
    expect(out).toMatch(/WIZ_CLIENT_SECRET/);
    expect(props.WIZ_VERIFIED_AT).toBeUndefined();
  });

  it("blames the QUERY when the token was accepted and the query was not", async () => {
    // The distinction that saves a redeploy: the secret is fine, the URL or the service
    // account's reach is not.
    const { wizDiagnostic } = await load();
    http.replies.push(TOKEN_OK, { code: 404, body: { m: "no such path" } });
    const out = wizDiagnostic();
    expect(out).toContain("Step 1 OK");
    expect(out).toContain("Step 2 FAIL");
    expect(out).toMatch(/WIZ_API_URL/);
    expect(props.WIZ_VERIFIED_AT).toBeUndefined();
  });

  it("sends an authorization refusal to the DEPLOYMENT, not to the credentials", async () => {
    // The failure that prompted all of this, in the locale it arrived in. Answering "check
    // your client secret" here would send the operator to the one place that is fine.
    http.throwWith = "Vous n'êtes pas autorisé à appeler UrlFetchApp.fetch. Autorisations "
      + "requises : https://www.googleapis.com/auth/script.external_request";
    const { wizDiagnostic } = await load();
    const out = wizDiagnostic();
    expect(out).toContain("Step 1 FAIL");
    expect(out).toMatch(/NOT the credentials/);
    expect(out).toMatch(/NEW VERSION/);
    expect(out).not.toMatch(/Check WIZ_CLIENT_ID/);
  });

  it("stops before touching the network when there is nothing to test", async () => {
    delete props.WIZ_CLIENT_ID;
    delete props.WIZ_CLIENT_SECRET;
    const { wizDiagnostic } = await load();
    const out = wizDiagnostic();
    expect(out).toContain("STOP");
    expect(out).not.toContain("Step 1");
  });
});

describe("what it prints about the secrets", () => {
  it("shows enough to recognise them and not enough to use them", async () => {
    const { wizDiagnostic } = await load();
    http.replies.push(TOKEN_OK, PAGE_OK);
    const out = wizDiagnostic();
    expect(out).not.toContain("client-secret-value");
    expect(out).toContain("clie…ue");     // first four, last two, and the length
    expect(out).toContain("(19 chars)");
  });

  it("says (unset) rather than printing nothing for a missing one", async () => {
    // An empty value beside a label reads as "this is fine"; the diagnostic exists for the
    // reader who cannot tell which of six properties is the wrong one.
    const { wizDiagnostic } = await load();
    http.replies.push(TOKEN_OK, PAGE_OK);
    expect(wizDiagnostic()).toContain("Static token: (unset)");
  });
});
