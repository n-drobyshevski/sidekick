// The DOM-free half of dev/density.mjs — the Playwright walker's rendered-page complement to
// gas_shared/measure.mjs. That file measures the SOURCE (line counts, greps, a scorecard);
// this pair measures what a reader actually SEES: words, numbers, tables and pictures on a
// live page. Split the same way `figures.js`/`figuresModel` and every other pure/DOM pair in
// this repo is split, because vitest here runs with NO jsdom (`vitest.config.ts` sets no
// `environment`) — a function that needs a real `document` cannot be unit-tested at all, so
// every decision that CAN be made without one lives here, and density.mjs imports it rather
// than re-deriving it in a page.evaluate() string nobody can run under vitest.
//
// EVERY FUNCTION BELOW OPERATES ON A PLAIN-OBJECT TREE, NEVER A REAL DOM NODE:
//   element node = { tag: "P", classes: ["small","muted"], open?: bool, hidden?: bool,
//                     rect?: {width,height}, children: [ ...nodes ] }
//   text node    = a plain JS string
// density.mjs's own browser-side serializer (the one function in this pair that MUST run
// inside the page, because only the page has a `document`) walks the real `main`/`#app`
// subtree and produces exactly this shape via `structuredClone`-safe plain objects, which is
// what page.evaluate() hands back to Node. Every exclusion rule below — closed <details>,
// .sr-only, `[hidden]`, table-cell text, the nav rail/appbar — is then decided ONCE, in one
// place, on data any test file can construct by hand: "feed a fake node tree" in the test
// file below is not a metaphor, it is the literal calling convention.
//
// WHAT THIS FILE MUST NOT DO: reach for `document`, `window`, or any browser global. The
// moment it does, it stops being importable from a vitest run with no DOM, and the walker's
// own claim to be testable "with no browser" (the plan's own words) becomes false the next
// time someone edits it.

// ============================================================================================
//  Tree predicates — each one the SAME check density.mjs's browser-side serializer and this
//  module's own extraction/counting walks both key off, so a test on a fake tree here is a
//  test of the real exclusion rule, not a restatement of it.
// ============================================================================================

/** A <details> the reader has not opened. Checking `tag` alone — the tempting
 *  simplification, since most `<details>` in this register ship closed by default — would
 *  also exclude an OPENED one's content, which is wrong the moment a reader (or a Playwright
 *  `.click()`) opens it. `open` must be checked, not just presence of the tag; the
 *  perturbation test below reproduces the tag-only rewrite and shows it over-excluding. */
export function isClosedDetails(node) {
  return !!node && typeof node === "object" && node.tag === "DETAILS" && node.open !== true;
}

/** The one "present but not displayed" utility (`gas_shared/styles/base.css`'s `.sr-only`) —
 *  visually a 1x1px clipped box, so a naive "has a bounding box" visibility check would count
 *  it. This checks the class the way the stylesheet defines the exclusion, not the box. */
export function isSrOnly(node) {
  return !!node && typeof node === "object" && Array.isArray(node.classes)
    && node.classes.includes("sr-only");
}

/** `<table>`, `<td>`, `<th>` — cells are counted separately (`tableCells`/`tables` below)
 *  rather than folded into prose, per R4's "picture over table": a long numeric table reads
 *  as data, not as words, and counting its digits as "prose" would hide exactly the page
 *  this wave is trying to shrink. */
export function isTable(node) {
  return !!node && node.tag === "TABLE";
}
export function isTableCell(node) {
  return !!node && (node.tag === "TD" || node.tag === "TH");
}

/** The rail/appbar/flyout are siblings of `main`, never descendants — walking from `main`
 *  already excludes them. This guard exists only for the `#app` fallback (no `main` element
 *  found), the one path where the shell's own chrome could end up inside the walked subtree. */
export function isNavChrome(node) {
  if (!node || !Array.isArray(node.classes)) return false;
  return node.classes.includes("appbar") || node.classes.includes("sidebar")
    || node.classes.includes("nav-flyout");
}

/**
 * A node's tag, upper-cased — and the reason this exists is a defect the first two runs of
 * this walker shipped.
 *
 * `Element.tagName` upper-cases an HTML element and PRESERVES CASE on an element in the SVG
 * namespace, so a real `<svg>` on a real page serialises as `"svg"`, never `"SVG"`. Every
 * comparison in this file was written against the HTML spelling, so `isIconSvg` returned
 * false for every SVG ever measured and the walker's `svg` bucket read 0 on all eleven
 * routes — including `history`, which draws a 360px quarterly spiral. A zero that looked
 * like "this page has no SVG" was really "this predicate has never once fired", which is the
 * finding CLAUDE.md names twice ("a guard that fires on nothing"; "a zero has to prove it
 * looked").
 *
 * Normalised HERE rather than in density.mjs's serializer, deliberately: the model is the
 * half a test can hold, so the robustness belongs where the test can see it, and a hand-built
 * fixture spelling it either way then means the same thing.
 */
export function tagOf(node) {
  return node && typeof node === "object" && typeof node.tag === "string"
    ? node.tag.toUpperCase()
    : "";
}

/** An icon-sized <svg> — decoration, not a visual the wave is trying to grow. 20px is the
 *  plan's own threshold ("excluding icons <= 20px"); `rect` is populated only for
 *  svg/canvas nodes by the serializer, so its absence (an svg the serializer never measured)
 *  reads as "not icon-sized" rather than silently passing the exclusion either way. */
export function isIconSvg(node) {
  if (!node || tagOf(node) !== "SVG") return false;
  const r = node.rect;
  return !!r && r.width <= 20 && r.height <= 20;
}

/**
 * What counts as a PICTURE on a page, and the one rule that keeps the total honest.
 *
 * MOVED HERE FROM density.mjs, because this file's own header states the split: that file
 * "must not decide what counts as a word, a number, a prose block, or a diff — those are
 * pure questions with pure answers". What counts as a VISUAL is the same kind of question,
 * and leaving it on the Playwright side is why two of these eight buckets could sit dead
 * through two runs with nothing to fail:
 *
 *   `svg`    never matched, because of the tag-case defect `tagOf` above records;
 *   `spark`  looked for the class `spark`, and the shared component is `.sparkline` — the
 *            rename is deliberate and documented at length (gas_shared/ui/sparkline.js:
 *            `gas` already owns `.spark` for a bordered card), so this predicate was reading
 *            for a class that by design does not exist.
 *
 * ONE NODE IS COUNTED ONCE. The buckets used to be independent counts summed into `total`,
 * which was harmless only for as long as no visual was BOTH an `<svg>` and a named class —
 * and a sparkline is exactly that. So the named-class buckets come first and the two element
 * buckets are last, with `svg` explicitly declining anything a named bucket already claimed.
 * A double count would show up as the wave inventing a picture it did not draw.
 */
const NAMED_VISUAL_CLASSES = ["meter", "sevbar", "axis-bar", "isotype", "quad", "sparkline"];

function hasNamedVisual(node) {
  return !!node && Array.isArray(node.classes)
    && NAMED_VISUAL_CLASSES.some((c) => node.classes.includes(c));
}

const hasClass = (name) => (n) => !!n && Array.isArray(n.classes) && n.classes.includes(name);

/** One list, not two: the all-zero fallback shape density.mjs uses for a route that never
 *  settled is DERIVED from this, so a bucket added here cannot drift out of sync with it. */
export const VISUAL_PREDICATES = [
  ["meter", hasClass("meter")],
  ["sevbar", hasClass("sevbar")],
  ["axisBar", hasClass("axis-bar")],
  ["isotype", hasClass("isotype")],
  ["quad", hasClass("quad")],
  ["spark", hasClass("sparkline")],
  ["canvas", (n) => tagOf(n) === "CANVAS"],
  ["svg", (n) => tagOf(n) === "SVG" && !isIconSvg(n) && !hasNamedVisual(n)],
];

export function countVisuals(tree) {
  const visuals = { total: 0 };
  for (const [name, pred] of VISUAL_PREDICATES) {
    visuals[name] = tree ? countVisible(tree, pred) : 0;
    visuals.total += visuals[name];
  }
  return visuals;
}

// ============================================================================================
//  tipsSignified — does a `.tip-trigger` carry a RESTING affordance, before anything is
//  hovered? DESIGN.md's own words for The Tip: "a `?` mark, a metric label or a column
//  heading becomes a real <button> with a dotted underline ... visible before anything is
//  hovered, because a definition nobody can see is not help." `gas_shared/ui/tip.js` only
//  ever adds `.tip-trigger--term` (the underline) when the help carries a `{term}` — a
//  lines-only tip on a bare word shipped with NO resting affordance at all until pages.css's
//  own app-wide rule (below `.movement-block` in that file) gave every bare-word trigger the
//  same underline. This is the walker's half of MEASURING that fix, not deciding it: the CSS
//  decides what the browser actually paints, and this function only reads the two facts a
//  live page can hand back per trigger.
//
//  A trigger counts as SIGNIFIED by either of two independent affordances, matching
//  DESIGN.md's own two cases side by side ("A badge or a clipped cell ... does not become a
//  control" vs. a bare word, which must be underlined):
//
//    1. a resting text-decoration underline (the bare-word case), or
//    2. an atomic affordance CHILD — `.tip-mark`, `.pill`, `.sev-badge`, `.domain-chip`, a
//       `.quad-label`/`.sevkey` chip — which already carries its own visible boundary (a
//       tint, a border, a glyph) and is EXEMPT from the underline rule for the reason
//       `components.css`'s own `.tip-trigger--term` comment gives: an atomic inline box
//       (inline-flex/inline-block) does not take a parent's `text-decoration` in the first
//       place, so decorating the wrapping trigger would paint nothing anyway. A pill-wrapped
//       trigger is not an oversight to fix — it is already signified, just not by a line.
//
//  Fed `{ decoration, childClasses }` — a plain record density.mjs's browser-side reader
//  builds per trigger, never a real DOM node, for the same DOM-free-test reason every other
//  predicate in this file exists.
const TIP_AFFORDANCE_CHILD_CLASSES = ["tip-mark", "pill", "sev-badge", "domain-chip", "quad-label", "sevkey"];

export function isTipSignified(record) {
  if (!record || typeof record !== "object") return false;
  const decoration = typeof record.decoration === "string" ? record.decoration : "";
  if (decoration.split(/\s+/).includes("underline")) return true;
  const childClasses = Array.isArray(record.childClasses) ? record.childClasses : [];
  return TIP_AFFORDANCE_CHILD_CLASSES.some((c) => childClasses.includes(c));
}

/**
 * The `[hidden]` ATTRIBUTE — not asked for by name in the plan's own exclusion list, but
 * found by measurement rather than assumed away: `gas_shared/styles/base.css`'s one-line
 * reset (`[hidden]{display:none!important}`) is the WHOLE show/hide mechanism this design
 * system uses for a tab panel, a field error, an inline warning — settings.js alone toggles
 * it eleven times. Without this check the walker's first live run counted an inactive
 * settings TAB as though its panel were on screen (three tabs' worth of prose and tips
 * folded into one route's total, and a tip-trigger sitting in a panel nobody is looking at
 * reported as a keyboard-reachability FAILURE, because `.focus()` on a `display:none`
 * ancestor is a silent no-op — a walker bug reading as a page bug). `.sr-only` and a closed
 * `<details>` both already have their own dedicated CSS; `[hidden]` is the generic case
 * underneath all three, checked here as its own rule rather than folded into either.
 */
export function isHiddenAttr(node) {
  return !!node && node.hidden === true;
}

function excluded(node) {
  return isClosedDetails(node) || isSrOnly(node) || isNavChrome(node) || isHiddenAttr(node);
}

// ============================================================================================
//  Extraction — walking the tree once per question, never mutating it
// ============================================================================================

/**
 * Concatenate the visible text under `node`, honouring every exclusion above.
 *
 * `excludeTables`, when true, drops everything under a `<table>` from the returned text —
 * the "words" reading (table cell text is counted separately as `tableCells`). When false —
 * the "numbers" reading — table text is KEPT, because the plan states the numbers count only
 * excludes closed details, and most of this register's figures live in exactly the tables
 * this function would otherwise blind itself to.
 */
export function extractText(node, opts = {}) {
  const { excludeTables = false, inTable = false } = opts;
  if (node == null) return "";
  if (typeof node === "string") return inTable ? "" : node;
  if (excluded(node)) return "";
  const nowInTable = inTable || (excludeTables && isTable(node));
  const children = Array.isArray(node.children) ? node.children : [];
  return children.map((c) => extractText(c, { excludeTables, inTable: nowInTable })).join(" ");
}

/** Count every element under `node` for which `predicate` is true, honouring the same
 *  exclusion rules as `extractText` — a `<td>` inside a closed `<details>` is not on screen
 *  and must not be counted, the same reasoning `extractText` applies to its text. */
export function countVisible(node, predicate) {
  if (node == null || typeof node !== "object") return 0;
  if (excluded(node)) return 0;
  let count = predicate(node) ? 1 : 0;
  const children = Array.isArray(node.children) ? node.children : [];
  for (const c of children) count += countVisible(c, predicate);
  return count;
}

// ============================================================================================
//  Words, numbers, prose blocks
// ============================================================================================

/** A "word" is a run with at least one letter or digit — `handTypedDash`-style punctuation
 *  ("—", "·", a bare bullet) never counts on its own, so a page that replaced three
 *  paragraphs with a single em-dash-separated caption does not read as having kept its word
 *  count. Internal apostrophes/hyphens stay part of one token ("reader's", "cross-link"). */
export function countWords(text) {
  if (!text) return 0;
  const m = String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/**
 * A visible numeric token: digits, optionally with a leading `≥`/`±` (attached with no more
 * than whitespace between the two, so "≥ 41" is ONE token, never "≥" plus "41") and/or a
 * trailing "%". The lookaround pair stops a token being carved out of the middle of a word
 * ("wct-id-1998" still counts "1998" — the identifier is not the concern here — but "AARS4"
 * does not split into a bare "4").
 */
export const NUMERIC_TOKEN_RE = /(?<![\p{L}])(?:[≥±]\s*)?\d[\d.,]*%?(?![\p{L}])/gu;

export function countNumericTokens(text) {
  if (!text) return 0;
  const m = String(text).match(NUMERIC_TOKEN_RE);
  return m ? m.length : 0;
}

/** R2's threshold for "this is prose, not a label": 15 words. A denominator sub like
 *  "9 of 12 findings" (COMPRESS) sits well under it; a `denomNote` sentence (KEEP/DISCLOSE
 *  candidate) clears it. */
export const PROSE_MIN_WORDS = 15;

/** The selectors R1/R2 name as prose carriers, tag-or-class. `.small.muted` needs BOTH
 *  classes present on the one node — a `.small` chip with no `.muted` (a count badge, say)
 *  is not what the plan means by a method note. */
export function isProseCandidate(node) {
  if (!node || typeof node !== "object") return false;
  if (node.tag === "P" || node.tag === "LI") return true;
  const classes = Array.isArray(node.classes) ? node.classes : [];
  if (classes.includes("small") && classes.includes("muted")) return true;
  return ["chart-note", "section-note", "kpi-sub", "stat-sub", "page-hero-sub"]
    .some((c) => classes.includes(c));
}

/**
 * Every prose-candidate block, visible and outside a closed `<details>`, at or above
 * `minWords`. Returns `{ text, words }` per block rather than just a count, so a caller (or a
 * failing test) can see WHICH sentence tipped a page over — the same reason `tipFailures`
 * below names its triggers instead of just counting them.
 */
export function collectProseBlocks(root, minWords = PROSE_MIN_WORDS) {
  const out = [];
  function walk(node) {
    if (node == null || typeof node !== "object" || excluded(node)) return;
    if (isProseCandidate(node)) {
      const text = extractText(node, { excludeTables: true });
      const words = countWords(text);
      if (words >= minWords) out.push({ text, words });
    }
    const children = Array.isArray(node.children) ? node.children : [];
    for (const c of children) walk(c);
  }
  walk(root);
  return out;
}

// ============================================================================================
//  Route list — parsed from app.js's own PAGES table, never hand-typed
// ============================================================================================

/**
 * The exact regex `test/pagesLit.test.js`'s own `parsePages()` uses, lifted here rather than
 * imported (that file is a `describe`/`it` module, not an export site, and duplicating six
 * lines of regex is cheaper than making a test file importable). If `app.js`'s PAGES table
 * ever changes shape, that test fails first — this function failing alongside it, rather than
 * silently returning `[]` and making the walker "measure" zero routes, is the point of
 * `density.test.js`'s own parsePages coverage below.
 */
export function parsePages(appSrc) {
  const marker = "const PAGES = {";
  const start = appSrc.indexOf(marker);
  if (start === -1) return [];
  const end = appSrc.indexOf("\n};", start);
  const body = appSrc.slice(start, end === -1 ? undefined : end);
  const out = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s{2}(\w+):\s*\{(.*)$/);
    if (!m) continue;
    const renderMatch = m[2].match(/render:\s*(\w+)/);
    out.push({ route: m[1], render: renderMatch ? renderMatch[1] : null });
  }
  return out;
}

// ============================================================================================
//  Table formatting — one aligned-column renderer for both the density table and the diff
// ============================================================================================

export function formatTable(headers, rows) {
  const widths = headers.map((h, i) => (
    Math.max(String(h).length, ...rows.map((r) => String(r[i] ?? "").length), 0)
  ));
  const line = (cells) => cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

/** "N route(s) exceed <viewport>px" or the honest "none do" — never silent about a viewport
 *  nobody measured over budget, and never silent about one that IS clean either. */
export function overflowSummary(routeRows, viewportWidth) {
  const over = routeRows.filter((r) => Number(r.scrollWidth) > Number(viewportWidth));
  if (!over.length) return `no route exceeds ${viewportWidth}px`;
  return `${over.length} route(s) exceed ${viewportWidth}px: `
    + over.map((r) => `${r.route} (${r.scrollWidth}px)`).join(", ");
}

// ============================================================================================
//  Diff — before.json vs after.json, one row per route, EVERY metric, EVERY delta
// ============================================================================================

/** The columns a diff reports. Each getter reads one snapshot's per-viewport record; a
 *  route/viewport absent from either side reads as `null`, never `0` — the same
 *  absent-is-never-zero rule CLAUDE.md states for every other figure in this repo, applied
 *  here to "this route did not exist in the BEFORE snapshot" rather than "it measured zero". */
export const DIFF_METRICS = [
  ["words", (r) => r.words],
  ["proseBlocks", (r) => r.proseBlocks],
  ["proseWords", (r) => r.proseWords],
  ["numbers", (r) => r.numbers],
  ["tableCells", (r) => r.tableCells],
  ["visualsTotal", (r) => r.visuals && r.visuals.total],
  ["tips", (r) => r.tips],
  ["tipsReachable", (r) => r.tipsReachable],
  ["tipsSignified", (r) => r.tipsSignified],
  ["scrollWidth", (r) => r.scrollWidth],
];

function metricValue(record, get) {
  if (!record) return null;
  const v = get(record);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** One route's before/after/delta for every metric in `DIFF_METRICS`. `delta` is `null`
 *  whenever either side is unmeasured (route missing, or the field itself absent) — NEVER a
 *  computed `0 - 0` standing in for "nothing to compare", and never omitted when it genuinely
 *  IS zero (a route that moved by exactly nothing is a finding, per CLAUDE.md, not a blank). */
export function diffRoute(beforeRecord, afterRecord) {
  const out = {};
  for (const [key, get] of DIFF_METRICS) {
    const before = metricValue(beforeRecord, get);
    const after = metricValue(afterRecord, get);
    out[key] = {
      before,
      after,
      delta: before !== null && after !== null ? after - before : null,
    };
  }
  return out;
}

/** Every route from either snapshot, sorted, at one viewport (default "1280" — the plan's
 *  own "the main counts" viewport). A route present in only one snapshot still gets a row: an
 *  ADDED or REMOVED route is itself a finding this table must not hide by only listing the
 *  intersection. */
export function diffReport(beforeDoc, afterDoc, viewport = "1280") {
  const beforeRoutes = (beforeDoc && beforeDoc.routes) || {};
  const afterRoutes = (afterDoc && afterDoc.routes) || {};
  const routes = Array.from(new Set([...Object.keys(beforeRoutes), ...Object.keys(afterRoutes)]))
    .sort();
  return routes.map((route) => ({
    route,
    diff: diffRoute(beforeRoutes[route] && beforeRoutes[route][viewport],
      afterRoutes[route] && afterRoutes[route][viewport]),
  }));
}

/** `before→after (Δ)` per cell. A `null` delta (route or field absent on one side) prints as
 *  the literal values with no parenthetical rather than a dash pretending they were equal. A
 *  zero delta prints `(0)`, in the open — CLAUDE.md: "a number that does not move is a
 *  finding, not a success", and a finding that is not printed is one nobody can act on. */
export function formatDiffTable(diffRows) {
  const keys = DIFF_METRICS.map(([k]) => k);
  const headers = ["route", ...keys];
  const rows = diffRows.map(({ route, diff }) => [
    route,
    ...keys.map((k) => {
      const d = diff[k];
      const b = d.before === null ? "—" : d.before;
      const a = d.after === null ? "—" : d.after;
      if (d.delta === null) return `${b}→${a}`;
      const sign = d.delta > 0 ? "+" : "";
      return `${b}→${a} (${sign}${d.delta})`;
    }),
  ]);
  return formatTable(headers, rows);
}
