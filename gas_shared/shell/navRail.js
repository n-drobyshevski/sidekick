// The nav's two shapes, and the switch between them.
//
// Above 800px it is an icon rail plus the flyout panel. Below that the rail is not a rail at
// all — it becomes a wrapping top bar, where a panel has nowhere to fly out to and a 76px
// icon column would be a column of one — so the nav renders as a plain stacked list: every
// page, lane headings as words, one rule above the chrome tail. The query is the one
// `queryPalette.js` already makes for the same reason.
//
// THE ONE-PAGE LABELLED LANE IS A LIVE HAZARD AND IT IS PRESERVED ON PURPOSE. `navModel`
// collapses a lane holding one visible page to that page on the rail, but renderStackedNav
// below draws `page.group ? navGroupHeading(page.group) : navRule()` UNCONDITIONALLY on every
// group change — so a labelled lane of one restates its own link here, in the one shape the
// collapse cannot reach. That is why all three apps folded their one-page Executive/Overview
// lane into a real lane, and why the navGroups contract's `singletonLanes` is an explicit
// per-app carve-out (gas_ai's `Labs`) rather than a default. Do not "simplify" the two into
// one rule: the shapes genuinely differ, and the contract is what holds the table honest.
//
// NO RESIZE LISTENER EXISTS, and that is unchanged from all three copies: the shape is only
// re-evaluated on a full renderSidebar() (boot, refresh, an experimental-flag flip). Crossing
// 800px with the window already open leaves the previous shape until something else redraws.
// Arguably a bug; deliberately out of scope here, because adding a matchMedia change listener
// would rebuild the rail — and with it the scan/sync zone and its live progress card — from a
// path none of the three has ever taken.

import { appConfig } from "../appConfig.js";
import { clear, el } from "../ui/dom.js";
import { parseHash } from "../store.js";
import {
  focusFirstRow, itemHasPanel, openFlyoutFor, tapOpensPanel,
} from "./navFlyout.js";

/** Below this width the nav is a stacked top bar rather than a rail with a panel. */
export const NARROW_NAV = "(max-width: 800px)";

export function narrowNav() {
  return !!(window.matchMedia && window.matchMedia(NARROW_NAV).matches);
}

/** A span carrying an inline SVG (el() builds HTML nodes, so SVG goes in via innerHTML). */
export function iconSpan(svg, cls) {
  const s = el("span", { class: cls || "nav-icon", "aria-hidden": "true" });
  s.innerHTML = svg;
  return s;
}

/**
 * A lane heading.
 *
 * An h2 rather than a div, and the label inside a span rather than loose in it, for one
 * reason: the collapsed rail is the DEFAULT, and it used to `display: none` these outright —
 * so the one state most readers see had no grouping in it at all, on screen or in the
 * accessibility tree. Collapsed, the span is what goes (clipped, not removed) and the h2
 * itself draws as the hairline between two icon clusters. The heading stays announced and
 * navigable in every state; only its pixels change.
 */
export function navGroupHeading(label) {
  return el("h2", { class: "nav-group" }, el("span", { class: "nav-group-label" }, label));
}

/**
 * The chrome tail's separator. Its pages name themselves, so the tail is marked rather than
 * labelled — presentational, because it says nothing a reader could not see, and the pages
 * under it are already ordinary links.
 */
export function navRule() {
  return el("div", { class: "nav-rule", role: "presentation" });
}

/**
 * One rail item: a link that navigates, and — where the item has a panel — the trigger that
 * opens it.
 *
 * ONE CONTROL, and no caret beside it. The rail carried a disclosure button for a while and
 * it never earned its place at 12px on a 76px item: a second target crowding a label, drawing
 * a mark on the chrome that the panel it opens draws again as a heading. What it was for
 * survives without it — `aria-haspopup` and `aria-expanded` say a panel is there and whether
 * it is open, ArrowRight opens it and lands focus inside, Escape closes it and hands focus
 * back. Enter still navigates, because this is still a link: the panel is a way in, never the
 * only one.
 */
export function railItem(item) {
  const { LANE_ICONS, ROUTE_ICONS } = appConfig();
  const icon = item.kind === "lane"
    ? (LANE_ICONS || {})[item.id]
    : (ROUTE_ICONS || {})[item.route];
  const node = el("div", { class: "rail-item", "data-nav-item": item.id });
  const link = el(
    "a",
    {
      class: "nav-link rail-link",
      href: `#/${item.route}`,
      // index.html sets <base target="_top"> so external links escape the GAS sandbox iframe.
      // Without an explicit _self, hash links inherit it and navigate the top window to the
      // sandbox's own googleusercontent URL — which, loaded bare, is a blank page.
      target: "_self",
      // Only where there is one. A rail item that announced a popup it does not have would
      // send a screen-reader user hunting for a panel that never opens.
      "aria-haspopup": itemHasPanel(item) ? "true" : null,
      "aria-expanded": itemHasPanel(item) ? "false" : null,
      onclick: (e) => {
        // Where there is no hover there is no flyout, so the first tap has to do the
        // revealing — the same bargain tip.js strikes with its cards.
        if (tapOpensPanel(item, node)) e.preventDefault();
      },
      onkeydown: (e) => {
        if (e.key !== "ArrowRight" || !itemHasPanel(item)) return;
        e.preventDefault();
        openFlyoutFor(item, node, { viaFocus: true });
        focusFirstRow();
      },
    },
    iconSpan(icon),
    el("span", { class: "nav-label" }, item.label),
  );
  node.append(link);
  return node;
}

/** The two-tier rail: one item per lane, then a rule, then the chrome tail. */
export function renderRail(sidebar, items) {
  let ruled = false;
  for (const item of items) {
    // The tail is chrome rather than a lane, and the rule is what says so — the same rule the
    // stacked list draws, for the same reason. Keyed on `lane`, never on `kind`: a lane left
    // holding one visible page is drawn AS that page, so kind alone would put the rule in
    // front of the first collapsed lane instead of in front of the chrome.
    if (item.lane === null && !ruled) { sidebar.append(navRule()); ruled = true; }
    sidebar.append(railItem(item));
  }
}

/**
 * The stacked list, for the top-bar layout below 800px: every page, lane headings as words,
 * one rule above the chrome tail. This is the rail as it shipped before the panel existed,
 * and it stays because at that width it is still the right answer.
 *
 * @param {HTMLElement} sidebar
 * @param {object} pages          the app's PAGES route table
 * @param {boolean} experimental  whether the reader has opened the gate
 */
export function renderStackedNav(sidebar, pages, experimental) {
  const ROUTE_ICONS = appConfig().ROUTE_ICONS || {};
  const { route: active } = parseHash();
  // `undefined`, not null: null is a real group — the unlabelled chrome tail — and a detector
  // seeded with it would start the list inside that tail and never draw its rule.
  let lastGroup;
  for (const [key, page] of Object.entries(pages || {})) {
    // Hidden routes still resolve and still render — they are only off the nav.
    if (page.hidden) continue;
    // A gated page is absent, not disabled: the rest of this list is the security workflow,
    // and a greyed-out row inside it would still be telling every reader that a page they
    // cannot open exists. Its lane heading goes with it for free — the lastGroup detector
    // only emits a header when a page that is actually being drawn changes group.
    if (page.experimental && !experimental) continue;
    if (page.group !== lastGroup) {
      sidebar.append(page.group ? navGroupHeading(page.group) : navRule());
      lastGroup = page.group;
    }
    sidebar.append(
      el(
        "a",
        {
          class: `nav-link${key === active ? " active" : ""}`,
          href: `#/${key}`,
          target: "_self",
          "aria-current": key === active ? "page" : null,
        },
        iconSpan(ROUTE_ICONS[key]),
        el("span", { class: "nav-label" }, page.title),
      ),
    );
  }
}

/**
 * Draw whichever shape the width calls for, into a cleared sidebar. The app's own zone (scan
 * or sync) is appended after this by the shell, from the app-supplied `railFooter`.
 */
export function renderNav(sidebar, pages, items, experimental) {
  clear(sidebar);
  if (narrowNav()) renderStackedNav(sidebar, pages, experimental);
  else renderRail(sidebar, items);
}
