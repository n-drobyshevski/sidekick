// The rail's freshness sentence — `syncCaption()` (gas_shared/ui/feedback.js) — and the guard
// that stops an app's `app.js` growing its own copy of the calculation back.
//
// THE THING THAT DRIFTED THREE WAYS. Before P8, gas's rail said "Last scan <datetime>" and
// appended " — N days ago" only once N reached 2 (so a scan an hour old showed no age at
// all); gas_ai had the identical day-only gate under the same em dash; gas_devsecops showed
// the datetime with no relative age at all. All three now call the one shared sentence
// builder. This contract is a SOURCE-TEXT sweep rather than a call into `renderScanZone`/
// `renderSyncZone` — those functions live inside each app's `createAppShell` closure and are
// never exported, by design (P5's shell split; see each app.js's own banner) — so the only
// thing a test can reach is the text of the module that calls them.
//
// `code()` (strips comments, string-aware) is imported from `emptyStates.js` rather than
// copied a fourth time — see that module's own header for why a naive line-comment stripper
// fails on this codebase specifically: every module here explains a rule by quoting it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { code } from "./emptyStates.js";

/** The exact shape every pre-P8 copy had: a Math.floor day count off two raw Date calls,
 *  with no minute/hour granularity underneath it. Catches a caption that grew its own
 *  calculation back, in any of the three files it once lived in independently. */
const INLINE_DAY_MATH = /Math\.floor\(\(Date\.now\(\)\s*-\s*Date\.parse\(/;

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 */
export function registerSyncCaptionContract(ctx) {
  const { describe, it, expect, app } = ctx;
  const root = fileURLToPath(ctx.appRoot);
  const APP_SRC = code(readFileSync(resolve(root, "src/client/js/app.js"), "utf8"));

  describe(app + ": the rail's freshness caption is the shared sentence, not a local copy", () => {
    it("app.js calls syncCaption() rather than building the sentence by hand", () => {
      expect(APP_SRC, "app.js never calls syncCaption() — see gas_shared/ui/feedback.js")
        .toMatch(/\bsyncCaption\(/);
    });

    it("carries no reintroduced Math.floor day-count — the pre-P8 shape in all three apps", () => {
      expect(APP_SRC, "app.js has grown its own Date.now()/Date.parse() day-count again")
        .not.toMatch(INLINE_DAY_MATH);
    });
  });
}
