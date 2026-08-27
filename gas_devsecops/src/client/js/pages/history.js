import { renderStub } from "./_stub.js";

/** What was actually measured, when. */
export function renderHistory(host) {
  renderStub(host, {
    lane: "Data",
    title: "Scan history",
    lede: "What was actually measured and when, and how the register moved between measurements.",
    sections: [
      "The scan log: id, timestamp, severities covered, and counts of new, resolved and reopened.",
      "Remediation trend across the saved scans.",
      "The first row dates the observation window, which is what lets capacity flag reconstructed months.",
    ],
    note: "The scan log is load-bearing: it makes a re-run of one scan a no-op, and it stops a "
      + "severity that simply was not requested from being resolved by disappearance.",
  });
}
