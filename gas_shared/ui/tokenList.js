// A rule field that holds a LIST of opaque strings, as chips plus one picker.
//
// Two fields on the Problem tree tab are lists of literal strings the cascade matches on —
// the AI verdicts that reach SUSPECTED, and the combo groups that grant TOTAL impact. Both
// were single text inputs holding a comma-separated line. That control has three problems
// and they compound: the separator is invisible grammar the operator has to know, there is
// no way to discover what values the tenant actually produces, and a typo does not fail —
// it silently matches nothing and the axis quietly reads UNKNOWN for the rest of the
// landscape. Nothing on the page would say so.
//
// WHY THIS IS NOT `filterChipRow`. That component looks identical and is not: its entries
// are FILTER PATCHES, its chips print `label · value` and announce "Clear filter: …", and
// removing one applies a patch to a view. None of those words are true of a rule token. What
// is worth taking from it is the part that is genuinely hard, and that is copied below: on
// removal, focus moves to the neighbouring ✕ found BY POSITION, because the row is rebuilt
// and a captured node would be detached by the time the handler runs.
//
// WHY THE PICKER IS `filterCombobox`. Search, the portaled listbox, the roving index, the
// ARIA wiring and `allowCustom`'s "use what you typed" row all already exist there and are
// the expensive half of this control. This adds the chips and nothing else.
//
// ON COMMITTING A HALF-TYPED TOKEN: the combobox fires `onChange` on Enter, on a click and
// on blur — the three ways a person finishes typing — so clicking away from a partly typed
// token adds it. That is deliberate and matches the gap-code field on this same page:
// showing what someone typed as a chip they can drop in one click is better than silently
// discarding it, and a token nobody meant is visible rather than lurking in a comma list.

import { el, clear } from "./dom.js";
import { filterCombobox } from "./combobox.js";

/**
 * opts: values (string[]), options (combobox rows, may arrive later via setOptions),
 * ariaLabel, placeholder, emptyText, onChange(next).
 *
 * The returned node carries `.sync(values)`, `.setOptions(rows)` and `.closePopover()`.
 * The picker is built ONCE and only the chips are rebuilt — the rule this page keeps
 * everywhere, because a rebuilt input is a dropped keystroke and focus on `<body>`.
 */
export function tokenList({
  values = [], options = [], ariaLabel, placeholder = "Add…", emptyText = "", onChange,
}) {
  let current = values.slice();

  const chips = el("div", { class: "token-chips", role: "list" });
  const picker = filterCombobox({
    value: "",
    options,
    ariaLabel,
    searchPlaceholder: placeholder,
    editable: true,
    allowCustom: true,
    inputClass: "token-input",
    onChange: (v) => {
      const token = String(v || "").trim();
      // Always clear the box, including on a duplicate: leaving the text behind after a
      // pick that changed nothing reads as "it didn't take".
      picker.setValue("");
      if (!token || current.indexOf(token) >= 0) return;
      commit(current.concat([token]));
    },
  });

  const node = el("div", { class: "token-list" }, chips, picker);

  function commit(next) {
    current = next;
    paint();
    onChange(current.slice());
  }

  function paint() {
    clear(chips);
    if (!current.length) {
      if (emptyText) chips.append(el("span", { class: "token-empty small muted" }, emptyText));
      return;
    }
    current.forEach((token) => {
      const x = el("button", {
        type: "button",
        class: "token-x",
        "aria-label": `Remove ${token}`,
        onclick: () => {
          // By position, not by reference: paint() below replaces every one of these nodes,
          // so a captured neighbour would be detached before it could take focus.
          const before = [...chips.querySelectorAll(".token-x")];
          const at = before.indexOf(x);
          const wanted = before[at + 1] || before[at - 1];
          const wantedAt = wanted ? before.indexOf(wanted) : -1;
          commit(current.filter((t) => t !== token));
          const after = [...chips.querySelectorAll(".token-x")];
          const target = wantedAt >= 0 ? after[Math.min(wantedAt, after.length - 1)] : null;
          if (target) target.focus();
          else {
            const input = picker.querySelector("input");
            if (input) input.focus();
          }
        },
      }, "✕");
      chips.append(el("span", { class: "token", role: "listitem" }, el("span", {}, token), x));
    });
  }

  paint();

  node.sync = (next) => {
    const list = (next || []).slice();
    if (JSON.stringify(list) === JSON.stringify(current)) return;
    current = list;
    paint();
  };
  node.setOptions = (rows) => picker.setOptions(rows);
  node.closePopover = () => picker.closePopover();
  return node;
}
