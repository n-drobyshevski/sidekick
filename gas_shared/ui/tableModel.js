// How a table orders and pages its rows — the half of the register that can be wrong.
//
// DOM-free on purpose, and for the reason pages/configView.js writes out: there is no jsdom
// in this repo, so nothing that touches `document` can be unit-tested. dataTable() builds the
// nodes; this decides what goes in them and in what order, and test/tableModel.test.js holds
// it to that.
//
// It arrives from src/client/js/queryTable.js, which is where the strongest version of each
// of these rules already lived — the Security Graph's results table sorted nulls correctly and
// broke ties stably while the other four registers each rolled a weaker copy. Same bargain
// dataTable itself was assembled under: take the best of what exists rather than write a
// sixth one.
//
// DIRECTION OF SORT STAYS WITH THE CALLER, deliberately, exactly as dataTable's own comment
// says: "the three pages genuinely disagree about what a first click means per column, and two
// of those rules are unit-tested". This module never decides that. It decides where an unknown
// goes, what a tie does, and how a page is cut.


/**
 * The row counts a page-size control offers, and the one it starts on.
 *
 * One list, because two registers already shipped the same four numbers independently
 * (inventory.js and queryTable.js) and a third would have been a coincidence rather than a
 * decision.
 */
// 15 leads the list AND is the default. It is there because the default has to be a member
// of this array: `tableFooter` sets `sizeSelect.value = String(pageSize)`, and a value matching
// no option makes the browser fall back to the first entry — so the control would silently
// report a page size the table is not using. `pages/program.js` carries the same warning above
// its own copy, which is how that failure is already known here.
export const PAGE_SIZES = [15, 25, 50, 100, 250];
export const DEFAULT_PAGE_SIZE = 15;


/**
 * Ordinary comparison for two values that are both PRESENT. Nulls are the caller's problem,
 * and `nullsLast` below is how the caller solves them.
 *
 * No locale collation: `localeCompare` is both slower and, on a column of resource ids and
 * rule short-codes, differently wrong. Lowercased so a column does not sort `Zebra` before
 * `apple`.
 */
export function compareValues(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return (a ? 1 : 0) - (b ? 1 : 0);
  const sa = String(a).toLowerCase();
  const sb = String(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/**
 * Where an unknown goes: LAST, in both directions.
 *
 * This sits outside the ascending/descending flip on purpose. An unknown is not a small value.
 * Letting it lead the ascending page would bury the rows someone sorted the column to find,
 * and reversing the sort would then bury the others — so a reader could never get both halves
 * of the column into view. Sinking it in both directions costs one arrangement and saves the
 * one people actually want.
 *
 * `undefined` and `null` are the same answer here — Wiz reports a field it never evaluated as
 * either, depending on the query, and a table that ordered those two differently would be
 * sorting on which query fetched the row.
 *
 * @returns {number|null} `null` means BOTH are present and the caller should compare them.
 */
export function nullsLast(a, b) {
  const na = a === null || a === undefined;
  const nb = b === null || b === undefined;
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  return null;
}

/**
 * Sort a copy of `rows` by one column, unknowns last, ties broken the same way every time.
 *
 * THE TIEBREAK IS NOT A GARNISH. Array.prototype.sort is stable, so equal rows keep their
 * input order — but the input order of a register is itself the previous sort, so a column
 * with many equal values (a severity, a status, a boolean) appears to shuffle itself when a
 * reader sorts by something else and comes back. A second key that never changes fixes the
 * arrangement to the data rather than to the click history.
 *
 * @param {Array} rows
 * @param {{value: (row: any) => any, descending?: boolean, tiebreak?: (row: any) => any}} spec
 * @returns {Array} a new array; `rows` is not touched
 */
/**
 * One page of rows, with the page index clamped into range. Clamping rather than throwing
 * is what lets a filter shrink the register under a reader who is on page 9 without the
 * table going blank: they land on the last page that exists.
 */
export function pageOf(rows, page, pageSize) {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const clamped = Math.min(Math.max(Math.floor(page) || 0, 0), pageCount - 1);
  return {
    rows: rows.slice(clamped * size, (clamped + 1) * size),
    page: clamped,
    pageCount,
  };
}

export function sortRows(rows, spec) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const value = spec && spec.value;
  if (typeof value !== "function") return list;
  const descending = Boolean(spec && spec.descending);
  const tiebreak = spec && typeof spec.tiebreak === "function" ? spec.tiebreak : null;

  return list.sort(function (ra, rb) {
    const va = value(ra);
    const vb = value(rb);
    const order = nullsLast(va, vb);
    if (order === null) {
      const d = compareValues(va, vb);
      if (d !== 0) return descending ? -d : d;
    } else if (order !== 0) {
      return order;
    }
    if (!tiebreak) return 0;
    const ta = tiebreak(ra);
    const tb = tiebreak(rb);
    const tie = nullsLast(ta, tb);
    // The tiebreak is never flipped by `descending` either — its job is to be constant.
    return tie === null ? compareValues(ta, tb) : tie;
  });
}

/**
 * Which page holds the row that was at the top, once the page size changes.
 *
 * Promoted from inventory.js:861, which is the only one of the two page-size selects that
 * does this — the graph's resets to page 1. Changing how many rows you can see is not a
 * request to go somewhere else, and on page 12 of a register at 25 rows, being sent back to
 * the top is the difference between a control and a trap.
 */
export function pageForSize(page, fromSize, toSize) {
  const size = Math.max(1, Math.floor(toSize) || 0);
  const firstRow = Math.max(0, Math.floor(page) || 0) * Math.max(1, Math.floor(fromSize) || 0);
  return Math.floor(firstRow / size);
}

/**
 * WHICH COLUMN A HEADER CLICK SORTS BY NEXT, and in which direction.
 *
 * Six copies of these three lines shipped in gas_ai alone — inventory.js, config.js,
 * graph.js, combos.js and problems.js twice — and every one of them said the same thing:
 * pressing the ACTIVE column reverses it, pressing another moves to it and starts from that
 * column's own first direction. This is that rule, once, so a table's headings behave the
 * same way in every register whether or not each page re-derived it.
 *
 * The FIRST direction stays the caller's, exactly as dataTable's own docblock insists — the
 * pages genuinely disagree about it per column, because "sort by Issues" means the worst
 * first and "sort by Name" means A first. So this takes it as an argument: the caller looks
 * up its own table (`DEFAULT_SORT_DIR[key]`, `CONFIG_SORT_DESC[key]`) and passes the answer.
 *
 * NOT EVERY COPY IS A CONVERSION WAITING TO HAPPEN, and the difference is worth stating
 * rather than discovering. inventory.js and config.js hold a direction outright ("asc"/"desc",
 * a boolean) and read as this function exactly. combos.js and problems.js hold `dir` as +1/-1
 * against each column's OWN natural order, which is the same rule in a different coat — but
 * problems.js also marks a heading active before the reader has chosen one (the server's
 * lead column), and there the two disagree about what the first press on that heading means.
 * Rewriting it is a decision about that press, not a tidy, so it stays that page's to make.
 *
 * @param {{key: string, descending: boolean}|null} sort  the column active now
 * @param {string} key  the column whose header was just pressed
 * @param {boolean} [descendingFirst]  which way THAT column reads on its first press
 * @returns {{key: string, descending: boolean}} the sort to apply — a new object, always
 */
export function nextSort(sort, key, descendingFirst = false) {
  if (sort && sort.key === key) return { key, descending: !sort.descending };
  return { key, descending: Boolean(descendingFirst) };
}


// --------------------------------------------------------------- which columns are drawn
//
// A register that answers one question well has eight columns; a register that answers
// everybody's has fourteen, and the reader with the fourth question has to scroll sideways
// past ten they never asked about. The Security Graph's results table already ships the way
// out of that — a Columns button beside the table — but its own chooser is bound to the
// shape of a graph query (a group per NODE, the fields that node offers, defaults saved per
// KIND) and cannot be lifted as it stands. What IS general is underneath it, and it is what
// follows: a column can be turned off, some columns cannot, and the choice is data.
//
// A COLUMN CAN ALSO START OFF (`defaultHidden: true`), and that is the half that makes the
// chooser worth having rather than merely available. A register whose table is exactly the
// eight columns its own question needs, with the other six one press away, is a better
// register than one that ships fourteen and a control to hide six of them — most readers
// never open a control they have no reason to believe exists. The default is the page's
// editorial judgment about which facts the register is FOR; the chooser is what makes that
// judgment cheap to disagree with.
//
// SO THERE ARE THREE STATES PER COLUMN, not two: at its default, explicitly off, explicitly
// on. The reader's choice is the DEVIATIONS — two small sets — and anything not named in
// either takes the page's default.
//
// AND IT IS STORED AS DEVIATIONS FOR THE REASON IT IS SIGNED. A link (or a saved view)
// holding the columns to KEEP pins a reader to the ones that existed the day they saved it,
// so a column added later is invisible to everyone still holding one — silently, since a
// column nobody can see is a column nobody reports missing. Deviations mean a new column
// arrives at its own default for everybody and only the explicit disagreements persist. The
// sign is what keeps that true when a DEFAULT changes: `-region` still means "hide Region"
// on the day the page decides Region should have been hidden all along, where an unsigned
// list of "columns not at their default" would quietly flip to meaning the opposite. It also
// keeps the default empty, so an untouched table adds nothing to the URL.


/**
 * The reader's deviations as two Sets, from any of the shapes they arrive in — the `{off,
 * on}` object the picker holds, an array of signed keys parsed out of a URL, a bare array
 * (every key OFF, which is what a hand-typed `?cols=cloud,region` means), or nothing.
 */
export function columnChoice(choice) {
  const empty = { off: new Set(), on: new Set() };
  if (!choice) return empty;
  if (Array.isArray(choice)) return fromKeys(choice);
  if (choice instanceof Set) return fromKeys([...choice]);
  if (choice.off || choice.on) {
    return { off: asSet(choice.off), on: asSet(choice.on) };
  }
  return empty;
}

function asSet(v) {
  if (v instanceof Set) return new Set(v);
  return new Set(Array.isArray(v) ? v.filter((k) => typeof k === "string" && k !== "") : []);
}

function fromKeys(keys) {
  const off = new Set();
  const on = new Set();
  for (const raw of keys) {
    if (typeof raw !== "string" || raw === "") continue;
    const sign = raw[0];
    const key = sign === "-" || sign === "+" ? raw.slice(1) : raw;
    if (!key) continue;
    (sign === "+" ? on : off).add(key);
  }
  return { off, on };
}

/**
 * Can this column be turned off at all?
 *
 * Three cannot, and all three for one reason — there would be nothing in the chooser to
 * turn them back ON with:
 *
 *   NO `key`. The chooser addresses a column by key, and plenty of tables here pass columns
 *   with none (a column nothing sorts by never needed one). Not addressable, so not
 *   hideable — and a table of only such columns gets no chooser at all, rather than one
 *   full of controls that do nothing.
 *
 *   `pinned: true`. The column that says WHICH ROW THIS IS. Turn the name off and the
 *   register becomes figures attached to nothing; the graph's own chooser pins the same
 *   column for the same reason, and says so in as many words.
 *
 *   A blank heading. `label: ""` is inventory's Graph-button column: the button inside the
 *   cell names its own action, so the heading is deliberately empty — and a checkbox with
 *   no words beside it is not a control. Structural rather than an allowlist, and the same
 *   exemption test/columnHelp.test.js grants a blank heading for the same reason.
 *
 * A `defaultHidden` column is of course hideable — it is already hidden. The flag says where
 * it STARTS, never whether the reader may touch it.
 */
export function hideableColumn(col) {
  if (!col || !col.key || col.pinned) return false;
  return typeof col.label === "string" && col.label.trim() !== "";
}

/**
 * Is this column drawn, given the page's default and the reader's deviation from it?
 *
 * `sortKey` is the column the table is CURRENTLY ORDERED BY, and it beats `defaultHidden`
 * alone: a page that hides the column it is sorting on has hidden its own ordering, and the
 * rows then arrive in an arrangement with nothing on screen to explain it — no arrow, no
 * heading, no way to reverse it. It is reachable without anyone doing anything odd: a shared
 * link naming a sort (`?sort=firstSeen`) lands on a table whose default leaves that column
 * off, which is exactly the case a per-page fix would forget.
 *
 * A reader's OWN refusal still wins over it. Hiding the sorted column on purpose is a
 * legitimate thing to do — the order stays, the column goes — and a control that silently
 * refuses a press is worse than an unexplained order the reader chose.
 */
export function columnShown(col, choice, sortKey) {
  if (!hideableColumn(col)) return true;
  const c = columnChoice(choice);
  if (c.on.has(col.key)) return true;
  if (c.off.has(col.key)) return false;
  if (!col.defaultHidden) return true;
  return Boolean(sortKey) && sortKey === col.key;
}

/** The columns a table actually draws, in their own order. Unknown keys are inert. */
export function visibleColumns(columns, choice, sortKey) {
  const c = columnChoice(choice);
  const list = Array.isArray(columns) ? columns : [];
  return list.filter((col) => columnShown(col, c, sortKey));
}

/**
 * One row per column for the chooser: what it is called, whether it is showing, and whether
 * the reader is allowed to change that.
 *
 * A column that cannot be hidden is still LISTED, disabled — the question a reader opens
 * this control with is "where did Name go", and a list that omits the columns it will not
 * turn off answers it by pretending they do not exist. A column with no heading is dropped
 * entirely: there is nothing to print beside the checkbox.
 */
export function columnChoices(columns, choice, sortKey) {
  const c = columnChoice(choice);
  return (Array.isArray(columns) ? columns : [])
    .filter((col) => col && typeof col.label === "string" && col.label.trim() !== "")
    .map((col) => ({
      key: col.key || "",
      label: col.label,
      hideable: hideableColumn(col),
      shown: columnShown(col, c, sortKey),
    }));
}

/** Does this table hide anything of its own accord? Decides what "reset" is called. */
export function hasDefaultHidden(columns) {
  return (Array.isArray(columns) ? columns : [])
    .some((col) => col && col.defaultHidden && hideableColumn(col));
}

/**
 * Turn one column off, or back on, and hand back the new deviation set.
 *
 * A column returned to its default leaves the set entirely rather than being recorded as
 * agreeing with it — so a reader who hides Region and shows it again is back to an empty
 * choice and an untouched URL, not to `?cols=%2Bregion`.
 *
 * IN COLUMN ORDER, never in click order, so hiding Cloud then Region and hiding Region then
 * Cloud produce the same string — two readers who built the same table two ways share one
 * link, and a saved view does not churn on a re-toggle.
 *
 * Two presses do nothing and say so by returning the choice unchanged: a column that is not
 * hideable (pinned, unknown, unnamed), and the one that would empty the table. The pinned
 * column normally makes the second unreachable; a table that pins nothing still cannot be
 * reduced to no columns, because the chooser would then be the only thing left that knows
 * the table had any.
 */
export function toggleColumn(columns, choice, key, sortKey) {
  const c = columnChoice(choice);
  const list = Array.isArray(columns) ? columns : [];
  const col = list.find((x) => x && x.key === key);
  if (!hideableColumn(col)) return canonical(list, c);

  const next = { off: new Set(c.off), on: new Set(c.on) };
  next.off.delete(key);
  next.on.delete(key);
  // What the reader asked for, against what this column would do with no deviation recorded
  // at all. A press that lands back on that records nothing — which is what keeps a hide-then-
  // show round trip back at an untouched URL rather than at one asserting the default aloud.
  //
  // MEASURED AGAINST THE DEFAULT *AS THE SORT LEAVES IT*, not against `defaultHidden` alone.
  // A column on screen only because the table is ordered by it is showing, so the press that
  // turns it off disagrees with the state and has to be stored — comparing with the bare flag
  // instead makes that press record nothing, which leaves the column on screen and the
  // checkbox snapping back: a control that visibly refuses every press.
  const wantShown = !columnShown(col, c, sortKey);
  if (wantShown !== columnShown(col, null, sortKey)) (wantShown ? next.on : next.off).add(key);
  if (!visibleColumns(list, next, sortKey).length) return canonical(list, c);
  return canonical(list, next);
}

/** The same choice, in column order and with nothing in it that names no column. */
function canonical(columns, choice) {
  const keys = columns.filter((c) => c && c.key).map((c) => c.key);
  return {
    off: keys.filter((k) => choice.off.has(k)),
    on: keys.filter((k) => choice.on.has(k)),
  };
}

/** Back to the page's own defaults — every deviation dropped. */
export const DEFAULT_COLUMNS = { off: [], on: [] };

/** Has the reader moved this table off its defaults at all? */
export function columnsChanged(choice) {
  const c = columnChoice(choice);
  return c.off.size > 0 || c.on.size > 0;
}

/**
 * The two-level header's spans, recomputed for the columns still showing.
 *
 * dataTable's `groups` are spans over ADJACENT columns summing to the column count, so
 * which group owns which column is already fully determined — no new field on a column, and
 * nothing for a caller to keep in step. A group all of whose columns are off is dropped
 * rather than drawn empty: a heading spanning nothing still draws its rule and its label,
 * which reads as a column that failed to render.
 *
 * Spans that do not sum to the column count mean the caller and this function disagree
 * about the table, and the honest answer to that is to change nothing.
 */
export function regroupSpans(groups, columns, choice, sortKey) {
  const list = Array.isArray(groups) ? groups : [];
  const cols = Array.isArray(columns) ? columns : [];
  if (!list.length) return list;
  const total = list.reduce((n, g) => n + (Number(g && g.span) || 0), 0);
  if (total !== cols.length) return list;

  const c = columnChoice(choice);
  const out = [];
  let at = 0;
  let dropped = false;
  for (const group of list) {
    const span = Number(group.span) || 0;
    let shown = 0;
    for (let i = at; i < at + span; i += 1) if (columnShown(cols[i], c, sortKey)) shown += 1;
    at += span;
    if (shown !== span) dropped = true;
    if (shown) out.push({ ...group, span: shown });
  }
  return dropped ? out : list;
}

/** The choice as one URL/storage-safe string: `-key` hidden, `+key` revealed. Empty is the
 *  page's own defaults, so an untouched table writes nothing. */
export function encodeColumnChoice(choice) {
  const c = columnChoice(choice);
  return [...c.off].map((k) => "-" + k).concat([...c.on].map((k) => "+" + k)).join(",");
}

/** …and back. Whitespace and empties are dropped; unknown keys survive and stay inert. An
 *  unsigned key reads as hidden — that is what a hand-typed `?cols=cloud` means. */
export function parseColumnChoice(text) {
  const c = fromKeys(String(text || "").split(",").map((s) => s.trim()));
  return { off: [...c.off], on: [...c.on] };
}


/**
 * The `<td>` class list for one column — the DOM-free half of dataTable()'s cell loop in
 * ui/data.js, so the one thing a column spec decides about its own wrapping has a test that
 * does not need jsdom.
 *
 * `wrap: true` adds `col-wrap`, which tables.css uses to opt a single column out of the
 * 320px nowrap-ellipsis clip every other cell gets — for a column that carries prose rather
 * than a value (the secrets four-corner table's Reading column, which truncated mid-sentence
 * even at 560px). Per-column, not a table-wide reset: a numeric column beside it still wants
 * its single line, so `wrap` is additive to `col.className` rather than replacing it.
 *
 * @returns {string|null}
 */
export function cellClassName(col) {
  const classes = [];
  if (col && col.className) classes.push(col.className);
  if (col && col.wrap) classes.push("col-wrap");
  return classes.length ? classes.join(" ") : null;
}

/**
 * Three states, never two: what a boolean column actually knows.
 *
 * The codebase is emphatic that an absent property means Wiz never reported one, and printing
 * that as "No" asserts the opposite of what is known — the same rule CLAUDE.md states as
 * "absent is never zero". This is the DOM-free half of `triCell` so the rule itself has a
 * test, rather than only the span it renders into.
 *
 * @returns {"yes"|"no"|"unknown"}
 */
export function triState(v) {
  if (v === true) return "yes";
  if (v === false) return "no";
  return "unknown";
}
