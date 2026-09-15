// The register vocabulary's numeric core, and the one guard that stops this app's own pages
// drifting back into a second, buggy copy of it. Ported from `gas/test/figures.test.js`
// (itself ported from `gas_devsecops/test/figures.test.js`) — the same class of defect this
// file's own header names had already bitten gas_ai's own pages in five shapes before P1.1:
// `problems.js`'s `kpiRow`/`actionHeadline` read `Number(fresh.total || 0)` and
// `c.problems ?? data.totalProblems ?? 0`, `formatShare` was `Number(share) || 0` cast BEFORE
// refusing, `inventory.js`'s hero and its three counts hand-typed `kpis.aiAssets ?? 0`,
// `config.js`'s hero did the same for `totals.gaps`/`totals.controls`, and every one of
// `scans.js`/`complianceOverview.js`/`complianceShared.js`/`configView.js`/`problemView.js`/
// `data.js`/`aars.js`/`help.js`/`detailSheets.js` hand-typed its own "—" rather than the one
// shared spelling (`gas_shared/ui/figures.js`'s `absentText`).
//
// THE REDUCER RULE, restated here because the sweep below has to know which "|| 0" it is
// looking at. `censusByCode[code] || 0` and `counts[sev] || 0` used INSIDE a sum over a known
// key set are reducers: a severity or a code that nobody has right now IS a measured zero — the
// census looked, and found none, at that key. They stay `|| 0` and this file does not touch
// them. A SCALAR the server sends once — `fresh.total`, `totals.gaps`, `kpis.aiAssets`,
// `c.top10Share` — is a different kind of field: it can be genuinely absent (the sync has not
// run, the field predates the payload, the fetch has not resolved yet), and `Number(null) || 0`
// reads that absence as a confident, measured zero. CLAUDE.md's working discipline names the
// exact shape: "refuse null/undefined/blank BEFORE the cast, never after, and let
// `Number.isFinite` guard only the values that were really numbers." Every PRINTED figure this
// package touched now refuses first; every reducer this package touched was left alone.
//
// `gas_shared/ui/figures.js` is what every one of those fixes is built on. This file measures
// the shared core directly (byte-identical assertions to gas's and gas_devsecops's own copies —
// there is only one implementation to measure) and then sweeps this app's OWN pages for a
// second copy of `num`/`pct`/`formatShare`, or a hand-typed dash, regressing back in.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { absentText, fmtCount, num, pct1, days1 } from "../../gas_shared/ui/figures.js";
import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);

function pageFiles() {
  return readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js"));
}

/**
 * The wider file set the DECLARATION sweep runs over — every page, plus the three files P1.1
 * actually touched outside `pages/`: `detailSheets.js` (the two hand-typed "Status"/"Result"
 * dashes and the compliance-pane meta dash), and `rankEvalModel.js`/`postureTrendModel.js`,
 * named explicitly in the package brief because they are the other two DOM-free model files
 * built on this same numeric vocabulary. None of the three may declare a second `num`/`pct`.
 */
function declarationSweepFiles() {
  return [
    ...pageFiles().map((f) => new URL(f, PAGES_DIR)),
    new URL("../src/client/js/detailSheets.js", import.meta.url),
    new URL("../src/client/js/rankEvalModel.js", import.meta.url),
    new URL("../src/client/js/postureTrendModel.js", import.meta.url),
  ];
}

describe("num() refuses null/undefined/blank BEFORE the cast", () => {
  // Number(""), Number(null), Number(undefined), Number([]) and Number(false) are all 0 and
  // all finite — the exact set that let a `Number(v) || 0`-shaped rewrite render an absent
  // figure as "0". Each gets its own `it` so a regression names which input broke, rather than
  // a single `it.each` failure requiring a second look to see which case tripped.
  it('num("") is null, not 0', () => {
    expect(num("")).toBeNull();
  });
  it("num(null) is null, not 0", () => {
    expect(num(null)).toBeNull();
  });
  it("num(undefined) is null, not 0", () => {
    expect(num(undefined)).toBeNull();
  });
  it("num([]) is null, not 0", () => {
    expect(num([])).toBeNull();
  });
  it("num(false) is null, not 0", () => {
    expect(num(false)).toBeNull();
  });

  it('num("3") casts a real numeric string', () => {
    expect(num("3")).toBe(3);
  });

  it("num(3) passes a real number through unchanged", () => {
    expect(num(3)).toBe(3);
  });

  it("num(0) is a real, measured zero — never confused with absent", () => {
    expect(num(0)).toBe(0);
  });

  it("num(NaN-producing string) falls back too, since it truly is not a number", () => {
    expect(num("not-a-number")).toBeNull();
  });

  it("an explicit fallback is honoured for the arithmetic call sites that ask for one", () => {
    expect(num(null, 0)).toBe(0);
    expect(num(undefined, 0)).toBe(0);
  });
});

describe("the formatters built on num() — null renders as the em dash, never 0", () => {
  it("fmtCount(null) is the em dash", () => {
    expect(fmtCount(null)).toBe(absentText);
  });

  it("fmtCount(0) is a real, measured zero", () => {
    expect(fmtCount(0)).toBe("0");
  });

  it("fmtCount groups a real count", () => {
    expect(fmtCount(12345)).toBe("12,345");
  });

  it("pct1(null) is the em dash", () => {
    expect(pct1(null)).toBe(absentText);
  });

  it("pct1 prints one decimal and the percent sign, including a real zero", () => {
    expect(pct1(0)).toBe("0.0%");
    expect(pct1(12.34)).toBe("12.3%");
  });

  it("days1(null) is the em dash", () => {
    expect(days1(null)).toBe(absentText);
  });

  it("days1 prints one decimal and the unit letter", () => {
    expect(days1(41)).toBe("41.0 d");
  });
});

// ------------------------------------------------------------------------- the source guard

/**
 * A page-shaped snippet reproducing the EXACT defective rewrite this file's header describes —
 * cast before refusing, so `Number(v) || 0` swallows every falsy-but-absent input into a
 * confident zero. Not a real file: a string handed to the same sweep function the real pages
 * are swept with, so the perturbation proves the sweep bites on the shape it exists to catch
 * rather than merely on the literal text "function num(".
 */
const DEFECTIVE_NUM_REWRITE = `
  // a page-shaped local reimplementation of the numeric core
  function num(v) {
    return Number(v) || 0;
  }
  export function renderThing(x) {
    return num(x.count);
  }
`;

/**
 * The declaration half of the guard: no swept file may declare its own copy of the numeric
 * core's names, comment-stripped first (`gas_shared/test/contracts/emptyStates.js`'s `code()`,
 * the same stripper `measure.mjs` and every other sweep in this tree reads through) so this
 * file's own doc comments — which quote every one of the forbidden patterns on purpose, to
 * explain what they used to look like — never trip their own guard.
 *
 * `formatShare` sits beside `num`/`pct` on purpose: it was `problems.js`'s own page-local
 * reimplementation (`Number(share) || 0`) before this package, and the fix removed the
 * wrapper entirely rather than just patching its body — `actionHeadline` now refuses the
 * share, then multiplies, then formats, inline, so there is no page-local name left for a
 * future edit to quietly reintroduce the cast-first shape under.
 *
 * @param {string} src  raw source; the function comment-strips it itself
 * @returns {string[]}  the forbidden patterns found, empty when clean
 */
function forbiddenPatterns(src) {
  const stripped = code(src);
  const hits = [];
  if (/\bfunction num\(/.test(stripped)) hits.push("function num(");
  if (/\bfunction pct\(/.test(stripped)) hits.push("function pct(");
  if (/\bfunction formatShare\(/.test(stripped)) hits.push("function formatShare(");
  return hits;
}

/**
 * Hand-typed dash literals — a quote or backtick, an optional single leading space, the em
 * dash or the en dash, then the SAME closing delimiter — matched on comment-stripped source.
 * The optional space and the two dash characters are both measured, not assumed: gas_ai's own
 * pages hand-typed the em dash bare (`combos.js`, `complianceShared.js`), the em dash with a
 * leading space as an aria-hidden separator (`problems.js`), and the EN dash as a legend glyph
 * (`help.js`) — a narrower pattern copied from `gas/test/figures.test.js` (bare em dash only)
 * would have missed two of this app's own four allowlisted sites and reported a false clean
 * sweep. A dash embedded in a longer sentence (`"— unmeasured"`, a `${lo}–${hi}` range) is
 * deliberately NOT matched: the closing delimiter must follow immediately, which is what
 * separates "the whole answer is a dash" from a dash used as ordinary punctuation or a range
 * separator inside a string this file does not police.
 */
const DASH_RE = /["'`]\s?[–—]["'`]/g;

function countDashLiterals(strippedSrc) {
  const matches = strippedSrc.match(DASH_RE);
  return matches ? matches.length : 0;
}

/**
 * Every allowlisted site is a MARK — a decoration or a glyph beside a state word — never a
 * figure. Each is named with the one-line reason a reviewer needs to tell a mark from a
 * regression, and `count` is the exact number `code()`-stripped source carries today: a file
 * dropping below its count is fine (progress), a file exceeding it fails, same as an unlisted
 * file would (default 0).
 *
 *   problems.js          `" —"` — the aria-hidden separator `parts.push(el("span", {...},
 *                         " —"))` glues two already-rendered fragments in one row's
 *                         accessible name; there is no figure on either side of it to refuse.
 *   combos.js             `"—"` — `.combo-cell-mark.is-none`, aria-hidden — the visual dash a
 *                         sighted reader sees beside a real cell value spoken separately.
 *   complianceShared.js   `"—"` — `postureCell`'s `.comp-posture-dash`, aria-hidden, sits next
 *                         to the STATE label (`state.label`) that already carries the word;
 *                         `checksCell`'s OWN dash (the figure half) was converted to
 *                         `absent()` by this package and no longer appears here.
 *   help.js                `"–"` (EN dash) — `LEX_STATES`'s "conventions, not quantities"
 *                         legend row glyph, one of four category marks (`● ◐ ○ –`) naming a
 *                         KIND of book entry, not a measured count.
 *
 * `rankEvalModel.js` is deliberately NOT in this list, and deliberately not swept for dashes
 * at all (see `DASH_SWEEP_FILES` below): its one dash-only literal, `formatFraction(r.lo) +
 * "–" + formatFraction(r.hi)`, is a NUMERIC RANGE separator ("12–34"), not an absence marker —
 * the file's own `UNMEASURED = "— unmeasured"` constant already carries the shared convention
 * for "nobody could measure this", in words, two lines above.
 */
const DASH_ALLOWLIST = new Map([
  ["problems.js", 1],
  ["combos.js", 1],
  ["complianceShared.js", 1],
  ["help.js", 1],
]);

/**
 * The dash sweep's own file set — `pages/*.js` plus `detailSheets.js`, whose two former
 * hand-typed dashes (`f.status || "—"`, `f.result || "—"`) this package converted to
 * `absentText` and which therefore carries zero today (no allowlist entry needed).
 * `rankEvalModel.js`/`postureTrendModel.js` stay in the DECLARATION sweep above (no page may
 * redeclare `num`/`pct`/`formatShare` there either) but are excluded from THIS sweep — see the
 * `DASH_ALLOWLIST` comment for why sweeping them for a bare dash literal would flag a real,
 * unrelated convention (a range separator) rather than a regression of the absence marker.
 */
function dashSweepFiles() {
  return [
    ...pageFiles().map((f) => new URL(f, PAGES_DIR)),
    new URL("../src/client/js/detailSheets.js", import.meta.url),
  ];
}

describe("no swept file redeclares the shared numeric core", () => {
  it("grep-equivalent, comment-stripped: none of pages/*.js + detailSheets.js + " +
    "rankEvalModel.js + postureTrendModel.js declares its own num()/pct()/formatShare()", () => {
    for (const url of declarationSweepFiles()) {
      const src = readFileSync(url, "utf8");
      const hits = forbiddenPatterns(src);
      expect(hits, `${url.pathname.split("/").pop()} declares: ${hits.join(", ")}`).toEqual([]);
    }
  });

  it("no swept file hand-types the em/en dash outside the documented allowlist", () => {
    for (const url of dashSweepFiles()) {
      const name = url.pathname.split("/").pop();
      const src = readFileSync(url, "utf8");
      const stripped = code(src);
      const found = countDashLiterals(stripped);
      const allowed = DASH_ALLOWLIST.get(name) ?? 0;
      expect(found, `${name} carries ${found} hand-typed dash literal(s); ${allowed} ` +
        "allowlisted (see DASH_ALLOWLIST) — either fix it or update the allowlist with a reason")
        .toBe(allowed);
    }
  });

  // PERTURBATION (a): the tempting cast-before-refuse rewrite, run through the SAME sweep
  // function the real files go through — not asserted from a comment, reproduced and shown
  // failing.
  it("the sweep catches the defective num() rewrite it exists to prevent", () => {
    const hits = forbiddenPatterns(DEFECTIVE_NUM_REWRITE);
    expect(hits).toContain("function num(");
  });

  it("the sweep's stripper does not fire on a comment merely mentioning the forbidden names", () => {
    const commentOnly = `
      // this file used to declare function num(v) { return Number(v) || 0; } — see history
      // and function formatShare(share) { return Number(share) || 0 + "%"; }
      export function render() { return "fine"; }
    `;
    expect(forbiddenPatterns(commentOnly)).toEqual([]);
  });
});

// --------------------------------------------------------------- the formatShare perturbation

/**
 * `problems.js`'s ORIGINAL `formatShare`, byte-for-byte, kept here ONLY as a perturbation
 * fixture — it is not imported from anywhere live, the same way `DEFECTIVE_NUM_REWRITE` above
 * is a string rather than a file. PERTURBATION (b): this is what a null `top10Share` used to
 * print, and it is wrong in the exact shape CLAUDE.md warns about — `Number(null) || 0` is a
 * confident `0`, not a refusal.
 */
function legacyFormatShare(share) {
  const v = Math.round((Number(share) || 0) * 1000) / 10;
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + "%";
}

/**
 * `problems.js`'s CURRENT inline replacement (`actionHeadline`), reproduced here so the claim
 * is tested against the same two-step shape the live code takes — refuse first with `num`,
 * THEN multiply and format with `pct1` — without importing `problems.js` itself, which pulls
 * in DOM construction (`el`, `dataTable`, …) this file does not boot an environment for.
 */
function currentShareText(share) {
  const n = num(share);
  return n === null ? absentText : pct1(n * 100);
}

describe("a null top10Share is absent, never a confident 0%", () => {
  it("the legacy formatShare(null) fails the claim: it prints \"0%\", not an absence", () => {
    // This is the defect, reproduced and shown failing the claim it should have held —
    // not asserted from a comment. A share nobody measured reads as a real, tiny 0%.
    expect(legacyFormatShare(null)).toBe("0%");
    expect(legacyFormatShare(null)).not.toBe(absentText);
  });

  it("the current inline path prints the em dash for the same null share", () => {
    expect(currentShareText(null)).toBe(absentText);
  });

  it("both paths agree on a real, measured share — the perturbation isolates absence, not " +
    "the whole function", () => {
    expect(legacyFormatShare(0.947)).toBe("94.7%");
    expect(currentShareText(0.947)).toBe("94.7%");
  });

  it("the current path prints a real, measured 0% for a genuine zero share — 0 is not absent", () => {
    expect(currentShareText(0)).toBe("0.0%");
  });
});
