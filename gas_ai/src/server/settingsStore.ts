// Settings persistence on the `settings` tab (key / value_json rows). The semantics
// live in domain/settingsLogic.ts; this layer only loads/saves the settings dict.

import { scoringEqual } from "../domain/aarsRule";
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
  // bumpDataVersion alone, deliberately — NOT syncStore's commit(). That pairs the
  // version bump with dropping this execution's read memos, and those memos hold RAW
  // asset rows; loadAssets re-reads currentBands() on every call and applies them after
  // the memo, so a rule change is already reflected without invalidating anything. The
  // asymmetry looks like drift and isn't. (syncStore also imports this module, so the
  // call would be a cycle.)
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

export const getAarsRule = (): logic.StoredAarsRule => logic.getAarsRule(loadSettings());

/**
 * Save a rule and return it as stored — clamped, and with its new version. When the edit
 * touched only the bands, the scored-version marker moves forward with it: levels are
 * re-derived on read, so every persisted score is still correct and prompting for a
 * recompute would be asking for work that changes nothing.
 */
export function setAarsRule(rule: unknown): logic.StoredAarsRule {
  const settings = loadSettings();
  const before = logic.getAarsRule(settings);
  const scoresWereCurrent = logic.getScoredRuleVersion(settings) === before.version;

  let next = logic.withAarsRule(settings, rule);
  const stored = logic.getAarsRule(next);
  if (scoresWereCurrent && scoringEqual(before.rule, stored.rule)) {
    next = logic.withScoredRuleVersion(next, stored.version);
  }
  saveSettings(next);
  return stored;
}

export const getScoredRuleVersion = (): number => logic.getScoredRuleVersion(loadSettings());

/**
 * Mark which rule version the persisted scores were computed under. Every sync calls this,
 * and almost every call is a no-op — so it skips the whole-tab rewrite (and the cache
 * invalidation that rides with it) when the marker is already where it should be.
 */
export function setScoredRuleVersion(version: unknown): void {
  const settings = loadSettings();
  const next = logic.withScoredRuleVersion(settings, version);
  if (logic.getScoredRuleVersion(next) === logic.getScoredRuleVersion(settings)) return;
  saveSettings(next);
}
