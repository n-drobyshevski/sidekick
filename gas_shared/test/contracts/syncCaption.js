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
 * @param {boolean}  [ctx.railHasSyncZone]  Default `true`: this app's rail carries a
 *   freshness sentence, so `app.js` must build it with the shared `syncCaption()`.
 *
 *   PASS `false` ONLY FOR AN APP WITH NO SYNC ZONE AT ALL — one that hands `createAppShell`
 *   no `railFooter` and therefore has no freshness sentence to build, correctly or otherwise.
 *   `gas_hub` is the case this was added for: a launcher over the three registers, it runs no
 *   scan and no sync, reads no register's data, and has nothing whose age it could report. The
 *   first assertion then becomes a NAMED skip so the run summary says why it did not run —
 *   a silent pass would read as "this app calls syncCaption()", which is the opposite of true.
 *
 *   THE SECOND ASSERTION KEEPS RUNNING EITHER WAY, and that is the point of skipping only the
 *   first. "Never grow your own Math.floor day-count" is a prohibition, and a prohibition is
 *   exactly the kind of rule an app with no caption today can still break tomorrow — the
 *   pre-P8 defect was an inline calculation appearing in an app.js, not a missing call.
 */
export function registerSyncCaptionContract(ctx) {
  const { describe, it, expect, app } = ctx;
  const root = fileURLToPath(ctx.appRoot);
  const APP_SRC = code(readFileSync(resolve(root, "src/client/js/app.js"), "utf8"));
  const railHasSyncZone = ctx.railHasSyncZone !== false;

  describe(app + ": the rail's freshness caption is the shared sentence, not a local copy", () => {
    if (railHasSyncZone) {
      it("app.js calls syncCaption() rather than building the sentence by hand", () => {
        expect(APP_SRC, "app.js never calls syncCaption() — see gas_shared/ui/feedback.js")
          .toMatch(/\bsyncCaption\(/);
      });
    } else {
      it.skip(
        app + " calls syncCaption() rather than building the sentence by hand — SKIPPED: this "
        + "app passes createAppShell no railFooter and has no freshness sentence at all. It "
        + "runs no scan and no sync and reads no register's data, so there is no last-read "
        + "timestamp for a caption to date. The Math.floor prohibition below still runs.",
        () => {},
      );
    }

    it("carries no reintroduced Math.floor day-count — the pre-P8 shape in all three apps", () => {
      expect(APP_SRC, "app.js has grown its own Date.now()/Date.parse() day-count again")
        .not.toMatch(INLINE_DAY_MATH);
    });
  });
}
