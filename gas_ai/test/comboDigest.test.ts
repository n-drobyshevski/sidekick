// The Toxic Combinations rollup, pinned to the seed tenant: 32 unresolved issues — 29
// split 8/13/6/2 over the four modelled patterns (the same split test/toxicCombos.test.ts
// pins) plus 3 in Other AI risk — landing on 21 distinct assets. These numbers are what
// the page's KPI row, severity-shift bars and condition matrix are made of, so a change
// here is a change to what the page claims.

import { describe, expect, it } from "vitest";
import { comboDigest, worstSeverity } from "../src/domain/comboDigest";
import { SEED_ISSUES, SEED_NODES } from "../src/server/sampleData";
import type { GNode, IssueRow } from "../src/domain/graphTypes";
import { COMBO_GROUPS, OTHER_GROUP_ID, REGISTER_GROUPS } from "../src/domain/toxicCombos";

// Six days before the only deadline the seed carries (2026-08-18), so "due soon" is
// exercised without depending on the wall clock.
const NOW = "2026-08-12T00:00:00Z";

const digest = comboDigest(SEED_ISSUES, SEED_NODES, NOW);
const byId = Object.fromEntries(digest.groups.map((g) => [g.id, g]));

describe("estate totals", () => {
  it("counts every unresolved issue and the assets under them", () => {
    // 32, not 29: the three Other AI risk rows are in the register too. Counting only
    // the modelled patterns is what made this number read lower than the Wiz console.
    expect(digest.totals.totalOpen).toBe(32);
    expect(digest.totals.unclassified).toBe(3);
    expect(digest.totals.inProgress).toBe(1);
    // Unchanged: the Other rows sit on an asset that already carried an issue.
    expect(digest.totals.assetsAffected).toBe(21);
    // Four modelled patterns is still four — Other is a bucket, not a pattern.
    expect(digest.totals.patternsActive).toBe(4);
    expect(digest.totals.patternsTotal).toBe(4);
  });

  it("draws the amplifier as two mixes of one population", () => {
    // The severity-shift bars are these two objects. Both must sum to totalOpen or the
    // bars stop being the same population drawn twice, which is the whole claim.
    expect(digest.totals.nativeMix).toEqual({ MEDIUM: 28, LOW: 4 });
    expect(digest.totals.adjustedMix).toEqual({ HIGH: 27, MEDIUM: 3, LOW: 2 });
    const sum = (mix: Record<string, number>) =>
      Object.values(mix).reduce((a, b) => a + b, 0);
    expect(sum(digest.totals.nativeMix)).toBe(digest.totals.totalOpen);
    expect(sum(digest.totals.adjustedMix)).toBe(digest.totals.totalOpen);
    // 29 of 32 — a real ratio now that the register holds rows no amplifier touches.
    // It used to equal the total, because every counted issue was a modelled pattern.
    expect(digest.totals.reRated).toBe(29);
  });
});

describe("per-pattern rollup", () => {
  it("keeps the 8/13/6/2 issue split", () => {
    expect(byId["bedrock-no-guardrail"].count).toBe(8);
    expect(byId["gcp-managed-privileged"].count).toBe(13);
    expect(byId["gcp-hosted-privileged"].count).toBe(6);
    expect(byId["permissive-exec-identity"].count).toBe(2);
  });

  it("counts assets separately from issues", () => {
    // The card reads "6 issues · 2 assets". Deriving one from the other would have made
    // that line wrong for exactly this group.
    expect(byId["gcp-hosted-privileged"].assetCount).toBe(2);
    expect(byId["gcp-managed-privileged"].assetCount).toBe(9);
    expect(byId["bedrock-no-guardrail"].assetCount).toBe(8);
  });
});

describe("condition matrix", () => {
  it("separates what the rule tests from what the assets carry", () => {
    const bedrock = byId["bedrock-no-guardrail"].conditions;
    // Tested and carried by all eight — a filled mark with a plain count.
    expect(bedrock.MISSING_GUARDRAIL).toEqual({
      required: true, carried: 8, unknown: 0, total: 8,
    });
    // Not tested by this rule, carried anyway — a hollow mark. This is the distinction
    // the matrix exists to draw, and a derived-only rollup would lose it.
    expect(bedrock.EXCESSIVE_PRIVILEGE.required).toBe(false);
    expect(bedrock.EXCESSIVE_PRIVILEGE.carried).toBe(8);
  });

  it("counts exposure carried on top of a pattern no rule tests it for", () => {
    const managed = byId["gcp-managed-privileged"].conditions;
    expect(managed.INTERNET_EXPOSURE.required).toBe(false);
    expect(managed.INTERNET_EXPOSURE.carried).toBe(1); // Agent-E, of nine
    expect(managed.INTERNET_EXPOSURE.total).toBe(9);
  });

  it("keeps undetermined exposure out of `carried`", () => {
    // The hosted agents inherit exposure from the VM or Cloud Run service under them and
    // Wiz reports it as null. Folding that into false would under-report exposure on the
    // one pattern whose whole risk is the host underneath.
    const hosted = byId["gcp-hosted-privileged"].conditions;
    expect(hosted.INTERNET_EXPOSURE).toEqual({
      required: false, carried: 0, unknown: 2, total: 2,
    });
  });

  it("reports an absent condition as absent", () => {
    const identity = byId["permissive-exec-identity"].conditions;
    expect(identity.SENSITIVE_DATA).toEqual({
      required: false, carried: 0, unknown: 0, total: 2,
    });
  });
});

describe("SLA buckets", () => {
  it("splits due-soon from no-deadline against the injected clock", () => {
    expect(digest.totals.pastDue).toBe(0);
    expect(digest.totals.dueSoon).toBe(13);
    // Reported rather than swallowed: without it the KPI row would imply every issue
    // has a deadline and that nothing is late.
    expect(digest.totals.noDueDate).toBe(19);
    expect(byId["gcp-managed-privileged"].dueSoon).toBe(13);
    expect(byId["bedrock-no-guardrail"].noDueDate).toBe(8);
  });

  it("moves the same issues to past-due once the deadline passes", () => {
    const later = comboDigest(SEED_ISSUES, SEED_NODES, "2026-09-01T00:00:00Z");
    expect(later.totals.pastDue).toBe(13);
    expect(later.totals.dueSoon).toBe(0);
    expect(later.totals.noDueDate).toBe(19);
  });

  it("treats the boundary day as due soon, and the day after as not", () => {
    const rows: IssueRow[] = [
      { ...SEED_ISSUES[0], id: "a", dueAt: "2026-08-19T00:00:00Z" }, // 7 days
      { ...SEED_ISSUES[0], id: "b", dueAt: "2026-08-20T00:00:00Z" }, // 8 days
    ];
    const d = comboDigest(rows, SEED_NODES, NOW);
    expect(d.totals.dueSoon).toBe(1);
    expect(d.totals.pastDue).toBe(0);
  });
});

describe("edge cases", () => {
  it("returns a full, zeroed shape for an empty tenant", () => {
    const empty = comboDigest([], [], NOW);
    expect(empty.totals.totalOpen).toBe(0);
    expect(empty.totals.patternsActive).toBe(0);
    // Every pattern still gets a row, plus the Other bucket.
    expect(empty.groups).toHaveLength(REGISTER_GROUPS.length);
    expect(empty.groups[empty.groups.length - 1].id).toBe(OTHER_GROUP_ID);
    expect(empty.totals.unclassified).toBe(0);
    expect(empty.totals.inProgress).toBe(0);
    // Four modelled patterns is still four: Other is a bucket, not a pattern.
    expect(empty.totals.patternsTotal).toBe(COMBO_GROUPS.length);
    expect(empty.groups.every((g) => g.count === 0)).toBe(true);
    // The declared half survives with no data at all — the matrix can still say what
    // each rule tests before the first sync.
    expect(empty.groups[0].conditions.MISSING_GUARDRAIL.required).toBe(true);
  });

  it("ignores issues that are resolved", () => {
    const closed = SEED_ISSUES.map((i) => ({ ...i, status: "RESOLVED" }));
    expect(comboDigest(closed, SEED_NODES, NOW).totals.totalOpen).toBe(0);
  });

  it("counts IN_PROGRESS work, and says how much of the total it is", () => {
    // The Wiz filter asks for OPEN and IN_PROGRESS, so the page that tracks remediation
    // has to count remediation that is under way.
    const working = SEED_ISSUES.map((i, n) => (n < 3 ? { ...i, status: "IN_PROGRESS" } : i));
    const digest = comboDigest(working, SEED_NODES, NOW);
    expect(digest.totals.totalOpen).toBe(SEED_ISSUES.length);
    expect(digest.totals.inProgress).toBe(3);
    expect(comboDigest(SEED_ISSUES, SEED_NODES, NOW).totals.inProgress).toBe(1);
  });

  it("counts unclassified issues into Other instead of dropping them from the totals", () => {
    // This is the number that has to reconcile against the Wiz console.
    const extra = {
      ...SEED_ISSUES[0], id: "unclassified-1", comboGroup: "wc-id-9999-unmodelled",
    };
    const digest = comboDigest([...SEED_ISSUES, extra], SEED_NODES, NOW);
    expect(digest.totals.totalOpen).toBe(SEED_ISSUES.length + 1);
    expect(digest.totals.unclassified).toBe(4); // the seed's 3, plus this one
    const other = digest.groups.find((g) => g.id === OTHER_GROUP_ID)!;
    expect(other.count).toBe(4);
    // A bucket is not a pattern: the "N of M patterns active" tally ignores it.
    expect(digest.totals.patternsTotal).toBe(COMBO_GROUPS.length);
    expect(digest.totals.patternsActive).toBeLessThanOrEqual(COMBO_GROUPS.length);
  });

  it("skips assets the inventory doesn't hold rather than counting them as clean", () => {
    // An issue can name an asset that never made it into ai_assets. Such a row must not
    // land in a condition denominator, or the matrix would read "0 of 9 carry it" for a
    // tenant where we simply couldn't look.
    const ghost: GNode[] = SEED_NODES.filter((n) => n.id !== "agent-a");
    const d = comboDigest(SEED_ISSUES, ghost, NOW);
    const managed = d.groups.filter((g) => g.id === "gcp-managed-privileged")[0];
    expect(managed.assetCount).toBe(9); // the issue still counts against the pattern
    expect(managed.conditions.EXCESSIVE_PRIVILEGE.total).toBe(8); // but not as evidence
  });
});

describe("worstSeverity", () => {
  it("reads a mix worst-first", () => {
    expect(worstSeverity({ LOW: 3, HIGH: 1 })).toBe("HIGH");
    expect(worstSeverity({ INFO: 2 })).toBe("INFO");
    expect(worstSeverity({})).toBeNull();
  });
});
