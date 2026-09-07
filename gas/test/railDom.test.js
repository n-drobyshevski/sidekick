// The rail status dot is a real, focusable `<button>` now — not a `<span>` wearing
// `aria-hidden` and nothing else, and never a re-introduced copy of the old form.
//
// There is no jsdom in this project (vitest.config.ts sets no `environment`), so this reads
// app.js as text, the same bargain test/pagesRegisters.test.js and test/shared.test.js make
// for their own thin DOM layers. Comment-stripped first, string-aware, so a `//` inside a
// quoted string survives — mirrors `stripCommentsLikeMiddlebox` in esbuild.config.mjs.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const APP_SRC = readFileSync(new URL("../src/client/js/app.js", import.meta.url), "utf8");

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
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    out += c;
    i++;
  }
  return out;
}

const APP_CODE = code(APP_SRC);

describe("the rail status dot is a real button, not a hidden span", () => {
  it("builds an el(\"button\" carrying the rail-status-dot class", () => {
    expect(APP_CODE).toMatch(/el\(\s*"button"\s*,\s*\{[^}]*class:\s*`rail-status-dot/);
  });

  it("never rebuilds the old span-wearing-aria-hidden form", () => {
    // The literal shape app.js used to draw: `el("span", {class: `rail-status-dot ...`,
    // "aria-hidden": "true"})` — a mark with nothing behind it for a keyboard or a screen
    // reader. Any reappearance of `el("span", {class: "rail-status-dot` (or the templated
    // form) is that regression coming back.
    expect(APP_CODE).not.toMatch(/el\(\s*"span"\s*,\s*\{\s*class:\s*[`"]rail-status-dot/);
  });

  it("imports railStatus from its own module rather than re-deriving the credentials dot inline", () => {
    expect(APP_CODE).toMatch(/from\s+"\.\/railStatus\.js"/);
  });

  it("puts the statusPill caption BEFORE the dot in source order — the sentence is in the DOM before the mark that repeats it visually", () => {
    const pillIdx = APP_CODE.indexOf("statusPill(");
    const dotIdx = APP_CODE.search(/el\(\s*"button"\s*,\s*\{[^}]*class:\s*`rail-status-dot/);
    expect(pillIdx).toBeGreaterThan(-1);
    expect(dotIdx).toBeGreaterThan(-1);
    expect(pillIdx).toBeLessThan(dotIdx);
  });

  it("wires the dot's click to navigate to Scan History, the page the dot's own tip names", () => {
    expect(APP_CODE).toMatch(/rail-status-dot[\s\S]{0,400}navigate\("history"\)/);
  });
});
