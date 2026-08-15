// The `+` palette: everything a query step can be, in one searchable place.
//
//   ┌───────────────────────────────────────────────────────────────┐
//   │ [search…                                                    ] │
//   ├───────────┬─────────────────────────────┬─────────────────────┤
//   │ Popular   │ RELATIONSHIPS               │ Service Account     │
//   │ Operators │  ▸ Service Account      41  │ Relationship        │
//   │ AI assets │      runs as                │ …what it does…      │
//   │ Identity  │  ▸ AI Guardrail          6  │ THAT runs as …      │
//   └───────────┴─────────────────────────────┴─────────────────────┘
//
// It replaces a `+` that guessed: the old handler read the vocabulary, took the first outbound
// relationship and appended it, so the builder offered exactly one next step and never said
// what the others were. Everything it offers still comes from the TENANT's own vocabulary — a
// palette that lets you build a query guaranteed to match nothing wastes an afternoon.
//
// PURE / DOM SPLIT. `paletteEntries` is a plain function of plain values, and the rest of the
// file paints what it returns. Vitest here runs in node with no jsdom (see graphChips.test.js
// for why one is not being added), so that split is the difference between the entry model
// being tested and not being tested at all.

import { el, openPopover, openSheet, uiIcon } from "../ui.js";
import {
  CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, edgeLabel, kindIconSvg, kindLabel,
} from "../icons.js";
import { facetGroup } from "../filters.js";
import { findEntry } from "../helpContent.js";
import { serializeStep } from "./graphQuery.js";

/** Below this the popover is unusable at three panes wide; it becomes a modal sheet instead. */
const NARROW_PALETTE = "(max-width: 800px)";

const SECTION_LABELS = {
  popular: "Popular",
  shortcuts: "Query shortcuts",
  operators: "Operators",
  properties: "Properties",
  relations: "Relationships",
};

/** What a field's type is called, and what it means for how you filter on it. */
const TYPE_WORDS = {
  text: "Text property",
  choice: "Choice property",
  boolean: "Yes / no property",
  number: "Number property",
};
const TYPE_BLURBS = {
  text: "Matched as a SUBSTRING, so “prod” finds “prod-agent-01”. Case is ignored.",
  choice: "Pick from the values this estate actually holds — the list is the graph's, not the "
    + "schema's, and each value says how many nodes carry it.",
  boolean: "Three states, not two: yes, no, and unknown. Wiz not reporting a property is a "
    + "different answer from reporting it false, and the filter keeps them apart.",
  number: "Matched exactly. A range comparison is not offered yet — where a band is the useful "
    + "question, there is usually a choice field beside this one that asks it better.",
};

/** How many relationships the Popular section leads with before you go to a category. */
const POPULAR_RELATIONS = 6;

// ------------------------------------------------------------------------- the entry model

/**
 * Everything this palette can offer, given where it was opened from.
 *
 *   kind   the node the `+` hangs off — whose relationships and properties are on offer
 *   vocab  {kinds, stepsFrom} as the server derived it from this tenant's graph
 *   row    the builder row the `+` belongs to, or null for a bare list
 *
 * An entry is `{id, section, category, glyph, label, sub, count, detail, pick}`:
 *   section  which rail tab it belongs to — "popular" doubles as a second home
 *   detail   {title, type, blurb, literal} for the right-hand pane; `literal` is the DSL
 *            fragment the pick inserts, so a reader can see what a choice does before doing it
 *   pick     the payload handed back to the caller — see the three shapes below
 *
 * The pick shapes, all applied by graphQueryBar:
 *   {type: "relation", edge, reverse, hops, target}   append a step under this node
 *   {type: "group", op, steps}                        append a boolean block
 *   {type: "flag", flag, value}                       set negate/optional on THIS row's step
 *   {type: "shortcut", steps, filters}                a curated question, steps and filters
 *   {type: "property", key, values, op}               filter this node on a field
 *
 * A `field` pick never reaches the caller — it drills into that field's values inside the
 * palette, and what comes back is the `property` above. A property with no value chosen would
 * be a filter nobody asked for.
 */
export function paletteEntries(ctx) {
  const { kind, vocab, row } = ctx || {};
  const steps = ((vocab || {}).stepsFrom || {})[kind] || [];
  const out = [];

  // ------------------------------------------------------------------ shortcuts
  // Curated questions, defined in the DOMAIN so a test can hold each to the model, and shipped
  // with `kinds` already narrowed to what this tenant's graph can answer — see QUERY_SHORTCUTS.
  // They lead the Popular tab because they are the fastest route from "open the page" to a
  // question worth asking.
  for (const s of ((vocab || {}).shortcuts || [])) {
    if (!(s.kinds || []).includes(kind)) continue;
    out.push({
      id: "sc-" + s.id,
      section: "shortcuts",
      category: null,
      glyph: "filter",
      label: s.label,
      sub: s.phrase,
      count: null,
      popular: true,
      detail: {
        title: s.label,
        type: "Query shortcut",
        blurb: s.blurb,
        literal: shortcutLiteral(s),
      },
      pick: { type: "shortcut", id: s.id, steps: s.steps, filters: s.filters || [] },
    });
  }

  // ------------------------------------------------------------------ relationships
  // One entry per (edge, direction, target kind) — the same triple a step carries, so picking
  // one needs no second question. The vocabulary is already sorted commonest-first.
  steps.forEach((entry, i) => {
    const category = categoryOf(entry.kind);
    out.push({
      id: "rel-" + (entry.reverse ? "in-" : "out-") + entry.edge + "-" + entry.kind,
      section: "relations",
      category,
      glyph: null,
      targetKind: entry.kind,
      label: kindLabel(entry.kind),
      sub: describeRelation(entry),
      count: entry.count,
      popular: i < POPULAR_RELATIONS,
      detail: {
        title: kindLabel(entry.kind),
        type: "Relationship",
        blurb: relationBlurb(kind, entry),
        literal: literalFor({ type: "relation", edge: entry.edge, reverse: entry.reverse,
          hops: 1, target: entry.kind }),
      },
      pick: {
        type: "relation", edge: entry.edge, reverse: entry.reverse, hops: 1, target: entry.kind,
      },
    });
  });

  // "Related to, within N hops" is always offered: it is the neighbourhood question, and the
  // graph can answer it even where no single named edge fits. It is not in the vocabulary
  // because it is not an edge — it is every edge.
  for (const hops of [1, 2, 3]) {
    out.push({
      id: "rel-any-" + hops,
      section: "relations",
      category: null,
      glyph: "graph",
      targetKind: "ANY",
      label: hops === 1 ? "Any node" : "Any node, " + hops + " hops out",
      sub: "is related to" + (hops > 1 ? ", within " + hops + " hops" : ""),
      count: null,
      popular: hops === 1,
      detail: {
        title: hops === 1 ? "Any related node" : "Any node within " + hops + " hops",
        type: "Relationship",
        blurb: "Follows every relationship this tenant's graph holds, in either direction, "
          + (hops === 1 ? "one hop out" : "up to " + hops + " hops out")
          + ". The neighbourhood question, for when no single named relationship is the one "
          + "you mean. More hops reach further and match more loosely.",
        literal: literalFor({ type: "relation", edge: "ANY", reverse: false, hops, target: "ANY" }),
      },
      pick: { type: "relation", edge: "ANY", reverse: false, hops, target: "ANY" },
    });
  }

  // ------------------------------------------------------------------ properties
  // Filled once the per-kind field list has arrived — the palette asks for it when the tab is
  // first opened rather than dragging every kind's fields into the bootstrap payload.
  for (const f of (ctx.fields || [])) {
    // Filtering a thing by what it already is. The kind is chosen one chip to the left.
    if (f.key === "kind") continue;
    out.push({
      id: "prop-" + f.key,
      section: "properties",
      category: null,
      glyph: "property",
      label: f.label,
      sub: TYPE_WORDS[f.type] || "Property",
      count: null,
      popular: false,
      field: f,
      detail: {
        title: f.label,
        type: TYPE_WORDS[f.type] || "Property",
        blurb: TYPE_BLURBS[f.type] || "",
        literal: "",
      },
      pick: { type: "field", key: f.key, fieldType: f.type, label: f.label },
    });
  }

  // ------------------------------------------------------------------ operators
  // A block is pre-filled with real relationships rather than opened empty: this builder has no
  // empty-branch row to fill in afterwards, and an OR of nothing is a query that cannot run.
  const branchSteps = steps.slice(0, 2).map((e) => stepForPick({
    type: "relation", edge: e.edge, reverse: e.reverse, hops: 1, target: e.kind,
  }));
  const seeded = branchSteps.length
    ? branchSteps
    : [stepForPick({ type: "relation", edge: "ANY", reverse: false, hops: 1, target: "ANY" })];

  out.push({
    id: "op-or",
    section: "operators",
    category: null,
    glyph: "branch",
    label: "Either of — OR",
    sub: "a match on any one branch is a match",
    count: null,
    popular: true,
    detail: {
      title: "OR block",
      type: "Operator",
      blurb: "Branches that are ALTERNATIVES. A path matching any one of them is kept, and the "
        + "columns belonging to the branches it did not match read as blank — so a row still "
        + "says which way it matched. The table rules between them and says OR, because "
        + "presenting alternatives as consecutive column groups would read as though all of "
        + "them happened.",
      literal: literalFor({ type: "group", op: "or", steps: seeded }),
    },
    pick: { type: "group", op: "or", steps: seeded },
  });
  out.push({
    id: "op-and",
    section: "operators",
    category: null,
    glyph: "branch",
    label: "All of — AND",
    sub: "every branch must match",
    count: null,
    popular: false,
    detail: {
      title: "AND block",
      type: "Operator",
      blurb: "Branches that must ALL match, grouped so the whole group can be made optional at "
        + "once. Steps hanging off one node already behave this way; a block is worth adding "
        + "when you want to negate or optional the set rather than each member.",
      literal: literalFor({ type: "group", op: "and", steps: seeded }),
    },
    pick: { type: "group", op: "and", steps: seeded },
  });

  // Negate and optional modify the step the `+` hangs off, so they are only on offer when there
  // IS one — the FIND root is a starting point, not a relationship, and neither flag means
  // anything on it. Both read as their own undo when already set: one entry, two directions.
  if (row && row.path && row.path.length) {
    const named = row.group
      ? (row.op === "or" ? "this OR block" : "this AND block")
      : "this relationship";
    if (!row.group) {
      out.push({
        id: "op-negate",
        section: "operators",
        category: null,
        glyph: "not",
        label: row.negate ? "Require this relationship" : "Does not — NOT",
        sub: row.negate ? "stop asserting the relationship is absent" : "assert the relationship is absent",
        count: null,
        popular: true,
        detail: {
          title: row.negate ? "Remove NOT" : "NOT",
          type: "Operator",
          blurb: row.negate
            ? "Goes back to requiring the relationship. The step binds a node again, so its "
              + "columns come back to the table."
            : "Asserts the relationship is ABSENT — an agent with no guardrail, an identity "
              + "with no owner. A negated step binds nothing, so it contributes no columns and "
              + "nothing below it is traversed; it narrows the rows rather than widening them.",
          literal: (row.negate ? "" : "!") + "…",
        },
        pick: { type: "flag", flag: "negate", value: !row.negate },
      });
    }
    out.push({
      id: "op-optional",
      section: "operators",
      category: null,
      glyph: "check",
      label: row.optional ? "Require " + named : "Optional",
      sub: row.optional ? "drop rows that do not match it" : "keep the row even when it does not match",
      count: null,
      popular: true,
      detail: {
        title: row.optional ? "Remove optional" : "Optional",
        type: "Operator",
        blurb: row.optional
          ? "Goes back to requiring it: rows that cannot satisfy this step are dropped again."
          : "Keeps a path even when this step finds nothing. The columns it would have filled "
            + "read as blank instead of the whole row disappearing — which is how you ask "
            + "“show me all of them, and their identity where there is one” rather "
            + "than only the ones that have one.",
        literal: (row.optional ? "" : "*") + "…",
      },
      pick: { type: "flag", flag: "optional", value: !row.optional },
    });
  }

  return out;
}

/** The rail: the fixed tabs, then one per category that actually has something under it. */
export function paletteRail(entries) {
  const rail = [
    { key: "popular", label: SECTION_LABELS.popular, count: entries.filter((e) => e.popular).length },
  ];
  const shortcuts = entries.filter((e) => e.section === "shortcuts").length;
  if (shortcuts) rail.push({ key: "shortcuts", label: SECTION_LABELS.shortcuts, count: shortcuts });
  rail.push({
    key: "operators",
    label: SECTION_LABELS.operators,
    count: entries.filter((e) => e.section === "operators").length,
  });
  // Always present, even before the field list has landed — a tab that appears a beat after the
  // palette opens is a tab nobody finds. Its count fills in when the fetch answers.
  rail.push({
    key: "properties",
    label: SECTION_LABELS.properties,
    count: entries.filter((e) => e.section === "properties").length,
  });
  for (const cat of CATEGORY_ORDER) {
    const n = entries.filter((e) => e.category === cat).length;
    // Ours has five categories where the reference has twelve. Showing an empty one anyway
    // would be theatre — a tab that promises relationships this kind does not have.
    if (n) rail.push({ key: "cat-" + cat, label: CATEGORY_LABELS[cat], count: n, category: cat });
  }
  const loose = entries.filter((e) => e.section === "relations" && !e.category).length;
  if (loose) rail.push({ key: "cat-any", label: "Any node", count: loose, category: null, loose: true });
  return rail;
}

/** Which entries a rail tab shows, in the order they were derived (commonest first). */
export function entriesForTab(entries, tabKey) {
  if (tabKey === "popular") return entries.filter((e) => e.popular);
  if (tabKey === "shortcuts") return entries.filter((e) => e.section === "shortcuts");
  if (tabKey === "operators") return entries.filter((e) => e.section === "operators");
  if (tabKey === "properties") return entries.filter((e) => e.section === "properties");
  if (tabKey === "cat-any") {
    return entries.filter((e) => e.section === "relations" && !e.category);
  }
  if (tabKey.indexOf("cat-") === 0) {
    const cat = tabKey.slice(4);
    return entries.filter((e) => e.category === cat);
  }
  return entries;
}

/** Free-text search across every tab at once — label, sub-line and the literal expansion. */
export function searchEntries(entries, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  return entries.filter((e) =>
    e.label.toLowerCase().indexOf(q) !== -1
    || (e.sub || "").toLowerCase().indexOf(q) !== -1
    || (e.detail && (e.detail.literal || "").toLowerCase().indexOf(q) !== -1));
}

/**
 * The tree step a pick inserts. ONE construction site, used by the detail pane to print it and
 * by graphQueryBar to insert it, so the two cannot describe different things.
 *
 * A falsy flag is left OUT rather than written as `false`: `parseQuery(serializeQuery(q))` deep-
 * equals `q` is a documented property of this tree, and a `reverse: false` the parser never
 * produces quietly breaks it.
 */
export function stepForPick(pick) {
  if (pick.type === "group") return { op: pick.op, steps: pick.steps };
  if (pick.edge === "ANY") {
    return { edge: "ANY", hops: pick.hops || 1, node: { kind: pick.target } };
  }
  const step = { edge: pick.edge, node: { kind: pick.target } };
  if (pick.reverse) step.reverse = true;
  return step;
}

/**
 * The DSL fragment a pick inserts, for the detail pane.
 *
 * The REAL serializer, not a lookalike template — what the pane promises and what the URL ends
 * up carrying are then the same string by construction rather than by two people remembering
 * the same grammar.
 */
export function literalFor(pick) {
  if (pick.type === "flag" || pick.type === "shortcut") return "";
  return serializeStep(stepForPick(pick));
}

/**
 * A shortcut's expansion, steps and filters together.
 *
 * The filters are written in `where=` notation with the path standing in for the slot number,
 * because the real slot depends on where in the tree the shortcut lands and the pane is read
 * before that is decided. It still shows both halves — a shortcut that narrows by a property
 * and says only which relationship it walks would be describing half of what it does.
 */
export function shortcutLiteral(shortcut) {
  const parts = (shortcut.steps || []).map(serializeStep);
  for (const f of (shortcut.filters || [])) {
    const at = f.path.length ? "+" + f.path.join(".") : "this";
    parts.push(at + "." + f.key + "." + f.values.join("|"));
  }
  return parts.join("  ");
}

/** "runs as", "runs as (incoming)" — the direction is stated, never conjugated backwards. */
function describeRelation(entry) {
  if (!entry.reverse) return edgeLabel(entry.edge);
  // EDGE_LABELS are active-voice glosses written for the subject end. Read backwards they need
  // a passive English does not reliably supply — "is allows access to by" is what a naive
  // template produces — so the direction is named instead. Precise beats fluent.
  return edgeLabel(entry.edge) + " (incoming)";
}

/**
 * What a relationship means, in one sentence.
 *
 * Prefers the help book where it has an entry for the target kind's risk — the same prose the
 * `?` tips and the Reference page carry, so the palette teaches the app's own vocabulary rather
 * than a second one written here.
 */
function relationBlurb(fromKind, entry) {
  const help = findEntry(HELP_FOR_KIND[entry.kind] || "");
  // The gloss is NAMED, not conjugated into the sentence. EDGE_LABELS are written subject-first
  // ("has issue", "allows access to"), and dropping one into "every X this Y …" produces "every
  // Issue this AI Agent has issue". Naming the relationship instead reads correctly for all
  // twenty-four of them, in both directions.
  const sentence = entry.reverse
    ? "One step along " + edgeLabel(entry.edge) + ", followed backwards — from "
      + kindLabel(entry.kind) + " to this " + kindLabel(fromKind) + "."
    : "One step along " + edgeLabel(entry.edge) + " — from this " + kindLabel(fromKind)
      + " to " + kindLabel(entry.kind) + ".";
  const tally = entry.count
    ? " " + entry.count.toLocaleString() + (entry.count === 1 ? " such relationship" : " such relationships")
      + " in this tenant."
    : "";
  return sentence + tally + (help ? " " + help.blurb : "");
}

/** Target kinds whose meaning the help book already explains. */
const HELP_FOR_KIND = {
  MISSING_GUARDRAIL: "missing-guardrail",
  SENSITIVE_DATA: "sensitive-data",
  INTERNET_EXPOSURE: "internet-exposure",
  EXCESSIVE_PRIVILEGE: "excessive-privilege",
  SERVICE_ACCOUNT: "agentic-identity",
};

// ------------------------------------------------------------------------- the palette

let _paletteSeq = 0;

/**
 * Open the palette against `anchor`. `onPick(pick)` receives one of the three payloads.
 *
 * Returns the popover handle (or the sheet's, on a narrow viewport) so a caller can close it.
 *
 * ACCESSIBILITY. The search field is the combobox and the middle pane is its listbox: the
 * active row travels as `aria-activedescendant` and DOM focus never leaves the input, which is
 * the editable-combobox pattern the app already runs in filterCombobox. The rail is deliberately
 * NOT a tablist — a tablist owning a combobox's listbox is a known trap — but single-select
 * `aria-pressed` buttons on a roving tabindex, one tab stop, the vocabulary used elsewhere here.
 *
 * Left and Right arrows are left to the text caret rather than being taken for rail movement:
 * they belong to the field someone is typing in, and stealing them makes a search box that
 * cannot be edited.
 */
export function openQueryPalette(spec) {
  const { anchor, kind, vocab, row, onPick, title, loadFields, currentValues } = spec;
  const seq = ++_paletteSeq;
  const listId = "gq-palette-list-" + seq;
  let fields = null;    // per-kind field list, once fetched
  let values = null;    // per-kind value lists, once fetched
  let entries = paletteEntries({ kind, vocab, row, fields });
  let rail = paletteRail(entries);

  let tab = rail[0] ? rail[0].key : "popular";
  let query = "";
  let shown = [];
  let activeIndex = 0;
  let rowNodes = [];
  let host = null;      // {close} — the popover or the sheet
  /** Non-null while drilled into one field's values. */
  let drill = null;
  let loading = false;

  const search = el("input", {
    type: "text",
    class: "gq-pal-search",
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": listId,
    "aria-autocomplete": "list",
    "aria-label": "Search relationships and operators",
    placeholder: "Search…",
    autocomplete: "off",
    spellcheck: "false",
  });
  const listEl = el("ul", {
    id: listId, class: "gq-pal-list", role: "listbox",
    "aria-label": "Add to the query",
  });
  const railEl = el("div", {
    class: "gq-pal-rail", role: "group", "aria-label": "Categories",
  });
  const detailEl = el("div", { class: "gq-pal-detail", "aria-live": "polite" });

  /**
   * Built ONCE; `paintRail` only writes state onto the buttons afterwards.
   *
   * Rebuilding them on every paint destroyed the button mid-click — its own handler called
   * paint, paint cleared the rail, focus fell to `<body>`, and the focusout dismissal read that
   * as "the reader left" and closed the whole palette. The facet rows in filters.js carry the
   * same rule for the same reason: a control that rebuilds itself under the pointer loses the
   * focus that was on it.
   */
  function railButtons() {
    rail.forEach((t) => {
      railEl.append(el("button", {
        type: "button",
        class: "gq-pal-rail-item",
        "aria-pressed": "false",
        tabindex: "-1",
        "data-tab": t.key,
        onclick: () => {
          query = "";
          search.value = "";
          tab = t.key;
          drill = null;
          if (t.key === "properties") ensureFields();
          paint();
          // Focus goes back to the field, so ArrowDown walks the list this click just changed
          // rather than the rail the reader has finished with.
          search.focus();
        },
        onkeydown: onRailKey,
      },
        el("span", { class: "gq-pal-rail-label" }, t.label),
        el("span", { class: "gq-pal-rail-count" }, String(t.count)),
      ));
    });
  }

  /**
   * The field list and its value lists, fetched the first time the Properties tab is opened.
   *
   * Every kind's fields and values together were most of a 28 KB vocabulary, none of it read
   * unless someone goes looking for a property — and then only for the one kind. `swrCall` keys
   * on the params, so this is one round trip per kind per session.
   */
  function ensureFields() {
    if (fields || loading || !loadFields) return;
    loading = true;
    paint();
    Promise.resolve(loadFields(kind)).then((got) => {
      loading = false;
      if (!got || !host) return;
      fields = got.fields || [];
      values = got.values || [];
      entries = paletteEntries({ kind, vocab, row, fields });
      // The rail is built once, so only its counts change — the Properties tab was already
      // there, promising a list it could not yet draw.
      rail = paletteRail(entries);
      for (const btn of railEl.children) {
        const t = rail.find((x) => x.key === btn.getAttribute("data-tab"));
        const countEl = btn.querySelector(".gq-pal-rail-count");
        if (t && countEl) countEl.textContent = String(t.count);
      }
      paint();
    }).catch(() => { loading = false; paint(); });
  }

  /** A search spanning every tab belongs to none of them, so nothing reads as selected. */
  function paintRail() {
    for (const btn of railEl.children) {
      const on = !query && btn.getAttribute("data-tab") === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("tabindex", btn.getAttribute("data-tab") === tab ? "0" : "-1");
    }
  }

  function onRailKey(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...railEl.children];
    const at = items.indexOf(e.currentTarget);
    const next = items[at + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    for (const item of items) item.setAttribute("tabindex", "-1");
    next.setAttribute("tabindex", "0");
    next.focus();
  }

  function rowFor(entry, idx) {
    const optId = listId + "-opt-" + idx;
    const glyph = entry.targetKind && entry.targetKind !== "ANY"
      ? kindIconSvg(entry.targetKind, 14)
      : uiIcon(entry.glyph || "plus", 14);
    glyph.setAttribute("class", "gq-pal-glyph");
    const node = el("li", {
      id: optId, role: "option", class: "gq-pal-option", "aria-selected": "false",
      "data-category": entry.category || null,
    },
      el("span", { class: "gq-pal-glyph-wrap" }, glyph),
      el("span", { class: "gq-pal-option-text" },
        el("span", { class: "gq-pal-option-label" }, entry.label),
        el("span", { class: "gq-pal-option-sub" }, entry.sub)),
      entry.count ? el("span", { class: "gq-pal-option-count" }, entry.count.toLocaleString()) : null,
    );
    // mousedown, not click: a click blurs the search input first, and the focusout handler
    // would dismiss the palette before the pick landed.
    node.addEventListener("mousedown", (e) => { e.preventDefault(); choose(idx); });
    node.addEventListener("mousemove", () => { if (activeIndex !== idx) { activeIndex = idx; highlight(); } });
    return node;
  }

  function paint() {
    paintRail();
    if (drill) { paintDrill(); return; }
    const found = searchEntries(entries, query);
    shown = found === null ? entriesForTab(entries, tab) : found;
    listEl.textContent = "";
    rowNodes = [];
    if (loading && tab === "properties" && !shown.length) {
      listEl.append(el("li", { role: "presentation", class: "gq-pal-empty" },
        "Reading this kind's properties…"));
      activeIndex = 0;
      paintDetail(null);
      return;
    }
    if (!shown.length) {
      listEl.append(el("li", { role: "presentation", class: "gq-pal-empty" },
        query ? "No matches" : "Nothing to add from here"));
      activeIndex = 0;
      paintDetail(null);
      return;
    }
    // Section headers only where the list actually mixes kinds of thing — a flat search result
    // and a single-section tab both read better without one.
    let section = "";
    shown.forEach((entry, idx) => {
      if (entry.section !== section) {
        const mixed = shown.some((e) => e.section !== shown[0].section);
        if (mixed) {
          listEl.append(el("li", { role: "presentation", class: "gq-pal-section" },
            SECTION_LABELS[entry.section] || entry.section));
        }
        section = entry.section;
      }
      const node = rowFor(entry, idx);
      rowNodes.push(node);
      listEl.append(node);
    });
    activeIndex = Math.min(activeIndex, shown.length - 1);
    highlight();
  }

  function highlight() {
    rowNodes.forEach((node, i) => {
      const on = i === activeIndex;
      node.classList.toggle("is-active", on);
      node.setAttribute("aria-selected", on ? "true" : "false");
    });
    const active = rowNodes[activeIndex];
    search.setAttribute("aria-activedescendant", active ? active.id : "");
    if (active) active.scrollIntoView({ block: "nearest" });
    paintDetail(shown[activeIndex] || null);
  }

  function paintDetail(entry) {
    detailEl.textContent = "";
    if (!entry) {
      detailEl.append(el("p", { class: "muted small" },
        "Pick a relationship to add a step, or an operator to change how this one is read."));
      return;
    }
    detailEl.append(el("h3", { class: "gq-pal-detail-title" }, entry.detail.title));
    detailEl.append(el("p", { class: "gq-pal-detail-type" }, entry.detail.type));
    // Blank-line-separated paragraphs, kept as paragraphs. A shortcut's second paragraph is
    // usually the one saying what it deliberately does NOT do, which is the half worth reading.
    for (const para of String(entry.detail.blurb).split("\n\n")) {
      detailEl.append(el("p", { class: "gq-pal-detail-blurb" }, para));
    }
    if (entry.detail.literal) {
      detailEl.append(el("div", { class: "gq-pal-detail-lit" },
        el("span", { class: "label" }, "Adds"),
        el("code", {}, entry.detail.literal)));
    }
  }

  /**
   * One field's values, in place of the list — a drill-in rather than a second popover.
   *
   * The value control is `facetGroup` from filters.js, unchanged: it already draws proportion
   * bars, keeps a zero-yield option focusable-but-disabled rather than removing it, and
   * reconciles by value so focus survives a recount. A second value picker written here would
   * be a worse copy of a control this app has already got right.
   *
   * A text field gets an input and a `contains` match instead, because a list of every distinct
   * name is not a control — it is the table again.
   */
  function paintDrill() {
    listEl.textContent = "";
    rowNodes = [];
    activeIndex = 0;
    search.removeAttribute("aria-activedescendant");

    const back = el("button", {
      type: "button", class: "gq-pal-back",
      onclick: () => { drill = null; paint(); search.focus(); },
    }, uiIcon("chevron-left", 13), el("span", {}, "All properties"));
    listEl.append(el("li", { role: "presentation", class: "gq-pal-drill-head" },
      back, el("span", { class: "gq-pal-drill-title" }, drill.field.label)));

    const holder = el("li", { role: "presentation", class: "gq-pal-drill-body" });
    listEl.append(holder);

    if (drill.field.type === "text" || drill.field.type === "number") {
      const input = el("input", {
        type: "text", class: "gq-pal-text",
        "aria-label": drill.field.label + (drill.field.type === "text" ? " contains" : " equals"),
        placeholder: drill.field.type === "text" ? "contains…" : "exactly…",
        value: (drill.selected[0] || ""),
      });
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        const v = input.value.trim();
        commitProperty(v ? [v] : []);
      });
      holder.append(input, el("p", { class: "gq-pal-hint small muted" },
        drill.field.type === "text"
          ? "Press Enter to add. Matched as a substring, case ignored."
          : "Press Enter to add. Matched exactly."));
      // Focus the value field, not the search box — this pane IS the question now.
      setTimeout(() => input.focus(), 0);
      paintDetail(drill.entry);
      return;
    }

    const options = (drill.values || []).map((v) => ({
      value: v.value,
      label: v.value === "unknown" ? "Not reported" : v.value,
      count: v.count,
    }));
    if (!options.length) {
      holder.append(el("p", { class: "gq-pal-empty" },
        "No values to choose from — this estate reports none, or there are too many to list."));
      paintDetail(drill.entry);
      return;
    }
    const group = facetGroup({
      label: drill.field.label,
      noun: "node",
      onToggle: (value) => {
        const at = drill.selected.indexOf(value);
        const next = at === -1
          ? drill.selected.concat([value])
          : drill.selected.filter((v) => v !== value);
        commitProperty(next);
      },
    });
    group.update(options, drill.selected);
    holder.append(group.root);
    paintDetail(drill.entry);
  }

  /** Write the field's values onto this node, and close — the same contract every pick has. */
  function commitProperty(vals) {
    if (host) host.close(true);
    onPick({
      type: "property",
      key: drill.field.key,
      values: vals,
      op: drill.field.type === "text" ? "contains" : "eq",
    });
  }

  function choose(idx) {
    const entry = shown[idx];
    if (!entry) return;
    // A property is a question in two halves. Picking the field drills into its values rather
    // than committing something nobody has chosen a value for yet.
    if (entry.pick && entry.pick.type === "field") {
      const forField = (values || []).find((v) => v.key === entry.field.key);
      drill = {
        field: entry.field,
        entry,
        values: forField ? forField.values : [],
        selected: ((currentValues && currentValues(entry.field.key)) || []).slice(),
      };
      paint();
      return;
    }
    if (host) host.close(true);
    onPick(entry.pick);
  }

  function onSearchKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, Math.max(0, rowNodes.length - 1));
      highlight();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlight();
    } else if (e.key === "Home" && rowNodes.length) {
      e.preventDefault(); activeIndex = 0; highlight();
    } else if (e.key === "End" && rowNodes.length) {
      e.preventDefault(); activeIndex = rowNodes.length - 1; highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(activeIndex);
    }
  }
  search.addEventListener("keydown", onSearchKey);
  search.addEventListener("input", () => {
    query = search.value;
    activeIndex = 0;
    paint();
  });

  const panes = el("div", { class: "gq-pal-panes" }, railEl, listEl, detailEl);
  const body = el("div", { class: "gq-pal" },
    el("div", { class: "gq-pal-head" },
      el("div", { class: "gq-pal-field" },
        el("span", { class: "gq-pal-search-icon" }, uiIcon("search", 14)),
        search)),
    panes);

  railButtons();
  paint();

  const heading = title || ("Add to " + kindLabel(kind));

  if (window.matchMedia && window.matchMedia(NARROW_PALETTE).matches) {
    // The same modal fallback the filter panel takes below 800px: three panes do not fit, and a
    // popover pinned to a `+` on a wrapped builder row would cover the row it belongs to.
    const sheet = openSheet((sheetBody) => sheetBody.append(body), {
      title: heading,
      width: "min(460px, 94vw)",
      autoFocus: false,
      onClose: () => { host = null; },
    });
    host = { close: () => sheet.close() };
    search.focus();
    return host;
  }

  host = openPopover({
    anchor,
    className: "gq-pal-pop",
    ariaLabel: heading,
    position: { width: 620, minWidth: 620, maxHeight: 420, minHeight: 260, flipBelow: 300,
      onRoom: (room) => {
        panes.style.height = Math.max(240, room) + "px";
      } },
    build: () => body,
    onClose: () => { host = null; },
  });
  search.focus();
  return host;
}
