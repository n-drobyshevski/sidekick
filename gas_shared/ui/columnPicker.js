// The column chooser: which of a register's columns this reader wants in front of them.
//
// WHERE IT SITS IS THE DESIGN. A cog at the right end of the heading row, inside the table —
// not a button in the page toolbar beside the search box and the filters. Those controls
// change WHICH ROWS the register is answering with; this one changes nothing about the
// answer and only how much of it is drawn, and a reader looking for a column that is not
// there looks at the columns. It also costs the toolbar nothing, it travels with a sticky
// heading, and it is where every table that has ever offered this puts it.
//
// THE REFERENCE IS THE SECURITY GRAPH'S OWN, and this is deliberately not a move of it.
// gas_ai's `pages/graph.js` has had a Columns button since the workbench shipped, but its
// chooser is bound to the shape of a graph query — a group per NODE, the fields that node
// offers, defaults remembered per KIND, and a choice that changes which fields the SERVER is
// asked for. None of that generalises to a register table whose columns are written by hand
// in the page. What does generalise is everything underneath: a table has more columns than
// any one reader wants, turning one off is a view decision and not a query, and the decision
// has to be visible or a missing column reads as a bug. That is this file, plus the rules in
// ui/tableModel.js (`hideableColumn`, `toggleColumn`, `visibleColumns`) that it and
// `dataTable` both read, so the control and the table can never disagree about what was
// offered.
//
// LIVE-APPLY, NO OK BUTTON — the same bargain the graph's chooser and the layout popover
// already take. The table is on screen behind the popover; a reader ticking Region can watch
// the column arrive, which is a better answer than a preview and a commit step.
//
// STATE STAYS WITH THE PAGE. This holds a working copy only for as long as the popover is
// open; every change goes out through `onChange` and comes back in through `set()`. Where
// the choice is REMEMBERED is the page's business and the pages disagree for good reasons —
// gas_ai's inventory puts it in the URL, beside the filters, so a link and a saved view carry
// it; a page with no shareable address would reach for storage instead. A component that
// picked one would have picked wrong for the other.

import { el } from "./dom.js";
import { openPopover } from "./popover.js";
import { uiIcon } from "./uiIcons.js";
import {
  DEFAULT_COLUMNS, columnChoices, columnsChanged, hasDefaultHidden, toggleColumn,
} from "./tableModel.js";

/**
 * The cog, and the popover it opens. `dataTable` builds this and places it; a page normally
 * reaches it through `dataTable`'s own `onHidden` rather than calling here.
 *
 * Returns `null` when this table offers nothing to hide — every column pinned, keyless or
 * unnamed. A control whose entire list is disabled is worse than no control: it advertises a
 * choice and then refuses every form of it.
 *
 * The returned node carries `set(hidden)`, for a caller that changes the choice from
 * somewhere else and needs the button to follow.
 *
 *   columns   the SAME array handed to dataTable — full, not pre-filtered
 *   choice    {off, on} — where this reader has disagreed with the page's defaults
 *   onChange  (choice) => void, on every toggle and on the reset
 *   label     the accessible name; "Columns", as the reference names the control
 */
export function columnsButton(spec) {
  const {
    columns = [], choice = null, onChange = null, label = "Columns", sortKey = null,
  } = spec || {};

  // A FUNCTION, not a value: the table can be re-sorted while this button lives, and a column
  // on screen only because it is the sort has to tick and untick with it.
  const activeSort = () => (typeof sortKey === "function" ? sortKey() : sortKey) || "";

  if (!columnChoices(columns, null).some((c) => c.hideable)) return null;

  let current = choice || DEFAULT_COLUMNS;

  const btn = el("button", {
    class: "col-pick-btn",
    "aria-haspopup": "dialog",
    onclick: () => open(),
  }, uiIcon("cog", 14));

  /**
   * THE MARK IS THE HONEST HALF OF THIS CONTROL. A reader who hid two columns last week comes
   * back to a table with no Cloud column and no reason why; a cog that looks the same either
   * way leaves them to conclude the register lost a field. The dot says the table is narrowed
   * and the name says by how much, in the one place they would look to put it back.
   *
   * The count rides in the accessible NAME rather than in a visible badge: at 14px in a
   * heading cell there is no room for a numeral that would still be legible, and a mark that
   * only some readers get is worse than one nobody has to decode.
   */
  function paintCount() {
    const rows = columnChoices(columns, current, activeSort());
    const off = rows.filter((c) => c.hideable && !c.shown).length;
    // THE MARK IS THE READER'S OWN DEVIATION, not the count of hidden columns. A table that
    // starts with four optional columns off is at its default, and a dot that were always lit
    // on such a table would be decoration within a day. The NAME carries the count either
    // way, so "how much am I not seeing" is always answerable, marked or not.
    btn.classList.toggle("is-narrowed", columnsChanged(current));
    btn.setAttribute("aria-label",
      off ? `${label} — ${off} of ${rows.length} hidden` : label);
  }

  function open() {
    const boxes = new Map();
    const body = el("div", { class: "col-pick" });
    // The popover names itself, because its trigger cannot: a cog is a cog until you open
    // it. Also the one place the rule "the table keeps some of these" has room to be stated.
    const head = el("p", { class: "col-pick-head" }, label);
    const list = el("div", { class: "col-pick-list" });
    // "Reset" and "Show all" are the same press — clear every deviation — and the label says
    // which one it IS on this table. On a table that hides nothing of its own accord the
    // default IS every column, and calling that "reset" would be a riddle.
    const reset = el("button", { class: "link", onclick: () => restore() },
      hasDefaultHidden(columns) ? "Reset to defaults" : "Show all columns");

    for (const c of columnChoices(columns, current, activeSort())) {
      const box = el("input", { type: "checkbox" });
      box.checked = c.shown;
      box.disabled = !c.hideable;
      if (c.hideable) {
        box.addEventListener("change", () => apply(c.key));
        boxes.set(c.key, box);
      }
      list.append(el("label", {
        class: "col-pick-row" + (c.hideable ? "" : " is-fixed"),
      },
        box,
        el("span", { class: "col-pick-name" }, c.label),
        // Not "disabled" and not a lock: the reader is being told the register keeps this
        // column, which is a fact about the table and not a refusal aimed at them.
        c.hideable ? null : el("span", { class: "col-pick-always" }, "always"),
      ));
    }

    /**
     * Re-read every control from `current` after a change.
     *
     * A checkbox that reports the box's own state rather than the model's is how a REFUSED
     * toggle — the last visible column — leaves a table showing a column whose box says it
     * is off. `toggleColumn` is the one that decides; this makes the popover admit it.
     */
    function sync() {
      const shown = new Map(
        columnChoices(columns, current, activeSort()).map((c) => [c.key, c.shown]));
      for (const [key, box] of boxes) box.checked = shown.get(key) !== false;
      reset.disabled = !columnsChanged(current);
      paintCount();
    }

    function apply(key) {
      current = toggleColumn(columns, current, key, activeSort());
      sync();
      if (onChange) onChange(current);
    }

    function restore() {
      if (!columnsChanged(current)) return;
      current = DEFAULT_COLUMNS;
      sync();
      if (onChange) onChange(current);
    }

    body.append(head, list, el("div", { class: "col-pick-foot" }, reset));
    sync();

    const panel = openPopover({
      anchor: btn,
      className: "col-pick-pop",
      ariaLabel: label,
      position: {
        width: 260, minWidth: 220, maxHeight: 420, minHeight: 160,
        // THE LIST SCROLLS; THE POPOVER DOES NOT RUN OFF THE SCREEN. `positionPopover`
        // REPORTS the room it left rather than applying it — `onRoom` is its whole mechanism
        // for that, and `openPopover` hands this options bag straight through, so a caller
        // opts in here. Without it the `maxHeight` above is inert: measured on the DevSecOps
        // scan history, whose table sits 700px down a 950px window, the panel opened 372px
        // tall from y=723 and put its last three columns 145px below the fold — visible to a
        // hit test, reachable by nothing. A cog near the bottom of a page is the normal case
        // for this control, not an edge one: it rides in a table heading, and tables are
        // rarely at the top.
        //
        // Applied to the BODY rather than to the popover: `.col-pick` is the flex column, so
        // clamping it lets the head and foot keep their height and the list take what is
        // left. Re-run on every reposition, so a scroll re-measures instead of freezing the
        // first answer.
        onRoom: (px) => { body.style.maxHeight = px + "px"; },
      },
      build: () => body,
    });
    // Focus goes INTO the panel or Tab walks straight past it: the popover is portaled to the
    // end of <body>, so "the next control" is not what it looks like from the button.
    const first = [...boxes.values()][0];
    if (first && panel.isOpen()) first.focus();
  }

  btn.set = (next) => {
    current = next || DEFAULT_COLUMNS;
    paintCount();
  };
  paintCount();
  return btn;
}


// ------------------------------------------------------------------ remembering the choice
//
// WHERE A COLUMN CHOICE LIVES IS THE PAGE'S CALL, and the pages genuinely differ. gas_ai's
// inventory puts it in the URL beside the filters, because everything else on that page is
// there and a saved view carries it with the rest — a link to a narrowed register arrives
// narrowed. Most tables in these registers have no shareable address of their own: they sit
// inside a section of a page whose URL says nothing about them, and a choice held only in
// memory is one a reader re-makes on every visit, which is the same as not offering it.
//
// So this is the OTHER answer, and it is per browser rather than per link: `dataTable`'s
// `columnStore` key. Storage can refuse (a sandboxed iframe, private mode, a browser with
// site data blocked) and both halves answer that the same way the saved-views reader does —
// a refusal reads as "no preference", never as an error, and the table renders at its
// defaults. Nothing here is worth a toast: the reader loses a column layout, not work.

/** A stored choice, or the page's defaults when there is none or storage refused. */
export function readStoredColumns(key) {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    return { off: asKeys(parsed.off), on: asKeys(parsed.on) };
  } catch {
    return null;
  }
}

/** Remember it, or quietly do not. A choice back at its defaults REMOVES the entry rather
 *  than storing two empty lists: the default is what an absent preference already means. */
export function writeStoredColumns(key, choice) {
  if (!key) return;
  try {
    const off = asKeys(choice && choice.off);
    const on = asKeys(choice && choice.on);
    if (!off.length && !on.length) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ off, on }));
  } catch {
    // The reader keeps the layout for this visit; the next one starts at the defaults.
  }
}

function asKeys(v) {
  return Array.isArray(v) ? v.filter((k) => typeof k === "string" && k !== "") : [];
}
