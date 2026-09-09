// REGISTER TOOLBAR PARITY, THE DELTAS ONLY — P3.2.
//
// gas's own `test/registerToolbar.test.js` asserts every toolbar control writes the URL via
// `navigate`, because on THAT register a bare `replaceState` fires no `hashchange` and the
// page would leave the previous fetch on screen. That assertion is NOT ported here, and this
// is why: gas_ai's register pages (problems.js, combos.js, config.js, inventory.js) hold
// `view` OUTSIDE `paint()`, write the URL with `setParams(...)` from a `persist()` helper (or
// this file's own name for it — `pushParams` on config.js, `persistParams` on inventory.js)
// and repaint IN PLACE. `navigate()` pushes a history entry and re-mounts the route — a
// skeleton flash, and any in-flight SWR rows discarded — so switching a severity pill or a
// search box to `navigate` would make every filter click look like a page load. Measured at
// package start (fact 4 of the parity plan): problems 0 navigate / 1 setParams-family call,
// config 0/1, combos 1/1 (one deliberate cross-page "Open in graph" `navigate`), inventory
// 4/2 (cross-page jumps: "Open in graph" and the domain link both `navigate`; a saved view
// also `navigate`s deliberately, on the reasoning that swapping the whole query is "a
// wholesale state change [that] deserves a history entry, so Back returns to the view they
// were on" — inventory.js's own comment above `savedViewsControl`'s select listener).
//
// The parity claim this register actually owes is the ROUND-TRIP: every URL-worthy field
// survives `read(patch(view))`, and every toolbar control that changes one of those fields
// calls the page's persist helper before repainting (or `navigate`s deliberately to a
// DIFFERENT route, which is the other half of fact 4 and is exempted below, not required to
// persist a view it is about to leave).
//
// ---------------------------------------------------------------------------------------
// SECTION 1 — the round trip
// ---------------------------------------------------------------------------------------
//
// problemView.js and comboView.js each export a clean, DOM-free `read*Params`/`*ParamPatch`
// pair covering every URL-worthy field for their page. configView.js does NOT: `pushParams`
// — config.js's own inverse of `readConfigParams` — is an unexported closure inside
// `renderConfigFindings` (it reads `view` and calls `setParams` directly), because config.js
// carries `mode`/`sort`/`dir`/`page` as top-level view fields rather than inside the
// `query` object `readConfigParams` parses. So configView.js's round trip below covers the
// ten QUERY fields it actually owns (via the exported `configQueryParams`, whose facet
// serialization is byte-identical in shape to `pushParams`'s), and the remaining four fields
// are covered by a SOURCE SWEEP instead of a runtime round trip — the brief's own escape
// hatch for "no pure pair" ("say so and cover it with a source sweep only").
//
// ---------------------------------------------------------------------------------------
// SECTION 2 — the persist sweep
// ---------------------------------------------------------------------------------------
//
// Every `onToggle:`/`onChange:`/`onclick:` closure and every `.addEventListener("input", …)`
// / `oninput:` search handler inside each page's toolbar-building function(s) has to reach
// the page's persist helper — directly, or through ONE OR TWO named page-local helpers
// (`toggleFacet`, `onFilterChange`, `setView`, `openPattern`, `rerender` — each independently
// verified below to bottom out at a real persist call) — or it deliberately `navigate()`s
// to a different route, which fact 4 already exempts. The sweep is GENERIC (it walks every
// occurrence of those four textual markers inside the named functions, rather than a fixed
// list of anchors chosen in advance), so a new control added later without wiring persist
// fails it — the "guard that fires on nothing" trap CLAUDE.md names.
//
// problems.js is READ ONLY for this package (another agent owns `problems.js`/
// `problemView.js` concurrently) — measured, never edited. Its `toolbar(` (all-mode filter
// bar) is swept; its `actionToolbar(` is NOT — its own header comment (quoted below) says
// `view.aSeverity`/`aKind`/`aQ`/`aSort`/`aDir` are page-local and ephemeral, "ride along with
// `view` without ever being read by `problemParamPatch`". Sweeping it would assert a rule
// the file's own author already refused.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";
import {
  comboParamPatch, ISSUE_COMPARATORS, readComboParams,
} from "../src/client/js/pages/comboView.js";
import {
  configQueryParams, readConfigParams,
} from "../src/client/js/pages/configView.js";
import {
  PROBLEM_COMPARATORS, problemParamPatch, readProblemParams,
} from "../src/client/js/pages/problemView.js";

const PAGES_DIR = fileURLToPath(new URL("../src/client/js/pages/", import.meta.url));
const readRaw = (f) => readFileSync(PAGES_DIR + f, "utf8");
const read = (f) => code(readRaw(f));

const problemsSrc = read("problems.js");
const combosSrc = read("combos.js");
const configSrc = read("config.js");
const inventorySrc = read("inventory.js");
// The two "the source still says why" checks below cite prose INSIDE comments, which `code()`
// strips — those two checks read the raw file instead.
const problemsRaw = readRaw("problems.js");
const inventoryRaw = readRaw("inventory.js");

// =========================================================================================
//  1. The round trip
// =========================================================================================

describe("problemView.js: readProblemParams(problemParamPatch(view)) round-trips every "
  + "URL-worthy field", () => {
  // The exact field list, read from the source rather than assumed: both functions return/
  // accept exactly these seven keys (problemView.js:46-83).
  const FIELDS = ["mode", "severity", "kind", "q", "sort", "dir", "page"];

  it("readProblemParams's own return object has exactly this field list", () => {
    expect(Object.keys(readProblemParams({})).sort()).toEqual([...FIELDS].sort());
  });

  it("a populated view round-trips byte-for-byte", () => {
    expect(PROBLEM_COMPARATORS["due"]).toBeTypeOf("function"); // the URL example in the brief
    const view = {
      mode: "problems", severity: "HIGH", kind: "ISSUE", q: "auth", sort: "due", dir: -1, page: 3,
    };
    expect(readProblemParams(problemParamPatch(view))).toEqual(view);
  });

  it("the default view round-trips to the same defaults, not to a stale value", () => {
    const view = { mode: "actions", severity: "", kind: "", q: "", sort: "", dir: 1, page: 0 };
    expect(readProblemParams(problemParamPatch(view))).toEqual(view);
  });

  it("page is 1-based on the wire and 0-based in view state, and the boundary round-trips "
    + "at both ends", () => {
    expect(readProblemParams(problemParamPatch({ ...DEFAULTS_PROBLEM(), page: 0 })).page).toBe(0);
    expect(readProblemParams(problemParamPatch({ ...DEFAULTS_PROBLEM(), page: 1 })).page).toBe(1);
    expect(readProblemParams(problemParamPatch({ ...DEFAULTS_PROBLEM(), page: 9 })).page).toBe(9);
  });
});

function DEFAULTS_PROBLEM() {
  return { mode: "actions", severity: "", kind: "", q: "", sort: "", dir: 1, page: 0 };
}

describe("comboView.js: readComboParams(comboParamPatch(view)) round-trips every "
  + "URL-worthy field", () => {
  const FIELDS = ["open", "cond", "sev", "q", "acct", "proj", "sort", "dir", "page"];

  it("readComboParams's own return object has exactly this field list", () => {
    expect(Object.keys(readComboParams({})).sort()).toEqual([...FIELDS].sort());
  });

  it("a populated view round-trips byte-for-byte", () => {
    expect(ISSUE_COMPARATORS["due"]).toBeTypeOf("function");
    const view = {
      open: "pattern-1", cond: "SENSITIVE_DATA", sev: "HIGH", q: "prod",
      acct: "acct-1", proj: "proj-1", sort: "due", dir: -1, page: 2,
    };
    expect(readComboParams(comboParamPatch(view))).toEqual(view);
  });

  it("the default view round-trips to the same defaults", () => {
    const view = {
      open: "", cond: "", sev: "", q: "", acct: "", proj: "", sort: "", dir: 1, page: 0,
    };
    expect(readComboParams(comboParamPatch(view))).toEqual(view);
  });
});

describe("configView.js: no pure write-side pair — the facet fields round-trip through "
  + "readConfigParams/configQueryParams; mode/sort/dir/page are covered by a source sweep, "
  + "not a runtime round trip", () => {
  it("configQueryParams has no `mode` output at all — it cannot be the write side of the "
    + "full view, only of the ten query facets", () => {
    const out = configQueryParams({ query: emptyConfigQuery(), sort: "severity", descending: true, page: 0 });
    expect(out).not.toHaveProperty("mode");
  });

  it("a populated facet set round-trips through configQueryParams -> readConfigParams", () => {
    const query = {
      q: "auth", severities: ["HIGH", "CRITICAL"], statuses: ["FAILED"], clouds: ["AWS"],
      resourceTypes: ["VirtualMachine"], rules: ["rule-1"], projects: ["proj-1"],
      domains: ["domain-1"], linkage: ["linked"], flags: ["gap", "iac"],
    };
    const wire = configQueryParams({ query, sort: "severity", descending: true, page: 0 }, 50);
    expect(readConfigParams(wire)).toEqual(query);
  });

  it("the empty/default facet set round-trips to the same empty defaults", () => {
    const query = emptyConfigQuery();
    const wire = configQueryParams({ query, sort: "severity", descending: true, page: 0 });
    expect(readConfigParams(wire)).toEqual(query);
  });

  // SOURCE SWEEP for the four fields configView.js does not own. renderConfigFindings's own
  // `view` construction (config.js:66-71) reads all four straight off `params`; `pushParams`
  // (config.js:158-175) writes all four back. Read together, that IS the round trip — just
  // not one a pure function pair can run for us.
  it("config.js's view construction reads mode/sort/dir/page from the URL params it was "
    + "handed", () => {
    expect(configSrc).toMatch(/mode:\s*params\.mode/);
    expect(configSrc).toMatch(/sort:\s*CONFIG_SORTS\.indexOf\(params\.sort\)/);
    expect(configSrc).toMatch(/descending:\s*params\.dir/);
    expect(configSrc).toMatch(/page:\s*Math\.max\(0,\s*Number\(params\.page\)/);
  });

  it("config.js's pushParams writes the same four fields back to the hash", () => {
    const body = functionDeclBody(configSrc, "pushParams");
    expect(body, "pushParams not found").not.toBeNull();
    expect(body).toMatch(/mode:\s*view\.mode/);
    expect(body).toMatch(/sort:\s*view\.sort/);
    expect(body).toMatch(/dir:\s*view\.descending/);
    expect(body).toMatch(/page:\s*view\.page/);
  });

  // PERTURBATION: config.js's own escape hatch is only honest if pushParams can be shown to
  // MISS a field. A copy with `page` dropped from the write side reproduces exactly what a
  // dropped field looks like to this same sweep.
  it("a pushParams copy missing `page` is caught by the same field-presence check", () => {
    const DEFECTIVE = `
      function pushParams(patch) {
        setParams(Object.assign({
          mode: view.mode === "controls" ? null : view.mode,
          sort: view.sort === "severity" ? null : view.sort,
          dir: view.descending === CONFIG_SORT_DESC[view.sort] ? null : (view.descending ? "desc" : "asc"),
        }, patch || {}));
      }
    `;
    const body = functionDeclBody(code(DEFECTIVE), "pushParams");
    expect(body).not.toMatch(/page:\s*view\.page/);
  });
});

function emptyConfigQuery() {
  return {
    q: "", severities: [], statuses: [], clouds: [], resourceTypes: [], rules: [],
    projects: [], domains: [], linkage: [], flags: [],
  };
}

// PERTURBATION (brief's own, named exactly): a `problemParamPatch` rewrite that drops `page`
// — reproduced inline as a string copy of the real function with the `page` line removed,
// never applied to problemView.js. Run through the SAME round-trip shape the real `it`s
// above use, over a populated view whose page is not the default (0), so dropping the field
// is visible rather than accidentally matching by coincidence.
describe("PERTURBATION: a problemParamPatch rewrite that drops `page` fails the round trip", () => {
  it("readProblemParams(defectivePatch(view)).page is wrong once page is missing from the "
    + "patch", () => {
    function defectivePatch(state) {
      const s = state || {};
      return {
        mode: s.mode && s.mode !== "actions" ? s.mode : "",
        severity: s.severity || "",
        kind: s.kind || "",
        q: s.q || "",
        sort: s.sort || "",
        dir: s.sort && s.dir === -1 ? "-1" : "",
        // `page` deliberately omitted — the defect under test.
      };
    }
    const view = { mode: "problems", severity: "HIGH", kind: "ISSUE", q: "", sort: "due", dir: -1, page: 3 };
    const roundTripped = readProblemParams(defectivePatch(view));
    // The real pair (asserted above) returns page: 3 for this view. The defective one loses
    // it back to the default, 0 — the exact shape a reviewer would see on screen: page 4
    // silently resets to page 1 on any repaint that re-reads the URL.
    expect(roundTripped.page).toBe(0);
    expect(roundTripped.page).not.toBe(view.page);
    // The real function, for contrast, gets it right — proving the defect is in the COPY,
    // not in a coincidence of the test fixture.
    expect(readProblemParams(problemParamPatch(view)).page).toBe(3);
  });
});

// =========================================================================================
//  2. The persist sweep
// =========================================================================================
//
// A small, generic source-text toolkit — comment-stripped input, balanced-brace body
// extraction, and up to N hops through named page-local helpers — rather than a fixed list
// of anchors. Modelled on this file's own siblings (`test/chartTable.test.js`'s windowed
// same-array check; the `code()` comment stripper every sweep in this repo shares).

/** The text of the `{ … }` block starting at `src[openIdx]` (which must be `"{"`), skipping
 *  over string/template literals so a stray brace inside one never miscounts. `code()` has
 *  already stripped comments, so this is the one remaining hazard. */
function balancedBody(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    } else if (c === "'" || c === "\"" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
    }
  }
  throw new Error("unbalanced braces starting at " + openIdx);
}

/** Index of the closure's own `=>`, bounded to `maxLookahead` characters past the marker —
 *  wide enough for `async ()`/`(x, y)` parameter lists, narrow enough that a BARE reference
 *  (`onclick: openRow(row)`, no arrow at all) never accidentally binds to some unrelated
 *  arrow function much later in the file. Returns -1 for a bare reference — out of this
 *  sweep's scope by construction, the same way a row-open action is out of scope everywhere
 *  else in this package. */
function arrowAfter(src, from, maxLookahead = 80) {
  const rel = src.slice(from, from + maxLookahead).indexOf("=>");
  return rel < 0 ? -1 : from + rel;
}

/** The closure body starting right after `arrowIdx`'s `=>` — the balanced block for a
 *  `{ … }` body, or a bounded window for a one-line expression body (every expression-bodied
 *  closure this sweep finds is a single short call, e.g. `setView("table")`). */
function closureBodyAt(src, arrowIdx) {
  let i = arrowIdx + 2;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === "{") return balancedBody(src, i);
  return src.slice(i, Math.min(src.length, i + 200));
}

/** Every `key:` closure header for the given key names inside `src.slice(range.start,
 *  range.end)`, plus every `.addEventListener("input", …)` in the same span (this repo's
 *  stand-in for an inline `oninput:` where a search box debounces). Generic over occurrence
 *  — it does not know in advance how many there are, so a newly added, unwired control is
 *  found the same way an existing one is. */
function closures(src, keys, range) {
  const from = range ? range.start : 0;
  const to = range ? range.end : src.length;
  const region = src.slice(from, to);
  const out = [];
  for (const key of keys) {
    const re = new RegExp("\\b" + key + "\\s*:", "g");
    let m;
    while ((m = re.exec(region))) {
      const markerEnd = m.index + m[0].length;
      const arrow = arrowAfter(region, markerEnd);
      if (arrow < 0) continue; // a bare reference, e.g. onclick: openRow(row) — out of scope
      out.push({ key, at: from + m.index, body: closureBodyAt(region, arrow) });
    }
  }
  const inputRe = /\.addEventListener\(\s*["']input["']/g;
  let m;
  while ((m = inputRe.exec(region))) {
    const arrow = arrowAfter(region, m.index, 200);
    if (arrow < 0) continue;
    out.push({ key: "addEventListener(input)", at: from + m.index, body: closureBodyAt(region, arrow) });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** `{ start, end }` of the balanced `{ … }` body of `function NAME(...) { … }`, found by
 *  name — the region a per-function sweep is scoped to. `null` when the file has no such
 *  declaration. */
function functionSpan(src, name) {
  const m = new RegExp("function\\s+" + name + "\\s*\\(").exec(src);
  if (!m) return null;
  const openParen = src.indexOf("(", m.index);
  let depth = 0;
  let i = openParen;
  for (; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  while (i < src.length && /\s/.test(src[i])) i++;
  const body = balancedBody(src, i);
  return { start: i, end: i + body.length };
}

/** Same idea as `functionSpan`, but returns the body TEXT (for `function NAME(...) {…}` and
 *  for `const NAME = (...) => {…}` alike) — used to verify a named helper a closure calls
 *  into actually bottoms out at the persist call. `null` when `name` is declared neither
 *  way. */
function functionDeclBody(src, name) {
  const span = functionSpan(src, name);
  if (span) return src.slice(span.start, span.end);
  const m = new RegExp("const\\s+" + name + "\\s*=").exec(src);
  if (!m) return null;
  const arrow = arrowAfter(src, m.index, 200);
  if (arrow < 0) return null;
  return closureBodyAt(src, arrow);
}

function callsAny(body, names) {
  return names.some((n) => new RegExp("\\b" + n + "\\s*\\(").test(body));
}

/** A closure that deliberately leaves the page (`navigate(...)`, fact 4's other half) owes
 *  nothing to the view it is about to abandon. */
function navigatesAway(body) {
  return /\bnavigate\s*\(/.test(body);
}

/** Does `body` reach the page's persist call, directly or through up to `hops` named
 *  page-local helpers (each independently resolved by name and recursed into)? */
function reachesPersist(body, src, persistNames, helperNames, hops) {
  if (navigatesAway(body)) return true;
  if (callsAny(body, persistNames)) return true;
  if (hops <= 0) return false;
  for (const helper of helperNames) {
    if (callsAny(body, [helper])) {
      const helperBody = functionDeclBody(src, helper);
      if (helperBody && reachesPersist(helperBody, src, persistNames, helperNames, hops - 1)) {
        return true;
      }
    }
  }
  return false;
}

function describeGap(file, list, src, persistNames, helperNames, hops) {
  return list
    .map((c) => ({ c, ok: reachesPersist(c.body, src, persistNames, helperNames, hops) }))
    .filter((r) => !r.ok)
    // Whitespace collapsed BEFORE slicing — a body preceded by a multi-line, now-blank
    // (comment-stripped) run of whitespace would otherwise slice off nothing but that.
    .map((r) => `${file} ${r.c.key} at offset ${r.c.at}: `
      + `"${r.c.body.replace(/\s+/g, " ").trim().slice(0, 80)}"`);
}

// ---- problems.js: toolbar( only (read-only file; actionToolbar( excluded, see below) ----

describe("problems.js: every persist-worthy toolbar closure reaches persist()", () => {
  const span = functionSpan(problemsSrc, "toolbar");

  it("toolbar( was found (a rename here would silently empty this whole sweep)", () => {
    expect(span).not.toBeNull();
  });

  const list = span ? closures(problemsSrc, ["onToggle", "onChange", "onclick"], span) : [];

  it("toolbar( has at least the four controls read at package start (severity pills, the "
    + "kind select, the debounced search box, Clear filters)", () => {
    expect(list.length).toBeGreaterThanOrEqual(4);
  });

  it("every one of them calls persist()", () => {
    const gaps = describeGap("problems.js toolbar(", list, problemsSrc, ["persist"], [], 0);
    expect(gaps, gaps.join("\n")).toEqual([]);
  });

  // The exclusion, stated rather than silently applied: actionToolbar( genuinely does NOT
  // call persist() from any of its four closures, and that is correct — problems.js's own
  // comment (quoted in this file's header) says the action-mode filters are page-local and
  // ephemeral, never read by problemParamPatch. A future change that starts persisting them
  // would need to ADD them to problemParamPatch's field list first, at which point this
  // package's round-trip section above (not this one) is where that gets pinned.
  it("actionToolbar( is excluded on purpose, and the source still says why", () => {
    // Line-wrapped across a `//` continuation in the source, hence the tolerant gap.
    expect(problemsRaw).toMatch(/without ever[\s\S]{0,40}being read by/);
    const actionSpan = functionSpan(problemsSrc, "actionToolbar");
    expect(actionSpan).not.toBeNull();
    const actionList = closures(problemsSrc, ["onToggle", "onChange", "onclick"], actionSpan);
    expect(actionList.length).toBeGreaterThanOrEqual(3);
    const anyPersists = actionList.some((c) => /\bpersist\s*\(/.test(c.body));
    // If this ever flips true, the exclusion above is stale and the round-trip section needs
    // aSeverity/aKind/aQ/aSort/aDir added to problemParamPatch's field list.
    expect(anyPersists).toBe(false);
  });
});

// ---- combos.js: patternsHeader(, matrixCard(, patternCard(, issueFilterBar( ----
// (issueFilterField's own onChange: is a parameter pass-through, checked separately below —
// assetRow's chip/expand closures are a different function entirely and never enter scope.)

describe("combos.js: every persist-worthy toolbar closure reaches persist(), directly or "
  + "through openPattern/rerender, or deliberately navigates away", () => {
  const FNS = ["patternsHeader", "matrixCard", "patternCard", "issueFilterBar"];
  const spans = FNS.map((fn) => functionSpan(combosSrc, fn));

  it("all four toolbar-adjacent functions were found", () => {
    for (const [i, span] of spans.entries()) expect(span, FNS[i]).not.toBeNull();
  });

  const list = spans.flatMap((span) =>
    closures(combosSrc, ["onToggle", "onChange", "onclick"], span));

  it("found at least the severity pills, the condition buttons, the row-jump chip, the two "
    + "Clear-filters buttons, the issues toggle, Open in graph, and the search box", () => {
    expect(list.length).toBeGreaterThanOrEqual(7);
  });

  it("every one of them reaches persist() (openPattern/rerender count as one hop) or "
    + "navigates away", () => {
    const gaps = describeGap("combos.js", list, combosSrc, ["persist"], ["openPattern", "rerender"], 1);
    expect(gaps, gaps.join("\n")).toEqual([]);
  });

  it("openPattern and rerender each independently reach persist() — the hop this sweep "
    + "relies on is not itself a guard that fires on nothing", () => {
    expect(functionDeclBody(combosSrc, "openPattern")).toMatch(/\bpersist\s*\(/);
    expect(functionDeclBody(combosSrc, "rerender")).toMatch(/\bpersist\s*\(/);
  });
});

describe("combos.js: issueFilterField's onChange delegates to its own `onChange` PARAMETER, "
  + "and both call sites (Account, Project) pass `rerender`, which reaches persist()", () => {
  const span = functionSpan(combosSrc, "issueFilterField");

  it("issueFilterField( was found", () => {
    expect(span).not.toBeNull();
  });

  it("its onChange body calls its own `onChange` parameter rather than persist() directly "
    + "— this is why it is checked separately from the generic sweep above", () => {
    const body = span ? combosSrc.slice(span.start, span.end) : "";
    expect(body).toMatch(/onChange\s*:\s*\(v\)\s*=>\s*\{[^}]*\bonChange\(\)/);
  });

  it("every call site (not the declaration itself) passes rerender as the callback", () => {
    // Excludes the declaration line, `function issueFilterField(labelText, key, values,
    // onChange, optionLabel) {` — a call site never has the `function` keyword right before
    // its own name.
    const re = /issueFilterField\([^)]*\)/g;
    const sites = [];
    let m;
    while ((m = re.exec(combosSrc))) {
      const before = combosSrc.slice(Math.max(0, m.index - 10), m.index);
      if (!/function\s+$/.test(before)) sites.push(m[0]);
    }
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const site of sites) expect(site, site).toMatch(/,\s*rerender\)/);
  });

  it("rerender reaches persist()", () => {
    expect(functionDeclBody(combosSrc, "rerender")).toMatch(/\bpersist\s*\(/);
  });
});

// ---- config.js: whole file (only 5 marker occurrences total, all toolbar-adjacent) ----

describe("config.js: every persist-worthy toolbar closure reaches pushParams()", () => {
  const list = closures(configSrc, ["onToggle", "onChange", "onclick", "oninput"], null);

  it("found the severity strip, the by-control/by-finding segmented control, the search "
    + "box, the facet pills and Clear filters — exactly 5, matching this package's own "
    + "measurement (no other onToggle/onChange/onclick/oninput exists in this file)", () => {
    expect(list.length).toBe(5);
  });

  it("every one of them reaches pushParams() (toggleFacet counts as one hop)", () => {
    const gaps = describeGap("config.js", list, configSrc, ["pushParams"], ["toggleFacet"], 1);
    expect(gaps, gaps.join("\n")).toEqual([]);
  });

  it("toggleFacet itself reaches pushParams() directly", () => {
    expect(functionDeclBody(configSrc, "toggleFacet")).toMatch(/\bpushParams\s*\(/);
  });
});

// ---- inventory.js: countHeader(, toolbar(, savedViewsControl(, buildDrawer(, ----
// ---- renderResultsInner( (small deltas only; measured, no code change needed here) ----

describe("inventory.js: every persist-worthy toolbar closure reaches persistParams(), "
  + "directly or through toggleFacet/onFilterChange/setView, or deliberately navigates "
  + "away", () => {
  const FNS = ["countHeader", "toolbar", "savedViewsControl", "buildDrawer", "renderResultsInner"];
  const spans = FNS.map((fn) => functionSpan(inventorySrc, fn));

  it("all five functions were found", () => {
    for (const [i, span] of spans.entries()) expect(span, FNS[i]).not.toBeNull();
  });

  const list = spans.flatMap((span) =>
    closures(inventorySrc, ["onToggle", "onChange", "onclick"], span));

  it("found at least the severity strip toggle, the table/cards buttons, the Save-view "
    + "button, the facet drawer toggles, the drawer's Clear all, and the empty-state's "
    + "Clear all filters", () => {
    expect(list.length).toBeGreaterThanOrEqual(6);
  });

  it("every one of them reaches persistParams() (toggleFacet/onFilterChange/setView count "
    + "as up to two hops) or navigates away", () => {
    const gaps = describeGap(
      "inventory.js", list, inventorySrc, ["persistParams"],
      ["toggleFacet", "onFilterChange", "setView"], 2,
    );
    expect(gaps, gaps.join("\n")).toEqual([]);
  });

  it("the two-hop chain (toggleFacet -> onFilterChange -> persistParams) is real, not a "
    + "guard that fires on nothing", () => {
    const toggleFacetBody = functionDeclBody(inventorySrc, "toggleFacet");
    expect(toggleFacetBody).not.toMatch(/\bpersistParams\s*\(/); // NOT direct — proves the hop matters
    expect(toggleFacetBody).toMatch(/\bonFilterChange\s*\(/);
    expect(functionDeclBody(inventorySrc, "onFilterChange")).toMatch(/\bpersistParams\s*\(/);
    expect(functionDeclBody(inventorySrc, "setView")).toMatch(/\bpersistParams\s*\(/);
  });

  it("the saved-view select's own change listener deliberately navigate()s instead of "
    + "persisting — the source names why, and this sweep's markers do not even match "
    + "addEventListener(\"change\", …) so it was never at risk of a false failure", () => {
    expect(inventoryRaw).toMatch(/wholesale state change deserves a history entry/);
    expect(inventorySrc).not.toMatch(/addEventListener\(\s*["']input["']\s*,[\s\S]{0,40}change/);
  });
});

// =========================================================================================
//  3. PERTURBATION — a dropped persist() call in a string copy, never applied to any real
//     file, run through the SAME sweep the sections above use
// =========================================================================================

describe("PERTURBATION: dropping persist() from one handler in a string copy is caught, "
  + "and the sweep names which one", () => {
  it("a three-closure toolbar with the middle one missing its persist call fails exactly "
    + "that closure, not the other two", () => {
    const REGRESSED = code(`
      function toolbar() {
        const pills = togglePills({
          onToggle: (o) => {
            view.severity = o;
            persist();
            paint();
          },
        });
        const kindField = select({
          onChange: (v) => {
            // BUG: the kind select repaints without ever calling persist() — dropped in
            // this copy on purpose. A reader who picks "Finding" and reloads the page (or
            // shares the link) silently loses the filter they just set.
            view.kind = v;
            paint();
          },
        });
        const clear = el("button", {
          onclick: () => {
            view.severity = "";
            view.kind = "";
            persist();
            paint();
          },
        });
        return el("div", {}, pills, kindField, clear);
      }
    `);
    const span = functionSpan(REGRESSED, "toolbar");
    const list = closures(REGRESSED, ["onToggle", "onChange", "onclick"], span);
    expect(list).toHaveLength(3);
    const gaps = describeGap("REGRESSED toolbar(", list, REGRESSED, ["persist"], [], 0);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("onChange");
    expect(gaps[0]).toContain("view.kind = v");
  });
});
