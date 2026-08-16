// The Security Graph query, as URL state and as builder rows.
//
// Split out of graph.js for the reason graphChips.js was: it is the part of that page that is
// pure — plain values in, plain objects out — and therefore the part worth testing without a
// DOM (test/graphQueryDsl.test.js). The page turns these rows into buttons; nothing here knows
// what a button is.
//
// THE HASH DSL. Every other piece of this page's state is a hash param, so the query is too —
// a shared link has to carry the question, not just the page. The grammar uses only characters
// encodeURIComponent leaves alone, so the URL stays readable in a chat message:
//
//   find=AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)
//   find=AI_AGENT(!PROTECTED_BY.AI_GUARDRAIL)          "that is NOT protected by a guardrail"
//   find=SERVICE_ACCOUNT(~RUNS_AS.AI_AGENT)            the same edge, read backwards
//   find=AI_AGENT(*RUNS_AS.SERVICE_ACCOUNT)            optional: keep the row, null the group
//   find=AI_AGENT(RUNS_AS.!SERVICE_ACCOUNT)            hidden: traverse it, no columns
//   find=AI_AGENT(ANY2.BUCKET)                         "related within 2 hops" — the old depth
//   find=AI_AGENT(RUNS_AS.SERVICE_ACCOUNT'HOSTED_ON.SERVERLESS)     two steps off one node
//   find=AI_AGENT(OR(RUNS_AS.SERVICE_ACCOUNT'!PROTECTED_BY.AI_GUARDRAIL))   either one
//   find=AI_AGENT(USES_MODEL.AI_MODEL'OR(A.X'B.Y))                  one AND, then either
//
// Property filters ride in a separate `where` param rather than inside the tree, because they
// are the half that changes most (every click in the filter panel) and nesting them would make
// the structure unreadable at exactly the moment someone is trying to read it:
//
//   where=0.cloud.GCP,0.severity.CRITICAL,1.inactive.true
//   where=0.name~prod          the separator IS the operator: `.` equals, `~` contains
//
// The leading number is the node's PRE-ORDER INDEX over every traversed node — the same walk
// the domain evaluator uses for its binding slots, so index 1 means the same node on both
// sides of the wire.
//
// A malformed query is not a crash. `parseQuery` throws, and the page falls back to the default
// lens and says so — a hand-edited or truncated link must not leave a blank workbench.

// ------------------------------------------------------------------------- the tree

/** The default lens: the same AI-agent view a fresh visit has always opened on. */
export function defaultQuery() {
  return { kind: "AI_AGENT" };
}

const SEP_SIBLING = "'";
const SEP_EDGE = ".";
const TOKEN = /^[A-Z0-9_]+$/;

/**
 * `AI_AGENT(RUNS_AS.SERVICE_ACCOUNT)` → the tree the server evaluates.
 *
 * Throws on anything it cannot read. The caller decides what to do about it; the page shows the
 * default query and a note rather than an empty canvas.
 */
export function parseQuery(text) {
  const s = String(text || "").trim();
  if (!s) return defaultQuery();
  const cursor = { s, i: 0 };
  const node = readNode(cursor);
  if (cursor.i !== s.length) throw new Error("unexpected text at position " + cursor.i);
  return node;
}

function readNode(c) {
  let hidden = false;
  if (c.s[c.i] === "!") {
    hidden = true;
    c.i++;
  }
  const kind = readToken(c);
  const node = { kind };
  if (hidden) node.show = false;
  if (c.s[c.i] === "(") {
    c.i++;
    const steps = [];
    for (;;) {
      steps.push(readStep(c));
      if (c.s[c.i] === SEP_SIBLING) {
        c.i++;
        continue;
      }
      break;
    }
    if (c.s[c.i] !== ")") throw new Error("unclosed relationship list");
    c.i++;
    node.steps = steps;
  }
  return node;
}

function readStep(c) {
  const step = {};
  // Flags are a prefix set, order-free, so a hand-written "~*RUNS_AS" reads the same as
  // "*~RUNS_AS" and neither is a parse error worth explaining to anyone.
  for (;;) {
    const ch = c.s[c.i];
    if (ch === "!") { step.negate = true; c.i++; continue; }
    if (ch === "~") { step.reverse = true; c.i++; continue; }
    if (ch === "*") { step.optional = true; c.i++; continue; }
    break;
  }
  let edge = readToken(c);
  // A boolean block, not a relationship. `OR` and `AND` are safe as reserved words because no
  // EDGE_TYPES member is named either, and the two are told apart by what follows: a group is
  // followed by "(", a relationship by ".". Only `optional` is meaningful on a group — negating
  // or reversing punctuation means nothing.
  if ((edge === "OR" || edge === "AND") && c.s[c.i] === "(") {
    if (step.negate || step.reverse) throw new Error(edge + " takes no ! or ~ flag");
    c.i++;
    const group = { op: edge.toLowerCase(), steps: [] };
    if (step.optional) group.optional = true;
    for (;;) {
      group.steps.push(readStep(c));
      if (c.s[c.i] === SEP_SIBLING) { c.i++; continue; }
      break;
    }
    if (c.s[c.i] !== ")") throw new Error("unclosed " + edge + " group");
    c.i++;
    return group;
  }
  // ANY carries its hop count glued to the token — ANY2 — so the grammar needs no extra
  // separator for the one step type that takes an argument.
  const hops = edge.match(/^ANY([0-9]*)$/);
  if (hops) {
    edge = "ANY";
    step.hops = hops[1] ? Number(hops[1]) : 1;
  }
  step.edge = edge;
  if (c.s[c.i] !== SEP_EDGE) throw new Error("relationship " + edge + " names no target");
  c.i++;
  step.node = readNode(c);
  return step;
}

function readToken(c) {
  let j = c.i;
  while (j < c.s.length && /[A-Z0-9_]/.test(c.s[j])) j++;
  const tok = c.s.slice(c.i, j);
  if (!tok || !TOKEN.test(tok)) throw new Error("expected a name at position " + c.i);
  c.i = j;
  return tok;
}

/** The inverse. Round-trips: parseQuery(serializeQuery(q)) deep-equals q. */
export function serializeQuery(node) {
  let out = (node.show === false ? "!" : "") + node.kind;
  const steps = node.steps || [];
  if (steps.length) {
    out += "(" + steps.map(serializeStep).join(SEP_SIBLING) + ")";
  }
  return out;
}

/** One step as DSL text. Exported so the palette can PRINT what a pick will insert. */
export function serializeStep(step) {
  if (isGroup(step)) {
    return (step.optional ? "*" : "") + step.op.toUpperCase()
      + "(" + step.steps.map(serializeStep).join(SEP_SIBLING) + ")";
  }
  let out = "";
  if (step.negate) out += "!";
  if (step.reverse) out += "~";
  if (step.optional) out += "*";
  out += step.edge === "ANY" ? "ANY" + (step.hops && step.hops > 1 ? String(step.hops) : "") : step.edge;
  return out + SEP_EDGE + serializeQuery(step.node);
}

/** A step is a boolean block rather than a hop. Mirrors `isGroup` in the domain module. */
export function isGroup(step) {
  return !!step && step.op !== undefined;
}

// ------------------------------------------------------------------------- where

/**
 * `0.cloud.GCP,0.cloud.AWS,1.inactive.true,0.name~prod` → per-node filters, keyed by pre-order
 * index. The value is `{values, op}`; repeating a (node, key) pair ORs its values, which is how
 * the filter panel's multi-select dimensions already behave everywhere else in this app.
 *
 * THE SEPARATOR BEFORE THE VALUE IS THE OPERATOR. `.` is whole-value equality; `~` is a
 * substring, which is the only useful reading of a filter on a name — "prod" should find
 * "prod-agent-01". It has to be in the grammar rather than inferred from the field's type,
 * because `id` is a text field too and a deep link to one asset must not also open every asset
 * whose id contains it. `~` is unreserved, so the URL stays readable.
 *
 * Unreadable entries are SKIPPED rather than thrown: `where` is the half a link most often
 * loses to a chat client's line wrapping, and dropping one filter is a far better failure than
 * refusing to draw the query around it.
 */
export function parseWhere(text) {
  const byIndex = new Map();
  for (const entry of String(text || "").split(",")) {
    if (!entry) continue;
    const dot1 = entry.indexOf(".");
    if (dot1 <= 0) continue;
    // Whichever operator comes first after the key ends the key.
    const eq = entry.indexOf(".", dot1 + 1);
    const tilde = entry.indexOf("~", dot1 + 1);
    const at = eq === -1 ? tilde : (tilde === -1 ? eq : Math.min(eq, tilde));
    if (at <= dot1) continue;
    const index = Number(entry.slice(0, dot1));
    const key = entry.slice(dot1 + 1, at);
    const op = entry[at] === "~" ? "contains" : "eq";
    // A truncated percent-escape THROWS rather than returning garbage, and this runs on the
    // first line of the page's render. Unguarded, `where=0.name~prod%2` replaced the whole
    // workbench with a load failure — which is the opposite of this function's stated
    // contract, and the same guard `parseOffsets` already carries one page over.
    let value;
    try {
      value = decodeURIComponent(entry.slice(at + 1));
    } catch {
      continue;
    }
    if (!Number.isInteger(index) || index < 0 || !key || !value) continue;
    if (!byIndex.has(index)) byIndex.set(index, new Map());
    const forNode = byIndex.get(index);
    if (!forNode.has(key)) forNode.set(key, { values: [], op });
    const filter = forNode.get(key);
    // One operator per (node, key). A link carrying both readings of one field is malformed;
    // the first one wins rather than the entry being dropped, so the filter still does
    // something the chip can describe.
    if (!filter.values.includes(value)) filter.values.push(value);
  }
  return byIndex;
}

export function serializeWhere(byIndex) {
  const parts = [];
  for (const index of [...byIndex.keys()].sort((a, b) => a - b)) {
    const forNode = byIndex.get(index);
    for (const key of [...forNode.keys()].sort()) {
      const filter = forNode.get(key);
      const sep = filter.op === "contains" ? "~" : ".";
      for (const value of filter.values) {
        // A value can hold a comma (a project name) or a dot (a region), either of which would
        // re-split wrong on the way back in.
        parts.push(index + "." + key + sep + encodeURIComponent(value));
      }
    }
  }
  return parts.join(",");
}

/**
 * THE client walk — the twin of `bindingSlots` in the domain module.
 *
 * `queryRows` and `applyWhere` both go through here, so the pre-order they see is the same
 * pre-order the evaluator binds against. That agreement is the whole ballgame: the `where`
 * param addresses nodes by their slot number, and if the two sides ever count differently then
 * every filter past the divergence lands on the wrong node and the query quietly answers a
 * different question. `test/graphQueryWalk.test.js` runs both sides against the real server to
 * prove they still agree.
 *
 * The three rules, all of which the domain shares:
 *   - a NEGATED step binds nothing, so it takes no slot and its subtree is not walked;
 *   - a GROUP is punctuation and takes no slot, but its branches are walked in order;
 *   - everything else takes the next slot.
 *
 * `visit` receives `{ node, step, path, level, index, group, alt }`; `index` is the slot, or
 * null for a group row and a negated step.
 */
function walkQuery(query, visit) {
  let slot = 0;

  const atNode = (node, step, level, path, alt) => {
    const negated = !!(step && step.negate);
    visit({ node, step, path, level, index: negated ? null : slot++, group: false, alt });
    if (negated) return;
    (node.steps || []).forEach((s, i) => atStep(s, level + 1, path.concat(i), alt));
  };

  const atStep = (step, level, path, alt) => {
    if (isGroup(step)) {
      visit({ node: null, step, path, level, index: null, group: true, alt });
      step.steps.forEach((child, i) => {
        // An `and` group is transparent to alternation; an `or` starts a new one.
        const inner = step.op === "or" ? { of: path.join("."), index: i } : alt;
        atStep(child, level + 1, path.concat(i), inner);
      });
      return;
    }
    atNode(step.node, step, level, path, alt);
  };

  atNode(query, null, 0, [], undefined);
}

/**
 * Fold the `where` map into the tree, so what goes over the wire is one object.
 *
 * Kept as two params in the URL and one object on the wire deliberately: the URL wants the
 * halves separable (a filter click rewrites one param, not the whole query), and the server
 * wants them together (it validates and evaluates one tree).
 *
 * It copies the tree first and then walks the COPY, so the traversal that assigns filters is
 * literally the same function `queryRows` uses. The previous version re-implemented the walk
 * inline and had to remember the negated-subtree rule on its own.
 */
export function applyWhere(query, byIndex) {
  const copy = copyNode(query);
  walkQuery(copy, ({ node, index }) => {
    if (index === null || !node) return;
    const filters = byIndex.get(index);
    if (!filters || !filters.size) return;
    node.where = [...filters.keys()].sort().map((key) => {
      const f = filters.get(key);
      // `op` is omitted where it is the default, so the wire payload and the golden snapshot
      // carry it only when it is doing something.
      return f.op === "contains" ? { key, values: f.values, op: "contains" } : { key, values: f.values };
    });
  });
  return copy;
}

/**
 * Move `where` entries across a structural edit, so a filter keeps naming the node it was put
 * on rather than whichever node inherits its slot number.
 *
 * `where` addresses nodes by PRE-ORDER SLOT, which is what makes the param short and shareable
 * — and what makes it fragile: inserting a step in the middle of the tree renumbers everything
 * after it, and negating a step deletes a slot outright. Without this, adding one relationship
 * would slide every filter below it onto a different node, and the query would quietly answer a
 * different question with every chip still reading correctly.
 *
 * PATHS are the stable identity across an edit; slots are not. So this reads old slot → old
 * path, applies whatever the edit did to paths (`movePath`, identity for an append), and looks
 * the path up in the new tree for its new slot.
 *
 * Anything that cannot be placed is DROPPED, never guessed. A filter that vanishes is visible —
 * the chip goes with it — where a filter silently re-pointed at another node is not.
 */
export function remapWhere(oldQuery, newQuery, byIndex, movePath) {
  const pathOfIndex = new Map();
  walkQuery(oldQuery, ({ path, index }) => {
    if (index !== null) pathOfIndex.set(index, path.join("."));
  });
  const indexOfPath = new Map();
  walkQuery(newQuery, ({ path, index }) => {
    if (index !== null) indexOfPath.set(path.join("."), index);
  });

  const out = new Map();
  for (const [index, filters] of byIndex) {
    const was = pathOfIndex.get(index);
    if (was === undefined) continue;
    const now = movePath ? movePath(was) : was;
    if (now === null || now === undefined) continue;
    const at = indexOfPath.get(now);
    if (at === undefined) continue;
    out.set(at, filters);
  }
  return out;
}

/**
 * The `movePath` for a removal: the removed subtree's filters go, and its later siblings shift
 * down one. A removal that also prunes an emptied group moves paths this cannot predict — those
 * filters fail the lookup in `remapWhere` and are dropped, which is the safe direction.
 */
export function pathAfterRemoval(removed) {
  const prefix = removed.slice(0, -1);
  const at = removed[removed.length - 1];
  const removedKey = removed.join(".");
  const prefixKey = prefix.join(".");
  return (key) => {
    if (key === removedKey || key.indexOf(removedKey + ".") === 0) return null;
    const parts = key ? key.split(".") : [];
    if (parts.length <= prefix.length) return key;
    if (parts.slice(0, prefix.length).join(".") !== prefixKey) return key;
    const seg = Number(parts[prefix.length]);
    if (!(seg > at)) return key;
    parts[prefix.length] = String(seg - 1);
    return parts.join(".");
  };
}

// ------------------------------------------------------------------------- builder rows

/**
 * The query as a flat list of builder rows — one per line in the bar.
 *
 * Each row carries its keyword (FIND for the root, THAT for a relationship, OR / AND for a
 * boolean block), its nesting level, the node's pre-order index (so a filter chip knows which
 * node it belongs to), and a `path` the page uses to address the row when patching.
 */
export function queryRows(query) {
  const rows = [];
  walkQuery(query, ({ node, step, path, level, index, group, alt }) => {
    if (group) {
      rows.push({
        keyword: step.op.toUpperCase(),
        group: true,
        op: step.op,
        level,
        path,
        index: null,
        optional: !!step.optional,
        /** A group with one branch left is punctuation around nothing; the bar offers to unwrap it. */
        branches: step.steps.length,
        canHide: false,
        canRemove: true,
        alt,
      });
      return;
    }
    rows.push({
      keyword: path.length ? "THAT" : "FIND",
      group: false,
      level,
      path,
      index,
      kind: node.kind,
      hidden: node.show === false,
      edge: step ? step.edge : null,
      hops: step ? step.hops || 0 : 0,
      reverse: !!(step && step.reverse),
      negate: !!(step && step.negate),
      optional: !!(step && step.optional),
      /** A negated step binds nothing, so there is nothing to show or hide. */
      canHide: !(step && step.negate) && !!path.length,
      canRemove: !!path.length,
      alt,
    });
  });
  return rows;
}

/**
 * The container at `path` — the root node for `[]`, then one index per step.
 *
 * Nodes and groups are both containers, and both keep their children in `.steps`, which is what
 * lets one loop walk through either. A path segment that lands on a group descends INTO the
 * group; one that lands on a relationship descends into its target node.
 */
function containerAt(query, path) {
  let at = query;
  for (const i of path) {
    const step = (at.steps || [])[i];
    if (!step) return null;
    at = isGroup(step) ? step : step.node;
  }
  return at;
}

/** The node at `path`. Null when the path addresses a group, which has no kind of its own. */
export function nodeAt(query, path) {
  const at = containerAt(query, path);
  return at && at.kind !== undefined ? at : null;
}

/** The step at `path` — a relation or a group. Null for the root, which is neither. */
export function stepAt(query, path) {
  if (!path.length) return null;
  const parent = containerAt(query, path.slice(0, -1));
  return parent ? (parent.steps || [])[path[path.length - 1]] || null : null;
}

// ------------------------------------------------------------------------- edits

function copyStep(step) {
  if (isGroup(step)) {
    const out = { op: step.op, steps: step.steps.map(copyStep) };
    if (step.optional) out.optional = true;
    return out;
  }
  return { ...step, node: copyNode(step.node) };
}

function copyNode(node) {
  const out = { kind: node.kind };
  if (node.show === false) out.show = false;
  if (node.steps) out.steps = node.steps.map(copyStep);
  return out;
}

/**
 * Structural edits, each returning a NEW tree.
 *
 * Immutable because the page diffs old against new to decide whether to refetch, exactly the
 * way `update()` diffs DATA_KEYS — mutating in place would make every edit look like no edit.
 * The whole tree is copied and then mutated in place rather than cloned along the path: a query
 * is at most a dozen nodes, and the path-aware clone this replaces was the fiddliest code in
 * the file for no measurable gain.
 */
export function editQuery(query, path, mutate) {
  const copy = copyNode(query);
  const target = containerAt(copy, path);
  if (target) mutate(target);
  return copy;
}

/** Drop the step at `path` (and everything under it). The root cannot be removed. */
export function removeStep(query, path) {
  if (!path.length) return query;
  const parentPath = path.slice(0, -1);
  const at = path[path.length - 1];
  const next = editQuery(query, parentPath, (parent) => {
    parent.steps = (parent.steps || []).filter((_, i) => i !== at);
    if (!parent.steps.length && parent.kind !== undefined) delete parent.steps;
  });
  // A group emptied of branches is punctuation around nothing. Removing it here rather than
  // leaving an "OR" row with no children keeps the bar readable without a second click.
  return pruneEmptyGroups(next);
}

function pruneEmptyGroups(query) {
  const prune = (container) => {
    if (!container.steps) return;
    container.steps = container.steps.filter((step) => {
      if (!isGroup(step)) {
        prune(step.node);
        return true;
      }
      prune(step);
      return step.steps.length > 0;
    });
    if (!container.steps.length && container.kind !== undefined) delete container.steps;
  };
  const copy = copyNode(query);
  prune(copy);
  return copy;
}

/** Append a step under `path` — to a node's step list, or to a group's branch list. */
export function addStep(query, path, step) {
  return editQuery(query, path, (container) => {
    container.steps = (container.steps || []).concat([step]);
  });
}

/** Replace the node at `path`, dropping steps the new kind cannot carry. */
export function setKind(query, path, kind) {
  return editQuery(query, path, (node) => {
    if (node.kind === undefined || node.kind === kind) return;
    node.kind = kind;
    // The steps below were chosen against the old kind's vocabulary; keeping them would build a
    // query that cannot match and give no hint why.
    delete node.steps;
  });
}

export function setHidden(query, path, hidden) {
  return editQuery(query, path, (node) => {
    if (node.kind === undefined) return;
    if (hidden) node.show = false;
    else delete node.show;
  });
}

/** Merge a patch into the step at `path` — its relationship, or a group's `optional`. */
export function setEdge(query, path, patch) {
  if (!path.length) return query;
  const parentPath = path.slice(0, -1);
  const at = path[path.length - 1];
  return editQuery(query, parentPath, (parent) => {
    parent.steps = (parent.steps || []).map((s, i) => (i === at ? { ...s, ...patch } : s));
  });
}

/**
 * Swap the relationship at `path` for another one, keeping what still applies.
 *
 * The builder's term pill offers a relationship and its target as ONE choice — which is what
 * they are — so applying that choice is one edit.
 *
 * `setEdge` then `setKind` very nearly composes into this (`setKind` no-ops on an unchanged
 * kind, so the steps below already survive an edge-only change). What it does not do is come
 * out CLEAN: `setEdge` merges, so swapping ANY2 for a named edge leaves a stale `hops` behind
 * and writes a `reverse: false` the parser never produces — and `parseQuery(serializeQuery(q))`
 * deep-equals `q` is a documented property of this tree. This builds the step from the pick and
 * adds back only what should survive, so the property holds without anyone having to remember
 * which keys the previous relationship left lying around.
 *
 * The row's MODIFIERS survive. `negate`, `optional` and the hidden flag were set by the reader
 * on this row, not chosen as part of the relationship, and silently clearing them would make
 * changing a relationship also un-negate it — an edit nothing on screen asked for.
 *
 * The steps BELOW survive only where the target kind is unchanged. A different kind and they
 * were chosen against a vocabulary that no longer applies: exactly the rule `setKind` already
 * carries, for exactly its reason — keeping them builds a query that cannot match and gives no
 * hint why.
 *
 * A boolean block is not a relationship and has nothing to swap, so a path naming one is left
 * alone rather than half-converted into a relation step.
 */
export function replaceStep(query, path, step) {
  if (!path.length || isGroup(step)) return query;
  const parentPath = path.slice(0, -1);
  const at = path[path.length - 1];
  return editQuery(query, parentPath, (parent) => {
    parent.steps = (parent.steps || []).map((s, i) => {
      if (i !== at || isGroup(s)) return s;
      // `editQuery` copied the whole tree before this ran, so anything carried over from `s` is
      // already this tree's own and needs no second copy. `step` is the CALLER's, though, and
      // every edit here returns a new tree without touching its inputs — so its node is copied
      // before anything is written onto it.
      const next = { ...step, node: { ...step.node } };
      if (s.negate) next.negate = true;
      if (s.optional) next.optional = true;
      if (s.node && s.node.kind === next.node.kind) {
        if (s.node.show === false) next.node.show = false;
        if (s.node.steps) next.node.steps = s.node.steps;
      }
      return next;
    });
  });
}

/** Wrap the step at `path` in a new boolean group, so a second branch can join it. */
export function wrapInGroup(query, path, op) {
  if (!path.length) return query;
  const parentPath = path.slice(0, -1);
  const at = path[path.length - 1];
  return editQuery(query, parentPath, (parent) => {
    parent.steps = (parent.steps || []).map((s, i) => (i === at ? { op, steps: [s] } : s));
  });
}

// ------------------------------------------------------------------------- legacy links

/**
 * The params other pages still send, translated into an equivalent query.
 *
 * `inventory.js` navigates with `{seed: row.id}` and the asset sheet's "focus in graph" with
 * `{seed, seedKind: "asset"}`; older shared links carry `depth`, `kinds`, `severities`,
 * `projects` and `clouds`. None of those callers should have to change for a page rewrite, and
 * a link someone saved last month should still open the view it described — so they are read
 * once on entry and rewritten into `find` / `where`.
 *
 * Returns null when there is nothing to migrate.
 */
export function migrateLegacyParams(params) {
  const has = (k) => typeof params[k] === "string" && params[k] !== "";
  const legacy = ["seed", "seedKind", "depth", "kinds", "severities", "projects", "clouds"];
  if (params.find != null || !legacy.some(has)) return null;

  const kinds = splitList(params.kinds);
  // One kind is a root; several cannot be, so the root goes wild and the kinds become a filter
  // on it — which is what the old node-type facet meant anyway.
  const rootKind = kinds.length === 1 ? kinds[0] : "ANY";
  const query = { kind: rootKind };

  const where = new Map();
  const put = (index, key, values) => {
    if (!values.length) return;
    if (!where.has(index)) where.set(index, new Map());
    // Whole-value equality: a legacy link named an exact id or an exact kind, never a substring.
    where.get(index).set(key, { values, op: "eq" });
  };

  if (has("seed") && params.seedKind !== "combo") put(0, "id", [params.seed]);
  if (kinds.length > 1) put(0, "kind", kinds);
  // `severities`, `clouds` and `projects` are NOT copied in. They survive as their own hash
  // params — the filter panel still writes them and `rpcParams` still folds them onto node 0 —
  // so duplicating them here would leave a second, invisible copy that clearing the chip does
  // not touch, and the view would stay filtered by a filter nothing on screen admits to.

  // A seed meant "show me around this asset", which is a hop step now. Without a seed the old
  // page listed a whole population, and depth had nothing to walk from.
  if (has("seed") && params.seedKind !== "combo") {
    const depth = Math.min(3, Math.max(1, Number(params.depth) || 2));
    query.steps = [{ edge: "ANY", hops: depth, optional: true, node: { kind: "ANY" } }];
  }

  return { find: serializeQuery(query), where: serializeWhere(where) };
}

function splitList(v) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}
