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

import { renderExecutive } from "./pages/executive.js";
import { renderOverview } from "./pages/overview.js";
import { renderMttr } from "./pages/mttr.js";
import { renderProgram } from "./pages/program.js";
import { renderColdZone } from "./pages/coldZone.js";
import { renderHistory } from "./pages/history.js";
import { renderData } from "./pages/data.js";
import { renderSettings } from "./pages/settings.js";
import { renderAttribution } from "./pages/attribution.js";
import { renderHelp } from "./pages/help.js";

// THE ONE SOURCE for both the router and the nav. Order matters twice over: pages are drawn
// in this insertion order, LANES ARE THE CONTIGUOUS RUNS OF ONE `group` (navModel.railItems
// walks it once and joins a page to the item still open, so a lane split in two would draw
// two items with one name), and the first key is the app's default landing page — which
// app.js's MANIFEST.defaultRoute names, and test/shared.test.js holds the two together.
//
// `group: null` is the CHROME TAIL: pages that name themselves, drawn under a rule rather
// than under a heading. Settings is the whole tail here — a "Preferences" heading over one
// item would restate the link it sits on.
//
// EXECUTIVE IS IN THE SECURITY LANE, AND IT USED TO HAVE AN "Overview" LANE OF ITS OWN.
// A labelled lane earns its heading by holding two pages. navModel.railItems collapses a
// lane holding one visible page to that page, so on the icon rail "Overview" was never drawn
// — but renderStackedNav below 800px draws every lane heading UNCONDITIONALLY, and there it
// really did render the word "Overview" directly above a single link reading "Executive".
// The old test/navGroups.test.js knew about the collapse and asked multi-page lanes only for
// a mark, so nothing caught the stacked case. Executive belongs here anyway: it, MTTR and
// Program performance are all programme-level reads over the population that OS
// vulnerabilities lists.
export const PAGES = {
  executive: { title: "Executive", group: "Security", render: renderExecutive },
  mttr: { title: "MTTR & SLA", group: "Security", render: renderMttr },
  program: { title: "Program performance", group: "Security", render: renderProgram },
  overview: { title: "OS vulnerabilities", group: "Security", render: renderOverview },
  // LAST IN THE SECURITY LANE, AND AFTER THE REGISTER IT READS. Executive, MTTR and Program
  // performance ask how fast risk is closing; OS vulnerabilities is the register itself. This
  // one asks the other question — where has it stopped — and it belongs after the register
  // rather than before it, because "these assets have gone quiet" is a reading OF the list a
  // reader has just been shown, not a way into it. The lane stays contiguous either way, which
  // navModel.railItems requires.
  coldZone: { title: "Cold zone", group: "Security", render: renderColdZone },
  data: { title: "Data", group: "Data", render: renderData },
  // `history`, not `scan_history`, and the rename is what makes the route table checkable.
  // gas_shared/test/contracts/navGroups.js resolves each route to `pages/<route>.js`, and
  // this one was the only route in the app whose key did not name its own module — the page
  // has always been pages/history.js. ROUTE_ALIASES below keeps every existing
  // #/scan_history link working and rewrites it, so no bookmark is broken by the fix.
  history: { title: "Scan History", group: "Data", render: renderHistory },
  attribution: { title: "Attribution", group: "Data", render: renderAttribution },
  // The book, not the record: helpContent.js's whole glossary, searchable and deep-linkable —
  // where every glossary tip's "Enter for the full definition" has always pointed
  // (gas_shared/ui/tip.js's markTerm), landing on nothing until this route existed. LAST in the
  // lane because a reader reaches for it only after wanting to check a word, never on the way
  // in; in the Data lane rather than the chrome tail because the key sheet IS a page of this
  // register's content. gas_devsecops files it identically and gas_ai does not — the two
  // existing answers disagreed, and this is the one taken here.
  help: { title: "Key sheet", group: "Data", render: renderHelp },
  settings: { title: "Settings", group: null, render: renderSettings },
};
