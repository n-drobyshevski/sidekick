import { renderStub } from "./_stub.js";

/** Four task tabs over one save bar. */
export function renderSettings(host) {
  renderStub(host, {
    lane: "Settings",
    title: "Settings",
    lede: "Register, deadlines, access and system — four tabs over a single save bar.",
    sections: [
      "Register: which scopes to collect (sca, sast, secrets), which severities to request, the Wiz project id.",
      "Deadlines: SLA targets by severity.",
      "Access: two tiers — the owner appoints admins, admins maintain the user list.",
      "System: credentials, schedule, deployment diagnostic.",
    ],
  });
}
