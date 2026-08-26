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
import { DEFAULT_RISK_RULE, type RiskRule } from "./program";
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

/** Whether findings on an end-of-life OS are included in analysis and display. Defaults to true
 *  (included) so the register reads whole until an operator deliberately excludes them. */
export function getIncludeEol(settings: Rec): boolean {
  const val = "include_eol" in settings ? settings["include_eol"] : true;
  return typeof val === "boolean" ? val : true;
}

export function withIncludeEol(settings: Rec, enabled: boolean): Rec {
  return { ...settings, include_eol: Boolean(enabled) };
}

/**
 * The high-risk classifier rule behind coverage/efficiency, as `{version, rule}` — versioned
 * like getDomains so cached derivations key on the token and a rule edit repaints everything.
 * A stored blob is validated field by field; anything unusable falls back to the default.
 */
export function getRiskRule(settings: Rec): { version: number; rule: RiskRule } {
  const raw = settings["risk_rule"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { version: 0, rule: { ...DEFAULT_RISK_RULE } };
  }
  const r = raw as Rec;
  let version = 0;
  const v = Number(r["version"] ?? 0);
  if (Number.isFinite(v)) version = Math.max(Math.trunc(v), 0);
  const stored = r["rule"];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { version, rule: { ...DEFAULT_RISK_RULE } };
  }
  return { version, rule: cleanRiskRule(stored as Rec) };
}

/**
 * Coerce a rule blob: booleans stay booleans (defaulting to the enabled default when absent),
 * and the EPSS threshold is clamped to [0, 1].
 *
 * Deliberately NO "if the operator disabled everything, fall back to the default" rescue. An
 * all-disabled rule decides nothing, so program.classifyRisk returns `unknown` for every row
 * and the page reads "no classifier enabled — 100% unclassified". Honest state beats a
 * silent substitution the operator never asked for and cannot see (PRODUCT.md principle 5).
 */
export function cleanRiskRule(raw: Rec): RiskRule {
  const bool = (key: string): boolean => {
    const v = raw[key];
    return typeof v === "boolean" ? v : DEFAULT_RISK_RULE[key as "kev" | "exploit" | "epss"];
  };
  const t = Number(raw["epssThreshold"]);
  return {
    kev: bool("kev"),
    exploit: bool("exploit"),
    epss: bool("epss"),
    epssThreshold: Number.isFinite(t)
      ? Math.min(1, Math.max(0, t))
      : DEFAULT_RISK_RULE.epssThreshold,
  };
}

export function withRiskRule(settings: Rec, rule: unknown): Rec {
  const current = getRiskRule(settings);
  const clean = cleanRiskRule(
    rule && typeof rule === "object" && !Array.isArray(rule) ? (rule as Rec) : {},
  );
  return { ...settings, risk_rule: { version: current.version + 1, rule: clean } };
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

/**
 * Apply several register settings at once, returning the new settings dict — the pure half of
 * settingsStore.setMany, and the reason the Settings page can commit a whole screen of edits in
 * one write instead of a sequence of per-field calls that can fail halfway.
 *
 * Only the keys present in `patch` are touched, so a field the reader did not edit is not
 * rewritten with its own value and a concurrent change to it is not silently reverted. Unknown
 * keys are ignored rather than trusted onto the dict.
 *
 * ORDER IS LOAD-BEARING, and it is the whole reason this is a named function rather than a loop.
 * `withFetchSeverities` re-clamps the display scope to the new scan scope. Applying display
 * first would clamp it against the OLD scan scope and then widen the scan scope past it, so a
 * reader who adds MEDIUM to both in one edit would find MEDIUM scanned but not shown.
 */
export function applySettingsPatch(settings: Rec, patch: Rec): Rec {
  let d = settings;
  if ("fetchSeverities" in patch) d = withFetchSeverities(d, patch["fetchSeverities"]);
  if ("displaySeverities" in patch) d = withDisplaySeverities(d, patch["displaySeverities"]);
  if ("showNoFix" in patch) d = withShowNoFix(d, Boolean(patch["showNoFix"]));
  if ("includeEol" in patch) d = withIncludeEol(d, Boolean(patch["includeEol"]));
  if ("riskRule" in patch) d = withRiskRule(d, patch["riskRule"]);
  if ("retentionDays" in patch) {
    const raw = patch["retentionDays"];
    d = withRetentionDays(d, raw === null || raw === undefined ? null : Number(raw));
  }
  if ("autoCompact" in patch) d = withAutoCompact(d, Boolean(patch["autoCompact"]));
  return d;
}
