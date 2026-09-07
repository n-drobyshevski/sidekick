// dataTable()'s per-column `wrap: true` (P8) — the DOM-free half is `cellClassName` in
// ui/tableModel.js, tested directly below; the DOM half (ui/data.js actually calling it, and
// tables.css's `.col-wrap` rule) is read as source text, the split test/shared.test.js and
// test/projectScopeView.test.js already use (vitest.config.ts sets no `environment`, so there
// is no jsdom to render a real `<table>` in).
//
// WHAT THIS GUARDS. The secrets register's "Removed is not rotated" four-corner table has a
// prose Reading column that truncated mid-sentence behind tables.css's blanket 320px
// nowrap-ellipsis clip on `table.data td` — down to "The string is out of HEAD and the
// credential was observed de…" at 1280px, worse narrower. `wrap: true` opts that ONE column
// out of the clip without touching the numeric Findings column beside it, which still wants
// its single line.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cellClassName } from "../../gas_shared/ui/tableModel.js";
import { REMOVAL_CELLS, removalQuadModel } from "../src/client/js/pages/secrets.js";

const DATA_SRC = readFileSync(new URL("../../gas_shared/ui/data.js", import.meta.url), "utf8");
const TABLES_CSS = readFileSync(new URL("../../gas_shared/styles/tables.css", import.meta.url), "utf8");
const SECRETS_SRC = readFileSync(new URL("../src/client/js/pages/secrets.js", import.meta.url), "utf8");
const COMPONENTS_CSS = readFileSync(
  new URL("../../gas_shared/styles/components.css", import.meta.url), "utf8",
);
const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);
/**
 * The file with its comments removed — string-aware, so a `//` inside a quote survives.
 * The fourth copy of `pagesLit.test.js`'s `code()`, for the reason `chartTable.test.js`
 * gives for the third: those files are protected and there is no shared test helper.
 *
 * IT IS LOAD-BEARING FOR THE LAST CASE BELOW: `secrets.js`'s own comment EXPLAINS that its
 * four-corner table used to carry a prose reading "in a `wrap: true` cell", and a raw-text
 * sweep counts that sentence as a call site — measured, on the first run of that case.
 */
function code(src) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const PAGE_SOURCES = readdirSync(PAGES_DIR)
  .filter((f) => f.endsWith(".js"))
  .map((f) => [f, code(readFileSync(new URL(f, PAGES_DIR), "utf8"))]);

describe("cellClassName — the DOM-free half of a column's <td> class", () => {
  it("adds no class for an ordinary column", () => {
    expect(cellClassName({ key: "label" })).toBeNull();
  });

  it("keeps a column's own className untouched when it does not wrap", () => {
    expect(cellClassName({ className: "num" })).toBe("num");
  });

  it("adds col-wrap for a wrap:true column, alongside any className it already carries", () => {
    expect(cellClassName({ wrap: true })).toBe("col-wrap");
    expect(cellClassName({ className: "num", wrap: true })).toBe("num col-wrap");
  });

  it("does not add col-wrap for wrap:false or an absent flag", () => {
    expect(cellClassName({ className: "num", wrap: false })).toBe("num");
    expect(cellClassName({})).toBeNull();
  });
});

describe("ui/data.js actually reaches cellClassName for every cell it builds", () => {
  it("imports cellClassName from tableModel.js", () => {
    expect(DATA_SRC).toMatch(/import\s*\{[^}]*\bcellClassName\b[^}]*\}\s*from\s*"\.\/tableModel\.js"/);
  });

  // PERTURBATION: with `cellClassName(col)` reverted to the old inline
  // `col.className || null`, this fails because the <td> class no longer routes through the
  // function a wrap:true column depends on — confirmed by hand during P8, then reverted.
  it("builds every <td> class through cellClassName, not a bespoke inline expression", () => {
    expect(DATA_SRC).toMatch(/el\("td",\s*\{\s*class:\s*cellClassName\(col\)\s*\}/);
  });
});

describe("tables.css honours col-wrap over the 320px nowrap-ellipsis clip", () => {
  it("gives table.data td.col-wrap enough specificity to win over table.data td", () => {
    // `table.data td` alone is (0,0,1,2); a bare `.col-wrap` or `td.col-wrap` loses to it, the
    // same trap `.detail-row > td` above it in the file already names and works around by
    // repeating `table.data` in its own selector.
    expect(TABLES_CSS).toMatch(/table\.data\s+td\.col-wrap\s*\{/);
  });

  it("resets white-space, max-width, overflow and text-overflow together", () => {
    const rule = TABLES_CSS.slice(
      TABLES_CSS.indexOf("table.data td.col-wrap"),
      TABLES_CSS.indexOf("}", TABLES_CSS.indexOf("table.data td.col-wrap")),
    );
    expect(rule).toMatch(/white-space:\s*normal/);
    expect(rule).toMatch(/max-width:\s*none/);
    expect(rule).toMatch(/overflow:\s*visible/);
    expect(rule).toMatch(/text-overflow:\s*clip/);
  });
});

/**
 * THE COLUMN THIS FILE WAS OPENED FOR IS GONE, AND THAT IS WHY THIS DESCRIBE CHANGED.
 *
 * The case here used to read "declares wrap: true on the reading column, not on the Findings
 * column beside it", over `secrets.js`'s four-corner table: five columns — Corner, two
 * yes/no axis columns, Findings, and a prose Reading column carrying a 24-word sentence per
 * row. `wrap: true` was what kept that sentence out of `tables.css`'s blanket 320px
 * nowrap-ellipsis clip.
 *
 * MEASURED, at the density wave's Wave B: that table is a `quadTable` now (ui/quad.js) —
 * two yes/no questions drawn as the 2x2 they are, with each corner's reading on the corner's
 * own label as a tip. There is no `key: "reading"` column in `secrets.js`, and a grep across
 * all four apps' `src/` finds NO `wrap: true` call site at all. So the assertion above was
 * checking a column that does not exist, on a table that is not drawn.
 *
 * WHAT IS ASSERTED INSTEAD. Three things, none of them weaker than the old case: that the
 * prose column really is gone rather than renamed; that the reading it carried is still
 * reachable (it is on `REMOVAL_CELLS` and rides into the corner's `help`); and that the
 * surface it moved onto has its own answer to the clip — `.quad td` sets
 * `overflow-wrap: break-word` and no max-width, which is the property that makes a long
 * reading safe there. The `cellClassName` / `data.js` / `tables.css` cases above are
 * untouched: `wrap: true` is still a real column flag with a real implementation, and the
 * last case below states, as a fact rather than a silence, that nothing calls it today.
 */
describe("the secrets four-corner table is a 2x2, and its readings are not in a clipped cell", () => {
  it("draws no prose Reading column any more", () => {
    expect(SECRETS_SRC).not.toMatch(/key:\s*"reading"/);
    expect(SECRETS_SRC).toMatch(/quadTable\(/);
  });

  it("keeps every corner's reading, on the corner rather than in a cell", () => {
    for (const cell of REMOVAL_CELLS) {
      expect(typeof cell.reading, `${cell.id} lost its reading`).toBe("string");
      expect(cell.reading.length).toBeGreaterThan(20);
    }
    const model = removalQuadModel({
      removalVsRotation: {
        total: 4,
        cells: REMOVAL_CELLS.map((c) => ({ ...c, count: 1 })),
      },
    });
    // Every corner carries its old Reading sentence as the tip's lines — nothing was dropped
    // in the move, which is the failure this replacement case exists to catch.
    const readings = model.corners.map((c) => c.help.lines[0]).sort();
    expect(readings).toEqual(REMOVAL_CELLS.map((c) => c.reading).sort());
  });

  it("gives the quad's own cells a wrapping rule, so a long reading is not clipped there", () => {
    const rule = COMPONENTS_CSS.slice(
      COMPONENTS_CSS.indexOf(".quad th, .quad td"),
      COMPONENTS_CSS.indexOf("}", COMPONENTS_CSS.indexOf(".quad th, .quad td")),
    );
    expect(rule).toMatch(/overflow-wrap:\s*break-word/);
    expect(rule).not.toMatch(/max-width/);
  });

  it("records that col-wrap has no caller today, rather than leaving that a silence", () => {
    // A guard that fires on nothing is a finding, not a pass (CLAUDE.md). The mechanism above
    // is correct and implemented; this states that no page reaches for it right now, so the
    // next page that needs a wrapping column finds a working flag and a test that says so —
    // and so that a call site RE-appearing shows up here as a change rather than silently.
    const callers = PAGE_SOURCES.filter(([, src]) => /wrap:\s*true/.test(src));
    expect(callers.map(([name]) => name)).toEqual([]);
  });
});
