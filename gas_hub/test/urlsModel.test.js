// The FIELD MESSAGE half of the URL rule: `src/client/js/pages/urlsModel.js`'s `urlProblem`,
// which is what the Settings input says under itself before anything is saved.
//
// ITS PAIR IS `test/urls.test.ts`, over `src/server/urls.ts`'s `normalizeAppUrl` — the
// boundary that actually decides what gets stored. Both files iterate the SAME table
// (`test/urlCases.ts`), which is the only thing that makes two copies of one rule defensible:
// a case added there is answered on both sides or it fails on one. What each side asserts
// differs because the two answers genuinely differ — a throw and a stored string here, a
// message and a null there — and collapsing them into one shared assertion is exactly where a
// real disagreement between the two could hide.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { urlPlaceholder, urlProblem } from "../src/client/js/pages/urlsModel.js";
import { ILLEGAL, LEGAL, NON_STRINGS } from "./urlCases";

describe("urlProblem says nothing about a legal value", () => {
  it("passes every shape the server accepts", () => {
    for (const c of LEGAL) {
      expect(urlProblem(c.input), c.what).toBeNull();
    }
  });

  it("passes blank, because blank means NOT CONFIGURED and is a normal state", () => {
    // A hub with one sibling deployed is ordinary. The field must not shout at someone who
    // has not filled it in yet — the tile says "not configured" and that is the whole story.
    expect(urlProblem("")).toBeNull();
    expect(urlProblem("   ")).toBeNull();
  });
});

describe("urlProblem explains an illegal one", () => {
  it("refuses every shape the server refuses, with the same one message", () => {
    for (const c of ILLEGAL) {
      const message = urlProblem(c.input);
      expect(message, `${c.what} — ${c.why}`).toBeTruthy();
      expect(message).toContain("A sidekick URL must start with");
    }
  });

  it("refuses a non-string before any cast, exactly as the boundary does", () => {
    // `String([])` is "" — cast first and a stray `[]` reads as a legal blank field, which
    // would leave the input looking fine and the save refused by the server with nothing on
    // the field to say why.
    for (const c of NON_STRINGS) {
      expect(urlProblem(c.input), c.what).toBeTruthy();
    }
  });

  it("names both legal forms, since the message is the whole explanation", () => {
    const message = urlProblem("https://evil.example/exec");
    expect(message).toContain("script.google.com/");
    expect(message).toContain("localhost:");
  });

  it("spells no URL literal into the client bundle — the prefixes are BUILT", () => {
    // esbuild.config.mjs's middlebox guard replays a proxy's comment-stripping on the
    // MINIFIED client bundle and fails the build on any surviving `//` — a double slash
    // inside an ordinary quoted string trips it exactly as one in a stray comment would. So
    // both prefixes are assembled with `.join("/")` and the two characters only ever exist at
    // runtime. This says the source still does that, rather than waiting for the failure to
    // surface as a build error in a file that did not change.
    const SRC = readFileSync(
      new URL("../src/client/js/pages/urlsModel.js", import.meta.url), "utf8",
    );
    const code = SRC.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code, "a URL literal has been written back into urlsModel.js")
      .not.toMatch(/["'][a-z]+:\/\//);
    expect(code, "the prefixes are no longer built from parts").toContain('.join("/")');
  });
});

describe("urlPlaceholder", () => {
  it("shows the deployed form, which is the one an operator pastes", () => {
    // Not the loopback form: that is a developer on their own machine, who does not need the
    // field to prompt them. Built the same way, so it carries no literal `//` either.
    expect(urlPlaceholder()).toContain("script.google.com/");
    expect(urlPlaceholder()).toContain("/exec");
  });
});
