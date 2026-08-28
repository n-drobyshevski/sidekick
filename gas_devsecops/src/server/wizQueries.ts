// The Wiz query layer: the documents this register sends, and the variables that scope them.
//
// NO APPS SCRIPT GLOBALS IN THIS FILE, EVER. probe.mjs bundles and imports it under plain
// Node so that a read-only probe sends THE APP'S OWN QUERIES rather than a hand-written
// approximation of them. The moment this file reaches for UrlFetchApp or PropertiesService,
// the probe stops being evidence about the battery. gas_ai keeps the same rule for the same
// reason.
//
// PROVENANCE. The two documents below are transcribed from brick/devsecops/ingest.py, which
// is tenant-verified: brick/devsecops/sast_response.json is a live capture of the SAST one
// (40 nodes, totalCount 11,406) and sca_response.json captures the grouped SCA shape. The
// selections and the filter spellings are theirs, not guesses.
//
// INLINE LITERALS DO NOT SURVIVE THIS GATEWAY. Filters go through $filterBy as variables,
// never interpolated into the document. gas_ai learned that twice.

import type { Scope } from "../domain/config";

/* ------------------------------------------------------------------ page sizes */

/**
 * One repository alone carries ~6,900 SCA findings and the SAST connection reports 11,406
 * across the estate, so paging is the normal case rather than the exception.
 */
export const PAGE_SIZE = 500;
/** Dropped to on a gateway complaint about cost. */
export const PAGE_SIZE_FALLBACK = 250;
/** A backstop against a cursor that never terminates, not a real expectation. */
export const MAX_PAGES = 1000;

/* --------------------------------------------------------------- the documents */

/**
 * SAST: a weakness class at a file and a line in first-party code.
 *
 * NOTE WHAT IS NOT HERE: any timestamp. Not firstDetectedAt, not resolvedAt, not fixDate.
 * That is not an omission — the documented selection set offers none, which is why this
 * register dates SAST from observation and why brick/devsecops refuses to fetch resolved
 * SAST rows at all (they would be born and closed in the same instant, giving a real
 * mttr_days == 0.0 that drags the median to the floor).
 *
 * THE THREE TIMESTAMPS, and why each is here (PROBE_FINDINGS.md §2, 2026-08-27):
 *
 *   createdAt              DateTime! — THE BIRTH DATE, and the whole reason SAST has a
 *                          clock. Filterable (SASTFindingFilters.createdAt) and sortable
 *                          (SASTFindingOrderField = CREATED_AT, SEVERITY). There is no
 *                          resolution date to pair it with; the ledger supplies that by
 *                          disappearance, which is what makes this a real MTTR rather
 *                          than an age metric.
 *   updatedAt              DateTime! — a lossy proxy for activity, NOT a resolution date.
 *                          It moves on any rescan and the sampled rows show it doing so.
 *                          Carried for staleness reporting only.
 *   firstDetectedAtSource  DateTime — the scanner's own first-detection date. Null on
 *                          every row sampled here, but a row that carries one should win,
 *                          since it predates our own observation.
 *
 * NOTE THE COMMENT STYLE. Nothing explanatory goes inside the document string: GraphQL
 * comments are `#`, not `//`, so a JS-style comment in here is a syntax error the server
 * rejects — and even a valid `#` comment ships over the wire on every page of every sync.
 *
 * `projects` and `vcsDetails.commitHash` are selected here but NOT in brick's version:
 * projects[] carries the folder/leaf team hierarchy that is this register's only ownership
 * dimension (subscriptionName is always null on a repository branch), and the commit hash is
 * what dates a secret or a weakness against history.
 */
export const Q_SAST = `query DevSecOpsSastFindings(
  $filterBy: SASTFindingFilters
  $first: Int
  $after: String
) {
  sastFindings(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      name
      status
      severity
      originalSeverity
      filePath
      startLine
      codeLibraryLanguage
      origin
      resolutionReason
      createdAt
      updatedAt
      firstDetectedAtSource
      resource { id name type }
      weaknesses { id name }
      projects { id name isFolder slug }
      vcsDetails { commitHash }
      aiAnalysis { verdict }
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * SCA: a known CVE in a third-party package at a version.
 *
 * `fixDate` and `fixedVersion` are the second clock's inputs and the reason this register
 * can separate "waiting for a vendor" from "waiting for a team". The three risk signals are
 * nullable on purpose — Wiz returns null for a signal it never evaluated, and roughly one
 * sample row in eight does.
 *
 * The vulnerableAsset union is narrowed to two members. A union fragment naming a member the
 * tenant does not have fails the WHOLE document, so the narrowing is load-bearing rather
 * than tidy; VulnerableAssetRepositoryBranch omits the two subscription fields because a
 * repository branch has neither.
 */
export const Q_SCA = `query DevSecOpsVulnerabilityFindings(
  $filterBy: VulnerabilityFindingFilters
  $first: Int
  $after: String
) {
  vulnerabilityFindings(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      name
      detailedName
      severity
      status
      firstDetectedAt
      lastDetectedAt
      resolvedAt
      fixDate
      fixedVersion
      hasExploit
      hasCisaKevExploit
      epssProbability
      vulnerableAsset {
        ... on VulnerableAssetBase {
          id
          type
          name
          cloudPlatform
          subscriptionName
          subscriptionExternalId
        }
        ... on VulnerableAssetRepositoryBranch {
          id
          type
          name
          cloudPlatform
        }
      }
      artifactType { codeLibraryLanguage }
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Secrets: a credential committed to a repository.
 *
 * Written from the schema, not from a vendor doc — PROBE_FINDINGS.md §3 and §7.3 are the
 * evidence for every field below, and three of them are traps worth stating:
 *
 *   1. THE COMMIT FIELD IS `initialCommitHash`, NOT `commitHash`. SASTFindingVcsDetails has
 *      `commitHash`; SecretInstanceVcsDetails has only `initialCommitHash` and
 *      `ciWorkflowRun`. Copying SAST's selection fails the WHOLE document, the same way a
 *      wrong union member would. The semantics are better here anyway — it is the commit
 *      that INTRODUCED the secret, which is what dates it against history.
 *   2. `secretDataId` is distinct from both `id` and `externalId`, and looks like the dedup
 *      key — what should collapse one credential appearing in five files into one rotation
 *      decision. Selected, but the ledger key must NOT depend on it until it is confirmed
 *      against data.
 *   3. `type` is a SecretDetectionRuleType, and that enum includes PUBLIC_KEY alongside
 *      SAAS_API_KEY, PRIVATE_KEY, PASSWORD, CLOUD_KEY and the rest. Not every row here is a
 *      live credential, so a rotation metric that counts them all measures the wrong
 *      population. Carried so the register can exclude rather than average.
 *
 * WHAT IS DELIBERATELY NOT SELECTED, and this is a security decision rather than an
 * oversight: `snippet` (the matched text) and `validationDetails`. This register's durable
 * store is a Google Sheet plus gzipped Drive archives, readable by everyone on the
 * allowlist and exportable to CSV by any of them — a far wider audience than the repository
 * the secret is in. 1,859 of the 1,933 CODE-scoped instances are OPEN, so most of that text
 * is live credential material. A secrets tool that copies secrets into a spreadsheet has
 * made the exposure worse, not better. The register answers "which secret, where, how old,
 * is it dead" from type, path, line and commit; triage opens Wiz for the value itself.
 *
 * TWO CLOCKS, and they are independent axes rather than one lifecycle:
 *   status / resolvedAt              the string left HEAD
 *   validationStatus / lastValidatedAt   the credential stopped working
 * Removal does not imply rotation. See the ledger's validation_state column for why the
 * second one ships as measured / unmeasured.
 */
export const Q_SECRETS = `query DevSecOpsSecretInstances(
  $filterBy: SecretInstanceFilters
  $first: Int
  $after: String
) {
  secretInstances(filterBy: $filterBy, first: $first, after: $after) {
    nodes {
      id
      externalId
      secretDataId
      name
      type
      confidence
      severity
      path
      lineNumber
      status
      resolvedAt
      validationStatus
      lastValidatedAt
      firstSeenAt
      lastSeenAt
      lastUpdatedAt
      codeToCloudPipelineStage
      vcsDetails { initialCommitHash }
      resource { id name type externalId nativeType cloudPlatform }
      projects { id name isFolder slug }
    }
    totalCount
    pageInfo { hasNextPage endCursor }
  }
}`;

export const QUERIES: Record<Scope, string | null> = {
  sast: Q_SAST,
  sca: Q_SCA,
  secrets: Q_SECRETS,
};

/**
 * The connection each document returns its rows under.
 *
 * A FACT ABOUT THE DOCUMENT, so it lives beside the documents rather than in the transport —
 * and `test/wizQueries.test.js` asserts each query actually selects the root named here, so
 * the pair cannot drift.
 *
 * It exists because "find whatever connection came back" is not quite enough. That generic
 * form (probeHelpers.resolveConnection, written after §9.1's false zero) catches a response
 * with NO connection in it, which is the dangerous case; it cannot catch a response whose
 * connection is the WRONG ONE — a scope that sent another scope's document would be read
 * happily, and the register would fill with the wrong population. Naming the expected root
 * turns that into a refusal too.
 */
export const ROOT_FIELDS: Record<Scope, string> = {
  sast: "sastFindings",
  sca: "vulnerabilityFindings",
  secrets: "secretInstances",
};

/* ----------------------------------------------------------------- the filters */

export interface FilterOptions {
  severities?: readonly string[];
  projectId?: string | null;
}

// AN INCREMENTAL-SYNC FILTER USED TO LIVE HERE, and it was removed rather than left.
//
// `updatedAfter` mapped to `filterBy.updatedAt = { after: iso }` for every scope, and that
// shape was never checked against either schema — exactly the unverified assumption that
// cost the register its entire SAST population (see OBJECT_FILTERS below). Nothing called
// it, so shipping a second untested filter shape immediately after fixing the first would
// have been the wrong trade.
//
// What is known: SASTFindingFilters.createdAt is SASTDateTimeFilter, and
// SecretInstanceFilters carries firstSeenAt / lastUpdatedAt / resolvedAt as CommonDateFilter
// (before / after / inLast / beforeLast). The SCA equivalent is unverified. Re-add this with
// the schema in hand when the sync battery needs it, per scope, through OBJECT_FILTERS.

/** Wiz spells the lowest severity INFORMATIONAL; everything else matches. */
export const API_SEVERITY: Record<string, string> = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  INFO: "INFORMATIONAL",
};

/**
 * The base scope of each register — the population before severity or project narrowing.
 *
 * `codeToCloudPipelineStage: ["CODE"]` is what keeps the SCA register on repository
 * findings rather than pulling in the container images that carry the same CVEs; without it
 * this tool and the OS sidekick would double-count the estate.
 *
 * `isDefaultBranch` keeps a feature branch's findings out of the register. A branch nobody
 * merged is not remediation debt.
 */
const BASE: Record<string, Record<string, unknown>> = {
  sca: {
    status: ["OPEN", "RESOLVED"],
    hasFix: true,
    codeToCloudPipelineStage: ["CODE"],
    isDefaultBranch: { equals: true },
  },
  sast: {
    // Deliberately NOT status: ["OPEN","RESOLVED"]. See SAST_FETCH_RESOLVED below.
    resource: { isDefaultBranch: { equals: true } },
  },
  secrets: {
    // THE NARROWING IS THE MEASUREMENT, not tidiness. Unscoped, this register is 394,927
    // rows and most of them are cloud/runtime rather than code; CODE narrows it to 1,933.
    //
    // It also decides whether the secrets clock is trustworthy at all. Sampled across every
    // stage, secrets close 0.25s-63s after first being seen — the born-and-closed-in-the-
    // same-instant artifact that keeps SAST_FETCH_RESOLVED off. Scoped to CODE, NOT ONE of
    // the 72 resolved rows closes inside a day: median 5.15d, p90 56.1d, max 300d. The
    // artifact is a cloud-stage phenomenon. PROBE_FINDINGS.md §3.
    codeToCloudPipelineStage: ["CODE"],
    status: ["OPEN", "RESOLVED"],
  },
};

/**
 * Apply OBJECT_FILTERS to every list-valued key of a base scope.
 *
 * BASE IS WRITTEN IN ONE CONVENTION — plain lists — and the shape table decides what goes on
 * the wire. Without this pass a literal in BASE bypasses the table completely, which is
 * exactly how `codeToCloudPipelineStage` shipped as `["CODE"]` while OBJECT_FILTERS said it
 * was an object: adding the key to the table changed nothing, because the value never went
 * through `listFilter`. A shape table that only covers SOME of the filter is worse than none,
 * because it reads as though it covers all of it.
 *
 * Non-array values pass through untouched, which is what leaves SAST's nested
 * `resource: { isDefaultBranch: { equals: true } }` alone — it is a nested filter object, not
 * a list needing a convention.
 */
function shapeBase(scope: Scope, base: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    out[key] = Array.isArray(value)
      ? listFilter(scope, key, value as readonly string[])
      : value;
  }
  return out;
}

/**
 * Whether to ask for resolved SAST findings. FALSE — and the reason changed on 2026-08-27.
 *
 * THE OLD REASON IS DEAD. It said "Q_SAST selects no timestamps", which the live tenant
 * falsified: `SASTFinding` exposes `createdAt: DateTime!`, filterable and sortable, and
 * Q_SAST now selects it. See PROBE_FINDINGS.md §2.
 *
 * TWO NEW REASONS REPLACE IT, and both still point the same way:
 *
 *   1. There is no `resolvedAt` on `SASTFinding`. Forty-three fields, none of them a
 *      resolution date. Turning this on would buy a real START and leave the END missing.
 *      `updatedAt` is a lossy proxy — it moves on any rescan, and the sampled rows show it
 *      doing exactly that.
 *   2. `status: RESOLVED` returns totalCount 0 in this project scope. There is nothing to
 *      fetch even if there were somewhere to put it.
 *
 * NONE OF WHICH COSTS US THE CLOCK, and that is the part worth stating. The ledger dates a
 * resolution by DISAPPEARANCE when the API will not: `first_seen` prefers the API's
 * `createdAt` over the observation date, `resolved_at` becomes the scan that noticed the
 * absence, and `mttr_days` is the subtraction of the two with no guard on how the
 * resolution was learned (brick/devsecops/ledger.py, pinned by
 * test_mttr_is_measured_from_the_ledgers_own_dates). So SAST gets a genuine MTTR from
 * `createdAt` + disappearance — not merely an age metric — once two scans exist.
 *
 * Flip this ONLY if a resolution date appears on the type.
 */
export const SAST_FETCH_RESOLVED = false;

/**
 * WHICH FILTER KEYS THIS SCOPE'S FILTER TYPE TAKES AS AN OBJECT rather than a bare list.
 *
 * The two filter types genuinely disagree, and this table exists so that disagreement is
 * DATA a reader can check against the schema rather than a branch buried in buildFilter:
 *
 *   VulnerabilityFindingFilters.severity   [VulnerabilitySeverity!]   a bare list
 *   SASTFindingFilters.severity            SASTSeverityFilter         { equals: [...] }
 *   SASTFindingFilters.status              SASTStatusFilter           { equals: [...] }
 *
 * This asymmetry cost the register its whole SAST population once. buildFilter applied the
 * SCA convention to both scopes, so every SAST sync was refused with HTTP 400
 * VALIDATION_INVALID_TYPE_VARIABLE and fetched zero rows — and a test pinned the broken
 * shape, because it was generalised from reference vectors that were only ever correct
 * about SCA. PROBE_FINDINGS.md §4 has the refusal and the proof that correcting the shape
 * alone returns 200.
 *
 * DO NOT "TIDY" THIS INTO ONE CONVENTION. Applying SAST's object form to SCA breaks SCA,
 * which works today. The schema type names above are the evidence; check them before
 * changing a line here.
 */
export const OBJECT_FILTERS: Record<Scope, readonly string[]> = {
  // VulnerabilityFindingFilters takes every LIST bare — severity, status,
  // codeToCloudPipelineStage — and wraps only the project restriction.
  //   projectIdV2  VulnerabilityFindingProjectFilter  { equals: [...] }
  sca: ["projectIdV2"],
  sast: ["severity", "status"],
  // SecretInstanceFilters MIXES BOTH CONVENTIONS INTERNALLY, which is the §4 trap at finer
  // grain. One field's shape says nothing about the next one's, IN THE SAME TYPE:
  //   status                    SecretInstanceStatusFilter                    { equals: [...] }
  //   validationStatus          SecretInstanceValidationStatusFilter          { equals: [...] }
  //   severity                  SecretInstanceSeverityFilter                  { equals: [...] }
  //   codeToCloudPipelineStage  SecretInstanceCodeToCloudPipelineStageFilter  { equals: [...] }
  //   projectId                 [String!]                                     a bare list
  //
  // codeToCloudPipelineStage was the one key here ever sent on INFERENCE rather than on
  // reading — shaped after SCA, which spells the same field name
  // [VulnerabilityCodeToCloudPipelineStage!], a bare list. The inference did not hold, and
  // the register fetched zero rows until it was corrected. Schema print and live response
  // agree; with only this key fixed the query returns 691 rows (PROBE_FINDINGS.md §8.1).
  //
  // THAT IS THE THIRD TIME one field name has carried two kinds across filter types in this
  // codebase — after `severity` in §4 and the commitHash / initialCommitHash split in §7.3.
  // Copy these from `--schema`, which prints a ready-made OBJECT_FILTERS entry per type.
  // Never carry one across.
  secrets: ["severity", "status", "validationStatus", "codeToCloudPipelineStage"],
};

/** A list-valued filter, shaped the way THIS scope's filter type wants it. */
function listFilter(scope: Scope, key: string, values: readonly string[]): unknown {
  return OBJECT_FILTERS[scope].includes(key) ? { equals: [...values] } : [...values];
}

/** Translate the register's severity vocabulary into the API's. */
export function severityFilter(severities: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of severities) {
    const api = API_SEVERITY[String(s).trim().toUpperCase()];
    if (api && !out.includes(api)) out.push(api);
  }
  return out;
}

/**
 * The `filterBy` for one scope.
 *
 * Pure and separately testable, because this object decides which population every
 * downstream metric is computed over — a wrong key here is not an error, it is a
 * plausible-looking number about the wrong thing.
 */
export function buildFilter(scope: Scope, opts: FilterOptions = {}): Record<string, unknown> {
  // `== null` catches BOTH a scope declared without a document and a scope that does not
  // exist at all. The strict `=== null` this replaces let an unknown scope through with
  // `undefined`, which would have built a filter, sent it, and read as an empty register —
  // the same silent-zero-rows failure the SAST shape bug produced.
  if (QUERIES[scope] == null) {
    throw new Error(`no query document for scope "${scope}" — see wizQueries.ts`);
  }
  const filterBy = shapeBase(scope, JSON.parse(JSON.stringify(BASE[scope] ?? {})));

  // Carries the same shape hazard as severity, and was dormant only while
  // SAST_FETCH_RESOLVED was false — a mine under a future flag flip. Shaped through the
  // same table BASE goes through, so there is one answer per key rather than two.
  if (scope === "sast" && SAST_FETCH_RESOLVED) {
    filterBy.status = listFilter(scope, "status", ["OPEN", "RESOLVED"]);
  }

  const sev = severityFilter(opts.severities ?? []);
  if (sev.length) filterBy.severity = listFilter(scope, "severity", sev);

  if (opts.projectId) {
    // The two filter types spell the project restriction differently, and the tenant's own
    // exported reference scripts are the evidence for each: sast_request.py passes a bare
    // `projectId: [...]`, sca_request.py passes `projectIdV2: {equals: [...]}`.
    // SAST and secrets spell it `projectId`, SCA spells it `projectIdV2`. The SHAPE each
    // wants comes from the same table every other list-valued key goes through, rather than
    // being written inline here — an inline literal is exactly how codeToCloudPipelineStage
    // bypassed the table and shipped refused.
    const key = scope === "sca" ? "projectIdV2" : "projectId";
    filterBy[key] = listFilter(scope, key, [opts.projectId]);
  }

  return filterBy;
}

/** The full variables object one page of a scope is fetched with. */
export function buildVariables(
  scope: Scope,
  opts: FilterOptions & { first?: number; after?: string | null } = {},
): Record<string, unknown> {
  return {
    filterBy: buildFilter(scope, opts),
    first: opts.first ?? PAGE_SIZE,
    after: opts.after ?? null,
  };
}
