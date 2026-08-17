// Phase 2b: `enrichFromTabs` (syncStore.ts) used to reuse a persisted `aarsInput`
// unconditionally on every rescore — correct for a PRICING change (severityPoints, a cap)
// but wrong for a DERIVATION change (`rule.gapSources`), which decides WHICH GAPS EXIST.
// Flip a gapSources knob, hit Recompute, and nothing moved: the persisted gaps were built
// under the OLD flags and the new ones were never consulted. `derivationSignature` +
// `GNode.aarsInput.derivedUnder` are what let `enrichFromTabs` tell a stale derivation
// (re-derive) from a stale price (reuse) apart.
//
// Exercised through `scoreAssetsWith`, the read-only sibling of `rescoreInventory` — same
// `enrichFromTabs` call, no writes, so the fake-sheet harness only has to answer reads.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AARS_RULE, derivationSignature, type AarsRule } from "../src/domain/aars";
import type { GNode, IssueRow } from "../src/domain/graphTypes";

/** Minimal 1-based Range/Sheet over a 2-D array — copied from sheetsDb.test.ts, which is
 *  the only other place this harness is needed; both files mock the same GAS globals. */
function fakeSheet(grid: unknown[][]) {
  const at = (r: number, c: number) => {
    while (grid.length < r) grid.push([]);
    const row = grid[r - 1];
    while (row.length < c) row.push("");
    return row;
  };
  return {
    grid,
    getLastRow: () => grid.length,
    getLastColumn: () => grid.reduce((w, r) => Math.max(w, r.length), 0),
    getMaxRows: () => Math.max(grid.length, 100),
    getMaxColumns: () => Math.max(grid.reduce((w, r) => Math.max(w, r.length), 0), 30),
    setFrozenRows: () => {},
    getRange(row: number, col: number, numRows = 1, numCols = 1) {
      return {
        getValues: () =>
          Array.from({ length: numRows }, (_, i) =>
            Array.from({ length: numCols }, (_, j) => at(row + i, col + j)[col + j - 1] ?? "")),
        setValues: (vals: unknown[][]) => {
          vals.forEach((r, i) => r.forEach((v, j) => { at(row + i, col + j)[col + j - 1] = v; }));
        },
        clearContent: () => {
          for (let i = 0; i < numRows; i++) {
            for (let j = 0; j < numCols; j++) at(row + i, col + j)[col + j - 1] = "";
          }
        },
        setNumberFormat: () => {},
      };
    },
  };
}

let sheets: Record<string, ReturnType<typeof fakeSheet>>;

beforeEach(() => {
  vi.resetModules();
  sheets = {};
  (globalThis as Record<string, unknown>)["PropertiesService"] = {
    getScriptProperties: () => ({ getProperty: () => "ledger-id", setProperty: () => {} }),
  };
  (globalThis as Record<string, unknown>)["SpreadsheetApp"] = {
    openById: () => ({
      getSheetByName: (name: string) => sheets[name] ?? null,
      setSpreadsheetTimeZone: () => {},
      getSheets: () => Object.values(sheets),
      insertSheet: (name: string) => (sheets[name] = fakeSheet([[]])),
    }),
  };
});

/** Every tab `enrichFromTabs` reads, empty except for whatever a test seeds. */
async function seedLedger(assets: GNode[], issues: IssueRow[] = []) {
  const { TABS, TAB_HEADERS, overwrite } = await import("../src/server/sheetsDb");
  const { assetToRow, issueToRow } = await import("../src/server/syncStore");
  for (const tab of [TABS.assets, TABS.edges, TABS.issues, TABS.findings, TABS.syncHistory]) {
    sheets[tab] = fakeSheet([TAB_HEADERS[tab]!, []]);
  }
  overwrite(TABS.assets, assets.map(assetToRow));
  overwrite(TABS.issues, issues.map(issueToRow));
  return await import("../src/server/syncStore");
}

const issue = (over: Partial<IssueRow>): IssueRow => ({
  id: "iss-1", ruleId: "r", ruleName: "r", comboGroup: "other",
  nativeSeverity: "LOW", adjustedSeverity: "LOW",
  status: "OPEN", assetId: "n1", assetName: "n1", ...over,
});

const offSig = derivationSignature(DEFAULT_AARS_RULE);
const fiveRsRule: AarsRule = {
  ...DEFAULT_AARS_RULE,
  gapSources: { ...DEFAULT_AARS_RULE.gapSources, fiveRs: true },
};

describe("enrichFromTabs / scoreAssetsWith — derivation vs pricing", () => {
  it("FAILS WITHOUT THE FIX: a gapSources change re-derives and the score moves", async () => {
    const node: GNode = {
      id: "n1", kind: "AI_AGENT", name: "n1",
      // Persisted under the OFF signature, with the empty gap set that signature produced —
      // exactly what a prior sync (or rescore) under the spec rule would have written.
      aarsInput: { gaps: [], dataExposure: "NONE", internetExposure: "NONE", derivedUnder: offSig },
    };
    const { scoreAssetsWith } = await seedLedger(
      [node],
      [issue({ frameworks: { fiveRs: ["Restrict"] } })],
    );

    const [scored] = scoreAssetsWith(fiveRsRule);
    // Under the OLD "persisted always wins" code this stays 0: the reused input's gaps are
    // still []. Under the fix, the mismatched signature is left out of `hints`, so
    // `deriveAarsInput` runs fresh under `fiveRsRule` and picks up `5R_RESTRICT` (5 points,
    // the cascade's "5R" prefix row).
    expect(scored!.aarsPillars?.compliance).toBe(5);
  });

  it("preserves the design's benefit: a pure PRICING change still reuses the persisted input", async () => {
    const node: GNode = {
      id: "n1", kind: "AI_AGENT", name: "n1",
      // A gap NOTHING in this ledger's (empty) issues/findings could re-derive — the only
      // way it can appear in the result is if the persisted input was REUSED verbatim.
      aarsInput: {
        gaps: [{ code: "LLM06" }], dataExposure: "NONE", internetExposure: "NONE",
        derivedUnder: offSig,
      },
    };
    const { scoreAssetsWith } = await seedLedger([node]);

    const pricedRule: AarsRule = {
      ...DEFAULT_AARS_RULE,
      severityPoints: { ...DEFAULT_AARS_RULE.severityPoints, CRITICAL: 99 },
    };
    const [scored] = scoreAssetsWith(pricedRule);
    // gapPointsFor("LLM06", …) hits the "LLM" prefix row (10 points). A re-derivation would
    // have produced gaps: [] instead (no issues, no findings) and priced 0.
    expect(scored!.aarsPillars?.compliance).toBe(10);
  });

  it("a legacy row with no derivedUnder is reused — no re-score on upgrade", async () => {
    const node: GNode = {
      id: "n1", kind: "AI_AGENT", name: "n1",
      // No `derivedUnder` at all: a row written before this field existed.
      aarsInput: { gaps: [{ code: "LLM06" }], dataExposure: "NONE", internetExposure: "NONE" },
    };
    const { scoreAssetsWith } = await seedLedger([node]);

    // Even a DERIVATION-affecting change must not disturb a legacy row.
    const [scored] = scoreAssetsWith(fiveRsRule);
    expect(scored!.aarsPillars?.compliance).toBe(10);
  });
});
