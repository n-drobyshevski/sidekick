import { renderStub } from "./_stub.js";

/** Time-to-remediate, and the honest qualifiers around it. */
export function renderMttr(host) {
  renderStub(host, {
    lane: "Program",
    title: "MTTR & SLA",
    lede: "How long a finding actually lives, once you stop discarding everything still open.",
    sections: [
      "The Kaplan–Meier survival curve: closed findings are events, open findings enter as right-censored observations.",
      "Median and RMST, flagged when truncated. Where the curve never falls to half, a lower bound is published rather than an invented number.",
      "SLA by severity: share met, overdue count, and the age of what is still open at p50 and p90.",
      "Time-to-close distribution, in buckets.",
      "Two clocks for SCA: time since detection, and time since a fix became available.",
    ],
    note: "The second clock is the gap none of the three existing surfaces fills. fix_date and "
      + "fix_observed_at are written to the ledger; nothing reads them yet.",
  });
}
