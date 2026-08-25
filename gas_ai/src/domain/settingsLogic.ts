// Pure settings semantics (defaults, clamping) over the settings dict the store
// loads from the `settings` tab. Kept out of the store so it is unit-testable
// without GAS globals.

import { DEFAULT_AARS_RULE, type AarsRule } from "./aars";
import { cleanAarsRule } from "./aarsRule";
import type { ScopePins } from "./complianceScope";
import { cleanProblemRule, DEFAULT_PROBLEM_RULE, type ProblemRule } from "./problemRule";
import { cleanPostureRule, DEFAULT_POSTURE_RULE, type PostureRule } from "./postureRule";
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

/**
 * Which project the dashboard is CURRENTLY LOOKING AT, or "" for the whole register.
 *
 * Not the same thing as WIZ_PROJECT_ID_V2, and the difference is the point. That property
 * decides what the sync COLLECTS; this decides what the pages SHOW of what was collected.
 * Conflating them is how a switcher ends up offering a project that was never fetched and
 * rendering its zero rows as though that were a finding.
 *
 * Stored as a project ID, never a name: only an id carries ancestry, so selecting a business
 * unit reaches every asset beneath it (see ProjectRef in domain/graphTypes.ts). Names are also
 * not unique across a thousand-project tenant.
 *
 * It lives in the settings tab rather than a Script Property for two reasons. Every other
 * view preference here already does, so an operator finds it where the others are. And
 * `saveSettings` bumps the data version, which the SWR cache in the client is keyed on —
 * a Script Property would change the answer under a cache that had no idea.
 */
export function getProjectView(settings: Rec): string {
  const v = settings["project_view"];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * ONE SCOPE AT A TIME, ENFORCED HERE.
 *
 * Project and domain are orthogonal — the seeded landscape puts four domains inside
 * PROJECT-ALPHA on purpose, so that grouping by domain "has to visibly cut across an attack
 * path or the dimension is just a second spelling of the project". Two scopes at once would
 * therefore be a real question, and it is not the one this control asks: the caption under
 * it carries ONE denominator, and every "this figure cannot be scoped" note in the app is
 * written for one dimension.
 *
 * So setting either clears the other, in the pair of writers rather than in the ten readers.
 * A reader that had to remember the rule is a reader that can forget it.
 */
export function withProjectView(settings: Rec, id: unknown): Rec {
  return {
    ...settings,
    project_view: typeof id === "string" ? id.trim() : "",
    domain_view: "",
  };
}

export function getDomainView(settings: Rec): string {
  const v = settings["domain_view"];
  return typeof v === "string" ? v.trim() : "";
}

/** The domain tag's own value, verbatim. See withProjectView for why this clears its pair. */
export function withDomainView(settings: Rec, domain: unknown): Rec {
  return {
    ...settings,
    domain_view: typeof domain === "string" ? domain.trim() : "",
    project_view: "",
  };
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

// ---------------------------------------------------------------------- problem rule
//
// `problem_rule` is a SECOND, SEPARATE settings key from `aars_rule` above — never merged
// into it, for three reasons:
//
//   1. `scoringEqual` (aarsRule.ts) works by `delete c.bands` off the cleaned rule; a
//      decision tree has no `bands` field at all. A shared no-op guard built on that trick
//      would have nothing to delete for the tree half of a merged rule, so it could not
//      tell a cosmetic tree edit from a decision-changing one the way it does for AARS.
//   2. The two version counters must move INDEPENDENTLY. A tree edit must not mark every
//      persisted AARS score stale, and an AARS point-rule edit must not mark every
//      persisted problem verdict stale — one shared counter cannot answer two staleness
//      questions that move on different schedules.
//   3. Merging the two rule blobs into one settings cell would grow (and diff) the
//      bootstrap snapshot for a feature that, as of this phase, is not wired into the API
//      surface or the client at all — a cost paid by every deployment for no visible
//      benefit yet.

export interface StoredProblemRule {
  version: number;
  rule: ProblemRule;
}

/** Version 0 = never edited, i.e. the model is exactly `DEFAULT_PROBLEM_RULE`. */
export function getProblemRule(settings: Rec): StoredProblemRule {
  const raw = settings["problem_rule"];
  if (!raw || typeof raw !== "object") {
    return { version: 0, rule: cleanProblemRule(DEFAULT_PROBLEM_RULE) };
  }
  const stored = raw as Rec;
  const version = Number(stored["version"]);
  return {
    version: Number.isFinite(version) && version > 0 ? Math.round(version) : 0,
    // cleanProblemRule on every read IS the migration mechanism, exactly as cleanAarsRule
    // is above: a rule blob written by an older schema is repaired on the way OUT rather
    // than migrated once on the way in, so there is no separate migration step to forget
    // to run when a field is added to ProblemRule later.
    rule: cleanProblemRule(stored["rule"]),
  };
}

/**
 * Store a rule and bump its version. The version is the cache/staleness token: derived
 * views key on it, and verdicts persisted under an older version are known to be stale.
 */
export function withProblemRule(settings: Rec, rule: unknown): Rec {
  const current = getProblemRule(settings);
  return {
    ...settings,
    problem_rule: { version: current.version + 1, rule: cleanProblemRule(rule) },
  };
}

/**
 * The rule version the persisted problem verdicts were decided under. Compared against
 * `getProblemRule().version` to decide whether the register needs a redecide.
 */
export function getDecidedRuleVersion(settings: Rec): number {
  const v = Number(settings["problem_decided_version"]);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export function withDecidedRuleVersion(settings: Rec, version: unknown): Rec {
  const v = Number(version);
  return {
    ...settings,
    problem_decided_version: Number.isFinite(v) && v > 0 ? Math.round(v) : 0,
  };
}

// ---------------------------------------------------------------------- posture rule
//
// `posture_rule` is a THIRD, SEPARATE settings key from `aars_rule` and `problem_rule`
// above — never merged into either, for the same three reasons `problem_rule`'s own
// header gives for staying apart from `aars_rule`: `tierEqual` (postureRule.ts) has its own
// no-op guard shape, the version counters move independently (a posture-cascade edit must
// not mark a single AARS score or problem verdict stale, and vice versa), and keeping the
// three rule blobs apart keeps the bootstrap snapshot from growing for features a given
// edit does not touch.

export interface StoredPostureRule {
  version: number;
  rule: PostureRule;
}

/** Version 0 = never edited, i.e. the model is exactly `DEFAULT_POSTURE_RULE`. */
export function getPostureRule(settings: Rec): StoredPostureRule {
  const raw = settings["posture_rule"];
  if (!raw || typeof raw !== "object") {
    return { version: 0, rule: cleanPostureRule(DEFAULT_POSTURE_RULE) };
  }
  const stored = raw as Rec;
  const version = Number(stored["version"]);
  return {
    version: Number.isFinite(version) && version > 0 ? Math.round(version) : 0,
    // cleanPostureRule on every read IS the migration mechanism — see getProblemRule's
    // identical comment for why.
    rule: cleanPostureRule(stored["rule"]),
  };
}

/**
 * Store a rule and bump its version. The version is the cache/staleness token: derived
 * views key on it, and tiers persisted under an older version are known to be stale.
 */
export function withPostureRule(settings: Rec, rule: unknown): Rec {
  const current = getPostureRule(settings);
  return {
    ...settings,
    posture_rule: { version: current.version + 1, rule: cleanPostureRule(rule) },
  };
}

/**
 * The rule version the persisted posture tiers were computed under. Compared against
 * `getPostureRule().version` to decide whether the register needs a recompute.
 */
export function getComputedPostureVersion(settings: Rec): number {
  const v = Number(settings["posture_computed_version"]);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export function withComputedPostureVersion(settings: Rec, version: unknown): Rec {
  const v = Number(version);
  return {
    ...settings,
    posture_computed_version: Number.isFinite(v) && v > 0 ? Math.round(v) : 0,
  };
}

/**
 * The DERIVATION generation the persisted facts were collected under — not a rule version.
 *
 * Defaults to 0 for a ledger that predates the key, and 0 is deliberately NOT treated as
 * "current": a store written before this marker existed was written by an older normalizer by
 * definition, which is exactly the population the staleness banner needs to reach. The three
 * rule-version keys above default to 0 too, and there it means "unstamped, assume current";
 * here it means "unstamped, assume stale". The asymmetry is the point, so it is stated rather
 * than left for a reader to infer from a comparison.
 */
export function getSyncDerivationVersion(settings: Rec): number {
  const v = Number(settings["last_sync_derivation_version"]);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export function withSyncDerivationVersion(settings: Rec, version: unknown): Rec {
  const v = Number(version);
  return {
    ...settings,
    last_sync_derivation_version: Number.isFinite(v) && v > 0 ? Math.round(v) : 0,
  };
}

/**
 * Whether the stored facts were collected by an older normalizer than the code now running.
 *
 * The remedy this gates is the reason it exists separately from every `*Stale` check around
 * it: those are repaired by Recompute, because the inputs survived and only the pricing moved.
 * This one is not. The old value was destroyed at ingest — a cell reading "false" carries no
 * memory of Wiz never having answered — so ONLY a full sync repairs it, and a banner that
 * offers Recompute here would send an operator to a button that cannot help.
 */
export function derivationIsStale(settings: Rec, current: number): boolean {
  return getSyncDerivationVersion(settings) < current;
}

/** How long the cloud-configuration rule catalogue is considered fresh. */
export const CONFIG_RULES_TTL_MS = 30 * 86_400_000;

/**
 * When the rule catalogue was last collected, as epoch ms; 0 when never.
 *
 * The catalogue is ~3,858 rules — about 39 pages against a battery that is otherwise 10–20
 * calls — and it describes Wiz's rule vocabulary rather than this tenant's landscape. Re-walking
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
 * missing rows were indistinguishable from a landscape that does not have them.
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
 * Raw rows each step returned on the last committed sync, by step id.
 *
 * A THIRD list, for the case neither of the two above can express: the step ran, the tenant
 * accepted it, and it matched nothing. That path records nothing today — it breaks out of the
 * page loop exactly the way a successful step does — so a zero-yield step and a step that was
 * never reached are the same absence of evidence. They are not the same finding: one says the
 * landscape has nothing of that shape, the other says the query never got to ask.
 *
 * A step id present here with a value of 0 is the first. Absent from here while present in the
 * battery is the second. That distinction is the entire reason this exists, so the zero must be
 * WRITTEN, never elided as falsy.
 *
 * Absent for a deployment that last synced before this shipped, and the reader must render that
 * as "not recorded" rather than as 0 — the same absent-is-not-zero discipline getSkippedSteps
 * carries.
 */
export function getStepRows(settings: Rec): Record<string, number> {
  const raw = settings["last_step_rows"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Rec)) {
    const n = Number(v);
    if (k && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export function withStepRows(settings: Rec, rows: unknown): Rec {
  return { ...settings, last_step_rows: getStepRows({ last_step_rows: rows }) };
}

/**
 * The pinned posture baseline — the snapshot a later run is compared against.
 *
 * Stored whole and opaque rather than field-by-field, because a baseline's job is to be the
 * EXACT thing that was measured. Reshaping it on the way in or out would mean a comparison
 * against a reconstruction, and the one property this has to keep is that the numbers on the
 * left of the delta are the numbers that were on the screen the day it was pinned.
 *
 * `null` when nothing has been pinned, and that is a distinct answer from an empty snapshot: it
 * is the difference between "nothing to compare against" and "we measured and found nothing",
 * which is the same distinction getStepRows exists for.
 */
export function getPostureBaseline(settings: Rec): Rec | null {
  const raw = settings["posture_baseline"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const snap = raw as Rec;
  return Array.isArray(snap["measures"]) ? snap : null;
}

export function withPostureBaseline(settings: Rec, snapshot: unknown): Rec {
  return { ...settings, posture_baseline: snapshot ?? null };
}

/**
 * Why each skipped step was skipped on the last committed sync — the tenant's own message.
 *
 * `getSkippedSteps` answers WHICH steps were refused; this answers WHAT the tenant said, and
 * only the second one is actionable. A step id in the skip list with no entry here is a skip
 * recorded before this existed, which a reader must render as "no reason recorded" rather than
 * as an empty explanation — the same absent-is-not-zero discipline getStepRows carries.
 */
export function getSkipReasons(settings: Rec): Record<string, string> {
  const raw = settings["last_skip_reasons"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Rec)) {
    if (k && typeof v === "string" && v) out[k] = v;
  }
  return out;
}

export function withSkipReasons(settings: Rec, reasons: unknown): Rec {
  return { ...settings, last_skip_reasons: getSkipReasons({ last_skip_reasons: reasons }) };
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

// ------------------------------------------------------------------ 5Rs AI-scope pins

function coercePinList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const s = String(raw ?? "").trim();
    if (s && out.indexOf(s) === -1) out.push(s);
  }
  return out;
}

/**
 * Reduce whatever is stored under `five_rs_policy_pins` to the {in, out} shape: arrays of
 * trimmed, deduped ids, with `out` winning a contradiction.
 *
 * Shared by getFiveRsPins/withFiveRsPins (store-time, no synced catalogue in scope to
 * validate ids against) and cleanFiveRsPins below (which additionally drops ids the
 * catalogue no longer knows). Kept as one function so the "out wins a contradiction" rule
 * has exactly one implementation — two independent copies of the same tie-break is exactly
 * how they quietly drift apart.
 */
function coercePins(raw: unknown): ScopePins {
  const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Rec) : {};
  const inList = coercePinList(rec["in"]);
  const outList = coercePinList(rec["out"]);
  const outSet = new Set(outList);
  // A policyId pinned both in and out is not a third state — it is a contradiction, and
  // `out` is the conservative resolution: erring toward removing a control from AI review
  // is safer than erring toward keeping one in that the operator also asked to drop.
  return { in: inList.filter((id) => !outSet.has(id)), out: outList };
}

/**
 * Explicit operator overrides for which 5Rs policies are in AI scope, keyed by policyId.
 * Store ONLY the decisions an operator actually made — never the resolved selection.
 *
 * scopeFiveRs (complianceScope.ts) re-derives the default every time from the landscape's own
 * hard facts (a cross-mapped policyId, an open gap finding on a synced AI asset), so a
 * policy that starts or stops meeting that derivation as the landscape changes keeps tracking
 * it automatically — persisting the resolved list instead would freeze today's answer and
 * silently stop following the sync, which is the exact failure DEFAULT_FRAMEWORK_IDS above
 * exists to avoid for framework selection, one section up.
 *
 * No `Array.isArray` "never configured" sentinel here, unlike `selected_frameworks` right
 * above it — and that asymmetry is deliberate, not an oversight a later edit should "fix"
 * by adding one. `selected_frameworks` needs the sentinel because an empty stored array is
 * genuinely ambiguous: it could mean "never configured, use the shipped defaults" or "the
 * operator explicitly chose zero frameworks", and only a sentinel lets those two read
 * apart. There is no equivalent ambiguity here: the non-empty default lives entirely in
 * scopeFiveRs's derivation, never in this stored value, so an absent or empty pin list
 * means exactly one thing — no overrides — whether the operator never opened the scope
 * picker or opened it and pinned nothing. Both cases are the same state and behave
 * identically, so there is nothing for a sentinel to distinguish.
 */
export function getFiveRsPins(settings: Rec): ScopePins {
  return coercePins(settings["five_rs_policy_pins"]);
}

export function withFiveRsPins(settings: Rec, pins: unknown): Rec {
  return { ...settings, five_rs_policy_pins: coercePins(pins) };
}

/**
 * `coercePins` plus the containment rule `cleanStepVars` (scanVars.ts) established: an id
 * absent from the synced policy catalogue is dropped rather than carried forward forever,
 * junk is coerced rather than thrown on, and the result is deduped with `out` winning an
 * in/out contradiction. Never throws — a hand-edited cell degrades to fewer pins, not to a
 * broken settings load.
 */
export function cleanFiveRsPins(pins: unknown, knownPolicyIds: string[]): ScopePins {
  const known = new Set(knownPolicyIds);
  const base = coercePins(pins);
  return {
    in: base.in.filter((id) => known.has(id)),
    out: base.out.filter((id) => known.has(id)),
  };
}
