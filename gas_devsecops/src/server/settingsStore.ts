// Settings persistence on the `settings` tab (key / value_json rows). The semantics live in
// domain/settingsLogic.ts; this layer only loads and saves the dict.

import { cleanSettings, type Settings } from "../domain/settingsLogic";
import type { Rec } from "../domain/util";
import { bumpDataVersion, dataVersion } from "./serverCache";
import { readAll, overwrite, TABS } from "./sheetsDb";

// Per-execution memo: every getter funnels through loadSettings(), so without it a single
// request re-reads the tab once per getter. Module state dies with the GAS execution, so
// this can never serve cross-request data.
let settingsMemo: Settings | undefined;

/** Drop this module's per-execution memo. */
export function resetSettingsMemo(): void {
  settingsMemo = undefined;
}

// ACROSS EXECUTIONS TOO, in CacheService — ported from gas/ #321/#323. Measured in production
// (PERF_PLAN.md step 1): reading this fifteen-row tab cost 0.2 s after the spreadsheet was open
// and 0.8 s when it was the first Sheets access of the execution — which on a warm Executive
// load it is, and that open was ~0.85 s of a ~1.2 s page. A CacheService read is tens of ms.
//
// KEYED ON THE DATA VERSION, which is what makes it safe: `saveSettings` is the only writer of
// the tab and it bumps the version, so a save moves every reader to a new key — and it writes
// the saved dict under that new key itself, so the next request does not pay the sheet either.
// The TTL only bounds the path the version cannot see: someone editing the tab by hand in
// Sheets, picked up at the next sync or settings save (both bump), or when CacheService's
// six-hour maximum runs out. gas/ shipped ten minutes first and measured what that cost.
//
// THE RAW DICT IS CACHED, NOT THE CLEANED ONE, and `cleanSettings` runs on every load exactly
// as it does over the tab: a deploy that changes what cleaning means must not be served an
// entry cleaned by the old code.
const SETTINGS_CACHE_TTL_SEC = 21_600;
// One CacheService value is capped at 100 KB; a dict over this is simply not cached.
const SETTINGS_CACHE_MAX_CHARS = 90_000;

function settingsCacheKey(): string {
  return "dsSettings1:" + dataVersion();
}

// No timing line of its own: a miss is visible as the `{"stage":"sheet","tab":"settings"}` line
// that follows it, and a hit is one small CacheService get.
function readSettingsCache(): Rec | undefined {
  try {
    const raw = CacheService.getScriptCache().get(settingsCacheKey());
    const parsed = raw ? (JSON.parse(raw) as unknown) : undefined;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Rec) : undefined;
  } catch (e) {
    console.warn(`Settings cache read failed: ${e}`);
    return undefined;
  }
}

function writeSettingsCache(raw: Rec): void {
  try {
    const json = JSON.stringify(raw);
    if (json.length > SETTINGS_CACHE_MAX_CHARS) return;
    CacheService.getScriptCache().put(settingsCacheKey(), json, SETTINGS_CACHE_TTL_SEC);
  } catch (e) {
    console.warn(`Settings cache write failed: ${e}`);
  }
}

export function loadSettings(): Settings {
  if (settingsMemo) return settingsMemo;
  const cachedRaw = readSettingsCache();
  if (cachedRaw) {
    settingsMemo = cleanSettings(cachedRaw);
    return settingsMemo;
  }
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
  writeSettingsCache(raw);
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
  // Under the NEW version's key, so the next request reads the saved dict from the cache. The
  // JSON round trip is what the tab itself does to every value on its way back.
  writeSettingsCache(JSON.parse(JSON.stringify(cleaned)) as Rec);
  return cleaned;
}
