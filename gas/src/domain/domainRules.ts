// Rule-based domain assignment — the port of wiz_dashboard/domain/domain_rules.py.
//
// A domain is a named ordered bucket with rules; rule = AND of conditions; a domain
// claims a finding when ANY rule matches (OR); domains evaluate in list order and the
// first match wins, else UNASSIGNED. Malformed rules/conditions fail closed (never
// match). The pandas-vectorized path is not ported — a plain per-record loop over
// <=100k rows is fast enough in JS and is the semantics the Python tests pin down.

import { present, type Rec } from "./util";

export const UNASSIGNED = "Unassigned";

// Backtracking mitigation for user-supplied patterns.
export const MAX_REGEX_LEN = 200;

// ledger episodes surface with this placeholder asset name; a name regex must never
// "match" it — episodes carry no asset data and stay Unassigned.
const COMPACTED_ASSET = "(compacted)";

const FRAME_NAME_COLS = ["vulnerableAsset.name"];
const FRAME_SUB_COLS = [
  "vulnerableAsset.subscriptionName",
  "vulnerableAsset.subscriptionExternalId",
  "vulnerableAsset.subscriptionId",
];
const FRAME_TAGS_PREFIX = "vulnerableAsset.tags.";
const LEDGER_NAME_COLS = ["asset_name"];
const LEDGER_SUB_COLS = ["subscription_name", "subscription_ext_id"];
// Support group is resolved live (like _domain) and attached to each record as
// _supportGroup by the server before assignment; the pure engine only reads it.
// vulnerableAsset.supportGroup / support_group cover a raw nested or ledger shape.
const FRAME_SG_COLS = ["_supportGroup", "vulnerableAsset.supportGroup"];
const LEDGER_SG_COLS = ["support_group"];

type CondSpec =
  | { kind: "tag"; key: string; value: string | null }
  | { kind: "regex"; re: RegExp }
  | { kind: "sub"; values: Set<string> }
  | { kind: "sg"; values: Set<string> };

export interface CompiledDomain {
  name: string;
  rules: (CondSpec[] | null)[]; // null = a rule that never matches
}

// Python str.casefold() is slightly more aggressive than toLowerCase() (e.g. "ß"→"ss");
// for cloud tags/subscription names (ASCII identifiers) the two agree.
function fold(v: unknown): string {
  return String(v).trim().toLowerCase();
}

// Python-repr-style rendering for validation messages ('bogus', None, True, 3).
function pyRepr(v: unknown): string {
  if (typeof v === "string") return `'${v}'`;
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

function compileCondition(cond: unknown): CondSpec | null {
  if (!cond || typeof cond !== "object" || Array.isArray(cond)) return null;
  const c = cond as Rec;
  const ctype = c["type"];
  if (ctype === "tag") {
    const key = c["key"];
    if (typeof key !== "string" || !key.trim()) return null;
    const value = c["value"];
    if (
      value !== null &&
      value !== undefined &&
      !["string", "number", "boolean"].includes(typeof value)
    ) {
      return null;
    }
    return {
      kind: "tag",
      key: key.trim(),
      value: value === null || value === undefined ? null : fold(value),
    };
  }
  if (ctype === "name_regex") {
    const pattern = c["pattern"];
    if (typeof pattern !== "string" || !pattern.trim() || pattern.length > MAX_REGEX_LEN) {
      return null;
    }
    try {
      return { kind: "regex", re: new RegExp(pattern, "i") };
    } catch {
      return null;
    }
  }
  if (ctype === "subscription") {
    const values = c["values"];
    if (!Array.isArray(values) || !values.length) return null;
    const folded = new Set<string>();
    for (const v of values) {
      if ((typeof v === "string" || typeof v === "number") && String(v).trim()) {
        folded.add(fold(v));
      }
    }
    return folded.size ? { kind: "sub", values: folded } : null;
  }
  if (ctype === "support_group") {
    const values = c["values"];
    if (!Array.isArray(values) || !values.length) return null;
    const folded = new Set<string>();
    for (const v of values) {
      if ((typeof v === "string" || typeof v === "number") && String(v).trim()) {
        folded.add(fold(v));
      }
    }
    return folded.size ? { kind: "sg", values: folded } : null;
  }
  return null;
}

/**
 * Persisted items -> priority-ordered compiled domains. Structurally hopeless items
 * are skipped; a rule containing any malformed condition is kept as never-match so
 * partial corruption fails closed instead of widening a domain.
 */
export function compileDomains(items: unknown): CompiledDomain[] {
  const compiled: CompiledDomain[] = [];
  for (const item of (items as unknown[]) ?? []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const it = item as Rec;
    const name = it["name"];
    if (typeof name !== "string" || !name.trim()) continue;
    const rules: (CondSpec[] | null)[] = [];
    for (const rule of (it["rules"] as unknown[]) ?? []) {
      const conds =
        rule && typeof rule === "object" && !Array.isArray(rule)
          ? (rule as Rec)["conditions"]
          : null;
      if (!Array.isArray(conds) || !conds.length) {
        rules.push(null);
        continue;
      }
      const specs = conds.map(compileCondition);
      rules.push(specs.some((s) => s === null) ? null : (specs as CondSpec[]));
    }
    compiled.push({ name: name.trim(), rules });
  }
  return compiled;
}

/** Human-readable errors for a would-be items list; [] when saveable. */
export function validateDomains(items: unknown): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(items) ? items : [];
  list.forEach((item, idx) => {
    const i = idx + 1;
    let label = `Domain ${i}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label}: not a valid entry.`);
      return;
    }
    const it = item as Rec;
    const rawName = it["name"];
    if (typeof rawName !== "string" || !rawName.trim()) {
      errors.push(`${label}: name is required.`);
    } else {
      const name = rawName.trim();
      label = `Domain “${name}”`;
      if (name.toLowerCase() === UNASSIGNED.toLowerCase()) {
        errors.push(`${label}: “${UNASSIGNED}” is reserved.`);
      }
      if (name.includes(",")) errors.push(`${label}: names cannot contain commas.`);
      if (seen.has(name.toLowerCase())) errors.push(`${label}: duplicate name.`);
      seen.add(name.toLowerCase());
    }
    const rules = it["rules"];
    if (!Array.isArray(rules) || !rules.length) {
      errors.push(`${label}: needs at least one rule.`);
      return;
    }
    rules.forEach((rule, jdx) => {
      const j = jdx + 1;
      const conds =
        rule && typeof rule === "object" && !Array.isArray(rule)
          ? (rule as Rec)["conditions"]
          : null;
      if (!Array.isArray(conds) || !conds.length) {
        errors.push(`${label}, rule ${j}: needs at least one condition.`);
        return;
      }
      conds.forEach((cond, kdx) => {
        const where = `${label}, rule ${j}, condition ${kdx + 1}`;
        if (!cond || typeof cond !== "object" || Array.isArray(cond)) {
          errors.push(`${where}: not a valid condition.`);
          return;
        }
        const c = cond as Rec;
        const ctype = c["type"];
        if (ctype === "tag") {
          const key = c["key"];
          if (typeof key !== "string" || !key.trim()) {
            errors.push(`${where}: tag key is required.`);
          }
        } else if (ctype === "name_regex") {
          const pattern = c["pattern"];
          if (typeof pattern !== "string" || !pattern.trim()) {
            errors.push(`${where}: pattern is required.`);
          } else if (pattern.length > MAX_REGEX_LEN) {
            errors.push(`${where}: pattern is longer than ${MAX_REGEX_LEN} characters.`);
          } else {
            try {
              new RegExp(pattern);
            } catch (exc) {
              errors.push(`${where}: pattern does not compile (${String(exc)}).`);
            }
          }
        } else if (ctype === "subscription") {
          const values = c["values"];
          if (
            !Array.isArray(values) ||
            !values.some((v) => typeof v === "string" && v.trim())
          ) {
            errors.push(`${where}: pick at least one subscription.`);
          }
        } else if (ctype === "support_group") {
          const values = c["values"];
          if (
            !Array.isArray(values) ||
            !values.some((v) => typeof v === "string" && v.trim())
          ) {
            errors.push(`${where}: pick at least one support group.`);
          }
        } else {
          errors.push(`${where}: unknown condition type ${pyRepr(ctype)}.`);
        }
      });
    });
  });
  return errors;
}

/** Priority-ordered domain names with UNASSIGNED appended (filter options). */
export function domainNames(items: unknown): string[] {
  const names: string[] = [];
  for (const item of (Array.isArray(items) ? items : []) as unknown[]) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const name = (item as Rec)["name"];
      if (typeof name === "string" && name.trim()) names.push(name.trim());
    }
  }
  return [...names, UNASSIGNED];
}

function recordTags(record: Rec): Rec {
  const va = record["vulnerableAsset"];
  if (va && typeof va === "object" && !Array.isArray(va)) {
    const t = (va as Rec)["tags"];
    if (t && typeof t === "object" && !Array.isArray(t)) return t as Rec;
  }
  const flat = record["vulnerableAsset.tags"];
  if (flat && typeof flat === "object" && !Array.isArray(flat)) return flat as Rec;
  const out: Rec = {};
  for (const [k, v] of Object.entries(record)) {
    if (k.startsWith(FRAME_TAGS_PREFIX) && present(v)) out[k.slice(FRAME_TAGS_PREFIX.length)] = v;
  }
  if (Object.keys(out).length) return out;
  const tagsJson = record["tags_json"];
  if (typeof tagsJson === "string" && tagsJson) {
    try {
      const parsed = JSON.parse(tagsJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Rec;
    } catch {
      // fall through
    }
  }
  return {};
}

/** ALL present values among dotted keys (unlike lifecycle.field's first-wins). */
function recordValues(record: Rec, ...keys: string[]): string[] {
  const out: string[] = [];
  const va = record["vulnerableAsset"];
  for (const k of keys) {
    const v = record[k];
    if (present(v)) {
      out.push(String(v));
    } else if (va && typeof va === "object" && !Array.isArray(va)) {
      const leaf = (va as Rec)[k.split(".").pop()!];
      if (present(leaf)) out.push(String(leaf));
    }
  }
  return out;
}

function conditionMatches(spec: CondSpec, record: Rec, tags: Rec): boolean {
  if (spec.kind === "tag") {
    if (!(spec.key in tags) || tags[spec.key] === null || tags[spec.key] === undefined) {
      return false;
    }
    return spec.value === null || fold(tags[spec.key]) === spec.value;
  }
  if (spec.kind === "regex") {
    const names = recordValues(record, ...FRAME_NAME_COLS);
    const pool = names.length ? names : recordValues(record, ...LEDGER_NAME_COLS);
    return pool.some((n) => spec.re.test(n));
  }
  if (spec.kind === "sg") {
    const sgs = [
      ...recordValues(record, ...FRAME_SG_COLS),
      ...recordValues(record, ...LEDGER_SG_COLS),
    ];
    return sgs.some((s) => spec.values.has(fold(s)));
  }
  const subs = [
    ...recordValues(record, ...FRAME_SUB_COLS),
    ...recordValues(record, ...LEDGER_SUB_COLS),
  ];
  return subs.some((s) => spec.values.has(fold(s)));
}

/** The domain a single finding record belongs to (first match wins). */
export function assignDomain(record: Rec, compiled: CompiledDomain[]): string {
  const name = recordValues(record, ...LEDGER_NAME_COLS);
  if (name.length && name[0] === COMPACTED_ASSET) return UNASSIGNED;
  const tags = recordTags(record);
  for (const dom of compiled) {
    for (const rule of dom.rules) {
      if (rule && rule.every((spec) => conditionMatches(spec, record, tags))) {
        return dom.name;
      }
    }
  }
  return UNASSIGNED;
}

/** Domain per record over a whole list (the vectorized-path replacement). */
export function assignDomains(records: Rec[], compiled: CompiledDomain[]): string[] {
  return records.map((r) => assignDomain(r, compiled));
}
