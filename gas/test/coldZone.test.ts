// test/coldZone.test.ts — the cold-zone family (src/domain/coldZone.ts).
//
// NO SECOND ORACLE HERE, and that is worth stating: most of this domain is pinned against
// something else — brick fixtures, the Python spec, a recorded ledger — but nothing measures
// a cold zone except this module. The definition is this product's own, built from ledger
// columns that already exist. So every case below is a hand case with the arithmetic written
// out, and the clock is fixed at one instant so a duration is a subtraction anyone can check
// by eye. No fixture, no snapshot.
//
// WHAT EACH BLOCK IS GUARDING, since several of them look like the same test:
//
//   measured / bound       "no movement on record" and "a measured long silence" are two
//                          different facts. The first publishes a LOWER bound and says so
//                          (`idle_is_bound`), the second publishes a number. A test that
//                          only checked the verdict would pass with the two folded together.
//   the threshold edge     exactly 90.0 is COLD. The register writes "≥ N", never ">", so a
//                          `>` in the domain would make the page's own wording wrong.
//   unobserved first       `reconcile` closes findings that vanish from a scan BY
//                          DISAPPEARANCE, so an asset that drops out of coverage looks
//                          mass-remediated in exactly one scan. Rule 1 has to fire before
//                          rule 2 (`clear`) or a drop-out reads as a finished job.
//   observation per        the map handed in is keyed by NORMALIZED SEVERITY and carries FLAT
//   severity               scans only. A CRITICAL-only sweep must not make every HIGH asset
//                          vanish, which is the same rule `reconcile` applies to the same
//                          rows; a severity with no entry is undecidable, never stale.
//   unclassified rows      `program.classifyRisk` returns `unknown` when an enabled signal was
//                          never captured. Those are real open findings and must count as
//                          such — and must never count as high risk, because a missing signal
//                          is not an observed negative.
//   the counts             `row_count`, `dropped_no_asset`, `unclassified_rows` and
//                          `severities_without_scan` report even when nothing else does. A
//                          zero has to prove it looked.

import { describe, expect, it } from "vitest";
import {
  COLD_GROUP_NONE,
  coldZoneHeadline,
  coldZoneProfile,
  type ColdRow,
  type ColdZoneOptions,
  type ColdZoneResult,
} from "../src/domain/coldZone";
import {
  COLD_AFTER_DAYS_MAX,
  COLD_AFTER_DAYS_MIN,
  COLD_FLOOR_DAYS_MAX,
  COLD_FLOOR_DAYS_MIN,
  COLD_TARGET_SHARE_PCT_MAX,
  COLD_TARGET_SHARE_PCT_MIN,
  COLD_ZONE_MODES,
  DEFAULT_COLD_AFTER_DAYS,
  DEFAULT_COLD_FLOOR_DAYS,
  DEFAULT_COLD_TARGET_SHARE_PCT,
  DEFAULT_COLD_ZONE_MODE,
  RESOLUTION_DISAPPEARED,
  type ColdZoneMode,
} from "../src/domain/config";
import { DEFAULT_RISK_RULE, type RiskRule } from "../src/domain/program";

const DAY = 86_400_000;
const AS_OF = "2026-07-01T00:00:00Z";
const AS_OF_MS = Date.parse(AS_OF);

/** `n` days before the fixed clock, as ISO — every duration below is one of these. */
const back = (days: number): string => new Date(AS_OF_MS - days * DAY).toISOString();

/** Canonical ISO as the domain publishes it (`util.toIso`: second precision, "…Z"). */
const iso = (days: number): string => back(days).replace(".000Z", "Z");

/** The newest FLAT scan that covered HIGH — the severity every default row carries. */
const NEWEST_HIGH = { scan_id: "scan-9", ts: AS_OF };

/** A minimal open HIGH row on `asset-1`; every field the profile reads is overridable. */
function row(over: Partial<ColdRow> = {}): ColdRow {
  return {
    severity: "HIGH",
    status: "OPEN",
    has_kev: false,
    has_exploit: false,
    epss: 0,
    asset_id: "asset-1",
    asset_name: "web-01",
    asset_type: "vm",
    cloud: "aws",
    _supportGroup: "platform",
    first_seen: back(200),
    last_seen: AS_OF,
    resolved_at: null,
    resolution_src: null,
    reopened_count: 0,
    last_scan_id: "scan-9",
    ...over,
  };
}

/** A KEV row — the shape `DEFAULT_RISK_RULE` classifies `high` without any other column. */
const highRisk = (over: Partial<ColdRow> = {}): ColdRow => row({ has_kev: true, ...over });

function profile(rows: ColdRow[], over: Partial<ColdZoneOptions> = {}): ColdZoneResult {
  return coldZoneProfile(rows, {
    now: AS_OF,
    observedFrom: back(400),
    coldAfterDays: DEFAULT_COLD_AFTER_DAYS,
    newestScanBySeverity: { HIGH: NEWEST_HIGH },
    rule: DEFAULT_RISK_RULE,
    ...over,
  });
}

const assetOf = (out: ColdZoneResult, id: string) => out.assets!.find((a) => a.asset_id === id)!;
const groupOf = (out: ColdZoneResult, label: string) => out.groups!.find((g) => g.label === label)!;

// --------------------------------------------------------------------- measured silence

describe("a measured silence past the threshold is cold", () => {
  const out = profile([
    row({ first_seen: back(300) }),
    row({ first_seen: back(250) }),
    row({ status: "RESOLVED", resolved_at: back(120), first_seen: back(300) }),
  ]);
  const asset = assetOf(out, "asset-1");

  it("measures idle from the last movement, not from the oldest finding", () => {
    expect(asset.idle_days).toBeCloseTo(120, 9);
    expect(asset.idle_is_bound).toBe(false);
    expect(asset.idle_bound_days).toBeNull();
    expect(asset.idle_reading_days).toBeCloseTo(120, 9);
    expect(asset.last_movement_at).toBe("2026-03-03T00:00:00Z");
  });

  it("calls it cold, in bucket 3, with the two open findings still counted", () => {
    expect(asset.verdict).toBe("cold");
    expect(asset.cold).toBe(true);
    expect(asset.bucket).toBe(3);
    expect(asset.open_findings).toBe(2);
    // From `first_seen` against the caller's clock — never the row's stored `age_days`.
    expect(asset.oldest_open_age_days).toBeCloseTo(300, 9);
    expect(out.totals!.open_in_cold).toBe(2);
    expect(out.totals!.cold_backlog_share_pct).toBe(100);
  });

  it("carries the asset's descriptive columns without keying on them", () => {
    expect(asset.asset_name).toBe("web-01");
    expect(asset.asset_type).toBe("vm");
    expect(asset.cloud).toBe("aws");
    expect(asset.support_group).toBe("platform");
  });

  it("keeps idle days fractional rather than rounding them", () => {
    const half = profile([row(), row({ status: "RESOLVED", resolved_at: back(120.5) })]);
    expect(assetOf(half, "asset-1").idle_days).toBeCloseTo(120.5, 9);
  });
});

describe("the threshold edge is inclusive — '≥ N', never '>'", () => {
  const at = (days: number) =>
    assetOf(profile([row(), row({ status: "RESOLVED", resolved_at: back(days) })]), "asset-1");

  it("is cold at exactly 90.0 days", () => {
    const asset = at(90);
    expect(asset.idle_days).toBe(90);
    expect(asset.verdict).toBe("cold");
    expect(asset.bucket).toBe(3);
  });

  it("is warm at 89.9 days", () => {
    const asset = at(89.9);
    expect(asset.idle_days).toBeCloseTo(89.9, 9);
    expect(asset.verdict).toBe("warm");
    expect(asset.cold).toBe(false);
    expect(asset.bucket).toBe(2); // [60, 90)
  });
});

// ------------------------------------------------------------------------- the lower bound

describe("no movement on record publishes a LOWER BOUND, not a measurement", () => {
  // The bound starts at the LATER of "when we started watching" and "this asset's oldest
  // finding". Watched time before the asset had a finding is not a silence anybody could
  // have broken, and neither is the asset's life before we looked.
  const out = profile(
    [
      row({ asset_id: "asset-young", asset_name: "young", first_seen: back(20) }),
      row({ asset_id: "asset-old", asset_name: "old", first_seen: back(900) }),
    ],
    { observedFrom: back(400) },
  );

  it("bounds a young asset by its own first_seen and calls it 'watching'", () => {
    const asset = assetOf(out, "asset-young");
    expect(asset.idle_days).toBeNull();
    expect(asset.idle_is_bound).toBe(true);
    expect(asset.idle_bound_days).toBeCloseTo(20, 9); // max(observedFrom, first_seen) = first_seen
    expect(asset.idle_reading_days).toBeCloseTo(20, 9);
    expect(asset.verdict).toBe("watching");
    expect(asset.cold).toBe(false);
    expect(asset.bucket).toBe(4); // "not yet measurable" — its own column, not 0-30 d
    expect(asset.last_movement_at).toBeNull();
  });

  it("bounds an older asset by observedFrom, and a bound past the threshold IS cold", () => {
    const asset = assetOf(out, "asset-old");
    expect(asset.idle_days).toBeNull();
    expect(asset.idle_bound_days).toBeCloseTo(400, 9); // max(observedFrom, first_seen) = observedFrom
    expect(asset.idle_is_bound).toBe(true);
    expect(asset.verdict).toBe("cold");
    expect(asset.bucket).toBe(3);
  });

  it("shows how many open findings came back, so a silent asset can explain itself", () => {
    // A reopen CLEARS resolved_at (reconcile.ts, "Genuine reopen"), so an asset whose only
    // close was reopened has NO movement on record and lands in `watching`. The count is
    // published beside it rather than the page implying nothing ever happened here.
    const out2 = profile([
      row({ asset_id: "asset-returned", first_seen: back(20), reopened_count: 2 }),
      row({ asset_id: "asset-returned", first_seen: back(20), reopened_count: 0 }),
    ]);
    const asset = assetOf(out2, "asset-returned");
    expect(asset.verdict).toBe("watching");
    expect(asset.reopened_open).toBe(1);
  });
});

// ----------------------------------------------------------------- no clock, no figures

describe("observedFrom: null — every derived block is null, the counts still report", () => {
  const out = profile(
    [
      row(),
      row({ asset_id: null }),
      row({ has_kev: null }),
      row({ asset_id: "asset-2", severity: "MEDIUM" }),
    ],
    { observedFrom: null },
  );

  it("refuses the five derived blocks, as nulls rather than empties", () => {
    expect(out.measurable).toBe(false);
    expect(out.assets).toBeNull();
    expect(out.groups).toBeNull();
    expect(out.totals).toBeNull();
    expect(out.bucket_edges).toBeNull();
    expect(out.bucket_labels).toBeNull();
    expect(out.observed_from).toBeNull();
  });

  it("still says what it looked at, and what it could not place", () => {
    expect(out.row_count).toBe(4);
    expect(out.dropped_no_asset).toBe(1);
    expect(out.unclassified_rows).toBe(1);
    expect(out.severities_without_scan).toEqual(["MEDIUM"]);
    // The clock and the threshold are facts about the read, not about the rows.
    expect(out.as_of).toBe(AS_OF);
    expect(out.cold_after_days).toBe(DEFAULT_COLD_AFTER_DAYS);
  });
});

// ------------------------------------------------------------------------- unobserved

describe("an asset the scanner stopped returning is 'unobserved', never warm", () => {
  const out = profile([
    row({ asset_id: "asset-gone", asset_name: "gone", last_scan_id: "scan-1" }),
    row({ asset_id: "asset-gone", asset_name: "gone", last_scan_id: "scan-1" }),
    row({ asset_id: "asset-here", asset_name: "here", status: "RESOLVED", resolved_at: back(10) }),
    row({ asset_id: "asset-here", asset_name: "here" }),
  ]);
  const gone = assetOf(out, "asset-gone");

  it("names the state and leaves the asset out of every idle column", () => {
    expect(gone.observed).toBe(false);
    expect(gone.verdict).toBe("unobserved");
    expect(gone.cold).toBe(false);
    expect(gone.bucket).toBeNull();
    // Would have been cold by bound (200 d — max(observedFrom, first_seen) — of silence)
    // had it still been scanned. The bound is still published; the verdict refuses it.
    expect(gone.idle_bound_days).toBeCloseTo(200, 9);
  });

  it("counts its backlog apart, and never in the cold or warm totals", () => {
    const t = out.totals!;
    expect(t.assets_unobserved).toBe(1);
    expect(t.open_in_unobserved).toBe(2);
    expect(t.cold_assets).toBe(0);
    expect(t.warm_assets).toBe(1); // asset-here only
    expect(t.assets_with_open).toBe(1);
    expect(t.buckets).toEqual([1, 0, 0, 0, 0]); // only asset-here, idle 10 d
    expect(t.cold_asset_share_pct).toBe(0);
  });

  it("accepts a blank last_scan_id when last_seen reaches the newest scan", () => {
    // Older ledger rows can carry the sighting without the scan id; the fallback keeps them
    // observed rather than accusing a live asset of vanishing.
    const out2 = profile([row({ asset_id: "asset-blank", last_scan_id: "", last_seen: AS_OF })]);
    expect(assetOf(out2, "asset-blank").observed).toBe(true);
    const out3 = profile([row({ asset_id: "asset-blank", last_scan_id: "", last_seen: back(30) })]);
    expect(assetOf(out3, "asset-blank").observed).toBe(false);
  });
});

describe("a mass disappearance one day before the clock is still 'unobserved'", () => {
  // reconcile resolves every absent finding by disappearance at the scan that noticed. Read
  // naively that is five remediations yesterday — the warmest asset on the page. Rule 1 fires
  // first, so the asset reads `unobserved` even though nothing is open on it.
  const dropped = (over: Partial<ColdRow> = {}) =>
    row({
      asset_id: "asset-dropped",
      asset_name: "dropped",
      last_scan_id: "scan-1",
      status: "RESOLVED",
      resolution_src: RESOLUTION_DISAPPEARED,
      ...over,
    });
  const out = profile([
    dropped({ resolved_at: back(1) }),
    dropped({ resolved_at: back(1) }),
    dropped({ resolved_at: back(1) }),
    dropped({ resolved_at: back(1) }),
    dropped({ resolved_at: back(1) }),
    dropped({ resolved_at: back(40) }),
    dropped({ resolved_at: back(40) }),
  ]);
  const asset = assetOf(out, "asset-dropped");

  it("does not read the mass close as remediation, and does not read it as 'clear'", () => {
    expect(asset.open_findings).toBe(0);
    expect(asset.verdict).toBe("unobserved"); // NOT "clear": coverage is decided first
    expect(asset.bucket).toBeNull();
    expect(out.totals!.clear_assets).toBe(0);
    expect(out.totals!.warm_assets).toBe(0);
  });

  it("publishes the drop-out's fingerprint: the modal instant and its count", () => {
    expect(asset.disappeared_at).toBe(iso(1));
    expect(asset.disappeared_at_last_observation).toBe(5);
  });

  it("keeps the disappearance out of the group's last movement", () => {
    // The group rolls movement over OBSERVED assets only — a scanner event is not this
    // group's work, and must not refresh their date.
    expect(groupOf(out, "platform").last_movement_at).toBeNull();
    expect(groupOf(out, "platform").assets_unobserved).toBe(1);
  });

  // THE TWO KINDS OF OUT OF SIGHT. This asset is the benign one: the scanner lost it and there
  // is nothing open on it, which on a mature register describes a decommissioned machine. It
  // is counted apart from the alarming kind — lost sight of WITH backlog still open — because
  // a census that drew them as one segment made a healthy register look like a coverage
  // catastrophe (1,947 of 2,404 on the tenant that prompted the split).
  it("counts a nothing-open drop-out as the benign half of unobserved", () => {
    expect(out.totals!.assets_unobserved).toBe(1);
    expect(out.totals!.assets_unobserved_clear).toBe(1);
    expect(out.totals!.assets_unobserved_open).toBe(0);
    expect(out.totals!.open_in_unobserved).toBe(0);
  });
});

describe("a drop-out that still carries open findings is the half worth the alarm", () => {
  // Same disappearance, except one finding never closed: the scanner stopped returning the
  // asset while backlog was still on it, so nobody will be told about that backlog again.
  const out = profile([
    row({
      asset_id: "asset-stranded", asset_name: "stranded", last_scan_id: "scan-1",
      status: "RESOLVED", resolution_src: RESOLUTION_DISAPPEARED, resolved_at: back(1),
    }),
    row({ asset_id: "asset-stranded", asset_name: "stranded", last_scan_id: "scan-1" }),
  ]);

  it("splits it away from the decommissioned kind, and both still sum to the whole", () => {
    const t = out.totals!;
    expect(assetOf(out, "asset-stranded").verdict).toBe("unobserved");
    expect(t.assets_unobserved).toBe(1);
    expect(t.assets_unobserved_open).toBe(1);
    expect(t.assets_unobserved_clear).toBe(0);
    expect(t.assets_unobserved_open + t.assets_unobserved_clear).toBe(t.assets_unobserved);
    expect(t.open_in_unobserved).toBe(1);
  });

  it("still never counts it as cold, warm or clear — the verdict did not split", () => {
    const t = out.totals!;
    expect(t.cold_assets).toBe(0);
    expect(t.warm_assets).toBe(0);
    expect(t.clear_assets).toBe(0);
    expect(t.assets_with_open).toBe(0);
  });
});

// --------------------------------------------------------------------- unclassified rows

describe("unclassified rows count as open findings and never as high risk", () => {
  const out = profile([
    row({ has_kev: null }),
    row({ has_kev: null, has_exploit: null, epss: null }),
    highRisk(),
    row({ status: "RESOLVED", resolved_at: back(10) }),
  ]);
  const asset = assetOf(out, "asset-1");

  it("counts them as open findings but never as high risk", () => {
    expect(asset.open_findings).toBe(3);
    expect(asset.open_high_risk).toBe(1); // the KEV row only
    expect(out.unclassified_rows).toBe(2);
    // A missing signal is not an observed negative, so the gap is published as a figure
    // rather than quietly shrinking the "high risk sitting cold" numerator.
    expect(out.totals!.open_findings).toBe(3);
  });

  it("reads movement regardless of status, so a merged shard cannot freeze a live asset", () => {
    // `isOpenStatus` deliberately reads an unfamiliar status as OPEN, and an imported shard
    // can carry a resolved_at under one. A close that happened is remediation work whatever
    // the status column ended up saying.
    const merged = profile([
      row({ status: "OPEN", resolved_at: back(10) }),
      row(),
    ]);
    const a = assetOf(merged, "asset-1");
    expect(a.idle_days).toBeCloseTo(10, 9);
    expect(a.verdict).toBe("warm");
    expect(a.open_findings).toBe(2);
  });

  it("makes every row unclassified when the operator's rule enables no signal at all", () => {
    const emptyRule: RiskRule = { kev: false, exploit: false, epss: false, epssThreshold: 0.1 };
    const none = profile([highRisk(), row(), row({ status: "RESOLVED", resolved_at: back(10) })], {
      rule: emptyRule,
    });
    expect(none.unclassified_rows).toBe(3);
    expect(assetOf(none, "asset-1").open_high_risk).toBe(0);
    expect(assetOf(none, "asset-1").open_findings).toBe(2);
  });
});

// --------------------------------------------------------------------------- groups

describe("the null support group is a real group row, not a drop", () => {
  const absent = row({ asset_id: "asset-orphan", asset_name: "orphan" });
  delete (absent as { _supportGroup?: unknown })._supportGroup;
  const out = profile([
    absent,
    row({ asset_id: "asset-orphan", asset_name: "orphan", _supportGroup: null }),
    row({ asset_id: "asset-orphan", asset_name: "orphan", _supportGroup: "" }),
    row({ asset_id: "asset-owned", asset_name: "owned", status: "RESOLVED", resolved_at: back(5) }),
    row({ asset_id: "asset-owned", asset_name: "owned" }),
  ]);

  it("treats absent, null and blank alike — the join is live, not a stored column", () => {
    expect(assetOf(out, "asset-orphan").support_group).toBeNull();
  });

  it("labels it, keeps it, and publishes the attribution gap as a figure", () => {
    const orphan = groupOf(out, COLD_GROUP_NONE);
    expect(COLD_GROUP_NONE).toBe("(no support group)");
    expect(orphan.support_group).toBeNull();
    expect(orphan.assets).toBe(1);
    expect(orphan.open_findings).toBe(3);
    expect(out.totals!.assets_no_support_group).toBe(1);
    expect(out.totals!.groups).toBe(2);
  });

  it("sorts it by the same rule as every other group — never pinned last", () => {
    // The orphan is cold (no movement, 200 d bound); the owned asset is warm. Cold first.
    expect(out.groups!.map((g) => g.label)).toEqual([COLD_GROUP_NONE, "platform"]);
  });
});

describe("the four group verdicts", () => {
  const coldAsset = (id: string, group: string) =>
    row({ asset_id: id, asset_name: id, _supportGroup: group, first_seen: back(300) });
  const warmAsset = (id: string, group: string) => [
    row({ asset_id: id, asset_name: id, _supportGroup: group }),
    row({
      asset_id: id,
      asset_name: id,
      _supportGroup: group,
      status: "RESOLVED",
      resolved_at: back(5),
    }),
  ];
  const clearAsset = (id: string, group: string) =>
    row({
      asset_id: id,
      asset_name: id,
      _supportGroup: group,
      status: "RESOLVED",
      resolved_at: back(5),
    });

  const out = profile([
    coldAsset("a1", "alpha"),
    coldAsset("a2", "alpha"),
    coldAsset("b1", "beta"),
    ...warmAsset("b2", "beta"),
    ...warmAsset("g1", "gamma"),
    clearAsset("d1", "delta"),
  ]);

  it("fully-cold when every asset with open findings is cold", () => {
    const alpha = groupOf(out, "alpha");
    expect(alpha.verdict).toBe("fully-cold");
    expect(alpha.cold_assets).toBe(2);
    expect(alpha.assets_with_open).toBe(2);
    expect(alpha.cold_share_pct).toBe(100);
  });

  it("partly-cold when some are", () => {
    const beta = groupOf(out, "beta");
    expect(beta.verdict).toBe("partly-cold");
    expect(beta.cold_assets).toBe(1);
    expect(beta.assets_with_open).toBe(2);
    expect(beta.cold_share_pct).toBe(50);
    expect(beta.last_movement_at).toBe(iso(5));
  });

  it("warm when none are", () => {
    const gamma = groupOf(out, "gamma");
    expect(gamma.verdict).toBe("warm");
    expect(gamma.cold_assets).toBe(0);
    expect(gamma.cold_share_pct).toBe(0);
  });

  it("clear when nothing is open — and the share is NULL, not 0%", () => {
    const delta = groupOf(out, "delta");
    expect(delta.verdict).toBe("clear");
    expect(delta.assets_with_open).toBe(0);
    expect(delta.clear_assets).toBe(1);
    expect(delta.cold_share_pct).toBeNull();
  });

  it("totals the group verdicts and sorts cold assets first", () => {
    const t = out.totals!;
    expect(t.groups).toBe(4);
    expect(t.groups_fully_cold).toBe(1);
    expect(t.groups_partly_cold).toBe(1);
    // cold_assets desc, then open_in_cold desc, then label asc — gamma and delta tie at zero.
    expect(out.groups!.map((g) => g.label)).toEqual(["alpha", "beta", "delta", "gamma"]);
    // Assets: cold, unobserved, watching, warm, clear — then open desc, then name.
    expect(out.assets!.map((a) => a.verdict)).toEqual([
      "cold", "cold", "cold", "warm", "warm", "clear",
    ]);
  });
});

// --------------------------------------------------------------------------- buckets

describe("buckets are thirds of the threshold, and bucket 3 IS the cold column", () => {
  const idleFor = (id: string, days: number) => [
    row({ asset_id: id, asset_name: id, first_seen: back(300) }),
    row({
      asset_id: id,
      asset_name: id,
      first_seen: back(300),
      status: "RESOLVED",
      resolved_at: back(days),
    }),
  ];
  const out = profile([
    ...idleFor("b0", 10),
    ...idleFor("b1", 40),
    ...idleFor("b2", 70),
    ...idleFor("b3", 120),
    row({ asset_id: "b4", asset_name: "b4", first_seen: back(20) }), // no movement, bound 20 d
  ]);

  it("publishes five labelled columns with the ≥ sign on the last measured one", () => {
    expect(out.bucket_edges).toEqual([0, 30, 60, 90]);
    expect(out.bucket_labels).toEqual([
      "0–30 d", "30–60 d", "60–90 d", "≥ 90 d", "not yet measurable",
    ]);
    expect(out.bucket_labels!.some((l) => l.includes(">"))).toBe(false);
  });

  it("places one asset in each, and buckets[3] equals cold_assets", () => {
    expect(out.assets!.map((a) => [a.asset_id, a.bucket]).sort()).toEqual([
      ["b0", 0], ["b1", 1], ["b2", 2], ["b3", 3], ["b4", 4],
    ]);
    const t = out.totals!;
    expect(t.buckets).toEqual([1, 1, 1, 1, 1]);
    expect(t.buckets.length).toBe(5);
    expect(t.buckets[3]).toBe(t.cold_assets);
    expect(t.bucket_open).toEqual([1, 1, 1, 1, 1]); // one open finding per asset
  });

  it("moves the edges with the threshold", () => {
    const wide = profile([...idleFor("b3", 120)], { coldAfterDays: 120 });
    expect(wide.bucket_edges).toEqual([0, 40, 80, 120]);
    expect(wide.bucket_labels).toEqual([
      "0–40 d", "40–80 d", "80–120 d", "≥ 120 d", "not yet measurable",
    ]);
    // 120 d idle is exactly the new threshold — still bucket 3, still cold.
    expect(assetOf(wide, "b3").bucket).toBe(3);
    expect(wide.totals!.buckets[3]).toBe(wide.totals!.cold_assets);
  });

  it("keeps the settings guardrails on record beside the default", () => {
    expect(DEFAULT_COLD_AFTER_DAYS).toBe(90);
    expect(COLD_AFTER_DAYS_MIN).toBe(7);
    expect(COLD_AFTER_DAYS_MAX).toBe(365);
  });
});

// --------------------------------------------------------------------- drops and refusals

describe("rows with no asset are dropped AND counted", () => {
  const out = profile([
    row({ asset_id: "asset-1" }),
    row({ asset_id: "asset-2" }),
    row({ asset_id: null }),
    row({ asset_id: "" }),
    row({ asset_id: "   " }),
  ]);

  it("counts the three it could not place", () => {
    expect(out.dropped_no_asset).toBe(3);
    expect(out.row_count).toBe(5);
  });

  it("leaves them out of every figure — no phantom asset row", () => {
    expect(out.assets!.map((a) => a.asset_id).sort()).toEqual(["asset-1", "asset-2"]);
    expect(out.totals!.assets).toBe(2);
    expect(out.totals!.open_findings).toBe(2);
  });
});

describe("an unparseable clock refuses rather than casting", () => {
  it("throws on `now`", () => {
    expect(() => profile([row()], { now: "not-a-date" })).toThrow(/unparseable now/);
  });

  it("throws on a non-null `observedFrom`", () => {
    expect(() => profile([row()], { observedFrom: "yesterday" })).toThrow(/unparseable observedFrom/);
  });

  it("throws on a threshold the settings clamp could not have produced", () => {
    expect(() => profile([row()], { coldAfterDays: 0 })).toThrow(/positive number/);
    expect(() => profile([row()], { coldAfterDays: Number.NaN })).toThrow(/positive number/);
  });
});

// --------------------------------------------------------------------------- projections

describe("coldZoneHeadline is the Executive slice, capped in the model", () => {
  const out = profile([
    row({ asset_id: "asset-cold", asset_name: "cold", first_seen: back(300) }),
    row({ asset_id: "asset-warm", asset_name: "warm" }),
    row({
      asset_id: "asset-warm",
      asset_name: "warm",
      status: "RESOLVED",
      resolved_at: back(5),
    }),
  ]);
  const head = coldZoneHeadline(out);

  it("carries no per-asset or per-group array", () => {
    expect(Object.keys(head).sort()).toEqual([
      "achieved_share_pct", "as_of", "cold_after_days", "cold_bound_only", "derived_days",
      "dropped_no_asset", "eligible_assets", "fixed_after_days", "floor_applied", "floor_days",
      "measurable", "mode", "observed_from", "row_count", "severities_without_scan",
      "target_share_pct", "totals", "unclassified_rows",
    ]);
    expect("assets" in head).toBe(false);
    expect("groups" in head).toBe(false);
  });

  it("carries the one number the Executive card draws, plus its clock", () => {
    expect(head.totals!.cold_backlog_share_pct).toBe(50); // 1 of 2 open findings
    expect(head.totals!.cold_assets).toBe(1);
    expect(head.totals!.assets_with_open).toBe(2);
    expect(head.cold_after_days).toBe(90);
    expect(head.as_of).toBe(AS_OF);
    expect(head.observed_from).toBe(iso(400));
  });

  it("passes the refusal through unchanged", () => {
    const none = coldZoneHeadline(profile([row()], { observedFrom: null }));
    expect(none.measurable).toBe(false);
    expect(none.totals).toBeNull();
    expect(none.row_count).toBe(1);
  });
});

// --------------------------------------------------------------- undecidable observation

describe("a severity with rows but no flat scan on record is undecidable, not stale", () => {
  const out = profile(
    [
      row({ asset_id: "asset-med", severity: "MEDIUM", last_scan_id: "scan-med-3" }),
      row({ asset_id: "asset-mixed", severity: "HIGH", last_scan_id: "scan-1" }),
      row({ asset_id: "asset-mixed", severity: "LOW", last_scan_id: "scan-low-2" }),
    ],
    { newestScanBySeverity: { HIGH: NEWEST_HIGH } },
  );

  it("keeps the asset observed — doubt falls away from accusing a support group", () => {
    expect(assetOf(out, "asset-med").observed).toBe(true);
    expect(assetOf(out, "asset-med").verdict).toBe("cold"); // bound past the threshold
  });

  it("names every severity whose observation it could not decide, sorted", () => {
    expect(out.severities_without_scan).toEqual(["LOW", "MEDIUM"]);
  });

  it("observes a mixed asset through whichever severity still reaches its newest scan", () => {
    // asset-mixed's HIGH rows are stale, but LOW has no flat scan on record at all, so
    // observation stays true rather than reading a HIGH-only sweep as a disappearance.
    expect(assetOf(out, "asset-mixed").observed).toBe(true);
  });

  it("marks it unobserved once every one of its severities has a scan it does not reach", () => {
    const decided = profile(
      [
        row({ asset_id: "asset-mixed", severity: "HIGH", last_scan_id: "scan-1" }),
        row({ asset_id: "asset-mixed", severity: "LOW", last_scan_id: "scan-low-2" }),
      ],
      {
        newestScanBySeverity: {
          HIGH: NEWEST_HIGH,
          LOW: { scan_id: "scan-low-9", ts: AS_OF },
        },
      },
    );
    expect(assetOf(decided, "asset-mixed").observed).toBe(false);
    expect(decided.severities_without_scan).toEqual([]);
  });
});

describe("a CRITICAL-only sweep does not make HIGH assets unobserved", () => {
  // THE reason the map is keyed by severity rather than holding one newest scan. This
  // register syncs a chosen set of severities, and `reconcile` already refuses to read the
  // absence of an unscanned severity as a resolution ("absence is expected, not resolution").
  // Keyed on the single newest scan — the CRITICAL-only one at `AS_OF` — every HIGH asset
  // below would read `unobserved` the morning after, and the page would contradict the
  // register's own rule about the same rows.
  const NEWEST = {
    CRITICAL: { scan_id: "scan-crit-9", ts: AS_OF },
    HIGH: { scan_id: "scan-high-8", ts: back(1) },
  };
  const out = profile(
    [
      row({ asset_id: "asset-crit", severity: "CRITICAL", last_scan_id: "scan-crit-9" }),
      row({ asset_id: "asset-high", severity: "HIGH", last_scan_id: "scan-high-8" }),
      row({ asset_id: "asset-stale", severity: "HIGH", last_scan_id: "scan-high-7" }),
    ],
    { newestScanBySeverity: NEWEST },
  );

  it("keeps an asset observed through the newest scan that covered ITS severity", () => {
    expect(assetOf(out, "asset-crit").observed).toBe(true);
    expect(assetOf(out, "asset-high").observed).toBe(true);
    expect(assetOf(out, "asset-high").verdict).not.toBe("unobserved");
    expect(out.severities_without_scan).toEqual([]);
  });

  it("still marks an asset the HIGH sweep itself stopped returning", () => {
    // The severity's own newest scan is the test, so a HIGH asset that missed the HIGH scan
    // is unobserved — the per-severity rule loosens nothing, it only asks the right question.
    expect(assetOf(out, "asset-stale").observed).toBe(false);
    expect(assetOf(out, "asset-stale").verdict).toBe("unobserved");
    expect(out.totals!.assets_unobserved).toBe(1);
  });
});

describe("an uncovered severity is undecidable, and the map is flat-scan-only by construction", () => {
  // The map handed in carries FLAT scans only: a grouped scan writes no per-finding
  // observations (`ledgerCore.persistGroupedScan`), so it could never tell us whether an
  // asset was returned. That filter lives in the server, which builds the map; this module
  // takes the map as given, and a severity missing from it is undecidable rather than stale.
  const out = profile(
    [
      row({ asset_id: "asset-info", severity: "INFO", last_scan_id: "scan-old" }),
      row({ asset_id: "asset-blank", severity: "", last_scan_id: "scan-old" }),
      row({ asset_id: "asset-high", severity: "HIGH", last_scan_id: "scan-9" }),
    ],
    { newestScanBySeverity: { HIGH: NEWEST_HIGH } },
  );

  it("resolves the doubt to observed and names the severities, normalized and sorted", () => {
    expect(assetOf(out, "asset-info").observed).toBe(true);
    expect(assetOf(out, "asset-blank").observed).toBe(true);
    expect(out.severities_without_scan).toEqual(["INFO", "UNKNOWN"]);
    expect(out.totals!.assets_unobserved).toBe(0);
  });

  it("leaves a covered severity out of the list", () => {
    expect(out.severities_without_scan).not.toContain("HIGH");
    expect(assetOf(out, "asset-high").observed).toBe(true);
  });
});

// ===================================================================================
// RELATIVE MODE — the line derived from the estate instead of named by the operator.
//
// Every case below writes the arithmetic out, because the whole point of a derived line is
// that it is reproducible: `k = min(n, max(1, ceil(target/100 × n)))`, the line is the k-th
// LARGEST reading floored to whole days, and the effective line is `max(derived, floor)`.
// What each block is guarding:
//
//   the rank, not a quantile   `util.quantile` interpolates. An interpolated line sits on no
//                              asset and turns a "20% cut" into an unpredictable count at
//                              small n. These cases pin the exact k, the exact line and the
//                              exact count, so an interpolating implementation fails them.
//   ties at the cutoff         all cold, because the test stays `>=`. The achieved share then
//                              exceeds the target, and that is published rather than hidden.
//   the floor                  a share always names somebody. The floor is what stops "the
//                              idlest 20%" being a slander on a well-tended estate — and when
//                              it holds, `derived_days`/`floor_applied` say so and the
//                              achieved share is a REAL zero over a real denominator.
//   the bound                  an asset that never closed anything ranks at its LOWER bound,
//                              which under-states its silence. `cold_bound_only` is the
//                              published cost of that.
//   the group badge            a relative position, clamped so a group with nothing cold is
//                              never marked, and extended through ties so the alphabet never
//                              decides who is badged.

/** An asset with a MEASURED idle time of exactly `days`: one open row, one closed then. */
const idleAsset = (id: string, days: number, group = "platform"): ColdRow[] => [
  row({ asset_id: id, asset_name: id, _supportGroup: group, first_seen: back(390) }),
  row({
    asset_id: id,
    asset_name: id,
    _supportGroup: group,
    first_seen: back(390),
    status: "RESOLVED",
    resolved_at: back(days),
  }),
];

/** Relative mode at the product defaults: the idlest 20%, never above a 14-day floor. */
const relativeProfile = (rows: ColdRow[], over: Partial<ColdZoneOptions> = {}): ColdZoneResult =>
  profile(rows, { mode: "relative", targetSharePct: 20, floorDays: 14, ...over });

describe("fixed mode is untouched, and the new fields say so", () => {
  const out = profile([...idleAsset("cold-1", 120), ...idleAsset("warm-1", 10)]);

  it("keeps the operator's window as the effective line and nulls every relative field", () => {
    expect(out.mode).toBe("fixed");
    expect(out.cold_after_days).toBe(90); // the EFFECTIVE line — here, the window itself
    expect(out.fixed_after_days).toBe(90);
    expect(out.target_share_pct).toBeNull(); // nothing was aimed at
    expect(out.floor_days).toBeNull();
    expect(out.floor_applied).toBe(false);
    expect(out.derived_days).toBeNull(); // nothing was derived — not "derived at zero"
    expect(out.bucket_edges).toEqual([0, 30, 60, 90]);
    expect(out.totals!.cold_assets).toBe(1);
    // The share is still published in fixed mode, so target and achieved read side by side.
    expect(out.achieved_share_pct).toBe(50);
    expect(out.achieved_share_pct).toBe(out.totals!.cold_asset_share_pct);
    expect(out.eligible_assets).toBe(2);
    expect(out.cold_bound_only).toBe(0);
    expect(out.totals!.groups_in_coldest_share).toBe(0);
    // The guardrails the settings clamp reads, on record beside the defaults.
    expect(DEFAULT_COLD_ZONE_MODE).toBe("fixed");
    expect([...COLD_ZONE_MODES]).toEqual(["fixed", "relative"]);
    expect(DEFAULT_COLD_TARGET_SHARE_PCT).toBe(20);
    expect([COLD_TARGET_SHARE_PCT_MIN, COLD_TARGET_SHARE_PCT_MAX]).toEqual([1, 50]);
    expect(DEFAULT_COLD_FLOOR_DAYS).toBe(14);
    expect([COLD_FLOOR_DAYS_MIN, COLD_FLOOR_DAYS_MAX]).toEqual([1, COLD_AFTER_DAYS_MAX]);
  });
});

describe("the derived line is the k-th largest reading, and k is arithmetic anyone can check", () => {
  // Five eligible assets, idle 50 / 40 / 30 / 20 / 10 days. Sorted descending, the readings
  // are [50, 40, 30, 20, 10] and every case below indexes into that one list.
  const five = [
    ...idleAsset("r50", 50),
    ...idleAsset("r40", 40),
    ...idleAsset("r30", 30),
    ...idleAsset("r20", 20),
    ...idleAsset("r10", 10),
  ];

  it("cuts at k = 1 for 20% of 5, and at k = 2 for 40% — exactly, with no interpolation", () => {
    // ceil(0.20 × 5) = 1 ⇒ readings[0] = 50. An interpolated 80th percentile would land at
    // 42 and catch the same one asset by luck; at 40% the two rules disagree outright.
    const at20 = relativeProfile(five);
    expect(at20.derived_days).toBe(50);
    expect(at20.cold_after_days).toBe(50);
    expect(at20.floor_applied).toBe(false);
    expect(at20.totals!.cold_assets).toBe(1);
    expect(at20.achieved_share_pct).toBe(20);
    expect(assetOf(at20, "r50").cold).toBe(true);
    expect(assetOf(at20, "r40").verdict).toBe("warm");

    // ceil(0.40 × 5) = 2 ⇒ readings[1] = 40. The line sits ON r40, which is therefore cold:
    // the test is `>=`, so the asset that defines the line is inside the zone.
    const at40 = relativeProfile(five, { targetSharePct: 40 });
    expect(at40.derived_days).toBe(40);
    expect(at40.cold_after_days).toBe(40);
    expect(at40.totals!.cold_assets).toBe(2);
    expect(at40.achieved_share_pct).toBe(40);
    expect(assetOf(at40, "r40").cold).toBe(true);
  });

  it("never cuts at k = 0: one to four assets at 20% all give k = 1", () => {
    // ceil(0.2 × n) is 1 for n = 1..5, and `max(1, …)` would rescue it if it were not —
    // a cut at k = 0 has no reading to stand on and would make the line undefined.
    const pool = [idleAsset("a", 100), idleAsset("b", 80), idleAsset("c", 60), idleAsset("d", 40)];
    for (const n of [1, 2, 3, 4]) {
      const out = relativeProfile(pool.slice(0, n).flat());
      expect(out.eligible_assets).toBe(n);
      expect(out.derived_days).toBe(100); // readings[0] every time
      expect(out.cold_after_days).toBe(100);
      expect(out.totals!.cold_assets).toBe(1);
      expect(out.achieved_share_pct).toBeCloseTo(100 / n, 9);
    }
  });

  it("puts every asset tied AT the cutoff inside the zone, and reports the overshoot", () => {
    // readings [100, 100, 50, 20], k = ceil(0.2 × 4) = 1 ⇒ the line is 100 — and BOTH assets
    // at 100 are cold, because splitting a tie would need a ">" the register does not use.
    // The achieved share (50%) then exceeds the 20% asked for, and says so.
    const out = relativeProfile([
      ...idleAsset("tie-a", 100),
      ...idleAsset("tie-b", 100),
      ...idleAsset("mid", 50),
      ...idleAsset("low", 20),
    ]);
    expect(out.derived_days).toBe(100);
    expect(out.totals!.cold_assets).toBe(2);
    expect(out.target_share_pct).toBe(20);
    expect(out.achieved_share_pct).toBe(50);
    expect(out.achieved_share_pct!).toBeGreaterThan(out.target_share_pct!);
    expect(assetOf(out, "tie-a").cold).toBe(true);
    expect(assetOf(out, "tie-b").cold).toBe(true);
  });

  it("floors the line to whole days, which can only ever widen the zone", () => {
    // readings [50.7, 50.2, 20], k = 1 ⇒ the raw cut is 50.7, published as 50. The asset at
    // 50.2 is then cold too: cold_assets (2) >= k (1), never fewer. A fractional line would
    // make `fmtDays` prose and the "≥ N d" cells disagree about the same number.
    const out = relativeProfile([
      ...idleAsset("f1", 50.7),
      ...idleAsset("f2", 50.2),
      ...idleAsset("f3", 20),
    ]);
    expect(out.derived_days).toBe(50);
    expect(Number.isInteger(out.derived_days!)).toBe(true);
    expect(out.cold_after_days).toBe(50);
    expect(out.totals!.cold_assets).toBe(2);
    expect(out.bucket_labels![3]).toBe("≥ 50 d");
  });
});

describe("the floor is what stops a share being a slander on a healthy estate", () => {
  it("holds the line, publishes the line it refused, and reports a REAL zero", () => {
    // Everything here was touched inside a fortnight: readings [10, 8, 6, 4, 2], k = 1, so the
    // idlest 20% would be "idle for 10 days". The 14-day floor overrules it, nothing is cold,
    // and 0% is a measured answer over five assets — not the null of an empty estate.
    const out = relativeProfile([
      ...idleAsset("h1", 10),
      ...idleAsset("h2", 8),
      ...idleAsset("h3", 6),
      ...idleAsset("h4", 4),
      ...idleAsset("h5", 2),
    ]);
    expect(out.derived_days).toBe(10);
    expect(out.floor_days).toBe(14);
    expect(out.floor_applied).toBe(true);
    expect(out.cold_after_days).toBe(14); // the EFFECTIVE line is the floor
    expect(out.totals!.cold_assets).toBe(0);
    expect(out.eligible_assets).toBe(5);
    expect(out.achieved_share_pct).toBe(0);
    expect(out.achieved_share_pct).not.toBeNull();
  });

  it("does not claim the floor applied when the derived line lands exactly on it", () => {
    // readings [14, 5, 5, 5, 5], k = 1 ⇒ derived 14 = the floor. `max` is the same number
    // either way, so the only thing at stake is the page's sentence: the estate produced this
    // line, the floor did not have to hold it, and `floor_applied` must not say otherwise.
    const out = relativeProfile([
      ...idleAsset("e1", 14),
      ...idleAsset("e2", 5),
      ...idleAsset("e3", 5),
      ...idleAsset("e4", 5),
      ...idleAsset("e5", 5),
    ]);
    expect(out.derived_days).toBe(14);
    expect(out.cold_after_days).toBe(14);
    expect(out.floor_applied).toBe(false);
    expect(out.totals!.cold_assets).toBe(1); // 14 >= 14, the edge is inclusive as ever
  });

  it("rests on the floor with NULLS, not zeros, when there is nothing to rank", () => {
    // One asset with nothing open (clear) and one the scanner lost (unobserved): neither is
    // eligible, so no line can be derived. `derived_days` is null — "not derived" is not
    // "derived at zero" — and the share is null over an empty denominator.
    const out = relativeProfile([
      row({ asset_id: "clear-1", asset_name: "clear-1", status: "RESOLVED", resolved_at: back(5) }),
      row({ asset_id: "gone-1", asset_name: "gone-1", last_scan_id: "scan-1" }),
    ]);
    expect(out.eligible_assets).toBe(0);
    expect(out.derived_days).toBeNull();
    expect(out.floor_applied).toBe(false); // the floor overruled nothing; it is simply all there is
    expect(out.cold_after_days).toBe(14);
    expect(out.achieved_share_pct).toBeNull();
    expect(out.totals!.cold_assets).toBe(0);
    expect(out.bucket_edges).toEqual([0, 14 / 3, 28 / 3, 14]);
  });
});

describe("an asset that never closed anything ranks at its lower bound, and the cost is printed", () => {
  it("ranks bounds beside measurements and counts the cold ones that were never measured", () => {
    // No movement anywhere: each asset's reading is its BOUND — the later of observedFrom
    // (400 d) and its own first_seen. readings [300, 100, 30], k = 1 ⇒ the line is 300, and the
    // one asset at 300 is cold by rule 4. Every cold asset here is a bound, so
    // `cold_bound_only` equals `cold_assets`: the page can say the whole zone is a lower bound.
    const out = relativeProfile([
      row({ asset_id: "b300", asset_name: "b300", first_seen: back(300) }),
      row({ asset_id: "b100", asset_name: "b100", first_seen: back(100) }),
      row({ asset_id: "b30", asset_name: "b30", first_seen: back(30) }),
    ]);
    expect(out.eligible_assets).toBe(3);
    expect(out.derived_days).toBe(300);
    expect(out.cold_after_days).toBe(300);
    expect(assetOf(out, "b300").idle_is_bound).toBe(true);
    expect(assetOf(out, "b300").idle_days).toBeNull();
    expect(assetOf(out, "b300").idle_reading_days).toBeCloseTo(300, 9);
    expect(assetOf(out, "b300").verdict).toBe("cold");
    expect(out.totals!.cold_assets).toBe(1);
    expect(out.cold_bound_only).toBe(1);
    expect(out.cold_bound_only).toBe(out.totals!.cold_assets);
    // The two that did not make the line are still "watching", not warm: nothing was measured.
    expect(assetOf(out, "b100").verdict).toBe("watching");
  });
});

describe("the effective line — whoever drew it — is the only threshold anything downstream reads", () => {
  it("moves the bucket edges with the derived line and keeps buckets[3] === cold_assets", () => {
    // readings [50, 40, 30, 20, 10] at 40% ⇒ the line is 40, so the edges are thirds of 40
    // and the cold column is the fourth bucket, exactly as it is under a fixed window.
    const out = relativeProfile(
      [
        ...idleAsset("r50", 50),
        ...idleAsset("r40", 40),
        ...idleAsset("r30", 30),
        ...idleAsset("r20", 20),
        ...idleAsset("r10", 10),
      ],
      { targetSharePct: 40 },
    );
    expect(out.cold_after_days).toBe(40);
    expect(out.bucket_edges).toEqual([0, 40 / 3, 80 / 3, 40]);
    expect(out.bucket_labels![3]).toBe("≥ 40 d");
    expect(out.bucket_labels!.some((l) => l.includes(">"))).toBe(false);
    expect(out.totals!.buckets).toEqual([1, 1, 1, 2, 0]);
    expect(out.totals!.buckets[3]).toBe(out.totals!.cold_assets);
    // The fixed window it was NOT measured against is still on record beside it.
    expect(out.fixed_after_days).toBe(90);
  });

  it("counts exactly the assets the existing rollup already calls open-and-observed", () => {
    // `eligible_assets` must be `assets_with_open`, or the share is a share of something the
    // table does not show. Two measured, one bound-only ("watching" — still eligible), one
    // clear, one lost to the scanner.
    const out = relativeProfile([
      ...idleAsset("m60", 60),
      ...idleAsset("m10", 10),
      row({ asset_id: "young", asset_name: "young", first_seen: back(5) }),
      row({ asset_id: "clear-1", asset_name: "clear-1", status: "RESOLVED", resolved_at: back(5) }),
      row({ asset_id: "gone-1", asset_name: "gone-1", last_scan_id: "scan-1" }),
    ]);
    expect(out.eligible_assets).toBe(3);
    expect(out.eligible_assets).toBe(out.totals!.assets_with_open);
    expect(out.totals!.clear_assets).toBe(1);
    expect(out.totals!.assets_unobserved).toBe(1);
    // readings [60, 10, 5], k = ceil(0.6) = 1 ⇒ the line is 60 and only m60 is cold.
    expect(out.derived_days).toBe(60);
    expect(out.totals!.cold_assets).toBe(1);
  });

  it("publishes the achieved share against the target in BOTH directions", () => {
    // Above, because ties at the cutoff widen the zone; below, because the floor narrows it.
    // Neither is an error, and neither may be reported as "20%".
    const over = relativeProfile([
      ...idleAsset("t1", 100),
      ...idleAsset("t2", 100),
      ...idleAsset("t3", 50),
      ...idleAsset("t4", 20),
    ]);
    expect(over.achieved_share_pct!).toBeGreaterThan(over.target_share_pct!);

    const under = relativeProfile([
      ...idleAsset("u1", 10),
      ...idleAsset("u2", 8),
      ...idleAsset("u3", 6),
      ...idleAsset("u4", 4),
      ...idleAsset("u5", 2),
    ]);
    expect(under.achieved_share_pct!).toBeLessThan(under.target_share_pct!);
    expect(under.floor_applied).toBe(true);
  });
});

describe("relative mode refuses the options it cannot guess", () => {
  const rows = idleAsset("r1", 100);

  it("throws on a missing target, a missing floor and an unknown mode — and still on the window", () => {
    expect(() => profile(rows, { mode: "relative", floorDays: 14 })).toThrow(/targetSharePct/);
    expect(() => profile(rows, { mode: "relative", targetSharePct: 20 })).toThrow(/floorDays/);
    expect(() => profile(rows, { mode: "warm" as ColdZoneMode, targetSharePct: 20, floorDays: 14 }))
      .toThrow(/mode must be one of/);
    // A share of nothing or of everything-and-more is not a share the settings clamp can emit.
    expect(() => relativeProfile(rows, { targetSharePct: 0 })).toThrow(/targetSharePct/);
    expect(() => relativeProfile(rows, { targetSharePct: 101 })).toThrow(/targetSharePct/);
    expect(() => relativeProfile(rows, { floorDays: 0 })).toThrow(/floorDays/);
    // The window guard stays UNCONDITIONAL: relative mode still publishes `fixed_after_days`,
    // so a nonsense window would be published even though it drew no line.
    expect(() => relativeProfile(rows, { coldAfterDays: 0 })).toThrow(/positive number/);
    expect(() => relativeProfile(rows, { coldAfterDays: Number.NaN })).toThrow(/positive number/);
  });
});

// ------------------------------------------------------------------ the group-level rank

describe("the coldest support groups are ranked on their cold SHARE, not on their size", () => {
  // Six eligible assets. readings [200, 200, 150, 5, 5, 5], k = ceil(0.2 × 6) = 2 ⇒ the line
  // is readings[1] = 200, so a1 and b1 are cold.
  //   beta   1 of 1 cold  = 100%   rank 1
  //   alpha  1 of 2 cold  =  50%   rank 2
  //   gamma  0 of 3 cold  =   0%   rank 3
  //   delta  nothing open         rank NULL — it is not in the race
  const rows = [
    ...idleAsset("a1", 200, "alpha"),
    ...idleAsset("a2", 5, "alpha"),
    ...idleAsset("b1", 200, "beta"),
    ...idleAsset("g1", 150, "gamma"),
    ...idleAsset("g2", 5, "gamma"),
    ...idleAsset("g3", 5, "gamma"),
    row({
      asset_id: "d1",
      asset_name: "d1",
      _supportGroup: "delta",
      status: "RESOLVED",
      resolved_at: back(5),
    }),
  ];
  const out = relativeProfile(rows);

  it("ranks by cold share, leaves a group with nothing open unranked, and badges the coldest", () => {
    expect(out.cold_after_days).toBe(200);
    expect(groupOf(out, "beta").cold_share_pct).toBe(100);
    expect(groupOf(out, "beta").relative_rank).toBe(1);
    expect(groupOf(out, "alpha").cold_share_pct).toBe(50);
    expect(groupOf(out, "alpha").relative_rank).toBe(2);
    expect(groupOf(out, "gamma").relative_rank).toBe(3);
    expect(groupOf(out, "delta").relative_rank).toBeNull();
    expect(groupOf(out, "delta").cold_share_pct).toBeNull();
    // want = min(C = 2, max(1, ceil(0.2 × 3) = 1)) = 1 ⇒ the single coldest group.
    expect(groupOf(out, "beta").in_coldest_share).toBe(true);
    expect(groupOf(out, "alpha").in_coldest_share).toBe(false);
    expect(groupOf(out, "gamma").in_coldest_share).toBe(false);
    expect(groupOf(out, "delta").in_coldest_share).toBe(false);
    expect(out.totals!.groups_in_coldest_share).toBe(1);
  });

  it("does not reorder the published table — the rank is a column, not the sort", () => {
    // The table is still ordered cold assets desc, open-in-cold desc, label asc. alpha and
    // beta tie on both counts, so alpha prints first while beta holds rank 1: a reader who
    // sorted by the badge and a reader who read down the table see the same rows either way.
    expect(out.groups!.map((g) => g.label)).toEqual(["alpha", "beta", "delta", "gamma"]);
    expect(out.groups!.map((g) => g.relative_rank)).toEqual([2, 1, null, 3]);
  });

  it("extends the badge through a tie rather than letting the alphabet decide it", () => {
    // Eight eligible assets, readings [200, 200, 150, 5 ×5], k = ceil(0.2 × 8) = 2 ⇒ the line
    // is 200. alpha and beta are then IDENTICAL on (cold_share_pct 50, open_in_cold 1), and
    // want = min(C = 2, max(1, ceil(0.2 × 3) = 1)) = 1 — so the cutoff falls between two
    // groups nothing but their names tells apart. Both are badged.
    const tied = relativeProfile([
      ...idleAsset("a1", 200, "alpha"),
      ...idleAsset("a2", 5, "alpha"),
      ...idleAsset("b1", 200, "beta"),
      ...idleAsset("b2", 5, "beta"),
      ...idleAsset("g1", 150, "gamma"),
      ...idleAsset("g2", 5, "gamma"),
      ...idleAsset("g3", 5, "gamma"),
      ...idleAsset("g4", 5, "gamma"),
    ]);
    expect(tied.cold_after_days).toBe(200);
    expect(groupOf(tied, "alpha").cold_share_pct).toBe(50);
    expect(groupOf(tied, "beta").cold_share_pct).toBe(50);
    expect(groupOf(tied, "alpha").in_coldest_share).toBe(true);
    expect(groupOf(tied, "beta").in_coldest_share).toBe(true);
    expect(groupOf(tied, "gamma").in_coldest_share).toBe(false);
    expect(tied.totals!.groups_in_coldest_share).toBe(2);
  });

  it("never badges a group with no cold asset, however many the target asks for", () => {
    // readings [200, 190, 20, 20] at 50% ⇒ k = 2, the line is 190, and BOTH cold assets belong
    // to alpha. ceil(0.5 × 3 ranked groups) = 2 asks for two badges; C = 1 says there is only
    // one group with anything cold, and C wins. beta and gamma are warm, not "nearly coldest".
    const clamped = relativeProfile(
      [
        ...idleAsset("a1", 200, "alpha"),
        ...idleAsset("a2", 190, "alpha"),
        ...idleAsset("b1", 20, "beta"),
        ...idleAsset("g1", 20, "gamma"),
      ],
      { targetSharePct: 50 },
    );
    expect(clamped.cold_after_days).toBe(190);
    expect(clamped.totals!.cold_assets).toBe(2);
    expect(groupOf(clamped, "alpha").in_coldest_share).toBe(true);
    expect(groupOf(clamped, "beta").in_coldest_share).toBe(false);
    expect(groupOf(clamped, "gamma").in_coldest_share).toBe(false);
    expect(clamped.totals!.groups_in_coldest_share).toBe(1);

    // C = 0: the floor held the line above everything, so nothing is cold and nobody is the
    // "coldest". A badge over an empty zone would name a group for being last in a healthy
    // estate — exactly the slander the floor exists to prevent.
    const none = relativeProfile([...idleAsset("h1", 10, "alpha"), ...idleAsset("h2", 2, "beta")]);
    expect(none.floor_applied).toBe(true);
    expect(none.totals!.cold_assets).toBe(0);
    expect(none.groups!.every((g) => g.in_coldest_share === false)).toBe(true);
    expect(none.groups!.map((g) => g.relative_rank).every((r) => r !== null)).toBe(true);
    expect(none.totals!.groups_in_coldest_share).toBe(0);
  });

  it("computes the ranks in fixed mode too, and marks nobody with them", () => {
    // The column has the same shape in both modes so the page never has to branch on `mode`
    // to read it — but `in_coldest_share` is a claim about a target share, and a fixed window
    // never named one.
    const fixed = profile(rows);
    expect(fixed.mode).toBe("fixed");
    expect(groupOf(fixed, "beta").relative_rank).toBe(1);
    expect(groupOf(fixed, "alpha").relative_rank).toBe(2);
    expect(groupOf(fixed, "delta").relative_rank).toBeNull();
    expect(fixed.groups!.every((g) => g.in_coldest_share === false)).toBe(true);
    expect(fixed.totals!.groups_in_coldest_share).toBe(0);
  });
});

describe("relative mode with no clock refuses exactly as the fixed mode does", () => {
  const out = relativeProfile([row(), row({ asset_id: null })], { observedFrom: null });

  it("rests the line on the floor and nulls every figure it could not measure", () => {
    expect(out.measurable).toBe(false);
    expect(out.mode).toBe("relative");
    // The page still has to print a line, and the floor is the only number here that owes
    // nothing to a population this read never got to see.
    expect(out.cold_after_days).toBe(14);
    expect(out.floor_days).toBe(14);
    expect(out.fixed_after_days).toBe(90);
    expect(out.target_share_pct).toBe(20);
    expect(out.derived_days).toBeNull();
    expect(out.eligible_assets).toBeNull(); // null, not 0 — nothing was looked at
    expect(out.cold_bound_only).toBeNull();
    expect(out.achieved_share_pct).toBeNull();
    expect(out.floor_applied).toBe(false);
    expect(out.assets).toBeNull();
    expect(out.groups).toBeNull();
    expect(out.totals).toBeNull();
    expect(out.bucket_edges).toBeNull();
    expect(out.bucket_labels).toBeNull();
    // The counts still report, so the empty section can prove it looked.
    expect(out.row_count).toBe(2);
    expect(out.dropped_no_asset).toBe(1);
  });
});
