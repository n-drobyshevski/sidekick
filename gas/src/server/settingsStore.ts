// Settings persistence on the `settings` tab (key / value_json rows). The semantics
// live in domain/settingsLogic.ts; this layer only loads/saves the settings dict.

import type { RiskRule } from "../domain/program";
import * as logic from "../domain/settingsLogic";
import type { Rec } from "../domain/util";
import { bumpDataVersion, dataVersion } from "./serverCache";
import { ensureTab, readAll, overwrite, TABS } from "./sheetsDb";

// Per-execution memo: every settings getter below funnels through loadSettings(),
// so without it a single request re-reads the settings tab once per getter. Module
// state dies with the GAS execution, so this can never serve cross-request data.
let settingsMemo: Rec | undefined;

// ACROSS EXECUTIONS TOO, in CacheService. Measured in production: reading this seven-row tab
// cost 0.8–1 s in every execution that touched a setting — which is nearly every RPC — and
// 7.1 s in a doGet that was the first thing to open the spreadsheet. A CacheService read is
// tens of milliseconds, and a warm doGet then never opens the spreadsheet at all.
//
// KEYED ON THE DATA VERSION, which is what makes it safe: `saveSettings` is the only writer of
// the tab and it bumps the version, so a save moves every reader to a new key — and it writes
// the new dict under that key itself, so the next request does not pay the sheet either. The
// TTL only bounds the one path the version cannot see: someone editing the tab by hand in
// Sheets, which is picked up at the next scan or settings save (both bump the version), or at
// the latest when CacheService's six-hour maximum runs out.
//
// SIX HOURS, NOT TEN MINUTES. Ten was the first value shipped, and production showed what it
// cost: once every ten minutes some execution re-read the tab — 2.1 s of a 3.4 s warm Executive
// load — to guard against an edit nobody makes through the sheet.
const SETTINGS_CACHE_TTL_SEC = 21_600;
// A CacheService value is capped at 100 KB. A dict still carrying the legacy single-cell
// support-group map can exceed that; it is simply not cached, and reads fall back to the tab.
const SETTINGS_CACHE_MAX_CHARS = 90_000;

function settingsCacheKey(): string {
  return "settings1:" + dataVersion();
}

function readSettingsCache(): Rec | undefined {
  try {
    const raw = CacheService.getScriptCache().get(settingsCacheKey());
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Rec) : undefined;
  } catch (e) {
    console.warn(`Settings cache read failed: ${e}`);
    return undefined;
  }
}

function writeSettingsCache(settings: Rec): void {
  try {
    const json = JSON.stringify(settings);
    if (json.length > SETTINGS_CACHE_MAX_CHARS) return;
    CacheService.getScriptCache().put(settingsCacheKey(), json, SETTINGS_CACHE_TTL_SEC);
  } catch (e) {
    console.warn(`Settings cache write failed: ${e}`);
  }
}

export function loadSettings(): Rec {
  if (settingsMemo !== undefined) return settingsMemo;
  const hit = readSettingsCache();
  if (hit) {
    settingsMemo = hit;
    return hit;
  }
  const out: Rec = {};
  for (const row of readAll(TABS.settings)) {
    const key = row["key"];
    const raw = row["value_json"];
    if (typeof key !== "string" || !key) continue;
    if (typeof raw !== "string" || raw === "") {
      out[key] = null;
      continue;
    }
    try {
      out[key] = JSON.parse(raw);
    } catch {
      console.warn(`Unreadable settings value for ${key}; ignoring`);
    }
  }
  settingsMemo = out;
  writeSettingsCache(out);
  return out;
}

export function saveSettings(settings: Rec): void {
  overwrite(
    TABS.settings,
    Object.entries(settings).map(([key, value]) => ({
      key,
      value_json: JSON.stringify(value ?? null),
    })),
  );
  settingsMemo = settings;
  // Settings feed the cached bootstrap payload and _domain assignment.
  bumpDataVersion();
  // Under the NEW version's key, so the next request reads the saved dict from the cache.
  writeSettingsCache(settings);
}

export const getFetchSeverities = (): string[] => logic.getFetchSeverities(loadSettings());
export const getDisplaySeverities = (): string[] => logic.getDisplaySeverities(loadSettings());
export const getRetentionDays = (): number | null => logic.getRetentionDays(loadSettings());
export const getAutoCompact = (): boolean => logic.getAutoCompact(loadSettings());
export const getShowNoFix = (): boolean => logic.getShowNoFix(loadSettings());
export const getIncludeEol = (): boolean => logic.getIncludeEol(loadSettings());
export const getRiskRule = (): { version: number; rule: RiskRule } =>
  logic.getRiskRule(loadSettings());
export const getDomains = (): { version: number; items: Rec[] } =>
  logic.getDomains(loadSettings());
/**
 * The cold-zone settings in force, as ONE object — the single door between the settings tab
 * and `domain/coldZone.ts` (see `logic.effectiveColdZoneSettings` for why the four fields may
 * never be read apart). Memoized only insofar as `loadSettings()` is: the read is one hash
 * lookup per field off the per-execution settings memo, so the sibling getters' shape applies
 * unchanged and there is nothing here worth a second cache.
 */
export const getColdZone = (): logic.EffectiveColdZone =>
  logic.effectiveColdZoneSettings(loadSettings());
// The subscription-identity → support-group map lives in its own tab (one row per token),
// not a single settings cell — a large map overflows the ~50k-char Sheets cell limit and the
// write throws, which is why a big-tenant refresh failed and the map never persisted. Memoized
// per execution like loadSettings (attachSupportGroups reads it several times per request).
let sgMapMemo: Record<string, string> | undefined;

/** token → group rows, dropping any malformed pair. Pure (testable without the sheet). */
export function supportGroupRowsToMap(rows: Rec[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of rows) {
    const token = r["token"];
    const group = r["group"];
    if (typeof token === "string" && token && typeof group === "string" && group) {
      map[token] = group;
    }
  }
  return map;
}

/** map → token/group rows, dropping any malformed pair. Pure (testable without the sheet). */
export function supportGroupMapToRows(map: unknown): Rec[] {
  const rows: Rec[] = [];
  if (map && typeof map === "object" && !Array.isArray(map)) {
    for (const [token, group] of Object.entries(map as Rec)) {
      if (typeof token === "string" && token && typeof group === "string" && group) {
        rows.push({ token, group });
      }
    }
  }
  return rows;
}

export function getSupportGroupMap(): { version: number; map: Record<string, string> } {
  if (sgMapMemo !== undefined) return { version: 0, map: sgMapMemo };
  ensureTab(TABS.supportGroupMap);
  const rows = readAll(TABS.supportGroupMap);
  // Legacy fallback: a small map that still lives in the old single settings cell (pre-tab
  // deployments whose map fit). The next refresh rewrites it into the tab.
  const map = rows.length ? supportGroupRowsToMap(rows) : logic.getSupportGroupMap(loadSettings()).map;
  sgMapMemo = map;
  return { version: 0, map };
}

export function setFetchSeverities(sevs: unknown): void {
  saveSettings(logic.withFetchSeverities(loadSettings(), sevs));
}
export function setDisplaySeverities(sevs: unknown): void {
  saveSettings(logic.withDisplaySeverities(loadSettings(), sevs));
}
export function setRetentionDays(days: number | null): void {
  saveSettings(logic.withRetentionDays(loadSettings(), days));
}
export function setAutoCompact(enabled: boolean): void {
  saveSettings(logic.withAutoCompact(loadSettings(), enabled));
}
export function setShowNoFix(enabled: boolean): void {
  saveSettings(logic.withShowNoFix(loadSettings(), enabled));
}
export function setIncludeEol(enabled: boolean): void {
  saveSettings(logic.withIncludeEol(loadSettings(), enabled));
}
export function setRiskRule(rule: unknown): void {
  saveSettings(logic.withRiskRule(loadSettings(), rule));
}
/** Set both retention-window and auto-compact in a single load+save so the write is atomic
 *  (no partial-commit window if the client changes both at once). */
export function setRetentionAndCompact(days: number | null, enabled: boolean): void {
  saveSettings(logic.withAutoCompact(logic.withRetentionDays(loadSettings(), days), enabled));
}
/**
 * Apply several register settings in ONE load+save, for the Settings page's single save bar.
 *
 * Generalises setRetentionAndCompact for the same reason it exists: a page that batches every
 * edit into one action must commit them in one write, or a failure halfway leaves the register
 * in a state the reader never asked for and the toast never mentioned.
 *
 * Only the keys present in `patch` are touched — a field the reader did not edit is not
 * rewritten with its own value, so a concurrent change elsewhere is not silently reverted.
 * Unknown keys are ignored rather than trusted.
 *
 * ORDER IS LOAD-BEARING. `withFetchSeverities` re-clamps the display scope to the new scan
 * scope, so fetch must be applied before display; the reverse order would clamp the display
 * list against the OLD scan scope and then quietly widen the scan scope past it.
 */
export function setMany(patch: Rec): void {
  saveSettings(logic.applySettingsPatch(loadSettings(), patch));
}

export function setDomains(items: unknown): void {
  saveSettings(logic.withDomains(loadSettings(), items));
}
export function setSupportGroupMap(map: unknown): void {
  const rows = supportGroupMapToRows(map);
  ensureTab(TABS.supportGroupMap);
  overwrite(TABS.supportGroupMap, rows);
  sgMapMemo = supportGroupRowsToMap(rows);
  // Drop any legacy single-cell map so a later settings save can't re-hit the cell ceiling by
  // re-serializing the big blob. saveSettings bumps DATA_VERSION; otherwise bump it directly so
  // every cached support-group-dependent view repaints with the new mapping.
  const settings = loadSettings();
  if ("support_group_map" in settings) {
    const cleaned = { ...settings };
    delete cleaned["support_group_map"];
    saveSettings(cleaned);
  } else {
    bumpDataVersion();
  }
}
