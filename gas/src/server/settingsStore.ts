// Settings persistence on the `settings` tab (key / value_json rows). The semantics
// live in domain/settingsLogic.ts; this layer only loads/saves the settings dict.

import * as logic from "../domain/settingsLogic";
import type { Rec } from "../domain/util";
import { bumpDataVersion } from "./serverCache";
import { ensureTab, readAll, overwrite, TABS } from "./sheetsDb";

// Per-execution memo: every settings getter below funnels through loadSettings(),
// so without it a single request re-reads the settings tab once per getter. Module
// state dies with the GAS execution, so this can never serve cross-request data.
let settingsMemo: Rec | undefined;

export function loadSettings(): Rec {
  if (settingsMemo !== undefined) return settingsMemo;
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
}

export const getFetchSeverities = (): string[] => logic.getFetchSeverities(loadSettings());
export const getDisplaySeverities = (): string[] => logic.getDisplaySeverities(loadSettings());
export const getRetentionDays = (): number | null => logic.getRetentionDays(loadSettings());
export const getAutoCompact = (): boolean => logic.getAutoCompact(loadSettings());
export const getShowNoFix = (): boolean => logic.getShowNoFix(loadSettings());
export const getIncludeEol = (): boolean => logic.getIncludeEol(loadSettings());
export const getDomains = (): { version: number; items: Rec[] } =>
  logic.getDomains(loadSettings());
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
/** Set both retention-window and auto-compact in a single load+save so the write is atomic
 *  (no partial-commit window if the client changes both at once). */
export function setRetentionAndCompact(days: number | null, enabled: boolean): void {
  saveSettings(logic.withAutoCompact(logic.withRetentionDays(loadSettings(), days), enabled));
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
