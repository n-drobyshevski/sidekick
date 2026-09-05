// The seam itself: what an app is still allowed to keep a local copy of.
//
// A SHARED PACKAGE ONLY STAYS SHARED WHILE NOTHING FORKS BACK. The failure mode this guards
// is not dramatic — someone needs one line changed in `ui/data.js`, copies it back into
// `src/client/js/ui/`, and the app's own module quietly shadows the shared one for every
// import that resolves through `ui.js`. Nothing breaks; the two copies simply stop being one
// module, which is the exact condition this package was cut to end. Three registers had
// drifted that way before it existed: 19 of 23 modules byte-identical and four differing by
// a comment word, a localStorage prefix, an extra export and a re-export.
//
// So the allow-list is a LIST OF FILENAMES, not a rule about them. `projectScope.js` is on
// gas_devsecops's because it reads `src/domain/projectScope.ts` and means nothing in a
// sibling with no repositories. Anything else appearing beside it is the fork starting.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 * @param {string[]} ctx.localUiModules  the only files allowed under src/client/js/ui/
 * @param {string[]} ctx.sheetOrder      the @import specifiers of src/client/styles.css,
 *                                       in order
 * @param {string[]} [ctx.localSheets]   the subset of ctx.sheetOrder that is THIS app's own
 *                                       (the "./…" specifiers, not "../../../gas_shared/…").
 *                                       Optional: an app that has not enumerated its own
 *                                       sheets yet gets a named `it.skip` instead of a vacuous
 *                                       pass — see the "keeps only its declared local
 *                                       stylesheets" test below.
 */
export function registerParityContract(ctx) {
  const { describe, it, expect, app } = ctx;
  const root = fileURLToPath(ctx.appRoot);
  const uiDir = resolve(root, "src/client/js/ui");
  const jsDir = resolve(root, "src/client/js");

  describe(app + ": the shared core is not forked back into the app", () => {
    it("keeps only the allow-listed local modules under src/client/js/ui/", () => {
      const found = readdirSync(uiDir).filter((n) => n.endsWith(".js")).sort();
      expect(found, "a shared module has been copied back into " + app).toEqual(
        [...ctx.localUiModules].sort(),
      );
    });

    it("keeps no local api.js / store.js / icons.js", () => {
      // These three moved to the shared package root. A copy here would be picked up by any
      // relative import that still said "./store.js" and would carry its own module state —
      // a SECOND bootstrap cache and a second RPC cache, in an app that assumes one.
      for (const name of ["api.js", "store.js", "icons.js", "recordSections.js"]) {
        expect(existsSync(resolve(jsDir, name)),
          app + " still has a local src/client/js/" + name).toBe(false);
      }
    });

    it("keeps no local copy of the shell", () => {
      // THE SAME RULE ONE TIER UP, for the modules `gas_shared/shell/` took over. Two of
      // these had already forked in ways nothing caught: gas's `navFlyout.js` never called
      // portalOpened(), so its own sheet's focus trap did not stand down for it, and its
      // `brandMark.js` was a copy whose own header said it "should stay" a verbatim one — an
      // instruction, not a check. `navModel.js` carries module state per copy only in the
      // trivial sense, but `navFlyout.js` and `experimental.js` both hold LIVE STATE (the
      // pinned panel, the gate's cached flag), so a second copy is a second answer to the
      // same question.
      //
      // `routeIcons.js` is deliberately absent from this list: the marks are per register and
      // the manifest is how the shared shell reaches them. `experimental.js` is allowed to
      // exist only as a RE-EXPORT, because pages/ import it at their own relative depth —
      // the assertion below is on the content, not on the path.
      for (const name of ["navModel.js", "navFlyout.js", "brandMark.js", "uiIcons.js"]) {
        expect(existsSync(resolve(jsDir, name)),
          app + " has forked gas_shared/shell/" + name + " back into the app").toBe(false);
      }
      const gate = resolve(jsDir, "experimental.js");
      if (existsSync(gate)) {
        expect(readFileSync(gate, "utf8"),
          app + "'s experimental.js is an implementation, not a re-export of the shared gate")
          .toMatch(/export \{[^}]*\} from "[./]*gas_shared\/shell\/experimental\.js";/);
      }
    });

    it("reaches the shared core through the barrel, not module by module", () => {
      // ui.js is the app's end of the seam. It may add local modules; what it may not do is
      // stop re-exporting the shared barrel, which is how every page's `from "../ui.js"`
      // resolves.
      const UI = readFileSync(resolve(jsDir, "ui.js"), "utf8");
      expect(UI).toMatch(/export \* from "[./]*gas_shared\/ui\/index\.js";/);
    });

    it("defines relativeAge / syncCaption / absentText nowhere but gas_shared", () => {
      // THE FAILURE THE ALLOW-LIST ABOVE CANNOT SEE. A re-forked ui/figures.js would already
      // fail "keeps only the allow-listed local modules", but the pre-P8 defect was never a
      // second FILE — it was a private helper inline in pages/history.js (gas) and a second,
      // coarser inline calculation in each app's own rail caption (all three). Neither shows
      // up in a directory listing. So this sweeps every .js file this app ships for a
      // DECLARATION of one of these three names — not a usage, not an import, a declaration —
      // anywhere under src/client/js/, ui/ included.
      const FORKABLE = ["relativeAge", "syncCaption", "absentText"];
      /** @type {string[]} */
      const files = [];
      const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = resolve(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith(".js")) files.push(p);
        }
      };
      walk(jsDir);
      expect(files.length, app + ": the walk found no client .js files at all").toBeGreaterThan(0);

      const offenders = [];
      for (const file of files) {
        const src = readFileSync(file, "utf8");
        for (const name of FORKABLE) {
          const declared = new RegExp(
            "(function\\s+" + name + "\\s*\\(|\\b(?:const|let|var)\\s+" + name + "\\s*=)",
          );
          if (declared.test(src)) {
            offenders.push(file.slice(root.length).replace(/\\/g, "/") + " declares " + name);
          }
        }
      }
      expect(offenders, app + " has reforked a shared primitive back into a local declaration")
        .toEqual([]);
    });
  });

  describe(app + ": the stylesheet index imports the shared sheets in cascade order", () => {
    it("names them in exactly the documented order, overrides last", () => {
      const src = readFileSync(resolve(root, "src/client/styles.css"), "utf8");
      const imports = [...src.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
      expect(imports).toEqual(ctx.sheetOrder);
    });

    it("puts overrides.css last, which is what makes it an override", () => {
      // Reduced motion and the phone layout are the last word by position, not by
      // specificity. A sheet appended after it would silently outrank both.
      const src = readFileSync(resolve(root, "src/client/styles.css"), "utf8");
      const imports = [...src.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
      expect(imports[imports.length - 1]).toMatch(/overrides\.css$/);
    });

    it("puts tokens.base.css first, ahead of the app's own brand tokens.css", () => {
      // The z scale, the severity palette and the five-token accent shape all live in
      // tokens.base.css. An app's own tokens.css REDEFINES the five brand tokens on top of
      // it (--accent, --accent-text, …) — if the cascade ran the other way, the brand values
      // would win the specificity tie by being declared last and the base file's defaults
      // would be the ones actually painted. This is asserted against the REAL parsed
      // imports, not against ctx.sheetOrder: ctx.sheetOrder is supplied by the very same test
      // file this contract is guarding, so a wrong sheetOrder and a wrong styles.css could
      // agree with each other and this would be the only thing left to notice.
      const src = readFileSync(resolve(root, "src/client/styles.css"), "utf8");
      const imports = [...src.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
      expect(imports[0], app + "'s styles.css does not import tokens.base.css first")
        .toMatch(/tokens\.base\.css$/);
    });

    // The generalisation of a check gas's OWN test file used to carry as a duplicate describe
    // block ("until the parity contract can hold it" — see gas/test/shared.test.js history).
    // ctx.localSheets is optional: an app that has not enumerated its own sheets gets a named
    // skip rather than a check that vacuously passes on an empty expectation. The skip/run
    // choice has to be made HERE, at registration time — vitest's own `it.skip` cannot be
    // called from inside a running `it`.
    if (ctx.localSheets) {
      it("keeps only its declared local stylesheets — every other sheet is shared", () => {
        const src = readFileSync(resolve(root, "src/client/styles.css"), "utf8");
        const imports = [...src.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);
        const local = imports.filter((p) => p.startsWith("./"));
        expect(local, app + ": local stylesheets drifted from ctx.localSheets")
          .toEqual(ctx.localSheets);
      });
    } else {
      it.skip(app + " keeps only its declared local stylesheets — SKIPPED: no ctx.localSheets "
        + "given", () => {});
    }

    it("resolves every one of them to a file that exists", () => {
      const indexPath = resolve(root, "src/client/styles.css");
      const src = readFileSync(indexPath, "utf8");
      const base = resolve(indexPath, "..");
      for (const m of src.matchAll(/@import\s+"([^"]+)"/g)) {
        expect(existsSync(resolve(base, m[1])),
          "styles.css imports " + m[1] + ", which does not exist").toBe(true);
      }
    });
  });
}
