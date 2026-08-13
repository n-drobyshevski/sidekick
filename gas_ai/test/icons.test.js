// The node-kind icon sprite, held to the invariants nothing else checks.
//
// Plain .js on purpose, for the reason helpContent.test.js writes out: tsconfig has no
// allowJs and includes test/**/*.ts, so a .ts test importing a client .js module fails
// `tsc --noEmit` — and `npm run check` is typecheck && test && build, so vitest would
// never run. Vitest picks up **/*.test.{js,ts} either way.
//
// This is an ANTI-ROT spec. The sprite's failure mode is not throwing — it is drawing the
// wrong picture, or the same picture twice, or silently falling back to the collapse stub
// for a kind nobody thought to add. All three shipped: ACCESS_KEY had a label and a glyph
// but no category, so it rendered in the asset tint while calling itself an access key;
// nine kinds were aliases onto another kind's paths; and ISSUE and EXCESSIVE_ACCESS_FINDING
// were byte-identical warning triangles. None of it failed a test, because no test looked.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CATEGORY_LABELS, CATEGORY_ORDER, KIND_CATEGORY, KIND_LABELS, glyphPaths,
} from "../src/client/js/icons.js";
import { NODE_KINDS } from "../src/domain/graphTypes";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const HELP_PAGE_JS = readFileSync(join(root, "src/client/js/pages/help.js"), "utf8");

/** An entry is a `d` string, or `{ d, solid }` for a filled path. */
const dOf = (p) => (typeof p === "string" ? p : p.d);

/**
 * Every point the pen lands on, walking the path.
 *
 * The naive check — scan the numbers, flag anything outside the grid — is wrong, because a
 * relative command's arguments are DELTAS. It reads `h-12` as a coordinate of -12 and
 * condemns a perfectly centred 12-wide box. Position has to be tracked to say anything at
 * all about the grid.
 *
 * Arc bulge is not modelled and does not need to be: endpoints catch a typo'd coordinate,
 * which is the failure this exists for. Control points count as points, since they bound
 * the curve they belong to.
 */
function penPoints(d) {
  const pts = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  const re = /([MmLlHhVvAaZzCcSsQqTt])([^MmLlHhVvAaZzCcSsQqTt]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const cmd = m[1].toUpperCase();
    const rel = m[1] !== cmd;
    const n = (m[2].match(/-?\d*\.?\d+/g) || []).map(Number);
    if (cmd === "Z") { x = sx; y = sy; continue; }
    if (cmd === "H") { for (const v of n) { x = rel ? x + v : v; pts.push([x, y]); } continue; }
    if (cmd === "V") { for (const v of n) { y = rel ? y + v : v; pts.push([x, y]); } continue; }
    if (cmd === "A") {
      // rx ry rot large sweep x y — only the last pair is a coordinate.
      for (let i = 0; i + 6 < n.length; i += 7) {
        x = rel ? x + n[i + 5] : n[i + 5];
        y = rel ? y + n[i + 6] : n[i + 6];
        pts.push([x, y]);
      }
      continue;
    }
    for (let i = 0; i + 1 < n.length; i += 2) {
      x = rel ? x + n[i] : n[i];
      y = rel ? y + n[i + 1] : n[i + 1];
      pts.push([x, y]);
      if (cmd === "M" && i === 0) { sx = x; sy = y; }
    }
  }
  return pts;
}

describe("node-kind icon coverage", () => {
  it("gives every NODE_KIND a glyph, a label and a category", () => {
    for (const kind of NODE_KINDS) {
      expect(glyphPaths(kind), `${kind} has no glyph`).not.toBeNull();
      expect(KIND_LABELS, `${kind} has no label`).toHaveProperty(kind);
      expect(KIND_CATEGORY, `${kind} has no category`).toHaveProperty(kind);
    }
  });

  // The reverse direction: a kind deleted from the enum but left in the sprite is dead
  // weight in a bundle whose bytes are first-paint latency, and it hides a rename.
  it("carries nothing NODE_KINDS does not", () => {
    const known = new Set(NODE_KINDS);
    for (const kind of Object.keys(KIND_LABELS)) {
      expect(known.has(kind), `${kind} is labelled but not a NODE_KIND`).toBe(true);
    }
    for (const kind of Object.keys(KIND_CATEGORY)) {
      expect(known.has(kind), `${kind} has a category but is not a NODE_KIND`).toBe(true);
    }
  });
});

describe("node-kind icon distinctness", () => {
  // The invariant the alias block broke. If a pair is ever deliberately shared, name it
  // here so the decision is written down rather than inferred from a passing test.
  const ALLOWED_SHARED_GLYPHS = [];

  it("draws each kind differently", () => {
    const byShape = new Map();
    for (const kind of NODE_KINDS) {
      const key = JSON.stringify(glyphPaths(kind));
      byShape.set(key, [...(byShape.get(key) || []), kind]);
    }
    const shared = [...byShape.values()]
      .filter((kinds) => kinds.length > 1)
      .map((kinds) => kinds.join(" = "))
      .filter((pair) => !ALLOWED_SHARED_GLYPHS.includes(pair));
    expect(shared, "these kinds draw the same glyph").toEqual([]);
  });
});

describe("node-kind icon categories", () => {
  it("files every kind under a category the legend shows", () => {
    const known = new Set([...CATEGORY_ORDER, "neutral"]);
    for (const [kind, cat] of Object.entries(KIND_CATEGORY)) {
      expect(known.has(cat), `${kind} is filed under unknown category ${cat}`).toBe(true);
    }
  });

  it("glosses every category in the legend order", () => {
    for (const cat of CATEGORY_ORDER) {
      expect(CATEGORY_LABELS, `${cat} has no legend label`).toHaveProperty(cat);
    }
  });
});

describe("node-kind icon path hygiene", () => {
  // esbuild.config.mjs fails the build on a backtick or a bare `//` surviving into the
  // client bundle. Asserting it here names the kind, at `npm test`, instead of surfacing
  // as an unattributed build error minutes later.
  it("writes path data the middlebox guard accepts", () => {
    for (const kind of NODE_KINDS) {
      for (const d of glyphPaths(kind).map(dOf)) {
        expect(d.startsWith("M"), `${kind}: "${d}" does not start with M`).toBe(true);
        expect(d.includes("`"), `${kind}: "${d}" contains a backtick`).toBe(false);
        expect(d.includes("//"), `${kind}: "${d}" contains a double slash`).toBe(false);
      }
    }
  });

  it("keeps the pen inside the 16 grid", () => {
    for (const kind of NODE_KINDS) {
      for (const d of glyphPaths(kind).map(dOf)) {
        for (const [x, y] of penPoints(d)) {
          const inside = x >= -0.5 && x <= 16.5 && y >= -0.5 && y <= 16.5;
          expect(inside, `${kind}: pen reaches (${x}, ${y}) in "${d}"`).toBe(true);
        }
      }
    }
  });

  // A filled path that never closes is a rendering accident waiting to happen.
  it("closes every solid path", () => {
    for (const kind of NODE_KINDS) {
      for (const p of glyphPaths(kind)) {
        if (typeof p === "string" || !p.solid) continue;
        expect(p.d.trim().endsWith("Z"), `${kind}: solid path does not close`).toBe(true);
      }
    }
  });
});

describe("the Help specimen", () => {
  // helpContent.js states the rule for the whole Help surface: A MARK IS RENDERED, NEVER
  // REDRAWN, "so a specimen cannot drift into being a picture of a component that no longer
  // looks like that". anatomySvg() was the sole violator — it re-typed AI_AGENT's and
  // MISSING_GUARDRAIL's path arrays byte for byte.
  it("renders marks rather than copying their path data", () => {
    for (const kind of NODE_KINDS) {
      for (const d of glyphPaths(kind).map(dOf)) {
        expect(
          HELP_PAGE_JS.includes(d),
          `pages/help.js hand-copies ${kind}'s path data — call kindIcon() instead`,
        ).toBe(false);
      }
    }
  });

  it("draws its marks through kindIcon", () => {
    expect(HELP_PAGE_JS).toContain("kindIcon(");
  });

  /**
   * The check above only catches a copy of a CURRENT glyph, which is exactly the case a
   * stale copy escapes: once the sprite is redrawn, the copied strings match nothing and
   * the assertion passes while the figure quietly draws last month's mark. That is not
   * hypothetical — it is what this file did.
   *
   * So the structural rule instead: no glyph-scale path data in this file at all. The
   * figure's own geometry lives in a 640x126 viewBox and runs to the hundreds
   * ("M244 66 H414"); anything starting inside the 16 grid is a glyph that should have
   * been rendered.
   */
  it("holds no glyph-scale path data of its own", () => {
    const suspects = [...HELP_PAGE_JS.matchAll(/"(M(\d+(?:\.\d+)?)[^"]*)"/g)]
      .filter((m) => Number(m[2]) <= 16.5)
      .map((m) => m[1]);
    expect(suspects, "these look like glyph paths — render the mark instead").toEqual([]);
  });
});
