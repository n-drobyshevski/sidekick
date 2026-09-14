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
  columnChoices, encodeHiddenColumns, hiddenColumnSet, hideableColumn, nextSort,
  parseHiddenColumns, regroupSpans, toggleColumn, visibleColumns,
} from "../../gas_shared/ui/tableModel.js";

/** A register's worth of columns, in the four shapes the repo's tables actually pass. */
const COLS = [
  { key: "name", label: "Name", pinned: true },     // the identity column
  { key: "kind", label: "Kind" },
  { key: "cloud", label: "Cloud" },
  { key: "region", label: "Region" },
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
    expect(keys(visibleColumns(COLS, ["cloud"]))).toEqual(["name", "kind", "region", "", "actions"]);
  });

  it("draws every column when nothing is hidden", () => {
    expect(visibleColumns(COLS, [])).toHaveLength(COLS.length);
    expect(visibleColumns(COLS, null)).toHaveLength(COLS.length);
  });

  // A stored choice outlives the table it was made against — a renamed column, a register
  // that dropped one, a link pasted into the wrong page. None of those should blank a column
  // that is still here.
  it("ignores a key naming no column", () => {
    expect(visibleColumns(COLS, ["nothing-here"])).toHaveLength(COLS.length);
  });

  it("will not hide a column that refuses to be hidden, even when asked by name", () => {
    expect(keys(visibleColumns(COLS, ["name", "actions"]))).toEqual(keys(COLS));
  });

  it("takes the choice as an array or a Set, since three callers hold three shapes", () => {
    expect(keys(visibleColumns(COLS, new Set(["kind"])))).not.toContain("kind");
  });

  it("never hands back the caller's own array to be mutated", () => {
    expect(visibleColumns(COLS, [])).not.toBe(COLS);
  });
});

describe("columnChoices — the rows the picker draws", () => {
  const choices = columnChoices(COLS, ["cloud"]);

  it("drops the columns with nothing to print beside a checkbox", () => {
    expect(choices.map((c) => c.label)).toEqual(["Name", "Kind", "Cloud", "Region", "Notes"]);
  });

  // The question a reader opens this control with is "where did Name go". A list that omits
  // the columns it will not turn off answers that by pretending they do not exist.
  it("lists a pinned column, shown and not hideable", () => {
    const name = choices.find((c) => c.key === "name");
    expect(name).toMatchObject({ shown: true, hideable: false });
  });

  it("marks the hidden one off and the rest on", () => {
    expect(choices.filter((c) => !c.shown).map((c) => c.key)).toEqual(["cloud"]);
  });
});

describe("toggleColumn", () => {
  it("turns a column off, and back on again", () => {
    const off = toggleColumn(COLS, [], "cloud");
    expect(off).toEqual(["cloud"]);
    expect(toggleColumn(COLS, off, "cloud")).toEqual([]);
  });

  // Two readers who built the same table two ways share one link, and a saved view does not
  // churn when a column is toggled off and on again.
  it("returns the refusals in COLUMN order, never in click order", () => {
    const a = toggleColumn(COLS, toggleColumn(COLS, [], "region"), "kind");
    const b = toggleColumn(COLS, toggleColumn(COLS, [], "kind"), "region");
    expect(a).toEqual(["kind", "region"]);
    expect(a).toEqual(b);
  });

  it("does nothing for a pinned, keyless or unknown column", () => {
    expect(toggleColumn(COLS, [], "name")).toEqual([]);
    expect(toggleColumn(COLS, [], "actions")).toEqual([]);
    expect(toggleColumn(COLS, [], "not-a-column")).toEqual([]);
  });

  it("drops a stale key from the list it hands back, so the URL cannot accumulate rubbish", () => {
    // Unknown keys are inert for the TABLE, but the moment a reader touches the control the
    // list is rewritten from the columns that exist — the stale key leaves with that rewrite
    // rather than riding along in every link from then on.
    expect(toggleColumn(COLS, ["gone", "kind"], "cloud")).toEqual(["kind", "cloud"]);
  });

  // The pinned column normally makes this unreachable. A table that pins nothing still
  // cannot be reduced to no columns: the chooser would then be the only thing left that
  // knows the table had any.
  it("refuses the press that would empty the table", () => {
    const two = [{ key: "a", label: "A" }, { key: "b", label: "B" }];
    const one = toggleColumn(two, [], "a");
    expect(one).toEqual(["a"]);
    expect(toggleColumn(two, one, "b")).toEqual(["a"]);
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
    expect(regroupSpans(GROUPS, GCOLS, ["a.kind"]))
      .toEqual([{ label: "Agent", span: 1 }, { label: "Identity", span: 2 }]);
  });

  // A heading spanning nothing still draws its rule and its label, which reads as a column
  // that failed to render rather than one nobody asked for.
  it("drops a group whose every column is off", () => {
    expect(regroupSpans(GROUPS, GCOLS, ["i.name", "i.sev"]))
      .toEqual([{ label: "Agent", span: 2 }]);
  });

  it("changes nothing when nothing is hidden", () => {
    expect(regroupSpans(GROUPS, GCOLS, [])).toBe(GROUPS);
  });

  // Spans that do not sum to the column count mean the caller and this function disagree
  // about the table, and the honest answer to that is to change nothing.
  it("leaves a header it cannot map alone", () => {
    const wrong = [{ label: "Agent", span: 3 }];
    expect(regroupSpans(wrong, GCOLS, ["a.kind"])).toBe(wrong);
  });

  it("answers an empty list for a table with no groups at all", () => {
    expect(regroupSpans(null, GCOLS, ["a.kind"])).toEqual([]);
  });
});

describe("encodeHiddenColumns / parseHiddenColumns", () => {
  it("round-trips a choice through a URL param", () => {
    expect(parseHiddenColumns(encodeHiddenColumns(["kind", "cloud"]))).toEqual(["kind", "cloud"]);
  });

  it("writes nothing at all for an untouched table", () => {
    expect(encodeHiddenColumns([])).toBe("");
    expect(parseHiddenColumns("")).toEqual([]);
    expect(parseHiddenColumns(undefined)).toEqual([]);
  });

  it("survives a hand-edited param", () => {
    expect(parseHiddenColumns(" kind , , cloud ")).toEqual(["kind", "cloud"]);
  });

  it("reads a Set as readily as an array — the picker holds one", () => {
    expect(hiddenColumnSet(new Set(["kind"])).has("kind")).toBe(true);
    expect([...hiddenColumnSet(["kind", "", null])]).toEqual(["kind"]);
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
    expect(code).toContain("visibleColumns(columns, hiddenNow)");
    expect(code).toContain("regroupSpans(groups, columns, hiddenNow)");
  });

  // The cog is anchored to a node inside the header it rebuilds. Build it in paintHead() and
  // every toggle would destroy the anchor of its own open popover, which is portaled to
  // <body> and would then reposition against a detached node's rect of zeros.
  it("builds the chooser once, outside the header it re-appends it to", () => {
    const head = code.slice(code.indexOf("function paintHead"));
    expect(head).not.toContain("columnsButton(");
    expect(code).toContain("const chooser = onHidden");
  });
});

describe("the AI inventory's own wiring", () => {
  const src = readFileSync(new URL("../src/client/js/pages/inventory.js", import.meta.url), "utf8");

  it("pins the Name column rather than letting the register lose its identity", () => {
    expect(src).toContain('{ key: "name", label: "Name", sort: "name", pinned: true,');
  });

  it("hands the table both the choice and the way to change it", () => {
    expect(src).toContain("hidden: hiddenCols,");
    expect(src).toContain("onHidden: (next) => {");
  });

  // Re-rendering the results from `onHidden` is the one mistake this wiring can make: the cog
  // lives in the header being rebuilt, so the page would pull its own open popover's anchor
  // out of the document. The component has already repainted by the time this is called.
  it("only remembers the answer, and does not repaint the table itself", () => {
    const cb = src.slice(src.indexOf("onHidden: (next) => {"));
    expect(cb.slice(0, cb.indexOf("},"))).not.toContain("renderResults");
  });

  // A column choice that survives a reload and a share, like every other control on the page.
  it("carries the choice in the URL and in a saved view", () => {
    expect(src).toContain("cols: encodeHiddenColumns(hiddenCols),");
    expect(src).toContain('"sort", "dir", "view", "size", "cols",');
    expect(src).toContain("parseHiddenColumns(params.cols)");
  });
});
