// The sidebar's information architecture, held to the rules app.js states for it.
//
// Plain .js on purpose, for the reason helpContent.test.js writes out: tsconfig has no
// allowJs and includes test/**/*.ts, so a .ts test importing a client .js module fails
// `tsc --noEmit` — and `npm run check` is typecheck && test && build, so vitest would
// never run. Vitest picks up **/*.test.{js,ts} either way.
//
// This is an ANTI-ROT spec. The rail's failure mode is not throwing — it is drawing a
// heading over one link, or the same heading twice, or a chrome page stranded in the middle
// of the security workflow, and every one of those renders perfectly. The shape it protects
// was itself the fix for a rail that had grown six headings for ten links, four of them over
// a single item and two of those restating the item's own name.
//
// It reads app.js as SOURCE rather than importing it: app.js touches `document` at module
// scope and pulls in every page module, so importing it would drag the whole SPA into a
// node test. The same trick, and the same block regex, as helpContent.test.js.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { LANE_ICONS } from "../src/client/js/routeIcons.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const APP_JS = read("src/client/js/app.js");
const STORE_JS = read("src/client/js/store.js");

/**
 * The PAGES entries in rail order: `{ key, group }`, where `group` is the lane's name, or
 * `null` for the unlabelled chrome tail, or `undefined` for an entry that declares no lane
 * at all — which is a distinct failure and gets its own assertion below.
 *
 * Comments are dropped first, exactly as experimentalPageKeys() does in helpContent.test.js:
 * the prose in this map NAMES the keys it explains (`group: null` is written out in two of
 * them), and a scan that counted those would file pages under lanes nobody wrote.
 */
function navPages() {
  const block = APP_JS.match(/const PAGES = \{([\s\S]*?)\n\};/);
  expect(block, "PAGES object literal not found in app.js").toBeTruthy();
  const pages = [];
  let current = null;
  for (const line of block[1].split("\n").filter((l) => !/^\s*\/\//.test(l))) {
    const key = line.match(/^\s{2}(\w+):\s*\{/);
    if (key) {
      current = { key: key[1], group: undefined };
      pages.push(current);
    }
    if (!current) continue;
    const group = line.match(/\bgroup:\s*(?:"([^"]*)"|(null))/);
    if (group && current.group === undefined) current.group = group[1] !== undefined ? group[1] : null;
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

describe("the sidebar's lanes", () => {
  it("gives every page a lane, or the tail, and never nothing", () => {
    for (const page of navPages()) {
      expect(
        page.group === null || typeof page.group === "string",
        page.key + " declares no group — it would silently join the lane above it",
      ).toBe(true);
    }
  });

  // The one renderSidebar cannot survive: its lastGroup detector emits a fresh heading every
  // time the value changes, so a lane split in two draws its heading twice and reads as two
  // different groups that happen to share a name.
  it("keeps each lane contiguous", () => {
    const seen = [];
    for (const lane of lanes()) {
      expect(seen, "the " + lane.group + " lane is split in two").not.toContain(lane.group);
      seen.push(lane.group);
    }
  });

  // A heading over one link is a line of furniture: it takes a row of the rail to say
  // something the link beneath it already says.
  it("makes every labelled lane earn its heading with two pages", () => {
    // `Labs` is the exception, and the exception is the point: there the heading IS the
    // statement — it says the page sits outside the security workflow rather than beside
    // it — and the page is gated, so most readers never see either.
    const SINGLETONS_ALLOWED = ["Labs"];
    for (const lane of lanes()) {
      if (lane.group === null || SINGLETONS_ALLOWED.includes(lane.group)) continue;
      expect(
        lane.keys.length,
        "the " + lane.group + " lane holds only " + lane.keys.join(", "),
      ).toBeGreaterThan(1);
    }
  });

  it("ends on the unlabelled tail, and labels nothing after it", () => {
    const all = lanes();
    const tail = all[all.length - 1];
    expect(tail.group, "the rail does not end on the chrome tail").toBeNull();
    expect(
      all.filter((lane) => lane.group === null).length,
      "the tail is drawn in two places — its rule would be too",
    ).toBe(1);
  });
});

// The rail draws lanes now, so a lane needs a mark the way a page does. helpContent.test.js
// already holds ROUTE_ICONS against every page key; this is the same guard one tier up, and
// it runs in both directions — a lane with no glyph renders an empty 18px hole, and a glyph
// for a lane nobody declares is dead weight in a bundle whose bytes are first-paint latency.
describe("the lane marks", () => {
  const lanes = () => [...new Set(navPages().map((p) => p.group).filter(Boolean))];

  it("draws every lane the rail lists", () => {
    for (const lane of lanes()) {
      expect(LANE_ICONS[lane], lane + " has no mark in routeIcons.js").toBeTruthy();
    }
  });

  it("carries no mark for a lane that does not exist", () => {
    const declared = lanes();
    for (const lane of Object.keys(LANE_ICONS)) {
      expect(declared, lane + " has a mark but is not a lane").toContain(lane);
    }
  });

  // The rail puts a lane's mark beside the page marks its own panel lists, so a lane that
  // borrowed one of them would draw the same picture twice in one nav and mean two things.
  it("draws each lane differently from every other lane", () => {
    const seen = new Map();
    for (const [lane, svg] of Object.entries(LANE_ICONS)) {
      expect(seen.has(svg), lane + " draws the same mark as " + seen.get(svg)).toBe(false);
      seen.set(svg, lane);
    }
  });
});

// Two comments in app.js state this coupling — one on `compliance`, one on `help` — and
// nothing checked it, so a page pasted at the top of the map would have moved the app's
// front door with no test and no reviewer noticing.
describe("the landing route", () => {
  it("is the first page in the rail", () => {
    const fallback = STORE_JS.match(
      /route:\s*ROUTE_ALIASES\[pathPart\]\s*\|\|\s*pathPart\s*\|\|\s*"(\w+)"/,
    );
    expect(fallback, "parseHash's default route not found in store.js").toBeTruthy();
    expect(navPages()[0].key, "the first PAGES key is not parseHash's fallback")
      .toBe(fallback[1]);
  });
});
