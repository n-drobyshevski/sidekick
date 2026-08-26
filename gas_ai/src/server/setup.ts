// One-time environment setup. Idempotent: run setup() from the GAS editor after the
// first clasp push (and again after schema additions — ensureTabs appends new headers).
//
// Creates (when absent) and records in Script Properties:
//   LEDGER_SPREADSHEET_ID  — "Wiz SIDEKICK AI Ledger" spreadsheet with all tabs
//   ARCHIVE_FOLDER_ID      — "wiz-sidekick-ai" Drive folder with the archive skeleton
// and installs the daily sync trigger. Wiz credentials must be set by hand — setup()
// never touches secrets: WIZ_API_URL and either WIZ_API_TOKEN (a raw bearer token) or
// WIZ_CLIENT_ID/WIZ_CLIENT_SECRET (OAuth client-credentials).

import { ownerEmail } from "./access";
import { ensureFolders } from "./archiveStore";
import { DEFAULT_WIZ_AUTH_URL, getProp, PROP_KEYS, setProp } from "./props";
import { ensureTabs } from "./sheetsDb";

const SPREADSHEET_NAME = "Wiz SIDEKICK AI Ledger";
const FOLDER_NAME = "wiz-sidekick-ai";
const DAILY_TRIGGER_HANDLER = "trigger_dailySync";
// NOT UTC, which is what this line used to claim. `atHour` resolves in the SCRIPT's
// timezone, and dist/appsscript.json sets that to Europe/Paris — so this is 05:00 Paris.
// The hour is unchanged; only the comment was wrong.
const DAILY_TRIGGER_HOUR = 5;

// ------------------------------------------------------------------- the warm schedule
//
// WHY A TRIGGER AT ALL. CacheService's maximum TTL is six hours — a platform ceiling, not a
// choice. Tenants sync daily, so DATA_VERSION does not move for ~24h while every entry
// lapses three or four times inside that window, and each lapse is a multi-second cold load
// paid by whoever opens the app next. Re-warming on a schedule costs a few minutes of
// trigger quota a day and means nobody pays it.
const WARM_TRIGGER_HANDLER = "trigger_warmReadModels";

/**
 * The hours the warm is meant to have FINISHED by — the schedule as a person states it.
 *
 * Working hours rather than round the clock: a fire at 01:00 refreshes entries that lapse
 * again before anyone arrives, and halving the fires halves the trigger-quota draw.
 *
 * The gaps are 4h, comfortably under the six-hour ceiling they exist to stay ahead of, so
 * 09:00 through roughly 22:45 is covered end to end. The overnight gap is deliberate and
 * costs an out-of-hours visitor exactly what every visitor pays today — a cold load — so it
 * is not a regression. It is also the part a durable second-level cache would close.
 */
const WARM_READY_BY_HOURS = [9, 13, 17];

/**
 * THE FIRES ARE AN HOUR EARLIER THAN THE HOURS THEY SERVE, and that is the substance of this
 * schedule rather than a detail. `atHour(9)` does NOT run at 09:00 — GAS runs it somewhere
 * between 09:00 and 10:00 — so a trigger named for the hour it serves hands the 09:00
 * arrival exactly the cold load the warm exists to prevent. `nearMinute` narrows that
 * hour-wide window to +/-15 minutes, so atHour(8).nearMinute(30) fires between 08:15 and
 * 08:45 and a pass is done before 09:00 with margin.
 */
const WARM_TRIGGER_NEAR_MINUTE = 30;
const WARM_TRIGGER_HOURS = WARM_READY_BY_HOURS.map((h) => (h + 23) % 24);

/**
 * Pinned rather than inherited. `atHour` follows the script timezone; the manifest happens
 * to carry Europe/Paris today, and a project re-created with `clasp create` gets the CLI's
 * default — which would move the whole schedule onto another continent's working day while
 * the client kept rendering Europe/Paris.
 */
const WARM_TRIGGER_TZ = "Europe/Paris";

/**
 * The schedule this source asks for, as a string to compare against what was installed.
 *
 * A ClockTrigger exposes its handler function and NOTHING ELSE — no hour, no minute, no
 * timezone — so `getProjectTriggers()` cannot tell a correctly-scheduled trigger from one an
 * older deployment installed. Recording the answer beside the triggers is what lets an edit
 * to the hours converge on the next setup() instead of leaving a deployment on the old
 * schedule forever.
 */
export function warmScheduleSignature(): string {
  return `${WARM_TRIGGER_TZ}|${WARM_TRIGGER_HOURS.join(",")}@${WARM_TRIGGER_NEAR_MINUTE}`;
}

export function setup(): string {
  const notes: string[] = [];

  // Spreadsheet + tabs
  let ssId = getProp(PROP_KEYS.ledgerSpreadsheetId);
  let ss: GoogleAppsScript.Spreadsheet.Spreadsheet;
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
    notes.push(`spreadsheet: existing ${ssId}`);
  } else {
    ss = SpreadsheetApp.create(SPREADSHEET_NAME);
    ssId = ss.getId();
    setProp(PROP_KEYS.ledgerSpreadsheetId, ssId);
    notes.push(`spreadsheet: created ${ssId}`);
  }
  ensureTabs(ss);

  // Drive archive folder skeleton
  let folderId = getProp(PROP_KEYS.archiveFolderId);
  if (!folderId) {
    folderId = DriveApp.createFolder(FOLDER_NAME).getId();
    setProp(PROP_KEYS.archiveFolderId, folderId);
    notes.push(`archive folder: created ${folderId}`);
  } else {
    notes.push(`archive folder: existing ${folderId}`);
  }
  ensureFolders(folderId);

  // Default auth URL (tenant API URL + credentials stay manual).
  if (!getProp(PROP_KEYS.wizAuthUrl)) setProp(PROP_KEYS.wizAuthUrl, DEFAULT_WIZ_AUTH_URL);

  // Allowlist. access.ts fails closed on an unset property (owner only), which is the right
  // default but an invisible one — seed it to the owner so the guard's actual state shows up
  // in Project Settings > Script Properties instead of presenting as a mystery lockout for
  // whoever the owner asks to widen it. Never overwrite an existing value: that's how another
  // admin's additions to the list would get silently reverted on the next setup() run.
  if (!getProp(PROP_KEYS.allowedUsers)) {
    const owner = ownerEmail();
    if (owner) {
      setProp(PROP_KEYS.allowedUsers, owner);
      notes.push(`allowlist: seeded with owner ${owner}`);
    } else {
      notes.push("allowlist: not seeded (owner email unavailable)");
    }
  } else {
    notes.push("allowlist: existing (left alone)");
  }

  // Daily sync trigger (deduplicated by handler name).
  const existing = ScriptApp.getProjectTriggers().filter(
    (t) => t.getHandlerFunction() === DAILY_TRIGGER_HANDLER,
  );
  if (!existing.length) {
    ScriptApp.newTrigger(DAILY_TRIGGER_HANDLER)
      .timeBased()
      .everyDays(1)
      .atHour(DAILY_TRIGGER_HOUR)
      .create();
    notes.push(`daily trigger: installed (hour ${DAILY_TRIGGER_HOUR} Europe/Paris)`);
  } else {
    notes.push("daily trigger: already installed");
  }

  // Warm triggers: RECONCILED, not deduplicated.
  //
  // "Install when none exist" is what the daily trigger above can afford, because there is
  // one of it and its hour has never moved. It is not enough here: the warm is a SET at
  // specific hours, and since a ClockTrigger exposes nothing but its handler, an existing
  // deployment carrying one trigger on some older schedule is indistinguishable from a
  // correct installation. That check would call such a deployment done and leave it wrong
  // forever. So compare against the signature recorded last time, and rebuild the whole set
  // when the source disagrees.
  const warmExisting = ScriptApp.getProjectTriggers().filter(
    (t) => t.getHandlerFunction() === WARM_TRIGGER_HANDLER,
  );
  const wantSchedule = warmScheduleSignature();
  if (
    warmExisting.length === WARM_TRIGGER_HOURS.length &&
    getProp(PROP_KEYS.warmTriggerSchedule) === wantSchedule
  ) {
    notes.push(`warm triggers: already installed (${wantSchedule})`);
  } else {
    // Torn down whole rather than diffed: there is nothing on a Trigger to diff against.
    for (const t of warmExisting) ScriptApp.deleteTrigger(t);
    for (const hour of WARM_TRIGGER_HOURS) {
      ScriptApp.newTrigger(WARM_TRIGGER_HANDLER)
        .timeBased()
        .everyDays(1)
        .atHour(hour)
        .nearMinute(WARM_TRIGGER_NEAR_MINUTE)
        .inTimezone(WARM_TRIGGER_TZ)
        .create();
    }
    // WRITTEN LAST, on purpose. A create() that throws part-way must leave this stale so the
    // next setup() reconciles again — recording success first would strand a half-built
    // schedule as correct.
    setProp(PROP_KEYS.warmTriggerSchedule, wantSchedule);
    notes.push(
      `warm triggers: installed ${WARM_TRIGGER_HOURS.length} (${wantSchedule}), ` +
      `ready by ${WARM_READY_BY_HOURS.join(", ")} ${WARM_TRIGGER_TZ}` +
      (warmExisting.length ? ` (replaced ${warmExisting.length})` : ""),
    );
  }

  const missing = [
    PROP_KEYS.wizClientId,
    PROP_KEYS.wizClientSecret,
    PROP_KEYS.wizApiUrl,
  ].filter((k) => !getProp(k));
  if (missing.length) {
    notes.push(`NOTE: set Script Properties for live syncs: ${missing.join(", ")} ` +
      `(without them the app runs dry-run only)`);
  }
  return notes.join("\n");
}
