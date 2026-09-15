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
  DEFAULT_COLD_AFTER_DAYS,
  RESOLUTION_DISAPPEARED,
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
      "as_of", "cold_after_days", "dropped_no_repo", "measurable", "observed_from",
      "row_count", "scopes_without_scan", "totals", "unclassified_secrets",
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
