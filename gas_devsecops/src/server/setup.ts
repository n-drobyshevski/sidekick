// One-time setup, run from the Apps Script editor after the first clasp push — and again
// after a schema addition, because ensureTabs appends newly declared headers to tabs that
// predate them.
//
// THE DAILY SCAN TRIGGER LANDS HERE, and it could not land before the battery did: a
// ClockTrigger pointing at a handler that does not exist fails silently once a day forever.
// `trigger_dailyScan` is a real global in dist/entry.js now, and `test/entryPoints.test.js`
// holds it there. The read-model warms gas_ai also schedules are still not installed —
// nothing warms a read model here yet.

import { DEFAULT_WIZ_AUTH_URL, getProp, hasWizCredentials, PROP_KEYS, setProp } from "./props";
import { DAILY_HANDLER } from "./scanJobs";
import { ensureTabs } from "./sheetsDb";

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

  // The daily scan. Deduplicated by handler name, because setup() is re-run after every
  // schema addition and a second ClockTrigger would mean two scans racing for one lock.
  //
  // Installed even without credentials: `dailyScan` checks for them itself and returns
  // quietly, which is the difference between an installation that does nothing once a day
  // and one that logs a failure once a day. What must NOT happen is the reverse — a
  // ClockTrigger pointing at a handler that does not exist fails silently forever, which is
  // why this arrived with the battery rather than before it.
  const existing = ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === DAILY_HANDLER);
  if (existing.length) {
    notes.push(`Triggers: daily scan already installed (${existing.length})`);
  } else {
    ScriptApp.newTrigger(DAILY_HANDLER).timeBased().everyDays(1).atHour(3).create();
    notes.push("Triggers: installed the daily scan (03:00, project timezone)");
  }
  if (!hasWizCredentials()) {
    notes.push("  note: no Wiz credentials are set, so it will return without scanning.");
  }

  return notes.join("\n");
}
