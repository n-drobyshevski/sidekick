// attribution.js's severity-mix idiom and its dated-vs-undated empty states — P3.3's own
// sweep, the same source-scanning idiom test/figures.test.js and test/segmented.test.js use
// (comment-stripped via gas_shared/test/contracts/emptyStates.js's `code()`), rather than a
// claim resting on a comment.
//
// THE DEFECT THIS PINS. attribution.js carried a private `mixStrip`/`mixText` pair — "Copied
// from overview.js" per its own comment — that hand-rolled the identical severity-distribution
// picture `gas_shared/ui/severity.js`'s `sevSegmentBar`/`sevEntries`/`sevSpoken` already draw.
// A second copy of the same idiom is exactly the drift the shared component exists to end, and
// nothing enforced that it stayed gone — a future page-local reimplementation would pass every
// other test in this suite silently.
//
// THE SECOND HALF: three of this page's `emptyState` calls read straight off the CURRENT
// per-finding scan ("Everything is attributed.", "No unassigned resources on this page.",
// "Every subscription … carries a support group.") and are dated `measuredEmpty` calls now —
// "we looked, on this date" is literal for all three. The page's ONE `firstRunNotice` call is
// the opposite case and stays undated on purpose (test/shared.test.js's `firstRunNoAt`
// already pins this at the file level); this file pins the same claim locally, next to the
// sweep that motivated writing it.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";

const PAGES_DIR = new URL("../src/client/js/pages/", import.meta.url);

function pageFiles() {
  return readdirSync(PAGES_DIR).filter((f) => f.endsWith(".js"));
}

/**
 * The two forbidden declarations, comment-stripped first — so this file's own doc comments,
 * which quote `mixStrip`/`mixText` by name to explain what they used to be, never trip their
 * own guard (the same reason test/figures.test.js's `forbiddenPatterns` strips first).
 */
function forbiddenMixPatterns(src) {
  const stripped = code(src);
  const hits = [];
  if (/\bfunction mixStrip\(/.test(stripped)) hits.push("function mixStrip(");
  if (/\bfunction mixText\(/.test(stripped)) hits.push("function mixText(");
  return hits;
}

/**
 * The argument text of every `name(...)` call in `src`, paren-balanced from the `(` right
 * after the name — so a call whose argument is itself a multi-line object literal (every
 * `measuredEmpty({ at, hint })` here) is not truncated at the first `)` inside it. Same
 * balancing idiom test/columnHelp.test.js's `findColumns` uses for `{ key: ... }`.
 */
function callArgs(name, src) {
  const out = [];
  const re = new RegExp("\\b" + name + "\\(", "g");
  let m;
  while ((m = re.exec(src))) {
    const start = re.lastIndex - 1; // the "(" itself
    let depth = 0;
    let j = start;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(start + 1, j));
    re.lastIndex = j + 1;
  }
  return out;
}

/**
 * Pre-existing, OUT-OF-SCOPE mixStrip/mixText copy this package does not own.
 * `pages/overview.js` carries the twin this package retired from attribution.js — that
 * copy's own comment reads "Copied from overview.js" — and this package's brief is explicit
 * that overview.js belongs to a different, concurrently-running package ("another agent is
 * replacing the overview copy"). Named here rather than silently exempted, same as
 * test/figures.test.js's `DASH_ALLOWLIST`: a bare exclusion would stop noticing a THIRD copy
 * appearing anywhere else, and the "allowlist is not decorative" check below stops this entry
 * outliving the gap it names once that sibling package lands.
 */
// Empty since the register package (P3.2) removed overview.js's copy: the sweep now holds every
// page to zero exceptions, which is what the non-decorative check above is for.
const MIX_ALLOWLIST = new Set([]);

describe("attribution.js's severity mix is the shared component, not a private copy", () => {
  it("grep-equivalent, comment-stripped: no page outside MIX_ALLOWLIST declares its own "
    + "mixStrip()/mixText()", () => {
    const problems = [];
    for (const file of pageFiles()) {
      const hits = forbiddenMixPatterns(readFileSync(new URL(file, PAGES_DIR), "utf8"));
      if (!hits.length || MIX_ALLOWLIST.has(file)) continue;
      problems.push(`${file}: ${hits.join(", ")}`);
    }
    expect(problems).toEqual([]);
  });

  it("the allowlist is not decorative — overview.js still actually carries the copy", () => {
    for (const file of MIX_ALLOWLIST) {
      const hits = forbiddenMixPatterns(readFileSync(new URL(file, PAGES_DIR), "utf8"));
      expect(hits.length,
        `${file} is on MIX_ALLOWLIST but no longer declares mixStrip/mixText — remove the entry`,
      ).toBeGreaterThan(0);
    }
  });

  it("attribution.js itself — the file this package owns — carries neither", () => {
    const hits = forbiddenMixPatterns(
      readFileSync(new URL("attribution.js", PAGES_DIR), "utf8"));
    expect(hits).toEqual([]);
  });

  // PERTURBATION, run through the same sweep function the real files go through — not
  // asserted from a comment, reproduced and shown failing. CLAUDE.md: "a guard that fires on
  // nothing is a finding, not a pass."
  it("the sweep catches a reintroduced mixStrip() declaration", () => {
    const snippet = `
      // a page-shaped reintroduction of the retired severity-mix copy
      function mixStrip(sevCounts) {
        const strip = el("div", {});
        return strip;
      }
    `;
    const hits = forbiddenMixPatterns(snippet);
    expect(hits).toContain("function mixStrip(");
  });

  it("the sweep's stripper does not fire on a comment merely mentioning mixStrip/mixText", () => {
    const commentOnly = `
      /** THIS REPLACES THE PAGE'S FORMER PRIVATE mixStrip/mixText COPY. */
      export function render() { return "fine"; }
    `;
    expect(forbiddenMixPatterns(commentOnly)).toEqual([]);
  });
});

describe("attribution.js's dated vs. undated empty states", () => {
  const attributionSrc = readFileSync(new URL("attribution.js", PAGES_DIR), "utf8");
  const stripped = code(attributionSrc);

  it("every measuredEmpty( call passes at:", () => {
    const calls = callArgs("measuredEmpty", stripped);
    expect(calls.length).toBeGreaterThan(0); // the regex must actually be finding them
    const undated = calls.filter((c) => !/\bat:/.test(c));
    expect(undated, "a measuredEmpty( call with no at: — see feedback.js: the whole point of "
      + "the dated line is saying WHEN it looked").toEqual([]);
  });

  // THE PINNED REASON: attribution's only firstRunNotice( call renders inside
  // `if (!boot.latestScan)`, where `synced` above it is the literal `false` — never a value
  // derived at render time — so there is never a scan to date. Passing `at:` there would be
  // fabricating one. test/shared.test.js's `firstRunNoAt: ["attribution", "overview"]` already
  // pins this at the file level; this is the same claim, local to the file this package
  // actually touched.
  it("the firstRunNotice( call passes no at:", () => {
    const calls = callArgs("firstRunNotice", stripped);
    expect(calls.length).toBe(1);
    expect(calls[0]).not.toMatch(/\bat:/);
  });
});
