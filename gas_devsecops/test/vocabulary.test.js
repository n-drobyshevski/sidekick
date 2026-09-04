// One vocabulary, held to the one place it is written.
//
// THE RULE, in full, lives in README.md above the Pages table and nowhere else: **a sync is
// the act; a scan is the record it wrote.** You run a sync; it touches three registers and
// saves one scan per register; you browse scans. So "Scan history", "Saved scans", "Delete
// scans" and "first scan / last scan" are right — they name records — while "run a scan" is
// not, because a scan is not a thing that runs. Wiz's own detectors are a third thing, the
// scanner. And a lower bound is written one way per context: "at least N" in prose, "≥ N" in
// a figure, never ">" — "at least" is inclusive and ">" is not.
//
// WHY THIS FILE EXISTS RATHER THAN A README PARAGRAPH ALONE. Before this package the rule was
// nowhere and the drift was everywhere: the rail's status area was the "scan zone" in five
// pages' copy, four first-run panels said "Run a sync from the scan zone in the rail", the
// history page called the sync battery a "scan battery", and three registers said "nothing has
// been scanned yet" for a ledger nobody had synced. Every one of those reads as a control or
// an object the reader then goes looking for and does not find.
//
// SOURCE TEXT, COMMENT-STRIPPED. The stripper is `emptyStates.test.js`'s, copied for the same
// reason it was written stricter there than in `pagesLit.test.js`: this very header quotes the
// sentences it forbids, and a helper that leaks comment text would fail on its own explanation.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLIENT_DIR = fileURLToPath(new URL("../src/client/js/", import.meta.url));
const PAGES_DIR = fileURLToPath(new URL("../src/client/js/pages/", import.meta.url));
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** Every `.js` under `src/client/js/`, recursively, as repo-relative-ish labels. */
function walk(dir, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, prefix + name + "/"));
    else if (name.endsWith(".js")) out.push([prefix + name, full]);
  }
  return out;
}

/**
 * The file with EVERY comment removed — `//` and block comments both — string-aware, and
 * tracking template literals too. Copied verbatim from `test/emptyStates.test.js`; see that
 * file's doc comment for the apostrophe-in-a-block-comment defect that made the stricter
 * version necessary.
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

const CLIENT = walk(CLIENT_DIR).map(([label, full]) => [label, code(readFileSync(full, "utf8"))]);
const PAGES = walk(PAGES_DIR).map(([label, full]) => [label, code(readFileSync(full, "utf8"))]);

// =========================================================================================
//  1. "scan" never names the act
// =========================================================================================

/**
 * Each pattern is a phrasing that shipped in this package. `scan zone` needs the SPACE: the
 * CSS class `.scan-zone` and its stylesheet rules are identifiers, deliberately left alone,
 * and a hyphen is what tells them apart from the words a reader sees.
 */
const SCAN_AS_ACT = [
  [/scan zone/i, "the rail holds the Run sync button and the sync status — call it the sync zone, or name the button"],
  [/\brun(?:s|ning)?\s+(?:a|an|the|another)?\s*scans?\b/i, "you run a sync; a scan is the record it wrote"],
  [/\bstart(?:s|ed|ing)?\s+(?:a|an|the|another)?\s*scans?\b/i, "a sync is started; a scan is saved"],
  [/\bscan battery\b/i, "the battery is a sync battery — it writes scans"],
  [/\b(?:been|being|was|were)\s+scanned\b/i, "\"scanned\" names the act — say what the sync did"],
];

describe("no user-visible string in the client says \"scan\" for the act", () => {
  it("holds every module under src/client/js", () => {
    const hits = [];
    for (const [label, src] of CLIENT) {
      for (const [re, why] of SCAN_AS_ACT) {
        const m = src.match(re);
        if (m) hits.push(`${label}: ${JSON.stringify(m[0])} — ${why}`);
      }
    }
    expect(hits, "the act is spelled \"scan\":\n  " + hits.join("\n  ")).toEqual([]);
  });

  // NOT A VACUOUS SWEEP. The patterns above only bite where the words appear, so this proves
  // each one still matches the exact sentence it was written to catch — the strings are the
  // pre-P6 copy, quoted from the baseline.
  it("is not a vacuous sweep — every pattern still matches the copy it replaced", () => {
    const BASELINE = [
      '"Run a sync from the scan zone in the rail."',
      '"Run a scan"',
      '"start a scan now"',
      '"a scan battery carries no project dimension to narrow by."',
      '"No register has been scanned yet."',
    ];
    for (let i = 0; i < SCAN_AS_ACT.length; i++) {
      expect(
        BASELINE.some((s) => SCAN_AS_ACT[i][0].test(s)),
        `pattern ${SCAN_AS_ACT[i][0]} matches none of the baseline sentences`,
      ).toBe(true);
    }
  });

  // The rail button is the control the whole vocabulary points at, so its copy is pinned by
  // name rather than only by the sweep above.
  it("the rail's run control is labelled \"Run sync\"", () => {
    const app = CLIENT.find(([label]) => label === "app.js")[1];
    expect(app, "the rail button lost its \"Run sync\" label").toContain('"Run sync"');
  });
});

// =========================================================================================
//  2. ">" is not a bound notation
// =========================================================================================

/**
 * `> ` in front of a number or a formatter call — the three shapes a bound can be written in:
 *
 *   "> " + days1(bound)          concatenated
 *   `> ${days1(bound)}`          interpolated
 *   "> 41.2 d"                   spelled out
 *
 * NO EXEMPTIONS, and that is the point. There used to be two: `boundedDays` was defined twice,
 * in `pages/repos.js` and `pages/sca.js`, and both spelled a lower bound `"> 41.2 d"`. There is
 * now ONE implementation, in `ui/figures.js`, and it spells it `"≥ 41.2 d"` — so the guard needs
 * no allow-list, and an allow-list is what would let the next copy of it in.
 *
 * The sweep runs over every module under `src/client/js/`, not just `pages/`, because that is
 * where the implementation moved to.
 */
/** Newline plus indent, for the multi-line failure messages below. */
const BR = String.fromCharCode(10) + "  ";

const BOUND_GT = /(?:"> "\s*\+\s*[A-Za-z_$][\w$]*\(|> \$\{[A-Za-z_$][\w$]*\(|"> \d)/g;

describe("a lower bound is never written with \">\"", () => {
  it("finds no \">\" bound anywhere in the client", () => {
    const hits = [];
    for (const [label, src] of CLIENT) {
      for (const m of src.match(BOUND_GT) || []) hits.push(`${label}: ${JSON.stringify(m)}`);
    }
    expect(
      hits,
      "\">\" is not a bound — prose says \"at least N\", a figure says \"≥ N\" "
      + "(README.md, above the Pages table):" + BR + hits.join(BR),
    ).toEqual([]);
  });

  // NOT A VACUOUS SWEEP. The regex has to bite on all three shapes, and let the correct
  // notation through.
  it("is not a vacuous sweep — the pattern matches all three shapes and spares the right one", () => {
    expect('return { text: "> " + days1(bound) };'.match(BOUND_GT)).not.toBeNull();
    expect("return { text: `> ${days1(bound)}` };".match(BOUND_GT)).not.toBeNull();
    expect('caption("> 41.2 d")'.match(BOUND_GT)).not.toBeNull();

    expect('value: "at least " + fmtDays(bound)'.match(BOUND_GT)).toBeNull();
    expect('text: "≥ " + fmtDays(mean)'.match(BOUND_GT)).toBeNull();
    expect("if (a > 3) return b;".match(BOUND_GT)).toBeNull();
  });

  // The positive half: the one implementation is where the sweep says it is, and it spells the
  // bound the inclusive way. Without this, deleting `boundedDays` outright would pass above.
  it("the one shared implementation spells the bound \"≥\"", () => {
    const figures = CLIENT.find(([label]) => label === "ui/figures.js")[1];
    expect(figures, "boundedDays is not in ui/figures.js").toMatch(/export function boundedDays\(/);
    expect(figures, "the shared bound formatter does not spell it \"≥\"").toMatch(/≥ \$\{days1\(/);
    for (const page of ["pages/repos.js", "pages/sca.js"]) {
      const src = CLIENT.find(([label]) => label === page)[1];
      expect(src, `${page} defines a second boundedDays`)
        .not.toMatch(/export function boundedDays\(/);
    }
  });
});

// =========================================================================================
//  3. The rule is written in exactly one place
// =========================================================================================

const RULE = "**A sync is the act; a scan is the record it wrote.**";

describe("README.md carries the vocabulary rule, once", () => {
  it("states it exactly once", () => {
    const n = README.split(RULE).length - 1;
    expect(n, `README.md states the rule ${n} time(s); it is the one place it is written`)
      .toBe(1);
  });

  it("states all four clauses a reader has to be able to check", () => {
    const para = README.slice(README.indexOf(RULE), README.indexOf(RULE) + 1200);
    expect(para, "the rule does not say a sync saves one scan per register")
      .toMatch(/one scan per register/);
    expect(para, "the rule does not name the Run sync button").toMatch(/Run sync/);
    expect(para, "the rule does not name the scanner as the third thing").toMatch(/scanner/);
    expect(para, "the rule does not fix the lower-bound notation")
      .toMatch(/at least N[\s\S]{0,120}≥ N/);
  });

  it("is pointed at from the page whose title is the record", () => {
    const history = readFileSync(join(PAGES_DIR, "history.js"), "utf8");
    expect(history, "history.js does not point at the one place the rule is written")
      .toMatch(/README\.md above the Pages table/);
  });
});
