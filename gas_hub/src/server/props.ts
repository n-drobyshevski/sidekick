// Script Properties access: the access roster and the three sibling URLs, set by hand in
// the GAS editor (Project Settings > Script Properties) and read everywhere else.
//
// TRIMMED FROM gas_devsecops/src/server/props.ts. Every Wiz key and every storage key is
// gone with the code that read them — this app has no tenant, no ledger spreadsheet and no
// archive folder, so `hasWizCredentials()`, `projectScope()` and `resolveWizAuthMode()` had
// nothing left to answer. What remains is the four accessors and a PROP_KEYS table with
// exactly the five keys this app reads.
//
// THE THREE URL KEYS ARE PROPERTIES RATHER THAN CODE, and that is the platform's doing, not
// a preference. `ScriptApp.getService().getUrl()` answers for THIS deployment only, and has
// flipped between /dev and /exec across runtime changes, so a hub cannot derive a sibling's
// address; someone has to paste it. A property is where an operator can paste one without a
// redeploy. An unset key is legal and means "not configured" — see urls.ts, which owns the
// shape of the values and refuses anything that is not a script.google.com URL.

export const PROP_KEYS = {
  // Who may open the web app, on top of the deployment's own "anyone within <domain>" fence.
  // Comma/semicolon/whitespace-separated addresses; see server/access.ts. Unset means nobody —
  // the guard fails closed, and the owner is allowed by identity rather than by this list.
  allowedUsers: "ALLOWED_USERS",
  // Who may EDIT that list. Owner-only to change; see the admin-tier note in access.ts.
  // Unset means owner-only, like its sibling. Admins are allowed into the app by being admins,
  // not by also appearing in ALLOWED_USERS.
  allowedAdmins: "ALLOWED_ADMINS",
  // The /exec URL of each sibling web app, pasted from its Deploy > Manage deployments.
  // Unset (or blank) renders that tile as "not configured" rather than as a broken link.
  urlOs: "URL_OS",
  urlAi: "URL_AI",
  urlDevsecops: "URL_DEVSECOPS",
} as const;

export function getProp(key: string): string | null {
  return PropertiesService.getScriptProperties().getProperty(key);
}

export function requireProp(key: string): string {
  const v = getProp(key);
  if (!v) {
    throw new Error(`Missing Script Property ${key} — set it in ` +
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
