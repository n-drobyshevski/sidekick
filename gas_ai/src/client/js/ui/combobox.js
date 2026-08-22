// The searchable combobox: a trigger plus a listbox popover portaled to <body>.

import { clear, el } from "./dom.js";
import { popoverDismiss, positionPopover } from "./popover.js";
import { portalClosed, portalOpened } from "./portals.js";
import { debounce } from "./timing.js";


import { truncTip } from "./tip.js";
let _comboboxSeq = 0;

/** How many matches the list will render before it stops and says so. Rebuilding runs
 *  synchronously on every keystroke, and the asset picker's list is the whole landscape. */
const COMBOBOX_MATCH_CAP = 100;
const COMBOBOX_DEBOUNCE_MS = 120;

function comboNormalize(list) {
  return (list || []).map((o) => (typeof o === "string"
    ? { value: o, label: o, hint: "", group: "" }
    : { value: o.value, label: o.label == null ? o.value : o.label, hint: o.hint || "", group: o.group || "" }));
}

function comboMatches(o, q) {
  return o.label.toLowerCase().includes(q) || (o.hint && o.hint.toLowerCase().includes(q));
}

/**
 * Searchable combobox: a trigger plus a listbox popover, portaled to `<body>`.
 *
 * Forked from the OS-vulns tool's `filterCombobox` (gas/src/client/js/ui.js), which
 * fronts ~20 sidebar options where the value IS the label. This one fronts the whole
 * asset landscape from inside a scrolling panel, so it differs in six ways:
 *
 *   - options are `{value, label, hint, group}` (or plain strings), searched on `label`
 *     and rendered under `role="presentation"` group headers that the keyboard walk skips;
 *   - `pinnedRows` replaces the hardwired `value === ""` reset row, because "Start from"
 *     has two preset rows and "" is a real state rather than "no filter";
 *   - the trigger prints the option's LABEL, resolved from the value, and an unknown
 *     value (a seed the option list never carried) keeps a caller-supplied fallback
 *     rather than blanking to the default;
 *   - `setOptions()` swaps the list in without firing onChange, keeping the query and
 *     clamping the active row, so a lazily-arriving fetch cannot disturb an open popover;
 *   - it opens downward, and repositions rather than closing when the panel behind it
 *     scrolls;
 *   - matches are capped and input is debounced.
 *
 * `onChange(value)` fires on selection. The returned wrapper carries `setValue(v)` and
 * `setOptions(list)`, neither of which fires `onChange` — that is what lets a caller
 * reflect external state onto the control without looping.
 *
 * ## Editable mode
 *
 * `editable: true` swaps the trigger button for a real text input carrying
 * `role="combobox"`, per the ARIA editable-combobox pattern: DOM focus never leaves the
 * input, the caret is a `tabindex="-1"` sibling, and the active row travels as
 * `aria-activedescendant`. It exists for the AARS pricing cascade, where the value is a
 * compliance-gap code: most are drawn from a known catalogue, but tenant-specific Wiz
 * finding shortIds (`SUB-082`) are a routine input the catalogue can never carry. A
 * pick-only control would make the one value nobody can look up the slowest to enter.
 *
 * So in editable mode: `allowCustom` synthesises a "use what you typed" row, Escape
 * dismisses the list WITHOUT reverting what was typed, and `onChange` fires on Enter, on
 * a click, and on blur — the three ways a person finishes typing.
 */
export function filterCombobox({
  value, options, pinnedRows, defaultLabel, ariaLabel, searchPlaceholder = "Search…",
  fallbackLabel = "", searchThreshold = 7, onChange, id,
  editable = false, allowCustom = false, inputClass = "", popClass = "", transform,
}) {
  const seq = ++_comboboxSeq;
  const listboxId = `combobox-list-${seq}`;
  let current = value || "";
  let opts = comboNormalize(options);
  const pinned = comboNormalize(pinnedRows);
  /** What the caller stores. Editable mode uppercases codes; everything else is identity. */
  const clean = typeof transform === "function" ? transform : (v) => v;

  function labelFor(v) {
    const hit = [...pinned, ...opts].find((o) => o.value === v);
    if (hit) return hit.label;
    // A value the list doesn't carry — e.g. a graph seeded from a derived risk node,
    // which the asset options endpoint never returns. Better a caller-supplied name than
    // silently reading as "nothing selected".
    return v ? (fallbackLabel || v) : defaultLabel;
  }

  let trigger;      // what the popover is positioned against, and what re-takes focus
  let triggerText;  // pick-only: the span printing the resolved label
  let editInput;    // editable: the input that IS the combobox

  if (editable) {
    editInput = el("input", {
      type: "text",
      class: `combobox-input${inputClass ? " " + inputClass : ""}`,
      role: "combobox",
      "aria-expanded": "false",
      "aria-controls": listboxId,
      "aria-autocomplete": "list",
      "aria-label": ariaLabel,
      autocomplete: "off",
      spellcheck: "false",
      placeholder: searchPlaceholder,
      value: current,
    });
    const caret = el("button", {
      type: "button", class: "combobox-caret-btn", tabindex: "-1", "aria-hidden": "true",
      onclick: (e) => {
        e.stopPropagation();
        // The caret browses: it opens on the WHOLE list, not on what is already typed,
        // because "show me everything" is the only thing it can mean.
        if (open) close();
        else openPop("");
        editInput.focus();
      },
    }, "▾");
    trigger = el("div", { class: "combobox-edit" }, editInput, caret);
  } else {
    triggerText = el("span", { class: "combobox-trigger-text" });
    trigger = el(
      "button",
      {
        type: "button", class: "combobox-trigger",
        "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": ariaLabel,
        onclick: (e) => { e.stopPropagation(); open ? close() : openPop(); },
      },
      triggerText,
      el("span", { class: "combobox-caret", "aria-hidden": "true" }, "▾"),
    );
  }
  const wrap = el("div", { class: `combobox${editable ? " combobox--editable" : ""}`, id: id || null }, trigger);

  function paintTrigger() {
    if (editable) {
      // Never fight the cursor: an external setValue while someone is typing is ignored,
      // exactly as the AARS page's own setValue guard does.
      if (document.activeElement !== editInput && editInput.value !== current) {
        editInput.value = current;
      }
      return;
    }
    const text = labelFor(current);
    triggerText.textContent = text;
    // Only when the label was actually clipped: a project called "prod" needs no card.
    truncTip(triggerText, text);
  }
  paintTrigger();

  let open = false;
  let pop = null;
  let release = null;   // the open popover's listener teardown
  let searchEl = null;
  let listEl = null;
  let query = "";
  let rows = [];      // selectable rows only, in DOM order — the roving-index array
  let activeIndex = 0;

  /** Whichever element owns the query, and therefore aria-activedescendant. */
  function queryOwner() {
    return editable ? editInput : (searchEl || listEl);
  }

  function matching() {
    const q = query.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter((o) => comboMatches(o, q));
  }

  function optionRow(o, idx) {
    const optId = `${listboxId}-opt-${idx}`;
    const row = el(
      "li",
      { id: optId, role: "option", class: `combobox-option${o.custom ? " combobox-option--custom" : ""}`,
        "aria-selected": current === o.value ? "true" : "false" },
      o.label,
      o.hint ? el("span", { class: "combobox-option-hint" }, o.hint) : null,
    );
    // mousedown, not click: in editable mode a click would blur the input first, and the
    // blur handler would commit the half-typed text before the pick landed.
    row.addEventListener("mousedown", (e) => { e.preventDefault(); select(o.value); });
    listEl.append(row);
    rows.push({ value: o.value, id: optId, node: row });
  }

  /**
   * Rebuild the rows for the current query. `keepActive` holds the highlight on the row
   * carrying that value if it survived the rebuild — used by setOptions/setValue, which
   * must not yank the keyboard position out from under someone mid-scroll. Typing resets
   * the highlight to the first row instead.
   */
  function buildRows({ keepActive } = {}) {
    clear(listEl);
    rows = [];
    let idx = 0;
    // Pinned presets sit above the list, but they are searchable text like anything else:
    // holding an unmatched "All toxic combinations" at the top while someone types an
    // asset name puts a wrong row under the first ArrowDown. Matched on hint as well as
    // label, or the pinned rows would be the only ones not findable by meaning.
    const q = query.trim().toLowerCase();
    const shownPinned = q ? pinned.filter((o) => comboMatches(o, q)) : pinned;
    for (const p of shownPinned) optionRow(p, idx++);
    if (shownPinned.length) rows[rows.length - 1].node.classList.add("combobox-option--last-pinned");

    const matches = matching();
    const shown = matches.slice(0, COMBOBOX_MATCH_CAP);
    let group = "";
    for (const o of shown) {
      // A header only earns its place when the group below it is non-empty, which the
      // slice above can change from keystroke to keystroke.
      if (o.group && o.group !== group) {
        listEl.append(el("li", { role: "presentation", class: "combobox-group" }, o.group));
        group = o.group;
      } else if (!o.group) {
        group = "";
      }
      optionRow(o, idx++);
    }

    // A value the catalogue does not carry is a normal input here, so it gets a row of its
    // own rather than an empty list. Visible state beats absence: "not in the catalogue" is
    // something the operator should see, not infer.
    const typed = clean(query.trim());
    const known = typed && [...pinned, ...opts].some((o) => o.value === typed);
    if (allowCustom && typed && !known) {
      optionRow({ value: typed, label: `Use “${typed}” as typed`, hint: "not in the catalogue", custom: true }, idx++);
    }

    if (!rows.length) {
      listEl.append(el("li", { role: "presentation", class: "combobox-empty" },
        query.trim() ? "No matches" : "Nothing to choose from"));
    } else if (matches.length > shown.length) {
      listEl.append(el("li", { role: "presentation", class: "combobox-empty" },
        `Showing ${shown.length} of ${matches.length} — keep typing to narrow`));
    }

    const want = keepActive === undefined ? current : keepActive;
    const at = rows.findIndex((r) => r.value === want);
    activeIndex = at >= 0 ? at : 0;
    highlightActive();
  }

  function highlightActive() {
    rows.forEach((r, i) => r.node.classList.toggle("active", i === activeIndex));
    const activeId = rows[activeIndex] ? rows[activeIndex].id : "";
    const owner = queryOwner();
    if (owner) owner.setAttribute("aria-activedescendant", activeId);
  }

  function scrollActiveIntoView() {
    const row = rows[activeIndex];
    if (row) row.node.scrollIntoView({ block: "nearest" });
  }

  function select(v) {
    current = clean(v);
    close();
    if (editable) {
      editInput.value = current;
      editInput.focus();
      // Caret to the end: the value was replaced wholesale, and leaving the caret mid-word
      // makes the next keystroke edit somewhere nobody chose.
      const n = editInput.value.length;
      editInput.setSelectionRange(n, n);
    } else {
      paintTrigger();
      trigger.focus();
    }
    if (onChange) onChange(current);
  }

  /** Editable only: finish what was typed, without a pick. Fires only on a real change. */
  function commitTyped() {
    const v = clean(editInput.value.trim());
    if (v === current) {
      if (editInput.value !== current) editInput.value = current;
      return;
    }
    current = v;
    editInput.value = current;
    if (onChange) onChange(current);
  }

  // Width comes from the trigger (floored at 240px) so the list lines up under the control it
  // belongs to; the room left below caps the LIST's height, so the list scrolls rather than the
  // popover running off screen. Both are `positionPopover`'s defaults — see ui/popover.js.
  function position() {
    positionPopover(pop, trigger, {
      onRoom: (room) => { listEl.style.maxHeight = room + "px"; },
    });
  }

  const onSearchInput = debounce(() => {
    query = searchEl.value;
    buildRows({ keepActive: null });
  }, COMBOBOX_DEBOUNCE_MS, { pageScoped: false });

  // Editable mode types into the trigger itself, so its rebuild is debounced separately —
  // and cancelled by close(), like the pick-only one, so a closed popover can never be
  // rebuilt by a keystroke that landed just before it shut.
  const onTypeInput = debounce(() => {
    if (!open) return;
    query = editInput.value;
    buildRows({ keepActive: null });
    position();
  }, COMBOBOX_DEBOUNCE_MS, { pageScoped: false });

  function popClasses() {
    return `combobox-pop${popClass ? " " + popClass : ""}`;
  }

  function openPop(initialQuery) {
    open = true;
    query = editable ? (initialQuery === undefined ? editInput.value : initialQuery) : "";
    listEl = el("ul", { role: "listbox", class: "combobox-list", id: listboxId, "aria-label": ariaLabel });
    if (editable) {
      searchEl = null;
      pop = el("div", { class: popClasses() }, listEl);
      editInput.setAttribute("aria-expanded", "true");
    } else {
      const showSearch = opts.length > searchThreshold;
      if (showSearch) {
        searchEl = el("input", {
          type: "text", class: "combobox-search", placeholder: searchPlaceholder,
          role: "combobox", "aria-expanded": "true", "aria-controls": listboxId,
          "aria-autocomplete": "list", autocomplete: "off", spellcheck: "false",
          // Debounced: each rebuild is one <li> per match, synchronously, and this list can
          // be the whole landscape. Not page-scoped — close() below cancels it, and this
          // control outlives no page.
          oninput: onSearchInput,
          onkeydown: onListKey,
        });
        pop = el("div", { class: popClasses() }, searchEl, listEl);
      } else {
        searchEl = null;
        listEl.setAttribute("tabindex", "-1");
        listEl.addEventListener("keydown", onListKey);
        pop = el("div", { class: popClasses() }, listEl);
      }
      trigger.setAttribute("aria-expanded", "true");
    }
    document.body.append(pop);
    portalOpened();
    buildRows();
    position();

    // Outside click, Escape, focus leaving, scroll and resize — the shared contract, so this
    // control and the query palette cannot drift apart on what "dismissed" means.
    release = popoverDismiss({
      pop,
      anchor: trigger,
      isInside,
      close,
      onEscape,
      onFocusOut,
      onReposition: position,
      hosts: [wrap, pop],
    });

    if (editable) editInput.focus();
    else if (searchEl) searchEl.focus();
    else listEl.focus();
  }

  function close() {
    if (!open) return;
    open = false;
    onSearchInput.cancel();
    onTypeInput.cancel();
    (editable ? editInput : trigger).setAttribute("aria-expanded", "false");
    if (editable) editInput.removeAttribute("aria-activedescendant");
    if (release) { release(); release = null; }
    if (pop) pop.remove();
    portalClosed();
    pop = null; searchEl = null; listEl = null; rows = [];
  }

  function isInside(node) { return node && (wrap.contains(node) || (pop && pop.contains(node))); }
  function onFocusOut() {
    close();
    // Leaving the field IS a way of finishing what you typed. Committing here is what
    // makes tabbing out of a half-entered code do the obvious thing rather than lose it.
    if (editable) commitTyped();
  }
  function onEscape() {
    close();
    // Escape dismisses the LIST. It deliberately does not revert the field: someone who
    // typed SUB-082 and pressed Escape to get the popover out of the way has not asked to
    // lose what they typed.
    (editable ? editInput : trigger).focus();
  }

  function onListKey(e) {
    if (!rows.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, rows.length - 1); highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "Home") { e.preventDefault(); activeIndex = 0; highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "End") { e.preventDefault(); activeIndex = rows.length - 1; highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "Enter") { e.preventDefault(); const row = rows[activeIndex]; if (row) select(row.value); }
  }

  if (editable) {
    editInput.addEventListener("input", () => {
      if (!open) openPop(editInput.value);
      else onTypeInput();
    });
    // Focus opens the list only when the field is EMPTY — the "I do not know what to type"
    // case, which here is a freshly added rule, and the one moment the whole catalogue is
    // the most useful thing to show. Opening on every focus would drop a popover over the
    // row below each time someone tabbed past, and would re-open the list select() had just
    // closed, since select() hands focus back to the input. A non-empty field opens on the
    // caret, on ArrowDown, or on the next keystroke.
    editInput.addEventListener("focus", () => {
      if (!open && editInput.value === "") openPop("");
    });
    /**
     * Rebuild now if the debounce has not caught up. Without this, typing a code faster
     * than the debounce and pressing Enter commits whatever was highlighted for the
     * PREVIOUS query — which for a field pre-filled with a known code means quietly
     * replacing a freshly typed tenant ID with the code that was already there.
     */
    function flushQuery() {
      if (!open || query === editInput.value) return;
      onTypeInput.cancel();
      query = editInput.value;
      buildRows({ keepActive: null });
    }
    editInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") flushQuery();
      if (e.key === "Enter") {
        e.preventDefault();
        // The list wins when a row is highlighted; otherwise Enter finishes what was typed.
        const row = open && rows[activeIndex];
        if (row) select(row.value);
        else { close(); commitTyped(); }
        return;
      }
      if (e.key === "ArrowDown" && !open) { e.preventDefault(); openPop(editInput.value); return; }
      // Home and End belong to the text caret while you are typing into it, so only the
      // two arrows are handed to the list — this is the one place the editable pattern
      // cannot reuse the pick-only keyboard contract wholesale.
      if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) onListKey(e);
    });
  }

  /** Reflect an external state change onto the control — no onChange, no focus move. */
  wrap.setValue = (v) => {
    current = clean(v || "");
    paintTrigger();
    if (open) buildRows({ keepActive: rows[activeIndex] ? rows[activeIndex].value : current });
  };
  /** Swap the option list in (the lazy fetch), keeping any open popover usable. */
  wrap.setOptions = (list) => {
    opts = comboNormalize(list);
    paintTrigger();
    if (open) buildRows({ keepActive: rows[activeIndex] ? rows[activeIndex].value : current });
  };
  wrap.isOpen = () => open;
  wrap.closePopover = close;
  /** The focusable element, for callers that move focus to a row's field. */
  wrap.focusable = () => (editable ? editInput : trigger);
  return wrap;
}
