// Pure settings semantics — the logic of wiz_dashboard/data/settings.py without the
// file I/O. server/settingsStore.ts persists the dict to the settings tab.

import {
  API_SEVERITY_VALUES,
  COLD_AFTER_DAYS_MAX,
  COLD_AFTER_DAYS_MIN,
  COLD_FLOOR_DAYS_MAX,
  COLD_FLOOR_DAYS_MIN,
  COLD_TARGET_SHARE_PCT_MAX,
  COLD_TARGET_SHARE_PCT_MIN,
  COLD_ZONE_MODES,
  DEFAULT_COLD_AFTER_DAYS,
  DEFAULT_COLD_FLOOR_DAYS,
  DEFAULT_COLD_TARGET_SHARE_PCT,
  DEFAULT_COLD_ZONE_MODE,
  DEFAULT_DISPLAY_SEVERITIES,
  DEFAULT_FETCH_SEVERITIES,
  DEFAULT_RETENTION_DAYS,
  RETENTION_MIN_DAYS,
  SELECTABLE_SEVERITIES,
  SEVERITY_ORDER,
  type ColdZoneMode,
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

// --------------------------------------------------------------------------- cold zone

/**
 * A real, finite number or nothing — the guard every cold-zone cleaner below starts from.
 *
 * REFUSES BEFORE IT CASTS, which is the whole point: `Number(null)` is 0, `Number("")` is 0,
 * `Number(false)` is 0 and `Number([])` is 0, so a cast-first reading would turn four
 * different kinds of "no value stored" into the smallest legal window this register has. A
 * genuine number has to be finite, and a genuine string has to be non-blank and parse.
 */
function numericOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The cold-zone window in days, coerced into `[COLD_AFTER_DAYS_MIN, COLD_AFTER_DAYS_MAX]`.
 *
 * A TWO-WAY SPLIT, and the split is the point. Junk — anything that is not a number at all —
 * falls back to `DEFAULT_COLD_AFTER_DAYS`, because nothing was chosen. A REAL number outside
 * the range is CLAMPED rather than defaulted: an operator who typed 3 asked for the shortest
 * window this register offers, not for 90, and one who typed 400 asked for the longest.
 * Throwing either answer away and silently restoring the default would tell them nothing and
 * lose what they meant. Same distinction `getRetentionDays` above draws between unreadable
 * and merely too small.
 *
 * BOUNDED AT BOTH ENDS, unlike retention's one-sided floor. The floor stops the buckets
 * (thirds of this number — `domain/coldZone.ts`) collapsing into noise and stops a window
 * shorter than the gap between two syncs calling every asset cold the moment it is saved. The
 * ceiling stops a window longer than this register has been watching, which would leave the
 * block permanently unmeasurable while looking configured. Both bounds and their reasons live
 * in `config.ts` beside the constants.
 */
export function getColdAfterDays(settings: Rec): number {
  const n = numericOrNull(settings["cold_after_days"]);
  if (n === null) return DEFAULT_COLD_AFTER_DAYS;
  return Math.min(COLD_AFTER_DAYS_MAX, Math.max(COLD_AFTER_DAYS_MIN, Math.floor(n)));
}

export function withColdAfterDays(settings: Rec, days: unknown): Rec {
  return { ...settings, cold_after_days: getColdAfterDays({ cold_after_days: days }) };
}

/**
 * The cold-zone MODE, one of `COLD_ZONE_MODES`, falling back to `DEFAULT_COLD_ZONE_MODE`.
 *
 * A FALLBACK, NOT A CLAMP — the one way this differs from the three numeric readers around
 * it. A number outside a range still points at an end of that range, so clamping keeps what
 * the operator meant; there is no nearest legal value for `"warm"` in a two-member set, so
 * the only honest reading of an unrecognized string is "nothing was chosen".
 *
 * REFUSES ANYTHING THAT IS NOT ALREADY A STRING, BEFORE ANY CAST. `String(null)` is `"null"`,
 * `String(undefined)` is `"undefined"` and `String({})` is `"[object Object]"` — none of those
 * is in `COLD_ZONE_MODES`, so a cast-first version would happen to work today and stop working
 * the day somebody names a mode `"null"`. A genuine string is trimmed and lowercased first, so
 * `" RELATIVE "` from a hand-edited settings cell is the mode it plainly means.
 */
export function getColdZoneMode(settings: Rec): ColdZoneMode {
  const v = settings["cold_zone_mode"];
  if (typeof v !== "string") return DEFAULT_COLD_ZONE_MODE;
  const m = v.trim().toLowerCase();
  return (COLD_ZONE_MODES as readonly string[]).includes(m)
    ? (m as ColdZoneMode)
    : DEFAULT_COLD_ZONE_MODE;
}

export function withColdZoneMode(settings: Rec, mode: unknown): Rec {
  return { ...settings, cold_zone_mode: getColdZoneMode({ cold_zone_mode: mode }) };
}

/**
 * The relative mode's target share in per cent, coerced into `[COLD_TARGET_SHARE_PCT_MIN,
 * COLD_TARGET_SHARE_PCT_MAX]`. `getColdAfterDays`'s split, unchanged: junk falls back to the
 * default, a REAL number outside the range is CLAMPED, because an operator who typed 80 asked
 * for the widest zone this register offers, not for 20.
 */
export function getColdTargetSharePct(settings: Rec): number {
  const n = numericOrNull(settings["cold_target_share_pct"]);
  if (n === null) return DEFAULT_COLD_TARGET_SHARE_PCT;
  return Math.min(COLD_TARGET_SHARE_PCT_MAX, Math.max(COLD_TARGET_SHARE_PCT_MIN, Math.floor(n)));
}

export function withColdTargetSharePct(settings: Rec, pct: unknown): Rec {
  return {
    ...settings,
    cold_target_share_pct: getColdTargetSharePct({ cold_target_share_pct: pct }),
  };
}

/**
 * The relative mode's floor in days, coerced into `[COLD_FLOOR_DAYS_MIN, COLD_FLOOR_DAYS_MAX]`.
 * The same split for the third time, and deliberately a third function rather than one
 * parameterised helper: each of these three carries its own bounds, its own default and its own
 * reason, and a shared `clampOrDefault(v, lo, hi, d)` would move all three of those out of the
 * place where they can be read beside the field they govern.
 */
export function getColdFloorDays(settings: Rec): number {
  const n = numericOrNull(settings["cold_floor_days"]);
  if (n === null) return DEFAULT_COLD_FLOOR_DAYS;
  return Math.min(COLD_FLOOR_DAYS_MAX, Math.max(COLD_FLOOR_DAYS_MIN, Math.floor(n)));
}

export function withColdFloorDays(settings: Rec, days: unknown): Rec {
  return { ...settings, cold_floor_days: getColdFloorDays({ cold_floor_days: days }) };
}

/** Everything `coldZoneProfile` needs to draw the line, read off one settings dict. */
export interface EffectiveColdZone {
  mode: ColdZoneMode;
  coldAfterDays: number;
  targetSharePct: number;
  floorDays: number;
}

/**
 * THE ONE DOOR between a stored settings dict and `domain/coldZone.ts`.
 *
 * WHY ONE FUNCTION AND NOT FOUR READS. `coldZoneProfile` does not merely prefer its options to
 * arrive together — it REFUSES a `relative` mode whose `targetSharePct` or `floorDays` is
 * missing or out of range, by design (there is no default for them inside the profile, because
 * a share the caller never named is not a share). Any caller that reads the mode from one place
 * and the two numbers from another therefore has a live way to hand the profile a relative mode
 * with nothing to aim at, and the failure is not a wrong figure — it is the Cold zone page
 * refusing to draw. Routing all four through here makes that combination unconstructible: the
 * mode is always accompanied.
 *
 * Each field goes through the exact reader above, so the figure a page publishes and the figure
 * the settings row displays can never disagree, and a settings dict that is missing every one
 * of the four keys (a hand-built fixture, a partial mock, a fresh register) comes back as the
 * four shared defaults rather than as `undefined`s the profile refuses.
 */
export function effectiveColdZoneSettings(settings: Rec | null | undefined): EffectiveColdZone {
  const s = settings ?? {};
  return {
    mode: getColdZoneMode(s),
    coldAfterDays: getColdAfterDays(s),
    targetSharePct: getColdTargetSharePct(s),
    floorDays: getColdFloorDays(s),
  };
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
  // The four cold-zone fields. Each goes through its own `with…`, so junk lands on the
  // default and a real out-of-range number is clamped — the split the readers above document —
  // and a patch that names only one of the four leaves the other three alone.
  if ("coldZoneMode" in patch) d = withColdZoneMode(d, patch["coldZoneMode"]);
  if ("coldAfterDays" in patch) d = withColdAfterDays(d, patch["coldAfterDays"]);
  if ("coldTargetSharePct" in patch) d = withColdTargetSharePct(d, patch["coldTargetSharePct"]);
  if ("coldFloorDays" in patch) d = withColdFloorDays(d, patch["coldFloorDays"]);
  return d;
}
