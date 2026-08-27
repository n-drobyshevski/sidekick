import { renderStub } from "./_stub.js";

/** The landing page: one number, its qualifiers, and what moved. */
export function renderExecutive(host) {
  renderStub(host, {
    lane: "Program",
    title: "Executive",
    lede: "How fast code risk is closing, how much is open, and which way it is going.",
    sections: [
      "Remediation half-life across the whole register — one figure read off a Kaplan–Meier curve, with the number of censored rows beside it.",
      "Open findings by severity, split across the three registers: dependencies, code, secrets.",
      "The last scan: when it ran, what it changed, and the control to run another.",
      "Movement since the previous scan — what closed, and what arrived.",
    ],
  });
}
