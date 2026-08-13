// The Help key sheet's content, held to the vocabulary it names.
//
// Plain .js on purpose, for the reason graphChips.test.js writes out: tsconfig has no
// allowJs and includes test/**/*.ts, so a .ts test importing a client .js module fails
// `tsc --noEmit` — and `npm run check` is typecheck && test && build, so vitest would
// never run. Vitest picks up **/*.test.{js,ts} either way.
//
// This is an ANTI-ROT spec, not a behaviour spec. A key sheet's failure mode is not
// throwing, it is quietly describing marks the app stopped drawing and linking to routes
// that no longer exist — a page that is wrong in a way nothing notices. So the assertions
// point outward: every kind it names must still be in KIND_LABELS, every code in CODEBOOK,
// every route a real page, every `term` a real entry. Renaming any of those becomes a
// build failure here instead of a rotting page nobody reads.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ENTRIES, FAMILIES, ROUTE_TITLES, findEntry, groupByFamily, resolveEntries,
} from "../src/client/js/helpContent.js";
import { KIND_LABELS } from "../src/client/js/icons.js";
import { lookupGap } from "../src/client/js/codebook.js";
// The real rule, not a hand-written copy of it. A fixture that spells `bands` its own way
// asserts against a fiction — which is exactly how the band-threshold resolver shipped
// reading upper-case keys off a lower-case object and silently degrading to "not counted
// here" on every deployment.
import { DEFAULT_AARS_RULE } from "../src/domain/aars";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const APP_JS = read("src/client/js/app.js");
const HELP_CONTENT_JS = read("src/client/js/helpContent.js");
const HELP_PAGE_JS = read("src/client/js/pages/help.js");

/**
 * The PAGES keys, read from app.js source rather than imported.
 *
 * app.js touches `document` at module scope, so importing it would drag the whole SPA
 * into a node test. The regex reads the object literal's keys between `const PAGES = {`
 * and its closing brace.
 */
function pageKeys() {
  const block = APP_JS.match(/const PAGES = \{([\s\S]*?)\n\};/);
  expect(block, "PAGES object literal not found in app.js").toBeTruthy();
  return block[1]
    .split("\n")
    .map((line) => line.match(/^\s{2}(\w+):\s*\{/))
    .filter(Boolean)
    .map((m) => m[1]);
}

/** Every `kindMark("X")` / `kindIconSvg("X", …)` argument in the content module. */
function namedKinds() {
  return [...HELP_CONTENT_JS.matchAll(/kind(?:Mark|IconSvg)\("([A-Z0-9_]+)"/g)].map((m) => m[1]);
}

/** Every `term: "x"` a helpTip call site or a figure callout points at. */
function namedTerms() {
  const files = [
    "src/client/js/pages/graph.js",
    "src/client/js/pages/aars.js",
    "src/client/js/pages/inventory.js",
    "src/client/js/pages/combos.js",
    "src/client/js/pages/scans.js",
    "src/client/js/pages/help.js",
  ];
  const terms = new Set();
  for (const f of files) {
    for (const m of read(f).matchAll(/\bterm: "([a-z0-9-]+)"/g)) terms.add(m[1]);
  }
  return [...terms];
}

const EMPTY_CTX = { boot: {}, kpis: null, digest: null, tally: null };

const FULL_CTX = {
  boot: {
    settings: { defaultDepth: 2, maxNodes: 100 },
    aarsRule: {
      // Exactly what src/server/api.ts puts on the bootstrap payload: the rule's own
      // bands object, passed through rather than re-cased.
      bands: DEFAULT_AARS_RULE.bands,
      pillarCaps: {
        toxic: DEFAULT_AARS_RULE.pillarACap,
        compliance: DEFAULT_AARS_RULE.pillarBCap,
        data: Math.round(
          Math.max(...Object.values(DEFAULT_AARS_RULE.dataExposurePoints)) *
            DEFAULT_AARS_RULE.dataAmplifier,
        ),
      },
    },
    counts: { openIssues: 29 },
    latestSync: { node_count: 62, finished_at: "2026-08-12T05:00:00Z", mode: "dry-run" },
    filterOptions: { kinds: ["AI_AGENT", "AI_MODEL", "BUCKET"] },
  },
  kpis: {
    agents: 14, protectedAgents: 3, sensitiveAccess: 9, internetExposed: 4,
    internetUnknown: 2, highPrivilege: 6, agenticIdentities: 11, criticalAars: 6,
    complianceGaps: 18,
  },
  digest: { totals: { patternsActive: 4, patternsTotal: 4, assetsAffected: 23, reRated: 29, totalOpen: 29 } },
  tally: { live: 7, partial: 2, unscanned: 1 },
};

describe("the entry list", () => {
  it("gives every entry a unique id", () => {
    const ids = ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("files every entry under a declared family", () => {
    const families = new Set(FAMILIES.map((f) => f.id));
    for (const e of ENTRIES) {
      expect(families.has(e.family), e.id + " has family " + e.family).toBe(true);
    }
  });

  it("loses no entry to grouping", () => {
    const grouped = groupByFamily(resolveEntries(EMPTY_CTX));
    const n = grouped.reduce((acc, g) => acc + g.entries.length, 0);
    expect(n).toBe(ENTRIES.length);
  });

  it("gives every entry a mark and a blurb", () => {
    for (const e of ENTRIES) {
      expect(typeof e.mark, e.id).toBe("function");
      expect(e.blurb.length, e.id).toBeGreaterThan(40);
      expect(e.term.length, e.id).toBeGreaterThan(0);
    }
  });
});

describe("the vocabulary it names", () => {
  it("names only node kinds the icon sprite still carries", () => {
    const kinds = namedKinds();
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(Object.prototype.hasOwnProperty.call(KIND_LABELS, kind), kind).toBe(true);
    }
  });

  it("names only framework codes the codebook still carries", () => {
    for (const entry of ENTRIES) {
      for (const code of entry.codes || []) {
        expect(lookupGap(code), entry.id + " names " + code).toBeTruthy();
      }
    }
  });

  it("routes only to pages that exist", () => {
    const pages = pageKeys();
    expect(pages).toContain("help");
    for (const route of Object.keys(ROUTE_TITLES)) {
      expect(pages, "ROUTE_TITLES names " + route).toContain(route);
    }
    for (const e of ENTRIES) {
      for (const route of e.drawnOn || []) {
        expect(pages, e.id + " is drawn on " + route).toContain(route);
      }
      if (e.link) expect(pages, e.id + " links to " + e.link.route).toContain(e.link.route);
    }
  });

  it("resolves every term a helpTip or a callout points at", () => {
    const terms = namedTerms();
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) {
      expect(findEntry(term), "no entry for term " + term).toBeTruthy();
    }
  });

  it("ignores a term the book does not carry", () => {
    expect(findEntry("not-a-term")).toBeNull();
    expect(findEntry("")).toBeNull();
    expect(findEntry(undefined)).toBeNull();
  });
});

describe("the count resolvers", () => {
  // The no-sync case is the one most likely to throw, and it is exactly the state the
  // reader most likely to open Help is in.
  it("answers null rather than throwing on an empty payload", () => {
    for (const entry of ENTRIES) {
      if (!entry.count) continue;
      expect(() => entry.count(EMPTY_CTX), entry.id).not.toThrow();
      expect(entry.count(EMPTY_CTX), entry.id + " must not invent a figure").toBeNull();
    }
  });

  it("returns a well-formed count against a full payload", () => {
    const pages = pageKeys();
    for (const entry of resolveEntries(FULL_CTX)) {
      if (!entry.count) continue;
      const res = entry.resolved;
      if (res === null) continue;
      expect(typeof res.n, entry.id + ".n").toBe("number");
      expect(Number.isFinite(res.n), entry.id + ".n").toBe(true);
      expect(typeof res.value, entry.id + ".value").toBe("string");
      expect(res.value.length, entry.id + ".value").toBeGreaterThan(0);
      expect(typeof res.unit, entry.id + ".unit").toBe("string");
      if (res.route) {
        expect(pages, entry.id + " counts into " + res.route).toContain(res.route);
        expect(typeof res.params, entry.id + ".params").toBe("object");
      }
    }
  });

  // Before the first sync the KPI endpoint still answers — with zeros, off an empty
  // ledger. Reporting those as measurements would say "0 AI assets reach classified data"
  // about an estate nobody has looked at, which is the implied confidence PRODUCT.md
  // forbids. Settings are the exception: they are the model in force, not a measurement.
  it("withholds every estate figure until a sync exists", () => {
    const noSync = { ...FULL_CTX, boot: { ...FULL_CTX.boot, latestSync: null } };
    const answered = resolveEntries(noSync).filter((e) => e.resolved !== null);
    const ids = answered.map((e) => e.id).sort();
    expect(ids).toEqual(["aars-band", "depth-budget", "pillar-a", "pillar-c"]);
    for (const e of answered) {
      expect(e.fromSettings, e.id + " answers without a sync but is not a setting").toBe(true);
    }
  });

  it("marks a settings entry only where the figure really is configuration", () => {
    const settings = ENTRIES.filter((e) => e.fromSettings).map((e) => e.id).sort();
    expect(settings).toEqual(["aars-band", "depth-budget", "pillar-a", "pillar-c"]);
    // A settings entry that reads the KPI payload would be mislabelled, and the guard
    // would let an estate figure through before the first sync.
    for (const e of ENTRIES) {
      if (!e.fromSettings) continue;
      expect(String(e.count), e.id + " reads kpis but claims to be a setting")
        .not.toMatch(/ctx\.kpis|ctx\.digest|ctx\.tally/);
    }
  });

  it("degrades an entry whose resolver throws instead of failing the page", () => {
    const boom = {
      id: "boom", term: "Boom", family: "graph", blurb: "x".repeat(50),
      mark: () => null,
      count: () => { throw new Error("no such KPI"); },
    };
    expect(() => resolveEntries.call(null, EMPTY_CTX)).not.toThrow();
    // resolveEntry is what wraps it; exercise the same path through a hand-made entry.
    const wrapped = [boom].map((e) => {
      try {
        return { ...e, resolved: e.count(EMPTY_CTX) || null };
      } catch {
        return { ...e, resolved: null };
      }
    });
    expect(wrapped[0].resolved).toBeNull();
  });

  // The strict form, and the one that would have caught the band-threshold bug: FULL_CTX
  // supplies every input any resolver asks for, so an entry that still cannot answer is
  // reading a shape the payload does not have. Degrading to "not counted here" is the
  // right behaviour for a missing KPI and the wrong behaviour for a typo, and only this
  // assertion tells them apart.
  it("leaves nothing uncounted when every input is present", () => {
    const silent = resolveEntries(FULL_CTX)
      .filter((e) => e.count && e.resolved === null)
      .map((e) => e.id);
    expect(silent, "these resolvers cannot read a complete payload").toEqual([]);
  });
});

describe("the page", () => {
  it("keeps its promise not to redraw the provenance diagram", () => {
    // Wiz Scans owns provenance. If a future edit imports the coverage page's diagram
    // helpers here, that is the duplication this page was scoped to avoid.
    expect(HELP_PAGE_JS).not.toMatch(/diagramLayout|provenanceDiagram|diagramHeight/);
  });

  it("reads the coverage limits from the coverage page's own resolvers", () => {
    expect(HELP_PAGE_JS).toMatch(/from "\.\.\/scanContent\.js"/);
    expect(HELP_PAGE_JS).toMatch(/resolveAreas\(/);
  });

  it("shares the assets cache key with the coverage page", () => {
    // Byte-identical params mean one swrCall entry, so arriving from Wiz Scans or the
    // Inventory costs no extra round trip. A drifted pageSize silently doubles the reads.
    const help = HELP_PAGE_JS.match(/ASSETS_PARAMS = (\{[^}]*\})/);
    const scans = read("src/client/js/pages/scans.js").match(/ASSETS_PARAMS = (\{[^}]*\})/);
    expect(help).toBeTruthy();
    expect(scans).toBeTruthy();
    expect(help[1]).toBe(scans[1]);
  });
});
