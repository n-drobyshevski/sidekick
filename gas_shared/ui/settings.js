// The settings form vocabulary: a panel, a labelled row, a switch, a tab strip and one save
// bar for a whole page.
//
// Ported from the OS-vulnerabilities tool (gas/src/client/js/ui.js), where these grew to
// replace a settings page that carried a Save button per card. The problem they solve is the
// one this app's own settings.js wrote down and then worked around: "a second Save button on
// one page reads as ambiguous scope, and a control in this card driven by a button in that
// one is worse." One dirty state for the page answers it; tabs are what make a page long
// enough to need the answer.
//
// Two things changed on the way across, and both are this app's rules rather than taste:
// el() throws on a `title` attribute (ui/tip.js is the only hover explanation here), and the
// save bar's z-index is --z-canvas-panel rather than --z-popover, which in this tree is
// reserved for surfaces opening from INSIDE a sheet and would float the bar over a record
// sheet's scrim.

import { clear, el } from "./dom.js";
import { uiIcon } from "./uiIcons.js";

/**
 * A settings card: a header (title + optional description), a body of controls, and an
 * optional hairline-topped footer for the action(s). `body` and `footer` each accept a single
 * node or an array (nullish entries are skipped, like el()). The title is an <h2> so the page
 * heading order stays h1 -> h2 across panels. Callers keep ownership of their controls and
 * their event wiring — this only assembles the frame.
 */
export function settingsPanel({ title, description, body, footer } = {}) {
  const head = el("div", { class: "settings-panel__head" },
    el("h2", { class: "settings-panel__title" }, title),
    description ? el("p", { class: "settings-panel__desc muted small" }, description) : null);
  const bodyNode = el("div", { class: "settings-panel__body" }, ...[].concat(body || []));
  const panel = el("section", { class: "settings-panel" }, head, bodyNode);
  if (footer !== null && footer !== undefined) {
    panel.append(el("div", { class: "settings-panel__foot" }, ...[].concat(footer)));
  }
  return panel;
}

/**
 * A label+control settings row: a left column (bold label over a muted description) and a
 * right-aligned control (a switch, a number input...). The canonical toggle-row layout. The
 * `control` is whatever node the caller built and wired; `htmlFor` optionally associates the
 * label text with a control id for a bigger click target.
 */
export function settingRow({ label, description, control, htmlFor } = {}) {
  const labelEl = htmlFor
    ? el("label", { class: "setting-row__title", for: htmlFor }, label)
    : el("span", { class: "setting-row__title" }, label);
  return el("div", { class: "setting-row" },
    el("div", { class: "setting-row__label" },
      labelEl,
      description ? el("span", { class: "setting-row__desc muted small" }, description) : null),
    el("div", { class: "setting-row__control" }, control));
}

/**
 * An accessible on/off switch. The real checkbox stays in the DOM (visually hidden but
 * focusable and labelable); the track + thumb are the painted control. Returns { node, input }
 * so callers read `input.checked` and keep their own `disabled` wiring.
 *
 * WHY A SWITCH AND NOT segmented(). Every other segmented() in this app is a genuine
 * multi-choice view switch — lattice modes, the graph's view toggle, framework pickers. The
 * only two On/Off pairs in the tree were both on the settings page, which is a different kind
 * of control wearing the same clothes. A boolean setting is a switch; a choice among views is
 * segmented. Adding this one lets each mean one thing.
 *
 * The focus ring lands on the track (.switch__input:focus-visible + .switch__track in
 * settings.css) and the thumb slide is zeroed under prefers-reduced-motion.
 *
 * CALLERS WRITING `input.checked` PROGRAMMATICALLY MUST SET aria-checked THEMSELVES: assigning
 * the property does not fire "change", so the listener below never runs. See setSwitch() in
 * pages/settings.js.
 */
export function switchToggle({ checked = false, id, ariaLabel, disabled = false, onChange } = {}) {
  const input = el("input", {
    type: "checkbox", class: "switch__input", id: id || null,
    checked: checked ? true : null, disabled: disabled ? true : null,
    "aria-label": ariaLabel || null, role: "switch",
  });
  if (onChange) input.addEventListener("change", () => onChange(input.checked));
  const syncAria = () => input.setAttribute("aria-checked", input.checked ? "true" : "false");
  syncAria();
  input.addEventListener("change", syncAria);
  const node = el("label", { class: "switch" },
    input,
    el("span", { class: "switch__track", "aria-hidden": "true" },
      el("span", { class: "switch__thumb" })));
  return { node, input };
}

/**
 * A horizontal tablist over in-page panels. One tab stop for the whole strip (roving
 * tabindex), arrows move and activate, Home/End jump to the ends — the keyboard model the
 * Record Sheet's section rail already uses, drawn horizontally.
 *
 * The selected tab takes a 2px accent underline PLUS weight, never a tint alone, which is
 * this app's navigation rule (.nav-link.active is the same recipe rotated).
 *
 * `setDirty` marks a tab whose panel holds unsaved edits: a painted dot AND the words
 * "unsaved changes" appended to the tab's accessible name, because a tabbed page can hide a
 * dirty control and a dot alone would say so only to people who can see it. `setInvalid`
 * marks a tab holding a field that fails validation the same way — a red alert glyph, "has
 * errors" in the accessible name, and `aria-invalid="true"` on the tab button itself — and
 * the two are independent: a field can be invalid without being dirty (an in-progress
 * keystroke that never committed to the draft, so it never counts as a change) and dirty
 * without being invalid (the ordinary case). Both can be true on the same tab at once, and
 * the accessible name then carries both clauses so a screen-reader user loses neither.
 *
 * `tabs` is `[{ key, label, badge? }]`; `badge` is a node shown after the label.
 * `onSelect(key)` fires on activation, including the initial one, so the caller has a single
 * place to show the panel and record the tab in the hash.
 */
export function tabList({ tabs, active, onSelect, ariaLabel, idPrefix = "tab" }) {
  const strip = el("div", { class: "tabstrip", role: "tablist", "aria-label": ariaLabel });
  const byKey = {};
  let current = null;

  for (const t of tabs) {
    const dot = el("span", { class: "tabstrip__dot", "aria-hidden": "true", hidden: true });
    const invalidGlyph = el(
      "span", { class: "tabstrip__invalid", "aria-hidden": "true", hidden: true }, uiIcon("alert", 14),
    );
    const btn = el("button", {
      type: "button", class: "tabstrip__tab", role: "tab",
      id: idPrefix + "-" + t.key, "aria-controls": idPrefix + "-panel-" + t.key,
      "aria-selected": "false", tabindex: "-1", "aria-invalid": "false",
      onclick: () => select(t.key),
    }, el("span", { class: "tabstrip__label" }, t.label), t.badge || null, dot, invalidGlyph);
    byKey[t.key] = { btn, dot, invalidGlyph, label: t.label, dirty: false, invalid: false };
    strip.append(btn);
  }

  function syncName(key) {
    const e = byKey[key];
    const clauses = [];
    if (e.dirty) clauses.push("unsaved changes");
    if (e.invalid) clauses.push("has errors");
    e.btn.setAttribute("aria-label", clauses.length ? e.label + ", " + clauses.join(", ") : e.label);
  }

  function select(key, moveFocus) {
    if (!byKey[key]) return;
    current = key;
    for (const k of Object.keys(byKey)) {
      const on = k === key;
      byKey[k].btn.setAttribute("aria-selected", on ? "true" : "false");
      byKey[k].btn.tabIndex = on ? 0 : -1;
    }
    if (moveFocus) byKey[key].btn.focus();
    if (onSelect) onSelect(key);
  }

  strip.addEventListener("keydown", (e) => {
    const keys = tabs.map((t) => t.key);
    const i = keys.indexOf(current);
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = keys[(i + 1) % keys.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = keys[(i - 1 + keys.length) % keys.length];
    else if (e.key === "Home") next = keys[0];
    else if (e.key === "End") next = keys[keys.length - 1];
    if (!next) return;
    e.preventDefault();
    select(next, true);
  });

  for (const k of Object.keys(byKey)) syncName(k);
  select(active && byKey[active] ? active : tabs[0].key);

  return {
    node: strip,
    select: (k) => select(k, false),
    focusTab: (k) => select(k, true),
    active: () => current,
    setDirty(key, on) {
      const e = byKey[key];
      if (!e || e.dirty === !!on) return;
      e.dirty = !!on;
      e.dot.hidden = !on;
      syncName(key);
    },
    setInvalid(key, on) {
      const e = byKey[key];
      if (!e || e.invalid === !!on) return;
      e.invalid = !!on;
      e.invalidGlyph.hidden = !on;
      e.btn.setAttribute("aria-invalid", on ? "true" : "false");
      syncName(key);
    },
  };
}

/**
 * The page-level save bar: one dirty state for a whole form, shown only when there is
 * something to save. It replaces a row of per-panel Save buttons, and with it the "your other
 * edits will be discarded" problem a page full of competing saves has.
 *
 * `update(countText, summary)` takes settingsModel.changeSummary — each entry naming the tab
 * that owns it — and renders them as links, so a change hidden behind an inactive tab is both
 * announced and reachable in one click. `onJump(tab)` handles those clicks.
 */
export function saveBar({ onSave, onDiscard, onJump, saveLabel = "Save changes" }) {
  const what = el("span", { class: "savebar__what" });
  const saveBtn = el("button", { class: "primary", onclick: () => onSave && onSave() }, saveLabel);
  const discardBtn = el("button", { onclick: () => onDiscard && onDiscard() }, "Discard");
  const node = el("div", {
    class: "savebar", role: "region", "aria-label": "Unsaved changes",
    hidden: true,
  }, what, el("span", { class: "savebar__spacer" }), discardBtn, saveBtn);

  return {
    node,
    setBusy(busy) {
      saveBtn.disabled = !!busy;
      discardBtn.disabled = !!busy;
      saveBtn.textContent = busy ? "Saving…" : saveLabel;
    },
    /** `summary` is `[{ label, tab, tabLabel }]`; an empty list hides the bar. */
    update(countText, summary) {
      clear(what);
      if (!summary.length) {
        node.hidden = true;
        return;
      }
      node.hidden = false;
      what.append(el("strong", {}, countText), " — ");
      summary.forEach((c, i) => {
        if (i) what.append(", ");
        what.append(c.label + " ");
        what.append(el("button", {
          class: "link savebar__tab", type: "button",
          "aria-label": c.label + ", on the " + c.tabLabel + " tab — go there",
          onclick: () => onJump && onJump(c.tab),
        }, "(" + c.tabLabel + ")"));
      });
    },
  };
}

/**
 * A "Why this matters" disclosure. The one-line description stays visible; the paragraph
 * behind it moves in here, so a reader who already knows is not made to read it again. The
 * caret rotation is zeroed under prefers-reduced-motion in settings.css.
 */
export function disclosure(summaryText, ...children) {
  return el("details", { class: "why" },
    el("summary", {},
      el("span", { class: "why__caret", "aria-hidden": "true" }, "▸"), summaryText),
    el("div", { class: "why__body" }, ...children));
}
