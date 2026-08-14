// The Wiz Scans coverage layer as pure functions: what each area resolves to under a
// given payload, and — the point of the whole design — what it resolves to when the
// payload cannot back it. Same shape as comboView.test.js: the logic is tested here, the
// pixels are checked in the dev harness.

import { describe, expect, it } from "vitest";
import {
  COVERAGE, COVERAGE_ORDER, DESTINATIONS, SCAN_AREAS,
  coverageTally, destinationOf, rankAreas, resolveArea, resolveAreas,
} from "../src/client/js/scanContent.js";

/** A payload from a synced tenant on a current server bundle. */
const FULL = {
  boot: { filterOptions: { projects: ["alpha", "beta", "gamma"] } },
  kpis: {
    aiAssets: 96,
    agents: 71,
    protectedAgents: 3,
    guardrailCoveragePct: 4,
    sensitiveAccess: 18,
    sensitiveDatastores: 6,
    dataFindings: 14,
    openIssues: 29,
    complianceGaps: 23,
    frameworkPosture: {
      frameworks: 3,
      scoredFrameworks: 3,
      averagePosture: 94,
      failingSubcategories: 4,
      failingPolicies: 7,
    },
    agenticIdentities: 12,
    internetExposed: 2,
    internetUnknown: 5,
    internetValidated: 1,
    internetViaHost: 2,
    highPrivilege: 34,
  },
  total: 96,
  digest: { totals: { totalOpen: 29, patternsActive: 4, patternsTotal: 4 } },
};

const byId = (resolved) => new Map(resolved.map((a) => [a.id, a]));
const stateOf = (ctx, id) => byId(resolveAreas(ctx)).get(id).state;

describe("resolveAreas on a full payload", () => {
  const resolved = resolveAreas(FULL);

  it("splits the ten areas 7 live / 2 partial / 1 unscanned", () => {
    expect(coverageTally(resolved)).toEqual({ live: 7, partial: 2, unscanned: 1 });
  });

  it("reports framework posture as an average over the frameworks that actually scored", () => {
    const area = byId(resolved).get("posture");
    expect(area.state).toBe("live");
    expect(area.figure.value).toBe("94%");
    // "3 of 3" rather than a bare 3: an average over frameworks where one was never
    // assessed is a different claim from one where all were, and the unit has to say which.
    expect(area.figure.unit).toContain("3 of 3 frameworks scored");
    expect(area.figure.unit).toContain("7 failing policies");
  });

  it("tallies to exactly the number of areas, so the strip can never mislead", () => {
    const tally = coverageTally(resolved);
    const summed = COVERAGE_ORDER.reduce((acc, state) => acc + tally[state], 0);
    expect(summed).toBe(SCAN_AREAS.length);
  });

  it("states guardrail coverage as the numerator the server now ships", () => {
    const area = byId(resolved).get("guardrails");
    expect(area.state).toBe("live");
    expect(area.figure.value).toBe("3 of 71");
    expect(area.figure.pct).toBe(4);
  });

  it("carries the undetermined exposure count rather than folding it into 'not exposed'", () => {
    expect(byId(resolved).get("exposure").figure.unit).toContain("5 undetermined");
  });

  it("reports validated endpoints beside reachability, never instead of it", () => {
    // Reachable and validated are different findings — a Cloud Run revision open to
    // 0.0.0.0/0 whose endpoints redirect to SSO is the first and not the second — so the
    // area states both rather than collapsing them into one number.
    expect(byId(resolved).get("exposure").figure.unit).toContain("1 validated endpoint");
  });

  it("drops the undetermined clause when there is nothing undetermined", () => {
    const ctx = {
      ...FULL,
      kpis: { ...FULL.kpis, internetUnknown: 0, internetValidated: 0 },
    };
    expect(stateOf(ctx, "exposure")).toBe("live");
    const figure = byId(resolveAreas(ctx)).get("exposure").figure;
    expect(figure.value).toBe("2");
    expect(figure.unit).toBe("reachable");
  });

  it("is step-backed now, so it no longer borrows the inventory's booleans", () => {
    // The area used to declare `carriedBy: "INVENTORY_AI"` and read two flags that are null
    // on every hosted asset. It has its own two steps, which is what lets the provenance
    // panel show the documents verbatim rather than a hand-typed description of them.
    const area = byId(resolved).get("exposure");
    expect(area.carriedBy).toBeUndefined();
    expect(area.query).toContain("HOST_EXPOSURE");
    expect(area.query).toContain("ENDPOINT_EXPOSURE");
  });
});

describe("degradation — an area never claims more than its payload supports", () => {
  it("steps guardrails back to partial when the server has no protectedAgents", () => {
    const kpis = { ...FULL.kpis };
    delete kpis.protectedAgents;
    expect(stateOf({ ...FULL, kpis }, "guardrails")).toBe("partial");
  });

  it("steps exposure and CIEM back to partial on an older server bundle", () => {
    const kpis = { ...FULL.kpis };
    delete kpis.internetExposed;
    delete kpis.highPrivilege;
    const resolved = byId(resolveAreas({ ...FULL, kpis }));
    expect(resolved.get("exposure").state).toBe("partial");
    expect(resolved.get("ciem").state).toBe("partial");
  });

  it("steps DSPM back to partial on a zero, which is also what a rejected step leaves", () => {
    // The sensitive-data traversal is optional: a tenant whose schema rejects it records a
    // skip and reports nothing, which reaches the resolver as the same 0 a genuinely clean
    // estate would. Claiming `live` on that would assert a reading nobody took.
    const kpis = { ...FULL.kpis, sensitiveDatastores: 0, dataFindings: 0 };
    expect(stateOf({ ...FULL, kpis }, "dspm")).toBe("partial");
  });

  it("steps toxic combinations back to partial when the digest is missing", () => {
    expect(stateOf({ ...FULL, digest: null }, "toxic")).toBe("partial");
  });

  it("steps framework posture back to partial on an older server bundle", () => {
    const kpis = { ...FULL.kpis };
    delete kpis.frameworkPosture;
    expect(stateOf({ ...FULL, kpis }, "posture")).toBe("partial");
  });

  it("steps framework posture back to partial when nothing scored — never to 0%", () => {
    // A tenant that rejected every posture step, and one whose selected frameworks all
    // came back empty, both land here. `averagePosture: null` is the honest answer and the
    // area must not turn it into a confident zero — the exact inversion this whole
    // null-vs-zero discipline exists to prevent.
    const kpis = {
      ...FULL.kpis,
      frameworkPosture: {
        frameworks: 3, scoredFrameworks: 0, averagePosture: null,
        failingSubcategories: 0, failingPolicies: 0,
      },
    };
    expect(stateOf({ ...FULL, kpis }, "posture")).toBe("partial");
  });

  it("resolves every area to partial or unscanned when no payload arrived at all", () => {
    const empty = { boot: {}, kpis: null, total: 0, digest: null };
    for (const area of resolveAreas(empty)) {
      expect(area.figure).toBeNull();
      expect(area.state === "partial" || area.state === "unscanned").toBe(true);
    }
  });

  it("treats a resolver that throws as an area that cannot answer", () => {
    const thrower = {
      id: "boom", title: "Boom", what: "", query: "", lands: "graph",
      figure: () => { throw new Error("no such field"); },
    };
    expect(resolveArea(thrower, FULL).state).toBe("partial");
  });
});

describe("declared states — the two things no payload can tell you", () => {
  it("keeps supply chain unscanned under every payload", () => {
    for (const ctx of [FULL, { boot: {}, kpis: null, digest: null }]) {
      const area = byId(resolveAreas(ctx)).get("supply");
      expect(area.state).toBe("unscanned");
      expect(area.figure).toBeNull();
    }
  });

  it("keeps compliance partial even though its figure resolves", () => {
    const area = byId(resolveAreas(FULL)).get("compliance");
    expect(area.state).toBe("partial");
    expect(area.figure.value).toBe("23");
  });

  it("gives every declared-partial and unscanned area a note saying why", () => {
    for (const area of resolveAreas(FULL)) {
      if (area.state === "live") continue;
      expect(area.note && area.note.length).toBeTruthy();
    }
  });
});

describe("shape and ordering", () => {
  it("gives every area a stable id, a title, prose and a resolver", () => {
    const ids = new Set();
    for (const area of SCAN_AREAS) {
      expect(typeof area.id).toBe("string");
      expect(area.id).not.toBe("");
      expect(ids.has(area.id)).toBe(false);
      ids.add(area.id);
      expect(area.title).toBeTruthy();
      expect(area.what).toBeTruthy();
      expect(typeof area.figure).toBe("function");
    }
  });

  it("names a real destination, or none at all", () => {
    for (const area of SCAN_AREAS) {
      if (!area.lands) continue;
      expect(DESTINATIONS.some((d) => d.id === area.lands)).toBe(true);
    }
    expect(destinationOf({ lands: "" })).toBeNull();
    expect(destinationOf({ lands: "graph" }).title).toBe("Security Graph");
  });

  it("ranks best-informed first, then alphabetically", () => {
    const ranked = rankAreas(resolveAreas(FULL));
    const ranks = ranked.map((a) => COVERAGE[a.state].rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranked[ranked.length - 1].id).toBe("supply");

    const live = ranked.filter((a) => a.state === "live").map((a) => a.title);
    expect(live).toEqual([...live].sort((a, b) => a.localeCompare(b)));
  });

  it("gives every state a glyph and a word, so colour is never the only cue", () => {
    for (const state of COVERAGE_ORDER) {
      expect(COVERAGE[state].glyph).toBeTruthy();
      expect(COVERAGE[state].label).toBeTruthy();
    }
  });
});

describe("the fabrications are gone", () => {
  it("carries no hand-typed stat string on any area", () => {
    for (const area of SCAN_AREAS) expect(area.stat).toBeUndefined();
  });

  it("quotes no framework percentage anywhere in the content", () => {
    const prose = SCAN_AREAS.map((a) => [a.what, a.note || "", a.query].join(" ")).join(" ");
    expect(prose).not.toMatch(/\d+\s?%/);
  });

  it("says MFA is not collected rather than claiming it is scanned", () => {
    const identity = SCAN_AREAS.find((a) => a.id === "identity");
    expect(identity.note).toMatch(/not collected/i);
  });
});
