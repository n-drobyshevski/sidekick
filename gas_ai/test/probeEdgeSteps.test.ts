// `probeEdgeSteps` — the zero-argument editor probe over every step that writes a graph edge.
//
// What is worth pinning here is NOT the probe's output (that needs a tenant) but the two things
// that can silently rot without one: the credentials refusal, and the derivation of the step
// list. The list is derived from each step's own `writes` declaration precisely so a seventh
// traversal added later is probed without anyone remembering this file — a test that hardcoded
// the six ids would defeat that by failing on exactly the change the derivation exists to
// absorb. So the test asserts the derivation agrees with the battery, and reads BOTH sides from
// the battery.

import { describe, expect, it } from "vitest";
import { bootServer } from "./gasEnv";
import type { Rec } from "../src/domain/util";

type Server = Awaited<ReturnType<typeof bootServer>> & { probeEdgeSteps(): string };

/** Steps whose `writes` claims an ai_edges row — the same predicate the probe applies. */
function edgeStepIds(steps: Rec[]): string[] {
  return steps
    .filter((s) => ((s["writes"] as string[]) ?? []).some((w) => String(w).indexOf("ai_edges") === 0))
    .map((s) => String(s["id"]));
}

describe("probeEdgeSteps", () => {
  it("refuses in dry-run, in the same words api.probeSyncStep uses", async () => {
    const server = (await bootServer()) as Server;
    server.setup();

    // No credentials in the harness, so this is the path a dry-run deployment takes. It must
    // say why rather than failing somewhere deeper in the transport.
    const out = server.probeEdgeSteps();
    expect(out).toContain("=== edge-producing step probe ===");
    expect(out).toContain("no credentials are configured");
    expect(out).toContain("dry-run");
    expect(out).toContain("=== end ===");
  });

  it("never throws — a diagnostic that dies tells you nothing", async () => {
    const server = (await bootServer()) as Server;
    server.setup();
    expect(() => server.probeEdgeSteps()).not.toThrow();
  });

  it("the edge-step derivation and the battery agree on which steps write edges", async () => {
    const server = (await bootServer()) as Server;
    server.setup();

    const res = { ok: true, data: { steps: server.jobs.describeSyncSteps() } } as
      { ok: boolean; data?: { steps: Rec[] } };
    expect(res.ok).toBe(true);
    const ids = edgeStepIds(res.data!.steps);

    // The traversals this whole investigation is about. Named here as a READING of the
    // battery, not as the source of truth: if a step's `writes` stops claiming ai_edges, or a
    // new traversal starts claiming it, this list moves and the probe's coverage moves with it.
    // LINEAGE did exactly that — it was added claiming three edge types and appears here
    // without probeEdgeSteps being told about it, which is the derivation doing its job.
    expect(ids).toEqual([
      "RUNS_AS",
      "SA_FINDINGS",
      "SENSITIVE_DATA_ACCESS",
      "HOST_EXPOSURE",
      "ENDPOINT_EXPOSURE",
      "LINEAGE",
      "IDENTITY_ACCESS",
    ]);
  });

  it("every derived step is optional, which is why their failure was silent", async () => {
    // The property that made zero edges indistinguishable from a healthy landscape: an optional
    // step swallows an HTTP 400 and the sync still reports success. If one of these ever became
    // mandatory, a rejection would fail the whole sync instead — a different product, and worth
    // failing this test over.
    const server = (await bootServer()) as Server;
    server.setup();
    const res = { ok: true, data: { steps: server.jobs.describeSyncSteps() } } as
      { ok: boolean; data?: { steps: Rec[] } };
    const steps = (res.data!.steps ?? []).filter((s) =>
      edgeStepIds(res.data!.steps).includes(String(s["id"])),
    );
    expect(steps).toHaveLength(7);
    for (const s of steps) expect(s["optional"], String(s["id"])).toBe(true);
  });
});
