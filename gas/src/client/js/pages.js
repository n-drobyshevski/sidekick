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
// THE LANES ARE THE ONES gas_devsecops ARRIVED AT INDEPENDENTLY, and that is why they are
// these words. This register used to hold one five-page lane called "Security" — which
// distinguished nothing in a security register, the same objection gas_ai had already made
// about its own six. What a reader actually chooses between is how the programme is doing
// (Program) and what is in the register (Registers), and the sibling had already split it
// exactly there.
//
// "Registers", plural, over a lane holding one register and one reading of it. The singular
// was argued for and lost: a lane label is a category heading, not a count, and shipping
// `Register` here beside `Registers` next door would read as a typo — which is precisely the
// near-miss drift this wave exists to remove.
//
// AN EARLIER DRAFT HAD "Overview" HOLDING EXECUTIVE ALONE. A labelled lane earns its heading
// by holding two pages: navModel.railItems collapses a lane holding one visible page to that
// page, so on the icon rail "Overview" was never drawn — but renderStackedNav below 800px
// draws every lane heading UNCONDITIONALLY, and there it really did render the word
// "Overview" directly above a single link reading "Executive".
export const PAGES = {
  executive: { title: "Executive", group: "Program", render: renderExecutive },
  mttr: { title: "MTTR & SLA", group: "Program", render: renderMttr },
  // "Coverage & efficiency", not "Program performance", and gas_devsecops's argument for it
  // holds here word for word: the lane is already called Program, and the pair of figures IS
  // the page — they are never published apart. This register's own glossary had already
  // settled the phrase, defining "Coverage & efficiency over time" while the nav went on
  // calling the page something else.
  program: { title: "Coverage & efficiency", group: "Program", render: renderProgram },
  overview: { title: "OS vulnerabilities", group: "Registers", render: renderOverview },
  // LAST IN THE REGISTERS LANE, AND AFTER THE REGISTER IT READS. Executive, MTTR and
  // Coverage & efficiency ask how fast risk is closing; OS vulnerabilities is the register
  // itself. This one asks the other question — where has it stopped — and it belongs after
  // the register rather than before it, because "these assets have gone quiet" is a reading
  // OF the list a reader has just been shown, not a way into it. The lane stays contiguous
  // either way, which navModel.railItems requires.
  coldZone: { title: "Cold zone", group: "Registers", render: renderColdZone },
  // "Storage", not "Data": the lane is already called Data, and a Data page inside a Data
  // lane is the repetition gas_devsecops declined to inherit from here. The page's own
  // top section was called Storage too and is renamed with it — see pages/data.js.
  data: { title: "Storage", group: "Data", render: renderData },
  // `history`, not `scan_history`, and the rename is what makes the route table checkable.
  // gas_shared/test/contracts/navGroups.js resolves each route to `pages/<route>.js`, and
  // this one was the only route in the app whose key did not name its own module — the page
  // has always been pages/history.js. ROUTE_ALIASES below keeps every existing
  // #/scan_history link working and rewrites it, so no bookmark is broken by the fix.
  // Sentence case, matching every other title in this table and its sibling's.
  history: { title: "Scan history", group: "Data", render: renderHistory },
  attribution: { title: "Attribution", group: "Data", render: renderAttribution },
  // The book, not the record: helpContent.js's whole glossary, searchable and deep-linkable —
  // where every glossary tip's "Enter for the full definition" has always pointed
  // (gas_shared/ui/tip.js's markTerm), landing on nothing until this route existed. LAST in the
  // lane because a reader reaches for it only after wanting to check a word, never on the way
  // in; in the Data lane rather than the chrome tail because the key sheet IS a page of this
  // register's content. gas_devsecops filed it identically, gas_ai did not, and that
  // disagreement is settled now: all three registers file the key sheet in the Data lane.
  help: { title: "Key sheet", group: "Data", render: renderHelp },
  settings: { title: "Settings", group: null, render: renderSettings },
};
