// THE KEY SHEET, ONCE. Every glossary entry an app's `helpContent.js` defines, in the one
// place a reader can search, browse whole, or land on directly.
//
// WHO CONSUMES THIS, AND WHO DELIBERATELY DOES NOT. `gas/` and `gas_devsecops/` both render
// this module and hand it nothing but their own vocabulary. `gas_ai/` keeps a bespoke page
// and is NOT a defect — see `gas_shared/README.md` ("The one page that is not shared") and
// the header of `gas_ai/src/client/js/pages/help.js`, which state the reason in the two
// places a reader would look. Do not add an option here whose only consumer would be that
// page: the honest shape of a page that is three-quarters different is a different page.
//
// WHAT EACH SIDE OWNS. This module owns the shape: one search field over one flat list, the
// `?term=` deep link, the keyboard shortcuts, and the pure model behind all of it. The app
// owns the WORDS — `helpContent.js` — and one line of wiring in `pages/help.js`. Nothing
// here reaches sideways into an app: a shared module has no `../helpContent.js` to import,
// so the entries arrive as an argument, the same way `appConfig.js` carries `findHelpEntry`.
//
// PURE MODEL, THIN DOM — the split every page in these three packages uses, because none of
// them runs jsdom (no `environment` in any `vitest.config.ts`): `helpModel()` is exercised
// directly by `gas_shared/test/contracts/help.js`, and `renderHelpPage()` is read as source
// text the way every other page's DOM half is.
//
// GROUPING. No consumer's `helpContent.js` carries a family/lane field today — the book is
// one flat list, not sections of it. So the model collapses to at most ONE group,
// alphabetical by term, and the page never draws a heading over it: the same rule `PAGES`
// states for the nav one level up — "a labelled lane earns its heading by holding two
// pages" — applied here to say a single group earns no heading either. The shape stays
// group-based rather than a flat array so a `family` field added later costs a grouping key
// here, not a rewrite.
//
// SEARCH IS WHOLE-WORD-ISH AND CASE-INSENSITIVE. A bare substring match would let a query of
// "sync" hit an entry mentioning "resyncing" mid-word; anchoring each query word to a word
// START (`\b`) keeps a match to whole words and true prefixes ("sync" still matches
// "syncing") without matching inside one. Case-insensitivity is not decorative: a reader who
// types "SAST" the way the term itself is capitalised must not be punished for it — see the
// contract's perturbation, which breaks that on purpose to prove the guard bites.
//
// `?term=` IS IN THE HASH, NOT IN `location.search`, and this is the one trap worth naming
// before anyone edits the deep link. These are hash-routed SPAs: `store.js`'s `parseHash()`
// strips `#/`, splits on the first `?`, then hand-splits on `&` and `=`. `location.search`
// is empty on every route this app has, so a `new URLSearchParams(location.search)` here
// would read nothing, silently, and the deep link would simply stop marking anything. The
// term arrives as `params.term` from the router and leaves through `setParams`.

import { setParams } from "../store.js";
import { clear, el, motionOk } from "./dom.js";
import { emptyState } from "./feedback.js";
import { pageHeader } from "./controls.js";
import { plural } from "./format.js";
import { debounce, onPageTeardown } from "./timing.js";

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(s) {
  return String(s === null || s === undefined ? "" : s).trim().toLowerCase();
}

/** Every word of `words` occurs at a word start somewhere in the entry's term or body. */
function matchesEntry(entry, words) {
  if (!words.length) return true;
  const hay = (entry.term + " " + entry.lines.join(" ")).toLowerCase();
  return words.every((w) => new RegExp("\\b" + escapeRegExp(w)).test(hay));
}

/**
 * The pure half. `entries` is an app's own `allEntries()` (or a stand-in in tests);
 * `query` filters by term and body; `term` is the id a `?term=` deep link named.
 *
 * The matched entry is marked `linked: true` wherever it survives the filter — never thrown
 * on an id the book does not carry, because a stale bookmark is not an error state, only an
 * unmarked one. `match` reports the id back (or null) so the caller knows whether a real
 * entry answered the deep link at all, independent of whether today's search happens to be
 * hiding it.
 *
 * @param {Array<{id:string, term:string, lines:string[]}>} entries
 * @param {string} query
 * @param {string} term
 * @returns {{groups: Array<{family: string|null, entries: Array<{id:string, term:string,
 *   lines:string[], linked:boolean}>}>, match: string|null, total: number}}
 */
export function helpModel(entries, query, term) {
  const list = Array.isArray(entries) ? entries : [];
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const wantId = normalize(term);

  const filtered = list.filter((e) => matchesEntry(e, words));
  const sorted = [...filtered].sort((a, b) => a.term.localeCompare(b.term));

  const rows = sorted.map((e) => ({
    id: e.id,
    term: e.term,
    lines: e.lines.slice(),
    linked: !!wantId && e.id === wantId,
  }));

  return {
    groups: rows.length ? [{ family: null, entries: rows }] : [],
    match: wantId && list.some((e) => e.id === wantId) ? wantId : null,
    total: list.length,
  };
}

// ----------------------------------------------------------------------------- the page

function entryDomId(id) {
  return "term-" + id;
}

/**
 * One entry: its id as the anchor, its full lines (never the tip card's two-line cut), and —
 * only where this is the entry a deep link named — the accent-wash highlight plus the
 * "linked" label. The colour is never the only cue: `aria-current` says the same thing to
 * assistive technology, and the visible tag says it in words.
 */
function entryNode(entry) {
  const node = el("div", {
    class: "help-entry" + (entry.linked ? " help-entry--linked" : ""),
    id: entryDomId(entry.id),
    tabindex: "-1",
    "aria-current": entry.linked ? "true" : null,
  });
  node.append(el("div", { class: "help-entry-term" },
    el("span", {}, entry.term),
    entry.linked ? el("span", { class: "help-entry-linked-tag" }, "↳ linked") : null,
  ));
  for (const line of entry.lines) node.append(el("p", { class: "help-entry-line" }, line));
  return node;
}

function renderGroups(host, groups) {
  clear(host);
  for (const group of groups) {
    // A single group draws no heading — the same "a lane earns its heading by holding more
    // than one thing" rule the nav itself follows (app.js's PAGES header, navModel.js).
    if (group.family && groups.length > 1) {
      host.append(el("h2", { class: "section-label" }, group.family));
    }
    const list = el("div", { class: "help-list" });
    for (const entry of group.entries) list.append(entryNode(entry));
    host.append(list);
  }
}

/** True where `node` is itself editable, so a bare "/" keypress inside it is real input, not
 *  the page's own search-focus shortcut. */
function isEditable(node) {
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!node.isContentEditable;
}

/**
 * The page. `opts.entries` is the app's whole book, resolved by the caller so this module
 * never imports sideways.
 *
 * THE EYEBROW AND THE TITLE ARE NOT LITERALS HERE ANY MORE, and that is a strictly better
 * answer than the one this comment used to defend. It read: the hero says "Data" because both
 * consumers file this route in the Data lane, and `test/contracts/help.js` asserts the lane so
 * the literal cannot lie. True, and it still asserts it — but a literal that has to be policed
 * by a test is a second copy of the route table. `pageHeader({ route: "help" })` reads the lane
 * AND the title out of `appConfig().PAGES` instead, so a third consumer that filed the route
 * elsewhere, or spelled its title differently, gets its own words with nothing to keep in step.
 */
export async function renderHelpPage(host, params, _ctx, opts) {
  const entries = (opts && opts.entries) || [];
  const wantedTerm = normalize(params && params.term);

  host.append(pageHeader({
    route: "help",
    lede: "What every word and mark in this register means, written once and reached from " +
      "anywhere a definition trigger names it.",
  }));

  const label = el("label", { class: "field-label", for: "help-search" }, "Search terms");
  const input = el("input", {
    type: "search",
    id: "help-search",
    placeholder: "Search " + plural(entries.length, "term"),
    "aria-label": "Search the key sheet",
  });
  // role="search" is the landmark; the visible label plus the input's own id/for pairing is
  // what actually names the field, so aria-label above is belt-and-braces for a reader whose
  // AT announces the landmark without walking into it first.
  const searchWrap = el("div", { class: "help-search", role: "search" }, label, input);
  const countHost = el("p", { class: "small muted help-count" });
  const listHost = el("div", {});
  host.append(searchWrap, countHost, listHost);

  let query = "";

  function paint() {
    const model = helpModel(entries, query, wantedTerm);
    const shown = model.groups.reduce((n, g) => n + g.entries.length, 0);
    countHost.textContent = query
      ? shown + " of " + plural(model.total, "term")
      : plural(model.total, "term");
    if (!model.groups.length) {
      clear(listHost).append(emptyState("No term matches “" + query.trim() + "”."));
    } else {
      renderGroups(listHost, model.groups);
    }
    return model;
  }

  const applyQuery = debounce((value) => {
    query = value;
    paint();
  }, 120);

  /** Drop any live search and repaint, so nothing the reader typed is hiding a row. */
  function clearFilter() {
    if (!input.value && !query) return false;
    input.value = "";
    applyQuery.cancel();
    query = "";
    paint();
    return true;
  }

  input.addEventListener("input", () => applyQuery(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !input.value) return;
    e.preventDefault();
    clearFilter();
  });

  // "/" focuses the search field from anywhere on the page that is not itself editable — a
  // reader already typing into a field gets their "/" character, not a stolen focus jump.
  const onSlash = (e) => {
    if (e.key !== "/" || isEditable(e.target)) return;
    e.preventDefault();
    input.focus();
  };
  document.addEventListener("keydown", onSlash);
  onPageTeardown(() => document.removeEventListener("keydown", onSlash));

  /**
   * Reveal one entry: scroll it into view, focus it, and keep the URL naming it — so
   * arriving here by any route (a tip, a bookmark, a shared link) leaves an address bar
   * that points straight back at the same definition.
   *
   * THE FILTER IS CLEARED FIRST, AND ON TODAY'S ROUTING THAT CLEAR FIRES ON NOTHING. Said
   * plainly because a guard that fires on nothing is a finding, not a pass. Measured: every
   * arrival at `?term=` is a hashchange, `appShell.js`'s `route()` REPLACES `<main>` and
   * calls this module afresh, so `query` is `""` and `input.value` is empty at the only
   * moment `revealEntry` is reached — `clearFilter()` returns false every time. It is here
   * for the failure it prevents rather than for one it catches today: a filtered-out row is
   * removed from the list, `getElementById` then returns null, and the scroll and focus
   * silently do nothing while the URL still claims to name the entry. That failure is not
   * hypothetical — `gas_ai`'s `revealEntry` carries the same clear for the same reason and
   * DOES need it, because its index rail and its diagram callouts reveal entries in place,
   * with no route change to rebuild the field. The first in-page reveal trigger added here
   * makes this clear load-bearing, and the ORDER is what the contract pins, since the
   * runtime path cannot be reached from outside.
   */
  function revealEntry(id) {
    clearFilter();
    const node = document.getElementById(entryDomId(id));
    if (!node) return;
    node.scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "center" });
    node.focus({ preventScroll: true });
    setParams({ term: id });
  }

  const model = paint();
  if (model.match) revealEntry(model.match);
}
