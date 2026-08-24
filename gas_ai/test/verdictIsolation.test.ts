// THE GUARD ON THE WHOLE ISOLATION, and the reason it is a test rather than a convention.
//
// This app derives three verdicts of its own — the AARS findings score, the posture tier,
// and the problem tree's ACT/ATTEND/TRACK*/TRACK outcome. All three are experimental and
// all three are confined to the Scoring Models page (route `aars`), because measured over
// this landscape they do not separate what they claim to separate:
// ai/AARS_SCORING_ASSESSMENT.md §3 records the same rule and thresholds putting 100% of
// the demo estate in CRITICAL and 97.58% of a live estate in INFO.
//
// Confining them was a change across ~40 files. Keeping them confined is a property that
// decays the moment someone adds a column, and it decays SILENTLY: a verdict field riding
// along in a payload renders nothing until a page reads it, and the page that reads it
// looks like a one-line feature. So the rule is enforced where it can actually be checked
// — on the wire.
//
// WHAT THIS ASSERTS: no read endpoint outside the workbench's own may emit a verdict key,
// at any depth, in any row. WHAT IT DELIBERATELY DOES NOT: the three rule endpoints
// (`getAarsRule`, `getProblemRule`, `getPostureRule`) and the aggregates on `bootstrap`
// are the workbench's own data — a model under calibration has to be visible to the page
// that calibrates it, and that page is the whole point of the exemption.
//
// It is a separate file from apiGolden.test.ts on purpose. That snapshot would ALSO catch
// a re-introduced field, but it catches it as a diff among hundreds of lines that a
// hurried reader updates with `-u`. This one fails with the field's name and the endpoint
// that leaked it, and it cannot be re-recorded.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { READ_APIS, bootServer, teardownServer } from "./gasEnv";

type Server = Awaited<ReturnType<typeof bootServer>>;
let server: Server;

/**
 * Keys that name a derived verdict, matched exactly.
 *
 * Exact rather than by prefix: `aarsRule` and `aarsScored` are legitimate on the endpoints
 * exempted below, and a `startsWith("aars")` sweep would either fail on those or force the
 * exemption list wider than it should be. Every name here is a per-asset or per-problem
 * CLAIM; none of them is a rule, a setting or a count.
 */
const VERDICT_KEYS = [
  // AARS — the score, its band, its rank, its parts, and the inputs it was priced from.
  "aars", "aarsSeverity", "aarsPercentile", "aarsPillars", "aarsInput", "aarsRuleVersion",
  // The posture lattice.
  "postureTier", "postureInput",
  // The problem tree.
  "problemOutcome", "problemInput", "worstOpenProblem", "worstOutcome", "outcomeMix",
  "outcomeCounts",
];

/**
 * The endpoints the workbench itself calls. Everything else in READ_APIS is a page.
 *
 * `bootstrap` is here because it is the app shell's single load and carries `aarsRule`
 * (the thresholds the workbench edits) plus two landscape AGGREGATES — `byAarsSeverity`
 * and `aarsScored` — which the glossary's own counts read. An aggregate over the whole
 * landscape is a distribution, not a verdict about an asset; that distinction is the one
 * ai/AARS_SCORING_ASSESSMENT.md §7 draws, and it is why the trend and the discrimination
 * panel survived the same cut.
 */
const WORKBENCH_APIS = new Set([
  "bootstrap", "getAarsRule", "getProblemRule", "getPostureRule",
]);

/** Every path at which a forbidden key appears, so a failure names the field AND its home. */
function verdictPaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    // Index elided: a verdict on row 200 is the same defect as one on row 0, and pinning
    // the index would make the message churn with the seed data.
    return value.flatMap((v) => verdictPaths(v, path + "[]"));
  }
  if (!value || typeof value !== "object") return [];
  const out: string[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? path + "." + key : key;
    if (VERDICT_KEYS.indexOf(key) >= 0) out.push(here);
    out.push(...verdictPaths(v, here));
  }
  return out;
}

describe("the derived verdicts reach the workbench and nothing else", () => {
  beforeAll(async () => {
    server = await bootServer();
    server.setup();
    const res = server.api.runSync({}) as { ok: boolean; error?: string };
    if (!res.ok) throw new Error("seed sync failed: " + res.error);
  });

  afterEach(() => {
    teardownServer();
  });

  const pageApis = READ_APIS.filter(([name]) => !WORKBENCH_APIS.has(name));

  it("covers every page endpoint the golden suite covers", () => {
    // Without this, adding an endpoint to READ_APIS and forgetting this file would leave
    // the new surface unguarded and every test still green.
    expect(pageApis.length).toBeGreaterThan(10);
  });

  for (const [name, params, label] of pageApis) {
    it((label || name) + " emits no verdict", () => {
      const fn = (server.api as unknown as Record<string, (p: unknown) => unknown>)[name];
      expect(fn, "no such endpoint: " + name).toBeTruthy();
      const res = fn(params) as { ok: boolean; data?: unknown; error?: string };
      expect(res.ok, "api." + name + " failed: " + res.error).toBe(true);
      const found = verdictPaths(res.data);
      expect(
        found,
        (label || name) + " publishes a derived verdict: " + [...new Set(found)].join(", "),
      ).toEqual([]);
    });
  }

  it("still lets the workbench see all three models", () => {
    // The exemption has to be REAL, not merely unenforced: if these ever stopped carrying
    // their model, the page that calibrates it would be editing a rule it cannot evaluate,
    // and every assertion above would still pass.
    const rule = server.api.getAarsRule({}) as { ok: boolean; data: Record<string, unknown> };
    expect(rule.ok).toBe(true);
    expect(rule.data["rule"]).toBeTruthy();
    expect(rule.data["bandRanges"]).toBeTruthy();

    const boot = server.api.bootstrap({}) as { ok: boolean; data: Record<string, unknown> };
    const counts = boot.data["counts"] as Record<string, unknown>;
    expect(counts["byAarsSeverity"]).toBeTruthy();
    expect(counts["aarsScored"]).toBeGreaterThan(0);
  });

  it("still persists all three models, which is what makes the workbench honest", async () => {
    // The cut was "publish nowhere else", never "stop computing". A rule preview, a
    // recompute and the discrimination panel all price the landscape as it is STORED, so a
    // change that quietly stopped writing these columns would empty the workbench while
    // leaving every page above perfectly clean.
    const syncStore = await import("../src/server/syncStore");
    const assets = syncStore.loadAssets();
    expect(assets.filter((a) => typeof a.aars === "number").length).toBeGreaterThan(0);
    expect(assets.filter((a) => a.postureTier !== undefined).length).toBeGreaterThan(0);
    const issues = syncStore.loadIssues();
    expect(issues.filter((i) => i.problemOutcome).length).toBeGreaterThan(0);
  });
});
