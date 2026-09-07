// This register's end of the shared design-system contracts.
//
// The rules live in `gas_shared/test/contracts/` as SPEC FACTORIES rather than as test
// files, because `vitest.config.ts` collects only this package's `test/` directory — a
// shared contract cannot be a test, it has to be a function this file calls with vitest's
// own describe/it/expect and this app's specifics. Six of them: tokens, empty states, nav
// groups, brand mark, parity and the z scale.
//
// WHAT MOVED HERE, AND FROM WHERE:
//   test/tokens.test.js      deleted; its severity, accent-split, primary-button, chart-ACCENT
//                            and hex-literal rules are the tokens contract, now stated as
//                            arithmetic over any brand rather than as three literal hexes.
//                            The three literals it also asserted are kept below, in the one
//                            block that IS about this app's brand rather than about the rule.
//   test/navGroups.test.js   deleted; every assertion is in the navGroups contract, with the
//                            landing-route check reading the manifest instead of store.js's
//                            old DEFAULT_ROUTE constant.
//   test/emptyStates.test.js kept, minus §1 and §5 — those two are true of every sidekick and
//                            are the empty-state contract. What stayed is this register's own
//                            first-run panel, its P90 caption and its "not measured" rate
//                            view, which are assertions about ITS view functions.
//
// The brand mark, parity and z-scale contracts are NEW here: gas_ai had a brandMark test and
// this app never did, so its splash shipped "Opening the graph…" over a register with no
// graph until the manifest gave the copy one source.

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SEVERITY_COLORS, SEVERITY_TEXT, SLA_TARGETS } from "../src/domain/config";
import { LANE_ICONS, ROUTE_ICONS } from "../src/client/js/routeIcons.js";

import { ratio, registerTokenContract } from "../../gas_shared/test/contracts/tokens.js";
import { registerEmptyStateContract } from "../../gas_shared/test/contracts/emptyStates.js";
import { registerNavGroupContract } from "../../gas_shared/test/contracts/navGroups.js";
import { registerPageHeaderContract } from "../../gas_shared/test/contracts/pageHeader.js";
import { registerBrandMarkContract } from "../../gas_shared/test/contracts/brandMark.js";
import { registerDiagnosticsContract } from "../../gas_shared/test/contracts/diagnostics.js";
import { registerParityContract } from "../../gas_shared/test/contracts/parity.js";
import { registerScopeContract } from "../../gas_shared/test/contracts/scope.js";
import { scopeChrome, scopeKinds } from "../src/client/js/ui/projectScope.js";
import * as SCOPE_MODEL from "../../gas_shared/ui/scopeModel.js";
import { registerZScaleContract } from "../../gas_shared/test/contracts/zscale.js";
import { registerRelativeAgeContract } from "../../gas_shared/test/contracts/relativeAge.js";
import { figureCardModel, relativeAge } from "../../gas_shared/ui/figures.js";
import { registerFigureCardContract } from "../../gas_shared/test/contracts/figureCard.js";
import { registerQuadContract } from "../../gas_shared/test/contracts/quad.js";
import { quadModel } from "../../gas_shared/ui/quad.js";
import { registerSparklineContract } from "../../gas_shared/test/contracts/sparkline.js";
import { sparkLabel, sparkPath } from "../../gas_shared/ui/sparkline.js";
import { registerSyncCaptionContract } from "../../gas_shared/test/contracts/syncCaption.js";
import { registerHubUrlContract } from "../../gas_shared/test/contracts/hubUrl.js";
import { normalizeHubUrl } from "../src/server/hubUrl";

const APP_ROOT = new URL("../", import.meta.url);
const base = { describe, it, expect, beforeAll, afterAll, appRoot: APP_ROOT, app: "devsecops" };

// The manifest, restated. app.js is the source (configureApp) and the navGroups contract
// reads defaultRoute back out of it; these two are what the splash contract holds the copy to.
const PRODUCT_NAME = "Wiz Sidekick DevSecOps";
const OPENING_NOUN = "register";

registerTokenContract({
  ...base,
  severity: { SEVERITY_COLORS, SEVERITY_TEXT, SLA_TARGETS },
});

registerEmptyStateContract({
  ...base,
  routes: [
    "executive", "mttr", "program",
    "sca", "sast", "secrets",
    "repos", "history", "data",
    "settings",
  ],
  errorStateCarriers: [
    "data", "executive", "history", "mttr", "program", "repos", "settings",
  ],
  guardedRoutes: ["executive", "mttr", "program"],
  // EIGHT pages now (Wave 1, item 1.1 added "repos" — it was the one page below the front
  // door that never stated its origin: `renderDensity`'s "no repository profile yet" empty
  // state used to say nothing about WHEN, or whether, a sync had ever run). `repos` reads
  // `await bootstrap()` itself, the same fresh await mttr/program/history/data make, so it
  // joins `firstRunBootstrapRoutes` too rather than `firstRunRoutes` alone.
  //
  // `firstRunBootstrapRoutes` is otherwise the original four: sca/sast/secrets read
  // `bootstrapCached()`, not `await bootstrap()` — safe only because
  // `gas_shared/shell/appShell.js`'s own boot() already awaits bootstrap() once before any
  // route mounts, which is a guarantee those three pages take rather than repeat, so widening
  // the eight-route list must not also widen the literal-text check for a fresh await that
  // only the other five pages actually make.
  firstRunRoutes: ["mttr", "program", "history", "data", "sca", "sast", "secrets", "repos"],
  firstRunBootstrapRoutes: ["mttr", "program", "history", "data", "repos"],
  // "data" renders its notice only inside the branch where latestSync is already known
  // falsy (see pages/data.js's comment at the call site) — synced is a literal `false`
  // there, never a derived value, so there is never a date to carry.
  firstRunNoAt: ["data"],
});

registerNavGroupContract({
  ...base,
  LANE_ICONS,
  ROUTE_ICONS,
  // The key sheet joined the Data lane in the help-route package; this list moves only when
  // a route is added or removed on purpose.
  expectedRoutes: [
    "executive", "mttr", "program",
    "sca", "sast", "secrets",
    "repos", "history", "data", "help",
    "settings",
  ],
  defaultRoute: "executive",
});

registerBrandMarkContract({ ...base, productName: PRODUCT_NAME, openingNoun: OPENING_NOUN });

// ONE h1 PER PAGE, IT SAYS WHICH PAGE, AND ONLY A fullBleed ROUTE MAY WRITE ITS OWN — see
// gas_ai's registration for the rule and gas's for why an app with neither fullBleed half
// populated still runs it rather than skipping. Both are empty here too.
registerPageHeaderContract({
  ...base,
  sharedHeaderRoutes: {
    help: "the header is drawn by gas_shared/ui/helpPage.js, which passes route: \"help\" itself; this app's pages/help.js is one line of wiring that hands over helpContent.js and nothing else",
  },
});

registerParityContract({
  ...base,
  // Two modules that are genuinely this register's, neither a fork of a shared one:
  // `projectScope.js` reads src/domain/projectScope.ts and means nothing in a sibling with no
  // repositories; `verdict.js` is the capacity dot-and-word `pages/program.js` and
  // `pages/repos.js` both draw — promoted out of program.js in Wave C once a second page
  // wanted the identical mark, but never pushed down into gas_shared because neither sibling
  // register has a capacity verdict to draw it for.
  localUiModules: ["projectScope.js", "verdict.js"],
  sheetOrder: [
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
  ],
  localSheets: ["./styles/tokens.css", "./styles/pages.css"],
});

registerZScaleContract(base);

// =========================================================================================
//  This app's brand, pinned by value
// =========================================================================================
//
// The contract above states what any brand owes; these three are the answers THIS register
// chose, and they are here rather than in the shared file for exactly that reason. They came
// verbatim from the deleted test/tokens.test.js — a rewrite that generalised the rule must
// not quietly stop pinning the values the rule was written for.

const TOKENS = readFileSync(new URL("../src/client/styles/tokens.css", import.meta.url), "utf8");
const tokenValue = (name) => TOKENS.match(new RegExp("--" + name + ":\\s*([^;]+);"))[1].trim();

describe("devsecops: the accent this register chose", () => {
  it("is the yellow, with its ink and its edge", () => {
    expect(tokenValue("accent")).toBe("#ffcb13");
    expect(tokenValue("accent-text")).toBe("#7c4a0a");
    expect(tokenValue("accent-edge")).toBe("rgba(0, 0, 0, 0.40)");
    expect(tokenValue("on-accent")).toBe("#171717");
  });

  it("records that the identity token cannot carry text — which is WHY the split exists", () => {
    expect(ratio(tokenValue("accent"), "#ffffff")).toBeLessThan(3);
  });

  it("puts near-black on an accent fill, never white", () => {
    const A = tokenValue("accent");
    expect(ratio("#171717", A)).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#ffffff", A)).toBeLessThan(3);
  });
});

// =========================================================================================
//  The scope seam: what this register slices by, and what a pick puts on the wire
// =========================================================================================
//
// THE PAYLOAD TABLE IS WRITTEN DOWN FROM THE DELETED IMPLEMENTATION. `projectScopeControl`'s
// `onChange` handed app.js a bare slug and `pickProjectScope` passed it to
// `call("api_setProjectView", { projectView: slug })`. That object is what the one kind's
// `payload(id)` builds now, and `renderAppbar` unwraps `.projectView` from it so
// `pickProjectScope`'s own signature — and its two tests — did not change.
//
// ONE KIND, SO IT IS THE BARE ONE. There is no second dimension for a slug to collide with,
// and `settingsStore.projectView` holds an unprefixed slug, so a stored scope survives the
// move to the shared model untouched.
registerScopeContract({
  ...base,
  model: SCOPE_MODEL,
  scopeKinds,
  scopeChrome,
  data: {
    filterOptions: {
      projectList: [{ slug: "value-chain", name: "VALUE-CHAIN", findings: 826, isFolder: false }],
    },
    scope: { register: 1204, shown: 826, projectView: "", unattributed: 17 },
  },
  payloads: [
    { kind: "project", id: "value-chain", payload: { projectView: "value-chain" } },
  ],
  resetPayload: { projectView: "" },
});

// =========================================================================================
//  The Settings -> System read-outs
// =========================================================================================
registerDiagnosticsContract({
  ...base,
  // FOUR SECTIONS, AND NO STORAGE AND NO ERRORS. Cell usage is on the Data page (readModels.ts
  // publishes `cellLimit` and pages/data.js's cellsSummary computes the ratio), and this
  // register's api_getRecentErrors covers job failures only — api.ts says so in `covers` — and
  // is rendered on the Data page too. Nothing moved between pages when these four became cards.
  sections: ["product", "build", "credentials", "lastSync"],
  // A register with nothing to sync is broken here, which is why the same boolean gas_ai draws
  // `neutral` is drawn `bad`. The shared section refuses to default the tone for that reason.
  credentialsTone: "bad",
});

// =========================================================================================
//  The one clock-relative label — the rail's syncCaption() calls this; this app's rail
//  footer had no relative age at all before P8.
// =========================================================================================
registerRelativeAgeContract({ ...base, relativeAge });
registerSyncCaptionContract(base);

// =========================================================================================
//  The three primitives this wave added, and the arithmetic each of them can get wrong
// =========================================================================================
//
// NO NAMED SKIPS HERE, and that is a claim rather than an omission. The other contracts in
// this file carry optional halves because the three registers genuinely differ (gas_ai has no
// error log; gas_hub has no sync caption). These three do not: `quadModel`, `sparkPath` and
// `figureCardModel` are pure functions with no app-specific input at all, so every assertion
// below runs in every app that registers them. If a future app cannot run one of these, the
// reason belongs beside a named skip — a silent pass is the failure mode this whole directory
// guards against.
//
// THE MODEL HALVES ARE HANDED OVER, the DOM halves are swept as source text: this package has
// no jsdom (no `environment` in vitest.config.ts), which is the same reason `emptyStates.js`
// reads code rather than rendering.
registerQuadContract({ ...base, quadModel });
registerSparklineContract({ ...base, sparkPath, sparkLabel });
registerFigureCardContract({ ...base, figureCardModel });

// =========================================================================================
//  The hub link: one rule, this register's boundary and the shared header gate
// =========================================================================================
//
// `normalizeHubUrl` is handed over rather than imported inside the contract, because the
// contract runs from three different packages and each has its own server copy — the copies
// exist because no `src/server/**` module here imports gas_shared (tsconfig has no `allowJs`),
// and this table is what holds them to the same rule.
registerHubUrlContract({ ...base, normalizeHubUrl });
