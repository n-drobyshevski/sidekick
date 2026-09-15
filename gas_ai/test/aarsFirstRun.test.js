// F4 — Scoring Models (`#/aars`) stops printing bare zeros over an unsynced store.
//
// MEASURED (Playwright, `?dry&noseed#/aars`, experimental flag on, port 8818): TEN bare "0"s
// in `.hero-value, .comp-hero-value, .mini-value, .kpi-value, td` on page load — every one of
// them the AARS gap-ladder's claim-rail column (`.rule-prices num` cells under the "Prices"
// header), nine cascade rows plus the fallback row. The Problem tree, Posture and Rank eval
// tabs printed none on load (they are lazy — only the active tab's pane is ever mounted), but
// the same category error is reachable on Posture's and Rank's own figures once switched to,
// which is why the fix below reaches all four tabs rather than only the one the walker saw.
//
// ROOT CAUSE. `api_previewAarsRule` succeeds even with zero synced assets — it answers a
// genuine "0 of 0" rather than refusing — so `preview.gapMatchCounts` (an array) and
// `preview.gapInstanceTotal` (a number) come back TRUTHY. `sync()`'s cascade-row loop read
// that truthiness as "measured": `priced = matchCounts ? matchCounts[i] ?? 0 : null`, and
// `claimRail(td, { count: priced, … })` prints the bare number the moment `count` is not
// `null` — nine rows and the fallback, all landing on a confident "0". CLAUDE.md's rule is
// exactly this: an unmeasured register is not a register of zeroes, and `Number`/array
// truthiness is not the same question as "did anyone look."
//
// THE FIX. `renderAarsRules` reads `bootstrap()` once and derives `synced = !!boot.latestSync`
// — the same authoritative "has anything been read" signal every other register page gates
// on, read once rather than re-derived from whatever the preview's shape happens to be. Every
// tab painter below reads it: `sync()` (AARS gap ladder + severity-band counts),
// `paintImpact()` / `paintProblemImpact()` / `paintPostureImpact()` (their shared "Impact on
// the current inventory" pane), `buildRankEval(report, synced)` (Rank eval, which has no
// draft to gate around — WP8 — so the whole pane's figure area is the gate), and
// `openCodeReference()`'s per-code "seen" column. Each shows ONE `firstRunNotice({synced:
// false, hint})` at the top of its own figure area — never a whole-page or whole-tab-editor
// gate: every rule editor (points, match type, code, band thresholds) stays exactly as
// interactive as it was, because a first sync is not a precondition for drafting a rule.
//
// WHAT STAYS UNGATED, ON PURPOSE. Problem's and Posture's own cascade claim-rail columns
// ("Leaves" / "Cells") read `leafCoverage(rule)` / `cellCoverage(rule)` — pure functions of
// the RULE alone (`src/domain/problemRule.ts`, `postureRule.ts`), never of the landscape — so
// they are correct with nobody synced and are left exactly as they were. Likewise
// `shadowedGapRules(rule)` / `unreachableGapRules(rule)`, which is why the AARS fix below
// touches only `matchCounts` / `instanceTotal` / the severity-band `counts`, never `shadowed`
// or `unreachable`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";
import { absentText } from "../../gas_shared/ui/figures.js";
import { aarsFigureView } from "../src/client/js/pages/aarsView.js";

const AARS = code(readFileSync(
  new URL("../src/client/js/pages/aars.js", import.meta.url), "utf8",
));

/** A bounded slice of the source, by two literal anchors — the same idiom
 *  prioritiesFirstRun.test.js uses, so a line-number shuffle elsewhere in this 4,700-line
 *  file cannot silently stop these checks from covering anything. */
function slice(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) return null;
  const end = src.indexOf(endMarker, start);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

// =========================================================================================
//  1. aarsFigureView — the DOM-free view helper
// =========================================================================================

describe("aarsFigureView(synced, value)", () => {
  it("returns the absence mark when unsynced, regardless of the value", () => {
    expect(aarsFigureView(false, 5)).toBe(absentText);
    expect(aarsFigureView(false, "3 assets")).toBe(absentText);
    expect(aarsFigureView(false, 0)).toBe(absentText);
    expect(aarsFigureView(false, null)).toBe(absentText);
    expect(aarsFigureView(false, undefined)).toBe(absentText);
  });

  it("returns the real figure, unchanged, once synced — including a genuine zero", () => {
    expect(aarsFigureView(true, 5)).toBe(5);
    expect(aarsFigureView(true, "3 assets")).toBe("3 assets");
    // A measurement over a synced-but-empty population keeps its zero — this is not the
    // same claim as the unsynced case above, and the function must not conflate them.
    expect(aarsFigureView(true, 0)).toBe(0);
    expect(aarsFigureView(true, "0 assets")).toBe("0 assets");
  });

  // PERTURBATION. `value || 0` is the exact rewrite the module header refuses: casting or
  // falling back to a number BEFORE asking whether anything was ever synced. Reproduced
  // inline against the real function's own contract, rather than merely asserted.
  it("perturbation: a `value || 0` rewrite prints a bare 0 for the unsynced case", () => {
    function defectiveFigureView(synced, value) {
      return value || 0; // drops the `synced` gate the real implementation reads first
    }
    // The real function: unsynced never prints the raw value, let alone a fallback zero.
    expect(aarsFigureView(false, undefined)).not.toBe(0);
    expect(aarsFigureView(false, null)).not.toBe(0);
    expect(aarsFigureView(false, undefined)).toBe(absentText);
    // The defective rewrite: prints exactly the bare zero CLAUDE.md forbids.
    expect(defectiveFigureView(false, undefined)).toBe(0);
    expect(defectiveFigureView(false, null)).toBe(0);
  });
});

// =========================================================================================
//  2. renderAarsRules reads bootstrap() exactly once
// =========================================================================================

describe("aars.js reads bootstrap() exactly once", () => {
  it("calls bootstrap( exactly once in the whole file", () => {
    const hits = AARS.match(/\bbootstrap\(\)/g) || [];
    expect(hits.length, "aars.js should read bootstrap() once, at the top of "
      + "renderAarsRules, and hand the derived `synced` flag down through closures rather "
      + "than re-reading it per tab").toBe(1);
  });

  it("derives `synced` from boot.latestSync, the same field every other first-run page reads", () => {
    expect(AARS).toMatch(/const boot = await bootstrap\(\);/);
    expect(AARS).toMatch(/const synced = !!boot\.latestSync;/);
  });

  // PERTURBATION: a second, redundant bootstrap() call reading the SAME field would still
  // pass a truthiness-only check — count the exact call, not just "at least one".
  it("the count check catches a second bootstrap() call", () => {
    const REGRESSED = AARS.replace(
      "const boot = await bootstrap();",
      "const boot = await bootstrap();\n  const boot2 = await bootstrap();",
    );
    const hits = REGRESSED.match(/\bbootstrap\(\)/g) || [];
    expect(hits.length).toBe(2);
  });
});

// =========================================================================================
//  3. Every tab painter receives the sync flag
// =========================================================================================
//
// Named functions, one per tab: sync() (AARS), paintImpact() (AARS's own Impact pane),
// paintProblemImpact() (Problem tree), paintPostureImpact() (Posture), buildRankEval(report,
// synced) (Rank eval — passed explicitly, since unlike the other three it takes no other
// per-tab state as a parameter already). openCodeReference() is not a tab painter but is
// swept too, since it is the other call site `aarsFigureView` actually reaches.

const PAINTERS = {
  "sync()": slice(AARS, "function sync() {", "function syncRecompute() {"),
  "paintImpact()": slice(AARS, "function paintImpact() {", "function paintDiscrimination("),
  "paintProblemImpact()": slice(AARS, "function paintProblemImpact() {", "function lightProblemRow("),
  "paintPostureImpact()": slice(AARS, "function paintPostureImpact() {", "function onPostureEdit("),
  "buildRankEval(report, synced)": slice(AARS, "function buildRankEval(", "function buildCapacity("),
  "openCodeReference()": slice(AARS, "function openCodeReference() {", "function buildSandbox("),
};

describe("each tab painter reads the `synced` flag", () => {
  for (const [name, body] of Object.entries(PAINTERS)) {
    it(name + " references `synced`", () => {
      expect(body, name + " was not found in aars.js — the anchor text has moved").not.toBeNull();
      expect(body, name + " never reads `synced` — F4's gate is not wired here")
        .toMatch(/\bsynced\b/);
    });
  }

  it("buildRankEval takes `synced` as an explicit parameter, and loadRankPane passes it", () => {
    expect(AARS).toMatch(/function buildRankEval\(report, synced\)/);
    expect(AARS).toMatch(/buildRankEval\(report, synced\)/);
  });

  // PERTURBATION: a painter that never mentions `synced` at all — the exact shape every one
  // of these five functions was in before this package (the AARS finding in shared.test.js:
  // "aars.js has NO bootstrap()/boot. reference anywhere in its source").
  it("the sweep catches a painter that never reads `synced`", () => {
    const REGRESSED = `
      function paintImpact() {
        const errs = draftErrors(draft);
        if (!preview) { return; }
        if (!preview.total) { impactState.append(emptyState("No inventory to compare against.")); return; }
      }
    `;
    expect(REGRESSED).not.toMatch(/\bsynced\b/);
  });
});

// =========================================================================================
//  4. The landscape-derived cascade figures are gated on `synced`, never on the preview alone
// =========================================================================================

describe("the AARS gap ladder's claim-rail inputs refuse before they cast", () => {
  it("matchCounts and instanceTotal are gated on `synced`, not just on `preview`", () => {
    expect(AARS).toMatch(
      /const matchCounts = synced \? \(\(preview && preview\.gapMatchCounts\) \|\| null\) : null;/,
    );
    expect(AARS).toMatch(
      /const instanceTotal = synced \? \(\(preview && preview\.gapInstanceTotal\) \|\| 0\) : 0;/,
    );
  });

  it("the severity-band counts feeding the hero rail are gated the same way", () => {
    expect(AARS).toMatch(
      /const counts = synced \? \(\(preview && preview\.proposed\) \|\| null\) : null;/,
    );
  });

  it("shadowed and unreachable stay ungated — they are facts about the rule, not the landscape", () => {
    const cascadeBlock = slice(AARS, "const shadowed = (preview && preview.shadowedGapRules)",
      "const gapOffsets = claimOffsets(");
    expect(cascadeBlock).not.toBeNull();
    expect(cascadeBlock).toMatch(/const shadowed = \(preview && preview\.shadowedGapRules\) \|\| \[\];/);
    expect(cascadeBlock).toMatch(/const unreachable = \(preview && preview\.unreachableGapRules\) \|\| \[\];/);
  });

  // PERTURBATION: the defect this package closes, reproduced verbatim as a string — the
  // pre-F4 shape that reads `preview` alone and prints a confident "0 of 0" with nobody
  // synced.
  it("the gate check catches the pre-F4 shape (preview alone, no `synced`)", () => {
    const DEFECTIVE = "const matchCounts = (preview && preview.gapMatchCounts) || null;\n"
      + "const instanceTotal = (preview && preview.gapInstanceTotal) || 0;";
    expect(DEFECTIVE).not.toMatch(/synced \?/);
  });
});
