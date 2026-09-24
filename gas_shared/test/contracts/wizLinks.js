// Links out to Wiz (ui/wizLinks.js): the CVE page is built only from a real CVE id, and the
// finding link is Wiz's own URL through the same `safeWizUrl` gate the sheets use.

import { wizCveUrl, wizFindingUrl } from "../../ui/wizLinks.js";

export function registerWizLinksContract({ describe, it, expect }) {
  describe("wiz links", () => {
    it("builds the public CVE page from a CVE id, lowercased, and from nothing else", () => {
      expect(wizCveUrl("CVE-2024-3094")).toBe(
        ["https:", "", "www.wiz.io", "vulnerability-database", "cve", "cve-2024-3094"].join("/"));
      expect(wizCveUrl(" cve-2021-44228 ")).toMatch(/cve-2021-44228$/);
      for (const bad of ["GHSA-xxxx-yyyy-zzzz", "CVE-2024", "CVE-2024-1/../../x", "javascript:1", "", null, 42]) {
        expect(wizCveUrl(bad), String(bad)).toBe("");
      }
    });

    it("passes only a Wiz console URL through as the finding link", () => {
      const ok = ["https:", "", "app.wiz.io", "findings", "x"].join("/");
      expect(wizFindingUrl({ portal_url: ok })).toBe(ok);
      expect(wizFindingUrl({ portal_url: "javascript:alert(1)" })).toBe("");
      expect(wizFindingUrl({})).toBe("");
      expect(wizFindingUrl(null)).toBe("");
    });
  });
}
