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
    note: "SAST findings in this tenant carry NO timestamps — not detection, not resolution. "
      + "So MTTR here is dated from observation, and this page has to say so on its face: "
      + "\"no MTTR yet\" is a state you can act on; \"MTTR is 0 days\" is a confident lie.",
  });
}
