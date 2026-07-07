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
