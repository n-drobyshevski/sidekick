// Settings' inline validation wiring, read as source text. There is no jsdom in this
// project (vitest.config.ts sets no `environment`), so this is the same bargain
// test/railDom.test.js and test/pagesRegisters.test.js make for their own thin DOM layers:
// the pure model (settingsModel.js's tabStatus/fieldErrors) is tested directly, and the DOM
// wiring that reads it is swept as text. Comment-stripped, string-aware.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SETTINGS_SRC = readFileSync(
  new URL("../src/client/js/pages/settings.js", import.meta.url), "utf8",
);

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

const SETTINGS_CODE = code(SETTINGS_SRC);

describe("settings.js drives the tablist's invalid glyph, not only its dirty dot", () => {
  it("calls tabs.setInvalid(", () => {
    expect(SETTINGS_CODE).toMatch(/tabs\.setInvalid\(/);
  });

  it("calls tabs.setInvalid( for every SETTINGS_TABS entry, the same loop setDirty already used", () => {
    // The old form only ever called setDirty in this loop; setInvalid arriving in the SAME
    // loop (rather than a second one that could fall out of step) is the actual fix.
    expect(SETTINGS_CODE).toMatch(/tabs\.setDirty\([^)]*\)[\s\S]{0,80}tabs\.setInvalid\(/);
  });
});

describe("every aria-invalid target has a matching aria-describedby in source", () => {
  // Every place this file flips aria-invalid dynamically, keyed by the RECEIVER expression
  // (a variable, or a chain like `fetchPills.node`) it is called on.
  const invalidReceivers = [...SETTINGS_CODE.matchAll(/([\w.]+)\.setAttribute\(\s*"aria-invalid"/g)]
    .map((m) => m[1]);

  it("finds at least the four validated fields (fetchSeverities, displaySeverities, EPSS threshold, retention days)", () => {
    // A regression that deletes the wiring for one field would shrink this list; a renamed
    // receiver would still show up here, just under a different name — which is why the
    // per-receiver check below, not a hardcoded count, is the one that actually holds.
    expect(invalidReceivers.length).toBeGreaterThanOrEqual(4);
  });

  it.each(Array.from(new Set(invalidReceivers)))(
    "%s also carries aria-describedby somewhere in source",
    (receiver) => {
      const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Two legal shapes: the receiver sets aria-describedby itself via setAttribute (the
      // pill-row groups, whose id is not literal in the object they were built from), or the
      // receiver's own el(...) construction carries "aria-describedby" inline (the two plain
      // <input> fields). Either one is a real association; neither alone is assumed.
      const setAttributeForm = new RegExp(`${escaped}\\.setAttribute\\(\\s*"aria-describedby"`);
      const inlineForm = new RegExp(
        `(?:const|let)\\s+${escaped}\\s*=\\s*el\\([\\s\\S]{0,400}?"aria-describedby"`,
      );
      const found = setAttributeForm.test(SETTINGS_CODE) || inlineForm.test(SETTINGS_CODE);
      expect(found, `${receiver} sets aria-invalid but never aria-describedby`).toBe(true);
    },
  );
});

describe("every aria-describedby id resolves to a real element carrying that id", () => {
  // Pulls every `"aria-describedby": someId` / `.setAttribute("aria-describedby", someId)`
  // right-hand side (an identifier, since every one of these is built from a shared *ErrorId
  // variable rather than a repeated string literal — the id is spelled once), then confirms
  // that SAME identifier is used as an element's own `id:` somewhere. A describedby pointing
  // at nothing is a broken reference screen readers cannot resolve either.
  const describedByIds = [
    ...SETTINGS_CODE.matchAll(/"aria-describedby":\s*(\w+)/g),
    ...SETTINGS_CODE.matchAll(/\.setAttribute\(\s*"aria-describedby"\s*,\s*(\w+)/g),
  ].map((m) => m[1]);

  it("finds at least one describedby id", () => {
    expect(describedByIds.length).toBeGreaterThan(0);
  });

  it.each(Array.from(new Set(describedByIds)))("%s is declared as a real element id", (idVar) => {
    const declared = new RegExp(`id:\\s*${idVar}\\b`);
    expect(declared.test(SETTINGS_CODE), `${idVar} names no element's own id`).toBe(true);
  });
});

describe("every inline field-error span is role=\"alert\" and starts hidden", () => {
  it("declares each *ErrorId span with role alert and hidden:true, never a bare notice", () => {
    const errorIdDecls = [...SETTINGS_CODE.matchAll(/id:\s*(\w*ErrorId)\b/g)].map((m) => m[1]);
    expect(errorIdDecls.length).toBeGreaterThanOrEqual(4);
    for (const idVar of new Set(errorIdDecls)) {
      const escaped = idVar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const spanDecl = new RegExp(`\\{\\s*id:\\s*${escaped}[\\s\\S]{0,160}?\\}`);
      const match = SETTINGS_CODE.match(spanDecl);
      expect(match, `${idVar}'s span declaration`).not.toBeNull();
      expect(match[0]).toMatch(/role:\s*"alert"/);
      expect(match[0]).toMatch(/hidden:\s*true/);
    }
  });
});
