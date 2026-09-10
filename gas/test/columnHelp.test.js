// Every `dataTable` column heading in these six pages defines itself, or is named on an
// allowlist that says why it doesn't need to.
//
// THE DEFECT THIS PINS. Before P1.4, about 60% of the table headings across these pages carried
// no definition at all — History's 10-column scans table and its 3 movement-decomposition
// columns, every Attribution table, most of MTTR's by-domain and per-severity columns,
// Overview's oldest-open tables, Program's cohort and capacity tables. `dataTable`
// (gas_shared/ui/data.js) has always taken a `help` option per column and drawn it as a
// `tipLabel` on the `<th>` — every one of those headings could have carried a definition from
// the day the shared component shipped, and simply did not.
//
// WHAT COUNTS AS A COLUMN HERE, AND WHY `format:` COLUMNS DO NOT. `trendTableModel` /
// `chartTableModel` (pages/_charts.js) build a DIFFERENT column shape — `{ key, label,
// format }`, no `cell`, the data-table alternative for a canvas — and gas_shared's
// `chartTable`/`chartTableModel` draw a plain `<th>` with no `tipLabel` call at all: there is
// nowhere for a `help` option to attach on that component, and `chartTable.test.js` already
// pins that table to the canvas 1:1. Every REAL `dataTable` column in this app carries a
// `cell:` function; every chart-table-alternative column carries `format:` instead. That is
// the one structural difference this sweep keys on, and it holds across all six files —
// `checkcols.mjs`-style verification below found no `cell:` column without either `help:` or
// an allowlist entry, and no chart-table column ever needing either.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGE_FILES = ["mttr.js", "overview.js", "program.js", "history.js", "attribution.js", "data.js"];

/**
 * Every `{ key: "...", ... }` object in `src` that is a real dataTable column (carries
 * `cell:`), as `{ file, key, text }`. Brace-balanced from the object's own opening `{`, so a
 * cell function that builds its own `el(..., { class: "..." }, ...)` object literals inside
 * does not truncate the scan early — every `{`/`}` in the slice is counted, nested or not.
 */
function findColumns(file, src) {
  const out = [];
  const re = /\{\s*\n?\s*key:\s*"([a-zA-Z0-9_]+)"/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    let depth = 0;
    let j = start;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const text = src.slice(start, j + 1);
    if (/\bcell:/.test(text)) out.push({ file, key: m[1], text });
    re.lastIndex = j + 1;
  }
  return out;
}

// Named, with a reason — never a bare list of keys. Both entries are the SAME shape:
// `label: ""`, a column whose heading is deliberately blank because the button inside it
// names its own action ("Attribute…", "Edit"). A `?` beside an empty heading would define a
// heading that says nothing, which is not what a column definition is for.
const ALLOWLIST = [
  {
    file: "attribution.js", key: "attribute",
    reason: "empty heading (label: \"\") — the \"Attribute…\" button names its own action; "
      + "there is no heading text for a `?` to sit beside.",
  },
  {
    file: "attribution.js", key: "edit",
    reason: "empty heading (label: \"\") — the \"Edit\" button names its own action; there is "
      + "no heading text for a `?` to sit beside.",
  },
];

function isAllowed(file, key) {
  return ALLOWLIST.some((a) => a.file === file && a.key === key);
}

describe("columnHelp: findColumns (the sweep function itself)", () => {
  it("finds a dataTable column (carries cell:) and ignores a chart-table column (carries "
    + "format:, no cell:)", () => {
    const snippet = `
      const columns = [
        { key: "sev", label: "Severity", help: ["x"], cell: (r) => r.sev },
        { key: "y", label: "Open findings", format: "count" },
      ];
    `;
    const found = findColumns("snippet.js", snippet);
    expect(found.map((c) => c.key)).toEqual(["sev"]);
  });

  // PERTURBATION: removing a `help:` from a column that has one has to make the sweep see a
  // gap — otherwise "every column has help, except an allowlist" is a claim this file cannot
  // actually falsify, and the whole point of a sweep is that it can.
  it("reports a column with no help: — the perturbation this sweep exists for", () => {
    const withHelp = `{ key: "sev", label: "Severity", help: ["x"], cell: (r) => r.sev }`;
    const withoutHelp = `{ key: "sev", label: "Severity", cell: (r) => r.sev }`;
    const before = findColumns("snippet.js", `const columns = [${withHelp}];`);
    const after = findColumns("snippet.js", `const columns = [${withoutHelp}];`);
    expect(/\bhelp:/.test(before[0].text)).toBe(true);
    expect(/\bhelp:/.test(after[0].text)).toBe(false);
  });
});

describe("columnHelp: every dataTable column in the six pages has help, or is allowlisted", () => {
  const problems = [];
  const seenAllowlistKeys = new Set();
  for (const file of PAGE_FILES) {
    const src = readFileSync(new URL("../src/client/js/pages/" + file, import.meta.url), "utf8");
    for (const col of findColumns(file, src)) {
      if (/\bhelp:/.test(col.text)) continue;
      if (isAllowed(file, col.key)) {
        seenAllowlistKeys.add(`${file}::${col.key}`);
        continue;
      }
      problems.push(`${file}: column "${col.key}" has no help and is not on the allowlist`);
    }
  }

  it("names every gap, rather than passing on a silent one", () => {
    expect(problems).toEqual([]);
  });

  it("the allowlist is not decorative — every entry on it is actually reached", () => {
    // An allowlist entry naming a column this sweep never finds (a rename, a removed column)
    // is worse than no allowlist: it would keep excusing a gap that no longer exists to excuse,
    // and nobody would notice because the sweep above would just as happily pass without it.
    for (const a of ALLOWLIST) {
      expect(seenAllowlistKeys.has(`${a.file}::${a.key}`),
        `allowlist entry ${a.file}::${a.key} was never reached by the sweep`).toBe(true);
    }
  });
});
