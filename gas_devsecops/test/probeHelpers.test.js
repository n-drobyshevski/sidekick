// The probe's pure helpers, and the two bugs that shipped in them.
//
// Both were in functions that look too small to break: one parsed a .env line, the other
// decided whether a field name names a time. Neither had a test, because probe.mjs cannot
// be imported — it checks credentials, bundles through esbuild and top-level-awaits, all at
// module scope. Extracting them was the fix; these are the vectors.

import { describe, expect, it } from "vitest";
import { envValue, temporalFields, temporalName, temporalType } from "../probeHelpers.mjs";

describe("envValue", () => {
  it("drops a trailing comment from an unquoted value", () => {
    // The bug: a greedy (.*) kept the comment, so this yielded a 101-character project ID
    // and every query was scoped to a project that does not exist. The tenant answered each
    // one with a cheerful empty page — a parse bug wearing an empty register's clothes.
    expect(envValue("1dfea0cf-834f-5522-b797-bee5aaf09251   # VALUE-CHAIN, pre-filled"))
      .toBe("1dfea0cf-834f-5522-b797-bee5aaf09251");
  });

  it("keeps a # that is part of a quoted secret", () => {
    // Stripping here would corrupt a credential rather than a comment, which is the more
    // expensive direction to get wrong: it fails at authentication, far from the cause.
    expect(envValue('"tok#en-with-a-hash"')).toBe("tok#en-with-a-hash");
    expect(envValue("'p#ssw0rd'")).toBe("p#ssw0rd");
  });

  it("keeps a # with no space before it, which is not a comment", () => {
    expect(envValue("has#nospacebefore")).toBe("has#nospacebefore");
  });

  it("trims, and survives an unterminated quote rather than throwing", () => {
    expect(envValue("  plain  ")).toBe("plain");
    expect(envValue('"unterminated')).toBe("unterminated");
    expect(envValue("")).toBe("");
  });
});

describe("temporalName", () => {
  // Every name below appears in PROBE_FINDINGS.md — either as a timestamp the probe must
  // report, or as one of the six the i-flagged regex falsely claimed was one.
  const IS_TIME = [
    "createdAt", "updatedAt", "firstDetectedAtSource", "rejectionExpiredAt",
    "firstSeenAt", "lastSeenAt", "lastUpdatedAt", "lastValidatedAt", "resolvedAt",
    "firstDetectedAt", "lastDetectedAt", "fixDate", "riskObservedAt",
    "CREATED_AT", "LAST_SEEN",
  ];
  const IS_NOT = [
    // The six §7.4 caught the i flag falsely flagging, plus the fields Q_SECRETS adds.
    "filePath", "status", "relatedIssues", "organization", "remediationInstructions",
    "originToolData", "severity", "SEVERITY", "name", "id", "startLine", "snippet",
    "path", "initialCommitHash", "secretDataId", "validationStatus", "confidence",
    "externalId", "lineNumber", "codeLibraryLanguage", "hasExploit", "epssProbability",
    "originalSeverity", "resolutionReason", "type", "rule", "projects", "nativeType",
  ];

  it("names a time when the name says so", () => {
    for (const n of IS_TIME) expect(temporalName(n), `${n} should read as temporal`).toBe(true);
  });

  it("does not, when it does not", () => {
    for (const n of IS_NOT) expect(temporalName(n), `${n} must not read as temporal`).toBe(false);
  });

  it("keeps the camelCase boundary an `i` flag destroys", () => {
    // These two are the exact regressions. With /…/i, [a-z_] and [A-Z_] each match any
    // letter, so filePath matches as P+at+h and status as st+at+us.
    expect(temporalName("filePath")).toBe(false);
    expect(temporalName("status")).toBe(false);
    // …while still catching the SCREAMING_SNAKE enum value the flag was added for.
    expect(temporalName("CREATED_AT")).toBe(true);
  });
});

describe("temporalFields", () => {
  it("catches a field its NAME misses but its TYPE gives away", () => {
    // rejectionExpiredAt only ever qualified through DateTime; the old name pattern had no
    // branch for a Capitalised word inside a name. Both paths are covered now.
    expect(temporalType("DateTime")).toBe(true);
    expect(temporalType("String!")).toBe(false);
  });

  it("returns the four SASTFinding carries, and not the thirteen the i flag claimed", () => {
    // The acceptance test for §7.4, on the real field list.
    const sastFinding = [
      { name: "id", type: "ID!" }, { name: "name", type: "String!" },
      { name: "status", type: "FindingCommonStatus!" }, { name: "severity", type: "FindingSeverity!" },
      { name: "originalSeverity", type: "FindingSeverity" }, { name: "filePath", type: "String" },
      { name: "startLine", type: "Int" }, { name: "codeLibraryLanguage", type: "[String!]" },
      { name: "origin", type: "String" }, { name: "resolutionReason", type: "String" },
      { name: "relatedIssues", type: "[Issue!]" }, { name: "organization", type: "Organization" },
      { name: "remediationInstructions", type: "String" }, { name: "originToolData", type: "JSON" },
      { name: "createdAt", type: "DateTime!" }, { name: "updatedAt", type: "DateTime!" },
      { name: "firstDetectedAtSource", type: "DateTime" }, { name: "rejectionExpiredAt", type: "DateTime" },
    ];
    expect(temporalFields(sastFinding).map((f) => f.name)).toEqual([
      "createdAt", "updatedAt", "firstDetectedAtSource", "rejectionExpiredAt",
    ]);
  });

  it("tolerates a missing field list rather than throwing mid-probe", () => {
    expect(temporalFields(undefined)).toEqual([]);
  });
});
