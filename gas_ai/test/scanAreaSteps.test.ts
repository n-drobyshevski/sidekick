// The join between the Wiz Scans area list and the sync battery: every area's drill-down
// finds its own queries, and every step lands in an area that exists.
//
// This exists because of a shipped defect that nothing could see. `scanSheet.js` builds an
// area's drill-down by filtering the step descriptors on `step.area === area.id`, and the
// two compliance-posture steps (FRAMEWORKS_LIST and COMPLIANCE_POSTURE_<framework>) were
// tagged `area: "compliance"` — the CONFIGURATION FINDINGS area — when posture was split out
// into an area of its own. The result was two lies on the one page whose entire subject is
// provenance: the posture area, reporting a live 94%, rendered "No sync step issues a query
// for this area" and lost its whole "Where this number comes from" block (provenanceSection
// early-returns when an area has neither steps nor a `carriedBy`), while the findings area
// beside it displayed two `securityFramework` documents it does not send.
//
// Neither end is wrong on its own — the area exists, the steps exist, both run — so no
// type, no test and no runtime error could reach it. Only the join is wrong, and only a
// test that holds both lists at once can see that. Hence this file.
//
// An area with NO step is legitimate in exactly two shapes, and both must say so out loud:
// `coverage: "unscanned"` (no query runs at all — supply chain) or `carriedBy` (the flags
// ride on another area's rows — DSPM used to). Anything else is the defect above.

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { bootServer, teardownServer } from "./gasEnv";
// @ts-expect-error — client module is plain JS, no d.ts
import { SCAN_AREAS } from "../src/client/js/scanContent.js";

type Area = { id: string; title: string; coverage?: string; carriedBy?: string };
type Step = { id: string; area: string; writes?: string[] };

const AREAS = SCAN_AREAS as Area[];

let steps: Step[];

beforeAll(async () => {
  const server = await bootServer();
  server.setup();
  // The battery itself. This used to read `api.getScanQueries().steps`, on the argument that
  // going through the endpoint meant "a step that never reaches the client counts as absent
  // here too" — and that argument is now served by the last spec in this file instead, which
  // asserts the union of `getScanStepDetail` over every area IS the battery. That is the
  // property the page/sheet split has to preserve, and it is a stronger claim than reading
  // one endpoint happened to make.
  steps = server.jobs.describeSyncSteps() as unknown as Step[];
});

afterAll(() => teardownServer());

const areasWithSteps = () => new Set(steps.map((s) => s.area));
const stepsFor = (areaId: string) => steps.filter((s) => s.area === areaId);

describe("every step lands in an area that exists", () => {
  it("tags no step to an area the page does not render", () => {
    const known = new Set(AREAS.map((a) => a.id));
    const orphans = steps.filter((s) => !known.has(s.area)).map((s) => `${s.id} → ${s.area}`);
    // A step tagged to a missing area is invisible rather than misplaced: its document
    // appears in no drill-down at all, which is the same failure one degree worse.
    expect(orphans).toEqual([]);
  });

  it("gives every step an area", () => {
    expect(steps.filter((s) => !s.area).map((s) => s.id)).toEqual([]);
  });
});

describe("every area accounts for its queries", () => {
  it("gives each area at least one step, or says why it has none", () => {
    const owned = areasWithSteps();
    const unexplained = AREAS
      .filter((a) => !owned.has(a.id) && a.coverage !== "unscanned" && !a.carriedBy)
      .map((a) => `${a.id} (${a.title})`);
    // This is the assertion that would have caught the posture defect: `posture` owned no
    // step, declared no `carriedBy`, and was not `unscanned` — it resolved a live figure
    // from data some OTHER area's drill-down claimed to fetch.
    expect(unexplained).toEqual([]);
  });

  it("keeps supply chain the only area with no query, and declares it", () => {
    const owned = areasWithSteps();
    const stepless = AREAS.filter((a) => !owned.has(a.id) && !a.carriedBy);
    expect(stepless.map((a) => a.id)).toEqual(["supply"]);
    expect(stepless[0]!.coverage).toBe("unscanned");
  });
});

describe("the two compliance areas own their own queries", () => {
  it("puts the framework catalogue and every posture step on the posture area", () => {
    const ids = stepsFor("posture").map((s) => s.id);
    expect(ids).toContain("FRAMEWORKS_LIST");
    // One step per SELECTED framework, and the default selection is never empty, so this
    // holds on a cold boot as well as a configured one.
    expect(ids.filter((id) => id.indexOf("COMPLIANCE_POSTURE_") === 0).length).toBeGreaterThan(0);
  });

  it("leaves the findings area with the configuration queries and nothing else", () => {
    const ids = stepsFor("configFindings").map((s) => s.id);
    expect(ids).toContain("CONFIG_FINDINGS");
    // A SUBSET check rather than an exact list, because CONFIG_RULES is gated on catalogue
    // freshness and legitimately absent on a tenant that collected it recently. What must
    // hold either way is that nothing ELSE is here.
    expect(ids.filter((id) => id !== "CONFIG_FINDINGS" && id !== "CONFIG_RULES")).toEqual([]);
  });

  it("shows no securityFramework document in the findings drill-down", () => {
    // The user-visible symptom, asserted as such: whatever the tags say, the findings area
    // must not display the posture documents.
    const posture = stepsFor("configFindings").filter(
      (s) => s.id === "FRAMEWORKS_LIST" || s.id.indexOf("COMPLIANCE_POSTURE_") === 0,
    );
    expect(posture.map((s) => s.id)).toEqual([]);
  });

  // THE PROPERTY THE PAGE/SHEET SPLIT HAS TO PRESERVE. The Wiz Scans page no longer carries
  // the battery; each drill-down fetches its own area. So "every step still reaches a reader"
  // is no longer true by construction of one payload — it is true only if the per-area
  // endpoint, unioned over the areas the battery names, is the battery. A step whose `area`
  // is misspelt, or an area the endpoint filters out, would strand it in exactly the way this
  // file's other specs are about.
  it("reaches every step through the per-area endpoint the sheet calls", async () => {
    const server = await bootServer();
    server.setup();
    const areas = [...new Set(steps.map((s) => s.area))];
    const seen: string[] = [];
    for (const area of areas) {
      const res = server.api.getScanStepDetail({ area }) as
        { ok: boolean; data?: { area: string; steps: Array<{ id: string }> } };
      expect(res.ok).toBe(true);
      // Echoed, so a sheet cannot paint one area's queries under another's heading.
      expect(res.data!.area).toBe(area);
      seen.push(...res.data!.steps.map((s) => s.id));
    }
    expect(seen.sort()).toEqual(steps.map((s) => s.id).sort());
  });

  // The documents are the reason this endpoint exists; a step that arrives without one would
  // render an empty code block and look like a step that sends nothing.
  it("carries a document for every step it returns", async () => {
    const server = await bootServer();
    server.setup();
    for (const area of [...new Set(steps.map((s) => s.area))]) {
      const res = server.api.getScanStepDetail({ area }) as
        { ok: boolean; data?: { steps: Array<{ id: string; document?: string }> } };
      for (const step of res.data!.steps) {
        expect(typeof step.document, step.id + " has no document").toBe("string");
        expect(step.document!.length, step.id + " has an empty document").toBeGreaterThan(0);
      }
    }
  });
});
