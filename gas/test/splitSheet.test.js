// The MTTR split's row sheet — the requests a row opens with, and the words round them
// (`src/client/js/pages/_splitSheet.js`). The server half — that those requests land on exactly
// the row's population — is `mttrGroupSheet.test.ts`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  NONE_GROUP, NOT_ATTRIBUTABLE, SPLIT_NONE, UNASSIGNED, splitBucketNote, splitCountNote,
  splitGroupOf, splitRowLabel, splitSheetColumnKeys, splitSheetDefaults, splitSheetRequests,
  splitSheetSortFor, splitSheetSubtitle, domainSourceLabel, splitDomainAssetsText,
  splitDomainsLead, splitDomainsRows,
} from "../src/client/js/pages/_splitSheet.js";
import { NONE_GROUP as SHARED_NONE_GROUP } from "../../gas_shared/domain/rowGroups.ts";
import { UNASSIGNED as RULES_UNASSIGNED } from "../src/domain/domainRules.ts";
import { NOT_ATTRIBUTABLE as RESOLVE_NOT_ATTRIBUTABLE } from "../src/domain/resolveDomain.ts";

describe("the copied constants match their sources", () => {
  it("NONE_GROUP is the register's own key for a missing value", () => {
    expect(NONE_GROUP).toBe(SHARED_NONE_GROUP);
  });

  it("the two domain tails are the resolver's own names", () => {
    expect(UNASSIGNED).toBe(RULES_UNASSIGNED);
    expect(NOT_ATTRIBUTABLE).toBe(RESOLVE_NOT_ATTRIBUTABLE);
  });

  it("SPLIT_NONE is the split's own (none) bucket", () => {
    const api = readFileSync(new URL("../src/server/api.ts", import.meta.url), "utf8");
    expect(api).toContain(`const NONE_BUCKET = "${SPLIT_NONE}";`);
  });
});

describe("splitSheetRequests", () => {
  it("a domain row, unscoped: the domain as a register group", () => {
    const req = splitSheetRequests("domain", { group: "Payments" }, { domain: "", supportGroup: "" }, null);
    expect(req.mttr).toEqual({
      domain: "", supportGroup: "", severities: null, groupBy: "domain", groupValue: "Payments",
    });
    expect(req.register).toEqual({
      domain: "", supportGroup: "", severities: null, groupBy: "domain", groupValue: "Payments",
    });
  });

  // THE REQUIREMENT: under a domain scope a support group is that group's findings IN that
  // domain — the domain rides on both requests, never the group alone.
  it("a support-group row keeps the domain it was drawn inside", () => {
    const req = splitSheetRequests("supportGroup", { group: "Platform SRE" },
      { domain: "Payments", supportGroup: "" }, null);
    expect(req.mttr).toMatchObject({ domain: "Payments", groupBy: "supportGroup", groupValue: "Platform SRE" });
    expect(req.register).toMatchObject({
      domain: "Payments", supportGroup: "", groupBy: "support_group", groupValue: "Platform SRE",
    });
  });

  it("an asset row keeps the support group it was drawn inside", () => {
    const req = splitSheetRequests("asset", { group: "host-01" },
      { domain: "", supportGroup: "Platform SRE" }, null);
    expect(req.mttr).toMatchObject({ supportGroup: "Platform SRE", groupBy: "asset", groupValue: "host-01" });
    expect(req.register).toMatchObject({
      supportGroup: "Platform SRE", groupBy: "asset_name", groupValue: "host-01",
    });
  });

  it("maps (none) to NONE_GROUP for the register only, and only where (none) is a bucket", () => {
    for (const dim of ["supportGroup", "asset"]) {
      const req = splitSheetRequests(dim, { group: SPLIT_NONE }, { domain: "D", supportGroup: "" }, null);
      expect(req.mttr.groupValue).toBe(SPLIT_NONE);
      expect(req.register.groupValue).toBe(NONE_GROUP);
    }
    const domainRow = splitSheetRequests("domain", { group: SPLIT_NONE }, {}, null);
    expect(domainRow.register.groupValue).toBe(SPLIT_NONE);
  });

  it("passes Unassigned and Not attributable through verbatim", () => {
    for (const g of [UNASSIGNED, NOT_ATTRIBUTABLE]) {
      expect(splitSheetRequests("domain", { group: g }, {}, null).register.groupValue).toBe(g);
    }
  });

  it("carries the page's severity scope on both", () => {
    const req = splitSheetRequests("domain", { group: "X" }, {}, ["CRITICAL", "HIGH"]);
    expect(req.mttr.severities).toEqual(["CRITICAL", "HIGH"]);
    expect(req.register.severities).toEqual(["CRITICAL", "HIGH"]);
  });

  it("reads the older payload's `domain` label when `group` is absent", () => {
    expect(splitGroupOf({ domain: "Legacy" })).toBe("Legacy");
    expect(splitSheetRequests("domain", { domain: "Legacy" }, {}, null).mttr.groupValue).toBe("Legacy");
  });
});

describe("the findings list's defaults", () => {
  it("opens on the open backlog, oldest first", () => {
    expect(splitSheetDefaults({ open: 4, resolved: 2 }))
      .toEqual({ status: "open", sort: "age_days", dir: "desc" });
  });

  // Not attributable is resolved history by construction — an open list would be empty by
  // definition.
  it("opens on Resolved, slowest fix first, when nothing is open", () => {
    expect(splitSheetDefaults({ open: 0, resolved: 7 }))
      .toEqual({ status: "resolved", sort: "mttr_days", dir: "desc" });
  });

  it("lands each status on its own clock", () => {
    expect(splitSheetSortFor("resolved").sort).toBe("mttr_days");
    expect(splitSheetSortFor("open").sort).toBe("age_days");
    expect(splitSheetSortFor("all").sort).toBe("age_days");
  });

  it("drops the column that restates the row, and follows the status with its clocks", () => {
    expect(splitSheetColumnKeys("supportGroup", "open")).not.toContain("support_group");
    expect(splitSheetColumnKeys("asset", "open")).not.toContain("asset_name");
    expect(splitSheetColumnKeys("domain", "open")).toContain("support_group");
    expect(splitSheetColumnKeys("domain", "open")).toEqual(expect.arrayContaining(["first_seen", "age_days"]));
    expect(splitSheetColumnKeys("domain", "open")).not.toContain("mttr_days");
    expect(splitSheetColumnKeys("domain", "resolved")).toEqual(expect.arrayContaining(["resolved_at", "mttr_days"]));
  });
});

describe("the words", () => {
  it("names the row button for a screen reader", () => {
    expect(splitRowLabel("supportGroup", { group: "Platform SRE" }))
      .toBe("Platform SRE, support group, open remediation and findings");
  });

  it("puts the enclosing scope in the subtitle", () => {
    expect(splitSheetSubtitle("supportGroup", { domain: "Payments" }, null))
      .toBe("Support group · its findings in domain Payments");
    expect(splitSheetSubtitle("asset", { supportGroup: "Platform SRE" }, ["CRITICAL"]))
      .toBe("Asset · in support group Platform SRE · CRITICAL only");
    expect(splitSheetSubtitle("domain", {}, null)).toBe("Domain");
  });

  it("explains the buckets that are not an owner, and only those", () => {
    expect(splitBucketNote("domain", UNASSIGNED)).toMatch(/attribution gap/);
    expect(splitBucketNote("domain", NOT_ATTRIBUTABLE)).toMatch(/opens on Resolved/);
    expect(splitBucketNote("supportGroup", SPLIT_NONE)).toMatch(/no support group/);
    expect(splitBucketNote("asset", SPLIT_NONE)).toMatch(/no name/);
    expect(splitBucketNote("domain", "Payments")).toBeNull();
  });

  it("says so when the open list disagrees with its row, and is silent when it agrees", () => {
    expect(splitCountNote({ open: 3 }, 3, "open")).toBeNull();
    expect(splitCountNote({ open: 3 }, 2, "resolved")).toBeNull();
    expect(splitCountNote({ open: 3 }, 2, "open")).toMatch(/counts 3 open.*lists 2/);
  });
});

describe("the Domains section", () => {
  it("names each route by where its fix lives", () => {
    expect(domainSourceLabel("tag")).toBe("Wiz/Domain tag");
    expect(domainSourceLabel("rule")).toBe("manual rule");
    expect(domainSourceLabel("none")).toBe("no tag or rule matched");
    expect(domainSourceLabel("missing")).toBe("no attribution input");
  });

  it("explains a spread, and states a single domain plainly", () => {
    const two = [{ domain: "CROSS" }, { domain: "RETAIL" }, { domain: "CROSS" }];
    expect(splitDomainsLead("supportGroup", "CS-SANDBOX", two))
      .toMatch(/^CS-SANDBOX's findings resolve to 2 domains\. A support group has no domain of its own/);
    expect(splitDomainsLead("asset", "web-01", two)).toMatch(/An asset has no domain/);
    expect(splitDomainsLead("supportGroup", "CS-SANDBOX", [{ domain: "CROSS" }]))
      .toBe("All of CS-SANDBOX's findings resolve to CROSS.");
    expect(splitDomainsLead("supportGroup", "X", [])).toBeNull();
  });

  it("marks the header's domain, and only when one is picked", () => {
    const rows = splitDomainsRows([{ domain: "CROSS", source: "tag" }, { domain: "RETAIL", source: "rule" }], "CROSS");
    expect(rows.map((r) => [r.domain, r.current, r.sourceLabel]))
      .toEqual([["CROSS", true, "Wiz/Domain tag"], ["RETAIL", false, "manual rule"]]);
    expect(splitDomainsRows([{ domain: "CROSS" }], "").every((r) => !r.current)).toBe(true);
  });

  it("lists the shipped assets and counts the rest", () => {
    expect(splitDomainAssetsText({ assets: ["a", "b"], assetCount: 2 })).toBe("a, b");
    expect(splitDomainAssetsText({ assets: ["a", "b"], assetCount: 7 })).toBe("a, b +5 more");
  });
});
