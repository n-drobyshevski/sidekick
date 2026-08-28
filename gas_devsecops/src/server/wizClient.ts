// The Wiz GraphQL transport on UrlFetchApp: token, one POST, one page.
//
// THIS IS THE ONLY FILE IN `src/` THAT TOUCHES THE NETWORK, and that is deliberate.
// `wizQueries.ts` holds the documents and the filter shapes and refuses to reach for a GAS
// global, because `probe.mjs` bundles and imports it under plain Node so a read-only probe
// sends THE APP'S OWN QUERIES rather than a hand-written approximation. Keeping transport out
// of there is what makes the probe evidence about this battery. The dependency runs one way:
// this file imports from `wizQueries.ts`, never the reverse.
//
// The wire semantics below are not invented — they are what `probe.mjs` has established
// against the live tenant over ten passes, plus the retry ladder from the sibling
// `gas/src/server/wizClient.ts`, which the probe has nothing to say about (it has no retry,
// no backoff and no 429 handling at all, so throttling behaviour has no precedent here and
// follows the sibling).

import type { Scope } from "../domain/config";
import type { Rec } from "../domain/util";
import { DEFAULT_WIZ_AUTH_URL, getProp, PROP_KEYS, requireProp } from "./props";
import {
  buildVariables, MAX_PAGES, PAGE_SIZE, PAGE_SIZE_FALLBACK, QUERIES, ROOT_FIELDS,
} from "./wizQueries";

export class WizError extends Error {}
/** The tenant refused the credentials themselves — a different remedy from a bad query. */
export class WizAuthError extends WizError {}
/**
 * The gateway refused this query with a 4xx that is not about credentials.
 *
 * Its own class because it is the ONLY failure a smaller page can fix. Everything else that
 * can go wrong here — a 200 with no connection, a 200 that is not JSON, a rejected token,
 * throttling — is either structural or transient, and re-asking for 250 rows changes nothing
 * except the number of calls spent finding that out.
 */
export class WizRefusedError extends WizError {}

/**
 * Apps Script itself refused the call — the project is not authorized for outbound HTTP.
 *
 * Nothing to do with Wiz. `UrlFetchApp.fetch` throws this BEFORE any request is made, so it
 * arrives through none of the branches below, and the platform's own sentence names a scope
 * URL and no remedy. Its own class so the UI can answer with the sequence that fixes it.
 */
export class WizNotAuthorizedError extends WizError {}

/**
 * The scope Apps Script names when the project may not reach the network.
 *
 * MATCHED ON THE URL, NEVER ON THE MESSAGE TEXT, and that is the whole point of this
 * constant. The platform localises the sentence — the report that prompted this arrived as
 * "Vous n'êtes pas autorisé à appeler UrlFetchApp.fetch" — so an English match would pass
 * every test here and fail for the operator who hit it. This repo has already paid for that
 * lesson once: `sheetsDb.ts` deliberately does not test for "exceeds the maximum" because the
 * reporting tenant got that error in French too. The scope URL is the one token in the
 * message that is the same in every locale.
 */
const EXTERNAL_REQUEST_SCOPE = "script.external_request";

/**
 * Re-raise a platform authorization refusal with the sequence that fixes it.
 *
 * The remedy is specific and not guessable from the platform's message, and it took three
 * wrong answers to find: inference did NOT ask for this scope even with the call present in
 * the bundle, and no consent prompt appeared in the editor or the web app. What makes Apps
 * Script ask is the MANIFEST declaring the scope — see `dist/appsscript.json` and
 * `test/manifestScopes.test.js`. After that a push, an editor run, and a new deployment
 * version, in that order.
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

const TOKEN_CACHE_KEY = "wiz_token";

/** How many times one page is attempted before the walk gives up. */
const ATTEMPTS = 4;

/**
 * The bearer token for one call.
 *
 * A raw `WIZ_API_TOKEN` is used verbatim — there is nothing to exchange and nothing to cache,
 * so `forceRefresh` is a no-op for it; a rejected static token is reported by the caller with
 * a hint naming the remedy, because refreshing it is an operator action rather than something
 * this code can do.
 *
 * The OAuth token is cached in CacheService rather than Properties: it is script-wide,
 * expires on its own and needs no lock. The TTL is the tenant's `expires_in` less five
 * minutes of margin, floored at a minute and CEILINGED AT SIX HOURS — CacheService refuses
 * anything longer, and a silently-rejected put would mean a token exchange on every page.
 */
export function getToken(forceRefresh = false): string {
  const staticToken = getProp(PROP_KEYS.wizApiToken);
  if (staticToken && staticToken.trim()) return staticToken.trim();

  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
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
  const code = response.getResponseCode();
  if (code !== 200) {
    throw new WizAuthError(
      `Wiz token request failed (HTTP ${code}): ${response.getContentText().slice(0, 400)}`,
    );
  }
  let body: Rec;
  try {
    body = JSON.parse(response.getContentText()) as Rec;
  } catch {
    throw new WizAuthError("Wiz token response was not JSON.");
  }
  const token = body["access_token"];
  // A 200 carrying no token is a HARD failure, not an empty string to carry forward. The
  // alternative is every subsequent page returning 401 and the walk blaming the query.
  if (typeof token !== "string" || !token) {
    throw new WizAuthError("Wiz token response carried no access_token.");
  }
  const expiresIn = Number(body["expires_in"] ?? 3600);
  const ttl = Math.max(60, Math.min(Math.trunc(expiresIn) - 300, 21_600));
  cache.put(TOKEN_CACHE_KEY, token, ttl);
  return token;
}

/** Drop the cached OAuth token. Used by the connection test so it exercises a real exchange. */
export function forgetToken(): void {
  try {
    CacheService.getScriptCache().remove(TOKEN_CACHE_KEY);
  } catch {
    // A cache that will not answer is not a reason to fail a scan; the next get re-exchanges.
  }
}

/**
 * Find the connection in a GraphQL response, or refuse.
 *
 * A DUPLICATE OF `probeHelpers.resolveConnection`, AND KEPT PINNED TO IT by
 * `test/wizClient.test.js`, which runs both over the same table. The probe is a standalone
 * Node script and this is a GAS bundle; neither can import the other's module, and the one
 * thing worse than two copies is two copies that quietly disagree about what "no rows" means.
 *
 * PROBE_FINDINGS.md §9.1 is why it exists at all: the probe read its connection off a
 * hardcoded root chain that had never learned `secretInstances`, so an 843-row register
 * printed `0 node(s)` and wrote `{count: 0}` to the report with no error beside it —
 * indistinguishable from a register that is genuinely empty. Here the stakes are higher than
 * a wrong report: an empty page is what resolution-by-disappearance reads as remediation.
 */
export function resolveConnection(data: unknown): { root: string; conn: Rec } | null {
  const rec = (data ?? {}) as Rec;
  for (const key of Object.keys(rec)) {
    const v = rec[key];
    if (v !== null && typeof v === "object" && ("nodes" in (v as Rec) || "pageInfo" in (v as Rec))) {
      return { root: key, conn: v as Rec };
    }
  }
  return null;
}

export interface PageResult {
  nodes: Rec[];
  hasNextPage: boolean;
  endCursor: string | null;
  /** The tenant's count for the whole filtered set, or null if it did not say. */
  totalCount: number | null;
  /** The `first` this page was actually fetched with — 500, or 250 after a cost complaint. */
  pageSize: number;
  /**
   * GraphQL errors that arrived ALONGSIDE data. Not a failure: §7 captured a 200 carrying 40
   * good nodes and an `errors` array, and `brick/devsecops` raises on any `errors`, which
   * would reject that exact response wholesale. Carried so a scan can report what it could
   * not read rather than silently under-counting.
   */
  partialErrors: string[];
}

/** One POST, with the retry ladder. Throws on anything it cannot turn into a page. */
function post(query: string, variables: Rec, first: number, expectedRoot: string): PageResult {
  const apiUrl = requireProp(PROP_KEYS.wizApiUrl);
  let token = getToken();
  let lastTransient = "";

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const response = guardAuthorization(() => UrlFetchApp.fetch(apiUrl, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${token}` },
      payload: JSON.stringify({ query, variables }),
      muteHttpExceptions: true,
    }));
    const code = response.getResponseCode();

    // One refresh, first attempt only, and only when there is something to refresh: a static
    // WIZ_API_TOKEN cannot be re-minted here, so retrying it just spends another call.
    if (code === 401 && attempt === 0 && !getProp(PROP_KEYS.wizApiToken)) {
      token = getToken(true);
      continue;
    }
    if (code === 429 || code >= 500) {
      lastTransient = `HTTP ${code}`;
      // Synchronous, and that is the point: it spends the execution's own budget, which is
      // why the caller checks its deadline between pages rather than assuming a page is fast.
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    if (code !== 200) {
      const hint = code === 401 && getProp(PROP_KEYS.wizApiToken)
        ? " — WIZ_API_TOKEN was rejected; it may have expired. Refresh it, or set "
          + "WIZ_CLIENT_ID and WIZ_CLIENT_SECRET so the token can be re-minted automatically."
        : "";
      const Cls = code === 401 || code === 403 ? WizAuthError : WizRefusedError;
      throw new Cls(
        `Wiz query failed (HTTP ${code})${hint}: ${response.getContentText().slice(0, 400)}`,
      );
    }

    let body: Rec;
    try {
      body = JSON.parse(response.getContentText()) as Rec;
    } catch {
      throw new WizError(
        `Wiz returned a 200 that was not JSON: ${response.getContentText().slice(0, 300)}`,
      );
    }
    const errors = ((body["errors"] as Rec[] | undefined) ?? [])
      .map((e) => String((e as Rec)["message"] ?? e));
    const found = resolveConnection(body["data"]);
    if (!found) {
      throw new WizError(
        `Wiz response carried no connection${errors.length ? `: ${errors.join("; ").slice(0, 400)}` : "."}`,
      );
    }
    // A connection under the WRONG root is not this scope's population. Reading it anyway
    // would fill one register with another's rows, and the disappearance pass would then
    // resolve everything that was legitimately there.
    if (found.root !== expectedRoot) {
      throw new WizError(
        `Wiz answered under \`${found.root}\` where \`${expectedRoot}\` was asked for.`,
      );
    }
    const conn = found.conn;
    const pageInfo = (conn["pageInfo"] as Rec) ?? {};
    const rawTotal = conn["totalCount"];
    return {
      nodes: (conn["nodes"] as Rec[]) ?? [],
      hasNextPage: Boolean(pageInfo["hasNextPage"]),
      endCursor: (pageInfo["endCursor"] as string | null) ?? null,
      totalCount: typeof rawTotal === "number" ? rawTotal : null,
      pageSize: first,
      partialErrors: errors,
    };
  }
  throw new WizError(`Wiz query failed after ${ATTEMPTS} attempts (${lastTransient}).`);
}

export interface FetchPageOptions {
  severities?: readonly string[];
  projectId?: string | null;
  cursor?: string | null;
  /** The page size to ask for. Defaults to PAGE_SIZE; a caller resuming passes what worked. */
  first?: number;
}

/**
 * One page of one scope.
 *
 * The page-size fallback is a cost path, not a retry. A gateway that refuses a 500-row ask
 * because the query is too expensive will refuse it again, and asking for 250 is the only
 * thing that changes the answer — so it fires ONCE, only for a `WizRefusedError` (a 4xx that
 * is not about credentials), and only when the size can actually be reduced.
 *
 * NARROWER THAN THE SIBLING, deliberately. `gas/`'s `graphSearchPage` retries on ANY throw,
 * which means a 200 carrying no connection, a 200 that is not JSON, and four spent attempts
 * against a throttling tenant each buy a second full round of calls to learn the same thing.
 * Measured here: three of the five specs below failed against that behaviour, because the
 * fallback swallowed the error the test was about.
 */
export function fetchPage(scope: Scope, opts: FetchPageOptions = {}): PageResult {
  const query = QUERIES[scope];
  if (!query) throw new WizError(`No query is defined for scope ${scope}.`);
  const first = opts.first ?? PAGE_SIZE;
  const vars = (size: number) => buildVariables(scope, {
    severities: opts.severities,
    projectId: opts.projectId,
    after: opts.cursor ?? null,
    first: size,
  }) as Rec;

  const root = ROOT_FIELDS[scope];
  try {
    return post(query, vars(first), first, root);
  } catch (e) {
    if (!(e instanceof WizRefusedError) || first <= PAGE_SIZE_FALLBACK) throw e;
    return post(query, vars(PAGE_SIZE_FALLBACK), PAGE_SIZE_FALLBACK, root);
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
  const page = fetchPage(scope, { first: 1 });
  return { ok: true, rows: page.totalCount };
}

export { MAX_PAGES, PAGE_SIZE, PAGE_SIZE_FALLBACK };
