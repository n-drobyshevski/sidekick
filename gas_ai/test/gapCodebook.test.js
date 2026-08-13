// The compliance-gap codebook as pure functions. Same shape as comboView.test.js — the
// page's logic is tested here, the page's pixels are checked in the dev harness.
//
// The point of these tests is the boundary the codebook must not cross: it annotates codes,
// it never prices them. Nothing here touches computeAars, and a wrong title cannot produce
// a wrong score.

import { describe, expect, it } from "vitest";
import {
  CODEBOOK,
  FAMILY_GROUP,
  allCodes,
  familyMembers,
  gapCodeOptions,
  lookupGap,
  normalizeCode,
  pricedAboveCount,
  resolveGap,
  tenantCodeOptions,
} from "../src/client/js/codebook.js";
import { DEFAULT_AARS_RULE } from "../src/domain/aars";

describe("the book itself", () => {
  it("names every code exactly once, uppercase, with no stray whitespace", () => {
    const seen = new Set();
    for (const family of CODEBOOK) {
      for (const [code, title, blurb] of family.entries) {
        expect(code).toBe(code.trim().toUpperCase());
        expect(seen.has(code), `${code} appears twice`).toBe(false);
        seen.add(code);
        expect(title.length).toBeGreaterThan(0);
        // Kept short enough to sit in a combobox row without wrapping to four lines.
        expect(blurb.length, `${code} blurb is ${blurb.length} chars`).toBeLessThanOrEqual(112);
      }
    }
  });

  it("states a vintage and a standing for every family — three of them are moving", () => {
    for (const family of CODEBOOK) {
      expect(family.vintage.length).toBeGreaterThan(0);
      expect(family.standing.length).toBeGreaterThan(0);
    }
  });

  it("carries the 2025 LLM edition, which is what the scoring model was written against", () => {
    // The 2026 edition moves Excessive Agency to LLM03 and Improper Output Handling to
    // LLM10. If this ever flips, ai/custom_score.md and DEFAULT_AARS_RULE flip with it.
    expect(lookupGap("LLM06").title).toBe("Excessive Agency");
    expect(lookupGap("LLM05").title).toBe("Improper Output Handling");
    expect(lookupGap("LLM04").title).toBe("Data and Model Poisoning");
  });

  it("prices nothing — the codebook carries no points", () => {
    for (const family of CODEBOOK) {
      for (const entry of family.entries) {
        expect(entry.length).toBe(3);
        for (const part of entry) expect(typeof part).toBe("string");
      }
    }
  });

  it("names every code the shipped default cascade mentions, or deliberately does not", () => {
    // The default cascade's exact rows must all be legible; its prefixes must all be
    // families the book knows. A carve-out nobody can read is the bug this page fixes.
    for (const row of DEFAULT_AARS_RULE.gapPoints) {
      if (row.match === "exact") {
        expect(lookupGap(row.code), `exact ${row.code} has no entry`).not.toBeNull();
      } else {
        expect(familyMembers(row.code).length, `prefix ${row.code} matches nothing`)
          .toBeGreaterThan(0);
      }
    }
  });
});

describe("normalizeCode", () => {
  it("matches the coercion the scoring model applies, so a lookup cannot disagree", () => {
    expect(normalizeCode("  llm06 ")).toBe("LLM06");
    expect(normalizeCode(null)).toBe("");
    expect(normalizeCode(undefined)).toBe("");
  });
});

describe("familyMembers", () => {
  it("returns the ten LLM entries and excludes the family prefix itself", () => {
    const members = familyMembers("LLM");
    expect(members).toHaveLength(10);
    expect(members.some((m) => m.code === "LLM")).toBe(false);
  });

  it("counts the derived ML codes, which carry no ordinal in the data", () => {
    expect(familyMembers("ML").length).toBe(10);
    expect(lookupGap("ML_DATA_POISONING").title).toContain("ML02");
  });

  it("does not fold FIVE_RS into the 5R family — the string does not start with 5R", () => {
    const members = familyMembers("5R");
    expect(members.some((m) => m.code === "FIVE_RS")).toBe(false);
    expect(members).toHaveLength(5);
  });

  it("is empty for a tenant code", () => {
    expect(familyMembers("SUB-")).toEqual([]);
    expect(familyMembers("")).toEqual([]);
  });
});

describe("pricedAboveCount", () => {
  const rows = DEFAULT_AARS_RULE.gapPoints;

  it("counts the exact carve-outs sitting above the LLM family row", () => {
    const at = rows.findIndex((r) => r.match === "prefix" && r.code === "LLM");
    // LLM04 and LLM05 are the two secondary rows the spec prices lower.
    expect(pricedAboveCount(rows, at)).toBe(2);
  });

  it("is zero for an exact row — the question only makes sense for a family", () => {
    const at = rows.findIndex((r) => r.match === "exact" && r.code === "LLM04");
    expect(pricedAboveCount(rows, at)).toBe(0);
  });

  it("is zero for a family nobody carved out of", () => {
    const at = rows.findIndex((r) => r.match === "prefix" && r.code === "ASI");
    expect(pricedAboveCount(rows, at)).toBe(0);
  });

  it("survives a missing row or an empty code", () => {
    expect(pricedAboveCount(rows, 99)).toBe(0);
    expect(pricedAboveCount([{ match: "prefix", code: "" }], 0)).toBe(0);
  });
});

describe("resolveGap", () => {
  it("names an exact hit and where it comes from", () => {
    const g = resolveGap("LLM04", "exact");
    expect(g.shape).toBe("●");
    expect(g.known).toBe(true);
    expect(g.text).toBe("exact · Data and Model Poisoning · OWASP LLM Top 10 2025 edition");
  });

  it("never prints one entry's title for a family — a prefix is a coverage claim", () => {
    const g = resolveGap("LLM", "prefix", { pricedAbove: 2 });
    expect(g.shape).toBe("◧");
    expect(g.text).toBe("family · 10 codes · 2 priced above · OWASP LLM Top 10 2025 edition");
    expect(g.text).not.toContain("Prompt Injection");
  });

  it("drops the carve-out clause when there is nothing above", () => {
    expect(resolveGap("ASI", "prefix").text).not.toContain("priced above");
  });

  it("treats a tenant code as a normal input, and says what it will cost", () => {
    const g = resolveGap("SUB-082", "exact", { fallbackPoints: 5 });
    expect(g.shape).toBe("◇");
    expect(g.known).toBe(false);
    expect(g.text).toContain("not in the codebook");
    expect(g.text).toContain("prices at the fallback, 5");
  });

  it("flags a family prefix used as an exact rule — it would match nothing", () => {
    const g = resolveGap("LLM", "exact");
    expect(g.known).toBe(false);
    expect(g.text).toContain("matches nothing as an exact rule");
  });

  it("flags a prefix that covers no known code", () => {
    const g = resolveGap("SUB-", "prefix");
    expect(g.known).toBe(false);
    expect(g.text).toContain("matches any code starting SUB-");
  });

  it("says so when there is no code yet, rather than resolving to nothing", () => {
    expect(resolveGap("", "exact").text).toBe("no code yet");
  });

  it("is case- and whitespace-insensitive, like the matcher it describes", () => {
    expect(resolveGap(" llm06 ", "exact").text).toBe(resolveGap("LLM06", "exact").text);
  });
});

describe("gapCodeOptions", () => {
  it("shapes options the way filterCombobox consumes them, grouped by family and vintage", () => {
    const opts = gapCodeOptions();
    const llm06 = opts.find((o) => o.value === "LLM06");
    expect(llm06.label).toBe("LLM06 · Excessive Agency");
    expect(llm06.group).toBe("OWASP LLM Top 10 · 2025 edition");
    // The blurb rides as the hint because the combobox searches label AND hint — that is
    // what makes "agency" find LLM06 without knowing the number.
    expect(llm06.hint).toContain("autonomy");
  });

  it("finds a code by its meaning, not just its number", () => {
    const opts = gapCodeOptions();
    const hits = opts.filter((o) =>
      o.label.toLowerCase().includes("poison") || o.hint.toLowerCase().includes("poison"));
    expect(hits.map((o) => o.value)).toContain("LLM04");
    expect(hits.map((o) => o.value)).toContain("ML_DATA_POISONING");
  });

  it("offers the family prefixes, so a novice can discover that 'starts with' is a thing", () => {
    const opts = gapCodeOptions();
    const fam = opts.filter((o) => o.group.indexOf(FAMILY_GROUP) === 0);
    expect(fam.map((o) => o.value)).toEqual(["LLM", "ASI", "ML", "5R"]);
  });

  it("adds the live asset count when the census has landed, and omits it before", () => {
    expect(gapCodeOptions().find((o) => o.value === "LLM06").hint).not.toContain("assets");
    const withCensus = gapCodeOptions({ LLM06: 24, DEPRECATED_MODEL: 1 });
    expect(withCensus.find((o) => o.value === "LLM06").hint).toContain("24 assets");
    expect(withCensus.find((o) => o.value === "DEPRECATED_MODEL").hint).toContain("1 asset");
  });

  it("omits a zero count rather than printing '0 assets' beside every unused code", () => {
    expect(gapCodeOptions({ LLM06: 0 }).find((o) => o.value === "LLM06").hint)
      .not.toContain("asset");
  });

  it("covers every code the book names", () => {
    const values = gapCodeOptions().map((o) => o.value);
    for (const code of allCodes()) expect(values).toContain(code);
  });
});

describe("tenantCodeOptions", () => {
  it("surfaces codes the inventory carries that the book does not name, commonest first", () => {
    const opts = tenantCodeOptions({ "SUB-082": 3, "SUB-114": 9, LLM06: 24 });
    expect(opts.map((o) => o.value)).toEqual(["SUB-114", "SUB-082"]);
    expect(opts[0].hint).toContain("9 assets");
    expect(opts[0].group).toContain("not in the codebook");
  });

  it("is empty with no census, so the picker looks the same before the first preview", () => {
    expect(tenantCodeOptions()).toEqual([]);
  });
});
