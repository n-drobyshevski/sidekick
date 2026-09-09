// A DEFECT P2.3 FOUND IN THE BROWSER, CLOSED HERE (P3.2) — inventory.js's and config.js's
// synced-but-zero heroes.
//
// `gas_shared/ui/controls.js`'s `heroStat(label, value, sub, help)` renders its value through
// `valueOrAbsent(value)`, which substitutes its own `absent()` node for the value ONLY when
// `value === absentText` (the exact string `"—"`) — everything else, `null` included, is
// handed straight to `el()` as a child. `el()`'s child-append (like every DOM builder's) skips
// a `null`/`undefined` child rather than throwing, so the hero VALUE renders as nothing at
// all: an empty `.hero-value` box, not a dash.
//
// Both `inventory.js:412-416` (`fresh.total === 0`) and `config.js:216-222`
// (`totals.controls === 0`) — the "the tenant answered and there was nothing to report" gate,
// as distinct from "nobody has synced yet" — called `heroStat(label, null, …)`, so both hit
// this. config.js additionally had `absentText` sitting in the wrong argument slot (the SUB,
// third argument, rather than the VALUE, second) — a bare "—" reading as a sub-sentence under
// an empty hero value, rather than as the hero value itself.
//
// Not touched: problems.js, which P2.3 fixed in its own package.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { code } from "../../gas_shared/test/contracts/emptyStates.js";
import { absentText } from "../../gas_shared/ui/figures.js";

const PAGES_DIR = fileURLToPath(new URL("../src/client/js/pages/", import.meta.url));
const read = (f) => code(readFileSync(PAGES_DIR + f, "utf8"));

const configSrc = read("config.js");
const inventorySrc = read("inventory.js");

// =========================================================================================
//  1. Both gates' heroStat( call passes absentText as the VALUE (argument 2), not `null`
// =========================================================================================

describe("the synced-but-zero gate's heroStat( call passes absentText as its VALUE argument", () => {
  it("config.js: totals.controls === 0 gate — heroStat(\"Failing controls\", absentText, …)", () => {
    const gate = configSrc.slice(configSrc.indexOf("totals.controls === 0"));
    const call = /heroStat\(\s*"Failing controls"\s*,\s*([^,]+),/.exec(gate);
    expect(call, "no heroStat( call found in the totals.controls === 0 gate").not.toBeNull();
    expect(call[1].trim()).toBe("absentText");
    // The regression this guards: `heroStat("Failing controls", null, absentText)` — the
    // exact shape found in the browser, where the value argument was `null` and `absentText`
    // sat in the SUB slot instead.
    expect(call[1].trim()).not.toBe("null");
  });

  it("inventory.js: fresh.total === 0 gate — heroStat(\"AI assets\", absentText, …)", () => {
    const gate = inventorySrc.slice(inventorySrc.indexOf("fresh.total === 0"));
    const call = /heroStat\(\s*"AI assets"\s*,\s*([^,]+),/.exec(gate);
    expect(call, "no heroStat( call found in the fresh.total === 0 gate").not.toBeNull();
    expect(call[1].trim()).toBe("absentText");
    expect(call[1].trim()).not.toBe("null");
  });

  // Both files actually import the name they pass, not just spell it correctly in the call.
  it("both files import absentText from ../ui.js", () => {
    expect(configSrc).toMatch(/\babsentText\b/);
    expect(inventorySrc).toMatch(/\babsentText\b/);
    expect(configSrc).toMatch(/import\s*\{[^}]*\babsentText\b[^}]*\}\s*from\s*"\.\.\/ui\.js"/);
    expect(inventorySrc).toMatch(/import\s*\{[^}]*\babsentText\b[^}]*\}\s*from\s*"\.\.\/ui\.js"/);
  });
});

// =========================================================================================
//  2. PERTURBATION — valueOrAbsent's own behaviour, reproduced inline
// =========================================================================================
//
// `controls.js`'s real `absent()` (`el("span", { class: "muted" }, EMPTY)`, `cells.js`)
// needs a real DOM `document` this pure-project test does not have, so the stand-in below
// returns a plain object carrying the same text a real absent() node would (`EMPTY` in
// cells.js is `"—"`, the same string as `absentText`) — the substitution logic under test is
// `valueOrAbsent` itself, not `el()`'s own rendering.

function absentNodeInline() {
  return { textContent: absentText };
}

/** Copied verbatim (behaviourally) from controls.js: `value === absentText ? absent() :
 *  value` — everything that is not the exact absentText STRING passes straight through,
 *  `null` included. */
function valueOrAbsentInline(value) {
  return value === absentText ? absentNodeInline() : value;
}

/** What a DOM builder's textContent would read for a child that is either a fake node
 *  (`.textContent`), a string, or `null`/`undefined` (which `el()`'s child-append skips,
 *  the same way every DOM builder does — the exact mechanism that turns a `null` hero value
 *  into an EMPTY box rather than a thrown error). */
function renderedText(child) {
  if (child === null || child === undefined) return "";
  if (typeof child === "object" && "textContent" in child) return child.textContent;
  return String(child);
}

describe("PERTURBATION: valueOrAbsent, reproduced inline — null renders as an empty string, "
  + "absentText renders as the dash", () => {
  it("null (the defect) renders as an empty string, never a dash", () => {
    expect(renderedText(valueOrAbsentInline(null))).toBe("");
  });

  it("absentText (the fix) renders as the dash", () => {
    expect(renderedText(valueOrAbsentInline(absentText))).toBe(absentText);
    expect(renderedText(valueOrAbsentInline(absentText))).not.toBe("");
  });

  it("a measured, real value (not absentText) still passes straight through — the "
    + "substitution is keyed on the exact absentText STRING, not on falsiness", () => {
    expect(valueOrAbsentInline("38")).toBe("38");
    expect(valueOrAbsentInline(0)).toBe(0); // a real measured zero is not an absence
  });
});
