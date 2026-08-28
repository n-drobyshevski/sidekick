// Run from the Apps Script editor when a deployment does not behave: it answers "is this
// installation wired up", separately from "is the data right".
//
// Deliberately returns a string rather than throwing. An operator running this is already
// looking at something broken; the useful output is every check at once, not the first
// failure.

import { SCOPES } from "../domain/config";
import { getProp, hasWizCredentials, PROP_KEYS } from "./props";
import { activeJob, isStaleJob } from "./jobsStore";
import { BUILD_ID } from "./buildInfo";
import { cellCount, dataRowCount, ledgerSpreadsheet, SCHEMA_VERSION, TABS } from "./sheetsDb";
import { loadSettings } from "./settingsStore";

export function deploymentDiagnostic(): string {
  const out: string[] = [];
  const ok = (label: string, value: string) => out.push(`  OK    ${label}: ${value}`);
  const bad = (label: string, value: string) => out.push(`  FAIL  ${label}: ${value}`);

  out.push(`Wiz Sidekick DevSecOps — deployment diagnostic`);
  out.push(`Build ${BUILD_ID}, schema v${SCHEMA_VERSION}`);
  out.push("");

  const ssId = getProp(PROP_KEYS.ledgerSpreadsheetId);
  if (ssId) {
    try {
      const ss = ledgerSpreadsheet();
      ok("Ledger spreadsheet", `${ss.getName()} (${ssId})`);
      for (const tab of Object.values(TABS)) {
        const rows = dataRowCount(tab);
        out.push(`        ${tab}: ${rows} row${rows === 1 ? "" : "s"}`);
      }
      ok("Cells used", String(cellCount()));
    } catch (e) {
      bad("Ledger spreadsheet", `${ssId} exists as a property but could not be opened: ${e}`);
    }
  } else {
    bad("Ledger spreadsheet", "not created — run setup()");
  }

  const folderId = getProp(PROP_KEYS.archiveFolderId);
  if (folderId) ok("Archive folder", folderId);
  else bad("Archive folder", "not created — run setup()");

  if (hasWizCredentials()) ok("Wiz credentials", "present");
  else bad("Wiz credentials", "absent — set WIZ_API_TOKEN, or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET");

  const users = getProp(PROP_KEYS.allowedUsers);
  if (users) ok("Allowlist", `${users.split(/[,;\s]+/).filter(Boolean).length} address(es)`);
  else bad("Allowlist", "empty — the app is owner-only until ALLOWED_USERS is set");

  const s = loadSettings();
  ok("Scopes collected", s.scopes.join(", ") || "(none)");
  ok("Scopes available", SCOPES.join(", "));
  // Per scope, because the three registers no longer share one answer — and because a
  // diagnostic printing one list would hide exactly the defect that made this per-scope:
  // CRITICAL/HIGH on secrets deletes every PASSWORD and CERTIFICATE in the estate.
  for (const scope of SCOPES) {
    ok(`Severities requested (${scope})`, s.fetchSeverities[scope].join(", ") || "(all)");
  }

  out.push("");
  const daily = ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "trigger_dailyScan").length;
  if (daily) ok("Daily scan trigger", `installed (${daily})`);
  else bad("Daily scan trigger", "not installed — run setup()");

  const job = activeJob();
  if (job) {
    ok("Scan in flight", `${job.job_id} — ${job.phase}${job.scope ? ` (${job.scope})` : ""}`);
    out.push(`        page ${job.page}, ${job.findings_so_far} finding(s) so far`);
    if (isStaleJob(job)) {
      bad("  heartbeat", "silent for over 30 minutes — run resetStuckJob() from the editor");
    }
  } else {
    ok("Scan in flight", "none");
  }

  // Deliberately says what "present" is worth. Three non-empty Script Properties is not a
  // working integration, and this diagnostic is read by someone trying to find out why one
  // is not working.
  const verified = getProp(PROP_KEYS.wizVerifiedAt);
  if (verified) ok("Credentials last verified", verified);
  else bad("Credentials last verified", "never — the tenant has not accepted them yet");

  return out.join("\n");
}
