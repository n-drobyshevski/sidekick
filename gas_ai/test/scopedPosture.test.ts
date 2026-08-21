// Project-scoped compliance posture: the page's numbers re-aggregated by WIZ for the
// project in the sidebar, rather than re-sliced locally (which is impossible — a
// PostureRow carries no asset id).
//
// The feature is one substitution in getCompliance, so the tests that matter are about
// WHAT WAS ASKED and WHAT HAPPENS WHEN IT CANNOT BE. The arithmetic downstream is already
// covered by compliancePosture / complianceOverview / fiveRsPosture; re-asserting it here
// would only pin the fixture.
//
// Every live case stubs UrlFetchApp, which dev/gas-shims.js otherwise makes throw. That is
// what makes the stored-path assertions real: a handler that reached the network on a
// tenantless checkout would fail loudly here, not quietly serve the register.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type Server = Awaited<ReturnType<typeof bootServer>>;
let server: Server;

const LEAF = "proj-project-alpha";
/** Every framework the seed carries posture for — what a scoped read has to re-ask about. */
const SEEDED = ["wf-id-106", "wf-id-201", "wf-id-214", "wf-id-275"];
/** Distinctive enough that no seeded figure could be mistaken for it. */
const SCOPED_PCT = 42;

function ok<T = Rec>(res: unknown): T {
  const r = res as { ok: boolean; error?: string; data?: T };
  expect(r.ok, r.error).toBe(true);
  return r.data as T;
}

function setView(id: string): void {
  ok(server.api.setSettings({ projectView: id }));
}

function compliance(): Rec {
  return ok<Rec>(server.api.getCompliance({}));
}

function scopeOf(data: Rec): Rec {
  const scope = data["postureScope"] as Rec | undefined;
  expect(scope, "no postureScope on the compliance payload").toBeDefined();
  return scope as Rec;
}

/** Credentials the live path checks for. The URL is never reached — fetch is stubbed. */
function giveCredentials(): void {
  const props = (globalThis as unknown as {
    PropertiesService: GoogleAppsScript.Properties.PropertiesService;
  }).PropertiesService.getScriptProperties();
  props.setProperty("WIZ_API_URL", "https://api.test.wiz.io/graphql");
  props.setProperty("WIZ_API_TOKEN", "test-token");
}

/**
 * The 5Rs policies the stub reports for the project, chosen to exercise both halves of
 * `withCountsFrom`:
 *
 *   - pol-SUB-047 IS selected by the register-wide 5Rs scope (linkedFindings, in the seed),
 *     so its scoped counts must reach the derived posture — 8/2, not the register's
 *     1,769/21.
 *   - pol-DATA-402 is NOT selected (noAiLink), and carries counts large enough that leaking
 *     it into the arithmetic would be unmissable.
 *   - the seed's other two selected rules (pol-IAM-236, pol-SUB-082) are deliberately
 *     ABSENT from this answer: Wiz assessed nothing for them in this project, which is the
 *     drop-not-zero case. Zeroed instead, they would count as clean controls and lift
 *     controlPassPct on evidence that does not exist.
 */
const FIVE_RS_SCOPED_POLICIES = [
  { policyId: "pol-SUB-047", passCount: 8, failCount: 2 },
  { policyId: "pol-DATA-402", passCount: 500, failCount: 100 },
];

function policyAnalytics(policyId: string, passCount: number, failCount: number): Rec {
  return {
    failCount,
    passCount,
    rejectedCount: 0,
    assessedCount: passCount + failCount,
    noResourceToAsses: false,
    control: {
      id: policyId,
      name: `Scoped ${policyId}`,
      description: "",
      enabled: true,
      builtin: true,
      severity: "HIGH",
      scopeQuery: null,
    },
    cloudConfigurationRule: null,
    hostConfigurationRule: null,
  };
}

/**
 * One framework's posture as Wiz would send it for a narrower population: one category,
 * one subcategory, and a percentage nothing in the seed uses. The 5Rs gets the policy set
 * above; every other framework gets a single control of its own.
 */
function scopedFramework(id: string, name: string): Rec {
  const policies = id === "wf-id-214"
    ? FIVE_RS_SCOPED_POLICIES.map((p) => policyAnalytics(p.policyId, p.passCount, p.failCount))
    : [policyAnalytics(`${id}-policy`, 4, 1)];
  const passCount = policies.reduce((n, p) => n + Number(p["passCount"]), 0);
  const failCount = policies.reduce((n, p) => n + Number(p["failCount"]), 0);
  return {
    id,
    name,
    description: "scoped",
    builtin: true,
    enabled: true,
    complianceAnalytics: {
      passSubCategoryCount: 1,
      failSubCategoryCount: 0,
      averageCompliancePosture: SCOPED_PCT,
      emptyPostureReason: null,
      categoryAnalytics: [{
        category: { id: `${id}-c1`, name: "Scoped category", description: "", externalId: "C1" },
        passCount,
        failCount,
        passSubCategoryCount: 1,
        failSubCategoryCount: 0,
        averageCompliancePosture: SCOPED_PCT,
        emptyPostureReason: null,
        subCategoryAnalytics: [{
          passCount,
          failCount,
          compliancePosture: SCOPED_PCT,
          emptyPostureReason: null,
          subCategory: {
            id: `${id}-s1`,
            title: "Scoped subcategory",
            description: "",
            externalId: "C1.1",
            assessmentScope: null,
            mappingRationale: null,
            tags: [],
          },
          policyAnalytics: policies,
        }],
      }],
    },
  };
}

/** Every request the stub saw, in order — the variables are the point of this feature. */
let sent: Rec[] = [];

/**
 * Stand in for Wiz. `failFor` names a framework id whose fetch throws, for the
 * all-or-nothing case; everything else answers with `scopedFramework`.
 */
function stubWiz(options: { failFor?: string } = {}): void {
  sent = [];
  (globalThis as unknown as { UrlFetchApp: Rec }).UrlFetchApp = {
    fetch: (_url: string, params: Rec) => {
      const body = JSON.parse(String(params["payload"])) as Rec;
      const variables = (body["variables"] ?? {}) as Rec;
      sent.push(variables);
      const id = String(variables["id"] ?? "");
      if (options.failFor && id === options.failFor) {
        return { getResponseCode: () => 500, getContentText: () => "boom" };
      }
      const name = SEED_NAMES[id] ?? id;
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          data: { securityFramework: scopedFramework(id, name) },
        }),
      };
    },
  };
}

/**
 * The seeded names, echoed back by the stub. Not decoration: `scopeFiveRs` finds the 5Rs
 * tree by NAME FAMILY, never by id (complianceScope.ts says why), so a stub that renamed
 * wf-id-214 would silently take the 5Rs out of the scoped payload and the derived-posture
 * assertion below would pass for the wrong reason.
 */
const SEED_NAMES: Record<string, string> = {
  "wf-id-275": "OWASP Top 10 For Agentic Applications 2026",
  "wf-id-214": "5Rs - Wiz for Data Security",
  "wf-id-106": "OWASP ML Security Top 10",
  "wf-id-201": "OWASP LLM Security Top 10",
};

beforeEach(async () => {
  teardownServer();
  server = await bootServer();
  server.setup();
  const res = server.api.runSync({}) as { ok: boolean; error?: string };
  if (!res.ok) throw new Error(`seed sync failed: ${res.error}`);
});

afterEach(() => {
  teardownServer();
});

describe("postureScope, unscoped", () => {
  it("says register-wide with no reason when no project is in view", () => {
    setView("");
    const scope = scopeOf(compliance());
    expect(scope["projectId"]).toBe("");
    expect(scope["source"]).toBe("stored");
    // Null, not "noCredentials": nothing was refused, nothing was asked. The page draws no
    // note at all in this state, and a reason here would make it draw one.
    expect(scope["reason"]).toBeNull();
    expect(scope["fetchedAt"]).toBeNull();
  });
});

describe("postureScope, scoped without credentials", () => {
  it("keeps the stored figures, says why, and does not call out", () => {
    // dev/gas-shims.js throws on UrlFetchApp.fetch, so "did not throw" IS the assertion
    // that no live call was attempted. The compliance page has to stay fully usable on a
    // tenantless checkout — that is how this app is developed.
    setView("");
    const wide = compliance();
    setView(LEAF);
    const scoped = compliance();

    const scope = scopeOf(scoped);
    expect(scope["projectId"]).toBe(LEAF);
    expect(scope["source"]).toBe("stored");
    expect(scope["reason"]).toBe("noCredentials");
    expect((scoped["kpis"] as Rec)["averagePosture"])
      .toBe((wide["kpis"] as Rec)["averagePosture"]);
  });
});

describe("postureScope, scoped with credentials", () => {
  beforeEach(() => {
    giveCredentials();
  });

  it("asks Wiz for the project in view, once per collected framework", () => {
    stubWiz();
    setView(LEAF);
    const scope = scopeOf(compliance());

    expect(scope["source"]).toBe("live");
    expect(scope["frameworkCount"]).toBe(SEEDED.length);
    expect(scope["fetchedAt"]).toBeTruthy();
    expect(scope["reason"]).toBeNull();

    // THE CRUX. `analyticsSelection.projectId` is the field that makes this feature
    // possible at all — the sync has always sent the FETCH scope through it, and this
    // sends the VIEW scope through the same slot. A regression that dropped it would leave
    // every assertion above green and quietly relabel register-wide figures as this
    // project's, which is the one outcome worse than not scoping.
    expect(sent.map((v) => v["id"]).sort()).toEqual(SEEDED);
    for (const variables of sent) {
      expect((variables["analyticsSelection"] as Rec)["projectId"]).toEqual([LEAF]);
    }
  });

  it("rebuilds every band from Wiz's scoped answer, not just the hero", () => {
    stubWiz();
    setView(LEAF);
    const data = compliance();

    // One substitution upstream re-scopes all of these together, so one of them still
    // reading the seed would mean the substitution landed in the wrong place.
    expect((data["kpis"] as Rec)["averagePosture"]).toBe(SCOPED_PCT);
    for (const tree of data["trees"] as Rec[]) {
      expect(tree["posturePct"], `tree ${tree["frameworkId"]} kept its seeded figure`)
        .toBe(SCOPED_PCT);
    }
    for (const row of data["rail"] as Rec[]) {
      expect(row["posturePct"]).toBe(SCOPED_PCT);
    }
  });

  it("still ships the REGISTER-WIDE 5Rs scope, because its toggle writes a global pin", () => {
    setView("");
    const wideScope = compliance()["fiveRsScope"] as Rec;

    stubWiz();
    setView(LEAF);
    const data = compliance();
    const scope = data["fiveRsScope"] as Rec;

    // The verdicts an operator overturns in Settings must not depend on which project the
    // sidebar happens to be showing — see scopedFrameworkPolicies' own note. The scoped
    // trees carry one policy per framework; if this shipped the rescoped object instead,
    // `total` would collapse to that.
    expect(scope["total"]).toBe(wideScope["total"]);
    expect(scope["selected"]).toBe(wideScope["selected"]);
  });

  it("derives the 5Rs posture from the scoped counts, keeping the register's verdicts", () => {
    setView("");
    const wideDerived = compliance()["fiveRsPosture"] as Rec;
    // The seed's register-wide answer: three active rules, 1,769 pass / 21 fail.
    expect(wideDerived["activePolicyCount"]).toBe(3);
    expect(wideDerived["passCount"]).toBe(1769);

    stubWiz();
    setView(LEAF);
    const data = compliance();
    const derived = data["fiveRsPosture"] as Rec;

    // The one figure that could have been left describing the register on a page describing
    // a project. See FIVE_RS_SCOPED_POLICIES for what each number here proves: 8/2 means the
    // counts came from Wiz's scoped answer; activePolicyCount 1 means the two rules Wiz
    // assessed nothing for were DROPPED rather than zeroed into clean controls; and the
    // absence of 500/100 means the register-wide "not in AI scope" verdict was still applied.
    expect(derived["passCount"]).toBe(8);
    expect(derived["failCount"]).toBe(2);
    expect(derived["activePolicyCount"]).toBe(1);
    expect(derived["posturePct"]).toBe(80);
    // Wiz's own framework figure travels alongside as always, and is the SCOPED one now —
    // the two claims still answer different questions, about the same population.
    expect(derived["wizPosturePct"]).toBe(SCOPED_PCT);

    // The same verdict, applied one layer up: the out-of-scope rule is not in the tree the
    // register draws either, or the page would list a rule its own percentage excludes.
    const fiveRs = (data["trees"] as Rec[]).find((t) => t["frameworkId"] === "wf-id-214") as Rec;
    const ids = ((fiveRs["categories"] as Rec[])[0]["subcategories"] as Rec[])[0]["policies"] as Rec[];
    expect(ids.map((p) => p["policyId"])).toEqual(["pol-SUB-047"]);
  });

  it("dates the answer, not the read", () => {
    // The stamp says "asked at X" and the page prints it beside figures whose whole point is
    // that they run on a different clock from the rest of the app. Stamped by the caller
    // instead of inside the cached fetch, it would restart on every cache hit and claim a
    // response up to six hours old had just been asked for — the one claim the field exists
    // to make, made wrongly, and invisible without this.
    stubWiz();
    setView(LEAF);
    const asked = scopeOf(compliance())["fetchedAt"];

    // An hour later, with the Wiz responses still cached (WIZ_DATA_VERSION has not moved —
    // only DATA_VERSION, which setSettings bumps and which does not invalidate them).
    vi.setSystemTime(new Date(Date.now() + 3_600_000));
    setView("");
    setView(LEAF);

    expect(sent.length, "the cached responses were re-fetched").toBe(SEEDED.length);
    expect(scopeOf(compliance())["fetchedAt"]).toBe(asked);
  });

  it("caches per project, so flipping back does not pay Wiz again", () => {
    stubWiz();
    setView(LEAF);
    compliance();
    const first = sent.length;
    expect(first).toBe(SEEDED.length);

    // Away and back. The read-model cache is keyed on DATA_VERSION, which every setSettings
    // bumps, so the second read of LEAF recomputes — and must still find the WIZ responses,
    // which are keyed on WIZ_DATA_VERSION and did not go stale because a setting moved.
    setView("");
    compliance();
    setView(LEAF);
    compliance();

    expect(sent.length, "a project switch re-paid for responses already held").toBe(first);
  });
});

describe("postureScope, when one framework refuses", () => {
  beforeEach(() => {
    giveCredentials();
  });

  it("falls back to the register wholesale rather than mixing two populations", () => {
    setView("");
    const wide = compliance();

    stubWiz({ failFor: "wf-id-201" });
    setView(LEAF);
    const data = compliance();
    const scope = scopeOf(data);

    // ALL OR NOTHING. Three frameworks scoped to the project and a fourth left at the
    // register's would put the landscape mean over two populations at once — the exact
    // failure this codebase refuses everywhere else. So one refusal drops the whole read.
    expect(scope["source"]).toBe("stored");
    expect(scope["reason"]).toBe("fetchFailed");
    expect(String(scope["detail"])).toContain("500");
    expect((data["kpis"] as Rec)["averagePosture"])
      .toBe((wide["kpis"] as Rec)["averagePosture"]);
    for (const tree of data["trees"] as Rec[]) {
      expect(tree["posturePct"]).not.toBe(SCOPED_PCT);
    }
  });
});
