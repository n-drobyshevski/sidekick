// The two columns the widening adds, through the sheet and back.
//
// WHY WHOLE-ROW EQUALITY AND NOT A FIELD LIST. `writeGrid` projects a row onto the DECLARED
// headers and DISCARDS whatever the row carries beyond them, so an undeclared column is
// written on every sync and read back as a default, forever, with nothing failing. A test
// that checks the fields it happens to think of passes against exactly that shape. Comparing
// the WHOLE row — every key the writer emits, against the headers and against itself after a
// round trip — is what catches the column nobody remembered to declare.

import { describe, expect, it } from "vitest";
import { issueToRow, rowToIssue } from "../src/server/syncStore";
import { TAB_HEADERS, TABS } from "../src/server/sheetsDb";
import { registerScopeSignature } from "../src/domain/registerScope";
import { RISK_CATEGORY_ID } from "../src/domain/toxicCombos";
import type { IssueRow } from "../src/domain/graphTypes";
import { bootServer, teardownServer } from "./gasEnv";

/** What sheetsDb.fromCell does to a written row: '' becomes null on the way back. */
function throughSheet(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    out[key] = v === "" || v === null || v === undefined ? null : v;
  }
  return out;
}

function issue(over: Partial<IssueRow> = {}): IssueRow {
  return {
    id: "iss-1",
    ruleId: "wc-id-2742",
    ruleName: "Managed AI agent invoking a model without guardrails",
    comboGroup: "bedrock-no-guardrail",
    nativeSeverity: "HIGH",
    adjustedSeverity: "CRITICAL",
    status: "OPEN",
    assetId: "agent-a",
    assetName: "Agent-A",
    categories: [RISK_CATEGORY_ID],
    ...over,
  } as IssueRow;
}

describe("ai_issues.categories — the scope stamp survives the sheet", () => {
  it("declares every column the writer emits", () => {
    // The `writeGrid` trap, asserted directly: a key the row carries and the headers do not
    // is silently dropped on write, and read back as a default on the next sync.
    const headers = TAB_HEADERS[TABS.issues];
    for (const key of Object.keys(issueToRow(issue()))) {
      expect([key, headers.indexOf(key) >= 0]).toEqual([key, true]);
    }
    expect(headers).toContain("categories");
  });

  it("round-trips the WHOLE row, not just the new column", () => {
    const row = issueToRow(issue({ categories: ["wct-id-1998", "wct-id-3"] }));
    expect(row["categories"]).toBe("wct-id-1998,wct-id-3");
    const back = issueToRow(rowToIssue(throughSheet(row)));
    expect(back).toEqual(row);
    expect(rowToIssue(throughSheet(row)).categories).toEqual(["wct-id-1998", "wct-id-3"]);
  });

  it("reads a row from a tab that predates the column as the AI category", () => {
    // Not an empty cell — the column does not exist, so readAll never emits the key. This is
    // the one place a missing column reads as a VALUE rather than as unknown, because there
    // is exactly one value it can have: those syncs ran no other scope.
    const legacy = {
      id: "iss-legacy", rule_id: "r", rule_name: "r", combo_group: "other",
      native_severity: "LOW", adjusted_severity: "LOW", status: "OPEN",
      asset_id: "n1", asset_name: "n1",
    };
    expect(rowToIssue(legacy).categories).toEqual([RISK_CATEGORY_ID]);
  });
});

/**
 * The issue's OWN project attribution, through the sheet and back.
 *
 * Same whole-row discipline as the block above, for the same `writeGrid` reason — and one
 * decision of its own that a field-list test would never reach: an empty cell reads back as
 * UNDEFINED, not as an empty array. The project view (api.ts `viewIssues`) treats an empty
 * array as "Wiz attributed this issue to nothing" and undefined as "nobody has looked", so
 * collapsing the two would decide a row's project membership on a measurement never taken.
 */
describe("ai_issues.project_refs_json — the refs survive the sheet", () => {
  const REFS = [
    { id: "proj-demo-business-unit", name: "DEMO-BUSINESS-UNIT", isFolder: true },
    { id: "proj-project-alpha", name: "PROJECT-ALPHA", isFolder: false, businessImpact: "LBI" },
  ];

  it("declares the column and round-trips the WHOLE row", () => {
    expect(TAB_HEADERS[TABS.issues]).toContain("project_refs_json");
    const row = issueToRow(issue({ projects: ["DEMO-BUSINESS-UNIT", "PROJECT-ALPHA"], projectRefs: REFS }));
    const back = issueToRow(rowToIssue(throughSheet(row)));
    expect(back).toEqual(row);
    // The whole ref, not just the id: `isFolder` is tri-state and `businessImpact` is what
    // the worst-of roll-ups read, so a reader that kept only id and name would lose both
    // silently. Every key the writer put in comes back.
    expect(rowToIssue(throughSheet(row)).projectRefs).toEqual(REFS);
    // And the NAME list beside it is untouched — two fields for one fact, and the facets
    // and the asset table still read the names.
    expect(rowToIssue(throughSheet(row)).projects).toEqual(["DEMO-BUSINESS-UNIT", "PROJECT-ALPHA"]);
  });

  it("reads an absent cell as unknown, and an empty one as measured-and-none", () => {
    // The column does not exist on a tab that predates it, so readAll never emits the key.
    const legacy = {
      id: "iss-legacy", rule_id: "r", rule_name: "r", combo_group: "other",
      native_severity: "LOW", adjusted_severity: "LOW", status: "OPEN",
      asset_id: "n1", asset_name: "n1",
    };
    expect(rowToIssue(legacy).projectRefs).toBeUndefined();
    // A live sync that found no project writes `[]`, and `[]` must survive as `[]` — it is
    // the register saying it looked. `inProject` answers false for both, but only one of
    // them is a fact.
    const measured = issueToRow(issue({ projectRefs: [] }));
    expect(measured["project_refs_json"]).toBe("[]");
    expect(rowToIssue(throughSheet(measured)).projectRefs).toEqual([]);
  });
});

describe("sync_history.register_scope — a scan records the gate it APPLIED", () => {
  it("is declared, and a committed sync stamps it", async () => {
    expect(TAB_HEADERS[TABS.syncHistory]).toContain("register_scope");

    const server = await bootServer();
    server.setup();
    const res = server.api.runSync({}) as { ok: boolean; error?: string };
    expect([res.ok, res.error]).toEqual([true, undefined]);

    // Read back off the tab rather than off the object that was written, so this fails if
    // the header is ever removed and writeGrid starts discarding the value. Imported after
    // the boot: `bootServer` resets the module registry, so the store the server writes
    // through is only reachable from a fresh import.
    const store = await import("../src/server/syncStore");
    const history = store.syncHistory();
    const latest = history[history.length - 1];
    expect(latest["register_scope"]).toBe(registerScopeSignature([RISK_CATEGORY_ID]));

    // And every issue row the sync wrote carries the stamp too — the ledger and its commit
    // record have to agree about which population was collected.
    for (const row of store.loadIssues()) {
      expect([row.id, row.categories]).toEqual([row.id, [RISK_CATEGORY_ID]]);
    }
    teardownServer();
  });

  it("stamps the widened scope after the setting moves, and bootstrap says so meanwhile", async () => {
    const server = await bootServer();
    server.setup();
    expect((server.api.runSync({}) as { ok: boolean }).ok).toBe(true);

    // The gate the LAST scan applied is still the narrow one, so widening the setting must
    // not retroactively relabel it: the stored figures count one category and the settings
    // now ask for two, which is a real disagreement and the operator is told rather than
    // left to discover it.
    server.api.setSettings({ issueCategories: [RISK_CATEGORY_ID, "wct-id-3"] });
    const boot = server.api.bootstrap({}) as {
      data: { registerScope: { kind: string; persisted: string; current: string } | null };
    };
    expect(boot.data.registerScope).toEqual({
      kind: "registerScope",
      persisted: RISK_CATEGORY_ID,
      current: `${RISK_CATEGORY_ID}|wct-id-3`,
      remedy: "sync",
    });

    // Reordering the same set is not a change — the order picks which step runs first.
    server.api.setSettings({ issueCategories: ["wct-id-3", RISK_CATEGORY_ID] });
    const reordered = server.api.bootstrap({}) as {
      data: { registerScope: unknown };
    };
    expect(reordered.data.registerScope).toEqual(boot.data.registerScope);

    // Back to what the ledger holds: the notice goes away without a sync, because there is
    // nothing left to disagree about.
    server.api.setSettings({ issueCategories: [RISK_CATEGORY_ID] });
    const settled = server.api.bootstrap({}) as { data: { registerScope: unknown } };
    expect(settled.data.registerScope).toBeNull();
    teardownServer();
  });
});

describe("ai_issues adjacency — the three columns survive the sheet", () => {
  // Same whole-row discipline as the block at the top of this file, and for the same
  // `writeGrid` reason: the projection onto DECLARED headers is silent, so a field list a
  // test happened to think of passes against exactly the shape that is being dropped. The
  // "declares every column the writer emits" case above already walks every key `issueToRow`
  // emits, so these three are covered by it the moment the writer learns them; what is left
  // to pin here is the one thing a key walk cannot see — that an ABSENT cell reads back as
  // undefined rather than as UNLINKED.

  it("round-trips an ADJACENT row whole", () => {
    const row = issueToRow(issue({
      aiAdjacency: "ADJACENT",
      adjacencyVia: "RUNS_AS",
      adjacentAssetIds: ["agent-a", "agent-b"],
    }));
    expect(row["ai_adjacency"]).toBe("ADJACENT");
    expect(row["adjacent_asset_ids"]).toBe("agent-a,agent-b");
    const back = issueToRow(rowToIssue(throughSheet(row)));
    expect(back).toEqual(row);
    const parsed = rowToIssue(throughSheet(row));
    expect(parsed.adjacentAssetIds).toEqual(["agent-a", "agent-b"]);
    expect(parsed.adjacencyVia).toBe("RUNS_AS");
  });

  it("round-trips DIRECT and UNLINKED, whose id list is empty by construction", () => {
    for (const state of ["DIRECT", "UNLINKED"] as const) {
      const row = issueToRow(issue({ aiAdjacency: state, adjacentAssetIds: [] }));
      const back = issueToRow(rowToIssue(throughSheet(row)));
      expect([state, back]).toEqual([state, row]);
      // The STATE is what says the pass ran; the empty list is "we looked and found none".
      expect(rowToIssue(throughSheet(row)).aiAdjacency).toBe(state);
      expect(rowToIssue(throughSheet(row)).adjacentAssetIds).toEqual([]);
      expect(rowToIssue(throughSheet(row)).adjacencyVia).toBeUndefined();
    }
  });

  it("reads an absent cell as UNDEFINED, never as UNLINKED", () => {
    // A row written before the column existed had no adjacency pass run over it. Reading that
    // as UNLINKED would turn "nobody looked" into a measurement, and the ranker prices the two
    // differently — absent is a null component, UNLINKED is mid-scale (rank.adjacencyOf).
    const legacy = {
      id: "iss-legacy", rule_id: "r", rule_name: "r", combo_group: "other",
      native_severity: "LOW", adjusted_severity: "LOW", status: "OPEN",
      asset_id: "n1", asset_name: "n1",
    };
    const parsed = rowToIssue(legacy);
    expect(parsed.aiAdjacency).toBeUndefined();
    expect(parsed.adjacentAssetIds).toBeUndefined();
    expect(parsed.adjacencyVia).toBeUndefined();
    // And an empty cell — the column exists, the row was written before the fold ran — reads
    // the same way, because the state is the only thing that can say the pass happened.
    expect(rowToIssue({ ...legacy, ai_adjacency: null }).aiAdjacency).toBeUndefined();
  });
});

describe("sync_history.adjacency_json — the census and its denominator", () => {
  it("is declared, and a committed sync stamps a census with edgesKnown in it", async () => {
    expect(TAB_HEADERS[TABS.syncHistory]).toContain("adjacency_json");

    const server = await bootServer();
    server.setup();
    expect((server.api.runSync({}) as { ok: boolean }).ok).toBe(true);

    const store = await import("../src/server/syncStore");
    const history = store.syncHistory();
    const latest = history[history.length - 1];
    const census = JSON.parse(String(latest["adjacency_json"])) as Record<string, number>;
    // The denominator travels WITH the counts. 68 asset edges on the reference tenant is why:
    // an UNLINKED count without the edge count beside it reads as "unrelated" when it means
    // "not traversed" (AARS_LIVE_MEASUREMENTS.md §4 row A).
    expect(Object.keys(census).sort()).toEqual(
      ["ADJACENT", "DIRECT", "UNLINKED", "edgesKnown"],
    );
    expect(census["DIRECT"]! + census["ADJACENT"]! + census["UNLINKED"]!)
      .toBe(Number(latest["issue_count"]));

    // And the ledger agrees with its own commit record: every persisted issue carries a state,
    // and the states count out to the census the history row published.
    const persisted = store.loadIssues();
    const counted = { DIRECT: 0, ADJACENT: 0, UNLINKED: 0 } as Record<string, number>;
    for (const row of persisted) counted[String(row.aiAdjacency)] = (counted[String(row.aiAdjacency)] ?? 0) + 1;
    expect(counted).toEqual({
      DIRECT: census["DIRECT"], ADJACENT: census["ADJACENT"], UNLINKED: census["UNLINKED"],
    });
    teardownServer();
  });
});

/**
 * The exploitation fold, through the sheet and back — in BOTH homes it has.
 *
 * `ai_issue_exploitation` is the evidence (which findings, how many, when observed) and the
 * three `ai_issues` columns are the reading the ranker consumes without a join. Two homes for
 * one fact, the same split `projects_json` / `project_refs_json` already carries, and both are
 * held to the same whole-row discipline for the `writeGrid` reason at the top of this file.
 *
 * What a field-list test could never reach, and what the cases below are actually about: an
 * ABSENT cell reads back as undefined and never as the `none` tier. `rank.exploitationOf`
 * drops an absent tier out of the blend and scores `none` as a measurement, so collapsing the
 * two would score every register that never ran VULN_FINDINGS as one where nothing is
 * exploited.
 */
describe("ai_issues exploitation — the reading survives the sheet", () => {
  it("declares all three columns and round-trips the WHOLE row", () => {
    for (const col of ["exploitation_tier", "epss_peak", "exploitation_findings"]) {
      expect(TAB_HEADERS[TABS.issues]).toContain(col);
    }
    const row = issueToRow(issue({
      exploitationTier: "kev",
      epssPeak: 0.62,
      exploitationFindingCount: 3,
    }));
    expect([row["exploitation_tier"], row["epss_peak"], row["exploitation_findings"]])
      .toEqual(["kev", 0.62, 3]);
    const back = issueToRow(rowToIssue(throughSheet(row)));
    expect(back).toEqual(row);
    const parsed = rowToIssue(throughSheet(row));
    expect([parsed.exploitationTier, parsed.epssPeak, parsed.exploitationFindingCount])
      .toEqual(["kev", 0.62, 3]);
  });

  it("reads an absent cell as undefined, not as the `none` tier", () => {
    const legacy = {
      id: "iss-legacy", rule_id: "r", rule_name: "r", combo_group: "other",
      native_severity: "LOW", adjusted_severity: "LOW", status: "OPEN",
      asset_id: "n1", asset_name: "n1",
    };
    expect(rowToIssue(legacy).exploitationTier).toBeUndefined();
    expect(rowToIssue(legacy).epssPeak).toBeUndefined();
    expect(rowToIssue(legacy).exploitationFindingCount).toBeUndefined();
    // The column existing and being blank is the same claim: no fold ran over this row.
    expect(rowToIssue({ ...legacy, exploitation_tier: null }).exploitationTier).toBeUndefined();
  });

  it("keeps a measured `none` and a measured EPSS of zero", () => {
    // `none` is the fold saying it looked and nothing fired; `0` is a computed EPSS. Both are
    // measurements, and both are what a falsy-eliding writer or reader would erase.
    const row = issueToRow(issue({
      exploitationTier: "none", epssPeak: 0, exploitationFindingCount: 0,
    }));
    expect([row["exploitation_tier"], row["epss_peak"], row["exploitation_findings"]])
      .toEqual(["none", 0, 0]);
    const parsed = rowToIssue(throughSheet({ ...row, epss_peak: 0, exploitation_findings: 0 }));
    expect([parsed.exploitationTier, parsed.epssPeak, parsed.exploitationFindingCount])
      .toEqual(["none", 0, 0]);
  });

  it("carries a tier with no EPSS as an explicit null rather than dropping the field", () => {
    // A KEV finding need not have an EPSS score. `epssPeak: null` is "the tier was decided and
    // no probability was captured", which `rank.exploitationOf` prints as "EPSS not captured".
    const row = issueToRow(issue({ exploitationTier: "kev", epssPeak: null, exploitationFindingCount: 1 }));
    expect(row["epss_peak"]).toBeNull();
    expect(rowToIssue(throughSheet(row)).epssPeak).toBeNull();
  });
});

describe("ai_issue_exploitation — the evidence survives the sheet", () => {
  const row = {
    issueId: "iss-1",
    tier: "kev" as const,
    hasKev: true,
    hasExploit: false,
    epssPeak: 0.62,
    findingCount: 3,
    sampleFindingIds: ["vf-1", "vf-2"],
    observedAt: "2026-09-05T00:00:00.000Z",
  };

  it("declares every column the writer emits", async () => {
    const store = await import("../src/server/syncStore");
    const headers = TAB_HEADERS[TABS.issueExploitation]!;
    for (const key of Object.keys(store.exploitationToRow(row))) {
      expect([key, headers.indexOf(key) >= 0]).toEqual([key, true]);
    }
  });

  it("round-trips the WHOLE row", async () => {
    const store = await import("../src/server/syncStore");
    const written = store.exploitationToRow(row);
    const back = store.exploitationToRow(store.rowToExploitation(throughSheet(written)));
    expect(back).toEqual(written);
    expect(store.rowToExploitation(throughSheet(written))).toEqual(row);
  });

  it("keeps the two flags TRI-STATE through the cell", async () => {
    // The reason the tab exists in this shape. `triCell` writes the string "null" for a signal
    // Wiz never evaluated, so the column can say unmeasured in a place whose other two values
    // are true and false — and `parseTri` is the only reader allowed to decode it.
    const store = await import("../src/server/syncStore");
    const unmeasured = store.exploitationToRow({
      ...row, tier: "unknown", hasKev: null, hasExploit: null, epssPeak: null,
    });
    expect([unmeasured["has_kev"], unmeasured["has_exploit"]]).toEqual(["null", "null"]);
    expect(unmeasured["epss_peak"]).toBeNull();
    const parsed = store.rowToExploitation(throughSheet(unmeasured));
    expect([parsed.hasKev, parsed.hasExploit, parsed.epssPeak]).toEqual([null, null, null]);
    // A measured false must NOT come back as unmeasured — that is the collapse this file's
    // whole discipline exists to catch.
    const measured = store.rowToExploitation(
      throughSheet(store.exploitationToRow({ ...row, hasKev: false })),
    );
    expect(measured.hasKev).toBe(false);
  });
});
