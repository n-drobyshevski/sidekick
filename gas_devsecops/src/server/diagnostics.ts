// Run from the Apps Script editor when a deployment does not behave: it answers "is this
// installation wired up", separately from "is the data right".
//
// Deliberately returns a string rather than throwing. An operator running this is already
// looking at something broken; the useful output is every check at once, not the first
// failure.

import { SCOPES } from "../domain/config";
import { getProp, hasWizCredentials, PROP_KEYS, projectScope, resolveWizAuthMode } from "./props";
import { activeJob, isStaleJob } from "./jobsStore";
import { BUILD_ID } from "./buildInfo";
import { cellCount, dataRowCount, ledgerSpreadsheet, SCHEMA_VERSION, TABS } from "./sheetsDb";
import { loadSettings } from "./settingsStore";
import { fetchPage, forgetToken, getToken, WizNotAuthorizedError } from "./wizClient";
import { setProp } from "./props";

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

/** Show enough of a secret to recognise it and not enough to use it. */
function redact(v: string | null): string {
  if (!v) return "(unset)";
  const t = v.trim();
  return t.length <= 8 ? "(set)" : `${t.slice(0, 4)}…${t.slice(-2)} (${t.length} chars)`;
}

/**
 * Exercise the real Wiz path, from the Apps Script editor, and name the step that fails.
 *
 * TWO JOBS, and the second is the one that gets an operator unstuck. It diagnoses — but
 * RUNNING IT FROM THE EDITOR IS ALSO WHAT PROVOKES THE CONSENT PROMPT. `deploymentDiagnostic()`
 * cannot do that, because it makes no network call: Apps Script asks for a scope when code
 * that needs it actually runs, so a diagnostic that only reads Script Properties authorizes
 * nothing and leaves "not authorized to call UrlFetchApp.fetch" with no way out but guesswork.
 *
 * The step numbering is the sibling's (`gas/`'s `wizDiagnostic`) and it earns its keep: the
 * three failures look identical from the app — "Test connection: Refused" — and have three
 * completely different remedies.
 *
 * Secrets are redacted. Nothing here writes to the ledger.
 */
export function wizDiagnostic(): string {
  const out: string[] = [];
  const say = (label: string, value: string) => out.push(`  ${label}: ${value}`);

  out.push("Wiz connectivity diagnostic");
  out.push(`Build ${BUILD_ID}`);
  out.push("");

  const mode = resolveWizAuthMode(
    getProp(PROP_KEYS.wizApiToken),
    getProp(PROP_KEYS.wizClientId),
    getProp(PROP_KEYS.wizClientSecret),
  );
  say("Auth mode", mode ?? "NONE — set WIZ_API_TOKEN, or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET");
  say("API url", getProp(PROP_KEYS.wizApiUrl) ?? "(unset)");
  say("Auth url", getProp(PROP_KEYS.wizAuthUrl) ?? "(unset)");
  say("Client id", redact(getProp(PROP_KEYS.wizClientId)));
  say("Client secret", redact(getProp(PROP_KEYS.wizClientSecret)));
  say("Static token", redact(getProp(PROP_KEYS.wizApiToken)));
  say("Project scope", (projectScope() ?? []).join(", ") || "(all projects)");
  out.push("");

  if (!hasWizCredentials()) {
    out.push("STOP: no usable credentials, so there is nothing to test. Set WIZ_API_URL and");
    out.push("either WIZ_API_TOKEN or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET in Project Settings.");
    return out.join("\n");
  }

  // Step 1 — the token. Cache dropped first, so this is a real exchange rather than a
  // six-hour-old answer: a cached token outlives a revoked client secret, which is exactly
  // the reassurance this function must not give.
  forgetToken();
  try {
    const token = getToken(true);
    out.push(`  Step 1 OK    token acquired (${token.length} chars)`);
  } catch (e) {
    out.push(`  Step 1 FAIL  ${String(e instanceof Error ? e.message : e).slice(0, 600)}`);
    out.push("");
    out.push(e instanceof WizNotAuthorizedError
      ? "This is the deployment's authorization, NOT the credentials. Accept the consent\n"
        + "prompt this run should have shown you, then deploy a NEW VERSION of the web app —\n"
        + "pushing code does not change what the /exec URL serves."
      : "The token endpoint refused these credentials. Check WIZ_CLIENT_ID and\n"
        + "WIZ_CLIENT_SECRET, and that WIZ_AUTH_URL matches your tenant's region.");
    return out.join("\n");
  }

  // Step 2 — one row, through the app's own query for that scope.
  try {
    const page = fetchPage("sast", { first: 1 });
    out.push(`  Step 2 OK    query answered — ${page.totalCount ?? "?"} finding(s) in scope`);
    if (page.partialErrors.length) {
      out.push(`               with partial errors: ${page.partialErrors.join("; ").slice(0, 300)}`);
    }
    setProp(PROP_KEYS.wizVerifiedAt, new Date().toISOString());
    out.push("");
    out.push("Connectivity is fine. Settings > System will now read 'Verified'.");
  } catch (e) {
    out.push(`  Step 2 FAIL  ${String(e instanceof Error ? e.message : e).slice(0, 600)}`);
    out.push("");
    out.push("The token was accepted but the query was not. A 401 here means the service");
    out.push("account cannot read this data; a 404 means WIZ_API_URL's host or path is wrong.");
  }
  return out.join("\n");
}
