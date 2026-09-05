// One page, one `<h1>`, and only a full-bleed route may write its own.
//
// `ui/controls.js`'s `heroStat` makes the hero's LABEL the page's h1, and `pageHeader` is
// how a route gets one. Before that block existed every page hand-rolled its title, and the
// habit outlived the component: gas_ai still had five bare `el("h1", …)` sites after the
// unification wave had converted everything else, and the wave's own scorecard could only
// record "page-header pattern ✗" beside a prose note guessing at which of them were
// exceptions.
//
// THEY ARE NOT A JUDGEMENT — THEY ARE A PROPERTY OF THE ROUTE, and that is what this file
// turns into a check. The two gas_ai pages that keep their own heading (`graph`, `aars`) are
// exactly the two whose PAGES entry carries `fullBleed: true`. A full-bleed route owns the
// whole content pane, and both put their `h1.workbench-title` inside a `.workbench-bar` — a
// full-width flex toolbar carrying search, tabs and actions BESIDE the title. That is not
// the hero-and-stats grid `pageHeader` draws; converting it would be a redesign, not a
// sweep. So:
//
//   a route may render its own el("h1") ONLY IF its PAGES entry declares fullBleed: true.
//
// The rule is derivable from each app's own PAGES rather than from a list typed here, which
// is what makes it hold in all three registers at once — `gas` and `gas_devsecops` have zero
// bare h1 and zero full-bleed routes, so the rule is satisfied there by both halves being
// empty, and it starts biting the moment either grows.
//
// THE SWEEP IS THE WHOLE CLIENT, not the route modules alone. `pages/` also holds page
// HELPERS that no route names — gas_ai's `problemView.js`, `comboView.js`, `configView.js`
// are each rendered by a route module beside them — so a scan restricted to
// `pages/<route>.js` would be walked around by moving the heading one file sideways. Every
// `.js` under `src/client/js/` is read instead, and an h1 found anywhere but in a full-bleed
// route's OWN module fails.
//
// WHY HERE AND NOT IN navGroups.js OR parity.js. `navGroups.js` is the information
// architecture — what the rail draws from PAGES — and this says nothing about the rail.
// `parity.js` is the seam: which files an app may still keep a local copy of. This is a
// COMPONENT contract, the shape `brandMark.js` and `emptyStates.js` already have: one shared
// component, the rule for using it, held per app. It reads PAGES through `parsePages`
// EXPORTED FROM navGroups.js rather than parsing app.js a second time — one parser, two
// contracts.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";

import { parsePages } from "./navGroups.js";

/**
 * Blank out the comment prose so a page DESCRIBING `el("h1", …)` is not read as one
 * rendering it — three of gas_ai's converted pages now carry exactly that sentence, and
 * `compliance.js` has carried it since P8.
 *
 * Deliberately conservative in ONE direction: block comments and WHOLE-LINE `//` comments
 * go, a trailing comment on a code line stays. A guard that misses a real h1 is the silent
 * pass these contracts exist to prevent, so the residue errs toward flagging something a
 * human then reads, never toward quietly finding nothing.
 */
export function stripCommentProse(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

/** Every `el("h1"` / `el('h1'` left once the prose is gone, with its 1-based line number. */
export function findOwnHeadings(src) {
  const out = [];
  stripCommentProse(src).split("\n").forEach((line, i) => {
    if (/\bel\(\s*["']h1["']/.test(line)) out.push(i + 1);
  });
  return out;
}

/** Every .js file under `dir`, recursively, absolute. */
function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 * @param {string}   [ctx.skipReason]  Register the rule as a NAMED skip instead of running
 *                                 it, for an app that legitimately differs (client modules
 *                                 not under src/client/js/, routes whose modules are not
 *                                 pages/<route>.js, a register that has not adopted
 *                                 pageHeader yet). The reason shows in the run summary — a
 *                                 silent pass is the failure mode this whole file exists to
 *                                 prevent, so an app that cannot run the rule says why.
 */
export function registerPageHeaderContract(ctx) {
  const { describe, it, expect, app } = ctx;
  const root = fileURLToPath(ctx.appRoot);

  describe(app + ": the page header", () => {
    if (ctx.skipReason) {
      it.skip(app + ": only a fullBleed route may render its own h1 — SKIPPED: "
        + ctx.skipReason, () => {});
      return;
    }

    const jsDir = resolve(root, "src/client/js");
    const APP = readFileSync(resolve(jsDir, "app.js"), "utf8");
    const PAGES = parsePages(APP);
    // The route modules that ARE allowed a heading, by absolute path.
    const exempt = new Map(PAGES.filter((p) => p.fullBleed)
      .map((p) => [resolve(jsDir, "pages", p.route + ".js"), p.route]));
    // Read once, here, so every assertion below sees the same scan.
    const files = jsFilesUnder(jsDir);
    const scan = files.map((file) => ({
      file,
      rel: relative(root, file).replace(/\\/g, "/"),
      headings: findOwnHeadings(readFileSync(file, "utf8")),
    }));

    it("reads the whole client — an unread tree cannot fail the rule below", () => {
      // THE ANTI-VACUOUS HALF, and this package has been bitten three times by the guard
      // that fires on nothing. A renamed directory or a moved PAGES table leaves the sweep
      // below scanning an empty list and passing without ever having looked.
      expect(PAGES.length, app + ": PAGES parsed to no routes at all").toBeGreaterThan(0);
      expect(scan.length, app + ": no .js files found under " + jsDir).toBeGreaterThan(0);
      for (const p of PAGES) {
        const file = resolve(jsDir, "pages", p.route + ".js");
        expect(existsSync(file), app + ": no module at " + file + " for route " + p.route)
          .toBe(true);
      }
    });

    it("lets only a fullBleed route render its own h1 — every other page uses pageHeader",
      () => {
        const offenders = scan
          .filter((s) => s.headings.length && !exempt.has(s.file))
          .map((s) => s.rel + ":" + s.headings.join(","));
        expect(
          offenders,
          app + ": these render their own el(\"h1\") without a fullBleed PAGES entry to "
            + "justify it. Use pageHeader({ hero: heroStat(<lane>, <title>, <sub>) }) — "
            + "heroStat's label IS the page h1 — or, if the route genuinely owns the whole "
            + "content pane, declare it fullBleed: true in PAGES.",
        ).toEqual([]);
      });

    it("gives a fullBleed route the heading it is trusted with, rather than none", () => {
      // The other direction, and the reason `fullBleed` is the right key rather than an
      // allow-list of route names: the flag is an EXEMPTION from pageHeader, so a full-bleed
      // route that renders neither a pageHeader hero nor its own h1 has no h1 at all, which
      // is the heading-order defect heroStat's own header was written to end. Vacuous in a
      // register with no full-bleed route, on purpose: there is nothing there to exempt.
      for (const [file, route] of exempt) {
        const src = readFileSync(file, "utf8");
        const own = findOwnHeadings(src).length > 0;
        const header = /pageHeader\s*\(/.test(stripCommentProse(src));
        expect(
          own || header,
          app + ": route " + route + " is fullBleed but renders neither its own h1 nor a "
            + "pageHeader — the page would have no h1 at all",
        ).toBe(true);
      }
    });
  });
}
