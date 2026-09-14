// WHICH COLUMNS A TABLE DRAWS — the reader's own choice, and the rules that stop it from
// becoming a table nobody can read back.
//
// The Security Graph's table view has had a Columns button since the workbench shipped, but
// its chooser is welded to the shape of a graph query (a group per node, fields that node
// offers, defaults per kind) and changes which fields the SERVER is asked for. What moved
// into `gas_shared/ui/tableModel.js` is the part underneath that any register table needs,
// and this file is that part's test: a column can be turned off, three kinds cannot, the
// choice is stored as what was REMOVED, and the table can never be emptied.
//
// Plain .js for the reason tableModel.test.js beside it writes out: tsconfig has no allowJs
// and includes test/**/*.ts, so a .ts test importing a client .js module fails
// `tsc --noEmit`, and `npm run check` is typecheck && lint && test — vitest would never run.
//
// WHY THE FAILURES HERE ARE WORTH A TEST. Every one of them is silent on screen. A column
// hidden because a saved link listed the KEPT columns looks like a column that was never
// added. A `colspan` counted off the unfiltered list looks like a table that renders. A
// group heading spanning nothing looks like a column that failed to draw. None of them
// throws, and all of them read as data.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  columnChoice, columnChoices, columnShown, columnsChanged, encodeColumnChoice,
  hasDefaultHidden, hideableColumn, nextSort, parseColumnChoice, regroupSpans, toggleColumn,
  visibleColumns,
} from "../../gas_shared/ui/tableModel.js";

/** A register's worth of columns, in the five shapes the repo's tables actually pass. */
const COLS = [
  { key: "name", label: "Name", pinned: true },     // the identity column
  { key: "kind", label: "Kind" },
  { key: "cloud", label: "Cloud" },
  { key: "region", label: "Region" },
  { key: "tags", label: "Tags", defaultHidden: true },  // real, and not what the page is for
  { label: "Notes" },                               // no key: not addressable
  { key: "actions", label: "" },                    // blank heading: nothing to print
];

const keys = (cols) => cols.map((c) => c.key || "");

describe("hideableColumn — which columns refuse to be turned off", () => {
  it("offers an ordinary named column", () => {
    expect(hideableColumn({ key: "cloud", label: "Cloud" })).toBe(true);
  });

  // All three refusals are the same refusal: there would be nothing in the chooser to turn
  // the column back ON with, so hiding it is a one-way door.
  it("refuses a pinned column — the one that says which row this is", () => {
    expect(hideableColumn({ key: "name", label: "Name", pinned: true })).toBe(false);
  });

  it("refuses a column with no key, since the chooser addresses columns by key", () => {
    expect(hideableColumn({ label: "Notes" })).toBe(false);
  });

  it("refuses a blank heading — a checkbox with no words beside it is not a control", () => {
    expect(hideableColumn({ key: "actions", label: "" })).toBe(false);
    expect(hideableColumn({ key: "actions", label: "   " })).toBe(false);
  });

  it("refuses a heading that is not text at all", () => {
    expect(hideableColumn({ key: "x", label: { nodeName: "SPAN" } })).toBe(false);
    expect(hideableColumn(null)).toBe(false);
  });
});

describe("visibleColumns", () => {
  it("drops exactly the columns named, and keeps their order", () => {
    expect(keys(visibleColumns(COLS, { off: ["cloud"] })))
      .toEqual(["name", "kind", "region", "", "actions"]);
  });

  // The page's own editorial judgment about what the register is FOR. A reader who has never
  // opened the chooser gets the table the page meant, not every column it could draw.
  it("leaves a defaultHidden column out until it is asked for", () => {
    expect(keys(visibleColumns(COLS, null))).not.toContain("tags");
    expect(keys(visibleColumns(COLS, { on: ["tags"] }))).toContain("tags");
  });

  it("draws every other column when the reader has said nothing", () => {
    expect(visibleColumns(COLS, null)).toHaveLength(COLS.length - 1);
    expect(visibleColumns(COLS, { off: [], on: [] })).toHaveLength(COLS.length - 1);
  });

  // A stored choice outlives the table it was made against — a renamed column, a register
  // that dropped one, a link pasted into the wrong page. None of those should blank a column
  // that is still here.
  it("ignores a key naming no column", () => {
    expect(visibleColumns(COLS, { off: ["nothing-here"] })).toHaveLength(COLS.length - 1);
  });

  it("will not hide a column that refuses to be hidden, even when asked by name", () => {
    expect(keys(visibleColumns(COLS, { off: ["name", "actions"] })))
      .toEqual(keys(COLS).filter((k) => k !== "tags"));
  });

  // The choice arrives from the picker as an object, from a URL as signed keys, and from a
  // hand-typed link as bare ones. A bare key means HIDE, which is what someone typing
  // `?cols=cloud` is asking for.
  it("reads the choice in every shape it arrives in", () => {
    expect(keys(visibleColumns(COLS, ["-cloud", "+tags"]))).not.toContain("cloud");
    expect(keys(visibleColumns(COLS, ["-cloud", "+tags"]))).toContain("tags");
    expect(keys(visibleColumns(COLS, ["cloud"]))).not.toContain("cloud");
    expect(keys(visibleColumns(COLS, new Set(["kind"])))).not.toContain("kind");
  });

  it("never hands back the caller's own array to be mutated", () => {
    expect(visibleColumns(COLS, null)).not.toBe(COLS);
  });
});

describe("columnShown", () => {
  it("answers for a column the reader has never touched", () => {
    expect(columnShown({ key: "kind", label: "Kind" }, null)).toBe(true);
    expect(columnShown({ key: "tags", label: "Tags", defaultHidden: true }, null)).toBe(false);
  });

  it("says yes for a column nobody may hide, whatever the choice says", () => {
    expect(columnShown({ key: "name", label: "Name", pinned: true }, { off: ["name"] })).toBe(true);
  });
});

// A page that hides the column it is ordering by has hidden its own ordering: the rows
// arrive in an arrangement with no arrow, no heading and no way to reverse it. Reachable
// without anyone doing anything odd — a shared `?sort=firstSeen` link lands on a table whose
// default leaves that column off.
describe("columnShown — the column a table is sorted by", () => {
  const cols = [
    { key: "name", label: "Name" },
    { key: "firstSeen", label: "First seen", defaultHidden: true },
  ];

  it("comes back on when the table is ordered by it", () => {
    expect(keys(visibleColumns(cols, null))).not.toContain("firstSeen");
    expect(keys(visibleColumns(cols, null, "firstSeen"))).toContain("firstSeen");
  });

  // The reader's own refusal still wins: hiding the sorted column on purpose is legitimate —
  // the order stays, the column goes — and a control that silently refuses a press is worse
  // than an order the reader chose not to see.
  it("stays off when the reader has said so out loud", () => {
    expect(keys(visibleColumns(cols, { off: ["firstSeen"] }, "firstSeen")))
      .not.toContain("firstSeen");
  });

  it("is a real refusal to turn off a column showing only because of the sort", () => {
    expect(toggleColumn(cols, { off: [], on: [] }, "firstSeen", "firstSeen"))
      .toEqual({ off: ["firstSeen"], on: [] });
  });

  it("does not let the sort keep the last column alive through a press", () => {
    const one = [{ key: "only", label: "Only" }];
    expect(toggleColumn(one, { off: [], on: [] }, "only", "only")).toEqual({ off: [], on: [] });
  });
});

describe("hasDefaultHidden — what the reset is called", () => {
  it("is true only where the page itself hides something", () => {
    expect(hasDefaultHidden(COLS)).toBe(true);
    expect(hasDefaultHidden(COLS.filter((c) => !c.defaultHidden))).toBe(false);
    // Not hideable, so its defaultHidden is not a default anyone can undo.
    expect(hasDefaultHidden([{ key: "x", label: "", defaultHidden: true }])).toBe(false);
  });
});

describe("columnChoices — the rows the picker draws", () => {
  const choices = columnChoices(COLS, { off: ["cloud"] });

  it("drops the columns with nothing to print beside a checkbox", () => {
    expect(choices.map((c) => c.label))
      .toEqual(["Name", "Kind", "Cloud", "Region", "Tags", "Notes"]);
  });

  it("shows a defaultHidden column as an unticked box, not as an absence", () => {
    expect(choices.find((c) => c.key === "tags")).toMatchObject({ shown: false, hideable: true });
  });

  // The question a reader opens this control with is "where did Name go". A list that omits
  // the columns it will not turn off answers that by pretending they do not exist.
  it("lists a pinned column, shown and not hideable", () => {
    const name = choices.find((c) => c.key === "name");
    expect(name).toMatchObject({ shown: true, hideable: false });
  });

  it("marks the hidden ones off and the rest on", () => {
    expect(choices.filter((c) => !c.shown).map((c) => c.key)).toEqual(["cloud", "tags"]);
  });
});

describe("toggleColumn", () => {
  const none = { off: [], on: [] };

  it("turns a column off, and back on again", () => {
    const off = toggleColumn(COLS, none, "cloud");
    expect(off).toEqual({ off: ["cloud"], on: [] });
    expect(toggleColumn(COLS, off, "cloud")).toEqual(none);
  });

  // The other direction, and the one the deviation model exists for: revealing a column the
  // page starts with off, then putting it back.
  it("turns a defaultHidden column on, and back off again", () => {
    const on = toggleColumn(COLS, none, "tags");
    expect(on).toEqual({ off: [], on: ["tags"] });
    expect(toggleColumn(COLS, on, "tags")).toEqual(none);
  });

  // A column agreeing with its default is not a deviation, so it leaves the choice entirely —
  // a reader who hides Region and shows it again is back to an untouched URL, not to one
  // asserting the default out loud.
  it("records nothing for a column that is back at its default", () => {
    expect(columnsChanged(toggleColumn(COLS, toggleColumn(COLS, none, "kind"), "kind")))
      .toBe(false);
  });

  // Two readers who built the same table two ways share one link, and a saved view does not
  // churn when a column is toggled off and on again.
  it("returns the deviations in COLUMN order, never in click order", () => {
    const a = toggleColumn(COLS, toggleColumn(COLS, none, "region"), "kind");
    const b = toggleColumn(COLS, toggleColumn(COLS, none, "kind"), "region");
    expect(a).toEqual({ off: ["kind", "region"], on: [] });
    expect(a).toEqual(b);
  });

  it("does nothing for a pinned, keyless or unknown column", () => {
    expect(toggleColumn(COLS, none, "name")).toEqual(none);
    expect(toggleColumn(COLS, none, "actions")).toEqual(none);
    expect(toggleColumn(COLS, none, "not-a-column")).toEqual(none);
  });

  it("drops a stale key from the choice it hands back, so a link cannot accumulate rubbish", () => {
    // Unknown keys are inert for the TABLE, but the moment a reader touches the control the
    // choice is rewritten from the columns that exist — the stale key leaves with that
    // rewrite rather than riding along in every link from then on.
    expect(toggleColumn(COLS, { off: ["gone", "kind"] }, "cloud"))
      .toEqual({ off: ["kind", "cloud"], on: [] });
  });

  // The pinned column normally makes this unreachable. A table that pins nothing still
  // cannot be reduced to no columns: the chooser would then be the only thing left that
  // knows the table had any.
  it("refuses the press that would empty the table", () => {
    const two = [{ key: "a", label: "A" }, { key: "b", label: "B" }];
    const one = toggleColumn(two, none, "a");
    expect(one).toEqual({ off: ["a"], on: [] });
    expect(toggleColumn(two, one, "b")).toEqual(one);
  });
});

describe("regroupSpans — the two-level header, once a column is off", () => {
  // Which group owns which column is already fully determined by the spans, so a caller adds
  // no new field and nothing can fall out of step.
  const GROUPS = [{ label: "Agent", span: 2 }, { label: "Identity", span: 2 }];
  const GCOLS = [
    { key: "a.name", label: "Name" }, { key: "a.kind", label: "Kind" },
    { key: "i.name", label: "Name" }, { key: "i.sev", label: "Severity" },
  ];

  it("narrows the group the hidden column came out of, and only that one", () => {
    expect(regroupSpans(GROUPS, GCOLS, { off: ["a.kind"] }))
      .toEqual([{ label: "Agent", span: 1 }, { label: "Identity", span: 2 }]);
  });

  // A heading spanning nothing still draws its rule and its label, which reads as a column
  // that failed to render rather than one nobody asked for.
  it("drops a group whose every column is off", () => {
    expect(regroupSpans(GROUPS, GCOLS, { off: ["i.name", "i.sev"] }))
      .toEqual([{ label: "Agent", span: 2 }]);
  });

  it("changes nothing when nothing is hidden", () => {
    expect(regroupSpans(GROUPS, GCOLS, null)).toBe(GROUPS);
  });

  // Spans that do not sum to the column count mean the caller and this function disagree
  // about the table, and the honest answer to that is to change nothing.
  it("leaves a header it cannot map alone", () => {
    const wrong = [{ label: "Agent", span: 3 }];
    expect(regroupSpans(wrong, GCOLS, { off: ["a.kind"] })).toBe(wrong);
  });

  it("answers an empty list for a table with no groups at all", () => {
    expect(regroupSpans(null, GCOLS, { off: ["a.kind"] })).toEqual([]);
  });
});

describe("encodeColumnChoice / parseColumnChoice", () => {
  it("round-trips both directions through a URL param", () => {
    const choice = { off: ["kind", "cloud"], on: ["tags"] };
    expect(encodeColumnChoice(choice)).toBe("-kind,-cloud,+tags");
    expect(parseColumnChoice(encodeColumnChoice(choice))).toEqual(choice);
  });

  // THE SIGN IS WHAT SURVIVES A CHANGE OF DEFAULT. An unsigned list of "columns not at their
  // default" would flip meaning under every link the day a page decides a column should have
  // started off; `-region` means hide Region whatever the page later decides.
  it("keeps its meaning when the page changes its mind about a default", () => {
    const link = parseColumnChoice("-region");
    const before = [{ key: "region", label: "Region" }, { key: "name", label: "Name" }];
    const after = [{ key: "region", label: "Region", defaultHidden: true },
      { key: "name", label: "Name" }];
    expect(keys(visibleColumns(before, link))).not.toContain("region");
    expect(keys(visibleColumns(after, link))).not.toContain("region");
  });

  it("writes nothing at all for an untouched table", () => {
    expect(encodeColumnChoice({ off: [], on: [] })).toBe("");
    expect(encodeColumnChoice(null)).toBe("");
    expect(parseColumnChoice("")).toEqual({ off: [], on: [] });
    expect(parseColumnChoice(undefined)).toEqual({ off: [], on: [] });
  });

  it("survives a hand-edited param, and reads a bare key as hidden", () => {
    expect(parseColumnChoice(" kind , , -cloud ")).toEqual({ off: ["kind", "cloud"], on: [] });
  });

  it("normalises every shape the choice arrives in", () => {
    expect(columnChoice(new Set(["kind"])).off.has("kind")).toBe(true);
    expect([...columnChoice(["kind", "", null]).off]).toEqual(["kind"]);
    expect(columnChoice(null)).toEqual({ off: new Set(), on: new Set() });
  });
});

describe("nextSort — what a second press on a heading means", () => {
  it("reverses the column already active", () => {
    expect(nextSort({ key: "name", descending: false }, "name"))
      .toEqual({ key: "name", descending: true });
    expect(nextSort({ key: "name", descending: true }, "name"))
      .toEqual({ key: "name", descending: false });
  });

  // The direction a column STARTS in is the caller's: "sort by Issues" means the worst first,
  // "sort by Name" means A first, and the pages keep their own tables of that.
  it("moves to another column in the direction the caller names", () => {
    expect(nextSort({ key: "name", descending: true }, "issues", true))
      .toEqual({ key: "issues", descending: true });
    expect(nextSort({ key: "issues", descending: true }, "name", false))
      .toEqual({ key: "name", descending: false });
  });

  it("starts ascending when the caller says nothing", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", descending: false });
  });

  it("never mutates the sort it was handed", () => {
    const sort = { key: "name", descending: false };
    expect(nextSort(sort, "name")).not.toBe(sort);
    expect(sort.descending).toBe(false);
  });
});

// ------------------------------------------------------------------ the wiring, in source
//
// Two facts no unit of the model can hold, and both fail silently: a `colspan` counted off
// the unfiltered column list (an empty-state cell one column too wide, which still renders),
// and an inventory that offers the control but never hands the choice to the table.

describe("the table component counts its colspans off the columns it actually drew", () => {
  const src = readFileSync(new URL("../../gas_shared/ui/data.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function dataTable"));
  const code = body.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");

  // `cols` is what the table drew; `columns` is what the caller passed. A colspan counted off
  // the second is an empty-state cell (or a detail row) one column wider than the table it
  // sits in — which still renders, just wrongly, in a browser that forgives it.
  it("takes every colspan off the visible list, never off the caller's", () => {
    expect(code).not.toContain("String(columns.length)");
    expect(code).toContain("String(cols.length)");
  });

  // The two places the FULL list is still the right answer: filtering it, and mapping a
  // group's span back onto the columns it owns.
  it("keeps the full list where the full list is the question", () => {
    expect(code).toContain("visibleColumns(columns, chosen, sortKeyNow())");
    expect(code).toContain("regroupSpans(groups, columns, chosen, sortKeyNow())");
  });

  // Read fresh, never captured: `setSort` can change the order after the table is built, and
  // a column kept on screen only because it is the sort has to leave when the sort does.
  it("reads the active sort at paint time rather than at build time", () => {
    expect(code).toContain("const sortKeyNow = () => (currentSort && currentSort.key)");
  });

  // The cog is anchored to a node inside the header it rebuilds. Build it in paintHead() and
  // every toggle would destroy the anchor of its own open popover, which is portaled to
  // <body> and would then reposition against a detached node's rect of zeros.
  it("builds the chooser once, outside the header it re-appends it to", () => {
    const head = code.slice(code.indexOf("function paintHead"));
    expect(head).not.toContain("columnsButton(");
    expect(code).toContain("const chooser = onColumnChoice || columnStore");
  });
});

/**
 * WHAT EACH REGISTER SHIPS WITH, AND WHAT IT KEEPS ONE PRESS AWAY.
 *
 * A default is an editorial judgment, and the failure mode is silent in both directions: a
 * column quietly hidden that a reader needed, or a `defaultHidden` flag dropped in a refactor
 * so a table grows back to fourteen columns nobody asked for. Neither shows up as a broken
 * build. These pin the judgment itself — which columns each register decided it is FOR — so
 * changing one is a deliberate edit to a test rather than a diff nobody reads.
 *
 * Source-text assertions because that is what this repo can do without jsdom, and because the
 * thing being pinned IS the source: a flag on a column literal.
 */
describe("what each register's table starts with", () => {
  const read = (f) => readFileSync(new URL("../src/client/js/pages/" + f, import.meta.url), "utf8");
  const hides = (src, key) => new RegExp(`key: "${key}"[^}]*defaultHidden: true`).test(src);

  // ONE FILE, TWO TABLES. problems.js draws the register in `table()` and the remediation
  // rollup in `actionTable()`, and they disagree about Kind: the register leads with it (a
  // row is an issue OR a finding, and which one changes what you do) while the rollup keeps
  // it back, because the toolbar above THAT table already has a Kind filter. A sweep over the
  // whole file would read one table's judgment as the other's.
  const registerOf = (src) => src.slice(src.indexOf("function table("), src.indexOf("function actionTable("));
  const actionsOf = (src) => src.slice(src.indexOf("function actionTable("));

  it("Priorities keeps the queue and hides the experimental rank unless it leads", () => {
    const src = registerOf(read("problems.js"));
    // Gated, not fixed: the moment Rank leads the sort it comes back, because a register
    // ordered by a column it does not draw cannot be checked by the reader it is for.
    expect(src).toContain("defaultHidden: !rankLeads");
    expect(src).toContain("const rankLeads = Boolean(problemsData && problemsData.rankLeadsSort)");
    // The five the queue is made of stay on.
    for (const key of ["kind", "title", "asset", "severity", "due"]) {
      expect(hides(src, key), `problems.js should not hide ${key}`).toBe(false);
    }
    // Two facts the payload always carried and this table never drew.
    expect(hides(src, "impact")).toBe(true);
    expect(hides(src, "iac")).toBe(true);
  });

  it("the remediation rollup leads with the work, not with its provenance", () => {
    const src = actionsOf(read("problems.js"));
    // Kind has a FILTER two rows above this table; a column of pills repeating it is not
    // where a reader looks. Business impact and First seen are facts about the problems an
    // action collapses rather than about the work itself.
    for (const key of ["kind", "impact", "firstSeen"]) {
      expect(hides(src, key), `the actions table should hide ${key} by default`).toBe(true);
    }
    for (const key of ["worst", "action", "closes", "assets", "severity"]) {
      expect(hides(src, key), `the actions table should not hide ${key}`).toBe(false);
    }
    // Two counts src/domain/actions.ts has always rolled up and nothing has ever drawn.
    expect(src).toContain('label: "Accepted risk"');
    expect(hides(src, "ignored")).toBe(true);
    expect(hides(src, "iac")).toBe(true);
    // And one it deliberately does NOT offer: the rollup hardcodes it false, so a column
    // would report "no" for every action as though Wiz had been asked.
    expect(src).not.toContain('label: "Auto-remediable"');
  });

  it("Cloud Configuration offers where a finding lives without leading with it", () => {
    const src = read("config.js");
    for (const key of ["cloud", "subscription", "projects", "firstSeen", "since", "iac"]) {
      expect(hides(src, key), `config.js should hide ${key} by default`).toBe(true);
    }
    for (const key of ["severity", "rule", "resource", "status"]) {
      expect(hides(src, key), `config.js should not hide ${key}`).toBe(false);
    }
  });

  it("a toxic combination's issue table leads with urgency, not with addresses", () => {
    const src = read("combos.js");
    for (const key of ["account", "projects", "region", "rule", "firstSeen"]) {
      expect(hides(src, key), `combos.js should hide ${key} by default`).toBe(true);
    }
    for (const key of ["asset", "severity", "native", "status", "due"]) {
      expect(hides(src, key), `combos.js should not hide ${key}`).toBe(false);
    }
  });

  // `key: null` is a column the chooser can never turn back on, and the positional fallback
  // the page invents for it renames itself the day a column is inserted above it — taking
  // every stored preference with it.
  it("gives every offered column a key of its own rather than a positional one", () => {
    // Comments stripped: the line that REMOVED the null key explains itself by quoting it.
    const code = read("combos.js").split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
    expect(code).not.toContain("key: null");
  });
});

/**
 * THE DEFECT THIS EXISTS FOR, CAUGHT THREE TIMES IN ONE SITTING.
 *
 * Several pages do not hand their column literals to `dataTable` directly: they keep a `COLS`
 * array and map it into the component's shape, naming each field they want to pass. A map
 * that does not name `defaultHidden` (or `pinned`) drops it, and the failure is SILENT and
 * looks like success — the table renders every column, which is exactly what it did before
 * the flag existed. inventory.js, problems.js's register and problems.js's actions table all
 * shipped that bug within an hour of each other; nothing failed, the tables were simply wide.
 *
 * So the guard is on the SHAPE of the page rather than on any one table: a file whose column
 * list uses a flag must carry that flag through every map that feeds a `dataTable`.
 */
describe("a page that re-maps its columns carries the flags through", () => {
  const FILES = ["inventory.js", "problems.js", "combos.js"];

  for (const file of FILES) {
    it(`${file} does not drop a flag its own columns set`, () => {
      const src = readFileSync(
        new URL("../src/client/js/pages/" + file, import.meta.url), "utf8");
      const maps = [...src.matchAll(/columns:\s*[A-Z_]+\.map\(\([^)]*\)\s*=>\s*\(\{([\s\S]*?)\}\)\)/g)]
        .map((m) => m[1]);
      expect(maps.length, `${file} should still map its columns`).toBeGreaterThan(0);
      for (const flag of ["defaultHidden", "pinned"]) {
        // Only where the file actually uses the flag — a page with no pinned column owes
        // nothing, and asserting otherwise would be a guard that fires on nothing.
        if (!new RegExp(`${flag}: (true|!)`).test(src)) continue;
        for (const body of maps) {
          expect(body, `${file}: a columns map drops ${flag}`).toContain(flag);
        }
      }
    });
  }
});

// A `maxHeight` that nothing applies is not a maximum. `positionPopover` (ui/popover.js)
// REPORTS the room it left through `onRoom` rather than setting a height itself, and
// `openPopover` hands its options bag straight through — so a caller that passes `maxHeight`
// and no `onRoom` has written a number nobody reads. Measured on the DevSecOps scan history,
// whose table sits 700px down a 950px window: the panel opened 372px tall from y=723 and put
// its last three columns 145px below the fold, visible to a hit test and reachable by
// nothing. A cog near the bottom of a page is this control's normal case — it rides in a
// table heading, and tables are rarely at the top.
describe("the chooser's popover stays inside the window", () => {
  const src = readFileSync(
    new URL("../../gas_shared/ui/columnPicker.js", import.meta.url), "utf8");

  it("applies the room positionPopover reports instead of only asking for a maximum", () => {
    expect(src).toContain("onRoom: (px) => { body.style.maxHeight = px + \"px\"; }");
  });

  // The clamp lands on the flex COLUMN, so the head and foot keep their height and the list
  // takes what is left — and the list needs `min-height: 0` or a flex item's content floor
  // stops it shrinking, which leaves the overflow it was given nothing to do.
  it("lets the list scroll inside that clamp", () => {
    const css = readFileSync(
      new URL("../../gas_shared/styles/tables.css", import.meta.url), "utf8");
    const rule = css.slice(css.indexOf(".col-pick-list {"), css.indexOf("}", css.indexOf(".col-pick-list {")));
    expect(rule).toContain("min-height: 0");
    expect(rule).toContain("overflow-y: auto");
  });
});

describe("the AI inventory's own wiring", () => {
  const src = readFileSync(new URL("../src/client/js/pages/inventory.js", import.meta.url), "utf8");

  it("pins the Name column rather than letting the register lose its identity", () => {
    expect(src).toContain('{ key: "name", label: "Name", sort: "name", pinned: true,');
  });

  it("hands the table both the choice and the way to change it", () => {
    expect(src).toContain("columnChoice: colChoice,");
    expect(src).toContain("onColumnChoice: (next) => {");
  });

  // The two flags the page decides and the component enforces. Both are dropped by the
  // `COLUMNS.map()` unless carried explicitly, and dropping either is silent.
  it("carries pinned and defaultHidden through its own column map", () => {
    expect(src).toContain("pinned: !!col.pinned,");
    expect(src).toContain("defaultHidden: !!col.defaultHidden,");
  });

  // The three the register is not FOR, and the one it never had a column for at all.
  it("starts with the three infrastructure columns off and offers the reach count", () => {
    for (const key of ["cloud", "region", "projects"]) {
      expect(src).toMatch(new RegExp(`key: "${key}"[^}]*defaultHidden: true`));
    }
    expect(src).toContain('key: "dataFindings", label: "Classified data"');
  });

  // Re-rendering the results from `onHidden` is the one mistake this wiring can make: the cog
  // lives in the header being rebuilt, so the page would pull its own open popover's anchor
  // out of the document. The component has already repainted by the time this is called.
  it("only remembers the answer, and does not repaint the table itself", () => {
    const cb = src.slice(src.indexOf("onColumnChoice: (next) => {"));
    expect(cb.slice(0, cb.indexOf("},"))).not.toContain("renderResults");
  });

  // A column choice that survives a reload and a share, like every other control on the page.
  it("carries the choice in the URL and in a saved view", () => {
    expect(src).toContain("cols: encodeColumnChoice(colChoice),");
    expect(src).toContain('"sort", "dir", "view", "size", "cols",');
    expect(src).toContain("parseColumnChoice(params.cols)");
  });
});
