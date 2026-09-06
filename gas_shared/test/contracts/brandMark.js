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
// AND THE MARK NOW MOVES, which adds a third thing to keep in lockstep. base.css animates the
// splash copy with one composed `bm-*` timeline; the ring and the check are traced in
// path-length units, so BOTH copies of the markup have to carry `pathLength="1"` or the
// runtime one renders a dotted ring on refresh() and only there; and the 97 alert dots are
// dealt into six phase groups at runtime by TWO hand-kept implementations — `dealAlerts()` in
// ui/brandMark.js and an inline script in the template, because that copy paints before the
// module exists. So this file also holds, below: the attribute in both copies, that every
// `bm-` rule is scoped under `.boot-splash ` (the appbar wears the same classes) and named in
// the reduced-motion block, that the two dealers produce the SAME six paths from one stubbed
// random, and that the inline script cannot carry the middlebox hazard the bundle's own guard
// covers and this file's bytes escape.
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
import { runInNewContext } from "node:vm";
import { renderIndexHtml } from "../../shell/renderIndex.js";
import { stylesheetClosure } from "./tokens.js";
import { code } from "./emptyStates.js";
import { SVG_NS } from "../../icons.js";
import {
  ALERT_GROUPS, MARK_CHECK, MARK_CHECK_WIDTH, MARK_COMPACT_RATIO, MARK_COMPACT_VIEWBOX,
  MARK_DOTS_BLUE, MARK_DOTS_RED, MARK_DOT_WIDTH, MARK_NODES, MARK_ORBIT, MARK_ORBIT_WIDTH,
  MARK_SHIELD, MARK_VIEWBOX, brandMark, dealAlerts,
} from "../../ui/brandMark.js";

/**
 * A stand-in for `document`, because vitest runs in node here and these apps have no jsdom.
 *
 * That is not a workaround — it is the right instrument. What is worth pinning about
 * `brandMark()` is the ATTRIBUTES it sets: the sizing contract, and which copy carries the
 * accessible name. A real DOM would add nothing to either assertion and a browser-shaped
 * dependency to the whole suite; the pixels are checked in the dev harness. `svgEl`
 * stringifies every value before setting it, so the shim stores strings and `getAttribute`
 * returns null for what was never set — the two behaviours the assertions lean on.
 *
 * IT GREW FOR THE DEALER, and only by what the dealer touches: `parentNode` /
 * `insertBefore` / `removeChild` (dealAlerts splices six paths in where one was),
 * `attributes` and `namespaceURI` (the template's inline twin copies the original's
 * attributes and reads the namespace off the node rather than spelling the URL, which is
 * what keeps a bare double slash out of a file nothing scans), and a class-aware
 * `querySelector`. `querySelectorAll`'s existing semantics are untouched — DIRECT CHILDREN
 * ONLY, which is what three path-count assertions lean on and the reason nothing in the mark
 * may be wrapped in a `<g>`.
 */
function matchesSel(node, sel) {
  if (sel.startsWith(".")) {
    return String(node.attrs["class"] || "").split(/\s+/).includes(sel.slice(1));
  }
  return node.tag === sel;
}

function makeNode(tag, ns) {
  return {
    tag, ns, attrs: {}, children: [], parentNode: null,
    get namespaceURI() { return this.ns; },
    // A NamedNodeMap only as far as the inline dealer reads one: `.length`, `.name`, `.value`.
    get attributes() {
      return Object.keys(this.attrs).map((name) => ({ name, value: this.attrs[name] }));
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    append(...kids) {
      for (const kid of kids) { kid.parentNode = this; this.children.push(kid); }
    },
    insertBefore(node, ref) {
      const at = this.children.indexOf(ref);
      node.parentNode = this;
      this.children.splice(at === -1 ? this.children.length : at, 0, node);
      return node;
    },
    removeChild(node) {
      const at = this.children.indexOf(node);
      if (at !== -1) this.children.splice(at, 1);
      node.parentNode = null;
      return node;
    },
    querySelectorAll(sel) { return this.children.filter((c) => matchesSel(c, sel)); },
    querySelector(sel) { return this.children.find((c) => matchesSel(c, sel)) || null; },
  };
}

/**
 * A seeded generator standing in for `Math.random`, so the two dealers can be compared at
 * all. Numerical Recipes' LCG: the specific constants do not matter, being REPLAYABLE does.
 */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * CSS with its comments already gone, flattened into `{ sel, body }` pairs — the nested rules
 * of an at-rule included, and the at-rule itself kept too.
 *
 * Hand-rolled rather than a parser dependency: the two sweeps below ask only "which selectors
 * carry this declaration", and a real parser would be a build dependency in three apps to
 * answer it.
 */
function cssRules(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const sel = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    out.push({ sel, body: css.slice(open + 1, j - 1) });
    if (sel.startsWith("@")) out.push(...cssRules(css.slice(open + 1, j - 1)));
    i = j;
  }
  return out;
}

/** A rule's selectors, one per comma, trimmed. */
function selectorsOf(rule) {
  return rule.sel.split(",").map((x) => x.trim()).filter(Boolean);
}

/**
 * Every selector inside a `prefers-reduced-motion` block of this sheet that a rule declaring
 * `animation: none` carries. EXACT STRINGS, no normalisation — see the sweeps below for why
 * that is the whole point.
 */
function stoodDown(css) {
  const out = new Set();
  for (const block of cssRules(css)) {
    if (!/^@media/.test(block.sel) || !/prefers-reduced-motion/.test(block.sel)) continue;
    for (const rule of cssRules(block.body)) {
      if (!/animation:\s*none/.test(rule.body)) continue;
      for (const sel of selectorsOf(rule)) out.add(sel);
    }
  }
  return out;
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

  // The base.css THIS APP ACTUALLY IMPORTS, followed through src/client/styles.css rather
  // than named — the sheets live in two trees now and a hard-coded path would quietly stop
  // covering the one that ships. The match is anchored on a path separator because
  // `tokens.base.css` also ends in "base.css" and carries none of these rules.
  const SHEETS = stylesheetClosure(resolve(root, "src/client/styles.css"));
  const BASE_ENTRY = SHEETS.find(([spec]) => /(^|\/)base\.css$/.test(spec));
  if (!BASE_ENTRY) throw new Error(app + ": no base.css in the stylesheet closure");
  const BASE_CSS = BASE_ENTRY[1].replace(/\/\*[\s\S]*?\*\//g, "");

  // The template's inline dealer, as the build emits it. Located by the splash mark's own
  // </svg> so a script added elsewhere in the document could never answer for it.
  const INLINE = (() => {
    const after = INDEX.slice(INDEX.indexOf("</svg>"));
    const m = after.match(/<script>([\s\S]*?)<\/script>/);
    return m ? m[1] : null;
  })();

  /** Every `<path …>` tag in the rendered index, keyed by its normalised `d`. */
  const staticPathTags = () => {
    const byPath = new Map();
    for (const [tag] of INDEX.matchAll(/<path[^>]*>/g)) {
      const d = tag.match(/\sd="([^"]*)"/);
      if (d) byPath.set(normPath(d[1]), tag);
    }
    return byPath;
  };

  let realDocument;
  beforeAll(() => {
    realDocument = globalThis.document;
    globalThis.document = { createElementNS: (ns, tag) => makeNode(tag, ns) };
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

    // The sweep above now has a `<script>` inside it to cover, and that script is the one
    // piece of executable JavaScript in this document esbuild never sees: renderIndex.js
    // substitutes two words and passes the file through, so neither the bundle's middlebox
    // guard nor its template-literal lowering applies to it. Both constraints are therefore
    // assertions rather than build steps. The namespace is the specific hazard — the SVG
    // namespace URL IS a bare double slash — which is why the script reads it off the node it
    // is splitting instead of spelling it.
    it("ships an inline dealer that carries neither hazard", () => {
      expect(INLINE, "no inline dealing script after the splash mark").toBeTruthy();
      expect(INLINE.includes("/" + "/"), "the inline dealer spells a bare double slash")
        .toBe(false);
      expect(INLINE, "the inline dealer uses a template literal esbuild never lowers")
        .not.toContain(String.fromCharCode(96));
      expect(INLINE, "the inline dealer spells the SVG namespace rather than reading it")
        .toContain("namespaceURI");
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

    it("still draws five paths BEFORE the alert dots are dealt, ten after", () => {
      // The 5 above is the count of what SHIPS in either copy of the markup — the warm dots
      // are one path in both, which is what keeps the five-constants assertion at the top of
      // this file true. Dealing is a RUNTIME split of that one path into six, so the only
      // place the number is 10 is after dealAlerts() has run.
      const mark = brandMark(112);
      expect(mark.querySelectorAll("path").length).toBe(5);
      expect(dealAlerts(mark, ALERT_GROUPS, lcg(1))).toBe(mark);
      expect(mark.querySelectorAll("path").length).toBe(5 - 1 + ALERT_GROUPS);
      expect(mark.querySelectorAll(".mark-map--warm").length).toBe(ALERT_GROUPS);
    });

    it("leaves a compact mark alone — it has no globe to deal", () => {
      const compact = brandMark(20, { compact: true });
      expect(dealAlerts(compact, ALERT_GROUPS, lcg(1))).toBe(compact);
      expect(compact.querySelectorAll("path").length).toBe(3);
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

    it("deals the alert dots on the copy it rebuilds, as the static copy deals itself", () => {
      // Without this call the rebuilt splash still animates — with all 97 alerts in ONE phase
      // group, so refresh() would produce a visibly different mark from the one the reader saw
      // on the same page a moment earlier, and nothing would fail.
      //
      // READ THROUGH code(), and that is a finding rather than a precaution: the first form of
      // this assertion swept the RAW source, and deleting the call outright left it passing on
      // the word "dealAlerts()" in the comment that explains the call. A sweep for a call site
      // has to look at code.
      expect(code(SPLASH), "bootSplash() no longer deals the alert dots")
        .toMatch(/dealAlerts\(/);
    });
  });

  describe(app + ": the traced ring and check carry pathLength in BOTH copies", () => {
    // `bm-trace` animates a stroke-dasharray of 1, which means "the whole stroke" only because
    // pathLength re-parameterises the path to length 1. Without the attribute that 1 is one
    // USER unit on a ~120-unit arc and the ring renders dotted. The two copies fail
    // DIFFERENTLY, which is why they are two assertions: the static one is wrong on first
    // paint, and the module's one is wrong only on the splash refresh() rebuilds — the copy
    // nobody reproduces on the page they first saw the defect on.
    it("carries it in the rendered index, on the orbit and the check", () => {
      const tags = staticPathTags();
      for (const [name, d] of [["orbit", MARK_ORBIT], ["check", MARK_CHECK]]) {
        const tag = tags.get(normPath(d));
        expect(tag, "no <path> in the rendered index draws the " + name).toBeTruthy();
        expect(tag, "the static " + name + " carries no pathLength")
          .toContain('pathLength="1"');
      }
    });

    it("carries it in brandMark(), on the same two paths", () => {
      const paths = brandMark(112).querySelectorAll("path");
      for (const [name, d] of [["orbit", MARK_ORBIT], ["check", MARK_CHECK]]) {
        const node = paths.find((n) => n.getAttribute("d") === d);
        expect(node, "brandMark() draws no " + name).toBeTruthy();
        expect(node.getAttribute("pathLength"), "the module's " + name + " carries none")
          .toBe("1");
      }
    });
  });

  describe(app + ": the splash timeline cannot escape the splash", () => {
    const bmRules = () =>
      cssRules(BASE_CSS).filter((r) => (
        !r.sel.startsWith("@")
        && !/^(from|to)$/.test(r.sel)
        && !/^[\d.]+%/.test(r.sel)
        && r.body.includes("bm-")
      ));

    // THE APPBAR WEARS THE SAME CLASSES — shell/appbar.js draws brandMark(22, {compact: true})
    // — so an unscoped `.mark-ink` rule would leave a 22px header glyph breathing for the life
    // of the session, on every page, in three apps. Every selector naming a `bm-` animation
    // (or the tempo the timeline reads) has to sit under `.boot-splash `.
    it("scopes every bm- rule under .boot-splash", () => {
      const offenders = [];
      for (const rule of bmRules()) {
        for (const sel of rule.sel.split(",").map((x) => x.trim()).filter(Boolean)) {
          if (!sel.startsWith(".boot-splash ")) offenders.push(sel);
        }
      }
      expect(offenders, "bm- rules that reach outside the splash").toEqual([]);
    });

    it("is not a vacuous sweep — the timeline is really in this sheet", () => {
      // The assertion above passes trivially against a stylesheet with no animation in it at
      // all, which is exactly what a botched merge would leave behind.
      expect(bmRules().length, "no bm- rules found in base.css").toBeGreaterThanOrEqual(5);
      expect(BASE_CSS, "no bm- keyframes in base.css").toMatch(/@keyframes\s+bm-/);
    });

    // The named fallback is load-bearing rather than belt-and-braces: overrides.css's global
    // `* { animation-duration: .01ms !important }` does NOT zero `animation-delay` (a delayed
    // element would hold its start state for its whole delay and then pop) and on an
    // `infinite` loop it samples an arbitrary phase every frame, which is flicker rather than
    // stillness. `animation: none` sets `animation-name`, which that !important does not cover.
    //
    // EXACT SELECTOR STRINGS, AND THAT IS THE FINDING. The first form of this assertion
    // normalised a tag qualifier away — it treated `.boot-splash circle.mark-ink-fill` and
    // `.boot-splash .mark-ink-fill` as one selector, on the reasoning that the qualifier only
    // exists to give the nodes and the shield different beats and means nothing to a fallback
    // that turns both off. It is true about intent and false about the CASCADE: (0,2,0) loses
    // to (0,2,1), so the fallback did not stand the rules down at all, and Playwright against
    // the shipped bytes found the two nodes and the shield still reporting animationName
    // `bm-rise` under reduced motion — invisible, then popping. THE GUARD PASSED ON IT. A
    // stand-down is only a stand-down if it is written the way the rule it answers is written,
    // so the comparison is character-for-character and the duplication in base.css is the
    // correct shape rather than the tidy one.
    it("stands every animated splash selector down under reduced motion, exactly", () => {
      const animated = new Set();
      for (const rule of bmRules()) {
        if (!/animation[^;]*bm-/.test(rule.body)) continue;
        for (const sel of selectorsOf(rule)) animated.add(sel);
      }
      expect(animated.size, "no bm- animation found for the fallback to answer for")
        .toBeGreaterThanOrEqual(5);
      const stopped = stoodDown(BASE_CSS);
      const uncovered = [...animated].filter((sel) => !stopped.has(sel));
      expect(uncovered, "animated with no character-identical `animation: none`")
        .toEqual([]);
    });
  });

  describe(app + ": no infinite animation in base.css outlives reduced motion", () => {
    // THE GENERAL FORM OF THE RULE ABOVE, and it exists because the specific form missed two
    // defects in one sheet — one of them written in the same round as the guard, one of them
    // years older. An infinite loop is the case where `animation-duration: .01ms !important`
    // is actively WORSE than no fallback: the animation does not stop, it advances a whole
    // cycle every frame, so the property it drives samples an arbitrary keyframe phase
    // forever. Measured on the boot splash's own progress bar under reduced motion, before
    // this sweep existed: `margin-left` read -92.8px on one probe and -86.4px on another 700ms
    // later, on a bar whose reduced-motion rule sets `margin-left: 0` and never got to.
    //
    // Sheet-wide rather than splash-shaped, and it lives in this file because this is where
    // the CSS reader is. Exact selector strings, for the reason the comment above gives.
    it("names every infinite animation in a reduced-motion `animation: none`", () => {
      const looping = new Set();
      for (const rule of cssRules(BASE_CSS)) {
        if (rule.sel.startsWith("@")) continue;
        if (/^(from|to)$/.test(rule.sel) || /^[\d.]+%/.test(rule.sel)) continue;
        if (!/animation(-iteration-count)?[^;]*\binfinite\b/.test(rule.body)) continue;
        for (const sel of selectorsOf(rule)) looping.add(sel);
      }
      // Non-vacuity: base.css really does carry looping animations, and if it stops carrying
      // them this assertion has to start failing rather than start passing for free.
      expect(looping.size, "no infinite animation found in base.css at all")
        .toBeGreaterThanOrEqual(6);
      const stopped = stoodDown(BASE_CSS);
      const uncovered = [...looping].filter((sel) => !stopped.has(sel));
      expect(uncovered, "loops on forever at .01ms per cycle under reduced motion")
        .toEqual([]);
    });
  });

  describe(app + ": the two alert dealers are one dealer", () => {
    // `dealAlerts()` and the template's inline script are two hand-written implementations of
    // one shuffle, and they have to be: one of them runs before the module holding the other
    // exists. Nothing about the RENDERED result would reveal a divergence — six paths of
    // shuffled dots look like six paths of shuffled dots, on both copies of a splash that is
    // on screen for 400ms — so the only way they stay one dealer is to run both against one
    // replayable random and compare the strings.
    const SEED = 20260906;
    const dots = (d) => d.match(/M[^M]+/g) || [];

    /** The warm path as the inline dealer will meet it: one node, inside a parent. */
    const warmFixture = () => {
      const svg = makeNode("svg", SVG_NS);
      const warm = makeNode("path", SVG_NS);
      warm.setAttribute("class", "mark-map mark-map--warm");
      warm.setAttribute("fill", "none");
      warm.setAttribute("stroke", "#f32b2b");
      warm.setAttribute("stroke-width", MARK_DOT_WIDTH);
      warm.setAttribute("stroke-linecap", "round");
      warm.setAttribute("d", MARK_DOTS_RED);
      svg.append(warm);
      return { svg, warm };
    };

    /** The template's script, executed against that fixture and a stubbed Math.random. */
    const runInline = (rng) => {
      const { svg, warm } = warmFixture();
      const asked = [];
      const math = Object.create(Math);
      math.random = rng;
      runInNewContext(INLINE, {
        document: {
          querySelector(sel) {
            asked.push(sel);
            return /mark-map--warm/.test(sel) ? warm : null;
          },
          createElementNS: (ns, tag) => makeNode(tag, ns),
        },
        Math: math,
      });
      return { svg, asked };
    };

    it("deals MARK_DOTS_RED into six phased groups, losing and inventing nothing", () => {
      const mark = brandMark(112);
      dealAlerts(mark, ALERT_GROUPS, lcg(SEED));
      const groups = mark.querySelectorAll(".mark-map--warm");
      expect(groups.length).toBe(ALERT_GROUPS);
      // The phase index is what the whole exercise is for: base.css reads --i and starts each
      // group 0.6s further into the 3.6s alert cycle.
      expect(groups.map((g) => g.getAttribute("style")))
        .toEqual([...Array(ALERT_GROUPS).keys()].map((i) => "--i:" + i));
      // A MULTISET, not a concatenation: round-robin dealing after a shuffle reorders the
      // dots, and it may not drop or duplicate one.
      const dealt = dots(groups.map((g) => g.getAttribute("d")).join(""));
      expect(dealt.length).toBe(97);
      expect([...dealt].sort()).toEqual([...dots(MARK_DOTS_RED)].sort());
    });

    it("reaches the SPLASH mark, not the appbar's", () => {
      const { asked } = runInline(lcg(SEED));
      expect(asked.length).toBe(1);
      expect(asked[0], "the inline dealer would also deal a header glyph")
        .toContain(".boot-splash ");
    });

    it("produces the same six groups from the module and from the inline script", () => {
      const mark = brandMark(112);
      dealAlerts(mark, ALERT_GROUPS, lcg(SEED));
      const fromModule = mark.querySelectorAll(".mark-map--warm")
        .map((g) => g.getAttribute("d"));

      const { svg } = runInline(lcg(SEED));
      const fromInline = svg.querySelectorAll(".mark-map--warm")
        .map((g) => g.getAttribute("d"));

      expect(fromInline.length, "the inline dealer deals a different number of groups")
        .toBe(fromModule.length);
      expect(fromInline, "the two dealers disagree — one shuffle, written twice")
        .toEqual(fromModule);
    });

    it("copies the original path's attributes onto every group", () => {
      const { svg } = runInline(lcg(SEED));
      for (const g of svg.querySelectorAll(".mark-map--warm")) {
        expect(g.getAttribute("stroke")).toBe("#f32b2b");
        expect(g.getAttribute("stroke-width")).toBe(String(MARK_DOT_WIDTH));
        expect(g.getAttribute("stroke-linecap")).toBe("round");
        expect(g.getAttribute("fill")).toBe("none");
      }
    });
  });
}
