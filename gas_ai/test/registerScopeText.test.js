// registerScopeText.js is the browser's copy of `describeRegisterScope`/`formatRegisterScope`
// in src/domain/registerScope.ts — this client bundle cannot import the domain layer, so the
// two surfaces that show a register-scope stamp to a person read it through a mirror. This is
// the contract that keeps the mirror a mirror: every case below runs through BOTH
// implementations and requires them to agree, the same discipline decideMirror.test.js and
// configViewMirror.test.js already apply one module over.
//
// A .js test, not .ts, and that is load-bearing: tsconfig.json has no allowJs and includes
// test/**/*.ts, so a .ts test importing a client .js module fails `tsc --noEmit` and
// `npm run check` never reaches vitest. The reverse — a .js test importing a .ts domain
// module — is fine.

import { describe, expect, it } from "vitest";
import * as mirror from "../src/client/js/registerScopeText.js";
import {
  describeRegisterScope,
  formatRegisterScope,
  registerScopeSignature,
} from "../src/domain/registerScope";

const AI = "wct-id-1998";
const VULN = "wct-id-3";
const PROJECT = ["proj-value-chain"];

/**
 * Every stamp shape either implementation can meet, including the ones no sync writes.
 *
 * The last four are what a SHEET can hold rather than what the signer emits: a cell cleared
 * by hand, a row written before the column existed, a value some other tool put there. Both
 * implementations have to answer the same thing about those too, because the cell is the
 * input and neither reader gets to assume the writer.
 */
const CASES = [
  registerScopeSignature([AI], PROJECT),
  registerScopeSignature([AI], null),
  registerScopeSignature([AI, VULN], PROJECT),
  registerScopeSignature([AI, VULN], null),
  registerScopeSignature([AI, VULN, "861eb856-54f6-4d1b-8ca1-1d6130841d20"], null),
  "",
  "#tenant",
  "wct-id-3#tenant#tenant",
  "wct-id-1998|",
];

describe("the mirror agrees with the domain", () => {
  it("formats every stamp shape identically", () => {
    for (const sig of CASES) {
      expect(mirror.formatRegisterScope(sig), sig).toBe(formatRegisterScope(sig));
    }
  });

  it("splits every stamp shape identically", () => {
    for (const sig of CASES) {
      expect(mirror.describeRegisterScope(sig), sig).toEqual(describeRegisterScope(sig));
    }
  });

  it("agrees on the values a sheet cell can hold but a signer never writes", () => {
    // Both refuse BEFORE the split rather than after: `String(null).split("|")` is ["null"],
    // which would draw a category called "null" on the issue sheet.
    for (const junk of [null, undefined, 42, true, {}, ["wct-id-1998"]]) {
      expect(mirror.formatRegisterScope(junk)).toBe(formatRegisterScope(junk));
      expect(mirror.describeRegisterScope(junk)).toEqual(describeRegisterScope(junk));
    }
  });
});

describe("what the mirror actually prints", () => {
  it("names the perimeter in words instead of gluing the suffix to a category id", () => {
    // The defect: splitting on "|" alone printed "wct-id-1998, wct-id-3#tenant" — a category
    // that does not exist, and a perimeter fact nobody would read as one.
    expect(mirror.formatRegisterScope("wct-id-1998|wct-id-3#tenant"))
      .toBe("wct-id-1998, wct-id-3 (all perimeters)");
  });

  it("says nothing about the perimeter when a project filter applied", () => {
    // An unsuffixed token records that SOME project filter applied and never which one, so
    // naming a project would over-claim — and every row written before the perimeter was a
    // setting carries exactly this token.
    expect(mirror.formatRegisterScope("wct-id-1998|wct-id-3")).toBe("wct-id-1998, wct-id-3");
  });
});
