// Settings persistence on the `settings` tab (key / value_json rows). The semantics
// live in domain/settingsLogic.ts; this layer only loads/saves the settings dict.

import * as logic from "../domain/settingsLogic";
import type { Rec } from "../domain/util";
import { bumpDataVersion } from "./serverCache";
import { readAll, overwrite, TABS } from "./sheetsDb";

// Per-execution memo: every settings getter funnels through loadSettings(), so
// without it a single request re-reads the settings tab once per getter. Module
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
  // Settings feed the cached bootstrap payload and the default graph projection.
  bumpDataVersion();
}

export const getDefaultDepth = (): number => logic.getDefaultDepth(loadSettings());
export const getMaxNodes = (): number => logic.getMaxNodes(loadSettings());

export function setDefaultDepth(depth: unknown): void {
  saveSettings(logic.withDefaultDepth(loadSettings(), depth));
}
export function setMaxNodes(maxNodes: unknown): void {
  saveSettings(logic.withMaxNodes(loadSettings(), maxNodes));
}
