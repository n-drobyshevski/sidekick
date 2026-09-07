// Scan History's DOM wiring, read as source text — the same bargain
// test/settingsDom.test.js and test/railDom.test.js make for their own thin DOM layers: there
// is no jsdom in this project (vitest.config.ts sets no `environment`), the pure models
// (historyModel.js) are tested directly in test/historyModel.test.js, and what is left —
// which shared builders get called, with what class, on what node — is swept as text.
// Comment-stripped, string-aware, so a literal inside a string survives the strip even when
// it happens to look like a `//` comment opener.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const HISTORY_SRC = readFileSync(
  new URL("../src/client/js/pages/history.js", import.meta.url), "utf8",
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

const CODE = code(HISTORY_SRC);

describe("the four KPI cards each go through sparkCard(", () => {
  it("calls sparkCard( exactly four times, once per card — not counting its own definition", () => {
    // Negative lookbehind excludes the `function sparkCard(...)` declaration line itself, so
    // this counts CALL SITES only.
    const calls = CODE.match(/(?<!function )sparkCard\(/g) || [];
    expect(calls).toHaveLength(4);
  });

  it("wraps sparkline() in a .kpi-spark strip with a .kpi-spark__cap caption", () => {
    expect(CODE).toMatch(/el\("div", \{ class: "kpi-spark" \}\)/);
    expect(CODE).toMatch(/el\("span", \{ class: "kpi-spark__cap" \}/);
    expect(CODE).toContain("sparkline(values,");
  });

  it("the fourth card's label carries glossaryTip(\"Remediation half-life\", \"half-life\")", () => {
    // The exact literal test/historyModel.test.js pins against `findEntry(\"half-life\").term`
    // — together the two tests hold both halves of "one statistic, one name".
    expect(CODE).toContain('glossaryTip("Remediation half-life", "half-life")');
  });

  it("the Resolved card carries denomNote(...) — its own share of everything tracked", () => {
    expect(CODE).toMatch(/kpiCard\("Resolved \(all-time\)"/);
    expect(CODE).toContain("card.append(denomNote(");
    expect(CODE).toMatch(/toFixed\(1\)/); // the "x.x% of N tracked." shape
  });

  it("never reads kpis.medianMttr — the naive median has no reader left in this file", () => {
    expect(CODE).not.toContain("medianMttr");
    expect(CODE).not.toContain("fmtSpan"); // its one remaining call site here is gone with it
  });
});

describe("the two headings that read the raw ledger carry the \"All severities\" pill", () => {
  it("severityWidePill builds a .heading-pill holding statusPill(\"neutral\", \"All severities\", …)", () => {
    expect(CODE).toMatch(/el\("span", \{ class: "heading-pill" \}/);
    expect(CODE).toContain('statusPill("neutral", "All severities", { lines })');
  });

  it("the KPI band's own heading (\"Snapshot\") goes through severityWidePill", () => {
    expect(CODE).toMatch(/severityWidePill\(sectionLabel\("Snapshot"\)/);
  });

  it("the saved-scans heading goes through severityWidePill too, inside scansHeading(", () => {
    const fn = CODE.slice(CODE.indexOf("function scansHeading("));
    expect(fn.slice(0, 800)).toContain("severityWidePill(heading");
  });
});

describe("the saved-scans heading carries a data-denominator naming the row count", () => {
  it("scansHeading( sets data-denominator on the heading node", () => {
    expect(CODE).toMatch(/heading\.setAttribute\("data-denominator", denominator\)/);
  });

  it("the denominator names the scan-row count, in words, and is null on an empty ledger", () => {
    const fn = CODE.slice(
      CODE.indexOf("function scansHeading("), CODE.indexOf("function scansHeading(") + 500,
    );
    expect(fn).toMatch(/rowCount\s*\?/); // ternary: a count, or null on zero rows
    expect(fn).toContain("scan ${pluralize(rowCount");
    expect(fn).toContain("saved.`");
    expect(fn).toContain(": null;");
  });

  it("paintScans rebuilds the heading on every paint, from the live row count", () => {
    expect(CODE).toMatch(/clear\(scansLabelHost\)\.append\(scansHeading\(scans\.length\)\)/);
  });
});

describe("the movement decomposition's two cause tables sit in a .chart-row--pair", () => {
  it("uses the shared chart-row--pair class, not a private inline grid", () => {
    expect(CODE).toContain('el("div", { class: "chart-row chart-row--pair" }');
    expect(CODE).not.toMatch(/grid-template-columns:repeat\(auto-fit,minmax\(280px/);
  });

  it("still renders both cause tables inside it, in the same order", () => {
    const idx = CODE.indexOf('el("div", { class: "chart-row chart-row--pair" }');
    const chunk = CODE.slice(idx, idx + 300);
    expect(chunk).toContain('causeTable("Measured remediation", view.measuredRows)');
    expect(chunk).toContain('causeTable("Administrative", view.administrativeRows)');
  });
});

describe("the movement section's own prose is untouched — copied verbatim from the file", () => {
  // These two literals sit immediately beside the chart-row--pair change above; pinning them
  // verbatim is what proves that edit didn't drag the surrounding wording along with it. Each
  // is checked as the SEPARATE quoted segments the source itself concatenates with `+` (a
  // check spanning the join would never match, since CODE is raw source text — quotes,
  // newlines, `+` signs and all — not the runtime-concatenated string).
  it("keeps the section heading's tip lines exactly as written", () => {
    expect(CODE).toContain(
      "Two tables, not one: an API-confirmed resolution and a finding that merely stopped ",
    );
    expect(CODE).toContain(
      "appearing in a scan are counted separately, because only one of them is a confirmed ",
    );
    expect(CODE).toContain("remediation.\",\n    ] }),");
  });

  it("keeps the section-note paragraph exactly as written", () => {
    expect(CODE).toContain(
      "The change in the open count over the last 28-day window bounded by two saved scans, ",
    );
    expect(CODE).toContain(
      "split into the causes that moved it — and which of them are remediation the register ",
    );
    expect(CODE).toContain("actually observed.");
  });
});

describe("chart tables stay 1:1 with their canvases (P1.2's rule, unmoved by this package)", () => {
  it("both trend canvases still have exactly one chartTable( beside them", () => {
    const openResolved = (CODE.match(/canvas: openResolvedCanvas/g) || []).length;
    const mttr = (CODE.match(/canvas: mttrCanvas/g) || []).length;
    expect(openResolved).toBe(1);
    expect(mttr).toBe(1);
  });
});
