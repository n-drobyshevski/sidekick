// Every name this app SENDS, checked against the tenant's own schema.
//
// This is the provenance rule at full strength. graphExpand.test.ts checks that a HOP name
// appears in a capture this repo holds, which is the best that could be done while the
// tenant's schema lived only in someone's execution log. exemples/tenant_vocabulary.js is
// that log, written down — so the check becomes "does this tenant have this name", asked
// offline, of all 100 relationships and 252 entity types rather than of one traversal.
//
// It would have caught the original defect on the first commit. Four traversals shipped
// RUNS_AS, HAS_FINDING, PROTECTED_BY, BOUND_TO and PERMITS_ACCESS_ROLE; none of the five is
// on this tenant, and every one of them ran refused for months while the app reported success.
//
// It is deliberately a check on SENT vocabulary, not on persisted vocabulary. EDGE_TYPES is
// the model's own namespace and is allowed to differ — the battery sends ACTING_AS and writes
// RUNS_AS. Checking the persisted list against a tenant reports absences for names nobody
// sends, which is how a correct design looks like a bug.

import { describe, expect, it } from "vitest";

import { relationships, entityTypes, capturedAt } from "../exemples/tenant_vocabulary.js";
import { AGENT_EXPANSION, specVocabulary } from "../src/domain/graphExpand";
import {
  agentRunsAsSpec,
  noGuardrailSpec,
  saExcessiveAccessSpec,
  sensitiveDataAccessSpec,
} from "../src/domain/agentPathQuery";
import { endpointExposureSpec, hostExposureSpec } from "../src/domain/exposureQuery";
import { identityAccessSpec } from "../src/domain/identityQuery";
import { lineageSpec } from "../src/domain/lineageQuery";
import { EDGE_TYPES } from "../src/domain/graphTypes";

/**
 * Every shipped traversal, hand-listed exactly as diagnostics.sentVocabulary does.
 *
 * Hand-listed on purpose: a spec that is exported but never sent should not be able to make
 * this check pass or fail, and a new traversal should have to be added here consciously.
 */
const SPECS = [
  noGuardrailSpec(),
  agentRunsAsSpec(),
  saExcessiveAccessSpec(),
  sensitiveDataAccessSpec(),
  identityAccessSpec([]),
  hostExposureSpec([]),
  endpointExposureSpec([]),
  lineageSpec(),
  AGENT_EXPANSION,
];

const sent = SPECS.reduce(
  (acc, spec) => {
    const v = specVocabulary(spec);
    v.edges.forEach((e) => acc.edges.add(e));
    v.entities.forEach((k) => acc.entities.add(k));
    return acc;
  },
  { edges: new Set(), entities: new Set() },
);

describe("the vocabulary this app sends", () => {
  it("names only relationships this tenant has", () => {
    const tenant = new Set(relationships);
    const absent = [...sent.edges].filter((e) => !tenant.has(e)).sort();
    expect(absent, `not on this tenant (captured ${capturedAt})`).toEqual([]);
  });

  it("names only entity types this tenant has", () => {
    // An entity type the tenant lacks is worse than a wrong relationship: it fails coercion of
    // the whole $query variable, so the step collects nothing and the message names the type
    // rather than the traversal. DATABASE_SERVER emptied the sensitive-data step that way.
    const tenant = new Set(entityTypes);
    const absent = [...sent.entities].filter((k) => !tenant.has(k)).sort();
    expect(absent, `not on this tenant (captured ${capturedAt})`).toEqual([]);
  });

  it("records which persisted edge kinds are also tenant relationships", () => {
    // Not an assertion that they SHOULD match — the two namespaces are separate by design.
    // This pins the census the assessment doc states in prose, so "23 declared, 5 exist" stops
    // being a remembered figure. The three lineage names were added with the LINEAGE step and
    // keep Wiz's own spelling, which is why they appear here and USES_DATASET does not.
    const tenant = new Set(relationships);
    expect(EDGE_TYPES.filter((t) => tenant.has(t))).toEqual([
      "ALLOWS_ACCESS_TO",
      "USES",
      "BUILT_FROM",
      "HAS_DATA_FINDING",
      "SERVES",
      "PRODUCES",
      "READS_DATA_FROM",
      "STORES_DATA_IN",
    ]);
  });

  it("keeps the near-misses visible, because a near-miss is not a substitute", () => {
    // Each pair is a name the app once sent beside the name the tenant actually has. They are
    // close enough to read past, which is exactly why the original five survived review.
    const tenant = new Set(relationships);
    for (const [sent_, real] of [
      ["RUNS_AS", "ACTING_AS"],
      ["HAS_FINDING", "CONTAINS"],
      ["PROTECTED_BY", "PROTECTS"],
      ["BOUND_TO", "ENTITLES"],
      ["PERMITS_ACCESS_ROLE", "PERMITS"],
      ["HOSTED_ON", "HOSTS"],
      ["CAN_INVOKE", "INVOKES"],
      ["STORED_IN", "STORES_DATA_IN"],
    ]) {
      expect(tenant.has(sent_), `${sent_} should NOT be on this tenant`).toBe(false);
      expect(tenant.has(real), `${real} should be on this tenant`).toBe(true);
    }
  });
});
