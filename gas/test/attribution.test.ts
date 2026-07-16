import { describe, expect, it } from "vitest";
import {
  coverage,
  ruleHealth,
  traceRecord,
  unassignedResources,
  untaggedSubscriptions,
} from "../src/domain/attribution";
import { assignDomain, compileDomains } from "../src/domain/domainRules";
import type { Rec } from "../src/domain/util";

const NAME = "vulnerableAsset.name";
const TYPE = "vulnerableAsset.type";
const SUB = "vulnerableAsset.subscriptionName";
const EXT = "vulnerableAsset.subscriptionExternalId";
const tag = (k: string) => `vulnerableAsset.tags.${k}`;

// A frame record with the server-attached fields the engine reads.
function rec(over: Rec = {}): Rec {
  return { severity: "HIGH", _sev: "HIGH", status: "OPEN", _domain: "Unassigned", ...over };
}

describe("traceRecord", () => {
  it("reports every condition of every rule without short-circuiting", () => {
    const compiled = compileDomains([
      {
        name: "ProdPay",
        rules: [
          {
            conditions: [
              { type: "tag", key: "env", value: "prod" },
              { type: "subscription", values: ["sub-pay"] },
            ],
          },
        ],
      },
    ]);
    const t = traceRecord(rec({ [tag("env")]: "prod", [SUB]: "other" }), compiled);
    expect(t.rules).toHaveLength(1);
    expect(t.rules[0]).toMatchObject({
      domainIndex: 0,
      domain: "ProdPay",
      ruleIndex: 0,
      malformed: false,
      matched: false,
    });
    // Both conditions evaluated even though the first one already decided the AND.
    expect(t.rules[0].conditions).toEqual([
      { index: 0, matched: true },
      { index: 1, matched: false },
    ]);
    expect(t.assigned).toBe("Unassigned");
  });

  it("flags a malformed rule as never-match with no conditions", () => {
    const compiled = compileDomains([
      { name: "Broken", rules: [{ conditions: [{ type: "tag" }] }] }, // missing key -> null rule
    ]);
    const t = traceRecord(rec({ [NAME]: "web-1" }), compiled);
    expect(t.rules[0]).toEqual({
      domainIndex: 0,
      domain: "Broken",
      ruleIndex: 0,
      malformed: true,
      matched: false,
      conditions: [],
    });
    expect(t.assigned).toBe("Unassigned");
  });

  it("assigned cross-checks against assignDomain across shared scenarios", () => {
    const compiled = compileDomains([
      { name: "Payments", rules: [{ conditions: [{ type: "tag", key: "env", value: "prod" }] }] },
      { name: "Core", rules: [{ conditions: [{ type: "name_regex", pattern: "^core-" }] }] },
      { name: "Subs", rules: [{ conditions: [{ type: "subscription", values: ["sub-x"] }] }] },
    ]);
    const records = [
      rec({ [tag("env")]: "prod" }), // Payments
      rec({ [NAME]: "core-7" }), // Core
      rec({ [SUB]: "sub-x" }), // Subs
      rec({ [NAME]: "nope" }), // Unassigned
      rec({ [tag("env")]: "prod", asset_name: "(compacted)" }), // compacted -> Unassigned
    ];
    for (const r of records) {
      expect(traceRecord(r, compiled).assigned).toBe(assignDomain(r, compiled));
    }
    // Sanity on the two interesting ends.
    expect(traceRecord(records[0], compiled).assigned).toBe("Payments");
    expect(traceRecord(records[4], compiled).assigned).toBe("Unassigned");
  });
});

describe("ruleHealth", () => {
  it("credits the first matching rule of the winning domain; earlier domain shadows later", () => {
    const compiled = compileDomains([
      { name: "First", rules: [{ conditions: [{ type: "tag", key: "env", value: "prod" }] }] },
      { name: "Second", rules: [{ conditions: [{ type: "tag", key: "env", value: "prod" }] }] },
    ]);
    const records = [rec({ [tag("env")]: "prod" }), rec({ [tag("env")]: "prod" })];
    const health = ruleHealth(records, compiled);
    expect(health).toEqual([
      { domainIndex: 0, domain: "First", ruleIndex: 0, fired: 2, matched: 2, status: "ok" },
      { domainIndex: 1, domain: "Second", ruleIndex: 0, fired: 0, matched: 2, status: "shadowed" },
    ]);
  });

  it("credits the earlier rule within a domain; the later matching rule is shadowed", () => {
    const compiled = compileDomains([
      {
        name: "D",
        rules: [
          { conditions: [{ type: "tag", key: "env", value: "prod" }] },
          { conditions: [{ type: "subscription", values: ["sub-a"] }] },
        ],
      },
    ]);
    // Matches both rules of D; first-match-wins credits rule 0.
    const health = ruleHealth([rec({ [tag("env")]: "prod", [SUB]: "sub-a" })], compiled);
    expect(health[0]).toMatchObject({ ruleIndex: 0, fired: 1, matched: 1, status: "ok" });
    expect(health[1]).toMatchObject({ ruleIndex: 1, fired: 0, matched: 1, status: "shadowed" });
  });

  it("marks a rule matched by nothing dead, and a malformed rule malformed", () => {
    const compiled = compileDomains([
      {
        name: "D",
        rules: [
          { conditions: [{ type: "subscription", values: ["never"] }] }, // dead
          { conditions: [{ type: "tag" }] }, // malformed -> null
        ],
      },
    ]);
    const health = ruleHealth([rec({ [SUB]: "sub-a" }), rec({ [NAME]: "x" })], compiled);
    expect(health[0]).toMatchObject({ ruleIndex: 0, fired: 0, matched: 0, status: "dead" });
    expect(health[1]).toMatchObject({ ruleIndex: 1, fired: 0, matched: 0, status: "malformed" });
  });
});

describe("coverage", () => {
  it("totals findings and distinct assets, keeps zero-count domains, Unassigned last", () => {
    const records = [
      rec({ _domain: "Payments", [NAME]: "a", _supportGroup: "SG-A" }),
      rec({ _domain: "Payments", [NAME]: "a", _supportGroup: "SG-A" }), // same asset
      rec({ _domain: "Payments", [NAME]: "b", _supportGroup: "SG-A" }),
      rec({ _domain: "Unassigned", [NAME]: "c" }), // no support group
    ];
    // Core has no records; Unassigned passed mid-list must still land last.
    const cov = coverage(records, ["Payments", "Unassigned", "Core"]);
    expect(cov.byDomain.map((d) => d.domain)).toEqual(["Payments", "Core", "Unassigned"]);
    expect(cov.byDomain[0]).toEqual({ domain: "Payments", findings: 3, assets: 2 });
    expect(cov.byDomain[1]).toEqual({ domain: "Core", findings: 0, assets: 0 });
    expect(cov.byDomain[2]).toEqual({ domain: "Unassigned", findings: 1, assets: 1 });
    expect(cov).toMatchObject({
      totalFindings: 4,
      totalAssets: 3,
      attributedFindings: 3,
      attributedAssets: 2,
      unassignedFindings: 1,
      unassignedAssets: 1,
      supportGroupResolved: 3,
      supportGroupUnresolved: 1,
    });
  });

  it("defaults a missing _domain to Unassigned", () => {
    const cov = coverage([rec({ [NAME]: "z", _domain: undefined })], ["Payments"]);
    expect(cov.unassignedFindings).toBe(1);
    expect(cov.byDomain.map((d) => d.domain)).toEqual(["Payments", "Unassigned"]);
  });
});

describe("unassignedResources", () => {
  const compiled = compileDomains([
    // matches env=prod (1) but sub fails -> 1/2
    { name: "A", rules: [{ conditions: [{ type: "tag", key: "env", value: "prod" }, { type: "subscription", values: ["sub-a"] }] }] },
    // matches env + team (2) but sub fails -> 2/3
    { name: "B", rules: [{ conditions: [{ type: "tag", key: "env", value: "prod" }, { type: "tag", key: "team", value: "pay" }, { type: "subscription", values: ["sub-a"] }] }] },
    // matches env + team (2) but sub + name fail -> 2/4
    { name: "C", rules: [{ conditions: [{ type: "tag", key: "env", value: "prod" }, { type: "tag", key: "team", value: "pay" }, { type: "subscription", values: ["sub-a"] }, { type: "name_regex", pattern: "^nope-" }] }] },
    // no condition matches -> not a near miss
    { name: "D", rules: [{ conditions: [{ type: "subscription", values: ["sub-a"] }] }] },
  ]);

  it("groups by asset, counts severities, ranks and caps near-misses", () => {
    const records = [
      rec({ _domain: "Unassigned", [NAME]: "web-1", [TYPE]: "VM", [SUB]: "other", [EXT]: "ext-1", [tag("env")]: "prod", [tag("team")]: "pay", _sev: "CRITICAL" }),
      rec({ _domain: "Unassigned", [NAME]: "web-1", [tag("env")]: "prod", [tag("team")]: "pay", _sev: "HIGH" }),
      rec({ _domain: "Unassigned", [NAME]: "web-2", _sev: "LOW" }), // fewer findings -> sorts after web-1
      rec({ _domain: "Payments", [NAME]: "skip" }), // attributed -> excluded
    ];
    const rows = unassignedResources(records, compiled);
    expect(rows.map((r) => r.asset)).toEqual(["web-1", "web-2"]);
    const web1 = rows[0];
    expect(web1).toMatchObject({
      asset: "web-1",
      assetType: "VM",
      subscription: "other",
      subscriptionExtId: "ext-1",
      supportGroup: null,
      findings: 2,
      sevCounts: { CRITICAL: 1, HIGH: 1 },
    });
    expect(web1.tags).toEqual({ env: "prod", team: "pay" });
    // B (2/3) before C (2/4) on the fewer-failing tie-break; A (1/2) last; D excluded.
    expect(web1.nearMisses).toEqual([
      { domain: "B", ruleIndex: 0, matchedConditions: 2, totalConditions: 3, failedTypes: ["subscription"] },
      { domain: "C", ruleIndex: 0, matchedConditions: 2, totalConditions: 4, failedTypes: ["subscription", "name"] },
      { domain: "A", ruleIndex: 0, matchedConditions: 1, totalConditions: 2, failedTypes: ["subscription"] },
    ]);
    // web-2 matches no condition of any rule -> no near-misses.
    expect(rows[1].nearMisses).toEqual([]);
  });

  it("caps tags at 12 keys and truncates values to 80 chars", () => {
    const over: Rec = { _domain: "Unassigned", [NAME]: "big" };
    for (let i = 0; i < 15; i++) over[tag(`k${i}`)] = `v${i}`;
    const rows = unassignedResources([rec(over)], []);
    expect(Object.keys(rows[0].tags)).toHaveLength(12);

    const longVal = "x".repeat(100);
    const rows2 = unassignedResources([rec({ _domain: "Unassigned", [NAME]: "one", [tag("big")]: longVal })], []);
    expect(rows2[0].tags.big).toHaveLength(80);
  });
});

describe("untaggedSubscriptions", () => {
  it("groups records lacking a support group by subscription name + ext id", () => {
    const records = [
      rec({ [SUB]: "sub-a", [EXT]: "ext-a", [NAME]: "h1", _sev: "HIGH" }),
      rec({ [SUB]: "sub-a", [EXT]: "ext-a", [NAME]: "h1", _sev: "LOW" }), // same asset
      rec({ [SUB]: "sub-a", [EXT]: "ext-a", [NAME]: "h2", _sev: "HIGH" }), // same sub, new asset
      rec({ [NAME]: "h3", _sev: "HIGH" }), // no subscription -> "(none)"
      rec({ [SUB]: "sub-b", [EXT]: "ext-b", [NAME]: "h4", _supportGroup: "SG-1" }), // tagged -> excluded
    ];
    const out = untaggedSubscriptions(records);
    expect(out.map((s) => s.subscription)).toEqual(["sub-a", "(none)"]);
    expect(out[0]).toEqual({
      subscription: "sub-a",
      extId: "ext-a",
      assets: 2,
      findings: 3,
      sevCounts: { HIGH: 2, LOW: 1 },
    });
    expect(out[1]).toMatchObject({ subscription: "(none)", extId: "(none)", assets: 1, findings: 1 });
  });

  it("keeps subscriptions with the same name but different ext ids separate", () => {
    const out = untaggedSubscriptions([
      rec({ [SUB]: "dup", [EXT]: "e1", [NAME]: "a" }),
      rec({ [SUB]: "dup", [EXT]: "e2", [NAME]: "b" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.extId).sort()).toEqual(["e1", "e2"]);
  });
});
