// Interactive and labelled chrome: status pills, KPI tiles, stat rows, toggle groups,
// labelled fields, and the applied-filter chip row.

import { clear, el } from "./dom.js";
import { meter } from "./data.js";
import { tip, tipAnchor, tipLabel } from "./tip.js";

/**
 * OK / warn / bad / neutral, with a dot the colour never carries alone.
 *
 * `help` is optional and takes any of tipLabel's three shapes. A pill says a state in one or
 * two words ("Failing", "Auto-remediable", "IaC × 3") and those words are rarely the whole
 * story, so this is where a reader finds out what the state actually means.
 */
export function statusPill(kind, text, help) {
  const pill = el("span", { class: `pill ${kind}` }, text);
  return help ? tipLabel(pill, help) : pill;
}

/**
 * One cell of a `.stat-list` strip: an uppercase name, the figure (optionally with a meter
 * beside it), and a muted sub-line saying what the figure counts.
 *
 * Borderless by design — a stat strip is the third level of a posture header, not a row of
 * cards, so it takes its emphasis from position and hairlines rather than from surfaces.
 * `meterPct` is a 0-100 number or null/undefined for no meter.
 */
export function statRow(name, value, sub, meterPct, help) {
  const hasMeter = meterPct !== null && meterPct !== undefined;
  return el("div", { class: "stat-row" },
    el("div", { class: "stat-name" }, tipLabel(name, help)),
    el("div", { class: "stat-figure" },
      el("div", { class: "mini-value num" }, value),
      hasMeter ? meter(meterPct, {
        className: "meter--stat",
        label: `${name}, ${meterPct} percent`,
      }) : null),
    el("div", { class: "stat-sub" }, sub),
  );
}

/**
 * One joined group of aria-pressed buttons — the exclusive-choice recipe, shared by the
 * Graph|Table view toggle, the Depth stops and the zoom capsule.
 *
 * aria-pressed rather than role=radiogroup on purpose: a conformant radiogroup needs a
 * roving tabindex plus arrow cycling, and running two keyboard patterns for one visual
 * recipe on one page is exactly the invented-control problem.
 *
 * The returned node carries `.set(value)`, so a caller reflecting external state does not
 * rebuild the group and knock focus off the button that was just pressed.
 */
export function segmented({ options, value, onChange, ariaLabel = "", className = "" }) {
  const btns = new Map();
  const group = el("div", {
    class: `segmented${className ? " " + className : ""}`,
    role: "group",
    "aria-label": ariaLabel || null,
  });
  for (const opt of options) {
    const btn = el("button", {
      type: "button",
      "aria-pressed": opt.value === value ? "true" : "false",
      "aria-label": opt.ariaLabel || null,
      onclick: () => onChange(opt.value),
    }, opt.label);
    btns.set(opt.value, btn);
    group.append(btn);
    // `describeIn` is the group, not the button: a description parked inside the button would
    // be swept into its own accessible name, so "Matrix" would announce as "Matrix, every
    // rule on one grid" and then say it again as the description.
    if (opt.title) tip(btn, opt.title, { describeIn: group });
  }
  group.set = (v) => {
    for (const [key, btn] of btns) btn.setAttribute("aria-pressed", key === v ? "true" : "false");
  };
  return group;
}

/**
 * A row of aria-pressed toggle pills over a set of values — the graph's severity and
 * node-type filters and the combos page's severity filter were three copies of this.
 *
 * `mode: "multi"` toggles membership in a set; `"single"` selects one value and pressing
 * the selected one clears it. `pillClass` keeps each row's own vocabulary: severity pills
 * take the level's tint, node-type pills stay neutral and go crimson when selected, so a
 * chosen "AI Agent" and a chosen "LOW" never look like the same thing.
 *
 * Carries `.set(selected)` for reflecting state without a rebuild, for the same
 * focus-preserving reason as segmented() above.
 */
export function togglePills({
  options, selected, onToggle, ariaLabel = "", pillClass = "sev-pill", sevClass = true,
}) {
  const chosen = new Set(Array.isArray(selected) ? selected : [selected].filter(Boolean));
  const btns = new Map();
  const row = el("div", { class: "pill-row", role: "group", "aria-label": ariaLabel || null });
  for (const opt of options) {
    const value = typeof opt === "string" ? opt : opt.value;
    const label = typeof opt === "string" ? opt : opt.label;
    const btn = el("button", {
      type: "button",
      class: pillClass + (sevClass ? ` sev-${value}` : ""),
      "aria-pressed": chosen.has(value) ? "true" : "false",
      onclick: () => onToggle(value),
    }, label);
    btns.set(value, btn);
    row.append(btn);
  }
  row.set = (next) => {
    const set = new Set(Array.isArray(next) ? next : [next].filter(Boolean));
    for (const [value, btn] of btns) {
      btn.setAttribute("aria-pressed", set.has(value) ? "true" : "false");
    }
  };
  row.buttons = btns;
  return row;
}

/**
 * A native select with its dimension named beside it. Arrange and Order were the only
 * OS-chromed controls on a hand-styled page and their only name was an aria-label, so a
 * sighted user saw "Rows" and "Smart order" floating with nothing attached.
 */
export function selectField(labelText, control) {
  return el("div", { class: "select-field" },
    el("span", { class: "select-field-label", "aria-hidden": "true" }, labelText),
    control,
  );
}

/** The `<select>` itself: options as strings or {value,label}, with `value` preselected. */
export function select({ options, value, onChange, ariaLabel, placeholder }) {
  const sel = el("select", {
    "aria-label": ariaLabel || null,
    onchange: () => onChange(sel.value),
  });
  if (placeholder !== undefined) sel.append(el("option", { value: "" }, placeholder));
  for (const opt of options) {
    const v = typeof opt === "string" ? opt : opt.value;
    const label = typeof opt === "string" ? opt : opt.label;
    sel.append(el("option", { value: v }, label));
  }
  sel.value = value || "";
  return sel;
}

/**
 * A labelled field. The visible label IS the accessible name (a real `<label for>`), and
 * the explanation rides along as aria-describedby — so voice control can address the field
 * by the words next to it, which an aria-label override would break.
 *
 * Returns { node, label, err, setError(msg), setChanged(changed, savedValue) }.
 */
export function field(id, labelText, control, hintText) {
  const hintId = hintText ? `${id}-hint` : null;
  if (hintId) control.setAttribute("aria-describedby", hintId);
  const label = el("label", { class: "field-label", for: id }, labelText);
  // Set by setChanged() below, read at reveal time. The label wraps the control, so focus
  // bubbling out of the input opens the card too — a keyboard user gets the saved value the
  // native title never gave them.
  let changedNote = null;
  tipAnchor(label, () => (changedNote ? [changedNote] : null));
  const errId = `${id}-err`;
  const err = el("span", { class: "field-error", id: errId, hidden: true });
  return {
    node: el(
      "div",
      { class: "field" },
      label,
      control,
      hintText ? el("span", { class: "field-hint small muted", id: hintId }, hintText) : null,
      err,
    ),
    label,
    err,
    /** Show or clear an inline error, wiring aria-invalid and describedby together. */
    setError(msg) {
      if (msg) {
        err.textContent = msg;
        err.hidden = false;
        control.setAttribute("aria-invalid", "true");
        control.setAttribute("aria-describedby", [hintId, errId].filter(Boolean).join(" "));
      } else {
        err.hidden = true;
        control.removeAttribute("aria-invalid");
        if (hintId) control.setAttribute("aria-describedby", hintId);
        else control.removeAttribute("aria-describedby");
      }
    },
    /** Mark the field as differing from what is saved, and say so in words. */
    setChanged(changed, savedValue) {
      label.classList.toggle("field--changed", !!changed);
      // The saved value is the reason the field is marked, so it belongs on hover AND on focus
      // — a native title gave a keyboard user the mark with no way to read the reason.
      changedNote = changed ? "Saved value: " + savedValue : null;
    },
  };
}

/**
 * The applied-filter chips: what is narrowing the view right now, each dismissible.
 *
 * Two of these existed. The inventory's made the WHOLE chip one destructive button, so the
 * natural move — click the thing you want to change — deleted it; the graph's split the
 * chip into a label that opens the panel at that filter and a ✕ that clears it. This is
 * the graph's, and the inventory gets it too.
 *
 * `entries` are `{key, label, value, sev?, isDefault?, patch}`. `isDefault` marks a filter
 * the page seeded itself rather than one anybody chose: still a chip, still clearable, but
 * prefixed "Default ·" so the row does not claim the reader applied it.
 *
 * The returned node carries `.sync(entries)`. Removal hands focus to the neighbouring ✕
 * by position — the row is rebuilt, so a captured node would be detached.
 */
export function filterChipRow({
  onPatch, onEdit = null, onClearAll = null, emptyText = "", className = "",
  ariaLabel = "Applied filters", fallbackFocus = null,
}) {
  const row = el("div", {
    class: `filter-chips${className ? " " + className : ""}`,
    role: "group",
    "aria-label": ariaLabel,
  });
  // Read at click time, not captured: the trigger button a caller wants focus to fall back
  // to is often built after the row it belongs to.
  row.fallbackFocus = fallbackFocus;

  row.sync = (entries) => {
    const list = entries || [];
    clear(row);
    // The band keeps its height either way where an emptyText is given: on the graph it
    // sits between the bar and the canvas, and showing/hiding it moved the whole picture
    // the first time a filter was applied.
    if (!list.length) {
      if (emptyText) row.append(el("span", { class: "filter-chips-empty" }, emptyText));
      else row.hidden = true;
      return;
    }
    row.hidden = false;

    for (const e of list) {
      const text = `${e.label} · ${e.value}`;
      const close = el("button", {
        class: "filter-chip-x",
        "aria-label": "Clear filter: " + text,
        onclick: () => {
          const others = [...row.querySelectorAll(".filter-chip-x")];
          const at = others.indexOf(close);
          const next = others[at + 1] || others[at - 1];
          onPatch(e.patch);
          // onPatch rebuilt the row, so the captured node is detached; re-find by
          // position rather than holding a reference across the rebuild.
          const fresh = [...row.querySelectorAll(".filter-chip-x")];
          const idx = next ? Math.min(others.indexOf(next), fresh.length - 1) : -1;
          const target = fresh[idx] || row.fallbackFocus;
          if (target && target.focus) target.focus();
        },
      }, "✕");

      const body = [
        e.sev ? el("span", { class: "sev-dot", "aria-hidden": "true" }) : null,
        el("span", { class: "filter-chip-key" }, e.isDefault ? `Default · ${e.label}` : e.label),
        el("span", { class: "filter-chip-value" }, e.value),
      ];
      // Two hit targets only where the label leads somewhere; otherwise the label is
      // static text and the ✕ is the only control, which is still two things, not one
      // ambiguous one.
      const labelPart = onEdit
        ? el("button", {
            class: "filter-chip-body",
            "aria-label": `Edit filter: ${text}`,
            onclick: () => onEdit(e),
          }, ...body)
        : el("span", { class: "filter-chip-body" }, ...body);

      row.append(el("span", {
        class: "filter-chip" + (e.sev ? " sev-" + e.sev : "") + (e.isDefault ? " is-default" : ""),
      }, labelPart, close));
    }

    if (onClearAll) {
      row.append(el("button", {
        class: "link filter-clear-all",
        onclick: () => {
          onClearAll();
          if (row.fallbackFocus && row.fallbackFocus.focus) row.fallbackFocus.focus();
        },
      }, "Clear all"));
    }
  };

  return row;
}

export function kpiCard(label, value, sub, chip, help) {
  return el(
    "div",
    { class: "kpi-card" },
    el("div", { class: "kpi-label" }, tipLabel(label, help)),
    el("div", { class: "kpi-value num" }, value, chip || null),
    sub ? el("div", { class: "kpi-sub" }, sub) : null,
  );
}
