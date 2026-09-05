// A DOM small enough to render a component into, for a repo that has no jsdom.
//
// WHY THIS EXISTS. `vitest.config.ts` in all three apps sets no `environment`, so the house
// pattern is "pure model functions tested directly, DOM halves asserted by regex over source
// text". That pattern cannot answer the question a diagnostics panel actually raises — WHICH
// CARDS DID THIS APP GET, IN WHICH ORDER — because that is a fact about a rendered tree and not
// about the source of any one file. Three tests here already stub `document.createElement` for
// Chart.js (`charts.test.js`, `mttrFan.test.js`, `chartsBundle.test.ts`); this is the same
// move, sized for `ui/dom.js`'s `el()` rather than for a canvas.
//
// IT IS NOT A BROWSER AND MUST NOT GROW INTO ONE. There is no layout, no CSS, no event
// dispatch, no querySelector. What it supports is exactly what `el()` touches: createElement,
// createTextNode, className / textContent / innerHTML, setAttribute, addEventListener, append,
// and `instanceof Node`. A test that needs more than that is asking a question this stub cannot
// answer honestly, and should be asking it of a pure function instead.

class StubNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = {};
    this.childNodes = [];
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.style = {};
    this.listeners = {};
  }

  setAttribute(k, v) { this.attrs[k] = String(v); }

  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  append(...kids) { for (const k of kids) this.childNodes.push(k); }

  removeChild(k) {
    const i = this.childNodes.indexOf(k);
    if (i >= 0) this.childNodes.splice(i, 1);
    return k;
  }

  get firstChild() { return this.childNodes.length ? this.childNodes[0] : null; }
}

class StubText {
  constructor(data) { this.data = String(data); }
}

// `el()` guards every child with `child instanceof Node`, so both kinds must answer to one
// base. Assigning the global is what makes that check mean anything here.
const NodeBase = function Node() {};
Object.setPrototypeOf(StubNode.prototype, NodeBase.prototype);
Object.setPrototypeOf(StubText.prototype, NodeBase.prototype);

/**
 * Install the stub globals, and hand back the function that removes them again. Call it in a
 * `beforeAll` and call the result in `afterAll`: leaving a fake `document` on `globalThis`
 * would leak into every other file the same worker runs.
 */
export function installDomStub() {
  const prevDoc = globalThis.document;
  const prevNode = globalThis.Node;
  globalThis.Node = NodeBase;
  globalThis.document = {
    createElement: (tag) => new StubNode(tag),
    createTextNode: (data) => new StubText(data),
  };
  return () => {
    globalThis.document = prevDoc;
    globalThis.Node = prevNode;
  };
}

/** Every class on a node, as a Set — `el()` writes the whole list to `className` at once. */
export function classes(node) {
  return new Set(String((node && node.className) || "").split(/\s+/).filter(Boolean));
}

/** Does this node carry that class? */
export function hasClass(node, name) { return classes(node).has(name); }

/** Depth-first list of every element node in the tree, the root included. */
export function walk(node, out = []) {
  if (!(node instanceof NodeBase) || node instanceof StubText) return out;
  out.push(node);
  for (const kid of node.childNodes) walk(kid, out);
  return out;
}

/** Every element in the tree carrying `name`, in document order. */
export function findAll(node, name) {
  return walk(node).filter((n) => hasClass(n, name));
}

/** The first element in the tree carrying `name`, or null. */
export function find(node, name) {
  const hits = findAll(node, name);
  return hits.length ? hits[0] : null;
}

/** Every element in the tree with that tag name, in document order. */
export function findTag(node, tag) {
  const want = String(tag).toUpperCase();
  return walk(node).filter((n) => n.tagName === want);
}

/**
 * The text a subtree reads as: every text node and every `textContent` set by `el()`,
 * concatenated in document order. Not `innerText` — there is no layout here and no whitespace
 * model, so this is for asserting that a phrase IS or IS NOT present, never for pixel fidelity.
 */
export function text(node) {
  if (node instanceof StubText) return node.data;
  if (!(node instanceof NodeBase)) return node === null || node === undefined ? "" : String(node);
  let out = node.textContent || "";
  for (const kid of node.childNodes) out += text(kid);
  return out;
}
