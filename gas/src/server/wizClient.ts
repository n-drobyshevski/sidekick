// Wiz GraphQL client on UrlFetchApp — the replacement for the wiz_sdk usage in
// os_vulns.py. Auth is either a raw service-account bearer token (WIZ_API_TOKEN, used
// directly) or an OAuth2 client-credentials exchange (WIZ_CLIENT_ID/WIZ_CLIENT_SECRET,
// token cached in CacheService); the token takes precedence. QUERY and the baseline
// VARIABLES are verbatim from os_vulns.py (wizQuery.ts is generated).

import { apiSeverityFilter } from "../domain/settingsLogic";
import type { Rec } from "../domain/util";
import { DEFAULT_WIZ_AUTH_URL, getProp, PROP_KEYS, requireProp } from "./props";
import { BASE_VARIABLES, MAX_PAGES, PAGE_SIZE, PAGE_SIZE_FALLBACK, QUERY } from "./wizQuery";

export class WizQueryError extends Error {}

/** The tenant rejected an injected (incremental) filter — quick refresh must degrade. */
export class WizDeltaFilterError extends WizQueryError {}

const TOKEN_CACHE_KEY = "wiz_token";

export function getToken(forceRefresh = false): string {
  // A raw service-account token is used verbatim — no OAuth exchange, nothing to cache
  // or refresh (forceRefresh is a no-op here; a rejected token is reported by queryPage).
  const staticToken = getProp(PROP_KEYS.wizApiToken);
  if (staticToken && staticToken.trim()) return staticToken.trim();

  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = cache.get(TOKEN_CACHE_KEY);
    if (cached) return cached;
  }
  const authUrl = getProp(PROP_KEYS.wizAuthUrl) ?? DEFAULT_WIZ_AUTH_URL;
  const response = UrlFetchApp.fetch(authUrl, {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "client_credentials",
      audience: "wiz-api",
      client_id: requireProp(PROP_KEYS.wizClientId),
      client_secret: requireProp(PROP_KEYS.wizClientSecret),
    },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) {
    throw new WizQueryError(
      `Wiz token request failed (${response.getResponseCode()}): ` +
        response.getContentText().slice(0, 500),
    );
  }
  const body = JSON.parse(response.getContentText()) as Rec;
  const token = body["access_token"];
  if (typeof token !== "string" || !token) {
    throw new WizQueryError("Wiz token response carried no access_token.");
  }
  const expiresIn = Number(body["expires_in"] ?? 3600);
  const ttl = Math.max(60, Math.min(Math.trunc(expiresIn) - 300, 21_600));
  cache.put(TOKEN_CACHE_KEY, token, ttl);
  return token;
}

export interface PageResult {
  nodes: Rec[];
  hasNextPage: boolean;
  endCursor: string | null;
  totalCount: number | null;
}

/** Deep-ish clone of the baseline variables (they contain nested filter objects). */
function baseVariables(): Rec {
  return JSON.parse(JSON.stringify(BASE_VARIABLES)) as Rec;
}

export interface VariableOptions {
  severities?: string[] | null; // scan scope; null/full scope -> no severity filter
  extraFilterBy?: Rec | null; // e.g. {updatedAt: {after: iso}} for incremental
  first?: number;
  after?: string | null;
  includeTotalCount?: boolean;
}

export function buildVariables(options: VariableOptions = {}): Rec {
  const vars = baseVariables();
  const filterBy = vars["filterBy"] as Rec;
  const projectId = getProp(PROP_KEYS.wizProjectIdV2);
  if (projectId) filterBy["projectIdV2"] = { equals: [projectId] };
  const sevFilter =
    options.severities === undefined ? null : apiSeverityFilter(options.severities);
  if (sevFilter) filterBy["severity"] = sevFilter;
  for (const [k, v] of Object.entries(options.extraFilterBy ?? {})) filterBy[k] = v;
  vars["first"] = options.first ?? PAGE_SIZE;
  if (options.after) vars["after"] = options.after;
  vars["includeTotalCount"] = Boolean(options.includeTotalCount);
  return vars;
}

/** One GraphQL POST with retry on 429/5xx and one token refresh on 401. */
export function queryPage(variables: Rec, isDeltaFetch = false): PageResult {
  const apiUrl = requireProp(PROP_KEYS.wizApiUrl);
  let token = getToken();
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = UrlFetchApp.fetch(apiUrl, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${token}` },
      payload: JSON.stringify({ query: QUERY, variables }),
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    // A static WIZ_API_TOKEN can't be refreshed, so only retry-with-refresh in OAuth mode.
    if (code === 401 && attempt === 0 && !getProp(PROP_KEYS.wizApiToken)) {
      token = getToken(true);
      continue;
    }
    if (code === 429 || code >= 500) {
      lastError = `HTTP ${code}`;
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    if (code !== 200) {
      const hint =
        code === 401 && getProp(PROP_KEYS.wizApiToken)
          ? " — WIZ_API_TOKEN was rejected; it may have expired. Refresh it, or set " +
            "WIZ_CLIENT_ID/WIZ_CLIENT_SECRET for auto-refresh."
          : "";
      throw new WizQueryError(
        `Wiz query failed (HTTP ${code})${hint}: ${response.getContentText().slice(0, 500)}`,
      );
    }
    const body = JSON.parse(response.getContentText()) as Rec;
    const data = body["data"] as Rec | undefined;
    const connection = data?.["vulnerabilityFindings"] as Rec | undefined;
    if (!connection) {
      const errors = JSON.stringify(body["errors"] ?? body).slice(0, 500);
      // An errors-only response on a delta fetch almost certainly means the tenant
      // rejected the injected filter (e.g. updatedAt) — the WizDeltaFilterError signal
      // client.fetch_findings_delta relies on.
      if (isDeltaFetch) {
        throw new WizDeltaFilterError(`Wiz rejected the incremental filter: ${errors}`);
      }
      throw new WizQueryError(`Wiz response carried no findings connection: ${errors}`);
    }
    const pageInfo = (connection["pageInfo"] as Rec) ?? {};
    const rawTotal = connection["totalCount"];
    return {
      nodes: (connection["nodes"] as Rec[]) ?? [],
      hasNextPage: Boolean(pageInfo["hasNextPage"]),
      endCursor: (pageInfo["endCursor"] as string | null) ?? null,
      totalCount: typeof rawTotal === "number" ? rawTotal : null,
    };
  }
  throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
}

// --------------------------------------------------------------- graphSearch
// A generalized POST for auxiliary queries (subscriptions → Support Group) that read
// a different connection than `vulnerabilityFindings`. queryPage above is deliberately
// left untouched so the fixture-critical findings path keeps its exact behavior.

/** One GraphQL POST with retry on 429/5xx and one token refresh on 401; returns raw `data`. */
export function gqlPost(query: string, variables: Rec): Rec {
  const apiUrl = requireProp(PROP_KEYS.wizApiUrl);
  let token = getToken();
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = UrlFetchApp.fetch(apiUrl, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${token}` },
      payload: JSON.stringify({ query, variables }),
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    if (code === 401 && attempt === 0 && !getProp(PROP_KEYS.wizApiToken)) {
      token = getToken(true);
      continue;
    }
    if (code === 429 || code >= 500) {
      lastError = `HTTP ${code}`;
      Utilities.sleep(1000 * Math.pow(2, attempt));
      continue;
    }
    if (code !== 200) {
      throw new WizQueryError(
        `Wiz query failed (HTTP ${code}): ${response.getContentText().slice(0, 500)}`,
      );
    }
    const body = JSON.parse(response.getContentText()) as Rec;
    const data = body["data"] as Rec | undefined;
    if (!data) {
      const errors = JSON.stringify(body["errors"] ?? body).slice(0, 500);
      throw new WizQueryError(`Wiz response carried no data: ${errors}`);
    }
    return data;
  }
  throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
}

export interface GraphSearchPage {
  nodes: Rec[]; // each node carries an `entities` array
  hasNextPage: boolean;
  endCursor: string | null;
}

function parseGraphSearchPage(data: Rec): GraphSearchPage {
  const connection = data["graphSearch"] as Rec | undefined;
  if (!connection) {
    throw new WizQueryError("Wiz response carried no graphSearch connection.");
  }
  const pageInfo = (connection["pageInfo"] as Rec) ?? {};
  return {
    nodes: (connection["nodes"] as Rec[]) ?? [],
    hasNextPage: Boolean(pageInfo["hasNextPage"]),
    endCursor: (pageInfo["endCursor"] as string | null) ?? null,
  };
}

/**
 * One page of a graphSearch connection (nodes[].entities + pageInfo). On a query failure it
 * retries once at a smaller page size — a Wiz "input exceeded" / query-cost error on a heavy
 * page (e.g. large `properties` blobs) clears when fewer entities are requested, the same
 * first-page size probe fetchPage does. `fallbackFirst` pins the retry size; absent, it halves
 * `variables.first` (floored at 1). The retry is skipped when `first` can't be reduced, so a
 * non-size error surfaces on the first throw rather than being masked by a pointless second call.
 */
export function graphSearchPage(
  query: string,
  variables: Rec,
  fallbackFirst?: number,
): GraphSearchPage {
  try {
    return parseGraphSearchPage(gqlPost(query, variables));
  } catch (e) {
    const first = Number(variables["first"]);
    const smaller =
      fallbackFirst ?? (Number.isFinite(first) ? Math.max(1, Math.floor(first / 2)) : NaN);
    if (!Number.isFinite(smaller) || !(smaller < first)) throw e;
    return parseGraphSearchPage(gqlPost(query, { ...variables, first: smaller }));
  }
}

export interface FetchPageOptions {
  severities?: string[] | null;
  extraFilterBy?: Rec | null;
  cursor?: string | null;
  pageNumber: number; // 0-based; page 0 requests totalCount for progress
}

/**
 * Fetch one page of the findings walk, falling back once to the smaller page size
 * (the port of the first-page size probe; GAS caps at 500/250 for the 50MB response
 * and V8 heap limits — never the Python 5000).
 */
export function fetchPage(options: FetchPageOptions): PageResult {
  const common = {
    severities: options.severities,
    extraFilterBy: options.extraFilterBy,
    after: options.cursor ?? null,
    includeTotalCount: options.pageNumber === 0,
  };
  const isDelta = Boolean(options.extraFilterBy && Object.keys(options.extraFilterBy).length);
  try {
    return queryPage(buildVariables({ ...common, first: PAGE_SIZE }), isDelta);
  } catch (e) {
    if (e instanceof WizDeltaFilterError) throw e;
    return queryPage(buildVariables({ ...common, first: PAGE_SIZE_FALLBACK }), isDelta);
  }
}

export { MAX_PAGES, PAGE_SIZE, PAGE_SIZE_FALLBACK };
