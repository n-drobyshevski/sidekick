// Phase 4: persisting the problem/decision-vector verdict — the row round trip
// (issueToRow/rowToIssue, findingToRow/rowToFinding), the sync-time fold
// (graphEnrich.withProblemVerdicts), and the store-level recompute
// (syncStore.redecideProblems / decideProblemsWith).
//
// Three things this file exists to pin, each one a way the previous AARS work already
// showed a persistence layer can quietly get wrong:
//   - a field this app never decided must read back undefined, never a default;
//   - a row that stops qualifying for a verdict must lose it, not keep the stale one;
//   - a redecide must reuse a persisted vector ONLY while the rule's DERIVATION inputs
//     agree with what it was built under — the same bug `enrichFromTabs`'s
//     `derivedUnder` check closes for AARS, ported to this rule's own signature.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { withProblemVerdicts } from "../src/domain/graphEnrich";
import type { FindingRow, GNode, GraphDoc, IssueRow } from "../src/domain/graphTypes";
import { DEFAULT_PROBLEM_RULE, vectorSignature } from "../src/domain/problemRule";
import { findingFixture, issueFixture, nodeFixture } from "./problem.fixture";

// ---------------------------------------------------------------- row round trip

/** What sheetsDb.fromCell does to a written row: '' becomes null on the way back. */
function throughSheet(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    out[key] = v === "" || v === null || v === undefined ? null : v;
  }
  return out;
}

describe("issueToRow / rowToIssue — problem verdict round trip", () => {
  it("round-trips outcome, input and rule version", async () => {
    const { issueToRow, rowToIssue } = await import("../src/server/syncStore");
    const issue = issueFixture({
      problemOutcome: "ATTEND",
      problemInput: {
        vector: { exploitation: "SUSPECTED", impact: "TOTAL", exposure: "OPEN", mission: "HIGH" },
        unknowns: [],
        evidenced: true,
        exploitationSource: "ruleTable",
        derivedUnder: vectorSignature(DEFAULT_PROBLEM_RULE),
      },
      problemRuleVersion: 3,
    });
    const back = rowToIssue(throughSheet(issueToRow(issue)));
    expect(back.problemOutcome).toBe("ATTEND");
    expect(back.problemInput).toEqual(issue.problemInput);
    expect(back.problemRuleVersion).toBe(3);
  });

  it("absent reads as undefined, never a default", async () => {
    const { issueToRow, rowToIssue } = await import("../src/server/syncStore");
    const back = rowToIssue(throughSheet(issueToRow(issueFixture())));
    expect(back.problemOutcome).toBeUndefined();
    expect(back.problemInput).toBeUndefined();
    expect(back.problemRuleVersion).toBeUndefined();
  });

  it("reads a row from a tab that predates the three columns entirely", async () => {
    const { rowToIssue } = await import("../src/server/syncStore");
    // Not just empty cells — the columns do not exist, so readAll never emits the keys.
    const legacy = {
      id: "iss-legacy", rule_id: "r", rule_name: "r", combo_group: "other",
      native_severity: "LOW", adjusted_severity: "LOW", status: "OPEN",
      asset_id: "n1", asset_name: "n1",
    };
    const back = rowToIssue(legacy);
    expect(back.problemOutcome).toBeUndefined();
    expect(back.problemInput).toBeUndefined();
    expect(back.problemRuleVersion).toBeUndefined();
  });
});

describe("findingToRow / rowToFinding — problem verdict round trip", () => {
  it("round-trips outcome, input and rule version", async () => {
    const { findingToRow, rowToFinding } = await import("../src/server/syncStore");
    const finding = findingFixture({
      problemOutcome: "TRACK_STAR",
      problemInput: {
        vector: { exploitation: "UNKNOWN", impact: "PARTIAL", exposure: "UNVERIFIED", mission: "MEDIUM" },
        unknowns: ["exploitation", "exposure"],
        evidenced: false,
        exploitationSource: "none",
        derivedUnder: vectorSignature(DEFAULT_PROBLEM_RULE),
      },
      problemRuleVersion: 0,
    });
    const back = rowToFinding(throughSheet(findingToRow(finding)));
    expect(back.problemOutcome).toBe("TRACK_STAR");
    expect(back.problemInput).toEqual(finding.problemInput);
    expect(back.problemRuleVersion).toBe(0);
  });

  it("absent reads as undefined, never a default", async () => {
    const { findingToRow, rowToFinding } = await import("../src/server/syncStore");
    const back = rowToFinding(throughSheet(findingToRow(findingFixture())));
    expect(back.problemOutcome).toBeUndefined();
    expect(back.problemInput).toBeUndefined();
    expect(back.problemRuleVersion).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the sync-time fold

describe("withProblemVerdicts", () => {
  it("decides an unresolved issue and an open gap finding, joined to their node", () => {
    const node = nodeFixture({ id: "n-open" });
    const issue = issueFixture({ assetId: node.id, status: "OPEN" });
    const finding = findingFixture({ resourceId: node.id, result: "FAIL", status: "OPEN" });
    const doc: GraphDoc = { nodes: [node], edges: [], syncedAt: "" };

    const { issues, findings } = withProblemVerdicts(doc, [issue], [finding], DEFAULT_PROBLEM_RULE, 1);
    expect(issues[0]!.problemOutcome).toBeDefined();
    expect(issues[0]!.problemRuleVersion).toBe(1);
    expect(findings[0]!.problemOutcome).toBeDefined();
    expect(findings[0]!.problemRuleVersion).toBe(1);
  });

  it("a resolved issue and a PASS finding get NO verdict", () => {
    const node = nodeFixture({ id: "n-closed" });
    const resolved = issueFixture({ assetId: node.id, status: "RESOLVED" });
    const passing = findingFixture({ resourceId: node.id, result: "PASS", status: "OPEN" });
    const doc: GraphDoc = { nodes: [node], edges: [], syncedAt: "" };

    const { issues, findings } = withProblemVerdicts(doc, [resolved], [passing], DEFAULT_PROBLEM_RULE, 1);
    expect(issues[0]!.problemOutcome).toBeUndefined();
    expect(issues[0]!.problemInput).toBeUndefined();
    expect(issues[0]!.problemRuleVersion).toBeUndefined();
    expect(findings[0]!.problemOutcome).toBeUndefined();
    expect(findings[0]!.problemInput).toBeUndefined();
    expect(findings[0]!.problemRuleVersion).toBeUndefined();
  });

  it("clears a stale verdict from a row that just stopped qualifying", () => {
    const node = nodeFixture();
    const staleResolved: IssueRow = issueFixture({
      assetId: node.id,
      status: "RESOLVED",
      problemOutcome: "ACT",
      problemRuleVersion: 1,
      problemInput: {
        vector: { exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "HIGH" },
        unknowns: [],
        evidenced: true,
        exploitationSource: "validated",
      },
    });
    const doc: GraphDoc = { nodes: [node], edges: [], syncedAt: "" };
    const { issues } = withProblemVerdicts(doc, [staleResolved], [], DEFAULT_PROBLEM_RULE, 2);
    expect(issues[0]!.problemOutcome).toBeUndefined();
    expect(issues[0]!.problemInput).toBeUndefined();
    expect(issues[0]!.problemRuleVersion).toBeUndefined();
  });

  it("a missing node is decided anyway — most config rules fail on what the graph does not model", () => {
    const finding = findingFixture({ resourceId: "region-not-in-graph", result: "FAIL", status: "OPEN" });
    const doc: GraphDoc = { nodes: [], edges: [], syncedAt: "" };
    const { findings } = withProblemVerdicts(doc, [], [finding], DEFAULT_PROBLEM_RULE, 1);
    expect(findings[0]!.problemOutcome).toBeDefined();
    expect(findings[0]!.problemInput?.unknowns).toContain("exposure");
  });
});

// ---------------------------------------------------------- the store-level recompute

/** Minimal 1-based Range/Sheet over a 2-D array — copied from rescoreDerivation.test.ts,
 *  which is the only other place this harness is needed; both mock the same GAS globals. */
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
  // ZERO WIZ CALLS: a redecide must never reach the network. Any attempt is a hard
  // failure here rather than a silent success — stronger than simply leaving the global
  // undefined, which would only fail if the call happens to touch a missing method.
  (globalThis as Record<string, unknown>)["UrlFetchApp"] = {
    fetch: () => {
      throw new Error("UrlFetchApp.fetch called — redecideProblems must make zero Wiz calls");
    },
  };
});

/** Every tab redecideProblems touches, empty except for whatever a test seeds. */
async function seedLedger(
  nodes: GNode[],
  issues: IssueRow[] = [],
  findings: FindingRow[] = [],
) {
  const { TABS, TAB_HEADERS, overwrite } = await import("../src/server/sheetsDb");
  const { assetToRow, issueToRow, findingToRow } = await import("../src/server/syncStore");
  for (const tab of [
    TABS.assets, TABS.edges, TABS.issues, TABS.findings, TABS.syncHistory, TABS.settings,
  ]) {
    sheets[tab] = fakeSheet([TAB_HEADERS[tab]!, []]);
  }
  overwrite(TABS.assets, nodes.map(assetToRow));
  overwrite(TABS.issues, issues.map(issueToRow));
  overwrite(TABS.findings, findings.map(findingToRow));
  return await import("../src/server/syncStore");
}

describe("redecideProblems — zero Wiz calls", () => {
  it("re-decides every persisted issue and finding without calling UrlFetchApp", async () => {
    const node = nodeFixture({ id: "n1", hasAdminPrivileges: true, businessImpact: "HBI" });
    const issue = issueFixture({ assetId: node.id, status: "OPEN" });
    const finding = findingFixture({ resourceId: node.id, result: "FAIL", status: "OPEN" });
    const syncStore = await seedLedger([node], [issue], [finding]);

    const result = syncStore.redecideProblems();

    expect(result.version).toBe(0);
    expect(result.issueCount).toBe(1);
    expect(result.findingCount).toBe(1);
    expect(syncStore.loadIssues()[0]!.problemOutcome).toBeDefined();
    expect(syncStore.loadFindings()[0]!.problemOutcome).toBeDefined();
  });

  it("rewrites nothing and reports zero when the ledger is empty", async () => {
    const syncStore = await seedLedger([]);
    const result = syncStore.redecideProblems();
    expect(result.issueCount).toBe(0);
    expect(result.findingCount).toBe(0);
    expect(result.outcomes).toEqual({ ACT: 0, ATTEND: 0, TRACK_STAR: 0, TRACK: 0 });
  });
});

describe("redecideProblems / decideProblemsWith — reuse vs re-derive", () => {
  // A node the derivation can read almost nothing off, so a FRESH derive reads very
  // differently from the persisted (deliberately implausible) vector below — which is
  // exactly what makes "was this vector reused or rebuilt" observable.
  const bareNode = (): GNode => ({ id: "n1", kind: "AI_AGENT", name: "n1" });

  // Persisted under a vector NOTHING about this issue/node could honestly re-derive
  // (ACTIVE exploitation needs `validatedAsExploitable: true`, which this issue lacks) —
  // so its presence in the result can only mean the persisted input was reused verbatim.
  const staleIssue = (): IssueRow =>
    issueFixture({
      id: "iss-1", assetId: "n1", assetName: "n1", status: "OPEN",
      problemOutcome: "ACT",
      problemRuleVersion: 0,
      problemInput: {
        vector: { exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "HIGH" },
        unknowns: [],
        evidenced: true,
        exploitationSource: "validated",
        derivedUnder: vectorSignature(DEFAULT_PROBLEM_RULE),
      },
    });

  it("reuses the persisted input under a pure ORDERING change to outcomeRules", async () => {
    const syncStore = await seedLedger([bareNode()], [staleIssue()]);
    const reordered = {
      ...DEFAULT_PROBLEM_RULE,
      outcomeRules: [...DEFAULT_PROBLEM_RULE.outcomeRules].reverse(),
    };
    // Reordering outcomeRules cannot move vectorSignature — it reads none of those rows.
    expect(vectorSignature(reordered)).toBe(vectorSignature(DEFAULT_PROBLEM_RULE));

    const { issues } = syncStore.decideProblemsWith(reordered);
    // The reused vector, not a fresh derive's UNKNOWN/PARTIAL/UNVERIFIED/MEDIUM reading of
    // a node this bare.
    expect(issues[0]!.problemInput?.vector).toEqual({
      exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "HIGH",
    });
  });

  it("re-derives when a DERIVATION field changes — FAILS WITHOUT THE SIGNATURE CHECK", async () => {
    const syncStore = await seedLedger([bareNode()], [staleIssue()]);
    const derivationChanged = { ...DEFAULT_PROBLEM_RULE, missingMission: "LOW" as const };
    expect(vectorSignature(derivationChanged)).not.toBe(vectorSignature(DEFAULT_PROBLEM_RULE));

    const { issues } = syncStore.decideProblemsWith(derivationChanged);
    // Under the OLD "persisted always wins" behaviour this would stay "HIGH" — the stale
    // persisted vector's mission axis. With the signature check, the mismatch forces a
    // fresh derive, and a bare node with no reported business impact reads the NEW
    // `missingMission` default: LOW, not the persisted rule's HIGH.
    expect(issues[0]!.problemInput?.vector.mission).toBe("LOW");
    expect(issues[0]!.problemInput?.vector.exploitation).toBe("UNKNOWN");
  });

  it("a legacy row with no derivedUnder is reused — no redecide on upgrade", async () => {
    const legacy = issueFixture({
      id: "iss-1", assetId: "n1", assetName: "n1", status: "OPEN",
      problemOutcome: "ACT",
      problemInput: {
        vector: { exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "HIGH" },
        unknowns: [],
        evidenced: true,
        exploitationSource: "validated",
        // No `derivedUnder` at all — a row written before this field existed.
      },
    });
    const syncStore = await seedLedger([bareNode()], [legacy]);
    const derivationChanged = { ...DEFAULT_PROBLEM_RULE, missingMission: "LOW" as const };

    const { issues } = syncStore.decideProblemsWith(derivationChanged);
    expect(issues[0]!.problemInput?.vector).toEqual({
      exploitation: "ACTIVE", impact: "TOTAL", exposure: "OPEN", mission: "HIGH",
    });
  });
});
