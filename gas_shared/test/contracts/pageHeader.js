// One page, one `<h1>`, IT NAMES THAT PAGE, and only a full-bleed route may write its own.
//
// `ui/controls.js`'s `pageHeader({ route })` renders the h1 from the route's own PAGES title,
// and that is how a route gets one. Before that block existed every page hand-rolled its
// title, and the habit outlived the component: gas_ai still had five bare `el("h1", …)` sites
// after the unification wave had converted everything else, and the wave's own scorecard could
// only record "page-header pattern ✗" beside a prose note guessing at which of them were
// exceptions.
//
// THE FIRST RULE HERE ONLY ASKED WHETHER A HEADING EXISTED, and that is why F4 exists. P4b had
// made `heroStat`'s LABEL the h1, which is a lane on some pages ("Data", "Assurance",
// "Registers · Code") and a metric name on others ("Remediation half-life"). Both are real
// facts; neither is the page's NAME. Measured after F3: three gas_ai routes — `problems`,
// `combos`, `config` — all announced "Risk", so a reader navigating by heading could not tell
// them apart, and this contract was green throughout. The pages whose label was a metric took
// the other exit and put the page TITLE in the 2rem `hero-value` slot, against DESIGN.md's own
// hierarchy ("only ever a data value, never a heading"), which left `compliance` rendering its
// name and its posture percentage at the same size. So the rules below come in two halves:
// which ELEMENT carries the heading (P4b/F3), and which STRING is in it (F4).
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

/**
 * Every `<fn>( … )` call in `src`, as the source text between the parens, balanced.
 *
 * Quote-aware, because the arguments here are page copy and page copy is full of parentheses:
 * "issues ∪ findings (the whole union)" would close the call three characters early on a naive
 * depth counter. Template literals and escapes are handled for the same reason — a regex
 * cannot do this, and the assertions below need the WHOLE call, not its first line, because
 * every multi-line `pageHeader({ … })` in these three apps spans five to twenty of them.
 */
export function callsOf(src, fn) {
  const code = stripCommentProse(src);
  const out = [];
  const needle = new RegExp("\\b" + fn + "\\s*\\(", "g");
  let m;
  while ((m = needle.exec(code)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    let quote = null;
    while (i < code.length && depth > 0) {
      const c = code[i];
      if (quote) {
        if (c === "\\") { i += 2; continue; }
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "(" || c === "[" || c === "{") {
        depth++;
      } else if (c === ")" || c === "]" || c === "}") {
        depth--;
      }
      i++;
    }
    out.push(code.slice(m.index, i));
    needle.lastIndex = i;
  }
  return out;
}

/**
 * `route: "<key>"` out of one `pageHeader(` call, or null where it passes none.
 *
 * NULL IS A REAL ANSWER, not a miss: a header with no route renders no `<h1>`, which is how
 * the four SECOND headers on gas_ai's problems / combos / config pages keep their page to one
 * heading. That absence replaced `heroStat`'s `{ heading: "div" }` opt-out.
 */
export function routeOfCall(call) {
  const m = call.match(/\broute:\s*"([^"]*)"/);
  return m ? m[1] : null;
}

/**
 * Every string literal that could be a `heroStat` VALUE, per call.
 *
 * Deliberately loose in the safe direction: rather than parse arguments positionally (a
 * `heroStat(` argument can be a conditional spanning eight lines), it returns EVERY top-level
 * double-quoted literal in the call. The assertion built on it says "no PAGES title appears
 * anywhere inside a heroStat call", which is stricter than "not in the value slot" — and
 * stricter is the right direction here, because a page title has no business being a heroStat
 * LABEL either. It is what P4b did, and it is what put "Data" in four different pages' h1.
 */
export function stringLiteralsIn(call) {
  return (call.match(/"(?:[^"\\]|\\.)*"/g) || []).map((s) => s.slice(1, -1));
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
 * @param {Object<string,string>} [ctx.sharedHeaderRoutes]  route → reason, for a route whose
 *                                 header is drawn by a module OUTSIDE this app: `gas` and
 *                                 `gas_devsecops` both route `help` straight into
 *                                 `gas_shared/ui/helpPage.js`, whose one line of app-side
 *                                 wiring passes only the entries. Such a route is exempted
 *                                 from "your module names your own route", WITH THE REASON
 *                                 PRINTED — the same discipline `skipReason` follows, at
 *                                 route granularity, because a bare allow-list of names is
 *                                 how a real regression hides. gas_ai's `help` is a LOCAL
 *                                 page and is deliberately not listed.
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
    const scan = files.map((file) => {
      const src = readFileSync(file, "utf8");
      return {
        file,
        rel: relative(root, file).replace(/\\/g, "/"),
        headings: findOwnHeadings(src),
        headers: callsOf(src, "pageHeader"),
        heroes: callsOf(src, "heroStat"),
      };
    });
    const byPath = new Map(scan.map((s) => [s.file, s]));
    const titles = new Set(PAGES.map((p) => p.title));
    const sharedHeaderRoutes = ctx.sharedHeaderRoutes || {};

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
            + "justify it. Use pageHeader({ route: \"<this route>\" }) — the h1 is the "
            + "route's own PAGES title — or, if the route genuinely owns the whole content "
            + "pane, declare it fullBleed: true in PAGES.",
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

    // =====================================================================================
    //  F4: the h1 says WHICH page, and a page title never takes the hero step
    // =====================================================================================
    //
    // The rule above only asked whether a heading EXISTS. It passed on the register while
    // three gas_ai routes all announced "Risk" as their primary heading, because "Risk" is a
    // heading and the lane it names is a real fact — just not the answer to "what page am I
    // on". These three assertions are the other half: the h1 has to IDENTIFY the page, and
    // the 2rem hero step has to stay a measurement.
    //
    // Derived from each app's own PAGES rather than from a list typed here, for the same
    // reason the fullBleed rule is: that is what makes one file hold in three registers whose
    // route sets have nothing in common.

    it("finds the header calls it is about to judge — an empty scan judges nothing", () => {
      // THE ANTI-VACUOUS HALF FOR THE NEW SWEEP, and it is not a copy of the one above: that
      // one proves files were READ, this one proves the balanced-paren extractor actually
      // matched calls in them. A regex that silently stops matching (a renamed component, a
      // reformatted call) leaves every assertion below iterating an empty list.
      const headers = scan.reduce((n, s) => n + s.headers.length, 0);
      expect(headers, app + ": callsOf(src, \"pageHeader\") matched nothing anywhere under "
        + jsDir).toBeGreaterThan(0);
      const routed = scan.reduce(
        (n, s) => n + s.headers.filter((c) => routeOfCall(c)).length, 0);
      expect(routed, app + ": no pageHeader call anywhere passes a route — every page's h1 "
        + "would be missing").toBeGreaterThan(0);
    });

    it("gives every non-fullBleed route an h1 that is its OWN PAGES title", () => {
      const problems = [];
      for (const p of PAGES) {
        if (p.fullBleed) continue; // its own h1.workbench-title, asserted above
        if (sharedHeaderRoutes[p.route]) continue; // header drawn outside this app — see below
        const s = byPath.get(resolve(jsDir, "pages", p.route + ".js"));
        if (!s) { problems.push(p.route + ": no module"); continue; }
        const routed = s.headers.map(routeOfCall).filter(Boolean);
        if (!routed.length) {
          problems.push(p.route + ': no pageHeader({ route: "' + p.route + '" }) — the page '
            + "renders no h1, so nothing names it");
          continue;
        }
        // EXACTLY ONE, and the count matters as much as the value: a second routed header is
        // a second h1, which is the defect `{ heading: "div" }` used to be needed to avoid.
        if (routed.length > 1) {
          problems.push(p.route + ": " + routed.length + " pageHeader calls pass a route ("
            + routed.join(", ") + ") — that is one h1 each");
        }
        for (const r of routed) {
          if (r !== p.route) {
            problems.push(p.route + ' renders the h1 of "' + r + '" — its heading would name '
              + "another page (" + (PAGES.find((q) => q.route === r) || {}).title + ")");
          }
        }
      }
      expect(problems, app + ": every non-fullBleed route's h1 must be its own PAGES title, "
        + "and it gets there by passing its OWN route key to pageHeader — never by typing the "
        + "title a second time. Offenders:").toEqual([]);
    });

    it("keeps a page TITLE out of the 2rem hero-value slot", () => {
      // DESIGN.md, Hierarchy: the hero value is "only ever a data value, never a heading;
      // headings keep the 1.5rem display ceiling". P8's compliance conversion and F3's three
      // broke that by putting the page's name where the figure goes — compliance then rendered
      // its own title and its posture percentage at the same 32px, and combos had two 32px
      // values ninety pixels apart, which F3's own visual verdict flagged.
      //
      // Checked over EVERY string literal in a heroStat call, not just the positional value
      // argument: a page title has no business being a heroStat LABEL either — that is what
      // P4b did, and it is what put "Risk" in three pages' h1 at once.
      const offenders = [];
      for (const s of scan) {
        s.heroes.forEach((call, i) => {
          for (const lit of stringLiteralsIn(call)) {
            if (titles.has(lit)) {
              offenders.push(s.rel + " heroStat#" + (i + 1) + ': "' + lit + '"');
            }
          }
        });
      }
      expect(offenders, app + ": a PAGES title appears inside a heroStat call. The title "
        + "belongs to pageHeader({ route }), which renders it as the h1 at the 1.5rem "
        + "ceiling; heroStat's value is a measurement and its label names that measurement.")
        .toEqual([]);
    });

    it("has no `heading` option left on heroStat to reopen the hole", () => {
      // The opt-out is GONE, not deprecated: heroStat renders no heading, so a
      // `{ heading: … }` left anywhere would be a knob that switches nothing while reading
      // like it still governs the page's h1. Scanned over the whole client, comments stripped
      // — the four call sites that used to pass it now explain in prose that they no longer
      // need to, and that prose must not trip the sweep.
      const offenders = scan
        .filter((s) => s.heroes.some((c) => /\bheading\s*:/.test(c)))
        .map((s) => s.rel);
      expect(offenders, app + ": heroStat no longer takes a `heading` option — a page keeps "
        + "its single h1 by being the only header that passes a `route`.").toEqual([]);
    });

    // Named, not silent: a route exempted above prints its reason in the run summary, so the
    // exemption is visible in the same place a failure would be rather than only in this file.
    for (const [route, reason] of Object.entries(sharedHeaderRoutes)) {
      it.skip(app + ": route " + route + " names its own route key — SKIPPED: " + reason,
        () => {});
    }
  });
}
