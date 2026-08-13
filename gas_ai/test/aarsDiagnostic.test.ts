// `aarsDiagnostic` is run by hand from the Apps Script editor, which means nothing else
// executes it — a throw would surface to a maintainer mid-investigation, at the worst
// moment. These two cases boot the real server and call it for effect: once against an
// empty ledger (the state it exists to explain) and once after a sync.
//
// The assertions are deliberately about SHAPE, not counts. Pinning "30 of 85" here would
// couple a diagnostic to sampleData and break on every fixture change, which is how a
// useful smoke test turns into a chore.

import { describe, expect, it } from "vitest";
import { bootServer } from "./gasEnv";

type Server = Awaited<ReturnType<typeof bootServer>> & { aarsDiagnostic(): string };

describe("aarsDiagnostic", () => {
  it("explains an empty ledger instead of throwing on it", async () => {
    const server = (await bootServer()) as Server;
    server.setup();

    const out = server.aarsDiagnostic();

    expect(out).toContain("=== AARS ledger diagnostic ===");
    expect(out).toContain("ai_assets rows: 0");
    expect(out).toContain("run a sync first");
    // No snapshot yet, so it must say so rather than report a phantom node count.
    expect(out).toContain("Drive snapshot: none");
    expect(out).toContain("=== end ===");
  });

  it("reports the columns, the counts, and the snapshot after a sync", async () => {
    const server = (await bootServer()) as Server;
    server.setup();
    server.api.runSync({});

    const out = server.aarsDiagnostic();

    // The three questions it exists to answer, in order.
    expect(out).toMatch(/column aars: +present/);
    expect(out).toMatch(/column aars_severity: +present/);
    expect(out).toMatch(/rows with a score: +\d+ of \d+/);
    expect(out).toMatch(/rows with a severity: +\d+ of \d+/);
    expect(out).toMatch(/Drive snapshot: \d+ nodes, \d+ scored, \d+ with a severity/);

    // Scores present with severities absent is the drift signature the advice line is for.
    // A healthy sync writes both, so that line must NOT appear here — otherwise the
    // diagnostic would cry wolf on a correct ledger.
    expect(out).not.toContain("Scores survived but severities did not");
  });
});
