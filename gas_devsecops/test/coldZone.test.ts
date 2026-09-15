// test/coldZone.test.ts — the cold-zone family (src/domain/coldZone.ts).
//
// NO SECOND ORACLE HERE, and that is worth stating: `assets.ts` is pinned against real
// PySpark output (test/fixtures/brick/asset_profile.json), but brick has no cold-zone
// family — the definition is this product's own, built from ledger columns that already
// exist. So every case below is a hand case with the arithmetic written out, and the clock
// is fixed at one instant so a duration is a subtraction anyone can check by eye.
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
//                          DISAPPEARANCE, so a repository that drops out of coverage looks
//                          mass-remediated in exactly one scan. Rule 1 has to fire before
//                          rule 2 (`clear`) or a drop-out reads as a finished job.
//   secrets                `program.classifyRisk` THROWS on that scope, so the module carries
//                          those rows at `unknown`. They must still count as open findings
//                          and their `removed_at` / `rotated_at` must still count as movement
//                          — on an OPEN row, which is the shape reconcile actually writes.
//   the counts             `row_count`, `dropped_no_repo`, `unclassified_secrets` and
//                          `scopes_without_scan` report even when nothing else does. A zero
//                          has to prove it looked.

import { describe, expect, it } from "vitest";
import {
  COLD_PROJECT_NONE,
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

const DAY = 86_400_000;
const AS_OF = "2026-07-01T00:00:00Z";
const AS_OF_MS = Date.parse(AS_OF);

/** `n` days before the fixed clock, as ISO — every duration below is one of these. */
const back = (days: number): string => new Date(AS_OF_MS - days * DAY).toISOString();

const NEWEST_SCA = { scan_id: "scan-sca-9", ts: AS_OF };

/** A minimal open SCA row on `repo-1`; every field the profile reads is overridable. */
function row(over: Partial<ColdRow> = {}): ColdRow {
  return {
    scope: "sca",
    severity: "HIGH",
    status: "OPEN",
    has_kev: false,
    has_exploit: false,
    epss: 0,
    cwe: null,
    ai_verdict: null,
    repo_id: "repo-1",
    repo_name: "acme/repo-1",
    owner_project: "platform",
    first_seen: back(200),
    last_seen: AS_OF,
    resolved_at: null,
    resolution_src: null,
    removed_at: null,
    rotated_at: null,
    reopened_count: 0,
    last_scan_id: "scan-sca-9",
    ...over,
  };
}

/** A KEV row — the only shape `DEFAULT_RISK_RULE` classifies `high` without more columns. */
const highRisk = (over: Partial<ColdRow> = {}): ColdRow => row({ has_kev: true, ...over });

function profile(rows: ColdRow[], over: Partial<ColdZoneOptions> = {}): ColdZoneResult {
  return coldZoneProfile(rows, {
    now: AS_OF,
    observedFrom: back(400),
    coldAfterDays: DEFAULT_COLD_AFTER_DAYS,
    newestScanByScope: { sca: NEWEST_SCA },
    ...over,
  });
}

const repoOf = (out: ColdZoneResult, id: string) => out.repos!.find((r) => r.repo_id === id)!;
const teamOf = (out: ColdZoneResult, label: string) => out.teams!.find((t) => t.label === label)!;

// --------------------------------------------------------------------- measured silence

describe("a measured silence past the threshold is cold", () => {
  const out = profile([
    row({ first_seen: back(300) }),
    row({ first_seen: back(250) }),
    row({ status: "RESOLVED", resolved_at: back(120), first_seen: back(300) }),
  ]);
  const repo = repoOf(out, "repo-1");

  it("measures idle from the last movement, not from the oldest finding", () => {
    expect(repo.idle_days).toBeCloseTo(120, 9);
    expect(repo.idle_is_bound).toBe(false);
    expect(repo.idle_bound_days).toBeNull();
    expect(repo.idle_reading_days).toBeCloseTo(120, 9);
    expect(repo.last_movement_at).toBe("2026-03-03T00:00:00Z");
    expect(repo.last_movement_kind).toBe("resolved");
  });

  it("calls it cold, in bucket 3, with the two open findings still counted", () => {
    expect(repo.verdict).toBe("cold");
    expect(repo.cold).toBe(true);
    expect(repo.bucket).toBe(3);
    expect(repo.open_findings).toBe(2);
    // From `first_seen` against the caller's clock — never the row's stored `age_days`.
    expect(repo.oldest_open_age_days).toBeCloseTo(300, 9);
    expect(out.totals!.open_in_cold).toBe(2);
    expect(out.totals!.cold_backlog_share_pct).toBe(100);
  });

  it("keeps idle days fractional rather than rounding them", () => {
    const half = profile([row(), row({ status: "RESOLVED", resolved_at: back(120.5) })]);
    expect(repoOf(half, "repo-1").idle_days).toBeCloseTo(120.5, 9);
  });
});

describe("the threshold edge is inclusive — '≥ N', never '>'", () => {
  const at = (days: number) =>
    repoOf(profile([row(), row({ status: "RESOLVED", resolved_at: back(days) })]), "repo-1");

  it("is cold at exactly 90.0 days", () => {
    const repo = at(90);
    expect(repo.idle_days).toBe(90);
    expect(repo.verdict).toBe("cold");
    expect(repo.bucket).toBe(3);
  });

  it("is warm at 89.9 days", () => {
    const repo = at(89.9);
    expect(repo.idle_days).toBeCloseTo(89.9, 9);
    expect(repo.verdict).toBe("warm");
    expect(repo.cold).toBe(false);
    expect(repo.bucket).toBe(2); // [60, 90)
  });
});

// ------------------------------------------------------------------------- the lower bound

describe("no movement on record publishes a LOWER BOUND, not a measurement", () => {
  // The bound starts at the LATER of "when we started watching" and "this repository's
  // oldest finding". Watched time before the repository had a finding is not a silence
  // anybody could have broken, and neither is the repository's life before we looked.
  const out = profile(
    [
      row({ repo_id: "repo-young", repo_name: "acme/young", first_seen: back(20) }),
      row({ repo_id: "repo-old", repo_name: "acme/old", first_seen: back(900) }),
    ],
    { observedFrom: back(400) },
  );

  it("bounds a young repository by its own first_seen and calls it 'watching'", () => {
    const repo = repoOf(out, "repo-young");
    expect(repo.idle_days).toBeNull();
    expect(repo.idle_is_bound).toBe(true);
    expect(repo.idle_bound_days).toBeCloseTo(20, 9); // max(observedFrom, first_seen) = first_seen
    expect(repo.idle_reading_days).toBeCloseTo(20, 9);
    expect(repo.verdict).toBe("watching");
    expect(repo.cold).toBe(false);
    expect(repo.bucket).toBe(4); // "not yet measurable" — its own column, not 0-30 d
    expect(repo.last_movement_at).toBeNull();
    expect(repo.last_movement_kind).toBeNull();
  });

  it("bounds an older repository by observedFrom, and a bound past the threshold IS cold", () => {
    const repo = repoOf(out, "repo-old");
    expect(repo.idle_days).toBeNull();
    expect(repo.idle_bound_days).toBeCloseTo(400, 9); // max(observedFrom, first_seen) = observedFrom
    expect(repo.idle_is_bound).toBe(true);
    expect(repo.verdict).toBe("cold");
    expect(repo.bucket).toBe(3);
  });

  it("shows how many open findings came back, so a silent repo can explain itself", () => {
    // A reopen clears resolved_at/removed_at/rotated_at (reconcile.ts), so a repository whose
    // only close was reopened has NO movement on record and lands in `watching`. The count is
    // published beside it rather than the page implying nothing ever happened here.
    const out2 = profile([
      row({ repo_id: "repo-returned", first_seen: back(20), reopened_count: 2 }),
      row({ repo_id: "repo-returned", first_seen: back(20), reopened_count: 0 }),
    ]);
    const repo = repoOf(out2, "repo-returned");
    expect(repo.verdict).toBe("watching");
    expect(repo.reopened_open).toBe(1);
  });
});

// ----------------------------------------------------------------- no clock, no figures

describe("observedFrom: null — every derived block is null, the counts still report", () => {
  const out = profile(
    [
      row(),
      row({ repo_id: null }),
      row({ scope: "secrets", severity: "CRITICAL" }),
      row({ scope: "sast", repo_id: "repo-2" }),
    ],
    { observedFrom: null },
  );

  it("refuses the five derived blocks, as nulls rather than empties", () => {
    expect(out.measurable).toBe(false);
    expect(out.repos).toBeNull();
    expect(out.teams).toBeNull();
    expect(out.totals).toBeNull();
    expect(out.bucket_edges).toBeNull();
    expect(out.bucket_labels).toBeNull();
    expect(out.observed_from).toBeNull();
  });

  it("still says what it looked at, and what it could not place", () => {
    expect(out.row_count).toBe(4);
    expect(out.dropped_no_repo).toBe(1);
    expect(out.unclassified_secrets).toBe(1);
    expect(out.scopes_without_scan).toEqual(["sast", "secrets"]);
    // The clock and the threshold are facts about the read, not about the rows.
    expect(out.as_of).toBe(AS_OF);
    expect(out.cold_after_days).toBe(DEFAULT_COLD_AFTER_DAYS);
  });
});

// ------------------------------------------------------------------------- unobserved

describe("a repository the scanner stopped returning is 'unobserved', never warm", () => {
  const out = profile([
    row({ repo_id: "repo-gone", repo_name: "acme/gone", last_scan_id: "scan-sca-1" }),
    row({ repo_id: "repo-gone", repo_name: "acme/gone", last_scan_id: "scan-sca-1" }),
    row({ repo_id: "repo-here", repo_name: "acme/here", status: "RESOLVED", resolved_at: back(10) }),
    row({ repo_id: "repo-here", repo_name: "acme/here" }),
  ]);
  const gone = repoOf(out, "repo-gone");

  it("names the state and leaves the repository out of every idle column", () => {
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
    expect(t.repos_unobserved).toBe(1);
    expect(t.open_in_unobserved).toBe(2);
    expect(t.cold_repos).toBe(0);
    expect(t.warm_repos).toBe(1); // repo-here only
    expect(t.repos_with_open).toBe(1);
    expect(t.buckets).toEqual([1, 0, 0, 0, 0]); // only repo-here, idle 10 d
    expect(t.cold_repo_share_pct).toBe(0);
  });

  it("accepts a blank last_scan_id when last_seen reaches the newest scan", () => {
    // Older ledger rows can carry the sighting without the scan id; the fallback keeps them
    // observed rather than accusing a live repository of vanishing.
    const out2 = profile([row({ repo_id: "repo-blank", last_scan_id: "", last_seen: AS_OF })]);
    expect(repoOf(out2, "repo-blank").observed).toBe(true);
    const out3 = profile([row({ repo_id: "repo-blank", last_scan_id: "", last_seen: back(30) })]);
    expect(repoOf(out3, "repo-blank").observed).toBe(false);
  });
});

describe("a mass disappearance one day before the clock is still 'unobserved'", () => {
  // reconcile resolves every absent finding by disappearance at the scan that noticed. Read
  // naively that is five remediations yesterday — the warmest repository on the page. Rule 1
  // fires first, so the repository reads `unobserved` even though nothing is open on it.
  const dropped = (over: Partial<ColdRow> = {}) =>
    row({
      repo_id: "repo-dropped",
      repo_name: "acme/dropped",
      last_scan_id: "scan-sca-1",
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
  const repo = repoOf(out, "repo-dropped");

  it("does not read the mass close as remediation, and does not read it as 'clear'", () => {
    expect(repo.open_findings).toBe(0);
    expect(repo.verdict).toBe("unobserved"); // NOT "clear": coverage is decided first
    expect(repo.bucket).toBeNull();
    expect(out.totals!.clear_repos).toBe(0);
    expect(out.totals!.warm_repos).toBe(0);
  });

  it("publishes the drop-out's fingerprint: the modal instant and its count", () => {
    expect(repo.disappeared_at).toBe(new Date(AS_OF_MS - DAY).toISOString().replace(".000Z", "Z"));
    expect(repo.disappeared_at_last_observation).toBe(5);
  });

  it("keeps the disappearance out of the team's last movement", () => {
    // The team rolls movement over OBSERVED repositories only — a scanner event is not this
    // team's work, and must not refresh their date.
    expect(teamOf(out, "platform").last_movement_at).toBeNull();
    expect(teamOf(out, "platform").repos_unobserved).toBe(1);
  });
});

// --------------------------------------------------------------------------- secrets

describe("secrets: removal on an OPEN row is movement, and is never high risk", () => {
  const out = profile([
    row({ scope: "secrets", severity: "CRITICAL", status: "OPEN", removed_at: back(10) }),
    row({ scope: "secrets", severity: "CRITICAL", status: "OPEN", rotated_at: back(30) }),
    highRisk({ scope: "sca" }),
  ]);
  const repo = repoOf(out, "repo-1");

  it("reads movement regardless of status — reconcile writes it on OPEN secrets rows", () => {
    expect(repo.last_movement_kind).toBe("removed");
    expect(repo.idle_days).toBeCloseTo(10, 9);
    expect(repo.verdict).toBe("warm");
  });

  it("counts the credentials as open findings but never as high risk", () => {
    expect(repo.open_findings).toBe(3);
    expect(repo.open_high_risk).toBe(1); // the KEV row only
    expect(out.unclassified_secrets).toBe(2);
  });

  it("prefers a resolution to a removal when the two land on the same instant", () => {
    const tie = profile([
      row({ status: "RESOLVED", resolved_at: back(10) }),
      row({ scope: "secrets", status: "OPEN", removed_at: back(10) }),
    ]);
    expect(repoOf(tie, "repo-1").last_movement_kind).toBe("resolved");
  });
});

// --------------------------------------------------------------------------- teams

describe("the null owner_project is a real team row, not a drop", () => {
  const out = profile([
    row({ repo_id: "repo-orphan", repo_name: "acme/orphan", owner_project: null }),
    row({ repo_id: "repo-orphan", repo_name: "acme/orphan", owner_project: "" }),
    row({ repo_id: "repo-owned", repo_name: "acme/owned", status: "RESOLVED", resolved_at: back(5) }),
    row({ repo_id: "repo-owned", repo_name: "acme/owned" }),
  ]);

  it("labels it, keeps it, and publishes the ownership gap as a figure", () => {
    const orphan = teamOf(out, COLD_PROJECT_NONE);
    expect(COLD_PROJECT_NONE).toBe("(no project)");
    expect(orphan.project).toBeNull();
    expect(orphan.repos).toBe(1);
    expect(orphan.open_findings).toBe(2);
    expect(out.totals!.repos_no_project).toBe(1);
    expect(out.totals!.teams).toBe(2);
  });

  it("sorts it by the same rule as every other team — never pinned last", () => {
    // The orphan is cold (no movement, 400 d bound); the owned repo is warm. Cold first.
    expect(out.teams!.map((t) => t.label)).toEqual([COLD_PROJECT_NONE, "platform"]);
  });
});

describe("the four team verdicts", () => {
  const coldRepo = (id: string, project: string) =>
    row({ repo_id: id, repo_name: id, owner_project: project, first_seen: back(300) });
  const warmRepo = (id: string, project: string) => [
    row({ repo_id: id, repo_name: id, owner_project: project }),
    row({
      repo_id: id,
      repo_name: id,
      owner_project: project,
      status: "RESOLVED",
      resolved_at: back(5),
    }),
  ];
  const clearRepo = (id: string, project: string) =>
    row({
      repo_id: id,
      repo_name: id,
      owner_project: project,
      status: "RESOLVED",
      resolved_at: back(5),
    });

  const out = profile([
    coldRepo("a1", "alpha"),
    coldRepo("a2", "alpha"),
    coldRepo("b1", "beta"),
    ...warmRepo("b2", "beta"),
    ...warmRepo("g1", "gamma"),
    clearRepo("d1", "delta"),
  ]);

  it("fully-cold when every repository with open findings is cold", () => {
    const alpha = teamOf(out, "alpha");
    expect(alpha.verdict).toBe("fully-cold");
    expect(alpha.cold_repos).toBe(2);
    expect(alpha.repos_with_open).toBe(2);
    expect(alpha.cold_share_pct).toBe(100);
  });

  it("partly-cold when some are", () => {
    const beta = teamOf(out, "beta");
    expect(beta.verdict).toBe("partly-cold");
    expect(beta.cold_repos).toBe(1);
    expect(beta.repos_with_open).toBe(2);
    expect(beta.cold_share_pct).toBe(50);
    expect(beta.last_movement_at).toBe(new Date(AS_OF_MS - 5 * DAY).toISOString().replace(".000Z", "Z"));
  });

  it("warm when none are", () => {
    const gamma = teamOf(out, "gamma");
    expect(gamma.verdict).toBe("warm");
    expect(gamma.cold_repos).toBe(0);
    expect(gamma.cold_share_pct).toBe(0);
  });

  it("clear when nothing is open — and the share is NULL, not 0%", () => {
    const delta = teamOf(out, "delta");
    expect(delta.verdict).toBe("clear");
    expect(delta.repos_with_open).toBe(0);
    expect(delta.clear_repos).toBe(1);
    expect(delta.cold_share_pct).toBeNull();
  });

  it("totals the team verdicts and sorts cold repositories first", () => {
    const t = out.totals!;
    expect(t.teams).toBe(4);
    expect(t.teams_fully_cold).toBe(1);
    expect(t.teams_partly_cold).toBe(1);
    // cold_repos desc, then open_in_cold desc, then label asc — gamma and delta tie at zero.
    expect(out.teams!.map((x) => x.label)).toEqual(["alpha", "beta", "delta", "gamma"]);
    // Repositories: cold, unobserved, watching, warm, clear — then open desc, then name.
    expect(out.repos!.map((r) => r.verdict)).toEqual([
      "cold", "cold", "cold", "warm", "warm", "clear",
    ]);
  });
});

// --------------------------------------------------------------------------- buckets

describe("buckets are thirds of the threshold, and bucket 3 IS the cold column", () => {
  const idleFor = (id: string, days: number) => [
    row({ repo_id: id, repo_name: id, first_seen: back(300) }),
    row({
      repo_id: id,
      repo_name: id,
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
    row({ repo_id: "b4", repo_name: "b4", first_seen: back(20) }), // no movement, bound 20 d
  ]);

  it("publishes five labelled columns with the ≥ sign on the last measured one", () => {
    expect(out.bucket_edges).toEqual([0, 30, 60, 90]);
    expect(out.bucket_labels).toEqual([
      "0–30 d", "30–60 d", "60–90 d", "≥ 90 d", "not yet measurable",
    ]);
    expect(out.bucket_labels!.some((l) => l.includes(">"))).toBe(false);
  });

  it("places one repository in each, and buckets[3] equals cold_repos", () => {
    expect(out.repos!.map((r) => [r.repo_id, r.bucket]).sort()).toEqual([
      ["b0", 0], ["b1", 1], ["b2", 2], ["b3", 3], ["b4", 4],
    ]);
    const t = out.totals!;
    expect(t.buckets).toEqual([1, 1, 1, 1, 1]);
    expect(t.buckets.length).toBe(5);
    expect(t.buckets[3]).toBe(t.cold_repos);
    expect(t.bucket_open).toEqual([1, 1, 1, 1, 1]); // one open finding per repository
  });

  it("moves the edges with the threshold", () => {
    const wide = profile([...idleFor("b3", 120)], { coldAfterDays: 120 });
    expect(wide.bucket_edges).toEqual([0, 40, 80, 120]);
    expect(wide.bucket_labels).toEqual([
      "0–40 d", "40–80 d", "80–120 d", "≥ 120 d", "not yet measurable",
    ]);
    // 120 d idle is exactly the new threshold — still bucket 3, still cold.
    expect(repoOf(wide, "b3").bucket).toBe(3);
    expect(wide.totals!.buckets[3]).toBe(wide.totals!.cold_repos);
  });

  it("keeps the settings guardrails on record beside the default", () => {
    expect(DEFAULT_COLD_AFTER_DAYS).toBe(90);
    expect(COLD_AFTER_DAYS_MIN).toBe(7);
    expect(COLD_AFTER_DAYS_MAX).toBe(365);
  });
});

// --------------------------------------------------------------------- drops and refusals

describe("rows with no repository are dropped AND counted", () => {
  const out = profile([
    row({ repo_id: "repo-1" }),
    row({ repo_id: "repo-2" }),
    row({ repo_id: null }),
    row({ repo_id: "" }),
    row({ repo_id: "   " }),
  ]);

  it("counts the three it could not place", () => {
    expect(out.dropped_no_repo).toBe(3);
    expect(out.row_count).toBe(5);
  });

  it("leaves them out of every figure — no phantom repository row", () => {
    expect(out.repos!.map((r) => r.repo_id).sort()).toEqual(["repo-1", "repo-2"]);
    expect(out.totals!.repos).toBe(2);
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
    row({ repo_id: "repo-cold", repo_name: "acme/cold", first_seen: back(300) }),
    row({ repo_id: "repo-warm", repo_name: "acme/warm" }),
    row({
      repo_id: "repo-warm",
      repo_name: "acme/warm",
      status: "RESOLVED",
      resolved_at: back(5),
    }),
  ]);
  const head = coldZoneHeadline(out);

  it("carries no per-repository or per-team array", () => {
    expect(Object.keys(head).sort()).toEqual([
      "achieved_share_pct", "as_of", "cold_after_days", "cold_bound_only", "derived_days",
      "dropped_no_repo", "eligible_repos", "fixed_after_days", "floor_applied", "floor_days",
      "measurable", "mode", "observed_from", "row_count", "scopes_without_scan",
      "target_share_pct", "totals", "unclassified_secrets",
    ]);
    expect("repos" in head).toBe(false);
    expect("teams" in head).toBe(false);
  });

  it("carries the one number the Executive card draws, plus its clock", () => {
    expect(head.totals!.cold_backlog_share_pct).toBe(50); // 1 of 2 open findings
    expect(head.totals!.cold_repos).toBe(1);
    expect(head.totals!.repos_with_open).toBe(2);
    expect(head.cold_after_days).toBe(90);
    expect(head.as_of).toBe(AS_OF);
    expect(head.observed_from).toBe(back(400).replace(".000Z", "Z"));
  });

  it("passes the refusal through unchanged", () => {
    const none = coldZoneHeadline(profile([row()], { observedFrom: null }));
    expect(none.measurable).toBe(false);
    expect(none.totals).toBeNull();
    expect(none.row_count).toBe(1);
  });
});

// --------------------------------------------------------------- undecidable observation

describe("a scope with rows but no scan on record is undecidable, not stale", () => {
  const out = profile(
    [
      row({ repo_id: "repo-sast", scope: "sast", last_scan_id: "scan-sast-3" }),
      row({ repo_id: "repo-mixed", scope: "sca", last_scan_id: "scan-sca-1" }),
      row({ repo_id: "repo-mixed", scope: "secrets", last_scan_id: "scan-sec-2" }),
    ],
    { newestScanByScope: { sca: NEWEST_SCA } },
  );

  it("keeps the repository observed — doubt falls away from accusing a team", () => {
    expect(repoOf(out, "repo-sast").observed).toBe(true);
    expect(repoOf(out, "repo-sast").verdict).toBe("cold"); // bound past the threshold
  });

  it("names every scope whose observation it could not decide", () => {
    expect(out.scopes_without_scan).toEqual(["sast", "secrets"]);
  });

  it("observes a mixed repository through whichever scope still reaches its newest scan", () => {
    // repo-mixed's sca rows are stale, but `secrets` has no scan on record at all, so
    // observation stays true rather than reading an sca-only sweep as a disappearance.
    expect(repoOf(out, "repo-mixed").observed).toBe(true);
  });

  it("marks it unobserved once every one of its scopes has a scan it does not reach", () => {
    const decided = profile(
      [
        row({ repo_id: "repo-mixed", scope: "sca", last_scan_id: "scan-sca-1" }),
        row({ repo_id: "repo-mixed", scope: "secrets", last_scan_id: "scan-sec-2" }),
      ],
      {
        newestScanByScope: {
          sca: NEWEST_SCA,
          secrets: { scan_id: "scan-sec-9", ts: AS_OF },
        },
      },
    );
    expect(repoOf(decided, "repo-mixed").observed).toBe(false);
    expect(decided.scopes_without_scan).toEqual([]);
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
//                              repository and turns a "20% cut" into an unpredictable count at
//                              small n. These cases pin the exact k, the exact line and the
//                              exact count, so an interpolating implementation fails them.
//   ties at the cutoff         all cold, because the test stays `>=`. The achieved share then
//                              exceeds the target, and that is published rather than hidden.
//   the floor                  a share always names somebody. The floor is what stops "the
//                              idlest 20%" being a slander on a well-tended estate — and when
//                              it holds, `derived_days`/`floor_applied` say so and the
//                              achieved share is a REAL zero over a real denominator.
//   the bound                  a repository that never closed anything ranks at its LOWER
//                              bound, which under-states its silence. `cold_bound_only` is the
//                              published cost of that.
//   the team badge             a relative position, clamped so a project with nothing cold is
//                              never marked, and extended through ties so the alphabet never
//                              decides who is badged.

/** A repository with a MEASURED idle time of exactly `days`: one open row, one closed then. */
const idleRepo = (id: string, days: number, project = "platform"): ColdRow[] => [
  row({ repo_id: id, repo_name: id, owner_project: project, first_seen: back(390) }),
  row({
    repo_id: id,
    repo_name: id,
    owner_project: project,
    first_seen: back(390),
    status: "RESOLVED",
    resolved_at: back(days),
  }),
];

/** Relative mode at the product defaults: the idlest 20%, never above a 14-day floor. */
const relativeProfile = (rows: ColdRow[], over: Partial<ColdZoneOptions> = {}): ColdZoneResult =>
  profile(rows, { mode: "relative", targetSharePct: 20, floorDays: 14, ...over });

describe("fixed mode is untouched, and the new fields say so", () => {
  const out = profile([...idleRepo("cold-1", 120), ...idleRepo("warm-1", 10)]);

  it("keeps the operator's window as the effective line and nulls every relative field", () => {
    expect(out.mode).toBe("fixed");
    expect(out.cold_after_days).toBe(90); // the EFFECTIVE line — here, the window itself
    expect(out.fixed_after_days).toBe(90);
    expect(out.target_share_pct).toBeNull(); // nothing was aimed at
    expect(out.floor_days).toBeNull();
    expect(out.floor_applied).toBe(false);
    expect(out.derived_days).toBeNull(); // nothing was derived — not "derived at zero"
    expect(out.bucket_edges).toEqual([0, 30, 60, 90]);
    expect(out.totals!.cold_repos).toBe(1);
    // The share is still published in fixed mode, so target and achieved read side by side.
    expect(out.achieved_share_pct).toBe(50);
    expect(out.achieved_share_pct).toBe(out.totals!.cold_repo_share_pct);
    expect(out.eligible_repos).toBe(2);
    expect(out.cold_bound_only).toBe(0);
    expect(out.totals!.teams_in_coldest_share).toBe(0);
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
  // Five eligible repositories, idle 50 / 40 / 30 / 20 / 10 days. Sorted descending, the
  // readings are [50, 40, 30, 20, 10] and every case below indexes into that one list.
  const five = [
    ...idleRepo("r50", 50),
    ...idleRepo("r40", 40),
    ...idleRepo("r30", 30),
    ...idleRepo("r20", 20),
    ...idleRepo("r10", 10),
  ];

  it("cuts at k = 1 for 20% of 5, and at k = 2 for 40% — exactly, with no interpolation", () => {
    // ceil(0.20 × 5) = 1 ⇒ readings[0] = 50. An interpolated 80th percentile would land at
    // 42 and catch the same one repository by luck; at 40% the two rules disagree outright.
    const at20 = relativeProfile(five);
    expect(at20.derived_days).toBe(50);
    expect(at20.cold_after_days).toBe(50);
    expect(at20.floor_applied).toBe(false);
    expect(at20.totals!.cold_repos).toBe(1);
    expect(at20.achieved_share_pct).toBe(20);
    expect(repoOf(at20, "r50").cold).toBe(true);
    expect(repoOf(at20, "r40").verdict).toBe("warm");

    // ceil(0.40 × 5) = 2 ⇒ readings[1] = 40. The line sits ON r40, which is therefore cold:
    // the test is `>=`, so the repository that defines the line is inside the zone.
    const at40 = relativeProfile(five, { targetSharePct: 40 });
    expect(at40.derived_days).toBe(40);
    expect(at40.cold_after_days).toBe(40);
    expect(at40.totals!.cold_repos).toBe(2);
    expect(at40.achieved_share_pct).toBe(40);
    expect(repoOf(at40, "r40").cold).toBe(true);
  });

  it("never cuts at k = 0: one to four repositories at 20% all give k = 1", () => {
    // ceil(0.2 × n) is 1 for n = 1..5, and `max(1, …)` would rescue it if it were not —
    // a cut at k = 0 has no reading to stand on and would make the line undefined.
    const pool = [idleRepo("a", 100), idleRepo("b", 80), idleRepo("c", 60), idleRepo("d", 40)];
    for (const n of [1, 2, 3, 4]) {
      const out = relativeProfile(pool.slice(0, n).flat());
      expect(out.eligible_repos).toBe(n);
      expect(out.derived_days).toBe(100); // readings[0] every time
      expect(out.cold_after_days).toBe(100);
      expect(out.totals!.cold_repos).toBe(1);
      expect(out.achieved_share_pct).toBeCloseTo(100 / n, 9);
    }
  });

  it("puts every repository tied AT the cutoff inside the zone, and reports the overshoot", () => {
    // readings [100, 100, 50, 20], k = ceil(0.2 × 4) = 1 ⇒ the line is 100 — and BOTH
    // repositories at 100 are cold, because splitting a tie would need a ">" the register
    // does not use. The achieved share (50%) then exceeds the 20% asked for, and says so.
    const out = relativeProfile([
      ...idleRepo("tie-a", 100),
      ...idleRepo("tie-b", 100),
      ...idleRepo("mid", 50),
      ...idleRepo("low", 20),
    ]);
    expect(out.derived_days).toBe(100);
    expect(out.totals!.cold_repos).toBe(2);
    expect(out.target_share_pct).toBe(20);
    expect(out.achieved_share_pct).toBe(50);
    expect(out.achieved_share_pct!).toBeGreaterThan(out.target_share_pct!);
    expect(repoOf(out, "tie-a").cold).toBe(true);
    expect(repoOf(out, "tie-b").cold).toBe(true);
  });

  it("floors the line to whole days, which can only ever widen the zone", () => {
    // readings [50.7, 50.2, 20], k = 1 ⇒ the raw cut is 50.7, published as 50. The repository
    // at 50.2 is then cold too: cold_repos (2) >= k (1), never fewer. A fractional line would
    // make `fmtDays` prose and the "≥ N d" cells disagree about the same number.
    const out = relativeProfile([
      ...idleRepo("f1", 50.7),
      ...idleRepo("f2", 50.2),
      ...idleRepo("f3", 20),
    ]);
    expect(out.derived_days).toBe(50);
    expect(Number.isInteger(out.derived_days!)).toBe(true);
    expect(out.cold_after_days).toBe(50);
    expect(out.totals!.cold_repos).toBe(2);
    expect(out.bucket_labels![3]).toBe("≥ 50 d");
  });
});

describe("the floor is what stops a share being a slander on a healthy estate", () => {
  it("holds the line, publishes the line it refused, and reports a REAL zero", () => {
    // Everything here was touched inside a fortnight: readings [10, 8, 6, 4, 2], k = 1, so the
    // idlest 20% would be "idle for 10 days". The 14-day floor overrules it, nothing is cold,
    // and 0% is a measured answer over five repositories — not the null of an empty estate.
    const out = relativeProfile([
      ...idleRepo("h1", 10),
      ...idleRepo("h2", 8),
      ...idleRepo("h3", 6),
      ...idleRepo("h4", 4),
      ...idleRepo("h5", 2),
    ]);
    expect(out.derived_days).toBe(10);
    expect(out.floor_days).toBe(14);
    expect(out.floor_applied).toBe(true);
    expect(out.cold_after_days).toBe(14); // the EFFECTIVE line is the floor
    expect(out.totals!.cold_repos).toBe(0);
    expect(out.eligible_repos).toBe(5);
    expect(out.achieved_share_pct).toBe(0);
    expect(out.achieved_share_pct).not.toBeNull();
  });

  it("does not claim the floor applied when the derived line lands exactly on it", () => {
    // readings [14, 5, 5, 5, 5], k = 1 ⇒ derived 14 = the floor. `max` is the same number
    // either way, so the only thing at stake is the page's sentence: the estate produced this
    // line, the floor did not have to hold it, and `floor_applied` must not say otherwise.
    const out = relativeProfile([
      ...idleRepo("e1", 14),
      ...idleRepo("e2", 5),
      ...idleRepo("e3", 5),
      ...idleRepo("e4", 5),
      ...idleRepo("e5", 5),
    ]);
    expect(out.derived_days).toBe(14);
    expect(out.cold_after_days).toBe(14);
    expect(out.floor_applied).toBe(false);
    expect(out.totals!.cold_repos).toBe(1); // 14 >= 14, the edge is inclusive as ever
  });

  it("rests on the floor with NULLS, not zeros, when there is nothing to rank", () => {
    // One repository with nothing open (clear) and one the scanner lost (unobserved): neither
    // is eligible, so no line can be derived. `derived_days` is null — "not derived" is not
    // "derived at zero" — and the share is null over an empty denominator.
    const out = relativeProfile([
      row({ repo_id: "clear-1", repo_name: "clear-1", status: "RESOLVED", resolved_at: back(5) }),
      row({ repo_id: "gone-1", repo_name: "gone-1", last_scan_id: "scan-sca-1" }),
    ]);
    expect(out.eligible_repos).toBe(0);
    expect(out.derived_days).toBeNull();
    expect(out.floor_applied).toBe(false); // the floor overruled nothing; it is simply all there is
    expect(out.cold_after_days).toBe(14);
    expect(out.achieved_share_pct).toBeNull();
    expect(out.totals!.cold_repos).toBe(0);
    expect(out.bucket_edges).toEqual([0, 14 / 3, 28 / 3, 14]);
  });
});

describe("a repository that never closed anything ranks at its lower bound, and the cost is printed", () => {
  it("ranks bounds beside measurements and counts the cold ones that were never measured", () => {
    // No movement anywhere: each repository's reading is its BOUND — the later of observedFrom
    // (400 d) and its own first_seen. readings [300, 100, 30], k = 1 ⇒ the line is 300, and the
    // one repository at 300 is cold by rule 4. Every cold repository here is a bound, so
    // `cold_bound_only` equals `cold_repos`: the page can say the whole zone is a lower bound.
    const out = relativeProfile([
      row({ repo_id: "b300", repo_name: "b300", first_seen: back(300) }),
      row({ repo_id: "b100", repo_name: "b100", first_seen: back(100) }),
      row({ repo_id: "b30", repo_name: "b30", first_seen: back(30) }),
    ]);
    expect(out.eligible_repos).toBe(3);
    expect(out.derived_days).toBe(300);
    expect(out.cold_after_days).toBe(300);
    expect(repoOf(out, "b300").idle_is_bound).toBe(true);
    expect(repoOf(out, "b300").idle_days).toBeNull();
    expect(repoOf(out, "b300").idle_reading_days).toBeCloseTo(300, 9);
    expect(repoOf(out, "b300").verdict).toBe("cold");
    expect(out.totals!.cold_repos).toBe(1);
    expect(out.cold_bound_only).toBe(1);
    expect(out.cold_bound_only).toBe(out.totals!.cold_repos);
    // The two that did not make the line are still "watching", not warm: nothing was measured.
    expect(repoOf(out, "b100").verdict).toBe("watching");
  });
});

describe("the effective line — whoever drew it — is the only threshold anything downstream reads", () => {
  it("moves the bucket edges with the derived line and keeps buckets[3] === cold_repos", () => {
    // readings [50, 40, 30, 20, 10] at 40% ⇒ the line is 40, so the edges are thirds of 40
    // and the cold column is the fourth bucket, exactly as it is under a fixed window.
    const out = relativeProfile(
      [
        ...idleRepo("r50", 50),
        ...idleRepo("r40", 40),
        ...idleRepo("r30", 30),
        ...idleRepo("r20", 20),
        ...idleRepo("r10", 10),
      ],
      { targetSharePct: 40 },
    );
    expect(out.cold_after_days).toBe(40);
    expect(out.bucket_edges).toEqual([0, 40 / 3, 80 / 3, 40]);
    expect(out.bucket_labels![3]).toBe("≥ 40 d");
    expect(out.bucket_labels!.some((l) => l.includes(">"))).toBe(false);
    expect(out.totals!.buckets).toEqual([1, 1, 1, 2, 0]);
    expect(out.totals!.buckets[3]).toBe(out.totals!.cold_repos);
    // The fixed window it was NOT measured against is still on record beside it.
    expect(out.fixed_after_days).toBe(90);
  });

  it("counts exactly the repositories the existing rollup already calls open-and-observed", () => {
    // `eligible_repos` must be `repos_with_open`, or the share is a share of something the
    // table does not show. Two measured, one bound-only ("watching" — still eligible), one
    // clear, one lost to the scanner.
    const out = relativeProfile([
      ...idleRepo("m60", 60),
      ...idleRepo("m10", 10),
      row({ repo_id: "young", repo_name: "young", first_seen: back(5) }),
      row({ repo_id: "clear-1", repo_name: "clear-1", status: "RESOLVED", resolved_at: back(5) }),
      row({ repo_id: "gone-1", repo_name: "gone-1", last_scan_id: "scan-sca-1" }),
    ]);
    expect(out.eligible_repos).toBe(3);
    expect(out.eligible_repos).toBe(out.totals!.repos_with_open);
    expect(out.totals!.clear_repos).toBe(1);
    expect(out.totals!.repos_unobserved).toBe(1);
    // readings [60, 10, 5], k = ceil(0.6) = 1 ⇒ the line is 60 and only m60 is cold.
    expect(out.derived_days).toBe(60);
    expect(out.totals!.cold_repos).toBe(1);
  });

  it("publishes the achieved share against the target in BOTH directions", () => {
    // Above, because ties at the cutoff widen the zone; below, because the floor narrows it.
    // Neither is an error, and neither may be reported as "20%".
    const over = relativeProfile([
      ...idleRepo("t1", 100),
      ...idleRepo("t2", 100),
      ...idleRepo("t3", 50),
      ...idleRepo("t4", 20),
    ]);
    expect(over.achieved_share_pct!).toBeGreaterThan(over.target_share_pct!);

    const under = relativeProfile([
      ...idleRepo("u1", 10),
      ...idleRepo("u2", 8),
      ...idleRepo("u3", 6),
      ...idleRepo("u4", 4),
      ...idleRepo("u5", 2),
    ]);
    expect(under.achieved_share_pct!).toBeLessThan(under.target_share_pct!);
    expect(under.floor_applied).toBe(true);
  });
});

describe("relative mode refuses the options it cannot guess", () => {
  const rows = idleRepo("r1", 100);

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

// ------------------------------------------------------------------ the team-level rank

describe("the coldest projects are ranked on their cold SHARE, not on their size", () => {
  // Six eligible repositories. readings [200, 200, 150, 5, 5, 5], k = ceil(0.2 × 6) = 2 ⇒ the
  // line is readings[1] = 200, so a1 and b1 are cold.
  //   beta   1 of 1 cold  = 100%   rank 1
  //   alpha  1 of 2 cold  =  50%   rank 2
  //   gamma  0 of 3 cold  =   0%   rank 3
  //   delta  nothing open         rank NULL — it is not in the race
  const rows = [
    ...idleRepo("a1", 200, "alpha"),
    ...idleRepo("a2", 5, "alpha"),
    ...idleRepo("b1", 200, "beta"),
    ...idleRepo("g1", 150, "gamma"),
    ...idleRepo("g2", 5, "gamma"),
    ...idleRepo("g3", 5, "gamma"),
    row({ repo_id: "d1", repo_name: "d1", owner_project: "delta", status: "RESOLVED", resolved_at: back(5) }),
  ];
  const out = relativeProfile(rows);

  it("ranks by cold share, leaves a project with nothing open unranked, and badges the coldest", () => {
    expect(out.cold_after_days).toBe(200);
    expect(teamOf(out, "beta").cold_share_pct).toBe(100);
    expect(teamOf(out, "beta").relative_rank).toBe(1);
    expect(teamOf(out, "alpha").cold_share_pct).toBe(50);
    expect(teamOf(out, "alpha").relative_rank).toBe(2);
    expect(teamOf(out, "gamma").relative_rank).toBe(3);
    expect(teamOf(out, "delta").relative_rank).toBeNull();
    expect(teamOf(out, "delta").cold_share_pct).toBeNull();
    // want = min(C = 2, max(1, ceil(0.2 × 3) = 1)) = 1 ⇒ the single coldest project.
    expect(teamOf(out, "beta").in_coldest_share).toBe(true);
    expect(teamOf(out, "alpha").in_coldest_share).toBe(false);
    expect(teamOf(out, "gamma").in_coldest_share).toBe(false);
    expect(teamOf(out, "delta").in_coldest_share).toBe(false);
    expect(out.totals!.teams_in_coldest_share).toBe(1);
  });

  it("does not reorder the published table — the rank is a column, not the sort", () => {
    // The table is still ordered cold repositories desc, open-in-cold desc, label asc. alpha
    // and beta tie on both counts, so alpha prints first while beta holds rank 1: a reader who
    // sorted by the badge and a reader who read down the table see the same rows either way.
    expect(out.teams!.map((t) => t.label)).toEqual(["alpha", "beta", "delta", "gamma"]);
    expect(out.teams!.map((t) => t.relative_rank)).toEqual([2, 1, null, 3]);
  });

  it("extends the badge through a tie rather than letting the alphabet decide it", () => {
    // Eight eligible repositories, readings [200, 200, 150, 5 ×5], k = ceil(0.2 × 8) = 2 ⇒ the
    // line is 200. alpha and beta are then IDENTICAL on (cold_share_pct 50, open_in_cold 1),
    // and want = min(C = 2, max(1, ceil(0.2 × 3) = 1)) = 1 — so the cutoff falls between two
    // projects nothing but their names tells apart. Both are badged.
    const tied = relativeProfile([
      ...idleRepo("a1", 200, "alpha"),
      ...idleRepo("a2", 5, "alpha"),
      ...idleRepo("b1", 200, "beta"),
      ...idleRepo("b2", 5, "beta"),
      ...idleRepo("g1", 150, "gamma"),
      ...idleRepo("g2", 5, "gamma"),
      ...idleRepo("g3", 5, "gamma"),
      ...idleRepo("g4", 5, "gamma"),
    ]);
    expect(tied.cold_after_days).toBe(200);
    expect(teamOf(tied, "alpha").cold_share_pct).toBe(50);
    expect(teamOf(tied, "beta").cold_share_pct).toBe(50);
    expect(teamOf(tied, "alpha").in_coldest_share).toBe(true);
    expect(teamOf(tied, "beta").in_coldest_share).toBe(true);
    expect(teamOf(tied, "gamma").in_coldest_share).toBe(false);
    expect(tied.totals!.teams_in_coldest_share).toBe(2);
  });

  it("never badges a project with no cold repository, however many the target asks for", () => {
    // readings [200, 190, 20, 20] at 50% ⇒ k = 2, the line is 190, and BOTH cold repositories
    // belong to alpha. ceil(0.5 × 3 ranked projects) = 2 asks for two badges; C = 1 says there
    // is only one project with anything cold, and C wins. beta and gamma are warm, not "nearly
    // coldest".
    const clamped = relativeProfile(
      [
        ...idleRepo("a1", 200, "alpha"),
        ...idleRepo("a2", 190, "alpha"),
        ...idleRepo("b1", 20, "beta"),
        ...idleRepo("g1", 20, "gamma"),
      ],
      { targetSharePct: 50 },
    );
    expect(clamped.cold_after_days).toBe(190);
    expect(clamped.totals!.cold_repos).toBe(2);
    expect(teamOf(clamped, "alpha").in_coldest_share).toBe(true);
    expect(teamOf(clamped, "beta").in_coldest_share).toBe(false);
    expect(teamOf(clamped, "gamma").in_coldest_share).toBe(false);
    expect(clamped.totals!.teams_in_coldest_share).toBe(1);

    // C = 0: the floor held the line above everything, so nothing is cold and nobody is the
    // "coldest". A badge over an empty zone would name a project for being last in a healthy
    // estate — exactly the slander the floor exists to prevent.
    const none = relativeProfile([...idleRepo("h1", 10, "alpha"), ...idleRepo("h2", 2, "beta")]);
    expect(none.floor_applied).toBe(true);
    expect(none.totals!.cold_repos).toBe(0);
    expect(none.teams!.every((t) => t.in_coldest_share === false)).toBe(true);
    expect(none.teams!.map((t) => t.relative_rank).every((r) => r !== null)).toBe(true);
    expect(none.totals!.teams_in_coldest_share).toBe(0);
  });

  it("computes the ranks in fixed mode too, and marks nobody with them", () => {
    // The column has the same shape in both modes so the page never has to branch on `mode`
    // to read it — but `in_coldest_share` is a claim about a target share, and a fixed window
    // never named one.
    const fixed = profile(rows);
    expect(fixed.mode).toBe("fixed");
    expect(teamOf(fixed, "beta").relative_rank).toBe(1);
    expect(teamOf(fixed, "alpha").relative_rank).toBe(2);
    expect(teamOf(fixed, "delta").relative_rank).toBeNull();
    expect(fixed.teams!.every((t) => t.in_coldest_share === false)).toBe(true);
    expect(fixed.totals!.teams_in_coldest_share).toBe(0);
  });
});

describe("relative mode with no clock refuses exactly as the fixed mode does", () => {
  const out = relativeProfile([row(), row({ repo_id: null })], { observedFrom: null });

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
    expect(out.eligible_repos).toBeNull(); // null, not 0 — nothing was looked at
    expect(out.cold_bound_only).toBeNull();
    expect(out.achieved_share_pct).toBeNull();
    expect(out.floor_applied).toBe(false);
    expect(out.repos).toBeNull();
    expect(out.teams).toBeNull();
    expect(out.totals).toBeNull();
    expect(out.bucket_edges).toBeNull();
    expect(out.bucket_labels).toBeNull();
    // The counts still report, so the empty section can prove it looked.
    expect(out.row_count).toBe(2);
    expect(out.dropped_no_repo).toBe(1);
  });
});
