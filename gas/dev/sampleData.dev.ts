// Dev-harness replacement for src/server/sampleData.ts (swapped in by an esbuild
// alias in dev/serve.mjs — never part of the clasp-pushed bundle). Amplifies the
// 4 bundled sample findings into a deterministic fleet so tables, charts, and MTTR
// analytics have realistic density during local UI/UX work.
//
// The generator is seeded (mulberry32) so every reload produces the same dataset;
// only the date anchors move with the wall clock. Each (CVE, asset) pair is unique,
// so vuln_key identity, reconcile, and the dry-run resolve-one-per-scan evolution
// behave exactly as with the real sample — just at volume.

import { SAMPLE_FLAT as REAL_FLAT } from "../src/server/sampleData";
export { SAMPLE_GROUPED } from "../src/server/sampleData";

type Rec = Record<string, any>;

const TEMPLATES: Rec[] = (REAL_FLAT as Rec)["data"]["vulnerabilityFindings"]["nodes"];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(0x5eed);
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

const NOW = Date.now();
const DAY = 86_400_000;
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

// --------------------------------------------------------------------- CVE pool
interface CveSpec {
  cve: string;
  pkg: string;
  version: string;
  fixed: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  score: number;
  path: string;
}

const PKGS: Array<[string, string, string, string]> = [
  ["openssl", "3.0.13-0ubuntu3.4", "3.0.13-0ubuntu3.6", "/usr/lib/x86_64-linux-gnu/libssl.so.3"],
  ["glibc", "2.35-0ubuntu3.8", "2.35-0ubuntu3.9", "/lib/x86_64-linux-gnu/libc.so.6"],
  ["curl", "8.5.0-2ubuntu10.4", "8.5.0-2ubuntu10.6", "/usr/bin/curl"],
  ["sudo", "1.9.13p3-1ubuntu3.4", "1.9.15p2-3ubuntu2", "/usr/bin/sudo"],
  ["bash", "5.2.15-2ubuntu1", "5.2.21-2ubuntu4", "/bin/bash"],
  ["systemd", "252.22-1ubuntu1", "252.30-1ubuntu1", "/lib/systemd/systemd"],
  ["openssh-server", "9.3p1-1ubuntu3", "9.6p1-3ubuntu13", "/usr/sbin/sshd"],
  ["libxml2", "2.9.14+dfsg-1.3", "2.9.14+dfsg-1.4", "/usr/lib/x86_64-linux-gnu/libxml2.so.2"],
  ["python3.10", "3.10.12-1~22.04.5", "3.10.12-1~22.04.9", "/usr/bin/python3.10"],
  ["nginx", "1.24.0-2ubuntu7", "1.24.0-2ubuntu7.1", "/usr/sbin/nginx"],
  ["zlib1g", "1.2.13.dfsg-1ubuntu5", "1.2.13.dfsg-1ubuntu5.1", "/usr/lib/x86_64-linux-gnu/libz.so.1"],
  ["krb5-libs", "1.20.1-1ubuntu1", "1.20.1-1ubuntu1.4", "/usr/lib/x86_64-linux-gnu/libkrb5.so.3"],
  ["linux-image-generic", "6.8.0-1015.16", "6.8.0-1016.17", "/boot/vmlinuz-6.8.0-1015-generic"],
  ["vim", "9.1.0016-1ubuntu7", "9.1.0016-1ubuntu7.3", "/usr/bin/vim.basic"],
  ["git", "2.43.0-1ubuntu7", "2.43.0-1ubuntu7.2", "/usr/bin/git"],
  ["tar", "1.34+dfsg-1.2ubuntu1", "1.35+dfsg-3ubuntu1", "/usr/bin/tar"],
];

// Weighted severity mix: a believable register skews MEDIUM/HIGH.
const SEV_WHEEL: CveSpec["severity"][] = [
  "CRITICAL", "CRITICAL",
  "HIGH", "HIGH", "HIGH", "HIGH",
  "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM", "MEDIUM",
  "LOW", "LOW", "LOW",
];
const SEV_SCORE: Record<CveSpec["severity"], [number, number]> = {
  CRITICAL: [9.0, 10.0], HIGH: [7.0, 8.9], MEDIUM: [4.0, 6.9], LOW: [0.5, 3.9],
};

const CVES: CveSpec[] = Array.from({ length: 56 }, (_, i) => {
  const [pkg, version, fixed, path] = PKGS[i % PKGS.length];
  const severity = SEV_WHEEL[Math.floor(rnd() * SEV_WHEEL.length)];
  const [lo, hi] = SEV_SCORE[severity];
  return {
    cve: `CVE-${2024 + (i % 3)}-${10000 + ((i * 977) % 80000)}`,
    pkg, version, fixed, path, severity,
    score: Math.round((lo + rnd() * (hi - lo)) * 10) / 10,
  };
});

// -------------------------------------------------------------------- asset pool
interface AssetSpec {
  id: string; name: string; cloud: string; os: string;
  sub: string; subExt: string; subId: string; tags: Rec;
  wide: boolean; limited: boolean;
}

const ROLES = ["web-prod", "api-prod", "batch-worker", "db-replica", "cache-node", "dev-box", "ci-runner", "edge-proxy"];
const CLOUDS: Array<[string, string, string]> = [
  ["AWS", "prod-account", "111122223333"],
  ["AWS", "dev-account", "444455556666"],
  ["Azure", "core-prod", "azure-sub-001"],
  ["Azure", "core-staging", "azure-sub-002"],
  ["GCP", "inix-tt4k", "inix-tt4k"],
  ["Alibaba", "ENMS-pr", "1950243589136840"],
];
const OSES = ["Ubuntu", "Ubuntu", "Ubuntu", "Amazon Linux", "Debian"];

const ASSETS: AssetSpec[] = Array.from({ length: 26 }, (_, i) => {
  const role = ROLES[i % ROLES.length];
  const [cloud, sub, subExt] = CLOUDS[Math.floor(rnd() * CLOUDS.length)];
  const env = role.includes("prod") || role.includes("edge") ? "prod"
    : role.includes("staging") ? "staging"
    : role.includes("dev") || role.includes("ci") ? "dev" : pick(["prod", "staging"]);
  const n = String(1 + Math.floor(i / ROLES.length) * 3 + (i % 3)).padStart(2, "0");
  return {
    id: `asset-dev-${String(i + 1).padStart(3, "0")}`,
    name: `${role}-${n}`,
    cloud,
    os: pick(OSES),
    sub, subExt,
    subId: `sub-${subExt}`,
    tags: { env, team: pick(["platform", "sre", "app", "data"]), owner: pick(["sre", "secops", "core"]) },
    // Exposure is a per-asset fact, set deterministically by role so one asset never
    // shows contradictory exposure across findings (templates carried random values).
    wide: role === "edge-proxy" || role === "web-prod",
    limited: role === "api-prod",
  };
});

// -------------------------------------------------------------------- generation
function makeNode(spec: CveSpec, asset: AssetSpec, idx: number): Rec {
  const node: Rec = JSON.parse(JSON.stringify(pick(TEMPLATES)));
  // ~17% are awaiting a vendor fix (no upstream patch yet). They stay OPEN with no fix
  // signal and, crucially, are detected AFTER REMEDIATION_ROLLOUT_ISO (2026-07-01) so
  // withDerived reads them as awaiting rather than legacy-fixed. The rest span the full
  // 1–120 day age range as before.
  const awaiting = rnd() < 0.17;
  const firstMs = awaiting
    ? NOW - rnd() * 9 * DAY
    : NOW - (1 + rnd() * 119) * DAY; // detected 1–120 days ago (spans all age buckets)
  const resolved = !awaiting && rnd() < 0.32;
  const resolvedMs = firstMs + (2 + rnd() * 40) * DAY;

  node["id"] = `vf_dev-${String(idx).padStart(4, "0")}`;
  node["name"] = spec.cve;
  node["detailedName"] = `${spec.pkg} ${spec.version}`;
  node["version"] = spec.version;
  node["fixedVersion"] = spec.fixed;
  node["recommendedVersion"] = spec.fixed;
  node["locationPath"] = spec.path;
  node["severity"] = spec.severity;
  node["vendorSeverity"] = spec.severity;
  node["weightedSeverity"] = spec.severity;
  node["nvdSeverity"] = spec.severity === "CRITICAL" ? "HIGH" : spec.severity;
  // Severity data-quality seeding (deterministic via rnd(), so every reload reproduces the
  // same UNKNOWN/fallback mix): exercises both ends of the coherence fix locally, without a
  // real messy migration import. ~4% blank the top-level field only — vendorSeverity/
  // nvdSeverity stay set, so effectiveSeverity's fallback rescues them (severity_source
  // provenance). ~2% blank every candidate — a genuine UNKNOWN finding, which lights up the
  // hero "unclassified severity" sub-line, the UNKNOWN SLA-table row, the Overview note, and
  // the Settings unknown-severity line.
  const sevQualityRoll = rnd();
  if (sevQualityRoll < 0.02) {
    node["severity"] = "";
    node["vendorSeverity"] = null;
    node["nvdSeverity"] = null;
  } else if (sevQualityRoll < 0.06) {
    node["severity"] = "";
  }
  node["score"] = spec.score;
  node["cnaScore"] = spec.score;
  node["vendorScore"] = spec.score;
  node["hasExploit"] = spec.severity === "CRITICAL" ? rnd() < 0.6 : rnd() < 0.12;
  node["hasCisaKevExploit"] = node["hasExploit"] && rnd() < 0.4;
  node["epssProbability"] = Math.round(rnd() * (node["hasExploit"] ? 0.9 : 0.2) * 1000) / 1000;
  node["epssSeverity"] = node["epssProbability"] > 0.5 ? "CRITICAL" : node["epssProbability"] > 0.1 ? "MEDIUM" : "LOW";
  node["epssPercentile"] = Math.round(rnd() * 1000) / 1000;
  node["publishedDate"] = iso(firstMs - (10 + rnd() * 200) * DAY);
  node["firstDetectedAt"] = iso(firstMs);
  node["description"] =
    `A vulnerability in ${spec.pkg} (${spec.cve}) affecting ${spec.version}; ` +
    `fixed in ${spec.fixed}. ${String(node["description"] ?? "")}`.slice(0, 300);
  if (awaiting) {
    // Vendor-blocked: no fix published. Empty fixedVersion + null fixDate = no fix
    // signal, so the actionable clock skips it while it stays OPEN in exposure counts.
    // Some carry a vendor ETA (future fixDateBefore); a few are on an end-of-life OS.
    node["status"] = "OPEN";
    node["resolvedAt"] = null;
    node["fixedVersion"] = null;
    node["recommendedVersion"] = null;
    node["fixDate"] = null;
    node["fixDateBefore"] = rnd() < 0.5 ? iso(NOW + (14 + rnd() * 60) * DAY) : null;
    node["isOperatingSystemEndOfLife"] = rnd() < 0.25;
    node["lastDetectedAt"] = iso(NOW - rnd() * 2 * DAY);
  } else if (resolved && resolvedMs < NOW - DAY) {
    node["status"] = "RESOLVED";
    node["resolvedAt"] = iso(resolvedMs);
    node["fixDate"] = node["resolvedAt"];
    node["fixDateBefore"] = null;
    node["isOperatingSystemEndOfLife"] = false;
    node["lastDetectedAt"] = iso(resolvedMs - DAY / 2);
  } else {
    node["status"] = "OPEN";
    node["resolvedAt"] = null;
    node["fixDate"] = null;
    node["fixDateBefore"] = null;
    node["isOperatingSystemEndOfLife"] = false;
    node["lastDetectedAt"] = iso(NOW - rnd() * 2 * DAY);
  }

  const va: Rec = node["vulnerableAsset"];
  va["id"] = asset.id;
  va["name"] = asset.name;
  va["cloudPlatform"] = asset.cloud;
  va["operatingSystem"] = asset.os;
  va["subscriptionName"] = asset.sub;
  va["subscriptionExternalId"] = asset.subExt;
  va["subscriptionId"] = asset.subId;
  va["tags"] = asset.tags;
  va["hasWideInternetExposure"] = asset.wide;
  va["hasLimitedInternetExposure"] = asset.limited;
  return node;
}

const nodes: Rec[] = [];
for (const asset of ASSETS) {
  const count = 3 + Math.floor(rnd() * 8); // 3–10 findings per asset
  const start = Math.floor(rnd() * CVES.length);
  for (let k = 0; k < count; k++) {
    nodes.push(makeNode(CVES[(start + k * 5) % CVES.length], asset, nodes.length + 1));
  }
}

export const SAMPLE_FLAT = {
  data: {
    vulnerabilityFindings: {
      nodes,
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  },
};
