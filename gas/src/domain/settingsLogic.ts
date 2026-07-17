// Pure settings semantics — the logic of wiz_dashboard/data/settings.py without the
// file I/O. server/settingsStore.ts persists the dict to the settings tab.

import {
  API_SEVERITY_VALUES,
  DEFAULT_DISPLAY_SEVERITIES,
  DEFAULT_FETCH_SEVERITIES,
  DEFAULT_RETENTION_DAYS,
  RETENTION_MIN_DAYS,
  SELECTABLE_SEVERITIES,
  SEVERITY_ORDER,
} from "./config";
import { normalizeSeverity } from "./severity";
import type { Rec } from "./util";

/** Normalize + validate a severity list into a canonical ordered array. */
export function canonicalSeverities(values: unknown, defaults: readonly string[]): string[] {
  if (!Array.isArray(values)) return [...defaults];
  const chosen = new Set(
    values
      .filter((v): v is string => typeof v === "string")
      .map(normalizeSeverity)
      .filter((s) => (SELECTABLE_SEVERITIES as string[]).includes(s)),
  );
  if (!chosen.size) return [...defaults];
  return SEVERITY_ORDER.filter((s) => chosen.has(s));
}

export function getFetchSeverities(settings: Rec): string[] {
  return canonicalSeverities(settings["fetch_severities"], DEFAULT_FETCH_SEVERITIES);
}

export function getDisplaySeverities(settings: Rec): string[] {
  const fetch = getFetchSeverities(settings);
  const disp = canonicalSeverities(settings["display_severities"], DEFAULT_DISPLAY_SEVERITIES);
  const clamped = disp.filter((s) => fetch.includes(s));
  return clamped.length ? clamped : fetch;
}

/** New settings dict with the fetch scope set and display re-clamped. */
export function withFetchSeverities(settings: Rec, sevs: unknown): Rec {
  const d = { ...settings };
  const fetch = canonicalSeverities(sevs, DEFAULT_FETCH_SEVERITIES);
  d["fetch_severities"] = fetch;
  const disp = canonicalSeverities(d["display_severities"], fetch);
  const clamped = disp.filter((s) => fetch.includes(s));
  d["display_severities"] = clamped.length ? clamped : [...fetch];
  return d;
}

/** New settings dict with the display scope set, clamped to the stored fetch scope. */
export function withDisplaySeverities(settings: Rec, sevs: unknown): Rec {
  const d = { ...settings };
  const fetch = canonicalSeverities(d["fetch_severities"], DEFAULT_FETCH_SEVERITIES);
  const disp = canonicalSeverities(sevs, DEFAULT_DISPLAY_SEVERITIES);
  const clamped = disp.filter((s) => fetch.includes(s));
  d["display_severities"] = clamped.length ? clamped : [...fetch];
  return d;
}

export function getRetentionDays(settings: Rec): number | null {
  const raw = "retention_days" in settings ? settings["retention_days"] : DEFAULT_RETENTION_DAYS;
  if (raw === null) return null;
  const n = typeof raw === "number" ? Math.trunc(raw) : parseInt(String(raw), 10);
  if (Number.isNaN(n)) return DEFAULT_RETENTION_DAYS;
  return Math.max(n, RETENTION_MIN_DAYS);
}

export function withRetentionDays(settings: Rec, days: number | null): Rec {
  const d = { ...settings };
  d["retention_days"] = days === null ? null : Math.max(Math.trunc(days), RETENTION_MIN_DAYS);
  return d;
}

export function getAutoCompact(settings: Rec): boolean {
  const val = "auto_compact" in settings ? settings["auto_compact"] : true;
  return typeof val === "boolean" ? val : true;
}

export function withAutoCompact(settings: Rec, enabled: boolean): Rec {
  return { ...settings, auto_compact: Boolean(enabled) };
}

export function getShowNoFix(settings: Rec): boolean {
  const val = "show_no_fix" in settings ? settings["show_no_fix"] : true;
  return typeof val === "boolean" ? val : true;
}

export function withShowNoFix(settings: Rec, enabled: boolean): Rec {
  return { ...settings, show_no_fix: Boolean(enabled) };
}

/** Structurally valid domain items only (non-dict / blank-name entries dropped). */
export function cleanDomainItems(items: unknown): Rec[] {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item): item is Rec =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as Rec)["name"] === "string" &&
      ((item as Rec)["name"] as string).trim() !== "",
  );
}

export function getDomains(settings: Rec): { version: number; items: Rec[] } {
  const raw = settings["domains"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { version: 0, items: [] };
  const r = raw as Rec;
  let version = 0;
  const v = Number(r["version"] ?? 0);
  if (Number.isFinite(v)) version = Math.max(Math.trunc(v), 0);
  return { version, items: cleanDomainItems(r["items"]) };
}

export function withDomains(settings: Rec, items: unknown): Rec {
  const current = getDomains(settings);
  return {
    ...settings,
    domains: { version: current.version + 1, items: cleanDomainItems(items) },
  };
}

/** Keep only string→non-empty-string entries (a hand-edited blob can't inject junk). */
export function cleanStringMap(map: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [k, v] of Object.entries(map as Rec)) {
    if (typeof k === "string" && k !== "" && typeof v === "string" && v !== "") {
      out[k] = v;
    }
  }
  return out;
}

/**
 * The subscription→Support Group map: `{version, map}` where map is folded identity
 * token → group value. Mirrors getDomains so caches key on the version token; a refresh
 * bumps it and every cached derivation repaints.
 */
export function getSupportGroupMap(settings: Rec): {
  version: number;
  map: Record<string, string>;
} {
  const raw = settings["support_group_map"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { version: 0, map: {} };
  const r = raw as Rec;
  let version = 0;
  const v = Number(r["version"] ?? 0);
  if (Number.isFinite(v)) version = Math.max(Math.trunc(v), 0);
  return { version, map: cleanStringMap(r["map"]) };
}

export function withSupportGroupMap(settings: Rec, map: unknown): Rec {
  const current = getSupportGroupMap(settings);
  return {
    ...settings,
    support_group_map: { version: current.version + 1, map: cleanStringMap(map) },
  };
}

/** GraphQL filterBy.severity values for a scope, or null when unscoped. */
export function apiSeverityFilter(severities: unknown): string[] | null {
  const sevs = canonicalSeverities(severities, DEFAULT_FETCH_SEVERITIES);
  if (new Set(sevs).size === SELECTABLE_SEVERITIES.length) return null;
  return sevs.map((s) => API_SEVERITY_VALUES[s]);
}
