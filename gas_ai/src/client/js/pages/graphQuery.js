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
//   find=AI_AGENT-AI_DEPLOYMENT(RUNS_AS.SERVICE_ACCOUNT)   one node, EITHER kind
//
// `-` between kinds, and it is the only character it could have been. The invariant above spends
// `.` `'` `(` `)` `!` `~` `*` already, `_` lives inside tokens, and lowercase has to stay a parse
// error — which leaves the hyphen as the one thing encodeURIComponent spares and this grammar has
// not claimed. (`,` would read better and is not spared: it becomes %2C.)
//
// Property filters ride in a separate `where` param rather than inside the tree, because they
// are the half that changes most (every click in the filter panel) and nesting them would make
// the structure unreadable at exactly the moment someone is trying to read it:
//
//   where=0.cloud.GCP,0.severity.CRITICAL,1.inactive.true
//   where=0.name~prod          the separator IS the operator: `.` equals, `~` contains
//   where=0.!cloud.GCP         `!` on the KEY negates: keep exactly what this would drop
//   where=0.*tags.env:prod     `*` on the key: EVERY value must match, not just one
//   where=0.!*projects.A       both, order-free — "does not hold all of these"
//
// The flags are the same two characters, in the same order-free prefix set, that a step carries
// in `find=`. One grammar to learn, and no flags is what every link written before them means.
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

/** How deep a group may sit before the server refuses it — `MAX_QUERY_DEPTH` in the domain. */
export const MAX_DEPTH = 6;

/**
 * Can this row legally be negated?
 *
 * The domain rejects two combinations outright — a negated step carrying further steps ("there
 * is nothing to walk from") and a step both negated and optional. Both are reachable today: the
 * palette offers NOT on any relationship, so negating a row that has a hop under it builds a
 * query the server throws on, and the page shows a load failure for something the builder
 * offered. Asked here so the two controls that can set it agree on one answer.
 */
export function canNegate(row) {
  if (!row || row.group || !row.path || !row.path.length) return false;
  return !row.optional && !row.hasSteps;
}

/**
 * How deep the tree goes, counted the way the domain's `validateQuery` counts it: the root is 1,
 * each hop adds one, and A GROUP ADDS ONE TOO. That last part is why this exists — joining two
 * rows with OR wraps them, and a wrap inside a long enough chain turns a legal query into one the
 * server refuses. Cheaper to not offer the join than to explain the rejection afterwards.
 */
export function depthOf(query) {
  const atNode = (node, d) => Math.max(d, ...(node.steps || []).map((s) => atStep(s, d + 1)));
  const atStep = (step, d) => (isGroup(step)
    ? Math.max(d, ...step.steps.map((c) => atStep(c, d + 1)))
    : atNode(step.node, d));
  return atNode(query, 1);
}

const SEP_SIBLING = "'";
const SEP_EDGE = ".";
const SEP_KIND = "-";
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
  // One kind, or several joined by `-` — "AI agents and AI deployments" is one node asking for
  // either, not two queries. `readToken` already halts at the first non-token character, so the
  // list needs no lookahead beyond checking for the separator.
  const kinds = [readToken(c)];
  while (c.s[c.i] === SEP_KIND) {
    c.i++;
    kinds.push(readToken(c));
  }
  const node = { kind: kinds.length === 1 ? kinds[0] : kinds };
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

/**
 * The kinds a node names, always as a list — the client's twin of the domain's `kindsOf`.
 *
 * One kind is stored as a bare string so that an existing query is the object it always was;
 * this is the single place anything narrows the two spellings.
 */
export function kindsOf(node) {
  return Array.isArray(node.kind) ? node.kind : [node.kind];
}

/**
 * A node's kinds as one string — `"AI_AGENT"`, `"AI_AGENT-AI_DEPLOYMENT"`.
 *
 * The IDENTITY, not the label: the server derives `ColumnGroup.kind` the same way and
 * test/graphQueryWalk.test.js compares the two by value, so the pair has to agree character for
 * character. Also the key per-kind column preferences are stored under.
 */
export function kindKey(node) {
  return kindsOf(node).join(SEP_KIND);
}

/** Do two nodes ask for the same kinds? Order-insensitive, so a re-pick is still a no-op. */
export function sameKinds(a, b) {
  const x = kindsOf(a);
  const y = kindsOf(b);
  return x.length === y.length && x.every((k) => y.includes(k));
}

/**
 * Do two kind selections share anything? The one rule the "keeps or drops" decisions read.
 *
 * ANY OVERLAPS EVERYTHING, as a set-theoretic fact rather than a special case: it is the union of
 * every kind, so `AI_AGENT` is inside it. By tokens alone `["ANY"]` and `["AI_AGENT"]` look
 * disjoint, and treating them that way meant switching a query to "Any node" deleted the steps
 * below it — which is wrong twice over, because widening a question should never lose work, and
 * `FIND ANY THAT runs as Service Account` is a query the app writes for itself.
 *
 * Exported so `setKinds` and the builder decide by the same rule; two copies would drift, and the
 * failure is silent — one half keeping a filter the other half just dropped.
 */
export function kindsOverlap(a, b) {
  const x = Array.isArray(a) ? a : [a];
  const y = Array.isArray(b) ? b : [b];
  if (x.includes("ANY") || y.includes("ANY")) return true;
  return x.some((k) => y.includes(k));
}

/** The inverse. Round-trips: parseQuery(serializeQuery(q)) deep-equals q. */
export function serializeQuery(node) {
  let out = (node.show === false ? "!" : "") + kindsOf(node).join(SEP_KIND);
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
    // Quantifier flags ride as an order-free PREFIX on the key — the same idiom, and the same
    // two characters, the `find=` grammar already uses on a step. No flags is the reading every
    // link written before they existed carries, so those keep meaning exactly what they meant.
    let key = entry.slice(dot1 + 1, at);
    let all = false;
    let negate = false;
    for (;;) {
      if (key[0] === "!") { negate = true; key = key.slice(1); continue; }
      if (key[0] === "*") { all = true; key = key.slice(1); continue; }
      break;
    }
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
    if (!forNode.has(key)) {
      // Omitted where false, the way `op` omits its default and `applyWhere` omits it again on
      // the wire — so a plain filter is the same plain object it has always been, and a flag
      // present in one of these maps always means something.
      const made = { values: [], op };
      if (all) made.all = true;
      if (negate) made.negate = true;
      forNode.set(key, made);
    }
    const filter = forNode.get(key);
    // One reading per (node, key) — operator and flags alike. A link carrying two readings of
    // one field is malformed; the first wins rather than the entry being dropped, so the filter
    // still does something the chip can describe.
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
      // Written in one fixed order so the same filter always produces the same string — a link
      // that differs only in flag order would defeat every `===` this page does on the hash.
      const flags = (filter.negate ? "!" : "") + (filter.all ? "*" : "");
      for (const value of filter.values) {
        // A value can hold a comma (a project name) or a dot (a region), either of which would
        // re-split wrong on the way back in.
        parts.push(index + "." + flags + key + sep + encodeURIComponent(value));
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
      // Each key is omitted where it is the default, so the wire payload and the golden snapshot
      // carry it only when it is doing something.
      //
      // THIS IS WHERE A NEW FLAG GOES TO DIE. The payload is rebuilt field by field, so anything
      // parsed out of the URL and not named here is dropped between the two — no error, no
      // warning, just a query that quietly answers a different question than the chip describes.
      const out = { key, values: f.values };
      if (f.op === "contains") out.op = "contains";
      if (f.all) out.all = true;
      if (f.negate) out.negate = true;
      return out;
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
 * Can this group be read as a RUN — a set of alternatives written down the rows themselves,
 * rather than as a block with a header row and indented children?
 *
 * A run is `THAT a / OR THAT b`: the conjunction rides on each row, which is how the reference
 * writes it and how our own results TABLE has always written it (`queryTable` puts an "or"
 * before an alternative column group). Two shapes cannot be written that way and keep their
 * meaning, so they keep the block rendering:
 *
 *   - a group carrying `optional`. That flag is about the SET — "match one of these or keep the
 *     row anyway" — and a run has no line of its own to hang it on. Only a hand-edited link or
 *     an old shared one produces these now, and they must still round-trip.
 *   - a group holding another group. Nesting is the one thing a flat list of AND/OR prefixes
 *     genuinely cannot say without precedence rules, so it stays indented, where the nesting is
 *     visible.
 */
function isRun(step) {
  return isGroup(step) && !step.optional && step.steps.every((s) => !isGroup(s));
}

/**
 * Does the group at `path` get written as a run, rather than drawn as a block?
 *
 * `isRun` asks whether the group's own shape can be written down a column of rows. This adds the
 * other half: it must also sit directly under a NODE. A group nested inside a block belongs to
 * that block's branch structure, and opening it up there would put both notations on screen at
 * once — a header row saying OR above rows saying AND, each describing a different join.
 */
function foldsAt(query, path) {
  if (!isRun(stepAt(query, path))) return false;
  const parent = containerAt(query, path.slice(0, -1));
  return !!parent && parent.kind !== undefined;
}

/**
 * How the step at `path` joins the one before it AT ITS OWN LEVEL: null, "and" or "or".
 *
 * Sibling steps under a node are ANDed — the domain says so, and `solveGroup`'s `and` branch
 * cross-products exactly the way the node's own sibling loop does. Branches of a run are joined
 * by the run's operator. And the FIRST branch of a run has no join of its own, so it inherits
 * the run's: `[OR(a'b), c]` reads `THAT a / OR THAT b / AND THAT c`, where `a`'s blank and `c`'s
 * "and" both come from the position their container holds among ITS siblings.
 */
function conjunctionAt(query, path) {
  if (!path.length) return null;
  const up = path.slice(0, -1);
  const parent = containerAt(query, up);
  const inRun = !!parent && parent.kind === undefined && foldsAt(query, up);
  if (path[path.length - 1] > 0) {
    // A branch of a BLOCK — one the bar still draws with a header row — is already announced by
    // that header. Saying it twice would be the row and the block disagreeing about who owns it.
    if (parent && parent.kind === undefined) return inRun ? parent.op : null;
    return "and";
  }
  // First in its container. Only a RUN hands its own join down, because its first branch stands
  // exactly where the run stands. A NODE does not: the first step on an entity is the first
  // thing said about that entity, and joins nothing above it.
  return inRun ? conjunctionAt(query, up) : null;
}

/**
 * The query as a flat list of builder rows — one per line in the bar.
 *
 * Each row carries its keyword (FIND for the root, THAT for a relationship, OR / AND for a
 * boolean block that is still drawn as one), its nesting level, the node's pre-order index (so a
 * filter chip knows which node it belongs to), and a `path` the page uses to address the row.
 *
 * A RUN IS FOLDED AWAY HERE, and only here. The group keeps its place in the tree — it is what
 * the server evaluates and what `find=` carries — but it gets no row of its own, and its branches
 * rise to the level it occupied so they line up with the ordinary steps around them. That fold
 * is why this is a rendering change and not a model one: `walkQuery` still visits the group, still
 * counts slots the same way, and every consumer of `where=` slot numbers is untouched.
 */
export function queryRows(query) {
  const rows = [];
  /** Path strings of the runs folded so far — each one costs its descendants a level. */
  const folded = new Set();
  const foldedAbove = (path) => {
    let n = 0;
    for (let i = 0; i < path.length; i++) {
      if (folded.has(path.slice(0, i).join("."))) n++;
    }
    return n;
  };
  walkQuery(query, ({ node, step, path, level, index, group, alt }) => {
    if (group) {
      if (foldsAt(query, path)) {
        folded.add(path.join("."));
        return;
      }
      rows.push({
        keyword: step.op.toUpperCase(),
        group: true,
        op: step.op,
        level: level - foldedAbove(path),
        path,
        index: null,
        optional: !!step.optional,
        /** A group with one branch left is punctuation around nothing; the bar offers to unwrap it. */
        branches: step.steps.length,
        canHide: false,
        canRemove: true,
        conj: null,
        runOf: null,
        canJoin: false,
        alt,
      });
      return;
    }
    const parentPath = path.slice(0, -1);
    const inRun = path.length && folded.has(parentPath.join("."));
    const conj = conjunctionAt(query, path);
    rows.push({
      keyword: path.length ? "THAT" : "FIND",
      group: false,
      level: level - foldedAbove(path),
      path,
      index,
      /**
       * TWO readings of the same thing, on purpose. `kinds` is what the bar renders — a chip
       * each. `kind` is the IDENTITY: the server derives `ColumnGroup.kind` with the same
       * `kindKey`, graphQueryWalk.test.js compares the pair by value, and the column-preference
       * store is keyed by it. A one-kind row answers the bare kind for both.
       */
      kinds: kindsOf(node),
      kind: kindKey(node),
      hidden: node.show === false,
      edge: step ? step.edge : null,
      hops: step ? step.hops || 0 : 0,
      reverse: !!(step && step.reverse),
      negate: !!(step && step.negate),
      optional: !!(step && step.optional),
      /** How this row joins the one above it, and the run it belongs to if it is in one. */
      conj,
      runOf: inRun ? parentPath.join(".") : null,
      /** There is a row above at this level to be joined to — so AND / OR mean something here. */
      canJoin: conj !== null,
      /** A negated step binds nothing, so there is nothing to show or hide. */
      canHide: !(step && step.negate) && !!path.length,
      canRemove: !!path.length,
      /** Whether anything hangs off this row's entity — `canNegate` turns on it. */
      hasSteps: !!(node.steps && node.steps.length),
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
    const kept = [];
    for (const step of container.steps) {
      if (!isGroup(step)) {
        prune(step.node);
        kept.push(step);
        continue;
      }
      prune(step);
      if (!step.steps.length) continue;
      // A group down to ONE branch is punctuation around nothing: `OR(a)` matches exactly what
      // `a` matches, and it costs a level of the depth budget to say so. It used to be left
      // standing because a block was built empty and filled afterwards, so the one-branch state
      // was a step on the way somewhere — nothing builds a block that way now, and leaving it
      // would put a run on screen that reads as a single plain condition.
      if (step.steps.length === 1 && !step.optional) kept.push(step.steps[0]);
      else kept.push(step);
    }
    container.steps = kept;
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

/**
 * Set what the node at `path` looks for — one kind or several.
 *
 * THE STEPS BELOW SURVIVE AN OVERLAP. They were chosen against the old kinds' vocabulary, so a
 * change to something unrelated leaves a query that cannot match and gives no hint why — which
 * is why any change used to drop them. But adding a second kind to a selection is the common
 * edit now, and wiping the query every time someone widens it would make the multi-select
 * unusable: the relationships already there are still traversable by the kinds still there.
 *
 * So: overlap keeps, disjoint drops. Widening and narrowing both keep, and only trading the
 * selection for a different one starts over.
 *
 * `kinds` is normalised the same way the parser and the validator do it — one kind as a bare
 * string, several as a list — so no edit can produce a tree the DSL would not round-trip.
 */
export function setKinds(query, path, kinds) {
  const list = (Array.isArray(kinds) ? kinds : [kinds]).filter(Boolean);
  if (!list.length) return query;
  const next = list.includes("ANY") ? ["ANY"] : list.filter((k, i) => list.indexOf(k) === i);
  return editQuery(query, path, (node) => {
    if (node.kind === undefined) return;
    const was = kindsOf(node);
    if (was.length === next.length && was.every((k) => next.includes(k))) return;
    node.kind = next.length === 1 ? next[0] : next;
    if (!kindsOverlap(was, next)) delete node.steps;
  });
}

/** One kind, the shape most callers want. `setKinds` is the general form. */
export function setKind(query, path, kind) {
  return setKinds(query, path, [kind]);
}

export function setHidden(query, path, hidden) {
  return editQuery(query, path, (node) => {
    if (node.kind === undefined) return;
    if (hidden) node.show = false;
    else delete node.show;
  });
}

/**
 * Merge a patch into the step at `path` — its relationship, or a group's `optional`.
 *
 * A patched key that lands FALSE or undefined is deleted rather than written. Every flag here is
 * an absence when it is off, and the parser never produces `negate: false` — writing one would
 * break `parseQuery(serializeQuery(q))` deep-equals `q`, which this module documents as a
 * property and the palette's own tests lean on. Turning a flag off has to leave the tree looking
 * like one that never had it.
 */
export function setEdge(query, path, patch) {
  if (!path.length) return query;
  const parentPath = path.slice(0, -1);
  const at = path[path.length - 1];
  return editQuery(query, parentPath, (parent) => {
    parent.steps = (parent.steps || []).map((s, i) => {
      if (i !== at) return s;
      const next = { ...s, ...patch };
      for (const key of Object.keys(patch)) {
        if (next[key] === false || next[key] === undefined) delete next[key];
      }
      return next;
    });
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
      if (s.node && sameKinds(s.node, next.node)) {
        if (s.node.show === false) next.node.show = false;
        if (s.node.steps) next.node.steps = s.node.steps;
      }
      return next;
    });
  });
}

// ------------------------------------------------------------------- conjunctions

/**
 * The node whose step list the row at `path` really belongs to, and the row's ordinal in it.
 *
 * A run is punctuation around a stretch of one level's conditions, so "the row above me" is a
 * question about the LEVEL, not about the tree shape. This flattens the level back out: the
 * container is the nearest enclosing node, and the leaves are its steps with every run opened up
 * in place.
 */
function levelOf(query, path) {
  let nodePath = path.slice(0, -1);
  while (nodePath.length && !nodeAt(query, nodePath)) nodePath = nodePath.slice(0, -1);
  const node = nodeAt(query, nodePath);
  if (!node) return null;
  const leaves = [];
  (node.steps || []).forEach((step, i) => {
    if (foldsAt(query, nodePath.concat(i))) {
      step.steps.forEach((branch, j) => leaves.push({ step: branch, path: nodePath.concat(i, j) }));
    } else {
      leaves.push({ step, path: nodePath.concat(i) });
    }
  });
  const want = path.join(".");
  const at = leaves.findIndex((l) => l.path.join(".") === want);
  return at === -1 ? null : { nodePath, node, leaves, at };
}

/**
 * Join the row at `path` to the one above it with `conj` — "and" or "or".
 *
 * THE MODEL IS RUNS. One level is a sequence of conditions, each joined to the previous by AND
 * or OR; consecutive ORs form a run of alternatives, and runs are ANDed together. That is
 * AND-of-ORs, the normal form, and the existing tree holds it with no nesting at all: a node's
 * steps become a sequence of bare steps and `or` groups of bare steps.
 *
 * Which is why this does not edit the tree shape directly. It flattens the level to its leaves,
 * writes the one conjunction it was asked to write, and rebuilds — so every case falls out of one
 * rule instead of being enumerated. `OR(a'b'c)` with `b` set to AND becomes `[a, OR(b'c)]`,
 * because `c` was joined to `b` by OR and still is. Reading the rows top to bottom gives back
 * exactly the query, with no precedence to know: the runs are written down.
 *
 * A row that joins nothing — the first condition at its level — is left alone.
 */
export function setConjunction(query, path, conj) {
  const level = levelOf(query, path);
  if (!level || level.at === 0) return query;
  const conjs = level.leaves.map((leaf, i) => (i === 0 ? null : conjunctionAt(query, leaf.path)));
  conjs[level.at] = conj;
  return editQuery(query, level.nodePath, (node) => {
    const steps = [];
    /** The run being extended, or null between runs. Tracked rather than read back off the tail:
     *  a BLOCK sitting at this level is also a group, and appending an alternative into one would
     *  quietly rewrite a set the reader grouped on purpose. */
    let open = null;
    level.leaves.forEach((leaf, i) => {
      // Copied, never reattached: `editQuery` already cloned the tree, and handing back a live
      // reference into the caller's would break the immutability every edit here promises.
      const step = copyStep(leaf.step);
      if (i > 0 && conjs[i] === "or") {
        if (!open) {
          open = { op: "or", steps: [steps.pop()] };
          steps.push(open);
        }
        open.steps.push(step);
        return;
      }
      open = null;
      steps.push(step);
    });
    node.steps = steps;
  });
}

/**
 * The `movePath` for a regroup.
 *
 * Wrapping steps into a run and dissolving one back both leave the pre-order of the nodes exactly
 * as it was — a group binds nothing, so no slot moves. PATHS move, though, and `where` is remapped
 * by path, so without this every filter under the edited stretch would be dropped on the way
 * through `remapWhere`.
 *
 * Mapped by ORDINAL over the same walk both sides use, which is the whole argument for why it is
 * right: if the nth thing visited before is the nth thing visited after, it is the same thing.
 * A length mismatch leaves a path unmapped and its filter is dropped — the safe direction, and
 * the one this module takes everywhere else.
 */
export function pathAfterRegroup(oldQuery, newQuery) {
  const seq = (q) => {
    const out = [];
    walkQuery(q, ({ path, group }) => { if (!group) out.push(path.join(".")); });
    return out;
  };
  const before = seq(oldQuery);
  const after = seq(newQuery);
  const moved = new Map();
  before.forEach((was, i) => { if (after[i] !== undefined) moved.set(was, after[i]); });
  return (key) => (moved.has(key) ? moved.get(key) : null);
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
/** The retired filter panel's params, and the query field each one was always about. */
export const PANEL_PARAMS = [
  ["severities", "severity"],
  ["clouds", "cloud"],
  ["projects", "projects"],
];

export function migrateLegacyParams(params) {
  const has = (k) => typeof params[k] === "string" && params[k] !== "";
  const panel = PANEL_PARAMS.filter(([p]) => has(p));
  const structural = ["seed", "seedKind", "depth", "kinds"].some(has);
  if (!panel.length && !structural) return null;
  // A link that already carries a query KEEPS it — there is nothing to rebuild. But the panel's
  // three params still have to be folded, and this is the guard that used to stop that: every
  // saved view carries `find`, so returning early here left them behind. With the panel gone
  // they narrow nothing, and a view would have silently reopened wider than it was saved.
  if (params.find != null && !panel.length) return null;

  // Folded ONTO what the URL already says, never over it. A filter written in the builder is
  // visible and editable where a panel param was neither, so where both name one field the
  // visible one wins — the opposite of the old `rpcParams` fold, which silently overwrote it.
  const where = parseWhere(params.where);
  const put = (index, key, values) => {
    if (!values.length) return;
    if (!where.has(index)) where.set(index, new Map());
    if (where.get(index).has(key)) return;
    // Whole-value equality: these named exact values, never a substring.
    where.get(index).set(key, { values, op: "eq" });
  };
  for (const [param, key] of panel) put(0, key, splitList(params[param]));

  const out = { where: serializeWhere(where) };
  if (params.find != null) return out;

  const kinds = splitList(params.kinds);
  // One kind is a root; several cannot be, so the root goes wild and the kinds become a filter
  // on it — which is what the old node-type facet meant anyway.
  const query = { kind: kinds.length === 1 ? kinds[0] : "ANY" };
  // WHAT THE SEED NAMES depends on seedKind, and getting that wrong is silent.
  //
  // A bare `?seed=` — and `seedKind=asset`, which every caller in this app writes — names ONE
  // node by id. `seedKind=domain` does not: it names a business domain, and every resource that
  // domain owns is a start. Read as an id it resolved to `where 0.id.CROSS`, a filter matching
  // nothing at all, so a link written against the shape `graphApiParams.ts` documents opened an
  // empty canvas rather than an error. It is a `where` on the domain field instead, which is
  // what the builder would have written by hand and arrives as an editable chip.
  //
  // `combo` is in this table as a statement that it is NOT handled here, not as a no-op: it
  // reaches the page as `find=ANY` with nothing narrowing it. See the note below.
  const SEED_FIELD = { domain: "domain" };
  const seedKind = typeof params.seedKind === "string" ? params.seedKind : "";
  const seedField = SEED_FIELD[seedKind] ?? (seedKind === "combo" ? null : "id");
  if (has("seed") && seedField) put(0, seedField, [params.seed]);
  if (kinds.length > 1) put(0, "kind", kinds);

  // A seed meant "show me around this asset", which is a hop step now. Without a seed the old
  // page listed a whole population, and depth had nothing to walk from. A domain seed means the
  // same thing of several assets at once, so it walks too.
  if (has("seed") && seedField) {
    const depth = Math.min(3, Math.max(1, Number(params.depth) || 2));
    query.steps = [{ edge: "ANY", hops: depth, optional: true, node: { kind: "ANY" } }];
  }

  return { find: serializeQuery(query), where: serializeWhere(where) };
}

function splitList(v) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}
