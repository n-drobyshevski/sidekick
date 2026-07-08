// Settings persistence on the `settings` tab (key / value_json rows). The semantics
// live in domain/settingsLogic.ts; this layer only loads/saves the settings dict.

import * as logic from "../domain/settingsLogic";
import type { Rec } from "../domain/util";
import { bumpDataVersion } from "./serverCache";
import { readAll, overwrite, TABS } from "./sheetsDb";

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
export const getDomains = (): { version: number; items: Rec[] } =>
  logic.getDomains(loadSettings());
export const getSupportGroupMap = (): { version: number; map: Record<string, string> } =>
  logic.getSupportGroupMap(loadSettings());

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
export function setDomains(items: unknown): void {
  saveSettings(logic.withDomains(loadSettings(), items));
}
export function setSupportGroupMap(map: unknown): void {
  saveSettings(logic.withSupportGroupMap(loadSettings(), map));
}
