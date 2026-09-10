// The findings toolbar: what its controls write, and what it does when the register cannot
// answer the question one of them asks.
//
// TWO CLAIMS, AND BOTH ARE ABOUT LINKS RATHER THAN ABOUT PIXELS.
//
//   1. EVERY CONTROL WRITES THE URL, through `navigate` and never `setParams`.
//      `history.replaceState` fires no `hashchange`, so a filter set that way rewrites the
//      URL and leaves the page showing the previous fetch. And a filtered register has to BE
//      a link somebody can send — which is the whole mechanism the Executive page's fix-next
//      list lands through.
//   2. THE EXPOSURE TOGGLE IS DISABLED WITH A REASON when the last scan carried no exposure
//      field. Applying it would answer "0 internet-facing findings" — a measurement — where
//      the truth is that nothing looked (`getRegisterRows` refuses it server-side and says
//      `exposureFilterSupported: false`). Hidden would be worse: a control that vanishes
//      teaches nothing about why.
//
// The page half is read as SOURCE, comment-stripped, for the reason every DOM claim in this
// project is: `vitest.config.ts` sets no `environment`, so there is no `document`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { RISK_TIER_ORDER } from "../src/domain/program";
import { readRegisterParams, registerParamPatch } from "../src/client/js/pages/registerModel.js";

/** The comment stripper the other source-sweeping tests here use. */
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

const SRC = readFileSync(
  new URL("../src/client/js/pages/overview.js", import.meta.url), "utf8",
);
const CODE = code(SRC);

/** The `registerToolbar` function body, from its declaration to the `}` at its own indent. */
function toolbarBody() {
  const start = CODE.indexOf("function registerToolbar(");
  expect(start).toBeGreaterThan(-1);
  const end = CODE.indexOf("\n  }", start);
  expect(end).toBeGreaterThan(start);
  return CODE.slice(start, end);
}

// =========================================================================================
//  1. The params round-trip
// =========================================================================================

describe("the toolbar's four controls write params the page reads back unchanged", () => {
  // Each row is what one control writes, and what `readRegisterParams` must make of it.
  const CASES = [
    ["the state segment", { status: "resolved" }, { status: "resolved" }],
    ["the state segment, back to All", { status: "all" }, { status: "all" }],
    ["the fix segment", { fix: "awaiting" }, { fix: "awaiting" }],
    ["the tier pills", { tier: "kev,unknown" }, { tier: ["kev", "unknown"] }],
    ["the reachability toggle", { exposed: "1" }, { exposed: true }],
    ["a sorted heading", { sort: "cve", dir: "asc" }, { sort: "cve", dir: "asc" }],
  ];

  for (const [what, params, expected] of CASES) {
    it(`${what} round-trips`, () => {
      const filters = readRegisterParams(params);
      for (const [k, v] of Object.entries(expected)) expect(filters[k]).toEqual(v);
      // And back out through the patch and in again, which is what a second control press
      // does: `goFilters` spreads the current filters and overrides one key.
      expect(readRegisterParams(registerParamPatch(filters))).toEqual(filters);
    });
  }

  it("every tier the classifier can answer has a pill to reach it, unclassified included", () => {
    // A tier filter that omitted `unknown` would make the rows nobody looked at unreachable
    // from this table — the measurement gap hidden by the control meant to expose it.
    const body = toolbarBody();
    expect(body).toMatch(/options:\s*TIER_ORDER\.map/);
    expect(RISK_TIER_ORDER).toContain("unknown");
    expect(readRegisterParams({ tier: RISK_TIER_ORDER.join(",") }).tier)
      .toEqual([...RISK_TIER_ORDER]);
  });

  it("a filter change resets the page index — page 4 of the old set is not page 4 of the new", () => {
    expect(CODE).toMatch(/registerParamPatch\(\{ \.\.\.filters, page: 0 \}\)/);
  });
});

// =========================================================================================
//  2. navigate, never setParams
// =========================================================================================

describe("the toolbar rewrites the hash so a filtered register is a link", () => {
  it("calls navigate( and never setParams( anywhere in its own body", () => {
    const body = toolbarBody();
    // The controls delegate to `goFilters`, which is the one place the hash is written.
    expect(body).toMatch(/goFilters\(/);
    expect(body).not.toMatch(/setParams\(/);
  });

  it("goFilters navigates, and keeps the params this page owns for other reasons", () => {
    const start = CODE.indexOf("function goFilters(");
    expect(start).toBeGreaterThan(-1);
    const body = CODE.slice(start, CODE.indexOf("\n  }", start));
    expect(body).toMatch(/navigate\("overview",/);
    expect(body).not.toMatch(/setParams\(/);
    // `by` is the breakdown drawer's grouping path. A control that dropped it would reset the
    // drawer every time somebody changed a tier.
    expect(body).toMatch(/by: groupKeys\.join\(","\)/);
  });

  it("setParams survives ONLY where it belongs — the breakdown grouping path", () => {
    // ANTI-VACUOUS. `setParams` is still the right call for a per-keystroke control that must
    // not add a history entry, and `persistParams` is that control. Asserting it is still
    // there is what keeps the check above from passing because the import went away.
    expect(CODE).toMatch(/function persistParams\(\) \{\s*setParams\(\{ by:/);
  });
});

// =========================================================================================
//  3. Disabled with a reason, not hidden and not silently satisfied
// =========================================================================================

describe("the Outside: the exposure toggle refuses rather than answering 0", () => {
  const body = toolbarBody();

  it("is disabled when the last scan carried no exposure field", () => {
    expect(body).toMatch(/const supported = !!\(insights && insights\.funnel && insights\.funnel\.exposureKnown\)/);
    expect(body).toMatch(/disabled: supported \? null : ""/);
  });

  it("carries its reason through tipAnchor, because a disabled control takes no events", () => {
    // A disabled button does not reliably receive the pointer/focus events a bare tooltip
    // needs, which is why the reason hangs off a wrapper — the same `.tip-disabled-wrap`
    // mechanism gas_devsecops uses for its scan button.
    expect(body).toMatch(/tip-disabled-wrap/);
    expect(body).toMatch(/tipAnchor\(exposedBtn/);
    expect(body).toMatch(/The last scan carried no exposure field/);
  });

  it("still RENDERS the control rather than hiding it", () => {
    // Hidden teaches nothing. The reader has to be able to see that the question exists and
    // read why it cannot be answered.
    expect(body).toMatch(/supported\s*\n?\s*\? exposedBtn/);
    expect(body).toMatch(/"Internet-reachable only"/);
  });

  it("the reason says the zero would be a measurement, not a fact about the estate", () => {
    expect(body).toMatch(/would answer 0 — a measurement — where/);
  });
});
