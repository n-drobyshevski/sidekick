// Settings persistence on the `settings` tab (key / value_json rows). The semantics live in
// domain/settingsLogic.ts; this layer only loads and saves the dict.

import { cleanSettings, type Settings } from "../domain/settingsLogic";
import type { Rec } from "../domain/util";
import { bumpDataVersion } from "./serverCache";
import { readAll, overwrite, TABS } from "./sheetsDb";

// Per-execution memo: every getter funnels through loadSettings(), so without it a single
// request re-reads the tab once per getter. Module state dies with the GAS execution, so
// this can never serve cross-request data.
let settingsMemo: Settings | undefined;

/** Drop this module's per-execution memo. */
export function resetSettingsMemo(): void {
  settingsMemo = undefined;
}

export function loadSettings(): Settings {
  if (settingsMemo) return settingsMemo;
  const raw: Rec = {};
  for (const row of readAll(TABS.settings)) {
    const key = String(row.key ?? "");
    if (!key) continue;
    try {
      raw[key] = JSON.parse(String(row.value_json ?? "null"));
    } catch {
      // A hand-edited cell that is not JSON is a missing setting, not a broken app.
      raw[key] = null;
    }
  }
  settingsMemo = cleanSettings(raw);
  return settingsMemo;
}

/**
 * Persist settings and invalidate every cached read.
 *
 * The version bump is not optional: read models are keyed by it, so a saved SLA target that
 * did not bump would leave every cached SLA figure answering for the old window.
 */
export function saveSettings(next: Settings): Settings {
  const cleaned = cleanSettings(next as unknown as Rec);
  const rows = Object.entries(cleaned).map(([key, value]) => ({
    key,
    value_json: JSON.stringify(value),
  }));
  overwrite(TABS.settings, rows);
  settingsMemo = cleaned;
  bumpDataVersion();
  return cleaned;
}
