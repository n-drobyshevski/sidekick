// The filter objects decide WHICH POPULATION every downstream metric is computed over. A
// wrong key here is not an error — it is a plausible-looking number about the wrong thing.
//
// The four vectors below were produced by running brick/devsecops/ingest.py::build_filter,
// which is tenant-verified, and are pinned verbatim. If this port drifts from it, the two
// surfaces would report different figures for the same estate and nothing else would say so.

import { describe, expect, it } from "vitest";
import {
  MAX_PAGES, PAGE_SIZE, QUERIES, Q_SAST, Q_SCA, SAST_FETCH_RESOLVED,
  buildFilter, buildVariables, severityFilter,
} from "../src/server/wizQueries";
import { SCOPES } from "../src/domain/config";

const SEV = ["CRITICAL", "HIGH"];
const PROJECT = "1dfea0cf-834f-5522-b797-bee5aaf09251";

describe("buildFilter matches brick/devsecops::build_filter", () => {
  it("scopes SCA to code-stage findings on the default branch that have a fix", () => {
    expect(buildFilter("sca", { severities: SEV })).toEqual({
      status: ["OPEN", "RESOLVED"],
      hasFix: true,
      codeToCloudPipelineStage: ["CODE"],
      isDefaultBranch: { equals: true },
      severity: ["CRITICAL", "HIGH"],
    });
  });

  it("scopes SAST to the default branch, and asks for no status", () => {
    expect(buildFilter("sast", { severities: SEV })).toEqual({
      resource: { isDefaultBranch: { equals: true } },
      severity: ["CRITICAL", "HIGH"],
    });
  });

  // The two filter types spell the project restriction differently. Both spellings come
  // from the tenant's OWN exported reference scripts, which is the only reason to trust
  // an asymmetry this easy to "tidy up" into a bug.
  it("spells the project filter projectIdV2.equals for SCA", () => {
    expect(buildFilter("sca", { severities: SEV, projectId: PROJECT })).toMatchObject({
      projectIdV2: { equals: [PROJECT] },
    });
  });

  it("spells it as a bare projectId list for SAST", () => {
    expect(buildFilter("sast", { severities: SEV, projectId: PROJECT })).toMatchObject({
      projectId: [PROJECT],
    });
  });

  it("omits severity entirely when none is requested, rather than sending an empty list", () => {
    expect(buildFilter("sca", { severities: [] })).not.toHaveProperty("severity");
  });

  it("translates INFO to the API's INFORMATIONAL and drops what it does not know", () => {
    expect(severityFilter(["INFO", "CRITICAL", "NONSENSE"])).toEqual(["INFORMATIONAL", "CRITICAL"]);
  });

  it("does not let one call's filter leak into the next", () => {
    const a = buildFilter("sca", { severities: SEV });
    a.severity = ["MEDIUM"];
    expect(buildFilter("sca", { severities: SEV }).severity).toEqual(["CRITICAL", "HIGH"]);
  });
});

describe("the SAST timestamp decision", () => {
  it("does not ask for resolved SAST findings", () => {
    // Q_SAST selects no timestamp, so a finding that is already resolved when first seen
    // would be born and closed in the same instant: a real mttr_days === 0.0 that drags the
    // half-life to the floor. Flip this only once probe.mjs finds a field to date them from.
    expect(SAST_FETCH_RESOLVED).toBe(false);
    expect(buildFilter("sast", { severities: SEV })).not.toHaveProperty("status");
  });

  it("selects no timestamp field, which is the fact the sast page has to state", () => {
    for (const f of ["firstDetectedAt", "lastDetectedAt", "resolvedAt", "createdAt"]) {
      expect(Q_SAST, `Q_SAST unexpectedly selects ${f}`).not.toContain(f);
    }
  });
});

describe("the SCA documents carry the second clock's inputs", () => {
  it("selects fixDate and fixedVersion", () => {
    expect(Q_SCA).toContain("fixDate");
    expect(Q_SCA).toContain("fixedVersion");
  });

  it("selects the three nullable risk signals", () => {
    for (const f of ["hasExploit", "hasCisaKevExploit", "epssProbability"]) {
      expect(Q_SCA).toContain(f);
    }
  });

  it("narrows the vulnerableAsset union to the two members this tenant has", () => {
    // A fragment naming a member the tenant lacks fails the WHOLE document, so the
    // narrowing is load-bearing rather than tidy.
    expect(Q_SCA).toContain("... on VulnerableAssetBase");
    expect(Q_SCA).toContain("... on VulnerableAssetRepositoryBranch");
    expect((Q_SCA.match(/\.\.\. on /g) || []).length).toBe(2);
  });
});

describe("no inline literals in any document", () => {
  it("passes every filter through $filterBy", () => {
    // Inline literals do not survive this gateway; gas_ai learned it twice.
    for (const [scope, doc] of Object.entries(QUERIES)) {
      if (!doc) continue;
      expect(doc, `${scope} declares no $filterBy`).toContain("$filterBy");
      expect(doc, `${scope} inlines a filter literal`).not.toMatch(/filterBy:\s*\{/);
    }
  });
});

describe("scope coverage", () => {
  it("has an entry for every scope, and secrets is honestly null", () => {
    expect(Object.keys(QUERIES).sort()).toEqual([...SCOPES].sort());
    // Absent rather than guessed: a plausible document would typecheck, ship, and then
    // measure the wrong population. probe.mjs --roots finds the real root.
    expect(QUERIES.secrets).toBeNull();
  });

  it("refuses to build variables for a scope with no document", () => {
    expect(() => buildVariables("secrets")).toThrow(/no query document/);
  });

  it("pages at a size the estate needs", () => {
    expect(buildVariables("sca").first).toBe(PAGE_SIZE);
    expect(PAGE_SIZE).toBeGreaterThanOrEqual(100);
    expect(MAX_PAGES).toBeGreaterThan(0);
  });
});
