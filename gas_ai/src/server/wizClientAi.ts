// Wiz GraphQL client on UrlFetchApp. Auth is either a raw service-account bearer
// token (WIZ_API_TOKEN, used directly) or an OAuth2 client-credentials exchange
// (WIZ_CLIENT_ID/WIZ_CLIENT_SECRET, token cached in CacheService); the token takes
// precedence. Cloned from the OS-vulns tool's wizClient; only the two connection
// readers differ (cloudResourcesV2 + graphSearch instead of vulnerabilityFindings).

import type { Rec } from "../domain/util";
import { DEFAULT_WIZ_AUTH_URL, getProp, PROP_KEYS, requireProp, setProp } from "./props";
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
 * How long the DURABLE copy of the resolution stays authoritative.
 *
 * CacheService is the hot layer and it is evictable — 6 h is its ceiling, and its 1,000-item
 * FIFO can drop an entry well before that. Every eviction costs a fresh resolution, which is
 * 1 POST on a tenant that allows introspection but one `first: 1` probe PER CANDIDATE (14 of
 * them) on a tenant that refuses it. That is up to ~15 POSTs to re-learn a list that changes
 * when Wiz ships a resource type, i.e. approximately never.
 *
 * So the answer is also written to a Script Property, which does not evict, and is trusted
 * for a week. Long enough to make eviction free, short enough that a tenant gaining a type
 * is picked up without an operator doing anything — and `wizDiagnostic()` bypasses both
 * layers, so there is always a way to see the tenant's live answer on demand.
 */
const AI_TYPES_PROP_TTL_MS = 7 * 86_400_000;

interface StoredAiTypes extends AiTypeResolution {
  resolvedAt: number;
}

/** The durable resolution, if one is stored and still inside its window. */
function readStoredAiTypes(now: number): AiTypeResolution | null {
  const raw = getProp(PROP_KEYS.wizAiResourceTypesResolved);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredAiTypes;
    if (!parsed || !Array.isArray(parsed.types) || !parsed.types.length) return null;
    if (!(now - Number(parsed.resolvedAt) < AI_TYPES_PROP_TTL_MS)) return null;
    return { types: parsed.types, source: parsed.source, aiLooking: parsed.aiLooking ?? [] };
  } catch {
    return null; // a hand-edited or pre-upgrade value simply re-resolves
  }
}

function writeStoredAiTypes(chosen: AiTypeResolution, now: number): void {
  try {
    setProp(
      PROP_KEYS.wizAiResourceTypesResolved,
      JSON.stringify({ ...chosen, resolvedAt: now } satisfies StoredAiTypes),
    );
  } catch {
    /* durability is an optimization, exactly like the cache below it */
  }
}

/**
 * A type name no tenant can carry — the NEGATIVE CONTROL for the probe below.
 *
 * The probe's whole premise is that the gateway rejects an enum value it does not know. If
 * it does not — if it accepts anything and answers with an empty page — then every candidate
 * comes back "accepted" and the resolution is not a measurement, it is the candidate list
 * read back. That failure looks exactly like a tenant that genuinely carries all fourteen,
 * which is the shape this codebase refuses to leave undetectable.
 */
const PROBE_SENTINEL = "AI_SIDEKICK_NEGATIVE_CONTROL";

/** Whether the tenant rejects a type it cannot possibly have. */
function probeOracleWorks(say: (m: string) => void): boolean {
  try {
    fetchCloudResourcesPage({
      query: Q_AI_INVENTORY,
      first: 1,
      extraVariables: aiInventoryVariables([PROBE_SENTINEL]),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Rejected, as it must be: the oracle discriminates and the probe below means something.
    if (isInvalidEnumValueError(msg)) return true;
    throw e; // auth, transport, anything else — a real failure, not a verdict
  }
  say(
    `  ⚠ negative control (${PROBE_SENTINEL}) was ACCEPTED — this gateway does not reject ` +
      "unknown type values, so the per-candidate probe cannot tell which types this tenant " +
      "really has. Every candidate below will read as accepted. Set WIZ_AI_RESOURCE_TYPES " +
      "to the types you actually want queried.",
  );
  return false;
}

/**
 * Empirical fallback when introspection is blocked: ask the tenant about each
 * candidate type with a 1-row query — its own "cannot represent value"
 * rejection is the oracle. Anything else (auth, transport, other validation)
 * is a real failure and rethrows.
 *
 * Runs a negative control first, because an oracle that never says no is not an oracle.
 * A broken control does not change WHICH types are queried — the list still works, and
 * breaking a running sync over a diagnostic finding would be the worse trade — but it is
 * reported, and it changes the recorded `source` so the Scans panel cannot present a
 * guess as a measurement.
 */
function probeCandidateTypes(
  candidates: readonly string[],
  say: (m: string) => void,
): { accepted: string[]; verified: boolean } {
  const verified = probeOracleWorks(say);
  const accepted: string[] = [];
  for (const t of candidates) {
    try {
      fetchCloudResourcesPage({
        query: Q_AI_INVENTORY,
        first: 1,
        extraVariables: aiInventoryVariables([t]),
      });
      accepted.push(t);
      say(`  ${t}: accepted${verified ? "" : " (unverified — see the warning above)"}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isInvalidEnumValueError(msg)) {
        say(`  ${t}: not in this tenant's schema`);
        continue;
      }
      throw e;
    }
  }
  return { accepted, verified };
}

/**
 * The AI resource types to query in THIS tenant, resolved once and cached.
 * Precedence: WIZ_AI_RESOURCE_TYPES override → CacheService (hot) →
 * WIZ_AI_RESOURCE_TYPES_RESOLVED Script Property (durable, 7 days) → introspected
 * CloudResourceTypeFilter members (see chooseAiResourceTypes) → per-candidate
 * empirical probing when introspection is unavailable. Throws with the
 * discovered vocabulary when nothing works, so the operator knows what to set.
 * Pass `log` (the diagnostic does) for a verbose trace; that also bypasses BOTH
 * stored layers so the report reflects the tenant's current schema.
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

  const now = Date.now();
  const cache = CacheService.getScriptCache();
  // Both stored layers are gated on the same `!log`, and that gate is the diagnostic's
  // contract: wizDiagnostic step 2 exists to show what the tenant says NOW. A durable
  // layer that answered it would make the report a mirror of its own last answer.
  if (!log) {
    const hit = cache.get(AI_TYPES_CACHE_KEY);
    if (hit) {
      try {
        return JSON.parse(hit) as AiTypeResolution;
      } catch {
        /* recompute */
      }
    }
    const stored = readStoredAiTypes(now);
    if (stored) {
      // Re-warm the hot layer so the next eviction is the only cost this pays.
      try {
        cache.put(AI_TYPES_CACHE_KEY, JSON.stringify(stored), 21_600);
      } catch {
        /* cache is an optimization */
      }
      return stored;
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
    const { accepted, verified } = probeCandidateTypes(AI_RESOURCE_TYPE_CANDIDATES, say);
    if (!accepted.length) {
      throw new WizQueryError(
        "None of the candidate AI resource types (" +
          AI_RESOURCE_TYPE_CANDIDATES.join(", ") +
          ") exist in this tenant's CloudResourceTypeFilter enum, and introspection is " +
          "unavailable. Find the tenant's AI type names (Wiz docs → GraphQL schema, or the " +
          "Wiz UI's inventory filter) and set the WIZ_AI_RESOURCE_TYPES Script Property.",
      );
    }
    // The source carries the verdict, so every reader of it — the Scans panel included —
    // gets the caveat along with the list rather than the list alone.
    chosen = {
      types: accepted,
      source: verified ? "probe" : "probe (unverified)",
      aiLooking: [],
    };
  }

  say(`Inventory will query types (${chosen.source}): ${chosen.types.join(", ")}.`);
  try {
    cache.put(AI_TYPES_CACHE_KEY, JSON.stringify(chosen), 21_600);
  } catch {
    /* cache is an optimization */
  }
  // Written even on the diagnostic path: a live resolution is the freshest answer there is,
  // and the diagnostic having just paid for it is a reason to keep it, not to discard it.
  writeStoredAiTypes(chosen, now);
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
 * Whether re-asking at a smaller page size could plausibly change the answer.
 *
 * This used to be "anything that is not a 4xx", which retried three failures a smaller page
 * cannot fix — and each retry is a fresh gqlPost, i.e. up to four more POSTs on top of the
 * four the first attempt already burned:
 *
 *   - `HTTP 429` after retries. The tenant is rate-limiting us; asking again for less of the
 *     same thing spends four more POSTs into the same throttle. This is the amplification
 *     that turns one throttled page into eight requests.
 *   - `Wiz response carried no data` — an HTTP-200 errors-only envelope. That is a semantic
 *     verdict about the DOCUMENT (a rejected enum value, an unknown field), and it is the
 *     second form `isInvalidEnumValueError` matches, so every 200-shaped rejection during
 *     per-candidate type probing was costing two calls instead of one.
 *   - `Wiz response carried no <field> connection` — a shape mismatch. Same reasoning.
 *
 * What IS worth a smaller retry: a gateway 5xx (a 504 on a page too heavy to assemble in
 * time is exactly the failure the fallback exists for) and anything that is not a
 * WizQueryError at all — a UrlFetchApp transport error or timeout, or a parse failure on a
 * truncated body. Those are the "the response was too big / took too long" bucket.
 *
 * A 4xx stays rethrown, as before: the schema saying no does not become yes at 50 rows.
 */
export function smallerPageCouldHelp(e: unknown): boolean {
  if (!(e instanceof WizQueryError)) return true; // transport / timeout / parse
  const m = e.message;
  if (/HTTP 4\d\d/.test(m)) return false; // schema said no
  if (/HTTP 429/.test(m)) return false; // rate limited, not oversized
  if (/carried no data/.test(m)) return false; // GraphQL error envelope
  if (/carried no .* connection/.test(m)) return false; // shape mismatch
  return true; // 5xx after retries, and anything else unrecognized
}

/**
 * Read one page from a top-level connection.
 *
 * The size fallback is the point: a tenant that could not assemble the requested page size
 * gets one retry at the smaller size. See smallerPageCouldHelp for which failures qualify —
 * the ones that cannot be fixed by asking for less are rethrown untouched rather than
 * doubling their cost.
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
  const first = o.first ?? PAGE_SIZE;
  try {
    return run(first);
  } catch (e) {
    if (!smallerPageCouldHelp(e)) throw e;
    // Already at or below the fallback: a second identical ask buys nothing.
    if (first <= PAGE_SIZE_FALLBACK) throw e;
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

/**
 * A top-level field returning ONE OBJECT rather than a connection: securityFramework(id:).
 *
 * Deliberately not routed through fetchPage. Two reasons, and both are correctness rather
 * than tidiness:
 *
 *   1. fetchPage injects `first` and `after` unconditionally. This operation declares
 *      neither, and a strict server rejects undeclared variables.
 *   2. readConnection on a non-connection does NOT throw — it finds no `nodes`, returns
 *      `rows: []`, and reports success. On an `optional: true` step (which every posture
 *      step is, so one framework a tenant lacks cannot fail the battery) that is
 *      indistinguishable from "this framework scored nothing", and would fail silently
 *      and permanently. So a missing object is an ERROR here, stated as one.
 *
 * The single object is returned as a one-row page so every step shares one `PageResult`
 * shape and one `normalize(rows)` signature.
 */
export function fetchSingleObject(field: string, o: FetchOptions): PageResult {
  const obj = gqlPost(o.query, { ...(o.extraVariables ?? {}) })[field];
  if (!obj || typeof obj !== "object") {
    throw new WizQueryError(`Wiz response carried no ${field} object.`);
  }
  return { rows: [obj as Rec], hasNextPage: false, endCursor: null, totalCount: 1 };
}

