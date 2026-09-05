// This register's end of the shared design-system contracts.
//
// The rules live in `gas_shared/test/contracts/` as SPEC FACTORIES rather than as test
// files, because `vitest.config.ts` collects only this package's `test/` directory — a
// shared contract cannot be a test, it has to be a function this file calls with vitest's
// own describe/it/expect and this app's specifics. Six of them: tokens, empty states, nav
// groups, brand mark, parity and the z scale.
//
// WHAT MOVED HERE, AND FROM WHERE:
//   test/brandMark.test.js  deleted; the brand-mark contract is a strict superset of it —
//                            same path constants, same globe arithmetic, same middlebox
//                            scan, same pageShell.ts third copy — plus the splash-copy
//                            rules gas_ai never had, which is what put "Wiz Sidekick AI"
//                            under one source instead of three literals.
//   test/navGroups.test.js  deleted; every assertion it made is in the navGroups contract,
//                            which adds seven more (the route list, per-route titles, the
//                            icon grid, one render import per route, and two sweeps over
//                            navModel.js). Its landing-route check read `DEFAULT_ROUTE` out
//                            of store.js; store.js is shared now and the manifest is the
//                            source, which is what the contract reads.
//
// ALL SIX HOLD STRAIGHT NOW. This file used to wrap `it` in `expectingFailure()` to invert
// five assertions the contract could not satisfy here — three because this register has no
// JS twin of the severity text tokens and no per-severity SLA table, two because `Labs` is a
// gated lane of one and the front door is not PAGES[0]. Those were facts about this
// register, not bugs in it, so the fix was hooks on the contract rather than a workaround
// here:
//
//   tokens     SEVERITY_TEXT and SLA_TARGETS are now OPTIONAL inputs. Omitting SEVERITY_TEXT
//              makes the contract read the six `--sev-*-text` tokens out of
//              gas_shared/styles/tokens.base.css itself and run the same darker-than-fill and
//              4.5:1 assertions on them — this register's severity TEXT has only ever existed
//              as that CSS, never as a constant. Omitting SLA_TARGETS turns the remediation-
//              window assertion into a named `it.skip` (this register reads Wiz's own
//              `dueAt` per issue — see src/domain/comboDigest.ts's slaTally — rather than
//              pricing a deadline from severity), so the skip shows in the run summary
//              instead of silently not running.
//   navGroups  `singletonLanes: ["Labs"]` lowers the two-pages-per-lane floor to one for
//              that lane alone — app.js says why in as many words: the heading IS the
//              statement, and the lane draws only when the experimental gate is open.
//              `frontDoorIsFirst: false` drops the PAGES[0] position coupling and asserts
//              instead that the manifest's front door (`problems`) exists in PAGES and is
//              reachable — not gated behind `experimental` — since a mistyped deep link
//              falls back to it.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SEVERITY_COLORS } from "../src/domain/config";
import { LANE_ICONS, ROUTE_ICONS } from "../src/client/js/routeIcons.js";

import {
  composite, ratio, registerTokenContract,
} from "../../gas_shared/test/contracts/tokens.js";
import { registerEmptyStateContract } from "../../gas_shared/test/contracts/emptyStates.js";
import { registerNavGroupContract } from "../../gas_shared/test/contracts/navGroups.js";
import { registerBrandMarkContract } from "../../gas_shared/test/contracts/brandMark.js";
import { registerDiagnosticsContract } from "../../gas_shared/test/contracts/diagnostics.js";
import { registerParityContract } from "../../gas_shared/test/contracts/parity.js";
import { registerScopeContract } from "../../gas_shared/test/contracts/scope.js";
import { scopeChrome, scopeKinds } from "../src/client/js/ui/projectScope.js";
import * as SCOPE_MODEL from "../../gas_shared/ui/scopeModel.js";
import { registerZScaleContract } from "../../gas_shared/test/contracts/zscale.js";
import { registerRelativeAgeContract } from "../../gas_shared/test/contracts/relativeAge.js";
import { relativeAge } from "../../gas_shared/ui/figures.js";
import { registerSyncCaptionContract } from "../../gas_shared/test/contracts/syncCaption.js";

const APP_ROOT = new URL("../", import.meta.url);

const base = {
  describe, it, expect, beforeAll, afterAll, appRoot: APP_ROOT, app: "ai",
};

// The manifest, restated. app.js is the source (configureApp) and the navGroups contract
// reads defaultRoute back out of it; these two are what the splash contract holds the copy
// to. "Wiz Sidekick AI", not "Wiz SIDEKICK AI": the caps were a PoC-header leftover carried
// by three separate literals, and nothing has ever set text-transform on .appbar-name.
const PRODUCT_NAME = "Wiz Sidekick AI";
const OPENING_NOUN = "graph";

// Every route in PAGES order. Moves only when a route is added or removed on purpose.
const ROUTES = [
  "graph", "inventory", "problems", "combos", "config",
  "compliance", "scans", "aars", "data", "settings", "help",
];

registerTokenContract({
  ...base,
  // No SEVERITY_TEXT, no SLA_TARGETS: this register has neither. The contract falls back to
  // reading tokens.base.css for the former and skips the SLA assertion by name for the
  // latter — see the file banner above.
  severity: { SEVERITY_COLORS },
  // recordSheet.css's `.prov-spinner` carries the same masked conic-gradient donut
  // base.css's `.scan-spinner` does, and `#000` inside a `radial-gradient` mask stop is an
  // ALPHA END, not a colour — there is no surface it could name a token for. The contract
  // exempts it for base.css by name for exactly this reason; this is the same construct in
  // the one page sheet that reuses it.
  hexAllow: { "recordSheet.css": ["#000"] },
});

registerEmptyStateContract({
  ...base,
  routes: ROUTES,
  // Every page whose failure path still says "Couldn't …", now on errorState rather than on
  // emptyState. aars, data and settings joined the list in this package: those six call
  // sites announced a thrown render inside a role="status" box in the register's own
  // "nothing here" voice, with the exception dropped into the hint line.
  errorStateCarriers: [
    "aars", "combos", "compliance", "config", "data", "inventory", "problems", "scans",
    "settings",
  ],
  // No route here uses the per-section `guard()` helper the sibling register factored out;
  // these pages catch per section inline (data.js's Promise.allSettled pair, aars.js's three
  // model loads). The list is empty rather than invented — see the handback.
  guardedRoutes: [],
  // ONE ROUTE, AND ONLY ONE EARNS IT. `firstRunNotice` is for a page that still draws its
  // figures over an unread ledger and owes the reader the origin of the zeroes — data.js's
  // storage census is exactly that, and it is the shape the sibling register's data.js uses.
  // The five pages that gate on `!boot.latestSync` (combos, graph, inventory, problems,
  // scans) do not: they replace the whole page with an emptyState and return, which is what
  // emptyState is for. Converting them would swap a box that says "run a sync and here is
  // how" for one quiet line and nothing else.
  firstRunRoutes: ["data"],
});

registerNavGroupContract({
  ...base,
  LANE_ICONS,
  ROUTE_ICONS,
  expectedRoutes: ROUTES,
  defaultRoute: "problems",
  // Labs holds exactly one page (Scoring Models), gated behind the experimental flag — the
  // heading IS the statement, not a lane waiting for a second page. And the front door is
  // `problems`, not PAGES[0] (`graph`) — see the file banner above for both.
  singletonLanes: ["Labs"],
  frontDoorIsFirst: false,
  // THE ONE APP-SIDE FILE THAT MAY NAME A LANE. navModel.js is `gas_shared/shell/navModel.js`
  // now and knows no lane ids at all; the two blocks this register's panels list (saved
  // graph/inventory views under Landscape, combination patterns under Risk) are its own domain
  // knowledge and live here, so this is where the "no lane PAGES does not compose" scan has to
  // point. Without it that check would only ever read the shared file and could not catch a
  // renamed lane on this side.
  panelBlocksModule: "src/client/js/navPanels.js",
});

registerBrandMarkContract({ ...base, productName: PRODUCT_NAME, openingNoun: OPENING_NOUN });

registerParityContract({
  ...base,
  // The ten modules that are genuinely this register's. Every one reads something no sibling
  // has: the decision lattice and its icicle, the ACT/ATTEND/TRACK badge, the Tier 1..4
  // badge, the cascade's claim rail and diagnostic list, the Data page's prune panel, the
  // AARS chip, and this register's project-scope switcher.
  localUiModules: [
    "aarsChip.js", "claimRail.js", "diagList.js", "lattice.js", "latticeIcicle.js",
    "latticeSection.js", "outcome.js", "posture.js", "projectScope.js", "prunePanel.js",
  ],
  sheetOrder: [
    "../../../gas_shared/styles/tokens.base.css",
    "./styles/tokens.css",
    "../../../gas_shared/styles/base.css",
    "../../../gas_shared/styles/components.css",
    "../../../gas_shared/styles/tables.css",
    "../../../gas_shared/styles/sheet.css",
    "../../../gas_shared/styles/feedback.css",
    "../../../gas_shared/styles/settings.css",
    "./styles/inventory.css",
    "./styles/graph.css",
    "./styles/graphQuery.css",
    "./styles/recordSheet.css",
    "./styles/scans.css",
    "./styles/compliance.css",
    "./styles/combos.css",
    "./styles/lattice.css",
    "./styles/aars.css",
    "./styles/help.css",
    "../../../gas_shared/styles/overrides.css",
  ],
  localSheets: [
    "./styles/tokens.css", "./styles/inventory.css", "./styles/graph.css",
    "./styles/graphQuery.css", "./styles/recordSheet.css", "./styles/scans.css",
    "./styles/compliance.css", "./styles/combos.css", "./styles/lattice.css",
    "./styles/aars.css", "./styles/help.css",
  ],
});

registerZScaleContract(base);

// =========================================================================================
//  This app's brand, pinned by value
// =========================================================================================
//
// The contract above states what any brand owes; these are the answers THIS register chose,
// and they are here rather than in the shared file for exactly that reason. gas_ai never had
// a tokens test, so unlike the sibling these are new — but the arithmetic is the shared
// helpers', not a second implementation.

const TOKENS = readFileSync(new URL("../src/client/styles/tokens.css", import.meta.url), "utf8");
const tokenValue = (name) => TOKENS.match(new RegExp("--" + name + ":\\s*([^;]+);"))[1].trim();

describe("ai: the accent this register chose", () => {
  it("is rose-700, carrying its own ink and needing no edge", () => {
    expect(tokenValue("accent")).toBe("#be123c");
    expect(tokenValue("accent-hover")).toBe("#9f1239");
    expect(tokenValue("accent-text")).toBe("#be123c");
    expect(tokenValue("accent-edge")).toBe("transparent");
    expect(tokenValue("on-accent")).toBe("#ffffff");
  });

  // THE COLLAPSE IS EARNED, NOT ASSUMED — and this is the assertion that says so. The
  // five-token split exists because gas_devsecops's #ffcb13 is 1.52:1 on white; this brand
  // may point --accent-text at --accent and leave --accent-edge transparent only because the
  // crimson clears the 4.5:1 TEXT floor on its own, which is a stronger claim than the 3:1
  // graphical-mark floor the contract checks for a fill.
  it("earns --accent-text === --accent by clearing the TEXT floor as a fill", () => {
    expect(ratio(tokenValue("accent"), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("puts white on an accent fill, never near-black", () => {
    const A = tokenValue("accent");
    expect(ratio("#ffffff", A)).toBeGreaterThanOrEqual(4.5);
    // The sibling's answer, and why the token has to exist rather than the rule naming one.
    expect(ratio("#171717", A)).toBeLessThan(3);
  });

  it("keeps its two washes readable, composited over the page rather than assumed", () => {
    for (const name of ["accent-wash", "accent-wash-hover"]) {
      const ground = composite(tokenValue(name), "#ffffff");
      expect(ratio(tokenValue("accent-text"), ground), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// =========================================================================================
//  The scope seam: what this register slices by, and what a pick puts on the wire
// =========================================================================================
//
// THE PAYLOAD TABLE IS WRITTEN DOWN FROM THE DELETED IMPLEMENTATION. `projectScopeControl`'s
// `onChange` split the `d:` prefix off and handed app.js `{kind, value}`; `pickProjectScope`
// then chose between `{domainView}` and `{projectView}` for `api_setSettings`. Those two
// objects are what the kinds' own `payload(id)` builds directly now, and the reset's
// `{projectView: ""}` is the third — the reset row's value is "", which parses to the BARE
// kind (the project), exactly as the old `startsWith("d:")` test did.
registerScopeContract({
  ...base,
  model: SCOPE_MODEL,
  scopeKinds,
  scopeChrome,
  data: {
    filterOptions: {
      projectList: [{ id: "p1", name: "VALUE-CHAIN", assets: 826, isFolder: false }],
      domainList: [{ name: "Payments", assets: 36 }],
    },
    scope: {
      register: 1204,
      shown: 826,
      projectView: "",
      domainView: "",
      domainCoverage: { total: 87, tagged: 36 },
    },
  },
  payloads: [
    { kind: "project", id: "p1", payload: { projectView: "p1" } },
    { kind: "domain", id: "Payments", payload: { domainView: "Payments" } },
  ],
  resetPayload: { projectView: "" },
});

// =========================================================================================
//  The Settings -> System read-outs
// =========================================================================================
registerDiagnosticsContract({
  ...base,
  // TWO SECTIONS, AND THE MISSING ONE THAT MATTERS IS `errors`. This app has NO recent-errors
  // mechanism at all — no errorLog tab, no api_getRecentErrors, nothing — so it draws no card
  // rather than an empty one, which would claim a log exists and happens to be quiet. No
  // storage either: getStorageStats publishes no `cellLimit`, so there is no ratio to meter,
  // and what it does publish is on the Data page. No last-sync line: the field exists, and
  // only the nav rail reads it.
  //
  // The experimental toggle sits BETWEEN these two cards on the tab and is not a diagnostic,
  // which is why this app places the sections itself instead of appending the grid.
  sections: ["credentials", "build"],
  // Dry-run against the bundled sample data is a legitimate way to run this workbook.
  credentialsTone: "neutral",
});

// =========================================================================================
//  The one clock-relative label — the rail's syncCaption() calls this; P8 promoted it out of
//  a coarse (days-only, gated at age >= 2) inline calculation this app's rail footer had.
// =========================================================================================
registerRelativeAgeContract({ ...base, relativeAge });
registerSyncCaptionContract(base);
