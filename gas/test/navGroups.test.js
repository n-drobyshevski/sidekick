// The nav's information architecture, held to the rules app.js states for it.
//
// Plain .js on purpose, for the reason attributionPrefill.test.js writes out: tsconfig has no
// allowJs and includes test/**/*.ts, so a .ts test importing a client .js module fails
// `tsc --noEmit` — and `npm run check` is typecheck && test && build, so vitest would never
// run. Vitest picks up **/*.test.{js,ts} either way.
//
// This is an ANTI-ROT spec. The rail's failure mode is not throwing — it is drawing a heading
// over one link, or the same heading twice, or a chrome page stranded in the middle of the
// security workflow, and every one of those renders perfectly.
//
// It reads app.js as SOURCE rather than importing it: app.js touches `document` at module
// scope and pulls in every page module, so importing it would drag the whole SPA into a node
// test — and this suite has no jsdom.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { LANE_ICONS, ROUTE_ICONS } from "../src/client/js/routeIcons.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const APP_JS = read("src/client/js/app.js");
const STORE_JS = read("src/client/js/store.js");

/**
 * The PAGES entries in rail order: `{ key, group }`, where `group` is the lane's name, or
 * `null` for the unlabelled chrome tail, or `undefined` for an entry that declares no lane at
 * all — which is a distinct failure and gets its own assertion below.
 *
 * Comments are dropped first: the prose above this map names the keys it explains (`group:
 * null` is written out in it), and a scan that counted those would file pages under lanes
 * nobody wrote.
 */
function navPages() {
  const block = APP_JS.match(/const PAGES = \{([\s\S]*?)\n\};/);
  expect(block, "PAGES object literal not found in app.js").toBeTruthy();
  const pages = [];
  let current = null;
  for (const line of block[1].split("\n").filter((l) => !/^\s*\/\//.test(l))) {
    const key = line.match(/^\s{2}(\w+):\s*\{/);
    if (key) {
      current = { key: key[1], group: undefined, hidden: false };
      pages.push(current);
    }
    if (!current) continue;
    const group = line.match(/\bgroup:\s*(?:"([^"]*)"|(null))/);
    if (group && current.group === undefined) {
      current.group = group[1] !== undefined ? group[1] : null;
    }
    if (/\bhidden:\s*true\b/.test(line)) current.hidden = true;
    if (/^\s{2}\},?\s*$/.test(line)) current = null; // end of a multi-line entry
  }
  expect(pages.length, "no pages parsed out of PAGES").toBeGreaterThan(5);
  return pages;
}

/** The lanes in rail order, each with the pages it holds. */
function lanes() {
  const out = [];
  for (const page of navPages()) {
    const last = out[out.length - 1];
    if (last && last.group === page.group) last.keys.push(page.key);
    else out.push({ group: page.group, keys: [page.key] });
  }
  return out;
}

describe("the nav's lanes", () => {
  it("gives every page a lane, or the tail, and never nothing", () => {
    for (const page of navPages()) {
      expect(
        page.group === null || typeof page.group === "string",
        page.key + " declares no group — it would silently join the lane above it",
      ).toBe(true);
    }
  });

  // The one railItems() cannot survive: it joins a page to the item still open, so a lane split
  // in two draws two rail items with one name — and the stacked list below 800px draws that
  // lane's heading twice, reading as two different groups that happen to share a name.
  it("keeps each lane contiguous", () => {
    const seen = [];
    for (const lane of lanes()) {
      expect(seen, "the " + lane.group + " lane is split in two").not.toContain(lane.group);
      seen.push(lane.group);
    }
  });

  it("ends on the unlabelled tail, and labels nothing after it", () => {
    const all = lanes();
    const tail = all[all.length - 1];
    expect(tail.group, "the nav does not end on the chrome tail").toBeNull();
    expect(
      all.filter((lane) => lane.group === null).length,
      "the tail is drawn in two places — its rule would be too",
    ).toBe(1);
  });
});

// A lane needs a mark the way a page does, and the guard runs in both directions: a lane with
// no glyph renders an empty 18px hole on the rail, and a glyph for a lane nobody declares is
// dead weight in a bundle whose bytes are first-paint latency.
//
// ONLY LANES THAT SURVIVE THE COLLAPSE need one. railItems() draws a lane holding one visible
// page AS that page, so "Overview" (Executive alone) never reaches the rail as a lane and never
// draws a lane mark — which is why this asks for a mark from the multi-page lanes only.
describe("the lane marks", () => {
  const multiPageLanes = () => {
    const out = [];
    for (const lane of lanes()) {
      if (lane.group && lane.keys.filter((k) => !hidden(k)).length > 1) out.push(lane.group);
    }
    return out;
  };
  const hidden = (key) => navPages().filter((p) => p.key === key)[0].hidden;

  it("draws every lane the rail lists", () => {
    for (const lane of multiPageLanes()) {
      expect(LANE_ICONS[lane], lane + " has no mark in routeIcons.js").toBeTruthy();
    }
  });

  it("carries no mark for a lane that never reaches the rail", () => {
    const declared = multiPageLanes();
    for (const lane of Object.keys(LANE_ICONS)) {
      expect(declared, lane + " has a mark but is not a rail lane").toContain(lane);
    }
  });

  // The rail puts a lane's mark beside the page marks its own panel lists, so a lane that
  // borrowed one of them would draw the same picture twice in one nav and mean two things.
  it("draws each lane differently from every other lane, and from every page", () => {
    const seen = new Map();
    for (const [name, svg] of [...Object.entries(LANE_ICONS), ...Object.entries(ROUTE_ICONS)]) {
      expect(seen.has(svg), name + " draws the same mark as " + seen.get(svg)).toBe(false);
      seen.set(svg, name);
    }
  });
});

// Every page the nav draws needs a route glyph, in both directions, for the same reasons.
describe("the route marks", () => {
  it("draws every page", () => {
    for (const page of navPages()) {
      if (page.hidden) continue;
      expect(ROUTE_ICONS[page.key], page.key + " has no mark in routeIcons.js").toBeTruthy();
    }
  });

  it("carries no mark for a route that does not exist", () => {
    const keys = navPages().map((p) => p.key);
    for (const key of Object.keys(ROUTE_ICONS)) {
      expect(keys, key + " has a mark but is not a page").toContain(key);
    }
  });
});

// The front door is decided in store.parseHash, as the fallback an empty hash lands on, while
// app.js repeats it as `PAGES[key] || PAGES.executive`. Two literals in two files that must
// agree: a rename in one of them lands a reader on a page the other cannot resolve.
describe("the landing route", () => {
  const defaultRoute = () => {
    const m = STORE_JS.match(/\|\|\s*pathPart\s*\|\|\s*"(\w+)"/);
    expect(m, "the parseHash fallback route was not found in store.js").toBeTruthy();
    return m[1];
  };

  it("names a page that exists", () => {
    expect(navPages().map((p) => p.key)).toContain(defaultRoute());
  });

  // A front door nobody can reach from the nav is worse than one that is not there: every route
  // resolves, so the app would open on a page the rail does not list and cannot get back to.
  it("names a page the nav actually draws", () => {
    const page = navPages().filter((p) => p.key === defaultRoute())[0];
    expect(page.hidden, defaultRoute() + " is the landing route but is hidden").toBe(false);
  });

  it("is the same route app.js falls back to", () => {
    const m = APP_JS.match(/PAGES\[key\] \|\| PAGES\.(\w+)/);
    expect(m, "the route() fallback was not found in app.js").toBeTruthy();
    expect(m[1], "app.js and store.js disagree on the landing route").toBe(defaultRoute());
  });
});
