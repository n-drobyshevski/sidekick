// Secrets: a `secretInstances` node list -> one ledger observation per finding.
//
// Pure. No Apps Script global, same rule as wizQueries.ts, so the probe and the tests can
// bundle and import it without a runtime.
//
// This module exists because the secrets register returns TWO API ROWS FOR ONE FINDING and
// no field on the node says so. PROBE_FINDINGS.md §10.6, measured over the whole 1,958-row
// CODE population:
//
//     rows 1,958   REPOSITORY 1,359 · REPOSITORY_BRANCH 599
//     (secretDataId, path, lineNumber) keys spanning BOTH resource types: 187
//     identical externalId across the twin: 0 · different: 187
//
// So the same credential, in the same file, at the same line, is indexed once against the
// repository and once against the branch — and Wiz's own composite id splices the branch
// segment in, which makes it DIFFER for all 187:
//
//     REPOSITORY         github.com##<org>/<repo>##<path>##<hash>##<line>
//     REPOSITORY_BRANCH  github.com##<org>/<repo>##<branch>##<path>##<hash>##<line>
//
// THE KEY IS DERIVED, NEVER ADOPTED, and that deliberately inverts the OS ledger's first
// rule. gas/src/domain/lifecycle.ts::vulnKey prefers the Wiz `id` because there it is
// stable per FINDING. Here every candidate Wiz identifier — `id`, `externalId` — is stable
// per ROW, and the row is not the finding. §9.5 recommended `externalId` on the strength of
// it being unique across the register; §10.6 established it is unique BECAUSE IT PRESERVES
// THE DUPLICATE. A ledger keyed on it records one secret as two findings with two clocks.
//
// And the two clocks genuinely disagree (§10.7):
//
//     which twin is EARLIER: REPOSITORY 52 · REPOSITORY_BRANCH 135 · same 0
//     gap (days): median 19.9   max 285.3   over 30d: 83 of 187
//
// Neither resource type is reliably older, so the register cannot prefer one. It takes the
// earliest and — because collapsing to the earliest DISCARDS a measurement — it writes the
// gap it discarded into the row. The clock has to say where it started.

import {
  RESOLVED_STATUSES, SEVERITY_ORDER, STATUS_OPEN, STATUS_RESOLVED,
} from "./config";
import { normalizeSeverity } from "./severity";
import { sha1Hex } from "./sha1";
import { clean, groupBy, parseTs, toIso, type Rec } from "./util";

const DAY_MS = 86_400_000;

/** Wiz's `SecretInstanceValidationStatus`. Four states, and only two of them are measured. */
export type ValidationState = "VALID" | "INVALID" | "ERROR" | "UNKNOWN";

/**
 * Precedence when twins disagree about whether the credential is live.
 *
 * VALID first: it means the credential still WORKS, and a live secret losing to a dead
 * reading is the one direction of this rule that gets someone hurt. UNKNOWN last, and never
 * able to override either measured state — in this tenant 393,443 of 394,927 instances are
 * UNKNOWN (§3), so an "unmeasured wins" rule would erase the 0.38% that is measured.
 */
const VALIDATION_RANK: Record<ValidationState, number> = {
  VALID: 0, INVALID: 1, ERROR: 2, UNKNOWN: 3,
};

export function normalizeValidation(v: unknown): ValidationState {
  const s = typeof v === "string" ? v.toUpperCase().trim() : "";
  return s === "VALID" || s === "INVALID" || s === "ERROR" ? s : "UNKNOWN";
}

/** One ledger observation: the fields a scan can assert about a finding, before reconcile. */
export interface SecretObservation {
  finding_key: string;
  scope: "secrets";
  /** The credential — `secretDataId`. Rotation groups by this, across every occurrence. */
  identifier: string | null;
  /** Where it sits, as one readable string: `path:line`. */
  component: string | null;
  severity: string;
  secret_kind: string | null;
  confidence: string | null;
  repo_id: string | null;
  repo_name: string | null;
  branch: string | null;
  platform: string | null;
  file_path: string | null;
  start_line: number | null;
  origin: string | null;
  first_seen: string | null;
  last_seen: string | null;
  status: string;
  resolved_at: string | null;
  validation_state: ValidationState;
  validated_at: string | null;
  rotated_at: string | null;
  removed_at: string | null;
  owner_project: string | null;
  owner_path: string | null;
  /** How many API rows folded into this one. 1 for a finding with no twin. */
  twin_count: number;
  /**
   * The `firstSeenAt` disagreement the collapse discarded, in days. 0 when the twins agree
   * or there is only one row. §10.7 measured a median of 19.9 and a max of 285.3 — a number
   * that large has to be visible in the row, not only in the module that threw it away.
   */
  twin_first_seen_spread_days: number;
  /** JSON array of the collapsed `externalId`s, so the fold is auditable back to Wiz. */
  source_external_ids: string;
}

export interface CollapseResult {
  observations: SecretObservation[];
  /** Input rows read. */
  nodes: number;
  /** Findings out. `nodes - findings` is how many rows the twin fold removed. */
  findings: number;
  /** Findings built from more than one row. §10.6 measured 187 over the CODE population. */
  twinned: number;
  /**
   * Rows whose `lineNumber` was absent, so their key carries no line.
   *
   * Reported rather than discovered: without a line the key is only (secretDataId, path),
   * which §9.5 measured colliding 2.27:1. These rows keep a DISTINCT key (see
   * secretsFindingKey) rather than merging onto the colliding pair, but a sync should say
   * how many it had.
   */
  keyed_without_line: number;
}

function str(v: unknown): string | null {
  const c = clean(v);
  return c === null ? null : String(c);
}

/**
 * The ledger identity: `secrets:h:` + sha1(secretDataId | path | lineNumber), 16 hex.
 *
 * The `secrets:` / `h:` prefixes are the namespace convention vulnKey established, kept for
 * the same reason: two identity schemes must never be able to collide, and a later scheme
 * (a line-stable key, if one is ever found) has to be distinguishable from this one.
 *
 * A MISSING lineNumber joins the basis as the empty string. That is a distinct namespace
 * from line 0 — not a merge back onto the (secretDataId, path) pair that collides 2.27:1 —
 * so an unlined row stands alone rather than absorbing every other finding in its file.
 */
export function secretsFindingKey(node: Rec): string {
  const line = clean(node["lineNumber"]);
  const basis = [
    str(node["secretDataId"]) ?? "",
    str(node["path"]) ?? "",
    line === null ? "" : String(line),
  ].join("|");
  return `secrets:h:${sha1Hex(basis).slice(0, 16)}`;
}

function severityRank(sev: string): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(sev);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

/** The resource a row was indexed against — `REPOSITORY` or `REPOSITORY_BRANCH` (§10.6). */
function resourceType(node: Rec): string | null {
  const res = node["resource"];
  return res && typeof res === "object" ? str((res as Rec)["type"]) : null;
}

function resourceField(node: Rec, field: string): string | null {
  const res = node["resource"];
  return res && typeof res === "object" ? str((res as Rec)[field]) : null;
}

function isOpen(node: Rec): boolean {
  const s = str(node["status"]);
  return s === null ? true : !RESOLVED_STATUSES.has(s.toUpperCase());
}

/**
 * Fold a scan's nodes to one observation per finding.
 *
 * EVERY field needs a rule, not just the birth date. §10.7 measured the twins disagreeing
 * about `firstSeenAt`; nothing established that they agree about anything else, and an
 * unstated rule is whichever row the API happened to return first.
 */
export function collapseTwins(nodes: readonly Rec[]): CollapseResult {
  const groups = groupBy(nodes, secretsFindingKey);
  const observations: SecretObservation[] = [];
  let twinned = 0;
  let keyedWithoutLine = 0;

  for (const rows of groups.values()) {
    if (rows.length > 1) twinned += 1;
    if (clean(rows[0]!["lineNumber"]) === null) keyedWithoutLine += rows.length;

    // --- the clock. Earliest birth, latest sighting, and the gap written down.
    const births = rows.map((r) => parseTs(r["firstSeenAt"])).filter((t): t is number => t !== null);
    const firstMs = births.length ? Math.min(...births) : null;
    const spreadDays = births.length > 1 ? (Math.max(...births) - Math.min(...births)) / DAY_MS : 0;
    const sightings = rows.map((r) => parseTs(r["lastSeenAt"])).filter((t): t is number => t !== null);
    const lastMs = sightings.length ? Math.max(...sightings) : null;

    // --- status. OPEN wins if ANY twin is open.
    // brick/devsecops/ledger.py::observed, on the same problem: "a duplicate should not be
    // able to assert a resolution its twin disagrees with". A secret still present on one
    // indexed entity is still in the repository.
    const anyOpen = rows.some(isOpen);
    const resolvedTs = rows
      .map((r) => parseTs(r["resolvedAt"]))
      .filter((t): t is number => t !== null);
    // Only when every twin agrees it is gone, and then the LATEST date — the finding was
    // still visible somewhere until the last of them closed.
    const resolvedMs = !anyOpen && resolvedTs.length === rows.length ? Math.max(...resolvedTs) : null;

    // --- severity. A detection graded twice takes the worse grade.
    let severity = "UNKNOWN";
    for (const r of rows) {
      const s = normalizeSeverity(r["severity"]);
      if (severityRank(s) < severityRank(severity)) severity = s;
    }

    // --- the rotation axis, which is NOT the removal axis (§3).
    let best = rows[0]!;
    let bestState = normalizeValidation(best["validationStatus"]);
    for (const r of rows.slice(1)) {
      const state = normalizeValidation(r["validationStatus"]);
      if (VALIDATION_RANK[state] < VALIDATION_RANK[bestState]) {
        best = r;
        bestState = state;
      }
    }
    // validated_at travels with the state that won, so a stale VALID is tellable from a
    // fresh one rather than being dated by whichever twin was checked most recently.
    const validatedAt = toIso(parseTs(best["lastValidatedAt"]));

    // --- the asset. The repository entity is the stable one; only the branch twin has a
    // branch. §10.6: 173 of 187 branch names are `X/branch` on the repository's `X`.
    const repoRow = rows.find((r) => resourceType(r) === "REPOSITORY") ?? rows[0]!;
    const branchRow = rows.find((r) => resourceType(r) === "REPOSITORY_BRANCH") ?? null;
    const repoName = resourceField(repoRow, "name");
    const branchName = branchRow === null ? null : resourceField(branchRow, "name");
    // The branch entity is named `<repo>/<branch>`; the ledger wants the branch alone.
    const branch =
      branchName !== null && repoName !== null && branchName.startsWith(`${repoName}/`)
        ? branchName.slice(repoName.length + 1)
        : branchName;

    const projects = Array.isArray(rows[0]!["projects"]) ? (rows[0]!["projects"] as Rec[]) : [];
    const owner = projects.find((p) => p && p["isFolder"] !== true) ?? projects[0] ?? null;

    const path = str(repoRow["path"]);
    const line = clean(repoRow["lineNumber"]);

    observations.push({
      finding_key: secretsFindingKey(repoRow),
      scope: "secrets",
      identifier: str(repoRow["secretDataId"]),
      component: path === null ? null : line === null ? path : `${path}:${String(line)}`,
      severity,
      secret_kind: str(repoRow["type"]),
      confidence: str(repoRow["confidence"]),
      repo_id: resourceField(repoRow, "id"),
      repo_name: repoName,
      branch,
      platform: resourceField(repoRow, "cloudPlatform"),
      file_path: path,
      start_line: typeof line === "number" ? line : line === null ? null : Number(line),
      origin: str(
        (repoRow["vcsDetails"] as Rec | undefined)?.["initialCommitHash"] ?? null,
      ),
      first_seen: toIso(firstMs),
      last_seen: toIso(lastMs),
      status: anyOpen ? STATUS_OPEN : STATUS_RESOLVED,
      resolved_at: toIso(resolvedMs),
      validation_state: bestState,
      validated_at: validatedAt,
      // ONLY on INVALID. rotated_at means "observed dead at this time"; setting it from a
      // VALID or an UNKNOWN check would publish an unmeasured credential as rotated, which
      // on a register that is 99.6% UNKNOWN is the absent-is-never-zero failure at scale.
      rotated_at: bestState === "INVALID" ? validatedAt : null,
      // The string leaving HEAD is a DISAPPEARANCE, and a disappearance is visible only by
      // comparing two scans. The normalizer sees one, so it never sets this — reconcile does.
      removed_at: null,
      owner_project: owner === null ? null : str(owner["name"]),
      owner_path: owner === null ? null : str(owner["slug"]),
      twin_count: rows.length,
      twin_first_seen_spread_days: spreadDays,
      source_external_ids: JSON.stringify(
        rows.map((r) => str(r["externalId"])).filter((v): v is string => v !== null),
      ),
    });
  }

  return {
    observations,
    nodes: nodes.length,
    findings: observations.length,
    twinned,
    keyed_without_line: keyedWithoutLine,
  };
}
