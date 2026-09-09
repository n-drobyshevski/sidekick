// Every `dataTable` column heading across the ten register pages defines itself, or is
// exempt for a stated reason.
//
// PORTED FROM gas/test/columnHelp.test.js, adapted to a fact its regex did not have to face:
// gas_ai's own pages build a column's `cell:` two different ways. combos.js and problems.js
// keep `cell:` inline on each column literal, the same shape gas's mttr.js/history.js use —
// but inventory.js's COLUMNS array carries only `key:`, `label:` and `sort:`, and looks its
// `cell:` up from a separate CELLS map at render time (`CELLS[col.key]`). gas's own sweep
// required `cell:` in the SAME literal, which would have silently found zero columns in
// inventory.js and passed for the wrong reason — a guard that fires on nothing. So a column
// here is anything carrying `key:` OR `cell:` (an OR, not gas's AND), which catches both
// shapes without widening what counts as a column: nothing in these ten files has one of the
// two tokens without also being a real dataTable column.
//
// THE SECOND SHAPE DIFFERENCE: gas_ai's per-table columns live in three source forms —
// `const COLS = [...]` (combos.js, problems.js — cell inline), `const COLUMNS = [...]`
// (inventory.js, compliance.js — key/label/sort only, or key/label/cell), and a bare
// `columns: [...]` literal passed straight to `dataTable()` (data.js, complianceOverview.js,
// complianceShared.js, config.js, scans.js). All three are swept the same way: find the
// array's own opening `[`, bracket-balance to its close (which also correctly balances a
// `help: { lines: [...] }` array nested inside one of its columns — every `[` has a matching
// `]` regardless of nesting), then read out each column as a brace-balanced top-level `{...}`
// object inside that slice.
//
// THE ONE EXEMPT FILE'S SHAPE IS A FOURTH ONE: queryTable.js has no static column list at
// all — `columns.push({...})` builds one entry per FIELD THE READER'S OWN GRAPH QUERY ASKED
// FOR, at runtime, inside a loop. The literal object at that one call site is still found (a
// `columns.push({` opens exactly like any other column object), but every column it ever
// produces shares that one un-labelable literal, which is what the allowlist below excuses.
//
// WHAT DOES NOT COUNT AS A COLUMN NEEDING HELP: a column whose heading is the empty string
// (`label: ""`) — inventory.js's Graph-button column is the one case, and DESIGN.md's Tip
// section is explicit that a `?` needs a visible label to sit beside. This is a STRUCTURAL
// exemption (any file, any column), not an allowlist entry, because there is nothing for a
// reader to define: the button inside the cell already names its own action.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE_FILES = [
  "combos.js", "compliance.js", "complianceOverview.js", "complianceShared.js",
  "config.js", "data.js", "inventory.js", "problems.js", "scans.js",
];

/** { file, path relative to this test file } for every file the sweep reads. */
const FILES = [
  ...PAGE_FILES.map((f) => ({ file: f, path: "../src/client/js/pages/" + f })),
  // The graph workbench's results table — not under pages/, and the sweep's one allowlisted
  // file (see the header comment and ALLOWLIST below).
  { file: "queryTable.js", path: "../src/client/js/queryTable.js" },
];

/**
 * Every brace-balanced top-level `{...}` object inside `sliceText`. Depth counts `{`/`}`
 * only — an intervening `[`/`]` (an array literal inside a column, e.g. `help: { lines: [...]
 * }`) never changes brace depth, so it cannot end an object early or merge two together.
 */
function topLevelObjects(sliceText) {
  const objs = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < sliceText.length; i++) {
    const c = sliceText[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        objs.push(sliceText.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objs;
}

/** Bracket-balances `open`/`close` from `openIdx` (which must hold `open`) to its match. */
function balancedEnd(src, openIdx, open, close) {
  let depth = 0;
  let j = openIdx;
  for (; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) {
      depth--;
      if (depth === 0) break;
    }
  }
  return j;
}

/**
 * Every column-defining object literal in `src`, as `{ file, text }` — see the header comment
 * for the three static shapes and the one dynamic (`columns.push`) shape this covers.
 */
function findColumns(file, src) {
  const out = [];

  const arrayRe = /\b(?:const\s+COLS\s*=\s*|const\s+COLUMNS\s*=\s*|columns:\s*)\[/g;
  let m;
  while ((m = arrayRe.exec(src))) {
    const openIdx = m.index + m[0].length - 1; // the "[" itself
    const closeIdx = balancedEnd(src, openIdx, "[", "]");
    const arraySlice = src.slice(openIdx + 1, closeIdx);
    for (const text of topLevelObjects(arraySlice)) {
      if (/\bkey:/.test(text) || /\bcell:/.test(text)) out.push({ file, text });
    }
    arrayRe.lastIndex = closeIdx + 1;
  }

  const pushRe = /columns\.push\(\{/g;
  while ((m = pushRe.exec(src))) {
    const openIdx = m.index + m[0].length - 1; // the "{" itself
    const closeIdx = balancedEnd(src, openIdx, "{", "}");
    out.push({ file, text: src.slice(openIdx, closeIdx + 1) });
    pushRe.lastIndex = closeIdx + 1;
  }

  return out;
}

/** The key a column reports itself under, for a readable gap message. `null` is spelled out
 *  rather than dropped — inventory's own "actions" style entries use it deliberately. */
function keyOf(text) {
  const m = /\bkey:\s*(?:"([a-zA-Z0-9_]+)"|(null))/.exec(text);
  if (!m) return "?";
  return m[1] || "null";
}

function labelOf(text) {
  const m = /\blabel:\s*"([^"]*)"/.exec(text);
  return m ? m[1] : null;
}

// Non-decorative: the sweep must find EXACTLY this many columns in queryTable.js lacking
// `help`, or the allowlist is either excusing a gap that no longer exists (too high) or
// silently missing a new one (too low). queryTable.js has exactly one static column literal
// — `columns.push({...})` — reused for every field a reader's query happens to select.
const ALLOWLIST = { "queryTable.js": 1 };

describe("columnHelp: findColumns (the sweep function itself)", () => {
  it("finds a column carrying only `key:` (inventory.js's split cell-lookup shape) and one "
    + "carrying only `cell:` (combos.js's inline shape), from the same array", () => {
    const snippet = `
      const COLUMNS = [
        { key: "name", label: "Name", sort: "name" },
        { label: "Custom", cell: (r) => r.x },
      ];
    `;
    const found = findColumns("snippet.js", snippet);
    expect(found.length).toBe(2);
  });

  it("ignores an object with neither `key:` nor `cell:`", () => {
    const snippet = `const FACET_LABELS = { severities: "Issue severity", kinds: "Asset kind" };`;
    expect(findColumns("snippet.js", snippet)).toEqual([]);
  });

  it("balances a `help: { lines: [...] }` array nested inside a column without ending the "
    + "object early or merging it with its neighbour", () => {
    const snippet = `
      const COLS = [
        { key: "a", label: "A", help: { lines: ["one", "two"] }, cell: (r) => r.a },
        { key: "b", label: "B", cell: (r) => r.b },
      ];
    `;
    const found = findColumns("snippet.js", snippet);
    expect(found.length).toBe(2);
    expect(keyOf(found[0].text)).toBe("a");
    expect(keyOf(found[1].text)).toBe("b");
  });

  it("finds the one runtime column.push({...}) literal in queryTable.js's own shape", () => {
    const snippet = `
      fields.forEach((field, fi) => {
        columns.push({ key: gi + "." + field.key, label: field.label, cell: (row) => row });
      });
    `;
    const found = findColumns("snippet.js", snippet);
    expect(found.length).toBe(1);
  });

  // PERTURBATION: removing a `help:` from a column that has one has to make the sweep see a
  // gap — otherwise "every column has help, except an allowlist" is a claim this file cannot
  // actually falsify.
  it("reports a column with no help: — the perturbation this sweep exists for", () => {
    const withHelp = `{ key: "sev", label: "Severity", help: { term: "severity" }, cell: (r) => r.sev }`;
    const withoutHelp = `{ key: "sev", label: "Severity", cell: (r) => r.sev }`;
    const before = findColumns("snippet.js", `const COLS = [${withHelp}];`);
    const after = findColumns("snippet.js", `const COLS = [${withoutHelp}];`);
    expect(/\bhelp:/.test(before[0].text)).toBe(true);
    expect(/\bhelp:/.test(after[0].text)).toBe(false);
  });
});

describe("columnHelp: every dataTable column in the ten pages plus queryTable.js has help, "
  + "or is exempt", () => {
  const problems = [];
  const allowlistHits = {};

  for (const { file, path } of FILES) {
    const src = readFileSync(new URL(path, import.meta.url), "utf8");
    for (const col of findColumns(file, src)) {
      if (/\bhelp:/.test(col.text)) continue;
      // Structural exemption, not an allowlist entry — see the header comment. Applies to
      // ANY file; today it fires only on inventory.js's Graph-button column.
      if (labelOf(col.text) === "") continue;
      if (file === "queryTable.js") {
        allowlistHits[file] = (allowlistHits[file] || 0) + 1;
        continue;
      }
      problems.push(`${file}: column "${keyOf(col.text)}" has no help and is not exempt`);
    }
  }

  it("names every gap, rather than passing on a silent one", () => {
    expect(problems).toEqual([]);
  });

  it("the queryTable.js allowlist is not decorative — it is reached exactly as many times "
    + "as declared, never more and never fewer", () => {
    for (const [file, n] of Object.entries(ALLOWLIST)) {
      expect(allowlistHits[file] || 0, `${file} allowlist count`).toBe(n);
    }
    for (const file of Object.keys(allowlistHits)) {
      expect(ALLOWLIST[file], `${file} is not on the allowlist but was excused`).toBeDefined();
    }
  });

  // PERTURBATION, against the REAL source: deleting one help: from a live column has to name
  // the file and the column, not just fail silently or fail everywhere.
  it("names the file and the column when a real one loses its help: (perturbation)", () => {
    const configSrc = readFileSync(
      new URL("../src/client/js/pages/config.js", import.meta.url), "utf8");
    const defective = configSrc.replace(
      '{\n          key: "severity", label: "Severity", sortable: true, help: { term: "severity" },\n' +
      "          cell: (r) => sevBadge(r.severity),\n        }",
      '{ key: "severity", label: "Severity", sortable: true, cell: (r) => sevBadge(r.severity) }',
    );
    expect(defective, "the replace target must exist verbatim in config.js").not.toBe(configSrc);
    const found = [];
    for (const col of findColumns("config.js", defective)) {
      if (!/\bhelp:/.test(col.text) && labelOf(col.text) !== "") {
        found.push(`config.js: column "${keyOf(col.text)}" has no help and is not exempt`);
      }
    }
    expect(found).toContain('config.js: column "severity" has no help and is not exempt');
  });
});
