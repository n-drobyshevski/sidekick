// The searchable combobox: a trigger plus a listbox popover portaled to <body>.

import { clear, el } from "./dom.js";
import { popoverDismiss, positionPopover } from "./popover.js";
import { portalClosed, portalOpened } from "./portals.js";
import { debounce } from "./timing.js";


import { truncTip } from "./tip.js";
import { uiIcon } from "./uiIcons.js";
let _comboboxSeq = 0;

/** How many matches the list will render before it stops and says so. Rebuilding runs
 *  synchronously on every keystroke, and the asset picker's list is the whole landscape. */
const COMBOBOX_MATCH_CAP = 100;
const COMBOBOX_DEBOUNCE_MS = 120;

/**
 * The one open popover, so a NAVIGATION WITH NO CLICK BEHIND IT can dismiss it.
 *
 * Ported from gas's fork (`gas/src/client/js/ui/combobox.js`, now deleted) rather than
 * dropped with it — it is the one thing that fork had and this file did not. `popoverDismiss`
 * covers every real navigation, because clicking a nav link IS a document click. What it does
 * not cover is a route change with no click: a hashchange typed into the address bar, the
 * back button, a programmatic `location.hash =`. On the merged z scale the popover sits ABOVE
 * the route overlay (`--z-popover` 52 against the veil's 20), so what was left behind was not
 * a rendering artifact but a live panel floating over a page the register had already moved
 * on from — offering a scope for content no longer on screen. Measured in the dev harness:
 * open the header scope switcher, set `location.hash`, and the panel was still in the DOM.
 *
 * ONE INSTANCE, because only one of these can be open at a time: opening any combobox closes
 * every other through `popoverDismiss`'s own document listener.
 */
let _openCombobox = null;

/** Dismiss the open combobox popover, if there is one. Called from an app's `route()`. */
export function closeCombobox() {
  if (_openCombobox) _openCombobox();
}

function comboNormalize(list) {
  return (list || []).map((o) => (typeof o === "string"
    ? { value: o, label: o, hint: "", group: "", icon: "" }
    : {
      value: o.value, label: o.label == null ? o.value : o.label,
      hint: o.hint || "", group: o.group || "",
      // A uiIcon name, drawn before the label. Decoration by contract: a row must still say
      // in words whatever the glyph is meant to suggest, because a reader who cannot tell
      // two 14px marks apart is reading the label either way.
      icon: o.icon || "",
    }));
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
 *   - options are `{value, label, hint, group, icon}` (or plain strings), searched on `label`
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
 *
 * THREE EXTRAS ARE OPT-IN AND INERT UNLESS ASKED FOR, so a list that wants to be a plain
 * list stays one: `header: {title, note}` puts a heading and a sentence above the search;
 * `checkSelected` marks the chosen row with a glyph rather than colour and weight alone; and
 * a per-option `icon` draws a uiIcon before the label. They exist because one caller — the
 * app-header project switcher — is not choosing a value, it is changing what every figure in
 * the app is counted over, and that consequence has to be on the panel that does it.
 */
export function filterCombobox({
  value, options, pinnedRows, defaultLabel, ariaLabel, searchPlaceholder = "Search…",
  fallbackLabel = "", searchThreshold = 7, onChange, id, leading = null,
  editable = false, allowCustom = false, inputClass = "", popClass = "", transform,
  header = null, checkSelected = false,
}) {
  const seq = ++_comboboxSeq;
  const listboxId = `combobox-list-${seq}`;
  const noteId = `${listboxId}-note`;
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
      // A caller-supplied glyph inside the trigger, before the label. Decoration only: the
      // trigger's accessible name is `ariaLabel`, so a node here adds no second reading.
      // Pick-only mode alone — the editable trigger is a real text input, and an icon
      // inside its box would sit on top of what is being typed.
      leading || null,
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
    // A CONTROL HOLDING A VALUE IS IN A STATE, and it says so in its own chrome rather than
    // only in the text it happens to print. The second half of gas's fork, ported with the
    // first: `.combobox-trigger.active` is an accent border in that app's sheet, and inert in
    // the other two, which style the scope trigger through `.scope-combo.scoped` instead.
    // Both are additive — a list whose sheet names neither renders exactly as before.
    trigger.classList.toggle("active", !!current);
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
    const chosen = current === o.value;
    const row = el(
      "li",
      { id: optId, role: "option", class: `combobox-option${o.custom ? " combobox-option--custom" : ""}`,
        "aria-selected": chosen ? "true" : "false" },
      o.icon ? el("span", { class: "combobox-option-icon", "aria-hidden": "true" }, uiIcon(o.icon, 14)) : null,
      o.label,
      o.hint ? el("span", { class: "combobox-option-hint" }, o.hint) : null,
      // The mark this list has always been missing. Selected was weight AND colour, which the
      // CSS beside it says is the floor, not the ceiling — a glyph is what "never colour
      // alone" actually asks for. Opt-in, because a check against a list that offers no
      // persistent choice (an operator, a code) would be claiming a state it does not keep.
      checkSelected && chosen
        ? el("span", { class: "combobox-check", "aria-hidden": "true" }, uiIcon("check", 14))
        : null,
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

  /**
   * The panel's own heading: what this list is, and what picking from it does.
   *
   * A list of project names cannot say that choosing one re-scopes every figure on every
   * page — the consequence is not in any of the rows, and a control whose consequence is
   * invisible is one a reader has to discover by trying it. The note carries an id and the
   * listbox points `aria-describedby` at it, so the sentence is read once when the list is
   * reached rather than never.
   */
  function headerBlock() {
    if (!header) return null;
    return el("div", { class: "combobox-head" },
      header.title ? el("div", { class: "combobox-head-title" }, header.title) : null,
      header.note ? el("p", { class: "combobox-head-note", id: noteId }, header.note) : null,
    );
  }

  function openPop(initialQuery) {
    open = true;
    query = editable ? (initialQuery === undefined ? editInput.value : initialQuery) : "";
    listEl = el("ul", {
      role: "listbox", class: "combobox-list", id: listboxId, "aria-label": ariaLabel,
      "aria-describedby": header && header.note ? noteId : null,
    });
    if (editable) {
      searchEl = null;
      pop = el("div", { class: popClasses() }, headerBlock(), listEl);
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
        // The field is composed rather than bare so the magnifier can be a real node: this
        // app draws icons through uiIcon, and the CSS alternative — a data URI on
        // background-image — cannot even be written here, since an SVG namespace carries a
        // `//` and the middlebox guard fails the build on one surviving into the stylesheet.
        pop = el("div", { class: popClasses() },
          headerBlock(),
          el("div", { class: "combobox-search-wrap" },
            el("span", { class: "combobox-search-icon", "aria-hidden": "true" }, uiIcon("search", 14)),
            searchEl),
          listEl);
      } else {
        searchEl = null;
        listEl.setAttribute("tabindex", "-1");
        listEl.addEventListener("keydown", onListKey);
        pop = el("div", { class: popClasses() }, headerBlock(), listEl);
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
    _openCombobox = close;
  }

  function close() {
    if (!open) return;
    open = false;
    // Only if it is still OURS. Opening a second combobox closes this one through the
    // document listener and then claims the slot; clearing unconditionally here would drop
    // the new one's handle and leave IT unreachable from `closeCombobox()`.
    if (_openCombobox === close) _openCombobox = null;
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
