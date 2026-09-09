// Priorities is the front door — the one route nobody reaches without going through it — so
// its first run is an ITEMISED panel rather than the generic one-line `firstRunNotice` every
// other whole-page gate draws (`gas_shared/test/contracts/emptyStates.js`'s own header names
// this exception: `problems` is deliberately absent from `firstRunRoutes` in
// `test/shared.test.js`). `prioritiesFirstRunView` (problemView.js) is the DOM-free half —
// this file holds both what it returns and, read as SOURCE, that `problems.js` returns
// before it builds any of the content the panel would otherwise sit under.
//
// Ported shape: gas's `test/registerFirstRun.test.js` pins the same "the return precedes
// every canvas" claim for `overview.js`'s own itemised panel — same defect class, same fix.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";
import { prioritiesFirstRunView } from "../src/client/js/pages/problemView.js";

const PROBLEMS = code(readFileSync(
  new URL("../src/client/js/pages/problems.js", import.meta.url), "utf8",
));

// =========================================================================================
//  1. prioritiesFirstRunView — the view model
// =========================================================================================

describe("prioritiesFirstRunView", () => {
  it("shows when nothing has ever been synced", () => {
    const view = prioritiesFirstRunView({ latestSync: null });
    expect(view.show).toBe(true);
    expect(view.heading).toMatch(/no sync has run yet/i);
  });

  it("shows on an entirely absent bootstrap payload too — never throws reading it", () => {
    expect(prioritiesFirstRunView(null).show).toBe(true);
    expect(prioritiesFirstRunView(undefined).show).toBe(true);
    expect(prioritiesFirstRunView({}).show).toBe(true);
  });

  it("does not show once a sync has run", () => {
    const view = prioritiesFirstRunView({ latestSync: { finished_at: "2026-09-01T00:00:00Z" } });
    expect(view.show).toBe(false);
    expect(view.items).toEqual([]);
  });

  it("carries four items, each naming the one action the reader can take", () => {
    const view = prioritiesFirstRunView({ latestSync: null });
    expect(view.items).toHaveLength(4);
    const figures = view.items.map((i) => i.figure);
    expect(figures).toEqual(["Open problems", "Movement", "Issue half-life", "The ranked queue"]);
    for (const item of view.items) {
      // No route to send the reader to — the control is the rail's own Sync now button, not
      // a page — so `route` is null and `routeLabel` carries the instruction as text rather
      // than as a link that would go nowhere (emptyState's own contract for a null route).
      expect(item.route).toBeNull();
      expect(item.routeLabel).toBe("Sync now — the button in the rail");
      // Every unlock condition is a real sentence, not a placeholder — the panel's whole job
      // is to say WHAT unlocks each figure.
      expect(typeof item.unlock).toBe("string");
      expect(item.unlock.length).toBeGreaterThan(20);
    }
  });

  it("is a pure function of latestSync alone — the same input, the same output", () => {
    const a = prioritiesFirstRunView({ latestSync: null });
    const b = prioritiesFirstRunView({ latestSync: null });
    expect(a).toEqual(b);
  });
});

// =========================================================================================
//  2. problems.js returns before it draws any content
// =========================================================================================

/** The index just after `if (first.show) { … return; }` — the shape the page's own gate
 *  takes. -1 when the file carries no such block. */
function firstRunReturnIndex(stripped) {
  const m = /if \(first\.show\) \{[\s\S]{0,600}?\n\s*return;\s*\n\s*\}/.exec(stripped);
  return m ? m.index + m[0].length : -1;
}

/** The earliest point the page builds a canvas — the one content shape the plan names by
 *  name (`actionHeadline`'s cover-curve chart). */
function firstCanvasIndex(stripped) {
  const i = stripped.indexOf('el("canvas"');
  return i === -1 ? Infinity : i;
}

describe("problems.js returns before drawing any content, the canvas included", () => {
  it("the first-run branch precedes the cover-curve canvas in source", () => {
    const returnAt = firstRunReturnIndex(PROBLEMS);
    expect(returnAt, "problems.js has no if (first.show) { … return; } gate").toBeGreaterThan(-1);
    const canvasAt = firstCanvasIndex(PROBLEMS);
    expect(canvasAt, "problems.js draws no canvas at all — the sweep has nothing to check")
      .not.toBe(Infinity);
    expect(returnAt, "problems.js builds a canvas BEFORE its first-run return — a first run "
      + "would paint both the panel and the content it is meant to replace")
      .toBeLessThan(canvasAt);
  });

  it("the canvas is genuinely drawn, not a dead branch the sweep above cannot see", () => {
    // ANTI-VACUOUS: if `el("canvas"` ever leaves the file, the check above quietly stops
    // covering anything.
    expect(PROBLEMS).toMatch(/el\("canvas"/);
  });

  // PERTURBATION: the defective ordering this describe exists to catch, run through the SAME
  // two functions the real file goes through — reproduces the regression `actionHeadline`'s
  // canvas moving above the gate would cause.
  it("the check catches a canvas drawn before the first-run return", () => {
    const REGRESSED = `
      export async function renderProblems(main) {
        const canvas = el("canvas", { role: "img" });
        main.append(canvas);
        if (first.show) {
          main.append(pageHeader({ hero: heroStat("Open problems", null, "sub") }));
          main.append(emptyState(first.heading, first.hint, { items: first.items }));
          return;
        }
      }
    `;
    const stripped = code(REGRESSED);
    expect(firstRunReturnIndex(stripped)).toBeGreaterThan(-1);
    expect(firstCanvasIndex(stripped)).toBeLessThan(firstRunReturnIndex(stripped));
  });
});

// =========================================================================================
//  3. Every guarded section on this page names a distinct label
// =========================================================================================
//
// `guard(label, host, fn)` is per-page (`gas_shared/test/contracts/emptyStates.js`'s
// `guardedRoutes` only checks that the helper exists and reaches for `errorState`); a
// duplicated label makes two independent alerts read as one on screen and in the console
// log, so this app's own test holds each page's labels distinct rather than trusting the
// shared sweep to catch a per-page collision it was never designed to see.

const GUARDED_PAGES = ["combos", "compliance", "config", "inventory", "problems", "scans"];

function guardLabels(src) {
  const labels = [];
  const re = /guard\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) labels.push(m[1]);
  return labels;
}

describe("each guarded page's section labels are distinct", () => {
  for (const route of GUARDED_PAGES) {
    it(route + ".js names every guarded section uniquely", () => {
      const src = code(readFileSync(
        new URL(`../src/client/js/pages/${route}.js`, import.meta.url), "utf8",
      ));
      const labels = guardLabels(src);
      expect(labels.length, route + ".js has no guard( calls to check").toBeGreaterThan(0);
      expect(new Set(labels).size, route + ".js has a duplicated guard() label: "
        + JSON.stringify(labels)).toBe(labels.length);
    });
  }

  // PERTURBATION: two sections sharing one label read as one alert.
  it("the distinctness check catches a duplicated label", () => {
    const REGRESSED = `
      guard("the table", tableHost, () => renderAll());
      guard("the table", chartHost, () => renderChart());
    `;
    const labels = guardLabels(REGRESSED);
    expect(new Set(labels).size).toBeLessThan(labels.length);
  });
});
