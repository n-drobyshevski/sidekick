// The dev harness's realistic register — H2 of the Phase 2 plan.
//
// WHAT THIS FILE IS FOR. `dev/boot.js` needs a register a page can actually render against,
// without a tenant. The esbuild alias in `dev/serve.mjs` resolves the specifier `./sampleData`
// to THIS file on every dev build (`dev-sample-data` plugin, `buildDevServer`), which is why
// the file has to keep existing and keep the `SAMPLE_FINDINGS` export name even though nothing
// under `src/server` imports that specifier yet — the alias is forward-looking infrastructure
// inherited from the gas_ai fork, and activating it (wiring a dry-run import into
// `scanJobs.ts`/`src/server/index.ts`) is explicitly NOT this package's file to touch: it is
// "S7 wires it into api.ts" (scanJobs.ts's own header) and outside this package's file list.
//
// THE DATA IS RAW WIZ-SHAPED NODES, NOT LEDGER ROWS. Every node below carries exactly the
// fields `scanJobs.SLIM_FIELDS` / `SLIM_NESTED` / `SLIM_LISTS` know how to keep for its scope,
// so `scanJobs.slimRecord(scope, node)` produces a non-null column for every field
// `domain/reconcile.ts` reads — the same three-site contract `test/scanJobs.test.ts` pins.
// Nothing here is pre-reduced to a ledger row: the row shapes, the twin fold and the KM
// population all come from feeding these nodes through the REAL `slimRecord` ->
// `domain/reconcile.reconcile` (or `ledgerStore.persistSync`) pipeline, which is exactly what
// `test/sampleData.test.ts` does, and is the only place in this dev harness today that can
// execute that pipeline — `dev/boot.js` runs unbundled, plain browser JS, dispatching only
// into whatever `src/server/index.ts` re-exports onto the global `Server` (doGet, include,
// access, welcome, setup, deploymentDiagnostic, api), which does not include `scanJobs` or
// `ledgerStore` yet. See `dev/boot.js`'s own header for the honest state of that gap.
//
// DETERMINISM. One seeded PRNG (mulberry32), no `Math.random()` anywhere below, so two dev
// boots — and two test runs — agree bit for bit on every generated field.

import { CWE_TOP_25_2024, type Scope } from "../src/domain/config";
import type { Rec } from "../src/domain/util";

/* ------------------------------------------------------------------------------- PRNG */

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0xd5eed17);

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length]!;
}

function range01(): number {
  return rng();
}

/* -------------------------------------------------------------------------- calendar */

const DAY_MS = 86_400_000;
const DAY1_A = "2026-06-01T08:00:00.000Z";
const DAY1_B = "2026-06-01T20:00:00.000Z";
const DAY2_C = "2026-06-15T08:00:00.000Z";

function isoBefore(anchorIso: string, minDays: number, maxDays: number): string {
  const anchor = Date.parse(anchorIso);
  const span = maxDays - minDays;
  const days = minDays + Math.floor(range01() * span);
  return new Date(anchor - days * DAY_MS).toISOString();
}

/* -------------------------------------------------------------------------------- pools */

interface RepoSpec {
  id: string;
  name: string; // owner/repo
  branch: string;
  cloudPlatform: string;
  language: string;
}

const REPO_POOL: readonly RepoSpec[] = [
  { id: "repo-1", name: "dktunited/retbox-front", branch: "main", cloudPlatform: "GitHub", language: "JAVASCRIPT" },
  { id: "repo-2", name: "dktunited/tattoo-idp", branch: "main", cloudPlatform: "GitHub", language: "JAVA" },
  { id: "repo-3", name: "dktunited/checkout-svc", branch: "release", cloudPlatform: "GitHub", language: "PYTHON" },
  { id: "repo-4", name: "dktunited/payments-api", branch: "main", cloudPlatform: "GitHub", language: "GO" },
  { id: "repo-5", name: "dktunited/inventory-core", branch: "develop", cloudPlatform: "GitHub", language: "JAVA" },
  { id: "repo-6", name: "dktunited/notifications", branch: "main", cloudPlatform: "GitHub", language: "PYTHON" },
  { id: "repo-7", name: "dktunited/auth-gateway", branch: "main", cloudPlatform: "GitHub", language: "GO" },
  { id: "repo-8", name: "dktunited/reporting-etl", branch: "main", cloudPlatform: "GitHub", language: "PYTHON" },
];

interface ProjectSpec {
  folder: string;
  folderSlug: string;
  leaf: string;
  leafSlug: string;
}

const PROJECT_POOL: readonly ProjectSpec[] = [
  { folder: "VALUE-CHAIN", folderSlug: "value-chain", leaf: "product-tattoo-idp", leafSlug: "tattoo-idp" },
  { folder: "CE-TRANSPORT", folderSlug: "ce-transport", leaf: "checkout-svc", leafSlug: "checkout-svc" },
  { folder: "PLATFORM", folderSlug: "platform", leaf: "payments-core", leafSlug: "payments-core" },
  { folder: "GROWTH", folderSlug: "growth", leaf: "notifications-team", leafSlug: "notifications-team" },
];

function projectsFor(idx: number): Rec[] {
  const p = PROJECT_POOL[idx % PROJECT_POOL.length]!;
  return [
    { id: `proj-folder-${idx % PROJECT_POOL.length}`, name: p.folder, isFolder: true, slug: p.folderSlug },
    { id: `proj-leaf-${idx % PROJECT_POOL.length}`, name: p.leaf, isFolder: false, slug: p.leafSlug },
  ];
}

const SCA_PACKAGES: readonly string[] = [
  "lodash", "requests", "log4j-core", "spring-core", "openssl", "jackson-databind",
  "urllib3", "express", "django", "netty-codec", "commons-text", "axios", "flask",
  "protobuf-java", "guava",
];

/* ------------------------------------------------------------------------------------ sca */
//
// ~400 sca findings, split into five lifecycle buckets so the three synthetic scans below
// exercise every clock the SLA/MTTR/KM pages read: STAYS (censored, open the whole window),
// EARLY_GONE / LATE_GONE (resolved by disappearance, at scan B and scan C respectively),
// API_RESOLVED (a real event: `status`/`resolvedAt` set directly, not inferred from absence),
// and NEW_AT_C (growth — first seen only at the last scan, so the trend series has more than
// one point). fixDate on exactly 60% (240/400, `idx % 5 < 3`) and hasCisaKevExploit on exactly
// 5% (20/400, `idx % 20 === 0`) are deterministic rules rather than a coin flip, so the counts
// this file claims are counts, not expectations.

type ScaBucket = "STAYS" | "EARLY_GONE" | "LATE_GONE" | "API_RESOLVED" | "NEW_AT_C";

const SCA_TOTAL = 400;
const SCA_BUCKET_BOUNDS: ReadonlyArray<[ScaBucket, number]> = [
  ["STAYS", 250], ["EARLY_GONE", 300], ["LATE_GONE", 340], ["API_RESOLVED", 370], ["NEW_AT_C", 400],
];
function scaBucketFor(idx: number): ScaBucket {
  for (const [bucket, upper] of SCA_BUCKET_BOUNDS) if (idx < upper) return bucket;
  return "NEW_AT_C";
}

const SCA_SEVERITY_WEIGHTS: ReadonlyArray<[string, number]> = [
  ["CRITICAL", 5], ["HIGH", 20], ["MEDIUM", 35], ["LOW", 30], ["INFO", 10],
];
function weightedPick(weights: ReadonlyArray<readonly [string, number]>): string {
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = range01() * total;
  for (const [v, w] of weights) {
    r -= w;
    if (r <= 0) return v;
  }
  return weights[weights.length - 1]![0];
}

interface ScaSpec {
  idx: number;
  id: string;
  name: string;
  detailedName: string;
  severity: string;
  bucket: ScaBucket;
  firstDetectedAt: string;
  hasFixDate: boolean;
  fixDate: string | null;
  fixedVersion: string | null;
  hasExploit: boolean;
  hasCisaKevExploit: boolean;
  epssProbability: number;
  repo: RepoSpec;
}

function buildScaSpecs(): ScaSpec[] {
  const specs: ScaSpec[] = [];
  for (let idx = 0; idx < SCA_TOTAL; idx++) {
    const bucket = scaBucketFor(idx);
    const repo = REPO_POOL[idx % REPO_POOL.length]!;
    const hasFixDate = idx % 5 < 3; // 60%
    const hasCisaKevExploit = idx % 20 === 0; // 5%
    const firstDetectedAt =
      bucket === "NEW_AT_C" ? isoBefore(DAY2_C, 1, 10) : isoBefore(DAY1_A, 10, 200);
    specs.push({
      idx,
      id: `sca-${idx + 1}`,
      name: `CVE-2025-${(4000 + idx).toString().padStart(4, "0")}`,
      detailedName: pick(SCA_PACKAGES),
      severity: weightedPick(SCA_SEVERITY_WEIGHTS),
      bucket,
      firstDetectedAt,
      hasFixDate,
      fixDate: hasFixDate ? isoBefore(DAY2_C, 0, 60) : null,
      fixedVersion: hasFixDate ? `${1 + (idx % 4)}.${idx % 10}.${idx % 7}` : null,
      hasExploit: range01() < 0.15,
      hasCisaKevExploit,
      epssProbability: Math.round(range01() * range01() * 10_000) / 10_000, // skewed low
      repo,
    });
  }
  return specs;
}

const SCA_SPECS = buildScaSpecs();

/** One raw sca node, shaped exactly like a `vulnerabilityFindings` connection node. */
function scaRawNode(spec: ScaSpec, scanTs: string, resolved: boolean): Rec {
  return {
    id: spec.id,
    name: spec.name,
    detailedName: spec.detailedName,
    severity: spec.severity,
    status: resolved ? "RESOLVED" : "OPEN",
    firstDetectedAt: spec.firstDetectedAt,
    lastDetectedAt: scanTs,
    resolvedAt: resolved ? DAY1_B : null,
    fixDate: spec.fixDate,
    fixedVersion: spec.fixedVersion,
    hasExploit: spec.hasExploit,
    hasCisaKevExploit: spec.hasCisaKevExploit,
    epssProbability: spec.epssProbability,
    vulnerableAsset: {
      id: spec.repo.id,
      type: "REPOSITORY_BRANCH",
      name: `${spec.repo.name}/${spec.repo.branch}`,
      cloudPlatform: spec.repo.cloudPlatform,
      subscriptionName: null,
      subscriptionExternalId: null,
      tags: { team: spec.repo.name.split("/")[1] ?? "platform" },
    },
    artifactType: { codeLibraryLanguage: spec.repo.language },
    projects: projectsFor(spec.idx),
  };
}

/** Which sca nodes a given synthetic scan actually returns, per its lifecycle bucket. */
function scaNodesForScan(scanIndex: 0 | 1 | 2, scanTs: string): Rec[] {
  const out: Rec[] = [];
  for (const spec of SCA_SPECS) {
    const { bucket } = spec;
    if (bucket === "STAYS") { out.push(scaRawNode(spec, scanTs, false)); continue; }
    if (bucket === "EARLY_GONE") { if (scanIndex === 0) out.push(scaRawNode(spec, scanTs, false)); continue; }
    if (bucket === "LATE_GONE") { if (scanIndex <= 1) out.push(scaRawNode(spec, scanTs, false)); continue; }
    if (bucket === "API_RESOLVED") { out.push(scaRawNode(spec, scanTs, scanIndex >= 1)); continue; }
    if (bucket === "NEW_AT_C") { if (scanIndex === 2) out.push(scaRawNode(spec, scanTs, false)); continue; }
  }
  return out;
}

/**
 * Every generated sca finding exactly once, at its own first appearance — the canonical
 * population (400) a scan-by-scan view never shows in full, since NEW_AT_C is absent from
 * scan A and STAYS/EARLY_GONE/LATE_GONE/API_RESOLVED are absent from... nothing, they are all
 * present at scan A. Used for the flat exports below, not for any one scan's battery.
 */
function scaCanonicalNodes(): Rec[] {
  return SCA_SPECS.map((spec) =>
    scaRawNode(spec, spec.bucket === "NEW_AT_C" ? DAY2_C : DAY1_A, false),
  );
}

/* ----------------------------------------------------------------------------------- sast */
//
// ~40 sast findings. `aiAnalysis` is `null` on every node — this tenant's own measured
// behaviour (CLAUDE.md's gas_devsecops entry) — and CWEs are drawn from three pools so the
// register exercises all three ways `ruleForScope`'s classifier can see a weakness: a literal
// CWE_TOP_25_2024 id, a child CWE mapped through `CWE_ANCESTORS`, and a CWE outside both.

type SastBucket = "STAYS" | "GONE_AT_B" | "NEW_AT_C" | "GONE_AT_C";

const SAST_TOTAL = 40;
const SAST_BUCKET_BOUNDS: ReadonlyArray<[SastBucket, number]> = [
  ["STAYS", 25], ["GONE_AT_B", 33], ["NEW_AT_C", 38], ["GONE_AT_C", 40],
];
function sastBucketFor(idx: number): SastBucket {
  for (const [bucket, upper] of SAST_BUCKET_BOUNDS) if (idx < upper) return bucket;
  return "GONE_AT_C";
}

// Ancestor-mapped children of a CWE_TOP_25_2024 entry (config.ts's CWE_ANCESTORS keys) — a
// CWE outside the literal top-25 LIST that still classifies "high" once ancestor-mapped.
const CWE_ANCESTOR_CHILDREN: readonly string[] = ["CWE-611", "CWE-88", "CWE-91", "CWE-1321"];
// Genuinely outside both the top-25 list and CWE_ANCESTORS.
const CWE_OUTSIDE: readonly string[] = ["CWE-601", "CWE-354", "CWE-330", "CWE-1004"];

interface SastSpec {
  idx: number;
  id: string;
  name: string;
  severity: string;
  bucket: SastBucket;
  filePath: string;
  startLine: number;
  language: string;
  origin: string;
  createdAt: string;
  cwe: string;
  repo: RepoSpec;
}

const SAST_SEVERITY_WEIGHTS: ReadonlyArray<[string, number]> = [
  ["CRITICAL", 5], ["HIGH", 30], ["MEDIUM", 40], ["LOW", 20], ["INFO", 5],
];
const SAST_ORIGINS: readonly string[] = ["SEMGREP", "CODEQL"];

function cweForIdx(idx: number): string {
  // Roughly a third each: literal top-25, ancestor-mapped child, fully outside.
  const bucket = idx % 3;
  if (bucket === 0) return CWE_TOP_25_2024[idx % CWE_TOP_25_2024.length]!;
  if (bucket === 1) return CWE_ANCESTOR_CHILDREN[idx % CWE_ANCESTOR_CHILDREN.length]!;
  return CWE_OUTSIDE[idx % CWE_OUTSIDE.length]!;
}

function buildSastSpecs(): SastSpec[] {
  const specs: SastSpec[] = [];
  for (let idx = 0; idx < SAST_TOTAL; idx++) {
    const bucket = sastBucketFor(idx);
    const repo = REPO_POOL[(idx + 3) % REPO_POOL.length]!;
    const createdAt = bucket === "NEW_AT_C" ? isoBefore(DAY2_C, 1, 10) : isoBefore(DAY1_A, 5, 180);
    const cwe = cweForIdx(idx);
    specs.push({
      idx,
      id: `sast-${idx + 1}`,
      name: `Weakness ${cwe}`,
      severity: weightedPick(SAST_SEVERITY_WEIGHTS),
      bucket,
      filePath: `src/${repo.name.split("/")[1]}/handler_${idx % 12}.${repo.language === "PYTHON" ? "py" : repo.language === "GO" ? "go" : repo.language === "JAVA" ? "java" : "js"}`,
      startLine: 8 + (idx % 240),
      language: repo.language,
      origin: SAST_ORIGINS[idx % SAST_ORIGINS.length]!,
      createdAt,
      cwe,
      repo,
    });
  }
  return specs;
}

const SAST_SPECS = buildSastSpecs();

function sastRawNode(spec: SastSpec, scanTs: string): Rec {
  return {
    id: spec.id,
    name: spec.name,
    status: "OPEN",
    severity: spec.severity,
    originalSeverity: null,
    filePath: spec.filePath,
    startLine: spec.startLine,
    codeLibraryLanguage: [spec.language],
    origin: spec.origin,
    resolutionReason: null,
    createdAt: spec.createdAt,
    updatedAt: scanTs,
    firstDetectedAtSource: null,
    resource: { id: spec.repo.id, name: `${spec.repo.name}/${spec.repo.branch}`, type: "REPOSITORY_BRANCH" },
    weaknesses: [{ id: spec.cwe, name: spec.name }],
    projects: projectsFor(spec.idx + 1),
    vcsDetails: { commitHash: `c${(spec.idx + 1).toString(16).padStart(7, "0")}` },
    // This tenant's measured reality (CLAUDE.md): every node's aiAnalysis is null.
    aiAnalysis: null,
  };
}

function sastNodesForScan(scanIndex: 0 | 1 | 2, scanTs: string): Rec[] {
  const out: Rec[] = [];
  for (const spec of SAST_SPECS) {
    const { bucket } = spec;
    if (bucket === "STAYS") { out.push(sastRawNode(spec, scanTs)); continue; }
    if (bucket === "GONE_AT_B") { if (scanIndex === 0) out.push(sastRawNode(spec, scanTs)); continue; }
    if (bucket === "NEW_AT_C") { if (scanIndex === 2) out.push(sastRawNode(spec, scanTs)); continue; }
    if (bucket === "GONE_AT_C") { if (scanIndex <= 1) out.push(sastRawNode(spec, scanTs)); continue; }
  }
  return out;
}

/** Every generated sast finding exactly once, at its own first appearance — see scaCanonicalNodes. */
function sastCanonicalNodes(): Rec[] {
  return SAST_SPECS.map((spec) => sastRawNode(spec, spec.bucket === "NEW_AT_C" ? DAY2_C : DAY1_A));
}

/* -------------------------------------------------------------------------------- secrets */
//
// 120 raw secrets nodes: 108 with a unique (secretDataId, path, lineNumber) key, plus 6 key
// COLLISIONS — the same key returned once as a `REPOSITORY` resource and once as
// `REPOSITORY_BRANCH`, each with its own `firstSeenAt` — so `domain/reconcile.foldSecretTwins`
// has something real to fold. 120 nodes over 114 keys folds to 114 ledger rows, not 120; that
// arithmetic is the whole reason the twins are here, and `test/sampleData.test.ts` pins it.
//
// Every `type` the API returns appears at least once. Validation state is 4 INVALID / 8 VALID
// / 108 UNKNOWN across the 120 nodes — this tenant's measured shape (CLAUDE.md: 99.6% never
// validated). Severity follows the measured per-type shape (CLAUDE.md's gas_devsecops entry):
// CERTIFICATE is entirely INFO, PASSWORD never exceeds MEDIUM, and nothing anywhere is
// CRITICAL — secrets severity grades a detection, not liveness, and putting a certificate at
// CRITICAL would make a page that segments by validation_state/confidence look right for the
// wrong reason.

const SECRET_TYPES = [
  "CERTIFICATE", "CLOUD_KEY", "DB_CONNECTION_STRING", "GIT_CREDENTIAL",
  "PASSWORD", "PRIVATE_KEY", "SAAS_API_KEY",
] as const;
type SecretType = (typeof SECRET_TYPES)[number];

interface SecretSingleSpec {
  type: SecretType;
  severity: string;
}

// Exact per-type severity lists for the 108 SINGLE-key nodes — 108 total, matching the
// scaled-down measured shape (§ header comment). Deterministic lists, not a weighted draw, so
// the type/severity counts this file claims are exact rather than "close on average".
function repeat(sev: string, n: number): string[] { return Array.from({ length: n }, () => sev); }

const SINGLE_SEVERITY_BY_TYPE: Record<SecretType, string[]> = {
  CERTIFICATE: repeat("INFO", 10),
  PASSWORD: [...repeat("MEDIUM", 6), ...repeat("LOW", 1), ...repeat("INFO", 4)], // 11, never above MEDIUM
  SAAS_API_KEY: [...repeat("HIGH", 18), ...repeat("MEDIUM", 3), ...repeat("LOW", 36), ...repeat("INFO", 7)], // 64
  CLOUD_KEY: [...repeat("HIGH", 9), ...repeat("LOW", 2)], // 11
  PRIVATE_KEY: repeat("HIGH", 8), // 8
  DB_CONNECTION_STRING: ["HIGH", "LOW", "INFO"], // 3
  GIT_CREDENTIAL: ["HIGH"], // 1
};

const SINGLE_SPECS: SecretSingleSpec[] = SECRET_TYPES.flatMap((type) =>
  SINGLE_SEVERITY_BY_TYPE[type].map((severity) => ({ type, severity })),
);
// 10 + 11 + 64 + 11 + 8 + 3 + 1 = 108

// 6 twin pairs — SAME (secretDataId, path, lineNumber), different resource form and
// firstSeenAt. Types chosen to also broaden the physical-node type distribution above (each
// pair contributes 2 nodes of its type).
const TWIN_TYPES: readonly SecretType[] = [
  "SAAS_API_KEY", "SAAS_API_KEY", "CLOUD_KEY", "PRIVATE_KEY", "PASSWORD", "DB_CONNECTION_STRING",
];
const TWIN_SEVERITY: readonly string[] = ["HIGH", "LOW", "HIGH", "HIGH", "MEDIUM", "LOW"];

const SECRETS_SINGLE_COUNT = SINGLE_SPECS.length; // 108
const SECRETS_TWIN_PAIRS = TWIN_TYPES.length; // 6
const SECRETS_TOTAL = SECRETS_SINGLE_COUNT + SECRETS_TWIN_PAIRS * 2; // 120

// Validation plan over the 120 physical nodes: 4 INVALID, 8 VALID, spread evenly by index;
// everything else UNKNOWN. Matches the measured tenant shape almost exactly never leaves it.
const VALIDATION_MEASURED = 12; // 4 invalid + 8 valid
const INVALID_INDEXES = new Set<number>();
const VALID_INDEXES = new Set<number>();
for (let k = 0; k < VALIDATION_MEASURED; k++) {
  const at = Math.floor((k * SECRETS_TOTAL) / VALIDATION_MEASURED);
  if (k < 4) INVALID_INDEXES.add(at); else VALID_INDEXES.add(at);
}
function validationStateFor(physicalIndex: number): string {
  if (INVALID_INDEXES.has(physicalIndex)) return "INVALID";
  if (VALID_INDEXES.has(physicalIndex)) return "VALID";
  return "UNKNOWN";
}

// Secrets nodes dropped after scan A (indices into SINGLE_SPECS only, so the twin fold stays
// simple) — the disappearance population resolved-by-disappearance has to fold over.
const SECRETS_DROPPED_AFTER_A = new Set([3, 15, 27, 39, 51, 63, 75, 87]);

interface SecretRawSpec {
  physicalIndex: number;
  id: string;
  externalId: string;
  secretDataId: string;
  type: SecretType;
  severity: string;
  confidence: string;
  path: string;
  lineNumber: number;
  firstSeenAt: string;
  validationStatus: string;
  lastValidatedAt: string | null;
  resourceType: "REPOSITORY" | "REPOSITORY_BRANCH";
  repo: RepoSpec;
  dropAfterA: boolean;
}

function secretRawNode(spec: SecretRawSpec, scanTs: string): Rec {
  return {
    id: spec.id,
    externalId: spec.externalId,
    secretDataId: spec.secretDataId,
    name: `${spec.type} in ${spec.repo.name}`,
    type: spec.type,
    confidence: spec.confidence,
    severity: spec.severity,
    path: spec.path,
    lineNumber: spec.lineNumber,
    status: "OPEN",
    resolvedAt: null,
    validationStatus: spec.validationStatus,
    lastValidatedAt: spec.lastValidatedAt,
    firstSeenAt: spec.firstSeenAt,
    lastSeenAt: scanTs,
    lastUpdatedAt: scanTs,
    codeToCloudPipelineStage: "CODE",
    resource: {
      id: spec.repo.id,
      name: spec.resourceType === "REPOSITORY_BRANCH" ? `${spec.repo.name}/${spec.repo.branch}` : spec.repo.name,
      type: spec.resourceType,
      externalId: `gh-${spec.repo.id}`,
      nativeType: "Repository",
      cloudPlatform: spec.repo.cloudPlatform,
    },
    vcsDetails: { initialCommitHash: `s${(spec.physicalIndex + 1).toString(16).padStart(7, "0")}` },
    projects: projectsFor(spec.physicalIndex + 2),
  };
}

function buildSecretSpecs(): SecretRawSpec[] {
  const specs: SecretRawSpec[] = [];
  let physicalIndex = 0;

  // 108 singles.
  SINGLE_SPECS.forEach((single, i) => {
    const repo = REPO_POOL[i % REPO_POOL.length]!;
    specs.push({
      physicalIndex,
      id: `secret-${i + 1}`,
      externalId: `ext-secret-${i + 1}`,
      secretDataId: `sd-${i + 1}`,
      type: single.type,
      severity: single.severity,
      confidence: single.severity === "HIGH" ? "HIGH" : single.severity === "INFO" ? "LOW" : "MEDIUM",
      path: `config/${single.type.toLowerCase()}-${i}.env`,
      lineNumber: 1 + (i % 40),
      firstSeenAt: isoBefore(DAY1_A, 5, 200),
      validationStatus: validationStateFor(physicalIndex),
      lastValidatedAt: validationStateFor(physicalIndex) === "UNKNOWN" ? null : isoBefore(DAY1_A, 1, 30),
      resourceType: "REPOSITORY_BRANCH",
      repo,
      dropAfterA: SECRETS_DROPPED_AFTER_A.has(i),
    });
    physicalIndex += 1;
  });

  // 6 twin pairs — 12 more nodes, keys collide 2-for-1.
  TWIN_TYPES.forEach((type, k) => {
    const repo = REPO_POOL[(k + 4) % REPO_POOL.length]!;
    const secretDataId = `sd-twin-${k + 1}`;
    const path = `services/${repo.name.split("/")[1]}/config/secret-${k + 1}.yml`;
    const lineNumber = (k + 1) * 7;
    const severity = TWIN_SEVERITY[k]!;
    const branchFirstSeen = isoBefore(DAY1_A, 40, 180); // branch twin: earlier (measured majority)
    const repoFirstSeen = isoBefore(DAY1_A, 5, 39); // repository twin: later

    const branchIdx = physicalIndex;
    specs.push({
      physicalIndex: branchIdx,
      id: `secret-twin-${k + 1}-branch`,
      externalId: `ext-secret-twin-${k + 1}-branch`,
      secretDataId, type, severity,
      confidence: severity === "HIGH" ? "HIGH" : "MEDIUM",
      path, lineNumber,
      firstSeenAt: branchFirstSeen,
      validationStatus: validationStateFor(branchIdx),
      lastValidatedAt: validationStateFor(branchIdx) === "UNKNOWN" ? null : isoBefore(DAY1_A, 1, 30),
      resourceType: "REPOSITORY_BRANCH",
      repo,
      dropAfterA: false,
    });
    physicalIndex += 1;

    const repoIdx = physicalIndex;
    specs.push({
      physicalIndex: repoIdx,
      id: `secret-twin-${k + 1}-repo`,
      externalId: `ext-secret-twin-${k + 1}-repo`,
      secretDataId, type, severity,
      confidence: severity === "HIGH" ? "HIGH" : "MEDIUM",
      path, lineNumber,
      firstSeenAt: repoFirstSeen,
      validationStatus: validationStateFor(repoIdx),
      lastValidatedAt: validationStateFor(repoIdx) === "UNKNOWN" ? null : isoBefore(DAY1_A, 1, 30),
      resourceType: "REPOSITORY",
      repo,
      dropAfterA: false,
    });
    physicalIndex += 1;
  });

  return specs;
}

const SECRET_SPECS = buildSecretSpecs();

/** All 120 raw secrets nodes as they read at scan A — the canonical set the twin-fold test uses. */
function secretsNodesForScan(scanIndex: 0 | 1 | 2, scanTs: string): Rec[] {
  const out: Rec[] = [];
  for (const spec of SECRET_SPECS) {
    if (scanIndex > 0 && spec.dropAfterA) continue; // resolved by disappearance at scan B, stays gone at C
    out.push(secretRawNode(spec, scanTs));
  }
  return out;
}

/* ---------------------------------------------------------------------------- public shape */

/**
 * Every raw node this file generates, all scopes, flattened — kept as `SAMPLE_FINDINGS` /
 * `unknown[]` because that is the export name and shape `dev/serve.mjs`'s esbuild alias and
 * the file's own history commit to. 400 sca + 40 sast + 120 secrets = 560.
 */
export const SAMPLE_FINDINGS: unknown[] = [
  ...scaCanonicalNodes(),
  ...sastCanonicalNodes(),
  ...secretsNodesForScan(0, DAY1_A),
];

/** The same population, split by scope — every generated finding exactly once. */
export const SAMPLE_RAW_NODES: Record<Scope, Rec[]> = {
  sca: scaCanonicalNodes(),
  sast: sastCanonicalNodes(),
  secrets: secretsNodesForScan(0, DAY1_A),
};

/** The exact generated node counts, so a claim about the dataset is a lookup, not an assertion. */
export const SAMPLE_COUNTS = {
  sca: SCA_TOTAL,
  sast: SAST_TOTAL,
  secrets: SECRETS_TOTAL,
  secretsSingles: SECRETS_SINGLE_COUNT,
  secretsTwinPairs: SECRETS_TWIN_PAIRS,
} as const;

/**
 * One scope's step of a synthetic sync battery — shaped like `ledgerStore.ScopePersist` minus
 * `records`, which a caller fills in AFTER running `scanJobs.slimRecord` over `rawRecords`
 * (these are raw Wiz-shaped nodes, not the slimmed payload `ScopePersist.records` expects).
 */
export interface SampleScopeBattery {
  scope: Scope;
  rawRecords: Rec[];
  mode: string;
  scannedSeverities: string[] | null;
}

export interface SampleSync {
  syncId: string;
  scopes: SampleScopeBattery[];
}

/**
 * Three synthetic scans over two calendar dates (2026-06-01 twice, 2026-06-15 once), so a
 * trend series has more than one point and resolve-by-disappearance has something to fold: a
 * finding present in an earlier scan and absent from a later one produces a resolved row.
 *
 * `rawRecords` on each entry are RAW nodes. Feed them through `scanJobs.slimRecord(scope, n)`
 * before handing them to `ledgerStore.persistSync` — `test/sampleData.test.ts` does exactly
 * that, in order, and is the executable proof this battery reconciles the way it claims to.
 */
export const SAMPLE_SYNCS: readonly SampleSync[] = [
  {
    syncId: DAY1_A,
    scopes: [
      { scope: "sca", rawRecords: scaNodesForScan(0, DAY1_A), mode: "sample", scannedSeverities: null },
      { scope: "sast", rawRecords: sastNodesForScan(0, DAY1_A), mode: "sample", scannedSeverities: null },
      { scope: "secrets", rawRecords: secretsNodesForScan(0, DAY1_A), mode: "sample", scannedSeverities: null },
    ],
  },
  {
    syncId: DAY1_B,
    scopes: [
      { scope: "sca", rawRecords: scaNodesForScan(1, DAY1_B), mode: "sample", scannedSeverities: null },
      { scope: "sast", rawRecords: sastNodesForScan(1, DAY1_B), mode: "sample", scannedSeverities: null },
      { scope: "secrets", rawRecords: secretsNodesForScan(1, DAY1_B), mode: "sample", scannedSeverities: null },
    ],
  },
  {
    syncId: DAY2_C,
    scopes: [
      { scope: "sca", rawRecords: scaNodesForScan(2, DAY2_C), mode: "sample", scannedSeverities: null },
      { scope: "sast", rawRecords: sastNodesForScan(2, DAY2_C), mode: "sample", scannedSeverities: null },
      { scope: "secrets", rawRecords: secretsNodesForScan(2, DAY2_C), mode: "sample", scannedSeverities: null },
    ],
  },
];
