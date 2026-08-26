// Script Properties access: secrets and resource IDs, set once by setup() (or by hand
// in the GAS editor) and read everywhere else.

export const PROP_KEYS = {
  wizApiToken: "WIZ_API_TOKEN",
  wizClientId: "WIZ_CLIENT_ID",
  wizClientSecret: "WIZ_CLIENT_SECRET",
  wizAuthUrl: "WIZ_AUTH_URL",
  wizApiUrl: "WIZ_API_URL",
  wizProjectIdV2: "WIZ_PROJECT_ID_V2",
  wizSupportGroupTagKey: "WIZ_SUPPORT_GROUP_TAG_KEY",
  wizDomainTagKey: "WIZ_DOMAIN_TAG_KEY",
  // Who may use the web app, on top of the deployment's domain fence. Comma-, semicolon- or
  // whitespace-separated addresses; see access.ts. UNSET MEANS OWNER-ONLY, not "everyone" —
  // the guard fails closed, and the owner is allowed by identity rather than by this list.
  allowedUsers: "ALLOWED_USERS",
  // Who may EDIT the list above from Settings → Access, on top of the owner (who always may).
  // Unset means owner-only, like its sibling. Admins are allowed into the app by being admins,
  // and deliberately CANNOT edit this property — see access.ts for why the tier stops here.
  allowedAdmins: "ALLOWED_ADMINS",
  ledgerSpreadsheetId: "LEDGER_SPREADSHEET_ID",
  archiveFolderId: "ARCHIVE_FOLDER_ID",
  // The warm schedule setup() last installed. A ClockTrigger exposes no hour, minute or
  // timezone, so this is the only way a later edit to the schedule can be detected and
  // reconciled rather than silently ignored on an existing deployment.
  warmTriggerSchedule: "WARM_TRIGGER_SCHEDULE",
} as const;

export const DEFAULT_WIZ_AUTH_URL = "https://auth.app.wiz.io/oauth/token";

// The subscription tag whose value is the Support Group (e.g. "CS-SUPPLY-MONITORING").
// Overridable via the WIZ_SUPPORT_GROUP_TAG_KEY Script Property.
export const DEFAULT_SUPPORT_GROUP_TAG_KEY = "Wiz/provisioning";

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
