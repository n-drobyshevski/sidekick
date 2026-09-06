// Wiz Sidekick — the hub: a graphite launcher over the three sibling registers, and nothing
// else. It reads no register's own data — bootstrap() carries only the four tiles' copy and
// whichever URL an admin has stored for each — and it runs no scan, no sync, no scope switch.
// It defines no vocabulary of its own, so `findHelpEntry` always answers null.
//
// THE SHELL AROUND THIS APP IS THE SAME gas_shared/shell/ THE THREE REGISTERS SHARE — the
// boot splash, the header, the two-tier nav, the hash router. What is left here is what is
// genuinely this app's: what it is called, and its two-page route table. No `railFooter`, no
// `appbarScope`, no `navContext` — this app has no sync battery and no scope dimension to
// hand the shell, so `createAppShell` is called with `pages` alone.

import { configureApp } from "../../../../gas_shared/appConfig.js";
import { createAppShell } from "../../../../gas_shared/shell/appShell.js";
import { renderHub } from "./pages/hub.js";
import { renderSettings } from "./pages/settings.js";
import { LANE_ICONS, ROUTE_ICONS } from "./routeIcons.js";

// ============================================================================ the manifest
//
// HANDED TO THE SHARED CORE BEFORE ANYTHING ELSE IN THIS MODULE BODY RUNS — appConfig.js's
// rule 1. `productName` and `openingNoun` are PLAIN DOUBLE-QUOTED LITERALS on purpose:
// gas_shared/shell/renderIndex.js regex-extracts them straight out of this source file to
// seed the static boot splash the served HTML paints before any script runs, so neither
// string may be built up from a template, a concatenation, or a variable here.
const MANIFEST = {
  productName: "Wiz Sidekick",
  // "Opening the hub…" on the boot splash — not "register": this app has no register of its
  // own, and the word is how a reader tells a stale MANIFEST parse from the real one.
  openingNoun: "hub",
  // Trailing dot: four sidekicks on one origin must not share a localStorage key.
  storagePrefix: "sidekickhub.",
  defaultRoute: "hub",
  // No vocabulary of its own — every glossary lookup answers null rather than reaching for a
  // helpContent.js this app does not have.
  findHelpEntry: () => null,
  // Read by gas_shared/shell/navRail.js (the icon rail and the stacked list) and
  // gas_shared/shell/navFlyout.js (the panel's rows). routeIcons.js draws the marks; the
  // manifest is how the shared shell reaches them.
  LANE_ICONS,
  ROUTE_ICONS,
};

// TWO PAGES, BOTH `group: null`. Neither is a lane beside the other — a two-item rail with an
// invented heading over it would name a category nobody asked for. navModel.js draws an
// unlabelled `kind: "page"` item per route in that shape, one per page, and the leading
// `.nav-rule` navRail.js expects to separate a labelled lane from a chrome TAIL has no tail to
// separate here — styles/pages.css hides that stray hairline (see its own comment for the two
// draw sites it comes from: the icon rail and the sub-800px stacked list both key off the
// same `group === null` test with no check for "and something labelled came before it").
const PAGES = {
  // The front door. MANIFEST.defaultRoute names it — a reader wanting a register passes
  // straight through this page and lands on the one they came for.
  hub: { title: "Registers", group: null, render: renderHub },
  settings: { title: "Settings", group: null, render: renderSettings },
};

// PAGES JOINS THE MANIFEST HERE, below the table, so pageHeader({ route }) reads the same
// title this table declares rather than a second copy of the string living in each page
// module — see the three register apps' own app.js for the longer version of this rule.
// STILL BEFORE ANY SHARED FUNCTION RUNS: everything above this line is a declaration or an
// object literal, no call, and no shared module reads the manifest at import time either
// (appConfig.js's rule 2) — so the first possible read is still after this line executes.
configureApp({ ...MANIFEST, PAGES });

const shell = createAppShell({ pages: PAGES });

export const refresh = shell.refresh;

window.addEventListener("hashchange", shell.route);
shell.boot();
