// pages/settings.js's wiring of the three free readouts (P8), read as source text — the same
// bargain test/settingsDom.test.js (gas) and this app's own railDom.test.js/registerToolbar.
// test.js make for their thin DOM layers: the pure model lives in settingsReadouts.js and is
// tested directly (test/settingsReadouts.test.js); the DOM wiring that reads it has no jsdom to
// render into, so it is swept as comment-stripped source text instead. `code()` imported from
// the shared contract rather than re-declared — a package earlier this wave removed 23 forks of
// exactly this stripper.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const SETTINGS_SRC = readFileSync(
  new URL("../src/client/js/pages/settings.js", import.meta.url), "utf8",
);
const SETTINGS_CODE = code(SETTINGS_SRC);

describe("settings.js fetches the settings-impact payload alongside its neighbours", () => {
  it("adds api_getSettingsImpact to the same Promise.allSettled batch", () => {
    expect(SETTINGS_CODE).toMatch(/Promise\.allSettled\(\[[\s\S]{0,400}api_getSettingsImpact/);
  });

  it("degrades it exactly like the neighbouring calls — a status check, not a bare await", () => {
    expect(SETTINGS_CODE).toMatch(/settled\[3\]\.status === "fulfilled"/);
  });

  it("imports the three readouts from the client-local model, never from src/domain/", () => {
    expect(SETTINGS_CODE).toMatch(
      /import\s*\{[^}]*agentCallsText[^}]*\}\s*from\s*"\.\.\/settingsReadouts\.js"/,
    );
    expect(SETTINGS_CODE).not.toMatch(/from\s+["'][^"']*src\/domain\//);
  });
});

describe("the 5Rs live split", () => {
  it("is rebuilt inside syncAll(), not painted once and forgotten", () => {
    // fiveRsSplit(...) must appear shortly after `function syncAll() {`, so every draft edit
    // that calls syncAll() repaints it — not merely somewhere else in buildFiveRs().
    expect(SETTINGS_CODE).toMatch(
      /function syncAll\(\)\s*\{[\s\S]{0,600}fiveRsSplit\(scope\.policies,\s*draft\.fiveRsPins\)/,
    );
  });

  it("reuses the shared derivedFiveRsSelected rather than a second local copy", () => {
    // The one-line alias, not a re-declared `if (row.reason === "pinnedIn") ...` function body.
    expect(SETTINGS_CODE).toMatch(/derivedSelected\s*=\s*derivedFiveRsSelected/);
    expect(SETTINGS_CODE).not.toMatch(/function derivedSelected\(row\)/);
  });
});

describe("the Fetch-scope readout", () => {
  it("draws the measured project side from bootstrap's own open-issue count", () => {
    expect(SETTINGS_CODE).toMatch(/fetchScopeReadoutModel\(/);
    expect(SETTINGS_CODE).toMatch(/boot\.counts\.openIssues/);
  });

  // THE CLAIM THIS PACKAGE EXISTS TO KEEP. Nothing in the page may fabricate a tenant-wide
  // figure — no "would collect N" sentence, no estimate, anywhere in this file.
  it("never invents a tenant-wide figure anywhere in the page", () => {
    expect(SETTINGS_CODE.toLowerCase()).not.toMatch(/would collect/);
    expect(SETTINGS_CODE.toLowerCase()).not.toMatch(/estimated (tenant|perimeter)/);
  });
});

describe("the agent-count readout", () => {
  it("reads agentCount off the resolved impact payload, never a live re-fetch", () => {
    expect(SETTINGS_CODE).toMatch(/agentCallsText\(impact \? impact\.agentCount : null\)/);
  });

  it("draws no node at all when agentCallsText answers null — a ternary, not an empty string", () => {
    expect(SETTINGS_CODE).toMatch(
      /agentCallsLine\s*\?\s*el\([\s\S]{0,80}\)\s*:\s*null/,
    );
  });
});
