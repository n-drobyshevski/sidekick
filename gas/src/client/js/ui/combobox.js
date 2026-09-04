// The searchable combobox — AND THE ONE COMPONENT THIS PACKAGE COULD NOT HAND BACK.
//
// gas_shared/ui/combobox.js is the same control, forked FROM this one, and swapping to it is
// what P4 set out to do. It is blocked on two glyphs, and the block is worth stating exactly
// because it is small and someone will otherwise re-derive it:
//
//   THE SHARED LIST DRAWS A ROW'S GLYPH THROUGH `gas_shared/ui/uiIcons.js`, BY NAME. Its
//   `icon:` field is a uiIcon name, resolved inside the shared module, so a caller cannot
//   supply a mark the shared set does not hold. `scopeSwitch.js` supplies four:
//     tag      — present in the shared set
//     folders  — present in the shared set
//     users    — ABSENT. The support-group rows draw it; the shared set has `group`, which
//                is two nested squares (a graph grouping), not people.
//     noTag    — ABSENT. The `Unassigned` and `Not attributable` rows draw it: the same tag
//                mark struck through, i.e. this dimension with no value. The shared set has
//                `not` (a circle with a slash), which is a prohibition, not an absence.
//   `uiIcon()` falls back to a single 1px dot for an unknown name, silently. So the swap
//   would leave every support-group row and both no-domain rows drawing a dot, with nothing
//   failing — the exact shape of defect CLAUDE.md calls "a zero has to prove it looked".
//
// THE EXACT SHARED CHANGE THAT UNBLOCKS IT: add `users` and `noTag` to `PATHS` in
// gas_shared/ui/uiIcons.js (both already exist, drawn on the same 16-grid, in
// gas/src/client/js/uiIcons.js — copy the two entries). Then delete this file, take
// `filterCombobox` from the barrel, and drop `filterCombobox` from the parity allow-list in
// test/shared.test.js. P4's brief allowed exactly two edits under gas_shared/ and this is not
// one of them, so it is reported rather than made.
//
// WHAT DID CHANGE HERE. The trigger carried `title: labelFor(current)` — a native tooltip,
// which `el()` now refuses outright (gas_shared/ui/dom.js: unreachable by keyboard, absent on
// touch, truncated by the OS). It is `truncTip` now, the shared answer: the full label is
// offered as a hover card only when the trigger has actually clipped it.

import { clear, el } from "../../../../../gas_shared/ui/dom.js";
import { truncTip } from "../../../../../gas_shared/ui/tip.js";
import { uiIcon } from "../uiIcons.js";

let _comboboxSeq = 0;

// The one open popover, so a navigation can dismiss it.
//
// WHY THIS EXISTS AT ALL. The popover is portaled to <body>, and on the merged z scale
// (P3) it sits ABOVE the route overlay — --z-popover is 52 where the veil is 20, the
// reverse of this app's old private scale. Its own dismissal is a capture-phase document
// click, which covers every real navigation, because clicking a nav link IS a document
// click. What it does not cover is a route change with no click behind it: a hashchange
// from the address bar, a back button, a programmatic `location.hash =`. Before the z
// merge that left a popover UNDER the veil, which read as a rendering artifact; now it
// leaves one floating OVER the page it was opened from, offering a scope the register
// behind it has already moved on from.
//
// NOT `popoverDismiss` FROM gas_shared/ui/popover.js. That is per-popover wiring — it takes
// a spec and returns a release function — not a global "close whatever is open". There is no
// shared global, so this is the app's, held to one instance because only one of these can be
// open at a time (opening any of them closes the others through the same document listener).
let _openCombobox = null;

/** Dismiss the open combobox popover, if there is one. Called by app.js's route(). */
export function closeCombobox() {
  if (_openCombobox) _openCombobox();
}

/**
 * An option, in the one shape the list works in.
 *
 * A plain string is still an option — `value === label`, no hint, no group — because most
 * lists in this app are exactly that and should not have to say so. The object form exists
 * for the header's scope switcher, where the value is not the label (a domain and a support
 * group can share a name, so one kind carries a prefix) and where a row has to say in words
 * which kind it is and how much of the register it covers.
 */
function comboNormalize(list) {
  return (list || []).map((o) => (typeof o === "string"
    ? { value: o, label: o, hint: "", group: "", icon: "" }
    : {
      value: o.value,
      label: o.label == null ? o.value : o.label,
      hint: o.hint || "",
      group: o.group || "",
      // A uiIcon name, drawn before the label. Decoration by contract: a row must still say
      // in words whatever the glyph is meant to suggest, because a reader who cannot tell two
      // 14px marks apart is reading the label either way.
      icon: o.icon || "",
    }));
}

/**
 * Reusable searchable combobox: a trigger `<button>` plus a listbox popover. Dismiss is
 * the app's inline-popover recipe — capture-phase document click to close on outside
 * click, document keydown for Escape, focusout when focus leaves the widget.
 *
 * The popover is portaled to `document.body` (not appended inside the wrapper) because a
 * trigger can sit inside a scrolling region that would clip it, and is positioned `fixed`.
 * It OPENS DOWNWARD and flips above only when there is genuinely no room below and more
 * above. It closes (rather than repositions) on scroll/resize.
 *
 * `options` are plain strings or `{value, label, hint, group, icon}` (see comboNormalize).
 * Rows are searched on label AND hint, and a `group` emits a heading when it changes while
 * walking the list in order — so a list that does not sort by group would fragment its own
 * headings. A search input appears only once the list is longer than `searchThreshold`, so a
 * short list stays a plain dropdown.
 *
 * `pinnedRows` are rows shown above the list and never filtered by the query — the reset row
 * is one of these. Omit it and one is synthesised from `defaultLabel` at value "", which is
 * what every plain filter wants.
 *
 * THREE EXTRAS ARE OPT-IN AND INERT UNLESS ASKED FOR, so a list that wants to be a plain list
 * stays one: `header: {title, note}` puts a heading and a sentence above the search;
 * `checkSelected` marks the chosen row with a glyph rather than colour and weight alone; and
 * `leading` puts a node inside the trigger before its text. They exist because one caller —
 * the app-header scope switcher — is not choosing a value, it is changing what every figure in
 * the app is counted over, and that consequence has to be on the panel that does it.
 *
 * `fallbackLabel` is what the trigger prints for a value the option list does not carry.
 * Without it a stale selection prints its raw value, which reads as corruption rather than as
 * a scope that no longer matches what was scanned.
 *
 * `onChange(newValue)` fires on selection. The returned wrapper carries `setValue(v)`, which
 * updates the shown label/active state WITHOUT firing onChange — for callers that need to
 * reflect external state onto the control without looping.
 */
export function filterCombobox({
  value, options, pinnedRows, defaultLabel, ariaLabel, searchPlaceholder = "Search…",
  fallbackLabel = "", searchThreshold = 7, onChange, id, leading = null,
  popClass = "", header = null, checkSelected = false,
}) {
  const seq = ++_comboboxSeq;
  const listboxId = `combobox-list-${seq}`;
  const noteId = `${listboxId}-note`;
  let current = value || "";
  const opts = comboNormalize(options);
  const pinned = pinnedRows
    ? comboNormalize(pinnedRows)
    : comboNormalize([{ value: "", label: defaultLabel }]);

  /** What the trigger prints: the option's LABEL, resolved from the value. */
  function labelFor(v) {
    if (!v) return pinned[0] ? pinned[0].label : defaultLabel;
    const hit = [...pinned, ...opts].find((o) => o.value === v);
    return hit ? hit.label : (fallbackLabel || v);
  }

  const triggerText = el("span", { class: "combobox-trigger-text" }, labelFor(current));
  const trigger = el(
    "button",
    {
      type: "button", class: `combobox-trigger${current ? " active" : ""}`,
      "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": ariaLabel,
      onclick: (e) => { e.stopPropagation(); open ? close() : openPop(); },
    },
    leading,
    triggerText,
    el("span", { class: "combobox-caret", "aria-hidden": "true" }, "▾"),
  );
  truncTip(triggerText, labelFor(current));
  const wrap = el("div", { class: "combobox", id: id || null }, trigger);

  let open = false;
  let pop = null;
  let searchEl = null;
  let listEl = null;
  let query = "";
  let rows = []; // [{ value, id, node }], pinned rows first, in DOM order
  let activeIndex = 0;

  function matchingOptions() {
    const q = query.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter((o) => o.label.toLowerCase().includes(q)
      || (o.hint && o.hint.toLowerCase().includes(q)));
  }

  /** One selectable row, with its optional glyph, hint and selected mark. */
  function optionRow(opt, optId) {
    const selected = current === opt.value;
    const row = el(
      "li",
      { id: optId, role: "option", class: "combobox-option",
        "aria-selected": selected ? "true" : "false" },
      opt.icon ? el("span", { class: "combobox-option-icon", "aria-hidden": "true" },
        uiIcon(opt.icon, 14)) : null,
      el("span", { class: "combobox-option-body" },
        el("span", { class: "combobox-option-label" }, opt.label),
        opt.hint ? el("span", { class: "combobox-option-hint" }, opt.hint) : null),
      checkSelected && selected
        ? el("span", { class: "combobox-option-check", "aria-hidden": "true" }, uiIcon("check", 14))
        : null,
    );
    // MOUSEDOWN WITH preventDefault, NOT CLICK, and this is a bug fix rather than a style.
    // A `click` listener never fires when the popover has a search box: mousedown on a row
    // blurs the input, the wrapper's `focusout` sees a null relatedTarget, close() removes the
    // popover, and the click lands on nothing. The search box only appears above
    // `searchThreshold` options, so every list in this app was under it and the defect stayed
    // invisible — the one control that most needed the search was the one that could not be
    // clicked. Preventing the default keeps focus in the input, so nothing blurs.
    row.addEventListener("mousedown", (e) => { e.preventDefault(); select(opt.value); });
    return row;
  }

  // Rebuilds the option rows for the current query. `resetActive` re-lands the active
  // (keyboard-highlighted) row on the first row — used when the query changes, per the
  // adaptive-search spec ("typing... resets the active option to the first row");
  // otherwise the active row tracks the current selection (used on open).
  function buildRows({ resetActive = false } = {}) {
    clear(listEl);
    rows = [];
    pinned.forEach((opt, i) => {
      const optId = `${listboxId}-opt-pin-${i}`;
      const row = optionRow(opt, optId);
      row.classList.add("combobox-option--reset");
      listEl.append(row);
      rows.push({ value: opt.value, id: optId, node: row });
    });

    const matches = matchingOptions();
    // `undefined`, not "": the ungrouped list is a real state and a detector seeded with ""
    // would suppress the first heading of a list whose first group is unnamed.
    let lastGroup;
    matches.forEach((opt, i) => {
      if (opt.group !== lastGroup) {
        // role="presentation" so the keyboard walk (which reads `rows`) steps over it and a
        // screen reader does not announce it as a choice.
        if (opt.group) {
          listEl.append(el("li", { role: "presentation", class: "combobox-group" }, opt.group));
        }
        lastGroup = opt.group;
      }
      const optId = `${listboxId}-opt-${i}`;
      const row = optionRow(opt, optId);
      listEl.append(row);
      rows.push({ value: opt.value, id: optId, node: row });
    });
    if (matches.length === 0 && query.trim()) {
      listEl.append(el("li", { role: "presentation", class: "combobox-empty" }, "No matches"));
    }

    if (resetActive) {
      activeIndex = 0;
    } else {
      const idx = rows.findIndex((r) => r.value === current);
      activeIndex = idx >= 0 ? idx : 0;
    }
    highlightActive();
  }

  function highlightActive() {
    rows.forEach((r, i) => r.node.classList.toggle("active", i === activeIndex));
    const activeId = rows[activeIndex] ? rows[activeIndex].id : "";
    if (searchEl) searchEl.setAttribute("aria-activedescendant", activeId);
    else if (listEl) listEl.setAttribute("aria-activedescendant", activeId);
  }

  function scrollActiveIntoView() {
    const row = rows[activeIndex];
    if (row) row.node.scrollIntoView({ block: "nearest" });
  }

  function select(v) {
    current = v;
    triggerText.textContent = labelFor(current);
    truncTip(triggerText, labelFor(current));
    trigger.classList.toggle("active", !!current);
    close();
    trigger.focus();
    if (onChange) onChange(current);
  }

  // Position the portaled popover against the live trigger rect: clamp horizontally to the
  // viewport, open DOWNWARD, and flip above only when there is genuinely no room below AND
  // more above — flipping toward the smaller gap would trade one clipped edge for another.
  // Either way the list's own max-height is capped to the space actually available on the
  // chosen side, so the LIST scrolls internally rather than the popover running off screen.
  function position() {
    const rect = trigger.getBoundingClientRect();
    const popWidth = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 8));
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const flipped = below < 200 && above > below;
    pop.style.width = `${popWidth}px`;
    pop.style.left = `${left}px`;
    if (flipped) {
      pop.style.top = "";
      pop.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    } else {
      pop.style.bottom = "";
      pop.style.top = `${rect.bottom + 6}px`;
    }
    // The head (title, note, search) sits outside the scrolling list, so the room the LIST
    // may take is what is left after it — measured rather than guessed, since the scope
    // switcher's note is two lines on a narrow header and one on a wide one.
    const headH = pop.clientHeight - (listEl.clientHeight || 0);
    const room = (flipped ? above : below) - Math.max(0, headH) - 12;
    listEl.style.maxHeight = `${Math.min(320, Math.max(120, room))}px`;
  }

  function openPop() {
    open = true;
    query = "";
    const showSearch = opts.length > searchThreshold;
    listEl = el("ul", { role: "listbox", class: "combobox-list", id: listboxId, "aria-label": ariaLabel });
    const head = [];
    if (header) {
      // WHAT THE PANEL HAS TO SAY THAT ITS ROWS CANNOT. Every row here is a name; none of them
      // can tell you what picking one does to the rest of the app. A consequence that large
      // should not have to be discovered by trying it.
      head.push(el("div", { class: "combobox-head" },
        el("div", { class: "combobox-head-title" }, header.title),
        header.note ? el("p", { class: "combobox-head-note", id: noteId }, header.note) : null));
    }
    if (showSearch) {
      searchEl = el("input", {
        type: "text", class: "combobox-search", placeholder: searchPlaceholder,
        role: "combobox", "aria-expanded": "true", "aria-controls": listboxId,
        "aria-autocomplete": "list", autocomplete: "off", spellcheck: "false",
        "aria-describedby": header && header.note ? noteId : null,
        oninput: () => { query = searchEl.value; buildRows({ resetActive: true }); },
        onkeydown: onListKey,
      });
      head.push(searchEl);
    } else {
      searchEl = null;
      listEl.setAttribute("tabindex", "-1");
      listEl.addEventListener("keydown", onListKey);
    }
    pop = el("div", { class: `combobox-pop${popClass ? " " + popClass : ""}` }, head, listEl);
    document.body.append(pop);
    buildRows();
    position();
    trigger.setAttribute("aria-expanded", "true");

    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    wrap.addEventListener("focusout", onFocusOut);
    pop.addEventListener("focusout", onFocusOut);

    if (searchEl) searchEl.focus();
    else listEl.focus();
    _openCombobox = close;
  }

  function close() {
    if (!open) return;
    open = false;
    if (_openCombobox === close) _openCombobox = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
    wrap.removeEventListener("focusout", onFocusOut);
    if (pop) { pop.removeEventListener("focusout", onFocusOut); pop.remove(); }
    pop = null; searchEl = null; listEl = null; rows = [];
  }

  function isInside(node) { return node && (wrap.contains(node) || (pop && pop.contains(node))); }
  function onDocClick(e) { if (!isInside(e.target)) close(); }
  function onFocusOut(e) { if (!isInside(e.relatedTarget)) close(); }
  function onKey(e) { if (e.key === "Escape") { close(); trigger.focus(); } }
  // Closing (rather than repositioning) on scroll/resize avoids a stale `fixed` popover
  // — cheap and correct, since these are rare while the popover is open. Scroll events
  // don't bubble, so this capture-phase window listener also sees the LIST's own
  // internal scrolling (e.g. scrollActiveIntoView() during keyboard nav) — that's not an
  // "outside" scroll and must not self-close the popover it's happening inside of.
  function onScrollOrResize(e) { if (e.target && pop && pop.contains(e.target)) return; close(); }

  function onListKey(e) {
    if (!rows.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, rows.length - 1); highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "Home") { e.preventDefault(); activeIndex = 0; highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "End") { e.preventDefault(); activeIndex = rows.length - 1; highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "Enter") { e.preventDefault(); const row = rows[activeIndex]; if (row) select(row.value); }
  }

  // Programmatic reset (clearScope): updates the shown label/active state without
  // calling onChange or touching open state.
  wrap.setValue = (v) => {
    current = v || "";
    triggerText.textContent = labelFor(current);
    truncTip(triggerText, labelFor(current));
    trigger.classList.toggle("active", !!current);
  };
  return wrap;
}
