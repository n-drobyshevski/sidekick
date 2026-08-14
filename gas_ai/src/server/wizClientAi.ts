// Wiz GraphQL client on UrlFetchApp. Auth is either a raw service-account bearer
// token (WIZ_API_TOKEN, used directly) or an OAuth2 client-credentials exchange
// (WIZ_CLIENT_ID/WIZ_CLIENT_SECRET, token cached in CacheService); the token takes
// precedence. Cloned from the OS-vulns tool's wizClient; only the two connection
// readers differ (cloudResourcesV2 + graphSearch instead of vulnerabilityFindings).

import type { Rec } from "../domain/util";
import { DEFAULT_WIZ_AUTH_URL, getProp, PROP_KEYS, requireProp } from "./props";
import {
  AI_RESOURCE_TYPE_CANDIDATES,
  aiInventoryVariables,
  chooseAiResourceTypes,
  isInvalidEnumValueError,
  PAGE_SIZE,
  PAGE_SIZE_FALLBACK,
  Q_AI_INVENTORY,
} from "./wizQueriesAi";

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
      // Exponential backoff with full jitter. A sync fans a battery of queries at one
      // tenant, and several hitting the same 429 would otherwise retry in lockstep and
      // re-create the burst that caused it; the randomness spreads them out.
      const ceiling = 1000 * Math.pow(2, attempt);
      Utilities.sleep(Math.floor(ceiling / 2 + Math.random() * (ceiling / 2)));
      continue;
    }
    if (code !== 200) {
      const hint =
        code === 401 && getProp(PROP_KEYS.wizApiToken)
          ? " — WIZ_API_TOKEN was rejected; it may have expired. Refresh it, or set " +
            "WIZ_CLIENT_ID/WIZ_CLIENT_SECRET for auto-refresh."
          : "";
      throw new WizQueryError(
        `Wiz query failed (HTTP ${code})${hint}: ${errorDigest(response.getContentText())}`,
      );
    }
    const body = JSON.parse(response.getContentText()) as Rec;
    const data = body["data"] as Rec | undefined;
    if (!data) {
      throw new WizQueryError(
        `Wiz response carried no data: ${errorDigest(response.getContentText())}`,
      );
    }
    return data;
  }
  throw new WizQueryError(`Wiz query failed after retries (${lastError}).`);
}

/**
 * The names of an enum's members in THIS tenant's schema, or null when the
 * enum doesn't exist / introspection is disabled. The enum name is inlined as
 * a literal — Wiz's gateway rejects variables on introspection queries
 * ("missing value for non-null variable"). Never throws on shape surprises —
 * schema probing must stay best-effort.
 */
export function fetchEnumValues(enumName: string): string[] | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(enumName)) return null;
  const q =
    "query SidekickEnumProbe {\n" +
    "  __type(name: \"" + enumName + "\") { enumValues { name } }\n" +
    "}\n";
  try {
    const data = gqlPost(q, {});
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

// v2: the v1 key could hold a blind "candidates" resolution cached by the
// previous build; the new name orphans any such entry.
const AI_TYPES_CACHE_KEY = "wiz_ai_resource_types_v2";

/**
 * Empirical fallback when introspection is blocked: ask the tenant about each
 * candidate type with a 1-row query — its own "cannot represent value"
 * rejection is the oracle. Anything else (auth, transport, other validation)
 * is a real failure and rethrows.
 */
function probeCandidateTypes(
  candidates: readonly string[],
  say: (m: string) => void,
): string[] {
  const accepted: string[] = [];
  for (const t of candidates) {
    try {
      fetchCloudResourcesPage({
        query: Q_AI_INVENTORY,
        first: 1,
        extraVariables: aiInventoryVariables([t]),
      });
      accepted.push(t);
      say(`  ${t}: accepted`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isInvalidEnumValueError(msg)) {
        say(`  ${t}: not in this tenant's schema`);
        continue;
      }
      throw e;
    }
  }
  return accepted;
}

/**
 * The AI resource types to query in THIS tenant, resolved once and cached.
 * Precedence: WIZ_AI_RESOURCE_TYPES override → introspected
 * CloudResourceTypeFilter members (see chooseAiResourceTypes) → per-candidate
 * empirical probing when introspection is unavailable. Throws with the
 * discovered vocabulary when nothing works, so the operator knows what to set.
 * Pass `log` (the diagnostic does) for a verbose trace; that also bypasses the
 * cache read so the report reflects the tenant's current schema.
 */
export function resolveAiResourceTypes(log?: (m: string) => void): AiTypeResolution {
  const say = log ?? (() => undefined);
  const overrideRaw = getProp(PROP_KEYS.wizAiResourceTypes);
  const override = overrideRaw
    ? overrideRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  if (override && override.length) {
    say(`AI resource types: WIZ_AI_RESOURCE_TYPES override — ${override.join(", ")}.`);
    return { types: override, source: "override", aiLooking: [] };
  }

  const cache = CacheService.getScriptCache();
  if (!log) {
    const hit = cache.get(AI_TYPES_CACHE_KEY);
    if (hit) {
      try {
        return JSON.parse(hit) as AiTypeResolution;
      } catch {
        /* recompute */
      }
    }
  }

  let chosen: AiTypeResolution;
  const enumValues = fetchEnumValues("CloudResourceTypeFilter");
  if (enumValues) {
    const picked = chooseAiResourceTypes(enumValues, null);
    say(
      `CloudResourceTypeFilter has ${enumValues.length} members; AI-flavored: ` +
        `${picked.aiLooking.join(", ") || "(none)"}.`,
    );
    if (!picked.types.length) {
      throw new WizQueryError(
        "This tenant's CloudResourceTypeFilter enum has no recognizable AI resource types. " +
          "Set the WIZ_AI_RESOURCE_TYPES Script Property (comma-separated enum values). " +
          `AI-flavored members seen: ${picked.aiLooking.join(", ") || "(none)"}.`,
      );
    }
    chosen = picked;
  } else {
    // Introspection blocked (Wiz gateways commonly refuse it) — probe each
    // candidate empirically instead.
    say("Introspection unavailable — probing candidate types one by one:");
    const accepted = probeCandidateTypes(AI_RESOURCE_TYPE_CANDIDATES, say);
    if (!accepted.length) {
      throw new WizQueryError(
        "None of the candidate AI resource types (" +
          AI_RESOURCE_TYPE_CANDIDATES.join(", ") +
          ") exist in this tenant's CloudResourceTypeFilter enum, and introspection is " +
          "unavailable. Find the tenant's AI type names (Wiz docs → GraphQL schema, or the " +
          "Wiz UI's inventory filter) and set the WIZ_AI_RESOURCE_TYPES Script Property.",
      );
    }
    chosen = { types: accepted, source: "probe", aiLooking: [] };
  }

  say(`Inventory will query types (${chosen.source}): ${chosen.types.join(", ")}.`);
  try {
    cache.put(AI_TYPES_CACHE_KEY, JSON.stringify(chosen), 21_600);
  } catch {
    /* cache is an optimization */
  }
  return chosen;
}

/** How much of a failed response body a thrown message carries. */
const ERROR_BODY_MAX = 800;

/**
 * A GraphQL error body reduced to the part an operator can act on.
 *
 * Raw, a validation failure is mostly boilerplate: every entry repeats
 * `"locations":[{"line":15,"column":9}],"extensions":{"code":"GRAPHQL_VALIDATION_FAILED"}`
 * around one short sentence. A tenant rejecting three fields spent ~450 of the old
 * 500-character budget on that scaffolding and got truncated mid-message — which is
 * exactly how a rejection of `nativeType`, `cloudPlatform` and `region` reached a screen
 * with the fourth message cut off. Joining the `message` values fits several times more
 * signal in the same space.
 *
 * Falls back to the raw text for anything that is not a GraphQL error envelope — an HTML
 * error page from a proxy, say — because then the raw text IS the diagnosis. Never throws:
 * this runs on a path that is already failing.
 */
export function errorDigest(text: string): string {
  try {
    const parsed = JSON.parse(text) as Rec;
    const errors = parsed["errors"];
    if (Array.isArray(errors) && errors.length) {
      const messages = errors
        .map((e) => (e && typeof e === "object" ? String((e as Rec)["message"] ?? "") : ""))
        .filter(Boolean);
      if (messages.length) return messages.join(" | ").slice(0, ERROR_BODY_MAX);
    }
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return String(text).slice(0, ERROR_BODY_MAX);
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

/**
 * Read one page from a top-level connection.
 *
 * The size fallback is the point: a tenant that rejects the requested page size with a
 * 5xx or a transport error gets one retry at the smaller size, but a 4xx is the schema
 * saying no and is rethrown untouched — retrying it smaller would just fail again slower.
 *
 * `extra` is merged into the variables, which is how graphSearch sends its mandatory
 * `quick: true` without needing a reader of its own.
 */
function fetchPage(field: string, o: FetchOptions, extra?: Rec): PageResult {
  const run = (first: number) =>
    readConnection(
      gqlPost(o.query, {
        ...(extra ?? {}),
        first,
        after: o.cursor ?? null,
        ...(o.extraVariables ?? {}),
      })[field] as Rec,
      field,
    );
  try {
    return run(o.first ?? PAGE_SIZE);
  } catch (e) {
    if (e instanceof WizQueryError && /HTTP 4\d\d/.test(e.message)) throw e;
    return run(PAGE_SIZE_FALLBACK);
  }
}

/**
 * The cloudResourcesV2 root. This was a separate 16-line function whose body was
 * character-for-character `fetchConnectionPage("cloudResourcesV2", o)`.
 */
export function fetchCloudResourcesPage(o: FetchOptions): PageResult {
  return fetchPage("cloudResourcesV2", o);
}

/** Any other top-level connection: issuesV2, configurationFindings, … */
export function fetchConnectionPage(field: string, o: FetchOptions): PageResult {
  return fetchPage(field, o);
}

/** graphSearch, which must always send `quick: true`. */
export function fetchGraphSearchPage(o: FetchOptions): PageResult {
  return fetchPage("graphSearch", o, { quick: true });
}

