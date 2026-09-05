// The transport: one GraphQL POST to Wiz over UrlFetchApp, and one page out of it.
//
// PORTED FROM gas/src/server/wizClient.ts, with three deliberate differences, each of which
// exists because this register learned something the OS-vulns one did not:
//
//   1. THE CONNECTION ROOT IS FOUND, NOT NAMED. gas reads `data.vulnerabilityFindings` off a
//      hardcoded key. Three scopes read three roots here, and the probe already shipped the
//      bug that costs: a chain that never learned `secretInstances` printed `0 node(s)` for
//      an 843-row register and wrote `{count: 0}` beside no error at all. `resolveConnection`
//      below is the probe's function, ported verbatim in behaviour — it REFUSES, naming the
//      keys it did see, rather than handing back an empty connection. A zero has to prove it
//      looked.
//   2. PARTIAL IS NOT FAILURE. brick/devsecops raises on any `errors`, which would reject the
//      captured sast_response.json wholesale — a 200 carrying 40 good nodes and one error
//      about a null Weakness name. Data and errors ride out together as `partialErrors`, and
//      the caller decides. No live PARTIAL has been reproduced on this tenant in five probe
//      passes (PROBE_FINDINGS.md §7), so this path is fixture-only and stays that way.
//   3. THE PAGE-SIZE DECISION IS MADE ONCE PER SCAN. gas re-probes 500 on every page, paying
//      a doubled call for every page of a walk that already knows 500 is too big. `ScanPaging`
//      carries the answer, and is a plain JSON object so a resumed job can persist it.
//
// NO TOKEN EVER REACHES A THROWN MESSAGE OR A LOG LINE. Every body that goes into an error
// runs through `errorDigest`, which redacts the auth vocabulary before it slices — a gateway
// that echoes the request back in its error body is a real way for `client_secret` to end up
// in a Stackdriver log.

import type { Scope } from "../domain/config";
import type { Rec } from "../domain/util";
import { DEFAULT_WIZ_AUTH_URL, getProp, PROP_KEYS, requireProp } from "./props";
import { MAX_PAGES, PAGE_SIZE, PAGE_SIZE_FALLBACK, QUERIES } from "./wizQueries";

/** Raised by the transport and the response readers, and by nothing else. */
export class WizQueryError extends Error {}

/**
 * Raised when APPS SCRIPT ITSELF refuses the outbound call — the deployment's authorization,
 * never the Wiz credentials. Ported from an earlier revision of this file: a live report
 * arrived as "not authorized to call UrlFetchApp.fetch — required permissions
 * .../script.external_request" with no consent prompt anywhere, in the editor or the web app,
 * on a project that had never before called `UrlFetchApp`. Its own class so a caller (the
 * Settings "Test connection" affordance, `wizDiagnostic()`) can answer with the sequence that
 * fixes it instead of the generic "Refused" a `WizQueryError` would print.
 */
export class WizNotAuthorizedError extends Error {}

/**
 * The scope Apps Script names when the project may not reach the network.
 *
 * MATCHED ON THE URL, NEVER ON THE MESSAGE TEXT, and that is the whole point of this
 * constant. The platform localises the sentence — the report that prompted this arrived as
 * "Vous n'êtes pas autorisé à appeler UrlFetchApp.fetch" — so an English match would pass
 * every test here and fail for the operator who hit it. The scope URL is the one token in the
 * message that is the same in every locale.
 */
const EXTERNAL_REQUEST_SCOPE = "script.external_request";

/**
 * Re-raise a platform authorization refusal with the sequence that fixes it.
 *
 * The remedy is specific and not guessable from the platform's message: what makes Apps
 * Script ask for consent is the MANIFEST declaring the scope (`dist/appsscript.json`,
 * `test/manifestScopes.test.js`), and even then only a NEW deployment version serves it —
 * pushing code does not change what an existing web-app URL runs.
 */
function guardAuthorization<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    if (message.indexOf(EXTERNAL_REQUEST_SCOPE) < 0) throw e;
    throw new WizNotAuthorizedError(
      "This deployment is not authorized to make outbound requests, so it cannot reach Wiz. "
      + "The credentials are not the problem. Push the current build first — its "
      + "appsscript.json declares script.external_request, and a manifest change is what "
      + "makes Apps Script ask for consent. Then: (1) run wizDiagnostic() in the editor and "
      + "ACCEPT the prompt; (2) Deploy > Manage deployments > Edit > New version, because "
      + "pushing code does not change what the web app URL serves; (3) check the daily scan "
      + "trigger still fires, since a scope change can suspend an installable trigger "
      + "silently.",
    );
  }
}

/* ------------------------------------------------------------------------ auth */

// Namespaced per project. gas uses `wiz_token` and gas_ai `wiz_ai_token`; these are separate
// Apps Script projects with separate caches, so the distinct name buys legibility rather
// than isolation — but it costs nothing and a shared name would be a trap if that changed.
const TOKEN_CACHE_KEY = "wiz_devsecops_token";

/**
 * The configured static bearer token, or null.
 *
 * TRIMMED-AND-CHECKED IN ONE PLACE, because two call sites read it for two different
 * questions and they must not disagree: `getToken` asks "is there a token to use", the 401
 * handler asks "is there anything to refresh". A `WIZ_API_TOKEN` set to whitespace would
 * otherwise send getToken down the OAuth path while telling the 401 handler it was in token
 * mode — the refresh would be skipped and the retry lost, on a deployment whose property is
 * merely untidy.
 */
function staticToken(): string | null {
  const raw = getProp(PROP_KEYS.wizApiToken);
  return raw && raw.trim() ? raw.trim() : null;
}

/**
 * Drop the cached OAuth token, if any.
 *
 * Exported so a caller that needs a REAL exchange — the Settings "Test connection" affordance
 * (`testConnection` below) and the editor's `wizDiagnostic()` — can force one without
 * duplicating this module's cache key. A cached token outlives a revoked client secret by up
 * to six hours, which is exactly the false reassurance those two callers exist to avoid.
 */
export function forgetToken(): void {
  try {
    CacheService.getScriptCache().remove(TOKEN_CACHE_KEY);
  } catch {
    /* eviction is best-effort; a subsequent getToken(true) replaces the entry either way */
  }
}

/**
 * A bearer token: the static one verbatim, or an OAuth client-credentials exchange cached
 * in CacheService.
 *
 * `forceRefresh` REMOVES the cached entry before re-issuing rather than merely skipping the
 * read. The 401 path is the only caller, and it is there because the cached token was
 * rejected: leaving it in place means every other execution in the same six-hour window
 * keeps picking up the dead token and paying its own 401 to discover that.
 */
export function getToken(forceRefresh = false): string {
  // A raw service-account token is used verbatim — no OAuth exchange, nothing to cache or
  // refresh (forceRefresh is a no-op here; a rejected token is reported by queryPage).
  const token = staticToken();
  if (token) return token;

  const cache = CacheService.getScriptCache();
  if (forceRefresh) {
    forgetToken();
  } else {
    const cached = cache.get(TOKEN_CACHE_KEY);
    if (cached) return cached;
  }

  const authUrl = getProp(PROP_KEYS.wizAuthUrl) ?? DEFAULT_WIZ_AUTH_URL;
  const response = guardAuthorization(() => UrlFetchApp.fetch(authUrl, {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "client_credentials",
      audience: "wiz-api",
      client_id: requireProp(PROP_KEYS.wizClientId),
      client_secret: requireProp(PROP_KEYS.wizClientSecret),
    },
    muteHttpExceptions: true,
  }));
  if (response.getResponseCode() !== 200) {
    throw new WizQueryError(
      `Wiz token request failed (${response.getResponseCode()}): ` +
        errorDigest(response.getContentText()),
    );
  }
  const body = JSON.parse(response.getContentText()) as Rec;
  const issued = body["access_token"];
  if (typeof issued !== "string" || !issued) {
    throw new WizQueryError("Wiz token response carried no access_token.");
  }
  // Expire five minutes early so a token is never used inside the window where the tenant
  // may already consider it dead; floor at 60s so a short-lived token still caches, ceiling
  // at CacheService's own 6h maximum.
  const expiresIn = Number(body["expires_in"] ?? 3600);
  const ttl = Math.max(60, Math.min(Math.trunc(expiresIn) - 300, 21_600));
  cache.put(TOKEN_CACHE_KEY, issued, ttl);
  return issued;
}

/* -------------------------------------------------------------- error rendering */

/** How much of a failed response body a thrown message carries. */
const ERROR_BODY_MAX = 800;

/**
 * The auth vocabulary, masked wherever it appears in a body we are about to put in an error.
 *
 * NOT PARANOIA — the auth POST above sends `client_secret` in its payload, and a gateway or
 * proxy that echoes the request back inside its error body puts that secret one `throw` away
 * from a Stackdriver log and a job row. The token itself rides in an `Authorization` header
 * for the same reason. Neither has ever been observed coming back; the cost of the guard is
 * one regex on a path that is already failing.
 */
function redact(text: string): string {
  return String(text)
    .replace(
      /(access_token|refresh_token|id_token|client_secret)("|')?\s*[:=]\s*("|')?[^"',}\s&]+("|')?/gi,
      "$1=<redacted>",
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "Bearer <redacted>");
}

/**
 * A GraphQL error body reduced to the part an operator can act on — CODE FIRST.
 *
 * The code is the half that names the defect. The register's most expensive bug to date
 * presents as
 *
 *   {"errors":[{"message":"invalid type for variable: 'filterBy'",
 *               "extensions":{"code":"VALIDATION_INVALID_TYPE_VARIABLE","name":"filterBy"}}]}
 *
 * and the message alone ("invalid type for variable") does not say which of the two filter
 * conventions was applied to the wrong scope — while the code is the exact string CLAUDE.md
 * and PROBE_FINDINGS.md §4 both index that failure under. gas_ai's errorDigest joins only
 * the messages; this one prefixes the code, because a shape mismatch that reaches a screen
 * without its code reads as "the register is empty".
 *
 * Falls back to the raw text for anything that is not a GraphQL error envelope — an HTML
 * error page from a proxy, say — because then the raw text IS the diagnosis. Never throws:
 * this only ever runs on a path that is already failing.
 */
export function errorDigest(text: string): string {
  try {
    const parsed = JSON.parse(text) as Rec;
    const errors = parsed["errors"];
    if (Array.isArray(errors) && errors.length) {
      const parts = (errors as unknown[])
        .map((e) => {
          if (!e || typeof e !== "object") return "";
          const rec = e as Rec;
          const ext = rec["extensions"];
          const code =
            ext && typeof ext === "object" ? String((ext as Rec)["code"] ?? "") : "";
          const message = String(rec["message"] ?? "");
          if (code && message) return `${code}: ${message}`;
          return code || message;
        })
        .filter(Boolean);
      if (parts.length) return redact(parts.join(" | ")).slice(0, ERROR_BODY_MAX);
    }
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return redact(String(text)).slice(0, ERROR_BODY_MAX);
}

/** The `errors` array as plain messages, for the PARTIAL path. */
function errorMessages(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  return (errors as unknown[])
    .map((e) => (e && typeof e === "object" ? String((e as Rec)["message"] ?? "") : String(e)))
    .filter(Boolean)
    .map((m) => redact(m));
}

/* ------------------------------------------------------------ the connection root */

export type ConnectionLookup =
  | { ok: true; root: string; conn: Rec }
  | { ok: false; keys: string[] };

/**
 * The connection out of a GraphQL response, FOUND rather than guessed.
 *
 * Ported from probeHelpers.mjs, whose comment is the history: a hardcoded root chain
 * (`data.sastFindings ?? data.vulnerabilityFindings ?? {}`) never learned `secretInstances`,
 * so an 843-row register fell through to `{}` and reported a count of zero. Not an error — a
 * COUNT, which is exactly what a legitimately empty register looks like.
 *
 * That is a harder failure to catch than a refusal, and the distinction is why this exists:
 * a refusal announces itself, a false zero does not. A GraphQL response carries one root key
 * per document, so read it. A fourth scope cannot reintroduce the bug by being forgotten,
 * because there is no list to keep in step.
 *
 * A connection is what carries `nodes` or `pageInfo`. Falling back to the first key
 * regardless is how a guess becomes a zero — see the `meta` sibling in the tests.
 */
export function resolveConnection(data: Rec | null | undefined): ConnectionLookup {
  const source = data ?? {};
  const keys = Object.keys(source);
  const root = keys.find((k) => {
    const v = source[k];
    return v !== null && typeof v === "object" && ("nodes" in v || "pageInfo" in v);
  });
  if (root === undefined) return { ok: false, keys };
  return { ok: true, root, conn: source[root] as Rec };
}

/* -------------------------------------------------------------------- one page */

/**
 * One page of one scope's connection. S4's scan walk consumes this.
 *
 * `partialErrors` is empty on every healthy page and is NOT an error channel — a page that
 * carries both nodes and errors is a page whose nodes are good and whose count is suspect,
 * and the scan records the caveat beside the rows rather than discarding either.
 */
export interface WizPage {
  nodes: Rec[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  totalCount: number | null;
  partialErrors: string[];
}

/** Attempts per POST, the 401 refresh included. */
const MAX_ATTEMPTS = 4;

/**
 * One GraphQL POST, with backoff on 429/5xx and ONE token refresh on 401.
 *
 * THE LAST ATTEMPT DOES NOT SLEEP, and that is a departure from the gas original. There, the
 * fourth 429 sleeps eight seconds and then throws — eight seconds of a six-minute execution
 * budget bought with nothing. The sequence here is [1000, 2000, 4000] across four POSTs, and
 * `test/wizClient.test.ts` pins it.
 *
 * The 401 refresh is guarded by a flag rather than by `attempt === 0`. A 500 followed by a
 * 401 is a real sequence, and the attempt-index guard would refuse to refresh on it — the
 * rule is "refresh once per POST", not "refresh only if the first thing that happened was a
 * 401". A second 401 throws, with a hint that names which credential to look at.
 */
export function queryPage(query: string, variables: Rec): WizPage {
  const apiUrl = requireProp(PROP_KEYS.wizApiUrl);
  let token = getToken();
  let refreshed = false;
  let lastError = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = guardAuthorization(() => UrlFetchApp.fetch(apiUrl, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${token}` },
      payload: JSON.stringify({ query, variables }),
      muteHttpExceptions: true,
    }));
    const code = response.getResponseCode();

    // A static WIZ_API_TOKEN cannot be refreshed, so only retry-with-refresh in OAuth mode.
    if (code === 401 && !refreshed && !staticToken()) {
      refreshed = true;
      token = getToken(true);
      continue;
    }

    if (code === 429 || code >= 500) {
      lastError = `HTTP ${code}`;
      // No sleep before the throw: the wait only pays off if another attempt follows it.
      if (attempt + 1 < MAX_ATTEMPTS) Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }

    if (code !== 200) {
      const hint =
        code !== 401
          ? ""
          : staticToken()
            ? " — WIZ_API_TOKEN was rejected; it may have expired. Refresh it, or set " +
              "WIZ_CLIENT_ID/WIZ_CLIENT_SECRET for auto-refresh."
            : " — a freshly issued OAuth token was rejected; check WIZ_CLIENT_ID / " +
              "WIZ_CLIENT_SECRET and the API scopes granted to that service account.";
      // Thrown IMMEDIATELY, and carrying the GraphQL code. A 400 is the schema saying no,
      // and it says no just as firmly on the fourth ask as on the first.
      throw new WizQueryError(
        `Wiz query failed (HTTP ${code})${hint}: ${errorDigest(response.getContentText())}`,
      );
    }

    const text = response.getContentText();
    const body = JSON.parse(text) as Rec;
    const data = body["data"] as Rec | null | undefined;
    if (!data) {
      // HTTP 200 with an errors-only envelope. Two very different things arrive this way —
      // a verdict about the document, and the tenant's generic internal error — and
      // `smallerPageCouldHelp` is where they are told apart.
      throw new WizQueryError(`Wiz response carried no data: ${errorDigest(text)}`);
    }

    const found = resolveConnection(data);
    if (!found.ok) {
      // NOT a page of zero rows. A response that parsed but carries no connection is a
      // defect in this client or in the document, and reporting it as "0 nodes" would be a
      // confident lie about the register — which is precisely what the hardcoded root chain
      // in the probe did for a whole pass.
      throw new WizQueryError(
        `Wiz response carried no connection; root keys: [${found.keys.join(", ")}]. ` +
          "A response that parses but carries no nodes/pageInfo is a defect, not an " +
          "empty register.",
      );
    }

    const conn = found.conn;
    const pageInfo = (conn["pageInfo"] as Rec) ?? {};
    const rawTotal = conn["totalCount"];
    return {
      nodes: (conn["nodes"] as Rec[]) ?? [],
      pageInfo: {
        hasNextPage: Boolean(pageInfo["hasNextPage"]),
        endCursor: (pageInfo["endCursor"] as string | null) ?? null,
      },
      totalCount: typeof rawTotal === "number" ? rawTotal : null,
      // PARTIAL: data AND errors. The nodes are returned; the errors travel with them.
      partialErrors: errorMessages(body["errors"]),
    };
  }

  throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
}

/* ------------------------------------------------------------- the size fallback */

/**
 * Whether re-asking at a smaller page size could plausibly change the answer.
 *
 * PORTED FROM gas_ai, WHERE IT WAS MEASURED, AND NOT RE-MEASURED HERE. This tenant has never
 * been observed refusing a 500-row page: the probe's own secrets crosstab walks at
 * `first: 500` and PROBE_FINDINGS.md §9.5 records 500 + 343 = 843 rows across two such pages.
 * So the classification below is inherited evidence about the Wiz gateway, not a measurement
 * of this register — say so rather than implying a probe found it.
 *
 * The rule the classification encodes: "anything that is not a 4xx" was the old answer, and
 * it retried three failures a smaller page cannot fix, each retry costing up to four more
 * POSTs on top of the four already burned.
 *
 *   429 after retries              the tenant is throttling us; asking again for less of the
 *                                  same thing spends four more POSTs into the same throttle
 *   4xx                            the schema said no, and it does not become yes at 250 rows
 *   carried no data                a verdict about the DOCUMENT — a rejected enum, an
 *                                  unknown field, `VALIDATION_INVALID_TYPE_VARIABLE`
 *   carried no connection          a shape mismatch; same reasoning
 *
 * What IS worth a smaller retry: a gateway 5xx (a 504 on a page too heavy to assemble in
 * time is the failure the fallback exists for), anything that is not a WizQueryError at all
 * (a UrlFetchApp transport error, a timeout, a parse failure on a truncated body), and one
 * special case — Wiz returns its generic internal error as HTTP 200 with no data, which is a
 * 504 wearing a 200's clothes and gets a 504's retry. gas_ai found that one two hours and
 * 84,912 rows into a sync, where the fallback built for exactly that case declined to fire.
 */
export function smallerPageCouldHelp(e: unknown): boolean {
  if (!(e instanceof WizQueryError)) return true; // transport / timeout / parse
  const m = e.message;
  if (/HTTP 429/.test(m)) return false; // rate limited, not oversized
  if (/HTTP 4\d\d/.test(m)) return false; // schema said no
  if (/internal error has occurred/i.test(m)) return true; // a 504 in a 200's clothes
  if (/carried no data/.test(m)) return false; // GraphQL error envelope
  if (/carried no connection/.test(m)) return false; // shape mismatch
  return true; // 5xx after retries, and anything else unrecognized
}

/**
 * The paging state of ONE scan of ONE scope. A plain JSON object on purpose: an Apps Script
 * sync runs across several executions, so this has to survive a round trip through a job row.
 */
export interface ScanPaging {
  /** Rows per page for the REST of this scan. Decided on page 0 and then fixed. */
  pageSize: number;
  /** 0-based index of the page fetched NEXT. `MAX_PAGES` is measured against it. */
  pageNumber: number;
}

export function newScanPaging(pageSize: number = PAGE_SIZE): ScanPaging {
  return { pageSize, pageNumber: 0 };
}

/**
 * One page of one scope, with the size probe on the first page and the backstop on all of them.
 *
 * THE PROBE RUNS ONCE PER SCAN, NOT ONCE PER PAGE. gas re-asks 500 on every page and eats a
 * doubled call each time a walk already knows 500 is too heavy; on a 17,991-row SCA register
 * that is 36 wasted POSTs. The answer is recorded in `paging.pageSize`, and a later page
 * failing is a real failure rather than an invitation to re-probe: a size that served page 0
 * and fails on page 40 is not a size problem.
 *
 * MAX_PAGES THROWS. Stopping the walk quietly at a thousand pages would hand the ledger a
 * truncated register that looks like a complete one — the same class of lie as a zero that
 * did not look. It is a backstop against a cursor that never terminates, not an expectation:
 * the largest scope here is 17,991 rows, 36 pages at 500.
 *
 * `paging` is MUTATED — the page number advances and the size decision sticks. The caller
 * persists it between executions.
 */
export function fetchPage(
  scope: Scope,
  variables: Rec,
  paging: ScanPaging = newScanPaging(),
): WizPage {
  const query = QUERIES[scope];
  if (query == null) {
    throw new WizQueryError(`no query document for scope "${scope}" — see wizQueries.ts`);
  }
  if (paging.pageNumber >= MAX_PAGES) {
    throw new WizQueryError(
      `Wiz ${scope} walk reached MAX_PAGES (${MAX_PAGES}) at ${paging.pageSize} rows a page ` +
        "and the cursor still reports more. Refusing to truncate silently — a partial " +
        "register that looks complete is worse than a failed scan.",
    );
  }

  const send = (first: number): WizPage => queryPage(query, { ...variables, first });
  const probing = paging.pageNumber === 0 && paging.pageSize > PAGE_SIZE_FALLBACK;

  try {
    const page = send(paging.pageSize);
    paging.pageNumber += 1;
    return page;
  } catch (e) {
    // Not the first page, already at the floor, or a failure a smaller page cannot fix:
    // this is a real error and doubling its cost would not make it less so.
    if (!probing || !smallerPageCouldHelp(e)) throw e;
    const page = send(PAGE_SIZE_FALLBACK);
    paging.pageSize = PAGE_SIZE_FALLBACK;
    paging.pageNumber += 1;
    return page;
  }
}

/**
 * Does the tenant answer at all, with these credentials?
 *
 * One token exchange and one page of one row. This is what turns "credentials are present in
 * Script Properties" — three truthiness tests, which is all `hasWizCredentials()` has ever
 * meant — into something measured. `forgetToken()` first, or a cached token would let a
 * revoked client secret keep reporting success for up to six hours.
 */
export function testConnection(scope: Scope = "sast"): { ok: true; rows: number | null } {
  forgetToken();
  const page = fetchPage(scope, {}, { pageSize: 1, pageNumber: 0 });
  return { ok: true, rows: page.totalCount };
}

export { MAX_PAGES, PAGE_SIZE, PAGE_SIZE_FALLBACK };
