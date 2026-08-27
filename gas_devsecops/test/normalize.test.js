// SCA and SAST nodes -> observations, and the key rule that differs by scope.

import { describe, expect, it } from "vitest";
import { normalizeSast, normalizeSca } from "../src/domain/normalize";
import { secretsFindingKey } from "../src/domain/secretsLedger";

function scaNode(over = {}) {
  return {
    id: "sca-finding-1",
    name: "CVE-2026-1234",
    detailedName: "log4j-core 2.14.1",
    severity: "CRITICAL",
    status: "OPEN",
    firstDetectedAt: "2026-01-10T00:00:00Z",
    lastDetectedAt: "2026-08-20T00:00:00Z",
    resolvedAt: null,
    fixDate: "2026-01-15T00:00:00Z",
    fixedVersion: "2.17.1",
    hasExploit: true,
    hasCisaKevExploit: null,
    epssProbability: 0.42,
    vulnerableAsset: {
      id: "repo-branch-1", type: "REPOSITORY_BRANCH", name: "dktunited/api/main",
      cloudPlatform: "GitHub",
    },
    artifactType: { codeLibraryLanguage: "JAVA" },
    ...over,
  };
}

function sastNode(over = {}) {
  return {
    id: "sast-finding-1",
    name: "Hardcoded credential",
    status: "OPEN",
    severity: "HIGH",
    originalSeverity: "HIGH",
    filePath: "src/main/java/App.java",
    startLine: 88,
    codeLibraryLanguage: "JAVA",
    origin: "WIZ",
    resolutionReason: null,
    createdAt: "2026-02-01T00:00:00Z",
    updatedAt: "2026-08-20T00:00:00Z",
    firstDetectedAtSource: "2026-02-03T00:00:00Z",
    resource: { id: "repo-1", name: "dktunited/api", type: "REPOSITORY" },
    weaknesses: [{ id: "cwe-798", name: "CWE-798" }],
    projects: [{ id: "p1", name: "VALUE-CHAIN", isFolder: false, slug: "value-chain" }],
    vcsDetails: { commitHash: "cafebabe" },
    aiAnalysis: { verdict: null },
    ...over,
  };
}

describe("the key rule differs by scope, and the FILTER is why", () => {
  it("SCA and SAST adopt the Wiz id", () => {
    // Right where the id is stable per FINDING — which it is here, because both registers are
    // filtered to isDefaultBranch {equals: true} and so reach one entity per finding.
    expect(normalizeSca(scaNode()).finding_key).toBe("sca:id:sca-finding-1");
    expect(normalizeSast(sastNode()).finding_key).toBe("sast:id:sast-finding-1");
  });

  it("secrets does not, and the three namespaces cannot collide", () => {
    // §10.6: on secrets the Wiz id is stable per ROW — 187 findings carry two of them. The
    // prefixes keep the schemes apart so a scope that starts arriving with an id can never
    // collide with the hash that stood in for it.
    const sec = secretsFindingKey({ secretDataId: "s", path: "p", lineNumber: 1 });
    expect(sec.startsWith("secrets:h:")).toBe(true);
    expect(new Set([
      normalizeSca(scaNode()).finding_key, normalizeSast(sastNode()).finding_key, sec,
    ]).size).toBe(3);
  });

  it("falls back to a hash of the semantic identity when the API returns no id", () => {
    const a = normalizeSca(scaNode({ id: null }));
    const b = normalizeSca(scaNode({ id: "" }));
    expect(a.finding_key.startsWith("sca:h:")).toBe(true);
    expect(b.finding_key).toBe(a.finding_key);
  });

  it("distinguishes the same CVE on different assets", () => {
    const a = normalizeSca(scaNode({ id: null }));
    const b = normalizeSca(scaNode({
      id: null, vulnerableAsset: { id: "other-repo", type: "REPOSITORY_BRANCH", name: "x/main" },
    }));
    expect(a.finding_key).not.toBe(b.finding_key);
  });
});

describe("SCA", () => {
  it("carries both clocks and the exploit intelligence", () => {
    const o = normalizeSca(scaNode());
    expect(o.identifier).toBe("CVE-2026-1234");
    expect(o.component).toBe("log4j-core 2.14.1");
    expect(o.first_seen).toBe("2026-01-10T00:00:00Z");
    expect(o.fix_date).toBe("2026-01-15T00:00:00Z");
    expect(o.fixed_version).toBe("2.17.1");
    expect(o.epss).toBe(0.42);
    expect(o.language).toBe("JAVA");
    expect(o.is_open).toBe(true);
  });

  it("keeps an unevaluated signal null rather than false", () => {
    // Wiz returns null for a signal it never evaluated. Collapsing that to false is what
    // makes an unassessed finding render as clean.
    const o = normalizeSca(scaNode({ hasCisaKevExploit: null, hasExploit: null, epssProbability: null }));
    expect(o.has_kev).toBeNull();
    expect(o.has_exploit).toBeNull();
    expect(o.epss).toBeNull();
  });

  it("keeps a measured false as false", () => {
    const o = normalizeSca(scaNode({ hasExploit: false }));
    expect(o.has_exploit).toBe(false);
  });

  it("reads a resolution from either the date or the status", () => {
    expect(normalizeSca(scaNode({ resolvedAt: "2026-03-01T00:00:00Z" })).is_open).toBe(false);
    expect(normalizeSca(scaNode({ status: "RESOLVED" })).is_open).toBe(false);
    expect(normalizeSca(scaNode({ status: "REMEDIATED" })).is_open).toBe(false);
  });

  it("names the branch only when the asset IS one", () => {
    // The union has two members. VulnerableAssetBase is not a branch and has no branch name
    // to give; guessing one from the asset name would invent an attribution.
    expect(normalizeSca(scaNode()).branch).toBe("dktunited/api/main");
    const base = normalizeSca(scaNode({
      vulnerableAsset: { id: "vm-1", type: "VIRTUAL_MACHINE", name: "vm-1", cloudPlatform: "AWS" },
    }));
    expect(base.branch).toBeNull();
  });
});

describe("SAST", () => {
  it("is always open, because the API has no way to say otherwise", () => {
    // §2: SASTFinding exposes no resolvedAt, and `status: RESOLVED` returns 0 rows in this
    // tenant — which is why SAST_FETCH_RESOLVED is false. Every SAST resolution in the
    // ledger is therefore a disappearance, and that is a real MTTR rather than an age
    // metric because createdAt gives it a genuine birth date.
    expect(normalizeSast(sastNode()).is_open).toBe(true);
    expect(normalizeSast(sastNode({ status: "RESOLVED" })).is_open).toBe(true);
    expect(normalizeSast(sastNode()).resolved_at).toBeNull();
  });

  it("dates from createdAt, not firstDetectedAtSource", () => {
    // The two disagree, and createdAt is the one the filter sorts on and the register dates
    // from. Taking the earlier of the pair would be a silent third answer.
    const o = normalizeSast(sastNode());
    expect(o.first_seen).toBe("2026-02-01T00:00:00Z");
  });

  it("carries the location, the CWE and the commit", () => {
    const o = normalizeSast(sastNode());
    expect(o.component).toBe("src/main/java/App.java:88");
    expect(o.file_path).toBe("src/main/java/App.java");
    expect(o.start_line).toBe(88);
    expect(o.cwe).toBe("CWE-798");
    expect(o.origin).toBe("cafebabe");
    expect(o.owner_project).toBe("VALUE-CHAIN");
  });

  it("leaves the risk signals null, and that null is NOT-APPLICABLE", () => {
    // A static-analysis finding has no CVE, so no KEV listing and no EPSS score exist for
    // it — a different thing from an SCA row Wiz never evaluated. `scope` is the
    // discriminator; there is no fourth state column, and adding one would be the wrong fix.
    const o = normalizeSast(sastNode());
    expect(o.has_kev).toBeNull();
    expect(o.has_exploit).toBeNull();
    expect(o.epss).toBeNull();
    expect(o.fix_date).toBeNull();
    expect(o.fixed_version).toBeNull();
    expect(o.scope).toBe("sast");
  });

  it("survives a node missing every optional nesting", () => {
    const o = normalizeSast({ id: "x", name: "R", severity: "LOW", createdAt: null });
    expect(o.finding_key).toBe("sast:id:x");
    expect(o.cwe).toBeNull();
    expect(o.repo_id).toBeNull();
    expect(o.owner_project).toBeNull();
    expect(o.first_seen).toBeNull();
  });
});
