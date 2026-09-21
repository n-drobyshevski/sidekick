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

import { renderGraphPage } from "./pages/graph.js";
import { renderInventory } from "./pages/inventory.js";
import { renderProblems } from "./pages/problems.js";
import { renderCombos } from "./pages/combos.js";
import { renderConfigFindings } from "./pages/config.js";
import { renderCompliance } from "./pages/compliance.js";
import { renderAarsRules } from "./pages/aars.js";
import { renderScans } from "./pages/scans.js";
import { renderData } from "./pages/data.js";
import { renderSettings } from "./pages/settings.js";
import { renderHelp } from "./pages/help.js";

// The rail's information architecture, stated once.
//
// THREE LANES, A GATE AND A TAIL. Every page in this app is a security page, so "Security"
// as a heading distinguished nothing while holding six of them; what a reader actually
// chooses between is the landscape (what we have), the risk in it (what is open, and what
// to do first) and what we can state about it (how we score, and where the figures came
// from). Those are the three labelled lanes. `Labs` is the gate. The tail — `group: null` —
// is chrome, separated by a rule and never labelled.
//
// Two rules the shared shell depends on, both held by test/shared.test.js:
//   * A LABELLED LANE EARNS ITS HEADING BY HOLDING TWO PAGES. `Labs` is the one exception,
//     because there the heading IS the statement — it says the page sits outside the
//     security workflow rather than beside it — and it is drawn only when the gate is open.
//     That carve-out is `singletonLanes: ["Labs"]` in test/shared.test.js.
//   * LANES ARE CONTIGUOUS. The lastGroup detector emits a fresh heading every time
//     the value changes, so a lane split in two would quietly draw its heading twice.
//
// THREE FLAGS, THREE DIFFERENT QUESTIONS, and they compose:
//   `hidden`        keeps a route off the nav while leaving it routable. NOTHING CARRIES IT
//                   TODAY — the whole register is on the rail — but the flag stays supported
//                   because the PoC cut that introduced it (seven routes off the nav, so a
//                   demo could show that the minimal model needs no graph) is one line per
//                   route to reinstate. It was a flag rather than seven deletions in the
//                   first place because helpContent.js points at these routes about sixty
//                   times and helpContent.test.js asserts every one resolves; a hidden route
//                   still resolves, still renders if someone types its hash, and costs
//                   nothing. The landing route stayed at Priorities when the seven came
//                   back: the front door is its own decision, and the queue is a defensible
//                   front door whatever else is on the rail.
//   `experimental`  gates a route behind Settings → Show experimental content, for everyone.
//   `group`         which lane it sits in, which is about arrangement and not availability.
// A lane the first two empty out never reaches the rail, and a lane left holding ONE visible
// page is drawn as that page rather than as a lane — see gas_shared/shell/navModel.js, which
// is where the three meet. Both of those are why hiding routes degrades the rail gracefully
// instead of leaving lane headings standing over nothing.
export const PAGES = {
  // fullBleed: the page owns the whole content pane (no main padding/max-width).
  graph: { title: "Security Graph", group: "Landscape", render: renderGraphPage, fullBleed: true },
  inventory: { title: "AI Inventory", group: "Landscape", render: renderInventory },
  // Phase 7: issues UNION findings, ranked together across the whole landscape — neither
  // `combos` (one toxic-combination pattern) nor `config` (findings only) can answer
  // "what do I work on Monday". It opens the Risk lane for that reason: it is the page an
  // analyst lives in, and the two under it are lenses on subsets of what it ranks. It is
  // also this branch's front door — MANIFEST.defaultRoute names it.
  problems: { title: "Priorities", group: "Risk", render: renderProblems },
  combos: { title: "Toxic Combinations", group: "Risk", render: renderCombos },
  config: { title: "Cloud Configuration", group: "Risk", render: renderConfigFindings },
  // Stays directly under Cloud Configuration — the two are the same subject at two grains,
  // what is failing and what that scores against — and the lane boundary between them is the
  // claim rather than a separation: one register is worked, the other is stated.
  compliance: { title: "Compliance Posture", group: "Assurance", render: renderCompliance },
  // Assurance, not the lone "Coverage" heading this used to carry. One page under one
  // heading was a line of furniture; and this page answers the question Compliance Posture
  // answers, one step further back — "where did this figure come from" beside "how do we
  // score" — which is the same reader on the same errand.
  scans: { title: "Wiz Scans", group: "Assurance", render: renderScans },
  // "Scoring Models", not "AARS Rules": this page has hosted three models since the Problem
  // and Posture tabs landed, and it is now the ONLY consumer of all three — the title is
  // the boundary as much as the name. Deliberately not "Risk Models": this codebase is
  // careful that these are not risk scores (the glossary says so in as many words), and
  // bare "Models" would collide with the MODEL node kind the graph draws.
  //
  // The route key stays `aars`. Every hash link, ROUTE_ICONS entry and helpContent
  // `route`/`drawnOn` value keys on it, and renaming the key would break shared links to
  // buy nothing a reader can see.
  //
  // Group "Labs", not "Scoring": the rail itself should say these sit outside the security
  // workflow rather than beside it.
  //
  // `experimental: true`, and deliberately NOT `hidden`: the two flags answer different
  // questions. Gated, never removed — the key stays in this map so shared `#/aars` links
  // keep working for anyone who has asked for them, and so helpContent's "routes only to
  // pages that exist" guard still has a page to point at.
  // IT USED TO HAVE TO BE ONE LINE, and that constraint is gone. While the table lived in
  // app.js the contracts read it as TEXT, off a line-shaped regex, and this entry wrapped
  // across three lines parsed as a route with no title and no lane. They import the table
  // now, so the entry can be shaped for a reader instead of for a pattern.
  aars: {
    title: "Scoring Models",
    group: "Labs",
    render: renderAarsRules,
    fullBleed: true,
    experimental: true,
  },
  // A DATA LANE, WHERE THERE WAS A THREE-PAGE TAIL. The old objection to labelling these
  // was exact and is answered rather than overruled: "Data" over a link reading Data, and
  // "Help" over a link reading Help, were two headings restating the links beneath them.
  // Both pages are renamed here, so the lane now says what KIND of page these are and each
  // link says which page it is — Storage and the Key sheet, under Data. That is also the
  // filing both sibling registers use, which is the disagreement this wave came to settle:
  // gas's own table recorded it as an open question in as many words.
  //
  // Two pages, so the lane earns its heading under the rule navModel.railItems applies.
  data: { title: "Storage", group: "Data", render: renderData },
  // "Key sheet", not "Help": it is the book — every glossary tip's "Enter for the full
  // definition" lands here — and this page's own hero already called it the key sheet while
  // the nav said Help.
  help: { title: "Key sheet", group: "Data", render: renderHelp },
  // The tail is Settings alone now: a page that names itself, drawn under a rule rather than
  // under a heading, because "Preferences" over one link is a synonym restating it.
  //
  // Still last, and still not the front door. MANIFEST.defaultRoute names that, and this map
  // does not decide it by position — which is what made the old coupling worth stating and
  // then worth retiring: the fallback said "problems" while route() still said graph.
  settings: { title: "Settings", group: null, render: renderSettings },
};
