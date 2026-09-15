// P3.4b's own close-out check: gas's src/client/styles/pages.css holds no dead furniture
// and no un-promoted "promotion candidate" banner.
//
// The wave deleted six hero/mini-stat rules (`.hero`, `.hero .label`, `.hero-src`,
// `.hero-minis`, `.mini-label`, `.mini-value`) that no page has built since the front
// door moved onto the shared `pageHeader`/`heroStat` shape, plus a handful of other rules
// a grep over src/client/js/** and gas_shared/ui/ found zero references to (a dead scope
// combobox nesting, a dead chart-grid distribution span, a dead fill-height chart card, a
// dead sheet resize handle and a dead raw-json block — see the comments left in place of
// each). It also promoted sixteen rule blocks that were byte-identical to
// gas_devsecops/src/client/styles/pages.css into gas_shared/styles/{components,tables,
// base}.css, so this file no longer carries a "promotion candidate" banner at all.
//
// Source-text assertions, the same idiom figures.test.js and executiveFixNext.test.js use
// for a claim about what a file does NOT contain: there is no DOM here to render, only a
// stylesheet to read.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGES_CSS_PATH = new URL("../src/client/styles/pages.css", import.meta.url);
const PAGES_CSS = readFileSync(PAGES_CSS_PATH, "utf8");

describe("gas pages.css: the promoted blocks are gone, not merely renamed", () => {
  it("carries no 'promotion candidate' banner", () => {
    expect(PAGES_CSS).not.toMatch(/promotion candidate/);
  });

  it("defines none of the sixteen promoted selectors any more", () => {
    // A regex per selector rather than a plain string search: `.chart-row` alone would
    // false-positive on `.chart-row--pair`'s own declaration if this ever used substring
    // matching instead. Anchored to a line start (with leading whitespace allowed for the
    // .sev-fan sub-rules) so a mention inside a comment about WHY it moved does not count as
    // a re-declaration — every surviving mention here is prose, not a rule.
    const promoted = [
      /^\.fixnext\b/m, /^\.fixnext-item\b/m, /^\.fixnext-head\b/m, /^\.fixnext-repo\b/m,
      /^\.fixnext-meta\b/m,
      /^\.movement-rows\b/m, /^\.movement-row\b/m, /^\.movement-label\b/m,
      /^\.movement-counts\b/m, /^\.movement-block\b/m,
      /^\s*\.sev-fan\b/m, /^\s*\.sev-fan__head\b/m,
      /^\.page-header > \.kpi-card\b/m,
      /^\.chart-row--pair\s*\{/m,
      /^\.table-wrap\s*\{\s*position:\s*relative/m,
      /^\.toolbar-group\b/m,
      /^\.finding-actions\b/m,
      /^\.kv dd > \.code-block\b/m,
      /^\.trend-aside\b/m,
      /^\.rate-with-meter\b/m,
      /^\.unclassified-card\b/m, /^\.unclassified-swatch\b/m,
      /^\.kpi-spark\b/m,
      /^\.section-label > \.heading-pill\b/m,
      /^\.sidebar \.rail-status-dot\b/m, /^\.sidebar button\.rail-status-dot\b/m,
    ];
    for (const re of promoted) {
      expect(PAGES_CSS, re.toString() + " still declares a promoted rule").not.toMatch(re);
    }
  });
});

describe("gas pages.css: the six hero/mini-stat rules stay retired", () => {
  it("has none of .hero / .hero .label / .hero-src / .hero-minis / .mini-label / .mini-value", () => {
    expect(PAGES_CSS).not.toMatch(/^\.hero\s*\{/m);
    expect(PAGES_CSS).not.toMatch(/^\.hero \.label\b/m);
    expect(PAGES_CSS).not.toMatch(/^\.hero-src\b/m);
    expect(PAGES_CSS).not.toMatch(/^\.hero-minis\b/m);
    expect(PAGES_CSS).not.toMatch(/^\.mini-label\b/m);
    expect(PAGES_CSS).not.toMatch(/^\.mini-value\b/m);
  });

  // A caller-facing use of `.hero-line` (gas_shared's own class, under `.page-hero-sub`) is
  // the one `hero-*` literal a page still builds (mttr.js). The rule for it never lived in
  // this file, so there is nothing here to keep and nothing to accidentally re-delete.
  it("still knows .hero-line is a gas_shared class, not one of its own", () => {
    expect(PAGES_CSS).not.toMatch(/^\.hero-line\s*\{/m);
  });
});

describe("gas pages.css: a perturbation proves the banner check actually bites", () => {
  // Perturb every guard you write (CLAUDE.md) — a snippet carrying the exact banner text is
  // what the first `it` above is supposed to catch. Run the same assertion against a string
  // that DOES contain a banner and confirm it fails, so the "no banner" test is not passing
  // merely because nothing in this file happens to run.
  it("fails the 'no promotion candidate banner' shape on a string that has one", () => {
    const withBanner = PAGES_CSS + "\n/* promotion candidate: byte-identical to gas_devsecops"
      + "/src/client/styles/pages.css — promote to gas_shared/styles after wave 3. */\n"
      + ".made-up-rule { color: red; }\n";
    expect(withBanner).toMatch(/promotion candidate/);
  });
});
