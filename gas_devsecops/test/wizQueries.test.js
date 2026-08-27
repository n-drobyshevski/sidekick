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
  MAX_PAGES, PAGE_SIZE, QUERIES, Q_SAST, Q_SCA, Q_SECRETS, SAST_FETCH_RESOLVED,
  buildFilter, buildVariables, severityFilter,
  OBJECT_FILTERS as OBJECT_FILTERS_FOR_TEST,
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

describe("Q_SECRETS", () => {
  it("asks secretInstances, the root the tenant actually has", () => {
    expect(Q_SECRETS).toContain("secretInstances(");
    expect(Q_SECRETS).toContain("$filterBy: SecretInstanceFilters");
  });

  it("spells the commit initialCommitHash, not commitHash", () => {
    // SASTFindingVcsDetails has commitHash; SecretInstanceVcsDetails has only
    // initialCommitHash. Copying SAST's selection fails the WHOLE document, the same way a
    // wrong union member would — so this is a document-level trap, not a missing field.
    expect(Q_SECRETS).toContain("initialCommitHash");
    expect(Q_SECRETS).not.toMatch(/[^l]commitHash/);
  });

  it("SELECTS NEITHER snippet NOR validationDetails", () => {
    // A security decision, not an oversight. The durable store is a Google Sheet plus Drive
    // archives readable by everyone on the allowlist and exportable to CSV by any of them —
    // a far wider audience than the repository the secret sits in. 1,859 of the 1,933
    // CODE-scoped rows are OPEN, so most of that text is live credential material. A
    // secrets tool that copies secrets into a spreadsheet has made the exposure worse.
    expect(Q_SECRETS, "snippet carries the matched secret text").not.toContain("snippet");
    expect(Q_SECRETS, "validationDetails is undocumented and may carry the credential")
      .not.toContain("validationDetails");
  });

  it("carries both clocks, because removal is not rotation", () => {
    for (const f of ["status", "resolvedAt", "validationStatus", "lastValidatedAt"]) {
      expect(Q_SECRETS, `Q_SECRETS omits ${f}`).toContain(f);
    }
  });

  it("carries the secret TYPE, since PUBLIC_KEY is in the enum", () => {
    // SecretDetectionRuleType includes PUBLIC_KEY alongside SAAS_API_KEY and PRIVATE_KEY.
    // Not every row is a live credential; a rotation metric counting them all measures the
    // wrong population, so the register needs the type to exclude rather than average.
    expect(Q_SECRETS).toContain("type");
  });

  it("carries secretDataId, the probable dedup key", () => {
    // Distinct from id and externalId. Selected so it can be confirmed against data — the
    // ledger key must not depend on it before that.
    expect(Q_SECRETS).toContain("secretDataId");
  });
});

describe("the secrets filter", () => {
  const f = () => buildFilter("secrets", { severities: SEV, projectId: PROJECT });

  it("narrows to CODE, which is what makes the clock trustworthy", () => {
    // 394,927 -> 1,933. And unscoped, secrets close 0.25s-63s after first sight — the
    // instant-close artifact. On CODE, not one of the 72 resolved rows closes inside a day.
    // The OBJECT shape, not a list — see the dedicated test below for why that mattered.
    expect(f().codeToCloudPipelineStage).toEqual({ equals: ["CODE"] });
  });

  it("shapes status, validationStatus and severity as OBJECTS", () => {
    expect(f().status).toEqual({ equals: ["OPEN", "RESOLVED"] });
    expect(f().severity).toEqual({ equals: SEV });
  });

  it("shapes projectId as a BARE LIST in the same filter type", () => {
    // SecretInstanceFilters mixes both conventions internally. This assertion sits beside
    // the one above on purpose: they are the same type disagreeing with itself, which is
    // the §4 trap at finer grain. Infer nothing from one field to the next.
    expect(f().projectId).toEqual([PROJECT]);
    expect(Array.isArray(f().projectId)).toBe(true);
    expect(Array.isArray(f().status)).toBe(false);
  });

  it("sends codeToCloudPipelineStage as an OBJECT, like the rest of its own type", () => {
    // THIS TEST PINNED THE DEFECT. It asserted a bare list, and the claim it encoded was
    // "shaped after SCA's same-named field" — an inference, made because §7.3 printed only
    // the three keys the probe had hardcoded and this one went unprinted.
    //
    // Two independent readings falsified it (PROBE_FINDINGS.md §8.1). The schema:
    //   SecretInstanceFilters.codeToCloudPipelineStage
    //     SecretInstanceCodeToCloudPipelineStageFilter -> OBJECT { equals: [...] }
    // and the tenant, which refused the shipped shape with HTTP 400
    // VALIDATION_INVALID_TYPE_VARIABLE. With only this key corrected the same document
    // returns 200 and 691 rows.
    //
    // The design worked: the register failed LOUDLY on the next probe run instead of
    // quietly fetching zero rows, which is what the SAST defect did for a whole pass.
    expect(f().codeToCloudPipelineStage).toEqual({ equals: ["CODE"] });
  });
});

describe("no filter value can bypass the shape table", () => {
  // The one-key fix did NOT work on its own, and that is the more useful finding. BASE
  // wrote codeToCloudPipelineStage as a literal ["CODE"], so it never passed through
  // listFilter: adding the key to OBJECT_FILTERS changed nothing at all. A shape table
  // covering only part of the filter is worse than no table, because it reads as covering
  // all of it. shapeBase now routes every list-valued BASE key through the same lookup.
  // The table governs LIST-valued keys only — which convention a list of enum values takes.
  // A boolean filter like `isDefaultBranch: {equals: true}` is a different thing: its
  // `equals` holds a scalar, not a list, and it has no bare-list alternative to choose
  // between. The first version of this test conflated the two and flagged
  // sca.isDefaultBranch, which was the test being wrong rather than the filter.
  const listShaped = (v) => Array.isArray(v)
    || (v !== null && typeof v === "object" && Array.isArray(v.equals));

  it("shapes every list-valued key according to its own scope's table", () => {
    for (const scope of SCOPES) {
      const filter = buildFilter(scope, { severities: SEV, projectId: PROJECT });
      for (const [key, value] of Object.entries(filter)) {
        if (!listShaped(value)) continue;
        const wrapped = !Array.isArray(value);
        expect(
          OBJECT_FILTERS_FOR_TEST[scope].includes(key),
          wrapped
            ? `${scope}.${key} is sent wrapped but the table does not list it`
            : `${scope}.${key} is sent bare but the table says it is an object filter`,
        ).toBe(wrapped);
      }
    }
  });

  it("leaves boolean filters alone — they are not a list convention", () => {
    expect(buildFilter("sca", {}).isDefaultBranch).toEqual({ equals: true });
    expect(buildFilter("sast", {}).resource).toEqual({ isDefaultBranch: { equals: true } });
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
  it("has a document for every scope", () => {
    expect(Object.keys(QUERIES).sort()).toEqual([...SCOPES].sort());
    // Q_SECRETS was null until 2026-08-27, and the claim that test encoded was "we do not
    // know this schema" — true then, and the right thing to assert rather than shipping a
    // plausible document that would typecheck and measure the wrong population. The probe
    // answered it: the root, the identity fields and the filter shapes are all in
    // PROBE_FINDINGS.md §3 and §7.3, so the query is now written FROM the schema.
    for (const scope of SCOPES) {
      expect(QUERIES[scope], `${scope} has no document`).toBeTruthy();
    }
  });

  it("still refuses to build variables for a scope with no document", () => {
    // The guard outlives the case that motivated it: a fourth scope added without a query
    // must fail loudly at the call rather than send `undefined` and read as an empty
    // register. Asserted against a scope that does not exist, since all three now have one.
    expect(() => buildVariables("iac")).toThrow(/no query document/);
  });

  it("pages at a size the estate needs", () => {
    expect(buildVariables("sca").first).toBe(PAGE_SIZE);
    expect(PAGE_SIZE).toBeGreaterThanOrEqual(100);
    expect(MAX_PAGES).toBeGreaterThan(0);
  });
});
