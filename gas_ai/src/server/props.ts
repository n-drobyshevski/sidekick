// Script Properties access: secrets and resource IDs, set once by setup() (or by hand
// in the GAS editor) and read everywhere else. Property names match the OS-vulns tool
// on purpose — this is a separate Apps Script project, so there is no collision, and
// operators only learn one vocabulary.

import { resolveDomainTagKey } from "../domain/domainTag";

export const PROP_KEYS = {
  wizApiToken: "WIZ_API_TOKEN",
  wizClientId: "WIZ_CLIENT_ID",
  wizClientSecret: "WIZ_CLIENT_SECRET",
  wizAuthUrl: "WIZ_AUTH_URL",
  wizApiUrl: "WIZ_API_URL",
  wizProjectIdV2: "WIZ_PROJECT_ID_V2",
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
  // Optional comma-separated override of the AI resource-type enum values to
  // query (e.g. "AI_AGENT,AI_MODEL") for tenants whose schema names differ.
  wizAiResourceTypes: "WIZ_AI_RESOURCE_TYPES",
  // The DERIVED resolution, written by resolveAiResourceTypes — never by an operator.
  // Deliberately a different key from the override above: one is an instruction and the
  // other is a memo, and conflating them would let a cached answer masquerade as a
  // configured one (and survive the operator clearing the override).
  wizAiResourceTypesResolved: "WIZ_AI_RESOURCE_TYPES_RESOLVED",
  // Optional override of the resource tag key naming the owning business domain.
  // Defaults to `Wiz/Domain` (domain/domainTag.ts) and is matched case-insensitively, so
  // this only needs setting by a tenant that spells the key differently rather than
  // merely differently-cased. Mirrors WIZ_SUPPORT_GROUP_TAG_KEY in the OS-vulns tool.
  wizDomainTagKey: "WIZ_DOMAIN_TAG_KEY",
  // The warm schedule setup() last installed, as a signature string. A ClockTrigger exposes
  // its handler and nothing else, so this is the ONLY way to tell a correctly-scheduled set
  // from one an older deployment left behind. Written by setup(), read by setup().
  warmTriggerSchedule: "WARM_TRIGGER_SCHEDULE",
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
 * The tag key naming a resource's owning business domain — the configured override, else
 * the default. The single source of truth for the read-time fold and for the Settings
 * page's account of what it is reading, so the two cannot drift.
 */
export function domainTagKey(): string {
  return resolveDomainTagKey(getProp(PROP_KEYS.wizDomainTagKey));
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
