// Editable sync-step variables: which steps accept them, which knobs each one offers, and
// what a stored override must look like before it is allowed near a sync.
//
// WHY VARIABLES AND NOT THE DOCUMENT. Eight of the nine Wiz documents put their filter in a
// GraphQL variable, and the variables-builders in wizQueriesAi.ts exist precisely to be the
// customization point. That matters for safety, not just convenience: every normalizer in
// syncNormalize.ts couples to the document's SELECTION SET, and a variable cannot change a
// selection set. Editing the document itself is a different proposition — five steps carry
// invariants their response cannot confirm (`negate: true` IS the guardrail flag; the edge
// type comes from the function name; every issue attribute on the per-rule steps comes from
// a closed-over group), so an edited document there produces confident wrong data rather
// than an error. None of that is reachable from here.
//
// A bad value is still a real failure mode, just a loud one: Wiz rejects the filter with an
// HTTP 400, the step is optional, and the sync skips it. That is why the last run's skipped
// steps are recorded and shown — an edit that silently stops a step is the one outcome this
// feature must not hide.

import type { Rec } from "./util";

/** How a knob is edited. `list` is a set of string values; `enum` is one of a fixed set. */
export type VarFieldKind = "list" | "enum";

export interface VarField {
  /** Dotted path into the variables object, e.g. `filterBy.type.equals`. */
  path: string;
  label: string;
  help: string;
  kind: VarFieldKind;
  /** Suggestions for `list`, the permitted set for `enum`. */
  options?: string[];
  /** A `list` field that must not end up empty — an empty filter means "everything". */
  required?: boolean;
}

export interface StepVarSpec {
  stepId: string;
  /** Shown when a step takes no editable variables, saying why. */
  locked?: string;
  fields: VarField[];
}

/** Cap on a stored override: the whole map lives in one `value_json` cell. */
export const MAX_LIST_VALUES = 40;
export const MAX_VALUE_LEN = 120;

const ISSUE_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "REJECTED"];
const ORDER_DIRECTIONS = ["ASC", "DESC"];

/**
 * The knobs, per step. Only steps whose normalizer tolerates a changed filter appear here;
 * everything else is locked with the reason, because a lock without a reason reads as an
 * oversight and someone will "fix" it.
 */
export const STEP_VAR_SPECS: StepVarSpec[] = [
  {
    stepId: "INVENTORY_AI",
    fields: [
      {
        path: "filterBy.type.equals",
        label: "Resource types",
        help: "The Wiz resource types treated as AI assets. Resolved against this tenant's " +
          "schema by default; setting them here pins the list instead.",
        kind: "list",
        required: true,
      },
    ],
  },
  {
    stepId: "ISSUES_TOXIC",
    fields: [
      {
        path: "filterBy.status",
        label: "Issue status",
        help: "Which issue states to collect. Narrowing to OPEN drops in-progress work from " +
          "the register and from AARS pillar A.",
        kind: "list",
        options: ISSUE_STATUSES,
        required: true,
      },
      {
        path: "filterBy.type",
        label: "Issue types",
        // Optional, and empty is the default: the sync sends no type filter at all, so
        // the category decides what is collected and Wiz's taxonomy does not. Marking it
        // required would be incoherent now — an empty list and an absent one both mean
        // "every type", and only one of them would be rejected.
        help: "Empty (the default) collects every issue type in the AI risk category — " +
          "including kinds this register has never modelled, which land in Other AI risk. " +
          "Naming types here NARROWS that: each one left out disappears from the register " +
          "total and from AARS pillar A with nothing on the page to mark its absence. " +
          "Pinning TOXIC_COMBINATION and CLOUD_CONFIGURATION is what once hid every threat " +
          "detection in the category.",
        kind: "list",
        options: ["TOXIC_COMBINATION", "CLOUD_CONFIGURATION", "THREAT_DETECTION"],
      },
      {
        path: "filterBy.project",
        label: "Project scope",
        help: "Wiz project ids to restrict to. Empty means the whole tenant.",
        kind: "list",
      },
      {
        path: "orderBy.direction",
        label: "Order direction",
        help: "Which end of the severity order the paging walks first.",
        kind: "enum",
        options: ORDER_DIRECTIONS,
      },
    ],
    // Deliberately NOT offering filterBy.frameworkCategory. Every figure this app
    // publishes — the issue count, AARS pillar A, the Toxic Combinations page, the tab
    // literally called ai_issues — is scoped to wct-id-1998 and labelled AI. Nothing in
    // the response says "this is an AI issue"; the category filter IS the claim. Widen it
    // and "AI issues" silently means "all issues", with no field to catch it. Same reason
    // AGENTIC_IDENTITIES locks its purpose filter.
    locked: "The AI risk category (wct-id-1998) is fixed: it is what makes these issues AI " +
      "issues, so widening it would relabel the whole register rather than extend it.",
  },
  {
    stepId: "CONFIG_FINDINGS",
    fields: [
      {
        path: "filterBy.status",
        label: "Finding status",
        help: "Compliance findings are additionally filtered to result FAIL after they " +
          "arrive, so widening this collects more rows but stores only failures.",
        kind: "list",
        options: ["OPEN", "RESOLVED", "REJECTED"],
        required: true,
      },
      {
        path: "orderBy.direction",
        label: "Order direction",
        help: "Which end of the severity order the paging walks first.",
        kind: "enum",
        options: ORDER_DIRECTIONS,
      },
    ],
  },
  {
    stepId: "AGENTIC_IDENTITIES",
    fields: [
      {
        path: "filterBy.type.equals",
        label: "Identity types",
        help: "Which principal types to collect.",
        kind: "list",
        required: true,
      },
    ],
    // Deliberately NOT offering filterBy.identityPurpose. normalizePrincipalsPage stamps
    // identityPurpose = "AGENTIC" on every row it returns, because the API does not send the
    // field back — the flag is a claim about the filter, not about the data. Let the filter
    // widen and every identity in the estate is relabelled agentic, with nothing to catch it.
    locked: "The agentic-purpose filter is fixed: the sync labels what this query returns as " +
      "agentic, so widening it would mislabel every identity it collected.",
  },
  {
    stepId: "SENSITIVE_DATA_ACCESS",
    // No fields at all, so isEditableStep is false and the panel offers no control. Stated
    // here rather than left to fall through, because "nothing to edit" and "editing this
    // would be unsafe" are different facts and only the second one needs saying.
    fields: [],
    locked: "This step has no editable filter: normalizeSensitiveDataAccessPage rebuilds " +
      "the chain's edges from which entity TYPES a row carries, so a changed selection set " +
      "would yield confidently wrong edges rather than an error.",
  },
];

const SPEC_BY_STEP: Record<string, StepVarSpec> = {};
for (const spec of STEP_VAR_SPECS) SPEC_BY_STEP[spec.stepId] = spec;

export function varSpecFor(stepId: string): StepVarSpec | null {
  return SPEC_BY_STEP[stepId] ?? null;
}

export function isEditableStep(stepId: string): boolean {
  const spec = varSpecFor(stepId);
  return !!spec && spec.fields.length > 0;
}

// ------------------------------------------------------------------- path access

/** Read a dotted path, or undefined. Never throws on a missing branch. */
export function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Rec)[key];
  }
  return cur;
}

/** Write a dotted path, creating plain-object branches as needed. Mutates `obj`. */
export function writePath(obj: Rec, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur: Rec = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = cur[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) cur[key] = {};
    cur = cur[keys[i]] as Rec;
  }
  cur[keys[keys.length - 1]] = value;
}

// --------------------------------------------------------------- clean / validate
//
// Two stages, following the AARS rule precedent: `clean` coerces junk into the right shape
// and is never allowed to throw, so a hand-edited settings cell degrades to the defaults
// rather than breaking a sync; `validate` reports what a human got wrong, in their words,
// and is never silently repaired.

function cleanValue(v: unknown): string {
  return String(v ?? "").trim().slice(0, MAX_VALUE_LEN);
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const s = cleanValue(raw);
    if (s && out.indexOf(s) < 0) out.push(s);
    if (out.length >= MAX_LIST_VALUES) break;
  }
  return out;
}

/**
 * An override reduced to exactly the paths its spec names — anything else is dropped.
 *
 * That is the containment: a stored override can only ever move the knobs the spec offers,
 * so a hand-edited settings cell cannot smuggle a `first`, an `after`, or a whole foreign
 * variable into the request. `null` means "nothing overridden", and every caller treats it
 * as "use the builder's own value".
 */
export function cleanStepVars(stepId: string, raw: unknown): Rec | null {
  const spec = varSpecFor(stepId);
  if (!spec || !raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Rec = {};
  let touched = false;
  for (const field of spec.fields) {
    const value = readPath(raw, field.path);
    if (value === undefined || value === null) continue;
    if (field.kind === "list") {
      const list = cleanList(value);
      writePath(out, field.path, list);
      touched = true;
    } else {
      const s = cleanValue(value).toUpperCase();
      if (!s) continue;
      // An enum outside its option set is dropped rather than clamped: there is no
      // "nearest" ordering direction, and guessing one would be a silent decision.
      if (field.options && field.options.indexOf(s) < 0) continue;
      writePath(out, field.path, s);
      touched = true;
    }
  }
  return touched ? out : null;
}

/** What a human got wrong, in their words. Empty = saveable. */
export function validateStepVars(stepId: string, vars: Rec | null): string[] {
  const spec = varSpecFor(stepId);
  if (!spec) return [`${stepId} does not take editable variables.`];
  if (!vars) return [];
  const errors: string[] = [];
  for (const field of spec.fields) {
    const value = readPath(vars, field.path);
    if (value === undefined) continue;
    if (field.kind === "list") {
      const list = Array.isArray(value) ? value : [];
      if (field.required && !list.length) {
        errors.push(
          `${field.label} cannot be empty — an empty filter asks Wiz for everything, ` +
          `which is not what this step normalizes.`,
        );
      }
      if (list.length >= MAX_LIST_VALUES) {
        errors.push(`${field.label} is capped at ${MAX_LIST_VALUES} values.`);
      }
    }
  }
  return errors;
}

/**
 * The variables a step will actually send: its builder's own, with the stored override's
 * paths laid over the top. Overriding by PATH rather than replacing the object means a
 * stored value can never drop a key the builder added for a reason the operator has not
 * seen — the risk-category filter on issues, say.
 */
export function effectiveStepVars(stepId: string, base: Rec, override: unknown): Rec {
  const clean = cleanStepVars(stepId, override);
  if (!clean) return base;
  const spec = varSpecFor(stepId);
  const merged = JSON.parse(JSON.stringify(base ?? {})) as Rec;
  for (const field of (spec ? spec.fields : [])) {
    const value = readPath(clean, field.path);
    if (value === undefined) continue;
    writePath(merged, field.path, value);
  }
  return merged;
}

/** Which paths a stored override actually moves, for "N changed" in the UI. */
export function changedPaths(stepId: string, base: Rec, override: unknown): string[] {
  const clean = cleanStepVars(stepId, override);
  if (!clean) return [];
  const spec = varSpecFor(stepId);
  const out: string[] = [];
  for (const field of (spec ? spec.fields : [])) {
    const next = readPath(clean, field.path);
    if (next === undefined) continue;
    if (JSON.stringify(next) !== JSON.stringify(readPath(base, field.path))) out.push(field.path);
  }
  return out;
}
