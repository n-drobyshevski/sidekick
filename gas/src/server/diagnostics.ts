// Run by hand from the Apps Script editor; nothing here is called during a normal scan.
//
// `wizDiagnostic` is the one-shot Wiz connectivity check. It exercises the SAME getToken +
// queryPage the scan uses — so it validates the real path — and prints a secret-safe report of
// exactly which step fails and why.
//
// `deploymentDiagnostic` answers "is this installation wired up", separately from "is the data
// right": the ledger and archive, the allowlist, and every trigger setup() and the jobs install,
// counted by the handler names those modules export. It makes no network call.
//
// Both return a string rather than throwing: an operator running one is already looking at
// something broken, and the useful output is every check at once, not the first failure.

import {
  DEFAULT_WIZ_AUTH_URL,
  getProp,
  PROP_KEYS,
  resolveWizAuthMode,
} from "./props";
import { buildVariables, getToken, queryPage } from "./wizClient";
import { normalizeWizUrl } from "../../../gas_shared/domain/wizUrl";
import { hasWizCredentials } from "./props";
import { activeJob, CONTINUE_HANDLERS, isStaleJob } from "./jobsStore";
import { WARM_CONTINUE_HANDLER } from "./api";
import {
  DAILY_TRIGGER_HANDLER,
  dailyScanSchedule,
  WARM_TRIGGER_COUNT,
  WARM_TRIGGER_HANDLER,
  warmScheduleSignature,
} from "./setup";
import { BUILD_ID } from "./serverCache";
import { cellCount, dataRowCount, ledgerSpreadsheet, SCHEMA_VERSION, TABS } from "./sheetsDb";

/** Length + first4…last4 preview of a non-secret id/token — never the whole value. */
function preview(value: string | null): string {
  if (!value || !value.trim()) return "(unset)";
  const v = value.trim();
  if (v.length <= 10) return `${v.length} chars`;
  return `${v.length} chars, ${v.slice(0, 4)}…${v.slice(-4)}`;
}

/** Secrets get only a presence + length signal — never any character of the value. */
function secretPreview(value: string | null): string {
  return value && value.trim() ? `(set, ${value.trim().length} chars)` : "(unset)";
}

/**
 * Validate the Wiz auth + query path and return a human-readable report (also logged
 * line-by-line to the execution log). Safe to run anytime; makes at most one token
 * request and one 1-row query. Never prints the client secret or a full token.
 */
export function wizDiagnostic(): string {
  const lines: string[] = [];
  const log = (m: string) => {
    lines.push(m);
    console.log(m);
  };

  const apiUrl = getProp(PROP_KEYS.wizApiUrl);
  const authUrl = getProp(PROP_KEYS.wizAuthUrl) ?? DEFAULT_WIZ_AUTH_URL;
  const token = getProp(PROP_KEYS.wizApiToken);
  const clientId = getProp(PROP_KEYS.wizClientId);
  const clientSecret = getProp(PROP_KEYS.wizClientSecret);
  const projectId = getProp(PROP_KEYS.wizProjectIdV2);
  const mode = resolveWizAuthMode(token, clientId, clientSecret);

  log("=== Wiz diagnostic ===");
  log(`WIZ_API_URL:        ${apiUrl || "(unset!)"}`);
  log(`Auth mode:          ${mode ?? "(none)"}`);
  log(`WIZ_API_TOKEN:      ${preview(token)}`);
  log(`WIZ_CLIENT_ID:      ${preview(clientId)}`);
  log(`WIZ_CLIENT_SECRET:  ${secretPreview(clientSecret)}`);
  if (mode === "oauth") log(`WIZ_AUTH_URL:       ${authUrl}`);
  log(`WIZ_PROJECT_ID_V2:  ${projectId || "(unset — querying all projects)"}`);

  if (!apiUrl) {
    log("FAIL: WIZ_API_URL is required, e.g. https://api.<region>.app.wiz.io/graphql.");
    return lines.join("\n");
  }
  if (mode === null) {
    log(
      "FAIL: no usable credentials — the app runs in dry-run mode. Set WIZ_API_TOKEN, " +
        "or WIZ_CLIENT_ID + WIZ_CLIENT_SECRET.",
    );
    return lines.join("\n");
  }

  // Step 1 — obtain a bearer token (raw token verbatim, or a fresh OAuth exchange).
  let bearer = "";
  try {
    bearer = getToken(true);
    log(
      mode === "token"
        ? `Step 1 OK: using raw WIZ_API_TOKEN (${preview(bearer)}).`
        : `Step 1 OK: OAuth exchange minted an access token (${preview(bearer)}).`,
    );
  } catch (e) {
    log(`Step 1 FAIL: could not obtain a token — ${(e as Error).message}`);
    log(
      mode === "oauth"
        ? "→ The token endpoint rejected the client credentials. Verify WIZ_CLIENT_ID / " +
            "WIZ_CLIENT_SECRET (regenerate the service account in Wiz), and that " +
            "WIZ_AUTH_URL matches the auth host shown on the service-account page."
        : "→ WIZ_API_TOKEN is unusable. A Wiz GraphQL service account gives a client " +
            "id + secret, not a durable token; use WIZ_CLIENT_ID / WIZ_CLIENT_SECRET.",
    );
    return lines.join("\n");
  }

  // Step 2 — a minimal 1-row query, exercising the real request path.
  let firstNode: Record<string, unknown> | null = null;
  try {
    const page = queryPage(buildVariables({ first: 1 }));
    firstNode = (page.nodes[0] as Record<string, unknown> | undefined) ?? null;
    log(`Step 2 OK: query succeeded — ${page.nodes.length} finding(s) on page 1.`);
  } catch (e) {
    const msg = (e as Error).message;
    log(`Step 2 FAIL: the query was rejected — ${msg}`);
    if (/HTTP 401|HTTP 403|Unauthorized/i.test(msg)) {
      log(
        "→ 401/403/Unauthorized: the token was not accepted (expired, invalid, or minted " +
          "for a different tenant). Confirm the service account targets this tenant.",
      );
    } else if (/HTTP 404/i.test(msg)) {
      log(
        "→ 404: WIZ_API_URL host/path is wrong — it must be " +
          "https://api.<region>.app.wiz.io/graphql for your tenant's region.",
      );
    } else {
      log(
        "→ If the body names a field (e.g. \"Cannot query field\"), the service account " +
          "lacks permission for it or the tenant schema differs.",
      );
    }
    return lines.join("\n");
  }

  // Step 3 — does this tenant actually hand back a console link for a finding?
  //
  // COSTS NOTHING EXTRA, and that is the design rather than a saving: the real query already
  // selects `portalUrl` (os_vulns.py's VulnerabilityFindingFragment), so the row step 2 just
  // fetched either carries one or does not. A second, probe-only query would be asking a
  // different question than the scan asks, which is the failure mode this whole module
  // exists to avoid.
  //
  // THE THREE ANSWERS ARE DIFFERENT PROBLEMS and are named apart, because "no link in the
  // register" is reached by all three and a reader who cannot tell them apart will go looking
  // in the wrong place:
  //   - the field is not in the schema     → step 2 already failed, with "Cannot query field"
  //   - the field is there but null        → Wiz has no link for this finding; nothing to fix
  //   - the field is there but we refuse it → our prefix rule and the tenant disagree
  if (firstNode === null) {
    log(
      "Step 3 SKIPPED: the query returned no findings, so there was no row to read a Wiz " +
        "console link off. Not a failure — widen the severity filter or the project and " +
        "re-run if you want this checked.",
    );
  } else {
    const raw = firstNode["portalUrl"];
    const usable = normalizeWizUrl(raw);
    if (usable) {
      log(`Step 3 OK: findings carry a Wiz console link (${usable}).`);
    } else if (typeof raw === "string" && raw.trim()) {
      log(
        `Step 3 WARN: this tenant returned a portalUrl the register will not link to — ` +
          `${raw.trim()}`,
      );
      log(
        "→ The finding sheet shows no Wiz row for it. Links are allowed only on the Wiz " +
          "consoles (app.wiz.io / app.wiz.us); see gas_shared/domain/wizUrl.ts for why the " +
          "list is a security boundary rather than a typo-catcher, and widen it there if " +
          "your tenant is genuinely served from another host.",
      );
    } else {
      log("Step 3 WARN: the query worked but this finding carried no portalUrl.");
      log(
        "→ The finding sheet will show no Wiz row for findings like it. If EVERY finding " +
          "is like this, the tenant is not populating the field and there is nothing to " +
          "link to; the register states that rather than guessing a URL.",
      );
    }
  }

  log("=== All checks passed. Live scans should work. ===");
  return lines.join("\n");
}

/** Apps Script's cap on triggers per project (installable, all kinds). */
export const TRIGGER_CAP = 20;
/**
 * What one in-flight job holds at once: its next hop. A scan's watchdog shares
 * `trigger_continueScan` with its hops and is armed only once the walk has stopped scheduling
 * them, and the post-scan warm's one-shot is armed after the watchdog is cleared — so neither
 * needs a slot of its own.
 */
const JOB_TRIGGER_SLOTS = 1;

/**
 * Is this deployment wired up? Run from the Apps Script editor after a deploy or a setup().
 *
 * BOTH ENDS OF THE REPORT ARE KEPT. The Apps Script editor does NOT display a function's return
 * value — the Execution log shows logged output and nothing else — so each line is logged as it
 * is built (an editor run that only returned the report would print nothing at all), and the
 * whole text is returned for a caller or a test.
 *
 * THE TRIGGER CHECKS COUNT BY THE NAMES THE INSTALLERS EXPORT (setup.ts, jobsStore.ts, api.ts),
 * never by literals typed here: gas_devsecops's copy once checked a handler nothing installed
 * and reported FAIL on every healthy deployment, which teaches operators to ignore the line.
 */
export function deploymentDiagnostic(): string {
  const lines: string[] = [];
  const line = (m: string) => {
    lines.push(m);
    console.log(m);
  };
  const ok = (label: string, value: string) => line(`  OK    ${label}: ${value}`);
  const bad = (label: string, value: string) => line(`  FAIL  ${label}: ${value}`);

  line("Wiz Sidekick OS — deployment diagnostic");
  line(`Build ${BUILD_ID}, schema v${SCHEMA_VERSION}`);
  line("");

  const ssId = getProp(PROP_KEYS.ledgerSpreadsheetId);
  if (ssId) {
    try {
      const ss = ledgerSpreadsheet();
      ok("Ledger spreadsheet", `${ss.getName()} (${ssId})`);
      for (const tab of Object.values(TABS)) {
        const rows = dataRowCount(tab);
        line(`        ${tab}: ${rows} row${rows === 1 ? "" : "s"}`);
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

  if (hasWizCredentials()) ok("Wiz credentials", "present (run wizDiagnostic() to test them)");
  else bad("Wiz credentials", "absent — the app runs dry-run only; set WIZ_API_URL and "
    + "WIZ_CLIENT_ID + WIZ_CLIENT_SECRET (or WIZ_API_TOKEN)");

  const users = getProp(PROP_KEYS.allowedUsers);
  if (users) ok("Allowlist", `${users.split(/[,;\s]+/).filter(Boolean).length} address(es)`);
  else bad("Allowlist", "empty — the app is owner-only until ALLOWED_USERS is set");

  line("");
  let handlers: string[] = [];
  try {
    handlers = ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction());
  } catch (e) {
    bad("Triggers", `could not be listed: ${e}`);
    return lines.join("\n");
  }
  const count = (names: ReadonlyArray<string | undefined>) =>
    handlers.filter((h) => names.includes(h)).length;

  // Count AND signature, the two things setup() reconciles on: one trigger installed before the
  // timezone was pinned passes a count check and still fires at the script's idea of 05:00.
  const daily = count([DAILY_TRIGGER_HANDLER]);
  const dailySig = getProp(PROP_KEYS.dailyTriggerSchedule);
  if (daily > 1) {
    bad("Daily scan trigger", `${daily} installed, expected 1 — the scan runs ${daily}x a day; run setup()`);
  } else if (!daily) {
    bad("Daily scan trigger", "not installed — run setup()");
  } else if (dailySig !== dailyScanSchedule()) {
    bad("Daily scan trigger", `schedule ${dailySig ?? "(unrecorded)"} is not this build's `
      + `${dailyScanSchedule()} — run setup() as the deploying account`);
  } else {
    ok("Daily scan trigger", `installed (${dailySig})`);
  }

  const warm = count([WARM_TRIGGER_HANDLER]);
  const warmSig = getProp(PROP_KEYS.warmTriggerSchedule);
  if (warm !== WARM_TRIGGER_COUNT) {
    bad("Warm triggers", `${warm} installed, expected ${WARM_TRIGGER_COUNT} — run setup()`);
  } else if (warmSig !== warmScheduleSignature()) {
    bad("Warm triggers", `schedule ${warmSig ?? "(unrecorded)"} is not this build's `
      + `${warmScheduleSignature()} — run setup()`);
  } else {
    ok("Warm triggers", `${warm} installed (${warmSig})`);
  }

  // The one-shots, by handler. A job's continuation left over with no job in flight is harmless
  // — it clears itself when it fires and finds no job — but it holds quota until then. The
  // warm's one-shot is pending with no job in flight BY DESIGN (armed after a scan's DONE, fired
  // a second later, or the next hop of a pass out of budget), so it never reads as stray.
  const job = activeJob();
  const pending: string[] = [];
  let stray = 0;
  for (const [kind, handler] of Object.entries(CONTINUE_HANDLERS)) {
    const n = count([handler]);
    if (!n) continue;
    // A scan's watchdog is armed under its continuation handler — named so a reader of a
    // PERSISTING scan knows what the one pending trigger is.
    const what = kind === "scan" ? "scan hop / watchdog" : `${kind} hop`;
    pending.push(`${n} ${what}`);
    if (!job || job.kind !== kind) stray += n;
  }
  const warmOneShots = count([WARM_CONTINUE_HANDLER]);
  if (warmOneShots) pending.push(`${warmOneShots} warm`);
  if (warmOneShots > 1) {
    bad("Pending one-shots", `${pending.join(", ")} — more than one warm one-shot pending; `
      + "each arming should clear the last");
  } else {
    ok("Pending one-shots", (pending.join(", ") || "none")
      + (stray ? ` (${stray} with no matching job in flight — each clears itself when it fires)` : ""));
  }

  const queued = getProp(PROP_KEYS.supportGroupRefreshPending);
  ok("Queued support-group refresh", queued ? `since ${queued} (runs at the next warm hop)` : "none");

  // Apps Script's per-project cap. With no slot free, a job that outruns one execution cannot
  // arm its next hop.
  const free = TRIGGER_CAP - handlers.length;
  if (free >= (job ? 0 : JOB_TRIGGER_SLOTS)) ok("Triggers used", `${handlers.length} of ${TRIGGER_CAP}`);
  else bad("Triggers used", `${handlers.length} of ${TRIGGER_CAP} — no room for a job's next hop; `
    + "delete stray triggers in the editor's Triggers panel");

  if (job) {
    ok("Job in flight", `${job.kind} ${job.job_id} — ${job.phase}`);
    line(`        page ${job.page}, ${job.findings_so_far} finding(s) so far`);
    if (isStaleJob(job)) {
      bad("  heartbeat", "silent for over 30 minutes — run resetStuckJob() from the editor");
    }
  } else {
    ok("Job in flight", "none");
  }

  return lines.join("\n");
}
