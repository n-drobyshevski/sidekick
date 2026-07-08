// Wiz GraphQL client on UrlFetchApp. Auth is either a raw service-account bearer
// token (WIZ_API_TOKEN, used directly) or an OAuth2 client-credentials exchange
// (WIZ_CLIENT_ID/WIZ_CLIENT_SECRET, token cached in CacheService); the token takes
// precedence. Cloned from the OS-vulns tool's wizClient; only the two connection
// readers differ (cloudResourcesV2 + graphSearch instead of vulnerabilityFindings).

import type { Rec } from "../domain/util";
import { DEFAULT_WIZ_AUTH_URL, getProp, PROP_KEYS, requireProp } from "./props";
import { chooseAiResourceTypes, PAGE_SIZE, PAGE_SIZE_FALLBACK } from "./wizQueriesAi";

export class WizQueryError extends Error {}

const TOKEN_CACHE_KEY = "wiz_ai_token";

export function getToken(forceRefresh = false): string {
  // A raw service-account token is used verbatim — no OAuth exchange, nothing to cache
  // or refresh (forceRefresh is a no-op here; a rejected token is reported by gqlPost).
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

/** One GraphQL POST with retry on 429/5xx and one token refresh on 401. */
function gqlPost(query: string, variables: Rec): Rec {
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
    if (!data) {
      const errors = JSON.stringify(body["errors"] ?? body).slice(0, 500);
      throw new WizQueryError(`Wiz response carried no data: ${errors}`);
    }
    return data;
  }
  throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
}

/**
 * The names of an enum's members in THIS tenant's schema, or null when the
 * enum doesn't exist / introspection is disabled. Never throws on shape
 * surprises — schema probing must stay best-effort.
 */
export function fetchEnumValues(enumName: string): string[] | null {
  const q =
    "query SidekickEnumProbe($name: String!) {\n" +
    "  __type(name: $name) { enumValues { name } }\n" +
    "}\n";
  try {
    const data = gqlPost(q, { name: enumName });
    const t = data["__type"] as Rec | null;
    const values = t && (t["enumValues"] as Rec[] | null);
    if (!Array.isArray(values)) return null;
    return values.map((v) => String(v["name"])).filter(Boolean);
  } catch (e) {
    console.warn(`Enum probe for ${enumName} failed: ${e}`);
    return null;
  }
}

export interface AiTypeResolution {
  types: string[];
  source: string;
  aiLooking: string[];
}

const AI_TYPES_CACHE_KEY = "wiz_ai_resource_types";

/**
 * The AI resource types to query in THIS tenant, resolved once and cached:
 * WIZ_AI_RESOURCE_TYPES override → introspected CloudResourceTypeFilter members
 * (see chooseAiResourceTypes). Throws with the discovered vocabulary when the
 * tenant has no recognizable AI types, so the operator knows what to set.
 */
export function resolveAiResourceTypes(): AiTypeResolution {
  const overrideRaw = getProp(PROP_KEYS.wizAiResourceTypes);
  const override = overrideRaw
    ? overrideRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  if (override && override.length) {
    return { types: override, source: "override", aiLooking: [] };
  }
  const cache = CacheService.getScriptCache();
  const hit = cache.get(AI_TYPES_CACHE_KEY);
  if (hit) {
    try {
      return JSON.parse(hit) as AiTypeResolution;
    } catch {
      /* recompute */
    }
  }
  const enumValues = fetchEnumValues("CloudResourceTypeFilter");
  const chosen = chooseAiResourceTypes(enumValues, null);
  if (!chosen.types.length) {
    throw new WizQueryError(
      "This tenant's CloudResourceTypeFilter enum has no recognizable AI resource types. " +
        "Set the WIZ_AI_RESOURCE_TYPES Script Property (comma-separated enum values). " +
        `AI-flavored members seen: ${chosen.aiLooking.join(", ") || "(none)"}.`,
    );
  }
  try {
    cache.put(AI_TYPES_CACHE_KEY, JSON.stringify(chosen), 21_600);
  } catch {
    /* cache is an optimization */
  }
  return chosen;
}

export interface PageResult {
  rows: Rec[]; // resources (cloudResourcesV2) or path rows with .entities (graphSearch)
  hasNextPage: boolean;
  endCursor: string | null;
  totalCount: number | null;
}

function readConnection(connection: Rec | undefined, field: string): PageResult {
  if (!connection || typeof connection !== "object") {
    throw new WizQueryError(`Wiz response carried no ${field} connection.`);
  }
  const pageInfo = (connection["pageInfo"] as Rec) ?? {};
  const rawTotal = connection["totalCount"];
  return {
    rows: (connection["nodes"] as Rec[]) ?? [],
    hasNextPage: Boolean(pageInfo["hasNextPage"]),
    endCursor: (pageInfo["endCursor"] as string | null) ?? null,
    totalCount: typeof rawTotal === "number" ? rawTotal : null,
  };
}

export interface FetchOptions {
  query: string;
  cursor?: string | null;
  extraVariables?: Rec;
  first?: number;
}

export function fetchCloudResourcesPage(o: FetchOptions): PageResult {
  const run = (first: number) =>
    readConnection(
      gqlPost(o.query, {
        first,
        after: o.cursor ?? null,
        ...(o.extraVariables ?? {}),
      })["cloudResourcesV2"] as Rec,
      "cloudResourcesV2",
    );
  try {
    return run(o.first ?? PAGE_SIZE);
  } catch (e) {
    if (e instanceof WizQueryError && /HTTP 4\d\d/.test(e.message)) throw e;
    return run(PAGE_SIZE_FALLBACK);
  }
}

export function fetchGraphSearchPage(o: FetchOptions): PageResult {
  const run = (first: number) =>
    readConnection(
      gqlPost(o.query, {
        quick: true,
        first,
        after: o.cursor ?? null,
        ...(o.extraVariables ?? {}),
      })["graphSearch"] as Rec,
      "graphSearch",
    );
  try {
    return run(o.first ?? PAGE_SIZE);
  } catch (e) {
    if (e instanceof WizQueryError && /HTTP 4\d\d/.test(e.message)) throw e;
    return run(PAGE_SIZE_FALLBACK);
  }
}
