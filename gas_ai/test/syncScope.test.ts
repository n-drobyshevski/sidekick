// Does the BATTERY carry the project scope — not just the builders.
//
// The distinction is the whole reason this file exists. `wizQueriesAi.test.ts` calls each
// variable builder with an explicit argument, so it proves a builder honours what it is
// handed and nothing at all about what the battery hands it. A test written that way sat
// green through the change that scoped these steps, under a name asserting they ran
// tenant-wide. The wiring is the part that can silently regress: a caller reverted to `null`
// looks like nothing here unless something reads the assembled step.

import { beforeAll, describe, expect, it } from "vitest";
import { bootServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type Server = Awaited<ReturnType<typeof bootServer>>;
let server: Server;

const PROJECT = "proj-value-chain";

function props(): GoogleAppsScript.Properties.Properties {
  return (globalThis as unknown as {
    PropertiesService: GoogleAppsScript.Properties.PropertiesService;
  }).PropertiesService.getScriptProperties();
}

/** Every step the battery would run, as the Scans panel describes them. */
function steps(): Rec[] {
  const res = { ok: true, data: { steps: server.jobs.describeSyncSteps() } } as
    { ok: boolean; data?: { steps: Rec[] } };
  expect(res.ok).toBe(true);
  return res.data?.steps ?? [];
}

function stepById(id: string): Rec {
  const s = steps().find((x) => String(x["id"]) === id);
  expect(s, `no step ${id}`).toBeDefined();
  return s as Rec;
}

beforeAll(async () => {
  server = await bootServer();
  server.setup();
});

describe("the battery's project scope", () => {
  it("sends no project filter at all when none is chosen", () => {
    // Opt-in, never hardcoded — the rule brick's tests already state, because os_vulns.py
    // hardcoded one tenant's project and copying it would scope every run to that tenant.
    props().deleteProperty("WIZ_PROJECT_ID_V2");
    const inv = stepById("INVENTORY_AI")["variables"] as Rec;
    const filterBy = (inv?.["filterBy"] ?? {}) as Rec;
    expect(Object.keys(filterBy)).toEqual(["type"]);

    for (const id of ["RUNS_AS", "SA_FINDINGS", "SENSITIVE_DATA_ACCESS", "LINEAGE"]) {
      expect((stepById(id)["variables"] as Rec)?.["projectId"], id).toBeNull();
    }
  });

  it("carries the chosen project into the register-defining step", () => {
    // INVENTORY_AI is the only non-optional step; its filter IS the register. It ignored
    // WIZ_PROJECT_ID_V2 while nine other steps honoured it, which is how a scope could be set
    // on this tenant and leave all 12,778 assets in place.
    props().setProperty("WIZ_PROJECT_ID_V2", PROJECT);
    const filterBy = ((stepById("INVENTORY_AI")["variables"] as Rec)["filterBy"]) as Rec;
    // The nested shape CloudResourceV2Filters actually declares — not `projectIdV2`, which is
    // vulnerabilityFindings', and not a bare `projectId`, which this type does not have.
    expect(filterBy["project"]).toEqual({ idV2: { equals: [PROJECT] } });
  });

  it("carries it into every graphSearch traversal, so the graph and the register agree", () => {
    // A tenant-wide traversal over a scoped register lands assets the register does not
    // contain. guardrail-coverage-pct is protectedAgents/agents, so GUARDRAIL_GAPS running
    // wide over a narrow denominator is a silently broken ratio rather than a wide net —
    // which is why it is in this list rather than exempted.
    props().setProperty("WIZ_PROJECT_ID_V2", PROJECT);
    for (const id of [
      "GUARDRAIL_GAPS", "RUNS_AS", "SA_FINDINGS", "SENSITIVE_DATA_ACCESS",
      "LINEAGE", "HOST_EXPOSURE", "ENDPOINT_EXPOSURE", "IDENTITY_ACCESS",
    ]) {
      expect((stepById(id)["variables"] as Rec)?.["projectId"], id).toBe(PROJECT);
    }
  });

  it("carries it into the other cloudResourcesV2 steps too", () => {
    props().setProperty("WIZ_PROJECT_ID_V2", PROJECT);
    for (const id of ["AI_ASSET_PROPERTIES", "AGENTIC_IDENTITIES"]) {
      const filterBy = ((stepById(id)["variables"] as Rec)["filterBy"]) as Rec;
      expect(filterBy["project"], id).toEqual({ idV2: { equals: [PROJECT] } });
    }
  });
});

describe("the Fetch scope setting decides whether the property is applied at all", () => {
  // FIRST in this block on purpose: nothing above it writes the settings tab, so this is the
  // only place in the file where the stored value is genuinely absent.
  it("is `project` on a workbook nobody has configured", () => {
    expect((server.api.getSettings({}) as { data?: Rec }).data?.["syncScope"]).toBe("project");
  });

  it("drops the project filter from EVERY step under `tenant`, property and all", () => {
    // The wiring, not the builders — this file's own header says why that distinction is
    // the point. A setting honoured by `projectScope()` and ignored by one step would
    // collect a register that is neither one perimeter nor all of them, and the two halves
    // would each look individually correct.
    props().setProperty("WIZ_PROJECT_ID_V2", PROJECT);
    const res = server.api.setSettings({ syncScope: "tenant" }) as
      { ok: boolean; error?: string; data?: Rec };
    expect([res.ok, res.error]).toEqual([true, undefined]);
    // Echoed back, so the Settings page repaints the stored value rather than its request.
    expect(res.data?.["syncScope"]).toBe("tenant");

    const inv = ((stepById("INVENTORY_AI")["variables"] as Rec)["filterBy"]) as Rec;
    expect(Object.keys(inv)).toEqual(["type"]);
    for (const id of ["AI_ASSET_PROPERTIES", "AGENTIC_IDENTITIES"]) {
      const filterBy = ((stepById(id)["variables"] as Rec)["filterBy"]) as Rec;
      expect(Object.keys(filterBy), id).not.toContain("project");
    }
    for (const id of [
      "GUARDRAIL_GAPS", "RUNS_AS", "SA_FINDINGS", "SENSITIVE_DATA_ACCESS",
      "LINEAGE", "HOST_EXPOSURE", "ENDPOINT_EXPOSURE", "IDENTITY_ACCESS",
    ]) {
      expect((stepById(id)["variables"] as Rec)?.["projectId"], id).toBeNull();
    }
  });

  it("puts the filter back when the setting goes back, with no property edit", () => {
    // The reason this is a setting rather than "clear WIZ_PROJECT_ID_V2": the property still
    // records WHICH project, so returning to the narrow register is one control and not a
    // trip to Project Settings with an id to re-paste.
    props().setProperty("WIZ_PROJECT_ID_V2", PROJECT);
    expect((server.api.setSettings({ syncScope: "tenant" }) as { ok: boolean }).ok).toBe(true);
    expect((server.api.setSettings({ syncScope: "project" }) as { ok: boolean }).ok).toBe(true);
    const filterBy = ((stepById("INVENTORY_AI")["variables"] as Rec)["filterBy"]) as Rec;
    expect(filterBy["project"]).toEqual({ idV2: { equals: [PROJECT] } });
  });
});
