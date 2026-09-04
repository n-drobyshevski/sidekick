// ui/popover.js's dismiss handler is DOM-bound (it wires document/window listeners), so it
// is read as source text rather than executed — the split test/navGroups.test.js and
// test/projectScopeView.test.js already use (vitest.config.ts sets no `environment`, so
// there is no jsdom to fire a real `resize` event in). The browser reproduction that proves
// the runtime behaviour lives in the P8 handback, not here.
//
// WHAT THIS GUARDS. `popoverDismiss`'s scroll/resize handler checked
// `pop.contains(e.target)` unconditionally. For a `scroll` event `e.target` is always a Node
// (the element that scrolled). For a `resize` event `e.target` is the `Window` itself, which
// is not a Node — `Node#contains` on a non-Node argument throws
// `TypeError: Failed to execute 'contains' on 'Node': parameter 1 is not of type 'Node'`.
// Any popover left open across a viewport resize (P8 repro: the Registers rail flyout, then
// `page.setViewportSize`) threw on every resize tick. `instanceof Node` tells the two events
// apart without changing what the guard means for a real scroll target.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(new URL("../src/client/js/ui/popover.js", import.meta.url), "utf8");

function onScrollOrResizeBody(src) {
  const start = src.indexOf("function onScrollOrResize(e) {");
  expect(start, "onScrollOrResize not found in ui/popover.js").toBeGreaterThan(-1);
  const end = src.indexOf("\n  }\n", start);
  return src.slice(start, end);
}

describe("popoverDismiss's onScrollOrResize", () => {
  it("guards pop.contains(e.target) on e.target being a Node, in front of the call itself", () => {
    const body = onScrollOrResizeBody(SRC);
    const guardIndex = body.search(/e\.target\s+instanceof\s+Node/);
    const callIndex = body.indexOf("pop.contains(e.target)");
    expect(guardIndex, "e.target instanceof Node not found").toBeGreaterThan(-1);
    expect(callIndex, "pop.contains(e.target) not found").toBeGreaterThan(-1);
    // Both conditions must sit in the SAME `if (...)`, short-circuiting before the call —
    // not just somewhere earlier in the function — so this reads them off one `if` line.
    const ifLine = body.slice(body.indexOf("if ("), body.indexOf("return;"));
    expect(ifLine).toMatch(/instanceof\s+Node/);
    expect(ifLine).toMatch(/pop\.contains\(e\.target\)/);
    expect(guardIndex).toBeLessThan(callIndex);
  });

  // PERTURBATION, run by hand during P8: reverting the guard to
  // `if (e && e.target && pop && pop.contains && pop.contains(e.target)) return;` makes the
  // test above fail, and reproducing the browser scenario in the handback throws the
  // TypeError again — see the handback's before/after resize repro.
});
