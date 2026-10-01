// gas_shared/domain/csv.ts — the one CSV cell encoder both registers' exports use (gas/ and
// this app). The case that matters is the injection one: a value a spreadsheet would run as a
// formula must arrive as text. The rest pins that the defence did not change plain quoting.

import { describe, expect, it } from "vitest";
import { csvCell } from "../../gas_shared/domain/csv";

describe("csvCell", () => {
  it("prefixes every formula-leading string with an apostrophe", () => {
    expect(csvCell("@SUM(1)")).toBe("'@SUM(1)");
    expect(csvCell("+x")).toBe("'+x");
    expect(csvCell("-x")).toBe("'-x");
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
  });

  it("prefixes and THEN quotes, so the apostrophe sits inside the quotes", () => {
    expect(csvCell('=HYPERLINK("https://evil.example","open")'))
      .toBe('"\'=HYPERLINK(""https://evil.example"",""open"")"');
    expect(csvCell("\rx")).toBe('"\'\rx"');
  });

  it("decides on the type: the number -2 is a number, the string \"-2\" is text", () => {
    expect(csvCell(-2)).toBe("-2");
    expect(csvCell(-0.5)).toBe("-0.5");
    expect(csvCell("-2")).toBe("'-2");
  });

  it("leaves ordinary values, empties and RFC 4180 quoting as they were", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell("")).toBe("");
    expect(csvCell(0)).toBe("0");
    expect(csvCell(true)).toBe("true");
    expect(csvCell("lodash")).toBe("lodash");
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell('say "hi", twice')).toBe('"say ""hi"", twice"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });
});
