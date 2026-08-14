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
export const getAutoExpand = (): boolean => logic.getAutoExpand(loadSettings());

export function setDefaultDepth(depth: unknown): void {
  saveSettings(logic.withDefaultDepth(loadSettings(), depth));
}
export function setMaxNodes(maxNodes: unknown): void {
  saveSettings(logic.withMaxNodes(loadSettings(), maxNodes));
}
export function setAutoExpand(on: unknown): void {
  saveSettings(logic.withAutoExpand(loadSettings(), on));
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

export const getSkippedSteps = (): string[] => logic.getSkippedSteps(loadSettings());

/** Record what the sync just skipped. Skips the whole-tab rewrite when nothing changed. */
export function setSkippedSteps(steps: unknown): void {
  const settings = loadSettings();
  const next = logic.withSkippedSteps(settings, steps);
  const before = logic.getSkippedSteps(settings).join(" ");
  if (logic.getSkippedSteps(next).join(" ") === before) return;
  saveSettings(next);
}

/**
 * The framework selection, resolved against the synced catalogue on first use.
 *
 * `catalogue` is a thunk so the common path — a stored selection — never pays for a tab
 * read it does not need.
 */
export function getSelectedFrameworks(
  catalogue?: () => { id: string; name: string }[],
): string[] {
  const settings = loadSettings();
  if (Array.isArray(settings["selected_frameworks"])) {
    return logic.getSelectedFrameworks(settings);
  }
  // Never configured. Resolve the defaults by NAME against whatever the catalogue holds —
  // a framework id is version-scoped and not portable, so the shipped ids are a cold start
  // rather than an answer. Not persisted here: a read must not write, and the operator's
  // first explicit save is what should turn this into a stored decision.
  const rows = catalogue ? catalogue() : [];
  return rows.length
    ? logic.resolveDefaultFrameworks(rows)
    : logic.getSelectedFrameworks(settings);
}

/** Choose which frameworks the sync collects posture for. */
export function setSelectedFrameworks(ids: unknown): string[] {
  saveSettings(logic.withSelectedFrameworks(loadSettings(), ids));
  return getSelectedFrameworks();
}

export const getScanVars = (): Rec => logic.getScanVars(loadSettings());

/** Save (or, with an empty override, clear) one step's variable override. */
export function setScanVars(stepId: string, vars: unknown): Rec {
  saveSettings(logic.withScanVars(loadSettings(), stepId, vars));
  return getScanVars();
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

/** Whether the rule catalogue is fresh enough to skip re-collecting. */
export function configRulesAreFresh(hasRows: boolean, now: number): boolean {
  return logic.configRulesAreFresh(loadSettings(), hasRows, now);
}

/** Stamp the catalogue as collected. Called only when CONFIG_RULES actually ran. */
export function setConfigRulesSyncedAt(at: number): void {
  saveSettings(logic.withConfigRulesSyncedAt(loadSettings(), at));
}
