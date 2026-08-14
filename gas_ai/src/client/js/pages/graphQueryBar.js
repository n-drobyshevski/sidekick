// The query builder, as chrome.
//
//   FIND   [AI Agent]                                    41 results
//     THAT [runs as] [Service Account]  [+] [eye] [x]
//
// Structure and state come from graphQuery.js (pure, tested); this file turns them into
// buttons. The pickers are the app's existing portaled `filterCombobox`, and every option they
// offer comes from the tenant's own vocabulary — a builder that lets you construct a query
// guaranteed to match nothing is a builder that wastes an afternoon, which is why Wiz's own
// only offers "the filters and connections that are valid for the selected node type".
//
// ACCESSIBILITY. The rows are a real `tree`: the nesting is meaning, not indentation, and a
// screen-reader user gets `aria-level` rather than a guess from the left margin. One tab stop
// for the whole tree with a roving tabindex, arrows to move between rows, Enter to open the
// focused row's entity picker, Delete to remove a row.

import { el, filterCombobox, uiIcon } from "../ui.js";
import { categoryOf, edgeLabel, kindIconSvg, kindLabel } from "../icons.js";
import {
  addStep,
  nodeAt,
  queryRows,
  removeStep,
  setEdge,
  setHidden,
  setKind,
} from "./graphQuery.js";

/** Relationships offered when the tenant's graph has nothing to say about a kind. */
const ANY_STEP = { edge: "ANY", reverse: false, hops: 1 };

/**
 * @param {object} opts {getQuery, getVocab, onChange(nextQuery), countNode}
 * @returns {{node: HTMLElement, sync: function}}
 */
export function queryBar(opts) {
  const list = el("div", {
    class: "gq-rows",
    role: "tree",
    "aria-label": "Security graph query",
  });
  const root = el("div", { class: "gq" }, list, opts.countNode || null);
  let focusPath = "";

  function commit(next) {
    opts.onChange(next);
  }

  /** Every relationship the tenant's graph actually offers from this kind. */
  function stepsFrom(kind) {
    const vocab = opts.getVocab() || { stepsFrom: {} };
    return (vocab.stepsFrom || {})[kind] || [];
  }

  /** Distinct edge+direction options from a kind, each remembering where it can land. */
  function edgeOptions(kind) {
    const seen = new Map();
    for (const entry of stepsFrom(kind)) {
      const value = (entry.reverse ? "~" : "") + entry.edge;
      if (!seen.has(value)) {
        seen.set(value, {
          value,
          // EDGE_LABELS are active-voice glosses written for the subject end ("runs as",
          // "allows access to"). Read backwards they need a passive that English does not
          // reliably supply — "is allows access to by" is what a naive template produces — so
          // the direction is stated instead of conjugated. Precise beats fluent here.
          label: entry.reverse ? edgeLabel(entry.edge) + " (incoming)" : edgeLabel(entry.edge),
          hint: "",
          kinds: [],
        });
      }
      seen.get(value).kinds.push(entry.kind);
    }
    const out = [...seen.values()];
    for (const o of out) {
      o.hint = o.kinds.length === 1 ? kindLabel(o.kinds[0]) : o.kinds.length + " kinds";
    }
    // "related to, within N hops" is always available: it is the neighbourhood question, and
    // the graph can always answer it even where no single named edge fits.
    out.push({ value: "ANY", label: "is related to", hint: "any relationship", kinds: [] });
    out.push({ value: "ANY2", label: "is related to (2 hops)", hint: "any relationship", kinds: [] });
    out.push({ value: "ANY3", label: "is related to (3 hops)", hint: "any relationship", kinds: [] });
    return out;
  }

  /** Kinds reachable from `kind` along `edgeValue`; every kind in the graph for ANY. */
  function targetKinds(kind, edgeValue) {
    const vocab = opts.getVocab() || { kinds: [] };
    if (edgeValue.indexOf("ANY") === 0) {
      return (vocab.kinds || []).map((k) => k.kind).concat(["ANY"]);
    }
    const reverse = edgeValue[0] === "~";
    const edge = reverse ? edgeValue.slice(1) : edgeValue;
    const kinds = stepsFrom(kind)
      .filter((e) => e.edge === edge && e.reverse === reverse)
      .map((e) => e.kind);
    return kinds.length ? kinds : ["ANY"];
  }

  function kindOption(kind) {
    return { value: kind, label: kind === "ANY" ? "Any node" : kindLabel(kind) };
  }

  /**
   * A chip that IS the shared searchable listbox's own trigger, restyled.
   *
   * The first cut mounted a decorative chip beside a hidden combobox and clicked through to
   * it. That worked with a mouse and lied to everyone else: `aria-expanded` lived on the
   * button nobody could reach, and the page carried two buttons for one control. Restyling
   * the real trigger keeps ONE listbox implementation — the portaled one that already handles
   * search, grouping, keyboard and the popover-above-sheet z-order — and its ARIA with it.
   */
  function chipPicker(value, options, onPick, label, kind) {
    const box = filterCombobox({
      value,
      options,
      ariaLabel: label,
      searchThreshold: 8,
      onChange: (v) => onPick(v),
    });
    box.classList.add("gq-chip-wrap");
    const trigger = box.querySelector(".combobox-trigger");
    if (trigger) {
      trigger.classList.add("gq-chip");
      if (kind) {
        trigger.setAttribute("data-category", categoryOf(kind));
        const icon = kindIconSvg(kind, 14);
        icon.setAttribute("class", "gq-chip-icon");
        trigger.prepend(icon);
      } else {
        // A relationship is a verb, not an entity: no icon, no tint, lighter weight.
        trigger.classList.add("gq-chip--edge");
      }
    }
    return box;
  }

  function iconButton(name, label, onClick, pressed) {
    const attrs = {
      class: "gq-iconbtn",
      "aria-label": label,
      title: label,
      onclick: onClick,
    };
    if (pressed !== undefined) attrs["aria-pressed"] = pressed ? "true" : "false";
    return el("button", attrs, uiIcon(name, 14));
  }

  function render() {
    const query = opts.getQuery();
    const rows = queryRows(query);
    list.textContent = "";

    rows.forEach((row, i) => {
      const parentKind = row.path.length ? nodeAt(query, row.path.slice(0, -1)).kind : null;
      const line = el("div", {
        class: "gq-row" + (row.hidden ? " is-hidden" : "") + (row.negate ? " is-negated" : ""),
        role: "treeitem",
        "aria-level": String(row.level + 1),
        "aria-label": rowLabel(row),
        tabindex: rowKey(row) === focusPath || (!focusPath && i === 0) ? "0" : "-1",
        style: row.level ? "padding-inline-start:" + (row.level * 20) + "px" : null,
        onkeydown: (e) => onRowKey(e, rows, i, row, query),
        onfocus: () => { focusPath = rowKey(row); },
      });

      line.append(el("span", { class: "gq-kw" }, row.keyword));

      if (row.path.length) {
        const options = edgeOptions(parentKind);
        const current = (row.reverse ? "~" : "")
          + (row.edge === "ANY" ? "ANY" + (row.hops > 1 ? String(row.hops) : "") : row.edge);
        if (row.negate) line.append(el("span", { class: "gq-not" }, "NOT"));
        line.append(chipPicker(current, options, (v) => {
          const isAny = v.indexOf("ANY") === 0;
          const patch = {
            edge: isAny ? "ANY" : (v[0] === "~" ? v.slice(1) : v),
            reverse: !isAny && v[0] === "~",
            hops: isAny ? (Number(v.slice(3)) || 1) : undefined,
          };
          // The kind below was chosen against the old relationship; if it is no longer
          // reachable the query would silently match nothing, so it moves to one that is.
          const allowed = targetKinds(parentKind, v);
          let next = setEdge(query, row.path, patch);
          if (allowed.indexOf(row.kind) === -1) next = setKind(next, row.path, allowed[0]);
          commit(next);
        }, "Relationship: " + describeEdge(row), null));
      }

      const kindOpts = (row.path.length ? targetKinds(parentKind, row.edge === "ANY" ? "ANY" : (row.reverse ? "~" : "") + row.edge)
        : ((opts.getVocab() || { kinds: [] }).kinds || []).map((k) => k.kind).concat(["ANY"]))
        .map(kindOption);
      line.append(chipPicker(row.kind, kindOpts, (v) => commit(setKind(query, row.path, v)),
        (row.path.length ? "Related entity: " : "Find entity: ") + kindLabel(row.kind), row.kind));

      const actions = el("span", { class: "gq-row-actions" });
      actions.append(iconButton("plus", "Add a relationship from " + kindLabel(row.kind), () => {
        // The commonest OUTBOUND relationship, falling back to the commonest of any direction.
        // An outbound step reads the way the sentence does — "an agent runs as an identity" —
        // so it is the better first guess even when an inbound one is marginally more common.
        const from = stepsFrom(row.kind);
        const first = from.find((e) => !e.reverse) || from[0];
        const step = first
          ? { edge: first.edge, reverse: first.reverse, node: { kind: first.kind } }
          : { ...ANY_STEP, node: { kind: "ANY" } };
        commit(addStep(query, row.path, step));
      }));
      if (row.canHide) {
        actions.append(iconButton(row.hidden ? "eye-off" : "eye",
          (row.hidden ? "Show " : "Hide ") + kindLabel(row.kind) + " columns",
          () => commit(setHidden(query, row.path, !row.hidden)), !row.hidden));
      }
      if (row.canRemove) {
        actions.append(iconButton("close", "Remove this relationship",
          () => commit(removeStep(query, row.path))));
      }
      line.append(actions);
      list.append(line);
    });
  }

  function rowKey(row) {
    return row.path.join("-") || "root";
  }

  function rowLabel(row) {
    if (!row.path.length) return "Find " + kindLabel(row.kind);
    return "That " + describeEdge(row) + " " + kindLabel(row.kind)
      + (row.hidden ? ", columns hidden" : "");
  }

  function describeEdge(row) {
    if (row.edge === "ANY") return "is related to within " + (row.hops || 1) + " hops";
    const base = edgeLabel(row.edge);
    return (row.negate ? "does not " : "") + base + (row.reverse ? ", incoming" : "");
  }

  /** Arrow keys walk the rows; Enter opens the entity picker; Delete removes the row. */
  function onRowKey(e, rows, i, row, query) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = rows[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      focusPath = rowKey(next);
      const el2 = list.children[i + (e.key === "ArrowDown" ? 1 : -1)];
      if (el2) {
        for (const child of list.children) child.setAttribute("tabindex", "-1");
        el2.setAttribute("tabindex", "0");
        el2.focus();
      }
      return;
    }
    if (e.key === "Enter") {
      const chip = e.currentTarget.querySelector(".gq-chip:not(.gq-chip--edge)");
      if (chip) {
        e.preventDefault();
        chip.click();
      }
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && row.canRemove) {
      e.preventDefault();
      // Focus lands on the parent row, which is where the removed step hung from — the one
      // place the reader can be sure still exists.
      focusPath = row.path.slice(0, -1).join("-") || "root";
      commit(removeStep(query, row.path));
    }
  }

  render();
  return { node: root, sync: render };
}
