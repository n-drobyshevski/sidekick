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
import { relativeAge } from "../../gas_shared/ui/figures.js";
import { registerSyncCaptionContract } from "../../gas_shared/test/contracts/syncCaption.js";

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
  firstRunRoutes: ["mttr", "program", "history", "data"],
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

// ONE h1 PER PAGE, AND ONLY A fullBleed ROUTE MAY WRITE ITS OWN — see gas_ai's registration
// for the rule and gas's for why an app with neither half populated still runs it rather
// than skipping. Both halves are empty here too.
registerPageHeaderContract(base);

registerParityContract({
  ...base,
  // The one module that is genuinely this register's: it reads src/domain/projectScope.ts
  // and means nothing in a sibling with no repositories.
  localUiModules: ["projectScope.js"],
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
