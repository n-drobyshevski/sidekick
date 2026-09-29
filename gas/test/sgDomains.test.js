// Support group → domain overrides, the client half (src/client/js/pages/_sgDomains.js): which
// groups an admin placed by hand, the domains that may be picked, and the marker's words.
import { describe, expect, it } from "vitest";

import {
  SG_REASONS, assignableDomains, sgOverrideLines, sgOverrideOf,
} from "../src/client/js/pages/_sgDomains.js";
import { SG_DOMAIN_REASONS } from "../src/domain/settingsLogic.ts";

const boot = {
  domainNames: ["CROSS", "RETAIL", "Payments", "Unassigned", "Not attributable"],
  settings: { supportGroupDomains: { version: 2, items: [
    { group: "CS-SANDBOX", domain: "CROSS", reason: "cross_team", note: "run by CROSS", by: "a@x.com", at: "2026-09-29T10:00:00Z" },
    { group: "CS-INIX", domain: "SAP", reason: "wrong_tag", note: "", by: "", at: "" },
  ] } },
};

describe("the overrides", () => {
  it("finds a group's override, and none for a group without one", () => {
    expect(sgOverrideOf(boot, "CS-SANDBOX")).toMatchObject({ domain: "CROSS", reason: "cross_team" });
    expect(sgOverrideOf(boot, "CS-ENMS")).toBeNull();
    expect(sgOverrideOf({}, "CS-SANDBOX")).toBeNull();
  });

  it("never offers the two tails as a domain to set", () => {
    expect(assignableDomains(boot)).toEqual(["CROSS", "RETAIL", "Payments"]);
  });

  it("knows exactly the server's reasons", () => {
    expect(Object.keys(SG_REASONS).sort()).toEqual([...SG_DOMAIN_REASONS].sort());
  });

  it("marks the CROSS team's groups by name, and a correction as set by hand", () => {
    expect(SG_REASONS.cross_team.badge).toBe("Managed by CROSS team");
    expect(SG_REASONS.wrong_tag.badge).toBe("Domain set manually");
  });

  it("says where it counts, the note, and who set it when", () => {
    expect(sgOverrideLines(sgOverrideOf(boot, "CS-SANDBOX"))).toEqual([
      "Managed by CROSS team: counted under CROSS by an admin, whatever its hosts are tagged.",
      "Note: run by CROSS",
      "Set by a@x.com, 2026-09-29.",
    ]);
    expect(sgOverrideLines(sgOverrideOf(boot, "CS-INIX"))).toEqual([
      "Domain set manually: counted under SAP by an admin, whatever its hosts are tagged.",
    ]);
    expect(sgOverrideLines(null)).toEqual([]);
  });
});
