// SCA and SAST nodes -> LedgerObservation. Secrets has its own module, and the reason is
// the most important thing in this file.
//
// THE KEY RULE DIFFERS BY SCOPE, AND THE FILTER IS WHY.
//
// gas/src/domain/lifecycle.ts::vulnKey prefers the Wiz `id` because there it is stable per
// FINDING. PROBE_FINDINGS.md §10.6 showed that is NOT true on secrets: 187 findings are
// indexed against both a repository and a branch, so every Wiz identifier there is stable
// per ROW, and the row is not the finding. secretsLedger.ts derives its key instead.
//
// SCA and SAST cannot have that problem, and it is not luck. Both are filtered to
// `isDefaultBranch { equals: true }` on the way in — SCA at the top level, SAST through
// `resource` — so exactly one entity per finding reaches the register. Secrets could not use
// that filter: §8.6 measured `245 + 0 != 691`, because a REPOSITORY-level entity has the
// flag ABSENT rather than false, and copying SCA's predicate would have cut the register by
// 65% while reading as deduplication. The filter that secrets cannot have is precisely what
// makes the other two single-entity, so `id:` is safe here and was not there.
//
// If either filter is ever broadened, this assumption breaks with it. That is why the reason
// is written here rather than the conclusion.

import { RESOLVED_STATUSES } from "./config";
import { emptyObservation, type LedgerObservation } from "./observation";
import { normalizeSeverity } from "./severity";
import { sha1Hex } from "./sha1";
import { clean, present, toIso, parseTs, type Rec } from "./util";

function str(v: unknown): string | null {
  const c = clean(v);
  return c === null ? null : String(c);
}

/** A nested field by dotted path, or null. The three scopes nest differently. */
function at(rec: Rec, path: string): unknown {
  let cur: unknown = rec;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return null;
    cur = (cur as Rec)[part];
  }
  return clean(cur);
}

/**
 * `id:<wiz id>`, or `h:<sha1 of the semantic identity>` when the API returned none.
 *
 * Both prefixes are load-bearing, and so is the third one secrets uses: they keep the
 * identity schemes in separate namespaces, so a finding that starts arriving with an id
 * cannot silently collide with the hash that was standing in for it.
 */
function adoptedKey(scope: "sca" | "sast", rec: Rec, basis: (string | null)[]): string {
  const id = str(rec["id"]);
  if (id !== null && id.trim()) return `${scope}:id:${id.trim()}`;
  return `${scope}:h:${sha1Hex(basis.map((v) => v ?? "").join("|")).slice(0, 16)}`;
}

/** Wiz's tri-state booleans: null means "never evaluated", which is not false. */
function triBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function triNum(v: unknown): number | null {
  const c = clean(v);
  if (c === null) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
}

/** The owning project — the first non-folder, else the first of any kind. */
function ownerProject(rec: Rec): Rec | null {
  const projects = Array.isArray(rec["projects"]) ? (rec["projects"] as Rec[]) : [];
  return projects.find((p) => p && p["isFolder"] !== true) ?? projects[0] ?? null;
}

/**
 * SCA: a known CVE in a third-party package at a version.
 *
 * The only scope with a vendor fix, and therefore the only one where the SECOND CLOCK means
 * anything — `fixDate` / `fixedVersion` are what separate "waiting for a vendor" from
 * "waiting for a team". It is also the only scope with exploit intelligence, and all three
 * of those signals are tri-state on purpose: Wiz returns null for a signal it never
 * evaluated, and collapsing that to false is what makes an unassessed finding look clean.
 */
export function normalizeSca(node: Rec): LedgerObservation {
  const cve = str(node["name"]);
  const component = str(node["detailedName"]);
  const assetId = str(at(node, "vulnerableAsset.id"));
  const assetName = str(at(node, "vulnerableAsset.name"));
  const status = String(str(node["status"]) ?? "").toUpperCase();
  const resolvedAt = str(node["resolvedAt"]);

  return {
    ...emptyObservation("sca", adoptedKey("sca", node, [
      cve, assetId ?? assetName, str(at(node, "vulnerableAsset.type")), component,
    ])),
    identifier: cve,
    component,
    severity: normalizeSeverity(node["severity"]),
    repo_id: assetId,
    repo_name: assetName,
    // A VulnerableAssetRepositoryBranch IS the branch, so its name is the branch identity.
    // The union member that carries no branch leaves this null rather than guessing.
    branch: str(at(node, "vulnerableAsset.type")) === "REPOSITORY_BRANCH" ? assetName : null,
    platform: str(at(node, "vulnerableAsset.cloudPlatform")),
    language: str(at(node, "artifactType.codeLibraryLanguage")),
    first_seen: toIso(parseTs(node["firstDetectedAt"])),
    resolved_at: toIso(parseTs(resolvedAt)),
    is_open: !(present(resolvedAt) || RESOLVED_STATUSES.has(status)),
    fix_date: toIso(parseTs(node["fixDate"])),
    fixed_version: str(node["fixedVersion"]),
    has_kev: triBool(node["hasCisaKevExploit"]),
    has_exploit: triBool(node["hasExploit"]),
    epss: triNum(node["epssProbability"]),
    owner_project: str(at(node, "vulnerableAsset.subscriptionName")),
    owner_path: str(at(node, "vulnerableAsset.subscriptionExternalId")),
  };
}

/**
 * SAST: a rule firing on a line of first-party source.
 *
 * THE ONLY SCOPE THAT CAN NEVER BE RESOLVED BY THE API. `SASTFinding` exposes `createdAt`
 * but no `resolvedAt`, and `status: RESOLVED` returns 0 rows in this tenant (§2) — which is
 * why `SAST_FETCH_RESOLVED` is false. `is_open` is therefore always true here, and every
 * SAST resolution in the ledger will carry `resolution_src: "disappeared"`.
 *
 * That is not a degraded clock. §2 established `createdAt` is populated and filterable, so a
 * SAST finding has a real birth date and a death dated by absence — a genuine MTTR rather
 * than an age metric, which is what `brick/devsecops/ledger.py` already does.
 *
 * The risk signals stay null, and that null is NOT-APPLICABLE rather than unmeasured: a
 * static-analysis finding has no CVE, so no KEV listing and no EPSS score exist for it.
 * `scope` is the discriminator (see observation.ts) — there is no fourth state column.
 */
export function normalizeSast(node: Rec): LedgerObservation {
  const rule = str(node["name"]);
  const filePath = str(node["filePath"]);
  const line = clean(node["startLine"]);
  const weaknesses = Array.isArray(node["weaknesses"]) ? (node["weaknesses"] as Rec[]) : [];
  const owner = ownerProject(node);
  const resource = (node["resource"] ?? null) as Rec | null;

  return {
    ...emptyObservation("sast", adoptedKey("sast", node, [
      rule, str(at(node, "resource.id")), filePath, line === null ? null : String(line),
    ])),
    identifier: rule,
    component: filePath === null ? null : line === null ? filePath : `${filePath}:${String(line)}`,
    severity: normalizeSeverity(node["severity"]),
    repo_id: resource === null ? null : str(resource["id"]),
    repo_name: resource === null ? null : str(resource["name"]),
    platform: resource === null ? null : str(resource["type"]),
    // The CWE the rule maps to. Wiz can return several; the first is the primary one, and
    // the ledger has one column — a joined list would break every group-by that reads it.
    cwe: weaknesses.length ? str(weaknesses[0]!["name"]) : null,
    language: str(node["codeLibraryLanguage"]),
    file_path: filePath,
    start_line: typeof line === "number" ? line : line === null ? null : Number(line),
    origin: str(at(node, "vcsDetails.commitHash")),
    // §2: createdAt is the birth date. firstDetectedAtSource is Wiz's own re-derivation and
    // can post-date it, so the earlier of the two would be wrong to take blindly — createdAt
    // is the one the filter sorts on and the one the register dates from.
    first_seen: toIso(parseTs(node["createdAt"])),
    resolved_at: null,
    is_open: true,
    owner_project: owner === null ? null : str(owner["name"]),
    owner_path: owner === null ? null : str(owner["slug"]),
  };
}

/** Normalizers by scope. Secrets is absent: it folds a LIST, not a node (see collapseTwins). */
export const NORMALIZERS = {
  sca: normalizeSca,
  sast: normalizeSast,
} as const;
