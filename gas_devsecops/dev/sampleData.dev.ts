// The dev dataset: three scans, three scopes, generated rather than typed out.
//
// A SEQUENCE, NOT A SNAPSHOT, and that is the whole point. One scan exercises nothing in
// reconcile — no disappearance, no reopen, no first_seen that had to be held still, and an
// MTTR page fed by it would have nothing but open rows. Three scans a week apart give the
// ledger something to have learned.
//
// The shapes are the ones the three queries return (wizQueries.ts), so this exercises the
// real normalizers rather than a convenient parallel format. Everything is deterministic:
// no Math.random, no Date.now, so two dev runs produce byte-identical ledgers and a number
// that moves on screen moved for a reason.
//
// NOT REAL DATA. The tenant figures live in PROBE_FINDINGS.md; these are shaped to make the
// page's honest qualifiers visible — heavy censoring, a truncated RMST, an aged backlog past
// SLA, a vendor-fix gap, and a secrets twin — at a size a browser can draw.

import type { Rec } from "../src/domain/util";
import type { SampleScan } from "../src/server/sampleData";

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const LANGUAGES = ["JAVA", "PYTHON", "GO", "TYPESCRIPT"] as const;
const REPOS = [
  "dktunited/prodcom-api", "dktunited/prodcom-jdbc-kafka-connect",
  "dktunited/checkout-web", "dktunited/inventory-sync",
] as const;

/** A deterministic small integer from a string — a stand-in for the randomness we refuse. */
function hashInt(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}

const DAY = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

// The three scan times, and a birth-date origin far enough back that the aged backlog is
// genuinely aged.
const SCAN_TS = [
  Date.parse("2026-06-15T02:00:00Z"),
  Date.parse("2026-07-15T02:00:00Z"),
  Date.parse("2026-08-15T02:00:00Z"),
];

/**
 * One SCA node.
 *
 * `fixDate` is absent for one finding in three, which is what puts rows into
 * `awaiting_vendor_fix` — the state the whole second clock exists to name.
 */
function scaNode(i: number, scanIdx: number): Rec {
  const key = `sca-${i}`;
  const sev = SEVERITIES[hashInt(key, 4)]!;
  const bornDaysAgo = 20 + hashInt(`${key}-born`, 300);
  const born = SCAN_TS[0]! - bornDaysAgo * DAY;
  const hasFix = hashInt(`${key}-fix`, 3) !== 0;
  const repo = REPOS[hashInt(key, REPOS.length)]!;
  return {
    id: key,
    name: `CVE-2026-${1000 + i}`,
    detailedName: `pkg-${hashInt(key, 40)} ${1 + hashInt(key, 3)}.${hashInt(key, 20)}.0`,
    severity: sev,
    status: "OPEN",
    firstDetectedAt: iso(born),
    lastDetectedAt: iso(SCAN_TS[scanIdx]!),
    resolvedAt: null,
    fixDate: hasFix ? iso(born + (2 + hashInt(`${key}-fd`, 30)) * DAY) : null,
    fixedVersion: hasFix ? `${1 + hashInt(key, 3)}.${hashInt(key, 20)}.9` : null,
    // Tri-state on purpose: one row in four is left unevaluated, so the page has to keep
    // "not assessed" distinct from "assessed, and the answer was no".
    hasExploit: hashInt(`${key}-ex`, 4) === 0 ? null : hashInt(`${key}-ex`, 3) === 0,
    hasCisaKevExploit: hashInt(`${key}-kev`, 4) === 0 ? null : hashInt(`${key}-kev`, 9) === 0,
    epssProbability: hashInt(`${key}-ep`, 5) === 0 ? null : hashInt(`${key}-ep`, 100) / 100,
    vulnerableAsset: {
      id: `${repo}#main`, type: "REPOSITORY_BRANCH", name: `${repo}/main`, cloudPlatform: "GitHub",
    },
    artifactType: { codeLibraryLanguage: LANGUAGES[hashInt(key, 4)] },
  };
}

function sastNode(i: number, scanIdx: number): Rec {
  const key = `sast-${i}`;
  const repo = REPOS[hashInt(key, REPOS.length)]!;
  const born = SCAN_TS[0]! - (10 + hashInt(`${key}-born`, 200)) * DAY;
  return {
    id: key,
    name: ["Hardcoded credential", "SQL injection", "Path traversal", "Weak hash"][hashInt(key, 4)],
    // SAST never reports a resolution (§2), so the status is always OPEN and every SAST
    // death in the ledger comes from disappearing between two of these scans.
    status: "OPEN",
    severity: SEVERITIES[hashInt(`${key}-s`, 4)],
    filePath: `src/main/${LANGUAGES[hashInt(key, 4)]!.toLowerCase()}/Mod${hashInt(key, 30)}.src`,
    startLine: 10 + hashInt(`${key}-l`, 400),
    codeLibraryLanguage: LANGUAGES[hashInt(key, 4)],
    origin: "WIZ",
    resolutionReason: null,
    createdAt: iso(born),
    updatedAt: iso(SCAN_TS[scanIdx]!),
    firstDetectedAtSource: iso(born + DAY),
    resource: { id: repo, name: repo, type: "REPOSITORY" },
    weaknesses: [{ id: `cwe-${hashInt(key, 900)}`, name: `CWE-${hashInt(key, 900)}` }],
    projects: [{ id: "p1", name: "VALUE-CHAIN", isFolder: false, slug: "value-chain" }],
    vcsDetails: { commitHash: `c${hashInt(key, 100000).toString(16)}` },
    aiAnalysis: { verdict: null },
  };
}

/**
 * One secrets node, in its REPOSITORY form.
 *
 * Every third one also gets a REPOSITORY_BRANCH twin below, carrying a DIFFERENT externalId
 * and an earlier firstSeenAt — the §10.6/§10.7 shape, so the fold and the spread column are
 * exercised by the dev run rather than only by the unit tests.
 */
function secretNode(i: number, scanIdx: number, branchTwin = false): Rec {
  const key = `sec-${i}`;
  const repo = REPOS[hashInt(key, REPOS.length)]!;
  const path = `config/app-${hashInt(key, 25)}.properties`;
  const line = 3 + hashInt(`${key}-l`, 90);
  const born = SCAN_TS[0]! - (5 + hashInt(`${key}-born`, 320)) * DAY;
  // The twin is EARLIER, in the direction §10.7 measured as the more common one (branch
  // earlier in 135 of 187).
  const twinBorn = born - (1 + hashInt(`${key}-gap`, 120)) * DAY;
  const kind = ["PASSWORD", "SAAS_API_KEY", "PRIVATE_KEY", "CERTIFICATE", "CLOUD_KEY"][hashInt(key, 5)];
  const validated = hashInt(`${key}-v`, 12);
  return {
    id: branchTwin ? `${key}-branch` : key,
    externalId: branchTwin
      ? `github.com##${repo}##main##/${path}##h${hashInt(key, 9999)}##${line}`
      : `github.com##${repo}##${path}##h${hashInt(key, 9999)}##${line}`,
    secretDataId: `sd-${key}`,
    name: `${kind} in ${path}`,
    type: kind,
    confidence: ["HIGH", "MEDIUM"][hashInt(key, 2)],
    // Severity grades a DETECTION here, not whether the credential is live — which is why
    // the register has no severity gate on this scope (§9.2).
    severity: ["HIGH", "MEDIUM", "LOW", "INFORMATIONAL"][hashInt(`${key}-sev`, 4)],
    path,
    lineNumber: line,
    status: "OPEN",
    resolvedAt: null,
    // 0.38% of the live register is validated (§3), so almost all of these are UNKNOWN and
    // the page has to publish rotation as mostly-unmeasured rather than mostly-unrotated.
    validationStatus: validated === 0 ? "INVALID" : validated === 1 ? "VALID" : "UNKNOWN",
    lastValidatedAt: validated < 2 ? iso(SCAN_TS[scanIdx]! - 3 * DAY) : null,
    firstSeenAt: iso(branchTwin ? twinBorn : born),
    lastSeenAt: iso(SCAN_TS[scanIdx]!),
    lastUpdatedAt: iso(SCAN_TS[scanIdx]!),
    codeToCloudPipelineStage: "CODE",
    vcsDetails: { initialCommitHash: `c${hashInt(key, 100000).toString(16)}` },
    resource: branchTwin
      ? { id: `${repo}#main`, name: `${repo}/main`, type: "REPOSITORY_BRANCH", externalId: `${repo}/main`, nativeType: "branch", cloudPlatform: "GitHub" }
      : { id: repo, name: repo, type: "REPOSITORY", externalId: repo, nativeType: "repository", cloudPlatform: "GitHub" },
    projects: [{ id: "p1", name: "VALUE-CHAIN", isFolder: false, slug: "value-chain" }],
  };
}

/**
 * How many findings each scope carries in each scan.
 *
 * The counts FALL, and the drop is what the register measures: a finding present in scan 1
 * and absent in scan 2 is resolved by disappearance, dated at scan 2. That is the only way
 * SAST ever resolves, and it is most of how secrets does.
 *
 * SCA additionally closes a handful through the API, so both resolution routes appear in the
 * ledger and `resolution_src` has something to distinguish.
 */
const COUNTS = {
  sca: [90, 78, 70],
  sast: [40, 34, 31],
  secrets: [36, 33, 30],
};

/** A gated scan cannot hand back a row its gate excludes. */
function gated(nodes: Rec[], scanIdx: number, scope: string): Rec[] {
  const gate = GATES[scanIdx]![scope];
  if (!gate) return nodes;
  return nodes.filter((n) => gate.includes(String(n["severity"])));
}

function nodesFor(scanIdx: number): SampleScan {
  const sca: Rec[] = [];
  for (let i = 0; i < COUNTS.sca[scanIdx]!; i++) sca.push(scaNode(i, scanIdx));
  // A few SCA findings close through the API rather than by vanishing, so the page can show
  // both resolution sources. They stay in the payload carrying a resolvedAt, which is how
  // Wiz reports a remediation it was told about.
  if (scanIdx > 0) {
    for (let i = 0; i < 4; i++) {
      const closed = scaNode(200 + i, scanIdx);
      // Forced into the gate: DEFAULT_FETCH_SEVERITIES.sca is CRITICAL,HIGH, so a real
      // gated fetch could never hand back a LOW row at all, closed or open.
      closed["severity"] = i % 2 === 0 ? "CRITICAL" : "HIGH";
      closed["status"] = "RESOLVED";
      closed["resolvedAt"] = iso(SCAN_TS[scanIdx]! - (1 + i) * DAY);
      sca.push(closed);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const born = scaNode(200 + i, scanIdx);
      born["severity"] = i % 2 === 0 ? "CRITICAL" : "HIGH";
      sca.push(born);
    }
  }

  const sast: Rec[] = [];
  for (let i = 0; i < COUNTS.sast[scanIdx]!; i++) sast.push(sastNode(i, scanIdx));

  const secrets: Rec[] = [];
  for (let i = 0; i < COUNTS.secrets[scanIdx]!; i++) {
    secrets.push(secretNode(i, scanIdx));
    if (i % 3 === 0) secrets.push(secretNode(i, scanIdx, true));
  }

  return {
    sca: gated(sca, scanIdx, "sca"),
    sast: gated(sast, scanIdx, "sast"),
    secrets: gated(secrets, scanIdx, "secrets"),
  };
}

/**
 * The severity gate each scan applied, per scope.
 *
 * THE FIRST SCAN IS WIDE AND THE LATER TWO ARE NARROW, which is what a settings change looks
 * like and is the only shape that makes this fixture coherent. The register's SCA and SAST
 * default is CRITICAL/HIGH — so a scan stamped with that gate cannot have returned MEDIUM and
 * LOW rows, and one that did would put the ledger and its own scan log in contradiction.
 *
 * Modelling the change rather than deleting the rows is the better fixture in both
 * directions: the MEDIUM and LOW rows are legitimately in the ledger (a wider scan put them
 * there), and they then exercise the disappearance guard exactly as it will be exercised in
 * production — absent from every later scan, and correctly never resolved for it.
 */
const GATES: readonly Record<string, readonly string[] | null>[] = [
  { sca: null, sast: null, secrets: null },
  { sca: ["CRITICAL", "HIGH"], sast: ["CRITICAL", "HIGH"], secrets: null },
  { sca: ["CRITICAL", "HIGH"], sast: ["CRITICAL", "HIGH"], secrets: null },
];

export const SAMPLE_SCANS: readonly {
  id: string;
  ts: string;
  nodes: SampleScan;
  gates: Record<string, readonly string[] | null>;
}[] = SCAN_TS.map((ts, i) => ({
  id: `sample-${i + 1}`,
  ts: iso(ts),
  nodes: nodesFor(i),
  gates: GATES[i]!,
}));
