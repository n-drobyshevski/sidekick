// The manifest's OAuth scopes, against the services the BUILT bundle actually calls.
//
// WHY THIS FILE EXISTS, measured on a real deployment. `appsscript.json` used to declare no
// `oauthScopes` at all, on the reasoning that Apps Script infers them from the code and both
// sibling projects get away with it. The register then added `UrlFetchApp`, and:
//
//   * the editor run failed with "not authorized to call UrlFetchApp.fetch — required
//     permissions: .../script.external_request";
//   * NO CONSENT PROMPT EVER APPEARED, in the editor or the web app;
//   * the call is present, literally, in `dist/server.js`.
//
// So inference had everything it needed and the scope was still not in the project's
// authorization set. The sibling argument was wrong in a specific way: `gas/` and `gas_ai/`
// called UrlFetchApp from their FIRST push, so their first consent already covered it. Neither
// has ever widened an already-authorized project, which is the only thing this one did.
//
// Declaring the scopes makes the requirement a fact about the manifest rather than a guess
// about a scanner, and a manifest change is itself what makes Apps Script re-ask.
//
// The test is the durable half: it reads the shipped bundle, finds every GAS service it
// touches, and fails if the manifest does not cover one. The next person to add DriveApp,
// GmailApp or CalendarApp gets told at `npm run check` instead of by a deployment that half
// works.

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
 * scope for them.
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

  it("names script.external_request specifically, since that is the one that failed", () => {
    expect(servicesUsed()).toContain("UrlFetchApp");
    expect(manifest.oauthScopes)
      .toContain("https://www.googleapis.com/auth/script.external_request");
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
    // edit both allowlists. `gas_ai/README.md` documents this; it is silent when it breaks,
    // which is why it is asserted here rather than remembered.
    expect(manifest.webapp.executeAs).toBe("USER_DEPLOYING");
  });

  it("keeps access no wider than DOMAIN", () => {
    // Google only exposes a caller's address to a script in the same Workspace domain.
    // Anything wider and every outside visitor reads as "" — which the allowlist denies, but
    // the guarantee the whole access model rests on is gone.
    expect(manifest.webapp.access).toBe("DOMAIN");
  });
});
