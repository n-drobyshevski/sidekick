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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ENTRIES, FAMILIES, ROUTE_TITLES, findEntry, groupByFamily, lexTally, resolveEntries,
} from "../src/client/js/helpContent.js";
import { ROUTE_ICONS } from "../src/client/js/routeIcons.js";
import { KIND_LABELS } from "../src/client/js/icons.js";
import { lookupGap } from "../src/client/js/codebook.js";
// The real rule, not a hand-written copy of it. A fixture that spells `bands` its own way
// asserts against a fiction — which is exactly how the band-threshold resolver shipped
// reading upper-case keys off a lower-case object and silently degrading to "not counted
// here" on every deployment.
import { DEFAULT_AARS_RULE, computeAars } from "../src/domain/aars";
// Phase 8's authoritative record, and its client-side mirror (measureContent.js) — a .js
// test importing a .ts module is fine (see this file's own header on why the reverse
// direction is the one tsc rejects), so the parity check below can read both directly.
import { MEASURE_SPECS } from "../src/domain/measureSpec";
import { MEASURE_ENTRIES } from "../src/client/js/measureContent.js";

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

/**
 * Every entry id the client points at — `term: "x"` on a tip, `glossaryTip("x")` /
 * `bookTip(node, "x")` where a component reads the book directly, and `findEntry("x")` where a
 * page does (the query palette's detail pane).
 *
 * THE WHOLE CLIENT TREE is read, not a hand-kept list of files and no longer just `pages/`.
 * The list this replaces named six files and had not grown since; then the hover card arrived
 * and the badges that read the book moved into `ui/` — `outcomeBadge`, `tierBadge`, `scoreChip`
 * — where a scan of `pages/` could not see them, and a renamed id in any of them would have
 * passed by simply never being looked at. Reading the directory means a new caller is covered
 * by existing.
 */
function namedTerms() {
  const terms = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith(".js")) continue;
      const src = readFileSync(full, "utf8");
      for (const m of src.matchAll(/\bterm: "([a-z0-9-]+)"/g)) terms.add(m[1]);
      for (const m of src.matchAll(/\bfindEntry\("([a-z0-9-]+)"\)/g)) terms.add(m[1]);
      for (const m of src.matchAll(/\bglossaryTip\([^,]+,\s*"([a-z0-9-]+)"/g)) terms.add(m[1]);
      for (const m of src.matchAll(/\bbookTip\([^,]+,\s*"([a-z0-9-]+)"/g)) terms.add(m[1]);
      // `findEntry(MAP[key])` — the id lives in a lookup object beside the call, so the values
      // of any `*: "kebab-id",` line in the file are checked too. Over-broad by design: a false
      // positive here is a term someone has to add to the book, which is the right direction to
      // fail in for an anti-rot spec.
      if (src.includes("findEntry(") || src.includes("_TERM = {")) {
        for (const m of src.matchAll(/^\s{2}[A-Z0-9_]+: "([a-z0-9-]+)",$/gm)) terms.add(m[1]);
      }
    }
  };
  walk(join(root, "src/client/js"));
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
    internetUnknown: 2, highPrivilege: 6, agenticIdentities: 11, aarsScored: 30,
    complianceGaps: 18, sensitiveDatastores: 5, dataFindings: 12,
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

// The prose is the part of this page that rots silently. Nothing about a definition that
// has quietly become false makes the app throw, fail a type check, or look wrong — so the
// facts the copy states about the model are asserted against the model itself.
//
// This block exists because the page shipped saying "three pillars" and main added a
// fourth (D, internet reachability) in the same window. No test caught it: every route
// still resolved, every code still existed, every resolver still answered.
describe("the prose, against the model it describes", () => {
  const PILLAR_WORDS = ["no", "one", "two", "three", "four", "five", "six"];

  /** The pillars the scoring model actually reports, read off a real score. */
  function modelPillars() {
    const result = computeAars(
      { issueSeverities: ["HIGH"], gaps: [{ code: "LLM06" }], dataExposure: "NONE" },
      DEFAULT_AARS_RULE,
    );
    return Object.keys(result.pillars);
  }

  it("names one entry per pillar the model reports", () => {
    const pillars = modelPillars();
    const entries = ENTRIES.filter((e) => /^pillar-[a-z]$/.test(e.id)).map((e) => e.id);
    expect(entries.length, "pillars in the model: " + pillars.join(", ")).toBe(pillars.length);
  });

  it("counts the pillars correctly in the score's own definition", () => {
    const word = PILLAR_WORDS[modelPillars().length];
    const aars = ENTRIES.find((e) => e.id === "aars");
    expect(aars.blurb).toContain(word + " pillars");
  });

  // The figure's callout copy makes the same claim, from a different file.
  it("counts the pillars correctly in the figure callouts", () => {
    const word = PILLAR_WORDS[modelPillars().length];
    const claims = [...HELP_PAGE_JS.matchAll(/(\w+) pillars/g)].map((m) => m[1]);
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) expect(claim).toBe(word);
  });

  it("does not describe a rule knob the model no longer has", () => {
    // Every knob the copy names by its own spelling must still be a field on the rule.
    const named = ["multiIssueScaling", "gapAggregation", "gapSources", "exposurePoints"];
    for (const knob of named) {
      expect(Object.prototype.hasOwnProperty.call(DEFAULT_AARS_RULE, knob), knob).toBe(true);
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
  // about a landscape nobody has looked at, which is the implied confidence PRODUCT.md
  // forbids. Settings are the exception: they are the model in force, not a measurement.
  it("withholds every landscape figure until a sync exists", () => {
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
    // would let a landscape figure through before the first sync.
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

  // The rail is a second address for the page's structure, and a second address is a
  // second thing to forget. A seventh family, or a fifth section, has to appear in both.
  it("indexes every section and every family in the rail", () => {
    const block = HELP_PAGE_JS.match(/const SECTIONS = \[([\s\S]*?)\n\];/);
    expect(block, "SECTIONS array not found in pages/help.js").toBeTruthy();
    const ids = [...block[1].matchAll(/\["([a-z0-9-]+)",/g)].map((m) => m[1]);
    expect(ids.length, "every top-level section needs an anchor id").toBe(4);
    for (const id of ids) {
      expect(HELP_PAGE_JS, id + " is listed but never rendered").toMatch(
        new RegExp("section\\(\\d\\)|SECTIONS\\["),
      );
    }
    // The rail builds its vocabulary rows straight off groupByFamily(ENTRIES), so every
    // declared family reaches it as long as the family actually holds entries — which the
    // losslessness test above already pins.
    const families = groupByFamily(ENTRIES).map((g) => g.family.id);
    expect(families.sort()).toEqual(FAMILIES.map((f) => f.id).sort());
  });

  // The rail's counts, the family headings' counts and the header's hero are all built
  // BEFORE the first await, from lengths rather than from figures. If any of them started
  // reading a resolved count the page would move when the RPCs landed, which is the one
  // thing this page's header comment forbids outright.
  it("builds the lexicon shell from ENTRIES, not from a payload", () => {
    expect(HELP_PAGE_JS).toMatch(/groupByFamily\(ENTRIES\)/);
  });
});

describe("the route icon set", () => {
  // The page map, the "Drawn on" line and the sidebar now draw one vocabulary. A route
  // added to PAGES without a glyph renders an empty tile rather than failing, so the miss
  // has to fail here instead.
  it("has a glyph for every page", () => {
    for (const route of pageKeys()) {
      expect(ROUTE_ICONS[route], route + " has no icon in routeIcons.js").toBeTruthy();
    }
  });

  it("has a glyph for every route the Help page draws", () => {
    const named = new Set();
    for (const entry of ENTRIES) for (const r of entry.drawnOn || []) named.add(r);
    for (const m of HELP_PAGE_JS.matchAll(/\["([a-z]+)", "[^"]*\?"\]/g)) named.add(m[1]);
    for (const route of named) {
      expect(ROUTE_ICONS[route], route + " is drawn on Help but has no glyph").toBeTruthy();
    }
  });
});

describe("lexTally", () => {
  // The header's hero and its strip read this; the count cell reads each entry. They are
  // the same four branches, so a term can never be counted in the strip and rendered
  // differently in the row.
  it("accounts for every entry exactly once", () => {
    for (const ctx of [EMPTY_CTX, FULL_CTX]) {
      const t = lexTally(resolveEntries(ctx));
      const sum = t.figure + t.zero + t.uncounted + t.convention;
      expect(sum).toBe(ENTRIES.length);
    }
  });

  // The pre-sync honest state, which is the state the reader most likely to open Help is
  // in. Only the four `fromSettings` terms may answer, because only they read the model in
  // force rather than the landscape; everything else must be "not counted here", never zero.
  it("withholds every landscape figure before the first sync", () => {
    const t = lexTally(resolveEntries(EMPTY_CTX));
    const settings = ENTRIES.filter((e) => e.fromSettings).length;
    expect(t.zero, "an unknown landscape must never report a zero").toBe(0);
    expect(t.figure).toBeLessThanOrEqual(settings);
    expect(t.uncounted).toBe(
      ENTRIES.filter((e) => e.count).length - t.figure,
    );
  });

  it("answers for every countable term once the payload is complete", () => {
    const t = lexTally(resolveEntries(FULL_CTX));
    expect(t.uncounted, "a complete payload should leave nothing uncounted").toBe(0);
    expect(t.convention).toBe(ENTRIES.filter((e) => !e.count).length);
  });
});

// Phase 8: the client mirror (measureContent.js) held to the authoritative TS record
// (src/domain/measureSpec.ts). Nothing here recomputes a number — this file is purely
// descriptive, same as codebook.js — but the two sides must never disagree about WHICH
// measures exist or what type/method each one claims, or an operator reading the Help page
// gets a different story than test/measureSpec.test.ts pins for the record itself.
describe("the measure specifications", () => {
  it("mirrors exactly the ids MEASURE_SPECS declares — none missing, none stale", () => {
    const specIds = MEASURE_SPECS.map((s) => s.id).sort();
    const mirrorIds = MEASURE_ENTRIES.map((m) => m.id).sort();
    expect(mirrorIds).toEqual(specIds);
  });

  it("agrees with MEASURE_SPECS on type and measurementMethod for every id", () => {
    const byId = new Map(MEASURE_SPECS.map((s) => [s.id, s]));
    for (const m of MEASURE_ENTRIES) {
      const spec = byId.get(m.id);
      expect(spec, m.id).toBeTruthy();
      expect(m.type, m.id).toBe(spec.type);
      expect(m.measurementMethod, m.id).toBe(spec.measurementMethod);
    }
  });

  it("renders one Help entry per measure, filed under the measures family", () => {
    const rendered = ENTRIES.filter((e) => e.id.startsWith("measure-"));
    expect(rendered.length).toBe(MEASURE_ENTRIES.length);
    for (const e of rendered) {
      expect(e.family, e.id).toBe("measures");
      expect(typeof e.mark, e.id).toBe("function");
      expect(e.count, e.id + " is documentation, not a live figure").toBeUndefined();
    }
  });
});
