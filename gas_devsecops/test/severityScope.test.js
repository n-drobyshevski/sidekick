// The secrets register has NO SEVERITY GATE, and this file holds the three links in the
// chain that makes that true. settingsLogic.test.js pins the default itself; what is pinned
// here is that the default reaches the wire as "no severity key at all", which is a
// different claim and lives in a different file.
//
// The gate was wrong twice. It was inherited as CRITICAL/HIGH from the vulnerability
// registers, where it is a volume control; it was then walked down to MEDIUM on the strength
// of "PASSWORD and CERTIFICATE sit below HIGH" — true, and not the same as "they sit at
// MEDIUM". With the gate off, the register is the whole CODE population and the crosstab
// sums to it exactly (PROBE_FINDINGS.md §10.3):
//
//     type                    CRIT   HIGH    MED    LOW   INFO
//     CERTIFICATE                0      0      0      0    160
//     CLOUD_KEY                  0    171      0     39      0
//     DB_CONNECTION_STRING       0     28      0     41     17
//     GIT_CREDENTIAL             0      8      0      0      2
//     PASSWORD                   0      0    107     17     84
//     PRIVATE_KEY                0    156      0      0      0
//     SAAS_API_KEY               0    328     45    641    114
//
//     691 (CRIT+HIGH) + 152 (MED) + 738 (LOW) + 377 (INFO) = 1,958
//
// CERTIFICATE is 160 of 160 INFORMATIONAL and PASSWORD is 208 of 208 below HIGH, so any
// floor at all removes whole categories. Severity is the wrong instrument here: it grades a
// DETECTION — 641 SAAS_API_KEY rows are LOW — not whether a credential is live. Volume was
// never the reason either; 1,958 rows is an eighth of SCA.

import { describe, expect, it } from "vitest";
import { buildFilter, severityFilter } from "../src/server/wizQueries";
import { cleanSettings } from "../src/domain/settingsLogic";
import { DEFAULT_FETCH_SEVERITIES } from "../src/domain/config";

describe("the secrets scope sends no severity filter", () => {
  it("builds a filter with no severity key at all", () => {
    // Not `severity: []`, not `severity: {equals: []}` — ABSENT. An empty object filter is a
    // predicate the tenant still evaluates, and what it evaluates to is not this register's
    // to guess.
    const filter = buildFilter("secrets", { severities: DEFAULT_FETCH_SEVERITIES.secrets });
    expect(Object.keys(filter)).not.toContain("severity");
  });

  it("keeps the gate on the two registers where it is a volume control", () => {
    // The contrast is the point: the same code path with a non-empty list DOES emit the key,
    // so the absence above is the empty list doing its job rather than buildFilter losing it.
    expect(buildFilter("sca", { severities: ["CRITICAL", "HIGH"] })).toHaveProperty("severity");
    expect(buildFilter("sast", { severities: ["CRITICAL", "HIGH"] })).toHaveProperty("severity");
  });

  it("passes an empty list through severityFilter as an empty list", () => {
    // The middle link. `buildFilter` only omits the key when this returns nothing.
    expect(severityFilter(DEFAULT_FETCH_SEVERITIES.secrets)).toEqual([]);
  });
});

describe("the default that produces it", () => {
  it("is empty, and empty means all", () => {
    expect(
      DEFAULT_FETCH_SEVERITIES.secrets.length,
      "A floor here deletes whole categories, not a tail: with the gate off the register is "
      + "1,958 rows = 691 CRITICAL+HIGH + 152 MEDIUM + 738 LOW + 377 INFORMATIONAL "
      + "(PROBE_FINDINGS.md §10.3). CERTIFICATE is 160 of 160 INFORMATIONAL and PASSWORD is "
      + "208 of 208 below HIGH, so ANY severity floor gives a secrets register with no "
      + "certificates and no passwords in it. Severity grades a detection; gate on "
      + "validation_state or confidence instead.",
    ).toBe(0);
  });

  it("survives the settings normaliser rather than falling back to a default", () => {
    // cleanSettings must read [] as the real answer "every severity". If it treated the empty
    // list as "missing" the gate would come back on the first time an operator saved anything.
    expect(cleanSettings({ fetchSeverities: { secrets: [] } }).fetchSeverities.secrets).toEqual([]);
  });
});
