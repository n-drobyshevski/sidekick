// Pure settings semantics (defaults, clamping) over the settings dict the store
// loads from the `settings` tab. Kept out of the store so it is unit-testable
// without GAS globals.

import { DEFAULT_AARS_RULE, type AarsRule } from "./aars";
import { cleanAarsRule } from "./aarsRule";
import { cleanStepVars } from "./scanVars";
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

// ----------------------------------------------------------------------- auto-expand

/**
 * Whether an agent's detail sheet asks Wiz for its neighbourhood on open, instead of
 * waiting for the "Expand from Wiz" button.
 *
 * ON by default. The stored snapshot only holds what the sync battery's five fixed
 * traversals collected, so a sheet that has not been expanded is showing a partial picture
 * without the reader having any way to know it. The cost is bounded: one UrlFetchApp call
 * per agent per data version, memoized by serverCache, and the sheet paints its stored
 * neighbours first and repaints when the live result lands — so it buys latency on nothing.
 *
 * The get/with asymmetry is not an oversight. `get` tests `!== false` because
 * settingsStore.loadSettings turns a blank cell into `null`, and for an on-by-default flag
 * `null` has to read as ON — the same hazard the `?? DEFAULT` in the getters above exists
 * for. `with` tests `=== true` to match the strict-coercion idiom in aarsRule.ts, so a
 * value arriving from the wire is normalized to a real boolean rather than stored as
 * something truthy that later reads back differently.
 */
export function getAutoExpand(settings: Rec): boolean {
  return settings["auto_expand"] !== false;
}

export function withAutoExpand(settings: Rec, on: unknown): Rec {
  return { ...settings, auto_expand: on === true };
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

/** How long the cloud-configuration rule catalogue is considered fresh. */
export const CONFIG_RULES_TTL_MS = 30 * 86_400_000;

/**
 * When the rule catalogue was last collected, as epoch ms; 0 when never.
 *
 * The catalogue is ~3,858 rules — about 39 pages against a battery that is otherwise 10–20
 * calls — and it describes Wiz's rule vocabulary rather than this tenant's estate. Re-walking
 * it daily would triple the sync to re-collect a list that changes when Wiz ships rules.
 */
export function getConfigRulesSyncedAt(settings: Rec): number {
  const v = Number(settings["config_rules_synced_at"]);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export function withConfigRulesSyncedAt(settings: Rec, at: unknown): Rec {
  const v = Number(at);
  return {
    ...settings,
    config_rules_synced_at: Number.isFinite(v) && v > 0 ? Math.round(v) : 0,
  };
}

/**
 * Whether the catalogue needs re-collecting. `hasRows` is passed rather than read, so this
 * stays pure and a deployment whose tab was cleared re-syncs even inside the TTL.
 */
export function configRulesAreFresh(settings: Rec, hasRows: boolean, now: number): boolean {
  if (!hasRows) return false;
  const at = getConfigRulesSyncedAt(settings);
  if (!at) return false;
  return now - at < CONFIG_RULES_TTL_MS;
}

/**
 * Per-step Wiz query variable overrides, keyed by sync-step id. Absent or unreadable means
 * every step uses its builder's own variables — the shape a deployment that has never
 * touched them has, and the shape a corrupted cell degrades to.
 */
export function getScanVars(settings: Rec): Rec {
  const raw = settings["scan_vars"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Rec = {};
  for (const [stepId, value] of Object.entries(raw as Rec)) {
    // Cleaned per step against its own spec, so a key for a step that no longer exists —
    // or a value carrying paths the spec never offered — is dropped on read rather than
    // being carried forward forever.
    const clean = cleanStepVars(stepId, value);
    if (clean) out[stepId] = clean;
  }
  return out;
}

/**
 * Step ids the last live sync skipped because the tenant rejected their query with an
 * HTTP 400. Recorded because it is otherwise unreachable: it lives on the job row, and the
 * job is gone the moment it reaches a terminal phase.
 *
 * This is what makes a bad variable override visible. Optional steps swallow a 400 by
 * design, so without this an edit that Wiz rejects looks identical to a tenant that simply
 * has nothing to report — the area quietly stops reporting and says nothing about why.
 */
export function getSkippedSteps(settings: Rec): string[] {
  const raw = settings["last_skipped_steps"];
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v ?? "")).filter(Boolean);
}

export function withSkippedSteps(settings: Rec, steps: unknown): Rec {
  const list = Array.isArray(steps) ? steps.map((v) => String(v ?? "")).filter(Boolean) : [];
  return { ...settings, last_skipped_steps: list };
}

/**
 * Steps whose last run stopped at MAX_PAGES with the cursor still open.
 *
 * A DIFFERENT list from the skipped one, and the difference is whose decision it was.
 * `last_skipped_steps` means the tenant refused the query; this means we stopped asking
 * while it was still answering, so the step's rows are a prefix of the truth. Folding the
 * two together would report a partial dataset as a rejection and send whoever reads it to
 * check permissions that are fine.
 *
 * It exists because the cap used to be a bare `break`: the sync reported success and the
 * missing rows were indistinguishable from an estate that does not have them.
 */
export function getTruncatedSteps(settings: Rec): string[] {
  const raw = settings["last_truncated_steps"];
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v ?? "")).filter(Boolean);
}

export function withTruncatedSteps(settings: Rec, steps: unknown): Rec {
  const list = Array.isArray(steps) ? steps.map((v) => String(v ?? "")).filter(Boolean) : [];
  return { ...settings, last_truncated_steps: list };
}

/**
 * The AI-relevant frameworks this app syncs posture for, out of the box.
 *
 * Ids observed on the tenant this was built against. They are a STARTING POINT, not a
 * guarantee: a Wiz framework id is tenant-local, so these can be wrong somewhere else —
 * which is the whole reason the catalogue step and the Settings picker exist. A wrong id
 * costs one skipped optional step, recorded as a skip, not a silent empty page.
 */
export const DEFAULT_FRAMEWORK_IDS = [
  "wf-id-275", // OWASP Top 10 For Agentic Applications 2026
  "wf-id-201", // OWASP LLM Security Top 10
  "wf-id-214", // 5Rs - Wiz for Data Security
  "wf-id-106", // OWASP ML Security Top 10
];

/**
 * Which frameworks the sync collects posture for.
 *
 * Deliberately NOT "every enabled framework the tenant has". Posture costs one round trip
 * per framework, and a tenant carrying a hundred builtin frameworks (CIS, PCI-DSS, SOC 2)
 * would spend a hundred calls on frameworks this app has no vocabulary for and no page to
 * show them on. The catalogue populates a picker; the picker decides the battery.
 *
 * An empty stored list means "never configured" and falls back to the defaults. Clearing
 * the selection to nothing is expressed by withSelectedFrameworks storing an explicit
 * empty marker, so "I want none" stays distinguishable from "I have not chosen".
 */
export function getSelectedFrameworks(settings: Rec): string[] {
  const raw = settings["selected_frameworks"];
  if (!Array.isArray(raw)) return DEFAULT_FRAMEWORK_IDS.slice();
  return raw.map((v) => String(v ?? "")).filter(Boolean);
}

/**
 * Resolve the default selection against a real catalogue, BY NAME.
 *
 * `DEFAULT_FRAMEWORK_IDS` is a cold start from one tenant, and a Wiz framework id is not
 * portable — it is version-scoped, so a new edition of the same framework mints a new id
 * and a pin quietly stops matching anything. Matching on the name family instead means the
 * defaults survive both a different tenant and a new edition.
 *
 * Only used when NOTHING is stored. An operator's explicit selection is never second-
 * guessed, including an explicit selection of none.
 */
export function resolveDefaultFrameworks(
  catalogue: { id: string; name: string }[],
): string[] {
  // Order matters only for readability of the result; the matchers are mutually exclusive.
  // Note ML and LLM cannot collide: `\bML\b` finds no word boundary inside "LLM", and
  // "OWASP ML Security Top 10" contains no "LLM" substring.
  const wanted = ["AGENTIC", "LLM", "5R", "ML"];
  const picked: string[] = [];
  for (const want of wanted) {
    for (const f of catalogue) {
      const n = String(f.name ?? "").toUpperCase();
      const hit = want === "5R"
        ? /\b5\s?RS?\b/.test(n)
        : want === "ML"
          ? (n.includes("MACHINE LEARNING") || /\bML\b/.test(n))
          : want === "LLM"
            ? n.includes("LLM")
            : n.includes("AGENTIC");
      if (hit && picked.indexOf(f.id) === -1) {
        picked.push(f.id);
        break;
      }
    }
  }
  // Nothing recognizable in the catalogue: keep the id defaults rather than selecting
  // nothing, so a tenant whose framework names are localized still tries.
  return picked.length ? picked : DEFAULT_FRAMEWORK_IDS.slice();
}

export function withSelectedFrameworks(settings: Rec, ids: unknown): Rec {
  const list = Array.isArray(ids)
    ? ids.map((v) => String(v ?? "").trim()).filter(Boolean)
    : [];
  const seen: Record<string, true> = {};
  const deduped = list.filter((id) => (seen[id] ? false : (seen[id] = true)));
  return { ...settings, selected_frameworks: deduped };
}

export function withScanVars(settings: Rec, stepId: string, vars: unknown): Rec {
  const current = getScanVars(settings);
  const clean = cleanStepVars(stepId, vars);
  const next: Rec = { ...current };
  // An override that matches nothing the spec offers is a removal, which is how "reset this
  // step" is expressed: there is no separate delete path to keep in step with the save one.
  if (clean) next[stepId] = clean;
  else delete next[stepId];
  return { ...settings, scan_vars: next };
}
