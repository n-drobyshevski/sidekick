// The searchable combobox: a trigger button plus a listbox popover portaled to <body>.

import { clear, el } from "./dom.js";
import { portalClosed, portalOpened } from "./portals.js";


let _comboboxSeq = 0;

/** How many matches the list will render before it stops and says so. Rebuilding runs
 *  synchronously on every keystroke, and the asset picker's list is the whole estate. */
const COMBOBOX_MATCH_CAP = 100;
const COMBOBOX_DEBOUNCE_MS = 120;

function comboNormalize(list) {
  return (list || []).map((o) => (typeof o === "string"
    ? { value: o, label: o, hint: "", group: "" }
    : { value: o.value, label: o.label == null ? o.value : o.label, hint: o.hint || "", group: o.group || "" }));
}

/**
 * Searchable combobox: a trigger button plus a listbox popover, portaled to `<body>`.
 *
 * Forked from the OS-vulns tool's `filterCombobox` (gas/src/client/js/ui.js), which
 * fronts ~20 sidebar options where the value IS the label. This one fronts the whole
 * asset estate from inside a scrolling panel, so it differs in six ways:
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
 */
export function filterCombobox({
  value, options, pinnedRows, defaultLabel, ariaLabel, searchPlaceholder = "Search…",
  fallbackLabel = "", searchThreshold = 7, onChange, id,
}) {
  const seq = ++_comboboxSeq;
  const listboxId = `combobox-list-${seq}`;
  let current = value || "";
  let opts = comboNormalize(options);
  const pinned = comboNormalize(pinnedRows);

  function labelFor(v) {
    const hit = [...pinned, ...opts].find((o) => o.value === v);
    if (hit) return hit.label;
    // A value the list doesn't carry — e.g. a graph seeded from a derived risk node,
    // which the asset options endpoint never returns. Better a caller-supplied name than
    // silently reading as "nothing selected".
    return v ? (fallbackLabel || v) : defaultLabel;
  }

  const triggerText = el("span", { class: "combobox-trigger-text" });
  const trigger = el(
    "button",
    {
      type: "button", class: "combobox-trigger",
      "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": ariaLabel,
      onclick: (e) => { e.stopPropagation(); open ? close() : openPop(); },
    },
    triggerText,
    el("span", { class: "combobox-caret", "aria-hidden": "true" }, "▾"),
  );
  const wrap = el("div", { class: "combobox", id: id || null }, trigger);

  function paintTrigger() {
    const text = labelFor(current);
    triggerText.textContent = text;
    trigger.title = text;
  }
  paintTrigger();

  let open = false;
  let pop = null;
  let searchEl = null;
  let listEl = null;
  let query = "";
  let debounce = null;
  let rows = [];      // selectable rows only, in DOM order — the roving-index array
  let activeIndex = 0;

  function matching() {
    const q = query.trim().toLowerCase();
    if (!q) return opts;
    return opts.filter((o) => o.label.toLowerCase().includes(q)
      || (o.hint && o.hint.toLowerCase().includes(q)));
  }

  function optionRow(o, idx) {
    const optId = `${listboxId}-opt-${idx}`;
    const row = el(
      "li",
      { id: optId, role: "option", class: "combobox-option",
        "aria-selected": current === o.value ? "true" : "false" },
      o.label,
      o.hint ? el("span", { class: "combobox-option-hint" }, o.hint) : null,
    );
    row.addEventListener("click", () => select(o.value));
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
    // asset name puts a wrong row under the first ArrowDown.
    const q = query.trim().toLowerCase();
    const shownPinned = q ? pinned.filter((o) => o.label.toLowerCase().includes(q)) : pinned;
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
    if (!matches.length && !shownPinned.length) {
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
    if (searchEl) searchEl.setAttribute("aria-activedescendant", activeId);
    else if (listEl) listEl.setAttribute("aria-activedescendant", activeId);
  }

  function scrollActiveIntoView() {
    const row = rows[activeIndex];
    if (row) row.node.scrollIntoView({ block: "nearest" });
  }

  function select(v) {
    current = v;
    paintTrigger();
    close();
    trigger.focus();
    if (onChange) onChange(current);
  }

  // Positioned against the live trigger rect, opening downward (these triggers sit at the
  // top of a panel, not at the bottom of a rail), clamped to the viewport, with the list's
  // max-height capped to the room actually below so the LIST scrolls rather than the
  // popover running off screen.
  function position() {
    const rect = trigger.getBoundingClientRect();
    const popWidth = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 8));
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const flip = below < 200 && above > below;
    pop.style.width = `${popWidth}px`;
    pop.style.left = `${left}px`;
    if (flip) {
      pop.style.top = "";
      pop.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      listEl.style.maxHeight = `${Math.min(320, Math.max(120, above))}px`;
    } else {
      pop.style.bottom = "";
      pop.style.top = `${rect.bottom + 6}px`;
      listEl.style.maxHeight = `${Math.min(320, Math.max(120, below))}px`;
    }
  }

  function openPop() {
    open = true;
    query = "";
    const showSearch = opts.length > searchThreshold;
    listEl = el("ul", { role: "listbox", class: "combobox-list", id: listboxId, "aria-label": ariaLabel });
    if (showSearch) {
      searchEl = el("input", {
        type: "text", class: "combobox-search", placeholder: searchPlaceholder,
        role: "combobox", "aria-expanded": "true", "aria-controls": listboxId,
        "aria-autocomplete": "list", autocomplete: "off", spellcheck: "false",
        // Debounced: each rebuild is one <li> per match, synchronously, and this list can
        // be the whole estate.
        oninput: () => {
          clearTimeout(debounce);
          debounce = setTimeout(() => {
            query = searchEl.value;
            buildRows({ keepActive: null });
          }, COMBOBOX_DEBOUNCE_MS);
        },
        onkeydown: onListKey,
      });
      pop = el("div", { class: "combobox-pop" }, searchEl, listEl);
    } else {
      searchEl = null;
      listEl.setAttribute("tabindex", "-1");
      listEl.addEventListener("keydown", onListKey);
      pop = el("div", { class: "combobox-pop" }, listEl);
    }
    document.body.append(pop);
    portalOpened();
    buildRows();
    position();
    trigger.setAttribute("aria-expanded", "true");

    // pointerdown as well as click: the graph canvas takes a pointer capture to pan
    // (graphView.js), so a pan that ends outside the window never delivers the click that
    // would otherwise dismiss this.
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    wrap.addEventListener("focusout", onFocusOut);
    pop.addEventListener("focusout", onFocusOut);

    if (searchEl) searchEl.focus();
    else listEl.focus();
  }

  function close() {
    if (!open) return;
    open = false;
    clearTimeout(debounce);
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScrollOrResize, true);
    window.removeEventListener("resize", onScrollOrResize);
    wrap.removeEventListener("focusout", onFocusOut);
    if (pop) { pop.removeEventListener("focusout", onFocusOut); pop.remove(); }
    portalClosed();
    pop = null; searchEl = null; listEl = null; rows = [];
  }

  function isInside(node) { return node && (wrap.contains(node) || (pop && pop.contains(node))); }
  function onDocPointer(e) { if (!isInside(e.target)) close(); }
  function onDocClick(e) { if (!isInside(e.target)) close(); }
  function onFocusOut(e) { if (!isInside(e.relatedTarget)) close(); }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); trigger.focus(); } }

  // Reposition rather than close. The panel this lives in scrolls, so closing on scroll
  // would dismiss the popover the moment someone scrolled down to reach its list. Only a
  // trigger that has left the viewport entirely closes.
  function onScrollOrResize(e) {
    if (e && e.target && pop && pop.contains(e.target)) return; // the list's own scrolling
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) close();
    else position();
  }

  function onListKey(e) {
    if (!rows.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, rows.length - 1); highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "Home") { e.preventDefault(); activeIndex = 0; highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "End") { e.preventDefault(); activeIndex = rows.length - 1; highlightActive(); scrollActiveIntoView(); }
    else if (e.key === "Enter") { e.preventDefault(); const row = rows[activeIndex]; if (row) select(row.value); }
  }

  /** Reflect an external state change onto the control — no onChange, no focus move. */
  wrap.setValue = (v) => {
    current = v || "";
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
  return wrap;
}
