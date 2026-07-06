// Script Properties access: secrets and resource IDs, set once by setup() (or by hand
// in the GAS editor) and read everywhere else.

export const PROP_KEYS = {
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

/** Whether live Wiz credentials are configured (else the app is dry-run only). */
export function hasWizCredentials(): boolean {
  return Boolean(getProp(PROP_KEYS.wizClientId) && getProp(PROP_KEYS.wizClientSecret) &&
    getProp(PROP_KEYS.wizApiUrl));
}
