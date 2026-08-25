// Recovering the `Wiz/Domain` tag onto episodes compacted before `EpisodeRow` carried one.
//
// The tag was never destroyed, only made unreachable: `deleteScansCore` deliberately skips
// episode keys, and the Drive checkpoint chain is CUMULATIVE, so the latest checkpoint still
// holds every converted lifecycle with its `tags_json`. This is the one-shot that reads it
// back — and the reason `Not attributable` shrinks after an operator runs it.

import { describe, expect, it } from "vitest";
import {
  backfillTagsFromCheckpoint,
  backfillTagsFromRecords,
  countUnattributable,
  emptyBackfillResult,
} from "../src/domain/maintenance";
import { emptyState, type EpisodeRow, type LedgerState } from "../src/domain/ledgerCore";
import { emptyRiskSignals, type LedgerRow } from "../src/domain/reconcile";
import { type Rec } from "../src/domain/util";
import { CHECKPOINT_VERSION, type Checkpoint } from "../src/domain/compaction";

function episode(vuln_key: string, tags_json: string | null = null): EpisodeRow {
  return {
    vuln_key,
    cve: vuln_key.toUpperCase(),
    severity: "HIGH",
    first_seen: "2026-01-01T00:00:00Z",
    resolved_at: "2026-02-01T00:00:00Z",
    resolution_src: "api",
    reopened_count: 0,
    superseded_by_scan: null,
    compaction_id: "cmp-1",
    fix_date: null,
    fix_observed_at: null,
    tags_json,
    ...emptyRiskSignals(),
  };
}

function ledgerRow(vuln_key: string, tags_json: string | null): LedgerRow {
  return {
    vuln_key, cve: null, severity: "HIGH", asset_id: null, asset_name: "vm-1",
    asset_type: null, cloud: null, first_seen: "2026-01-01T00:00:00Z",
    last_seen: "2026-02-01T00:00:00Z", status: "RESOLVED",
    resolved_at: "2026-02-01T00:00:00Z", resolution_src: "api", reopened_count: 0,
    first_scan_id: null, last_scan_id: null, subscription_name: null,
    subscription_ext_id: null, tags_json, fix_date: null, fix_observed_at: null,
    ...emptyRiskSignals(),
  };
}

function checkpoint(rows: LedgerRow[]): Checkpoint {
  return {
    version: CHECKPOINT_VERSION,
    floor_scan_id: "s1",
    floor_ts: "2026-03-01T00:00:00Z",
    ledger: rows,
  };
}

const SAP = JSON.stringify({ "Wiz/Domain": "SAP" });
const CROSS = JSON.stringify({ "Wiz/Domain": "CROSS" });

function stateWith(episodes: EpisodeRow[]): LedgerState {
  return { ...emptyState(), episodes };
}

describe("backfillTagsFromCheckpoint", () => {
  it("writes the checkpoint's tag bag onto an episode that has none", () => {
    const state = stateWith([episode("id:A"), episode("id:B")]);
    const res = backfillTagsFromCheckpoint(state, checkpoint([
      ledgerRow("id:A", SAP),
      ledgerRow("id:B", CROSS),
    ]));
    expect(res).toEqual({ recovered: 2, alreadyHad: 0, unrecoverable: 0 });
    expect(state.episodes.map((e) => e.tags_json)).toEqual([SAP, CROSS]);
  });

  it("is idempotent — a second run recovers nothing and changes nothing", () => {
    const state = stateWith([episode("id:A")]);
    const cp = checkpoint([ledgerRow("id:A", SAP)]);
    backfillTagsFromCheckpoint(state, cp);
    const after = state.episodes.map((e) => e.tags_json);
    const again = backfillTagsFromCheckpoint(state, cp);
    expect(again).toEqual({ recovered: 0, alreadyHad: 1, unrecoverable: 0 });
    expect(state.episodes.map((e) => e.tags_json)).toEqual(after);
  });

  it("NEVER overwrites a bag the episode already carries", () => {
    // A post-fix compaction wrote the live row's tags, which are at least as fresh as the
    // checkpoint's. Preferring the checkpoint would walk an episode BACKWARDS in time.
    const state = stateWith([episode("id:A", CROSS)]);
    const res = backfillTagsFromCheckpoint(state, checkpoint([ledgerRow("id:A", SAP)]));
    expect(res).toEqual({ recovered: 0, alreadyHad: 1, unrecoverable: 0 });
    expect(state.episodes[0].tags_json).toBe(CROSS);
  });

  it("counts an episode the checkpoint cannot answer for as unrecoverable, not as a failure", () => {
    // History imported from a legacy bundle never had tags to lose. Reporting it separately is
    // what lets an operator read "412 recovered, 88 unrecoverable" as done rather than broken.
    const state = stateWith([episode("id:A"), episode("id:legacy")]);
    const res = backfillTagsFromCheckpoint(state, checkpoint([ledgerRow("id:A", SAP)]));
    expect(res).toEqual({ recovered: 1, alreadyHad: 0, unrecoverable: 1 });
    expect(state.episodes[1].tags_json).toBeNull();
  });

  it("treats a checkpoint row with a null bag as unrecoverable, not as an empty bag", () => {
    const state = stateWith([episode("id:A")]);
    const res = backfillTagsFromCheckpoint(state, checkpoint([ledgerRow("id:A", null)]));
    expect(res).toEqual({ recovered: 0, alreadyHad: 0, unrecoverable: 1 });
    expect(state.episodes[0].tags_json).toBeNull();
  });

  it("reports every episode unrecoverable rather than throwing on no checkpoint at all", () => {
    const state = stateWith([episode("id:A")]);
    expect(backfillTagsFromCheckpoint(state, null))
      .toEqual({ recovered: 0, alreadyHad: 0, unrecoverable: 1 });
  });

  it("does nothing on a register that has never compacted", () => {
    const state = stateWith([]);
    expect(backfillTagsFromCheckpoint(state, checkpoint([ledgerRow("id:A", SAP)])))
      .toEqual({ recovered: 0, alreadyHad: 0, unrecoverable: 0 });
  });
});

// ---------------------------------------------------------------------------------------
// The other half: recovering a bag from the SCAN ARCHIVES rather than the checkpoint.
//
// The checkpoint chain cannot reach every unattributed row. History imported from a legacy
// bundle was never in a GAS checkpoint — the Python exporter had no `tags_json` column to
// export and its `resolved_episodes` table had none to lose — so `unrecoverable` above is
// exactly that population. The archives still hold the records those lifecycles came from,
// and the history backfill walks them for exploit signals already; this rides that walk.

// The bag a RECORD produces, which is not JSON.stringify's output: reconcile.tagsJson writes
// canonical JSON with sorted keys and a ", " separator, for byte-stability with the rows the
// Python app wrote. The checkpoint constants above are supplied verbatim and so keep the
// compact form; these come out of the canonicalizer, and pinning the difference here is what
// stops a future "tidy-up" from silently changing what a recovered bag looks like on disk.
const SAP_CANON = '{"Wiz/Domain": "SAP"}';

/** A slim scan record as the archive holds it, with the nested asset shape. */
function record(id: string, tags: Record<string, unknown> | null): Rec {
  return {
    id,
    name: "CVE-2026-0001",
    severity: "HIGH",
    vulnerableAsset: { id: "a-1", name: "vm-1", type: "VIRTUAL_MACHINE", ...(tags ? { tags } : {}) },
  };
}

describe("backfillTagsFromRecords", () => {
  it("fills an episode's empty bag from a record the archive still holds", () => {
    const state = stateWith([episode("id:A"), episode("id:B")]);
    const result = emptyBackfillResult();
    backfillTagsFromRecords(state, [record("A", { "Wiz/Domain": "SAP" })], result);
    expect(result.tagsRecovered).toBe(1);
    expect(state.episodes[0].tags_json).toBe(SAP_CANON);
    // B was not in this scan and is untouched — no fabricated bag.
    expect(state.episodes[1].tags_json).toBeNull();
  });

  it("fills a LIVE ledger row too, not only episodes", () => {
    // reconcile keeps a live row's bag sticky (`?? row.tags_json`), so a null one means the
    // bag was never captured — the same gap, on a row that was never compacted.
    const state = { ...emptyState(), ledger: { "id:A": ledgerRow("id:A", null) } };
    const result = emptyBackfillResult();
    backfillTagsFromRecords(state, [record("A", { "Wiz/Domain": "SAP" })], result);
    expect(result.tagsRecovered).toBe(1);
    expect(state.ledger["id:A"].tags_json).toBe(SAP_CANON);
  });

  it("is FILL-ONLY, so the newest-first walk keeps the freshest surviving bag", () => {
    // The property the caller's replay order depends on. Overwriting would invert it: a deep
    // archive would clobber a fresher bag and the result would depend on where a run stopped.
    const state = stateWith([episode("id:A", SAP)]);
    const result = emptyBackfillResult();
    backfillTagsFromRecords(state, [record("A", { "Wiz/Domain": "STALE" })], result);
    expect(result.tagsRecovered).toBe(0);
    expect(state.episodes[0].tags_json).toBe(SAP);
  });

  it("is order-independent and idempotent across replayed scans", () => {
    const newest = [record("A", { "Wiz/Domain": "SAP" })];
    const older = [record("A", { "Wiz/Domain": "STALE" })];
    const run = (batches: Rec[][]) => {
      const state = stateWith([episode("id:A")]);
      const result = emptyBackfillResult();
      for (const b of batches) backfillTagsFromRecords(state, b, result);
      return state.episodes[0].tags_json;
    };
    // Newest-first (the real replay order) wins, and re-running converges on the same state.
    expect(run([newest, older])).toBe(SAP_CANON);
    expect(run([newest, older, newest, older])).toBe(SAP_CANON);
  });

  it("records with no tags at all recover nothing rather than writing an empty bag", () => {
    const state = stateWith([episode("id:A")]);
    const result = emptyBackfillResult();
    backfillTagsFromRecords(state, [record("A", null)], result);
    expect(result.tagsRecovered).toBe(0);
    expect(state.episodes[0].tags_json).toBeNull();
  });
});

describe("countUnattributable", () => {
  it("counts only the rows no mechanism can still read an input off", () => {
    const state: LedgerState = {
      ...emptyState(),
      ledger: { "id:L": ledgerRow("id:L", null) }, // has asset_name "vm-1" -> attributable
      episodes: [episode("id:A"), episode("id:B", SAP)],
    };
    expect(countUnattributable(state)).toBe(1); // only the bagless episode
  });

  it("ignores episodes a live row supersedes, matching what baseRows surfaces", () => {
    const state: LedgerState = {
      ...emptyState(),
      ledger: { "id:A": ledgerRow("id:A", SAP) },
      episodes: [episode("id:A")], // shadowed by the live row above
    };
    expect(countUnattributable(state)).toBe(0);
  });
});
