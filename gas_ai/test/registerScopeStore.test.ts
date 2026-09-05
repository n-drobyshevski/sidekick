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
