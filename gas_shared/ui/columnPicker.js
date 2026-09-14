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
  columnChoices, hiddenColumnSet, toggleColumn,
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
 *   hidden    [key] hidden now
 *   onChange  (hidden) => void, on every toggle and on "Show all"
 *   label     the accessible name; "Columns", as the reference names the control
 */
export function columnsButton(spec) {
  const {
    columns = [], hidden = [], onChange = null, label = "Columns",
  } = spec || {};

  if (!columnChoices(columns, []).some((choice) => choice.hideable)) return null;

  let current = [...hiddenColumnSet(hidden)];

  const btn = el("button", {
    class: "col-pick-btn",
    "aria-haspopup": "dialog",
    onclick: () => open(),
  }, uiIcon("cog", 13));

  /**
   * THE MARK IS THE HONEST HALF OF THIS CONTROL. A reader who hid two columns last week comes
   * back to a table with no Cloud column and no reason why; a cog that looks the same either
   * way leaves them to conclude the register lost a field. The dot says the table is narrowed
   * and the name says by how much, in the one place they would look to put it back.
   *
   * The count rides in the accessible NAME rather than in a visible badge: at 13px in a
   * heading cell there is no room for a numeral that would still be legible, and a mark that
   * only some readers get is worse than one nobody has to decode.
   */
  function paintCount() {
    const n = current.length;
    btn.classList.toggle("is-narrowed", n > 0);
    btn.setAttribute("aria-label", n ? `${label} — ${n} hidden` : label);
  }

  function open() {
    const boxes = new Map();
    const body = el("div", { class: "col-pick" });
    // The popover names itself, because its trigger cannot: a cog is a cog until you open
    // it. Also the one place the rule "the table keeps some of these" has room to be stated.
    const head = el("p", { class: "col-pick-head" }, label);
    const list = el("div", { class: "col-pick-list" });
    const reset = el("button", { class: "link", onclick: () => showAll() }, "Show all columns");

    for (const choice of columnChoices(columns, current)) {
      const box = el("input", { type: "checkbox" });
      box.checked = choice.shown;
      box.disabled = !choice.hideable;
      if (choice.hideable) {
        box.addEventListener("change", () => apply(choice.key));
        boxes.set(choice.key, box);
      }
      list.append(el("label", {
        class: "col-pick-row" + (choice.hideable ? "" : " is-fixed"),
      },
        box,
        el("span", { class: "col-pick-name" }, choice.label),
        // Not "disabled" and not a lock: the reader is being told the register keeps this
        // column, which is a fact about the table and not a refusal aimed at them.
        choice.hideable ? null : el("span", { class: "col-pick-always" }, "always"),
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
      const off = hiddenColumnSet(current);
      for (const [key, box] of boxes) box.checked = !off.has(key);
      reset.disabled = !current.length;
      paintCount();
    }

    function apply(key) {
      current = toggleColumn(columns, current, key);
      sync();
      if (onChange) onChange(current);
    }

    function showAll() {
      if (!current.length) return;
      current = [];
      sync();
      if (onChange) onChange(current);
    }

    body.append(head, list, el("div", { class: "col-pick-foot" }, reset));
    sync();

    const panel = openPopover({
      anchor: btn,
      className: "col-pick-pop",
      ariaLabel: label,
      position: { width: 260, minWidth: 220, maxHeight: 420, minHeight: 160 },
      build: () => body,
    });
    // Focus goes INTO the panel or Tab walks straight past it: the popover is portaled to the
    // end of <body>, so "the next control" is not what it looks like from the button.
    const first = [...boxes.values()][0];
    if (first && panel.isOpen()) first.focus();
  }

  btn.set = (next) => {
    current = [...hiddenColumnSet(next)];
    paintCount();
  };
  paintCount();
  return btn;
}
