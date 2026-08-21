// Pruning the register to one project, end to end against the dry-run landscape.
//
// The planner has its own file; what is tested here is everything around it — that the tabs
// the census names are the tabs that actually shrink, that nothing is left pointing at an
// asset that no longer exists, that the tabs it promises not to touch are untouched, and that
// the caches are told. A prune is irreversible, so the invariants are worth more than the
// counts: the census must agree with an independent read, and running it twice must be
// indistinguishable from running it once.

import { beforeEach, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";

type Server = Awaited<ReturnType<typeof bootServer>>;
type Result<T = Record<string, unknown>> = { ok: boolean; data?: T; error?: string };
type Rec = Record<string, unknown>;

/** The business unit every seeded asset carries, and one leaf inside it. */
const UNIT = "proj-demo-business-unit";
const LEAF = "proj-project-gamma";

interface Census {
  total: number; direct: number; attached: number;
  droppedAttributed: number; droppedOrphan: number; keep: number;
}
interface PruneData {
  name: string | null;
  projectId: string;
  census: Census;
  tabs: Array<{ tab: string; before: number; after: number }>;
  cellsBefore: number;
  cellsAfter: number;
  message?: string;
}

let server: Server;
let db: typeof import("../src/server/sheetsDb");

beforeEach(async () => {
  teardownServer();
  server = await bootServer();
  server.setup();
  // Same module instance the server is using: bootServer resets the registry and imports the
  // server, and nothing resets it again between there and here.
  db = await import("../src/server/sheetsDb");
  expect((server.api.runSync({}) as Result).ok).toBe(true);
});

function preview(projectId?: string): Result<PruneData> {
  return server.api.previewPrune(projectId === undefined ? {} : { projectId }) as Result<PruneData>;
}

function prune(projectId: string): Result<PruneData> {
  return server.api.pruneToProject({ projectId }) as Result<PruneData>;
}

function rows(tab: string): Rec[] {
  return db.readAll(tab);
}

function ids(tab: string, column: string): Set<string> {
  return new Set(rows(tab).map((r) => String(r[column] ?? "")));
}

function versions(): { data: string; wiz: string } {
  const props = (globalThis as unknown as {
    PropertiesService: GoogleAppsScript.Properties.PropertiesService;
  }).PropertiesService.getScriptProperties();
  return {
    data: props.getProperty("DATA_VERSION") ?? "0",
    wiz: props.getProperty("WIZ_DATA_VERSION") ?? "0",
  };
}

describe("previewPrune", () => {
  it("writes nothing", () => {
    const before = rows(db.TABS.assets).length;
    expect(preview(LEAF).ok).toBe(true);
    expect(rows(db.TABS.assets).length).toBe(before);
  });

  it("names the project from the register rather than from a Wiz catalogue", () => {
    // A picker built on the live catalogue could offer a project this register was never
    // asked for, and the census behind such a pick reads zero — which is indistinguishable
    // on screen from "already clean".
    expect(preview(UNIT).data!.name).toBe("DEMO-BUSINESS-UNIT");
  });

  it("refuses a project no asset carries, instead of emptying the register", () => {
    const res = preview("proj-does-not-exist");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/would delete everything/);
    expect(res.error).toMatch(/Reset synced data/);
  });

  it("refuses when there is no project and no sync scope to fall back to", () => {
    // WIZ_PROJECT_ID_V2 is unset in the dry-run environment, so an empty call has no default.
    const res = preview();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/WIZ_PROJECT_ID_V2/);
  });

  it("falls back to the sync scope when the property is set", () => {
    const props = (globalThis as unknown as {
      PropertiesService: GoogleAppsScript.Properties.PropertiesService;
    }).PropertiesService.getScriptProperties();
    props.setProperty("WIZ_PROJECT_ID_V2", LEAF);
    try {
      expect(preview().data!.projectId).toBe(LEAF);
      // And the bootstrap payload says which option that is, so the panel can mark it.
      const boot = server.api.bootstrap({}) as Result<{ scope: { syncProjectId: string | null } }>;
      expect(boot.data!.scope.syncProjectId).toBe(LEAF);
    } finally {
      props.deleteProperty("WIZ_PROJECT_ID_V2");
    }
  });

  it("reaches the whole subtree from a folder id, and much less from a leaf", () => {
    // The reason the preview is mandatory: picking the business unit and picking one project
    // inside it differ by most of the register, and nothing else on screen says so.
    const unit = preview(UNIT).data!.census;
    const leaf = preview(LEAF).data!.census;
    expect(unit.keep).toBeGreaterThan(leaf.keep * 10);
    expect(unit.direct).toBeGreaterThan(leaf.direct);
  });
});

describe("pruneToProject", () => {
  it("shrinks exactly the tabs the census named, by exactly that much", () => {
    const planned = preview(LEAF).data!;
    expect(prune(LEAF).ok).toBe(true);

    for (const t of planned.tabs) {
      expect({ tab: t.tab, rows: rows(t.tab).length }).toEqual({ tab: t.tab, rows: t.after });
    }
  });

  it("carries a column it does not model through untouched", () => {
    // The prune moves RAW ROWS: `readAll` in, filter, `overwrite` out, and the only cell it
    // ever parses is `projects_json`. It never builds a GNode, so it cannot drop a column it
    // was written before — the value is opaque to it and travels by header name.
    //
    // Worth pinning rather than reasoning about, because the reasoning is easy to get right
    // for the wrong reason: it is NOT the row serializers preserving the value, since the
    // prune does not call them. A column stays because nothing in this path is in a position
    // to notice it.
    //
    // The header has to be in row 1 first. `overwrite` projects onto `ensureHeaders`, which
    // adds DECLARED columns and otherwise takes what the sheet already has — so a key the
    // header row has never seen is dropped at that write, long before any prune sees it.
    // Stamping row 1 directly is what a schema addition does, without pinning this test to
    // whatever TAB_HEADERS happens to list today.
    const sheet = db.ledgerSpreadsheet().getSheetByName(db.TABS.assets)!;
    sheet.getRange(1, sheet.getLastColumn() + 1, 1, 1).setValues([["wildcat"]]);
    db.overwrite(db.TABS.assets, rows(db.TABS.assets).map((r) => ({ ...r, wildcat: "keep-me" })));

    expect(prune(LEAF).ok).toBe(true);

    const after = rows(db.TABS.assets);
    expect(after.length).toBeGreaterThan(0);
    for (const r of after) expect(r["wildcat"]).toBe("keep-me");
  });

  it("leaves nothing hanging off an asset that is gone", () => {
    expect(prune(LEAF).ok).toBe(true);
    const assets = ids(db.TABS.assets, "id");

    for (const r of rows(db.TABS.issues)) expect(assets.has(String(r["asset_id"]))).toBe(true);
    for (const tab of [db.TABS.findings, db.TABS.dataFindings, db.TABS.identityFindings]) {
      for (const r of rows(tab)) expect(assets.has(String(r["resource_id"]))).toBe(true);
    }
    for (const r of rows(db.TABS.edges)) {
      expect(assets.has(String(r["src"]))).toBe(true);
      expect(assets.has(String(r["dst"]))).toBe(true);
    }
  });

  it("keeps the tabs it promises to keep", () => {
    // The framework tabs and the rule catalogue are Wiz's vocabulary and the tenant's
    // posture, neither of which is per-project. sync_history records what a sync actually
    // fetched: rewriting those rows to agree with a later deletion would be a different
    // untruth than leaving them, and the panel says which one it picked.
    const kept = [
      db.TABS.syncHistory, db.TABS.settings, db.TABS.frameworks,
      db.TABS.frameworkPosture, db.TABS.frameworkPolicies, db.TABS.configRules,
    ];
    const before = kept.map((t) => [t, rows(t).length] as const);
    expect(prune(LEAF).ok).toBe(true);
    expect(kept.map((t) => [t, rows(t).length] as const)).toEqual(before);
  });

  it("is idempotent: a second run finds nothing left to do", () => {
    // The strongest statement available about the filter — the survivors of one pass are
    // exactly the fixed point of the next, computed by a fresh read of what was written.
    expect(prune(LEAF).ok).toBe(true);
    const again = preview(LEAF).data!;

    expect(again.census.keep).toBe(again.census.total);
    for (const t of again.tabs) expect(t.after).toBe(t.before);
  });

  it("keeps unattributed assets an edge reaches, and drops the ones nothing reaches", () => {
    // The identity population belongs to no project. Both halves are asserted, because a
    // rule that kept everything unattributed and a rule that dropped everything unattributed
    // would each satisfy half of this on their own.
    const planned = preview(UNIT).data!.census;
    expect(planned.attached).toBeGreaterThan(0);
    expect(planned.droppedOrphan).toBeGreaterThan(0);

    expect(prune(UNIT).ok).toBe(true);
    const assets = rows(db.TABS.assets);
    const unattributed = assets.filter((r) => String(r["projects_json"] ?? "[]") === "[]");
    expect(unattributed.length).toBe(planned.attached);
  });

  it("prunes the Drive snapshot too, so the graph stops drawing deleted assets", () => {
    // The snapshot is getGraph's fast path. Left alone it would go on answering with the
    // register as it was, and the tabs would be the only place the prune had happened.
    expect(prune(LEAF).ok).toBe(true);
    const kept = ids(db.TABS.assets, "id");
    const graph = server.api.getGraph({}) as Result<{ nodes: Array<{ id: string; kind: string }> }>;
    expect(graph.ok).toBe(true);

    const drawnAssets = graph.data!.nodes.filter((n) => kept.has(n.id));
    expect(drawnAssets.length).toBeGreaterThan(0);
    // Every drawn node is either a surviving asset or graph furniture derived at read time
    // (ISSUE, and the risk nodes withRiskNodes hangs off them) — never a deleted asset.
    const issues = ids(db.TABS.issues, "id");
    for (const n of graph.data!.nodes) {
      if (kept.has(n.id) || issues.has(n.id)) continue;
      expect(n.kind).not.toBe("AI_AGENT");
    }
  });

  it("moves both cache versions, and moves them before the writes land", () => {
    // WIZ_DATA_VERSION in particular: a cached live expansion that outlived the prune would
    // answer about an asset the register no longer holds, and expandAsset's own guard cannot
    // catch that — with the node gone it skips the kind check and serves the stale answer.
    const before = versions();
    expect(prune(LEAF).ok).toBe(true);
    const after = versions();
    expect(after.data).not.toBe(before.data);
    expect(after.wiz).not.toBe(before.wiz);
  });

  it("reports what it removed in the same terms the preview promised", () => {
    const planned = preview(LEAF).data!;
    const done = prune(LEAF).data!;
    expect(done.census).toEqual(planned.census);
    expect(done.message).toMatch(new RegExp(String(planned.census.keep) + " kept"));
  });

  it("agrees with the storage figures the page shows above it", () => {
    // An independent read of the same rows, through the endpoint the KPI row uses. The census
    // being self-consistent is not enough; it has to agree with the number next to it.
    expect(prune(LEAF).ok).toBe(true);
    const stats = server.api.getStorageStats({}) as Result<{
      rows: { assets: number; edges: number; issues: number; dataFindings: number };
    }>;
    expect(stats.data!.rows.assets).toBe(rows(db.TABS.assets).length);
    expect(stats.data!.rows.edges).toBe(rows(db.TABS.edges).length);
    expect(stats.data!.rows.issues).toBe(rows(db.TABS.issues).length);
    expect(stats.data!.rows.dataFindings).toBe(rows(db.TABS.dataFindings).length);
  });
});

describe("trimSurplusRows", () => {
  it("gives the grid back, which is the only thing that moves the cell count", () => {
    // `overwrite` clears content but never shrinks the grid, and cellCount() prices
    // getMaxRows() * getMaxColumns(). Without this a prune can delete four rows in five and
    // the storage figure on the Data page does not move.
    const before = db.gridSize(db.TABS.assets).rows;
    const freed = db.trimSurplusRows(db.TABS.assets, 0);
    expect(freed).toBeGreaterThan(0);
    expect(db.gridSize(db.TABS.assets).rows).toBe(before - freed);
    // The header survives, and so does everything under it.
    expect(rows(db.TABS.assets).length).toBeGreaterThan(0);
  });

  it("never takes the grid below the rows that are still in it", () => {
    const kept = rows(db.TABS.assets).length;
    db.trimSurplusRows(db.TABS.assets, 0);
    // Header plus every surviving row, and not one row less. Trimming reclaims allocation,
    // never content.
    expect(db.gridSize(db.TABS.assets).rows).toBe(kept + 1);
    expect(rows(db.TABS.assets).length).toBe(kept);
  });

  it("leaves a tab smaller than the buffer alone", () => {
    // The buffer is a floor, not a target: this reclaims spare grid, it does not go and
    // allocate some. A register smaller than the buffer has no surplus worth the call, which
    // is why the panel only claims the cell figure will move when it is going to.
    const grid = db.gridSize(db.TABS.assets).rows;
    expect(grid).toBeLessThan(db.TRIM_BUFFER_ROWS);
    expect(db.trimSurplusRows(db.TABS.assets)).toBe(0);
    expect(db.gridSize(db.TABS.assets).rows).toBe(grid);
  });
});
