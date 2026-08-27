import { renderStub } from "./_stub.js";

/** Third-party dependencies: a CVE in a package at a version. */
export function renderSca(host) {
  renderStub(host, {
    lane: "Registers",
    title: "Dependencies",
    lede: "Known vulnerabilities in third-party packages — and whether there is anything to upgrade to.",
    sections: [
      "The register: CVE, package and version, fixed version, ecosystem.",
      "Fix availability: how many rows are waiting on a vendor rather than on a team.",
      "Exploitation signals — KEV, known exploit, EPSS — in three states: measured, unmeasured, not applicable.",
      "Breakdown by language and by repository.",
    ],
    note: "Absent is never zero: in roughly one sample row in eight, hasExploit, "
      + "hasCisaKevExploit and epssProbability arrive as null, and collapsing that to false "
      + "is what makes an unassessed finding look clean.",
  });
}
