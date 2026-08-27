import { renderStub } from "./_stub.js";

/** First-party code: a weakness class at a file and a line. */
export function renderSast(host) {
  renderStub(host, {
    lane: "Registers",
    title: "Code",
    lede: "Weaknesses in our own source: the class, the file, and the line.",
    sections: [
      "The register: rule and CWE, file path and line, language, scanner of origin.",
      "CWE Top-25 hit rate — allowing for the classes that only reach the list through a parent.",
      "The triage funnel: how many findings reached a decision at all.",
      "Breakdown by repository and by owning team.",
    ],
    note: "SAST findings carry a creation date but no resolution date, and this tenant "
      + "returns no resolved SAST findings at all. So the clock starts when the finding was "
      + "created and stops at the scan that first stopped seeing it — a real measurement on "
      + "one end and an estimate bounded by the scan interval on the other. The page states "
      + "which is which rather than averaging them into one confident number.",
  });
}
