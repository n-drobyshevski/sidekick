// Pure settings semantics (defaults, clamping) over the settings dict the store
// loads from the `settings` tab. Kept out of the store so it is unit-testable
// without GAS globals.

import { DEFAULT_AARS_RULE, type AarsRule } from "./aars";
import { cleanAarsRule } from "./aarsRule";
import {
  DEPTH_DEFAULT,
  DEPTH_MAX,
  DEPTH_MIN,
  MAX_NODES_CEILING,
  MAX_NODES_DEFAULT,
  MAX_NODES_FLOOR,
} from "./config";
import { clampInt } from "./util";
import type { Rec } from "./util";

export function clampDepth(v: unknown): number {
  return clampInt(v, DEPTH_DEFAULT, DEPTH_MIN, DEPTH_MAX);
}

export function getDefaultDepth(settings: Rec): number {
  return clampDepth(settings["default_depth"] ?? DEPTH_DEFAULT);
}

export function withDefaultDepth(settings: Rec, depth: unknown): Rec {
  return { ...settings, default_depth: clampDepth(depth) };
}

/**
 * Node budget for one graph payload; clamped so a bad value can't flood the client. The
 * ceiling binds the per-view "Load more" as well as the stored setting — a hand-edited
 * `maxNodes=99999` in the hash buys the same 400 nodes as the last press of the button.
 */
export function clampMaxNodes(v: unknown): number {
  return clampInt(v, MAX_NODES_DEFAULT, MAX_NODES_FLOOR, MAX_NODES_CEILING);
}

export function getMaxNodes(settings: Rec): number {
  return clampMaxNodes(settings["max_nodes"] ?? MAX_NODES_DEFAULT);
}

export function withMaxNodes(settings: Rec, maxNodes: unknown): Rec {
  return { ...settings, max_nodes: clampMaxNodes(maxNodes) };
}

// ------------------------------------------------------------------------- AARS rule

export interface StoredAarsRule {
  version: number;
  rule: AarsRule;
}

/** Version 0 = never edited, i.e. the model is exactly ai/custom_score.md. */
export function getAarsRule(settings: Rec): StoredAarsRule {
  const raw = settings["aars_rule"];
  if (!raw || typeof raw !== "object") {
    return { version: 0, rule: cleanAarsRule(DEFAULT_AARS_RULE) };
  }
  const stored = raw as Rec;
  const version = Number(stored["version"]);
  return {
    version: Number.isFinite(version) && version > 0 ? Math.round(version) : 0,
    rule: cleanAarsRule(stored["rule"]),
  };
}

/**
 * Store a rule and bump its version. The version is the cache/staleness token: derived
 * views key on it, and scores persisted under an older version are known to be stale.
 */
export function withAarsRule(settings: Rec, rule: unknown): Rec {
  const current = getAarsRule(settings);
  return {
    ...settings,
    aars_rule: { version: current.version + 1, rule: cleanAarsRule(rule) },
  };
}

/**
 * The rule version the persisted AARS scores were computed under. Compared against
 * `getAarsRule().version` to decide whether the inventory needs a recompute; point-rule
 * edits go stale, band edits never do (levels are re-derived on read).
 */
export function getScoredRuleVersion(settings: Rec): number {
  const v = Number(settings["aars_scored_version"]);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export function withScoredRuleVersion(settings: Rec, version: unknown): Rec {
  const v = Number(version);
  return {
    ...settings,
    aars_scored_version: Number.isFinite(v) && v > 0 ? Math.round(v) : 0,
  };
}
