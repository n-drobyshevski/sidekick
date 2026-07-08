// Script Properties access: secrets and resource IDs, set once by setup() (or by hand
// in the GAS editor) and read everywhere else. Property names match the OS-vulns tool
// on purpose — this is a separate Apps Script project, so there is no collision, and
// operators only learn one vocabulary.

export const PROP_KEYS = {
  wizApiToken: "WIZ_API_TOKEN",
  wizClientId: "WIZ_CLIENT_ID",
  wizClientSecret: "WIZ_CLIENT_SECRET",
  wizAuthUrl: "WIZ_AUTH_URL",
  wizApiUrl: "WIZ_API_URL",
  wizProjectIdV2: "WIZ_PROJECT_ID_V2",
  ledgerSpreadsheetId: "LEDGER_SPREADSHEET_ID",
  archiveFolderId: "ARCHIVE_FOLDER_ID",
  // Optional comma-separated override of the AI resource-type enum values to
  // query (e.g. "AI_AGENT,AI_MODEL") for tenants whose schema names differ.
  wizAiResourceTypes: "WIZ_AI_RESOURCE_TYPES",
} as const;

export const DEFAULT_WIZ_AUTH_URL = "https://auth.app.wiz.io/oauth/token";

export function getProp(key: string): string | null {
  return PropertiesService.getScriptProperties().getProperty(key);
}

export function requireProp(key: string): string {
  const v = getProp(key);
  if (!v) {
    throw new Error(`Missing Script Property ${key} — run setup() or set it in ` +
      `Project Settings > Script Properties.`);
  }
  return v;
}

export function setProp(key: string, value: string): void {
  PropertiesService.getScriptProperties().setProperty(key, value);
}

export function deleteProp(key: string): void {
  PropertiesService.getScriptProperties().deleteProperty(key);
}

/**
 * Project scope for the Wiz queries that accept a project filter, from the
 * WIZ_PROJECT_ID_V2 Script Property. Returns `[id]` when set, else `null` (query
 * every project). The four captured queries hardcode a tenant project id; routing
 * scope through this prop keeps that id out of the shipped code and lets operators
 * narrow a large tenant. Matches the diagnostics message ("unset — querying all
 * projects") and the sibling gas tool's projectIdV2 behavior.
 */
export function projectScope(): string[] | null {
  const id = getProp(PROP_KEYS.wizProjectIdV2);
  return id && id.trim() ? [id.trim()] : null;
}

/**
 * Which auth mode the configured secrets select, or null if none is usable.
 * A raw `WIZ_API_TOKEN` (used directly as a bearer token) takes precedence over the
 * `WIZ_CLIENT_ID`/`WIZ_CLIENT_SECRET` OAuth client-credentials exchange. Pure so the
 * precedence is unit-testable without GAS globals.
 */
export function resolveWizAuthMode(
  token: string | null,
  clientId: string | null,
  clientSecret: string | null,
): "token" | "oauth" | null {
  if (token && token.trim()) return "token";
  if (clientId && clientSecret) return "oauth";
  return null;
}

/** Whether live Wiz credentials are configured (else the app is dry-run only). */
export function hasWizCredentials(): boolean {
  return (
    Boolean(getProp(PROP_KEYS.wizApiUrl)) &&
    resolveWizAuthMode(
      getProp(PROP_KEYS.wizApiToken),
      getProp(PROP_KEYS.wizClientId),
      getProp(PROP_KEYS.wizClientSecret),
    ) !== null
  );
}
