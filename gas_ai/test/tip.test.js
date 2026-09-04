// The hover card's decisions, and the guard that keeps the native one from coming back.
//
// Plain .js on purpose, for the reason graphChips.test.js writes out: tsconfig has no allowJs
// and includes test/**/*.ts, so a .ts test importing a client .js module fails `tsc --noEmit`
// — and `npm run check` is typecheck && test && build, so vitest would never run.
//
// Only ui/tipPlace.js is imported here, never ui/tip.js: there is no jsdom in this repo, and
// that split is the reason the geometry is testable at all. Where a card LANDS when its
// trigger is forty pixels off the bottom of the window is a decision; assembling the card is
// a handful of el() calls verified by eye in the dev harness.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLOSE_GRACE, OPEN_COLD, TIP_ARROW, TIP_GAP, TIP_MARGIN, TIP_RADIUS, WARM_WINDOW,
  glossaryTipLines, tipDelay, tipLead, tipPlacement,
} from "../../gas_shared/ui/tipPlace.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const VIEW = { width: 1280, height: 800 };
const SIZE = { width: 300, height: 100 };

/** A trigger rectangle, from its left edge, top edge and size. */
function anchor(left, top, width = 80, height = 20) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

describe("tipPlacement", () => {
  it("opens below the trigger when there is room", () => {
    const p = tipPlacement(anchor(600, 100), SIZE, VIEW);
    expect(p.side).toBe("below");
    expect(p.top).toBe(100 + 20 + TIP_GAP);
  });

  it("centres on the trigger", () => {
    const p = tipPlacement(anchor(600, 100), SIZE, VIEW);
    expect(p.left).toBe(640 - 150);
  });

  it("flips above only when the card does not fit below AND there is more room above", () => {
    // 40px of window left under the trigger: no room below, plenty above.
    const flipped = tipPlacement(anchor(600, 740), SIZE, VIEW);
    expect(flipped.side).toBe("above");
    expect(flipped.top).toBe(740 - TIP_GAP - SIZE.height);

    // Near the TOP of the window there is no room below either, but flipping would only
    // trade one clipped edge for a smaller one, so it stays put.
    const cramped = tipPlacement(anchor(600, 10), SIZE, { width: 1280, height: 120 });
    expect(cramped.side).toBe("below");
  });

  it("clamps to both side margins rather than running off the window", () => {
    const left = tipPlacement(anchor(4, 100), SIZE, VIEW);
    expect(left.left).toBe(TIP_MARGIN);

    const right = tipPlacement(anchor(1240, 100), SIZE, VIEW);
    expect(right.left).toBe(VIEW.width - SIZE.width - TIP_MARGIN);
  });

  it("lands at the margin when the card is wider than the window", () => {
    const p = tipPlacement(anchor(10, 100), { width: 400, height: 80 }, { width: 320, height: 640 });
    expect(p.left).toBe(TIP_MARGIN);
  });

  it("points the caret at the trigger's centre, even after clamping", () => {
    const p = tipPlacement(anchor(4, 100), SIZE, VIEW);
    // Trigger centre is 44; the card starts at 8, so the caret sits 36px into it.
    expect(p.left + p.arrow).toBe(44);
  });

  it("keeps the caret off both corners", () => {
    const inset = TIP_RADIUS + TIP_ARROW / 2;
    // A trigger far to the left of a clamped card would otherwise put the caret at 0.
    const p = tipPlacement(anchor(0, 100, 4, 20), SIZE, VIEW);
    expect(p.arrow).toBeGreaterThanOrEqual(inset);
    expect(p.arrow).toBeLessThanOrEqual(SIZE.width - inset);

    const q = tipPlacement(anchor(1276, 100, 4, 20), SIZE, VIEW);
    expect(q.arrow).toBeGreaterThanOrEqual(inset);
    expect(q.arrow).toBeLessThanOrEqual(SIZE.width - inset);
  });

  it("never returns a negative caret offset, whatever the geometry", () => {
    for (const left of [-200, -1, 0, 5, 640, 1279, 1600]) {
      for (const w of [10, 300, 900]) {
        const p = tipPlacement(anchor(left, 400), { width: w, height: 60 }, VIEW);
        expect(p.arrow, `left=${left} w=${w}`).toBeGreaterThanOrEqual(0);
        expect(p.arrow, `left=${left} w=${w}`).toBeLessThanOrEqual(w);
      }
    }
  });

  it("keeps a card taller than the window on screen rather than off the bottom", () => {
    const p = tipPlacement(anchor(600, 300), { width: 200, height: 900 }, VIEW);
    expect(p.top).toBe(TIP_MARGIN);
  });
});

describe("tipDelay", () => {
  it("opens instantly on focus — a Tab is already a commitment", () => {
    expect(tipDelay({ viaFocus: true, sinceLastClose: Infinity })).toBe(0);
  });

  it("makes a pointer wait, so crossing the page does not strobe every definition", () => {
    expect(tipDelay({ sinceLastClose: Infinity })).toBe(OPEN_COLD);
    expect(tipDelay()).toBe(OPEN_COLD);
  });

  it("stays warm just after another card closed, so scanning a header row is one gesture", () => {
    expect(tipDelay({ sinceLastClose: 0 })).toBe(0);
    expect(tipDelay({ sinceLastClose: WARM_WINDOW })).toBe(0);
    expect(tipDelay({ sinceLastClose: WARM_WINDOW + 1 })).toBe(OPEN_COLD);
  });

  it("leaves enough grace to reach the card, which SC 1.4.13 requires", () => {
    expect(CLOSE_GRACE).toBeGreaterThan(0);
    expect(CLOSE_GRACE).toBeGreaterThanOrEqual(TIP_GAP * 10);
  });
});

describe("tipLead", () => {
  it("leaves a short blurb alone", () => {
    expect(tipLead("Two words.", 240)).toBe("Two words.");
  });

  it("cuts on a sentence when one is close enough to the cap", () => {
    const text = "First sentence here. " + "x".repeat(300);
    expect(tipLead(text, 60)).toBe("First sentence here.");
  });

  it("cuts on a word when no sentence ends near the cap", () => {
    const out = tipLead("alpha beta gamma delta epsilon zeta eta theta", 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("epsilon");
  });

  it("survives a missing blurb", () => {
    expect(tipLead(null, 10)).toBe("");
    expect(tipLead(undefined, 10)).toBe("");
  });
});

describe("glossaryTipLines", () => {
  const entry = {
    id: "toxic-combination",
    term: "Toxic combination",
    aka: "TC",
    blurb: "A multi-condition pattern that only fires when risks combine.",
  };

  it("carries the blurb and the entry id, and names the route in words", () => {
    const copy = glossaryTipLines(entry);
    expect(copy.lines).toEqual([entry.blurb]);
    expect(copy.term).toBe("toxic-combination");
    expect(copy.more).toMatch(/full definition/i);
  });

  it("keeps `aka` as its own line — a second NAME is information", () => {
    expect(glossaryTipLines(entry).aka).toBe("TC");
    expect(glossaryTipLines({ ...entry, aka: undefined }).aka).toBeNull();
  });

  it("does NOT repeat the term: the trigger is the word under the pointer", () => {
    const copy = glossaryTipLines(entry);
    expect(copy.lines.join(" ")).not.toContain("Toxic combination");
  });

  it("degrades rather than throwing on an id the book no longer carries", () => {
    // findEntry() returns null for a renamed id; the page must render the plain label.
    // helpContent.test.js is what fails the BUILD on the rename, which is where it belongs.
    expect(glossaryTipLines(null)).toBeNull();
    expect(glossaryTipLines(undefined)).toBeNull();
  });
});

// --------------------------------------------------------------------------- anti-rot
// The migration off `title=` only holds if it cannot quietly come back. Three checks, and the
// third exists because the first two were not enough. Same idiom as icons.test.js: read the
// tree, not a hand-kept list of files.
//
// THE GAP THIS USED TO HAVE, and it shipped a real bug through. The header said el() "catches
// the el(tag, {title}) form on the first render in the dev harness" — but a throw only fires
// on a path that actually RUNS, and accessEditor.js's personRow() runs only for a person
// besides the owner. No seed and no spec had a second user, so `title: "Remove " + email` sat
// there while renderAccessPanel() rejected on every real workbook and the roster silently
// vanished from Settings. Runtime enforcement is not coverage. The literal form is scanned
// statically now, like the other two.

function clientJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...clientJsFiles(full));
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

describe("the native tooltip stays gone", () => {
  const files = clientJsFiles(join(root, "src/client/js"));

  it("reads a real tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("never sets a title attribute imperatively", () => {
    const hits = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/setAttribute\(\s*["']title["']/.test(src)) hits.push(f);
      if (/setAttr\([^)]*["']title["']/.test(src)) hits.push(f);
    }
    expect(hits, "use tip() from ui/tip.js instead").toEqual([]);
  });

  it("assigns .title only where it is not a DOM tooltip", () => {
    const allowed = /^(document|opts\.scales\.[xy])$/;
    const hits = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/([\w.]+)\.title\s*=/g)) {
        if (!allowed.test(m[1])) hits.push(f + ": " + m[0]);
      }
    }
    expect(hits, "use tip() from ui/tip.js instead").toEqual([]);
  });

  // The el(tag, { ... }) attrs literal: the form el() throws on, checked here WITHOUT having to
  // execute the call. Brace-matching from the opening `{` of the second argument rather than a
  // regex, so a nested object in the attrs (a style map, an inline handler body) cannot end the
  // scan early or drag an unrelated `title:` in from the children that follow.
  it("never passes title in an el() attribute literal", () => {
    const hits = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bel\(\s*(?:"[^"]*"|'[^']*'|`[^`]*`|\w+)\s*,\s*\{/g)) {
        let i = m.index + m[0].length - 1; // at the opening brace
        let depth = 0;
        let end = -1;
        for (; i < src.length; i++) {
          const c = src[i];
          if (c === "{") depth++;
          else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end === -1) continue;
        const attrs = src.slice(m.index + m[0].length - 1, end + 1);
        // Depth-1 keys only: a `title:` inside a nested literal belongs to that object, not to
        // the attribute set el() iterates.
        let d = 0;
        for (const km of attrs.matchAll(/[{}]|\btitle\s*:/g)) {
          if (km[0] === "{") d++;
          else if (km[0] === "}") d--;
          else if (d === 1) hits.push(f + ": " + attrs.slice(0, 60).replace(/\s+/g, " "));
        }
      }
    }
    expect(hits, "el() throws on this at runtime, but only on a path that runs — use tip()")
      .toEqual([]);
  });

  it("keeps el() refusing the attribute, which is what catches the common form", () => {
    const dom = readFileSync(join(root, "../gas_shared/ui/dom.js"), "utf8");
    expect(dom).toMatch(/k === "title"/);
    expect(dom).toMatch(/throw new Error/);
  });
});
