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

// P10's DOM half — categoryScopeRow()/categoryScopeReadout()/termCoverageReadout() — lives
// inside settingsReadouts.js itself rather than pages/settings.js, so the hatch/wording rules
// are swept from THIS file's own source, the same bargain the header above describes.
const READOUTS_SRC = readFileSync(
  new URL("../src/client/js/settingsReadouts.js", import.meta.url), "utf8",
);
const READOUTS_CODE = code(READOUTS_SRC);

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

// ================================================================================ P10: category
// scope readout, wired into pages/settings.js

describe("the category-scope readout", () => {
  it("is payload-derived — built once from the resolved impact, never re-fetched or re-derived", () => {
    expect(SETTINGS_CODE).toMatch(
      /impact \? categoryScopeReadout\(impact\.categoryCube,\s*impact\.candidateCategories\)\s*: null/,
    );
  });

  // THE DATED CANDIDATE LIST, NOT THE PLAIN ONE. `settings.candidateCategories` (api_getSettings)
  // carries no count/measuredAt/measuredScope at all — passing it here would silently drop the
  // dated calibration figures this readout exists to show.
  it("passes impact.candidateCategories (the dated list), never settings.candidateCategories", () => {
    expect(SETTINGS_CODE).not.toMatch(/categoryScopeReadout\([^)]*settings\.candidateCategories/);
  });
});

describe("the dropped-category figure", () => {
  it("has its own host, hidden until the first repaint gives it something to say", () => {
    expect(SETTINGS_CODE).toMatch(/droppedOnlyHost = el\("p",\s*\{[^}]*hidden:\s*true/);
  });

  // DRAFT-DERIVED: computed against the CURRENT draft and the SAVED selection, not two draft
  // snapshots — categoryDroppedOnlyText's own contract.
  it("reads the current draft against the saved selection, not two draft snapshots", () => {
    expect(SETTINGS_CODE).toMatch(
      /categoryDroppedOnlyText\(\s*impact\.categoryCube,\s*draft\.issueCategories,\s*saved\.issueCategories,?\s*\)/,
    );
  });

  it("is recomputed on every edit, through the same funnel every other draft-derived figure uses", () => {
    expect(SETTINGS_CODE).toMatch(/function repaintImpactReadouts\(\)\s*\{\s*if \(!impact\) return;/);
    expect(SETTINGS_CODE).toMatch(
      /function onEdit\(\)\s*\{[\s\S]{0,60}repaintImpactReadouts\(\)/,
    );
  });
});

describe("the term-coverage readout", () => {
  it("reads the clock term off the draft's own timeSource, not a saved or fixed one", () => {
    expect(SETTINGS_CODE).toMatch(
      /termCoverageReadout\(\s*impact\.termCoverage,\s*draft\.rankRule\.timeSource,?\s*\)/,
    );
  });

  it("is rebuilt (not merely updated) inside repaintImpactReadouts(), so a timeSource change repaints it", () => {
    expect(SETTINGS_CODE).toMatch(
      /function repaintImpactReadouts\(\)[\s\S]{0,600}clear\(termCoverageHost\)[\s\S]{0,200}termCoverageReadout\(/,
    );
  });
});

// ================================================================================ P10: the DOM
// half that lives inside settingsReadouts.js itself

describe("categoryScopeRow — the honesty mark", () => {
  // NEVER A ZERO-HEIGHT BAR. The unmeasured branch's bar value is `max` (a FULL bar), never a
  // literal 0 — a blank track would read as "measured, and it was zero".
  it("draws an unmeasured category as a full bar, never a zero-width one", () => {
    expect(READOUTS_CODE).toMatch(
      /meter\(row\.measured \? row\.count : max,/,
    );
    expect(READOUTS_CODE).not.toMatch(/row\.measured \? row\.count : 0/);
  });

  it("hatches only the unmeasured branch", () => {
    expect(READOUTS_CODE).toMatch(/if \(!row\.measured\) bar\.fill\.classList\.add\("hatch"\)/);
  });

  // A TEXTURE IS NOT A FACT — the hatch always carries a word beside it.
  it("carries the word \"Not measured\" beside the hatch", () => {
    expect(READOUTS_CODE).toMatch(/"Not measured"/);
  });

  it("states the overlap caveat, the same shape gas's risk-clause table uses", () => {
    expect(READOUTS_CODE).toMatch(/can overlap on the same issue, so they/);
  });

  it("labels the dated figure with both its date and its scope, never bare", () => {
    expect(READOUTS_CODE).toMatch(/row\.dated\.measuredAt/);
    expect(READOUTS_CODE).toMatch(/row\.dated\.measuredScope/);
  });

  // THE DATED FIGURE AND THE LIVE COUNT ARE NEVER SUMMED OR COMPARED. Structural check: no
  // arithmetic expression mixes `row.count` and `row.dated` in either order, anywhere in the
  // category-scope rendering code.
  it("never combines the dated figure and the live count in one expression", () => {
    expect(READOUTS_CODE).not.toMatch(/row\.count\s*[-+*/]\s*row\.dated/);
    expect(READOUTS_CODE).not.toMatch(/row\.dated\.count\s*[-+*/]\s*row\.count/);
    expect(READOUTS_CODE).not.toMatch(/row\.count\s*[<>=]=?\s*row\.dated/);
  });
});

describe("termCoverageReadout — why a poorly-measured term matters", () => {
  it("says, briefly, that an unmeasured term is dropped from both sides of the blend", () => {
    expect(READOUTS_CODE).toMatch(/dropped from both sides of the blend/);
  });

  it("draws one impactSplit bar per term, over the shared impactSplitModel shape", () => {
    expect(READOUTS_CODE).toMatch(/impactSplit\(t\.splitModel\)/);
  });
});

// ================================================================================ P11: the rank
// cube — "would this change the order of my queue"

describe("the rank-impact readout", () => {
  it("reads the draft rule against the SAVED rule, never two draft snapshots", () => {
    expect(SETTINGS_CODE).toMatch(
      /rankImpactReadout\(\s*impact\.rankCube,\s*draft\.rankRule,\s*saved\.rankRule,?\s*\)/,
    );
  });

  it("is rebuilt (not merely updated) inside repaintImpactReadouts(), so any of the five draft fields it reads repaints it", () => {
    expect(SETTINGS_CODE).toMatch(
      /function repaintImpactReadouts\(\)[\s\S]{0,900}clear\(rankImpactHost\)[\s\S]{0,200}rankImpactReadout\(/,
    );
  });

  it("has its own host, appended inside the ranking panel's body", () => {
    expect(SETTINGS_CODE).toMatch(/const rankImpactHost = el\("div", \{\}\)/);
    expect(SETTINGS_CODE).toMatch(/rankImpactHost,\s*\n\s*settingRow\(\{\s*\n\s*label: "Rank leads/);
  });
});

describe("rankCubeModel.js — every reader degrades on an absent cube", () => {
  const MODEL_SRC = readFileSync(
    new URL("../src/client/js/rankCubeModel.js", import.meta.url), "utf8",
  );
  const MODEL_CODE = code(MODEL_SRC);

  it("rankScoreHistogram returns an empty array, never a guessed distribution", () => {
    expect(MODEL_CODE).toMatch(/if \(!cells\.length[\s\S]{0,40}return \[\];/);
  });

  it("rankRowsMovedBeyond, rankCubeTauB and rankCubeTopN return null, never a guessed 0", () => {
    expect(MODEL_CODE).toMatch(/export function rankRowsMovedBeyond\(cube, ruleA, ruleB, threshold\) \{\s*\n\s*if \(!cube \|\| !cube\.cells\) return null;/);
    expect(MODEL_CODE).toMatch(/export function rankCubeTauB\(cube, ruleA, ruleB\) \{\s*\n\s*if \(!cube \|\| !cube\.cells\) return null;/);
    expect(MODEL_CODE).toMatch(/export function rankCubeTopN\(cube, ruleA, ruleB, n\) \{\s*\n\s*if \(!cube \|\| !cube\.cells\) return null;/);
  });
});

describe("rankTopNText — the range, not a guessed point estimate", () => {
  it("prints a range, with the tiebreak clause, whenever lo !== hi", () => {
    expect(READOUTS_CODE).toMatch(/Between \$\{fmt\(lo\)\} and \$\{fmt\(hi\)\}/);
    expect(READOUTS_CODE).toMatch(/this figure cannot see/);
  });

  it("prints the bare number only when lo === hi", () => {
    expect(READOUTS_CODE).toMatch(/if \(lo === hi\) \{/);
  });
});
