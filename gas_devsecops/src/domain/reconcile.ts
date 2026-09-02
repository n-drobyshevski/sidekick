// Pure cross-scan reconciliation for the three-scope code register.
//
// A TS -> TS port of gas/src/domain/reconcile.ts, with brick/devsecops/ledger.py::reconcile
// as the second oracle (brick pins the same test/fixtures/reconcile.json in
// brick/tests/test_ledger.py::test_matches_the_gas_reconcile_fixture). Where the two
// disagree the divergence is called out in a comment rather than papered over; there are
// three, all marked "DIVERGENCE" below.
//
// Lifecycle rules — the same five gas/ and brick both implement:
//   * First sighting      -> OPEN, first_seen = min(API birth date, scan ts).
//   * Persisting (OPEN)   -> advance last_seen; keep first_seen earliest-known.
//   * API-resolved        -> resolvedAt present or status in RESOLVED_STATUSES.
//   * Disappearance       -> was OPEN and present in the immediately previous scan covering
//                            its severity, absent now -> resolved at the current scan ts.
//   * Reopen              -> a RESOLVED finding reappears active -> OPEN again,
//                            reopened_count++, first_seen reset (a new episode).
//
// WHAT THIS PORT CHANGES, and why each change is here rather than in gas/:
//
// 1. `scope` IS REQUIRED AND IS STAMPED ON EVERY ROW. Keys come from
//    lifecycle.findingKey(scope, node) and are never re-derived here. The same CVE reaching
//    the estate through a dependency and through first-party code is two findings with two
//    clocks (config.ts's SCOPES comment).
//
// 2. COLUMN NAMES COME FROM sheetsDb.ts's TAB_HEADERS[TABS.ledger] / ledgerTypes.ts's
//    LEDGER_COLUMNS, not from gas/: vuln_key -> finding_key, cve -> identifier,
//    asset_id/asset_name -> repo_id/repo_name, cloud -> platform, plus branch, component,
//    and the per-scope extras. Three gas/ columns have NO counterpart here and are dropped
//    rather than renamed — see test/reconcile.test.ts, which lists each one with its reason
//    instead of silently letting it fall off the fixture shim.
//
// 3. `published_date` IS GONE. gas/ carries it (and a REMEDIATION_ROLLOUT_ISO migration
//    floor) because its ledger predates the column; this register is fresh, has no CVE
//    publication clock in its brief, and TAB_HEADERS has no column to write it to.
//
// 4. SECRETS TWINS ARE FOLDED BEFORE THE LOOP. Wiz emits the same credential twice — once
//    against the REPOSITORY resource and once against REPOSITORY_BRANCH — with different
//    `id`, different `externalId` and DIFFERENT BIRTH DATES (PROBE_FINDINGS.md §10.6/§10.7:
//    187 twin keys, externalId differs on all 187, median firstSeenAt gap 19.9 d, max
//    285.3 d). findingKey already collapses them onto one key; without a fold the loop's
//    first-wins dedupe would then pick whichever page arrived first and take ITS clock.
//    See foldSecretTwins for the precedence, which is a CHOICE and says so.
//
// 5. SECRETS CARRY A SECOND LIFECYCLE. `removed_at` (the string left HEAD) and `rotated_at`
//    (the credential was observed dead) are two dates because they are two events. Removal
//    is not rotation.
//
// THREE UPDATE DISCIPLINES COEXIST HERE and mixing them up is the easiest way to get a
// wrong number out of this module (the same split sheetsDb.ts's header names):
//
//   latest-wins (erasable)      severity, status, identifier, component
//   latest-wins, never erased   repo_*, owner_*, cwe, language, ai_verdict, secret_kind,
//                               confidence, file_path, start_line, origin, fixed_version,
//                               tags_json — a blank in this scan must not erase what an
//                               earlier scan saw (brick's `_keep`, gas/'s `x || row.x`)
//   sticky first-wins,          fix_date, fix_observed_at, rotated_at, removed_at
//     reset by a reopen
//   monotone, never reset       has_kev / has_exploit (null -> false -> true), epss keeps
//                               the PEAK, risk_observed_at keeps the EARLIEST witness
//   latest-wins among           validation_state / validated_at — UNKNOWN and ERROR are
//     MEASURED states only      unmeasured and never overwrite a measured VALID/INVALID
//
// null NEVER MEANS false. Wiz returns null for a signal it did not evaluate; collapsing that
// to false is what makes an unassessed finding render clean. That holds for the three risk
// columns and for validation_state alike.

import {
  RESOLUTION_API,
  RESOLUTION_DISAPPEARED,
  RESOLVED_STATUSES,
  STATUS_OPEN,
  STATUS_RESOLVED,
  type Scope,
} from "./config";
import { findingKey } from "./lifecycle";
import { normalizeSeverity } from "./severity";
import {
  clean,
  maxNum,
  median,
  midpointIso,
  minIso,
  minNum,
  parseTs,
  present,
  pyStr,
  toIso,
  type Rec,
} from "./util";
import type {
  Deltas,
  LedgerRow,
  Observation,
  ReconcileOptions,
  RiskSignalFields,
} from "./ledgerTypes";

const DAY_MS = 86_400_000;

/** The validation states that were actually MEASURED. UNKNOWN and ERROR are not answers. */
const MEASURED_VALIDATION = new Set(["VALID", "INVALID"]);

/** The resource type Wiz uses for the branch-scoped half of a secrets twin. */
const RESOURCE_BRANCH = "REPOSITORY_BRANCH";

// --------------------------------------------------------------------------- #
//  Value access
// --------------------------------------------------------------------------- #

/**
 * One dotted path off a node, tolerating BOTH the nested GraphQL shape and the flattened
 * "a.b" key form. Generalizes util.field(), whose nested unwrap is hardcoded to
 * `vulnerableAsset` — SCA reads that prefix, but SAST and secrets read `resource`,
 * `aiAnalysis`, `artifactType` and `vcsDetails`, and a helper that only knows one prefix
 * would silently return "" for the other four.
 *
 * "" for absent, exactly like util.field, so `||` chains read the same as gas/'s do.
 */
function dottedRaw(record: Rec, path: string): unknown {
  const flat = record[path];
  if (present(flat)) return flat;
  let cur: unknown = record;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return null;
    cur = (cur as Rec)[seg];
  }
  return present(cur) ? cur : null;
}

function dotted(record: Rec, path: string): string {
  const v = dottedRaw(record, path);
  return v === null ? "" : pyStr(v);
}

/** First present dotted path as a string, or null when none of them are there. */
function str(record: Rec, ...paths: string[]): string | null {
  for (const p of paths) {
    const v = dotted(record, p);
    if (v !== "") return v;
  }
  return null;
}

/** A finite number off a dotted path, or null. */
function num(record: Rec, path: string): number | null {
  const v = dottedRaw(record, path);
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Canonical JSON with sorted keys — json.dumps(sort_keys=True) parity for the flat
 * string/number/bool values these maps actually carry. Sorted keys keep delete-rebuild and
 * checkpoint replays byte-stable. Extracted from gas/'s tagsJson so `projectsJson` below
 * can render through the same writer rather than a second copy of it.
 */
function canonicalJson(entries: Rec): string | null {
  const keys = Object.keys(entries).sort();
  if (!keys.length) return null;
  const parts = keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(entries[k])}`);
  return `{${parts.join(", ")}}`;
}

const TAGS_PREFIX = "vulnerableAsset.tags.";

/**
 * The asset's tags as canonical JSON (sorted keys), or null when absent. Accepts the nested
 * raw node (vulnerableAsset.tags dict) and the flattened vulnerableAsset.tags.<key> record
 * shape. Literal port of gas/src/domain/reconcile.ts's tagsJson, kept byte-for-byte because
 * test/fixtures/tags_json.json pins it — SCA reads the same `vulnerabilityFindings`
 * connection the OS-vuln register does, so its nodes carry `vulnerableAsset` unchanged.
 */
export function tagsJson(record: Rec): string | null {
  const va = record["vulnerableAsset"];
  let tags: Rec | null = null;
  if (va && typeof va === "object" && !Array.isArray(va)) {
    const t = (va as Rec)["tags"];
    if (t && typeof t === "object" && !Array.isArray(t)) tags = t as Rec;
  }
  if (tags === null) {
    const flat = record["vulnerableAsset.tags"];
    if (flat && typeof flat === "object" && !Array.isArray(flat)) tags = flat as Rec;
  }
  if (tags === null) {
    const collected: Rec = {};
    for (const [k, v] of Object.entries(record)) {
      if (k.startsWith(TAGS_PREFIX) && clean(v) !== null) {
        collected[k.slice(TAGS_PREFIX.length)] = v;
      }
    }
    tags = collected;
  }
  const kept: Rec = {};
  for (const [k, v] of Object.entries(tags)) {
    if (clean(v) !== null || v === "") kept[String(k)] = v;
  }
  return canonicalJson(kept);
}

/** The `projects[]` entries of a node, or [] when it carries none. */
function projectList(record: Rec): Rec[] {
  const raw = record["projects"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is Rec => p !== null && typeof p === "object" && !Array.isArray(p));
}

/**
 * `projects[]` as canonical JSON — `{slug: name}`, sorted by slug, through the same writer
 * gas/'s tagsJson uses. This register's ownership dimension is the project hierarchy rather
 * than cloud tags: wizQueries.ts records that `subscriptionName` is always null on a
 * repository branch, which is why the two subscription columns did not survive the rename.
 *
 * Keyed on `slug` (falling back to `id`) rather than `name`, because slug is the stable
 * machine-readable identity and a display name can be re-typed without the project changing.
 */
export function projectsJson(record: Rec): string | null {
  const entries: Rec = {};
  for (const p of projectList(record)) {
    const key = str(p, "slug", "id");
    const name = str(p, "name");
    if (key !== null) entries[key] = name ?? key;
  }
  return canonicalJson(entries);
}

/**
 * Ownership, from `projects[]`. THIS PAIR IS A CHOICE, not a measurement — Wiz returns
 * projects as a FLAT list with an `isFolder` flag and no parent links (probe sample:
 * VALUE-CHAIN folder, product-TATTOO-idp leaf, CE-TRANSPORT folder, GITHUB-DKTUNITED leaf,
 * in that order), so no true hierarchy path can be reconstructed from a node alone:
 *
 *   owner_project  the FIRST non-folder project's name — the team that owns the work, which
 *                  is the grain everything downstream groups by. Falls back to the first
 *                  project of any kind so a node whose projects are all folders still names
 *                  an owner rather than reading as unowned.
 *   owner_path     the FOLDER names, SORTED and joined " / " — the context above the owner.
 *                  Sorted rather than left in API order because API order is not depth order
 *                  and a stored string has to be byte-stable across scans.
 *
 * If a later package learns the real hierarchy (the `repos` tab carries `projects_json` for
 * exactly that), owner_path is the field to re-derive; owner_project is not affected.
 */
export function ownerProject(record: Rec): string | null {
  const projects = projectList(record);
  const leaf = projects.find((p) => p["isFolder"] !== true);
  return str(leaf ?? projects[0] ?? {}, "name");
}

export function ownerPath(record: Rec): string | null {
  const names: string[] = [];
  for (const p of projectList(record)) {
    if (p["isFolder"] !== true) continue;
    const n = str(p, "name");
    if (n !== null) names.push(n);
  }
  if (!names.length) return null;
  return names.sort().join(" / ");
}

/**
 * Split a Wiz asset/resource name into (repo, branch).
 *
 * A REPOSITORY resource is named `owner/repo`; the REPOSITORY_BRANCH form appends the
 * branch — PROBE_FINDINGS.md §10.6 measured 173 of 187 twins in exactly that prefix
 * relation (`X` and `X/branch`), and the live samples agree:
 *   sca   vulnerableAsset.name "dktunited/retbox-front/main"   type REPOSITORY_BRANCH
 *   sast  resource.name        "dktunited/tattoo/stab"         type REPOSITORY_BRANCH
 *
 * CAVEAT, stated because the split is a heuristic and not a field: a branch name CONTAINING
 * a slash ("feature/x") splits wrong — repo gains a segment and branch loses one. Wiz
 * exposes no separate branch field on either connection, so there is nothing to measure it
 * against; the alternative (always null) throws away a dimension that is right in the common
 * case. A node whose type is not REPOSITORY_BRANCH keeps its whole name and has no branch.
 */
function splitRepoBranch(
  name: string | null,
  type: string | null,
): { repo: string | null; branch: string | null } {
  if (name === null) return { repo: null, branch: null };
  if ((type ?? "").toUpperCase() !== RESOURCE_BRANCH) return { repo: name, branch: null };
  const i = name.lastIndexOf("/");
  if (i <= 0 || i === name.length - 1) return { repo: name, branch: null };
  return { repo: name.slice(0, i), branch: name.slice(i + 1) };
}

/**
 * The ecosystem as a single value, from a field the API returns as an array on SAST
 * (`codeLibraryLanguage: ["JAVA"]`) and as a bare string on SCA
 * (`artifactType.codeLibraryLanguage: "JAVASCRIPT"` in the live probe sample).
 *
 * First rather than exploded, matching brick's `_first_language`: P2P groups each asset into
 * exactly one category, and a finding reporting two languages would otherwise be counted in
 * both and double every density figure.
 */
function firstLanguage(v: unknown): string | null {
  if (Array.isArray(v)) {
    for (const item of v) {
      if (present(item)) return pyStr(item);
    }
    return null;
  }
  return present(v) ? pyStr(v) : null;
}

/**
 * `weaknesses[].id` as a comma-separated string — null when there are none.
 *
 * SORTED before joining, following brick's `_joined_cwes`: the same set of weaknesses has to
 * produce the same string every scan, because this value is merged into a stored row and
 * compared against the previous one. The D2 brief says only "joined with ','" and does not
 * fix an order; brick fixes it, and a deterministic string is the strictly safer reading.
 *
 * null, not "": an absent weakness is NOT OBSERVED, which makes the finding unclassified
 * rather than low risk (config.ts's CWE_TOP_25_2024 / CWE_ANCESTORS are what read it).
 */
function joinedCwes(record: Rec): string | null {
  const raw = record["weaknesses"];
  if (!Array.isArray(raw)) return null;
  const ids: string[] = [];
  for (const w of raw) {
    if (w === null || typeof w !== "object" || Array.isArray(w)) continue;
    const id = str(w as Rec, "id");
    if (id !== null) ids.push(id);
  }
  if (!ids.length) return null;
  return ids.sort().join(",");
}

// --------------------------------------------------------------------------- #
//  Per-observation attribute projection
// --------------------------------------------------------------------------- #

/**
 * The display/asset attributes one observation contributes, already renamed onto the ledger's
 * columns. Everything here is null when the node does not carry it, so the two merge
 * disciplines below (`latest-wins` vs `latest-wins-never-erased`) can both be expressed as
 * one-liners rather than repeated `field(...) || row.x` chains.
 */
interface Attributes {
  identifier: string | null;
  component: string | null;
  repo_id: string | null;
  repo_name: string | null;
  branch: string | null;
  platform: string | null;
  fixed_version: string | null;
  cwe: string | null;
  ai_verdict: string | null;
  language: string | null;
  file_path: string | null;
  start_line: number | null;
  origin: string | null;
  secret_kind: string | null;
  confidence: string | null;
  owner_project: string | null;
  owner_path: string | null;
  tags_json: string | null;
}

/**
 * Project one node onto the ledger's attribute columns, per scope.
 *
 * The field names are read off the query documents in src/server/wizQueries.ts, and the
 * asymmetries between them are the whole reason this is a dispatch rather than one mapping:
 * SCA's asset is the `vulnerableAsset` union, SAST's and secrets' is a plain `resource`;
 * SAST spells the location `filePath`/`startLine` and secrets `path`/`lineNumber` — and
 * `lineNumber` is part of the secrets row key, so the column it lands in has to be the one
 * the key is read back from.
 */
function attributes(rec: Rec, scope: Scope): Attributes {
  const empty: Attributes = {
    identifier: null, component: null,
    repo_id: null, repo_name: null, branch: null, platform: null,
    fixed_version: null, cwe: null, ai_verdict: null, language: null,
    file_path: null, start_line: null, origin: null,
    secret_kind: null, confidence: null,
    owner_project: ownerProject(rec),
    owner_path: ownerPath(rec),
    // projects[] is this register's ownership dimension on all three scopes; the
    // vulnerableAsset.tags fallback is what keeps gas/'s tags_json fixture live for SCA,
    // whose nodes come off the same connection the OS register reads.
    tags_json: projectsJson(rec) ?? tagsJson(rec),
  };

  if (scope === "sast") {
    const parts = splitRepoBranch(str(rec, "resource.name"), str(rec, "resource.type"));
    return {
      ...empty,
      // brick/devsecops/metrics.py:365 puts the weakness TITLE here ("SQL Injection"), not
      // an identifier — it is what every panel groups on to answer "what kind of thing is
      // this". The identifier-shaped value lives in `cwe`.
      identifier: (clean(rec["name"]) as string | null) ?? null,
      // DIVERGENCE (brick): brick/devsecops/metrics.py:362 aliases `filePath` as `component`
      // for SAST. This register has a dedicated `file_path` column, so writing the path into
      // both would store the same string twice under two names; `component` stays null for
      // sast and secrets per the D2 brief. Reported, not papered over.
      component: null,
      repo_id: str(rec, "resource.id"),
      repo_name: parts.repo,
      branch: parts.branch,
      // Q_SAST's `resource { id name type }` selects no cloudPlatform — an honest gap, not a
      // dropped mapping. There is nothing on the SAST node to fill `platform` from.
      platform: null,
      cwe: joinedCwes(rec),
      ai_verdict: str(rec, "aiAnalysis.verdict")?.trim().toUpperCase() ?? null,
      language: firstLanguage(dottedRaw(rec, "codeLibraryLanguage")),
      file_path: str(rec, "filePath"),
      start_line: num(rec, "startLine"),
      origin: str(rec, "origin"),
    };
  }

  if (scope === "secrets") {
    const parts = splitRepoBranch(str(rec, "resource.name"), str(rec, "resource.type"));
    return {
      ...empty,
      // identifier <- secretDataId: it names the CREDENTIAL, and is what a rotation decision
      // groups by. It is deliberately NOT the row key (that is the (secretDataId, path,
      // lineNumber) hash in lifecycle.findingKey) — the same credential in five files is
      // five findings and one rotation.
      identifier: (clean(rec["secretDataId"]) as string | null) ?? null,
      component: null,
      repo_id: str(rec, "resource.id"),
      repo_name: parts.repo,
      branch: parts.branch,
      platform: str(rec, "resource.cloudPlatform"),
      secret_kind: str(rec, "type"),
      confidence: str(rec, "confidence"),
      file_path: str(rec, "path"),
      start_line: num(rec, "lineNumber"),
    };
  }

  // sca
  const parts = splitRepoBranch(
    str(rec, "vulnerableAsset.name"),
    str(rec, "vulnerableAsset.type"),
  );
  return {
    ...empty,
    identifier: (clean(rec["name"]) as string | null) ?? null,
    // The package, per brick/devsecops/metrics.py:269 — `detailedName` is "braces" on the
    // live probe sample where `name` is "CVE-2024-4068".
    component: str(rec, "detailedName"),
    repo_id: str(rec, "vulnerableAsset.id"),
    repo_name: parts.repo,
    branch: parts.branch,
    platform: str(rec, "vulnerableAsset.cloudPlatform"),
    fixed_version: str(rec, "fixedVersion"),
    // Filled for sca as well as sast, following brick's `_first_language`: Q_SCA selects
    // `artifactType { codeLibraryLanguage }` and brick's asset_profile groups the SCA
    // register by exactly this value. Leaving it null here would make every SCA asset group
    // read UNKNOWN downstream.
    language: firstLanguage(dottedRaw(rec, "artifactType.codeLibraryLanguage")),
  };
}

// --------------------------------------------------------------------------- #
//  Exploit intelligence — monotone, idempotent, order-independent
// --------------------------------------------------------------------------- #

export function emptyRiskSignals(): RiskSignalFields {
  return { has_kev: null, has_exploit: null, epss: null, risk_observed_at: null };
}

/**
 * Hydrate the four risk columns off a STORED row — a sheet row, a Drive snapshot row, or a
 * migration-bundle row. Blank/absent stays `null` (never coerced to `false` or `0`, which
 * would turn "not captured" into "captured, and the answer was no"); the plain-text ledger
 * grid round-trips booleans as the strings "TRUE"/"FALSE", which observeRiskSignals' coercion
 * already understands.
 */
export function coerceRiskSignals(r: Rec): RiskSignalFields {
  const obs = observeRiskSignals({
    hasCisaKevExploit: r["has_kev"],
    hasExploit: r["has_exploit"],
    epssProbability: r["epss"],
  });
  return {
    has_kev: obs.kev,
    has_exploit: obs.exploit,
    epss: obs.epss,
    risk_observed_at: (clean(r["risk_observed_at"]) as string | null) ?? null,
  };
}

/**
 * One observation's exploit-intelligence signals, each **null when the record does not carry
 * it at all** — which is emphatically not the same as an observed `false`. A slim record
 * written before these fields were captured simply lacks the keys; a tenant whose Wiz plan
 * omits EPSS returns null; and SAST and secrets nodes never carry any of the three. All of
 * those must stay distinguishable from "observed, and the answer was no", or every
 * coverage/efficiency rate silently imputes a negative.
 */
export function observeRiskSignals(
  rec: Rec,
): { kev: boolean | null; exploit: boolean | null; epss: number | null } {
  const bool = (v: unknown): boolean | null => {
    if (typeof v === "boolean") return v;
    // Sheets round-trip: the ledger grid is plain-text formatted (sheetsDb.ensureTabs), so a
    // boolean written with setValues reads back as the string "TRUE"/"FALSE".
    if (typeof v === "string") {
      const s = v.trim().toUpperCase();
      if (s === "TRUE") return true;
      if (s === "FALSE") return false;
    }
    return null;
  };
  const rawEpss = clean(rec["epssProbability"]);
  const n = typeof rawEpss === "number" ? rawEpss : rawEpss === null ? NaN : Number(rawEpss);
  return {
    kev: bool(rec["hasCisaKevExploit"]),
    exploit: bool(rec["hasExploit"]),
    epss: Number.isFinite(n) ? (n as number) : null,
  };
}

/**
 * Merge one observation's risk signals into a row, in place — **monotone, idempotent and
 * order-independent**. Booleans go null -> false -> true and never back; `epss` keeps the
 * peak observed; `risk_observed_at` keeps the earliest witnessing scan.
 *
 * Deliberately NOT the latest-observation-wins treatment severity / identifier / the asset
 * columns get below. Exploit knowledge is monotone in reality (a CVE does not become
 * un-exploited, KEV entries are effectively never withdrawn); EPSS genuinely decays, so PEAK
 * EPSS is a deliberate choice — the question coverage asks is "was this something you should
 * have prioritized", not "is it still scary today". Keeping the high-risk label monotone is
 * also what stops a finding leaving the coverage denominator between scans and rewriting an
 * already-published trend point.
 *
 * Order-independence is what lets an archive backfill replay saved scans newest-first, resume
 * after a crash, and be re-run from scratch, all converging on byte-identical state.
 *
 * Note the divergence from the vendor-fix clock: risk signals do NOT reset on reopen. Exploit
 * availability is a property of the vulnerability, not of the episode.
 */
export function mergeRiskSignals(row: RiskSignalFields, rec: Rec, scanTsIso: string): void {
  const obs = observeRiskSignals(rec);
  // `== null` (not `=== null`) also catches undefined on rows read back from a sheet written
  // before these columns existed.
  if (obs.kev !== null && (row.has_kev == null || obs.kev)) row.has_kev = obs.kev;
  if (obs.exploit !== null && (row.has_exploit == null || obs.exploit)) {
    row.has_exploit = obs.exploit;
  }
  if (obs.epss !== null && (row.epss == null || obs.epss > row.epss)) row.epss = obs.epss;
  const witnessed = obs.kev !== null || obs.exploit !== null || obs.epss !== null;
  if (!witnessed) return;
  // Earliest-wins, and genuinely a min rather than a first-wins guard: a backfill replays
  // scans newest-first, so a later call can legitimately carry an earlier timestamp.
  if (row.risk_observed_at == null || scanTsIso < row.risk_observed_at) {
    row.risk_observed_at = scanTsIso;
  }
}

// --------------------------------------------------------------------------- #
//  Secrets twin fold
// --------------------------------------------------------------------------- #

/** What the fold did, published beside the result so a sync can report it rather than infer it. */
export interface TwinStats {
  /** How many finding_keys arrived carrying more than one node. */
  keys: number;
  /** How many nodes were collapsed away — sum of (nodes - 1) over those keys. */
  folded: number;
  /** Median |max firstSeenAt - min firstSeenAt| in days over the folded keys; null when none. */
  medianGapDays: number | null;
}

export function emptyTwinStats(): TwinStats {
  return { keys: 0, folded: 0, medianGapDays: null };
}

/**
 * Collapse Wiz's REPOSITORY / REPOSITORY_BRANCH twins of the same secret into one node.
 *
 * THIS RUNS BEFORE THE LOOP, and that placement is the point. findingKey already maps both
 * twins onto one key, so without a fold the loop's duplicate-within-a-scan rule (first wins)
 * would take whichever twin's page came back first — and PROBE_FINDINGS.md §10.7 measured
 * that the two twins' birth dates disagree by a median of 19.9 days and up to 285.3, with
 * the branch twin earlier in 135 of 187 cases and the repository twin in the other 52. Page
 * order would therefore decide the MTTR clock.
 *
 * THE PRECEDENCE BELOW IS A CHOICE, NOT A MEASUREMENT. §10.7 establishes that neither
 * resource type is reliably older, so there is no twin to simply prefer; what follows is the
 * rule this register writes down instead:
 *
 *   firstSeenAt                the EARLIEST across the twins — the clock convention the OS
 *                              ledger already uses, and the only one that cannot invent age.
 *   resource (and so repo_*,   the REPOSITORY_BRANCH twin when one is present. The branch
 *   branch, platform)          form is strictly more specific: it names the branch the string
 *                              is actually on, which the repository form cannot.
 *   status / validationStatus  the twin with the LATER lastSeenAt — the freshest observation
 *   (and everything else)      of the two, since a stale twin's OPEN says nothing about a
 *                              removal the fresher one already recorded.
 *
 * Ties on lastSeenAt keep input order (first wins), so the fold is deterministic on a payload
 * whose twins carry the same timestamp.
 */
export function foldSecretTwins(nodes: Rec[]): { nodes: Rec[]; stats: TwinStats } {
  const groups = new Map<string, Rec[]>();
  const order: string[] = [];
  for (const n of nodes) {
    const key = findingKey("secrets", n);
    const bucket = groups.get(key);
    if (bucket) bucket.push(n);
    else {
      groups.set(key, [n]);
      order.push(key);
    }
  }

  const out: Rec[] = [];
  const gaps: number[] = [];
  let keys = 0;
  let folded = 0;

  for (const key of order) {
    const bucket = groups.get(key)!;
    if (bucket.length === 1) {
      out.push(bucket[0]!);
      continue;
    }
    keys += 1;
    folded += bucket.length - 1;

    const births: number[] = [];
    for (const n of bucket) {
      const t = parseTs(n["firstSeenAt"]);
      if (t !== null) births.push(t);
    }
    // maxNum/minNum rather than Math.max(...arr): a spread turns every element into a call
    // argument and overflows the stack on findings-scale input (util.ts's note).
    if (births.length > 1) gaps.push((maxNum(births) - minNum(births)) / DAY_MS);

    let base = bucket[0]!;
    let baseSeen = parseTs(base["lastSeenAt"]);
    for (let i = 1; i < bucket.length; i += 1) {
      const cand = bucket[i]!;
      const t = parseTs(cand["lastSeenAt"]);
      if (t !== null && (baseSeen === null || t > baseSeen)) {
        base = cand;
        baseSeen = t;
      }
    }

    const merged: Rec = { ...base };
    if (births.length) merged["firstSeenAt"] = toIso(minNum(births));

    const branchTwin = bucket.find(
      (n) => (str(n, "resource.type") ?? "").toUpperCase() === RESOURCE_BRANCH,
    );
    if (branchTwin !== undefined && branchTwin !== base) {
      // Drop base's resource in BOTH the nested and the flattened spelling before overlaying
      // the branch twin's, or a leftover flattened key would win over the nested object in
      // dottedRaw's present()-first lookup.
      for (const k of Object.keys(merged)) {
        if (k === "resource" || k.startsWith("resource.")) delete merged[k];
      }
      for (const [k, v] of Object.entries(branchTwin)) {
        if (k === "resource" || k.startsWith("resource.")) merged[k] = v;
      }
    }
    out.push(merged);
  }

  return {
    nodes: out,
    stats: { keys, folded, medianGapDays: gaps.length ? median(gaps) : null },
  };
}

// --------------------------------------------------------------------------- #
//  reconcile
// --------------------------------------------------------------------------- #

export interface ReconcileResult {
  ledger: Record<string, LedgerRow>;
  observations: Observation[];
  deltas: Deltas;
  /** Always present; zeroed for sca/sast, which have no twins to fold. */
  twinStats: TwinStats;
}

function makeRow(
  key: string,
  scope: Scope,
  attrs: Attributes,
  sev: string,
  firstSeen: string | null,
  scanId: string,
  scanTs: string,
  fixDate: string | null,
  fixObservedAt: string | null,
): LedgerRow {
  return {
    finding_key: key,
    scope,
    identifier: attrs.identifier,
    component: attrs.component,
    severity: sev,
    repo_id: attrs.repo_id,
    repo_name: attrs.repo_name,
    branch: attrs.branch,
    platform: attrs.platform,
    first_seen: firstSeen,
    last_seen: scanTs,
    status: STATUS_OPEN,
    resolved_at: null,
    resolution_src: null,
    reopened_count: 0,
    first_scan_id: scanId,
    last_scan_id: scanId,
    fix_date: fixDate,
    fix_observed_at: fixObservedAt,
    fixed_version: attrs.fixed_version,
    // Left null here and filled by mergeRiskSignals() after the branch, which runs identically
    // for new, reopened and persisting rows.
    ...emptyRiskSignals(),
    cwe: attrs.cwe,
    ai_verdict: attrs.ai_verdict,
    language: attrs.language,
    file_path: attrs.file_path,
    start_line: attrs.start_line,
    origin: attrs.origin,
    secret_kind: attrs.secret_kind,
    rotated_at: null,
    removed_at: null,
    // Left null here and filled by applyValidation() after the branch, for the same reason
    // the risk merge is: the rule is identical in all three branches.
    validation_state: null,
    validated_at: null,
    confidence: attrs.confidence,
    owner_project: attrs.owner_project,
    owner_path: attrs.owner_path,
    tags_json: attrs.tags_json,
  };
}

/**
 * The secrets validation axis. LATEST-WINS AMONG MEASURED STATES ONLY: `VALID` and `INVALID`
 * are answers, `UNKNOWN` and `ERROR` are the absence of one, and letting an UNKNOWN overwrite
 * a VALID would erase the only measurement the register ever got. In this tenant that is not
 * hypothetical — 393,443 of 394,927 secret instances read UNKNOWN (PROBE_FINDINGS.md §3), so
 * an unmeasured state is overwhelmingly the value that arrives.
 *
 * An unmeasured state may still FILL a currently-null column: recording "we looked and the
 * answer was UNKNOWN" is not the same as never having looked, and nothing is lost by it.
 *
 * `rotated_at` is then set ONCE, on the first INVALID OBSERVATION — the credential was seen
 * dead, and the date it stopped working cannot arrive twice. Dated from this observation's
 * `lastValidatedAt`, which is when the check was actually made; when the API reports INVALID
 * with no lastValidatedAt the row falls back to the SCAN ts, dating rotation by observation
 * rather than dropping a measured death on the floor. That fallback is the same shape
 * resolve-by-disappearance uses, and it is a deliberate addition to the D2 brief's "from
 * validated_at" rather than an oversight.
 *
 * It keys on the OBSERVED state rather than on the stored one, and that is load-bearing: a
 * reopen clears rotated_at (the episode's death is undone), and re-deriving it here from a
 * still-INVALID stored `validation_state` would silently put it straight back and make the
 * clearing unobservable. Rotation is dated by a measurement, not by a memory of one.
 *
 * REMOVED IS NOT ROTATED. Nothing here touches `removed_at`, which is the other axis: the
 * string left HEAD. A credential is live until this function says otherwise.
 */
function applyValidation(row: LedgerRow, rec: Rec, scanTsIso: string): void {
  const observedState = (str(rec, "validationStatus") ?? "").trim().toUpperCase();
  if (observedState === "") return;
  const observedAt = present(rec["lastValidatedAt"])
    ? toIso(parseTs(rec["lastValidatedAt"]))
    : null;
  const observedMeasured = MEASURED_VALIDATION.has(observedState);
  const currentMeasured = MEASURED_VALIDATION.has((row.validation_state ?? "").toUpperCase());
  if (observedMeasured || !currentMeasured) {
    row.validation_state = observedState;
    row.validated_at = observedAt;
  }
  if (observedState === "INVALID" && row.rotated_at == null) {
    row.rotated_at = observedAt ?? scanTsIso;
  }
}

/**
 * Reconcile one scan against the prior ledger.
 *
 * Returns {ledger, observations, deltas, twinStats}; NEITHER INPUT IS MUTATED.
 * `options.scope` is required — it selects the node projection, it prefixes every key, and it
 * is stamped on every row.
 */
export function reconcile(
  currentRecords: Rec[],
  existingLedger: Record<string, LedgerRow>,
  scanId: string,
  scanTs: string,
  prevScanId: string | null,
  options: ReconcileOptions,
): ReconcileResult {
  const {
    scope,
    disappearanceMode = "scan_ts",
    prevScanTs = null,
    scannedSeverities = null,
    prevScanIdBySeverity = null,
  } = options;

  // Rows are flat scalar records, so a shallow per-row copy preserves the input.
  const updated: Record<string, LedgerRow> = {};
  for (const [key, row] of Object.entries(existingLedger)) updated[key] = { ...row };

  const seen = new Set<string>();
  const observations: Observation[] = [];
  let newCount = 0;
  let resolvedCount = 0;
  let reopenedCount = 0;

  const scanTsIso = toIso(parseTs(scanTs)) ?? String(scanTs);

  // Twins first — see foldSecretTwins for why this cannot be left to the loop's first-wins
  // dedupe. sca and sast nodes carry a Wiz-assigned id and have no twins, so they skip it.
  const folded =
    scope === "secrets"
      ? foldSecretTwins(currentRecords)
      : { nodes: currentRecords, stats: emptyTwinStats() };

  for (const rec of folded.nodes) {
    const key = findingKey(scope, rec);
    if (seen.has(key)) continue; // duplicate within the same scan — first wins
    seen.add(key);

    // SAST's severity falls back to `originalSeverity`, the scanner's own call before any Wiz
    // policy adjusted it (brick/devsecops/metrics.py:365-368). `severity` is the primary
    // because the register should read the severity the programme is actually managing to;
    // Q_SAST selects both for exactly this, and the live sample carries
    // `severity: "HIGH", originalSeverity: null`.
    const sev = normalizeSeverity(
      scope === "sast"
        ? (clean(rec["severity"]) ?? clean(rec["originalSeverity"]))
        : clean(rec["severity"]),
    );

    // THE BIRTH DATE, and the register has to say where it started. `firstSeenAt` is the
    // secrets spelling and `createdAt` the SAST one — CLAUDE.md's "SAST has a birth date and
    // no death date": SASTFinding exposes createdAt, Q_SAST selects it, and it is the only
    // reason SAST gets a genuine MTTR rather than an age metric. Falling through to the scan
    // ts below is what dates a finding the API gave no birth date for.
    //
    // DIVERGENCE (brick): brick/devsecops/metrics.py:371 hard-codes `null_ts` for SAST's
    // first_detected_at, so its SAST rows are dated from OBSERVATION alone — a leftover from
    // when its SAST query selected no timestamps (the claim at brick's ingest.py:206 that
    // silver_sast already reads the column is not true of the code). The live probe
    // falsified the premise on 2026-08-27; this port reads the column.
    const apiFirst =
      clean(rec["firstDetectedAt"]) ?? clean(rec["firstSeenAt"]) ?? clean(rec["createdAt"]);
    const apiStatus = String(clean(rec["status"]) ?? "").toUpperCase();
    const apiResolved =
      clean(rec["resolvedAt"]) ?? clean(rec["remediatedAt"]) ?? clean(rec["fixedAt"]);
    const apiSaysResolved = present(apiResolved) || RESOLVED_STATUSES.has(apiStatus);

    const attrs = attributes(rec, scope);

    // Vendor-fix signal for this observation: a concrete fixedVersion or a fixDate. Only sca
    // ever carries either — SAST and secrets are fixed by us, not by an upstream — but the
    // capture is written generically because a node without the keys simply contributes
    // nothing, which is the right answer for those two scopes.
    const fixSignal = present(rec["fixedVersion"]) || present(rec["fixDate"]);
    const recFixDate = present(rec["fixDate"]) ? toIso(parseTs(rec["fixDate"])) : null;
    // Sticky first-wins: only ever fill a currently-empty field; never clear or overwrite.
    // `== null` also catches undefined from snapshot rows written before the columns existed.
    const seedFix = (r: LedgerRow): void => {
      if (r.fix_date == null && recFixDate !== null) r.fix_date = recFixDate;
      if (r.fix_observed_at == null && fixSignal) r.fix_observed_at = scanTsIso;
    };

    let row = updated[key];
    if (row === undefined) {
      const firstSeen = minIso(apiFirst, scanTsIso) ?? scanTsIso;
      row = makeRow(
        key, scope, attrs, sev, firstSeen, scanId, scanTsIso,
        recFixDate, fixSignal ? scanTsIso : null,
      );
      updated[key] = row;
      newCount += 1;
    } else if (row.status === STATUS_RESOLVED && !apiSaysResolved) {
      // Genuine reopen: start a new episode so the next resolution measures THIS episode, not
      // the original. The per-episode clocks reset — the prior episode's vendor fix is
      // irrelevant, and a secret that is back in HEAD is neither removed nor (any longer)
      // known dead — then re-seed from the reopening record.
      row.status = STATUS_OPEN;
      row.resolved_at = null;
      row.resolution_src = null;
      row.reopened_count = Number(row.reopened_count ?? 0) + 1;
      row.first_seen = minIso(apiFirst, scanTsIso) ?? scanTsIso;
      row.last_seen = scanTsIso;
      row.last_scan_id = scanId;
      row.fix_date = null;
      row.fix_observed_at = null;
      // `validation_state` is NOT cleared: it is the last measurement anyone made of the
      // credential, and a reopen is evidence about the string in HEAD, not about the
      // credential's liveness. rotated_at goes because it dates THIS episode's death.
      row.removed_at = null;
      row.rotated_at = null;
      seedFix(row);
      reopenedCount += 1;
    } else {
      // Persisting (OPEN) or a still-resolved finding being re-listed. Keep first_seen
      // earliest-known; never let it drift later.
      if (row.status === STATUS_OPEN) {
        row.first_seen = minIso(row.first_seen, apiFirst) ?? row.first_seen;
      }
      row.last_seen = scanTsIso;
      row.last_scan_id = scanId;
      seedFix(row);
    }

    // One call for all three branches above, because both merges are idempotent (unlike
    // seedFix, which has to run per-branch around the reopen reset).
    mergeRiskSignals(row, rec, scanTsIso);
    if (scope === "secrets") applyValidation(row, rec, scanTsIso);

    // Rule 1: scope is stamped on EVERY row, not only on the ones this scan created. Keys are
    // scope-prefixed so a row can never belong to another register, and re-stamping repairs a
    // row read back from a sheet written before the column existed.
    row.scope = scope;

    // Latest observation wins for the display attributes...
    row.severity = sev;
    row.identifier = attrs.identifier;
    // DIVERGENCE (brick): brick/devsecops/ledger.py:499 merges component with `_keep`, i.e.
    // never-erased. The D2 brief puts it in the latest-wins group beside identifier, which is
    // also what gas/ does with `cve` — so a scan that stops reporting a package clears the
    // column rather than leaving a stale one. Following the brief; reported, not papered over.
    row.component = attrs.component;
    // ...and latest-wins-NEVER-ERASED for everything an absent field could otherwise wipe.
    // A blank in this scan must never erase what an earlier scan saw (brick's `_keep`).
    row.repo_id = attrs.repo_id ?? row.repo_id;
    row.repo_name = attrs.repo_name ?? row.repo_name;
    row.branch = attrs.branch ?? row.branch;
    row.platform = attrs.platform ?? row.platform;
    row.fixed_version = attrs.fixed_version ?? row.fixed_version;
    row.cwe = attrs.cwe ?? row.cwe;
    row.ai_verdict = attrs.ai_verdict ?? row.ai_verdict;
    row.language = attrs.language ?? row.language;
    row.file_path = attrs.file_path ?? row.file_path;
    row.start_line = attrs.start_line ?? row.start_line;
    row.origin = attrs.origin ?? row.origin;
    row.secret_kind = attrs.secret_kind ?? row.secret_kind;
    row.confidence = attrs.confidence ?? row.confidence;
    row.owner_project = attrs.owner_project ?? row.owner_project;
    row.owner_path = attrs.owner_path ?? row.owner_path;
    row.tags_json = attrs.tags_json ?? row.tags_json;

    // API-declared resolution closes a currently-open row.
    if (apiSaysResolved && row.status === STATUS_OPEN) {
      row.status = STATUS_RESOLVED;
      row.resolved_at = present(apiResolved) ? toIso(parseTs(apiResolved)) : scanTsIso;
      row.resolution_src = RESOLUTION_API;
      // On secrets, an API resolution IS the removal event: PROBE_FINDINGS.md §3 maps
      // "secret removed from code" onto exactly `status -> RESOLVED, resolvedAt`. Sticky
      // first-wins, and it says nothing about rotation.
      if (scope === "secrets" && row.removed_at == null) row.removed_at = row.resolved_at;
      resolvedCount += 1;
    }

    observations.push({
      scan_id: scanId,
      finding_key: key,
      present: 1,
      severity: sev,
      status: row.status,
    });
  }

  // Disappearance: OPEN findings present in the immediately-previous covering scan but absent
  // now. Three conditions, each load-bearing — see the severity-scope guard below.
  if (prevScanId !== null) {
    const inScope = scannedSeverities !== null ? new Set(scannedSeverities) : null;
    for (const [key, row] of Object.entries(updated)) {
      if (seen.has(key) || row.status === STATUS_RESOLVED) continue;
      const sevRow = row.severity;
      if (inScope !== null && (sevRow === null || !inScope.has(sevRow))) {
        // THIS SEVERITY WAS NOT SCANNED, so its absence is expected rather than remediation.
        // DEFAULT_FETCH_SEVERITIES is CRITICAL,HIGH on sca and sast, so without this guard
        // every MEDIUM row in the ledger would vanish on the first scoped scan and
        // mass-resolve. Absence of something nobody looked for is not evidence.
        continue;
      }
      const expectedPrev = (prevScanIdBySeverity ?? {})[sevRow ?? ""] ?? prevScanId;
      // Only a finding that was in the IMMEDIATELY previous covering scan can be said to have
      // disappeared from it. A row last seen three scans ago already had its disappearance
      // adjudicated then; re-resolving it now would push resolved_at forward every run.
      if (row.last_scan_id !== expectedPrev) continue;
      if (disappearanceMode === "midpoint" && prevScanTs) {
        row.resolved_at = midpointIso(prevScanTs, scanTsIso);
      } else {
        row.resolved_at = scanTsIso;
      }
      row.status = STATUS_RESOLVED;
      row.resolution_src = RESOLUTION_DISAPPEARED;
      // REMOVED IS NOT ROTATED. A secret leaving the register means the string left HEAD;
      // the credential is live until validation_state/rotated_at says otherwise, and nothing
      // here touches either.
      if (scope === "secrets" && row.removed_at == null) row.removed_at = row.resolved_at;
      resolvedCount += 1;
      observations.push({
        scan_id: scanId,
        finding_key: key,
        present: 0,
        severity: row.severity,
        status: STATUS_RESOLVED,
      });
    }
  }

  return {
    ledger: updated,
    observations,
    deltas: {
      new_count: newCount,
      resolved_count: resolvedCount,
      reopened_count: reopenedCount,
    },
    twinStats: folded.stats,
  };
}
