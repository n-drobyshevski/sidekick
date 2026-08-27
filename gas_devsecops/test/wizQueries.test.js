// The filter objects decide WHICH POPULATION every downstream metric is computed over. A
// wrong key here is not an error — it is a plausible-looking number about the wrong thing.
//
// THE VECTORS BELOW WERE WRONG ABOUT SAST UNTIL 2026-08-27, and how they got that way is
// worth keeping. They were produced by running brick/devsecops/ingest.py::build_filter and
// pinned verbatim — but brick's helper builds one shape for both scopes, and that shape is
// only correct for SCA. So this file pinned `severity: ["CRITICAL","HIGH"]` for SAST, which
// the live tenant refuses with HTTP 400 VALIDATION_INVALID_TYPE_VARIABLE: SASTFindingFilters
// .severity is SASTSeverityFilter, an object taking {equals:[...]}. Every SAST sync fetched
// zero rows, and this test asserted that it should. See PROBE_FINDINGS.md §4.
//
// The lesson is not "brick was wrong" — brick's SCA vector is still correct and still
// pinned. It is that a vector shared across two scopes hides the case where the two schemas
// genuinely disagree, so the shapes are now asserted to DIFFER, by name, below.

import { describe, expect, it } from "vitest";
import {
  MAX_PAGES, PAGE_SIZE, QUERIES, Q_SAST, Q_SCA, SAST_FETCH_RESOLVED,
  buildFilter, buildVariables, severityFilter,
} from "../src/server/wizQueries";
import { SCOPES } from "../src/domain/config";
import { TABS, TAB_HEADERS } from "../src/server/sheetsDb";

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
      // An OBJECT, not a list. This exact payload was re-sent to the tenant with the app's
      // own bundled Q_SAST and returned HTTP 200 / totalCount 127, which is what isolates
      // the cause to the filter rather than the document.
      severity: { equals: ["CRITICAL", "HIGH"] },
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

  // THE ASSERTION THAT WOULD HAVE CAUGHT IT. A shared helper applying one convention to
  // both scopes is how they drifted, so the disagreement is asserted directly rather than
  // left implicit in two independent vectors that could both be regenerated wrong.
  it("shapes severity differently per scope, because the two filter types disagree", () => {
    const sca = buildFilter("sca", { severities: SEV }).severity;
    const sast = buildFilter("sast", { severities: SEV }).severity;

    expect(Array.isArray(sca), "VulnerabilityFindingFilters.severity is [VulnerabilitySeverity!] — a bare list").toBe(true);
    expect(Array.isArray(sast), "SASTFindingFilters.severity is SASTSeverityFilter — an object, not a list").toBe(false);
    expect(sast, "SASTSeverityFilter takes { equals: [...] }").toEqual({ equals: SEV });
    expect(sca, "the two must not be given the same shape").not.toEqual(sast);
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

  it("selects createdAt, which is the birth date the ledger dates the clock from", () => {
    // Reversed on 2026-08-27. The old assertion said Q_SAST selects NO timestamp, which was
    // true of the document and false of the type: SASTFinding exposes createdAt: DateTime!,
    // filterable and sortable. Selecting it is what turns SAST from an age register into a
    // real MTTR one, because the ledger prefers an API birth date over an observed one and
    // supplies the death date by disappearance. PROBE_FINDINGS.md §2.
    expect(Q_SAST).toContain("createdAt");
  });

  it("still selects no RESOLUTION date, because the type has none", () => {
    // Forty-three fields on SASTFinding, not one of them a resolution date. This is the
    // reason the flag above stays false, and it is a different reason from the old one.
    expect(Q_SAST).not.toContain("resolvedAt");
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

describe("the documents are valid GraphQL, and lean", () => {
  it("carries no JS comment inside a document", () => {
    // Written after putting `//` comments inside Q_SAST. GraphQL comments are `#`, so a
    // JS-style one is a SYNTAX ERROR the server rejects — and the failure surfaces only on
    // a live request, which is the most expensive place to find it. Explanation belongs in
    // the TSDoc above each document, where it also stays off the wire.
    for (const [scope, doc] of Object.entries(QUERIES)) {
      if (!doc) continue;
      expect(doc, `${scope} has a // comment inside the document`).not.toContain("//");
    }
  });

  it("ships no prose over the wire at all", () => {
    // Even a valid `#` comment is sent on every page of every sync.
    for (const [scope, doc] of Object.entries(QUERIES)) {
      if (!doc) continue;
      expect(doc, `${scope} has a # comment inside the document`).not.toMatch(/^\s*#/m);
    }
  });

  it("balances its braces", () => {
    for (const [scope, doc] of Object.entries(QUERIES)) {
      if (!doc) continue;
      const open = (doc.match(/\{/g) || []).length;
      const close = (doc.match(/\}/g) || []).length;
      expect(open, `${scope} has unbalanced braces`).toBe(close);
    }
  });

  it("asks for a total count on every connection, so a sync can report progress", () => {
    for (const [scope, doc] of Object.entries(QUERIES)) {
      if (!doc) continue;
      expect(doc, `${scope} selects no totalCount`).toContain("totalCount");
    }
  });
});

describe("the secrets ledger keeps rotation as a tri-state", () => {
  it("carries a validation state beside the rotation date", () => {
    // `rotated_at IS NULL` is ambiguous between "still live" and "never checked", and in
    // this tenant 99.6% of secret instances have never been checked. A register that
    // published that null as "not rotated" would be asserting something about 393,443 rows
    // it has no evidence for. PROBE_FINDINGS.md §3.
    const cols = TAB_HEADERS[TABS.ledger];
    for (const c of ["secret_kind", "removed_at", "rotated_at", "validation_state", "validated_at"]) {
      expect(cols, `the ledger has no ${c} column`).toContain(c);
    }
  });

  it("keeps removal and rotation as two columns, because they are two events", () => {
    const cols = TAB_HEADERS[TABS.ledger];
    expect(cols.indexOf("removed_at")).not.toBe(cols.indexOf("rotated_at"));
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
