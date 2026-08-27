// One-time setup, run from the Apps Script editor after the first clasp push — and again
// after a schema addition, because ensureTabs appends newly declared headers to tabs that
// predate them.
//
// PHASE 1 INSTALLS NO TRIGGERS. gas_ai schedules a daily sync and three read-model warms;
// both need a sync battery, and a ClockTrigger pointing at a handler that does not exist
// fails silently once a day forever. They come back with the battery.

import { DEFAULT_WIZ_AUTH_URL, getProp, PROP_KEYS, setProp } from "./props";
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

  notes.push("Triggers: none installed (no sync battery yet — Phase 2)");
  return notes.join("\n");
}
