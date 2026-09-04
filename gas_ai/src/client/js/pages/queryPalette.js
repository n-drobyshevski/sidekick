// The palette: everything a query step can be, in one searchable place.
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
// THREE MODES, one control. The builder used to carry a second, weaker editing model beside
// this one: a caret dropdown on the relationship and another on the entity beside it. They were
// a worse answer to a question this file already answers correctly — a relationship and its
// target are ONE choice, and every `relations` entry below is one (edge, direction, target)
// triple. Split back into two dropdowns, picking a relationship whose target did not match
// silently rewrote the entity chip, and most entity dropdowns opened on a menu of one. So the
// dropdowns are gone and the palette does all three jobs:
//
//   "add"      the `+` — relationships, operators, properties, shortcuts. Appends.
//   "replace"  the THAT row's term pill — relationships only. Swaps this step.
//   "entity"   the FIND row's entity chip — node kinds only. Swaps what is being looked for.
//
// The mode decides only WHAT IS OFFERED. What a pick DOES is the caller's business: the payloads
// are identical in every mode, and this file still knows nothing about the query tree.
//
// PURE / DOM SPLIT. `paletteEntries` is a plain function of plain values, and the rest of the
// file paints what it returns. Vitest here runs in node with no jsdom (see graphChips.test.js
// for why one is not being added), so that split is the difference between the entry model
// being tested and not being tested at all.

import { el, openPopover, openSheet, uiIcon } from "../ui.js";
import {
  CATEGORY_LABELS, CATEGORY_ORDER, categoryOf, edgeLabel, kindIconSvg, kindLabel,
} from "../../../../../gas_shared/icons.js";
import { filterEditor } from "./filterEditor.js";
import { findEntry } from "../helpContent.js";
import { canNegate, serializeQuery, serializeStep } from "./graphQuery.js";

/** Below this the popover is unusable at three panes wide; it becomes a modal sheet instead. */
const NARROW_PALETTE = "(max-width: 800px)";

/** Per-mode copy. The palette does three jobs, and a control that names the wrong one is a
 *  control the reader has to open to understand. */
const SEARCH_LABELS = {
  add: "Search relationships and operators",
  replace: "Search relationships",
  entity: "Search entity types",
};
const EMPTY_LABELS = {
  add: "Nothing to add from here",
  replace: "No relationship leaves this entity",
  entity: "No entity types in this graph",
};
const LIST_LABELS = {
  add: "Add to the query",
  replace: "Change this relationship",
  entity: "Choose what to find",
};
/** What the detail pane's literal block promises — the verb has to match the mode's effect. */
const LITERAL_VERBS = { add: "Adds", replace: "Becomes", entity: "Finds" };
const PROMPTS = {
  add: "Pick a relationship to add a step, or an operator to change how this one is read.",
  replace: "Pick the relationship this step should follow, and where it lands.",
  entity: "Pick the kind of thing this query looks for.",
};

const SECTION_LABELS = {
  popular: "Popular",
  shortcuts: "Query shortcuts",
  operators: "Operators",
  properties: "Properties",
  relations: "Relationships",
  entities: "Entities",
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
  choice: "Pick from the values this landscape actually holds — the list is the graph's, not the "
    + "schema's, and each value says how many nodes carry it.",
  boolean: "Three states, not two: yes, no, and unknown. Wiz not reporting a property is a "
    + "different answer from reporting it false, and the filter keeps them apart.",
  number: "Matched exactly. A range comparison is not offered yet — where a band is the useful "
    + "question, there is usually a choice field beside this one that asks it better.",
};

/** How many relationships the Popular section leads with before you go to a category. */
const POPULAR_RELATIONS = 6;

/** The same, for entity kinds — the commonest in the landscape, since the vocabulary has no other
 *  ranking to offer and alphabetical would just promote whatever begins with A. */
const POPULAR_KINDS = 6;

// ------------------------------------------------------------------------- the entry model

/**
 * Everything this palette can offer, given where it was opened from.
 *
 *   kind   the node the palette hangs off — whose relationships and properties are on offer.
 *          In "replace" that is the step's PARENT, not its target: the question is what this
 *          hop can be, and a hop's options come from where it starts.
 *   vocab  {kinds, stepsFrom} as the server derived it from this tenant's graph
 *   row    the builder row the palette belongs to, or null for a bare list
 *   mode   "add" (default) | "replace" | "entity" — see the header
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
 *   {type: "kind", kind}                              this node IS that kind — entity mode
 *
 * A `field` pick never reaches the caller — it drills into that field's values inside the
 * palette, and what comes back is the `property` above. A property with no value chosen would
 * be a filter nobody asked for.
 *
 * `relation` is emitted identically in "add" and "replace"; the caller appends it in one and
 * swaps it in for the current step in the other. Keeping the payload the same in both is what
 * lets this file stay ignorant of the tree.
 */
/** Intersect the field lists and union the value lists of several kinds. See `ensureFields`. */
export function mergeVocab(parts) {
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  const valuesIn = (p, key) => {
    const hit = ((p && p.values) || []).find((v) => v.key === key);
    return (hit && hit.values) || [];
  };
  const fields = ((parts[0] && parts[0].fields) || []).filter((f) =>
    parts.every((p) => ((p && p.fields) || []).some((g) => g.key === f.key)));
  const values = fields.map((f) => {
    const counts = new Map();
    for (const p of parts) {
      for (const v of valuesIn(p, f.key)) {
        counts.set(v.value, (counts.get(v.value) || 0) + (v.count || 0));
      }
    }
    return { key: f.key, values: [...counts].map(([value, count]) => ({ value, count })) };
  });
  return { fields, values };
}

/** A palette's source kinds, always as a list — the caller may pass one or several. */
export function kindList(kind) {
  if (Array.isArray(kind)) return kind.length ? kind : ["ANY"];
  return [kind || "ANY"];
}

/**
 * The relationships reachable from ANY of these kinds — the UNION, counts added up.
 *
 * Deduped by (edge, direction, target), which is the same identity the server builds
 * `stepsFrom` with, so two kinds that share a relationship offer it once with the combined
 * count rather than twice. Ordered commonest-first over the merged set, because "commonest"
 * is a fact about the selection and not about whichever kind happened to be picked first.
 *
 * Union rather than intersection: a step only some of the selected kinds can take is still a
 * real question about those, and the count beside it says how many nodes it will find. The
 * intersection would go empty fast for kinds with little in common and read as "nothing here".
 */
export function stepsFromKinds(vocab, kinds) {
  const from = (vocab || {}).stepsFrom || {};
  if (kinds.length === 1) return from[kinds[0]] || [];
  const merged = new Map();
  for (const k of kinds) {
    for (const e of (from[k] || [])) {
      const id = e.edge + "|" + (e.reverse ? "r" : "f") + "|" + e.kind;
      const hit = merged.get(id);
      if (hit) hit.count += e.count || 0;
      else merged.set(id, { edge: e.edge, reverse: e.reverse, kind: e.kind, count: e.count || 0 });
    }
  }
  return [...merged.values()].sort((a, b) => b.count - a.count);
}

export function paletteEntries(ctx) {
  const { kind, vocab, row } = ctx || {};
  const mode = (ctx && ctx.mode) || "add";
  const from = kindList(kind);
  const steps = stepsFromKinds(vocab, from);
  const out = [];

  // ------------------------------------------------------------------ entities
  // What to look FOR, rather than where to go next. Only the kinds this tenant's graph actually
  // holds, in the vocabulary's declaration order so the picker reads the way the legend does —
  // and each one says how many there are, so an empty corner of the landscape is visible before
  // you build a query around it.
  if (mode === "entity") {
    const kinds = ((vocab || {}).kinds || []);
    const popular = new Set(
      [...kinds].sort((a, b) => b.count - a.count).slice(0, POPULAR_KINDS).map((k) => k.kind),
    );
    for (const entry of kinds) {
      out.push({
        id: "kind-" + entry.kind,
        section: "entities",
        category: categoryOf(entry.kind),
        glyph: null,
        targetKind: entry.kind,
        label: kindLabel(entry.kind),
        // The CATEGORY, not the tally — `rowFor` already prints the count down the right-hand
        // edge, and a row reading "Bucket / 19 nodes … 19" says one thing twice and the useful
        // thing not at all. The category is what tells two similarly-named kinds apart, and it
        // names the rail tab this row also lives under.
        sub: CATEGORY_LABELS[categoryOf(entry.kind)] || "",
        count: entry.count,
        popular: popular.has(entry.kind),
        detail: {
          title: kindLabel(entry.kind),
          type: "Entity",
          blurb: kindBlurb(entry.kind, entry.count),
          // What the `find=` param carries for a root, produced by the real serializer.
          literal: serializeQuery({ kind: entry.kind }),
        },
        pick: { type: "kind", kind: entry.kind },
      });
    }
    // The wildcard is not in the vocabulary — it is every kind at once — and it is the honest
    // starting point for "show me everything that ...", so it is always offered and always
    // near the top.
    out.push({
      id: "kind-ANY",
      section: "entities",
      category: null,
      glyph: "graph",
      targetKind: "ANY",
      label: "Any node",
      sub: "every kind in the graph",
      count: null,
      popular: true,
      detail: {
        title: "Any node",
        type: "Entity",
        blurb: "Matches every node this tenant's graph holds, whatever its kind. Useful as the "
          + "far end of a relationship — “what does this agent reach?” — and as a starting "
          + "point when the question is about a property rather than a type. It is the widest "
          + "possible match, so expect to narrow it with a filter or a relationship.",
        literal: serializeQuery({ kind: "ANY" }),
      },
      pick: { type: "kind", kind: "ANY" },
    });
    return out;
  }

  // ------------------------------------------------------------------ shortcuts
  // Curated questions, defined in the DOMAIN so a test can hold each to the model, and shipped
  // with `kinds` already narrowed to what this tenant's graph can answer — see QUERY_SHORTCUTS.
  // They lead the Popular tab because they are the fastest route from "open the page" to a
  // question worth asking.
  //
  // ADD ONLY, like the properties and operators below. A shortcut expands into several steps
  // and a replace has one step to give it, so offering one here would either drop the rest or
  // quietly rewrite the row into something the reader did not ask for.
  for (const s of (mode === "add" ? ((vocab || {}).shortcuts || []) : [])) {
    // Offered when ANY of the kinds can answer it — the same union the relationships take.
    // A shortcut only some of them can answer is still a real question about those; the step it
    // appends will drop the rest, which is what a required step does and what the count says.
    if (!from.some((k) => (s.kinds || []).includes(k))) continue;
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
  //
  // A hop step can also name where it LANDS: `ANY2.BUCKET` is "a bucket somewhere within two
  // hops", a query this DSL has carried since it was written down and the retired dropdowns
  // could build (their target picker went wide for any ANY edge). The `+` never offered it and
  // still does not — from there nothing has been chosen to keep. But a REPLACE starts from a
  // step that already names a target, and loosening a relationship without losing what it was
  // aimed at is the whole reason someone reaches for this row. Offering only ANY→ANY here
  // would quietly retire a documented query.
  const hopTargets = (mode === "replace" && row && row.kind && row.kind !== "ANY")
    ? ["ANY", row.kind]
    : ["ANY"];
  for (const hops of [1, 2, 3]) {
    for (const target of hopTargets) {
      const wide = target === "ANY";
      const reach = hops === 1 ? "one hop out" : "up to " + hops + " hops out";
      out.push({
        id: "rel-any-" + hops + (wide ? "" : "-" + target),
        section: "relations",
        category: wide ? null : categoryOf(target),
        glyph: "graph",
        targetKind: target,
        label: wide
          ? (hops === 1 ? "Any node" : "Any node, " + hops + " hops out")
          : kindLabel(target),
        sub: "is related to" + (hops > 1 ? ", within " + hops + " hops" : ""),
        count: null,
        popular: hops === 1 && wide,
        detail: {
          title: wide
            ? (hops === 1 ? "Any related node" : "Any node within " + hops + " hops")
            : kindLabel(target) + " within " + hops + (hops === 1 ? " hop" : " hops"),
          type: "Relationship",
          blurb: "Follows every relationship this tenant's graph holds, in either direction, "
            + reach
            + (wide
              ? ". The neighbourhood question, for when no single named relationship is the one "
                + "you mean. More hops reach further and match more loosely."
              : ", and keeps only the " + kindLabel(target) + " nodes it reaches. The "
                + "neighbourhood question aimed at one kind — for when you know WHAT you are "
                + "looking for but not which relationship gets you there."),
          literal: literalFor({ type: "relation", edge: "ANY", reverse: false, hops, target }),
        },
        pick: { type: "relation", edge: "ANY", reverse: false, hops, target },
      });
    }
  }

  // ------------------------------------------------------------------ properties
  // Filled once the per-kind field list has arrived — the palette asks for it when the tab is
  // first opened rather than dragging every kind's fields into the bootstrap payload.
  // A property NARROWS a node rather than replacing a step, so it belongs to the `+`.
  for (const f of (mode === "add" ? (ctx.fields || []) : [])) {
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
  // The `+`'s alone. A term pill answers one question — what relationship is this — and the whole
  // point of routing it here was to stop one control quietly doing another's job.
  if (mode !== "add") return out;

  // THE TWO BLOCK ENTRIES ARE GONE. "Either of — OR" appended a group seeded with two BRAND-NEW
  // relationships, which is not the thing anyone wants when they want an OR: what they want is to
  // make two conditions already on screen into alternatives. The keyword pill does that now, on
  // the row it describes. Leaving these here would be the second editing model this bar just
  // shed, in a different costume — and the AND block was the weaker half anyway, since an `and`
  // group cross-products exactly the way plain sibling steps already do.
  //
  // `stepForPick` keeps its `group` branch: a block from an older shared link still has to render,
  // and a hand-edited one still has to parse.

  // Negate and optional modify the step the `+` hangs off, so they are only on offer when there
  // IS one — the FIND root is a starting point, not a relationship, and neither flag means
  // anything on it. Both read as their own undo when already set: one entry, two directions.
  if (row && row.path && row.path.length) {
    const named = row.group
      ? (row.op === "or" ? "this OR block" : "this AND block")
      : "this relationship";
    // Offered only where the domain would accept it. `validateQuery` refuses a negated step that
    // carries further steps and one that is also optional; this palette used to offer NOT on any
    // relationship at all, so negating a row with a hop under it built a query the server threw
    // on and the page reported as a load failure — for something the builder had just offered.
    if (canNegate(row) || row.negate) {
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

/**
 * The rail: the fixed tabs, then one per category that actually has something under it.
 *
 * `mode` matches the one `paletteEntries` was given. Only the Properties tab needs it: that tab
 * is drawn BEFORE its list has been fetched, so it cannot be inferred from the entries the way
 * every other tab can, and outside "add" it would promise a list that will never arrive.
 */
export function paletteRail(entries, mode) {
  const rail = [
    { key: "popular", label: SECTION_LABELS.popular, count: entries.filter((e) => e.popular).length },
  ];
  const shortcuts = entries.filter((e) => e.section === "shortcuts").length;
  if (shortcuts) rail.push({ key: "shortcuts", label: SECTION_LABELS.shortcuts, count: shortcuts });
  const operators = entries.filter((e) => e.section === "operators").length;
  if (operators) {
    rail.push({ key: "operators", label: SECTION_LABELS.operators, count: operators });
  }
  // Always present in "add", even before the field list has landed — a tab that appears a beat
  // after the palette opens is a tab nobody finds. Its count fills in when the fetch answers.
  if ((mode || "add") === "add") {
    rail.push({
      key: "properties",
      label: SECTION_LABELS.properties,
      count: entries.filter((e) => e.section === "properties").length,
    });
  }
  for (const cat of CATEGORY_ORDER) {
    const n = entries.filter((e) => e.category === cat).length;
    // Ours has five categories where the reference has twelve. Showing an empty one anyway
    // would be theatre — a tab that promises relationships this kind does not have.
    if (n) rail.push({ key: "cat-" + cat, label: CATEGORY_LABELS[cat], count: n, category: cat });
  }
  const loose = entries.filter(isLoose).length;
  if (loose) rail.push({ key: "cat-any", label: "Any node", count: loose, category: null, loose: true });
  return rail;
}

/** An entry no category claims: the hop wildcards, and the "Any node" entity beside them. */
function isLoose(entry) {
  return !entry.category && (entry.section === "relations" || entry.section === "entities");
}

/** Which entries a rail tab shows, in the order they were derived (commonest first). */
export function entriesForTab(entries, tabKey) {
  if (tabKey === "popular") return entries.filter((e) => e.popular);
  if (tabKey === "shortcuts") return entries.filter((e) => e.section === "shortcuts");
  if (tabKey === "operators") return entries.filter((e) => e.section === "operators");
  if (tabKey === "properties") return entries.filter((e) => e.section === "properties");
  if (tabKey === "cat-any") return entries.filter(isLoose);
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
  if (pick.type === "kind") return serializeQuery({ kind: pick.kind });
  return serializeStep(stepForPick(pick));
}

/**
 * Which entry a row's CURRENT choice is, so the palette can open on it rather than at the top
 * of a list the reader has to search for what the row already says.
 *
 * The id scheme lives here, beside the ids `paletteEntries` mints, and nowhere else. Spelled out
 * a second time at the call site it would drift the first time an id gained a segment, and the
 * failure would be silent: a palette that opens on the wrong row still works, so nothing would
 * report it. `test/queryPalette.test.js` holds this to an id `paletteEntries` actually produces.
 */
export function currentEntryId(mode, row) {
  if (!row) return "";
  const kinds = (row.kinds && row.kinds.length) ? row.kinds : [row.kind || "ANY"];
  // Entity mode marks EVERY selected kind (see `selected`); this is only the one the panel
  // opens on, so the first is as good an anchor as any.
  if (mode === "entity") return "kind-" + kinds[0];
  if (!row.edge) return "";
  // A step naming several target kinds is not any one of the (edge, direction, target) triples
  // the list offers, so nothing is current — better than ticking whichever sorted first.
  if (kinds.length > 1) return "";
  if (row.edge === "ANY") {
    // A hop step that names where it lands has its target in the id, the same way a named
    // relationship does — `ANY2.BUCKET` and `ANY2.ANY` are two different questions.
    const wide = kinds[0] === "ANY";
    return "rel-any-" + (row.hops || 1) + (wide ? "" : "-" + kinds[0]);
  }
  return "rel-" + (row.reverse ? "in-" : "out-") + row.edge + "-" + kinds[0];
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

/** Kinds whose meaning the help book already explains, in the app's own words. */
const HELP_FOR_KIND = {
  MISSING_GUARDRAIL: "missing-guardrail",
  SENSITIVE_DATA: "sensitive-data",
  INTERNET_EXPOSURE: "internet-exposure",
  EXCESSIVE_PRIVILEGE: "excessive-privilege",
  SERVICE_ACCOUNT: "agentic-identity",
  DATA_FINDING: "data-finding",
};

/**
 * What an entity kind is, for the entity palette's detail pane.
 *
 * The TALLY leads, because it is the half that is about this landscape rather than about the model:
 * a kind the graph holds four of is a different proposition from one it holds four hundred of,
 * and a kind it holds none of is a query that will answer nothing. Then the help book's prose
 * where it has an entry — the same words the `?` tips and the Reference page carry, so the
 * palette teaches the app's vocabulary rather than a second one written here.
 */
function kindBlurb(kind, count) {
  const label = kindLabel(kind);
  const tally = count
    ? count.toLocaleString() + " " + label + (count === 1 ? " node" : " nodes") + " in this tenant."
    : "No " + label + " nodes in this tenant — a query starting here will answer nothing.";
  const help = findEntry(HELP_FOR_KIND[kind] || "");
  return tally + (help ? " " + help.blurb : "");
}

// ------------------------------------------------------------------------- the palette

let _paletteSeq = 0;

/**
 * Open the palette against `anchor`. `onPick(pick)` receives one of the payloads above.
 *
 * Returns the popover handle (or the sheet's, on a narrow viewport) so a caller can close it.
 *
 * `spec.mode` picks what is offered — "add" (default), "replace" or "entity". `spec.currentId`
 * names the entry the row already holds, from `currentEntryId`: the palette opens on ITS tab
 * with it highlighted and marked, so a control that edits an existing choice starts at that
 * choice rather than making the reader find it again.
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
  const {
    anchor, kind, vocab, row, onPick, title, loadFields, currentFilter, currentId,
  } = spec;
  /**
   * Called once, whichever way the panel goes.
   *
   * Entity mode's toggles commit WITHOUT moving focus — a focus change out of the search field
   * would dismiss the panel mid-selection — so the caller has nowhere to put focus until the
   * panel is gone. `close(true)` returns it to the anchor, but a caller that rebuilt itself on
   * commit no longer has that anchor in the document; this is how it gets focus back.
   */
  const onClose = spec.onClose || null;
  /**
   * Entity mode only: the kinds this row already looks for, which the list shows as pressed.
   * Held here rather than re-derived, because the panel STAYS OPEN across toggles and each
   * one has to see the result of the last.
   */
  let selected = (spec.selected || []).slice();
  const mode = spec.mode || "add";
  const seq = ++_paletteSeq;
  const listId = "gq-palette-list-" + seq;
  let fields = null;    // per-kind field list, once fetched
  let values = null;    // per-kind value lists, once fetched
  let entries = paletteEntries({ kind, vocab, row, fields, mode });
  let rail = paletteRail(entries, mode);

  // The tab holding the row's current choice, so an edit starts where the row already is.
  // Popular is preferred where it has it, because that is the tab a fresh palette would open on
  // anyway — landing in a category tab when the entry is also two rows up in Popular would make
  // the palette look like it opened somewhere unrelated.
  const startTab = rail.find((t) => entriesForTab(entries, t.key).some((e) => e.id === currentId));
  let tab = (startTab && startTab.key) || (rail[0] ? rail[0].key : "popular");
  let query = "";
  let shown = [];
  let activeIndex = 0;
  let rowNodes = [];
  let host = null;      // {close} — the popover or the sheet
  /** Non-null while drilled into one field's values. */
  let drill = null;
  let loading = false;
  /** Consumed by the first paint: put the cursor on what the row already holds. */
  let seekCurrent = !!currentId;

  const search = el("input", {
    type: "text",
    class: "gq-pal-search",
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": listId,
    "aria-autocomplete": "list",
    "aria-label": SEARCH_LABELS[mode] || SEARCH_LABELS.add,
    placeholder: "Search…",
    autocomplete: "off",
    spellcheck: "false",
  });
  const listEl = el("ul", {
    id: listId, class: "gq-pal-list", role: "listbox",
    "aria-label": LIST_LABELS[mode] || LIST_LABELS.add,
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
   *
   * Several kinds ask for each and INTERSECT the fields while UNIONING their values: a property
   * only some of them carry would read as narrowing and actually exclude the rest, since a node
   * that cannot answer a field matches only "unknown". Where a field IS common, every kind's
   * values belong in the list with the counts added, because the count is how many nodes the
   * option would still leave and the row is asking about all of them.
   */
  function ensureFields() {
    if (fields || loading || !loadFields) return;
    loading = true;
    paint();
    Promise.all(kindList(kind).map((k) => Promise.resolve(loadFields(k)).catch(() => null)))
      .then((parts) => {
      const got = mergeVocab(parts.filter(Boolean));
      loading = false;
      if (!got || !host) return;
      fields = got.fields || [];
      values = got.values || [];
      entries = paletteEntries({ kind, vocab, row, fields, mode });
      // The rail is built once, so only its counts change — the Properties tab was already
      // there, promising a list it could not yet draw.
      rail = paletteRail(entries, mode);
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
    // What the row ALREADY says, in a palette opened to change it. `aria-selected` is spoken for
    // — it carries the keyboard cursor in this listbox — so the state travels as `aria-current`,
    // and a tick renders beside it so it is never the tinted ground alone saying so.
    const isCurrent = !!currentId && entry.id === currentId;
    // Entity rows TOGGLE — a node can look for several kinds — so they carry pressed state as
    // well. `aria-selected` is the keyboard cursor in this listbox and `aria-current` is "what
    // the row opened on", so neither is free; `aria-pressed` is the one that means "chosen".
    const togglable = isToggle(entry);
    const on = togglable && selected.indexOf(entry.pick.kind) !== -1;
    const node = el("li", {
      id: optId, role: "option",
      class: "gq-pal-option" + (isCurrent ? " is-current" : "") + (on ? " is-on" : ""),
      "aria-selected": "false",
      "aria-current": isCurrent ? "true" : null,
      "aria-pressed": togglable ? String(on) : null,
      "data-category": entry.category || null,
    },
      el("span", { class: "gq-pal-glyph-wrap" }, glyph),
      el("span", { class: "gq-pal-option-text" },
        el("span", { class: "gq-pal-option-label" }, entry.label),
        el("span", { class: "gq-pal-option-sub" }, entry.sub)),
      (togglable ? on : isCurrent)
        ? el("span", { class: "gq-pal-option-current" },
          uiIcon("check", 13),
          el("span", { class: "sr-only" }, "Currently selected"))
        : null,
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
        query ? "No matches" : (EMPTY_LABELS[mode] || EMPTY_LABELS.add)));
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
    // ONCE, on the way in. After that the cursor belongs to whoever is driving it — snapping it
    // back to the current choice on every tab change or keystroke would make the list unusable.
    if (seekCurrent) {
      seekCurrent = false;
      const at = shown.findIndex((e) => e.id === currentId);
      if (at >= 0) activeIndex = at;
    }
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
      detailEl.append(el("p", { class: "muted small" }, PROMPTS[mode] || PROMPTS.add));
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
      // The verb has to match what the pick will DO. This pane exists so a reader can see the
      // effect before causing it, and "Adds AI_AGENT" over a control that replaces the root
      // would be the pane describing a different palette.
      detailEl.append(el("div", { class: "gq-pal-detail-lit" },
        el("span", { class: "label" }, LITERAL_VERBS[mode] || LITERAL_VERBS.add),
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

    // The control itself lives in filterEditor.js, because the WHERE chip on a builder row opens
    // the same question and the two must not drift. This pane is only its frame — which is the
    // point of keeping it a drill-in rather than a second popover, per the note above.
    const editor = filterEditor({
      field: drill.field,
      filter: { values: drill.selected, ...(drill.op || {}) },
      values: drill.values,
      onChange: (next) => {
        drill.selected = next.values;
        drill.op = { op: next.op, all: next.all, negate: next.negate };
        commitProperty(next);
      },
    });
    holder.append(editor.root);
    // Focus the value control, not the search box — this pane IS the question now.
    setTimeout(() => editor.focus(), 0);
    paintDetail(drill.entry);
  }

  /**
   * Write the reading onto this node, and close — the same contract every pick has.
   *
   * It closes on the first committed change, which is what every other pick in this palette does.
   * Reopening lands on the chip's own editor, where an operator and several values can be worked
   * through without the panel disappearing between them.
   */
  function commitProperty(next) {
    if (host) host.close(true);
    onPick({
      type: "property",
      key: drill.field.key,
      values: next.values,
      op: next.op,
      all: next.all,
      negate: next.negate,
    });
  }

  function choose(idx) {
    const entry = shown[idx];
    if (!entry) return;
    // A property is a question in two halves. Picking the field drills into its values rather
    // than committing something nobody has chosen a value for yet.
    if (entry.pick && entry.pick.type === "field") {
      const forField = (values || []).find((v) => v.key === entry.field.key);
      // Seeded from the filter already on this node, operator included, so reopening a field
      // shows what it currently says rather than an empty control over a filter plainly on the
      // row — and so changing one value cannot silently reset the reading to the default.
      const held = (currentFilter && currentFilter(entry.field.key)) || null;
      drill = {
        field: entry.field,
        entry,
        values: forField ? forField.values : [],
        selected: ((held && held.values) || []).slice(),
        op: held ? { op: held.op, all: held.all, negate: held.negate } : null,
      };
      paint();
      return;
    }
    // A kind TOGGLES and the panel stays open, because picking several is the point and a panel
    // that closed after the first would make the second a fresh trip. Every toggle still commits
    // straight through — live-apply, like every other control on this page.
    //
    // The rows that CHANGED are repainted in place; the panel is never rebuilt. `paint()` would
    // replace the search input, and detaching the focused element fires `focusout` — one of the
    // seven ways popoverDismiss closes — so the palette would shut itself on the first toggle.
    if (isToggle(entry)) {
      const before = selected;
      const at = before.indexOf(entry.pick.kind);
      // Never down to nothing — a node has to look for something, and "no kinds" is not a query.
      if (at !== -1 && before.length === 1) return;
      let next = at === -1 ? before.concat([entry.pick.kind]) : before.filter((k, i) => i !== at);
      // ANY is the union of everything, so it cannot be one of several.
      if (entry.pick.kind === "ANY") next = ["ANY"];
      else next = next.filter((k) => k !== "ANY");
      // IN THE LIST'S OWN ORDER, never in click order. The joined kinds are a node's IDENTITY on
      // both sides of the wire and the key its column preferences are stored under, and the
      // server keeps the order it is sent (`readKinds` says why) — so ordering the selection here
      // is what makes one selection one URL however it was assembled.
      const order = kindOrder();
      next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      selected = next;
      // Not just the row that was clicked. Turning ANY on clears every other kind, and turning a
      // kind on clears ANY — so the rows that lost their tick have to lose it on screen too.
      const flipped = (k) => (before.indexOf(k) !== -1) !== (selected.indexOf(k) !== -1);
      shown.forEach((e, i) => {
        if (isToggle(e) && flipped(e.pick.kind)) repaintRow(i);
      });
      onPick({ type: "kinds", kinds: selected.slice() });
      return;
    }
    if (host) host.close(true);
    onPick(entry.pick);
  }

  /** An entity row in entity mode — the only thing in this palette that toggles. */
  function isToggle(entry) {
    return !!entry && !!entry.pick && entry.pick.type === "kind";
  }

  /**
   * Every kind the list offers, in the order it offers them.
   *
   * Read off the entries rather than the vocabulary so it cannot disagree with what is on screen,
   * and off `entries` rather than `shown` so a search that hides half the list does not reorder
   * the half still selected.
   */
  function kindOrder() {
    return entries.filter(isToggle).map((e) => e.pick.kind);
  }

  /** Swap one option for a freshly built one, leaving the rest of the list alone. */
  function repaintRow(idx) {
    const old = listEl.children[idx];
    if (!old) return;
    const next = rowFor(shown[idx], idx);
    old.replaceWith(next);
    highlight();
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

  const heading = title || (mode === "entity"
    ? "What to find"
    : mode === "replace" ? "Change this relationship" : "Add to " + kindLabel(kind));

  if (window.matchMedia && window.matchMedia(NARROW_PALETTE).matches) {
    // The same modal fallback the filter panel takes below 800px: three panes do not fit, and a
    // popover pinned to a `+` on a wrapped builder row would cover the row it belongs to.
    const sheet = openSheet((sheetBody) => sheetBody.append(body), {
      title: heading,
      width: "min(460px, 94vw)",
      autoFocus: false,
      onClose: () => { host = null; if (onClose) onClose(); },
    });
    host = { close: () => sheet.close() };
    search.focus();
    return host;
  }

  host = openPopover({
    anchor,
    className: "gq-pal-pop",
    ariaLabel: heading,
    // Three panes need room. At 620 the middle one — the list, the pane anyone actually reads —
    // was left ~218px after the rail and the detail took their fixed shares, which is where
    // "Excessive Rights" and "AI assets & comp…" ran out of line. `positionPopover` clamps to
    // the viewport, and below 800px this is a sheet anyway, so the wider box cannot overflow.
    position: { width: 780, minWidth: 780, maxHeight: 460, minHeight: 260, flipBelow: 300,
      onRoom: (room) => {
        panes.style.height = Math.max(240, room) + "px";
      } },
    build: () => body,
    onClose: () => { host = null; if (onClose) onClose(); },
  });
  search.focus();
  return host;
}
