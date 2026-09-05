// The product mark exists TWICE per app, and this is what keeps the copies one drawing.
//
// The static `index.html` paints the splash before a single byte of JavaScript has run —
// that is the whole point of it — so its mark has to be literal markup. `ui/brandMark.js`
// draws the same mark for every other surface, including the splash that refresh() rebuilds
// a second later.
//
// THE STATIC HALF IS NOW RENDERED, NOT AUTHORED. The three `src/client/index.html` files
// were byte-identical apart from two words, so they are one template
// (`gas_shared/shell/index.template.html`) filled in from each app's own MANIFEST at build
// time. The assertions below therefore read what the BUILD EMITS
// (`gas_shared/shell/renderIndex.js`) rather than a checked-in file — the same claims,
// against the bytes GAS actually serves.
//
// Two hand-kept copies of 5 KB of path data is exactly the kind of thing that drifts
// silently: change the shield in the module and the first paint keeps the old one for as long
// as it takes anyone to notice a shape flicker on reload. So the module's exported constants
// are the source, and the assertions below require the rendered markup to carry them
// verbatim. A duplication forced by the platform, pinned by a test rather than by a comment.
//
// AND THE SPLASH COPY, which is the half no app was checking. The splash says the product's
// name and what it is opening, in three places (the static markup twice, bootSplash() once),
// and gas_devsecops shipped "Opening the graph…" for its whole life — inherited from the
// sibling it was forked from, over a register that has no graph. Copy that only ever renders
// for 400ms is exactly the copy nobody re-reads, so the manifest states it once and this
// holds every surface to it. Two of those three copies are now STRUCTURALLY the manifest's
// (the template is filled in from it; bootSplash() reads appConfig()), so what is left to
// check is that the manifest itself says what this register's own test file says it does.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { renderIndexHtml } from "../../shell/renderIndex.js";
import {
  MARK_CHECK, MARK_CHECK_WIDTH, MARK_COMPACT_RATIO, MARK_COMPACT_VIEWBOX, MARK_DOTS_BLUE,
  MARK_DOTS_RED, MARK_NODES, MARK_ORBIT, MARK_ORBIT_WIDTH, MARK_SHIELD, MARK_VIEWBOX,
  brandMark,
} from "../../ui/brandMark.js";

/**
 * A four-method stand-in for `document`, because vitest runs in node here and these apps
 * have no jsdom.
 *
 * That is not a workaround — it is the right instrument. What is worth pinning about
 * `brandMark()` is the ATTRIBUTES it sets: the sizing contract, and which copy carries the
 * accessible name. A real DOM would add nothing to either assertion and a browser-shaped
 * dependency to the whole suite; the pixels are checked in the dev harness. `svgEl`
 * stringifies every value before setting it, so the shim stores strings and `getAttribute`
 * returns null for what was never set — the two behaviours the assertions lean on.
 */
function makeNode(tag) {
  return {
    tag, attrs: {}, children: [],
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    append(...kids) { this.children.push(...kids); },
    querySelectorAll(sel) { return this.children.filter((c) => c.tag === sel); },
    querySelector(sel) { return this.children.find((c) => c.tag === sel) || null; },
  };
}

/**
 * Path data with its layout normalised away. The static copy wraps `d` across lines so the
 * file stays readable; SVG treats that whitespace as a separator, and so does this. Spaces
 * that sit before a command letter are separators and go; the space INSIDE a coordinate
 * pair ("M45.97 1.76") is data and stays, which is what keeps a moved decimal point a
 * failure rather than a wash.
 */
function normPath(d) {
  return d.replace(/\s+/g, " ").replace(/ (?=[A-Za-z])/g, "").trim();
}

/**
 * @param {object}   ctx
 * @param {Function} ctx.describe
 * @param {Function} ctx.it
 * @param {Function} ctx.expect
 * @param {Function} ctx.beforeAll
 * @param {Function} ctx.afterAll
 * @param {URL}      ctx.appRoot
 * @param {string}   ctx.app
 * @param {string}   ctx.productName  the manifest's own name for the product
 * @param {string}   ctx.openingNoun  the manifest's own word for what the splash opens
 */
export function registerBrandMarkContract(ctx) {
  const { describe, it, expect, beforeAll, afterAll, app } = ctx;
  const root = fileURLToPath(ctx.appRoot);
  const INDEX = renderIndexHtml(root);
  const APP = readFileSync(resolve(root, "src/client/js/app.js"), "utf8");
  // The shell's own copy of the splash, which is shared by all three apps and is the half
  // that has to read the manifest rather than repeat a literal.
  const SPLASH = readFileSync(
    fileURLToPath(new URL("../../shell/bootSplash.js", import.meta.url)), "utf8",
  );
  // The other shared call site: the app header's compact crop.
  const APPBAR = readFileSync(
    fileURLToPath(new URL("../../shell/appbar.js", import.meta.url)), "utf8",
  );

  let realDocument;
  beforeAll(() => {
    realDocument = globalThis.document;
    globalThis.document = { createElementNS: (_ns, tag) => makeNode(tag) };
  });
  afterAll(() => {
    globalThis.document = realDocument;
  });

  const staticPaths = () =>
    [...INDEX.matchAll(/\sd="([^"]*)"/g)].map((m) => normPath(m[1]));

  describe(app + ": the static splash mark is the module's mark", () => {
    it("carries the same five path constants, in the same order", () => {
      expect(staticPaths()).toEqual([
        normPath(MARK_DOTS_BLUE), normPath(MARK_DOTS_RED),
        normPath(MARK_ORBIT), normPath(MARK_SHIELD), normPath(MARK_CHECK),
      ]);
    });

    it("carries the same two orbit nodes", () => {
      const circles = [...INDEX.matchAll(
        /<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/g,
      )].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
      expect(circles).toEqual(MARK_NODES);
    });

    it("draws in the full frame, not the compact crop", () => {
      // The splash is the one surface big enough for the globe; a compact viewBox here would
      // silently crop 307 dots out of the only place they are legible.
      expect(INDEX).toContain('viewBox="' + MARK_VIEWBOX + '"');
      expect(INDEX).not.toContain(MARK_COMPACT_VIEWBOX);
    });

    it("keeps the literal hex on the presentation attributes", () => {
      // index.html paints before the stylesheet is guaranteed to have applied, so the tokens
      // are an override, never the only source of the colour.
      for (const hex of ["#5cb2e3", "#f32b2b", "#0a0a0a", "#ffffff"]) {
        expect(INDEX, hex + " missing from the static mark").toContain(hex);
      }
    });
  });

  describe(app + ": the splash says what this product is", () => {
    it("names the product on the static first paint and on the rebuilt one", () => {
      expect(INDEX, "the rendered splash label is not the manifest's product name")
        .toContain(">" + ctx.productName + "<");
      // THE MANIFEST IS WHERE THE NAME IS DECLARED, and this is the assertion that can still
      // fail: the template is filled in from `MANIFEST.productName`, so the two static copies
      // agree with each other by construction — what they cannot do on their own is agree
      // with what this register's test file says the product is called.
      expect(APP, "app.js's MANIFEST does not declare productName: " + ctx.productName)
        .toContain('productName: "' + ctx.productName + '"');
      // And the runtime copy reads the manifest rather than repeating the string, which is
      // what stops the pair drifting the way the "Opening the graph…" one did.
      expect(SPLASH).toMatch(/boot-brand-label"\s*\},\s*productName/);
    });

    it("says it is opening the thing the manifest says it is", () => {
      expect(INDEX, "the rendered splash note names the wrong noun")
        .toContain("Opening the " + ctx.openingNoun + "…");
      expect(INDEX, "the progressbar's accessible name names the wrong noun")
        .toContain('aria-label="Opening the ' + ctx.openingNoun + '"');
      expect(APP, "app.js's MANIFEST does not declare openingNoun: " + ctx.openingNoun)
        .toContain('openingNoun: "' + ctx.openingNoun + '"');
      expect(SPLASH).toMatch(/"Opening the " \+ openingNoun/);
    });

    it("tells a reader with JavaScript off which product refused to start", () => {
      const noscript = INDEX.slice(INDEX.indexOf("<noscript>"), INDEX.indexOf("</noscript>"));
      expect(noscript, "<noscript> does not name the product").toContain(ctx.productName);
    });
  });

  describe(app + ": the geometry cannot carry the middlebox hazard", () => {
    // Why the mark is traced paths rather than the 955 KB PNG it came from: base64 contains
    // `/`, an SSL-inspecting proxy has been seen truncating served lines at a bare `//`, and
    // index.html is served but NOT scanned by esbuild.config.mjs's guard. This is that scan,
    // for the one file the build cannot cover.
    const data = [MARK_DOTS_BLUE, MARK_DOTS_RED, MARK_ORBIT, MARK_SHIELD, MARK_CHECK];

    it("holds no bare double slash in any path constant", () => {
      for (const d of data) expect(d.includes("/" + "/")).toBe(false);
    });

    it("holds no backtick, which esbuild cannot lower inside a string", () => {
      for (const d of data) expect(d).not.toContain(String.fromCharCode(96));
    });

    it("leaves no double slash in the static markup outside its own prose", () => {
      const body = INDEX.slice(INDEX.indexOf("<body>")).replace(/<!--[\s\S]*?-->/g, "");
      expect(body.includes("/" + "/")).toBe(false);
    });
  });

  describe(app + ": the dot globe", () => {
    const dots = (d) => d.split("M").length - 1;

    it("is 307 dots, 210 cool and 97 warm, as traced", () => {
      expect(dots(MARK_DOTS_BLUE)).toBe(210);
      expect(dots(MARK_DOTS_RED)).toBe(97);
    });

    it("is built entirely of zero-length subpaths", () => {
      // `M x y h0` + stroke-linecap:round is SVG 1.1 s11.4's normative "renders a circle".
      // Anything else in these strings is a stray edit, and would draw a line.
      for (const d of [MARK_DOTS_BLUE, MARK_DOTS_RED]) {
        expect(d).toMatch(/^(M-?[\d.]+ -?[\d.]+h0)+$/);
      }
    });

    it("stays inside the frame", () => {
      for (const d of [MARK_DOTS_BLUE, MARK_DOTS_RED]) {
        for (const [, x, y] of d.matchAll(/M([\d.]+) ([\d.]+)h0/g)) {
          expect(Number(x)).toBeGreaterThan(0);
          expect(Number(x)).toBeLessThan(96);
          expect(Number(y)).toBeGreaterThan(0);
          expect(Number(y)).toBeLessThan(96);
        }
      }
    });
  });

  describe(app + ": brandMark()", () => {
    it("draws the globe at full size and drops it when compact", () => {
      expect(brandMark(96).querySelectorAll("path").length).toBe(5);
      // Compact keeps orbit + shield + check and loses the two dot paths: 307 dots inside a
      // 20px glyph are a third of a pixel each.
      expect(brandMark(20, { compact: true }).querySelectorAll("path").length).toBe(3);
    });

    it("crops rather than redraws — compact is the same geometry, a different viewBox", () => {
      const compact = brandMark(20, { compact: true });
      expect(compact.getAttribute("viewBox")).toBe(MARK_COMPACT_VIEWBOX);
      expect(compact.querySelector("path").getAttribute("d")).toBe(MARK_ORBIT);
    });

    it("sizes by HEIGHT, so the two variants are interchangeable beside a line of text", () => {
      expect(brandMark(112).getAttribute("width")).toBe("112");
      const compact = brandMark(28, { compact: true });
      expect(compact.getAttribute("height")).toBe("28");
      expect(Number(compact.getAttribute("width")))
        .toBeCloseTo(28 * MARK_COMPACT_RATIO, 1);
    });

    it("is decorative unless given a label, and never both", () => {
      const plain = brandMark(20, { compact: true });
      expect(plain.getAttribute("aria-hidden")).toBe("true");
      expect(plain.getAttribute("role")).toBe(null);
      const named = brandMark(28, { compact: true, label: ctx.productName });
      expect(named.getAttribute("aria-hidden")).toBe(null);
      expect(named.getAttribute("role")).toBe("img");
      expect(named.getAttribute("aria-label")).toBe(ctx.productName);
    });

    it("is never focusable — it is a picture, not a control", () => {
      expect(brandMark(96).getAttribute("focusable")).toBe("false");
    });
  });

  describe(app + ": the standalone pages carry the mark a THIRD time", () => {
    // src/server/pageShell.ts draws the denial page and the entry screen, and it is in the
    // SERVER bundle — it cannot import ui/brandMark.js across that line (tsc's allowJs is
    // off, and the module reaches document.createElementNS through uiIcons.js, which would
    // put a DOM module in doGet's graph). So the geometry is copied, and the copy is held
    // here, exactly as index.html's is above.
    const SHELL = readFileSync(resolve(root, "src/server/pageShell.ts"), "utf8");

    it("carries the compact crop's path constants verbatim", () => {
      // Concatenated across lines in the .ts source the same way the module concatenates
      // them, so compare on the JS string values rather than on the literal text.
      const shellPaths = [...SHELL.matchAll(/"((?:M|C)[^"]*)"/g)].map((m) => m[1]);
      const joined = shellPaths.join("");
      const pairs = [["orbit", MARK_ORBIT], ["shield", MARK_SHIELD], ["check", MARK_CHECK]];
      for (const [name, d] of pairs) {
        expect(joined.replace(/\s+/g, ""), name).toContain(d.replace(/\s+/g, ""));
      }
    });

    it("uses the COMPACT crop, so the 307-dot globe never ships on a two-sentence card", () => {
      expect(SHELL).toContain(MARK_COMPACT_VIEWBOX);
      expect(SHELL).not.toContain(MARK_VIEWBOX);
      // The globe is the expensive half — ~5 KB against ~500 bytes — and the crop leaves it
      // out.
      expect(SHELL).not.toContain(MARK_DOTS_BLUE.slice(0, 40));
      expect(SHELL).not.toContain(MARK_DOTS_RED.slice(0, 40));
    });

    it("carries the same two orbit nodes and the same ratio", () => {
      const circles = [...SHELL.matchAll(/\[([\d.]+), ([\d.]+), ([\d.]+)\]/g)]
        .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
      expect(circles).toEqual(MARK_NODES);
      expect(SHELL).toContain("52.7 / 74");
      expect(MARK_COMPACT_RATIO).toBeCloseTo(52.7 / 74, 10);
    });

    it("keeps the literal hex on the presentation attributes", () => {
      // Same reason index.html does: these pages ship no stylesheet of their own beyond the
      // handful of card rules, and the mark must draw with nothing behind it.
      expect(SHELL).toContain('fill="#0a0a0a"');
      expect(SHELL).toContain('stroke="#ffffff"');
    });

    it("holds no bare double slash — the pages are served verbatim, never scanned", () => {
      // esbuild.config.mjs's middlebox guard covers the client bundle. pageShell.ts is
      // compiled into the SERVER bundle, which that guard does not scan.
      for (const d of [MARK_ORBIT, MARK_SHIELD, MARK_CHECK]) {
        expect(d).not.toContain("//");
      }
    });

    // The two claims below came from gas's own local brandMark.test.js, which this contract
    // superseded when gas stopped forking `ui/brandMark.js`. They were true of all three
    // pageShell.ts files and asserted in only one, so promoting them costs nothing and the
    // other two registers gain a pin they never had.
    it("carries the same two stroke widths, not a hand-typed pair", () => {
      // The geometry above would draw correctly at any weight; these are what make the
      // standalone card's mark the same WEIGHT as the app's, not just the same shape.
      expect(SHELL, "the orbit stroke width has drifted").toContain(String(MARK_ORBIT_WIDTH));
      expect(SHELL, "the check stroke width has drifted").toContain(String(MARK_CHECK_WIDTH));
    });

    it("keeps the mark decorative, because the wordmark is beside it", () => {
      expect(SHELL).toContain('aria-hidden="true"');
      expect(SHELL, "the standalone card labels a mark that already has its name in text")
        .not.toMatch(/aria-label/);
    });
  });

  describe(app + ": the shell's call sites", () => {
    it("labels no mark, because every one of them sits beside the name in text", () => {
      // Both surviving marks (the header's and the splash's) have the words beside them, and
      // a labelled one would announce the product name twice in the same landmark. Both call
      // sites are in the SHARED shell now, so the sweep reads those rather than app.js — an
      // app that has no `brandMark(` left in it would otherwise pass this vacuously.
      const callers = APP + SPLASH + APPBAR;
      expect(callers, "no brandMark() call site found — the sweep below would be vacuous")
        .toContain("brandMark(");
      expect([...callers.matchAll(/brandMark\([^)]*label:/g)].length).toBe(0);
    });

    it("still carries the static splash's twin", () => {
      expect(SPLASH).toMatch(/boot-brand[\s\S]{0,120}brandMark\(112\)/);
      expect(INDEX).toContain('width="112" height="112"');
    });

    it("puts the compact crop in the header, where 307 dots would be noise", () => {
      expect(APPBAR).toMatch(/brandMark\(22,\s*\{\s*compact:\s*true\s*\}\)/);
    });
  });
}
