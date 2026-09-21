// The route table: the one source for both the router and the nav.
//
// IT LIVES IN ITS OWN MODULE SO A TEST CAN IMPORT IT. This table used to sit inline in
// app.js, and `gas_shared/test/contracts/navGroups.js` read it back out of that file as
// TEXT with a regex — because app.js touches the DOM at module scope (it calls
// createAppShell() and registers a `hashchange` listener), so importing it into a node test
// was never on. The parser could only see what its line-shaped pattern could match, which is
// why an entry wrapped across three lines once parsed as a route with no title and no lane.
//
// Nothing here touches a document at module scope — neither this file nor any `pages/*.js`
// it imports, nor anything they import from gas_shared — so the contract imports this module
// and reads the real objects instead of guessing at their source.

import { renderHub } from "./pages/hub.js";
import { renderSettings } from "./pages/settings.js";

// TWO PAGES, BOTH `group: null`. Neither is a lane beside the other — a two-item rail with an
// invented heading over it would name a category nobody asked for. navModel.js draws an
// unlabelled `kind: "page"` item per route in that shape, one per page, and the leading
// `.nav-rule` navRail.js expects to separate a labelled lane from a chrome TAIL has no tail to
// separate here — styles/pages.css hides that stray hairline (see its own comment for the two
// draw sites it comes from: the icon rail and the sub-800px stacked list both key off the
// same `group === null` test with no check for "and something labelled came before it").
export const PAGES = {
  // The front door. MANIFEST.defaultRoute names it — a reader wanting a register passes
  // straight through this page and lands on the one they came for.
  hub: { title: "Registers", group: null, render: renderHub },
  settings: { title: "Settings", group: null, render: renderSettings },
};
