// The VULN_FINDINGS step, and what happens to the register when the tenant refuses it.
//
// The step's own document is UNVERIFIED where it matters most: the related-issue selection is
// a guess until `phase0.mjs --stage=k` runs, so the most likely first contact with this tenant
// is an HTTP 400 naming the field. That is why the step is optional — and "optional" is only
// worth anything if the refusal is LOUD and the previous register survives it. Both halves are
// asserted here, because a silent skip is how zero edges once became indistinguishable from a
// healthy landscape.
//
// The three states this file keeps apart, in the order they cost the most to confuse:
//   refused    `vulnFindings` absent  → tab UNTOUCHED, issue columns absent, census null
//   measured   `vulnFindings: []`     → tab overwritten empty, census five zeroes
//   collected  `vulnFindings: [...]`  → tab written, issue columns stamped, census counted

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import {
  getSkipReasons, getStepRows, withSkipReasons, withSkippedSteps, withStepRows,
} from "../src/domain/settingsLogic";
import { PAGE_SIZE_WIDE } from "../src/server/wizQueriesAi";
import { isEditableStep, varSpecFor } from "../src/domain/scanVars";
import type { NormalizedVulnFinding } from "../src/domain/graphTypes";
import type { Rec } from "../src/domain/util";

type Step = {
  id: string; area: string; writes: string[]; optional: boolean; pageSize: number;
  rootField?: string; run?: string; variables?: Rec;
};

type Store = typeof import("../src/server/syncStore");
type Sample = typeof import("../src/server/sampleData");
type Sheets = typeof import("../src/server/sheetsDb");

let store: Store;
let sample: Sample;
let sheets: Sheets;

beforeEach(async () => {
  const server = await bootServer();
  server.setup();
  // Imported after the boot: `bootServer` resets the module registry, so the store the server
  // writes through is only reachable from a fresh import.
  store = await import("../src/server/syncStore");
  sample = await import("../src/server/sampleData");
  sheets = await import("../src/server/sheetsDb");
});

afterAll(() => teardownServer());

/** The step as the battery describes it, without credentials. */
async function stepDef(): Promise<Step> {
  const server = await bootServer();
  server.setup();
  const steps = server.jobs.describeSyncSteps() as unknown as Step[];
  const s = steps.find((x) => x.id === "VULN_FINDINGS");
  expect(s, `no VULN_FINDINGS in [${steps.map((x) => x.id).join(", ")}]`).toBeDefined();
  return s as Step;
}

let syncSeq = 0;

/** One persisted sync over the seed landscape, with whatever exploitation evidence is given. */
function persist(extras: { vulnFindings?: NormalizedVulnFinding[] } = {}): void {
  syncSeq += 1;
  const startedAt = `2026-09-0${syncSeq}T00:00:00.000Z`;
  store.persistSync(
    sample.seedGraphDoc(startedAt),
    sample.SEED_ISSUES,
    sample.SEED_AARS_HINTS,
    { syncId: `sync-vf-${syncSeq}`, mode: "live", startedAt, apiCalls: 0 },
    undefined,
    sample.SEED_FINDINGS,
    [], [], [], [],
    extras,
  );
}

function exploitationRows(): Rec[] {
  return sheets.readAll(sheets.TABS.issueExploitation);
}

function latestHistory(): Rec {
  const history = store.syncHistory();
  return history[history.length - 1] as Rec;
}

/** A seed issue id, so the fold has something in THIS register to land on. */
function seedIssueId(): string {
  const id = sample.SEED_ISSUES[0]?.id;
  expect(id, "the seed landscape carries no issues").toBeTruthy();
  return String(id);
}

function evidence(over: Partial<NormalizedVulnFinding> = {}): NormalizedVulnFinding {
  return {
    id: "vf-1",
    hasKev: true,
    hasExploit: true,
    epss: 0.62,
    issueIds: [seedIssueId()],
    ...over,
  };
}

describe("the battery declares the step, and declares it optional", () => {
  it("names the connection, the area and the wide page", async () => {
    const s = await stepDef();
    expect([s.run, s.rootField]).toEqual(["connection", "vulnerabilityFindings"]);
    expect(s.area).toBe("toxic");
    expect(s.writes).toEqual(["ai_issue_exploitation", "ai_issues"]);
    // ~15 pages at 500 against ~74 at the default, on eleven flat scalars and a union read.
    expect(s.pageSize).toBe(PAGE_SIZE_WIDE);
  });

  it("is OPTIONAL — the only thing standing between a wrong guess and a failed sync", () => {
    // The related-issue selection is unverified (see Q_VULN_FINDINGS). A non-optional step
    // carrying that guess would take the whole battery down on its first page; optional makes
    // it a recorded skip with Wiz's own message, which names the field.
    return stepDef().then((s) => expect(s.optional).toBe(true));
  });

  it("is LOCKED, because its filter is the claim rather than a scope knob", () => {
    expect(isEditableStep("VULN_FINDINGS")).toBe(false);
    const spec = varSpecFor("VULN_FINDINGS");
    expect(spec).not.toBeNull();
    expect(spec!.fields).toEqual([]);
    // A lock without a reason reads as an oversight and someone will "fix" it.
    expect(spec!.locked).toContain("issue_categories");
    expect(spec!.locked).toMatch(/five million/i);
  });
});

describe("a refused step is recorded, not swallowed", () => {
  it("keeps the step id AND the tenant's own message", () => {
    // The message is the diagnostic half: on this step it is what would name the related-issue
    // field this tenant actually has, which is the entire content of the finding.
    const MSG = 'Wiz query failed (HTTP 400): Cannot query field "relatedIssues" on type '
      + '"VulnerabilityFinding".';
    const s = withSkipReasons(withSkippedSteps({}, ["VULN_FINDINGS"]), { VULN_FINDINGS: MSG });
    expect(s["last_skipped_steps"]).toEqual(["VULN_FINDINGS"]);
    expect(getSkipReasons(s)["VULN_FINDINGS"]).toBe(MSG);
  });

  it("distinguishes a first-page refusal from a step that ran and matched nothing", () => {
    // The two conditions the commit path reads. A refusal before any page came back leaves NO
    // stepRows entry; a step that ran and matched nothing records a zero, and that zero is a
    // measurement. Folding them together is what would let a rejected query blank the tab.
    const refused = withSkippedSteps({}, ["VULN_FINDINGS"]);
    expect(getStepRows(refused)["VULN_FINDINGS"]).toBeUndefined();
    const ran = withStepRows({}, { VULN_FINDINGS: 0 });
    expect(getStepRows(ran)["VULN_FINDINGS"]).toBe(0);
  });
});

describe("what a refusal does to the persisted register", () => {
  it("leaves the tab and the issue columns absent when no pass ran", () => {
    persist();
    expect(exploitationRows()).toEqual([]);
    for (const row of sheets.readAll(sheets.TABS.issues)) {
      expect([row["id"], row["exploitation_tier"]]).toEqual([row["id"], null]);
      expect(row["epss_peak"]).toBeNull();
      expect(row["exploitation_findings"]).toBeNull();
    }
    // NULL, not a zeroed census: "no issue carries exploitation evidence" and "we never asked"
    // are different claims, and the trend plots the second as a gap.
    expect(latestHistory()["exploitation_json"]).toBeNull();
  });

  it("reads it back as undefined, never as the `none` tier", () => {
    // The distance this whole axis is built on: `rank.exploitationOf` drops an absent tier out
    // of the blend and scores `none` as a measurement. A reader defaulting the blank would
    // score every un-scanned register as one where nothing is exploited.
    persist();
    const issues = store.loadIssues();
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect([issue.id, issue.exploitationTier]).toEqual([issue.id, undefined]);
      expect(issue.epssPeak).toBeUndefined();
      expect(issue.exploitationFindingCount).toBeUndefined();
    }
  });

  it("does NOT blank a tab an earlier sync measured", () => {
    // The whole reason the guard is on the null rather than on emptiness. A tenant that starts
    // refusing this document must not lose the evidence a working sync collected — the failure
    // is not the missing row, it is the register silently reporting no exploitation at all.
    persist({ vulnFindings: [evidence()] });
    expect(exploitationRows().length).toBe(1);
    persist();
    expect(exploitationRows().length).toBe(1);
    expect(exploitationRows()[0]!["issue_id"]).toBe(seedIssueId());
    // And the commit record for THIS sync still says it measured nothing, so the two never
    // disagree about which scan the evidence came from.
    expect(latestHistory()["exploitation_json"]).toBeNull();
  });

  it("overwrites the tab when the step RAN and matched nothing", () => {
    // The other half of the same guard: a register still claiming a KEV after every finding
    // was fixed is worse than an empty one, so a measured empty really does wipe.
    persist({ vulnFindings: [evidence()] });
    expect(exploitationRows().length).toBe(1);
    persist({ vulnFindings: [] });
    expect(exploitationRows()).toEqual([]);
    expect(JSON.parse(String(latestHistory()["exploitation_json"]))).toEqual({
      kev: 0, exploit: 0, epss: 0, none: 0, unknown: 0,
      unjoined: 0, droppedNotInRegister: 0, findings: 0,
    });
  });
});

describe("what a collected pass does", () => {
  it("writes the evidence, stamps the issue, and records the census", () => {
    persist({
      vulnFindings: [
        evidence({ id: "vf-1" }),
        evidence({ id: "vf-2", hasKev: null, hasExploit: null, epss: null }),
        // Named an issue outside this register: dropped and COUNTED.
        evidence({ id: "vf-3", issueIds: ["iss-not-here"] }),
        // Named no issue at all: the join field, not the estate.
        evidence({ id: "vf-4", issueIds: [] }),
      ],
    });

    const rows = exploitationRows();
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row["issue_id"]).toBe(seedIssueId());
    // KEV survives the all-null second reading — booleans go null → false → true, never back.
    expect(row["tier"]).toBe("kev");
    expect(row["has_kev"]).toBe("true");
    expect(Number(row["epss_peak"])).toBe(0.62);
    expect(Number(row["finding_count"])).toBe(2);
    expect(String(row["sample_finding_ids"]).split(",").sort()).toEqual(["vf-1", "vf-2"]);

    // And through the reader, so the tri-state survives the cell rather than only the writer:
    // the second finding's three nulls must NOT have overwritten the first's measurements.
    const [loaded] = store.loadExploitation();
    expect(loaded).toEqual({
      issueId: seedIssueId(),
      tier: "kev",
      hasKev: true,
      hasExploit: true,
      epssPeak: 0.62,
      findingCount: 2,
      sampleFindingIds: ["vf-1", "vf-2"],
      observedAt: loaded!.observedAt,
    });
    expect(loaded!.observedAt).toBeTruthy();

    const stamped = store.loadIssues().find((i) => i.id === seedIssueId());
    expect(stamped!.exploitationTier).toBe("kev");
    expect(stamped!.epssPeak).toBe(0.62);
    expect(stamped!.exploitationFindingCount).toBe(2);
    // Every OTHER issue stays absent rather than gaining a "none" the fold never wrote.
    for (const issue of store.loadIssues()) {
      if (issue.id === seedIssueId()) continue;
      expect([issue.id, issue.exploitationTier]).toEqual([issue.id, undefined]);
    }

    expect(JSON.parse(String(latestHistory()["exploitation_json"]))).toEqual({
      kev: 1, exploit: 0, epss: 0, none: 0, unknown: 0,
      unjoined: 1, droppedNotInRegister: 1, findings: 4,
    });
  });
});
