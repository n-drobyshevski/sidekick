// pages/settings.js's wiring of the four P7 readouts, read as source text — the same bargain
// test/pagesSettings.test.js and this app's other thin-DOM tests make: the pure model lives in
// settingsReadouts.js and is tested directly (test/settingsReadouts.test.js,
// test/settingsReadoutsMirror.test.js); the DOM wiring that reads it has no jsdom to render
// into (vitest.config.ts sets no `environment`), so it is swept as comment-stripped source text
// instead. `code()` imported from the shared contract rather than re-declared — a package
// earlier this wave removed 23 forks of exactly this stripper.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const SETTINGS_SRC = readFileSync(
  new URL("../src/client/js/pages/settings.js", import.meta.url), "utf8",
);
const SETTINGS_CODE = code(SETTINGS_SRC);

const READOUTS_SRC = readFileSync(
  new URL("../src/client/js/settingsReadouts.js", import.meta.url), "utf8",
);
const READOUTS_CODE = code(READOUTS_SRC);

describe("settings.js fetches the settings-impact payload and degrades it on its own", () => {
  it("calls api_getSettingsImpact", () => {
    expect(SETTINGS_CODE).toMatch(/call\("api_getSettingsImpact",\s*\{\}\)/);
  });

  // DECORATIVE, LIKE gas's OWN loadImpact() — a rejection sets impact back to null rather than
  // failing the page or leaving a stale payload behind.
  it("degrades a failed fetch to impact = null, inside its own try/catch", () => {
    expect(SETTINGS_CODE).toMatch(
      /try\s*\{\s*impact = await call\("api_getSettingsImpact",\s*\{\}\);\s*\}\s*catch[\s\S]{0,150}impact = null;/,
    );
  });

  it("imports the readouts from the client-local model, never from src/domain/", () => {
    expect(SETTINGS_CODE).toMatch(
      /import\s*\{[^}]*severityScopeReadout[^}]*\}\s*from\s*"\.\.\/settingsReadouts\.js"/,
    );
    expect(SETTINGS_CODE).not.toMatch(/from\s+["'][^"']*src\/domain\//);
  });

  it("fetches impact after the panels already exist, and repaints once it lands", () => {
    expect(SETTINGS_CODE).toMatch(/await loadImpact\(\);/);
    expect(SETTINGS_CODE).toMatch(
      /async function loadImpact\(\)\s*\{[\s\S]{0,200}repaintReadouts\(\);\s*\}/,
    );
  });
});

describe("every readout is decorative — repaintReadouts() works with no payload", () => {
  it("opens with the same guard gas's settingsReadouts.js states as the whole contract", () => {
    expect(SETTINGS_CODE).toMatch(
      /function repaintReadouts\(\)\s*\{\s*if \(!impact\) return;/,
    );
  });

  it("is called on every edit, through syncDirty() — not only on load", () => {
    const match = SETTINGS_CODE.match(/function syncDirty\(\)\s*\{[\s\S]*?\n  \}/);
    expect(match, "could not isolate syncDirty()'s body").toBeTruthy();
    expect(match[0]).toMatch(/repaintReadouts\(\);/);
  });
});

describe("the per-scope severity split", () => {
  it("registerScopeBlock() builds a host for it, one per scope", () => {
    expect(SETTINGS_CODE).toMatch(/severitySplitHosts\[scope\] = splitHost;/);
  });

  it("repaintReadouts() draws it from the DRAFT's requested severities, not the saved ones", () => {
    expect(SETTINGS_CODE).toMatch(
      /severityScopeReadout\(scope,\s*census\[scope\],\s*draft\.fetchSeverities\[scope\],/,
    );
  });
});

describe("the stranded-rows figure", () => {
  it("has its own host, above the per-scope blocks", () => {
    expect(SETTINGS_CODE).toMatch(/strandedHost = el\("div", \{\}\);/);
  });

  // DRAFT-DERIVED — the number moves as the reader edits, not only what was last saved.
  it("is computed from the draft's scopes and severities, every repaint", () => {
    expect(SETTINGS_CODE).toMatch(
      /strandedOpenCount\(\s*census,\s*scopeList,\s*draft\.scopes,\s*draft\.fetchSeverities,\s*severityOrder,?\s*\)/,
    );
  });
});

describe("the retention timeline", () => {
  it("is one lane, fed every scope's scans in one call", () => {
    expect(SETTINGS_CODE).toMatch(
      /renderRetentionReadout\(impact\.scans,\s*draft\.retentionDays,\s*SCOPE_LABELS\)/,
    );
  });

  it("names each tick's own scope in its hover hint", () => {
    expect(READOUTS_CODE).toMatch(/labelOf\(s\.scope\)/);
  });
});

describe("the SLA cutline — built once, mutated in place", () => {
  // THE RULE THAT MATTERS MOST HERE. createSlaCutlineReadout() constructs the persistent
  // <input type="range"> exactly once, in one loop, before the first buildPanels() call — it
  // must never appear inside repaintReadouts() or buildDeadlinesPanel(), both of which run on
  // every edit and again on Discard.
  it("is constructed exactly once in the whole page", () => {
    const hits = SETTINGS_CODE.match(/createSlaCutlineReadout\(/g) || [];
    expect(hits.length).toBe(1);
  });

  it("is constructed before buildPanels() is first called, not inside a per-edit function", () => {
    expect(SETTINGS_CODE).toMatch(
      /const slaCutlines = \{\};[\s\S]{0,300}createSlaCutlineReadout\(\{ sev: row\.sev \}\);[\s\S]{0,300}buildPanels\(\);/,
    );
  });

  it("repaintReadouts() only ever calls .update() on it, never rebuilds it", () => {
    const match = SETTINGS_CODE.match(/function repaintReadouts\(\)\s*\{[\s\S]*?\n  \}/);
    expect(match, "could not isolate repaintReadouts()'s body").toBeTruthy();
    expect(match[0]).not.toMatch(/createSlaCutlineReadout\(/);
    expect(match[0]).toMatch(/cutline\.update\(/);
  });

  it("buildDeadlinesPanel() re-embeds the pre-built node rather than constructing a new one", () => {
    expect(SETTINGS_CODE).toMatch(/const cutline = slaCutlines\[r\.sev\];/);
    const match = SETTINGS_CODE.match(/function buildDeadlinesPanel\(\)\s*\{[\s\S]*?\n  \}/);
    expect(match, "could not isolate buildDeadlinesPanel()'s body").toBeTruthy();
    expect(match[0]).not.toMatch(/createSlaCutlineReadout\(/);
  });
});

describe("the standing divergence note", () => {
  // PAYLOAD-FREE: reads only boot.slaTargets (bootstrap) and the draft, so it must be repainted
  // from syncDirty() directly — never from the impact-gated repaintReadouts() — or it would
  // stay silent whenever api_getSettingsImpact never resolves.
  it("is repainted from syncDirty(), not from the impact-gated repaintReadouts()", () => {
    const syncDirtyBody = SETTINGS_CODE.match(/function syncDirty\(\)\s*\{[\s\S]*?\n  \}/);
    expect(syncDirtyBody, "could not isolate syncDirty()'s body").toBeTruthy();
    expect(syncDirtyBody[0]).toMatch(/repaintDivergenceNotes\(\);/);

    const repaintReadoutsBody = SETTINGS_CODE.match(/function repaintReadouts\(\)\s*\{[\s\S]*?\n  \}/);
    expect(repaintReadoutsBody[0]).not.toMatch(/repaintDivergenceNotes/);
  });

  it("compares the draft's window against boot.slaTargets, never the saved or effective override", () => {
    expect(SETTINGS_CODE).toMatch(
      /slaDivergenceNote\(row\.days,\s*boot\.slaTargets\s*&&\s*boot\.slaTargets\[row\.sev\]\)/,
    );
    expect(SETTINGS_CODE).not.toMatch(/slaDivergenceNote\([^)]*effectiveSlaTargets/);
  });
});

describe("the SLA cutline's honesty rules, in settingsReadouts.js", () => {
  // NEVER EXTRAPOLATED. A window past capDays refuses the breach figure rather than guessing
  // at overCap rows whose exact age was never recorded.
  it("refuses to compute breached once the window exceeds capDays", () => {
    expect(READOUTS_CODE).toMatch(/const overCapWindow = windowDays > capDays;/);
    expect(READOUTS_CODE).toMatch(/let breached = null;/);
    expect(READOUTS_CODE).toMatch(/if \(!overCapWindow\) \{/);
  });

  it("names the horizon in words when a window is refused", () => {
    expect(READOUTS_CODE).toMatch(/measured horizon/);
  });

  // unaged rows are never inside any window — named, not hidden inside the breach count.
  it("states the unaged population rather than folding it into the breach count", () => {
    expect(READOUTS_CODE).toMatch(/model\.unaged/);
    expect(READOUTS_CODE).toMatch(/have no measured open date/);
    expect(READOUTS_CODE).not.toMatch(/breached\s*[-+]=\s*.*unaged/);
  });
});

describe("[] means every severity — the one rule this file must not get wrong", () => {
  it("severityScopeModel's inScope predicate checks .length before ever comparing", () => {
    expect(READOUTS_CODE).toMatch(/inScope:\s*\(sev\)\s*=>\s*!requested\.length \|\| requested\.includes\(sev\)/);
  });

  it("strandedOpenCount's narrowing branch makes the identical check", () => {
    expect(READOUTS_CODE).toMatch(/if \(!requested\.length\) \{ byScope\[scope\] = 0; continue; \}/);
  });
});
