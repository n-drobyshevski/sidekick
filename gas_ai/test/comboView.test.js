// The Toxic Combinations page as pure functions: ranking, URL round-tripping, issue
// filtering and sorting, and the SLA verdict. Same shape as graphChips.test.js — the
// page's logic is tested here, the page's pixels are checked in the dev harness.

import { describe, expect, it } from "vitest";
import {
  DUE_SOON_DAYS,
  applyIssueFilters, comboParamPatch, conditionPresent, groupMatches, issueFilterOptions,
  rankGroups, readComboParams, shiftSegments, shiftSummary, slaState, sortIssues,
} from "../src/client/js/pages/comboView.js";

const GROUPS = [
  { id: "g-low", title: "Permissive identity", adjustedSeverity: "MEDIUM", count: 2 },
  { id: "g-small", title: "Bedrock", adjustedSeverity: "HIGH", count: 8 },
  { id: "g-big", title: "Managed", adjustedSeverity: "HIGH", count: 13 },
];

const NOW = Date.parse("2026-08-12T00:00:00Z");

describe("rankGroups", () => {
  it("orders worst severity first, then the bigger population", () => {
    expect(rankGroups(GROUPS).map((g) => g.id)).toEqual(["g-big", "g-small", "g-low"]);
  });

  it("breaks a full tie on title so the order never wobbles between paints", () => {
    const tied = [
      { id: "b", title: "Beta", adjustedSeverity: "HIGH", count: 4 },
      { id: "a", title: "Alpha", adjustedSeverity: "HIGH", count: 4 },
    ];
    expect(rankGroups(tied).map((g) => g.id)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = GROUPS.slice();
    rankGroups(input);
    expect(input.map((g) => g.id)).toEqual(["g-low", "g-small", "g-big"]);
  });

  it("survives an empty or missing list", () => {
    expect(rankGroups([])).toEqual([]);
    expect(rankGroups(undefined)).toEqual([]);
  });
});

describe("URL round-trip", () => {
  it("reads a full view back out of the hash", () => {
    const state = readComboParams({
      open: "gcp-managed-privileged", cond: "internet_exposure", sev: "high",
      q: "agent", acct: "gcp-account-01", proj: "PROJECT-ALPHA",
      sort: "due", dir: "-1", page: "3",
    });
    expect(state).toEqual({
      open: "gcp-managed-privileged", cond: "INTERNET_EXPOSURE", sev: "HIGH",
      q: "agent", acct: "gcp-account-01", proj: "PROJECT-ALPHA",
      sort: "due", dir: -1, page: 2, // 1-based in the URL, 0-based in the page
    });
  });

  it("drops values this page does not offer instead of trusting the link", () => {
    const state = readComboParams({
      cond: "NOT_A_CONDITION", sev: "SPICY", sort: "nonsense", page: "-4",
    });
    expect(state.cond).toBe("");
    expect(state.sev).toBe("");
    expect(state.sort).toBe("");
    expect(state.page).toBe(0);
  });

  it("defaults cleanly with no params at all", () => {
    expect(readComboParams(undefined)).toEqual({
      open: "", cond: "", sev: "", q: "", acct: "", proj: "",
      sort: "", dir: 1, page: 0,
    });
  });

  it("round-trips back to the same state", () => {
    const state = readComboParams({ open: "g-big", sev: "HIGH", sort: "due", dir: "-1", page: "2" });
    expect(readComboParams(comboParamPatch(state))).toEqual(state);
  });

  it("emits every key so clearing a filter removes it from the URL", () => {
    // buildHash drops empty values; a key left out entirely would keep its old value.
    const patch = comboParamPatch(readComboParams({ sev: "HIGH" }));
    expect(Object.keys(patch).sort()).toEqual(
      ["acct", "cond", "dir", "open", "page", "proj", "q", "sev", "sort"]);
    expect(patch.cond).toBe("");
  });

  it("only writes a direction when something is sorted", () => {
    expect(comboParamPatch({ dir: -1 }).dir).toBe("");
    expect(comboParamPatch({ sort: "due", dir: -1 }).dir).toBe("-1");
  });
});

describe("conditionPresent / groupMatches", () => {
  const tally = (o) => Object.assign({ required: false, carried: 0, unknown: 0, total: 4 }, o);

  it("counts a condition as present when tested, carried, or undetermined", () => {
    expect(conditionPresent(tally({ required: true }))).toBe(true);
    expect(conditionPresent(tally({ carried: 2 }))).toBe(true);
    expect(conditionPresent(tally({ unknown: 2 }))).toBe(true);
    expect(conditionPresent(tally({}))).toBe(false);
    expect(conditionPresent(null)).toBe(false);
  });

  it("filters patterns by severity and by condition", () => {
    const group = { adjustedSeverity: "HIGH" };
    const dg = { conditions: { INTERNET_EXPOSURE: tally({ carried: 1 }), SENSITIVE_DATA: tally({}) } };
    expect(groupMatches(group, dg, { sev: "HIGH" })).toBe(true);
    expect(groupMatches(group, dg, { sev: "MEDIUM" })).toBe(false);
    expect(groupMatches(group, dg, { cond: "INTERNET_EXPOSURE" })).toBe(true);
    expect(groupMatches(group, dg, { cond: "SENSITIVE_DATA" })).toBe(false);
  });

  it("hides a pattern under a condition filter when the digest is missing", () => {
    // A payload cached before the digest shipped can't answer the question. Showing the
    // pattern anyway would present an unfiltered list as a filtered one.
    expect(groupMatches({ adjustedSeverity: "HIGH" }, null, { cond: "SENSITIVE_DATA" })).toBe(false);
  });

  it("passes everything through with no filters set", () => {
    expect(groupMatches({ adjustedSeverity: "LOW" }, null, {})).toBe(true);
  });
});

describe("issue filtering", () => {
  const ROWS = [
    {
      id: "1", assetName: "Agent-A", adjustedSeverity: "HIGH", nativeSeverity: "MEDIUM",
      region: "europe-west1", account: "gcp-account-01", projects: ["PROJECT-ALPHA"],
      dueAt: "2026-08-18T00:00:00Z",
    },
    {
      id: "2", assetName: "agent-H-chatbot", adjustedSeverity: "HIGH", nativeSeverity: "MEDIUM",
      region: "us-west1", account: "gcp-account-05", projects: ["PROJECT-BETA", "PROJECT-ALPHA"],
    },
    {
      id: "3", assetName: "svc-billing", adjustedSeverity: "MEDIUM", nativeSeverity: "LOW",
      region: "europe-west4", account: "gcp-account-01", projects: [],
      dueAt: "2026-07-01T00:00:00Z",
    },
  ];

  it("filters on severity, account and project", () => {
    expect(applyIssueFilters(ROWS, { sev: "MEDIUM" }).map((r) => r.id)).toEqual(["3"]);
    expect(applyIssueFilters(ROWS, { acct: "gcp-account-01" }).map((r) => r.id)).toEqual(["1", "3"]);
    expect(applyIssueFilters(ROWS, { proj: "PROJECT-BETA" }).map((r) => r.id)).toEqual(["2"]);
  });

  it("searches asset, region, account and project, case-insensitively", () => {
    expect(applyIssueFilters(ROWS, { q: "AGENT" }).map((r) => r.id)).toEqual(["1", "2"]);
    expect(applyIssueFilters(ROWS, { q: "west4" }).map((r) => r.id)).toEqual(["3"]);
    expect(applyIssueFilters(ROWS, { q: "alpha" }).map((r) => r.id)).toEqual(["1", "2"]);
    expect(applyIssueFilters(ROWS, { q: "   " }).map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("combines filters conjunctively", () => {
    expect(applyIssueFilters(ROWS, { sev: "HIGH", acct: "gcp-account-01" }).map((r) => r.id))
      .toEqual(["1"]);
  });

  it("offers only the values actually present, sorted", () => {
    expect(issueFilterOptions(ROWS)).toEqual({
      accounts: ["gcp-account-01", "gcp-account-05"],
      projects: ["PROJECT-ALPHA", "PROJECT-BETA"],
    });
  });

  it("sorts by every column, and flips on the second click", () => {
    expect(sortIssues(ROWS, "asset", 1).map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(sortIssues(ROWS, "severity", 1).map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(sortIssues(ROWS, "severity", -1).map((r) => r.id)).toEqual(["3", "1", "2"]);
    expect(sortIssues(ROWS, "account", 1).map((r) => r.id)).toEqual(["1", "3", "2"]);
  });

  it("sorts the soonest deadline first and parks the undated rows last", () => {
    expect(sortIssues(ROWS, "due", 1).map((r) => r.id)).toEqual(["3", "1", "2"]);
    // Reversed, the undated row leads: it ranks as Infinity, and flipping the sign puts
    // the largest rank first. Asserted so the behaviour is a decision, not a surprise.
    expect(sortIssues(ROWS, "due", -1).map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("leaves the order alone when nothing is sorted, and never mutates", () => {
    const input = ROWS.slice();
    expect(sortIssues(input, "", 1).map((r) => r.id)).toEqual(["1", "2", "3"]);
    sortIssues(input, "asset", -1);
    expect(input.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
});

describe("slaState", () => {
  it("reads a deadline as a verdict", () => {
    expect(slaState("2026-08-05T00:00:00Z", NOW)).toEqual(
      { days: -7, kind: "bad", label: "Overdue 7d" });
    expect(slaState("2026-08-12T00:00:00Z", NOW)).toEqual(
      { days: 0, kind: "warn", label: "Due today" });
    expect(slaState("2026-08-30T00:00:00Z", NOW)).toEqual(
      { days: 18, kind: "neutral", label: "Due in 18d" });
  });

  it("puts the boundary day inside the warning window", () => {
    expect(slaState("2026-08-19T00:00:00Z", NOW).kind).toBe("warn"); // exactly 7 days
    expect(slaState("2026-08-20T00:00:00Z", NOW).kind).toBe("neutral");
    expect(DUE_SOON_DAYS).toBe(7); // mirrors src/domain/comboDigest.ts
  });

  it("returns null for a missing or unreadable date rather than guessing", () => {
    expect(slaState(undefined, NOW)).toBeNull();
    expect(slaState("", NOW)).toBeNull();
    expect(slaState("not a date", NOW)).toBeNull();
  });
});

describe("severity-shift bars", () => {
  it("scales both bars by the shared total so the widths compare", () => {
    const native = shiftSegments({ MEDIUM: 27, LOW: 2 }, 29);
    const adjusted = shiftSegments({ HIGH: 27, MEDIUM: 2 }, 29);
    expect(native.map((s) => s.sev)).toEqual(["MEDIUM", "LOW"]);
    expect(adjusted.map((s) => s.sev)).toEqual(["HIGH", "MEDIUM"]);
    expect(native[0].pct).toBeCloseTo(27 / 29);
    expect(adjusted[0].pct).toBeCloseTo(27 / 29);
  });

  it("orders segments worst-first and drops empty levels", () => {
    expect(shiftSegments({ LOW: 1, CRITICAL: 2, HIGH: 0 }, 3).map((s) => s.sev))
      .toEqual(["CRITICAL", "LOW"]);
  });

  it("falls back to its own sum when no total is given", () => {
    expect(shiftSegments({ HIGH: 1, LOW: 1 })[0].pct).toBeCloseTo(0.5);
  });

  it("handles an empty mix without dividing by zero", () => {
    expect(shiftSegments({}, 0)).toEqual([]);
    expect(shiftSegments(null, 0)).toEqual([]);
  });

  it("says what the amplifier did, including when it did nothing", () => {
    expect(shiftSummary({ reRated: 29, totalOpen: 29 }))
      .toBe("29 of 29 open issues re-rated up one level.");
    expect(shiftSummary({ reRated: 0, totalOpen: 4 }))
      .toBe("No issue was re-rated: Wiz severity is carried through as-is.");
    expect(shiftSummary({ reRated: 0, totalOpen: 0 })).toBe("");
  });
});
