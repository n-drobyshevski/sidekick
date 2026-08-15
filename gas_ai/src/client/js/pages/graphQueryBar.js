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
  isGroup,
  nodeAt,
  pathAfterRemoval,
  queryRows,
  remapWhere,
  removeStep,
  setEdge,
  setHidden,
  setKind,
  stepAt,
} from "./graphQuery.js";
import { openQueryPalette, stepForPick } from "./queryPalette.js";

/**
 * @param {object} opts
 *   {getQuery, getVocab, getWhere, onChange(nextQuery, nextWhere), countNode}
 *   `getWhere` returns the parsed `where` map (slot index -> key -> values); `onChange`'s
 *   second argument is the map after the edit, which the page serializes back into the URL.
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
  /** Set by an edit that knows where focus should land; consumed by the next render. */
  let takeFocus = false;

  /**
   * Apply an edit. `focusKey` is the row that should hold focus once the bar has rebuilt.
   *
   * Every edit rebuilds every row, so the button that was clicked is detached by the time the
   * edit lands and DOM focus falls to `<body>`. Harmless with a mouse; with a keyboard it is
   * the end of the interaction — nothing to Tab from, nothing to arrow through. Naming the row
   * here and focusing it in `render` is what keeps a keyboard-driven edit continuable.
   */
  function commit(next, focusKey, opts2) {
    if (focusKey !== undefined) {
      focusPath = focusKey;
      takeFocus = true;
    }
    // Filters are addressed by slot number, and almost every structural edit renumbers slots.
    // Remapping here rather than at each call site means no edit can forget to.
    const extra = opts2 || {};
    const where = remapWhere(opts.getQuery(), next, currentWhere(), extra.movePath);
    // A node whose KIND changed keeps its path and therefore its slot, so the remap happily
    // carries its filters onto the new kind — where they name fields it does not have. The
    // query then answers zero and the chip degrades to a raw key, with nothing saying why.
    // `setKind` already drops the steps below for the same reason; this is the other half.
    if (extra.dropAt) {
      const gone = slotOfPath(next, extra.dropAt);
      if (gone !== null) where.delete(gone);
    }
    // Added filters arrive as PATHS, because the caller knows where in the tree it just put a
    // node but not what slot number that node ended up with — which is the whole reason
    // remapWhere exists. Resolved here, against the tree the edit produced.
    for (const add of (extra.addFilters || [])) {
      const index = slotOfPath(next, add.path);
      if (index === null) continue;
      if (!where.has(index)) where.set(index, new Map());
      where.get(index).set(add.key, { values: add.values, op: add.op || "eq" });
    }
    opts.onChange(next, where);
  }

  function currentWhere() {
    return (opts.getWhere && opts.getWhere()) || new Map();
  }

  /** The pre-order slot a path holds in `query`, or null where it binds nothing. */
  function slotOfPath(query, path) {
    const want = path.join(".");
    const hit = queryRows(query).find((r) => r.path.join(".") === want);
    return hit && hit.index !== null && hit.index !== undefined ? hit.index : null;
  }

  /** How many steps hang off the container at `path` — where an appended step will land. */
  function childCount(query, path) {
    if (!path.length) return (query.steps || []).length;
    const step = stepAt(query, path);
    if (!step) return 0;
    const container = isGroup(step) ? step : step.node;
    return ((container && container.steps) || []).length;
  }

  function pathKey(path) {
    return path.join("-") || "root";
  }

  /**
   * The `+`: everything this node can be asked next, in one searchable place.
   *
   * It used to guess — first outbound relationship in the vocabulary, appended, no questions —
   * which meant the builder offered exactly one next step and never said what the others were.
   * A pick comes back as one of three payloads; where each one goes is the whole of this
   * function, and the palette knows nothing about the tree.
   */
  function openPalette(anchor, query, row, fromKind) {
    openQueryPalette({
      anchor,
      kind: fromKind || "ANY",
      vocab: opts.getVocab() || { kinds: [], stepsFrom: {} },
      row,
      loadFields: opts.loadFields,
      // What this node is already filtered on, so reopening a field shows its values pressed
      // rather than presenting an empty picker over a filter that is plainly on the row.
      currentValues: (key) => {
        const forNode = currentWhere().get(row.index);
        const filter = forNode && forNode.get(key);
        return (filter && filter.values) || [];
      },
      onPick: (pick) => {
        if (pick.type === "property") {
          // A node that binds nothing has no slot to hang a filter on — a negated step is the
          // case, and the palette does not offer properties there, but a hand-edited link can.
          if (row.index === null || row.index === undefined) return;
          const where = currentWhere();
          const next = new Map(where);
          const forNode = new Map(next.get(row.index) || []);
          if (pick.values.length) forNode.set(pick.key, { values: pick.values, op: pick.op || "eq" });
          else forNode.delete(pick.key);
          if (forNode.size) next.set(row.index, forNode);
          else next.delete(row.index);
          focusPath = pathKey(row.path);
          takeFocus = true;
          opts.onChange(query, next);
          return;
        }
        if (pick.type === "flag") {
          commit(setEdge(query, row.path, { [pick.flag]: pick.value }), pathKey(row.path));
          return;
        }
        const base = childCount(query, row.path);
        if (pick.type === "shortcut") {
          // A named question, expanded. Its steps append under this row and its filters land on
          // nodes INSIDE them, addressed relative to the first appended step — so they arrive
          // in `where` as ordinary chips anyone can see and take off again.
          let next = query;
          for (const step of pick.steps) next = addStep(next, row.path, step);
          const absolute = (rel) => (rel.length
            ? row.path.concat(base + rel[0], ...rel.slice(1))
            : row.path);
          commit(next, pathKey(pick.steps.length ? absolute([0]) : row.path), {
            addFilters: (pick.filters || []).map((f) => ({
              path: absolute(f.path), key: f.key, values: f.values,
            })),
          });
          return;
        }
        const at = row.path.concat(base);
        commit(addStep(query, row.path, stepForPick(pick)), pathKey(at));
      },
    });
  }

  /**
   * Drop a row, taking its filters with it and shifting its later siblings' filters down.
   *
   * Focus lands on the parent row, which is where the removed step hung from — the one place
   * the reader can be sure still exists.
   */
  function removeRow(query, row) {
    commit(removeStep(query, row.path), pathKey(row.path.slice(0, -1)), {
      movePath: pathAfterRemoval(row.path),
    });
  }

  /** Drop one property filter from a node, leaving the rest of its filters alone. */
  function removeFilter(query, row, key) {
    const where = currentWhere();
    const forNode = where.get(row.index);
    if (!forNode) return;
    const next = new Map(where);
    const copy = new Map(forNode);
    copy.delete(key);
    if (copy.size) next.set(row.index, copy);
    else next.delete(row.index);
    focusPath = pathKey(row.path);
    takeFocus = true;
    opts.onChange(query, next);
  }

  /**
   * A node's property filters, as dismissible chips on its builder row.
   *
   *   FIND [AI Agent] [Guardrail: missing ×]
   *
   * They live in the `where` param rather than in the query tree, and this is what makes that
   * honest: a filter narrowing the result with nothing on screen admitting to it is the failure
   * mode `migrateLegacyParams` already carries a comment about. A shortcut that writes one
   * writes a chip.
   */
  function filterChips(query, row) {
    const forNode = currentWhere().get(row.index);
    if (!forNode || !forNode.size) return null;
    const wrap = el("span", { class: "gq-chips" });
    for (const key of [...forNode.keys()].sort()) {
      const filter = forNode.get(key) || { values: [] };
      const label = fieldLabel(row.kind, key);
      // "contains" is stated, not implied: the same chip text under two different readings
      // would be the query answering a question the row does not admit to asking.
      const text = (filter.op === "contains" ? "contains " : "") + filter.values.join(", ");
      wrap.append(el("span", { class: "filter-chip gq-filter-chip" },
        el("span", { class: "filter-chip-body" },
          el("span", { class: "gq-filter-key" }, label), " ", text),
        el("button", {
          class: "filter-chip-x",
          "aria-label": "Remove filter " + label + " " + text
            + " from " + kindLabel(row.kind),
          onclick: () => removeFilter(query, row, key),
        }, "×"),
      ));
    }
    return wrap;
  }

  /** A field's human label, from whatever the column chooser already offers for this kind. */
  function fieldLabel(kind, key) {
    for (const group of (opts.getGroups ? opts.getGroups() : [])) {
      if (group.kind !== kind) continue;
      const hit = (group.available || []).find((f) => f.key === key);
      if (hit) return hit.label;
    }
    return key;
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

    // An edit can delete the row that had focus — changing the FIND kind drops every step
    // below it. A `focusPath` pointing at a row that no longer exists would leave EVERY row
    // at tabindex="-1", taking the whole builder out of the tab order with no way back in
    // except a mouse. Fall back to the root, which always exists.
    if (focusPath && !rows.some((r) => rowKey(r) === focusPath)) focusPath = "";

    rows.forEach((row, i) => {
      // The nearest enclosing NODE, walking up past any boolean groups — a group has no kind,
      // and the relationships a step can offer come from the node the step hangs off, not from
      // the punctuation in between.
      const parentKind = enclosingKind(query, row.path);
      const line = el("div", {
        class: "gq-row" + (row.hidden ? " is-hidden" : "") + (row.negate ? " is-negated" : "")
          + (row.group ? " is-group" : ""),
        role: "treeitem",
        "aria-level": String(row.level + 1),
        "aria-label": rowLabel(row),
        tabindex: rowKey(row) === focusPath || (!focusPath && i === 0) ? "0" : "-1",
        style: row.level ? "padding-inline-start:" + (row.level * 20) + "px" : null,
        onkeydown: (e) => onRowKey(e, rows, i, row, query),
        onfocus: () => { focusPath = rowKey(row); },
      });

      line.append(el("span", { class: "gq-kw" }, row.keyword));

      // A boolean block: the keyword IS the control, plus the branch count and a remove. The
      // palette builds these (and offers to add branches); this renders whatever the query
      // holds, including one arriving from a hand-edited link.
      if (row.group) {
        line.append(el("span", { class: "gq-group-note muted small" },
          row.branches === 1
            ? "1 branch"
            : row.branches + (row.op === "or" ? " alternatives" : " conditions")));
        const groupActions = el("span", { class: "gq-row-actions" });
        groupActions.append(iconButton("plus", "Add a branch to this " + row.keyword + " block",
          (e) => openPalette(e.currentTarget, query, row, parentKind)));
        groupActions.append(iconButton("close", "Remove this " + row.keyword + " block",
          () => removeRow(query, row)));
        line.append(groupActions);
        list.append(line);
        return;
      }

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
      line.append(chipPicker(row.kind, kindOpts,
        (v) => commit(setKind(query, row.path, v), undefined, { dropAt: row.path }),
        (row.path.length ? "Related entity: " : "Find entity: ") + kindLabel(row.kind), row.kind));
      // `append(null)` writes the literal text "null" — the trap graph.js's savedViewsControl
      // already carries a comment about. `el()` skips nulls; `append` does not.
      const chips = filterChips(query, row);
      if (chips) line.append(chips);

      const actions = el("span", { class: "gq-row-actions" });
      actions.append(iconButton("plus", "Add to " + kindLabel(row.kind),
        (e) => openPalette(e.currentTarget, query, row, row.kind)));
      if (row.canHide) {
        actions.append(iconButton(row.hidden ? "eye-off" : "eye",
          (row.hidden ? "Show " : "Hide ") + kindLabel(row.kind) + " columns",
          () => commit(setHidden(query, row.path, !row.hidden)), !row.hidden));
      }
      if (row.canRemove) {
        actions.append(iconButton("close", "Remove this relationship",
          () => removeRow(query, row)));
      }
      line.append(actions);
      list.append(line);
    });

    // Only ever after an edit that named a row — never on a plain repaint, which would steal
    // focus from whatever the reader was doing when the query happened to reload.
    if (takeFocus) {
      takeFocus = false;
      const at = rows.findIndex((r) => rowKey(r) === focusPath);
      const line = at >= 0 ? list.children[at] : null;
      if (line) line.focus();
    }
  }

  function rowKey(row) {
    return pathKey(row.path);
  }

  /**
   * The kind of the nearest enclosing node, skipping boolean groups.
   *
   * `nodeAt` answers null for a path that lands on a group, because a group has no kind of its
   * own. Every caller here wants the node the step actually hangs off, which is the first one
   * found walking back up.
   */
  function enclosingKind(query, path) {
    for (let p = path.slice(0, -1); ; p = p.slice(0, -1)) {
      const node = nodeAt(query, p);
      if (node) return node.kind;
      if (!p.length) return null;
    }
  }

  function rowLabel(row) {
    if (row.group) {
      return (row.op === "or" ? "Either of" : "All of") + " " + row.branches
        + (row.branches === 1 ? " branch" : " branches");
    }
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
    // Enter and Delete are the ROW's shortcuts, and only the row's. A keydown from a button
    // inside it bubbles here too, and preventDefault on that was eating the button's own
    // native Enter-to-click: Enter on `+` opened the entity picker instead of the palette,
    // and Backspace anywhere in the row deleted the row out from under the control being used.
    if (e.target !== e.currentTarget) return;
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
      removeRow(query, row);
    }
  }

  render();
  return { node: root, sync: render };
}
