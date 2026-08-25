// Recovering the `Wiz/Domain` tag onto episodes compacted before `EpisodeRow` carried one.
//
// The tag was never destroyed, only made unreachable: `deleteScansCore` deliberately skips
// episode keys, and the Drive checkpoint chain is CUMULATIVE, so the latest checkpoint still
// holds every converted lifecycle with its `tags_json`. This is the one-shot that reads it
// back — and the reason `Not attributable` shrinks after an operator runs it.

import { describe, expect, it } from "vitest";
import { backfillTagsFromCheckpoint } from "../src/domain/maintenance";
import { emptyState, type EpisodeRow, type LedgerState } from "../src/domain/ledgerCore";
import { emptyRiskSignals, type LedgerRow } from "../src/domain/reconcile";
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
