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
  // The repository tag key whose VALUE is a business domain. Unset means `domain`, the bare
  // word this tenant writes on the repository itself; a property rather than a setting because
  // it is a fact about the tenant's tagging convention, not a per-operator view preference —
  // the same tier WIZ_PROJECT_ID_V2 sits in. See domain/domainTag.ts for why it is resolved on
  // READ: a key baked into the ledger would make correcting a typo cost a full re-scan. A
  // tenant whose repositories carry the namespaced `Wiz/Domain` instead sets it here.
  wizDomainTagKey: "WIZ_DOMAIN_TAG_KEY",
  // The repository tag key whose VALUE is where that repository is in its life
  // (`END_OF_LIFE`, `IN_PRODUCTION`, …). Unset means `lifecycle`. Same tier and same reasoning
  // as the domain key above it, and the same standing of default: BOTH tags reach Wiz from the
  // tenant's own catalogue under whatever key that system already used, so both defaults are
  // GUESSES rather than facts about Wiz. That is why `repoTags.mapHealth` publishes how many
  // repositories each key actually placed, SEPARATELY — a wrong guess shows up as a zero on the
  // Settings page rather than as a quietly empty column, and the two keys can be wrong alone.
  wizLifecycleTagKey: "WIZ_LIFECYCLE_TAG_KEY",
  // The two keys the PERSISTED repository-tag map was actually built under, as
  // `{"domain":"…","lifecycle":"…"}`, written by repoTags.setRepoTagMap on every refresh.
  //
  // WHY A MAP NEEDS TO REMEMBER ITS OWN PROVENANCE. `domain_map` outlives the keys above: a
  // deployment that changes one — or takes a release that changes a DEFAULT — keeps serving
  // values fetched under the old key until somebody presses Refresh, and the Settings card
  // would print the new key over them and look perfectly healthy. That is the one picture
  // `settings.js`'s domainMapCard exists to prevent, so the card compares the two and says so.
  // Not a column on the tab: this is one fact about the whole map, not a fact per token.
  repoTagMapKeys: "REPO_TAG_MAP_KEYS",
  ledgerSpreadsheetId: "LEDGER_SPREADSHEET_ID",
  archiveFolderId: "ARCHIVE_FOLDER_ID",
  // Who may open the web app, on top of the deployment's own "anyone within <domain>" fence.
  // Comma/semicolon/whitespace-separated addresses; see server/access.ts. Unset means nobody —
  // the guard fails closed, and the owner is allowed by identity rather than by this list.
  allowedUsers: "ALLOWED_USERS",
  // Who may EDIT that list. Owner-only to change; see the admin-tier note in access.ts.
  // Unset means owner-only, like its sibling. Admins are allowed into the app by being admins,
  // not by also appearing in ALLOWED_USERS.
  allowedAdmins: "ALLOWED_ADMINS",
  // Scoped viewers: people who may open the app but see only their own domains / projects,
  // through a reduced read-only shell. JSON — `{"a@x.com":{"d":["Payments"],"p":["team-a"]}}`
  // — owned by gas_shared/domain/scopedAccess.ts. Unset or unparseable means nobody, like the
  // lists above. Edited by the owner or an admin from Settings → Access.
  scopedUsers: "SCOPED_USERS",
  // The /exec URL of the hub launcher (gas_hub), pasted from its Deploy > Manage deployments,
  // or set from Settings > System. A PROPERTY RATHER THAN CODE for the platform's reason, not
  // a preference: `ScriptApp.getService().getUrl()` answers for this deployment only and there
  // is no API that hands one script project another's web-app URL, so somebody has to paste
  // it. Unset (or blank) is legal and means the header simply carries no hub button — see
  // server/hubUrl.ts, which owns the shape of the value and refuses anything that is neither a
  // script.google.com URL nor a loopback dev-harness one.
  urlHub: "URL_HUB",
  // The warm schedule setup() last installed, as a signature string. A ClockTrigger exposes
  // its handler and nothing else, so this is the ONLY way to tell a correctly-scheduled set
  // from one an older deployment left behind. Written by setup(), read by setup().
  warmTriggerSchedule: "WARM_TRIGGER_SCHEDULE",
  /**
   * When a real token exchange plus a real query last succeeded.
   *
   * Separate from the credentials themselves because they answer different questions.
   * `hasWizCredentials()` says three strings are non-empty; this says the tenant accepted
   * them, once, at a time you can read. A Settings page that showed only the first was
   * inviting the stronger reading with nothing to support it.
   */
  wizVerifiedAt: "WIZ_VERIFIED_AT",
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
