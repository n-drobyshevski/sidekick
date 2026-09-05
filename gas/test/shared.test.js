// This register's end of the shared design-system contracts.
//
// The rules live in `gas_shared/test/contracts/` as SPEC FACTORIES rather than as test
// files, because `vitest.config.ts` collects only this package's `test/` directory — a
// shared contract cannot be a test, it has to be a function this file calls with vitest's
// own describe/it/expect and this app's specifics.
//
// ALL SIX ARE REGISTERED HERE NOW. `brandMark` was the one that was not: its banner said it
// reads `src/client/index.html`, which P4 did not own, and that "registering it is a one-line
// change for whichever package takes index.html". P5 took index.html — there is no per-app
// copy of it any more, just `gas_shared/shell/index.template.html` rendered from this app's
// MANIFEST — so it is registered below, and this register's splash mark is held to the
// module's geometry for the first time.
//
// The two claims gas's own `test/brandMark.test.js` made that the contract did not (the two
// stroke widths, and pageShell's mark staying decorative) were promoted INTO the contract
// rather than dropped, so all three registers gained them and this app lost nothing. That
// file is deleted with the local `brandMark.js` fork it imported.
//
// `parity`, `emptyStates` and `navGroups` arrived with P4, when ui.js became a barrel over
// `gas_shared/ui/index.js` and api.js / store.js were deleted in favour of the shared pair.
// Each is registered with this app's own specifics below, and each one's argument list is
// where a claim about THIS register lives.

import { readFileSync } from "node:fs";
import { describe, expect, it, afterAll, beforeAll } from "vitest";

import { SEVERITY_COLORS, SLA_TARGETS } from "../src/domain/config";

import { registerBrandMarkContract } from "../../gas_shared/test/contracts/brandMark.js";
import { registerEmptyStateContract } from "../../gas_shared/test/contracts/emptyStates.js";
import { registerNavGroupContract } from "../../gas_shared/test/contracts/navGroups.js";
import { registerDiagnosticsContract } from "../../gas_shared/test/contracts/diagnostics.js";
import { registerParityContract } from "../../gas_shared/test/contracts/parity.js";
import { registerScopeContract } from "../../gas_shared/test/contracts/scope.js";
import { ratio, registerTokenContract } from "../../gas_shared/test/contracts/tokens.js";
import { registerZScaleContract } from "../../gas_shared/test/contracts/zscale.js";

import { LANE_ICONS, ROUTE_ICONS } from "../src/client/js/routeIcons.js";
import { scopeChrome, scopeKinds } from "../src/client/js/scopeKinds.js";
import * as SCOPE_MODEL from "../../gas_shared/ui/scopeModel.js";

const APP_ROOT = new URL("../", import.meta.url);
const base = { describe, it, expect, appRoot: APP_ROOT, app: "os" };

// What the splash is held to. Written out here rather than read from app.js, which is the
// point: the contract compares these against the MANIFEST and against the rendered markup, so
// a rename that touched only one of the two fails.
const PRODUCT_NAME = "Wiz Sidekick OS";
// P8 settles the final copy for this word. Whatever it becomes, the manifest and the rendered
// splash cannot disagree about it — renderIndex.js fills the template FROM the manifest — so
// this line is the only place a change has to be mirrored.
const OPENING_NOUN = "ledger";

/** The @import specifiers of src/client/styles.css, in cascade order. */
export const SHEET_ORDER = [
  "../../../gas_shared/styles/tokens.base.css",
  "./styles/tokens.css",
  "../../../gas_shared/styles/base.css",
  "../../../gas_shared/styles/components.css",
  "../../../gas_shared/styles/tables.css",
  "../../../gas_shared/styles/sheet.css",
  "../../../gas_shared/styles/feedback.css",
  "../../../gas_shared/styles/settings.css",
  "../../../gas_shared/styles/help.css",
  "./styles/pages.css",
  "../../../gas_shared/styles/overrides.css",
];

// THE DARKENED TEXT TWINS COME FROM THE STYLESHEET HERE, NOT FROM src/domain/config.ts,
// because this register has no SEVERITY_TEXT constant — it never had one. config.ts carries
// SEVERITY_COLORS and SEVERITY_GLYPHS; the six darker twins have only ever existed as the
// --sev-*-text tokens the stylesheet paints labels with. Reading them back out of
// tokens.base.css is therefore not a tautology: it pins the tokens THIS APP RENDERS to the
// six hexes all four surfaces agree on, and the contract's own 4.5:1 arithmetic then runs
// against the values a reader actually sees. When a later package gives gas the domain
// constant its siblings have, swap the source and delete this block.
const TOKEN_BASE = readFileSync(
  new URL("../../gas_shared/styles/tokens.base.css", import.meta.url), "utf8",
);
const sevTextToken = (name) => {
  const m = TOKEN_BASE.match(new RegExp("--sev-" + name + "-text:\\s*([^;]+);"));
  if (!m) throw new Error("tokens.base.css has no --sev-" + name + "-text");
  return m[1].trim();
};
const SEVERITY_TEXT = {
  CRITICAL: sevTextToken("critical"),
  HIGH: sevTextToken("high"),
  MEDIUM: sevTextToken("medium"),
  LOW: sevTextToken("low"),
  INFO: sevTextToken("info"),
  UNKNOWN: sevTextToken("unknown"),
};

registerTokenContract({
  ...base,
  severity: { SEVERITY_COLORS, SEVERITY_TEXT, SLA_TARGETS },
  // The two greys of the unclassified TIER swatch and the neutral funnel rung. They are
  // charts.js's own TIER_COLORS / neutral ramp, which the canvas owns and no CSS token
  // names — inventing a token for them would put a chart's private palette into the shared
  // design vocabulary. Named here rather than smuggled in, so the list is the argument.
  hexAllow: { "pages.css": ["#9ca3af", "#e4e4e9", "#6b7280"] },
});

registerZScaleContract(base);

// =========================================================================================
//  The seam: what this app is still allowed to keep a local copy of
// =========================================================================================
registerParityContract({
  ...base,
  // FIVE MODULES, AND EACH IS A FACT ABOUT AN OS-VULNERABILITY REGISTER that means nothing in
  // a sibling: which two scopes exist (scopeBar), a CVE's page at NIST (nvd), a delta that
  // knows which direction is worse (changeChip), a duration that changes unit across three
  // orders of magnitude (span), and an in/out proportion with arbitrary tones (splitBar).
  //
  // `combobox.js` LEFT THIS LIST FIRST, and it was the only entry that was ever on it under
  // protest. gas_shared/ui/combobox.js resolves an option row's glyph by NAME through
  // gas_shared/ui/uiIcons.js, and two of the four names the scope switcher supplies — `users`
  // and `noTag` — were not in that set; `uiIcon()` falls back to a single dot for an unknown
  // name, silently, so the swap would have blanked the glyph on every support-group row and
  // both no-domain rows with nothing failing. Both glyphs are in the shared set now and an
  // unknown name is reported rather than swallowed, so the fork is deleted and the shared
  // control is what this app draws.
  //
  // `usageMeter.js` LEFT NEXT, AND ITS JUSTIFICATION HERE WAS FALSE. This comment used to
  // claim the ten-million-cell ceiling is "a fact about this app's store, which no sibling
  // has". gas_devsecops/src/server/readModels.ts publishes `cellLimit: 10_000_000` and
  // pages/data.js's `cellsSummary` computes the same ratio off it, so the CEILING is not
  // gas-only; what was gas-only is the WIDGET — a used/total numeral caption over the shared
  // progress recipe, plus warn/bad thresholds, neither of which `meter()` or `progressBar()`
  // carries. A widget the design system lacked is the design system's business, so it is
  // gas_shared/ui/usageMeter.js and this app draws it through the barrel. (gas_ai genuinely
  // cannot use it: its `getStorageStats` publishes no `cellLimit`, so there is no ratio to
  // draw. That is a missing FIGURE, not a missing widget.)
  localUiModules: [
    "changeChip.js", "nvd.js", "scopeBar.js", "span.js", "splitBar.js",
  ],
  sheetOrder: SHEET_ORDER,
});

// =========================================================================================
//  A failure is never dressed as an absence
// =========================================================================================
registerEmptyStateContract({
  ...base,
  // The eight route modules. pages/ also holds accessEditor.js, domainsEditor.js and
  // mttrPaintPlan.js, which are section renderers rather than routes and have no entry in
  // PAGES; the contract resolves `<route>.js` per name, so only routes belong here.
  routes: [
    "executive", "mttr", "program", "overview", "data", "history", "attribution", "settings",
  ],
  // The non-vacuity half: these five still carry the failure messages, on errorState. All
  // seven "Couldn't …" call sites were emptyState before P4 — a crash announced through
  // `role="status"`, in the same dashed box the register uses for "no scan saved yet", with
  // the exception dropped on the floor rather than put in the disclosure.
  //
  // "data" JOINED THE LIST, and this list is a registry rather than a claim, so the addition
  // is what the registry is for. The claim the four-name version encoded was "these are all
  // the routes whose failure paths reach errorState"; it was true when written because the
  // pass that wrote it converted only the sites already spelled `emptyState("Couldn't …")`.
  // pages/data.js's report preview was the same defect wearing different clothes — a
  // hand-rolled failure surface, `el("p")` with the raw exception as body copy and a Retry
  // button beside it, no role="alert" and no disclosure — so the sweep above could not see
  // it and this list did not name it. It is errorState("Couldn't load the report preview.")
  // now, which is the measurement: the route matches the carrier regex where it did not
  // before, and dropping it from this list to keep the test green would have re-hidden
  // exactly the surface the contract exists to find.
  errorStateCarriers: ["executive", "mttr", "overview", "program", "data"],
  // The two pages that render section-by-section behind a guard(), because they are the
  // ones a single failing section must not blank.
  guardedRoutes: ["executive", "program"],
  // THE FIELD NAME IS AN ARGUMENT NOW, so this list is no longer empty.
  //
  // It was `[]`, and the comment here was explicit that the pages DO say the ledger has not
  // been read — `data` and `attribution` both gate on it — and that the contract could not see
  // it because it hard-coded `/latestSync/`, the name gas_devsecops's payload uses. This
  // register's has always called it `latestScan`. The two ways to make the old contract pass
  // were both gaming it: rename a payload field to satisfy a regex, or alias one inside the
  // page to be matched by it. The third way is the one taken — `ctx.syncField`, defaulting to
  // `latestSync` so the two siblings are unchanged — and with it the contract's first-run half
  // runs on three apps instead of two. THAT IS THE MEASUREMENT: these two routes now pass a
  // check that was previously vacuous here, and a perturbation confirms it bites (passing
  // "latestSync" fails both routes).
  syncField: "latestScan",
  //
  // ONE ROUTE, NOT TWO, AND THAT IS A SECOND FINDING. The old comment named `data` and
  // `attribution` as "the two pages that gate on it", and both do gate on `latestScan` — but
  // neither reached for `firstRunNotice` at all; each had hand-rolled its own words. Only
  // `attribution`'s was a PAGE-LEVEL first-run state, so only it is converted. `data`'s two
  // are section notes inside Report and Export ("No scan saved yet — run a scan to generate a
  // report"), which name the specific thing that section cannot do; replacing them with one
  // page-wide notice would say less, in a bigger box, twice. Registering `data` here to make
  // the list look symmetrical would be the tail wagging the page.
  firstRunRoutes: ["attribution"],
});

// =========================================================================================
//  The information architecture has one source
// =========================================================================================
registerNavGroupContract({
  ...base,
  LANE_ICONS,
  ROUTE_ICONS,
  // In rail order. This list moves only when a route is added or removed on purpose.
  // `help` joined it with P7: the key sheet, last page of the Data lane.
  expectedRoutes: [
    "executive", "mttr", "program", "overview", "data", "history", "attribution", "help",
    "settings",
  ],
  defaultRoute: "executive",
  // No `panelBlocksModule`: this register's nav panels list page links and nothing else, so
  // there is no app-side file that may name a lane. See MANIFEST.panelBlocks in app.js for
  // which candidates were considered and why each was rejected.
});

registerBrandMarkContract({
  ...base, beforeAll, afterAll, productName: PRODUCT_NAME, openingNoun: OPENING_NOUN,
});

// =========================================================================================
//  This app's brand, pinned by value
// =========================================================================================
//
// The contract above states what any brand owes; these are the answers THIS register chose,
// and they are here rather than in the shared file for exactly that reason.

const TOKENS = readFileSync(new URL("../src/client/styles/tokens.css", import.meta.url), "utf8");
const tokenValue = (name) => TOKENS.match(new RegExp("--" + name + ":\\s*([^;]+);"))[1].trim();

describe("os: the accent this register chose", () => {
  it("is the signal blue, with its ink equal to its fill and no edge", () => {
    expect(tokenValue("accent")).toBe("#2563eb");
    expect(tokenValue("accent-hover")).toBe("#1d4ed8");
    expect(tokenValue("accent-text")).toBe("#2563eb");
    expect(tokenValue("accent-edge")).toBe("transparent");
    expect(tokenValue("on-accent")).toBe("#ffffff");
  });

  it("records WHY the ink may equal the fill — which is the whole reason there is no edge", () => {
    // gas_devsecops's yellow is 1.52:1 on white and therefore needs both the split and the
    // mandatory edge. This blue clears the text bar on its own, so --accent-text can BE the
    // accent and --accent-edge can be transparent. If this ever stops being true the
    // contract's "a fill that pale needs an edge" assertion fails, and it should.
    expect(ratio(tokenValue("accent"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("does not reuse --sev-low-text as the accent ink", () => {
    // #1d4ed8 is the obvious darker twin and is already spoken for: it is LOW's label
    // colour. A link and a LOW-severity word rendering identically would put the brand
    // inside the one palette that is byte-identical across all four surfaces.
    expect(tokenValue("accent-text")).not.toBe("#1d4ed8");
    expect(tokenValue("accent-hover")).toBe("#1d4ed8"); // it is a FILL hover, never ink
  });

  it("puts white on an accent fill, never near-black — MEASURED, not assumed", () => {
    // gas_shared/README.md and gas_devsecops/src/client/styles/tokens.css both record
    // "near-black on gas's #2563eb is 1.62:1". That figure is WRONG: it is 3.4686:1, which
    // still fails the 4.5:1 text bar (it clears only the 3:1 graphical-mark bar), so the
    // conclusion the two documents draw from it holds and the number they draw it from does
    // not. White is 5.17:1. Pinned as the real arithmetic so the next reader gets the right
    // one, and so a brand change that flipped the answer would fail here.
    const A = tokenValue("accent");
    expect(ratio("#ffffff", A)).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#ffffff", A)).toBeCloseTo(5.17, 2);
    expect(ratio("#171717", A)).toBeLessThan(4.5);
    expect(ratio("#171717", A)).toBeCloseTo(3.47, 2);
  });

  it("keeps the grouping-chart hues under --chart-cat-*, off the node-palette prefix", () => {
    // These were --cat-1..5 / --cat-other and collided head-on with tokens.base.css's
    // --cat-<kind>-ink/text/tint. The values did not move; only the prefix did, and
    // charts.js's CATEGORICAL array is the copy the canvas consumes.
    expect(tokenValue("chart-cat-1")).toBe("#2563eb");
    expect(tokenValue("chart-cat-2")).toBe("#0d9488");
    expect(tokenValue("chart-cat-3")).toBe("#90396a");
    expect(tokenValue("chart-cat-4")).toBe("#7fba04");
    expect(tokenValue("chart-cat-5")).toBe("#f66bb9");
    expect(tokenValue("chart-cat-other")).toBe("#94a3b8");
    // Comments are stripped first: this file's own comment explains the rename and
    // therefore SAYS "--cat-1..5". The claim is about declarations, not about prose.
    expect(TOKENS.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/--cat-[0-9]/);

    const charts = readFileSync(new URL("../src/client/js/charts.js", import.meta.url), "utf8");
    for (const hex of ["#2563eb", "#0d9488", "#90396a", "#7fba04", "#f66bb9"]) {
      expect(charts).toContain(hex);
    }
    expect(charts).toContain("--chart-cat-*");
  });
});

// =========================================================================================
//  The stylesheet index, until the parity contract can hold it
// =========================================================================================
describe("os: the stylesheet index imports the shared sheets in cascade order", () => {
  const INDEX = readFileSync(new URL("../src/client/styles.css", import.meta.url), "utf8");
  const imports = [...INDEX.matchAll(/@import\s+"([^"]+)"/g)].map((m) => m[1]);

  it("names them in exactly the documented order", () => {
    expect(imports).toEqual(SHEET_ORDER);
  });

  it("puts overrides.css last, which is what makes it an override", () => {
    // Reduced motion and the phone layout are the last word by position, not by
    // specificity. A sheet appended after it would silently outrank both.
    expect(imports[imports.length - 1]).toMatch(/overrides\.css$/);
  });

  it("keeps the two local sheets local, and everything else shared", () => {
    const local = imports.filter((p) => p.startsWith("./"));
    expect(local).toEqual(["./styles/tokens.css", "./styles/pages.css"]);
  });
});

// =========================================================================================
//  The scope seam: what this register slices by, and what a pick puts on the wire
// =========================================================================================
//
// THE PAYLOAD TABLE IS WRITTEN DOWN FROM THE DELETED IMPLEMENTATION, which is the only way it
// can be a check rather than a restatement. `scopeSwitch.js`'s `onPick` handed app.js
// `{kind: "domain"|"supportGroup", value}`; `pickScope` then set one module variable, cleared
// the other, and `activeScope()` returned `{domain, supportGroup}` — the object every page's
// RPC takes. That object is what the kinds' own `payload(id)` now builds directly, and these
// three rows are it.
registerScopeContract({
  ...base,
  model: SCOPE_MODEL,
  scopeKinds,
  scopeChrome,
  data: {
    scopeCounts: {
      register: 161,
      domains: { CROSS: 40, Payments: 30 },
      supportGroups: { "CS-CORE": 31 },
      unassigned: 12,
      noSupportGroup: 104,
      notAttributable: 0,
      unassignedBase: 0,
    },
    domainNames: ["CROSS", "Payments"],
    filterOptions: { supportGroups: ["CS-CORE"] },
  },
  payloads: [
    { kind: "domain", id: "CROSS", payload: { domain: "CROSS", supportGroup: "" } },
    { kind: "supportGroup", id: "CS-CORE", payload: { domain: "", supportGroup: "CS-CORE" } },
  ],
  resetPayload: { domain: "", supportGroup: "" },
});

// =========================================================================================
//  The Settings -> System read-outs
// =========================================================================================
registerDiagnosticsContract({
  ...base,
  beforeAll,
  afterAll,
  // THREE SECTIONS, AND THE THREE THIS APP IS MISSING ARE NOT OVERSIGHTS. There is no
  // credentials card — `hasCredentials` here only disables a Lifecycle job button, and this
  // register has no dry-run mode to announce. There is no last-sync line because no
  // `latestSync` field exists in this bootstrap at all. There is no product name because this
  // app never printed one. Adding any of them is a product decision, not a tidy-up, and this
  // list is what makes that decision visible in a diff.
  //
  // Storage is here and in neither sibling: gas_devsecops shows its cell usage on the Data
  // page, and gas_ai's getStorageStats publishes no `cellLimit`, so there is no ratio for a
  // meter to draw.
  sections: ["storage", "errors", "build"],
});
