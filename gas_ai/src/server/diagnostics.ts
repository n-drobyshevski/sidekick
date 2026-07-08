// One-shot Wiz connectivity check, run by hand from the Apps Script editor
// (`wizDiagnostic`). It exercises the SAME getToken + query path the sync uses — so
// it validates the real path — and prints a secret-safe report of exactly which step
// fails and why. Nothing here is called during a normal sync.

import {
  DEFAULT_WIZ_AUTH_URL,
  getProp,
  PROP_KEYS,
  resolveWizAuthMode,
} from "./props";
import {
  fetchCloudResourcesPage,
  fetchEnumValues,
  getToken,
  resolveAiResourceTypes,
} from "./wizClientAi";
import { aiInventoryVariables, Q_AI_INVENTORY } from "./wizQueriesAi";

/** Enum members that read as AI vocabulary (token match, so EMAIL ≠ AI). */
function aiFlavored(values: string[]): string[] {
  return values.filter((v) => {
    const tokens = v.toUpperCase().split(/[\s_]+/);
    return tokens.includes("AI") || tokens.includes("MCP") ||
      tokens.includes("GENAI") || tokens.includes("LLM");
  });
}

/** Length + first4…last4 preview of a non-secret id/token — never the whole value. */
function preview(value: string | null): string {
  if (!value || !value.trim()) return "(unset)";
  const v = value.trim();
  if (v.length <= 10) return `${v.length} chars`;
  return `${v.length} chars, ${v.slice(0, 4)}…${v.slice(-4)}`;
}

/** Secrets get only a presence + length signal — never any character of the value. */
function secretPreview(value: string | null): string {
  return value && value.trim() ? `(set, ${value.trim().length} chars)` : "(unset)";
}

export function wizDiagnostic(): string {
  const lines: string[] = [];
  const log = (m: string) => {
    lines.push(m);
    console.log(m);
  };

  const apiUrl = getProp(PROP_KEYS.wizApiUrl);
  const authUrl = getProp(PROP_KEYS.wizAuthUrl) ?? DEFAULT_WIZ_AUTH_URL;
  const token = getProp(PROP_KEYS.wizApiToken);
  const clientId = getProp(PROP_KEYS.wizClientId);
  const clientSecret = getProp(PROP_KEYS.wizClientSecret);
  const projectId = getProp(PROP_KEYS.wizProjectIdV2);
  const mode = resolveWizAuthMode(token, clientId, clientSecret);

  log("=== Wiz SIDEKICK AI diagnostic ===");
  log(`WIZ_API_URL:        ${apiUrl || "(unset!)"}`);
  log(`Auth mode:          ${mode ?? "(none)"}`);
  log(`WIZ_API_TOKEN:      ${preview(token)}`);
  log(`WIZ_CLIENT_ID:      ${preview(clientId)}`);
  log(`WIZ_CLIENT_SECRET:  ${secretPreview(clientSecret)}`);
  if (mode === "oauth") log(`WIZ_AUTH_URL:       ${authUrl}`);
  log(`WIZ_PROJECT_ID_V2:  ${projectId || "(unset — querying all projects)"}`);

  if (!apiUrl) {
    log("FAIL: WIZ_API_URL is required, e.g. https://api.<region>.app.wiz.io/graphql.");
    return lines.join("\n");
  }
  if (mode === null) {
    log(
      "FAIL: no usable credentials — the app runs in dry-run mode. Set WIZ_API_TOKEN, " +
        "or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET.",
    );
    return lines.join("\n");
  }
  // Step 1 — obtain a bearer token (raw token verbatim, or a fresh OAuth exchange).
  try {
    const bearer = getToken(true);
    log(
      mode === "token"
        ? `Step 1 OK: using raw WIZ_API_TOKEN (${preview(bearer)}).`
        : `Step 1 OK: OAuth exchange minted an access token (${preview(bearer)}).`,
    );
  } catch (e) {
    log(`Step 1 FAIL: could not obtain a token — ${(e as Error).message}`);
    log(
      mode === "oauth"
        ? "→ The token endpoint rejected the client credentials. Verify WIZ_CLIENT_ID / " +
            "WIZ_CLIENT_SECRET (regenerate the service account in Wiz), and that " +
            "WIZ_AUTH_URL matches the auth host shown on the service-account page."
        : "→ WIZ_API_TOKEN is unusable. A Wiz GraphQL service account gives a client " +
            "id + secret, not a durable token; use WIZ_CLIENT_ID / WIZ_CLIENT_SECRET.",
    );
    return lines.join("\n");
  }

  // Step 2 — schema probe: THIS tenant's vocabulary decides which AI resource
  // types the sync queries (guessing produces GRAPHQL_VALIDATION_FAILED). The
  // SAME resolver the sync uses runs here, verbosely: introspection when the
  // gateway allows it, per-candidate 1-row probing when it doesn't.
  let chosen;
  try {
    chosen = resolveAiResourceTypes(log);
    log("Step 2 OK: AI resource types resolved.");
  } catch (e) {
    log(`Step 2 FAIL: ${(e as Error).message}`);
    return lines.join("\n");
  }

  // Informational: the graph-relationship steps use the graph entity vocabulary.
  const graphEnum = fetchEnumValues("GraphEntityTypeValue");
  if (graphEnum) {
    log(
      `Graph entity types: ${graphEnum.length} members; AI-flavored: ` +
        `${aiFlavored(graphEnum).join(", ") || "(none — graph relationship steps will be skipped)"}.`,
    );
  } else {
    log(
      "Graph entity introspection unavailable — graph relationship steps will be " +
        "skipped automatically if this tenant rejects their queries.",
    );
  }

  // Step 3 — a minimal 1-row inventory query, exercising the real request path
  // with the types resolved above (filter passed as the $filterBy variable,
  // mirroring the captured working request).
  try {
    const page = fetchCloudResourcesPage({
      query: Q_AI_INVENTORY,
      first: 1,
      extraVariables: aiInventoryVariables(chosen.types),
    });
    log(
      `Step 3 OK: query succeeded — ${page.rows.length} AI asset(s) on page 1` +
        (page.totalCount !== null ? ` of ${page.totalCount} total` : "") + ".",
    );
    log("=== All checks passed. Live syncs should work. ===");
  } catch (e) {
    const msg = (e as Error).message;
    log(`Step 3 FAIL: the query was rejected — ${msg}`);
    if (/HTTP 401|HTTP 403|Unauthorized/i.test(msg)) {
      log(
        "→ 401/403/Unauthorized: the token was not accepted (expired, invalid, or minted " +
          "for a different tenant). Confirm the service account targets this tenant.",
      );
    } else if (/HTTP 404/i.test(msg)) {
      log(
        "→ 404: WIZ_API_URL host/path is wrong — it must be " +
          "https://api.<region>.app.wiz.io/graphql for your tenant's region.",
      );
    } else if (/cannot represent value/i.test(msg)) {
      log(
        "→ The tenant rejected one of the resolved type values. Set the " +
          "WIZ_AI_RESOURCE_TYPES Script Property to the exact enum values your tenant " +
          "accepts (comma-separated) and rerun this diagnostic.",
      );
    } else {
      log(
        "→ If the body names a field (e.g. \"Cannot query field\"), the service account " +
          "lacks permission for it or the tenant schema differs — capture the response " +
          "into ai/queries/reponse_schemas/ and reconcile the normalizers.",
      );
    }
    return lines.join("\n");
  }

  return lines.join("\n");
}
