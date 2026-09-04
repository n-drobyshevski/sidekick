// Help: the key sheet. Every glossary entry helpContent.js defines, in the one place a
// reader can search, browse whole, or land on directly.
//
// THE GAP THIS CLOSES. helpContent.js has held the register's whole vocabulary since it
// shipped — sync, scan, lower-bound and twenty more — and ui/tip.js's glossaryTip() has
// always wired its trigger to navigate("help", { term }) the moment a reader hits Enter on
// one ("Enter for the full definition", withTerm() in ui/tip.js). Neither of those needed a
// single line changed here: #/help simply resolved to nothing, so PAGES[key] was undefined,
// route() fell back to DEFAULT_ROUTE, and a reader who followed a definition landed on
// Executive with no explanation and a dropped ?term=. Registering this route is what makes
// that link finally arrive.
//
// PURE MODEL, THIN DOM — the split every page in this package uses, because this repo runs
// no jsdom (vitest.config.ts sets no `environment`): helpModel() is exercised directly by
// test/pagesHelp.test.js, and renderHelp() is read as source text the way every other page's
// DOM half is.
//
// GROUPING. helpContent.js's entries carry no family/lane field today — the book is one flat
// list, not sections of it. So the model collapses to at most ONE group, alphabetical by
// term, and the page never draws a heading over it: the same rule app.js's PAGES table
// states for the nav one level up — "a labelled lane earns its heading by holding two
// pages" — applied here to say a single group earns no heading either. The shape stays
// group-based rather than a flat array so a `family` field added to helpContent.js later
// costs a grouping key here, not a rewrite.
//
// SEARCH IS WHOLE-WORD-ISH AND CASE-INSENSITIVE. A bare substring match would let a query of
// "sync" hit a future entry mentioning "resyncing" mid-word; anchoring each query word to a
// word START (`\b`) keeps a match to whole words and true prefixes ("sync" still matches
// "syncing") without matching inside one. Case-insensitivity is not decorative: a reader who
// types "SAST" the way the term itself is capitalised must not be punished for it — see
// test/pagesHelp.test.js's perturbation, which breaks that on purpose to prove the guard
// bites.

import { allEntries } from "../helpContent.js";
import { setParams } from "../../../../../gas_shared/store.js";
import {
  clear, debounce, el, emptyState, heroStat, motionOk, onPageTeardown, pageHeader, plural,
} from "../ui.js";

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
 * The pure half. `entries` is helpContent.js's own `allEntries()` (or a stand-in in tests);
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

export async function renderHelp(host, params, _ctx) {
  const entries = allEntries();
  const wantedTerm = normalize(params && params.term);

  host.append(pageHeader({
    hero: heroStat(
      "Data",
      "Key sheet",
      "What every word and mark in this register means, written once and reached from " +
        "anywhere a definition trigger names it.",
    ),
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

  input.addEventListener("input", () => applyQuery(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !input.value) return;
    e.preventDefault();
    input.value = "";
    applyQuery.cancel();
    query = "";
    paint();
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

  const model = paint();

  // The deep link: scroll the named entry into view, focus it, and keep the URL naming it —
  // so arriving here by any route (a tip, a bookmark, a shared link) leaves an address bar
  // that points straight back at the same definition.
  if (model.match) {
    const node = document.getElementById(entryDomId(model.match));
    if (node) {
      node.scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "center" });
      node.focus({ preventScroll: true });
      setParams({ term: model.match });
    }
  }
}
