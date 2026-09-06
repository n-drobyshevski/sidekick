// The manifest's OAuth scopes, against the services the BUILT bundle actually calls.
//
// WHY THIS FILE EXISTS, measured on a real deployment of gas_devsecops. `appsscript.json`
// used to declare no `oauthScopes` at all, on the reasoning that Apps Script infers them from
// the code and both sibling projects got away with it. That register then added
// `UrlFetchApp`, and:
//
//   * the editor run failed with "not authorized to call UrlFetchApp.fetch — required
//     permissions: .../script.external_request";
//   * NO CONSENT PROMPT EVER APPEARED, in the editor or the web app;
//   * the call was present, literally, in `dist/server.js`.
//
// So inference had everything it needed and the scope was still not in the project's
// authorization set. Declaring the scopes makes the requirement a fact about the manifest
// rather than a guess about a scanner, and a manifest change is itself what makes Apps Script
// re-ask.
//
// THIS APP ASKS FOR TWO SCOPES AND SHOULD NEVER ASK FOR A THIRD without an argument being
// made for it. It reads no spreadsheet, writes no Drive file and — the one that matters —
// makes no outbound HTTP request at all: there is no "test this URL" button on the Settings
// panel precisely because it would drag `script.external_request` into a launcher that
// fetches nothing. The "asks for nothing it does not use" case below is where that argument
// gets demanded; the assertion naming the exact two is where a quiet widening gets caught.
//
// PORTED FROM gas_devsecops/test/manifestScopes.test.js, minus its
// "names script.external_request specifically" case — that register's whole reason for
// existing is a Wiz API it must call, and this one has no such service. Deleting the case
// rather than inverting it: the two-scope assertion below already fails if the scope appears,
// and it fails with a message about THIS app's shape rather than about the sibling's outage.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const manifest = JSON.parse(read("dist/appsscript.json"));

/**
 * Which scope each GAS service needs.
 *
 * Services with NO entry need no scope — `PropertiesService`, `CacheService`, `LockService`,
 * `Utilities` and `HtmlService` are all free, which is why they are absent rather than mapped
 * to "". Listing them as needing nothing would invite someone to "fix" the gap by inventing a
 * scope for them. (`PropertiesService` and `HtmlService` are the two this app leans on
 * hardest — the three sibling URLs and the served page — and neither costs a consent line.)
 */
const SERVICE_SCOPES = {
  UrlFetchApp: "https://www.googleapis.com/auth/script.external_request",
  SpreadsheetApp: "https://www.googleapis.com/auth/spreadsheets",
  DriveApp: "https://www.googleapis.com/auth/drive",
  ScriptApp: "https://www.googleapis.com/auth/script.scriptapp",
  Session: "https://www.googleapis.com/auth/userinfo.email",
  GmailApp: "https://www.googleapis.com/auth/script.send_mail",
  MailApp: "https://www.googleapis.com/auth/script.send_mail",
  CalendarApp: "https://www.googleapis.com/auth/calendar",
  DocumentApp: "https://www.googleapis.com/auth/documents",
};

/** Comments stripped: a service NAMED in prose is not a service CALLED. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every mapped service the built, pushed files actually reference. */
function servicesUsed() {
  const bundle = code(read("dist/server.js")) + "\n" + code(read("dist/entry.js"));
  return Object.keys(SERVICE_SCOPES)
    .filter((s) => new RegExp(`\\b${s}\\s*\\.`).test(bundle));
}

describe("the manifest declares what the bundle needs", () => {
  it("declares scopes at all", () => {
    // The state that produced the outage: no list, total reliance on inference.
    expect(Array.isArray(manifest.oauthScopes)).toBe(true);
    expect(manifest.oauthScopes.length).toBeGreaterThan(0);
  });

  it("covers every GAS service the built bundle calls", () => {
    const missing = servicesUsed()
      .filter((s) => manifest.oauthScopes.indexOf(SERVICE_SCOPES[s]) < 0)
      .map((s) => `${s} -> ${SERVICE_SCOPES[s]}`);
    expect(missing, "services called by dist/ with no scope in appsscript.json").toEqual([]);
  });

  it("calls exactly two scoped services — ScriptApp and Session, and nothing else", () => {
    // `Session` is the identity every access check rests on. `ScriptApp` is reached through
    // `access.serviceUrl()` -> `accountChooserUrl()`, which is what `deniedPage()` uses to
    // offer a refused visitor the account chooser — so the scope is honest rather than
    // inherited from the fork. THE ABSENCE THAT MATTERS IS `UrlFetchApp`: this app makes no
    // outbound request, and the moment one appears this list changes and somebody has to say
    // why a launcher is fetching something.
    expect(servicesUsed().sort()).toEqual(["ScriptApp", "Session"]);
  });

  it("asks for nothing it does not use", () => {
    // A scope list is a consent screen. Every unused entry is permission an operator grants
    // for nothing, and on a security tool that is worth more than the convenience of a
    // copy-pasted list.
    const needed = new Set(servicesUsed().map((s) => SERVICE_SCOPES[s]));
    const extra = manifest.oauthScopes.filter((s) => !needed.has(s));
    expect(extra, "declared but nothing in dist/ calls the service behind it").toEqual([]);
  });
});

describe("the web app settings that the access model rests on", () => {
  it("keeps executeAs USER_DEPLOYING", () => {
    // Under "execute as the user accessing", the effective user is the VISITOR — so
    // `ownerEmail()` returns whoever is looking, the owner check matches them against
    // themselves, and every same-domain visitor is admitted as the owner with the power to
    // edit both allowlists. In this app that would also hand them the three sibling URLs,
    // which are the hrefs on the front page for everybody.
    expect(manifest.webapp.executeAs).toBe("USER_DEPLOYING");
  });

  it("keeps access no wider than DOMAIN", () => {
    // Google only exposes a caller's address to a script in the same Workspace domain.
    // Anything wider and every outside visitor reads as "" — which the allowlist denies, but
    // the guarantee the whole access model rests on is gone.
    expect(manifest.webapp.access).toBe("DOMAIN");
  });
});
