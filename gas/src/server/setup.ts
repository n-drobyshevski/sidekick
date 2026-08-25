// One-time environment setup. Idempotent: run setup() from the GAS editor after the
// first clasp push (and again after schema additions — ensureTabs appends new headers).
//
// Creates (when absent) and records in Script Properties:
//   LEDGER_SPREADSHEET_ID  — "Wiz Sidekick OS Ledger" spreadsheet with all tabs
//   ARCHIVE_FOLDER_ID      — "wiz-sidekick" Drive folder with the archive skeleton
// and installs the daily scan trigger. Wiz credentials must be set by hand — setup()
// never touches secrets: WIZ_API_URL, WIZ_PROJECT_ID_V2, and either WIZ_API_TOKEN (a
// raw bearer token) or WIZ_CLIENT_ID/WIZ_CLIENT_SECRET (OAuth client-credentials).

import { ensureFolders } from "./archiveStore";
import { DEFAULT_WIZ_AUTH_URL, getProp, PROP_KEYS, setProp } from "./props";
import { ensureTabs } from "./sheetsDb";

const SPREADSHEET_NAME = "Wiz Sidekick OS Ledger";
const FOLDER_NAME = "wiz-sidekick";
const DAILY_TRIGGER_HANDLER = "trigger_dailyScan";
const DAILY_TRIGGER_HOUR = 5; // UTC
const WARM_TRIGGER_HANDLER = "trigger_warmReadModels";
const WARM_TRIGGER_HOURS = 4;

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

  // Daily scan trigger (deduplicated by handler name).
  const existing = ScriptApp.getProjectTriggers().filter(
    (t) => t.getHandlerFunction() === DAILY_TRIGGER_HANDLER,
  );
  if (!existing.length) {
    ScriptApp.newTrigger(DAILY_TRIGGER_HANDLER)
      .timeBased()
      .everyDays(1)
      .atHour(DAILY_TRIGGER_HOUR)
      .create();
    notes.push(`daily trigger: installed (hour ${DAILY_TRIGGER_HOUR} UTC)`);
  } else {
    notes.push("daily trigger: already installed");
  }

  // Read-model warm trigger, deduplicated by handler name exactly like the daily scan above.
  //
  // FOUR HOURS IS SET BY QUOTA, not by taste. Trigger runtime is capped at 90 min/day on a
  // consumer account (6h on Workspace) and the daily scan's continuation hops already draw on
  // it; at roughly a minute per pass, six fires a day is single-digit minutes while hourly
  // would be a quarter of the consumer budget. It also sits comfortably under the six-hour
  // CacheService ceiling it exists to stay ahead of, with room for the scheduling jitter a
  // time-based trigger has (GAS fires within a window, not on the minute).
  //
  // It cannot keep the 1h entries warm and does not try: `everyMinutes` accepts only
  // 1/5/10/15/30, so chasing them would cost several times the quota for a fraction more
  // coverage. Those stay warm for an hour after each fire and cold otherwise, which is what
  // their TTL already meant.
  const warmExisting = ScriptApp.getProjectTriggers().filter(
    (t) => t.getHandlerFunction() === WARM_TRIGGER_HANDLER,
  );
  if (!warmExisting.length) {
    ScriptApp.newTrigger(WARM_TRIGGER_HANDLER)
      .timeBased()
      .everyHours(WARM_TRIGGER_HOURS)
      .create();
    notes.push(`warm trigger: installed (every ${WARM_TRIGGER_HOURS}h)`);
  } else {
    notes.push("warm trigger: already installed");
  }

  const missing = [
    PROP_KEYS.wizClientId,
    PROP_KEYS.wizClientSecret,
    PROP_KEYS.wizApiUrl,
    PROP_KEYS.wizProjectIdV2,
  ].filter((k) => !getProp(k));
  if (missing.length) {
    notes.push(`NOTE: set Script Properties for live scans: ${missing.join(", ")} ` +
      `(without them the app runs dry-run only)`);
  }
  return notes.join("\n");
}
