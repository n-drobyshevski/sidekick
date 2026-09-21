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
import { renderMttr } from "./pages/mttr.js";
import { renderProgram } from "./pages/program.js";
import { renderSca } from "./pages/sca.js";
import { renderSast } from "./pages/sast.js";
import { renderSecrets } from "./pages/secrets.js";
import { renderRepos } from "./pages/repos.js";
import { renderHistory } from "./pages/history.js";
import { renderData } from "./pages/data.js";
import { renderHelp } from "./pages/help.js";
import { renderSettings } from "./pages/settings.js";

// The rail's information architecture, stated once.
//
// THREE LANES AND A TAIL. Every page here is a security page, so "Security" as a heading
// would distinguish nothing. What a reader actually chooses between is: how the programme
// is doing (Program), what is actually in the register (Registers), and what has been
// stored about it (Data). The tail — `group: null` — is chrome, separated by a rule and
// never labelled.
//
// The first draft had four lanes, with Executive alone under an "Overview" heading.
// navModel collapses a lane of one to that page on the rail, so it looked fine there — but
// renderStackedNav below 800px draws the heading unconditionally, which would have put the
// word "Overview" directly above a single link reading "Executive". shared.test.js
// caught it. Executive belongs with the other two anyway: all three are programme-level
// reads over the whole population, and the registers below ARE that population.
//
// Two rules the shared shell depends on, both held by test/shared.test.js:
//   * A LABELLED LANE EARNS ITS HEADING BY HOLDING TWO PAGES. A lane left holding one
//     visible page is drawn AS that page — see gas_shared/shell/navModel.js.
//   * LANES ARE CONTIGUOUS. The lastGroup detector emits a fresh heading every time the
//     value changes, so a lane split in two would quietly draw its heading twice.
//
// THREE REGISTERS, THREE PAGES, and that is the composition decision worth defending.
// SAST, SCA and secrets are not one list under a filter: SAST keys on a rule at a file and
// line and is fixed by changing code; SCA keys on a CVE in a package and cannot be fixed at
// all until a fixed version exists; a secret is fixed by ROTATION, and a secret Wiz reports
// as resolved may still be live. One merged register would have to lie about at least two
// of them — and the MTTR clock differs across all three, which is the whole product.
//
// Two flags are supported and neither is used today:
//   `hidden`        keeps a route off the nav while leaving it routable.
//   `experimental`  gates a route behind Settings -> show experimental content.
// `group` is arrangement, not availability. A lane the flags empty out never reaches the
// rail — see gas_shared/shell/navModel.js, which is where the three meet.
export const PAGES = {
  // The front door, and MANIFEST.defaultRoute names it. A leader opens the app wanting
  // one number; an analyst passes straight through to a register.
  executive: { title: "Executive", group: "Program", render: renderExecutive },

  // The product. Everything else on the rail exists to make these two legible and to let a
  // reader check them.
  mttr: { title: "MTTR & SLA", group: "Program", render: renderMttr },
  // "Coverage & efficiency", not "Program performance": it sits in a lane already called
  // Program, and the pair of figures IS the page — they are never published apart.
  program: { title: "Coverage & efficiency", group: "Program", render: renderProgram },

  // The three registers. Ordered by how much of the backlog they carry in this tenant —
  // one repository alone holds 6,894 SCA findings against 11,406 SAST findings across all
  // of them — and by which one a reader can actually act on soonest.
  sca: { title: "Dependencies", group: "Registers", render: renderSca },
  sast: { title: "Code", group: "Registers", render: renderSast },
  secrets: { title: "Secrets", group: "Registers", render: renderSecrets },

  // The estate and the record. `repos` is one page rather than gas/'s Attribution plus
  // brick/'s Estate: for a code register subscriptionName is always null, so there is no
  // second attribution dimension to separate out — ownership IS the repository, through the
  // projects[] hierarchy.
  repos: { title: "Repositories", group: "Data", render: renderRepos },
  history: { title: "Scan history", group: "Data", render: renderHistory },
  // "Storage", not "Data": the lane is already called Data, and gas/ shipping a Data page
  // inside a Data lane is a repetition worth not inheriting.
  data: { title: "Storage", group: "Data", render: renderData },
  // The book, not the record: helpContent.js's whole glossary, searchable and deep-linkable
  // — where every glossaryTip's "Enter for the full definition" has always pointed
  // (ui/tip.js), landing on nothing until this route existed. Last in the lane because a
  // reader reaches for it only after wanting to check a word, never on the way in.
  help: { title: "Key sheet", group: "Data", render: renderHelp },

  // The tail: chrome, not a lane. A rule separates it and nothing labels it.
  settings: { title: "Settings", group: null, render: renderSettings },
};
