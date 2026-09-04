// dataTable()'s per-column `wrap: true` (P8) — the DOM-free half is `cellClassName` in
// ui/tableModel.js, tested directly below; the DOM half (ui/data.js actually calling it, and
// tables.css's `.col-wrap` rule) is read as source text, the split test/navGroups.test.js and
// test/projectScopeView.test.js already use (vitest.config.ts sets no `environment`, so there
// is no jsdom to render a real `<table>` in).
//
// WHAT THIS GUARDS. The secrets register's "Removed is not rotated" four-corner table has a
// prose Reading column that truncated mid-sentence behind tables.css's blanket 320px
// nowrap-ellipsis clip on `table.data td` — down to "The string is out of HEAD and the
// credential was observed de…" at 1280px, worse narrower. `wrap: true` opts that ONE column
// out of the clip without touching the numeric Findings column beside it, which still wants
// its single line.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cellClassName } from "../src/client/js/ui/tableModel.js";

const DATA_SRC = readFileSync(new URL("../src/client/js/ui/data.js", import.meta.url), "utf8");
const TABLES_CSS = readFileSync(new URL("../src/client/styles/tables.css", import.meta.url), "utf8");
const SECRETS_SRC = readFileSync(new URL("../src/client/js/pages/secrets.js", import.meta.url), "utf8");

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

describe("the secrets four-corner table's Reading column opts into wrap", () => {
  it("declares wrap: true on the reading column, not on the Findings column beside it", () => {
    const readingCol = SECRETS_SRC.slice(
      SECRETS_SRC.indexOf('key: "reading"'),
      SECRETS_SRC.indexOf("\n", SECRETS_SRC.indexOf('key: "reading"')),
    );
    expect(readingCol).toMatch(/wrap:\s*true/);

    const countCol = SECRETS_SRC.slice(
      SECRETS_SRC.indexOf('key: "count", label: "Findings"'),
      SECRETS_SRC.indexOf("\n", SECRETS_SRC.indexOf('key: "count", label: "Findings"')),
    );
    expect(countCol).not.toMatch(/wrap:\s*true/);
  });

  // PERTURBATION, run by hand during P8: removing `wrap: true` from the reading column here
  // makes this test fail (no match) while leaving every other test in this file green — the
  // flag is the only thing standing between the Reading column and the blanket clip.
});
