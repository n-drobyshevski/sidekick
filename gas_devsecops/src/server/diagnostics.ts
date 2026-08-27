// Run from the Apps Script editor when a deployment does not behave: it answers "is this
// installation wired up", separately from "is the data right".
//
// Deliberately returns a string rather than throwing. An operator running this is already
// looking at something broken; the useful output is every check at once, not the first
// failure.

import { SCOPES } from "../domain/config";
import { getProp, hasWizCredentials, PROP_KEYS } from "./props";
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
  ok("Severities requested", s.fetchSeverities.join(", ") || "(all)");

  out.push("");
  out.push("Sync battery: not installed. This build ships the interface base and the page");
  out.push("composition; collection is Phase 2 (see README.md).");
  return out.join("\n");
}
