// Support group → domain overrides, the client half (src/client/js/pages/_sgDomains.js): which
// groups an admin placed by hand, the domains that may be picked, and the marker's words.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SG_REASONS, assignableDomains, sgOverrideLines, sgOverrideOf,
} from "../src/client/js/pages/_sgDomains.js";
import { SG_DOMAIN_REASONS } from "../../gas_shared/domain/sgDomainOverrides.ts";

const boot = {
  filterOptions: { assignableDomains: ["CROSS", "SAP"] },
  settings: { supportGroupDomains: { version: 1, items: [
    { group: "CS-ALPHA", domain: "CROSS", reason: "cross_team", note: "", by: "a@x.com", at: "2026-09-29T00:00:00Z" },
  ] } },
};

describe("the overrides, client side", () => {
  it("knows exactly the shared reasons", () => {
    expect(Object.keys(SG_REASONS).sort()).toEqual([...SG_DOMAIN_REASONS].sort());
  });

  it("finds a group's override and offers the tagged domains", () => {
    expect(sgOverrideOf(boot, "CS-ALPHA")).toMatchObject({ domain: "CROSS" });
    expect(sgOverrideOf(boot, "CS-BETA")).toBeNull();
    expect(assignableDomains(boot)).toEqual(["CROSS", "SAP"]);
    expect(assignableDomains({})).toEqual([]);
  });

  it("speaks of repositories, not hosts", () => {
    expect(sgOverrideLines(sgOverrideOf(boot, "CS-ALPHA"))[0])
      .toBe("Managed by CROSS team: counted under CROSS by an admin, whatever its repositories are tagged.");
  });

  it("gates the Settings card's controls on the boot payload's admin tier", () => {
    const src = readFileSync(new URL("../src/client/js/pages/sgDomainsEditor.js", import.meta.url), "utf8");
    expect(src).toContain("boot.canEditAccess");
    expect(src).not.toContain("api_getAccess");
  });
});
