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
//
// Property filters ride in a separate `where` param rather than inside the tree, because they
// are the half that changes most (every click in the filter panel) and nesting them would make
// the structure unreadable at exactly the moment someone is trying to read it:
//
//   where=0.cloud.GCP,0.severity.CRITICAL,1.inactive.true
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

function serializeStep(step) {
  let out = "";
  if (step.negate) out += "!";
  if (step.reverse) out += "~";
  if (step.optional) out += "*";
  out += step.edge === "ANY" ? "ANY" + (step.hops && step.hops > 1 ? String(step.hops) : "") : step.edge;
  return out + SEP_EDGE + serializeQuery(step.node);
}

// ------------------------------------------------------------------------- where

/**
 * `0.cloud.GCP,0.cloud.AWS,1.inactive.true` → per-node filters, keyed by pre-order index.
 *
 * Repeating a (node, key) pair ORs its values, which is how the filter panel's multi-select
 * dimensions already behave everywhere else in this app.
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
    const dot2 = entry.indexOf(".", dot1 + 1);
    if (dot1 <= 0 || dot2 <= dot1) continue;
    const index = Number(entry.slice(0, dot1));
    const key = entry.slice(dot1 + 1, dot2);
    const value = decodeURIComponent(entry.slice(dot2 + 1));
    if (!Number.isInteger(index) || index < 0 || !key || !value) continue;
    if (!byIndex.has(index)) byIndex.set(index, new Map());
    const forNode = byIndex.get(index);
    if (!forNode.has(key)) forNode.set(key, []);
    if (!forNode.get(key).includes(value)) forNode.get(key).push(value);
  }
  return byIndex;
}

export function serializeWhere(byIndex) {
  const parts = [];
  for (const index of [...byIndex.keys()].sort((a, b) => a - b)) {
    const forNode = byIndex.get(index);
    for (const key of [...forNode.keys()].sort()) {
      for (const value of forNode.get(key)) {
        // A value can hold a comma (a project name) or a dot (a region), either of which would
        // re-split wrong on the way back in.
        parts.push(index + "." + key + "." + encodeURIComponent(value));
      }
    }
  }
  return parts.join(",");
}

/**
 * Fold the `where` map into the tree, so what goes over the wire is one object.
 *
 * Kept as two params in the URL and one object on the wire deliberately: the URL wants the
 * halves separable (a filter click rewrites one param, not the whole query), and the server
 * wants them together (it validates and evaluates one tree).
 */
export function applyWhere(query, byIndex) {
  let index = 0;
  const walk = (node) => {
    const filters = byIndex.get(index++);
    const out = { kind: node.kind };
    if (node.show === false) out.show = false;
    if (filters && filters.size) {
      out.where = [...filters.keys()].sort().map((key) => ({ key, values: filters.get(key) }));
    }
    if (node.steps && node.steps.length) {
      out.steps = node.steps.map((step) => {
        const copy = { edge: step.edge };
        if (step.reverse) copy.reverse = true;
        if (step.negate) copy.negate = true;
        if (step.optional) copy.optional = true;
        if (step.hops) copy.hops = step.hops;
        // A negated step binds nothing, so it consumes no pre-order slot — the same rule the
        // evaluator's `bindingSlots` follows. Walking into it here would shift every later
        // node's filters onto the wrong node.
        copy.node = step.negate ? stripFilters(step.node) : walk(step.node);
        return copy;
      });
    }
    return out;
  };
  return walk(query);
}

function stripFilters(node) {
  const out = { kind: node.kind };
  if (node.show === false) out.show = false;
  if (node.steps && node.steps.length) out.steps = node.steps.map((s) => ({ ...s, node: stripFilters(s.node) }));
  return out;
}

// ------------------------------------------------------------------------- builder rows

/**
 * The query as a flat list of builder rows — one per line in the bar.
 *
 * Each row carries its keyword (FIND for the root, THAT for every step), its nesting level, the
 * node's pre-order index (so a filter chip knows which node it belongs to), and a `path` the
 * page uses to address the row when patching. The page owns rendering; this owns the shape.
 */
export function queryRows(query) {
  const rows = [];
  let index = 0;
  const walk = (node, step, level, path) => {
    const slot = step && step.negate ? null : index++;
    rows.push({
      keyword: path.length ? "THAT" : "FIND",
      level,
      path,
      index: slot,
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
    });
    // Nothing under a negated step can bind, so nothing under it is a row.
    if (step && step.negate) return;
    (node.steps || []).forEach((s, i) => walk(s.node, s, level + 1, path.concat(i)));
  };
  walk(query, null, 0, []);
  return rows;
}

/** The node at `path` — [] is the root, [0] its first step's target, and so on. */
export function nodeAt(query, path) {
  let node = query;
  for (const i of path) node = node.steps[i].node;
  return node;
}

/**
 * Structural edits, each returning a NEW tree.
 *
 * Immutable because the page diffs old against new to decide whether to refetch, exactly the
 * way `update()` diffs DATA_KEYS — mutating in place would make every edit look like no edit.
 */
export function editQuery(query, path, mutateNode) {
  const clone = (node, depth) => {
    const copy = { kind: node.kind };
    if (node.show === false) copy.show = false;
    if (node.steps) {
      copy.steps = node.steps.map((s, i) => ({
        ...s,
        node: i === path[depth] ? clone(s.node, depth + 1) : deepCopy(s.node),
      }));
    }
    if (depth === path.length) mutateNode(copy);
    return copy;
  };
  return clone(query, 0);
}

function deepCopy(node) {
  const out = { kind: node.kind };
  if (node.show === false) out.show = false;
  if (node.steps) out.steps = node.steps.map((s) => ({ ...s, node: deepCopy(s.node) }));
  return out;
}

/** Drop the step at `path` (and everything under it). The root cannot be removed. */
export function removeStep(query, path) {
  if (!path.length) return query;
  const parentPath = path.slice(0, -1);
  const at = path[path.length - 1];
  return editQuery(query, parentPath, (node) => {
    node.steps = (node.steps || []).filter((_, i) => i !== at);
    if (!node.steps.length) delete node.steps;
  });
}

/** Append a step under `path`. */
export function addStep(query, path, step) {
  return editQuery(query, path, (node) => {
    node.steps = (node.steps || []).concat([step]);
  });
}

/** Replace the node at `path`, keeping its steps only when the new kind can still carry them. */
export function setKind(query, path, kind) {
  return editQuery(query, path, (node) => {
    if (node.kind === kind) return;
    node.kind = kind;
    // The steps below were chosen against the old kind's vocabulary; keeping them would build a
    // query that cannot match and give no hint why.
    delete node.steps;
  });
}

export function setHidden(query, path, hidden) {
  return editQuery(query, path, (node) => {
    if (hidden) node.show = false;
    else delete node.show;
  });
}

/** Replace the relationship on the step at `path`. */
export function setEdge(query, path, patch) {
  if (!path.length) return query;
  const parentPath = path.slice(0, -1);
  const at = path[path.length - 1];
  return editQuery(query, parentPath, (node) => {
    node.steps = (node.steps || []).map((s, i) => (i === at ? { ...s, ...patch } : s));
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
    where.get(index).set(key, values);
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
