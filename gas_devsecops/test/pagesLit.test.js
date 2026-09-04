// The Phase 2 EXIT GATE for gas_devsecops's ten routes.
//
// Every other page test in this repo (`pagesProgram.test.js`, `pagesRegisters.test.js`,
// `pagesData.test.js`) pins ONE package's domain claims. This file pins a different kind of
// claim: one about the WHOLE register rather than about any single page — the ten published
// exit-criterion items a reviewer would check off before calling Phase 2 done. Where a page
// genuinely cannot publish a figure (no producer in the read model), the honest-absence
// behaviour pinned in those three files is trusted here rather than re-derived; this file
// checks that the shape holds everywhere, not that every number exists.
//
// NO JSDOM (vitest.config.ts sets no `environment`), so — matching the house style — each page
// is read as SOURCE TEXT for the structural claims (nothing here needs a live DOM to answer
// "does this page still call renderStub", "does this page's code name a denied field") and the
// one page whose pure model this file actually calls (`secretsModel`) is exercised directly,
// the same way `pagesRegisters.test.js` already does.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { secretsModel } from "../src/client/js/pages/secrets.js";

// The key sheet joined the Data lane in the help-route package; this list moves only when a
// route is added or removed on purpose.
const ROUTES = [
  "executive", "mttr", "program",
  "sca", "sast", "secrets",
  "repos", "history", "data", "help",
  "settings",
];

const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);
const SRC = Object.fromEntries(
  ROUTES.map((r) => [r, readFileSync(new URL(`${r}.js`, PAGES_DIR), "utf8")]),
);
const APP_SRC = readFileSync(new URL("../src/client/js/app.js", import.meta.url), "utf8");
const STUB_SRC = readFileSync(new URL("../src/client/js/pages/_stub.js", import.meta.url), "utf8");
const HELP_SRC = readFileSync(new URL("../src/client/js/helpContent.js", import.meta.url), "utf8");

/**
 * The file with its `//` comments removed — string-aware, so a comment marker inside a quoted
 * string survives. Mirrors `code()` in `test/pagesRegisters.test.js`.
 *
 * THE REASON THIS EXISTS: `secrets.js`'s own module header EXPLAINS its prohibitions in prose
 * — it names `sevBadge`, `sev-*`, and `validationDetails` precisely to say it does not use
 * them, and a naive "must not appear" check over the raw text would fail on the sentence that
 * states the rule. Prohibitions below are checked over the CODE; the header's own claims are
 * checked over the prose, separately, where that distinction matters.
 */
function code(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    out += c;
    i++;
  }
  return out;
}
const CODE = Object.fromEntries(ROUTES.map((r) => [r, code(SRC[r])]));

/** Every object key in a structure, at every depth — mirrors `pagesRegisters.test.js`. */
function allKeys(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

// =========================================================================================
//  1. No `.stub-status` anywhere
// =========================================================================================

describe("exit gate 1/7: no page still draws p.stub-status", () => {
  it("no page module imports or calls renderStub", () => {
    for (const route of ROUTES) {
      expect(SRC[route], `${route} still calls renderStub`).not.toMatch(/renderStub/);
      expect(SRC[route], `${route} still imports the stub body`).not.toMatch(/_stub\.js/);
    }
  });

  it("_stub.js has no importer left among the ten routes", () => {
    // NOT ours to delete _stub.js even if this comes back empty — see the file header.
    const importers = ROUTES.filter((r) => SRC[r].includes("_stub.js"));
    expect(importers, "route(s) still importing the Phase 1 stub body").toEqual([]);
  });

  it("renderStub itself is still intact (a missing module would fail every caller, not just this test)", () => {
    expect(STUB_SRC).toMatch(/export function renderStub/);
    expect(STUB_SRC).toMatch(/stub-status/);
  });
});

// =========================================================================================
//  2. Every route in PAGES has a real, reachable renderer
// =========================================================================================

/** Read the PAGES table out of app.js as text — mirrors test/shared.test.js's parser. */
function parsePages() {
  const body = APP_SRC.slice(
    APP_SRC.indexOf("const PAGES = {"),
    APP_SRC.indexOf("\n};", APP_SRC.indexOf("const PAGES = {")),
  );
  const out = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s{2}(\w+):\s*\{(.*)$/);
    if (!m) continue;
    const renderMatch = m[2].match(/render:\s*(\w+)/);
    out.push({ route: m[1], render: renderMatch ? renderMatch[1] : null });
  }
  return out;
}
const PAGES = parsePages();

describe("exit gate 2/7: every route has a real renderer, and a file behind it", () => {
  it("PAGES names exactly the eleven routes this phase composed", () => {
    expect(PAGES.map((p) => p.route)).toEqual(ROUTES);
  });

  it("every route names a render function, following the render<Route> convention", () => {
    for (const p of PAGES) {
      const expected = "render" + p.route[0].toUpperCase() + p.route.slice(1);
      expect(p.render, `${p.route} has no render field`).toBeTruthy();
      expect(p.render, `${p.route}'s render field is ${p.render}, not ${expected}`).toBe(expected);
    }
  });

  it("app.js imports that render function from the route's own pages/<route>.js", () => {
    for (const p of PAGES) {
      expect(APP_SRC, `${p.route} has no import from pages/${p.route}.js`).toMatch(
        new RegExp(`import \\{ ${p.render} \\} from "\\./pages/${p.route}\\.js";`),
      );
    }
  });

  it("every one of the ten has a corresponding pages/<route>.js that exports that function", () => {
    for (const p of PAGES) {
      expect(SRC[p.route], `pages/${p.route}.js has no content`).toBeTruthy();
      expect(SRC[p.route], `pages/${p.route}.js does not export ${p.render}`).toMatch(
        new RegExp(`export (async )?function ${p.render}\\(`),
      );
    }
  });
});

// =========================================================================================
//  3. Every rate carries its denominator
// =========================================================================================

// The three page packages built the same convention with different helper names — `denomNote`
// (register pages AND the data lane, which copied it — see repos.js/history.js/data.js's own
// header comments crediting sca.js), `rateView`/`boundedRateView` (the program lane) — so this
// is the PROPERTY being swept, never one helper's literal name.
const PERCENT_HINT = /"%"|[A-Za-z]Pct\b|\bpct1?\(|\brateView\(|\bboundedRateView\(|\bfmtPct\(/;
const DENOM_HINT = /data-denominator|\bdenomNote\(|\bdenominator:/;

describe("exit gate 3/7: every rate carries its denominator", () => {
  it("any page that renders a percentage-shaped figure also carries a denominator marker", () => {
    for (const route of ROUTES) {
      if (!PERCENT_HINT.test(SRC[route])) continue; // nothing to check on this page today
      expect(DENOM_HINT.test(SRC[route]), `${route} renders a rate with no denominator marker`)
        .toBe(true);
    }
  });

  it("is not a vacuous sweep — most of the ten routes actually carry a rate", () => {
    const withRates = ROUTES.filter((r) => PERCENT_HINT.test(SRC[r]));
    expect(withRates.length).toBeGreaterThanOrEqual(6);
  });
});

// =========================================================================================
//  4. The secrets route carries no severity axis at all
// =========================================================================================

describe("exit gate 4/7: secrets carries no severity axis, in source or in output", () => {
  it("no severity class or badge spelling anywhere in the secrets page's executable code", () => {
    // CODE, not SRC: the module header explains, in prose, that nothing severity-flavoured is
    // imported — a raw-text check would fail on the sentence that states the rule.
    const src = CODE.secrets;
    expect(src).not.toMatch(/\bsev-[A-Za-z]/);
    expect(src).not.toMatch(/severity-[a-z]/i);
    expect(src).not.toMatch(/sevbar|sev-badge|sev-dot|sev-pill|sevkey/i);
  });

  it("no severity helper is imported or called from the secrets page's own executable code", () => {
    expect(CODE.secrets).not.toMatch(
      /\bsevBadge\b|\bsevEntries\b|\bsevSegmentBar\b|\bsevKeyRow\b|\bsevSpoken\b|\bsevPalette\b|\bsevRank\b/,
    );
  });

  it("has no severity key at any depth of the exported view model", () => {
    const vm = secretsModel({});
    const offenders = allKeys(vm).filter((k) => /sev/i.test(k));
    expect(offenders).toEqual([]);
  });

  it("serializes with no severity class, badge or field anywhere in the output", () => {
    const vm = secretsModel({});
    const serialized = JSON.stringify(vm);
    expect(serialized).not.toMatch(/\bsev-[A-Za-z]/);
    expect(serialized).not.toMatch(/severity-[a-z]/i);
    expect(serialized).not.toMatch(/"severity"/i);
  });
});

// =========================================================================================
//  5. No page emits a credential value
// =========================================================================================

describe("exit gate 5/7: no page's view-model output can put a secret's value on screen", () => {
  it("no page's executable code names snippet or validationDetails", () => {
    for (const route of ROUTES) {
      expect(CODE[route], `${route} names a denied field in its code`)
        .not.toMatch(/\bsnippet\b|\bvalidationDetails\b/);
    }
  });

  it("secrets.js's header names both deliberately, to record what Q_SECRETS omits — prose only", () => {
    expect(SRC.secrets).toMatch(/validationDetails/);
    expect(CODE.secrets).not.toMatch(/\bvalidationDetails\b/);
  });

  it("the secrets view model's serialized output carries neither field", () => {
    const vm = secretsModel({});
    expect(JSON.stringify(vm)).not.toMatch(/snippet|validationDetails/i);
  });
});

// =========================================================================================
//  6. Every glossaryTip id used by any page exists in helpContent.js
// =========================================================================================

describe("exit gate 6/7: every glossary id any page reaches for is actually defined", () => {
  const defined = new Set([...HELP_SRC.matchAll(/^\s*id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]));

  it("found a real glossary to check against (the parse above did not come back empty)", () => {
    expect(defined.size).toBeGreaterThan(15);
  });

  it("names no undefined id, across every id-carrying call shape this codebase uses", () => {
    // Four call shapes carry a glossary id in this codebase: a literal glossaryTip() call, a
    // `term:`/`glossary:` field on a view-model object (read back by tipLabel()/glossaryTip()
    // at render time), and sectionCard()'s positional second argument. A page reading `r.term`
    // off a per-row object (program.js) is covered by the `term:` sweep at its OWN origin —
    // the literal the row was built from — not at the read site, which carries no literal.
    const ID_PATTERNS = [
      /glossaryTip\([^,]+,\s*"([a-z0-9-]+)"/g,
      /\bterm:\s*"([a-z0-9-]+)"/g,
      /\bglossary:\s*"([a-z0-9-]+)"/g,
      /sectionCard\([^,]+,\s*"([a-z0-9-]+)"/g,
    ];
    let checked = 0;
    for (const route of ROUTES) {
      const src = SRC[route];
      for (const pattern of ID_PATTERNS) {
        for (const m of src.matchAll(pattern)) {
          checked++;
          expect(defined.has(m[1]), `${route} reaches an undefined glossary id: ${m[1]}`).toBe(true);
        }
      }
    }
    // Not a vacuous sweep — the nine live pages between them reach for a couple dozen ids.
    expect(checked).toBeGreaterThan(15);
  });
});

// =========================================================================================
//  7. The accent split holds on the pages
// =========================================================================================

describe("exit gate 7/7: the accent split holds — no page spends --accent as ink", () => {
  it("no page sets colour, an outline, a border-color or an SVG stroke from --accent", () => {
    for (const route of ROUTES) {
      const src = SRC[route];
      expect(src, `${route} sets colour from --accent`)
        .not.toMatch(/[^-]color:\s*[^;]*var\(--accent\)\s*[;}]/);
      expect(src, `${route} draws an outline in --accent`)
        .not.toMatch(/outline:\s*[^;]*var\(--accent\)\s*[;}]/);
      expect(src, `${route} sets a border-color in --accent`)
        .not.toMatch(/border-color:\s*[^;]*var\(--accent\)\s*[;}]/);
      expect(src, `${route} strokes with --accent`)
        .not.toMatch(/stroke:\s*[^;]*var\(--accent\)\s*[;}]/);
    }
  });

  it("no page hard-codes the fill-only accent literal (#ffcb13) as ink either", () => {
    for (const route of ROUTES) {
      expect(SRC[route], `${route} hard-codes the fill-only accent`).not.toContain("#ffcb13");
    }
  });

  it("the one page that reads the accent at all reads it through charts.ACCENT (the text-safe token)", () => {
    const withAccent = ROUTES.filter((r) => /\bACCENT\b/.test(SRC[r]));
    expect(withAccent.length).toBeGreaterThan(0);
    for (const route of withAccent) {
      expect(SRC[route]).toMatch(/charts\.ACCENT/);
    }
  });
});
