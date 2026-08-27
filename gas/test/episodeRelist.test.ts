// The tag bag that arrived every day and was thrown away.
//
// The vulnerability query fetches `status: ["OPEN", "RESOLVED"]` (server/wizQuery.ts), so Wiz
// keeps re-listing findings whose lifecycle compaction already sealed into an episode. The
// ledger is right to keep the episode authoritative and drop the fresh row — the resolution is
// already counted, and re-counting it would double the delta. But the fresh row carries the
// resource's CURRENT tag bag, and an episode's bag is the only attribution input it still has.
// Dropping the row unread is how a sealed lifecycle stayed `Not attributable` forever while the
// answer arrived on every scan.
//
// These specs pin the fix and, just as importantly, pin that nothing ELSE about the collision
// branch moved: the deltas, the reopen path, and episode authority are untouched.

import { describe, expect, it } from "vitest";
import {
  emptyState,
  persistFlatScan,
  type EpisodeRow,
  type LedgerState,
} from "../src/domain/ledgerCore";
import { emptyRiskSignals } from "../src/domain/reconcile";
import { resolveDomain } from "../src/domain/resolveDomain";
import { compileDomains } from "../src/domain/domainRules";

const T1 = "2026-05-01T00:00:00Z";
const SAP_CANON = '{"Wiz/Domain": "SAP"}';

function episode(vuln_key: string, tags_json: string | null = null): EpisodeRow {
  return {
    vuln_key,
    cve: "CVE-2026-0001",
    severity: "HIGH",
    first_seen: "2026-01-01T00:00:00Z",
    resolved_at: "2026-02-01T00:00:00Z",
    resolution_src: "api",
    reopened_count: 0,
    compaction_id: "cmp-1",
    superseded_by_scan: null,
    fix_date: null,
    fix_observed_at: null,
    published_date: null,
    tags_json,
    ...emptyRiskSignals(),
  };
}

/** A finding as the API re-lists it: `id:` keying, full asset, and a status. */
function node(status: string, tags: Record<string, unknown> | null) {
  return {
    id: "A",
    name: "CVE-2026-0001",
    severity: "HIGH",
    status,
    ...(status === "RESOLVED" ? { resolvedAt: "2026-02-01T00:00:00Z" } : {}),
    vulnerableAsset: {
      id: "a-1",
      name: "vm-1",
      type: "VIRTUAL_MACHINE",
      subscriptionName: "core-prod",
      ...(tags ? { tags } : {}),
    },
  };
}

function stateWith(e: EpisodeRow): LedgerState {
  return { ...emptyState(), episodes: [e] };
}

describe("an episode re-listed by the API as still resolved", () => {
  it("takes the tag bag off the dropped row", () => {
    const state = stateWith(episode("id:A"));
    persistFlatScan(state, [node("RESOLVED", { "Wiz/Domain": "SAP" })], {
      mode: "live",
      scanId: T1,
    });
    expect(state.episodes[0].tags_json).toBe(SAP_CANON);
    // The episode stays authoritative: no live row was kept for the key.
    expect(state.ledger["id:A"]).toBeUndefined();
  });

  it("turns that episode from Not attributable into an attributed one", () => {
    // The whole point, stated as the figure that moves. Before: no name, no subscription, no
    // tags — `hasDomainInputs` false, so `Not attributable`, a bucket no operator can close.
    const compiled = compileDomains([]);
    const before = { asset_name: "(compacted)", tags_json: null };
    expect(resolveDomain(before, compiled).source).toBe("missing");

    const state = stateWith(episode("id:A"));
    persistFlatScan(state, [node("RESOLVED", { "Wiz/Domain": "SAP" })], {
      mode: "live",
      scanId: T1,
    });
    const after = { asset_name: "(compacted)", tags_json: state.episodes[0].tags_json };
    expect(resolveDomain(after, compiled)).toEqual({ name: "SAP", source: "tag" });
  });

  it("never overwrites a bag the episode already carries", () => {
    // Fill-only, the same rule backfillTagsFromCheckpoint applies. A bag already on the row
    // came from the ledger at seal time or from a newer source; a re-list must not regress it.
    const state = stateWith(episode("id:A", '{"Wiz/Domain": "KEEP"}'));
    persistFlatScan(state, [node("RESOLVED", { "Wiz/Domain": "SAP" })], {
      mode: "live",
      scanId: T1,
    });
    expect(state.episodes[0].tags_json).toBe('{"Wiz/Domain": "KEEP"}');
  });

  it("recovers nothing, and breaks nothing, when the resource has no tags", () => {
    const state = stateWith(episode("id:A"));
    persistFlatScan(state, [node("RESOLVED", null)], { mode: "live", scanId: T1 });
    expect(state.episodes[0].tags_json).toBeNull();
    expect(state.ledger["id:A"]).toBeUndefined();
  });

  it("leaves the scan's deltas exactly where they were", () => {
    // The re-list is not new work and not a fresh resolution. Reading the bag must not change
    // that — a moved delta here would show up as a phantom spike on the trend.
    const state = stateWith(episode("id:A"));
    const { deltas } = persistFlatScan(state, [node("RESOLVED", { "Wiz/Domain": "SAP" })], {
      mode: "live",
      scanId: T1,
    });
    expect(deltas).toEqual({ new_count: 0, resolved_count: 0, reopened_count: 0 });
  });
});

describe("a genuine reopen is unaffected", () => {
  it("keeps the live row, supersedes the episode, and counts a reopen", () => {
    const state = stateWith(episode("id:A"));
    const { deltas } = persistFlatScan(state, [node("OPEN", { "Wiz/Domain": "SAP" })], {
      mode: "live",
      scanId: T1,
    });
    expect(deltas).toEqual({ new_count: 0, resolved_count: 0, reopened_count: 1 });
    expect(state.episodes[0].superseded_by_scan).toBe(T1);
    // The live row is authoritative now and carries the bag itself, via reconcile — the
    // episode is out of the picture, so nothing needed to be lifted off it.
    expect(state.ledger["id:A"].status).toBe("OPEN");
    expect(state.ledger["id:A"].reopened_count).toBe(1);
    expect(state.ledger["id:A"].tags_json).toBe(SAP_CANON);
  });
});
