// `registerScopeDiagnostic` is run by hand from the Apps Script editor when the landscape's
// headline numbers look wrong in a way no rule change explains. Nothing else calls it, so
// a throw would surface to a maintainer mid-investigation — these cases boot the real
// server and call it for effect, once on an empty ledger and once after a sync.
//
// Assertions are about SHAPE and about the two INVARIANTS the output would be misleading
// without, never about seed counts. Pinning "12 of 87" here would couple a diagnostic to
// sampleData and break on every fixture change, which is how a smoke test becomes a chore
// (the same reasoning aarsDiagnostic.test.ts states in its own header).

import { describe, expect, it } from "vitest";
import { EDGE_TYPES } from "../src/domain/graphTypes";
import { bootServer } from "./gasEnv";

type Server = Awaited<ReturnType<typeof bootServer>> & { registerScopeDiagnostic(): string };

describe("registerScopeDiagnostic", () => {
  it("explains an empty ledger instead of throwing on it", async () => {
    const server = (await bootServer()) as Server;
    server.setup();

    const out = server.registerScopeDiagnostic();

    expect(out).toContain("=== AI register scope diagnostic ===");
    expect(out).toContain("ai_assets rows: 0");
    expect(out).toContain("run a sync first");
    expect(out).toContain("=== end ===");
  });

  it("breaks the register down by kind, and censuses the edges, after a sync", async () => {
    const server = (await bootServer()) as Server;
    server.setup();
    server.api.runSync({});

    const out = server.registerScopeDiagnostic();
    console.log(out);

    expect(out).toMatch(/ai_assets rows: [1-9]\d*/);
    expect(out).toContain("by kind, most rows first");
    expect(out).toMatch(/distinct kinds: +\d+/);
    expect(out).toMatch(/in AI_ASSET_KINDS: +\d+ of \d+/);
    expect(out).toMatch(/carrying any signal: +\d+ of \d+/);
    expect(out).toMatch(/largest AI kind: +\w+/);

    // The edge census must count against the DECLARED vocabulary, not against whatever the
    // ledger happens to hold — a census that only ever names what it found could never
    // report a dead relationship type, which is the one thing it exists to report.
    expect(out).toMatch(new RegExp(`populated edge types: +\\d+ of ${EDGE_TYPES.length}`));

    // It must refuse to draw the conclusion. The whole design of this diagnostic is that
    // the histogram decides whether a degenerate distribution is a scope artefact or a
    // visibility finding, and a threshold picked in the code would pre-empt exactly that.
    expect(out).toContain("let the numbers decide");
    expect(out).not.toMatch(/\bthe register is (too )?(wide|wrong)\b/i);
  });
});
