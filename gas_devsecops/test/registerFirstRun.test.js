// The three register pages, on a ledger nobody has read yet.
//
// THE DEFECT. `?dry&noseed` (a bootstrap with no saved sync) left sca, sast and secrets
// printing a hero `0`, a stat row of `0 / 0 / 0`, an "Awaiting a vendor fix 0 … 0 of 0 open
// dependency findings" sentence, and — on sca and sast — two chart canvases drawn over a
// population of nothing. A `page.$$eval` audit of text-exactly-`0` across
// `.kpi-value, .stat-value, .hero-value, .mini-value, td` found 9 on sca, 10 on sast and 17 on
// secrets. PRODUCT.md's sixth principle is the rule all of it breaks: "no MTTR yet" is a state
// a reader can act on; "MTTR is 0 days" — or "0 open findings" — is a confident lie about a
// register that was never asked.
//
// THE FIX mirrors `executiveFirstRunView` (executive.js) and the `first` flag mttr.js already
// carries: each of the three register pages now decides `firstRun = {show, synced}` from its
// OWN register's `rowCount` — sca, sast and secrets are three independent ledger scopes
// (CLAUDE.md: "the same CVE arriving through a dependency and through a host image is two
// findings with two clocks"), so a register with rows is never suppressed because a sibling
// register is empty. `registerFirstRunView` (sca.js) is the one place the decision is made;
// sast.js and secrets.js import it rather than each re-deriving it.
//
// WHY SOURCE TEXT FOR HALF OF THIS. There is no jsdom in this project (vitest.config.ts sets
// no `environment`), matching every other page-package test here — `pagesRegisters.test.js`,
// `pagesLit.test.js`, `chartTable.test.js`. The pure view models are called directly; the DOM
// half's ONE testable claim — that a canvas is never created on a first run — is checked as
// comment-stripped source text, the same way `chartTable.test.js` checks the canvas/chartTable
// pairing.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { registerFirstRunView, scaModel } from "../src/client/js/pages/sca.js";
import { sastModel } from "../src/client/js/pages/sast.js";
import { secretsModel } from "../src/client/js/pages/secrets.js";

const SRC = (name) =>
  readFileSync(new URL(`../src/client/js/pages/${name}.js`, import.meta.url), "utf8");
const SCA_SRC = SRC("sca");
const SAST_SRC = SRC("sast");
const SECRETS_SRC = SRC("secrets");

/**
 * The file with its `//` comments removed — string-aware, so a `//` inside a quoted string
 * stays. Copied from `test/pagesRegisters.test.js`'s `code()` (that file is protected and may
 * not be edited to export it) — a third copy, for the same reason `chartTable.test.js`'s own
 * copy gives: several module headers here NAME `firstRunNotice(` and `chartCard(` while
 * explaining the rule, so a raw-text sweep would trip on the sentence that states it.
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
const SCA_CODE = code(SCA_SRC);
const SAST_CODE = code(SAST_SRC);
const SECRETS_CODE = code(SECRETS_SRC);

// ========================================================================== the fixtures
//
// Minimal on purpose, not the full fixtures `pagesRegisters.test.js` builds (its builder
// functions are local to that file and that file is protected — nothing there is importable).
// Every field either model reads off a missing sub-object falls back to `{}`/`[]` internally
// (`agingModel`, `tierModel`, `funnelModel`, `concentrationModel`, `oldestFindingsModel`,
// `movementModel` all do), so a payload naming only `rowCount`/`open`/`resolved` is exactly as
// safe to run through the full pipeline as the larger fixtures are — it just leaves every
// other block at its own honest zero, which is not what this file is testing.

const EMPTY = {}; // no rowCount at all — the shape `api_bootstrap` never actually ships, and
// the safest possible input: `registerFirstRunView` must treat "the field is missing" the
// same as "the field says 0" rather than crash or treat an absent count as populated.

function scaPopulated(over) {
  return { rowCount: 120, open: 90, resolved: 30, ...(over || {}) };
}
function sastPopulated(over) {
  return { rowCount: 340, open: 300, resolved: 40, ...(over || {}) };
}
function secretsPopulated(over) {
  return {
    register: { rowCount: 61, open: 41 },
    secrets: {
      rowCount: 61, open: 41,
      removalVsRotation: { removedAndRotated: 3, removedNotRotated: 17, rotatedNotRemoved: 1, neither: 40, total: 61 },
    },
    ...(over || {}),
  };
}

// ================================================================ 1. the view-model decision

describe("each register's own view model decides firstRun from its own rowCount", () => {
  it("sca: empty payload shows; populated payload does not", () => {
    expect(scaModel(EMPTY).firstRun.show).toBe(true);
    expect(scaModel(scaPopulated()).firstRun.show).toBe(false);
  });

  it("sast: empty payload shows; populated payload does not", () => {
    expect(sastModel(EMPTY).firstRun.show).toBe(true);
    expect(sastModel(sastPopulated()).firstRun.show).toBe(false);
  });

  it("secrets: empty payload shows; populated payload does not", () => {
    expect(secretsModel(EMPTY).firstRun.show).toBe(true);
    expect(secretsModel(secretsPopulated()).firstRun.show).toBe(false);
  });

  it("a rowCount of literally 0 shows, same as a missing rowCount", () => {
    expect(scaModel({ rowCount: 0, open: 0, resolved: 0 }).firstRun.show).toBe(true);
  });

  it("registerFirstRunView treats a malformed rowCount (null, a string, NaN) as empty, never as populated", () => {
    for (const bad of [null, undefined, "", "not a number", NaN, []]) {
      expect(registerFirstRunView(bad, false).show, JSON.stringify(bad)).toBe(true);
    }
  });

  /**
   * PERTURBATION (run 2026-09-04, then reverted). `registerFirstRunView` in
   * `src/client/js/pages/sca.js` was changed from
   *
   *   export function registerFirstRunView(rowCount, synced) {
   *     return { show: num(rowCount, 0) === 0, synced: !!synced };
   *   }
   *
   * to
   *
   *   export function registerFirstRunView(rowCount, synced) {
   *     return { show: true, synced: !!synced };
   *   }
   *
   * Observed (`npx vitest run test/registerFirstRun.test.js`):
   *
   *   FAIL  … > sca: empty payload shows; populated payload does not
   *     AssertionError: expected true to be false
   *   FAIL  … > sast: empty payload shows; populated payload does not
   *     AssertionError: expected true to be false
   *   FAIL  … > secrets: empty payload shows; populated payload does not
   *     AssertionError: expected true to be false
   *   FAIL  … > is not satisfied by a hard-coded show:true (perturbation above, reverted)
   *     AssertionError: expected true to be false
   *   FAIL  … > the rendered hero figure is never a zero on a first run > the same three
   *         heroes render real counts once the register has rows
   *     AssertionError: expected '—' to be '90'
   *
   *   Test Files  1 failed (1)
   *   Tests  5 failed | 16 passed (21)
   *
   * Five failures, not three: `show: true` also drags §3's "real counts once the register has
   * rows" case down with it, because the hero itself is derived from `firstRun.show` — a
   * perturbation this shallow does not stay contained to the describe block it was aimed at.
   * The three EMPTY-payload assertions stayed green — a `show: true` constant satisfies "shows
   * on nothing" for free — so the POPULATED-payload half is what tells a hard-coded `true`
   * apart from a real decision, which is why both cases are asserted in every one of the three
   * `it`s above rather than split into an "empty" describe and a separate "populated" one
   * nobody has to keep in sync.
   */
  it("is not satisfied by a hard-coded show:true (perturbation above, reverted)", () => {
    expect(scaModel(scaPopulated()).firstRun.show).toBe(false);
    expect(sastModel(sastPopulated()).firstRun.show).toBe(false);
    expect(secretsModel(secretsPopulated()).firstRun.show).toBe(false);
  });
});

// ==================================================== 2. no canvas, no chart, on a first run

describe("no chart card — and so no canvas — is ever built on a first run", () => {
  /**
   * `paintSca`/`paintSast`/`paintSecrets` each render the page header (which never creates a
   * canvas — `heroStat`/`statRow`/`sevSegmentBar` are all plain DOM), THEN check
   * `vm.firstRun.show` and return before anything else runs. `chartCard` — the one function in
   * this package that calls `el("canvas"` (defined once, in sca.js, and imported by sast.js
   * and secrets.js) — is only ever reached from code AFTER that guard's `return;`, so it is
   * simply never called when `firstRun.show` is true. This checks that ordering in the SOURCE
   * TEXT, which is what actually decides it: everything textually before the guard's `return;`
   * runs unconditionally, and everything after it does not run when the guard fires.
   */
  const PAGES = [
    { name: "sca", code: SCA_CODE, fn: "paintSca" },
    { name: "sast", code: SAST_CODE, fn: "paintSast" },
    { name: "secrets", code: SECRETS_CODE, fn: "paintSecrets" },
  ];

  for (const { name, code: src, fn } of PAGES) {
    it(`${name} calls firstRunNotice(`, () => {
      expect(src).toMatch(/firstRunNotice\(/);
    });

    it(`${name}'s ${fn} gates every chartCard( call behind the first-run guard's return`, () => {
      const start = src.indexOf(`function ${fn}(`);
      expect(start, `${fn} not found in ${name}.js`).toBeGreaterThan(-1);
      const body = src.slice(start);

      const guardIdx = body.indexOf("if (vm.firstRun.show) {");
      expect(guardIdx, `${name}.js's ${fn} has no first-run guard`).toBeGreaterThan(-1);

      const returnIdx = body.indexOf("return;", guardIdx);
      expect(returnIdx, `${name}.js's ${fn} guard has no return`).toBeGreaterThan(guardIdx);

      // Nothing before the guard may already have called chartCard — the header alone must
      // never draw a chart.
      expect(body.slice(0, guardIdx)).not.toMatch(/chartCard\(/);

      // Every chartCard( call in this function is textually AFTER the guard's return, so none
      // of them execute on the path that returns early.
      const afterReturn = body.slice(returnIdx);
      const callsAfter = (afterReturn.match(/chartCard\(/g) || []).length;
      const callsTotal = (body.match(/chartCard\(/g) || []).length;
      expect(callsAfter, `${name}.js calls chartCard before the first-run return`)
        .toBe(callsTotal);
    });
  }

  it("sca.js still owns the only el(\"canvas\" literal among the three register pages", () => {
    // `chartCard` — the shared canvas-creating function — is DEFINED once, in sca.js, and
    // sast.js/secrets.js both import and call it rather than each defining their own. So the
    // literal `el("canvas"` text appears once in sca.js's source and not at all in the other
    // two; this is what makes the guard above sufficient rather than merely necessary — there
    // is nowhere else a canvas could be created from.
    expect((SCA_CODE.match(/el\("canvas"/g) || []).length).toBe(1);
    expect((SAST_CODE.match(/el\("canvas"/g) || []).length).toBe(0);
    expect((SECRETS_CODE.match(/el\("canvas"/g) || []).length).toBe(0);
  });

  /**
   * PERTURBATION (run 2026-09-04, then reverted). In `src/client/js/pages/sca.js`'s
   * `paintSca`, a `host.append(chartCard("Perturbation probe", null, () => {}));` line was
   * inserted right after the page header, BEFORE the `if (vm.firstRun.show) { … return; }`
   * guard — simulating a chart hoisted ahead of the first-run check. Observed
   * (`npx vitest run test/registerFirstRun.test.js`):
   *
   *   FAIL  … > sca's paintSca gates every chartCard( call behind the first-run guard's return
   *     AssertionError: expected 'function paintSca(host, vm, filters) …' not to match
   *     /chartCard\(/
   *   FAIL  … > is not satisfied by an out-of-order chartCard call (perturbation above, reverted)
   *     AssertionError: expected 'function paintSca(host, vm, filters) …' not to match
   *     /chartCard\(/
   *
   *   Test Files  1 failed (1)
   *   Tests  2 failed | 19 passed (21)
   *
   * `chartTable.test.js`'s own canvas/chartTable pairing sweep — a file this package may not
   * edit — did NOT catch this perturbation (confirmed: `npx vitest run test/chartTable.test.js`
   * stayed 17/17 green throughout): that test counts `el("canvas"` and `chartTable(` PER FILE,
   * and calling the already-imported `chartCard` earlier in the same file changes neither
   * count — it never runs a canvas-creating literal itself. This test is the one that actually
   * bites on ORDERING rather than on presence.
   */
  it("is not satisfied by an out-of-order chartCard call (perturbation above, reverted)", () => {
    const start = SCA_CODE.indexOf("function paintSca(");
    const body = SCA_CODE.slice(start);
    const guardIdx = body.indexOf("if (vm.firstRun.show) {");
    expect(body.slice(0, guardIdx)).not.toMatch(/chartCard\(/);
  });
});

// ============================================================ 3. no rendered figure is a 0

describe("the rendered hero figure is never a zero on a first run", () => {
  it("sca: value is a dash and the sentence carries no digit", () => {
    const vm = scaModel(EMPTY);
    expect(vm.firstRun.show).toBe(true);
    expect(vm.hero.value).toBe("—");
    expect(vm.hero.value).not.toBe("0");
    expect(vm.hero.sub).not.toMatch(/\d/);
  });

  it("sast: value is a dash and the sentence carries no digit", () => {
    const vm = sastModel(EMPTY);
    expect(vm.hero.value).toBe("—");
    expect(vm.hero.sub).not.toMatch(/\d/);
  });

  it("secrets: value is a dash and the sentence carries no digit", () => {
    const vm = secretsModel(EMPTY);
    expect(vm.hero.value).toBe("—");
    expect(vm.hero.sentence).not.toMatch(/\d/);
  });

  it("the same three heroes render real counts once the register has rows", () => {
    expect(scaModel(scaPopulated()).hero.value).toBe("90");
    expect(sastModel(sastPopulated()).hero.value).toBe("300");
    expect(secretsModel(secretsPopulated()).hero.value).toBe("17");
  });
});

// ==================================================================== 4. synced vs unsynced

describe("firstRun.synced distinguishes no-sync-ever from a sync that saved nothing here", () => {
  it("defaults to unsynced when the page passes no opts at all", () => {
    expect(scaModel(EMPTY).firstRun.synced).toBe(false);
    expect(sastModel(EMPTY).firstRun.synced).toBe(false);
    expect(secretsModel(EMPTY).firstRun.synced).toBe(false);
  });

  it("carries a true synced flag through from the page's opts", () => {
    expect(scaModel(EMPTY, { synced: true }).firstRun.synced).toBe(true);
    expect(sastModel(EMPTY, { synced: true }).firstRun.synced).toBe(true);
    expect(secretsModel(EMPTY, { synced: true }).firstRun.synced).toBe(true);
  });

  it("each page reads boot.latestSync to decide it, rather than assuming one state", () => {
    for (const src of [SCA_CODE, SAST_CODE, SECRETS_CODE]) {
      expect(src).toMatch(/latestSync/);
    }
  });
});
