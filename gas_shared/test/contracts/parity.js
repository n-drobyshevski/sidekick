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

    it("reaches the shared core through the barrel, not module by module", () => {
      // ui.js is the app's end of the seam. It may add local modules; what it may not do is
      // stop re-exporting the shared barrel, which is how every page's `from "../ui.js"`
      // resolves.
      const UI = readFileSync(resolve(jsDir, "ui.js"), "utf8");
      expect(UI).toMatch(/export \* from "[./]*gas_shared\/ui\/index\.js";/);
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
