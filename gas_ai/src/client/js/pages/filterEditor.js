// One property filter, as a control — the operator and the values together.
//
//   ┌────────────────────────────────┐
//   │ contains all                 ▾ │   the operator
//   ├────────────────────────────────┤
//   │ KEY   [env          ]        × │   the values, drawn for this field's type
//   │ VALUE [prod         ]          │
//   │ + Add tag                      │
//   └────────────────────────────────┘
//
// ONE CONTROL, TWO HOSTS. The palette's Properties tab draws this in-pane when a filter is being
// created; the WHERE chip on a builder row opens it in a popover when one is being changed. They
// were about to be two implementations of the same question — the mistake this bar has already
// made twice with the entity dropdowns and the OR blocks — so the control is here and the frame
// is the caller's.
//
// THE OPERATOR IS NOT AN ENUM. It is two booleans, `all` and `negate`, over the comparison `op`
// already carries. Four readings fall out for a field a node can hold several of, and two for one
// it cannot, without anyone writing down `notContainsAll` as a name that then has to be parsed,
// validated, serialised and matched. The list below is the only place those pairs are given
// words, so the chip and the editor cannot disagree about what a filter says.

import { el, filterCombobox, uiIcon } from "../ui.js";
import { facetGroup } from "../filters.js";

/**
 * The readings a field can be filtered under, in menu order.
 *
 * `multi` is declared by the domain (`FieldSpec.multi`) rather than guessed from whether a
 * rendered value happens to contain a comma — a filter's menu must not depend on which tenant
 * is loaded. Where a node holds one value, "all of these" would be asking for nothing, so it is
 * not offered rather than offered and useless.
 */
export function operatorsFor(field) {
  const type = (field && field.type) || "text";
  if (type === "text") {
    return [
      { value: "contains", label: "contains", op: "contains" },
      { value: "!contains", label: "does not contain", op: "contains", negate: true },
      { value: "eq", label: "is exactly", op: "eq" },
      { value: "!eq", label: "is not exactly", op: "eq", negate: true },
    ];
  }
  if (type === "pairs" || (field && field.multi)) {
    return [
      { value: "any", label: "contains any", op: "eq" },
      { value: "all", label: "contains all", op: "eq", all: true },
      { value: "!any", label: "contains none", op: "eq", negate: true },
      { value: "!all", label: "does not contain all", op: "eq", all: true, negate: true },
    ];
  }
  return [
    { value: "eq", label: "is", op: "eq" },
    { value: "!eq", label: "is not", op: "eq", negate: true },
  ];
}

/** Which of them a filter is currently under. Falls back to the first, which is the default. */
export function operatorOf(field, filter) {
  const list = operatorsFor(field);
  const f = filter || {};
  const want = (o) => (o.op || "eq") === (f.op || "eq")
    && !!o.all === !!f.all && !!o.negate === !!f.negate;
  return list.find(want) || list[0];
}

/**
 * How a filter reads in a sentence — "Cloud is GCP", "Tags contain all env: prod, team: ml".
 *
 * Used by the chip AND by the editor's own heading, so what the row says and what the popover
 * says are one string built once. The OR between values used to be left unwritten entirely,
 * which on a field whose values can hold commas was genuinely ambiguous.
 */
export function describeFilter(field, filter, label) {
  const name = label || (field && field.label) || (filter && filter.key) || "";
  const op = operatorOf(field, filter);
  return (name + " " + op.label + " " + valuesText(filter)).trim();
}

/**
 * The values, with the word BETWEEN them written down.
 *
 * A bare comma was genuinely ambiguous: "Projects A, B" could be either alternative or both, and
 * on a field whose own values may contain a comma it was not even reliably two values. The
 * conjunction is the filter's own quantifier, so it can only ever say the truth.
 */
export function valuesText(filter) {
  const values = (filter && filter.values) || [];
  if (values.length < 2) return values.join("");
  return values.join(filter && filter.all ? " and " : " or ");
}

/**
 * @param spec {field, filter, values, onChange}
 *   `field`   {key, label, type, multi} as the vocabulary describes it
 *   `filter`  {values, op, all, negate} — the current reading, or null for a fresh one
 *   `values`  [{value, count}] where the estate offers a list, else empty
 *   `onChange`(next) with the whole `{values, op, all, negate}`; an empty `values` means remove
 * @returns {{root: HTMLElement, focus: function}}
 */
export function filterEditor(spec) {
  const { field, values = [], onChange } = spec;
  const filter = spec.filter || { values: [] };
  let chosen = (filter.values || []).slice();
  let op = operatorOf(field, filter);

  const emit = () => onChange({
    values: chosen.slice(),
    op: op.op,
    ...(op.all ? { all: true } : {}),
    ...(op.negate ? { negate: true } : {}),
  });

  const opBox = filterCombobox({
    value: op.value,
    options: operatorsFor(field).map((o) => ({ value: o.value, label: o.label })),
    ariaLabel: (field.label || "Filter") + " operator",
    searchThreshold: 99, // four options at most; a search box over them is furniture
    onChange: (v) => {
      op = operatorsFor(field).find((o) => o.value === v) || op;
      // Only once values exist. Choosing "contains all" on an empty filter has nothing to apply
      // to, and committing it would write a filter nobody has finished describing.
      if (chosen.length) emit();
    },
  });
  opBox.classList.add("gq-fe-op");

  const body = el("div", { class: "gq-fe-body" });
  const root = el("div", { class: "gq-fe" }, opBox, body);
  let first = null;

  // ---------------------------------------------------------------- key / value pairs
  if (field.type === "pairs") {
    // A tag term is `key:value`, or a bare `key` meaning "at any value" — which is the question
    // a value list cannot pose and the reason this control exists rather than a picker.
    const rows = el("div", { class: "gq-fe-pairs" });
    const parse = (v) => {
      const at = String(v).indexOf(":");
      return at === -1 ? { k: String(v), v: "" } : { k: v.slice(0, at), v: v.slice(at + 1) };
    };
    const readBack = () => {
      chosen = [...rows.children]
        .map((r) => {
          const [k, v] = [...r.querySelectorAll("input")].map((i) => i.value.trim());
          return k ? (v ? k + ":" + v : k) : "";
        })
        .filter(Boolean);
      emit();
    };
    const addRow = (term) => {
      const { k, v } = term ? parse(term) : { k: "", v: "" };
      const keyIn = el("input", { type: "text", placeholder: "Key", value: k,
        "aria-label": "Tag key" });
      const valIn = el("input", { type: "text", placeholder: "Value (any)", value: v,
        "aria-label": "Tag value, blank for any" });
      // On `change`, not on every keystroke: each commit reruns the query, and a round trip per
      // character typed into a key would make the field unusable.
      for (const input of [keyIn, valIn]) {
        input.addEventListener("change", readBack);
        input.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          e.stopPropagation();
          readBack();
        });
      }
      const row = el("div", { class: "gq-fe-pair" },
        el("span", { class: "gq-fe-pair-label" }, "Key"), keyIn,
        el("span", { class: "gq-fe-pair-label" }, "Value"), valIn,
        el("button", {
          type: "button", class: "gq-fe-drop", "aria-label": "Remove this tag",
          onclick: () => { row.remove(); readBack(); },
        }, "×"),
      );
      rows.append(row);
      if (!first) first = keyIn;
      return keyIn;
    };
    (chosen.length ? chosen : [""]).forEach((t) => addRow(t));
    body.append(rows, el("button", {
      type: "button", class: "gq-fe-add",
      onclick: () => addRow("").focus(),
    }, uiIcon("plus", 12), el("span", {}, "Add tag")));
    return { root, focus: () => first && first.focus() };
  }

  // ---------------------------------------------------------------- a value list
  const options = (values || []).map((v) => ({
    value: v.value,
    label: v.value === "unknown" ? "Not reported" : v.value,
    count: v.count,
  }));
  const listable = (field.type === "choice" || field.type === "boolean") && options.length;
  if (listable) {
    const group = facetGroup({
      label: field.label,
      noun: "node",
      onToggle: (value) => {
        const at = chosen.indexOf(value);
        chosen = at === -1 ? chosen.concat([value]) : chosen.filter((v) => v !== value);
        group.update(options, chosen);
        emit();
      },
    });
    group.update(options, chosen);
    body.append(group.root);
    return { root, focus: () => group.root.querySelector("button")?.focus() };
  }

  // ---------------------------------------------------------------- free text
  // Also where a CHOICE field lands when the estate holds more distinct values than
  // `VALUE_CARDINALITY_MAX` — the domain has always said such a field "falls back to a contains
  // search", and until now it fell back to a dead end reading "No values to choose from".
  const overCap = field.type === "choice" || field.type === "boolean";
  const input = el("input", {
    type: "text", class: "gq-fe-text",
    "aria-label": field.label + " " + op.label,
    placeholder: op.op === "contains" ? "contains…" : "exactly…",
    value: chosen[0] || "",
  });
  const commitText = () => {
    const v = input.value.trim();
    chosen = v ? [v] : [];
    emit();
  };
  input.addEventListener("change", commitText);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    commitText();
  });
  body.append(input, el("p", { class: "gq-fe-hint small muted" },
    overCap
      ? "This estate holds too many distinct values to list. Type one to match."
      : (op.op === "contains"
        ? "Matched as a substring, case ignored."
        : "Matched exactly, case ignored.")));
  first = input;
  return { root, focus: () => input.focus() };
}
