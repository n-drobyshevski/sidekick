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
// Clock triggers resolve in the SCRIPT's timezone unless told otherwise, and the manifest sets
// that to Europe/Paris — so this is 05:00 Paris, not UTC as this line used to claim.
const DAILY_TRIGGER_HOUR = 5;

const WARM_TRIGGER_HANDLER = "trigger_warmReadModels";

// The hours the app should already BE warm at, local to the analysts who open it. This list is
// the schedule as a person states it; the fire times are derived from it below.
export const WARM_READY_BY_HOURS = [9, 13, 17];

// Pinned rather than inherited from the manifest. `atHour` would otherwise follow whatever
// `timeZone` the manifest carries, and a project re-created with `clasp create` gets the CLI's
// default — which would quietly move the whole schedule onto another continent's working day
// while the client kept rendering Europe/Paris (`client/js/ui.js`, DISPLAY_TZ). Naming it here
// makes the two agree by construction, and DST is Google's problem rather than an offset we
// would have to maintain twice a year.
const WARM_TRIGGER_TZ = "Europe/Paris";

// WHY THE FIRE IS AN HOUR BEFORE THE HOUR IT SERVES. `atHour(9)` does not run at 09:00 — it runs
// somewhere between 09:00 and 10:00, so a trigger named for 9 hands the 09:00 arrival exactly the
// cold load this whole mechanism exists to prevent. `nearMinute` narrows that hour-wide window to
// +/-15 minutes, so atHour(8).nearMinute(30) fires between 08:15 and 08:45 and a pass that takes
// 60-120s is done before 09:00 with margin. The modulo is for completeness at midnight; every
// hour configured above is well clear of it.
const WARM_TRIGGER_NEAR_MINUTE = 30;
const WARM_TRIGGER_HOURS = WARM_READY_BY_HOURS.map((h) => (h + 23) % 24);

/**
 * What is installed, in one comparable string. A ClockTrigger exposes its handler and nothing
 * else — no hour, no minute, no timezone — so `getProjectTriggers()` cannot answer "is the
 * installed schedule the one this source asks for?". Recording the answer next to the triggers
 * is what lets a later edit to the hours above converge on the next setup() instead of leaving a
 * deployment on the old schedule forever with nothing to show for it.
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
    notes.push(`daily trigger: installed (${DAILY_TRIGGER_HOUR}:00 script-local)`);
  } else {
    notes.push("daily trigger: already installed");
  }

  // Read-model warm trigger. Reconciled rather than merely deduplicated: the schedule is a set
  // of triggers now, so "none installed" is no longer the only state that needs fixing.
  //
  // WORKING HOURS, NOT ROUND THE CLOCK. The warm only pays for itself if somebody opens the app
  // before the entry it refreshed lapses, so a 01:00 fire refreshes caches that expire at 07:00
  // having served nobody. Firing three times across the working day instead of six times around
  // it halves the trigger-quota draw (capped at 90 min/day on a consumer account, and the daily
  // scan's continuation hops already draw on it) and loses nothing anyone was awake for.
  //
  // Each fire is spaced under the six-hour CacheService ceiling it exists to stay ahead of, so
  // the working day is covered end to end: a pass finishing by 08:45 holds past 14:45, the 12:45
  // pass past 18:45, the 16:45 pass past 22:45. THE OVERNIGHT GAP IS DELIBERATE AND ONLY SAFE
  // BECAUSE OF THE DRIVE L2 — the six heaviest models (bootstrapCore6, mttrTrend6 and friends)
  // do not expire there, so the rare out-of-hours visitor pays a Drive round-trip rather than
  // the full recompute they would have paid before `readModelStore` existed.
  //
  // It still cannot keep the 1h entries warm and does not try: `everyMinutes` accepts only
  // 1/5/10/15/30, so chasing them would cost several times the quota for a fraction more
  // coverage. Those stay warm for an hour after each fire and cold otherwise, which is what
  // their TTL already meant.
  //
  // `everyDays(1)` fires at weekends too. Restricting to weekdays needs `onWeekDay`, which is one
  // trigger per day per hour — fifteen of them, against a hard limit of twenty per script — to
  // save a few minutes a week. Not worth the ceiling.
  const warmExisting = ScriptApp.getProjectTriggers().filter(
    (t) => t.getHandlerFunction() === WARM_TRIGGER_HANDLER,
  );
  const wantSchedule = warmScheduleSignature();
  if (warmExisting.length === WARM_TRIGGER_HOURS.length &&
      getProp(PROP_KEYS.warmTriggerSchedule) === wantSchedule) {
    notes.push(`warm trigger: already installed (${wantSchedule})`);
  } else {
    // Torn down first, and whole. A deployment predating this carries a single everyHours(4)
    // trigger that no filter can tell apart from a correctly-scheduled one, so the only way to
    // reach a known state is to drop every warm trigger and rebuild the set.
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
    // LAST, so a create() that throws part-way leaves the property stale and the next setup()
    // reconciles again. Recording it first would strand a half-built schedule as "correct".
    setProp(PROP_KEYS.warmTriggerSchedule, wantSchedule);
    notes.push(
      `warm trigger: installed ${WARM_TRIGGER_HOURS.length}x daily, warm by ` +
      `${WARM_READY_BY_HOURS.map((h) => `${h}:00`).join(", ")} ${WARM_TRIGGER_TZ}` +
      (warmExisting.length ? ` (replaced ${warmExisting.length})` : ""),
    );
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
