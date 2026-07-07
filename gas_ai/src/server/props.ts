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
