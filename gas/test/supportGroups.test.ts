import { describe, expect, it } from "vitest";
import { parseSubscriptionEntity, resolveSupportGroup } from "../src/server/supportGroups";
import { isSafeTagKey, subscriptionsByTagQuery } from "../src/server/wizSubscriptionsQuery";

const TAG = "Wiz/provisioning";

describe("subscriptionsByTagQuery", () => {
  it("accepts the default tag key and inlines it", () => {
    expect(isSafeTagKey(TAG)).toBe(true);
    const q = subscriptionsByTagQuery(TAG);
    expect(q).toContain('key: "Wiz/provisioning"');
    expect(q).toContain("type: [SUBSCRIPTION]");
    expect(q).toContain("$first: Int");
  });

  it("rejects an unsafe tag key rather than injecting it", () => {
    expect(isSafeTagKey('a" }] } evil')).toBe(false);
    expect(() => subscriptionsByTagQuery('a" }] } evil')).toThrow(/Unsafe/);
  });
});

describe("parseSubscriptionEntity", () => {
  it("reads the tag from an object-shaped properties.tags", () => {
    const entity = {
      id: "wiz-id-1",
      name: "prod-sub",
      properties: {
        externalId: "123456789012",
        subscriptionId: "sub-abc",
        tags: { [TAG]: "CS-SUPPLY-MONITORING", env: "prod" },
      },
    };
    const { group, tokens } = parseSubscriptionEntity(entity, TAG);
    expect(group).toBe("CS-SUPPLY-MONITORING");
    // tokens are folded, and include every identity form for a robust join
    expect(tokens).toContain("123456789012");
    expect(tokens).toContain("sub-abc");
    expect(tokens).toContain("prod-sub");
    expect(tokens).toContain("wiz-id-1");
  });

  it("reads the tag from an array-shaped tags list", () => {
    const entity = {
      id: "x",
      properties: {
        externalId: "acct-9",
        tags: [{ key: "other", value: "n" }, { key: TAG, value: "CS-OTHER" }],
      },
    };
    const { group, tokens } = parseSubscriptionEntity(entity, TAG);
    expect(group).toBe("CS-OTHER");
    expect(tokens).toContain("acct-9");
  });

  it("reads a flat tag: property and a JSON-string properties blob", () => {
    const entity = {
      id: "y",
      properties: JSON.stringify({ externalId: "acct-flat", "tag:Wiz/provisioning": "CS-FLAT" }),
    };
    const { group } = parseSubscriptionEntity(entity, TAG);
    expect(group).toBe("CS-FLAT");
  });

  it("returns null group (no tokens) when the tag is absent", () => {
    const entity = { id: "z", properties: { externalId: "acct", tags: { env: "prod" } } };
    expect(parseSubscriptionEntity(entity, TAG)).toEqual({ group: null, tokens: [] });
  });
});

describe("resolveSupportGroup", () => {
  const map = { "123456789012": "CS-SUPPLY-MONITORING", "prod-sub": "CS-SUPPLY-MONITORING" };

  it("joins a frame record by subscription external id (case-folded)", () => {
    const rec = { "vulnerableAsset.subscriptionExternalId": "123456789012" };
    expect(resolveSupportGroup(rec, map)).toBe("CS-SUPPLY-MONITORING");
  });

  it("joins a nested frame record and a ledger row by name", () => {
    expect(resolveSupportGroup({ vulnerableAsset: { subscriptionName: "PROD-SUB" } }, map))
      .toBe("CS-SUPPLY-MONITORING");
    expect(resolveSupportGroup({ subscription_name: "prod-sub" }, map))
      .toBe("CS-SUPPLY-MONITORING");
  });

  it("returns null when no identity token hits the map", () => {
    expect(resolveSupportGroup({ subscription_ext_id: "999" }, map)).toBeNull();
    expect(resolveSupportGroup({}, map)).toBeNull();
  });
});
