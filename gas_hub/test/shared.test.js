// This app's end of the shared design-system contracts.
//
// The rules live in `gas_shared/test/contracts/` as SPEC FACTORIES rather than as test
// files, because `vitest.config.ts` collects only this package's `test/` directory — a
// shared contract cannot be a test, it has to be a function this file calls with vitest's
// own describe/it/expect and this app's specifics. Ten of the twelve are registered here.
//
// THE TWO THAT ARE NOT, AND WHY. A launcher is not a register, so two of the contracts are
// about a dimension this app does not have:
//
//   registerHelpContract   NOT REGISTERED. This app has no `help` route and no
//                          `helpContent.js`: it defines no vocabulary of its own — its whole
//                          copy is four tile headlines and three scope lines, every word of
//                          which names a SIBLING's register, and a glossary of another app's
//                          terms would be a second place for them to drift. app.js's manifest
//                          says the same thing in one line: `findHelpEntry: () => null`.
//                          Precedent for a non-registration on these grounds is gas_ai, which
//                          registers it against a bespoke local page rather than the shared
//                          one; here there is no page at all.
//   registerScopeContract  NOT REGISTERED. There is no scope dimension. The three registers
//                          slice their populations by project or domain; this app measures no
//                          population, so there is nothing for a scope control to narrow —
//                          `createAppShell` is called with `pages` alone, no `appbarScope`.
//
// Both absences are facts about the product rather than gaps in the port, which is why they
// are written down here: a scorecard reading "2 of 12 missing" would otherwise be read as a
// backlog item. The one contract that IS registered with a skip — syncCaption's
// `railHasSyncZone: false` — is the same kind of fact, and it says so in the run summary
// rather than silently not running.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SEVERITY_COLORS } from "../src/domain/config";
import { LANE_ICONS, ROUTE_ICONS } from "../src/client/js/routeIcons.js";

import { ratio, registerTokenContract } from "../../gas_shared/test/contracts/tokens.js";
import { registerEmptyStateContract } from "../../gas_shared/test/contracts/emptyStates.js";
import { registerNavGroupContract } from "../../gas_shared/test/contracts/navGroups.js";
import { registerPageHeaderContract } from "../../gas_shared/test/contracts/pageHeader.js";
import { registerBrandMarkContract } from "../../gas_shared/test/contracts/brandMark.js";
import { registerDiagnosticsContract } from "../../gas_shared/test/contracts/diagnostics.js";
import { registerParityContract } from "../../gas_shared/test/contracts/parity.js";
import { registerZScaleContract } from "../../gas_shared/test/contracts/zscale.js";
import { registerRelativeAgeContract } from "../../gas_shared/test/contracts/relativeAge.js";
import { relativeAge } from "../../gas_shared/ui/figures.js";
import { registerSyncCaptionContract } from "../../gas_shared/test/contracts/syncCaption.js";

const APP_ROOT = new URL("../", import.meta.url);
const base = { describe, it, expect, beforeAll, afterAll, appRoot: APP_ROOT, app: "hub" };

// The manifest, restated. app.js is the source (configureApp) and the navGroups contract
// reads defaultRoute back out of it; these two are what the splash contract holds the copy to.
// "Wiz Sidekick" with no register word after it: the hub is the product, the three registers
// are what it opens. OPENING_NOUN is "hub" rather than "register" for the same reason, and it
// is the one string on the boot splash that tells a stale MANIFEST parse from a live one.
const PRODUCT_NAME = "Wiz Sidekick";
const OPENING_NOUN = "hub";

// SEVERITY_COLORS ONLY — this app has no SEVERITY_TEXT twin and no SLA windows, so the
// contract reads the six `--sev-*-text` tokens out of gas_shared/styles/tokens.base.css for
// the former (which this app ships like every other) and turns the remediation-window
// assertion into a named skip for the latter. src/domain/config.ts's own header says why the
// file exists at all in an app that draws no severity: tokens.js reads SEVERITY_COLORS off
// ctx with no fallback and would throw rather than skip.
registerTokenContract({ ...base, severity: { SEVERITY_COLORS } });

registerNavGroupContract({
  ...base,
  // LANE_ICONS is `{}`: every route is `group: null`, so there is no labelled lane to mark.
  // The contract asserts that emptiness against PAGES rather than taking it on trust.
  LANE_ICONS,
  ROUTE_ICONS,
  expectedRoutes: ["hub", "settings"],
  defaultRoute: "hub",
});

// ONE h1 PER PAGE, IT SAYS WHICH PAGE, AND ONLY A fullBleed ROUTE MAY WRITE ITS OWN. Both
// halves are empty here — no route declares fullBleed and no module renders its own h1 — so
// the rule is satisfied by both sides being empty and starts biting the moment either grows.
// No sharedHeaderRoutes: this app has no `help` route to hand over to gas_shared/ui/helpPage.js.
registerPageHeaderContract(base);

registerBrandMarkContract({ ...base, productName: PRODUCT_NAME, openingNoun: OPENING_NOUN });

registerParityContract({
  ...base,
  // ONE local module, and it is the one component no sibling has: the launcher tile. The
  // contract's `readdirSync` of src/client/js/ui/ is unguarded, so this directory has to
  // exist and hold at least one file — `tile.js` is genuinely this app's, not a floor met
  // for the test's sake.
  localUiModules: ["tile.js"],
  // Ten sheets, not eleven: help.css is dropped with the help route. tables.css and sheet.css
  // stay — confirmDialog (the access panel's removal confirmation) and the settings chrome
  // both reach into them.
  sheetOrder: [
    "../../../gas_shared/styles/tokens.base.css",
    "./styles/tokens.css",
    "../../../gas_shared/styles/base.css",
    "../../../gas_shared/styles/components.css",
    "../../../gas_shared/styles/tables.css",
    "../../../gas_shared/styles/sheet.css",
    "../../../gas_shared/styles/feedback.css",
    "../../../gas_shared/styles/settings.css",
    "./styles/pages.css",
    "../../../gas_shared/styles/overrides.css",
  ],
  localSheets: ["./styles/tokens.css", "./styles/pages.css"],
});

registerZScaleContract(base);

registerEmptyStateContract({
  ...base,
  routes: ["hub", "settings"],
  // BOTH PAGES CARRY A FAILURE PATH, and both say "Couldn't". hub.js's is the bootstrap that
  // draws the whole launcher; settings.js's is the api_getUrls call behind the URLs panel.
  errorStateCarriers: ["hub", "settings"],
  // No page here uses the per-section `guard()` helper — with two pages and one RPC each
  // there is no second section for a first one's failure to blank.
  guardedRoutes: [],
  // EMPTY, AND IT IS NOT AN OVERSIGHT. `firstRunNotice` is for a page drawing figures over a
  // ledger nobody has read yet, so the reader knows where the zeroes came from. This app
  // reads no ledger and publishes no figure: a tile with no URL is not an unmeasured
  // population, it is a setting nobody has filled in, and it says exactly that in its own
  // words (ui/tile.js's UNSET_NOTE) rather than through a first-run banner.
  firstRunRoutes: [],
});

registerDiagnosticsContract({
  ...base,
  // TWO SECTIONS, AND THE THREE THAT ARE MISSING ARE MISSING BY CONSTRUCTION. No
  // `credentials`: this app calls no third-party API and stores no secret, so there is no
  // credential whose presence could be reported — and with no credentials card there is no
  // `missingTone` to choose, which the contract asserts in as many words. No `lastSync` and
  // no storage meter: it runs no scan and owns no spreadsheet. No error log: there is no
  // job to fail.
  sections: ["product", "build"],
});

registerRelativeAgeContract({ ...base, relativeAge });

// THE ONE CONTRACT REGISTERED WITH A SKIP, and the skip is the reason the flag was added to
// the shared factory. This app hands `createAppShell` no `railFooter`: it runs no scan and no
// sync and reads no register's data, so its rail has no freshness sentence to build with
// syncCaption() and no timestamp one could date. The prohibition half — never grow an inline
// Math.floor day-count back into app.js — still runs, because that one is about what an
// app.js may not contain rather than about what it must call.
registerSyncCaptionContract({ ...base, railHasSyncZone: false });

// =========================================================================================
//  This app's brand, pinned by value
// =========================================================================================
//
// The contracts above state what any brand owes; these are the answers THIS app chose. They
// are here rather than in the shared file for exactly that reason — and the arithmetic is the
// shared `ratio()`, not a second implementation.

const TOKENS = readFileSync(new URL("../src/client/styles/tokens.css", import.meta.url), "utf8");
const tokenValue = (name) => TOKENS.match(new RegExp("--" + name + ":\\s*([^;]+);"))[1].trim();

describe("hub: the accent this app chose", () => {
  it("is graphite, carrying its own ink and needing no edge", () => {
    expect(tokenValue("accent")).toBe("#0a0a0a");
    expect(tokenValue("accent-hover")).toBe("#27272a");
    expect(tokenValue("accent-text")).toBe("#0a0a0a");
    expect(tokenValue("accent-edge")).toBe("transparent");
    expect(tokenValue("on-accent")).toBe("#fafafa");
  });

  // THE COLLAPSE IS EARNED, NOT ASSUMED. --accent-text may point at --accent, and
  // --accent-edge may be transparent, only because the fill clears the 4.5:1 TEXT floor on
  // its own — a stronger claim than the 3:1 graphical-mark floor the shared contract checks.
  // gas_devsecops's #ffcb13 is 1.52:1 and buys neither; this is what the split exists for.
  it("earns --accent-text === --accent by clearing the TEXT floor as a fill", () => {
    expect(ratio(tokenValue("accent"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  // The hub borrows no register's hue. Graphite is base.css's own primary-button colour, and
  // this pins that the brand did not quietly drift onto one of the three tile fills.
  it("is not any of the four tile colours — the hub belongs to no register", () => {
    const accent = tokenValue("accent");
    for (const t of ["tile-os", "tile-ai", "tile-dso", "tile-soon"]) {
      expect(tokenValue(t), "--accent has drifted onto --" + t).not.toBe(accent);
    }
  });
});

// =========================================================================================
//  The four tiles, measured
// =========================================================================================
//
// The option board's own table, restated as arithmetic against the tokens that shipped —
// values read from tokens.css rather than typed twice, so a hand-edit to the token is what
// this fails on rather than a stale copy of it here.
describe("hub: the four tile colours carry their ink", () => {
  // THREE PAIRS, NOT FOUR — and the missing one is the point. This table used to carry
  // ["Coming soon", "on-tile-soon", "tile-soon"] and assert white on #52525b at 6.4:1. That
  // claim — "ink on a grey FILL" — no longer describes anything on the page: `coming soon` is
  // drawn as a bordered card on the page's own ground (`.tile--soon`, styles/pages.css), so
  // there is no grey surface for white to sit on and --on-tile-soon has been removed with it.
  // The colour's real obligation now is the 3:1 graphical-mark floor, asserted below.
  const PAIRS = [
    ["OS Patching", "on-tile-os", "tile-os"],
    ["AI", "on-tile-ai", "tile-ai"],
    ["DevSecOps", "on-tile-dso", "tile-dso"],
  ];

  it("clears 4.5:1 for every ink-on-fill pair, since a tile is all text", () => {
    for (const [label, ink, fill] of PAIRS) {
      expect(ratio(tokenValue(ink), tokenValue(fill)), label).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("draws the unbuilt fourth as a BORDER on the page, not as a fourth block of colour", () => {
    // An unbuilt thing must not carry the same visual weight as three real products. So
    // --tile-soon owes the 3:1 GRAPHICAL-MARK floor (it is a 1px line) rather than the 4.5:1
    // text floor a fill would owe under its ink — and the tile's words are the app's own
    // --ink / --text-2, which the shared base tokens already hold to their own floors.
    expect(
      ratio(tokenValue("tile-soon"), "#ffffff"),
      "--tile-soon is a mark, not a fill: it draws .tile--soon's border and its offset echo",
    ).toBeGreaterThanOrEqual(3);
    // The DECLARATION, not the string: tokens.css's own measured block explains in prose why
    // there is no --on-tile-soon any more, and a `toContain` sweep would read that sentence
    // as the token it forbids.
    expect(TOKENS, "--on-tile-soon is back — nothing is filled with --tile-soon any more")
      .not.toMatch(/^\s*--on-tile-soon:/m);
    const PAGES_CSS = readFileSync(
      new URL("../src/client/styles/pages.css", import.meta.url), "utf8",
    );
    const block = PAGES_CSS.slice(
      PAGES_CSS.indexOf(".tile--soon {"), PAGES_CSS.indexOf("}", PAGES_CSS.indexOf(".tile--soon {")),
    );
    expect(block, "the .tile--soon block was not found in pages.css").toBeTruthy();
    expect(block, "the coming-soon tile has grown a fill again")
      .toMatch(/background:\s*var\(--page\)/);
    expect(block, "the coming-soon tile lost the border that is now its only colour")
      .toMatch(/border:\s*1px solid var\(--tile-soon\)/);
  });

  it("records that the yellow cannot stand on white — which is why --tile-dso-edge is "
    + "mandatory", () => {
    // 1.52:1: under even the 3:1 graphical-mark floor, so the DevSecOps tile's fill is not a
    // legal mark on the page background by itself. `.tile--dso` therefore carries
    // `box-shadow: inset 0 0 0 1px var(--tile-dso-edge)` ON THE MODIFIER — there is no code
    // path that reaches the yellow and skips the edge — and the offset outline behind that
    // tile takes the edge colour too rather than the fill, for the same reason. The other
    // three fills clear 3:1 on white unaided and draw their own hue.
    expect(ratio(tokenValue("tile-dso"), "#ffffff")).toBeLessThan(3);
    expect(tokenValue("tile-dso-edge")).toBe("rgba(0, 0, 0, 0.40)");
    for (const name of ["tile-os", "tile-ai", "tile-soon"]) {
      expect(ratio(tokenValue(name), "#ffffff"), name).toBeGreaterThanOrEqual(3);
    }
  });

  // THE EDGE IS NOT A CLASS SOMEONE CAN FORGET, and this is the assertion that says so: the
  // inset ring is declared inside the `.tile--dso` block itself, alongside the fill it
  // rescues, not in a separate `.tile--edged` a DevSecOps tile could be drawn without.
  it("declares the mandatory edge in the same block as the fill it rescues", () => {
    const PAGES_CSS = readFileSync(
      new URL("../src/client/styles/pages.css", import.meta.url), "utf8",
    );
    const block = PAGES_CSS.slice(
      PAGES_CSS.indexOf(".tile--dso {"), PAGES_CSS.indexOf(".tile--soon {"),
    );
    expect(block, "the .tile--dso block was not found in pages.css").toContain("--tile-dso");
    expect(block, "the yellow fill can now be drawn without its edge")
      .toMatch(/box-shadow:\s*inset[^;]*var\(--tile-dso-edge\)/);
  });
});
