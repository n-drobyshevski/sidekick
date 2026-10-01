// Settings persistence on the `settings` tab (key / value_json rows). The semantics live in
// domain/settingsLogic.ts; this layer only loads and saves the dict.

import { cleanSettings, type Settings } from "../domain/settingsLogic";
import { withSupportGroupDomains } from "../../../gas_shared/domain/sgDomainOverrides";
import type { Rec } from "../domain/util";
import { getProp, setProp } from "./props";
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
// KEYED ON THE DATA VERSION AND THE SETTINGS GENERATION, which is what makes it safe:
// `saveSettings` is the only writer of the tab and it bumps SETTINGS_GEN on every save (and the
// data version on every save that is not a view switch), so a save moves every reader to a new
// key — and it writes the saved dict under that new key itself, so the next request does not pay
// the sheet either. The data version alone is no longer enough: a header view switch saves the
// tab WITHOUT bumping it (see `saveSettings`), and a key that did not move would go on serving
// the previous view for six hours. The TTL only bounds the path neither stamp can see: someone
// editing the tab by hand in Sheets, picked up at the next sync or settings save, or when
// CacheService's six-hour maximum runs out. gas/ shipped ten minutes first and measured what
// that cost.
//
// THE RAW DICT IS CACHED, NOT THE CLEANED ONE, and `cleanSettings` runs on every load exactly
// as it does over the tab: a deploy that changes what cleaning means must not be served an
// entry cleaned by the old code.
const SETTINGS_CACHE_TTL_SEC = 21_600;
// One CacheService value is capped at 100 KB; a dict over this is simply not cached.
const SETTINGS_CACHE_MAX_CHARS = 90_000;

// A Script Property rather than a second DATA_VERSION, because what it invalidates is exactly
// one entry: this file's own cache of the tab. Format `<ms>.<n>`, like the data version, so two
// saves inside one millisecond — certain under a frozen test clock — still mint two keys.
const SETTINGS_GEN_PROP = "SETTINGS_GEN";

function settingsGen(): string {
  return getProp(SETTINGS_GEN_PROP) ?? "0";
}

function bumpSettingsGen(): void {
  const now = String(Date.now());
  const [prevMs, prevN] = settingsGen().split(".");
  setProp(SETTINGS_GEN_PROP, prevMs === now ? `${now}.${(Number(prevN) || 0) + 1}` : `${now}.0`);
}

// "dsSettings1" -> "dsSettings2": the generation joined the key.
//
// RESOLVED ONCE PER LOAD AND HANDED TO BOTH THE READ AND THE WRITE, never recomputed between
// them. The data version is memoized per execution but the generation is not, so a load that
// missed, read the OLD tab, and then re-read the generation for its write-back would store the
// old dict under the key a concurrent view switch had just moved every reader to.
function settingsCacheKey(): string {
  return "dsSettings2:" + dataVersion() + ":" + settingsGen();
}

// No timing line of its own: a miss is visible as the `{"stage":"sheet","tab":"settings"}` line
// that follows it, and a hit is one small CacheService get.
function readSettingsCache(key: string): Rec | undefined {
  try {
    const raw = CacheService.getScriptCache().get(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : undefined;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Rec) : undefined;
  } catch (e) {
    console.warn(`Settings cache read failed: ${e}`);
    return undefined;
  }
}

function writeSettingsCache(key: string, raw: Rec): void {
  try {
    const json = JSON.stringify(raw);
    if (json.length > SETTINGS_CACHE_MAX_CHARS) return;
    CacheService.getScriptCache().put(key, json, SETTINGS_CACHE_TTL_SEC);
  } catch (e) {
    console.warn(`Settings cache write failed: ${e}`);
  }
}

export function loadSettings(): Settings {
  if (settingsMemo) return settingsMemo;
  const key = settingsCacheKey();
  const cachedRaw = readSettingsCache(key);
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
  writeSettingsCache(key, raw);
  return settingsMemo;
}

/** The two header view fields — the only ones a `viewOnly` save may change. */
const VIEW_KEYS: ReadonlySet<string> = new Set(["projectView", "domainView"]);

/** Key-sorted JSON, so two cleaned dicts compare by content rather than by key order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const r = v as Rec;
    return `{${Object.keys(r).sort().map((k) => `${JSON.stringify(k)}:${canonical(r[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** Do two cleaned dicts agree on every field but the view? */
function sameOutsideView(a: Settings, b: Settings): boolean {
  const strip = (s: Settings) =>
    Object.fromEntries(Object.entries(s).filter(([k]) => !VIEW_KEYS.has(k)));
  return canonical(strip(a)) === canonical(strip(b));
}

export interface SaveOptions {
  /**
   * The save changes the header's view scope (`projectView` / `domainView`) and nothing else —
   * `api.setProjectView` / `setDomainView`. See `saveSettings` for what it skips.
   */
  viewOnly?: boolean;
}

/**
 * Persist settings and invalidate every cached read that depends on what changed.
 *
 * The data-version bump is not optional for an ordinary save: read models are keyed by it, so a
 * saved SLA target that did not bump would leave every cached SLA figure answering for the old
 * window.
 *
 * A VIEW SWITCH DOES NOT BUMP IT, and that is the point of `viewOnly`. Every cached payload that
 * depends on the view already carries it in its key (`readModels.keyOf`), and the bootstrap
 * core is view-independent, with the view-dependent fields read live (`api.withLiveBootFields`)
 * — so bumping would only cold-start every L1 and L2 entry, the inline boot included, for every
 * user, each time anyone moved the header picker. SETTINGS_GEN still moves on every save, so
 * this file's own cache never serves the previous view.
 *
 * DEFENSIVE: a `viewOnly` save that changes anything outside the two view fields is treated as
 * an ordinary save and bumps. The flag is a claim made by the caller; the comparison is what is
 * actually written, and a cached figure keyed to the old SLA window is not worth trusting a
 * claim for.
 */
export function saveSettings(next: Settings, opts: SaveOptions = {}): Settings {
  const cleaned = cleanSettings(next as unknown as Rec);
  const viewOnly = opts.viewOnly === true && sameOutsideView(loadSettings(), cleaned);
  const rows = Object.entries(cleaned).map(([key, value]) => ({
    key,
    value_json: JSON.stringify(value),
  }));
  overwrite(TABS.settings, rows);
  settingsMemo = cleaned;
  bumpSettingsGen();
  if (!viewOnly) bumpDataVersion();
  // Under the NEW key, so the next request reads the saved dict from the cache. The JSON round
  // trip is what the tab itself does to every value on its way back.
  writeSettingsCache(settingsCacheKey(), JSON.parse(JSON.stringify(cleaned)) as Rec);
  return cleaned;
}

/** The admin overrides of a support group's domain (settings `supportGroupDomains`). */
export function getSupportGroupDomains(): Settings["supportGroupDomains"] {
  return loadSettings().supportGroupDomains;
}

/** Replace them — bumps the entry's version, and `saveSettings` bumps the data version, so the
 *  domain assignment and every cached read model rebuild. */
export function setSupportGroupDomains(items: unknown): void {
  saveSettings(withSupportGroupDomains(loadSettings(), items));
}
