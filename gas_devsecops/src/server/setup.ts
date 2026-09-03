// One-time setup, run from the Apps Script editor after the first clasp push — and again
// after a schema addition, because ensureTabs appends newly declared headers to tabs that
// predate them.
//
// THE BATTERY LANDED (server/scanJobs.ts, server/readModels.ts) BEFORE THIS FILE'S TRIGGERS
// DID. Both need standing ClockTriggers to ever fire — a trigger pointing at a handler that
// does not exist fails silently once a day forever — so this is where they are installed.
//
// TRIGGER QUOTA, STATED ONCE SO A FUTURE ADDITION HAS SOMETHING TO CHECK AGAINST. Apps Script
// caps a project at 20 triggers total. This file installs 4 STANDING ones (1 daily sync + 3
// warm passes, below) and leaves room for the 2 TRANSIENT ones `scanJobs.ts` installs and
// tears down around a single in-flight sync (`jobsStore.CONTINUE_HANDLERS.sync` /
// `WATCHDOG_HANDLERS.sync` — one continuation hop, one watchdog, cleared together on every
// terminal transition). 4 + 2 = 6 of 20, with 14 of headroom for whatever Phase 2 adds next.
// The daily sync's own execution time is small next to what it is measured against: Apps
// Script gives a project roughly 6 hours of trigger runtime a day, and one full sync across
// its continuation hops totals on the order of 2 minutes of that.
//
// setup() is idempotent by RECONCILING against a recorded signature, not by "install once and
// never look again" — see warmScheduleSignature() below for why a signature is the only way to
// tell a correctly-scheduled set of triggers from a stale one, and why a naive dedupe-by-count
// would leave a changed schedule installed forever.

import { DEFAULT_SYNC_HOUR } from "../domain/settingsLogic";
import { DEFAULT_WIZ_AUTH_URL, getProp, PROP_KEYS, setProp } from "./props";
import { ensureTabs } from "./sheetsDb";

const DAILY_SYNC_HANDLER = "trigger_dailySync";
// Imported rather than re-literaled: `Settings.syncSchedule` (domain/settingsLogic.ts) is not
// read by setup() yet (see that field's doc comment for why), but its default and the hour
// actually installed below must never silently drift apart while that TODO is open.
const DAILY_SYNC_HOUR = DEFAULT_SYNC_HOUR;

const WARM_HANDLER = "trigger_warmReadModels";

// The hours the app should already be warm by, local to the analysts who open it — a person's
// statement of the schedule, with the fire times derived from it below rather than picked
// separately. 09:00/13:00/17:00 brackets a working day (arrival, post-lunch, late-afternoon)
// with even gaps, and `readModels.ts`'s cached-vs-durablyCached split is what makes three
// enough: the 1h-cached models (executive/mttr/secrets/register) go cold between passes and
// that is fine — the rare out-of-hours visitor pays one recompute — but the four durablyCached
// models (history/program/repos/storage) persist to the Drive L2 regardless of the in-memory
// CacheService TTL, so they stay warm through the overnight gap this schedule deliberately
// does not cover.
const WARM_READY_BY_HOURS = [9, 13, 17];

// Fired ONE HOUR BEFORE the hour each serves. `atHour(9)` does not run AT 09:00 — it fires
// somewhere in the 09:00-10:00 window — so a trigger literally named for 9 would hand the
// 09:00 arrival exactly the cold read this mechanism exists to avoid. `nearMinute` below
// narrows that hour-wide window to +/-15 minutes, so `atHour(8).nearMinute(30)` lands between
// 08:15 and 08:45, comfortably ahead of 09:00 for a pass that finishes in well under an hour.
const WARM_TRIGGER_HOURS = WARM_READY_BY_HOURS.map((h) => (h + 23) % 24);
const WARM_TRIGGER_NEAR_MINUTE = 30;

// Pinned rather than inherited from the manifest's `timeZone`. A project re-created with
// `clasp create` gets whatever timezone the CLI defaults to, and `atHour` follows the SCRIPT
// timezone unless told otherwise — so an uninherited schedule could silently fire on another
// continent's working day while `client/js/ui/format.js`'s `DISPLAY_TZ` kept rendering
// Europe/Paris. Naming it here makes the two agree by construction; the manifest (dist/
// appsscript.json) happens to already say Europe/Paris too, so this is belt-and-braces, not a
// second answer.
const WARM_TRIGGER_TZ = "Europe/Paris";

/**
 * What is installed, as one comparable string. A ClockTrigger exposes its handler function and
 * NOTHING ELSE — no hour, no minute, no timezone — so `getProjectTriggers()` alone cannot tell
 * a correctly-scheduled set of warm triggers from three left over from an earlier version of
 * this file's schedule. Recording the signature next to the triggers is what lets a later edit
 * to the hours above converge on the very next setup() run instead of leaving a live deployment
 * on a stale schedule forever with nothing on screen to show for it.
 */
export function warmTriggerSchedule(): string {
  return `${WARM_TRIGGER_TZ}|${WARM_TRIGGER_HOURS.join(",")}@${WARM_TRIGGER_NEAR_MINUTE}`;
}

export function setup(): string {
  const notes: string[] = [];

  // The ledger spreadsheet. Created once and remembered by id, never by name — a name
  // lookup would bind the app to whatever the operator renamed the file to.
  let ssId = getProp(PROP_KEYS.ledgerSpreadsheetId);
  let ss: GoogleAppsScript.Spreadsheet.Spreadsheet;
  if (ssId) {
    ss = SpreadsheetApp.openById(ssId);
    notes.push(`Ledger: reusing ${ssId}`);
  } else {
    ss = SpreadsheetApp.create("Wiz Sidekick DevSecOps — ledger");
    ssId = ss.getId();
    setProp(PROP_KEYS.ledgerSpreadsheetId, ssId);
    notes.push(`Ledger: created ${ssId}`);
  }
  ensureTabs(ss);
  notes.push("Tabs: ensured (headers appended where missing)");

  // The archive folder. Drive holds the gzipped raw pages and snapshots; the Sheet holds
  // only what has to be queryable.
  let folderId = getProp(PROP_KEYS.archiveFolderId);
  if (!folderId) {
    folderId = DriveApp.createFolder("Wiz Sidekick DevSecOps — archive").getId();
    setProp(PROP_KEYS.archiveFolderId, folderId);
    notes.push(`Archive: created ${folderId}`);
  } else {
    notes.push(`Archive: reusing ${folderId}`);
  }

  if (!getProp(PROP_KEYS.wizAuthUrl)) setProp(PROP_KEYS.wizAuthUrl, DEFAULT_WIZ_AUTH_URL);

  // The allowlist fails CLOSED: unset means nobody but the owner, who is allowed by
  // identity rather than by membership. Seeding it with the owner here makes that explicit
  // in the stored state instead of only in the guard.
  if (!getProp(PROP_KEYS.allowedUsers)) {
    const owner = Session.getEffectiveUser().getEmail();
    if (owner) {
      setProp(PROP_KEYS.allowedUsers, owner);
      notes.push(`Access: seeded ALLOWED_USERS with ${owner}`);
    }
  }

  // Daily sync trigger — deduplicated by handler name. There is only ever one of these, so
  // (unlike the warm set below) presence is the whole question; nothing about a single daily
  // trigger needs a recorded signature to tell "correct" from "stale".
  const dailyExisting = ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === DAILY_SYNC_HANDLER);
  if (!dailyExisting.length) {
    ScriptApp.newTrigger(DAILY_SYNC_HANDLER)
      .timeBased()
      .everyDays(1)
      .atHour(DAILY_SYNC_HOUR)
      .create();
    notes.push(`Daily sync trigger: installed (${DAILY_SYNC_HOUR}:00 script-local)`);
  } else {
    notes.push("Daily sync trigger: already installed");
  }

  // Read-model warm triggers — reconciled against the recorded signature, not merely
  // deduplicated by count. A set of 3 triggers on a schedule this file no longer asks for
  // would pass a count check and never converge; see warmTriggerSchedule()'s doc comment.
  const warmExisting = ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === WARM_HANDLER);
  const wantSchedule = warmTriggerSchedule();
  if (warmExisting.length === WARM_TRIGGER_HOURS.length &&
      getProp(PROP_KEYS.warmTriggerSchedule) === wantSchedule) {
    notes.push(`Warm triggers: already installed (${wantSchedule})`);
  } else {
    // Torn down first, and whole. A deployment predating this change, or one whose source has
    // since edited WARM_READY_BY_HOURS, carries triggers no filter can tell apart from a
    // correctly-scheduled set — the only way to reach a known state is to drop every warm
    // trigger this handler owns and rebuild the set from the current source.
    for (const t of warmExisting) ScriptApp.deleteTrigger(t);
    for (const hour of WARM_TRIGGER_HOURS) {
      ScriptApp.newTrigger(WARM_HANDLER)
        .timeBased()
        .everyDays(1)
        .atHour(hour)
        .nearMinute(WARM_TRIGGER_NEAR_MINUTE)
        .inTimezone(WARM_TRIGGER_TZ)
        .create();
    }
    // LAST, so a create() that throws part-way through leaves the property stale and the next
    // setup() run reconciles again instead of recording a half-built schedule as correct.
    setProp(PROP_KEYS.warmTriggerSchedule, wantSchedule);
    notes.push(
      `Warm triggers: installed ${WARM_TRIGGER_HOURS.length}x daily, warm by ` +
      `${WARM_READY_BY_HOURS.map((h) => `${h}:00`).join(", ")} ${WARM_TRIGGER_TZ}` +
      (warmExisting.length ? ` (replaced ${warmExisting.length})` : ""),
    );
  }

  return notes.join("\n");
}
