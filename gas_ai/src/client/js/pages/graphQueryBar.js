// The query builder, as chrome.
//
//   FIND   ⟨AI Agent⟩                                        41 results
//     THAT ⟨runs as  Service Account⟩       [+] [eye] [x]
//
// Structure and state come from graphQuery.js (pure, tested); this file turns them into buttons.
// Every option comes from the tenant's own vocabulary — a builder that lets you construct a query
// guaranteed to match nothing is a builder that wastes an afternoon, which is why Wiz's own only
// offers "the filters and connections that are valid for the selected node type".
//
// ONE TERM PER ROW, ONE PALETTE. This file used to carry a second editing model: a caret dropdown
// on the relationship and another on the entity beside it. Both are gone, and the reasons are
// worth keeping, because both were the same mistake seen from two ends.
//
// A relationship and its target are ONE choice. `queryPalette` has always modelled them that way
// — every `relations` entry is one (edge, direction, target) triple drawn from `stepsFrom`. Split
// back into two independent-looking dropdowns they could disagree, and the code resolved the
// disagreement by silently rewriting the entity chip: choosing "has issue" while the row said
// "Sensitive Data" moved the target to Issue with nothing on screen admitting it. Meanwhile the
// entity dropdown was usually a menu of one, because most relationships reach exactly one kind —
// HAS_ACCESS_TO_SENSITIVE_DATA only ever lands on SENSITIVE_DATA. A control that cannot disagree
// with itself and a control that offers nothing are the same bug: the pair was never two choices.
//
// So a row now carries ONE term pill, and clicking it opens the palette — the FIND row's in
// "entity" mode, a THAT row's in "replace" mode, scoped to the step's PARENT kind. The `+` is
// unchanged and still owns everything additive: more steps, properties, NOT, optional, blocks.
//
// ACCESSIBILITY. The rows are a real `tree`: the nesting is meaning, not indentation, and a
// screen-reader user gets `aria-level` rather than a guess from the left margin. One tab stop
// for the whole tree with a roving tabindex, arrows to move between rows, Enter to open the
// focused row's entity picker, Delete to remove a row.

import { el, openPopover, uiIcon } from "../ui.js";
import { describeFilter, filterEditor, operatorOf, valuesText } from "./filterEditor.js";
import { categoryOf, edgeLabel, kindIconSvg, kindLabel } from "../icons.js";
import {
  MAX_DEPTH,
  addStep,
  canNegate,
  depthOf,
  isGroup,
  nodeAt,
  pathAfterRegroup,
  pathAfterRemoval,
  queryRows,
  remapWhere,
  removeStep,
  replaceStep,
  setConjunction,
  setEdge,
  setHidden,
  setKind,
  stepAt,
} from "./graphQuery.js";
import { currentEntryId, openQueryPalette, stepForPick } from "./queryPalette.js";

/**
 * @param {object} opts
 *   {getQuery, getVocab, getWhere, onChange(nextQuery, nextWhere)}
 *   `getWhere` returns the parsed `where` map (slot index -> key -> values); `onChange`'s
 *   second argument is the map after the edit, which the page serializes back into the URL.
 * @returns {{node: HTMLElement, sync: function, focus: function}}
 */
export function queryBar(opts) {
  const list = el("div", {
    class: "gq-rows",
    role: "tree",
    "aria-label": "Security graph query",
  });
  const root = el("div", { class: "gq" }, list);
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
   * The palette, in whichever of its three modes this control wants.
   *
   * The `+` (mode "add") used to guess — first outbound relationship in the vocabulary, appended,
   * no questions — which meant the builder offered exactly one next step and never said what the
   * others were. The term pill's two modes replaced the dropdowns for the reason in the header.
   *
   * A pick comes back as one of seven payloads; where each one goes is the whole of this
   * function, and the palette knows nothing about the tree. Two of them differ by MODE rather
   * than by shape: a `relation` is appended under this node from the `+`, and swapped in for
   * this step from the pill. That asymmetry lives here, on the side of the wire that owns the
   * tree, rather than being pushed into the palette as a second payload type.
   */
  function openPalette(anchor, query, row, fromKind, mode) {
    openQueryPalette({
      anchor,
      mode,
      kind: fromKind || "ANY",
      vocab: opts.getVocab() || { kinds: [], stepsFrom: {} },
      row,
      currentId: currentEntryId(mode, row),
      loadFields: opts.loadFields,
      // The whole reading this node already holds for a field — values AND operator — so
      // reopening one shows what it says rather than an empty control over a filter plainly on
      // the row, and changing a value cannot quietly reset "is not" back to "is".
      currentFilter: (key) => {
        const forNode = currentWhere().get(row.index);
        return (forNode && forNode.get(key)) || null;
      },
      onPick: (pick) => {
        if (pick.type === "kind") {
          // Re-picking what the row already says is NOT an edit, and has to return before
          // `commit` rather than committing an identical tree: `dropAt` would take this node's
          // filter chips off, and the page's `onChange` clears `columns` and `page` on every
          // patch — so confirming the current answer would reset the table to arrive back at
          // the query already on screen.
          if (pick.kind === row.kind) return;
          // `setKind` drops the steps below (they were chosen against the old kind's
          // vocabulary) and `dropAt` drops this node's filters with them, for the same reason:
          // they name fields the new kind does not have, and a query answering zero with every
          // chip still reading correctly says nothing about why.
          commit(setKind(query, row.path, pick.kind), pathKey(row.path), { dropAt: row.path });
          return;
        }
        if (pick.type === "relation" && mode === "replace") {
          // The pill's own job: this hop becomes that hop. `replaceStep` keeps the row's NOT /
          // optional / hidden flags and — where the target kind is unchanged — the steps hanging
          // off it, so swapping a relationship does not silently demolish the query below it.
          commit(replaceStep(query, row.path, stepForPick(pick)), pathKey(row.path),
            pick.target !== row.kind ? { dropAt: row.path } : undefined);
          return;
        }
        if (pick.type === "property") {
          // A node that binds nothing has no slot to hang a filter on — a negated step is the
          // case, and the palette does not offer properties there, but a hand-edited link can.
          if (row.index === null || row.index === undefined) return;
          const where = currentWhere();
          const next = new Map(where);
          const forNode = new Map(next.get(row.index) || []);
          if (pick.values.length) forNode.set(pick.key, filterOf(pick));
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

  /**
   * A filter as the `where` map holds it. Flags are written only when true, the way `op` omits
   * its default — so a plain filter stays the plain object it has always been, and a flag present
   * anywhere in this map is always doing something.
   */
  function filterOf(src) {
    const out = { values: src.values, op: src.op || "eq" };
    if (src.all) out.all = true;
    if (src.negate) out.negate = true;
    return out;
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
    // Only for a kind that actually carries a filter — the vocabulary is fetched per kind, and
    // a row with nothing on it has no question to describe.
    ensureFields(row.kind);
    // WHERE, in the same label role FIND and THAT wear. A filter narrows which nodes bind at this
    // step, so it is part of the QUESTION — the chips used to trail the row as though they were
    // something applied to the answer afterwards.
    const wrap = el("span", { class: "gq-chips" }, el("span", { class: "gq-kw" }, "Where"));
    for (const key of [...forNode.keys()].sort()) {
      const filter = forNode.get(key) || { values: [] };
      const field = fieldSpec(row.kind, key);
      // The chip must read the operator the EDITOR will show. Over the cardinality cap a choice
      // field has no list, and the menu it gets there is a different one — without this the chip
      // and its own editor would name the same filter differently.
      const listed = hasValuesFor(row.kind, key);
      // The operator is STATED, always. It used to be written only for `contains`, so a filter
      // holding two values read "Projects A, B" — which is either alternative or both, and on a
      // field whose values can themselves contain a comma, not even reliably two values.
      const text = describeFilter(field, filter, field.label, listed);
      wrap.append(el("span", { class: "filter-chip gq-filter-chip" },
        el("button", {
          type: "button",
          class: "filter-chip-body",
          "aria-haspopup": "dialog",
          "aria-label": "Edit filter " + text + " on " + kindLabel(row.kind),
          onclick: (e) => openFilterEditor(e.currentTarget, query, row, field, filter),
        }, el("span", { class: "gq-filter-key" }, field.label), " ",
          el("span", { class: "gq-filter-op" }, operatorOf(field, filter, listed).label), " ",
          valuesText(filter)),
        el("button", {
          class: "filter-chip-x",
          "aria-label": "Remove filter " + text + " from " + kindLabel(row.kind),
          onclick: () => removeFilter(query, row, key),
        }, "×"),
      ));
    }
    return wrap;
  }

  /**
   * The chip's editor: the same control the palette draws when a filter is being created, in a
   * popover instead of a pane.
   *
   * This is the half that was missing. A filter could be made once and then only deleted — to
   * turn "Cloud is GCP" into "Cloud is GCP or AWS" you removed the chip and rebuilt it through
   * the `+`. Values were settable exactly once.
   */
  function openFilterEditor(anchor, query, row, field, filter) {
    const holder = el("div", { class: "gq-fe-host" });
    let open = true;
    const host = openPopover({
      anchor,
      className: "gq-fe-pop",
      ariaLabel: "Edit filter on " + field.label,
      position: { width: 320, minWidth: 320, maxHeight: 380, minHeight: 140, flipBelow: 220 },
      build: () => holder,
      onClose: () => { open = false; },
    });

    const mount = (got) => {
      if (!open) return;
      holder.textContent = "";
      const editor = filterEditor({
        // The FETCHED spec, not the column group's: `available` carries a key and a label, and
        // the operator list turns on `type` and `multi`, which only the vocabulary has.
        field: fieldIn(got, field.key) || field,
        filter,
        values: valuesIn(got, field.key),
        onChange: (next) => {
          const copy = new Map(currentWhere());
          const forNode = new Map(copy.get(row.index) || []);
          if (next.values.length) forNode.set(field.key, filterOf(next));
          else forNode.delete(field.key);
          if (forNode.size) copy.set(row.index, forNode);
          else copy.delete(row.index);
          // The popover does NOT close on each change. An operator and its values are one
          // thought, and closing after the first click is exactly what made the palette's
          // drill-in a create-only control.
          focusPath = pathKey(row.path);
          opts.onChange(query, copy);
        },
      });
      holder.append(editor.root);
      editor.focus();
    };

    const cached = fieldCache.get(row.kind);
    if (cached) mount(cached);
    else {
      holder.append(el("p", { class: "gq-fe-hint small muted" }, "Reading this kind's values…"));
      Promise.resolve(opts.loadFields ? opts.loadFields(row.kind) : null)
        .then((got) => { if (got) fieldCache.set(row.kind, got); mount(got || EMPTY_FIELDS); })
        .catch(() => mount(EMPTY_FIELDS));
    }
    return host;
  }

  /** One round trip per kind per session — `swrCall` already dedupes; this saves the re-render. */
  const fieldCache = new Map();
  const fieldsAsked = new Set();

  /**
   * Warm the field cache for a kind that has filters on it.
   *
   * The chip has to name a field's OPERATOR, and the operator list turns on `type` and `multi` —
   * neither of which the column chooser's `available` list carries, so before this the chip fell
   * back to "text" and rendered "Cloud is exactly GCP" over a menu offering "is" and "is not".
   * The chip and its own editor disagreed about what the filter said, which is precisely the
   * drift the shared editor exists to prevent.
   *
   * Asked once per kind and repainted when it lands. `swrCall` upstream already dedupes the RPC,
   * so the guard here is only to stop the repaint looping.
   */
  function ensureFields(kind) {
    if (!kind || fieldCache.has(kind) || fieldsAsked.has(kind) || !opts.loadFields) return;
    fieldsAsked.add(kind);
    Promise.resolve(opts.loadFields(kind)).then((got) => {
      if (!got) return;
      fieldCache.set(kind, got);
      render();
    }).catch(() => {});
  }

  const EMPTY_FIELDS = { fields: [], values: [] };
  const fieldIn = (got, key) => ((got && got.fields) || []).find((f) => f.key === key) || null;
  /** Whether the estate offered a value list for this field — undefined until the fetch lands. */
  const hasValuesFor = (kind, key) => {
    const got = fieldCache.get(kind);
    if (!got) return undefined;
    const spec = fieldIn(got, key);
    if (!spec || (spec.type !== "choice" && spec.type !== "boolean")) return undefined;
    return valuesIn(got, key).length > 0;
  };
  const valuesIn = (got, key) => {
    const hit = ((got && got.values) || []).find((v) => v.key === key);
    return (hit && hit.values) || [];
  };

  /**
   * What the chip should call a field, and how it should be compared, before anything is fetched.
   *
   * The column chooser's `available` list is the one description already on the client, but it
   * carries only a key and a label — so the chip reads correctly on first paint and the editor
   * upgrades to the real spec when the vocabulary lands. A filter naming a field this kind cannot
   * answer (a hand-edited link, or a kind change whose `dropAt` did not reach) still renders and
   * still comes off.
   */
  function fieldSpec(kind, key) {
    const fetched = fieldIn(fieldCache.get(kind), key);
    if (fetched) return fetched;
    for (const group of (opts.getGroups ? opts.getGroups() : [])) {
      if (group.kind !== kind) continue;
      const hit = (group.available || []).find((f) => f.key === key);
      if (hit) return { key, label: hit.label, type: hit.type || "text" };
    }
    return { key, label: key, type: "text" };
  }

  /**
   * An entity, as a tinted chip: the kind's glyph and its label, in its category's colours.
   *
   * ANY is spelled out here because it is not a kind and the shared helpers do not know that:
   * `kindLabel` has no entry so it echoes the token back as "ANY", `kindIconSvg` falls through
   * to the summary-stub glyph, and `categoryOf` answers "asset" for anything it does not
   * recognise — which painted the wildcard in the AI-asset tint and said something untrue about
   * it. The retired picker special-cased the label and nothing else.
   */
  function entityChip(kind) {
    const any = kind === "ANY";
    const icon = any ? uiIcon("graph", 14) : kindIconSvg(kind, 14);
    icon.setAttribute("class", "gq-chip-icon");
    return el("span", { class: "gq-chip", "data-category": any ? null : categoryOf(kind) },
      icon, el("span", { class: "gq-chip-text" }, any ? "Any node" : kindLabel(kind)));
  }

  /**
   * The row's editable term, and the only thing on the row that opens the palette to change it.
   *
   * On FIND it is one entity. On THAT it is a relationship AND its entity, in one pill with one
   * hit target — because that is one choice, for the reason the header sets out at length. There
   * is no caret: the reference has none, the row already carries three explicit icon buttons
   * doing the visible work, and a pill that reveals itself on hover and announces itself through
   * `aria-haspopup` is a quieter line than two carets that lied about being independent.
   *
   * A <button> cannot contain a <button>, so the entity is a <span> and the whole term is the
   * control. That is the same trade the reference makes, and it is why the category tint lives
   * on a chip that is no longer interactive.
   *
   * NO `aria-label`. The name is computed from the button's own contents plus a hidden tail, so
   * the visible words are part of the spoken ones by construction rather than by two strings
   * being kept in step — and the gloss stays written in exactly one place. `aria-haspopup` is
   * "dialog" rather than the combobox's `aria-expanded`: the palette is a dialog (`openPopover`
   * builds one) and it is not this button's listbox, so the old vocabulary would be a lie about
   * a control that no longer exists.
   */
  function termButton(row, onOpen) {
    const parts = [];
    if (row.path.length) {
      parts.push(el("span", { class: "gq-term-edge" }, describeEdge(row)));
    }
    parts.push(entityChip(row.kind));
    parts.push(el("span", { class: "sr-only" },
      row.path.length ? ", change this relationship" : ", change what this query finds"));
    return el("button", {
      type: "button",
      class: "gq-term" + (row.path.length ? "" : " gq-term--solo"),
      "aria-haspopup": "dialog",
      onclick: (e) => onOpen(e.currentTarget),
    }, ...parts);
  }

  // ------------------------------------------------------------------- the keyword

  /**
   * The states the keyword pill walks, for a row that has a condition above it.
   *
   * TWO AXES, ONE LOOP: how this condition joins the one above it, and whether it is asserted
   * absent. Bare `THAT` is not among them, because a second condition is ALREADY ANDed — the
   * domain's `and` group cross-products exactly the way a node's own sibling loop does, so
   * `THAT` and `AND THAT` would be the same query written twice, and one whole click of the loop
   * would appear to do nothing.
   */
  const JOINED_STATES = [
    { conj: "and", negate: false },
    { conj: "and", negate: true },
    { conj: "or", negate: false },
    { conj: "or", negate: true },
  ];
  /** A row with nothing above it at its level joins nothing; only the assertion is left. */
  const FIRST_STATES = [{ negate: false }, { negate: true }];

  /** `THAT` / `AND THAT` / `OR THAT` — the row's join, read as the grammar it is. */
  function keywordOf(row) {
    if (!row.conj) return row.keyword;
    return (row.conj === "or" ? "OR " : "AND ") + row.keyword;
  }

  /**
   * The states this row may actually take, in loop order.
   *
   * Two are skipped rather than offered and then rejected. NOT is dropped where the domain would
   * refuse it — a negated step binds nothing, so it can carry no further steps and cannot also be
   * optional. And OR is dropped where the wrap it needs would push the tree past the depth the
   * server accepts; a group costs a level, and a long enough chain has none to spare.
   */
  function statesFor(query, row) {
    const all = row.canJoin ? JOINED_STATES : FIRST_STATES;
    return all.filter((s) => {
      if (s.negate && !canNegate(row)) return false;
      if (s.conj === "or" && row.conj !== "or"
        && depthOf(setConjunction(query, row.path, "or")) > MAX_DEPTH) return false;
      return true;
    });
  }

  /** Why a state is missing, for the pill's tooltip — an absence with no reason is a bug report. */
  function cycleHint(query, row, states) {
    const full = row.canJoin ? JOINED_STATES : FIRST_STATES;
    if (states.length === full.length) return null;
    if (!canNegate(row)) {
      return row.optional
        ? "NOT is unavailable: this step is optional, and a step cannot be both."
        : "NOT is unavailable: something hangs off this entity, and a negated step has nothing "
          + "to walk from.";
    }
    return "OR is unavailable: grouping these would nest the query deeper than "
      + MAX_DEPTH + " levels.";
  }

  /**
   * The keyword, as a control where it is one.
   *
   * FIND keeps a plain span: there is nothing above it to join and a starting point cannot be
   * asserted absent, so a button there would be a control with one state. A block's header keeps
   * one too — its own row already says OR or AND, and the pill is about a row's join, not a
   * block's contents. That leaves the pill interactive exactly where it means something, which
   * is the only affordance a caret-less control has.
   */
  function keywordControl(query, row) {
    const states = row.group || !row.path.length ? [] : statesFor(query, row);
    if (states.length < 2) return el("span", { class: "gq-kw" }, keywordOf(row));
    const hint = cycleHint(query, row, states);
    return el("button", {
      type: "button",
      class: "gq-kw gq-kw--btn",
      // The name states what the row says NOW and what pressing does. The row itself takes focus
      // after the edit and its `aria-label` restates the whole condition, so the new reading is
      // announced without a live region.
      "aria-label": keywordOf(row) + (row.negate ? " NOT" : "") + " — change how this condition joins",
      title: (hint ? hint + "\n" : "") + "Cycle: "
        + states.map((s) => (s.conj ? s.conj.toUpperCase() + " " : "") + "THAT"
          + (s.negate ? " NOT" : "")).join(" → "),
      onclick: () => cycleRow(query, row),
    },
      keywordOf(row),
      // Negation is a word, not a colour, and it belongs INSIDE the control that sets it — a red
      // NOT sitting next to the pill would be state the reader cannot reach from the thing
      // showing it.
      row.negate ? el("span", { class: "gq-not" }, "NOT") : null);
  }

  /** Advance one place around the loop and write both halves of the new state. */
  function cycleRow(query, row) {
    const states = statesFor(query, row);
    if (states.length < 2) return;
    const at = states.findIndex((s) => !!s.negate === row.negate
      && (row.canJoin ? s.conj === row.conj : true));
    const next = states[(at + 1) % states.length];
    let tree = query;
    let movePath;
    if (row.canJoin && next.conj !== row.conj) {
      tree = setConjunction(tree, row.path, next.conj);
      // The wrap or the dissolve moved this row's own path, so the negate patch below has to be
      // written at the path it moved TO, and the filters carried across with it.
      movePath = pathAfterRegroup(query, tree);
    }
    const nowAt = movePath ? movePath(row.path.join(".")) : row.path.join(".");
    const path = nowAt ? nowAt.split(".").map(Number) : row.path;
    if (next.negate !== row.negate) tree = setEdge(tree, path, { negate: next.negate });
    commit(tree, pathKey(path), { movePath });
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
      // Rows of one RUN are consecutive, so the bracket is drawn by marking its ends — no wrapper
      // element, because the row index and `list.children` index must stay 1:1 for the arrow keys
      // and the post-edit focus restore.
      const runStart = row.runOf !== null && (i === 0 || rows[i - 1].runOf !== row.runOf);
      const runEnd = row.runOf !== null && (i === rows.length - 1 || rows[i + 1].runOf !== row.runOf);
      const line = el("div", {
        class: "gq-row" + (row.hidden ? " is-hidden" : "") + (row.negate ? " is-negated" : "")
          + (row.group ? " is-group" : "")
          + (row.runOf !== null ? " is-run" : "")
          + (runStart ? " is-run-start" : "") + (runEnd ? " is-run-end" : ""),
        role: "treeitem",
        "aria-level": String(row.level + 1),
        "aria-label": rowLabel(row),
        tabindex: rowKey(row) === focusPath || (!focusPath && i === 0) ? "0" : "-1",
        // Driven by a custom property rather than the padding directly, so the run bracket can
        // be drawn at the row's own indent instead of at the container's edge.
        style: "--gq-indent:" + (row.level * 20) + "px",
        onkeydown: (e) => onRowKey(e, rows, i, row, query),
        onfocus: () => { focusPath = rowKey(row); },
      });

      line.append(keywordControl(query, row));

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
          (e) => openPalette(e.currentTarget, query, row, parentKind, "add")));
        groupActions.append(iconButton("close", "Remove this " + row.keyword + " block",
          () => removeRow(query, row)));
        line.append(groupActions);
        list.append(line);
        return;
      }

      // A THAT row's relationships come from the node the step hangs OFF, not from its target —
      // "what can this hop be" is a question about where the hop starts. The FIND row has no
      // step, so its pill picks an entity instead.
      line.append(row.path.length
        ? termButton(row, (anchor) => openPalette(anchor, query, row, parentKind, "replace"))
        : termButton(row, (anchor) => openPalette(anchor, query, row, row.kind, "entity")));

      // `append(null)` writes the literal text "null" — the trap graph.js's savedViewsControl
      // already carries a comment about. `el()` skips nulls; `append` does not.
      const chips = filterChips(query, row);
      if (chips) line.append(chips);

      const actions = el("span", { class: "gq-row-actions" });
      actions.append(iconButton("plus", "Add to " + kindLabel(row.kind),
        (e) => openPalette(e.currentTarget, query, row, row.kind, "add")));
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
    // The join leads, because it is the first thing the row now says and the thing the keyword
    // pill just changed — the row takes focus after that edit, so this string IS the readback.
    const join = row.conj === "or" ? "Or that " : row.conj === "and" ? "And that " : "That ";
    // The negation is spoken exactly where the row shows it, as the same word. EDGE_LABELS are
    // finite verb phrases, so no auxiliary can be prefixed grammatically — "does not has issue"
    // was the old attempt. Mirroring the visible "AND THAT NOT" instead is both readable and the
    // thing WCAG asks for: the name a control is called by contains the words on it.
    return join + (row.negate ? "not " : "") + describeEdge(row) + " " + kindLabel(row.kind)
      + (row.hidden ? ", columns hidden" : "");
  }

  /**
   * The relationship, in words. This is READ OFF THE ROW now, not just spoken by a screen
   * reader, so the wording has to survive being looked at: the old text said "is related to
   * within 1 hops" whenever the hop count was one, which was invisible while it lived in an
   * `aria-label` and is not any more. One hop is the plain neighbourhood question and says so.
   *
   * The palette's `describeRelation` glosses the same relationships for its own rows; the two
   * agree on the named edges by both going through EDGE_LABELS, which is where that vocabulary
   * belongs.
   *
   * NEGATION IS NOT IN HERE. EDGE_LABELS are finite verb phrases — "has issue", "runs as" — and
   * prefixing one produced "does not has issue", which was ungrammatical before the keyword pill
   * existed and is redundant now that the pill says NOT in its own word beside it.
   */
  function describeEdge(row) {
    if (row.edge === "ANY") {
      const hops = row.hops || 1;
      return "is related to" + (hops > 1 ? ", within " + hops + " hops" : "");
    }
    return edgeLabel(row.edge) + (row.reverse ? ", incoming" : "");
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
      // A row has exactly one term now, so this no longer has to say which chip it means.
      const term = e.currentTarget.querySelector(".gq-term");
      if (term) {
        e.preventDefault();
        term.click();
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

  /**
   * Put the keyboard in the bar. The host calls this when it reveals a bar that was put away,
   * so the reader lands on the row they left rather than back at FIND every time.
   *
   * It goes through `focusPath` rather than `list.firstChild` because that variable IS the
   * roving tab stop — the one row rendered at tabindex="0" (see the guard above `render`) —
   * and focusing any other row would leave the tab order pointing somewhere else.
   */
  function focus() {
    const at = focusPath
      ? Array.prototype.findIndex.call(list.children, (n) => n.tabIndex === 0)
      : 0;
    const line = list.children[at >= 0 ? at : 0];
    if (line) line.focus();
  }

  render();
  return { node: root, sync: render, focus };
}
