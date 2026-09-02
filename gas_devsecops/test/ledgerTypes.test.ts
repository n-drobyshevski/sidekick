// Guards for src/domain/ledgerTypes.ts's data exports: LEDGER_COLUMNS must be set-equal to
// the actual sheet schema, and CWE_TOP_25_2024 must carry the count it was copied from brick
// with. Two independent sources for the same 39 columns is exactly the shape of defect
// PROBE_FINDINGS.md §10.2/§10.9 are about — a plausible-looking list that quietly stops
// matching what is actually written — so this checks both directions rather than one.

import { describe, expect, it } from "vitest";
import { LEDGER_COLUMNS } from "../src/domain/ledgerTypes";
import { CWE_TOP_25_2024 } from "../src/domain/config";
import { TABS, TAB_HEADERS } from "../src/server/sheetsDb";

describe("LEDGER_COLUMNS — set-equal to TAB_HEADERS[TABS.ledger]", () => {
  const sheetCols = TAB_HEADERS[TABS.ledger];

  it("every sheet column is declared in LEDGER_COLUMNS", () => {
    const missing = sheetCols.filter((c) => !LEDGER_COLUMNS.includes(c));
    expect(
      missing,
      `sheetsDb.ts's TAB_HEADERS[TABS.ledger] has columns LEDGER_COLUMNS is missing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("LEDGER_COLUMNS declares no column absent from the sheet schema", () => {
    const extra = LEDGER_COLUMNS.filter((c) => !sheetCols.includes(c));
    expect(
      extra,
      `LEDGER_COLUMNS has columns sheetsDb.ts's TAB_HEADERS[TABS.ledger] does not: ${extra.join(", ")}`,
    ).toEqual([]);
  });

  it("carries the same count as the sheet schema (no accidental duplicate hiding a missing column)", () => {
    expect(LEDGER_COLUMNS.length, "LEDGER_COLUMNS.length vs TAB_HEADERS[TABS.ledger].length").toBe(
      sheetCols.length,
    );
  });

  it("carries no duplicate column names", () => {
    const dupes = LEDGER_COLUMNS.filter((c, i) => LEDGER_COLUMNS.indexOf(c) !== i);
    expect(dupes, `duplicate columns in LEDGER_COLUMNS: ${dupes.join(", ")}`).toEqual([]);
  });
});

describe("CWE_TOP_25_2024", () => {
  it("carries exactly 25 entries — MITRE's 2024 Top 25 list, copied from brick/devsecops/config.py", () => {
    expect(CWE_TOP_25_2024.length).toBe(25);
  });

  it("carries no duplicate CWE ids", () => {
    expect(new Set(CWE_TOP_25_2024).size).toBe(CWE_TOP_25_2024.length);
  });

  it("every entry is a CWE-<digits> id", () => {
    for (const id of CWE_TOP_25_2024) expect(id).toMatch(/^CWE-\d+$/);
  });
});
