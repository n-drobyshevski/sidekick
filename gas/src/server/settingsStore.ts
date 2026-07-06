// Settings persistence on the `settings` tab (key / value_json rows). The semantics
// live in domain/settingsLogic.ts; this layer only loads/saves the settings dict.

import * as logic from "../domain/settingsLogic";
import type { Rec } from "../domain/util";
import { readAll, overwrite, TABS } from "./sheetsDb";

export function loadSettings(): Rec {
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
}

export const getFetchSeverities = (): string[] => logic.getFetchSeverities(loadSettings());
export const getDisplaySeverities = (): string[] => logic.getDisplaySeverities(loadSettings());
export const getRetentionDays = (): number | null => logic.getRetentionDays(loadSettings());
export const getAutoCompact = (): boolean => logic.getAutoCompact(loadSettings());
export const getDomains = (): { version: number; items: Rec[] } =>
  logic.getDomains(loadSettings());

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
