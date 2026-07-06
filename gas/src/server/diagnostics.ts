// One-shot Wiz connectivity check, run by hand from the Apps Script editor
// (`wizDiagnostic`). It exercises the SAME getToken + queryPage the scan uses — so it
// validates the real path — and prints a secret-safe report of exactly which step
// fails and why. Nothing here is called during a normal scan.

import {
  DEFAULT_WIZ_AUTH_URL,
  getProp,
  PROP_KEYS,
  resolveWizAuthMode,
} from "./props";
import { buildVariables, getToken, queryPage } from "./wizClient";

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

/**
 * Validate the Wiz auth + query path and return a human-readable report (also logged
 * line-by-line to the execution log). Safe to run anytime; makes at most one token
 * request and one 1-row query. Never prints the client secret or a full token.
 */
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

  log("=== Wiz diagnostic ===");
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
  let bearer = "";
  try {
    bearer = getToken(true);
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

  // Step 2 — a minimal 1-row query, exercising the real request path.
  try {
    const page = queryPage(buildVariables({ first: 1 }));
    log(`Step 2 OK: query succeeded — ${page.nodes.length} finding(s) on page 1.`);
    log("=== All checks passed. Live scans should work. ===");
  } catch (e) {
    const msg = (e as Error).message;
    log(`Step 2 FAIL: the query was rejected — ${msg}`);
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
    } else {
      log(
        "→ If the body names a field (e.g. \"Cannot query field\"), the service account " +
          "lacks permission for it or the tenant schema differs.",
      );
    }
    return lines.join("\n");
  }

  return lines.join("\n");
}
